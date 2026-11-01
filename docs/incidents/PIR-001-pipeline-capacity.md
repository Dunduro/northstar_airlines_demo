# PIR-001: pipeline capacity at 80 % of the GitHub matrix limit

> **Tabletop example, not a real event.** It shows how the platform team would run a
> pre-emptive capacity incident on this design. The **fix is built**
> (`.github/scripts/batch-accounts.sh`, architecture 6.2). The **capacity check and its alert
> are design** (architecture section 10, *Capacity checks*). The numbers are estimates sized on
> the PoC, not measurements.

| | |
|---|---|
| Severity | SEV-4: capacity risk, **no impact** |
| Status | Resolved, follow-ups open |
| Detected by | Weekly capacity check (alert to platform on-call) |
| Owner | Platform on-call; review by the platform lead |
| Duration | Day 0 to Day 6: alert to fix in production |

## Summary

The estate grew to **205 AWS accounts** after two business units onboarded in the same quarter.
The nightly drift run puts every active account into one GitHub Actions matrix, and **a matrix
is capped at 256 jobs**. The capacity check flagged 205 / 256 = **80 %** of that cap. Without
action, the estate would have reached 256 at the planned onboarding rate in about seven weeks.
From then on the nightly drift run, and any Prod wave of that size, would have failed outright.

The team shipped batching six days later. Accounts are now grouped into at most 200 jobs, and
each job handles its accounts in turn. The limit moved from 256 accounts to roughly 2,500.
Nothing failed, no change was delayed and no team noticed.

## Impact

None. Every nightly drift run and rollout ran normally throughout. This PIR exists because the
team treats a limit at 80 % as an incident to manage, not as a surprise to discover at 100 %.

## Detection

The weekly capacity check compares the registry and the last pipeline runs against known limits:

| Metric | Value | Limit | Use | Status |
|---|---|---|---|---|
| Accounts in the largest matrix (nightly drift) | 205 | 256 jobs | **80 %** | **Alert** |
| Accounts in the largest wave (Prod + core) | 61 | 256 jobs | 24 % | OK |
| AWS Organizations account quota | 205 | 300 (raised once) | 68 % | Watch |
| Nightly drift run duration | 21 min | done by 08:00 UAE (180 min) | 12 % | OK |
| Worker queue (p95 wait) | < 1 s | 60 s | ~0 % | OK |

The alert went to platform on-call in Teams with severity medium and no ticket. Its text:
*"nightly-drift matrix at 80 % of the GitHub job cap (205 / 256). At the current onboarding
rate, 100 % in ~7 weeks."*

## Timeline

| When | What |
|---|---|
| Day 0, 09:10 | Capacity check alert: nightly-drift matrix at 80 %. On-call acknowledges. |
| Day 0, 11:00 | Platform stand-up: confirmed against the registry; the onboarding plan adds ~8 accounts a week. Decision: fix now, as planned work, not a hotfix. |
| Day 0, 15:00 | Second finding from the same check: the account quota is at 68 %. A quota increase request goes to AWS now, because it takes days. |
| Day 1 | Design: batch accounts per job instead of one job per account. Keep 20 in parallel, keep per-account results, keep the wave gate unchanged. |
| Day 2–3 | `batch-accounts.sh` and the three workflows (`plan-on-pr`, `apply-wave`, `nightly-drift`) changed in one PR. Tested against estates of 1, 21, 200, 201, 600 and 2,000 accounts. |
| Day 4 | Reviewed (CODEOWNERS: platform). Ran in Sandbox with a forced failure in one account: the rest of its batch continued and the gate counted it correctly. |
| Day 5 | Merged. The first nightly drift on the new code: 205 accounts in 103 jobs of 2, 22 min, no errors. |
| Day 6 | AWS confirms the quota increase to 1,000 accounts. Capacity check back to green. PIR written. |

## Root cause

The pipeline was designed for "one account, one job". That is the simplest model, and right for a
small estate. The GitHub matrix limit was **known and documented** (architecture 6.2), but nothing
enforced it, so it only became urgent once growth was close to it.

**Contributing:** two business units onboarding in one quarter, about twice the usual rate.

## What went well

- **Detected at 80 %, not at 100 %.** Seven weeks of headway turned an outage into planned work.
- **One check, two findings.** The account quota was raised before it was ever close to a problem.
- **Small, contained fix.** Results stay per account, so the dashboard, alerts and the wave gate
  needed no change.

## What could be better

- The limit was in the documentation, not in a check. A limit we know about should be a
  monitored metric from day one.
- The capacity check ran weekly. At the doubled onboarding rate, a daily check would be safer.

## Actions

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Batch accounts per job in all three workflows | Platform | **Done** |
| 2 | Raise the AWS account quota (300 → 1,000) | Platform lead | **Done** |
| 3 | Run the capacity check daily instead of weekly | Platform | Open |
| 4 | Add the remaining limits as metrics: SCPs per OU (max 5), runner queue time, Identity Center assignments | Platform | Open |
| 5 | Show the capacity table on the dashboard's platform-health view | Platform | Open |
| 6 | Next threshold: plan the move to a dedicated orchestrator or SQS once a run exceeds 1,500 accounts | Platform lead | Planned |

## Lessons

- **Every known limit gets a metric and an 80 % alert.** If we can write it down, we can check it.
- **Fix at 80 % as planned work.** At 100 % the same fix is an outage fix, done under pressure.
- **Lead times count.** Anything that depends on a third party (AWS quotas, a GitHub plan) is
  requested at the first warning, not at the deadline.
