# Service Control Policies

Preventive guardrails: what cannot happen, whatever IAM says. Attachments live in
`../../org/scps.tf`; the documents here are the source of truth.

| Policy | Attached to | What it does |
|---|---|---|
| `guardrails-baseline.json` | Root (all accounts) | No leaving the org · root user blocked · CloudTrail and Config cannot be stopped or deleted · S3 account public access block cannot be changed |
| `region-allowlist.json` | Root (all accounts) | Only `me-central-1` and `eu-west-1`; global services exempt via `NotAction` |
| `prod-strict.json` | Workloads/Prod, Security, Infrastructure | No IAM users or access keys · deploy role, platform roles and OIDC provider protected · security tooling cannot be disabled · no KMS key deletion · backup vaults, recovery points and the backup role protected · IMDSv2 required |
| `sandbox-isolation.json` | Sandbox | No route to the corporate network · no long-term commitments |
| `deny-all.json` | Suspended | Everything denied (retained for audit) |

Exemptions name exactly two principals: `AWSControlTowerExecution` (Control Tower's own role)
and `northstar-platform-baseline` (the pipeline role that applies the baseline). Nobody else,
including platform engineers, is exempt.

A new or changed SCP is attached to the **PolicyStaging** OU first (`policy_staging_scps` in
`org/variables.tf`), measured there, and then rolled out OU by OU.
