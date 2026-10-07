/* OurTrail Weather Meteogram Prototype · 渲染器 V6（Cloud Cover Field）
 *
 * 本轮是渲染模型更换，不是视觉打磨：
 *
 *   V1–V5：把 low/mid/high/band 当作若干「云对象」，画它们的形状
 *          （envelope / polygon / 透镜 / 楔形）——无论多平滑，本质是「几块云」。
 *   V6：    把同一份数据换算成 cloudCover(time, altitude) 二维连续场，
 *          直接渲染场的密度。没有任何云的轮廓、云底云顶线、透镜或楔形。
 *
 * 场的构成（Weather Data → Cloud Cover Field → OurTrail Interpretation）：
 *   ▸ 数据源仍是 hourView 语义（low/mid/high 云量 + band 云底/顶/量），
 *     但它们只是场的来源：每层贡献一个「垂直密度剖面」——平台区全量、
 *     边缘 450–700 m smoothstep 渐变沿，没有硬边界；
 *   ▶ 叠加确定性低频调制（高度 × 时间的正弦，无随机噪声）：等值区域不规则、
 *     各层不同步，这是 meteoblue 云图「自然但不杂乱」的来源；
 *   ▸ 各层取 max 合成（云量不叠加），得到 field(t, alt) ∈ 0–100%。
 *
 * 渲染：48 条垂直采样 strip，每条 = 一个纵向 linearGradient
 * （每 200 m 一个高度采样 stop，色 = 五档灰阶量化，<10% 透明）。
 * 垂直方向连续过渡（密度渐变），水平方向 meteoblue 式的等值阶梯。
 *
 * 解读层全部从场推导（OurTrail Interpretation）：
 *   你在云中 = field(t, 3500) ≥ 60；云海 = 用户以下高密且用户处干净；
 *   读数条的「云区」= 场 ≥70% 的密集区间采样。不再有专门的云对象可引用。
 *
 * ?debug=1：只渲染云场面板（时间轴 + 3500 m 线），用于直接判断 renderer。
 */
