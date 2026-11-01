# Golden path: `ecs-service` (v2.4.0)

Containers on ECS Fargate behind the account's shared ALB, for standard web apps and APIs.
Fully owned by the platform team: scaling, logging, default alarms, patching of the platform
layer. **Language-agnostic** (ADR-015): Node, PHP, .NET, Python, Go — the language lives in the
container image; the templates in `templates/` produce that image.

## What you get

| | |
|---|---|
| Compute | Fargate service (ARM64 by default), task definition running exactly the image digest given, circuit breaker with automatic rollback |
| Traffic | Target group with `/health` check, host-header rule `<name>.<env>.northstar.internal` on the shared HTTPS listener |
| Network | Private subnets, no public IP, security group that only accepts the ALB's security group |
| Scaling | Target tracking on CPU (60%) and on ALB requests per task; min/max per size **and** environment profile |
| Logs | `/northstar/<env>/<name>`, retention by data classification (30 / 90 / 365 / 731 days) |
| Alarms | 5xx rate > 5%, p95 latency, CPU > 80%, memory > 85%, unhealthy targets → SNS topic tagged with the owner |
| Database (optional) | Aurora PostgreSQL wiring: SG rules on the DB port, `DB_USER`/`DB_PASSWORD` injected from the cluster's Secrets Manager secret |
| Identity | Execution and task roles under `/workload/` (the only path the deploy role may manage) |

Shared infrastructure (VPC, private subnets, ECS cluster `northstar-<env>`, ALB and HTTPS
listener) is owned by the baseline/network stack and discovered through SSM parameters under
`/northstar/` — so this interface did not change when the resources landed (2.3 → 2.4 is a
minor upgrade).

### Environment profiles

| | sandbox | dev | test | prod |
|---|---|---|---|---|
| Min tasks | 1 | 1 | 1 | max(size min, **2**) |
| Max tasks | min(size max, 2) | min(size max, 3) | min(size max, 6) | size max |
| p95 latency alarm | 3 s | 2 s | 1.5 s | 1 s |
| ECS Exec | on | on | on | **off** |

Sizes: `small` 0.25 vCPU / 512 MB (1–2), `medium` 0.5 vCPU / 1 GB (2–6), `large` 1 vCPU / 2 GB (3–12).

## Use

```hcl
module "service" {
  source  = "registry.northstar.internal/platform/ecs-service/aws"
  version = "~> 2.4"

  name                = "baggage-tracker"
  team                = "ground-ops"
  owner               = "ground-ops-lead@northstar.example"
  cost_centre         = "CC-1004"
  environment         = var.environment
  image               = var.artifact # <repo>:<version>@sha256:<digest>, from the build workflow
  size                = "medium"
  data_classification = "internal"

  # Optional: the Aurora cluster lives in the product's deployment repo (stateful, stricter review).
  database = {
    endpoint          = "baggage.cluster-abc.me-central-1.rds.amazonaws.com"
    name              = "baggage"
    secret_arn        = "arn:aws:secretsmanager:me-central-1:100000000103:secret:rds!cluster-abc"
    security_group_id = "sg-0db0000000000001"
  }
}
```

Deploys run through the platform's reusable deploy workflow; that is the only identity the
account's deploy role trusts (ADR-011).

## Inputs

| Name | Type | Default | Notes |
|---|---|---|---|
| `name` | string | — | 3–31 chars, lowercase |
| `team` | string | — | alerts route here |
| `environment` | string | — | sandbox, dev, test, prod |
| `image` | string | — | must be pinned by digest |
| `owner`, `cost_centre` | string | `null` | mandatory tags; a `check` warns when missing and the policy check in the deploy fails |
| `size` | string | `small` | small / medium / large |
| `data_classification` | string | `internal` | drives log retention |
| `container_port` | number | `8080` | unprivileged ports only (containers run as non-root) |
| `health_check_path` | string | `/health` | |
| `environment_variables` | map(string) | `{}` | rejects secret-looking names |
| `secrets` | map(string) | `{}` | `ENV => Secrets Manager/SSM ARN` |
| `database` | object | `null` | Aurora attachment, see above |
| `cpu_architecture` | string | `ARM64` | or `X86_64` |
| `readonly_root_filesystem` | bool | `true` | writable `/tmp` always mounted |
| `latency_p95_threshold_seconds` | number | profile | |
| `requests_per_target` | number | `1000` | scaling target |
| `tags` | map(string) | `{}` | extra tags |

## Outputs

`module_version`, `service_name`, `task_size`, `log_group_name`, `alarm_names`,
`alarm_topic_arn`, `security_group_id`, `task_role_arn`, `url`.

## Tests

`terraform test` (mock provider): prod min capacity ≥ 2, dev profile caps, ingress only from
the ALB and no public IP, health check + rollback, five alarms routed to the owner's topic,
retention by classification, mandatory tags, Aurora credentials only via Secrets Manager,
invalid inputs rejected.

## Versioning

Semantic versions. The platform supports the current and previous major; Renovate opens the
upgrade PR and the dashboard shows who is behind.
