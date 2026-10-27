/* 云海主卡（C2 / F3）的差分对拍：改前快照 vs 本轮工作树
 *
 * ── 基线从哪来 ────────────────────────────────────────────────────────
 * `D:/ot-baselines/c2/`（C1 收口后的工作树快照，可用 PRE_ROOT 覆盖）。
 * 脚本先校验两份被改文件的 md5；缺失或哈希不符一律 exit 2（INVALID harness）——**不是通过**。
 * 只拿 `git archive HEAD` 当"改前"不行：HEAD 里既没有 C1 也没有本轮改动的上下文。
 *
 * ── 允许的差异（写死；别的一律越界）──────────────────────────────────
 * ① cloudSea 卡：只允许 window / score / tone / label / text 变化。
 *    key / title / look / verdict 是身份与判定，任何变化都是越界。
 * ② 其余五项（light/alpenglow/star/galaxy/rainbow）：九个字段逐字节相同。
 * ③ marks / night / sun / moon：逐字节相同（裁剪只动"可行动窗口"，不动事实层）。
 * ④ agenda.buildDayAgenda：整份事件列表逐字节相同（本轮把 visibleSeaWindow 委托给
 *    sky.clipRange，行为必须零变化；这是委托重构的证明，不是新增业务）。
 * ⑤ 期望窗口由本节**独立重写**的判据算出：原始 cloudSea 小时取自 `pre.hourMarks`，
 *    再按 [h, h+60) 与民用晨光的交集裁剪——**不调用 post 的 civilClip**。
 * ⑥ 期望分数：高云带（清晨实心带最低底 > 2200 m）**或窗口被全部裁空** ⇒ min(pre, 69)，
 *    否则与改前逐字相同；tone/label 必须与期望分数自洽。文案按"窗口替换 / 高云带后缀 /
 *    全裁空"三种形态从**改前文案**机械推导出期望值，再逐字节比对。
 * ⑦ conditions.overallGrade（总评）：它由六张卡派生，cloudSea 分数变了它就允许变；
 *    但**没有 cloudSea 可见字段变化的日子必须逐字节相同**，且总评变化只能出现在
 *    cloudSea 分数发生变化的日子（否则说明有别的输入被动了）。
 *
 * ── 空改门 ──────────────────────────────────────────────────────────
 * 28 个真实地点日里至少要有一次 window/score/text 变化（**只判真实语料**；全用合成日
 * 兜底等于没在生产形状上生效），否则这道闸在生产数据上从没生效过，等于白改。
 * 同时要求至少一天 cloudSea 逐字节不变（阳性对照）——否则"全都变了"分不清是闸在判
 * 还是把文案推倒重写。
 *
 * 运行：node tools/ab-cloud-sea.js
 *
 * ── 两端都是快照（2026-10-22 C3 起）──────────────────────────────────
 * C3 给每个结论项加 `at` 字段，若后侧继续读工作树，本对拍会把「新增字段」误判成
 * C2 的越界。因此后侧固定为 post-C2/pre-C3 快照（D:/ot-baselines/c3，双 md5 钉）：
 * 它证明的是「C2 当时把什么改成了什么」，**不是**当前工作树无回归。
 * 当前提交的回归由各自的 A/B 负责。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const PRE_ROOT = process.env.PRE_ROOT || path.join('D:', 'ot-baselines', 'c2')
const POST_ROOT = process.env.POST_ROOT || path.join('D:', 'ot-baselines', 'c3')
const PRE_SKY_MD5 = 'fa6d78d3d6064b291a0c731879f9a57e'
const PRE_AGENDA_MD5 = 'fdc4e4f9df1e4cb7d49c5f80345a1192'
const PRE_COND_MD5 = 'c7df68ad539ea46e934174cf4d823979'
const POST_SKY_MD5 = '0493b2a9c3ddfcda7d045b97a2d05ad5'
const POST_AGENDA_MD5 = 'd4e43ae19b65d705fa3522f496925e93'
const POST_COND_MD5 = 'c7df68ad539ea46e934174cf4d823979'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

const preSkyPath = path.join(PRE_ROOT, 'miniprogram/utils/sky.js')
const preAgendaPath = path.join(PRE_ROOT, 'miniprogram/utils/agenda.js')
const preCondPath = path.join(PRE_ROOT, 'miniprogram/utils/conditions.js')
const postSkyPath = path.join(POST_ROOT, 'miniprogram/utils/sky.js')
const postAgendaPath = path.join(POST_ROOT, 'miniprogram/utils/agenda.js')
const postCondPath = path.join(POST_ROOT, 'miniprogram/utils/conditions.js')
if (!fs.existsSync(preSkyPath) || !fs.existsSync(preAgendaPath) || !fs.existsSync(preCondPath)) {
  console.error('INVALID：改前快照不可达 ' + PRE_ROOT + '（缺 utils/sky.js / agenda.js / conditions.js）')
  process.exit(2)
}
if (!fs.existsSync(postSkyPath) || !fs.existsSync(postAgendaPath) || !fs.existsSync(postCondPath)) {
  console.error('INVALID：改后快照不可达 ' + POST_ROOT + '（缺 utils/sky.js / agenda.js / conditions.js）')
  process.exit(2)
}
if (md5(preSkyPath) !== PRE_SKY_MD5) {
  console.error('INVALID：改前快照 sky.js 的 md5 不符（期望 ' + PRE_SKY_MD5 + '，实得 ' + md5(preSkyPath) + '）')
  process.exit(2)
}
if (md5(preAgendaPath) !== PRE_AGENDA_MD5) {
  console.error('INVALID：改前快照 agenda.js 的 md5 不符（期望 ' + PRE_AGENDA_MD5 + '，实得 ' + md5(preAgendaPath) + '）')
  process.exit(2)
}
if (md5(preCondPath) !== PRE_COND_MD5) {
  console.error('INVALID：改前快照 conditions.js 的 md5 不符（期望 ' + PRE_COND_MD5 + '，实得 ' + md5(preCondPath) + '）')
  process.exit(2)
}
if (md5(postSkyPath) !== POST_SKY_MD5) {
  console.error('INVALID：改后快照 sky.js 的 md5 不符（期望 ' + POST_SKY_MD5 + '，实得 ' + md5(postSkyPath) + '）')
  process.exit(2)
}
if (md5(postAgendaPath) !== POST_AGENDA_MD5) {
  console.error('INVALID：改后快照 agenda.js 的 md5 不符（期望 ' + POST_AGENDA_MD5 + '，实得 ' + md5(postAgendaPath) + '）')
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
const preAgenda = require(preAgendaPath)
const preCond = require(preCondPath)
const postSky = require(postSkyPath)
const postAgenda = require(postAgendaPath)
const postCond = require(postCondPath)
const A = require(path.join(ROOT, 'miniprogram/utils/astro.js'))

if (preSky === postSky || preAgenda === postAgenda || preCond === postCond
  || typeof preSky.civilClip !== 'undefined' || typeof postSky.civilClip !== 'function') {
  console.error('INVALID：两侧模块实例没分开或对拍方向不对')
  process.exit(2)
}

const FIELDS = ['key', 'title', 'window', 'look', 'text', 'score', 'tone', 'label', 'verdict']
const HIGH_BASE_M = 2200   // 本文件既有的"贴地云海"分界（不是本轮新造的数）
const CAP = 69             // = 改后 sky.GRADES[0].min - 1（"条件较好"的下界减一）
const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))

/* ---------- 独立判据（不 require 被测实现） ---------- */

