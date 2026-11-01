# IAM Identity Center: five permission sets, assigned to Entra ID groups (SCIM-provisioned)
# per account, from the registry. Nobody has personal permissions: joining, moving and
# leaving a team is a group change in Entra, and access follows automatically.

data "aws_ssoadmin_instances" "this" {}

locals {
  sso_instance_arn  = tolist(data.aws_ssoadmin_instances.this.arns)[0]
  identity_store_id = tolist(data.aws_ssoadmin_instances.this.identity_store_ids)[0]

  permission_sets = {
    Developer = {
      description      = "Deploy, debug and read logs in non-production accounts."
      session_duration = "PT8H"
      managed_policies = ["arn:aws:iam::aws:policy/PowerUserAccess"]
    }
    LeadDeveloper = {
      description      = "Developer plus cost visibility for the team's accounts."
      session_duration = "PT8H"
      managed_policies = ["arn:aws:iam::aws:policy/PowerUserAccess", "arn:aws:iam::aws:policy/AWSBillingReadOnlyAccess"]
    }
    PlatformEngineer = {
      description      = "Administrator. In prod-like accounts only via a just-in-time (PIM) group."
      session_duration = "PT1H"
      managed_policies = ["arn:aws:iam::aws:policy/AdministratorAccess"]
    }
    SecurityAudit = {
      description      = "Read-only plus security tooling, everywhere."
      session_duration = "PT4H"
      managed_policies = ["arn:aws:iam::aws:policy/SecurityAudit", "arn:aws:iam::aws:policy/ReadOnlyAccess"]
    }
    ReadOnly = {
      description      = "Read-only, including logs. What developers get in Prod."
      session_duration = "PT4H"
      managed_policies = ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
    }
  }

  # Role x environment matrix: which permission set a group gets in an account of a given
  # environment. Missing = no access. Team-scoped groups ("%s" = team) only reach their own
  # team's accounts (the ABAC idea: the role decides what, the team decides where).
  # Prod deploys never come from a person: they go through the pipeline (see account-baseline).
  access_matrix = {
    developer = {
      group  = "aws-%s-developer"
      by_env = { sandbox = "Developer", dev = "Developer", test = "Developer", prod = "ReadOnly" }
    }
    lead-developer = {
      group  = "aws-%s-lead-developer"
      by_env = { sandbox = "LeadDeveloper", dev = "LeadDeveloper", test = "LeadDeveloper", prod = "ReadOnly" }
    }
    platform-engineer = {
      group  = "aws-platform-engineer"
      by_env = { sandbox = "PlatformEngineer", dev = "PlatformEngineer", test = "PlatformEngineer", prod = "ReadOnly", core = "ReadOnly" }
    }
    platform-engineer-jit = {
      # Membership is activated just in time via Entra PIM (approved, time-boxed, logged).
      group  = "aws-platform-engineer-prod-jit"
      by_env = { prod = "PlatformEngineer", core = "PlatformEngineer" }
    }
    security-audit = {
      group  = "aws-security-audit"
      by_env = { sandbox = "SecurityAudit", dev = "SecurityAudit", test = "SecurityAudit", prod = "SecurityAudit", core = "SecurityAudit" }
    }
  }

  # One entry per (account, role) pair the matrix allows. Suspended accounts get nothing.
  assignments = merge([
    for a in local.accounts : {
      for role, r in local.access_matrix : "${a.name}/${role}" => {
        account_id     = a.id
        account_name   = a.name
        group          = strcontains(r.group, "%s") ? format(r.group, a.team) : r.group
        permission_set = r.by_env[a.environment]
      } if contains(keys(r.by_env), a.environment) && a.ou != "Suspended"
    }
  ]...)

  groups = toset([for x in values(local.assignments) : x.group])
}

resource "aws_ssoadmin_permission_set" "this" {
  for_each = local.permission_sets

  name             = each.key
  description      = each.value.description
  instance_arn     = local.sso_instance_arn
  session_duration = each.value.session_duration
}

resource "aws_ssoadmin_managed_policy_attachment" "this" {
  for_each = merge([
    for ps, cfg in local.permission_sets : { for arn in cfg.managed_policies : "${ps}:${basename(arn)}" => { ps = ps, arn = arn } }
  ]...)

  instance_arn       = local.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this[each.value.ps].arn
  managed_policy_arn = each.value.arn
}

# Groups are created in Entra ID and pushed by SCIM; Terraform only looks them up.
data "aws_identitystore_group" "this" {
  for_each = local.groups

  identity_store_id = local.identity_store_id

  alternate_identifier {
    unique_attribute {
      attribute_path  = "DisplayName"
      attribute_value = each.key
    }
  }
}

resource "aws_ssoadmin_account_assignment" "this" {
  for_each = local.assignments

  instance_arn       = local.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.this[each.value.permission_set].arn
  principal_type     = "GROUP"
  principal_id       = data.aws_identitystore_group.this[each.value.group].group_id
  target_type        = "AWS_ACCOUNT"
  target_id          = each.value.account_id
}
