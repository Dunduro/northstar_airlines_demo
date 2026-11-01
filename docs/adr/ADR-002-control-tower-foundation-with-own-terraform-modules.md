# ADR-002: Control Tower foundation with our own Terraform modules on top

**Status:** Accepted (2026-10-31)

## Context

A landing zone has a large commodity part (organisation setup, log archive and audit
accounts, org-wide CloudTrail, account vending) and a smaller part where NorthStar is
different (golden paths, the registry, exceptions, rollouts, alert routing). Every line we
own is a line we maintain for years.

## Decision

Use **AWS Control Tower** for the foundation and **Account Factory for Terraform (AFT)** to
vend accounts. AFT also creates the two platform roles in every account:
`northstar-platform-plan` (read-only, for PR plans and nightly drift) and
`northstar-platform-baseline` (apply). On top of that we own versioned Terraform:

- `terraform/org` — OUs, SCP attachments per OU, Identity Center permission sets and the
  role x environment assignment matrix, driven from `registry/accounts.yaml`.
- `terraform/modules/account-baseline` — the per-account baseline (deploy role, tags,
  budget, encryption defaults, S3 public access block).
- `terraform/modules/golden-paths/*` — what product teams consume.

State is **one state per account**: S3 backend with native lockfile locking, KMS-encrypted
and versioned in production; local state in the PoC.

## Alternatives considered

- **Landing Zone Accelerator.** Strong for regulated industries, but heavy and
  CloudFormation/CDK-based; it would split the estate across two IaC tools.
- **Fully custom Terraform.** Total control, but we would rebuild and maintain account
  vending and the security accounts that AWS already supports.
- **One big state for the estate.** Simpler to start, but a broken or locked state blocks
  every account, and plans get slow as the estate grows.

## Consequences

- Positive: we spend effort where the value is; AWS carries the commodity part.
- Positive: blast radius of a broken state is one account; plans run in parallel.
- Negative: Control Tower is opinionated (its own guardrails, its own drift on the landing
  zone itself) and we must work with it, not around it.
- Negative: two places define account-level behaviour (Control Tower controls and our SCPs);
  the README must be clear about which is which.
- Negative: hundreds of states need tooling (matrix jobs, a registry) to stay manageable.
