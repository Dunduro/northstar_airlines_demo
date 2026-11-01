# Template: `python-lambda` — Python 3.12 on `lambda-api`

An event-driven or spiky HTTP API: API Gateway HTTP API → Lambda (`python3.12`, arm64).

## What you get

| | |
|---|---|
| Handler | `app/handler.py` (payload 2.0): `GET /health`, `GET /`, 404 for the rest, 500 with the correlation id on errors; standard library only |
| Logging | `app/log.py`: JSON lines on stdout with `service`, `team`, `environment`, `version`, `correlation_id`, `request_id` |
| Correlation | `x-correlation-id` reused if valid, else API Gateway's request id |
| Artifact | `build-python.yml` with `package: lambda-zip`: wheels for `manylinux2014_aarch64` + `app/` in one zip, scanned, uploaded once to `s3://northstar-artifacts/<repo>/<version>.zip` |
| Infra | `infra/main.tf` → `lambda-api ~> 1.5`, `runtime = "python3.12"` |
| Pipelines | `ci.yml` → `build-python.yml@v3` (ruff, pytest); `deploy.yml` → `reusable-deploy.yml@v3` |

## What you own

`app/`, `tests/`, pinned dependencies, extra infrastructure in `infra/`.

## Run locally

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
ruff check . && pytest -q
python -m app.invoke events/health.json
```
