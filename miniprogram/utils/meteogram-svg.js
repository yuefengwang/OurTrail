/* Unified Weather Meteogram SVG renderer —— Weather V2 Phase 2
 *
 * 目标：Temperature / Precipitation / Cloud Field / Wind 共用**同一条
 * time → x 映射与同一根 crosshair**，成为一张完整天气图（而非三张独立图）。
 *
 * 分层与复用：
 *   ▸ 云场部分**完全复用**已冻结的 utils/cloud-field-svg.js 场数学
 *     （makeColumnSampler / buildFieldGrid / isoBandsFromGrid —— 只导出，未改数学）；
 *   ▸ 温度 / 降水 / 风 / 图标行的**数据语义与配色沿用生产 meteogram 组件**
 *     （温度=中性墨 #202A26 而非红、降水双柱 #346583/#2E8B8B + pop≥50 底带、
 *     夜间底 #F0F1EC、风箭头指向吹去方向），表达载体从 canvas 换成静态 SVG；
 *   ▸ 本模块不做云态判断（复用 cloud-field-svg.inferState）、不做 Outdoor
 *     Intelligence（Agenda/结论卡仍在页面层）。
 *
 * 数据契约：
 *   surface    —— hourView 形状的 24 行（t/temp/code/pop/precip/showers/wind/gust/windDir）
 *   cloudField —— { times, altitudes, values, userAltitude, covered }（weather-cloud-field.js 产出）
 *
 * 输出：静态 SVG 字符串（data-URI → <image>），基础层按数据集缓存，
 *       选中层（全高 single crosshair）按点击重生成（毫秒级）。
 */
'use strict'

const CFF = require('./cloud-field-svg.js')

/* 行布局（逻辑 px；375–414 全宽通用，间距自适应由 plotW 承担） */
const ROWS = {
  dayHdr: { y: 0, h: 14 },
  iconTemp: { y: 20, h: 58 },   // 图标行 + 温度曲线（含极值标注与三档网格）
  precip: { y: 84, h: 42 },     // 降水双柱 + 概率底带
  cloud: { y: 132, h: 190 },    // Cloud Field（2000–6000 m 等值带）
  wind: { y: 328, h: 66 },      // 风向箭头 + 风速/阵风曲线
  axis: { y: 394, h: 18 },
}
const TOTAL_H = ROWS.axis.y + ROWS.axis.h
const L = 38, R = 10

const C = {
  ink: '#202A26',
  muted: '#5F6E66',
  grid: '#E4E8E1',
  night: '#F0F1EC',
  frame: '#D3D5CD',
  temp: '#202A26',
  tempFill: 'rgba(32,42,38,0.08)',
  rain: '#346583',
  showers: '#2E8B8B',
  popWash: 'rgba(52,101,131,0.10)',
  wind: '#3D8A7F',
  gust: '#9FC4D8',
  arrow: '#5A5F5A',
  arrowSoft: '#9A9F99',
  you: '#163E35',
  inCloud: 'rgba(180,118,26,0.65)',
  selWash: 'rgba(22,62,53,0.035)',
  icon: '#4a4f4a',
}

/* ---------- 天气图标（12×24 视窗 stroke glyph，与 prototype 同源） ---------- */

function iconId(code, h) {
  const night = h < 6 || h >= 20
  switch (code) {
    case 0: case 1: return night ? 'i-moon' : 'i-sun'
    case 2: return night ? 'i-pcloud-n' : 'i-pcloud-d'
    case 45: case 3: return 'i-cloud'
    case 51: return 'i-drizzle'
    case 61: case 63: case 65: return 'i-rain'
    case 80: case 81: return 'i-shower'
    default: return 'i-cloud'
  }
}

