# Runs entirely offline: the AWS provider is mocked, nothing is created.
#   cd terraform/org && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_organizations_organization" {
    defaults = {
      roots = [{ id = "r-mock", arn = "arn:aws:organizations::111111111111:root/o-mock/r-mock", name = "Root", policy_types = [
        { type = "SERVICE_CONTROL_POLICY", status = "ENABLED" },
        { type = "BACKUP_POLICY", status = "ENABLED" },
      ] }]
    }
  }

  mock_data "aws_ssoadmin_instances" {
    defaults = {
      arns               = ["arn:aws:sso:::instance/ssoins-mock"]
      identity_store_ids = ["d-mock"]
    }
  }

  # The provider validates id formats, so mocked ids must look real.
  mock_resource "aws_organizations_organizational_unit" {
    defaults = { id = "ou-mock-00000000" }
  }

  mock_resource "aws_organizations_policy" {
    defaults = { id = "p-mock0000" }
  }

  mock_resource "aws_ssoadmin_permission_set" {
    defaults = { arn = "arn:aws:sso:::permissionSet/ssoins-mock/ps-mock0000000000" }
  }

  # Real group ids are UUIDs; the provider validates the format.
  mock_data "aws_identitystore_group" {
    defaults = {
      group_id = "9a6721d4-50a1-7071-1c3a-4ac1a2b3c4d5"
    }
  }
}

# Give the Prod OU a distinct id so the attachment test proves it targets that OU.
override_resource {
  target = aws_organizations_organizational_unit.workloads["Prod"]
  values = { id = "ou-mock-00000prod" }
}

run "prod_gets_the_stricter_scp" {
  command = apply

  assert {
    condition     = contains(output.effective_scps["Workloads/Prod"], "prod-strict")
    error_message = "Workloads/Prod must get the prod-strict SCP."
  }

  assert {
    condition     = !contains(output.effective_scps["Workloads/Dev"], "prod-strict") && !contains(output.effective_scps["Workloads/Test"], "prod-strict")
    error_message = "Dev and Test must not get the prod-strict SCP."
  }

  assert {
    condition     = aws_organizations_policy_attachment.scp["Workloads/Prod:prod-strict"].target_id == aws_organizations_organizational_unit.workloads["Prod"].id
    error_message = "prod-strict must be attached to the Prod OU itself."
  }

  assert {
    condition = contains(
      [for s in jsondecode(aws_organizations_policy.scp["prod-strict"].content).Statement : s.Sid],
      "ProtectPlatformRoles"
    )
    error_message = "prod-strict must protect the deploy role from being edited."
  }
}

run "baseline_guardrails_and_region_list_apply_everywhere" {
  command = apply

  assert {
    condition     = alltrue([for ou, scps in output.effective_scps : contains(scps, "region-allowlist") && contains(scps, "guardrails-baseline")])
    error_message = "Every OU must inherit the region allow-list and baseline guardrails from Root."
  }

  assert {
    condition = (
      jsondecode(aws_organizations_policy.scp["region-allowlist"].content).Statement[0].Condition.StringNotEquals["aws:RequestedRegion"]
      == ["me-central-1", "eu-west-1"]
    )
    error_message = "Only me-central-1 and eu-west-1 may be allowed."
  }

  assert {
    condition     = jsondecode(aws_organizations_policy.scp["region-allowlist"].content).Statement[0].Effect == "Deny"
    error_message = "The region allow-list must be a Deny with NotAction for global services."
  }

  assert {
    condition     = contains(output.effective_scps["Suspended"], "deny-all")
    error_message = "Suspended accounts must be denied everything."
  }
}

run "registry_drives_access_assignments" {
  command = apply

  assert {
    condition     = output.access_assignments["payments-dev/developer"].permission_set == "Developer"
    error_message = "Developers deploy and debug in Dev."
  }

  assert {
    condition     = output.access_assignments["payments-prod/developer"].permission_set == "ReadOnly"
    error_message = "Developers are read-only in Prod."
  }

  assert {
    condition     = output.access_assignments["payments-prod/developer"].group == "aws-payments-developer"
    error_message = "Team-scoped groups must be named after the team in the registry."
  }

  assert {
    condition     = output.access_assignments["payments-prod/platform-engineer"].permission_set == "ReadOnly"
    error_message = "Platform engineers have no standing admin in Prod (JIT only)."
  }

  assert {
    condition     = output.access_assignments["payments-prod/platform-engineer-jit"].group == "aws-platform-engineer-prod-jit"
    error_message = "Admin in Prod comes only from the just-in-time group."
  }

  assert {
    condition     = length([for k, v in output.access_assignments : k if startswith(k, "cargo-") && v.group == "aws-payments-developer"]) == 0
    error_message = "A team's groups must never reach another team's accounts."
  }
}

