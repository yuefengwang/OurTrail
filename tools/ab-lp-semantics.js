/* 光污染语义合一（C1 / F1+F2）的差分对拍：改前工作树 vs 本轮工作树
 *
 * ── 基线从哪来 ────────────────────────────────────────────────────────
 * `git archive HEAD` 不能用：HEAD 早于光污染功能（`lightPollution` 是工作树里未提交的改动），
 * 拿它当"改前"会把整片新功能都算成差异。本轮开工前把整个 `miniprogram/` 快照到
 * `D:/ot-baselines/c1/`（可用 PRE_ROOT 覆盖），脚本先校验基线 `sky.js` 与
 * `conditions.js` 的 md5；文件缺失或哈希不符一律 exit 2（INVALID harness），**不是通过**。
 *
 * ── 允许的差异（写死；别的一律越界）──────────────────────────────────
 * ① 未传 lightPollution / 显式 null（"缺测"两种真实形态）：
 *    star / galaxy 只许 **分数不升**，需要封顶的那些天必须恰好落到 69；
 *    text 可变，但判过天气的那些天必须出现「未计入光污染」；verdict 必须不变。
 * ② Bortle 8（光污染较高）：star / galaxy 分数只许不升、封顶后 ≤69；
 *    text 里「光污染较高」只许出现一次（判词与证据句不许重复）。
 * ③ Bortle 2（阳性对照）：六项全部字段 + marks + 证据行必须逐字节相同。
 *    没有这条，"全都变了"分不清是闸在判还是把整页推倒重写。
 * ④ 其余四项（light/alpenglow/cloudSea/rainbow）在任何变体下逐字节相同。
 * ⑤ conditions.factsFor：只有 star/galaxy 的「光污染未计入」证据行允许增减；
 *    其余证据行逐字节相同；有读数时两侧都不许出现该行。
 *    ctx 按生产形状带上 summarize 算出的 sun/moon/night，否则夜段云量与月照行
 *    恒为空，"其余证据行相同"会退化成空断言。
 * ⑥ 两侧的 items 数量与每项字段集合必须完全一致：只比已知字段会放过新增字段。
 *
 * ── 空改门 ──────────────────────────────────────────────────────────
 * 28 个真实地点日里，至少有一天 star 或 galaxy 真的被从 >69 封到 69；否则这道闸
 * 在生产数据上从没生效过，等于白改，exit 1（与彩虹轮/沉默闸同一口径）。
 *
 * 两侧各自 require 各自的模块实例；运行：node tools/ab-lp-semantics.js
 *
 * ── 为什么两端都是快照（2026-10-21 C2 起）──────────────────────────────
 * C2 的云海民用晨昏裁剪会**合法地**改变 cloudSea 的 window/text/score；若后侧继续读工作树，
 * 这份 C1 对拍会报出 52 条"越界"，把别轮的故意变化误判成 C1 回归（实测发生）。
 * 因此后侧固定为 post-C1 快照（D:/ot-baselines/c2，双 md5 钉）：
 * 它证明的是「C1 当时把什么改成了什么」，**不是**「当前工作树无回归」。
 * 后续提交的回归由各自的 A/B 负责。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const PRE_ROOT = process.env.PRE_ROOT || path.join('D:', 'ot-baselines', 'c1')
const POST_ROOT = process.env.POST_ROOT || path.join('D:', 'ot-baselines', 'c2')
const PRE_SKY_MD5 = '09d5fe35684cd54ed13c364d90099895'
const PRE_COND_MD5 = 'd59ff0c2ecf02c779fd4349718007c85'
const POST_SKY_MD5 = 'fa6d78d3d6064b291a0c731879f9a57e'
const POST_COND_MD5 = 'c7df68ad539ea46e934174cf4d823979'
const REAL = path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json')

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
}

const preSkyPath = path.join(PRE_ROOT, 'miniprogram/utils/sky.js')
const preCondPath = path.join(PRE_ROOT, 'miniprogram/utils/conditions.js')
const postSkyPath = path.join(POST_ROOT, 'miniprogram/utils/sky.js')
const postCondPath = path.join(POST_ROOT, 'miniprogram/utils/conditions.js')
if (!fs.existsSync(preSkyPath) || !fs.existsSync(preCondPath)) {
  console.error('INVALID：改前快照不可达 ' + PRE_ROOT + '（缺 utils/sky.js 或 conditions.js）')
  process.exit(2)
}
if (!fs.existsSync(postSkyPath) || !fs.existsSync(postCondPath)) {
  console.error('INVALID：改后快照不可达 ' + POST_ROOT + '（缺 utils/sky.js 或 conditions.js）')
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

if (preSky === postSky || preCond === postCond
  || typeof preSky.cap69 !== 'undefined' || typeof postSky.cap69 !== 'function') {
  console.error('INVALID：两侧模块实例没分开或对拍方向不对')
  process.exit(2)
}

const snap = JSON.parse(fs.readFileSync(REAL, 'utf8'))
const VARIANTS = [
  { id: 'absent', mode: 'missing', extra: {} },
  { id: 'null', mode: 'missing', extra: { lightPollution: null } },
  { id: 'dark', mode: 'control', extra: { lightPollution: { bortle: 2, sqm: 21.8 } } },
  { id: 'poor', mode: 'poor', extra: { lightPollution: { bortle: 8, sqm: 18 } } },
]
const FIELDS = ['key', 'title', 'window', 'look', 'text', 'score', 'tone', 'label', 'verdict']
const TARGET = ['star', 'galaxy']
const LIMIT_ROW = /光污染未计入/

let cases = 0
let targetDiffs = 0
let cappedDiff = 0
let disclosedNew = 0
let evidenceNewlyDisclosed = 0
let overreach = 0
const notes = []
const perVariant = {}

function bad(msg) {
  overreach += 1
  if (notes.length < 40) notes.push(msg)
}

function factsOf(cond, key, ctx) {
  return cond.factsFor(key, ctx)
}

function splitLimit(rows) {
  const limit = rows.filter(r => LIMIT_ROW.test(r.fact))
  const rest = rows.filter(r => !LIMIT_ROW.test(r.fact))
  return { limit, rest }
}

Object.keys(snap.places).forEach(placeKey => {
  const place = snap.places[placeKey]
  const dates = Array.from(new Set(place.series.map(h => h.d)))
  dates.forEach(date => {
    const detail = place.series.filter(h => h.d === date)
    const base = {
      date, lat: place.wgs[0], lng: place.wgs[1], elevation: place.elevation, elevOK: true,
      detail, series: place.series, cloudLevels: place.cloudLevels, days: [], heading: null,
    }
    VARIANTS.forEach(v => {
      cases += 1
      const ctx = Object.assign({}, base, v.extra)
      const a = preSky.summarize(ctx)
      const b = postSky.summarize(ctx)
      const where = placeKey + '/' + date + '/' + v.id
      perVariant[v.id] = perVariant[v.id] || { cases: 0, diffs: 0, capped: 0 }
      perVariant[v.id].cases += 1

      // ① 六项逐字段；目标项按变体规则
      if (a.items.length !== b.items.length) bad(where + ' items 数量变了 ' + a.items.length + '→' + b.items.length)
      a.items.forEach((ia, i) => {
        const ib = b.items[i]
        if (!ib) { bad(where + ' items 数量变了'); return }
        /* 字段集合必须完全一致：只比 FIELDS 里的九个字段会放过"目标项新增了一个
           没人认识的字段"（呈现层可能读它），也会放过非目标项的任何附加字段。 */
        const ka = Object.keys(ia).sort().join(',')
        const kb = Object.keys(ib).sort().join(',')
        if (ka !== kb) bad(where + ' ' + ia.key + ' 字段集合变了：' + ka + ' → ' + kb)
        const isTarget = TARGET.indexOf(ia.key) !== -1
        const fieldDiff = FIELDS.filter(f => ia[f] !== ib[f])

        if (!isTarget || v.mode === 'control') {
          if (fieldDiff.length) bad(where + ' 越界 ' + ia.key + '.' + fieldDiff.join(','))
          return
        }

        if (ia.key !== 'star' && ia.key !== 'galaxy') return
        /* 目标项只允许「因封顶而变」的四个字段：text / score / tone / label。
           key/title/window/look 是结论的身份与锚点，任何变化都是越界；
           tone/label 虽由 score 派生，也必须与 grade(新分数) 自洽，不能独立漂移。 */
        const structural = ['key', 'title', 'window', 'look'].filter(f => ia[f] !== ib[f])
        if (structural.length) bad(where + ' ' + ia.key + ' 目标项结构字段变了 ' + structural.join(','))
        if (fieldDiff.length) {
          targetDiffs += fieldDiff.length
          perVariant[v.id].diffs += fieldDiff.length
        }
        if (ia.verdict !== ib.verdict) bad(where + ' ' + ia.key + ' verdict 变了 ' + ia.verdict + '→' + ib.verdict)
        /* 封顶语义只有两种合法走向：越界（>69）恰落到 69；未越界逐字不动。
           允许"任意下降"会让判据把真实的判据改动也当成封顶。 */
        if (ia.score > 69) {
          if (ib.score !== 69) bad(where + ' ' + ia.key + ' 越 69 必须恰落到 69：' + ia.score + '→' + ib.score)
          else if (v.mode !== 'control') { cappedDiff += 1; perVariant[v.id].capped += 1 }
        } else if (ib.score !== ia.score) {
          bad(where + ' ' + ia.key + ' 未越界时分数必须逐字相同：' + ia.score + '→' + ib.score)
        }
        const gb = postSky.grade(ib.score)
        if (ib.tone !== gb.tone || ib.label !== gb.label) {
          bad(where + ' ' + ia.key + ' tone/label 与 grade(' + ib.score + ') 不一致')
        }

        // "判过天气"的两种文案形态：星空的暗夜统计、银河的银心高度句
        const assessed = ia.key === 'star' ? /暗夜晴空/.test(ia.text) : /银心在夜段最高/.test(ia.text)
        if (v.mode === 'missing' && assessed) {
          if (!/未计入光污染/.test(ib.text)) bad(where + ' ' + ia.key + ' 缺测却没有披露')
          /* 显式 null 在改前就已披露（旧代码认 === null），只有 absent 才算新增披露。 */
          if (v.id !== 'null' && !/未计入光污染/.test(ia.text)) disclosedNew += 1
        }
        if (v.mode === 'poor' && assessed) {
          const n = (ib.text.match(/光污染较高/g) || []).length
          if (n !== 1) bad(where + ' ' + ia.key + ' 「光污染较高」出现 ' + n + ' 次（应为 1）')
        }
      })

      // ② marks 与夜窗口：与光污染无关，必须逐字节相同
      if (JSON.stringify(a.marks) !== JSON.stringify(b.marks)) bad(where + ' marks 变了')
      if (JSON.stringify(a.night) !== JSON.stringify(b.night)) bad(where + ' night 变了')
      if (JSON.stringify(a.sun) !== JSON.stringify(b.sun) || JSON.stringify(a.moon) !== JSON.stringify(b.moon)) {
        bad(where + ' 日月数据变了')
      }

      // ③ 证据行：只有「光污染未计入」允许增减
      TARGET.forEach(key => {
        /* 生产形状：页面把 summarize 算出的 sun/moon/night 一起传进 factsFor。
           不传这三项时夜段云量/月照等证据行恒为空，清单⑤的"其余证据行逐字节相同"
           就成了空断言（实测发现）。两侧各用自己那侧的日月与夜窗口。 */
        const faCtx = Object.assign({}, ctx, { sun: a.sun, moon: a.moon, night: a.night })
        const fbCtx = Object.assign({}, ctx, { sun: b.sun, moon: b.moon, night: b.night })
        const fa = splitLimit(factsOf(preCond, key, faCtx))
        const fb = splitLimit(factsOf(postCond, key, fbCtx))
        if (JSON.stringify(fa.rest) !== JSON.stringify(fb.rest)) bad(where + ' ' + key + ' 非光污染证据行变了')
        if (v.mode === 'missing') {
          /* null 改前就被识别（旧代码只认 === null），absent（没传字段）改前静默消失——
             这条差值本身就是 F1 的病灶位置，写死成期望而不是"两侧都行"。 */
          const expectedOld = v.id === 'null' ? 1 : 0
          if (fa.limit.length !== expectedOld) bad(where + ' 改前「未计入」证据行应为 ' + expectedOld + ' 条，实得 ' + fa.limit.length)
          if (fb.limit.length !== 1) bad(where + ' 改后应有且仅有一条「未计入」证据行，实得 ' + fb.limit.length)
          if (expectedOld === 1 && JSON.stringify(fa.limit) !== JSON.stringify(fb.limit)) {
            bad(where + ' ' + key + ' 显式 null 的证据行变了')
          }
          if (expectedOld === 0 && fb.limit.length === 1) evidenceNewlyDisclosed += 1
        } else {
          if (JSON.stringify(fa.limit) !== JSON.stringify(fb.limit)) bad(where + ' ' + key + ' 有读数时证据行变了')
          if (fb.limit.length !== 0) bad(where + ' ' + key + ' 有读数却出现「未计入」')
        }
      })
    })
  })
})

