variable "name" {
  description = "Service name, e.g. baggage-tracker. Used for the ECS service, log group and alarms."
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
  description = "sandbox | dev | test | prod. Selects the environment profile (scaling floor, alarm thresholds)."
  type        = string

  validation {
    condition     = contains(["sandbox", "dev", "test", "prod"], var.environment)
    error_message = "environment must be sandbox, dev, test or prod."
  }
}

variable "image" {
  description = "Container image, pinned by digest (build once, deploy many): <repo>@sha256:<digest>. The language lives in the image."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be pinned by digest."
  }
}

variable "size" {
  description = "T-shirt size; the platform maps it to CPU/memory and scaling limits."
  type        = string
  default     = "small"

  validation {
    condition     = contains(["small", "medium", "large"], var.size)
    error_message = "size must be small, medium or large."
  }
}

variable "data_classification" {
  description = "Drives log retention and backup policy."
  type        = string
  default     = "internal"

  validation {
    condition     = contains(["public", "internal", "confidential", "restricted"], var.data_classification)
    error_message = "data_classification must be public, internal, confidential or restricted."
  }
}

variable "container_port" {
  description = "Port the container listens on behind the ALB."
  type        = number
  default     = 8080

  validation {
    condition     = var.container_port >= 1024 && var.container_port <= 65535
    error_message = "container_port must be an unprivileged port (1024-65535): containers run as non-root."
  }
}

variable "health_check_path" {
  description = "HTTP path the ALB probes. Every template serves /health."
  type        = string
  default     = "/health"
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

variable "environment_variables" {
  description = "Plain, non-secret configuration for the container. Secrets never go here (use database or secrets)."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for k in keys(var.environment_variables) : !can(regex("(?i)(password|secret|token|api_?key)", k))
    ])
    error_message = "environment_variables must not carry secrets; reference Secrets Manager via `secrets` instead."
  }
}

variable "secrets" {
  description = "Extra secrets injected at start: ENV_VAR_NAME => Secrets Manager or SSM ARN. Values never appear in the task definition."
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for v in values(var.secrets) : can(regex("^arn:aws:(secretsmanager|ssm):", v))])
    error_message = "secrets values must be Secrets Manager or SSM parameter ARNs."
  }
}

variable "database" {
  description = <<-EOT
    Optional Aurora PostgreSQL attachment. The cluster itself is stateful and lives in the
    product's deployment repo (architecture 4.3); this module only wires the service to it:
    network access on the DB port, and credentials injected from the cluster's Secrets Manager
    secret (never in plaintext, never in the task definition).
  EOT
  type = object({
    endpoint          = string
    port              = optional(number, 5432)
    name              = string
    secret_arn        = string
    security_group_id = string
  })
  default = null

  validation {
    condition     = var.database == null || can(regex("^arn:aws:secretsmanager:", var.database.secret_arn))
    error_message = "database.secret_arn must be a Secrets Manager secret ARN."
  }
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton, cheaper). The platform build workflows publish multi-arch images."
  type        = string
  default     = "ARM64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "readonly_root_filesystem" {
  description = "Run with a read-only root filesystem. A writable /tmp is always mounted."
  type        = bool
  default     = true
}

variable "latency_p95_threshold_seconds" {
  description = "p95 target response time that raises the latency alarm. Null = the environment profile's default."
  type        = number
  default     = null
}

variable "requests_per_target" {
  description = "Request-count scaling target (ALB requests per task per minute)."
  type        = number
  default     = 1000
}

variable "platform_parameters_prefix" {
  description = "SSM prefix under which the account baseline publishes the shared network and ALB settings."
  type        = string
  default     = "/northstar"
}

variable "tags" {
  description = "Extra tags, merged under the mandatory ones."
  type        = map(string)
  default     = {}
}
