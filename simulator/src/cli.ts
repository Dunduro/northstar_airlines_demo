/**
 * simulator — plays the outside world against the platform API so the demo is deterministic.
 *
 *   seed | reset                       load the registry and a realistic starting state
 *   joiner <name> <team> [role]        HR: a new person joins a team
 *   leaver <name>                      HR: a person leaves — every door closes
 *   drift <account...>                 nightly drift run finds drift (several accounts = grouped alert)
 *   rollout <guardrail> [--fail acct]  guardrail PR merged: the pipeline rolls it out in waves; one Test account fails
 *   retry [rolloutId]                  operator retries the failed targets (same as the UI button)
 *   digest                             send the daily digest now
 */
import type { Rollout } from '@northstar/shared';
import {
  DASHBOARD_URL,
  account,
  asUser,
  loadRegistry,
  login,
  membership,
  mock,
  pipeline,
  runUrl,
  signed,
  sleep,
  slug,
  waitIdle,
} from './client.js';

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** Module versions as the pipeline reports them after the last deploy. Deliberately varied. */
const MODULE_VERSIONS: Record<string, Record<string, string>> = {
  'crew-prod': { 'ecs-service': '0.9.2', 'static-site': '1.4.0' }, // ecs-service: unsupported major -> high; static-site v1 = N-1
  'crew-test': { 'ecs-service': '1.8.0', 'static-site': '1.4.0' }, // N-1: supported
  'payments-sandbox': { 'ecs-service': '1.8.0' },
  'cargo-sandbox': { 'lambda-api': '0.7.0' },
};
const LATEST: Record<string, string> = { 'ecs-service': '2.4.0', 'lambda-api': '1.5.0', 'static-site': '2.0.0' };

const PEOPLE = [
  { id: 'priya', name: 'Priya Raman', team: 'platform', role: 'platform-engineer', github: 'priya-ns' },
  { id: 'sam', name: 'Sam Okafor', team: 'security', role: 'security', github: 'sam-sec' },
  { id: 'omar', name: 'Omar Haddad', team: 'cargo', role: 'developer', github: 'omar-h' },
];
const DEMO_KEY = (who: string) => `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${Buffer.from(who.padEnd(24, '0')).toString('base64').replace(/=/g, '')} ${who}@laptop`;

