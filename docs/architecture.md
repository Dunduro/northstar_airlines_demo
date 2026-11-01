# NorthStar Airlines — Landing Zone & Governance Architecture

Case study: Senior Technical Engineer, Public Cloud.
Cloud: **AWS**. Status: design + proof of concept (simulated accounts).

---

## 0. Principle: the paved road

A platform is only as good as the work it takes off other people's plates.

The platform team builds a safe, easy default route. Teams that follow it get speed — an
account, access and a pipeline in minutes. The organisation gets safety built in. Security
is the path of least resistance, not a gate at the end.

Every design decision below is measured against two questions:
1. Does it make a product team's job easier?
2. Does it keep the company safe without a human having to remember something?

---

## 1. Landing zone architecture

### 1.1 Foundation: build or buy

| Option | Pros | Cons |
|---|---|---|
| AWS Control Tower + Account Factory for Terraform (AFT) | Managed, AWS-supported guardrails, fast start | Less flexible, opinionated |
| Landing Zone Accelerator (LZA) | AWS reference for regulated industries | Heavy, CloudFormation/CDK-based |
| Fully custom Terraform | Total control | Everything is ours to maintain |

**Choice:** Control Tower as the foundation (account vending, baseline guardrails, log
archive), with **our own versioned Terraform modules** for the account baseline and the
golden paths. Managed where it can be, custom where it has to be.

**What Control Tower gives us — and what we deliberately do not rebuild:**

| Control Tower provides | Our platform adds on top |
|---|---|
| Landing zone setup: Security OU, Log Archive and Audit accounts, org-wide CloudTrail | Golden paths: templates, modules, reusable workflows per application type |
| Account Factory (and AFT for Terraform-driven vending) | The registry as the single source of intent: owner, team, environment, flavour |
| Controls library: preventive (SCP/RCP), detective (Config), proactive (CFN hooks) | Release management: artifact promotion, waves, rollback |
| Compliance status of its controls per OU/account | Exceptions with owner and expiry, escalation, exception debt |
| Drift detection of the landing zone itself | Drift of **workloads** (Terraform), module version tracking |
| IAM Identity Center wiring | Joiner/mover/leaver from HR, onboarding wizard, "my access" with context |
| | Alert routing to the owning team, ITSM and Teams integration, analytics feed |

Control Tower governs **accounts**. The platform governs **how teams build and run software in
them** — and surfaces Control Tower's control status in the same dashboard instead of competing
with it.

### 1.2 Organisation structure (OUs)

```
Root (management account — billing and org policies only, no workloads)
├── Security
│   ├── Log Archive       org CloudTrail, Config history, S3 Object Lock (immutable)
│   ├── Audit             delegated admin for Security Hub, GuardDuty, Config aggregator
│   └── Backup            central backup vault, Vault Lock (compliance mode), restore tests
├── Infrastructure
│   ├── Network           Transit Gateway hub, central egress + inspection, Route 53 Resolver
│   └── Shared Services   CI/CD runners, IPAM, golden AMIs, ECR, platform dashboard
├── Workloads
│   ├── Dev
│   ├── Test
│   └── Prod              strictest guardrails
├── Sandbox               experimentation, hard budget cap, no network connectivity
├── Policy Staging        new SCPs and guardrails are tested here before they reach Prod
└── Suspended             decommissioned accounts, deny-all SCP, retained for audit
```

Policies attach to **OUs, not accounts**: an account moved into `Workloads/Prod` inherits
the Prod guardrails immediately. That is what makes hundreds of accounts manageable.

### 1.3 Guardrails in three layers

| Layer | Purpose | Mechanism | Examples |
|---|---|---|---|
| **Preventive** | It cannot happen | Service Control Policies (cap identities) + Resource Control Policies (cap external access to resources) | Approved regions only · CloudTrail/Config cannot be disabled · no public S3 · no leaving the org · root user blocked |
| **Proactive** | Caught before deploy | Policy checks on every Terraform plan in the PR (Checkov / OPA) | Encryption on, mandatory tags, no `0.0.0.0/0` ingress in Prod |
| **Detective** | Noticed if it happens anyway | AWS Config rules org-wide, Security Hub, GuardDuty | Drift, misconfiguration, threats → findings into the dashboard and ITSM |

Guardrails get stricter per environment: Sandbox < Dev < Test < Prod.

### 1.4 Governance model: who decides what

Technology enforces the rules; the governance model decides who makes them.

**Shared responsibility**

| Platform team owns | Product teams own |
|---|---|
| OU structure, guardrails, account baseline | Their workloads and data |
| Golden path modules and their upgrades | Choosing a flavour, staying within a supported version |
| Identity, networking, logging, security tooling | Fixing findings in their accounts |
| The exception process | Requesting exceptions, with an owner and expiry date |

**Policy lifecycle** — a guardrail is code, so it changes like code:
1. Proposed as a PR (by platform, security or a product team).
2. Reviewed by platform + security (CODEOWNERS).
3. Applied to the **Policy Staging OU**; impact measured (what would it block or flag?).
4. Rolled out in waves: Sandbox → Dev → Test → Prod, **detect-only first, then enforce**.
5. Announced in advance to affected teams, with the fix path.

**Account lifecycle**

Request (dashboard / PR) → vended by Account Factory → baseline applied → moved into its OU
→ in use → decommission request → **Suspended OU** (deny-all, retained for audit) → closed.

**Measuring the platform**

- % of accounts fully compliant, per environment
- Time to provision a new account (target: minutes, not days)
- Mean time to remediate drift and findings
- Number of open and expired exceptions
- Adoption of golden paths vs custom setups

### 1.5 Networking

- **Hub-and-spoke** via Transit Gateway in the Network account; workload VPCs are spokes.
- **Central egress and inspection** (NAT + AWS Network Firewall) — one place to control
  outbound traffic.
- **IPAM** allocates non-overlapping CIDRs to every new VPC automatically.
- **Hybrid connectivity** to existing data centres via Direct Connect (with VPN backup),
  so cloud and on-prem are one routed network.
- **VPC endpoints** for AWS services; private DNS via Route 53 Resolver.
- Dev/Test and Prod spokes sit in **separate route tables** — no Dev-to-Prod path.

### 1.6 Data residency and protection

- Region allow-list by SCP (e.g. `me-central-1` UAE plus explicitly approved regions per
  workload class).
- Encryption by default: KMS keys per account, default EBS encryption, S3 Block Public
  Access at the org level.
- Backups org-wide via AWS Backup policies, selected by one `backup` tag, with an immutable
  copy in the Backup account — see section 3.3.
- Secrets in Secrets Manager / Parameter Store, never in code or pipeline variables.

### 1.7 FinOps built into the baseline

- **Tag policies:** `cost-centre`, `owner`, `environment`, `data-classification` mandatory.
  Enforced in two places: an org tag policy, and the policy check on every plan
  (`reusable-deploy.yml`).
- **Budget per account** with alerts to the owning team (in `account-baseline`, sized per
  environment); anomaly detection org-wide.
- **Cost per team to BI:** cost and usage data grouped by the `cost-centre` and `team` tags goes
  to the BI platform (e.g. Power BI), next to the compliance feed (5.8). Teams see their own
  spend; nobody builds a cost dashboard into the platform.
- Sandbox accounts have hard budget caps and auto-cleanup.

