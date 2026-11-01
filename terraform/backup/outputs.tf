output "vault_arn" {
  description = "Central vault; must equal terraform/org's central_backup_vault_arn."
  value       = aws_backup_vault.central.arn
}

output "vault_lock" {
  description = "Vault Lock settings in effect."
  value = {
    mode               = aws_backup_vault_lock_configuration.central.changeable_for_days == null ? "governance" : "compliance"
    min_retention_days = aws_backup_vault_lock_configuration.central.min_retention_days
    max_retention_days = aws_backup_vault_lock_configuration.central.max_retention_days
  }
}

output "restore_testing_plan" {
  description = "Restore testing plan name (each result is an EventBridge event; forwarding them to the dashboard is a follow-up)."
  value       = aws_backup_restore_testing_plan.weekly.name
}

output "restore_network" {
  description = "Isolated restore VPC the restore tests use (no route out)."
  value = {
    vpc_id             = aws_vpc.restore.id
    db_subnet_group    = aws_db_subnet_group.restore.name
    security_group_id  = aws_security_group.restore.id
    availability_zones = sort([for s in aws_subnet.restore : s.availability_zone])
  }
}