async function seed() {
  const registry = loadRegistry();
  console.log('Resetting platform state and mock receivers…');
  await signed('/v1/demo/reset');
  await mock('/_control/reset');

  console.log(`Registry sync: ${registry.length} accounts from terraform/registry/accounts.yaml`);
  await pipeline({ type: 'registry.sync', ref: 'main@seed', accounts: registry });
  await waitIdle();

  console.log('Last deploys: apply results with module versions');
  for (const a of registry) {
    const moduleVersions = MODULE_VERSIONS[a.name] ?? Object.fromEntries(a.flavours.map((f) => [f, LATEST[f] ?? '1.0.0']));
    await pipeline({ type: 'apply.result', accountId: a.id, runUrl: runUrl(), ref: 'main', status: 'succeeded', baselineVersion: a.baseline_version, moduleVersions });
  }

  console.log('Findings from Checkov (plan) and AWS Config / Security Hub');
  await pipeline({
    type: 'plan.result',
    accountId: account('payments-dev').id,
    runUrl: runUrl(),
    summary: { add: 1, change: 0, destroy: 0 },
    policyFindings: [{ rule: 'CKV_AWS_144', severity: 'low', resource: 'aws_s3_bucket.statements' }],
  });
  await pipeline({
    type: 'plan.result',
    accountId: account('cargo-dev').id,
    runUrl: runUrl(),
    summary: { add: 0, change: 1, destroy: 0 },
    policyFindings: [{ rule: 'CKV_AWS_18', severity: 'high', resource: 'aws_s3_bucket.manifests' }],
  });
  await pipeline({
    type: 'config.findings',
    accountId: account('crew-dev').id,
    findings: [{ rule: 'S3.2 bucket-public-read-prohibited', severity: 'critical', resource: 'arn:aws:s3:::crew-roster-exports', link: 'https://console.aws.amazon.com/securityhub/home#/findings' }],
  });
  await pipeline({
    type: 'config.findings',
    accountId: account('loyalty-prod').id,
    findings: [{ rule: 'rds-multi-az-support', severity: 'high', resource: 'arn:aws:rds:me-central-1:db:loyalty-points', link: 'https://console.aws.amazon.com/config/home#/rules' }],
  });
  await waitIdle();

  console.log('People: platform engineer, security, a cargo developer (all onboarded)');
  for (const p of PEOPLE) await membership({ type: 'joiner', person: { id: p.id, name: p.name, team: p.team, role: p.role } });
  await waitIdle();
  for (const p of PEOPLE) {
    const token = await login(p.id);
    await asUser(token, 'POST', `/v1/onboarding/${p.id}`, { step: 'device_key', publicKey: DEMO_KEY(p.id) });
    await asUser(token, 'POST', `/v1/onboarding/${p.id}`, { step: 'github_link', githubUsername: p.github });
    await asUser(token, 'POST', `/v1/onboarding/${p.id}`, { step: 'vpn_profile' });
    await asUser(token, 'POST', `/v1/onboarding/${p.id}`, { step: 'access_review' });
  }
  await waitIdle();

  console.log('Exceptions: one expiring in 9 days, one expired 2 days ago');
  const sam = await login('sam');
  await asUser(sam, 'POST', '/v1/exceptions', {
    targetId: account('loyalty-prod').id,
    rule: 'rds-multi-az-support',
    owner: 'loyalty-lead@northstar.example',
    reason: 'Single-AZ until the points-ledger migration completes (Q4)',
    compensatingControl: 'Hourly snapshots copied to eu-west-1; RTO 2h accepted by the business',
    expiresAt: daysFromNow(9),
  });
  await asUser(sam, 'POST', '/v1/exceptions', {
    targetId: account('cargo-dev').id,
    rule: 'CKV_AWS_18',
    owner: 'cargo-lead@northstar.example',
    reason: 'Access logging on the manifests bucket deferred during the vendor migration',
    compensatingControl: 'CloudTrail data events enabled on the bucket',
    expiresAt: daysFromNow(-2),
  });
  await waitIdle();
  await signed('/v1/demo/history');
  await mock('/_control/reset'); // start the demo with an empty notifications panel
  console.log(`\nSeeded. Open ${DASHBOARD_URL} and sign in (simulated Entra) as Priya, Sam or Omar.`);
}

async function joiner(name: string, team: string, role = 'developer') {
  if (!name || !team) throw new Error('usage: joiner <name> <team> [developer|lead|platform-engineer|security]');
  const id = slug(name);
  await membership({ type: 'joiner', person: { id, name, team, role } });
  await waitIdle();
  console.log(`HR joiner sent: ${name} (${role}) -> ${team}. Entra account + groups exist, access is provisioned.`);
  console.log(`${name} signs in at ${DASHBOARD_URL} (choose "${name}") and lands in the onboarding wizard.`);
}

async function leaver(name: string) {
  const id = slug(name);
  await membership({ type: 'leaver', person: { id } });
  await waitIdle();
  console.log(`HR leaver sent for ${id}. See ${DASHBOARD_URL}/people/${id} (as Sam) — every door closed.`);
}

async function drift(names: string[]) {
  if (!names.length) throw new Error('usage: drift <account> [account…]');
  const run = runUrl();
  const accounts = names.map(account);
  // One account: a console change on a security group. Several: the same guardrail drifted everywhere.
  const resource = accounts.length > 1 ? 'module.baseline.aws_iam_role.deploy' : 'aws_security_group.alb';
  await pipeline({ type: 'drift.result', runUrl: run, accounts: accounts.map((a) => ({ accountId: a.id, drifted: true, resources: [resource] })) });
  await waitIdle();
  console.log(`Nightly drift run ${run}: drift on ${resource} in ${accounts.map((a) => `${a.name} (${a.environment})`).join(', ')}`);
}

async function printRollout(r: Rollout) {
  const line = r.waves
    .map((w) => {
      const ok = w.targets.filter((t) => t.status === 'succeeded').length;
      const failed = w.targets.filter((t) => t.status === 'failed').length;
      return `${w.name}: ${w.status} ${ok}/${w.targets.length}${failed ? ` (${failed} failed)` : ''}`;
    })
    .join(' | ');
  console.log(`  [${r.status}] ${line}`);
}

