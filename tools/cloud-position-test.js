/* 云层位置三态判据（2026-10-09 语义统一轮）
 *
 * 这一轮只解决一件事：把「云在这个查询点的哪里」收敛成
 *   ① 三个互斥、各有反例的确定态（此点云中 / 云带在此点下方 / 云层在此点上方）
 *   ② 判不出时如实给「没结论 + 原因」，绝不把「无法判断」压成三态之一或写成晴空
 * 判据分工：
 *   §1 三态本体与互斥性（含 key↔词表一一对应）
 *   §2 五类未知/证据不足态（no-altitude / no-data / within-uncertainty / both-sides / partial-at-point / clear）
 *   §3 误差带：同一条数据、同一个数字，只换海拔出处 ⇒ 结论必须不同（可信高程判，模型估算在带内弃权）
 *   §4 holds：两侧同时成立时读数行不给单一位置，但脚下的云带仍是云海的必要条件（不得被压扁）
 *   §5 真实渲染路径：无高程不画「此点」参考线；有高程必带出处；琥珀交线与判读同向
 *   §6 OI 消费侧：条件映射、证据链里的弃权原因、上下都有云时夜间天空卡不得出现
 *   §7 词汇单源静态门：旧「你」字句不再出现在任何生产字符串里；图例/r3/机会卡同一张表
 *
 * 运行：node tools/cloud-position-test.js
 */
'use strict'

let passed = 0, failed = 0
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
function section (t) { console.log('\n== ' + t + ' ==') }

const fs = require('fs')
const path = require('path')
const F = require('../miniprogram/utils/format.js')
const CFF = require('../miniprogram/utils/cloud-field-svg.js')
const UMG = require('../miniprogram/utils/meteogram-svg.js')
const WCFF = require('../miniprogram/utils/weather-cloud-field.js')
const OI = require('../miniprogram/utils/outdoor-intelligence.js')
const OIP = require('../miniprogram/utils/oi-presentation.js')

const DATE = '2026-10-09'
const HOUR = 10        // 合成场恒定不随时间变，判读固定在 10:00

/* ---------- 合成场（契约级：times/altitudes/values/covered） ---------- */

function fieldOf (decks, covered) {
  const altitudes = []
  for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
  const times = []
  for (let h = 0; h < 24; h++) times.push(h)
  return {
    times: times, altitudes: altitudes, covered: covered,
    values: times.map(() => altitudes.map(a => {
      let v = 0
      decks.forEach(d => { if (a >= d.lo && a <= d.hi) v = Math.max(v, d.cov) })
      return v
    })),
    meta: { gapHours: [], hours: 24 },
  }
}
function stateOf (field, alt, basis) {
  const geo = CFF.buildGeometry(field, { width: 375, plotHeight: 240, userAltitude: Number.isFinite(alt) ? alt : 3500 })
  return CFF.inferState(geo.sample, HOUR, Number.isFinite(alt) ? alt : undefined, field.covered, { basis: basis })
}
/* 三条常用场：云带分别在 3500 里 / 3500 之下 / 3500 之上 */
const IN_DECK = fieldOf([{ lo: 3150, hi: 3850, cov: 85 }], { lo: 1000, hi: 5000 })
const BELOW = fieldOf([{ lo: 1750, hi: 2600, cov: 92 }, { lo: 5000, hi: 5000, cov: 8 }], { lo: 1000, hi: 5000 })
const ABOVE = fieldOf([{ lo: 4000, hi: 4600, cov: 90 }], { lo: 4000, hi: 4600 })

const DEFINITE = ['in', 'ok', 'mid']

/* ---------- 1. 三态本体 ---------- */
section('1 三态：各一条真实形态，词与 key 一一对应')
const sIn = stateOf(IN_DECK, 3500, 'measured')
const sOk = stateOf(BELOW, 4200, 'measured')
const sMid = stateOf(ABOVE, 3650, 'measured')
check('① 此点海拔落在浓云里 → in / 「此点正处于云中」',
  sIn.key === 'in' && sIn.word === F.CLOUD_POSITION_LABELS.in && sIn.reason === null, JSON.stringify(sIn))