function buildIconDefs() {
  let rays = ''
  for (let a = 0; a < 8; a++) {
    const t = a * Math.PI / 4
    rays += '<line x1="' + (12 + 7 * Math.cos(t)).toFixed(2) + '" y1="' + (12 + 7 * Math.sin(t)).toFixed(2) +
      '" x2="' + (12 + 9.4 * Math.cos(t)).toFixed(2) + '" y2="' + (12 + 9.4 * Math.sin(t)).toFixed(2) + '"/>'
  }
  const CLOUD = 'M6.5,18.5 H16.5 A3.5,3.5 0 0 0 16.5,11.5 A5,5 0 0 0 6.8,10.8 A4,4 0 0 0 6.5,18.5 Z'
  return '<defs>' +
    '<g id="i-sun" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none">' +
    '<circle cx="12" cy="12" r="4.6"/>' + rays + '</g>' +
    '<g id="i-moon"><path d="M14.8,3.8 A9,9 0 1,0 20.2,15.2 A7,7 0 0,1 14.8,3.8 Z" fill="currentColor"/></g>' +
    '<g id="i-pcloud-d" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
    '<circle cx="8.6" cy="7.8" r="3"/><path d="M8.6,2.6 v1.4 M8.6,11.6 v0.2 M3.4,7.8 h1.4 M13.8,7.8 h0.2 M4.9,4.1 l1,1 M12.3,4.1 l-1,1"/>' +
    '<path d="' + CLOUD + '" fill="#fff"/></g>' +
    '<g id="i-pcloud-n">' +
    '<path d="M9.6,2.6 A5.4,5.4 0 1,0 12.6,9.6 A4.2,4.2 0 0,1 9.6,2.6 Z" fill="currentColor"/>' +
    '<path d="' + CLOUD + '" fill="#fff" stroke="currentColor" stroke-width="1.3"/></g>' +
    '<g id="i-cloud"><path d="' + CLOUD + '" fill="none" stroke="currentColor" stroke-width="1.3" transform="translate(0.5,1)"/></g>' +
    '<g id="i-drizzle" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
    '<path d="' + CLOUD + '" transform="translate(0,-1.5)"/>' +
    '<path d="M10,19.8 l-0.4,1.5 M13.5,19.8 l-0.4,1.5"/></g>' +
    '<g id="i-rain" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
    '<path d="' + CLOUD + '" transform="translate(0,-1.5)"/>' +
    '<path d="M10,19.4 l-0.6,2.4 M13.8,19.4 l-0.6,2.4"/></g>' +
    '<g id="i-shower" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
    '<path d="' + CLOUD + '" transform="translate(0.8,-1)" fill="#fff"/>' +
    '<path d="M10.6,18.6 l-1.2,3.2 M15,18.6 l-1.2,3.2"/></g>' +
    '</defs>'
}

/* ---------- 工具 ---------- */

function smooth(pts) {
  if (pts.length < 3) return 'M' + pts.map(p => p.x + ',' + p.y).join('L')
  let d = 'M' + pts[0].x + ',' + pts[0].y
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
    d += 'C' + (p1.x + (p2.x - p0.x) / 6).toFixed(2) + ',' + (p1.y + (p2.y - p0.y) / 6).toFixed(2) +
      ' ' + (p2.x - (p3.x - p1.x) / 6).toFixed(2) + ',' + (p2.y - (p3.y - p1.y) / 6).toFixed(2) +
      ' ' + p2.x + ',' + p2.y
  }
  return d
}

