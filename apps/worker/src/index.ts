/**
 * The worker: consumes jobs from the Postgres-backed queue (pg-boss). Handlers are safe to
 * retry, so pg-boss can retry with backoff: projections are idempotent, and alert delivery is
 * at-least-once (receivers dedupe on the alert's dedupe key). After the retry limit a job lands
 * in the dead-letter queue, which raises an alert instead of disappearing.
 */
import PgBoss from 'pg-boss';
import { createPool, migrate } from '@northstar/db';
import { JOBS, type DispatchWorkflowJob, type EventJob, type PlatformRulesJob } from '@northstar/shared';
import { ensureQueues } from '@northstar/shared/queue';
import { config } from './config.js';
import { evaluateEvent, runPlatformRulesJob } from './jobs/evaluate.js';
import { routeAlerts, sendDigest } from './jobs/alerts.js';
import { projectRollout } from './jobs/rollouts.js';
import { handleOnboardingEvent } from './jobs/onboarding.js';
import { snapshotCompliance } from './jobs/snapshot.js';
import { dispatchWorkflow, sendTeams } from './outbound.js';
import type { AlertCandidate } from './domain/alert-routing.js';

const db = createPool(config.databaseUrl);
await migrate(db);

const boss = new PgBoss({ connectionString: config.databaseUrl });
boss.on('error', (err) => console.error('[pg-boss]', err));
await boss.start();
await ensureQueues(boss);

// pg-boss waits the polling interval after every fetch, so one job per fetch caps a queue at
// 2 jobs/s. Fetch a batch and run it in order (FIFO), failing jobs one by one: a failed job is
// retried with backoff on its own, the others in the batch complete.
const opts = { pollingIntervalSeconds: 0.5, batchSize: 50 };

function handle<T extends object>(name: string, fn: (data: T) => Promise<void>) {
  return boss.work<T>(name, opts, async (jobs) => {
    for (const job of jobs) {
      const started = Date.now();
      try {
        await fn(job.data);
        console.log(`[${name}] ${job.id} done in ${Date.now() - started}ms`);
      } catch (err) {
        console.error(`[${name}] ${job.id} failed (will retry):`, (err as Error).message);
        await boss.fail(name, job.id, { message: (err as Error).message });
      }
    }
  });
}

await handle<EventJob>(JOBS.evaluateTarget, (d) => evaluateEvent(db, boss, d.eventId));
await handle<PlatformRulesJob>(JOBS.runPlatformRules, (d) => runPlatformRulesJob(db, boss, d.targetId));
await handle<{ candidates: AlertCandidate[] }>(JOBS.routeAlert, (d) => routeAlerts(db, d.candidates));
await handle<DispatchWorkflowJob>(JOBS.dispatchWorkflow, async (d) => {
  await dispatchWorkflow(d.workflow, d.ref, d.inputs);
});
await handle<EventJob>(JOBS.projectRollout, (d) => projectRollout(db, boss, d.eventId));
await handle<EventJob>(JOBS.onboardingStep, (d) => handleOnboardingEvent(db, d.eventId));
await handle<object>(JOBS.sendDigest, () => sendDigest(db));
await handle<object>(JOBS.snapshotCompliance, () => snapshotCompliance(db));
await handle<object>(JOBS.deadLetter, async (data) => {
  await sendTeams('platform-oncall', {
    title: 'A job failed after all retries and was dead-lettered',
    severity: 'high',
    text: JSON.stringify(data).slice(0, 500),
    link: '',
  });
});

// Schedules (cron, Dubai time): nightly platform rules, morning digest, end-of-day snapshot.
await boss.schedule(JOBS.runPlatformRules, '0 2 * * *', {}, { tz: 'Asia/Dubai' });
await boss.schedule(JOBS.sendDigest, '0 8 * * *', {}, { tz: 'Asia/Dubai' });
await boss.schedule(JOBS.snapshotCompliance, '55 23 * * *', {}, { tz: 'Asia/Dubai' });

console.log('worker ready');

const shutdown = async () => {
  await boss.stop({ graceful: true, timeout: 5000 });
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
