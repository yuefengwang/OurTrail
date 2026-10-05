// Weather UX Prototype · 渲染逻辑（浏览器，无构建、无依赖）。
//
// 数据：window.OTmock（mock/genie-72h.js 的导出，形状 = NormalizedWeatherData）
// 引擎：window.OTengine（生产 astro.js / format.js / sky.js 原样打包，阈值零漂移）
// 渲染： vanilla DOM + SVG。图表区在正式实现中对应 canvas 2d 自绘（规格见
//        docs/weather-ux/weather-ux-design.md §8，本原型用 SVG 验证视觉与信息密度）。
'use strict'
/* global OTmock, OTengine */

const { POINT, META, days, hours } = OTmock
const { astro, format, sky } = OTengine

/* ---------- 常量 ---------- */

// 剧情内的「现在」：出发日清晨 06:30 打开页面（决定 now 线与 now 圆点的呈现）
const STORY_NOW = { date: '2026-10-06', t: '06:30' }
const ELE_MIN = 0        // 云层带剖面纵轴下限（m）
const ELE_MAX = 6000     // 云层带剖面纵轴上限（m）

// 三档 → 星级。最高四星：留一星给「任何模型都无法保证」的那部分，见设计规格 §6.2
function starsOf(item) {
  if (!item || item.label === '客观时刻') return null
  if (item.score >= 70) return { n: 4, cls: 'g-success', word: '条件较好' }
  if (item.score >= 45) return { n: 3, cls: 'g-warning', word: '条件一般' }
  return { n: 2, cls: 'g-neutral', word: '条件较差' }
}
function starsHtml(n) {
  let s = ''
  for (let i = 0; i < 5; i++) s += i < n ? '★' : '<span class="off">★</span>'
  return '<span class="stars">' + s + '</span>'
}

/* ---------- 状态 ---------- */

const state = {
  date: '2026-10-06',
  span: 24,            // 24 / 48
  hour: null,          // 'HH:00' 点选的列
  open: {},            // 展开的「为什么」面板 key → true
}

/* ---------- 引擎分析（按日缓存） ---------- */

const cache = {}
function analyze(date) {
  if (cache[date]) return cache[date]
  const detail = hours.filter(h => h.d === date)
  const ctx = {
    date, lat: POINT.lat, lng: POINT.lng,
    elevation: POINT.elevation, elevOK: true,
    detail, days, heading: 75, // 演示走向：东偏北（垭口朝东的日出场景）
  }
  const summary = sky.summarize(ctx)
  // sky.hourMarks 的键是 'HH:mm'（带日期前缀是 weather 页 buildChartMarks 的职责），
  // 这里同样补上日期前缀，供跨小时查询使用
  const marksFlat = {}
  const raw = sky.hourMarks(ctx)
  Object.keys(raw).forEach(t => { marksFlat[date + 'T' + t] = raw[t] })
  const sun = astro.sunTimes(date, POINT.lat, POINT.lng, POINT.elevation)
  const win = astro.photoWindows(date, POINT.lat, POINT.lng, POINT.elevation)
  const moon = astro.moonInfo(date)
  return (cache[date] = { detail, summary, marks: marksFlat, sun, win, moon })
}

function itemOf(a, key) { return a.summary.items.filter(x => x.key === key)[0] || null }

/* ---------- 小工具 ---------- */

function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') }
function minuteOf(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) }
function phraseOf(code) { return format.weatherPhrase(code).label }

// 「时段 × 事实」清单：ReasonPanel 的证据行。facts 全部为 L1 可见图上/表内事实，
// 指标选取与 sky.js §6 的信号表一致（映射表在 weather-ux-design.md §9.4）。
function factsFor(key, a) {
  const d = a.detail
  const mean = (list, get) => {
    const xs = list.map(get).filter(Number.isFinite)
    return xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null
  }
  const prev = days.find(x => x.date === sky.addDays(state.date, -1))
  const bandHours = d.filter(h => h.band && h.band.cover >= 80)
  const band = bandHours.length
    ? { base: Math.min.apply(null, bandHours.map(h => h.band.base)), top: Math.max.apply(null, bandHours.map(h => h.band.top)) }
    : null
  const morning = d.filter(h => minuteOf(h.t) < 10 * 60)
  const night = d.filter(h => {
    const dawn = minuteOf(a.sun.astroDawn), dusk = minuteOf(a.sun.astroDusk)
    const m = minuteOf(h.t)
    return m < dawn || m > dusk
  })
  const clearRate = night.length
    ? Math.round(night.filter(h => (h.cloud.mid + h.cloud.high) / 2 < 30 && h.precip + h.showers === 0).length / night.length * 100)
    : null
  const F = {
    cloudSea: [
      band && ['低层云带 ' + band.base + '–' + band.top + ' m', 'band'],
      band && ['此点 ' + POINT.elevation + ' m ' + (POINT.elevation > band.top ? '高于' : '不高于') + '带顶 ' + band.top + ' m', 'band'],
      ['清晨低云 ' + (mean(morning, h => h.cloud.low) ?? '—') + '%', 'cloud'],
      ['清晨高层云 ' + (mean(morning, h => h.cloud.high) ?? '—') + '%', 'cloud'],
      ['清晨风 ' + (mean(morning, h => h.wind) ?? '—') + ' km/h', 'wind'],
      prev && prev.precipSum > 0 && ['前日降水 ' + prev.precipSum + ' mm', 'rain'],
    ],
    alpenglow: [
      ['低云 ' + (mean(d, h => h.cloud.low) ?? '—') + '%', 'cloud'],
      ['中高云 ' + (mean(d, h => h.cloud.mid + h.cloud.high) ?? '—') + '%', 'cloud'],
      ['降水 ' + d.reduce((s, h) => s + h.precip + h.showers, 0).toFixed(1) + ' mm', 'rain'],
    ],
    rainbow: [
      ['时段内降水/阵雨 ' + d.filter(h => h.showers > 0 || h.precip > 0).length + ' 小时', 'rain'],
      ['午后湿度 ' + (mean(d.filter(h => minuteOf(h.t) >= 12 * 60), h => h.rh) ?? '—') + '%', 'rh'],
    ],
    galaxy: [
      ['暗夜晴空 ' + (clearRate ?? '—') + '%', 'cloud'],
      ['月照 ' + a.moon.illumination + '%（' + a.moon.name + '）', 'moon'],
      ['高层云 ' + (mean(night, h => h.cloud.high) ?? '—') + '%', 'cloud'],
    ],
    star: [
      ['暗夜晴空 ' + (clearRate ?? '—') + '%', 'cloud'],
      ['月照 ' + a.moon.illumination + '%（' + a.moon.name + '）', 'moon'],
    ],
    light: [
      ['日出 ' + a.sun.sunrise + ' · 日落 ' + a.sun.sunset, 'sun'],
    ],
  }
  return (F[key] || []).filter(Boolean).map(([fact, anchor]) => ({ fact, anchor }))
}

