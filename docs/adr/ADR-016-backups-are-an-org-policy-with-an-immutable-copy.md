# ADR-016: Backups are an org policy selected by tag, with an immutable copy in a separate Backup account

**Status:** Accepted (2026-10-31)

## Context

"Backups built in" is one of the promises of the paved road, and the platform is responsible
for the estate's governance. Aurora and DynamoDB back themselves up, but those
backups live in the same account as the data: whoever can delete the database — a bad
pipeline run, a compromised role, ransomware with admin rights, an account closed by mistake —
can usually delete its backups too. At hundreds of accounts, backup plans written per team
also drift: different schedules, forgotten resources, nobody testing a restore.

Data residency keeps NorthStar's data in `me-central-1` (UAE) unless an exception is approved.

## Decision

- **One tag, org-wide policy.** Resources opt in with `backup = standard | critical`. An AWS
  Organizations backup policy per environment, attached to the Workloads OUs and
  Infrastructure (`terraform/org/backup-policy.tf`), decides frequency, retention and copies.
  Teams never write backup plans; moving an account to another OU changes its backups, as it
  does its guardrails.
- **Two tiers.** Tier 1 stays in the account: engine-native point-in-time recovery plus policy
  snapshots into the account's `northstar-local` vault (from `account-baseline`). Tier 2 is a
  copy into `northstar-central` in a **Backup account in the Security OU**, same region,
  protected by **Vault Lock in compliance mode** (7–400 days), its own CMK, and a vault policy
  that only allows `CopyIntoBackupVault` from accounts in the organisation
  (`terraform/backup`). Prod copies every tier; Test copies `critical`; Dev keeps tier 1 only.
- **Restore testing is part of the backup.** A restore testing plan in the Backup account
  restores the latest Aurora copy weekly into an isolated restore VPC in the same account (no
  route out: no internet gateway, NAT or Transit Gateway attachment). Each result is meant to
  become a finding ("last successful restore N days ago") on the dashboard; that forwarding is
  a follow-up (architecture section 10).
- **The Backup account has its own gated pipeline.** `terraform/backup` is applied by
  `apply-backup.yml`: the plan is saved and exactly that plan is applied after approval on a
  protected environment, and a plan that changes the Vault Lock is refused unless explicitly
  confirmed, because a compliance-mode lock cannot be undone after its grace period.
- **The Prod SCP protects the backups**: no deleting vaults or recovery points, no editing the
  vault policy, lock or backup role, except by the platform baseline pipeline.

## Alternatives considered

- **Rely on Aurora / DynamoDB native backups only.** Free and already on, but same account,
  same blast radius, and no restore evidence. Kept as tier 1, not as the whole answer.
- **Per-team backup plans in each module.** Flexible, but N plans to review and keep current,
  and a team can turn its own backups off. Rejected in favour of the org policy.
- **Vault Lock in governance mode.** Reversible by privileged users, which is precisely the
  threat tier 2 exists for. Rejected; compliance mode after a short grace period.
- **Logically air-gapped vault** (AWS Backup's managed, AWS-owned-key vault type). Attractive
  isolation; not chosen for now because NorthStar wants its own CMK and the supported resource
  types must be checked first. Revisit.
- **Copy to another region now.** Covers regional events, but is a data-residency decision
  that legal and the DPO make per data class. Designed as the "regional resilience" follow-up
  (architecture section 10), not built.

## Consequences

- Positive: backups are a guarantee the platform can prove (policy as code, weekly restore
  tests; restore findings on the dashboard once the follow-up is built), not a convention; a compromised workload account cannot destroy its tier-2 copies.
- Positive: one place to change retention for the whole estate, rolled out like any policy.
- Negative: compliance-mode Vault Lock is irreversible — a wrong maximum retention or a mistake
  in the grace period is permanent cost. The lock is set only after the bounds are agreed.
- Negative: Aurora/RDS snapshots keep the source key across accounts, so every account key must
  let the Backup account use it; DynamoDB copies need AWS Backup's advanced DynamoDB features
  enabled per account (follow-up in the baseline).
- Negative: tier 2 is the same region. A regional event is not covered until the regional
  resilience follow-up is approved and built.
- Negative: the `BACKUP_POLICY` policy type must be enabled on the organisation root once
  (Control Tower owns the organisation); Terraform warns if it is not.
