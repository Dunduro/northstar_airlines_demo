# Golden path: `static-site` (v2.0.0)

Frontends and documentation: a private S3 bucket behind CloudFront with Origin Access Control.
Fully owned by the platform team.

**Why a new major:** v1 used an origin access identity (OAI, legacy) and served whatever was in
the bucket root. v2 uses OAC and serves an immutable, versioned prefix — moving the origin is
not an in-place change, so it is a major. v1 stays supported (N-1) until its deprecation date.

## How a release reaches users (artifact promotion)

```
build-static.yml   npm run build → s3://northstar-artifacts/<name>/releases/<version>/   (once)
reusable-deploy    stage that prefix into this bucket → terraform apply bundle_version=<version>
                   → CloudFront origin_path = /releases/<version> → invalidate
```

Dev, Test and Prod serve byte-identical bundles; rollback is changing `bundle_version` back.

## What you get

| | |
|---|---|
| Bucket | Public access blocked (all four), ACLs disabled, SSE-S3, versioned, TLS-only, readable only by this distribution (`AWS:SourceArn`) |
| CDN | HTTPS redirect, HTTP/2+3, compression, managed `CachingOptimized` policy, SPA fallback (403/404 → `/index.html`, optional) |
| Headers | HSTS (2 years, preload), `X-Content-Type-Options`, `X-Frame-Options: DENY`, referrer policy, CSP (input), `Permissions-Policy` |
| Tags | Mandatory tags on every taggable resource |

Static sites hold `public` or `internal` content only; anything more sensitive belongs behind
an authenticated API (validation rejects `confidential`/`restricted`).

## Use

```hcl
module "site" {
  source  = "registry.northstar.internal/platform/static-site/aws"
  version = "~> 2.0"

  name           = "crew-portal"
  team           = "crew"
  owner          = "crew-lead@northstar.example"
  cost_centre    = "CC-1003"
  environment    = var.environment
  bundle_version = var.bundle_version
}

# reusable-deploy.yml reads these two root outputs to stage the bundle and invalidate the cache.
output "static_site_bucket" { value = module.site.bucket_name }
output "static_site_distribution_id" { value = module.site.distribution_id }
```

## Inputs

`name`, `team`, `environment`, `bundle_version` (semver), `single_page_app` (`true`),
`aliases` + `certificate_arn` (ACM, us-east-1), `content_security_policy`, `price_class`
(`PriceClass_200`), `data_classification` (`public`), `owner`, `cost_centre`, `tags`.

## Outputs

`module_version`, `bucket_name`, `distribution_id`, `release_prefix`, `url`.

Not in this version (stated honestly): CloudFront access logs and a WAF web ACL are left to
the account's edge baseline; CloudFront alarms (metrics live in `us-east-1`) are a follow-up.