/* ---------- 渲染 ---------- */

function renderAll() {
  const app = document.getElementById('app')
  app.innerHTML = ''
  app.appendChild(header())
  app.appendChild(dayStrip())
  app.appendChild(timelineSection())
  app.appendChild(sunCard())
  app.appendChild(agendaSection())
  app.appendChild(conditionsSection())
  app.appendChild(numbersSection())
  app.appendChild(footerNote())
}

/* 页头：地点 + 日期 + 数据源（Level 0 元信息，不做任何判断） */
function header() {
  const a = analyze(state.date)
  const wd = '周' + '日一二三四五六'[new Date(state.date + 'T12:00:00+08:00').getUTCDay()]
  const md = state.date.slice(5, 10).replace('-', ' 月 ') + ' 日'
  return el(`
    <div class="pt-header">
      <span class="eyebrow">行前参考</span>
      <span class="page-title">留意天气，也留意天相。</span>
      <div class="pt-meta">
        <span class="pt-place">${esc(POINT.name)} <span class="ele tabular">· ${POINT.elevation} m</span></span>
        <span class="pt-src tabular">${md} · ${wd}<br>${META.provider.label} · ${META.updatedAt.slice(11, 16)} 更新</span>
      </div>
    </div>`)
}

/* 7 日条：纯事实。选中日切换。 */
function dayStrip() {
  const wrap = el('<div class="day-strip"></div>')
  const list = days.filter(d => d.date >= '2026-10-06')
  for (const day of list) {
    const wd = '日一二三四五六'[new Date(day.date + 'T12:00:00+08:00').getUTCDay()]
    // 「今天/昨天/明天」相对剧情内的时间（STORY_NOW.date），与选中态无关——
    // 选中 10-08 时它应显示「周四」，而 10-06 依然是「今天」
    let label = '周' + wd
    if (day.date === STORY_NOW.date) label = '今天'
    else if (day.date === sky.addDays(STORY_NOW.date, 1)) label = '明天'
    else if (day.date === sky.addDays(STORY_NOW.date, -1)) label = '昨天'
    const c = el(`
      <div class="day-card ${day.date === state.date ? 'on' : ''}" data-date="${day.date}">
        <span class="day-label">${label}</span>
        <span class="day-ico">${phraseOf(day.code)}</span>
        <span class="day-temp tabular">${day.tMax}° <span class="lo">${day.tMin}°</span></span>
        <span class="day-rain tabular">☂${day.precipProbMax}%</span>
      </div>`)
    c.addEventListener('click', () => { state.date = day.date; state.hour = null; renderAll() })
    wrap.appendChild(c)
  }
  return wrap
}

/* ---------- 逐时天气图（核心事实区） ---------- */

const TL = {
  padL: 30, padR: 4,
  rows: {
    icon: { y: 12 },
    temp: { y: 22, h: 42 },
    rain: { y: 70, h: 26 },
    cloud: { y: 102, h: 24 },     // 3×7px
    profile: { y: 132, h: 30 },   // 云层带剖面
    wind: { y: 168, h: 16 },
    axisBand: { y: 190, h: 7 },   // 昼夜/晨昏光条
    axis: { y: 202, h: 14 },
  },
  total: 220,
}

