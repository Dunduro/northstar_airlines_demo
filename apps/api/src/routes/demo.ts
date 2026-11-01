/**
 * Demo helpers, enabled only with DEMO_MODE=true, protected by the webhook signature so only the
 * simulator can call them. They make the demo deterministic; production has nothing like this.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { JOBS } from '@northstar/shared';
import { verifySignature } from './events.js';

export const demoRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db, boss } = app.deps;
  const preValidation = verifySignature(app.deps.config.webhookSecret);
  const schema = { tags: ['demo'], security: [{ hmac: [] }] };

  app.post('/demo/reset', { preValidation, schema: { ...schema, summary: 'Wipe all state (demo only)' } }, async () => {
    await db.query(`TRUNCATE events, findings, exceptions, rollouts, access_grants, onboarding, people, alerts, compliance_snapshots, targets CASCADE`);
    await db.query(`DELETE FROM pgboss.job`).catch(() => undefined);
    return { reset: true };
  });

  app.post(
    '/demo/history',
    { preValidation, schema: { ...schema, summary: 'Backfill 29 days of compliance snapshots trending towards today (demo only)' } },
    async () => {
      // Deterministic synthetic history: each cell becomes compliant on a fixed day, so the estate
      // improves steadily over 30 days (no noise).
      await db.query(`
        INSERT INTO compliance_snapshots (day, environment, team, total, compliant)
        SELECT current_date - d, c.environment, c.team, c.total,
               CASE WHEN abs(hashtext(c.environment || c.team)) % 100 < 62 + 22 * (29 - d) / 29.0 THEN c.total ELSE 0 END
        FROM generate_series(1, 29) AS d,
             (SELECT environment, team, count(*)::int AS total FROM targets GROUP BY environment, team) c
        ON CONFLICT (day, environment, team) DO NOTHING`);
      return { backfilled: true };
    },
  );

  app.get(
    '/demo/queue',
    { schema: { ...schema, summary: 'Jobs due and not yet finished (the simulator waits for 0); jobs scheduled for later, e.g. an exception expiry, are not counted', response: { 200: Type.Object({ pending: Type.Integer() }) } } },
    async () => {
      const { rows } = await db.query(`SELECT count(*)::int AS pending FROM pgboss.job WHERE state IN ('created', 'retry', 'active') AND name NOT LIKE '\\_\\_%' AND (state <> 'created' OR start_after <= now())`);
      return { pending: rows[0].pending };
    },
  );

  app.post('/demo/digest', { preValidation, schema: { ...schema, summary: 'Send the daily digest now (demo only)' } }, async () => {
    await boss.send(JOBS.sendDigest, {});
    return { queued: true };
  });
};
