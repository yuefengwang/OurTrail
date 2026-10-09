/* Outdoor Intelligence Layer —— Weather Facts → Conditions → Opportunities → Evidence
 *
 * ── 定位（Weather V2 Phase：Outdoor Intelligence Phase 1）──────────────────
 * Meteogram 回答 "What is the weather?"，本层回答 "So what?"。
 * 本模块是**解释层**：不持任何天相阈值（全部复用 sky.hourMarks 的单源判定与
 * Phase 1 云场 inferState 的 60/68/70/40 阈值），只做：逐时条件态归类、
 * 连续段聚类成窗口（Window）、证据结构化（Evidence）、置信分级（不伪造概率）、
 * 优先级（Rank，非 Score）、沉默原则（证据不足 → 不产出）。
 *
 * ── 三级体系 ────────────────────────────────────────────────────────────────
 * L1 Weather Facts     温度/降水/云量剖面/风/能见度/日出日落/月照/太阳高度角（外部传入）
 * L2 Outdoor Condition 逐时环境状态：IN_CLOUD / CLOUD_BELOW / CLOUD_ABOVE / CLEAR
 * L3 Opportunity       统一 Window 模型的户外机会（云海/入云/远眺/黄金光/蓝调/银河/星空/彩虹/光染）
 *
 * ── 与既有代码的关系（审计结论，勿重复实现）────────────────────────────────
 * sky.hourMarks      单源阈值（cloudSea/inCloud/golden/blueHour/rainbow/star/galaxy/
 *                    alpenglow 的逐时判定）——本层只聚类与解释，不改阈值；
 * agenda.clustersOf  连续同相小时聚簇 + 云海×民用晨昏可见性交集——本层复用；
 * conditions.factsFor结构化证据（cloudSea/alpenglow/rainbow/galaxy/star）——本层复用；
 * astro.photoWindows 黄金/蓝调分钟级窗口（确定性天文）——本层直接作为 Window。
 *
 * wx-free：不得出现任何 wx.*（utils/AGENTS.md 铁律）。
 */
'use strict'

const sky = require('./sky')
const agenda = require('./agenda')
const CFF = require('./cloud-field-svg.js')
const FMT = require('./format.js')

const OPPORTUNITY = {
  CLOUD_SEA: '云海窗口',
  IN_CLOUD: '入云时段',
  CLOUD_BELOW: '云在脚下',
  VIEW_WINDOW: '远眺窗口',
  GOLDEN_LIGHT: '黄金光',
  BLUE_HOUR: '蓝调时刻',
  ALPENGLOW: '晨昏光染',
  RAINBOW: '彩虹可能',
  STARGAZING: '星空条件',
  MILKY_WAY: '银河窗口',
}

/* Rank：静态基础优先级（稀有性 × 户外价值），不伪装成科学评分 */
const BASE_RANK = {
  CLOUD_SEA: 'primary',
  ALPENGLOW: 'primary',
  MILKY_WAY: 'primary',
  GOLDEN_LIGHT: 'secondary',
  BLUE_HOUR: 'secondary',
  STARGAZING: 'secondary',
  RAINBOW: 'secondary',
  IN_CLOUD: 'secondary',
  VIEW_WINDOW: 'secondary',
}

const CONDITION = {
  IN_CLOUD: 'IN_CLOUD',
  CLOUD_BELOW: 'CLOUD_BELOW',
  CLOUD_ABOVE: 'CLOUD_ABOVE',
  CLEAR: 'CLEAR',
}

/* ---------- Cloud Sea 检测阈值（集中定义；依据见 cloud-sea.md §阈值） ---------- */

const CLOUD_SEA = {
  LAYER_COVER_MIN: 80,       // 层内逐高度云量门槛（继承生产 cloudBandAt ≥80% 规则）
  LAYER_THICKNESS_MIN: 300,  // 层厚下限 m（真实分布 P50=300m；50% 的真实 ≥80% 层达到）
  CLEARANCE_MIN: 200,        // 用户高出云顶的最小净空 m（与 Phase 1 ±200m 邻域语义一致）
  GAP_TOLERANCE_H: 1,        // 窗口合并允许的缺口（小时）
  MIN_RUN_H: 2,              // 窗口最少持续小时（时间连续性）
  WIND_CALM: 15,             // 风 >此值计入强度削弱因子（km/h；产品既有语义）
  SCAN_STEP_M: 50,           // 剖面扫描步长（m）
}

