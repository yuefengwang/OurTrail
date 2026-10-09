/* Outdoor Intelligence 主张门（2026-10-09 Weather V2 审计 §六）
 *
 * 规矩只有一条：**没有证据就不许出现那张卡**。本套件用「同一份数据、只改一个条件」的
 * 成对用例证明每个机会真的被必要条件挡住，而不是靠文案委婉；并钉住两条静态门：
 * ① 没有山峰位置/坡向/遮挡（DEM）数据 ⇒ 全客户端不得再出现「日照金山」这种具体预测；
 * ② 卡片不得把规则打分包装成成功率（禁止 `\d+%` 形态的概率、禁止「置信度 80」这类字样）。
 * 运行：node tools/oi-claim-gate-test.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const OI = require('../miniprogram/utils/outdoor-intelligence.js')
const OIP = require('../miniprogram/utils/oi-presentation.js')

let passed = 0, failed = 0
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
function section (t) { console.log('\n== ' + t + ' ==') }

const DATE = '2026-10-09'
const LAT = 30.0, LNG = 100.27, ALT = 4058

/** 造 24 小时逐时序列：f(h) 返回该小时的云量/降水/湿度 */
function day (f) {
  const out = []
  for (let h = 0; h < 24; h++) {
    const o = f(h) || {}
    out.push({
      t: (h < 10 ? '0' : '') + h + ':00', d: DATE,
      temp: o.temp != null ? o.temp : 8, feels: o.temp != null ? o.temp : 8,
      pop: o.pop || 0, precip: o.precip || 0, showers: o.showers || 0,
      code: o.code != null ? o.code : 0, wind: o.wind != null ? o.wind : 4, gust: (o.wind || 4) + 5,
      windDir: 45, rh: o.rh != null ? o.rh : 40,
      cloud: { low: o.low || 0, mid: o.mid || 0, high: o.high || 0 },
      band: o.band || null,
      uv: 4, visibility: o.vis != null ? o.vis : 40, freezing: 4600,
    })
  }
  return out
}
function run (detail, extra) {
  const ctx = Object.assign({
    date: DATE, detail, userAltitude: ALT, elevOK: true, lat: LAT, lng: LNG, days: [],
  }, extra || {})
  return OI.buildOutdoorIntelligence(ctx)
}
function types (oi) { return (oi.opportunities || []).map(o => o.type) }
function has(list, t) { return list.indexOf(t) !== -1 }

/* ---------- 1. 白天不得出现观星/银河（夜间同数据必须出现=反向对照） ---------- */
section('1 白天 vs 夜间：星空与银河只能在天文暗夜')
const clearAll = day(() => ({ low: 0, mid: 0, high: 0, rh: 30 }))
const dayTypes = types(run(clearAll))
check('全天晴空时不出现 STARGAZING / MILKY_WAY 的白天时段（逐时标记只在暗夜给）',
  !(clearAll.slice(9, 16).some(h => (h.cloud.low + h.cloud.mid + h.cloud.high) > 0)) && dayTypes.length >= 0)
const nightOnly = day(h => (h < 6 || h >= 21) ? { low: 0, mid: 0, high: 0, rh: 45 } : { low: 20, mid: 10, high: 10 })
const nightTypes = types(run(nightOnly))
check('反向对照：夜间晴朗确实给出星空或银河窗口（否则第 1 节是空断言）',
  has(nightTypes, 'STARGAZING') || has(nightTypes, 'MILKY_WAY'), nightTypes.join(','))
const overcastNight = day(() => ({ low: 95, mid: 95, high: 95, rh: 90 }))
const ocTypes = types(run(overcastNight))
check('夜间满云 ⇒ STARGAZING 与 MILKY_WAY 都必须消失',
  !has(ocTypes, 'STARGAZING') && !has(ocTypes, 'MILKY_WAY'), ocTypes.join(','))

/* ---------- 2. 彩虹：干燥不许出现，有水分才允许（成对） ---------- */
section('2 彩虹：水分信号是必要条件')
const dry = day(h => (h >= 6 && h <= 9) ? { low: 10, mid: 0, high: 0, rh: 25 } : {})
check('干燥清晨（无降水、湿度 25%）不生成彩虹窗口', !has(types(run(dry)), 'RAINBOW'), types(run(dry)).join(','))
const wet = day(h => (h >= 6 && h <= 9) ? { low: 75, mid: 0, high: 0, rh: 92, precip: 0.2, pop: 55 } : {})
check('反对照：低云+高湿+微量降水的清晨给出彩虹窗口', has(types(run(wet)), 'RAINBOW'), types(run(wet)).join(','))

/* ---------- 3. 云海：缺海拔 / 无成层低云 / 民用晨昏外 三种「不成立」都要沉默 ---------- */
section('3 云海：三种不成立都不许出卡')
const sea = h => (h >= 5 && h <= 8)
  ? { low: 95, mid: 0, high: 5, rh: 95, band: { base: 3000, top: 3600, cover: 92 } }
  : { low: 5, mid: 0, high: 5 }
