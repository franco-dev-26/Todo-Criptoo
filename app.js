// =====================
// Guard rails de errores visibles en UI
// =====================
window.addEventListener('error', (e) => {
  const s = document.getElementById('status');
  if (s) s.textContent = 'Error JS: ' + (e.message || 'desconocido');
  console.error('JS Error:', e.error || e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  const s = document.getElementById('status');
  if (s) s.textContent = 'Error Promesa: ' + (e.reason?.message || e.reason || 'desconocido');
  console.error('Promise Error:', e.reason);
});

document.addEventListener('DOMContentLoaded', () => {
  // =====================
  // DOM
  // =====================
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
  const kpiFNG = document.getElementById('kpi-fng'); // placeholder
  const fxBox = document.getElementById('fx');
  const statusBox = document.getElementById('status');
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

  // =====================
  // Estado
  // =====================
  let symbols = JSON.parse(localStorage.getItem('symbols')||'[]');
  if(!symbols.length) symbols = ['btcusdt','ethusdt','solusdt','adausdt','xrpusdt','dogeusdt'];
  let alerts = JSON.parse(localStorage.getItem('alerts')||'{}');
  let favorites = JSON.parse(localStorage.getItem('favorites')||'[]');
  let muted = JSON.parse(localStorage.getItem('muted')||'false');
  let state = {};
  let lastPrices = {};
  let fxRates = JSON.parse(localStorage.getItem('fxRates')||'{"USD":1,"EUR":1,"ARS":1}');
  let fxOverride = Number(localStorage.getItem('fxOverrideARS')||'0');

  let pollTimer = null;
  let ws = null, wsRetryTimer = null;
  let LIVE_MODE = localStorage.getItem('live_mode') || 'WS'; // 'WS' | 'REST'

  // =====================
  // Utils
  // =====================
  function saveAll(){ localStorage.setItem('symbols', JSON.stringify(symbols));
    localStorage.setItem('alerts', JSON.stringify(alerts));
    localStorage.setItem('favorites', JSON.stringify(favorites));
    localStorage.setItem('muted', JSON.stringify(muted));
    localStorage.setItem('fxRates', JSON.stringify(fxRates));
    localStorage.setItem('fxOverrideARS', fxOverride||0);
    localStorage.setItem('live_mode', LIVE_MODE);
  }
  function fmtPrice(n){ if(n==null||isNaN(n)) return '—'; const v=Number(n);
    if(v>=100000) return v.toLocaleString(undefined,{maximumFractionDigits:0});
    if(v>=1000) return v.toLocaleString(undefined,{maximumFractionDigits:2});
    if(v>=1) return v.toLocaleString(undefined,{maximumFractionDigits:4});
    return v.toLocaleString(undefined,{maximumFractionDigits:8});
  }
  function ensureUI(){ emptyHint.style.display = symbols.length ? 'none':'block';
    soundBtn.textContent = muted ? 'Sonido Off' : 'Sonido On';
    if (fxRates?.ARS && fxRates?.EUR){
      fxBadge.textContent = `FX · ARS ${Number(fxRates.ARS).toFixed(2)} · EUR ${Number(fxRates.EUR).toFixed(2)}`;
    }
  }
  function fromUSD(amount, fiat){ if(fiat==='USD') return amount; if(fiat==='ARS' && fxOverride>0) return amount*fxOverride; return amount*(fxRates[fiat]||1); }
  function toUSD(amount, fiat){ if(fiat==='USD') return amount; const rate=(fiat==='ARS'&&fxOverride>0)?fxOverride:(fxRates[fiat]||1); return amount/(rate||1); }
  function refreshAll(){ Object.keys(state).forEach(render); }
  function flash(el, up){ el.classList.remove('flash-up','flash-down'); void el.offsetWidth; el.classList.add(up?'flash-up':'flash-down'); }

  // =====================
  // REST polling (fallback)
  // =====================
  async function pollPrices(){
    if(!symbols.length){ statusBox.textContent='Sin símbolos'; return; }
    statusBox.textContent='Actualizando…';
    const symsUpper = symbols.map(s=>s.toUpperCase());
    let ok=false;
    // vision primero (CORS friendly), luego api.binance.com
    try{
      const url = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symsUpper));
      const res = await fetch(url);
      if(res.ok){
        const arr = await res.json();
        arr.forEach(m=>ingestTicker(m));
        ok=true;
      }
    }catch(e){}
    if(!ok){
      try{
        const url = 'https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symsUpper));
        const res = await fetch(url);
        if(res.ok){
          const arr = await res.json();
          arr.forEach(m=>ingestTicker(m));
          ok=true;
        }
      }catch(e){}
    }
    statusBox.textContent = ok ? 'En vivo (REST)' : 'REST: error';
    if(!ok && LIVE_MODE!=='WS'){ LIVE_MODE='WS'; saveAll(); connectWS(true); }
  }

  function ingestTicker(m){
    const sym = m.symbol.toLowerCase();
    const price = Number(m.lastPrice);
    const prev = state[sym]?.spark || [];
    const spark = [...prev,price].slice(-120);
    const msg = { s:m.symbol, c:m.lastPrice, P:m.priceChangePercent, h:m.highPrice, l:m.lowPrice, v:m.volume };
    state[sym] = { msg, spark };
    render(sym);
    // KPIs
    if(sym==='btcusdt') kpiBTC.textContent = Number(m.volume||0).toLocaleString();
    if(sym==='ethusdt') kpiETH.textContent = Number(m.volume||0).toLocaleString();
    // Alertas + flash
    const card = document.querySelector(`[data-sym="${sym}"]`);
    checkAlerts(sym, price);
    if(card){ const last = lastPrices[sym]; lastPrices[sym]=price; if(last!=null) flash(card, price>last); }
  }

  // =====================
  // Velas (opcionales)
  // =====================
  async function loadCandles(sym){
    const el = document.querySelector(`[data-sym="${sym}"] [data-el="candles"]`);
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym.toUpperCase()}&interval=15m&limit=96`;
    try{ const r=await fetch(url); const rows=await r.json();
      drawCandles(el, rows.map(r=>({o:+r[1],h:+r[2],l:+r[3],c:+r[4]})));
    }catch(e){}
  }
  function drawCandles(canvas, candles){
    const w = canvas.width = canvas.clientWidth || 300, h = canvas.height = 150;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,w,h); if(!candles.length) return;
    const lows = candles.map(c=>c.l), highs = candles.map(c=>c.h);
    const min = Math.min(...lows), max = Math.max(...highs), span=(max-min)||1, cw = Math.max(2, w/candles.length - 2);
    candles.forEach((c,i)=>{ const x=i*(cw+2)+1;
      const y1=h-((c.h-min)/span)*h, y2=h-((c.l-min)/span)*h, yOpen=h-((c.o-min)/span)*h, yClose=h-((c.c-min)/span)*h; const up = c.c>=c.o;
      ctx.strokeStyle=up?'#16a34a':'#dc2626'; ctx.fillStyle=up?'#16a34a':'#dc2626';
      ctx.beginPath(); ctx.moveTo(x+cw/2,y1); ctx.lineTo(x+cw/2,y2); ctx.stroke();
      const rectY=Math.min(yOpen,yClose), rectH=Math.max(1,Math.abs(yClose-yOpen)); ctx.fillRect(x, rectY, cw, rectH);
    });
  }

  // =====================
  // Render
  // =====================
  function render(sym){
    const el = document.querySelector(`[data-sym="${sym}"]`) || (mount(sym), document.querySelector(`[data-sym="${sym}"]`));
    const m = state[sym]?.msg; if(!m) return;
    const priceEl = el.querySelector('[data-el="price"]');
    const chgEl = el.querySelector('[data-el="chg"]');
    const highEl = el.querySelector('[data-el="high"]');
    const lowEl = el.querySelector('[data-el="low"]');
    const volEl = el.querySelector('[data-el="vol"]');
    const priceUSD = Number(m.c), chg=Number(m.P), highUSD=Number(m.h), lowUSD=Number(m.l), vol=Number(m.v);
    const fiat = fiatSel.value || 'USD';
    const show = fromUSD(priceUSD, fiat);
    priceEl.textContent = `${fmtPrice(show)} ${fiat}`;
    chgEl.textContent = `${chg>=0?'▲':'▼'} ${isFinite(chg)?chg.toFixed(2):'0.00'}%`; chgEl.className=`badge ${chg>=0?'badge--up':'badge--down'}`;
    highEl.textContent = fmtPrice(fromUSD(highUSD, fiat));
    lowEl.textContent = fmtPrice(fromUSD(lowUSD, fiat));
    volEl.textContent = isNaN(vol)?'—':vol.toLocaleString();
  }

  // =====================
  // UI (mount, acciones)
  // =====================
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
        <canvas class="spark" data-el="spark" style="display:none"></canvas>
        <div class="stats"><div>24h Alto: <b data-el="high">—</b></div><div>24h Bajo: <b data-el="low">—</b></div><div>Vol: <b data-el="vol">—</b></div></div>
      </div>
      <div class="candles"><canvas class="candles__canvas" data-el="candles"></canvas></div>
      <div class="cmp" data-el="cmp" style="font-size:12px; color:var(--muted)"></div>`;
    el.querySelector('[data-act="remove"]').addEventListener('click',()=>removeSymbol(sym));
    el.querySelector('[data-act="fav"]').addEventListener('click',(e)=>toggleFavorite(sym,e.currentTarget));
    el.querySelector('[data-act="alert"]').addEventListener('click',()=>promptAlert(sym));
    grid.appendChild(el);
    loadComparators(sym); loadCandles(sym);
  }

  function addSymbol(raw){ const s=(raw||input.value).trim().toLowerCase(); if(!s) return;
    const normalized=s.endsWith('usdt')?s:`${s}usdt`; if(!symbols.includes(normalized)){
      symbols.push(normalized); saveAll(); ensureUI(); mount(normalized);
      if (LIVE_MODE === 'WS') connectWS(true); else pollPrices();
    } input.value=''; }
  function removeSymbol(sym){ symbols=symbols.filter(x=>x!==sym); delete state[sym]; delete alerts[sym]; saveAll();
    const el=document.querySelector(`[data-sym="${sym}"]`); if(el) el.remove(); ensureUI();
    if (LIVE_MODE === 'WS') connectWS(true); }
  function toggleFavorite(sym, btn){ if(favorites.includes(sym)) favorites=favorites.filter(x=>x!==sym); else favorites.push(sym);
    if(btn) btn.textContent=favorites.includes(sym)?'★':'☆'; saveAll(); renderFavorites(); }
  function promptAlert(sym){
    const fiat=fiatSel.value; const val=prompt(`Crear alerta para ${sym.toUpperCase()} en ${fiat}. Ingresá el valor:`);
    if(!val) return; const price=Number(val); if(isNaN(price)) return; alerts[sym]=toUSD(price, fiat); saveAll();
    alert(`Alerta creada: ${sym.toUpperCase()} @ ${fmtPrice(price)} ${fiat}`); try{Notification.requestPermission&&Notification.requestPermission();}catch(e){} }
  function checkAlerts(sym, priceUSD){ const targetUSD=alerts[sym]; if(!targetUSD) return;
    const last=lastPrices[sym]; lastPrices[sym]=priceUSD;
    const crossed=(priceUSD>=targetUSD && (!last || last<targetUSD)) || (priceUSD<=targetUSD && (!last || last>targetUSD));
    if(crossed){ try{ if(!muted){ beep.currentTime=0; beep.play(); } }catch(e){}
      const fiat=fiatSel.value; alert(`${sym.toUpperCase()} cruzó tu alerta. Ahora: ${fmtPrice(fromUSD(priceUSD,fiat))} ${fiat}`);
      delete alerts[sym]; saveAll(); } }

  // =====================
  // Comparadores & FX
  // =====================
  async function loadComparators(sym){
    const el = document.querySelector(`[data-sym="${sym}"] [data-el="cmp"]`);
    const base = sym.replace('usdt','').toUpperCase(); const out = [];
    try{ const r1 = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${base}USDT`); const j1 = await r1.json(); if(j1?.price) out.push(`Binance: ${fmtPrice(Number(j1.price))} USDT`);}catch(e){}
    try{ const r2 = await fetch(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${base}-USDT`); const j2 = await r2.json(); const p2 = Number(j2?.data?.price); if(p2) out.push(`KuCoin: ${fmtPrice(p2)} USDT`);}catch(e){}
    try{ const krPair = base==='BTC'?'XXBTZUSD': base==='ETH'?'XETHZUSD': `${base}USD`; const r3 = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${krPair}`); const j3 = await r3.json(); const firstKey = Object.keys(j3.result||{})[0]; const p3 = Number(j3.result?.[firstKey]?.c?.[0]); if(p3) out.push(`Kraken: ${fmtPrice(p3)} USD`);}catch(e){}
    el.textContent = out.join(' · ');
  }

  async function loadFX(){
    try{ const r = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=EUR,ARS'); const j = await r.json();
      if(j && j.rates){ fxRates.EUR = Number(j.rates.EUR)||fxRates.EUR; fxRates.ARS = Number(j.rates.ARS)||fxRates.ARS; } }catch(e){}
    try{ const r = await fetch('https://open.er-api.com/v6/latest/USD'); const j = await r.json();
      if(j && j.rates){ fxRates.EUR = Number(j.rates.EUR)||fxRates.EUR; fxRates.ARS = Number(j.rates.ARS)||fxRates.ARS; } }catch(e){}
    saveAll(); fxBadge.textContent = `FX · ARS ${Number(fxRates.ARS).toFixed(2)} · EUR ${Number(fxRates.EUR).toFixed(2)}`;
    fxBox.textContent = `EUR ${Number(fxRates.EUR).toFixed(2)} · ARS ${Math.round(fxRates.ARS).toLocaleString()}`;
    refreshAll();
  }

  // =====================
  // Favoritos modal
  // =====================
  function renderFavorites(){
    favList.innerHTML='';
    if(!favorites.length){ const p=document.createElement('p'); p.textContent='No hay favoritos.'; favList.appendChild(p); return; }
    favorites.forEach(sym=>{
      const row=document.createElement('div'); row.className='fav-item';
      row.innerHTML=`<div>${sym.toUpperCase()}</div><div><button data-sym="${sym}" class="btn btn--primary">Cargar</button> <button data-sym="${sym}" class="btn btn--ghost">Quitar</button></div>`;
      const [loadBtn, delBtn] = row.querySelectorAll('button');
      loadBtn.addEventListener('click',()=>{ if(!symbols.includes(sym)) addSymbol(sym); hideDialog(favModal); const card=document.querySelector(\`[data-sym="\${sym}"]\`); if(card) card.scrollIntoView({behavior:'smooth', block:'center'}); });
      delBtn.addEventListener('click',()=>{ favorites=favorites.filter(x=>x!==sym); saveAll(); renderFavorites(); document.querySelectorAll(\`[data-sym="\${sym}"] [data-act="fav"]\`).forEach(b=>b.textContent='☆'); });
      favList.appendChild(row);
    });
  }

  // =====================
  // Dialog helpers (fallback)
  // =====================
  function showDialog(d){ if(d.showModal) d.showModal(); else d.style.display='block'; }
  function hideDialog(d){ if(d.close) d.close(); else d.style.display='none'; }

  // =====================
  // WebSocket Live
  // =====================
  function connectWS(force=false){
    if(!symbols.length){ statusBox.textContent='Sin símbolos'; return; }
    const streams = symbols.map(s => `${s}@ticker`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    try{ if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } }catch(e){}
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    LIVE_MODE = 'WS'; saveAll();
    statusBox.textContent='Conectando WS…';
    ws = new WebSocket(url);
    ws.onopen = () => { statusBox.textContent='En vivo (WS)'; };
    ws.onmessage = (ev) => {
      try{
        const payload = JSON.parse(ev.data);
        const m = payload.data || payload;
        if(!m || !m.s) return;
        ingestTicker({
          symbol: m.s,
          lastPrice: m.c,
          priceChangePercent: m.P,
          highPrice: m.h,
          lowPrice: m.l,
          volume: m.v
        });
      }catch(e){}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      statusBox.textContent='WS: desconectado, reintentando…';
      wsRetryTimer = setTimeout(()=>{
        if (force) connectWS(false);
        else { LIVE_MODE = 'REST'; saveAll(); startREST(); }
      }, 1500);
    };
  }

  // =====================
  // REST Live
  // =====================
  function startREST(){
    if(pollTimer) clearInterval(pollTimer);
    statusBox.textContent='Inicializado (REST)…';
    pollPrices();
    pollTimer = setInterval(pollPrices, 2000);
  }

  // =====================
  // Eventos
  // =====================
  function wireEvents(){
    addBtn.addEventListener('click',()=>addSymbol());
    input.addEventListener('keydown',(e)=>{ if(e.key==='Enter') addSymbol(); });
    themeBtn.addEventListener('click',()=>{ const html=document.documentElement; const next=html.getAttribute('data-theme')==='dark'?'light':'dark'; html.setAttribute('data-theme',next); localStorage.setItem('theme',next); });
    reconnectBtn.addEventListener('click',()=>{
      if (LIVE_MODE === 'WS') connectWS(true);
      else { startREST(); }
    });
    soundBtn.addEventListener('click',()=>{ muted=!muted; saveAll(); ensureUI(); if(!muted){ try{ beep.currentTime=0; beep.play(); }catch(e){} } });
    favBtn.addEventListener('click',()=>{ renderFavorites(); showDialog(favModal); });
    favClose.addEventListener('click',()=>hideDialog(favModal));
    filterInput.addEventListener('input',()=>{ const q=filterInput.value.trim().toLowerCase(); document.querySelectorAll('.card').forEach(el=>{ const sym=el.dataset.sym; el.style.display = sym.includes(q)?'':'none'; }); });
    fiatSel.addEventListener('change',()=>{ const fiat=fiatSel.value; if(fiat!=='USD' && ((fiat==='ARS' && !fxOverride && (!fxRates.ARS || fxRates.ARS===1)) || (fiat==='EUR' && (!fxRates.EUR || fxRates.EUR===1)))){ loadFX(); } refreshAll(); });
    fxEditBtn.addEventListener('click',()=>{ fxInput.value = fxOverride || fxRates.ARS || 0; showDialog(fxModal); });
    fxClose.addEventListener('click',()=>hideDialog(fxModal));
    fxReset.addEventListener('click',()=>{ fxOverride=0; saveAll(); hideDialog(fxModal); ensureUI(); refreshAll(); });
    fxSave.addEventListener('click',()=>{ const v=Number(fxInput.value); if(!isNaN(v) && v>0){ fxOverride=v; saveAll(); hideDialog(fxModal); ensureUI(); refreshAll(); }});
  }

  // =====================
  // Boot
  // =====================
  try {
    const theme = localStorage.getItem('theme')||'light'; document.documentElement.setAttribute('data-theme', theme);
    ensureUI();
    symbols.forEach(mount);
    loadFX();
    wireEvents();

    // Intento WS primero; si falla, REST
    if (LIVE_MODE === 'WS') connectWS(true);
    else startREST();

    if (!statusBox.textContent) statusBox.textContent = 'Inicializado…';
  } catch (e) {
    if (statusBox) statusBox.textContent = 'Fallo al iniciar: ' + e.message;
    console.error(e);
  }
});
