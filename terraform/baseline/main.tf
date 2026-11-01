# One root, one state per account: `-var account_name=payments-prod`.
# Everything about the account comes from the registry; nothing is configured by hand.

variable "account_name" {
  description = "Registry name of the account to baseline, e.g. payments-prod."
  type        = string

  validation {
    condition     = contains([for a in yamldecode(file(var.registry_file)).accounts : a.name], var.account_name)
    error_message = "account_name must be an account in the registry."
  }
}

variable "registry_file" {
  description = "Path to the account registry, relative to this root module."
  type        = string
  default     = "../registry/accounts.yaml"
}

variable "region" {
  description = "Region to apply regional baseline settings in (one of the SCP allow-list)."
  type        = string
  default     = "me-central-1"

  validation {
    condition     = contains(["me-central-1", "eu-west-1"], var.region)
    error_message = "region must be an approved region (see policies/scp/region-allowlist.json)."
  }
}

variable "pipeline_role_name" {
  description = "Platform role assumed in the target account: northstar-platform-plan (read-only) or northstar-platform-baseline (apply)."
  type        = string
  default     = "northstar-platform-baseline"
}

locals {
  account = one([for a in yamldecode(file(var.registry_file)).accounts : a if a.name == var.account_name])

  # Tier-2 backups: the Backup account may use this account's key to copy encrypted snapshots.
  # Not for the Backup account itself, and not for Sandbox (no backup policy there).
  backup_account_id = one([for a in yamldecode(file(var.registry_file)).accounts : a.id if a.name == "backup"])

  # Finance and data-classification metadata that is derived, not typed per account.
  cost_centres = {
    payments = "CC-1001"
    cargo    = "CC-1002"
    crew     = "CC-1003"
    loyalty  = "CC-1004"
    platform = "CC-9001"
    security = "CC-9002"
  }
  data_classification = {
    sandbox = "public"
    dev     = "internal"
    test    = "internal"
    prod    = "confidential"
    core    = "confidential"
  }
}

module "baseline" {
  source = "../modules/account-baseline"

  account_id          = local.account.id
  account_name        = local.account.name
  environment         = local.account.environment
  team                = local.account.team
  owner               = local.account.owner
  cost_centre         = local.cost_centres[local.account.team]
  data_classification = local.data_classification[local.account.environment]
  baseline_version    = local.account.baseline_version
  backup_account_id   = local.account.name == "backup" || local.account.environment == "sandbox" ? null : local.backup_account_id
}

output "account" {
  description = "The registry entry this state belongs to."
  value       = local.account
}

output "deploy_role_arn" {
  value = module.baseline.deploy_role_arn
}

output "trusted_subjects" {
  value = module.baseline.trusted_subjects
}