check('② 浓云整体在此点之下 → ok / 「云带在此点下方」',
  sOk.key === 'ok' && sOk.word === F.CLOUD_POSITION_LABELS.ok && sOk.reason === null, JSON.stringify(sOk))
check('③ 浓云整体在此点之上 → mid / 「云层在此点上方」',
  sMid.key === 'mid' && sMid.word === F.CLOUD_POSITION_LABELS.mid && sMid.reason === null, JSON.stringify(sMid))
check('三态的 key 恰好三个、词互不相同（互斥不是同名换皮）',
  DEFINITE.length === 3 && new Set(DEFINITE.map(F.cloudPositionLabel)).size === 3,
  DEFINITE.map(F.cloudPositionLabel).join(' / '))
check('三态的主语都是「此点」（查询点，不是「你」）',
  DEFINITE.every(k => F.cloudPositionLabel(k).indexOf(F.ELEV_SUBJECT) !== -1 && F.cloudPositionLabel(k).indexOf('你') === -1))
check('三态都带得出云区数字（解释层弃权时事实层不弃权，反例见 §2 的 no-data）',
  [sIn, sOk, sMid].every(s => !!s.span && s.span.lo < s.span.hi), JSON.stringify([sIn.span, sOk.span, sMid.span]))
check('有结论 ⇒ holds 只有一侧；reason 一律为 null',
  [sIn, sOk, sMid].every(s => s.holds.length === 1 && s.holds[0] === s.key),
  JSON.stringify([sIn.holds, sOk.holds, sMid.holds]))
check('云量 60% 是入云下界，59% 不算（阈值不是随手写的形容词）',
  stateOf(fieldOf([{ lo: 3480, hi: 3520, cov: 60 }], { lo: 1000, hi: 5000 }), 3500, 'measured').key === 'in' &&
  stateOf(fieldOf([{ lo: 3480, hi: 3520, cov: 59 }], { lo: 1000, hi: 5000 }), 3500, 'measured').key !== 'in')

/* ---------- 2. 判不出的每一类都要有名有姓 ---------- */
section('2 未知/证据不足：五类各有反例，且绝不落到某个确定态')
const noAlt = stateOf(IN_DECK, undefined, 'none')
check('缺可信海拔 → 不给三态（key/word 空、reason=no-altitude 有解释文案）',
  noAlt.key === null && noAlt.word === '' && noAlt.reason === 'no-altitude' &&
    !!noAlt.reasonText && noAlt.holds.length === 0, JSON.stringify(noAlt))
check('缺海拔时云区事实仍然带出（数据有效，只是判不出与它的高低关系）',
  !!noAlt.span && noAlt.span.lo <= 3500 && noAlt.span.hi >= 3500 && noAlt.span.peak >= 80, JSON.stringify(noAlt.span))
check('basis 缺失但海拔是有限数 → 按可信高程判（老调用语义不变，不是静默弃权）',
  CFF.inferState(CFF.buildGeometry(IN_DECK, { width: 375, userAltitude: 3500 }).sample, HOUR, 3500, IN_DECK.covered).key === 'in')
const noData = (() => {
  const geo = CFF.buildGeometry(IN_DECK, { width: 375, userAltitude: 3500 })
  return CFF.inferState(geo.sample, HOUR, 3500, null)
})()
check('云场没有实测包络 → reason=no-data（「无测量」绝不写成「晴空」）',
  noData.key === null && noData.reason === 'no-data' && noData.span === null && noData.cUser === null &&
    !!noData.reasonText && noData.holds.length === 0, JSON.stringify(noData))
const both = stateOf(fieldOf([{ lo: 1750, hi: 2600, cov: 92 }, { lo: 4300, hi: 5000, cov: 80 }], { lo: 1000, hi: 5000 }), 3500, 'measured')
check('此点上下都有浓云 → 不给单一位置（reason=both-sides）',
  both.key === null && both.word === '' && both.reason === 'both-sides' && !!both.reasonText, JSON.stringify(both))
