"""Structured JSON logging with the platform's mandatory fields (architecture 3.1).

One JSON object per line on stdout: timestamp, level, message, service, team, environment,
version and correlation_id. The correlation id lives in a context variable, so any log call
made while handling a request carries it without passing it around.
"""

import json
import logging
import os
import re
import sys
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime

correlation_id: ContextVar[str] = ContextVar("correlation_id", default="-")

CONTEXT = {
    "service": os.getenv("SERVICE", "hello-python-api"),
    "team": os.getenv("TEAM", "cargo"),
    "environment": os.getenv("ENVIRONMENT", "local"),
    "version": os.getenv("VERSION", "dev"),
}

_VALID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def new_correlation_id(header: str | None) -> str:
    """Reuse a sane inbound x-correlation-id, otherwise mint one."""
    return header if header and _VALID.match(header) else str(uuid.uuid4())


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "message": record.getMessage(),
            **CONTEXT,
            "correlation_id": correlation_id.get(),
            "logger": record.name,
        }
        entry.update(getattr(record, "fields", {}))
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    # uvicorn's own access log is replaced by the request log in main.py
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers = []
        logging.getLogger(name).propagate = True
