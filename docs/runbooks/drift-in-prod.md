# Runbook: drift in a Prod account

**Trigger / alert.** `nightly-drift.yml` runs `terraform plan -detailed-exitcode` per account
with the read-only role; exit code 2 means reality no longer matches the code. It posts a
`drift.result`; the platform opens a `terraform-drift` finding and routes it: **Prod and core
drift = high, to the owning team's Teams channel, plus a ServiceNow ticket** (Dev/Test drift
goes to the daily digest). The same cause in three or more accounts is grouped into **one**
alert to platform on-call instead. AWS Config / Security Hub findings arrive the same way for
changes that never touched a pipeline.

**Impact.** Prod runs something nobody reviewed. Until it is resolved, the account is not
compliant on the dashboard, and the next rollout or deploy may silently overwrite the change.

**Who.** The owning team (from the registry) for its own resources. Platform on-call for
platform-owned resources (deploy role, guardrails, logging, backup vault) and for grouped
alerts.

**Steps.**
1. Open the alert link: the account page shows the drifted resource and the nightly run.
2. Read the plan in the run: what changed, and in which direction.
3. Find who changed it: CloudTrail in the Log Archive account, filtered on the resource. An
   unknown or unexpected principal is a security incident — stop and escalate (below).
4. Decide, with the owner:
   - **Platform-owned resource:** re-apply. *Re-apply baseline* on the account (operator
     role) dispatches `apply-baseline.yml`; Prod waits for the `lz-prod` approval.
   - **Team resource, the change was a mistake:** redeploy the current release through the
     team's pipeline (`reusable-deploy.yml`); the release manifest says what should run.
   - **Team resource, the change was needed** (e.g. a hot fix during an incident): codify it in
     a pull request to the team's infra, then deploy. Never leave it as drift.
5. Close the ServiceNow ticket with the cause and the chosen action.

**Verify.** The `apply.result` (or the team's deploy) succeeds; the drift finding resolves on
the account page. Run `nightly-drift.yml` by hand (`workflow_dispatch`) if you do not want to
wait for the night: exit code 0 for the account.

**Escalate.** Unknown principal, or drift on security tooling, logging or IAM: security,
following the security-incident path (architecture 6.5: contain first, investigate second).
Drift the owner cannot explain within one working day: the team's lead.

**Prevent.** In Prod nobody has standing console write access — deploys go through the
pipeline, admin is just-in-time through PIM — so Prod drift should be rare. Drift that repeats
on the same resource is a design smell: the module is missing an option the team needs, so fix
the module.

*Real in the PoC:* drift finding, routing, ticket, grouping, re-apply via `apply-baseline.yml`
(`npm run sim -- drift payments-prod`). *Design:* CloudTrail lookup, automatic re-apply of
platform-owned resources.
