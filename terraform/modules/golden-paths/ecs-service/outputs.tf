output "module_version" {
  description = "Golden path version; reported to the dashboard for version tracking."
  value       = local.module_version
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "task_size" {
  description = "Resolved CPU/memory, scaling limits (after the environment profile) and container port."
  value = {
    cpu            = local.size.cpu
    memory         = local.size.memory
    min            = local.min_capacity
    max            = local.max_capacity
    container_port = var.container_port
  }
}

output "log_group_name" {
  description = "Where the service's structured logs go."
  value       = aws_cloudwatch_log_group.service.name
}

output "alarm_names" {
  description = "Default alarms created for the service."
  value = [
    aws_cloudwatch_metric_alarm.cpu_high.alarm_name,
    aws_cloudwatch_metric_alarm.memory_high.alarm_name,
    aws_cloudwatch_metric_alarm.http_5xx_rate.alarm_name,
    aws_cloudwatch_metric_alarm.latency_p95.alarm_name,
    aws_cloudwatch_metric_alarm.unhealthy_targets.alarm_name,
  ]
}

output "alarm_topic_arn" {
  description = "SNS topic all default alarms notify (subscribe extra targets here)."
  value       = aws_sns_topic.alarms.arn
}

output "security_group_id" {
  description = "The service's security group (reference it from extra resources, e.g. a cache)."
  value       = aws_security_group.service.id
}

output "task_role_arn" {
  description = "The app's IAM role; attach extra permissions next to the module as plain Terraform."
  value       = aws_iam_role.task.arn
}

output "url" {
  description = "Service URL (host-header rule on the account's shared ALB)."
  value       = "https://${local.hostname}"
}
