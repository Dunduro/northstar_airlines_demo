# Default alarms every service gets (architecture 3.1). They notify the service's SNS topic;
# the platform's alert router turns that into a message for the owning team, and severity 1-2
# alarms in prod into an incident.

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]

  ecs_dimensions = { ClusterName = local.cluster_name, ServiceName = var.name }
  alb_dimensions = {
    LoadBalancer = data.aws_lb.shared.arn_suffix
    TargetGroup  = aws_lb_target_group.this.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${local.full_name}-cpu-high"
  alarm_description   = "${var.name}: average CPU above 80% (autoscaling is not keeping up, or max capacity reached)."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = local.ecs_dimensions
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "memory_high" {
  alarm_name          = "${local.full_name}-memory-high"
  alarm_description   = "${var.name}: average memory above 85% (risk of OOM kills)."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = local.ecs_dimensions
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags
}

# Error rate, not error count: 5 errors out of 10 requests matters, 5 out of 100 000 does not.
resource "aws_cloudwatch_metric_alarm" "http_5xx_rate" {
  alarm_name          = "${local.full_name}-5xx-rate"
  alarm_description   = "${var.name}: more than 5% of requests answered with a 5xx by the service."
  evaluation_periods  = local.profile.alarm_periods
  datapoints_to_alarm = local.profile.alarm_periods
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags

  metric_query {
    id          = "rate"
    expression  = "IF(requests > 0, 100 * errors / requests, 0)"
    label       = "5xx rate (%)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = local.alb_dimensions
      stat        = "Sum"
      period      = 60
    }
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = local.alb_dimensions
      stat        = "Sum"
      period      = 60
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "latency_p95" {
  alarm_name          = "${local.full_name}-latency-p95"
  alarm_description   = "${var.name}: p95 response time above the threshold."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = local.alb_dimensions
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = local.profile.alarm_periods
  datapoints_to_alarm = local.profile.alarm_periods
  threshold           = coalesce(var.latency_p95_threshold_seconds, local.profile.latency_p95)
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_targets" {
  alarm_name          = "${local.full_name}-unhealthy-targets"
  alarm_description   = "${var.name}: at least one task fails the ${var.health_check_path} health check."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = local.alb_dimensions
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
  tags                = local.tags
}
