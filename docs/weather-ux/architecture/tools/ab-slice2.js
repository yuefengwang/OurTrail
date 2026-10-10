/* 切片二的跨版本对拍：92036e9（切片一末）vs 当前工作树（切片二后）
 *
 * 本轮宣称的是两件事，所以要比两层：
 *   ① 业务判据零变化（候选/拒绝/窗口/置信/强度/条件态）——和切片一同一套字段；
 *   ② **用户可见输出零变化**（卡片摘要文案、摘要选中哪一条、看图锚点、时间轴、
 *      tapZones、silenceNote）——这一层以前根本没进过对拍，而本轮改的正是摘要选择。
 * 做法：两边各跑**自己的**整条管线（PRE 的 presentation 配 PRE 的模型，POST 配 POST），
 *       喂同一份输入，逐字段比。PRE 那边 summaryOf 还是按文案 indexOf('云区') 挑的，
 *       所以只要"挑中了不同的一条"，summaryText 立刻对不上。
 *
 * 允许变化的只有三类，且必须逐条列出（其余任何差异都是业务差异）：
 *   A. 证据行**新增** `kind` 字段（PRE 没有，POST 有；fact 字符串必须逐字相同）
 *   B. 账本记录**新增** `stage` 字段；`meta.cloudSea` **新增** `noWindow` 数组
 *   C. 阈值搬家的痕迹：PRE 的 `CLOUD_SEA.LAYER_COVER_MIN` 是字面量 80，
 *      POST 是引用 L1 的 `LAYER_LIMITS` —— 数值必须仍是 80/50
 *
 * 运行：node ab-slice2.js <切片二前的 utils 目录>
 *      （git archive 92036e9 miniprogram/utils | tar -x -C <dir>）
 * 退出码：0 = 零差异；1 = 有差异（打印前 4 条）；2 = 用法/前置校验失败
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../..')
const PRE_BASE = '92036e9'
const PRE_DIR = process.argv[2]
if (!PRE_DIR || !fs.existsSync(path.join(PRE_DIR, 'oi-presentation.js'))) {
  console.error('用法：node ab-slice2.js <切片二前的 utils 目录>'); process.exit(2)
}
/* 前置校验：给定的目录必须真的是"切片二之前"，否则整场比较比的是空气（铁律 28⑤/29 的教训） */
const preOI = fs.readFileSync(path.join(PRE_DIR, 'outdoor-intelligence.js'), 'utf8')
const prePPT = fs.readFileSync(path.join(PRE_DIR, 'oi-presentation.js'), 'utf8')
if (preOI.indexOf('evidence-kind') >= 0 || preOI.indexOf('kind: K.') >= 0) {
  console.error('给定的目录里 OI 已经引用 evidence-kind —— 那不是切片二前的版本'); process.exit(2)
}
if (prePPT.indexOf("indexOf('云区')") < 0) {
  console.error('给定的 oi-presentation.js 里没有按文案挑摘要的旧实现 —— 版本不对，比不出前后差异')
  process.exit(2)
}
if (require.resolve(path.join(PRE_DIR, 'outdoor-intelligence.js')) ===
    require.resolve(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))) {
  console.error('给定的 utils 目录与当前工作树是同一份'); process.exit(2)
}
const PRE = {
  OI: require(path.join(PRE_DIR, 'outdoor-intelligence.js')),
  PPT: require(path.join(PRE_DIR, 'oi-presentation.js')),
}
const POST = {
  OI: require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js')),
  PPT: require(path.join(ROOT, 'miniprogram/utils/oi-presentation.js')),
}
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
function detailOf (n, cloudLow, bandFn) {
  const out = []
  for (let h = 0; h < n; h++) out.push({
    t: String(h).padStart(2, '0') + ':00', d: '2026-10-09',
    temp: 8, pop: 0, precip: 0, showers: 0, code: 1, wind: 4, gust: 9, windDir: 45, rh: 60,
    cloud: { low: cloudLow(h), mid: 0, high: 0 }, visibility: 40, freezing: 4600,
    band: bandFn ? bandFn(h) : null,
  })
  return out
}
function sampler (field) {
  const col = CFF.makeColumnSampler(field)
  return (t, a) => CFF.sampleAtStations(col, field.times.length, t, a)
}
/* 一边一条完整管线：模型 → **各自版本的**呈现层 */
function pipeline (side, cfg) {
  const field = cfg.field
  const sample = field ? sampler(field) : null
  const ctx = {
    date: cfg.date, detail: cfg.detail, userAltitude: cfg.alt,
    elevOK: cfg.elevOK !== false && Number.isFinite(cfg.alt), elevBasis: cfg.basis,
    lat: cfg.lat, lng: cfg.lng, days: cfg.days || [],
    cloudField: field ? Object.assign({}, field, { sample: sample, userAltitude: cfg.alt }) : null,
  }
  const oi = side.OI.buildOutdoorIntelligence(ctx)
  const cards = [375, 414].map(w => {
    const c = side.PPT.buildOiCard(oi, { width: w })
    return {
      width: w,
      items: (c.items || []).map(it => [it.type, it.title, it.timeText, it.tierText, it.summaryText,
        it.phase, it.rank, it.confidence, it.crossMidnight === true, it.live === true,
        it.anchor ? [it.anchor.startHour, it.anchor.endHour, it.anchor.focusHour, it.anchor.focusLabel] : null]),
      more: (c.moreItems || []).map(it => [it.type, it.summaryText]),
      moreCount: c.moreCount, silenceNote: c.silenceNote,
      tapZones: c.tapZones, timelineSvg: c.timelineSvg, timelineHeight: c.timelineHeight,
    }
  })
  return { oi: oi, cards: cards }
}

