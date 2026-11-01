# ADR-014: The pipeline orchestrates rollouts; the app observes and dispatches targeted actions

**Status:** Accepted (2026-10-31). Narrows ADR-005 for rollouts: rollout waves are tracked by
the pipeline, not as workflow state in the app.

## Context

A rollout takes one change across every account in waves (sandbox → dev → test → prod) and
must halt a wave when failures exceed its threshold, so that nothing reaches Prod that failed
earlier. Two components could drive it: the platform app (worker advances waves and dispatches
each account) or the pipeline (GitHub Actions runs the waves). Both were built at one point;
having both decide would mean two sources of truth for "may Prod start?".

The architecture's rule is that if the dashboard is down, nothing breaks: automation and
alerts run independently of it (architecture §6.8).

## Decision

**`rollout-waves.yml` is the orchestrator.** It computes the waves from the registry, applies
each wave's accounts in parallel, and its gate job applies the failure threshold (2 %, any
failure in prod). A halted wave fails the job, so the next wave never starts — enforced by
GitHub, not by the app.

**The app is an observer.** The pipeline reports, HMAC-signed, to `/v1/events/pipeline`:
`rollout.started` (the plan: waves, targets, thresholds), one `apply.result` per account and
`wave.completed` (`succeeded | halted`). The worker projects these into the rollout view and
raises the "wave halted" alert. It never decides that a wave halts or that the next starts.
Reporting is `continue-on-error`: the dashboard being down never blocks or unblocks a rollout.

**The app is a door for targeted actions** (ADR-008), all through one workflow,
`apply-baseline.yml` (one account; inputs `account`, `reason`, optional `rollout_id`):
- *Re-apply baseline* on an account.
- *Retry failed targets* of a halted wave: one dispatch per failed account, with `rollout_id`.
  When those results make the halted wave fully green, the app dispatches
  `rollout-waves.yml` with `rollout_id` + `resume_after`; the remaining waves then run and are
  gated by the pipeline exactly as before.

In the PoC the GitHub mock (`apps/mock-receivers`) plays both workflows and posts the same
events; the wave plan and gate it uses mirror `.github/scripts/wave-accounts.sh` and the gate
in `apply-wave.yml`.

## Alternatives considered

- **The worker orchestrates waves and dispatches per account.** Fine-grained control and nice
  progress tracking, but the dashboard becomes a critical path for every change: if it is down,
  rollouts stop; and the halt decision lives outside the audited pipeline.
- **Retry via GitHub "re-run failed jobs".** Natural inside GitHub and keeps everything in one
  run, but the run's matrix is fixed at start and re-runs are awkward to target and attribute
  from the dashboard. Remains a valid manual path for the platform team.
- **Both decide (pipeline gate + app gate).** Two verdicts that can disagree.

## Consequences

- Positive: one source of truth for halting; rollouts work with the dashboard down.
- Positive: every action, including retry, is a normal reviewed pipeline run with the same
  approvals (prod/core accounts need the `lz-prod` environment approval).
- Negative: the app's rollout view is eventually consistent and depends on the pipeline
  reporting; a missing `wave.completed` leaves a wave shown as running (the run link is the
  source of truth).
- Negative: resuming after a retry is a second `rollout-waves.yml` run; its history spans two
  runs, tied together by `rollout_id`.
