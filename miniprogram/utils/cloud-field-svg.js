/* Cloud Field SVG renderer —— wx-free 纯函数模块（POC）
 *
 * 从 HTML prototype（docs/weather-ux/meteogram-html-prototype/meteogram.js V7）
 * 逐函数提取，数学逻辑未改：Catmull-Rom 时间插值（端点/值域双钳制）、
 * 0.25h × 50m 场网格、3×3 平滑 ×1、marching squares 等值带
 * （10/25/50/75/90%）、Chaikin 圆化、微环过滤（<12px²）、嵌套 evenodd 填充、
 * 云态推导（你在云中/云在脚下/云在头顶）。
 *
 * 环境差异（相对 prototype，本模块不依赖）：
 *   无 window / DOM / getComputedStyle / 事件——产出静态 SVG 字符串，
 *   由页面编码为 data-URI 交给 <image> 渲染（微信 WXML 无 <svg> 标签）。
 *   clipPath 保留（贴边云出血必需，SVG 1.1 基础特性）。
 *
 * 数据契约（renderer 不知道 Open-Meteo / pressure level / 地点）：
 *   field = { times: [0..n-1], altitudes: [m…], values: [time][alt] = cover 0-100 }
 *   （times/altitudes 均匀网格；本模块内任何地方不引用小时以外的时刻语义）
 */
'use strict'

var ALT0 = 2000, ALT1 = 6000
var THRESHOLDS = [
  { t: 10, c: '#eeeeea' }, { t: 25, c: '#d4d6d0' }, { t: 50, c: '#b0b2ab' },
  { t: 75, c: '#84867f' }, { t: 90, c: '#5a5c56' },
]
var IN_C = 60, SPAN_C = 70, SEA_C = 68, OVER_C = 40

/* ---------- 基础数学（与 prototype 同源） ---------- */

function smoothstep(e0, e1, x) {
  var s = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return s * s * (3 - 2 * s)
}

/* Catmull-Rom：过站点的平滑曲线；端点钳制 + 值域 [0,100] 钳制 */
function cr4(p0, p1, p2, p3, ft) {
  var v = 0.5 * ((2 * p1) + (-p0 + p2) * ft +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * ft * ft +
    (-p0 + 3 * p1 - 3 * p2 + p3) * ft * ft * ft)
  return Math.max(0, Math.min(100, v))
}

/* 场采样器：第 h 整点在海拔 alt 处的云量（层间线性，端点钳制） */
function makeColumnSampler(cf) {
  var nA = cf.altitudes.length
  var a0 = cf.altitudes[0]
  var da = (cf.altitudes[nA - 1] - a0) / (nA - 1)
  return function column(h, alt) {
    var af = Math.max(0, Math.min(nA - 1.001, (alt - a0) / da))
    var j0 = Math.floor(af), j1 = Math.min(nA - 1, j0 + 1), fa = af - j0
    var v = cf.values[h][j0] * (1 - fa) + cf.values[h][j1] * fa
    return Math.max(0, Math.min(100, v))
  }
}

/* 时间维 CR：h1 为站，h0/h2/h3 为邻站（端点复制） */
function sampleAt(column, nT, t, alt) {
  var h1 = Math.max(0, Math.min(nT - 1, Math.floor(t)))
  var ft = Math.max(0, Math.min(nT - 1, t)) - h1
  var h0 = Math.max(0, h1 - 1), h2 = Math.min(nT - 1, h1 + 1), h3 = Math.min(nT - 1, h1 + 2)
  return cr4(column(h0, alt), column(h1, alt), column(h2, alt), column(h3, alt), ft)
}

/* ---------- 场网格（0.25h × 50m + 3×3 平滑 + 外扩圈） ---------- */

