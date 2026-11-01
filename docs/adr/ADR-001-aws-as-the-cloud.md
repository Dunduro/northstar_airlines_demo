# ADR-001: AWS as the cloud

**Status:** Accepted (2026-10-31)

## Context

NorthStar needs one landing zone design and a working proof of concept in a short time. The
case allows either AWS or Azure. Whatever we pick, the governance model (registry, guardrails,
identity, golden paths, drift, exceptions) has to carry over to a second cloud later, because
large estates rarely stay single-cloud.

## Decision

Build the landing zone and the PoC on **AWS**: Organizations and OUs, Control Tower, SCPs,
IAM Identity Center, Config and Security Hub. Keep the governance core cloud-agnostic (see
ADR-013) so Azure becomes an adapter, not a rewrite. Appendix B of the architecture maps
every AWS building block to its Azure equivalent.

## Alternatives considered

- **Azure first.** Equally valid technically (management groups, Azure Policy, subscription
  vending). Not chosen because the team's operating experience is deepest on AWS, and depth
  matters more than breadth for the first landing zone.
- **Both clouds in the PoC.** Doubles the surface for little extra insight; the cloud-neutral
  core model (ADR-013) makes the point without building the second cloud.

## Consequences

- Positive: realistic, idiomatic Terraform and policies rather than a generic sketch; the
  design decisions come from operating experience, not only from documentation.
- Positive: Organizations' OU inheritance gives a clean "policy follows placement" model.
- Negative: the Azure story is a mapping table and a cloud-neutral model, not running code. The claim
  that it ports cleanly is a design argument until the follow-up project proves it.
- Negative: some AWS specifics (SCP size limits, IAM OIDC condition keys) leak into the
  baseline module; they stay in the AWS-specific layer, but they exist.
