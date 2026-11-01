import type PgBoss from 'pg-boss';
import { JOBS } from './jobs.js';

/** Create all queues (idempotent). Jobs retry with backoff, then land in the dead-letter queue. */
export async function ensureQueues(boss: PgBoss): Promise<void> {
  if (!(await boss.getQueue(JOBS.deadLetter))) await boss.createQueue(JOBS.deadLetter);
  for (const name of Object.values(JOBS)) {
    if (name === JOBS.deadLetter) continue;
    // Handlers take milliseconds (outbound calls time out after 5 s): a job still "active" after
    // 2 minutes belongs to a worker that died, so it is failed and retried instead of waiting 15 min.
    const policy = { name, retryLimit: 4, retryDelay: 2, retryBackoff: true, expireInSeconds: 120, deadLetter: JOBS.deadLetter };
    if (await boss.getQueue(name)) await boss.updateQueue(name, policy);
    else await boss.createQueue(name, policy);
  }
}

/** Minimal client shape we need (a pg PoolClient fits). */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/**
 * Enqueue a job INSIDE the caller's transaction — the transactional outbox. If the transaction
 * rolls back, the job never existed; if it commits, the job is guaranteed to be picked up.
 */
export function enqueueInTx(boss: Pick<PgBoss, 'send'>, client: SqlClient, name: string, data: object, options: PgBoss.SendOptions = {}) {
  return boss.send(name, data, { ...options, db: { executeSql: (text: string, values: unknown[]) => client.query(text, values) } });
}
