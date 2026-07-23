# Exclusive Essence — Storefront

Live: https://exclusiveessence.store · https://exclusive-essence-shop.vercel.app

Single-page storefront for Exclusive Essence Hair & Beauty Emporium
(Q's store, 2100 Cleveland Ave, Columbus, OH). Deployed on Vercel from this repo.

## Layout
- `index.html` — the whole site (all markup, CSS, JS in one file)
- `assets/` — 52 content-hashed images (jpg/png/webp)
- `api/leads.js` — Vercel Serverless Function: entry-gate + newsletter lead capture
- `build.sh` — stages static files into `public/`, injects env config into HTML
- `vercel.json` — build settings (buildCommand, outputDirectory, no install)

## Deploy
Connected to Vercel via Git — pushing to `main` triggers a production deploy.
No external asset fetch: everything ships in this repo, so a deploy can never
blank the site (the old tmpfiles-tarball failure mode is gone).

## Environment variables (Vercel → Settings → Environment Variables)
Storefront (baked into HTML at build time by build.sh):
- `SHOPIFY_STORE_DOMAIN` = cbrxt0-kk.myshopify.com
- `SHOPIFY_STOREFRONT_TOKEN` = <public Storefront API token>
- `EE_GA_ID` = <GA4 Measurement ID, optional>

Lead endpoint (read at runtime by api/leads.js, never written into the page):
- `SHOPIFY_ADMIN_TOKEN` = <Admin API access token, shpat_… — scope write_customers + Protected Customer Data approved>
- `KLAVIYO_API_KEY` = <private key pk_…, optional>
- `KLAVIYO_LIST_ID` = <list id, optional>

## Health checks
- `GET /api/leads` — config probe (booleans + token prefix, no secrets)
- `GET /api/leads?check=1` — also does one live Shopify Admin call; returns `auth: "ok"` when the token works
