# The organisation shape. Policies attach to OUs, never to individual accounts:
# moving an account into Workloads/Prod gives it the Prod guardrails immediately.

locals {
  accounts = yamldecode(file(var.registry_file)).accounts

  top_level_ous = toset(["Security", "Infrastructure", "Workloads", "Sandbox", "PolicyStaging", "Suspended"])
  workload_ous  = toset(["Dev", "Test", "Prod"])

  # "Workloads/Prod" => "ou-xxxx", the same paths the registry uses.
  ou_ids = merge(
    { for name, ou in aws_organizations_organizational_unit.top : name => ou.id },
    { for name, ou in aws_organizations_organizational_unit.workloads : "Workloads/${name}" => ou.id },
  )
}

data "aws_organizations_organization" "this" {}

resource "aws_organizations_organizational_unit" "top" {
  for_each = local.top_level_ous

  name      = each.key
  parent_id = data.aws_organizations_organization.this.roots[0].id
}

resource "aws_organizations_organizational_unit" "workloads" {
  for_each = local.workload_ous

  name      = each.key
  parent_id = aws_organizations_organizational_unit.top["Workloads"].id
}

# Accounts themselves are vended by Control Tower Account Factory (AFT) from the same
# registry; AFT places each account in the OU named in its registry entry.
