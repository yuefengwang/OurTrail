/* F7（C6：彩虹太阳下限 + 反日无雨封 44）的差分对拍：改前快照 vs c7 冻结快照
 *
 * ── 基线从哪来 ────────────────────────────────────────────────────────
 * 改前 = `D:/ot-baselines/c6/`（post-C5/pre-C6 快照），改后 = `D:/ot-baselines/c7/`
 * （post-C6 冻结快照）。**改后侧不再是工作树**：C7 起工作树会继续演进（跨夜日程/OI），
 * 本对拍证明的是 C6 自己的 delta，所以两侧都必须冻结；否则 C7 的合法改动会把 C6 的
 * 对拍逼出假红——这正是 C5 冻结改后侧时留下的先例。
 * 两侧被改文件的 md5 写死在本文件里，缺失或哈希不符一律 exit 2（INVALID harness）——
 * **不是通过**。两侧各自 require 各自的模块实例（pre 的 conditions 会 require pre 的 sky），
 * 并断言实例确实不同。
 * C6 只改 `sky.js` 与 `astro.js`（新增导出），不改 `conditions.js`：改后侧 conditions 的
 * md5 必须仍等于改前，否则「两侧各走自己的总评」就不再是在比同一份实现，先停下报告。
 * 改后 astro 必须真的导出 `SUN_HORIZON` 与 `horizonDip`——这是 C6 接缝生效的最小证据。
 *
 * ── 生产口径（第二轮修正）─────────────────────────────────────────────
 * 彩虹太阳下限 = **视地平线** `A.SUN_HORIZON - A.horizonDip(elevation)`，与 sunTimes 的
 * 日出日落同源（蒙气差 -0.833° + 观察点几何俯角）。第一轮只用了 SUN_HORIZON，把
 * 峨眉山 3004 m 07:00（-1.770°）与理塘 4058 m 19:00（-1.800°）两个实际可见的标记误删；
 * 本文件因此把「真实删除」从"允许"降级为"必须为空或经物理 oracle 合法"。
 *
 * ── 越界定义（写死；别的一律越界）────────────────────────────────────
 * ① 六项顺序/数量相同；除 rainbow 外五项（light/cloudSea/star/galaxy/alpenglow）逐字节相同；
 *    `sun`/`night`/`moon` 逐字节相同。
 * ② `marks`：其它 key 与其数组逐字节相同（含顺序）；`rainbow` 集合的变化只允许两类：
 *    被删（计 `removedRainbowMarks`）与被增（计 `addedRainbowMarks`）。
 *    **下限收紧 ≠ 只能删**：视地平线 `SUN_HORIZON - horizonDip(elevation)` 在海平面是 -0.833°，
 *    比旧界 -2° 更严；但海拔越高它越低（3004 m = -2.592°），太阳落在 (-2.592, -2] 的那一小时
 *    旧代码不给标记、新代码给——这是同一口径的合法结果，不能判越界。新增小时必须逐条过 ③b。
 * ③ **逐小时物理 oracle（保留/删除）**：对每个 pre 彩虹标记小时 t，用改后 astro 重算太阳高度
 *    `alt` 与视地平线 `newFloor = SUN_HORIZON - horizonDip(elevation)`：
 *      post 删了 t ⇒ 必须 `alt <= newFloor + 1e-9`（删的是地平线下的小时）；
 *      post 留了 t ⇒ 必须 `alt > newFloor - 1e-9`（没有误留地平线下的小时）。
 *    这条 oracle 同时覆盖 28 个真实日与合成场景，专门抓「删错小时」「高海拔误删」。
 * ③b **逐小时物理 oracle（新增）**：旧界写死 `oldFloor = -2`——这是 C6 之前的判据，也就是
 *    本对拍所对照的基线行为；**不从任何模块读**（pre 侧没有这个常量，从别处读它就不是在比旧行为）。
 *    每个新增小时 t 必须 `alt <= oldFloor + 1e-9 && alt > newFloor - 1e-9`，即落在「旧界不给、
 *    新视地平线给」这条只由两个阈值夹出的窄带里，计 `addedAtAltitude`；带外一律越界：
 *    低于新视地平线 ⇒ 新代码本来就不该给标记；高于旧界 ⇒ 这次变化解释不了（不是俯角放宽）。
 * ④ rainbow 的 key/title 不变；其余字段按以下规则：
 *    - 若 post 与 pre 的 rainbow 标记集合完全相同：
 *        · `score` 未变 ⇒ `text/look/at/window/verdict/tone/label` **全部**必须逐字节相同。
 *          （只查 text/look/at/window/verdict 会让真实 28 天的分数被随意改而 A/B 仍 PASS：
 *          标记集合没变时不去比分数，等于默认分数可以随便漂。）
 *        · `score` 变了 ⇒ **只允许 cap44 这一种**：`pre.score > 44 && post.score === 44`、
 *          pre 文案含「反日方向未检出降水」（cap44 的触发条件）、post 的 `tone/label` 等于
 *          `grade(44)`，且其余字段仍逐字节相同。计 `cap44Cases`。别的分数变化一律越界
 *          （真实 28 天没有 spatial ⇒ `directional=false`、文案里没有「未检出降水」，
 *          所以它们必须与 pre 完全一致）。
 *    - 若标记集合变了 ⇒ 允许 text/look/at/window/score/tone/label 变化，但：
 *        post 无标记 ⇒ `verdict==='excluded' && score===0 && at==='' && window==='' && look===''`；
 *        post 有标记 ⇒ `verdict==='possible'`、`at === date + 'T' + 第一个 post 标记小时`、
 *                      `window` 非空且含第一个 post 标记小时、`text` 含 `window`、
 *                      `look` 含「背对太阳」与「仰角约」；
 *      分数方向：**有新增标记**时允许 `post.score > pre.score`（新增的彩虹小时本身贡献分数）；
 *      没有新增时仍要求 `post.score <= pre.score`（更严的下限与封顶只能降分，不能升）。
 *    - 其它（key/title 变、没有新增却分数升高、新增落在 ③b 窄带之外）⇒ 越界。
 *    - 所有场景的 `tone/label` 都必须与改后 `grade(score)` 自洽（不只 cap44 分支）。
 * ④b 文案语义（不再只做包含式检查——`window + ' 没有彩虹'` 旧判据会 PASS）：
 *    post 有标记 ⇒ text 含「彩虹」，且含三种湿源措辞之一（反日方向有降水信号 /
 *                  反日方向未检出降水 / 有降水或高湿），且**不得**含「没有彩虹」；
 *    post 无标记 ⇒ text 含「彩虹」与「概率很低」，且不得含「没有彩虹」。
 * ⑤ 字段集合：rainbow 的 `Object.keys` 集合必须与改前完全相同（不加/不减字段）。
 * ⑥ 逐场景预期分数（合成场景按 id 写死）：sea-level 60、altitude-positive 90、
 *    altitude-add 80、dusk 80、dry1h 44、dry3h 44、wet1h 80、wet3h 100、
 *    terrainBlockedDry 35、no-rain-clear 0。
 * ⑦ **有湿逐场景不封顶**：每个 `sc.wet === true` 且 post 仍有标记的场景都要 `score > 44`
 *    —— 只报全局 `wetUncapped>0` 会被"错封一个、别的撑着"骗过去。
 *    真实场景的 `wet` 不再硬编码 false，而是 `isWetDetail(detail)`（任一小时
 *    `precip > 0.05 || showers > 0.05 || (rh != null && rh >= 88)`，与 `hourMarks` 的
 *    wet 判据同源）；否则"真实湿日被 cap44"永远不会被发现。合成场景保留声明的 `wet`，
 *    但无 spatial 的场景里声明值必须与数据一致（有 spatial 时反日方位读数才是有湿与否的判据）。
 * ⑧ 总评：若 items 逐字节相同则总评必须相同；若总评不同则 rainbow.score 必须不同。
 *    另报 `overallUp`/`overallDown`，**不判红**（C4 的 live 池可能让总分反向）。
 *
 * ── 空改门与阳性对照（任一为 0 ⇒ exit 1）─────────────────────────────
 *   - synthRemoved > 0（合成场景确实删过标记）；
 *   - addedAtAltitude > 0（合成场景确实新增过高海拔标记：旧界 -2° 不给、新视地平线给）；
 *   - cap44Cases > 0（至少一个反日无湿从 >44 封到 44）；
 *   - retainedRainbowMarks > 0（彩虹标记没有全没）；
 *   - wetUncapped > 0（有湿场景仍 >44）；
 *   - unchangedWithMarks > 0（至少一个**有标记**场景 rainbow 整对象逐字节相同）；
 *   - unchangedScenarios > 0（正对照，允许包含零标记日）；
 *   - altitudePositive > 0（1200 m 正对照：08:00 保留且 rainbow 整对象相同）；
 *   - realUnchanged === realStats.days（真实 28 天必须**全部**与改前逐字节相同：
 *     无删除、无 cap44、无分数漂移。`unchangedWithMarks > 0` 只证明"至少有一个没变"，
 *     合成场景撑着时真实侧全变也会 PASS，所以"真实没被乱改"必须单独成立。）
 *   `realRemoved` 只报告（不是硬门），但每一条都必须通过物理 oracle；不为 0 时打印明细。
 *   真实 28 天删除为 0 的**直接原因**是没有任何真实标记落在旧界 -2° 与新视地平线之间：
 *   成都 489 m 的两个标记在 16:00/17:00（太阳 30.2°/18.7°，离阈值 >20°），
 *   峨眉山 3004 m 的 07:00（-1.77°）与理塘 4058 m 的 19:00（-1.80°）本来就高于旧界 -2°。
 *   旧措辞「站点海拔高、视地平线更低」不成立：成都 489 m 的新视地平线是 -1.543°，
 *   比旧界更严，它没有删除只是因为标记离阈值很远（海拔高低不能代替逐小时判定）。
 *
 * 运行：node tools/ab-rainbow.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const PRE_ROOT = process.env.PRE_ROOT || path.join('D:', 'ot-baselines', 'c6')
const POST_ROOT = process.env.POST_ROOT || path.join('D:', 'ot-baselines', 'c7')
const PRE_SKY_MD5 = '32cee738972170a8839ffffd9b1b9392'
const PRE_COND_MD5 = 'db4b3d938902898a178cd470c1f9b8ea'
const PRE_ASTRO_MD5 = 'f93730c5924b79aadddb0b4bfb86e86d'
const POST_SKY_MD5 = '69c570571becd1499e4ad39842e9996c'
const POST_COND_MD5 = 'db4b3d938902898a178cd470c1f9b8ea'
const POST_ASTRO_MD5 = 'b86ddb5b5daef43fce14f0b6391f8928'
const REAL_MD5 = 'e2783f7b135c0b485fcccdf74352ef67'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

function invalid(msg) {
  console.error('INVALID：' + msg)
  process.exit(2)
}

const preSkyPath = path.join(PRE_ROOT, 'miniprogram/utils/sky.js')
const preCondPath = path.join(PRE_ROOT, 'miniprogram/utils/conditions.js')
const preAstroPath = path.join(PRE_ROOT, 'miniprogram/utils/astro.js')
if (!fs.existsSync(preSkyPath) || !fs.existsSync(preCondPath) || !fs.existsSync(preAstroPath)) {
  invalid('改前快照不可达 ' + PRE_ROOT + '（缺 utils/sky.js / conditions.js / astro.js）')
}
if (md5(preSkyPath) !== PRE_SKY_MD5) {
  invalid('改前快照 sky.js 的 md5 不符（期望 ' + PRE_SKY_MD5 + '，实得 ' + md5(preSkyPath) + '）')
}
if (md5(preCondPath) !== PRE_COND_MD5) {
  invalid('改前快照 conditions.js 的 md5 不符（期望 ' + PRE_COND_MD5 + '，实得 ' + md5(preCondPath) + '）')
}
if (md5(preAstroPath) !== PRE_ASTRO_MD5) {
  invalid('改前快照 astro.js 的 md5 不符（期望 ' + PRE_ASTRO_MD5 + '，实得 ' + md5(preAstroPath) + '）')
}

const postSkyPath = path.join(POST_ROOT, 'miniprogram/utils/sky.js')
const postCondPath = path.join(POST_ROOT, 'miniprogram/utils/conditions.js')
const postAstroPath = path.join(POST_ROOT, 'miniprogram/utils/astro.js')
if (!fs.existsSync(postSkyPath) || !fs.existsSync(postCondPath) || !fs.existsSync(postAstroPath)) {
  invalid('改后侧不可达 ' + POST_ROOT + '（缺 utils/sky.js / conditions.js / astro.js）')
}
if (md5(postSkyPath) !== POST_SKY_MD5) {
  invalid('改后快照 sky.js 的 md5 不符（期望 ' + POST_SKY_MD5 + '，实得 ' + md5(postSkyPath)
    + '）——改后侧必须是 c7 冻结快照，不是工作树')
}
/* C6 不改 conditions.js：改后侧必须与改前的 conditions 逐字节相同。 */
if (md5(postCondPath) !== POST_COND_MD5) {
  invalid('改后 conditions.js md5 不符（期望 ' + POST_COND_MD5 + '，实得 ' + md5(postCondPath)
    + '）——C6 不改该文件，先停并报告')
}
if (md5(postAstroPath) !== POST_ASTRO_MD5) {
  invalid('改后快照 astro.js 的 md5 不符（期望 ' + POST_ASTRO_MD5 + '，实得 ' + md5(postAstroPath)
    + '）——C6 固定了 astro 的 SUN_HORIZON 接缝')
}
if (!fs.existsSync(REAL)) invalid('真实快照不可达 ' + REAL)
if (md5(REAL) !== REAL_MD5) invalid('真实快照 md5 不符（期望 ' + REAL_MD5 + '，实得 ' + md5(REAL) + '）')