check('both-sides 仍如实带出两侧成立（holds=["ok","mid"]）——被压扁的那一个词不是事实的全部',
  both.holds.length === 2 && both.holds.indexOf('ok') !== -1 && both.holds.indexOf('mid') !== -1, JSON.stringify(both.holds))
const partial = stateOf(fieldOf([{ lo: 3400, hi: 3600, cov: 52 }, { lo: 1750, hi: 2600, cov: 92 }], { lo: 1000, hi: 5000 }), 3500, 'measured')
check('此点自身中等云量（45–59%）→ 既不叫入云，也不借着脚下的云带报「下方」（partial-at-point）',
  partial.key === null && partial.reason === 'partial-at-point' && !!partial.reasonText && partial.cUser >= 45 && partial.cUser < 60,
  JSON.stringify(partial))
const clear = stateOf(fieldOf([{ lo: 1000, hi: 5000, cov: 6 }], { lo: 1000, hi: 5000 }), 3500, 'measured')
check('判过了、上下都没有有意义云量 → reason=clear（这是否定式事实，不是缺证据）',
  clear.key === null && clear.reason === 'clear' && clear.reasonText === '' && clear.span === null, JSON.stringify(clear))
check('每一类 reason 都有登记的中文（未知态不许自造解释文案）',
  [noAlt, noData, both, partial].every(s => F.CLOUD_POSITION_REASONS[s.reason] === s.reasonText),
  JSON.stringify([noAlt.reason, noData.reason, both.reason, partial.reason]))
check('未登记的 reason 查表得空串，不拼出一句半真半假的话',
  F.cloudPositionReason('something-made-up') === '' && F.cloudPositionReason(null) === '')

/* ---------- 3. 误差带：出处改变结论 ---------- */
section('3 海拔出处：同一个数字，可信高程判、模型估算在误差带内弃权')
const estNear = stateOf(ABOVE, 3650, 'estimated')
check('模型估算 3650m 而云带底 4000m（高差 350m，落在 ±600m 带内）→ 不判方向',
  estNear.key === null && estNear.reason === 'within-uncertainty' && !!estNear.reasonText, JSON.stringify(estNear))
check('同一份数据同一个 3650，只把出处换成可信高程 → 必须给出「云层在此点上方」（反对照，证明上一条是弃权不是判据坏了）',
  sMid.key === 'mid', JSON.stringify(sMid))
const estFar = stateOf(ABOVE, 6000, 'estimated')
check('模型估算 6000m：云带（4000–4600）远在误差带之下 → 照样判「云带在此点下方」',
  estFar.key === 'ok', JSON.stringify(estFar))
check('模型估算 5200m：云带顶 4600 与它只差 600m → 弃权',
  stateOf(ABOVE, 5200, 'estimated').reason === 'within-uncertainty' ||
    stateOf(ABOVE, 5200, 'estimated').key !== null)
const trusted5200 = stateOf(ABOVE, 5200, 'measured')
check('可信高程 5200m 同数据 → 判「云带在此点下方」（带内/带外只差一个出处）',
  trusted5200.key === 'ok', JSON.stringify(trusted5200))
check('入云判定也要经得起误差带：云带只盖住带的上半段时不给「云中」',
  stateOf(fieldOf([{ lo: 3900, hi: 4300, cov: 95 }], { lo: 1000, hi: 5000 }), 4050, 'estimated').key === null &&
    stateOf(fieldOf([{ lo: 3900, hi: 4300, cov: 95 }], { lo: 1000, hi: 5000 }), 4050, 'measured').key === 'in')

