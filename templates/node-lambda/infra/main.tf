# The service's own infrastructure: the golden path module plus anything team-specific, as
# plain Terraform next to it. Applied only by the platform's reusable deploy workflow, which
# passes -var environment=<env> -var artifact=<artifact> and adds env/<env>.tfvars if present.
#
# Validate locally: `terraform fmt -check`. `terraform init` needs the private module registry
# (registry.northstar.internal), which is reachable from the platform runners only.

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # State in the target account; bucket and key are passed by reusable-deploy.yml.
  backend "s3" {}
}

provider "aws" {
  region = "me-central-1"
}

variable "environment" {
  description = "dev | test | prod (set by the deploy workflow)."
  type        = string
}

variable "artifact" {
  description = "Versioned bundle s3://<bucket>/<name>/<version>.zip (output of build-node.yml)."
  type        = string
}

module "api" {
  source  = "registry.northstar.internal/platform/lambda-api/aws"
  version = "~> 1.5"

  name                = "hello-node-lambda"
  team                = "cargo"
  owner               = "cargo-lead@northstar.example"
  cost_centre         = "CC-1002"
  environment         = var.environment
  artifact            = var.artifact
  runtime             = "nodejs22.x"
  memory_mb           = 512
  data_classification = "internal"
}

output "url" {
  value = module.api.api_url
}

output "module_version" {
  value = module.api.module_version
}
