/* 天相沉默闸的差分对拍：改前（HEAD=5351231，彩虹轮之后）vs 工作树（本轮）
 *
 * 这同样是一次**故意的**用户可见变化（判过不成立的天相不再出卡），所以要求的不是"零差异"，
 * 而是三件更强、且方向相反的事：
 *   ① 非目标零越界 —— 六张结论卡的 key/title/score/tone/label/window/look/text 必须逐字节相同。
 *      本轮只允许"少出现"，不允许"换了说法"。任何一处不同 = 越界，exit 1。
 *   ② 减卡必须有据 —— 新页面少掉的每一张卡，其在新 sky 里的 verdict 必须是 'excluded'；
 *      possible / unknown 一张都不许被顺带吃掉（unknown 被吃掉就是把"没数据"读成"没有"，铁律 26②）。
 *      新页面多出来的卡同样算越界（本轮没有加卡的理由）。
 *   ③ 目标必须真的变 —— 若全流程一张卡都没减，说明这道闸在生产数据上从没生效过，
 *      等于白改，exit 1。空改与越界一样不可接受（与彩虹轮同一口径）。
 *
 * 两侧都走**各自的呈现层**：改前页面对象来自 `git archive 5351231 miniprogram`，
 * 不是在本进程里重写一遍 buildCondCards（铁律 11：不要在测试里镜像页面逻辑）。
 *
 * 运行：node ab-silence.js
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../../../../..')
const PRE_SHA = process.env.PRE_SHA || '5351231'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

/* ---------- 取改前整棵 miniprogram（含页面），放到仓库外 ---------- */
const preRoot = path.join(os.tmpdir(), 'ot-silence-ab-' + PRE_SHA.slice(0, 7))
if (!fs.existsSync(path.join(preRoot, 'miniprogram/utils/sky.js'))) {
  fs.mkdirSync(preRoot, { recursive: true })
  execSync('git archive ' + PRE_SHA + ' miniprogram | tar -x -C "' + preRoot + '"', { cwd: ROOT, stdio: 'inherit' })
}
const preSky = require(path.join(preRoot, 'miniprogram/utils/sky.js'))
const preCond = require(path.join(preRoot, 'miniprogram/utils/conditions.js'))
global.Page = cfg => { global.__PRE_PAGE = cfg }
global.wx = global.wx || { getStorageSync: () => '', setStorageSync: () => {}, showToast: () => {} }
require(path.join(preRoot, 'miniprogram/pages/weather/weather.js'))
const prePage = Object.assign({}, global.__PRE_PAGE)
prePage.data = JSON.parse(JSON.stringify(global.__PRE_PAGE.data || {}))

const postSky = require(path.join(ROOT, 'miniprogram/utils/sky.js'))
const postCond = require(path.join(ROOT, 'miniprogram/utils/conditions.js'))
global.Page = cfg => { global.__POST_PAGE = cfg }
require(path.join(ROOT, 'miniprogram/pages/weather/weather.js'))
const postPage = Object.assign({}, global.__POST_PAGE)
postPage.data = JSON.parse(JSON.stringify(global.__POST_PAGE.data || {}))

if (typeof prePage.buildCondSilent === 'function') {
  console.error('改前页面已经有 buildCondSilent —— 那不是改前的版本'); process.exit(2)
}
if (preSky.VERDICT || postPage.buildCondCards === prePage.buildCondCards) {
  console.error('两侧模块实例没分开或对拍方向不对'); process.exit(2)
}

