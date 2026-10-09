/* R2 前后 A/B：证明「边界语义修复」只改证据文案，不改任何业务判据
 *
 * 做法：把 6d7a1dc（R2 之前）的 miniprogram/utils 整棵树用 git archive 取到仓库外，
 *       与当前工作树各起一份模块实例，喂完全相同的输入跑整条 OI 管线，逐字段比对：
 *         · opportunities 的 type/from/to/confidence/rank/strength —— 必须逐字相同
 *         · 云海窗口的 layers[].{t,base,top,cover,clearance} —— 必须逐字相同（数值一个不许动）
 *         · conditions（key/reason/holds）—— 必须逐字相同
 *         · evidence[] 文本 —— 允许且只允许在「层触及扫描窗边界」时变化
 * 运行：node ab-r2.js <pre-R2-utils-dir>
 */
'use strict'
const fs = require('fs')
const path = require('path')
const PRE_DIR = process.argv[2]
const ROOT = path.resolve(__dirname, '../../../../../')
if (!PRE_DIR || !fs.existsSync(path.join(PRE_DIR, 'outdoor-intelligence.js'))) {
  console.error('用法：node ab-r2.js <R2 之前的 utils 目录>（git archive 6d7a1dc miniprogram/utils | tar -x -C <dir>）')
  process.exit(2)
}
/* 版本门读**文件源码**而不是读函数 toString()——baseBoundary 出现在 detectCloudSea 里，
   String(buildOutdoorIntelligence) 看不见它，那样写会是一条永远不响的假门。 */
if (fs.readFileSync(path.join(PRE_DIR, 'outdoor-intelligence.js'), 'utf8').indexOf('baseBoundary') >= 0) {
  console.error('给定的 utils 目录里已经有 baseBoundary —— 那不是 R2 之前的版本')
  process.exit(2)
}
if (require.resolve(path.join(PRE_DIR, 'outdoor-intelligence.js')) ===
    require.resolve(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))) {
  console.error('给定的 utils 目录与当前工作树是同一份，比不出前后差异')
  process.exit(2)
}
const PRE = require(path.join(PRE_DIR, 'outdoor-intelligence.js'))
const POST = require('../../../../../miniprogram/utils/outdoor-intelligence.js')
const CFF = require('../../../../../miniprogram/utils/cloud-field-svg.js')
const WCFF = require('../../../../../miniprogram/utils/weather-cloud-field.js')

const WIN_LO = CFF.ALT0, WIN_HI = CFF.ALT1
const ALTS = (function () { const a = []; for (let x = 0; x <= 7000; x += 250) a.push(x); return a })()
function fieldOf (decks, covered, hours) {
  const n = hours || 24
  const times = []
  for (let h = 0; h < n; h++) times.push(h)
  const values = times.map(() => ALTS.map(a => {
    if (a < covered.lo || a > covered.hi) return 0
    let v = 0
    decks.forEach(d => { if (a >= d.lo && a <= d.hi) v = Math.max(v, d.cov) })
    return v
  }))
  return { times, altitudes: ALTS, values, covered, meta: { hours: n } }
}
function detailOf (n, cloudLow) {
  const out = []
  for (let h = 0; h < n; h++) out.push({
    t: String(h).padStart(2, '0') + ':00', d: '2026-10-09',
    temp: 8, pop: 0, precip: 0, showers: 0, code: 1, wind: 4, gust: 9, windDir: 45, rh: 60,
    cloud: { low: cloudLow(h), mid: 0, high: 0 }, visibility: 40, freezing: 4600, band: null,
  })
  return out
}
function sampler (field) {
  const col = CFF.makeColumnSampler(field)
  return (t, a) => CFF.sampleAtStations(col, field.times.length, t, a)
}
function run (OI, field, alt, lowFn) {
  const sample = sampler(field)
  return OI.buildOutdoorIntelligence({
    date: '2026-10-09', detail: detailOf(field.times.length, lowFn), userAltitude: alt,
    elevOK: Number.isFinite(alt), elevBasis: 'measured', lat: 30.0, lng: 100.27,
    cloudField: Object.assign({}, field, { sample: sample, userAltitude: alt }), days: [],
  })
}
function digest (oi) {
  return {
    opportunities: (oi.opportunities || []).map(o => [o.type, o.from, o.to, o.confidence, o.rank, o.strength || '']),
    seaLayers: (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
      .map(o => (o.layers || []).map(l => [l.t, l.base, l.top, l.cover, l.clearance])),
    conditions: (oi.conditions || []).map(c => [c.t, c.key, c.reason, (c.holds || []).join('')]),
    evidence: (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
      .map(o => (o.evidence || []).map(e => String(e.fact || e))),
  }
}

const LOW_MORNING = h => (h >= 5 && h < 10 ? 92 : 5)
const CASES = [
  ['① 云层完整落在窗内（2,400–3,300m）', fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], { lo: 1000, hi: 6000 }), 4200],
  ['② 云底恰在扫描下界（2,000–2,600m）', fieldOf([{ lo: 1900, hi: 2600, cov: 92 }], { lo: 1000, hi: 6000 }), 4200],
  ['③ 云顶触及扫描上界（5,600–6,000m）', fieldOf([{ lo: 5600, hi: 6000, cov: 92 }], { lo: 1000, hi: 6600 }), 6900],
  ['④ 云层贯穿整个窗（1,500–6,500m）', fieldOf([{ lo: 1500, hi: 6500, cov: 92 }], { lo: 1000, hi: 6800 }), 6900],
  ['⑤ 晴空（无 ≥80% 层）', fieldOf([], { lo: 1000, hi: 6000 }), 4200],
  ['⑥ 无实测包络（covered=null 形态）', (function () { const f = fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], { lo: 1000, hi: 6000 }); f.covered = null; return f })(), 4200],
]

