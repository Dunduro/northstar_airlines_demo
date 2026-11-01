variable "name" {
  description = "Site name, e.g. crew-portal. Used for the bucket, distribution and tags."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "name must be 3-31 lowercase letters, digits or dashes."
  }
}

variable "team" {
  description = "Owning team (from platform.yaml)."
  type        = string
}

variable "environment" {
  description = "sandbox | dev | test | prod."
  type        = string

  validation {
    condition     = contains(["sandbox", "dev", "test", "prod"], var.environment)
    error_message = "environment must be sandbox, dev, test or prod."
  }
}

variable "bundle_version" {
  description = <<-EOT
    The release to serve: a semantic version. CloudFront serves the bucket prefix
    releases/<bundle_version>/, which the platform deploy workflow stages from the artifact
    store before the switch. Promotion and rollback change only this value.
  EOT
  type        = string

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.bundle_version))
    error_message = "bundle_version must be a semantic version like 2.0.1 (no 'latest')."
  }
}

variable "single_page_app" {
  description = "Serve /index.html for unknown paths (client-side routing)."
  type        = bool
  default     = true
}

variable "aliases" {
  description = "Custom domain names. Requires certificate_arn (ACM, us-east-1)."
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "ACM certificate in us-east-1 for the aliases. Null = the default *.cloudfront.net certificate."
  type        = string
  default     = null
}

variable "content_security_policy" {
  description = "Content-Security-Policy header. The default allows only same-origin content."
  type        = string
  default     = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_200 includes the Middle East edge locations."
  type        = string
  default     = "PriceClass_200"
}

variable "data_classification" {
  description = "Static sites are public or internal by nature; anything more sensitive belongs behind an API."
  type        = string
  default     = "public"

  validation {
    condition     = contains(["public", "internal"], var.data_classification)
    error_message = "static-site serves public or internal content only; confidential data belongs behind an authenticated API."
  }
}

variable "owner" {
  description = "Accountable owner (email), from the registry. Mandatory tag."
  type        = string
  default     = null

  validation {
    condition     = var.owner == null || can(regex("^[^@\\s]+@[^@\\s]+$", var.owner))
    error_message = "owner must be an email address."
  }
}

variable "cost_centre" {
  description = "Finance cost centre, e.g. CC-1001. Mandatory tag."
  type        = string
  default     = null

  validation {
    condition     = var.cost_centre == null || can(regex("^CC-[0-9]{4}$", var.cost_centre))
    error_message = "cost_centre must look like CC-1234."
  }
}

variable "tags" {
  description = "Extra tags, merged under the mandatory ones."
  type        = map(string)
  default     = {}
}
