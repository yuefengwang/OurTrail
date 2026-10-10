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
/* 切片二把这本账拆了：LOW_PERSISTENCE 是**窗口级**（逐时候选都过了，只是没连成窗），
   以前它和逐时门槛拒绝挤在 `rejected` 里，于是
   `candidates + rejected + notEvaluated === 逐时数` 这条分区不变量凭空多出窗口级条目。
   这条断言是**替换**而非削弱：具名拒绝仍然在，而且现在还能验证两本账不串味。 */
check('单小时候选（<2h）→ 不产出窗口；具名拒绝在窗口账本 noWindow，不污染逐时账本 rejected',
  !findSea(single) &&
  single.meta.cloudSea.rejected.every(r => r.reason !== 'LOW_PERSISTENCE') &&
  single.meta.cloudSea.noWindow.some(r => r.reason === 'LOW_PERSISTENCE' && r.stage === 'window'),
  JSON.stringify((single.meta.cloudSea || {}).noWindow || []))
check('三本账分区不变量：candidates+rejected+notEvaluated 恰等于逐时数（窗口级条目不计入）',
  single.meta.cloudSea.candidates.length + single.meta.cloudSea.rejected.length +
    single.meta.cloudSea.notEvaluated.length === single.conditions.length,
  [single.meta.cloudSea.candidates.length, single.meta.cloudSea.rejected.length,
    single.meta.cloudSea.notEvaluated.length, single.conditions.length].join('/'))

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
/* 旧断言写的是「云层位于 2,0xx m」——那个 2,000 恰好等于扫描窗下界，
   等于把「扫描边界」当成「测出来的云底」钉进了测试（R2 审计 §3 模式 C 的活教材）。
   现在要求证据句如实说云底未测得。 */
check('双层云：低层云底恰在扫描下界 ⇒ 证据不许把 2,000 说成云底',
  findSea(multi) && findSea(multi).evidence.some(e => e.fact.indexOf('云底低于剖面扫描窗下界') === 0) &&
    !findSea(multi).evidence.some(e => /^云层位于 /.test(e.fact)),
  findSea(multi) && JSON.stringify(findSea(multi).evidence.map(e => e.fact)))

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

/* ---------- R2：扫描窗边界不是云界（2026-10-09 审计迁移第一步） ---------- */
section('R2 边界语义：窗边界不得冒充云底/云顶，且业务判据一字不动')
const ALT_LO = require('../miniprogram/utils/cloud-field-svg.js').ALT0
const ALT_HI = require('../miniprogram/utils/cloud-field-svg.js').ALT1
function seaCase (base, top, userAlt) {
  return OI.buildOutdoorIntelligence(makeCtx(
    h => (h >= 5 && h < 10) ? { base: base, top: top, cover: 95 } : null,
    h => (h >= 5 && h < 10) ? { low: 95, mid: 20, high: 20 } : { low: 5, mid: 5, high: 5 },
    { userAltitude: userAlt }))
}
const factsOf = w => (w ? w.evidence.map(e => String(e.fact)) : [])
/* 每种边界形态都钉三件事：① 层记录上的来源标记 ② 证据文案的说法 ③ 窗口与层数值本身。
 * ③ 的数值取自在 6d7a1dc（R2 之前）与当前工作树各跑一遍的实测，两侧逐字相同；
 * 跨版本对拍不在本文件里做（自己实现一遍"旧版本"就是镜像被测层，等于没测），
 * 见 qa/v2-oi-scan-r2-2026-10-09/tools/ab-r2.js 与 ab-r2.json。 */
