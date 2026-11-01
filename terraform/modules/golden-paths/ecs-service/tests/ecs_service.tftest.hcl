# Runs entirely offline: the AWS provider is mocked, nothing is created.
#   cd terraform/modules/golden-paths/ecs-service && terraform init -backend=false && terraform test

mock_provider "aws" {
  # Mocks generate random strings; ARN-typed attributes need ARN-shaped values to pass the
  # provider's own validation.
  mock_data "aws_lb_listener" {
    defaults = {
      arn               = "arn:aws:elasticloadbalancing:me-central-1:100000000103:listener/app/shared/0123456789abcdef/fedcba9876543210"
      load_balancer_arn = "arn:aws:elasticloadbalancing:me-central-1:100000000103:loadbalancer/app/shared/0123456789abcdef"
    }
  }
  mock_data "aws_lb" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:me-central-1:100000000103:loadbalancer/app/shared/0123456789abcdef"
      arn_suffix = "app/shared/0123456789abcdef"
    }
  }
  mock_data "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:me-central-1:100000000103:cluster/northstar-prod" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:me-central-1:100000000103:targetgroup/baggage-tracker-prod/0123456789abcdef"
      arn_suffix = "targetgroup/baggage-tracker-prod/0123456789abcdef"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::100000000103:role/workload/mock" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:me-central-1:100000000103:baggage-tracker-prod-alarms" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:me-central-1:100000000103:task-definition/baggage-tracker-prod:1" }
  }

  # Shared infrastructure the baseline publishes; shaped like the real values.
  override_data {
    target = data.aws_ssm_parameter.alb_listener_arn
    values = { value = "arn:aws:elasticloadbalancing:me-central-1:100000000103:listener/app/shared/0123456789abcdef/fedcba9876543210" }
  }
  override_data {
    target = data.aws_ssm_parameter.private_subnet_ids
    values = { value = "subnet-0aaa1111,subnet-0bbb2222,subnet-0ccc3333" }
  }
  override_data {
    target = data.aws_ssm_parameter.alb_security_group_id
    values = { value = "sg-0alb000000000001" }
  }
  override_data {
    target = data.aws_region.current
    values = { name = "me-central-1" }
  }
  override_data {
    target = data.aws_caller_identity.current
    values = { account_id = "100000000103" }
  }
}

variables {
  name                = "baggage-tracker"
  team                = "ground-ops"
  owner               = "ground-ops-lead@northstar.example"
  cost_centre         = "CC-1004"
  environment         = "prod"
  size                = "small"
  data_classification = "confidential"
  image               = "100000000004.dkr.ecr.me-central-1.amazonaws.com/baggage-tracker:1.4.2@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}

run "prod_runs_at_least_two_tasks_even_when_small" {
  command = apply

  assert {
    condition     = aws_appautoscaling_target.this.min_capacity >= 2 && aws_ecs_service.this.desired_count >= 2
    error_message = "Prod must never run fewer than two tasks (two AZs), whatever the size."
  }

  assert {
    condition     = aws_appautoscaling_target.this.max_capacity >= aws_appautoscaling_target.this.min_capacity
    error_message = "max capacity must be at least min capacity."
  }

  assert {
    condition = toset([aws_appautoscaling_policy.cpu.target_tracking_scaling_policy_configuration[0].predefined_metric_specification[0].predefined_metric_type,
    aws_appautoscaling_policy.requests.target_tracking_scaling_policy_configuration[0].predefined_metric_specification[0].predefined_metric_type]) == toset(["ECSServiceAverageCPUUtilization", "ALBRequestCountPerTarget"])
    error_message = "Autoscaling must track both CPU and requests per target."
  }
}

run "dev_profile_is_cheaper" {
  command = apply

  variables {
    environment = "dev"
    size        = "large"
  }

  assert {
    condition     = aws_appautoscaling_target.this.min_capacity == 1 && aws_appautoscaling_target.this.max_capacity == 3
    error_message = "Dev runs one task and is capped at three, whatever the size."
  }

  assert {
    condition     = aws_ecs_service.this.enable_execute_command
    error_message = "ECS Exec is available outside prod for debugging."
  }
}

run "no_public_ingress_only_via_the_alb" {
  command = apply

  assert {
    condition     = aws_vpc_security_group_ingress_rule.from_alb.referenced_security_group_id == "sg-0alb000000000001" && aws_vpc_security_group_ingress_rule.from_alb.cidr_ipv4 == null
    error_message = "The service accepts traffic only from the shared ALB's security group."
  }

  assert {
    condition     = !aws_ecs_service.this.network_configuration[0].assign_public_ip
    error_message = "Tasks never get a public IP."
  }

  assert {
    condition     = length(aws_ecs_service.this.network_configuration[0].subnets) == 3
    error_message = "Tasks run in the platform's private subnets."
  }

  assert {
    condition     = !aws_ecs_service.this.enable_execute_command
    error_message = "No interactive shell into prod tasks."
  }
}

run "health_check_and_rollback_are_built_in" {
  command = apply

  assert {
    condition     = aws_lb_target_group.this.health_check[0].path == "/health" && aws_lb_target_group.this.target_type == "ip"
    error_message = "The ALB probes /health on each Fargate task."
  }

  assert {
    condition     = aws_ecs_service.this.deployment_circuit_breaker[0].enable && aws_ecs_service.this.deployment_circuit_breaker[0].rollback
    error_message = "A deploy that never gets healthy must roll back by itself."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.this.container_definitions)[0].image == var.image
    error_message = "The task runs exactly the digest it was given (build once, deploy many)."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.this.container_definitions)[0].readonlyRootFilesystem
    error_message = "Containers run with a read-only root filesystem by default."
  }
}

