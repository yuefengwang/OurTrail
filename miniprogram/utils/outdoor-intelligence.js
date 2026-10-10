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
const CLF = require('./cloud-layer-facts.js')
const K = require('./evidence-kind.js').KIND
const FMT = require('./format.js')

/* 云层位置三态的标题一律从 format.CLOUD_POSITION_LABELS 取（2026-10-09 语义统一轮）。
 * 这里原来自己打了一份「入云时段 / 云在脚下」，与读数行 r3、图例各说各话——
 * 同一张卡上的同一状态出现两套中文，就是铁律 22 说的词汇漂移。 */
const OPPORTUNITY = {
  CLOUD_SEA: '云海窗口',
  IN_CLOUD: FMT.cloudPositionLabel('in'),
  CLOUD_BELOW: FMT.cloudPositionLabel('ok'),
  CLOUD_ABOVE: FMT.cloudPositionLabel('mid'),
  VIEW_WINDOW: '远眺窗口',
  GOLDEN_LIGHT: '黄金光',
  BLUE_HOUR: '蓝调时刻',
  ALPENGLOW: '晨昏光染',
  RAINBOW: '彩虹可能',
  STARGAZING: '星空条件',
  MILKY_WAY: '银河窗口',
}

/* 夜间天空类的边界声明：本项目只算了云量与月照（astro.moonInfo 是真天文量），
 * 光污染与地形遮挡没有可靠数据源，必须写出来，否则读者会以为已经纳入。 */
const NIGHT_LIMIT = '只看云量与月照：光污染与地形遮挡无数据源，未纳入判断'

/* Rank：静态基础优先级（稀有性 × 户外价值），不伪装成科学评分 */const BASE_RANK = {
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
  /* 「什么算一层云」是 L1 云层事实的定义，不在 L3 抄第二遍（切片二）：
     LAYER_COVER_MIN / SCAN_STEP_M 直接引用 `cloud-layer-facts` 的唯一出处，
     数值与改名前逐字相同（80 / 50），只是不再有第二个字面量。
     ⚠ 这个 80 与 provider 的成带判据 `CLOUD_BAND_COVER_MIN` **同为 80 但不同义**
     （前者扫连续剖面、多层、可插值；后者是离散气压层合并出的单条 band）。
     两处的理由与不可合并证据见 utils/cloud-layer-facts.js 文件头与切片二 ADR §3。 */
  /* getter 而不是快照：L3 每次组 opts 都从 L1 那张表读当前值，
     这样影子测试改 `CLF.LAYER_LIMITS` 时这里会一起动（改不动就说明还留了第二份字面量）。 */
  get LAYER_COVER_MIN () { return CLF.LAYER_LIMITS.FIELD_LAYER_COVER_MIN },
  get SCAN_STEP_M () { return CLF.LAYER_LIMITS.FIELD_LAYER_STEP_M },
  LAYER_THICKNESS_MIN: 300,  // 层厚下限 m（真实分布 P50=300m；50% 的真实 ≥80% 层达到）
  CLEARANCE_MIN: 200,        // 用户高出云顶的最小净空 m（与 Phase 1 ±200m 邻域语义一致）
  GAP_TOLERANCE_H: 1,        // 窗口合并允许的缺口（小时）
  MIN_RUN_H: 2,              // 窗口最少持续小时（时间连续性）
  WIND_CALM: 15,             // 风 >此值计入强度削弱因子（km/h；产品既有语义）
}

