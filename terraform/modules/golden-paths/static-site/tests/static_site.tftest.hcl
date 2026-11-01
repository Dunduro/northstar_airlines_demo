# Runs entirely offline: the AWS provider is mocked, nothing is created.
#   cd terraform/modules/golden-paths/static-site && terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "100000000303" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = {
      arn                         = "arn:aws:s3:::northstar-crew-portal-prod-100000000303"
      bucket_regional_domain_name = "northstar-crew-portal-prod-100000000303.s3.me-central-1.amazonaws.com"
    }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn         = "arn:aws:cloudfront::100000000303:distribution/E2EXAMPLE"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
}

variables {
  name           = "crew-portal"
  team           = "crew"
  owner          = "crew-lead@northstar.example"
  cost_centre    = "CC-1003"
  environment    = "prod"
  bundle_version = "2.0.1"
}

run "bucket_is_not_public" {
  command = apply

  assert {
    condition = alltrue([
      aws_s3_bucket_public_access_block.site.block_public_acls,
      aws_s3_bucket_public_access_block.site.block_public_policy,
      aws_s3_bucket_public_access_block.site.ignore_public_acls,
      aws_s3_bucket_public_access_block.site.restrict_public_buckets,
    ])
    error_message = "All four public access blocks must be on."
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.site.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs are disabled."
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_s3_bucket_policy.site.policy).Statement :
      s.Effect == "Deny" || s.Principal == { Service = "cloudfront.amazonaws.com" }
    ])
    error_message = "Only CloudFront is allowed to read the bucket."
  }

  assert {
    condition     = jsondecode(aws_s3_bucket_policy.site.policy).Statement[0].Condition.StringEquals["AWS:SourceArn"] == "arn:aws:cloudfront::100000000303:distribution/E2EXAMPLE"
    error_message = "...and only this distribution (OAC with SourceArn)."
  }
}

run "serves_the_pinned_release_over_https" {
  command = apply

  assert {
    condition     = one(aws_cloudfront_distribution.site.origin).origin_path == "/releases/2.0.1"
    error_message = "CloudFront serves exactly the versioned bundle prefix."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.default_cache_behavior).viewer_protocol_policy == "redirect-to-https"
    error_message = "HTTP redirects to HTTPS."
  }

  assert {
    condition     = output.release_prefix == "releases/2.0.1"
    error_message = "The served prefix is exposed for the deploy workflow."
  }
}

run "security_headers_are_attached" {
  command = apply

  assert {
    condition     = aws_cloudfront_response_headers_policy.security.security_headers_config[0].frame_options[0].frame_option == "DENY"
    error_message = "Frames are denied."
  }

  assert {
    condition     = aws_cloudfront_response_headers_policy.security.security_headers_config[0].strict_transport_security[0].access_control_max_age_sec >= 31536000
    error_message = "HSTS for at least a year."
  }

  assert {
    condition     = one(aws_cloudfront_distribution.site.default_cache_behavior).response_headers_policy_id == aws_cloudfront_response_headers_policy.security.id
    error_message = "The security headers policy is on the default behaviour."
  }
}

run "mandatory_tags_are_present" {
  command = apply

  assert {
    condition = alltrue([
      for r in [aws_s3_bucket.site.tags, aws_cloudfront_distribution.site.tags] :
      alltrue([for k in ["cost-centre", "owner", "environment", "team", "data-classification", "golden-path", "module-version"] : contains(keys(r), k)])
    ])
    error_message = "Mandatory tags must be on every taggable resource."
  }
}

run "invalid_inputs_are_rejected" {
  command = plan

  variables {
    bundle_version      = "latest"
    data_classification = "confidential"
  }

  expect_failures = [var.bundle_version, var.data_classification]
}

run "aliases_need_a_certificate" {
  command = plan

  variables {
    aliases = ["crew.northstar.example"]
  }

  expect_failures = [aws_cloudfront_distribution.site]
}
