// Option B 原型：Meteoblue「专业天气预览」槽位 + OurTrail 户外分析（浏览器，无依赖）。
//
// 「Meteoblue Meteogram」为**模拟图**：按官方 Image API /meteogram 的真实内容结构
// （温度红曲线+绿带 / 降水柱+云层灰阶+海拔轴 / 风羽+风速阵风双曲线 / 昼夜黄底 / 英文界面）
// 用本原型 72h mock 绘制，配色模仿 meteoblue 产品 —— 仅用于评估「嵌入效果与 375px 可读性」，
// 不是 OurTrail 设计系统的一部分，也不是真实 API 输出。
// OurTrail 分析层跑生产引擎（../engine.js = astro/sky/format 原样打包）。
'use strict'
/* global OTmock, OTengine */

const { POINT, META, days, hours } = OTmock
const { astro, format, sky } = OTengine

const STORY_NOW = { date: '2026-10-06', t: '06:30' }
const MB_W = 1560   // 模拟图桌面原生宽度（120 列 × 13px，同 meteoblue 桌面密度）

const state = { date: '2026-10-06', mbView: 'native', open: {} }

/* ---------- 引擎 ---------- */
const cache = {}
function analyze(date) {
  if (cache[date]) return cache[date]
  const detail = hours.filter(h => h.d === date)
  const ctx = { date, lat: POINT.lat, lng: POINT.lng, elevation: POINT.elevation, elevOK: true, detail, days, heading: 75 }
  const summary = sky.summarize(ctx)
  const marksFlat = {}
  const raw = sky.hourMarks(ctx)
  Object.keys(raw).forEach(t => { marksFlat[date + 'T' + t] = raw[t] })
  return (cache[date] = {
    detail, summary, marks: marksFlat,
    sun: astro.sunTimes(date, POINT.lat, POINT.lng, POINT.elevation),
    win: astro.photoWindows(date, POINT.lat, POINT.lng, POINT.elevation),
    moon: astro.moonInfo(date),
  })
}
function itemOf(a, key) { return a.summary.items.filter(x => x.key === key)[0] || null }
function starsOf(item) {
  if (!item || item.label === '客观时刻') return null
  if (item.score >= 70) return { n: 4, cls: 'g-success', word: '较好 Good' }
  if (item.score >= 45) return { n: 3, cls: 'g-warning', word: '一般 Fair' }
  return { n: 2, cls: 'g-neutral', word: '较差 Poor' }
}
function starsHtml(n) {
  let s = ''
  for (let i = 0; i < 5; i++) s += i < n ? '★' : '<span class="off">★</span>'
  return '<span class="stars">' + s + '</span>'
}
function minuteOf(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) }
function phraseOf(code) { return format.weatherPhrase(code).label }
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') }

/* ---------- 渲染 ---------- */

function renderAll() {
  const app = document.getElementById('app')
  app.innerHTML = ''
  app.appendChild(header())
  app.appendChild(dayStrip())
  app.appendChild(meteoblueCard())
  app.appendChild(whyBridge())
  app.appendChild(conditionsSection())
  app.appendChild(agendaSection())
  app.appendChild(numbersSection())
  app.appendChild(footerNote())
}

function header() {
  const md = state.date.slice(5, 10).replace('-', ' 月 ') + ' 日'
  const wd = '周' + '日一二三四五六'[new Date(state.date + 'T12:00:00+08:00').getUTCDay()]
  return el(`
    <div>
      <span class="eyebrow">行前参考</span>
      <span class="page-title">留意天气，也留意天相。</span>
      <div class="pt-meta">
        <span class="pt-place">${esc(POINT.name)} <span class="ele tabular">· ${POINT.elevation} m</span></span>
        <span class="pt-src tabular">${md} · ${wd}<br>Open-Meteo · ${META.updatedAt.slice(11, 16)} 更新</span>
      </div>
    </div>`)
}

/* 7 日条：降权重版（更矮，去日出/降水文案，只留 图标+温度区间） */
function dayStrip() {
  const wrap = el('<div class="day-strip"></div>')
  for (const day of days.filter(d => d.date >= '2026-10-06')) {
    const wd = '日一二三四五六'[new Date(day.date + 'T12:00:00+08:00').getUTCDay()]
    let label = '周' + wd
    if (day.date === STORY_NOW.date) label = '今天'
    else if (day.date === sky.addDays(STORY_NOW.date, 1)) label = '明天'
    const c = el(`
      <div class="day-card ${day.date === state.date ? 'on' : ''}" data-date="${day.date}">
        <span class="day-label">${label}</span>
        <span class="day-ico">${phraseOf(day.code)}</span>
        <span class="day-temp tabular">${day.tMax}° <span class="lo">${day.tMin}°</span></span>
      </div>`)
    c.addEventListener('click', () => { state.date = day.date; renderAll() })
    wrap.appendChild(c)
  }
  return wrap
}

