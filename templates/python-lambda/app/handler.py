"""API Gateway HTTP API (payload 2.0) -> Lambda.

Platform conventions are applied here once: correlation id in (x-correlation-id, else API
Gateway's request id), out (response header), and on every log line.
"""

import json
import re
import time
import uuid

from app.log import CONTEXT, Logger

_VALID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def _health(_event, _log):
    return {"status": "ok", "service": CONTEXT["service"], "version": CONTEXT["version"]}


def _hello(_event, log):
    log.info("said hello", event="hello")
    return {"message": f"Hello from {CONTEXT['service']}"}


ROUTES = {"GET /health": _health, "GET /": _hello}


def handler(event, context):
    inbound = (event.get("headers") or {}).get("x-correlation-id", "")
    request_context = event.get("requestContext") or {}
    correlation_id = inbound if _VALID.match(inbound) else request_context.get("requestId") or str(uuid.uuid4())
    log = Logger(correlation_id=correlation_id, request_id=getattr(context, "aws_request_id", None))

    method = (request_context.get("http") or {}).get("method", "GET")
    path = event.get("rawPath", "/")
    route = ROUTES.get(f"{method} {path}")
    started = time.perf_counter()

    status = 200
    try:
        if route is None:
            status, body = 404, {"error": "not found"}
        else:
            body = route(event, log)
    except Exception as err:  # noqa: BLE001 - the boundary: log it, answer 500 with the correlation id
        log.error("unhandled error", error=str(err))
        status, body = 500, {"error": "internal error", "correlation_id": correlation_id}

    log.info("request completed", method=method, path=path, status=status,
             duration_ms=round((time.perf_counter() - started) * 1000, 1))
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "x-correlation-id": correlation_id},
        "body": json.dumps(body),
    }
