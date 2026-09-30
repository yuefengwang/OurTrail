/**
 * 天气模块 · 轨迹层编排（P4 时空天相）
 *
 * ── 边界（务必遵守，勿越界）────────────────────────────────────────
 * 本文件**不含任何天相阈值判定**。天相一律由 `utils/sky.js` 的
 * `hourMarks` / `summarize` 判定——它与 `components/meteogram/layout.js`
 * 的 `MARK_STYLE` 共用一套阈值，图上的标记与文字结论才不会互相打架。
 *
 * 原型（Figma Make React 工程）自带一套天相阈值，因为那边没有 sky.js。
 * 移植时若照搬就会留下第二套引擎：同一时刻图表与结论卡可能给不同结论，
 * 而 `tools/sky-test.js` 的 65 例完全测不到新那一套。
 *
 * 本文件只负责 sky.js **没有**的那一层：
 *   1. 逐时插值（sky.js 只看整点槽）
 *   2. 逐节点编排（按节点自己的海拔问 sky.js——「云在脚下」正来自此）
 *   3. 连续段切分与孤立点识别
 *   4. 把 sky.js 的分数汇成结论（不新增阈值档位）
 *
 * ── 复用清单（不要另写一套）────────────────────────────────────────
 *   时间解析  → sky.hourMin
 *   窗口成串  → sky.windowText
 *   分数分档  → sky.grade
 *   天相判定  → sky.hourMarks / sky.summarize
 *
 * 时间一律存 'HH:mm' 字符串，与 `series[].t` 的既有约定一致；
 * 本文件不开第二个日期库（`utils/AGENTS.md` 铁律）。
 *
 * wx-free：不得出现任何 `wx.*`，否则会被移出 Node 测试覆盖。
 */

const sky = require('./sky')

/* ---------- 内部小工具 ---------- */

const MIN_PER_DAY = 24 * 60

// 取某日某整点的 series 项。series 跨 7 天，靠 d 区分日期；t 是 'HH:mm'
function hourAt(series, date, hhmm) {
  if (!Array.isArray(series) || !date || !hhmm) return null
  for (let i = 0; i < series.length; i++) {
    if (series[i].d === date && series[i].t === hhmm) return series[i]
  }
  return null
}

// 一天里最后一个有样本的整点（通常是 '23:00'，数据不足时会更早）
function lastSlotOf(series, date) {
  let best = null
  for (let i = 0; i < series.length; i++) {
    if (series[i].d !== date) continue
    const m = sky.hourMin(series[i].t)
    if (!Number.isFinite(m)) continue
    if (!best || m > sky.hourMin(best.t)) best = series[i]
  }
  return best
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function numOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : (fallback === undefined ? null : fallback)
}

// 云带插值：恰好落在整点（t=0）时取该整点自己的云带；
// 落在两个整点之间时，两端任一没有 band 就整体判无云带——
// **不编造**。band 是服务端 cloudBandAt 逐时算出的成层判定，
// 在「有→无」的过渡区间做插值会造出一个服务端从未判过的云层。
// 末槽（无后继样本）同样取该槽自己的值。
function lerpBand(a, b, t) {
  const bandOf = h => (h && h.band
    ? { base: h.band.base, top: h.band.top, cover: h.band.cover }
    : null)
  if (!b || t <= 0) return bandOf(a)
  if (t >= 1) return bandOf(b)
  if (!a || !a.band || !b.band) return null
  return {
    base: Math.round(lerp(a.band.base, b.band.base, t)),
    top: Math.round(lerp(a.band.top, b.band.top, t)),
    cover: Math.round(lerp(a.band.cover, b.band.cover, t)),
  }
}

/* ---------- 1. 逐时插值 ---------- */

/**
 * 取某日某时刻的完整快照（线性插值）。
 *
 * @param series  weather 返回的 series（7×24，含 d/t/band）
 * @param date    'YYYY-MM-DD'
 * @param minutes 自 00:00 起的分钟数
 * @returns {null|{minutes,slot,prevSlot,nextSlot,temp,precip,showers,wind,rh,
 *                 cloudLow,cloudMid,cloudHigh,band}}
 *          minutes 越界（<0 或 ≥24h）时夹到当日首/末有样本的整点。
 */
