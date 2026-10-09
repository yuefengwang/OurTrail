/* 前后判读不变性证明（本轮的关键验收项）
 *
 * 任务书要求：必须证明「对相同原始数据和相同查询点高程，自适应前后位置判定不变」。
 * 做法：把 HEAD（= bedfeed，上一轮云层位置语义统一之后、显示窗自适应之前）的
 *       miniprogram/utils 整目录用 git archive 取到一个仓库外的临时目录，
 *       同一份云场数据分别喂给新旧两版 inferState，逐小时逐海拔对比 key/reason/holds/cUser/span。
 * 适配器（weather-cloud-field.js）本轮没改，所以两版拿到的是同一个场。
 * 运行：node run-invariance.js <HEAD-utils-dir>
 */
'use strict'

const fs = require('fs')
const path = require('path')
const NEW = require('../../../../../miniprogram/utils/cloud-field-svg.js')
const WCFF = require('../../../../../miniprogram/utils/weather-cloud-field.js')
const OLD_DIR = process.argv[2]
if (!OLD_DIR || !fs.existsSync(path.join(OLD_DIR, 'cloud-field-svg.js'))) {
  console.error('用法：node run-invariance.js <包含 HEAD 版 cloud-field-svg.js 的目录>')
  process.exit(2)
}
const OLD = require(path.join(OLD_DIR, 'cloud-field-svg.js'))
const UMG = require('../../../../../miniprogram/utils/meteogram-svg.js')
const FIXED = [NEW.ALT0, NEW.ALT1]        // 旧固定窗（= 本轮之前的剖面显示范围）
const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'real-cloud.json'), 'utf8'))

function surfaceRows (n, date) {
  const out = []
  for (let h = 0; h < n; h++) out.push({
    t: String(h % 24).padStart(2, '0'), d: date, temp: 10, precip: 0, showers: 0,
    wind: 5, gust: 10, windDir: 90, code: 1, cloud: { low: 5, mid: 5, high: 5 },
  })
  return out
}

const ALT_CASES = [
  { label: '本点高程(measured)', pick: p => p.elevation, basis: 'measured' },
  { label: '本点高程(estimated)', pick: p => p.elevation, basis: 'estimated' },
  { label: '本点高程(none)', pick: p => p.elevation, basis: 'none' },
  { label: '无高程', pick: () => null, basis: 'none' },
  { label: '500m 低海拔(measured)', pick: () => 500, basis: 'measured' },
  { label: '6500m 高海拔(measured)', pick: () => 6500, basis: 'measured' },
]

let compared = 0, diffs = 0, oldBlank = 0, oldBlankButCloudExists = 0, newHasInk = 0
const windows = []
const seen = {}
Object.keys(snap.places).forEach(key => {
  const p = snap.places[key]
  const field = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: snap.date, hours: 24, userAltitude: p.elevation })
  if (!field) return
  const colN = NEW.makeColumnSampler(field), colO = OLD.makeColumnSampler(field)
  const sN = (t, a) => NEW.sampleAtStations(colN, field.times.length, t, a)
  const sO = (t, a) => OLD.sampleAtStations(colO, field.times.length, t, a)
  ALT_CASES.forEach(c => {
    const alt = c.pick(p)
    for (let h = 0; h < field.times.length; h++) {
      const a = OLD.inferState(sO, h, Number.isFinite(alt) ? alt : undefined, field.covered, { basis: c.basis })
      const b = NEW.inferState(sN, h, Number.isFinite(alt) ? alt : undefined, field.covered, { basis: c.basis })
      compared++
      const ka = JSON.stringify([a.key, a.reason, a.holds, a.cUser, a.span && [a.span.lo, a.span.hi]])
      const kb = JSON.stringify([b.key, b.reason, b.holds, b.cUser, b.span && [b.span.lo, b.span.hi]])
      if (ka !== kb) {
        diffs++
        seen[key + '/' + c.label] = seen[key + '/' + c.label] || []
        if ((seen[key + '/' + c.label] || []).length < 2) seen[key + '/' + c.label].push({ h: h, before: ka, after: kb })
      }
    }
  })
  /* 顺带量化这一轮真正修掉的东西：旧固定窗下「整行一条等值带都没有」的小时，
     其中有几小时其实窗外有云（被裁掉＝被读成晴空），几小时是真的晴空。 */
  const gNew = UMG.buildUnified({ surface: surfaceRows(24, snap.date), cloudField: field, userAltitude: p.elevation, width: 390, horizon: 24 })
  for (let h = 0; h < 24; h++) {
    let inkFixed = false, inkEnvelope = false
    for (let alt = FIXED[0]; alt <= FIXED[1]; alt += 50) if (sN(h, alt) >= 25) { inkFixed = true; break }
    for (let alt = Math.round(field.covered.lo); alt <= Math.round(field.covered.hi); alt += 50) if (sN(h, alt) >= 25) { inkEnvelope = true; break }
    if (!inkFixed) { oldBlank++; if (inkEnvelope) oldBlankButCloudExists++ }
  }
  if (gNew.stats.pathCount > 0 && gNew.profile.lo !== FIXED[0]) newHasInk++
  windows.push({
    place: p.name, elevation: p.elevation, oldWindow: FIXED,
    newWindow: [gNew.profile.lo, gNew.profile.hi], windowSpanPx: 190,
    clippedAbove: gNew.profile.clippedAbove, clippedBelow: gNew.profile.clippedBelow,
    pointOutside: gNew.profile.pointOutside, pointOutsideDelta: gNew.profile.pointOutsideDelta,
    anchorCount: gNew.profile.anchorCount, decks: gNew.profile.decks,
    paths: gNew.stats.pathCount, profMs: gNew.stats.profMs, calcMs: gNew.stats.calcMs,
  })
})

console.log(JSON.stringify({
  comparedVerdicts: compared,
  verdictDiffs: diffs,
  firstDiffs: seen,
  fixedWindowHoursWithZeroInk: oldBlank,
  ofThoseCloudActuallyExistedOffWindow: oldBlankButCloudExists,
  placesWhoseAdaptiveWindowDiffersFromFixed: newHasInk,
  windows: windows,
}, null, 2))