const preSky = require(preSkyPath)
const preCond = require(preCondPath)
const preAstro = require(preAstroPath)
const postSky = require(postSkyPath)
const postCond = require(postCondPath)
const postAstro = require(postAstroPath)
if (preSky === postSky || preCond === postCond || preAstro === postAstro) {
  invalid('两侧模块实例没分开（require 缓存被复用）')
}
/* 改后 astro 必须真的导出 SUN_HORIZON / horizonDip（改前都没有）。 */
if (typeof postAstro.SUN_HORIZON !== 'number') {
  invalid('改后 astro 没有导出 SUN_HORIZON（C6 的接缝没生效）')
}
if (typeof postAstro.horizonDip !== 'function') {
  invalid('改后 astro 没有导出 horizonDip（俯角接缝没生效）')
}
if (preAstro.SUN_HORIZON !== undefined) {
  invalid('改前 astro 已导出 SUN_HORIZON——基线不是 pre-C6，先停并报告')
}
/* horizonDip 在 pre-C6 就已导出（日出入/摄影窗口一直在用），C6 新增的只有 SUN_HORIZON。 */
if (postAstro.SUN_HORIZON !== -0.833) {
  invalid('改后 SUN_HORIZON 不是 -0.833（实得 ' + postAstro.SUN_HORIZON + '）——复用常量被改了值')
}
if (postAstro.horizonDip(0) !== 0) {
  invalid('改后 horizonDip(0) 不是 0（实得 ' + postAstro.horizonDip(0) + '）——海平面口径被改了')
}

