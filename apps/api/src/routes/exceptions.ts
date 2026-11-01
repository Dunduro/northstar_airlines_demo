/** Governance exceptions: who, why, compensating control, until when. */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { toException, withTx } from '@northstar/db';
import { ErrorBody, Exception, JOBS, NewException } from '@northstar/shared';
import { enqueueInTx } from '@northstar/shared/queue';
import { HttpError } from '../app.js';
import { EXPIRY_WARNING_DAYS } from '../read-models.js';

const security = [{ bearerAuth: [] }];
const DAY_MS = 86_400_000;

/** Future moments at which an exception changes state: warning window opens, and expiry (+1 s). */
export function reevaluationTimes(expiresAt: string, now = Date.now()): Date[] {
  const expiry = new Date(expiresAt).getTime();
  return [expiry - EXPIRY_WARNING_DAYS * DAY_MS, expiry + 1000].filter((t) => t > now).map((t) => new Date(t));
}

export const exceptionRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, boss } = app.deps;

  app.get(
    '/exceptions',
    {
      preHandler: app.requireRole('viewer'),
      schema: { tags: ['exceptions'], summary: 'All registered exceptions, soonest expiry first', security, response: { 200: Type.Array(Exception) } },
    },
    async () => (await db.query('SELECT * FROM exceptions ORDER BY expires_at')).rows.map(toException),
  );

  app.post(
    '/exceptions',
    {
      preHandler: app.requireRole('admin'),
      schema: {
        tags: ['exceptions'],
        summary: 'Record an exception (admin = security). Production: a PR to the exceptions registry in git (CODEOWNERS = security) mirrored here by the pipeline. An already-expired one waives nothing and re-opens its finding.',
        security,
        body: NewException,
        response: { 201: Exception, 400: ErrorBody, 401: ErrorBody, 403: ErrorBody },
      },
    },
    async (req, reply) => {
      const e = req.body;
      const { rowCount } = await db.query('SELECT 1 FROM targets WHERE id = $1', [e.targetId]);
      if (!rowCount) throw new HttpError(400, 'Unknown targetId');
      const created = await withTx(db, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO exceptions (target_id, rule, owner, reason, compensating_control, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [e.targetId, e.rule, e.owner, e.reason, e.compensatingControl, e.expiresAt],
        );
        await c.query('INSERT INTO events (type, source, payload) VALUES ($1, $2, $3)', [
          'exception.created',
          `dashboard:${req.user.oid}`,
          JSON.stringify(rows[0]),
        ]);
        await enqueueInTx(boss, c, JOBS.runPlatformRules, { targetId: e.targetId });
        // Re-evaluate when the exception enters its 14-day warning and the moment it expires, so the
        // waived finding re-opens on time (not only at the nightly run).
        for (const at of reevaluationTimes(e.expiresAt)) {
          await enqueueInTx(boss, c, JOBS.runPlatformRules, { targetId: e.targetId }, { startAfter: at });
        }
        return toException(rows[0]);
      });
      return reply.status(201).send(created);
    },
  );
};
