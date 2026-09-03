#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const catalogMatch = html.match(/const PRODUCTS = (\[.*?\]);\nconst BRAND_LOGOS/s);

if (!catalogMatch) throw new Error('Could not find the embedded product catalog.');

const products = new Map(JSON.parse(catalogMatch[1]).map((product) => [product.handle, product]));
const cardPattern = /<button class="(?:collection-card|flyer-card)"[^>]*aria-label="([^"]+)"[^>]*data-filter-jump="([^"]+)"[^>]*data-product-handles="([^"]+)"[^>]*>(.*?)<\/button>/gs;
const cards = [...html.matchAll(cardPattern)];

if (cards.length !== 7) throw new Error(`Expected 7 verified homepage cards; found ${cards.length}.`);

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
    if (!product.available || product.inventory < 1) {
      throw new Error(`${label}: ${product.title} is not currently available.`);
    }
    if (product.category !== filter) {
      throw new Error(`${label}: ${product.title} belongs to ${product.category}, not ${filter}.`);
    }

    const imagePath = imagePaths[index];
    if (!imagePath.startsWith('assets/card-products/')) {
      throw new Error(`${label}: ${imagePath} is not a local verified card-product asset.`);
    }
    if (!fs.existsSync(path.join(root, imagePath))) {
      throw new Error(`${label}: missing product image ${imagePath}.`);
    }
  });
}

console.log(`Verified ${cards.length} homepage cards and ${cards.reduce((total, card) => total + card[3].split(',').length, 0)} catalog-product placements.`);