const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))

let scenarios = 0
let realRemoved = 0
let synthRemoved = 0
let removedRainbowMarks = 0
let addedRainbowMarks = 0
let addedAtAltitude = 0
let cap44Cases = 0
let retainedRainbowMarks = 0
let wetUncapped = 0
let unchangedScenarios = 0
let unchangedWithMarks = 0
let altitudePositive = 0
let overallChanges = 0
let overallUp = 0
let overallDown = 0
let oracleChecked = 0
let overreach = 0
/* 真实场景的「整对象逐字节相同」单独计数：它是硬门（realUnchanged === 真实场景数），
   `unchangedWithMarks` 只证明"至少一个没变"，合成场景可以撑住它。 */
let realUnchanged = 0
let realWetDays = 0
const notes = []
const realStats = { days: 0, removed: 0, added: 0, cap44: 0, unchanged: 0, unchangedMarks: 0, oracle: 0 }
const synthStats = { days: 0, removed: 0, added: 0, cap44: 0, unchanged: 0, unchangedMarks: 0, oracle: 0 }
const realRemovedDetail = []

function bad(msg) {
  overreach += 1
  if (notes.length < 40) notes.push(msg)
}

function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

const byKey = (res, key) => (res.items || []).filter(i => i.key === key)[0]
const marksOf = res => Object.keys(res.marks || {}).filter(t => (res.marks[t] || []).indexOf('rainbow') !== -1)

