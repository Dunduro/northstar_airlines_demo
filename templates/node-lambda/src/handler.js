/**
 * API Gateway HTTP API (payload 2.0) -> Lambda. Platform conventions are applied here once:
 * correlation id in (x-correlation-id, else API Gateway's request id), out (response header),
 * and on every log line.
 */
import { context, logger } from './log.js';

const VALID = /^[A-Za-z0-9._:-]{1,128}$/;

const routes = {
  'GET /health': () => ({ status: 'ok', service: context.service, version: context.version }),
  'GET /': (_event, log) => {
    log.info('said hello', { event: 'hello' });
    return { message: `Hello from ${context.service}` };
  },
};

export const handler = async (event, lambdaContext) => {
  const inbound = event.headers?.['x-correlation-id'];
  const correlationId = VALID.test(inbound ?? '') ? inbound : (event.requestContext?.requestId ?? crypto.randomUUID());
  const log = logger({ correlation_id: correlationId, request_id: lambdaContext?.awsRequestId });

  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const route = routes[`${method} ${path}`];
  const started = performance.now();

  let statusCode = 200;
  let body;
  try {
    body = route ? await route(event, log) : ((statusCode = 404), { error: 'not found' });
  } catch (err) {
    log.error('unhandled error', { error: err.message });
    statusCode = 500;
    body = { error: 'internal error', correlation_id: correlationId };
  }

  log.info('request completed', { method, path, status: statusCode, duration_ms: Math.round(performance.now() - started) });
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId },
    body: JSON.stringify(body),
  };
};
