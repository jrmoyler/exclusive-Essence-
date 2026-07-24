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
Everything the site needs ships in this repo — `index.html` and `assets/` are
committed, `api/` builds as a function. `build.sh` only bakes env config into
the HTML; there is nothing to download.

> **Action required — the Vercel project is not Git-connected.**
> As of the 2026-07-24 audit, production deployments carried no commit SHA and
> the previous working build pulled the site from a temporary pastebin
> (`litter.catbox.moe`) rather than from this repo. That link expiring is what
> blanked the site. **Until the Vercel project is linked to this repository
> (Settings → Git) and any dashboard overrides for Build Command / Output
> Directory / Install Command are cleared so `vercel.json` wins, pushing to
> `main` deploys nothing.**
>
> A good build logs `EE_SHOPIFY_DOMAIN <- set`, `EE_SHOPIFY_TOKEN <- set`, and
> `index.html … bytes, 52 assets`. If those lines are absent, `build.sh` did not
> run.

`build.sh` now fails the build rather than shipping placeholder config: missing
`SHOPIFY_STORE_DOMAIN` or `SHOPIFY_STOREFRONT_TOKEN` is a hard error, and each
injection is verified after it is applied.

## Environment variables (Vercel → Settings → Environment Variables)
Storefront (baked into HTML at build time by build.sh):
- `SHOPIFY_STORE_DOMAIN` = cbrxt0-kk.myshopify.com
- `SHOPIFY_STOREFRONT_TOKEN` = <public Storefront API token>
- `SHOPIFY_API_VERSION` = <optional override; page defaults to 2026-01>
- `EE_GA_ID` = <GA4 Measurement ID, optional — unset means analytics stays off>

Lead endpoint (read at runtime by api/leads.js, never written into the page):
- `SHOPIFY_ADMIN_TOKEN` = <Admin API access token, shpat_… — scope write_customers + Protected Customer Data approved>
- `KLAVIYO_API_KEY` = <private key pk_…, optional>
- `KLAVIYO_LIST_ID` = <list id, optional>

## Catalog
`const PRODUCTS` in `index.html` is a snapshot of the Shopify catalog, covering
all 675 live product handles across the 8 site categories. It is generated, not
hand-edited. Because it is a snapshot, price, stock and new products drift the
moment Shopify changes — re-generate it after any significant catalog change.

## Health checks
- `GET /api/leads` — config probe (booleans + token prefix, no secrets)
- `GET /api/leads?check=1` — one live Shopify Admin call; returns `auth: "ok"`
  when the token authenticates. Note this only runs `{ shop { name } }`, which
  needs no special scope — it does **not** prove `write_customers` or Protected
  Customer Data approval, so it cannot confirm that lead capture will succeed.
