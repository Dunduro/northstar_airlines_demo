# ADR-015: Golden paths are language-agnostic; the language lives in the template and the container image

**Status:** Accepted (2026-10-31)

## Context

NorthStar's teams write Node, PHP, .NET and Python today, and will add more. The platform
must give every one of them a paved road — monitoring, scaling, alarms, a deploy path into
Prod — without a platform team of a few people maintaining one Terraform module per language
and runtime, and without a team's language choice deciding how its service is operated.

What actually differs between languages is small and well contained: how dependencies are
installed, how tests run, what the runtime image looks like, and how the app writes logs.
What must not differ is everything on-call and security care about: how the service is
reached, scaled, observed, alarmed, tagged and deployed.

## Decision

Split the paved road along that line:

- **Golden-path modules are language-agnostic.** `ecs-service` runs any container image pinned
  by digest; `lambda-api` takes a runtime from an allow-list (`nodejs22.x`, `python3.12/3.13`,
  `dotnet8`, `provided.al2023`) and a versioned zip; `static-site` serves a versioned bundle.
  No module has a `language` input, and none branches on one.
- **The language lives in two places only:** the **template** (starter repo: app skeleton,
  Dockerfile, `platform.yaml`, `infra/`, pipeline stubs; see `templates/`) and the
  **container image** (or Lambda bundle) it produces.
- **One reusable build workflow per language** (`build-node`, `build-php`, `build-dotnet`,
  `build-python`, `build-static`) knows how to lint, test and package that language, then
  applies the same supply-chain steps to every artifact: SBOM, vulnerability scan with a gate
  on fixable critical findings, publish-once to the artifact store. Deployment stays one
  workflow for all languages (`reusable-deploy.yml`, ADR-011).
- **A shared runtime contract** makes every service look the same to the platform, whatever
  it is written in: `GET /health`, JSON logs with `service`, `team`, `environment`, `version`,
  `correlation_id`, `x-correlation-id` propagation, `$PORT` 8080, non-root, read-only root
  filesystem, clean exit on `SIGTERM`. Each template implements it in its own idiom.

## Alternatives considered

- **A module per language (`node-service`, `php-service`, …).** Familiar to teams, but the
  platform would maintain N copies of the same ALB, scaling and alarm logic, fixes would ship
  N times, and the copies would drift. Rejected.
- **Buildpacks (Cloud Native Buildpacks / Paketo) instead of Dockerfiles.** No Dockerfile to
  maintain and consistent base images, but less transparent to teams, weaker for PHP
  (nginx + php-fpm in one image) and less control over the runtime image. Kept as an option
  for a later template version; the module interface would not change because it only sees
  an image digest.
- **FrankenPHP for the PHP template.** Evaluated FrankenPHP worker mode (lower latency); kept
  nginx + php-fpm as the default for operational maturity — a team can opt in later.
- **One "universal" template with a language switch.** Fewer repositories, but every team
  carries files for languages it does not use, and the template becomes the most complex
  thing on the road. Rejected in favour of small templates.
- **Only Lambda, or only containers.** Simpler, but spiky integrations pay for idle
  containers and long-running PHP/.NET apps fight Lambda's model. Three paths cover the
  estate; anything else takes the EC2 exception path (architecture §3).

## Consequences

- Positive: adding a language costs a template and a build workflow, not a module; the
  operational surface (alarms, scaling, deploy, Prod trust) stays one thing to review and fix.
- Positive: teams choose their language freely (architecture §4.5) and still land on the same
  monitoring, alerting and deployment model.
- Positive: a module fix (e.g. a new alarm) reaches every language with one version bump.
- Negative: the runtime contract is enforced by templates and tests, not by the module; a team
  that edits its logger can break the log format. The dashboard can detect missing fields
  later (a platform rule on log samples) — not built in the PoC.
- Negative: base images and language runtimes (e.g. the Bref layer for PHP on Lambda, the
  php-fpm + nginx image) become platform-curated dependencies with their own patch cadence;
  Renovate and the scan gate carry that load.
- Negative: a per-language build workflow is still N workflows; their shared supply-chain
  steps are duplicated today and should move into one composite action when the
  platform-workflows repository is split out.
