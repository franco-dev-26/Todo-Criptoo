const grid = document.getElementById('grid');
const emptyHint = document.getElementById('empty-hint');
const input = document.getElementById('symbol-input');
const addBtn = document.getElementById('add-btn');
const themeBtn = document.getElementById('theme-btn');
const favBtn = document.getElementById('fav-btn');
const favModal = document.getElementById('fav-modal');
const favClose = document.getElementById('fav-close');
const favList = document.getElementById('fav-list');
const kpiBTC = document.getElementById('kpi-btc-vol');
const kpiETH = document.getElementById('kpi-eth-vol');
const kpiFNG = document.getElementById('kpi-fng');
const moversList = document.getElementById('movers-list');
const tabs = document.querySelectorAll('.tab');
const beep = document.getElementById('beep');

let symbols = JSON.parse(localStorage.getItem('symbols')||'[]');
if(!symbols.length) symbols = ['btcusdt','ethusdt','solusdt','adausdt','xrpusdt','dogeusdt'];
let alerts = JSON.parse(localStorage.getItem('alerts')||'{}');
let favorites = JSON.parse(localStorage.getItem('favorites')||'[]');
let ws = null;
let state = {};
let lastPrices = {};

function saveAll(){
  localStorage.setItem('symbols', JSON.stringify(symbols));
  localStorage.setItem('alerts', JSON.stringify(alerts));
  localStorage.setItem('favorites', JSON.stringify(favorites));
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
}

function connect(){
  if(!symbols.length) return;
  const streams = symbols.map(s=>`${s}@ticker`).join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  if(ws) try{ws.close();}catch(e){}
  ws = new WebSocket(url);
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
  ws.onclose = ()=>{ if(symbols.length) setTimeout(connect,1200); };
}

function priceFlash(sym, price){
  const el = document.querySelector(`[data-sym="${sym}"]`);
  const last = lastPrices[sym];
  lastPrices[sym] = price;
  if(!el || last==null) return;
  const up = price>last;
  el.classList.remove('flash-up','flash-down');
  void el.offsetWidth;
  el.classList.add(up?'flash-up':'flash-down');
}

function addSymbol(raw){
  const s = (raw||input.value).trim().toLowerCase();
  if(!s) return;
  const normalized = s.endsWith('usdt')?s:`${s}usdt`;
  if(!symbols.includes(normalized)){
    symbols.push(normalized);
    saveAll();
    ensureUI();
    mount(normalized);
    connect();
  }
  input.value='';
}

function removeSymbol(sym){
  symbols = symbols.filter(x=>x!==sym);
  delete state[sym];
  delete alerts[sym];
  saveAll();
  const el = document.querySelector(`[data-sym="${sym}"]`);
  if(el) el.remove();
  ensureUI();
  connect();
}

function mount(sym){
  if(document.querySelector(`[data-sym="${sym}"]`)) return;
  const el = document.createElement('div');
  el.className='card';
  el.dataset.sym=sym;
  el.innerHTML=`
    <button class="card__remove" title="Quitar">✕</button>
    <div class="card__head">
      <div>
        <div class="card__meta">BINANCE • 24H</div>
        <div class="card__sym">${sym.toUpperCase()}</div>
      </div>
      <div class="card__head-actions">
        <button data-act="fav" class="btn btn--ghost">★</button>
        <button data-act="alert" class="btn">Alerta</button>
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
    </div>
    <div class="candles">
      <canvas class="candles__canvas" data-el="candles"></canvas>
    </div>
    <div class="comparators" data-el="cmp" style="font-size:12px; color:var(--muted)"></div>
  `;
  el.querySelector('.card__remove').addEventListener('click',()=>removeSymbol(sym));
  el.querySelector('[data-act="fav"]').addEventListener('click',()=>toggleFavorite(sym));
  el.querySelector('[data-act="alert"]').addEventListener('click',()=>promptAlert(sym));
  grid.appendChild(el);
  loadComparators(sym);
  loadCandles(sym,'24h');
  updateCardExtra(sym);
}

function toggleFavorite(sym){
  if(favorites.includes(sym)) favorites = favorites.filter(x=>x!==sym);
  else favorites.push(sym);
  saveAll();
  renderFavorites();
}

