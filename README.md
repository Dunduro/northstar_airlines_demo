# NorthStar Platform — proof of concept

A landing zone and governance platform for NorthStar Airlines' AWS estate: Terraform for the
estate, plus a small **command center** that aggregates compliance, rolls changes out in waves,
routes alerts to owners and onboards (and offboards) people.

> The platform runs itself; people are pulled in only when something needs a decision.

**In short**
- **What:** OUs and guardrails per environment, a baseline for every account, changes rolled out in waves, drift and exceptions tracked, all visible in one dashboard.
- **Run it:** `docker compose up --build`, then `npm run demo:seed` ([Run it](#run-it)).
- **Demo:** five steps in five minutes ([The 5-minute demo](#the-5-minute-demo--jans-first-day)).
- **Honest scope:** what is real and what is simulated is in [one table](#real-simulated-and-what-production-would-use); the next steps are in [architecture section 10](docs/architecture.md#10-follow-up-projects-beyond-this-case).

Design: [`docs/architecture.md`](docs/architecture.md) · decisions: [`docs/adr/`](docs/adr/) · operations: [`docs/runbooks/`](docs/runbooks/)

## Run it

Requires Docker and Node 22+.

```bash
npm install                 # for the simulator CLI and tests on your machine
docker compose up --build   # postgres, api, worker, web, mock-receivers
npm run demo:seed           # in a second terminal: load the demo state (~25 s)
```

Port 3000 taken? `API_PORT=3001 docker compose up --build` and run the simulator with
`API_URL=http://localhost:3001` (likewise `WEB_PORT`, `MOCK_PORT` / `MOCK_URL`).

| What | Where |
|---|---|
| Command center (web) | http://localhost:5173 — sign in as **Priya** (platform, operator), **Sam** (security, admin) or **Omar** (cargo developer) |
| API + OpenAPI (Swagger UI) | http://localhost:3000/docs · spec checked in at [`apps/api/openapi.json`](apps/api/openapi.json) |
| Mock Teams / ServiceNow / GitHub | http://localhost:4000/notifications (also the web's Notifications panel) |

```bash
npm test             # Vitest: platform rules, alert routing, wave halting, joiner/mover/leaver, API
npm run typecheck    # every workspace
npm run openapi      # regenerate apps/api/openapi.json from the route schemas
npm run demo:reset   # back to the seed state
docker compose down -v
```

## The 5-minute demo — "Jan's first day"

Keep the browser on http://localhost:5173 next to a terminal. The Notifications panel on the
right shows what reached Teams and ServiceNow. Timings are a guide; the total stays under five
minutes and step 6 is only for spare time.

1. **Overview** (~40 s, sign in as Priya). The estate across Sandbox/Dev/Test/Prod/Core as a
   heatmap, 81 % compliant (17 of 21 accounts), a 30-day trend, the critical items first (a public S3 bucket in
   `crew-dev`, an unsupported module in `crew-prod`, a baseline below minimum in
   `loyalty-sandbox`) and two exceptions: one expiring in 9 days, one expired two days ago —
   which re-opened its finding.
2. **Joiner** (~70 s). `npm run sim -- joiner "Jan" payments` — HR posts a joiner event. Sign
   out, sign in as **Jan**: the onboarding wizard opens with SSO already ✓. Paste a public key
   (a private key is refused), link GitHub, download the VPN profile, review access: Developer
   in payments sandbox/dev/test, **ReadOnly in Prod**, each with an IAM Identity Center link.
   The app shows and links; it never brokers an AWS session.
3. **Drift** (~50 s). `npm run sim -- drift payments-prod` — the nightly plan finds a console
   change: a finding on `payments-prod`, a **high** alert to Payments and a ServiceNow ticket.
   (Dev drift goes to the daily digest instead.) As Priya, **Re-apply baseline**: this
   dispatches `apply-baseline.yml`; when the (simulated) pipeline reports back, the drift
   resolves.
4. **The guardrail in Terraform** (~30 s). In the editor, `terraform/policies/scp/region-allowlist.json`
   (deny everything outside `me-central-1` and `eu-west-1`) and `terraform/org/scps.tf`, which
   attaches it to Root so every OU inherits it. Then (after a one-time
   `terraform init -backend=false` there): `cd terraform/org && terraform test` — 7 runs pass in about 6 s against a mocked AWS
   provider, among them `baseline_guardrails_and_region_list_apply_everywhere`,
   `prod_gets_the_stricter_scp` (Prod OUs get a stricter policy than Dev: environment-specific
   governance) and `adding_a_registry_entry_adds_its_access` (a new registry entry gets exactly
   its access).
5. **Org-wide guardrail in waves** (~70 s). `npm run sim -- rollout region-lock` — the PR is
   merged and the pipeline (`rollout-waves.yml`, played by the GitHub mock) rolls it out
   sandbox → dev → test → prod. One Test account (`cargo-test`) fails, **the pipeline halts the
   Test wave**, platform on-call is alerted and **Prod never receives the change**. Open
   *Rollouts* and press **Retry failed targets** (or `npm run sim -- retry`): the app
   dispatches `apply-baseline.yml` for `cargo-test`; once it is green the pipeline resumes and
   Prod runs.
6. **Assistant (MCP)** — only if time or asked. Point an MCP client at `npm run mcp` (stdio)
   and ask *"Which Prod accounts have drift, and who owns them?"* — answered via
   `list_noncompliant_targets(env: "prod")` through the same API and role checks.

New accounts are not a demo step: the simulator syncs the registry when it seeds. In
production a new account is a pull request to `terraform/registry/accounts.yaml` — see
[docs/architecture.md](docs/architecture.md) 4.1.

Extras: `npm run sim -- leaver omar`, then as **Sam** open *People → Omar Haddad*: every door
closed. `npm run sim -- drift cargo-prod crew-prod loyalty-prod network` shows **grouping**: one
cause in four accounts becomes one alert to platform on-call, not four pages.

## How it fits together

```
GitHub Actions / HR ──POST /v1/events/* (HMAC)──► API ──► events + job, ONE transaction ──► 202
  rollout-waves.yml: runs + halts waves                       │ (pg-boss queue in the same Postgres)
Operator (UI) ──re-apply / retry──► API ──► job ──┐           ▼
                                                  └──► worker: evaluate-target · run-platform-rules
                                                        route-alert · dispatch-workflow
                                                        project-rollout · onboarding-step
                                                              │
                     Teams / ServiceNow ◄── alerts ───────────┤
       GitHub workflow_dispatch: apply-baseline.yml ◄─────────┘   (never AWS)
```

| Path | What |
|---|---|
| `packages/shared` | Domain model as TypeBox schemas (types + JSON Schema + OpenAPI from one source), version catalog, role mapping |
| `packages/db` | Postgres schema (append-only `events` + projections), transaction helper |
| `apps/api` | Fastify, `/v1`. Thin: validate, write event + job in one transaction, answer 202 |
| `apps/worker` | pg-boss consumers. **`src/domain/` is the logic worth reading**: `platform-rules.ts`, `alert-routing.ts`, `rollout-projection.ts`, `onboarding.ts` — pure functions, unit-tested |
| `apps/web` | React + Vite command center |
| `apps/mock-receivers` | Plays Teams, ServiceNow and GitHub; simulates `rollout-waves.yml` and `apply-baseline.yml`, posting the same signed events (wave plan + gate in `src/pipeline.ts`) |
| `apps/mcp` | MCP server: `list_noncompliant_targets`, `get_target`, `list_expiring_exceptions` |
| `simulator/` | CLI that plays the outside world; reads `terraform/registry/accounts.yaml` |

Things to notice:
- **The dashboard aggregates, it does not enforce.** Findings arrive normalised from drift
  (nightly plan), policy (Checkov on the plan) and config (AWS Config / Security Hub). The app
  owns only four platform rules: version supported, golden path not deprecated, owner + team set,
  exception valid / expiring within 14 days.
- **Compliant** = no open high/critical finding that is not waived by an unexpired exception.
  Recording an exception also schedules a re-evaluation of its account at the 14-day warning and
  at the moment it expires, so a waived finding re-opens on time, not at the next nightly run.
- **Outbox:** `apps/api/src/app.ts` (`accept`) and the API test that asserts
  `BEGIN → INSERT events → INSERT pgboss.job → COMMIT` on one connection.
- **Waves ([ADR-014](docs/adr/ADR-014-pipeline-orchestrates-rollouts.md)):** the pipeline is the
  orchestrator. `rollout-waves.yml` halts a wave above its failure threshold (2 %) or on any Prod
  failure, and a halted wave never starts the next — even with the dashboard down. The app
  mirrors `rollout.started` / `apply.result` / `wave.completed`; retry dispatches
  `apply-baseline.yml` per failed target, and when the wave is green the app asks the pipeline to
  resume (`rollout_id` + `resume_after`).
- **Alerts:** Prod drift = high + ticket to the owning team; Dev drift = daily digest; critical =
  team + security + ticket; a halted wave = platform on-call. Deduplicated for 24 h; one cause
  across ≥ 3 accounts is grouped into one platform alert.
- **BI feed:** `GET /v1/analytics/compliance-daily` (`?format=csv`) needs the `analytics.read`
  scope (BI service principal), returns counts per team/env/rule/severity only — no account ids,
  no resource names. A normal user token, even admin, is refused.

## Real, simulated, and what production would use

| Concern | In this PoC | Real? | Production |
|---|---|---|---|
| Terraform (org, SCPs, baseline, golden paths) | Validated and tested with mock providers, never applied | Real code, simulated execution | Applied by GitHub Actions per account, S3 state + locking + KMS |
| Account registry | `terraform/registry/accounts.yaml`, synced via a `registry.sync` event (posted by the simulator's seed) | Real | Same file; `rollout-waves.yml` posts `registry.sync` on merge, then applies the baseline in waves |
| Pipeline results (plan, apply, drift, Checkov) | Posted by the simulator / mock GitHub, HMAC-signed | Simulated | GitHub Actions posting the same payloads (HMAC or OIDC token) |
| Rollout orchestration (waves, gate) | Mock GitHub runs the same plan and gate as `rollout-waves.yml` / `apply-wave.yml` | Workflows real, execution simulated | GitHub Actions, with `lz-prod` approval and soak time |
| AWS Config / Security Hub findings | Posted by the simulator | Simulated | EventBridge → adapter → same normalised finding |
| API, validation, OpenAPI, roles | Fastify + TypeBox | Real | Same, on the `ecs-service` golden path |
| Event log + outbox + queue | Postgres + pg-boss, one transaction | Real | Postgres (RDS) + SQS behind the same job interface, DLQ alarms |
| Worker logic (rules, routing, waves, JML) | Real code | Real | Same; long workflows may move to Step Functions |
| Sign-in | **Simulated Entra ID**: a dev login issues an HS256 JWT shaped like an Entra token (`oid`, `groups`, `roles`) | **Stand-in** | OIDC auth code + PKCE against Entra; API validates RS256 via the tenant JWKS; app roles from group claims |
| Leaver token revocation | Leaver can no longer sign in; an already-issued PoC token lives until expiry (8 h) | Partly | Entra disables the account, revokes refresh tokens; short-lived access tokens + Continuous Access Evaluation |
| AWS access | Grants computed from role × team × env; launch links to IAM Identity Center | Logic real, provisioning simulated | Entra groups → SCIM → Identity Center; PIM for JIT Prod access |
| SSH key, GitHub, VPN steps | Recorded; VPN profile is a placeholder file | Simulated | SSH CA / bastion, GitHub Enterprise SCIM, AWS Client VPN with SAML |
| Teams, ServiceNow, GitHub `workflow_dispatch` | `apps/mock-receivers` | Simulated | Teams workflows/webhooks, ServiceNow Table API, GitHub REST |
| 30-day trend | 29 days of synthetic history + today's live value | Synthetic history | Daily snapshot job (included: `snapshot-compliance`) |
| Secrets | Local defaults in `docker-compose.yml` / `.env.example`, labelled local-only | — | AWS Secrets Manager; nothing in the repo |
| Demo helpers | `/v1/demo/*` (reset, history, queue status), only with `DEMO_MODE=true`, HMAC-protected | Demo only | Not deployed |

Known PoC shortcuts: read models are computed in the API from the projections (fine for 20
accounts; production keeps a per-account projection table); the BI feed's smallest cells
(one account per team × env) would need k-anonymity thresholds before sharing widely; the web
runs on the Vite dev server inside Docker; the webhook HMAC covers the body only (no timestamp), so a
captured request could be replayed — handlers are idempotent, and production uses the pipeline's
short-lived OIDC token or a signed timestamp. The PoC also uses one webhook key for every
pipeline, including the deploy reports from team repositories; production gives deploy
reports their own credential (the job's OIDC token), so a team repo can never sign estate-wide
events. Alert delivery is at-least-once: a retry after a partial failure can repeat a Teams
post or a ticket, so receivers dedupe on the alert's `dedupe_key`.

## Load-tested at 1,000 accounts and 2,000 engineers

On a laptop (Docker, shared with other workloads), so the latencies are pessimistic. Every
result stayed correct: compliance %, access grants, movers and leavers, alert grouping, rollout
halt and retry.

| Scenario | Result |
|---|---|
| Registry sync, 1,000 accounts | ~1 s processing, compliance % matches an independent calculation |
| One nightly drift report for 1,000 accounts (65 KB) | ~1.5 s; 40 Prod accounts with one cause = 1 page + 1 ticket |
| Rollout, 1,000 apply results | ~1,000–1,500 req/s, 0 errors; ~17 s processing; halt and retry correct |
| 2,000 joiners in one burst / 500 movers | 31 s / 6 s; no grant in the wrong team |
| 300 leavers in 60 s | every grant revoked, every checklist recorded within 0.8 s (app side; Entra, GitHub and AWS calls are simulated) |
| 200 viewers polling at once | 0 errors; p50 < 50 ms, p95 ~0.4–1.3 s |

The pipeline side batches accounts per job (`.github/scripts/batch-accounts.sh`), so one
workflow run handles up to ~2,500 accounts, 20 at a time.

**What degrades first is the read side**, not the event pipeline. Future improvements (about a
day of work, architecture section 10): pagination with a total count (the findings list stops at
500), a heatmap grouped by business unit instead of one column per team, a slimmer rollouts
list, aggregation in SQL with ETags, and more API instances.

## Infrastructure

The Terraform landing zone (OUs, SCPs, Identity Center permission sets, the account baseline
and the golden-path modules `ecs-service`, `lambda-api`, `static-site`, `terraform test` with
mock providers) is described in [`terraform/README.md`](terraform/README.md). The paved road
per language — starter templates for Node, PHP/Symfony, .NET, Python and React — is in
[`templates/`](templates/README.md). The GitHub Actions workflows (plan on PR, rollout in
waves, nightly drift, per-language build workflows, the reusable deploy workflow Prod trusts,
CI) are in [`.github/workflows/`](.github/workflows/). Every stack decision has an ADR in
[`docs/adr/`](docs/adr/).
