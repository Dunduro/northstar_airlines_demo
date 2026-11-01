/**
 * SIMULATED Entra ID sign-in — a stand-in for the real OIDC flow, enabled only with
 * AUTH_MODE=simulated-entra. It issues a JWT shaped like an Entra token (oid, name, groups,
 * roles). Production: the web app does OIDC (auth code + PKCE) against Entra ID and the API
 * validates RS256 tokens against the tenant's JWKS; no login endpoint exists here at all.
 */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { ANALYTICS_SCOPE, ErrorBody, JOBS, groupsFor, rolesFromGroups, type TokenClaims } from '@northstar/shared';
import { HttpError } from '../app.js';

const TokenResponse = Type.Object({
  token: Type.String(),
  claims: Type.Object({ oid: Type.String(), name: Type.String(), groups: Type.Array(Type.String()), roles: Type.Array(Type.String()) }),
  notice: Type.String(),
});

const NOTICE = 'Simulated Entra ID token for the PoC. Not a real identity provider.';

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.deps;

  app.get(
    '/auth/personas',
    {
      schema: {
        tags: ['auth (simulated)'],
        summary: 'People who can sign in with the simulated Entra login',
        response: { 200: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), team: Type.String(), role: Type.String() })) },
      },
    },
    async () => (await db.query(`SELECT id, name, team, role FROM people WHERE status = 'active' ORDER BY name`)).rows,
  );

  app.post(
    '/auth/dev-login',
    {
      schema: {
        tags: ['auth (simulated)'],
        summary: 'Simulated Entra sign-in: a person (user token) or the BI service principal (clientId "bi-feed")',
        body: Type.Object({ personId: Type.Optional(Type.String()), clientId: Type.Optional(Type.Literal('bi-feed')) }),
        response: { 200: TokenResponse, 400: ErrorBody, 403: ErrorBody },
      },
    },
    async (req) => {
      if (req.body.clientId) {
        // App-only token for the BI export: no person, no groups, only the analytics scope.
        const claims: TokenClaims = { oid: 'sp-bi-feed', name: 'BI export (service principal)', groups: [], roles: [ANALYTICS_SCOPE] };
        return { token: app.jwt.sign(claims), claims, notice: NOTICE };
      }
      if (!req.body.personId) throw new HttpError(400, 'personId or clientId is required');
      const { rows } = await db.query('SELECT * FROM people WHERE id = $1', [req.body.personId]);
      const person = rows[0];
      if (!person) throw new HttpError(403, 'Unknown person');
      if (person.status !== 'active') throw new HttpError(403, 'Account disabled in Entra ID (leaver)');
      const groups = groupsFor(person);
      const claims: TokenClaims = { oid: person.id, name: person.name, preferred_username: person.email, groups, roles: rolesFromGroups(groups) };
      await app.accept({ type: 'auth.signin', source: 'entra-simulated', payload: { personId: person.id } }, [{ name: JOBS.onboardingStep }]);
      return { token: app.jwt.sign(claims), claims, notice: NOTICE };
    },
  );
};
