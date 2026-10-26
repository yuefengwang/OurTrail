// 路线海拔剖面（纯函数，wx-free）
//
// 三种状态，绝不互相冒充：
//   continuous = 轨迹采样点带连续高程（TrackPoint.ele）
//   nodes      = 只有命名路线节点的高程（点与点之间是直线，不是地形）
//   empty      = 没有足够高程，说明缺什么，不画曲线
//
// 这里只做几何与 SVG，不含任何业务阈值；颜色是 canvas/SVG 字面量，
// 改色必须同步 app.wxss 的 --forest/--muted（与图表色板同一条规矩）。
'use strict'

const gpx = require('./gpx')

// 按手机卡片的实际宽度绘制。之前用 660 宽再缩到 ~350px，
// 10px 的坐标标签实际只有 ~5px（真机截图证实不可读）；viewBox 与显示宽度同量级才清楚。
// 280 宽是按 306px 模拟器也测过的下限：卡片内宽约 250px 时，11px 标签仍有约 10px。
const W = 280
const H = 160
const PAD = { l: 36, r: 10, t: 14, b: 22 }
const FOREST = '#163E35'
const MUTED = '#5F6E66'
const GRID = '#DEE3DB'

function finite(v) { return Number.isFinite(v) }

function fmtM(v) {
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtKm(v) {
  return (Math.round(v * 10) / 10).toFixed(1)
}

function coordPoints(list) {
  return (list || []).filter(p => p && finite(p.lat) && finite(p.lng))
}

// 轨迹累计里程：用全部轨迹点算距离，缺 ele 的点只跳过、不改变后续点的 x 位置。
function trackSamples(track) {
  const pts = coordPoints(track)
  const cumulative = [0]
  for (let i = 1; i < pts.length; i++) {
    cumulative.push(cumulative[i - 1] + gpx.haversineKm(pts[i - 1], pts[i]))
  }
  const runs = []
  let run = []
  let hasEle = false
  for (let i = 0; i < pts.length; i++) {
    if (finite(pts[i].ele)) {
      hasEle = true
      run.push({ d: cumulative[i], ele: pts[i].ele })
    } else if (run.length) {
      runs.push(run)
      run = []
    }
  }
  if (run.length) runs.push(run)
  return {
    runs: runs.filter(r => r.length >= 2),
    total: cumulative[cumulative.length - 1] || 0,
    hasEle,
  }
}

// 节点剖面：节点顺序即经过顺序，距离是节点间直线距离（不是轨迹里程）。
function nodeSamples(points) {
  const pts = (points || []).filter(p => p && p.coordinates && finite(p.ele))
  if (pts.length < 2) return { runs: [], total: 0 }
  let d = 0
  const out = [{ d: 0, ele: pts[0].ele }]
  for (let i = 1; i < pts.length; i++) {
    d += gpx.haversineKm(pts[i - 1].coordinates, pts[i].coordinates)
    out.push({ d, ele: pts[i].ele })
  }
  return { runs: [out], total: d }
}

function collectSamples(runs) {
  const all = []
  for (const run of runs) for (const s of run) all.push(s)
  return all
}

function rangeOf(all) {
  return {
    minEle: Math.round(Math.min.apply(null, all.map(s => s.ele))),
    maxEle: Math.round(Math.max.apply(null, all.map(s => s.ele))),
    pointCount: all.length,
  }
}

function renderRuns(runs, mode, fullDistance) {
  const all = collectSamples(runs)
  if (!all.length) return null
  const actualMin = Math.min.apply(null, all.map(s => s.ele))
  const actualMax = Math.max.apply(null, all.map(s => s.ele))
  let min = actualMin
  let max = actualMax
  // 全平线也要有可读的 y 轴范围；只在中间标真实值，避免把「显示窗」印成海拔事实。
  const flat = max - min < 1
  if (flat) { min = actualMin - 5; max = actualMax + 5 }
  const total = Math.max(finite(fullDistance) ? fullDistance : all[all.length - 1].d, 0.001)
  const x = d => PAD.l + (d / total) * (W - PAD.l - PAD.r)
  const y = ele => PAD.t + ((max - ele) / (max - min)) * (H - PAD.t - PAD.b)
  const pt = s => x(s.d).toFixed(1) + ',' + y(s.ele).toFixed(1)

  const grid = [0, 0.5, 1].map(t => {
    const yy = PAD.t + t * (H - PAD.t - PAD.b)
    const val = max - t * (max - min)
    const label = flat ? (t === 0.5 ? fmtM(actualMin) : '') : fmtM(val)
    return '<line x1="' + PAD.l + '" y1="' + yy.toFixed(1) + '" x2="' + (W - PAD.r) + '" y2="' + yy.toFixed(1) + '" stroke="' + GRID + '" stroke-width="1"/>'
      + (label ? '<text x="' + (PAD.l - 6) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + MUTED + '">' + label + '</text>' : '')
  }).join('')

  const body = runs.map(run => {
    const d = run.map((s, i) => (i ? 'L' : 'M') + pt(s)).join(' ')
    if (mode === 'nodes') {
      const dots = run.map(s => '<circle cx="' + x(s.d).toFixed(1) + '" cy="' + y(s.ele).toFixed(1) + '" r="3" fill="' + FOREST + '"/>').join('')
      return '<path d="' + d + '" fill="none" stroke="' + FOREST + '" stroke-width="2.6" stroke-linejoin="round"/>' + dots
    }
    const bottom = (H - PAD.b).toFixed(1)
    const area = d + ' L' + x(run[run.length - 1].d).toFixed(1) + ',' + bottom + ' L' + x(run[0].d).toFixed(1) + ',' + bottom + ' Z'
    return '<path d="' + area + '" fill="rgba(22,62,53,0.12)" stroke="none"/>'
      + '<path d="' + d + '" fill="none" stroke="' + FOREST + '" stroke-width="2.6" stroke-linejoin="round"/>'
  }).join('')

  const axis = '<text x="' + PAD.l + '" y="' + (H - 8) + '" font-size="11" fill="' + MUTED + '">0 km</text>'
    + '<text x="' + (W - PAD.r) + '" y="' + (H - 8) + '" text-anchor="end" font-size="11" fill="' + MUTED + '">' + fmtKm(total) + ' km</text>'

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">'
    + grid + body + axis + '</svg>'

  return {
    svg,
    minEle: Math.round(actualMin),
    maxEle: Math.round(actualMax),
    distanceKm: Math.round(total * 10) / 10,
    pointCount: all.length,
  }
}

/**
 * @param {object} input { track, points }
 * @returns {{
 *   mode: 'continuous'|'nodes'|'empty',
 *   reason: string,
 *   svg: string,
 *   minEle: number|null, maxEle: number|null, distanceKm: number|null, pointCount: number,
 *   distanceLabel: string
 * }}
 */
function buildProfile(input) {
  const track = (input && input.track) || []
  const points = (input && input.points) || []
  const trackData = trackSamples(track)
  if (trackData.runs.length) {
    const r = renderRuns(trackData.runs, 'continuous', trackData.total)
    if (r) return Object.assign({ mode: 'continuous', reason: '', distanceLabel: '轨迹里程' }, r)
  }
  const nodeData = nodeSamples(points)
  if (nodeData.runs.length) {
    const r = renderRuns(nodeData.runs, 'nodes', nodeData.total)
    if (r) {
      return Object.assign({
        mode: 'nodes',
        reason: trackData.hasEle ? '轨迹高程不连续' : '轨迹没有高程',
        distanceLabel: '节点间直线距离',
      }, r)
    }
  }
  const hasCoords = (points || []).some(p => p && p.coordinates)
  const hasAnyEle = (track || []).some(p => finite(p.ele)) || (points || []).some(p => finite(p.ele))
  return {
    mode: 'empty',
    reason: hasAnyEle ? 'not-enough-points' : (hasCoords ? 'no-elevation' : 'no-geometry'),
    svg: '',
    minEle: null,
    maxEle: null,
    distanceKm: null,
    pointCount: 0,
    distanceLabel: '',
  }
}

/**
 * 只要真实高程范围，不画图：与 buildProfile 同一优先级（轨迹 → 节点），
 * 因此数字与剖面图同源，不会出现「图上 4,660 / 卡片 4,655」。
 * @param {object} input { track, points }
 * @returns {{ source: 'track'|'nodes'|'none', minEle: number|null, maxEle: number|null, pointCount: number }}
 */
function elevationRange(input) {
  const track = (input && input.track) || []
  const points = (input && input.points) || []
  const trackData = trackSamples(track)
  if (trackData.runs.length) {
    return Object.assign({ source: 'track' }, rangeOf(collectSamples(trackData.runs)))
  }
  const nodeData = nodeSamples(points)
  if (nodeData.runs.length) {
    const all = collectSamples(nodeData.runs)
    // 节点剖面只要 ≥2 个带高程的节点就成立（nodeSamples 已保证），与 buildProfile 同判。
    return Object.assign({ source: 'nodes' }, rangeOf(all))
  }
  return { source: 'none', minEle: null, maxEle: null, pointCount: 0 }
}

module.exports = { buildProfile, elevationRange, W, H }
