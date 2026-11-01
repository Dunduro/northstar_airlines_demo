/** Targets (AWS accounts), findings, overview and the re-apply action. */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { toException, toFinding } from '@northstar/db';
import {
  Accepted,
  Environment,
  ErrorBody,
  Finding,
  FindingSource,
  FindingStatus,
  JOBS,
  Overview,
  Severity,
  TargetDetail,
  TargetSummary,
  identityCenterLink,
  type DispatchWorkflowJob,
} from '@northstar/shared';
import { HttpError } from '../app.js';
import { buildOverview, loadSummaries } from '../read-models.js';

const security = [{ bearerAuth: [] }];

export const targetRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const viewer = app.requireRole('viewer');
  const operator = app.requireRole('operator');
  const { db } = app.deps;

  app.get(
    '/overview',
    { preHandler: viewer, schema: { tags: ['read'], summary: 'Heatmap environment x team, % compliant, 30-day trend', security, response: { 200: Overview } } },
    async () => buildOverview(db),
  );

  app.get(
    '/targets',
    {
      preHandler: viewer,
      schema: {
        tags: ['read'],
        summary: 'Accounts with compliance status',
        security,
        querystring: Type.Object({ environment: Type.Optional(Environment), team: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(TargetSummary) },
      },
    },
    async (req) => (await loadSummaries(db, req.query)).targets,
  );

  app.get(
    '/targets/:id',
    {
      preHandler: viewer,
      schema: {
        tags: ['read'],
        summary: 'Account detail: versions, findings by source, exceptions, recent deploys',
        security,
        params: Type.Object({ id: Type.String() }),
        response: { 200: TargetDetail, 404: ErrorBody },
      },
    },
    async (req) => {
      const { targets } = await loadSummaries(db);
      const target = targets.find((t) => t.id === req.params.id || t.name === req.params.id);
      if (!target) throw new HttpError(404, 'Unknown account');
      const [findings, exceptions, deploys] = await Promise.all([
        db.query(`SELECT * FROM findings WHERE target_id = $1 ORDER BY status, last_seen DESC`, [target.id]),
        db.query('SELECT * FROM exceptions WHERE target_id = $1 ORDER BY expires_at', [target.id]),
        db.query(
          `SELECT received_at, payload FROM events WHERE type = 'apply.result' AND payload->>'accountId' = $1 ORDER BY received_at DESC LIMIT 8`,
          [target.id],
        ),
      ]);
      return {
        target,
        findings: findings.rows.map(toFinding),
        exceptions: exceptions.rows.map(toException),
        recentDeploys: deploys.rows.map((r) => ({
          at: r.received_at.toISOString(),
          status: r.payload.status,
          ref: r.payload.ref,
          runUrl: r.payload.runUrl,
        })),
        consoleUrl: identityCenterLink(target.id, 'ReadOnly'),
      };
    },
  );

  app.get(
    '/findings',
    {
      preHandler: viewer,
      schema: {
        tags: ['read'],
        summary: 'Normalised findings from drift, policy checks, AWS Config and platform rules',
        security,
        querystring: Type.Object({
          severity: Type.Optional(Severity),
          source: Type.Optional(FindingSource),
          status: Type.Optional(FindingStatus),
          environment: Type.Optional(Environment),
          team: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(Finding) },
      },
    },
    async (req) => {
      const q = req.query;
      const { rows } = await db.query(
        `SELECT f.* FROM findings f JOIN targets t ON t.id = f.target_id
         WHERE ($1::text IS NULL OR f.severity = $1) AND ($2::text IS NULL OR f.source = $2)
           AND ($3::text IS NULL OR f.status = $3) AND ($4::text IS NULL OR t.environment = $4)
           AND ($5::text IS NULL OR t.team = $5)
         ORDER BY f.last_seen DESC LIMIT 500`,
        [q.severity ?? null, q.source ?? null, q.status ?? null, q.environment ?? null, q.team ?? null],
      );
      return rows.map(toFinding);
    },
  );

  app.post(
    '/targets/:id/reapply',
    {
      preHandler: operator,
      schema: {
        tags: ['actions'],
        summary: 'Re-apply the baseline. Enqueues a GitHub workflow_dispatch — the app never writes to AWS.',
        security,
        params: Type.Object({ id: Type.String({ pattern: '^[0-9]{12}$' }) }),
        response: { 202: Accepted, 401: ErrorBody, 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const { rows } = await db.query('SELECT id, name FROM targets WHERE id = $1', [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Unknown account');
      const job: DispatchWorkflowJob = {
        workflow: 'apply-baseline.yml',
        ref: 'main',
        inputs: { account: rows[0].name, reason: `re-apply requested from the dashboard by ${req.user.oid}` },
      };
      const eventId = await app.accept(
        { type: 'action.reapply', source: `dashboard:${req.user.oid}`, payload: { targetId: req.params.id } },
        [{ name: JOBS.dispatchWorkflow, data: job }],
      );
      return reply.status(202).send({ accepted: true, eventId });
    },
  );
};
