/* Cloud Field SVG renderer —— wx-free 纯函数模块（POC）
 *
 * 从 HTML prototype（docs/weather-ux/meteogram-html-prototype/meteogram.js V7）
 * 逐函数提取，数学逻辑未改：Catmull-Rom 时间插值（端点/值域双钳制）、
 * 0.25h × 50m 场网格、3×3 平滑 ×1、marching squares 等值带
 * （10/25/50/75/90%）、Chaikin 圆化、微环过滤（<12px²）、嵌套 evenodd 填充、
 * 云层位置三态推导（此点云中 / 云在下方 / 云在上方 + 未知原因，见 inferState）。
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

var F = require('./format.js')

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
  /* 显示窗由 planProfile 给出；没给就是历史固定窗（逐字节同旧行为）。
     边界一定落在 QUANT(250m) 的整数倍上 ⇒ na 恒为整数，网格不会因窗而少一格。 */
  var lo = (opts && Number.isFinite(opts.altLo)) ? opts.altLo : ALT0
  var hi = (opts && Number.isFinite(opts.altHi) && opts.altHi > lo) ? opts.altHi : (lo === ALT0 ? ALT1 : lo + (ALT1 - ALT0))
  var TS = hours <= 24 ? 0.25 : 0.5, AS = 50
  var nt = Math.round(hours / TS) + 1
  var na = Math.round((hi - lo) / AS) + 1
  var g = []
  for (var j = 0; j < na; j++) {
    var row = []
    var alt = lo + j * AS
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
  /* 外扩一圈填 0（低于所有阈值），不再复制边缘值。
     复制边缘值时，贴边的云带在整个网格内永远找不到「降到阈值以下」的地方 ⇒ 等值线闭不上环，
     旧实现只能在事后「按 mean-y 把开链两两配对 + 用 SVG 的 Z 把首尾直连」凑出多边形。
     2026-10-09 用真实气压层剖面（成都/峨眉山/理塘，168h×22 层）实测到这条路的后果：
     49 条断链、15 个自交环（evenodd 把真云区挖成洞）、32 条 >30px 的直线斜边（最长 371px，
     横贯整张图）、1 个把 x 重叠仅 2% 的两条链连成的 12688px² 假云块。
     填 0 之后每条环都在格外那一格内自然闭合，而那一格在 clipPath 之外
     （垂直方向 3.75px、时间方向 ~0.84px），看到的仍是「云带冲出图外」的平切边——
     视觉不变，拓扑不再依赖任何启发式配对。 */
  var gp = []
  for (j = 0; j < na + 2; j++) {
    var jr = Math.max(0, Math.min(na - 1, j - 1))
    var rp = []
    for (i = 0; i < nt + 2; i++) {
      var ir = Math.max(0, Math.min(nt - 1, i - 1))
      var onRing = (j === 0 || j === na + 1 || i === 0 || i === nt + 1)
      rp.push(onRing ? 0 : g[jr][ir])
    }
    gp.push(rp)
  }
  return { g: gp, nx: nt + 2, ny: na + 2, t0: -TS, dt: TS, a0: lo - AS, da: AS, altLo: lo, altHi: hi }
}

/* ---------- marching squares isoband（按网格边身份链接，不做坐标量化） ----------
 * 交叉点的唯一身份是它跨过的那条网格边（'h'/v' + 左端点索引），不是四舍五入后的坐标：
 * 一条边上至多一个交叉点，而这条边恰好被两个 cell 共用 ⇒ 每个交叉点的度数恒等于 2，
 * 走线不存在「任取一条未用线段」的岔口。旧实现用 0.1px 坐标键，两个不同的捏合点可能
 * 被并进同一个键（度数变 4）从而走错弯，实测产生自交环，evenodd 又把真云区挖成洞。
 * 鞍点（idx 5/10）按 cell 中心值定连接方向，不再固定偏好一种解释。 */
