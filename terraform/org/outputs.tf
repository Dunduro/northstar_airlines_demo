output "ou_ids" {
  description = "OU path (as used in the registry) => OU id."
  value       = local.ou_ids
}

output "scp_attachments" {
  description = "Which SCPs attach directly to which target."
  value       = local.scp_attachments
}

output "effective_scps" {
  description = "SCPs that apply to accounts in each OU, including those inherited from Root and parent OUs."
  value = {
    for ou in keys(local.ou_ids) : ou => distinct(concat(
      local.scp_attachments["Root"],
      lookup(local.scp_attachments, split("/", ou)[0], []),
      lookup(local.scp_attachments, ou, []),
    ))
  }
}

output "access_assignments" {
  description = "account/role => group and permission set. The dashboard's 'My access' view shows the same matrix."
  value       = { for k, v in local.assignments : k => { account = v.account_name, group = v.group, permission_set = v.permission_set } }
}

output "backup_policies" {
  description = "Backup policy per environment profile, decoded (what the org enforces)."
  value       = { for k, p in aws_organizations_policy.backup : k => jsondecode(p.content) }
}

output "backup_policy_attachments" {
  description = "OU path => backup profile attached to it."
  value       = local.backup_policy_attachments
}

output "central_backup_vault_arn" {
  description = "Tier-2 copy target in the Backup account (null when the registry has no Backup account)."
  value       = local.central_vault_arn
}
