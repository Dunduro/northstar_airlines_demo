output "module_version" {
  description = "Golden path version; reported to the dashboard for version tracking."
  value       = local.module_version
}

output "function_name" {
  description = "Lambda function name."
  value       = aws_lambda_function.this.function_name
}

output "log_group_name" {
  description = "Where the function's structured logs go."
  value       = aws_cloudwatch_log_group.function.name
}

output "alarm_names" {
  description = "Default alarms created for the API."
  value = [
    aws_cloudwatch_metric_alarm.errors.alarm_name,
    aws_cloudwatch_metric_alarm.throttles.alarm_name,
    aws_cloudwatch_metric_alarm.duration_p95.alarm_name,
  ]
}

output "alarm_topic_arn" {
  description = "SNS topic all default alarms notify."
  value       = aws_sns_topic.alarms.arn
}

output "api_url" {
  description = "API base URL (the custom domain the platform maps to the API)."
  value       = "https://${var.name}.${var.environment}.api.northstar.internal"
}

output "invoke_url" {
  description = "API Gateway's own endpoint (before the custom domain)."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "table_name" {
  description = "DynamoDB table name, or null when table = false."
  value       = var.table ? aws_dynamodb_table.this[0].name : null
}

output "function_role_arn" {
  description = "The function's IAM role; attach extra permissions next to the module as plain Terraform."
  value       = aws_iam_role.function.arn
}

output "function_config" {
  description = "Resolved runtime settings."
  value = {
    runtime              = aws_lambda_function.this.runtime
    handler              = aws_lambda_function.this.handler
    memory_mb            = var.memory_mb
    reserved_concurrency = aws_lambda_function.this.reserved_concurrent_executions
    tracing              = var.tracing
    artifact             = var.artifact
  }
}