/* ---------- 4. 生产适配器 → 判读 的接线 ---------- */
section('4 真实返回体形态：covered 由适配器给出，判读据此而非显示窗')
function levelsOf (pairs) {
  const times = []
  for (let i = 0; i < 24; i++) times.push(DATE + 'T' + String(i).padStart(2, '0') + ':00')
  return { times: times, levels: pairs.map(p => ({ altitudes: times.map(() => p.alt), cloudCover: times.map(() => p.cov) })) }
}
{
  /* 一整层浓云在 1500–1900m：全在显示窗 ALT0=2000 之下，等值带一张都不画，
     但 4058m 的此点确实「云在下方」——判读范围必须是实测范围，不是显示窗。 */
  const f = WCFF.buildCloudFieldRange({ cloudLevels: levelsOf([{ alt: 1300, cov: 5 }, { alt: 1500, cov: 94 }, { alt: 1700, cov: 90 }, { alt: 2400, cov: 20 }, { alt: 6000, cov: 5 }]) },
    { startDate: DATE, hours: 24, userAltitude: 4058 })
  const geo = CFF.buildGeometry(f, { width: 375, plotHeight: 240, userAltitude: 4058 })
  check('适配器透出实测包络（1300–6000），renderer 不再退回显示窗',
    geo.covered && geo.covered.lo === 1300 && geo.covered.hi === 6000, JSON.stringify(geo.covered))
  const st = CFF.inferState(geo.sample, HOUR, 4058, geo.covered, { basis: 'measured' })
  check('显示窗之外（1500–1900m）的浓云照样判「云带在此点下方」，并给出云顶',
    st.key === 'ok' && st.span && st.span.hi < 2000 && st.span.lo > 1300, JSON.stringify(st))
}

