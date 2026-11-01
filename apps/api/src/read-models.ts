/** Read models computed from the projections. Small estate in the PoC, so plain queries + JS. */
import { toException, toFinding, toTarget, type Queryable } from '@northstar/db';
import {
  SEVERITY_RANK,
  highestSeverity,
  isCompliant,
  type Exception,
  type Finding,
  type HeatmapCell,
  type Overview,
  type TargetSummary,
} from '@northstar/shared';

const DAY_MS = 86_400_000;
export const EXPIRY_WARNING_DAYS = 14;

export async function loadSummaries(db: Queryable, filter: { environment?: string; team?: string } = {}): Promise<{ targets: TargetSummary[]; findings: Finding[] }> {
  const [{ rows: t }, { rows: f }] = await Promise.all([
    db.query('SELECT * FROM targets ORDER BY name'),
    db.query(`SELECT * FROM findings WHERE status <> 'resolved'`),
  ]);
  const findings = f.map(toFinding);
  const byTarget = new Map<string, Finding[]>();
  for (const x of findings) byTarget.set(x.targetId, [...(byTarget.get(x.targetId) ?? []), x]);
  const targets = t
    .map(toTarget)
    .filter((x) => (!filter.environment || x.environment === filter.environment) && (!filter.team || x.team === filter.team))
    .map((x) => {
      const own = byTarget.get(x.id) ?? [];
      return {
        ...x,
        compliant: isCompliant(own),
        openFindings: own.filter((y) => y.status === 'open').length,
        highestSeverity: highestSeverity(own),
      };
    });
  return { targets, findings };
}

export const expiringOrExpired = (exceptions: Exception[], now = new Date()) =>
  exceptions
    .filter((e) => new Date(e.expiresAt).getTime() - now.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

export async function buildOverview(db: Queryable): Promise<Overview> {
  const { targets, findings } = await loadSummaries(db);
  const cells = new Map<string, HeatmapCell>();
  for (const t of targets) {
    const key = `${t.environment}|${t.team}`;
    const cell = cells.get(key) ?? { environment: t.environment, team: t.team, total: 0, compliant: 0 };
    cell.total += 1;
    if (t.compliant) cell.compliant += 1;
    cells.set(key, cell);
  }
  const compliant = targets.filter((t) => t.compliant).length;
  const percentCompliant = targets.length ? Math.round((compliant / targets.length) * 1000) / 10 : 100;

  const { rows: history } = await db.query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, sum(compliant)::float / NULLIF(sum(total), 0) AS ratio
     FROM compliance_snapshots WHERE day >= current_date - 29 AND day < current_date GROUP BY day ORDER BY day`,
  );
  const trend = [
    ...history.map((h) => ({ day: h.day, percentCompliant: Math.round((h.ratio ?? 1) * 1000) / 10 })),
    { day: new Date().toISOString().slice(0, 10), percentCompliant },
  ];

  const names = new Map(targets.map((t) => [t.id, t]));
  const highOrCritical = findings.filter((f) => f.status === 'open' && SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high);
  const critical = highOrCritical
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 8)
    .map((f) => ({ ...f, targetName: names.get(f.targetId)?.name ?? f.targetId, team: names.get(f.targetId)?.team ?? '' }));

  const { rows: ex } = await db.query('SELECT * FROM exceptions');
  return {
    percentCompliant,
    totalTargets: targets.length,
    heatmap: [...cells.values()],
    trend,
    critical,
    openHighOrCritical: highOrCritical.length,
    expiringExceptions: expiringOrExpired(ex.map(toException)),
  };
}
