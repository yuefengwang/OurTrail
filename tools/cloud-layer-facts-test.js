/* cloud-layer-facts（L1→L2 边界）契约测试
 *
 * 这一层只该管三件事：什么算一层云、每一端是实测边界还是扫描边界、
 * 以及"业务扫描范围是谁给的"。机会判定（净空/层厚/窗口）不在这个文件里测——
 * 那些住在 outdoor-cloud-sea-test.js。
 *
 * 运行：node tools/cloud-layer-facts-test.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const CLF = require('../miniprogram/utils/cloud-layer-facts.js')
const CFF = require('../miniprogram/utils/cloud-field-svg.js')
const OI = require('../miniprogram/utils/outdoor-intelligence.js')

let passed = 0, failed = 0
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
const section = t => console.log('\n== ' + t + ' ==')

/* ---------- 合成云场：与 ab 脚本同一形态，规则独立写 ---------- */
const ALTS = (function () { const a = []; for (let x = 0; x <= 7000; x += 250) a.push(x); return a })()
function fieldOf (decks, covered, hours) {
  const n = hours || 24
  const times = []
  for (let h = 0; h < n; h++) times.push(h)
  const values = times.map(() => ALTS.map(a => {
    if (a < covered.lo || a > covered.hi) return 0     // 实测范围外 = 填充 0（不是"没云"）
    let v = 0
    decks.forEach(d => { if (a >= d.lo && a <= d.hi) v = Math.max(v, d.cov) })
    return v
  }))
  const column = CFF.makeColumnSampler({ times: times, altitudes: ALTS, values: values, covered: covered })
  return (t, a) => CFF.sampleAtStations(column, times.length, t, a)
}
const ALL = { lo: 0, hi: 7000 }
const L = (sample, ranges, t) => CLF.layersAt(sample, t == null ? 3 : t, ranges, { coverMin: 80, step: 50 })

/* ---------- 1. 三个高度范围各是各的 ---------- */
section('1 显示范围 / 实测覆盖 / 业务扫描范围：不许互相顶替')
{
  const r = CLF.resolveRanges({})
  check('缺省业务扫描范围 = 固定基准，且来源自报为 display-window（R1 待解耦这件事在数据里看得见）',
    r.scan.lo === CFF.ALT0 && r.scan.hi === CFF.ALT1 && r.scan.source === 'display-window', JSON.stringify(r.scan))
  check('没有实测覆盖信息时如实说"无法判断"，而不是猜一个范围',
    r.data === null && r.notes.some(n => /无实测覆盖/.test(n)), JSON.stringify(r.notes))
  const inside = CLF.resolveRanges({ dataCoverage: { lo: 131, hi: 6682 } })
  check('扫描范围完全落在实测覆盖之内 ⇒ 不产生"扫到数据之外"的告警',
    inside.scanOutsideData[0] === 0 && inside.scanOutsideData[1] === 0 && inside.notes.length === 1,
    JSON.stringify(inside.scanOutsideData) + ' ' + JSON.stringify(inside.notes))
  const lowData = CLF.resolveRanges({ dataCoverage: { lo: 2600, hi: 5000 } })
  check('实测覆盖比扫描范围窄 ⇒ 两个方向各记一笔，并说明那段读到的是填充 0 不等于无云',
    lowData.scanOutsideData[0] === 600 && lowData.scanOutsideData[1] === 1000 &&
      lowData.notes.filter(n => /填充值 0/.test(n)).length === 2,
    JSON.stringify(lowData))
  const given = CLF.resolveRanges({ scanRange: { lo: 1000, hi: 4000, source: 'relative-to-point' } })
  check('调用方给了扫描范围就用调用方的，来源随之改标（R1 的接缝就在这里，本轮不改默认行为）',
    given.scan.lo === 1000 && given.scan.hi === 4000 && given.scan.source === 'relative-to-point' &&
      !given.notes.some(n => /display-window|显示窗/.test(n)), JSON.stringify(given))
  const bad = CLF.resolveRanges({ scanRange: { lo: 5000, hi: 5000 }, dataCoverage: { lo: 5, hi: 5 } })
  check('无效范围（hi 不大于 lo）不采信：扫描退回缺省、覆盖记为 null 而不是当成"只测到 5 m"',
    bad.scan.lo === CFF.ALT0 && bad.scan.hi === CFF.ALT1 && bad.data === null &&
      bad.notes.some(n => /无实测覆盖/.test(n)), JSON.stringify(bad))
}

