/* OI Presentation Adapter —— Outdoor Intelligence 模型 → 页面呈现（Weather V2 Phase 2）
 *
 * MODEL ≠ PRESENTATION：本模块只做形状转换与产品化措辞，不改 OI 模型的判定与阈值。
 *
 * 输入  OI.buildOutdoorIntelligence 的产出（conditions/opportunities/meta）
 * 输出  {
 *   items: [{ timeText, title, tierText, tierClass, summaryText, hour, rank, type, fromMin, toMin }],
 *   tapZones: [{ left, width, hour }],          // 时间轴上可点的窗口区（百分比；跨零点只含今晚段）
 *   timelineSvg: '<svg…>',                      // 机会时间轴（与 Meteogram 同一 timeScale）
 *   silenceNote: null | '今天暂无明显户外机会',
 *   astroNote: '天文时刻为确定性事件',
 * }
 *
 * 层级约束（Phase 2 §九/§十二）：
 *   L1 天气事实在 Unified Meteogram / 读数条 —— 本模块不重复；
 *   L2/L3 只输出解释与窗口；confidence 用分级词，禁止百分比/评分；
 *   沉默优先：没有天气类机会时不制造负信息墙。
 *
 * wx-free：Node 可测。
 */
'use strict'

const UMG = require('./meteogram-svg.js')
const OI = require('./outdoor-intelligence.js')
const EK = require('./evidence-kind.js').KIND

/* 类型 → 展示标题：直接引用模型侧同一张表（2026-10-09 语义统一轮）。
   这里原来自己抄了一份，云层位置的两个状态与 r3/图例各说各话——
   词汇表有两个出处就没有「一致」可言，删表留引用。 */
const TITLES = OI.OPPORTUNITY

/* 时间轴语义色（克制：低饱和底 + 语义色顶线；与 app.wxss token 同族） */
const TYPE_COLOR = {
  CLOUD_SEA: '#276145',      // success（云海 = 户外价值最高）
  IN_CLOUD: '#8C5A12',       // warning（入云 = 需要注意）
  CLOUD_BELOW: '#276145',
  VIEW_WINDOW: '#346583',    // info（远眺）
  GOLDEN_LIGHT: '#D6A33C',   // golden token
  BLUE_HOUR: '#6C7C93',      // blue-hour token
  ALPENGLOW: '#D6A33C',
  RAINBOW: '#8C5A12',
  STARGAZING: '#346583',
  MILKY_WAY: '#346583',
}

/* 机会时段 → 一句结论（按民用时段，非评分） */
function phaseWord(fromMin) {
  if (fromMin < 5 * 60) return '凌晨'
  if (fromMin < 9 * 60) return '清晨'
  if (fromMin < 12 * 60) return '上午'
  if (fromMin < 14 * 60) return '中午'
  if (fromMin < 18 * 60) return '午后'
  return '傍晚'
}

/* confidence / rank / strength → 三档分级（Phase 3 §五：连续语义，不用分数/星级/百分比）
 *   重点关注 primary —— 稀有机会且证据强（云海 STRONG / confidence 高）
 *   值得关注 good     —— 证据成立的常规机会
 *   条件一般 fair     —— 证据偏弱，可遇不可求
 *   确定 astro        —— 天文确定性事件（不参与天气分级） */
function tierOf(w) {
  if (w.confidence === '明确') return { text: '确定', cls: 'astro' }
  const strong = w.type === 'CLOUD_SEA'
    ? w.strength === 'STRONG'
    : w.confidence === '高' && w.rank === 'primary'
  if (strong) return { text: '重点关注', cls: 'primary' }
  if (w.type === 'CLOUD_SEA') return w.strength === 'MODERATE'
    ? { text: '值得关注', cls: 'good' }
    : { text: '条件一般', cls: 'fair' }
  if (w.confidence === '高') return { text: '值得关注', cls: 'good' }
  if (w.confidence === '中') return { text: '值得关注', cls: 'good' }
  return { text: '条件一般', cls: 'fair' }
}

function hmMin(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '')
  return m ? +m[1] * 60 + +m[2] : -1
}

function pad2(n) { return (n < 10 ? '0' : '') + n }