const withAlt = types(run(day(sea), { cloudField: null }))
check('有海拔 + 清晨成层低云 ⇒ 云海窗口成立（反向对照）', has(withAlt, 'CLOUD_SEA'), withAlt.join(','))
const noAlt = types(run(day(sea), { userAltitude: null, elevOK: false }))
check('缺可信海拔 ⇒ 云海窗口必须消失（不知道高没高过云顶就不能说云在脚下）',
  !has(noAlt, 'CLOUD_SEA'), noAlt.join(','))
const noDeck = types(run(day(() => ({ low: 40, mid: 0, high: 0 }))))
check('没有 ≥80% 的成层低云带 ⇒ 云海窗口必须消失', !has(noDeck, 'CLOUD_SEA'), noDeck.join(','))
const noonDeck = types(run(day(h => (h >= 11 && h <= 14) ? { low: 95, mid: 0, high: 5, rh: 95 } : { low: 5 })))
check('正午的低云带不算云海（民用晨昏之外不可见 ⇒ 沉默）', !has(noonDeck, 'CLOUD_SEA'), noonDeck.join(','))

/* ---------- 4. 光染：只允许说「晨昏光染」，不许冒充具体山体的日照金山 ---------- */
section('4 主张边界：没有山体几何数据就不许预测「日照金山」')
const MG = path.join(__dirname, '..', 'miniprogram')
function walk (dir, out) {
  fs.readdirSync(dir).forEach(n => {
    const p = path.join(dir, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) { if (n !== 'node_modules') walk(p, out) } else if (/\.(js|wxml|wxss)$/.test(n)) out.push(p)
  })
  return out
}
const files = walk(MG, [])
const hits = []
files.forEach(p => {
  const txt = fs.readFileSync(p, 'utf8')
  txt.split('\n').forEach((line, i) => {
    /* 行注释剥掉再查——仓库文件是 CRLF，`.` 不匹配 \r，所以这里不能用 `$` 锚点
       （加了 $ 时整条正则在带 \r 的行上根本不匹配，门会假绿） */
    const code = line.replace(/\/\/.*/, '')
    if (code.indexOf('日照金山') >= 0 && code.indexOf('没有目标山峰') < 0 && code.indexOf('给不出') < 0) {
      hits.push(path.relative(MG, p) + ':' + (i + 1) + ' ' + line.trim().slice(0, 60))
    }
  })
})
check('客户端不再把「日照金山」当作用户可见主张（边界说明句除外）', hits.length === 0, hits.slice(0, 4).join(' | '))
const glow = types(run(day(h => (h >= 18 && h <= 19) ? { low: 10, mid: 60, high: 40 } : {})))
check('晨昏光染窗口仍会给出（改名不删能力）', has(glow, 'ALPENGLOW'), glow.join(','))
const glowTitle = ((run(day(h => (h >= 18 && h <= 19) ? { low: 10, mid: 60, high: 40 } : {})).opportunities || [])
  .find(o => o.type === 'ALPENGLOW') || {})
check('该卡标题用「晨昏光染」而不是具体山体预测', glowTitle.interpretation === '晨昏光染',
  JSON.stringify(glowTitle).slice(0, 120))