function hourMin(t) {
  const s = String(t || '').slice(0, 5)
  if (s.length < 4) return NaN
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
}
function label(h) { return String(h).padStart(2, '0') + ':00' }

/* 与 sky.civilClip 同语义，但**独立**写：小时覆盖 [t, t+60)，与 [dawn, dusk) 有交集才保留。 */
function clipHours(hours, civilFrom, civilTo) {
  if (!Number.isFinite(civilFrom) || !Number.isFinite(civilTo)) return hours.slice()
  return hours.filter(h => Math.min(hourMin(h.t) + 60, civilTo) > Math.max(hourMin(h.t), civilFrom))
}
/* hourSegments 的格式：连续小时并成 start-end；单小时也印 start-end。 */
function windowOf(hours) {
  if (!hours.length) return ''
  const segs = []
  let start = hours[0]
  let prev = hours[0]
  for (let i = 1; i < hours.length; i++) {
    const h = hours[i]
    if (hourMin(h.t) !== hourMin(prev.t) + 60) { segs.push(start.t + '-' + prev.t); start = h }
    prev = h
  }
  segs.push(start.t + '-' + prev.t)
  return segs.join(' / ')
}
function gradeOf(score) {
  const s = Math.max(0, Math.min(100, score))
  if (s >= 70) return { tone: 'success', label: '条件较好' }
  if (s >= 45) return { tone: 'warning', label: '条件一般' }
  return { tone: 'neutral', label: '条件较差' }
}
/* 生产天气页把整天序列换算成 days（前日降水会加分）。对拍也按生产形状喂，
   否则绝对分数与页面不一致，"分数只许不升"的读数会建立在缺字段的语境上。 */
