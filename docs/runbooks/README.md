# Runbooks

What to do when the platform pulls a person in. Most of the time nothing here is needed: the
pipelines halt, alert and retry on their own (architecture section 6). A runbook starts where a
decision is needed.

| Runbook | Starts with | First responder |
|---|---|---|
| [Halted rollout wave](halted-rollout-wave.md) | `rollout-halted` alert to platform on-call | Platform on-call |
| [Drift in a Prod account](drift-in-prod.md) | High drift alert + ServiceNow ticket to the owning team | Owning team (platform for baseline resources) |
| [Expiring or expired governance exception](exception-expiry.md) | `exception-expiring` / `exception-expired` alert | Exception owner, then their lead |
| [Break-glass access](break-glass.md) | Identity Center / Entra unavailable during an incident | Two named break-glass holders |

**Template.** Every runbook has the same sections, in the same order: **Trigger / alert ·
Impact · Who · Steps · Verify · Escalate · Prevent.** Steps name the workflow, screen or command
they use; nothing in a runbook is done by hand in an AWS console unless the runbook says so.

**Real vs design.** The alert routing (`apps/worker/src/domain/alert-routing.ts`), the platform
rules (`apps/worker/src/domain/platform-rules.ts`), the dashboard actions and the workflows
(`.github/workflows/`) are real code; in the PoC the workflows are played by the GitHub mock and
nothing is applied to AWS. Break-glass is design only. Each runbook says which parts are which.

**After an incident.** A post-incident review in `docs/incidents/`: summary, impact,
detection, timeline, root cause, actions with owners. Example (tabletop):
[PIR-001: pipeline capacity at 80 %](../incidents/PIR-001-pipeline-capacity.md).

**Keeping them honest.** A runbook is reviewed like code (pull request, CODEOWNERS: platform +
security). After every use, the responder updates it in the same week. A step that keeps
recurring is a candidate for automation — that is how the platform gets more boring over time.

Related: alert routing table in [architecture 5.7](../architecture.md#57-alerting-the-primary-interface),
operating model in [architecture 6](../architecture.md#6-operating-at-scale-boring-by-design),
[ADR-014](../adr/ADR-014-pipeline-orchestrates-rollouts.md) (the pipeline orchestrates rollouts).
