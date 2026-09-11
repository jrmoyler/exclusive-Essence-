#!/usr/bin/env node
/*
 * Regenerate `const PRODUCTS` in index.html from a Shopify products CSV export.
 *
 *   node tools/import-products.js path/to/products_export.csv [--merge] [--write]
 *
 * Without --write it prints a summary of what would change and leaves the file
 * alone. The export itself is never committed: it carries `Cost per item`,
 * which is internal margin data.
 *
 * Run it against a clean index.html: the catalog already in the file is the
 * baseline it diffs the export against, so a second --write over its own
 * output sees no new products and clears the New badges.
 *
 * By default the export is the whole catalog, so a product the export omits is
 * a product that has left the store and it is dropped. Shopify also exports a
 * subset -- one collection, or the rows edited that day -- and feeding one of
 * those in by default would wipe every product it does not happen to list.
 * `--merge` is the mode for those: products the export lists are refreshed in
 * place, products it does not mention are left exactly as they are, and new
 * handles are added at the front as new arrivals.
 *
 * The catalog is a snapshot, so re-run this after any significant Shopify
 * change (see README "Catalog").
 *
 * What comes from the CSV: title, price, description, images, inventory,
 * variant/option label, SKUs, colour swatches.
 *
 * What does NOT come from the CSV, for two columns that are unreliable:
 *
 *   Category. Shopify's `Type` is free text entered at the register ("Hair
 *   care" covers both shampoo and edge control, and 33 products have no type
 *   at all), so placement has been curated by hand — see commit 566c34a, which
 *   moved 11 products Shopify had filed where no shopper would look. This
 *   script keeps the curated category for every handle already in index.html
 *   and only classifies handles it has never seen, via NEW_PRODUCT_CATEGORIES
 *   below. Add an entry there when a run reports an unclassified handle.
 *
 *   Brand. `Vendor` is the house name "Exclusive Essence" on 585 of the 694
 *   products, so taking it at face value would collapse the brand carousel and
 *   the brand filter down to a single label. The brand already recorded for a
 *   handle wins; only a new handle reads `Vendor`, and only when it names a
 *   real brand.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const PREFIX = 'const PRODUCTS = ';
const RATING = 4.8;
/* Products with no colour metafield fall back to the house palette so the
   swatch row on the card is never empty. */
const DEFAULT_SWATCHES = ['#111111', '#4A2A1A', '#8B5A3C'];

/* Storefront categories for handles that are not yet in index.html. Keyed by
   handle so a retyped `Type` in Shopify can never silently reshuffle the site.
   Every value must be one of DEPARTMENTS in index.html. */
const NEW_PRODUCT_CATEGORIES = {
  // Grooming tools and clipper accessories
  'joy-3-in-1-pin-tail-edge-brush-comb': 'Tools & Accessories',
  'wahl-vanish-cutter-foil-head': 'Tools & Accessories',
  'babylisspro-goldfx-clipper-charging-base': 'Tools & Accessories',
  'babylisspro-silverfx-clipper-charging-base': 'Tools & Accessories',
  // Skin, face and beard care
  '4-season-serum': 'Skin & Body',
  '4-season-aloe-facial-cleanser': 'Skin & Body',
  'drip-face-cleanser': 'Skin & Body',
  'drip-spot-treatment-facial': 'Skin & Body',
  'drip-beard-oil': 'Skin & Body',
  // Braiding hair — filed with the rest of the braid wall, human or not
  '100-human-milky-way-braiding-hair-4-18': 'Braids, Wigs & Crochet',
  '100-human-milky-way-braiding-hair-2-18': 'Braids, Wigs & Crochet',
  // Wigs — the department that names them is where a shopper looks
  'deep-wave-40-lace-front-wig-100-real-human-hair': 'Braids, Wigs & Crochet',
  'deep-wave-lace-front-34-wig-100-human-hair': 'Braids, Wigs & Crochet',
  'deep-wave-34-burgundy-lace-front-wig-100-human-hair': 'Braids, Wigs & Crochet',
  'body-wave-30-lace-front-wig-100-human-hair': 'Braids, Wigs & Crochet',
  'bob-wig-16-inch-lace-front-100-virgin-burmese-human-hair': 'Braids, Wigs & Crochet',
  'deep-wave-32-lace-front-wig-100-human-hair': 'Braids, Wigs & Crochet',
  'deep-wave-30-lace-front-wig-100-human-hair': 'Braids, Wigs & Crochet',
  'wigs-seynthic': 'Braids, Wigs & Crochet',
  // Fashion accessories
  'scarff': 'Tools & Accessories',
  'watches-assorted': 'Beauty & Fashion',
  // In-store raffle entry: unpublished in Shopify, no image, no department it
  // belongs to. Files with the other odds and ends.
  'raffle-for-prodcts': 'Tools & Accessories',
  // Wigs from the 2026-09-10 export. Shopify files the Amore Mio under type
  // "Wig Cap"; it is a lace front wig and belongs on the wig wall.
  'amore-mio-lace-front-wig': 'Braids, Wigs & Crochet',
  'motown-lace-front-wig': 'Braids, Wigs & Crochet',
  '100-human-hair-wig-blond-26': 'Braids, Wigs & Crochet',
  '100-360-human-hair-wig-black-26': 'Braids, Wigs & Crochet',
  // Weave sold by the bundle, not a finished wig
  'lord-cliff-glue-tip-100-remy-human-hair-extension-weave': 'Human Hair',
  // 4 Season, split between the two shelves the line sits on
  '4-season-hair-treatment-oil': 'Hair Care',
  '4-season-body-scrub': 'Skin & Body',
  // Press-on nails
  'beautiful-nail-press-on-set-pink-leopard-print-with-rhinestone-stars-pearl-hearts': 'Beauty & Fashion',
};

