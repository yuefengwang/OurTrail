/* F4 阶段二（C7：跨夜日程 / OI 24h 保守方案）的差分对拍：改前快照 vs 工作树
 *
 * ── 两侧从哪来 ────────────────────────────────────────────────────────
 * 改前 = `D:/ot-baselines/c7/`（post-C6/pre-C7 冻结快照）。
 * 改后 = **工作树**（默认仓库根；`POST_ROOT` 可覆盖）。C7 的实现目前只在工作树里，
 * 还没有第二个冻结快照，所以本对拍证明的是"c7 快照 → 当前工作树"的 delta；
 * 改后侧不能拿另一个基线冒充，否则证明的对象就不是这次改动。
 *
 * 两侧的 `sky.js` / `conditions.js` / `astro.js` 都必须命中同一组 md5（写死在下面）：
 * C7 只允许改 agenda / outdoor-intelligence / oi-presentation / weather.{js,wxml,wxss}，
 * 一旦有人动了天相输入，本对拍直接 INVALID（exit 2），而不是把输入变化算进跨夜 delta。
 * 两侧各自 require 各自的模块实例（pre 的 OI 会 require pre 的 sky/agenda），并断言实例不同；
 * 另外用四个"基线身份"探针（agenda / OI 各两侧）确认改前侧真的**不消费** nightHours、
 * 改后侧真的消费：否则"零差异"可能只是两侧都还没接上这个特性。
 *
 * 真实快照：docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json
 * （4 地点 × 7 天 = 28 个"地点×日"场景；md5 写死）。
 * 场景细节：`detail = series.filter(h => h.d === date)`；页面级 `marks` 用各侧自己的
 * `sky.hourMarks` **逐日**算（与 weather.js `buildChartMarks` 同形，key 为 `d + 'T' + t`，
 * 这样今晚的次日凌晨也有标记）；`night` 用各侧 `sky.summarize` 的 `night`
 *（`series`、`days: []`、`lightPollution: null`、`heading: null`）。不联网。
 *
 * ── 越界定义（写死；别的一律越界）────────────────────────────────────
 *
 * A. 天相输入零变化
 *    A1 每个场景 pre/post 的 `sky.summarize` 六项 items、`marks`、`night`、`sun`、`moon`
 *       逐字节相同；`photoWindows`（sun/win）也相同。
 *    A2 页面级 `marks`（逐日 hourMarks 合并）pre/post 逐字节相同；真实场景里还要与
 *       summarize 当日 marks 在重叠小时上逐项相同（防止"两张 marks 各说各话"）。
 *       合成场景的 marks 是**注入夹具**（为了让特定小时出现 galaxy/star），本来就不等于
 *       hourMarks 的产出，因此这项一致性只对真实场景成立。
 *    A3 两侧 sky.js / conditions.js / astro.js 的 md5 相同且等于写死的值。
 *    任一不满足 ⇒ `skyInputDiff++` 并计越界。
 *
 * B. Agenda（`buildDayAgenda`）
 *    事件分两类：night = `l2 && (key === 'galaxy' || key === 'star')`，其余为 other。
 *    B1 `other` 逐字节相同，**唯一例外**：标题为「天文暗夜始」的那条事件的 `sub` 允许
 *       null ↔ '银河与深空窗口'；其余字段（t/title/l2…）仍必须相同。
 *       该变化必须能由"今晚序列里有没有 galaxy 标记"解释：
 *         pre.sub null → post 有 ⇒ 今晚序列确有 galaxy 标记（计 subRestored）；
 *         pre.sub 有 → post null ⇒ 今晚序列确实没有 galaxy（计 subRemoved），且今日
 *           detail 里确有 galaxy（否则 pre 本来也不该说）；
 *         其它变化 ⇒ 越界。
 *    B2 post 的 night 事件必须逐条等于**本文件独立实现**的 day-aware 聚类 oracle
 *       （不复用被测的 isNightKey/clustersOf；按 d+t 排序、跨日连续合并、只取 galaxy/star；
 *       起点在次日 ⇒ t='次日 HH:mm'、dayOffset=1；窗口三态：今晚→次日 / 次日 from–to / from–to）。
 *    B3 pre 的 night 事件必须等于**旧口径** oracle：同一份今日 detail 的同日簇（不跨日）、
 *       旧 t/window 格式、无 dayOffset。
 *    B4 排序：post 全部事件的 day-aware 键非递减；任何 `t` 以 '次日 ' 开头的事件必须
 *       `dayOffset === 1`，且排在所有今日事件之后；没有别的字段 dayOffset。
 *    B5 空改门/计数：crossAgenda（post 夜间事件窗口含 '→ 次日'）、nextAgenda（t 以
 *       '次日 ' 开头）、tailRemoved（pre 夜间事件起点 <12:00 且 post 无同 key/同 t）、
 *       agendaUntouched（整份 agenda JSON 相同且两侧都无 night 事件）。
 *       `otherDiff`（B1 归一化后仍不同的场景数）必须为 0。
 *
 * C. OI 24h（`buildOutdoorIntelligence`）
 *    两侧都用同一份 `nightHours`（pre 会忽略）；`cloudField` 用各侧
 *    `weather-cloud-field.buildCloudField({series,cloudLevels},{date,userAltitude})`；
 *    `marks` 用各侧页面级 marks；`days: []`；`terrain/lightPollution: null`。
 *    C1 非夜间窗口（type 不是 STARGAZING/MILKY_WAY）逐字节相同（`oiOtherDiff`）。
 *    C2 post 夜间窗口必须等于独立 oracle：夜序列 day-aware 聚类 + 只取 `fromD === date`，
 *       再用**本文件独立实现**的"被挡"判据（conditions 的今日段 [from,24:00) 内出现
 *       CLOUD_ABOVE/IN_CLOUD 或 holds 含 mid）解释缺失；oracle 期望但 post 缺失且无法用
 *       post conditions 解释 ⇒ 越界。post 多出 oracle 没有的窗口 ⇒ 越界。
 *       合成 blocked-night 专门行使「缺失由 conditions 解释」这条分支（否则它只是死代码）。
 *    C3 pre 夜间窗口必须等于旧口径 oracle（今日 detail 同日簇），过同样的被挡解释。
 *    C4 post 不得出现"纯次日簇"的窗口（oracle 会列出这些簇，`nextDayOnlyLeak` 必须为 0）。
 *    C5 跨零点窗口 `hours.length` 必须等于 oracle 簇的小时数，且小时集合逐项相同
 *       （来自夜序列、含次日小时）；证据必须含 nightLimit 的边界句（"只看云量与月照"）。
 *    C6 `factsFor` 夜段：合成场景"今日高云 90% / 今晚只有 23:00 高云 90%、其余 0"：
 *       post 的「夜段高层云」= 今晚均值 13%，pre（不消费 nightHours）按自然日 = 90%。
 *    C7 空改门：oiCross（post 夜间窗口 to<from）、oiTailRemoved（pre 夜间窗口起点 <12:00
 *       且 post 无同 type/from/to）、oiUntouched（整份 OI JSON 相同且两侧都无夜间窗口）。
 *
 * D. 呈现层（`buildOiCard` / `applySelection` / `buildHorizonOiCard`）
 *    D1 每个 post 跨零点窗口：timeText 以 '今晚 ' 开头且含 ' → 次日 '；fromMin/toMin 与
 *       timeText 同源（to<from）；tapZones 恰好一个区覆盖 [from,24:00)，且**不得**存在旧的
 *       次日段 zone（left=0、width=to/1440*100 的几何）；anchor.endHour===24，
 *       focusHour ∈ [floor(from/60),24)；live 在 nowMin=fromMin+30 为 true、
 *       在 nowMin=toMin+30（次日时钟）为 false；applySelection(card, floor(from/60)) 命中
 *       该条，applySelection(card, floor(to/60)) 不命中该条。
 *    D2 非夜间（STARGAZING/MILKY_WAY 之外）的 item：除新增 fromMin/toMin 外逐字节相同；
 *       非夜间 tapZones 几何逐字节相同。（夜间同日窗口的变化属于本轮允许清单，由 B/C 的
 *       oracle 管；把"前夜尾段被删"当成 item 差异会制造 15 条假红。）
 *       同日夜间窗口若两侧 timeText 相同，则除 summaryText（C6 明确改成今晚证据）与
 *       fromMin/toMin 外，tier/hour/anchor 等呈现字段也必须相同。
 *    D3 itemsSorted：同 rank 内按 fromMin 非递减，primary 全在 secondary 之前；
 *       跨零点条目不得因为 timeText 反解成 -1 而被排到最前。
 *    D4 正向 delta：手工构造 MILKY_WAY from=23:00 / to=04:00 的 OI，分别喂 pre/post
 *       `buildOiCard`：pre 必须 2 个 tapZones（旧的次日段 + 今晚段）、post 必须 1 个，
 *       列表文案仍是"今晚 23:00 → 次日 04:00"。pre 不是 2 ⇒ 基线不是 pre-C7（INVALID）。
 *    D5 Horizon 阳性对照：28 个真实场景，用两侧各自逐日 `buildOutdoorIntelligence`
 *       （**不传 nightHours**）构建 48h 与 72h `buildHorizonOiCard`，逐字节相同；
 *       horizon item 不含 fromMin/toMin。`horizonIdentical` 必须是 28、`horizonDiff` 必须是 0。
 *
 * ── 硬门（任一为 0 / 不满足 ⇒ exit 1）──────────────────────────────
 *   crossAgenda > 0、nextAgenda > 0、tailRemoved >= 15、agendaUntouched >= 3
 *   oiCross >= 8、oiTailRemoved >= 8、oiUntouched >= 5
 *   presentation preZones === 2 && postZones === 1
 *   horizonIdentical === 28 && horizonDiff === 0
 *   otherDiff === 0 && oiOtherDiff === 0 && skyInputDiff === 0
 *   subRestored >= 1、subRemoved >= 1
 *   selectionFromHit === crossCount、selectionToMiss === crossCount
 *   liveFromTrue === crossCount、liveTomorrowFalse === crossCount
 *   anchorBad === 0、timeTextBad === 0、nextDayOnlyLeak === 0
 *   另：factsFor 夜段 post=13% / pre=90%（两条单独的阳性对照）。
 *
 * 退出码：0 全过 / 1 有越界或硬门不满足 / 2 INVALID harness（快照、md5、实例复用、基线身份）。
 * 环境变量：PRE_ROOT / POST_ROOT（默认 c7 快照 / 仓库根；变异脚本可复用）。
 *
 * 运行：node tools/ab-cross-night.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const PRE_ROOT = process.env.PRE_ROOT || path.join('D:', 'ot-baselines', 'c7')
const POST_ROOT = process.env.POST_ROOT || ROOT

/* C7 不容许天相输入变化：两侧都必须等于同一个 md5。 */
const SKY_MD5 = '69c570571becd1499e4ad39842e9996c'
const COND_MD5 = 'db4b3d938902898a178cd470c1f9b8ea'
const ASTRO_MD5 = 'b86ddb5b5daef43fce14f0b6391f8928'
const REAL_MD5 = 'e2783f7b135c0b485fcccdf74352ef67'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

