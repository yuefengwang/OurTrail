/* Outdoor Intelligence Layer（Weather V2）测试
 * 覆盖：Condition 四态、Window 聚类（start/end/empty/overlap/adjacent）、
 *       Evidence（每个窗口可解释）、Silence（证据不足不产出）、
 *       Determinism（同输入同输出）、三海拔差异。
 * 运行：node tools/outdoor-intelligence-test.js
 */
'use strict'

const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = (t) => console.log('\n== ' + t + ' ==')

let passed = 0, failed = 0
const OI = require('../miniprogram/utils/outdoor-intelligence.js')
const OIP = require('../miniprogram/utils/oi-presentation.js')
const EK = require('../miniprogram/utils/evidence-kind.js').KIND
const CFF = require('../miniprogram/utils/cloud-field-svg.js')

const TIMES = []
for (let h = 0; h < 24; h++) TIMES.push('2026-10-07T' + (h < 10 ? '0' : '') + h + ':00')

/* 合成 hourView detail：三层云量 + band + 风 + 湿度 + 能见度 */
function detail24(cloudByHour, bands, opts) {
  opts = opts || {}
  return TIMES.map((t, h) => {
    const c = cloudByHour[h] || { low: 5, mid: 5, high: 5 }
    return {
      d: t.slice(0, 10), t: t.slice(11, 16),
      temp: 12, pop: opts.pop != null ? opts.pop[h] : 0,
      precip: opts.precip ? opts.precip[h] : 0,
      showers: opts.showers ? opts.showers[h] : 0,
      code: 0, wind: (opts.wind && opts.wind[h]) || 4, gust: (opts.gust && opts.gust[h]) || 8,
      windDir: 90, rh: (opts.rh && opts.rh[h]) || 40,
      visibility: (opts.vis && opts.vis[h]) != null ? opts.vis[h] : 35,
      cloud: { low: c.low, mid: c.mid, high: c.high },
      band: (bands && bands[h]) ? (bands[h].lo != null
        ? { base: bands[h].lo, top: bands[h].hi, cover: bands[h].cover }
        : bands[h]) : null,
    }
  })
}

/* 云场合成：恒定层高，逐小时把密核（≥70%）放在指定高度带 */
function cloudFieldWith(bandsByHour, userAlt) {
  const altitudes = []
  for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
  const values = TIMES.map((_, h) => {
    const b = bandsByHour[h]
    return altitudes.map(alt => {
      if (!b) return 5
      if (alt >= b.lo && alt <= b.hi) return b.cover
      const edge = Math.min(Math.abs(alt - b.lo), Math.abs(alt - b.hi))
      return edge <= 500 ? Math.max(5, b.cover - edge / 500 * (b.cover - 5)) : 5
    })
  })
  return {
    times: TIMES.map((_, i) => i), altitudes: altitudes, values: values,
    userAltitude: userAlt, covered: { lo: 2000, hi: 6000 },
  }
}

/* 天文 ctx（北京时区，峨眉山一带；晨昏时刻来自 astro 真算而非硬编码） */
const astro = require('../miniprogram/utils/astro.js')
const baseCtx = { date: '2026-10-07', lat: 29.53, lng: 103.39 }

/* ---------- L2 Condition：四态 ---------- */
section('Condition：IN_CLOUD / CLOUD_BELOW / CLOUD_ABOVE / CLEAR（云场驱动，3500m）')
const bands = {}
for (let h = 0; h < 24; h++) {
  if (h >= 5 && h < 9) bands[h] = { lo: 2500, hi: 3200, cover: 95 }        // 晨间云海（脚下，民用晨光后可见）
  else if (h >= 15 && h < 18) bands[h] = { lo: 3000, hi: 3900, cover: 90 } // 午后入云（穿过 3500）
  else bands[h] = null
}
const cf1 = cloudFieldWith(bands, 3500)
const ctx1 = Object.assign({}, baseCtx, {
  detail: detail24(TIMES.map((_, h) => (h < 4 || (h >= 15 && h < 18)) ? { low: 90, mid: 30, high: 20 } : { low: 5, mid: 5, high: 5 }), bands, {}),
  userAltitude: 3500, elevOK: true,
  cloudField: cf1,
})
const oi1 = OI.buildOutdoorIntelligence(ctx1)
const condAt = (h) => oi1.conditions[h] && oi1.conditions[h].key
check('05–08h CLOUD_BELOW（云区在脚下）', condAt(6) === 'CLOUD_BELOW' && condAt(8) === 'CLOUD_BELOW', condAt(6) + '/' + condAt(8))
check('15–17h IN_CLOUD（云区穿过 3500m）', condAt(16) === 'IN_CLOUD', condAt(16))
check('10–14h CLEAR（云海消散后全晴）', condAt(12) === 'CLEAR', condAt(12))
check('条件态来源 = cloud-field', oi1.conditions.every(c => c.source === 'cloud-field'))

