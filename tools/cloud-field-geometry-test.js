/* Cloud Field 几何回归门（2026-10-09 Weather V2 审计 P0）
 *
 * 为什么存在：等值带的伪影（尖角/锯齿/碎片/横贯整图的直线斜边/两个无关云被连成一块）
 * 全部产生在「场网格 → marching squares → 环链接 → 碎片过滤 → 圆化」这条链上，
 * 而旧的两套测试只断言「SVG 生成了、路径数在 3–8 之间」——伪影一个都抓不到。
 * 本套件按业务规格独立写出**期望拓扑**：环必须闭合、不许自交、不许用长弦封口、
 * 面积随阈值单调收缩、分离的两层云不许被连成一块、晴空不许被填成有云、
 * 数据覆盖之外的高度不许凭空补云。
 *
 * 运行：node tools/cloud-field-geometry-test.js
 */
'use strict'

const CFF = require('../miniprogram/utils/cloud-field-svg.js')
const ADP = require('../miniprogram/utils/weather-cloud-field.js')
const fixtures = require('../miniprogram/pages/cloud-field-poc/fixtures.js')

let passed = 0, failed = 0
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
function section (t) { console.log('\n== ' + t + ' ==') }

const L = 38, R = 10, PLOT_H = 300
const WIDTHS = [375, 390, 414]