/* 「这一天有湿」的唯一判据，与 `sky.hourMarks` 的 wet 表达式同源：
   `c.precip > 0.05 || c.showers > 0.05 || (c.rh != null && c.rh >= 88)`。
   必须只认真正的数字：`Number(null) === 0` 会把「没有读数」读成「0 毫米 = 不湿」
   （铁律 34⑤ 的反面：缺读数不能混成有利事实，也不能混成否定事实）。 */
function isWetDetail(detail) {
  return (detail || []).some(h => {
    const precip = Number(h.precip)
    const showers = Number(h.showers)
    const rh = h.rh == null ? null : Number(h.rh)
    return (Number.isFinite(precip) && precip > 0.05)
      || (Number.isFinite(showers) && showers > 0.05)
      || (rh != null && Number.isFinite(rh) && rh >= 88)
  })
}

function day(dateStr, wetAt) {
  const wet = {}
  ;(wetAt || []).forEach(h => { wet[h] = true })
  const out = []
  for (let h = 0; h < 24; h++) {
    out.push({
      t: String(h).padStart(2, '0') + ':00',
      d: dateStr,
      temp: 18,
      pop: 0,
      precip: wet[h] ? 0.2 : 0,
      showers: 0,
      code: 2,
      wind: 8,
      rh: wet[h] ? 90 : 70,
      visibility: 20,
      freezing: 4000,
      uv: 5,
      cloud: { low: 0, mid: 0, high: 0 },
      band: null,
    })
  }
  return out
}

function spatialFor(dateStr, vals) {
  const times = []
  for (let h = 0; h < 24; h++) times.push(dateStr + 'T' + String(h).padStart(2, '0') + ':00')
  return {
    times,
    hours: times.map(t => t.slice(11, 16)),
    byAzimuth: [0, 45, 90, 135, 180, 225, 270, 315].map(az => ({
      azimuth: az,
      low: times.map(() => 0),
      mid: times.map(() => 0),
      high: times.map(() => 0),
      precip: times.map(() => vals.precip),
      pop: times.map(() => vals.pop),
    })),
  }
}

function terrainAll(angle, distance, elevation) {
  const horizon = []
  for (let a = 0; a < 360; a += 22.5) horizon.push({ azimuth: a, angle, distance, elevation })
  return { horizon, openness: angle < 1 ? 1 : 0 }
}

/* ---------- 场景 ---------- */

const SCENARIOS = []

function daysOf(series) {
  const map = {}
  ;(series || []).forEach(h => {
    if (!map[h.d]) map[h.d] = { date: h.d, precipSum: 0 }
    map[h.d].precipSum += Number(h.precip) || 0
  })
  return Object.keys(map).sort().map(k => map[k])
}

/* 真实 28 天：4 地点 × 7 天，ctx 与 ab-overall 相同（无 terrain/spatial、heading:null） */
Object.keys(snap.places).forEach(placeKey => {
  const place = snap.places[placeKey]
  const days = daysOf(place.series)
  const dates = Array.from(new Set(place.series.map(h => h.d)))
  dates.forEach(date => {
    const detail = place.series.filter(h => h.d === date)
    SCENARIOS.push({
      id: 'real:' + placeKey + '/' + date,
      kind: 'real',
      wet: isWetDetail(detail),
      ctx: {
        date, lat: place.wgs[0], lng: place.wgs[1], elevation: place.elevation, elevOK: true,
        detail, series: place.series,
        cloudLevels: place.cloudLevels, days, heading: null,
      },
    })
  })
})

const SYNTH = [
  /* 海平面：2026-01-15 08:00 太阳 -1.11°，低于视地平线 -0.833° ⇒ 改后只剩 12:00（90→60）。
     改前旧界 -2° 会保留 08:00 与 12:00（90）。 */
  { id: 'sun-band-sea-level', date: '2026-01-15', wetAt: [8, 12], wet: true, elevation: 0 },
  /* 1200 m 正对照：同一份数据，视地平线 -1.945° ⇒ 08:00（-1.11°）与 12:00 都保留，
     rainbow 整对象逐字节相同（90）。第一轮漏掉俯角时这里会误删 08:00。 */
  { id: 'sun-band-altitude-positive', date: '2026-01-15', wetAt: [8, 12], wet: true, elevation: 1200 },
  /* 高海拔**新增**正对照：2026-02-16 19:00 太阳 -2.53°，旧界 -2° 不给标记（pre excluded 0），
     3004 m 视地平线 -2.592° 给（post 19:00 → 80）。它是「下限收紧 ≠ 只能删」的唯一合成样本。 */
  { id: 'sun-band-altitude-add', date: '2026-02-16', wetAt: [19], wet: true, elevation: 3004 },
  /* 黄昏正对照：太阳恰为 0° 仍在地平线上 ⇒ 两边都保留 18:00（80）。 */
  { id: 'sun-band-dusk-positive', date: '2026-12-15', wetAt: [18], wet: true, elevation: 1200 },
  { id: 'dry1h', date: '2026-07-15', wetAt: [7], spatial: { precip: 0, pop: 0 } },
  { id: 'dry3h', date: '2026-07-15', wetAt: [7, 8, 9], spatial: { precip: 0, pop: 0 } },
  { id: 'wet1h', date: '2026-07-15', wetAt: [7], spatial: { precip: 0.5, pop: 80 }, wet: true },
  { id: 'wet3h', date: '2026-07-15', wetAt: [7, 8, 9], spatial: { precip: 0.5, pop: 80 }, wet: true },
  {
    id: 'terrainBlockedDry', date: '2026-07-15', wetAt: [7], spatial: { precip: 0, pop: 0 },
    terrain: terrainAll(10, 10, 3000),
  },
  { id: 'no-rain-clear', date: '2026-07-15', wetAt: [] },
]
/* 合成场景的改后期望分数（写死；不是"数个数"） */
const EXPECTED_SCORE = {
  'synth:sun-band-sea-level': 60,
  'synth:sun-band-altitude-positive': 90,
  'synth:sun-band-altitude-add': 80,
  'synth:sun-band-dusk-positive': 80,
  'synth:dry1h': 44,
  'synth:dry3h': 44,
  'synth:wet1h': 80,
  'synth:wet3h': 100,
  'synth:terrainBlockedDry': 35,
  'synth:no-rain-clear': 0,
}
SYNTH.forEach(s => {
  const extra = { date: s.date, detail: day(s.date, s.wetAt), days: [], heading: 90 }
  if (s.spatial) extra.spatial = spatialFor(s.date, s.spatial)
  if (s.terrain) extra.terrain = s.terrain
  SCENARIOS.push({
    id: 'synth:' + s.id,
    kind: 'synth',
    wet: !!s.wet,
    ctx: Object.assign({ lat: 30.67, lng: 104.07, elevation: 1200, elevOK: true }, extra,
      { elevation: s.elevation == null ? 1200 : s.elevation }),
  })
})

