/* G2 归因探针：相对带（K1）与现状带判定不同的那几个小时，责任在带上界还是带下界？
 *
 * 起因：报告初稿把 K1-3500「反而少了一小时」归因于「带上界收到点海拔，会让穿过点的云
 * 从『顶在点上方』变成『顶=点』」。那是一个**没测过的推测**。本脚本把它拆开验证：
 *   A = 现状带 [2000,6000]
 *   B = K1 带 [max(covered.lo, 点−3500), min(covered.hi, 点)]      ← 上下界都动
 *   C = 只动下界 [max(covered.lo, 点−3500), min(covered.hi, 6000)]  ← 上界放回 6000
 * 若 B 与 C 判定一致 ⇒ 翻转全部来自下界，与上界无关，初稿的归因作废。
 * 另外单独数一遍：有多少小时的带上界真的被「点海拔」夹住（clamped），以及其中多少改变了判定。
 *
 * 只读，不改生产代码。运行：node g2-ceiling-probe.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const STEP = 50, COVER = 80, CLEAR = 200, THICK = 300, D = 3500

function layersAt (at, t, lo, hi) {
  const pts = []
  for (let a = lo; a <= hi; a += STEP) pts.push({ alt: a, cover: at(t, a) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= COVER, prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const cr = !!(prev && prev.cover < COVER)
      const base = cr ? prev.alt + (COVER - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover], cut: !cr }
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
  const b = L.filter(l => l.top <= u)
  if (!b.length) return null
  const l = b[b.length - 1], c = u - l.top
  if (c < CLEAR || l.meanCover < COVER || l.thickness < THICK) return null
  return { layer: l, clearance: Math.round(c) }
}
const SNAPS = [
  { name: '3 站 × 72h', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
]
const out = { generatedAt: new Date().toISOString(), 相对带定义: '下沿 max(covered.lo, 点−' + D + ')，上沿 min(covered.hi, 点)', 结果: [] }
SNAPS.forEach(function (sn) {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, sn.p), 'utf8'))
  let checked = 0, flips = 0, fromLowerOnly = 0, clampedHours = 0, clampedChangedVerdict = 0
  const detail = []
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
      const cov = cf.covered
      for (let h = 0; h < cf.times.length; h++) {
        checked++
        const lo = Math.max(cov.lo, p.elevation - D), hiPoint = Math.min(cov.hi, p.elevation), hiFull = Math.min(cov.hi, CFF.ALT1)
        const A = cand(layersAt(at, h, CFF.ALT0, CFF.ALT1), p.elevation)
        const B = cand(layersAt(at, h, lo, hiPoint), p.elevation)
        const C = cand(layersAt(at, h, lo, hiFull), p.elevation)
        const clamped = hiPoint < hiFull
        if (clamped) clampedHours++
        if (!!A !== !!B) {
          flips++
          if (!!C === !!B) fromLowerOnly++
          detail.push({ 地点: p.name, 日: day, 时: h, 现状: A ? '候选' : '拒', 相对带_上下都动: B ? '候选' : '拒',
            相对带_只动下界: C ? '候选' : '拒', 净空_现状: A ? A.clearance : null, 净空_相对带: B ? B.clearance : null,
            云顶_现状带: A ? A.layer.top : null, 云顶_相对带: B ? B.layer.top : null, 带上界被点夹住: clamped })
        }
        if (clamped && !!B !== !!C) clampedChangedVerdict++
      }
    }
  })
  out.结果.push({ 快照: sn.name, 评过小时: checked, 判定翻转的小时: flips,
    翻转中只动下界就能复现的: fromLowerOnly,
    带上界被点海拔夹住的小时: clampedHours, 其中夹住导致判定变化的: clampedChangedVerdict,
    归因: flips === 0 ? '无翻转' : (fromLowerOnly === flips
      ? '全部翻转来自带**下沿**（含采样网格相位），与带上界无关 ⇒ 「上界收到点海拔会误判」这条推测不成立'
      : '部分翻转来自带上界，需保留该顾虑'),
    明细: detail })
})
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'g2-ceiling-probe.json'), JSON.stringify(out, null, 2))
