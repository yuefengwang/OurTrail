/* F6（C5：光染拆分 + 25–40 档）的差分对拍：改前快照 vs 改后快照
 *
 * ── 基线从哪来 ────────────────────────────────────────────────────────
 * 改前 = `D:/ot-baselines/c5/`（post-C4/pre-C5 快照），改后 = `D:/ot-baselines/c6/`
 * （post-C5/pre-C6 快照）。两侧被改文件的 md5 都写死在本文件里，缺失或哈希不符一律
 * exit 2（INVALID harness）——**不是通过**。两侧各自 require 各自的模块实例（pre 的
 * conditions 会 require pre 的 sky），并断言实例确实不同。
 * ⚠ 改后侧固定为 c6 快照，**不是当前工作树**：本对拍证明的是 C5 这一提交的 delta。
 *   C6 起会改彩虹的太阳下限与封顶，`marks`（彩虹数组）会变；若仍读工作树，C5 的对拍
 *   会把彩虹标记的合法变化误判成越界。
 *
 * ── 越界定义（写死；别的一律越界）────────────────────────────────────
 * ① 六项里除 `alpenglow` 外，其余五项（light/cloudSea/star/galaxy/rainbow）逐字节相同；
 *    `marks`、`night`、`sun`、`moon` 逐字节相同；两侧 `items.length` 与
 *    `items.map(i=>i.key).join(',')` 完全相同（顺序与集合都不许动）。
 * ② `alpenglow` 的 `key/title/at/window/verdict` 必须相同。
 * ③ 有地形（ctx.terrain 可用）的场景：
 *    - **逐字节相同的适用范围**：pre 为 excluded，或 pre text 含「中高云可被染色」
 *      （≥40 的 possible）。这两类必须整个对象逐字节相同（阳性对照）；
 *      其中 possible 且 marks 非空计 `terrainIdentical`，excluded 计 `terrainExcludedIdentical`。
 *    - **唯一例外**：pre 是 possible 且 text 不含「中高云可被染色」（25–40 档）⇒ 允许
 *      同一档的 +8 与 text 变化（口径仍为山体/DEM）：delta 恰为 +8、post text 含
 *      「中高云偏少」且仍含「山体被光染」、look 与 pre 逐字节相同且含「看山脊线」、
 *      不含「天空与山脊线」。计 `terrainTier8`。
 *    - 其它组合 ⇒ 越界。
 * ④ 无地形场景：只允许 `text/look/score/tone/label` 变化；分数只允许 0 或 +8：
 *    - delta === 0：不额外约束（按 verdict 分别计入 possibleScoreUnchanged / excludedUnchanged）；
 *    - delta === +8：改前 text 不含「中高云可被染色」，改后 text 必须含「中高云偏少」
 *      （否则 +8 不是这一档给的，或者分加了理由没同步）；
 *    - 其它 delta ⇒ 越界（本轮不动 ≥40 的分数路径、也不动其它加减分项）。
 *    无地形且 post verdict=excluded 时**只允许 text 变**：look/score/tone/label 必须与改前相同。
 * ⑤ 无地形且 verdict=possible 的 text 必须含「天空与中高云有被染色的条件」「没有目标山峰数据」
 *    「判断不了哪座山会被染」、不含「山体被光染」，look 必须含「看天空与山脊线」；
 *    无地形且 excluded 的 text 必须含「天空与中高云被染色的概率很低」、不含「山体被光染」。
 * ⑥ 用 pre/post 两侧 `conditions.overallGrade` 各算一次总评：若两侧 items 逐字节相同则
 *    总评必须相同；若总评不同则 alpenglow.score 必须不同（报告 overallChanges 数）。
 *
 * ── 空改门与阳性对照 ────────────────────────────────────────────────
 * 七条空改/阳性对照门 + 一条 realTier8 硬门，任一不满足 ⇒ exit 1：
 *   - noTerrainTextChanged > 0（无地形场景至少一处文案真的变了）；
 *   - tier8 > 0（至少一个 25–40 场景真的 +8）；
 *   - terrainIdentical > 0（至少一个 ≥40 possible 的地形场景逐字节相同）；
 *   - terrainExcludedIdentical > 0（至少一个地形 excluded 场景逐字节相同）；
 *   - terrainTier8 > 0（terrain × 25–40 的同一档 +8 例外真的出现）；
 *   - possibleScoreUnchanged > 0（至少一个无地形 possible 场景分数没变）；
 *   - excludedUnchanged > 0（至少一个无地形 excluded 场景分数没变）。
 * 另报告 `realTier8`（真实 28 天里的 25–40 档 +8，硬门 >0，当前应为 3）与
 * `scoreChangedOverallSame`（delta=8 但总评未变，只报告不判红）。
 *
 * 运行：node tools/ab-alpenglow.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const PRE_ROOT = process.env.PRE_ROOT || path.join('D:', 'ot-baselines', 'c5')
const POST_ROOT = process.env.POST_ROOT || path.join('D:', 'ot-baselines', 'c6')
const PRE_SKY_MD5 = 'b85078699b4b0cd4ba3d76b40aa95ced'
const PRE_COND_MD5 = 'db4b3d938902898a178cd470c1f9b8ea'
const POST_SKY_MD5 = '32cee738972170a8839ffffd9b1b9392'
const POST_COND_MD5 = 'db4b3d938902898a178cd470c1f9b8ea'
const REAL_MD5 = 'e2783f7b135c0b485fcccdf74352ef67'
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
/* C5 不改 conditions.js：改后侧与改前的 conditions 必须逐字节相同。
   否则「两侧各走自己的总评」就不再是在比同一份实现，先停下报告。 */
