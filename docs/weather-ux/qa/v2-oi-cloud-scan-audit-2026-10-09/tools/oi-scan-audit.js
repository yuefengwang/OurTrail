/* OI 云层扫描范围审计 · 只读对拍（2026-10-09 第四轮，不改生产判据）
 *
 * 这一支脚本只做三件事：
 *   ① 数清楚固定 2000–6000 m 的云层扫描（outdoor-intelligence.js:98）在真实数据里漏掉了什么；
 *   ② 用「影子运行」量出这些漏掉会不会真的改变 OI 的业务结论——
 *      在内存里临时改 CFF.ALT0/ALT1（cloudLayersAt 唯一的读取方），跑完立刻还原，
 *      **仓库里的生产代码与测试一个字节都不改**；
 *   ③ 用合成样本把「云在扫描带下/上/跨界/多层/临界/缺测/无高程/估算高程/不确定重叠」逐类钉住。
 *
 * 云层提取与云海候选的判定规则在本脚本里**独立重写一遍**（不复用 invariants/OI 的实现），
 * 两边必须对同一批变异同时报红，否则对拍没有意义。
 * 运行：node oi-scan-audit.js            （真实数据用同目录 real-cloud.json）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const CFF = require('../../../../../miniprogram/utils/cloud-field-svg.js')
const WCFF = require('../../../../../miniprogram/utils/weather-cloud-field.js')
const OI = require('../../../../../miniprogram/utils/outdoor-intelligence.js')

const FIXED = { lo: 2000, hi: 6000 }          // 生产 cloudLayersAt 现在扫的范围
const LAYER_COVER_MIN = 80
const LAYER_THICKNESS_MIN = 300
const CLEARANCE_MIN = 200
const SCAN_STEP = 50
const DATE = '2026-10-09'

/* ---------- 独立重写的云层提取（规则同 OI，实现不复用） ---------- */
function layersAt (sample, t, lo, hi) {
  const pts = []
  for (let alt = lo; alt <= hi; alt += SCAN_STEP) pts.push({ alt: alt, cover: sample(t, alt) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= LAYER_COVER_MIN
    const prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const base = prev && prev.cover < LAYER_COVER_MIN
        ? prev.alt + (LAYER_COVER_MIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover] }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) { runs.push(run); run = null }
  }
  if (run) { run.top = hi; runs.push(run) }   // 与 OI 同一规则：开放段以扫描上界收尾（这本身就是一条被写进证据的边界值）
  return runs.map(function (l) {
    return {
      base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce(function (a, b) { return a + b }, 0) / l.covers.length),
      peakCover: Math.round(Math.max.apply(null, l.covers)),
    }
  }).sort(function (a, b) { return a.base - b.base })
}
/* 独立重写的云海候选筛选（OI detectCloudSeaCandidates 的必要条件序列） */
function seaCandidates (layers, userAlt) {
  const out = []
  const below = layers.filter(function (l) { return l.top <= userAlt })
  if (!below.length) return { ok: false, reason: 'NO_LAYER_BELOW' }
  const L = below[below.length - 1]
  const clearance = userAlt - L.top
  if (clearance < CLEARANCE_MIN) return { ok: false, reason: clearance < 0 ? 'USER_INSIDE_CLOUD' : 'USER_NOT_ABOVE_CLOUD', layer: L }
  if (L.meanCover < LAYER_COVER_MIN) return { ok: false, reason: 'LOW_COVERAGE', layer: L }
  if (L.thickness < LAYER_THICKNESS_MIN) return { ok: false, reason: 'INSUFFICIENT_THICKNESS', layer: L }
  out.push(L)
  return { ok: true, layer: L, clearance: Math.round(clearance) }
}
function overlaps (a, b) { return a.base < b.top && b.base < a.top }

/* ---------- 真实数据 ---------- */
const snapPath = path.join(__dirname, 'real-cloud.json')
if (!fs.existsSync(snapPath)) { console.error('缺 real-cloud.json（上一轮快照）'); process.exit(2) }
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'))

