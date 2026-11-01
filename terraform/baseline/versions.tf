terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # PoC: local state. In the pipeline this root runs once per account with its own state:
  #   terraform init -backend-config=../backend/s3.tfbackend -backend-config="key=accounts/<name>.tfstate"
  # (the workflows add an S3 backend block via backend_override.tf — see terraform/README.md#state).
}

# The pipeline runs in the shared-services account and assumes a platform role in the
# target account (created by Account Factory). Plans use the read-only role, applies the
# baseline role.
provider "aws" {
  region = var.region

  assume_role {
    role_arn     = "arn:aws:iam::${local.account.id}:role/${var.pipeline_role_name}"
    session_name = "baseline-${var.account_name}"
  }

  allowed_account_ids = [local.account.id]

  default_tags {
    tags = {
      repo  = "northstar/platform-landing-zone"
      stack = "baseline"
    }
  }
}
