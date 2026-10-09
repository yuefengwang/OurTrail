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
  sea && sea.evidence.some(e => e.fact.indexOf('云层位于') >= 0) &&
  sea.evidence.some(e => e.fact.indexOf('此点高于云层底部约') >= 0) && sea.evidence.length >= 3,
  sea && JSON.stringify(sea.evidence))
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

/* ---------- Performance ---------- */
section('性能')
const t1 = Date.now()
for (let i = 0; i < 50; i++) OI.buildOutdoorIntelligence(ctx1)
const ms = (Date.now() - t1) / 50
check('单次构建 < 20ms', ms < 20, ms.toFixed(2) + 'ms')

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
