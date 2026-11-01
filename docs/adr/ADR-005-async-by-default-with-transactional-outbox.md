# ADR-005: Async by default, with a thin API and a transactional outbox

**Status:** Accepted (2026-10-31). For rollouts, narrowed by ADR-014 (the pipeline tracks the waves).

## Context

Most inbound traffic is webhooks: pipeline results, drift results, HR membership changes.
Processing them means rule evaluation, calls to GitHub, AWS, Teams and ITSM, and sometimes
long-running work such as a rollout across hundreds of accounts. Senders should not wait on
that, and a slow neighbour (ITSM down) must not take the API down with it. The issue is
behaviour under failure, not volume.

## Decision

The API is **thin**: it validates the request, writes the event and a job **in one database
transaction** (transactional outbox), and returns **202 Accepted**. Workers pick up jobs and
do the work. Every job is idempotent, retried with backoff, and moved to a dead-letter queue
after N attempts, which raises an alert. Multi-step flows (onboarding, rollout waves) are
tracked as workflow state so they can resume.

## Alternatives considered

- **Synchronous processing in the request.** Simplest, but senders time out, retries
  duplicate work, and one slow integration blocks everything.
- **Publish to a queue directly from the API, outside the transaction.** If the process dies
  between "saved" and "queued", the event is silently lost.
- **A workflow engine (Step Functions, Temporal) from day one.** Worth it if workflows grow;
  too much machinery for the PoC.

## Consequences

- Positive: senders never wait; rate limits towards AWS, Azure and GitHub are controlled by
  worker concurrency; failures are visible instead of lost.
- Positive: rollouts become many small, retryable jobs instead of one long request.
- Negative: eventual consistency. The UI has to show "accepted, processing" states, and
  tests have to wait for workers.
- Negative: idempotency is a discipline every job author must follow; it is enforced by
  review and tests, not by the framework.