function pad2(n) { return (n < 10 ? '0' : '') + n }
function fmt(v) { return v.toFixed(1) }
function fmtM(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

/* ---------- 统一几何（单 timeScale；昂贵部分按数据集缓存） ---------- */

function buildUnified(opts) {
  const t0 = Date.now()
  const surface = opts.surface
  const cf = opts.cloudField
  const width = opts.width || 375
  /* Phase 4：horizon（24 默认，48/72 多日）。24h 路径与历史逐字节同构。 */
  const horizon = (opts.horizon === 48 || opts.horizon === 72) ? opts.horizon : 24
  const plotW = width - L - R
  const nT = Math.min(horizon, surface.length)

  /* 唯一的 time → x 映射（h 为绝对小时 0..horizon）：整点小时 h 的采样中心 */
  const X = h => L + (h + 0.5) * (plotW / horizon)
  const x0 = h => L + h * (plotW / horizon)

  /* 云场：冻结数学（复用导出） */
  const column = CFF.makeColumnSampler(cf)
  const cloudSample = (t, alt) => CFF.sampleAtStations(column, cf.times.length, t, alt)
  const cloud = {
    top: ROWS.cloud.y, bot: ROWS.cloud.y + ROWS.cloud.h,
    covered: cf.covered || null,
    userAlt: Number.isFinite(opts.userAltitude) ? Math.round(opts.userAltitude) : null,
  }
  cloud.yAlt = a => cloud.bot - (a - CFF.ALT0) / (CFF.ALT1 - CFF.ALT0) * (cloud.bot - cloud.top)

  const gridMs0 = Date.now()
  const F2 = CFF.buildFieldGrid(cloudSample, cf.times.length, { hours: horizon })
  const xOfCloud = i => L + ((F2.t0 + i * F2.dt) / horizon) * plotW
  const yOfCloud = j => cloud.bot - (F2.a0 + j * F2.da - CFF.ALT0) / (CFF.ALT1 - CFF.ALT0) * (cloud.bot - cloud.top)
  const bands = []
  let pathCount = 0, pointCount = 0
  CFF.BINS.forEach(b => {
    const loops = CFF.isoBandsFromGrid(F2, b.t, xOfCloud, yOfCloud)
    let d = ''
    loops.forEach(lp => {
      d += 'M' + lp.map(p => fmt(p.x) + ',' + fmt(p.y)).join('L') + 'Z'
      pointCount += lp.length
    })
    if (d) { bands.push({ d: d, fill: b.c }); pathCount++ }
  })
  const gridMs = Date.now() - gridMs0

  /* 入云交线：field(t, userAlt) ≥ 60 的连续段 */
  const userAlt = cloud.userAlt
  const inRuns = []
  if (userAlt != null && userAlt >= CFF.ALT0 && userAlt <= CFF.ALT1) {
    let run = null
    for (let h = 0; h < nT; h++) {
      if (cloudSample(h, Math.max(CFF.ALT0, Math.min(CFF.ALT1, userAlt))) >= 60) {
        if (run && run.to === h - 1) run.to = h
        else { if (run) inRuns.push(run); run = { from: h, to: h } }
      } else if (run) { inRuns.push(run); run = null }
    }
    if (run) inRuns.push(run)
  }

  /* 温度标度（生产语义：自动量程 + 12% padding + 最小跨度 4°） */
  const temps = surface.map(r => (typeof r.temp === 'number' ? r.temp : null)).filter(v => v != null)
  let tLo = 0, tHi = 4
  if (temps.length) {
    tLo = Math.min.apply(null, temps)
    tHi = Math.max.apply(null, temps)
    if (tHi - tLo < 4) { const m = (tHi + tLo) / 2; tLo = m - 2; tHi = m + 2 }
    const padv = (tHi - tLo) * 0.12
    tLo -= padv; tHi += padv
  }
  /* 温度曲线区：y ∈ [iconTemp.y + 36, iconTemp.y + iconTemp.h - 6] */
  const tzTop = ROWS.iconTemp.y + 36, tzBot = ROWS.iconTemp.y + ROWS.iconTemp.h - 6
  const yTemp = t => tzBot - ((t - tLo) / (tHi - tLo)) * (tzBot - tzTop)

  /* 降水标度（生产语义：max(0.1, 数据最大值)） */
  let pMax = 0.1
  surface.forEach(r => { pMax = Math.max(pMax, r.precip || 0, r.showers || 0) })
  if (pMax > 3) pMax = Math.ceil(pMax)
  const yPrec = v => ROWS.precip.y + ROWS.precip.h - (v / pMax) * (ROWS.precip.h - 4)

  /* 风标度：阵风最大值向上取整到 15/30/45 */
  let wMax = 15
  surface.forEach(r => { wMax = Math.max(wMax, r.gust || 0, r.wind || 0) })
  wMax = wMax <= 15 ? 15 : wMax <= 30 ? 30 : 45
  const windTop = ROWS.wind.y + 20, windBot = ROWS.wind.y + ROWS.wind.h - 4
  const yWind = v => windBot - (v / wMax) * (windBot - windTop)

  const stats = {
    calcMs: Date.now() - t0,
    gridMs: gridMs,
    pathCount: pathCount,
    pointCount: pointCount,
    pMax: Math.round(pMax * 10) / 10,
    tLo: Math.round(tLo), tHi: Math.round(tHi), wMax: wMax,
    horizon: horizon,
  }

  /* 日界（绝对小时）与每日 hi/lo（day header 用） */
  const dayBounds = []
  for (let db = 24; db < horizon; db += 24) dayBounds.push(db)
  const days = []
  for (let d = 0; d * 24 < nT; d++) {
    const rows = surface.slice(d * 24, Math.min((d + 1) * 24, nT))
    const temps = rows.map(r => (typeof r.temp === 'number' ? r.temp : null)).filter(v => v != null)
    days.push({
      label: (opts.dayLabels && opts.dayLabels[d]) || ('D' + (d + 1)),
      hi: temps.length ? Math.round(Math.max.apply(null, temps)) : null,
      lo: temps.length ? Math.round(Math.min.apply(null, temps)) : null,
    })
  }

  return {
    surface: surface, nT: nT, cf: cf,
    width: width, plotW: plotW, L: L, R: R,
    horizon: horizon, dayBounds: dayBounds, days: days,
    covered: cf.covered || null,
    X: X, x0: x0,
    sample: cloudSample,
    cloud: cloud, bands: bands, inRuns: inRuns,
    temp: { lo: tLo, hi: tHi, y: yTemp, minI: minIdx(surface, 'temp'), maxI: maxIdx(surface, 'temp') },
    precip: { max: pMax, y: yPrec },
    wind: { max: wMax, y: yWind },
    stats: stats,
    totalH: TOTAL_H,
  }
}

function minIdx(rows, k) {
  let mi = 0
  for (let i = 0; i < rows.length; i++) if ((rows[i][k] != null) && rows[i][k] < (rows[mi][k] == null ? Infinity : rows[mi][k])) mi = i
  return mi
}
function maxIdx(rows, k) {
  let mi = 0
  for (let i = 0; i < rows.length; i++) if ((rows[i][k] != null) && rows[i][k] > (rows[mi][k] == null ? -Infinity : rows[mi][k])) mi = i
  return mi
}

/* ---------- 基础层 SVG ---------- */

function renderUnifiedBase(geo, opts) {
  opts = opts || {}
  const t0 = Date.now()
  const w = geo.width, H = TOTAL_H
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H + '">'
  s += buildIconDefs()

  /* 昼夜底：24h 单渐变（历史路径）；48/72h 按日分段渐变（opts.sunTimes[d] = {rise,set} 小时） */
  const sr = opts.sunrise, ss = opts.sunset
  function off(h) { return (h / 24).toFixed(4) }
  const HZ = geo.horizon
  if (HZ === 24 && sr != null && ss != null) {
    s += '<defs><linearGradient id="udn" gradientUnits="userSpaceOnUse" x1="' + geo.L + '" y1="0" x2="' + (geo.L + geo.plotW) + '" y2="0">' +
      '<stop offset="0" stop-color="' + C.night + '"/>' +
      '<stop offset="' + off(sr - 0.85) + '" stop-color="' + C.night + '"/>' +
      '<stop offset="' + off(sr + 0.25) + '" stop-color="#ffffff"/>' +
      '<stop offset="' + off(ss - 0.25) + '" stop-color="#ffffff"/>' +
      '<stop offset="' + off(ss + 0.85) + '" stop-color="' + C.night + '"/>' +
      '<stop offset="1" stop-color="' + C.night + '"/>' +
      '</linearGradient></defs>'
    s += '<rect x="' + geo.L + '" y="' + ROWS.iconTemp.y + '" width="' + geo.plotW + '" height="' + (ROWS.axis.y - ROWS.iconTemp.y) + '" fill="url(#udn)"/>'
  } else if (HZ > 24 && Array.isArray(opts.sunTimes)) {
    const defs = [], rects = []
    opts.sunTimes.slice(0, Math.ceil(HZ / 24)).forEach(function (st, d) {
      if (!st) return
      const x0 = geo.L + (d * 24) / HZ * geo.plotW
      const x1 = geo.L + Math.min(HZ, (d + 1) * 24) / HZ * geo.plotW
      const gid = 'udn' + d
      defs.push('<linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="' + x0.toFixed(1) + '" y1="0" x2="' + x1.toFixed(1) + '" y2="0">' +
        '<stop offset="0" stop-color="' + C.night + '"/>' +
        '<stop offset="' + ((st.rise - 0.85) / 24).toFixed(4) + '" stop-color="' + C.night + '"/>' +
        '<stop offset="' + ((st.rise + 0.25) / 24).toFixed(4) + '" stop-color="#ffffff"/>' +
        '<stop offset="' + ((st.set - 0.25) / 24).toFixed(4) + '" stop-color="#ffffff"/>' +
        '<stop offset="' + ((st.set + 0.85) / 24).toFixed(4) + '" stop-color="' + C.night + '"/>' +
        '<stop offset="1" stop-color="' + C.night + '"/>' +
        '</linearGradient>')
      rects.push('<rect x="' + x0.toFixed(1) + '" y="' + ROWS.iconTemp.y + '" width="' + (x1 - x0).toFixed(1) + '" height="' + (ROWS.axis.y - ROWS.iconTemp.y) + '" fill="url(#' + gid + ')"/>')
    })
    if (defs.length) {
      s += '<defs>' + defs.join('') + '</defs>' + rects.join('')
    }
  }

  /* 竖向网格（全行贯穿；每 2h） */
  let vGrid = ''
  const gridStep = HZ <= 24 ? 2 : 6
  for (let h = 0; h < HZ; h += gridStep) {
    vGrid += '<line x1="' + fmt(geo.X(h)) + '" y1="' + ROWS.iconTemp.y + '" x2="' + fmt(geo.X(h)) + '" y2="' + ROWS.axis.y + '"/>'
  }
  s += '<g stroke="' + C.grid + '" stroke-width="0.6">' + vGrid + '</g>'
  /* 日界线：比小时网格更强（§5） */
  geo.dayBounds.forEach(function (db) {
    const x = geo.L + db / HZ * geo.plotW
    s += '<line x1="' + fmt(x) + '" y1="' + ROWS.dayHdr.y + '" x2="' + fmt(x) + '" y2="' + ROWS.axis.y + '" stroke="' + C.frame + '" stroke-width="1"/>'
  })
  s += '<rect x="' + geo.L + '" y="' + ROWS.iconTemp.y + '" width="' + geo.plotW + '" height="' + (ROWS.axis.y - ROWS.iconTemp.y) + '" fill="none" stroke="' + C.frame + '" stroke-width="0.8"/>'

  /* --- 图标 + 温度行 --- */
  const temp = geo.temp
  const tz = geo.surface.map((r, h) => ({ x: geo.X(h), y: temp.y(r.temp == null ? (geo.temp.lo + geo.temp.hi) / 2 : r.temp) }))
  const curve = smooth(tz)
  s += '<path d="' + curve + ' L' + (geo.L + geo.plotW) + ',' + (ROWS.iconTemp.y + ROWS.iconTemp.h - 6) + ' L' + geo.L + ',' + (ROWS.iconTemp.y + ROWS.iconTemp.h - 6) + ' Z" fill="' + C.tempFill + '"/>'
  s += '<path d="' + curve + '" fill="none" stroke="' + C.temp + '" stroke-width="1.5"/>'
  const rows = geo.surface
  let icons = ''
  const iconStep = HZ <= 24 ? 3 : HZ <= 48 ? 4 : 6
  for (let h = 0; h < geo.nT; h += iconStep) {
    const r = rows[h]
    icons += '<use href="#' + iconId(r.code, h) + '" x="' + fmt(geo.X(h) - 6.5) + '" y="' + (ROWS.iconTemp.y + 3) + '" width="13" height="13" color="' + C.icon + '"/>'
  }
  s += '<g>' + icons + '</g>'
  if (HZ === 24) {
    const mi = temp.minI, ma = temp.maxI
    if (rows[mi] && rows[mi].temp != null) {
      s += '<text x="' + fmt(geo.X(mi) - 7) + '" y="' + fmt(temp.y(rows[mi].temp) + 9) + '" text-anchor="end" font-size="8" font-weight="600" fill="' + C.temp + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">低 ' + Math.round(rows[mi].temp) + '°</text>'
    }
    if (rows[ma] && rows[ma].temp != null) {
      s += '<text x="' + fmt(geo.X(ma) + 7) + '" y="' + fmt(temp.y(rows[ma].temp) - 2) + '" text-anchor="start" font-size="8" font-weight="600" fill="' + C.temp + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">高 ' + Math.round(rows[ma].temp) + '°</text>'
    }
  }
  /* 温度三档网格 + 左刻度（生产语义：三档） */
  ;[0.25, 0.5, 0.75].forEach(function (f) {
    const v = geo.temp.lo + (geo.temp.hi - geo.temp.lo) * f
    const y = temp.y(v)
    s += '<line x1="' + geo.L + '" y1="' + fmt(y) + '" x2="' + (geo.L + geo.plotW) + '" y2="' + fmt(y) + '" stroke="' + C.grid + '" stroke-width="0.6"/>'
    s += '<text x="' + (geo.L - 5) + '" y="' + fmt(y + 2.5) + '" text-anchor="end" font-size="7.5" fill="' + C.muted + '">' + Math.round(v) + '°</text>'
  })

  /* --- 降水行：pop≥50 底带 + 双柱 --- */
  let pw = ''
  rows.forEach(function (r, h) {
    if ((r.pop || 0) >= 50) {
      pw += '<rect x="' + fmt(geo.x0(h)) + '" y="' + ROWS.precip.y + '" width="' + fmt(geo.plotW / 24) + '" height="' + ROWS.precip.h + '" fill="' + C.popWash + '"/>'
    }
  })
  rows.forEach(function (r, h) {
    const p = r.precip || 0, sh = r.showers || 0
    if (p + sh < 0.05) return
    const bw = Math.max(1.5, geo.plotW / 24 * 0.2635)
    const cx = geo.X(h)
    const base = ROWS.precip.y + ROWS.precip.h
    const hP = (p / geo.precip.max) * (ROWS.precip.h - 6)
    const hS = (sh / geo.precip.max) * (ROWS.precip.h - 6)
    if (p >= 0.05) pw += '<rect x="' + fmt(cx - bw - 0.5) + '" y="' + fmt(base - hP) + '" width="' + fmt(bw) + '" height="' + fmt(hP) + '" fill="' + C.rain + '" fill-opacity="0.55"/>'
    if (sh >= 0.05) pw += '<rect x="' + fmt(cx + 0.5) + '" y="' + fmt(base - hS) + '" width="' + fmt(bw) + '" height="' + fmt(hS) + '" fill="' + C.showers + '" fill-opacity="0.55"/>'
  })
  s += '<g>' + pw + '</g>'
  s += '<text x="' + (geo.L - 5) + '" y="' + (ROWS.precip.y + ROWS.precip.h + 2.5) + '" text-anchor="end" font-size="7.5" fill="' + C.muted + '">0</text>'
  s += '<text x="' + (geo.L - 5) + '" y="' + (ROWS.precip.y + 2.5) + '" text-anchor="end" font-size="7.5" fill="' + C.muted + '">' + geo.precip.max + '</text>'

  /* --- Cloud Field（冻结等值带 + YOU 线 + 入云交线） --- */
  const cloud = geo.cloud
  let bands = ''
  geo.bands.forEach(function (b) { bands += '<path d="' + b.d + '" fill="' + b.fill + '" fill-rule="evenodd"/>' })
  s += '<g clip-path="url(#cfclipu)">' + bands + '</g>'
  const youY = cloud.yAlt(Math.max(CFF.ALT0, Math.min(CFF.ALT1, cloud.userAlt)))
  const youTag = cloud.userAlt < CFF.ALT0 ? '（剖面下方）' : cloud.userAlt > CFF.ALT1 ? '（剖面上方）' : ''
  s += '<line x1="' + geo.L + '" y1="' + fmt(youY) + '" x2="' + (geo.L + geo.plotW) + '" y2="' + fmt(youY) + '" stroke="' + C.you + '" stroke-width="1" stroke-dasharray="4 3"/>'
  geo.inRuns.forEach(function (r) {
    s += '<line x1="' + fmt(geo.x0(r.from)) + '" y1="' + fmt(youY) + '" x2="' + fmt(geo.x0(r.to + 1)) + '" y2="' + fmt(youY) + '" stroke="' + C.inCloud + '" stroke-width="2.5" stroke-linecap="round"/>'
  })
  s += '<text x="' + (geo.L + geo.plotW - 4) + '" y="' + fmt(youY - 4) + '" text-anchor="end" font-size="7.5" font-weight="600" fill="' + C.you + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">你 · ' + fmtM(cloud.userAlt) + ' m' + youTag + '</text>'
  ;[2000, 3000, 4000, 5000].forEach(function (a) {
    s += '<text x="' + (geo.L - 5) + '" y="' + fmt(cloud.yAlt(a) + 2.5) + '" text-anchor="end" font-size="7.5" fill="' + C.muted + '">' + a + '</text>'
  })
  s += '<text x="' + (geo.L - 5) + '" y="' + fmt(cloud.yAlt(6000) + 2.5) + '" text-anchor="end" font-size="7.5" fill="' + C.muted + '">6000 m</text>'

  /* --- 风行：每小时风向箭头（指向吹去方向）+ 风速/阵风曲线 --- */
  let arrows = ''
  const arrowStep = HZ <= 24 ? 1 : HZ <= 48 ? 2 : 3
  for (let h = 0; h < geo.nT; h += arrowStep) {
    const r = rows[h]
    const dir = (((r.windDir % 360) + 360) % 360 + 180) % 360
    arrows += '<g transform="translate(' + fmt(geo.X(h)) + ',' + (ROWS.wind.y + 9) + ') rotate(' + dir.toFixed(0) + ')" stroke="' + C.arrowSoft + '" stroke-width="0.9" stroke-linecap="round" fill="none">' +
      '<line x1="0" y1="4" x2="0" y2="-3.2"/><path d="M-2.3,-1.1 L0,-3.6 L2.3,-1.1"/></g>'
  }
  s += '<g>' + arrows + '</g>'
  const wPts = rows.map((r, h) => ({ x: geo.X(h), y: geo.wind.y(r.wind == null ? 0 : r.wind) }))
  const gPts = rows.map((r, h) => ({ x: geo.X(h), y: geo.wind.y(r.gust == null ? 0 : r.gust) }))
  s += '<path d="' + smooth(gPts) + '" fill="none" stroke="' + C.gust + '" stroke-width="0.9"/>'
  s += '<path d="' + smooth(wPts) + '" fill="none" stroke="' + C.wind + '" stroke-width="1.1"/>'
  ;[0, geo.wind.max / 2, geo.wind.max].forEach(function (v) {
    s += '<text x="' + (geo.L - 5) + '" y="' + fmt(geo.wind.y(v) + 2.5) + '" text-anchor="end" font-size="7.5" fill="' + C.muted + '">' + Math.round(v) + '</text>'
  })

  /* --- 时间轴 + 面板行分隔 --- */
  let axis = ''
  const axisStep = HZ <= 24 ? 2 : 6
  for (let h = 0; h < HZ; h += axisStep) {
    axis += '<text x="' + fmt(geo.X(h)) + '" y="' + (ROWS.axis.y + 13) + '" text-anchor="middle" font-size="8" fill="' + C.muted + '">' + pad2(h % 24) + '</text>'
  }
  s += '<g>' + axis + '</g>'
  ;[ROWS.precip.y - 6, ROWS.cloud.y - 6, ROWS.wind.y - 6].forEach(function (y) {
    s += '<line x1="' + geo.L + '" y1="' + y + '" x2="' + (geo.L + geo.plotW) + '" y2="' + y + '" stroke="' + C.grid + '" stroke-width="0.6"/>'
  })
  /* 行标题（左侧 gutter 空档内小字，弱化）
     不用行顶 y-2：gutter 同列叠着各轴刻度，行顶恰好压最近一档
     （降水 max/云量 0/风 2000 与标题字形重叠 1~5px）。四条统一落在
     行内刻度带之间的净空（各行 y+12~+16），与刻度字形净距 ≥4px。 */
  s += '<text x="0" y="' + (ROWS.iconTemp.y + 16) + '" font-size="7.5" fill="#a9aca6">温度 °C</text>'
  s += '<text x="0" y="' + (ROWS.precip.y + 16) + '" font-size="7.5" fill="#a9aca6">降水 mm/h</text>'
  s += '<text x="0" y="' + (ROWS.cloud.y + 16) + '" font-size="7.5" fill="#a9aca6">云量 · 高度 m</text>'
  s += '<text x="0" y="' + (ROWS.wind.y + 12) + '" font-size="7.5" fill="#a9aca6">风 km/h</text>'
  if (HZ > 24) {
    /* day header：今天 | 明天 | 后天（含每日最高/最低，§11） */
    geo.days.forEach(function (d, di) {
      const x0 = geo.L + (di * 24) / HZ * geo.plotW
      const x1 = geo.L + Math.min(HZ, (di + 1) * 24) / HZ * geo.plotW
      s += '<text x="' + fmt((x0 + x1) / 2) + '" y="10" text-anchor="middle" font-size="9" font-weight="600" fill="#545954">' + d.label + (d.hi != null ? ' <tspan fill="' + C.temp + '">' + d.hi + '°</tspan>/<tspan fill="' + C.wind + '">' + d.lo + '°</tspan>' : '') + '</text>'
    })
  } else if (opts.dateLabel) {
    s += '<text x="' + (geo.L + geo.plotW / 2) + '" y="10" text-anchor="middle" font-size="9" font-weight="600" fill="#545954" letter-spacing="0.08em">' + opts.dateLabel + '</text>'
  }

  const svg = s + '</svg>'
  return { svg: svg, svgMs: Date.now() - t0, height: H }
}

/* ---------- 选中层：一根贯穿四变量的 crosshair ---------- */

function renderUnifiedSelection(geo, opts) {
  /* Phase 4：selectedAbs = 绝对小时（0..horizon-1）；24h 视图下 selectedTime 旧签名继续可用 */
  const HZ = geo.horizon || 24
  const selAbs = opts.selectedAbs != null ? opts.selectedAbs : opts.selectedTime
  if (selAbs == null || selAbs < 0 || selAbs >= HZ) return { svg: '', svgMs: 0 }
  const t0 = Date.now()
  const w = geo.width, H = TOTAL_H
  const sx = geo.X(selAbs)
  const row = geo.surface[selAbs] || geo.surface[geo.surface.length - 1] || {}
  const chipW = HZ > 24 ? 58 : 22
  let chipText = pad2(selAbs % 24) + ':00'
  if (HZ > 24 && selAbs >= 24) {
    /* §15：Day1 只显示时间；Day2+ 带日期（今天/明天/后天），无歧义 */
    const dl = (geo.days && geo.days[Math.floor(selAbs / 24)]) ? geo.days[Math.floor(selAbs / 24)].label : ''
    chipText = (dl ? dl + ' ' : '') + chipText
  }
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H + '">'
  s += '<rect x="0" y="0" width="' + w + '" height="' + H + '" fill="none"/>'
  s += '<rect x="' + fmt(geo.x0(selAbs)) + '" y="' + ROWS.iconTemp.y + '" width="' + fmt(geo.plotW / HZ) + '" height="' + (ROWS.axis.y - ROWS.iconTemp.y) + '" fill="rgba(22,62,53,0.035)"/>'
  s += '<line x1="' + fmt(sx) + '" y1="' + (ROWS.iconTemp.y - 2) + '" x2="' + fmt(sx) + '" y2="' + (ROWS.axis.y + 2) + '" stroke="#163e35" stroke-width="0.5" opacity="0.4"/>'
  s += '<circle cx="' + fmt(sx) + '" cy="' + fmt(geo.temp.y(row.temp == null ? (geo.temp.lo + geo.temp.hi) / 2 : row.temp)) + '" r="2.3" fill="#fff" stroke="#163e35" stroke-width="0.9"/>'
  s += '<rect x="' + fmt(Math.max(geo.L, Math.min(geo.L + geo.plotW - chipW, sx - chipW / 2))) + '" y="' + (ROWS.axis.y + 4) + '" width="' + chipW + '" height="11" rx="2" fill="#163e35"/>'
  s += '<text x="' + fmt(Math.max(geo.L + chipW / 2, Math.min(geo.L + geo.plotW - chipW / 2, sx))) + '" y="' + (ROWS.axis.y + 11.5) + '" text-anchor="middle" font-size="7" font-weight="600" fill="#fff">' + chipText + '</text>'
  const svg = s + '</svg>'
  return { svg: svg, svgMs: Date.now() - t0 }
}

module.exports = {
  buildUnified: buildUnified,
  renderUnifiedBase: renderUnifiedBase,
  renderUnifiedSelection: renderUnifiedSelection,
  ROWS: ROWS,
  /* 统一 timeScale 工厂：OI 时间轴等下游视图必须复用同一映射（Phase 2 §六）。
     Phase 4：horizon 参数（24 默认）——多日机会时间轴与 Meteogram 同一映射。 */
  timeScale: function (width, horizon) {
    const HZ = (horizon === 48 || horizon === 72) ? horizon : 24
    const plotW = width - L - R
    return {
      L: L, R: R, plotW: plotW, horizon: HZ,
      X: function (h) { return L + (h + 0.5) * (plotW / HZ) },
      x0: function (h) { return L + h * (plotW / HZ) },
      x1: function (h) { return L + (h + 1) * (plotW / HZ) },
    }
  },
}
