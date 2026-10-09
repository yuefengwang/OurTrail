/* Cloud Field 显示窗取证（2026-10-09 显示窗自适应轮 · 阶段 2）
 *
 * 目的：在改任何渲染参数之前，先量清楚「剖面显示窗」这件事在真实数据上到底怎么塌。
 * 记录量（每个样本一行）：
 *   原始输入（气压层剖面 / 合成 decks）
 *   有效数据范围 = 适配器透出的 covered
 *   有效云层范围 = 实测包络内 cover ≥25% 的连续高度段，以及 ≥68%（成带判据）的段
 *   查询点高程与出处（measured / estimated / none）
 *   当前显示范围 = 模块常量 ALT0/ALT1
 *   图上实际画出了什么：等值带 loop 数、像素面积、是否整行空白
 *   判读结论 = inferState 的 key/reason
 *   OI 侧 = buildLayers 看得见这几层吗（同一窗口的第二次受害者）
 * 输出：stdout 表格 + probe-window.json（证据入册，不复用旧轮数据）
 * 运行：node tools/probe-window.js [--real <real-cloud.json>]
 */
'use strict'

const fs = require('fs')
const path = require('path')
const CFF = require('../../../../../miniprogram/utils/cloud-field-svg.js')
const UMG = require('../../../../../miniprogram/utils/meteogram-svg.js')
const WCFF = require('../../../../../miniprogram/utils/weather-cloud-field.js')

const WIN_LO = CFF.ALT0, WIN_HI = CFF.ALT1

/* ---------- 公共量具 ---------- */

function surfaceRows (n) {
  const out = []
  for (let h = 0; h < n; h++) {
    out.push({
      t: String(h % 24).padStart(2, '0'), d: '2026-10-09', temp: 10, precip: 0, showers: 0,
      wind: 6, gust: 12, windDir: 90, code: 1, cloud: { low: 10, mid: 10, high: 10 },
    })
  }
  return out
}

/* 图上真的画了多少：解析等值带 d 属性，统计落在云行内的像素面积 */
function inkInCloudRow (geo) {
  const ROWS = UMG.ROWS ? UMG.ROWS.cloud : null
  const top = ROWS ? ROWS.y : 0, bot = top + (ROWS ? ROWS.h : 190)
  let loops = 0, area = 0, ymin = Infinity, ymax = -Infinity
  ;(geo.bands || []).forEach(b => {
    const nums = String(b.d).match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) || []
    const pts = nums.map(s => { const p = s.split(','); return { x: +p[0], y: +p[1] } })
    if (!pts.length) return
    loops++
    /* shoelace 面积（多边形按 Z 闭合） */
    let a = 0
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y }
    area += Math.abs(a / 2)
    pts.forEach(p => { if (p.y < ymin) ymin = p.y; if (p.y > ymax) ymax = p.y })
  })
  return { loops: loops, areaPx: Math.round(area), ymin: ymin === Infinity ? null : +ymin.toFixed(1), ymax: ymax === -Infinity ? null : +ymax.toFixed(1), rowTop: top, rowBot: bot }
}

/* 实测包络内「有意义的云」高度段：独立实现，不复用 denseSpanAt（否则测的是自己） */
function deckRuns (field, thresh) {
  const cov = field.covered
  if (!cov || !Number.isFinite(cov.lo) || !Number.isFinite(cov.hi)) return null
  const column = CFF.makeColumnSampler(field)
  const sample = (t, alt) => CFF.sampleAtStations(column, field.times.length, t, alt)
  const runs = []
  let run = null
  for (let alt = Math.round(cov.lo); alt <= Math.round(cov.hi); alt += 50) {
    if (sample(0, alt) >= thresh) { run = run || { lo: alt, hi: alt }; run.hi = alt }
    else if (run) { runs.push(run); run = null }
  }
  if (run) runs.push(run)
  return runs
}

