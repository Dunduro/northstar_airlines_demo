# terraform/backup — the Backup account

Root module for the Backup account (`backup`, `100000000005`, Security OU): tier 2 of the
backup design (ADR-016, architecture 3.3). One root, one state (`backup/terraform.tfstate`).

| File | What |
|---|---|
| `main.tf` | Central vault `northstar-central`, its own rotating CMK, **Vault Lock in compliance mode**, vault policy (only `CopyIntoBackupVault`, only from the organisation) |
| `restore-testing.tf` | Weekly restore testing plan + Aurora selection, restoring into the isolated restore VPC |
| `restore-network.tf` | The isolated restore VPC: private subnets in all AZs, empty route table, DB subnet group, self-only security group, emptied default security group |
| `tests/backup.tftest.hcl` | Nine runs against a mocked provider |

## Isolated restore network

A restore test is a full copy of production data, so the restore VPC has no path in or out:
no internet gateway, NAT, Transit Gateway attachment, peering or VPN, and a route table that
pins routes to none (an out-of-band route shows up as drift). The restore selection points
AWS Backup at the VPC's DB subnet group and security group through restore metadata
overrides; the security group admits only itself on 5432/3306, and the default group has no
rules, so even a restore without the group override is unreachable.

- **CIDR** `10.255.0.0/24` (`restore_vpc_cidr`), four /26s, one per AZ. **Assumption,
  unverified:** the IPAM pool is not coded in this repo; this block must be excluded from it
  (or reserved) by the network team.
- **No interface endpoints and no flow logs** for now: nothing runs inside the VPC while
  restores are validated by job status, and the baseline sets no flow-log standard. A
  validation Lambda in the VPC would add endpoints for `backup`, `secretsmanager` and `logs`.
- **Override keys, unverified:** `dbSubnetGroupName` and `vpcSecurityGroupIds` (as a JSON
  list) follow AWS's restore testing metadata documentation for Aurora. The provider types
  `restore_metadata_overrides` as `map(string)`, so `validate` and the mocked tests cannot
  check the keys; verify them with the first restore job in a real account.

## Deployment

Not part of the account waves: this root has its own pipeline.

| When | Workflow | Role in the Backup account | Result |
|---|---|---|---|
| PR touching `terraform/backup/**` or `terraform/registry/**` | `plan-on-pr.yml` (job `plan-backup`) | `northstar-platform-plan` (read-only) | plan in the job summary: counts, changed resources, Vault Lock changes flagged |
| Merge to `main` on those paths, or manual run | `apply-backup.yml` | `northstar-platform-baseline` | plan → artifact → approval on environment `lz-backup` → apply of **that** plan file |

Both reach AWS through GitHub OIDC (`PLATFORM_PIPELINE_ROLE_ARN`), and the provider assumes
the role in the Backup account (`versions.tf`). `apply-backup` runs one at a time
(concurrency group `apply-backup`) and skips the apply job when the plan is empty.

**Vault Lock is irreversible.** Compliance mode means that after `lock_grace_days` nobody,
root included, can remove the lock, shorten retention or delete a recovery point early.
`apply-backup` therefore refuses any plan that changes `aws_backup_vault_lock_configuration`
or deletes/replaces the vault, unless it is run by hand with `confirm_vault_lock_change: true`;
the check runs on the plan job's output and again on the exact plan file before apply.
The GitHub environment `lz-backup` must exist with required reviewers from security,
self-review prevented and deployments limited to `main`.

## Run locally

```bash
terraform init -backend=false && terraform validate && terraform test
```
