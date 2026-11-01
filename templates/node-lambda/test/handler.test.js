import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/handler.js';

const event = (path, headers = {}) => ({
  rawPath: path,
  headers,
  requestContext: { http: { method: 'GET', path }, requestId: 'apigw-req-1' },
});

test('GET /health answers 200', async () => {
  const res = await handler(event('/health'), { awsRequestId: 'r1' });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'ok');
});

test('a valid inbound correlation id is reused and echoed', async () => {
  const res = await handler(event('/', { 'x-correlation-id': 'abc-123' }), {});
  assert.equal(res.headers['x-correlation-id'], 'abc-123');
});

test("without one, API Gateway's request id becomes the correlation id", async () => {
  const res = await handler(event('/', { 'x-correlation-id': 'bad id' }), {});
  assert.equal(res.headers['x-correlation-id'], 'apigw-req-1');
});

test('unknown routes answer 404', async () => {
  const res = await handler(event('/nope'), {});
  assert.equal(res.statusCode, 404);
});
