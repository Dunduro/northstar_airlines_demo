import { describe, expect, it } from 'vitest';
import { projectRollout } from '../src/jobs/rollouts.js';

/** One fake connection: the event exists, the rollout row does not (yet). */
function fakeDb(event: { type: string; payload: object }) {
  const log: string[] = [];
  const client = {
    query: async (sql: string) => {
      log.push(sql.trim().split(/\s+/)[0]!);
      if (sql.includes('FROM events')) return { rows: [{ ...event, source: 'pipeline' }] };
      return { rows: [] };
    },
    release: () => undefined,
  };
  return { log, db: { connect: async () => client } as any };
}

describe('project-rollout job', () => {
  it.each(['apply.result', 'wave.completed'])('%s for a rollout not seen yet fails the job (retried), instead of being dropped', async (type) => {
    const { db, log } = fakeDb({ type, payload: { rolloutId: 'ro-early', accountId: '1', status: 'succeeded', wave: 'dev' } });
    await expect(projectRollout(db, {} as any, 'evt-1')).rejects.toThrow(/not known yet/);
    expect(log).toContain('ROLLBACK');
  });
});
