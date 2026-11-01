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
  description = "Versioned bundle prefix s3://<bucket>/<name>/releases/<version>/ (output of build-static.yml)."
  type        = string
}

locals {
  # s3://northstar-artifacts/<repo>/releases/2.0.1/ -> 2.0.1
  bundle_version = regex("/releases/([0-9]+\\.[0-9]+\\.[0-9]+)/$", var.artifact)[0]
}

module "site" {
  source  = "registry.northstar.internal/platform/static-site/aws"
  version = "~> 2.0"

  name                = "hello-react-site"
  team                = "crew"
  owner               = "crew-lead@northstar.example"
  cost_centre         = "CC-1003"
  environment         = var.environment
  bundle_version      = local.bundle_version
  data_classification = "public"
}

# reusable-deploy.yml reads these two to stage the bundle and invalidate the cache.
output "static_site_bucket" {
  value = module.site.bucket_name
}

output "static_site_distribution_id" {
  value = module.site.distribution_id
}

output "url" {
  value = module.site.url
}

output "module_version" {
  value = module.site.module_version
}