/* ---------- CSV ---------- */

function parseCSV(s) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------- field helpers ---------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      const hit = ENTITIES[e.toLowerCase()];
      return hit === undefined ? m : hit;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/* Shopify exports barcodes and some SKUs with a leading apostrophe so a
   spreadsheet keeps them as text. It is not part of the value. */
const unquote = v => String(v || '').replace(/^'+/, '').trim();

/* The vendor every in-house and unbranded product is filed under. */
const HOUSE_VENDOR = 'exclusive essence';

/* Vendors are typed in caps at the register; the catalog stores brands the way
   a shopper reads them. */
const titleCase = v => (v === v.toUpperCase()
  ? v.replace(/[A-Z][A-Z'0-9]*/g, w => w[0] + w.slice(1).toLowerCase())
  : v);

/* Titles are typed at the register and routinely carry doubled spaces; they
   are a rendering artefact, not part of the product name. */
const tidy = v => String(v || '').replace(/\s+/g, ' ').trim();

/* Title match, not handle match, is what identifies a duplicate: the store has
   the same product entered twice under different handles (a slug and a
   barcode, or a `-1` suffix), sometimes with different capitalisation or a
   stray space. Ignoring case and whitespace catches all of them. */
const titleKey = t => String(t || '').toLowerCase().replace(/\s+/g, '');

/* ---------- build ---------- */

function build(csvPath) {
  const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  const header = rows.shift();
  const col = {};
  header.forEach((h, i) => { col[h] = i; });
  for (const required of ['Handle', 'Title', 'Vendor', 'Variant Price']) {
    if (col[required] === undefined) throw new Error(`CSV is missing the "${required}" column`);
  }
  const get = (row, name) => (col[name] === undefined ? '' : (row[col[name]] || '').trim());

  // Rows are one per variant AND one per extra image, so group by handle first.
  const byHandle = new Map();
  for (const row of rows) {
    if (row.length < 2) continue;
    const handle = get(row, 'Handle');
    if (!handle) continue;
    if (!byHandle.has(handle)) byHandle.set(handle, []);
    byHandle.get(handle).push(row);
  }

  const products = [];
  const byTitle = new Map();

  for (const [handle, group] of byHandle) {
    const head = group.find(r => get(r, 'Title')) || group[0];
    const title = tidy(get(head, 'Title'));
    if (!title) continue;

    const images = [];
    group
      .filter(r => get(r, 'Image Src'))
      .sort((a, b) => (Number(get(a, 'Image Position')) || 99) - (Number(get(b, 'Image Position')) || 99))
      .forEach(r => { const src = get(r, 'Image Src'); if (!images.includes(src)) images.push(src); });

    const prices = group.map(r => Number(get(r, 'Variant Price'))).filter(n => Number.isFinite(n) && n > 0);
    const inventory = group.reduce((sum, r) => {
      const qty = Number(get(r, 'Variant Inventory Qty'));
      return sum + (Number.isFinite(qty) ? qty : 0);
    }, 0);

    const variants = [];
    group.forEach(r => {
      const v = get(r, 'Option1 Value');
      if (!v) return;
      const label = v === 'Default Title' ? 'Default' : v;
      if (!variants.includes(label)) variants.push(label);
    });

    const skus = [];
    group.forEach(r => { const s = unquote(get(r, 'Variant SKU')); if (s && !skus.includes(s)) skus.push(s); });

    const colors = get(head, 'Color (product.metafields.shopify.color-pattern)')
      .split(';').map(s => s.trim()).filter(Boolean);

    const entry = {
      handle,
      title,
      vendor: tidy(get(head, 'Vendor')),
      published: get(head, 'Published').toLowerCase() === 'true',
      price: prices.length ? Math.min(...prices) : 0,
      image: images[0] || '',
      images,
      variants: variants.length ? variants : ['Default'],
      swatches: colors.length ? colors : DEFAULT_SWATCHES.slice(),
      // Whether the colour metafield was filled in at all, which the fallback
      // palette hides. --merge needs it to tell "no colour" from "no answer".
      hasColors: colors.length > 0,
      description: plainText(get(head, 'Body (HTML)')),
      skus,
      inventory: Math.max(0, inventory),
      sourceHandles: [handle],
    };

    // Same product entered twice: keep the first handle as the one Shopify
    // checkout resolves against, and add the duplicate's stock to it.
    const key = titleKey(title);
    const seen = byTitle.get(key);
    if (seen) {
      seen.sourceHandles.push(handle);
      seen.inventory += entry.inventory;
      // The losing handle's own title, price and size are kept alongside the
      // merged entry: --merge needs them to re-align the entry onto whichever
      // of the two handles the catalog already settled on.
      seen.duplicates.push(entry);
      entry.images.forEach(src => { if (!seen.images.includes(src)) seen.images.push(src); });
      entry.skus.forEach(s => { if (!seen.skus.includes(s)) seen.skus.push(s); });
      if (!seen.image) seen.image = seen.images[0] || '';
      if (!seen.description) seen.description = entry.description;
      if (seen.price <= 0 && entry.price > 0) seen.price = entry.price;
      continue;
    }
    entry.duplicates = [];
    byTitle.set(key, entry);
    products.push(entry);
  }

  return products;
}

/* ---------- merge with the live catalog ---------- */

function readCatalog(html) {
  const start = html.indexOf('\n' + PREFIX);
  if (start === -1) throw new Error('index.html has no `const PRODUCTS = ` line');
  const from = start + 1;
  const end = html.indexOf('\n', from);
  const line = html.slice(from, end);
  return { from, end, current: JSON.parse(line.slice(PREFIX.length).replace(/;\s*$/, '')) };
}

/* ---------- partial export ---------- */

/* A field the export leaves blank is a field Shopify has nothing to say about,
   not an instruction to clear what the catalog already holds: an unpublished
   product exports no image, and a product with no colour metafield falls back
   to the house palette. On a full export that distinction does not matter --
   every product is rebuilt from scratch -- but on a partial one it is the
   difference between a refresh and quiet data loss. */
const blank = v => v === '' || v === 0 || (Array.isArray(v) && v.length === 0);

/* The same product entered twice in Shopify becomes one storefront entry under
   one of its two handles, and which one wins is just export row order. Checkout
   resolves price and size against that handle, and a homepage card may name it,
   so a refresh must not let row order swap it: this re-points a merged entry at
   the handle the catalog already chose, and brings that handle's own title,
   price, size, description and lead image along with it. Stock, SKUs and the
   rest of the photos stay pooled across both. */
function alignTo(product, handle) {
  if (product.handle === handle) return product;
  const alt = (product.duplicates || []).find(d => d.handle === handle);
  if (!alt) return product;
  const images = [...new Set([...alt.images, ...product.images])];
  return {
    ...product,
    handle: alt.handle,
    title: alt.title,
    price: alt.price,
    variants: alt.variants,
    description: alt.description,
    swatches: alt.swatches,
    hasColors: alt.hasColors,
    image: images[0] || '',
    images,
  };
}

/* Refresh the products the export lists, leave the rest of the catalog alone.
   Returns a new array; `current` is not mutated. `renamed` collects the entries
   whose primary handle moved -- a rename, not a drop, which the reporting below
   would otherwise read as a product leaving the store. */
function mergeInto(current, imported, shape, renamed) {
  const catalog = current.map(p => ({ ...p }));
  const entryAt = new Map();
  current.forEach((p, i) => {
    new Set([p.handle, ...(p.sourceHandles || [])]).forEach(h => entryAt.set(h, i));
  });

  const added = [];
  imported.forEach(product => {
    const at = product.sourceHandles.map(h => entryAt.get(h)).find(i => i !== undefined);
    if (at === undefined) { added.push({ next: shape(product), published: product.published }); return; }
    const held = catalog[at];
    const p = alignTo(product, held.handle);
    const next = shape(p);

    // A person placed this product on a shelf, named its brand and decided
    // whether it still reads as new, so those survive the refresh, as does the
    // position it holds on the page and the handle the storefront links to.
    next.badge = held.badge;
    next.sourceHandles = [...new Set([...(held.sourceHandles || [held.handle]), ...p.sourceHandles])];
    ['image', 'images', 'description', 'skus', 'price'].forEach(k => {
      if (blank(next[k]) && !blank(held[k])) next[k] = held[k];
    });
    if (!p.hasColors) next.swatches = held.swatches;
    next.available = next.inventory > 0;
    if (next.handle !== held.handle) renamed.push(`${held.handle} -> ${next.handle}`);
    catalog[at] = next;
  });

  // New arrivals lead the storefront, the same way they do on a full import,
  // with the ones that cannot be bought yet behind the ones that can.
  added.sort((a, b) => Number(b.published) - Number(a.published));
  return [...added.map(a => a.next), ...catalog];
}

function main() {
  const csvPath = process.argv[2];
  const write = process.argv.includes('--write');
  const merge = process.argv.includes('--merge');
  if (!csvPath) {
    console.error('usage: node tools/import-products.js <products_export.csv> [--merge] [--write]');
    process.exit(2);
  }

  const html = fs.readFileSync(INDEX, 'utf8');
  const { from, end, current } = readCatalog(html);

  // Curated category per handle, including the duplicate handles that were
  // merged away, so a re-export that promotes a duplicate keeps its shelf.
  const categoryOf = new Map();
  const brandOf = new Map();
  const order = new Map();
  current.forEach((p, i) => {
    const handles = new Set([p.handle, ...(p.sourceHandles || [])]);
    handles.forEach(h => {
      categoryOf.set(h, p.category);
      brandOf.set(h, p.brand);
      if (!order.has(h)) order.set(h, i);
    });
  });

  const imported = build(csvPath);
  const unclassified = [];

  imported.forEach(p => {
    p.isNew = !p.sourceHandles.some(h => categoryOf.has(h));

    p.category = p.sourceHandles.map(h => categoryOf.get(h)).find(Boolean)
      || NEW_PRODUCT_CATEGORIES[p.handle];
    if (!p.category) { unclassified.push(p.handle); p.category = 'Tools & Accessories'; }

    // A house-vendor product carries no brand of its own, so it stays under
    // the store's own name rather than borrowing the first word of its title.
    p.brand = p.sourceHandles.map(h => brandOf.get(h)).find(Boolean)
      || (p.vendor && p.vendor.toLowerCase() !== HOUSE_VENDOR ? titleCase(p.vendor) : 'Exclusive Essence');
  });

  if (unclassified.length) {
    console.error('FATAL: no category for new handle(s); add them to NEW_PRODUCT_CATEGORIES:');
    unclassified.forEach(h => console.error('  ' + h));
    process.exit(1);
  }

  // New arrivals lead the storefront and carry the New badge; everything else
  // holds the position it already had, so the homepage shelves stay put.
  const rank = p => {
    const seen = p.sourceHandles.map(h => order.get(h)).filter(i => i !== undefined);
    return seen.length ? Math.min(...seen) : -1;
  };
  // Unpublished products cannot be bought through the Storefront API, so they
  // sit behind the ones that can rather than leading the storefront.
  const fresh = imported.filter(p => p.isNew)
    .sort((a, b) => Number(b.published) - Number(a.published));
  const existing = imported.filter(p => !p.isNew).sort((a, b) => rank(a) - rank(b));

  const shape = p => ({
    id: 'catalog-' + p.handle,
    handle: p.handle,
    title: p.title,
    brand: p.brand,
    category: p.category,
    price: p.price,
    rating: RATING,
    // Unpublished products cannot be bought, so they are never advertised as
    // new even when the export has just added them.
    badge: p.isNew && p.published ? 'New' : '',
    image: p.image,
    images: p.images,
    variants: p.variants,
    swatches: p.swatches,
    description: p.description,
    skus: p.skus,
    inventory: p.inventory,
    sourceHandles: p.sourceHandles,
    available: p.inventory > 0,
  });

  const renamed = [];
  const catalog = merge
    ? mergeInto(current, imported, shape, renamed)
    : [...fresh, ...existing].map(shape);

  // A product the export still carries under one of its other handles has not
  // left the store, so it is measured against every handle an entry answers to.
  const live = new Set();
  catalog.forEach(p => [p.handle, ...(p.sourceHandles || [])].forEach(h => live.add(h)));
  const dropped = current.filter(p => ![p.handle, ...(p.sourceHandles || [])].some(h => live.has(h)));
  console.log(`catalog: ${current.length} -> ${catalog.length} products${merge ? '  (merge)' : ''}`);
  console.log(`  new:     ${fresh.length}`);
  console.log(`  dropped: ${dropped.length}${dropped.length ? ' (' + dropped.map(p => p.handle).join(', ') + ')' : ''}`);
  if (renamed.length) console.log(`  renamed: ${renamed.length} (${renamed.join(', ')})`);
  const cats = {};
  catalog.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${String(n).padStart(4)}  ${c}`));

  if (!write) { console.log('\n(dry run — pass --write to update index.html)'); return; }

  const line = PREFIX + JSON.stringify(catalog) + ';';
  fs.writeFileSync(INDEX, html.slice(0, from) + line + html.slice(end));
  console.log('\nindex.html updated');
}

main();
