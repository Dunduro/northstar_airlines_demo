# Template: `python-fastapi` — Python 3.12 + FastAPI on `ecs-service`

A long-running HTTP API in a container on ECS Fargate, behind the account's shared ALB.

## What you get

| | |
|---|---|
| App | FastAPI hello-world served by uvicorn: `GET /health` (ALB liveness), `GET /` |
| Logging | stdlib `logging` with a JSON formatter: `service`, `team`, `environment`, `version`, `correlation_id` on every line (context variable, so any log call in a request carries it) |
| Correlation | middleware: `x-correlation-id` reused if valid, minted otherwise, echoed on the response |
| Image | Multi-stage: dependencies into a venv on `python:3.12-slim` → runtime with only the venv + app, uid `10001` |
| Infra | `infra/main.tf` → `ecs-service ~> 2.4` |
| Pipelines | `ci.yml` → `build-python.yml@v3` (ruff, pytest, image, SBOM, scan); `deploy.yml` → `reusable-deploy.yml@v3` |
| Manifest | `platform.yaml` |

## What you own

`app/`, `tests/`, pinned dependencies in `requirements*.txt` (Renovate bumps them), extra
infrastructure in `infra/`. The platform owns the module, workflows and alarms.

## Run locally

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
ruff check . && pytest -q
uvicorn app.main:app --port 8080 --reload     # http://localhost:8080/health

docker build -t hello-python-api .
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 hello-python-api
```

## Conventions

Same as every container template: repo `<team>-<service>`, `AWS_ACCOUNT_ID_*` variables,
`$PORT` 8080, non-root, read-only root filesystem, `/health` without dependency calls.
`infra/` needs the private module registry for `terraform init`.
