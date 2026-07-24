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
for F in robots.txt sitemap.xml; do
  if [ -f "$F" ]; then cp "$F" "$OUT/$F"; fi
done

echo "==> Injecting Shopify Storefront config"

# Injection must fail the build rather than silently ship a placeholder. The
# previous version skipped missing vars, so an unset token produced a green
# build serving a storefront that could not talk to Shopify. It also fed the
# raw value to sed, where a literal '&' expands to the whole match and corrupts
# the inline script.
inject() { # $1 = JS const name, $2 = value
  local name="$1" value="$2" esc
  esc=${value//\\/\\\\}; esc=${esc//&/\\&}; esc=${esc//|/\\|}
  grep -q "const ${name}='[^']*'" "$OUT/index.html" \
    || { echo "FATAL: no injection site for ${name} in index.html" >&2; exit 1; }
  sed -i "s|const ${name}='[^']*'|const ${name}='${esc}'|" "$OUT/index.html"
  grep -qF "const ${name}='${value}'" "$OUT/index.html" \
    || { echo "FATAL: ${name} injection did not take" >&2; exit 1; }
  echo "    ${name} <- set"
}

: "${SHOPIFY_STORE_DOMAIN:?FATAL: SHOPIFY_STORE_DOMAIN is not set}"
: "${SHOPIFY_STOREFRONT_TOKEN:?FATAL: SHOPIFY_STOREFRONT_TOKEN is not set}"
inject EE_SHOPIFY_DOMAIN "$SHOPIFY_STORE_DOMAIN"
inject EE_SHOPIFY_TOKEN  "$SHOPIFY_STOREFRONT_TOKEN"
[ -n "${SHOPIFY_API_VERSION:-}" ] && inject EE_SHOPIFY_API_VERSION "$SHOPIFY_API_VERSION"
if [ -n "${EE_GA_ID:-}" ]; then
  inject EE_GA_ID "$EE_GA_ID"
else
  echo "    WARNING: EE_GA_ID unset — analytics will stay disabled" >&2
fi

echo "==> Sanity checks"
SIZE=$(wc -c < "$OUT/index.html")
[ "$SIZE" -gt 500000 ] || { echo "FATAL: index.html only ${SIZE} bytes." >&2; exit 1; }
[ -d "$OUT/assets" ]   || { echo "FATAL: assets/ missing." >&2; exit 1; }
[ ! -e "$OUT/api" ]    || { echo "FATAL: api/ leaked into static output." >&2; exit 1; }
if ! grep -q "const PRODUCTS = \[{" "$OUT/index.html"; then
  echo "FATAL: product catalog missing from index.html." >&2; exit 1
fi
# Only an EE_GA_ID that was supplied but failed to land is an error; leaving
# analytics unconfigured is a supported state.
if [ -n "${EE_GA_ID:-}" ] && grep -q "G-XXXXXXXXXX" "$OUT/index.html"; then
  echo "FATAL: EE_GA_ID was set but the placeholder survived." >&2; exit 1
fi
echo "    index.html ${SIZE} bytes, $(ls "$OUT/assets" | wc -l) assets"

echo "==> Lead endpoint config (names only, no values)"
for V in SHOPIFY_ADMIN_TOKEN KLAVIYO_API_KEY KLAVIYO_LIST_ID; do
  [ -n "${!V:-}" ] && echo "    ${V}: present" || true
done
echo "==> Build complete"
