// 天气模块 · 轨迹层编排回归测试：node tools/weather-model-test.js
//
// 验证 utils/weather-model.js 的**编排**行为，不复刻 sky.js 的阈值判定
// （阈值归 sky.js，那 65 例另有 sky-test.js 钉住）。
// 真实量级参考：云量 0–100、降水 mm/h、风 km/h、云层带 {base,top,cover} 为 m ASL。
'use strict'
const M = require('../miniprogram/utils/weather-model')
const S = require('../miniprogram/utils/sky')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const LAT = 30.67
const LNG = 104.07
const DATE = '2026-07-28'

// 合成一天 24 小时。**比 sky-test 的 day() 多一个 d 字段**——
// weather-model 靠 series[].d 切日（detail 只有所选日，跨天节点查不到天相）。
function day(date, over) {
  const map = over || {}
  const out = []
  for (let h = 0; h < 24; h++) {
    const t = (h < 10 ? '0' : '') + h + ':00'
    const o = map[h] || map['*'] || {}
    out.push({
      d: date,
      t,
      temp: o.temp == null ? 14 : o.temp,
      pop: o.pop == null ? 0 : o.pop,
      precip: o.precip == null ? 0 : o.precip,
      showers: o.showers == null ? 0 : o.showers,
      code: o.code == null ? 2 : o.code,
      wind: o.wind == null ? 12 : o.wind,
      rh: o.rh == null ? 60 : o.rh,
      cloud: {
        low: o.low == null ? 0 : o.low,
        mid: o.mid == null ? 0 : o.mid,
        high: o.high == null ? 0 : o.high,
      },
      band: o.band || null,
    })
  }
  return out
}

// 清晨成层云带：底 1700 / 顶 2400 / 覆盖 90，高层云少 → 满足 cloudSea 的五信号
const CLOUD_BAND = { base: 1700, top: 2400, cover: 90 }
const SEA_MORNING = {
  '*': { low: 70, mid: 30, high: 10, band: CLOUD_BAND, wind: 8 },
}

section('1. snap：逐时插值与越界夹取')
{
  const series = day(DATE, { '*': { temp: 10, wind: 20 }, 12: { temp: 20, wind: 30 } })
  const a = M.snap(series, DATE, 12 * 60)
  check('整点取值正确', a && a.temp === 20 && a.wind === 30, a && JSON.stringify(a.temp))
  const mid = M.snap(series, DATE, 12 * 60 + 30)
  check('半点线性插值', mid && Math.abs(mid.temp - 15) < 1e-9, mid && String(mid.temp))
  check('半点风速同步插值', mid && Math.abs(mid.wind - 25) < 1e-9, mid && String(mid.wind))

  const late = M.snap(series, DATE, 23 * 60 + 30)
  check('23:30 夹到 23:00（不越界取样）', late && late.minutes === 23 * 60, late && String(late.minutes))
  const over = M.snap(series, DATE, 30 * 60)
  check('越过 24h 也夹到末槽', over && over.minutes === 23 * 60, over && String(over.minutes))
  const under = M.snap(series, DATE, -60)
  check('负分钟夹到 00:00', under && under.minutes === 0, under && String(under.minutes))
  check('末槽之后 nextSlot 为 null（不外推到次日）', late && late.nextSlot === null)
  check('无该日数据返回 null', M.snap(series, '2026-07-29', 600) === null)
}

section('2. snap：云带不编造')
{
  const series = day(DATE, { 8: { band: CLOUD_BAND }, 9: { band: null } })
  const withBand = M.snap(series, DATE, 8 * 60)
  check('两端都有云带时插值出云带', withBand && withBand.band && withBand.band.base === 1700)
  const cross = M.snap(series, DATE, 8 * 60 + 30)
  check('「有→无」之间不插值出云带', cross && cross.band === null, cross && JSON.stringify(cross.band))
  const none = M.snap(series, DATE, 9 * 60 + 30)
  check('「无→有」之间同样不插值', none && none.band === null, none && JSON.stringify(none.band))
}