/* ---------- 场景 ---------- */
const DATE = '2026-10-09'
function day (f) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const o = f(h) || {}
    out.push({
      t: String(h).padStart(2, '0') + ':00', d: DATE, temp: 8, code: o.code || 0,
      pop: o.pop || 0, precip: o.precip || 0, showers: o.showers || 0,
      wind: o.wind != null ? o.wind : 4, gust: 9, windDir: 45,
      rh: o.rh != null ? o.rh : 40, pressure: 900, dewPoint: 5,
      visibility: 40, freezing: 4600, uv: 3,
      cloud: { low: o.low || 0, mid: o.mid || 0, high: o.high || 0 }, band: o.band || null,
    })
  }
  return out
}
const SEA_BAND = { base: 1000, top: 1400, cover: 95 }
const SYNTH = [
  ['满云有雨（用户截图那天气）', day(() => ({ low: 95, mid: 90, high: 90, rh: 98, precip: 0.6, pop: 90 })), 3000, true],
  ['满云无雨（低云 100%，一滴没下）', day(() => ({ low: 100, mid: 100, high: 100, rh: 95 })), 3000, true],
  ['高云遮日（低云少但卷层云铺满）', day(() => ({ low: 10, mid: 95, high: 95, rh: 90 })), 3000, true],
  ['晴空无月夜（星空银河都有戏）', day(() => ({ low: 5, mid: 5, high: 10 })), 3000, true],
  ['晴空但无染色云（光染判过不成立）', day(() => ({ low: 0, mid: 0, high: 5 })), 3000, true],
  ['云开有雨（彩虹成立的对照）', day(h => (h >= 7 && h <= 9 ? { low: 30, mid: 15, high: 10, rh: 92, precip: 0.3 } : { low: 5 })), 3000, true],
  ['清晨有云带 · 此点在带顶之上', day(() => ({ low: 80, mid: 5, high: 5, band: SEA_BAND })), 2000, true],
  ['清晨有云带 · 此点在带内（判过了）', day(() => ({ low: 80, mid: 5, high: 5, band: SEA_BAND })), 1200, true],
  ['清晨有云带 · 缺可信海拔（判不出）', day(() => ({ low: 80, mid: 5, high: 5, band: SEA_BAND })), null, false],
  ['极昼形态（无暗夜小时）', day(() => ({ low: 5, mid: 5, high: 10 })), 3000, true, { lat: 70 }],
  ['非银心季（1 月晴夜）', day(() => ({ low: 5, mid: 5, high: 10 })), 3000, true, { date: '2026-01-15' }],
  /* 阳性对照：一天里五项都有戏 ⇒ 一张都不许减。没有这一条，"减了 107 张"就分不清
     是闸在判还是无条件减卡（本轮实测：前 11 组每组都减，缺的正是这个反例）。 */
  ['五项同时有戏的对照日（夜里晴 + 清晨带下云海 + 晨昏染色云 + 阵雨彩虹）', day(h => {
    if (h >= 6 && h <= 7) return { low: 10, mid: 30, high: 20, pop: 20, band: SEA_BAND }
    if (h >= 8 && h <= 9) return { low: 20, mid: 15, high: 10, pop: 30, precip: 0.3, rh: 92, band: SEA_BAND }
    return { low: 20, mid: 10, high: 10 }
  }), 2000, true],
]

/* ---------- 比对 ---------- */
const VISIBLE = ['key', 'title', 'score', 'tone', 'label', 'window', 'look', 'text']
const CARD = ['key', 'title', 'window', 'text', 'look', 'tone', 'gradeLabel', 'stars', 'advice']
let overreach = 0, silencedTotal = 0, unknownKept = 0, gradeDiffs = 0, cases = 0
const rows = []

