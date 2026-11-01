variable "account_id" {
  description = "12-digit AWS account id (from the registry)."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be a 12-digit string."
  }
}

variable "account_name" {
  description = "Registry name of the account, e.g. payments-prod."
  type        = string
}

variable "environment" {
  description = "Environment profile: sandbox | dev | test | prod | core."
  type        = string

  validation {
    condition     = contains(["sandbox", "dev", "test", "prod", "core"], var.environment)
    error_message = "environment must be one of sandbox, dev, test, prod, core."
  }
}

variable "team" {
  description = "Owning team. Also scopes which repositories may deploy (<github_org>/<team>-*)."
  type        = string
}

variable "owner" {
  description = "Accountable owner (email). Receives budget alerts."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+$", var.owner))
    error_message = "owner must be an email address."
  }
}

variable "cost_centre" {
  description = "Finance cost centre, e.g. CC-1001."
  type        = string

  validation {
    condition     = can(regex("^CC-[0-9]{4}$", var.cost_centre))
    error_message = "cost_centre must look like CC-1234."
  }
}

variable "data_classification" {
  description = "Highest data classification held in the account."
  type        = string

  validation {
    condition     = contains(["public", "internal", "confidential", "restricted"], var.data_classification)
    error_message = "data_classification must be public, internal, confidential or restricted."
  }
}

variable "baseline_version" {
  description = "Version of this baseline the account is pinned to (reported to the dashboard)."
  type        = string
}

variable "github_org" {
  description = "GitHub organisation whose workflows may deploy."
  type        = string
  default     = "northstar"
}

variable "platform_deploy_workflow" {
  description = "The platform's reusable deploy workflow, without @ref. The ONLY workflow the deploy role trusts."
  type        = string
  default     = "northstar/platform-workflows/.github/workflows/reusable-deploy.yml"
}

variable "budget_limit_usd" {
  description = "Monthly budget override. Null = the environment profile's default."
  type        = number
  default     = null
}

variable "observability_sink_arn" {
  description = "CloudWatch Observability Access Manager sink in the central monitoring account. Null = no link (PoC)."
  type        = string
  default     = null
}

variable "backup_account_id" {
  description = "Backup account (from the registry). Allowed to use the account key so encrypted RDS/Aurora snapshots can be copied to the central vault. Null = no tier-2 copies of RDS/Aurora."
  type        = string
  default     = null

  validation {
    condition     = var.backup_account_id == null || can(regex("^[0-9]{12}$", var.backup_account_id))
    error_message = "backup_account_id must be a 12-digit string."
  }
}
