/** Rollouts in waves (read) and retry of failed targets (operator action). */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { toRollout } from '@northstar/db';
import { Accepted, ErrorBody, JOBS, Rollout } from '@northstar/shared';
import { HttpError } from '../app.js';

const security = [{ bearerAuth: [] }];

export const rolloutRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.deps;
  const viewer = app.requireRole('viewer');

  app.get(
    '/rollouts',
    { preHandler: viewer, schema: { tags: ['rollouts'], summary: 'Rollouts, newest first', security, response: { 200: Type.Array(Rollout) } } },
    async () => (await db.query('SELECT * FROM rollouts ORDER BY created_at DESC LIMIT 20')).rows.map(toRollout),
  );

  app.get(
    '/rollouts/:id',
    {
      preHandler: viewer,
      schema: { tags: ['rollouts'], summary: 'Waves and per-target status', security, params: Type.Object({ id: Type.String() }), response: { 200: Rollout, 404: ErrorBody } },
    },
    async (req) => {
      const { rows } = await db.query('SELECT * FROM rollouts WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Unknown rollout');
      return toRollout(rows[0]);
    },
  );

  app.post(
    '/rollouts/:id/retry',
    {
      preHandler: app.requireRole('operator'),
      schema: {
        tags: ['rollouts', 'actions'],
        summary: 'Retry the failed targets of a halted wave: one apply-baseline.yml workflow_dispatch per target; when they are green the pipeline resumes the remaining waves',
        security,
        params: Type.Object({ id: Type.String() }),
        response: { 202: Accepted, 401: ErrorBody, 403: ErrorBody, 404: ErrorBody, 409: ErrorBody },
      },
    },
    async (req, reply) => {
      const { rows } = await db.query('SELECT status FROM rollouts WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Unknown rollout');
      if (rows[0].status !== 'halted') throw new HttpError(409, `Rollout is ${rows[0].status}; only a halted rollout can be retried`);
      const eventId = await app.accept(
        { type: 'rollout.retry', source: `dashboard:${req.user.oid}`, payload: { rolloutId: req.params.id } },
        [{ name: JOBS.projectRollout }],
      );
      return reply.status(202).send({ accepted: true, eventId });
    },
  );
};
