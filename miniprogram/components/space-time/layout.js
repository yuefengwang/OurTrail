/**
 * 时空天相图 · 几何层（P4）
 *
 * 纯几何模块：吃数据 + 尺寸，吐坐标。**不碰 canvas、不碰 wx、不碰 this.data。**
 *
 * 为什么要抽出来（AGENTS.md 反模式 11）：测试若在页面里复刻一遍几何计算，
 * 就会为一份过期契约背书——`meteogram/layout.js` 正是为此存在，本文件是同一手法。
 *
 * 配色**不在这里发明**：`MARK_STYLE` 与 `textWidth` 直接复用
 * `meteogram/layout.js`，那 8 个天相色是全站唯一来源。
 * `weather-model.js` 只给 key，映射在这里完成——
 * `utils/` 不该反向依赖 `components/`。
 */

const M = require('../meteogram/layout')
const F = require('../../utils/format')

const MARK_STYLE = M.MARK_STYLE
const textWidth = M.textWidth

// 「无显著天相」不是 MARK_STYLE 的 key，用中性灰（MARK_STYLE.inCloud 同色）
const NO_COLOR = MARK_STYLE.inCloud.color

const PAD = { l: 44, t: 18, r: 12, b: 22 }
const ROW_H = 260          // 绘图区高（不含坐标轴文字）
const NODE_R = 3
const RIBBON_W = 5

/* ---------- 刻度 ---------- */

// 取「好看」的刻度间隔：1/2/5 × 10^n
function niceStep(span, target) {
  const raw = span / Math.max(1, target)
  const mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10))
  const norm = raw / mag
  const mult = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10
  return mult * mag
}

// 生成刻度值序列，含首尾
function ticks(min, max, target) {
  if (!(max > min)) return [min]
  const step = niceStep(max - min, target)
  const out = []
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1e6; v += step) {
    out.push(Math.round(v * 1e6) / 1e6)
  }
  return out
}

/* ---------- 时间刻度标签 ---------- */

// 格式化归 utils/format.js（不另开第二个日期库）；这里只做转发，
// 免得几何层与漫游控件各写一份 HH:mm 拼接。
function hhmmOf(minutes) {
  return F.minutesLabel(minutes)
}

/* ---------- 主色混合（canvas 需要实色，不能只靠渐变对象） ---------- */

function hex2rgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// 输出大写十六进制，与 app.wxss token 表和 MARK_STYLE 的字面量大小写一致，
// 免得日志/断言里出现 '#ffffff' 与 '#FFFFFF' 两套写法
function rgb2hex(c) {
  const p = v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2).toUpperCase()
  return '#' + p(c.r) + p(c.g) + p(c.b)
}

/** 两个 hex 之间线性混合。t=0 取 a，t=1 取 b。 */
function mixHex(a, b, t) {
  if (a === b) return a
  const x = hex2rgb(a), y = hex2rgb(b)
  const k = Math.max(0, Math.min(1, t))
  return rgb2hex({ r: x.r + (y.r - x.r) * k, g: x.g + (y.g - x.g) * k, b: x.b + (y.b - x.b) * k })
}

/**
 * hex + 透明度 → rgba()。
 * 地形/云带这类大面积填充需要压到很轻，但 WXSS 没有 color-mix()、
 * canvas 又拿不到 var()，所以半透明色只能在这里算（色值仍来自 MARK_STYLE / token）。
 * **别在组件里另写一套颜色工具。**
 */
function withAlpha(hex, a) {
  const c = hex2rgb(hex)
  const k = Math.max(0, Math.min(1, a))
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + k + ')'
}

/* ---------- 天相 → 颜色 ---------- */

/**
 * 天相 key 取色。`none`（无显著天相）走中性灰。
 * 未知 key 一律回落到中性灰——**不静默画成云海色**，
 * 否则 sky.js 新增一个 key 时图上会误报成云海。
 */
function colorOf(key) {
  if (!key || key === 'none') return NO_COLOR
  const s = MARK_STYLE[key]
  return s ? s.color : NO_COLOR
}

function textOf(key) {
  const s = MARK_STYLE[key]
  return s ? s.text : '无显著天相'
}

/* ---------- 主构建 ---------- */

/**
 * @param input {
 *   points:   [{minutes, alt, km, band}]  稠密轨迹点（weather-model.trackPoints）
 *   facts:    [{t, minutes, alt, km, primary, marks, elevOK}]  逐节点天相
 *   width:    画布 CSS 宽
 *   obsAlt:   观景位海拔（可空）
 *   arriveT:  抵达时刻的 'HH:mm'（可空）
 *   scrub:    播放头分钟数（可空）
 * }
 * @returns 几何对象。所有坐标均为 CSS px（未乘 dpr）。
 */
