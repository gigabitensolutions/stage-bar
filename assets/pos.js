/* ========= Backend toggle ========= */
const BACKEND_ON = !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.BACKEND_URL);
const CFG = window.FIREBASE_CONFIG || {};
const BASE = CFG.BACKEND_URL || '';
const TENANT = encodeURIComponent(CFG.TENANT_ID || 'default');

/* ========= PIX & payment ========= */
const PIX_CFG = { KEY:'edab0cd5-ecd4-4050-87f7-fbaf98899713', MERCHANT:'GIGABITEN', CITY:'BRASIL', DESC:'COMANDA' };
const PAYMENT_METHODS = ['PIX', 'Cartão de Débito', 'Cartão de Crédito'];

/* ========= Utils ========= */
const BRL = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const $   = s => document.querySelector(s);
const $$  = s => Array.from(document.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2,10);
const sum = arr => arr.reduce((a,b)=>a+b,0);

/* ========= Produtos default (fallback) ========= */
const DEFAULT_PRODUCTS = [
  { id:'cerveja_lata_350',   name:'Cerveja Lata 350ml',   category:'Cerveja', price: 8.00,  image:'./assets/placeholder.svg' },
  { id:'cerveja_garrafa_600',name:'Cerveja Garrafa 600ml',category:'Cerveja', price: 15.00, image:'./assets/placeholder.svg' },
  { id:'vodka_dose',         name:'Vodka (dose)',         category:'Drinks',  price: 12.00, image:'./assets/placeholder.svg' },
  { id:'whisky_dose',        name:'Whiskey (dose)',       category:'Drinks',  price: 18.00, image:'./assets/placeholder.svg' },
  { id:'porcao_fritas',      name:'Porção de Fritas',     category:'Comida',  price: 22.00, image:'./assets/placeholder.svg' },
  { id:'hamburguer',         name:'Hambúrguer',           category:'Comida',  price: 28.00, image:'./assets/placeholder.svg' }
];

/* ========= LocalStorage Keys ========= */
const LS_KEYS = {
  COMANDAS: 'comandas_v9',
  ACTIVE:   'activeComandaId_v9',
  PRODUCTS: 'products_cache_v5',
  SERVICE:  'service10_v5',
  BIGTOUCH: 'ui_big_touch_v5'
};

/* ========= Estado ========= */
let state = {
  products: [],
  categories: [],
  filterCat: 'Todos',
  query: '',
  comandas: {},                 // tabs abertas
  activeComandaId: null,
  service10: JSON.parse(localStorage.getItem(LS_KEYS.SERVICE) || 'false'),
  bigTouch: localStorage.getItem(LS_KEYS.BIGTOUCH) === '1',
  inlineNew: { name:'Mesa 1', label:'', color:'#3b82f6' },
  serverOK: false,
  historyCache: []
};

/* ========= Persistência ========= */
function loadPersisted(){
  try{
    state.comandas = JSON.parse(localStorage.getItem(LS_KEYS.COMANDAS) || '{}');
    const a = localStorage.getItem(LS_KEYS.ACTIVE);
    state.activeComandaId = (a && state.comandas[a]) ? a : null;
  }catch(e){}
}
function persist(){
  localStorage.setItem(LS_KEYS.COMANDAS, JSON.stringify(state.comandas));
  localStorage.setItem(LS_KEYS.ACTIVE, state.activeComandaId || '');
  localStorage.setItem(LS_KEYS.SERVICE, JSON.stringify(state.service10));
  localStorage.setItem(LS_KEYS.BIGTOUCH, state.bigTouch ? '1' : '0');
}

