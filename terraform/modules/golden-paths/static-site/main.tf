# Golden path: static-site (private S3 bucket + CloudFront with Origin Access Control).
#
# v2 replaces the v1 origin access identity (OAI) with OAC and serves an immutable, versioned
# bundle prefix: build once (build-static.yml uploads releases/<version>/ to the artifact
# store), deploy many (reusable-deploy.yml stages that prefix into this bucket and switches
# CloudFront's origin path). Rollback is a one-line change of bundle_version.

locals {
  module_version = "2.0.0"

  full_name   = "${var.name}-${var.environment}"
  bucket_name = "northstar-${local.full_name}-${data.aws_caller_identity.current.account_id}"
  origin_id   = "site-bucket"

  # AWS managed policies (stable, documented IDs).
  cache_policy_caching_optimized = "658327ea-f89d-4fab-a63d-7e88639e58f6"

  mandatory_tags = merge(
    {
      team                = var.team
      environment         = var.environment
      data-classification = var.data_classification
    },
    var.owner == null ? {} : { owner = var.owner },
    var.cost_centre == null ? {} : { cost-centre = var.cost_centre },
  )
  tags = merge(var.tags, local.mandatory_tags, {
    service        = var.name
    golden-path    = "static-site"
    module-version = local.module_version
    managed-by     = "terraform"
  })
}

check "mandatory_tags_complete" {
  assert {
    condition     = var.owner != null && var.cost_centre != null
    error_message = "owner and cost_centre are not set: the tag policy check in reusable-deploy will reject this plan. Set them from platform.yaml."
  }
}

data "aws_caller_identity" "current" {}

# --- Bucket: private, owner-enforced, encrypted, versioned ----------------------------------

resource "aws_s3_bucket" "site" {
  bucket = local.bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # SSE-S3: CloudFront OAC reads it without a KMS key grant
    }
  }
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Old releases stay for rollback; overwritten object versions expire.
resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# Only this distribution may read, and only over TLS.
resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontOriginAccessControlOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.site.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.site]
}

# --- CloudFront ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = local.full_name
  description                       = "${var.name} (${var.environment}) bucket access"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${local.full_name}-security-headers"
  comment = "Platform default security headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    xss_protection {
      protection = true
      mode_block = true
      override   = true
    }
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.name} ${var.environment} ${var.bundle_version}"
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = var.aliases
  http_version        = "http2and3"

  origin {
    origin_id                = local.origin_id
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
    origin_path              = "/releases/${var.bundle_version}"
  }

  default_cache_behavior {
    target_origin_id           = local.origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # With OAC and no ListBucket, a missing key answers 403: send it to the app's router.
  dynamic "custom_error_response" {
    for_each = var.single_page_app ? [403, 404] : []
    content {
      error_code            = custom_error_response.value
      response_code         = 200
      response_page_path    = "/index.html"
      error_caching_min_ttl = 10
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.certificate_arn == null
    acm_certificate_arn            = var.certificate_arn
    ssl_support_method             = var.certificate_arn == null ? null : "sni-only"
    minimum_protocol_version       = var.certificate_arn == null ? "TLSv1" : "TLSv1.2_2021"
  }

  tags = local.tags

  lifecycle {
    precondition {
      condition     = length(var.aliases) == 0 || var.certificate_arn != null
      error_message = "aliases need a certificate_arn (ACM, us-east-1)."
    }
  }
}