const NIGHT_TITLE = { galaxy: '银河窗口', star: '星空条件' }
const NIGHT_TITLES = { '银河窗口': true, '星空条件': true }
const NIGHT_TYPES = { STARGAZING: true, MILKY_WAY: true }
/* 与 agenda.AGENDA_KEYS 同序，但这是本文件的独立判据（不是 require 出来的）。 */
const PRIMARY_ORDER = ['cloudSea', 'alpenglow', 'rainbow', 'galaxy', 'star']
const DUSK_SUB = '银河与深空窗口'

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

function invalid(msg) {
  console.error('INVALID：' + msg)
  process.exit(2)
}

/* ---------- 两侧文件与模块 ---------- */

function sideFiles(root, label) {
  const dir = path.join(root, 'miniprogram', 'utils')
  const files = {
    sky: path.join(dir, 'sky.js'),
    cond: path.join(dir, 'conditions.js'),
    astro: path.join(dir, 'astro.js'),
    agenda: path.join(dir, 'agenda.js'),
    oi: path.join(dir, 'outdoor-intelligence.js'),
    oip: path.join(dir, 'oi-presentation.js'),
    wcf: path.join(dir, 'weather-cloud-field.js'),
  }
  Object.keys(files).forEach(k => {
    if (!fs.existsSync(files[k])) invalid(label + '不可达：缺 ' + files[k])
  })
  if (md5(files.sky) !== SKY_MD5) invalid(label + ' sky.js md5 不符（期望 ' + SKY_MD5 + '，实得 ' + md5(files.sky) + '）')
  if (md5(files.cond) !== COND_MD5) invalid(label + ' conditions.js md5 不符（期望 ' + COND_MD5 + '，实得 ' + md5(files.cond) + '）')
  if (md5(files.astro) !== ASTRO_MD5) invalid(label + ' astro.js md5 不符（期望 ' + ASTRO_MD5 + '，实得 ' + md5(files.astro) + '）')
  return files
}

const PRE = sideFiles(PRE_ROOT, '改前快照')
const POST = sideFiles(POST_ROOT, '改后侧')
if (!fs.existsSync(REAL)) invalid('真实快照不可达 ' + REAL)
if (md5(REAL) !== REAL_MD5) invalid('真实快照 md5 不符（期望 ' + REAL_MD5 + '，实得 ' + md5(REAL) + '）')

const preSky = require(PRE.sky)
const preCond = require(PRE.cond)
const preAstro = require(PRE.astro)
const preAgenda = require(PRE.agenda)
const preOI = require(PRE.oi)
const preOIP = require(PRE.oip)
const preWCF = require(PRE.wcf)
const postSky = require(POST.sky)
const postCond = require(POST.cond)
const postAstro = require(POST.astro)
const postAgenda = require(POST.agenda)
const postOI = require(POST.oi)
const postOIP = require(POST.oip)
const postWCF = require(POST.wcf)

if (preSky === postSky || preCond === postCond || preAstro === postAstro
  || preAgenda === postAgenda || preOI === postOI || preOIP === postOIP || preWCF === postWCF) {
  invalid('两侧模块实例没分开（require 缓存被复用）——pre 的相对 require 必须指向 c7 快照')
}
if (preAgenda.isNightSequence !== undefined || preAgenda.isNightKey !== undefined) {
  invalid('改前 agenda 已含 isNightSequence/isNightKey——基线不是 pre-C7，先停下报告')
}
if (typeof postAgenda.isNightSequence !== 'function' || typeof postAgenda.isNightKey !== 'function') {
  invalid('改后 agenda 没有 isNightSequence/isNightKey——改后侧不是 post-C7，先停下报告')
}

/* ---------- 通用小工具 ---------- */

function pad2(n) { return (n < 10 ? '0' : '') + n }
function minOf(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''))
  return m ? (+m[1]) * 60 + (+m[2]) : -1
}
function clockMin(e) { return minOf(String((e && e.t) || '').replace(/^次日 /, '')) }
function absMinutes(h) {
  const day = Date.parse(h.d + 'T00:00:00Z')
  const t = minOf(h.t)
  if (!Number.isFinite(day) || t < 0) return NaN
  return day / 60000 + t
}
function pct(min) { return (min / 1440 * 100).toFixed(2) }
function zoneWidth(min) { return Math.max(3, min / 1440 * 100).toFixed(2) }

/* ---------- 独立 oracle：day-aware 聚类（不复用被测 isNightKey/clustersOf） ---------- */

function primaryKeyOf(list) {
  for (let i = 0; i < PRIMARY_ORDER.length; i++) {
    if ((list || []).indexOf(PRIMARY_ORDER[i]) !== -1) return PRIMARY_ORDER[i]
  }
  return null
}

/**
 * 把小时序列聚成连续同相簇。
 * 本函数是**独立实现**：按绝对分钟判连续（23:00 → 次日 00:00 也算连续），
 * 不读取被测模块的任何聚类函数。
 * @returns [{ key, from, to, fromD, toD, hours, startAbs, endAbs }]
 */