function promptAlert(sym){
  const val = prompt(`Crear alerta de precio para ${sym.toUpperCase()} (USD):`);
  if(!val) return;
  const price = Number(val);
  if(isNaN(price)) return;
  alerts[sym] = price;
  saveAll();
  alert(`Alerta creada: ${sym.toUpperCase()} @ ${price}`);
  Notification.requestPermission && Notification.requestPermission();
}

function checkAlerts(sym, price){
  const target = alerts[sym];
  if(!target) return;
  const crossed = (price>=target && (!lastPrices[sym] || lastPrices[sym]<target)) || (price<=target && (!lastPrices[sym] || lastPrices[sym]>target));
  if(crossed){
    try{ beep.currentTime=0; beep.play(); }catch(e){}
    if('Notification' in window && Notification.permission==='granted'){
      new Notification(`${sym.toUpperCase()} cruzó ${target}`, { body:`Precio actual: ${price}` });
    }else{
      alert(`${sym.toUpperCase()} cruzó ${target}. Actual: ${price}`);
    }
    delete alerts[sym];
    saveAll();
  }
}

function render(sym){
  const el = document.querySelector(`[data-sym="${sym}"]`) || (mount(sym), document.querySelector(`[data-sym="${sym}"]`));
  const m = state[sym]?.msg;
  const spark = state[sym]?.spark || [];
  if(!m) return;

  const priceEl = el.querySelector('[data-el="price"]');
  const chgEl = el.querySelector('[data-el="chg"]');
  const highEl = el.querySelector('[data-el="high"]');
  const lowEl = el.querySelector('[data-el="low"]');
  const volEl = el.querySelector('[data-el="vol"]');
  const sparkEl = el.querySelector('[data-el="spark"]');

  const price = Number(m.c);
  const chg = Number(m.P);
  const high = Number(m.h);
  const low = Number(m.l);
  const vol = Number(m.v);
  const up = chg>=0;

  priceEl.textContent = fmtPrice(price);
  chgEl.textContent = `${up?'▲':'▼'} ${chg.toFixed(2)}%`;
  chgEl.className = `badge ${up?'badge--up':'badge--down'}`;
  highEl.textContent = fmtPrice(high);
  lowEl.textContent = fmtPrice(low);
  volEl.textContent = isNaN(vol)?'—':vol.toLocaleString();

  drawSpark(sparkEl, spark, up);
}

function drawSpark(canvas, points, up){
  const w = canvas.width = 140;
  const h = canvas.height = 40;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);
  if(!points.length) return;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = (max-min)||1;
  const step = w/Math.max(1,points.length-1);
  ctx.lineWidth = 2;
  ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
  ctx.beginPath();
  points.forEach((p,i)=>{
    const x=i*step;
    const y=h-((p-min)/span)*h;
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

async function loadCandles(sym, period){
  const el = document.querySelector(`[data-sym="${sym}"] [data-el="candles"]`);
  let interval='15m', limit=96;
  if(period==='7d'){ interval='1h'; limit=168; }
  const url = `https://api.binance.com/api/v3/klines?symbol=${sym.toUpperCase()}&interval=${interval}&limit=${limit}`;
  try{
    const res = await fetch(url);
    const rows = await res.json();
    const candles = rows.map(r=>({t:r[0],o:+r[1],h:+r[2],l:+r[3],c:+r[4]}));
    drawCandles(el, candles);
  }catch(e){}
}

function drawCandles(canvas, candles){
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = 120;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);
  if(!candles.length) return;
  const lows = candles.map(c=>c.l);
  const highs = candles.map(c=>c.h);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = (max-min)||1;
  const cw = Math.max(2, w/candles.length - 2);
  candles.forEach((c,i)=>{
    const x = i*(cw+2)+1;
    const y1 = h - ((c.h-min)/span)*h;
    const y2 = h - ((c.l-min)/span)*h;
    const yOpen = h - ((c.o-min)/span)*h;
    const yClose = h - ((c.c-min)/span)*h;
    const up = c.c >= c.o;
    ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
    ctx.fillStyle = up ? '#22c55e' : '#ef4444';
    ctx.beginPath();
    ctx.moveTo(x+cw/2,y1); ctx.lineTo(x+cw/2,y2); ctx.stroke();
    const rectY = Math.min(yOpen,yClose);
    const rectH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x, rectY, cw, rectH);
  });
}

