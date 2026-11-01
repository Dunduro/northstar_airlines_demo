#!/usr/bin/env bash
# Print (compact JSON) the registry accounts in one rollout wave: [{"targetId": …, "name": …}].
# Core accounts (security, logging, network) ride in the prod wave; Suspended accounts never.
# apps/mock-receivers/src/pipeline.ts mirrors this selection for the PoC simulation.
#   usage: wave-accounts.sh <sandbox|dev|test|prod>
set -euo pipefail

WAVE="$1" yq -o=json -I=0 '[.accounts[]
  | select(.ou != "Suspended")
  | select(.environment == strenv(WAVE) or (strenv(WAVE) == "prod" and .environment == "core"))
  | {"targetId": .id, "name": .name}]' terraform/registry/accounts.yaml
