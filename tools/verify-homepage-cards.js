#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cardCssPath = 'assets/homepage-cards-v3.css';
if (!html.includes(cardCssPath)) throw new Error(`Homepage does not load ${cardCssPath}.`);
const cardCss = fs.readFileSync(path.join(root, cardCssPath), 'utf8');
const catalogMatch = html.match(/const PRODUCTS = (\[.*?\]);\nconst BRAND_LOGOS/s);

if (!catalogMatch) throw new Error('Could not find the embedded product catalog.');

const products = new Map(JSON.parse(catalogMatch[1]).map((product) => [product.handle, product]));
const cardArt = new Map([
  ['mielle', { path: 'assets/homepage-card-art/featured-mielle.webp', width: 2400, height: 1500, handles: ['30772275856', '854102006374', '854102006367'] }],
  ['bellatique', { path: 'assets/homepage-card-art/featured-bellatique.webp', width: 2400, height: 1500, handles: ['850070547512', '850070547222', '850070547239'] }],
  ['shea', { path: 'assets/homepage-card-art/featured-sheamoisture.webp', width: 2400, height: 1500, handles: ['764302290209', '764302290629', '764302905035'] }],
  ['season', { path: 'assets/homepage-card-art/featured-4-season.webp', width: 2400, height: 1500, handles: ['4-season-aloe-facial-cleanser', '4-season-serum'] }],
  ['wash', { path: 'assets/homepage-card-art/edit-wash-day.webp', width: 1600, height: 2000, handles: ['856633008865', '856633008872', '856633008605'] }],
  ['style', { path: 'assets/homepage-card-art/edit-styling.webp', width: 1600, height: 2000, handles: ['850040015102', '860001677508', '860289001293'] }],
  ['color', { path: 'assets/homepage-card-art/edit-color.webp', width: 1600, height: 2000, handles: ['adore-semi-permanent-hair-color-90-lavender-4-oz', 'adore-semi-permanent-hair-color-88-magenta-4-oz', 'adore-semi-permanent-hair-color-117-aquamarine-4-oz'] }],
]);
const verifiedCatalogSources = new Map([
  ['30772275856', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/mielle_leavein.png?v=1787235149'],
  ['854102006374', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/mielle_smoothie.png?v=1787235149'],
  ['854102006367', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/mielle_custard.png?v=1787235149'],
  ['850070547512', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/bellatique-braid-mousse-8oz.png?v=1787218811'],
  ['850070547222', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/bellatique-grip-glide-10oz.png?v=1787218811'],
  ['850070547239', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/bellatique-grip-glide-15oz.png?v=1787218811'],
  ['764302290209', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/sheamoisture-curl-shine-shampoo.png?v=1787224859'],
  ['764302290629', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/sheamoisture-curl-shine-conditioner.png?v=1787224859'],
  ['764302905035', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/sheamoisture-kids-curling-butter-cream.png?v=1787224860'],
  ['4-season-aloe-facial-cleanser', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/4SeasonskinAloe.png?v=1787422680'],
  ['4-season-serum', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/4SeasonskinSerum.png?v=1787423471'],
  ['856633008865', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/kal_shampoo.png?v=1787235148'],
  ['856633008872', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/kal_conditioner.png?v=1787235148'],
  ['856633008605', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/kal_extra.png?v=1787235148'],
  ['850040015102', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/sib_edge1.png?v=1787235172'],
  ['860001677508', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/sib_glazee.png?v=1787235173'],
  ['860289001293', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/sib_waxstick.png?v=1787235172'],
  ['adore-semi-permanent-hair-color-90-lavender-4-oz', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/adore-90-lavender.jpg?v=1787310275'],
  ['adore-semi-permanent-hair-color-88-magenta-4-oz', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/adore-88-magenta.jpg?v=1787310275'],
  ['adore-semi-permanent-hair-color-117-aquamarine-4-oz', 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/adore-117-aquamarine.jpg?v=1787309396'],
]);
const cardPattern = /<button class="(?:collection-card|flyer-card)"[^>]*aria-label="([^"]+)"[^>]*data-filter-jump="([^"]+)"[^>]*data-product-handles="([^"]+)"[^>]*data-card-style="([^"]+)"[^>]*>(.*?)<\/button>/gs;
const cards = [...html.matchAll(cardPattern)];
const seenHandles = new Set();

if (cards.length !== 7) throw new Error(`Expected 7 verified homepage cards; found ${cards.length}.`);
if (!cardCss.includes('.homepage-card-art')) throw new Error('Missing flattened card-art styling.');
if (html.includes('src="assets/card-products/') || html.includes('<span class="collection-products') || html.includes('<span class="flyer-products')) {
  throw new Error('Homepage still references the superseded layered product-cutout system.');
}

for (const [, label, encodedFilter, handlesValue, cardStyle, content] of cards) {
  const filter = encodedFilter.replaceAll('&amp;', '&');
  const handles = handlesValue.split(',');
  const expected = cardArt.get(cardStyle);
  if (!expected) throw new Error(`${label}: unknown card style ${cardStyle}.`);
  if (handles.join(',') !== expected.handles.join(',')) throw new Error(`${label}: product handles do not match the verified ${cardStyle} composition.`);
  const imageMatch = content.match(/<img class="homepage-card-art" src="([^"]+)" alt="" width="(\d+)" height="(\d+)"/);
  if (!imageMatch) throw new Error(`${label}: missing flattened local card artwork.`);
  const [, imagePath, width, height] = imageMatch;
  if (imagePath !== expected.path || Number(width) !== expected.width || Number(height) !== expected.height) {
    throw new Error(`${label}: expected ${expected.path} at ${expected.width}x${expected.height}.`);
  }
  const imageBuffer = fs.readFileSync(path.join(root, imagePath));
  if (imageBuffer.length < 75_000 || imageBuffer.subarray(0, 4).toString() !== 'RIFF' || imageBuffer.subarray(8, 12).toString() !== 'WEBP') {
    throw new Error(`${label}: ${imagePath} is not a valid high-resolution WebP card asset.`);
  }
  if (!label.trim()) throw new Error('A homepage card is missing its accessible label.');

  handles.forEach((handle) => {
    const product = products.get(handle);
    if (!product) throw new Error(`${label}: catalog handle ${handle} does not exist.`);
    if (seenHandles.has(handle)) throw new Error(`${label}: catalog handle ${handle} appears on more than one homepage card.`);
    seenHandles.add(handle);
    if (!product.available || product.inventory < 1) throw new Error(`${label}: ${product.title} is not currently available.`);
    if (product.category !== filter) throw new Error(`${label}: ${product.title} belongs to ${product.category}, not ${filter}.`);
    const verifiedSource = verifiedCatalogSources.get(handle);
    if (!verifiedSource || !(product.images || [product.image]).includes(verifiedSource)) {
      throw new Error(`${label}: ${product.title} no longer matches its verified Shopify catalog source.`);
    }
  });
}

if (seenHandles.size !== verifiedCatalogSources.size) {
  throw new Error(`Expected ${verifiedCatalogSources.size} unique verified product placements; found ${seenHandles.size}.`);
}

console.log(`Verified ${cards.length} flattened high-resolution homepage cards and ${seenHandles.size} exact catalog-product placements.`);