function daysOf(series) {
  const map = {}
  ;(series || []).forEach(h => {
    if (!map[h.d]) map[h.d] = { date: h.d, precipSum: 0 }
    map[h.d].precipSum += Number(h.precip) || 0
  })
  return Object.keys(map).sort().map(k => map[k])
}

let cases = 0
let changedDays = 0
let sameDays = 0
let windowDiffs = 0
let scoreDiffs = 0
let textDiffs = 0
let clippedOutDays = 0
let cappedDays = 0
let highCapped = 0
let agendaChecked = 0
let overallDiffs = 0
const overallChanges = []
let overreach = 0
const notes = []

function bad(msg) {
  overreach += 1
  if (notes.length < 40) notes.push(msg)
}

/* 从改前文案机械推导改后期望文案（三种允许形态）。
   aboveBand=false 时文案本身不含窗口，裁剪只可能把 window 清空、不改文案；
   高云带仍会给理由句加后缀。旧版对这条路径返回 null，会把合法变化误判成 harness 失效。 */
function expectedText(preText, preWindow, postWindow, highBand, clippedOut, aboveBand) {
  const addHighSuffix = t => {
    const m = t.match(/云带偏高（底约 (\d+) m）/)
    if (!m) return null
    return t.replace(m[0], '云带偏高（底约 ' + m[1] + ' m，可能不是贴地云海）')
  }
  if (!aboveBand) return highBand ? addHighSuffix(preText) : preText
  if (clippedOut) {
    const i = preText.indexOf('（')
    const j = preText.lastIndexOf('）。')
    if (i < 0 || j < i) return null
    let reasons = preText.slice(i + 1, j)
    if (highBand) {
      const t = addHighSuffix(reasons)
      if (t == null) return null
      reasons = t
    }
    return '有云海条件的时段落在民用晨光之前，天光不足，此时能看清云顶的可能性低（' + reasons + '）。'
  }
  let t = preText
  if (postWindow !== preWindow && preWindow) {
    const head = '清晨 ' + preWindow + ' '
    if (t.indexOf(head) !== 0) return null
    t = '清晨 ' + postWindow + ' ' + t.slice(head.length)
  }
  if (highBand) t = addHighSuffix(t)
  return t
}