/* OI 的层提取今天扫的是 **剖面显示窗**（outdoor-intelligence.js:98 用 CFF.ALT0/ALT1）。
   这里按它的规则独立重写一遍（≥80% 云量、50m 步长、进入/退出线性插值），
   分别用「窗口」与「实测包络」两种扫描范围跑，量出这条扫描线被窗口吃掉多少层。
   不 require 内部函数：判据必须独立，否则测的是它自己。 */
const LAYER_COVER_MIN = 80, SCAN_STEP_M = 50
function layersScan (sample, t, lo, hi) {
  const pts = []
  for (let alt = Math.max(0, lo); alt <= Math.min(7000, hi); alt += SCAN_STEP_M) pts.push({ alt: alt, cover: sample(t, alt) })
  const out = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= LAYER_COVER_MIN
    const prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const base = prev && prev.cover < LAYER_COVER_MIN
        ? prev.alt + (LAYER_COVER_MIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt
      run = { base: base, top: pts[i].alt }
    } else if (on && run) run.top = pts[i].alt
    else if (!on && run) { out.push(run); run = null }
  }
  if (run) out.push(run)
  return out.map(l => ({ base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base) }))
}
function oiSees (field) {
  if (!field.covered) return null
  const column = CFF.makeColumnSampler(field)
  const sample = (t, alt2) => CFF.sampleAtStations(column, field.times.length, t, alt2)
  return {
    inWindow: layersScan(sample, 0, WIN_LO, WIN_HI),
    inMeasuredEnvelope: layersScan(sample, 0, field.covered.lo, field.covered.hi),
  }
}

function record (name, field, alt, basis, meta) {
  const geo = UMG.buildUnified({ surface: surfaceRows(field.times.length), cloudField: field, userAltitude: alt, width: 390, horizon: field.times.length })
  const st = CFF.inferState(geo.sample, 0, Number.isFinite(alt) ? alt : undefined, field.covered, { basis: basis || 'measured' })
  const ink = inkInCloudRow(geo)
  const cov = field.covered
  const decks25 = deckRuns(field, 25)
  const decks68 = deckRuns(field, 68)
  const below = (decks25 || []).filter(r => r.hi < WIN_LO).length
  const above = (decks25 || []).filter(r => r.lo > WIN_HI).length
  const inwin = (decks25 || []).filter(r => r.hi >= WIN_LO && r.lo <= WIN_HI).length
  const row = {
    name: name, meta: meta || null,
    covered: cov, decksGe25: decks25, decksGe68: decks68,
    queryAlt: Number.isFinite(alt) ? alt : null, basis: basis || 'measured',
    window: [WIN_LO, WIN_HI],
    decks: { belowWindow: below, insideWindow: inwin, aboveWindow: above },
    ink: ink,
    pointInsideWindow: Number.isFinite(alt) ? (alt >= WIN_LO && alt <= WIN_HI) : null,
    verdict: { key: st.key, reason: st.reason, word: st.word, span: st.span },
    oiLayers: oiSees(field),
  }
  const oi = row.oiLayers
  row.oiMissedLayers = oi ? (oi.inMeasuredEnvelope.length - oi.inWindow.length) : null
  row.blankPicture = ink.loops === 0
  console.log([
    name.padEnd(30),
    'cov=' + (cov ? cov.lo + '–' + cov.hi : 'null'),
    '≥25段=' + JSON.stringify((decks25 || []).map(r => [r.lo, r.hi])),
    '窗外(下/内/上)=' + below + '/' + inwin + '/' + above,
    '环=' + ink.loops, '面积=' + ink.areaPx + 'px²',
    '点=' + (Number.isFinite(alt) ? alt + 'm' + (row.pointInsideWindow ? '内' : '外') : '无'),
    '判=' + (st.key || '∅') + (st.reason ? '/' + st.reason : ''),
    'OI漏层=' + (row.oiMissedLayers === null ? '—' : row.oiMissedLayers + '（窗内' + oi.inWindow.length + '/包络' + oi.inMeasuredEnvelope.length + '）'),
  ].join(' | '))
  return row
}