function isoLoops (F, T, xOf, yOf) {
  var pts = {}   // 边键 → 交叉点（同一条边的两个 cell 取到同一个键、同一个坐标）
  var adj = {}   // 边键 → 对端边键列表（每个键恰好 2 个）
  function mix (x0, y0, v0, x1, y1, v1) {
    var s = (v1 === v0) ? 0.5 : (T - v0) / (v1 - v0)
    return { x: x0 + (x1 - x0) * s, y: y0 + (y1 - y0) * s }
  }
  function link (ka, kb) {
    if (!adj[ka]) adj[ka] = []
    if (!adj[kb]) adj[kb] = []
    adj[ka].push(kb); adj[kb].push(ka)
  }
  for (var j = 0; j < F.ny - 1; j++) {
    for (var i = 0; i < F.nx - 1; i++) {
      var a = F.g[j][i], b = F.g[j][i + 1], c = F.g[j + 1][i + 1], d = F.g[j + 1][i]
      var idx = (a >= T ? 8 : 0) | (b >= T ? 4 : 0) | (c >= T ? 2 : 0) | (d >= T ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      var x0 = xOf(i), x1 = xOf(i + 1), y0 = yOf(j), y1 = yOf(j + 1)
      var eT = 'h' + j + '_' + i, eB = 'h' + (j + 1) + '_' + i
      var eL = 'v' + j + '_' + i, eR = 'v' + j + '_' + (i + 1)
      pts[eT] = mix(x0, y0, a, x1, y0, b)
      pts[eB] = mix(x0, y1, d, x1, y1, c)
      pts[eL] = mix(x0, y0, a, x0, y1, d)
      pts[eR] = mix(x1, y0, b, x1, y1, c)
      var pairs
      switch (idx) {
        case 1: case 14: pairs = [[eL, eB]]; break
        case 2: case 13: pairs = [[eB, eR]]; break
        case 3: case 12: pairs = [[eL, eR]]; break
        case 4: case 11: pairs = [[eT, eR]]; break
        case 6: case 9: pairs = [[eT, eB]]; break
        case 7: case 8: pairs = [[eT, eL]]; break
        /* 高角在 b(TR)/d(BL)：中心也高 ⇒ 高区成对角带，切出的是低角 a、c */
        case 5: pairs = (a + b + c + d) / 4 >= T ? [[eT, eL], [eB, eR]] : [[eT, eR], [eB, eL]]; break
        /* 高角在 a(TL)/c(BR)：中心高 ⇒ 对角带切出低角 b、d */
        case 10: pairs = (a + b + c + d) / 4 >= T ? [[eT, eR], [eB, eL]] : [[eT, eL], [eB, eR]]; break
        default: pairs = []
      }
      for (var pi = 0; pi < pairs.length; pi++) link(pairs[pi][0], pairs[pi][1])
    }
  }
  var linkId = function (ka, kb) { return ka < kb ? ka + '|' + kb : kb + '|' + ka }
  var used = {}
  var raw = []
  Object.keys(pts).forEach(function (k0) {
    var list = adj[k0] || []
    for (var n = 0; n < list.length; n++) {
      if (used[linkId(k0, list[n])]) continue
      var lp = [], cur = k0, guard = 0, closed = false
      while (guard++ < 200000) {
        lp.push(pts[cur])
        var cands = (adj[cur] || []).filter(function (nb) { return !used[linkId(cur, nb)] })
        if (!cands.length) break
        var nxt = cands[0]
        used[linkId(cur, nxt)] = true
        cur = nxt
        if (cur === k0) { closed = true; break }
      }
      if (lp.length >= 3) { lp.__truncated = !closed; raw.push(lp) }
    }
  })
  /* 碎片过滤只看面积，并且下限随 cell 尺寸缩放：
     一条只有一个 cell 厚的真实云带，面积≈cellW×cellH，所以 0.6×cellArea 以下必然是
     噪声；旧的「或 路径长度≥24px」是当年开链面积为 0 时留的逃生门，它同时放进了
     面积 1–20px² 的针状碎片（真实数据里 7 枚），环闭合之后这扇门不再需要。 */
  var cellArea = Math.abs((xOf(1) - xOf(0)) * (yOf(1) - yOf(0)))
  var AREA_MIN = Math.max(12, cellArea * 0.6)
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
  var kept = []
  raw.forEach(function (lp) {
    var ar = areaOf(lp)
    if (ar < AREA_MIN) return
    /* __diag：只读探针（渲染只看点序），几何回归门用它断言「每条环都自然闭合」 */
    lp.__diag = { area: Math.round(ar), len: Math.round(pathLen(lp)), truncated: !!lp.__truncated }
    kept.push(lp)
  })
  /* Chaikin 圆化一轮 */
  return kept.map(function (loop) {
    if (loop.length < 3) return loop
    var out = []
    for (var i2 = 0; i2 < loop.length; i2++) {
      var p = loop[i2], q = loop[(i2 + 1) % loop.length]
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 })
      out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 })
    }
    if (loop.__diag) out.__diag = loop.__diag
    return out
  })
}