function timelineSection() {
  const a = analyze(state.date)
  const cols = state.span === 24 ? a.detail : hours.filter(h => h.d >= state.date).slice(0, 48)
  const cw = 12.5
  const W = TL.padL + cols.length * cw + TL.padR
  const H = TL.total
  const x = i => TL.padL + i * cw
  const cx = i => x(i) + cw / 2

  // 夜间列集合（天文暮光外）
  const dawnM = minuteOf(a.sun.astroDawn), duskM = minuteOf(a.sun.astroDusk)
  const isNight = h => { const m = minuteOf(h.t); return m < dawnM || m > duskM }

  /* 温度 */
  const temps = cols.map(h => h.temp)
  const tLo = Math.min.apply(null, temps), tHi = Math.max.apply(null, temps)
  const ty = t => TL.rows.temp.y + TL.rows.temp.h - 6 - (t - tLo) / Math.max(1, tHi - tLo) * (TL.rows.temp.h - 14)
  const iMax = temps.indexOf(tHi), iMin = temps.indexOf(tLo)
  let tempPath = '', tempArea = ''
  cols.forEach((h, i) => { tempPath += (i ? 'L' : 'M') + cx(i).toFixed(1) + ',' + ty(h.temp).toFixed(1) })
  tempArea = tempPath + `L${cx(cols.length - 1)},${TL.rows.temp.y + TL.rows.temp.h}L${cx(0)},${TL.rows.temp.y + TL.rows.temp.h}Z`

  /* 降水 */
  const maxPrecip = Math.max(0.1, Math.max.apply(null, cols.map(h => Math.max(h.precip + h.showers, 0))))
  const rainBars = cols.map((h, i) => {
    const v = h.precip + h.showers
    if (v <= 0) return ''
    const bh = Math.max(1.5, v / maxPrecip * (TL.rows.rain.h - 4))
    const color = h.showers > h.precip ? 'var(--showers)' : 'var(--info)'
    return `<rect x="${x(i) + 2}" y="${TL.rows.rain.y + TL.rows.rain.h - bh}" width="${cw - 4}" height="${bh}" fill="${color}" opacity="${0.45 + 0.55 * h.pop / 100}" rx="1"/>`
  }).join('')
  const popBands = cols.map((h, i) =>
    h.pop >= 50 ? `<rect x="${x(i)}" y="${TL.rows.rain.y - 2}" width="${cw}" height="${TL.rows.rain.h + 3}" fill="var(--info)" opacity="0.10"/>` : '').join('')

  /* 三层云量 */
  const cloudRows = [['high', 'var(--control-line)'], ['mid', 'var(--blue-hour)'], ['low', 'var(--info)']]
    .map(([k, color], r) => cols.map((h, i) =>
      `<rect x="${x(i)}" y="${TL.rows.cloud.y + r * 8}" width="${cw}" height="7" fill="${color}" opacity="${0.08 + 0.92 * h.cloud[k] / 100}"/>`
    ).join('')).join('')

  /* 云层带剖面（云海读图区） */
  const py = alt => TL.rows.profile.y + TL.rows.profile.h - 2 - (alt - ELE_MIN) / (ELE_MAX - ELE_MIN) * (TL.rows.profile.h - 4)
  const bandRects = cols.map((h, i) => {
    if (!h.band) return ''
    const yTop = py(h.band.top), yBase = py(h.band.base)
    return `<rect x="${x(i) + 0.5}" y="${yTop}" width="${cw - 1}" height="${Math.max(2, yBase - yTop)}" fill="var(--info)" opacity="${0.25 + 0.6 * h.band.cover / 100}"/>`
  }).join('')
  const seaTint = cols.map((h, i) => {
    const list = a.marks[h.d + 'T' + h.t] || []
    return list.indexOf('cloudSea') !== -1
      ? `<rect x="${x(i)}" y="${TL.rows.profile.y}" width="${cw}" height="${TL.rows.profile.h}" fill="var(--success)" opacity="0.12"/>` : ''
  }).join('')
  const inCloudTint = cols.map((h, i) => {
    if (!h.band) return ''
    const inBand = h.band.base <= POINT.elevation && POINT.elevation <= h.band.top
    return inBand ? `<rect x="${x(i)}" y="${TL.rows.profile.y}" width="${cw}" height="${TL.rows.profile.h}" fill="var(--warning)" opacity="0.14"/>` : ''
  }).join('')
  const eleLine = py(POINT.elevation)

  /* 风：箭头 + 数值，每 3 小时 */
  const windTicks = cols.map((h, i) => {
    if (i % 3 !== 0) return ''
    const dir = (h.windDir + 180) % 360 // 箭头指向风吹去的方向
    return `<g transform="translate(${cx(i)},${TL.rows.wind.y + 6}) rotate(${dir})">
        <path d="M0,4 L0,-2 M0,-2 L-2.4,0.6 M0,-2 L2.4,0.6" stroke="var(--muted)" stroke-width="1.1" fill="none"/>
      </g>
      <text x="${cx(i)}" y="${TL.rows.wind.y + 15}" font-size="8" fill="var(--muted)" text-anchor="middle" class="tabular">${h.wind}</text>`
  }).join('')

  /* 天气简字：每 3 小时 */
  const icons = cols.map((h, i) => {
    if (i % 3 !== 0) return ''
    const warn = h.pop >= 50 || h.code >= 95
    return `<text x="${cx(i)}" y="${TL.rows.icon.y}" font-size="9" font-weight="600" text-anchor="middle"
      fill="${warn ? 'var(--warning)' : 'var(--muted)'}">${phraseOf(h.code)}</text>`
  }).join('')

  /* 温度极值标注 */
  const tLabels = `
    <text x="${cx(iMax)}" y="${ty(tHi) - 4}" font-size="9" font-weight="700" fill="var(--ink)" text-anchor="middle" class="tabular">${Math.round(tHi)}°</text>
    <text x="${cx(iMin)}" y="${ty(tLo) + 11}" font-size="9" fill="var(--muted)" text-anchor="middle" class="tabular">${Math.round(tLo)}°</text>`

  /* 时间轴：昼夜条 + 刻度 + 日出日落线 */
  const segs = cols.map((h, i) => {
    const m = minuteOf(h.t)
    const alt = astro.solarPosition(astro.cnToMs(h.d, h.t), POINT.lat, POINT.lng).altitude
    let fill = 'var(--chart-night)'
    if (alt >= 6) fill = 'var(--forest-soft)'
    else if (alt >= 0) fill = 'var(--golden)'
    else if (alt >= -6) fill = 'var(--blue-hour)'
    else if (alt >= -18) fill = 'var(--control-line)'
    return `<rect x="${x(i)}" y="${TL.rows.axisBand.y}" width="${cw}" height="${TL.rows.axisBand.h}" fill="${fill}" opacity="0.85"/>`
  }).join('')
  const hourTicks = cols.map((h, i) => {
    const hh = Number(h.t.slice(0, 2))
    if (hh % 6 !== 0) return ''
    return `<text x="${x(i) + 1}" y="${TL.rows.axis.y + 9}" font-size="9" fill="var(--muted)" class="tabular">${pad2(hh)}</text>`
  }).join('')
  // 日出/日落线：窗口内每个自然日各画一对（48h 视图含两天）
  const sunLines = [...new Set(cols.map(h => h.d))].map(d => {
    const s = astro.sunTimes(d, POINT.lat, POINT.lng, POINT.elevation)
    return [s.sunrise, s.sunset]
  }).flat().filter(Boolean).map(t => {
    if (!t) return ''
    const i = cols.findIndex(h => minuteOf(h.t) <= minuteOf(t) && minuteOf(t) < minuteOf(h.t) + 60)
    if (i < 0) return ''
    const px = x(i) + cw * (minuteOf(t) % 60) / 60
    return `<line x1="${px}" y1="14" x2="${px}" y2="${TL.rows.axis.y}" stroke="var(--golden)" stroke-width="1" stroke-dasharray="2 2"/>`
  }).join('')
  // 「现在」竖线：定位到包含 STORY_NOW 时刻的那一列
  const nowMin = minuteOf(STORY_NOW.t)
  const nowIdx = state.date === STORY_NOW.date
    ? cols.findIndex(h => minuteOf(h.t) <= nowMin && nowMin < minuteOf(h.t) + 60) : -1
  const nowLine = nowIdx >= 0
    ? `<line x1="${x(nowIdx)}" y1="4" x2="${x(nowIdx)}" y2="${TL.rows.axis.y}" stroke="var(--forest)" stroke-width="1.5"/><circle cx="${x(nowIdx)}" cy="4" r="2.2" fill="var(--forest)"/>` : ''

  /* 点选高亮列 */
  const selRect = state.hour
    ? (() => {
      const i = cols.findIndex(h => h.t === state.hour)
      return i >= 0 ? `<rect x="${x(i)}" y="0" width="${cw}" height="${TL.rows.axis.y}" fill="var(--forest)" opacity="0.08"/>` : ''
    })() : ''

  /* 命中区域（点选） */
  const hits = cols.map((h, i) =>
    `<rect x="${x(i)}" y="0" width="${cw}" height="${TL.rows.axis.y}" fill="transparent" data-hour="${h.t}" style="cursor:pointer"/>`).join('')

  const svg = `<svg class="tl-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="inherit">
    <!-- 夜间底色（整高，最底层） -->
    ${cols.map((h, i) => isNight(h) ? `<rect x="${x(i)}" y="0" width="${cw}" height="${TL.rows.axis.y}" fill="var(--chart-night)"/>` : '').join('')}
    ${selRect}
    <!-- 溢出裁剪 -->
    <clipPath id="body"><rect x="${TL.padL}" y="0" width="${cols.length * cw}" height="${TL.rows.axis.y}"/></clipPath>
    <g clip-path="url(#body)">
      ${icons}
      <!-- 温度 -->
      <path d="${tempArea}" fill="var(--ink)" opacity="0.07"/>
      <path d="${tempPath}" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round"/>
      ${tLabels}
      <!-- 降水 -->
      ${popBands}${rainBars}
      <text x="${TL.padL - 4}" y="${TL.rows.rain.y + 8}" font-size="8" fill="var(--muted)" text-anchor="end" class="tabular">${maxPrecip.toFixed(1)}</text>
      <!-- 云量三层 -->
      ${cloudRows}
      <!-- 云层带剖面 -->
      ${seaTint}${inCloudTint}${bandRects}
      <line x1="${TL.padL}" y1="${eleLine}" x2="${TL.padL + cols.length * cw}" y2="${eleLine}" stroke="var(--forest)" stroke-width="1" stroke-dasharray="3 2"/>
      <!-- 风 -->
      ${windTicks}
    </g>
    <!-- 行标签（左栏） -->
    ${['温', '雨', '云', '带', '风'].map((ch, r) => {
      const ys = [TL.rows.temp.y + 16, TL.rows.rain.y + 12, TL.rows.cloud.y + 14, TL.rows.profile.y + 18, TL.rows.wind.y + 10]
      return `<text x="6" y="${ys[r]}" font-size="8" fill="var(--muted)">${ch}</text>`
    }).join('')}
    <!-- 昼夜/晨昏光条 + 轴 -->
    ${segs}${sunLines}
    <line x1="${TL.padL}" y1="${TL.rows.axis.y}" x2="${W - TL.padR}" y2="${TL.rows.axis.y}" stroke="var(--chart-grid)" stroke-width="1"/>
    ${hourTicks}${nowLine}
    <g id="hits">${hits}</g>
  </svg>`

  const card = el(`
    <div>
      <div class="section-head">
        <span class="section-title">逐时天气<span class="level-tag level-fact">天气事实</span></span>
        <span class="section-sub">温度 · 降水 · 云层带 · 风 · 昼夜 — 数据来自 ${META.provider.label}</span>
      </div>
      <div class="card timeline-card">
        <div class="tl-viewseg">
          <div class="seg-btn ${state.span === 24 ? 'on' : ''}" data-span="24">24 小时</div>
          <div class="seg-btn ${state.span === 48 ? 'on' : ''}" data-span="48">48 小时</div>
        </div>
        <div class="tl-scroll">${svg}</div>
        <div class="small muted" style="margin:6px 4px 2px;">「带」= ≥80% 成层低云（模型垂直剖面）· 虚线 = 此点海拔 ${POINT.elevation} m · 灰底 = 天文暗夜</div>
        <div class="hour-detail ${state.hour ? 'show' : ''}" id="hourDetail"></div>
      </div>
    </div>`)

  card.querySelectorAll('[data-span]').forEach(b => b.addEventListener('click', () => { state.span = Number(b.dataset.span); state.hour = null; renderAll() }))
  card.querySelectorAll('#hits rect').forEach(r => r.addEventListener('click', () => { state.hour = r.dataset.hour; renderAll() }))
  if (state.hour) card.querySelector('#hourDetail').innerHTML = hourDetailHtml(a)
  return card
}

