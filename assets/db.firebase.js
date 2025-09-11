// assets/db.firebase.js
(function(){
  const CFG    = window.FIREBASE_CONFIG || {};
  const BASE   = (CFG.BACKEND_URL || '').replace(/\/+$/,''); // remove barra final
  const TENANT = encodeURIComponent(CFG.TENANT_ID || 'default');

  function ensureBase(){
    if(!BASE){
      console.warn('[DB] BACKEND_URL vazio em firebase-config.js');
      throw new Error('BACKEND_URL não configurado');
    }
  }

  function buildURL(path, params){
    ensureBase();
    const p = path.startsWith('/') ? path : `/${path}`;
    const u = new URL(BASE + p);
    u.searchParams.set('tenant', TENANT);
    if(params && typeof params === 'object'){
      for(const [k,v] of Object.entries(params)){ if(v!=null) u.searchParams.set(k, v); }
    }
    return u.toString();
  }

  async function jget(path, params){
    const res = await fetch(buildURL(path, params), { method:'GET', cache:'no-store' });
    if(!res.ok){
      const t = await res.text().catch(()=>String(res.status));
      throw new Error(`[GET ${path}] ${res.status} ${t}`);
    }
    return res.json();
  }
  async function jpost(path, body){
    const res = await fetch(buildURL(path), {
      method:'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body||{})
    });
    if(!res.ok){
      const t = await res.text().catch(()=>String(res.status));
      throw new Error(`[POST ${path}] ${res.status} ${t}`);
    }
    return res.json();
  }
  async function jdel(path){
    const res = await fetch(buildURL(path), { method:'DELETE' });
    if(!res.ok){
      const t = await res.text().catch(()=>String(res.status));
      throw new Error(`[DELETE ${path}] ${res.status} ${t}`);
    }
    return res.json();
  }
  async function jpatch(path, body){
    const res = await fetch(buildURL(path), {
      method:'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body||{})
    });
    if(!res.ok){
      const t = await res.text().catch(()=>String(res.status));
      throw new Error(`[PATCH ${path}] ${res.status} ${t}`);
    }
    return res.json();
  }

  // ========= API para o ADMIN (usa window.DB.* no seu admin.js) =========
  window.DB = {
    enabled: !!BASE,

    async healthCheck(){
      try{ return await jget('/health'); }
      catch(e){ console.error(e); return { ok:false, error:String(e) }; }
    },

    // Admin espera um ARRAY direto
    async getProducts(){
      const r = await jget('/products');
      return Array.isArray(r.products) ? r.products : [];
    },

    async setProduct(product){
      // { id, name, category, price, image }
      if(!product || !product.id) throw new Error('Produto sem id');
      const r = await jpost('/products', product);
      if(r && r.ok) return r;
      throw new Error('Falha ao salvar produto');
    },

    async deleteProduct(id){
      if(!id) throw new Error('ID vazio');
      const r = await jdel(`/products/${encodeURIComponent(id)}`);
      if(r && r.ok) return r;
      throw new Error('Falha ao excluir produto');
    }
  };

  // ========= API para o POS (usa window.API.* no pos.js) =========
  window.API = {
    enabled: !!BASE,

    health(){ return jget('/health'); },

    // POS espera { products: [...] }
    listProducts(){ return jget('/products'); },

    tabsOpen(){ return jget('/tabs/open'); },

    upsertTab(tab){ return jpost('/tabs/upsert', tab); },

    deleteTab(id){ return jdel(`/tabs/${encodeURIComponent(id)}`); },

    closeComanda(payload){ return jpost('/close-comanda', payload); },

    history(){ return jget('/history'); },

    settings(){ return jget('/settings'); },

    patchSettings(partial){ return jpatch('/settings', partial); }
  };

})();