function clusterHours(hours, marks) {
  const out = []
  let cur = null
  for (let i = 0; i < (hours || []).length; i++) {
    const h = hours[i]
    const key = primaryKeyOf((marks || {})[h.d + 'T' + h.t] || [])
    const abs = absMinutes(h)
    if (!Number.isFinite(abs)) continue
    if (key && cur && cur.key === key && abs === cur.endAbs + 60) {
      cur.to = h.t
      cur.toD = h.d
      cur.endAbs = abs
      cur.hours.push(h)
    } else if (key) {
      if (cur) out.push(cur)
      cur = { key, from: h.t, to: h.t, fromD: h.d, toD: h.d, startAbs: abs, endAbs: abs, hours: [h] }
    } else if (cur) {
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out
}

function agendaOracleNew(nightHours, marks, date) {
  return clusterHours(nightHours, marks).filter(c => NIGHT_TITLE[c.key]).map(c => {
    const startNext = c.fromD !== date
    const endNext = c.toD !== date
    const t = startNext ? '次日 ' + c.from : c.from
    let window
    if (startNext) window = '次日 ' + c.from + (c.to === c.from ? '' : '–' + c.to)
    else if (endNext) window = '今晚 ' + c.from + ' → 次日 ' + c.to
    else window = c.from === c.to ? c.from : c.from + '–' + c.to
    const o = { t, title: NIGHT_TITLE[c.key], sub: null, l2: true, key: c.key, window }
    if (startNext) o.dayOffset = 1
    return o
  })
}

function agendaOracleOld(detail, marks) {
  return clusterHours(detail, marks).filter(c => NIGHT_TITLE[c.key]).map(c => ({
    t: c.from,
    title: NIGHT_TITLE[c.key],
    sub: null,
    l2: true,
    key: c.key,
    window: c.from === c.to ? c.from : c.from + '–' + c.to,
  }))
}

function isNightEvent(e) {
  return !!(e && e.l2 && (e.key === 'galaxy' || e.key === 'star'))
}

function eventShape(e) {
  return JSON.stringify({
    t: e.t,
    title: e.title,
    sub: e.sub == null ? null : e.sub,
    l2: e.l2,
    key: e.key,
    window: e.window,
    dayOffset: e.dayOffset === 1 ? 1 : undefined,
  })
}

function otherShape(events) {
  return JSON.stringify((events || []).filter(e => !isNightEvent(e)).map(e => {
    const o = Object.assign({}, e)
    if (o.title === '天文暗夜始') o.sub = '<dusk-sub>'
    return o
  }))
}

function dayAwareKey(e) {
  const next = /^次日 /.test(String(e.t || '')) || e.dayOffset === 1
  const m = clockMin(e)
  return (next ? 1440 : 0) + (m >= 0 ? m : 0)
}

function hasGalaxyMark(hours, marks) {
  return (hours || []).some(h => ((marks || {})[h.d + 'T' + h.t] || []).indexOf('galaxy') !== -1)
}

/* ---------- 独立 oracle：OI 夜间窗口的被挡判据 ---------- */

function blockedBy(conditions, from, to) {
  const f = minOf(from)
  const t = minOf(to)
  const end = t < f ? 1440 : t
  return (conditions || []).some(c => {
    const m = minOf(c.t)
    if (!(m >= f - 30 && m <= end + 30)) return false
    return c.key === 'IN_CLOUD' || c.key === 'CLOUD_ABOVE' || (c.holds || []).indexOf('mid') !== -1
  })
}

function nightTypeOf(key) {
  if (key === 'galaxy') return 'MILKY_WAY'
  if (key === 'star') return 'STARGAZING'
  return null
}

function isNightWindow(w) {
  return !!(w && NIGHT_TYPES[w.type])
}

/* ---------- 汇总 ---------- */

const agg = {
  scenarios: 0, real: 0, synth: 0,
  skyInputDiff: 0,
  marksConsistencyBad: 0,
  agendaNightPre: 0, agendaNightPost: 0,
  realAgendaNightPre: 0, realAgendaNightPost: 0,
  tailRemoved: 0, realTailRemoved: 0, synthTailRemoved: 0,
  crossAgenda: 0, realCrossAgenda: 0, nextAgenda: 0, realNextAgenda: 0,
  otherDiff: 0, agendaUntouched: 0, realAgendaUntouched: 0,
  agendaOracleBad: 0, agendaSortBad: 0,
  subRestored: 0, subRemoved: 0, subBad: 0,
  oiNightPre: 0, oiNightPost: 0, realOiNightPre: 0, realOiNightPost: 0,
  oiCross: 0, realOiCross: 0, oiTailRemoved: 0, realOiTailRemoved: 0,
  oiOtherDiff: 0, oiUntouched: 0, realOiUntouched: 0,
  oiConditionsDiff: 0, oiMetaDiff: 0,
  oiOracleBad: 0, oiMissingExplained: 0, nextDayOnlyLeak: 0,
  crossHoursBad: 0, nightEvidenceBad: 0, crossEvidenceBad: 0,
  preL2Morning: 0, preL2MorningStar: 0, preL2MorningOther: 0,
  realPreL2Morning: 0, realPreL2MorningStar: 0, realPreL2MorningOther: 0,
  horizonIdentical: 0, horizonDiff: 0, horizonLeak: 0, horizonComparisons: 0,
  presentationPreZones: 0, presentationPostZones: 0, presentationTextBad: 0,
  crossCount: 0, crossItemMissing: 0,
  timeTextBad: 0, anchorBad: 0, tapZoneBad: 0,
  selectionFromHit: 0, selectionToMiss: 0,
  liveFromTrue: 0, liveTomorrowFalse: 0,
  itemDiff: 0, zoneGeomDiff: 0, itemsSortBad: 0, nightSameDayBad: 0,
  factsNightPostOk: 0, factsNightPreOk: 0,
  overreach: 0,
}
let passed = 0
let failed = 0
const notes = []

function section(title) { console.log('\n== ' + title + ' ==') }
function check(name, cond, extra) {
  if (cond) {
    passed += 1
    console.log('  ✓ ' + name)
  } else {
    failed += 1
    console.log('  ✗ ' + name + (extra === undefined ? '' : ' :: ' + extra))
  }
  return !!cond
}
function bad(msg) {
  agg.overreach += 1
  if (notes.length < 60) notes.push(msg)
}

/* ---------- 基线身份探针（不通过 ⇒ exit 2） ---------- */

const PROBE_D = '2026-10-06'
const PROBE_D2 = '2026-10-07'
function probeHour(d, hh, high) {
  return {
    d, t: pad2(hh) + ':00', temp: 8, pop: 0, precip: 0, showers: 0, code: 2, wind: 5,
    rh: 55, cloud: { low: 5, mid: 5, high: high == null ? 5 : high }, band: null, visibility: 30,
  }
}
const probeDetail = []
for (let h = 0; h < 24; h++) probeDetail.push(probeHour(PROBE_D, h))
/* 探针夜段只放**次日凌晨**：若放今晚 23:00，幂等去重（同 t/同题）会把"没剔除 detail 夜簇"
   与"正常跨夜簇"折成同一条，基线身份探针就会把真问题误报成 INVALID。 */
const probeNight = [probeHour(PROBE_D2, 0), probeHour(PROBE_D2, 1)]
const probeMarks = {}
probeMarks[PROBE_D + 'T23:00'] = ['star']   // 今日 detail 的夜簇（旧口径会产出它）
probeNight.forEach(h => { probeMarks[h.d + 'T' + h.t] = ['star'] })
const probeBase = {
  date: PROBE_D, detail: probeDetail, userAltitude: 1200, elevOK: true,
  lat: 30.67, lng: 104.07, terrain: null, lightPollution: null, marks: probeMarks,
  days: [], sun: null, win: null,
}

/* pre agenda 必须忽略 nightHours；post agenda 必须消费它。 */
const preAgProbeNo = preAgenda.buildDayAgenda({
  date: PROBE_D, detail: probeDetail, marks: probeMarks, sun: null, win: null,
})
const preAgProbeYes = preAgenda.buildDayAgenda({
  date: PROBE_D, detail: probeDetail, marks: probeMarks, sun: null, win: null, nightHours: probeNight,
})
if (JSON.stringify(preAgProbeNo) !== JSON.stringify(preAgProbeYes)) {
  invalid('改前 agenda 已消费 nightHours——基线不是 pre-C7，先停下报告')
}
const postAgProbeNo = postAgenda.buildDayAgenda({
  date: PROBE_D, detail: probeDetail, marks: probeMarks, sun: null, win: null,
})
const postAgProbeYes = postAgenda.buildDayAgenda({
  date: PROBE_D, detail: probeDetail, marks: probeMarks, sun: null, win: null, nightHours: probeNight,
})
if (JSON.stringify(postAgProbeNo) === JSON.stringify(postAgProbeYes)) {
  invalid('改后 agenda 没有消费 nightHours——改后侧不是 post-C7，先停下报告')
}

/* pre OI 必须忽略 nightHours；post OI 必须消费它。 */
const preOiProbeNo = preOI.buildOutdoorIntelligence(Object.assign({}, probeBase))
const preOiProbeYes = preOI.buildOutdoorIntelligence(Object.assign({}, probeBase, { nightHours: probeNight }))
if (JSON.stringify(preOiProbeNo) !== JSON.stringify(preOiProbeYes)) {
  invalid('改前 OI 已消费 nightHours——基线不是 pre-C7，先停下报告')
}
const postOiProbeNo = postOI.buildOutdoorIntelligence(Object.assign({}, probeBase))
const postOiProbeYes = postOI.buildOutdoorIntelligence(Object.assign({}, probeBase, { nightHours: probeNight }))
if (JSON.stringify(postOiProbeNo) === JSON.stringify(postOiProbeYes)) {
  invalid('改后 OI 没有消费 nightHours——改后侧不是 post-C7，先停下报告')
}

/* ---------- 场景构造 ---------- */

const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))

function pageMarks(sky, place, dates) {
  /* 与 weather.js `buildChartMarks` 同形：逐日算，key = d + 'T' + t。
     今晚的次日凌晨必须有标记，否则跨零点窗口永远不会成立。 */
  const out = {}
  dates.forEach(d => {
    const detail = place.series.filter(h => h.d === d)
    const m = sky.hourMarks({
      date: d, lat: place.wgs[0], lng: place.wgs[1], elevation: place.elevation, elevOK: true,
      detail, days: [], cloudLevels: place.cloudLevels,
      terrain: null, lightPollution: null, atmosphere: null, spatial: null,
    })
    Object.keys(m).forEach(t => { out[d + 'T' + t] = m[t] })
  })
  return out
}

function buildScenario(kind, id, date, detail, skyCtx, marksPre, marksPost, nightPre, nightPost, extra) {
  const preSum = preSky.summarize(skyCtx)
  const postSum = postSky.summarize(skyCtx)
  if (!preSum || !postSum) invalid(id + '：sky.summarize 返回 null（夹具日期/坐标不合法）')
  const lat = skyCtx.lat
  const lng = skyCtx.lng
  const elev = skyCtx.elevation
  const preWin = preAstro.photoWindows(date, lat, lng, elev)
  const postWin = postAstro.photoWindows(date, lat, lng, elev)
  const preSun = preSum.sun
  const postSun = postSum.sun
  const preEvents = preAgenda.buildDayAgenda({ date, detail, marks: marksPre, sun: preSun, win: preWin })
  const postEvents = postAgenda.buildDayAgenda({ date, detail, marks: marksPost, sun: postSun, win: postWin, nightHours: nightPost })
  return Object.assign({
    kind, id, date, detail,
    preSum, postSum, preWin, postWin, marksPre, marksPost,
    nightPre, nightPost,
    preEvents, postEvents,
  }, extra || {})
}

const realScenarios = []
const places = {}

Object.keys(snap.places).forEach(placeKey => {
  const place = snap.places[placeKey]
  const dates = Array.from(new Set(place.series.map(h => h.d))).sort()
  const pm = pageMarks(preSky, place, dates)
  const qm = pageMarks(postSky, place, dates)
  places[placeKey] = { place, dates, pm, qm }
  dates.forEach((date, di) => {
    const detail = place.series.filter(h => h.d === date)
    const skyCtx = {
      date, lat: place.wgs[0], lng: place.wgs[1], elevation: place.elevation, elevOK: true,
      detail, series: place.series, days: [], lightPollution: null, heading: null,
      cloudLevels: place.cloudLevels,
    }
    const preSum = preSky.summarize(skyCtx)
    const postSum = postSky.summarize(skyCtx)
    const sc = buildScenario('real', 'real:' + placeKey + '/' + date, date, detail, skyCtx, pm, qm,
      preSum.night, postSum.night, { placeKey, dateIndex: di })
    const preField = preWCF.buildCloudField({ series: place.series, cloudLevels: place.cloudLevels },
      { date, userAltitude: place.elevation })
    const postField = postWCF.buildCloudField({ series: place.series, cloudLevels: place.cloudLevels },
      { date, userAltitude: place.elevation })
    const base = {
      date, detail, userAltitude: place.elevation, elevOK: true,
      lat: place.wgs[0], lng: place.wgs[1], terrain: null, lightPollution: null, days: [],
      nightHours: postSum.night,
    }
    sc.preOi = preOI.buildOutdoorIntelligence(Object.assign({}, base, { cloudField: preField, marks: pm }))
    sc.postOi = postOI.buildOutdoorIntelligence(Object.assign({}, base, { cloudField: postField, marks: qm }))
    sc.preField = preField
    sc.postField = postField
    realScenarios.push(sc)
  })
})

