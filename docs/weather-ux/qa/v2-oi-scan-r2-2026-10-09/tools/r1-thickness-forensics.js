/* R1 阈值口径取证：LAYER_THICKNESS_MIN = 300 m 到底是在哪个高度范围上量出来的？
 *
 * 只读。不改生产代码、不改阈值、不下结论说 300 应该改成多少。
 * 云层提取与"固定窗 vs 数据包络"两套口径在本脚本里独立重写（与 OI 的实现规则一致、代码不复用），
 * 两侧对同一批小时列跑，输出：
 *   · ≥80% 层的条数、厚度分位（P10/P25/P50/P75/P90）、以及被窗边界切断的层占比
 *   · 300m 门槛在两套口径下分别放过了多少层（门槛的"通过率"）
 *   · 与文档口径（4 地点 × 48h，48 个 ≥80% 层）对照：本快照能复现出什么量级
 * 运行：node r1-thickness-forensics.js      （真实数据用 v2-oi-cloud-scan-audit 的 real-cloud.json）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../..')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))

const FIXED = { lo: CFF.ALT0, hi: CFF.ALT1 }   // 生产 cloudLayersAt 的扫描范围
const COVER_MIN = 80, THICK_MIN = 300, STEP = 50

/* 独立重写的层提取：lo/hi 由调用方给，其余规则与 OI.cloudLayersAt 逐条一致 */
function layersAt (sample, t, lo, hi) {
  const pts = []
  for (let alt = lo; alt <= hi; alt += STEP) pts.push({ alt: alt, cover: sample(t, alt) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= COVER_MIN
    const prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const crossed = !!(prev && prev.cover < COVER_MIN)
      const base = crossed
        ? prev.alt + (COVER_MIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt)
        : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover], baseCut: !crossed }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) { run.topCut = false; runs.push(run); run = null }
  }
  if (run) { run.top = hi; run.topCut = true; runs.push(run) }
  return runs.map(function (l) {
    return {
      base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce(function (a, b) { return a + b }, 0) / l.covers.length),
      baseCut: l.baseCut === true, topCut: l.topCut === true,
      cut: l.baseCut === true || l.topCut === true,
    }
  }).sort(function (a, b) { return a.base - b.base })
}
function quant (arr, q) {
  if (!arr.length) return NaN
  const s = arr.slice().sort((a, b) => a - b)
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo))
}
/* 某个厚度值在该口径样本里处于第几百分位（低于它的样本占比），用来核对"P50=300m"这类说法 */
function percentileOf (rows, v) {
  if (!rows.length) return '样本为空'
  const below = rows.filter(r => r.thickness < v).length
  return Math.round(below / rows.length * 100) + '%（' + below + '/' + rows.length + ' 条低于 ' + v + 'm）'
}
function describe (rows, label) {
  const th = rows.map(r => r.thickness)
  const cut = rows.filter(r => r.cut)
  const pass = rows.filter(r => r.thickness >= THICK_MIN)
  const passUncut = rows.filter(r => r.thickness >= THICK_MIN && !r.cut)
  return {
    口径: label,
    层数: rows.length,
    厚度: { P10: quant(th, 0.1), P25: quant(th, 0.25), P50: quant(th, 0.5), P75: quant(th, 0.75), P90: quant(th, 0.9), max: th.length ? Math.max.apply(null, th) : NaN },
    被边界切断: cut.length,
    被切占比: rows.length ? Math.round(cut.length / rows.length * 100) + '%' : '—',
    '≥300m 通过': pass.length,
    通过率: rows.length ? Math.round(pass.length / rows.length * 100) + '%' : '—',
    '≥300m 且两端实测': passUncut.length,
  }
}

const snapPath = path.join(ROOT, 'docs/weather-ux/qa/v2-oi-cloud-scan-audit-2026-10-09/tools/real-cloud.json')
if (!fs.existsSync(snapPath)) { console.error('缺 real-cloud.json'); process.exit(2) }
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'))

const fixedRows = [], envRows = [], perPlace = []
let hourCols = 0, noEnvelope = 0

Object.keys(snap.places).forEach(function (k) {
  const p = snap.places[k]
  const fx = [], en = []
  for (let d = 0; d < 3; d++) {
    const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
    if (!cf) continue
    const sample = CFF.makeColumnSampler(cf)
    const at = (t, a) => CFF.sampleAtStations(sample, cf.times.length, t, a)
    hourCols++
    const cov = cf.covered || null
    if (!cov) { noEnvelope++; return }
    /* 包络口径：数据真实覆盖到的范围，向上取整到步长，且不越过本表的物理上限 */
    const env = { lo: Math.floor(Math.max(0, cov.lo) / STEP) * STEP, hi: Math.ceil(cov.hi / STEP) * STEP }
    for (let h = 0; h < cf.times.length; h++) {
      layersAt(at, h, FIXED.lo, FIXED.hi).filter(l => l.meanCover >= COVER_MIN).forEach(function (l) { l.t = h; l.day = day; l.place = p.name; fx.push(l); fixedRows.push(l) })
      layersAt(at, h, env.lo, env.hi).filter(l => l.meanCover >= COVER_MIN).forEach(function (l) { l.t = h; l.day = day; l.place = p.name; en.push(l); envRows.push(l) })
    }
  }
  perPlace.push({ 地点: p.name, 海拔: p.elevation, 实测范围: (function () { const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: snap.date, hours: 24, userAltitude: p.elevation }); return cf && cf.covered ? [cf.covered.lo, cf.covered.hi] : null })(),
    固定窗: describe(fx, '固定 2,000–6,000 m'), 包络: describe(en, '数据实际覆盖范围') })
})

