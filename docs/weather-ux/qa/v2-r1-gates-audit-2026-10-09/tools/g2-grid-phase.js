/* G2 补测：云海判据对**扫描网格相位**稳不稳？
 *
 * 起因：口径对拍里出现一个无法用"业务差异"解释的读数——把扫描带从固定 2,000–6,000
 * 换成相对带之后，有一小时的候选**消失**了，而两版层集合的云顶只差 11 m（2,800 vs 2,811），
 * 净空从 204 掉到 193，正好跨过 200 m 的门槛。也就是说：**带的起点对齐方式**（网格相位）
 * 本身可以决定一个小时算不算云海。这条如果成立，任何以净空为主判据的口径都必须先回答它。
 *
 * 测法：保持步长 50 m 不变，只把扫描起点平移 0/10/25/40 m（同一份数据、同一套判据），
 *       数候选判定翻转的小时数。平移起点不改变任何业务阈值，只改变采样落点。
 * 只读，不改生产代码。运行：node g2-grid-phase.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const STEP = 50, COVER = 80, CLEAR = 200, THICK = 300
const OFFSETS = [0, 10, 25, 40]

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
    else if (!on && run) { run.cut = run.cut || false; runs.push(run); run = null }
  }
  if (run) { run.top = hi; run.cut = true; runs.push(run) }
  return runs.map(function (l) {
    return { base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length), cut: l.cut }
  }).sort((a, b) => a.base - b.base)
}
function verdict (L, u) {
  const below = L.filter(l => l.top <= u)
  if (!below.length) return 'NO_LAYER_BELOW'
  const l = below[below.length - 1], c = u - l.top
  if (c < CLEAR) return c < 0 ? 'USER_INSIDE_CLOUD' : 'USER_NOT_ABOVE_CLOUD'
  if (l.meanCover < COVER) return 'LOW_COVERAGE'
  if (l.thickness < THICK) return 'INSUFFICIENT_THICKNESS'
  return 'CANDIDATE'
}
const SNAPS = [
  { name: '3 站 × 72h', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
]
const out = { generatedAt: new Date().toISOString(), 步长: STEP, 平移量: OFFSETS, 判据: { 覆盖: COVER, 净空: CLEAR, 层厚: THICK }, 结果: [] }
SNAPS.forEach(function (sn) {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, sn.p), 'utf8'))
  const hours = []
  let total = 0
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
      for (let h = 0; h < cf.times.length; h++) {
        total++
        const vs = OFFSETS.map(o => verdict(layersAt(at, h, CFF.ALT0 + o, CFF.ALT1), p.elevation))
        const set = new Set(vs)
        if (set.size > 1) hours.push({ 地点: p.name, 日: day, 时: h, 各平移下的判定: vs, 平移量: OFFSETS })
      }
    }
  })
  out.结果.push({ 快照: sn.name, 扫描带: [CFF.ALT0, CFF.ALT1], 评过的小时数: total, 因起点平移而翻转的小时数: hours.length,
    翻转率: total ? Math.round(hours.length / total * 1000) / 10 + '%' : null, 明细: hours.slice(0, 12) })
})
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'g2-grid-phase.json'), JSON.stringify(out, null, 2))