function fmtM(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function pad2(n) { return (n < 10 ? '0' : '') + n }

/* ---------- 层提取（Cloud Field → cloud layers） ---------- */

/**
 * 对某时刻 t 沿海拔扫描，提取 ≥LAYER_COVER_MIN 的连续云层（不做厚度过滤——
 * 厚度阈值是 Cloud Sea 检测器的判定条件，拒绝原因需要它）。
 * 层边界在采样点间线性插值（子步长精度）。
 * @returns [{ base, top, thickness, meanCover, peakCover }]（按 base 升序）
 */
function cloudLayersAt(sample, t, opts) {
  const o = Object.assign({}, CLOUD_SEA, opts || {})
  const step = o.SCAN_STEP_M
  const pts = []
  for (let alt = CFF.ALT0; alt <= CFF.ALT1; alt += step) {
    pts.push({ alt: alt, cover: sample(t, Math.min(alt, CFF.ALT1)) })
  }
  const layers = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= o.LAYER_COVER_MIN
    const prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      /* 进入点：与上一采样点线性插值（上一格已在层内则直接取该点） */
      const base = prev && prev.cover < o.LAYER_COVER_MIN
        ? prev.alt + (o.LAYER_COVER_MIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt)
        : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover] }
    } else if (on && run) {
      run.top = pts[i].alt
      run.covers.push(pts[i].cover)
    } else if (!on && run) {
      /* 退出点：插值到阈值（云在边缘变薄消失） */
      run.top = prev.cover > o.LAYER_COVER_MIN
        ? prev.alt + (o.LAYER_COVER_MIN - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt)
        : prev.alt
      layers.push(run)
      run = null
    }
  }
  if (run) { run.top = CFF.ALT1; layers.push(run) }
  return layers
    .map(function (l) {
      return {
        base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
        meanCover: Math.round(l.covers.reduce(function (a, b) { return a + b }, 0) / l.covers.length),
        peakCover: Math.round(Math.max.apply(null, l.covers)),
      }
    })
    .sort(function (a, b) { return a.base - b.base })
}

/* ---------- L2：逐时 Outdoor Condition ---------- */

/**
 * 逐时条件态。云场可用时以 Phase 1 inferState（60/68/70/40，覆盖感知）为源；
 * 否则退回 hour-view band + sky 标记（inCloud/cloudSea）做有限推断。
 * 沉默原则：证据不足的小时条件为 null（不强行归类）。
 * @returns [{ t, key|null, source: 'cloud-field'|'hour-view', evidence:[{fact, at?}] }]
 */
function buildConditions(ctx) {
  const detail = ctx.detail || []
  const out = []
  const cloud = ctx.cloudField || null
  for (const h of detail) {
    const hourIdx = sky.hourMin(h.t) / 60   // 'HH:mm' → 小时（浮点，场采样是连续的）
    if (cloud && cloud.sample) {
      const st = CFF.inferState(cloud.sample, hourIdx, ctx.userAltitude, cloud.covered)
      const key = st.key === 'in' ? CONDITION.IN_CLOUD
        : st.key === 'ok' ? CONDITION.CLOUD_BELOW
        : st.key === 'mid' ? CONDITION.CLOUD_ABOVE
        : (st.key === null && isClearHour(st, cloud.sample, hourIdx) ? CONDITION.CLEAR : null)
      out.push({
        t: h.t,
        key: key,
        source: 'cloud-field',
        evidence: conditionEvidence(key, st, h, ctx),
      })
      continue
    }
    /* 无云场：hour-view band 的有限推断（band 来自生产气压层，事实可靠） */
    const marks = ctx.marks || {}
    const list = marks[h.d + 'T' + h.t] || (ctx.marksByHour ? ctx.marksByHour[h.t] : null) || []
    let key = null
    const evidence = []
    if (list.indexOf('inCloud') !== -1 && h.band && Number.isFinite(h.band.base)
      && h.band.base <= ctx.userAltitude && ctx.userAltitude <= h.band.top) {
      key = CONDITION.IN_CLOUD
      evidence.push({ fact: '此点处于云带 ' + Math.round(h.band.base) + '–' + Math.round(h.band.top) + ' m（覆盖 ' + h.band.cover + '%）', at: h.t })
    } else if (list.indexOf('cloudSea') !== -1) {
      key = CONDITION.CLOUD_BELOW
      evidence.push({ fact: '低云带在' + FMT.ELEV_SUBJECT + '下方（覆盖 ≥80%）', at: h.t })
    }
    out.push({ t: h.t, key: key, source: 'hour-view', evidence: evidence })
  }
  return out
}

