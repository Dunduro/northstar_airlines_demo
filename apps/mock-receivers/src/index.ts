/**
 * Mock receivers: plays Microsoft Teams (incoming webhooks), ServiceNow (incident API) and the
 * GitHub API (workflow_dispatch). Everything received is kept in memory and exposed at
 * GET /notifications for the dashboard's Notifications panel.
 *
 * The GitHub mock also simulates the two platform workflows, posting the same HMAC-signed
 * events the real ones post (see .github/workflows):
 *   - rollout-waves.yml   the pipeline orchestrates the waves and gates them (ADR-014)
 *   - apply-baseline.yml  one account: the dashboard's re-apply and retry
 * The simulator can make an account fail N times (POST /_control/failures) to demo a halt.
 */
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { parse } from 'yaml';
import { SIGNATURE_HEADER, sign } from '@northstar/shared/hmac';
import { planWaves, waveHalts, wavesToRun, type RegistryAccount } from './pipeline.js';

const PORT = Number(process.env.PORT ?? 4000);
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'local-dev-only-webhook-secret';
const RUN_DELAY_MS = Number(process.env.RUN_DELAY_MS ?? 900);
const REGISTRY = process.env.REGISTRY_PATH ?? new URL('../../../terraform/registry/accounts.yaml', import.meta.url).pathname;

const loadRegistry = (): RegistryAccount[] =>
  (parse(readFileSync(REGISTRY, 'utf8')) as { accounts: RegistryAccount[] }).accounts.map((a) => ({ ...a, id: String(a.id) }));

interface Notification {
  id: number;
  at: string;
  kind: 'teams' | 'servicenow' | 'github';
  channel: string;
  title: string;
  severity?: string;
  text?: string;
  link?: string;
}

let notifications: Notification[] = [];
let seq = 0;
let incidentSeq = 1000;
let runSeq = 7_000_000;
const failures = new Map<string, { times: number; error: string }>();

const record = (n: Omit<Notification, 'id' | 'at'>) => {
  notifications.unshift({ ...n, id: ++seq, at: new Date().toISOString() });
  notifications = notifications.slice(0, 200);
};

const app = Fastify({ logger: { level: 'warn' } });

app.post<{ Params: { channel: string }; Body: { title: string; severity?: string; text?: string; link?: string } }>(
  '/teams/webhook/:channel',
  async (req) => {
    record({ kind: 'teams', channel: req.params.channel, ...req.body });
    return { ok: true };
  },
);

app.post<{ Body: { short_description: string; assignment_group: string; urgency: number; description?: string } }>(
  '/servicenow/api/now/table/incident',
  async (req, reply) => {
    const number = `INC${++incidentSeq}`;
    record({ kind: 'servicenow', channel: req.body.assignment_group, title: `${number}: ${req.body.short_description}`, severity: req.body.urgency === 1 ? 'critical' : 'high', link: req.body.description });
    return reply.status(201).send({ result: { number, sys_id: `sys-${incidentSeq}` } });
  },
);

app.post<{ Params: { owner: string; repo: string; workflow: string }; Body: { ref: string; inputs?: Record<string, string> } }>(
  '/github/repos/:owner/:repo/actions/workflows/:workflow/dispatches',
  async (req, reply) => {
    const { workflow, owner, repo } = req.params;
    const inputs = req.body.inputs ?? {};
    const run = { id: ++runSeq, repo: `${owner}/${repo}`, sha: Math.random().toString(16).slice(2, 9) };
    const detail = Object.entries(inputs).map(([k, v]) => `${k}=${v}`).join(' · ');
    record({ kind: 'github', channel: run.repo, title: `workflow_dispatch ${workflow} @ ${req.body.ref}${detail ? ` (${detail})` : ''}`, link: runUrl(run) });

    if (workflow === 'rollout-waves.yml') void simulateRollout(run, inputs).catch((e) => console.error('rollout simulation failed', e));
    else if (workflow === 'apply-baseline.yml') void simulateApplyBaseline(run, inputs).catch((e) => console.error('apply simulation failed', e));
    else return reply.status(404).send({ message: `Not Found: workflow ${workflow}` }); // GitHub answers 404 for unknown workflows
    return reply.status(204).send();
  },
);

