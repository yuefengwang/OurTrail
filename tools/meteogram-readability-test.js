/* 统一 Meteogram 可读性回归门（2026-10-09 Weather V2 审计 §七）
 *
 * 这一层此前完全没有测试钉住：柱宽不随时间窗缩放、缺测小时被画成量程中点、
 * 0.1mm 降水只有 0.2px——三处都是**改代码前跑不出红**的状态。
 * 本套件全部从渲染出来的 SVG 里解析真实图元来判，不看源码字符串。
 * 运行：node tools/meteogram-readability-test.js
 */
'use strict'

const UMG = require('../miniprogram/utils/meteogram-svg.js')

let passed = 0, failed = 0
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
function section (t) { console.log('\n== ' + t + ' ==') }

const CLOUD = {
  times: [...Array(72).keys()],
  altitudes: (() => { const g = []; for (let a = 0; a <= 7000; a += 250) g.push(a); return g })(),
  values: [...Array(72).keys()].map(() => Array(29).fill(0)),
  covered: { lo: 250, hi: 6750 },
}
/** 造逐时序列：opts.gapHours 的温度置 null，opts.precip(h) 决定降水量 */
function surface (n, opts) {
  opts = opts || {}
  return [...Array(n).keys()].map(h => ({
    t: '00', d: '2026-10-0' + (1 + Math.floor(h / 24)),
    temp: (opts.gapHours || []).indexOf(h) >= 0 ? null : 8 + Math.sin(h / 4) * 5,
    feels: 7, pop: opts.pop != null ? opts.pop(h) : (h % 6 === 0 ? 62 : 12),
    precip: opts.precip ? opts.precip(h) : 0, showers: opts.showers ? opts.showers(h) : 0,
    code: 1, wind: 6 + (h % 5), gust: 14 + (h % 7), windDir: (h * 17) % 360, rh: 60,
    cloud: { low: 10, mid: 10, high: 10 }, uv: 3, visibility: 22, freezing: 4000,
  }))
}
function render (n, width, opts) {
  const geo = UMG.buildUnified({
    surface: surface(n, opts), cloudField: Object.assign({}, CLOUD,
      { times: [...Array(n).keys()], values: [...Array(n).keys()].map(() => Array(29).fill(0)) }),
    userAltitude: 3000, elevSource: 'picked', width: width, horizon: n,
  })
  return { geo: geo, svg: UMG.renderUnifiedBase(geo, {}).svg }
}
/* 雨柱与阵雨柱都要收：只收 #346583 时，bars[1] 其实是四小时后的另一根雨柱，
   「同小时两柱」的断言就会比错对象（本轮自己踩到，间隙读出 50.4px）。 */
function rainBars (svg) {
  return [...svg.matchAll(/<rect x="(-?[0-9.]+)" y="(-?[0-9.]+)" width="([0-9.]+)" height="([0-9.]+)" fill="(#346583|#2E8B8B)"/g)]
    .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], kind: m[5] }))
}
function onlyRain (bars) { return bars.filter(b => b.kind === '#346583') }
function washes (svg) {
  return [...svg.matchAll(/<rect x="(-?[0-9.]+)" y="84" width="([0-9.]+)" height="42" fill="rgba\(52,101,131,0\.10\)"/g)]
    .map(m => ({ x: +m[1], w: +m[2] }))
}
function pathPoints (svg) {
  const m = svg.match(/<path d="(M[^"]+)" fill="none" stroke="#202A26"/)
  if (!m) return { d: '', pts: [] }
  return { d: m[1], pts: [...m[1].matchAll(/(-?[0-9.]+),(-?[0-9.]+)/g)].map(p => ({ x: +p[1], y: +p[2] })) }
}

/* ---------- 1. 降水柱与底带必须随时间窗缩放，且不再压叠邻时 ---------- */
section('1 降水柱宽与对齐（24/48/72h）')
;[24, 48, 72].forEach(hz => {
  const { geo, svg } = render(hz, 375, { precip: h => (h % 4 === 0 ? 3 : 0), showers: h => (h % 4 === 0 ? 1.5 : 0) })
  const cell = geo.plotW / hz
  const bars = rainBars(svg)
  const rain = onlyRain(bars)
  check(hz + 'h：解析到降水柱（否则本节是空断言）', bars.length >= 4, '柱数 ' + bars.length)
  check(hz + 'h：单柱宽 ≤ 0.35 cell', bars.every(b => b.w <= cell * 0.35 + 0.05),
    'cell=' + cell.toFixed(2) + ' 柱宽=' + bars[0].w)
  check(hz + 'h：雨+阵雨双柱加间隙不超一格（相邻小时不重叠）', 2 * bars[0].w + 1 <= cell + 0.05,
    '2bw+1=' + (2 * bars[0].w + 1).toFixed(2) + ' vs cell=' + cell.toFixed(2))
  const centers = rain.map(b => b.x + b.w / 2)
  let minGap = Infinity
  for (let i = 1; i < centers.length; i++) minGap = Math.min(minGap, centers[i] - centers[i - 1])
  check(hz + 'h：同小时两柱间隙恒为 1px（柱仍归属它自己的小时）', bars.length >= 2 && bars[0].kind === '#346583' && bars[1].kind === '#2E8B8B' && Math.abs(bars[1].x - (bars[0].x + bars[0].w) - 1) < 0.15,
    '间隙 ' + (bars.length > 1 ? (bars[1].x - (bars[0].x + bars[0].w)).toFixed(2) : '—') + ' 柱序 ' + bars.slice(0,2).map(b=>b.kind).join(','))
  check(hz + 'h：两柱合起来仍以该小时中心对称', bars.length >= 2 && Math.abs(((bars[0].x + bars[1].x + bars[1].w) / 2) - geo.X(0)) < 0.2)
  const ws = washes(svg)
  check(hz + 'h：pop≥50 底带宽度恰为一格', ws.length > 0 && ws.every(w => Math.abs(w.w - cell) < 0.15),
    '底带宽=' + (ws[0] ? ws[0].w : '—') + ' cell=' + cell.toFixed(2))
})