/* ---------- 对拍 ---------- */

/* 「rainbow 之外的 marks」按**条目**比：过滤掉每个小时里的 rainbow 后，只保留非空的小时。
   某小时若只有 rainbow 一条（例如只有下雨的 08:00），它随彩虹一起消失是合法的，
   不能把「这个小时键不存在了」误读成别的标记变了。 */
function nonRainbowMarks(res) {
  const out = {}
  Object.keys(res.marks || {}).forEach(t => {
    const arr = (res.marks[t] || []).filter(k => k !== 'rainbow')
    if (arr.length) out[t] = arr
  })
  return out
}

function sameOtherMarks(a, b) {
  return JSON.stringify(nonRainbowMarks(a)) === JSON.stringify(nonRainbowMarks(b))
}

SCENARIOS.forEach(sc => {
  scenarios += 1
  const bucket = sc.kind === 'real' ? realStats : synthStats
  bucket.days += 1
  const a = preSky.summarize(sc.ctx)
  const b = postSky.summarize(sc.ctx)
  if (!a || !b) { bad(sc.id + '：summarize 返回 null'); return }

  /* ① items 顺序/集合；除 rainbow 外五项；sun/night/moon */
  const keySeq = res => (res.items || []).map(i => i.key).join(',')
  if (a.items.length !== b.items.length) bad(sc.id + '：items.length ' + a.items.length + '→' + b.items.length)
  if (keySeq(a) !== keySeq(b)) bad(sc.id + '：items 键序/集合变了（' + keySeq(a) + ' → ' + keySeq(b) + '）')
  if (JSON.stringify(a.sun) !== JSON.stringify(b.sun)) bad(sc.id + '：sun 变了')
  if (JSON.stringify(a.night) !== JSON.stringify(b.night)) bad(sc.id + '：night 变了')
  if (JSON.stringify(a.moon) !== JSON.stringify(b.moon)) bad(sc.id + '：moon 变了')
  ;['light', 'cloudSea', 'star', 'galaxy', 'alpenglow'].forEach(key => {
    const ai = byKey(a, key)
    const bi = byKey(b, key)
    if (JSON.stringify(ai) !== JSON.stringify(bi)) bad(sc.id + '：' + key + ' 变了')
  })

  /* ② marks：其它 key 逐字节相同；rainbow 允许删，也允许**高海拔新增**（逐条过 ③b 的 oracle）。
     旧界 -2° 是 C6 之前的判据（本对拍对照的基线行为），写死在这里、不从模块读。 */
  if (!sameOtherMarks(a, b)) bad(sc.id + '：rainbow 之外的 marks 变了')
  const preMarks = marksOf(a)
  const postMarks = marksOf(b)
  const preSet = new Set(preMarks)
  const oldFloor = -2
  const newFloor = postAstro.SUN_HORIZON - postAstro.horizonDip(sc.ctx.elevation)
  const added = postMarks.filter(t => !preSet.has(t))
  addedRainbowMarks += added.length
  if (sc.kind === 'real') realStats.added += added.length
  else synthStats.added += added.length
  added.forEach(t => {
    const alt = postAstro.solarPosition(postAstro.cnToMs(sc.ctx.date, t), sc.ctx.lat, sc.ctx.lng).altitude
    /* 合法新增只可能来自「视地平线随海拔降低」：旧界不给（alt <= -2）、新界给（alt > newFloor）。 */
    if (alt <= oldFloor + 1e-9 && alt > newFloor - 1e-9) {
      addedAtAltitude += 1
    } else {
      bad(sc.id + '：新增 ' + t + '（太阳 ' + alt.toFixed(3) + '°）不在旧界 ' + oldFloor
        + '° 与新视地平线 ' + newFloor.toFixed(3) + '° 之间——超出「高海拔俯角放宽」的解释范围')
    }
  })
  const removed = preMarks.filter(t => postMarks.indexOf(t) === -1)
  if (removed.length) {
    removedRainbowMarks += removed.length
    if (sc.kind === 'real') {
      realRemoved += removed.length
      removed.forEach(t => realRemovedDetail.push(sc.id + ' ' + t))
    } else {
      synthRemoved += removed.length
    }
  }
  retainedRainbowMarks += postMarks.length

  /* ③ 逐小时物理 oracle：删/留都必须与视地平线一致（覆盖真实与合成） */
  preMarks.forEach(t => {
    const alt = postAstro.solarPosition(postAstro.cnToMs(sc.ctx.date, t), sc.ctx.lat, sc.ctx.lng).altitude
    oracleChecked += 1
    bucket.oracle += 1
    const kept = postMarks.indexOf(t) !== -1
    if (!kept && !(alt <= newFloor + 1e-9)) {
      bad(sc.id + '：删除了 ' + t + '，但太阳高度 ' + alt.toFixed(3)
        + '° 仍高于视地平线 ' + newFloor.toFixed(3) + '°（误删）')
    }
    if (kept && !(alt > newFloor - 1e-9)) {
      bad(sc.id + '：保留了 ' + t + '，但太阳高度 ' + alt.toFixed(3)
        + '° 低于视地平线 ' + newFloor.toFixed(3) + '°（误留）')
    }
  })

  const aa = byKey(a, 'rainbow')
  const ba = byKey(b, 'rainbow')
  if (!aa || !ba) { bad(sc.id + '：rainbow 缺失'); return }

  /* ④ key/title/字段集合不变；其余按标记集合是否变化分两套 */
  if (aa.key !== ba.key) bad(sc.id + '：rainbow.key 变了')
  if (aa.title !== ba.title) bad(sc.id + '：rainbow.title 变了')
  if (Object.keys(aa).sort().join(',') !== Object.keys(ba).sort().join(',')) {
    bad(sc.id + '：rainbow 字段集合变了（' + Object.keys(aa).sort().join(',')
      + ' → ' + Object.keys(ba).sort().join(',') + '）')
  }
  const sameMarkSet = preMarks.join(',') === postMarks.join(',')
  if (sameMarkSet) {
    if (aa.score === ba.score) {
      /* 标记集合与分数都没变 ⇒ 其余字段一个字节都不许动。
         旧版只查 text/look/at/window/verdict，于是真实 28 天的 rainbow.score
         可以被任意改（80→60/0）而 A/B 仍 PASS——分数不在被比之列就等于可以随便漂。 */
      ;['text', 'look', 'at', 'window', 'verdict', 'tone', 'label'].forEach(f => {
        if (JSON.stringify(aa[f]) !== JSON.stringify(ba[f])) {
          bad(sc.id + '：标记集合与分数都未变，但 rainbow.' + f + ' 变了')
        }
      })
    } else {
      /* 分数变了只允许 cap44：反日方向明确有读数却无湿小时，文案写「条件不足」⇒
         星级封在「条件较差」上界。其它任何分数变化都是越界。 */
      const g44 = postSky.grade(44)
      const capOk = aa.score > 44 && ba.score === 44
        && String(aa.text).indexOf('反日方向未检出降水') !== -1
        && ba.tone === g44.tone && ba.label === g44.label
      if (!capOk) {
        bad(sc.id + '：标记集合未变，分数 ' + aa.score + '→' + ba.score
          + ' 不是合法的 cap44（要求 pre>44 → 44、pre 文案含「反日方向未检出降水」、'
          + 'tone/label = ' + g44.tone + '/' + g44.label + '）')
      } else {
        cap44Cases += 1
        bucket.cap44 += 1
        ;['text', 'look', 'at', 'window', 'verdict'].forEach(f => {
          if (JSON.stringify(aa[f]) !== JSON.stringify(ba[f])) {
            bad(sc.id + '：cap44 只许改分数与星级，rainbow.' + f + ' 也变了')
          }
        })
      }
    }
  } else {
    if (postMarks.length === 0) {
      if (!(ba.verdict === 'excluded' && ba.score === 0 && ba.at === ''
        && ba.window === '' && ba.look === '')) {
        bad(sc.id + '：标记删空后不是 excluded / 0 分 / at·window·look 全空（'
          + ba.verdict + ' / ' + ba.score + ' / "' + ba.at + '" / "' + ba.window + '" / "' + ba.look + '"）')
      }
    } else {
      if (ba.verdict !== 'possible') bad(sc.id + '：仍有标记但 verdict=' + ba.verdict)
      if (ba.at !== sc.ctx.date + 'T' + postMarks[0]) {
        bad(sc.id + '：rainbow.at=' + ba.at + '，应为 ' + sc.ctx.date + 'T' + postMarks[0])
      }
      if (!ba.window) bad(sc.id + '：仍有标记但 window 为空')
      if (ba.window.indexOf(postMarks[0]) === -1) {
        bad(sc.id + '：rainbow.window="' + ba.window + '" 不含第一个标记 ' + postMarks[0])
      }
      if (String(ba.text).indexOf(ba.window) === -1) {
        bad(sc.id + '：rainbow.text 不含 window（"' + ba.window + '"）')
      }
      if (String(ba.look).indexOf('背对太阳') === -1) bad(sc.id + '：rainbow.look 不含「背对太阳」（' + ba.look + '）')
      if (String(ba.look).indexOf('仰角约') === -1) bad(sc.id + '：rainbow.look 不含「仰角约」（' + ba.look + '）')
    }
  }
  /* ④b 文案语义：只查「含 window / 含彩虹」会被 `window + ' 没有彩虹'` 骗过去。
     有标记时必须说清湿源（三种措辞之一），无标记时必须说「概率很低」；否定短语一律不许。 */
  const postText = String(ba.text)
  if (postMarks.length) {
    const WET_WORDING = ['反日方向有降水信号', '反日方向未检出降水', '有降水或高湿']
    if (WET_WORDING.every(s => postText.indexOf(s) === -1)) {
      bad(sc.id + '：仍有标记，但 rainbow.text 没说清湿源（' + postText + '）')
    }
  } else if (postText.indexOf('概率很低') === -1) {
    bad(sc.id + '：没有标记，但 rainbow.text 不说「概率很低」（' + postText + '）')
  }
  if (postText.indexOf('彩虹') === -1) bad(sc.id + '：rainbow.text 不含「彩虹」（' + postText + '）')
  if (postText.indexOf('没有彩虹') !== -1) bad(sc.id + '：rainbow.text 含否定短语「没有彩虹」（' + postText + '）')
  /* tone/label 必须由改后 grade 给出（全场景，不只 cap44 分支） */
  const gPost = postSky.grade(ba.score)
  if (ba.score !== gPost.score || ba.tone !== gPost.tone || ba.label !== gPost.label) {
    bad(sc.id + '：rainbow 的 score/tone/label 与 grade(score) 不一致（'
      + ba.score + '/' + ba.tone + '/' + ba.label + ' vs '
      + gPost.score + '/' + gPost.tone + '/' + gPost.label + '）')
  }
  /* 分数方向：有新增标记时允许升分（新增的彩虹小时本身可以贡献分数）；
     没有新增时仍只许降分——更严的下限与 cap44 只能压，不能抬。 */
  if (!added.length && ba.score > aa.score) bad(sc.id + '：rainbow 分数升高 ' + aa.score + '→' + ba.score)

  /* ⑤ 逐场景预期分数（合成场景按 id 写死） */
  if (EXPECTED_SCORE[sc.id] != null && ba.score !== EXPECTED_SCORE[sc.id]) {
    bad(sc.id + '：rainbow.score=' + ba.score + '，预期 ' + EXPECTED_SCORE[sc.id])
  }

  /* ⑥ 场景专属的标记集合/分数（把「海平面删 08:00」「1200 m 保留 08:00」钉死） */
  if (sc.id === 'synth:sun-band-sea-level') {
    if (preMarks.join(',') !== '08:00,12:00') bad(sc.id + '：改前标记应为 08:00,12:00（实得 ' + preMarks.join(',') + '）')
    if (postMarks.join(',') !== '12:00') bad(sc.id + '：改后标记应只剩 12:00（实得 ' + postMarks.join(',') + '）')
    if (aa.score !== 90) bad(sc.id + '：改前分数应为 90（实得 ' + aa.score + '）')
  }
  if (sc.id === 'synth:sun-band-altitude-positive') {
    if (postMarks.join(',') !== '08:00,12:00') {
      bad(sc.id + '：1200 m 应保留 08:00,12:00（实得 ' + postMarks.join(',') + '）——高海拔被误删')
    }
    const byteSame = JSON.stringify(aa) === JSON.stringify(ba)
    if (!byteSame) bad(sc.id + '：1200 m 的 rainbow 整对象应逐字节相同（第一轮在此误删 08:00）')
    if (byteSame && postMarks.length && ba.score === 90) altitudePositive += 1
  }
  /* 高海拔新增：旧界 -2° 下 19:00（-2.53°）不给标记；3004 m 视地平线 -2.592° 给。
     反过来把新界退回 -2（M1）或钳低俯角（M13）⇒ 这里新增消失，硬门 addedAtAltitude>0 变红。 */
  if (sc.id === 'synth:sun-band-altitude-add') {
    if (preMarks.length !== 0) bad(sc.id + '：改前应无彩虹标记（实得 ' + preMarks.join(',') + '）')
    if (aa.score !== 0 || aa.verdict !== 'excluded') {
      bad(sc.id + '：改前应是 excluded / 0 分（实得 ' + aa.verdict + ' / ' + aa.score + '）')
    }
    if (postMarks.join(',') !== '19:00') {
      bad(sc.id + '：改后应新增 19:00（实得 ' + postMarks.join(',') + '）——高海拔新增没发生')
    }
    if (ba.score !== 80) bad(sc.id + '：改后分数应为 80（实得 ' + ba.score + '）')
  }

  /* ⑦ 读数：有湿逐场景不封顶 / 正对照（cap44 计数已在 ④ 的分支里完成，避免一处变化两次记账） */
  if (sc.kind === 'real' && sc.wet) realWetDays += 1
  /* 合成场景的 `wet` 是声明值。没有 spatial 时 detail 是唯一湿度来源 ⇒ 声明与数据必须一致；
     有 spatial 时反日方位的降水/概率才是有湿与否的判据（terrainBlockedDry 的 detail 带一个
     湿小时只为让彩虹标记成立，而反日方向 0 降水/0 概率 ⇒ 声明 dry 是对的）。 */
  if (sc.kind === 'synth' && !sc.ctx.spatial && sc.wet !== isWetDetail(sc.ctx.detail)) {
    bad(sc.id + '：合成场景声明的 wet=' + sc.wet + ' 与 detail 里的湿读数不符')
  }
  if (sc.wet && postMarks.length && !(ba.score > 44)) {
    bad(sc.id + '：有湿场景仍有标记，却被封到 ' + ba.score + '（≤44）')
  }
  if (sc.wet && postMarks.length && ba.score > 44) wetUncapped += 1
  if (JSON.stringify(aa) === JSON.stringify(ba)) {
    unchangedScenarios += 1
    bucket.unchanged += 1
    if (postMarks.length) {
      unchangedWithMarks += 1
      bucket.unchangedMarks += 1
    }
    if (sc.kind === 'real') realUnchanged += 1
  }

  /* ⑧ 总评：items 相同 ⇒ 总评相同；总评不同 ⇒ rainbow.score 不同；up/down 只登记 */
  const ao = preCond.overallGrade(clone(a.items))
  const bo = postCond.overallGrade(clone(b.items))
  const sameItems = JSON.stringify(a.items) === JSON.stringify(b.items)
  const sameOverall = JSON.stringify(ao) === JSON.stringify(bo)
  if (sameItems && !sameOverall) bad(sc.id + '：items 逐字节相同但总评变了')
  if (!sameOverall) {
    overallChanges += 1
    if (aa.score === ba.score) bad(sc.id + '：总评变了但 rainbow.score 没变')
    if (ao.score != null && bo.score != null) {
      if (bo.score > ao.score) overallUp += 1
      else if (bo.score < ao.score) overallDown += 1
    }
  }
})

