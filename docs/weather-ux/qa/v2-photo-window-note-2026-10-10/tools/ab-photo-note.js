/* 摄影窗口事实后缀的差分对拍：改前（PRE_SHA）vs 工作树（本轮）
 *
 * 本轮的用户可见变化**只有一处**：时间轴上「黄金时刻/蓝调时刻」四条的 sub 可能在满云时多一句事实。
 * 所以要求四件事，缺一即 exit 1：
 *   ① 时间层零越界 —— 条目数、时刻、标题、key、l2、window 必须逐字相同（**不裁时间**是这轮的前提）；
 *      差异只允许落在 黄金/蓝调 条目的 `sub` 上，其它任何条目的任何字段变了都算越界。
 *   ② 后缀必须有据 —— 每处新增后缀，该小时的低云必须 ≥ sky.LIGHT_LIMITS.LOW_CLOUD_MAX；
 *      反之低云达标却没加后缀，也算越界（说明后缀在别处抄了一份判据）。
 *   ③ 目标必须真的变（满云场景里至少有一处后缀），否则等于没做。
 *   ④ 必须有"一条都不加"的晴日阳性对照，否则分不清是判据在动还是无条件加话。
 *   ⑤ 顺带证明 sky.js 的 `c.low < 40` 换成 lightReachesGround(c) 是**纯改名**：
 *      六张结论卡的可见字段、逐小时标记、页面卡集合、OI 卡必须逐字节相同。
 *
 * 两侧各走自己的 agenda/sky/页面装配（不在本脚本里镜像被测逻辑，铁律 11）。
 * 运行：node ab-photo-note.js
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../../../../..')
const PRE_SHA = process.env.PRE_SHA || 'eded900'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

const preRoot = path.join(os.tmpdir(), 'ot-photenote-ab-' + PRE_SHA.slice(0, 7))
if (!fs.existsSync(path.join(preRoot, 'miniprogram/utils/agenda.js'))) {
  fs.mkdirSync(preRoot, { recursive: true })
  execSync('git archive ' + PRE_SHA + ' miniprogram | tar -x -C "' + preRoot + '"', { cwd: ROOT, stdio: 'inherit' })
}
if (fs.readFileSync(path.join(preRoot, 'miniprogram/utils/agenda.js'), 'utf8').indexOf('lightNote') >= 0) {
  console.error('给定目录里已经有后缀逻辑 —— 那不是改前的版本'); process.exit(2)
}
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
      t: String(h).padStart(2, '0') + ':00', d: DATE, temp: o.temp == null ? 8 : o.temp,
      code: o.code || 0, pop: o.pop || 0, precip: o.precip || 0, showers: o.showers || 0,
      wind: 4, gust: 9, windDir: 45, rh: o.rh != null ? o.rh : 40, pressure: 700, dewPoint: 3,
      visibility: 40, freezing: 4600, uv: 3,
      cloud: { low: o.low || 0, mid: o.mid || 0, high: o.high || 0 }, band: o.band || null,
    })
  }
  return out
}
const SEA_BAND = { base: 1000, top: 1400, cover: 95 }
const SYNTH = [
  ['满云（低云 100%）', day(() => ({ low: 100, mid: 100, high: 100, rh: 95 }))],
  ['高云满但低云干净（卷层云：光仍到得了）', day(() => ({ low: 5, mid: 95, high: 95 }))],
  ['晴日（低云 10%）', day(() => ({ low: 10, mid: 10, high: 10 }))],
  ['边界：低云恰为上限', day(() => ({ low: 40, mid: 10, high: 10 }))],
  ['边界外一格：低云 39%', day(() => ({ low: 39, mid: 10, high: 10 }))],
  ['晨昏窗口那两小时才起云（逐小时取云，不按全天）', day(h => (h >= 6 && h <= 7 ? { low: 90, mid: 20, high: 20 } : { low: 5, mid: 10, high: 10 }))],
  ['缺云量读数（生产形状：cloud 对象在、字段是 undefined/null）', day(() => ({ mid: 10, high: 10 })).map(h => (h.cloud = { low: undefined, mid: 10, high: 10 }, h))],
  ['五项同时有戏的对照日', day(h => {
    if (h >= 6 && h <= 7) return { low: 10, mid: 30, high: 20, pop: 20, band: SEA_BAND }
    if (h >= 8 && h <= 9) return { low: 20, mid: 15, high: 10, pop: 30, precip: 0.3, rh: 92, band: SEA_BAND }
    return { low: 20, mid: 10, high: 10 }
  })],
]
const rows = []
let overreach = 0, noteAdded = 0, cases = 0, cleanControl = 0

function runOne (name, detail, date) {
  cases++
  const sun = PRE.A.sunTimes(date, LAT, LNG, ELE)
  const win = PRE.A.photoWindows(date, LAT, LNG, ELE)
  const ea = PRE.agenda.buildDayAgenda({ date, detail, marks: {}, sun, win })
  const eb = POST.agenda.buildDayAgenda({ date, detail, marks: {}, sun, win })
  const diffs = []
  if (ea.length !== eb.length) diffs.push('条目数 ' + ea.length + ' → ' + eb.length)
  ea.forEach((x, i) => {
    const y = eb[i]
    if (!y) return
    ;['t', 'title', 'key', 'l2', 'window'].forEach(f => {
      if (x[f] !== y[f]) diffs.push('非 sub 字段变了 ' + x.title + '.' + f)
    })
    if (x.sub === y.sub) return
    if (!/黄金时刻|蓝调时刻/.test(x.title)) { diffs.push('别的条目加了话：' + x.title); return }
    const lowVal = POST.agenda.lowCloudAt(detail, x.t)
    const limit = POST.sky.LIGHT_LIMITS.LOW_CLOUD_MAX
    const should = lowVal != null && lowVal >= limit
    if (y.sub == null) diffs.push('后缀被摘掉（' + x.title + '）')
    else if (!should) diffs.push('低云 ' + lowVal + '% < ' + limit + ' 却加了后缀（' + x.title + '）')
    else noteAdded++
  })
  // 该加没加（反向漏）：低云达标却整条没后缀
  eb.filter(e => /黄金时刻|蓝调时刻/.test(e.title)).forEach(y => {
    const lowVal = POST.agenda.lowCloudAt(detail, y.t)
    if (lowVal != null && lowVal >= POST.sky.LIGHT_LIMITS.LOW_CLOUD_MAX && !/当时低云/.test(y.sub || '')) {
      diffs.push('低云 ' + lowVal + '% 达标却没后缀（' + y.title + '）')
    }
  })

  // ⑤ sky.js 的改名必须是纯改名：结论卡、标记、页面卡、总评逐字节相同
  const sa = PRE.sky.summarize({ date, lat: LAT, lng: LNG, elevation: ELE, elevOK: true, detail, days: [], heading: 75 })
  const sb = POST.sky.summarize({ date, lat: LAT, lng: LNG, elevation: ELE, elevOK: true, detail, days: [], heading: 75 })
  sa.items.forEach((it, i) => {
    ;['key', 'title', 'score', 'tone', 'label', 'window', 'look', 'text', 'verdict'].forEach(f => {
      if (it[f] !== sb.items[i][f]) diffs.push('结论卡变了 ' + it.key + '.' + f)
    })
  })
  if (JSON.stringify(sa.marks) !== JSON.stringify(sb.marks)) diffs.push('逐小时标记变了')
  const arg = s => ({ date, detail, days: [], elevation: ELE, sun: s.sun, moon: s.moon })
  if (JSON.stringify(prePage.buildCondCards(sa, arg(sa))) !== JSON.stringify(postPage.buildCondCards(sb, arg(sb)))) diffs.push('页面结论卡集合变了')
  if (JSON.stringify(PRE.cond.overallGrade(sa.items)) !== JSON.stringify(POST.cond.overallGrade(sb.items))) diffs.push('总评变了')

  if (diffs.length) { overreach += diffs.length; console.log('!! ' + name + ' 越界：' + diffs.join(' | ')) }
  const notesHere = eb.filter(e => /黄金时刻|蓝调时刻/.test(e.title) && /当时低云/.test(e.sub || '')).length
  if (!notesHere) cleanControl++
  rows.push({ 场景: name, 条目数: ea.length, 后缀条数: notesHere, 越界: diffs })
}

console.log('== 合成场景（' + SYNTH.length + ' 组）==')
SYNTH.forEach(c => runOne(c[0], c[1], DATE))
console.log('\n== 真实快照（4 站 × 7 天）==')
const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))
Object.keys(snap.places).forEach(k => {
  const p = snap.places[k]
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const detail = (p.series || []).filter(r => r.d === date)
    if (detail.length < 24) continue
    runOne(p.name + ' ' + date, detail, date)
  }
})

fs.writeFileSync(path.join(__dirname, '..', 'ab-photo-note.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), pre: PRE_SHA, 场景数: cases, 新增后缀: noteAdded,
  零后缀场景: cleanControl, 越界读数: overreach, 明细: rows,
}, null, 2))
console.log('\n合计 ' + cases + ' 场景：新增后缀 ' + noteAdded + ' 处、零后缀（含晴日与缺读数）' + cleanControl +
  ' 个场景、越界 ' + overreach + ' 处 → ab-photo-note.json')
if (overreach) { console.log('!! 越界：本轮只允许给 黄金/蓝调 加 sub 后缀'); process.exit(1) }
if (!noteAdded) { console.log('!! 空改：没有任何一处后缀真的出现过'); process.exit(1) }
if (cleanControl === 0) { console.log('!! 缺阳性对照：没有"一条都不加"的场景，分不清是判据还是无条件加话'); process.exit(1) }
console.log('✓ 时间层逐字未动；后缀与低云口径双向一致；sky.js 的改名是纯改名（卡片/标记/总评零差异）')