async function loadComparators(sym){
  const el = document.querySelector(`[data-sym="${sym}"] [data-el="cmp"]`);
  const base = sym.replace('usdt','').toUpperCase();
  const out = [];
  try{
    const r1 = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${base}USDT`);
    const j1 = await r1.json();
    out.push(`Binance: ${fmtPrice(Number(j1.price))} USDT`);
  }catch(e){}
  try{
    const r2 = await fetch(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${base}-USDT`);
    const j2 = await r2.json();
    const p2 = Number(j2?.data?.price);
    if(p2) out.push(`KuCoin: ${fmtPrice(p2)} USDT`);
  }catch(e){}
  try{
    const krPair = base==='BTC'?'XXBTZUSD': base==='ETH'?'XETHZUSD': `${base}USD`;
    const r3 = await fetch(`https://api.kraken.com/0/public/Ticker?pair=${krPair}`);
    const j3 = await r3.json();
    const firstKey = Object.keys(j3.result||{})[0];
    const p3 = Number(j3.result?.[firstKey]?.c?.[0]);
    if(p3) out.push(`Kraken: ${fmtPrice(p3)} USD`);
  }catch(e){}
  el.textContent = out.join(' · ');
}

async function loadFNG(){
  try{
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const j = await r.json();
    const v = j?.data?.[0]?.value_classification || '—';
    kpiFNG.textContent = v;
  }catch(e){}
}

async function loadMovers(period){
  try{
    const vs='usd';
    const days = period==='7d' ? 7 : 1;
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetch(url);
    const data = await res.json();
    const arr = data.map(d=>({name:d.symbol.toUpperCase(), price:d.current_price, chg:d.price_change_percentage_24h}))
      .filter(x=>x.chg!=null)
      .sort((a,b)=>Math.abs(b.chg)-Math.abs(a.chg))
      .slice(0,12);
    moversList.innerHTML = '';
    arr.forEach(x=>{
      const item = document.createElement('div');
      item.className='mover';
      const cls = x.chg>=0?'mover__chg mover__chg--up':'mover__chg mover__chg--down';
      item.innerHTML = `<div class="mover__name">${x.name}</div><div class="${cls}">${x.chg.toFixed(2)}%</div>`;
      moversList.appendChild(item);
    });
  }catch(e){}
}

function renderFavorites(){
  favList.innerHTML='';
  if(!favorites.length){
    const p=document.createElement('p'); p.textContent='No hay favoritos.'; favList.appendChild(p); return;
  }
  favorites.forEach(sym=>{
    const row=document.createElement('div');
    row.className='fav-item';
    row.innerHTML=`<div>${sym.toUpperCase()}</div><div><button data-sym="${sym}" class="btn">Cargar</button> <button data-sym="${sym}" class="btn btn--ghost">Quitar</button></div>`;
    row.querySelectorAll('button')[0].addEventListener('click',()=>{ if(!symbols.includes(sym)) addSymbol(sym); });
    row.querySelectorAll('button')[1].addEventListener('click',()=>{ favorites=favorites.filter(x=>x!==sym); saveAll(); renderFavorites(); });
    favList.appendChild(row);
  });
}

function updateCardExtra(sym){
  fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=&symbols=${sym.replace('usdt','')}`)
    .then(r=>r.json()).then(js=>{}).catch(()=>{});
}

tabs.forEach(t=>t.addEventListener('click',e=>{
  tabs.forEach(x=>x.classList.remove('tab--active'));
  e.currentTarget.classList.add('tab--active');
  const per = e.currentTarget.dataset.period;
  loadMovers(per);
  symbols.forEach(s=>loadCandles(s, per==='7d'?'7d':'24h'));
}));

addBtn.addEventListener('click',()=>addSymbol());
input.addEventListener('keydown',(e)=>{ if(e.key==='Enter') addSymbol(); });
themeBtn.addEventListener('click',()=>{
  const html = document.documentElement;
  const next = html.getAttribute('data-theme')==='dark'?'light':'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});
favBtn.addEventListener('click',()=>{ favModal.showModal(); renderFavorites(); });
favClose.addEventListener('click',()=>favModal.close());

(function boot(){
  const theme = localStorage.getItem('theme')||'light';
  document.documentElement.setAttribute('data-theme', theme);
  ensureUI();
  symbols.forEach(mount);
  connect();
  loadMovers('24h');
  loadFNG();
})();