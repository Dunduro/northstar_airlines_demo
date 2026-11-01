# Template: `dotnet-api` — .NET 8 minimal API on `ecs-service`

A long-running HTTP API in a container on ECS Fargate, behind the shared ALB.

## What you get

| | |
|---|---|
| App | ASP.NET Core 8 minimal API (`src/Api`): `GET /health`, `GET /`; nullable on, warnings as errors |
| Logging | `PlatformJsonFormatter` (console formatter): flat JSON lines with `service`, `team`, `environment`, `version`, `correlation_id` and the message template's fields |
| Correlation | `CorrelationIdMiddleware`: `x-correlation-id` reused if valid, minted otherwise, echoed, carried in the logging scope |
| Tests | xUnit + `WebApplicationFactory` (`tests/Api.Tests`) |
| Image | Multi-stage: SDK builds on the build machine's architecture and cross-targets the image's (`-a $TARGETARCH`) → `aspnet:8.0-noble-chiseled` runtime (no shell, no package manager, non-root `app` user) |
| Infra | `infra/main.tf` → `ecs-service ~> 2.4` |
| Pipelines | `ci.yml` → `build-dotnet.yml@v3` (`dotnet format --verify-no-changes`, build, test, image, SBOM, scan); `deploy.yml` → `reusable-deploy.yml@v3` |

## What you own

`src/`, `tests/`, package references, extra infrastructure in `infra/`.

## Run locally

```bash
dotnet test
dotnet run --project src/Api              # http://localhost:8080/health

docker build -t hello-dotnet-api .
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 hello-dotnet-api
```

.NET on Lambda (`dotnet8`) is supported by `lambda-api` but not templated yet.