/* CLEAR：用户处、上方、下方都没有有意义的云量（沉默原则的另一面：明确说晴） */
function isClearHour(st, sample, hours) {
  if (st.span) return false
  if (st.cUser != null && st.cUser >= 15) return false
  const peak = peakCover(sample, hours)
  return peak < 15
}

function peakCover(sample, hours) {
  /* 扫**实测网格**（0–7000m）而不是剖面显示窗（2000–6000m）：
     判「这一小时是不是晴空」要看完用户处与其上下全部有测量的高度，
     显示窗只是这张图画了哪一段。适配器已保证实测范围之外为 0（不外插），
     所以这里不会因此把「无数据」读成「有云」。 */
  let peak = 0
  for (let alt = 0; alt <= 7000; alt += 250) {
    peak = Math.max(peak, sample(hours, alt))
  }
  return peak
}

/* 条件态证据（L2 自身可解释） */
function conditionEvidence(key, st, h, ctx) {
  const out = []
  if (key === CONDITION.IN_CLOUD && st.span) {
    out.push({ fact: '云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m（峰值 ' + st.span.peak + '%）穿过' + FMT.ELEV_SUBJECT + '海拔 ' + fmtM(ctx.userAltitude) + ' m', at: h.t })
  } else if (key === CONDITION.CLOUD_BELOW && st.span) {
    out.push({ fact: '云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m 在' + FMT.ELEV_SUBJECT + '海拔 ' + fmtM(ctx.userAltitude) + ' m 下方', at: h.t })
  } else if (key === CONDITION.CLOUD_ABOVE && st.span) {
    out.push({ fact: '云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m 在' + FMT.ELEV_SUBJECT + '海拔 ' + fmtM(ctx.userAltitude) + ' m 上方', at: h.t })
  } else if (key === CONDITION.CLEAR) {
    out.push({ fact: '此海拔与上下邻域云量均 <15%', at: h.t })
  }
  return out
}

/* ---------- Cloud Sea Detector（L3：Cloud Field → layers → candidates → window） ---------- */

/* 强度因子阈值（集中定义；依据见 cloud-sea.md §阈值与强度） */
const CLOUD_SEA_STRENGTH = {
  cover: 90,        // 层均覆盖 %（STRONG 因子）
  thickness: 600,   // 层厚 m
  clearance: 500,   // 用户高出云顶 m
  durationH: 3,     // 窗口持续小时
}

/**
 * 逐时 Cloud Sea 候选检测：云场层提取 → 用户净空/覆盖/厚度校验。
 * CLOUD_BELOW 是必要条件之一，不是云海本身——这里做进一步验证。
 * @returns { candidates, rejected }（rejected 为负证据，模型内部保留，UI 不展示）
 */
function detectCloudSeaCandidates(conditions, fieldSample, userAlt, opts) {
  const o = Object.assign({}, CLOUD_SEA, opts || {})
  const candidates = []
  const rejected = []
  conditions.forEach(function (c) {
    if (c.key !== CONDITION.CLOUD_BELOW) return
    const hour = sky.hourMin(c.t) / 60
    const allLayers = cloudLayersAt(fieldSample, hour, o)
    const below = allLayers.filter(function (l) { return l.top <= userAlt })
    if (!below.length) {
      rejected.push({ t: c.t, reason: 'NO_LAYER_BELOW', detail: '用户下方无 ≥' + o.LAYER_COVER_MIN + '% 连续层' })
      return
    }
    const L = below[below.length - 1] // 离用户最近的合格层
    const clearance = userAlt - L.top
    if (clearance < o.CLEARANCE_MIN) {
      rejected.push({ t: c.t, reason: clearance < 0 ? 'USER_INSIDE_CLOUD' : 'USER_NOT_ABOVE_CLOUD', detail: '净空 ' + Math.round(clearance) + ' m < ' + o.CLEARANCE_MIN + ' m' })
      return
    }
    if (L.meanCover < o.LAYER_COVER_MIN) {
      rejected.push({ t: c.t, reason: 'LOW_COVERAGE', detail: '层均覆盖 ' + L.meanCover + '%' })
      return
    }
    if (L.thickness < o.LAYER_THICKNESS_MIN) {
      rejected.push({ t: c.t, reason: 'INSUFFICIENT_THICKNESS', detail: '层厚 ' + L.thickness + ' m < ' + o.LAYER_THICKNESS_MIN + ' m' })
      return
    }
    candidates.push({
      t: c.t, hour: hour,
      layer: L, clearance: Math.round(clearance),
      wind: o.windAt ? o.windAt(hour) : 0,
    })
  })
  return { candidates: candidates, rejected: rejected }
}