/* ---------- 2. 云层事实：四种边界形态 ---------- */
section('2 完整层 / 下界截断 / 上界截断 / 无数据')
{
  const ranges = CLF.resolveRanges({})
  const full = L(fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], ALL), ranges)
  check('完整落在扫描范围内：两端都是 measured，base/top 不是窗边界',
    full.length === 1 && full[0].baseBoundary === false && full[0].topBoundary === false &&
      full[0].baseSource === 'measured' && full[0].topSource === 'measured' &&
      full[0].base > ranges.scan.lo && full[0].top < ranges.scan.hi, JSON.stringify(full))
  const lowCut = L(fieldOf([{ lo: 1200, hi: 2600, cov: 92 }], ALL), ranges)
  check('下界截断：baseBoundary=true、baseSource=scan-floor，且 base 恰等于扫描下界',
    lowCut.length === 1 && lowCut[0].baseBoundary === true && lowCut[0].baseSource === 'scan-floor' &&
      lowCut[0].base === ranges.scan.lo && lowCut[0].topBoundary === false, JSON.stringify(lowCut))
  const topCut = L(fieldOf([{ lo: 5600, hi: 7000, cov: 92 }], ALL), ranges)
  check('上界截断：topBoundary=true、topSource=scan-ceiling，且 top 恰等于扫描上界',
    topCut.length === 1 && topCut[0].topBoundary === true && topCut[0].topSource === 'scan-ceiling' &&
      topCut[0].top === ranges.scan.hi && topCut[0].baseBoundary === false, JSON.stringify(topCut))
  const thru = L(fieldOf([{ lo: 1000, hi: 6900, cov: 95 }], ALL), ranges)
  check('贯穿整窗：两端都标成扫描边界（这一段没有任何一端是实测云界）',
    thru.length === 1 && thru[0].baseBoundary && thru[0].topBoundary &&
      thru[0].thickness === ranges.scan.hi - ranges.scan.lo, JSON.stringify(thru))
  check('缺失云层数据：整场无 ≥80% ⇒ 零层，而不是"一层厚度 0 的云"',
    L(fieldOf([], ALL), ranges).length === 0)
  const noData = L(fieldOf([{ lo: 2400, hi: 3300, cov: 92 }], { lo: 4000, hi: 7000 }), ranges)
  check('云在实测覆盖之内、扫描范围之外 ⇒ 扫不到就是扫不到，不拿填充 0 造出一层"无云"',
    noData.length === 0, JSON.stringify(noData))
  check('来源词表与布尔恒等（不允许出现 flag=false 却写着 scan-floor 的自相矛盾）',
    [full, lowCut, topCut, thru].every(rows => rows.every(l =>
      (l.baseBoundary === (l.baseSource === 'scan-floor')) && (l.topBoundary === (l.topSource === 'scan-ceiling')))))
  check('每层都带回它自己是被哪个范围扫出来的（scanLo/scanHi），换范围后读数可自证',
    lowCut.every(l => l.scanLo === ranges.scan.lo && l.scanHi === ranges.scan.hi) &&
      L(fieldOf([{ lo: 1200, hi: 2600, cov: 92 }], ALL), { scan: { lo: 1000, hi: 4000 } })[0].scanLo === 1000)
}

