// assets/db.firebase.js
(function(){
  const cfg = window.FIREBASE_CONFIG || {};
  const API = (cfg.BACKEND_URL || "").replace(/\/+$/,'');
  const TENANT = cfg.TENANT_ID || "default";

  async function call(path, { method="GET", body } = {}){
    if(!API) throw new Error("BACKEND_URL não configurada em assets/firebase-config.js");
    const url = `${API}${path}${path.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(TENANT)}`;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit",
      cache: "no-cache",
      mode: "cors"
    });
    const text = await res.text();
    if(!res.ok) throw new Error(`${res.status} ${res.statusText} — ${text}`);
    return text ? JSON.parse(text) : null;
  }

  const DB = {
    enabled: !!API,
    healthCheck: async ()=> await call("/health"),
    getProducts: async ()=> (await call("/products")).products,
    setProduct: async (p)=> { await call("/products", { method:"POST", body:p }); },
    deleteProduct: async (id)=> { await call(`/products/${encodeURIComponent(id)}`, { method:"DELETE" }); },
    getOpenTabs: async ()=> (await call("/tabs/open")).tabs,
    upsertTab: async (tab)=> { await call("/tabs/upsert", { method:"POST", body:tab }); },
    deleteTab: async (id)=> { await call(`/tabs/${encodeURIComponent(id)}`, { method:"DELETE" }); },
    getHistory: async ()=> (await call("/history")).history,
    saveHistory: async (rec)=> { await call("/history/save", { method:"POST", body:rec }); },
    getSettings: async ()=> (await call("/settings")).settings || {},
    setSettings: async (s)=> { await call("/settings", { method:"PATCH", body:s }); },
    nextHistorySeq: async ()=> (await call("/seq/next", { method:"POST" })).value,
    closeComanda: async (tab)=> (await call("/close-comanda", { method:"POST", body:tab })).record
  };

  window.DB = DB;
})();
