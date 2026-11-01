# syntax=docker/dockerfile:1
# Multi-stage: wheels are installed into a virtualenv on the build image; the runtime image
# gets only the venv and the app, and runs as an unprivileged user.

FROM python:3.12-slim-bookworm AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
COPY requirements.txt .
RUN /venv/bin/pip install --require-virtualenv -r requirements.txt

FROM python:3.12-slim-bookworm AS runtime
ENV PATH=/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /srv
COPY --from=build /venv /venv
COPY app ./app
USER 10001:10001
EXPOSE 8080
# No HEALTHCHECK: the ALB probes GET /health. exec form: uvicorn is PID 1's child via the ECS init process.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --no-access-log --proxy-headers --forwarded-allow-ips='*'"]