/* 跨零点窗口：OI 模型输出真实时间（to <= from 表示跨零点），
 * 呈现层负责切段与标注（不污染模型）：
 *   segments → [{ fromMin, toMin }]（都在 [0,1440] 内；跨零点拆两段）
 *   timeLabel → '今晚 22:30 → 次日 02:40' | '05:00–10:00'
 * 24h 卡在**时间轴上只画今晚段**（计划 §5.3 保守方案）：次日段贴到今日最左端是谎，
 * 但列表文案仍完整说明「今晚 … → 次日 …」，后半夜部分不隐藏。 */
function segmentsOfMinutes(f, t) {
  if (!(f >= 0) || !(t >= 0)) return []
  if (t === f) return [{ fromMin: f, toMin: Math.min(1440, f + 60) }]  // 单小时窗：[from, from+1h)
  if (t > f) return [{ fromMin: f, toMin: t }]
  return [{ fromMin: f, toMin: 1440 }, { fromMin: 0, toMin: t }]
}
function splitSegments(from, to) {
  return segmentsOfMinutes(hmMin(from), hmMin(to))
}
function isCrossMidnight(from, to) {
  const f = hmMin(from), t = hmMin(to)
  return f >= 0 && t >= 0 && t < f   // 严格小于：单小时窗（t===f）不算跨零点
}
function timeLabel(from, to) {
  if (isCrossMidnight(from, to)) return '今晚 ' + from + ' → 次日 ' + to
  return from + '–' + to
}

/* Evidence Anchor：OI 机会 →「看图 ↗」的时间锚点。
 * focusHour 优先级（§6）：① 模型已给 representative hour（当前模型未提供）
 *   ② **摘要那一条证据**的时刻（`primaryEvidence`，与卡片文字同源，不再各读各的）
 *   ③ 窗口中点（跨零点感知）。
 * 单位：小时（0–23；endHour 可为 24 表示午夜结束）。focus 永远可安全喂给 selectHour。 */
function evidenceAnchor(w2) {
  const segs = splitSegments(w2.from, w2.to)
  if (!segs.length) return null
  const cross = isCrossMidnight(w2.from, w2.to)
  const startHour = segs[0].fromMin / 60
  let endHour
  let focusMin = -1
  const head = primaryEvidence(w2)
  const atMin = head ? hmMin(head.at) : -1
  if (cross) {
    /* 跨零点：24h 图上只有今晚这一段 [from, 24:00)，锚点必须落在这里。
       次日 02:00 的证据在小程序这张图上不存在——采用它会让「看图」跳到一个
       今天不存在的时刻（旧实现把次日段贴到今日最左端，正是同一类谎）。 */
    endHour = 24
    if (atMin >= segs[0].fromMin && atMin < 1440) focusMin = atMin
    else focusMin = segs[0].fromMin + Math.floor((1440 - segs[0].fromMin) / 2)
  } else {
    const endSeg = segs[segs.length - 1]
    endHour = (endSeg.toMin === 1440 ? 1440 : endSeg.toMin) / 60
    if (atMin >= 0 && segs.some(function (sg) {
      return atMin >= sg.fromMin && (atMin < sg.toMin || (sg.toMin === 1440 && atMin < 1440))
    })) {
      focusMin = atMin
    } else {
      /* 中点（跨零点感知：span 沿时间轴单向累计） */
      const span = endSeg.toMin - segs[0].fromMin + (segs.length > 1 ? 1440 : 0)
      focusMin = segs[0].fromMin + Math.floor(span / 2)
      if (focusMin >= 1440) focusMin -= 1440
    }
  }
  const focusHour = Math.floor(focusMin / 60) % 24
  return {
    kind: 'meteogram',
    startHour: startHour,
    endHour: endHour,
    focusHour: focusHour,
    focusLabel: pad2(focusHour) + ':00',
    label: '看图',
  }
}

function hm2(h) { return (h < 10 ? '0' : '') + h + ':00' }

/* 摘要首选序（切片二）：以前这里写的是
 *     evidence.find(e => e.fact.indexOf('云区') >= 0 || e.fact.indexOf('云层位于') >= 0)
 * —— 按**中文文案的字面**挑「这张卡的一句话依据」。R2 把「云层位于 2,000–3,300 m」
 * 改成「云底低于剖面扫描窗下界…」时，被挑中的是哪一行纯粹是改文案的副作用。
 * 现在由证据自己带的 `kind` 决定，类别词表在 `utils/evidence-kind.js`（产生处负责）；
 * 「哪一类值得当摘要」是呈现选择，所以这张优先序表留在这里。
 * 优先序之内保留产生顺序（同一小时可能有两条位置句，取先出现的那条）——
 * 这是同一类别内的展示 tie-break，不是跨类别的业务判据。 */