/* ---------- L3 Opportunity：窗口聚类与置信 ---------- */
section('Opportunity：窗口 / Evidence / Rank / Confidence')
const types1 = oi1.opportunities.map(w => w.type)
check('CLOUD_SEA 窗口存在且为 primary', types1.indexOf('CLOUD_SEA') >= 0 &&
  oi1.opportunities.find(w => w.type === 'CLOUD_SEA').rank === 'primary')
const sea = oi1.opportunities.find(w => w.type === 'CLOUD_SEA')
check('CLOUD_SEA 与民用晨昏取交集（agenda 同规则）',
  sea && sea.from >= '06:00' && sea.to <= '18:00' + '', sea && sea.from + '–' + sea.to)
check('CLOUD_SEA evidence 可解释（云层位置/净空/覆盖/持续）',
  sea && sea.evidence.some(e => /云层位于 |云底低于剖面扫描窗下界|云顶高于剖面扫描窗上界|浓云贯穿剖面扫描窗/.test(e.fact)) &&
  sea.evidence.some(e => e.fact.indexOf('此点高于该云层顶约') >= 0) && sea.evidence.length >= 3,
  sea && JSON.stringify(sea.evidence))
/* 净空 = userAltitude − layer.top，说的是「高于云顶」；旧文案写成「云层底部」是反的
   （R2 顺带修正，数值一字未动）。 */
check('净空那句说的是云顶不是云底，且数字 = layers[].clearance 的最小值',
  sea && !sea.evidence.some(e => e.fact.indexOf('云层底部') >= 0) &&
    (() => {
      const m = (sea.evidence.map(e => String(e.fact)).join('\n')).match(/此点高于该云层顶约 ([\d,]+) m/)
      if (!m) return false
      const n = +m[1].replace(/,/g, '')
      const minClear = Math.min.apply(null, sea.layers.map(l => l.clearance))
      return n === minClear
    })(), sea && JSON.stringify(sea.layers))
check('CLOUD_SEA 强度分级存在（WEAK/MODERATE/STRONG）',
  sea && ['WEAK', 'MODERATE', 'STRONG'].indexOf(sea.strength) >= 0, sea && sea.strength)
check('CLOUD_SEA 与日出重叠时带 enrichment 证据',
  !sea.overlapsSunrise || sea.evidence.some(e => e.fact.indexOf('日出') >= 0))
check('IN_CLOUD 窗口存在（15–17h，≥2h）', types1.indexOf('IN_CLOUD') >= 0)
const inWin = oi1.opportunities.find(w => w.type === 'IN_CLOUD')
check('IN_CLOUD evidence 引用云场覆盖范围', inWin && inWin.evidence.some(e => e.fact.indexOf('云区') >= 0))
check('VIEW_WINDOW 存在（云在脚下 = 站在云上远眺）', types1.indexOf('VIEW_WINDOW') >= 0)
check('无 overlap：VIEW_WINDOW（09–14）与 CLOUD_SEA（06:38–09:00）半开区间不相交',
  (() => {
    const mins = s2 => { const m = /^(\\d{1,2}):(\\d{2})/.exec(s2 || ''); return m ? +m[1] * 60 + +m[2] : -1 }
    const v = oi1.opportunities.find(w => w.type === 'VIEW_WINDOW')
    const s2 = oi1.opportunities.find(w => w.type === 'CLOUD_SEA')
    return v && s2 && mins(v.from) >= mins(s2.to)
  })())
