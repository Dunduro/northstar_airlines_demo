/** Inbound webhooks from the pipeline (GitHub Actions) and HR / Entra. HMAC-signed, answer 202. */
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { Accepted, ErrorBody, JOBS, MembershipEvent, PipelineEvent } from '@northstar/shared';
import { SIGNATURE_HEADER, verify } from '@northstar/shared/hmac';
import { HttpError } from '../app.js';

export const verifySignature = (secret: string) => async (req: FastifyRequest) => {
  if (!verify(req.rawBody ?? '', req.headers[SIGNATURE_HEADER] as string | undefined, secret)) {
    throw new HttpError(401, 'Invalid or missing webhook signature');
  }
};

const responses = { 202: Accepted, 400: ErrorBody, 401: ErrorBody };

export const eventRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const preValidation = verifySignature(app.deps.config.webhookSecret);

  app.post(
    '/events/pipeline',
    {
      preValidation,
      schema: {
        tags: ['events'],
        summary: 'Pipeline result: registry sync, plan, apply, drift, Config findings, rollout started / wave completed',
        security: [{ hmac: [] }],
        body: PipelineEvent,
        response: responses,
      },
    },
    async (req, reply) => {
      const ev = req.body;
      const jobs: { name: string }[] = [];
      const isRollout = ev.type === 'rollout.started' || ev.type === 'wave.completed';
      if (!isRollout) jobs.push({ name: JOBS.evaluateTarget });
      if (isRollout || (ev.type === 'apply.result' && ev.rolloutId)) jobs.push({ name: JOBS.projectRollout });
      const eventId = await app.accept({ type: ev.type, source: 'pipeline', payload: ev }, jobs);
      return reply.status(202).send({ accepted: true, eventId });
    },
  );

  app.post(
    '/events/membership',
    {
      preValidation,
      schema: {
        tags: ['events'],
        summary: 'HR / Entra membership change: joiner, mover, leaver',
        security: [{ hmac: [] }],
        body: MembershipEvent,
        response: responses,
      },
    },
    async (req, reply) => {
      const ev = req.body;
      if (ev.type === 'joiner' && (!ev.person.name || !ev.person.team)) throw new HttpError(400, 'joiner needs person.name and person.team');
      const eventId = await app.accept({ type: `membership.${ev.type}`, source: 'hr', payload: ev }, [{ name: JOBS.onboardingStep }]);
      return reply.status(202).send({ accepted: true, eventId });
    },
  );
};
