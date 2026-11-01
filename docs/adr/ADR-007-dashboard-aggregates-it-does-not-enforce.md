# ADR-007: The dashboard aggregates; it does not enforce

**Status:** Accepted (2026-10-31)

## Context

There are already strong, specialised checks: SCPs prevent, Checkov checks plans, AWS Config
and Security Hub detect, and the nightly Terraform plan finds drift. A platform dashboard
that re-implements these would be a weaker copy and a second place to maintain rules.

## Decision

The dashboard is an **aggregator**. It normalises signals from drift, policy checks and
Config/Security Hub into one finding model per account, with a link to the original. It owns
only the **platform rules** nothing else covers: baseline or module version still supported,
golden path not deprecated, owner and team set, exception still valid. Enforcement stays in
the preventive (SCP) and proactive (CI policy checks) layers.

## Alternatives considered

- **Dashboard as a policy engine.** One place for all rules sounds tidy, but duplicates
  mature tools and makes the dashboard part of the enforcement path.
- **No dashboard; rely on Security Hub.** Security Hub does not know about teams, golden
  paths, module versions or exceptions with an owner and expiry.

## Consequences

- Positive: small, testable rule set; the original finding is always one click away.
- Positive: if the dashboard is down, nothing becomes less safe; guardrails still apply.
- Negative: normalisation is lossy by design; some detail stays in the source tool.
- Negative: we depend on each source's data quality and latency, and need adapters for each.
