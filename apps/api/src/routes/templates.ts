/** The paved road, per language: the template catalog teams pick from (read-only). */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { CATALOG, ErrorBody, TEMPLATES, TemplateInfo } from '@northstar/shared';

const security = [{ bearerAuth: [] }];

const TemplateEntry = Type.Composite([
  TemplateInfo,
  Type.Object({ latestModuleVersion: Type.String({ description: 'Latest release of the golden-path module' }) }),
]);

export const templateRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/templates',
    {
      preHandler: app.requireRole('viewer'),
      schema: {
        tags: ['templates'],
        summary: 'Template catalog: what a team gets per language and golden path (from templates/*/platform.yaml)',
        security,
        response: { 200: Type.Object({ templates: Type.Array(TemplateEntry) }), 401: ErrorBody },
      },
    },
    async () => ({
      templates: TEMPLATES.map((t) => ({ ...t, latestModuleVersion: CATALOG.goldenPaths[t.goldenPath]?.latest ?? 'unknown' })),
    }),
  );
};
