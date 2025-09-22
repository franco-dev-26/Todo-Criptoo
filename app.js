document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('grid')
  const empty = document.getElementById('empty')
  const statusBox = document.getElementById('status')
  const themeBtn = document.getElementById('theme')
  const fiatSel = document.getElementById('fiat')
  const fxBox = document.getElementById('fx')
  const fab = document.getElementById('add')
  const dlg = document.getElementById('adddlg')
  const addok = document.getElementById('addok')
  const addcancel = document.getElementById('addcancel')
  const symbolIn = document.getElementById('symbol')

  let symbols = JSON.parse(localStorage.getItem('symbols')||'[]')
  if(!symbols.length) symbols = ['btcusdt','ethusdt','solusdt']
  let state = {}
  let sparks = {}
  let fx = { USD:1, EUR:1, ARS:1 }
  let timer=null, baseMs=3000

  const nf0 = new Intl.NumberFormat(undefined,{maximumFractionDigits:0})
  const nf2 = new Intl.NumberFormat(undefined,{maximumFractionDigits:2})
  const nf4 = new Intl.NumberFormat(undefined,{maximumFractionDigits:4})
  const nf8 = new Intl.NumberFormat(undefined,{maximumFractionDigits:8})
  const fmt = n => (n==null||isNaN(n))?'—':(+n>=100000?nf0:(+n>=1000?nf2:(+n>=1?nf4:nf8))).format(+n)
  const fromUSD = usd => { const cur = fiatSel.value||'USD'; const r = cur==='ARS'?fx.ARS:cur==='EUR'?fx.EUR:1; return usd*r }

  function ensureUI(){ empty.style.display = symbols.length ? 'none' : 'block' }

  function scaleCanvas(c){
    const dpr = Math.max(1, window.devicePixelRatio||1)
    const w = c.clientWidth||160, h = c.clientHeight||46
    c.width = Math.round(w*dpr); c.height = Math.round(h*dpr)
    c.getContext('2d').setTransform(dpr,0,0,dpr,0,0)
  }

  function roundedRect(ctx, x, y, w, h, r){
    ctx.beginPath()
    ctx.moveTo(x+r, y)
    ctx.arcTo(x+w, y, x+w, y+h, r)
    ctx.arcTo(x+w, y+h, x, y+h, r)
    ctx.arcTo(x, y+h, x, y, r)
    ctx.arcTo(x, y, x+w, y, r)
    ctx.closePath()
  }

  function drawSpark(sym){
    const el = document.querySelector(`[data-sym="${sym}"] .spark`)
    const data = sparks[sym]; if(!el || !data?.length) return
    scaleCanvas(el)
    const ctx = el.getContext('2d')
    const W = el.clientWidth||160, H = el.clientHeight||46
    ctx.clearRect(0,0,W,H)

    const pad = 6
    const innerW = W - pad*2
    const innerH = H - pad*2

    const min = Math.min(...data), max = Math.max(...data), span=(max-min)||1

    const bgGrad = ctx.createLinearGradient(0, pad, 0, H-pad)
    const css = getComputedStyle(document.documentElement)
    const upc = css.getPropertyValue('--up').trim() || '#22c55e'
    const downc = css.getPropertyValue('--down').trim() || '#ef4444'
    const mixTop = data.at(-1)>=data[0] ? upc : downc
    bgGrad.addColorStop(0, mixTop+'22')
    bgGrad.addColorStop(1, '#00000000')

    roundedRect(ctx, pad, pad, innerW, innerH, 10)
    ctx.save()
    ctx.clip()
    ctx.fillStyle = bgGrad
    ctx.fillRect(pad, pad, innerW, innerH)

    ctx.lineWidth = 2
    ctx.beginPath()
    data.forEach((v,i)=>{
      const x = pad + (i/(data.length-1))*innerW
      const y = pad + (innerH - ((v-min)/span)*innerH)
      i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)
    })
    ctx.strokeStyle = mixTop
    ctx.stroke()
    ctx.restore()

    ctx.strokeStyle = 'rgba(0,0,0,.07)'
    ctx.lineWidth = 1
    roundedRect(ctx, pad+.5, pad+.5, innerW-1, innerH-1, 10)
    ctx.stroke()
  }

  async function loadSpark(sym){
    try{
      const u = `https://data-api.binance.vision/api/v3/klines?symbol=${sym.toUpperCase()}&interval=1m&limit=60`
      const r = await fetch(u); if(!r.ok) throw 0
      const rows = await r.json()
      sparks[sym] = rows.map(x=>+x[4])
      drawSpark(sym)
    }catch{}
  }

  function card(sym){
    const el = document.createElement('div')
    el.className='card'; el.dataset.sym=sym
    el.innerHTML = `
      <button class="x" aria-label="Quitar">✕</button>
      <div class="head">
        <div class="sym">${sym.toUpperCase()}</div>
        <div class="badge" data-chg>—</div>
      </div>
      <div class="row">
        <div class="price" data-price aria-live="polite">—</div>
        <canvas class="spark"></canvas>
      </div>
      <div class="meta"><span>H: <b data-high>—</b></span> · <span>L: <b data-low>—</b></span> · <span>Vol: <b data-vol>—</b></span></div>
    `
    el.querySelector('.x').addEventListener('click',()=>{
      const s = el.dataset.sym
      symbols = symbols.filter(x=>x!==s)
      localStorage.setItem('symbols', JSON.stringify(symbols))
      el.remove()
      ensureUI()
    })
    grid.appendChild(el)
    loadSpark(sym)
  }

  function render(sym){
    const m = state[sym], el = document.querySelector(`[data-sym="${sym}"]`); if(!m||!el) return
    const fiat = fiatSel.value||'USD', chg = +m.P
    el.querySelector('[data-price]').textContent = `${fmt(fromUSD(+m.c))} ${fiat}`
    const badge = el.querySelector('[data-chg]')
    badge.textContent = `${chg>=0?'▲':'▼'} ${isFinite(chg)?chg.toFixed(2):'0.00'}%`
    badge.className = `badge ${chg>=0?'up':'down'}`
    el.querySelector('[data-high]').textContent = fmt(fromUSD(+m.h))
    el.querySelector('[data-low]').textContent  = fmt(fromUSD(+m.l))
    el.querySelector('[data-vol]').textContent  = isNaN(+m.v)?'—':Number(m.v).toLocaleString()
    drawSpark(sym)
  }

  async function tick(){
    if(!symbols.length){ statusBox.textContent='Sin símbolos'; ensureUI(); return }
    statusBox.textContent='Actualizando…'
    try{
      const sy = symbols.map(s=>s.toUpperCase())
      const u = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(sy))
      const r = await fetch(u); if(!r.ok) throw 0
      const arr = await r.json()
      arr.forEach(m=>{ const s=m.symbol.toLowerCase(); state[s]={c:m.lastPrice,P:m.priceChangePercent,h:m.highPrice,l:m.lowPrice,v:m.volume}; render(s) })
      statusBox.textContent='En vivo'
    }catch{ statusBox.textContent='Error de red' }
  }

  async function loadFX(){
    try{
      const r=await fetch('https://open.er-api.com/v6/latest/USD'); const j=await r.json()
      if(j?.rates){ fx.EUR=+j.rates.EUR||1; fx.ARS=+j.rates.ARS||1 }
      fxBox.textContent = `1 USD = EUR ${fx.EUR.toFixed(2)} · ARS ${Math.round(fx.ARS).toLocaleString()}`
    }catch{}
  }

  function startPolling(){ clearInterval(timer); timer=setInterval(tick, baseMs) }
  document.addEventListener('visibilitychange',()=>{ baseMs = document.hidden ? 8000 : 3000; startPolling() })

  function addSymbolFlow(){
    symbolIn.value=''
    dlg.showModal()
    symbolIn.focus()
  }

  themeBtn.addEventListener('click',()=>{
    const html=document.documentElement; const next=html.getAttribute('data-theme')==='dark'?'light':'dark'
    html.setAttribute('data-theme',next); localStorage.setItem('theme',next); symbols.forEach(drawSpark)
  })
  fiatSel.addEventListener('change',()=>{ Object.keys(state).forEach(render) })
  fab.addEventListener('click', addSymbolFlow)
  addcancel.addEventListener('click',()=>dlg.close())
  addok.addEventListener('click',()=>{
    const raw=(symbolIn.value||'').trim().toLowerCase(); if(!raw) return
    const sym = raw.endsWith('usdt')?raw:`${raw}usdt`
    if(!symbols.includes(sym)){ symbols.push(sym); localStorage.setItem('symbols',JSON.stringify(symbols)); card(sym); tick() }
    dlg.close()
  })
  symbolIn.addEventListener('keydown',e=>{ if(e.key==='Enter') addok.click() })

  try{
    const theme = localStorage.getItem('theme')||'light'; document.documentElement.setAttribute('data-theme', theme)
    symbols.forEach(card)
    ensureUI()
    loadFX()
    tick()
    startPolling()
    window.addEventListener('resize',()=> symbols.forEach(drawSpark))
  }catch{ statusBox.textContent='Fallo al iniciar' }
})
