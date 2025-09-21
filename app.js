/* app.js — Primario con conexión Binance WS integrada
 * - Conexión tomada del ejemplo funcional (reconnect simple).
 * - Mantiene UI simple de los primarios: grid, add/remove, precio/%, alto/bajo, vol, spark.
 * - No usa WebSocket fallback aquí; si querés REST fallback lo agrego luego.
 */

// ===== DOM =====
const $grid = document.getElementById('grid');
const $empty = document.getElementById('empty-hint');
const $input = document.getElementById('symbol-input');
const $addBtn = document.getElementById('add-btn');

// ===== State =====
let symbols = ['btcusdt', 'ethusdt', 'solusdt'];
let ws = null;
let data = {}; // sym -> { lastMsg, spark: [] }

// ===== Utils =====
function fmtPrice(n){
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  if (v >= 100000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
}
function ensureUIState(){
  if (!$empty) return;
  $empty.style.display = symbols.length ? 'none' : 'block';
}

// ===== WS Connect (extraído del ejemplo que te funcionaba) =====
function connect(){
  if (!symbols.length) return;
  const streams = symbols.map(s => `${s}@ticker`).join('/');
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  if (ws) try { ws.close(); } catch(e){}
  ws = new WebSocket(url);
  ws.onmessage = (ev) => {
    try {
      const payload = JSON.parse(ev.data);
      const msg = payload.data || payload;
      if (!msg || !msg.s) return;
      const sym = msg.s.toLowerCase();
      const lastPrice = Number(msg.c);
      const prev = data[sym]?.spark || [];
      const spark = [...prev, lastPrice].slice(-60);
      data[sym] = { lastMsg: msg, spark };
      renderCard(sym);
    } catch(e){ /* ignore */ }
  };
  ws.onclose = () => {
    // reconecta simple
    if (symbols.length) setTimeout(connect, 1500);
  };
}

// ===== UI actions =====
function addSymbol(raw){
  const s = (raw || ($input && $input.value) || '').trim().toLowerCase();
  if (!s) return;
  const normalized = s.endsWith('usdt') ? s : `${s}usdt`;
  if (!symbols.includes(normalized)){
    symbols.push(normalized);
    ensureUIState();
    mountCard(normalized);
    connect(); // rearmar stream combinado
  }
  if ($input) $input.value = '';
}
function removeSymbol(sym){
  symbols = symbols.filter(x => x !== sym);
  delete data[sym];
  const card = document.querySelector(`[data-sym="${sym}"]`);
  if (card) card.remove();
  ensureUIState();
  connect(); // rearmar stream
}

// ===== Render =====
function mountCard(sym){
  if (document.querySelector(`[data-sym="${sym}"]`)) return;
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.sym = sym;
  el.innerHTML = `
    <button class="card__remove" title="Quitar">✕</button>
    <div class="card__meta">
      <div>
        <div class="card__exchange">BINANCE • 24H</div>
        <div class="card__symbol">${sym.toUpperCase()}</div>
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
  el.querySelector('.card__remove').addEventListener('click', () => removeSymbol(sym));
  $grid.appendChild(el);
}
function renderCard(sym){
  const card = document.querySelector(`[data-sym="${sym}"]`) || (mountCard(sym), document.querySelector(`[data-sym="${sym}"]`));
  const ctx = data[sym]; if (!ctx) return;
  const { lastMsg: m, spark } = ctx;
  if (!m) return;

  const priceEl = card.querySelector('[data-el="price"]');
  const chgEl = card.querySelector('[data-el="chg"]');
  const highEl = card.querySelector('[data-el="high"]');
  const lowEl = card.querySelector('[data-el="low"]');
  const volEl = card.querySelector('[data-el="vol"]');
  const sparkEl = card.querySelector('[data-el="spark"]');

  const price = Number(m.c);
  const chgPct = Number(m.P);
  const high = Number(m.h);
  const low = Number(m.l);
  const vol = Number(m.v);
  const up = chgPct >= 0;

  priceEl.textContent = fmtPrice(price);
  chgEl.textContent = `${up ? '▲' : '▼'} ${chgPct.toFixed(2)}%`;
  chgEl.className = `badge ${up ? 'badge--up' : 'badge--down'}`;
  highEl.textContent = fmtPrice(high);
  lowEl.textContent = fmtPrice(low);
  volEl.textContent = isNaN(vol) ? '—' : vol.toLocaleString();

  drawSpark(sparkEl, spark, up);
}
function drawSpark(canvas, points, up){
  const w = canvas.width = 120;
  const h = canvas.height = 36;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);
  if (!points || !points.length) return;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = (max - min) || 1;
  const step = w / Math.max(1, points.length - 1);
  ctx.lineWidth = 2;
  ctx.strokeStyle = up ? '#10b981' : '#ef4444';
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = i * step;
    const y = h - ((p - min) / span) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ===== Events =====
if ($addBtn) $addBtn.addEventListener('click', () => addSymbol());
if ($input) $input.addEventListener('keydown', e => { if (e.key === 'Enter') addSymbol(); });

// ===== Boot =====
(function boot(){
  ensureUIState();
  symbols.forEach(mountCard);
  connect();
})();