/* ---------- A. 十个规定样本 ---------- */
const ALT = (function () { const a = []; for (let x = 0; x <= 7000; x += 250) a.push(x); return a })()
function mkField (stations, hours) {
  /* stations: [[alt, cover...]|per hour] → 250m 网格上的场（与适配器同网格，covered 由站点极值给出） */
  const nT = hours
  const times = []
  for (let h = 0; h < nT; h++) times.push(h)
  const values = times.map((t, h) => ALT.map(a => {
    let v = 0
    stations.forEach(s => {
      const lo = s[0], hi = s[1]
      if (a >= lo && a <= hi) v = Math.max(v, s[2])
    })
    return v
  }))
  const lo = Math.min.apply(null, stations.map(s => s[0]))
  const hi = Math.max.apply(null, stations.map(s => s[1]))
  return { times: times, altitudes: ALT, values: values, covered: { lo: lo, hi: hi }, meta: { gapHours: [], hours: nT } }
}

const rows = []
console.log('\n== A 规定样本（显示窗 ' + WIN_LO + '–' + WIN_HI + ' m）==')
rows.push(record('1 云全部在窗下方', mkField([[900, 1700, 92], [2500, 2500, 6]], 24), 4058, 'measured', { 说明: '整层浓云 900–1700m，窗口下边界 2000m 之下' }))
rows.push(record('2 云全部在窗上方', mkField([[6300, 6900, 88]], 24), 4058, 'measured', { 说明: '高层云在窗口上边界之上' }))
rows.push(record('3 云跨越窗下边界', mkField([[1700, 2400, 90]], 24), 3004, 'measured', { 说明: '云体被窗口切断，只剩一截可见' }))
rows.push(record('4 云在窗内', mkField([[3150, 3850, 85]], 24), 3500, 'measured', { 说明: '现状最好的那一类' }))
rows.push(record('5 窗内无云窗外有云', mkField([[1000, 1500, 90], [6400, 6800, 80]], 24), 4058, 'measured', { 说明: '窗口正中是晴空，两侧窗外都有云' }))
rows.push(record('6 有效数据里没有成带云', mkField([[0, 7000, 8]], 24), 3500, 'measured', { 说明: '确认晴空（判据 reason=clear）' }))
rows.push(record('7a 云层数据缺失', (function () { const f = mkField([[3000, 3500, 90]], 24); f.covered = null; return f })(), 3500, 'measured', { 说明: 'covered=null：没有实测包络' }))
rows.push(record('7b 仅部分高度层有效', mkField([[2500, 2750, 88]], 24), 3500, 'measured', { 说明: '很窄的一段实测' }))
rows.push(record('8a 查询点高程缺失', mkField([[3150, 3850, 85]], 24), null, 'none', { 说明: 'elevation=null' }))
rows.push(record('8b 查询点可信', mkField([[3150, 3850, 85]], 24), 3004, 'measured', { 说明: 'GPX/选点/手填' }))
rows.push(record('8c 查询点是模型估算', mkField([[3150, 3850, 85]], 24), 2700, 'estimated', { 说明: '±600m 带与云带底缘重叠' }))
rows.push(record('9 云与点的不确定范围重叠', mkField([[3000, 3300, 90]], 24), 3450, 'estimated', { 说明: '点略高于云带顶，差值在带内' }))
rows.push(record('10 极端高度跨度', mkField([[200, 600, 80], [2400, 2800, 90], [5200, 6800, 76]], 24), 3500, 'measured', { 说明: '三层云横跨 200–6800m' }))
rows.push(record('10b 点在极端云系之下', mkField([[200, 600, 80], [2400, 2800, 90], [5200, 6800, 76]], 24), 489, 'estimated', { 说明: '成都形态：低海拔 + 中云带' }))