if (md5(postCondPath) !== POST_COND_MD5) {
  console.error('INVALID：改后快照 conditions.js md5 不符（期望 ' + POST_COND_MD5 + '，实得 ' + md5(postCondPath) + '）——C5 不改该文件，先停并报告')
  process.exit(2)
}
if (!fs.existsSync(REAL)) {
  console.error('INVALID：真实快照不可达 ' + REAL)
  process.exit(2)
}
if (md5(REAL) !== REAL_MD5) {
  console.error('INVALID：真实快照 md5 不符（期望 ' + REAL_MD5 + '，实得 ' + md5(REAL) + '）')
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
let noTerrainTextChanged = 0
let noTerrainLookChanged = 0
let tier8 = 0
let realTier8 = 0
let terrainIdentical = 0
let terrainExcludedIdentical = 0
let terrainTier8 = 0
let possibleScoreUnchanged = 0
let excludedUnchanged = 0
let scoreChangedOverallSame = 0
let tier8OverallChanged = 0
let overallChanges = 0
let overreach = 0
const notes = []
const realStats = { days: 0, changed: 0, tier8: 0, unchangedScore: 0 }
const synthStats = { days: 0, changed: 0, tier8: 0, unchangedScore: 0 }

function bad(msg) {
  overreach += 1
  if (notes.length < 40) notes.push(msg)
}

function clone(x) {
  return JSON.parse(JSON.stringify(x))
}

const byKey = (res, key) => (res.items || []).filter(i => i.key === key)[0]
const ALLOWED_CHANGED = ['text', 'look', 'score', 'tone', 'label']
const FIXED_FIELDS = ['key', 'title', 'at', 'window', 'verdict']

function day(over) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const t = String(h).padStart(2, '0') + ':00'
    out.push({
      t,
      temp: 18,
      pop: over.pop == null ? 0 : over.pop,
      precip: over.precip == null ? 0 : over.precip,
      showers: 0,
      code: 2,
      wind: 8,
      rh: 60,
      visibility: 20,
      freezing: 4000,
      uv: 5,
      cloud: { low: over.low, mid: over.mid, high: over.high },
      band: null,
    })
  }
  return out
}

function terrainAll(angle, distance, elevation) {
  const horizon = []
  for (let a = 0; a < 360; a += 22.5) horizon.push({ azimuth: a, angle, distance, elevation })
  return { horizon, openness: angle < 1 ? 1 : 0 }
}

/* ---------- 场景 ---------- */

function daysOf(series) {
  const map = {}
  ;(series || []).forEach(h => {
    if (!map[h.d]) map[h.d] = { date: h.d, precipSum: 0 }
    map[h.d].precipSum += Number(h.precip) || 0
  })
  return Object.keys(map).sort().map(k => map[k])
}

const SCENARIOS = []

/* 真实 28 天：4 地点 × 7 天，ctx 与 ab-overall 相同（无 terrain、heading:null） */
Object.keys(snap.places).forEach(placeKey => {
  const place = snap.places[placeKey]
  const days = daysOf(place.series)
  const dates = Array.from(new Set(place.series.map(h => h.d)))
  dates.forEach(date => {
    SCENARIOS.push({
      id: 'real:' + placeKey + '/' + date,
      kind: 'real',
      terrain: false,
      cloudMidHigh: null,
      ctx: {
        date, lat: place.wgs[0], lng: place.wgs[1], elevation: place.elevation, elevOK: true,
        detail: place.series.filter(h => h.d === date), series: place.series,
        cloudLevels: place.cloudLevels, days, heading: null,
      },
    })
  })
})