function snap(series, date, minutes) {
  const last = lastSlotOf(series, date)
  if (!last) return null
  const lastMin = sky.hourMin(last.t)

  let m = typeof minutes === 'number' && isFinite(minutes) ? minutes : 0
  m = Math.max(0, Math.min(lastMin, m))

  const slot = Math.floor(m / 60) * 60
  const keyOf = mm => {
    const h = Math.floor(mm / 60)
    const mi = Math.round(mm % 60)
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi
  }

  const cur = hourAt(series, date, keyOf(slot)) || last
  const curMin = sky.hourMin(cur.t)
  // 末槽之后没有下一个样本，退化为常量外推（不外推到明天，避免编造）
  const nxt = m >= lastMin ? null : (hourAt(series, date, keyOf(curMin + 60)) || null)
  const t = nxt ? (m - curMin) / 60 : 0

  const cloud = h => (h && h.cloud) || {}
  return {
    minutes: m,
    slot: cur.t,
    prevSlot: cur.t,
    nextSlot: nxt ? nxt.t : null,
    temp: nxt ? lerp(numOr(cur.temp, 0), numOr(nxt.temp, 0), t) : numOr(cur.temp, 0),
    precip: nxt ? lerp(numOr(cur.precip, 0), numOr(nxt.precip, 0), t) : numOr(cur.precip, 0),
    showers: nxt ? lerp(numOr(cur.showers, 0), numOr(nxt.showers, 0), t) : numOr(cur.showers, 0),
    wind: nxt ? lerp(numOr(cur.wind, 0), numOr(nxt.wind, 0), t) : numOr(cur.wind, 0),
    rh: nxt ? lerp(numOr(cur.rh, 0), numOr(nxt.rh, 0), t) : numOr(cur.rh, 0),
    cloudLow: nxt ? lerp(numOr(cloud(cur).low, 0), numOr(cloud(nxt).low, 0), t) : numOr(cloud(cur).low, 0),
    cloudMid: nxt ? lerp(numOr(cloud(cur).mid, 0), numOr(cloud(nxt).mid, 0), t) : numOr(cloud(cur).mid, 0),
    cloudHigh: nxt ? lerp(numOr(cloud(cur).high, 0), numOr(cloud(nxt).high, 0), t) : numOr(cloud(cur).high, 0),
    // 末槽（nxt 为 null）或整点边界都交给 lerpBand 自己处理
    band: lerpBand(cur, nxt, t),
  }
}

/* ---------- 2. 逐节点天相编排 ---------- */

// 天相的「主角」优先级：徒步者真正会追的窗口在前。
// inCloud 是**减分项**（人在云里），不参与竞选，见 pickPrimary。
const PRIMARY_ORDER = ['cloudSea', 'alpenglow', 'golden', 'blueHour', 'rainbow', 'star', 'galaxy']

// 无显著天相时使用的键。**不是** MARK_STYLE 的 key——它表示"图上不着色"。
const NO_PHENOMENON = 'none'

// 'HH:mm' → 所在整点槽的 'HH:mm'（'07:55' → '07:00'）
//
// ** sky.hourMarks 的键是整点槽，不是任意时刻。** GPX 推算出的节点时间
// （05:40 / 07:55 / 14:10）几乎不会整点对齐，直接 marks[node.t] 会永远查不到——
// 图上整条轨迹会全灰、天相窗口一个都不出现。查表前必须先归到整点槽。
function hourSlotOf(hhmm) {
  const m = sky.hourMin(hhmm)
  if (!Number.isFinite(m)) return hhmm
  const h = Math.floor(m / 60)
  return (h < 10 ? '0' : '') + h + ':00'
}

/**
 * 逐节点天相。
 *
 * 关键 1：每个节点用**自己的海拔**单独问一次 sky.hourMarks。
 *   这不是性能取舍，是正确性——2860m 的节点可能判 inCloud（人在云里），
 *   而同一时刻 3900m 的节点判 cloudSea（云在脚下）。「云在脚下」正来自这个差值。
 *
 * 关键 2：坐标也**逐节点**取。太阳高度角/方位角沿路线会偏移，
 *   52 km 的行程共用一个经纬度会让天文时刻算错。
 *   node.lat/lng 缺省时回退到 input.lat/lng（单点查询场景）。
 *
 * 关键 3：查 marks 前把节点时间归到**整点槽**（见 hourSlotOf 的注释）。
 *
 * @param input {series, days, nodes, lat, lng}
 *        nodes: [{t:'HH:mm', d:'YYYY-MM-DD', alt, km?, name?, lat?, lng?}]
 * @returns [{t, d, alt, km, name, marks, primary, elevOK}]
 */
