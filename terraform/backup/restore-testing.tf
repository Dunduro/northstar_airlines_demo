# Restore testing: a backup nobody has restored is a hope, not a backup.
#
# Every week AWS Backup restores the latest Aurora copy in this vault into the isolated restore
# VPC (restore-network.tf), keeps it for the validation window and deletes it again. Each job's
# result is an event (EventBridge, "Restore Job State Change"). Turning it into a finding per
# source account, so the dashboard can show "last successful restore N days ago" next to drift
# and Config findings, is a follow-up (architecture section 10): not coded in the PoC.

resource "aws_iam_role" "restore_testing" {
  name        = "northstar-restore-testing"
  description = "Assumed by AWS Backup to run scheduled restore tests from the central vault."
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account.id } }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "restore_testing" {
  role       = aws_iam_role.restore_testing.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

# Names allow letters, digits and underscores only.
resource "aws_backup_restore_testing_plan" "weekly" {
  name                         = "northstar_weekly_restore_test"
  schedule_expression          = "cron(0 3 ? * SAT *)"
  schedule_expression_timezone = "Asia/Dubai"
  start_window_hours           = 24

  recovery_point_selection {
    algorithm             = "LATEST_WITHIN_WINDOW"
    include_vaults        = [aws_backup_vault.central.arn]
    recovery_point_types  = ["SNAPSHOT"]
    selection_window_days = 7
  }

  tags = local.tags
}

resource "aws_backup_restore_testing_selection" "aurora" {
  name                      = "aurora_clusters"
  restore_testing_plan_name = aws_backup_restore_testing_plan.weekly.name
  protected_resource_type   = "Aurora"
  iam_role_arn              = aws_iam_role.restore_testing.arn
  protected_resource_arns   = ["*"]
  validation_window_hours   = 4

  # Restore into the isolated restore VPC (restore-network.tf), never next to anything real.
  #
  # Keys: AWS Backup's restore metadata for Aurora (camelCase, as in the GetRestoreJobMetadata
  # output); the provider types this as an untyped map(string), so neither `terraform validate`
  # nor the mocked tests can check them.
  # ASSUMPTION (unverified against a real restore): `dbSubnetGroupName` and `vpcSecurityGroupIds`
  # are overridable for Aurora restore testing (AWS docs, "Restore testing inferred metadata"),
  # and `vpcSecurityGroupIds` takes a JSON-encoded list. If the group override were ignored, the
  # cluster gets the VPC's default group, which has no rules (restore-network.tf), so it stays
  # unreachable either way. Verify with the first restore job in a real Backup account.
  restore_metadata_overrides = {
    dbSubnetGroupName   = aws_db_subnet_group.restore.name
    vpcSecurityGroupIds = jsonencode([aws_security_group.restore.id])
  }
}