function build(input) {
  const points = (input && input.points) || []
  const facts = (input && input.facts) || []
  const width = Math.max(1, (input && input.width) || 320)

  if (!points.length) {
    return { empty: true, box: emptyBox(width), points: [], segments: [], nodes: [] }
  }

  const pad = PAD
  const box = {
    w: width,
    h: ROW_H,
    padL: pad.l, padT: pad.t, padR: pad.r, padB: pad.b,
    plotW: Math.max(1, width - pad.l - pad.r),
    plotH: ROW_H - pad.t - pad.b,
  }
  box.x0 = pad.l
  box.y0 = pad.t
  box.x1 = pad.l + box.plotW
  box.y1 = pad.t + box.plotH

  // ---- 值域：动态，绝不写死（原型早期 bug：轴范围硬编码）----
  // 轴只由**数据**决定（路线终点，或留宿时的 stayEndH）。
  // 曾经让播放头位置去撑大 tMax，那是留宿还没实现时的权宜之计，代价是：
  // 播放头停在 21:30 后关掉留宿，轴仍被撑到 21:30 收不回来。
  // 留宿现在由 stayEndH 正确表达，播放头越界时应当被**夹住**而不是撑轴。
  const tMin = points[0].minutes
  const tMax = points[points.length - 1].minutes
  // 路线终点 = 最后一个**节点**的时刻，不是最后一个点。
  // 留宿时点会被 stayEndH 延伸到 23:00，但路线其实 14:10 就到头了——
  // 拿点当终点会把「已抵达、仍在山里」那段误判成没走完。
  const lastNodeT = facts.length ? lastMinuteOf(facts[facts.length - 1].t) : null
  const routeEnd = Number.isFinite(lastNodeT) ? lastNodeT : tMax

  let aMin = Infinity, aMax = -Infinity
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.alt != null) { aMin = Math.min(aMin, p.alt); aMax = Math.max(aMax, p.alt) }
    if (p.band) { aMin = Math.min(aMin, p.band.base); aMax = Math.max(aMax, p.band.top) }
  }
  if (!isFinite(aMin) || !isFinite(aMax)) { aMin = 0; aMax = 1 }
  if (aMax - aMin < 1) { aMin -= 1; aMax += 1 }
  const padA = (aMax - aMin) * 0.08
  aMin -= padA; aMax += padA
  if (input.obsAlt != null) { aMin = Math.min(aMin, input.obsAlt); aMax = Math.max(aMax, input.obsAlt) }

  const spanT = (tMax - tMin) || 1
  const toX = m => box.x0 + ((m - tMin) / spanT) * box.plotW
  const toY = a => box.y1 - ((a - aMin) / (aMax - aMin)) * box.plotH

  // ---- 地形剖面 ----
  const terrain = points.map(p => ({
    x: toX(p.minutes),
    y: p.alt == null ? box.y1 : toY(p.alt),
  }))

  // ---- 云带：按连续区间合并，避免每小时一条碎片 ----
  const clouds = []
  let runStart = null
  for (let i = 0; i < points.length; i++) {
    const b = points[i].band
    const prev = i > 0 ? points[i - 1].band : null
    if (b && (!prev || prev.base !== b.base || prev.top !== b.top)) runStart = points[i]
    if ((!b || i === points.length - 1) && runStart) {
      const bEnd = b || prev
      clouds.push({
        x1: toX(runStart.minutes),
        x2: toX(points[i].minutes),
        yBase: toY(bEnd.base),
        yTop: toY(bEnd.top),
        cover: bEnd.cover,
        base: bEnd.base,
        top: bEnd.top,
      })
      runStart = null
    }
  }

  // ---- 轨迹段：颜色由**节点**天相驱动（12 节点 = 11 段）----
  // 稠密点只管几何，色标按最近节点取值——与原型一致，
  // 也保证「段内天相不变」这个诚实前提。
  // minutes 兼容两种来源：weather-model 的 nodeFacts 给 t('HH:mm')，
  // 这里就地换算；调用方已算好 minutes 时直接用。
  const nodes = facts.map(f => {
    const mins = typeof f.minutes === 'number' ? f.minutes : lastMinuteOf(f.t)
    const key = f.primary || 'none'
    return {
      t: f.t,
      minutes: mins == null ? tMin : mins,
      x: toX(mins == null ? tMin : mins),
      y: f.alt == null ? box.y1 : toY(f.alt),
      alt: f.alt,
      km: f.km,
      key,
      color: colorOf(key),
      text: textOf(key),
      marks: f.marks || [],
      isolated: !!f.isolated,
      runIndex: typeof f.runIndex === 'number' ? f.runIndex : -1,
      runCount: typeof f.runCount === 'number' ? f.runCount : 0,
      r: NODE_R,
    }
  })
  nodes.forEach(n => { n.x = toX(n.minutes) })

  // 每个稠密点归属的节点下标
  const ownerIndex = points.map(p => {
    let best = 0
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].minutes <= p.minutes) best = i
    }
    return nodes.length ? best : 0
  })

  const segments = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const oi = ownerIndex[i]
    const from = nodes.length ? nodes[Math.min(oi, nodes.length - 1)].color : NO_COLOR
    const to = nodes.length ? nodes[Math.min(ownerIndex[i + 1], nodes.length - 1)].color : NO_COLOR
    segments.push({
      i,
      x1: toX(a.minutes), y1: a.alt == null ? box.y1 : toY(a.alt),
      x2: toX(b.minutes), y2: b.alt == null ? box.y1 : toY(b.alt),
      w: RIBBON_W,
      from, to,
    })
  }

  // ---- 主窗口括号 ----
  // facts 需带 annotateRuns 的 runIndex/runCount/isolated 注解
  //（weather-model.annotateRuns 提供，判定规则只写一处）。
  // 主窗口 = **最长**的多节点同相段，不是「所有非孤立节点的首尾跨度」——
  // 后者在存在两段独立窗口时会横跨两者。
  let mainWindow = null
  if (nodes.length) {
    let best = null
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]
      if (n.key === 'none' || !n.runCount || n.runCount < 2) continue
      if (!best || n.runCount > best.count) {
        const slice = nodes.filter(m => m.runIndex === n.runIndex)
        best = {
          count: n.runCount,
          key: n.key,
          color: n.color,
          text: n.text,
          from: slice[0].t,
          to: slice[slice.length - 1].t,
          x1: slice[0].x,
          x2: slice[slice.length - 1].x,
          y: box.y0,
        }
      }
    }
    if (best) mainWindow = best
  }

  // ---- 观景位参考线：标签靠左，避让右侧抵达标签 ----
  let obs = null
  if (input.obsAlt != null) {
    obs = {
      alt: input.obsAlt,
      y: toY(input.obsAlt),
      label: '观景位 ' + Math.round(input.obsAlt) + 'm',
      labelX: box.x0 + 2,
      textW: textWidth('观景位 ' + Math.round(input.obsAlt) + 'm', 9),
    }
  }

  // ---- 抵达线与净空：轨迹与云顶之间的高差就是「云在脚下」的量 ----
  let arrival = null
  if (input.arriveT != null && points.length) {
    const am = lastMinuteOf(input.arriveT)
    if (am != null) {
      const lastP = points[points.length - 1]
      const ax = toX(am)
      const band = lastP && lastP.band
      const alt = lastP ? lastP.alt : null
      const clearance = (band && alt != null) ? Math.round(alt - band.top) : null
      arrival = {
        minutes: am,
        x: ax,
        labelX: ax,
        label: '抵达 ' + input.arriveT,
        alt,
        clearance,
        clearanceText: clearance != null && clearance > 0 ? '净高 ' + Math.round(clearance) + 'm' : '',
      }
    }
  }

  // ---- 播放头 ----
  let playhead = null
  if (input.scrub != null) {
    // 越界夹住（轴不再被播放头撑大）
    const m = Math.max(tMin, Math.min(tMax, input.scrub))
    const p = pointAtMinutes(points, m)
    playhead = {
      minutes: m,
      x: toX(m),
      y: p && p.alt != null ? toY(p.alt) : box.y1,
      alt: p ? p.alt : null,
      km: p ? p.km : null,
      t: hhmmOf(m),
      // past = 已过路线终点（留宿时可以是「已抵达、仍在山里」）
      past: m >= routeEnd,
    }
  }

  // 路线终点见上方 tMin/tMax 处的声明（取自最后一个节点）

  return {
    empty: false,
    box,
    scale: {
      tMin, tMax, routeEnd, aMin, aMax,
      toX, toY,
      yTicks: ticks(aMin, aMax, 4).map(v => ({ v, y: toY(v) })),
      xTicks: buildXTicks(tMin, tMax).map(v => ({ v, label: hhmmOf(v), x: toX(v) })),
    },
    points,
    terrain,
    clouds,
    segments,
    nodes,
    mainWindow,
    obs,
    arrival,
    playhead,
  }
}

