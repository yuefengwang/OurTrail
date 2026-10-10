/* G2 取证：云海「最低高度口径」到底在比什么数，以及三种候选口径在真实快照上的后果。
 *
 * 只做测量，不做决策：本脚本不写"应该取多少米"，只把每个口径下
 *   · 有多少小时能出候选、clearance（点 − 云顶）的分布长什么样
 *   · 相对现状多出/少掉哪些小时
 *   · 有多少层的边界是被扫描带切出来的（不完整云层）
 *   · 海拔出处（可信 / 模型 ±600 m）会把多少小时判翻
 * 全部量出来，交给人决策。
 *
 * 带（band）类口径走**真实生产 OI**（影子改 CFF.ALT0/ALT1，跑完立刻还原，仓库文件零改动）；
 * clearance 上界类口径走本脚本独立重写的候选筛选（生产代码里没有这个闸，只能自己建模），
 * 两类读数分开标注，不混成一个数。
 *
 * 运行：node g2-height-basis.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const OI = require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))
const PROD = { lo: CFF.ALT0, hi: CFF.ALT1 }
const COVER_MIN = 80, STEP = 50, CLEAR_MIN = 200, THICK_MIN = 300

const SNAPSHOTS = [
  { name: '3 站 × 72h', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h（含稻城）', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
]

/* ---- 独立重写的层提取 + 候选筛选（规则照生产，代码不复用；扫描带由调用方给） ---- */
function layersAt (at, t, lo, hi) {
  const pts = []
  for (let alt = lo; alt <= hi; alt += STEP) pts.push({ alt: alt, cover: at(t, alt) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= COVER_MIN, prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const crossed = !!(prev && prev.cover < COVER_MIN)
      const base = crossed ? prev.alt + (COVER_MIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover], baseCut: !crossed }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) { run.topCut = false; runs.push(run); run = null }
  }
  if (run) { run.top = hi; run.topCut = true; runs.push(run) }
  return runs.map(function (l) {
    return { base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length),
      cut: l.baseCut === true || l.topCut === true }
  }).sort((a, b) => a.base - b.base)
}
/* 生产 detectCloudSeaCandidates 的必要条件序列，逐条照抄，加 cap 才是 G2 的新口径 */
function candidate (layers, userAlt, cap) {
  const below = layers.filter(l => l.top <= userAlt)
  if (!below.length) return null
  const L = below[below.length - 1]
  const clearance = userAlt - L.top
  if (clearance < CLEAR_MIN) return null
  if (L.meanCover < COVER_MIN) return null
  if (L.thickness < THICK_MIN) return null
  if (cap != null && clearance > cap) return null
  return { layer: L, clearance: Math.round(clearance) }
}
function quant (arr, q) {
  if (!arr.length) return null
  const s = arr.slice().sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo))
}
/* 用真实生产 OI 跑一个带，返回云海窗口（影子改常量，finally 还原） */
function realSeas (field, ctxBase, band) {
  const saved = { lo: CFF.ALT0, hi: CFF.ALT1 }
  if (band) { CFF.ALT0 = band.lo; CFF.ALT1 = band.hi }
  try {
    const oi = OI.buildOutdoorIntelligence(Object.assign({}, ctxBase, { cloudField: field }))
    return (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA').map(o => ({
      from: o.from, to: o.to, confidence: o.confidence,
      clearances: (o.layers || []).map(l => l.clearance),
      cut: (o.layers || []).some(l => l.baseBoundary || l.topBoundary),
    }))
  } finally { CFF.ALT0 = saved.lo; CFF.ALT1 = saved.hi }
}

/* ---- 口径定义 ---- */
const BANDS = [
  { id: '现状', 说明: '固定绝对带 2,000–6,000 m ASL（生产今天的行为）', band: () => ({ lo: PROD.lo, hi: PROD.hi }), cap: null },
  { id: 'K1-1500', 说明: '纯相对带：[点−1500, 点] ∩ 实测覆盖', band: (alt, cov) => ({ lo: Math.max(cov.lo, alt - 1500), hi: Math.min(cov.hi, alt) }), cap: null },
  { id: 'K1-2500', 说明: '纯相对带：[点−2500, 点] ∩ 实测覆盖', band: (alt, cov) => ({ lo: Math.max(cov.lo, alt - 2500), hi: Math.min(cov.hi, alt) }), cap: null },
  { id: 'K1-3500', 说明: '纯相对带：[点−3500, 点] ∩ 实测覆盖', band: (alt, cov) => ({ lo: Math.max(cov.lo, alt - 3500), hi: Math.min(cov.hi, alt) }), cap: null },
  { id: 'K2-1000/2500', 说明: '绝对下界 1,000 m + 相对上界 2,500 m（两者取交集）', band: (alt, cov) => ({ lo: Math.max(cov.lo, 1000, alt - 2500), hi: Math.min(cov.hi, alt) }), cap: null },
  { id: 'K3-现状+cap2500', 说明: '带不动，只加「点−云顶 ≤ 2500 m」的相对上限（候选层口径）', band: () => ({ lo: PROD.lo, hi: PROD.hi }), cap: 2500 },
]

const report = { generatedAt: new Date().toISOString(), 生产扫描带: [PROD.lo, PROD.hi], 快照: [] }

