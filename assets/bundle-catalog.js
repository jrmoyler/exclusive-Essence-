/* Shopify snapshot: 2026-10-29. Prices and available stock are validated at checkout. */
const EE_BUNDLES = [
  {
    handle: 'italian-curly-hair-bundle', title: 'Italian Curly Hair Bundle',
    image: 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/italian-curly-bundle_50c3b13a-aa2e-4150-afe6-53ea2437180d.jpg?v=1793316482',
    description: 'Italian Curly hair bundle. One bundle per unit. Select your length below.',
    variantDetails: [
      {id:'67965006184531',title:'16"',price:80,inventory:1},
      {id:'67965006217299',title:'18"',price:85,inventory:1},
      {id:'67965006250067',title:'20"',price:90,inventory:1}
    ]
  },
  {
    handle: 'body-wave-hair-bundle', title: 'Body Wave Hair Bundle',
    image: 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/body-wave-bundle.jpg?v=1793317741',
    description: 'Body Wave hair bundle featuring a flowing wave pattern. One bundle per unit. Select your length below.',
    variantDetails: [
      {id:'67965158228051',title:'12"',price:65,inventory:2},
      {id:'67965158260819',title:'14"',price:70,inventory:3},
      {id:'67965158293587',title:'16"',price:75,inventory:3},
      {id:'67965158326355',title:'18"',price:80,inventory:3},
      {id:'67965158359123',title:'20"',price:85,inventory:3},
      {id:'67965158391891',title:'22"',price:90,inventory:4},
      {id:'67965158424659',title:'24"',price:95,inventory:2},
      {id:'67965158457427',title:'26"',price:100,inventory:1},
      {id:'67965158490195',title:'28"',price:105,inventory:0}
    ]
  },
  {
    handle: 'loose-wave-hair-bundle', title: 'Loose Wave Hair Bundle',
    image: 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/loose-wave-bundle.jpg?v=1793318693',
    description: 'Loose Wave hair bundle. One bundle per unit. Select your length below.',
    variantDetails: [
      {id:'67965184180307',title:'16"',price:75,inventory:1},
      {id:'67965184213075',title:'18"',price:80,inventory:2},
      {id:'67965184245843',title:'20"',price:85,inventory:2},
      {id:'67965184278611',title:'22"',price:90,inventory:1},
      {id:'67965184311379',title:'24"',price:95,inventory:0},
      {id:'67965184344147',title:'26"',price:100,inventory:0},
      {id:'67965184376915',title:'28"',price:105,inventory:0}
    ]
  },
  {
    handle: 'straight-hair-bundle', title: 'Straight Hair Bundle',
    image: 'https://cdn.shopify.com/s/files/1/0716/1390/7027/files/straight-hair-bundle.jpg?v=1793323913',
    description: 'Straight hair bundle. One bundle per unit. Select your length below.',
    variantDetails: [
      {id:'67965404807251',title:'16"',price:75,inventory:2},
      {id:'67965404840019',title:'18"',price:80,inventory:4},
      {id:'67965404872787',title:'20"',price:85,inventory:4},
      {id:'67965404905555',title:'22"',price:90,inventory:2},
      {id:'67965404938323',title:'24"',price:95,inventory:0},
      {id:'67965404971091',title:'26"',price:100,inventory:0},
      {id:'67965405003859',title:'28"',price:105,inventory:0}
    ]
  }
].map(p => ({
  ...p, id:'catalog-'+p.handle, brand:'Exclusive Essence', category:'Human Hair',
  price:Math.min(...p.variantDetails.map(v=>v.price)), badge:'New',
  images:[p.image], variants:p.variantDetails.map(v=>v.title), swatches:[],
  skus:[], sourceHandles:[p.handle],
  inventory:p.variantDetails.reduce((total,v)=>total+v.inventory,0),
  available:p.variantDetails.some(v=>v.inventory>0)
}));