/* ---------- 2. 微量降水可见，但不夸大相对量 ---------- */
section('2 微量降水：看得见，也不被吹大')
const tiny = render(24, 375, { precip: h => (h === 3 ? 18 : h === 9 ? 0.1 : h === 10 ? 2 : 0) })
const tb = rainBars(tiny.svg)
check('解析到三根柱（18 / 0.1 / 2 mm）', onlyRain(tb).length === 3, JSON.stringify(onlyRain(tb).map(b => b.h)))
const [big, trace, small] = onlyRain(tb)
check('0.1 mm 柱高 ≥1.2px（旧实现只有 0.2px，等于看不见）', trace.h >= 1.2, '实际 ' + trace.h)
check('18 mm 与 2 mm 仍是线性比例（下限没有扭曲可读量程）',
  Math.abs((big.h / small.h) - 9) / 9 < 0.05, '比值 ' + (big.h / small.h).toFixed(2) + ' 应为 9')
check('可见下限只吃亚像素量：2mm 柱高远高于 1.2px 下限', small.h > 3 * trace.h, '2mm=' + small.h + ' 0.1mm=' + trace.h)

/* ---------- 3. 缺测温度不许被画成编造值 ---------- */
section('3 缺测小时：断开，不补值')
const gap = render(24, 375, { gapHours: [5, 6] })
const midY = gap.geo.temp.y((gap.geo.temp.lo + gap.geo.temp.hi) / 2)
const gp = pathPoints(gap.svg)
check('曲线在缺测小时处没有出现「量程中点」顶点',
  !gp.pts.some(p => Math.abs(p.y - midY) < 0.7 &&
    (Math.abs(p.x - gap.geo.X(5)) < 0.7 || Math.abs(p.x - gap.geo.X(6)) < 0.7)),
  '量程中点 y=' + midY.toFixed(2))
check('曲线被拆成两段（两个 M），缺口两侧不再被一条线连起来',
  (gp.d.match(/M/g) || []).length === 2, 'M 数 = ' + (gp.d.match(/M/g) || []).length)
const lone = render(24, 375, { gapHours: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] })
check('只剩孤立一小时时改用圆点表达（不画假线段、也不让该点消失）',
  /<circle cx="[0-9.]+" cy="[0-9.]+" r="1.6"/.test(lone.svg) && (pathPoints(lone.svg).d.match(/M/g) || []).length === 0)
const sel = UMG.renderUnifiedSelection(gap.geo, { selectedAbs: 5 })
check('选中缺测小时：读数层不画温度圆点（少一个点也比放一个假数据好）',
  !sel.svg.includes('#163e35" stroke-width="0.9"') || !/<circle[^>]+cy="64/.test(sel.svg),
  sel.svg.slice(0, 160))
const sel2 = UMG.renderUnifiedSelection(gap.geo, { selectedAbs: 3 })
check('反对照：选中正常小时仍然画温度圆点', /<circle cx="[0-9.]+" cy="[0-9.]+" r="2.3"/.test(sel2.svg))

/* ---------- 4. 选中层高亮框套住真实柱体 ---------- */
section('4 选中高亮框与柱体同源')
;[24, 72].forEach(hz => {
  const { geo, svg } = render(hz, 375, { precip: h => (h % 4 === 0 ? 4 : 0) })
  const bars = rainBars(svg)
  const b0 = bars[0]
  const sel = UMG.renderUnifiedSelection(geo, { selectedAbs: 0 })
  const box = sel.svg.match(/<rect x="(-?[0-9.]+)" y="[0-9.]+" width="([0-9.]+)" height="[0-9.]+" fill="none" stroke="#163e35"/)
  check(hz + 'h：高亮框存在且横向套住该小时的雨柱', !!box && +box[1] <= b0.x + 0.1,
    box ? '框 x=' + box[1] + ' 柱 x=' + b0.x : '无框')
})

