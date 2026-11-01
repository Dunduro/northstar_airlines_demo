import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

test('GET /health answers 200 for the ALB', async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ok');
});

test('a valid inbound correlation id is reused and echoed', async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({ method: 'GET', url: '/', headers: { 'x-correlation-id': 'abc-123' } });
  assert.equal(res.headers['x-correlation-id'], 'abc-123');
  assert.equal(res.json().correlation_id, 'abc-123');
});

test('a missing or malformed correlation id is replaced', async () => {
  const app = buildApp({ logger: false });
  const res = await app.inject({ method: 'GET', url: '/', headers: { 'x-correlation-id': 'bad id\n' } });
  assert.match(res.headers['x-correlation-id'], /^[0-9a-f-]{36}$/);
});