SNAPSHOTS.forEach(function (sn) {
  const abs = path.join(ROOT, sn.p)
  if (!fs.existsSync(abs)) { report.快照.push({ 快照: sn.name, 状态: '文件不存在' }); return }
  const snap = JSON.parse(fs.readFileSync(abs, 'utf8'))
  const per = { 快照: sn.name, 取数日: snap.date, 地点: [], 口径: [] }
  const hourSets = {}     // 口径 -> Set('place|day|h')
  BANDS.forEach(b => { hourSets[b.id] = new Set() })
  const clearances = {}   // 口径 -> [clearance]（独立实现，逐候选小时）
  BANDS.forEach(b => { clearances[b.id] = [] })
  const cutRate = {}
  BANDS.forEach(b => { cutRate[b.id] = [0, 0] })
  const realWindows = {}  // 口径 -> {count, hours}（真实 OI，只对能用带表达的口径有意义）
  BANDS.forEach(b => { realWindows[b.id] = { 窗口数: 0, 覆盖小时数: 0, 含被切层的窗口: 0 } })
  const basisFlip = { 可信: 0, 模型抬高会翻: 0, 模型压低会翻: 0, 总候选小时: 0 }

  Object.keys(snap.places).forEach(function (k) {
    const p = snap.places[k]
    if (!p.cloudLevels) return
    const nDays = Math.min(sn.days, Math.floor(((p.series || []).length) / 24))
    /* 分地点计数器：全局累加值不能直接当分地点读数（第一版在这里把全局数写进了每一行） */
    const loc = { 地点: p.name, 海拔: p.elevation, 实测覆盖: null, 各口径候选小时数: {}, 真实OI窗口数: {}, clearanceP50: {} }
    loc._c = {}; loc._w = {}
    BANDS.forEach(function (b) { loc._c[b.id] = []; loc._w[b.id] = 0 })
    for (let d = 0; d < nDays; d++) {
      const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
      const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
      if (!cf || !cf.covered) continue
      loc.实测覆盖 = [cf.covered.lo, cf.covered.hi]
      const col = CFF.makeColumnSampler(cf)
      const at = (t, a) => CFF.sampleAtStations(col, cf.times.length, t, a)
      const field = Object.assign({}, cf, { sample: at, userAltitude: p.elevation })
      const ctxBase = { date: day, detail: (p.series || []).filter(r => r.d === day), userAltitude: p.elevation,
        elevOK: true, elevBasis: 'measured', lat: p.gcj ? p.gcj[0] : 30, lng: p.gcj ? p.gcj[1] : 103, days: [] }
      BANDS.forEach(function (b) {
        const band = b.band(p.elevation, cf.covered)
        if (!(band.hi > band.lo)) return
        const ws = realSeas(field, ctxBase, b.cap == null ? band : { lo: PROD.lo, hi: PROD.hi })
        loc._w[b.id] += ws.length
        realWindows[b.id].窗口数 += ws.length
        ws.forEach(function (w) {
          realWindows[b.id].覆盖小时数 += w.clearances.length
          if (w.cut) realWindows[b.id].含被切层的窗口++
        })
      })
      for (let h = 0; h < cf.times.length; h++) {
        BANDS.forEach(function (b) {
          const band = b.band(p.elevation, cf.covered)
          if (!(band.hi > band.lo)) return
          /* 层集合只取决于带，与点海拔无关 ⇒ 只算一次，±600 摆动复用同一批层 */
          const L = layersAt(at, h, band.lo, band.hi)
          const c = candidate(L, p.elevation, b.cap)
          if (!c) return
          hourSets[b.id].add(p.name + '|' + day + '|' + h)
          clearances[b.id].push(c.clearance)
          loc._c[b.id].push(c.clearance)
          cutRate[b.id][1]++
          if (c.layer.cut) cutRate[b.id][0]++
          basisFlip.总候选小时++
          if (candidate(L, p.elevation + 600, b.cap) === null) basisFlip.模型抬高会翻++
          if (candidate(L, p.elevation - 600, b.cap) === null) basisFlip.模型压低会翻++
        })
      }
    }
    BANDS.forEach(b => {
      loc.各口径候选小时数[b.id] = loc._c[b.id].length
      loc.clearanceP50[b.id] = quant(loc._c[b.id], 0.5)
      loc.真实OI窗口数[b.id] = loc._w[b.id]
    })
    delete loc._c; delete loc._w
    per.地点.push(loc)
  })

  /* 逐地点重算一遍（上面的累加是全局的，这里给出分地点视角） */
  BANDS.forEach(function (b) {
    per.口径.push({ 口径: b.id, 说明: b.说明,
      候选小时数: clearances[b.id].length,
      clearance分布: { P10: quant(clearances[b.id], 0.1), P50: quant(clearances[b.id], 0.5), P90: quant(clearances[b.id], 0.9), max: clearances[b.id].length ? Math.max.apply(null, clearances[b.id]) : null },
      候选层被带切到的比例: cutRate[b.id][1] ? Math.round(cutRate[b.id][0] / cutRate[b.id][1] * 100) + '%' : null,
      真实OI窗口数: realWindows[b.id].窗口数, 真实OI窗口覆盖小时: realWindows[b.id].覆盖小时数,
      真实OI窗口里含被切层的: realWindows[b.id].含被切层的窗口 })
  })
  const base = hourSets['现状']
  BANDS.forEach(function (b) {
    const s = hourSets[b.id]
    b.相对现状 = { 新增小时: [...s].filter(x => !base.has(x)).length, 消失小时: [...base].filter(x => !s.has(x)).length, 共有: [...s].filter(x => base.has(x)).length }
  })
  per.口径差异 = BANDS.map(b => ({ 口径: b.id, 说明: b.说明, 相对现状: b.相对现状 }))
  per.海拔出处敏感性 = { 说明: '候选小时在把点海拔按模型高程 ±600 m 摆动后是否还在（同一层集合重算）', 总候选小时: basisFlip.总候选小时,
    抬高600后不再是候选: basisFlip.模型抬高会翻, 压低600后不再是候选: basisFlip.模型压低会翻 }
  report.快照.push(per)
})

console.log(JSON.stringify(report, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'g2-height-basis.json'), JSON.stringify(report, null, 2))
