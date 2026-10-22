/* F5（C4：总评 4 星要求 ≥2 个 live 项）的差分对拍：改前快照 vs 改后快照
 *
 * ── 基线从哪来 ────────────────────────────────────────────────────────
 * 改前 = `D:/ot-baselines/c4/`（post-C3/pre-C4 快照），改后 = `D:/ot-baselines/c5/`
 * （post-C4/pre-C5 快照）；两侧被改文件的 md5 都写死在本文件里，缺失或哈希不符一律
 * exit 2（INVALID harness）——**不是通过**。
 * 两侧各自 require 各自的模块实例（pre 的 conditions 会 require pre 的 sky），并断言
 * 实例确实不同。
 * ⚠ 改后侧固定为 c5 快照，**不是当前工作树**：本对拍证明的是 C4 这一提交的 delta。
 *   C5 起会改光染文案与打分（`items` 因此变化），若仍读工作树，C4 的对拍会把那些
 *   改动误判成「items 变了」的越界。
 *
 * ── 判据（独立 oracle，不调用 post 实现）────────────────────────────────
 * 用 pre 侧 `isSilent` / `VERDICT` 自己重算：light 剔除 → excluded 剔除 → unknown 剔除 →
 * 星空/银河去重（有 galaxy 就不算 star）→ live = score ≥ 45。
 * 预测规则：**pre 总评 ≥70 且 dedup 后的 live 数 === 1** ⇒ 改后必须
 * score=69 / tone=warning / label=条件一般 / stars=★★★☆☆ / insufficient=false。
 * 其余场景（含 pre <70、0 个 live、≥2 个 live）改后必须与改前**逐字节相同**。
 * oracle 自身先与改前实现做等价性对照（dedup/均值/grade 必须复算出同一个 pre score），
 * 对照不上记越界——探针不等价时它没资格纠正结论（铁律 29）。
 *
 * ── 越界定义（写死；别的一律越界）──────────────────────────────────────
 * ① items 任何变化：两侧 overallGrade 都不得改写传入的 items（各自深拷贝后比对）；
 *    真实 28 天两侧 sky.summarize 的 items / marks / night 必须逐字节相同（本轮不改结论）。
 * ② 非预测场景总评任何字段变化（score / tone / label / stars / insufficient）算越界。
 * ③ 预测场景不是 69 / ★★★☆☆ / 条件一般 / warning / insufficient=false 算越界。
 * ④ insufficient 变化：两侧 insufficient 必须一致（空清单 / 全 unknown 仍是数据不足）。
 *
 * ── 空改门与阳性对照 ────────────────────────────────────────────────
 * 空改门：真实 28 天至少一天真的被 cap（pre>69 → post=69）。若真实为 0，如实打印 WARN，
 * 并以合成场景覆盖，**不假装真实生效**；真实 0 且合成 0 ⇒ exit 1。
 * 阳性对照：至少一天真实场景总评逐字节不变、至少一个合成场景不变——否则"全都变了"
 * 分不清是闸在判还是把总评推倒重写。
 *
 * 运行：node tools/ab-overall.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const PRE_ROOT = process.env.PRE_ROOT || path.join('D:', 'ot-baselines', 'c4')
const POST_ROOT = process.env.POST_ROOT || path.join('D:', 'ot-baselines', 'c5')
const PRE_SKY_MD5 = 'b85078699b4b0cd4ba3d76b40aa95ced'
const PRE_COND_MD5 = 'c3487ac8be777be1a695353bd5b70e71'
const POST_SKY_MD5 = 'b85078699b4b0cd4ba3d76b40aa95ced'
const POST_COND_MD5 = 'db4b3d938902898a178cd470c1f9b8ea'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

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
if (typeof preSky.cap69 !== 'function' || typeof postSky.cap69 !== 'function') {
  console.error('INVALID：cap69 缺失（两侧都应已有 F2 的封顶助手）')
  process.exit(2)
}

const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))

let scenarios = 0
let predicted = 0
let insufficientCases = 0
let overreach = 0
const notes = []
const real = { days: 0, predicted: 0, capped: 0, unchanged: 0, examples: [] }
const synth = { days: 0, predicted: 0, capped: 0, unchanged: 0 }
let nonInsufficientUnchanged = 0

function bad(msg) {
  overreach += 1
  if (notes.length < 40) notes.push(msg)
}

function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

/* 独立 oracle：只用 pre 侧 isSilent / VERDICT 重算，不读 post 实现。 */
function oracleOf(items) {
  const present = (items || []).filter(it => it.key !== 'light')
  const excluded = present.filter(it => preSky.isSilent(it))
  const known = present.filter(it => !preSky.isSilent(it) && it.verdict !== preSky.VERDICT.UNKNOWN)
  const hasGalaxy = known.some(it => it.key === 'galaxy')
  const dedup = known.filter(it => it.key !== 'star' || !hasGalaxy)
  if (!dedup.length) return { dedup: 0, live: 0, excluded: excluded.length, raw: null }
  const live = dedup.filter(it => it.score >= 45)
  const pool = live.length ? live : dedup
  const raw = pool.reduce((s, x) => s + x.score, 0) / pool.length
  return { dedup: dedup.length, live: live.length, excluded: excluded.length, raw }
}

