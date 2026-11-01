# =======================================================================================
# The deploy role: how code reaches this account. No long-lived keys, no human principal.
#
# The role trusts GitHub OIDC tokens ONLY when they were issued to a job running the
# platform's reusable deploy workflow (the token's `job_workflow_ref` claim). A team can
# write whatever it likes in its own pipeline, but the step that holds these credentials is
# always the platform workflow, which runs the policy checks, approvals and audit logging.
# Editing your own YAML cannot get around it.
#
# Why the condition is on `sub` and not on a `job_workflow_ref` key: AWS STS only exposes a
# fixed set of claims as condition keys (`aud`, `sub`, ...). We therefore customise the
# GitHub organisation's OIDC subject template to include job_workflow_ref:
#
#   PUT /orgs/northstar/actions/oidc/customization/sub
#   {"include_claim_keys": ["repo", "context", "job_workflow_ref"]}
#
# which makes every token's subject look like:
#   repo:northstar/payments-api:environment:prod:job_workflow_ref:northstar/platform-workflows/.github/workflows/reusable-deploy.yml@refs/tags/v3.1.0
#
# The pattern below pins all three parts:
#   repo        -> only this team's repositories (northstar/<team>-*)
#   environment -> only the GitHub environment of this account (prod has required reviewers)
#   workflow    -> only the platform's reusable deploy workflow, at a released tag
#                  (sandbox/dev also accept platform-workflows@main, so the platform team can
#                  test a workflow change before releasing it)
# The Prod SCP denies anyone but the platform baseline role from changing this trust policy.
# =======================================================================================

locals {
  github_oidc_host = "token.actions.githubusercontent.com"
  # Built from the account id (not the resource) so the trust policy is known at plan time.
  github_oidc_provider_arn = "arn:aws:iam::${var.account_id}:oidc-provider/${local.github_oidc_host}"

  trusted_subjects = [
    for ref in local.profile.workflow_refs :
    "repo:${var.github_org}/${var.team}-*:environment:${var.environment}:job_workflow_ref:${var.platform_deploy_workflow}@${ref}"
  ]

  deploy_role_trust_policy = {
    Version = "2012-10-17"
    Statement = [{
      Sid       = "GitHubPlatformDeployWorkflowOnly"
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = local.github_oidc_provider_arn }
      Condition = {
        StringEquals = { "${local.github_oidc_host}:aud" = "sts.amazonaws.com" }
        StringLike   = { "${local.github_oidc_host}:sub" = local.trusted_subjects }
      }
    }]
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.github_oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates GitHub's certificate via its own trust store; thumbprints kept for older APIs.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
  tags            = local.tags
}

resource "aws_iam_role" "deploy" {
  name                 = "northstar-deploy"
  description          = "Assumed only by the platform reusable deploy workflow via GitHub OIDC."
  assume_role_policy   = jsonencode(local.deploy_role_trust_policy)
  max_session_duration = 3600
  tags                 = local.tags

  depends_on = [aws_iam_openid_connect_provider.github]
}

# What a deploy may do. Broad inside the account; the SCPs cap it at the organisation level
# and the policy checks in the workflow cap what reaches apply. Production would add a
# permissions boundary for any IAM role the workload creates.
resource "aws_iam_role_policy_attachment" "deploy_power_user" {
  role       = aws_iam_role.deploy.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy" "deploy_workload_roles" {
  name = "manage-workload-roles"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "WorkloadRolesUnderOwnPathOnly"
      Effect = "Allow"
      Action = [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:TagRole", "iam:UntagRole",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:PassRole",
      ]
      Resource = "arn:aws:iam::${var.account_id}:role/workload/*"
    }]
  })
}