function pad2(n) { return (n < 10 ? '0' : '') + n }

/* 点选小时浮条：L1 数字 + 该小时的 L2 归属 */
function hourDetailHtml(a) {
  const h = a.detail.find(x => x.t === state.hour)
  if (!h) return ''
  const list = a.marks[h.d + 'T' + h.t] || []
  const names = { cloudSea: '云海窗口', alpenglow: '光染可能', golden: '黄金时刻', blueHour: '蓝调时刻', rainbow: '彩虹可能', star: '星空', galaxy: '银河', inCloud: '入云' }
  const tags = list.filter(k => k !== 'inCloud').map(k => `<span class="hd-tag">· ${names[k]}</span>`).join('')
  const inCloud = list.indexOf('inCloud') !== -1 ? '<span class="hd-tag" style="color:var(--warning)">· 处于云层带内</span>' : ''
  return `<b class="tabular">${h.t}</b> ${phraseOf(h.code)} · ${Math.round(h.temp)}°C（体感 ${Math.round(h.feels)}°）
    · 降水 ${h.pop}% ${h.precip + h.showers > 0 ? (h.precip + h.showers).toFixed(1) + 'mm' : ''}
    · 风 ${h.wind} km/h · 湿度 ${h.rh}%
    ${h.band ? '· 云带 ' + h.band.base + '–' + h.band.top + ' m' : ''}
    ${tags}${inCloud}`
}

