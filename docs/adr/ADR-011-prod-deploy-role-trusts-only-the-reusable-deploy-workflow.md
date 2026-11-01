# ADR-011: The Prod deploy role trusts only the platform's reusable deploy workflow

**Status:** Accepted (2026-10-31)

## Context

We want teams to own their pipelines: their own build and test steps, their own YAML. We also
need every change to Prod to pass policy checks, approval and audit logging. If the deploy
role trusts "any workflow in repo X", a team can edit its YAML and skip the checks.

## Decision

Every account gets a `northstar-deploy` role from the account-baseline module. Its trust
policy accepts only GitHub OIDC tokens issued for the **platform's reusable deploy
workflow**, identified by the `job_workflow_ref` claim.

AWS IAM does not evaluate arbitrary GitHub claims as condition keys, so we **customise the
org's OIDC `sub` claim** to include `repo`, `context` and `job_workflow_ref`
(`PUT /orgs/{org}/actions/oidc/customization/sub`). A token then carries, for example:

`repo:northstar/payments-api:environment:prod:job_workflow_ref:northstar/platform-workflows/.github/workflows/reusable-deploy.yml@refs/tags/v3.1.0`

The trust policy requires `aud = sts.amazonaws.com` and a `StringLike` on
`token.actions.githubusercontent.com:sub` of
`repo:northstar/<team>-*:environment:<env>:job_workflow_ref:northstar/platform-workflows/.github/workflows/reusable-deploy.yml@refs/tags/v*`.
Prod accepts only tagged workflow versions; sandbox and dev also accept `@refs/heads/main`
so the platform team can test unreleased workflow changes. The GitHub environment `prod`
adds the human approval, and the Prod SCP denies anyone except `northstar-platform-baseline`
from changing the deploy role's trust policy.

## Alternatives considered

- **Trust by repository only (`repo:northstar/payments-api:*`).** The common setup, but the
  team controls every step and can bypass checks.
- **Required workflows / rulesets only.** Useful and also used, but they enforce what runs in
  CI, not what can assume a role in AWS.
- **A central deploy service.** Strong control, but it becomes a bottleneck and a target.

## Consequences

- Positive: freedom in the team's pipeline, safety at the boundary. Prod is reachable only
  through the paved road, and editing your own YAML cannot change that.
- Positive: the team prefix scopes accounts to their owning team's repositories.
- Negative: the `sub` customisation is an org-wide setting; it must be managed as code, and
  changing it breaks every trust policy at once if done carelessly.
- Negative: team repositories must follow the `<team>-*` naming convention.
- Negative: platform workflow releases become Prod-critical; tagging and review discipline
  in `platform-workflows` matter as much as in the landing zone.