/* ========= Sync helpers ========= */
const syncTimers = {}; // por comanda
function touchTab(c){ c.updatedAt = Date.now(); persist(); scheduleSync(c.id); }
function scheduleSync(id){
  if(!BACKEND_ON || !BASE) return;
  clearTimeout(syncTimers[id]);
  syncTimers[id] = setTimeout(()=> syncTabNow(id), 500);
}
async function syncTabNow(id){
  const c = state.comandas[id]; if(!c) return;
  try{ await window.API?.upsertTab?.({ ...c, status:'open' }); }catch(e){ /* silencioso */ }
}
// flush para todas as tabs (antes de fechar)
function upsertKeepalive(tab){
  if(!BACKEND_ON || !BASE) return;
  const url = `${BASE}/tabs/upsert?tenant=${TENANT}`;
  const body = JSON.stringify({ ...tab, status:'open' });
  try{
    if(navigator.sendBeacon){
      const blob = new Blob([body], { type:'application/json' });
      navigator.sendBeacon(url, blob);
    }else{
      fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body, keepalive:true });
    }
  }catch(_){}
}
function flushAllTabs(){
  Object.values(state.comandas).forEach(t => upsertKeepalive(t));
}

/* ========= Produtos ========= */
async function loadProducts(){
  try{
    if(window.API?.listProducts){
      const data = await API.listProducts();
      const arr = Array.isArray(data.products) ? data.products : [];
      if(arr.length){
        state.products = arr.map(p => ({
          id: p.id, name: p.name, category: p.category || 'Outros',
          price: Number(p.price||0), image: (p.image||'').trim() || './assets/placeholder.svg'
        }));
        state.categories = ['Todos', ...Array.from(new Set(state.products.map(p=>p.category)))];
        localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(state.products));
        return;
      }
    }
  }catch(e){ /* fallback abaixo */ }

  try{
    const cached = JSON.parse(localStorage.getItem(LS_KEYS.PRODUCTS) || '[]');
    if(Array.isArray(cached) && cached.length){
      state.products = cached;
      state.categories = ['Todos', ...Array.from(new Set(cached.map(p=>p.category)))];
      return;
    }
  }catch(e){}

  state.products = DEFAULT_PRODUCTS;
  state.categories = ['Todos', ...Array.from(new Set(DEFAULT_PRODUCTS.map(p=>p.category)))];
}

