import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Exception, Finding, Rollout, Target } from '@northstar/shared';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString, max: 10 });
  // An idle client losing its connection (Postgres restart / failover) must not crash the process;
  // the pool replaces it on the next query.
  pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
  // ...nor one that is checked out (inside a transaction): its query rejects, the job retries.
  pool.on('connect', (client) => client.on('error', (err) => console.error('[pg] client error:', err.message)));
  return pool;
}

/** Run fn inside one transaction: the outbox guarantee (event + job commit together or not at all). */
export async function withTx<T>(db: Pick<pg.Pool, 'connect'>, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate(db: Queryable): Promise<void> {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.query(sql);
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

// ---------- row mappers (snake_case rows -> domain types) ----------
export const toTarget = (r: any): Target => ({
  id: r.id,
  name: r.name,
  cloud: 'aws',
  environment: r.environment,
  team: r.team,
  owner: r.owner,
  ou: r.ou,
  flavours: r.flavours,
  baselineVersion: r.baseline_version,
  moduleVersions: r.module_versions,
});

export const toFinding = (r: any): Finding => ({
  id: r.id,
  targetId: r.target_id,
  source: r.source,
  rule: r.rule,
  severity: r.severity,
  resource: r.resource,
  status: r.status,
  firstSeen: iso(r.first_seen),
  lastSeen: iso(r.last_seen),
  link: r.link,
});

export const toException = (r: any): Exception => ({
  id: r.id,
  targetId: r.target_id,
  rule: r.rule,
  owner: r.owner,
  reason: r.reason,
  compensatingControl: r.compensating_control,
  expiresAt: iso(r.expires_at),
});

export const toRollout = (r: any): Rollout => ({
  id: r.id,
  change: r.change,
  waves: r.waves,
  status: r.status,
  createdAt: iso(r.created_at),
});
