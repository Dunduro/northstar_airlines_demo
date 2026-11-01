terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # PoC: local state. Production: S3 backend with native locking + KMS,
  # state key "org/terraform.tfstate" — see terraform/README.md#state.
}

# Runs in the management account (Organizations + IAM Identity Center live there).
provider "aws" {
  region = var.home_region

  default_tags {
    tags = {
      managed-by = "terraform"
      repo       = "northstar/platform-landing-zone"
      stack      = "org"
    }
  }
}