check('天文窗口：golden/blueHour 为明确置信', oi1.opportunities.filter(w => w.type === 'GOLDEN_LIGHT' || w.type === 'BLUE_HOUR').every(w => w.confidence === '明确'))
check('全部窗口按 from 排序', oi1.opportunities.every((w2, i, a) => i === 0 || OI === null || skyCmp(a[i - 1].from, w2.from) <= 0))
function skyCmp(a, b) { const A = hm(a), B = hm(b); return A - B }
function hm(s) { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : -1 }

/* ---------- Silence：证据不足不产出 ---------- */
section('Silence：近晴空日不产出天气类窗口')
const clearBands = {}
const cfClear = cloudFieldWith(clearBands, 3500)
const ctxClear = Object.assign({}, baseCtx, {
  detail: detail24(TIMES.map(() => ({ low: 3, mid: 3, high: 3 })), clearBands, {}),
  userAltitude: 3500, elevOK: true, cloudField: cfClear,
})
const oiClear = OI.buildOutdoorIntelligence(ctxClear)
check('无 CLOUD_SEA / IN_CLOUD / CLOUD_BELOW / CLOUD_ABOVE 窗口',
  oiClear.opportunities.every(w => ['CLOUD_SEA', 'IN_CLOUD', 'VIEW_WINDOW'].indexOf(w.type) < 0),
  JSON.stringify(oiClear.opportunities.map(w => w.type)))
check('条件态为 CLEAR 或 null（不硬造状态）', oiClear.conditions.every(c => c.key === 'CLEAR' || c.key === null))

/* ---------- 回退：无云场时用 hour-view band ---------- */
section('回退：无 cloudField 时 band + sky 标记有限推断')
const bandDetail = detail24(TIMES.map((_, h) => ({ low: h < 3 ? 90 : 5, mid: 20, high: 10 })), TIMES.map((_, h) => h < 3 ? { base: 2600, top: 3200, cover: 90 } : null), {})
const ctxBand = Object.assign({}, baseCtx, {
  detail: bandDetail, userAltitude: 3500, elevOK: true,
})
const oiBand = OI.buildOutdoorIntelligence(ctxBand)
check('无云场：band ∩ 用户海拔外的脚下层 → CLOUD_BELOW（cloudSea 标记同源）',
  oiBand.conditions.slice(0, 3).every(c => c.key === 'CLOUD_BELOW' && c.source === 'hour-view'),
  JSON.stringify(oiBand.conditions.slice(0, 3).map(c => c.key)))
check('无云场：夜段云海被民用晨昏可见性规则正确丢弃（沉默）',
  !oiBand.opportunities.some(w => w.type === 'CLOUD_SEA'))

/* ---------- 跨夜（F4 阶段二）：今晚序列 → galaxy/star 窗口 ---------- */
section('跨夜：nightHours 决定 galaxy/star 窗口归属；前夜尾段不再产出')
const ND = '2026-10-07'
const ND2 = '2026-10-08'
const nightHour = (d, hh, over) => Object.assign({
  d, t: String(hh).padStart(2, '0') + ':00', temp: 10, pop: 0, precip: 0, showers: 0,
  code: 2, wind: 4, rh: 45, visibility: 35, cloud: { low: 5, mid: 5, high: 5 }, band: null,
}, over || {})
const nightSeq = spans => {
  const out = []
  spans.forEach(sp => { for (let hh = sp[0]; hh <= sp[1]; hh++) out.push(nightHour(sp[2] || ND, hh)) })
  return out
}
const marksWith = (hours, keys) => {
  const m = {}
  hours.forEach(h => { m[h.d + 'T' + h.t] = keys })
  return m
}
const noCloudDay = detail24(TIMES.map(() => ({ low: 5, mid: 5, high: 5 })), {}, {})
// 今日 00–05 是**前夜尾段**；15–16 的彩虹是阳性对照（与夜段无关，必须逐字节不变）
const tailStar = []
for (let hh = 0; hh <= 5; hh++) tailStar.push(nightHour(ND, hh))
const tailMarks = Object.assign(marksWith(tailStar, ['star']), {
  [ND + 'T15:00']: ['rainbow'], [ND + 'T16:00']: ['rainbow'],
})
const crossNight = nightSeq([[21, 23, ND], [0, 0, ND2]])
const crossMarks = Object.assign({}, tailMarks, marksWith(crossNight, ['galaxy']))
const crossCtx = Object.assign({}, baseCtx, {
  detail: noCloudDay, userAltitude: 3500, elevOK: true,
  marks: crossMarks, nightHours: crossNight,
})
const crossOi = OI.buildOutdoorIntelligence(crossCtx)
const mkW = crossOi.opportunities.filter(w => w.type === 'MILKY_WAY')
check('今晚 21:00 → 次日 00:00 产出一个银河窗口（from 今晚、to 次日，to<from）',
  mkW.length === 1 && mkW[0].from === '21:00' && mkW[0].to === '00:00',
  JSON.stringify(mkW.map(w => [w.type, w.from, w.to])))