/** Print wave progress until the rollout settles (halted or succeeded). */
async function watch(token: string, id: string, settled = (r: Rollout) => r.status === 'halted' || r.status === 'succeeded') {
  let last = '';
  for (let i = 0; i < 120; i++) {
    const r: Rollout = await asUser(token, 'GET', `/v1/rollouts/${id}`).catch(() => null);
    if (r) {
      const snapshot = JSON.stringify(r.waves.map((w) => [w.status, w.targets.map((t) => t.status)]));
      if (snapshot !== last) await printRollout(r);
      last = snapshot;
      if (settled(r)) return r;
    }
    await sleep(500);
  }
  throw new Error('rollout did not settle');
}

/**
 * Plays "a guardrail PR is merged": GitHub runs rollout-waves.yml (here: the GitHub mock), which
 * orchestrates the waves and reports to the platform. The platform only mirrors it.
 */
async function rollout(guardrail: string, failAccount = 'cargo-test') {
  if (!guardrail) throw new Error('usage: rollout <guardrail> [--fail <account>]');
  const failing = account(failAccount);
  await mock('/_control/failures', {
    accountId: failing.id,
    times: 1,
    error: `AccessDenied: aws_s3_bucket.legacy_reports lives in eu-central-1, outside the ${guardrail} allow-list. Move it or register an exception.`,
  });
  const token = await login('priya');
  const before = new Set(((await asUser(token, 'GET', '/v1/rollouts')) as Rollout[]).map((r) => r.id));
  await mock('/github/repos/northstar/landing-zone/actions/workflows/rollout-waves.yml/dispatches', {
    ref: 'main',
    inputs: { change_title: `Guardrail: ${guardrail}` },
  });
  let id: string | undefined;
  for (let i = 0; i < 40 && !id; i++) {
    await sleep(250);
    id = ((await asUser(token, 'GET', '/v1/rollouts')) as Rollout[]).find((r) => !before.has(r.id))?.id;
  }
  if (!id) throw new Error('the pipeline did not report rollout.started');
  console.log(`rollout-waves.yml run started rollout ${id} (${failing.name} will fail once). ${DASHBOARD_URL}/rollouts/${id}`);
  const r = await watch(token, id);
  if (r.status === 'halted') console.log(`Halted by the pipeline — Prod never received the change. Retry with: npm run sim -- retry ${id}`);
}

async function retry(id?: string) {
  const token = await login('priya');
  const rollouts: Rollout[] = await asUser(token, 'GET', '/v1/rollouts');
  const target = id ? rollouts.find((r) => r.id === id) : rollouts.find((r) => r.status === 'halted');
  if (!target) throw new Error('No halted rollout found');
  await asUser(token, 'POST', `/v1/rollouts/${target.id}/retry`);
  console.log(`Retry requested for ${target.id} (as Priya, operator)`);
  // The retry is async (202): wait until the halted wave is running again, then until it settles.
  let resumed = false;
  const r = await watch(token, target.id, (x) => (resumed ||= x.status !== 'halted') && x.status !== 'running');
  console.log(r.status === 'succeeded' ? 'Rollout completed — Prod received the change only after Test was green.' : `Rollout ${r.status}.`);
}

const [cmd, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};

const commands: Record<string, () => Promise<void>> = {
  seed,
  reset: seed,
  joiner: () => joiner(args[0]!, args[1]!, args[2]),
  leaver: () => leaver(args[0]!),
  drift: () => drift(args),
  rollout: () => {
    const fail = flag('fail');
    return rollout(args[0]!, fail);
  },
  retry: () => retry(args[0]),
  digest: async () => {
    await signed('/v1/demo/digest');
    await waitIdle();
    console.log('Daily digest sent.');
  },
};

const run = cmd ? commands[cmd] : undefined;
if (!run) {
  console.log('usage: npm run sim -- <seed|reset|joiner|leaver|drift|rollout|retry|digest> [args]');
  process.exit(cmd ? 1 : 0);
}
run().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