*In the PoC:* the budget, the mandatory tags on baseline resources and the tag checks in the
golden-path modules are coded; the org tag policy, anomaly detection and the cost export are
design.

---

## 2. Identity & access

### 2.1 One identity provider

**Microsoft Entra ID** as the single source of identity (assuming NorthStar runs
Microsoft 365). The design uses only open standards — SAML, OIDC, SCIM — so it works the
same with Okta or any other IdP.

```
HR system ──(webhook / SCIM)──► Entra ID ──SCIM + SAML──► AWS IAM Identity Center
                                   │──OIDC──► Platform dashboard
                                   │──SAML──► GitHub Enterprise
                                   └──SAML──► AWS Client VPN
```

No Cognito: every user is an employee who already exists in Entra ID. A second user store
adds complexity and another place a leaver can be forgotten. (Cognito / Entra External ID
belongs with customer-facing apps, e.g. a passenger portal.)

### 2.2 Roles, not people (RBAC + ABAC)

Permissions are defined once per **role** and assigned to **groups**. Nobody has personal
permissions, so joining, moving and leaving is a group change.

| Role | Dev | Test | Prod |
|---|---|---|---|
| Developer | Deploy, debug, logs | Deploy, logs | Read-only, logs |
| Lead developer | + approve changes | + approve changes | Deploy via pipeline only (JIT) |
| Platform engineer | Admin | Admin | Admin (JIT, logged) |
| Security / audit | Read-only + security tooling, everywhere | | |
| Break-glass | — | — | Emergency only, hardware key, alert on use |

**ABAC on top:** the role decides *what*, the team decides *where* — via tags on the
account (`team=payments`) and on the user. Five roles stay five roles, however many teams
and accounts there are.

### 2.3 Authentication

- **MFA enforced at the IdP** with Conditional Access — once, for AWS, GitHub, VPN and the
  dashboard. Applications do not implement their own MFA.
- **Phishing-resistant MFA (passkeys / FIDO2)** mandatory for any role that can touch Prod.
- **Just-in-time Prod access** with Entra Privileged Identity Management: no standing write
  access to Prod; access is requested, approved, time-boxed and logged.
- **Break-glass:** two accounts outside SSO, hardware keys in a safe, every use alerts.

### 2.4 Machine identities

- CI/CD authenticates to AWS via **GitHub OIDC** — no long-lived keys anywhere.
- The account baseline creates a **deploy role** in every account that only the pipeline can
  assume. One pipeline can therefore roll changes out to hundreds of accounts.

### 2.5 Getting into AWS: show and link, never broker

Entra ID logs users into AWS **directly**, through IAM Identity Center:

```
User ──► dashboard "My access": Payments-Prod · ReadOnly · [Open]
            │ deep link to the Identity Center portal for that account + role
            ▼
     IAM Identity Center ──SAML──► Entra ID (MFA, Conditional Access) ──► back
            ▼
     AWS console / `aws sso login` with short-lived credentials
```

- Entra handles authentication and MFA (SAML); SCIM keeps users and groups in sync.
- The dashboard **shows and links; it never brokers sessions.** A tool that hands out AWS
  sessions would be the company's most valuable target and a single point of failure — if the
  dashboard is down, everyone can still get into AWS, including during an incident.
- **Known gotcha with just-in-time access:** PIM activates a group membership in Entra, but SCIM
  provisioning runs in cycles, so the AWS side can lag. Mitigations: on-demand provisioning for
  the activated user, or AWS's temporary elevated access solution (TEAM) inside Identity Center.

For whoever builds and runs it, Entra is the same model as any OIDC provider:

| Keycloak | Entra ID |
|---|---|
| Realm | Tenant |
| Client | App registration |
| Client roles | App roles |
| Groups → token claims | Groups → token claims |

### 2.6 Joiner / mover / leaver

1. **Joiner:** HR adds someone to a team → Entra group membership → SCIM provisions access
   in Identity Center → the person receives an onboarding link to the platform dashboard.
2. **Onboarding wizard:** sign in with SSO, register the device's public SSH key, link GitHub,
   download the VPN profile, see "your access" with launch links to the AWS access portal.
3. **Mover:** team change → group change → access follows automatically, old access removed.
4. **Leaver** — target: sign-in blocked at once, **every door closed and verified within
   15 minutes**. *Design, not built in the PoC.* Event-driven, not waiting for sync cycles:
   1. **HR leaver event** → Entra **disables the account and revokes sign-in sessions**
      (refresh tokens). No new sign-in anywhere from this moment.
   2. **Provisioning now, not in ~40 min:** a platform worker triggers Entra
      **provision-on-demand** for that user, so the deprovisioning reaches Identity Center
      without waiting for the next SCIM cycle.
   3. **AWS — sessions already issued:** a deny entry for that Identity Center user ID in an
      **org-root SCP** revokes already-issued permission-set sessions across all accounts at
      once; the entry is removed automatically after the maximum session duration. Prod
      permission sets have a maximum session of 1 hour, which bounds the list.
   4. **GitHub:** the user is suspended via the API (Enterprise Managed Users: tokens and SSH
      keys die with the account).
   5. **VPN:** re-authenticates against Entra on every connection; the platform drops any
      active tunnel for that user.
   6. **SSH keys:** the platform deletes the user's registered public keys.
   7. **Verified, not assumed:** the dashboard keeps a checklist per leaver with a timestamp
      per door, and alerts if any door is still open after 15 minutes.

   The size of the platform team is irrelevant here: this is built once, and every leaver goes
   through the same automation. Volume is tens per day.

   **Assumptions to verify:** Entra provision-on-demand via the Graph API for a single user
   (rate limits, and that it processes a disabled user as a deprovision), and the
   `identitystore:UserId` condition key for denying an Identity Center user's existing
   sessions in an SCP.

**Next step beyond the PoC:** replace static SSH keys with device-bound keys (`ed25519-sk`,
Secure Enclave) or short-lived SSH certificates issued after SSO login.

---

## 3. Standardised infrastructure: golden paths

A small menu of versioned Terraform modules teams pick off the shelf.

| Tier | Flavour | For | Platform team's role |
|---|---|---|---|
| **Paved road** | Containers: ECS Fargate + ALB, attaches to Aurora | Standard web apps and APIs | Fully owned: monitoring, patching built in; backups via the org policy (3.3) |
| | Serverless: Lambda + API Gateway + DynamoDB | Event-driven, integrations | Fully owned |
| | Static: S3 + CloudFront | Frontends, documentation | Fully owned |
| **Supported** | EKS | Teams that genuinely need Kubernetes | Cluster owned by platform; workloads by the team |
| **Custom** | EC2 | Legacy, vendor software, licensing | Guardrails yes, standardisation limited; team owns more |

**EC2 on stricter terms:** golden AMIs (EC2 Image Builder, rebuilt monthly), no SSH — access
via SSM Session Manager only, patching via SSM Patch Manager, mandatory agents, an exception
with an owner and an expiry date, and a migration path to the paved road where possible.

**Versioned modules:** a fix in `ecs-service` ships as a new version; one upgrade PR rolls it
out to every team on that path. The dashboard shows which version each account runs, so an
outdated module is visible work.

