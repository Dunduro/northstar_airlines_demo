# --- Identity: one execution role (pull, logs, secrets) and one task role (the app) ----
# Both live under the /workload/ path: the deploy role may only manage roles there.

locals {
  ecs_tasks_trust = {
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  }

  secret_arns = distinct(concat(
    [for v in values(var.secrets) : v],
    var.database == null ? [] : [var.database.secret_arn],
  ))
}

resource "aws_iam_role" "execution" {
  name               = "${local.full_name}-exec"
  path               = "/workload/"
  assume_role_policy = jsonencode(local.ecs_tasks_trust)
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Only the secrets this service declared, nothing else.
resource "aws_iam_role_policy" "execution_secrets" {
  count = length(local.secret_arns) > 0 ? 1 : 0

  name = "read-declared-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadDeclaredSecretsOnly"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue", "ssm:GetParameters"]
      Resource = local.secret_arns
    }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.full_name}-task"
  path               = "/workload/"
  assume_role_policy = jsonencode(local.ecs_tasks_trust)
  tags               = local.tags
}

# --- Task definition --------------------------------------------------------------------

locals {
  # "repo:1.4.2@sha256:..." -> "1.4.2"; a bare digest -> its first 12 hex characters.
  app_version = try(regex(":([^:@/]+)@sha256:", var.image)[0], substr(regex("@sha256:([0-9a-f]{64})$", var.image)[0], 0, 12))

  # Platform-provided context, read by every template's logger (architecture 3.1).
  platform_env = {
    SERVICE     = var.name
    TEAM        = var.team
    ENVIRONMENT = var.environment
    VERSION     = local.app_version
    PORT        = tostring(var.container_port)
    LOG_FORMAT  = "json"
  }

  database_env = var.database == null ? {} : {
    DB_HOST = var.database.endpoint
    DB_PORT = tostring(var.database.port)
    DB_NAME = var.database.name
  }

  # Credentials come from the Aurora-managed secret (keys "username" and "password"). ECS
  # resolves them at task start; they never appear in the task definition or in state.
  database_secrets = var.database == null ? {} : {
    DB_USER     = "${var.database.secret_arn}:username::"
    DB_PASSWORD = "${var.database.secret_arn}:password::"
  }

  container_env     = merge(var.environment_variables, local.database_env, local.platform_env)
  container_secrets = merge(var.secrets, local.database_secrets)

  container = {
    name                   = "app"
    image                  = var.image
    essential              = true
    readonlyRootFilesystem = var.readonly_root_filesystem
    portMappings           = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment            = [for k in sort(keys(local.container_env)) : { name = k, value = local.container_env[k] }]
    secrets                = [for k in sort(keys(local.container_secrets)) : { name = k, valueFrom = local.container_secrets[k] }]
    mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
    linuxParameters        = { initProcessEnabled = true }
    stopTimeout            = 30
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.service.name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = var.name
        mode                  = "non-blocking"
        max-buffer-size       = "25m"
      }
    }
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.full_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.size.cpu
  memory                   = local.size.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions    = jsonencode([local.container])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  volume {
    name = "tmp"
  }

  tags = local.tags
}

# --- Network: reachable only through the shared ALB -------------------------------------

resource "aws_security_group" "service" {
  name        = "${local.full_name}-svc"
  description = "${var.name}: ingress only from the shared ALB"
  vpc_id      = data.aws_ssm_parameter.vpc_id.value
  tags        = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "from_alb" {
  security_group_id            = aws_security_group.service.id
  description                  = "HTTP from the shared ALB only"
  referenced_security_group_id = data.aws_ssm_parameter.alb_security_group_id.value
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  tags                         = local.tags
}

# Outbound HTTPS for AWS APIs (VPC endpoints) and dependencies; the network firewall in the
# network account decides what is actually reachable.
resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.service.id
  description       = "HTTPS egress (AWS APIs, dependencies) via the network firewall"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  tags              = local.tags
}

resource "aws_lb_target_group" "this" {
  name                 = substr(local.full_name, 0, 32)
  port                 = var.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = data.aws_ssm_parameter.vpc_id.value
  deregistration_delay = 30

  health_check {
    path                = var.health_check_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = local.tags
}

resource "aws_lb_listener_rule" "this" {
  listener_arn = data.aws_lb_listener.https.arn

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  condition {
    host_header {
      values = [local.hostname]
    }
  }

  tags = local.tags
}

# --- The service -------------------------------------------------------------------------

resource "aws_ecs_service" "this" {
  name                              = var.name
  cluster                           = data.aws_ecs_cluster.this.arn
  task_definition                   = aws_ecs_task_definition.this.arn
  desired_count                     = local.min_capacity
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 30
  enable_execute_command            = var.environment != "prod"
  propagate_tags                    = "SERVICE"
  wait_for_steady_state             = true

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # A deploy that never becomes healthy rolls itself back; the deploy workflow then fails.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = split(",", data.aws_ssm_parameter.private_subnet_ids.value)
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = local.container.name
    container_port   = var.container_port
  }

  tags = local.tags

  # Autoscaling owns the running count after the first deploy.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.this]
}

# --- Autoscaling: target tracking on CPU and on requests per task -------------------------

resource "aws_appautoscaling_target" "this" {
  service_namespace  = "ecs"
  resource_id        = "service/${local.cluster_name}/${aws_ecs_service.this.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = local.min_capacity
  max_capacity       = local.max_capacity
  tags               = local.tags
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${local.full_name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "requests" {
  name               = "${local.full_name}-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this.service_namespace
  resource_id        = aws_appautoscaling_target.this.resource_id
  scalable_dimension = aws_appautoscaling_target.this.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = var.requests_per_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${data.aws_lb.shared.arn_suffix}/${aws_lb_target_group.this.arn_suffix}"
    }
  }
}

# --- Optional: Aurora PostgreSQL attachment --------------------------------------------------

resource "aws_vpc_security_group_egress_rule" "to_database" {
  count = var.database == null ? 0 : 1

  security_group_id            = aws_security_group.service.id
  description                  = "PostgreSQL to the attached Aurora cluster"
  referenced_security_group_id = var.database.security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  tags                         = local.tags
}

resource "aws_vpc_security_group_ingress_rule" "database_from_service" {
  count = var.database == null ? 0 : 1

  security_group_id            = var.database.security_group_id
  description                  = "PostgreSQL from ${local.full_name}"
  referenced_security_group_id = aws_security_group.service.id
  ip_protocol                  = "tcp"
  from_port                    = var.database.port
  to_port                      = var.database.port
  tags                         = local.tags
}