console.log('场景 ' + cases + '（4 地点 × 7 天 × 4 种光污染输入）')
Object.keys(perVariant).forEach(k => {
  const v = perVariant[k]
  console.log('  ' + k + '：' + v.cases + ' 例，目标字段差异 ' + v.diffs + '，封顶生效 ' + v.capped)
})
console.log('缺测披露（absent 变体）：改后新增 ' + disclosedNew + ' 处')
console.log('证据行新增「未计入」（absent 变体）：' + evidenceNewlyDisclosed + ' 条')
console.log('目标封顶次数（star/galaxy 从 >69 落到 69）：' + cappedDiff)
console.log('越界：' + overreach)
if (notes.length) notes.forEach(n => console.log('  ✗ ' + n))

let exit = 0
if (overreach > 0) { console.log('FAIL：存在越界差异'); exit = 1 }
if (cappedDiff === 0) { console.log('FAIL：空改——28 天里没有一天真的被封顶'); exit = 1 }
if (disclosedNew === 0) { console.log('FAIL：空改——缺测披露一次都没出现'); exit = 1 }
if (evidenceNewlyDisclosed === 0) { console.log('FAIL：空改——证据行在 absent 变体下一条都没补'); exit = 1 }
if (exit === 0) console.log('PASS：差异只落在允许清单内，阳性对照逐字节相同')
process.exit(exit)