const num = f => { const m = String(f).match(/([\d,]+)/); return m ? +m[1].replace(/,/g, '') : NaN }
const fullWin = findSea(seaCase(2400, 3300, 4200))
check('完整落在窗内：证据说「云层位于 2,179–3,294 m」，两端都不带「未测得」，业务数值 = R2 之前实测值',
  !!fullWin && fullWin.from === '06:51' && fullWin.to === '10:00' && fullWin.confidence === '高' &&
    fullWin.strength === 'STRONG' &&
    fullWin.layers.length === 5 &&
    fullWin.layers.every(l => l.base === 2179 && l.top === 3294 && l.cover === 93 && l.clearance === 906 &&
      l.baseBoundary === false && l.topBoundary === false) &&
    factsOf(fullWin)[0] === '云层位于 2,179–3,294 m' &&
    !factsOf(fullWin).some(f => /未测得|下限值|上限/.test(f)),
  factsOf(fullWin).join(' / '))
const lowWin = findSea(seaCase(ALT_LO, 2900, 4200))
check('下边界触碰：base 恰为窗下界 ⇒ baseBoundary=true，证据说云底未测得而不是「云层位于 2,000…」',
  !!lowWin && lowWin.layers.every(l => l.base === ALT_LO && l.baseBoundary === true && l.topBoundary === false) &&
    /^云底低于剖面扫描窗下界 /.test(factsOf(lowWin)[0]) && num(factsOf(lowWin)[0]) === ALT_LO &&
    factsOf(lowWin)[0].indexOf('窗内云层顶约 2,794 m') > 0 &&
    !factsOf(lowWin).some(f => /^云层位于 /.test(f)) &&
    lowWin.layers.every(l => l.top === 2794 && l.cover === 95 && l.clearance === 1406) &&
    lowWin.from === '06:51' && lowWin.to === '10:00' && lowWin.confidence === '高',
  factsOf(lowWin).join(' / '))
const topWin = findSea(seaCase(5300, ALT_HI + 600, 6900))
check('上边界触碰：top 恰为窗上界 ⇒ topBoundary=true，净空那句标注为上限而不是实测',
  !!topWin && topWin.layers.every(l => l.top === ALT_HI && l.topBoundary === true && l.baseBoundary === false) &&
    /^云顶高于剖面扫描窗上界 /.test(factsOf(topWin)[0]) && num(factsOf(topWin)[0]) === ALT_HI &&
    factsOf(topWin)[0].indexOf('窗内云层底约 5,450 m') > 0 &&
    /云顶未测得，此为上限/.test(factsOf(topWin)[1]) && factsOf(topWin)[1].indexOf('约 900 m') > 0 &&
    topWin.layers.every(l => l.base === 5450 && l.cover === 95 && l.clearance === 900) &&
    topWin.from === '06:51' && topWin.to === '10:00' && topWin.confidence === '高',
  factsOf(topWin).join(' / '))
const thruWin = findSea(seaCase(ALT_LO - 500, ALT_HI + 500, 6900))
check('贯穿整窗：两端都说未测得，层厚 4000 m 明确是「窗内可见部分」的下限值',
  !!thruWin && thruWin.layers.every(l => l.base === ALT_LO && l.top === ALT_HI &&
      l.baseBoundary === true && l.topBoundary === true) &&
    /^浓云贯穿剖面扫描窗 2,000–6,000 m/.test(factsOf(thruWin)[0]) &&
    factsOf(thruWin).some(f => f.indexOf('层厚 4000 m 按扫描窗内可见部分计算，是下限值而不是实测厚度') === 0) &&
    thruWin.layers.every(l => l.cover === 95 && l.clearance === 900) &&
    thruWin.from === '06:51' && thruWin.to === '10:00' && thruWin.confidence === '高',
  factsOf(thruWin).join(' / '))
check('通用不变量：任何云海证据里「云层位于 X–Y m」的 X/Y 都不得等于扫描窗边界',
  [findSea(sea), findSea(multi), fullWin, lowWin, topWin, thruWin].reduce(function (acc, w) {
    if (!w) return acc
    return acc && !factsOf(w).some(function (f) {
      const m = f.match(/^云层位于 ([\d,]+)–([\d,]+) m$/)
      if (!m) return false
      return +m[1].replace(/,/g, '') === ALT_LO || +m[2].replace(/,/g, '') === ALT_HI
    })
  }, true) && !!findSea(sea) && !!findSea(multi))
