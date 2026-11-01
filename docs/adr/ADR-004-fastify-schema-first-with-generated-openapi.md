# ADR-004: Fastify with schema-first routes and generated OpenAPI

**Status:** Accepted (2026-10-31)

## Context

The API is not only the backend of the dashboard. HR integrations, ITSM, pipelines, internal
tools and an MCP server all call it. That makes the API a product with consumers we do not
control, and its contract has to be explicit, validated and stable.

## Decision

Use **Fastify** and declare every route with a request and response schema. Fastify validates
requests against the schema, and the **OpenAPI document is generated from the same schemas**.
CI writes `apps/api/openapi.json` and diffs it, so a breaking change shows up in review. The
API is versioned under `/v1`.

## Alternatives considered

- **Express with hand-written OpenAPI.** Familiar, but the spec and the code are two sources
  of truth and they drift.
- **NestJS.** Generates OpenAPI too, but brings a large framework and decorator-heavy style
  for a deliberately thin API.
- **GraphQL.** Flexible for the UI, but a worse fit for webhook senders and for consumers
  that just want a typed REST client.

## Consequences

- Positive: one source for validation, types and documentation; typed clients can be
  generated in any language.
- Positive: breaking changes are visible in the PR diff, not discovered by a consumer.
- Negative: schema definitions add some verbosity to every route.
- Negative: we depend on Fastify's plugin ecosystem for Swagger generation; acceptable, it is
  mature and widely used.
