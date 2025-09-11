/* pos.js — POS com Histórico, fechamento que remove da visão geral,
   e sincronização cross-browser (polling + autosave/flush) */

/* ========= Detecção de backend ========= */
const API = (window.API || {});
const BACKEND_ON = !!(API && API.enabled);

/* ========= Config ========= */
const TENANT = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.TENANT_ID) || 'default';
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

/* ========= LocalStorage ========= */
const LS = {
  COMANDAS: 'comandas_v10',
  ACTIVE:   'activeComandaId_v10',
  PRODUCTS: 'products_cache_v6',
  SERVICE:  'service10_v6',
  BIGTOUCH: 'ui_big_touch_v6'
};

/* ========= Estado ========= */
let state = {
  products: [],
  categories: [],
  filterCat: 'Todos',
  query: '',
  comandas: {},                   // somente abertas
  activeComandaId: null,
  service10: JSON.parse(localStorage.getItem(LS.SERVICE) || 'false'),
  bigTouch: localStorage.getItem(LS.BIGTOUCH) === '1',
  inlineNew: { name:'Mesa 1', label:'', color:'#3b82f6' },
  serverOK: false,
  historyCache: []
};

/* ========= Persistência ========= */
function loadPersisted(){
  try{
    state.comandas = JSON.parse(localStorage.getItem(LS.COMANDAS) || '{}');
    const a = localStorage.getItem(LS.ACTIVE);
    state.activeComandaId = (a && state.comandas[a]) ? a : null;
  }catch(e){}
}
function persist(){
  localStorage.setItem(LS.COMANDAS, JSON.stringify(state.comandas));
  localStorage.setItem(LS.ACTIVE, state.activeComandaId || '');
  localStorage.setItem(LS.SERVICE, JSON.stringify(state.service10));
  localStorage.setItem(LS.BIGTOUCH, state.bigTouch ? '1' : '0');
}

/* ========= Health ========= */
async function refreshHealth(){
  const el = $('#dbStatus'); // opcional
  if(!el) return;
  if(!BACKEND_ON){ el.textContent='DB: OFF'; el.style.borderColor='#ef4444'; return; }
  try{
    const h = await API.health();
    const ok = !!(h && h.ok);
    el.textContent = ok ? `DB: OK (${h.tenant||'—'})` : 'DB: OFF';
    el.style.borderColor = ok ? '#22c55e' : '#ef4444';
    state.serverOK = ok;
  }catch(e){
    el.textContent='DB: OFF'; el.style.borderColor='#ef4444';
  }
}

/* ========= Produtos ========= */
async function loadProducts(){
  if(BACKEND_ON && API.listProducts){
    try{
      const data = await API.listProducts();
      const arr  = Array.isArray(data && data.products) ? data.products : [];
      if(arr.length){
        state.products = arr.map(p=>({
          id: p.id, name:p.name, category:p.category||'Outros',
          price:Number(p.price||0),
          image:(p.image||'').trim() || './assets/placeholder.svg'
        }));
        state.categories = ['Todos', ...Array.from(new Set(state.products.map(p=>p.category)))];
        localStorage.setItem(LS.PRODUCTS, JSON.stringify(state.products));
        return;
      }
    }catch(e){ /* segue para cache/default */ }
  }
  try{
    const cached = JSON.parse(localStorage.getItem(LS.PRODUCTS) || '[]');
    if(Array.isArray(cached) && cached.length){
      state.products = cached;
      state.categories = ['Todos', ...Array.from(new Set(cached.map(p=>p.category)))];
      return;
    }
  }catch(e){}
  state.products = DEFAULT_PRODUCTS;
  state.categories = ['Todos', ...Array.from(new Set(DEFAULT_PRODUCTS.map(p=>p.category)))];
}

/* ========= Sincronização de tabs (cross-browser) ========= */
const syncTimers = {};
function touchTab(c){ c.updatedAt = Date.now(); persist(); scheduleSync(c.id); }
function scheduleSync(id){
  if(!BACKEND_ON || !API.upsertTab) return;
  clearTimeout(syncTimers[id]);
  syncTimers[id] = setTimeout(async ()=>{
    try{ await API.upsertTab({ ...state.comandas[id], status:'open' }); }catch(_){}
  }, 500);
}
function upsertKeepalive(tab){
  if(!BACKEND_ON || !API.upsertTab) return;
  try{ API.upsertTab({ ...tab, status:'open' }); }catch(_){}
}
function flushAllTabs(){ Object.values(state.comandas).forEach(upsertKeepalive); }

