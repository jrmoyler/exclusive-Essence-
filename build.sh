#!/usr/bin/env bash
# Exclusive Essence — Vercel build (git-native, no external fetch)
#
# The entire site lives in this repo: index.html + assets/ are committed here,
# api/ builds as a Serverless Function. There is NOTHING to download, so a
# redeploy can never blank the site. Worst case is a failed build that leaves
# the previous deployment serving.
#
# This script's ONLY job: bake env-var config into the static HTML at build
# time (a static page can't read env vars at runtime), then stage static files
# into public/. api/ stays at the repo root for Vercel to compile as a function
# — copying it into public/ would publish the handler source as a plain file.
set -euo pipefail

OUT="public"
rm -rf "$OUT"
mkdir -p "$OUT"
cp index.html "$OUT/index.html"
cp -r assets "$OUT/assets"

echo "==> Injecting Shopify Storefront config"
if [ -n "${SHOPIFY_STORE_DOMAIN:-}" ]; then
  sed -i "s|const EE_SHOPIFY_DOMAIN='[^']*'|const EE_SHOPIFY_DOMAIN='${SHOPIFY_STORE_DOMAIN}'|" "$OUT/index.html"
  echo "    domain <- SHOPIFY_STORE_DOMAIN"
fi
if [ -n "${SHOPIFY_STOREFRONT_TOKEN:-}" ]; then
  sed -i "s|const EE_SHOPIFY_TOKEN='[^']*'|const EE_SHOPIFY_TOKEN='${SHOPIFY_STOREFRONT_TOKEN}'|" "$OUT/index.html"
  echo "    storefront token <- SHOPIFY_STOREFRONT_TOKEN"
fi
if [ -n "${EE_GA_ID:-}" ]; then
  sed -i "s|const EE_GA_ID='[^']*'|const EE_GA_ID='${EE_GA_ID}'|" "$OUT/index.html"
  echo "    GA4 id <- EE_GA_ID"
fi

echo "==> Sanity checks"
SIZE=$(wc -c < "$OUT/index.html")
[ "$SIZE" -gt 500000 ] || { echo "FATAL: index.html only ${SIZE} bytes." >&2; exit 1; }
[ -d "$OUT/assets" ]   || { echo "FATAL: assets/ missing." >&2; exit 1; }
[ ! -e "$OUT/api" ]    || { echo "FATAL: api/ leaked into static output." >&2; exit 1; }
echo "    index.html ${SIZE} bytes, $(ls "$OUT/assets" | wc -l) assets"

echo "==> Lead endpoint config (names only, no values)"
for V in SHOPIFY_ADMIN_TOKEN KLAVIYO_API_KEY KLAVIYO_LIST_ID; do
  [ -n "${!V:-}" ] && echo "    ${V}: present" || true
done
echo "==> Build complete"
