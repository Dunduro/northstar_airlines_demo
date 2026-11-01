#!/usr/bin/env bash
# Group a JSON array of accounts (stdin) into batches for a GitHub Actions matrix, which is
# capped at 256 jobs per workflow run. Prints compact JSON:
#   [{"name": "b001", "size": 1, "accounts": [...]}, ...]
# Batch size = ceil(accounts / MAX_JOBS), so up to MAX_JOBS accounts keep one job each (the
# same as an unbatched matrix) and 2,000 accounts become 200 jobs of 10. Each job handles its
# accounts one after another, so max-parallel still caps how many accounts run at once.
#   usage: <accounts.json> | batch-accounts.sh [max-jobs]   (default 200, headroom under 256)
set -euo pipefail

max_jobs="${1:-200}"
[[ "$max_jobs" =~ ^[1-9][0-9]*$ && "$max_jobs" -le 256 ]] || {
  echo "max-jobs must be 1-256, got '$max_jobs'" >&2
  exit 1
}

jq -c --argjson max "$max_jobs" '
  if type != "array" then error("expected a JSON array of accounts") else . end
  | (length) as $n
  | (if $n == 0 then 1 else (($n + $max - 1) / $max | floor) end) as $size
  | [range(0; $n; $size) as $i
     | .[$i:$i + $size]
     | {name: ("b" + (($i / $size + 1) | tostring | ("00" + .)[-3:])), size: length, accounts: .}]'
