document.addEventListener('DOMContentLoaded', () => {
  // DOM
  const grid = document.getElementById('grid');
  const emptyHint = document.getElementById('empty-hint');
  const statusBox = document.getElementById('status');
  const addBtn = document.getElementById('add-btn');
  const input = document.getElementById('symbol-input');
  const reconnectBtn = document.getElementById('reconnect-btn');
  const themeBtn = document.getElementById('theme-btn');
  const filterInput = document.getElementById('filter-input');
  const fiatSel = document.getElementById('fiat');
  const fxBadge = document.getElementById('fx-badge');
  const fxBox = document.getElementById('fx');

  // Estado
  let symbols = JSON.parse(localStorage.getItem('symbols')||'[]');
  if(!symbols.length) symbols = ['btcusdt','ethusdt','solusdt'];
  let state = {};       // { sym: {c,P,h,l,v} }
  let sparks = {};      // { sym: [closes...] }
  let timer = null;
  let sparkTimer = null;
  let fx = { USD:1, EUR:1, ARS:1 };

  // Utils
  const save = ()=>localStorage.setItem('symbols',JSON.stringify(symbols));
  const fmt = (n)=> (n==null||isNaN(n))?'—':
    (n>=100000? n.toLocaleString(undefined,{maximumFractionDigits:0}):
    n>=1000? n.toLocaleString(undefined,{maximumFractionDigits:2}):
    n>=1? n.toLocaleString(undefined,{maximumFractionDigits:4}):
           n.toLocaleString(undefined,{maximumFractionDigits:8}));
  const fromUSD=(usd)=> {
    const cur = fiatSel.value||'USD';
    const rate = cur==='ARS'?fx.ARS:cur==='EUR'?fx.EUR:1;
    return usd*rate;
  };

  // Sparkline
  async function loadSpark(sym){
    try{
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym.toUpperCase()}&interval=1m&limit=60`;
      const r = await fetch(url);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const rows = await r.json();
      sparks[sym] = rows.map(row => Number(row[4])); // cierres
      drawSpark(sym);
    }catch(e){
      // Silencioso; si falla, seguimos sin spark
    }
  }
  function drawSpark(sym){
    const el = document.querySelector(`[data-sym="${sym}"] [data-el="spark"]`);
    if(!el || !sparks[sym]?.length) return;
    const data = sparks[sym];
    const w = el.width = el.clientWidth || 160;
    const h = el.height = el.clientHeight || 46;
    const ctx = el.getContext('2d');
    ctx.clearRect(0,0,w,h);
    const min = Math.min(...data), max = Math.max(...data);
    const span = (max-min) || 1;
    // línea
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((v,i)=>{
      const x = (i/(data.length-1))*w;
      const y = h - ((v-min)/span)*h;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = data.at(-1) >= data[0] ? '#16a34a' : '#dc2626'; // verde/rojo
    ctx.stroke();
  }

  // UI
  function ensureUI(){
    emptyHint.style.display = symbols.length ? 'none' : 'block';
    fxBadge.textContent = `FX · ARS ${fx.ARS.toFixed(2)} · EUR ${fx.EUR.toFixed(2)}`;
    fxBox.textContent = `EUR ${fx.EUR.toFixed(2)} · ARS ${Math.round(fx.ARS).toLocaleString()}`;
  }

  function mount(sym){
    if(document.querySelector(`[data-sym="${sym}"]`)) return;
    const el = document.createElement('div');
    el.className='card'; el.dataset.sym=sym;
    el.innerHTML = `
      <div class="card__head">
        <div>
          <div class="card__meta">BINANCE • 24H</div>
          <div class="card__sym">${sym.toUpperCase()}</div>
        </div>
        <div class="card__actions">
          <button data-act="remove" class="card__remove" title="Quitar">✕</button>
        </div>
      </div>
      <div class="card__price">
        <div class="price" data-el="price">—</div>
        <div class="badge" data-el="chg">—</div>
      </div>
      <div class="card__stats">
        <canvas class="spark" data-el="spark"></canvas>
        <div class="stats">
          <div>24h Alto: <b data-el="high">—</b></div>
          <div>24h Bajo: <b data-el="low">—</b></div>
          <div>Vol: <b data-el="vol">—</b></div>
        </div>
      </div>`;
    el.querySelector('[data-act="remove"]').addEventListener('click',()=>{
      symbols = symbols.filter(x=>x!==sym); save(); el.remove(); ensureUI();
    });
    grid.appendChild(el);
    // carga spark inicial
    loadSpark(sym);
  }

  function render(sym){
    const m = state[sym]; if(!m) return;
    const el = document.querySelector(`[data-sym="${sym}"]`); if(!el) return;
    const fiat = fiatSel.value||'USD';
    el.querySelector('[data-el="price"]').textContent = `${fmt(fromUSD(+m.c))} ${fiat}`;
    const chg = +m.P; const chgEl = el.querySelector('[data-el="chg"]');
    chgEl.textContent = `${chg>=0?'▲':'▼'} ${isFinite(chg)?chg.toFixed(2):'0.00'}%`;
    chgEl.className = `badge ${chg>=0?'badge--up':'badge--down'}`;
    el.querySelector('[data-el="high"]').textContent = fmt(fromUSD(+m.h));
    el.querySelector('[data-el="low"]').textContent  = fmt(fromUSD(+m.l));
    el.querySelector('[data-el="vol"]').textContent  = isNaN(+m.v)?'—':Number(m.v).toLocaleString();
    // redibujar spark si existe (por tamaño responsivo)
    drawSpark(sym);
  }

  // Datos: REST binance.vision (CORS OK)
  async function tick(){
    if(!symbols.length){ statusBox.textContent='Sin símbolos'; return; }
    statusBox.textContent='Actualizando…';
    const symsUpper = symbols.map(s=>s.toUpperCase());
    const url = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(symsUpper));
    try{
      const r = await fetch(url);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const arr = await r.json();
      arr.forEach(m=>{
        const sym = m.symbol.toLowerCase();
        state[sym] = { c:m.lastPrice, P:m.priceChangePercent, h:m.highPrice, l:m.lowPrice, v:m.volume };
        render(sym);
      });
      statusBox.textContent='En vivo (REST)';
    }catch(e){
      console.error(e);
      statusBox.textContent='REST: error';
    }
  }

  async function loadFX(){
    try{
      const r = await fetch('https://open.er-api.com/v6/latest/USD');
      const j = await r.json();
      if(j && j.rates){ fx.EUR = +j.rates.EUR||1; fx.ARS = +j.rates.ARS||1; }
    }catch(e){}
    ensureUI();
  }

  // Eventos
  addBtn.addEventListener('click',()=>{
    const raw = (input.value||'').trim().toLowerCase(); if(!raw) return;
    const sym = raw.endsWith('usdt')?raw:`${raw}usdt`;
    if(!symbols.includes(sym)){ symbols.push(sym); save(); mount(sym); tick(); }
    input.value='';
  });
  input.addEventListener('keydown',e=>{ if(e.key==='Enter') addBtn.click(); });
  reconnectBtn.addEventListener('click',()=>{ tick(); symbols.forEach(loadSpark); });
  themeBtn.addEventListener('click',()=>{
    const html=document.documentElement; const next=html.getAttribute('data-theme')==='dark'?'light':'dark';
    html.setAttribute('data-theme',next); localStorage.setItem('theme',next);
    // redibuja sparks por cambio de contraste
    symbols.forEach(drawSpark);
  });
  filterInput.addEventListener('input',()=>{
    const q=filterInput.value.trim().toLowerCase();
    document.querySelectorAll('.card').forEach(el=>{
      el.style.display = el.dataset.sym.includes(q)?'':'none';
    });
  });
  fiatSel.addEventListener('change',()=>{ ensureUI(); Object.keys(state).forEach(render); });

  // Boot
  try{
    const theme = localStorage.getItem('theme')||'light';
    document.documentElement.setAttribute('data-theme', theme);
    symbols.forEach(mount);
    ensureUI();
    loadFX();            // cambio EUR/ARS
    tick();              // primera carga
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 3000);     // precios
    if (sparkTimer) clearInterval(sparkTimer);
    sparkTimer = setInterval(()=>symbols.forEach(loadSpark), 60000); // spark cada 60s
    statusBox.textContent = 'Inicializado…';
  }catch(e){
    statusBox.textContent = 'Fallo al iniciar: ' + e.message;
    console.error(e);
  }
});