/**
 * 候选 → 窗口：时间合并（缺口容忍）→ civil 可见性交集 → 强度 → 证据。
 * @returns { windows, candidates, rejected }
 */
function detectCloudSea(conditions, fieldSample, userAlt, opts) {
  opts = opts || {}
  const o = Object.assign({}, CLOUD_SEA, opts)
  const det = detectCloudSeaCandidates(conditions, fieldSample, userAlt, o)
  const windows = []
  const rejected = det.rejected.slice()
  let run = null
  function flush() {
    if (!run) return
    if (run.len < o.MIN_RUN_H) {
      /* 时间连续性不足（§十.D）——负证据保留在模型内部 */
      rejected.push({ from: run.from, to: run.to, reason: 'LOW_PERSISTENCE', detail: '持续 ' + run.len + 'h < ' + o.MIN_RUN_H + 'h' })
      run = null
      return
    }
    let from = pad2(Math.floor(run.from)) + ':' + pad2(Math.round((run.from % 1) * 60))
    let to = pad2(Math.floor(run.to)) + ':' + pad2(Math.round((run.to % 1) * 60))
    const coverPeak = Math.max.apply(null, run.candidates.map(function (c) { return c.layer.meanCover }))
    const thickMax = Math.max.apply(null, run.candidates.map(function (c) { return c.layer.thickness }))
    const clearMin = Math.min.apply(null, run.candidates.map(function (c) { return c.clearance }))
    const windPeak = Math.max.apply(null, run.candidates.map(function (c) { return c.wind || 0 }))
    let factors = 0
    if (coverPeak >= CLOUD_SEA_STRENGTH.cover) factors++
    if (thickMax >= CLOUD_SEA_STRENGTH.thickness) factors++
    if (clearMin >= CLOUD_SEA_STRENGTH.clearance) factors++
    if (run.len >= CLOUD_SEA_STRENGTH.durationH) factors++
    let strength = factors >= 3 ? 'STRONG' : factors === 2 ? 'MODERATE' : 'WEAK'
    /* 风削弱：只降一级（连续降两级会把 STRONG 直接打到 WEAK，惩罚过度） */
    if (windPeak > o.WIND_CALM && strength === 'STRONG') strength = 'MODERATE'
    /* 民用晨昏可见性交集（与 agenda 同规则）；不可见 → 整窗沉默 */
    const civil = agenda.civilWindow(opts.sun)
    const vis = civil.ok ? agenda.visibleSeaWindow(from, to, civil) : { from: from, to: to }
    if (!vis) {
      rejected.push({ from: from, to: to, reason: 'NOT_VISIBLE', detail: '民用晨昏之外不可见' })
      run = null
      return
    }
    from = vis.fromT; to = vis.toT
    /* 日出 enrichment（§十一：非检测条件，价值增强） */
    let overlapsSunrise = false
    if (opts.sunriseMin != null) {
      overlapsSunrise = sky.hourMin(from) <= opts.sunriseMin && opts.sunriseMin <= sky.hourMin(to)
    }
    const evidence = []
    evidence.push({ fact: '云层位于 ' + fmtM(run.baseMin) + '–' + fmtM(run.topMax) + ' m', at: from })
    evidence.push({ fact: FMT.ELEV_SUBJECT + '高于云层底部约 ' + fmtM(clearMin) + ' m', at: from })
    evidence.push({ fact: '层均覆盖 ' + coverPeak + '% · 层厚最大 ' + thickMax + ' m', at: from })
    evidence.push({ fact: '预计持续约 ' + run.len + ' 小时', at: from })
    if (windPeak > 0) evidence.push({ fact: '风速 ≤ ' + windPeak + ' km/h', at: from })
    if (overlapsSunrise) evidence.push({ fact: '窗口与日出重叠（日出云海）', at: from })
    windows.push({
      type: 'CLOUD_SEA',
      interpretation: OPPORTUNITY.CLOUD_SEA,
      from: from, to: to,
      confidence: confidenceOf(coverPeak, 90),
      rank: BASE_RANK.CLOUD_SEA,
      strength: strength,
      layers: run.candidates.map(function (c) { return { t: c.t, base: c.layer.base, top: c.layer.top, cover: c.layer.meanCover, clearance: c.clearance } }),
      overlapsSunrise: overlapsSunrise,
      evidence: evidence,
      source: 'cloud-field',
    })
    run = null
  }
  det.candidates.forEach(function (c) {
    const m = sky.hourMin(c.t) / 60
    if (run && m - run.to <= o.GAP_TOLERANCE_H + 1) {
      /* 缺口容忍：GAP_TOLERANCE_H=1 表示可容忍 1 个缺失小时（相邻距离 2h） */
      run.to = m; run.len = Math.round(run.to - run.from) + 1
      run.candidates.push(c)
      run.baseMin = Math.min(run.baseMin, c.layer.base)
      run.topMax = Math.max(run.topMax, c.layer.top)
    } else {
      flush()
      run = { from: m, to: m, len: 1, candidates: [c], baseMin: c.layer.base, topMax: c.layer.top }
    }
  })
  flush()
  return { windows: windows, candidates: det.candidates, rejected: rejected }
}