const SUMMARY_KIND_PRIORITY = [EK.LAYER_POSITION]

/* 摘要与「看图」锚点必须指向**同一条**证据：以前锚点固定读 evidence[0]、
 * 摘要按文案 find，两条规则一旦分叉，卡片文字和点下去高亮的那一小时就会各说各话。 */
function primaryEvidence (w) {
  const ev = (w && w.evidence) || []
  for (let i = 0; i < SUMMARY_KIND_PRIORITY.length; i++) {
    const hit = ev.find(function (e) { return e && e.kind === SUMMARY_KIND_PRIORITY[i] })
    if (hit) return hit
  }
  return ev.length ? ev[0] : null
}

function summaryOf(w) {
  const pick = primaryEvidence(w)
  return pick ? pick.fact : ''
}

/**
 * OI 模型产出 → Opportunity 卡（列表 + 时间轴）
 * @param oi  buildOutdoorIntelligence 的返回值
 * @param opts { width, dateLabel? }
 */
function buildOiCard(oi, opts) {
  opts = opts || {}
  if (!oi || !Array.isArray(oi.opportunities)) oi = { conditions: [], opportunities: [], meta: {} }
  const width = opts.width || 375
  const scale = UMG.timeScale(width)
  const t0 = Date.now()

  const nowMin = opts.nowMin   // 当天「现在」（分钟）；null = 非今天
  const items = (oi.opportunities || []).filter(function (w2) {
    return hmMin(w2.from) >= 0 && hmMin(w2.to) >= 0
  }).map(function (w2) {
    const fromMin = hmMin(w2.from)
    const toMin = hmMin(w2.to)
    const tier = tierOf(w2)
    const cross = isCrossMidnight(w2.from, w2.to)
    /* 「进行中」：now 落在窗口内。跨零点窗口在 24h 卡上只有今晚段可表示 ⇒ 只按今晚段判：
       now=01:00 不是"今晚 23:00→次日 04:00"的进行中（那是明天的图），now=23:30 才是。 */
    let live = false
    if (nowMin != null) {
      const segs = splitSegments(w2.from, w2.to)
      const visible = cross ? segs.slice(0, 1) : segs
      live = visible.some(function (sg) {
        return nowMin >= sg.fromMin && nowMin < sg.toMin
      })
    }
    return {
      type: w2.type,
      title: w2.interpretation || TITLES[w2.type] || w2.type,
      timeText: timeLabel(w2.from, w2.to),
      /* 起止分钟是附加字段：applySelection / 排序用它，跨零点时 toMin < fromMin。
         timeText 只负责显示，不拿它反解业务时间（「今晚 … → 次日 …」反解会丢语义）。 */
      fromMin: fromMin,
      toMin: toMin,
      hour: Math.max(0, Math.min(23, Math.floor(fromMin / 60))),
      tierText: tier.text,
      tierClass: tier.cls,
      summaryText: summaryOf(w2),
      phase: phaseWord(fromMin),
      rank: w2.rank,
      confidence: w2.confidence,
      crossMidnight: cross,
      live: live,
      anchor: evidenceAnchor(w2),
    }
  })

  /* 列表排序：primary 在前，其余按开始时间（时间轴仍按时间序）。
     开始时间用 fromMin：跨零点条目的 timeText 是「今晚 … → 次日 …」，拿它按 '–' 切
     既切不出时间、又会得到 -1（旧实现把它们全排到最前面）。 */
  const itemsSorted = items.slice().sort(function (a, b) {
    if (a.rank !== b.rank) return a.rank === 'primary' ? -1 : 1
    const af = Number.isFinite(a.fromMin) ? a.fromMin : hmMin(a.timeText.split('–')[0])
    const bf = Number.isFinite(b.fromMin) ? b.fromMin : hmMin(b.timeText.split('–')[0])
    return af - bf
  })

  /* 时间轴带分配：单轨道优先，重叠放第二轨道（最多两轨，不做 Gantt 墙） */
  const spans = []
  ;(oi.opportunities || []).filter(function (w2) {
    return hmMin(w2.from) >= 0 && hmMin(w2.to) >= 0
  }).forEach(function (w2) {
    const segs = splitSegments(w2.from, w2.to)
    const cross = isCrossMidnight(w2.from, w2.to)
    segs.forEach(function (sg, si) {
      /* 计划 §5.3：跨零点窗口在 24h 时间轴上**只画今晚段**，次日段不画——
         次日段只能贴到今日最左端（00:00 起），那不是这一天发生的事。列表文案照旧说明后半夜。 */
      if (cross && si > 0) return
      spans.push({
        type: w2.type,
        fromMin: sg.fromMin,
        toMin: Math.max(sg.toMin, sg.fromMin + 30), // 至少 30 分钟可见
        hour: Math.max(0, Math.min(23, Math.floor(sg.fromMin / 60))),
        color: TYPE_COLOR[w2.type] || '#346583',
        title: w2.interpretation || TITLES[w2.type] || w2.type,
        nextDay: false,   // 跨零点只 push 今晚段；字段保留以维持 span 形状
      })
    })
  })
  spans.sort(function (a, b) { return a.fromMin - b.fromMin })

  const tracks = []
  spans.forEach(function (sp) {
    let track = tracks.find(function (t2) { return sp.fromMin >= t2.end })
    if (!track && tracks.length < 2) { track = { end: -1, spans: [] }; tracks.push(track) }
    if (track) { track.end = Math.max(track.end, sp.toMin); track.spans.push(sp) }
  })

  const svgH = 12 + tracks.length * 18 + 14
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + svgH + '" viewBox="0 0 ' + width + ' ' + svgH + '">'
  /* 时间刻度与 Meteogram 同一 timeScale（刻度 00/06/12/18/24） */
  ;[0, 6, 12, 18, 24].forEach(function (h) {
    const x = h === 24 ? scale.x1(23) : scale.X(h)
    svg += '<text x="' + x.toFixed(1) + '" y="' + (svgH - 3) + '" text-anchor="middle" font-size="8" fill="#8a8f8a">' + (h === 24 ? '24' : ('0' + h).slice(-2)) + '</text>'
    if (h > 0 && h < 24) svg += '<line x1="' + x.toFixed(1) + '" y1="2" x2="' + x.toFixed(1) + '" y2="' + (svgH - 12) + '" stroke="#e9eae4" stroke-width="0.6"/>'
  })
  tracks.forEach(function (track, ti) {
    const y = 10 + ti * 18
    track.spans.forEach(function (sp) {
      const xA = scale.x0(0) + (sp.fromMin / 1440) * (scale.plotW)
      const xB = scale.x0(0) + (sp.toMin / 1440) * (scale.plotW)
      svg += '<rect x="' + xA.toFixed(1) + '" y="' + y + '" width="' + Math.max(6, xB - xA).toFixed(1) + '" height="10" rx="2" fill="' + sp.color + '" fill-opacity="0.30"/>'
      svg += '<rect x="' + xA.toFixed(1) + '" y="' + y + '" width="' + Math.max(6, xB - xA).toFixed(1) + '" height="2" rx="1" fill="' + sp.color + '"/>'
    })
  })
  /* 「现在」细线（仅当天） */
  if (nowMin != null) {
    const nx = scale.x0(0) + (nowMin / 1440) * scale.plotW
    svg += '<line x1="' + nx.toFixed(1) + '" y1="2" x2="' + nx.toFixed(1) + '" y2="' + (svgH - 12) + '" stroke="#163e35" stroke-width="0.7" stroke-dasharray="2 2" opacity="0.6"/>'
  }
  svg += '</svg>'

  /* 时间轴可点区（WXML 绝对定位覆盖层；tap → selectHour） */
  const tapZones = []
  spans.forEach(function (sp) {
    tapZones.push({
      left: (sp.fromMin / 1440 * 100).toFixed(2),
      width: Math.max(3, (sp.toMin - sp.fromMin) / 1440 * 100).toFixed(2),
      hour: sp.hour,
      title: sp.title,
    })
  })

  const weatherCount = items.filter(function (it) {
    return ['CLOUD_SEA', 'IN_CLOUD', 'VIEW_WINDOW'].indexOf(it.type) >= 0
  }).length

  /* Phase 3 §四：默认最多 3 个主要机会，其余折叠为「还有 N 个时段」 */
  const TOP_N = 3
  const visibleItems = itemsSorted.slice(0, TOP_N)
  const moreItems = itemsSorted.slice(TOP_N)

  return {
    items: visibleItems,
    moreItems: moreItems,
    moreCount: moreItems.length,
    nowMin: nowMin != null ? nowMin : null,
    tapZones: tapZones,
    timelineSvg: svg,
    timelineHeight: svgH,
    silenceNote: weatherCount === 0 ? '今天暂无明显天气类户外机会（天文时刻仍有效）' : null,
    astroNote: '天文时刻为确定性事件 · 天气窗口标注置信',
  }
}

