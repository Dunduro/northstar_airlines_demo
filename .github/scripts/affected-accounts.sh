#!/usr/bin/env bash
# Print (as a compact JSON array) the registry accounts whose baseline plan is affected by
# the changes between <base-ref> and HEAD.
#   - baseline module or per-account root changed  -> every account
#   - only the registry changed                     -> only added or changed entries
#   - anything else                                 -> []
# Suspended accounts are never planned.
#   usage: affected-accounts.sh <base-ref>
set -euo pipefail

base="$1"
registry="terraform/registry/accounts.yaml"
tmp="${RUNNER_TEMP:-/tmp}"
select='[.accounts[] | select(.ou != "Suspended") | {"id": .id, "name": .name, "environment": .environment}]'

changed="$(git diff --name-only "${base}...HEAD")"

if grep -qE '^terraform/(modules/account-baseline|baseline)/' <<<"$changed"; then
  yq -o=json -I=0 "$select" "$registry"
  exit 0
fi

if grep -qx "$registry" <<<"$changed"; then
  git show "${base}:${registry}" >"$tmp/registry.base.yaml" 2>/dev/null || echo 'accounts: []' >"$tmp/registry.base.yaml"
  yq -o=json -I=0 "$select" "$tmp/registry.base.yaml" >"$tmp/base.json"
  # Compare full entries, so a changed owner or OU also triggers a plan.
  yq -o=json -I=0 '[.accounts[]]' "$tmp/registry.base.yaml" >"$tmp/base-full.json"
  yq -o=json -I=0 '[.accounts[] | select(.ou != "Suspended")]' "$registry" |
    jq -c --slurpfile base "$tmp/base-full.json" \
      '[.[] as $a | select(($base[0] | index([$a])) == null) | {id: $a.id, name: $a.name, environment: $a.environment}]'
  exit 0
fi

echo '[]'
