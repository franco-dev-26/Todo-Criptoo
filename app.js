const grid = document.getElementById('grid');
const emptyHint = document.getElementById('empty-hint');
const input = document.getElementById('symbol-input');
const addBtn = document.getElementById('add-btn');

let symbols = ['btcusdt','ethusdt','solusdt','adausdt','xrpusdt','dogeusdt'];
let ws = null;
let state = {};

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
      const last = Number(msg.c);
      const prev = state[sym]?.spark || [];
      const spark = [...prev,last].slice(-80);
      state[sym] = { msg, spark };
      render(sym);
    }catch(e){}
  };
  ws.onclose = ()=>{ if(symbols.length) setTimeout(connect,1200); };
}

function addSymbol(raw){
  const s = (raw||input.value).trim().toLowerCase();
  if(!s) return;
  const normalized = s.endsWith('usdt')?s:`${s}usdt`;
  if(!symbols.includes(normalized)){
    symbols.push(normalized);
    ensureUI();
    mount(normalized);
    connect();
  }
  input.value='';
}

function removeSymbol(sym){
  symbols = symbols.filter(x=>x!==sym);
  delete state[sym];
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
  `;
  el.querySelector('.card__remove').addEventListener('click',()=>removeSymbol(sym));
  grid.appendChild(el);
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
  ctx.strokeStyle = up ? '#059669' : '#dc2626';
  ctx.beginPath();
  points.forEach((p,i)=>{
    const x=i*step;
    const y=h-((p-min)/span)*h;
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

addBtn.addEventListener('click',()=>addSymbol());
input.addEventListener('keydown',(e)=>{ if(e.key==='Enter') addSymbol(); });

function boot(){
  ensureUI();
  symbols.forEach(mount);
  connect();
}
boot();