/* ---------- 输出 ---------- */
console.log('场景 ' + scenarios + '（真实 ' + realStats.days + ' + 合成 ' + synthStats.days + '）')
console.log('删除彩虹标记：' + removedRainbowMarks + '（真实 ' + realRemoved + ' / 合成 ' + synthRemoved + '）')
console.log('新增彩虹标记（高海拔）：' + addedRainbowMarks
  + '（物理 oracle 合法 ' + addedAtAltitude + '；真实 ' + realStats.added + ' / 合成 ' + synthStats.added + '）')
if (realRemoved === 0) {
  console.log('真实 28 天没有删除标记（直接原因：没有任何真实标记落在旧界 -2° 与新视地平线之间——'
    + '成都 489 m 的两个标记在 16:00/17:00、距阈值 >20°；峨眉山/理塘的低太阳标记本来就高于旧界 -2°。'
    + '合成 sea-level 覆盖删除路径）')
} else {
  console.log('真实删除明细（每条都必须通过物理 oracle）：' + realRemovedDetail.join(' / '))
}
console.log('物理 oracle 覆盖 pre 标记小时：' + oracleChecked
  + '（真实 ' + realStats.oracle + ' / 合成 ' + synthStats.oracle + '）')
console.log('cap44（>44 → 44）：' + cap44Cases + '（真实 ' + realStats.cap44 + ' / 合成 ' + synthStats.cap44 + '）')
console.log('保留彩虹标记：' + retainedRainbowMarks)
console.log('真实 wet 日数（isWetDetail 从数据算）：' + realWetDays + '/' + realStats.days)
console.log('有湿场景仍 >44（逐场景判定，未封顶）：' + wetUncapped)
console.log('1200 m 正对照（08:00 保留且 rainbow 逐字节相同）：' + altitudePositive)
console.log('真实场景 rainbow 整对象逐字节相同（硬门）：' + realUnchanged + '/' + realStats.days)
console.log('rainbow 整对象逐字节相同：' + unchangedScenarios
  + '（真实 ' + realStats.unchanged + ' / 合成 ' + synthStats.unchanged + '）'
  + '，其中**有标记**：' + unchangedWithMarks
  + '（真实 ' + realStats.unchangedMarks + ' / 合成 ' + synthStats.unchangedMarks + '）')
