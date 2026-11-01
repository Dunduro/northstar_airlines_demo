# ADR-009: Show and link, never broker AWS sessions

**Status:** Accepted (2026-10-31)

## Context

The dashboard has a "My access" view. It could hand out AWS credentials or console sessions
directly, which feels convenient. But a tool that brokers sessions to hundreds of accounts
becomes the most valuable target in the company and a single point of failure during an
incident, exactly when people most need access.

## Decision

The dashboard **shows and links**. It lists each user's role per account (from the
assignment matrix) and links to the IAM Identity Center access portal for that account and
permission set. Entra ID authenticates users into Identity Center **directly** via SAML,
with groups and users provisioned by SCIM. Permission sets: Developer, LeadDeveloper,
PlatformEngineer, SecurityAudit, ReadOnly. Developers get ReadOnly in Prod; platform
engineers reach Prod only through a PIM-activated JIT group
(`aws-platform-engineer-prod-jit`).

## Alternatives considered

- **Dashboard brokers sessions (STS on behalf of users).** Convenient, but crown jewels and a
  single point of failure.
- **No access view at all.** Users rely on the access portal alone and lose the context (open
  findings, last deploy, role) the dashboard adds.

## Consequences

- Positive: if the dashboard is down, everyone can still get into AWS.
- Positive: credentials stay short-lived and issued by AWS; the dashboard holds none.
- Negative: two screens instead of one; the deep link is the bridge.
- Negative (known gotcha): PIM activates a group in Entra, but SCIM provisions in cycles, so
  JIT access can lag in AWS. Mitigations: on-demand provisioning for the activated user, or
  AWS's TEAM solution inside Identity Center.
