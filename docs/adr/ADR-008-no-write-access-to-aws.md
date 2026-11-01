# ADR-008: No write access to AWS; actions go through pipeline workflow_dispatch

**Status:** Accepted (2026-10-31)

## Context

Operators need to act from the dashboard: re-apply a baseline after drift, retry failed
targets in a rollout. The easy way is to give the dashboard an IAM role that can change
accounts. That would make the dashboard a powerful target and a path around code review.

## Decision

The dashboard has **no write access to AWS**. Every action is a GitHub **`workflow_dispatch`**
on the platform pipeline (for example "re-apply baseline for payments-prod", "retry failed
targets of rollout X"). The pipeline runs the same plan, policy checks and approvals as any
other change, using the platform roles vended per account. Pipelines report results back to
the API on `/v1/events/pipeline`, **signed with an HMAC** header that the API verifies.

## Alternatives considered

- **Dashboard role with scoped write permissions.** Faster feedback, but a second change path
  that skips review, policy checks and the audit trail.
- **Pipelines read results from the API (pull).** Possible, but push from the pipeline is
  simpler and keeps the API passive.

## Consequences

- Positive: one change path; every action is reviewed, policy-checked and auditable in git
  and in Actions logs.
- Positive: compromising the dashboard does not give AWS write access.
- Negative: actions are slower (a pipeline run, not an API call) and depend on GitHub being
  available.
- Negative: the dashboard needs a GitHub App token that can dispatch workflows; that token
  must itself be scoped and rotated. The HMAC secret is shared between GitHub and the API and
  must be rotated too; production would prefer the pipeline's OIDC token.
