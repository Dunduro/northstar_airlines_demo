/** My access (show and link, never broker), the onboarding wizard, and the people list. */
import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import {
  Accepted,
  ErrorBody,
  JOBS,
  MyAccess,
  Onboarding,
  OnboardingSubmit,
  Person,
  identityCenterLink,
  validatePublicKey,
} from '@northstar/shared';
import { HttpError } from '../app.js';

const security = [{ bearerAuth: [] }];

const assertSelfOrAdmin = (req: FastifyRequest, personId: string) => {
  if (req.user.oid !== personId && !req.user.roles.includes('admin')) throw new HttpError(403, 'You can only see your own onboarding');
};

export const peopleRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { db } = app.deps;
  const viewer = app.requireRole('viewer');

  app.get(
    '/me/access',
    {
      preHandler: viewer,
      schema: {
        tags: ['access'],
        summary: 'My roles per account with IAM Identity Center deep links. The platform shows and links; it never brokers AWS sessions.',
        security,
        response: { 200: MyAccess, 404: ErrorBody },
      },
    },
    async (req) => {
      const { rows: people } = await db.query('SELECT * FROM people WHERE id = $1', [req.user.oid]);
      if (!people[0]) throw new HttpError(404, 'No person record for this identity');
      const { rows } = await db.query(
        `SELECT g.permission_set, t.id, t.name, t.environment FROM access_grants g JOIN targets t ON t.id = g.target_id
         WHERE g.person_id = $1 AND g.status = 'active'
         ORDER BY array_position(ARRAY['sandbox','dev','test','prod','core'], t.environment), t.name`,
        [req.user.oid],
      );
      return {
        person: { id: people[0].id, name: people[0].name, team: people[0].team },
        appRoles: req.user.roles,
        accounts: rows.map((r) => ({
          targetId: r.id,
          name: r.name,
          environment: r.environment,
          permissionSet: r.permission_set,
          launchUrl: identityCenterLink(r.id, r.permission_set),
        })),
        note: 'Sign-in happens at IAM Identity Center with Entra ID (MFA). Prod write access is just-in-time via PIM, never standing.',
      };
    },
  );

  app.get(
    '/onboarding/:personId',
    {
      preHandler: viewer,
      schema: {
        tags: ['onboarding'],
        summary: 'Onboarding wizard state (or, for a leaver, every door that was closed)',
        security,
        params: Type.Object({ personId: Type.String() }),
        response: { 200: Onboarding, 403: ErrorBody, 404: ErrorBody },
      },
    },
    async (req) => {
      assertSelfOrAdmin(req, req.params.personId);
      const { rows } = await db.query(
        `SELECT p.*, o.steps, o.closed_doors FROM people p JOIN onboarding o ON o.person_id = p.id WHERE p.id = $1`,
        [req.params.personId],
      );
      if (!rows[0]) throw new HttpError(404, 'No onboarding for this person');
      const r = rows[0];
      return {
        person: { id: r.id, name: r.name, email: r.email, team: r.team, role: r.role, status: r.status },
        steps: r.steps,
        closedDoors: r.closed_doors,
      };
    },
  );

  app.post(
    '/onboarding/:personId',
    {
      preHandler: viewer,
      schema: {
        tags: ['onboarding'],
        summary: 'Submit a wizard step (public SSH key, GitHub username, VPN profile, access review)',
        security,
        params: Type.Object({ personId: Type.String() }),
        body: OnboardingSubmit,
        response: { 202: Accepted, 400: ErrorBody, 403: ErrorBody },
      },
    },
    async (req, reply) => {
      if (req.user.oid !== req.params.personId) throw new HttpError(403, 'Only the person themselves can complete their onboarding');
      if (req.body.step === 'device_key') {
        const v = validatePublicKey(req.body.publicKey);
        if (!v.ok) throw new HttpError(400, v.reason);
      }
      const eventId = await app.accept(
        { type: 'onboarding.step', source: `dashboard:${req.user.oid}`, payload: { personId: req.params.personId, submit: req.body } },
        [{ name: JOBS.onboardingStep }],
      );
      return reply.status(202).send({ accepted: true, eventId });
    },
  );

  app.get(
    '/people',
    {
      preHandler: app.requireRole('admin'),
      schema: { tags: ['onboarding'], summary: 'People known to the platform (joiners and leavers)', security, response: { 200: Type.Array(Person) } },
    },
    async () => (await db.query('SELECT id, name, email, team, role, status FROM people ORDER BY status, name')).rows,
  );
};