/* ---------- Phase 4：多日机会卡（48/72h horizon 视图） ---------- */

/**
 * 逐日 OI → horizon 机会卡：按日分组（editorial），窗口/锚点用绝对小时
 * （dayOffset*24 + hour），与多日 Meteogram 共用同一 timeScale(width, horizon)。
 * @param days [{ dayLabel, date, oi }]（oi = buildOutdoorIntelligence 单日产出）
 * @param opts { width, horizon: 48|72 }
 */
function buildHorizonOiCard(days, opts) {
  opts = opts || {}
  const width = opts.width || 375
  const horizon = opts.horizon === 72 ? 72 : 48
  const scale = UMG.timeScale(width, horizon)
  const groups = []
  const spans = []
  let idx = 0
  days.forEach(function (day, di) {
    const card = buildOiCard(day.oi, { width: width })
    const items = []
    card.items.concat(card.moreItems || []).forEach(function (it) {
      const absHour = di * 24 + it.hour
      const anchor = it.anchor ? {
        kind: 'meteogram',
        startHour: di * 24 + (it.anchor.startHour >= 24 ? it.anchor.startHour - 24 : it.anchor.startHour),
        endHour: di * 24 + it.anchor.endHour,
        focusAbs: di * 24 + it.anchor.focusHour,
        focusHour: it.anchor.focusHour,
        focusLabel: it.anchor.focusLabel,
        label: it.anchor.label,
      } : null
      /* fromMin/toMin 是 24h 卡内部字段（排序/命中/跨零点判定用），不得漏进 48/72h
         item：horizon 卡是本轮的**阳性对照**，输出必须与改前逐字节相同。 */
      const base = Object.assign({}, it)
      delete base.fromMin
      delete base.toMin
      items.push(Object.assign(base, {
        dayLabel: day.dayLabel,
        absHour: absHour,
        anchor: anchor,
      }))
      if (it.anchor) {
        spans.push({
          dayOffset: di,
          fromMin: di * 1440 + hmMin(it.timeText.split('–')[0]),
          toMin: Math.min(di * 1440 + 1440, di * 1440 + hmMin(it.timeText.split('–')[0]) + Math.max(30, (hmMin(it.timeText.split('–')[1] || it.timeText.split('–')[0]) - hmMin(it.timeText.split('–')[0])))),
          absHour: absHour,
          color: TYPE_COLOR[it.type] || '#346583',
        })
      }
      idx++
    })
    groups.push({ label: day.dayLabel, date: day.date, items: items })
  })

  /* 时间轴：horizon 刻度（日界强线 + 6h 小刻度）+ 机会段 */
  const svgH = 12 + 2 * 18 + 14
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + svgH + '" viewBox="0 0 ' + width + ' ' + svgH + '">'
  ;[0, 6, 12, 18].forEach(function (h) {
    for (let d = 0; d < horizon / 24; d++) {
      const x = scale.X(d * 24 + h)
      svg += '<text x="' + x.toFixed(1) + '" y="' + (svgH - 3) + '" text-anchor="middle" font-size="8" fill="#8a8f8a">' + pad2(h) + '</text>'
    }
  })
  ;[24, 48].forEach(function (db) {
    if (db < horizon) {
      const x = scale.x0(db)
      svg += '<line x1="' + x.toFixed(1) + '" y1="2" x2="' + x.toFixed(1) + '" y2="' + (svgH - 12) + '" stroke="#d3d5cd" stroke-width="1"/>'
    }
  })
  spans.forEach(function (sp) {
    const xA = scale.x0(0) + (sp.fromMin / (horizon * 60)) * scale.plotW
    const xB = scale.x0(0) + (sp.toMin / (horizon * 60)) * scale.plotW
    svg += '<rect x="' + xA.toFixed(1) + '" y="' + (10 + sp.dayOffset * 18) + '" width="' + Math.max(6, xB - xA).toFixed(1) + '" height="10" rx="2" fill="' + sp.color + '" fill-opacity="0.30"/>'
    svg += '<rect x="' + xA.toFixed(1) + '" y="' + (10 + sp.dayOffset * 18) + '" width="' + Math.max(6, xB - xA).toFixed(1) + '" height="2" rx="1" fill="' + sp.color + '"/>'
  })
  svg += '</svg>'

  const tapZones = spans.map(function (sp) {
    return {
      left: (sp.fromMin / (horizon * 60) * 100).toFixed(2),
      width: Math.max(2.5, (sp.toMin - sp.fromMin) / (horizon * 60) * 100).toFixed(2),
      hour: sp.absHour,
      track: sp.dayOffset,
    }
  })

  const weatherCount = groups.reduce(function (n, g) {
    return n + g.items.filter(function (it) { return ['CLOUD_SEA', 'IN_CLOUD', 'VIEW_WINDOW'].indexOf(it.type) >= 0 }).length
  }, 0)

  return {
    horizon: horizon,
    groups: groups,
    items: groups.reduce(function (a, g) { return a.concat(g.items) }, []),
    tapZones: tapZones,
    tracks: 2,
    timelineSvg: svg,
    timelineHeight: svgH,
    silenceNote: weatherCount === 0 ? '未来 ' + (horizon / 24) + ' 天暂无明显天气类户外机会（天文时刻仍有效）' : null,
    astroNote: '天文时刻为确定性事件 · 天气窗口标注置信',
  }
}

