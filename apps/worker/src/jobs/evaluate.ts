/**
 * evaluate-target / run-platform-rules: turn events into findings, apply exceptions, and hand
 * newly opened findings to the alert router (enqueued in the same transaction).
 */
import type PgBoss from 'pg-boss';
import { toException, toFinding, toTarget, withTx, type Db, type DbClient } from '@northstar/db';
import { JOBS, type Environment, type FindingSource, type PipelineEvent, type Severity, type Target } from '@northstar/shared';
import { enqueueInTx } from '@northstar/shared/queue';
import type { AlertCandidate } from '../domain/alert-routing.js';
import { runPlatformRules, waiverStatus } from '../domain/platform-rules.js';
import { config } from '../config.js';

interface FindingInput {
  rule: string;
  severity: Severity;
  resource: string;
  link?: string;
}

const driftSeverity = (env: Environment): Severity => (env === 'prod' || env === 'core' ? 'high' : env === 'test' ? 'medium' : 'low');

/**
 * Replace the full set of findings of one source for one target: upsert what is reported,
 * resolve what is no longer reported. Returns ids of findings that are new or re-opened.
 */
async function replaceFindings(c: DbClient, targetId: string, source: FindingSource, items: FindingInput[], link: string) {
  const { rows: existing } = await c.query('SELECT rule, resource, status FROM findings WHERE target_id = $1 AND source = $2', [targetId, source]);
  const before = new Map(existing.map((r) => [`${r.rule}|${r.resource}`, r.status as string]));
  const opened: string[] = [];
  for (const f of items) {
    const { rows } = await c.query(
      `INSERT INTO findings (target_id, source, rule, severity, resource, status, link)
       VALUES ($1, $2, $3, $4, $5, 'open', $6)
       ON CONFLICT (target_id, source, rule, resource) DO UPDATE SET
         last_seen = now(), severity = EXCLUDED.severity, link = EXCLUDED.link,
         status = CASE WHEN findings.status = 'resolved' THEN 'open' ELSE findings.status END,
         first_seen = CASE WHEN findings.status = 'resolved' THEN now() ELSE findings.first_seen END
       RETURNING id`,
      [targetId, source, f.rule, f.severity, f.resource, f.link ?? link],
    );
    const prev = before.get(`${f.rule}|${f.resource}`);
    if (!prev || prev === 'resolved') opened.push(rows[0].id);
  }
  const keep = items.map((f) => `${f.rule}|${f.resource}`);
  await c.query(
    `UPDATE findings SET status = 'resolved', last_seen = now()
     WHERE target_id = $1 AND source = $2 AND status <> 'resolved' AND NOT ((rule || '|' || resource) = ANY($3::text[]))`,
    [targetId, source, keep],
  );
  return opened;
}

async function loadTarget(c: DbClient, id: string): Promise<Target | null> {
  const { rows } = await c.query('SELECT * FROM targets WHERE id = $1', [id]);
  return rows[0] ? toTarget(rows[0]) : null;
}

/**
 * Platform rules + exception waivers for the given targets; returns alert candidates for
 * findings that were newly opened (and are still open after waivers).
 */
export async function evaluateTargets(c: DbClient, targetIds: string[], openedIds: string[], cause?: string): Promise<AlertCandidate[]> {
  const opened = [...openedIds];
  const targets = new Map<string, Target>();
  for (const id of targetIds) {
    const target = await loadTarget(c, id);
    if (!target) continue;
    targets.set(id, target);
    const { rows: exRows } = await c.query('SELECT * FROM exceptions WHERE target_id = $1', [id]);
    const exceptions = exRows.map(toException);
    const link = `${config.dashboardUrl}/accounts/${id}`;
    opened.push(...(await replaceFindings(c, id, 'platform', runPlatformRules(target, exceptions), link)));

    const { rows: fRows } = await c.query(`SELECT * FROM findings WHERE target_id = $1 AND status <> 'resolved'`, [id]);
    for (const f of fRows.map(toFinding)) {
      const status = waiverStatus(f, exceptions);
      if (status !== f.status) await c.query('UPDATE findings SET status = $2 WHERE id = $1', [f.id, status]);
    }
  }
  if (opened.length === 0) return [];
  const { rows } = await c.query(`SELECT * FROM findings WHERE id = ANY($1::uuid[]) AND status = 'open'`, [opened]);
  return rows.map(toFinding).flatMap((f) => {
    const t = targets.get(f.targetId);
    if (!t) return [];
    return [
      {
        key: `finding:${f.targetId}:${f.source}:${f.rule}:${f.resource}`,
        kind: 'finding' as const,
        source: f.source,
        rule: f.rule,
        severity: f.severity,
        team: t.team,
        environment: t.environment,
        targetId: t.id,
        targetName: t.name,
        resource: f.resource,
        cause,
        title: `${t.name}: ${f.source} — ${f.rule} on ${f.resource}`,
        link: `${config.dashboardUrl}/accounts/${t.id}`,
      },
    ];
  });
}