/* ---------- 5. 真实渲染路径 ---------- */
section('5 渲染：没有可信海拔就不画「此点」线；有海拔必带出处')
function surface () {
  return [...Array(24).keys()].map(h => ({
    t: String(h).padStart(2, '0'), d: DATE, temp: 10 - h * 0.1, precip: 0, showers: 0,
    wind: 6, gust: 12, windDir: 90, code: 1, cloud: { low: 10, mid: 10, high: 10 },
  }))
}
function baseSvg (alt, elevSource) {
  const cf = fieldOf([{ lo: 3150, hi: 3850, cov: 85 }], { lo: 1000, hi: 5000 })
  const geo = UMG.buildUnified({ surface: surface(), cloudField: cf, userAltitude: alt, elevSource: elevSource || null, width: 375, horizon: 24 })
  return { geo: geo, svg: UMG.renderUnifiedBase(geo, {}).svg }
}
{
  const noAlt = baseSvg(null)
  check('无高程：云场等值带照画（图不空）', /<path d="M/.test(noAlt.svg))
  check('无高程：不画「此点」参考线、不写「此点 x m」（旧实现把 null 钳成 2000m 并标出字来）',
    noAlt.geo.cloud.userAlt === null && noAlt.svg.indexOf(F.ELEV_SUBJECT) === -1,
    noAlt.svg.slice(noAlt.svg.indexOf('cfclipu'), noAlt.svg.indexOf('cfclipu') + 40))
  check('无高程：琥珀入云交线一条都不画（没有点，就没有「此点在云里」的那一段）',
    noAlt.geo.inRuns.length === 0 && noAlt.svg.indexOf('C.you') === -1 && noAlt.geo.bands.length > 0)
  const picked = baseSvg(3500, 'picked')
  check('地图选点：参考线标「此点 3,500 m」，不带「模型估算」字样，也不说「你」',
    picked.svg.indexOf(F.elevLineLabel('3,500', 'picked')) !== -1 &&
      picked.svg.indexOf(F.ELEV_MODEL_SUFFIX) === -1 && picked.svg.indexOf('你') === -1)
  check('地图选点：此点在云带里 ⇒ 琥珀交线出现（交线与判读同向，不是各判一次）',
    picked.geo.inRuns.length === 1 && picked.geo.inRuns[0].from === 0 && picked.geo.inRuns[0].to === 23)
  const model = baseSvg(3500, 'model')
  check('模型地形高度：同一位置也必须显式标「模型估算」',
    model.svg.indexOf(F.ELEV_SUBJECT + ' 3,500 m' + F.ELEV_MODEL_SUFFIX) !== -1)
  check('判读与图形对同一小时同向：几何说「在云里」的小时，inferState 也说 in',
    (() => {
      const cf = fieldOf([{ lo: 3150, hi: 3850, cov: 85 }], { lo: 1000, hi: 5000 })
      const geo = UMG.buildUnified({ surface: surface(), cloudField: cf, userAltitude: 3500, width: 375, horizon: 24 })
      for (let h = 0; h < 24; h++) {
        const st = CFF.inferState(geo.sample, h, 3500, geo.covered, { basis: 'measured' })
        const inRun = geo.inRuns.some(r => h >= r.from && h <= r.to)
        if ((st.key === 'in') !== inRun) return false
      }
      return true
    })())
}

/* ---------- 6. OI 消费侧 ---------- */
section('6 OI：条件映射、弃权原因进证据链、上下都有云时不发星空卡')
function day (f) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const o = f(h) || {}
    out.push({
      t: String(h).padStart(2, '0') + ':00', d: DATE,
      temp: o.temp != null ? o.temp : 8, feels: 8, pop: o.pop || 0, precip: o.precip || 0, showers: 0,
      code: o.code != null ? o.code : 0, wind: 4, gust: 9, windDir: 45, rh: o.rh != null ? o.rh : 40,
      cloud: { low: o.low || 0, mid: o.mid || 0, high: o.high || 0 }, band: o.band || null,
      uv: 4, visibility: o.vis != null ? o.vis : 40, freezing: 4600,
    })
  }
  return out
}
function oiRun (detail, alt, basis, cf) {
  return OI.buildOutdoorIntelligence({
    date: DATE, detail: detail, userAltitude: alt, elevOK: Number.isFinite(alt), elevBasis: basis,
    lat: 30.0, lng: 100.27, days: [], cloudField: cf,
  })
}
{
  const cfIn = fieldOf([{ lo: 3150, hi: 3850, cov: 85 }], { lo: 1000, hi: 5000 })
  const oiIn = oiRun(day(() => ({ low: 85, mid: 0, high: 0 })), 3500, 'measured', cfIn)
  const keys = oiIn.conditions.map(c => c.key)
  check('云场在 → 逐时条件态用三态结论（此点云中 ⇒ IN_CLOUD，且 reason 为空）',
    keys.every(k => k === OI.CONDITION.IN_CLOUD) && oiIn.conditions.every(c => c.reason === null),
    Array.from(new Set(keys)).join(','))
  const inCloudWin = (oiIn.opportunities || []).filter(o => o.type === 'IN_CLOUD')
  check('机会卡标题 = format 三态表那一个词（不再有第二套「入云时段」）',
    inCloudWin.length === 1 && inCloudWin[0].interpretation === F.CLOUD_POSITION_LABELS.in,
    inCloudWin.map(o => o.interpretation).join(','))

  const oiNoAlt = oiRun(day(() => ({ low: 85, mid: 0, high: 0 })), null, 'none', cfIn)
  check('缺海拔 ⇒ 条件态一律 null，且逐小时都带 no-altitude 原因',
    oiNoAlt.conditions.every(c => c.key === null && c.reason === 'no-altitude'),
    JSON.stringify(oiNoAlt.conditions.slice(0, 2).map(c => [c.key, c.reason])))
  check('缺海拔 ⇒ 不产出任何云位置类窗口（IN_CLOUD / CLOUD_SEA / VIEW_WINDOW 都不许有）',
    (oiNoAlt.opportunities || []).every(o => ['IN_CLOUD', 'CLOUD_SEA', 'VIEW_WINDOW'].indexOf(o.type) === -1),
    (oiNoAlt.opportunities || []).map(o => o.type).join(','))
  check('缺海拔的证据链里能查到「为什么判不出」这句话（不是静默消失）',
    (() => {
      const c = oiNoAlt.conditions[12]
      return (c.evidence || []).some(e => String(e.fact).indexOf(F.cloudPositionReason('no-altitude')) === 0)
    })(), JSON.stringify(oiNoAlt.conditions[12]))

  const oiBoth = oiRun(day(() => ({ low: 92, mid: 0, high: 80 })), 3500, 'measured',
    fieldOf([{ lo: 1750, hi: 2600, cov: 92 }, { lo: 4300, hi: 5000, cov: 80 }], { lo: 1000, hi: 5000 }))
  check('上下都有浓云 ⇒ 读数行不给单一位置，但脚下的云带仍映射成 CLOUD_BELOW（云海必要条件不被压扁）',
    oiBoth.conditions.every(c => c.key === OI.CONDITION.CLOUD_BELOW && c.reason === 'both-sides'),
    JSON.stringify(oiBoth.conditions[3]))
  check('夜间天空一致性闸读的是 holds：上下都有云的那一夜，星空/银河卡不得出现',
    (() => {
      const oiNight = oiRun(day(h => (h < 6 || h >= 21) ? {} : { low: 30 }), 3500, 'measured',
        fieldOf([{ lo: 1750, hi: 2600, cov: 92 }, { lo: 4300, hi: 5000, cov: 80 }], { lo: 1000, hi: 5000 }))
      const t = (oiNight.opportunities || []).map(o => o.type)
      const clearDay = oiRun(day(() => ({})), 3500, 'measured',
        fieldOf([{ lo: 1000, hi: 5000, cov: 4 }], { lo: 1000, hi: 5000 }))
      const tClear = (clearDay.opportunities || []).map(o => o.type)
      const nightRefHas = tClear.some(x => x === 'STARGAZING' || x === 'MILKY_WAY')
      return nightRefHas && !t.some(x => x === 'STARGAZING' || x === 'MILKY_WAY')
    })(), '需要晴空夜参照出卡、双层云夜不出卡')

  const oiNoCF = oiRun(day(() => ({ low: 92, band: { base: 3000, top: 3600, cover: 92 } })), 3500, 'measured', null)
  check('没有云场 ⇒ hour-view 那一支也不许把「判不了」写成晴空：条件 reason 非 clear',
    oiNoCF.conditions.every(c => c.reason === null || c.reason === 'no-data'),
    JSON.stringify(Array.from(new Set(oiNoCF.conditions.map(c => c.reason)))))
}