/* selectHour → horizon 卡选中：absHour 命中的窗口高亮（组内索引） */
function applyHorizonSelection(card, absHour) {
  if (!card) return false
  card.selGroup = -1
  card.selIndex = -1
  card.groups.forEach(function (g, gi) {
    g.items.forEach(function (it, ii) {
      const f = it.absHour, t2 = f + 1
      if (absHour >= f && absHour < t2 && card.selGroup < 0) { card.selGroup = gi; card.selIndex = ii }
    })
  })
  /* 宽语义：选中小时落在窗口段内也算命中。
     窗口起点可能是分钟级（云海按民用晨昏裁剪后 06:52），不能把它当整数小时；
     起点/终点都用绝对小时（跨日已由 buildHorizonOiCard 的 di*24 展开），
     终点小于起点时视为跨零点。 */
  if (card.selGroup < 0) {
    card.groups.forEach(function (g, gi) {
      g.items.forEach(function (it, ii) {
        if (card.selGroup >= 0 || !it.anchor) return
        const a = it.anchor
        const start = Number(a.startHour)
        let end = Number(a.endHour)
        if (!Number.isFinite(start) || !Number.isFinite(end)) return
        if (end < start) end += 24
        if (end === start) end = start + 1
        const focus = Number(absHour)
        if (focus >= start && focus < end) {
          card.selGroup = gi
          card.selIndex = ii
        }
      })
    })
  }
  return true
}

