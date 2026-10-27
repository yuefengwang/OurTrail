/* F4 阶段一（结论项 `at` 锚点）的差分对拍：改前快照 vs 改后快照
 *
 * ── 基线从哪来 ────────────────────────────────────────────────────────
 * 改前 = `D:/ot-baselines/c3/`（post-C2/pre-C3 快照），改后 = `D:/ot-baselines/c5/`
 * （post-C4/pre-C5 快照）；两侧被改文件的 md5 都写死在本文件里，缺失或哈希不符一律
 * exit 2（INVALID harness）——**不是通过**。
 * 两侧各自 require 各自的模块实例（pre 的 conditions 会 require pre 的 sky，这正是我们
 * 要对照的那一对），并断言实例确实不同。
 * ⚠ 改后侧固定为 c5 快照，**不是当前工作树**：本对拍证明的是 C3 这一提交的 delta。
 *   C5 起只改光染文案/打分，若仍读工作树，C3 的对拍会把那些改动误判成越界。
 *
 * ── 允许的差异（写死；别的一律越界）──────────────────────────────────
 * ① 结论项：六项都必须新增且只新增一个 `at` 字段。
 *    - 字段集合必须恰为「改前字段 ∪ {at}」；`at` 必须是空串或 `YYYY-MM-DDTHH:mm`。
 *    - 其余九个既有字段（key/title/window/look/text/score/tone/label/verdict）任何变化都算越界；
 *      item 数量与顺序也不许变。
 * ② factsFor 无 item：五个 key（cloudSea/alpenglow/rainbow/star/galaxy）逐字节相同。
 * ③ factsFor 带 item 且非跨夜：逐字节相同（item 必须被忽略；这是阳性对照）。
 * ④ factsFor 带 item 且真跨夜（item.at 的日期 ≠ 场景日期，且 night 非空）：
 *    只有 star/galaxy 两个 key 的**证据行 `at`** 允许变化，且每一行都必须等于 item.at；
 *    fact / kind / 顺序 / 行数 / 其它 key 的任何变化都算越界。
 * ⑤ 跨夜判定只在「完整日期格式」上成立；半截日期与纯 HH:mm 一律按非跨夜处理（失败关闭）。
 *
 * ── 空改门与阳性对照 ────────────────────────────────────────────────
 * 空改门：至少要有一次「跨夜 galaxy 证据锚点从 HH:mm 变成完整日期」——为 0 说明这道闸
 * 在生产形状上一次都没生效（本轮真实 28 天是 10 月，银心在午夜前落下，跨夜由合成夹具行使）。
 * 阳性对照：至少有一个场景的 factsFor 在带 item 时仍与改前逐字节相同——否则"全都变了"
 * 分不清是闸在判还是把证据推倒重写。
 *
 * 运行：node tools/ab-f4-anchor.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const PRE_ROOT = process.env.PRE_ROOT || path.join('D:', 'ot-baselines', 'c3')
const POST_ROOT = process.env.POST_ROOT || path.join('D:', 'ot-baselines', 'c5')
const PRE_SKY_MD5 = '0493b2a9c3ddfcda7d045b97a2d05ad5'
const PRE_COND_MD5 = 'c7df68ad539ea46e934174cf4d823979'
const POST_SKY_MD5 = 'b85078699b4b0cd4ba3d76b40aa95ced'
const POST_COND_MD5 = 'db4b3d938902898a178cd470c1f9b8ea'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')
const AT_FULL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const FIELDS = ['key', 'title', 'window', 'look', 'text', 'score', 'tone', 'label', 'verdict']
const KEYS = ['cloudSea', 'alpenglow', 'rainbow', 'star', 'galaxy']

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

const preSkyPath = path.join(PRE_ROOT, 'miniprogram/utils/sky.js')
const preCondPath = path.join(PRE_ROOT, 'miniprogram/utils/conditions.js')
if (!fs.existsSync(preSkyPath) || !fs.existsSync(preCondPath)) {
  console.error('INVALID：改前快照不可达 ' + PRE_ROOT + '（缺 utils/sky.js / conditions.js）')
  process.exit(2)
}
if (md5(preSkyPath) !== PRE_SKY_MD5) {
  console.error('INVALID：改前快照 sky.js 的 md5 不符（期望 ' + PRE_SKY_MD5 + '，实得 ' + md5(preSkyPath) + '）')
  process.exit(2)
}
if (md5(preCondPath) !== PRE_COND_MD5) {
  console.error('INVALID：改前快照 conditions.js 的 md5 不符（期望 ' + PRE_COND_MD5 + '，实得 ' + md5(preCondPath) + '）')
  process.exit(2)
}

const postSkyPath = path.join(POST_ROOT, 'miniprogram/utils/sky.js')
const postCondPath = path.join(POST_ROOT, 'miniprogram/utils/conditions.js')
if (!fs.existsSync(postSkyPath) || !fs.existsSync(postCondPath)) {
  console.error('INVALID：改后快照不可达 ' + POST_ROOT + '（缺 utils/sky.js / conditions.js）')
  process.exit(2)
}
if (md5(postSkyPath) !== POST_SKY_MD5) {
  console.error('INVALID：改后快照 sky.js 的 md5 不符（期望 ' + POST_SKY_MD5 + '，实得 ' + md5(postSkyPath) + '）')
  process.exit(2)
}
if (md5(postCondPath) !== POST_COND_MD5) {
  console.error('INVALID：改后快照 conditions.js 的 md5 不符（期望 ' + POST_COND_MD5 + '，实得 ' + md5(postCondPath) + '）')
  process.exit(2)
}
if (!fs.existsSync(REAL)) {
  console.error('INVALID：真实快照不可达 ' + REAL)
  process.exit(2)
}

const preSky = require(preSkyPath)
const preCond = require(preCondPath)
const postSky = require(postSkyPath)
const postCond = require(postCondPath)
if (preSky === postSky || preCond === postCond) {
  console.error('INVALID：两侧模块实例没分开（require 缓存被复用）')
  process.exit(2)
}

const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))

let scenarios = 0
let atNonEmpty = 0
let crossNightItems = 0
let crossNightRows = 0
let galaxyCrossRows = 0
let positives = 0
let overreach = 0
const notes = []

function bad(msg) {
  overreach += 1
  if (notes.length < 40) notes.push(msg)
}

function daysOf(series) {
  const map = {}
  ;(series || []).forEach(h => {
    if (!map[h.d]) map[h.d] = { date: h.d, precipSum: 0 }
    map[h.d].precipSum += Number(h.precip) || 0
  })
  return Object.keys(map).sort().map(k => map[k])
}

/* 场景 ①：结论项本身（`at` 是唯一允许的新增字段） */
function compareItems(where, a, b) {
  if (!a || !b) { bad(where + ' summarize 返回空'); return null }
  if (a.items.length !== b.items.length) {
    bad(where + ' items 数量变了 ' + a.items.length + '→' + b.items.length)
  }
  a.items.forEach((x, i) => {
    const y = b.items[i]
    if (!y) return
    if (x.key !== y.key) bad(where + ' item 顺序变了 ' + x.key + '→' + y.key)
    const preKeys = Object.keys(x).sort()
    const postKeys = Object.keys(y).sort()
    const expect = preKeys.concat(['at']).sort()
    if (postKeys.join(',') !== expect.join(',')) {
      bad(where + ' ' + x.key + ' 字段集合不是「改前 ∪ {at}」：' + preKeys.join(',')
        + ' → ' + postKeys.join(','))
    }
    FIELDS.forEach(f => {
      if (JSON.stringify(x[f]) !== JSON.stringify(y[f])) {
        bad(where + ' ' + x.key + '.' + f + ' 变了')
      }
    })
    if (typeof y.at !== 'string' || (y.at !== '' && !AT_FULL_RE.test(y.at))) {
      bad(where + ' ' + x.key + '.at 形态不合法：' + JSON.stringify(y.at))
    }
    if (y.at !== '') atNonEmpty += 1
  })
  return b.items
}