/* overallGrade 必须是纯函数：传入的 items 一个字都不许被改。 */
function gradeSide(cond, items) {
  const input = clone(items)
  const out = cond.overallGrade(input)
  return { out, mutated: JSON.stringify(input) !== JSON.stringify(items) }
}

function compare(where, items, bucket) {
  scenarios += 1
  bucket.days += 1
  const o = oracleOf(items)
  const a = gradeSide(preCond, items)
  const b = gradeSide(postCond, items)
  if (a.mutated) bad(where + '：改前 overallGrade 改写了 items')
  if (b.mutated) bad(where + '：改后 overallGrade 改写了 items')

  /* oracle 等价性对照：用 pre 侧的 isSilent/VERDICT 重算的均值必须复现改前总评，
     否则这个探针没资格预测改后行为（铁律 29）。 */
  if (o.raw == null) {
    if (o.excluded > 0) {
      /* 全被 excluded 是「条件差」，不是「没数据」：改前给 grade(0)=0 分。 */
      if (a.out.score !== 0 || a.out.insufficient) {
        bad(where + '：oracle 判全 excluded，pre 却不是 0 分/非数据不足（' + JSON.stringify(a.out) + '）')
      }
    } else if (!a.out.insufficient) {
      bad(where + '：oracle 判无候选且无 excluded，pre 却不是数据不足')
    }
  } else {
    const eg = preSky.grade(o.raw)
    const expected = {
      score: eg.score,
      tone: eg.tone,
      label: eg.label,
      stars: preCond.starsOf(eg.score),
      insufficient: false,
    }
    if (JSON.stringify(expected) !== JSON.stringify(a.out)) {
      bad(where + '：oracle 与改前实现不一致（oracle ' + JSON.stringify(expected)
        + ' vs pre ' + JSON.stringify(a.out) + '）')
    }
  }

  if (a.out.insufficient !== b.out.insufficient) {
    bad(where + '：insufficient 变了 ' + a.out.insufficient + '→' + b.out.insufficient)
  }
  if (a.out.insufficient) insufficientCases += 1

  const isPredicted = Number.isFinite(a.out.score) && a.out.score >= 70 && o.live === 1
  if (isPredicted) {
    predicted += 1
    bucket.predicted += 1
    if (a.out.stars !== '★★★★☆') bad(where + '：pre 总评 ≥70 却不是四星（' + a.out.stars + '）')
    const ok = b.out.score === 69 && b.out.tone === 'warning' && b.out.label === '条件一般'
      && b.out.stars === '★★★☆☆' && b.out.insufficient === false
    if (!ok) bad(where + '：预测应封到 69/★★★☆☆，实得 ' + JSON.stringify(b.out))
    /* 计数按**改后实测**，不按预测：变异去掉 cap 时不能还打印"6/28 被 cap"。 */
    if (b.out.score === 69) bucket.capped += 1
    if (bucket === real && real.examples.length < 8) real.examples.push(where + ' pre=' + a.out.score)
    return
  }

  if (JSON.stringify(a.out) !== JSON.stringify(b.out)) {
    bad(where + '：非预测场景总评变了 ' + JSON.stringify(a.out) + ' → ' + JSON.stringify(b.out))
  } else {
    bucket.unchanged += 1
    if (!a.out.insufficient) nonInsufficientUnchanged += 1
  }
}

function daysOf(series) {
  const map = {}
  ;(series || []).forEach(h => {
    if (!map[h.d]) map[h.d] = { date: h.d, precipSum: 0 }
    map[h.d].precipSum += Number(h.precip) || 0
  })
  return Object.keys(map).sort().map(k => map[k])
}

/* ---------- 28 个真实地点日（4 地点 × 7 天） ---------- */
Object.keys(snap.places).forEach(placeKey => {
  const place = snap.places[placeKey]
  const days = daysOf(place.series)
  const dates = Array.from(new Set(place.series.map(h => h.d)))
  dates.forEach(date => {
    const detail = place.series.filter(h => h.d === date)
    const ctx = {
      date, lat: place.wgs[0], lng: place.wgs[1], elevation: place.elevation, elevOK: true,
      detail, series: place.series, cloudLevels: place.cloudLevels, days, heading: null,
    }
    const a = preSky.summarize(ctx)
    const b = postSky.summarize(ctx)
    const where = 'real:' + placeKey + '/' + date
    /* items 任何变化都越界：本轮生产改动只在总评，结论项必须逐字节相同。 */
    if (JSON.stringify(a.items) !== JSON.stringify(b.items)) bad(where + '：summarize items 变了')
    if (JSON.stringify(a.marks) !== JSON.stringify(b.marks)) bad(where + '：marks 变了')
    if (JSON.stringify(a.night) !== JSON.stringify(b.night)) bad(where + '：night 变了')
    compare(where, a.items, real)
  })
})