/* ---------- B. 真实剖面上「整行空白」到底多久发生一次 ---------- */
const realPath = process.argv[3] === '--real' ? process.argv[4] : path.join(__dirname, 'real-cloud.json')
let realSummary = null
if (fs.existsSync(realPath)) {
  console.log('\n== B 真实数据（' + realPath + '）==')
  const snap = JSON.parse(fs.readFileSync(realPath, 'utf8'))
  realSummary = { fetchedAt: snap.fetchedAt, date: snap.date, places: {} }
  Object.keys(snap.places).forEach(key => {
    const p = snap.places[key]
    const hours = Math.min(24, p.cloudLevels.times.length)
    const field = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: snap.date, hours: hours, userAltitude: p.elevation })
    if (!field) { console.log(p.name + ' → 无云场（cloudLevels 不可用）'); return }
    const geo = UMG.buildUnified({ surface: surfaceRows(field.times.length), cloudField: field, userAltitude: p.elevation, width: 390, horizon: field.times.length })
    const column = CFF.makeColumnSampler(field)
    const sample = (t, alt) => CFF.sampleAtStations(column, field.times.length, t, alt)
    /* 「≥25% 的高度段」按小时单独扫：显示窗对某一小时是不是空白，取决于那一小时的云在哪儿 */
    const cov = field.covered
    const runsAt = h => {
      const runs = []
      let run = null
      for (let alt = Math.round(cov.lo); alt <= Math.round(cov.hi); alt += 50) {
        if (sample(h, alt) >= 25) { run = run || { lo: alt, hi: alt }; run.hi = alt } else if (run) { runs.push(run); run = null }
      }
      if (run) runs.push(run)
      return runs
    }
    let belowOnly = 0, aboveOnly = 0, inWindow = 0, noDeck = 0, oiMissed = 0, ink = null
    const detail = []
    for (let h = 0; h < hours; h++) {
      const d25 = runsAt(h)
      const inside = d25.filter(r => r.hi >= WIN_LO && r.lo <= WIN_HI)
      if (!d25.length) noDeck++
      else if (!inside.length) { if (d25[0].hi < WIN_LO) belowOnly++; else aboveOnly++ }
      else inWindow++
      const lw = layersScan(sample, h, WIN_LO, WIN_HI).length
      const le = layersScan(sample, h, cov.lo, cov.hi).length
      if (le > lw) oiMissed++
      if (h === 0 || h === 10 || h === 21) {
        const st = CFF.inferState(sample, h, p.elevation, cov, { basis: 'measured' })
        detail.push({ h: h, decksGe25: d25.map(r => [r.lo, r.hi]), decksInsideWindow: inside.length,
          verdict: st.key || ('∅/' + st.reason), span: st.span ? [st.span.lo, st.span.hi] : null })
      }
    }
    ink = inkInCloudRow(geo)
    const pointOut = Number.isFinite(p.elevation) && (p.elevation < WIN_LO || p.elevation > WIN_HI)
    realSummary.places[key] = {
      name: p.name, elevation: p.elevation, covered: cov, hours: hours,
      hoursNoDeck: noDeck, hoursDeckBelowWindowOnly: belowOnly, hoursDeckAboveWindowOnly: aboveOnly,
      hoursDeckInsideWindow: inWindow, hoursOiMissesLayer: oiMissed,
      picture: ink, pointOutsideWindow: pointOut, sampleHours: detail,
    }
    console.log(p.name + '（' + p.elevation + 'm，cov ' + cov.lo + '–' + cov.hi + '）' + [
      hours + ' 时', '窗内有云 ' + inWindow, '云全在窗下 ' + belowOnly, '云全在窗上 ' + aboveOnly,
      '无有意义云段 ' + noDeck, 'OI 被窗吃掉层的小时 ' + oiMissed,
      '图=' + ink.loops + '环/' + ink.areaPx + 'px²', '点在窗外=' + pointOut].join(' | '))
  })
}

const out = {
  probedAt: new Date().toISOString(),
  windowConstants: { ALT0: WIN_LO, ALT1: WIN_HI, note: '两个渲染器与 OI buildLayers 共用的固定剖面窗' },
  samples: rows,
  real: realSummary,
}
fs.writeFileSync(path.join(__dirname, '..', 'probe-window.json'), JSON.stringify(out, null, 2))
console.log('\n→ probe-window.json 已写出（' + rows.length + ' 个样本' + (realSummary ? ' + 真实数据汇总' : '') + '）')