function nodeFacts(input) {
  const { series, days, nodes, lat, lng } = input || {}
  if (!Array.isArray(nodes)) return []

  return nodes.map(node => {
    const date = node.d
    const detail = date ? series.filter(h => h.d === date) : []
    const elevation = numOr(node.alt, null)
    const elevOK = elevation != null
    const nLat = numOr(node.lat, numOr(lat, NaN))
    const nLng = numOr(node.lng, numOr(lng, NaN))

    let marks = []
    if (date && detail.length && Number.isFinite(nLat) && Number.isFinite(nLng)) {
      const m = sky.hourMarks({
        date, lat: nLat, lng: nLng, elevation: elevOK ? elevation : undefined,
        elevOK, detail, days: days || [],
      })
      const slot = hourSlotOf(node.t)
      marks = (m && m[slot]) ? m[slot].slice() : []
    }

    return {
      t: node.t,
      slot: hourSlotOf(node.t),
      d: date,
      alt: elevation,
      km: numOr(node.km, null),
      name: node.name || '',
      marks,
      primary: pickPrimary(marks),
      elevOK,
    }
  })
}

// 从一个节点的天相标记里挑「主角」。inCloud 是减分信号，不当主角。
function pickPrimary(marks) {
  if (!marks || !marks.length) return NO_PHENOMENON
  for (let i = 0; i < PRIMARY_ORDER.length; i++) {
    if (marks.indexOf(PRIMARY_ORDER[i]) !== -1) return PRIMARY_ORDER[i]
  }
  return NO_PHENOMENON
}

/* ---------- 3. 连续段切分 ---------- */

/**
 * 给逐节点天相**标注**连续段信息（不改原对象，返回新数组）。
 *
 * 这是「什么算主窗口、什么算孤立点」的**唯一判定处**：
 * `runsOf` 基于它出文案，`space-time/layout.js` 基于它画主窗口括号。
 * 同一规则只写一次——否则图上的括号与结论卡的主窗口迟早分叉。
 */
function annotateRuns(facts) {
  if (!Array.isArray(facts)) return []
  const out = facts.map(f => Object.assign({}, f, { runIndex: -1, runCount: 0, isolated: false }))
  let i = 0
  while (i < out.length) {
    let j = i + 1
    while (j < out.length && out[j].primary === out[i].primary) j++
    const count = j - i
    for (let k = i; k < j; k++) {
      out[k].runIndex = i
      out[k].runCount = count
      // 单节点段算孤立点；无天相段不参与「孤立天相」的讨论
      out[k].isolated = count === 1 && out[i].primary !== NO_PHENOMENON
    }
    i = j
  }
  return out
}

/**
 * 把逐节点天相切成连续同相段。
 *
 * @returns [{key, from, to, count, nodes:[fact], isolated:boolean}]
 *          `isolated` = 只命中 1 个节点的段。按 P4 决策「方案 b」，
 *          单节点段不与主窗口混为一谈，由结论卡单列一行。
 */
function runsOf(facts) {
  const marked = annotateRuns(facts)
  if (!marked.length) return []
  const runs = []
  let i = 0
  while (i < marked.length) {
    const j = i + marked[i].runCount
    const slice = marked.slice(i, j)
    runs.push({
      key: slice[0].primary,
      from: slice[0].t,
      to: slice[slice.length - 1].t,
      count: slice.length,
      nodes: slice,
      isolated: slice.length === 1 && slice[0].primary !== NO_PHENOMENON,
    })
    i = j
  }
  return runs
}

/**
 * 主窗口 = 命中节点最多的**多节点**段。单节点段不得当主窗口
 * （`route-schedule` 也是这个立场：无时间信息时宁可沉默，不可编造）。
 */
function mainWindow(runs) {
  const multi = (runs || []).filter(r => !r.isolated && r.key !== NO_PHENOMENON)
  if (!multi.length) return null
  return multi.reduce((a, b) => (b.count > a.count ? b : a))
}

