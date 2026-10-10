/* 三层架构首个纵向切片的跨版本对拍：50d657a（切片前）vs 当前工作树（切片后）
 *
 * 规矩沿用 R2 那一轮（铁律 28②）：「只搬代码、不改判据」这句话本身必须是可证的。
 * 做法：`git archive 50d657a miniprogram/utils` 取到仓库外，两份模块实例喂**同一份输入**
 *       跑整条 OI 管线，逐字段比：
 *   业务判据（必须逐字相同）opportunities 的 type/from/to/confidence/rank/strength、
 *                           云海 windows 覆盖的小时数、layers[].{t,base,top,cover,clearance}、
 *                           层数组的长度与顺序、conditions 的 key/reason/holds
 *   允许变化的只有两处，且必须逐条列出：
 *     ① 层记录与窗口上**新增**的字段（baseSource/topSource/scanLo/scanHi）—— 只增不改
 *     ② meta.cloudSea 新增 notEvaluated / scanRanges，以及 INSUFFICIENT_THICKNESS 的
 *        detail 文案补了一句边界说明（模型内部负证据，UI 不展示，不参与任何判定）
 *
 * 运行：node ab-slice.js <切片前的 utils 目录>
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../..')
const PRE_DIR = process.argv[2]
if (!PRE_DIR || !fs.existsSync(path.join(PRE_DIR, 'outdoor-intelligence.js'))) {
  console.error('用法：node ab-slice.js <切片前的 utils 目录>（git archive 50d657a miniprogram/utils | tar -x -C <dir>）')
  process.exit(2)
}
if (fs.readFileSync(path.join(PRE_DIR, 'outdoor-intelligence.js'), 'utf8').indexOf('cloud-layer-facts') >= 0) {
  console.error('给定的 utils 目录里已经引用 cloud-layer-facts —— 那不是切片前的版本')
  process.exit(2)
}
if (require.resolve(path.join(PRE_DIR, 'outdoor-intelligence.js')) ===
    require.resolve(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))) {
  console.error('给定的 utils 目录与当前工作树是同一份，比不出前后差异')
  process.exit(2)
}
const PRE = require(path.join(PRE_DIR, 'outdoor-intelligence.js'))
const POST = require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))

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
  return { times: times, altitudes: ALTS, values: values, covered: covered, meta: { hours: n } }
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
function run (OI, field, alt, lowFn, basis, elevOK) {
  const sample = sampler(field)
  return OI.buildOutdoorIntelligence({
    date: '2026-10-09', detail: detailOf(field.times.length, lowFn), userAltitude: alt,
    elevOK: elevOK !== false && Number.isFinite(alt), elevBasis: basis, lat: 30.0, lng: 100.27,
    cloudField: Object.assign({}, field, { sample: sample, userAltitude: alt }), days: [],
  })
}
/* 业务字段：这些必须逐字相同 */
function biz (oi) {
  return {
    opportunities: (oi.opportunities || []).map(o => [o.type, o.from, o.to, o.confidence, o.rank, o.strength || '', o.overlapsSunrise === true]),
    seaHours: (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
      .map(o => (o.layers || []).map(l => [l.t, l.base, l.top, l.cover, l.clearance])),
    seaLayerCount: (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA').map(o => (o.layers || []).length),
    boundaryFlags: (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
      .map(o => (o.layers || []).map(l => [l.baseBoundary === true, l.topBoundary === true])),
    conditions: (oi.conditions || []).map(c => [c.t, c.key, c.reason, (c.holds || []).join('')]),
    candidates: ((oi.meta.cloudSea || {}).candidates || []).map(c => [c.t, c.layer.base, c.layer.top, c.layer.thickness, c.clearance]),
    rejectedReasons: ((oi.meta.cloudSea || {}).rejected || []).map(r => [r.t != null ? r.t : r.from + '-' + r.to, r.reason]),
  }
}
/* 非业务字段：只允许"新增键"，不许删键、不许改已有键的值（值由 biz() 逐字段比过） */
const BIZ_KEYS = ['t', 'base', 'top', 'cover', 'clearance', 'baseBoundary', 'topBoundary']
function extras (oi) {
  const seas = (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
  return {
    layerKeys: [].concat.apply([], seas.map(o => (o.layers || []).map(l => Object.keys(l).sort()))),

    notEvaluatedLen: ((oi.meta.cloudSea || {}).notEvaluated || []).length,
    hasScanRanges: !!((oi.meta.cloudSea || {}).scanRanges),
    rejectedDetails: ((oi.meta.cloudSea || {}).rejected || []).map(r => r.detail),
  }
}
/* PRE 的每一个键，POST 都必须还在；多出来的键允许（那就是本轮加的溯源字段） */
function keysOnlyGrew (preRows, postRows) {
  if (preRows.length !== postRows.length) return false
  return preRows.every(function (row, i) {
    const p = Array.isArray(row) ? row : (row || [])
    const q = postRows[i] || []
    return p.every(k => q.indexOf(k) >= 0)
  })
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const LOW = h => (h >= 5 && h < 10) ? 92 : 5
const CASES = [
  ['① 云层完整落在窗内', fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], { lo: 1000, hi: 6000 }), 4200],
  ['② 云底恰在扫描下界', fieldOf([{ lo: 1900, hi: 2600, cov: 92 }], { lo: 1000, hi: 6000 }), 4200],
  ['③ 云顶触及扫描上界', fieldOf([{ lo: 5600, hi: 6000, cov: 92 }], { lo: 1000, hi: 6600 }), 6900],
  ['④ 云层贯穿整个窗', fieldOf([{ lo: 1500, hi: 6500, cov: 92 }], { lo: 1000, hi: 6800 }), 6900],
  ['⑤ 晴空（无 ≥80% 层）', fieldOf([], { lo: 1000, hi: 6000 }), 4200],
  ['⑥ 无实测包络 covered=null', (function () { const f = fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], { lo: 1000, hi: 6000 }); f.covered = null; return f })(), 4200],
  ['⑦ 点下方两层：厚层 + 恰好结束在点下方的薄皮', fieldOf([{ lo: 1739, hi: 2299, cov: 88 }, { lo: 2995, hi: 3400, cov: 90 }], { lo: 0, hi: 7000 }), 3004],
  ['⑧ 层厚刚好不够（触发 INSUFFICIENT_THICKNESS）', fieldOf([{ lo: 2400, hi: 2620, cov: 92 }], { lo: 1000, hi: 6000 }), 4200],
  ['⑨ 扫描范围超出实测覆盖（下侧）', fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], { lo: 2600, hi: 6000 }), 4200],
]