/* ---------- 合成场景 ---------- */

const SYNTH_D = '2026-10-06'
const SYNTH_D2 = '2026-10-07'
const SYNTH_LAT = 30.67
const SYNTH_LNG = 104.07
const SYNTH_ELEV = 1200

function synthDetail(date, over) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const o = (over && over(h)) || {}
    out.push({
      d: date, t: pad2(h) + ':00', temp: 8, pop: o.pop == null ? 0 : o.pop,
      precip: o.precip == null ? 0 : o.precip, showers: o.showers == null ? 0 : o.showers,
      code: 2, wind: 5, rh: o.rh == null ? 55 : o.rh,
      cloud: { low: o.low == null ? 5 : o.low, mid: o.mid == null ? 5 : o.mid, high: o.high == null ? 5 : o.high },
      band: o.band || null, visibility: 30,
    })
  }
  return out
}

function synthSeq(spans) {
  const out = []
  spans.forEach(sp => {
    for (let h = sp[0]; h <= sp[1]; h++) out.push(probeHour(sp[2] || SYNTH_D, h))
  })
  return out
}

function marksFor(hours, keys) {
  const m = {}
  hours.forEach(h => { m[h.d + 'T' + h.t] = keys.slice() })
  return m
}

function buildSynth(id, detail, marks, night, extra) {
  const skyCtx = {
    date: SYNTH_D, lat: SYNTH_LAT, lng: SYNTH_LNG, elevation: SYNTH_ELEV, elevOK: true,
    detail, series: detail, days: [], lightPollution: null, heading: null, cloudLevels: null,
  }
  const preSum = preSky.summarize(skyCtx)
  const postSum = postSky.summarize(skyCtx)
  const sc = buildScenario('synth', 'synth:' + id, SYNTH_D, detail, skyCtx, marks, marks,
    night, night, Object.assign({ synthMarks: marks, synthNight: night }, extra || {}))
  const base = {
    date: SYNTH_D, detail, userAltitude: SYNTH_ELEV, elevOK: true,
    lat: SYNTH_LAT, lng: SYNTH_LNG, terrain: null, lightPollution: null, days: [],
    nightHours: night,
  }
  sc.preOi = preOI.buildOutdoorIntelligence(Object.assign({}, base, { cloudField: null, marks }))
  sc.postOi = postOI.buildOutdoorIntelligence(Object.assign({}, base, { cloudField: null, marks }))
  return sc
}

const synthScenarios = []

/* 1. cross-star：今晚 21–23 + 次日 00–05 的 star（跨零点一簇） */
{
  const night = synthSeq([[21, 23, SYNTH_D], [0, 5, SYNTH_D2]])
  synthScenarios.push(buildSynth('cross-star', synthDetail(SYNTH_D), marksFor(night, ['star']), night))
}
/* 2. next-only-star：只有次日 01–05 的 star（纯次日事件；OI 24h 不产出窗口） */
{
  const night = synthSeq([[1, 5, SYNTH_D2]])
  synthScenarios.push(buildSynth('next-only-star', synthDetail(SYNTH_D), marksFor(night, ['star']), night))
}
/* 3. tail-only-star：只有今日 00–05 的 star（今晚无） */
{
  const tail = synthSeq([[0, 5, SYNTH_D]])
  const night = synthSeq([[21, 23, SYNTH_D]])
  const marks = marksFor(tail, ['star'])
  synthScenarios.push(buildSynth('tail-only-star', synthDetail(SYNTH_D), marks, night))
}
/* 4. sub-restored：今晚有 galaxy、今日 detail 无 galaxy（机会句从无到有）。
       galaxy 只放在次日 00–02：今晚的 21–23 同时也是"今日 detail"的一部分，pre 会看到，
       pre 的机会句本来就会说；只有"后半夜"才是 pre 看不见、post 才认得的今晚。 */
{
  const night = synthSeq([[0, 2, SYNTH_D2]])
  synthScenarios.push(buildSynth('sub-restored', synthDetail(SYNTH_D), marksFor(night, ['galaxy']), night))
}
/* 5. sub-removed-tail：今日尾段有 galaxy、今晚无 galaxy（机会句从有到无） */
{
  const tail = synthSeq([[0, 5, SYNTH_D]])
  const night = synthSeq([[21, 23, SYNTH_D]])
  const marks = Object.assign(marksFor(tail, ['galaxy']), marksFor(night, ['star']))
  synthScenarios.push(buildSynth('sub-removed-tail', synthDetail(SYNTH_D), marks, night))
}
/* 6. no-night：没有任何 galaxy/star 标记（整份 agenda/OI 必须逐字节相同） */
{
  const night = synthSeq([[21, 23, SYNTH_D]])
  const marks = {}
  const detail = synthDetail(SYNTH_D, h => (h === 15 || h === 16 ? { rh: 92, precip: 0.2, pop: 70 } : null))
  ;[15, 16].forEach(h => { marks[SYNTH_D + 'T' + pad2(h) + ':00'] = ['rainbow'] })
  synthScenarios.push(buildSynth('no-night', detail, marks, night))
}
/* 7. cross-galaxy：今晚 22–23 + 次日 00–04 的 galaxy（跨零点 + 机会句） */
{
  const night = synthSeq([[22, 23, SYNTH_D], [0, 4, SYNTH_D2]])
  synthScenarios.push(buildSynth('cross-galaxy', synthDetail(SYNTH_D), marksFor(night, ['galaxy']), night))
}
/* 8. facts-night-mean：今日高云 90 / 今晚只有 23:00 高云 90、其余 0。
      用于 C6（post 夜段 = 今晚均值 13%，pre = 自然日 90%）。 */
{
  const detail = synthDetail(SYNTH_D, () => ({ high: 90 }))
  const night = synthSeq([[23, 23, SYNTH_D], [0, 5, SYNTH_D2]])
  night[0].cloud = { low: 5, mid: 5, high: 90 }
  for (let i = 1; i < night.length; i++) night[i].cloud = { low: 5, mid: 5, high: 0 }
  const tail = synthSeq([[0, 5, SYNTH_D]])
  const marks = Object.assign(marksFor(tail, ['star']), marksFor(night, ['star']))
  synthScenarios.push(buildSynth('facts-night-mean', detail, marks, night))
}
/* 9. blocked-night：今晚 21–23 有 star 标记，但 22:00 的 band 把此点包在云里
      （hour-view conditions 判 IN_CLOUD）。生产会沉默这张卡；oracle 期望的窗口缺失，
      必须由 post conditions 的今日段被挡证据解释——这条场景专门行使"缺失解释"分支。 */
{
  const night = synthSeq([[21, 23, SYNTH_D]])
  const marks = marksFor(night, ['star'])
  marks[SYNTH_D + 'T22:00'] = ['star', 'inCloud']
  const detail = synthDetail(SYNTH_D, h => (h === 22
    ? { band: { base: 1000, top: 1400, cover: 90 }, low: 100, mid: 60, high: 50 }
    : null))
  synthScenarios.push(buildSynth('blocked-night', detail, marks, night))
}

/* ---------- 逐场景审计 ---------- */

function auditSky(sc) {
  let diff = 0
  const pairs = [
    ['summarize.items', sc.preSum.items, sc.postSum.items],
    ['summarize.marks', sc.preSum.marks, sc.postSum.marks],
    ['summarize.night', sc.preSum.night, sc.postSum.night],
    ['summarize.sun', sc.preSum.sun, sc.postSum.sun],
    ['summarize.moon', sc.preSum.moon, sc.postSum.moon],
    ['photoWindows', sc.preWin, sc.postWin],
    ['page marks', sc.marksPre, sc.marksPost],
  ]
  pairs.forEach(p => {
    if (JSON.stringify(p[1]) !== JSON.stringify(p[2])) {
      diff += 1
      bad(sc.id + '：天相输入 ' + p[0] + ' 变了（sky/conditions/astro 不应被 C7 触碰）')
    }
  })
  /* summarize 的当日 marks 必须与页面级 marks 在重叠小时上一致。
     只对真实场景成立：合成场景的 marks 是**注入夹具**（为了让特定小时出现 galaxy/star），
     本来就不等于 hourMarks 的产出；A 对它们仍比较两侧 summarize.marks 逐字节相同。 */
  if (sc.kind === 'real') {
    const sumMarks = sc.preSum.marks || {}
    Object.keys(sumMarks).forEach(t => {
      const page = (sc.marksPre || {})[sc.date + 'T' + t]
      if (JSON.stringify(page) !== JSON.stringify(sumMarks[t])) {
        agg.marksConsistencyBad += 1
        bad(sc.id + '：页面 marks 与 summarize marks 在 ' + t + ' 不一致（两张 marks 各说各话）')
      }
    })
  }
  agg.skyInputDiff += diff
}