/* ---------- 云层位置三态判定（唯一出口，页面与 OI 都只读结论） ----------
 *
 * 三个**互斥、各自可造反例**的确定态。key 沿用线上既有取值（'in'/'ok'/'mid'）——
 * 它们同时是 CSS 类名与账本字段，换 key 的爆炸半径远大于收益，故只统一词、不统一键：
 *   in   此点正处于云中：查询点自己的海拔落在浓云里
 *   ok   云带在此点下方：浓云只在此点之下
 *   mid  云层在此点上方：浓云只在此点之上
 * 其余一律是「没有结论」，并回一个可核对的 reason（不与三态混列）：
 *   no-altitude         没有可信海拔（elevation=null，或 basis='none'）
 *   no-data             没有实测海拔包络（cloudLevels 缺失 → covered=null）——
 *                       「无测量」绝不写成「晴空」
 *   within-uncertainty  云顶/云底与此点的高差落在海拔误差带内，方向判不出来
 *   both-sides          此点上下都有浓云，不属于「某一个位置」——此时三态的 word 不给，
 *                       但 holds 仍如实带出 ['ok','mid']，下游按侧取用
 *   partial-at-point    此点自身有中等云量：既谈不上入云，也不算判定成功
 *   clear               实测包络内没有有意义云量（这是否定式事实，不是缺证据）
 *
 * 文案不在这里（铁律 22）：word/reasonText 从 format.js 的表里查，判定与显示分层。
 * 主语永远是**查询点**（选点 / 手填坐标 / 路线节点各自的 ele），不是「你」——
 * 本项目没有任何定位来源，永远不知道用户本人站在哪儿。
 *
 * coverage = { lo, hi }：真实数据覆盖的海拔范围（由适配器给出）。
 * 判读范围取**实测数据范围**，不取剖面显示窗（ALT0/ALT1）：
 * 显示窗是「这张图画哪一段」，判读是「云在哪儿」。把两者混在一起时，
 * 一整层位于 1500–1900m 的浓云对 4058m 的此点就是「云带在此点下方」，
 * 但因为全部落在 ALT0=2000 以下，旧实现会答成「无结论」。
 * 适配器已把实测范围之外置 0，所以按 covered 取值不会读到外插值。
 *
 * opts.basis（由 format.resolveElev 的出处判定给出，页面不再自己分类）：
 *   'measured'  点自带高程（GPX / 地图选点 / 手填）
 *   'estimated' Open-Meteo 地形模型高度（±300–600 m）——落在误差带内的高差不判
 *   'none'      没有可信海拔
 * 未显式给 basis 的调用按 'measured'（tol=0，判据与旧实现逐字一致）。
 * ⚠ 边界如实记录：GPX/选点/手填三条来源本项目都没有可量化的误差资料，
 *   只能按「点自己的高程」处理；误差带只对模型地形这一个来源生效。 */
