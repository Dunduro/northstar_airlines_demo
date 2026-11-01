# --- Backups, tier 1: what the org backup policy needs in every account -----------------
# The policy (terraform/org/backup-policy.tf) names this vault and this role; resources opt in
# with the tag `backup = standard | critical`. Tier 2 (the immutable copy) is the central vault
# in the Backup account (terraform/backup).

resource "aws_backup_vault" "local" {
  name        = "northstar-local"
  kms_key_arn = aws_kms_key.account.arn
  tags        = local.tags
}

resource "aws_iam_role" "backup" {
  name        = "northstar-backup"
  description = "Assumed by AWS Backup for the org backup policy (backup, copy, restore)."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
  ])

  role       = aws_iam_role.backup.name
  policy_arn = each.value
}
