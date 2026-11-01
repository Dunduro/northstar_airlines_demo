# Runbook: expiring or expired governance exception

**Trigger / alert.** The platform rule `exception-valid`
(`apps/worker/src/domain/platform-rules.ts`) checks every exception's expiry date:
- **14 days before expiry:** `exception-expiring`, severity medium, to the owning team's
  channel.
- **On expiry:** `exception-expired`, severity high, to the owning team **and its leads'
  channel**. The waiver stops applying, so the original finding re-opens and counts against
  compliance again.

**Impact.** Before expiry: none yet — this is the notice period. After expiry: the account is
non-compliant for that rule, and in Prod the finding may page again under its own severity.
Nothing is blocked or deleted automatically.

**Who.** The exception's owner (named on the exception). Their lead after expiry. Security
approves any renewal.

**Steps.**
1. Open *Exceptions*: rule, account, owner, reason, compensating control, expiry date.
2. Choose one:
   - **Fix it** (preferred): remove the reason for the exception, e.g. enable Multi-AZ on the
     database or access logging on the bucket. The finding resolves on the next evaluation,
     and the exception can lapse.
   - **Renew it:** a pull request to the exceptions registry with a new expiry date, a current
     reason and the compensating control, reviewed by security (CODEOWNERS). PoC: an admin
     records it via `POST /v1/exceptions` (signed in as Sam). A renewal without a plan to fix
     is the exception debt this process exists to make visible.
   - **Accept the finding:** let it expire; the finding stays open and visible.
3. Note the decision on the exception (or the ServiceNow ticket, if one exists).

**Verify.** *Exceptions* shows the new expiry date, or the finding is resolved on the account
page. The account's compliance status matches the decision.

**Escalate.** Expired and not handled within five working days: the lead escalates to the head
of the product area and security. A rule with many open exceptions across teams: to the
platform team and security as a rule review.

**Prevent.** Exception debt is a metric (open and expired exceptions per rule and team). Many
exceptions on one rule means the rule, or the golden path, needs to change — not that teams are
misbehaving.

*Real in the PoC:* the rule, both alerts, the finding re-opening, the Exceptions view, the
seeded examples (one expiring in 9 days, one expired). *Design:* the exceptions registry in git
with CODEOWNERS review, mirrored to the platform by the pipeline.