check('跨零点窗口的 hours 用簇自己的序列（含次日 00:00，长度 4）',
  mkW.length === 1 && mkW[0].hours.length === 4 && mkW[0].hours.some(h => h.d === ND2),
  mkW[0] && JSON.stringify(mkW[0].hours.map(h => h.d + ' ' + h.t)))
check('今日 detail 的前夜尾段 star 窗口消失（00–05 不再产 STARGAZING）',
  !crossOi.opportunities.some(w => w.type === 'STARGAZING'),
  JSON.stringify(crossOi.opportunities.map(w => [w.type, w.from, w.to])))

const noNightCtx = Object.assign({}, crossCtx)
delete noNightCtx.nightHours
const noNightOi = OI.buildOutdoorIntelligence(noNightCtx)
check('阳性对照（不传 nightHours）：同一份数据里 00–05 star 窗口照旧存在',
  noNightOi.opportunities.some(w => w.type === 'STARGAZING' && w.from === '00:00' && w.to === '05:00'),
  JSON.stringify(noNightOi.opportunities.map(w => [w.type, w.from, w.to])))
/* 存在性门先立：两侧都找不到 rainbow 时 JSON.stringify(undefined) 相等，会把空跑记成绿 */
const crossRainbow = crossOi.opportunities.find(w => w.type === 'RAINBOW')
const noNightRainbow = noNightOi.opportunities.find(w => w.type === 'RAINBOW')
check('与夜段无关的窗口逐字节不变（彩虹窗口，阳性对照）',
  !!crossRainbow && !!noNightRainbow && JSON.stringify(crossRainbow) === JSON.stringify(noNightRainbow),
  JSON.stringify({ cross: crossRainbow || null, noNight: noNightRainbow || null }))
check('不传 nightHours 与显式 null 输出逐字节相同（旧路径不变）',
  JSON.stringify(noNightOi) === JSON.stringify(OI.buildOutdoorIntelligence(Object.assign({}, noNightCtx, { nightHours: null }))))

// 纯次日窗口（fromD 已在次日）在 24h 卡里无法表示 ⇒ 不产出
const nextOnlyNight = nightSeq([[1, 5, ND2]])
const nextOnly = OI.buildOutdoorIntelligence(Object.assign({}, baseCtx, {
  detail: noCloudDay, userAltitude: 3500, elevOK: true,
  marks: marksWith(nextOnlyNight, ['star']), nightHours: nextOnlyNight,
}))
check('纯次日簇（次日 01–05）不产出窗口（24h 卡无法表示）',
  !nextOnly.opportunities.some(w => w.type === 'STARGAZING'),
  JSON.stringify(nextOnly.opportunities.map(w => [w.type, w.from, w.to])))
const nextPlusTonight = nightSeq([[23, 23, ND], [0, 5, ND2]])
const nextPlusOi = OI.buildOutdoorIntelligence(Object.assign({}, baseCtx, {
  detail: noCloudDay, userAltitude: 3500, elevOK: true,
  marks: marksWith(nextPlusTonight, ['star']), nightHours: nextPlusTonight,
}))
check('阳性对照：同一序列加上今晚 23:00 ⇒ 跨零点窗口产出（证明上一条不是整体失效）',
  nextPlusOi.opportunities.some(w => w.type === 'STARGAZING' && w.from === '23:00' && w.to === '05:00'),
  JSON.stringify(nextPlusOi.opportunities.map(w => [w.type, w.from, w.to])))

