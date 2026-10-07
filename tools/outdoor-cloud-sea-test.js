/* Cloud Sea Opportunity（OI Phase 2）测试
 * 覆盖：几何（用户在云上/内/下）、覆盖（低/中/高）、层厚（薄/合格/极厚）、
 *       时间（单小时/连续/短缺口/破碎）、多层级、风（弱/中/强）、沉默、确定性。
 * 运行：node tools/outdoor-cloud-sea-test.js
 */
'use strict'

const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = (t) => console.log('\n== ' + t + ' ==')

let passed = 0, failed = 0
const OI = require('../miniprogram/utils/outdoor-intelligence.js')
const astro = require('../miniprogram/utils/astro.js')

const TIMES = []
for (let h = 0; h < 24; h++) TIMES.push('2026-10-07T' + (h < 10 ? '0' : '') + h + ':00')

/* 合成工具：
 *   bandsFn(h)  → { base, top, cover } | null（hourView band 契约）
 *   cloudsFn(h) → { low, mid, high }
 *   opts        → { userAltitude, wind(h) } */
function makeCtx(bandsFn, cloudsFn, opts) {
  opts = opts || {}
  const wind = opts.wind || (() => 4)
  const detail = TIMES.map((t, h) => ({
    d: t.slice(0, 10), t: t.slice(11, 16),
    temp: 12, code: 0,
    pop: 0,
    precip: opts.precip ? opts.precip(h) : 0,
    showers: opts.showers ? opts.showers(h) : 0,
    wind: wind(h), gust: Math.round(wind(h) * 1.4),
    windDir: 90, rh: 40,
    visibility: 35,
    cloud: cloudsFn(h) || { low: 5, mid: 5, high: 5 },
    band: bandsFn(h) || null,
  }))
  const altitudes = []
  for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
  const cloudField = {
    times: TIMES.map((_, i) => i), altitudes: altitudes,
    values: TIMES.map((_, h) => {
      const b = bandsFn(h), c = cloudsFn(h) || { low: 5, mid: 5, high: 5 }
      return altitudes.map(alt => {
        if (b && alt >= b.base && alt <= b.top) return b.cover
        const near = Math.min(Math.abs(alt - (b ? b.base : 2600)), 700)
        const base3 = alt < 2600 ? c.low : alt < 4600 ? c.mid : c.high
        return base3 * (near < 700 ? 1 - near / 700 * 0.5 : 0.5)
      })
    }),
    userAltitude: opts.userAltitude || 3500,
    covered: { lo: 0, hi: 7000 },
  }
  return {
    date: '2026-10-07', lat: 29.9, lng: 100.27,
    detail: detail, userAltitude: opts.userAltitude || 3500, elevOK: true,
    cloudField: cloudField,
  }
}

/* 常用场景（海：05–10h 厚层 2000–3100m @95%，用户 3500m，净空 400m） */
const SEA_BANDS = h => (h >= 5 && h < 10) ? { base: 2000, top: 3100, cover: 95 } : null
const SEA_CLOUDS = h => (h >= 5 && h < 10) ? { low: 95, mid: 40, high: 10 } : { low: 5, mid: 5, high: 5 }

const findSea = oi => oi.opportunities.find(w => w.type === 'CLOUD_SEA')

/* ---------- 几何：用户在云上 / 云内 / 云下 ---------- */
section('几何：user above / inside / below cloud')
const sea = OI.buildOutdoorIntelligence(makeCtx(SEA_BANDS, SEA_CLOUDS, { userAltitude: 3500 }))
const seaWin = findSea(sea)
check('用户在云上（净空 400m ≥ 200m）→ CLOUD_SEA 窗口', !!seaWin)
const civilDawn = astro.sunTimes('2026-10-07', 29.9, 100.27, 3500).civilDawn
check('窗口时段 = 民用晨光裁剪（' + civilDawn + '）–10:00', seaWin && seaWin.from === civilDawn && seaWin.to === '10:00', seaWin && seaWin.from + '–' + seaWin.to)
check('strength = STRONG（覆盖 95 + 层厚 1100 + 持续 5h）', seaWin && seaWin.strength === 'STRONG', seaWin && seaWin.strength)