function asMapById(list){ const m={}; (list||[]).forEach(t=>{ m[t.id]=t; }); return m; }
async function loadOpenTabsFromServer(){
  if(!BACKEND_ON || !API.tabsOpen) return false;
  try{
    const res  = await API.tabsOpen();
    const tabs = Array.isArray(res.tabs)? res.tabs : [];
    const srv  = asMapById(tabs);
    const loc  = state.comandas;

    // servidor substitui se for mais recente
    Object.keys(srv).forEach(id=>{
      const s = srv[id];
      if(!loc[id] || Number(s.updatedAt||0) >= Number(loc[id].updatedAt||0)){
        loc[id] = { ...s, items: s.items || {}, status: 'open', payMethod: s.payMethod || 'PIX' };
      }
    });
    // locais que não estão no servidor permanecem (serão upsertados via flush)
    if(!state.activeComandaId){
      const ids = Object.keys(loc);
      state.activeComandaId = ids[0] || null;
    }
    persist();
    return true;
  }catch(e){ return false; }
}
function startPolling(){
  if(!BACKEND_ON) return;
  setInterval(async ()=>{
    const ok = await loadOpenTabsFromServer();
    if(ok){
      refreshComandaSelect();
      updateSummaryBar();
    }
  }, 7000);
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
  if(!confirm(`Excluir comanda "${c.name}"?`)) return;
  try{ if(BACKEND_ON && API.deleteTab) await API.deleteTab(c.id); }catch(_){}
  delete state.comandas[c.id];
  state.activeComandaId = Object.keys(state.comandas)[0] || null;
  persist(); refreshComandaSelect(); updateSummaryBar();
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

  // server-first: gera histórico e fecha tab
  if(BACKEND_ON && API.closeComanda){
    try{
      await API.closeComanda({ ...c, service10: state.service10 });
      // removida localmente para sumir da visão geral
      delete state.comandas[c.id];
      state.activeComandaId = Object.keys(state.comandas)[0] || null;
      persist();
      refreshComandaSelect(); updateSummaryBar();
      if($('#drawer')?.classList.contains('open')) $('#drawer').classList.remove('open');
      alert('Comanda fechada e enviada ao histórico.');
      return;
    }catch(e){
      alert('Falha ao fechar no servidor. Mantendo local.');
    }
  }

  // fallback local: apenas limpa/encerra
  delete state.comandas[c.id];
  state.activeComandaId = Object.keys(state.comandas)[0] || null;
  persist();
  refreshComandaSelect(); updateSummaryBar();
  if($('#drawer')?.classList.contains('open')) $('#drawer').classList.remove('open');
}