const synthCtx = (detail, extra) => Object.assign({
  date: '2026-07-18', lat: 30.67, lng: 104.07, elevation: 1200, elevOK: true,
  detail, days: [], heading: 90,
}, extra || {})

const SYNTH = [
  { id: 'p3-no-terrain', cloud: { low: 0, mid: 30, high: 30 } },
  { id: 'midhigh-30', cloud: { low: 0, mid: 15, high: 15 } },
  { id: 'midhigh-24', cloud: { low: 0, mid: 12, high: 12 } },
  { id: 'midhigh-40', cloud: { low: 0, mid: 20, high: 20 } },
  { id: 'terrain-open-40', cloud: { low: 5, mid: 20, high: 20 }, terrain: terrainAll(-5, 0, 0) },
  { id: 'terrain-ridge-40', cloud: { low: 5, mid: 20, high: 20 }, terrain: terrainAll(20, 10, 4000) },
  /* 有地形 × 零列表（excluded）：必须整对象逐字节相同（hasTerrain 真分支，不是「有山脊」）。
     low 0 保证零标记；mid+high=24 低于标记下界 25。 */
  { id: 'terrain-excluded-24', cloud: { low: 0, mid: 12, high: 12 }, terrain: terrainAll(-5, 0, 0) },
  /* 有地形 × 25–40：唯一允许「不逐字节相同」的地形场景——同一档 +8，口径仍是山体/DEM。 */
  { id: 'terrain-midhigh-30', cloud: { low: 5, mid: 15, high: 15 }, terrain: terrainAll(-5, 0, 0) },
]
SYNTH.forEach(s => {
  const extra = {}
  if (s.terrain) extra.terrain = s.terrain
  SCENARIOS.push({
    id: 'synth:' + s.id,
    kind: 'synth',
    terrain: !!s.terrain,
    cloudMidHigh: s.cloud.mid + s.cloud.high,
    ctx: synthCtx(day(s.cloud), extra),
  })
})

/* ---------- 对拍 ---------- */

