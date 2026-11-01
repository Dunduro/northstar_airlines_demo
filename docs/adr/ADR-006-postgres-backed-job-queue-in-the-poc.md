# ADR-006: Postgres-backed job queue in the PoC, SQS in production

**Status:** Accepted (2026-10-31)

## Context

ADR-005 needs a queue, and the outbox only works if the event and its job are written
atomically. The PoC must run with one command on a laptop, without AWS.

## Decision

In the PoC, use **pg-boss**, a job queue stored in the same PostgreSQL database as the event
log. The outbox write and the enqueue are then literally the same transaction. Workers depend
on a small queue interface (`enqueue`, `work`, retry and dead-letter options), not on pg-boss.
In production, **SQS (with a DLQ)** implements the same interface, fed by an outbox relay.

## Alternatives considered

- **SQS via LocalStack in the PoC.** Closer to production, but adds a component and still
  needs an outbox relay to be correct.
- **Redis-based queue (BullMQ).** Fast and popular, but a second datastore, and no
  transactional link with the event write.
- **pg-boss in production as well.** Viable at our volumes; not chosen because SQS removes an
  operational concern and integrates with the rest of the AWS estate.

## Consequences

- Positive: one database, one less moving part, and correct outbox semantics for free.
- Positive: the interface boundary keeps the production swap small and testable.
- Negative: production behaviour differs in details (visibility timeout, ordering, message
  size); those need their own tests when the SQS adapter is built.
- Negative: the queue shares the database's load and failure domain in the PoC.
