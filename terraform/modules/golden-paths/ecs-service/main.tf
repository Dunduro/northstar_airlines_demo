# Golden path: ecs-service (ECS Fargate behind the account's shared ALB, Aurora optional).
#
# Language-agnostic by design (ADR-015): the module runs whatever container image it is given.
# Node, PHP, .NET or Python all arrive here as an image digest built by the platform's build
# workflows; nothing below knows or cares which language is inside.
#
# What the platform builds in, so teams do not have to:
#   - sizing and autoscaling per environment profile (prod never runs fewer than 2 tasks)
#   - structured logs with retention per data classification
#   - default alarms (5xx rate, p95 latency, CPU, memory, unhealthy targets) to an SNS topic
#     tagged with the owner; the platform's alert router subscribes to it
#   - a security group that only accepts traffic from the ALB
#   - optional Aurora PostgreSQL wiring with credentials from Secrets Manager
#
# Shared infrastructure (VPC, private subnets, ECS cluster, ALB + HTTPS listener) is owned by
# the account baseline / network stack and discovered here through SSM parameters, so the
# module interface stays small and does not change when the network does.

locals {
  module_version = "2.4.0"

  sizes = {
    small  = { cpu = 256, memory = 512, min = 1, max = 2 }
    medium = { cpu = 512, memory = 1024, min = 2, max = 6 }
    large  = { cpu = 1024, memory = 2048, min = 3, max = 12 }
  }
  size = local.sizes[var.size]

  # Environment profiles: the one place where sandbox ... prod are allowed to differ.
  #   min_floor   prod spreads at least two tasks over two AZs, whatever the size says
  #   max_cap     non-prod is capped to keep cost predictable
  #   latency_p95 default alarm threshold (seconds)
  profiles = {
    sandbox = { min_floor = 1, max_cap = 2, latency_p95 = 3, alarm_periods = 5 }
    dev     = { min_floor = 1, max_cap = 3, latency_p95 = 2, alarm_periods = 5 }
    test    = { min_floor = 1, max_cap = 6, latency_p95 = 1.5, alarm_periods = 3 }
    prod    = { min_floor = 2, max_cap = 100, latency_p95 = 1, alarm_periods = 3 }
  }
  profile = local.profiles[var.environment]

  min_capacity = var.environment == "prod" ? max(local.size.min, local.profile.min_floor) : local.profile.min_floor
  max_capacity = max(local.min_capacity, min(local.size.max, local.profile.max_cap))

  log_retention_days = {
    public       = 30
    internal     = 90
    confidential = 365
    restricted   = 731
  }

  full_name    = "${var.name}-${var.environment}"
  cluster_name = "northstar-${var.environment}"
  hostname     = "${var.name}.${var.environment}.northstar.internal"

  # Mandatory tags (also enforced by the tag policy and the Checkov check in reusable-deploy).
  mandatory_tags = merge(
    {
      team                = var.team
      environment         = var.environment
      data-classification = var.data_classification
    },
    var.owner == null ? {} : { owner = var.owner },
    var.cost_centre == null ? {} : { cost-centre = var.cost_centre },
  )
  tags = merge(var.tags, local.mandatory_tags, {
    service        = var.name
    golden-path    = "ecs-service"
    module-version = local.module_version
    managed-by     = "terraform"
  })
}

check "mandatory_tags_complete" {
  assert {
    condition     = var.owner != null && var.cost_centre != null
    error_message = "owner and cost_centre are not set: the tag policy check in reusable-deploy will reject this plan. Set them from platform.yaml."
  }
}

# --- Shared infrastructure, published by the baseline / network stack ------------------

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

data "aws_ssm_parameter" "vpc_id" {
  name = "${var.platform_parameters_prefix}/network/vpc-id"
}

data "aws_ssm_parameter" "private_subnet_ids" {
  name = "${var.platform_parameters_prefix}/network/private-subnet-ids"
}

data "aws_ssm_parameter" "alb_listener_arn" {
  name = "${var.platform_parameters_prefix}/alb/https-listener-arn"
}

data "aws_ssm_parameter" "alb_security_group_id" {
  name = "${var.platform_parameters_prefix}/alb/security-group-id"
}

data "aws_lb_listener" "https" {
  arn = data.aws_ssm_parameter.alb_listener_arn.value
}

data "aws_lb" "shared" {
  arn = data.aws_lb_listener.https.load_balancer_arn
}

data "aws_ecs_cluster" "this" {
  cluster_name = local.cluster_name
}

# --- Logs and alarm routing ------------------------------------------------------------

# Structured JSON logs (service, team, environment, version, correlation_id) land here.
resource "aws_cloudwatch_log_group" "service" {
  name              = "/northstar/${var.environment}/${var.name}"
  retention_in_days = local.log_retention_days[var.data_classification]
  tags              = local.tags
}

# Every default alarm goes here. The platform's alert router subscribes to all topics tagged
# golden-path=* and routes by the owner/team tags (one alerting model with drift and findings).
resource "aws_sns_topic" "alarms" {
  name              = "${local.full_name}-alarms"
  kms_master_key_id = "alias/aws/sns"
  tags              = merge(local.tags, { owner = coalesce(var.owner, var.team), alert-route = var.team })
}
