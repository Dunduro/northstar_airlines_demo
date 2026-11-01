variable "home_region" {
  description = "Home region of the organisation and IAM Identity Center."
  type        = string
  default     = "me-central-1"
}

variable "registry_file" {
  description = "Path to the account registry, relative to this root module."
  type        = string
  default     = "../registry/accounts.yaml"

  validation {
    condition = alltrue([
      for a in yamldecode(file(var.registry_file)).accounts : contains([
        "Security", "Infrastructure", "Workloads/Dev", "Workloads/Test", "Workloads/Prod",
        "Sandbox", "PolicyStaging", "Suspended",
      ], a.ou)
    ])
    error_message = "Every account in the registry must be placed in a known OU."
  }
}

variable "policy_staging_scps" {
  description = "Candidate SCPs under evaluation. They are attached to the PolicyStaging OU before they go anywhere else."
  type        = list(string)
  default     = ["prod-strict"]
}

variable "backup_account_name" {
  description = "Registry name of the account that holds the central, Vault-Locked backup vault."
  type        = string
  default     = "backup"
}

variable "central_backup_vault_name" {
  description = "Name of the central vault in the Backup account (created by terraform/backup)."
  type        = string
  default     = "northstar-central"
}

variable "local_backup_vault_name" {
  description = "Name of the in-account vault every account gets from account-baseline."
  type        = string
  default     = "northstar-local"
}

variable "backup_role_name" {
  description = "Role AWS Backup assumes in every account (created by account-baseline)."
  type        = string
  default     = "northstar-backup"
}