/* ---------- 日照条（SunTimeline） ---------- */

function sunCard() {
  const a = analyze(state.date)
  // 24h × 2 段/小时，按太阳高度角分类
  const segs = []
  for (let m = 0; m < 1440; m += 30) {
    const hh = pad2(Math.floor(m / 60)) + ':' + pad2(m % 60)
    const alt = astro.solarPosition(astro.cnToMs(state.date, hh), POINT.lat, POINT.lng).altitude
    segs.push(alt >= 6 ? 'day' : alt >= 0 ? 'golden' : alt >= -6 ? 'blue' : alt >= -18 ? 'twi' : 'night')
  }
  const colors = { day: 'var(--forest-soft)', golden: 'var(--golden)', blue: 'var(--blue-hour)', twi: 'var(--control-line)', night: 'var(--chart-night)' }
  const bar = segs.map(s => `<div class="sun-seg" style="flex:1;background:${colors[s]}"></div>`).join('')
  return el(`
    <div class="card sun-card">
      <div class="card-header" style="margin-bottom:2px;">
        <span class="card-label">今日日照</span>
        <span class="small muted tabular">昼长 ${dayLength(a.sun)}</span>
      </div>
      <div class="sun-bar">${bar}</div>
      <div class="sun-legend"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
      <div class="sun-row">
        <span>日出 <b class="tabular">${a.sun.sunrise}</b></span>
        <span>日落 <b class="tabular">${a.sun.sunset}</b></span>
        <span>黄金 <b class="tabular">晨${a.win.morningGolden ? a.win.morningGolden.from : '—'} 昏${a.win.eveningGolden ? a.win.eveningGolden.from : '—'}</b></span>
        <span>蓝调 <b class="tabular">晨${a.win.dawnBlue ? a.win.dawnBlue.from : '—'} 昏${a.win.duskBlue ? a.win.duskBlue.from : '—'}</b></span>
      </div>
    </div>`)
}
function dayLength(sun) {
  if (!sun.sunrise || !sun.sunset) return '—'
  const m = minuteOf(sun.sunset) - minuteOf(sun.sunrise)
  return Math.floor(m / 60) + 'h' + pad2(m % 60) + 'm'
}

/* ---------- 今日户外时间轴（Agenda） ---------- */