/**
 * 由条件态 + hourMarks 簇 + 天文窗口构建统一 Opportunity 列表。
 * 每个窗口：{ type, from, to, confidence, rank, evidence[], interpretation, source }
 *   confidence：天文 = '明确'；天气相关 = '高' | '中'（不伪造概率）
 *   rank：primary（稀有×高价值）/ secondary
 *   沉默原则：无簇/无证据 → 不产出；VIEW_WINDOW 与 CLOUD_SEA 重叠时让位。
 */
function buildOpportunities(ctx, conditions) {
  const out = []
  const detail = ctx.detail || []
  const civil = agenda.civilWindow(ctx.sun)

  /* 1) hourMarks 簇 → 天相窗口（cloudSea/golden/blueHour/star/galaxy/rainbow/alpenglow） */
  agenda.clustersOf(detail, ctx.marks || {}).forEach(function (c) {
    const type = markType(c.key)
    if (!type) return
    let from = c.from, to = c.to
    let extra = {}
    if (type === 'CLOUD_SEA') {
      const vis = agenda.visibleSeaWindow(c.from, c.to, civil)
      if (!vis) return // 民用晨昏外不可见 → 沉默
      from = vis.fromT; to = vis.toT
    }
    if (type === 'GOLDEN_LIGHT' || type === 'BLUE_HOUR') {
      /* 天文窗口分钟级精确：从 photoWindows 找重叠段 */
      const win = astroWindowFor(c.key, ctx.win, sky.hourMin(c.from))
      if (win) { from = win.from; to = win.to }
      extra.confidence = '明确'
    }
    const hours = detailHours(detail, from, to)
    const ev = (ctx.factsFor && ctx.factsFor(c.key)) || []
    out.push(makeWindow(type, from, to, ev, extra, hours, ctx))
  })

  /* 2) 条件态连续段 → IN_CLOUD / VIEW_WINDOW / CLOUD_BELOW 窗口 */
  const runs = conditionRuns(conditions)
  runs.forEach(function (run) {
    if (run.key === CONDITION.IN_CLOUD && run.len >= 2) {
      const hours = detailHours(detail, run.from, run.to)
      const ev = run.evidence.slice()
      if (ctx.cloudField && ctx.cloudField.covered) {
        ev.push({ fact: '云场覆盖 ' + fmtM(ctx.cloudField.covered.lo) + '–' + fmtM(ctx.cloudField.covered.hi) + ' m（23 层气压层）', at: run.from })
      }
      out.push(makeWindow('IN_CLOUD', run.from, run.to, ev, { confidence: confidenceOf(run.peak, 80) }, hours, ctx))
    }
    if (run.key === CONDITION.CLOUD_BELOW && run.len >= 2 && daytime(run, civil)) {
      /* 与 CLOUD_SEA 重叠时让位（更具体的窗口优先） */
      if (overlapsType(out, 'CLOUD_SEA', run)) return
      out.push(makeWindow('VIEW_WINDOW', run.from, run.to, run.evidence.slice(), {
        confidence: '中', note: '站在云层上方，向低处与远处视野开阔',
      }, detailHours(detail, run.from, run.to), ctx))
    }
    if (run.key === CONDITION.CLEAR && run.len >= 3 && daytime(run, civil)) {
      const vis = meanOf(detailHours(detail, run.from, run.to), h2 => h2.visibility)
      const high = meanOf(detailHours(detail, run.from, run.to), h2 => h2.cloud && h2.cloud.high)
      const conf = (high != null && high < 20 && (vis == null || vis >= 30)) ? '高' : '中'
      const ev = []
      if (high != null) ev.push({ fact: '高层云 ' + high + '%（远眺被挡概率低）', at: run.from })
      if (vis != null) ev.push({ fact: '能见度 ' + vis + ' km', at: run.from })
      out.push(makeWindow('VIEW_WINDOW', run.from, run.to, ev, { confidence: conf }, detailHours(detail, run.from, run.to), ctx))
    }
  })

  return out.sort(function (a, b) { return sky.hourMin(a.from) - sky.hourMin(b.from) })
}