/** Apply one pipeline event to the projections. Returns affected targets and opened finding ids. */
export async function applyEvent(c: DbClient, ev: PipelineEvent): Promise<{ targets: string[]; opened: string[]; cause?: string }> {
  switch (ev.type) {
    case 'registry.sync': {
      for (const a of ev.accounts) {
        await c.query(
          `INSERT INTO targets (id, name, environment, team, owner, ou, flavours, baseline_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, environment = EXCLUDED.environment, team = EXCLUDED.team,
             owner = EXCLUDED.owner, ou = EXCLUDED.ou, flavours = EXCLUDED.flavours, updated_at = now()`,
          [a.id, a.name, a.environment, a.team, a.owner, a.ou, JSON.stringify(a.flavours), a.baseline_version],
        );
      }
      return { targets: ev.accounts.map((a) => a.id), opened: [], cause: ev.ref };
    }
    case 'plan.result': {
      const opened = await replaceFindings(c, ev.accountId, 'policy', ev.policyFindings, ev.runUrl);
      return { targets: [ev.accountId], opened, cause: ev.runUrl };
    }
    case 'config.findings': {
      const opened = await replaceFindings(c, ev.accountId, 'config', ev.findings, '');
      return { targets: [ev.accountId], opened };
    }
    case 'drift.result': {
      const opened: string[] = [];
      for (const a of ev.accounts) {
        const target = await loadTarget(c, a.accountId);
        if (!target) continue;
        const items = a.drifted
          ? a.resources.map((resource) => ({ rule: 'terraform-drift', severity: driftSeverity(target.environment), resource }))
          : [];
        opened.push(...(await replaceFindings(c, a.accountId, 'drift', items, ev.runUrl)));
      }
      return { targets: ev.accounts.map((a) => a.accountId), opened, cause: ev.runUrl };
    }
    case 'apply.result': {
      if (ev.status === 'succeeded') {
        await c.query(
          `UPDATE targets SET baseline_version = COALESCE($2, baseline_version),
             module_versions = module_versions || $3::jsonb, updated_at = now() WHERE id = $1`,
          [ev.accountId, ev.baselineVersion ?? null, JSON.stringify(ev.moduleVersions ?? {})],
        );
        // Only a baseline apply makes reality match the landing-zone code again. An app deploy
        // touches the team's own stack, so baseline drift in that account stays open.
        if (ev.scope !== 'deploy') await replaceFindings(c, ev.accountId, 'drift', [], ev.runUrl);
      }
      return { targets: [ev.accountId], opened: [] };
    }
    case 'rollout.started':
    case 'wave.completed':
      return { targets: [], opened: [] }; // mirrored by project-rollout
  }
}

export async function evaluateEvent(db: Db, boss: PgBoss, eventId: string): Promise<void> {
  await withTx(db, async (c) => {
    const { rows } = await c.query('SELECT payload FROM events WHERE id = $1', [eventId]);
    if (!rows[0]) return;
    const { targets, opened, cause } = await applyEvent(c, rows[0].payload as PipelineEvent);
    const candidates = await evaluateTargets(c, targets, opened, cause);
    if (candidates.length) await enqueueInTx(boss, c, JOBS.routeAlert, { candidates });
  });
}

/** Nightly (and after an exception change): platform rules over one target or the whole estate. */
export async function runPlatformRulesJob(db: Db, boss: PgBoss, targetId?: string): Promise<void> {
  await withTx(db, async (c) => {
    const { rows } = targetId
      ? await c.query('SELECT id FROM targets WHERE id = $1', [targetId])
      : await c.query('SELECT id FROM targets ORDER BY id');
    const candidates = await evaluateTargets(c, rows.map((r) => r.id), [], 'platform-rules');
    if (candidates.length) await enqueueInTx(boss, c, JOBS.routeAlert, { candidates });
  });
}
