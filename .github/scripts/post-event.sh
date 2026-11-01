#!/usr/bin/env bash
# Post a pipeline result to the platform API, signed with HMAC-SHA256 over the raw body.
#   usage: post-event.sh <event.json>
#   env:   PLATFORM_API_URL, PLATFORM_WEBHOOK_SECRET
# Header format matches packages/shared/src/hmac.ts: "x-northstar-signature: sha256=<hex>".
set -euo pipefail

body_file="$1"
: "${PLATFORM_API_URL:?PLATFORM_API_URL is not set}"
: "${PLATFORM_WEBHOOK_SECRET:?PLATFORM_WEBHOOK_SECRET is not set}"

signature="sha256=$(openssl dgst -sha256 -hmac "$PLATFORM_WEBHOOK_SECRET" "$body_file" | awk '{print $NF}')"

curl --silent --show-error --fail-with-body \
  --retry 3 --retry-all-errors --max-time 10 \
  -X POST "${PLATFORM_API_URL%/}/v1/events/pipeline" \
  -H "content-type: application/json" \
  -H "x-northstar-signature: ${signature}" \
  --data-binary "@${body_file}"
echo