function fieldFor (p, dayIdx) {
  const startDate = new Date(Date.parse(snap.date + 'T12:00:00Z') + dayIdx * 86400000).toISOString().slice(0, 10)
  return {
    startDate: startDate,
    field: WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: startDate, hours: 24, userAltitude: p.elevation }),
  }
}
function detailFor (p, day) {
  return p.series.filter(function (r) { return r.d === day })
}
/* 影子运行：只改 cloudLayersAt 读的这两个常量，跑完还原 */
function runOI (p, day, alt, scan) {
  const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: alt })
  if (!cf) return null
  const geo = { sample: null }
  const column = CFF.makeColumnSampler(cf)
  geo.sample = function (t, a) { return CFF.sampleAtStations(column, cf.times.length, t, a) }
  const saved = { lo: CFF.ALT0, hi: CFF.ALT1 }
  if (scan) { CFF.ALT0 = scan.lo; CFF.ALT1 = scan.hi }
  let oi
  try {
    oi = OI.buildOutdoorIntelligence({
      date: day, detail: detailFor(p, day), userAltitude: alt, elevOK: Number.isFinite(alt),
      elevBasis: 'measured', lat: p.gcj[0], lng: p.gcj[1], cloudField: cf, days: [],
    })
  } finally {
    CFF.ALT0 = saved.lo; CFF.ALT1 = saved.hi
  }
  return {
    conditions: oi.conditions.map(function (c) { return [c.t, c.key, c.reason, (c.holds || []).join('')] }),
    opportunities: (oi.opportunities || []).map(function (o) { return [o.type, o.from, o.to, o.confidence, (o.evidence || []).length] }),
    sea: (oi.opportunities || []).filter(function (o) { return o.type === 'CLOUD_SEA' }),
  }
}

const report = { generatedAt: new Date().toISOString(), snapshot: { fetchedAt: snap.fetchedAt, date: snap.date },
  fixedScan: FIXED, constants: { LAYER_COVER_MIN: LAYER_COVER_MIN, LAYER_THICKNESS_MIN: LAYER_THICKNESS_MIN, CLEARANCE_MIN: CLEARANCE_MIN, SCAN_STEP: SCAN_STEP },
  places: {}, shadowRuns: [], synthetic: [], envelopeCensus: [] }

