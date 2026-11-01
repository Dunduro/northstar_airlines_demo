variable "home_region" {
  description = "Region of the central vault. Same region as the workloads (data residency: UAE)."
  type        = string
  default     = "me-central-1"

  validation {
    # Tier 2 protects against deletion and a compromised account, not against a regional
    # event; a copy outside the region is a residency decision (architecture section 10).
    condition     = var.home_region == "me-central-1"
    error_message = "The central vault stays in me-central-1 (data residency). Offsite copies are a separate, approved design."
  }
}

variable "registry_file" {
  description = "Path to the account registry, relative to this root module."
  type        = string
  default     = "../registry/accounts.yaml"
}

variable "backup_account_name" {
  description = "Registry name of the Backup account."
  type        = string
  default     = "backup"

  validation {
    condition     = contains([for a in yamldecode(file(var.registry_file)).accounts : a.name], var.backup_account_name)
    error_message = "backup_account_name must be an account in the registry."
  }
}

variable "pipeline_role_name" {
  description = "Platform role assumed in the Backup account."
  type        = string
  default     = "northstar-platform-baseline"
}

variable "vault_name" {
  description = "Central vault name; the org backup policies copy into it (terraform/org)."
  type        = string
  default     = "northstar-central"
}

variable "min_retention_days" {
  description = "Vault Lock: no recovery point can be deleted earlier than this, by anyone."
  type        = number
  default     = 7
}

variable "max_retention_days" {
  description = "Vault Lock: upper bound for copy retention (covers the 365-day monthly copies)."
  type        = number
  default     = 400

  validation {
    condition     = var.max_retention_days >= 365
    error_message = "max_retention_days must cover the 365-day monthly prod copies."
  }
}

variable "lock_grace_days" {
  description = "Days the Vault Lock can still be removed after it is set. After that it is compliance mode: immutable, even for root."
  type        = number
  default     = 3

  validation {
    condition     = var.lock_grace_days >= 3
    error_message = "AWS requires at least 3 days before a compliance-mode lock becomes immutable."
  }
}

variable "restore_db_subnet_group_name" {
  description = "DB subnet group of the isolated restore VPC (restore-network.tf); restore tests land here."
  type        = string
  default     = "northstar-restore-test"
}

variable "restore_vpc_cidr" {
  description = "CIDR of the isolated restore VPC. Never routed (no TGW attachment), but kept out of the routed estate's IPAM pool so it can never be mistaken for, or collide with, a real network."
  type        = string
  # ASSUMPTION (unverified): the IPAM pool is not coded in this repo (architecture 1.5). This
  # takes 10.255.0.0/24 from the top of 10/8 as a block reserved for unrouted networks; the
  # network team must exclude it from the IPAM pool (or hand out a reserved allocation).
  default = "10.255.0.0/24"

  validation {
    condition     = can(cidrhost(var.restore_vpc_cidr, 0)) && tonumber(split("/", var.restore_vpc_cidr)[1]) <= 24
    error_message = "restore_vpc_cidr must be a valid CIDR of /24 or larger (it is split into four /26 subnets)."
  }
}

variable "restore_azs" {
  description = "Availability zones for the restore subnets (Aurora needs >= 2; all three so a test still runs with an AZ down)."
  type        = list(string)
  default     = ["me-central-1a", "me-central-1b", "me-central-1c"]

  validation {
    condition     = length(distinct(var.restore_azs)) >= 2 && length(distinct(var.restore_azs)) == length(var.restore_azs) && length(var.restore_azs) <= 4
    error_message = "restore_azs needs 2 to 4 distinct availability zones (a DB subnet group spans >= 2 AZs; the /24 holds four subnets)."
  }
}