function auditAgenda(sc) {
  const preNight = sc.preEvents.filter(isNightEvent)
  const postNight = sc.postEvents.filter(isNightEvent)
  agg.agendaNightPre += preNight.length
  agg.agendaNightPost += postNight.length
  if (sc.kind === 'real') {
    agg.realAgendaNightPre += preNight.length
    agg.realAgendaNightPost += postNight.length
  }

  /* B1：other 逐字节相同（「天文暗夜始」sub 除外）。 */
  if (otherShape(sc.preEvents) !== otherShape(sc.postEvents)) {
    agg.otherDiff += 1
    bad(sc.id + '：非夜间事件（other）出现越界差异')
  }
  const duskP = sc.preEvents.filter(e => e.title === '天文暗夜始')[0]
  const duskQ = sc.postEvents.filter(e => e.title === '天文暗夜始')[0]
  if (duskP && duskQ && duskP.t === duskQ.t) {
    const ps = duskP.sub == null ? null : duskP.sub
    const qs = duskQ.sub == null ? null : duskQ.sub
    if (ps !== qs) {
      const legal = (ps === null && qs === DUSK_SUB) || (ps === DUSK_SUB && qs === null)
      if (!legal) {
        agg.subBad += 1
        bad(sc.id + '：「天文暗夜始」sub 从 ' + JSON.stringify(ps) + ' 变成 ' + JSON.stringify(qs) + '（不在允许集合）')
      } else if (ps === null && qs === DUSK_SUB) {
        if (hasGalaxyMark(sc.nightPost, sc.marksPost)) agg.subRestored += 1
        else {
          agg.subBad += 1
          bad(sc.id + '：机会句从无到有，但今晚序列里没有 galaxy 标记（凭空长出一句话）')
        }
      } else if (ps === DUSK_SUB && qs === null) {
        const nightGalaxy = hasGalaxyMark(sc.nightPost, sc.marksPost)
        const detailGalaxy = hasGalaxyMark(sc.detail, sc.marksPre)
        if (!nightGalaxy && detailGalaxy) agg.subRemoved += 1
        else {
          agg.subBad += 1
          bad(sc.id + '：机会句从有到无，但今晚=' + nightGalaxy + ' / 今日 detail=' + detailGalaxy
            + '（解释不了：应只有尾段有 galaxy）')
        }
      }
    }
  }

  /* B2/B3：独立 oracle 逐条对照。 */
  const expNew = agendaOracleNew(sc.nightPost, sc.marksPost, sc.date)
  const gotNew = postNight.map(eventShape)
  if (JSON.stringify(expNew.map(eventShape)) !== JSON.stringify(gotNew)) {
    agg.agendaOracleBad += 1
    bad(sc.id + '：post 夜间事件与 day-aware oracle 不符\n      期望 ' + JSON.stringify(expNew)
      + '\n      实得 ' + JSON.stringify(postNight))
  }
  const expOld = agendaOracleOld(sc.detail, sc.marksPre)
  const gotOld = preNight.map(eventShape)
  if (JSON.stringify(expOld.map(eventShape)) !== JSON.stringify(gotOld)) {
    agg.agendaOracleBad += 1
    bad(sc.id + '：pre 夜间事件与旧口径 oracle 不符\n      期望 ' + JSON.stringify(expOld)
      + '\n      实得 ' + JSON.stringify(preNight))
  }

  /* B4：排序与 dayOffset。 */
  let sorted = true
  for (let i = 1; i < sc.postEvents.length; i++) {
    if (dayAwareKey(sc.postEvents[i]) < dayAwareKey(sc.postEvents[i - 1])) { sorted = false; break }
  }
  let firstNext = -1
  let lastToday = -1
  let nextFlagBad = 0
  sc.postEvents.forEach((e, i) => {
    const nextT = /^次日 /.test(String(e.t || ''))
    if (nextT) {
      if (firstNext < 0) firstNext = i
      if (e.dayOffset !== 1) nextFlagBad += 1
    } else {
      lastToday = i
      if ('dayOffset' in e) nextFlagBad += 1
    }
  })
  if (!sorted || nextFlagBad || (firstNext >= 0 && firstNext <= lastToday)) {
    agg.agendaSortBad += 1
    bad(sc.id + '：post 事件排序/dayOffset 越界（sorted=' + sorted + ' nextFlagBad=' + nextFlagBad
      + ' firstNext=' + firstNext + ' lastToday=' + lastToday + '）')
  }

  /* B5：计数与空改门。 */
  sc.preEvents.forEach(e => {
    if (!e.l2 || clockMin(e) < 0 || clockMin(e) >= 720) return
    agg.preL2Morning += 1
    if (isNightEvent(e)) agg.preL2MorningStar += 1
    else agg.preL2MorningOther += 1
    if (sc.kind === 'real') {
      agg.realPreL2Morning += 1
      if (isNightEvent(e)) agg.realPreL2MorningStar += 1
      else agg.realPreL2MorningOther += 1
    }
  })
  agg.crossAgenda += postNight.filter(e => String(e.window || '').indexOf('→ 次日') !== -1).length
  agg.nextAgenda += postNight.filter(e => /^次日 /.test(String(e.t || ''))).length
  if (sc.kind === 'real') {
    agg.realCrossAgenda += postNight.filter(e => String(e.window || '').indexOf('→ 次日') !== -1).length
    agg.realNextAgenda += postNight.filter(e => /^次日 /.test(String(e.t || ''))).length
  }
  preNight.forEach(e => {
    if (clockMin(e) >= 0 && clockMin(e) < 720
      && !postNight.some(x => x.key === e.key && x.t === e.t)) {
      agg.tailRemoved += 1
      if (sc.kind === 'real') agg.realTailRemoved += 1
      else agg.synthTailRemoved += 1
    }
  })
  if (JSON.stringify(sc.preEvents) === JSON.stringify(sc.postEvents) && !preNight.length && !postNight.length) {
    agg.agendaUntouched += 1
    if (sc.kind === 'real') agg.realAgendaUntouched += 1
  }
}

function auditOi(sc) {
  const preNight = sc.preOi.opportunities.filter(isNightWindow)
  const postNight = sc.postOi.opportunities.filter(isNightWindow)
  agg.oiNightPre += preNight.length
  agg.oiNightPost += postNight.length
  if (sc.kind === 'real') {
    agg.realOiNightPre += preNight.length
    agg.realOiNightPost += postNight.length
  }

  const preOther = JSON.stringify(sc.preOi.opportunities.filter(w => !isNightWindow(w)))
  const postOther = JSON.stringify(sc.postOi.opportunities.filter(w => !isNightWindow(w)))
  if (preOther !== postOther) {
    agg.oiOtherDiff += 1
    bad(sc.id + '：非夜间 OI 窗口出现越界差异')
  }
  /* nightHours 只允许影响 galaxy/star 的窗口归属与证据；条件态与云海负证据是另一层。 */
  if (JSON.stringify(sc.preOi.conditions) !== JSON.stringify(sc.postOi.conditions)) {
    agg.oiConditionsDiff += 1
    bad(sc.id + '：OI conditions 被 nightHours 影响了（条件态不应因夜段而变）')
  }
  const metaCore = oi => JSON.stringify({
    sources: oi.meta && oi.meta.sources,
    cloudSea: oi.meta && oi.meta.cloudSea,
    evidenceGaps: oi.meta && oi.meta.evidenceGaps,
  })
  if (metaCore(sc.preOi) !== metaCore(sc.postOi)) {
    agg.oiMetaDiff += 1
    bad(sc.id + '：OI meta（sources/cloudSea/evidenceGaps）出现越界差异')
  }

  /* C2：post 夜间窗口 oracle（夜序列 day-aware，仅今日起点）。 */
  const expPost = clusterHours(sc.nightPost, sc.marksPost)
    .filter(c => NIGHT_TITLE[c.key] && c.fromD === sc.date)
    .map(c => ({ key: c.key, type: nightTypeOf(c.key), from: c.from, to: c.to, hours: c.hours }))
  expPost.forEach(e => {
    const actual = postNight.filter(w => w.type === e.type && w.from === e.from && w.to === e.to)[0]
    if (!actual) {
      if (blockedBy(sc.postOi.conditions, e.from, e.to)) {
        agg.oiMissingExplained += 1
      } else {
        agg.oiOracleBad += 1
        bad(sc.id + '：post 缺了 oracle 期望的夜间窗口 ' + e.type + ' ' + e.from + '–' + e.to
          + '，且 post conditions 里找不到同段被挡证据')
      }
      return
    }
    const wantHours = e.hours.map(h => h.d + 'T' + h.t)
    const gotHours = (actual.hours || []).map(h => h.d + 'T' + h.t)
    if (JSON.stringify(wantHours) !== JSON.stringify(gotHours)) {
      agg.crossHoursBad += 1
      bad(sc.id + '：夜间窗口 ' + e.type + ' ' + e.from + '–' + e.to + ' 的 hours 与 oracle 不符（'
        + JSON.stringify(gotHours) + ' vs ' + JSON.stringify(wantHours) + '）')
    }
    const evOk = (actual.evidence || []).some(x => String(x.fact || '').indexOf('只看云量与月照') !== -1)
    if (!evOk) {
      agg.nightEvidenceBad += 1
      bad(sc.id + '：夜间窗口 ' + e.type + ' ' + e.from + '–' + e.to + ' 缺 nightLimit 边界句')
    }
    if (minOf(actual.to) < minOf(actual.from)) {
      agg.oiCross += 1
      if (sc.kind === 'real') agg.realOiCross += 1
      if (!computedCrossHoursOk(actual, sc.date)) {
        agg.crossHoursBad += 1
        bad(sc.id + '：跨零点窗口 ' + e.type + ' ' + actual.from + '→' + actual.to
          + ' 的 hours 没有覆盖次日小时')
      }
      if (!evOk) agg.crossEvidenceBad += 1
    }
  })
  postNight.forEach(w => {
    if (!expPost.some(e => e.type === w.type && e.from === w.from && w.to === w.to)) {
      agg.oiOracleBad += 1
      bad(sc.id + '：post 多出 oracle 没有的夜间窗口 ' + w.type + ' ' + w.from + '–' + w.to)
    }
  })

  /* C3：pre 夜间窗口旧口径 oracle。 */
  const expPre = clusterHours(sc.detail, sc.marksPre)
    .filter(c => NIGHT_TITLE[c.key])
    .map(c => ({ key: c.key, type: nightTypeOf(c.key), from: c.from, to: c.to }))
  expPre.forEach(e => {
    const actual = preNight.filter(w => w.type === e.type && w.from === e.from && w.to === e.to)[0]
    if (!actual && !blockedBy(sc.preOi.conditions, e.from, e.to)) {
      agg.oiOracleBad += 1
      bad(sc.id + '：pre 缺了旧口径 oracle 期望的夜间窗口 ' + e.type + ' ' + e.from + '–' + e.to)
    }
  })
  preNight.forEach(w => {
    if (!expPre.some(e => e.type === w.type && e.from === w.from && w.to === w.to)) {
      agg.oiOracleBad += 1
      bad(sc.id + '：pre 多出旧口径 oracle 没有的夜间窗口 ' + w.type + ' ' + w.from + '–' + w.to)
    }
  })

  /* C4：纯次日簇不得以任何形式泄漏成窗口。 */
  clusterHours(sc.nightPost, sc.marksPost).filter(c => NIGHT_TITLE[c.key] && c.fromD !== sc.date).forEach(c => {
    const type = nightTypeOf(c.key)
    if (postNight.some(w => w.type === type && w.from === c.from && w.to === c.to)) {
      agg.nextDayOnlyLeak += 1
      bad(sc.id + '：纯次日簇 ' + type + ' ' + c.from + '–' + c.to + ' 泄漏成了 24h 窗口')
    }
  })

  /* C7：计数与空改门。 */
  preNight.forEach(w => {
    if (minOf(w.from) >= 0 && minOf(w.from) < 720
      && !postNight.some(x => x.type === w.type && x.from === w.from && x.to === w.to)) {
      agg.oiTailRemoved += 1
      if (sc.kind === 'real') agg.realOiTailRemoved += 1
    }
  })
  if (JSON.stringify(sc.preOi) === JSON.stringify(sc.postOi) && !preNight.length && !postNight.length) {
    agg.oiUntouched += 1
    if (sc.kind === 'real') agg.realOiUntouched += 1
  }
}

