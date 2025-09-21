
// ====== DOM ======
const grid = document.getElementById('grid');
const emptyHint = document.getElementById('empty-hint');
const input = document.getElementById('symbol-input');
const addBtn = document.getElementById('add-btn');
const themeBtn = document.getElementById('theme-btn');
const reconnectBtn = document.getElementById('reconnect-btn');
const favBtn = document.getElementById('fav-btn');
const favModal = document.getElementById('fav-modal');
const favClose = document.getElementById('fav-close');
const favList = document.getElementById('fav-list');
const kpiBTC = document.getElementById('kpi-btc-vol');
const kpiETH = document.getElementById('kpi-eth-vol');
const kpiFNG = document.getElementById('kpi-fng');
const fxBox = document.getElementById('fx');
const statusBox = document.getElementById('status');
const sourceName = document.getElementById('source-name');
const filterInput = document.getElementById('filter-input');
const fiatSel = document.getElementById('fiat');
const fxBadge = document.getElementById('fx-badge');
const fxEditBtn = document.getElementById('fx-edit');
const fxModal = document.getElementById('fx-modal');
const fxClose = document.getElementById('fx-close');
const fxInput = document.getElementById('fx-input');
const fxSave = document.getElementById('fx-save');
const fxReset = document.getElementById('fx-reset');
const soundBtn = document.getElementById('sound-btn');
const beep = document.getElementById('beep');

// ====== State ======
let symbols = JSON.parse(localStorage.getItem('symbols')||'[]');
if(!symbols.length) symbols = ['btcusdt','ethusdt','solusdt','adausdt','xrpusdt','dogeusdt'];
let alerts = JSON.parse(localStorage.getItem('alerts')||'{}');
let favorites = JSON.parse(localStorage.getItem('favorites')||'[]');
let muted = JSON.parse(localStorage.getItem('muted')||'false');
let ws = null;
let wsTimer = null;
let state = {};
let lastPrices = {};
let fxRates = JSON.parse(localStorage.getItem('fxRates')||'{"USD":1,"EUR":1,"ARS":1}');
let fxOverride = Number(localStorage.getItem('fxOverrideARS')||'0');
let usingREST = false;
let restInterval = null;

// ====== Utils ======
function saveAll(){
  localStorage.setItem('symbols', JSON.stringify(symbols));
  localStorage.setItem('alerts', JSON.stringify(alerts));
  localStorage.setItem('favorites', JSON.stringify(favorites));
  localStorage.setItem('muted', JSON.stringify(muted));
  localStorage.setItem('fxRates', JSON.stringify(fxRates));
  localStorage.setItem('fxOverrideARS', fxOverride||0);
}
function fmtPrice(n){
  if(n==null||isNaN(n)) return '—';
  const v=Number(n);
  if(v>=100000) return v.toLocaleString(undefined,{maximumFractionDigits:0});
  if(v>=1000) return v.toLocaleString(undefined,{maximumFractionDigits:2});
  if(v>=1) return v.toLocaleString(undefined,{maximumFractionDigits:4});
  return v.toLocaleString(undefined,{maximumFractionDigits:8});
}
function ensureUI(){
  emptyHint.style.display = symbols.length ? 'none':'block';
  soundBtn.textContent = muted ? 'Sonido Off' : 'Sonido On';
  fxBadge.textContent = `FX · ARS ${fxRates.ARS.toFixed(2)} · EUR ${fxRates.EUR.toFixed(2)}`;
  sourceName.textContent = usingREST ? 'Modo seguro (REST)' : 'Binance WebSocket';
}

// ====== Price conversions ======
function fromUSD(amount, fiat){
  if(fiat==='USD') return amount;
  if(fiat==='ARS' && fxOverride>0) return amount*fxOverride;
  return amount*(fxRates[fiat]||1);
}
function toUSD(amount, fiat){
  if(fiat==='USD') return amount;
  const rate = (fiat==='ARS' && fxOverride>0) ? fxOverride : (fxRates[fiat]||1);
  return amount/(rate||1);
}
function refreshAll(){ Object.keys(state).forEach(render); }

