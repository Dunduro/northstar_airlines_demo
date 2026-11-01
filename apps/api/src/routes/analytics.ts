/**
 * The BI feed: aggregated and anonymised. Counts per team / environment / rule / severity only —
 * no account ids, no resource names. A list of "Prod accounts with open findings" is an attack
 * map and never leaves the platform.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ANALYTICS_SCOPE, AnalyticsRow, Environment } from '@northstar/shared';

/** RFC 4180 field: quote when needed; neutralise spreadsheet formulas (rule names come from external tools). */
export const csvField = (v: unknown): string => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ComplianceDaily = Type.Object({
  generatedAt: Type.String(),
  findings: Type.Array(AnalyticsRow, { description: "Today's open findings, aggregated" }),
  compliance: Type.Array(
    Type.Object({ day: Type.String(), team: Type.String(), environment: Environment, total: Type.Integer(), compliant: Type.Integer() }),
    { description: 'Daily compliance per team x environment (last 30 days)' },
  ),
});

export const analyticsRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.deps;

  app.get(
    '/analytics/compliance-daily',
    {
      preHandler: app.requireRole(ANALYTICS_SCOPE),
      schema: {
        tags: ['analytics'],
        summary: 'Aggregated, anonymised daily feed for the BI platform (Power BI). Requires the analytics.read scope.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({ format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv')])) }),
        response: { 200: ComplianceDaily }, // format=csv returns text/csv with the findings rows
      },
    },
    async (req, reply) => {
      const { rows: findings } = await db.query(
        `SELECT to_char(current_date, 'YYYY-MM-DD') AS day, t.team, t.environment, f.rule, f.severity, count(*)::int AS "openFindings"
         FROM findings f JOIN targets t ON t.id = f.target_id
         WHERE f.status = 'open'
         GROUP BY t.team, t.environment, f.rule, f.severity
         ORDER BY t.team, t.environment, f.rule`,
      );
      if (req.query.format === 'csv') {
        const header = 'day,team,environment,rule,severity,open_findings';
        const lines = findings.map((r) => [r.day, r.team, r.environment, r.rule, r.severity, r.openFindings].map(csvField).join(','));
        return reply.type('text/csv').send([header, ...lines].join('\n') + '\n' as never);
      }
      const { rows: compliance } = await db.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, team, environment, total, compliant FROM compliance_snapshots
         WHERE day >= current_date - 29 ORDER BY day, team, environment`,
      );
      return { generatedAt: new Date().toISOString(), findings, compliance };
    },
  );
};