function computedCrossHoursOk(w, date) {
  const hours = w.hours || []
  if (!hours.length) return false
  let hasNext = false
  let sorted = true
  let prev = null
  for (let i = 0; i < hours.length; i++) {
    const a = absMinutes(hours[i])
    if (!Number.isFinite(a)) return false
    if (prev != null && a <= prev) sorted = false
    prev = a
    if (hours[i].d && hours[i].d !== date) hasNext = true
  }
  const first = minOf(hours[0].t)
  const last = minOf(hours[hours.length - 1].t)
  /* 起点必须是今晚 from，终点是次日 to（同一份真实时间轴）。 */
  return sorted && hasNext && first === minOf(w.from) && last === minOf(w.to)
}

function allItems(card) {
  return ((card && card.items) || []).concat((card && card.moreItems) || [])
}

function isCrossItem(it) {
  return Number.isFinite(it.fromMin) && Number.isFinite(it.toMin) && it.toMin < it.fromMin
}

function normalizeItem(it) {
  const o = Object.assign({}, it)
  delete o.fromMin
  delete o.toMin
  return o
}

function auditPresentation(sc) {
  const preCard = preOIP.buildOiCard(sc.preOi, { width: 375 })
  const postCard = postOIP.buildOiCard(sc.postOi, { width: 375 })
  const crossWins = sc.postOi.opportunities.filter(w => isNightWindow(w)
    && minOf(w.to) >= 0 && minOf(w.from) >= 0 && minOf(w.to) < minOf(w.from))
  const postAll = allItems(postCard)

  crossWins.forEach(w => {
    agg.crossCount += 1
    const f = minOf(w.from)
    const t = minOf(w.to)
    const it = postAll.filter(x => x.fromMin === f && x.toMin === t)[0]
    if (!it) {
      agg.crossItemMissing += 1
      bad(sc.id + '：跨零点窗口 ' + w.type + ' ' + w.from + '→' + w.to + ' 在 24h 卡里找不到条目')
      return
    }
    if (it.timeText !== '今晚 ' + w.from + ' → 次日 ' + w.to) {
      agg.timeTextBad += 1
      bad(sc.id + '：跨零点 timeText 越界（' + it.timeText + '）')
    }
    const wantZone = postCard.tapZones.filter(z => z.left === pct(f) && z.width === zoneWidth(1440 - f))
    const oldZone = postCard.tapZones.filter(z => z.left === '0.00' && z.width === zoneWidth(t))
    if (wantZone.length !== 1 || oldZone.length) {
      agg.tapZoneBad += 1
      bad(sc.id + '：跨零点 tapZones 越界（今晚段命中 ' + wantZone.length + '，旧次日段 ' + oldZone.length
        + '）' + JSON.stringify(postCard.tapZones))
    }
    const a = it.anchor
    if (!a || a.endHour !== 24 || !(a.focusHour >= Math.floor(f / 60) && a.focusHour < 24)) {
      agg.anchorBad += 1
      bad(sc.id + '：跨零点 anchor 越界（' + JSON.stringify(a) + '，from=' + f + '）')
    }
    /* live：今晚段与次日段分开判。次日段必须用**段内**时钟（to-30），
       不能用 to 的端点：to 本身不属于任何一段（[from,1440) ∪ [0,to) 都不含它），
       那样两种实现都会给出 false，等于没测。 */
    const cardFrom = postOIP.buildOiCard(sc.postOi, { width: 375, nowMin: f + 30 })
    const itemFrom = allItems(cardFrom).filter(x => x.fromMin === f && x.toMin === t)[0]
    if (itemFrom && itemFrom.live === true) agg.liveFromTrue += 1
    else bad(sc.id + '：nowMin=from+30 时跨零点条目不是 live')
    if (t > 0) {
      const cardTo = postOIP.buildOiCard(sc.postOi, { width: 375, nowMin: t - 30 })
      const itemTo = allItems(cardTo).filter(x => x.fromMin === f && x.toMin === t)[0]
      if (itemTo && itemTo.live === false) agg.liveTomorrowFalse += 1
      else bad(sc.id + '：nowMin=to-30（次日段内部时钟）时跨零点条目仍标 live')
    } else {
      agg.liveTomorrowFalse += 1
    }
    /* 选中：起点命中，次日段内部小时不命中该条。同样不能用终点小时——
       终点是次日段开区间的右端，两边都不命中，变异体会漏网。 */
    const cardSelF = postOIP.buildOiCard(sc.postOi, { width: 375 })
    postOIP.applySelection(cardSelF, Math.floor(f / 60))
    const selF = cardSelF.items[cardSelF.selIndex]
    if (selF && selF.fromMin === f && selF.toMin === t) agg.selectionFromHit += 1
    else bad(sc.id + '：applySelection 起点小时未命中跨零点条目')
    if (t > 0 && Math.floor((t - 1) / 60) !== Math.floor(f / 60)) {
      const cardSelT = postOIP.buildOiCard(sc.postOi, { width: 375 })
      postOIP.applySelection(cardSelT, Math.floor((t - 1) / 60))
      const selT = cardSelT.items[cardSelT.selIndex]
      if (!selT || !(selT.fromMin === f && selT.toMin === t)) agg.selectionToMiss += 1
      else bad(sc.id + '：applySelection 次日段内部小时命中了跨零点条目（次日段不该出现在 24h 图上）')
    } else {
      agg.selectionToMiss += 1
    }
  })

  /* D2：非夜间 item / tapZones 逐字节相同（夜间同日窗口的变化由 B/C oracle 管）。 */
  const preNonNight = allItems(preCard).filter(x => !NIGHT_TYPES[x.type])
  const postNonNight = allItems(postCard).filter(x => !NIGHT_TYPES[x.type]).map(normalizeItem)
  if (JSON.stringify(preNonNight) !== JSON.stringify(postNonNight)) {
    agg.itemDiff += 1
    bad(sc.id + '：非夜间 item 出现越界差异（除 fromMin/toMin 外应逐字节相同）')
  }
  const preZones = preCard.tapZones.filter(z => !NIGHT_TITLES[z.title])
  const postZones = postCard.tapZones.filter(z => !NIGHT_TITLES[z.title])
  if (JSON.stringify(preZones) !== JSON.stringify(postZones)) {
    agg.zoneGeomDiff += 1
    bad(sc.id + '：非夜间 tapZones 几何出现越界差异')
  }
  /* 夜间同日窗口：两侧都还在、且 timeText 相同的条目，除 fromMin/toMin 与 summaryText 外
     应逐字节相同。summaryText 例外是 C6 明确允许的：夜间窗口的证据句改用今晚序列
     （「夜段高层云 13%」而不是自然日 90%），那是本轮要证明的变化，不是呈现漂移。
     被删的前夜尾段与改成跨零点的窗口没有同 timeText 配对，因此不会在这里被误判。 */
  const preNightItems = allItems(preCard).filter(x => NIGHT_TYPES[x.type] && !isCrossItem(x))
  const postNightItems = allItems(postCard).filter(x => NIGHT_TYPES[x.type] && !isCrossItem(x))
  function nightItemShape(it) {
    return JSON.stringify({
      type: it.type, title: it.title, timeText: it.timeText, hour: it.hour,
      tierText: it.tierText, tierClass: it.tierClass, phase: it.phase, rank: it.rank,
      confidence: it.confidence, crossMidnight: it.crossMidnight, anchor: it.anchor,
    })
  }
  preNightItems.forEach(p => {
    const q = postNightItems.filter(x => x.type === p.type && x.timeText === p.timeText)[0]
    if (!q) return
    if (nightItemShape(p) !== nightItemShape(q)) {
      agg.nightSameDayBad += 1
      bad(sc.id + '：同日夜间窗口 ' + p.type + ' ' + p.timeText + ' 的呈现字段变了')
      return
    }
    if (p.summaryText !== q.summaryText
      && !(/夜段高层云 \d+%/.test(String(p.summaryText)) && /夜段高层云 \d+%/.test(String(q.summaryText)))) {
      agg.nightSameDayBad += 1
      bad(sc.id + '：同日夜间窗口 ' + p.type + ' ' + p.timeText + ' 的摘要变化不只来自夜段云量')
    }
  })

  /* D3：itemsSorted。 */
  const sorted = allItems(postCard)
  const weight = r => (r === 'primary' ? 0 : 1)
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    const badOrder = weight(a.rank) > weight(b.rank)
      || (a.rank === b.rank && Number.isFinite(a.fromMin) && Number.isFinite(b.fromMin) && a.fromMin > b.fromMin)
    if (badOrder) {
      agg.itemsSortBad += 1
      bad(sc.id + '：itemsSorted 越界（' + JSON.stringify(sorted.map(x => x.rank + '@' + x.fromMin)) + '）')
      break
    }
  }
}