function buildGrid(sample, nT, opts) {
  /* Phase 4：时间窗参数化（默认 24h，行为与历史完全一致）。
     hours = 场覆盖的小时数（24/48/72）；采样步长随窗长降密（渲染分辨率，
     内部数据不丢——sample 可在任意连续时刻求值）。CR/marching/Chaikin 数学未动。 */
  var hours = (opts && Number.isFinite(opts.hours) && opts.hours > 0) ? opts.hours : 24
  var TS = hours <= 24 ? 0.25 : 0.5, AS = 50
  var nt = Math.round(hours / TS) + 1
  var na = Math.round((ALT1 - ALT0) / AS) + 1
  var g = []
  for (var j = 0; j < na; j++) {
    var row = []
    var alt = ALT0 + j * AS
    for (var i = 0; i < nt; i++) row.push(sample(i * TS, alt))
    g.push(row)
  }
  for (var r = 0; r < 1; r++) {
    var g2 = []
    for (j = 0; j < na; j++) {
      var row2 = []
      for (i = 0; i < nt; i++) {
        var sum = 0, w = 0
        for (var dj = -1; dj <= 1; dj++) {
          for (var di = -1; di <= 1; di++) {
            var jj = j + dj, ii = i + di
            if (jj < 0 || jj >= na || ii < 0 || ii >= nt) continue
            var ww = (dj === 0 ? 2 : 1) * (di === 0 ? 2 : 1)
            sum += g[jj][ii] * ww
            w += ww
          }
        }
        row2.push(sum / w)
      }
      g2.push(row2)
    }
    g = g2
  }
  /* 外扩一圈复制边缘值：贴边云自然出血，等值环全部闭合（clip 裁掉出界段） */
  var gp = []
  for (j = 0; j < na + 2; j++) {
    var jr = Math.max(0, Math.min(na - 1, j - 1))
    var rp = []
    for (i = 0; i < nt + 2; i++) {
      var ir = Math.max(0, Math.min(nt - 1, i - 1))
      rp.push(g[jr][ir])
    }
    gp.push(rp)
  }
  return { g: gp, nx: nt + 2, ny: na + 2, t0: -TS, dt: TS, a0: ALT0 - AS, da: AS }
}

/* ---------- marching squares isoband ---------- */