/* ========= UI: filtros/cards ========= */
function refreshChips(){
  const cont = $('#chips'); if(!cont) return;
  cont.innerHTML = '';
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
  const q = (state.query||'').trim().toLowerCase();
  const byQuery = !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
  return byCat && byQuery;
}
function getQty(productId){
  const c = getActive(); if(!c) return 0;
  return (c.items[productId] && c.items[productId].qty) || 0;
}
function addToComanda(product, qty=1){
  let c = getActive();
  if(!c){
    c = state.comandas[createComanda({
      name:  (state.inlineNew.name||'Mesa 1'),
      label: (state.inlineNew.label||''),
      color: (state.inlineNew.color||'#22c55e')
    })];
  }
  const current = c.items[product.id] || { id:product.id, name:product.name, unit:product.price, qty:0 };
  current.qty += qty;
  if(current.qty<=0) delete c.items[product.id]; else c.items[product.id] = current;
  touchTab(c);
  updateSummaryBar();
}
function renderGrid(){
  const grid = $('#grid'); if(!grid) return;
  const list = state.products.filter(passFilters);
  grid.innerHTML = '';
  list.forEach(p=>{
    const imgSrc = (p.image && p.image.trim()) ? p.image.trim() : './assets/placeholder.svg';
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
    card.querySelector('[data-act="dec"]').onclick=()=>{ input.value=Math.max(0,(parseInt(input.value)||0)-1) };
    card.querySelector('[data-act="inc"]').onclick=()=>{ input.value=Math.max(0,(parseInt(input.value)||0)+1) };
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
  const countEl = $('#summaryCount'), totalEl = $('#summaryTotal');
  if(!countEl || !totalEl) return;
  if(!c){ countEl.textContent='0 itens'; totalEl.textContent=BRL.format(0); return; }
  const t = calc(c);
  countEl.textContent = `${t.count} ${t.count===1?'item':'itens'}`;
  totalEl.textContent = BRL.format(t.total);
}

/* ========= Drawer ========= */
function renderPayMethods(){
  const cont = $('#payMethods'); if(!cont) return;
  cont.innerHTML='';
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
  const c = getActive(); if(!c) return;
  const cont = $('#lines'); const mini = $('#comandaNameMini'); const labMini = $('#comandaLabelMini');
  if(cont) cont.innerHTML = '';
  if(mini) mini.textContent = c ? c.name : '—';
  if(labMini) labMini.innerHTML = c?.label ? `<span class="tag"><span class="dot" style="background:${c.color}"></span>${c.label}</span>` : `<span class="dot" style="background:${c?.color||'#888'}"></span>—`;

  if(cont){
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
  }
  const t = calc(c||{items:{}});
  if($('#subtotalTxt')) $('#subtotalTxt').textContent = BRL.format(t.subtotal);
  if($('#serviceTxt'))  $('#serviceTxt').textContent  = BRL.format(t.service);
  if($('#totalTxt'))    $('#totalTxt').textContent    = BRL.format(t.total);
  const sv = $('#sv10'); if(sv) sv.checked = !!state.service10;
  renderPayMethods();
  togglePixButton();
}
function togglePixButton(){
  const c = getActive(); if(!c) return;
  const btn = $('#pixBtn'); if(!btn) return;
  btn.style.display = (c.payMethod==='PIX') ? '' : 'none';
}

/* ========= Compartilhar / PDF / PIX ========= */
function buildReceiptText(c){
  const {items, subtotal, service, total} = calc(c);
  const lines = [
    `Comanda: ${c.name}` + (c.label?` [${c.label}]`:``),
    `Data: ${new Date().toLocaleString('pt-BR')}`,
    `Pagamento: ${c.payMethod}`,
    '',
    ...items.map(i=>`• ${i.name} — ${i.qty} × ${BRL.format(i.unit)} = ${BRL.format(i.unit*i.qty)}`),
    '',
    `Subtotal: ${BRL.format(subtotal)}`,
    `Serviço (10%): ${BRL.format(service)}`,
    `Total: ${BRL.format(total)}`
  ];
  return lines.join('\n');
}
function shareComanda(){
  const c=getActive(); if(!c) return;
  const text=buildReceiptText(c);
  if(navigator.share){ navigator.share({title:'Comanda', text}).catch(()=>{}); }
  else { navigator.clipboard.writeText(text).then(()=>alert('Resumo copiado!')).catch(()=>alert(text)); }
}
function sanitizeASCII(s=''){ return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,''); }
function emvField(id, value){ const v=String(value); const len=String(v.length).padStart(2,'0'); return `${id}${len}${v}`; }
function crc16(payload){
  let crc=0xFFFF;
  for(let i=0;i<payload.length;i++){
    crc ^= payload.charCodeAt(i)<<8;
    for(let j=0;j<8;j++){ crc = (crc & 0x8000) ? ((crc<<1)^0x1021) : (crc<<1); crc &= 0xFFFF; }
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
function buildPixPayload(amount, txid='COMANDA'){
  const GUI = emvField('00','BR.GOV.BCB.PIX');
  const KEY = emvField('01', PIX_CFG.KEY);
  const DESC = PIX_CFG.DESC ? emvField('02', PIX_CFG.DESC.substring(0,25)) : '';
  const MAI = emvField('26', GUI + KEY + DESC);
  const mcc = emvField('52','0000');
  const cur = emvField('53','986');
  const amt = emvField('54', Number(amount).toFixed(2));
  const cty = emvField('58','BR');
  const name = emvField('59', sanitizeASCII(PIX_CFG.MERCHANT).toUpperCase().substring(0,25) || 'BAR');
  const city = emvField('60', sanitizeASCII(PIX_CFG.CITY).toUpperCase().substring(0,15) || 'BRASIL');
  const tx = emvField('05', (txid||'COMANDA').toString().substring(0,25).replace(/[^A-Za-z0-9.-]/g,'-'));
  const add = emvField('62', tx);
  const pfi = emvField('00','01'); const poi = emvField('01','11');
  const noCRC = pfi + poi + MAI + mcc + cur + amt + cty + name + city + add + '6304';
  const crc = crc16(noCRC);
  return noCRC + crc;
}
function makeQRDataURL(text, size=200){
  return new Promise(resolve=>{
    const tgt = $('#qrHidden'); if(!tgt){ resolve(null); return; }
    tgt.innerHTML='';
    if(typeof QRCode === 'undefined'){ resolve(null); return; }
    new QRCode(tgt, {text, width:size, height:size, correctLevel: (window.QRCode && QRCode.CorrectLevel && QRCode.CorrectLevel.M) || 0});
    setTimeout(()=>{
      const canvas = tgt.querySelector('canvas');
      resolve(canvas ? canvas.toDataURL('image/png') : null);
    }, 120);
  });
}
async function generatePDF(){
  const c=getActive(); if(!c) return alert('Nenhuma comanda ativa.');
  const jspdfNS = (window.jspdf || {});
  const jsPDF = jspdfNS.jsPDF;
  if(typeof jsPDF !== 'function'){ alert('Biblioteca de PDF (jsPDF) não carregada.'); return; }

  const doc = new jsPDF();
  const t = calc(c);
  let y=14;

  doc.setFontSize(14); doc.text('Comanda', 14, y); y+=6;
  doc.setFontSize(11);
  doc.text(`Nome: ${c.name}${c.label?` [${c.label}]`:''}`,14,y); y+=6;
  doc.text(`Data: ${new Date().toLocaleString('pt-BR')}`,14,y); y+=6;
  doc.text(`Pagamento: ${c.payMethod}`,14,y); y+=8;
  doc.setFont(undefined,'bold'); doc.text('Itens',14,y); doc.setFont(undefined,'normal'); y+=6;

  Object.values(c.items).forEach(i=>{
    doc.text(`${i.name}`,14,y);
    doc.text(`${i.qty} × ${BRL.format(i.unit)}`,120,y,{align:'left'});
    doc.text(`${BRL.format(i.unit*i.qty)}`,180,y,{align:'right'});
    y+=6;
    if(y>270){ doc.addPage(); y=14; }
  });
  y+=2; doc.line(14,y,196,y); y+=8;
  doc.text(`Subtotal: ${BRL.format(t.subtotal)}`,14,y); y+=6;
  doc.text(`Serviço (10%): ${BRL.format(t.service)}`,14,y); y+=6;
  doc.setFont(undefined,'bold'); doc.text(`Total: ${BRL.format(t.total)}`,14,y); doc.setFont(undefined,'normal'); y+=10;

  if(c.payMethod==='PIX'){
    const payload = buildPixPayload(t.total, c.id);
    if(payload){
      const dataUrl = await makeQRDataURL(payload, 180);
      if(dataUrl){ doc.text('PIX (pague pelo QR):',14,y); y+=4; doc.addImage(dataUrl,'PNG',14,y,48,48); y+=54; }
    }
  }
  doc.save(`comanda-${c.name.toLowerCase().replace(/\s+/g,'-')}.pdf`);
}

/* ========= Impressão 80mm ========= */
function buildTicketHTML(c, totals, qrDataUrl = null){
  const created = new Date().toLocaleString('pt-BR');
  const itemsRows = Object.values(c.items||{}).map(i=>{
    const line1 = `<tr><td class="qty">${i.qty}x</td><td class="name">${i.name}</td><td class="amt">${BRL.format(i.unit*i.qty)}</td></tr>`;
    const line2 = `<tr><td></td><td class="name muted">(${BRL.format(i.unit)} un)</td><td></td></tr>`;
    return line1 + line2;
  }).join('');
  const qrBlock = (c.payMethod==='PIX' && qrDataUrl)
    ? `<img class="qr" src="${qrDataUrl}" alt="QR PIX"><div class="payload">${buildPixPayload(totals.total, c.id)}</div>`
    : '';
  return `
    <div class="ticket">
      <div class="title">${sanitizeASCII(PIX_CFG.MERCHANT)}</div>
      <div class="meta">
        COMANDA: ${sanitizeASCII(c.name)}${c.label?` [${sanitizeASCII(c.label)}]`:''}<br/>
        DATA: ${created}<br/>
        PAGAMENTO: ${sanitizeASCII(c.payMethod)}
      </div>
      <div class="sep"></div>
      <table class="items">${itemsRows}</table>
      <div class="sep"></div>
      <div class="totals">
        <div class="row"><span>Subtotal</span><strong>${BRL.format(totals.subtotal)}</strong></div>
        <div class="row"><span>Serviço (10%)</span><strong>${BRL.format(totals.service)}</strong></div>
        <div class="row"><span>Total</span><strong>${BRL.format(totals.total)}</strong></div>
      </div>
      ${qrBlock}
      <div class="sep"></div>
      <div class="footer">Obrigado e volte sempre!</div>
      <div style="height:8mm"></div>
    </div>
  `;
}
async function printThermal80(){
  const c = getActive(); if(!c) return alert('Nenhuma comanda ativa.');
  const t = calc(c);
  let qrDataUrl = null;
  if(c.payMethod==='PIX'){
    const payload = buildPixPayload(t.total, c.id);
    qrDataUrl = payload ? await makeQRDataURL(payload, 260) : null;
  }
  const html = buildTicketHTML(c, t, qrDataUrl);
  const w = window.open('', 'PRINT', 'width=420,height=720');
  if(!w){ alert('Pop-up bloqueado. Permita pop-ups para imprimir.'); return; }
  w.document.write(`<!doctype html><html><head>
    <meta charset="utf-8"><title>Imprimir Cupom</title>
    <link rel="stylesheet" href="./assets/print.css">
    <style>body{background:#fff}</style></head><body>${html}</body></html>`);
  w.document.close();
  const doPrint = () => { try{ w.focus(); w.print(); }catch(e){} setTimeout(()=>{ try{ w.close(); }catch(e){} }, 200); };
  const imgs = w.document.images;
  if(imgs.length){
    let loaded = 0;
    for(const img of imgs){ img.onload = img.onerror = () => { loaded++; if(loaded===imgs.length) doPrint(); }; }
    setTimeout(doPrint, 1500);
  } else { doPrint(); }
}

/* ========= Visão geral ========= */
function renderOverview(){
  const board = $('#board'); if(!board){ return; }
  board.innerHTML='';
  const ids = Object.keys(state.comandas);
  if(ids.length===0){ board.innerHTML='<div class="muted">Nenhuma comanda.</div>'; return; }
  ids.forEach(id=>{
    const c = state.comandas[id]; const t = calc(c);
    const div = document.createElement('div'); div.className='tile';
    div.innerHTML = `
      <div class="flex">
        <div><span class="dot" style="background:${c.color};vertical-align:middle"></span> <strong>${c.name}</strong></div>
        <div class="tag">${c.label||'—'}</div>
      </div>
      <div class="mini" style="margin-top:4px">${t.count} ${t.count===1?'item':'itens'} • ${BRL.format(t.total)} • ${c.payMethod}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn" data-open>Abrir</button>
        <button class="btn" data-clear>Limpar</button>
        <button class="btn danger" data-del>Excluir</button>
      </div>`;
    div.querySelector('[data-open]').onclick=()=>{ setActive(id); const m=$('#overviewModal'); if(m) m.classList.remove('open'); updateSummaryBar(); };
    div.querySelector('[data-clear]').onclick=()=>{ state.comandas[id].items={}; touchTab(state.comandas[id]); renderOverview(); updateSummaryBar(); };
    div.querySelector('[data-del]').onclick=async()=>{ if(confirm(`Excluir ${c.name}?`)){ delete state.comandas[id]; persist(); renderOverview(); refreshComandaSelect(); updateSummaryBar(); } };
    board.appendChild(div);
  });
}

/* ========= Histórico ========= */
async function openHistory(){
  if(!(BACKEND_ON && API.history)){ alert('Histórico indisponível (backend OFF).'); return; }
  try{
    const r = await API.history();
    state.historyCache = Array.isArray(r.history) ? r.history : [];
    renderHistory();
    $('#historyModal')?.classList.add('open');
  }catch(e){
    alert('Falha ao carregar histórico.');
  }
}
function renderHistory(){
  const cont = $('#historyContainer'); if(!cont) return;
  cont.innerHTML = '';
  const arr = state.historyCache;
  if(!arr.length){ cont.innerHTML='<div class="muted">Sem registros.</div>'; return; }
  arr.forEach(rec=>{
    const when = new Date(rec.closedAt || rec.createdAt || Date.now()).toLocaleString('pt-BR');
    const div = document.createElement('div');
    div.className='card';
    div.innerHTML = `
      <div class="flex">
        <strong>#${String(rec.number||'').toString().padStart(6,'0')} — ${rec.name||'—'}</strong>
        <span class="tag">${rec.payMethod||'—'}</span>
      </div>
      <div class="mini" style="margin-top:4px">${when}</div>
      <div class="mini">Total: <strong>${BRL.format(Number(rec.total||0))}</strong> • Itens: ${rec.items?rec.items.length:0}</div>
    `;
    cont.appendChild(div);
  });
}
function exportHistoryCSV(){
  const rows = [
    ['numero','comandaId','nome','etiqueta','pagamento','subtotal','servico','total','createdAt','closedAt']
  ];
  (state.historyCache||[]).forEach(r=>{
    rows.push([
      r.number, r.comandaId, r.name, r.label, r.payMethod,
      Number(r.subtotal||0), Number(r.service||0), Number(r.total||0),
      r.createdAt ? new Date(r.createdAt).toISOString() : '',
      r.closedAt  ? new Date(r.closedAt ).toISOString() : ''
    ]);
  });
  const csv = rows.map(l=>l.map(v=>{
    const s = (v==null?'':String(v));
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  }).join(';')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'historico.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
function exportHistoryPDF(){
  const jspdfNS = (window.jspdf || {}); const jsPDF = jspdfNS.jsPDF;
  if(typeof jsPDF !== 'function'){ alert('Biblioteca de PDF (jsPDF) não carregada.'); return; }
  const doc = new jsPDF({orientation:'landscape'});
  doc.setFontSize(12);
  doc.text('Histórico de Comandas', 14, 14);
  let y = 22;
  const header = ['#','Nome','Pgto','Subtotal','Serviço','Total','Fechado'];
  doc.text(header.join('  |  '), 14, y); y += 6;
  (state.historyCache||[]).forEach(r=>{
    const line = [
      String(r.number||'').padStart(6,'0'),
      r.name||'—',
      r.payMethod||'—',
      BRL.format(Number(r.subtotal||0)),
      BRL.format(Number(r.service ||0)),
      BRL.format(Number(r.total   ||0)),
      r.closedAt ? new Date(r.closedAt).toLocaleString('pt-BR') : ''
    ].join('  |  ');
    doc.text(line, 14, y); y += 6;
    if(y > 195){ doc.addPage(); y = 20; }
  });
  doc.save('historico.pdf');
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
function initInlineNew(){
  const pal = ['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#e11d48','#10b981','#a3e635','#f97316'];
  const sw = $('#ncColors'); if(sw){ sw.innerHTML=''; }
  pal.forEach((c,i)=>{
    if(!sw) return;
    const el=document.createElement('div'); el.className='swatch'; el.style.background=c;
    if(i===0){ state.inlineNew.color = c; el.style.outline='3px solid #fff5'; }
    el.onclick=()=>{
      state.inlineNew.color = c;
      sw.querySelectorAll('.swatch').forEach(s=> s.style.outline='none');
      el.style.outline='3px solid #fff5';
    };
    sw.appendChild(el);
  });
  const nameI=$('#ncName'); const labelI=$('#ncLabel'); const addB=$('#ncAdd');
  if(nameI){ nameI.value = state.inlineNew.name; nameI.oninput = e=> state.inlineNew.name = e.target.value; }
  if(labelI){ labelI.value = state.inlineNew.label; labelI.oninput = e=> state.inlineNew.label = e.target.value; }
  if(addB){
    addB.onclick = ()=>{
      const name = (state.inlineNew.name||'').trim() || `Mesa ${Object.keys(state.comandas).length+1}`;
      const label = (state.inlineNew.label||'').trim();
      const color = state.inlineNew.color || '#3b82f6';
      const id = createComanda({name,label,color});
      refreshComandaSelect();
      const sel = $('#comandaSelect'); if(sel) sel.value = id;
      alert('Comanda criada.');
    };
  }
}
function bindGlobalEvents(){
  // Abrir comanda (existem 2 botões com mesmo id)
  $$('#openDrawer').forEach(btn=>{
    btn.addEventListener('click', ()=>{ const d=$('#drawer'); if(d){ d.classList.add('open'); renderDrawer(); } });
  });
  $('#closeDrawer')?.addEventListener('click', ()=> $('#drawer')?.classList.remove('open'));

  $('#bigTouchBtn')?.addEventListener('click', ()=>{ state.bigTouch=!state.bigTouch; persist(); applyBigTouch(); });
  $('#deleteComandaBtn')?.addEventListener('click', deleteActive);
  $('#comandaSelect')?.addEventListener('change', e=> setActive(e.target.value));
  $('#search')?.addEventListener('input', e=>{ state.query=e.target.value; renderGrid(); });
  $('#clearSearch')?.addEventListener('click', ()=>{ const s=$('#search'); if(s){ s.value=''; } state.query=''; renderGrid(); });

  $('#overviewBtn')?.addEventListener('click', ()=>{ renderOverview(); $('#overviewModal')?.classList.add('open'); });
  $('#closeOverviewBtn')?.addEventListener('click', ()=> $('#overviewModal')?.classList.remove('open'));

  // Novo: Histórico
  $('#historyBtn')?.addEventListener('click', openHistory);
  $('#closeHistoryBtn')?.addEventListener('click', ()=> $('#historyModal')?.classList.remove('open'));
  $('#exportHistCsvBtn')?.addEventListener('click', exportHistoryCSV);
  $('#exportHistPdfBtn')?.addEventListener('click', exportHistoryPDF);

  $('#sv10')?.addEventListener('change', e=>{ state.service10 = !!e.target.checked; persist(); const c=getActive(); if(c){ touchTab(c); } renderDrawer(); updateSummaryBar(); });
  $('#shareBtn')?.addEventListener('click', shareComanda);
  $('#pdfBtn')?.addEventListener('click', generatePDF);
  $('#print80Btn')?.addEventListener('click', printThermal80);
  $('#clearItemsBtn')?.addEventListener('click', ()=>{ if(confirm('Limpar todos os itens?')) clearItems(); });
  $('#closeComandaBtn')?.addEventListener('click', closeComanda);

  $('#pixBtn')?.addEventListener('click', async ()=>{
    const c=getActive(); if(!c) return;
    const t=calc(c); const payload = buildPixPayload(t.total, c.id);
    const box = $('#pixQR'); if(box){ box.innerHTML=''; if(typeof QRCode !== 'undefined'){ new QRCode(box, {text: payload, width:220, height:220, correctLevel: (window.QRCode && QRCode.CorrectLevel && QRCode.CorrectLevel.M) || 0}); } }
    const input = $('#pixPayload'); if(input){ input.value = payload; }
    $('#pixModal')?.classList.add('open');
  });
  $('#closePixBtn')?.addEventListener('click', ()=> $('#pixModal')?.classList.remove('open'));
  $('#copyPixBtn')?.addEventListener('click', ()=>{ const t=$('#pixPayload'); if(t){ t.select(); document.execCommand('copy'); alert('Código PIX copiado!'); } });

  // fechar modais ao clicar no backdrop
  $$('.modal').forEach(m=> m.addEventListener('click', (ev)=>{ if(ev.target===m) m.classList.remove('open'); }));

  // flush ao sair/ocultar
  window.addEventListener('beforeunload', flushAllTabs);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) flushAllTabs(); });
}
function applyBigTouch(){
  document.body.classList.toggle('big-touch', !!state.bigTouch);
  const b = $('#bigTouchBtn');
  if(b){ b.textContent = state.bigTouch ? 'Toque grande: ON' : 'Toque grande'; b.setAttribute('aria-pressed', state.bigTouch?'true':'false'); }
}

/* ========= Boot ========= */
async function boot(){
  loadPersisted();
  await refreshHealth();
  await loadProducts();
  await loadOpenTabsFromServer();

  if(!state.activeComandaId){
    createComanda({name:'Mesa 1', color:'#22c55e'});
  }

  applyBigTouch();
  refreshChips(); refreshComandaSelect(); renderGrid(); updateSummaryBar();
  initInlineNew(); bindGlobalEvents(); startPolling();
}
document.addEventListener('DOMContentLoaded', boot);