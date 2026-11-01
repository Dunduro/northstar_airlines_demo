output "deploy_role_arn" {
  description = "Role the platform's reusable deploy workflow assumes in this account."
  value       = aws_iam_role.deploy.arn
}

output "deploy_role_trust_policy" {
  description = "The deploy role trust policy (JSON)."
  value       = aws_iam_role.deploy.assume_role_policy
}

output "trusted_subjects" {
  description = "OIDC subject patterns the deploy role accepts."
  value       = local.trusted_subjects
}

output "tags" {
  description = "Tags applied to every taggable baseline resource."
  value       = local.tags
}

output "profile" {
  description = "The environment profile in effect."
  value       = local.profile
}

output "kms_key_arn" {
  description = "Account default KMS key (also the default EBS key)."
  value       = aws_kms_key.account.arn
}

output "backup_vault_name" {
  description = "In-account vault (tier 1) the org backup policy writes to."
  value       = aws_backup_vault.local.name
}

output "backup_account_id" {
  description = "Backup account allowed to use the account key for tier-2 copies (null = none)."
  value       = var.backup_account_id
}