function markType(key) {
  switch (key) {
    case 'cloudSea': return 'CLOUD_SEA'
    case 'golden': return 'GOLDEN_LIGHT'
    case 'blueHour': return 'BLUE_HOUR'
    case 'star': return 'STARGAZING'
    case 'galaxy': return 'MILKY_WAY'
    case 'rainbow': return 'RAINBOW'
    case 'alpenglow': return 'ALPENGLOW'
    default: return null
  }
}

function astroWindowFor(markKey, win, hourMin) {
  if (!win) return null
  const cands = markKey === 'golden'
    ? [win.morningGolden, win.eveningGolden]
    : [win.dawnBlue, win.duskBlue]
  for (const w2 of cands) {
    if (!w2) continue
    const f = sky.hourMin(w2.from), t2 = sky.hourMin(w2.to)
    if (hourMin >= f && hourMin <= t2 + 60) return { from: w2.from, to: w2.to }
  }
  return null
}

function overlapsType(out, type, run) {
  return out.some(function (w2) {
    return w2.type === type && !(sky.hourMin(w2.to) + 60 <= sky.hourMin(run.from) || sky.hourMin(run.to) + 60 <= sky.hourMin(w2.from))
  })
}

function daytime(run, civil) {
  if (!civil || !civil.ok) return true
  return sky.hourMin(run.from) >= civil.from && sky.hourMin(run.to) + 60 <= civil.to
}

function confidenceOf(peak, highAt) {
  return peak >= highAt ? '高' : '中'
}

function conditionRuns(conditions) {
  const runs = []
  let cur = null
  conditions.forEach(function (c) {
    if (c.key && cur && cur.key === c.key && sky.hourMin(c.t) === sky.hourMin(cur.to) + 60) {
      cur.to = c.t
      cur.len += 1
    } else if (c.key) {
      if (cur) runs.push(cur)
      cur = { key: c.key, from: c.t, to: c.t, len: 1, evidence: c.evidence || [], peak: 0 }
    } else if (cur) { runs.push(cur); cur = null }
  })
  if (cur) runs.push(cur)
  return runs
}

function detailHours(detail, from, to) {
  const f = sky.hourMin(from), t2 = sky.hourMin(to) + 60
  return detail.filter(function (h) {
    const m = sky.hourMin(h.t)
    return m >= f && m < t2
  })
}

function meanOf(list, get) {
  const vals = list.map(get).filter(function (v) { return Number.isFinite(v) })
  if (!vals.length) return null
  return Math.round(vals.reduce(function (a, b) { return a + b }, 0) / vals.length)
}

function makeWindow(type, from, to, evidence, extra, hours, ctx) {
  return Object.assign({
    type: type,
    interpretation: OPPORTUNITY[type] || type,
    from: from,
    to: to,
    confidence: '中',
    rank: BASE_RANK[type] || 'secondary',
    evidence: evidence,
    hours: hours,
    source: ctx.cloudField ? 'cloud-field' : 'hour-view',
  }, extra || {})
}

/* ---------- 主入口 ---------- */