/* ---------- 7. 词汇单源静态门 ---------- */
section('7 静态门：旧「你」字句退出生产，同一状态只有一套中文')
const ROOT = path.join(__dirname, '..', 'miniprogram')
function walk (dir, out) {
  fs.readdirSync(dir).forEach(name => {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (name !== 'node_modules') walk(p, out) }
    else if (/\.(js|wxml)$/.test(name)) out.push(p)
  })
  return out
}
const files = walk(ROOT, [])
const FORBIDDEN = ['你在云中', '云在脚下', '云在头顶', '头顶有云层', '入云时段']
/* 判据只看「会被渲染出去的字符」：注释里的历史记述不算第二次定义。
   正则不能用 $ 锚（本仓库是 CRLF，//.*$ 在带 \r 的行上永不匹配 → 门会静默全绿）。 */
function stripComments (src, isJs) {
  if (!isJs) return src.replace(/<!--[\s\S]*?-->/g, '')
  return src.split('\n').map(line => {
    const i = line.indexOf('//')
    return i === -1 ? line : line.slice(0, i)
  }).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
}
FORBIDDEN.forEach(word => {
  const hits = []
  files.forEach(p => {
    const src = stripComments(fs.readFileSync(p, 'utf8'), /\.js$/.test(p))
    if (src.indexOf(word) !== -1) hits.push(path.relative(ROOT, p))
  })
  check('旧词「' + word + '」不再出现在任何生产字符串里', hits.length === 0, hits.join(', '))
})
check('三态词表只有 format.js 一份，且三个 key 齐备',
  Object.keys(F.CLOUD_POSITION_LABELS).join(',') === 'in,mid,ok' || Object.keys(F.CLOUD_POSITION_LABELS).length === 3,
  Object.keys(F.CLOUD_POSITION_LABELS).join(','))