check('来源标记自洽：flag=true 的那一端，层数值必须恰好等于窗边界（不许标了边界却报出一个窗内的数）',
  [fullWin, lowWin, topWin, thruWin].every(w => !!w && w.layers.every(l =>
    (!l.baseBoundary || l.base === ALT_LO) && (!l.topBoundary || l.top === ALT_HI))))
check('R2 不改候选集合：四种边界形态都各自成窗，且每例都只有 1 个 CLOUD_SEA 窗口（没有多出候选）',
  [fullWin, lowWin, topWin, thruWin].every(Boolean) &&
    [seaCase(2400, 3300, 4200), seaCase(ALT_LO, 2900, 4200), seaCase(5300, ALT_HI + 600, 6900),
      seaCase(ALT_LO - 500, ALT_HI + 500, 6900)].every(oi =>
      oi.opportunities.filter(w => w.type === 'CLOUD_SEA').length === 1))
check('晴空（无 ≥80% 层）仍然零窗口——边界修复没有制造出候选',
  !!findSea(seaCase(2400, 3300, 4200)) &&
    !findSea(OI.buildOutdoorIntelligence(makeCtx(() => null, () => ({ low: 3, mid: 3, high: 3 }), { userAltitude: 3500 }))))
check('缺失数据（无 cloudField）不产出云海窗口，也不抛出任何边界文案',
  (() => {
    const base = makeCtx(() => null, () => ({ low: 0, mid: 0, high: 0 }), { userAltitude: 3500 })
    const oi = OI.buildOutdoorIntelligence({ date: base.date, detail: base.detail, userAltitude: 3500, elevOK: true, cloudField: null, days: [] })
    return !findSea(oi) && oi.opportunities.every(o => !(o.evidence || []).some(e => /剖面扫描窗/.test(String(e.fact))))
  })())
/* 呈现层摘要钉（切片二起，选中的是哪一条由证据的 `kind` 决定，不再看中文的字面）：
 * R2 那一轮它靠的是 `fact.indexOf('云区')/indexOf('云层位于')` + "位置那句排第一"，
 * 于是改一句文案就等于改一次接口。下面这条断言**测的是输出**（四种边界形态各取到哪句），
 * 与选择机制无关，所以换机制时它照样有效；机制本身由 outdoor-intelligence-ui-test §9 钉。 */
const OIP = require('../miniprogram/utils/oi-presentation.js')
const summaryOfSea = oi => {
  const card = OIP.buildOiCard(oi, { width: 375 })
  const it = (card.items || []).filter(i => i.type === 'CLOUD_SEA')[0]
  return it && it.summaryText
}
check('卡片摘要：四种边界形态都取到"位置那句"，被切的形态不会退化成一句通用事实',
  [
    [seaCase(2400, 3300, 4200), /^云层位于 /],
    [seaCase(ALT_LO, 2900, 4200), /^云底低于剖面扫描窗下界 /],
    [seaCase(5300, ALT_HI + 600, 6900), /^云顶高于剖面扫描窗上界 /],
    [seaCase(ALT_LO - 500, ALT_HI + 500, 6900), /^浓云贯穿剖面扫描窗 /],
  ].every(function (pair) {
    const s = summaryOfSea(pair[0])
    return !!s && pair[1].test(s) && s === findSea(pair[0]).evidence[0].fact
  }))
check('净空那句主语与对象都对：说的是「高于该云层顶」，不是「云层底部」（净空 = 此点 − 云顶）',
  [fullWin, lowWin, topWin, thruWin].every(w => !!w &&
    w.evidence.some(e => /此点高于该云层顶约 [\d,]+ m/.test(String(e.fact))) &&
    !w.evidence.some(e => /云层底部/.test(String(e.fact)))))

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
