# Preventive guardrails. The JSON documents in policies/scp/ are the source of truth;
# this file only decides where they attach. Guardrails get stricter per environment:
# Sandbox < Dev < Test < Prod. Mind the AWS limit of 5 SCPs per target (FullAWSAccess counts).

locals {
  scp_files = fileset("${path.module}/../policies/scp", "*.json")
  scps      = { for f in local.scp_files : trimsuffix(f, ".json") => "${path.module}/../policies/scp/${f}" }

  scp_attachments = {
    "Root"           = ["guardrails-baseline", "region-allowlist"] # every account, every OU
    "Security"       = ["prod-strict"]                             # core accounts are prod-like
    "Infrastructure" = ["prod-strict"]
    "Workloads/Prod" = ["prod-strict"]
    "Sandbox"        = ["sandbox-isolation"]
    "PolicyStaging"  = var.policy_staging_scps
    "Suspended"      = ["deny-all"]
  }

  scp_attachment_pairs = merge([
    for target, policies in local.scp_attachments : {
      for p in policies : "${target}:${p}" => { target = target, policy = p }
    }
  ]...)

  target_ids = merge(local.ou_ids, { "Root" = data.aws_organizations_organization.this.roots[0].id })
}

resource "aws_organizations_policy" "scp" {
  for_each = local.scps

  name        = "northstar-${each.key}"
  description = "NorthStar guardrail: ${each.key} (source: terraform/policies/scp/${each.key}.json)"
  type        = "SERVICE_CONTROL_POLICY"
  content     = file(each.value)
}

resource "aws_organizations_policy_attachment" "scp" {
  for_each = local.scp_attachment_pairs

  policy_id = aws_organizations_policy.scp[each.value.policy].id
  target_id = local.target_ids[each.value.target]
}