// ====== Live via WebSocket ======
function connectWS(){
  usingREST = false; ensureUI();
  if(!symbols.length) return;
  const streams = symbols.map(s=>`${s}@ticker`).join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  if(ws){ try{ws.close();}catch(e){} ws=null; }
  if(restInterval){ clearInterval(restInterval); restInterval=null; }
  statusBox.textContent = 'Conectando…';
  ws = new WebSocket(url);

  ws.onopen = ()=>{
    statusBox.textContent = 'En vivo (WS)';
    if(wsTimer){ clearTimeout(wsTimer); wsTimer=null; }
  };
  ws.onmessage = (ev)=>{
    try{
      const payload = JSON.parse(ev.data);
      const msg = payload.data || payload;
      if(!msg || !msg.s) return;
      const sym = msg.s.toLowerCase();
      const price = Number(msg.c);
      const prev = state[sym]?.spark || [];
      const spark = [...prev,price].slice(-120);
      state[sym] = { msg, spark };
      render(sym);
      priceFlash(sym, price);
      checkAlerts(sym, price);
      if(sym==='btcusdt') kpiBTC.textContent = Number(msg.v||0).toLocaleString();
      if(sym==='ethusdt') kpiETH.textContent = Number(msg.v||0).toLocaleString();
    }catch(e){}
  };
  ws.onerror = ()=>{ switchToREST('Error de WS'); };
  ws.onclose = ()=>{ switchToREST('WS cerrado'); };

  // watchdog: si no abre en 3s, switch
  wsTimer = setTimeout(()=>switchToREST('Timeout de WS'), 3000);
}

function switchToREST(reason){
  if(usingREST) return;
  usingREST = true;
  try{ if(ws){ ws.onopen=ws.onmessage=ws.onerror=ws.onclose=null; ws.close(); } }catch(e){}
  statusBox.textContent = `Modo seguro (REST) — ${reason}`;
  ensureUI();
  // polling cada 2s
  if(restInterval) clearInterval(restInterval);
  const poll = async ()=>{
    try{
      // Intentar endpoint batch; si no, uno por uno
      const symsUpper = symbols.map(s=>s.toUpperCase());
      let ok=false;
      try{
        const url = 'https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symsUpper));
        const res = await fetch(url);
        if(res.ok){
          const arr = await res.json();
          arr.forEach(m=>{
            const sym = m.symbol.toLowerCase();
            const price = Number(m.lastPrice);
            const prev = state[sym]?.spark || [];
            const spark = [...prev,price].slice(-120);
            // adapt fields to WS schema
            const msg = { s: m.symbol, c: m.lastPrice, P: m.priceChangePercent, h: m.highPrice, l: m.lowPrice, v: m.volume };
            state[sym] = { msg, spark };
            render(sym);
            if(sym==='btcusdt') kpiBTC.textContent = Number(m.volume||0).toLocaleString();
            if(sym==='ethusdt') kpiETH.textContent = Number(m.volume||0).toLocaleString();
          });
          ok=true;
        }
      }catch(e){}
      if(!ok){
        // fallback one-by-one or mirror domain
        for(const s of symsUpper){
          let data=null;
          try{
            let r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`);
            if(!r.ok) r = await fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${s}`);
            data = await r.json();
          }catch(e){}
          if(!data) continue;
          const sym = s.toLowerCase();
          const price = Number(data.lastPrice);
          const prev = state[sym]?.spark || [];
          const spark = [...prev,price].slice(-120);
          const msg = { s: s, c: data.lastPrice, P: data.priceChangePercent, h: data.highPrice, l: data.lowPrice, v: data.volume };
          state[sym] = { msg, spark };
          render(sym);
          if(sym==='btcusdt') kpiBTC.textContent = Number(data.volume||0).toLocaleString();
          if(sym==='ethusdt') kpiETH.textContent = Number(data.volume||0).toLocaleString();
        }
      }
    }catch(e){ statusBox.textContent = 'REST: error de red'; }
  };
  poll();
  restInterval = setInterval(poll, 2000);
}

// ====== UI & actions ======
function priceFlash(sym, price){
  const el = document.querySelector(`[data-sym="${sym}"]`);
  const last = lastPrices[sym];
  lastPrices[sym] = price;
  if(!el || last==null) return;
  const up = price>last;
  el.classList.remove('flash-up','flash-down'); void el.offsetWidth;
  el.classList.add(up?'flash-up':'flash-down');
}

function addSymbol(raw){
  const s = (raw||input.value).trim().toLowerCase();
  if(!s) return;
  const normalized = s.endsWith('usdt')?s:`${s}usdt`;
  if(!symbols.includes(normalized)){
    symbols.push(normalized); saveAll(); ensureUI(); mount(normalized);
    if(usingREST){ /* nada */ } else { connectWS(); }
  }
  input.value='';
}

