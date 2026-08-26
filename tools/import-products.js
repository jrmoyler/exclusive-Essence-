#!/usr/bin/env node
/*
 * Regenerate `const PRODUCTS` in index.html from a Shopify products CSV export.
 *
 *   node tools/import-products.js path/to/products_export.csv [--write]
 *
 * Without --write it prints a summary of what would change and leaves the file
 * alone. The export itself is never committed: it carries `Cost per item`,
 * which is internal margin data.
 *
 * Run it against a clean index.html: the catalog already in the file is the
 * baseline it diffs the export against, so a second --write over its own
 * output sees no new products and clears the New badges.
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
      entry.images.forEach(src => { if (!seen.images.includes(src)) seen.images.push(src); });
      entry.skus.forEach(s => { if (!seen.skus.includes(s)) seen.skus.push(s); });
      if (!seen.image) seen.image = seen.images[0] || '';
      if (!seen.description) seen.description = entry.description;
      if (seen.price <= 0 && entry.price > 0) seen.price = entry.price;
      continue;
    }
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

function main() {
  const csvPath = process.argv[2];
  const write = process.argv.includes('--write');
  if (!csvPath) {
    console.error('usage: node tools/import-products.js <products_export.csv> [--write]');
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

  const catalog = [...fresh, ...existing].map(p => ({
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
  }));

  const dropped = current.filter(p => !catalog.some(n => n.handle === p.handle));
  console.log(`catalog: ${current.length} -> ${catalog.length} products`);
  console.log(`  new:     ${fresh.length}`);
  console.log(`  dropped: ${dropped.length}${dropped.length ? ' (' + dropped.map(p => p.handle).join(', ') + ')' : ''}`);
  const cats = {};
  catalog.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
  Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${String(n).padStart(4)}  ${c}`));

  if (!write) { console.log('\n(dry run — pass --write to update index.html)'); return; }

  const line = PREFIX + JSON.stringify(catalog) + ';';
  fs.writeFileSync(INDEX, html.slice(0, from) + line + html.slice(end));
  console.log('\nindex.html updated');
}

main();