/* ---------- 执行 A/B/C/D ---------- */

section('A. 天相输入零变化')
const allScenarios = realScenarios.concat(synthScenarios)
allScenarios.forEach(sc => {
  agg.scenarios += 1
  if (sc.kind === 'real') agg.real += 1
  else agg.synth += 1
  auditSky(sc)
})
check('所有场景的 summarize/marks/night/sun/moon/photoWindows 逐字节相同', agg.skyInputDiff === 0,
  'skyInputDiff=' + agg.skyInputDiff)
check('页面 marks 与 summarize marks 在重叠小时上一致', agg.marksConsistencyBad === 0,
  'marksConsistencyBad=' + agg.marksConsistencyBad)

section('B. Agenda：other 不变 + night 事件独立 oracle + 排序')
allScenarios.forEach(auditAgenda)
check('非夜间事件（other）零差异', agg.otherDiff === 0, 'otherDiff=' + agg.otherDiff)
check('post 夜间事件 = day-aware oracle', agg.agendaOracleBad === 0, 'agendaOracleBad=' + agg.agendaOracleBad)
check('post 排序 / dayOffset 合法', agg.agendaSortBad === 0, 'agendaSortBad=' + agg.agendaSortBad)
check('机会句变化可由今晚 galaxy 标记解释', agg.subBad === 0, 'subBad=' + agg.subBad)

section('C. OI 24h：非夜间不变 + 夜间窗口独立 oracle')
allScenarios.forEach(auditOi)
check('非夜间 OI 窗口零差异', agg.oiOtherDiff === 0, 'oiOtherDiff=' + agg.oiOtherDiff)
check('OI conditions 不受 nightHours 影响', agg.oiConditionsDiff === 0,
  'oiConditionsDiff=' + agg.oiConditionsDiff)
check('OI meta 核心字段（sources/cloudSea/evidenceGaps）不变', agg.oiMetaDiff === 0,
  'oiMetaDiff=' + agg.oiMetaDiff)
check('post/pre 夜间窗口 = 独立 oracle（缺失必须有被挡证据）', agg.oiOracleBad === 0,
  'oiOracleBad=' + agg.oiOracleBad)
check('跨零点窗口 hours 来自夜序列并覆盖次日', agg.crossHoursBad === 0, 'crossHoursBad=' + agg.crossHoursBad)
check('夜间窗口证据带 nightLimit 边界句', agg.nightEvidenceBad === 0, 'nightEvidenceBad=' + agg.nightEvidenceBad)
check('纯次日簇没有泄漏成 24h 窗口', agg.nextDayOnlyLeak === 0, 'nextDayOnlyLeak=' + agg.nextDayOnlyLeak)
check('「缺失窗口可由 conditions 被挡解释」分支被真实触发', agg.oiMissingExplained > 0,
  'oiMissingExplained=' + agg.oiMissingExplained)

section('C6. factsFor 夜段：今晚均值 vs 自然日')
const factsSc = synthScenarios.filter(s => s.id === 'synth:facts-night-mean')[0]
if (!factsSc) invalid('缺 facts-night-mean 合成场景')
function nightHighFact(oi) {
  const w = (oi.opportunities || []).filter(x => x.type === 'STARGAZING')[0]
  const e = w && (w.evidence || []).filter(x => /夜段高层云/.test(String(x.fact)))[0]
  const m = e && /夜段高层云 (\d+)%/.exec(String(e.fact))
  return m ? +m[1] : null
}
const factsPost = nightHighFact(factsSc.postOi)
const factsPre = nightHighFact(factsSc.preOi)
if (factsPost === 13) agg.factsNightPostOk += 1
if (factsPre === 90) agg.factsNightPreOk += 1
check('post 夜段高层云 = 今晚均值 13%', factsPost === 13, '实得 ' + factsPost + '%')
check('pre（不消费 nightHours）夜段高层云 = 自然日 90%', factsPre === 90, '实得 ' + factsPre + '%')

section('C6b. 跨零点窗口的今晚段被挡 ⇒ 必须沉默')
/* 只解释「缺失」是单向判据：它证明不了「被挡时真的会沉默」。
   这条夹具专门行使 skyBlocked 的跨零点分支：窗口 21:00→次日 02:00，
   今晚 22:00 有 IN_CLOUD。旧式 [from-30, to+30] 会把今日段漏掉（to=02:00），
   于是变异体照常产出窗口——这条断言就是它的牙齿。 */
const blockNightHours = synthSeq([[21, 23, SYNTH_D], [0, 2, SYNTH_D2]])
const blockMarks = marksFor(blockNightHours, ['star'])
const blockCtx = {
  date: SYNTH_D, detail: synthDetail(SYNTH_D), marks: blockMarks, nightHours: blockNightHours,
  sun: null, win: null, factsFor: function () { return [] },
}
const blockOpen = postOI.buildOpportunities(blockCtx, [])
const blockClosed = postOI.buildOpportunities(blockCtx, [
  { t: '22:00', key: 'IN_CLOUD', holds: ['in'], evidence: [] },
])
check('阳性对照：今晚 22:00 无云时跨零点窗口照常产出',
  blockOpen.some(w => w.type === 'STARGAZING' && w.from === '21:00' && w.to === '02:00'),
  JSON.stringify(blockOpen.map(w => [w.type, w.from, w.to])))
check('今晚段 22:00 头顶有云 ⇒ 跨零点窗口必须沉默（今日段真的被检查）',
  !blockClosed.some(w => w.type === 'STARGAZING'),
  JSON.stringify(blockClosed.map(w => [w.type, w.from, w.to])))

section('D. 呈现层：跨零点几何 / 选中 / live / 非夜间不变 / 排序')
allScenarios.forEach(auditPresentation)
check('跨零点条目全部在 24h 卡里找得到', agg.crossItemMissing === 0, 'crossItemMissing=' + agg.crossItemMissing)
check('跨零点 timeText 同源', agg.timeTextBad === 0, 'timeTextBad=' + agg.timeTextBad)
check('跨零点 tapZones 只画今晚段（无旧次日段）', agg.tapZoneBad === 0, 'tapZoneBad=' + agg.tapZoneBad)
check('跨零点 anchor 落在今晚段', agg.anchorBad === 0, 'anchorBad=' + agg.anchorBad)
check('非夜间 item 除 fromMin/toMin 外逐字节相同', agg.itemDiff === 0, 'itemDiff=' + agg.itemDiff)
check('非夜间 tapZones 几何逐字节相同', agg.zoneGeomDiff === 0, 'zoneGeomDiff=' + agg.zoneGeomDiff)
check('同日夜间窗口（两侧同 timeText）呈现字段不变', agg.nightSameDayBad === 0,
  'nightSameDayBad=' + agg.nightSameDayBad)
check('itemsSorted 同 rank 按 fromMin 非递减', agg.itemsSortBad === 0, 'itemsSortBad=' + agg.itemsSortBad)
check('selection/live 四个计数等于跨零点窗口数',
  agg.selectionFromHit === agg.crossCount && agg.selectionToMiss === agg.crossCount
  && agg.liveFromTrue === agg.crossCount && agg.liveTomorrowFalse === agg.crossCount,
  JSON.stringify({
    crossCount: agg.crossCount, selectionFromHit: agg.selectionFromHit,
    selectionToMiss: agg.selectionToMiss, liveFromTrue: agg.liveFromTrue,
    liveTomorrowFalse: agg.liveTomorrowFalse,
  }))

/* D4：正向 delta（手工窗口）。pre 不是 2 个 tapZones ⇒ 基线不是 pre-C7。 */
section('D4. 正向 delta：手工 MILKY_WAY 23:00 → 04:00')
{
  const manual = {
    conditions: [],
    opportunities: [{
      type: 'MILKY_WAY', interpretation: '银河窗口', from: '23:00', to: '04:00',
      confidence: '中', rank: 'primary', evidence: [], hours: [],
    }],
    meta: {},
  }
  const preCard = preOIP.buildOiCard(manual, { width: 375 })
  const postCard = postOIP.buildOiCard(manual, { width: 375 })
  agg.presentationPreZones = preCard.tapZones.length
  agg.presentationPostZones = postCard.tapZones.length
  const postText = (postCard.items[0] || {}).timeText
  if (agg.presentationPreZones !== 2) {
    invalid('手工跨零点窗口在改前侧只有 ' + agg.presentationPreZones + ' 个 tapZones（期望 2）'
      + '——基线不是 pre-C7，先停下报告')
  }
  if (postText !== '今晚 23:00 → 次日 04:00') {
    agg.presentationTextBad += 1
    bad('手工跨零点窗口的 post 列表文案变了：' + postText)
  }
  check('改前 2 个 tapZones（旧的次日段 + 今晚段）', agg.presentationPreZones === 2, String(agg.presentationPreZones))
  check('改后 1 个 tapZones（只画今晚段）', agg.presentationPostZones === 1, String(agg.presentationPostZones))
  check('列表文案仍是「今晚 23:00 → 次日 04:00」', agg.presentationTextBad === 0, String(postText))
}