var SCAN_MIN = 0, SCAN_MAX = 7000
var EDGE_GUARD = 200            // 与此点至少隔 200m 才算「在一侧」
var MODERATE_AT_POINT = 45      // 点上有中等云量时不判上下（旧实现的 cUser<45 守卫，语义保留）
var ALT_TOL = { measured: 0, estimated: 600, none: Infinity }
function denseSpanAt(sample, h, lo, hi) {
  var run = null, runs = [], peak = 0
  for (var alt = Math.max(SCAN_MIN, lo); alt <= Math.min(SCAN_MAX, hi); alt += 25) {
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

function inferState(sample, h, userAlt, coverage, opts) {
  var asked = opts && opts.basis
  var basis = (asked === 'measured' || asked === 'estimated' || asked === 'none')
    ? asked : (Number.isFinite(userAlt) ? 'measured' : 'none')
  var span = null, cUser = null
  /* holds = 三态里「单独成立」的那些。key 只有一个（或没有）——那是给读数行的
     单一位置结论；但「脚下有云带」与「头顶也有云带」在物理上可以同时为真，
     下游（云海必要条件、夜间天空一致性闸）要读的是 holds，不是被压扁后的那一个词。 */
  function pack (key, reason, holds) {
    return {
      key: key, word: F.cloudPositionLabel(key),
      reason: reason || null, reasonText: F.cloudPositionReason(reason),
      holds: holds, cUser: cUser, span: span,
    }
  }
  function state (key) { return pack(key, null, [key]) }
  function unknown (reason, holds) { return pack(null, reason, holds || []) }
  var covOk = !!(coverage && Number.isFinite(coverage.lo) && Number.isFinite(coverage.hi) && coverage.hi > coverage.lo)
  if (!covOk) return unknown('no-data')
  var lo = Math.max(SCAN_MIN, coverage.lo)
  var hi = Math.min(SCAN_MAX, coverage.hi)
  var tol = ALT_TOL[basis]
  /* 没有可信海拔 ⇒ 凡涉及「此点」的位置关系一概不判；但云带本身是事实，
     实测包络有效就照常带出 span，否则「不知道这儿有多高」会把这一小时
     有用的云区数字一起带走（三层边界：事实层不随解释层弃权）。 */
  span = denseSpanAt(sample, h, lo, hi)
  if (basis === 'none' || !Number.isFinite(userAlt)) return unknown('no-altitude')
  if (userAlt >= lo && userAlt <= hi) cUser = Math.round(sample(h, userAlt))

  /* 误差带内的最值：basis='measured' 时 tol=0，带塌成查询点这一个高度，
     判据与旧实现（只看 cUser）逐字一致；'estimated' 时带是 ±600m。 */
  var bLo = Math.max(lo, userAlt - tol), bHi = Math.min(hi, userAlt + tol)
  var bandPeak = 0, bandFloor = 100
  for (var alt = bLo; alt <= bHi; alt += 25) {
    var v = sample(h, alt)
    if (v > bandPeak) bandPeak = v
    if (v < bandFloor) bandFloor = v
  }
  if (cUser != null) { bandPeak = Math.max(bandPeak, cUser); bandFloor = Math.min(bandFloor, cUser) }
  if (cUser != null && cUser >= IN_C) {
    /* 此点自身就在浓云里。误差带处处浓 → 真实海拔落在带内哪一处都在云中；
       带内有薄区 → 「在不在云里」取决于那几百米，不给结论。 */
    if (bandFloor >= IN_C) return state('in')
    return unknown('within-uncertainty')
  }
  /* 带上出现了浓云而此点自身不浓（含此点在包络外、被误差带够到云带底那一类）：
     真实海拔完全可能就落在云带里，上下关系无从判起。
     tol=0（可信高程）时这一条永远不触发——带就是这一个点。 */
  if (bandPeak >= IN_C) return unknown('within-uncertainty')
  if (cUser != null && cUser >= MODERATE_AT_POINT) return unknown('partial-at-point')

  var belowPeak = 0, abovePeak = 0
  var belowHi = Math.min(userAlt - tol - EDGE_GUARD, hi)
  if (belowHi > lo) {
    for (alt = lo; alt <= belowHi; alt += 100) belowPeak = Math.max(belowPeak, sample(h, alt))
  }
  var aboveLo = Math.max(lo, userAlt + tol + EDGE_GUARD)
  if (aboveLo <= hi) {
    for (alt = aboveLo; alt <= hi; alt += 100) abovePeak = Math.max(abovePeak, sample(h, alt))
  }
  if (belowPeak >= SEA_C && abovePeak >= OVER_C) return unknown('both-sides', ['ok', 'mid'])
  if (belowPeak >= SEA_C) return state('ok')
  if (abovePeak >= OVER_C) return state('mid')
  return unknown('clear')
}

/* ---------- 剖面显示窗（纯显示层：只决定「这张图画哪一段高度」） ----------
 *
 * 为什么存在（取证 qa/v2-window-adaptive-2026-10-09/probe-window.json）：
 * ALT0/ALT1 这对常量原本同时承担三件事——渲染网格与裁切、这张图画哪一段、
 * 以及 OI 沿海拔找云层的扫描范围。前两件用固定窗的后果实测到了：
 *   样本 1（云 900–1650m）／样本 2（云 6350–6900m）／样本 5（上下各一段、窗内恰是晴空）
 *   都渲染出 **0 条等值带、0 px² 墨迹**，而判读分别是 ok / mid / both-sides ——
 *   图上一片空白与「确认晴空」（样本 6，同样 0 环 0 px²）**一模一样**，
 *   读者只能把「裁掉了」读成「没有云」。
 *
 * 规则（只用有效数据，不外推）：
 *   anchors = 实测包络内 cover ≥DECK_MIN 的高度段
 *           ∪ 查询点：可信高程按真实高度纳入；模型估算按 ±误差带纳入
 *             （把估算值当精确锚点正是要防的事，所以估算值只会撑大窗口、不会收窄）；
 *             没有高程 ⇒ 不参与。
 *   window  = 候选窗中得分最高的那个：候选 = 任意两个 anchor 的并集 ±PAD_M（量化到 QUANT_M，
 *             跨度夹在 [MIN_SPAN, MAX_SPAN]）；得分先比窗内云带墨量（峰值×厚度×重叠比例），
 *             同分时才由「是否框住查询点」决定。装不下就保云带、把点写在窗外——
 *             点的数字本来就在读数行里，而一片空白的云场图没有意义。
 *             留在窗外的锚点由 clippedAbove/Below 与 pointOutside 各自如实报告（不混用）。
 *   没有锚点 ⇒ 退回历史固定窗（行为与改前逐像素一致），并标 fallback=true。
 *
 * 判读一律与本窗无关：inferState / denseSpanAt / peakCover 扫**实测范围**，
 * OI 的 cloudLayersAt 继续扫**固定基准**（天象成立条件不得随显示窗漂移，
 * 这条由 tools/cloud-position-test.js §8 钉住）。 */
var PROFILE = {
  DECK_MIN: 25,      // 参与布局的「有意义云量」下界 = 等值带第二档（10% 是发丝级底纹，不足以决定窗）
  PAD_M: 250,        // 一格的呼吸位（等于适配器的海拔步长），贴边的云不至于看不见
  QUANT: 250,        // 窗的边界量化到 250 m ⇒ 刻度落在整数上、换时间窗不至于每帧抖动
  MIN_SPAN: 1500,    // 再窄就没有高度感了
  MAX_SPAN: 4000,    // 与历史固定窗同尺度（190px 行高 ⇒ 21 m/px），不至于把云带压成一条线
  LO_FLOOR: 0,
  HI_CEIL: 7000,     // 与 SCAN_MIN/SCAN_MAX 同源：这是实测网格的物理边界
}
var ESTIMATE_TOL_M = 600   // Open-Meteo 地形高度的误差带上界（与 ALT_TOL.estimated 同一个数）

function finiteNum (v) { return Number.isFinite(v) ? v : null }

/* 有效云层段：在实测包络内扫 ≥DECK_MIN 的连续高度段（50m 步长，与等值带网格同密）。
   这是显示层的选材依据，不参与任何业务判读。 */
function profileDeckRuns (sample, h, lo, hi) {
  var runs = [], run = null
  var from = Math.max(PROFILE.LO_FLOOR, Math.floor(lo)), to = Math.min(PROFILE.HI_CEIL, Math.ceil(hi))
  for (var alt = from; alt <= to; alt += 50) {
    var v = sample(h, alt)
    if (v >= PROFILE.DECK_MIN) { run = run || { lo: alt, hi: alt, peak: 0 } ; run.hi = alt; if (v > run.peak) run.peak = v }
    else if (run) { runs.push(run); run = null }
  }
  if (run) runs.push(run)
  return runs
}

function quantWindow (lo, hi, bounds) {
  var wLo = Math.max(bounds.lo, Math.floor(lo / PROFILE.QUANT) * PROFILE.QUANT)
  var wHi = Math.min(bounds.hi, Math.ceil(hi / PROFILE.QUANT) * PROFILE.QUANT)
  if (wHi - wLo < PROFILE.MIN_SPAN) {
    var mid = (wLo + wHi) / 2
    wLo = mid - PROFILE.MIN_SPAN / 2; wHi = mid + PROFILE.MIN_SPAN / 2
    wLo = Math.max(bounds.lo, Math.floor(wLo / PROFILE.QUANT) * PROFILE.QUANT)
    wHi = Math.min(bounds.hi, wLo + PROFILE.MIN_SPAN)
  }
  if (wHi - wLo > PROFILE.MAX_SPAN) wHi = Math.min(bounds.hi, wLo + PROFILE.MAX_SPAN)
  return { lo: wLo, hi: wHi }
}

/* 允许的范围：实测包络 ± 一格呼吸位；查询点自己是已知量（不是外推的云），
   它比包络更低/更高时允许把窗扩到它那里——但只在跨度装得下时才会真的被选中。
   边界一律**向内**量化到 QUANT：网格行数 = 跨度/50 必须是整数，否则 y 映射与网格错位，
   刻度也会出现 6,923 m 这种没人能读的数（实测踩过）。 */
function quantBounds (lo, hi) {
  return { lo: Math.max(PROFILE.LO_FLOOR, Math.ceil(lo / PROFILE.QUANT) * PROFILE.QUANT), hi: Math.min(PROFILE.HI_CEIL, Math.floor(hi / PROFILE.QUANT) * PROFILE.QUANT) }
}
function windowBounds (covered, pointA) {
  var lo = PROFILE.LO_FLOOR, hi = PROFILE.HI_CEIL
  if (covered) { lo = covered.lo - PROFILE.PAD_M; hi = covered.hi + PROFILE.PAD_M }
  if (pointA) {
    lo = Math.min(lo, pointA.lo - PROFILE.PAD_M)
    hi = Math.max(hi, pointA.hi + PROFILE.PAD_M)
  }
  var q = quantBounds(lo, hi)
  /* 极窄包络（例如只有一层）时向内量化可能压不出一个可读的窗：改为**向外**量化，
     跨度不足 MIN_SPAN 由 quantWindow 的补宽逻辑接手；边界仍然必须是 QUANT 的整数倍。 */
  if (q.hi - q.lo < PROFILE.MIN_SPAN) {
    return {
      lo: Math.max(PROFILE.LO_FLOOR, Math.floor(lo / PROFILE.QUANT) * PROFILE.QUANT),
      hi: Math.min(PROFILE.HI_CEIL, Math.ceil(hi / PROFILE.QUANT) * PROFILE.QUANT),
    }
  }
  return q
}

function planProfile (opts) {
  var covered = opts.covered && Number.isFinite(opts.covered.lo) && Number.isFinite(opts.covered.hi) && opts.covered.hi > opts.covered.lo
    ? { lo: opts.covered.lo, hi: opts.covered.hi } : null
  var res = {
    lo: ALT0, hi: ALT1, fallback: true, anchorCount: 0,
    clippedAbove: false, clippedBelow: false, pointOutside: null, pointOutsideDelta: null, decks: [],
  }
  var alt = finiteNum(opts.queryAlt)
  if (!covered || !opts.sample) return res
  /* 窗必须对整张图稳定：同一条时间轴上逐小时各开一窗，切换小时时高度尺度会跳动，
     刻度与判读行也会互相打脸。所以锚点是逐小时云段的并集（见下面的合并）。 */
  var hours = finiteNum(opts.hours) || 24
  var runs = []
  for (var h = 0; h < hours; h++) profileDeckRuns(opts.sample, h, covered.lo, covered.hi).forEach(function (r) { runs.push(r) })
  /* 跨小时取并集：同一扇云在不同小时只是边缘挪几十米，合并后锚点通常 ≤4 个，
     候选窗数量才不会随小时数平方增长（72h 视图也要保持一次算清）。 */
  runs.sort(function (a, b) { return a.lo - b.lo })
  var merged = []
  runs.forEach(function (r) {
    var last = merged[merged.length - 1]
    if (last && r.lo <= last.hi + PROFILE.PAD_M) {
      last.hi = Math.max(last.hi, r.hi)
      last.peak = Math.max(last.peak || 0, r.peak || 0)
    } else merged.push({ lo: r.lo, hi: r.hi, peak: r.peak })
  })
  var anchors = merged.map(function (r) { return { lo: r.lo, hi: r.hi, peak: r.peak } })
  if (alt != null) {
    var tol = opts.basis === 'estimated' ? ESTIMATE_TOL_M : 0
    anchors.push({ lo: alt - tol, hi: alt + tol, peak: 0, isPoint: true })
  }
  res.anchorCount = anchors.length
  if (!anchors.length) return res
    var pad = PROFILE.PAD_M
  var pointA = null
  anchors.forEach(function (a) { if (a.isPoint) pointA = a })
  var bounds = windowBounds(covered, pointA)
  var best = null
  for (var i = 0; i < anchors.length; i++) {
    for (var j = i; j < anchors.length; j++) {
      var w = quantWindow(Math.min(anchors[i].lo, anchors[j].lo) - pad, Math.max(anchors[i].hi, anchors[j].hi) + pad, bounds)
      /* 跨度上限由 quantWindow 统一夹（超出就从上端截断，clippedAbove 会把它报成边注），
         所以这里不需要再判一次——判也判不到，窗已经被夹过了。 */
      var ink = 0, hasPoint = false
      anchors.forEach(function (a) {
        if (a.isPoint) { if (a.lo >= w.lo && a.hi <= w.hi) hasPoint = true; return }
        var ov = Math.min(a.hi, w.hi) - Math.max(a.lo, w.lo)
        if (ov > 0) ink += ov / Math.max(1, a.hi - a.lo) * (a.peak || 0) * (a.hi - a.lo)
      })
      var score = ink * 1000 + (hasPoint ? 1 : 0)
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && w.lo < best.w.lo)) best = { w: w, score: score }
    }
  }
  if (!best) {
    /* 单个锚点本身就比 MAX_SPAN 还宽（极端厚云）：以最强那一层的中心开窗，两端如实报窗外 */
    var wide = anchors.slice().sort(function (a, b) { return (b.peak || 0) - (a.peak || 0) })[0]
    var c = quantWindow(wide.lo + (wide.hi - wide.lo - PROFILE.MAX_SPAN) / 2, wide.lo + (wide.hi - wide.lo + PROFILE.MAX_SPAN) / 2, bounds)
    best = { w: c, score: 0 }
  }
  res.lo = best.w.lo; res.hi = best.w.hi; res.fallback = false
  res.decks = merged
  /* clipped* 只说「云带被窗裁掉了」，不含查询点——点不在窗里是另一件事（pointOutside），
     两者混在一个旗标上会让边注说出「窗外下方还有云带」这种其实没有云的话。 */
  res.clippedAbove = runs.some(function (r) { return r.hi > res.hi })
  res.clippedBelow = runs.some(function (r) { return r.lo < res.lo })
  if (alt != null) {
    res.pointOutside = alt < res.lo ? 'below' : alt > res.hi ? 'above' : null
    /* 高差给成整数米：页面图例与图上边注用的是同一个数（谁也不许自己再算一遍） */
    res.pointOutsideDelta = res.pointOutside ? Math.round(Math.abs(alt - (res.pointOutside === 'above' ? res.hi : res.lo))) : null
  }
  return res
}

