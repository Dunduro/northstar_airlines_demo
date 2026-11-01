terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # PoC: local state. Production: S3 backend, state key "backup/terraform.tfstate"
  # (terraform/README.md#state).
}

# Runs in the Backup account, assuming the platform baseline role like terraform/baseline.
provider "aws" {
  region = var.home_region

  assume_role {
    role_arn     = "arn:aws:iam::${local.account.id}:role/${var.pipeline_role_name}"
    session_name = "backup-vault"
  }

  allowed_account_ids = [local.account.id]

  default_tags {
    tags = {
      managed-by = "terraform"
      repo       = "northstar/platform-landing-zone"
      stack      = "backup"
    }
  }
}
