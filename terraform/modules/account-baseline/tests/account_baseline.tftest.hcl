# Runs entirely offline: the AWS provider is mocked, nothing is created.
#   cd terraform/modules/account-baseline && terraform init -backend=false && terraform test

mock_provider "aws" {}

variables {
  account_id          = "100000000103"
  account_name        = "payments-prod"
  environment         = "prod"
  team                = "payments"
  owner               = "payments-lead@northstar.example"
  cost_centre         = "CC-1001"
  data_classification = "confidential"
  baseline_version    = "2.3.0"
}

run "prod_deploy_role_trusts_only_the_platform_deploy_workflow" {
  command = plan

  assert {
    condition     = length(jsondecode(aws_iam_role.deploy.assume_role_policy).Statement) == 1
    error_message = "The deploy role must have exactly one way in."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Principal.Federated
      == "arn:aws:iam::100000000103:oidc-provider/token.actions.githubusercontent.com"
    )
    error_message = "Only the GitHub OIDC provider may assume the deploy role."
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringLike["token.actions.githubusercontent.com:sub"]
      == ["repo:northstar/payments-*:environment:prod:job_workflow_ref:northstar/platform-workflows/.github/workflows/reusable-deploy.yml@refs/tags/v*"]
    )
    error_message = "Prod must only trust released versions of the platform's reusable deploy workflow, from the team's repos, in the prod environment."
  }

  assert {
    condition     = jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    error_message = "The token audience must be STS."
  }
}

run "dev_also_trusts_unreleased_platform_workflow_from_main" {
  command = plan

  variables {
    account_id          = "100000000101"
    account_name        = "payments-dev"
    environment         = "dev"
    data_classification = "internal"
  }

  assert {
    condition = alltrue([
      for s in output.trusted_subjects :
      strcontains(s, ":job_workflow_ref:northstar/platform-workflows/.github/workflows/reusable-deploy.yml@")
    ])
    error_message = "Every trusted subject must still require the platform's reusable deploy workflow."
  }

  assert {
    condition     = contains(output.trusted_subjects, "repo:northstar/payments-*:environment:dev:job_workflow_ref:northstar/platform-workflows/.github/workflows/reusable-deploy.yml@refs/heads/main")
    error_message = "Dev should accept the platform workflow from main, so platform changes can be tested."
  }
}

run "mandatory_tags_are_present" {
  command = plan

  assert {
    condition = alltrue([
      for k in ["cost-centre", "owner", "environment", "team", "data-classification"] :
      contains(keys(aws_iam_role.deploy.tags), k) && contains(keys(aws_kms_key.account.tags), k) && contains(keys(aws_budgets_budget.monthly.tags), k)
    ])
    error_message = "cost-centre, owner, environment, team and data-classification are mandatory on every taggable resource."
  }

  assert {
    condition     = aws_iam_role.deploy.tags["environment"] == "prod" && aws_iam_role.deploy.tags["team"] == "payments"
    error_message = "Tags must carry the registry values."
  }
}

run "account_guardrails_follow_the_prod_profile" {
  command = plan

  assert {
    condition     = aws_ebs_encryption_by_default.this.enabled
    error_message = "EBS encryption by default must be on."
  }

  assert {
    condition = alltrue([
      aws_s3_account_public_access_block.this.block_public_acls,
      aws_s3_account_public_access_block.this.block_public_policy,
      aws_s3_account_public_access_block.this.ignore_public_acls,
      aws_s3_account_public_access_block.this.restrict_public_buckets,
    ])
    error_message = "All four S3 account-level public access blocks must be on."
  }

  assert {
    condition     = aws_budgets_budget.monthly.limit_amount == "10000"
    error_message = "Prod accounts get the prod budget profile."
  }
}

run "invalid_inputs_are_rejected" {
  command = plan

  variables {
    data_classification = "secret-ish"
    cost_centre         = "payments"
  }

  expect_failures = [var.data_classification, var.cost_centre]
}

run "tier_one_backups_land_in_an_encrypted_local_vault" {
  command = apply

  # Mocked ARNs are random strings; the provider validates ARN-typed arguments.
  override_resource {
    target = aws_kms_key.account
    values = { arn = "arn:aws:kms:me-central-1:100000000103:key/00000000-0000-0000-0000-000000000001" }
  }

  assert {
    condition     = aws_backup_vault.local.name == "northstar-local" && aws_backup_vault.local.kms_key_arn == aws_kms_key.account.arn
    error_message = "The org backup policy writes to northstar-local, encrypted with the account key."
  }

  assert {
    condition     = jsondecode(aws_iam_role.backup.assume_role_policy).Statement[0].Principal.Service == "backup.amazonaws.com" && aws_iam_role.backup.name == "northstar-backup"
    error_message = "Only AWS Backup assumes the role the org backup policy names."
  }

  assert {
    condition     = !contains([for st in jsondecode(aws_kms_key.account.policy).Statement : st.Sid], "BackupAccountCopiesSnapshots")
    error_message = "Without a Backup account, nobody outside the account may use its key."
  }

  assert {
    condition     = alltrue([for k in ["cost-centre", "owner", "environment", "team", "data-classification"] : contains(keys(aws_backup_vault.local.tags), k)])
    error_message = "The vault carries the mandatory tags."
  }
}

run "backup_account_may_use_the_key_for_snapshot_copies_only" {
  command = plan

  variables {
    backup_account_id = "100000000005"
  }

  assert {
    condition = one([
      for st in jsondecode(aws_kms_key.account.policy).Statement : st if st.Sid == "BackupAccountCopiesSnapshots"
    ]).Principal.AWS == "arn:aws:iam::100000000005:root"
    error_message = "The Backup account must be able to use the key, or encrypted Aurora/RDS copies fail."
  }

  assert {
    condition = !contains(one([
      for st in jsondecode(aws_kms_key.account.policy).Statement : st if st.Sid == "BackupAccountCopiesSnapshots"
    ]).Action, "kms:*")
    error_message = "The Backup account uses the key; it never administers it."
  }
}