function compareDay(where, detail, series, cloudLevels, elevation, date, lat, lng, days) {
  cases += 1
  const ctx = {
    date, lat, lng, elevation, elevOK: true,
    detail, series, cloudLevels, days: days || [], heading: null,
  }
  const a = preSky.summarize(ctx)
  const b = postSky.summarize(ctx)
  if (!a || !b) { bad(where + ' summarize 返回空'); return }

  const ia = a.items.filter(i => i.key === 'cloudSea')[0]
  const ib = b.items.filter(i => i.key === 'cloudSea')[0]
  if (!ia || !ib) { bad(where + ' 缺 cloudSea 卡'); return }

  // ① 其余五项：九字段逐字节
  if (a.items.length !== b.items.length) bad(where + ' items 数量变了 ' + a.items.length + '→' + b.items.length)
  a.items.forEach((x, i) => {
    const y = b.items[i]
    if (!y) return
    const ka = Object.keys(x).sort().join(',')
    const kb = Object.keys(y).sort().join(',')
    if (ka !== kb) bad(where + ' ' + x.key + ' 字段集合变了：' + ka + ' → ' + kb)
    if (x.key === 'cloudSea') return
    const diff = FIELDS.filter(f => x[f] !== y[f])
    if (diff.length) bad(where + ' 非 cloudSea 卡越界 ' + x.key + '.' + diff.join(','))
  })

  // ② cloudSea 的身份字段与判定
  const idDiff = ['key', 'title', 'look'].filter(f => ia[f] !== ib[f])
  if (idDiff.length) bad(where + ' cloudSea 身份字段变了 ' + idDiff.join(','))
  if (ia.verdict !== ib.verdict) bad(where + ' cloudSea verdict 变了 ' + ia.verdict + '→' + ib.verdict)

  // ③ 独立 oracle：原始 cloudSea 小时 → 民用晨昏交集
  const sun = A.sunTimes(date, lat, lng, elevation)
  const civilFrom = hourMin(sun.civilDawn)
  const civilTo = hourMin(sun.civilDusk)
  const rawHours = detail.filter(h => (a.marks[h.t] || []).indexOf('cloudSea') !== -1)
  const keep = clipHours(rawHours, civilFrom, civilTo)
  const expectWindow = windowOf(keep)
  if (ib.window !== expectWindow) {
    bad(where + ' window 与独立 oracle 不符：期望 "' + expectWindow + '"，实得 "' + ib.window + '"')
  }

  // ④ 高云带与全裁空的独立判定
  const morningSolid = detail.filter(h => h.band && h.band.cover >= 80 && hourMin(h.t) < 10 * 60)
  const baseMin = morningSolid.length ? Math.min.apply(null, morningSolid.map(h => h.band.base)) : null
  const highBand = baseMin != null && baseMin > HIGH_BASE_M
  const aboveBand = morningSolid.some(h => elevation > h.band.top)
  const clippedOut = aboveBand && rawHours.length > 0 && keep.length === 0

  const expectScore = (highBand || clippedOut) ? Math.min(ia.score, CAP) : ia.score
  if (ib.score !== expectScore) bad(where + ' score 与独立期望不符：期望 ' + expectScore + '，实得 ' + ib.score)
  const g = gradeOf(expectScore)
  if (ib.tone !== g.tone || ib.label !== g.label) {
    bad(where + ' tone/label 与 grade(' + expectScore + ') 不自洽：' + ib.tone + '/' + ib.label)
  }

  const expText = expectedText(ia.text, ia.window, ib.window, highBand, clippedOut, aboveBand)
  if (expText == null) bad(where + ' 改前文案形态无法机械推导（harness 失效）：' + ia.text)
  else if (ib.text !== expText) bad(where + ' text 与机械期望不符：期望「' + expText + '」实得「' + ib.text + '」')

  /* ⑦ 总评（conditions.overallGrade）：cloudSea 分数变了它才允许变；
     没有可见字段变化的日子必须逐字节相同，分数没变时也不许借别的输入漂移。 */
  const changed = ['window', 'score', 'tone', 'label', 'text'].filter(f => ia[f] !== ib[f])
  const oa = preCond.overallGrade(a.items)
  const ob = postCond.overallGrade(b.items)
  if (JSON.stringify(oa) !== JSON.stringify(ob)) {
    overallDiffs += 1
    if (overallChanges.length < 8) {
      overallChanges.push(where + ' ' + oa.score + '→' + ob.score + ' / ' + oa.label + '→' + ob.label)
    }
    if (!changed.length) bad(where + ' 总评变了但 cloudSea 无可见字段变化')
    else if (ia.score === ib.score) bad(where + ' 总评变了但 cloudSea 分数没变（变化无法归因）')
  }

  // ⑤ 事实层逐字节
  if (JSON.stringify(a.marks) !== JSON.stringify(b.marks)) bad(where + ' marks 变了')
  if (JSON.stringify(a.night) !== JSON.stringify(b.night)) bad(where + ' night 变了')
  if (JSON.stringify(a.sun) !== JSON.stringify(b.sun) || JSON.stringify(a.moon) !== JSON.stringify(b.moon)) {
    bad(where + ' 日月数据变了')
  }

  // ⑥ agenda 委托重构：整份事件列表逐字节相同
  const pageMarks = sk => {
    const m = sk.hourMarks(ctx)
    const out = {}
    Object.keys(m).forEach(t => { out[date + 'T' + t] = m[t] })
    return out
  }
  const win = A.photoWindows(date, lat, lng, elevation)
  const ea = preAgenda.buildDayAgenda({ date, detail, marks: pageMarks(preSky), sun, win })
  const eb = postAgenda.buildDayAgenda({ date, detail, marks: pageMarks(postSky), sun, win })
  agendaChecked += 1
  if (JSON.stringify(ea) !== JSON.stringify(eb)) bad(where + ' agenda 事件列表变了')

  // 统计
  if (changed.length) changedDays += 1
  else sameDays += 1
  if (ia.window !== ib.window) windowDiffs += 1
  if (ia.score !== ib.score) scoreDiffs += 1
  if (ia.text !== ib.text) textDiffs += 1
  if (clippedOut) clippedOutDays += 1
  if (ib.score !== ia.score) cappedDays += 1
  if (highBand && ib.score !== ia.score) highCapped += 1
}

