#!/usr/bin/env bash
# Summarise a terraform/backup plan (terraform show -json) for plan-on-pr and apply-backup.
# Prints step outputs (key=value) on stdout and appends a Markdown summary to
# $GITHUB_STEP_SUMMARY when it is set:
#   add, change, destroy  resource counts, as `terraform plan` counts them (replace = 1 + 1)
#   lock_changes          changes that touch the Vault Lock: any change to a
#                         aws_backup_vault_lock_configuration, or deleting/replacing a vault
#   lock_addresses        those resource addresses, comma-separated
#   usage: backup-plan-summary.sh <plan.json> <title>
set -euo pipefail

plan="$1"
title="$2"

count() { jq --arg a "$1" '[.resource_changes[]? | select(.change.actions | index($a))] | length' "$plan"; }
add=$(count create)
change=$(count update)
destroy=$(count delete)
lock=$(jq -c '[.resource_changes[]?
  | select(.change.actions != ["no-op"] and .change.actions != ["read"])
  | select(.type == "aws_backup_vault_lock_configuration"
           or (.type == "aws_backup_vault" and (.change.actions | index("delete"))))
  | .address]' "$plan")
lock_changes=$(jq length <<<"$lock")
lock_addresses=$(jq -r 'join(",")' <<<"$lock")

echo "add=$add"
echo "change=$change"
echo "destroy=$destroy"
echo "lock_changes=$lock_changes"
echo "lock_addresses=$lock_addresses"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### ${title}"
    echo
    echo "| add | change | destroy | Vault Lock changes |"
    echo "|---|---|---|---|"
    echo "| ${add} | ${change} | ${destroy} | ${lock_changes} |"
    echo
    echo "Vault Lock is in compliance mode: after its grace period a lock change is irreversible."
    echo
    if [ "$lock_changes" -gt 0 ]; then
      echo "> [!CAUTION]"
      echo "> This plan changes the **Vault Lock** (\`${lock_addresses}\`). The central vault's lock is in"
      echo "> compliance mode: once its grace period has passed, the change is **irreversible** (nobody,"
      echo "> root included, can remove the lock or shorten retention). Applying requires"
      echo "> \`confirm_vault_lock_change: true\` on a manual run of apply-backup."
    fi
    echo
    echo "<details><summary>Changed resources</summary>"
    echo
    echo '```'
    jq -r '.resource_changes[]? | select(.change.actions != ["no-op"] and .change.actions != ["read"])
      | "\(.change.actions | join("/"))\t\(.address)"' "$plan"
    echo '```'
    echo "</details>"
  } >>"$GITHUB_STEP_SUMMARY"
fi
