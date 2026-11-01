# Default alarms every function gets, routed to the owner through the alarm topic.

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]
  fn_dimensions = { FunctionName = local.function_name }
}

resource "aws_cloudwatch_metric_alarm" "errors" {
  alarm_name          = "${local.function_name}-errors"
  alarm_description   = "${var.name}: more than 5 failed invocations in 5 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = local.fn_dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "throttles" {
  alarm_name          = "${local.function_name}-throttles"
  alarm_description   = "${var.name}: invocations throttled (reserved concurrency reached)."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = local.fn_dimensions
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags
}

# p95 duration close to the timeout means requests are about to start failing.
resource "aws_cloudwatch_metric_alarm" "duration_p95" {
  alarm_name          = "${local.function_name}-duration-p95"
  alarm_description   = "${var.name}: p95 duration above 80% of the ${var.timeout_seconds}s timeout."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  dimensions          = local.fn_dimensions
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.timeout_seconds * 1000 * 0.8
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags
}