/* 刻度：窗内均匀取点，边界量化到 250 ⇒ 步长只会是 500/1000，标签总是整数 */
function profileTicks (lo, hi) {
  var step = (hi - lo) >= 4000 ? 1000 : 500
  var out = []
  for (var a = Math.ceil(lo / step) * step; a <= hi; a += step) out.push(a)
  return out
}

/* ---------- 剖面「这一窗画了什么」的图形语言（两个渲染器共用） ----------
 * POC（本模块 renderBaseSvg）与生产统一 Meteogram（meteogram-svg renderUnifiedBase）
 * 调同一个函数 ⇒ 参考线、琥珀交线、刻度、窗外提示、窗范围不可能各画一套。
 * o = { profile, yAlt, num, L, plotW, rowTop, rowBot, userAlt, elevSource, inRuns,
 *       xA, xB, colors:{line,amber,ink,muted}, grid }  —— xA/xB 把小时映射成 x（各渲染器的时间轴不同源）
 */
function renderProfileChrome (o) {
  var p = o.profile
  var s = ''
  var lo = p.lo, hi = p.hi
  var num = o.num || function (v) { return String(Math.round(v)) }
  var hasPoint = Number.isFinite(o.userAlt)
  var inside = hasPoint && o.userAlt >= lo && o.userAlt <= hi
  /* 刻度（+可选水平网格） */
  profileTicks(lo, hi).forEach(function (a) {
    var y = o.yAlt(a)
    if (o.grid) s += '<line x1="' + o.L + '" y1="' + y.toFixed(1) + '" x2="' + (o.L + o.plotW) + '" y2="' + y.toFixed(1) + '" stroke="' + o.colors.gridLine + '" stroke-width="0.6"/>'
    s += '<text x="' + (o.L - 5) + '" y="' + (y + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + o.colors.muted + '">' + num(a) + '</text>'
  })
  if (inside) {
    var uy = o.yAlt(o.userAlt)
    s += '<line x1="' + o.L + '" y1="' + uy.toFixed(1) + '" x2="' + (o.L + o.plotW) + '" y2="' + uy.toFixed(1) + '" stroke="' + o.colors.line + '" stroke-width="1" stroke-dasharray="4 3"/>'
    ;(o.inRuns || []).forEach(function (r) {
      s += '<line x1="' + o.xA(r.from).toFixed(1) + '" y1="' + uy.toFixed(1) + '" x2="' + o.xB(r.to).toFixed(1) + '" y2="' + uy.toFixed(1) + '" stroke="' + o.colors.amber + '" stroke-width="2.5" stroke-linecap="round"/>'
    })
    s += '<text x="' + (o.L + o.plotW - 4) + '" y="' + (uy - 4).toFixed(1) + '" text-anchor="end" font-size="7.5" font-weight="600" fill="' + o.colors.line + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">' + F.elevLineLabel(num(o.userAlt), o.elevSource) + '</text>'
  } else if (hasPoint) {
    /* 点在窗外：不画参考线、不钳到窗边冒充位置，只在贴着的那一侧如实标出还差多少米 */
    var above = p.pointOutside === 'above'
    var edge = above ? o.rowTop + 9 : o.rowBot - 3
    s += '<text x="' + (o.L + o.plotW - 4) + '" y="' + edge.toFixed(1) + '" text-anchor="end" font-size="7.5" font-weight="600" fill="' + o.colors.line + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">' +
      (above ? '▲ ' : '▼ ') + F.pointOutsideLabel(p.pointOutside, num(p.pointOutsideDelta)) + '</text>'
  }
  /* 云带被窗裁掉的那一侧：一句边注，空白就不再是「没有云」 */
  if (p.clippedAbove) s += '<text x="' + (o.L + 4) + '" y="' + (o.rowTop + 9).toFixed(1) + '" font-size="7.5" fill="' + o.colors.muted + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">▲ ' + F.cloudWindowNote('clipped-above') + '</text>'
  if (p.clippedBelow) s += '<text x="' + (o.L + 4) + '" y="' + (o.rowBot - 3).toFixed(1) + '" font-size="7.5" fill="' + o.colors.muted + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">▼ ' + F.cloudWindowNote('clipped-below') + '</text>'
  if (!p.decks.length && !p.fallback) s += '<text x="' + (o.L + 4) + '" y="' + (o.rowTop + 9).toFixed(1) + '" font-size="7.5" fill="' + o.colors.muted + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">' + F.cloudWindowNote('no-deck') + '</text>'
  /* 窗范围自证：图例里的「此点海拔/琥珀段」说的是哪一段高度，写在图上而不是猜。
     放顶边正中：左边是「窗外上方还有云带」、右边是「此点在剖面上方 …」，三段各占其位不重叠。 */
  s += '<text x="' + (o.L + o.plotW / 2).toFixed(1) + '" y="' + (o.rowTop + 9).toFixed(1) + '" text-anchor="middle" font-size="7" fill="' + o.colors.muted + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">' + F.profileRangeLabel(num(lo), num(hi)) + '</text>'
  return s
}

/* ---------- 几何构建（昂贵，按数据集缓存） ---------- */

/* 手工构造的 field（POC fixtures、部分判据）没有 covered 字段，它们的网格整段都是
   「有测量」的，所以退回网格自身的高度范围；生产适配器一定会给 covered，两者不冲突。
   绝不退回显示窗 ALT0/ALT1——那是「这张图画哪一段」，不是「哪些高度有数据」（铁律 25）。 */
function altExtent (alts) {
  if (!alts || !alts.length) return null
  var lo = Infinity, hi = -Infinity
  for (var i = 0; i < alts.length; i++) {
    var a = alts[i]
    if (!Number.isFinite(a)) continue
    if (a < lo) lo = a
    if (a > hi) hi = a
  }
  return lo < hi ? { lo: lo, hi: hi } : null
}

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
  var covered = cf.covered || altExtent(cf.altitudes) || null
  var userAlt = Number.isFinite(opts.userAltitude) ? opts.userAltitude : null
  /* 查询点：没有可信海拔就没有锚点。旧写法在这里塞了个 3500 的假值——
     POC 页看不出来、判据也抓不到，正是「null 被钳成某个高程」那类错的重演点。 */
  var basis = opts.elevBasis || (opts.elevSource ? F.elevBasis(opts.elevSource) : (userAlt != null ? 'measured' : 'none'))
  var profT0 = Date.now()
  var profile = planProfile({ sample: sample, covered: covered, hours: nT, queryAlt: userAlt, basis: basis })
  var profMs = Date.now() - profT0
  /* 局部名不叫 F：模块顶上的 F 是 format.js（三态文案唯一出处），同名遮蔽迟早出错 */
  var GRID = buildGrid(sample, nT, { altLo: profile.lo, altHi: profile.hi })

  var top = 0, plotBot = plotH
  var xOf = function (i) { return L + ((GRID.t0 + i * GRID.dt) / 24) * plotW }
  var yOf = function (j) { return plotBot - (GRID.a0 + j * GRID.da - profile.lo) / (profile.hi - profile.lo) * plotH }

  var isoMs0 = Date.now()
  var bands = []
  var pathCount = 0, pointCount = 0
  THRESHOLDS.forEach(function (bd) {
    var loops = isoLoops(GRID, bd.t, xOf, yOf)
    var d = ''
    loops.forEach(function (lp) {
      d += 'M' + lp.map(function (pt) { return pt.x.toFixed(1) + ',' + pt.y.toFixed(1) }).join('L') + 'Z'
      pointCount += lp.length
    })
    if (d) { bands.push({ d: d, fill: bd.c }); pathCount++ }
  })
  var isoMs = Date.now() - isoMs0

  /* 入云时段（field(t,查询点) ≥ IN_C 的连续段）→ 海拔线上琥珀交线。
     查询点不在这一窗里时一条都不画：琥珀段是「此点在云里」的图形语言，
     点不在图上就没有「此处」可言（判读侧同向由 cloud-position-test §5 钉住）。 */
  var inRuns = []
  if (userAlt != null && userAlt >= profile.lo && userAlt <= profile.hi) {
    HOURS_SCAN(nT, function (h) {
      return sample(h, userAlt) >= IN_C
    }, inRuns)
  }

  var stats = {
    gridMs: Date.now() - t0ms - isoMs - profMs,
    profMs: profMs,
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
    elevSource: opts.elevSource || null,
    elevBasis: basis,
    covered: covered,
    profile: profile,
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

  /* 海拔参考线、刻度、窗外提示、窗范围 —— 与生产统一 Meteogram 同一个函数 */
  s += renderProfileChrome({
    profile: geo.profile, yAlt: geo.yAlt, L: geo.L, plotW: geo.plotW,
    rowTop: geo.plotTop, rowBot: geo.plotBot,
    userAlt: geo.userAlt, elevSource: geo.elevSource, inRuns: geo.inRuns,
    xA: function (h) { return geo.x0(h) }, xB: function (h) { return geo.x0(h + 1) },
    num: function (v) { return Math.round(v).toLocaleString('en-US') },
    colors: { line: '#163e35', amber: 'rgba(180,118,26,0.65)', muted: '#8a8f8a', gridLine: '#e9eae4' },
  })

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
      /* 用这一张图自己的窗筛点，并且**不钳位**：钳到窗边会把采样点画在一个它从没测过的高度上，
         与本轮消灭的「参考线钉在窗边」是同一类错（POC 的调试图层也不能例外）。 */
      if (sp.alt < geo.profile.lo || sp.alt > geo.profile.hi) return
      dots += '<circle cx="' + fmt(geo.X(sp.t)) + '" cy="' + fmt(geo.yAlt(sp.alt)) + '" r="1.8" fill="#fff" fill-opacity="0.85" stroke="#163e35" stroke-width="0.7"/>'
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
  geo.yAlt = function (a) { return geo.plotBot - (a - geo.profile.lo) / (geo.profile.hi - geo.profile.lo) * geo.plotH }
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
  /* --- 剖面显示窗（纯显示层）---
     planProfile 只决定「这张图画哪一段高度」；判读一律用实测范围或固定基准，与本窗无关。
     renderProfileChrome 是两个渲染器共用的图形语言：参考线/交线/刻度/窗外提示/窗范围一套逻辑。 */
  PROFILE: PROFILE,
  planProfile: planProfile,
  profileTicks: profileTicks,
  renderProfileChrome: renderProfileChrome,
}