function isoLoops(F, T, xOf, yOf) {
  function lerpPt(x0, y0, v0, x1, y1, v1) {
    var s = (T - v0) / (v1 - v0)
    return { x: x0 + (x1 - x0) * s, y: y0 + (y1 - y0) * s }
  }
  var segs = []
  for (var j = 0; j < F.ny - 1; j++) {
    for (var i = 0; i < F.nx - 1; i++) {
      var a = F.g[j][i], b = F.g[j][i + 1], c = F.g[j + 1][i + 1], d = F.g[j + 1][i]
      var idx = (a >= T ? 8 : 0) | (b >= T ? 4 : 0) | (c >= T ? 2 : 0) | (d >= T ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      var x0 = xOf(i), x1 = xOf(i + 1), y0 = yOf(j), y1 = yOf(j + 1)
      function topE() { return lerpPt(x0, y0, a, x1, y0, b) }
      function rightE() { return lerpPt(x1, y0, b, x1, y1, c) }
      function botE() { return lerpPt(x0, y1, d, x1, y1, c) }
      function leftE() { return lerpPt(x0, y0, a, x0, y1, d) }
      function push(p1, p2) { segs.push([p1, p2]) }
      switch (idx) {
        case 1: case 14: push(leftE(), botE()); break
        case 2: case 13: push(botE(), rightE()); break
        case 3: case 12: push(leftE(), rightE()); break
        case 4: case 11: push(topE(), rightE()); break
        case 6: case 9: push(topE(), botE()); break
        case 7: case 8: push(topE(), leftE()); break
        case 5: push(topE(), rightE()); push(botE(), leftE()); break
        case 10: push(topE(), leftE()); push(botE(), rightE()); break
      }
    }
  }
  function key(p) { return Math.round(p.x * 10) + '_' + Math.round(p.y * 10) }
  var map = {}
  segs.forEach(function (sg, id) {
    ;(map[key(sg[0])] = map[key(sg[0])] || []).push(id)
    ;(map[key(sg[1])] = map[key(sg[1])] || []).push(id)
  })
  var used = segs.map(function () { return false })
  var loops = []
  for (var si = 0; si < segs.length; si++) {
    if (used[si]) continue
    used[si] = true
    var loop = [segs[si][0], segs[si][1]]
    var guard = 0
    while (guard++ < 40000) {
      if (key(loop[loop.length - 1]) === key(loop[0])) break
      var endK = key(loop[loop.length - 1])
      var cands = (map[endK] || []).filter(function (id) { return !used[id] })
      if (!cands.length) break
      var nxt = cands[0]
      used[nxt] = true
      var pA = segs[nxt][0], pB = segs[nxt][1]
      loop.push(key(pA) === endK ? pB : pA)
    }
    if (loop.length >= 4) loops.push(loop)
  }
  /* 几何清理（P1 修复续）：碎片过滤 = 面积≥12px² 或 路径长度≥24px（满足其一即保留）。
     单用长度会误杀小而实的闭合核（90% 档 mock 核 area 13.2 / len 17.4——云顶最深色块，
     单长度阈值下整档消失）；单用面积会整层删除开链（平坦成层云的顶/底边界隐式弦与
     边界重合，鞋履面积恒≈0）。OR 规则：噪声碎片（1–2 cell，area<12 且 len<24）被滤，
     真实小核与真实云边界（数百 px）都保留。 */
  var areaOf = function (lp) {
    var s = 0
    for (var i2 = 0; i2 < lp.length; i2++) {
      var p2 = lp[i2], q2 = lp[(i2 + 1) % lp.length]
      s += p2.x * q2.y - q2.x * p2.y
    }
    return Math.abs(s / 2)
  }
  var pathLen = function (lp) {
    var s2 = 0
    for (var i2 = 0; i2 < lp.length; i2++) {
      var p2 = lp[i2], q2 = lp[(i2 + 1) % lp.length]
      s2 += Math.sqrt((p2.x - q2.x) * (p2.x - q2.x) + (p2.y - q2.y) * (p2.y - q2.y))
    }
    return s2
  }
  /* P1 修复（Cloud Field 消失）：触及时间窗边界的带状云场，其等值线是「顶边链 +
     底边链」两条开链——隐式弦与近水平边界重合 → 弦面积≈0 → 曾被微环过滤整幅删除。
     修复：开链沿网格边界按 mean-y 配对闭合（band 多边形 = 顶链 + 底链逆序），
     面积过滤恢复正确。场数学（CR/marching/阈值）未动。 */
  var openChains = [], closedChains = []
  var edgeX0 = xOf(1), edgeX1 = xOf(F.nx - 2)
  /* 边界容差必须随 cellW 缩放：开链端点落在最外 padding 列 xOf(0)/xOf(nx-1)，
     距 edgeX0/edgeX1 恰为一个 cellW。固定 2px 只在 cellW<2（窄窗/72h 细网格）下成立，
     cellW≥2（24h 全部生产宽度、414 设备 72h）时配对静默失败 → 顶/底链各留一条
     贴弦窄条，带内部空心。实测阈值恰在 cellW=2 处翻转（W=318 72h 成功 / W=336 失败）。 */
  var edgeTol = Math.max(2, (xOf(1) - xOf(0)) * 1.05)
  loops.forEach(function (lp) {
    var onEdge = function (p) { return Math.abs(p.x - edgeX0) < edgeTol || Math.abs(p.x - edgeX1) < edgeTol }
    if (onEdge(lp[0]) && onEdge(lp[lp.length - 1])) openChains.push(lp)
    else closedChains.push(lp)
  })
  if (openChains.length >= 2) {
    var meanY = function (lp) { var s2 = 0; lp.forEach(function (pt) { s2 += pt.y }); return s2 / lp.length }
    openChains.sort(function (p, q) { return meanY(q) - meanY(p) })
    for (var oi = 0; oi + 1 < openChains.length; oi += 2) {
      closedChains.push(openChains[oi].concat(openChains[oi + 1].slice().reverse()))
    }
    if (openChains.length % 2 === 1) closedChains.push(openChains[openChains.length - 1])
  } else {
    closedChains = closedChains.concat(openChains)
  }
  loops = closedChains
  loops = loops.filter(function (lp) { return areaOf(lp) >= 12 || pathLen(lp) >= 24 })
  /* Chaikin 圆化一轮 */
  return loops.map(function (loop) {
    if (loop.length < 3) return loop
    var out = []
    for (var i2 = 0; i2 < loop.length; i2++) {
      var p = loop[i2], q = loop[(i2 + 1) % loop.length]
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 })
      out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 })
    }
    return out
  })
}