const out = { generatedAt: new Date().toISOString(), pre: '50d657a', bizDiffs: [], textDiffs: [], extraDiffs: [], cases: [], real: [] }
let n = 0

console.log('== 合成案例（含 3 种海拔出处） ==')
CASES.forEach(function (c) {
  ;[['measured', true], ['estimated', true], ['none', false]].forEach(function (pair) {
    n++
    const alt = pair[0] === 'none' ? null : c[2]
    let a, b
    try {
      a = biz(run(PRE, c[1], alt, LOW, pair[0], pair[1]))
      b = biz(run(POST, c[1], alt, LOW, pair[0], pair[1]))
    } catch (e) {
      console.log(c[0] + '/' + pair[0] + ' 抛错 ' + e.message); out.bizDiffs.push({ 案例: c[0], basis: pair[0], error: e.message }); return
    }
    const ea = extras(run(PRE, c[1], alt, LOW, pair[0], pair[1])), eb = extras(run(POST, c[1], alt, LOW, pair[0], pair[1]))
    const ok = same(a, b)
    if (!ok) out.bizDiffs.push({ 案例: c[0], basis: pair[0], 前: a, 后: b })
    /* 非业务字段：只允许 POST 比 PRE **多键**，不许少键、也不许同键改值
       （同键改值已由上面的 biz() 逐字段比较拦住，这里补的是键集合本身） */
    /* 层键集合必须"只增不减"：PRE 的每个键 POST 都还在，且逐层数量一致 */
    if (!keysOnlyGrew(ea.layerKeys, eb.layerKeys)) {
      out.extraDiffs.push({ 案例: c[0], basis: pair[0], 原因: '层键集合被删或数量变了', 前: ea.layerKeys, 后: eb.layerKeys })
    }
    console.log([c[0] + ' / basis=' + pair[0], '业务判据相同=' + ok,
      '窗口=' + JSON.stringify(b.opportunities.map(o => o[0] + '@' + o[1] + '-' + o[2] + '/' + o[3])),
      '候选=' + b.candidates.length, '拒绝=' + b.rejectedReasons.length].join(' | '))
    out.cases.push({ 案例: c[0], basis: pair[0], 业务判据相同: ok, 前: a, 后: b, 附加字段_前: ea, 附加字段_后: eb })
  })
})

