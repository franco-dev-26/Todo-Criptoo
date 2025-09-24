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
  const toolsBtn = document.getElementById('tools-btn')
  const tools = document.getElementById('tools')
  const toolsClose = document.getElementById('tools-close')
  const heat = document.getElementById('heat')
  const gainersEl = document.getElementById('gainers')
  const losersEl = document.getElementById('losers')

  let symbols = JSON.parse(localStorage.getItem('symbols')||'[]')
  if(!symbols.length) symbols = ['btcusdt','ethusdt','solusdt']
  let state = {}
  let sparks = {}
  let fx = { USD:1, EUR:1, ARS:1 }
  let timer=null, baseMs=3000, marketTimer=null


// --- Network helpers & fallbacks ---
const BINANCE_HOSTS = [
  'https://data-api.binance.vision',
  'https://api.binance.com'
]

async function fetchJson(url, {timeout=9000, headers={}, ...opts} = {}){
  const ctrl = new AbortController()
  const t = setTimeout(()=>ctrl.abort(), timeout)
  try{
    const res = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'accept':'application/json', ...headers },
      signal: ctrl.signal,
      ...opts
    })
    if(!res.ok) throw new Error('HTTP '+res.status)
    return await res.json()
  }finally{ clearTimeout(t) }
}

async function getBinance(path){
  let lastErr
  for(const host of BINANCE_HOSTS){
    try{ return await fetchJson(host + path) }catch(e){ lastErr = e }
  }
  throw lastErr || new Error('Binance unreachable')
}