section('3. nodeFacts：逐节点按各自海拔判定（云在脚下）')
{
  // 同一时刻、同一天，两个海拔：2000m 在云带里，3900m 在云带之上
  const series = day(DATE, SEA_MORNING)
  const nodes = [
    { t: '08:00', d: DATE, alt: 2000, km: 20 },
    { t: '08:00', d: DATE, alt: 3900, km: 20 },
  ]
  const facts = M.nodeFacts({ series, days: [], nodes, lat: LAT, lng: LNG })

  check('低海拔节点判入云（人在云里）', facts[0].marks.indexOf('inCloud') !== -1, facts[0].marks.join(','))
  check('高海拔节点判云海（云在脚下）', facts[1].marks.indexOf('cloudSea') !== -1, facts[1].marks.join(','))
  check('同一时刻同一份数据，海拔不同结论不同——这就是必须逐节点问 sky.js 的理由',
    facts[0].primary !== facts[1].primary, facts[0].primary + ' vs ' + facts[1].primary)
  check('两节点都带 elevOK', facts[0].elevOK === true && facts[1].elevOK === true)
}

section('3b. 节点时间非整点时也能查到天相（真机验证抓到的回归）')
{
  // sky.hourMarks 的键是**整点槽**（'07:00'），而 GPX 推算出的节点时间几乎不会
  // 整点对齐（05:40 / 07:55 / 14:10）。曾直接 marks[node.t] 精确查 → 永远查不到 →
  // 整条轨迹全灰、天相窗口一个都不出现。Node 测试当时没抓到，是因为 fixture
  // 恰好全用了整点（'08:00'）。这里钉死非整点场景。
  const series = day(DATE, SEA_MORNING)
  const off = [
    { t: '07:55', d: DATE, alt: 3900, km: 12 },
    { t: '08:40', d: DATE, alt: 3900, km: 16 },
    { t: '11:15', d: DATE, alt: 3900, km: 30 },
  ]
  const facts = M.nodeFacts({ series, days: [], nodes: off, lat: LAT, lng: LNG })
  check('07:55 归到 07:00 槽并判出云海',
    facts[0].slot === '07:00' && facts[0].primary === 'cloudSea',
    facts[0].slot + ' / ' + facts[0].primary)
  check('08:40 归到 08:00 槽并判出云海', facts[1].primary === 'cloudSea', facts[1].primary)
  check('11:15 槽内无云带 → 仍为 none（不硬塞）', facts[2].primary === 'none', facts[2].primary)
  check('非整点节点不再全灰', facts.some(f => f.primary === 'cloudSea'))

  // 整点与紧邻的非整点应落在同一个槽
  const pair = M.nodeFacts({
    series, days: [], lat: LAT, lng: LNG,
    nodes: [{ t: '08:00', d: DATE, alt: 3900 }, { t: '08:01', d: DATE, alt: 3900 }],
  })
  check('08:00 与 08:01 同槽同判', pair[0].slot === pair[1].slot && pair[0].primary === pair[1].primary,
    pair[0].slot + '/' + pair[1].slot)
  check('slot 已导出便于排查', typeof pair[0].slot === 'string')
}

section('4. pickPrimary：inCloud 是减分项，不当主角')
{
  check('只有 inCloud 时主角为 none', M.pickPrimary(['inCloud']) === M.NO_PHENOMENON)
  check('云海优先于星空', M.pickPrimary(['star', 'cloudSea']) === 'cloudSea')
  check('光染优先于彩虹', M.pickPrimary(['rainbow', 'alpenglow']) === 'alpenglow')
  check('无标记时为 none', M.pickPrimary([]) === M.NO_PHENOMENON)
  check('未知标记不误认', M.pickPrimary(['galaxy']) === 'galaxy')
}