console.log('\n== 真实快照（4 站 × 7 天 × 3 组海拔出处） ==')
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json'), 'utf8'))
Object.keys(snap.places).forEach(function (k) {
  const p = snap.places[k]
  for (let d = 0; d < 7; d++) {
    const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
    if (!cf) continue
    const sample = sampler(cf)
    const fieldObj = Object.assign({}, cf, { sample: sample, userAltitude: p.elevation })
    const detail = (p.series || []).filter(r => r.d === day)
    ;[['measured', true], ['estimated', true], ['none', false]].forEach(function (pair) {
      n++
      const alt = pair[0] === 'none' ? null : p.elevation
      const mk = OI => OI.buildOutdoorIntelligence({
        date: day, detail: detail, userAltitude: alt, elevOK: pair[1] && Number.isFinite(alt),
        elevBasis: pair[0], lat: p.gcj[0], lng: p.gcj[1], cloudField: fieldObj, days: [],
      })
      const a = biz(mk(PRE)), b = biz(mk(POST))
      const ok = same(a, b)
      if (!ok) out.bizDiffs.push({ 案例: p.name + ' ' + day + ' ' + pair[0], 前: a, 后: b })
      const ra = ((a.seaHours || []).flat().length), rb = ((b.seaHours || []).flat().length)
      if (!ok || rb) {
        console.log([p.name, day, pair[0], '业务判据相同=' + ok,
          '窗口=' + JSON.stringify(b.opportunities.map(o => o[0] + '@' + o[1] + '-' + o[2] + '/' + o[3])),
          '云海覆盖小时 ' + ra + '→' + rb, '候选=' + b.candidates.length, '拒绝=' + b.rejectedReasons.length].join(' | '))
      }
      out.real.push({ place: p.name, day: day, basis: pair[0], 业务判据相同: ok, 窗口数_后: b.opportunities.length })
    })
  }
})

/* 负证据文案差异单独统计（本轮唯一被允许变化的字符串） */
const preDet = out.cases.map(c => c.附加字段_前.rejectedDetails).flat()
const postDet = out.cases.map(c => c.附加字段_后.rejectedDetails).flat()
preDet.forEach(function (d, i) { if (postDet[i] != null && d !== postDet[i]) out.textDiffs.push({ 前: d, 后: postDet[i] }) })

console.log('\n合计比对 ' + n + ' 组：业务判据差异 ' + out.bizDiffs.length + ' 组、' +
  '附加字段结构差异 ' + out.extraDiffs.length + ' 组、负证据 detail 文案差异 ' + out.textDiffs.length + ' 条')
if (out.textDiffs.length) out.textDiffs.slice(0, 4).forEach(t => console.log('  detail 前: ' + t.前 + '\n  detail 后: ' + t.后))
fs.writeFileSync(path.join(__dirname, '..', 'ab-slice.json'), JSON.stringify(out, null, 2))
console.log('→ ab-slice.json')
process.exit(out.bizDiffs.length || out.extraDiffs.length ? 1 : 0)