interface Run {
  id: number;
  repo: string;
  sha: string;
}
const runUrl = (run: Run) => `https://github.com/${run.repo}/actions/runs/${run.id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST an event to the platform, signed like .github/scripts/post-event.sh does. */
async function postEvent(event: object) {
  const body = JSON.stringify(event);
  try {
    const res = await fetch(`${API_URL}/v1/events/pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(body, WEBHOOK_SECRET) },
      body,
    });
    if (!res.ok) console.error(`event rejected: ${res.status} ${await res.text()}`);
  } catch (err) {
    // Like the real workflow (continue-on-error): the platform being down never blocks the pipeline.
    console.error('could not report to the platform', err);
  }
}

/** One `terraform apply` for one account; posts apply.result. Returns the status. */
async function applyAccount(run: Run, accountId: string, rolloutId?: string): Promise<'succeeded' | 'failed'> {
  await sleep(RUN_DELAY_MS + Math.random() * RUN_DELAY_MS);
  const fail = failures.get(accountId);
  const failed = Boolean(fail && fail.times > 0);
  if (failed) fail!.times -= 1; // "the fix is merged" after N failures, so a retry succeeds
  const status = failed ? 'failed' : 'succeeded';
  await postEvent({
    type: 'apply.result',
    accountId,
    runUrl: runUrl(run),
    ref: run.sha,
    status,
    ...(failed ? { error: fail!.error } : {}),
    ...(rolloutId ? { rolloutId } : {}),
  });
  return status;
}

/** rollout-waves.yml: start (or resume), then each wave: apply in parallel, gate, report. */
async function simulateRollout(run: Run, inputs: Record<string, string>) {
  const plan = planWaves(loadRegistry());
  const rolloutId = inputs.rollout_id || `ro-${run.id}`;
  if (!inputs.rollout_id) {
    await postEvent({ type: 'rollout.started', rolloutId, change: { ref: run.sha, title: inputs.change_title || 'Baseline change' }, waves: plan });
  }
  for (const wave of wavesToRun(plan, inputs.resume_after)) {
    const results = await Promise.all(wave.targets.map((t) => applyAccount(run, t.targetId, rolloutId)));
    const failed = results.filter((s) => s === 'failed').length;
    const halted = waveHalts(failed, results.length, wave.failureThreshold);
    await postEvent({ type: 'wave.completed', rolloutId, wave: wave.name, status: halted ? 'halted' : 'succeeded', failed, total: results.length });
    if (halted) return; // the next wave's job never starts
  }
}

/** apply-baseline.yml: one account by name (dashboard re-apply or retry). */
async function simulateApplyBaseline(run: Run, inputs: Record<string, string>) {
  const account = loadRegistry().find((a) => a.name === inputs.account);
  if (!account) return console.error(`apply-baseline: unknown account ${inputs.account}`);
  await applyAccount(run, account.id, inputs.rollout_id || undefined);
}

app.get<{ Querystring: { kind?: string } }>('/notifications', async (req) =>
  req.query.kind ? notifications.filter((n) => n.kind === req.query.kind) : notifications,
);

// ---- control endpoints for the simulator (local demo only) ----
app.post<{ Body: { accountId: string; times?: number; error?: string } }>('/_control/failures', async (req) => {
  failures.set(req.body.accountId, { times: req.body.times ?? 1, error: req.body.error ?? 'apply failed' });
  return { ok: true };
});

app.post('/_control/reset', async () => {
  notifications = [];
  failures.clear();
  return { ok: true };
});

app.get('/health', async () => ({ status: 'ok' }));

await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`mock receivers on :${PORT} (Teams, ServiceNow, GitHub) -> reporting runs to ${API_URL}`);