console.log('总评变化：' + overallChanges + '（上升 ' + overallUp + ' / 下降 ' + overallDown + '，只登记不判红）')
console.log('越界：' + overreach)
if (notes.length) notes.forEach(n => console.log('  ✗ ' + n))

let exit = 0
if (overreach > 0) { console.log('FAIL：存在越界差异'); exit = 1 }
if (synthRemoved === 0) { console.log('FAIL：空改——合成场景一处彩虹标记都没被删（下限没生效）'); exit = 1 }
if (addedAtAltitude === 0) {
  console.log('FAIL：空改——没有任何高海拔场景新增彩虹标记（「视地平线随海拔降低」这一半没被验证）')
  exit = 1
}
if (cap44Cases === 0) { console.log('FAIL：空改——没有任何反日无湿场景从 >44 封到 44'); exit = 1 }
if (retainedRainbowMarks === 0) { console.log('FAIL：空改——彩虹标记全没了（把功能关掉不是修复）'); exit = 1 }
if (wetUncapped === 0) { console.log('FAIL：阳性对照缺失——有湿场景全被误封'); exit = 1 }
if (unchangedWithMarks === 0) { console.log('FAIL：阳性对照缺失——没有任何**有标记**场景的 rainbow 整对象逐字节相同'); exit = 1 }
if (unchangedScenarios === 0) { console.log('FAIL：阳性对照缺失——没有任何 rainbow 整对象逐字节相同'); exit = 1 }
if (altitudePositive === 0) { console.log('FAIL：阳性对照缺失——1200 m 的 08:00 没被保留（俯角语义丢失）'); exit = 1 }
if (realUnchanged !== realStats.days) {
  console.log('FAIL：真实场景没有全部与改前逐字节相同（' + realUnchanged + '/' + realStats.days
    + '）——真实 28 天既无删除也不该有 cap44，分数/文案一个字节都不许动；'
    + '若快照本身变了，先更新基线并说明，不要让它静默漂过去')
  exit = 1
}
if (exit === 0) {
  console.log('PASS：差异只落在「视地平线下的彩虹标记被删 + 高海拔新视地平线带来的新增（逐条过物理 oracle）'
    + ' + 反日无雨封 44」，真实/合成逐小时均通过物理 oracle，其余五项/marks/sun/night/moon 逐字节相同')
}
process.exit(exit)