async function getRatesUSD(){
  // primary: open.er-api.com
  try{
    const j = await fetchJson('https://open.er-api.com/v6/latest/USD', {timeout: 9000})
    if(j?.rates) return { EUR:+j.rates.EUR||1, ARS:+j.rates.ARS||1, CLP:+j.rates.CLP||1 }
  }catch{}
  // fallback 1: frankfurter.app
  try{
    const j = await fetchJson('https://api.frankfurter.app/latest?from=USD&to=EUR,ARS,CLP', {timeout: 9000})
    if(j?.rates) return { EUR:+j.rates.EUR||1, ARS:+j.rates.ARS||1, CLP:+j.rates.CLP||1 }
  }catch{}
  // fallback 2: exchangerate.host
  try{
    const j = await fetchJson('https://api.exchangerate.host/latest?base=USD&symbols=EUR,ARS,CLP', {timeout: 9000})
    if(j?.rates) return { EUR:+j.rates.EUR||1, ARS:+j.rates.ARS||1, CLP:+j.rates.CLP||1 }
  }catch{}
  return null
}


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

    const pad = 6, innerW = W - pad*2, innerH = H - pad*2
    const min = Math.min(...data), max = Math.max(...data), span=(max-min)||1

    const bgGrad = ctx.createLinearGradient(0, pad, 0, H-pad)
    const css = getComputedStyle(document.documentElement)
    const upc = css.getPropertyValue('--up').trim() || '#22c55e'
    const downc = css.getPropertyValue('--down').trim() || '#ef4444'
    const mixTop = data.at(-1)>=data[0] ? upc : downc
    bgGrad.addColorStop(0, mixTop+'22'); bgGrad.addColorStop(1, '#00000000')

    roundedRect(ctx, pad, pad, innerW, innerH, 10); ctx.save(); ctx.clip()
    ctx.fillStyle = bgGrad; ctx.fillRect(pad, pad, innerW, innerH)
    ctx.lineWidth = 2; ctx.beginPath()
    data.forEach((v,i)=>{ const x = pad + (i/(data.length-1))*innerW; const y = pad + (innerH - ((v-min)/span)*innerH); i?ctx.lineTo(x,y):ctx.moveTo(x,y) })
    ctx.strokeStyle = mixTop; ctx.stroke(); ctx.restore()
    ctx.strokeStyle = 'rgba(0,0,0,.07)'; ctx.lineWidth = 1
    roundedRect(ctx, pad+.5, pad+.5, innerW-1, innerH-1, 10); ctx.stroke()
  }

  async function loadSpark(sym){
    try{
      const rows = await getBinance(`/api/v3/klines?symbol=${sym.toUpperCase()}&interval=1m&limit=60`)
      sparks[sym] = rows.map(x=>+x[4])
      drawSpark(sym)
    }catch(e){ console.error('market error', e) }
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
      const arr = await getBinance('/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(sy)))
      arr.forEach(m=>{ const s=m.symbol.toLowerCase(); state[s]={c:m.lastPrice,P:m.priceChangePercent,h:m.highPrice,l:m.lowPrice,v:m.volume}; render(s) })
      statusBox.textContent='En vivo'
    }catch(e){ statusBox.textContent='Error de red'; console.error('tick error', e) }
  }

  async function tickMarket(){
    try{
      const arr = await getBinance('/api/v3/ticker/24hr')
      const usdt = arr.filter(x=>x.symbol.endsWith('USDT') && !/UPUSDT|DOWNUSDT|BULL|BEAR/.test(x.symbol))
      usdt.sort((a,b)=> (+b.quoteVolume||0) - (+a.quoteVolume||0))
      const top = usdt.slice(0,48)

      heat.innerHTML = top.slice(0,24).map(m=>{
        const p = parseFloat(m.priceChangePercent||'0')
        const cls = p>=0?'up':'down'
        const sym = m.symbol.replace('USDT','')
        return `<div class="tile ${cls}"><div class="sym">${sym}</div><div class="chg">${p.toFixed(2)}%</div></div>`
      }).join('')

      const sorted = [...usdt].sort((a,b)=> parseFloat(b.priceChangePercent)-parseFloat(a.priceChangePercent))
      const gain = sorted.slice(0,8)
      const loss = sorted.slice(-8).reverse()

      gainersEl.innerHTML = gain.map(m=>{
        const sym = m.symbol.replace('USDT','')
        const p = parseFloat(m.priceChangePercent||'0')
        return `<div class="row"><span class="sym">${sym}</span><span class="p">+${p.toFixed(2)}%</span></div>`
      }).join('')

      losersEl.innerHTML = loss.map(m=>{
        const sym = m.symbol.replace('USDT','')
        const p = parseFloat(m.priceChangePercent||'0')
        return `<div class="row"><span class="sym">${sym}</span><span class="p">${p.toFixed(2)}%</span></div>`
      }).join('')
    }catch(e){ console.error('market error', e) }
  }

  async function loadFX(){
    try{
      const r=await fetch('https://open.er-api.com/v6/latest/USD'); const j=await r.json()
      if(j?.rates){ fx.EUR=+j.rates.EUR||1; fx.ARS=+j.rates.ARS||1 }
      fxBox.textContent = `1 USD = EUR ${fx.EUR.toFixed(2)} · ARS ${Math.round(fx.ARS).toLocaleString()}`
      const usdIn = document.getElementById('fx-usd'), eurOut=document.getElementById('fx-eur'), arsOut=document.getElementById('fx-ars')
      if(usdIn && eurOut && arsOut){
        const upd=()=>{ const v=parseFloat(usdIn.value||'0'); eurOut.textContent=(v*fx.EUR).toFixed(2); arsOut.textContent=Math.round(v*fx.ARS).toLocaleString() }
        usdIn.addEventListener('input', upd); upd()
      }
    }catch(e){ console.error('market error', e) }
  }

  function startPolling(){ clearInterval(timer); timer=setInterval(tick, baseMs) }
  document.addEventListener('visibilitychange',()=>{ baseMs = document.hidden ? 8000 : 3000; startPolling() })

  function addSymbolFlow(){
    symbolIn.value=''
    dlg.showModal()
    symbolIn.focus()
  }

  
  // --- General currency converter ---
  function bindGeneralConverter(){
    function parseAmountLocal(raw){
      if(raw==null) return 0
      let s = String(raw).trim()
      if(!s) return 0
      // remove spaces
      s = s.replace(/\s+/g,'')
      // If both separators present, assume . as thousands and , as decimal
      if(s.includes('.') && s.includes(',')){
        s = s.replace(/\./g,'').replace(',', '.')
      }else if(s.includes(',')){
        // only comma present -> treat as decimal
        s = s.replace(',', '.')
      }
      // otherwise use as-is (dot decimal or plain int)
      const v = parseFloat(s)
      return isNaN(v) ? 0 : v
    }
    const amount = document.getElementById('conv-amount')
    const from = document.getElementById('conv-from')
    const to = document.getElementById('conv-to')
    const res = document.getElementById('conv-result')
    const swap = document.getElementById('conv-swap')
    const nf = new Intl.NumberFormat('es-AR',{maximumFractionDigits:4})

    const convert = (v, f, t) => {
      const fxFrom = fx[f]||1, fxTo = fx[t]||1
      return (v / fxFrom) * fxTo
    }
    function update(){
      const v = parseAmountLocal(amount.value)
      const f = from.value || 'USD'
      const t = to.value || 'ARS'
      if(!v){ res.textContent='—'; return }
      const out = convert(v, f, t)
      res.textContent = nf.format(out) + ' ' + t
    }
    ;[amount, from, to].forEach(el=> el && el.addEventListener('input', update))
    if(swap) swap.addEventListener('click', ()=>{ const f = from.value; from.value = to.value; to.value = f; update() })
    update()
  }

  function bindCalculators(){
    const $ = id => document.getElementById(id)
    const entry=$('pl-entry'), exit=$('pl-exit'), size=$('pl-size'), fee=$('pl-fee'), res=$('pl-result'), chg=$('pl-change')
    function updPL(){
      const e=+entry.value||0, x=+exit.value||0, s=+size.value||0, f=(+fee.value||0)/100
      if(!e||!x||!s){ res.textContent='—'; chg.textContent='—'; return }
      const gross=(x-e)*s, fees=(e*s*f)+(x*s*f), net=gross-fees, pct=e?((x-e)/e*100):0
      res.textContent = `${net>=0?'+':''}${net.toFixed(2)} USD`
      chg.textContent = `${pct>=0?'+':''}${pct.toFixed(2)}%`
    }
    ;[entry,exit,size,fee].forEach(i=> i&&i.addEventListener('input',updPL)); updPL()

    const c=$('ps-capital'), r=$('ps-risk'), pe=$('ps-entry'), st=$('ps-stop'), rx=$('ps-risk$'), sz=$('ps-size')
    function updPS(){
      const cap=+c.value||0, rp=(+r.value||0)/100, ent=+pe.value||0, stop=+st.value||0
      if(!cap||!rp||!ent||!stop||ent===stop){ rx.textContent='—'; sz.textContent='—'; return }
      const risk$ = cap*rp
      const perUnit = Math.abs(ent-stop)
      const size = perUnit ? (risk$/perUnit) : 0
      rx.textContent = `${risk$.toFixed(2)} USD`
      sz.textContent = `${size>0?size.toFixed(6):'—'}`
    }
    ;[c,r,pe,st].forEach(i=> i&&i.addEventListener('input',updPS)); updPS()
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

  toolsBtn.addEventListener('click',()=> tools.classList.toggle('open'))
  toolsClose.addEventListener('click',()=> tools.classList.remove('open'))
  tools.addEventListener('click',e=>{ if(e.target===tools) tools.classList.remove('open') })

  try{
    const theme = localStorage.getItem('theme')||'light'; document.documentElement.setAttribute('data-theme', theme)
    symbols.forEach(card)
    ensureUI()
    bindCalculators()
    loadFX()
    tick()
    startPolling()
    tickMarket()
    clearInterval(marketTimer); marketTimer=setInterval(tickMarket, 60000)
    window.addEventListener('resize',()=> symbols.forEach(drawSpark))
  }catch{ statusBox.textContent='Fallo al iniciar' }
})
