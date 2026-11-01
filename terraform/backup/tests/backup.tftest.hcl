# The central backup vault (tier 2). Runs offline against a mocked provider.
#   cd terraform/backup && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_organizations_organization" {
    defaults = { id = "o-mock123456" }
  }
  # The provider validates ARN-typed arguments; mocked ARNs must look real.
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:me-central-1:100000000005:key/00000000-0000-0000-0000-000000000005" }
  }
  mock_resource "aws_backup_vault" {
    defaults = { arn = "arn:aws:backup:me-central-1:100000000005:backup-vault:northstar-central" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::100000000005:role/northstar-restore-testing" }
  }
  mock_resource "aws_security_group" {
    defaults = { id = "sg-0restore00000001" }
  }
}

run "vault_is_locked_in_compliance_mode" {
  command = apply

  assert {
    condition     = output.vault_lock.mode == "compliance" && aws_backup_vault_lock_configuration.central.changeable_for_days == 3
    error_message = "The lock must be compliance mode (changeable_for_days set): after the grace period nobody, root included, can remove it."
  }

  assert {
    condition     = output.vault_lock.min_retention_days == 7 && output.vault_lock.max_retention_days >= 365
    error_message = "Copies are kept at least 7 days and the lock must allow the 365-day monthly copies."
  }

  assert {
    condition     = aws_backup_vault.central.name == "northstar-central"
    error_message = "The vault name must match what the org backup policies copy into."
  }
}

run "vault_has_its_own_rotating_key" {
  command = apply

  assert {
    condition     = aws_backup_vault.central.kms_key_arn == aws_kms_key.vault.arn && aws_kms_key.vault.enable_key_rotation
    error_message = "The central vault is encrypted with its own customer-managed key, rotation on."
  }

  assert {
    condition = alltrue([
      for st in jsondecode(aws_kms_key.vault.policy).Statement : (
        st.Condition.StringEquals["aws:PrincipalOrgID"] == "o-mock123456"
        && st.Condition.StringEquals["kms:ViaService"] == "backup.me-central-1.amazonaws.com"
        && !contains(st.Action, "kms:*")
      ) if st.Sid != "AccountAdministersTheKey"
    ])
    error_message = "Outside this account, the key may only be used by org accounts, through AWS Backup, never administered."
  }
}

run "only_org_accounts_may_copy_in" {
  command = apply

  assert {
    condition     = length(jsondecode(aws_backup_vault_policy.central.policy).Statement) == 1
    error_message = "The vault policy grants exactly one thing."
  }

  assert {
    condition = (
      jsondecode(aws_backup_vault_policy.central.policy).Statement[0].Action == "backup:CopyIntoBackupVault"
      && jsondecode(aws_backup_vault_policy.central.policy).Statement[0].Condition.StringEquals["aws:PrincipalOrgID"] == "o-mock123456"
    )
    error_message = "Only accounts in this organisation may copy into the vault, and only copy."
  }
}

run "aurora_copies_are_restore_tested_weekly" {
  command = apply

  assert {
    condition = (
      aws_backup_restore_testing_plan.weekly.recovery_point_selection[0].include_vaults == toset([aws_backup_vault.central.arn])
      && aws_backup_restore_testing_plan.weekly.schedule_expression_timezone == "Asia/Dubai"
    )
    error_message = "Restore tests run against the copies in the central vault, on a schedule."
  }

  assert {
    condition     = aws_backup_restore_testing_selection.aurora.protected_resource_type == "Aurora" && aws_backup_restore_testing_selection.aurora.restore_testing_plan_name == aws_backup_restore_testing_plan.weekly.name
    error_message = "Aurora clusters are selected for restore testing."
  }

  assert {
    condition = (
      aws_backup_restore_testing_selection.aurora.restore_metadata_overrides["dbSubnetGroupName"] == aws_db_subnet_group.restore.name
      && aws_db_subnet_group.restore.name == "northstar-restore-test"
      && jsondecode(aws_backup_restore_testing_selection.aurora.restore_metadata_overrides["vpcSecurityGroupIds"]) == [aws_security_group.restore.id]
    )
    error_message = "Test restores land in the isolated restore VPC's subnet group and security group, never next to anything real."
  }

  assert {
    condition     = toset(aws_db_subnet_group.restore.subnet_ids) == toset([for s in aws_subnet.restore : s.id])
    error_message = "The restore DB subnet group consists of the isolated restore subnets only."
  }
}

