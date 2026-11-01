output "module_version" {
  description = "Golden path version; reported to the dashboard for version tracking."
  value       = local.module_version
}

output "bucket_name" {
  description = "Site bucket. reusable-deploy.yml stages releases/<version>/ here (expose it as the root output static_site_bucket)."
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution id (for invalidations)."
  value       = aws_cloudfront_distribution.site.id
}

output "release_prefix" {
  description = "Bucket prefix currently served."
  value       = "releases/${var.bundle_version}"
}

output "url" {
  description = "Site URL."
  value       = length(var.aliases) > 0 ? "https://${var.aliases[0]}" : "https://${aws_cloudfront_distribution.site.domain_name}"
}
