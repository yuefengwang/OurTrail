/* 保真度探针：上一轮审计脚本里"独立重写的层提取"与生产 `cloudLayersAt` 差在哪，差多少。
 *
 * 起因：本轮把生产规则照抄进 Q6 之后，上一轮点名的可复现案例（峨眉山 2026-10-09 02:00，
 * 报告写成「云顶 2,800 vs 2,811、净空 204→193、判定随相位翻转」）**不再复现**：
 * 生产规则下该小时云顶恒为 2,828、净空恒为 176、50 个相位判定完全一致（且本来就不是候选）。
 * 差别来自一处实现差：生产在**退出点**也做线性插值（outdoor-intelligence.js:120–123），
 * 而上一轮的 `g2-grid-phase.js` / `g2-height-basis.js` 里 `else if (!on && run)` 只 `push(run)`，
 * 云顶停在最后一个 ≥80% 的**格点**上。
 *
 * 本脚本把两种实现放在同一份数据上对跑，量化它对「候选小时数」与「层边界」的影响，
 * 并顺带核对：1 m 步长（连续参照）与 50 m 步长在偏移 0 处的边界差 —— 用来分开
 * 「离散化误差」与「相位噪声」。
 *
 * 只读。运行：node fidelity-probe.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const OI = require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))
const COVER = 80, CLEAR = 200, THICK = 300, STEP = 50

/* 生产规则：进入点与退出点都插值 */
function prodLayers (at, t, lo, hi, step, off) {
  const pts = []
  for (let a = lo + off; a <= hi; a += step) pts.push({ alt: a, cover: at(t, a) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= COVER, prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const cr = !!(prev && prev.cover < COVER)
      run = { base: cr ? prev.alt + (COVER - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt,
        top: pts[i].alt, covers: [pts[i].cover], baseCut: !cr }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) {
      run.top = prev.cover > COVER ? prev.alt + (COVER - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : prev.alt
      run.topCut = false; runs.push(run); run = null
    }
  }
  if (run) { run.top = hi; run.topCut = true; runs.push(run) }
  return runs.map(function (l) {
    return { base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length), cut: l.baseCut === true || l.topCut === true }
  }).sort((a, b) => a.base - b.base)
}
/* 上一轮的实现：退出点不插值（云顶停在最后一个 ≥80% 格点） */
function oldLayers (at, t, lo, hi, step, off) {
  const pts = []
  for (let a = lo + off; a <= hi; a += step) pts.push({ alt: a, cover: at(t, a) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= COVER, prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const cr = !!(prev && prev.cover < COVER)
      run = { base: cr ? prev.alt + (COVER - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt,
        top: pts[i].alt, covers: [pts[i].cover], cut: !cr }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) { runs.push(run); run = null }
  }
  if (run) { run.top = hi; run.cut = true; runs.push(run) }
  return runs.map(function (l) {
    return { base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length), cut: l.cut }
  }).sort((a, b) => a.base - b.base)
}
function cand (L, u) {
  const below = L.filter(l => l.top <= u)
  if (!below.length) return null
  const l = below[below.length - 1], c = u - l.top
  if (c < CLEAR || l.meanCover < COVER || l.thickness < THICK) return null
  return { layer: l, clearance: Math.round(c) }
}
const SNAPSHOTS = [
  { name: '3 站 × 72h', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
]
const out = { generatedAt: new Date().toISOString(), 快照: [] }

SNAPSHOTS.forEach(function (sn) {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, sn.p), 'utf8'))
  let 生产候选 = 0, 旧候选 = 0, 差异小时 = [], 云顶差 = [], 层厚差 = [], 相位翻转_生产 = 0, 相位翻转_旧 = 0, hours = 0
  let 参照差_生产 = [], 参照差_旧 = []
  Object.keys(snap.places).forEach(function (k) {
    const p = snap.places[k]
    if (!p.cloudLevels) return
    const nDays = Math.min(sn.days, Math.floor(((p.series || []).length) / 24))
    for (let d = 0; d < nDays; d++) {
      const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
      const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
      if (!cf) continue
      const col = CFF.makeColumnSampler(cf)
      const at = (t, a) => CFF.sampleAtStations(col, cf.times.length, t, a)
      for (let h = 0; h < 24; h++) {
        hours++
        const A = cand(prodLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, 0), p.elevation)
        const B = cand(oldLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, 0), p.elevation)
        if (A) 生产候选++
        if (B) 旧候选++
        if (!!A !== !!B) 差异小时.push({ 地点: p.name, 日: day, 时: h, 生产: A ? A.clearance : null, 旧: B ? B.clearance : null,
          生产层: A ? [A.layer.base, A.layer.top, A.layer.thickness] : (prodLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, 0)[0] || null),
          旧层: B ? [B.layer.base, B.layer.top, B.layer.thickness] : (oldLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, 0)[0] || null) })
        const pa = prodLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, 0), ob = oldLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, 0)
        if (pa[0] && ob[0]) { 云顶差.push(Math.abs(pa[0].top - ob[0].top)); 层厚差.push(Math.abs(pa[0].thickness - ob[0].thickness)) }
        /* 相位翻转：同一小时在 5 个相位下「是否成为候选」是否变化（两种规则同口径对比） */
        const setP = new Set([0, 10, 25, 40, 49].map(o => !!cand(prodLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, o), p.elevation)))
        const setO = new Set([0, 10, 25, 40, 49].map(o => !!cand(oldLayers(at, h, CFF.ALT0, CFF.ALT1, STEP, o), p.elevation)))
        if (setP.size > 1) 相位翻转_生产++
        if (setO.size > 1) 相位翻转_旧++
        const r1 = cand(prodLayers(at, h, CFF.ALT0, CFF.ALT1, 1, 0), p.elevation)
        if (r1 && A) 参照差_生产.push(Math.abs(A.layer.top - r1.layer.top))
        if (r1 && B) 参照差_旧.push(Math.abs(B.layer.top - r1.layer.top))
      }
    }
  })
  const mx = a => a.length ? Math.max.apply(null, a) : null
  const md = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)] }
  out.快照.push({ 快照: sn.name, 小时数: hours,
    候选小时_生产规则: 生产候选, 候选小时_上一轮规则: 旧候选,
    两规则结论不同的小时: 差异小时.length, 明细: 差异小时.slice(0, 10),
    第一层云顶差: { 中位: md(云顶差), 最大: mx(云顶差) },
    第一层层厚差: { 中位: md(层厚差), 最大: mx(层厚差) },
    相位翻转小时数_生产规则: 相位翻转_生产, 相位翻转小时数_上一轮规则: 相位翻转_旧,
    云顶对1米参照差_生产规则: { 中位: md(参照差_生产), 最大: mx(参照差_生产) },
    云顶对1米参照差_上一轮规则: { 中位: md(参照差_旧), 最大: mx(参照差_旧) } })
})
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'fidelity-probe.json'), JSON.stringify(out, null, 2))
