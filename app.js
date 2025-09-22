document.addEventListener('DOMContentLoaded', () => {
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

  let symbols = JSON.parse(localStorage.getItem('symbols')||'[]');
  if(!symbols.length) symbols = ['btcusdt','ethusdt','solusdt'];
  let state = {};
  let sparks = {};
  let fx = { USD:1, EUR:1, ARS:1 };
  let timer=null, sparkTimer=null, baseMs=3000;

  const nf0 = new Intl.NumberFormat(undefined,{maximumFractionDigits:0});
  const nf2 = new Intl.NumberFormat(undefined,{maximumFractionDigits:2});
  const nf4 = new Intl.NumberFormat(undefined,{maximumFractionDigits:4});
  const nf8 = new Intl.NumberFormat(undefined,{maximumFractionDigits:8});
  const fmt = n => (n==null||isNaN(n))?'—':(+n>=100000?nf0:(+n>=1000?nf2:(+n>=1?nf4:nf8))).format(+n);
  const save = ()=>localStorage.setItem('symbols',JSON.stringify(symbols));
  const fromUSD = usd => { const cur = fiatSel.value||'USD'; const r = cur==='ARS'?fx.ARS:cur==='EUR'?fx.EUR:1; return usd*r; };
  const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}};

  function ensureUI(){
    emptyHint.style.display = symbols.length ? 'none' : 'block';
    fxBadge.textContent = `FX · ARS ${fx.ARS.toFixed(2)} · EUR ${fx.EUR.toFixed(2)}`;
    fxBox.textContent = `EUR ${fx.EUR.toFixed(2)} · ARS ${Math.round(fx.ARS).toLocaleString()}`;
  }

  function scaleCanvas(c){
    const dpr = Math.max(1, window.devicePixelRatio||1);
    const w = c.clientWidth||160, h = c.clientHeight||46;
    c.width = Math.round(w*dpr); c.height = Math.round(h*dpr);
    c.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  }

  function drawSpark(sym){
    const el = document.querySelector(`[data-sym="${sym}"] [data-el="spark"]`);
    const data = sparks[sym]; if(!el || !data?.length) return;
    scaleCanvas(el);
    const w = el.clientWidth||160, h = el.clientHeight||46, ctx = el.getContext('2d');
    ctx.clearRect(0,0,w,h);
    const min = Math.min(...data), max = Math.max(...data), span=(max-min)||1;
    ctx.lineWidth = 2; ctx.beginPath();
    data.forEach((v,i)=>{ const x=i/(data.length-1)*w, y=h-((v-min)/span)*h; i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    const dark = document.documentElement.getAttribute('data-theme')==='dark';
    ctx.strokeStyle = data.at(-1)>=data[0] ? (dark?'#22c55e':'#16a34a') : (dark?'#60a5fa':'#2563eb');
    ctx.stroke();
  }

  async function loadSpark(sym){
    try{
      const u = `https://data-api.binance.vision/api/v3/klines?symbol=${sym.toUpperCase()}&interval=1m&limit=60`;
      const r = await fetch(u); if(!r.ok) throw 0;
      const rows = await r.json();
      sparks[sym] = rows.map(x=>+x[4]);
      drawSpark(sym);
    }catch{}
  }

  function mount(sym){
    if(document.querySelector(`[data-sym="${sym}"]`)) return;
    const el = document.createElement('div');
    el.className='card'; el.dataset.sym=sym;
    el.innerHTML = `
      <div class="card__head">
        <div><div class="card__meta">BINANCE • 24H</div><div class="card__sym">${sym.toUpperCase()}</div></div>
        <div class="card__actions"><button data-act="remove" class="card__remove" title="Quitar">✕</button></div>
      </div>
      <div class="card__price"><div class="price" data-el="price" aria-live="polite">—</div><div class="badge" data-el="chg">—</div></div>
      <div class="card__stats">
        <canvas class="spark" data-el="spark"></canvas>
        <div class="stats"><div>24h Alto: <b data-el="high">—</b></div><div>24h Bajo: <b data-el="low">—</b></div><div>Vol: <b data-el="vol">—</b></div></div>
      </div>`;
    el.querySelector('[data-act="remove"]').addEventListener('click',()=>{ symbols = symbols.filter(x=>x!==sym); save(); el.remove(); ensureUI(); });
    grid.appendChild(el);
    loadSpark(sym);
  }

  function render(sym){
    const m = state[sym], el = document.querySelector(`[data-sym="${sym}"]`); if(!m||!el) return;
    const fiat = fiatSel.value||'USD', chg = +m.P;
    el.querySelector('[data-el="price"]').textContent = `${fmt(fromUSD(+m.c))} ${fiat}`;
    const chgEl = el.querySelector('[data-el="chg"]');
    chgEl.textContent = `${chg>=0?'▲':'▼'} ${isFinite(chg)?chg.toFixed(2):'0.00'}%`;
    chgEl.className = `badge ${chg>=0?'badge--up':'badge--down'}`;
    el.querySelector('[data-el="high"]').textContent = fmt(fromUSD(+m.h));
    el.querySelector('[data-el="low"]').textContent  = fmt(fromUSD(+m.l));
    el.querySelector('[data-el="vol"]').textContent  = isNaN(+m.v)?'—':Number(m.v).toLocaleString();
    drawSpark(sym);
  }

  async function tick(){
    if(!symbols.length){ statusBox.textContent='Sin símbolos'; return; }
    statusBox.textContent='Actualizando…';
    try{
      const sy = symbols.map(s=>s.toUpperCase());
      const u = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(sy));
      const r = await fetch(u); if(!r.ok) throw 0;
      const arr = await r.json();
      arr.forEach(m=>{ const s=m.symbol.toLowerCase(); state[s]={c:m.lastPrice,P:m.priceChangePercent,h:m.highPrice,l:m.lowPrice,v:m.volume}; render(s); });
      statusBox.textContent='En vivo (REST)';
    }catch{ statusBox.textContent='REST: error'; }
  }

  async function loadFX(){
    try{ const r=await fetch('https://open.er-api.com/v6/latest/USD'); const j=await r.json(); if(j?.rates){ fx.EUR=+j.rates.EUR||1; fx.ARS=+j.rates.ARS||1; } }catch{}
    ensureUI();
  }

  function startPolling(){ clearInterval(timer); timer=setInterval(tick, baseMs); }
  document.addEventListener('visibilitychange',()=>{ baseMs = document.hidden ? 8000 : 3000; startPolling(); });

  addBtn.addEventListener('click',()=>{
    const raw=(input.value||'').trim().toLowerCase(); if(!raw) return;
    const sym = raw.endsWith('usdt')?raw:`${raw}usdt`;
    if(!symbols.includes(sym)){ symbols.push(sym); save(); mount(sym); tick(); }
    input.value='';
  });
  input.addEventListener('keydown',e=>{ if(e.key==='Enter') addBtn.click(); });
  reconnectBtn.addEventListener('click',()=>{ tick(); symbols.forEach(loadSpark); });
  themeBtn.addEventListener('click',()=>{
    const html=document.documentElement; const next=html.getAttribute('data-theme')==='dark'?'light':'dark';
    html.setAttribute('data-theme',next); localStorage.setItem('theme',next); symbols.forEach(drawSpark);
  });
  filterInput.addEventListener('input',debounce(()=>{
    const q=filterInput.value.trim().toLowerCase();
    document.querySelectorAll('.card').forEach(el=>{ el.style.display = el.dataset.sym.includes(q)?'':'none'; });
  },200));
  fiatSel.addEventListener('change',()=>{ ensureUI(); Object.keys(state).forEach(render); });
  window.addEventListener('resize',()=> symbols.forEach(drawSpark));

  (function fixMobileBars(){
    const nav = document.querySelector('.nav');
    function setNavH(){
      const h = nav ? nav.getBoundingClientRect().height : 56;
      document.documentElement.style.setProperty('--nav-h', `${Math.round(h)}px`);
    }
    setNavH();
    window.addEventListener('resize', setNavH);
    if(window.visualViewport){
      visualViewport.addEventListener('resize', setNavH);
      visualViewport.addEventListener('scroll', setNavH);
    }
  })();

  try{
    const theme = localStorage.getItem('theme')||'light'; document.documentElement.setAttribute('data-theme', theme);
    symbols.forEach(mount);
    ensureUI();
    loadFX();
    tick();
    startPolling();
    clearInterval(sparkTimer); sparkTimer=setInterval(()=>symbols.forEach(loadSpark), 60000);
    statusBox.textContent='Inicializado…';
  }catch{ statusBox.textContent='Fallo al iniciar'; }
});