function emptyBox(width) {
  return {
    w: Math.max(1, width), h: ROW_H,
    padL: PAD.l, padT: PAD.t, padR: PAD.r, padB: PAD.b,
    plotW: Math.max(1, width - PAD.l - PAD.r), plotH: ROW_H - PAD.t - PAD.b,
    x0: PAD.l, y0: PAD.t, x1: PAD.l + Math.max(1, width - PAD.l - PAD.r), y1: ROW_H - PAD.b,
  }
}

function buildXTicks(tMin, tMax) {
  const span = tMax - tMin
  const stepH = span > 600 ? 3 : span > 300 ? 2 : 1
  const out = []
  for (let h = Math.ceil(tMin / 60) * 60; h <= tMax; h += stepH * 60) out.push(h)
  return out
}

function lastMinuteOf(hhmm) {
  if (typeof hhmm !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

// 在稠密点里取某分钟（线性插值）；超界夹到端点，**不外推**
function pointAtMinutes(points, minutes) {
  if (!points.length) return null
  if (minutes <= points[0].minutes) return points[0]
  const lastP = points[points.length - 1]
  if (minutes >= lastP.minutes) return lastP
  for (let i = 1; i < points.length; i++) {
    if (minutes <= points[i].minutes) {
      const a = points[i - 1], b = points[i]
      const span = b.minutes - a.minutes
      const t = span > 0 ? (minutes - a.minutes) / span : 0
      return {
        minutes,
        alt: a.alt == null ? null : a.alt + (b.alt - a.alt) * t,
        km: a.km == null ? null : a.km + (b.km - a.km) * t,
        band: a.band,
      }
    }
  }
  return lastP
}

/**
 * 某时刻的天相与进度读数（漫游滑块用）。
 *
 * 天相是**按节点**判定的，不是按任意时刻，所以取「时刻落在哪两个节点之间」，
 * 报**较早**那个节点的结论——行进中尚未抵达下一站，说下一站的天相是误导。
 * 早于起点时同样报起点节点。
 */
function readoutAt(chart, minutes) {
  if (!chart || chart.empty || !chart.nodes.length) return null
  const p = pointAtMinutes(chart.points, minutes)
  const m = Math.max(chart.scale.tMin, Math.min(chart.scale.tMax, minutes))
  // 找最后一个 minutes <= m 的节点
  let node = chart.nodes[0]
  for (let i = 0; i < chart.nodes.length; i++) {
    if (chart.nodes[i].minutes <= m) node = chart.nodes[i]
  }
  const idx = chart.nodes.indexOf(node)
  // past = 已过路线终点。留宿时播放头停在「已抵达、仍在山里」的那一段就是 true，
  // 这不是错误状态，所以不能用它判断越界。
  const routeEnd = chart.scale.routeEnd == null
    ? (chart.points.length ? chart.points[chart.points.length - 1].minutes : 0)
    : chart.scale.routeEnd
  return {
    minutes: m,
    t: hhmmOf(m),
    alt: p ? p.alt : null,
    // 预格式化，省得 wxml 里挂 WXS 过滤器（也避免各端各写一份取整）
    altText: p && p.alt != null ? Math.round(p.alt) + ' m' : '海拔未知',
    km: p ? p.km : null,
    kmText: p && p.km != null ? p.km.toFixed(1) + ' km' : '',
    key: node.key,
    text: node.text,
    color: node.color,
    nodeIndex: idx,
    nodeCount: chart.nodes.length,
    nodeT: node.t,
    nextT: idx + 1 < chart.nodes.length ? chart.nodes[idx + 1].t : '',
    past: m >= routeEnd,
  }
}

module.exports = {
  build,
  colorOf,
  textOf,
  mixHex,
  withAlpha,
  hhmmOf,
  niceStep,
  ticks,
  pointAtMinutes,
  readoutAt,
  // textWidth 必须导出：组件层要用它判断「主窗口括号放不放得下标签」。
  // 曾漏导出导致 drawRefs 抛 "L.textWidth is not a function"——
  // 而纯几何测试测不到，因为它们只调 build()，不执行 draw()。
  textWidth,
  NO_COLOR,
  PAD,
  ROW_H,
  NODE_R,
  RIBBON_W,
  MARK_STYLE,
}