console.log('== 1. 真实数据：包络 vs 固定扫描带 ==')
Object.keys(snap.places).forEach(function (key) {
  const p = snap.places[key]
  const rows = []
  for (let d = 0; d < 3; d++) {
    const q = fieldFor(p, d)
    if (!q.field) { rows.push({ day: q.startDate, error: 'cloudField=null' }); continue }
    const cov = q.field.covered
    const column = CFF.makeColumnSampler(q.field)
    const sample = function (t, a) { return CFF.sampleAtStations(column, q.field.times.length, t, a) }
    let hoursWithMissed = 0, missedLayers = 0, missedWouldFlip = 0, hoursBelowEnvelope = 0, hoursAboveEnvelope = 0
    /* 第三种影响模式（本轮追查那次翻转时才发现的）：固定带不一定「整层漏掉」，
       它还会把跨界云层的底/顶**截断**——厚度与层均覆盖因此变小，撞在 LAYER_THICKNESS_MIN 上，
       于是云海被判 NO/INSUFFICIENT；同时 base 恰好等于 2000 的那一层，其「云底」其实是扫描边界，
       不是测量出来的云界（写进证据句就是「云层位于 2,000–2,100 m」这种半真半假的话）。 */
    let hoursEdgeArtifact = 0, truncationFlipHours = 0
    const thicknessDeltas = []
    const detail = []
    for (let h = 0; h < 24; h++) {
      const A = layersAt(sample, h, FIXED.lo, FIXED.hi)
      const B = layersAt(sample, h, cov.lo, cov.hi)
      const missed = B.filter(function (l) { return !A.some(function (a) { return overlaps(a, l) }) })
      const edgeArt = A.some(function (l) { return l.base <= FIXED.lo + SCAN_STEP || l.top >= FIXED.hi - SCAN_STEP })
        && B.some(function (l) { return l.base < FIXED.lo || l.top > FIXED.hi })
      A.forEach(function (l) {
        const mate = B.filter(function (b) { return overlaps(b, l) })
        mate.forEach(function (b) { thicknessDeltas.push(b.thickness - l.thickness) })
      })
      const ca = seaCandidates(A, p.elevation), cb = seaCandidates(B, p.elevation)
      if (edgeArt) hoursEdgeArtifact++
      if (ca.ok !== cb.ok) {
        if (missed.length) missedWouldFlip++
        else truncationFlipHours++
      }
      if (missed.length) {
        hoursWithMissed++
        missedLayers += missed.length
        if (missed[0].base < FIXED.lo) hoursBelowEnvelope++
        if (missed[missed.length - 1].top > FIXED.hi) hoursAboveEnvelope++
        detail.push({ h: h, mode: 'A-整层被排除', scanFixed: A.map(function (l) { return [l.base, l.top, l.meanCover] }),
          scanEnvelope: B.map(function (l) { return [l.base, l.top, l.meanCover] }),
          候选_固定: ca.ok, 候选_包络: cb.ok,
          missed: missed.map(function (l) { return [l.base, l.top, l.meanCover, l.thickness] }) })
      } else if (edgeArt || thicknessDeltas.length) {
        if (detail.length < 6 && (edgeArt || ca.ok !== cb.ok)) {
          detail.push({ h: h, mode: edgeArt ? 'C-扫描边界被当成云界' : 'B-跨界层被截断',
            scanFixed: A.map(function (l) { return [l.base, l.top, l.meanCover, l.thickness] }),
            scanEnvelope: B.map(function (l) { return [l.base, l.top, l.meanCover, l.thickness] }),
            候选_固定: ca.ok ? '成立' : ca.reason, 候选_包络: cb.ok ? '成立' : cb.reason })
        }
      }
    }
    const meanDelta = thicknessDeltas.length ? Math.round(thicknessDeltas.reduce(function (a, b) { return a + b }, 0) / thicknessDeltas.length) : 0
    rows.push({ day: q.startDate, covered: cov, hoursWithMissedLayer: hoursWithMissed, missedLayerCount: missedLayers,
      hoursMissedBelowFixed: hoursBelowEnvelope, hoursMissedAboveFixed: hoursAboveEnvelope,
      hoursCandidateFlipsWholeLayer: missedWouldFlip, hoursCandidateFlipsByTruncation: truncationFlipHours,
      hoursWithEdgeArtifact: hoursEdgeArtifact, thicknessUnderstatedMean_m: meanDelta,
      thicknessUnderstatedMax_m: thicknessDeltas.length ? Math.max.apply(null, thicknessDeltas) : 0,
      sampleHours: detail.slice(0, 4) })
    console.log([p.name, q.startDate, '包络 ' + cov.lo + '–' + cov.hi,
      '整层被排除的小时 ' + hoursWithMissed + '/24', '漏层数 ' + missedLayers,
      '低于 2000 ' + hoursBelowEnvelope + '｜高于 6000 ' + hoursAboveEnvelope,
      '边界当云界的小时 ' + hoursEdgeArtifact, '厚度平均少报 ' + meanDelta + 'm（最多 ' +
        (thicknessDeltas.length ? Math.max.apply(null, thicknessDeltas) : 0) + 'm）',
      '候选翻转：整层 ' + missedWouldFlip + '｜截断 ' + truncationFlipHours].join(' | '))
  }
  report.places[key] = { name: p.name, elevation: p.elevation, days: rows }
})