/* ---------- Phase 3 §八：多日摘要（48/72h 视图） ---------- */

/* 单日摘要（无 SVG，轻量）：{ date, count, top } */
function summarizeDay(oi, date, dayLabel) {
  const card = buildOiCard(oi, { width: 375 })
  const weather = card.items.filter(function (it) {
    return ['CLOUD_SEA', 'IN_CLOUD', 'VIEW_WINDOW'].indexOf(it.type) >= 0
  })
  const primary = weather.find(function (it) { return it.tierClass === 'primary' })
  const top = primary || weather[0] || card.items[0] || null
  return {
    date: date,
    label: dayLabel,
    count: weather.length,
    allCount: card.items.length,
    topTitle: top ? top.title : null,
    topTime: top ? top.timeText : null,
    topTier: top ? top.tierText : null,
    silence: weather.length === 0,
  }
}

/* 三日摘要列表：days = [{ date, label }]，builders = { getOi(date) } */
function buildMultiDay(days, getOi) {
  return days.map(function (d) {
    return summarizeDay(getOi(d.date), d.date, d.label)
  })
}

/* selectHour → OI 卡选中：包含所选小时的窗口高亮 + 证据展开。
 * Phase 3：折叠区的窗口被选中时自动提升到可见列表（折叠不吞选中）。 */