/* 场景 ②③④：factsFor 的锚点与其它字段 */
function compareFacts(where, date, items, skyOut, ctxBase) {
  const night = skyOut.night || []
  const factsCtx = Object.assign({}, ctxBase, {
    date, sun: skyOut.sun, moon: skyOut.moon, night,
    /* atmosphere 固定缺测：跨夜时它的时间参数会（按设计）改读次日，属于**故意的读数修正**，
       本对拍的逐字节判据只覆盖「没有 atmosphere」的语料；该修正由 sky-test §23 单独钉。
       lightPollution 给一份读数，好让跨夜分支的每一行（含天空亮度）都被检查 at。 */
    atmosphere: null, lightPollution: { bortle: 3, sqm: 21.0 },
  })
  KEYS.forEach(key => {
    const preNoItem = preCond.factsFor(key, factsCtx)
    const postNoItem = postCond.factsFor(key, factsCtx)
    if (JSON.stringify(preNoItem) !== JSON.stringify(postNoItem)) {
      bad(where + ' factsFor(' + key + ', 无 item) 变了')
    }
    const item = (items || []).filter(i => i.key === key)[0]
    if (!item) return
    const postWithItem = postCond.factsFor(key, Object.assign({}, factsCtx, { item }))
    const cross = AT_FULL_RE.test(item.at) && item.at.slice(0, 10) !== date && night.length > 0
    if (!cross || (key !== 'star' && key !== 'galaxy')) {
      if (JSON.stringify(preNoItem) !== JSON.stringify(postWithItem)) {
        bad(where + ' factsFor(' + key + ', 非跨夜/非夜相 item) 变了（item 应被忽略）')
      } else {
        positives += 1
      }
      return
    }
    crossNightItems += 1
    if (postWithItem.length !== preNoItem.length) {
      bad(where + ' factsFor(' + key + ', 跨夜) 行数变了 ' + preNoItem.length + '→' + postWithItem.length)
      return
    }
    postWithItem.forEach((row, i) => {
      const pre = preNoItem[i]
      if (row.fact !== pre.fact) bad(where + ' factsFor(' + key + ', 跨夜) fact 变了：' + pre.fact + ' → ' + row.fact)
      if (row.kind !== pre.kind) bad(where + ' factsFor(' + key + ', 跨夜) kind 变了：' + pre.kind + ' → ' + row.kind)
      if (row.at !== item.at) {
        bad(where + ' factsFor(' + key + ', 跨夜) 行 ' + i + ' 的 at 不是完整 item.at：'
          + JSON.stringify(row.at) + ' vs ' + item.at)
      }
      if (!/^\d{2}:\d{2}$/.test(String(pre.at))) {
        bad(where + ' factsFor(' + key + ', 跨夜) 改前锚点不是 HH:mm：' + JSON.stringify(pre.at))
      }
      crossNightRows += 1
      if (key === 'galaxy') galaxyCrossRows += 1
    })
  })
}

