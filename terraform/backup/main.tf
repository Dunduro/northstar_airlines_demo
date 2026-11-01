# Tier 2 backups: the central, immutable vault in the Backup account (ADR-016).
#
# The org backup policies (terraform/org/backup-policy.tf) copy prod (and critical test) recovery
# points here. What makes it a different failure domain from the workload account:
#   - another account, in the Security OU: a compromised or deleted workload account, or a
#     workload admin, cannot reach these copies
#   - Vault Lock in compliance mode: once the grace period ends, nobody (root included) can
#     delete a copy before its retention ends or remove the lock
#   - its own customer-managed key, held in this account
# It is the SAME region on purpose (data residency); a regional event is not covered here.
# That is the "regional resilience" follow-up in architecture section 10.

locals {
  accounts = yamldecode(file(var.registry_file)).accounts
  account  = one([for a in local.accounts : a if a.name == var.backup_account_name])

  tags = {
    team                = local.account.team
    owner               = local.account.owner
    environment         = local.account.environment
    cost-centre         = "CC-9002"
    data-classification = "confidential"
  }
}

data "aws_organizations_organization" "this" {}

# --- The vault's own key ---------------------------------------------------------------

resource "aws_kms_key" "vault" {
  description             = "Central backup vault key (tier 2 copies)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = local.tags

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Without this the key becomes unmanageable; IAM in this account decides who administers.
        Sid       = "AccountAdministersTheKey"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${local.account.id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        # Accounts in the organisation may use the key only through AWS Backup, to write copies.
        Sid       = "OrgCopiesViaAwsBackupOnly"
        Effect    = "Allow"
        Principal = { AWS = "*" }
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey", "kms:CreateGrant"]
        Resource  = "*"
        Condition = {
          StringEquals = {
            "aws:PrincipalOrgID" = data.aws_organizations_organization.this.id
            "kms:ViaService"     = "backup.${var.home_region}.amazonaws.com"
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "vault" {
  name          = "alias/northstar/backup-central"
  target_key_id = aws_kms_key.vault.key_id
}

# --- The vault, its lock and who may copy into it ---------------------------------------

resource "aws_backup_vault" "central" {
  name        = var.vault_name
  kms_key_arn = aws_kms_key.vault.arn
  tags        = local.tags
}

# Compliance mode = changeable_for_days is set. Without it the lock is governance mode, which
# privileged users can remove. That is exactly what tier 2 must not allow.
resource "aws_backup_vault_lock_configuration" "central" {
  backup_vault_name   = aws_backup_vault.central.name
  min_retention_days  = var.min_retention_days
  max_retention_days  = var.max_retention_days
  changeable_for_days = var.lock_grace_days
}

resource "aws_backup_vault_policy" "central" {
  backup_vault_name = aws_backup_vault.central.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CopiesFromOrgAccountsOnly"
      Effect    = "Allow"
      Principal = { AWS = "*" }
      Action    = "backup:CopyIntoBackupVault"
      Resource  = "*"
      Condition = { StringEquals = { "aws:PrincipalOrgID" = data.aws_organizations_organization.this.id } }
    }]
  })
}
