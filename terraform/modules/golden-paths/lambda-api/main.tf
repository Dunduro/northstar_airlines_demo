# Golden path: lambda-api (API Gateway HTTP API + Lambda + optional DynamoDB).
#
# Language-agnostic like every golden path (ADR-015): the runtime is an input from an
# allow-list, the code arrives as a versioned zip built by the platform's build workflows.
#
#   nodejs22.x, python3.12/3.13, dotnet8  managed AWS runtimes, patched by AWS
#   provided.al2023                       custom runtime: Go/Rust binaries, or PHP through a
#                                         Bref-style runtime layer (`layers`). AWS has no
#                                         managed PHP runtime; with PHP the layer is the
#                                         runtime, so its version is pinned and upgraded like
#                                         any other dependency (Renovate), not patched by AWS.

locals {
  module_version = "1.5.0"

  log_retention_days = {
    public       = 30
    internal     = 90
    confidential = 365
    restricted   = 731
  }

  # Environment profiles: reserved concurrency protects the account's shared pool (1 000 by
  # default) from one runaway function; API throttling protects the function.
  profiles = {
    sandbox = { reserved_concurrency = 5, burst = 20, rate = 10 }
    dev     = { reserved_concurrency = 10, burst = 50, rate = 25 }
    test    = { reserved_concurrency = 25, burst = 100, rate = 50 }
    prod    = { reserved_concurrency = 100, burst = 500, rate = 250 }
  }
  profile = local.profiles[var.environment]

  default_handlers = {
    "nodejs22.x"      = "src/handler.handler"
    "python3.12"      = "app.handler.handler"
    "python3.13"      = "app.handler.handler"
    "dotnet8"         = "Api::Api.Function::Handler"
    "provided.al2023" = "public/index.php" # Bref convention; ignored by Go/Rust "bootstrap" binaries
  }

  function_name = "${var.name}-${var.environment}"

  artifact_bucket = regex("^s3://([^/]+)/(.+)$", var.artifact)[0]
  artifact_key    = regex("^s3://([^/]+)/(.+)$", var.artifact)[1]
  app_version     = trimsuffix(basename(local.artifact_key), ".zip")

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
    golden-path    = "lambda-api"
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

data "aws_caller_identity" "current" {}

# --- Logs --------------------------------------------------------------------------------

# Lambda writes JSON (logging_config below); the template's logger adds service, team,
# environment, version and correlation_id.
resource "aws_cloudwatch_log_group" "function" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = local.log_retention_days[var.data_classification]
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/northstar/${var.environment}/${var.name}/api-access"
  retention_in_days = local.log_retention_days[var.data_classification]
  tags              = local.tags
}

resource "aws_sns_topic" "alarms" {
  name              = "${local.function_name}-alarms"
  kms_master_key_id = "alias/aws/sns"
  tags              = merge(local.tags, { owner = coalesce(var.owner, var.team), alert-route = var.team })
}

# --- Identity (under /workload/, the only path the deploy role may manage) -------------------

resource "aws_iam_role" "function" {
  name = "${local.function_name}-fn"
  path = "/workload/"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.function.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "xray" {
  count = var.tracing ? 1 : 0

  role       = aws_iam_role.function.name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

resource "aws_iam_role_policy" "table" {
  count = var.table ? 1 : 0

  name = "own-table-only"
  role = aws_iam_role.function.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
        "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem",
      ]
      Resource = [aws_dynamodb_table.this[0].arn, "${aws_dynamodb_table.this[0].arn}/index/*"]
    }]
  })
}

# --- The function --------------------------------------------------------------------------

resource "aws_lambda_function" "this" {
  function_name                  = local.function_name
  role                           = aws_iam_role.function.arn
  runtime                        = var.runtime
  handler                        = coalesce(var.handler, local.default_handlers[var.runtime])
  architectures                  = [var.architecture]
  s3_bucket                      = local.artifact_bucket
  s3_key                         = local.artifact_key
  memory_size                    = var.memory_mb
  timeout                        = var.timeout_seconds
  reserved_concurrent_executions = coalesce(var.reserved_concurrency, local.profile.reserved_concurrency)
  layers                         = var.layers

  environment {
    variables = merge(var.environment_variables, var.table ? { TABLE_NAME = aws_dynamodb_table.this[0].name } : {}, {
      SERVICE     = var.name
      TEAM        = var.team
      ENVIRONMENT = var.environment
      VERSION     = local.app_version
      LOG_FORMAT  = "json"
    })
  }

  tracing_config {
    mode = var.tracing ? "Active" : "PassThrough"
  }

  logging_config {
    log_format            = "JSON"
    log_group             = aws_cloudwatch_log_group.function.name
    application_log_level = var.environment == "prod" ? "INFO" : "DEBUG"
    system_log_level      = "WARN"
  }

  tags = local.tags

  lifecycle {
    precondition {
      condition     = var.runtime != "provided.al2023" || length(var.layers) > 0 || var.handler != null
      error_message = "provided.al2023 needs either a runtime layer (e.g. Bref for PHP) or an explicit handler for a bootstrap binary."
    }
  }

  depends_on = [aws_iam_role_policy_attachment.logs]
}

# --- Optional table ----------------------------------------------------------------------------

resource "aws_dynamodb_table" "this" {
  count = var.table ? 1 : 0

  name         = "${local.function_name}-data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  deletion_protection_enabled = var.environment == "prod"

  # PITR is tier 1 in the table itself; the `backup` tag puts it under the org backup policy
  # (snapshots, and in prod an immutable copy in the Backup account). Sensitive data = critical.
  tags = merge(local.tags, {
    backup = contains(["confidential", "restricted"], var.data_classification) ? "critical" : "standard"
  })
}

# --- HTTP API --------------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = local.function_name
  protocol_type = "HTTP"
  tags          = local.tags
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = (var.timeout_seconds + 1) * 1000
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = local.profile.burst
    throttling_rate_limit  = local.profile.rate
  }

  # One JSON line per request; correlation_id is the API Gateway request id, which the function
  # also logs (and passes on in x-correlation-id).
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      correlation_id = "$context.requestId"
      service        = var.name
      environment    = var.environment
      method         = "$context.httpMethod"
      path           = "$context.path"
      status         = "$context.status"
      latency_ms     = "$context.responseLatency"
      integration_ms = "$context.integrationLatency"
      error          = "$context.integrationErrorMessage"
    })
  }

  tags = local.tags
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