**Templates per language:** the golden paths are language-agnostic — the language lives in
the template and the container image (ADR-015). `templates/` has a starter per flavour and
language (Node, PHP/Symfony, .NET, Python on `ecs-service`; Node and Python on `lambda-api`;
React on `static-site`), each with `/health`, structured logs with a correlation id,
`platform.yaml`, `infra/` calling the module from the registry, and pipelines that call the
platform's build and deploy workflows; see `templates/README.md` for the catalog and the
decision tree.

### 3.1 Observability built into every golden path

Teams get logging, metrics and error reporting without doing anything:

- **Structured logging** in one JSON format with mandatory fields: `service`, `team`,
  `environment`, `version`, `correlation_id`. Correlation IDs flow across service calls so one
  request can be followed through the whole chain.
- **Default alarms per flavour:** the `ecs-service` module creates error-rate, latency,
  CPU/memory and unhealthy-target alarms itself, routed to the owner from the registry.
- **Error reporting** groups errors and sends them to the owning team through the same alert
  routing as drift and findings — one alerting model, not two.
- **Central, cross-account:** CloudWatch cross-account observability into a central monitoring
  account, visualised in Grafana (or the organisation's existing tooling — see Appendix A).
- **Data protection:** retention per data classification; PII scrubbing in the logging library.
- **Into the incident process:** severity 1 and 2 alarms become incidents in the existing
  ITSM/EMS process automatically.


### 3.2 Data stores: standardise the defaults, not the past

Compute is the paved road's easy half; data is where a platform can do damage. The platform
does not try to run every database. The design standardises what **every** data store gets, whatever
the engine — customer-managed KMS key, network access only from declared clients, credentials in
Secrets Manager, mandatory tags, the `backup` tag that puts it under the org backup policy
(3.3), default alarms to the owner, region pinned to `me-central-1` — and keeps the
engine-specific part thin (ADR-017).

| Tier | Engines | Notes |
|---|---|---|
| **Paved road** | **Aurora PostgreSQL** — the default for new relational workloads (with `ecs-service`) | JSONB, full-text search and `pgvector` cover much of what used to need a second engine. Teams attach an existing cluster today; the engine module is a follow-up (10) |
| | **DynamoDB** — with `lambda-api` | HTTP API, no connection pool: the natural pair for Lambda |
| **Supported** (module on request, same baseline) | RDS SQL Server / Oracle (licensing, vendor apps), Aurora MySQL, ElastiCache / Valkey, OpenSearch, DocumentDB | DocumentDB is MongoDB-*compatible*, not MongoDB; OpenSearch forked from Elasticsearch 7.10 and has diverged since. Test compatibility, do not assume it |
| **Vendor-managed on AWS** | MongoDB Atlas, Elastic Cloud — over PrivateLink, managed with their official Terraform providers | Where real engine compatibility matters. Same baseline concepts: private connectivity, secrets, tags, backups. Availability in `me-central-1` must be confirmed per vendor before it is offered |
| **Custom** | Self-managed on EC2 | By exception, with an owner and an expiry date, like any EC2 workload |

**Policy.**
- New services default to PostgreSQL. **Existing applications keep their engine**: the platform
  never forces a database rewrite to get onto the paved road.
- **Migration rule: move compute first, data later — never both at once.** A team moves its
  app onto `ecs-service` against the database it already has; the engine question comes later,
  on its own merits, if ever.
- Stateful resources live in the product's **deployment repo**, not the app repo (4.3):
  stricter review, deletion protection, a frontend PR can never touch the database.
  `ecs-service` only attaches to a database through its `database` input.

**Lambda and data.** Lambda functions are stateless and scale to many concurrent instances, so
`lambda-api` pairs with DynamoDB (HTTP, no connection pool). Lambda → Aurora would need the
function in the VPC plus RDS Proxy to stop connection storms; that is deliberately **not** on
the paved road yet.

The data-store baseline module and the engine modules (Aurora PostgreSQL first) are a
follow-up — designed here, listed in section 10, not built in this case.

### 3.3 Backup & recovery

Backups are a platform guarantee, not a team chore. A team adds **one tag** —
`backup = standard | critical` — and the organisation's AWS Backup policy for the account's OU
does the rest (`terraform/org/backup-policy.tf`, ADR-016). The lambda-api table sets the tag from its
data classification.

| Tier | What | Where | Protects against |
|---|---|---|---|
| **1 — in-account** | Engine-native continuous backups / point-in-time recovery (Aurora backup retention, DynamoDB PITR) + policy snapshots into the account's `northstar-local` vault | The workload account | Bad deploys, accidental deletes, corruption: fast, self-service restore |
| **2 — immutable copy** | Policy copy actions into `northstar-central` in the **Backup account** (Security OU), same region, **Vault Lock in compliance mode**, its own CMK, vault policy accepts copies from org accounts only | Backup account, `me-central-1` | Account deletion, ransomware, a compromised account or admin: nobody, root included, can delete a copy before its retention ends |

**Per environment** (attached per OU, targets to agree with data owners):

| | Dev | Test | Prod / Infrastructure |
|---|---|---|---|
| Daily snapshot, kept | 7 days | 14 days | 35 days |
| Monthly snapshot (`critical`) | — | — | 365 days |
| Copy to the Backup account | none | `critical` only, 14 days | every tier; daily 35 / 90 days (`standard` / `critical`), monthly 365 days |

Sandbox is not backed up; the Security OU is excluded so the Backup account never backs up into
itself (Log Archive relies on S3 Object Lock). The Prod SCP denies deleting vaults and recovery
points and editing the backup role, except by the platform baseline pipeline.

**Encryption detail that matters:** Aurora/RDS snapshots keep the source key when copied across
accounts, so the account key policy lets the Backup account *use* (not administer) it;
otherwise the tier-2 copy silently fails. DynamoDB copies need AWS Backup's advanced DynamoDB
features enabled per account (a baseline follow-up).

**Restore testing.** A backup nobody has restored is a hope. An AWS Backup restore testing plan
in the Backup account restores the latest Aurora copy every week into an **isolated restore
VPC**, keeps it for the validation window and deletes it (`terraform/backup`). The restore VPC
is a dead end by construction: private subnets in all three AZs, a route table with no routes
(no internet gateway, NAT, Transit Gateway attachment or peering), a DB subnet group, a
security group that only admits itself and an emptied default security group. Its CIDR
(`10.255.0.0/24`) is kept out of the routed estate's IPAM pool (an assumption to confirm with
the network team). No interface endpoints and no flow logs yet: nothing runs inside the VPC
while restores are validated by job status; a validation Lambda in the VPC would bring its
endpoints with it. The restore test's subnet group and security group are set through AWS
Backup's restore metadata overrides (`dbSubnetGroupName`, `vpcSecurityGroupIds`); those keys
follow the AWS documentation and are not yet verified against a real restore job.

Each restore job emits an EventBridge event. Turning those into a finding per source account,
so the dashboard shows **"last successful restore N days ago"** next to drift and Config
findings and a failed or missing restore test alerts the owner, is a follow-up (section 10).

**How it is deployed.** `terraform/backup` is one root with one state
(`backup/terraform.tfstate`) in the Backup account, applied by its own pipeline, not by the
account waves. A pull request touching `terraform/backup/**` or the registry gets a plan with
the read-only role (`plan-on-pr.yml`); on merge, `apply-backup.yml` plans with the platform
baseline role (GitHub OIDC, as every other workflow), uploads the plan and applies **exactly
that plan** after an approval on the protected `lz-backup` environment, one run at a time.
Because a compliance-mode Vault Lock is irreversible after its grace period, the workflow
refuses any plan that changes the lock (or deletes or replaces the vault) unless a person runs
it by hand with `confirm_vault_lock_change: true`.