/* ========= Sessão cross-browser ========= */
function asMapById(list){ const m={}; list.forEach(t=>{ m[t.id]=t; }); return m; }
function mergeTabs(serverTabs){
  const srv = asMapById(serverTabs);
  const loc = state.comandas;

  // tabs locais que não existem no servidor -> enviar
  Object.keys(loc).forEach(id=>{
    if(!srv[id]) { /* nova local, sobe */ upsertKeepalive(loc[id]); }
    else{
      const L = Number(loc[id].updatedAt||0), S = Number(srv[id].updatedAt||0);
      if(L > S){ /* local mais nova */ upsertKeepalive(loc[id]); }
      else{ /* servidor mais novo */ loc[id] = { ...srv[id] };
    }
  });

  // tabs do servidor que não existem local -> trazer
  Object.keys(srv).forEach(id=>{
    if(!loc[id]) loc[id] = { ...srv[id] };
  });

  // ativa alguma
  if(!state.activeComandaId){
    const ids = Object.keys(loc);
    state.activeComandaId = ids[0] || null;
  }
  persist();
}

async function loadOpenTabsFromServer(){
  if(!BACKEND_ON || !window.API?.tabsOpen) return false;
  try{
    const res = await API.tabsOpen();
    const tabs = Array.isArray(res.tabs)? res.tabs : [];
    tabs.forEach(t=>{ t.items = t.items || {}; t.status = t.status || 'open'; t.payMethod = t.payMethod || 'PIX'; });
    mergeTabs(tabs);
    return true;
  }catch(e){
    return false;
  }
}

/* ========= Comandas ========= */
function createComanda({name,label,color}){
  const id = uid();
  state.comandas[id] = {
    id, name, label: label || '', color: color || '#3b82f6',
    createdAt: Date.now(), updatedAt: Date.now(),
    payMethod: 'PIX', items:{}, status:'open'
  };
  state.activeComandaId = id;
  persist(); refreshComandaSelect(); updateSummaryBar(); scheduleSync(id);
  return id;
}
function getActive(){ return state.activeComandaId ? state.comandas[state.activeComandaId] : null; }
function setActive(id){ state.activeComandaId = id; persist(); updateSummaryBar(); }

async function deleteActive(){
  const c = getActive(); if(!c) return;
  if(confirm(`Excluir comanda "${c.name}"?`)){
    try{ await window.API?.deleteTab?.(c.id); }catch(e){}
    delete state.comandas[c.id];
    state.activeComandaId = Object.keys(state.comandas)[0] || null;
    persist(); refreshComandaSelect(); updateSummaryBar();
  }
}
function clearItems(){
  const c = getActive(); if(!c) return;
  c.items = {}; touchTab(c);
  updateSummaryBar();
  if($('#drawer')?.classList.contains('open')) renderDrawer();
}
function calc(c){
  const items = Object.values(c.items||{});
  const subtotal = sum(items.map(i=>i.unit*i.qty));
  const service = state.service10 ? subtotal*0.10 : 0;
  const total = subtotal + service;
  const count = sum(items.map(i=>i.qty));
  return {items, subtotal, service, total, count};
}
async function closeComanda(){
  const c = getActive(); if(!c) return;
  if(!confirm(`Fechar comanda "${c.name}"?`)) return;

  if(window.API?.closeComanda){
    try{
      await API.closeComanda({ ...c, service10: state.service10 });
      await loadOpenTabsFromServer();
      refreshComandaSelect(); updateSummaryBar();
      if($('#drawer')?.classList.contains('open')) renderDrawer();
      alert('Comanda fechada e salva no histórico.');
      return;
    }catch(e){
      alert('Falha ao fechar no servidor: '+e.message);
    }
  }

  // fallback local
  c.items = {}; touchTab(c);
  if($('#drawer')?.classList.contains('open')) renderDrawer();
}

/* ========= UI filtros/cards ========= */
function refreshChips(){
  const cont = $('#chips'); cont.innerHTML = '';
  state.categories.forEach(cat=>{
    const b = document.createElement('button');
    b.className = 'chip' + (state.filterCat===cat?' active':'');
    b.textContent = cat;
    b.onclick = ()=>{ state.filterCat=cat; renderGrid(); };
    cont.appendChild(b);
  });
}
function passFilters(p){
  const byCat = state.filterCat==='Todos' || p.category===state.filterCat;
  const q = state.query.trim().toLowerCase();
  const byQuery = !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
  return byCat && byQuery;
}
function getQty(productId){
  const c = getActive(); if(!c) return 0;
  return c.items[productId]?.qty || 0;
}
function addToComanda(product, qty=1){
  let c = getActive();
  if(!c){
    c = state.comandas[createComanda({
      name:  state.inlineNew.name || 'Mesa 1',
      label: state.inlineNew.label || '',
      color: state.inlineNew.color || '#22c55e'
    })];
  }
  const current = c.items[product.id] || { id:product.id, name:product.name, unit:product.price, qty:0 };
  current.qty += qty;
  if(current.qty<=0) delete c.items[product.id]; else c.items[product.id] = current;
  touchTab(c);
  updateSummaryBar();
}
function renderGrid(){
  const grid = $('#grid'); const list = state.products.filter(passFilters);
  grid.innerHTML = '';
  list.forEach(p=>{
    const imgSrc = p.image && p.image.trim() ? p.image.trim() : './assets/placeholder.svg';
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="product-head">
        <div class="left">
          <img class="thumb" src="${imgSrc}" alt="">
          <div class="title-wrap">
            <h3 class="title">${p.name}</h3>
            <div class="muted">${p.category}</div>
          </div>
        </div>
        <div class="price">${BRL.format(p.price)}</div>
      </div>

      <div class="flex" style="margin-top:12px">
        <div class="stepper">
          <button data-act="dec">−</button>
          <input type="text" inputmode="numeric" value="${getQty(p.id)}">
          <button data-act="inc">+</button>
        </div>
        <button class="btn" data-add>Adicionar</button>
      </div>`;
    const input = card.querySelector('input');
    const cDec = card.querySelector('[data-act="dec"]');
    const cInc = card.querySelector('[data-act="inc"]');
    cDec.onclick=()=>{ input.value=Math.max(0,(parseInt(input.value)||0)-1) };
    cInc.onclick=()=>{ input.value=Math.max(0,(parseInt(input.value)||0)+1) };
    input.onfocus=()=>input.select();
    card.querySelector('[data-add]').onclick=()=>{
      const q=Math.max(1,parseInt(input.value)||0);
      addToComanda(p,q); input.value=getQty(p.id);
    };
    grid.appendChild(card);
  });
}

/* ========= Bottom bar ========= */
function updateSummaryBar(){
  const c = getActive();
  if(!c){ $('#summaryCount').textContent='0 itens'; $('#summaryTotal').textContent=BRL.format(0); return; }
  const t = calc(c);
  $('#summaryCount').textContent = `${t.count} ${t.count===1?'item':'itens'}`;
  $('#summaryTotal').textContent = BRL.format(t.total);
}

/* ========= Drawer ========= */
function renderPayMethods(){
  const cont = $('#payMethods'); cont.innerHTML='';
  const c = getActive(); if(!c) return;
  PAYMENT_METHODS.forEach(method=>{
    const b = document.createElement('button');
    b.className = 'chip' + (c.payMethod===method?' active':'');
    b.textContent = method;
    b.onclick = ()=>{
      c.payMethod = method;
      touchTab(c);
      renderPayMethods();
      togglePixButton();
    };
    cont.appendChild(b);
  });
}
function renderDrawer(){
  const c = getActive(); const cont = $('#lines'); const mini = $('#comandaNameMini'); const labMini = $('#comandaLabelMini');
  cont.innerHTML = '';
  mini.textContent = c ? c.name : '—';
  labMini.innerHTML = c?.label ? `<span class="tag"><span class="dot" style="background:${c.color}"></span>${c.label}</span>` : `<span class="dot" style="background:${c?.color||'#888'}"></span>—`;
  if(!c || Object.keys(c.items).length===0){ cont.innerHTML = `<div class="muted">Nenhum item na comanda.</div>`; }
  else{
    Object.values(c.items).forEach(i=>{
      const line = document.createElement('div'); line.className='line';
      line.innerHTML = `
        <div>
          <div class="name">${i.name}</div>
          <div class="mini">${i.qty} × ${BRL.format(i.unit)}</div>
        </div>
        <div class="flex" style="gap:6px">
          <button class="btn" data-dec>−</button>
          <button class="btn" data-inc>+</button>
          <strong>${BRL.format(i.unit*i.qty)}</strong>
        </div>`;
      line.querySelector('[data-dec]').onclick=()=>{ i.qty=Math.max(0,i.qty-1); if(i.qty===0) delete c.items[i.id]; touchTab(c); renderDrawer(); updateSummaryBar(); };
      line.querySelector('[data-inc]').onclick=()=>{ i.qty+=1; touchTab(c); renderDrawer(); updateSummaryBar(); };
      cont.appendChild(line);
    });
  }
  const t = calc(c||{items:{}});
  $('#subtotalTxt').textContent = BRL.format(t.subtotal);
  $('#serviceTxt').textContent  = BRL.format(t.service);
  $('#totalTxt').textContent    = BRL.format(t.total);
  $('#sv10').checked = state.service10;
  renderPayMethods();
  togglePixButton();
}
function togglePixButton(){
  const c = getActive(); if(!c) return;
  $('#pixBtn').style.display = (c.payMethod==='PIX') ? '' : 'none';
}

/* ========= Share / PDF da comanda ========= */
/* (mesmas funções que você já usa para PDF/QR aqui; omitidas por brevidade se não mudou) */

/* ========= Histórico ========= */
/* (mantém sua renderização e exportações que já estão funcionando) */

/* ========= Health + polling ========= */
async function refreshHealth(){
  const el = $('#dbStatus');
  if(!el){ return; }
  if(!BACKEND_ON){ el.textContent = 'DB: OFF'; el.style.borderColor = '#ef4444'; return; }
  try{
    const h = await API.health();
    const ok = !!(h && h.ok);
    el.textContent = ok ? `DB: OK (${h.tenant||'—'})` : 'DB: OFF';
    el.style.borderColor = ok ? '#22c55e' : '#ef4444';
    state.serverOK = ok;
  }catch(e){
    el.textContent = 'DB: OFF';
    el.style.borderColor = '#ef4444';
  }
}
function startPolling(){
  if(!BACKEND_ON) return;
  setInterval(async ()=>{
    await loadOpenTabsFromServer(); // sincroniza alterações feitas em outro navegador
    refreshComandaSelect();
    updateSummaryBar();
  }, 10000);
}

/* ========= Controles ========= */
function refreshComandaSelect(){
  const sel = $('#comandaSelect'); if(!sel) return;
  sel.innerHTML='';
  const ids = Object.keys(state.comandas);
  if(ids.length===0){ sel.innerHTML='<option value="">(sem comanda)</option>'; return; }
  ids.forEach(id=>{
    const c = state.comandas[id];
    const opt = document.createElement('option');
    opt.value=id; opt.textContent = c.name + (c.label?` [${c.label}]`:'');
    if(id===state.activeComandaId) opt.selected=true;
    sel.appendChild(opt);
  });
}

/* ========= Boot ========= */
async function boot(){
  loadPersisted();
  await refreshHealth();
  await loadProducts();

  // Tenta trazer sessão do servidor e mesclar
  await loadOpenTabsFromServer();

  // Se ainda não houver comanda ativa, cria uma padrao local
  if(!state.activeComandaId){
    createComanda({name:'Mesa 1', color:'#22c55e'});
  }

  // UI inicial
  applyBigTouch();
  refreshChips(); refreshComandaSelect(); renderGrid(); updateSummaryBar();

  // Bind globais básicos (mantém seus handlers atuais)
  $('#deleteComandaBtn')?.addEventListener('click', deleteActive);
  $('#comandaSelect')?.addEventListener('change', e=> setActive(e.target.value));
  $('#search')?.addEventListener('input', e=>{ state.query=e.target.value; renderGrid(); });
  $('#clearSearch')?.addEventListener('click', ()=>{ const s=$('#search'); if(s){ s.value=''; } state.query=''; renderGrid(); });

  $('#openDrawer')?.addEventListener('click', ()=>{ $('#drawer')?.classList.add('open'); renderDrawer(); });
  $('#closeDrawer')?.addEventListener('click', ()=>$('#drawer')?.classList.remove('open'));
  $('#sv10')?.addEventListener('change', e=>{ state.service10 = e.target.checked; persist(); const c=getActive(); if(c){ touchTab(c); } renderDrawer(); updateSummaryBar(); });

  // PIX modal (mantém sua implementação existente que usa QRCode)
  $('#pixBtn')?.addEventListener('click', async ()=>{
    const c=getActive(); if(!c) return;
    const t=calc(c); const payload = buildPixPayload(t.total, c.id);
    const cont = $('#pixQR'); if(cont){ cont.innerHTML=''; new QRCode(cont, {text: payload, width:220, height:220, correctLevel: QRCode.CorrectLevel.M}); }
    const input = $('#pixPayload'); if(input){ input.value = payload; }
    $('#pixModal')?.classList.add('open');
  });
  $('#closePixBtn')?.addEventListener('click', ()=>$('#pixModal')?.classList.remove('open'));
  $('#copyPixBtn')?.addEventListener('click', ()=>{ const t=$('#pixPayload'); if(t){ t.select(); document.execCommand('copy'); alert('Código PIX copiado!'); } });

  // Fechar modais clicando no backdrop
  $$('.modal').forEach(m=> m.addEventListener('click', (ev)=>{ if(ev.target===m) m.classList.remove('open'); }));

  // Polling para sessão
  startPolling();

  // FLUSH ao sair/ocultar (garante sessão salva mesmo se travar/fechar)
  window.addEventListener('beforeunload', flushAllTabs);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) flushAllTabs(); });
}
function applyBigTouch(){
  document.body.classList.toggle('big-touch', !!state.bigTouch);
  const b = $('#bigTouchBtn');
  if(b){ b.textContent = state.bigTouch ? 'Toque grande: ON' : 'Toque grande'; b.setAttribute('aria-pressed', state.bigTouch?'true':'false'); }
}
document.addEventListener('DOMContentLoaded', boot);