function agendaSection() {
  const a = analyze(state.date)
  const events = buildAgenda(a)

  const items = events.map(ev => {
    const nowDot = ev.l2 !== true && state.date === STORY_NOW.date
      && Math.abs(minuteOf(ev.t) - minuteOf(STORY_NOW.t)) < 45 ? ' now' : ''
    const dot = ev.l2 ? ' l2' : ' l1'
    let body
    if (ev.l2) {
      const st = starsOf(ev.item)
      const key = 'ag:' + ev.t + ev.title
      const open = state.open[key]
      const reasons = open ? reasonPanelHtml(ev.item.key, a, ev) : ''
      body = `
        <div class="ag-item-card ${open ? 'g-open' : ''}" style="background:var(--${toneSoft(ev.item)});" data-toggle="${key}">
          <span class="ag-title">${esc(ev.title)}</span>
          <span class="why-toggle">${open ? '收起' : '为什么？'}</span>
          <div class="ag-sub tabular">${esc(ev.win || '')} ${st ? starsHtml(st.n) + '<span class="grade-word ' + st.cls + '">' + st.word + '</span>' : ''}</div>
        </div>${reasons}`
    } else {
      body = `<div class="ag-title">${esc(ev.title)}</div><div class="ag-sub tabular">${esc(ev.sub || '')}</div>`
    }
    return `
      <div class="agenda-item">
        <span class="ag-time tabular">${ev.t}</span>
        <span class="ag-line"><span class="ag-dot${dot}${nowDot}"></span></span>
        <div class="ag-body">
          <span class="ag-src">${ev.l2 ? 'OURTRAIL 分析' : '天文/天气'}</span>
          ${body}
        </div>
      </div>`
  }).join('')

  const sec = el(`
    <div>
      <div class="section-head">
        <span class="section-title">今日户外时间轴</span>
        <span class="section-sub">天文时刻与天气变化（灰）+ OurTrail 窗口（绿），按时间排</span>
      </div>
      <div class="card agenda">${items}</div>
    </div>`)
  sec.querySelectorAll('[data-toggle]').forEach(c => c.addEventListener('click', () => {
    const k = c.dataset.toggle
    if (state.open[k]) delete state.open[k]; else state.open[k] = true
    renderAll()
    // 重渲染后滚回该卡片：简单起见回到 agenda 区
    document.querySelector('.agenda').scrollIntoView({ block: 'nearest' })
  }))
  // 「看图 ↗」：滚到天气图并把高亮列定位到该事实对应的时段（band/cloud 等锚点映射到窗口起点）
  sec.querySelectorAll('[data-jump]').forEach(l => l.addEventListener('click', e => {
    e.stopPropagation()
    const a2 = analyze(state.date)
    const anchorT = anchorHour(a2)
    if (anchorT) { state.hour = anchorT; renderAll() }
    const tl = document.querySelector('.timeline-card')
    if (tl) tl.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }))
  return sec
}

// 「看图」锚点：把当前打开的窗口起点作为高亮列
function anchorHour(a) {
  for (const k of Object.keys(state.open)) {
    if (k.indexOf('ag:') === 0) { const t = k.slice(3, 8); if (/^\d{2}:\d{2}$/.test(t)) return t }
    if (k.indexOf('ph:') === 0) {
      const item = itemOf(a, k.slice(3))
      const w = item && item.window
      if (w) return w.slice(0, 5)
    }
  }
  return null
}

function toneSoft(item) {
  return item.tone === 'success' ? 'success-soft' : item.tone === 'warning' ? 'warning-soft' : 'forest-soft'
}

/* 事件合成：L1 = 天文/天气事实；L2 = sky.js 判定的窗口（唯一来源是 hourMarks + summarize） */
function buildAgenda(a) {
  const ev = []
  const add = (t, title, sub, l2, item) => ev.push({ t, title, sub, l2, item })

  add('00:00', '一天开始', null, false)
  // 天文事实
  if (a.sun.astroDawn) add(a.sun.astroDawn, '天文晨光始', '天空开始变亮（太阳 -18°）', false)
  if (a.win.dawnBlue) add(a.win.dawnBlue.from, '蓝调时刻（晨）', '太阳 -4°，天空最蓝的十几分钟', false)
  if (a.win.morningGolden) add(a.win.morningGolden.from, '黄金时刻（晨）', '太阳升至 6°，斜射暖光', false)
  if (a.sun.sunrise) add(a.sun.sunrise, '日出', null, false)
  if (a.sun.sunset) add(a.sun.sunset, '日落', null, false)
  if (a.win.eveningGolden) add(a.win.eveningGolden.from, '黄金时刻（昏）', '太阳降至 6° 以下', false)
  if (a.win.duskBlue) add(a.win.duskBlue.from, '蓝调时刻（昏）', '日落后 -4°～-6°', false)
  if (a.sun.astroDusk) add(a.sun.astroDusk, '天文暗夜始', '银河/深空观测窗口开始', false)

  // 天气转折：降水起止 + 云量跃变
  const d = a.detail
  for (let i = 1; i < d.length; i++) {
    const wet0 = d[i - 1].precip + d[i - 1].showers > 0
    const wet1 = d[i].precip + d[i].showers > 0
    if (wet1 && !wet0) add(d[i].t, d[i].temp <= 1 ? '降雪开始' : '降水开始', phraseOf(d[i].code) + '，注意防雨/防滑', false)
    if (!wet1 && wet0) add(d[i].t, '降水结束', null, false)
    const dl = d[i].cloud.low - d[i - 1].cloud.low
    if (dl >= 25) add(d[i].t, '云层上升', '低云 ' + d[i - 1].cloud.low + '% → ' + d[i].cloud.low + '%', false)
    if (dl <= -25) add(d[i].t, '云层消散', '低云 ' + d[i - 1].cloud.low + '% → ' + d[i].cloud.low + '%', false)
  }

  // OurTrail 窗口：hourMarks 聚类（与图上标记、结论卡同源）
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
    if (c.n < 1) continue
    const item = itemOf(a, c.key)
    const title = names[c.key]
    add(c.from, title, null, true, item)
    ev[ev.length - 1].win = c.from === c.to ? c.from : c.from + '–' + c.to
  }

  ev.sort((x, y) => minuteOf(x.t) - minuteOf(y.t))
  // 去重：同一时刻同标题
  return ev.filter((e, i) => i === 0 || !(e.t === ev[i - 1].t && e.title === ev[i - 1].title))
}