/* ---------- 合成场景（覆盖预测与非预测两侧） ---------- */
const SYNTH = [
  { id: 'single-80', items: [{ key: 'cloudSea', score: 80, verdict: 'possible' }] },
  {
    id: 'double-80',
    items: [
      { key: 'cloudSea', score: 80, verdict: 'possible' },
      { key: 'rainbow', score: 80, verdict: 'possible' },
    ],
  },
  {
    id: 'one-live-90-nonlive-20',
    items: [
      { key: 'cloudSea', score: 90, verdict: 'possible' },
      { key: 'rainbow', score: 20, verdict: 'possible' },
    ],
  },
  {
    id: 'one-live-90-excluded-64',
    items: [
      { key: 'star', score: 90, verdict: 'possible' },
      { key: 'cloudSea', score: 64, verdict: 'excluded' },
    ],
  },
  {
    id: 'star-60-galaxy-90',
    items: [
      { key: 'star', score: 60, verdict: 'possible' },
      { key: 'galaxy', score: 90, verdict: 'possible' },
    ],
  },
  { id: 'empty', items: [] },
  {
    id: 'all-unknown',
    items: [
      { key: 'cloudSea', score: 80, verdict: 'unknown' },
      { key: 'star', score: 90, verdict: 'unknown' },
    ],
  },
  {
    id: 'all-excluded',
    items: [
      { key: 'cloudSea', score: 64, verdict: 'excluded' },
      { key: 'star', score: 0, verdict: 'excluded' },
    ],
  },
  { id: 'single-65', items: [{ key: 'cloudSea', score: 65, verdict: 'possible' }] },
  { id: 'single-69.6', items: [{ key: 'cloudSea', score: 69.6, verdict: 'possible' }] },
  {
    id: 'triple-80',
    items: [
      { key: 'cloudSea', score: 80, verdict: 'possible' },
      { key: 'rainbow', score: 80, verdict: 'possible' },
      { key: 'alpenglow', score: 80, verdict: 'possible' },
    ],
  },
]
SYNTH.forEach(s => compare('synth:' + s.id, s.items, synth))

/* 去重口径的显式证据：pre 侧双计会得 75，实际必须是 90（银河优先只算一次）。 */
{
  const items = SYNTH.filter(s => s.id === 'star-60-galaxy-90')[0].items
  const pre = preCond.overallGrade(clone(items))
  if (pre.score !== 90) bad('synth:star-60-galaxy-90 的改前总评应为 90（去重后银河单项），实得 ' + pre.score)
  const post = postCond.overallGrade(clone(items))
  if (post.score === 75) bad('synth:star-60-galaxy-90 的改后总评是 75 = 星空/银河被双计')
}

/* ---------- 输出 ---------- */
console.log('场景 ' + scenarios + '（真实 ' + real.days + ' + 合成 ' + synth.days + '）')
console.log('真实：被 cap ' + real.capped + ' / ' + real.days + '，逐字节不变 ' + real.unchanged
  + '（预测 ' + real.predicted + '）')
if (real.examples.length) console.log('  例：' + real.examples.join('；'))
console.log('合成：被 cap ' + synth.capped + ' / ' + synth.days + '，逐字节不变 ' + synth.unchanged
  + '（预测 ' + synth.predicted + '）')
console.log('预测场景合计（pre ≥70 且 dedup live===1）：' + predicted)
console.log('数据不足场景：' + insufficientCases + '（两侧一致）')
console.log('非数据不足且逐字节不变的阳性对照：' + nonInsufficientUnchanged + ' 组')
console.log('越界：' + overreach)
if (notes.length) notes.forEach(n => console.log('  ✗ ' + n))

let exit = 0
if (overreach > 0) { console.log('FAIL：存在越界差异'); exit = 1 }
if (real.capped + synth.capped === 0) { console.log('FAIL：空改——没有任何场景真的被 cap'); exit = 1 }
if (real.unchanged === 0) { console.log('FAIL：阳性对照缺失——真实场景总评全在变'); exit = 1 }
if (synth.unchanged === 0) { console.log('FAIL：阳性对照缺失——合成场景总评全在变'); exit = 1 }
if (real.capped === 0) {
  console.log('WARN：真实 28 天里没有一天真的被 cap——规则在本批真实快照上未生效，'
    + '由合成场景覆盖（不假装真实生效）')
}
if (nonInsufficientUnchanged === 0) {
  console.log('FAIL：阳性对照空转——没有任何"非数据不足且逐字节不变"的场景'); exit = 1
}
if (insufficientCases === 0) { console.log('FAIL：缺测失败关闭没有被覆盖（空清单/全 unknown）'); exit = 1 }
if (exit === 0) {
  console.log('PASS：差异只落在「pre ≥70 且 dedup live===1 → 69/★★★☆☆」这一条，其余逐字节相同')
}
process.exit(exit)