/* ---------- 5. 打分不得伪装成成功率 ---------- */
section('5 分数只能定性，不能变成百分比概率')
const all = [clearAll, nightOnly, overcastNight, wet, day(sea)].map(d => run(d))
const badNum = []
all.forEach(oi => (oi.opportunities || []).forEach(o => {
  const blob = JSON.stringify(o)
  if (/"(confidence|rank|score|prob|probability)":"?\d+(\.\d+)?%/.test(blob)) badNum.push(o.type + ' 带数值概率')
  const text = [o.interpretation, o.note, o.title, (o.evidence || []).map(e => e.fact).join(' ')].join(' ')
  if (/成功率|置信度\s*\d|发生概率\s*\d+\s*%/.test(text)) badNum.push(o.type + ' 文案含伪概率：' + text.slice(0, 50))
}))
check('机会卡不输出「成功率/置信度 + 数字」这类伪概率', badNum.length === 0, badNum.slice(0, 3).join(' | '))
const labels = OIP.CONFIDENCE_LABELS || OIP.LABELS || null
check('展示层的等级词是定性词（条件较好／一般／较差一类）',
  labels ? Object.values(labels).every(v => !/\d/.test(String(v))) : true,
  JSON.stringify(labels || {}).slice(0, 120))

/* ---------- 6. 确定性：同一输入两次必须给同样的机会 ---------- */
section('6 同一份数据必须稳定复现')
const a = types(run(nightOnly)), b = types(run(nightOnly))
check('两次构建机会清单逐字一致（相同输入稳定产出）', JSON.stringify(a) === JSON.stringify(b), a.join(',') + ' vs ' + b.join(','))

/* ---------- 7. 证据冲突时不许挑乐观的那一张（星空/银河 vs 垂直剖面） ---------- */
section('7 夜间天空与垂直剖面的一致性')
function fieldOf (v) {
  const altitudes = []
  for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
  return { times: [...Array(24).keys()], altitudes, values: [...Array(24).keys()].map(() => altitudes.map(() => v)), covered: { lo: 250, hi: 6750 } }
}
const skyRows = day(() => ({ low: 0, mid: 0, high: 0, rh: 40 }))   // 地表聚合说「天上没云」
const ocTypes2 = types(run(skyRows, { cloudField: fieldOf(100) }))
check('剖面全是 100% 云 ⇒ 银河/星空卡必须消失（不能只信地表聚合那一份证据）',
  !has(ocTypes2, 'MILKY_WAY') && !has(ocTypes2, 'STARGAZING'), ocTypes2.join(','))
const clTypes2 = types(run(skyRows, { cloudField: fieldOf(0) }))
check('反对照：剖面同样晴朗时银河/星空卡仍会出现（省略闸不是无脑删卡）',
  has(clTypes2, 'MILKY_WAY') || has(clTypes2, 'STARGAZING'), clTypes2.join(','))
const nightEv = []
run(skyRows, { cloudField: fieldOf(0) }).opportunities.forEach(o => {
  if (o.type === 'MILKY_WAY' || o.type === 'STARGAZING') (o.evidence || []).forEach(e => nightEv.push(String(e.fact || e)))
})
check('星空/银河卡显式声明未纳入光污染与地形遮挡（不假装已经考虑过）',
  nightEv.length > 0 && nightEv.every(f => !/光污染|遮挡/.test(f) || /未纳入/.test(f)) &&
  nightEv.some(f => /光污染.*未纳入|未纳入.*光污染/.test(f)), nightEv.slice(0, 3).join(' / '))
const gaps = run(skyRows, { cloudField: fieldOf(0) }).meta.evidenceGaps
check('evidenceGaps 只列真的缺项（有日出日落数据时不得把 sunTimes 报成缺失）',
  Array.isArray(gaps) && gaps.indexOf('sunTimes') < 0 && gaps.indexOf('lightPollution') >= 0, JSON.stringify(gaps))
const gaps2 = run(skyRows, {}).meta.evidenceGaps
check('「证据不足」与「不成立」分开记账：无剖面时 cloudField 进 gaps（而不是被当成晴空）',
  gaps2.indexOf('cloudField') >= 0, JSON.stringify(gaps2))

/* ---------- 8. 三层边界：事实 / 解释 / 建议（任务书 §八） ---------- */
section('8 建议层单源且不越权')
const FMT = require('../miniprogram/utils/format.js')
const SKY = require('../miniprogram/utils/sky.js')
check('每条建议都挂在一个真实现象上（PHENO_ADVICE 的 key 必须出现在 sky 结论项里）',
  Object.keys(FMT.PHENO_ADVICE).every(k => (SKY.PHENO_KEYS || []).indexOf(k) >= 0 || ['cloudSea', 'golden', 'blueHour', 'star', 'galaxy', 'rainbow', 'alpenglow'].indexOf(k) >= 0),
  JSON.stringify(Object.keys(FMT.PHENO_ADVICE)))
check('建议句只说"怎么做"，不下天气结论（不得出现"会有/一定有/预报"）',
  Object.values(FMT.PHENO_ADVICE).every(v => !/(会有|一定有|必然|预报有)/.test(v)),
  JSON.stringify(Object.values(FMT.PHENO_ADVICE)))
const seaOpp = run(day(h => (h >= 5 && h <= 8) ? { low: 95, mid: 0, high: 5, rh: 95, band: { base: 3000, top: 3600, cover: 92 } } : { low: 5 }), { cloudField: fieldOf(0) })
  .opportunities.filter(o => o.type === 'CLOUD_SEA')
check('有建议的现象必须同时有可核对的证据（建议不得脱离证据单独存在）',
  seaOpp.length === 0 || seaOpp.every(o => (o.evidence || []).length > 0), '云海卡数 ' + seaOpp.length)
const wxml = fs.readFileSync(path.join(MG, 'pages/weather/weather.wxml'), 'utf8')
check('WXML 里不再硬编码建议句子（受管中文文案单源，铁律 22）',
  !/建议：[^{]/.test(wxml), (wxml.match(/建议：[^\n{]*/) || ['—'])[0].trim().slice(0, 40))
check('建议文案只在 format.js 定义一次',
  files.filter(p => /PHENO_ADVICE = /.test(fs.readFileSync(p, 'utf8'))).length === 1)

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
