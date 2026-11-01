/**
 * The app. Platform conventions (architecture 3.1) are wired in here once, so handlers stay plain:
 *   - one JSON log line per event with service, team, environment, version, correlation_id
 *   - x-correlation-id is accepted, generated when missing, echoed on the response and passed on
 *     to downstream calls (req.id)
 *   - GET /health for the ALB health check (no dependencies: liveness, not a deep check)
 */
import Fastify, { LogController } from 'fastify';
import { correlationId } from './correlation.js';

export const context = {
  service: process.env.SERVICE ?? 'hello-node-api',
  team: process.env.TEAM ?? 'payments',
  environment: process.env.ENVIRONMENT ?? 'local',
  version: process.env.VERSION ?? 'dev',
};

export function buildApp({ logger = true } = {}) {
  const app = Fastify({
    logger: logger && {
      level: process.env.LOG_LEVEL ?? 'info',
      base: context,
      messageKey: 'message',
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: { level: (label) => ({ level: label }) },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'correlation_id' }),
    genReqId: (req) => correlationId(req.headers['x-correlation-id']),
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
  });

  app.get('/health', async () => ({ status: 'ok', service: context.service, version: context.version }));

  app.get('/', async (req) => {
    req.log.info({ event: 'hello' }, 'said hello');
    return { message: `Hello from ${context.service}`, correlation_id: req.id };
  });

  return app;
}
