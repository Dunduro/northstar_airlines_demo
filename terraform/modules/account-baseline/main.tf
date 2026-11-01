# Account baseline: what every account gets, whatever runs in it.
# Org-wide CloudTrail, Config and the log archive come from Control Tower; this module adds
# the per-account pieces on top. Inputs differ per environment profile (sandbox ... prod).

locals {
  # Environment profiles: one place where dev, test and prod are allowed to differ.
  profiles = {
    sandbox = { budget_usd = 300, log_retention_days = 7, workflow_refs = ["refs/tags/v*", "refs/heads/main"] }
    dev     = { budget_usd = 1500, log_retention_days = 30, workflow_refs = ["refs/tags/v*", "refs/heads/main"] }
    test    = { budget_usd = 2500, log_retention_days = 90, workflow_refs = ["refs/tags/v*"] }
    prod    = { budget_usd = 10000, log_retention_days = 365, workflow_refs = ["refs/tags/v*"] }
    core    = { budget_usd = 5000, log_retention_days = 365, workflow_refs = ["refs/tags/v*"] }
  }
  profile = local.profiles[var.environment]

  # Mandatory tags (also enforced by tag policies and the Checkov check on every plan).
  mandatory_tags = {
    cost-centre         = var.cost_centre
    owner               = var.owner
    environment         = var.environment
    team                = var.team
    data-classification = var.data_classification
  }
  tags = merge(local.mandatory_tags, {
    account          = var.account_name
    baseline-version = var.baseline_version
    managed-by       = "terraform"
  })
}

# --- Encryption by default -------------------------------------------------------------

resource "aws_kms_key" "account" {
  description             = "${var.account_name} default key (EBS and team workloads)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = local.tags

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        # The default key policy: IAM in this account decides who uses and administers the key.
        Sid       = "AccountAdministersTheKey"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      }],
      # Aurora/RDS snapshots keep the source key when copied to another account (they are not
      # "fully managed" by AWS Backup), so the Backup account must be able to use this key or
      # the tier-2 copy fails. Use only, no administration.
      var.backup_account_id == null ? [] : [{
        Sid       = "BackupAccountCopiesSnapshots"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.backup_account_id}:root" }
        Action    = ["kms:Decrypt", "kms:DescribeKey", "kms:CreateGrant", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
        Resource  = "*"
      }],
    )
  })
}

resource "aws_kms_alias" "account" {
  name          = "alias/northstar/account-default"
  target_key_id = aws_kms_key.account.key_id
}

resource "aws_ebs_encryption_by_default" "this" {
  enabled = true
}

resource "aws_ebs_default_kms_key" "this" {
  key_arn = aws_kms_key.account.arn
}

# --- No public S3, at account level (also enforced at org level by SCP) ---------------

resource "aws_s3_account_public_access_block" "this" {
  account_id              = var.account_id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- FinOps: a budget per account, alerts to the owner ---------------------------------

resource "aws_budgets_budget" "monthly" {
  name         = "${var.account_name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(coalesce(var.budget_limit_usd, local.profile.budget_usd))
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  tags         = local.tags

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.owner]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.owner]
  }
}

# --- Log and metric forwarding to the central monitoring account -----------------------

resource "aws_oam_link" "central_observability" {
  count = var.observability_sink_arn == null ? 0 : 1

  label_template  = "$AccountName"
  resource_types  = ["AWS::CloudWatch::Metric", "AWS::Logs::LogGroup", "AWS::XRay::Trace"]
  sink_identifier = var.observability_sink_arn
  tags            = local.tags
}
