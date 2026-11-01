/**
 * API tests with fastify.inject against a fake database. They cover what the API itself is
 * responsible for: signatures, schemas, roles, 202 + the outbox (event and job in ONE transaction).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sign, SIGNATURE_HEADER } from '@northstar/shared/hmac';
import { buildApp, type App } from '../src/app.js';

process.env.NODE_ENV = 'test';
const SECRET = 'test-webhook-secret';

/** Records every SQL statement, per connection, so we can assert transaction boundaries. */
function fakeDb(rowsFor: (sql: string) => any[] = () => []) {
  const log: string[] = [];
  const query = async (sql: string) => {
    log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (/INSERT INTO events/.test(sql)) return { rows: [{ id: 'evt-1' }], rowCount: 1 };
    const rows = rowsFor(sql);
    return { rows, rowCount: rows.length };
  };
  return { log, db: { query, connect: async () => ({ query, release: () => undefined }) } };
}

/** Like pg-boss: with { db } the job INSERT runs on the caller's connection (same transaction). */
const sent: Array<{ name: string; data: any; startAfter?: unknown }> = [];
const fakeBoss = {
  send: async (name: string, data: any, opts?: { startAfter?: unknown; db?: { executeSql: (t: string, v: unknown[]) => Promise<unknown> } }) => {
    sent.push({ name, data, ...(opts?.startAfter ? { startAfter: opts.startAfter } : {}) });
    await opts?.db?.executeSql('INSERT INTO pgboss.job (name, data) VALUES ($1, $2)', [name, data]);
    return 'job-1';
  },
  getQueueSize: async () => 0,
};

let app: App;
let fake: ReturnType<typeof fakeDb>;
let rows: (sql: string) => any[] = () => [];

beforeAll(async () => {
  fake = fakeDb((sql) => rows(sql));
  app = await buildApp({
    config: { port: 0, databaseUrl: '', jwtSecret: 'test-jwt', webhookSecret: SECRET, simulatedAuth: true, demoMode: false },
    db: fake.db as any,
    boss: fakeBoss as any,
  });
  await app.ready();
});
afterAll(() => app.close());
beforeEach(() => {
  fake.log.length = 0;
  sent.length = 0;
  rows = () => [];
});

const token = (roles: string[], oid = 'priya') => app.jwt.sign({ oid, name: oid, groups: [], roles });
const signedPost = (url: string, body: unknown, secret = SECRET) => {
  const payload = JSON.stringify(body);
  return app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: sign(payload, secret) } });
};
const drift = { type: 'drift.result', runUrl: 'https://gh/run/1', accounts: [{ accountId: '100000000103', drifted: true, resources: ['aws_security_group.alb'] }] };

describe('inbound webhooks', () => {
  it('accepts a signed pipeline event with 202 and writes event + job in ONE transaction', async () => {
    const res = await signedPost('/v1/events/pipeline', drift);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true, eventId: 'evt-1' });
    expect(fake.log).toEqual(['BEGIN', 'INSERT INTO events', 'INSERT INTO pgboss.job', 'COMMIT']);
    expect(sent).toEqual([{ name: 'evaluate-target', data: { eventId: 'evt-1' } }]);
  });

  it('rejects a bad signature with 401 before touching the database', async () => {
    const res = await signedPost('/v1/events/pipeline', drift, 'wrong-secret');
    expect(res.statusCode).toBe(401);
    expect(fake.log).toEqual([]);
  });

  it('rejects an unsigned request', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/events/membership', payload: { type: 'leaver', person: { id: 'jan' } } });
    expect(res.statusCode).toBe(401);
  });

  it('validates the body against the schema (400)', async () => {
    const res = await signedPost('/v1/events/pipeline', { type: 'drift.result', accounts: 'nope' });
    expect(res.statusCode).toBe(400);
    expect(fake.log).toEqual([]);
  });

  it('routes rollout events to project-rollout', async () => {
    await signedPost('/v1/events/pipeline', { type: 'rollout.started', rolloutId: 'r1', change: { ref: 'pr', title: 't' }, waves: [] });
    await signedPost('/v1/events/pipeline', { type: 'wave.completed', rolloutId: 'r1', wave: 'test', status: 'halted', failed: 1, total: 4 });
    expect(sent.map((s) => s.name)).toEqual(['project-rollout', 'project-rollout']);
  });
});

