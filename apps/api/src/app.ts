/**
 * The thin public API. Routes validate input against TypeBox schemas (which also generate the
 * OpenAPI spec), write the event + its job(s) in ONE transaction, and answer 202.
 * Reads come from the projections the worker maintains.
 */
import { STATUS_CODES } from 'node:http';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type PgBoss from 'pg-boss';
import type pg from 'pg';
import { withTx } from '@northstar/db';
import { enqueueInTx } from '@northstar/shared/queue';
import type { TokenClaims } from '@northstar/shared';
import type { Config } from './config.js';
import { eventRoutes } from './routes/events.js';
import { targetRoutes } from './routes/targets.js';
import { exceptionRoutes } from './routes/exceptions.js';
import { rolloutRoutes } from './routes/rollouts.js';
import { peopleRoutes } from './routes/people.js';
import { analyticsRoutes } from './routes/analytics.js';
import { templateRoutes } from './routes/templates.js';
import { authRoutes } from './routes/auth.js';
import { demoRoutes } from './routes/demo.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenClaims;
    user: TokenClaims;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
  interface FastifyInstance {
    deps: Deps;
    /** preHandler: verify the bearer token and require one of the given roles/scopes. */
    requireRole: (...roles: string[]) => (req: FastifyRequest) => Promise<void>;
    /** Write an event and enqueue its jobs in one transaction (the outbox). Returns the event id. */
    accept: (event: { type: string; source: string; payload: unknown }, jobs: Array<{ name: string; data?: object }>) => Promise<string>;
  }
}

export interface Deps {
  config: Config;
  db: Pick<pg.Pool, 'query' | 'connect'>;
  boss: Pick<PgBoss, 'send' | 'getQueueSize'>;
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export async function buildApp(deps: Deps) {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' } }).withTypeProvider<TypeBoxTypeProvider>();
  app.decorate('deps', deps);

  // Keep the raw body: inbound webhooks are verified by HMAC over the exact bytes received.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      (err as any).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  await app.register(fastifyJwt, { secret: deps.config.jwtSecret, sign: { expiresIn: '8h' } });

  app.decorate('requireRole', (...roles: string[]) => async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Missing or invalid bearer token');
    }
    if (!req.user.roles.some((r) => roles.includes(r))) throw new HttpError(403, `Requires role: ${roles.join(' or ')}`);
  });

  app.decorate('accept', async (event, jobs) =>
    withTx(deps.db, async (client) => {
      const { rows } = await client.query('INSERT INTO events (type, source, payload) VALUES ($1, $2, $3) RETURNING id', [
        event.type,
        event.source,
        JSON.stringify(event.payload),
      ]);
      const eventId: string = rows[0].id;
      for (const job of jobs) await enqueueInTx(deps.boss, client, job.name, job.data ?? { eventId });
      return eventId;
    }),
  );

  app.setErrorHandler((err: any, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.status(status).send({ error: STATUS_CODES[status] ?? 'Error', message: status >= 500 ? 'Unexpected error' : err.message });
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'NorthStar Platform API',
        version: '1.0.0',
        description:
          'Thin, async API of the NorthStar landing-zone platform. Event endpoints answer 202 and are processed by workers. ' +
          'The platform never writes to AWS: actions become GitHub workflow_dispatch runs.',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT (Entra ID; simulated in the PoC)' },
          hmac: { type: 'apiKey', in: 'header', name: 'x-northstar-signature', description: 'sha256=<HMAC of the raw body>' },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', { schema: { tags: ['ops'], hide: false } }, async () => ({ status: 'ok' }));

  await app.register(
    async (v1) => {
      await v1.register(eventRoutes);
      await v1.register(targetRoutes);
      await v1.register(exceptionRoutes);
      await v1.register(rolloutRoutes);
      await v1.register(peopleRoutes);
      await v1.register(analyticsRoutes);
      await v1.register(templateRoutes);
      if (deps.config.simulatedAuth) await v1.register(authRoutes);
      if (deps.config.demoMode) await v1.register(demoRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
