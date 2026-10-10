/* 彩虹遮光闸的差分对拍：origin/master（改前）vs 工作树（改后）
 *
 * 这是一次**故意的**业务变化（满云日不再给彩虹卡），所以这里不要求"零差异"，
 * 而是要求两件更强的事：
 *   ① 非彩虹的判定一个都不许动 —— 机会窗口的 type/时刻/置信、其余五类结论的分数与档位，
 *      任何一处不同就是越界，exit 1；
 *   ② 彩虹必须**真的变了** —— 若彩虹差异为 0，说明这道闸在生产数据上从没生效过，
 *      等于白改，同样 exit 1（空改与越界一样不可接受）。
 *
 * 运行：node ab-rainbow.js <改前的 utils 目录>
 *      （git archive origin/master miniprogram/utils | tar -x -C <dir>）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../..')
const PRE_DIR = process.argv[2]
if (!PRE_DIR || !fs.existsSync(path.join(PRE_DIR, 'sky.js'))) {
  console.error('用法：node ab-rainbow.js <改前的 utils 目录>'); process.exit(2)
}
if (fs.readFileSync(path.join(PRE_DIR, 'sky.js'), 'utf8').indexOf('sunVisible') >= 0) {
  console.error('给定目录里已经有遮光闸 —— 那不是改前的版本'); process.exit(2)
}
const SIDE = name => ({
  sky: require(path.join(name === 'pre' ? PRE_DIR : path.join(ROOT, 'miniprogram/utils'), 'sky.js')),
  OI: require(path.join(name === 'pre' ? PRE_DIR : path.join(ROOT, 'miniprogram/utils'), 'outdoor-intelligence.js')),
})
const PRE = SIDE('pre'), POST = SIDE('post')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))

const DATE = '2026-10-09', LAT = 30.0, LNG = 100.27
function dayOf (f) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const o = f(h) || {}
    out.push({
      t: (h < 10 ? '0' : '') + h + ':00', d: DATE, temp: 8, code: 0,
      pop: o.pop || 0, precip: o.precip || 0, showers: o.showers || 0,
      wind: 4, gust: 9, windDir: 45, rh: o.rh != null ? o.rh : 40,
      visibility: 40, freezing: 4600,
      cloud: { low: o.low || 0, mid: o.mid || 0, high: o.high || 0 }, band: o.band || null,
    })
  }
  return out
}
/* 合成对照：截图那种"全天满云"与"云开有雨"两种极端，加一份真实快照 */
const CASES = [
  ['满云有雨（截图形态：低中高云全高 + 持续降水）', dayOf(() => ({ low: 95, mid: 90, high: 90, rh: 98, precip: 0.6, pop: 90 }))],
  ['满云无雨（一滴没下，但低云 100% 也算过"水分"）', dayOf(() => ({ low: 100, mid: 100, high: 100, rh: 95 }))],
  ['云开有雨（清晨阵雨 + 低云散开）', dayOf(h => (h >= 7 && h <= 9) ? ({ low: 30, mid: 15, high: 10, rh: 92, precip: 0.3 }) : ({ low: 5 }))],
  ['高云遮日（低云 0 但中高云满）', dayOf(h => (h >= 7 && h <= 9) ? ({ low: 10, mid: 95, high: 95, rh: 90, precip: 0.3 }) : ({ low: 5 }))],
  ['干燥晴（无水分）', dayOf(() => ({ low: 0, mid: 0, high: 0, rh: 30 }))],
]

function oiTypes (side, detail) {
  const oi = side.OI.buildOutdoorIntelligence({
    date: DATE, detail, userAltitude: 4058, elevOK: true, elevBasis: 'measured',
    lat: LAT, lng: LNG, days: [], cloudField: null,
  })
  return (oi.opportunities || []).map(o => [o.type, o.from, o.to, o.confidence].join('@'))
}
function skyItems (side, detail) {
  const s = side.sky.summarize({ date: DATE, lat: LAT, lng: LNG, elevation: 1200, elevOK: true, detail, days: [], heading: null })
  return s.items.map(i => [i.key, i.score, i.label, i.window || '—'].join('|'))
}