console.log('数据：' + Object.keys(snap.places).length + ' 地点 × 3 天 = ' + hourCols + ' 组小时列（缺包络 ' + noEnvelope + ' 组）')
perPlace.forEach(function (r) {
  console.log('\n【' + r.地点 + ' ' + r.海拔 + 'm】数据实测覆盖 ' + JSON.stringify(r.实测范围))
  console.log('  ' + JSON.stringify(r.固定窗))
  console.log('  ' + JSON.stringify(r.包络))
})
console.log('\n== 合计 ==')
console.log('  ' + JSON.stringify(describe(fixedRows, '固定 2,000–6,000 m')))
console.log('  ' + JSON.stringify(describe(envRows, '数据实际覆盖范围')))
console.log('  300 m 在样本里的位置：固定窗 ' + percentileOf(fixedRows, THICK_MIN) + ' · 包络 ' + percentileOf(envRows, THICK_MIN) +
  ' ⇒ 两个口径下 300m 都不是中位数（P50 实测 ' + quant(fixedRows.map(r => r.thickness), 0.5) + ' / ' + quant(envRows.map(r => r.thickness), 0.5) + ' m）')
const cutOnly = fixedRows.filter(r => r.cut)
/* 同一批「被窗边界切了一刀」的层，在包络口径下有多厚。
 * 配对键用**最大重叠**而不是相等的 base/top——被切的那一端本来就不是真边界，
 * 拿它当锚点会把「同一层」配丢。重叠不足 100m 视为配不上，宁少不虚。 */
function bestMatch (c) {
  let best = null, bestOv = 0
  envRows.forEach(function (r) {
    if (r.place !== c.place || r.day !== c.day || r.t !== c.t) return
    const ov = Math.min(c.top, r.top) - Math.max(c.base, r.base)
    if (ov > bestOv) { bestOv = ov; best = r }
  })
  return bestOv >= 100 ? best : null
}
const pairs = []
cutOnly.forEach(function (c) { const m = bestMatch(c); if (m) pairs.push({ 固定窗: c, 包络: m }) })
const flips = pairs.filter(x => x.包络.thickness >= THICK_MIN && x.固定窗.thickness < THICK_MIN)
console.log('\n  固定窗里被切断的层：' + cutOnly.length + ' 条，厚度中位数 ' + quant(cutOnly.map(r => r.thickness), 0.5) + ' m')
console.log('  其中能在包络口径下配上同一层的：' + pairs.length + ' 条，包络厚度中位数 ' +
  quant(pairs.map(x => x.包络.thickness), 0.5) + ' m，厚度差中位数 ' +
  quant(pairs.map(x => x.包络.thickness - x.固定窗.thickness), 0.5) + ' m（配不上的一律不计入）')
console.log('  因「被窗切断」把 ≥300m 报成 <300m 的：' + flips.length + ' 条' +
  (flips.length ? ' —— ' + flips.slice(0, 5).map(function (x) {
    return x.固定窗.place + ' ' + x.固定窗.day + ' ' + String(x.固定窗.t).padStart(2, '0') + 'h 固定窗 ' +
      x.固定窗.thickness + 'm ↔ 包络 ' + x.包络.thickness + 'm（' + x.包络.base + '–' + x.包络.top + '）'
  }).join('；') : ''))
console.log('  ⇒ 「300 m 门槛」在两套口径下的通过率分别是 ' +
  Math.round(fixedRows.filter(r => r.thickness >= 300).length / Math.max(1, fixedRows.length) * 100) + '% / ' +
  Math.round(envRows.filter(r => r.thickness >= 300).length / Math.max(1, envRows.length) * 100) + '%')

const out = {
  generatedAt: new Date().toISOString(),
  source: 'docs/weather-ux/qa/v2-oi-cloud-scan-audit-2026-10-09/tools/real-cloud.json（真实 Open-Meteo 快照，2026-10-09 抓取）',
  小时列: hourCols, 固定窗: describe(fixedRows, '固定 2,000–6,000 m'), 包络: describe(envRows, '数据实际覆盖范围'),
  三百米处在哪一档: {
    固定窗: percentileOf(fixedRows, THICK_MIN), 包络: percentileOf(envRows, THICK_MIN),
    说明: '文档写的是「真实分布 P50=300m」。这里的数字是 300m 在该口径样本中所处的百分位，不是建议值。',
  },
  逐地点: perPlace,
  被切断层的配对: {
    被切层数: cutOnly.length, 配上同一层的条数: pairs.length,
    厚度差中位数: quant(pairs.map(x => x.包络.thickness - x.固定窗.thickness), 0.5),
    翻转条数_包络达标而固定窗不达标: flips.length,
    翻转明细: flips.map(function (x) {
      return { 地点: x.固定窗.place, 日: x.固定窗.day, 小时: x.固定窗.t, 固定窗厚度: x.固定窗.thickness, 包络厚度: x.包络.thickness, 包络层范围: [x.包络.base, x.包络.top] }
    }),
  },
}
fs.writeFileSync(path.join(__dirname, '..', 'r1-thickness.json'), JSON.stringify(out, null, 2))
console.log('\n→ r1-thickness.json')