(function () {
  'use strict'

  /* 数据源：mock（默认）或真实 Open-Meteo（?real=litang|chengdu|emeishan|daocheng）。
   * renderer 对两者的契约：hours（hourView 形状，供温度/降水/风/图标）
   * + cloud（Time × Altitude × Cover 采样，供云场）——renderer 不知道数据来自谁。 */
  var DATA = window.OT_MOCK
  if (!DATA || (DATA.selfCheck && !DATA.selfCheck())) {
    console.warn('[meteogram] mock 自检未通过，数据可能与设计故事线不一致')
  }
  var HOURS = DATA.hours
  var N = HOURS.length
  var ELEV = DATA.point.elevation
  var CLOUD_SRC = null                    // 真实模式：场采样函数（双线性）
  var SUNRISE = 7 + 6 / 60
  var SUNSET = 19 + 5 / 60
  var DEBUG = /(?:^|[?&])debug=1/.test(location.search)
  var DEBUG2 = /(?:^|[?&])debug=2/.test(location.search)   // debug=2 = 等值带 + 原始采样点叠加

  function parseHM(s, fallback) {
    var m = /^(\d{1,2}):(\d{2})/.exec(s || '')
    return m ? (+m[1] + +m[2] / 60) : fallback
  }

  function setData(d) {
    DATA = d
    HOURS = d.hours
    N = HOURS.length
    ELEV = d.point.elevation
    CLOUD_SRC = d.cloud ? makeRealSampler(d.cloud) : null
    SUNRISE = parseHM(d.meta.sunrise, 7.1)
    SUNSET = parseHM(d.meta.sunset, 19.1)
    FIELD_CACHE = null                    // 场网格随数据重建
  }

  /* Catmull-Rom 时间维插值：过站点的平滑曲线（替代分段线性——
   * 线性插值会在每个整点站产生等值线折角，即真实数据下的尖角/楔形来源之一）。
   * 端点钳制 + 值域 [0,100] 钳制（CR 允许轻微过冲，云量不允许）。 */
  function cr4(p0, p1, p2, p3, ft) {
    var v = 0.5 * ((2 * p1) + (-p0 + p2) * ft +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * ft * ft +
      (-p0 + 3 * p1 - 3 * p2 + p3) * ft * ft * ft)
    return Math.max(0, Math.min(100, v))
  }

  /* 真实场采样器：Time × Altitude × Cover 均匀网格。
   * column(h, alt)：第 h 小时在海拔 alt 处的云量（层间线性，端点钳制）；
   * 时间维由 renderer 的 CR 插值负责（见 fieldAt）。 */
  function makeRealSampler(cf) {
    var nA = cf.altitudes.length
    var a0 = cf.altitudes[0]
    var da = (cf.altitudes[nA - 1] - a0) / (nA - 1)
    var nT = cf.values.length
    function column(h, alt) {
      var af = Math.max(0, Math.min(nA - 1.001, (alt - a0) / da))
      var j0 = Math.floor(af), j1 = Math.min(nA - 1, j0 + 1), fa = af - j0
      var v = cf.values[h][j0] * (1 - fa) + cf.values[h][j1] * fa
      return Math.max(0, Math.min(100, v))
    }
    return { column: column }
  }

  /* ---------- 调色板（与 styles.css 同值） ---------- */

  var C = {
    ink: '#1f2a26',
    mut: '#8a8f8a',
    faint: '#b3b6b0',
    grid: '#e9eae4',
    axis: '#d3d5cd',
    night: '#eff2f7',
    temp: '#b5432e',
    tempFill: 'rgba(181,67,46,0.07)',
    rain: '#4a78b8',
    shower: '#8fb9df',
    wind: '#3d8a7f',
    gust: '#9fc4d8',
    arrow: '#5a5f5a',
    arrowSoft: '#9a9f99',
    you: '#163e35',
    inCloud: 'rgba(180,118,26,0.65)',
    selWash: 'rgba(22,62,53,0.035)',
  }

  /* 云量五档灰阶（场的量化色阶；图例「淡→浓」连续带与之对应） */
  var BINS = [
    { max: 25, color: '#eeeeea' },
    { max: 50, color: '#d4d6d0' },
    { max: 75, color: '#b0b2ab' },
    { max: 90, color: '#84867f' },
    { max: 101, color: '#5a5c56' },
  ]
  function binOf(cover) {
    if (cover < 10) return null
    for (var i = 0; i < BINS.length; i++) if (cover < BINS[i].max) return BINS[i]
    return BINS[4]
  }

  /* ---------- 天相文字与图标 ---------- */

  var CODE_WORD = { 0: '晴', 1: '大部晴', 2: '多云', 3: '阴', 45: '雾', 51: '毛毛雨', 61: '小雨', 63: '雨', 65: '大雨', 71: '小雪', 80: '阵雨', 81: '阵雨', 85: '阵雪' }
  function wordOf(code) { return CODE_WORD[code] || '—' }

  function iconId(code, h) {
    var night = h < 6 || h >= 20
    switch (code) {
      case 0: case 1: return night ? 'i-moon' : 'i-sun'
      case 2: return night ? 'i-pcloud-n' : 'i-pcloud-d'
      case 45: case 3: return 'i-cloud'
      case 51: return 'i-drizzle'
      case 61: case 63: case 65: return 'i-rain'
      case 80: case 81: return 'i-shower'
      default: return 'i-cloud'
    }
  }

  function buildDefs() {
    var rays = ''
    for (var a = 0; a < 8; a++) {
      var t = a * Math.PI / 4
      rays += '<line x1="' + (12 + 7 * Math.cos(t)).toFixed(2) + '" y1="' + (12 + 7 * Math.sin(t)).toFixed(2) +
        '" x2="' + (12 + 9.4 * Math.cos(t)).toFixed(2) + '" y2="' + (12 + 9.4 * Math.sin(t)).toFixed(2) + '"/>'
    }
    var CLOUD = 'M6.5,18.5 H16.5 A3.5,3.5 0 0 0 16.5,11.5 A5,5 0 0 0 6.8,10.8 A4,4 0 0 0 6.5,18.5 Z'
    return '<defs>' +
      '<g id="i-sun" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none">' +
      '<circle cx="12" cy="12" r="4.6"/>' + rays + '</g>' +
      '<g id="i-moon"><path d="M14.8,3.8 A9,9 0 1,0 20.2,15.2 A7,7 0 0,1 14.8,3.8 Z" fill="currentColor"/></g>' +
      '<g id="i-pcloud-d" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
      '<circle cx="8.6" cy="7.8" r="3"/><path d="M8.6,2.6 v1.4 M8.6,11.6 v0.2 M3.4,7.8 h1.4 M13.8,7.8 h0.2 M4.9,4.1 l1,1 M12.3,4.1 l-1,1"/>' +
      '<path d="' + CLOUD + '" fill="#fff"/></g>' +
      '<g id="i-pcloud-n">' +
      '<path d="M9.6,2.6 A5.4,5.4 0 1,0 12.6,9.6 A4.2,4.2 0 0,1 9.6,2.6 Z" fill="currentColor"/>' +
      '<path d="' + CLOUD + '" fill="#fff" stroke="currentColor" stroke-width="1.3"/></g>' +
      '<g id="i-cloud"><path d="' + CLOUD + '" fill="none" stroke="currentColor" stroke-width="1.3" transform="translate(0.5,1)"/></g>' +
      '<g id="i-drizzle" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
      '<path d="' + CLOUD + '" transform="translate(0,-1.5)"/>' +
      '<path d="M10,19.8 l-0.4,1.5 M13.5,19.8 l-0.4,1.5"/></g>' +
      '<g id="i-rain" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
      '<path d="' + CLOUD + '" transform="translate(0,-1.5)"/>' +
      '<path d="M10,19.4 l-0.6,2.4 M13.8,19.4 l-0.6,2.4"/></g>' +
      '<g id="i-shower" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round">' +
      '<path d="' + CLOUD + '" transform="translate(0.8,-1)" fill="#fff"/>' +
      '<path d="M10.6,18.6 l-1.2,3.2 M15,18.6 l-1.2,3.2"/></g>' +
      '</defs>'
  }

  /* ---------- 小工具 ---------- */

  function fmtM(v) { return v.toLocaleString('en-US') }

  /* Catmull-Rom → 贝塞尔（温度/风速曲线用） */
  function smooth(pts) {
    if (pts.length < 3) {
      return 'M' + pts.map(function (p) { return p.x + ',' + p.y }).join('L')
    }
    var d = 'M' + pts[0].x + ',' + pts[0].y
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)]
      d += 'C' + (p1.x + (p2.x - p0.x) / 6).toFixed(2) + ',' + (p1.y + (p2.y - p0.y) / 6).toFixed(2) +
        ' ' + (p2.x - (p3.x - p1.x) / 6).toFixed(2) + ',' + (p2.y - (p3.y - p1.y) / 6).toFixed(2) +
        ' ' + p2.x + ',' + p2.y
    }
    return d
  }

  var ROSE = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  function roseOf(dir) { return ROSE[Math.round(dir / 45) % 8] + '风' }

  var ROSE_ARROW = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
  function arrowCharOf(dirFrom) {
    var flow = (dirFrom + 180) % 360
    return ROSE_ARROW[Math.round(flow / 45) % 8]
  }

  /* ================================================================
   * Cloud Cover Field：cloudCover(time, altitude)
   * ================================================================ */

  var ALT0 = 2000, ALT1 = 6000, ALT_STEP = 200
  var ALTS = []
  for (var a0 = ALT0; a0 <= ALT1; a0 += ALT_STEP) ALTS.push(a0)

  function smoothstep(e0, e1, x) {
    var s = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
    return s * s * (3 - 2 * s)
  }

  /* 垂直密度剖面：[b1,t1] 平台全量，向外 450–700 m smoothstep 渐变沿（无硬边界） */
  function vprof(alt, b0, b1, t1, t0) {
    return smoothstep(b0, b1, alt) * (1 - smoothstep(t1, t0, alt))
  }

  /* 确定性低频调制（高度 × 时间）：让等值区域不规则、各层不同步。
   * 幅度 ±8%，连续可微，无随机噪声 —— meteoblue 云图的自然不规则感。 */
  function wobble(alt, h, phase) {
    return 1 + 0.08 * Math.sin(alt / 780 + h * 0.31 + phase)
  }

  /* mock 场源：由 hourView 三层云量 + band 重建垂直密度剖面（数据适配层）。
   * band（成层低云）= 数据给定的平台剖面；中云平台随云量变厚度；高云贴视野上缘。 */
  function rawAt(h, alt) {
    var hh = HOURS[h]
    var c = 0
    if (hh.band) {
      var b = hh.band
      c = b.cover * wobble(alt, h, 0.7) * vprof(alt, b.base - 400, b.base + 80, b.top - 80, b.top + 300)
    } else {
      c = hh.cloud.low * wobble(alt, h, 1.3) * vprof(alt, ALT0 - 300, 1900, 1900 + hh.cloud.low * 8, 2600 + hh.cloud.low * 10)
    }
    var mb = 4700 - hh.cloud.mid * 6, mt = 4900 + hh.cloud.mid * 3
    c = Math.max(c, hh.cloud.mid * wobble(alt, h, 2.9) * vprof(alt, mb - 500, mb, mt, mt + 500))
    var hb = 5900 - hh.cloud.high * 3
    c = Math.max(c, hh.cloud.high * wobble(alt, h, 4.4) * vprof(alt, hb - 550, hb, 6600, 6800))
    return Math.max(0, Math.min(100, c))
  }

  /* cloudCover(t, alt)：t 可为连续小时，0–100。
   * 时间维 Catmull-Rom（mock 与 real 同一数学），垂直维：
   * mock 用密度剖面直接求值；real 用气压层级联线性。 */
  function fieldAt(t, alt) {
    var h1 = Math.max(0, Math.min(N - 1, Math.floor(t)))
    var ft = Math.max(0, Math.min(N - 1, t)) - h1
    var h0 = Math.max(0, h1 - 1), h2 = Math.min(N - 1, h1 + 1), h3 = Math.min(N - 1, h1 + 2)
    if (CLOUD_SRC) {
      return cr4(CLOUD_SRC.column(h0, alt), CLOUD_SRC.column(h1, alt), CLOUD_SRC.column(h2, alt), CLOUD_SRC.column(h3, alt), ft)
    }
    return cr4(rawAt(h0, alt), rawAt(h1, alt), rawAt(h2, alt), rawAt(h3, alt), ft)
  }

  var IN_C = 60       // 你在云中：field(t, 3500) 阈值
  var SPAN_C = 70     // 「云区」密集区间阈值
  var SEA_C = 68      // 云海：用户以下峰值阈值
  var OVER_C = 40     // 云在头顶：用户以上峰值阈值

  /* OurTrail Interpretation：全部由场采样推导（ELEV 任意海拔皆可判） */
  function fieldState(h) {
    var cUser = fieldAt(h, ELEV)
    if (cUser >= IN_C) return { key: 'in', word: '你在云中' }
    var belowPeak = 0, abovePeak = 0
    var belowHi = Math.min(ELEV - 200, 3300)
    if (belowHi > ALT0) {
      for (var alt = ALT0; alt <= belowHi; alt += 100) belowPeak = Math.max(belowPeak, fieldAt(h, alt))
    }
    if (belowPeak >= SEA_C && cUser < 45) return { key: 'ok', word: '云在脚下' }
    var aboveLo = Math.max(3700, ELEV + 200)
    if (aboveLo <= ALT1) {
      for (alt = aboveLo; alt <= ALT1; alt += 100) abovePeak = Math.max(abovePeak, fieldAt(h, alt))
    }
    if (abovePeak >= OVER_C && cUser < 45) return { key: 'mid', word: '云在头顶' }
    return null
  }

  /* 场在高度维 ≥ SPAN_C 的密集区间（读数条「云区」）。
   * 可能有多个不相连的高密区（低云海 + 中云盖）——返回峰值所在的那个。 */
  function denseSpan(h) {
    var run = null, runs = [], peak = 0
    for (var alt = ALT0; alt <= ALT1; alt += 25) {
      if (fieldAt(h, alt) >= SPAN_C) {
        if (!run) run = { lo: alt, hi: alt }
        else run.hi = alt
        var v = fieldAt(h, alt)
        if (v > peak) { peak = v; run.peak = Math.round(v) }
      } else if (run) { runs.push(run); run = null }
    }
    if (run) runs.push(run)
    if (!runs.length) return null
    runs.sort(function (a, b) { return (b.peak || 0) - (a.peak || 0) })
    return runs[0]
  }

  /* 事件道只保留 云海/入云 两类（云在头顶仅进读数） */
  function laneEvents() {
    var ev = []
    HOURS.forEach(function (hh, h) {
      var st = fieldState(h)
      if (!st || st.key === 'mid') return
      var last = ev[ev.length - 1]
      if (last && last.key === st.key && last.to === h - 1) last.to = h
      else ev.push({ from: h, to: h, key: st.key })
    })
    return ev
  }

  /* ================================================================
   * 二维场 → isoband：marching squares 等值带
   * 场网格（0.5h × 100m）→ 数学平滑（3×3 两轮）→ 五条等值线（10/25/50/75/90）
   * 提取连续等值区域 → Chaikin 圆化 → 嵌套 SVG path 填充。
   * 没有 grid cell、没有 blur filter；边界连续、自然弯曲、有局部深核。
   * ================================================================ */

  var FIELD_CACHE = null
  function getField() {
    if (FIELD_CACHE) return FIELD_CACHE
    var TS = 0.25, AS = 50   // 等值分辨率：0.25h × 50m（配合 CR 时间插值，无格点棱角）
    var ts = [], als = []
    for (var t = 0; t <= 24; t += TS) ts.push(t)
    for (var a = ALT0; a <= ALT1; a += AS) als.push(a)
    var nx = ts.length, ny = als.length
    var g = []
    for (var j = 0; j < ny; j++) {
      var row = []
      for (var i = 0; i < nx; i++) row.push(fieldAt(ts[i], als[j]))
      g.push(row)
    }
    /* 一轮 3×3 平滑：足以去掉格点棱角，保留场的不规则轮廓（两轮会磨成椭圆） */
    for (var r = 0; r < 1; r++) {
      var g2 = []
      for (j = 0; j < ny; j++) {
        var row2 = []
        for (i = 0; i < nx; i++) {
          var sum = 0, w = 0
          for (var dj = -1; dj <= 1; dj++) {
            for (var di = -1; di <= 1; di++) {
              var jj = j + dj, ii = i + di
              if (jj < 0 || jj >= ny || ii < 0 || ii >= nx) continue
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
    /* 外扩一圈复制边缘值：等值环全部闭合，出界部分由 clip 裁掉
     * （贴边云——晨带贴 2000m 底、贴 0h/24h 侧——自然出血，不留白边） */
    var gp = []
    for (j = 0; j < ny + 2; j++) {
      var jr = Math.max(0, Math.min(ny - 1, j - 1))
      var rp = []
      for (i = 0; i < nx + 2; i++) {
        var ir = Math.max(0, Math.min(nx - 1, i - 1))
        rp.push(g[jr][ir])
      }
      gp.push(rp)
    }
    FIELD_CACHE = { g: gp, nx: nx + 2, ny: ny + 2, t0: -TS, dt: TS, a0: ALT0 - AS, da: AS }
    return FIELD_CACHE
  }

  function isoLoops(T, xOf, yOf) {
    var F = getField()
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
        var topE = function () { return lerpPt(x0, y0, a, x1, y0, b) }
        var rightE = function () { return lerpPt(x1, y0, b, x1, y1, c) }
        var botE = function () { return lerpPt(x0, y1, d, x1, y1, c) }
        var leftE = function () { return lerpPt(x0, y0, a, x0, y1, d) }
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
    /* 无向段 → 闭合环 */
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
      while (guard++ < 20000) {
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
    /* 几何清理：微环过滤（面积 <12px² 的碎片岛屿——数值噪声，
     * 不是真实云区；有意义的孤立小云区远大于此） */
    function areaOf(lp) {
      var s = 0
      for (var i2 = 0; i2 < lp.length; i2++) {
        var p = lp[i2], q = lp[(i2 + 1) % lp.length]
        s += p.x * q.y - q.x * p.y
      }
      return Math.abs(s / 2)
    }
    loops = loops.filter(function (lp) { return areaOf(lp) >= 12 })
    /* Chaikin 圆化一轮：等值边界自然弯曲（不是 blur，是几何平滑） */
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

  /* ---------- 布局（V3 定型；debug 模式只留云场面板并加高） ---------- */

  var L = 38, R = 10
  var GAP = 9

  var PANELS = DEBUG
    ? [{ id: 'cloud', h: 300 }]
    : [
        { id: 'temp', h: 68 },
        { id: 'precip', h: 44 },
        { id: 'cloud', h: 116 },
        { id: 'wind', h: 64 },
      ]

  function layout(w) {
    var p = {
      w: w, L: L, R: R,
      plotW: w - L - R,
      colW: (w - L - R) / N,
      dayTop: 6,
    }
    p.X = function (h) { return L + (h + 0.5) * p.colW }
    p.x0 = function (h) { return L + h * p.colW }
    var y = p.dayTop + 14
    PANELS.forEach(function (pn) {
      pn.top = y + GAP
      pn.bot = pn.top + pn.h
      y = pn.bot
    })
    p.axisTop = y
    p.laneTop = y + 19
    p.H = y + 37
    p.plotTop = PANELS[0].top
    p.plotBot = PANELS[PANELS.length - 1].bot
    return p
  }

  function pById(id) {
    for (var i = 0; i < PANELS.length; i++) if (PANELS[i].id === id) return PANELS[i]
    return null
  }

  /* ---------- 渲染 ---------- */

  var svg = document.getElementById('chart')
  var phone = document.getElementById('phone')
  var sel = null

  function render() {
    var p = layout(phone.clientWidth)
    var s = ''
    var gseq = 0

    var temp = pById('temp'), prec = pById('precip'), cloud = pById('cloud'), wind = pById('wind')

    function yAlt(a) { return cloud.bot - (a - ALT0) / (ALT1 - ALT0) * (cloud.bot - cloud.top) }

    /* --- ① 昼夜底 --- */
    var gid = 'daynight'
    function off(h) { return (h / 24).toFixed(4) }
    s += '<defs><linearGradient id="' + gid + '" gradientUnits="userSpaceOnUse" x1="' + L + '" y1="0" x2="' + (L + p.plotW) + '" y2="0">' +
      '<stop offset="0" stop-color="' + C.night + '"/>' +
      '<stop offset="' + off(SUNRISE - 0.85) + '" stop-color="' + C.night + '"/>' +
      '<stop offset="' + off(SUNRISE + 0.25) + '" stop-color="#ffffff"/>' +
      '<stop offset="' + off(SUNSET - 0.25) + '" stop-color="#ffffff"/>' +
      '<stop offset="' + off(SUNSET + 0.85) + '" stop-color="' + C.night + '"/>' +
      '<stop offset="1" stop-color="' + C.night + '"/>' +
      '</linearGradient></defs>'
    s += '<rect x="' + L + '" y="' + p.plotTop + '" width="' + p.plotW + '" height="' + (p.plotBot - p.plotTop) + '" fill="url(#' + gid + ')"/>'

    /* --- ② 共享骨架 --- */
    var vGrid = ''
    for (var h = 0; h < N; h += 2) {
      vGrid += '<line x1="' + p.X(h).toFixed(1) + '" y1="' + p.plotTop + '" x2="' + p.X(h).toFixed(1) + '" y2="' + p.plotBot + '"/>'
    }
    s += '<g stroke="' + C.grid + '" stroke-width="0.6">' + vGrid + '</g>'

    function hGrid(pn, ticks, yfn) {
      var g = ''
      ticks.forEach(function (t) {
        var y = yfn(t)
        if (y > pn.top + 1 && y < pn.bot - 0.5) g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (L + p.plotW) + '" y2="' + y.toFixed(1) + '"/>'
      })
      return g
    }
    var hg = ''
    if (temp) hg += hGrid(temp, [0, 8, 16], function (t) { var zt = temp.top + 32, zb = temp.bot - 2; return zb - (t / 16) * (zb - zt) })
    hg += hGrid(cloud, [3000, 4000, 5000], yAlt)
    if (wind) hg += hGrid(wind, [10, 20], function (t) { var zt = wind.top + 20, zb = wind.bot - 2; return zb - (v2(t)) * (zb - zt) })
    function v2(v) { return v / 30 }
    s += '<g stroke="' + C.grid + '" stroke-width="0.6">' + hg + '</g>'

    s += '<rect x="' + L + '" y="' + p.plotTop + '" width="' + p.plotW + '" height="' + (p.plotBot - p.plotTop) + '" fill="none" stroke="' + C.axis + '" stroke-width="0.8"/>'

    /* --- ③ Cloud Cover Field：等值带（marching squares → 嵌套 path） ---
     * 场 → 数学平滑 → 五条等值线（10/25/50/75/90%）提取连续区域 →
     * Chaikin 圆化 → 由浅到深嵌套填充。边界连续、自然弯曲、有局部深核；
     * 无 grid cell、无 blur filter、无云轮廓。 */
    var clipId = 'cloudClip' + (gseq++)
    s += '<defs><clipPath id="' + clipId + '"><rect x="' + L + '" y="' + cloud.top + '" width="' + p.plotW + '" height="' + cloud.h + '"/></clipPath></defs>'
    var F0 = getField()
    var xOf = function (i) { return L + ((F0.t0 + i * F0.dt) / 24) * p.plotW }
    var yOf = function (j) { return yAlt(F0.a0 + j * F0.da) }
    var bandPaths = ''
    ;[[10, 0], [25, 1], [50, 2], [75, 3], [90, 4]].forEach(function (bd) {
      var d = ''
      isoLoops(bd[0], xOf, yOf).forEach(function (lp) {
        d += 'M' + lp.map(function (pt) { return pt.x.toFixed(1) + ',' + pt.y.toFixed(1) }).join('L') + 'Z'
      })
      if (d) bandPaths += '<path d="' + d + '" fill="' + BINS[bd[1]].color + '" fill-rule="evenodd"/>'
    })
    s += '<g clip-path="url(#' + clipId + ')">' + bandPaths + '</g>'

    /* --- ③b debug=2：原始 Open-Meteo 采样点叠加（audit 用） ---
     * 每个圆点 = 一个有效气压层样本（位置 = 位势高度，时刻 = 整点）。
     * 尖角/楔形来自数据、插值还是等值带，用它直接对照。 */
    if (DEBUG2 && DATA.rawSamples) {
      var dots = ''
      DATA.rawSamples.forEach(function (sp) {
        if (sp.alt < ALT0 - 150 || sp.alt > ALT1 + 150) return
        dots += '<circle cx="' + p.X(sp.t).toFixed(1) + '" cy="' + yAlt(Math.max(ALT0, Math.min(ALT1, sp.alt))).toFixed(1) + '" r="1.8" fill="#fff" fill-opacity="0.85" stroke="' + C.you + '" stroke-width="0.7"/>'
      })
      s += '<g clip-path="url(#' + clipId + ')">' + dots + '</g>'
      s += '<text x="' + (L + 4) + '" y="' + (cloud.top + 10) + '" font-size="7" fill="' + C.you + '" stroke="#fff" stroke-width="2" paint-order="stroke">○ 原始 Open-Meteo 采样点（hPa 层 · 位势高度定位）</text>'
    }

    /* --- ④ 3500 m 参考线 + 入云交线（field(t,3500) ≥ IN_C 的时段） --- */
    /* 用户海拔可能在剖面范围之外（如成都 500 m）——钳到边界并在标签注明 */
    var youY = yAlt(Math.max(ALT0, Math.min(ALT1, ELEV)))
    var youTag = ELEV < ALT0 ? '（剖面下方）' : ELEV > ALT1 ? '（剖面上方）' : ''
    s += '<line x1="' + L + '" y1="' + youY.toFixed(1) + '" x2="' + (L + p.plotW) + '" y2="' + youY.toFixed(1) + '" stroke="' + C.you + '" stroke-width="1" stroke-dasharray="4 3"/>'
    laneEvents().forEach(function (ev) {
      if (ev.key !== 'in') return
      var xA = p.x0(ev.from), xB = p.x0(ev.to + 1)
      s += '<line x1="' + xA.toFixed(1) + '" y1="' + youY.toFixed(1) + '" x2="' + xB.toFixed(1) + '" y2="' + youY.toFixed(1) + '" stroke="' + C.inCloud + '" stroke-width="2.5" stroke-linecap="round"/>'
    })
    s += '<text x="' + (L + p.plotW - 4) + '" y="' + (youY - 4).toFixed(1) + '" text-anchor="end" font-size="7.5" font-weight="600" fill="' + C.you + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">你 · ' + fmtM(ELEV) + ' m' + youTag + '</text>'

    /* 云场左轴刻度 */
    ;[2000, 3000, 4000, 5000].forEach(function (a) {
      s += '<text x="' + (L - 5) + '" y="' + (yAlt(a) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">' + a + '</text>'
    })
    s += '<text x="' + (L - 5) + '" y="' + (yAlt(6000) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">6000 m</text>'

    /* --- ⑤ 降水 --- */
    if (prec) {
      function yPrec(v) { return prec.bot - (v / 3) * (prec.bot - prec.top - 2) }
      var bars = ''
      HOURS.forEach(function (hh, h) {
        var total = hh.precip + hh.showers
        if (total < 0.05) return
        var bw = p.colW * 0.62, x = p.X(h) - bw / 2
        var hTot = prec.bot - yPrec(total)
        if (hh.precip >= 0.05) {
          var hRain = (hh.precip / total) * hTot
          bars += '<rect x="' + x.toFixed(1) + '" y="' + (prec.bot - hRain).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hRain.toFixed(1) + '" fill="' + C.rain + '"/>'
        }
        if (hh.showers >= 0.05) {
          var hSh = (hh.showers / total) * hTot
          bars += '<rect x="' + x.toFixed(1) + '" y="' + yPrec(total).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hSh.toFixed(1) + '" fill="' + C.shower + '"/>'
        }
      })
      s += '<g>' + bars + '</g>'
      ;[0, 1, 2].forEach(function (v) {
        s += '<text x="' + (L - 5) + '" y="' + (yPrec(v) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">' + v + '</text>'
      })
      s += '<text x="' + (L - 5) + '" y="' + (yPrec(3) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">3 mm</text>'
    }

    /* --- ⑥ 温度（主线） --- */
    if (temp) {
      function yTemp(t) { var zt = temp.top + 32, zb = temp.bot - 2; return zb - (t / 16) * (zb - zt) }
      var tPts = HOURS.map(function (hh, h) { return { x: p.X(h), y: yTemp(hh.temp) } })
      var curve = smooth(tPts)
      s += '<path d="' + curve + ' L' + (L + p.plotW) + ',' + (temp.bot - 2) + ' L' + L + ',' + (temp.bot - 2) + ' Z" fill="' + C.tempFill + '"/>'
      s += '<path d="' + curve + '" fill="none" stroke="' + C.temp + '" stroke-width="1.5"/>'
      var minI = 0, maxI = 0
      HOURS.forEach(function (hh, h) {
        if (hh.temp < HOURS[minI].temp) minI = h
        if (hh.temp > HOURS[maxI].temp) maxI = h
      })
      var icons = ''
      for (h = 0; h < N; h += 3) {
        var hh = HOURS[h], x = p.X(h)
        icons += '<use href="#' + iconId(hh.code, h) + '" x="' + (x - 6.5).toFixed(1) + '" y="' + (temp.top + 3) + '" width="13" height="13" color="#4a4f4a"/>'
        icons += '<text x="' + x.toFixed(1) + '" y="' + (temp.top + 27) + '" text-anchor="middle" font-size="8.5" font-weight="500" fill="' + C.ink + '" stroke="#fff" stroke-width="2" paint-order="stroke">' + Math.round(hh.temp) + '°</text>'
        icons += '<circle cx="' + x.toFixed(1) + '" cy="' + yTemp(hh.temp).toFixed(1) + '" r="1.6" fill="' + C.temp + '"/>'
      }
      s += '<g>' + icons + '</g>'
      s += '<text x="' + (p.X(maxI) - 7).toFixed(1) + '" y="' + (yTemp(HOURS[maxI].temp) - 2).toFixed(1) + '" text-anchor="end" font-size="8" font-weight="600" fill="' + C.temp + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">高 ' + Math.round(HOURS[maxI].temp) + '°</text>'
      s += '<text x="' + (p.X(minI) + 7).toFixed(1) + '" y="' + (yTemp(HOURS[minI].temp) + 9).toFixed(1) + '" text-anchor="start" font-size="8" font-weight="600" fill="' + C.temp + '" stroke="#fff" stroke-width="2.5" paint-order="stroke">低 ' + Math.round(HOURS[minI].temp) + '°</text>'
      ;[0, 8].forEach(function (t) {
        s += '<text x="' + (L - 5) + '" y="' + (yTemp(t) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">' + t + '°</text>'
      })
      s += '<text x="' + (L - 5) + '" y="' + (yTemp(16) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">16°</text>'
    }

    /* --- ⑦ 风（底部辅助，细线） --- */
    if (wind) {
      function yWind(v) { var zt = wind.top + 20, zb = wind.bot - 2; return zb - (v / 30) * (zb - zt) }
      var arrows = ''
      HOURS.forEach(function (hh, h) {
        arrows += '<g transform="translate(' + p.X(h).toFixed(1) + ',' + (wind.top + 9) + ') rotate(' + ((hh.windDir + 180) % 360).toFixed(0) + ')" stroke="' + C.arrowSoft + '" stroke-width="0.9" stroke-linecap="round" fill="none">' +
          '<line x1="0" y1="4" x2="0" y2="-3.2"/><path d="M-2.3,-1.1 L0,-3.6 L2.3,-1.1"/></g>'
      })
      s += '<g>' + arrows + '</g>'
      var wPts = HOURS.map(function (hh, h) { return { x: p.X(h), y: yWind(hh.wind) } })
      var gPts = HOURS.map(function (hh, h) { return { x: p.X(h), y: yWind(hh.gust) } })
      s += '<path d="' + smooth(gPts) + '" fill="none" stroke="' + C.gust + '" stroke-width="0.9"/>'
      s += '<path d="' + smooth(wPts) + '" fill="none" stroke="' + C.wind + '" stroke-width="1.1"/>'
      ;[0, 10, 20].forEach(function (v) {
        s += '<text x="' + (L - 5) + '" y="' + (yWind(v) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">' + v + '</text>'
      })
      s += '<text x="' + (L - 5) + '" y="' + (yWind(30) + 2.5).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="' + C.mut + '">30 km/h</text>'
    }

    /* --- ⑧ 日期条 / 时间轴 + OURTRAIL 事件道 --- */
    s += '<text x="' + (L + p.plotW / 2) + '" y="' + (p.dayTop + 10) + '" text-anchor="middle" font-size="9" font-weight="600" fill="#545954" letter-spacing="0.08em">' + DATA.meta.weekday + ' · ' + DATA.meta.date.replace(/-0?/, '.').replace('-', '.') + '</text>'
    s += '<text x="' + (L + p.plotW) + '" y="' + (p.dayTop + 10) + '" text-anchor="end" font-size="8" fill="' + C.faint + '">日出 ' + DATA.meta.sunrise + ' · 日落 ' + DATA.meta.sunset + '</text>'

    var axis = ''
    for (h = 1; h < N; h++) {
      axis += '<line x1="' + p.X(h).toFixed(1) + '" y1="' + p.plotBot + '" x2="' + p.X(h).toFixed(1) + '" y2="' + (p.plotBot + (h % 2 === 0 ? 3.5 : 2)) + '" stroke="' + C.axis + '" stroke-width="0.7"/>'
    }
    for (h = 0; h < N; h += 2) {
      if (sel === h) continue
      axis += '<text x="' + p.X(h).toFixed(1) + '" y="' + (p.plotBot + 13) + '" text-anchor="middle" font-size="8" fill="' + C.mut + '">' + ('0' + h).slice(-2) + '</text>'
    }
    s += '<g>' + axis + '</g>'

    s += '<line x1="' + L + '" y1="' + (p.laneTop - 3) + '" x2="' + (L + p.plotW) + '" y2="' + (p.laneTop - 3) + '" stroke="' + C.grid + '" stroke-width="0.6"/>'
    s += '<text x="0" y="' + (p.laneTop + 8) + '" font-size="6.5" letter-spacing="0.1em" fill="#a0a39c">OURTRAIL</text>'
    var lane = ''
    laneEvents().forEach(function (ev) {
      var xA = p.x0(ev.from), xB = p.x0(ev.to + 1)
      var col = ev.key === 'ok' ? 'rgba(22,62,53,0.5)' : 'rgba(180,118,26,0.5)'
      var txtCol = ev.key === 'ok' ? C.you : '#8a5a12'
      lane += '<line x1="' + xA.toFixed(1) + '" y1="' + (p.laneTop + 10.5) + '" x2="' + xB.toFixed(1) + '" y2="' + (p.laneTop + 10.5) + '" stroke="' + col + '" stroke-width="2.5" stroke-linecap="round"/>'
      lane += '<line x1="' + (xA + 0.5).toFixed(1) + '" y1="' + (p.laneTop + 8.5) + '" x2="' + (xA + 0.5).toFixed(1) + '" y2="' + (p.laneTop + 12.5) + '" stroke="' + col + '" stroke-width="0.8"/>'
      lane += '<line x1="' + (xB - 0.5).toFixed(1) + '" y1="' + (p.laneTop + 8.5) + '" x2="' + (xB - 0.5).toFixed(1) + '" y2="' + (p.laneTop + 12.5) + '" stroke="' + col + '" stroke-width="0.8"/>'
      if (xB - xA >= p.colW * 3) {
        lane += '<text x="' + (xA + 2).toFixed(1) + '" y="' + (p.laneTop + 7) + '" text-anchor="start" font-size="7" font-weight="600" fill="' + txtCol + '">' + (ev.key === 'ok' ? '云海' : '入云') + '</text>'
      }
    })
    s += '<g>' + lane + '</g>'

    /* --- ⑨ 选中时刻（细线 + 极轻列洗 + 克制小高亮 + 时间牌） --- */
    if (sel != null && sel >= 0 && sel < N) {
      var sh = HOURS[sel], sx = p.X(sel)
      s += '<g pointer-events="none">'
      s += '<rect x="' + p.x0(sel).toFixed(1) + '" y="' + p.plotTop + '" width="' + p.colW.toFixed(1) + '" height="' + (p.plotBot - p.plotTop) + '" fill="' + C.selWash + '"/>'
      s += '<line x1="' + sx.toFixed(1) + '" y1="' + (p.plotTop - 2) + '" x2="' + sx.toFixed(1) + '" y2="' + (p.plotBot + 4) + '" stroke="' + C.you + '" stroke-width="0.5" opacity="0.4"/>'
      if (temp) {
        function yTemp(t) { var zt = temp.top + 32, zb = temp.bot - 2; return zb - (t / 16) * (zb - zt) }
        s += '<circle cx="' + sx.toFixed(1) + '" cy="' + yTemp(sh.temp).toFixed(1) + '" r="2.3" fill="#fff" stroke="' + C.you + '" stroke-width="0.9"/>'
      }
      if (prec && sh.precip + sh.showers >= 0.05) {
        function yPrec(v) { return prec.bot - (v / 3) * (prec.bot - prec.top - 2) }
        var bw2 = p.colW * 0.62, bh = prec.bot - yPrec(sh.precip + sh.showers)
        s += '<rect x="' + (sx - bw2 / 2 - 1).toFixed(1) + '" y="' + (yPrec(sh.precip + sh.showers) - 1).toFixed(1) + '" width="' + (bw2 + 2).toFixed(1) + '" height="' + (bh + 1).toFixed(1) + '" fill="none" stroke="' + C.you + '" stroke-width="0.7"/>'
      }
      if (wind) {
        function yWind(v) { var zt = wind.top + 20, zb = wind.bot - 2; return zb - (v / 30) * (zb - zt) }
        s += '<circle cx="' + sx.toFixed(1) + '" cy="' + yWind(sh.wind).toFixed(1) + '" r="2" fill="#fff" stroke="' + C.you + '" stroke-width="0.8"/>'
        s += '<circle cx="' + sx.toFixed(1) + '" cy="' + yWind(sh.gust).toFixed(1) + '" r="1.7" fill="#fff" stroke="' + C.you + '" stroke-width="0.7"/>'
      }
      s += '<rect x="' + (sx - 11).toFixed(1) + '" y="' + (p.plotBot + 6) + '" width="22" height="11" rx="2" fill="' + C.you + '"/>'
      s += '<text x="' + sx.toFixed(1) + '" y="' + (p.plotBot + 13.5) + '" text-anchor="middle" font-size="7" font-weight="600" fill="#fff">' + ('0' + sel).slice(-2) + ':00</text>'
      s += '</g>'
    }

    /* --- ⑩ 点击热区 --- */
    for (h = 0; h < N; h++) {
      s += '<rect class="hit" data-h="' + h + '" x="' + p.x0(h).toFixed(1) + '" y="' + p.dayTop + '" width="' + p.colW.toFixed(1) + '" height="' + (p.axisTop - p.dayTop) + '" fill="transparent"/>'
    }

    svg.setAttribute('viewBox', '0 0 ' + p.w + ' ' + p.H)
    svg.setAttribute('width', p.w)
    svg.setAttribute('height', p.H)
    svg.innerHTML = buildDefs() + s
  }

  /* ---------- 读数条：云行来自场采样（3500 m 云量 / 密集区间 / 推导状态） ---------- */

  var readoutEl = document.getElementById('readout')

  function renderReadout() {
    if (sel == null) {
      readoutEl.innerHTML = '<span class="ro-hint">点按图表任意时刻列 —— 读取该时刻的天气事实</span>'
      return
    }
    var hh = HOURS[sel]
    var st = fieldState(sel)
    var precip = hh.precip + hh.showers

    var l1 = '<span class="ro-time">' + hh.t + '</span>' +
      '<span class="ro-temp">' + hh.temp.toFixed(1) + '°</span>' +
      '<span class="ro-cond">' + wordOf(hh.code) + '</span>' +
      (precip >= 0.05 ? '<span class="ro-precip">降水 ' + precip.toFixed(1) + ' mm/h</span>' : '')

    var cUser = Math.round(fieldAt(sel, ELEV))
    var span = denseSpan(sel)
    var l2
    if (span) {
      l2 = '<span class="ro-num">云量 ' + span.peak + '%</span><span class="ro-dim"> · 云区 </span><span class="ro-num">' + fmtM(span.lo) + '–' + fmtM(span.hi) + ' m</span>' +
        (st ? '<span class="ro-arrow">→</span><span class="ro-state ' + st.key + '">' + st.word + '</span>' : '')
    } else {
      l2 = '<span class="ro-dim">3500 m 云量 </span><span class="ro-num">' + cUser + '%</span>' +
        '<span class="ro-dim"> · 低/中/高 </span><span class="ro-num">' + hh.cloud.low + '/' + hh.cloud.mid + '/' + hh.cloud.high + '</span>' +
        (st ? '<span class="ro-arrow">→</span><span class="ro-state ' + st.key + '">' + st.word + '</span>' : '')
    }

    var l3 = '<span class="ro-dim">风 </span><span class="ro-num">' + hh.wind + '</span><span class="ro-dim"> km/h · 阵 </span><span class="ro-num">' + hh.gust + '</span><span class="ro-dim"> · </span>' + roseOf(hh.windDir) + ' ' + arrowCharOf(hh.windDir)

    readoutEl.innerHTML =
      '<div class="ro-primary">' + l1 + '</div>' +
      '<div class="ro-cloud">' + l2 + '</div>' +
      '<div class="ro-rest">' + l3 + '</div>'
  }

  /* ---------- 页头 / 图例 / 页脚 ---------- */

  function renderHeader() {
    var min = Math.round(Math.min.apply(null, HOURS.map(function (x) { return x.temp })))
    var max = Math.round(Math.max.apply(null, HOURS.map(function (x) { return x.temp })))
    document.getElementById('hdr-name').textContent = DATA.point.name
    document.getElementById('hdr-elev').textContent = fmtM(ELEV) + ' m'
    document.getElementById('hdr-range').textContent = min + '° / ' + max + '°'
    document.getElementById('hdr-summary').textContent = DATA.meta.summary
    document.getElementById('hdr-sub').innerHTML =
      DATA.meta.weekday + ' ' + DATA.meta.date.replace('-', '.') + ' · ' + DATA.meta.window +
      ' <span class="dim">· 更新 ' + DATA.meta.updatedAt + '</span>'
  }

  function renderLegend() {
    var row1 = []
    row1.push('<span class="lg-item"><span class="lg-title">云量</span><span class="sw-ramp"></span><span class="lg-dim">淡→浓</span></span>')
    row1.push('<span class="lg-item"><span class="sw-line" style="border-color:' + C.rain + '"></span>连续雨</span>')
    row1.push('<span class="lg-item"><span class="sw-line" style="border-color:' + C.shower + '"></span>阵雨</span>')
    row1.push('<span class="lg-item"><span class="sw-line" style="border-color:' + C.temp + '"></span>温度</span>')
    row1.push('<span class="lg-item"><span class="sw-line" style="border-color:' + C.wind + '"></span>风速</span>')
    row1.push('<span class="lg-item"><span class="sw-line" style="border-color:' + C.gust + '"></span>阵风</span>')
    var row2 = '<span class="lg-item"><span class="sw-arrow">↗</span>风向箭头指向吹去的方向</span>'
    document.getElementById('legend').innerHTML =
      '<div class="lg-row">' + row1.join('') + '</div>' +
      '<div class="lg-row">' + row2 + '</div>'
  }

  /* ---------- 交互 ---------- */

  svg.addEventListener('pointerdown', function (ev) {
    var t = ev.target.closest ? ev.target.closest('.hit') : null
    if (!t) return
    var h = Number(t.getAttribute('data-h'))
    sel = (sel === h) ? null : h
    render()
    renderReadout()
  })

  var tbw = document.getElementById('tb-w')
  document.getElementById('toolbar').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-w]')
    if (!b) return
    var w = Number(b.getAttribute('data-w'))
    phone.style.width = w > 0 ? w + 'px' : ''
    tbw.textContent = w > 0 ? w + ' px' : '430 px（满宽上限）'
    document.querySelectorAll('#toolbar button').forEach(function (x) { x.classList.toggle('active', x === b) })
  })

  var raf = 0
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(render)
    }).observe(phone)
  } else {
    window.addEventListener('resize', render)
  }

  if (DEBUG) document.body.classList.add('debug')
  var realKey = (/[?&]real=([a-z]+)/.exec(location.search) || [])[1]
  function boot() {
    renderHeader()
    renderLegend()
    render()
    renderReadout()
  }
  if (realKey && window.OT_REAL && window.OT_REAL.LOCATIONS[realKey]) {
    readoutEl.innerHTML = '<span class="ro-hint">正在获取 Open-Meteo 真实数据（' + window.OT_REAL.LOCATIONS[realKey].label + '）…</span>'
    window.OT_REAL.load(realKey).then(function (d) {
      setData(d)
      boot()
    }).catch(function (e) {
      console.warn('[meteogram] 真实数据获取失败：', e)
      readoutEl.innerHTML = '<span class="ro-hint">真实数据获取失败（' + (e && e.message || e) + '）—— 已回退 mock 数据</span>'
      boot()
    })
  } else {
    boot()
  }
})()
