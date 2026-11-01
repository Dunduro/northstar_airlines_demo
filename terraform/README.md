# Terraform — the landing zone as code

Real, idiomatic Terraform; **simulated execution**. Everything here passes `terraform
validate` and `terraform test` against mocked providers, so no AWS account or credential is
needed to review it. Nothing in this PoC is applied to AWS.

## Layout

```
terraform/
├── registry/accounts.yaml       the account registry — the single source of intent
├── policies/scp/*.json          SCP documents (see policies/scp/README.md)
├── org/                         root: OUs, SCP attachments, Identity Center permission sets
│                                and the role × environment assignment matrix (from the registry),
│                                org backup policies per OU (backup-policy.tf)
├── baseline/                    root: applies account-baseline to ONE account (-var account_name=…)
├── backup/                      root: the Backup account's central vault (Vault Lock, CMK, restore tests,
│                                isolated restore VPC); applied by apply-backup.yml (see backup/README.md)
├── modules/
│   ├── account-baseline/        what every account gets (deploy role, tags, budget, encryption…)
│   └── golden-paths/            language-agnostic modules teams consume (see below, ADR-015)
│       ├── ecs-service/         v2.4.0 Fargate + shared ALB, autoscaling, alarms, Aurora optional
│       ├── lambda-api/          v1.5.0 HTTP API + Lambda (runtime allow-list), DynamoDB optional
│       └── static-site/         v2.0.0 private S3 + CloudFront (OAC), versioned bundles
└── backend/s3.tfbackend         production state backend settings
```

Tests live next to the code they test (`<root-or-module>/tests/*.tftest.hcl`), which is how
`terraform test` discovers them.