/* ---------- 模拟 Meteoblue Meteogram（核心展示物） ---------- */

const MB = { padL: 62, padR: 62, cw: 13, y1: 74, h1: 260, y2: 366, h2: 300, y3: 698, h3: 224, H: 992 }
// 海拔轴（km）：0 / 1.5 / 3.5 / 6 / 9 / 14（对齐 meteoblue 图右轴）
const ALT_MAX_KM = 14

function altY(km) { return MB.y2 + (ALT_MAX_KM - km) / ALT_MAX_KM * (MB.h2 - 20) + 6 }

function meteoblueCard() {
  const cols = hours.filter(h => h.d >= state.date).slice(0, 72)
  const svg = buildMeteogramSvg(cols)
  const squeezed = state.mbView === 'squeeze'
  const scale = squeezed ? (343 / MB_W) : 1
  const legendPx = Math.round(14 * scale * 10) / 10
  const verdict = squeezed
    ? `<div class="mb-verdict bad"><b>实测：不可读。</b> 375px 宽为原图的 ${(scale * 100).toFixed(0)}%，
         图内最小文字（图例 14px）缩到 ≈${legendPx}px，低于可读下限（12px）。结论：
         桌面图不能整图缩放塞进手机 —— 只能「原生宽 + 横向滚动」，或像下方 OurTrail 时间轴那样按 24h 重绘。</div>`
    : `<div class="mb-verdict ok"><b>实测：原生宽度可读。</b> 需横向滚动 ${(MB_W / 343).toFixed(1)} 屏看完 3 天；
         英文界面（Image API 的 lang 枚举无中文，官方 OpenAPI 证实）。</div>`
  const card = el(`
    <div>
      <div class="section-head">
        <span class="section-title">专业天气<span class="level-tag level-fact">Meteoblue · 天气事实</span></span>
        <span class="section-sub">模拟 Image API /meteogram 输出 · 内容结构真实 · 数据为原型 mock</span>
      </div>
      <div class="card mb-card">
        <div class="mb-note">Meteoblue Image API（my.meteoblue.com/images/meteogram?lat&lon&asl&apikey）返回二进制 PNG，
          内容即下图结构：温度曲线 / 降水与云层剖面 / 风。每图 <b>16,000 credits</b>，免费年额度约可出 625 张 —— 必须后端缓存。</div>
        <div class="mb-viewseg">
          <div class="seg-btn ${!squeezed ? 'on' : ''}" data-view="native">原生宽度（横滚）</div>
          <div class="seg-btn ${squeezed ? 'on' : ''}" data-view="squeeze">整图缩至 375px</div>
        </div>
        <div class="mb-scroll ${squeezed ? 'squeezed' : ''}">${svg}</div>
        ${verdict}
      </div>
    </div>`)
  card.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.mbView = b.dataset.view; renderAll() }))
  return card
}