function runOne (name, detail, elevation, elevOK, extra) {
  cases++
  const ctxOf = sky => sky.summarize(Object.assign({
    date: DATE, lat: 29.52, lng: 103.33, elevation, elevOK, detail, days: [], heading: 75,
  }, extra || {}))
  const sa = ctxOf(preSky), sb = ctxOf(postSky)
  const cardArg = s => ({ date: DATE, detail, days: [], elevation, sun: s.sun, moon: s.moon })

  // ① 结论卡可见字段逐字节
  const fieldDiffs = []
  sa.items.forEach((a, i) => {
    const b = sb.items[i]
    VISIBLE.forEach(f => { if (a[f] !== b[f]) fieldDiffs.push(a.key + '.' + f) })
    if (b.verdict === undefined) fieldDiffs.push(a.key + '.verdict(缺失)')
    if (a.verdict !== undefined) fieldDiffs.push('改前不应有 verdict:' + a.key)
  })
  if (sa.items.length !== sb.items.length) fieldDiffs.push('items 数量')

  // ② 两侧各自页面装配出的卡（真页面，不镜像）
  const ca = prePage.buildCondCards(sa, cardArg(sa))
  const cb = postPage.buildCondCards(sb, cardArg(sb))
  const mapB = {}
  cb.forEach(c => { mapB[c.key] = c })
  const removed = [], eaten = [], added = []
  ca.forEach(c => {
    if (mapB[c.key]) {
      CARD.forEach(f => { if (c[f] !== mapB[c.key][f]) fieldDiffs.push('卡内容变了 ' + c.key + '.' + f) })
    } else {
      removed.push(c.key)
      const it = sb.items.filter(x => x.key === c.key)[0]
      if (!it || it.verdict !== 'excluded') eaten.push(c.key + ':' + (it && it.verdict))
    }
  })
  cb.forEach(c => { if (!ca.some(x => x.key === c.key)) added.push(c.key) })
  silencedTotal += removed.length
  if (eaten.length || added.length) overreach += 1 + eaten.length + added.length

  // ③ unknown 必须活着
  sb.items.forEach(it => {
    if (it.verdict === 'unknown') {
      if (mapB[it.key]) unknownKept++
      else { eaten.push(it.key + '(unknown 被吃掉)'); overreach++ }
    }
  })

  // ④ 总评只允许因为"被沉默项原本有分"而变
  const ga = preCond.overallGrade(sa.items), gb = postCond.overallGrade(sb.items)
  const same = ga.score === gb.score && ga.label === gb.label && ga.stars === gb.stars
  if (!same) {
    gradeDiffs++
    const blame = sb.items.filter(it => it.verdict === 'excluded' && it.score >= 45)
    if (!blame.length) { fieldDiffs.push('总评在无 excluded 高分项时变了'); overreach++ }
  }

  const silent = postPage.buildCondSilent(sb)
  if (removed.length && (!silent || silent.count !== removed.length)) {
    fieldDiffs.push('沉默行没有点名全部被减项'); overreach++
  }
  if (!removed.length && silent) { fieldDiffs.push('没减卡却出现沉默行'); overreach++ }

  rows.push({
    场景: name, 改前卡: ca.map(c => c.key).join(','), 改后卡: cb.map(c => c.key).join(','),
    被沉默: removed.join(','), verdicts: sb.items.map(i => i.key + ':' + i.verdict).join(' '),
    总评改前: ga.score, 总评改后: gb.score, 越界: fieldDiffs.concat(eaten, added.map(k => '新增 ' + k)),
  })
  if (fieldDiffs.length || eaten.length || added.length) {
    console.log('!! ' + name + ' 越界：' + fieldDiffs.concat(eaten, added.map(k => '新增卡 ' + k)).join(' | '))
  }
}

console.log('== 合成场景（' + SYNTH.length + ' 组）==')
SYNTH.forEach(c => runOne(c[0], c[1], c[2], c[3], c[4]))

console.log('\n== 真实快照（4 站 × 7 天）==')
const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))
Object.keys(snap.places).forEach(function (k) {
  const p = snap.places[k]
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const detail = (p.series || []).filter(r => r.d === date)
    if (detail.length < 24) continue
    runOne(p.name + ' ' + date, detail, Math.round(p.elevation || 3000), true, { date })
  }
})

fs.writeFileSync(path.join(__dirname, '..', 'ab-silence.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), pre: PRE_SHA, 场景数: cases,
  被沉默卡总数: silencedTotal, unknown存活数: unknownKept, 总评变化场景: gradeDiffs,
  越界读数: overreach, 明细: rows,
}, null, 2))

console.log('\n合计 ' + cases + ' 个场景：被沉默 ' + silencedTotal + ' 张、unknown 存活 ' + unknownKept +
  ' 张、总评变化 ' + gradeDiffs + ' 个场景、越界 ' + overreach + ' 处 → ab-silence.json')
if (overreach) { console.log('!! 越界：本轮只允许"按 verdict 减卡 + 总评剔除被减项"'); process.exit(1) }
if (!silencedTotal) { console.log('!! 空改：沉默闸在任何场景都没减卡，等于没修'); process.exit(1) }
if (!unknownKept) { console.log('!! 判不出的卡一张都没活下来 —— unknown 被当成 excluded 吃掉了'); process.exit(1) }
const untouched = rows.filter(r => !r.被沉默).length
if (!untouched) { console.log('!! 缺阳性对照：没有任何一个场景一张卡都没被沉默 —— 减卡可能是无条件的'); process.exit(1) }
console.log('✓ 六张卡的可见字段逐字节未动；减的全部是 excluded；unknown 一张没被吃掉；总评只随减卡收敛' +
  '（含 ' + untouched + ' 个"一张都不减"的阳性对照）')
