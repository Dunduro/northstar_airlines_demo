"""Structured JSON logging with the platform's mandatory fields (architecture 3.1).

One JSON object per line on stdout. Lambda forwards such lines unchanged, so service, team,
environment, version and correlation_id stay top-level fields.
"""

import json
import os
import sys
from datetime import UTC, datetime

CONTEXT = {
    "service": os.getenv("SERVICE", "hello-python-lambda"),
    "team": os.getenv("TEAM", "payments"),
    "environment": os.getenv("ENVIRONMENT", "local"),
    "version": os.getenv("VERSION", "dev"),
}

_LEVELS = {"debug": 10, "info": 20, "warning": 30, "error": 40}
_THRESHOLD = _LEVELS.get(os.getenv("AWS_LAMBDA_LOG_LEVEL", os.getenv("LOG_LEVEL", "info")).lower(), 20)


class Logger:
    def __init__(self, **fields):
        self._fields = fields

    def _write(self, level: str, message: str, **extra) -> None:
        if _LEVELS[level] < _THRESHOLD:
            return
        entry = {
            "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": level,
            "message": message,
            **CONTEXT,
            **self._fields,
            **extra,
        }
        sys.stdout.write(json.dumps(entry, default=str) + "\n")

    def debug(self, message: str, **extra) -> None:
        self._write("debug", message, **extra)

    def info(self, message: str, **extra) -> None:
        self._write("info", message, **extra)

    def warning(self, message: str, **extra) -> None:
        self._write("warning", message, **extra)

    def error(self, message: str, **extra) -> None:
        self._write("error", message, **extra)