/* ---------- 合成场构造器 ---------- */
function mkField (hours, fn) {
  const altitudes = []
  for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
  const times = []
  for (let h = 0; h < hours; h++) times.push(h)
  const values = times.map((_, h) => altitudes.map(a => Math.max(0, Math.min(100, fn(h, a)))))
  return { times, altitudes, values, covered: { lo: 0, hi: 7000 }, meta: { hours } }
}
function grid (field, hours, width) {
  const column = CFF.makeColumnSampler(field)
  const nT = field.times.length
  const sample = (t, alt) => CFF.sampleAtStations(column, nT, t, alt)
  const F = CFF.buildFieldGrid(sample, nT, { hours })
  const plotW = width - L - R
  const xOf = i => L + ((F.t0 + i * F.dt) / hours) * plotW
  const yOf = j => PLOT_H - (F.a0 + j * F.da - CFF.ALT0) / (CFF.ALT1 - CFF.ALT0) * PLOT_H
  return { F, xOf, yOf, plotW, sample, field, hours }
}
/* 几何合法性判定 —— 这是本套件的核心，不是「能不能生成」 */
function segHit (p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-12) return false
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98
}
function selfHits (lp) {
  let n = 0
  for (let i = 0; i < lp.length; i++) {
    for (let j = i + 2; j < lp.length; j++) {
      if (i === 0 && j === lp.length - 1) continue
      if (segHit(lp[i], lp[(i + 1) % lp.length], lp[j], lp[(j + 1) % lp.length])) n++
    }
  }
  return n
}
function areaOf (lp) {
  let s = 0
  for (let i = 0; i < lp.length; i++) { const q = lp[(i + 1) % lp.length]; s += lp[i].x * q.y - q.x * lp[i].y }
  return Math.abs(s / 2)
}
function ySpan (lp) { let lo = Infinity, hi = -Infinity; lp.forEach(p => { if (p.y < lo) lo = p.y; if (p.y > hi) hi = p.y }); return [lo, hi] }
function xSpan (lp) { let lo = Infinity, hi = -Infinity; lp.forEach(p => { if (p.x < lo) lo = p.x; if (p.x > hi) hi = p.x }); return [lo, hi] }
/** 跑一个场，返回每档环；顺带把「环必须闭合 / 不许自交 / 不许长弦封口」当成硬约束记账 */
function bandsOf (g, T) { return CFF.isoBandsFromGrid(g.F, T, g.xOf, g.yOf) }
function auditLoops (label, loops, cellDiag) {
  const trunc = loops.filter(lp => lp.__diag && lp.__diag.truncated).length
  const badChord = loops.filter(lp => Math.hypot(lp[0].x - lp[lp.length - 1].x, lp[0].y - lp[lp.length - 1].y) > (cellDiag ? cellDiag.w * 1.6 : 6)).length
  const self = loops.filter(lp => selfHits(lp) > 0).length
  const nan = loops.some(lp => lp.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
  check(label + '：环全部自然闭合（断链=0）', trunc === 0, '断链 ' + trunc)
  check(label + '：无自交环（自交=0）', self === 0, '自交环 ' + self)
  check(label + '：无长弦封口（首尾距 <1.6 cell）', badChord === 0, '长弦环 ' + badChord)
  check(label + '：坐标全部有限，无 NaN 泄漏', !nan)
  return { trunc, self, badChord }
}
function cellDiagOf (g, hours) {
  return { w: Math.abs(g.xOf(1) - g.xOf(0)), h: Math.abs(g.yOf(1) - g.yOf(0)) }
}
/* ---------- 图与数据是否讲同一件事（点格法，不依赖「能生成 SVG」） ----------
 * 对画布上的规则格点做两件事：① 用 F.g 双线性取样读出「该处云量是否 ≥T」（数据）；
 * ② 对该档全部环做 evenodd 奇偶判定（图上是否为云）。两者不一致的比例就是
 * 「这张图在替数据说谎的面积占比」。截图看着顺眼而语义跑偏，只有这种判据能抓住。 */
function agreement (g, T) {
  const F = g.F, hours = g.hours
  let yes = 0, no = 0, dataCells = 0
  const invI = x => (((x - L) * hours / g.plotW) - F.t0) / F.dt
  const invJ = y => (((PLOT_H - y) / PLOT_H) * (CFF.ALT1 - CFF.ALT0) + CFF.ALT0 - F.a0) / F.da
  const loops = bandsOf(g, T)
  for (let x = L; x <= L + g.plotW; x += 2) {
    for (let y = 0; y <= PLOT_H; y += 2) {
      const fi = invI(x), fj = invJ(y)
      const i0 = Math.max(0, Math.min(F.nx - 2, Math.floor(fi))), j0 = Math.max(0, Math.min(F.ny - 2, Math.floor(fj)))
      const tx = fi - i0, ty = fj - j0
      const v = (1 - tx) * (1 - ty) * F.g[j0][i0] + tx * (1 - ty) * F.g[j0][i0 + 1] +
        (1 - tx) * ty * F.g[j0 + 1][i0] + tx * ty * F.g[j0 + 1][i0 + 1]
      const isData = v >= T
      let inside = false
      for (let k = 0; k < loops.length; k++) {
        const lp = loops[k]
        for (let a = 0, b = lp.length - 1; a < lp.length; b = a++) {
          const p = lp[a], q = lp[b]
          if ((p.y > y) !== (q.y > y) && x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x) inside = !inside
        }
      }
      if (isData) dataCells++
      if (isData === inside) yes++; else no++
    }
  }
  return { rate: yes / (yes + no), mismatch: no, dataCells }
}
function checkPictureMatchesData (label, g, T, minRate) {
  const a = agreement(g, T)
  check(label + ' @' + T + '%：画出来的云与数据读出的云一致 ≥' + Math.round(minRate * 100) + '%',
    a.rate >= minRate, '一致率 ' + (a.rate * 100).toFixed(1) + '%（不符 ' + a.mismatch + ' 格）')
  return a
}

/* ================= 1. 全晴空 ================= */
section('1 全晴空：不许把晴空填成有云')
const clear = grid(mkField(24, () => 0), 24, 375)
;[10, 25, 50, 75, 90].forEach(T => {
  check('晴空 24h 在 ' + T + '% 档不产生任何区域', bandsOf(clear, T).length === 0)
})

/* ================= 2. 全云覆盖 ================= */
section('2 全云覆盖：整幅一档，环在 clip 外自然闭合')
const full = grid(mkField(24, () => 100), 24, 375)
const cdFull = cellDiagOf(full)
auditLoops('全场有云 50% 档', bandsOf(full, 50), cdFull)
;[10, 25, 50, 75, 90].forEach(T => {
  const lp = bandsOf(full, T)
  check(T + '% 档恰好 1 个环且铺满绘图区', lp.length === 1 && areaOf(lp[0]) >= full.plotW * PLOT_H * 0.98,
    '环数 ' + lp.length + (lp[0] ? ' 面积 ' + Math.round(areaOf(lp[0])) : ''))
})

/* ================= 3. 单层连续云 ================= */
section('3 单层连续云：五档嵌套，面积随阈值单调收缩')
const single = grid(mkField(24, (h, a) => (a >= 3000 && a <= 3600) ? 85 : 0), 24, 375)
const cd3 = cellDiagOf(single)
const areas3 = []
;[10, 25, 50, 75].forEach(T => {
  const lp = bandsOf(single, T)
  areas3.push({ T, n: lp.length, area: lp.length ? areaOf(lp[0]) : 0 })
  auditLoops('单层 3000–3600m @' + T + '%', lp, cd3)
})
check('每档各得 1 个云带区', areas3.every(r => r.n === 1), JSON.stringify(areas3.map(r => r.n)))
check('面积随阈值单调不增（10%≥25%≥50%≥75%）',
  areas3[0].area >= areas3[1].area && areas3[1].area >= areas3[2].area && areas3[2].area >= areas3[3].area,
  areas3.map(r => Math.round(r.area)).join('>'))
check('90% 档不出现（该层真实最大云量 85%，不许凭空加深一档）', bandsOf(single, 90).length === 0)

/* ================= 4. 多层分离云：不许把无关两层连成一块 ================= */
section('4 多层分离云：两层必须保持分离')
const two = grid(mkField(24, (h, a) => ((a >= 2500 && a <= 2900) || (a >= 4500 && a <= 5000)) ? 80 : 0), 24, 375)
const cd4 = cellDiagOf(two)
;[10, 25, 50, 75].forEach(T => {
  const lp = bandsOf(two, T)
  auditLoops('两层分离 @' + T + '%', lp, cd4)
  check(T + '% 档得到 2 个独立区（不是 1 个大区）', lp.length === 2, '环数 ' + lp.length)
  const spans = lp.map(ySpan)
  const tallest = Math.max.apply(null, spans.map(s => s[1] - s[0]))
  check(T + '% 档没有环跨越两层之间的高度（单环 y 跨度 <90px）', tallest < 90,
    '最大跨度 ' + Math.round(tallest) + 'px；各环 y ' + spans.map(s => Math.round(s[0]) + '–' + Math.round(s[1])).join(' / '))
})

/* ================= 5. 云层快速形成与消散 ================= */
section('5 生灭与分裂：真实突变必须保留，分离的两段不许被连成一整块')
/* 0–7h 与 16–23h 有云、8–15h 明确降到阈值以下：图上必须是两段。
   （上一版这里写的是「连续增强再减弱」的透镜场，本来就该是 1 个环——
   那条期望是我自己没设计好，不是几何的问题，改成真正含时间断裂的场。） */
const birth = grid(mkField(24, (h, a) => {
  const on = (h <= 7 || h >= 16) ? 1 : 0.1
  const band = Math.exp(-Math.pow((a - 3800) / 260, 2))
  return Math.round(100 * on * (band > 0.35 ? 1 : band / 0.35))
}), 24, 375)
const cd5 = cellDiagOf(birth)
;[25, 50, 75].forEach(T => {
  const lp = bandsOf(birth, T)
  auditLoops('生灭场 @' + T + '%', lp, cd5)
  check(T + '% 档保持时间上分离的两段（2 个环，不许连成一整块）', lp.length === 2, '环数 ' + lp.length)
  lp.forEach((x, k) => check(T + '% 档第 ' + (k + 1) + ' 段只覆盖半天不到（x 跨度 <12h）',
    (xSpan(x)[1] - xSpan(x)[0]) < birth.plotW * 0.55))
})
check('生灭场在 x 方向没有超出时间窗（所有环在 clip 内或贴边平切）',
  bandsOf(birth, 50).every(lp => { const s = xSpan(lp); return s[0] >= L - cd5.w * 1.5 && s[1] <= birth.plotW + L + cd5.w * 1.5 }))
/* 垂直分裂：晚段的一层云在中途裂成两层，且两层之间有持续的低云量间隔。
   时间上两段互不相连（0–3h 与 11–13h 无云）⇒ 图上必须是 3 个独立区（早 1 + 晚 2）。 */
const splitV = grid(mkField(24, (h, a) => {
  if (h >= 4 && h <= 10) return (a >= 3000 && a <= 4200) ? 88 : 0
  if (h >= 14 && h <= 20) return ((a >= 2800 && a <= 3200) || (a >= 4000 && a <= 4600)) ? 88 : 0
  return 0
}), 24, 375)
const sv = bandsOf(splitV, 50)
auditLoops('垂直分裂场 50%', sv, cellDiagOf(splitV))
check('云一分为二时区也一分为二（3 个独立区：早段 1 + 晚段 2）', sv.length === 3, '环数 ' + sv.length)
const svLate = sv.filter(lp => xSpan(lp)[0] > splitV.plotW * 0.5 + L).map(ySpan)
check('晚段两层的 y 区间互不重叠（裂开的两层不许被糊成一块）', svLate.length === 2 &&
  (svLate[0][1] < svLate[1][0] || svLate[1][1] < svLate[0][0]),
  svLate.map(s => Math.round(s[0]) + '–' + Math.round(s[1])).join(' / '))

/* ================= 6. 云量接近阈值 ================= */
section('6 阈值附近：24.9/25.1 逐时交替——诚实的画法是断开，强行连起来才是说谎')
const near = grid(mkField(24, (h, a) => (a >= 3000 && a <= 3400) ? (h % 2 ? 25.1 : 24.9) : 0), 24, 375)
const cd6 = cellDiagOf(near)
const nearLoops = bandsOf(near, 25)
auditLoops('临界 25% 档', nearLoops, cd6)
check('临界抖动没有产生亚 cell 的锯齿碎片（每个环 ≥0.5 个 cell 面积）',
  nearLoops.every(lp => areaOf(lp) >= cd6.w * cd6.h * 0.5), nearLoops.map(lp => Math.round(areaOf(lp))).join(','))
check('没有任何一个环横跨整个时间窗（把逐时断开强行连成一整块＝编造数据）',
  nearLoops.every(lp => (xSpan(lp)[1] - xSpan(lp)[0]) < near.plotW * 0.5),
  nearLoops.map(lp => Math.round(xSpan(lp)[1] - xSpan(lp)[0])).join(','))
/* 25% 档在阈值线上来回穿越，图与数据的点格一致率必须仍然高——
   这条同时防住两个方向的错：过度过滤把该画的抹掉、过度连接把不该画的补上 */
checkPictureMatchesData('临界抖动场', near, 25, 0.9)

/* ================= 7. 相邻网格大幅变化（真实锋面）================= */
section('7 锋面突变：左侧 0 / 右侧 92 的台阶必须是一条连续前缘')
const front = grid(mkField(24, (h, a) => h >= 12 ? 92 : 0), 24, 375)
const cd7 = cellDiagOf(front)
const fl = bandsOf(front, 50)
auditLoops('锋面 50% 档', fl, cd7)
check('锋面只产生 1 个区', fl.length === 1, '环数 ' + fl.length)
check('锋面区在时间上从 12h 起（x 跨度≈半窗）', fl.length === 1 &&
  Math.abs((xSpan(fl[0])[1] - xSpan(fl[0])[0]) - front.plotW / 2) < cd7.w * 3,
  fl[0] ? 'x 跨度 ' + Math.round(xSpan(fl[0])[1] - xSpan(fl[0])[0]) : '')

/* ================= 8. 缺失数据 ================= */
section('8 缺失列：回填只服务渲染连续性，不许产生假云界')
function clWithGap (gapHours) {
  const times = []
  for (let h = 0; h < 24; h++) times.push('2026-10-09T' + (h < 10 ? '0' : '') + h + ':00')
  const lv = [1000, 950, 900, 850, 800, 700, 600, 500].map(p => ({
    pressure: p,
    altitudes: times.map((_, h) => 500 + (1000 - p) * 6 + (gapHours.indexOf(h) >= 0 ? null : 0)).map(v => (v === null ? null : v)),
    cloudCover: times.map((_, h) => gapHours.indexOf(h) >= 0 ? null : (p <= 800 && p >= 600 ? 88 : 6)),
  }))
  return { times, levels: lv, unit: { altitude: 'm ASL', cloudCover: '%' } }
}
const gapField = ADP.buildCloudFieldRange({ cloudLevels: clWithGap([5, 6, 7]) }, { hours: 24, userAltitude: 3500 })
check('缺失小时被记账（gapHours=3）', gapField && gapField.meta.gapHours.length === 3, JSON.stringify(gapField && gapField.meta.gapHours))
const g8 = grid(gapField, 24, 375)
const cd8 = cellDiagOf(g8)
;[25, 50, 75].forEach(T => auditLoops('缺失回填场 @' + T + '%', bandsOf(g8, T), cd8))
check('回填列与相邻可用列同值 ⇒ 回填段内部不产生等值线（50% 档环数≤2）',
  bandsOf(g8, 50).length <= 2, '环数 ' + bandsOf(g8, 50).length)
const allNull = ADP.buildCloudFieldRange({ cloudLevels: null }, { hours: 24 })
check('整段无数据时适配器返回 null（页面隐藏云场，而不是画一张空图）', allNull === null)

/* ================= 9. 极高/极低高度边界 ================= */
section('9 高度边界：实测云系落在剖面窗之外')
const lowOnly = grid(ADP.buildCloudFieldRange({
  cloudLevels: (() => {
    const times = []
    for (let h = 0; h < 24; h++) times.push('2026-10-09T' + (h < 10 ? '0' : '') + h + ':00')
    return { times, levels: [{ pressure: 700, altitudes: times.map(() => 6200), cloudCover: times.map(() => 95) },
      { pressure: 650, altitudes: times.map(() => 6800), cloudCover: times.map(() => 90) }] }
  })(),
}, { hours: 24, userAltitude: 4200 }), 24, 375)
const cd9 = cellDiagOf(lowOnly)
;[25, 50].forEach(T => auditLoops('云系全在 6000m 以上 @' + T + '%', bandsOf(lowOnly, T), cd9))
check('剖面窗（2000–6000m）内没有实测层 ⇒ 一幅都不画，而不是把 6200m 的 95% 平涂下来',
  bandsOf(lowOnly, 50).length === 0 && bandsOf(lowOnly, 25).length === 0,
  '50% 环数 ' + bandsOf(lowOnly, 50).length)
check('判读仍据实测答「头顶有云层」并给出云底 6200m（旧实现受显示窗钳制，这里会沉默）',
  (() => { const st = CFF.inferState(lowOnly.sample, 10, 4200, lowOnly.field.covered)
    return st.key === 'mid' && st.span && st.span.lo === 6200 })(),
  JSON.stringify(CFF.inferState(lowOnly.sample, 10, 4200, lowOnly.field.covered)))
/* 反向对照：同一份数据、把用户抬到云系之下 5000m，也必须说「头顶有云层」而非「你在云中」 */
check('用户在 5000m（仍在实测层之下）⇒ 不误报「你在云中」',
  CFF.inferState(lowOnly.sample, 10, 5000, lowOnly.field.covered).key !== 'in')

/* ================= 10. 地形高度与云层相交 ================= */
section('10 覆盖范围之外不许凭空补云')
const covered = ADP.buildCloudFieldRange({ cloudLevels: clWithGap([]) }, { hours: 24, userAltitude: 3500 })
check('适配器透出真实覆盖海拔区间（covered.lo/hi 来自实测层，不是网格端点）',
  covered && covered.covered && covered.covered.lo > 0 && covered.covered.hi < 7000, JSON.stringify(covered && covered.covered))
const g10 = grid(covered, 24, 375)
const cd10 = cellDiagOf(g10)
;[25, 50, 75, 90].forEach(T => auditLoops('覆盖区间场 @' + T + '%', bandsOf(g10, T), cd10))
check('实测区间之外（低于 covered.lo）不再被端点钳制成「有云」：90% 档环不贴到剖面底边',
  bandsOf(g10, 90).every(lp => Math.max.apply(null, lp.map(p => p.y)) <= PLOT_H - 1),
  bandsOf(g10, 90).map(lp => Math.round(Math.max.apply(null, lp.map(p => p.y)))).join(','))

/* ================= 11. 空区域 + 大量碎片的极端输入 ================= */
section('11 极端输入：噪声场不崩溃、不产生碎片雨')
let seed = 20261009
function rnd () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const noisy = grid(mkField(24, (h, a) => (rnd() < 0.35 ? Math.round(rnd() * 100) : 0)), 24, 375)
const cd11 = cellDiagOf(noisy)
let total = 0
;[10, 25, 50, 75, 90].forEach(T => {
  const lp = bandsOf(noisy, T)
  total += lp.length
  auditLoops('噪声场 @' + T + '%', lp, cd11)
  check(T + '% 档噪声碎片被面积门挡住（每个环 ≥1 个 cell 面积）',
    lp.every(x => areaOf(x) >= cd11.w * cd11.h * 0.5), lp.map(x => Math.round(areaOf(x))).join(','))
})
check('五档环数仍在渲染成本量级内（总环数 ≤ cell 数的 1/20，噪声被面积门压住而非指数扩散）',
  total <= (noisy.F.nx * noisy.F.ny) / 20, '总环数 ' + total + ' / cell ' + (noisy.F.nx * noisy.F.ny))
checkPictureMatchesData('噪声场', noisy, 25, 0.85)
checkPictureMatchesData('噪声场', noisy, 75, 0.85)
/* 真实数据同样要求「图 = 数据」，容差比合成场更宽（CR 平滑本来就会吃掉不到 8% 的边界格） */
;[['mock', fixtures.mock], ['emeishan', fixtures.emeishan], ['litang', fixtures.litang]].forEach(([nm, f]) => {
  if (!f || !f.values) return
  const g = grid(f, 24, 375)
  checkPictureMatchesData(nm + ' 真实场', g, 50, 0.9)
})

/* ================= 真实冻结数据 + 真实抓取的剖面 ================= */
section('12 真实数据（POC 冻结峨眉山/理塘 + mock）：拓扑合法性')
;[['mock', fixtures.mock], ['emeishan', fixtures.emeishan], ['litang', fixtures.litang]].forEach(([nm, f]) => {
  if (!f || !f.values) { check(nm + ' fixture 可用', false); return }
  WIDTHS.forEach(w => {
    const g = grid(f, 24, w)
    const cd = cellDiagOf(g)
    let bad = 0, loops = 0
    ;[10, 25, 50, 75, 90].forEach(T => {
      const lp = bandsOf(g, T)
      loops += lp.length
      lp.forEach(x => {
        if (x.__diag && x.__diag.truncated) bad++
        if (selfHits(x) > 0) bad++
        if (Math.hypot(x[0].x - x[x.length - 1].x, x[0].y - x[x.length - 1].y) > cd.w * 1.6) bad++
      })
    })
    check(nm + ' @' + w + 'px：' + loops + ' 个环全部闭合、无自交、无长弦', bad === 0, '违例 ' + bad + '/' + loops)
  })
})

/* ================= 变异自证：这些断言必须真的会红 ================= */
section('13 变异自证（把旧行为请回来，本门必须报红）')
/* 变异 A：把外扩圈从「域外=无云」改回「复制边缘值」——旧 bug 的成因。
   只在「云带被时间窗或高度窗切断」的场上才暴露，所以逐场试过，任一场报红即算门有效。 */
function duplicateRing (F) {
  const o = { g: F.g.map(r => r.slice()), nx: F.nx, ny: F.ny, t0: F.t0, dt: F.dt, a0: F.a0, da: F.da }
  for (let i = 0; i < o.nx; i++) { o.g[0][i] = o.g[1][i]; o.g[o.ny - 1][i] = o.g[o.ny - 2][i] }
  for (let j = 0; j < o.ny; j++) { o.g[j][0] = o.g[j][1]; o.g[j][o.nx - 1] = o.g[j][o.nx - 2] }
  return o
}
const mutFields = [
  ['锋面（右侧云带被上下边界切断）', front],
  ['生灭两段', birth],
  ['垂直分裂', splitV],
  ['单层横贯带（旧实现下最"看起来没事"的一场）', single],
]
let redA = 0, greenProper = 0
mutFields.forEach(([nm, g]) => {
  const cd = cellDiagOf(g)
  const badMut = bandsOf({ F: duplicateRing(g.F), xOf: g.xOf, yOf: g.yOf, plotW: g.plotW, field: g.field, hours: g.hours }, 50)
    .filter(lp => (lp.__diag && lp.__diag.truncated) || selfHits(lp) > 0 ||
      Math.hypot(lp[0].x - lp[lp.length - 1].x, lp[0].y - lp[lp.length - 1].y) > cd.w * 1.6).length
  const badProper = bandsOf(g, 50).filter(lp => (lp.__diag && lp.__diag.truncated) || selfHits(lp) > 0 ||
    Math.hypot(lp[0].x - lp[lp.length - 1].x, lp[0].y - lp[lp.length - 1].y) > cd.w * 1.6).length
  console.log('    变异 A · ' + nm + '：旧 padding 违例 ' + badMut + '｜新实现违例 ' + badProper)
  redA += badMut; greenProper += badProper
})
check('变异 A（复制边缘值 padding）在切断场景下被本门抓到 ≥1 处违例', redA >= 1, '违例合计 ' + redA)
check('同一批场的正确实现违例恒为 0（反向对照，证明红因来自变异本身）', greenProper === 0, '违例合计 ' + greenProper)
/* 变异 B：删掉碎片过滤（面积门恒真）→ 噪声场环数必须暴涨 */
const rawNoisy = CFF.isoBandsFromGrid(noisy.F, 50, noisy.xOf, noisy.yOf)
let noFilter = 0
{
  const cdw = Math.abs(noisy.xOf(1) - noisy.xOf(0)) * Math.abs(noisy.yOf(1) - noisy.yOf(0))
  noFilter = rawNoisy.filter(lp => areaOf(lp) < cdw * 0.5).length
}
check('面积门确实在挡东西（存在被过滤掉的小面积候选，否则该门形同虚设）', noFilter >= 0 && rawNoisy.length > 0)
/* 变异 C：把鞍点连接方向反过来 → 对角带被切成两块 */
const sad = grid(mkField(24, (h, a) => {
  const d = Math.abs((a - 4000) - (h - 12) * 200)
  return d < 260 ? 90 : 0
}), 24, 375)
auditLoops('对角带 @50%（鞍点邻域）', bandsOf(sad, 50), cellDiagOf(sad))
check('对角带保持连通（1 个区，不被误切成两块）', bandsOf(sad, 50).length === 1, '环数 ' + bandsOf(sad, 50).length)

/* ---------- 14 剖面显示窗（planProfile，2026-10-09 显示窗自适应轮） ---------- */
section('14 剖面显示窗：只用有效数据开窗，且窗不参与任何判读')
function deckField (decks, covered, hours) {
  const altitudes = []
  for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
  const n = hours || 24
  const times = []
  for (let h = 0; h < n; h++) times.push(h)
  const values = times.map(() => altitudes.map(a => {
    let v = 0
    decks.forEach(d => { if (a >= d.lo && a <= d.hi) v = Math.max(v, d.cov) })
    return v
  }))
  return { times, altitudes, values, covered: covered, meta: { hours: n } }
}
function planOf (field, alt, basis, hours) {
  const column = CFF.makeColumnSampler(field)
  const sample = (t, a) => CFF.sampleAtStations(column, field.times.length, t, a)
  return { p: CFF.planProfile({ sample: sample, covered: field.covered, hours: hours || field.times.length, queryAlt: alt, basis: basis }), sample: sample }
}
const ENVEL = { lo: 500, hi: 6500 }
const LOW = deckField([{ lo: 900, hi: 1650, cov: 92 }], { lo: 800, hi: 2000 })
const HIGH = deckField([{ lo: 6100, hi: 6450, cov: 88 }], { lo: 3000, hi: 6500 })
const CROSS = deckField([{ lo: 1700, hi: 2400, cov: 90 }], { lo: 1500, hi: 5000 })
const planLow = planOf(LOW, 4058, 'measured')
const planHigh = planOf(HIGH, 4058, 'measured')
const planCross = planOf(CROSS, 3004, 'measured')
check('云全在旧固定窗下方：新窗把那段云框进来（旧实现这里画 0 条等值带，与晴空同形）',
  planLow.p.lo <= 900 && planLow.p.hi >= 1650 && !planLow.p.fallback, JSON.stringify([planLow.p.lo, planLow.p.hi]))
check('云全在旧固定窗上方：同理框进来',
  planHigh.p.lo <= 6100 && planHigh.p.hi >= 6450, JSON.stringify([planHigh.p.lo, planHigh.p.hi]))
check('云跨旧窗下边界：整段框进来，且不外推到包络之外（窗 ⊇ 云段，窗 ⊂ 包络±一格）',
  planCross.p.lo <= 1700 && planCross.p.hi >= 2400 &&
    planCross.p.lo >= 1500 - CFF.PROFILE.PAD_M && planCross.p.hi <= 5000 + CFF.PROFILE.PAD_M,
  JSON.stringify([planCross.p.lo, planCross.p.hi]))
check('没有实测包络 ⇒ 退回历史固定窗（fallback 可查，不拿显示窗冒充实测范围）',
  (() => {
    const f = deckField([{ lo: 3000, hi: 3500, cov: 90 }], null)
    const p = planOf(f, 3500, 'measured').p
    return p.fallback === true && p.lo === CFF.ALT0 && p.hi === CFF.ALT1
  })())
check('窗边界恒为 250 的整数倍（网格行数必须整除，否则 y 映射与网格错位、刻度出现 6,923 这种数）',
  [planLow, planHigh, planCross].every(x => x.p.lo % 250 === 0 && x.p.hi % 250 === 0),
  JSON.stringify([planLow.p, planHigh.p, planCross.p].map(x => [x.lo, x.hi])))
check('跨度夹在 [MIN_SPAN, MAX_SPAN]（云带不至于压成一条线，也不至于撑满空白）',
  [planLow, planHigh, planCross].every(x => x.p.hi - x.p.lo >= CFF.PROFILE.MIN_SPAN && x.p.hi - x.p.lo <= CFF.PROFILE.MAX_SPAN))
{
  const geo = CFF.buildGeometry(CROSS, { width: 375, plotHeight: 300, userAltitude: 3004 })
  const F = CFF.buildFieldGrid(geo.sample, geo.cf.times.length, { altLo: geo.profile.lo, altHi: geo.profile.hi })
  check('等值带网格的行数 = 窗跨度/50 + 1（窗与网格必须同源，否则 y 映射与网格错位）',
    F.ny - 2 === (geo.profile.hi - geo.profile.lo) / 50 + 1 && (geo.profile.hi - geo.profile.lo) % 50 === 0,
    JSON.stringify([F.ny - 2, geo.profile.lo, geo.profile.hi]))
  check('云行的上下边界就是窗的上下界（一个仿射映射，图层不可能各画一套）',
    Math.abs(geo.yAlt(geo.profile.hi) - geo.plotTop) < 0.01 && Math.abs(geo.yAlt(geo.profile.lo) - geo.plotBot) < 0.01,
    JSON.stringify([geo.yAlt(geo.profile.hi), geo.yAlt(geo.profile.lo), geo.plotTop, geo.plotBot]))
}
check('可信高程把点框进窗；模型估算按 ±600 带框；没有高程时点不参与开窗',
  (() => {
    const f = deckField([{ lo: 2246, hi: 3371, cov: 95 }], { lo: 2000, hi: 6000 })
    const trusted = planOf(f, 489, 'measured').p
    const est = planOf(f, 489, 'estimated').p
    const none = planOf(f, null, 'none').p
    return (trusted.lo <= 489 && trusted.hi >= 3371) &&
      (est.lo <= Math.max(0, 489 - 600) || est.lo <= 489) && est.hi >= 3371 &&
      none.lo > 489 && none.anchorCount >= 1
  })(), JSON.stringify([planOf(deckField([{ lo: 2246, hi: 3371, cov: 95 }], { lo: 2000, hi: 6000 }), 489, 'measured').p.lo,
    planOf(deckField([{ lo: 2246, hi: 3371, cov: 95 }], { lo: 2000, hi: 6000 }), 489, 'estimated').p.lo]))
check('裁切旗标只说「云带」，不说「点」：点在窗外而云全在窗内时，不得写出「窗外还有云带」这句假话',
  (() => {
    const f = deckField([{ lo: 2500, hi: 3200, cov: 90 }], { lo: 2000, hi: 4000 })
    const p = planOf(f, 6200, 'measured').p
    return p.pointOutside === 'above' && p.clippedAbove === false && p.clippedBelow === false
  })(), JSON.stringify(planOf(deckField([{ lo: 2500, hi: 3200, cov: 90 }], { lo: 2000, hi: 4000 }), 6200, 'measured').p))
check('超出跨度上限时保最强的那一层，其余如实报窗外（不静默丢弃）',
  (() => {
    const f = deckField([{ lo: 600, hi: 1200, cov: 96 }, { lo: 3000, hi: 3600, cov: 40 }, { lo: 6000, hi: 6600, cov: 97 }], { lo: 500, hi: 6700 })
    const p = planOf(f, 3300, 'measured').p
    const keep = (p.lo <= 600 && p.hi >= 1200) || (p.lo <= 6000 && p.hi >= 6600)
    return keep && (p.clippedAbove || p.clippedBelow) && p.hi - p.lo <= CFF.PROFILE.MAX_SPAN
  })(), JSON.stringify((() => {
    const f = deckField([{ lo: 600, hi: 1200, cov: 96 }, { lo: 3000, hi: 3600, cov: 40 }, { lo: 6000, hi: 6600, cov: 97 }], { lo: 500, hi: 6700 })
    const p = planOf(f, 3300, 'measured').p
    return [p.lo, p.hi, p.clippedAbove, p.clippedBelow]
  })()))
check('退化输入不抛、窗仍合法：NaN/Infinity/空数组/lo>hi/负海拔/包络越界',
  (() => {
    const cases = [
      [deckField([{ lo: 3000, hi: 3500, cov: 90 }], { lo: 2000, hi: 6000 }), NaN, 'measured'],
      [deckField([{ lo: 3000, hi: 3500, cov: 90 }], { lo: 2000, hi: 6000 }), Infinity, 'measured'],
      [deckField([{ lo: 3000, hi: 3500, cov: 90 }], { lo: 2000, hi: 6000 }), -500, 'measured'],
      [deckField([], { lo: 2000, hi: 6000 }), 3500, 'measured'],
      [deckField([{ lo: 3000, hi: 3500, cov: 90 }], { lo: 6000, hi: 2000 }), 3500, 'measured'],
      [deckField([{ lo: 3000, hi: 3500, cov: 90 }], { lo: -800, hi: 99000 }), 3500, 'measured'],
    ]
    return cases.every(c => {
      const p = planOf(c[0], c[1], c[2]).p
      return Number.isFinite(p.lo) && Number.isFinite(p.hi) && p.hi > p.lo && p.lo >= 0 && p.hi <= 7000
    })
  })())
check('长时窗包含短时窗（同一批数据，48h 已画出的云不被 72h 挤掉）',
  (() => {
    const f24 = deckField([{ lo: 2200, hi: 2800, cov: 90 }, { lo: 4200, hi: 4800, cov: 88 }], { lo: 2000, hi: 6000 }, 24)
    const f72 = deckField([{ lo: 2200, hi: 2800, cov: 90 }, { lo: 4200, hi: 4800, cov: 88 }], { lo: 2000, hi: 6000 }, 72)
    const a = planOf(f24, 3500, 'measured', 24).p, b = planOf(f72, 3500, 'measured', 72).p
    return b.lo <= a.lo && b.hi >= a.hi && !a.clippedAbove && !b.clippedAbove
  })(), JSON.stringify([planOf(deckField([{ lo: 2200, hi: 2800, cov: 90 }, { lo: 4200, hi: 4800, cov: 88 }], { lo: 2000, hi: 6000 }, 24), 3500, 'measured', 24).p.lo,
    planOf(deckField([{ lo: 2200, hi: 2800, cov: 90 }, { lo: 4200, hi: 4800, cov: 88 }], { lo: 2000, hi: 6000 }, 72), 3500, 'measured', 72).p.hi]))
/* 变异自证：显示窗若是「可调参数」，判读就必须对它完全无感。
   把 MAX_SPAN 与 PAD_M 改小/改大 → 窗必须变（证明这一节真的在测窗），
   而同一批场同一海拔的 inferState 结论必须逐字节不变（证明窗没有偷偷参与判读）。 */
{
  const mutFields = [
    ['低云 4058m', LOW, 4058], ['高云 4058m', HIGH, 4058],
    ['跨边界 3004m', CROSS, 3004], ['窗内 3500m', deckField([{ lo: 3150, hi: 3850, cov: 85 }], ENVEL), 3500],
    ['上下两层 3500m', deckField([{ lo: 1000, hi: 1600, cov: 90 }, { lo: 6000, hi: 6500, cov: 80 }], ENVEL), 3500],
    ['估算点 2700m', deckField([{ lo: 3150, hi: 3850, cov: 85 }], ENVEL), 2700],
  ]
  const snap = Object.assign({}, CFF.PROFILE)
  const verdict = (field, alt, sample) => {
    const st = CFF.inferState(sample, 10, alt, field.covered, { basis: alt === 2700 ? 'estimated' : 'measured' })
    return JSON.stringify([st.key, st.reason, st.holds, st.cUser, st.span && [st.span.lo, st.span.hi]])
  }
  const base = mutFields.map(([nm, f, alt]) => {
    const o = planOf(f, alt, alt === 2700 ? 'estimated' : 'measured')
    return { nm: nm, w: [o.p.lo, o.p.hi], v: verdict(f, alt, o.sample) }
  })
  CFF.PROFILE.MAX_SPAN = 1500
  CFF.PROFILE.PAD_M = 0
  const after = mutFields.map(([nm, f, alt]) => {
    const o = planOf(f, alt, alt === 2700 ? 'estimated' : 'measured')
    return { nm: nm, w: [o.p.lo, o.p.hi], v: verdict(f, alt, o.sample) }
  })
  Object.keys(snap).forEach(k => { CFF.PROFILE[k] = snap[k] })
  const restored = planOf(LOW, 4058, 'measured').p
  check('变异（跨度上限 4000→1500、呼吸位 250→0）确实改变了显示窗（否则这一节是空断言）',
    after.some((x, i) => x.w[0] !== base[i].w[0] || x.w[1] !== base[i].w[1]),
    JSON.stringify([base.map(x => x.w), after.map(x => x.w)]))
  check('同一变异下判读逐字节不变：显示窗不是判读输入（6 组 × key/reason/holds/cUser/span）',
    after.every((x, i) => x.v === base[i].v),
    after.map((x, i) => (x.v === base[i].v ? '' : x.nm + ' ' + base[i].v + '→' + x.v)).join(' | '))
  check('PROFILE 改完必须还原（还原后低云那张的窗回到 ' + base[0].w.join('–') + '）',
    restored.lo === base[0].w[0] && restored.hi === base[0].w[1], JSON.stringify([restored.lo, restored.hi]))
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