// skyBlocked：跨零点只检查今日段 [from,24:00)；缺今日 conditions 不得误杀
const blockCtx = {
  date: ND, detail: noCloudDay, marks: marksWith(nextPlusTonight, ['star']), nightHours: nextPlusTonight,
  sun: null, win: null, factsFor: function () { return [] },
}
const blocked = OI.buildOpportunities(blockCtx, [{ t: '23:00', key: 'CLOUD_ABOVE', holds: ['mid'], evidence: [] }])
check('skyBlocked 跨零点：今日 23:00 头顶有云 ⇒ 窗口不产出',
  !blocked.some(w => w.type === 'STARGAZING'), JSON.stringify(blocked.map(w => [w.type, w.from, w.to])))
const unblocked = OI.buildOpportunities(blockCtx, [])
check('缺今日 conditions（空数组）不得把跨零点窗口误杀',
  unblocked.some(w => w.type === 'STARGAZING' && w.from === '23:00' && w.to === '05:00'),
  JSON.stringify(unblocked.map(w => [w.type, w.from, w.to])))
const dayNight = nightSeq([[20, 22, ND]])
const nonCrossCtx = {
  date: ND, detail: noCloudDay, marks: marksWith(dayNight, ['star']), nightHours: dayNight,
  sun: null, win: null, factsFor: function () { return [] },
}
check('skyBlocked 非跨零点行为不变：窗口内 21:00 头顶有云 ⇒ 不产出',
  !OI.buildOpportunities(nonCrossCtx, [{ t: '21:00', key: 'CLOUD_ABOVE', holds: ['mid'], evidence: [] }])
    .some(w => w.type === 'STARGAZING'))
check('skyBlocked 非跨零点：与窗口无关的时刻（06:00）不误杀',
  OI.buildOpportunities(nonCrossCtx, [{ t: '06:00', key: 'CLOUD_ABOVE', holds: ['mid'], evidence: [] }])
    .some(w => w.type === 'STARGAZING'))

// factsFor 的夜段必须切到今晚（否则跨零点窗口的证据还在统计前夜尾段）
const highDay = detail24(TIMES.map(() => ({ low: 5, mid: 5, high: 90 })), {}, {})
const ghostNight = nightSeq([[23, 23, ND], [0, 5, ND2]])
ghostNight[0].cloud = { low: 5, mid: 5, high: 90 }        // 今晚 23:00 仍是高云
for (let i = 1; i < ghostNight.length; i++) ghostNight[i].cloud = { low: 5, mid: 5, high: 0 }
const ghostMarks = Object.assign(marksWith(tailStar, ['star']), marksWith(ghostNight, ['star']))
const factsCtx = Object.assign({}, baseCtx, {
  detail: highDay, userAltitude: 3500, elevOK: true, marks: ghostMarks, nightHours: ghostNight,
})
const factsWith = OI.buildOutdoorIntelligence(factsCtx)
const factsWithout = OI.buildOutdoorIntelligence(Object.assign({}, factsCtx, { nightHours: null }))
const nightFact = (oi) => {
  const w = oi.opportunities.filter(x => x.type === 'STARGAZING')[0]
  const e = w && w.evidence.filter(x => /夜段高层云/.test(x.fact))[0]
  return e ? e.fact : ''
}
check('跨夜证据的夜段 = 今晚序列（高层云 13%，不是前夜尾段的 90%）',
  /夜段高层云 13%/.test(nightFact(factsWith)), nightFact(factsWith))
check('阳性对照（不传 nightHours）：夜段仍按自然日口径（90%）',
  /夜段高层云 90%/.test(nightFact(factsWithout)), nightFact(factsWithout))

/* ---------- Determinism ---------- */
section('Determinism：同输入同输出')
const oi1b = OI.buildOutdoorIntelligence(ctx1)
check('两次构建 deep-equal', JSON.stringify(oi1) === JSON.stringify(oi1b))

