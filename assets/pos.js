/* ========= Configurações fixas ========= */
const PIX_CFG = {
  KEY: 'edab0cd5-ecd4-4050-87f7-fbaf98899713',
  MERCHANT: 'GIGABITEN',
  CITY: 'BRASIL',
  DESC: 'COMANDA'
};
const PAYMENT_METHODS = ['PIX', 'Cartão de Débito', 'Cartão de Crédito'];

/* ========= Utilidades ========= */
const BRL = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2,10);
const sum = arr => arr.reduce((a,b)=>a+b,0);

/* ========= LocalStorage Keys ========= */
const LS_KEYS = {
  COMANDAS: 'comandas_v3',
  ACTIVE: 'activeComandaId_v3',
  PRODUCTS: 'products_cache_v1',
  SERVICE: 'service10_v1',
  BIGTOUCH: 'ui_big_touch_v1'
};

/* ========= Estado ========= */
let state = {
  products: [],
  categories: [],
  filterCat: 'Todos',
  query: '',
  comandas: {},
  activeComandaId: null,
  service10: JSON.parse(localStorage.getItem(LS_KEYS.SERVICE) || 'false'),
  bigTouch: localStorage.getItem(LS_KEYS.BIGTOUCH) === '1'
};

/* ========= Persistência ========= */
function loadPersisted(){
  try{
    const c = JSON.parse(localStorage.getItem(LS_KEYS.COMANDAS) || '{}');
    const a = localStorage.getItem(LS_KEYS.ACTIVE);
    state.comandas = c;
    state.activeComandaId = (a && c[a]) ? a : null;
  }catch(e){}
}
function persist(){
  localStorage.setItem(LS_KEYS.COMANDAS, JSON.stringify(state.comandas));
  localStorage.setItem(LS_KEYS.ACTIVE, state.activeComandaId || '');
  localStorage.setItem(LS_KEYS.SERVICE, JSON.stringify(state.service10));
  localStorage.setItem(LS_KEYS.BIGTOUCH, state.bigTouch ? '1' : '0');
}

/* ========= Produtos ========= */
async function loadProducts(){
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

/* ========= Comandas ========= */
function createComanda({name,label,color}){
  const id = uid();
  state.comandas[id] = {
    id, name, label: label || '', color: color || '#3b82f6',
    createdAt: Date.now(), payMethod: 'PIX', items:{}
  };
  state.activeComandaId = id;
  persist(); refreshComandaSelect(); updateSummaryBar();
  return id;
}
function getActive(){ return state.activeComandaId ? state.comandas[state.activeComandaId] : null; }
function setActive(id){ state.activeComandaId = id; persist(); updateSummaryBar(); }
function deleteActive(){
  const c = getActive(); if(!c) return;
  if(confirm(`Excluir comanda "${c.name}"?`)){
    delete state.comandas[c.id];
    state.activeComandaId = Object.keys(state.comandas)[0] || null;
    persist(); refreshComandaSelect(); updateSummaryBar();
  }
}
function clearItems(){
  const c = getActive(); if(!c) return;
  c.items = {}; persist(); updateSummaryBar(); if($('#drawer').classList.contains('open')) renderDrawer();
}
function closeComanda(){
  const c = getActive(); if(!c) return;
  if(confirm(`Fechar comanda "${c.name}"? Isto zera os itens.`)){
    c.items = {}; persist(); updateSummaryBar(); if($('#drawer').classList.contains('open')) renderDrawer();
  }
}

/* ========= UI: Filtros/Cards ========= */
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
  if(!c){ c = state.comandas[createComanda({name:'Mesa 1',color:'#22c55e'})]; }
  const current = c.items[product.id] || { id:product.id, name:product.name, unit:product.price, qty:0 };
  current.qty += qty;
  if(current.qty<=0) delete c.items[product.id]; else c.items[product.id] = current;
  persist(); updateSummaryBar();
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
    card.querySelector('[data-act="dec"]').onclick=()=>{input.value=Math.max(0,(parseInt(input.value)||0)-1)};
    card.querySelector('[data-act="inc"]').onclick=()=>{input.value=Math.max(0,(parseInt(input.value)||0)+1)};
    input.onfocus=()=>input.select();
    card.querySelector('[data-add]').onclick=()=>{
      const q=Math.max(1,parseInt(input.value)||0); addToComanda(p,q); input.value=getQty(p.id);
    };
    grid.appendChild(card);
  });
}

/* ========= Bottom bar ========= */
function calc(c){
  const items = Object.values(c.items||{});
  const subtotal = sum(items.map(i=>i.unit*i.qty));
  const service = state.service10 ? subtotal*0.10 : 0;
  const total = subtotal + service;
  const count = sum(items.map(i=>i.qty));
  return {items, subtotal, service, total, count};
}
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
      persist();
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
      line.querySelector('[data-dec]').onclick=()=>{ i.qty=Math.max(0,i.qty-1); if(i.qty===0) delete c.items[i.id]; persist(); renderDrawer(); updateSummaryBar(); };
      line.querySelector('[data-inc]').onclick=()=>{ i.qty+=1; persist(); renderDrawer(); updateSummaryBar(); };
      cont.appendChild(line);
    });
  }
  const t = calc(c||{items:{}});
  $('#subtotalTxt').textContent = BRL.format(t.subtotal);
  $('#serviceTxt').textContent = BRL.format(t.service);
  $('#totalTxt').textContent = BRL.format(t.total);
  $('#sv10').checked = state.service10;
  renderPayMethods();
  togglePixButton();
}
function togglePixButton(){
  const c = getActive(); if(!c) return;
  $('#pixBtn').style.display = (c.payMethod==='PIX') ? '' : 'none';
}