/* ---------- 云态推导（全部由场采样，ELEV 任意海拔） ----------
 * coverage = { lo, hi }：真实数据覆盖的海拔范围（由适配器给出，缺省视为全轴）。
 * 用户海拔在覆盖范围之外时，该处云量为外插值不可采样——云态按「覆盖区与用户的
 * 相对位置」推导：覆盖区全在用户上方 → 云在头顶；全在下方 → 云在脚下。 */
function denseSpanAt(sample, h, lo, hi) {
  var run = null, runs = [], peak = 0
  for (var alt = Math.max(ALT0, lo); alt <= Math.min(ALT1, hi); alt += 25) {
    var v = sample(h, alt)
    if (v >= SPAN_C) {
      if (!run) run = { lo: alt, hi: alt }
      else run.hi = alt
      if (v > peak) { peak = v; run.peak = Math.round(v) }
    } else if (run) { runs.push(run); run = null }
  }
  if (run) runs.push(run)
  if (!runs.length) return null
  runs.sort(function (a, b) { return (b.peak || 0) - (a.peak || 0) })
  return runs[0]
}

function inferState(sample, h, userAlt, coverage) {
  var lo = (coverage && Number.isFinite(coverage.lo)) ? Math.max(ALT0, coverage.lo) : ALT0
  var hi = (coverage && Number.isFinite(coverage.hi)) ? Math.min(ALT1, coverage.hi) : ALT1
  var inCovered = userAlt >= lo && userAlt <= hi
  var cUser = inCovered ? Math.round(sample(h, userAlt)) : null
  if (inCovered && cUser >= IN_C) return { key: 'in', word: '你在云中', cUser: cUser, span: denseSpanAt(sample, h, lo, hi) }
  var belowPeak = 0, abovePeak = 0
  var belowHi = Math.min(userAlt - 200, hi)
  if (belowHi > lo) {
    for (var alt = lo; alt <= belowHi; alt += 100) belowPeak = Math.max(belowPeak, sample(h, alt))
  }
  if (belowPeak >= SEA_C && (!inCovered || cUser < 45)) return { key: 'ok', word: '云在脚下', cUser: cUser, span: denseSpanAt(sample, h, lo, hi) }
  var aboveLo = Math.max(lo, userAlt + 200)
  if (aboveLo <= hi) {
    for (alt = aboveLo; alt <= hi; alt += 100) abovePeak = Math.max(abovePeak, sample(h, alt))
  }
  if (abovePeak >= OVER_C && (!inCovered || cUser < 45)) return { key: 'mid', word: '头顶有云层', cUser: cUser, span: denseSpanAt(sample, h, lo, hi) }
  return { key: null, word: '', cUser: cUser, span: denseSpanAt(sample, h, lo, hi) }
}

/* ---------- 几何构建（昂贵，按数据集缓存） ---------- */

