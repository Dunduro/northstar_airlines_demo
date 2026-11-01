# The per-account root: the registry entry alone decides how an account is baselined.
#   cd terraform/baseline && terraform init -backend=false && terraform test

mock_provider "aws" {}

run "registry_entry_drives_the_baseline" {
  command = plan

  variables {
    account_name = "payments-prod"
  }

  assert {
    condition     = output.account.id == "100000000103" && output.account.environment == "prod"
    error_message = "The account must be read from the registry."
  }

  assert {
    condition     = module.baseline.profile.workflow_refs == ["refs/tags/v*"]
    error_message = "A prod registry entry must get the prod profile: released platform workflows only."
  }

  assert {
    condition     = module.baseline.tags["cost-centre"] == "CC-1001" && module.baseline.tags["data-classification"] == "confidential"
    error_message = "Cost centre and classification are derived from team and environment."
  }

  assert {
    condition     = module.baseline.backup_account_id == "100000000005"
    error_message = "Prod accounts let the registry's Backup account copy their encrypted snapshots."
  }
}

run "unknown_account_is_rejected" {
  command = plan

  variables {
    account_name = "not-in-the-registry"
  }

  expect_failures = [var.account_name]
}

run "unapproved_region_is_rejected" {
  command = plan

  variables {
    account_name = "payments-dev"
    region       = "us-east-1"
  }

  expect_failures = [var.region]
}