**Where to look first (five minutes):**
1. `modules/account-baseline/deploy-role.tf` — the deploy role trust policy (Prod is only
   reachable through the platform's reusable deploy workflow).
2. `policies/scp/` — the guardrails.
3. `org/identity-center.tf` — the access matrix.
4. `org/tests/org.tftest.hcl` and `modules/account-baseline/tests/account_baseline.tftest.hcl`.

## How the pieces fit

- **Registry → org.** `org/` reads `accounts.yaml` with `yamldecode`. Every account gets Identity
  Center assignments according to its environment and team; an unknown OU fails validation.
  Accounts are vended by Control Tower Account Factory (AFT) from the same registry.
- **Registry → baseline.** `baseline/` is one root, run once per account with its own state.
  The registry entry decides the environment profile, tags, cost centre and classification.
- **Backups by tag, per OU.** `org/backup-policy.tf` attaches an AWS Backup policy per
  environment to the Workloads OUs and Infrastructure. A resource opts in with one tag,
  `backup = standard | critical`; the policy decides frequency, retention and whether a copy goes
  to the Backup account's Vault-Locked vault (`backup/`). `account-baseline` gives every account
  the local vault and role the policy names. See architecture "Backup & recovery" and ADR-016.
- **Policies attach to OUs, not accounts.** Moving an account into `Workloads/Prod` gives it
  the Prod guardrails immediately.

### Environment profiles (`account-baseline`)

| | sandbox | dev | test | prod | core |
|---|---|---|---|---|---|
| Monthly budget (USD) | 300 | 1 500 | 2 500 | 10 000 | 5 000 |
| Deploy role trusts platform workflow at | tags, `main` | tags, `main` | tags | tags | tags |
| Log retention (days) | 7 | 30 | 90 | 365 | 365 |

### The deploy role, in one paragraph

Each account's `northstar-deploy` role trusts GitHub OIDC tokens only when the token's
`sub` is `repo:northstar/<team>-*:environment:<env>:job_workflow_ref:northstar/platform-workflows/.github/workflows/reusable-deploy.yml@refs/tags/v*`.
AWS only exposes a fixed set of OIDC claims as condition keys, so the GitHub organisation's
subject template is customised once to include `job_workflow_ref`:

```bash
gh api -X PUT /orgs/northstar/actions/oidc/customization/sub \
  -f 'include_claim_keys[]=repo' -f 'include_claim_keys[]=context' -f 'include_claim_keys[]=job_workflow_ref'
```

Teams own their pipelines; the job that holds AWS credentials is always the platform workflow
(`.github/workflows/reusable-deploy.yml`), with its policy checks, the `prod` environment's
approval and the audit trail. The Prod SCP stops anyone except the baseline pipeline from
changing that trust policy. See ADR-011.

### Identity Center access matrix (`org/identity-center.tf`)

| Entra group (SCIM) | sandbox | dev | test | prod | core |
|---|---|---|---|---|---|
| `aws-<team>-developer` | Developer | Developer | Developer | ReadOnly | — |
| `aws-<team>-lead-developer` | LeadDeveloper | LeadDeveloper | LeadDeveloper | ReadOnly | — |
| `aws-platform-engineer` | PlatformEngineer | PlatformEngineer | PlatformEngineer | ReadOnly | ReadOnly |
| `aws-platform-engineer-prod-jit` (PIM) | — | — | — | PlatformEngineer | PlatformEngineer |
| `aws-security-audit` | SecurityAudit | SecurityAudit | SecurityAudit | SecurityAudit | SecurityAudit |

Team groups only reach their own team's accounts. Nobody deploys to Prod by hand.

## Golden paths

Three modules, one contract: **the module never knows the language** (ADR-015). Containers
arrive as an image digest, Lambda code as a versioned zip with a runtime from an allow-list,
frontends as a versioned bundle prefix. The language lives in the template (`templates/`) and
in the image the platform's build workflow produces.

| Module | Version | Teams pass | The platform builds in |
|---|---|---|---|
| `ecs-service` | 2.4.0 | name, team, owner, cost centre, environment, image digest, size, classification; optional Aurora (`database`) | Fargate service + task definition (read-only root FS, `/tmp`), host rule + target group with `/health`, SG that only trusts the ALB, CPU + request-count autoscaling with an environment floor/cap, log retention by classification, 5xx-rate / p95 / CPU / memory / unhealthy-target alarms to an owner-tagged SNS topic, IAM roles under `/workload/`, DB credentials from Secrets Manager |
| `lambda-api` | 1.5.0 | name, team, …, versioned zip, runtime, optional table | Function (arm64, JSON logs, X-Ray flag, reserved concurrency per environment), HTTP API with throttling and JSON access logs, errors / throttles / p95-duration alarms, optional DynamoDB (PITR, deletion protection in prod) |
| `static-site` | 2.0.0 | name, team, …, bundle version | Private bucket (all public access blocked, ACLs off, TLS only), CloudFront with OAC, security headers, SPA fallback |

Shared infrastructure the modules attach to (VPC, private subnets, ECS cluster
`northstar-<env>`, the account's ALB and HTTPS listener) is discovered through SSM parameters
under `/northstar/`, published by the baseline/network stack — that is why 2.3 → 2.4 added
real resources without changing the module interface. Stateful resources (Aurora) stay in the
product's deployment repo (architecture §4.3); `ecs-service` only wires a service to them.

**Mandatory tags:** `owner` and `cost_centre` were added as optional inputs to keep 2.x
backwards compatible. A `check` block warns when they are missing, and the tag policy check
in `reusable-deploy.yml` rejects such a plan; every template sets them from `platform.yaml`.

**How an artifact reaches a golden path** (build once, deploy many):

```
build-<lang>.yml   test → package → SBOM → scan gate → publish once (ECR digest | s3 zip | s3 prefix)
reusable-deploy    terraform plan -var environment=<env> -var artifact=<that artifact> → Checkov → apply
                   (static-site: the bundle prefix is copied into the site bucket before CloudFront switches)
```

Build jobs publish with `northstar-artifact-publisher` in shared-services, a role that trusts
only the platform build workflows at a release tag from `main`; deploy jobs keep using the
per-account `northstar-deploy` role (ADR-011). The publisher role is described in the
workflows but not yet coded in Terraform (follow-up, shared-services root).

## State

| | PoC | Production |
|---|---|---|
| Where | local (`terraform.tfstate`, git-ignored) | S3 bucket in shared-services, `backend/s3.tfbackend` |
| Granularity | — | **one state per account** (`accounts/<name>.tfstate`) + one for `org/` + one for `backup/` (`backup/terraform.tfstate`) |
| Locking | — | S3 native lockfile (`use_lockfile = true`, Terraform ≥ 1.10; no DynamoDB) |
| Encryption | — | SSE-KMS with a dedicated key; bucket versioned, public access blocked |
| Who can read | — | only the pipeline roles. State can contain secrets, so humans do not read it directly |

One state per account keeps the blast radius of a broken or locked state to one account and
lets plans run in parallel across hundreds of accounts. The roots declare no backend, so they
use local state here; the pipeline adds `backend "s3" {}` through a `backend_override.tf` and
passes the per-account key (`.github/actions/terraform-init`). Jobs that handle a batch of
accounts (the GitHub matrix caps at 256 jobs, see `.github/scripts/batch-accounts.sh`) switch
the key per account with `.github/scripts/init-account.sh`.

## Running it

Requires Terraform ≥ 1.9 (verified locally with 1.9.6; CI pins 1.11.4). No AWS credentials.

```bash
cd terraform
terraform fmt -recursive -check

for d in org baseline backup modules/account-baseline modules/golden-paths/ecs-service \
         modules/golden-paths/lambda-api modules/golden-paths/static-site; do
  (cd "$d" && terraform init -backend=false -input=false >/dev/null && terraform validate && \
    { [ -d tests ] && terraform test || true; })
done
```

What the tests prove (all against mock providers):

| Test | Proves |
|---|---|
| `org` · `prod_gets_the_stricter_scp` | `prod-strict` is attached to the Prod OU and not inherited by Dev/Test |
| `org` · `baseline_guardrails_and_region_list_apply_everywhere` | every OU inherits the region allow-list (exactly `me-central-1`, `eu-west-1`) and baseline guardrails; Suspended is deny-all |
| `org` · `registry_drives_access_assignments` | developers: Developer in Dev, ReadOnly in Prod; admin in Prod only via the JIT group; no cross-team access |
| `org` · `adding_a_registry_entry_adds_its_access` | a fixture registry with two accounts produces exactly their assignments |
| `org` · `unknown_ou_is_rejected` | a registry entry with an unknown OU fails validation |
| `org` · `backups_follow_the_ou_and_copy_prod_to_the_central_vault` | prod policy on the Prod OU, none on Sandbox/Security, every prod rule copies to the Backup account's vault, dev keeps tier 1 only, tag `backup` selects, me-central-1 only, copy retention inside the Vault Lock bounds, cross-account backup enabled |
| `org` · `no_backup_account_means_no_copy_target` | without a Backup account in the registry there is no copy target and the check fires |
| `account-baseline` · `prod_deploy_role_trusts_only_the_platform_deploy_workflow` | one trust statement, GitHub OIDC only, `aud` = STS, `sub` pinned to team repos + `environment:prod` + `job_workflow_ref` of the platform workflow at a tag |
| `account-baseline` · `dev_also_trusts_unreleased_platform_workflow_from_main` | Dev's profile differs, yet still requires the platform workflow |
| `account-baseline` · `mandatory_tags_are_present` | `cost-centre`, `owner`, `environment`, `team`, `data-classification` on taggable resources |
| `account-baseline` · `account_guardrails_follow_the_prod_profile` | EBS encryption by default, S3 account public access block, prod budget |
| `account-baseline` · `invalid_inputs_are_rejected` | bad classification / cost centre fail validation |
| `account-baseline` · `tier_one_backups_land_in_an_encrypted_local_vault` | `northstar-local` vault with the account key, role only AWS Backup can assume, key not shared without a Backup account, tags |
| `account-baseline` · `backup_account_may_use_the_key_for_snapshot_copies_only` | the Backup account may use (not administer) the account key, so encrypted Aurora/RDS copies work |
| `backup` · nine runs | Vault Lock in compliance mode (7..400 days), own rotating CMK usable by org accounts only via AWS Backup, vault policy allows only `CopyIntoBackupVault` from the org, weekly Aurora restore test from the central vault into the restore VPC's subnet group and security group, restore VPC with no internet gateway / NAT / TGW attachment / peering and an empty route table, private subnets in ≥ 2 AZs, security group ingress only from itself (no CIDR, so no `0.0.0.0/0`) and an empty default group, non-UAE region, a lock without grace period and a single-AZ restore network rejected |
| `baseline` · three runs | the registry entry drives the profile and the Backup account id; unknown accounts and unapproved regions are rejected |
| `ecs-service` · ten runs | prod min capacity ≥ 2 (dev capped), CPU + request-count scaling, ingress only from the ALB SG and no public IP, `/health` check + circuit-breaker rollback, five alarms on the owner-tagged topic, retention by classification, mandatory tags, Aurora credentials only via Secrets Manager, invalid image/port/secret-looking env rejected |
| `lambda-api` · eleven runs | reserved concurrency per profile, X-Ray flag, exact versioned bundle, JSON logs, three alarms, HTTP API wiring + correlation id in access logs, retention, tags, table PITR/deletion protection/`backup` tag, PHP via `provided.al2023` + layer, unsupported runtime (`nodejs16.x`) and bad artifact/timeout rejected |
| `static-site` · six runs | bucket not public (four blocks, ACLs off, only this distribution via OAC `SourceArn`), serves `/releases/<version>`, HTTPS redirect, security headers, tags, `latest` / confidential data / alias without certificate rejected |

## Real vs simulated

| Real | Simulated / out of scope in the PoC |
|---|---|
| SCP documents, OU structure, attachments | No AWS organisation: providers are mocked |
| Identity Center permission sets and the assignment matrix | Entra groups are looked up by name; SCIM itself is Entra-side config |
| Account baseline: deploy role + OIDC provider, tags, budget, KMS, EBS default encryption, S3 public access block, observability link, local backup vault + backup role | Control Tower / AFT (account vending, org CloudTrail, Config, log archive) is assumed, not coded |
| Org backup policies, central vault with Vault Lock, vault key and policy, restore testing plan, isolated restore VPC, the Backup account's plan/apply pipeline (`apply-backup.yml`) | Enabling the `BACKUP_POLICY` policy type on the root (one-time switch, warned by a `check`), forwarding restore results to the dashboard as findings (architecture section 10) |
| Golden-path modules: ECS service, task definition, target group, listener rule, autoscaling, alarms, SNS, Lambda, HTTP API, DynamoDB, S3 + CloudFront | The shared VPC, ECS cluster, ALB and Aurora clusters they attach to (read from SSM / inputs; owned by the network stack and deployment repos) |
| Templates (`templates/`): apps, Dockerfiles, `infra/`, pipelines | `templates/*/infra` reference the private registry, so they are only `fmt`-checked here |
| GitHub Actions workflows (`.github/workflows/`) | Not run against AWS; they need `PLATFORM_PIPELINE_ROLE_ARN`, `PLATFORM_API_URL` and `PLATFORM_WEBHOOK_SECRET`, and the GitHub environments (`lz-<wave>`, `lz-backup`) with their protection rules |

Known simplifications, stated honestly: the baseline is applied in the home region only
(production runs it per approved region for the regional settings); the deploy role uses
`PowerUserAccess` plus a path-scoped IAM statement, where production would add a permissions
boundary for workload roles; sandbox budgets alert but do not yet hard-stop (budget actions).
