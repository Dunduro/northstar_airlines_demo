# ADR-013: Ports and adapters, with a cloud-agnostic core

**Status:** Accepted (2026-10-31)

## Context

NorthStar starts on AWS (ADR-001), but Azure is a likely follow-up. Governance processes,
such as onboard a user, vend an account, apply a baseline, offboard a user, contain an
incident, have the same goal on any cloud; only the steps differ. A design that hard-codes
AWS everywhere would need a rewrite for Azure.

## Decision

Structure the platform as **ports and adapters**. The core owns the cloud-neutral model:
targets (with a `cloud` field), findings, exceptions, rules, alert routing, rollouts,
onboarding, the analytics feed. Adapters translate cloud-specific inputs and outputs:
Config/Security Hub findings, access-portal launch links, golden-path module names, account
vending. Terraform drift is already cloud-neutral (`terraform show -json`).

**In the PoC** the core model is cloud-neutral, but there is no formal adapter interface yet:
the only cloud is AWS (`cloud: 'aws'` in `packages/shared/src/schemas.ts`), and the AWS-specific
inputs arrive as normalised events from the simulator and the pipeline. The ports are
extracted when the second cloud arrives, from two real implementations rather than one.

## Alternatives considered

- **AWS-specific throughout.** Faster to write, expensive to change later.
- **A lowest-common-denominator multi-cloud abstraction.** Hides each cloud's strengths and
  frustrates teams; we normalise only what governance needs and link to the original.

## Consequences

- Positive: Azure becomes a new adapter, not a new platform; the processes and the dashboard
  stay the same.
- Positive: adapters are easy to test in isolation with recorded inputs.
- Negative: an extra layer of indirection once it is extracted; until then the boundary is a
  convention (normalised events in, links out), not an interface the compiler checks.
- Negative: the port interfaces are designed from one cloud's view; the Azure adapter will
  probably force some changes to them. That is expected and acceptable.
