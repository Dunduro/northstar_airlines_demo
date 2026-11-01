# Template: `php-symfony` — PHP 8.3 + Symfony 7.4 (micro-kernel) on nginx + php-fpm, `ecs-service`

A long-running PHP web app or API in a container on ECS Fargate, behind the shared ALB.

## What you get

| | |
|---|---|
| App | Symfony 7.4 LTS micro-kernel (`src/Kernel.php`, no YAML, no Flex): `GET /health`, `GET /` |
| Logging | `App\Logging\JsonLogger` (PSR-3, replaces Symfony's default logger): JSON lines on stderr with `service`, `team`, `environment`, `version`, `correlation_id`; nginx writes one JSON access-log line per request (not `/health`), php-fpm passes worker output through undecorated |
| Correlation | `RequestContextSubscriber`: `x-correlation-id` reused if valid, minted otherwise, echoed, logged |
| Image | Multi-stage: `composer install --no-dev` + authoritative classmap in `composer:2` → `php:8.3-fpm-alpine` runtime with nginx + supervisord (~150 MB), opcache with `validate_timestamps=0`, **Symfony cache warmed at build time**, uid `10001`, pid files, temp files and the fpm socket in `/tmp`, `pdo_pgsql` for the optional Aurora attachment |
| Infra | `infra/main.tf` → `ecs-service ~> 2.4` |
| Pipelines | `ci.yml` → `build-php.yml@v3` (composer validate, `php -l`, `composer test`, image, SBOM, scan); `deploy.yml` → `reusable-deploy.yml@v3` |

## Why nginx + php-fpm, in one image

- **The operational model PHP teams already know.** php-fpm with nginx in front is the
  longest-running production setup for PHP: familiar tuning (`pm.*`), familiar failure modes,
  and the official `php` image as the base, patched on the Docker library cadence.
- **One image, two supervised processes.** `ecs-service` runs one container per task, like every
  other template. supervisord (`docker/supervisord.conf`) starts php-fpm, then nginx, restarts
  either on a crash, stops both gracefully on `SIGTERM` (nginx first, so no 502s), and exits
  the container if one keeps failing so ECS replaces the task. `/health` goes through nginx to
  php-fpm to Symfony, so the ALB check proves the whole chain. The cost: supervisord brings
  Python into the image (scanned like everything else), and its rare crash/restart lines are
  plain text, not JSON.
- **The alternative, and why not (yet):** nginx and php-fpm as two containers in one task,
  sharing a socket on a task volume. Cleaner process model (one process per container, no
  supervisor, independent images), but `ecs-service` only renders one container today: it
  would need a module change (sidecar support, a major/minor bump, tests) for one language.
  If a second language needs a sidecar, that change pays for itself and this template moves.
- **Read-only root filesystem works.** nginx's pid and temp paths, php-fpm's pid and socket,
  and supervisord's pid all live in `/tmp`; the Symfony container is compiled into the image.
- **Worker sizing:** `pm = static`, `pm.max_children` from `PHP_FPM_MAX_CHILDREN` (default 8 for
  `small`, 512 MB). Rule of thumb: (task memory − 128 MB opcache − ~40 MB nginx/supervisord)
  / ~40 MB per worker; raise it through `environment_variables` for `medium`/`large`.
- Evaluated FrankenPHP worker mode (lower latency); kept nginx + php-fpm as the default for
  operational maturity — a team can opt in later.

## What you own

`src/`, `tests/`, `composer.json`/`composer.lock`, extra infrastructure in `infra/`.

## Run locally

```bash
composer install
composer test                            # boots the kernel, handles real requests
APP_CACHE_DIR=/tmp/sf php -S localhost:8080 -t public   # quick dev server, or:

docker build -t hello-php-api .
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 hello-php-api
curl -i -H 'x-correlation-id: abc-123' localhost:8080/health
```

PHP on Lambda (`provided.al2023` + a Bref layer) is supported by the `lambda-api` module but
not templated: for a web app this container path is the paved road.