run "restore_vpc_has_no_way_out" {
  command = apply

  # Absence cannot be asserted on a resource that does not exist, so check the source: this
  # root declares no gateway or attachment that could give the restore VPC a path out.
  assert {
    condition = alltrue([
      for f in fileset(path.module, "*.tf") :
      !can(regex("resource\\s+\"aws_(internet_gateway|egress_only_internet_gateway|nat_gateway|ec2_transit_gateway_vpc_attachment|vpc_peering_connection|vpn_gateway|eip)\"", file("${path.module}/${f}")))
    ])
    error_message = "No internet gateway, NAT, Transit Gateway attachment, peering, VPN or Elastic IP in the Backup account."
  }

  assert {
    condition = (
      length(aws_route_table.restore.route) == 0
      && alltrue([for k, s in aws_subnet.restore : aws_route_table_association.restore[k].route_table_id == aws_route_table.restore.id])
    )
    error_message = "Every restore subnet uses the route table with no routes (only the implicit local route)."
  }

  assert {
    condition     = alltrue([for s in aws_subnet.restore : !s.map_public_ip_on_launch && s.vpc_id == aws_vpc.restore.id])
    error_message = "Restore subnets are private subnets of the restore VPC."
  }

  assert {
    condition     = length(distinct([for s in aws_subnet.restore : s.availability_zone])) >= 2 && length(aws_subnet.restore) == 3
    error_message = "Restore subnets span at least two AZs (Aurora requires it); all three by default."
  }

  assert {
    condition     = aws_vpc.restore.cidr_block == "10.255.0.0/24" && alltrue([for s in aws_subnet.restore : startswith(s.cidr_block, "10.255.0.") && endswith(s.cidr_block, "/26")])
    error_message = "The restore VPC uses its dedicated, unrouted CIDR and its subnets are carved from it."
  }
}

run "restore_security_group_admits_only_itself" {
  command = apply

  assert {
    condition = alltrue([
      for r in aws_vpc_security_group_ingress_rule.restore_from_self : (
        r.referenced_security_group_id == aws_security_group.restore.id
        && r.cidr_ipv4 == null && r.cidr_ipv6 == null && r.prefix_list_id == null
      )
    ])
    error_message = "Ingress only from the restore security group itself: no CIDR, so no 0.0.0.0/0 and nothing outside the VPC."
  }

  assert {
    condition     = alltrue([for r in aws_vpc_security_group_egress_rule.restore_to_self : r.referenced_security_group_id == aws_security_group.restore.id && r.cidr_ipv4 == null])
    error_message = "Egress only to the restore security group itself."
  }

  assert {
    condition     = length(aws_default_security_group.restore.ingress) == 0 && length(aws_default_security_group.restore.egress) == 0
    error_message = "The restore VPC's default security group has no rules."
  }
}

run "vault_stays_in_the_uae" {
  command = plan

  variables {
    home_region = "eu-west-1"
  }

  expect_failures = [var.home_region]
}

run "lock_without_grace_period_or_short_max_is_rejected" {
  command = plan

  variables {
    lock_grace_days    = 1
    max_retention_days = 90
  }

  expect_failures = [var.lock_grace_days, var.max_retention_days]
}

run "restore_vpc_needs_two_azs" {
  command = plan

  variables {
    restore_azs = ["me-central-1a"]
  }

  expect_failures = [var.restore_azs]
}