const out = { generatedAt: new Date().toISOString(), scanWindow: [WIN_LO, WIN_HI], cases: [], real: [] }
let bizDiffs = 0, evidenceDiffs = 0

console.log('== 合成案例：R2 前后逐字段比对 ==')
CASES.forEach(function (c) {
  const nm = c[0], field = c[1], alt = c[2]
  let a, b
  try { a = digest(run(PRE, field, alt, LOW_MORNING)); b = digest(run(POST, field, alt, LOW_MORNING)) }
  catch (e) { console.log(nm + ' | 抛错 ' + e.message); out.cases.push({ 案例: nm, error: e.message }); return }
  const bizSame = JSON.stringify([a.opportunities, a.seaLayers, a.conditions]) === JSON.stringify([b.opportunities, b.seaLayers, b.conditions])
  const evSame = JSON.stringify(a.evidence) === JSON.stringify(b.evidence)
  if (!bizSame) bizDiffs++
  if (!evSame) evidenceDiffs++
  console.log([nm, '业务判据相同=' + bizSame, '证据文本相同=' + evSame,
    '窗口=' + JSON.stringify(b.opportunities.map(o => o[0] + '@' + o[1] + '-' + o[2] + '/' + o[3])),
    '层数值=' + JSON.stringify(b.seaLayers)].join(' | '))
  if (!evSame) {
    console.log('    旧证据 ' + JSON.stringify(a.evidence))
    console.log('    新证据 ' + JSON.stringify(b.evidence))
  }
  out.cases.push({ 案例: nm, 海拔: alt, covered: field.covered, 业务判据相同: bizSame, 证据文本相同: evSame,
    前: a, 后: b })
})

console.log('\n== 真实快照：3 站 × 3 天 × 4 组海拔/出处 ==')
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/weather-ux/qa/v2-oi-cloud-scan-audit-2026-10-09/tools/real-cloud.json'), 'utf8'))
Object.keys(snap.places).forEach(function (k) {
  const p = snap.places[k]
  for (let d = 0; d < 3; d++) {
    const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
    if (!cf) continue
    const sample = sampler(cf)
    const fieldObj = Object.assign({}, cf, { sample: sample, userAltitude: p.elevation })
    const detail = p.series.filter(r => r.d === day)
    ;[['measured', true], ['estimated', true], ['none', false], ['missing', false]].forEach(function (pair) {
      const basis = pair[0]
      const alt = basis === 'missing' ? null : p.elevation
      const ctxFor = OI => OI.buildOutdoorIntelligence({
        date: day, detail: detail, userAltitude: alt, elevOK: pair[1] && Number.isFinite(alt),
        elevBasis: basis === 'missing' ? 'none' : basis, lat: p.gcj[0], lng: p.gcj[1],
        cloudField: fieldObj, days: [],
      })
      const a = digest(ctxFor(PRE)), b = digest(ctxFor(POST))
      const bizSame = JSON.stringify([a.opportunities, a.seaLayers, a.conditions]) === JSON.stringify([b.opportunities, b.seaLayers, b.conditions])
      const evSame = JSON.stringify(a.evidence) === JSON.stringify(b.evidence)
      if (!bizSame) bizDiffs++
      if (!evSame) evidenceDiffs++
      if (!bizSame || !evSame) {
        console.log([p.name, day, basis, '业务相同=' + bizSame, '证据相同=' + evSame,
          '窗口 ' + JSON.stringify(b.opportunities.map(o => o[0] + '@' + o[1] + '-' + o[2] + '/' + o[3]))].join(' | '))
        if (!evSame) { console.log('    旧 ' + JSON.stringify(a.evidence)); console.log('    新 ' + JSON.stringify(b.evidence)) }
      }
      out.real.push({ place: p.name, day: day, basis: basis, 业务判据相同: bizSame, 证据文本相同: evSame,
        窗口数_前: a.opportunities.length, 窗口数_后: b.opportunities.length,
        云海窗口_后: b.opportunities.filter(o => o[0] === 'CLOUD_SEA') })
    })
  }
})
const total = out.cases.length + out.real.length
console.log('\n合计比对 ' + total + ' 组：业务判据差异 ' + bizDiffs + ' 组，证据文本差异 ' + evidenceDiffs + ' 组')
fs.writeFileSync(path.join(__dirname, '..', 'ab-r2.json'), JSON.stringify(out, null, 2))
console.log('→ ab-r2.json')
