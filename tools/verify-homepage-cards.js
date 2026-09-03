#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const catalogMatch = html.match(/const PRODUCTS = (\[.*?\]);\nconst BRAND_LOGOS/s);

if (!catalogMatch) throw new Error('Could not find the embedded product catalog.');

const products = new Map(JSON.parse(catalogMatch[1]).map((product) => [product.handle, product]));
const verifiedProductAssets = new Map([
  ['30772275856', 'assets/card-products/mielle-pom-honey-leave-in-cutout.webp'],
  ['854102006374', 'assets/card-products/mielle-pom-honey-curl-smoothie-cutout.webp'],
  ['854102006367', 'assets/card-products/mielle-pom-honey-coil-custard-cutout.webp'],
  ['850070547512', 'assets/card-products/bellatique-braid-mousse-cutout.webp'],
  ['850070547222', 'assets/card-products/bellatique-grip-glide-10oz-cutout.webp'],
  ['850070547239', 'assets/card-products/bellatique-grip-glide-15oz-cutout.webp'],
  ['764302290209', 'assets/card-products/sheamoisture-curl-shine-shampoo-cutout.webp'],
  ['764302290629', 'assets/card-products/sheamoisture-curl-shine-conditioner-cutout.webp'],
  ['764302905035', 'assets/card-products/sheamoisture-kids-curling-butter-cream-cutout.webp'],
  ['4-season-aloe-facial-cleanser', 'assets/card-products/4-season-aloe-cleanser-cutout.webp'],
  ['4-season-serum', 'assets/card-products/4-season-serum-cutout.webp'],
  ['856633008865', 'assets/card-products/kaleidoscope-miracle-drop-shampoo-cutout.webp'],
  ['856633008872', 'assets/card-products/kaleidoscope-miracle-drop-conditioner-cutout.webp'],
  ['856633008605', 'assets/card-products/kaleidoscope-miracle-drop-extra-cutout.webp'],
  ['850040015102', 'assets/card-products/she-is-bomb-edge-control-cutout.webp'],
  ['860001677508', 'assets/card-products/she-is-bomb-glazee-cutout.webp'],
  ['860289001293', 'assets/card-products/she-is-bomb-hair-wax-stick-cutout.webp'],
  ['adore-semi-permanent-hair-color-90-lavender-4-oz', 'assets/card-products/adore-lavender-90-cutout.webp'],
  ['adore-semi-permanent-hair-color-88-magenta-4-oz', 'assets/card-products/adore-magenta-88-cutout.webp'],
  ['adore-semi-permanent-hair-color-117-aquamarine-4-oz', 'assets/card-products/adore-aquamarine-117-cutout.webp'],
]);
const cardPattern = /<button class="(?:collection-card|flyer-card)"[^>]*aria-label="([^"]+)"[^>]*data-filter-jump="([^"]+)"[^>]*data-product-handles="([^"]+)"[^>]*>(.*?)<\/button>/gs;
const cards = [...html.matchAll(cardPattern)];
const seenHandles = new Set();
const cinematicSceneAssets = [
  'assets/card-scenes/featured-collection-stage.webp',
  'assets/card-scenes/current-edit-stage.webp',
];

if (cards.length !== 7) throw new Error(`Expected 7 verified homepage cards; found ${cards.length}.`);

for (const sceneAsset of cinematicSceneAssets) {
  if (!fs.existsSync(path.join(root, sceneAsset))) throw new Error(`Missing cinematic card scene ${sceneAsset}.`);
  if (!html.includes(sceneAsset)) throw new Error(`Cinematic card scene ${sceneAsset} is not used by the homepage.`);
}

for (const [, label, encodedFilter, handlesValue, content] of cards) {
  const filter = encodedFilter.replaceAll('&amp;', '&');
  const handles = handlesValue.split(',');
  const imagePaths = [...content.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);

  if (!label.trim()) throw new Error('A homepage card is missing its accessible label.');
  if (imagePaths.length !== handles.length) {
    throw new Error(`${label}: ${handles.length} products but ${imagePaths.length} product images.`);
  }

  handles.forEach((handle, index) => {
    const product = products.get(handle);
    if (!product) throw new Error(`${label}: catalog handle ${handle} does not exist.`);
    if (seenHandles.has(handle)) throw new Error(`${label}: catalog handle ${handle} appears on more than one homepage card.`);
    seenHandles.add(handle);
    if (!product.available || product.inventory < 1) {
      throw new Error(`${label}: ${product.title} is not currently available.`);
    }
    if (product.category !== filter) {
      throw new Error(`${label}: ${product.title} belongs to ${product.category}, not ${filter}.`);
    }

    const imagePath = imagePaths[index];
    const verifiedAsset = verifiedProductAssets.get(handle);
    if (imagePath !== verifiedAsset) {
      throw new Error(`${label}: ${product.title} must use its verified asset ${verifiedAsset}, not ${imagePath}.`);
    }
    if (!imagePath.startsWith('assets/card-products/')) {
      throw new Error(`${label}: ${imagePath} is not a local verified card-product asset.`);
    }
    if (!fs.existsSync(path.join(root, imagePath))) {
      throw new Error(`${label}: missing product image ${imagePath}.`);
    }
    const imageBuffer = fs.readFileSync(path.join(root, imagePath));
    if (!imageBuffer.includes(Buffer.from('ALPH'))) {
      throw new Error(`${label}: ${imagePath} is missing a transparent alpha layer.`);
    }
  });
}

if (seenHandles.size !== verifiedProductAssets.size) {
  throw new Error(`Expected ${verifiedProductAssets.size} unique verified product placements; found ${seenHandles.size}.`);
}

console.log(`Verified ${cards.length} homepage cards and ${cards.reduce((total, card) => total + card[3].split(',').length, 0)} catalog-product placements.`);