/** 孤立点：命中天相但只有 1 个节点的段。方案 b 要求单列陈述。 */
function isolatedPoints(runs) {
  return (runs || []).filter(r => r.isolated && r.key !== NO_PHENOMENON)
}

/* ---------- 4. 轨迹几何（供时空图与漫游） ---------- */

/**
 * 轨迹折线的稠密采样点。**颜色不在这里给**——渐变色标由节点天相驱动，
 * 见 components/space-time/layout.js（它复用 meteogram 的 MARK_STYLE）。
 *
 * @param input {series, nodes, stayEndH?}
 *        stayEndH 留宿结束时刻（'HH:mm'）；给了就把时间轴延到该时刻，
 *        用于夜间天象。不给则止于最后一个节点。
 * @param stepMin 采样步长（分钟）
 * @returns [{minutes, alt, km, band}]  抵达之后**不采样**（不编造无数据的时段）
 */
function trackPoints(input, stepMin) {
  const { series, nodes, stayEndH } = input || {}
  if (!Array.isArray(nodes) || nodes.length < 1) return []
  const step = stepMin > 0 ? stepMin : 10

  const pts = nodes.map(n => ({
    minutes: sky.hourMin(n.t),
    date: n.d,
    alt: numOr(n.alt, null),
    km: numOr(n.km, null),
  })).filter(p => Number.isFinite(p.minutes))
  if (!pts.length) return []

  const first = pts[0].minutes
  const lastNode = pts[pts.length - 1].minutes
  let end = lastNode
  if (stayEndH) {
    const sm = sky.hourMin(stayEndH)
    if (Number.isFinite(sm) && sm > lastNode) end = Math.min(sm, MIN_PER_DAY - 1)
  }

  const out = []
  for (let m = first; m <= end; m += step) {
    out.push(sampleTrack(pts, series, m))
  }
  if (!out.length || out[out.length - 1].minutes !== end) out.push(sampleTrack(pts, series, end))
  return out
}

// 在节点折线上插值取某分钟的里程/海拔，再取该时刻的云带
function sampleTrack(pts, series, minutes) {
  const geo = posAt(pts, minutes)
  const s = geo.date ? snap(series, geo.date, minutes) : null
  return {
    minutes,
    alt: geo.alt,
    km: geo.km,
    band: s ? s.band : null,
  }
}

/**
 * 取某分钟的里程与海拔（节点间线性插值）。
 * 抵达之后返回最后一个节点的值并带 `past: true`，由调用方决定怎么表达，
 * 本函数**不**把山脚高原地外推出去。
 *
 * `km` 缺失时**保持 null**，不兜成 0——「0 km」会被读成「这条路线长度为零」，
 * 比缺一项更糟。GPX 的路线点目前不输出数值化累计里程，所以这条常走 null。
 */
function posAt(pts, minutes) {
  if (!Array.isArray(pts) || !pts.length) return { minutes, alt: null, km: null, past: false }
  if (minutes <= pts[0].minutes) {
    return { minutes, alt: pts[0].alt, km: pts[0].km == null ? null : pts[0].km, date: pts[0].date, past: false }
  }
  const lastP = pts[pts.length - 1]
  if (minutes >= lastP.minutes) {
    return { minutes, alt: lastP.alt, km: lastP.km == null ? null : lastP.km, date: lastP.date, past: minutes > lastP.minutes }
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    if (minutes <= b.minutes) {
      const span = b.minutes - a.minutes
      const t = span > 0 ? (minutes - a.minutes) / span : 0
      // 两端都没有里程就保持 null；只有一端有才按 0 补（宁可粗略也不要假装精确）
      const km = (a.km == null && b.km == null) ? null : lerp(numOr(a.km, 0), numOr(b.km, 0), t)
      return {
        minutes,
        alt: lerp(numOr(a.alt, 0), numOr(b.alt, 0), t),
        km,
        // 日期按区间左端：跨天插值时不编造切换时刻
        date: a.date,
        past: false,
      }
    }
  }
  return { minutes, alt: lastP.alt, km: lastP.km == null ? null : lastP.km, date: lastP.date, past: false }
}

/* ---------- 5. 结论汇总 ---------- */

