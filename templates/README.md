# Templates — the paved road, per language

A template is what a team gets when it picks a flavour in the dashboard: a new repository with
a hello-world app, its Terraform, its pipelines and a service manifest, deployable to Dev in
minutes. Templates are small on purpose — everything that is the same for every service lives
in the platform (golden-path modules, reusable workflows), so a fix there reaches every team
with one release instead of seven copy-paste PRs.

**The golden paths are language-agnostic; the language lives in the template and the
container image** (ADR-015). `ecs-service` does not know whether it runs Node or PHP.

## Catalog

| Template | Language / framework | Golden path | Module | Build workflow | Choose it when |
|---|---|---|---|---|---|
| [`node-api`](node-api/) | Node 22 + Fastify 5 | `ecs-service` | `~> 2.4` | `build-node.yml` | A typical HTTP/JSON API or BFF; the default for new backend work |
| [`php-symfony`](php-symfony/) | PHP 8.3 + Symfony 7.4, nginx + php-fpm | `ecs-service` | `~> 2.4` | `build-php.yml` | PHP teams, Symfony apps, moving existing PHP onto the platform |
| [`dotnet-api`](dotnet-api/) | .NET 8 minimal API | `ecs-service` | `~> 2.4` | `build-dotnet.yml` | .NET teams, typed domain-heavy services, existing C# libraries |
| [`python-fastapi`](python-fastapi/) | Python 3.12 + FastAPI | `ecs-service` | `~> 2.4` | `build-python.yml` | Data-adjacent APIs, ML model serving, Python teams |
| [`node-lambda`](node-lambda/) | Node 22 | `lambda-api` (`nodejs22.x`) | `~> 1.5` | `build-node.yml` (`lambda-zip`) | Webhooks, integrations, spiky or low-traffic APIs |
| [`python-lambda`](python-lambda/) | Python 3.12 | `lambda-api` (`python3.12`) | `~> 1.5` | `build-python.yml` (`lambda-zip`) | Same, for Python teams and glue/automation code |
| [`react-static`](react-static/) | Vite + React 19 | `static-site` | `~> 2.0` | `build-static.yml` | SPAs, internal tools' frontends, documentation |

Supported by the modules but not templated (yet): .NET on Lambda (`dotnet8`), PHP on Lambda
(`provided.al2023` + a Bref layer — see the `lambda-api` README for the honest trade-offs),
Go/Rust on `provided.al2023` or in a container.

## Which golden path?

```
Is it a browser frontend or docs (no server code)?
  └─ yes → static-site                          (react-static)
Is it event-driven, spiky, low-traffic, or glue between systems?
  └─ yes → lambda-api                           (node-lambda, python-lambda)
Is it a long-running web app or API (steady traffic, connection pools, websockets,
requests > 29 s, or a framework that wants to stay booted)?
  └─ yes → ecs-service                          (node-api, php-symfony, dotnet-api, python-fastapi)
Is it legacy or vendor software, needs a specific OS/licence, or cannot be containerised?
  └─ yes → EC2 exception path: golden AMI, SSM only, owner + expiry
           (architecture §3, "Custom" tier) — the team owns more of the operations
Really needs Kubernetes (operators, a vendor Helm chart)?
  └─ yes → EKS "Supported" tier (architecture §3)
```

## What every template contains

```
<template>/
├── README.md                    what you get, what you own, how to run locally
├── platform.yaml                service manifest (architecture §4.2): service, team, owner,
│                                cost centre, template, language, flavour, environments, …
├── infra/main.tf                calls registry.northstar.internal/platform/<module>/aws ~> x.y
├── src/ | app/                  hello world: /health + structured JSON logs with correlation id
├── Dockerfile                   container templates: multi-stage, non-root, small runtime image
└── .github/workflows/
    ├── ci.yml                   uses: northstar/platform-workflows/.github/workflows/build-<lang>.yml@v3
    │                            (+ reusable-deploy.yml@v3 to dev on main)
    └── deploy.yml               uses: …/reusable-deploy.yml@v3 for test/prod (promotion)
```

The same conventions hold in every language, so on-call reads every service the same way:

| Convention | Value |
|---|---|
| Health | `GET /health` → `200 {"status":"ok",…}`, no dependency calls (liveness) |
| Logs | one JSON object per line: `timestamp`, `level`, `message`, `service`, `team`, `environment`, `version`, `correlation_id` |
| Correlation | `x-correlation-id` accepted if it matches `^[A-Za-z0-9._:-]{1,128}$`, else minted; echoed on the response |
| Container | listens on `$PORT` (8080), non-root, read-only root filesystem + writable `/tmp`, clean exit on `SIGTERM` |
| Identity | repo name `<team>-<service>`; the deploy role trusts only the platform deploy workflow from the team's repos (ADR-011) |
| Artifacts | built once by the platform build workflow, scanned (SBOM + critical-vulnerability gate) before publishing, deployed by digest/version |

## Verifying the templates in this repo

`templates/*/infra` reference the private registry, which does not exist outside NorthStar:
`terraform init` fails there **by design**. What is checked locally:

```bash
terraform fmt -recursive -check templates
# container templates: build, run read-only, hit /health
docker build -t tpl-node-api templates/node-api
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 tpl-node-api   # curl localhost:8080/health
```

The dashboard lists this catalog at `GET /v1/templates` (Templates view); a unit test keeps that
list in sync with every `templates/*/platform.yaml` and with the module versions in the
platform catalog.