/* ---------- 三海拔差异（真实场景形态） ---------- */
section('三海拔：同一云场，不同海拔不同解读')
const sharedBands = {}
for (let h = 0; h < 24; h++) sharedBands[h] = h < 6 ? { lo: 2800, hi: 3600, cover: 92 } : (h >= 14 && h < 19 ? { lo: 3400, hi: 4200, cover: 88 } : null)
const mk = (elev) => OI.buildOutdoorIntelligence(Object.assign({}, baseCtx, {
  detail: detail24(TIMES.map((_, h) => (h < 6 || (h >= 14 && h < 19)) ? { low: 90, mid: 40, high: 25 } : { low: 5, mid: 10, high: 10 }), sharedBands, {}),
  userAltitude: elev, elevOK: true, cloudField: cloudFieldWith(sharedBands, elev),
}))
const oi3500 = mk(3500), oi3079 = mk(3079), oi500 = mk(500)
check('3500m：晨 IN_CLOUD（层云含 3500）+ 午后 IN_CLOUD',
  oi3500.conditions[2].key === 'IN_CLOUD' && oi3500.conditions[16].key === 'IN_CLOUD',
  oi3500.conditions[2].key + '/' + oi3500.conditions[16].key)
check('3079m：晨 IN_CLOUD（层云盖到 3079）+ 午后 IN_CLOUD',
  oi3079.conditions[2].key === 'IN_CLOUD', oi3079.conditions[2].key)
check('500m：全程非 IN_CLOUD（低海拔用户不在 2000m+ 云层内）',
  oi500.conditions.every(c => c.key !== 'IN_CLOUD'),
  JSON.stringify(oi500.conditions.map(c => c.key).filter(Boolean)))

/* ---------- 结构化证据契约与摘要选择（切片二） ---------- */
section('Evidence kind 契约：摘要由类别决定，不由中文决定')
{
  const KIND_VALUES = Object.keys(EK).map(k => EK[k])
  check('词表是封闭集（值不重复、都是短横线小写标识）',
    new Set(KIND_VALUES).size === KIND_VALUES.length && KIND_VALUES.every(v => /^[a-z][a-z-]*$/.test(v)),
    KIND_VALUES.join(','))
  const allEv = []
  oi1.opportunities.forEach(w => (w.evidence || []).forEach(e => allEv.push(e)))
  oi1.conditions.forEach(c => (c.evidence || []).forEach(e => allEv.push(e)))
  check('真实产出里每条证据都带 kind，且都 ∈ 词表（' + allEv.length + ' 条，无一裸奔）',
    allEv.length > 20 && allEv.every(e => typeof e.kind === 'string' && KIND_VALUES.indexOf(e.kind) !== -1),
    JSON.stringify(allEv.filter(e => !e.kind).map(e => String(e.fact)).slice(0, 3)))
  check('云海卡的"位置那句"被标成 layer-position（四种边界形态共用同一个类别，不靠措辞）',
    sea.evidence.filter(e => e.kind === 'layer-position').length === 1 &&
      sea.evidence[0].kind === 'layer-position', JSON.stringify(sea.evidence.map(e => e.kind)))
  check('IN_CLOUD 位置句同为 layer-position，云场覆盖那句是 data-coverage（数据的事实≠云的事实）',
    inWin.evidence[0].kind === 'layer-position' &&
      inWin.evidence.some(e => e.kind === 'data-coverage'), JSON.stringify(inWin.evidence.map(e => e.kind)))
  /* 无云场回退路径（hour-view）也走同一张词表 */
  const bandEv = oiBand.conditions.reduce((a, c) => a.concat(c.evidence || []), [])
  check('回退路径（band + sky 标记）的证据同样带 kind',
    bandEv.length > 0 && bandEv.every(e => KIND_VALUES.indexOf(e.kind) !== -1),
    JSON.stringify(bandEv.map(e => e.kind)))

  /* 机制判据：旧实现按 fact 字面找「云区/云层位于」，找不到退回 evidence[0]。
     下面这两条在旧实现下都会红——它们测的是"选择依据到底是什么"。 */
  const synthetic = {
    evidence: [
      { fact: '第一条只是一句普通补充说明', at: '03:00', kind: 'duration' },
      { fact: '第二条才是真正的结论，中文怎么写都一样', at: '07:00', kind: 'layer-position' },
    ],
    from: '03:00', to: '09:00', type: 'CLOUD_SEA',
  }
  check('摘要取 kind=layer-position 那一条，即使它排在后面、中文里没有任何关键字（旧实现会退回第一条）',
    OIP.summaryOf(synthetic) === '第二条才是真正的结论，中文怎么写都一样', OIP.summaryOf(synthetic))
  check('「看图」锚点与摘要同源：两者指向同一条证据的时刻（旧实现一个读 evidence[0]、一个读文案命中项，会分叉）',
    OIP.primaryEvidence(synthetic).at === '07:00' &&
      (() => {
        const card = OIP.buildOiCard({ conditions: [], opportunities: [Object.assign({}, synthetic, { rank: 'primary', confidence: '高' })], meta: {} }, { width: 375 })
        const it = card.items[0]
        return !!it && it.anchor.focusLabel === '07:00' && it.summaryText === '第二条才是真正的结论，中文怎么写都一样'
      })(), JSON.stringify(OIP.buildOiCard({ conditions: [], opportunities: [synthetic], meta: {} }, { width: 375 }).items[0] || null))
  check('缺省行为保留：一条 kind 都没有时退回第一条（与旧实现同形），空证据返回空串而不是抛错',
    OIP.summaryOf({ evidence: [{ fact: '甲' }, { fact: '乙' }] }) === '甲' && OIP.summaryOf({ evidence: [] }) === '' && OIP.summaryOf({}) === '')
  check('优先序只有一处声明，且呈现层不再引用任何中文关键字（防"文案即接口"复发）',
    OIP.SUMMARY_KIND_PRIORITY.length >= 1 && OIP.SUMMARY_KIND_PRIORITY.every(k => KIND_VALUES.indexOf(k) !== -1),
    JSON.stringify(OIP.SUMMARY_KIND_PRIORITY))
  /* 真实产出走一遍：摘要必须就是那条被标为最高优先级的证据，且与文案无关 */
  const real = oi1.opportunities.filter(w => (w.evidence || []).length > 0)
  check('真实窗口的摘要逐条等于 primaryEvidence 的 fact（不是"碰巧第一条"）',
    real.length > 0 && real.every(w => OIP.summaryOf(w) === OIP.primaryEvidence(w).fact))
}