/* ---------- 3. 厚度/覆盖是几何量，不是判定 ---------- */
section('3 层几何量：本层不做机会判定')
{
  const ranges = CLF.resolveRanges({})
  const thin = L(fieldOf([{ lo: 2400, hi: 2500, cov: 90 }], ALL), ranges)[0]
  check('100 m 薄层照样如实产出（够不够 300 m 是 L3 的判定，不在这里被吞掉）',
    thin && thin.thickness > 0 && thin.thickness < 300, JSON.stringify(thin))
  check('meanCover / peakCover 都在，且 peak ≥ mean',
    thin.peakCover >= thin.meanCover && thin.meanCover >= 80, JSON.stringify(thin))
  const multi = L(fieldOf([{ lo: 2200, hi: 2600, cov: 90 }, { lo: 3400, hi: 4200, cov: 85 }], ALL), ranges)
  check('多层分离且按 base 升序', multi.length === 2 && multi[0].base < multi[1].base, JSON.stringify(multi.map(l => [l.base, l.top])))
  /* 注意别用 /i：`displayWindowScanRange` 里的 "Window" 会被 /WIND/i 撞上，
     那是一条永远红在错误地方的假门。这里要查的是阈值常量名，大小写敏感。 */
  check('本模块不导出任何机会阈值（净空/层厚/持续小时都不属于 L1）',
    !Object.keys(CLF).some(k => /CLEAR|THICKNESS|MIN_RUN|GAP|TOLERANCE/.test(k)), Object.keys(CLF).join(','))
}

/* ---------- 4. topmostBelow：点下方最高层 ---------- */
section('4 候选层选择：clearance 不取整，遮挡缺陷被显式钉住')
{
  const layers = [
    { base: 2000, top: 2600, thickness: 600, meanCover: 90 },
    { base: 3000, top: 3600, thickness: 600, meanCover: 90 },
  ]
  const p = CLF.topmostBelow(layers, 3700)
  check('点下方有两层时取更高的那层，clearance 是未取整的原始差值',
    p.layer.top === 3600 && p.clearance === 100, JSON.stringify(p))
  const keepRaw = CLF.topmostBelow([{ base: 1, top: 3000.4, meanCover: 90, thickness: 100 }], 3200)
  check('clearance 必须保留小数：199.6 四舍五入成 200 会把"不够净空"变成"够"',
    Math.abs(keepRaw.clearance - 199.6) < 1e-6 && keepRaw.clearance !== 200 && Math.round(keepRaw.clearance) === 200,
    String(keepRaw.clearance))
  check('点下方没有层 ⇒ null（不是 clearance 为负的层）',
    CLF.topmostBelow([{ base: 4000, top: 4500, meanCover: 90 }], 3700) === null)
  check('无高程/非数值 ⇒ null，不拿 NaN 去比大小',
    CLF.topmostBelow(layers, NaN) === null && CLF.topmostBelow(null, 3700) === null)
  /* ⚠ 特征化断言（characterization），不是期望行为。
     现状：按 base 升序取最后一层 ⇒ 一层恰好结束在点下方的薄皮会**屏蔽**下方厚层。
     场景取自 qa/v2-q56-noise-audit-2026-10-10/README.md §2.4（峨眉山 10-10 09:00）。
     修它会改变候选集合，任务书禁止本轮改候选集合 ⇒ 这里把"今天确实会屏蔽"钉住，
     等 R1/G2 决策后这条应当被**替换**（不是删除），并配一条"厚层被选中"的正向断言。 */
  const ALT_POINT = 3004
  const sliverField = fieldOf([{ lo: 1739, hi: 2299, cov: 88 }, { lo: 2995, hi: 3400, cov: 90 }], { lo: 0, hi: 7000 })
  const clampedTo = CLF.layersAt(sliverField, 3, { scan: { lo: 504, hi: ALT_POINT, source: 'relative-to-point' } }, { coverMin: 80, step: 50 })
  const restored = CLF.layersAt(sliverField, 3, { scan: { lo: 504, hi: 6000, source: 'relative-to-point' } }, { coverMin: 80, step: 50 })
  const shadowedBySliver = CLF.topmostBelow(clampedTo, ALT_POINT)
  check('【特征化·已知缺陷】扫描上界夹到查询点海拔会造出一层薄皮，它屏蔽下方厚层',
    clampedTo.length === 2 && clampedTo[1].top === ALT_POINT && clampedTo[1].topBoundary === true &&
      clampedTo[1].thickness < 50 && shadowedBySliver.layer === clampedTo[1] && shadowedBySliver.clearance === 0,
    JSON.stringify(clampedTo))
  check('缺陷在数据里看得见：那层自己标着 topBoundary / scan-ceiling，调用方无从假装它是云界',
    clampedTo[1].topSource === 'scan-ceiling' && clampedTo[0].topSource === 'measured')
  check('同一份数据把上界放回点海拔之上：薄皮消失，厚层被正常选中 ⇒ 缺陷完全由"上界夹点"触发',
    restored.length === 2 && restored[1].top > ALT_POINT && restored[1].topBoundary === false &&
      CLF.topmostBelow(restored, ALT_POINT).layer === restored[0] &&
      CLF.topmostBelow(restored, ALT_POINT).layer.thickness > 300,
    JSON.stringify(restored))
}