section('5. runsOf / mainWindow / isolatedPoints：方案 b 分层')
{
  // 构造：3 连云海 + 1 孤立云海 + 2 连无天相
  const facts = [
    { t: '06:00', primary: 'cloudSea' },
    { t: '07:00', primary: 'cloudSea' },
    { t: '08:00', primary: 'cloudSea' },
    { t: '09:00', primary: 'none' },
    { t: '10:00', primary: 'none' },
    { t: '11:00', primary: 'cloudSea' },
    { t: '12:00', primary: 'none' },
  ]
  const runs = M.runsOf(facts)
  check('切成 4 段', runs.length === 4, String(runs.length))
  check('首段 from/to/count 正确', runs[0].from === '06:00' && runs[0].to === '08:00' && runs[0].count === 3)

  const main = M.mainWindow(runs)
  check('主窗口取多节点段而非孤立点', main && main.count === 3 && main.from === '06:00', main && main.from)
  check('主窗口不是 isolated', main && main.isolated === false)

  const iso = M.isolatedPoints(runs)
  check('孤立点只有 1 个', iso.length === 1, String(iso.length))
  check('孤立点是 11:00 那座', iso[0] && iso[0].to === '11:00' && iso[0].key === 'cloudSea')
  check('无天相段不算孤立点', iso.every(r => r.key !== M.NO_PHENOMENON))
  check('全 none 时无主窗口', M.mainWindow(M.runsOf([{ t: '01:00', primary: 'none' }])) === null)
  check('空输入返回空数组', M.runsOf([]).length === 0)
}

section('6. trackPoints / posAt：不编造抵达之后')
{
  const nodes = [
    { t: '05:40', d: DATE, alt: 2860, km: 0 },
    { t: '08:00', d: DATE, alt: 3500, km: 20 },
    { t: '14:10', d: DATE, alt: 3900, km: 52.8 },
  ]
  const series = day(DATE, SEA_MORNING)

  const plain = M.trackPoints({ series, nodes }, 10)
  const first = plain[0].minutes
  const last = plain[plain.length - 1].minutes
  check('起点为 05:40', first === 5 * 60 + 40, String(first))
  check('止于最后一个节点 14:10', last === 14 * 60 + 10, String(last))
  check('抵达之后不采样', last === 14 * 60 + 10)
  check('海拔随里程上升（终点即观景位）',
    plain[plain.length - 1].alt === 3900, String(plain[plain.length - 1].alt))

  const stay = M.trackPoints({ series, nodes, stayEndH: '23:00' }, 10)
  const stayLast = stay[stay.length - 1].minutes
  check('留宿延伸到 23:00', stayLast === 23 * 60, String(stayLast))
  check('延伸段仍在 24h 内', stayLast < 24 * 60)

  const before = stay[stay.length - 1].alt
  check('留宿段抵达后海拔持平（不外推下撤）', before === 3900, String(before))

  const at0800 = M.posAt(plain, 8 * 60)
  check('节点上取值精确', at0800.alt === 3500 && at0800.past === false)
  const between = M.posAt(plain, 5 * 60 + 40 + 70)
  check('节点间线性插值', between.alt > 2860 && between.alt < 3500, String(between.alt))
  const after = M.posAt(plain, 20 * 60)
  check('超过末节点返回末值并标 past', after.alt === 3900 && after.past === true)
  check('空轨迹安全返回', M.posAt([], 600).alt === null)
  check('无节点返回空数组', M.trackPoints({ series, nodes: [] }, 10).length === 0)

  // km 缺失必须保持 null——兜成 0 会被读成「路线长度为零」
  const noKm = M.trackPoints({ series, nodes: [
    { t: '05:40', d: DATE, alt: 2860 },
    { t: '14:10', d: DATE, alt: 3900 },
  ] }, 10)
  check('节点无 km 时读数为 null 而非 0', M.posAt(noKm, 8 * 60).km === null, String(M.posAt(noKm, 8 * 60).km))
  check('区间内也无 km 时为 null', M.posAt(noKm, 10 * 60).km === null, String(M.posAt(noKm, 10 * 60).km))
  check('越界后无 km 时为 null', M.posAt(noKm, 20 * 60).km === null, String(M.posAt(noKm, 20 * 60).km))
  // 给了 km 才插值：05:40(0km) → 14:10(52.8km)，10:00 落在 260/510 处
  const withKm = M.trackPoints({ series, nodes: [
    { t: '05:40', d: DATE, alt: 2860, km: 0 },
    { t: '14:10', d: DATE, alt: 3900, km: 52.8 },
  ] }, 10)
  const kmAt10 = M.posAt(withKm, 10 * 60).km
  check('给了 km 时能插值出来', Math.abs(kmAt10 - 52.8 * 260 / 510) < 0.05, String(kmAt10))
}