/* ---------- Fallback marks 与主卡同源 ---------- */
section('Fallback marks：增强输入必须与主卡同一份（不是两套判据）')
{
  /* 2026-07-15 银心季 + 残月：晴朗低月夜本应出银河窗口。
     不传 marks，逼 buildOutdoorIntelligence 自己调 sky.hourMarks；
     再注入一道 89° 山脊，若 fallback 没把 terrain 传下去，银河窗口不会消失。 */
  const gd = []
  for (let h = 0; h < 24; h++) gd.push({
    d: '2026-07-15', t: (h < 10 ? '0' : '') + h + ':00',
    temp: 14, pop: 0, precip: 0, showers: 0, code: 0, wind: 4, gust: 8,
    windDir: 90, rh: 40, visibility: 35, cloud: { low: 5, mid: 5, high: 10 }, band: null,
  })
  const gctx = { date: '2026-07-15', lat: 30.67, lng: 104.07, detail: gd, userAltitude: 1200, elevOK: true }
  const open = OI.buildOutdoorIntelligence(gctx)
  const ridge = {
    horizon: Array.from({ length: 16 }, (_, i) => ({
      azimuth: i * 22.5, angle: 89, distance: 1, elevation: 9000,
    })),
  }
  const blocked = OI.buildOutdoorIntelligence(Object.assign({}, gctx, { terrain: ridge }))
  check('晴朗低月夜：fallback 产出银河窗口',
    open.opportunities.some(w => w.type === 'MILKY_WAY'),
    open.opportunities.map(w => w.type).join(','))
  check('同一份数据 + 89° 山脊：fallback 与主卡同源地不产银河窗口（terrain 真的传下去了）',
    !blocked.opportunities.some(w => w.type === 'MILKY_WAY'),
    blocked.opportunities.map(w => w.type).join(','))
}

/* ---------- Performance ---------- */
section('性能')
const t1 = Date.now()
for (let i = 0; i < 50; i++) OI.buildOutdoorIntelligence(ctx1)
const ms = (Date.now() - t1) / 50
check('单次构建 < 20ms', ms < 20, ms.toFixed(2) + 'ms')

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