/* ---------- 5. 端到端：范围契约换到 OI 里仍然等价 ---------- */
section('5 OI 集成：扫描范围经 meta 可见，且与显示窗无关')
{
  const TIMES = []
  for (let h = 0; h < 24; h++) TIMES.push('2026-10-07T' + (h < 10 ? '0' : '') + h + ':00')
  function ctxOf (decks, covered, alt) {
    const sample = fieldOf(decks, covered)
    const detail = TIMES.map((t, h) => ({
      d: t.slice(0, 10), t: t.slice(11, 16), temp: 12, code: 0, pop: 0, precip: 0, showers: 0,
      wind: 4, gust: 6, windDir: 90, rh: 40, visibility: 35,
      cloud: (h >= 5 && h < 10) ? { low: 95, mid: 20, high: 20 } : { low: 5, mid: 5, high: 5 },
      band: null,
    }))
    return {
      date: '2026-10-07', lat: 29.52, lng: 103.34, detail: detail, userAltitude: alt, elevOK: true,
      elevBasis: 'measured', days: [],
      cloudField: {
        times: TIMES.map((_, i) => i), altitudes: ALTS, covered: covered,
        values: TIMES.map(() => ALTS.map(a => {
          if (a < covered.lo || a > covered.hi) return 0
          let v = 0
          decks.forEach(d => { if (a >= d.lo && a <= d.hi) v = Math.max(v, d.cov) })
          return v
        })),
        sample: sample, userAltitude: alt,
      },
    }
  }
  const sea = OI.buildOutdoorIntelligence(ctxOf([{ lo: 2200, hi: 3000, cov: 92 }], { lo: 0, hi: 7000 }, 4200))
  const cs = sea.meta.cloudSea
  check('meta.cloudSea 现在带着扫描范围契约（R1 换带时这里就是验收点）',
    !!cs && !!cs.scanRanges && cs.scanRanges.scan.lo === CFF.ALT0 && cs.scanRanges.scan.hi === CFF.ALT1,
    JSON.stringify(cs && cs.scanRanges && cs.scanRanges.scan))
  check('实测覆盖经 cloudField.covered 传进来，在契约里看得见（不是又造一个数）',
    cs.scanRanges.data && cs.scanRanges.data.lo === 0 && cs.scanRanges.data.hi === 7000,
    JSON.stringify(cs.scanRanges.data))
  check('candidates / rejected / notEvaluated 三本账齐全且逐时互斥',
    [cs.candidates, cs.rejected, cs.notEvaluated].every(Array.isArray) &&
      cs.candidates.length + cs.rejected.length + cs.notEvaluated.length === sea.conditions.length,
    [cs.candidates.length, cs.rejected.length, cs.notEvaluated.length, sea.conditions.length].join('/'))
  const noAlt = OI.buildOutdoorIntelligence(Object.assign(ctxOf([{ lo: 2200, hi: 3000, cov: 92 }], { lo: 0, hi: 7000 }, 4200),
    { elevBasis: 'none', userAltitude: null, elevOK: false }))
  const csNoAlt = noAlt.meta.cloudSea
  check('无高程 ⇒ 全部小时落进 notEvaluated 且原因是有名字的 abstain，没有一条被当成晴空或机会',
    csNoAlt.notEvaluated.length === 24 && csNoAlt.candidates.length === 0 &&
      csNoAlt.notEvaluated.every(x => x.abstain === 'no-altitude') &&
      (noAlt.opportunities || []).every(o => o.type !== 'CLOUD_SEA'),
    JSON.stringify(csNoAlt.notEvaluated.slice(0, 1)))
  const outside = OI.buildOutdoorIntelligence(ctxOf([{ lo: 2200, hi: 3000, cov: 92 }], { lo: 3500, hi: 7000 }, 4200))
  check('扫描范围超出实测覆盖时，契约里留下"那段是填充 0 不等于无云"的告警（判定本身不动）',
    outside.meta.cloudSea.scanRanges.notes.some(n => /填充值 0/.test(n)),
    JSON.stringify(outside.meta.cloudSea.scanRanges.notes))
  /* 接缝必须是活的：只留一个"缺省值正确"的接口，等于没留接口。
     用一份**云底其实在 1,200 m** 的数据：默认扫描带下沿 2,000 会把它切一刀，
     注入一个更低的下沿之后截断消失 —— 证明"边界"是范围给的，不是云给的。 */
  const cutDeck = [{ lo: 1200, hi: 3000, cov: 92 }]
  const cov = { lo: 0, hi: 7000 }
  const factsOf = oi => ((oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')[0] || {}).evidence || []
  const dflt = OI.buildOutdoorIntelligence(ctxOf(cutDeck, cov, 4200))
  const dfltFacts = factsOf(dflt).map(e => String(e.fact))
  check('缺省扫描范围（= 显示窗）下，云底被下沿切到 ⇒ 证据如实报 2,000 是窗边界而不是云底',
    dflt.meta.cloudSea.scanRanges.scan.lo === CFF.ALT0 &&
      dfltFacts.some(f => f.indexOf('云底低于剖面扫描窗下界 2,000 m（未测得）') === 0),
    JSON.stringify(dfltFacts))
  const injected = OI.buildOutdoorIntelligence(Object.assign(ctxOf(cutDeck, cov, 4200),
    { cloudSeaScan: { scanRange: { lo: 1100, hi: 6000, source: 'relative-to-point' } } }))
  const injFacts = factsOf(injected).map(e => String(e.fact))
  check('只把扫描下沿从 2,000 降到 1,100 ⇒ 同一份数据的截断消失，证据改口为实测云底',
    injected.meta.cloudSea.scanRanges.scan.lo === 1100 &&
      injected.meta.cloudSea.scanRanges.scan.source === 'relative-to-point' &&
      injFacts.some(f => /^云层位于 /.test(f)) &&
      !injFacts.some(f => /未测得|剖面扫描窗/.test(f)),
    JSON.stringify(injFacts))
  const hardcodeProbe = factsOf(OI.buildOutdoorIntelligence(Object.assign(ctxOf([{ lo: 1200, hi: 6500, cov: 92 }], cov, 6900),
    { cloudSeaScan: { scanRange: { lo: 2100, hi: 2950, source: 'relative-to-point' } } }))).map(e => String(e.fact))
  check('证据句里的窗边界来自实际扫描范围，没有一处把 2,000/6,000 硬编码回去',
    hardcodeProbe.some(x => /2,100/.test(x) && /2,950/.test(x)) && !hardcodeProbe.some(x => /6,000/.test(x)),
    JSON.stringify(hardcodeProbe))
}

/* ---------- 6. 静态边界：谁依赖谁 ---------- */
section('6 分层依赖：L1 不反依赖 L3，机会层不碰显示窗')
{
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const l1 = strip(fs.readFileSync(path.join(ROOT, 'miniprogram/utils/cloud-layer-facts.js'), 'utf8'))
  check('L1 云层事实不 require 机会层（不反向依赖）',
    !/outdoor-intelligence|conditions\.js|agenda/.test(l1))
  check('L1 只依赖云场采样器（显示层的几何工具），不引入新依赖',
    (l1.match(/require\(([^)]*)\)/g) || []).every(r => /cloud-field-svg/.test(r)),
    (l1.match(/require\(([^)]*)\)/g) || []).join(' '))
  check('L1 里没有净空/层厚/持续小时这些机会阈值字面量',
    !/CLEARANCE|THICKNESS_MIN|MIN_RUN_H|GAP_TOLERANCE/.test(l1))
  check('仓库零 npm 依赖这条没被破坏（新模块只用 CommonJS + 相对 require）',
    !/require\(['"][a-z@]/i.test(l1))
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