describe('roles (from Entra group claims)', () => {
  it('requires a bearer token', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/targets' })).statusCode).toBe(401);
  });

  it('a viewer cannot trigger a re-apply; an operator can, and it becomes a workflow_dispatch job', async () => {
    const url = '/v1/targets/100000000103/reapply';
    const asViewer = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token(['viewer'])}` } });
    expect(asViewer.statusCode).toBe(403);

    rows = (sql) => (sql.includes('FROM targets') ? [{ id: '100000000103', name: 'payments-prod' }] : []);
    const asOperator = await app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${token(['viewer', 'operator'])}` } });
    expect(asOperator.statusCode).toBe(202);
    expect(sent[0]).toMatchObject({ name: 'dispatch-workflow', data: { workflow: 'apply-baseline.yml', inputs: { account: 'payments-prod' } } });
  });

  it('only the admin (security) can register exceptions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/exceptions',
      headers: { authorization: `Bearer ${token(['viewer', 'operator'])}` },
      payload: { targetId: '100000000103', rule: 'r', owner: 'o', reason: 'r', compensatingControl: 'c', expiresAt: '2030-01-01T00:00:00Z' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('an exception schedules re-evaluation at its 14-day warning and at expiry, so the finding re-opens on time', async () => {
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    rows = (sql) =>
      sql.includes('FROM targets') ? [{}] : sql.includes('INSERT INTO exceptions')
        ? [{ id: 'ex-1', target_id: '100000000103', rule: 'r', owner: 'o', reason: 'r', compensating_control: 'c', expires_at: expiresAt }]
        : [];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/exceptions',
      headers: { authorization: `Bearer ${token(['viewer', 'admin'], 'sam')}` },
      payload: { targetId: '100000000103', rule: 'r', owner: 'o', reason: 'r', compensatingControl: 'c', expiresAt },
    });
    expect(res.statusCode).toBe(201);
    const rules = sent.filter((j) => j.name === 'run-platform-rules');
    expect(rules).toHaveLength(3); // now, warning window, expiry
    const delayed = rules.filter((j) => j.startAfter).map((j) => (j.startAfter as Date).getTime());
    expect(delayed).toEqual([new Date(expiresAt).getTime() - 14 * 86_400_000, new Date(expiresAt).getTime() + 1000]);
  });

  it('a leaver cannot sign in', async () => {
    rows = (sql) => (sql.includes('FROM people') ? [{ id: 'omar', name: 'Omar', team: 'cargo', role: 'developer', status: 'left' }] : []);
    const res = await app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { personId: 'omar' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('analytics feed', () => {
  it('needs the analytics scope — a normal user token is refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/analytics/compliance-daily', headers: { authorization: `Bearer ${token(['viewer', 'admin'])}` } });
    expect(res.statusCode).toBe(403);
  });

  it('returns aggregates only: no account ids, no resource names', async () => {
    rows = (sql) =>
      sql.includes('FROM findings')
        ? [{ day: '2026-11-01', team: 'payments', environment: 'prod', rule: 'terraform-drift', severity: 'high', openFindings: 1, target_id: '100000000103', resource: 'secret-bucket' }]
        : [];
    const res = await app.inject({ method: 'GET', url: '/v1/analytics/compliance-daily', headers: { authorization: `Bearer ${token(['analytics.read'], 'sp-bi-feed')}` } });
    expect(res.statusCode).toBe(200);
    const body = res.body;
    expect(res.json().findings[0]).toEqual({ day: '2026-11-01', team: 'payments', environment: 'prod', rule: 'terraform-drift', severity: 'high', openFindings: 1 });
    expect(body).not.toContain('100000000103'); // response schema strips anything not in the contract
    expect(body).not.toContain('secret-bucket');
  });
});

describe('analytics CSV', () => {
  it('quotes fields so a rule name with commas or quotes keeps six columns, and neutralises formulas', async () => {
    rows = (sql) =>
      sql.includes('FROM findings')
        ? [
            { day: '2026-11-01', team: 'cargo', environment: 'sandbox', rule: 'IAM.6 MFA for the "root" user, hardware', severity: 'low', openFindings: 1 },
            { day: '2026-11-01', team: 'cargo', environment: 'dev', rule: '=HYPERLINK("x")', severity: 'low', openFindings: 2 },
          ]
        : [];
    const res = await app.inject({ method: 'GET', url: '/v1/analytics/compliance-daily?format=csv', headers: { authorization: `Bearer ${token(['analytics.read'], 'sp-bi-feed')}` } });
    expect(res.statusCode).toBe(200);
    const lines = res.body.trim().split('\n');
    expect(lines[1]).toBe('2026-11-01,cargo,sandbox,"IAM.6 MFA for the ""root"" user, hardware",low,1');
    expect(lines[2]).toBe(`2026-11-01,cargo,dev,"'=HYPERLINK(""x"")",low,2`);
  });
});

describe('template catalog (the paved road per language)', () => {
  it('lists every template with its golden path, for any viewer, without touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/templates', headers: { authorization: `Bearer ${token(['viewer'])}` } });
    expect(res.statusCode).toBe(200);
    const ids = res.json().templates.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['node-api', 'php-symfony', 'dotnet-api', 'python-fastapi', 'node-lambda', 'python-lambda', 'react-static']));
    expect(res.json().templates.find((t: { id: string }) => t.id === 'php-symfony')).toMatchObject({ goldenPath: 'ecs-service', latestModuleVersion: '2.4.0' });
    expect(fake.log).toEqual([]);
  });

  it('requires a bearer token', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/templates' })).statusCode).toBe(401);
  });
});

describe('ops', () => {
  it('serves health and the OpenAPI document', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
    const spec = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    expect(Object.keys(spec.paths)).toContain('/v1/events/pipeline');
  });
});