SCENARIOS.forEach(sc => {
  scenarios += 1
  const bucket = sc.kind === 'real' ? realStats : synthStats
  bucket.days += 1
  const a = preSky.summarize(sc.ctx)
  const b = postSky.summarize(sc.ctx)
  if (!a || !b) { bad(sc.id + '：summarize 返回 null'); return }

  /* ① items 完整性：顺序与集合都不许动（减卡/换序会让总评与页面卡序失去可比性） */
  const keySeq = res => (res.items || []).map(i => i.key).join(',')
  if (a.items.length !== b.items.length) bad(sc.id + '：items.length ' + a.items.length + '→' + b.items.length)
  if (keySeq(a) !== keySeq(b)) bad(sc.id + '：items 键序/集合变了（' + keySeq(a) + ' → ' + keySeq(b) + '）')

  /* ① marks / night / sun / moon */
  if (JSON.stringify(a.marks) !== JSON.stringify(b.marks)) bad(sc.id + '：marks 变了')
  if (JSON.stringify(a.night) !== JSON.stringify(b.night)) bad(sc.id + '：night 变了')
  if (JSON.stringify(a.sun) !== JSON.stringify(b.sun)) bad(sc.id + '：sun 变了')
  if (JSON.stringify(a.moon) !== JSON.stringify(b.moon)) bad(sc.id + '：moon 变了')

  /* ① 其余五项 */
  ;['light', 'cloudSea', 'star', 'galaxy', 'rainbow'].forEach(key => {
    const ai = byKey(a, key)
    const bi = byKey(b, key)
    if (JSON.stringify(ai) !== JSON.stringify(bi)) bad(sc.id + '：' + key + ' 变了')
  })

  const aa = byKey(a, 'alpenglow')
  const ba = byKey(b, 'alpenglow')
  if (!aa || !ba) { bad(sc.id + '：alpenglow 缺失'); return }

  /* ② 锚点/窗口/判定不许变 */
  FIXED_FIELDS.forEach(f => {
    if (JSON.stringify(aa[f]) !== JSON.stringify(ba[f])) bad(sc.id + '：alpenglow.' + f + ' 变了')
  })

  /* ⑥ 总评：items 相同 ⇒ 总评必须相同；总评不同 ⇒ alpenglow.score 必须不同 */
  const ao = preCond.overallGrade(clone(a.items))
  const bo = postCond.overallGrade(clone(b.items))
  const sameItems = JSON.stringify(a.items) === JSON.stringify(b.items)
  const sameOverall = JSON.stringify(ao) === JSON.stringify(bo)
  if (sameItems && !sameOverall) bad(sc.id + '：items 逐字节相同但总评变了')
  if (!sameOverall) {
    overallChanges += 1
    if (aa.score === ba.score) bad(sc.id + '：总评变了但 alpenglow.score 没变')
  }

  if (sc.terrain) {
    const identical = JSON.stringify(aa) === JSON.stringify(ba)
    const preExcluded = aa.verdict === 'excluded'
    const preStrong = /中高云可被染色/.test(aa.text)
    /* ③ 阳性对照的适用范围：pre 为 excluded，或 pre 是 ≥40 的 possible（text 含 +14 理由）。
       这两类必须整对象逐字节相同。 */
    if (preExcluded || preStrong) {
      if (!identical) {
        bad(sc.id + '：有地形场景 alpenglow 不再逐字节相同')
        return
      }
      if (preExcluded) {
        terrainExcludedIdentical += 1
      } else if (aa.verdict === 'possible' && Object.keys(a.marks || {}).length > 0) {
        terrainIdentical += 1
      } else {
        bad(sc.id + '：有地形逐字节相同但 verdict/marks 不满足阳性对照条件')
      }
      return
    }
    /* 唯一例外：terrain × 25–40（pre possible 且没有「中高云可被染色」）——
       同一档 +8 与理由补充，但口径仍是山体/DEM。 */
    if (aa.verdict === 'possible') {
      let ok = true
      const fail = msg => { ok = false; bad(sc.id + '：' + msg) }
      if (ba.verdict !== 'possible') fail('terrain×25–40 的 verdict 从 possible 变成 ' + ba.verdict)
      if (ba.score - aa.score !== 8) fail('terrain×25–40 的分数变化 ' + aa.score + '→' + ba.score + '（应为 +8）')
      if (!/中高云偏少/.test(ba.text)) fail('terrain×25–40 的 text 缺「中高云偏少」')
      if (!/山体被光染/.test(ba.text)) fail('terrain×25–40 的 text 不再说「山体被光染」')
      if (aa.look !== ba.look) fail('terrain×25–40 的 look 不再逐字节相同')
      if (ba.look.indexOf('看山脊线') === -1 || /天空与山脊线/.test(ba.look)) {
        fail('terrain×25–40 的 look 不再指向山脊线')
      }
      if (ok) {
        terrainTier8 += 1
        if (sameOverall) scoreChangedOverallSame += 1
        else tier8OverallChanged += 1
      }
      return
    }
    bad(sc.id + '：有地形场景的 pre 既非 excluded、也非 possible/≥40 或 25–40 例外')
    return
  }

  /* ④ 无地形：只允许 text/look/score/tone/label 变化 */
  const keys = Object.keys(aa).sort().join(',')
  if (keys !== Object.keys(ba).sort().join(',')) bad(sc.id + '：alpenglow 字段集合变了')
  Object.keys(aa).forEach(f => {
    if (ALLOWED_CHANGED.indexOf(f) === -1 && JSON.stringify(aa[f]) !== JSON.stringify(ba[f])) {
      bad(sc.id + '：alpenglow.' + f + ' 不在允许变化清单里')
    }
  })
  if (aa.text !== ba.text) {
    noTerrainTextChanged += 1
    bucket.changed += 1
  }
  if (aa.look !== ba.look) noTerrainLookChanged += 1

  /* 无地形 excluded 收紧：只允许文案变，读数（look/score/tone/label）必须原样——
     否则「把排除结论重算一遍」可以悄悄改分改档，而文案仍在说概率很低。 */
  if (ba.verdict === 'excluded') {
    ;['look', 'score', 'tone', 'label'].forEach(f => {
      if (JSON.stringify(aa[f]) !== JSON.stringify(ba[f])) {
        bad(sc.id + '：无地形 excluded 的 ' + f + ' 变了（只允许 text 变化）')
      }
    })
  }

  const delta = ba.score - aa.score
  if (delta === 8) {
    if (/中高云可被染色/.test(aa.text)) bad(sc.id + '：+8 之前就有「中高云可被染色」⇒ 不是新档位')
    if (!/中高云偏少/.test(ba.text)) bad(sc.id + '：+8 但文案没有「中高云偏少」')
    if (sameOverall) scoreChangedOverallSame += 1
    else tier8OverallChanged += 1
    tier8 += 1
    bucket.tier8 += 1
    if (sc.kind === 'real') realTier8 += 1
  } else if (delta !== 0) {
    bad(sc.id + '：无地形分数变化 ' + aa.score + '→' + ba.score + '（只允许 0 或 +8）')
  } else if (ba.verdict === 'possible') {
    possibleScoreUnchanged += 1
    bucket.unchangedScore += 1
  } else if (ba.verdict === 'excluded') {
    excludedUnchanged += 1
    bucket.unchangedScore += 1
  }

  /* ⑤ 无地形：主语与披露都必须正向可查（不只是「没出现某词」） */
  if (ba.verdict === 'possible') {
    if (/山体被光染/.test(ba.text)) bad(sc.id + '：无地形 possible 仍在说「山体被光染」')
    if (ba.text.indexOf('天空与中高云有被染色的条件') === -1) bad(sc.id + '：无地形 possible 缺「天空与中高云有被染色的条件」')
    if (ba.text.indexOf('没有目标山峰数据') === -1) bad(sc.id + '：无地形 possible 缺「没有目标山峰数据」')
    if (ba.text.indexOf('判断不了哪座山会被染') === -1) bad(sc.id + '：无地形 possible 缺「判断不了哪座山会被染」')
    if (ba.look.indexOf('看天空与山脊线') === -1) bad(sc.id + '：无地形 possible 的 look 不含「看天空与山脊线」')
  }
  if (ba.verdict === 'excluded') {
    if (/山体被光染/.test(ba.text)) bad(sc.id + '：无地形 excluded 仍在说「山体被光染」')
    if (ba.text.indexOf('天空与中高云被染色的概率很低') === -1) {
      bad(sc.id + '：无地形 excluded 缺「天空与中高云被染色的概率很低」')
    }
  }
})