/* ---------- 5. 窄屏三档宽度：轴标签不重叠、图元不出界 ---------- */
section('5 375 / 390 / 414 × 24 · 48 · 72h')
;[375, 390, 414].forEach(w => {
  ;[24, 48, 72].forEach(hz => {
    const { geo, svg } = render(hz, w, { precip: h => (h % 5 === 0 ? 2.5 : 0) })
    const labels = [...svg.matchAll(/<text x="([0-9.]+)" y="(40[0-9])" text-anchor="middle" font-size="8"/g)].map(m => +m[1])
    let minGap = Infinity
    for (let i = 1; i < labels.length; i++) minGap = Math.min(minGap, labels[i] - labels[i - 1])
    check(w + 'px ' + hz + 'h：' + labels.length + ' 个时间标签中心距 ≥ 字宽（8px 字号两位数字≈9px）',
      labels.length >= 6 && minGap >= 9.5, '最小间距 ' + minGap.toFixed(1))
    const xs = [...svg.matchAll(/x="(-?[0-9.]+)"/g)].map(m => +m[1])
    check(w + 'px ' + hz + 'h：没有图元跑到画布外', xs.every(x => x >= -1 && x <= w + 1),
      'x 范围 ' + Math.min.apply(null, xs).toFixed(1) + '…' + Math.max.apply(null, xs).toFixed(1))
  })
})

/* ---------- 6. 昼夜底与日界线按天分段 ---------- */
section('6 多日昼夜底与日界')
const sunTimes = [{ rise: 7.6, set: 19.1 }, { rise: 7.7, set: 19.0 }, { rise: 7.8, set: 18.9 }]
const geo48 = UMG.buildUnified({ surface: surface(48), cloudField: Object.assign({}, CLOUD, { times: [...Array(48).keys()], values: [...Array(48).keys()].map(() => Array(29).fill(0)) }), userAltitude: 3000, width: 375, horizon: 48 })
const svg48 = UMG.renderUnifiedBase(geo48, { sunTimes: sunTimes }).svg
check('48h 生成两段昼夜渐变（每天一段，而不是整幅一条）',
  (svg48.match(/<linearGradient id="udn\d"/g) || []).length === 2,
  '渐变数 ' + (svg48.match(/<linearGradient id="udn\d"/g) || []).length)
check('48h 画出一条日界线（第二天开始处）',
  (svg48.match(/stroke="#D3D5CD" stroke-width="1"\/>/g) || []).length >= 1)
const svg48b = UMG.renderUnifiedBase(geo48, { sunTimes: [null, sunTimes[1]] }).svg
check('某天缺日出日落数据时只画有数据的那天（不拿默认值蒙混成整幅白昼）',
  (svg48b.match(/<linearGradient id="udn\d"/g) || []).length === 1)

/* ---------- 7. 风向箭头：语义与密度（§7.3） ---------- */
section('7 风向箭头')
const wGeo = UMG.buildUnified({
  surface: (() => { const a = surface(24); a.forEach(r => { r.windDir = 0 }); return a })(),
  cloudField: Object.assign({}, CLOUD, { times: [...Array(24).keys()], values: [...Array(24).keys()].map(() => Array(29).fill(0)) }),
  userAltitude: 3000, width: 375, horizon: 24,
})
const wSvg = UMG.renderUnifiedBase(wGeo, {}).svg
const rots = [...wSvg.matchAll(/rotate\((-?[0-9.]+)\)"/g)].map(m => +m[1])
check('windDir=0（北风，从北吹来）→ 箭头画成 180°（指向南方），不是 0°',
  rots.length > 0 && rots.every(r => r === 180), '角度集 ' + JSON.stringify(rots.slice(0, 4)) + '（共 ' + rots.length + ' 支）')
const wGeo2 = UMG.buildUnified({
  surface: (() => { const a = surface(24); a.forEach(r => { r.windDir = 90 }); return a })(),
  cloudField: Object.assign({}, CLOUD, { times: [...Array(24).keys()], values: [...Array(24).keys()].map(() => Array(29).fill(0)) }),
  userAltitude: 3000, width: 375, horizon: 24,
})
const rots2 = [...UMG.renderUnifiedBase(wGeo2, {}).svg.matchAll(/rotate\((-?[0-9.]+)\)"/g)].map(m => +m[1])
check('windDir=90（东风）→ 270°（吹向西），映射是「吹向」而不是「来自」',
  rots2.length > 0 && rots2.every(r => r === 270), '角度集 ' + JSON.stringify(rots2.slice(0, 4)))
;[24, 48, 72].forEach(hz => {
  const { geo, svg } = render(hz, 375, {})
  const step = hz <= 24 ? 1 : hz <= 48 ? 2 : 3
  const n = [...svg.matchAll(/rotate\(/g)].length
  const cell = geo.plotW / hz
  check(hz + 'h：箭头数 = ceil(小时数/步长) 且间距 ≥10px（不密到糊成一片）',
    n === Math.ceil(geo.nT / step) && cell * step >= 10, '箭头 ' + n + ' 支，间距 ' + (cell * step).toFixed(1) + 'px')
})

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