run "adding_a_registry_entry_adds_its_access" {
  command = apply

  variables {
    registry_file = "tests/fixtures/two-accounts.yaml"
  }

  # The fixture has no Backup account; that check is expected to fail (see the last run).
  expect_failures = [check.backup_account_in_registry]

  # 2 accounts x (developer, lead-developer, platform-engineer, security-audit) + 1 prod JIT
  assert {
    condition     = length(aws_ssoadmin_account_assignment.this) == 9
    error_message = "Expected 9 assignments for one dev and one prod account."
  }

  assert {
    condition     = aws_ssoadmin_account_assignment.this["baggage-prod/developer"].target_id == "200000000103"
    error_message = "Assignments must target the account id from the registry."
  }
}

run "unknown_ou_is_rejected" {
  command = plan

  variables {
    registry_file = "tests/fixtures/unknown-ou.yaml"
  }

  expect_failures = [var.registry_file]
}

run "backups_follow_the_ou_and_copy_prod_to_the_central_vault" {
  command = apply

  assert {
    condition     = output.central_backup_vault_arn == "arn:aws:backup:me-central-1:100000000005:backup-vault:northstar-central"
    error_message = "The central vault is in the Backup account from the registry, in the home region."
  }

  assert {
    condition = (
      aws_organizations_policy_attachment.backup["Workloads/Prod"].target_id == aws_organizations_organizational_unit.workloads["Prod"].id
      && aws_organizations_policy_attachment.backup["Workloads/Prod"].policy_id == aws_organizations_policy.backup["prod"].id
    )
    error_message = "The prod backup policy must attach to the Prod OU."
  }

  assert {
    condition     = !contains(keys(output.backup_policy_attachments), "Sandbox") && !contains(keys(output.backup_policy_attachments), "Security")
    error_message = "Sandbox is not backed up, and the Backup account (Security OU) never backs up into itself."
  }

  assert {
    condition = alltrue([
      for plan in values(output.backup_policies["prod"].plans) : alltrue([
        for rule in values(plan.rules) : contains(keys(rule.copy_actions), output.central_backup_vault_arn)
      ])
    ])
    error_message = "Every prod backup rule must copy to the central vault (tier 2)."
  }

  assert {
    condition     = !can(output.backup_policies["dev"].plans["northstar-dev-critical"].rules.daily.copy_actions)
    error_message = "Dev keeps tier 1 only: no copy to the central vault."
  }

  assert {
    condition = alltrue([
      for env, p in output.backup_policies : alltrue([
        for plan in values(p.plans) : alltrue([
          for sel in values(plan.selections.tags) : sel.tag_key["@@assign"] == "backup"
        ]) && plan.regions["@@assign"] == ["me-central-1"]
      ])
    ])
    error_message = "Plans select resources by the `backup` tag and run in me-central-1 only."
  }

  assert {
    condition = alltrue(flatten([
      for p in values(output.backup_policies) : [
        for plan in values(p.plans) : [
          for rule in values(plan.rules) : [
            for c in values(try(rule.copy_actions, {})) : tonumber(c.lifecycle.delete_after_days["@@assign"]) >= 7 && tonumber(c.lifecycle.delete_after_days["@@assign"]) <= 400
          ]
        ]
      ]
    ]))
    error_message = "Copy retention must fit the central vault's Vault Lock bounds (7..400 days), or copies fail."
  }

  assert {
    condition     = aws_backup_global_settings.org.global_settings["isCrossAccountBackupEnabled"] == "true"
    error_message = "Cross-account copies must be enabled for the organisation."
  }
}

run "no_backup_account_means_no_copy_target" {
  command = apply

  variables {
    registry_file = "tests/fixtures/two-accounts.yaml"
  }

  # The check warns in a real plan; in a test a failed check is reported, so expect it.
  expect_failures = [check.backup_account_in_registry]

  assert {
    condition     = output.central_backup_vault_arn == null && !can(output.backup_policies["prod"].plans["northstar-prod-critical"].rules.daily.copy_actions)
    error_message = "Without a Backup account in the registry there is no copy target (and the check warns)."
  }
}