**Targets, not measured results:**

| | RPO target | RTO target |
|---|---|---|
| Tier 1 (point-in-time restore in-account) | ≤ 5 minutes | ≤ 1 hour for a typical service database |
| Tier 2 (restore from the Backup account) | ≤ 24 hours (last daily copy) | ≤ 4 hours, rehearsed by restore tests |
| Regional event | not covered yet — see "Regional resilience" in section 10 | |

Multi-AZ (e.g. an Aurora replica in a second AZ) is availability, not a backup and not a
disaster-recovery strategy.

---

## 4. Automation at scale

Two layers, two owners. The platform team owns the estate; product teams own their services.

### 4.1 Layer 1 — the estate (platform team)

```
platform-landing-zone repo
accounts.yaml (registry)  ──►  account-baseline module  ──►  per-account state
     one line per account        env profile: dev/test/prod
```

- **Registry-driven:** every account is one entry (`id`, `environment`, `team`, `flavours`).
  Adding a line provisions a new account with the right baseline; nothing is configured by hand.
- **A newly provisioned account, end to end:**
  1. A pull request adds the account to `terraform/registry/accounts.yaml`; `plan-on-pr.yml`
     plans the org root (its Identity Center assignments) and shows the result on the PR.
  2. Control Tower Account Factory (AFT) vends the account into the OU named in the entry.
  3. The OU's SCPs apply the moment the account lands there — no per-account policy work.
  4. On merge, `rollout-waves.yml` applies the account baseline in the account's wave (deploy
     role, tags, budget, KMS, backup vault, observability link); existing accounts are a no-op.
  5. The same run posts `registry.sync`, so the account appears on the dashboard with its owner
     and team, and from then on gets the nightly drift check.

  *In the PoC:* the registry, the org and baseline Terraform and the workflows are real code;
  Account Factory is assumed (not coded), nothing is applied to AWS, and `registry.sync` is
  posted by the simulator's seed. Applying the org root on merge is not a workflow yet.
- **PR = change:** `terraform plan` for every affected account on the pull request, with policy
  checks; results posted to the PR.
- **Rollout in waves on merge:** Sandbox → Dev → Test → Prod, with automatic stop on failure
  and a soak period before Prod.
- **Organisation-wide change** = one PR to a module or a guardrail. Never a manual edit to an
  individual account.
- **Terraform state:** one state per account (blast radius of a broken state = one account),
  in S3 with native locking, KMS-encrypted, versioned, readable only by the pipeline role —
  state can contain secrets, so humans do not read it directly.

### 4.2 Layer 2 — services (product teams, on platform building blocks)

The platform ships three kinds of building block, all versioned:

| Building block | What it is | Where it lives |
|---|---|---|
| **Templates** | A starter repo per golden path: app skeleton, Terraform, workflows, README | Template repos, offered from the dashboard |
| **Terraform modules** | `ecs-service`, `lambda-api`, `static-site`, … | Private module registry, semantic versions |
| **Reusable workflows** | `build-node`, `build-php`, `build-dotnet`, `build-python`, `build-static`, `reusable-deploy` | `platform-workflows` repo, called with `uses: …@v3` |

**Creating a service:** the team picks a flavour in the dashboard → a new repo is created
from the template, registered with its team and environments → first deploy to Dev runs
within minutes.

**What lives in the team's repo** — small, readable, theirs:

```yaml
# platform.yaml — the service manifest
service: baggage-tracker
team: ground-ops
flavour: ecs-service@2.4
environments: [dev, test, prod]
size: medium
data-classification: internal
```

```hcl
# infra/main.tf
module "service" {
  source  = "registry.northstar.internal/platform/ecs-service/aws"
  version = "~> 2.4"
  name    = "baggage-tracker"
  # team-specific extras go next to it, as plain Terraform
}
```

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    uses: northstar/platform-workflows/.github/workflows/reusable-deploy.yml@v3
```

**Staying current without chasing teams:** Renovate opens PRs when a new module or workflow
version is released. Platform supports the current and previous major version, with a
published deprecation date; the dashboard shows who is behind.

### 4.3 Repository layout: split by lifecycle and risk, not by file type

| What | Where | Why |
|---|---|---|
| Stateless service infra (ECS service, Lambda, CloudFront, alarms) | The application repo (`infra/`) | Changes with the code, in one atomic PR |
| Stateful / shared infra (Aurora, data buckets, shared queues, DNS) + release manifests | **Deployment repo per product** | Rarely changes, high risk, stricter review, deletion protection |
| Estate (accounts, guardrails, networking) | Platform repo | Platform team only |

Frontend and backend in one repo or two is the team's choice (same team and release rhythm →
one repo); the templates support both. A frontend PR can never touch the passenger database.

### 4.4 Releases: pin artifacts, not source — build once, deploy many

App repos build an **immutable artifact** on every merge: a container image in ECR pinned by
digest for the backend, a versioned bundle in S3 for the frontend. The product's deployment
repo holds a **release manifest per environment** that says which versions run where:

```yaml
# deployment repo: environments/prod.yaml
baggage-tracker:
  backend:  1.4.2   # image digest pinned
  frontend: 2.0.1