/* ---------- 28 个真实地点日 ---------- */
Object.keys(snap.places).forEach(placeKey => {
  const place = snap.places[placeKey]
  const dates = Array.from(new Set(place.series.map(h => h.d)))
  dates.forEach(date => {
    const detail = place.series.filter(h => h.d === date)
    compareDay('real:' + placeKey + '/' + date, detail, place.series, place.cloudLevels,
      place.elevation, date, place.wgs[0], place.wgs[1], daysOf(place.series))
  })
})

const realCases = cases
const realChanged = changedDays
const realSame = sameDays
const realWindow = windowDiffs
const realScore = scoreDiffs
const realText = textDiffs
const realClip = clippedOutDays
const realCapped = cappedDays
const realHighCapped = highCapped

/* ---------- 合成边界：真实语料里没覆盖到的封顶/分层路径 ----------
   真实 28 天里高云带的日子都不是"此点在带顶之上"（score 50/36 < 69），
   封顶在真实数据上恰好是 no-op；也没有任何云海簇能行使 agenda 的部分重叠。
   这里补四组**改前也会跑**的合成日，只让封顶/裁剪/委托这三条路径真的被走一次。 */
function synthDay(over) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const o = (over && (over[h] || over['*'])) || {}
    out.push({
      d: '2026-07-18', t: String(h).padStart(2, '0') + ':00',
      temp: 8, pop: 0, precip: 0, showers: 0, code: 2, wind: 6, rh: 60,
      cloud: { low: 0, mid: 0, high: o.high == null ? 10 : o.high },
      band: o.band || null,
    })
  }
  return out
}
const SYNTH = [
  { id: 'high-above', elevation: 4000, band: { base: 3500, top: 3800, cover: 95 }, hours: [6, 7, 8, 9] },
  { id: 'high-below', elevation: 3000, band: { base: 3500, top: 3800, cover: 95 }, hours: [6, 7, 8, 9] },
  { id: 'night-only', elevation: 2000, band: { base: 1000, top: 1600, cover: 95 }, hours: [1, 2, 3, 4] },
  /* 首小时跨越民用晨光（05:46）：主卡按小时保留 05 时，日程按分钟把起点裁到 05:46。
     这条同时行使"部分重叠"与 agenda 的 +60 簇末小时语义，真实语料里没有云海簇。 */
  { id: 'morning-partial', elevation: 2000, band: { base: 1000, top: 1600, cover: 95 }, hours: [5, 6, 7] },
]
SYNTH.forEach(c => {
  const over = { '*': {} }
  c.hours.forEach(h => { over[h] = { band: c.band } })
  compareDay('synth:' + c.id, synthDay(over), synthDay(over), null, c.elevation, '2026-07-18', 30.67, 104.07)
})

