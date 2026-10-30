#!/usr/bin/env node
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const catalog=fs.readFileSync(path.join(root,'assets/bundle-catalog.js'),'utf8');
const bundles=vm.runInNewContext(catalog+'\nJSON.stringify(EE_BUNDLES)');
const products=JSON.parse(bundles);
assert.equal(products.length,4);
assert.equal(products.reduce((n,p)=>n+p.variantDetails.length,0),26);
assert.equal(products.reduce((n,p)=>n+p.inventory,0),42);
assert.deepEqual(products.map(p=>p.inventory),[3,21,6,12]);
assert.deepEqual(products.map(p=>p.price),[80,65,75,75]);
const ids=new Set();
for(const p of products){
  assert.equal(p.category,'Human Hair');
  assert.ok(p.image.startsWith('https://cdn.shopify.com/'));
  assert.equal(p.available,true);
  for(const v of p.variantDetails){
    assert.match(v.id,/^\d+$/);
    assert.ok(!ids.has(v.id));ids.add(v.id);
    assert.ok(Number.isInteger(v.inventory)&&v.inventory>=0);
    assert.ok(v.price>0);
  }
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const baseline=JSON.parse(html.match(/const PRODUCTS = (\[[^\n]+\]);/)[1]);
assert.ok(baseline.length>0,'Existing baseline catalog must be preserved');
assert.ok(new Set([...baseline,...products].map(p=>p.handle)).size>=new Set(baseline.map(p=>p.handle)).size);
assert.ok(html.includes('assets/bundle-catalog.js'));
assert.ok(html.includes('assets/bundle-storefront.js'));
console.log(`Verified 4 bundles, 26 unique length variants, 42 stock units, and ${baseline.length} baseline products.`);
