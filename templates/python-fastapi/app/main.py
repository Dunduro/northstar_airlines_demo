"""The app. Platform conventions are wired in once (middleware), so handlers stay plain."""

import logging
import time

from fastapi import FastAPI, Request

from app import logging as platform_logging
from app.logging import CONTEXT, correlation_id, new_correlation_id

platform_logging.configure()
log = logging.getLogger("app")

app = FastAPI(title=CONTEXT["service"], version=CONTEXT["version"], docs_url=None, redoc_url=None)


@app.middleware("http")
async def correlation_and_request_log(request: Request, call_next):
    token = correlation_id.set(new_correlation_id(request.headers.get("x-correlation-id")))
    started = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["x-correlation-id"] = correlation_id.get()
        log.info(
            "request completed",
            extra={"fields": {
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            }},
        )
        return response
    finally:
        correlation_id.reset(token)


@app.get("/health")
def health() -> dict:
    """Liveness for the ALB health check: no dependency calls."""
    return {"status": "ok", "service": CONTEXT["service"], "version": CONTEXT["version"]}


@app.get("/")
def hello() -> dict:
    log.info("said hello", extra={"fields": {"event": "hello"}})
    return {"message": f"Hello from {CONTEXT['service']}", "correlation_id": correlation_id.get()}
