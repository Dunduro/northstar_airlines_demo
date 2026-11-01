# Golden path: `lambda-api` (v1.5.0)

Serverless APIs and integrations: API Gateway HTTP API + Lambda, optionally a DynamoDB table.
Fully owned by the platform team. Language-agnostic (ADR-015): the runtime is an input from an
allow-list, the code arrives as a versioned zip.

## Runtimes

| `runtime` | For | Notes |
|---|---|---|
| `nodejs22.x` (default) | Node / TypeScript | template `node-lambda` |
| `python3.12`, `python3.13` | Python | template `python-lambda` |
| `dotnet8` | .NET | handler `Assembly::Namespace.Class::Method` |
| `provided.al2023` | Go/Rust binaries, **PHP** | custom runtime, see below |

**PHP, honestly:** AWS has no managed PHP runtime. PHP runs on `provided.al2023` with a
Bref-style runtime layer (`layers = ["arn:aws:lambda:<region>:<bref-account>:layer:arm-php-83:<n>"]`,
handler `public/index.php`). The layer *is* the PHP runtime, so the platform does not get AWS's
runtime patching for it: the layer version is pinned and bumped by Renovate like any other
dependency, and Bref's layer availability per region (including `me-central-1`) must be
confirmed or the layer mirrored into the platform account. For a long-running PHP web app,
`ecs-service` with the `php-symfony` template is the paved road; Lambda-PHP is supported, not
templated.

Anything else (e.g. `nodejs16.x`) fails validation.

## What you get

| | |
|---|---|
| Function | Runs exactly the versioned bundle given; ARM64; JSON log format; X-Ray tracing (flag) |
| Concurrency | Reserved per environment: sandbox 5, dev 10, test 25, prod 100 (override with `reserved_concurrency`) |
| API | HTTP API, `$default` route, payload 2.0, throttling per environment, JSON access logs with `correlation_id` |
| Logs | Function and access log groups, retention by classification |
| Alarms | errors, throttles, p95 duration > 80% of the timeout → SNS topic tagged with the owner |
| Table (optional) | DynamoDB on-demand, PITR, encryption, deletion protection in prod, least-privilege policy, `backup` tag (`critical` for confidential/restricted, else `standard`) so the org backup policy covers it |
| Identity | Function role under `/workload/` |

## Use

```hcl
module "api" {
  source  = "registry.northstar.internal/platform/lambda-api/aws"
  version = "~> 1.5"

  name        = "cargo-tracking"
  team        = "cargo"
  owner       = "cargo-lead@northstar.example"
  cost_centre = "CC-1003"
  environment = var.environment
  artifact    = var.artifact # s3://northstar-artifacts/cargo-tracking/1.8.0.zip
  runtime     = "nodejs22.x"
  table       = true
}
```

## Inputs

| Name | Type | Default | Notes |
|---|---|---|---|
| `name`, `team`, `environment` | string | — | as `ecs-service` |
| `artifact` | string | — | versioned zip in the artifact bucket (build once, deploy many) |
| `runtime` | string | `nodejs22.x` | allow-list above |
| `handler` | string | per runtime | |
| `layers` | list(string) | `[]` | ≤ 5 versioned layer ARNs |
| `architecture` | string | `arm64` | or `x86_64` |
| `memory_mb` | number | `512` | |
| `timeout_seconds` | number | `10` | 1–29 (HTTP API limit) |
| `reserved_concurrency` | number | profile | |
| `tracing` | bool | `true` | X-Ray active tracing |
| `environment_variables` | map(string) | `{}` | rejects secret-looking names |
| `table` | bool | `false` | |
| `data_classification` | string | `internal` | drives log retention |
| `owner`, `cost_centre` | string | `null` | mandatory tags |
| `tags` | map(string) | `{}` | |

## Outputs

`module_version`, `function_name`, `log_group_name`, `alarm_names`, `alarm_topic_arn`,
`api_url`, `invoke_url`, `table_name`, `function_role_arn`, `function_config`.

## Versioning

Semantic versions; current and previous major supported; Renovate opens upgrade PRs.