/* D5：horizon 阳性对照。 */
section('D5. Horizon 48/72h 阳性对照（不传 nightHours）')
function horizonOi(placeKey, date, side) {
  const entry = places[placeKey]
  const place = entry.place
  const detail = place.series.filter(h => h.d === date)
  const marks = side === 'pre' ? entry.pm : entry.qm
  const wcf = side === 'pre' ? preWCF : postWCF
  const oi = side === 'pre' ? preOI : postOI
  const field = wcf.buildCloudField({ series: place.series, cloudLevels: place.cloudLevels },
    { date, userAltitude: place.elevation })
  return oi.buildOutdoorIntelligence({
    date, detail, userAltitude: place.elevation, elevOK: true,
    lat: place.wgs[0], lng: place.wgs[1], cloudField: field,
    terrain: null, lightPollution: null, marks, days: [],
  })
}

realScenarios.forEach(sc => {
  const dates = places[sc.placeKey].dates
  let allSame = true
  ;[48, 72].forEach(hz => {
    agg.horizonComparisons += 1
    const daysPre = []
    const daysPost = []
    for (let k = 0; k < hz / 24; k++) {
      const d = dates[sc.dateIndex + k]
      if (!d) break
      daysPre.push({ dayLabel: d, date: d, oi: horizonOi(sc.placeKey, d, 'pre') })
      daysPost.push({ dayLabel: d, date: d, oi: horizonOi(sc.placeKey, d, 'post') })
    }
    const preCard = preOIP.buildHorizonOiCard(daysPre, { width: 375, horizon: hz })
    const postCard = postOIP.buildHorizonOiCard(daysPost, { width: 375, horizon: hz })
    if (postCard.items.some(it => ('fromMin' in it) || ('toMin' in it))) {
      agg.horizonLeak += 1
      bad(sc.id + '：horizon item 漏出了 fromMin/toMin')
    }
    if (JSON.stringify(preCard) !== JSON.stringify(postCard)) {
      agg.horizonDiff += 1
      allSame = false
      bad(sc.id + '：' + hz + 'h horizon 输出与改前不同')
    }
  })
  if (allSame) agg.horizonIdentical += 1
})
check('horizon item 不含 fromMin/toMin', agg.horizonLeak === 0, 'horizonLeak=' + agg.horizonLeak)
check('28 个真实场景的 48h 与 72h horizon 全部逐字节相同',
  agg.horizonIdentical === 28 && agg.horizonDiff === 0,
  'horizonIdentical=' + agg.horizonIdentical + ' horizonDiff=' + agg.horizonDiff)

/* ---------- 输出 ---------- */

console.log('\n========== 读数 ==========')
console.log('场景 ' + agg.scenarios + '（真实 ' + agg.real + ' + 合成 ' + agg.synth + '）'
  + '；另加 1 个手工呈现层场景（D4）')
console.log('天相输入：skyInputDiff=' + agg.skyInputDiff
  + ' marksConsistencyBad=' + agg.marksConsistencyBad)
console.log('Agenda：nightPre=' + agg.agendaNightPre + '（真实 ' + agg.realAgendaNightPre + '）'
  + ' nightPost=' + agg.agendaNightPost + '（真实 ' + agg.realAgendaNightPost + '）'
  + ' tailRemoved=' + agg.tailRemoved + '（真实 ' + agg.realTailRemoved
  + ' / 合成 ' + agg.synthTailRemoved + '）'
  + ' crossAgenda=' + agg.crossAgenda + '（真实 ' + agg.realCrossAgenda + '）'
  + ' nextAgenda=' + agg.nextAgenda + '（真实 ' + agg.realNextAgenda + '）'
  + ' otherDiff=' + agg.otherDiff
  + ' agendaUntouched=' + agg.agendaUntouched + '（真实 ' + agg.realAgendaUntouched + '）')
console.log('Agenda 解释：subRestored=' + agg.subRestored + ' subRemoved=' + agg.subRemoved
  + ' subBad=' + agg.subBad + ' agendaOracleBad=' + agg.agendaOracleBad
  + ' agendaSortBad=' + agg.agendaSortBad)
console.log('Agenda 诊断：真实 pre L2 事件起点<12:00 共 ' + agg.realPreL2Morning
  + '（夜间天相 star ' + agg.realPreL2MorningStar + ' + 非夜间 '
  + agg.realPreL2MorningOther + '）；主控探针的「尾段 21」与这个更宽的口径数值吻合')
console.log('  全场景同类计数（含合成）：' + agg.preL2Morning
  + '（夜间天相 ' + agg.preL2MorningStar + ' + 非夜间 ' + agg.preL2MorningOther + '）')
console.log('OI 24h：nightPre=' + agg.oiNightPre + '（真实 ' + agg.realOiNightPre + '）'
  + ' nightPost=' + agg.oiNightPost + '（真实 ' + agg.realOiNightPost + '）'
  + ' oiCross=' + agg.oiCross + '（真实 ' + agg.realOiCross + '）'
  + ' oiTailRemoved=' + agg.oiTailRemoved + '（真实 ' + agg.realOiTailRemoved + '）'
  + ' oiOtherDiff=' + agg.oiOtherDiff
  + ' oiUntouched=' + agg.oiUntouched + '（真实 ' + agg.realOiUntouched + '）')
console.log('OI oracle：oiOracleBad=' + agg.oiOracleBad + ' oiMissingExplained=' + agg.oiMissingExplained
  + ' nextDayOnlyLeak=' + agg.nextDayOnlyLeak + ' crossHoursBad=' + agg.crossHoursBad
  + ' nightEvidenceBad=' + agg.nightEvidenceBad + ' crossEvidenceBad=' + agg.crossEvidenceBad)
console.log('factsFor 夜段：post 13% ok=' + agg.factsNightPostOk + ' / pre 90% ok=' + agg.factsNightPreOk)
console.log('Horizon：identical=' + agg.horizonIdentical + '/28 diff=' + agg.horizonDiff
  + ' comparisons=' + agg.horizonComparisons + ' leak=' + agg.horizonLeak)
console.log('呈现层：crossCount=' + agg.crossCount + ' preZones=' + agg.presentationPreZones
  + ' postZones=' + agg.presentationPostZones
  + ' timeTextBad=' + agg.timeTextBad + ' anchorBad=' + agg.anchorBad
  + ' tapZoneBad=' + agg.tapZoneBad + ' crossItemMissing=' + agg.crossItemMissing
  + ' presentationTextBad=' + agg.presentationTextBad)
console.log('交互：selectionFromHit=' + agg.selectionFromHit + ' selectionToMiss=' + agg.selectionToMiss
  + ' liveFromTrue=' + agg.liveFromTrue + ' liveTomorrowFalse=' + agg.liveTomorrowFalse)
console.log('非夜间不变：itemDiff=' + agg.itemDiff + ' zoneGeomDiff=' + agg.zoneGeomDiff
  + ' itemsSortBad=' + agg.itemsSortBad)
console.log('越界：' + agg.overreach + '；断言 passed=' + passed + ' failed=' + failed)
if (notes.length) notes.forEach(n => console.log('  ✗ ' + n))

let exit = 0
function gate(cond, msg) {
  if (!cond) {
    console.log('FAIL：' + msg)
    exit = 1
  }
}

gate(agg.skyInputDiff === 0, '天相输入发生变化（sky/conditions/astro 被 C7 触碰）')
gate(agg.otherDiff === 0, 'Agenda 非夜间事件出现差异')
gate(agg.oiOtherDiff === 0, 'OI 非夜间窗口出现差异')
gate(agg.crossAgenda > 0, '空改门：没有任何跨零点 agenda 事件（跨夜聚合没生效）')
gate(agg.nextAgenda > 0, '空改门：没有任何纯次日 agenda 事件（dayOffset/次日标签没生效）')
gate(agg.tailRemoved >= 15, '前夜尾段移除不足 15（实得 ' + agg.tailRemoved + '）')
gate(agg.agendaUntouched >= 3, '阳性对照不足：整份 agenda 相同的场景 < 3（实得 ' + agg.agendaUntouched + '）')
gate(agg.oiCross >= 8, 'OI 跨零点窗口不足 8（实得 ' + agg.oiCross + '）')
gate(agg.oiTailRemoved >= 8, 'OI 前夜尾段移除不足 8（实得 ' + agg.oiTailRemoved + '）')
gate(agg.oiUntouched >= 5, 'OI 阳性对照不足：整份 OI 相同的场景 < 5（实得 ' + agg.oiUntouched + '）')
gate(agg.presentationPreZones === 2 && agg.presentationPostZones === 1,
  '呈现层正向 delta 不成立（preZones=' + agg.presentationPreZones + ' postZones=' + agg.presentationPostZones + '）')
gate(agg.horizonIdentical === 28 && agg.horizonDiff === 0,
  'Horizon 并非 28 个场景全部逐字节相同')
gate(agg.subRestored >= 1, '空改门：没有任何「机会句从无到有」的合成场景')
gate(agg.subRemoved >= 1, '空改门：没有任何「机会句从有到无」的合成场景')
gate(agg.selectionFromHit === agg.crossCount && agg.selectionToMiss === agg.crossCount
  && agg.liveFromTrue === agg.crossCount && agg.liveTomorrowFalse === agg.crossCount,
  'selection/live 四个计数与跨零点窗口数不一致')
gate(agg.anchorBad === 0, '跨零点 anchor 越界')
gate(agg.timeTextBad === 0, '跨零点 timeText 越界')
gate(agg.nextDayOnlyLeak === 0, '纯次日簇泄漏')
gate(agg.overreach === 0, '存在越界差异（见上方 ✗）')
gate(failed === 0, '有断言失败')

if (exit === 0) {
  console.log('\nPASS：C7 的差异只落在「前夜尾段移除 + 今晚跨零点/纯次日事件 + 24h 卡只画今晚段 + '
    + '夜段证据改用今晚序列」，非夜间事件/窗口/呈现与 horizon 全部逐字节不变。')
}
process.exit(exit)