function buildGeometry(cf, opts) {
  opts = opts || {}
  var width = opts.width || 375
  var plotH = opts.plotHeight || 300
  var L = 38, R = 10
  var plotW = width - L - R
  var t0ms = Date.now()

  var column = makeColumnSampler(cf)
  var nT = cf.times.length
  var sample = function (t, alt) { return sampleAt(column, nT, t, alt) }
  var F = buildGrid(sample, nT)

  var top = 0, plotBot = plotH
  var xOf = function (i) { return L + ((F.t0 + i * F.dt) / 24) * plotW }
  var yOf = function (j) { return plotBot - (F.a0 + j * F.da - ALT0) / (ALT1 - ALT0) * plotH }

  var isoMs0 = Date.now()
  var bands = []
  var pathCount = 0, pointCount = 0
  THRESHOLDS.forEach(function (bd) {
    var loops = isoLoops(F, bd.t, xOf, yOf)
    var d = ''
    loops.forEach(function (lp) {
      d += 'M' + lp.map(function (pt) { return pt.x.toFixed(1) + ',' + pt.y.toFixed(1) }).join('L') + 'Z'
      pointCount += lp.length
    })
    if (d) { bands.push({ d: d, fill: bd.c }); pathCount++ }
  })
  var isoMs = Date.now() - isoMs0

  /* 入云时段（field(t,userAlt) ≥ IN_C 的连续段）→ 海拔线上琥珀交线 */
  var userAlt = opts.userAltitude != null ? opts.userAltitude : 3500
  var inRuns = []
  HOURS_SCAN(nT, function (h) {
    return sample(h, Math.max(ALT0, Math.min(ALT1, userAlt))) >= IN_C
  }, inRuns)

  var stats = {
    gridMs: Date.now() - t0ms - isoMs,
    isoMs: isoMs,
    calcMs: Date.now() - t0ms,
    pathCount: pathCount,
    pointCount: pointCount,
    loops: bands.length,
  }
  return {
    cf: cf, width: width, plotH: plotH, L: L, R: R, plotW: plotW,
    plotTop: top, plotBot: plotBot,
    xOf: xOf, yOf: yOf, sample: sample,
    userAlt: userAlt, inRuns: inRuns,
    covered: cf.covered || null,
    bands: bands, stats: stats,
  }
}

/* 按小时扫描连续段（inRuns 用） */
function HOURS_SCAN(nT, pred, out) {
  var run = null
  for (var h = 0; h < nT; h++) {
    if (pred(h)) {
      if (run && run.to === h - 1) run.to = h
      else { if (run) out.push(run); run = { from: h, to: h } }
    } else if (run) { out.push(run); run = null }
  }
  if (run) out.push(run)
  return out
}

/* ---------- SVG 生成 ---------- */

var SVGNS = 'xmlns="http://www.w3.org/2000/svg"'

function fmt(v) { return v.toFixed(1) }

/* 基础层：昼夜底 + 网格 + 等值带 + 海拔线 + 入云交线（+可选采样点）。
 * 昼夜底需要 opts.sunrise/sunset（小时数，可省略=无昼夜底）。 */
