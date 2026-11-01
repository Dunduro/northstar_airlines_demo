# syntax=docker/dockerfile:1
# Multi-stage: Composer resolves dependencies in its own image; the runtime is the official
# php-fpm image with nginx in front, both supervised by supervisord, running as an unprivileged
# user with a warmed Symfony cache.
#
# Why one image and not an nginx sidecar: ecs-service runs one container per task, and every
# other template ships one image. Two processes under supervisord keep that contract (one
# image digest, one health check, one log stream); a sidecar would need a module change.
# supervisord over a shell entrypoint: it restarts a crashed process and forwards signals;
# over s6-overlay: s6 needs a writable /run, and the module only mounts /tmp.

FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --no-progress
COPY bin ./bin
COPY public ./public
COPY src ./src
RUN composer dump-autoload --no-dev --classmap-authoritative

# Alpine variant: a fraction of the Debian image; PHP does not care about musl.
FROM php:8.3-fpm-alpine AS runtime
ARG UID=10001
ENV APP_ENV=prod \
    APP_DEBUG=0 \
    PORT=8080 \
    PHP_FPM_MAX_CHILDREN=8
# pdo_pgsql for the optional Aurora PostgreSQL attachment (build deps removed in the same
# layer); the image's own fpm pool files are replaced by docker/php-fpm.conf.
RUN apk add --no-cache nginx supervisor libpq \
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS postgresql-dev \
 && docker-php-ext-install -j"$(nproc)" pdo_pgsql \
 && apk del .build-deps \
 && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && rm -f /usr/local/etc/php-fpm.d/* \
 && adduser -D -H -S -u "${UID}" -s /sbin/nologin app
COPY docker/php.ini "$PHP_INI_DIR/conf.d/zz-app.ini"
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/zz-app.conf
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisord.conf
WORKDIR /app
COPY --from=vendor /app /app
# Compile the container and routes at build time: the image runs with a read-only filesystem.
# Fail the build on a broken config rather than at the first deploy.
RUN php bin/console cache:warmup --no-debug \
 && php-fpm --test \
 && nginx -t -e /dev/stderr \
 && rm -rf /tmp/*
USER ${UID}
EXPOSE 8080
# No HEALTHCHECK: the ALB probes GET /health, which goes through nginx to php-fpm.
CMD ["supervisord", "-c", "/etc/supervisord.conf"]
