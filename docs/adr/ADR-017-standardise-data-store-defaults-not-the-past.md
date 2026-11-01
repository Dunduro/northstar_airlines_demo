# ADR-017: Standardise data-store defaults, not the past

**Status:** Accepted (2026-10-31) — design; the modules are a follow-up (architecture section 10)

## Context

NorthStar's estate already runs many database engines: PostgreSQL and MySQL, SQL Server and
Oracle behind vendor applications, MongoDB, Elasticsearch, Redis. A platform team of four to
six cannot operate all of them well, and teams will not move onto a paved road that demands a
database rewrite first. At the same time, every engine needs the same protections: encryption,
private network access, secrets, tags, backups, alarms, data residency.

## Decision

- **Same baseline for every engine, thin engine modules.** A `data-store-baseline` module
  (customer-managed key, security group open only to declared clients, Secrets Manager
  credentials, mandatory tags, the `backup` tag of ADR-016, alarms to the owner, region pinned to
  `me-central-1`) is shared by all engine modules; the engine module adds only what is specific.
- **Tiers.** Paved road: Aurora PostgreSQL (default for new relational workloads, with
  `ecs-service`) and DynamoDB (with `lambda-api`). Supported, module on request on the same
  baseline: RDS SQL Server / Oracle, Aurora MySQL, ElastiCache / Valkey, OpenSearch,
  DocumentDB. Vendor-managed on AWS (MongoDB Atlas, Elastic Cloud via PrivateLink and their
  Terraform providers) where engine compatibility matters, once availability in
  `me-central-1` is confirmed. Custom: self-managed on EC2 by exception.
- **New services default to PostgreSQL; existing applications keep their engine.** The platform
  never forces a database rewrite. Migration rule: move compute first, data later, never both
  at once.
- **Lambda stays with DynamoDB on the paved road.** Lambda → Aurora needs VPC attachment and RDS
  Proxy; deliberately not paved until there is demand.
- **Stateful resources live in the product's deployment repo** (architecture 4.3); `ecs-service`
  attaches through its `database` input.

## Alternatives considered

- **One engine for everything (Postgres only).** Simplest to operate, but forces rewrites of
  vendor and legacy applications, which is the fastest way to lose a migration. Rejected.
- **A module per engine with its own security and backup logic.** Familiar, but the protections
  would drift between engines. Rejected for the shared baseline.
- **Compatible AWS engines as drop-in replacements** (DocumentDB for MongoDB, OpenSearch for
  Elasticsearch). Cheaper to integrate, but compatibility is partial: DocumentDB implements a
  subset of the MongoDB API; OpenSearch diverged from Elasticsearch after 7.10. Offered as
  supported engines, with compatibility tested, not assumed.

## Consequences

- Positive: one review surface for data protection, whatever the engine; adding an engine
  costs a thin module, not a new security model.
- Positive: teams can move onto the paved road without touching their data.
- Negative: the estate keeps several engines for a long time; the supported tier needs real
  expertise when something breaks, and vendor-managed stores add contracts and a second control
  plane.
- Negative: nothing here is built yet; until the modules exist, deployment repos create their
  own clusters and the policy checks on the plan carry the baseline rules.