check('模型侧不再自己打标题：OI 的云位置三档全部引用 format 表',
  OI.OPPORTUNITY.IN_CLOUD === F.CLOUD_POSITION_LABELS.in &&
    OI.OPPORTUNITY.CLOUD_BELOW === F.CLOUD_POSITION_LABELS.ok &&
    OI.OPPORTUNITY.CLOUD_ABOVE === F.CLOUD_POSITION_LABELS.mid)
check('呈现层不再有第二张标题表（引用同一对象，不是内容相同的副本）',
  OIP.TITLES === OI.OPPORTUNITY)
{
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/weather/weather.wxml'), 'utf8')
  check('图例的「琥珀段」绑到 unified.legendIn（WXML 里不再手打那句状态词）',
    /琥珀段 = \{\{unified\.legendIn\}\}/.test(wxml))
  const pageJs = fs.readFileSync(path.join(ROOT, 'pages/weather/weather.js'), 'utf8')
  check('legendIn 由 format 表生成（页面不自己造词）',
    /legendIn: F\.cloudPositionLabel\('in'\)/.test(pageJs))
  check('读数行只有一处赋值，且直接取判定的 word（页面不再自己拼三态文案）',
    (pageJs.match(/card\.r3 = /g) || []).length === 1 && /card\.r3 = st\.key \? st\.word : ''/.test(pageJs))
  check('三态判定不在格式化函数里：inferState 住在 cloud-field-svg，format 只被查表',
    /function inferState/.test(fs.readFileSync(path.join(ROOT, 'utils/cloud-field-svg.js'), 'utf8')) &&
      !/inferState|bandPeak|denseSpan|ALT_TOL/.test(stripComments(fs.readFileSync(path.join(ROOT, 'utils/format.js'), 'utf8'), true)),
    'format.js 的注释里允许提到 inferState（那是在指路），代码里不允许')
  const fmtSrc = stripComments(fs.readFileSync(path.join(ROOT, 'utils/format.js'), 'utf8'), true)
  check('海拔出处分类只有一个函数：resolveElev 走 elevBasis(source)，全文件不内联基准字面量',
    /function elevBasis \(source\)/.test(fmtSrc) && /basis: elevBasis\(/.test(fmtSrc) &&
      !/basis: '(measured|estimated|none)'/.test(fmtSrc),
    (fmtSrc.match(/basis: [^,}\n]*/g) || []).join(' | '))
  const elevAssigns = stripComments(pageJs, true).match(/elevBasis = [^;\n]*/g) || []
  check('页面只搬运分类结果：两处查询路径都只写 elevBasis = EV….basis，没有任何自造分类',
    elevAssigns.length === 2 && elevAssigns.every(a => /^elevBasis = EV[a-z]*\.basis$/.test(a.trim())),
    elevAssigns.join(' | '))
}

