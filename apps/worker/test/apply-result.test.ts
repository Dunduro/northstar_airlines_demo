import { describe, expect, it } from 'vitest';
import { applyEvent } from '../src/jobs/evaluate.js';

/** Records every query; drift findings are only touched through `source = 'drift'`. */
function fakeClient() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const touchesDrift = () => calls.some((q) => q.params.includes('drift'));
  return { client: client as any, touchesDrift };
}

const base = { type: 'apply.result', accountId: '100000000011', runUrl: 'https://ci/run/1', ref: 'main', status: 'succeeded' } as const;

describe('apply.result', () => {
  it('a baseline apply resolves drift in the account', async () => {
    const { client, touchesDrift } = fakeClient();
    await applyEvent(client, { ...base, baselineVersion: '1.4.0' });
    expect(touchesDrift()).toBe(true);
  });

  it('an app deploy leaves baseline drift open', async () => {
    const { client, touchesDrift } = fakeClient();
    await applyEvent(client, { ...base, scope: 'deploy' });
    expect(touchesDrift()).toBe(false);
  });
});