console.log('\n== 2. 影子运行：整条 OI 管线，固定扫描带 vs 实测包络 ==')
const ALT_CASES = [[null, 'measured'], ['elev', 'measured'], ['elev', 'estimated'], ['elev', 'none']]
Object.keys(snap.places).forEach(function (key) {
  const p = snap.places[key]
  for (let d = 0; d < 3; d++) {
    const q = fieldFor(p, d)
    if (!q.field) continue
    ALT_CASES.forEach(function (pair) {
      const alt = pair[0] === 'elev' ? p.elevation : null
      const basis = pair[1]
      const a = runOI(p, q.startDate, alt, null)
      const b = runOI(p, q.startDate, alt, { lo: q.field.covered.lo, hi: q.field.covered.hi })
      if (!a || !b) return
      const sameOpp = JSON.stringify(a.opportunities) === JSON.stringify(b.opportunities)
      const sameCond = JSON.stringify(a.conditions) === JSON.stringify(b.conditions)
      const added = b.opportunities.filter(function (o) { return !a.opportunities.some(function (x) { return JSON.stringify(x) === JSON.stringify(o) }) })
      const removed = a.opportunities.filter(function (o) { return !b.opportunities.some(function (x) { return JSON.stringify(x) === JSON.stringify(o) }) })
      if (!sameOpp || !sameCond || added.length || removed.length) {
        console.log([p.name, q.startDate, 'alt=' + alt + '/' + basis,
          '窗口差异 +' + JSON.stringify(added.map(function (o) { return o[0] + '@' + o[1] + '-' + o[2] })),
          '-' + JSON.stringify(removed.map(function (o) { return o[0] + '@' + o[1] + '-' + o[2] })),
          '条件态相同=' + sameCond].join(' | '))
      }
      report.shadowRuns.push({ place: p.name, day: q.startDate, alt: alt, basis: basis,
        opportunitiesIdentical: sameOpp, conditionsIdentical: sameCond, added: added, removed: removed,
        seaCountFixed: a.sea.length, seaCountEnvelope: b.sea.length })
    })
  }
})
const flips = report.shadowRuns.filter(function (r) { return !r.opportunitiesIdentical })
console.log('影子运行合计 ' + report.shadowRuns.length + ' 次；结论有差异 ' + flips.length +
  ' 次；条件态有差异 ' + report.shadowRuns.filter(function (r) { return !r.conditionsIdentical }).length + ' 次')

