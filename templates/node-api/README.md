# Template: `node-api` — Node 22 + Fastify on `ecs-service`

A long-running HTTP API in a container on ECS Fargate, behind the account's shared ALB.

## What you get

| | |
|---|---|
| App | Fastify 5 hello-world: `GET /health` (ALB liveness), `GET /` |
| Logging | pino JSON lines with `service`, `team`, `environment`, `version`, `correlation_id`; auth headers redacted |
| Correlation | `x-correlation-id` reused if valid, minted otherwise, echoed on the response (`req.id`) |
| Image | Multi-stage: `npm ci --omit=dev` on Debian slim → **distroless** `nodejs22` runtime, uid `nonroot`, no shell |
| Infra | `infra/main.tf` → `ecs-service ~> 2.4` from the platform registry |
| Pipelines | `ci.yml` → `build-node.yml@v3` (+ deploy to dev on main); `deploy.yml` → `reusable-deploy.yml@v3` for test/prod |
| Manifest | `platform.yaml` — registers the service, team, owner and alert routing |

## What you own

`src/`, `test/`, dependencies in `package.json`, extra infrastructure next to the module in
`infra/` (plain Terraform), and the decision when to promote. The platform owns the module,
the build/deploy workflows, the base-image policy, scaling defaults and alarms.

## Run locally

```bash
npm install
npm test                      # node:test, no server needed (app.inject)
npm run dev                   # http://localhost:8080/health

docker build -t hello-node-api .
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 hello-node-api
curl -i -H 'x-correlation-id: abc-123' localhost:8080/health
```

## Conventions this template relies on

- Repository name `<team>-<service>` (e.g. `payments-hello-node-api`): the deploy role only
  trusts the team's repos (ADR-011).
- Repository variables `AWS_ACCOUNT_ID_DEV|TEST|PROD`, set by the scaffolder from the registry.
- The container listens on `$PORT` (8080), runs as non-root on a read-only root filesystem
  with a writable `/tmp`, and exits cleanly on `SIGTERM`.
- `infra/` cannot be `terraform init`-ed outside the platform runners: it pulls the module
  from `registry.northstar.internal`. `terraform fmt -check` works anywhere.
