/* 「天文暗夜始」机会句的差分对拍：改前（PRE_SHA）vs 工作树（本轮）
 *
 * 本轮的用户可见变化只有一处：时间轴「天文暗夜始」那句 sub（机会主张）改为"有银河小时才说"。
 * 要求（任一不满足即 exit 1）：
 *   ① 时间层零越界：条目数、时刻、标题、key、l2、window 逐字相同；差异只允许落在
 *      黄金/蓝调/天文暗夜始 的 `sub` 上，别的条目一动就算越界。
 *   ② 机会句双向一致：sub 有 ⇔ 当天 sky.hourMarks 里真的出现过 galaxy 小时。
 *      只测"被摘掉"不够——如果实现变成"永远不说"，① 都会绿，只有这条会红。
 *   ③ 目标必须真的变（至少一处机会句被摘掉），且必须有"完全没变"的阳性对照（晴夜那类）。
 *   ④ 上一轮的摄影窗口后缀行为不得回退（黄金/蓝调 的后缀数必须与改前一致）。
 *   ⑤ 结论卡九字段、逐小时 marks、真页面卡集合、沉默行、总评逐字节相同（本轮没碰判据）。
 *
 * 两侧各走自己的 agenda/sky/真页面装配（不在本脚本里镜像被测逻辑，铁律 11）。
 * 运行：node ab-dark-window.js
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../../../../..')
const PRE_SHA = process.env.PRE_SHA || 'd2e9d70'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

const preRoot = path.join(os.tmpdir(), 'ot-darkwindow-ab-' + PRE_SHA.slice(0, 7))
if (!fs.existsSync(path.join(preRoot, 'miniprogram/utils/agenda.js'))) {
  fs.mkdirSync(preRoot, { recursive: true })
  execSync('git archive ' + PRE_SHA + ' miniprogram | tar -x -C "' + preRoot + '"', { cwd: ROOT, stdio: 'inherit' })
}
const preAgenda = fs.readFileSync(path.join(preRoot, 'miniprogram/utils/agenda.js'), 'utf8')
if (preAgenda.indexOf('hasMark') >= 0) { console.error('给定目录已经有本轮逻辑 —— 那不是改前的版本'); process.exit(2) }

const side = tree => ({
  sky: require(path.join(tree, 'utils/sky.js')),
  agenda: require(path.join(tree, 'utils/agenda.js')),
  cond: require(path.join(tree, 'utils/conditions.js')),
  A: require(path.join(tree, 'utils/astro.js')),
})
const PRE = side(path.join(preRoot, 'miniprogram')), POST = side(path.join(ROOT, 'miniprogram'))
global.Page = cfg => { global.__P = cfg }
global.wx = global.wx || { getStorageSync: () => '', setStorageSync: () => {}, showToast: () => {} }
require(path.join(preRoot, 'miniprogram/pages/weather/weather.js'))
const prePage = Object.assign({}, global.__P)
prePage.data = JSON.parse(JSON.stringify(global.__P.data || {}))
global.Page = cfg => { global.__Q = cfg }
require(path.join(ROOT, 'miniprogram/pages/weather/weather.js'))
const postPage = Object.assign({}, global.__Q)
postPage.data = JSON.parse(JSON.stringify(global.__Q.data || {}))

const DATE = '2026-10-09', LAT = 29.52, LNG = 103.33, ELE = 3004
function day (f) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const o = f(h) || {}
    out.push({
      t: String(h).padStart(2, '0') + ':00', d: DATE, temp: 8, code: 0,
      pop: o.pop || 0, precip: o.precip || 0, showers: 0, wind: 4, gust: 9, windDir: 45,
      rh: o.rh != null ? o.rh : 40, pressure: 700, dewPoint: 3, visibility: 40, freezing: 4600, uv: 3,
      cloud: { low: o.low || 0, mid: o.mid || 0, high: o.high || 0 }, band: o.band || null,
    })
  }
  return out
}
const SYNTH = [
  ['满云有雨（银河卡已被沉默）', day(() => ({ low: 100, mid: 100, high: 100, pop: 90, precip: 0.8, rh: 95 }))],
  ['晴夜 · 银心季 · 残月（银河真有戏）', day(() => ({ low: 5, mid: 5, high: 10 }))],
  ['晴夜但中高云偏厚（暗夜晴空 0%）', day(() => ({ low: 5, mid: 70, high: 70 }))],
  ['晴夜 · 满月（标记要月照 <35%）', day(() => ({ low: 5, mid: 5, high: 10 })), '2026-09-26'],
  ['1 月晴夜（不在银心季）', day(() => ({ low: 5, mid: 5, high: 10 })), '2026-01-15'],
  ['低云满 + 高云净（摄影后缀与机会句各判各的）', day(() => ({ low: 95, mid: 0, high: 0 }))],
]
let cases = 0, dropped = 0, kept = 0, unchanged = 0, overreach = 0
const rows = []

function runOne (name, detail, date) {
  cases++
  const d = date || DATE
  const sun = PRE.A.sunTimes(d, LAT, LNG, ELE)
  const win = PRE.A.photoWindows(d, LAT, LNG, ELE)
  const mk = (sky, dt) => {
    const m = sky.hourMarks({ date: d, lat: LAT, lng: LNG, elevation: ELE, elevOK: true, detail: dt, days: [] })
    const out = {}
    Object.keys(m).forEach(t => { out[d + 'T' + t] = m[t] })
    return out
  }
  const ma = mk(PRE.sky, detail), mb = mk(POST.sky, detail)
  const ea = PRE.agenda.buildDayAgenda({ date: d, detail, marks: ma, sun, win })
  const eb = POST.agenda.buildDayAgenda({ date: d, detail, marks: mb, sun, win })
  const diffs = []
  if (ea.length !== eb.length) diffs.push('条目数 ' + ea.length + ' → ' + eb.length)
  const photoNotes = list => list.filter(e => /黄金时刻|蓝调时刻/.test(e.title) && /当时低云/.test(e.sub || '')).length
  ea.forEach((x, i) => {
    const y = eb[i]
    if (!y) return
    ;['t', 'title', 'key', 'l2', 'window'].forEach(f => { if (x[f] !== y[f]) diffs.push('非 sub 变了 ' + x.title + '.' + f) })
    if (x.sub === y.sub) return
    const allowed = /黄金时刻|蓝调时刻|天文暗夜始/.test(x.title)
    if (!allowed) { diffs.push('别的条目动了 sub：' + x.title); return }
    if (/黄金|蓝调/.test(x.title)) diffs.push('摄影窗口的 sub 不该在本轮变（' + x.title + '）')
  })
  if (photoNotes(ea) !== photoNotes(eb)) diffs.push('上一轮的摄影后缀数回退了：' + photoNotes(ea) + ' → ' + photoNotes(eb))

  // ② 机会句双向一致
  const darkA = (ea.filter(e => e.title === '天文暗夜始')[0] || {}).sub || null
  const darkB = (eb.filter(e => e.title === '天文暗夜始')[0] || {}).sub || null
  const hasGalaxyMark = Object.keys(mb).some(k => (mb[k] || []).indexOf('galaxy') !== -1)
  if (darkB !== null && !hasGalaxyMark) diffs.push('没有 galaxy 小时却仍说机会句')
  if (darkB === null && hasGalaxyMark) diffs.push('有 galaxy 小时却被摘掉机会句（凭空减事实）')
  if (darkA && !darkB) dropped++
  if (darkA && darkB) kept++
  if (darkA === darkB) unchanged++

  // ⑤ 判据与卡片零变化
  const sa = PRE.sky.summarize({ date: d, lat: LAT, lng: LNG, elevation: ELE, elevOK: true, detail, days: [], heading: 75 })
  const sb = POST.sky.summarize({ date: d, lat: LAT, lng: LNG, elevation: ELE, elevOK: true, detail, days: [], heading: 75 })
  sa.items.forEach((it, i) => {
    ;['key', 'title', 'score', 'tone', 'label', 'window', 'look', 'text', 'verdict'].forEach(f => {
      if (it[f] !== sb.items[i][f]) diffs.push('结论卡变了 ' + it.key + '.' + f)
    })
  })
  if (JSON.stringify(sa.marks) !== JSON.stringify(sb.marks)) diffs.push('逐小时标记变了')
  const arg = s => ({ date: d, detail, days: [], elevation: ELE, sun: s.sun, moon: s.moon })
  if (JSON.stringify(prePage.buildCondCards(sa, arg(sa))) !== JSON.stringify(postPage.buildCondCards(sb, arg(sb)))) diffs.push('页面卡集合变了')
  if (JSON.stringify(prePage.buildCondSilent(sa)) !== JSON.stringify(postPage.buildCondSilent(sb))) diffs.push('沉默行变了')
  if (JSON.stringify(PRE.cond.overallGrade(sa.items)) !== JSON.stringify(POST.cond.overallGrade(sb.items))) diffs.push('总评变了')

  if (diffs.length) { overreach += diffs.length; console.log('!! ' + name + ' 越界：' + diffs.join(' | ')) }
  rows.push({ 场景: name, 日期: d, 改前机会句: darkA, 改后机会句: darkB, galaxy标记: hasGalaxyMark, 越界: diffs })
}

console.log('== 合成场景（%d 组）==', SYNTH.length)
SYNTH.forEach(c => runOne(c[0], c[1], c[2]))
console.log('\n== 真实快照（4 站 × 7 天）==')
const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))
Object.keys(snap.places).forEach(k => {
  const p = snap.places[k]
  for (let i = 0; i < 7; i++) {
    const date = new Date(Date.parse(snap.date + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10)
    const detail = (p.series || []).filter(r => r.d === date)
    if (detail.length < 24) continue
    runOne(p.name + ' ' + date, detail, date)
  }
})

fs.writeFileSync(path.join(__dirname, '..', 'ab-dark-window.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), pre: PRE_SHA, 场景数: cases,
  摘掉机会句: dropped, 保留机会句: kept, 完全未变: unchanged, 越界读数: overreach, 明细: rows,
}, null, 2))
console.log('\n合计 %d 场景：机会句被摘掉 %d、保留 %d、完全未变 %d、越界 %d → ab-dark-window.json',
  cases, dropped, kept, unchanged, overreach)
if (overreach) { console.log('!! 越界：本轮只允许改「天文暗夜始」那一句 sub'); process.exit(1) }
if (!dropped) { console.log('!! 空改：没有任何一处机会句被摘掉'); process.exit(1) }
if (!kept) { console.log('!! 一刀切：没有一处机会句保留下来 ⇒ 分不清是判据在判还是永远不说'); process.exit(1) }
console.log('✓ 时刻与标题逐字未动；机会句与 galaxy 标记双向一致；上一轮摄影后缀未回退；判据/卡片/总评零变化')
