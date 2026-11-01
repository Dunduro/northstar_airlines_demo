"""Local run without AWS: python -m app.invoke events/health.json"""

import json
import sys
from types import SimpleNamespace

from app.handler import handler

with open(sys.argv[1] if len(sys.argv) > 1 else "events/health.json") as f:
    event = json.load(f)
print(json.dumps(handler(event, SimpleNamespace(aws_request_id="local")), indent=2))