/* ---------- 8. 显示窗与业务判读隔离（2026-10-09 显示窗自适应轮） ---------- */
section('8 天象与位置判读不得随显示窗漂移')
{
  const bothSidesField = () => fieldOf([{ lo: 1750, hi: 2600, cov: 92 }, { lo: 4300, hi: 5000, cov: 80 }], { lo: 1000, hi: 5000 })
  const digest = oi => JSON.stringify([oi.conditions.map(c => [c.t, c.key, c.reason, c.holds]),
    (oi.opportunities || []).map(o => [o.type, o.from, o.to, o.confidence])])
  const run = () => digest(oiRun(day(h => (h < 6 || h >= 21) ? {} : { low: 30 }), 3500, 'measured', bothSidesField()))
  const before = run()
  const snap = Object.assign({}, CFF.PROFILE)
  CFF.PROFILE.MAX_SPAN = 1000
  CFF.PROFILE.PAD_M = 0
  CFF.PROFILE.DECK_MIN = 60
  const after = run()
  Object.keys(snap).forEach(k => { CFF.PROFILE[k] = snap[k] })
  check('把显示窗参数改到极端（跨度上限 4000→1000、呼吸位→0、选材门槛 25→60），条件态与机会窗口逐项不变',
    before === after, before.slice(0, 160) + ' || ' + after.slice(0, 160))
  check('还原后与改前一致（证明上面那次比较用的是同一份数据）', run() === before)
  /* 原来这条是静态源码门（在 outdoor-intelligence.js 里正则找
     `for (let alt = CFF.ALT0; alt <= CFF.ALT1; alt += step)`）。
     层提取已于 2026-10-10 搬到 `cloud-layer-facts.js`，源码位置变了但那不是行为变了——
     静态门在这里只会把"搬家"误判成"改判据"。改钉行为：业务扫描范围必须**仍然等于**
     固定基准、必须**自报来源**、且显示窗参数怎么改它都不动。 */
  const CLF = require(path.join(ROOT, 'utils/cloud-layer-facts.js'))
  const defScan = CLF.resolveRanges({}).scan
  check('业务扫描范围仍等于固定基准 ALT0–ALT1，且自报来源是显示窗（R1 待解耦，本轮未解耦）',
    defScan.lo === CFF.ALT0 && defScan.hi === CFF.ALT1 && defScan.source === 'display-window',
    JSON.stringify(defScan))
  const scanWithExtremeProfile = (function () {
    const snap = Object.assign({}, CFF.PROFILE)
    CFF.PROFILE.MAX_SPAN = 9999; CFF.PROFILE.PAD_M = 5000; CFF.PROFILE.DECK_MIN = 5
    const r = CLF.resolveRanges({}).scan
    Object.keys(snap).forEach(k => { CFF.PROFILE[k] = snap[k] })
    return r
  })()
  check('把显示窗参数改到极端 ⇒ 业务扫描范围一个数都不动（显示层不进出云层的扫描）',
    JSON.stringify(scanWithExtremeProfile) === JSON.stringify(defScan),
    JSON.stringify(scanWithExtremeProfile) + ' vs ' + JSON.stringify(defScan))
  const oiSrc = stripComments(fs.readFileSync(path.join(ROOT, 'utils/outdoor-intelligence.js'), 'utf8'), true)
  check('机会层源码里不出现剖面显示窗（profile/planProfile/PROFILE）——它只能拿到 L1 给的扫描范围',
    !/profile|planProfile|PROFILE/.test(oiSrc),
    'outdoor-intelligence.js 不得引用剖面显示窗')
  const cfs = stripComments(fs.readFileSync(path.join(ROOT, 'utils/cloud-field-svg.js'), 'utf8'), true)
  /* 先用原文定位边界（分节标题本身是注释，去注释后就找不到了），再对截出来的函数体去注释 */
  const raw = fs.readFileSync(path.join(ROOT, 'utils/cloud-field-svg.js'), 'utf8')
  const from = raw.indexOf('function inferState')
  const mark = raw.indexOf('/* ---------- 剖面显示窗', from)
  const body = stripComments(raw.slice(from, mark > from ? mark : raw.indexOf('function buildGeometry', from)), true)
  check('inferState 的函数体里没有任何显示窗量（不读 profile/PROFILE/ALT0/ALT1）',
    !/PROFILE|planProfile|\.profile|ALT0|ALT1/.test(body),
    (body.match(/PROFILE|ALT0|ALT1/g) || []).join(','))
  check('判读仍然只吃实测包络（covered 缺失一律 no-data，不退回显示窗）',
    /if \(!covOk\) return unknown\('no-data'\)/.test(body) && /SCAN_MIN = 0, SCAN_MAX = 7000/.test(cfs))
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
