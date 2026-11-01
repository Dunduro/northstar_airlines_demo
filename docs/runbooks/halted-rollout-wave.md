# Runbook: halted rollout wave

**Trigger / alert.** `rollout-waves.yml` halts a wave when failures exceed its threshold — more
than 2 % of the wave's accounts, or **any** failure in Prod (`apply-wave.yml`,
`failure_threshold`). The platform receives `wave.completed` with a halted status and routes a
`rollout-halted` alert, severity high, to **platform on-call** in Teams (no ticket). The alert
links to *Rollouts → the rollout*.

**Impact.** The change stops where it is. Later waves never start, so Prod does not receive a
change that failed earlier. Accounts that already succeeded keep the new version; the failed
ones keep the old one. Nothing is rolled back automatically, and nothing needs to be: applies
are idempotent.

**Who.** Platform on-call owns the rollout. The author of the change and, for an
account-specific cause, the account's owning team (from the registry) help.

**Steps.**
1. Open the alert link: *Rollouts → <rollout>*. Each failed target shows its error and the
   GitHub run (`apply.result` with `error`, `runUrl`).
2. Classify the failure:
   - **The change is wrong** (fails the same way in many accounts): revert the pull request.
     The revert is a new rollout through the same waves. Do not retry.
   - **The account is different** (e.g. `cargo-test` has a bucket in `eu-central-1`, outside
     the region allow-list): agree with the owning team to fix the resource, or register a
     governance exception with an owner and expiry ([exception runbook](exception-expiry.md)).
   - **Transient** (API throttling, a runner lost, a state lock that has since cleared): retry.
3. Retry: *Retry failed targets* on the rollout (operator role; PoC: `npm run sim -- retry`).
   The app dispatches `apply-baseline.yml` once per failed account with the `rollout_id`.
   Prod and core accounts wait for the `lz-prod` approval, exactly as in the rollout.
4. When the halted wave is green, the platform dispatches `rollout-waves.yml` with
   `rollout_id` and `resume_after`; the remaining waves run with the same gates.

**Verify.** The rollout shows the halted wave green and the next waves progressing, then
`succeeded`. Each retried target has a new succeeded `apply.result` with the expected baseline
version on its account page. No new drift on those accounts in the next nightly run.

**Escalate.** A Prod failure, or a revert that also fails: to the platform lead, and to the
owning team's lead for the affected Prod account. A failure that touches security tooling or
logging: also security.

**Prevent.** New guardrails go to the Policy Staging OU first and run detect-only before
enforce; `plan-on-pr.yml` shows the plan per affected account before merge. Every halt gets a
short note on the rollout: if the cause could have been caught by a `terraform test` or a policy
check, add it.

*Real in the PoC:* the wave plan and gate (`apps/mock-receivers/src/pipeline.ts` plays the
workflows), the halt, the alert, retry and resume. *Not executed:* the GitHub workflows against
AWS.