/* 自证 morning-partial 真的走到"部分重叠"：日程里必须有云海事件，
   起点=民用晨光 05:46、终点=簇末 07 时 +60=08:00。没有这条，
   合成夹具可能悄悄没有事件，"行使了 agenda 委托"就是空话。 */
;(function () {
  const c = SYNTH.filter(x => x.id === 'morning-partial')[0]
  const over = { '*': {} }
  c.hours.forEach(h => { over[h] = { band: c.band } })
  const detail = synthDay(over)
  const ctx = {
    date: '2026-07-18', lat: 30.67, lng: 104.07, elevation: c.elevation, elevOK: true,
    detail, series: detail, cloudLevels: null, days: [], heading: null,
  }
  const sun = A.sunTimes('2026-07-18', 30.67, 104.07, c.elevation)
  const win = A.photoWindows('2026-07-18', 30.67, 104.07, c.elevation)
  const m = postSky.hourMarks(ctx)
  const marks = {}
  Object.keys(m).forEach(t => { marks['2026-07-18T' + t] = m[t] })
  const ev = postAgenda.buildDayAgenda({ date: '2026-07-18', detail, marks, sun, win })
    .filter(e => e.l2 && e.key === 'cloudSea')
  const w = ev.length ? ev[0].window : ''
  if (w.slice(0, 5) !== sun.civilDawn || w.slice(-5) !== '08:00') {
    bad('synth:morning-partial 未产生预期的部分重叠日程（实得「' + w + '」，期望 ' + sun.civilDawn + '–08:00）')
  }
})()
const synthCases = cases - realCases
const synthChanged = changedDays - realChanged

console.log('真实场景 ' + realCases + '（4 地点 × 7 天）')
console.log('  cloudSea 有变化 ' + realChanged + ' 天 / 逐字节不变 ' + realSame + ' 天（阳性对照）')
console.log('  差异分布：window ' + realWindow + ' / score ' + realScore + ' / text ' + realText
  + '（其中全裁空 ' + realClip + ' 天，分数下降 ' + realCapped + ' 天；高云带封顶 ' + realHighCapped + ' 天）')
console.log('合成边界 ' + synthCases + ' 例，其中 cloudSea 有变化 ' + synthChanged + ' 例'
  + '（score 差异 ' + (scoreDiffs - realScore) + '）')
console.log('agenda 事件列表逐字节比对 ' + agendaChecked + ' 例')
console.log('总评（conditions.overallGrade）变化 ' + overallDiffs + ' 例（只允许因 cloudSea 分数变化）')
overallChanges.forEach(s => console.log('  · ' + s))
console.log('越界：' + overreach)
if (notes.length) notes.forEach(n => console.log('  ✗ ' + n))

let exit = 0
if (overreach > 0) { console.log('FAIL：存在越界差异'); exit = 1 }
/* 空改门只判真实语料：合成日是人工铺的，拿它兜底等于"生产形状上一次都没生效"。 */
if (realChanged === 0) { console.log('FAIL：空改——28 个真实地点日没有任何 cloudSea 差异'); exit = 1 }
if (realSame === 0) { console.log('FAIL：没有阳性对照——28 天里没有任何一天逐字节不变'); exit = 1 }
if (realHighCapped === 0) {
  /* 不是失败：真实语料里高云带的日子恰好都不是"此点在带顶之上"（score 50/36 < 69，
     封顶是 no-op）。但必须如实打印——"高云带封顶在真实数据上一次都没生效"是风险登记项，
     不是通过项；它的牙齿由 sky-test §22 与合成边界行使。全裁空的封顶在真实语料上另有生效日。 */
  console.log('WARN：真实语料上高云带封顶一次都没生效（只在合成边界与 sky-test 被行使）')
}
if (exit === 0) console.log('PASS：差异只落在允许清单内（cloudSea 的 window/score/tone/label/text），其余逐字节相同')
process.exit(exit)
