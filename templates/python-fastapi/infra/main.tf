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
  description = "Image to run, pinned by digest (output of build-python.yml)."
  type        = string
}

module "service" {
  source  = "registry.northstar.internal/platform/ecs-service/aws"
  version = "~> 2.4"

  name                = "hello-python-api"
  team                = "cargo"
  owner               = "cargo-lead@northstar.example"
  cost_centre         = "CC-1002"
  environment         = var.environment
  image               = var.artifact
  size                = "small"
  data_classification = "internal"
}

output "url" {
  value = module.service.url
}

output "module_version" {
  value = module.service.module_version
}