function fmtM(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function pad2(n) { return (n < 10 ? '0' : '') + n }

/* ---------- 层提取（Cloud Field → cloud layers） ---------- */

/**
 * 对某时刻 t 沿海拔扫描，提取 ≥LAYER_COVER_MIN 的连续云层（不做厚度过滤——
 * 厚度阈值是 Cloud Sea 检测器的判定条件，拒绝原因需要它）。
 * 层边界在采样点间线性插值（子步长精度）。
 *
 * 算法本体已搬到 `cloud-layer-facts.js`（L1→L2 边界），这里只剩一层薄封装：把本模块的
 * 阈值默认值传下去、保留旧签名。**扫描范围的来源现在看得见**——缺省仍是剖面显示窗
 * （`ALT0/ALT1`），但那件事由 L1 模块在返回值里如实标注，不再靠读代码行号考古。
 * @returns [{ base, top, thickness, meanCover, peakCover, baseBoundary, topBoundary, ... }]
 */
function cloudLayersAt(sample, t, opts) {
  const o = Object.assign({}, CLOUD_SEA, opts || {})
  return CLF.layersAt(sample, t, o.scanRanges || CLF.resolveRanges(o), {
    coverMin: o.LAYER_COVER_MIN, step: o.SCAN_STEP_M,
  })
}

/* ---------- L2：逐时 Outdoor Condition ---------- */

/**
 * 逐时条件态。云场可用时以 Phase 1 inferState（60/68/70/40，覆盖感知）为源；
 * 否则退回 hour-view band + sky 标记（inCloud/cloudSea）做有限推断。
 * 沉默原则：证据不足的小时条件为 null（不强行归类）。
 * @returns [{ t, key|null, source: 'cloud-field'|'hour-view', evidence:[{fact, at?, kind}] }]
 *   evidence 的 `kind` 是结构化类别（`utils/evidence-kind.js`），呈现层据此挑摘要。
 */
function buildConditions(ctx) {
  const detail = ctx.detail || []
  const out = []
  const cloud = ctx.cloudField || null
  for (const h of detail) {
    const hourIdx = sky.hourMin(h.t) / 60   // 'HH:mm' → 小时（浮点，场采样是连续的）
    if (cloud && cloud.sample) {
      const st = CFF.inferState(cloud.sample, hourIdx, ctx.userAltitude, cloud.covered, { basis: ctx.elevBasis })
      const holds = st.holds || []
      /* 条件态读 holds（哪几侧真的有浓云带），不读被压成单个位置的那个词：
         「上下都有云带」在读数行上不给单一结论，但脚下的云带依然是云海的必要条件。 */
      const key = holds.indexOf('in') !== -1 ? CONDITION.IN_CLOUD
        : holds.indexOf('ok') !== -1 ? CONDITION.CLOUD_BELOW
        : holds.indexOf('mid') !== -1 ? CONDITION.CLOUD_ABOVE
        /* 「晴空」只能由「判过了、两侧都没云」得出。没有可信海拔、没有实测层、
           误差带内判不出方向、上下都有浓云——这几类都不是晴空，必须留空（null）。
           旧实现只看 st.key===null 就往下问 isClearHour，把「无法判断」读成「晴」。 */
        : (st.reason === 'clear' && isClearHour(st, cloud.sample, hourIdx) ? CONDITION.CLEAR : null)
      out.push({
        t: h.t,
        key: key,
        reason: st.reason || null,
        holds: holds,
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
      evidence.push({ fact: '此点处于云带 ' + Math.round(h.band.base) + '–' + Math.round(h.band.top) + ' m（覆盖 ' + h.band.cover + '%）', at: h.t, kind: K.LAYER_POSITION })
    } else if (list.indexOf('cloudSea') !== -1) {
      key = CONDITION.CLOUD_BELOW
      /* 那句「≥80%」是 provider 成带规则的重述，不是第二个阈值：写的是同一个唯一出处 */
      evidence.push({ fact: '低云带在' + FMT.ELEV_SUBJECT + '下方（覆盖 ≥' + CLF.LAYER_LIMITS.CLOUD_BAND_COVER_MIN + '%）', at: h.t, kind: K.LAYER_POSITION })
    }
    /* 这一支没有云场（buildCloudField 返回 null 才会走到这里），
       所以「云与此点的位置关系」是判不了的——如实记 no-data，而不是留空让人猜。 */
    out.push({
      t: h.t, key: key, reason: key ? null : 'no-data',
      holds: key === CONDITION.IN_CLOUD ? ['in'] : key === CONDITION.CLOUD_BELOW ? ['ok'] : [],
      source: 'hour-view', evidence: evidence,
    })
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

/* 条件态证据（L2 自身可解释）。每条都带 `kind`（词表见 utils/evidence-kind.js）：
   「这一小时与云的位置关系」是 LAYER_POSITION，判不出是 ABSTAIN ——
   呈现层据此挑摘要，不再解析中文文案。 */
function conditionEvidence(key, st, h, ctx) {
  const out = []
  if (key === CONDITION.IN_CLOUD && st.span) {
    out.push({ fact: '云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m（峰值 ' + st.span.peak + '%）穿过' + FMT.ELEV_SUBJECT + '海拔 ' + fmtM(ctx.userAltitude) + ' m', at: h.t, kind: K.LAYER_POSITION })
  } else if (key === CONDITION.CLOUD_BELOW && st.span) {
    out.push({ fact: '云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m 在' + FMT.ELEV_SUBJECT + '海拔 ' + fmtM(ctx.userAltitude) + ' m 下方', at: h.t, kind: K.LAYER_POSITION })
  } else if (key === CONDITION.CLOUD_ABOVE && st.span) {
    out.push({ fact: '云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m 在' + FMT.ELEV_SUBJECT + '海拔 ' + fmtM(ctx.userAltitude) + ' m 上方', at: h.t, kind: K.LAYER_POSITION })
  } else if (key === CONDITION.CLEAR) {
    /* 「判过了是晴空」是**否定式事实**，不是弃权（铁律 26）；<15% 是 sky 侧的晴空口径，
       与成带判据 80 无关，所以它不是 LAYER_POSITION 而是 SKY_CLARITY。 */
    out.push({ fact: '此海拔与上下邻域云量均 <15%', at: h.t, kind: K.SKY_CLARITY })
  }
  /* 判不出三态时，证据链里必须留一句「为什么判不出」——
     否则读的人无法区分「判过是晴」与「证据不足」，未知就会被当成否定。 */
  if (!key) {
    const why = FMT.cloudPositionReason(st.reason)
    if (why) out.push({ fact: why, at: h.t, kind: K.ABSTAIN })
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
 *
 * 三层账本分开记（Q5 审计要求的"三类不确定"各有各的名字，不许静默合并）：
 *   candidates    —— 被接受的逐时候选
 *   rejected      —— L2 说「云在脚下」但 L3 逐时门槛没过（业务口径拒绝，附具体门槛；stage='hour'）
 *   notEvaluated  —— L2 根本没给出 CLOUD_BELOW，因此 L3 从未运行（stage='hour'）：
 *                    可能是判过了不成立（IN_CLOUD/CLOUD_ABOVE/CLEAR = 否定式事实），
 *                    也可能是**判不出**（no-altitude / no-data / within-uncertainty /
 *                    both-sides / partial-at-point）。两者都不是"没有云海"。
 * @returns { candidates, rejected, notEvaluated }（后两者为负证据，模型内部保留，UI 不展示）
 */
function detectCloudSeaCandidates(conditions, fieldSample, userAlt, opts) {
  const o = Object.assign({}, CLOUD_SEA, opts || {})
  const candidates = []
  const rejected = []
  const notEvaluated = []
  /* 扫描范围契约交给 L1：本轮缺省仍是显示窗常量，但实测覆盖一并传进去，
     让"扫到数据之外"这件事在 ranges.notes 里留痕（不影响任何数值）。 */
  const scanRanges = CLF.resolveRanges({
    scanRange: o.scanRange, dataCoverage: o.dataCoverage, displayRange: o.displayRange,
  })
  conditions.forEach(function (c) {
    if (c.key !== CONDITION.CLOUD_BELOW) {
      notEvaluated.push({
        t: c.t,
        stage: 'hour',
        condition: c.key || null,
        abstain: c.key ? null : (c.reason || null),
        detail: c.key
          ? 'L2 判为 ' + c.key + '（不是「云在此点下方」），未进入云海判定'
          : 'L2 判不出（' + (c.reason || 'no-reason') + '：' + FMT.cloudPositionReason(c.reason) + '），未进入云海判定',
      })
      return
    }
    const hour = sky.hourMin(c.t) / 60
    const allLayers = cloudLayersAt(fieldSample, hour, Object.assign({}, o, { scanRanges: scanRanges }))
    const picked = CLF.topmostBelow(allLayers, userAlt)
    if (!picked) {
      rejected.push({ t: c.t, stage: 'hour', reason: 'NO_LAYER_BELOW', detail: '用户下方无 ≥' + o.LAYER_COVER_MIN + '% 连续层' })
      return
    }
    const L = picked.layer // 点下方最高的那一层（薄层屏蔽风险见 cloud-layer-facts.topmostBelow 注释）
    const clearance = picked.clearance
    if (clearance < o.CLEARANCE_MIN) {
      rejected.push({ t: c.t, stage: 'hour', reason: clearance < 0 ? 'USER_INSIDE_CLOUD' : 'USER_NOT_ABOVE_CLOUD', detail: '净空 ' + Math.round(clearance) + ' m < ' + o.CLEARANCE_MIN + ' m' })
      return
    }
    if (L.meanCover < o.LAYER_COVER_MIN) {
      rejected.push({ t: c.t, stage: 'hour', reason: 'LOW_COVERAGE', detail: '层均覆盖 ' + L.meanCover + '%' })
      return
    }
    if (L.thickness < o.LAYER_THICKNESS_MIN) {
      rejected.push({ t: c.t, stage: 'hour', reason: 'INSUFFICIENT_THICKNESS', detail: '层厚 ' + L.thickness + ' m < ' + o.LAYER_THICKNESS_MIN + ' m' + (L.baseBoundary || L.topBoundary ? '（该层有一端是扫描窗边界，厚度是窗内可见部分）' : '') })
      return
    }
    candidates.push({
      t: c.t, hour: hour,
      layer: L, clearance: Math.round(clearance),
      wind: o.windAt ? o.windAt(hour) : 0,
    })
  })
  return { candidates: candidates, rejected: rejected, notEvaluated: notEvaluated, scanRanges: scanRanges }
}

/**
 * 候选 → 窗口：时间合并（缺口容忍）→ civil 可见性交集 → 强度 → 证据。
 * @returns { windows, candidates, rejected, noWindow, notEvaluated, scanRanges }
 *   rejected = 逐时（stage='hour'）；noWindow = 逐时全过但窗口级未成立（stage='window'）。
 */
function detectCloudSea(conditions, fieldSample, userAlt, opts) {
  opts = opts || {}
  const o = Object.assign({}, CLOUD_SEA, opts)
  const det = detectCloudSeaCandidates(conditions, fieldSample, userAlt, o)
  const windows = []
  const rejected = det.rejected.slice()
  /* 逐时候选全通过、但**窗口级**没成立（持续性不足 / 民用晨昏外不可见）。
     以前这两种直接混进 `rejected`，于是"某一小时被门槛拒了"和"一天里过了门槛的小时没连成窗"
     记在同一本账上——`candidates + rejected + notEvaluated === 小时数` 这条分区不变量
     会被窗口级条目凭空加进去（有 NOT_VISIBLE 的那天，账就对不上）。切片二把它们分家。 */
  const noWindow = []
  let run = null
  function flush() {
    if (!run) return
    if (run.len < o.MIN_RUN_H) {
      /* 时间连续性不足（§十.D）——负证据保留在模型内部 */
      noWindow.push({ from: run.from, to: run.to, stage: 'window', reason: 'LOW_PERSISTENCE', detail: '持续 ' + run.len + 'h < ' + o.MIN_RUN_H + 'h' })
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
      noWindow.push({ from: from, to: to, stage: 'window', reason: 'NOT_VISIBLE', detail: '民用晨昏之外不可见' })
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
    /* R2：扫描窗边界不是云界。层提取的数值一个都不改（候选、净空、强度、置信度与改前逐字相同），
       但证据句不许再把「2,000」「6,000」这种窗边界写成测出来的云底/云顶——
       审计实测峨眉山 18/12/7 小时的层 base 恰好等于扫描下界（AUDIT.md §3 模式 C）。 */
    const baseBoundary = run.candidates.some(function (c) { return c.layer.baseBoundary })
    const topBoundary = run.candidates.some(function (c) { return c.layer.topBoundary })
    /* 报出来的必须是**实际扫过**的那个范围，而不是显示窗常量。
       今天两者恒等（扫描范围缺省就是显示窗），所以这句与 `CFF.ALT0/ALT1` 逐字相同；
       但 R1 把扫描范围换成相对带之后，再读常量就会说出与实际相反的数 —— 那是个静默的谎。 */
    const winLo = fmtM(det.scanRanges.scan.lo), winHi = fmtM(det.scanRanges.scan.hi)
    /* 四种边界形态说的是**同一件事**：云层带与此点的垂直位置关系。
       以前只有第一种文案里带「云层位于」，摘要选择因此跟着中文走（切片二修的正是这条）；
       现在四条都标 LAYER_POSITION，无论措辞怎么改，被挑去当摘要的都是这一条。 */
    if (!baseBoundary && !topBoundary) {
      evidence.push({ fact: '云层位于 ' + fmtM(run.baseMin) + '–' + fmtM(run.topMax) + ' m', at: from, kind: K.LAYER_POSITION })
    } else if (baseBoundary && topBoundary) {
      evidence.push({ fact: '浓云贯穿剖面扫描窗 ' + winLo + '–' + winHi + ' m：云底低于窗下界、云顶高于窗上界，两端都未测得', at: from, kind: K.LAYER_POSITION })
    } else if (baseBoundary) {
      evidence.push({ fact: '云底低于剖面扫描窗下界 ' + winLo + ' m（未测得）；窗内云层顶约 ' + fmtM(run.topMax) + ' m', at: from, kind: K.LAYER_POSITION })
    } else {
      evidence.push({ fact: '云顶高于剖面扫描窗上界 ' + winHi + ' m（未测得）；窗内云层底约 ' + fmtM(run.baseMin) + ' m', at: from, kind: K.LAYER_POSITION })
    }
    evidence.push({ fact: FMT.ELEV_SUBJECT + '高于该云层顶约 ' + fmtM(clearMin) + ' m' +
      (topBoundary ? '（云顶未测得，此为上限）' : ''), at: from, kind: K.CLEARANCE })
    if (baseBoundary || topBoundary) {
      evidence.push({ fact: '层厚 ' + thickMax + ' m 按扫描窗内可见部分计算，是下限值而不是实测厚度', at: from, kind: K.LAYER_EXTENT })
    } else {
      evidence.push({ fact: '层均覆盖 ' + coverPeak + '% · 层厚最大 ' + thickMax + ' m', at: from, kind: K.LAYER_EXTENT })
    }
    evidence.push({ fact: '预计持续约 ' + run.len + ' 小时', at: from, kind: K.DURATION })
    if (windPeak > 0) evidence.push({ fact: '风速 ≤ ' + windPeak + ' km/h', at: from, kind: K.WIND })
    if (overlapsSunrise) evidence.push({ fact: '窗口与日出重叠（日出云海）', at: from, kind: K.SUNRISE_OVERLAP })
    windows.push({
      type: 'CLOUD_SEA',
      interpretation: OPPORTUNITY.CLOUD_SEA,
      from: from, to: to,
      confidence: confidenceOf(coverPeak, 90),
      rank: BASE_RANK.CLOUD_SEA,
      strength: strength,
      layers: run.candidates.map(function (c) {
        return {
          t: c.t, base: c.layer.base, top: c.layer.top, cover: c.layer.meanCover, clearance: c.clearance,
          /* 边界来源标记：数值与改前逐字相同，多出来的只有这两个布尔——
             测试与 UI 据此判断「这层是完整测到的」还是「被扫描窗切了一刀」，不必解析证据文案 */
          baseBoundary: c.layer.baseBoundary === true, topBoundary: c.layer.topBoundary === true,
        }
      }),
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
  return { windows: windows, candidates: det.candidates, rejected: rejected, noWindow: noWindow, notEvaluated: det.notEvaluated, scanRanges: det.scanRanges }
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
    if (NIGHT_TYPES[type]) {
      if (skyBlocked(conditions, from, to)) return   // 剖面说头顶有云 ⇒ 这张卡不成立，省略
      ev.push({ fact: NIGHT_LIMIT, at: from, kind: K.NIGHT_LIMIT })
    }
    out.push(makeWindow(type, from, to, ev, extra, hours, ctx))
  })

  /* 2) 条件态连续段 → IN_CLOUD / VIEW_WINDOW / CLOUD_BELOW 窗口 */
  const runs = conditionRuns(conditions)
  runs.forEach(function (run) {
    if (run.key === CONDITION.IN_CLOUD && run.len >= 2) {
      const hours = detailHours(detail, run.from, run.to)
      const ev = run.evidence.slice()
      if (ctx.cloudField && ctx.cloudField.covered) {
        ev.push({ fact: '云场覆盖 ' + fmtM(ctx.cloudField.covered.lo) + '–' + fmtM(ctx.cloudField.covered.hi) + ' m（23 层气压层）', at: run.from, kind: K.DATA_COVERAGE })
      }
      /* confidenceOf 的那个 80 是**云量峰值的置信分档**（≥80 算「高」），
         与成带判据 `CLOUD_BAND_COVER_MIN` 同值但不同义 —— 不要顺手合并这两处。 */
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
      if (high != null) ev.push({ fact: '高层云 ' + high + '%（远眺被挡概率低）', at: run.from, kind: K.CLOUD_AMOUNT })
      if (vis != null) ev.push({ fact: '能见度 ' + vis + ' km', at: run.from, kind: K.VISIBILITY })
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

/* 夜间天空类机会的一致性闸：星空/银河的标记只看地表高中云量聚合（cloud.mid/high），
 * 而垂直剖面是另一份证据。两者冲突时旧实现取了更乐观的那一张卡——
 * 剖面显示此点上方全是 100% 云时，「银河窗口」仍然出卡（实测复现）。
 * 规则：剖面判为「此点正处于云中」或「此点上方有浓云」的小时，一律不发星空/银河卡（明确不成立 ⇒ 省略）。
 * 判据取 holds 而不是 key——「上下都有云带」那一小时 key 记的是 CLOUD_BELOW
 * （云海的必要条件要用它），只看 key 就会把头顶那层云漏掉，正是要防的乐观取值。 */
const NIGHT_TYPES = { STARGAZING: true, MILKY_WAY: true }
const NIGHT_BLOCKED = { IN_CLOUD: true, CLOUD_ABOVE: true }
function skyBlocked (conditions, from, to) {
  if (!conditions || !conditions.length) return false
  const f = sky.hourMin(from), t = sky.hourMin(to)
  return conditions.some(function (c) {
    const m = sky.hourMin(c.t)
    if (!(m >= f - 30 && m <= t + 30)) return false
    return NIGHT_BLOCKED[c.key] === true || (c.holds || []).indexOf('mid') !== -1
  })
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
      /* 扫描范围契约的三段输入在此摊开：本轮只传实测覆盖（L1 事实），
         业务扫描范围仍缺省取显示窗常量 —— 传进来只为了让"扫到数据之外"留痕，不改任何数值。
         `ctx.cloudSeaScan` 是给 R1 留的接缝：不传 = 今天的行为；传了 = 用调用方给的扫描范围，
         判定与证据句都跟着走（由 tools/cloud-layer-facts-test.js 的注入用例钉住）。 */
      scanRange: (ctx.cloudSeaScan && ctx.cloudSeaScan.scanRange) || null,
      dataCoverage: full.cloudField.covered || null,
      displayRange: (ctx.cloudSeaScan && ctx.cloudSeaScan.displayRange) || full.cloudField.displayRange || null,
    })
    opportunities = opportunities
      .filter(function (w2) { return w2.type !== 'CLOUD_SEA' })
      .concat(sea.windows)
      .sort(function (a, b) { return sky.hourMin(a.from) - sky.hourMin(b.from) })
    cloudSeaDebug = {
      candidates: sea.candidates, rejected: sea.rejected,
      /* 「没进判定」与「判定后拒绝」与「过了判定但没成窗」是三件事（Q5 三分归因）：
         notEvaluated = L2 没给出云在脚下，L3 从未运行（含判不出，未知≠无云）；
         rejected     = 逐时门槛没过，原因码具名；
         noWindow     = 逐时都过了，但合并后没连成窗口（持续性 / 民用晨昏可见性）。
         没有这三本账，"理塘那周没云海天气"和"云在脚下但厚度不够"看起来一模一样。 */
      noWindow: sea.noWindow,
      notEvaluated: sea.notEvaluated,
      scanRanges: sea.scanRanges,
    }
  }

  /* 「不成立」与「证据不足」必须分开（任务书 §6.2）：
     不成立 = 上面的各条省略闸；证据不足 = 这里显式列出的缺失输入。
     下游文案据此说「缺少 X，未作判断」，而不是把沉默粉饰成结论。 */
  const evidenceGaps = []
  if (full.elevOK === false || !Number.isFinite(full.userAltitude)) evidenceGaps.push('userAltitude')
  if (!full.cloudField) evidenceGaps.push('cloudField')
  if (!full.sun || !full.sun.sunrise) evidenceGaps.push('sunTimes')
  if (!full.moon) evidenceGaps.push('moon')
  if (!(full.detail || []).some(h => Number.isFinite(h.visibility))) evidenceGaps.push('visibility')
  if (!(full.detail || []).some(h => Number.isFinite(h.rh))) evidenceGaps.push('humidity')
  evidenceGaps.push('lightPollution')   // 永远缺：无数据源，星空/银河类只能声明边界

  return {
    conditions: conditions,
    opportunities: opportunities,
    meta: {
      sources: ctx.cloudField ? ['cloud-field', 'hour-marks', 'astro'] : ['hour-view', 'astro'],
      silence: opportunities.length === 0,
      cloudSea: cloudSeaDebug,   // 负证据（模型内部保留；生产 UI 不展示）
      evidenceGaps: evidenceGaps,
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