function applySelection(card, hour) {
  if (!card) return false
  const all = (card.items || []).concat(card.moreItems || [])
  function segsOf(it) {
    /* 新形状带 fromMin/toMin（buildOiCard 的附加字段）：跨零点窗口只有今晚段可点，
       次日段不在这张 24h 图上 ⇒ 只返回第一段（hour=23 命中，hour=01 不命中）。
       旧形状（没有 fromMin）退回旧的 timeText 解析，行为逐字节不变。 */
    if (Number.isFinite(it.fromMin) && Number.isFinite(it.toMin) && it.fromMin >= 0 && it.toMin >= 0) {
      const segs = segmentsOfMinutes(it.fromMin, it.toMin)
      return it.toMin < it.fromMin ? segs.slice(0, 1) : segs
    }
    const t = it.timeText
    return splitSegments(it.timeText.indexOf('→') >= 0
      ? t.replace(/^今晚 /, '').split(' → ')[0]
      : t.split('–')[0],
      it.timeText.indexOf('→') >= 0
        ? t.split(' → ')[1]
        : t.split('–')[1] || t.split('–')[0])
  }
  const m = hour * 60
  function hits(it) {
    return segsOf(it).some(function (sg) { return m >= sg.fromMin && m < sg.toMin })
  }
  let hit = -1
  all.forEach(function (it, i) { if (hit < 0 && hits(it)) hit = i })
  /* 兜底：窗口起点不在整点时，条目自己的 anchor hour = floor(fromMin/60) 落在该窗口之外
   * （实测峨眉山 CLOUD_SEA「06:45–07:00」anchor hour=6 ⇒ 点这一条永远 selIndex=-1）。
   * 只在上面那条**一个都没命中**时才启用 ⇒ 任何原本选得中的点击给出的结果逐字节不变（包含关系是重叠关系的子集）。
   * 多个重叠候选取「本小时内最早开始」的那段，保证确定性；终点仍是开区间，所以窗口结束的那一格不算命中。 */
  if (hit < 0) {
    let best = -1, bestFrom = Infinity
    all.forEach(function (it, i) {
      segsOf(it).forEach(function (sg) {
        if (m < sg.toMin && m + 60 > sg.fromMin && sg.fromMin < bestFrom) { bestFrom = sg.fromMin; best = i }
      })
    })
    hit = best
  }
  const picked = hit >= 0 ? all[hit] : null
  if (picked && hit >= (card.items || []).length) {
    /* 命中折叠区 → 提升到可见列表末尾 */
    card.moreItems = (card.moreItems || []).filter(function (it) { return it !== picked })
    card.items = (card.items || []).concat([picked])
  }
  /* selIndex 必须与 selSummary 指向同一个对象：旧写法把提升后的下标拿去索引提升前的 all，
   * 提升 moreItems 里非首条时会让「高亮的那行」和「展开的摘要」分属两条机会。 */
  card.selIndex = picked ? (card.items || []).indexOf(picked) : -1
  card.selSummary = picked ? picked.summaryText : ''
  return true
}

module.exports = {
  buildOiCard: buildOiCard,
  applySelection: applySelection,
  buildHorizonOiCard: buildHorizonOiCard,
  applyHorizonSelection: applyHorizonSelection,
  summarizeDay: summarizeDay,
  buildMultiDay: buildMultiDay,
  splitSegments: splitSegments,
  isCrossMidnight: isCrossMidnight,
  timeLabel: timeLabel,
  /* 摘要选择是呈现契约的一部分，必须能被测试直接调用——
     否则 tools 只能照着实现重写一遍（那就是给过期契约背书的镜像测试）。 */
  summaryOf: summaryOf,
  primaryEvidence: primaryEvidence,
  SUMMARY_KIND_PRIORITY: SUMMARY_KIND_PRIORITY,
  TITLES: TITLES,
  TYPE_COLOR: TYPE_COLOR,
}
