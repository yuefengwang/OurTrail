/* 修复前后对照（同输入、新旧两版渲染器）——不靠像素、不靠回忆
 *
 * 做法：把 HEAD（bedfeed，本轮改动之前）的 miniprogram/utils 用 git archive 取到仓库外，
 *       与当前版本喂同一份输入，逐场景比对「云行到底画出了什么」。
 * 运行：node run-ab.js <HEAD-utils-dir>
 */
'use strict'
const fs = require('fs')
const path = require('path')
const NEWC = require('../../../../../miniprogram/utils/cloud-field-svg.js')
const NEWU = require('../../../../../miniprogram/utils/meteogram-svg.js')
const NEWA = require('../../../../../miniprogram/utils/weather-cloud-field.js')
const OLDDIR = process.argv[2]
if (!OLDDIR || !fs.existsSync(path.join(OLDDIR, 'meteogram-svg.js'))) {
  console.error('用法：node run-ab.js <HEAD 版 utils 目录>')
  process.exit(2)
}
const OLDC = require(path.join(OLDDIR, 'cloud-field-svg.js'))
const OLDU = require(path.join(OLDDIR, 'meteogram-svg.js'))
const OLDA = require(path.join(OLDDIR, 'weather-cloud-field.js'))

const DATE = '2026-10-09'
function surface (n) {
  const o = []
  for (let h = 0; h < n; h++) o.push({
    t: String(h % 24).padStart(2, '0'), d: DATE, temp: 8, precip: 0, showers: 0,
    wind: 6, gust: 12, windDir: 90, code: 1, cloud: { low: 30, mid: 10, high: 10 },
  })
  return o
}
function levels (decks) {
  const times = []
  for (let h = 0; h < 24; h++) times.push(DATE + 'T' + String(h).padStart(2, '0') + ':00')
  const st = []
  decks.forEach(d => { st.push({ alt: d.lo, cov: d.cov }); st.push({ alt: d.hi, cov: d.cov }) })
  if (!st.length) st.push({ alt: 2000, cov: 6 }, { alt: 4000, cov: 6 })
  return { times, levels: st.map(s => ({ altitudes: times.map(() => s.alt), cloudCover: times.map(() => s.cov) })) }
}
function build (C, U, A, decks, alt, elevSource) {
  const cf = A.buildCloudFieldRange({ cloudLevels: levels(decks) }, { startDate: DATE, hours: 24, userAltitude: alt })
  const geo = U.buildUnified({ surface: surface(24), cloudField: cf, userAltitude: alt, elevSource: elevSource, width: 390, horizon: 24 })
  const svg = U.renderUnifiedBase(geo, {}).svg
  return { geo: geo, svg: svg }
}
/* 「画出了什么」的量化：等值带环数 + 云行内的像素墨迹 */
function ink (b) {
  const loops = (b.svg.match(/fill-rule="evenodd"/g) || []).length
  let area = 0
  ;[...b.svg.matchAll(/<path d="([^"]*)" fill="[^"]*" fill-rule="evenodd"/g)].forEach(m => {
    const pts = (m[1].match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/g) || []).map(s => s.split(',').map(Number))
    let s = 0
    for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; s += pts[i][0] * q[1] - q[0] * pts[i][1] }
    area += Math.abs(s / 2)
  })
  return { loops: loops, areaPx: Math.round(area) }
}
const SCEN = [
  ['云全部在显示窗下方', [{ lo: 1500, hi: 1700, cov: 92 }], 4058, 'picked'],
  ['云全部在显示窗上方', [{ lo: 6100, hi: 6400, cov: 88 }], 4058, 'picked'],
  ['云跨越显示窗下边界', [{ lo: 1700, hi: 2400, cov: 90 }], 3004, 'picked'],
  ['云在窗内（现状最好的形态）', [{ lo: 3150, hi: 3850, cov: 85 }], 3004, 'picked'],
  ['确认晴空', [], 3500, 'manual'],
  ['缺少可信高程', [{ lo: 3150, hi: 3850, cov: 85 }], null, null],
]
const rows = SCEN.map(([nm, decks, alt, src]) => {
  const a = build(OLDC, OLDU, OLDA, decks, alt, src)
  const b = build(NEWC, NEWU, NEWA, decks, alt, src)
  const ia = ink(a), ib = ink(b)
  const stA = alt == null ? null : NEWC.inferState(a.geo.sample, 10, alt, a.geo.covered, { basis: 'measured' })
  const stB = alt == null ? null : NEWC.inferState(b.geo.sample, 10, alt, b.geo.covered, { basis: 'measured' })
  return {
    场景: nm, 入参海拔: alt, 出处: src,
    旧窗: [NEWC.ALT0, NEWC.ALT1], 旧墨迹: ia.loops + '环/' + ia.areaPx + 'px²',
    新窗: [b.geo.profile.lo, b.geo.profile.hi], 新墨迹: ib.loops + '环/' + ib.areaPx + 'px²',
    新窗裁上: b.geo.profile.clippedAbove, 新窗裁下: b.geo.profile.clippedBelow,
    新窗点在窗外: b.geo.profile.pointOutside,
    旧边注: /窗外(上方|下方)还有云带|没有有意义云量/.test(a.svg),
    新边注: (b.svg.match(/窗外(上方|下方)还有云带|实测高度范围内没有有意义云量/g) || []),
    判读旧: stA ? (stA.key || stA.reason) : 'n/a', 判读新: stB ? (stB.key || stB.reason) : 'n/a',
    判读一致: JSON.stringify([stA && stA.key, stA && stA.reason]) === JSON.stringify([stB && stB.key, stB && stB.reason]),
    旧SVG有null标签: /此点 null|此点 NaN/.test(a.svg),
  }
})
console.log(JSON.stringify(rows, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'ab-window.json'), JSON.stringify({ generatedAt: new Date().toISOString(), cases: rows }, null, 2))
console.log('→ ab-window.json')