function renderBaseSvg(geo, opts) {
  opts = opts || {}
  var w = geo.width, h0 = 14 + 9, plotH = geo.plotH
  var H = h0 + plotH + 18
  var t0 = Date.now()
  var s = '<svg ' + SVGNS + ' width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H + '">'
  s += '<rect x="0" y="0" width="' + w + '" height="' + H + '" fill="#ffffff"/>'

  /* 昼夜底（可选） */
  if (opts.sunrise != null && opts.sunset != null) {
    var gid = 'dn'
    function off(h) { return (h / 24).toFixed(4) }
    var night = '#eff2f7'
    s += '<defs><linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="' + geo.L + '" y1="0" x2="' + (geo.L + geo.plotW) + '" y2="0">' +
      '<stop offset="0" stop-color="' + night + '"/>' +
      '<stop offset="' + off(opts.sunrise - 0.85) + '" stop-color="' + night + '"/>' +
      '<stop offset="' + off(opts.sunrise + 0.25) + '" stop-color="#ffffff"/>' +
      '<stop offset="' + off(opts.sunset - 0.25) + '" stop-color="#ffffff"/>' +
      '<stop offset="' + off(opts.sunset + 0.85) + '" stop-color="' + night + '"/>' +
      '<stop offset="1" stop-color="' + night + '"/>' +
      '</linearGradient></defs>'
    s += '<rect x="' + geo.L + '" y="' + geo.plotTop + '" width="' + geo.plotW + '" height="' + plotH + '" fill="url(#' + gid + ')"/>'
  }

  /* 网格与框 */
  var vGrid = ''
  for (var h2 = 0; h2 < 24; h2 += 2) {
    vGrid += '<line x1="' + fmt(geo.X(h2)) + '" y1="' + geo.plotTop + '" x2="' + fmt(geo.X(h2)) + '" y2="' + (geo.plotTop + plotH) + '"/>'
  }
  s += '<g stroke="#e9eae4" stroke-width="0.6">' + vGrid + '</g>'
  var hg = ''
  ;[3000, 4000, 5000].forEach(function (a) {
    var y = geo.yAlt(a)
    hg += '<line x1="' + geo.L + '" y1="' + fmt(y) + '" x2="' + (geo.L + geo.plotW) + '" y2="' + fmt(y) + '"/>'
  })
  s += '<g stroke="#e9eae4" stroke-width="0.6">' + hg + '</g>'
  s += '<rect x="' + geo.L + '" y="' + geo.plotTop + '" width="' + geo.plotW + '" height="' + plotH + '" fill="none" stroke="#d3d5cd" stroke-width="0.8"/>'

  /* 等值带（clip 裁掉外扩圈出血） */
  var clipId = 'cfclip'
  s += '<defs><clipPath id="' + clipId + '"><rect x="' + geo.L + '" y="' + geo.plotTop + '" width="' + geo.plotW + '" height="' + plotH + '"/></clipPath></defs>'
  var bands = ''
  geo.bands.forEach(function (b) {
    bands += '<path d="' + b.d + '" fill="' + b.fill + '" fill-rule="evenodd"/>'
  })
  s += '<g clip-path="url(#' + clipId + ')">' + bands + '</g>'

  /* 海拔参考线与刻度 */
  var youY = geo.yAlt(Math.max(ALT0, Math.min(ALT1, geo.userAlt)))
  var youTag = geo.userAlt < ALT0 ? '（剖面下方）' : geo.userAlt > ALT1 ? '（剖面上方）' : ''
  s += '<line x1="' + geo.L + '" y1="' + fmt(youY) + '" x2="' + (geo.L + geo.plotW) + '" y2="' + fmt(youY) + '" stroke="#163e35" stroke-width="1" stroke-dasharray="4 3"/>'
  geo.inRuns.forEach(function (r) {
    var xA = geo.x0(r.from), xB = geo.x0(r.to + 1)
    s += '<line x1="' + fmt(xA) + '" y1="' + fmt(youY) + '" x2="' + fmt(xB) + '" y2="' + fmt(youY) + '" stroke="rgba(180,118,26,0.65)" stroke-width="2.5" stroke-linecap="round"/>'
  })
  s += '<text x="' + (geo.L + geo.plotW - 4) + '" y="' + fmt(youY - 4) + '" text-anchor="end" font-size="7.5" font-weight="600" fill="#163e35" stroke="#fff" stroke-width="2.5" paint-order="stroke">你 · ' + geo.userAlt.toLocaleString('en-US') + ' m' + youTag + '</text>'
  ;[2000, 3000, 4000, 5000].forEach(function (a) {
    s += '<text x="' + (geo.L - 5) + '" y="' + fmt(geo.yAlt(a) + 2.5) + '" text-anchor="end" font-size="7.5" fill="#8a8f8a">' + a + '</text>'
  })
  s += '<text x="' + (geo.L - 5) + '" y="' + fmt(geo.yAlt(6000) + 2.5) + '" text-anchor="end" font-size="7.5" fill="#8a8f8a">6000 m</text>'

  /* 时间轴 */
  var axis = ''
  for (h2 = 0; h2 < 24; h2 += 2) {
    axis += '<text x="' + fmt(geo.X(h2)) + '" y="' + (geo.plotTop + plotH + 13) + '" text-anchor="middle" font-size="8" fill="#8a8f8a">' + ('0' + h2).slice(-2) + '</text>'
  }
  s += '<g>' + axis + '</g>'
  if (opts.dateLabel) {
    s += '<text x="' + (geo.L + geo.plotW / 2) + '" y="10" text-anchor="middle" font-size="9" font-weight="600" fill="#545954" letter-spacing="0.08em">' + opts.dateLabel + '</text>'
  }
  if (opts.debugSamples && opts.debugSamples.length) {
    var dots = ''
    opts.debugSamples.forEach(function (sp) {
      if (sp.alt < ALT0 - 150 || sp.alt > ALT1 + 150) return
      dots += '<circle cx="' + fmt(geo.X(sp.t)) + '" cy="' + fmt(geo.yAlt(Math.max(ALT0, Math.min(ALT1, sp.alt)))) + '" r="1.8" fill="#fff" fill-opacity="0.85" stroke="#163e35" stroke-width="0.7"/>'
    })
    s += '<g clip-path="url(#' + clipId + ')">' + dots + '</g>'
    s += '<text x="' + (geo.L + 4) + '" y="' + (geo.plotTop + 10) + '" font-size="7" fill="#163e35" stroke="#fff" stroke-width="2" paint-order="stroke">○ 原始采样点</text>'
  }
  var svg = s + '</svg>'
  return { svg: svg, svgMs: Date.now() - t0, height: H }
}

