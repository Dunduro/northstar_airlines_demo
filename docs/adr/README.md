# Architecture decision records

An ADR records one significant decision: the context, what we chose, what we rejected and
what it costs us. They are short on purpose and are not rewritten when we change our mind; a
new ADR supersedes the old one, and the old one's status says so. To add one, copy the
structure of an existing ADR (Status, Context, Decision, Alternatives considered,
Consequences), take the next free number, and open a pull request; it is reviewed by the
platform team and security (CODEOWNERS) like any other change.

| # | Decision | Status | Summary |
|---|---|---|---|
| 001 | [AWS as the cloud](ADR-001-aws-as-the-cloud.md) | Accepted | Build on AWS; keep the core portable to Azure. |
| 002 | [Control Tower foundation with our own Terraform modules](ADR-002-control-tower-foundation-with-own-terraform-modules.md) | Accepted | AWS vends accounts; we own OUs, SCPs, baseline and golden paths, one state per account. |
| 003 | [TypeScript end to end](ADR-003-typescript-end-to-end.md) | Accepted | One language and toolchain; domain types defined once. |
| 004 | [Fastify with schema-first routes and generated OpenAPI](ADR-004-fastify-schema-first-with-generated-openapi.md) | Accepted | The API is a product; the contract is generated from the route schemas. |
| 005 | [Async by default, with a transactional outbox](ADR-005-async-by-default-with-transactional-outbox.md) | Accepted | Thin API returns 202; idempotent workers with retries and a DLQ. |
| 006 | [Postgres-backed job queue in the PoC, SQS in production](ADR-006-postgres-backed-job-queue-in-the-poc.md) | Accepted | pg-boss shares the outbox transaction; SQS behind the same interface later. |
| 007 | [The dashboard aggregates; it does not enforce](ADR-007-dashboard-aggregates-it-does-not-enforce.md) | Accepted | Normalise existing signals; own only the platform rules. |
| 008 | [No write access to AWS](ADR-008-no-write-access-to-aws.md) | Accepted | Actions are workflow_dispatch; results come back HMAC-signed. |
| 009 | [Show and link, never broker AWS sessions](ADR-009-show-and-link-never-broker-aws-sessions.md) | Accepted | Deep links to Identity Center; the dashboard holds no credentials. |
| 010 | [Entra ID as the only identity provider](ADR-010-entra-id-as-the-only-identity-provider.md) | Accepted | One identity and MFA policy; access via SCIM groups; no Cognito. |
| 011 | [Prod deploy role trusts only the reusable deploy workflow](ADR-011-prod-deploy-role-trusts-only-the-reusable-deploy-workflow.md) | Accepted | `job_workflow_ref` in a customised OIDC `sub`; Prod only via the paved road. |
| 012 | [Long-term reporting goes to BI](ADR-012-long-term-reporting-goes-to-bi.md) | Accepted | Anonymised aggregate feed; no attack map leaves the platform. |
| 013 | [Ports and adapters, with a cloud-agnostic core](ADR-013-ports-and-adapters-cloud-agnostic-core.md) | Accepted | Processes by intent; clouds are adapters. |
| 014 | [The pipeline orchestrates rollouts; the app observes and dispatches targeted actions](ADR-014-pipeline-orchestrates-rollouts.md) | Accepted | `rollout-waves.yml` runs and halts waves; the app mirrors its events; re-apply and retry go through `apply-baseline.yml`. |
| 015 | [Golden paths are language-agnostic](ADR-015-golden-paths-are-language-agnostic.md) | Accepted | Modules see an image digest or a bundle; the language lives in the template and the image; one build workflow per language. |
| 016 | [Backups are an org policy, with an immutable copy in a Backup account](ADR-016-backups-are-an-org-policy-with-an-immutable-copy.md) | Accepted | One `backup` tag; policy per OU; Vault Lock (compliance) copy in the Security OU; weekly restore tests. |
| 017 | [Standardise data-store defaults, not the past](ADR-017-standardise-data-store-defaults-not-the-past.md) | Accepted (design) | Same baseline for every engine; Postgres default for new; existing engines stay; compute first, data later. |