/* 逐小时给不同云层：用来造"过了逐时门槛但没连成窗口"的两种形态（切片二的拆账本正名） */
function fieldByHour (decksByHour, covered, n) {
  const times = []
  for (let h = 0; h < (n || 24); h++) times.push(h)
  const values = times.map(h => ALTS.map(a => {
    if (a < covered.lo || a > covered.hi) return 0
    let v = 0
    ;(decksByHour[h] || []).forEach(d => { if (a >= d.lo && a <= d.hi) v = Math.max(v, d.cov) })
    return v
  }))
  return { times: times, altitudes: ALTS, values: values, covered: covered, meta: { hours: times.length } }
}
const COVERED_ALL = { lo: 0, hi: 7000 }

/* ① 业务判据：逐字相同 */
function biz (r) {
  const oi = r.oi
  return {
    opportunities: (oi.opportunities || []).map(o => [o.type, o.from, o.to, o.confidence, o.rank, o.strength || '', o.overlapsSunrise === true]),
    seaHours: (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
      .map(o => (o.layers || []).map(l => [l.t, l.base, l.top, l.cover, l.clearance])),
    boundaryFlags: (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
      .map(o => (o.layers || []).map(l => [l.baseBoundary === true, l.topBoundary === true])),
    conditions: (oi.conditions || []).map(c => [c.t, c.key, c.reason, (c.holds || []).join('')]),
    candidates: ((oi.meta.cloudSea || {}).candidates || []).map(c => [c.t, c.layer.base, c.layer.top, c.layer.thickness, c.clearance]),
    /* 具名拒绝的**全集**（rejected ++ noWindow）。切片二只是把窗口级拒绝挪了个账本，
       挪账本不是业务差异；少了一条原因码、或者原因码换了名，才是。
       次序仍然可比：两边的逐时拒绝都先入账，窗口级拒绝都在其后按 flush 时间序追加。 */
    rejections: [].concat(
      ((oi.meta.cloudSea || {}).rejected || []),
      ((oi.meta.cloudSea || {}).noWindow || [])
    ).map(x => [x.t != null ? x.t : x.from + '-' + x.to, x.reason]),
  }
}
/* ② 用户可见：卡片逐字段 + 证据**字符串**与顺序 */
function visible (r) {
  const oi = r.oi
  return {
    cards: r.cards,
    facts: (oi.opportunities || []).map(o => (o.evidence || []).map(e => String(e.fact))),
    condFacts: (oi.conditions || []).map(c => (c.evidence || []).map(e => String(e.fact))),
  }
}
/* 只允许"新增键"：PRE 的每个键 POST 都还在 */
function keysOnlyGrew (preRows, postRows) {
  if (preRows.length !== postRows.length) return false
  return preRows.every(function (row, i) {
    const p = Array.isArray(row) ? row : (row || [])
    const q = postRows[i] || []
    return p.every(k => q.indexOf(k) >= 0)
  })
}
function extras (r) {
  const oi = r.oi
  const seas = (oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')
  return {
    layerKeys: [].concat.apply([], seas.map(o => (o.layers || []).map(l => Object.keys(l).sort()))),
    evKeys: [].concat.apply([], (oi.opportunities || []).map(o => (o.evidence || []).map(e => Object.keys(e).sort()))),
    condEvKeys: [].concat.apply([], (oi.conditions || []).map(c => (c.evidence || []).map(e => Object.keys(e).sort()))),
    /* 账本记录的键：两版都按 rejected ++ noWindow 合并后逐行比（行数必须相同，
       PRE 没有 noWindow 所以那些行本来就在 rejected 里） */
    rejectedKeys: [].concat.apply([], [[].concat(
      ((oi.meta.cloudSea || {}).rejected || []),
      ((oi.meta.cloudSea || {}).noWindow || [])
    )].map(rows => rows.map(x => Object.keys(x).sort()))),
    noWindowReasons: ((oi.meta.cloudSea || {}).noWindow || []).map(x => [x.from + '-' + x.to, x.reason]),
    /* 逐时三本账的数量：**不进 biz() 比较**（挪账本本来就会让它变），
       只用来打印对照——PRE 把窗口级拒绝塞进 rejected，有那些拒绝的组就对不上小时数。 */
    hourLedger: [(oi.meta.cloudSea || {}).candidates, (oi.meta.cloudSea || {}).rejected,
      (oi.meta.cloudSea || {}).notEvaluated].map(a => (a || []).length),
    hourCount: (oi.conditions || []).length,
  }
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
  ['⑦ 厚层 + 恰好结束在点下方的薄皮', fieldOf([{ lo: 1739, hi: 2299, cov: 88 }, { lo: 2995, hi: 3400, cov: 90 }], { lo: 0, hi: 7000 }), 3004],
  ['⑧ 层厚刚好不够', fieldOf([{ lo: 2400, hi: 2620, cov: 92 }], { lo: 1000, hi: 6000 }), 4200],
  ['⑨ 扫描范围超出实测覆盖（下侧）', fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], { lo: 2600, hi: 6000 }), 4200],
  ['⑩ 无云场：回退到 band + sky 标记（hour-view 摘要路径）', null, 3500],
  ['⑪ 无云场 + 无高程（判不出 ⇒ 证据是 abstain）', null, null],
  /* 这两组专门造出**窗口级**拒绝：逐时门槛全过，但没连成窗口。
     切片二前它们和逐时拒绝挤在 `rejected` 里（账本对不上小时数），切片二后进 `noWindow`。 */
  ['⑫ 单小时候选（LOW_PERSISTENCE：过了逐时门槛，没连成窗）',
    fieldByHour({ 7: [{ lo: 2200, hi: 3000, cov: 92 }] }, COVERED_ALL), 4200],
  ['⑬ 凌晨候选（NOT_VISIBLE：民用晨昏外不可见 ⇒ 沉默）',
    fieldByHour({ 1: [{ lo: 2200, hi: 3000, cov: 92 }], 2: [{ lo: 2200, hi: 3000, cov: 92 }] }, COVERED_ALL), 4200],
]

const out = { generatedAt: new Date().toISOString(), pre: PRE_BASE, bizDiffs: [], visibleDiffs: [], extraDiffs: [], cases: [], real: [] }
let n = 0

function mkCfg (c, basis, elevOK, alt) {
  return {
    field: c[1], detail: detailOf(c[1] ? c[1].times.length : 24, LOW,
      c[1] ? null : (h => (h >= 5 && h < 10) ? { base: 2000, top: 3100, cover: 90 } : null)),
    alt: alt, elevOK: elevOK, basis: basis, date: '2026-10-09', lat: 30.0, lng: 100.27,
  }
}
console.log('== 合成案例（含 3 种海拔出处 × 11 组场景，跑完整管线到卡片） ==')
CASES.forEach(function (c) {
  ;[['measured', true], ['estimated', true], ['none', false]].forEach(function (pair) {
    n++
    const alt = pair[0] === 'none' ? null : c[2]
    const cfg = mkCfg(c, pair[0], pair[1], alt)
    let ra, rb
    try {
      ra = pipeline(PRE, cfg); rb = pipeline(POST, cfg)
    } catch (e) {
      out.bizDiffs.push({ 案例: c[0], basis: pair[0], error: e.message })
      console.log(c[0] + '/' + pair[0] + ' 抛错 ' + e.message); return
    }
    const a = biz(ra), b = biz(rb)
    const va = visible(ra), vb = visible(rb)
    const okBiz = same(a, b), okVis = same(va, vb)
    if (!okBiz) out.bizDiffs.push({ 案例: c[0], basis: pair[0], 前: a, 后: b })
    if (!okVis) out.visibleDiffs.push({ 案例: c[0], basis: pair[0], 前: va, 后: vb })
    const ea = extras(ra), eb = extras(rb)
    if (!keysOnlyGrew(ea.layerKeys, eb.layerKeys)) {
      out.extraDiffs.push({ 案例: c[0], basis: pair[0], 原因: '层键集合被删或数量变了', 前: ea.layerKeys, 后: eb.layerKeys })
    }
    if (!keysOnlyGrew(ea.evKeys, eb.evKeys) || !keysOnlyGrew(ea.condEvKeys, eb.condEvKeys)) {
      out.extraDiffs.push({ 案例: c[0], basis: pair[0], 原因: '证据键集合被删（kind 只能是新增）' })
    }
    if (!keysOnlyGrew(ea.rejectedKeys, eb.rejectedKeys)) {
      out.extraDiffs.push({ 案例: c[0], basis: pair[0], 原因: '账本记录键集合被删（stage 只能是新增）' })
    }
    const seaCards = (vb.cards[0].items || []).filter(it => it[0] === 'CLOUD_SEA')
    /* 分区不变量（只作对照打印，不计入差异）：逐时三本账必须恰等于小时数。
       PRE 把窗口级拒绝塞进 rejected，所以有 LOW_PERSISTENCE / NOT_VISIBLE 的那些组对不上。 */
    const partOf = x => x.hourLedger.reduce((s, v) => s + v, 0) === x.hourCount
    console.log([c[0] + ' / basis=' + pair[0], '业务判据相同=' + okBiz, '用户可见相同=' + okVis,
      '卡片=' + vb.cards[0].items.length, '逐时分区 前=' + partOf(ea) + '/后=' + partOf(eb),
      '云海摘要=' + JSON.stringify(seaCards.map(x => x[4]).join(' / '))].join(' | '))
    out.cases.push({ 案例: c[0], basis: pair[0], 业务判据相同: okBiz, 用户可见相同: okVis, 前: a, 后: b, 可见前: va, 可见后: vb, 附加字段_前: ea, 附加字段_后: eb })
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
    const detail = (p.series || []).filter(r => r.d === day)
    ;[['measured', true], ['estimated', true], ['none', false]].forEach(function (pair) {
      n++
      const alt = pair[0] === 'none' ? null : p.elevation
      const cfg = {
        field: cf, detail: detail, alt: alt, elevOK: pair[1] && Number.isFinite(alt), basis: pair[0],
        date: day, lat: p.gcj[0], lng: p.gcj[1],
      }
      const ra = pipeline(PRE, cfg), rb = pipeline(POST, cfg)
      const a = biz(ra), b = biz(rb)
      const va = visible(ra), vb = visible(rb)
      const okBiz = same(a, b), okVis = same(va, vb)
      if (!okBiz) out.bizDiffs.push({ 案例: p.name + ' ' + day + ' ' + pair[0], 前: a, 后: b })
      if (!okVis) out.visibleDiffs.push({ 案例: p.name + ' ' + day + ' ' + pair[0], 前: va, 后: vb })
      const seaSum = (vb.cards[0].items || []).filter(it => it[0] === 'CLOUD_SEA').map(it => it[4])
      if (!okBiz || !okVis || seaSum.length) {
        console.log([p.name, day, pair[0], '业务判据相同=' + okBiz, '用户可见相同=' + okVis,
          '云海摘要=' + JSON.stringify(seaSum), '候选=' + b.candidates.length].join(' | '))
      }
      out.real.push({ place: p.name, day: day, basis: pair[0], 业务判据相同: okBiz, 用户可见相同: okVis, 窗口数_后: b.opportunities.length })
    })
  }
})

/* 阈值搬家只能是"搬家"：两侧的实际阈值数值必须仍然相同 */
const POST_LLF = require(path.join(ROOT, 'miniprogram/utils/cloud-layer-facts.js')).LAYER_LIMITS
if (POST_LLF.FIELD_LAYER_COVER_MIN !== 80 || POST_LLF.FIELD_LAYER_STEP_M !== 50 || POST_LLF.CLOUD_BAND_COVER_MIN !== 80) {
  out.bizDiffs.push({ 案例: '阈值数值', 后: JSON.stringify(POST_LLF), 原因: '本轮不许改任何阈值数值' })
}

console.log('\n合计比对 ' + n + ' 组：业务判据差异 ' + out.bizDiffs.length + ' 组、' +
  '用户可见差异 ' + out.visibleDiffs.length + ' 组、附加字段结构差异 ' + out.extraDiffs.length + ' 组')
;[out.bizDiffs, out.visibleDiffs, out.extraDiffs].forEach(function (list, i) {
  if (list.length) console.log('  [' + ['业务', '可见', '附加'][i] + '] 前 2 条：' + JSON.stringify(list.slice(0, 2)).slice(0, 700))
})
fs.writeFileSync(path.join(__dirname, '..', 'ab-slice2.json'), JSON.stringify({
  generatedAt: out.generatedAt, pre: out.pre, 组数: n,
  业务判据差异: out.bizDiffs.length, 用户可见差异: out.visibleDiffs.length, 附加字段结构差异: out.extraDiffs.length,
  阈值: POST_LLF, 明细: out.bizDiffs.concat(out.visibleDiffs, out.extraDiffs),
  真实快照: out.real,
}, null, 2))
console.log('→ ab-slice2.json')
process.exit(out.bizDiffs.length || out.visibleDiffs.length || out.extraDiffs.length ? 1 : 0)