/* 选中层：极轻列洗 + 细线 + 底部时间牌（小 svg，切换只重生成这一层） */
function renderSelectionSvg(geo, opts) {
  var sel = opts.selectedTime
  if (sel == null) return { svg: '', svgMs: 0, height: geo.heightOf() }
  var w = geo.width, h0 = 14 + 9, plotH = geo.plotH
  var H = h0 + plotH + 18
  var t0 = Date.now()
  var sx = geo.X(sel)
  var s = '<svg ' + SVGNS + ' width="' + w + '" height="' + H + '" viewBox="0 0 ' + w + ' ' + H + '">'
  s += '<rect x="0" y="0" width="' + w + '" height="' + H + '" fill="none"/>'
  s += '<rect x="' + fmt(geo.x0(sel)) + '" y="' + geo.plotTop + '" width="' + fmt(geo.plotW / 24) + '" height="' + plotH + '" fill="rgba(22,62,53,0.035)"/>'
  s += '<line x1="' + fmt(sx) + '" y1="' + (geo.plotTop - 2) + '" x2="' + fmt(sx) + '" y2="' + (geo.plotTop + plotH + 4) + '" stroke="#163e35" stroke-width="0.5" opacity="0.4"/>'
  s += '<rect x="' + fmt(sx - 11) + '" y="' + (geo.plotTop + plotH + 6) + '" width="22" height="11" rx="2" fill="#163e35"/>'
  s += '<text x="' + fmt(sx) + '" y="' + (geo.plotTop + plotH + 13.5) + '" text-anchor="middle" font-size="7" font-weight="600" fill="#fff">' + ('0' + sel).slice(-2) + ':00</text>'
  var svg = s + '</svg>'
  return { svg: svg, svgMs: Date.now() - t0, height: H }
}

/* ---------- 顶层便捷封装 ---------- */

function enrich(geo) {
  geo.X = function (h) { return geo.L + (h + 0.5) * (geo.plotW / 24) }
  geo.x0 = function (h) { return geo.L + h * (geo.plotW / 24) }
  geo.yAlt = function (a) { return geo.plotBot - (a - ALT0) / (ALT1 - ALT0) * geo.plotH }
  geo.heightOf = function () { return 14 + 9 + geo.plotH + 18 }
  return geo
}

module.exports = {
  buildGeometry: function (cf, opts) { return enrich(buildGeometry(cf, opts)) },
  renderBaseSvg: renderBaseSvg,
  renderSelectionSvg: renderSelectionSvg,
  inferState: inferState,
  sampleAt: function (geo, t, alt) { return geo.sample(t, alt) },
  /* --- 供统一 Meteogram（utils/meteogram-svg.js）复用的冻结场数学 ---
     只导出，不修改：CR 采样 / 场网格 / 等值带 / 云态推导与阈值。 */
  makeColumnSampler: makeColumnSampler,
  sampleAtStations: sampleAt,
  cr4: cr4,
  buildFieldGrid: buildGrid,
  isoBandsFromGrid: isoLoops,
  ALT0: ALT0,
  ALT1: ALT1,
  BINS: THRESHOLDS,
  denseSpanAt: denseSpanAt,
}
