# Runs entirely offline: the AWS provider is mocked, nothing is created.
#   cd terraform/modules/golden-paths/lambda-api && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::100000000201:role/workload/cargo-tracking-prod-fn" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:me-central-1:100000000201:log-group:/northstar/mock" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:me-central-1:100000000201:cargo-tracking-prod-alarms" }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:me-central-1:100000000201:function:cargo-tracking-prod"
      invoke_arn = "arn:aws:apigateway:me-central-1:lambda:path/2015-03-31/functions/arn:aws:lambda:me-central-1:100000000201:function:cargo-tracking-prod/invocations"
    }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      execution_arn = "arn:aws:execute-api:me-central-1:100000000201:abc123"
      api_endpoint  = "https://abc123.execute-api.me-central-1.amazonaws.com"
    }
  }
  mock_resource "aws_dynamodb_table" {
    defaults = { arn = "arn:aws:dynamodb:me-central-1:100000000201:table/cargo-tracking-prod-data" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "100000000201" }
  }
}

variables {
  name                = "cargo-tracking"
  team                = "cargo"
  owner               = "cargo-lead@northstar.example"
  cost_centre         = "CC-1002"
  environment         = "prod"
  artifact            = "s3://northstar-artifacts/cargo-tracking/1.8.0.zip"
  data_classification = "internal"
}

run "prod_defaults" {
  command = apply

  assert {
    condition     = aws_lambda_function.this.reserved_concurrent_executions == 100
    error_message = "Prod reserves 100 concurrent executions by default."
  }

  assert {
    condition     = aws_lambda_function.this.tracing_config[0].mode == "Active"
    error_message = "X-Ray tracing is on by default."
  }

  assert {
    condition     = aws_lambda_function.this.s3_bucket == "northstar-artifacts" && aws_lambda_function.this.s3_key == "cargo-tracking/1.8.0.zip"
    error_message = "The function runs exactly the versioned bundle it was given."
  }

  assert {
    condition     = aws_lambda_function.this.environment[0].variables["VERSION"] == "1.8.0" && aws_lambda_function.this.environment[0].variables["SERVICE"] == "cargo-tracking"
    error_message = "The platform passes service and version to the logger."
  }

  assert {
    condition     = aws_lambda_function.this.logging_config[0].log_format == "JSON"
    error_message = "Logs are structured JSON."
  }

  assert {
    condition     = tolist(aws_lambda_function.this.architectures) == tolist(["arm64"])
    error_message = "Graviton by default."
  }
}

run "dev_profile_and_tracing_flag" {
  command = apply

  variables {
    environment = "dev"
    tracing     = false
  }

  assert {
    condition     = aws_lambda_function.this.reserved_concurrent_executions == 10
    error_message = "Dev reserves 10 concurrent executions."
  }

  assert {
    condition     = aws_lambda_function.this.tracing_config[0].mode == "PassThrough" && length(aws_iam_role_policy_attachment.xray) == 0
    error_message = "Tracing can be switched off; then no X-Ray permission is granted."
  }
}

run "default_alarms_exist" {
  command = apply

  assert {
    condition     = length(output.alarm_names) == 3
    error_message = "Every function gets errors, throttles and p95 duration alarms."
  }

  assert {
    condition = alltrue([
      for a in [aws_cloudwatch_metric_alarm.errors, aws_cloudwatch_metric_alarm.throttles, aws_cloudwatch_metric_alarm.duration_p95] :
      contains(a.alarm_actions, aws_sns_topic.alarms.arn)
    ])
    error_message = "Every default alarm notifies the owner's topic."
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.duration_p95.threshold == 8000
    error_message = "The duration alarm fires at 80% of the 10 s timeout."
  }
}

run "api_is_wired_to_the_function" {
  command = apply

  assert {
    condition     = aws_apigatewayv2_api.this.protocol_type == "HTTP" && aws_apigatewayv2_integration.lambda.payload_format_version == "2.0"
    error_message = "HTTP API with payload format 2.0."
  }

  assert {
    condition     = aws_lambda_permission.api.source_arn == "arn:aws:execute-api:me-central-1:100000000201:abc123/*/*"
    error_message = "Only this API may invoke the function."
  }

  assert {
    condition     = jsondecode(aws_apigatewayv2_stage.default.access_log_settings[0].format).correlation_id == "$context.requestId"
    error_message = "Access logs carry the correlation id."
  }
}

run "log_retention_follows_data_classification" {
  command = apply

  variables {
    data_classification = "restricted"
  }

  assert {
    condition     = aws_cloudwatch_log_group.function.retention_in_days == 731 && aws_cloudwatch_log_group.access.retention_in_days == 731
    error_message = "Restricted data keeps logs for two years."
  }
}

run "mandatory_tags_are_present" {
  command = apply

  assert {
    condition = alltrue([
      for r in [aws_lambda_function.this.tags, aws_cloudwatch_log_group.function.tags, aws_apigatewayv2_api.this.tags, aws_iam_role.function.tags, aws_sns_topic.alarms.tags] :
      alltrue([for k in ["cost-centre", "owner", "environment", "team", "data-classification", "golden-path", "module-version"] : contains(keys(r), k)])
    ])
    error_message = "Mandatory tags must be on every taggable resource."
  }
}

run "table_is_optional_and_protected" {
  command = apply

  variables {
    table = true
  }

  assert {
    condition     = aws_dynamodb_table.this[0].point_in_time_recovery[0].enabled && aws_dynamodb_table.this[0].deletion_protection_enabled
    error_message = "The prod table has PITR and deletion protection."
  }

  assert {
    condition     = aws_dynamodb_table.this[0].tags["backup"] == "standard"
    error_message = "An internal table is selected by the org backup policy as standard (copied to the central vault in prod)."
  }

  assert {
    condition     = output.table_name == "cargo-tracking-prod-data"
    error_message = "The table name is exposed."
  }
}

run "php_via_custom_runtime_and_layer" {
  command = apply

  variables {
    runtime = "provided.al2023"
    layers  = ["arn:aws:lambda:me-central-1:534081306603:layer:arm-php-83:42"]
  }

  assert {
    condition     = aws_lambda_function.this.runtime == "provided.al2023" && aws_lambda_function.this.handler == "public/index.php"
    error_message = "PHP runs on provided.al2023 with the Bref handler convention."
  }
}

run "custom_runtime_without_layer_or_handler_is_rejected" {
  command = plan

  variables {
    runtime = "provided.al2023"
  }

  expect_failures = [aws_lambda_function.this]
}

run "unsupported_runtimes_are_rejected" {
  command = plan

  variables {
    runtime = "nodejs16.x"
  }

  expect_failures = [var.runtime]
}

run "other_invalid_inputs_are_rejected" {
  command = plan

  variables {
    artifact        = "s3://northstar-artifacts/cargo-tracking/latest"
    timeout_seconds = 60
  }

  expect_failures = [var.artifact, var.timeout_seconds]
}