run "default_alarms_exist_and_route_to_the_owner" {
  command = apply

  assert {
    condition     = length(output.alarm_names) == 5
    error_message = "Every service gets 5xx rate, p95 latency, CPU, memory and unhealthy-target alarms."
  }

  assert {
    condition = alltrue([
      for a in [
        aws_cloudwatch_metric_alarm.cpu_high, aws_cloudwatch_metric_alarm.memory_high,
        aws_cloudwatch_metric_alarm.http_5xx_rate, aws_cloudwatch_metric_alarm.latency_p95,
        aws_cloudwatch_metric_alarm.unhealthy_targets,
      ] : contains(a.alarm_actions, aws_sns_topic.alarms.arn)
    ])
    error_message = "Every default alarm notifies the service's alarm topic."
  }

  assert {
    condition     = aws_sns_topic.alarms.tags["owner"] == "ground-ops-lead@northstar.example" && aws_sns_topic.alarms.tags["alert-route"] == "ground-ops"
    error_message = "The alarm topic carries the owner, so the alert router knows who to call."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.latency_p95.extended_statistic == "p95" && aws_cloudwatch_metric_alarm.latency_p95.threshold == 1
    error_message = "Prod alarms on p95 latency above one second by default."
  }
}

run "log_retention_follows_data_classification" {
  command = apply

  assert {
    condition     = aws_cloudwatch_log_group.service.retention_in_days == 365
    error_message = "Confidential data keeps logs for 365 days."
  }
}

run "public_data_keeps_logs_shorter" {
  command = apply

  variables {
    data_classification = "public"
  }

  assert {
    condition     = aws_cloudwatch_log_group.service.retention_in_days == 30
    error_message = "Public data keeps logs for 30 days."
  }
}

run "mandatory_tags_are_present" {
  command = apply

  assert {
    condition = alltrue([
      for r in [aws_ecs_service.this.tags, aws_ecs_task_definition.this.tags, aws_cloudwatch_log_group.service.tags, aws_lb_target_group.this.tags, aws_security_group.service.tags, aws_sns_topic.alarms.tags] :
      alltrue([for k in ["cost-centre", "owner", "environment", "team", "data-classification", "golden-path", "module-version"] : contains(keys(r), k)])
    ])
    error_message = "Mandatory tags must be on every taggable resource."
  }

  assert {
    condition     = aws_ecs_service.this.tags["module-version"] == output.module_version
    error_message = "Resources report the module version the dashboard tracks."
  }
}

run "aurora_attachment_uses_secrets_manager_never_plaintext" {
  command = apply

  variables {
    database = {
      endpoint          = "baggage.cluster-abc.me-central-1.rds.amazonaws.com"
      name              = "baggage"
      secret_arn        = "arn:aws:secretsmanager:me-central-1:100000000103:secret:rds!cluster-abc-AbCdEf"
      security_group_id = "sg-0db0000000000001"
    }
  }

  assert {
    condition = (
      contains([for s in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].secrets : s.name], "DB_PASSWORD")
      && !contains([for e in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].environment : e.name], "DB_PASSWORD")
    )
    error_message = "The database password is injected from Secrets Manager at start, never as a plain environment variable."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.execution_secrets[0].policy).Statement[0].Resource == ["arn:aws:secretsmanager:me-central-1:100000000103:secret:rds!cluster-abc-AbCdEf"]
    error_message = "The execution role may read exactly the declared secret."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.database_from_service[0].from_port == 5432 && aws_vpc_security_group_ingress_rule.database_from_service[0].referenced_security_group_id == aws_security_group.service.id
    error_message = "The database accepts PostgreSQL from this service's security group only."
  }
}

run "invalid_inputs_are_rejected" {
  command = plan

  variables {
    image          = "100000000004.dkr.ecr.me-central-1.amazonaws.com/baggage-tracker:latest"
    container_port = 80
    environment_variables = {
      DB_PASSWORD = "hunter2" # deliberately a secret in plain env vars: this run expects the module to reject it
    }
  }

  expect_failures = [var.image, var.container_port, var.environment_variables]
}
