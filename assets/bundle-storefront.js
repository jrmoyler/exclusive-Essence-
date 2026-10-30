/* Length-aware bundle controls. Existing single-variant products retain their behavior. */
function cartVariant(item) {
  return PRODUCTS.find(p=>p.id===item.id)?.variantDetails?.find(v=>v.id===item.variantId);
}
function cartUnitPrice(item) {
  return cartVariant(item)?.price ?? PRODUCTS.find(p=>p.id===item.id)?.price ?? 0;
}

(function(){
  const originalCard=productCard, originalQuick=quickView, originalAdd=addToCart;
  const originalCheckout=eeStartShopifyCheckout;
  productCard=function(p){
    const html=originalCard(p);
    return p.variantDetails
      ? html.replace('<span class="price">','<span class="price">From ').replace('>Add to Cart<','>Choose Length<').replace(/<span class="rating">.*?<\/span>/,'')
      : html;
  };
  addToCart=function(id,qty=1,variantId){
    const p=PRODUCTS.find(x=>x.id===id);
    if(!p?.variantDetails)return originalAdd(id,qty);
    if(!variantId){quickView(id);return;}
    const v=p.variantDetails.find(x=>x.id===variantId);
    if(!v||v.inventory<=0){toast('That length is sold out. Choose another length.');return;}
    const item=state.cart.find(x=>x.id===id&&x.variantId===variantId);
    if((item?.qty||0)+qty>v.inventory){toast(`Only ${v.inventory} available in ${v.title}.`);return;}
    if(item)item.qty+=qty;else state.cart.push({id,variantId,qty});
    persist();renderCart();toast(`${p.title} · ${v.title} added to cart`);
    eeTrack('add_to_cart',{currency:'USD',value:v.price,items:[{item_id:v.id,item_name:p.title,item_variant:v.title,price:v.price,quantity:qty}]});
  };
  quickView=function(id){
    originalQuick(id);
    const p=PRODUCTS.find(x=>x.id===id);
    if(!p?.variantDetails)return;
    const copy=$('#quickContent .quick-copy'), add=copy.querySelector('[data-add],[data-sold-out]');
    if(!add)return;
    copy.querySelector('.rating')?.remove();
    add.removeAttribute('data-add');add.removeAttribute('data-sold-out');
    add.setAttribute('data-bundle-add',p.id);
    const box=document.createElement('div');box.className='bundle-options';
    box.innerHTML=`<label for="bundleLength">Length</label>
      <select id="bundleLength" data-bundle-length="${esc(p.id)}">${p.variantDetails.map(v=>`<option value="${v.id}">${esc(v.title)} · ${money(v.price)}${v.inventory>0?'':' · Sold out'}</option>`).join('')}</select>
      <p id="bundleStock" role="status" aria-live="polite"></p>`;
    add.before(box);
    box.querySelector('select').value=(p.variantDetails.find(v=>v.inventory>0)||p.variantDetails[0]).id;
    function update(){
      const v=p.variantDetails.find(v=>v.id===box.querySelector('select').value);
      copy.querySelector('.quick-price').textContent=money(v.price);
      box.querySelector('#bundleStock').textContent=v.inventory>0?`${v.inventory} in stock · One bundle per unit`:'Sold out in this length';
      add.disabled=v.inventory<=0;add.textContent=v.inventory>0?'Add to Cart':'Sold Out';
      add.dataset.variantId=v.id;
    }
    box.querySelector('select').addEventListener('change',update);update();
  };
  renderCart=function(){
    const count=state.cart.reduce((n,i)=>n+i.qty,0);
    $('#cartCount').textContent=count;$('#mobileCartCount').textContent=count;
    $('#cartItems').innerHTML=state.cart.length?state.cart.map(i=>{
      const p=PRODUCTS.find(x=>x.id===i.id);if(!p)return '';
      const v=cartVariant(i),key=i.variantId||i.id;
      return `<div class="cart-item"><img src="${esc(p.image||ASSETS.noProductImage)}" alt="${esc(p.title)}" onerror="this.onerror=null;this.src=ASSETS.noProductImage"><div>
        <strong>${esc(p.title)}</strong><small>${esc(p.brand)}${v?' · '+esc(v.title):''}</small>
        <div class="qty"><button data-cart-qty="${esc(key)}" data-delta="-1" aria-label="Decrease quantity">−</button><span>${i.qty}</span><button data-cart-qty="${esc(key)}" data-delta="1" aria-label="Increase quantity" ${v&&i.qty>=v.inventory?'disabled':''}>+</button></div>
        <button class="remove" data-cart-remove="${esc(key)}">Remove</button></div><b>${money(cartUnitPrice(i)*i.qty)}</b></div>`;
    }).join(''):'<p style="text-align:center;color:var(--muted);padding:48px 12px">Your cart is empty.<br><br><a class="btn btn-secondary" href="#catalog" data-close>Start Shopping</a></p>';
    const total=state.cart.reduce((sum,i)=>sum+cartUnitPrice(i)*i.qty,0);
    $('#cartTotal').textContent=money(total);updateLayawayCalc(total);
  };
  document.addEventListener('click',e=>{
    const add=e.target.closest('[data-bundle-add]');
    if(add)addToCart(add.dataset.bundleAdd,1,add.dataset.variantId);
    const qty=e.target.closest('[data-cart-qty]'),rm=e.target.closest('[data-cart-remove]');
    if(!qty&&!rm)return;
    const key=qty?.dataset.cartQty||rm.dataset.cartRemove;
    const item=state.cart.find(i=>(i.variantId||i.id)===key);if(!item)return;
    if(rm)state.cart=state.cart.filter(i=>i!==item);
    else{
      const next=item.qty+Number(qty.dataset.delta),v=cartVariant(item);
      if(v&&next>v.inventory){toast(`Only ${v.inventory} available in ${v.title}.`);return;}
      if(next<=0)state.cart=state.cart.filter(i=>i!==item);else item.qty=next;
    }
    persist();renderCart();
  });
  eeStartShopifyCheckout=async function(){
    if(!state.cart.some(i=>PRODUCTS.find(p=>p.id===i.id)?.variantDetails))return originalCheckout();
    const btn=$('#checkoutBtn'),label=btn.textContent;
    btn.disabled=true;btn.textContent='Opening secure checkout...';
    try{
      const rows=state.cart.map(item=>({item,product:PRODUCTS.find(p=>p.id===item.id)}));
      if(rows.some(r=>!r.product))throw new Error('A cart product is no longer listed.');
      const unresolved=rows.filter(r=>!r.product.variantDetails);
      if(unresolved.length&&!eeShopify.configured)throw new Error('Store connection is unavailable for this mixed cart.');
      const map=unresolved.length?await eeShopify.resolveVariants([...new Set(unresolved.map(r=>r.product.handle))]):{};
      const lines=rows.map(({item,product})=>{
        const v=cartVariant(item);
        if(product.variantDetails&&(!v||item.qty>v.inventory||item.qty<1))throw new Error('Review your selected bundle lengths and quantities.');
        const id=v?.id||map[product.handle]?.split('/').pop();
        if(!id)throw new Error(`${product.title} is unavailable. Remove it to continue.`);
        return `${id}:${item.qty}`;
      });
      const total=state.cart.reduce((sum,i)=>sum+cartUnitPrice(i)*i.qty,0);
      eeTrack('begin_checkout',{currency:'USD',value:total});
      // Native Shopify cart links preserve exact variants and validate current stock.
      window.location.href='https://'+EE_SHOPIFY_DOMAIN+'/cart/'+lines.join(',');
    }catch(err){
      console.error('[EE bundles] checkout failed:',err);toast(err.message);
      btn.disabled=false;btn.textContent=label;
    }
  };
  renderNew();renderStoreAisles();renderCatalog();renderCart();
})();
