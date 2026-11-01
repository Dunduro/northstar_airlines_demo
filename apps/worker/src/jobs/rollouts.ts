/**
 * project-rollout: mirror the pipeline's rollout events into the rollouts table, and turn an
 * operator retry into apply-baseline.yml dispatches. The worker never decides halting.
 */
import type PgBoss from 'pg-boss';
import { toRollout, withTx, type Db, type DbClient } from '@northstar/db';
import { JOBS, type DispatchWorkflowJob, type Rollout } from '@northstar/shared';
import { enqueueInTx } from '@northstar/shared/queue';
import { fromStarted, recordResult, recordWaveCompleted, startRetry } from '../domain/rollout-projection.js';
import type { AlertCandidate } from '../domain/alert-routing.js';
import { config } from '../config.js';

async function lock(c: DbClient, id: string): Promise<Rollout | null> {
  const { rows } = await c.query('SELECT * FROM rollouts WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ? toRollout(rows[0]) : null;
}

const save = (c: DbClient, r: Rollout) =>
  c.query('UPDATE rollouts SET waves = $2, status = $3 WHERE id = $1', [r.id, JSON.stringify(r.waves), r.status]);

const dispatch = (boss: PgBoss, c: DbClient, job: DispatchWorkflowJob) => enqueueInTx(boss, c, JOBS.dispatchWorkflow, job);

export async function projectRollout(db: Db, boss: PgBoss, eventId: string): Promise<void> {
  await withTx(db, async (c) => {
    const { rows } = await c.query('SELECT type, source, payload FROM events WHERE id = $1', [eventId]);
    if (!rows[0]) return;
    const { type, source, payload } = rows[0];

    if (type === 'rollout.started') {
      const r = fromStarted(payload);
      await c.query(
        `INSERT INTO rollouts (id, change, waves, status) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [r.id, JSON.stringify(r.change), JSON.stringify(r.waves), r.status],
      );
      return;
    }

    const r = await lock(c, payload.rolloutId);
    // Not seen yet: rollout.started may still be in flight (another worker, or a non-FIFO queue).
    // Throw so the job retries with backoff; a rollout that never appears ends in the dead-letter queue.
    if (!r) throw new Error(`rollout ${payload.rolloutId} not known yet (${type} arrived before rollout.started)`);

    if (type === 'apply.result') {
      const step = recordResult(r, payload.accountId, payload.status, payload.error);
      await save(c, step.rollout);
      if (step.resumeAfter) {
        // The retried wave is green again: let the pipeline run the remaining waves (it gates them).
        await dispatch(boss, c, { workflow: 'rollout-waves.yml', ref: 'main', inputs: { rollout_id: r.id, resume_after: step.resumeAfter } });
      }
      return;
    }

    if (type === 'wave.completed') {
      const next = recordWaveCompleted(r, payload.wave, payload.status);
      await save(c, next);
      if (payload.status === 'halted') {
        const wave = next.waves.find((w) => w.name === payload.wave)!;
        const failed = wave.targets.filter((t) => t.status === 'failed');
        const candidate: AlertCandidate = {
          key: `rollout:${r.id}:${payload.wave}:halted:${failed.map((t) => t.attempts).join('.')}`,
          kind: 'rollout-halted',
          rule: 'rollout-wave-failed',
          severity: 'high',
          team: 'platform-oncall',
          title: `Rollout "${r.change.title}" halted in ${payload.wave} (${payload.failed}/${payload.total} failed): ${failed
            .map((t) => `${t.name} (${t.error})`)
            .join(', ')}. The pipeline will not start the next wave.`,
          link: `${config.dashboardUrl}/rollouts/${r.id}`,
        };
        await enqueueInTx(boss, c, JOBS.routeAlert, { candidates: [candidate] });
      }
      return;
    }

    if (type === 'rollout.retry') {
      const { rollout, retry } = startRetry(r);
      await save(c, rollout);
      for (const t of retry) {
        await dispatch(boss, c, {
          workflow: 'apply-baseline.yml',
          ref: 'main',
          inputs: { account: t.name, reason: `retry of rollout ${r.id} (${source})`, rollout_id: r.id },
        });
      }
    }
  });
}
