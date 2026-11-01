# Org-wide AWS Backup policies (architecture 1.6 + "Backup & recovery", ADR-016).
#
# Teams do not write backup plans. A resource opts in with ONE tag, `backup = standard |
# critical`, and the policy attached to its OU decides frequency, retention and whether a copy
# goes to the central, Vault-Locked vault in the Backup account (tier 2). Like the SCPs, the
# policies attach to OUs, so moving an account into Workloads/Prod changes its backups too.
#
# Every account gets the local vault and the role these plans name from account-baseline
# (`northstar-local`, `northstar-backup`); the central vault comes from terraform/backup.

locals {
  # The Backup account comes from the registry like every other account. `one()` gives null
  # when it is missing (e.g. a test fixture): plans then keep tier 1 only, and a check warns.
  backup_account = one([for a in local.accounts : a if a.name == var.backup_account_name])

  central_vault_arn = (local.backup_account == null ? null :
  "arn:aws:backup:${var.home_region}:${local.backup_account.id}:backup-vault:${var.central_backup_vault_name}")

  # Frequency and retention per environment and tier, in days. `copy` = retention of the copy
  # in the central vault (null = no tier-2 copy). Copies must stay inside the central vault's
  # Vault Lock bounds (7..400 days, terraform/backup). These are targets to agree with the data
  # owners in discovery, not numbers anyone has signed off yet.
  backup_profiles = {
    dev = {
      standard = { daily = { keep = 7, copy = null } }
      critical = { daily = { keep = 7, copy = null } }
    }
    test = {
      standard = { daily = { keep = 14, copy = null } }
      critical = { daily = { keep = 14, copy = 14 } }
    }
    prod = {
      standard = { daily = { keep = 35, copy = 35 } }
      critical = { daily = { keep = 35, copy = 90 }, monthly = { keep = 365, copy = 365 } }
    }
  }

  schedules = {
    daily   = "cron(0 22 * * ? *)" # 02:00 UAE, off-peak
    monthly = "cron(0 23 1 * ? *)" # 1st of the month, 03:00 UAE
  }

  # OU => backup profile. Infrastructure holds prod-like shared services (the dashboard's
  # database). Security is deliberately absent: the Backup account must not back up into
  # itself, and Log Archive is protected by S3 Object Lock instead.
  backup_policy_attachments = {
    "Workloads/Dev"  = "dev"
    "Workloads/Test" = "test"
    "Workloads/Prod" = "prod"
    "Infrastructure" = "prod"
  }

  # Organizations backup-policy syntax: every leaf is an "@@assign" operator; `$account` is
  # replaced by AWS with the member account's id.
  backup_policies = {
    for env, tiers in local.backup_profiles : env => {
      plans = {
        for tier, rules in tiers : "northstar-${env}-${tier}" => {
          regions = { "@@assign" = [var.home_region] }
          rules = {
            for rule, r in rules : rule => merge(
              {
                schedule_expression            = { "@@assign" = local.schedules[rule] }
                start_backup_window_minutes    = { "@@assign" = "60" }
                complete_backup_window_minutes = { "@@assign" = "600" }
                target_backup_vault_name       = { "@@assign" = var.local_backup_vault_name }
                lifecycle                      = { delete_after_days = { "@@assign" = tostring(r.keep) } }
              },
              r.copy == null || local.central_vault_arn == null ? {} : {
                copy_actions = {
                  (local.central_vault_arn) = {
                    target_backup_vault_arn = { "@@assign" = local.central_vault_arn }
                    lifecycle               = { delete_after_days = { "@@assign" = tostring(r.copy) } }
                  }
                }
              },
            )
          }
          selections = {
            tags = {
              "backup-${tier}" = {
                iam_role_arn = { "@@assign" = "arn:aws:iam::$account:role/${var.backup_role_name}" }
                tag_key      = { "@@assign" = "backup" }
                tag_value    = { "@@assign" = [tier] }
              }
            }
          }
        }
      }
    }
  }
}

check "backup_account_in_registry" {
  assert {
    condition     = local.backup_account != null
    error_message = "No '${var.backup_account_name}' account in the registry: backups stay in-account (tier 1 only), no immutable copy."
  }
}

# Backup policies are a policy type that must be enabled on the root once, like SCPs
# (`aws organizations enable-policy-type --policy-type BACKUP_POLICY`). The organisation is
# Control Tower's, so Terraform only reads it and warns here instead of owning that switch.
check "backup_policy_type_enabled" {
  assert {
    condition     = contains([for p in data.aws_organizations_organization.this.roots[0].policy_types : p.type if p.status == "ENABLED"], "BACKUP_POLICY")
    error_message = "BACKUP_POLICY is not enabled on the organisation root; the backup policies below will not take effect."
  }
}

# Copies into another account's vault are off by default organisation-wide.
resource "aws_backup_global_settings" "org" {
  global_settings = {
    isCrossAccountBackupEnabled = "true"
  }
}

resource "aws_organizations_policy" "backup" {
  for_each = local.backup_policies

  name        = "northstar-backup-${each.key}"
  description = "NorthStar backups (${each.key}): select by tag backup=standard|critical; tier-2 copies to the central vault."
  type        = "BACKUP_POLICY"
  content     = jsonencode(each.value)
}

resource "aws_organizations_policy_attachment" "backup" {
  for_each = local.backup_policy_attachments

  policy_id = aws_organizations_policy.backup[each.value].id
  target_id = local.ou_ids[each.key]
}
