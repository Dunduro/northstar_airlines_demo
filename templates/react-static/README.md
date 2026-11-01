# Template: `react-static` — Vite + React on `static-site`

A frontend or documentation site: a private S3 bucket behind CloudFront (OAC), served from an
immutable, versioned bundle.

## What you get

| | |
|---|---|
| App | Vite + React 19 hello page; shows the release it was built as (`VITE_APP_VERSION`); `/health.json` for synthetic checks |
| Artifact | `build-static.yml`: `npm run build` → SBOM + scan → `s3://northstar-artifacts/<repo>/releases/<version>/` once; hashed assets cached for a year, `index.html` revalidated |
| Promotion | `reusable-deploy.yml` copies that prefix into the environment's bucket, then switches CloudFront's origin path to it (`static-site` `bundle_version`); rollback = deploy the previous version |
| Edge | HTTPS only, HSTS, CSP, `X-Frame-Options: DENY`, SPA fallback to `index.html` |
| Infra | `infra/main.tf` → `static-site ~> 2.0`; exposes `static_site_bucket` and `static_site_distribution_id` for the deploy workflow |
| Pipelines | `ci.yml` → `build-static.yml@v3`; `deploy.yml` → `reusable-deploy.yml@v3` |

## What you own

`src/`, `public/`, dependencies, the CSP (module input) once the app calls APIs.

## Run locally

```bash
npm install
npm run dev                      # http://localhost:5173
npm run build && npm run preview # the production bundle on http://localhost:8080
```

No Docker image and no correlation-id logging here: there is no server. The frontend should
send an `x-correlation-id` header on its API calls so backend logs can be joined to a page view.