/**
 * 构建某一天、某一点（海拔）的 Outdoor Intelligence。
 * @param ctx {
 *   date, detail（当日 24h hourView）, userAltitude, elevOK?,
 *   lat, lng, heading?,
 *   cloudField?（Phase 1 适配器产出，含 covered；有则走云场条件）
 *   marks?（缺省由 sky.hourMarks 计算——单源阈值，不改）
 *   sun/win/moon/galaxySeason?（缺省由 astro 计算）
 *   factsFor?（缺省 conditions.factsFor）
 * }
 * @returns { conditions, opportunities, meta }
 */
function buildOutdoorIntelligence(ctx) {
  if (!ctx || !Array.isArray(ctx.detail) || !ctx.detail.length) {
    return { conditions: [], opportunities: [], meta: { silence: true } }
  }
  const full = Object.assign({}, ctx)
  /* 云场采样器：适配器产出是 {times, altitudes, values} 数据网格，
     这里包装成 sample(t, alt)（时间维 CR、海拔维线性）供条件态与证据采样。 */
  if (full.cloudField && !full.cloudField.sample) {
    const column = CFF.makeColumnSampler(full.cloudField)
    full.cloudField.sample = function (t, alt) {
      return CFF.sampleAtStations(column, full.cloudField.times.length, t, alt)
    }
  }
  if (!full.marks) {
    /* sky.hourMarks 返回 {'HH:mm': [key]}；页面级契约是 {'dateTHH:mm': [key]}
       （agenda.clustersOf / 本模块 fallback 都按后者查找）——这里做同样的 re-key */
    const raw = sky.hourMarks({
      date: ctx.date, lat: ctx.lat, lng: ctx.lng,
      elevation: ctx.userAltitude, elevOK: ctx.elevOK !== false,
      detail: ctx.detail,
    })
    full.marks = {}
    Object.keys(raw).forEach(function (t) {
      full.marks[ctx.date + 'T' + t] = raw[t]
    })
  }
  if (!full.sun && ctx.lat != null) full.sun = require('./astro.js').sunTimes(ctx.date, ctx.lat, ctx.lng, ctx.userAltitude)
  if (!full.win && ctx.lat != null) full.win = require('./astro.js').photoWindows(ctx.date, ctx.lat, ctx.lng, ctx.userAltitude)
  if (!full.moon && ctx.date) full.moon = require('./astro.js').moonInfo(ctx.date)
  if (!full.factsFor) full.factsFor = function (key) { return require('./conditions.js').factsFor(key, {
    date: ctx.date, detail: ctx.detail, days: ctx.days || [], elevation: ctx.userAltitude,
    sun: full.sun, moon: full.moon,
  }) }

  const conditions = buildConditions(full)
  let opportunities = buildOpportunities(full, conditions)

  /* Cloud Sea：云场检测器（field 存在时为主源——层提取/净空/层厚/强度证据更细；
     无 field 时保留 marks 路径的 CLOUD_SEA 窗口作为回退）。候选在数据集加载时
     一次性算完并缓存于结果对象；crosshair 点击只做 lookup，不重扫场。 */
  let cloudSeaDebug = null
  if (full.cloudField && full.cloudField.sample) {
    const windAt = function (hourF) {
      const h = full.detail[Math.max(0, Math.min(full.detail.length - 1, Math.floor(hourF)))]
      return h && Number.isFinite(h.wind) ? h.wind : 0
    }
    const sea = detectCloudSea(conditions, full.cloudField.sample, full.userAltitude, {
      sunriseMin: full.sun ? sky.hourMin(full.sun.sunrise) : null,
      sun: full.sun,
      windAt: windAt,
    })
    opportunities = opportunities
      .filter(function (w2) { return w2.type !== 'CLOUD_SEA' })
      .concat(sea.windows)
      .sort(function (a, b) { return sky.hourMin(a.from) - sky.hourMin(b.from) })
    cloudSeaDebug = { candidates: sea.candidates, rejected: sea.rejected }
  }

  return {
    conditions: conditions,
    opportunities: opportunities,
    meta: {
      sources: ctx.cloudField ? ['cloud-field', 'hour-marks', 'astro'] : ['hour-view', 'astro'],
      silence: opportunities.length === 0,
      cloudSea: cloudSeaDebug,   // 负证据（模型内部保留；生产 UI 不展示）
    },
  }
}

module.exports = {
  OPPORTUNITY: OPPORTUNITY,
  CONDITION: CONDITION,
  BASE_RANK: BASE_RANK,
  buildConditions: buildConditions,
  buildOpportunities: buildOpportunities,
  buildOutdoorIntelligence: buildOutdoorIntelligence,
}