const inside = OI.buildOutdoorIntelligence(makeCtx(
  h => (h >= 5 && h < 10) ? { base: 3200, top: 4200, cover: 95 } : null,
  h => (h >= 5 && h < 10) ? { low: 95, mid: 60, high: 20 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('用户在云内 → 无 CLOUD_SEA 窗口（沉默）', !findSea(inside))
check('用户在云内 → 条件态 IN_CLOUD', inside.conditions[7] && inside.conditions[7].key === 'IN_CLOUD')

const above = OI.buildOutdoorIntelligence(makeCtx(
  h => (h >= 5 && h < 10) ? { base: 3800, top: 4800, cover: 95 } : null,
  h => (h >= 5 && h < 10) ? { low: 5, mid: 40, high: 95 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('用户在云下（层在 3800+ 上方）→ 无 CLOUD_SEA 窗口', !findSea(above))

/* ---------- Coverage / Thickness ---------- */
section('Coverage / Thickness 阈值')
const lowCov = OI.buildOutdoorIntelligence(makeCtx(
  h => (h >= 5 && h < 10) ? { base: 2000, top: 3100, cover: 70 } : null,
  h => (h >= 5 && h < 10) ? { low: 70, mid: 20, high: 10 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('覆盖 70%（<80 门槛）→ 条件 CLOUD_BELOW 但无云海窗口（沉默）',
  lowCov.conditions[7] && lowCov.conditions[7].key === 'CLOUD_BELOW' && !findSea(lowCov))
check('负证据：LOW_COVERAGE / NO_LAYER_BELOW / INSUFFICIENT_THICKNESS（模型内部保留）',
  lowCov.meta.cloudSea && lowCov.meta.cloudSea.rejected.length > 0 &&
  lowCov.meta.cloudSea.rejected.some(r => ['LOW_COVERAGE', 'NO_LAYER_BELOW', 'INSUFFICIENT_THICKNESS'].indexOf(r.reason) >= 0),
  JSON.stringify((lowCov.meta.cloudSea || {}).rejected || []).slice(0, 140))

/* 层厚不足：150m 薄带（场插值后实际层厚 ~150-260m）< 300m 门槛 @95% */
const thin = OI.buildOutdoorIntelligence(makeCtx(
  h => (h >= 5 && h < 10) ? { base: 2000, top: 2150, cover: 95 } : null,
  h => (h >= 5 && h < 10) ? { low: 95, mid: 10, high: 5 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('层厚 <300m 门槛 → 不产出云海窗口（INSUFFICIENT_THICKNESS）',
  !findSea(thin) && thin.meta.cloudSea.rejected.some(r => r.reason === 'INSUFFICIENT_THICKNESS'))

/* ---------- Time：单小时 / 连续 / 短缺口 / 破碎 ---------- */
section('Time：单小时 / 连续 / 短缺口 / 破碎')
const single = OI.buildOutdoorIntelligence(makeCtx(
  h => h === 6 ? { base: 2000, top: 3100, cover: 95 } : null,
  h => h === 6 ? { low: 95, mid: 40, high: 10 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('单小时候选（<2h）→ 不产出窗口（LOW_PERSISTENCE）',
  !findSea(single) && single.meta.cloudSea.rejected.some(r => r.reason === 'LOW_PERSISTENCE'))

const gap = OI.buildOutdoorIntelligence(makeCtx(
  h => ((h >= 5 && h < 7) || h === 8 || (h >= 9 && h < 11)) ? { base: 2000, top: 3100, cover: 95 } : null,
  h => ((h >= 5 && h < 7) || h === 8 || (h >= 9 && h < 11)) ? { low: 95, mid: 40, high: 10 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('1h 缺口被容忍 → 合并为一个窗口（civil 裁剪起点–11:00）',
  gap.opportunities.filter(w => w.type === 'CLOUD_SEA').length === 1 &&
  gap.opportunities.find(w => w.type === 'CLOUD_SEA').to === '11:00')

const broken = OI.buildOutdoorIntelligence(makeCtx(
  h => ((h >= 5 && h < 7) || (h >= 9 && h < 11)) ? { base: 2000, top: 3100, cover: 95 } : null,
  h => ((h >= 5 && h < 7) || (h >= 9 && h < 11)) ? { low: 95, mid: 40, high: 10 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('2h 缺口超过容忍 → 两个独立窗口', broken.opportunities.filter(w => w.type === 'CLOUD_SEA').length === 2)

/* ---------- 多层云 ---------- */
section('Multiple layers：双层云取离用户最近合格层')
const multi = OI.buildOutdoorIntelligence(makeCtx(
  h => (h >= 5 && h < 10) ? { base: 2000, top: 2600, cover: 90 } : null,
  h => (h >= 5 && h < 10) ? { low: 90, mid: 20, high: 95 } : { low: 5, mid: 5, high: 5 },
  { userAltitude: 3500 }))
check('双层云：低层成云海窗口、高层不干扰', !!findSea(multi))
check('双层云：evidence 引用低层（云层位于 2,0xx m）',
  findSea(multi) && findSea(multi).evidence.some(e => e.fact.indexOf('云层位于 2,0') >= 0))

/* ---------- Wind ---------- */
section('Wind：强风降级强度')
const calmSea = OI.buildOutdoorIntelligence(makeCtx(SEA_BANDS, SEA_CLOUDS, { userAltitude: 3500, wind: () => 8 }))
const windySea = OI.buildOutdoorIntelligence(makeCtx(SEA_BANDS, SEA_CLOUDS, { userAltitude: 3500, wind: () => 24 }))
check('弱风 → STRONG', calmSea.opportunities.find(w => w.type === 'CLOUD_SEA').strength === 'STRONG')
check('强风(24km/h) → 降级为 MODERATE', windySea.opportunities.find(w => w.type === 'CLOUD_SEA').strength === 'MODERATE')

/* ---------- 日出 enrichment ---------- */
section('Sunrise enrichment')
check('窗口与日出重叠 → overlapsSunrise + 证据', seaWin.overlapsSunrise === true &&
  seaWin.evidence.some(e => e.fact.indexOf('日出') >= 0))

/* ---------- Silence / Determinism / 性能 ---------- */
section('Silence / Determinism / 性能')
const none = OI.buildOutdoorIntelligence(makeCtx(() => null, () => ({ low: 3, mid: 3, high: 3 }), { userAltitude: 3500 }))
check('无云日 → 零云海窗口', !findSea(none))
const again = OI.buildOutdoorIntelligence(makeCtx(SEA_BANDS, SEA_CLOUDS, { userAltitude: 3500 }))
check('确定性：同输入两次构建一致', JSON.stringify(again) === JSON.stringify(sea))
const t1 = Date.now()
for (let i = 0; i < 20; i++) OI.buildOutdoorIntelligence(makeCtx(SEA_BANDS, SEA_CLOUDS, { userAltitude: 3500 }))
const ms = (Date.now() - t1) / 20
check('单次构建 < 30ms（含云海检测）', ms < 30, ms.toFixed(2) + 'ms')

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