function buildMeteogramSvg(cols) {
  const W = MB_W
  const x = i => MB.padL + i * MB.cw
  const cx = i => x(i) + MB.cw / 2
  const n = cols.length
  const EN_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  // 昼夜底（06-18 黄色，同 meteoblue）
  let dayBands = '', daySeps = '', dayLabels = '', axisTicks = ''
  let prevDate = ''
  cols.forEach((h, i) => {
    const hh = Number(h.t.slice(0, 2))
    if (hh >= 6 && hh < 18) dayBands += `<rect x="${x(i)}" y="${MB.y1 - 26}" width="${MB.cw}" height="${MB.h1 + MB.h2 + MB.h3 + 42}" fill="var(--mb-day)"/>`
    if (h.d !== prevDate) {
      prevDate = h.d
      const wd = EN_DAY[new Date(h.d + 'T12:00:00+08:00').getUTCDay()]
      const md = h.d.slice(5, 10).replace('-', '.')
      if (i > 0) daySeps += `<line x1="${x(i)}" y1="${MB.y1 - 26}" x2="${x(i)}" y2="${MB.y3 + MB.h3}" stroke="#37474F" stroke-width="1.2"/>`
      dayLabels += `<text x="${x(i) + 4}" y="${MB.y1 - 32}" font-size="17" font-weight="600" fill="#263238">${wd} ${md}</text>`
    }
    if (hh % 6 === 0) axisTicks += `<text x="${x(i) + 2}" y="${MB.y3 + MB.h3 - 46}" font-size="13" fill="#546E7A">${String(hh).padStart(2, '0')}</text>`
  })

  /* ---- Panel 1: Temperature ---- */
  const temps = cols.map(h => h.temp)
  const tMaxAll = Math.max.apply(null, temps), tMinAll = Math.min.apply(null, temps)
  const ty = t => MB.y1 + 20 + (tMaxAll + 2 - t) / (tMaxAll + 2 - (tMinAll - 2)) * (MB.h1 - 46)
  let curve = '', area = ''
  cols.forEach((h, i) => { curve += (i ? 'L' : 'M') + cx(i).toFixed(1) + ',' + ty(h.temp).toFixed(1) })
  area = curve + `L${cx(n - 1)},${MB.y1 + MB.h1 - 6}L${cx(0)},${MB.y1 + MB.h1 - 6}Z`
  // meteoblue 的分层绿：4 档由浅到深填充曲线下方
  const bands = [
    { up: 1.0, c: '#D9F0CE' }, { up: 0.72, c: '#B5E0A8' }, { up: 0.45, c: '#8CCB84' }, { up: 0.2, c: '#63B463' },
  ].map(b => {
    const yLine = MB.y1 + 20 + b.up * (MB.h1 - 46)
    const clipTop = MB.y1 + 20, clipBot = MB.y1 + MB.h1 - 6
    return `<clipPath id="b${b.up}"><path d="${curve}L${cx(n - 1)},${clipBot}L${cx(0)},${clipBot}Z"/></clipPath>
      <rect x="${MB.padL}" y="${clipTop}" width="${n * MB.cw}" height="${clipBot - clipTop}" fill="${b.c}" clip-path="url(#b${b.up})" opacity="0"/>`
  }).join('')
  // 简化：单层绿渐变填充（模拟分层绿的观感），红曲线
  const tempVals = [...new Set([0, 5, 10, 15].filter(v => v >= tMinAll - 2 && v <= tMaxAll + 2))]
    .map(v => `<text x="${MB.padL - 6}" y="${ty(v) + 4}" font-size="12" fill="#546E7A" text-anchor="end">${v}</text>`).join('')
  // 每日最高温标注 + 简化天气 picto（圆点太阳 / 云形）
  let labels = '', pictos = ''
  for (let d0 = 0; d0 < n; d0 += 24) {
    const slice = temps.slice(d0, d0 + 24)
    const imax = slice.indexOf(Math.max.apply(null, slice))
    labels += `<text x="${cx(d0 + imax)}" y="${ty(slice[imax]) - 8}" font-size="14" font-weight="700" fill="#263238" text-anchor="middle">${Math.round(slice[imax])}</text>`
    const noon = cols[d0 + 12]
    const p = noon.code === 0 || noon.code === 1 ? 'sun' : noon.code <= 3 ? 'cloud' : noon.code >= 95 ? 'storm' : 'rain'
    const px = cx(d0 + 13), py = ty(slice[imax]) - 30
    pictos += p === 'sun'
      ? `<circle cx="${px}" cy="${py}" r="7" fill="#FDD835" stroke="#F9A825"/><g stroke="#F9A825" stroke-width="1.5">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<line x1="${px + 9 * Math.cos(a * Math.PI / 180)}" y1="${py + 9 * Math.sin(a * Math.PI / 180)}" x2="${px + 12 * Math.cos(a * Math.PI / 180)}" y2="${py + 12 * Math.sin(a * Math.PI / 180)}"/>`).join('')}</g>`
      : p === 'cloud' ? `<ellipse cx="${px}" cy="${py}" rx="12" ry="7" fill="#B0BEC5"/><ellipse cx="${px - 8}" cy="${py + 2}" rx="8" ry="5" fill="#CFD8DC"/>`
      : p === 'rain' ? `<ellipse cx="${px}" cy="${py}" rx="12" ry="7" fill="#90A4AE"/><line x1="${px - 4}" y1="${py + 8}" x2="${px - 6}" y2="${py + 14}" stroke="#1E88E5" stroke-width="1.5"/><line x1="${px + 3}" y1="${py + 8}" x2="${px + 1}" y2="${py + 14}" stroke="#1E88E5" stroke-width="1.5"/>`
      : `<ellipse cx="${px}" cy="${py}" rx="12" ry="7" fill="#78909C"/><path d="M${px - 2},${py + 9} l3,5 l3,-5 z" fill="#FBC02D"/><line x1="${px - 6}" y1="${py + 9}" x2="${px - 8}" y2="${py + 14}" stroke="#1E88E5" stroke-width="1.5"/>`
  }

  /* ---- Panel 2: Clouds + Precipitation ---- */
  const grayShade = c => c >= 90 ? '#4F4F4F' : c >= 75 ? '#6E6E6E' : c >= 50 ? '#9C9C9C' : c >= 25 ? '#C6C6C6' : '#E3E3E3'
  // 云层：低/中/高映射到海拔带（ASL，模拟 meteoblue 的剖面观感），透明度随云量
  let cloudRects = ''
  cols.forEach((h, i) => {
    const layers = [[6, 12, h.cloud.high], [2.5, 6, h.cloud.mid], [0, 2.5, h.cloud.low]]
    for (const [lo, hi, cc] of layers) {
      if (cc < 10) continue
      const yTop = altY(hi), yBot = altY(lo)
      cloudRects += `<rect x="${x(i) + 1}" y="${yTop}" width="${MB.cw - 2}" height="${yBot - yTop}" fill="${grayShade(cc)}" opacity="${(0.35 + 0.65 * cc / 100).toFixed(2)}" rx="3"/>`
    }
  })
  // 冻结层：tan 带从 0 到 freezing 海拔（mock 的 freezing 字段）
  let frozen = ''
  cols.forEach((h, i) => {
    if (!Number.isFinite(h.freezing)) return
    frozen += `<rect x="${x(i)}" y="${altY(h.freezing / 1000)}" width="${MB.cw}" height="${MB.y2 + MB.h2 - 20 - altY(h.freezing / 1000)}" fill="var(--mb-frozen)" opacity="0.5"/>`
  })
  // 降水柱：precipitation（深蓝）+ showers（浅蓝）
  const maxP = Math.max(1, Math.max.apply(null, cols.map(h => Math.max(h.precip + h.showers, 0))))
  const pTop = MB.y2 + MB.h2 - 96, pBot = MB.y2 + MB.h2 - 20
  let precipBars = ''
  cols.forEach((h, i) => {
    const bw = 3
    if (h.precip > 0) {
      const bh = Math.max(1.5, h.precip / maxP * (pBot - pTop))
      precipBars += `<rect x="${x(i) + 1.5}" y="${pBot - bh}" width="${bw}" height="${bh}" fill="var(--mb-precip)"/>`
    }
    if (h.showers > 0) {
      const bh = Math.max(1.5, h.showers / maxP * (pBot - pTop))
      precipBars += `<rect x="${x(i) + 2 + bw}" y="${pBot - bh}" width="${bw}" height="${bh}" fill="var(--mb-showers)"/>`
    }
  })
  const altTicks = [14, 9, 6, 3.5, 1.5, 0].map(km =>
    `<text x="${W - MB.padR + 8}" y="${altY(km) + 4}" font-size="12" fill="#546E7A">${km}</text>`).join('')

  /* ---- Panel 3: Wind ---- */
  const wMax = Math.max(20, Math.max.apply(null, cols.map(h => Math.max(h.gust, 0))))
  const wy = v => MB.y3 + 44 + (1 - v / wMax) * (MB.h3 - 78)
  let windCur = '', gustCur = '', windArrows = ''
  cols.forEach((h, i) => {
    windCur += (i ? 'L' : 'M') + cx(i).toFixed(1) + ',' + wy(h.wind).toFixed(1)
    gustCur += (i ? 'L' : 'M') + cx(i).toFixed(1) + ',' + wy(h.gust).toFixed(1)
    if (i % 2 === 0) {
      windArrows += `<g transform="translate(${cx(i)},${MB.y3 + 24}) rotate(${(h.windDir + 180) % 360})">
        <path d="M0,5 L0,-4 M0,-4 L-2.6,-0.8 M0,-4 L2.6,-0.8" stroke="#37474F" stroke-width="1.3" fill="none"/></g>`
    }
  })
  const windTicks = [0, 20, 40].filter(v => v <= wMax)
    .map(v => `<text x="${MB.padL - 6}" y="${wy(v) + 4}" font-size="12" fill="#1B6B4B" text-anchor="end">${v}</text>
      <text x="${W - MB.padR + 8}" y="${wy(v) + 4}" font-size="12" fill="#1B6B4B">${v}</text>`).join('')

  const legend = `
    <g font-size="13" fill="#37474F">
      ${[['#E3E3E3', '10–25%'], ['#C6C6C6', '25–50%'], ['#9C9C9C', '50–75%'], ['#6E6E6E', '75–90%'], ['#4F4F4F', '90–100%']].map(([c, t], i) =>
        `<rect x="${MB.padL + i * 118}" y="${MB.H - 40}" width="13" height="13" fill="${c}"/><text x="${MB.padL + i * 118 + 19}" y="${MB.H - 29}">${t}</text>`).join('')}
      <rect x="${MB.padL + 5 * 118}" y="${MB.H - 40}" width="13" height="13" fill="var(--mb-precip)"/><text x="${MB.padL + 5 * 118 + 19}" y="${MB.H - 29}">Precipitation</text>
      <rect x="${MB.padL + 6.6 * 118}" y="${MB.H - 40}" width="13" height="13" fill="var(--mb-showers)"/><text x="${MB.padL + 6.6 * 118 + 19}" y="${MB.H - 29}">Showers</text>
      <path d="M${MB.padL + 8.4 * 118},${MB.H - 27} l5,-8 l5,8 z" fill="#E68A2E"/><text x="${MB.padL + 8.4 * 118 + 15}" y="${MB.H - 29}">Frozen mix</text>
    </g>`

  return `<svg class="mb-fig ${state.mbView === 'squeeze' ? 'squeezed' : ''}" width="${W}" height="${MB.H}" viewBox="0 0 ${W} ${MB.H}"
      font-family="Helvetica, Arial, sans-serif" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="${W}" height="${MB.H}" fill="#FFFFFF"/>
    <text x="16" y="30" font-size="24" font-weight="700" fill="#263238">29.86°N 99.46°E</text>
    <text x="16" y="52" font-size="15" fill="#546E7A">29.86°N, 99.46°E (3500 m asl) · SIMULATED</text>
    <text x="${W - 16}" y="38" font-size="30" font-weight="800" fill="var(--mb-blue)" text-anchor="end" font-style="italic">meteoblue</text>
    ${dayBands}
    <g clip-path="url(#mbclip)"></g>
    <!-- Temperature panel -->
    <text x="14" y="${MB.y1 + 8}" font-size="13" fill="#546E7A">Temperature (°C)</text>
    <line x1="${MB.padL}" y1="${MB.y1 + MB.h1 - 6}" x2="${W - MB.padR}" y2="${MB.y1 + MB.h1 - 6}" stroke="#CFD8DC"/>
    <path d="${area}" fill="url(#mgreen)"/>
    ${bands}
    <path d="${curve}" fill="none" stroke="var(--mb-red)" stroke-width="2.4"/>
    ${tempVals}${labels}${pictos}
    <!-- Precipitation + clouds panel -->
    <text x="14" y="${MB.y2 + 8}" font-size="13" fill="#546E7A">Precipitation (mm/h)</text>
    <text x="${W - 14}" y="${MB.y2 + 8}" font-size="13" fill="#546E7A" text-anchor="end">Altitude (km)</text>
    ${frozen}${cloudRects}${precipBars}${altTicks}
    <line x1="${MB.padL}" y1="${pBot}" x2="${W - MB.padR}" y2="${pBot}" stroke="#CFD8DC"/>
    <!-- Wind panel -->
    <text x="14" y="${MB.y3 + 8}" font-size="13" fill="#546E7A">Wind speed (km/h)</text>
    ${windArrows}
    <path d="${gustCur}" fill="none" stroke="var(--mb-gust)" stroke-width="2"/>
    <path d="${windCur}" fill="none" stroke="var(--mb-wind)" stroke-width="2"/>
    ${windTicks}
    <!-- Axis -->
    ${daySeps}${dayLabels}${axisTicks}
    <line x1="${MB.padL}" y1="${MB.y3 + MB.h3 - 34}" x2="${W - MB.padR}" y2="${MB.y3 + MB.h3 - 34}" stroke="#37474F"/>
    ${legend}
  </svg>`
}

/* 「为什么值得关注」桥：从事实到分析的过渡行 */
function whyBridge() {
  const a = analyze(state.date)
  const names = { cloudSea: '云海', alpenglow: '日照金山', rainbow: '彩虹', galaxy: '银河', star: '星空' }
  const good = a.summary.items.filter(x => x.score >= 70 && names[x.key]).map(x => names[x.key])
  return el(`
    <div class="card" style="border-left:3px solid var(--forest);">
      <div class="cond-main">
        <span class="cond-label">为什么值得关注</span>
        <span class="level-tag level-analysis">OURTRAIL 分析</span>
      </div>
      <div class="pheno-text">上方天气图由 Meteoblue/气象模型提供；OurTrail 把它翻译成户外机会：
        今天${good.length ? good.join('、') + '的条件较好' : '天象机会有限'} —— 依据如下，每条都可回到上方图表。</div>
    </div>`)
}

/* ---------- OurTrail 分析区（与 fallback 原型同构，引擎同源） ---------- */

function conditionsSection() {
  const a = analyze(state.date)
  const live = a.summary.items.filter(x => x.score >= 45 && x.key !== 'light')
  const pool = live.length ? live : a.summary.items.filter(x => x.key !== 'light')
  const score = Math.round(pool.reduce((s, x) => s + x.score, 0) / pool.length)
  const st = starsOf({ score, label: '' })
  const cloudSea = itemOf(a, 'cloudSea')
  const others = ['alpenglow', 'rainbow', 'galaxy', 'star'].map(k => itemOf(a, k)).filter(Boolean)
  const othersHtml = others.map(item => {
    const s = starsOf(item)
    const key = 'ph:' + item.key
    const open = state.open[key]
    return `
      <div class="card pheno-card" style="${open ? 'padding-bottom:0;' : ''}">
        <div class="card-header" style="margin-bottom:2px;">
          <span class="card-label">${esc(item.title)}</span>
          <span>${s ? starsHtml(s.n) + '<span class="grade-word ' + s.cls + '">' + s.word + '</span>' : ''}</span>
        </div>
        <div class="pheno-window tabular">${esc(item.window || '—')}</div>
        <div class="pheno-text">${esc(item.text)}</div>
        ${open ? `<div class="reason-panel" style="margin:8px -14px 0;">${reasonInner(item.key, a)}</div>`
               : `<div class="small" style="color:var(--forest);font-weight:600;cursor:pointer;margin-top:6px;" data-toggle="${key}">为什么？</div>`}
      </div>`
  }).join('')
  const key = 'ph:cloudSea'
  const open = state.open[key]
  const cs = starsOf(cloudSea)
  const sec = el(`
    <div>
      <div class="section-head">
        <span class="section-title">户外条件<span class="level-tag level-analysis">OURTRAIL 分析</span></span>
        <span class="section-sub">基于上方天气事实的条件判断，不是气象预报</span>
      </div>
      <div class="stack" style="gap:10px;">
        <div class="card cond-card">
          <div class="cond-main">
            <span class="cond-label">徒步条件</span>
            <span>${starsHtml(st.n)}<span class="grade-word ${st.cls}">${st.word}</span></span>
          </div>
          ${calloutsHtml(a)}
        </div>
        ${cloudSea ? `
        <div class="card pheno-featured">
          <div class="card-header" style="margin-bottom:2px;">
            <span class="card-label">云海 · 值得关注</span>
            <span>${cs ? starsHtml(cs.n) + '<span class="grade-word ' + cs.cls + '">' + cs.word + '</span>' : ''}</span>
          </div>
          <div class="pheno-window tabular">${esc(cloudSea.window)}</div>
          <div class="pheno-text">${esc(cloudSea.text)}</div>
          ${open ? `<div class="reason-panel" style="margin:10px -14px 0;">${reasonInner('cloudSea', a)}
            <div class="reason-note" style="font-weight:600;color:var(--ink);">建议：日出前抵达高处观景点。</div></div>`
            : `<div class="small" style="color:var(--forest);font-weight:600;cursor:pointer;margin-top:6px;" data-toggle="${key}">为什么今天值得去看云海？</div>`}
        </div>` : ''}
        ${othersHtml}
      </div>
    </div>`)
  sec.querySelectorAll('[data-toggle]').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.toggle
    if (state.open[k]) delete state.open[k]; else state.open[k] = true
    renderAll()
  }))
  return sec
}

function reasonInner(key, a) {
  const facts = factsFor(key, a)
  return `
    <div class="reason-title">OURTRAIL 判断依据 · 均为天气图中的可见事实</div>
    ${facts.map(f => `
      <div class="reason-item"><span class="mark pos">✓</span><span class="fact">${esc(f.fact)}</span><span class="link">看图 ↗</span></div>`).join('')}
    <div class="reason-note">基于天气数据估算，非气象预报。</div>`
}

function factsFor(key, a) {
  const d = a.detail
  const mean = (list, get) => {
    const xs = list.map(get).filter(Number.isFinite)
    return xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null
  }
  const prev = days.find(x => x.date === sky.addDays(state.date, -1))
  const bandHours = d.filter(h => h.band && h.band.cover >= 80)
  const band = bandHours.length
    ? { base: Math.min.apply(null, bandHours.map(h => h.band.base)), top: Math.max.apply(null, bandHours.map(h => h.band.top)) } : null
  const morning = d.filter(h => minuteOf(h.t) < 10 * 60)
  const F = {
    cloudSea: [
      band && ['低层云带 ' + band.base + '–' + band.top + ' m', 'band'],
      band && ['此点 ' + POINT.elevation + ' m 高于带顶 ' + band.top + ' m', 'band'],
      ['清晨低云 ' + (mean(morning, h => h.cloud.low) ?? '—') + '% · 高层 ' + (mean(morning, h => h.cloud.high) ?? '—') + '%', 'cloud'],
      ['清晨风 ' + (mean(morning, h => h.wind) ?? '—') + ' km/h', 'wind'],
      prev && prev.precipSum > 0 && ['前日降水 ' + prev.precipSum + ' mm', 'rain'],
    ],
    alpenglow: [['低云 ' + mean(d, h => h.cloud.low) + '% · 中高云 ' + mean(d, h => h.cloud.mid + h.cloud.high) + '%', 'cloud'],
      ['全日降水 ' + d.reduce((s, h) => s + h.precip + h.showers, 0).toFixed(1) + ' mm', 'rain']],
    rainbow: [['降水小时 ' + d.filter(h => h.showers + h.precip > 0).length + ' · 午后湿度 ' + mean(d.filter(h => minuteOf(h.t) >= 720), h => h.rh) + '%', 'rain']],
    galaxy: [['暗夜晴空率与月照 ' + a.moon.illumination + '%（' + a.moon.name + '）', 'cloud']],
    star: [['暗夜晴空率与月照 ' + a.moon.illumination + '%（' + a.moon.name + '）', 'cloud']],
  }
  return (F[key] || []).filter(Boolean).map(([fact]) => ({ fact }))
}

function calloutsHtml(a) {
  const out = []
  const d = a.detail
  const day = days.find(x => x.date === state.date)
  if (Number(day.code) >= 95 || d.some(h => Number(h.code) >= 95)) out.push(['danger', '有雷暴概率，不建议安排上山'])
  else if (d.some(h => { const c = Number(h.code); return (c >= 71 && c <= 77) || (c >= 85 && c <= 86) })
    || d.some(h => Number.isFinite(h.freezing) && h.freezing < POINT.elevation)) out.push(['danger', '0℃ 层低于此点，降水可能为雪'])
  const inCloud = d.some(h => h.band && h.band.base <= POINT.elevation && POINT.elevation <= h.band.top)
  if (d.some(h => Number.isFinite(h.visibility) && h.visibility < 1) || inCloud) out.push(['warning', '此点可能入云（雾），观景窗口有限'])
  if (out.length < 2 && day.precipProbMax >= 60 && d.some(h => h.t >= '12' && (h.pop >= 50 || h.showers > 0))) out.push(['warning', '午后阵雨概率高，建议早点出发'])
  return out.slice(0, 2).map(([tone, title]) => `<div class="callout ${tone}" style="margin-top:8px;"><span class="callout-title">${title}</span></div>`).join('')
}

/* ---------- 议程 ---------- */

function agendaSection() {
  const a = analyze(state.date)
  const events = buildAgenda(a)
  const items = events.map(ev => {
    if (ev.l2) {
      const st2 = starsOf(ev.item)
      const key = 'ag:' + ev.t + ev.title
      const open = state.open[key]
      return `
        <div class="agenda-item">
          <span class="ag-time tabular">${ev.t}</span>
          <span class="ag-line"><span class="ag-dot l2"></span></span>
          <div class="ag-body">
            <span class="ag-src">OURTRAIL 分析</span>
            <div class="ag-item-card" style="background:var(--${ev.item.tone === 'success' ? 'success-soft' : ev.item.tone === 'warning' ? 'warning-soft' : 'forest-soft'});" data-toggle="${key}">
              <span class="ag-title">${esc(ev.title)}</span>
              <span class="why-toggle">${open ? '收起' : '为什么？'}</span>
              <div class="ag-sub tabular">${esc(ev.win || '')} ${st2 ? starsHtml(st2.n) + '<span class="grade-word ' + st2.cls + '">' + st2.word + '</span>' : ''}</div>
            </div>
            ${open ? `<div class="reason-panel" style="margin:0;">${reasonInner(ev.item.key, a)}</div>` : ''}
          </div>
        </div>`
    }
    return `
      <div class="agenda-item">
        <span class="ag-time tabular">${ev.t}</span>
        <span class="ag-line"><span class="ag-dot l1"></span></span>
        <div class="ag-body"><span class="ag-src">天文 / 天气</span>
          <div class="ag-title">${esc(ev.title)}</div>${ev.sub ? `<div class="ag-sub tabular">${esc(ev.sub)}</div>` : ''}</div>
      </div>`
  }).join('')
  const sec = el(`
    <div>
      <div class="section-head">
        <span class="section-title">今日户外时间轴</span>
        <span class="section-sub">天文时刻与天气变化（灰）+ OurTrail 窗口（绿）</span>
      </div>
      <div class="card agenda">${items}</div>
    </div>`)
  sec.querySelectorAll('[data-toggle]').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.toggle
    if (state.open[k]) delete state.open[k]; else state.open[k] = true
    renderAll()
  }))
  return sec
}

function buildAgenda(a) {
  const ev = []
  const add = (t, title, sub, l2, item) => ev.push({ t, title, sub, l2, item })
  if (a.sun.astroDawn) add(a.sun.astroDawn, '天文晨光始', '太阳 -18°', false)
  if (a.win.dawnBlue) add(a.win.dawnBlue.from, '蓝调时刻（晨）', null, false)
  if (a.sun.sunrise) add(a.sun.sunrise, '日出', null, false)
  if (a.sun.sunset) add(a.sun.sunset, '日落', null, false)
  if (a.win.eveningGolden) add(a.win.eveningGolden.from, '黄金时刻（昏）', null, false)
  if (a.sun.astroDusk) add(a.sun.astroDusk, '天文暗夜始', '银河窗口开始', false)
  const d = a.detail
  for (let i = 1; i < d.length; i++) {
    const wet0 = d[i - 1].precip + d[i - 1].showers > 0, wet1 = d[i].precip + d[i].showers > 0
    if (wet1 && !wet0) add(d[i].t, d[i].temp <= 1 ? '降雪开始' : '降水开始', phraseOf(d[i].code), false)
    if (!wet1 && wet0) add(d[i].t, '降水结束', null, false)
    const dl = d[i].cloud.low - d[i - 1].cloud.low
    if (dl >= 25) add(d[i].t, '云层上升', d[i - 1].cloud.low + '% → ' + d[i].cloud.low + '%', false)
    if (dl <= -25) add(d[i].t, '云层消散', d[i - 1].cloud.low + '% → ' + d[i].cloud.low + '%', false)
  }
  const names = { cloudSea: '云海观察窗口', alpenglow: '日照金山可能', rainbow: '彩虹可能', galaxy: '银河窗口', star: '星空条件' }
  const clusters = []
  let cur = null
  for (const h of d) {
    const list = a.marks[h.d + 'T' + h.t] || []
    const key = ['cloudSea', 'alpenglow', 'rainbow', 'galaxy', 'star'].find(k => list.indexOf(k) !== -1) || null
    if (key && cur && cur.key === key && minuteOf(h.t) === minuteOf(cur.to) + 60) { cur.to = h.t; cur.n++ }
    else if (key) { if (cur) clusters.push(cur); cur = { key, from: h.t, to: h.t, n: 1 } }
    else if (cur) { clusters.push(cur); cur = null }
  }
  if (cur) clusters.push(cur)
  for (const c of clusters) {
    const item = itemOf(a, c.key)
    add(c.from, names[c.key], null, true, item)
    ev[ev.length - 1].win = c.from === c.to ? c.from : c.from + '–' + c.to
  }
  ev.sort((x, y) => minuteOf(x.t) - minuteOf(y.t))
  return ev.filter((e, i) => i === 0 || !(e.t === ev[i - 1].t && e.title === ev[i - 1].title))
}

/* ---------- 数字明细 + 页脚 ---------- */

function numbersSection() {
  const a = analyze(state.date)
  const key = 'nums'
  if (!state.open[key]) {
    const t = el(`<div class="num-toggle" data-toggle="${key}">展开逐小时数据（温度 · 湿度 · 风 · 气压 · 能见度）</div>`)
    t.addEventListener('click', () => { state.open[key] = true; renderAll() })
    return t
  }
  const rows = a.detail.map(h => `
    <div class="reason-item" style="padding:2px 0;">
      <span class="fact tabular">${h.t} · ${Math.round(h.temp)}°C · 湿度 ${h.rh}% · 风 ${h.wind}km/h · 气压 ${h.pressure}hPa · 能见度 ${h.visibility}km ${h.band ? '· 云带 ' + h.band.base + '–' + h.band.top + 'm' : ''}</span>
    </div>`).join('')
  const wrap = el(`<div><div class="card"><div style="max-height:280px;overflow-y:auto;">${rows}</div></div>
    <div class="num-toggle" data-toggle="${key}" style="margin-top:10px;">收起逐小时数据</div></div>`)
  wrap.querySelectorAll('[data-toggle]').forEach(t2 => t2.addEventListener('click', () => { delete state.open[key]; renderAll() }))
  return wrap
}

function footerNote() {
  return el(`
    <div class="pt-footer stack" style="gap:8px;">
      <div class="callout warning" style="text-align:left;">这是概率判断，不是出发许可。云层与云海为模型推算——出发前请核实当地气象与路况。</div>
      <span class="small muted">模拟图仅为评估嵌入效果，非 meteoblue 真实输出 · 天气数据 ${META.provider.attribution}<br>OurTrail 分析 = 对天气事实的条件解读，仅供参考</span>
    </div>`)
}

renderAll()