/* ========= Compartilhar/PDF ========= */
function buildReceiptText(c){
  const {items, subtotal, service, total} = calc(c);
  const lines = [
    `Comanda: ${c.name}` + (c.label?` [${c.label}]`:''),
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
async function generatePDF(){
  const c=getActive(); if(!c) return alert('Nenhuma comanda ativa.');
  const { jsPDF } = window.jspdf;
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

/* ========= PIX ========= */
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
function showPixModal(total){
  const c=getActive(); if(!c) return;
  const payload = buildPixPayload(total, c.id);
  if(!payload){ alert('Configuração PIX inválida.'); return; }
  const cont = $('#pixQR'); cont.innerHTML='';
  new QRCode(cont, {text: payload, width:220, height:220, correctLevel: QRCode.CorrectLevel.M});
  $('#pixPayload').value = payload;
  $('#pixModal').classList.add('open');
}
function copyPix(){
  const t=$('#pixPayload'); t.select(); document.execCommand('copy'); alert('Código PIX copiado!');
}
function makeQRDataURL(text, size=200){
  return new Promise(resolve=>{
    const tgt = $('#qrHidden'); tgt.innerHTML='';
    new QRCode(tgt, {text, width:size, height:size, correctLevel: QRCode.CorrectLevel.M});
    setTimeout(()=>{
      const canvas = tgt.querySelector('canvas');
      resolve(canvas ? canvas.toDataURL('image/png') : null);
    }, 120);
  });
}

/* ========= Visão geral ========= */
function renderOverview(){
  const board = $('#board'); board.innerHTML='';
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
    div.querySelector('[data-open]').onclick=()=>{ setActive(id); $('#overviewModal').classList.remove('open'); updateSummaryBar(); };
    div.querySelector('[data-clear]').onclick=()=>{ state.comandas[id].items={}; persist(); renderOverview(); updateSummaryBar(); };
    div.querySelector('[data-del]').onclick=()=>{ if(confirm(`Excluir ${c.name}?`)){ delete state.comandas[id]; persist(); renderOverview(); refreshComandaSelect(); updateSummaryBar(); } };
    board.appendChild(div);
  });
}

/* ========= Impressão térmica 80mm ========= */
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

/* ========= Controles ========= */
function refreshComandaSelect(){
  const sel = $('#comandaSelect'); sel.innerHTML='';
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
function openNewModal(){
  $('#newModal').classList.add('open');
  const pal = ['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#e11d48','#10b981','#a3e635','#f97316'];
  const sw = $('#newColorSwatches'); sw.innerHTML='';
  pal.forEach(c=>{
    const el=document.createElement('div'); el.className='swatch'; el.style.background=c;
    el.onclick=()=>{ sw.dataset.selected=c; sw.querySelectorAll('.swatch').forEach(s=>s.style.outline='none'); el.style.outline='3px solid #fff5'; };
    sw.appendChild(el);
  });
  sw.dataset.selected = pal[0];
}
function confirmNewComanda(){
  const name = $('#newName').value.trim() || `Mesa ${Object.keys(state.comandas).length+1}`;
  const label = $('#newLabel').value.trim();
  const color = $('#newColorSwatches').dataset.selected || '#3b82f6';
  createComanda({name,label,color});
  $('#newModal').classList.remove('open');
  $('#newName').value=''; $('#newLabel').value='';
  refreshComandaSelect();
}
function setActiveColor(){
  const c=getActive(); if(!c) return;
  const pal=['#3b82f6','#22c55e','#ef4444','#f59e0b','#8b5cf6','#06b6d4','#e11d48','#10b981','#a3e635','#f97316'];
  const current = prompt(`Informe a cor (hex) ou escolha: \n${pal.join(' ')}`, c.color);
  if(current){ c.color=current; persist(); renderDrawer(); renderOverview(); }
}

/* Importar produtos */
function importProductsFromFile(f){
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const arr = JSON.parse(e.target.result);
      if(!Array.isArray(arr)) throw new Error('JSON precisa ser um array');
      localStorage.setItem(LS_KEYS.PRODUCTS, JSON.stringify(arr));
      state.products = arr;
      state.categories = ['Todos', ...Array.from(new Set(arr.map(p=>p.category)))];
      refreshChips(); renderGrid();
      alert('Produtos importados!');
    }catch(err){ alert('Erro ao importar: '+err.message); }
  };
  reader.readAsText(f);
}

