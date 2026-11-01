# ADR-012: Long-term reporting goes to BI, via an anonymised aggregate feed

**Status:** Accepted (2026-10-31)

## Context

Management wants trends over quarters: compliance per business unit, exception debt, golden
path adoption. Building that into the dashboard means a report builder, custom charts and
long-term storage, which the organisation's BI platform already does better. At the same
time, a list of "Prod accounts with open findings" is an attack map and must not spread.

## Decision

The dashboard keeps only **operational, short-term** views (last 30 days). Long-term
reporting goes to the BI platform (assumed Power BI) through a separate, read-only
`/v1/analytics` scope with a daily aggregate feed: counts per team, environment, rule and
severity. No account IDs, resource names, IP addresses or people. Where analysts need to
follow "the same account over time", a keyed hash is used; the key stays with the platform.

## Alternatives considered

- **Reporting inside the dashboard.** Reinvents BI, and grows into a product nobody asked
  the platform team to maintain.
- **Raw data export to the data lake.** Maximum flexibility, but it moves the attack map
  into a system with a wider audience and lower classification.

## Consequences

- Positive: the feed has a low classification and can be shared widely.
- Positive: the BI and data teams use their own tools; the platform stays small.
- Negative: some questions cannot be answered from aggregates; analysts must ask the platform
  team for drill-downs, which is intentional friction.
- Negative: the aggregation schema is a contract with the BI team and needs versioning.