/* ---------- 输出 ---------- */
console.log('场景 ' + scenarios + '（真实 ' + realStats.days + ' + 合成 ' + synthStats.days + '）')
console.log('无地形文案变化：' + noTerrainTextChanged + '（其中 look 同步变化 ' + noTerrainLookChanged + '）')
console.log('25–40 档 +8：' + tier8 + '（真实 ' + realTier8 + ' / 合成 ' + synthStats.tier8 + '）')
console.log('有地形逐字节相同（≥40 possible 阳性对照）：' + terrainIdentical)
console.log('有地形 excluded 逐字节相同（阳性对照）：' + terrainExcludedIdentical)
console.log('terrain×25–40 同档 +8（唯一例外）：' + terrainTier8)
console.log('无地形 possible 且分数不变（阳性对照）：' + possibleScoreUnchanged)
console.log('无地形 excluded 且分数不变（阳性对照）：' + excludedUnchanged)
console.log('delta=8 但总评未变（仅报告）：' + scoreChangedOverallSame)
console.log('delta=8 且总评也变（仅报告）：' + tier8OverallChanged)
console.log('总评变化：' + overallChanges)
console.log('越界：' + overreach)
if (notes.length) notes.forEach(n => console.log('  ✗ ' + n))

let exit = 0
if (overreach > 0) { console.log('FAIL：存在越界差异'); exit = 1 }
if (noTerrainTextChanged === 0) { console.log('FAIL：空改——无地形文案一处都没变'); exit = 1 }
if (tier8 === 0) { console.log('FAIL：空改——25–40 档没有任何场景真的 +8'); exit = 1 }
if (realTier8 === 0) { console.log('FAIL：空改——真实 28 天里没有 25–40 档的 +8'); exit = 1 }
if (terrainIdentical === 0) { console.log('FAIL：阳性对照缺失——≥40 possible 的地形场景没有一组逐字节相同'); exit = 1 }
if (terrainExcludedIdentical === 0) { console.log('FAIL：阳性对照缺失——地形 excluded 场景没有一组逐字节相同'); exit = 1 }
if (terrainTier8 === 0) { console.log('FAIL：阳性对照缺失——terrain×25–40 的 +8 例外没有出现'); exit = 1 }
if (possibleScoreUnchanged === 0) { console.log('FAIL：阳性对照缺失——无地形 possible 场景分数全在变'); exit = 1 }
if (excludedUnchanged === 0) { console.log('FAIL：阳性对照缺失——无地形 excluded 场景分数全在变'); exit = 1 }
if (exit === 0) {
  console.log('PASS：差异只落在「无地形文案主语改口 + 25–40 档 +8（含 terrain×25–40 例外）」，有地形其余分支与其余五项逐字节相同')
}
process.exit(exit)