function compareScenario(where, ctx) {
  scenarios += 1
  const a = preSky.summarize(ctx)
  const b = postSky.summarize(ctx)
  const items = compareItems(where, a, b)
  if (!a || !b) return
  /* 事实层与日月数据不属于本轮：逐字节相同 */
  if (JSON.stringify(a.marks) !== JSON.stringify(b.marks)) bad(where + ' marks 变了')
  if (JSON.stringify(a.night) !== JSON.stringify(b.night)) bad(where + ' night 变了')
  if (JSON.stringify(a.sun) !== JSON.stringify(b.sun) || JSON.stringify(a.moon) !== JSON.stringify(b.moon)) {
    bad(where + ' 日月数据变了')
  }
  compareFacts(where, ctx.date, items, b, {
    detail: ctx.detail, days: ctx.days, elevation: ctx.elevation, cloudLevels: ctx.cloudLevels,
  })
}

/* ---------- 28 个真实地点日（4 地点 × 7 天） ---------- */
let realScenarios = 0
Object.keys(snap.places).forEach(placeKey => {
  const place = snap.places[placeKey]
  const days = daysOf(place.series)
  const dates = Array.from(new Set(place.series.map(h => h.d)))
  dates.forEach(date => {
    const detail = place.series.filter(h => h.d === date)
    compareScenario('real:' + placeKey + '/' + date, {
      date, lat: place.wgs[0], lng: place.wgs[1], elevation: place.elevation, elevOK: true,
      detail, series: place.series, cloudLevels: place.cloudLevels, days, heading: null,
    })
    realScenarios += 1
  })
})

