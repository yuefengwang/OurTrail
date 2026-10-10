/* 用生产规则重测上一轮的"相对带 vs 固定带"对比 —— 上一轮那组数是用漏了退出点插值的层提取跑的。
 *
 * 要回答三件事（都只到候选级，不做窗口级断言）：
 *   ① 相对带是否仍然把"候选层被窗边界切到"的比例打到 0？
 *   ② 相对带是否仍然新增候选小时？新增几小时？
 *   ③ 上一轮 ceiling-probe 的结论（带上界收到点海拔 0 次改变判定）在生产规则下还成立吗？
 * 只读。运行：node rebake-relative-band.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const COVER = 80, CLEAR = 200, THICK = 300, STEP = 50, D = 2500

function layersAt (at, t, lo, hi, off) {
  const pts = []
  for (let a = lo + off; a <= hi; a += STEP) pts.push({ alt: a, cover: at(t, a) })
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
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length),
      cut: l.baseCut === true || l.topCut === true }
  }).sort((a, b) => a.base - b.base)
}
function cand (L, u) {
  const below = L.filter(l => l.top <= u)
  if (!below.length) return null
  const l = below[below.length - 1], c = u - l.top
  if (c < CLEAR || l.meanCover < COVER || l.thickness < THICK) return null
  return { layer: l, clearance: Math.round(c) }
}
const BANDS = [
  { id: '现状', lo: () => CFF.ALT0, hi: () => CFF.ALT1 },
  { id: 'K1-2500', lo: (u, cov) => Math.max(cov.lo, u - D), hi: (u, cov) => Math.min(cov.hi, u) },
  { id: 'K1-2500_上界放回', lo: (u, cov) => Math.max(cov.lo, u - D), hi: (u, cov) => Math.min(cov.hi, CFF.ALT1) },
]
const out = { generatedAt: new Date().toISOString(), 步长: STEP, 相对带上沿: 'min(covered.hi, 点海拔)', 快照: [] }

;[
  { name: '3 站 × 72h', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
].forEach(function (sn) {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, sn.p), 'utf8'))
  const setOf = {}
  BANDS.forEach(b => { setOf[b.id] = new Set() })
  const cut = {}; BANDS.forEach(b => { cut[b.id] = [0, 0] })
  const flipDetail = []
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
        const res = {}
        BANDS.forEach(function (b) {
          const lo = b.lo(p.elevation, cf.covered), hi = b.hi(p.elevation, cf.covered)
          if (!(hi > lo)) { res[b.id] = null; return }
          const c = cand(layersAt(at, h, lo, hi, 0), p.elevation)
          res[b.id] = c
          if (c) { setOf[b.id].add(p.name + '|' + day + '|' + h); cut[b.id][1]++; if (c.layer.cut) cut[b.id][0]++ }
        })
        if (!!res['K1-2500'] !== !!res['K1-2500_上界放回']) {
          flipDetail.push({ 地点: p.name, 日: day, 时: h, 相对带_上界到点: res['K1-2500'] ? '候选' : '非', 相对带_上界放回: res['K1-2500_上界放回'] ? '候选' : '非' })
        }
      }
    }
  })
  const base = setOf['现状']
  out.快照.push({ 快照: sn.name,
    候选小时数: BANDS.reduce(function (a, b) { a[b.id] = setOf[b.id].size; return a }, {}),
    候选层被切到的比例: BANDS.reduce(function (a, b) { a[b.id] = cut[b.id][1] ? Math.round(cut[b.id][0] / cut[b.id][1] * 100) + '% (' + cut[b.id][0] + '/' + cut[b.id][1] + ')' : '无候选'; return a }, {}),
    相对现状: BANDS.reduce(function (a, b) {
      const s = setOf[b.id]
      a[b.id] = { 新增: [...s].filter(x => !base.has(x)).length, 消失: [...base].filter(x => !s.has(x)).length }
      return a
    }, {}),
    上界收到点海拔导致候选级变化的小时: flipDetail.length, 明细: flipDetail.slice(0, 8) })
})
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'rebake-relative-band.json'), JSON.stringify(out, null, 2))