```

- **Deploy = a PR that changes a version.** Merge, and the platform deploy workflow rolls out
  exactly that artifact.
- **Promotion moves the same artifact up:** Dev → Test → Prod. What was tested is
  byte-for-byte what reaches Prod.
- **Audit and rollback for free:** git history answers "what was in Prod on 12 March?";
  rollback is a revert.
- **Fast where it can be, deliberate where it must be:** a bot bumps Dev automatically after
  every green build (auto-merge); Test follows when Dev is green; Prod needs one approval.

(This is the GitOps / promotion-repo pattern — Argo CD does it for Kubernetes; for ECS and
Lambda the same model runs on Terraform plus the reusable deploy workflow. Git submodules are
deliberately avoided: they pin source rather than what actually runs.)

### 4.5 Freedom with safety: guardrails, not gates

Developers get a lot of freedom **inside** the boundaries; safety is enforced **at** the
boundaries, automatically, so nobody has to ask permission for normal work.

| Developers are free to | Enforced regardless |
|---|---|
| Choose language, framework, libraries | SCPs and policy checks apply to every account |
| Write their own build and test steps | Required checks on `main` via org-wide repository rulesets |
| Add extra resources as plain Terraform next to the module | Policy-as-code check on every plan (encryption, tags, no public access) |
| Leave the golden path (with an owner and a reason) | Off the path = the team owns operations; visible in the dashboard |
| Experiment freely in Sandbox | Sandbox has budget caps and no network route to anything real |
| Contribute to the platform modules (inner source) | Changes reviewed by platform via CODEOWNERS |

**The key mechanism — Prod can only be reached through the paved road:**
the Prod deploy role in every account trusts GitHub OIDC tokens **only from the platform's
reusable deploy workflow**. AWS can only match a few GitHub OIDC claims (`aud`, `sub`), so the
GitHub organisation's OIDC subject template is customised once to embed `job_workflow_ref` in
`sub`; the role's trust policy then requires the platform workflow, at a release tag for Prod. A team
can do anything it likes in its own pipeline, but the step that touches Prod is always the
platform workflow — which runs the policy checks, the approvals and the audit logging.
No one can bypass it by editing their own YAML.

**The deal with teams:** the golden path is not mandatory — it is just the easiest way.
Stay on it and you get monitoring, patching, backups, security fixes and on-call support for
the platform layer for free. Leave it and you can, but you own what you build.

---

## 5. Platform dashboard (software)

A **lightweight command center** for the platform. It evaluates account configurations,
shows deployment and compliance state, and is where people onboard and request things.

Design intent: **the platform runs itself; people are pulled in only when something needs a
decision.** Rollouts, drift detection and re-applies are automated; when something goes
wrong, an alert reaches the owning team where they already work. The dashboard is where you
go to act on that — not a screen someone has to watch. It reads from and writes to the
automation, and never bypasses it.

### 5.1 Stack

TypeScript end to end, one monorepo (npm workspaces):

```
apps/api       Node.js + Fastify, REST + OpenAPI generated from the route schemas
apps/web       React + Vite
apps/mcp       read-only MCP server over the API (optional, see 5.12)
packages/shared  domain types + TypeBox schemas (JSON Schema), used by api, web and mcp
```

One language, one toolchain, and the domain model (account, finding, rollout, exception) is
defined once — a change to it is caught by the compiler on both sides.

**Fastify** because every route is declared with a schema: requests are validated against it
and the **OpenAPI spec is generated from the same source**. The published spec is the
contract other teams build against — HR integrations, ITSM, internal tools — and typed
clients can be generated from it in any language. The API is a product, not a by-product
of the UI.

The dashboard lives on the same setup every other application gets — its own app repo, a
deployment repo, the **`ecs-service` golden path**, the same reusable workflows and the same
guardrails. The platform lives by the rules it sets; if a golden path is painful, the platform
team feels it first.

### 5.2 Who uses it, and how often

| User | How often | For |
|---|---|---|
| Developer | Intensively once (onboarding), then occasionally | A link in an alert, a request (new service, exception, Prod access), "is my team green?" |
| Lead developer | Weekly | Team compliance, approvals |
| Security / audit | Weekly, audits | Findings, exceptions, who has access where |
| Platform team | Daily | Rollouts, failures, the estate |

Developers live in their own tools — GitHub, Teams, the IDE, the CLI. Entra's "My Apps" is
already a launchpad; the dashboard adds **context** (role, open findings, last deploy) rather
than competing with it. **The best platform is one developers barely notice.**

### 5.3 One governance layer for both clouds

Processes are defined by **intent**; clouds only change the steps. *Onboard user*, *vend
account*, *apply baseline*, *offboard user* and *contain incident* are workflows with the
same goal everywhere — the cloud-specific steps sit in adapters (ports and adapters).

| Cloud-agnostic core | Cloud-specific adapters |
|---|---|
| Registry of **cloud targets** (`cloud: aws \| azure`), owners, teams | Findings: Config / Security Hub ↔ Azure Policy / Defender |
| Exceptions, rules, alert routing, onboarding, roles, analytics feed | Launch links: AWS access portal ↔ Azure portal |
| Terraform drift (`terraform show -json` is the same format on both clouds) | Golden-path modules: `ecs-service` ↔ `container-app` |
| Actions via pipeline `workflow_dispatch` | Vending: Account Factory ↔ subscription vending |

Every adapter maps into **one normalised finding** (target, rule, severity, resource, owner,
status, link to the original). Only what governance needs is normalised — teams keep using
each cloud fully, and the original finding is always one click away. No
lowest-common-denominator layer.

### 5.4 How it ties into the automation

```
                 ┌───────────────────────────── reads ─────────────────────────────┐
accounts.yaml ───┤ release manifests · exceptions registry · module versions (git) │
                 └──────────────────────────────────────────────────────────────────┘
GitHub Actions ──POST /events (signed)──►  API  ──► rule engine ──► state + event log
  plan JSON, apply result, drift result     │
                                            ├──► outgoing webhooks: Teams, ITSM
Operator (UI) ──"start rollout / re-apply"──┴──► GitHub workflow_dispatch (never direct AWS)
HR / Entra   ──POST /events/membership──► onboarding flow
```

- **Inbound:** every pipeline run posts its result (`terraform show -json` plan summary,
  apply status, drift exit code, policy-check findings) to `POST /events`, authenticated with
  the pipeline's OIDC token or an HMAC signature.
- **Outbound actions go through the pipeline:** "re-apply baseline" or "start rollout" in the
  UI triggers a GitHub `workflow_dispatch`. The app has **no write access to AWS** — every
  change still goes through code review, policy checks and the audit trail.
- **Outbound notifications:** drift, failures and expiring exceptions become webhook events
  to Teams/Slack and the ITSM tool.

#### Async by default: the API accepts, workers do the work

```
webhooks / UI ──► API (thin) ──► DB: event + job in ONE transaction (outbox)
                                         │
                                         ▼
                                   queue (SQS) ──► workers: evaluate · notify · dispatch · sync
                                         │                      │
                                         └── DLQ ◄── after N retries