/* ---------- 合成跨夜：galaxy 的 best 落在次日 01:00 ----------
   真实 28 天是 10 月（银心午夜前落下），不产生跨夜 best；这条夹具专门行使
   「跨夜证据锚点 = 完整日期」这条路径，并作为空改门。 */
function synthDay(d) {
  const out = []
  for (let h = 0; h < 24; h++) {
    out.push({
      d, t: String(h).padStart(2, '0') + ':00',
      temp: 12, pop: 0, precip: 0, showers: 0, code: 2, wind: 6, rh: 60,
      cloud: { low: 0, mid: 0, high: 0 }, band: null,
    })
  }
  return out
}
const s1 = synthDay('2026-07-15')
const s2 = synthDay('2026-07-16')
s1[22].cloud = { low: 20, mid: 20, high: 20 }
s1[23].cloud = { low: 20, mid: 20, high: 20 }
s2[0].cloud = { low: 10, mid: 10, high: 10 }
const synthSeries = s1.concat(s2)
const synthCtx = {
  date: '2026-07-15', lat: 30.67, lng: 104.07, elevation: 1200, elevOK: true,
  detail: s1, series: synthSeries, days: [], heading: null,
  lightPollution: { bortle: 2, sqm: 21.8 },
}
compareScenario('synth:cross-night', synthCtx)
/* 合成场景自证：galaxy.at 必须真的落在次日，否则空改门是假的 */
const synthOut = postSky.summarize(synthCtx)
const synthGal = synthOut.items.filter(i => i.key === 'galaxy')[0]
if (!synthGal || synthGal.at.slice(0, 10) !== '2026-07-16') {
  bad('synth:cross-night 没造出「galaxy best 在次日」（at=' + (synthGal && synthGal.at) + '）')
}

/* ---------- 输出 ---------- */
console.log('真实场景 ' + realScenarios + '（4 地点 × 7 天）+ 合成跨夜 1 = ' + scenarios)
console.log('结论项：at 非空 ' + atNonEmpty + ' / 六项 × 场景 = ' + (scenarios * 6))
console.log('factsFor 跨夜锚点：item ' + crossNightItems + ' 个 / 证据行 ' + crossNightRows
  + ' 条从 HH:mm 变为完整日期（其中 galaxy ' + galaxyCrossRows + ' 条）')
console.log('阳性对照（factsFor 带 item 仍逐字节相同）：' + positives + ' 组')
console.log('越界：' + overreach)
if (notes.length) notes.forEach(n => console.log('  ✗ ' + n))

let exit = 0
if (overreach > 0) { console.log('FAIL：存在越界差异'); exit = 1 }
if (crossNightRows === 0) { console.log('FAIL：空改——没有任何跨夜证据锚点发生变化'); exit = 1 }
if (galaxyCrossRows === 0) { console.log('FAIL：空改——跨夜 galaxy 锚点一次都没变（本条是计划点名的空改门）'); exit = 1 }
if (positives === 0) { console.log('FAIL：没有阳性对照——非跨夜 factsFor 全在变'); exit = 1 }
if (exit === 0) {
  console.log('PASS：差异只落在允许清单内（六项各新增 at；跨夜 star/galaxy 证据行的 at 变完整日期），其余逐字节相同')
}
process.exit(exit)