function removeSymbol(sym){
  symbols = symbols.filter(x=>x!==sym);
  delete state[sym]; delete alerts[sym]; saveAll();
  const el = document.querySelector(`[data-sym="${sym}"]`); if(el) el.remove();
  ensureUI(); if(usingREST){ /* polling ya toma lista */ } else { connectWS(); }
}

function mount(sym){
  if(document.querySelector(`[data-sym="${sym}"]`)) return;
  const el = document.createElement('div');
  el.className='card'; el.dataset.sym=sym;
  const favOn = favorites.includes(sym);
  el.innerHTML=`
    <div class="card__head">
      <div><div class="card__meta">BINANCE • 24H</div><div class="card__sym">${sym.toUpperCase()}</div></div>
      <div class="card__actions">
        <button data-act="fav" class="btn btn--ghost" title="Favorito">${favOn?'★':'☆'}</button>
        <button data-act="alert" class="btn btn--primary">Alerta</button>
        <button data-act="remove" class="card__remove" title="Quitar">✕</button>
      </div>
    </div>
    <div class="card__price"><div class="price" data-el="price">—</div><div class="badge" data-el="chg">—</div></div>
    <div class="card__stats">
      <canvas class="spark" data-el="spark"></canvas>
      <div class="stats"><div>24h Alto: <b data-el="high">—</b></div><div>24h Bajo: <b data-el="low">—</b></div><div>Vol: <b data-el="vol">—</b></div></div>
    </div>
    <div class="candles"><canvas class="candles__canvas" data-el="candles"></canvas></div>
    <div class="cmp" data-el="cmp" style="font-size:12px; color:var(--muted)"></div>`;
  el.querySelector('[data-act="remove"]').addEventListener('click',()=>removeSymbol(sym));
  el.querySelector('[data-act="fav"]').addEventListener('click',(e)=>toggleFavorite(sym,e.currentTarget));
  el.querySelector('[data-act="alert"]').addEventListener('click',()=>promptAlert(sym));
  grid.appendChild(el);
  loadComparators(sym); loadCandles(sym,'24h');
}

function toggleFavorite(sym, btnEl){
  if(favorites.includes(sym)) favorites = favorites.filter(x=>x!==sym);
  else favorites.push(sym);
  if(btnEl){ btnEl.textContent = favorites.includes(sym)?'★':'☆'; }
  saveAll(); renderFavorites();
}

function promptAlert(sym){
  const fiat = fiatSel.value;
  const val = prompt(`Crear alerta para ${sym.toUpperCase()} en ${fiat}. Ingresá el valor:`);
  if(!val) return; const price = Number(val); if(isNaN(price)) return;
  alerts[sym] = toUSD(price, fiat); saveAll();
  alert(`Alerta creada: ${sym.toUpperCase()} @ ${fmtPrice(price)} ${fiat}`);
  Notification.requestPermission && Notification.requestPermission();
}

function checkAlerts(sym, priceUSD){
  const targetUSD = alerts[sym]; if(!targetUSD) return;
  const crossed = (priceUSD>=targetUSD && (!lastPrices[sym] || lastPrices[sym]<targetUSD)) ||
                  (priceUSD<=targetUSD && (!lastPrices[sym] || lastPrices[sym]>targetUSD));
  if(crossed){
    try{ if(!muted){ beep.currentTime=0; beep.play(); } }catch(e){}
    const fiat = fiatSel.value; const pFiat = fromUSD(priceUSD, fiat);
    if('Notification' in window && Notification.permission==='granted'){
      new Notification(`${sym.toUpperCase()} cruzó tu alerta`, { body:`Ahora: ${fmtPrice(pFiat)} ${fiat}` });
    }else{ alert(`${sym.toUpperCase()} cruzó tu alerta. Ahora: ${fmtPrice(pFiat)} ${fiat}`); }
    delete alerts[sym]; saveAll();
  }
}

