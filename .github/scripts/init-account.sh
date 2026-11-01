#!/usr/bin/env bash
# Point an already-installed root module at one account's state, for jobs that handle a batch
# of accounts in turn. -reconfigure switches the state key without migrating anything, so the
# next account never sees the previous one's state. Run from the root module directory, after
# the terraform-init action has installed Terraform and written the S3 backend override.
#   usage: init-account.sh <account-name>
set -euo pipefail

rm -f tfplan plan.json
terraform init -input=false -reconfigure \
  -backend-config=../backend/s3.tfbackend \
  -backend-config="key=accounts/$1.tfstate"
