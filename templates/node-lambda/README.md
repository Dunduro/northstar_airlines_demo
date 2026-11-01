# Template: `node-lambda` — Node 22 on `lambda-api`

An event-driven or spiky HTTP API: API Gateway HTTP API → Lambda (`nodejs22.x`, arm64).

## What you get

| | |
|---|---|
| Handler | `src/handler.js` (payload 2.0): `GET /health`, `GET /`, 404 for the rest, 500 with the correlation id on errors; no dependencies |
| Logging | `src/log.js`: JSON lines straight to stdout with `service`, `team`, `environment`, `version`, `correlation_id`, `request_id` (Lambda forwards them unchanged, so they stay top-level fields) |
| Correlation | `x-correlation-id` reused if valid, else API Gateway's request id (which is also in the access log) |
| Artifact | No container: `build-node.yml` with `package: lambda-zip` zips `src/` + production `node_modules`, scans it and uploads `s3://northstar-artifacts/<repo>/<version>.zip` once |
| Infra | `infra/main.tf` → `lambda-api ~> 1.5`, `runtime = "nodejs22.x"`: reserved concurrency, X-Ray, alarms per environment profile |
| Pipelines | `ci.yml` → `build-node.yml@v3`; `deploy.yml` → `reusable-deploy.yml@v3` |

## What you own

`src/`, `test/`, dependencies, extra infrastructure in `infra/` (e.g. an SQS trigger).

## Run locally

```bash
npm test                         # handler unit tests (node:test)
npm run invoke                   # runs events/health.json through the handler
```

No Docker image here — "where applicable": the artifact is the zip. AWS SAM's `sam local
start-api` also works against `src/handler.handler` if a team wants an HTTP loop locally.