/**
 * 把 sky.js 的分数汇成一条结论。**不新增阈值档位**：
 * 取值就是 sky.js 各项 `score` 的均值，分档仍交给 `sky.grade`。
 *
 * 之所以能这么做：云海/光染/星空/银河/彩虹的档位已在 sky.js 里定死并被
 * 65 例测试钉住；这里只做加权，不做判断。
 *
 * @param input {series, days, lat, lng, node}
 *        node: 取结论的那个节点（通常是抵达节点）
 * @returns {null|{score, tone, label, items, reasons, window}}
 */
function judge(input) {
  const { series, days, lat, lng, node } = input || {}
  if (!node || !node.d) return null
  const detail = series.filter(h => h.d === node.d)
  if (!detail.length) return null

  const s = sky.summarize({
    date: node.d, lat, lng,
    elevation: numOr(node.alt, undefined),
    elevOK: numOr(node.alt, null) != null,
    detail, days: days || [],
  })
  if (!s) return null

  // 只把 sky.js 判为「有戏」的项计入均值：条件较差(0)的项计入会把整体拉平，
  // 而「没有彩虹」不是这条线路的缺陷。
  const live = s.items.filter(it => it.score >= 45)
  const pool = live.length ? live : s.items
  const score = pool.reduce((a, b) => a + b.score, 0) / pool.length
  const g = sky.grade(score)

  return {
    score: g.score,
    tone: g.tone,
    label: g.label,
    items: s.items,
    reasons: pool.map(it => it.title + '：' + it.text),
    window: pool.map(it => it.window).filter(Boolean).join(' / '),
    sun: s.sun,
    moon: s.moon,
  }
}

/* ---------- 6. 留宿夜间天象 ---------- */

/**
 * 留宿夜间天象（晚霞 / 银河）。
 *
 * **复用手法**：把 `detail` 裁成 `fromH`(默认 18:00)之后**再**交给 `sky.summarize`。
 * 这样 `alpenglowConclusion` 内部的 `isDawn` 判定（`hourMin(h.t) < 12*60`）必然为假，
 * 它返回的就是**昏光**那条结论；`starConclusion` / `galaxyConclusion` 也只会算夜段。
 *
 * 于是阈值、文案、概率语气、证据链**全部原样沿用 sky.js**，本函数不新增任何判断——
 * 这正是 §6.1「weather-model 只做编排」的落地方式。
 *
 * 银河是星空的子集，两者都成立时只报银河（否则用户会看到两张互相包含的卡）。
 *
 * @param input {series, days, lat, lng, node, fromH?}
 *        node 留宿点（通常是抵达/观景位节点——你站在那里看的就是它）
 * @returns {null|{sun, moon, fromH, cards:[{key,title,window,text,score,tone,label,look}]}}
 */
function nightOutlook(input) {
  const { series, days, lat, lng, node } = input || {}
  if (!node || !node.d) return null
  const fromH = input.fromH == null ? 18 : Number(input.fromH)
  const detail = series.filter(h => h.d === node.d && sky.hourMin(h.t) >= fromH * 60)
  if (!detail.length) return null

  const elevation = numOr(node.alt, null)
  const s = sky.summarize({
    date: node.d, lat, lng,
    elevation: elevation == null ? undefined : elevation,
    elevOK: elevation != null, detail, days: days || [],
  })
  if (!s) return null

  const byKey = k => s.items.filter(i => i.key === k)[0] || null
  const glow = byKey('alpenglow')
  // 银河优先；没有银河但有星空就报星空（银河是星空的子集，并列会重复）
  const deep = byKey('galaxy') || byKey('star')
  const deepKey = byKey('galaxy') ? 'galaxy' : 'star'

  const cards = []
  if (glow) {
    cards.push({
      key: 'alpenglow', title: '晚霞',
      window: glow.window, text: glow.text,
      score: glow.score, tone: glow.tone, label: glow.label, look: glow.look,
    })
  }
  if (deep) {
    cards.push({
      key: deepKey, title: deepKey === 'galaxy' ? '银河' : '星空',
      window: deep.window, text: deep.text,
      score: deep.score, tone: deep.tone, label: deep.label, look: deep.look,
    })
  }
  return { sun: s.sun, moon: s.moon, fromH, cards }
}

module.exports = {
  NO_PHENOMENON,
  PRIMARY_ORDER,
  snap,
  nodeFacts,
  pickPrimary,
  annotateRuns,
  runsOf,
  mainWindow,
  isolatedPoints,
  trackPoints,
  posAt,
  judge,
  nightOutlook,
}