```

- **The API stays thin:** it validates, stores the event and answers `202 Accepted` within
  milliseconds. Senders (GitHub, HR, ITSM) never wait on our processing and never time out.
- **Workers do everything heavy or slow:** rule evaluation, alert routing, `workflow_dispatch`,
  calls to AWS/Azure/GitHub APIs, SCIM-related onboarding steps.
- **Transactional outbox:** the event and its job are written in the same database transaction,
  so nothing is lost if the process dies between "saved" and "queued".
- **Why it matters here is less about volume and more about behaviour:**
  - *Rate limits:* workers control concurrency towards AWS, Azure and GitHub APIs, with backoff.
  - *Retries:* every job is idempotent, so retrying is always safe; failures land in a
    dead-letter queue and raise an alert instead of disappearing.
  - *Long-running work:* a rollout across hundreds of accounts takes hours; it is a sequence of
    small jobs, not one request.
  - *Isolation:* a slow or failing integration (e.g. ITSM down) backs up its own jobs without
    affecting the rest.
- **Long multi-step workflows** (onboarding, rollouts in waves) are tracked as workflow state
  per goal, so the dashboard can show "step 3 of 5" and resume after a failure. In production
  this can move to a managed orchestrator (e.g. Step Functions) if the workflows grow.
- **PoC:** a Postgres-backed job queue, so outbox and queue share one database and one
  component less to run; production swaps in SQS behind the same interface.

### 5.5 What it evaluates

The dashboard is an **aggregator, not another policy engine**. It does not re-implement what
AWS and the pipeline already check; it brings the signals together per account:

1. **Terraform drift:** does reality match the code? (nightly plan)
2. **Policy checks** from CI (Checkov / OPA on every plan)
3. **AWS Config / Security Hub findings** (what happened outside the pipeline)
4. **Platform rules** only for what nothing else covers — small, versioned TypeScript
   functions: *baseline/module version still supported*, *golden path not deprecated*,
   *owner and team set*, *exception still valid*.

Every finding has a severity and can be waived only by a registered exception.

### 5.6 Views

| View | For | Shows |
|---|---|---|
| Overview | Everyone | Compliance heatmap: environment × team, % compliant, last 30 days |
| Account | Teams, platform | Baseline + module versions, flavour, findings, drift, last deploys |
| Rollouts | Platform | Wave progress across accounts, failures with logs, retry |
| Exceptions | Security, leads | Who, why, until when; expiring and expired |
| My access | Everyone | Roles per account, launch links to the AWS access portal |
| Onboarding | New joiners | Wizard: SSO, device key, GitHub, VPN, access overview |

Short-term, operational trends only (last 30 days, "are we getting better or worse this
month?"). No report builder, no custom charts.

### 5.7 Alerting: the primary interface

Most of the time nobody opens the dashboard — the alert comes to them.

| Event | Goes to | Severity |
|---|---|---|
| Drift in Prod | Owning team (Teams) + ticket | High |
| Rollout wave failed | Platform on-call; rollout halted automatically | High |
| Critical finding (e.g. public bucket) | Owning team + security; ticket | Critical |
| Exception expires in 14 days / expired | Exception owner / owner + their lead | Medium / High |
| Module version deprecated | Team, with the upgrade PR already opened by Renovate | Low |
| Drift in Dev | Daily digest, no page | Low |

Every alert carries a link straight to the relevant account or rollout in the dashboard, and
an owner — never "someone should look at this". Alerts are deduplicated and grouped so a
single bad guardrail change does not page fifty teams.

### 5.8 Long-term reporting: data, not dashboards

Long-term and management reporting does **not** belong in an application like this — that
is reinventing the wheel. The organisation's BI platform (e.g. Power BI) and data teams
specialise in exactly that.

The platform provides the **data**: a daily export to the data platform (or an OData feed
Power BI reads natively) through a separate, read-only `/v1/analytics` scope.

- **Aggregated:** counts per team, environment, rule and severity — no resource names,
  account IDs or IP addresses. A list of "Prod accounts with open findings" is an attack map
  and never leaves the platform.
- **No people:** role and team only.
- **Pseudonymised where trends need it:** a stable keyed hash lets analysts follow "the same
  account over time" without knowing which account it is; the key stays with the platform.
- **Lower classification as a result:** the feed carries only metrics, so it can be shared
  widely and safely.

### 5.9 Access

Login with **OIDC against Entra ID**; Entra groups map to app roles carried in the token:

- **viewer:** reads the estate: overview, accounts, findings, rollouts (in the PoC every viewer
  sees all teams; masking Prod finding detail by team and classification is design, see 5.12)
- **operator:** can trigger rollouts and re-applies (via the pipeline)
- **admin:** approves exceptions, manages rules

The app stores no passwords and no MFA — identity lives in one place.

### 5.10 Data

- **Append-only event log** (what happened, when, from which run) + a **current-state
  projection** per account for fast reads. History and audit come from the log.
- PostgreSQL in production; the PoC runs the same schema locally in Docker.
- Git stays the source of truth for intent (registry, manifests, exceptions); the database
  holds observed state.

### 5.11 Quality

- API tests with Vitest + Fastify `inject` (no network); rule engine unit-tested per rule.
- OpenAPI spec generated from the Fastify route schemas and checked in CI (breaking-change
  detection), so the published contract cannot drift; the API is versioned (`/v1`).
- Same reusable workflows as every other service.

### 5.12 MCP server: read-only by design

Because the API is the product, an MCP server for AI assistants is a thin layer (about a
hundred lines in `apps/mcp`). It exposes **read-only tools only** — `list_noncompliant_targets`,
`get_target`, `list_expiring_exceptions` — and calls the same public API with the same role
checks, using the **user's own on-behalf-of token**. It holds no AWS credentials and no
database credentials.

**MCP security.** Nothing is writable, so the risk is **disclosure, not control**. The
controls follow from that:

- a read-only **`platform.read` scope**, with short-lived tokens;
- an **audit log entry per tool call** (who, which tool, which arguments);
- **rate limits**, and a **kill switch** per team and for the whole organisation;
- only an **approved enterprise assistant** (no training on our data, a defined data
  location) — not any client someone installs;
- **Prod finding detail filtered or masked by classification** — the same "attack map"
  reasoning as the anonymised Power BI feed (5.8);
- **prompt injection via data fields** (a resource name or tag crafted as an instruction) is
  contained because no tool can change anything.

*Built in the PoC:* the three read-only tools over the public API with the user's bearer token
(simulated Entra login). *Design:* the `platform.read` scope, per-call audit log, rate limits,
kill switch and classification masking.

Write actions stay where they are: in the pipeline, with a human approving. AI-assisted
remediation — a fix proposed as a pull request that a human merges — is a follow-up
(section 10), not part of the MCP server.

---

## 6. Operating at scale: boring by design

People are not the load. Even with thousands of engineers, joiners, movers and leavers are
tens per day — Entra ID and SCIM handle that without effort. What scales is **accounts ×
changes**: one change, hundreds of targets. The design answer is that everything is
per-account, idempotent, rolled out in waves and alert-driven. Done well, it should feel
boring.

### 6.1 Configuration drift

- **Two detectors:** nightly `terraform plan -detailed-exitcode` per account (does reality match
  the code?) and AWS Config rules (does it match policy?). Config also catches console changes
  that never touched a pipeline.
- **Classify, then act:**

| Drift | Action |
|---|---|
| On a platform-owned resource (guardrail, baseline role, logging) | **Auto-remediate** by re-applying the baseline; notify the team |
| On a team resource in Dev/Test | Daily digest to the team |
| On a team resource in Prod | Alert + ticket to the owner; re-apply after their confirmation |
| Repeating on the same resource | Flag as a design smell: the module is missing an option teams need |

- Console write access in Prod is removed by the role design (deploys go through the pipeline),
  so Prod drift should be rare — and every case is a learning point.

### 6.2 Deployment failures

- **Waves:** Sandbox → Dev → Test → Prod, each wave with a soak period and health checks.
- **Failure threshold per wave:** a wave stops when failures exceed a threshold (e.g. > 2 % of
  accounts or any Prod account). Nothing reaches Prod that failed earlier.
- **Partial failure is normal at scale:** 3 of 400 accounts failing must not block the other 397.
  Failed accounts are listed with their error and retried individually; applies are idempotent,
  so a retry is always safe.
- **Rollback:** revert the PR; the same pipeline rolls the previous version forward.
- **Throughput:** state per account, plans run in parallel with a concurrency cap and backoff
  so the estate stays within AWS API rate limits and runner capacity.
- **Batching:** a GitHub Actions matrix is capped at 256 jobs per run, fewer than "hundreds of
  accounts" can hold. `batch-accounts.sh` groups accounts into at most 200 jobs (one account per
  job up to 200 accounts, 10 per job at 2,000); each job handles its accounts in turn, so the cap
  of 20 jobs in parallel still means 20 accounts at a time. Per-account results, events and the
  wave gate are unchanged: one failed account never stops the rest of its batch.

### 6.3 Governance exceptions

- Registered in git: rule, account, owner, reason, compensating control, **expiry date**.
- Approved by security (CODEOWNERS); the rule engine and policy checks honour active exceptions.
- 14 days before expiry the owner is notified; on expiry the finding re-opens and escalates to
  their lead.
- **Exception debt is a metric:** a rule with many exceptions is a signal that the rule — or
  the golden path — needs to change, not that teams are misbehaving.

### 6.4 Change across hundreds of accounts

- One PR to a module or guardrail; versioned modules; Policy Staging OU first.
- **Detect-only before enforce:** a new rule first reports what it would block; teams get time
  and a fix path; then it is switched to enforce.
- **Version sprawl:** support N and N-1 majors; Renovate opens upgrade PRs; the dashboard shows
  who is behind and by how much.

### 6.5 Security incidents

A critical finding (e.g. GuardDuty: compromised credentials) follows a runbook: alert to
security and the owning team, then automated containment — revoke the session, apply a
quarantine SCP to the account — while humans investigate. Containment is automatic; deletion
never is.

### 6.6 Ownership

- Every account has a mandatory `owner` and `team` tag, synced from the registry.
- Team reorganisations are a registry change; **ownerless accounts are flagged** and escalated,
  and unused Sandbox accounts are cleaned up automatically.

### 6.7 Trust, but verify — automatically

Teams are trusted to run their own pipelines. The platform verifies, without asking anyone
to remember anything:

- Policy checks are **required workflows** enforced by org-wide repository rulesets — a team
  cannot remove them from its own pipeline.
- The Prod deploy role only trusts the platform's deploy workflow.
- The detective layer catches whatever CI never saw.

Not because people are careless — because everyone is human. The goal is that the right thing
is the easiest thing, so nobody needs to be a hero and nobody needs to be blamed.

### 6.8 The platform itself

- The landing zone and dashboard are deployed by the same pipelines and golden paths.
- If the dashboard is down, nothing breaks: automation and alerts run independently of it.
- The platform measures itself (section 1.4): % compliant, time to account, time to remediate,
  exception count, golden-path adoption.

### 6.9 Runbooks

The operational responses above are written down as runbooks in [`docs/runbooks/`](runbooks/):
a halted rollout wave, drift in a Prod account, an expired or expiring governance exception,
and break-glass access. One template each — trigger, impact, who, steps, verify, escalate,
prevent — and every step names the workflow or screen it uses. A runbook step that keeps
recurring is a candidate for automation.

---

## 7. Migration and adoption: bringing the existing estate along

The design above is a target. NorthStar already has hundreds of accounts, teams with their own
ways of working and tooling I do not know yet. Taking ownership of the infrastructure needs a
level of standardisation — but getting there is done **with** the teams, not to them.

### 7.1 Principles

- **Assumptions are explicit** (appendix) and validated in discovery before anything is enforced.
- **Visibility before control:** first see the real state, then agree the gap, then enforce.
- **Teams help shape it:** each team is asked how it wants to integrate its applications; the
  golden paths are built from what teams actually run, not from a whiteboard.
- **Wiggle room with a date:** teams get a grace period and an agreed deadline, per team.
  Nobody is blocked on day one; nobody stays outside forever.

### 7.2 Phases

| Phase | What happens | Enforcement |
|---|---|---|
| **0. Discover** | Inventory accounts, owners, stacks, pipelines, IdP, ITSM. Talk to teams: what do you run, what hurts, how would you like to integrate? | None |
| **1. Foundation** | Organisation and OU structure, central logging, identity via Entra, platform dashboard. Existing accounts enrolled in **detect-only** mode. | Only "can't hurt anyone" guardrails: protect CloudTrail, block root, no leaving the org |
| **2. Pilot** | Two or three willing teams move onto the golden paths. Templates and modules are refined with their feedback. | Per pilot team, agreed |
| **3. Onboard in cohorts** | Teams onboard in waves, each with an agreed migration plan and deadline. Existing resources are imported into Terraform per account; anything that cannot move yet gets a registered exception. | Grace period → enforce per team after its deadline |
| **4. Enforce and optimise** | Guardrails switched from detect to enforce across the estate; exceptions reviewed; golden paths extended where teams keep asking for the same thing. | Full |

### 7.3 What teams get in return

The deal has to be worth it for them: onboarding means less work, not more. A team that
moves onto a golden path gets monitoring, patching, backups, security fixes, automated
onboarding of its people and a deploy pipeline it no longer has to maintain.

### 7.4 Measuring adoption

% of accounts enrolled · % of accounts past detect-only · teams onboarded vs planned ·
open exceptions per team · compliance score trend per cohort.

---

## 8. Integrations: the platform is not an island

| Neighbour | Integration | Who benefits |
|---|---|---|
| HR → Entra ID | Webhook / SCIM — joiner, mover, leaver | New hires productive on day one; a leaver blocked at once, every door closed and verified within 15 min (2.6) |
| GitHub | PRs, plan output, status checks | Developers stay in their own tools |
| ITSM (e.g. ServiceNow) | Exceptions and failed rollouts become tickets with owner and expiry | Audit trail with no extra work |
| Monitoring / EMS | Drift and failures as events in the incident process | Fits existing level 1 & 2 incident handling |
| Teams / Slack | Notifications for approvals, drift, onboarding | Nobody has to watch a dashboard |
| FinOps | Mandatory tags, budgets per account | Cost traceable to a team |
| AI assistants (MCP) | Read-only MCP server over the compliance API: "which Prod accounts have drift?" (security: 5.12) | Answers in seconds, with the same access rules |

---

## 9. Proof of concept scope

**Real:** Terraform modules (`account-baseline` and the tested golden-path modules `ecs-service`,
`lambda-api` and `static-site`), env
profiles, `accounts.yaml` registry, org backup policies and the central Vault-Locked vault
with restore testing into an isolated restore VPC, GitHub Actions workflows (plan on PR, waves
on merge, the Backup account's gated apply, nightly drift), TypeScript monorepo (Node API + React dashboard with shared types), webhook
endpoints in and out, a cloud-neutral core model fed by normalised events (the adapter
interface itself is extracted with the second cloud, ADR-013), optional read-only MCP server (5.12).

**Scope:** four areas — landing zone architecture and governance, automation
at scale, the platform web app, and operational scalability. Shared, org-wide services such as
backups belong to the landing zone and are built; everything else is listed as follow-ups in
section 10, designed but not built.

**Simulated:** AWS accounts (mock providers / local state per account),
Entra ID login, HR system, ITSM and Teams receivers.

**Demo flow (5 min, script in the README):**
1. Dashboard: compliance per account across Dev/Test/Prod.
2. HR webhook: "Jan joins Payments" → onboarding wizard → his access per account.
3. Drift injected in one Prod account → detected → ticket + notification → re-apply.
4. The region-lock SCP in Terraform → `terraform test` on the org root.
5. Org-wide change: the guardrail rolls out in waves, halts in Test, retry, Prod after.

---

## 10. Follow-up projects (beyond this case)

Scope is what the stakeholders approved; good ideas outside it are documented here, not built.

- **Azure adapter:** bring Azure subscriptions under the same governance layer (Azure Policy,
  Defender, subscription vending). The core is built for it; only the adapter is new.
- **Short-lived SSH certificates** issued after SSO, replacing static public keys.
- **Just-in-time elevation** fully automated (PIM / TEAM) with approval in Teams.
- **AI-assisted remediation:** a finding comes with a proposed fix as a pull request; a human
  reviews and merges. Never auto-applied.
- **Data-store baseline and engine modules** (section 3.2): one `data-store-baseline` module with
  what every engine gets (CMK with rotation and a key policy scoped to the account and the
  store's service, security group open only to declared client security groups, Secrets
  Manager credentials, mandatory tags, the `backup` tag by environment and classification,
  alarms on the owner's topic, region pinned to `me-central-1`) — every engine gets the same
  baseline; the engine module is the thin part. **Aurora PostgreSQL first** (Serverless v2,
  `manage_master_user_password`, retention 1 / 7 / 35 days for dev / test / prod, deletion
  protection and a final snapshot in prod, two instances in prod, IAM auth, SSL forced),
  outputs shaped for `ecs-service`'s `database` input. Then supported engines on demand
  (RDS SQL Server / Oracle, Aurora MySQL, ElastiCache / Valkey, OpenSearch, DocumentDB), and
  the same concepts for vendor-managed stores via their Terraform providers.
- **More compute flavours:** `ecs-worker` (queue consumers, scheduled and one-off Fargate tasks
  via EventBridge Scheduler) and `lambda-event` (SQS, EventBridge and S3 triggers) — the
  asynchronous half of most applications, on the same alarms, tags and deploy path.
- **Restore results as findings on the dashboard.** An EventBridge rule in the Backup account
  forwards "Restore Job State Change" events to the platform API; the worker records a finding
  per source account ("last successful restore N days ago", failed or missing test = alert to
  the owner), next to drift and Config findings. Optionally a validation Lambda in the restore
  VPC (with the interface endpoints it needs) that queries the restored database and reports
  through `PutRestoreValidationResult`. The restore tests themselves are built; this reporting
  path is not.
- **Regional resilience.** Multi-AZ is not a DR strategy against a regional event; earlier in
  2026 two of the three `me-central-1` availability zones were unavailable at the same time.
  The design:
  - an **offsite immutable copy outside the Gulf** (e.g. `eu-central-1`; the region is added
    to the allow-list for the Backup account only), encrypted with a key **held in the UAE**
    via KMS External Key Store (XKS) backed by NorthStar's own HSM;
  - **key escrow outside the region** (a second HSM site or a split-knowledge offline backup):
    a key that only exists in the UAE shares the failure domain with the data it protects;
  - an **annual restore in the remote region**, end to end;
  - **residency decided per data class** by legal and the DPO: encrypted data abroad may still
    count as a transfer;
  - for data that may not leave the UAE: a copy in **NorthStar's own data centres** over Direct
    Connect.

  The principle is the same as everywhere else in the design: never let a critical system share
  a failure domain with what it is meant to back up.
- **Throughput at larger scale.** Today: at most 20 accounts in parallel, batched to stay under
  the 256-job matrix cap (up to ~2,500 accounts per workflow run), waves one after another, and the AWS provider's default `standard` retries (throttled calls back off, up to
  25 attempts). Most AWS API limits are per account and region, so the load spreads by design;
  the shared Organizations API is only touched by the org root, which runs alone. Before raising
  the parallelism, measure throttling per API and evaluate the provider's `retry_mode =
  "adaptive"` (a client-side rate limiter that slows down once AWS throttles). AWS still marks
  adaptive mode as experimental, so it is not used until it is production-ready; until then the
  levers are the parallelism cap and the wave size.
- **Capacity checks.** Every known limit becomes a metric with an alert at 80 %: jobs in the
  largest matrix (GitHub cap 256), the AWS Organizations account quota, SCPs per OU (max 5),
  nightly drift duration, runner queue time and the worker queue. A scheduled job compares the
  registry and the last pipeline runs against those limits and alerts platform on-call; the
  dashboard shows the table. At 80 % the fix is planned work, at 100 % it is an outage.
  Worked example: [PIR-001](incidents/PIR-001-pipeline-capacity.md) (tabletop).
- **Read side at scale.** A load test at 1,000 accounts and 2,000 engineers kept every result
  correct; what degrades first is the dashboard under many concurrent viewers, because the PoC
  aggregates the whole estate in code and returns unpaginated lists. In order, about a day of
  work: pagination with a total count and search on findings, accounts and people (the findings
  list stops at 500 today); the heatmap grouped by business unit or OU with a click-through to
  teams (needs a business-unit field in the registry); a slim rollouts list with targets loaded
  on open; aggregation in SQL plus ETags so unchanged data is not downloaded again; more API
  instances behind the load balancer as the cheap first step.
- **Network account in Terraform** (design in 1.5). A `network` root for the Network account:
  Transit Gateway with separate route tables for Dev/Test and Prod (no Dev-to-Prod path), IPAM
  pools per environment, central egress through NAT and AWS Network Firewall, Route 53 Resolver
  rules and shared VPC endpoints. `account-baseline` then requests its VPC CIDR from IPAM and
  attaches to the right route table by environment, so a new account is connected on vend.
  Same pattern as `terraform/backup`: its own root, its own gated apply workflow, `terraform
  test` with mock providers. Today only the Backup account's shared service is built.
- **Account vending wired to the registry** (design in 1.4). Today a registry PR drives OUs,
  guardrails, access and the baseline; creating the account itself is Control Tower Account
  Factory, by hand. Next: on merge, the pipeline calls Account Factory (Service Catalog
  `ProvisionProduct`) or AFT for each new registry entry, waits for it, moves it into its OU
  and starts its first baseline apply; the dashboard shows the account as *vending* until the
  first apply reports back. One PR from request to a governed, connected account.
- **Detective and data-perimeter controls in code** (design in 1.3). Org-wide AWS Config with
  a conformance pack per environment profile, Security Hub standards (AWS Foundational Security
  Best Practices, CIS) and GuardDuty, all through delegated admin in the Audit account, plus
  **RCPs** for the data perimeter (S3, KMS, STS: only NorthStar principals and networks). Config
  and Security Hub findings then reach the dashboard through EventBridge instead of the
  simulator. Today the SCPs are built and protect these services; the detective layer and the
  RCPs are design.
- **End-to-end pipeline runs against a sandbox organisation.** The workflows are linted and
  their scripts tested locally, and every Terraform root has `terraform test` with mocks; none
  of it has run against real accounts. A small sandbox AWS organisation (management account, a
  handful of member accounts, the same OUs) where `plan-on-pr`, `rollout-waves` and
  `nightly-drift` run on every change to `.github/`, plus a weekly full rollout, proves the
  pipeline itself before it touches the real estate.

---

## Appendix A — assumptions to validate in discovery

| Assumption | If it turns out different |
|---|---|
| Identity: Microsoft Entra ID (Microsoft 365 estate) | Same design via SAML/OIDC/SCIM with any IdP (e.g. Okta) |
| Source control & CI: GitHub + GitHub Actions | Same model on Azure DevOps or GitLab: templates, reusable pipelines, OIDC to AWS |
| BI: Power BI | Any BI tool consuming the analytics export |
| Observability: CloudWatch + Grafana | Plug the golden-path logging and alarms into the existing tooling |
| ITSM: ServiceNow (or similar) | Webhook adapter per tool |
| No landing zone yet | Existing one is assessed in discovery and extended rather than replaced |
| Approved regions and data-classification rules exist | Defined with security in phase 0 |

## Appendix B — the same design on Azure

| AWS | Azure |
|---|---|
| Organizations + OUs | Management groups |
| SCPs / RCPs | Azure Policy (deny) + RBAC |
| Control Tower / Account Factory | Azure Landing Zones (subscription vending) |
| IAM Identity Center | Entra ID + Azure RBAC (native) |
| Config / Security Hub / GuardDuty | Azure Policy (audit) / Defender for Cloud |
| Transit Gateway | Virtual WAN / hub VNet |