/* 「为什么」面板：证据行（L1 事实 + 图表锚点）→ OurTrail 判断 */
function reasonPanelHtml(key, a, ev) {
  const facts = factsFor(key, a)
  const rows = facts.map(f => `
    <div class="reason-item">
      <span class="mark pos">✓</span>
      <span class="fact">${esc(f.fact)}</span>
      <span class="link" data-jump="${f.anchor}">看图 ↗</span>
    </div>`).join('')
  const note = key === 'cloudSea'
    ? '如果你在云层上方（如山脊/垭口），有机会看到云海；在山谷里看到的是雾。' +
      '<br>建议：日出前抵达高处观景点。'
    : key === 'galaxy' ? '关掉手电、避开城镇光害，找开阔视野。' : ''
  return `
    <div class="reason-panel">
      <div class="reason-title">OURTRAIL 判断依据 · 均为上方图表中的可见事实</div>
      ${rows}
      ${note ? '<div class="reason-note">' + note + '</div>' : ''}
      <div class="reason-note">基于天气数据估算，非气象预报；具体山谷的云海与光染任何产品都无法保证。</div>
    </div>`
}

/* ---------- 户外条件（OurTrail 分析区） ---------- */

function conditionsSection() {
  const a = analyze(state.date)
  // 综合评级：与 utils/weather-model.js judge() 同规则（有戏的项取均值，不新增阈值）
  const live = a.summary.items.filter(x => x.score >= 45 && x.key !== 'light')
  const pool = live.length ? live : a.summary.items.filter(x => x.key !== 'light')
  const score = Math.round(pool.reduce((s, x) => s + x.score, 0) / pool.length)
  const fakeItem = { score, label: '', tone: sky.grade(score).tone }
  const st = starsOf({ score, label: '' })
  st.word = sky.grade(score).label

  const cloudSea = itemOf(a, 'cloudSea')
  const others = ['alpenglow', 'rainbow', 'galaxy', 'star'].map(k => itemOf(a, k)).filter(Boolean)

  const othersHtml = others.map((item, idx) => {
    const s = starsOf(item)
    const key = 'ph:' + item.key
    const open = state.open[key]
    return `
      <div class="card pheno-card" style="${open ? 'padding-bottom:0;' : ''}">
        <div class="card-header" style="margin-bottom:2px;" data-toggle="${key}" ${open ? '' : 'style="cursor:pointer;margin-bottom:2px;"'}>
          <span class="card-label">${esc(item.title)}</span>
          <span>${s ? starsHtml(s.n) + '<span class="grade-word ' + s.cls + '">' + s.word + '</span>' : ''}</span>
        </div>
        <div class="pheno-window tabular">${esc(item.window || '—')}</div>
        <div class="pheno-text">${esc(item.text)}</div>
        ${open ? `<div class="reason-panel" style="margin:8px -14px 0;">${reasonInner(item.key, a)}</div>` : '<div class="small" style="color:var(--forest);font-weight:600;cursor:pointer;margin-top:6px;" data-toggle="' + key + '">为什么？</div>'}
      </div>`
  }).join('')

  const callouts = buildCalloutsHtml(a)

  const sec = el(`
    <div>
      <div class="section-head">
        <span class="section-title">户外条件<span class="level-tag level-analysis">OURTRAIL 分析</span></span>
        <span class="section-sub">由上方天气数据推算的条件判断，不是气象预报</span>
      </div>
      <div class="stack" style="gap:10px;">
        <div class="card cond-card">
          <div class="cond-main">
            <span class="cond-label">徒步条件</span>
            <span>${starsHtml(st.n)}<span class="grade-word ${st.cls}">${st.word}</span></span>
          </div>
          <div class="pheno-text">${condSummary(a, score)}</div>
          ${callouts}
        </div>
        ${cloudSeaCard(cloudSea, a)}
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
    <div class="reason-title">OURTRAIL 判断依据 · 均为上方图表中的可见事实</div>
    ${facts.map(f => `
      <div class="reason-item">
        <span class="mark pos">✓</span>
        <span class="fact">${esc(f.fact)}</span>
        <span class="link" data-jump="${f.anchor}">看图 ↗</span>
      </div>`).join('')}
    <div class="reason-note">基于天气数据估算，非气象预报。</div>`
}

/* 云海 featured 卡（本次原型的重点案例） */
function cloudSeaCard(item, a) {
  if (!item) return ''
  const s = starsOf(item)
  const key = 'ph:cloudSea'
  const open = state.open[key]
  return `
    <div class="card pheno-featured">
      <div class="card-header" style="margin-bottom:2px;${open ? '' : 'cursor:pointer;'}" ${open ? '' : `data-toggle="${key}"`}>
        <span class="card-label">云海 · 值得关注</span>
        <span>${starsHtml(s.n)}<span class="grade-word ${s.cls}">${s.word}</span></span>
      </div>
      <div class="pheno-window tabular">${esc(item.window)}</div>
      <div class="pheno-text">${esc(item.text)}</div>
      ${open
        ? `<div class="reason-panel" style="margin:10px -14px 0;">${reasonInner('cloudSea', a)}
             <div class="reason-note" style="font-weight:600;color:var(--ink);">建议：日出前抵达高处观景点；上午云带抬升后机会下降。</div></div>`
        : ''}
      ${open ? '' : `<div class="small" style="color:var(--forest);font-weight:600;cursor:pointer;margin-top:6px;" data-toggle="${key}">为什么今天值得去看云海？</div>`}
    </div>`
}

function condSummary(a, score) {
  const day = days.find(x => x.date === state.date)
  const bits = []
  if (day.precipProbMax >= 60) bits.push('降水概率 ' + day.precipProbMax + '%')
  else bits.push('降水的可能性不大')
  if (day.windMax >= 25) bits.push('风较大（最大 ' + day.windMax + ' km/h）')
  const names = { cloudSea: '云海', alpenglow: '日照金山', galaxy: '银河', rainbow: '彩虹', star: '星空' }
  const good = a.summary.items.filter(x => x.score >= 70 && names[x.key]).map(x => names[x.key])
  const soft = { '条件较好': '条件成熟', '条件一般': '有若干机会', '条件较差': '机会有限' }[sky.grade(score).label]
  return '今天' + bits.join('、') + '；' + (good.length ? good.join('、') + soft + '。' : '天象' + soft + '。出发前请核实当地预报与路况。')
}

/* 安全类提示：与 pages/weather buildCallouts 同规则（雷暴/雪/入云/阵雨），独立于天相 */
function buildCalloutsHtml(a) {
  const out = []
  const d = a.detail
  const day = days.find(x => x.date === state.date)
  const elev = POINT.elevation
  if (Number(day.code) >= 95 || d.some(h => Number(h.code) >= 95)) out.push(['danger', '有雷暴概率，不建议安排上山'])
  else if (d.some(h => { const c = Number(h.code); return (c >= 71 && c <= 77) || (c >= 85 && c <= 86) })
    || d.some(h => Number.isFinite(h.freezing) && h.freezing < elev)) {
    // 注意：生产 pages/weather buildCallouts 用 71–86 判雪，把阵雨 80–82 也算进去了
    // （14°C 的午后阵雨会触发「降水可能为雪」）。原型实现的是修正后的规则，
    // 该生产 bug 已记录在 current-weather-architecture.md §5。
    out.push(['danger', '0℃ 层低于此点，降水可能为雪'])
  }
  const inCloud = d.some(h => h.band && h.band.base <= elev && elev <= h.band.top)
  if (d.some(h => Number.isFinite(h.visibility) && h.visibility < 1) || inCloud) out.push(['warning', '此点可能入云（雾），观景窗口有限'])
  if (out.length < 2 && day.precipProbMax >= 60 && d.some(h => h.t >= '12' && (h.pop >= 50 || h.showers > 0))) {
    out.push(['warning', '午后阵雨概率高，建议早点出发'])
  }
  return out.slice(0, 2).map(([tone, title]) => `
    <div class="callout ${tone}" style="margin-top:8px;"><span class="callout-title">${title}</span></div>`).join('')
}

/* ---------- 数字明细（折叠） ---------- */

function numbersSection() {
  const a = analyze(state.date)
  const key = 'nums'
  const open = state.open[key]
  if (!open) {
    const t = el(`<div class="num-toggle" data-toggle="${key}">展开逐小时数据（温度 · 湿度 · 气压 · 能见度 · UV）</div>`)
    t.addEventListener('click', () => { state.open[key] = true; renderAll() })
    return t
  }
  const rows = a.detail.map(h => `
    <tr>
      <td class="tabular">${h.t}</td>
      <td class="tabular">${Math.round(h.temp)}°</td>
      <td class="tabular">${Math.round(h.feels)}°</td>
      <td class="tabular">${h.rh}%</td>
      <td class="tabular">${h.wind}</td>
      <td class="tabular">${dirName(h.windDir)}</td>
      <td class="tabular">${h.pressure}</td>
      <td class="tabular">${h.visibility}</td>
      <td class="tabular">${h.uv || '—'}</td>
      <td class="tabular">${h.dewPoint}°</td>
      <td class="tabular">${h.band ? h.band.base + '–' + h.band.top : '—'}</td>
    </tr>`).join('')
  const wrap = el(`
    <div>
      <div class="card num-sheet">
        <div class="num-scroll">
          <table class="nums">
            <tr><th>时间</th><th>温度</th><th>体感</th><th>湿度</th><th>风 km/h</th><th>风向</th><th>气压 hPa</th><th>能见度 km</th><th>UV</th><th>露点</th><th>云层带 m</th></tr>
            ${rows}
          </table>
        </div>
      </div>
      <div class="num-toggle" data-toggle="${key}" style="margin-top:10px;">收起逐小时数据</div>
    </div>`)
  wrap.querySelectorAll('[data-toggle]').forEach(t2 => t2.addEventListener('click', () => { delete state.open[key]; renderAll() }))
  return wrap
}

function dirName(deg) {
  const names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8] + '风'
}

/* ---------- 页脚 ---------- */

function footerNote() {
  return el(`
    <div class="pt-footer stack" style="gap:8px;">
      <div class="callout warning" style="text-align:left;">这是概率判断，不是出发许可。云层与云海为模型推算，具体山谷的云海与光染任何产品都无法保证——出发前请核实当地气象与路况。</div>
      <span class="small muted">天气数据 ${META.provider.attribution} · 日出日落与天象分析为本机按坐标与海拔推算<br>OurTrail 分析 = 对上方天气事实的条件解读，仅供参考</span>
    </div>`)
}

/* ---------- 启动 ---------- */

renderAll()