// ====== Rendering ======
function render(sym){
  const el = document.querySelector(`[data-sym="${sym}"]`) || (mount(sym), document.querySelector(`[data-sym="${sym}"]`));
  const m = state[sym]?.msg; if(!m) return;
  const spark = state[sym]?.spark || [];
  const priceEl = el.querySelector('[data-el="price"]');
  const chgEl = el.querySelector('[data-el="chg"]');
  const highEl = el.querySelector('[data-el="high"]');
  const lowEl = el.querySelector('[data-el="low"]');
  const volEl = el.querySelector('[data-el="vol"]');
  const sparkEl = el.querySelector('[data-el="spark"]');

  const priceUSD = Number(m.c);
  const chg = Number(m.P);
  const highUSD = Number(m.h);
  const lowUSD = Number(m.l);
  const vol = Number(m.v);
  const up = chg>=0;

  const fiat = fiatSel.value || 'USD';
  const show = fromUSD(priceUSD, fiat);

  priceEl.textContent = `${fmtPrice(show)} ${fiat}`;
  chgEl.textContent = `${up?'▲':'▼'} ${chg.toFixed(2)}%`;
  chgEl.className = `badge ${up?'badge--up':'badge--down'}`;
  highEl.textContent = fmtPrice(fromUSD(highUSD, fiat));
  lowEl.textContent = fmtPrice(fromUSD(lowUSD, fiat));
  volEl.textContent = isNaN(vol)?'—':vol.toLocaleString();

  drawSpark(sparkEl, state[sym].spark, up);
}

function drawSpark(canvas, points, up){
  const w = canvas.width = 160, h = canvas.height = 46;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,w,h);
  if(!points.length) return;
  const min = Math.min(...points), max = Math.max(...points), span = (max-min)||1, step = w/Math.max(1,points.length-1);
  ctx.lineWidth = 2; ctx.strokeStyle = up ? '#16a34a' : '#dc2626'; ctx.beginPath();
  points.forEach((p,i)=>{ const x=i*step; const y=h-((p-min)/span)*h; if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
  ctx.stroke();
}

// ====== Extras ======
async function loadCandles(sym, period){
  const el = document.querySelector(`[data-sym="${sym}"] [data-el="candles"]`);
  let interval='15m', limit=96; if(period==='7d'){ interval='1h'; limit=168; }
  const url = `https://api.binance.com/api/v3/klines?symbol=${sym.toUpperCase()}&interval=${interval}&limit=${limit}`;
  try{ const res = await fetch(url); const rows = await res.json();
    const candles = rows.map(r=>({t:r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]})); drawCandles(el, candles);
  }catch(e){ /* si falla queda vacío, no rompe */ }
}
function drawCandles(canvas, candles){
  const w = canvas.width = canvas.clientWidth || 300, h = canvas.height = 150;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,w,h); if(!candles.length) return;
  const lows = candles.map(c=>c.l), highs=candles.map(c=>c.h);
  const min = Math.min(...lows), max = Math.max(...highs), span = (max-min)||1, cw = Math.max(2, w/candles.length - 2);
  candles.forEach((c,i)=>{ const x=i*(cw+2)+1;
    const y1=h-((c.h-min)/span)*h; const y2=h-((c.l-min)/span)*h;
    const yOpen=h-((c.o-min)/span)*h, yClose=h-((c.c-min)/span)*h; const up = c.c >= c.o;
    ctx.strokeStyle = up ? '#16a34a' : '#dc2626'; ctx.fillStyle = up ? '#16a34a' : '#dc2626';
    ctx.beginPath(); ctx.moveTo(x+cw/2,y1); ctx.lineTo(x+cw/2,y2); ctx.stroke();
    const rectY = Math.min(yOpen,yClose), rectH = Math.max(1, Math.abs(yClose - yOpen)); ctx.fillRect(x, rectY, cw, rectH);
  });
}

