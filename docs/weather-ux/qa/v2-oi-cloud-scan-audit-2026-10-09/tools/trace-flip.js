/* 追查一次「影子运行里凭空多出的云海窗口」——未解释的差异必须归因，不能写进报告当结论 */
'use strict'
const fs = require('fs')
const path = require('path')
const CFF = require('../../../../../miniprogram/utils/cloud-field-svg.js')
const WCFF = require('../../../../../miniprogram/utils/weather-cloud-field.js')
const OI = require('../../../../../miniprogram/utils/outdoor-intelligence.js')
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'real-cloud.json'), 'utf8'))
const p = snap.places.emeishan
const DAY = '2026-10-11', ALT = p.elevation
const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: DAY, hours: 24, userAltitude: ALT })
const column = CFF.makeColumnSampler(cf)
const sample = (t, a) => CFF.sampleAtStations(column, cf.times.length, t, a)
const LMIN = 80, STEP = 50
function layersAt (t, lo, hi) {
  const pts = []
  for (let alt = lo; alt <= hi; alt += STEP) pts.push({ alt: alt, cover: sample(t, alt) })
  const runs = []; let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= LMIN, prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const base = prev && prev.cover < LMIN ? prev.alt + (LMIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover] }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) } else if (!on && run) { runs.push(run); run = null }
  }
  if (run) { run.top = hi; runs.push(run) }   // ← OI 的开放段收尾：run.top = ALT1
  return runs.map(l => ({ base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
    meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length), peak: Math.max.apply(null, l.covers) }))
}
console.log('包络', JSON.stringify(cf.covered), '点', ALT)
;[15, 16, 17, 18, 19].forEach(h => {
  const A = layersAt(h, 2000, 6000), B = layersAt(h, cf.covered.lo, cf.covered.hi)
  console.log('h=' + h, '固定带层', JSON.stringify(A), '| 包络层', JSON.stringify(B))
})
function run (scan) {
  const saved = { lo: CFF.ALT0, hi: CFF.ALT1 }
  if (scan) { CFF.ALT0 = scan.lo; CFF.ALT1 = scan.hi }
  let oi
  try {
    oi = OI.buildOutdoorIntelligence({ date: DAY, detail: p.series.filter(r => r.d === DAY), userAltitude: ALT,
      elevOK: true, elevBasis: 'measured', lat: p.gcj[0], lng: p.gcj[1], cloudField: cf, days: [] })
  } finally { CFF.ALT0 = saved.lo; CFF.ALT1 = saved.hi }
  return (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA').map(o => ({
    from: o.from, to: o.to, confidence: o.confidence,
    ev: (o.evidence || []).map(e => String(e.fact || e)).slice(0, 6) }))
}
console.log('\n固定带（生产现状）云海窗口:', JSON.stringify(run(null), null, 1))
console.log('\n包络扫描（影子）云海窗口:', JSON.stringify(run({ lo: cf.covered.lo, hi: cf.covered.hi }), null, 1))