/* ---------- 3. 合成样本矩阵 ---------- */
const ALTS = (function () { const a = []; for (let x = 0; x <= 7000; x += 250) a.push(x); return a })()
function synthField (decks, stationLo, stationHi, hours) {
  const n = hours || 24
  const times = []
  for (let h = 0; h < n; h++) times.push(h)
  const values = times.map(function () {
    return ALTS.map(function (a) {
      if (a < stationLo || a > stationHi) return 0        // 与适配器一致：站点范围之外 = 无测量 → 0
      let v = 0
      decks.forEach(function (d) { if (a >= d.lo && a <= d.hi) v = Math.max(v, d.cov) })
      return v
    })
  })
  return { times: times, altitudes: ALTS, values: values, covered: { lo: stationLo, hi: stationHi }, meta: { hours: n } }
}
function synthCase (nm, field, alt, basis) {
  const sample = function (t, a) {
    const col = CFF.makeColumnSampler(field)
    return CFF.sampleAtStations(col, field.times.length, t, a)
  }
  const A = layersAt(sample, 10, FIXED.lo, FIXED.hi)
  const B = layersAt(sample, 10, field.covered.lo, field.covered.hi)
  const ca = seaCandidates(A, alt), cb = seaCandidates(B, alt)
  const row = { 场景: nm, 点: alt, basis: basis, 包络: [field.covered.lo, field.covered.hi],
    固定扫描层: A.map(function (l) { return [l.base, l.top, l.meanCover, l.thickness] }),
    包络扫描层: B.map(function (l) { return [l.base, l.top, l.meanCover, l.thickness] }),
    候选_固定: ca.ok ? '成立' : ca.reason, 候选_包络: cb.ok ? '成立' : cb.reason,
    结论翻转: ca.ok !== cb.ok }
  console.log([row.场景, '点=' + alt + '/' + basis, '固定=' + row.候选_固定, '包络=' + row.候选_包络,
    '翻转=' + row.结论翻转, '固定层=' + JSON.stringify(row.固定扫描层.map(function (l) { return l[0] + '–' + l[1] })),
    '包络层=' + JSON.stringify(row.包络扫描层.map(function (l) { return l[0] + '–' + l[1] }))].join(' | '))
  report.synthetic.push(row)
}
console.log('\n== 3. 合成样本矩阵（云层相对固定扫描带的位置） ==')
synthCase('① 云完全在固定带内（1500m 厚层）', synthField([{ lo: 2200, hi: 3700, cov: 92 }], 1000, 6000), 4200, 'measured')
synthCase('② 云全部低于固定带（云海漏报主案）', synthField([{ lo: 1000, hi: 1800, cov: 94 }], 900, 6000), 4200, 'measured')
synthCase('③ 云全部高于固定带', synthField([{ lo: 6100, hi: 6700, cov: 90 }], 900, 6800), 4200, 'measured')
synthCase('④ 多层：低层 + 带内层', synthField([{ lo: 900, hi: 1500, cov: 90 }, { lo: 3000, hi: 3600, cov: 88 }], 800, 6000), 4200, 'measured')
synthCase('⑤ 云横跨固定带下边界', synthField([{ lo: 1600, hi: 2600, cov: 92 }], 900, 6000), 4200, 'measured')
synthCase('⑥ 云量低于业务阈值（79%）', synthField([{ lo: 1000, hi: 1800, cov: 79 }], 900, 6000), 4200, 'measured')
synthCase('⑦ 云量临界（80%）', synthField([{ lo: 1000, hi: 1800, cov: 80 }], 900, 6000), 4200, 'measured')
synthCase('⑧ 薄层（厚度 < 300m）在带下', synthField([{ lo: 1200, hi: 1400, cov: 95 }], 900, 6000), 4200, 'measured')
synthCase('⑨ 净空不足（云顶距点 <200m）', synthField([{ lo: 1000, hi: 4050, cov: 92 }], 900, 6000), 4200, 'measured')
synthCase('⑩ 无有效云层（晴空）', synthField([], 900, 6000), 4200, 'measured')
synthCase('⑪ 站点范围只到 2500（带下无测量）', synthField([{ lo: 2000, hi: 2400, cov: 92 }], 2000, 2500), 4200, 'measured')
synthCase('⑫ 点在带下、云在带内（无高程场景对照）', synthField([{ lo: 2400, hi: 3000, cov: 92 }], 900, 6000), null, 'none')
synthCase('⑬ 模型估算高程（点带误差）', synthField([{ lo: 1000, hi: 3900, cov: 92 }], 900, 6000), 4100, 'estimated')
/* 影响模式 B：跨界层被截断——真实云底在 1,700，固定带从 2,000 起扫，
   于是「层厚」被少报 300m，正好跌破 LAYER_THICKNESS_MIN。真实数据里那次翻转就是这个模式。 */
synthCase('⑭ 跨界层被截断（真实厚 500m，固定带内只剩 200m）', synthField([{ lo: 1700, hi: 2200, cov: 94 }], 900, 6000), 4200, 'measured')
/* 影响模式 C：扫描边界被当成云界写进证据（固定带内的层 base 恰为 2000） */
synthCase('⑮ 扫描上边界被当成云顶', synthField([{ lo: 5600, hi: 6600, cov: 94 }], 900, 7000), 6900, 'measured')

report.envelopeCensus.push({ note: '站点范围之外适配器写 0（= 无测量），因此「扫全部高度」若超出实测包络就会把无测量读成无云' })

fs.writeFileSync(path.join(__dirname, '..', 'oi-scan-audit.json'), JSON.stringify(report, null, 2))
const flipsSynth = report.synthetic.filter(function (r) { return r.结论翻转 }).length
console.log('\n→ oi-scan-audit.json；合成样本 ' + report.synthetic.length + ' 例，其中云海候选翻转 ' + flipsSynth + ' 例')
console.log('生产代码未被修改：git 工作区应只有本目录的新增文件')