/* Modo toque grande */
function applyBigTouch(){
  document.body.classList.toggle('big-touch', !!state.bigTouch);
  const b = $('#bigTouchBtn');
  if(b){ b.textContent = state.bigTouch ? 'Toque grande: ON' : 'Toque grande'; b.setAttribute('aria-pressed', state.bigTouch?'true':'false'); }
}

/* Boot */
function bindEvents(){
  $('#bigTouchBtn').onclick = ()=>{ state.bigTouch = !state.bigTouch; persist(); applyBigTouch(); };

  $('#newComandaBtn').onclick = openNewModal;
  $('#cancelNew').onclick = ()=>$('#newModal').classList.remove('open');
  $('#createComandaConfirm').onclick = confirmNewComanda;
  $('#deleteComandaBtn').onclick = deleteActive;
  $('#comandaSelect').onchange = e=> setActive(e.target.value);

  $('#search').oninput = e=>{ state.query=e.target.value; renderGrid(); };
  $('#clearSearch').onclick = ()=>{ $('#search').value=''; state.query=''; renderGrid(); };

  $('#openDrawer').onclick = ()=>{ $('#drawer').classList.add('open'); renderDrawer(); };
  $('#closeDrawer').onclick = ()=>$('#drawer').classList.remove('open');
  $('#colorBtn').onclick = setActiveColor;

  $('#sv10').onchange = e=>{ state.service10 = e.target.checked; persist(); renderDrawer(); updateSummaryBar(); };

  $('#shareBtn').onclick = shareComanda;
  $('#pdfBtn').onclick = generatePDF;
  $('#print80Btn').onclick = printThermal80;
  $('#clearItemsBtn').onclick = ()=>{ if(confirm('Limpar todos os itens?')) clearItems(); };
  $('#closeComandaBtn').onclick = closeComanda;

  $('#pixBtn').onclick = ()=>{
    const c=getActive(); if(!c) return;
    const t=calc(c); showPixModal(t.total);
  };
  $('#closePixBtn').onclick = ()=>$('#pixModal').classList.remove('open');
  $('#copyPixBtn').onclick = copyPix;

  $('#overviewBtn').onclick = ()=>{ renderOverview(); $('#overviewModal').classList.add('open'); };
  $('#closeOverviewBtn').onclick = ()=>$('#overviewModal').classList.remove('open');

  $('#importProductsBtn').onclick = ()=> $('#importFile').click();
  $('#importFile').addEventListener('change', e=>{
    const f=e.target.files?.[0]; if(f) importProductsFromFile(f);
    e.target.value='';
  });

  $$('.modal').forEach(m=>{ m.addEventListener('click', (ev)=>{ if(ev.target===m) m.classList.remove('open'); }); });
}
async function boot(){
  loadPersisted();
  await loadProducts();
  applyBigTouch();
  refreshChips(); refreshComandaSelect(); bindEvents(); renderGrid(); updateSummaryBar();
  if(!getActive()){ createComanda({name:'Mesa 1',color:'#22c55e'}); refreshComandaSelect(); }
}
document.addEventListener('DOMContentLoaded', boot);

/* ========= Produtos padrão ========= */
const DEFAULT_PRODUCTS = [
  { id:'cerveja_lata_350', name:'Cerveja Lata 350ml', price:12.00, category:'Cerveja', image:'./assets/placeholder.svg' },
  { id:'cerveja_long_neck', name:'Cerveja Long Neck', price:15.00, category:'Cerveja', image:'./assets/placeholder.svg' },
  { id:'cerveja_balde_6', name:'Balde 6 Cervejas', price:75.00, category:'Cerveja', image:'./assets/placeholder.svg' },
  { id:'dose_vodka', name:'Dose de Vodka', price:18.00, category:'Vodka', image:'./assets/placeholder.svg' },
  { id:'vodka_absolut', name:'Vodka Absolut 1L', price:220.00, category:'Vodka', image:'./assets/placeholder.svg' },
  { id:'dose_whiskey', name:'Dose de Whiskey', price:22.00, category:'Whiskey', image:'./assets/placeholder.svg' },
  { id:'whiskey_jameson', name:'Whiskey Jameson 750ml', price:260.00, category:'Whiskey', image:'./assets/placeholder.svg' },
  { id:'whiskey_jw_black', name:'Johnnie Walker Black 1L', price:320.00, category:'Whiskey', image:'./assets/placeholder.svg' },
  { id:'dose_tequila', name:'Dose de Tequila', price:20.00, category:'Doses', image:'./assets/placeholder.svg' },
  { id:'dose_cachaca', name:'Dose de Cachaça', price:8.00, category:'Doses', image:'./assets/placeholder.svg' },
  { id:'porcao_fritas', name:'Porção de Batata Frita', price:28.00, category:'Comidas', image:'./assets/placeholder.svg' },
  { id:'porcao_frango', name:'Porção de Frango a Passarinho', price:45.00, category:'Comidas', image:'./assets/placeholder.svg' },
  { id:'hamburguer', name:'Hambúrguer Artesanal', price:32.00, category:'Comidas', image:'./assets/placeholder.svg' },
  { id:'porcao_pastel', name:'Porção de Pastel (10 un.)', price:35.00, category:'Comidas', image:'./assets/placeholder.svg' }
];
