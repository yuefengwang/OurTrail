/* G2 逐地点底数：某地 7 天里"没有云海候选"到底是**口径挡掉的**还是**那儿本来就没有云海天气**。
 *
 * 这条必须分开测，否则「固定带在两个方向上各关掉一类地点」这种听起来合理的话会被当成结论
 * （本报告初稿就错过一次，靠这个脚本推翻）。
 * 两份分布一起出：
 *   ① 逐时条件态（跑真实生产 OI 的 conditions）——点在云上/云下/云内/判不出各多少小时
 *   ② ≥80% 层的位置分布（独立重写的层提取）——完整落在带内 / 整体在带上 / 整体在带下，各多少，
 *      其中厚度达标的多少
 * 只读，不改生产代码。运行：node g2-condition-tally.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const OI = require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))
const STEP = 50, COVER = 80, THICK = 300

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
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover] }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) { runs.push(run); run = null }
  }
  if (run) { run.top = hi; runs.push(run) }
  return runs.map(function (l) {
    return { base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length) }
  })
}
const SNAP = { name: '4 站 × 168h（2026-10-09 抓）', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 }
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, SNAP.p), 'utf8'))
const out = { generatedAt: new Date().toISOString(), 快照: SNAP.name, 取数日: snap.date, 扫描带: [CFF.ALT0, CFF.ALT1], 地点: [] }

Object.keys(snap.places).forEach(function (k) {
  const p = snap.places[k]
  if (!p.cloudLevels) return
  const cond = {}, loc = { 带内完整: 0, 整体在带上: 0, 整体在带下: 0, 部分跨界: 0 }
  const locThick = { 带内完整: 0, 整体在带上: 0, 整体在带下: 0, 部分跨界: 0 }
  let hours = 0
  for (let d = 0; d < SNAP.days; d++) {
    const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
    if (!cf) continue
    const col = CFF.makeColumnSampler(cf)
    const at = (t, a) => CFF.sampleAtStations(col, cf.times.length, t, a)
    const field = Object.assign({}, cf, { sample: at, userAltitude: p.elevation })
    const oi = OI.buildOutdoorIntelligence({ date: day, detail: (p.series || []).filter(r => r.d === day),
      userAltitude: p.elevation, elevOK: true, elevBasis: 'measured', lat: p.gcj[0], lng: p.gcj[1], cloudField: field, days: [] })
    ;(oi.conditions || []).forEach(function (c) {
      const key = c.key || ('判不出:' + c.reason)
      cond[key] = (cond[key] || 0) + 1
    })
    const lo = Math.max(0, cf.covered.lo), hi = Math.min(7000, cf.covered.hi)
    for (let h = 0; h < cf.times.length; h++) {
      hours++
      layersAt(at, h, lo, hi).forEach(function (l) {
        if (l.meanCover < COVER) return
        const bucket = l.top <= CFF.ALT0 ? '整体在带下' : l.base >= CFF.ALT1 ? '整体在带上'
          : (l.base >= CFF.ALT0 && l.top <= CFF.ALT1) ? '带内完整' : '部分跨界'
        loc[bucket]++
        if (l.thickness >= THICK) locThick[bucket]++
      })
    }
  }
  out.地点.push({ 地点: p.name, 海拔: p.elevation, 小时数: hours,
    逐时条件态: cond,
    '≥80%层位置分布': loc, '其中厚度≥300m': locThick,
    读数: (cond.CLOUD_BELOW || 0) === 0
      ? '该点这一周没有任何「云在脚下」的小时；带内厚度达标的层 ' + locThick['带内完整'] + ' 个、带上方 ' + locThick['整体在带上'] + ' 个、带下方 ' + locThick['整体在带下'] + ' 个'
      : '该点有 ' + cond.CLOUD_BELOW + ' 个「云在脚下」的小时，是本轮唯一可能出云海的地点' })
})
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'g2-condition-tally.json'), JSON.stringify(out, null, 2))