section('7. judge：分数来自 sky.js，不新增档位')
{
  const series = day(DATE, SEA_MORNING)
  const node = { t: '14:10', d: DATE, alt: 3900, km: 52.8 }
  const j = M.judge({ series, days: [], lat: LAT, lng: LNG, node })

  check('给出结论', !!j)
  check('分数 0–100', j.score >= 0 && j.score <= 100, String(j.score))
  check('tone/label 来自 sky.grade',
    j.label === S.grade(j.score).label, j.label + ' vs ' + S.grade(j.score).label)
  check('复用 sky.summarize 的 6 类结论', j.items.length === 6, String(j.items.length))
  check('云海判为有戏（清晨成层带 + 观景位在带顶之上）',
    (j.items.filter(i => i.key === 'cloudSea')[0] || {}).score >= 45)

  check('缺节点返回 null', M.judge({ series, days: [], lat: LAT, lng: LNG, node: null }) === null)
  check('节点不在数据日返回 null',
    M.judge({ series, days: [], lat: LAT, lng: LNG, node: { t: '08:00', d: '2026-07-30', alt: 3000 } }) === null)
}

section('8. 文案语气：天气派生结论必须用概率表达')
{
  const series = day(DATE, SEA_MORNING)
  const j = M.judge({ series, days: [], lat: LAT, lng: LNG, node: { t: '14:10', d: DATE, alt: 3900 } })
  const allText = j.items.map(i => i.title + i.text).join(' ')
  // 断言式承诺是明令禁止的（AGENTS.md 反模式 12：无救援/保险承诺）
  const banned = ['保证', '一定', '必定', '准能', '包你', '不会有', '不会有云海', '安全']
  const hit = banned.filter(w => allText.indexOf(w) !== -1)
  check('不含断言式承诺', hit.length === 0, hit.join(','))
  check('云海文案使用概率语气', /机会|概率|可能|条件/.test(j.items.filter(i => i.key === 'cloudSea')[0].text))
}

section('9. 导出面完整（防「漏导出导致调用点全 undefined」）')
{
  const expect = ['snap', 'nodeFacts', 'pickPrimary', 'runsOf', 'mainWindow',
    'isolatedPoints', 'trackPoints', 'posAt', 'judge']
  const missing = expect.filter(k => typeof M[k] !== 'function')
  check('全部函数都在 module.exports', missing.length === 0, missing.join(','))
  check('常量也已导出', typeof M.NO_PHENOMENON === 'string' && Array.isArray(M.PRIMARY_ORDER))
}

