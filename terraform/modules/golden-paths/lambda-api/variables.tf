variable "name" {
  description = "API name, e.g. cargo-tracking. Used for the function, API and alarms."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.name))
    error_message = "name must be 3-31 lowercase letters, digits or dashes."
  }
}

variable "team" {
  description = "Owning team (from platform.yaml). Alerts route to this team."
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

variable "artifact" {
  description = "Versioned deployment bundle in the artifact bucket: s3://<bucket>/<name>/<version>.zip (build once, deploy many)."
  type        = string

  validation {
    condition     = can(regex("^s3://[^/]+/.+\\.zip$", var.artifact))
    error_message = "artifact must be an s3:// URL to a versioned .zip bundle."
  }
}

variable "runtime" {
  description = <<-EOT
    Supported runtimes only. provided.al2023 is the custom-runtime path: compiled binaries
    (Go, Rust) or PHP through a Bref-style runtime layer passed in `layers`.
  EOT
  type        = string
  default     = "nodejs22.x"

  validation {
    condition     = contains(["nodejs22.x", "python3.12", "python3.13", "dotnet8", "provided.al2023"], var.runtime)
    error_message = "runtime must be one the platform supports: nodejs22.x, python3.12, python3.13, dotnet8, provided.al2023."
  }
}

variable "handler" {
  description = "Function handler. Null = the template default for the runtime (see main.tf)."
  type        = string
  default     = null
}

variable "layers" {
  description = "Lambda layer ARNs (at most 5), e.g. the Bref PHP runtime layer for provided.al2023."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.layers) <= 5 && alltrue([for l in var.layers : can(regex("^arn:aws:lambda:[a-z0-9-]+:[0-9]{12}:layer:[A-Za-z0-9-_]+:[0-9]+$", l))])
    error_message = "layers must be at most five versioned layer ARNs."
  }
}

variable "architecture" {
  description = "arm64 (Graviton, default, cheaper) or x86_64."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.architecture)
    error_message = "architecture must be arm64 or x86_64."
  }
}

variable "memory_mb" {
  description = "Function memory (CPU scales with it)."
  type        = number
  default     = 512

  validation {
    condition     = var.memory_mb >= 128 && var.memory_mb <= 10240
    error_message = "memory_mb must be between 128 and 10240."
  }
}

variable "timeout_seconds" {
  description = "Function timeout. API Gateway HTTP APIs stop waiting after 30 seconds."
  type        = number
  default     = 10

  validation {
    condition     = var.timeout_seconds >= 1 && var.timeout_seconds <= 29
    error_message = "timeout_seconds must be 1-29 (API Gateway's integration limit is 30 s)."
  }
}

variable "reserved_concurrency" {
  description = "Reserved concurrency. Null = the environment profile's default; protects the account's shared pool."
  type        = number
  default     = null
}

variable "tracing" {
  description = "X-Ray active tracing."
  type        = bool
  default     = true
}

variable "environment_variables" {
  description = "Plain, non-secret configuration. Secrets are read at runtime from Secrets Manager."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for k in keys(var.environment_variables) : !can(regex("(?i)(password|secret|token|api_?key)", k))
    ])
    error_message = "environment_variables must not carry secrets; read them from Secrets Manager at runtime."
  }
}

variable "table" {
  description = "Create a DynamoDB table for this API (on-demand, PITR on, encrypted)."
  type        = bool
  default     = false
}

variable "data_classification" {
  description = "Drives log retention."
  type        = string
  default     = "internal"

  validation {
    condition     = contains(["public", "internal", "confidential", "restricted"], var.data_classification)
    error_message = "data_classification must be public, internal, confidential or restricted."
  }
}

variable "owner" {
  description = "Accountable owner (email), from the registry. Mandatory tag; the alarm topic is tagged with it."
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