let rainbowDiffs = 0, otherDiffs = 0
const rows = []
function compare (label, detail) {
  const a = oiTypes(PRE, detail), b = oiTypes(POST, detail)
  const sa = skyItems(PRE, detail), sb = skyItems(POST, detail)
  const drop = a.filter(x => x.indexOf('RAINBOW') !== -1).filter(x => b.indexOf(x) === -1)
  const add = b.filter(x => x.indexOf('RAINBOW') !== -1).filter(x => a.indexOf(x) === -1)
  const aNon = a.filter(x => x.indexOf('RAINBOW') === -1), bNon = b.filter(x => x.indexOf('RAINBOW') === -1)
  const sameNonRainbow = JSON.stringify(aNon) === JSON.stringify(bNon)
  /* 五类非彩虹结论（云海/光染/星空/银河/晨昏光窗口）的分数与档位必须逐字相同 */
  const nonRainbowSky = x => x.filter(l => l.indexOf('rainbow|') !== 0)
  const sameSky = JSON.stringify(nonRainbowSky(sa)) === JSON.stringify(nonRainbowSky(sb))
  const rbA = sa.filter(l => l.indexOf('rainbow|') === 0), rbB = sb.filter(l => l.indexOf('rainbow|') === 0)
  const changed = drop.length || add.length || JSON.stringify(rbA) !== JSON.stringify(rbB)
  if (!sameNonRainbow || !sameSky) otherDiffs++
  if (changed) rainbowDiffs++
  rows.push({ 场景: label, 改前机会: a, 改后机会: b, 消失: drop, 新增: add, 改前彩虹卡: rbA, 改后彩虹卡: rbB, 非彩虹越界: !sameNonRainbow || !sameSky })
  console.log([label,
    '彩虹卡 ' + rbA.map(x => x.split('|')[1]).join('') + ' → ' + rbB.map(x => x.split('|')[1]).join(''),
    '窗口 -' + drop.length + '/+' + add.length,
    '非彩虹判据相同=' + (sameNonRainbow && sameSky)].join(' | '))
  if (!sameNonRainbow) console.log('   越界：机会窗口变了\n   前 ' + JSON.stringify(aNon) + '\n   后 ' + JSON.stringify(bNon))
  if (!sameSky) console.log('   越界：非彩虹结论的分数/档位变了\n   前 ' + JSON.stringify(nonRainbowSky(sa)) + '\n   后 ' + JSON.stringify(nonRainbowSky(sb)))
}

console.log('== 合成场景 ==')
CASES.forEach(c => compare(c[0], c[1]))

console.log('\n== 真实快照（4 站 × 7 天） ==')
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json'), 'utf8'))
Object.keys(snap.places).forEach(function (k) {
  const p = snap.places[k]
  for (let d = 0; d < 7; d++) {
    const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const detail = (p.series || []).filter(r => r.d === day)
    if (detail.length < 24) continue
    compare(p.name + ' ' + day, detail)
  }
})

const out = { generatedAt: new Date().toISOString(), pre: 'origin/master', 场景数: rows.length, 彩虹变化场景: rainbowDiffs, 非彩虹越界场景: otherDiffs, 明细: rows }
fs.writeFileSync(path.join(__dirname, '..', 'ab-rainbow.json'), JSON.stringify(out, null, 2))
console.log('\n合计 ' + rows.length + ' 个场景：彩虹判定变化 ' + rainbowDiffs + ' 处、非彩虹越界 ' + otherDiffs + ' 处 → ab-rainbow.json')
if (otherDiffs) { console.log('!! 越界：本轮只允许改彩虹'); process.exit(1) }
if (!rainbowDiffs) { console.log('!! 空改：遮光闸在任何场景都没产生差别，等于没修'); process.exit(1) }
console.log('✓ 改动被限制在彩虹这一类，且确实起作用了')