section('10. wx-free：本文件不得触碰 wx API')
{
  const src = require('fs').readFileSync(require.resolve('../miniprogram/utils/weather-model'), 'utf8')
  // 先剥注释：本文件的文档里会写「不得出现 wx.*」这类说明，直接匹配会误报自己
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('注释外无 wx. 调用', !/\bwx\./.test(code))
  check('注释外无 require wx/wxml/dom 运行时', !/require\(['"](?:wx|wxml|dom)/.test(code))
  check('只 require 了同层的 sky', (code.match(/require\(/g) || []).length === 1)
}

section('11. 逐节点坐标（太阳高度角沿路线会偏移，不能全组共用一个经纬度）')
{
  const series = day(DATE, SEA_MORNING)
  const withCoords = [
    { t: '08:00', d: DATE, alt: 3900, lat: LAT, lng: LNG },
    { t: '08:00', d: DATE, alt: 3900, lat: LAT + 0.5, lng: LNG + 0.5 },
  ]
  const r = M.nodeFacts({ series, days: [], nodes: withCoords, lat: LAT, lng: LNG })
  check('逐节点坐标不抛错', r.length === 2)
  check('每个节点都拿到自己的天相结果', r.every(f => Array.isArray(f.marks)))

  // 自身坐标缺省时回退到全局（单点查询场景）
  const fb = M.nodeFacts({
    series, days: [], lat: LAT, lng: LNG,
    nodes: [{ t: '08:00', d: DATE, alt: 3900 }, { t: '14:10', d: DATE, alt: 3900 }],
  })
  check('缺省坐标回退到全局后仍能判定', fb[0].marks.length > 0, JSON.stringify(fb.map(f => f.marks)))

  // 越界坐标不应崩（天文库对非法纬度可能返回 NaN）
  const bad = M.nodeFacts({
    series, days: [], lat: LAT, lng: LNG,
    nodes: [{ t: '08:00', d: DATE, alt: 3900, lat: 91, lng: 181 }],
  })
  check('非法坐标不抛错且降级为空标记', Array.isArray(bad[0].marks))
}

section('11b. 留宿夜间天象：裁 detail 复用 sky.summarize')
{
  const series = day(DATE, { '*': { low: 10, mid: 40, high: 20, precip: 0, pop: 10, wind: 8 } })
  const node = { t: '20:00', d: DATE, alt: 3900, km: 52.8 }
  const n = M.nightOutlook({ series, days: [], lat: LAT, lng: LNG, node })

  check('给出夜间天象', !!n)
  check('带日出日落（供留宿卡展示）', !!(n.sun && n.sun.sunset), n.sun && String(n.sun.sunset))
  check('卡不超过 2 张（晚霞 + 银河/星空其一）', n.cards.length >= 1 && n.cards.length <= 2,
    n.cards.map(c => c.title).join('+'))
  check('晚霞卡标题为「晚霞」', !n.cards[0] || n.cards[0].title === '晚霞', n.cards[0] && n.cards[0].title)
  check('深空卡是银河或星空', !n.cards[1] || ['银河', '星空'].indexOf(n.cards[1].title) !== -1,
    n.cards[1] && n.cards[1].title)

  // 核心：裁剪后 alpenglowConclusion 必须返回**昏光**那条（isDawn 恒为假）
  if (n.cards[0]) {
    check('晚霞文案说的是昏光而非晨光', /昏光/.test(n.cards[0].text) && !/晨光/.test(n.cards[0].text),
      n.cards[0].text.slice(0, 24))
  }

  // 银河是星空子集：两者都成立时只报一个
  const titles = n.cards.map(c => c.title)
  check('不同时报银河与星空（子集去重）', !(titles.indexOf('银河') !== -1 && titles.indexOf('星空') !== -1),
    titles.join('+'))

  // 概率语气
  const all = n.cards.map(c => c.title + c.text).join(' ')
  const banned = ['保证', '一定', '必定', '准能', '会有云海', '安全']
  check('不含断言式承诺', banned.filter(w => all.indexOf(w) !== -1).length === 0,
    banned.filter(w => all.indexOf(w) !== -1).join(','))

  // 边界
  check('缺节点返回 null', M.nightOutlook({ series, days: [], lat: LAT, lng: LNG, node: null }) === null)
  check('节点不在数据日返回 null',
    M.nightOutlook({ series, days: [], lat: LAT, lng: LNG, node: { t: '20:00', d: '2026-07-30', alt: 3900 } }) === null)
  const late = M.nightOutlook({ series, days: [], lat: LAT, lng: LNG, node, fromH: 24 })
  check('fromH 之后没有任何小时时返回 null', late === null, late ? JSON.stringify(late.cards.length) : 'null')
  const h23 = M.nightOutlook({ series, days: [], lat: LAT, lng: LNG, node, fromH: 23 })
  check('只剩 23 时仍能给出结果（未越界取样）', !!h23 && Array.isArray(h23.cards))
  check('fromH 可覆盖（默认 18 点）', n.fromH === 18, String(n.fromH))
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