async function loadComparators(sym){
  const el = document.querySelector(`[data-sym="${sym}"] [data-el="cmp"]`);
  const base = sym.replace('usdt','').toUpperCase(); const out = [];
  try{ const r1 = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${base}USDT`); const j1 = await r1.json(); out.push(`Binance: ${fmtPrice(Number(j1.price))} USDT`);}catch(e){}
  try{ const r2 = await fetch(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${base}-USDT`); const j2 = await r2.json(); const p2 = Number(j2?.data?.price); if(p2) out.push(`KuCoin: ${fmtPrice(p2)} USDT`);}catch(e){}
  try{ const krPair = base==='BTC'?'XXBTZUSD': base==='ETH'?'XETHZUSD': `${base}USD`; const r3 = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${krPair}`); const j3 = await r3.json(); const firstKey = Object.keys(j3.result||{})[0]; const p3 = Number(j3.result?.[firstKey]?.c?.[0]); if(p3) out.push(`Kraken: ${fmtPrice(p3)} USD`);}catch(e){}
  el.textContent = out.join(' · ');
}

async function loadFX(){
  try{
    const r = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=EUR,ARS');
    const j = await r.json();
    if(j && j.rates){ fxRates.EUR = Number(j.rates.EUR)||fxRates.EUR; fxRates.ARS = Number(j.rates.ARS)||fxRates.ARS; }
  }catch(e){}
  try{
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    if(j && j.rates){ fxRates.EUR = Number(j.rates.EUR)||fxRates.EUR; fxRates.ARS = Number(j.rates.ARS)||fxRates.ARS; }
  }catch(e){}
  saveAll();
  fxBadge.textContent = `FX · ARS ${fxRates.ARS.toFixed(2)} · EUR ${fxRates.EUR.toFixed(2)}`;
  fxBox.textContent = `EUR ${fxRates.EUR.toFixed(2)} · ARS ${Math.round(fxRates.ARS).toLocaleString()}`;
  refreshAll();
}

// ====== Favorites modal ======
function renderFavorites(){
  favList.innerHTML='';
  if(!favorites.length){ const p=document.createElement('p'); p.textContent='No hay favoritos.'; favList.appendChild(p); return; }
  favorites.forEach(sym=>{
    const row=document.createElement('div'); row.className='fav-item';
    row.innerHTML=`<div>${sym.toUpperCase()}</div><div><button data-sym="${sym}" class="btn btn--primary">Cargar</button> <button data-sym="${sym}" class="btn btn--ghost">Quitar</button></div>`;
    const [loadBtn, delBtn] = row.querySelectorAll('button');
    loadBtn.addEventListener('click',()=>{ if(!symbols.includes(sym)) addSymbol(sym); favModal.close(); const card = document.querySelector(\`[data-sym="\${sym}"]\`); if(card) card.scrollIntoView({behavior:'smooth', block:'center'}); });
    delBtn.addEventListener('click',()=>{ favorites=favorites.filter(x=>x!==sym); saveAll(); renderFavorites(); document.querySelectorAll(\`[data-sym="\${sym}"] [data-act="fav"]\`).forEach(b=>b.textContent='☆'); });
    favList.appendChild(row);
  });
}

// ====== Events ======
addBtn.addEventListener('click',()=>addSymbol());
input.addEventListener('keydown',(e)=>{ if(e.key==='Enter') addSymbol(); });
themeBtn.addEventListener('click',()=>{ const html = document.documentElement; const next = html.getAttribute('data-theme')==='dark'?'light':'dark'; html.setAttribute('data-theme', next); localStorage.setItem('theme', next); });
reconnectBtn.addEventListener('click',()=>connectWS());
soundBtn.addEventListener('click',()=>{ muted = !muted; saveAll(); ensureUI(); if(!muted){ try{ beep.currentTime=0; beep.play(); }catch(e){} } });
favBtn.addEventListener('click',()=>{ favModal.showModal(); renderFavorites(); });
favClose.addEventListener('click',()=>favModal.close());
filterInput.addEventListener('input',()=>{ const q = filterInput.value.trim().toLowerCase(); document.querySelectorAll('.card').forEach(el=>{ const sym = el.dataset.sym; el.style.display = sym.includes(q) ? '' : 'none'; }); });
fiatSel.addEventListener('change',()=>{ const fiat=fiatSel.value; if(fiat!=='USD' && ((fiat==='ARS' && !fxOverride && (!fxRates.ARS || fxRates.ARS===1)) || (fiat==='EUR' && (!fxRates.EUR || fxRates.EUR===1)))){ loadFX(); } refreshAll(); });
fxEditBtn.addEventListener('click',()=>{ fxInput.value = fxOverride || fxRates.ARS || 0; fxModal.showModal(); });
fxClose.addEventListener('click',()=>fxModal.close());
fxReset.addEventListener('click',()=>{ fxOverride = 0; saveAll(); fxModal.close(); ensureUI(); refreshAll(); });
fxSave.addEventListener('click',()=>{ const v = Number(fxInput.value); if(!isNaN(v) && v>0){ fxOverride = v; saveAll(); fxModal.close(); ensureUI(); refreshAll(); }});

// ====== Boot ======
(function boot(){
  const theme = localStorage.getItem('theme')||'light'; document.documentElement.setAttribute('data-theme', theme);
  ensureUI(); symbols.forEach(mount); connectWS(); loadFNG(); loadFX();
})();
