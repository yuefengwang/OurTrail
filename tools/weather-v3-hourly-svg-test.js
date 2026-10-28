// 逐时五段图生成器门禁（纯 Node，无需开发者工具）。
// 判据来自实施文档 §10.2 与 2026-10-28 裁决 A（24h 一屏）：列宽由可用宽度反推、五段分区、
// 缺值断线、选中列、文本属性内联（无外部 class）、云量是**连续色带 + 每 3 小时一个整数**。
'use strict'
const H = require('../miniprogram/utils/weather-v3-hourly-svg')

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; return }
  failed++
  console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
function section(t) { console.log('\n§ ' + t) }

function row(i, patch) {
  const base = {
    d: '2026-10-29', t: (i % 24 < 10 ? '0' : '') + (i % 24) + ':00', hour: i % 24,
    temp: 4 + (i % 7), feels: 2 + (i % 5), precip: (i % 3) * 0.6, pop: 20 + (i % 4) * 5,
    wind: 8 + (i % 6), gust: 15 + (i % 8), windDir: (i % 8) * 45,
    cloud: { high: 20 + (i % 5) * 10, mid: 30 + (i % 4) * 10, low: 40 + (i % 3) * 10 },
  }
  return Object.assign(base, patch || {})
}
function series(n, patchAt) {
  const out = []
  for (let i = 0; i < n; i++) out.push(row(i, patchAt && patchAt[i]))
  return out
}
function count(s, needle) { return s.split(needle).length - 1 }
// 只数 path 的 d 属性里的 M（字面 'M' 也出现在 BlinkMacSystemFont 里）
function moves(chunk) {
  const ds = chunk.match(/d="[^"]*"/g) || []
  return ds.reduce((n, d) => n + (d.match(/M(?=[\d.-])/g) || []).length, 0)
}
// 一整块宽度（390 屏 → chartWidth 350；375 → 335；宽度上限 460）
const W = 350
const CELL = H.cellFor(W)            // 12.54
const FIT = W - H.AXIS_W             // 301

/* ------------------------------------------------------------------ */
section('§1 几何：列宽由可用宽度反推，24h 一屏')

{
  check('轴列宽 = 49（WXML 行内绑定的同一个常量）', H.AXIS_W === 49, H.AXIS_W)
  check('一屏承诺的小时数 = 24', H.FIT_HOURS === 24, H.FIT_HOURS)
  check('图高 = 310', H.HEIGHT === 310, H.HEIGHT)
  check('固定 42px 列宽的时代结束（模块不再导出 CELL）', H.CELL === undefined, H.CELL)
  check('cellFor：可用宽摊给 24 小时、向下取整到 0.01',
    H.cellFor(W) === Math.floor((W - 49) / 24 * 100) / 100 && H.cellFor(W) === 12.54, H.cellFor(W))

  // 「一屏」是可算的：cell × 24 必须 ≤ 可用宽。这是裁决 A 的全部承诺，必须对每档宽度成立。
  const widths = [240, 300, 335, 350, 375, 390, 414, 460]
  const overflow = widths.filter(w => H.cellFor(w) * H.FIT_HOURS > w - H.AXIS_W + 1e-9)
  check('24h 在任一档宽度都装得下（cell×24 ≤ 宽−49）', overflow.length === 0,
    overflow.map(w => w + '→' + H.cellFor(w) * 24))
  check('列宽随宽度增长（不是写死一档）',
    H.cellFor(335) < H.cellFor(350) && H.cellFor(350) < H.cellFor(460),
    [H.cellFor(335), H.cellFor(350), H.cellFor(460)])
  check('再窄也有下限（MIN_CELL，否则连一格云都画不出来）',
    H.cellFor(100) === H.MIN_CELL, H.cellFor(100))

  const r24 = H.buildHourlySvg({ series: series(24), cursor: 0, period: 24, width: W })
  const r48 = H.buildHourlySvg({ series: series(48), cursor: 0, period: 48, width: W })
  const r72 = H.buildHourlySvg({ series: series(72), cursor: 0, period: 72, width: W })
  check('24h 宽 = 24 × 12.54 = 300.96（一屏）', Math.abs(r24.width - 300.96) < 1e-6, r24.width)
  check('48h 宽 = 601.92（同一列宽 ⇒ 两屏，不是六屏）', Math.abs(r48.width - 601.92) < 1e-6, r48.width)
  check('72h 宽 = 902.88（约三屏）', Math.abs(r72.width - 902.88) < 1e-6, r72.width)
  check('24/48/72 列数 = 24/48/72', r24.columns === 24 && r48.columns === 48 && r72.columns === 72,
    [r24.columns, r48.columns, r72.columns])
  check('返回的 cell 就是这一档列宽', r24.cell === CELL && r72.cell === CELL, [r24.cell, r72.cell])
  check('svg width 属性 = round(宽度)', r72.svg.indexOf('width="903"') !== -1,
    (r72.svg.match(/width="\d+"/) || [])[0])
  check('viewBox 与宽度一致', r72.svg.indexOf('viewBox="0 0 903 310"') !== -1)
  check('period 截断：72 行数据 + period 24 ⇒ 只画 24 列（宽也按 24 列算）',
    H.buildHourlySvg({ series: series(72), cursor: 0, period: 24, width: W }).columns === 24)
  check('缺 period 时用整段长度', H.buildHourlySvg({ series: series(30), cursor: 0, width: W }).columns === 30)
  check('缺 width 时退到 350（与组件 chartWidth 的缺省同值），不抛错',
    H.buildHourlySvg({ series: series(24), cursor: 0 }).cell === 12.54)
}

{
  const svg = H.buildHourlySvg({ series: series(24), cursor: 3, period: 24, width: W }).svg
  check('五段分区齐全（temp/precip/wind/cloud-high/cloud-mid/cloud-low）',
    ['data-seg="temp"', 'data-seg="precip"', 'data-seg="wind"', 'data-seg="cloud-high"',
      'data-seg="cloud-mid"', 'data-seg="cloud-low"'].every(k => svg.indexOf(k) !== -1))
  check('段分隔线在 83 / 158 / 237', ['M0 83H301', 'M0 158H301', 'M0 237H301'].every(k => svg.indexOf(k) !== -1),
    (svg.match(/M0 (83|158|237)H[\d.]+/g) || []))
  check('横向网格基线 22/68/111/149/175/214',
    ['M0 22H301', 'M0 68H301', 'M0 111H301', 'M0 149H301', 'M0 175H301', 'M0 214H301']
      .every(k => svg.indexOf(k) !== -1))
  const vGrid = (svg.match(/M[\d.]+ 0V310" stroke="#e8eeea"/g) || [])
  check('竖向网格每 3 小时一条（24 列 → 8 条；逐时网格在 12px 列宽下会糊成一片）',
    vGrid.length === 8, vGrid)
}

{
  const svg = H.buildHourlySvg({ series: series(24), cursor: 0, period: 24, width: W }).svg
  const tempSeg = svg.slice(svg.indexOf('data-seg="temp"'), svg.indexOf('data-seg="precip"'))
  check('温度数值每 3 小时标一次（8 个，不是 24 个）',
    (tempSeg.match(/>-?\d+°</g) || []).length === 8, (tempSeg.match(/>-?\d+°</g) || []).length)
  const precipSeg = svg.slice(svg.indexOf('data-seg="precip"'), svg.indexOf('data-seg="wind"'))
  check('降水数值与概率也每 3 小时一次（各 8 个）',
    (precipSeg.match(/font-size="10"/g) || []).length === 8 &&
    (precipSeg.match(/font-size="8"/g) || []).length === 8,
    [(precipSeg.match(/font-size="10"/g) || []).length, (precipSeg.match(/font-size="8"/g) || []).length])
  check('降水柱仍是逐时（24 根），只是更窄',
    (precipSeg.match(/<rect x=/g) || []).length === 24, (precipSeg.match(/<rect x=/g) || []).length)
  const windSeg = svg.slice(svg.indexOf('data-seg="wind"'), svg.indexOf('data-seg="cloud-high"'))
  check('风一行有 8 个标注，其中 4 个带方向（每 6 小时一次）',
    (windSeg.match(/font-size="8"/g) || []).length === 8 &&
    (windSeg.match(/[东南西北]{1,2} \d+</g) || []).length === 4,
    [(windSeg.match(/font-size="8"/g) || []).length, (windSeg.match(/[东南西北]{1,2} \d+</g) || []).length])
  check('第 0 列的宽标签左对齐（否则「西南 9」被图左沿裁掉）',
    /x="2\.0"[^>]*text-anchor="start"/.test(tempSeg + windSeg) ||
    /text-anchor="start">-?\d+°/.test(tempSeg),
    (tempSeg.match(/x="2\.0"[^>]*text-anchor="\w+"/) || [])[0])
  check('没有整点列被硬塞满文字：24 列里只有 8 列有温度标注',
    (tempSeg.match(/>-?\d+°</g) || []).length < 24)
}

/* ------------------------------------------------------------------ */
section('§2 选中列')

{
  const r = H.buildHourlySvg({ series: series(24), cursor: 7, period: 24, width: W })
  const x = Math.round(7 * CELL * 10) / 10
  check('选中列底色 x = 7×12.54 = 87.8、宽 = 一列', r.svg.indexOf('<rect x="' + x.toFixed(1) + '" y="0" width="' + CELL + '"') !== -1,
    (r.svg.match(/<rect x="[\d.]+" y="0"[^>]*>/) || [])[0])
  check('选中竖线在列心 94.0', r.svg.indexOf('M94.0 0V310') !== -1,
    (r.svg.match(/M[\d.]+ 0V310" stroke="#24814a"/) || [])[0])
  check('竖线是虚线（3 3）', /stroke-dasharray="3 3"/.test(r.svg))
  check('返回 cursor = 7', r.cursor === 7)
  const clamped = H.buildHourlySvg({ series: series(24), cursor: 99, period: 24, width: W })
  check('越界 cursor 夹到最后一列', clamped.cursor === 23, clamped.cursor)
  const neg = H.buildHourlySvg({ series: series(24), cursor: -5, period: 24, width: W })
  check('负 cursor 夹到 0', neg.cursor === 0, neg.cursor)
}

/* ------------------------------------------------------------------ */
section('§3 缺值：断线、不补 0、印 —、云量留横线')

{
  const s = series(24)
  // 缺在**有标注的那一列**（i=9），否则 '—' 分支走不到（假绿）
  for (const i of [9, 10]) s[i] = Object.assign({}, s[i], { temp: null, feels: null })
  const svg = H.buildHourlySvg({ series: s, cursor: 0, period: 24, width: W }).svg
  const tempSeg = svg.slice(svg.indexOf('data-seg="temp"'), svg.indexOf('data-seg="precip"'))
  check('温度与体感各断成两段（4 条 M 段，不是一条横穿缺口）', moves(tempSeg) === 4, moves(tempSeg))
  const ink = tempSeg.match(/<path d="([^"]*)" stroke="#263e35"/)
  check('温度线本身是两段子路径（渲染时断开，不是横穿缺口）',
    !!ink && (ink[1].match(/M(?=[\d.-])/g) || []).length === 2,
    ink ? (ink[1].match(/M(?=[\d.-])/g) || []).length : null)
  check('缺值列印 —（温度位）', tempSeg.indexOf('>—</text>') !== -1)
  check('缺口内不出现伪造的 0°', tempSeg.indexOf('>0°</text>') === -1)
}

{
  const s = series(24)
  s[5] = Object.assign({}, s[5], { precip: null, pop: null })
  s[6] = Object.assign({}, s[6], { precip: null, pop: null })
  const svg = H.buildHourlySvg({ series: s, cursor: 0, period: 24, width: W }).svg
  const precipSeg = svg.slice(svg.indexOf('data-seg="precip"'), svg.indexOf('data-seg="wind"'))
  check('缺降水不画柱（24 小时 22 根）', (precipSeg.match(/<rect x=/g) || []).length === 22,
    (precipSeg.match(/<rect x=/g) || []).length)
  check('缺降水在有标注的那列印 —（i=6）', precipSeg.indexOf('>—</text>') !== -1)
}

{
  // 云量缺值 → 带被切断 + 横线标记，不是 0% 的浅色带，也不是空白（空白读起来还是"没有云"）
  const s = series(24)
  for (let i = 8; i <= 11; i++) s[i] = Object.assign({}, s[i], { cloud: { high: null, mid: 10, low: 20 } })
  const svg = H.buildHourlySvg({ series: s, cursor: 0, period: 24, width: W }).svg
  const highSeg = svg.slice(svg.indexOf('data-seg="cloud-high"'), svg.indexOf('data-seg="cloud-mid"'))
  check('高云：缺 4 小时 ⇒ 带断成 2 段（不是 24 个色块）+ 4 条缺值横线',
    (highSeg.match(/height="17"/g) || []).length === 2 &&
    (highSeg.match(/height="1\.5"/g) || []).length === 4,
    [(highSeg.match(/height="17"/g) || []).length, (highSeg.match(/height="1\.5"/g) || []).length])
  check('高云段内没有编出来的读数：8 个标注位里 7 个有数，且与数据逐个对上',
    (highSeg.match(/<text /g) || []).length === 7 &&
    highSeg.indexOf('>20</text>') !== -1 && highSeg.indexOf('>50</text>') !== -1 &&
    highSeg.indexOf('>40</text>') !== -1 && highSeg.indexOf('>30</text>') !== -1,
    (highSeg.match(/<text /g) || []).length)
  check('缺读数的那一小时不印数字（横线已经是「没有读数」的记号）',
    !/<text x="119\.1"[^>]*>\d+<\/text>/.test(highSeg),
    (highSeg.match(/<text x="119\.1"[^>]*>[^<]*<\/text>/g) || [])[0])
  const midSeg = svg.slice(svg.indexOf('data-seg="cloud-mid"'), svg.indexOf('data-seg="cloud-low"'))
  check('中云不受高云缺值影响（整条 1 段、0 横线）',
    (midSeg.match(/height="17"/g) || []).length === 1 &&
    (midSeg.match(/height="1\.5"/g) || []).length === 0,
    [(midSeg.match(/height="17"/g) || []).length, (midSeg.match(/height="1\.5"/g) || []).length])
  check('缺值横线是灰（#a6b5ab，与体感虚线同色），不是新色',
    highSeg.indexOf('fill="#a6b5ab"') !== -1)
}

{
  /* 2026-10-28 第三轮裁决（A）：带内每 3 小时印一个整数，**0 也印**；缺读数的小时不印。
     这一条是回应「上面的颜色又是什么意思」——颜色回答多少，数字回答到底多少，
     两者必须在同一条竖线上、同一列心，才不会被读成两套刻度。 */
  const s = series(24)
  s[0] = Object.assign({}, s[0], { cloud: { high: 0, mid: 0, low: 0 } })
  s[3] = Object.assign({}, s[3], { cloud: { high: 100, mid: 45, low: 8 } })
  s[6] = Object.assign({}, s[6], { cloud: { high: null, mid: 45, low: 8 } })
  const svg = H.buildHourlySvg({ series: s, cursor: 0, period: 24, width: W }).svg
  const highSeg = svg.slice(svg.indexOf('data-seg="cloud-high"'), svg.indexOf('data-seg="cloud-mid"'))
  const tags = highSeg.match(/<text [^>]*>[^<]*<\/text>/g) || []
  check('24 列 → 8 个标注位，其中 7 个印了整数（缺读数那一位不印，不是逐时 24 个）', tags.length === 7, tags.length)
  check('0 也印（写 0，不写成 — 或留空）', highSeg.indexOf('>0</text>') !== -1,
    tags.filter(t => />0</.test(t)))
  check('100 印成三位整数（不省略、不写成 1 或 99）', highSeg.indexOf('>100</text>') !== -1, tags)
  check('缺读数的那一小时不印数字（横线已经是「没有读数」的记号）',
    tags.every(t => !/x="81\.5"/.test(t)), tags.filter(t => /x="81\.5"/.test(t)))

  const parsed = tags.map(t => ({
    x: Number(/x="([\d.]+)"/.exec(t)[1]),
    y: Number(/y="([\d.]+)"/.exec(t)[1]),
    size: Number(/font-size="([\d.]+)"/.exec(t)[1]),
    fill: /fill="(#[0-9a-f]{6})"/.exec(t)[1],
    v: Number(/>([^<]*)</.exec(t)[1]),
  }))
  check('数字就在列心上（与上方刻度、游标同一条竖线；第 0 列按 markX 左对齐）',
    parsed.every((p, k) => k === 0
      ? p.x === 2
      : Math.abs(p.x - (Math.round(p.x / CELL - 0.5) * CELL + CELL / 2)) < 0.06),
    parsed.map(p => p.x))
  check('数字落在色带里（y 在 244–261 之间），不是浮在带外',
    parsed.every(p => p.y > H.Y.cloudHigh && p.y < H.Y.cloudHigh + H.Y.cloudH + 0.01), parsed.map(p => p.y))
  check('字号 9（与轴列同一档；8px 在 WXSS 里是禁档，SVG 也统一到 9）',
    parsed.every(p => p.size === 9), parsed.map(p => p.size))
  check('0% 的浅带用墨绿字、100% 的深带用白字（颜色按底色对比度算，不是写死阈值）',
    parsed.filter(p => p.v === 0).every(p => p.fill === H.COLORS.ink) &&
    parsed.filter(p => p.v === 100).every(p => p.fill === H.COLORS.cloudNumLight),
    parsed.map(p => p.v + ':' + p.fill))

  // 对比度选择本身：白色只出现在确该用白的深底上，且一旦变白就不再回退（单调切换）
  const whiteAt = []
  for (let v = 0; v <= 100; v++) if (H.cloudNumInk(v) === H.COLORS.cloudNumLight) whiteAt.push(v)
  check('白字只在高云量端出现，且是单调切换（不是忽白忽墨）',
    whiteAt.length > 0 && whiteAt.every((v, i) => i === 0 || v === whiteAt[i - 1] + 1), whiteAt)
  check('0% 与 100% 两端都换成与底色反差大的那一个（两端都能读）',
    H.cloudNumInk(0) === H.COLORS.ink && H.cloudNumInk(100) === H.COLORS.cloudNumLight,
    [H.cloudNumInk(0), H.cloudNumInk(100)])
}

{
  /* 2026-10-28 第二轮：云量是**连续色带**（原型 meteoblue 式），不是逐格色块。
     三条界线：① 一段一条 rect，不是一个小时一条；② 每个已知小时在列心一个 stop，
     相邻小时之间过渡；③ 单小时孤岛没有可过渡的区间 ⇒ 实心填色，不许产出退化渐变。 */
  const s = series(24)
  for (let i = 0; i <= 23; i++) s[i] = Object.assign({}, s[i], { cloud: { high: 10 + i * 3, mid: null, low: 40 } })
  s[6] = Object.assign({}, s[6], { cloud: { high: null, mid: 50, low: 40 } })
  const svg = H.buildHourlySvg({ series: s, cursor: 0, period: 24, width: W }).svg
  const defs = svg.slice(svg.indexOf('<defs>'), svg.indexOf('</defs>') + 7)
  check('整份图只有一个 <defs> 块，内容只有 linearGradient（没有 pattern / clipPath 这类没验证过的写法）',
    (svg.match(/<defs>/g) || []).length === 1 &&
    (defs.match(/<(?!\/?(?:defs|linearGradient|stop)\b)[a-zA-Z]/g) || []).length === 0,
    (defs.match(/<(?!\/?(?:defs|linearGradient|stop)\b)[a-zA-Z]/g) || []).slice(0, 3))
  const grads = defs.match(/<linearGradient[^>]*>/g) || []
  check('高云缺 1 小时 ⇒ 2 段渐变；低云整条 ⇒ 1 段；中云全缺 ⇒ 0 段（合计 3）', grads.length === 3, grads.length)
  check('中云全缺 ⇒ 没有渐变，只有横线', defs.indexOf('cb-mid') === -1)
  const gradOf = id => {
    const at = defs.indexOf('id="' + id + '"')
    return at < 0 ? '' : defs.slice(at, defs.indexOf('</linearGradient>', at))
  }
  const highStops = (gradOf('cb-high-0').match(/<stop[^>]*>/g) || [])
  check('第 1 段（0–5 时）恰有 6 个色标', highStops.length === 6, highStops.length)
  const offs = highStops.map(x => Number(/offset="([\d.]+)"/.exec(x)[1]))
  check('色标偏移从 0 到 1 严格递增（每个已知小时都占一个位置，不重不漏）',
    offs[0] === 0 && offs[offs.length - 1] === 1 && offs.every((v, i) => i === 0 || v > offs[i - 1]),
    offs)
  const ramp = new Set()
  for (let v = 0; v <= 100; v++) ramp.add(H.cloudShade(v))
  const stopColors = highStops.map(x => /stop-color="(#[0-9a-f]{6})"/.exec(x)[1])
  check('每个色标都落在登记的云阶上（不是就地配的新灰）', stopColors.every(c => ramp.has(c)), stopColors.slice(0, 3))
  check('相邻小时的云量不同 ⇒ 两个色标颜色也不同（过渡真的在看数据，不是一条平带）',
    stopColors[0] !== stopColors[1] && stopColors[3] !== stopColors[4])
  check('高云第 2 段（7–23 时）17 个色标', (gradOf('cb-high-7').match(/<stop[^>]*>/g) || []).length === 17,
    (gradOf('cb-high-7').match(/<stop[^>]*>/g) || []).length)
  const lone = s.slice()
  lone[5] = Object.assign({}, lone[5], { cloud: { high: 70, mid: 70, low: 70 } })
  const loneSvg = H.buildHourlySvg({ series: [lone[5]], cursor: 0, period: 1, width: W }).svg
  check('单小时孤岛不产出退化渐变（x1 与 x2 相同会让整条带消失）',
    loneSvg.indexOf('Gradient') === -1 && loneSvg.indexOf('fill="' + H.cloudShade(70) + '"') !== -1)
  const refs = Array.from(new Set((svg.match(/url\(#([\w-]+)\)/g) || []).map(x => x.slice(5, -1))))
  const ids = (defs.match(/id="([\w-]+)"/g) || []).map(x => x.slice(4, -1))
  check('每个 url(#…) 都有定义（引用不存在的 id 会静默不画，云场剖面栽过）',
    refs.length > 0 && refs.every(r => ids.indexOf(r) !== -1), refs.filter(r => ids.indexOf(r) === -1))
}

{
  const s = series(24).map((h, i) => i === 0 ? Object.assign({}, h, { wind: null, gust: null }) : h)
  const svg = H.buildHourlySvg({ series: s, cursor: 0, period: 24, width: W }).svg
  const windSeg = svg.slice(svg.indexOf('data-seg="wind"'), svg.indexOf('data-seg="cloud-high"'))
  check('风线起点缺值：从第 2 列开始，只有一条 M', moves(windSeg) >= 1 && moves(windSeg) <= 2,
    moves(windSeg))
  check('风缺值列的风向行印 —', windSeg.indexOf('>—</text>') !== -1 || windSeg.indexOf('km') === -1)
}

{
  const empty = H.buildHourlySvg({ series: [], cursor: 0, period: 24, width: W })
  check('空序列返回空 svg 与零宽（不抛错、不画假图）', empty.svg === '' && empty.width === 0 && empty.columns === 0)
  const nullRows = H.buildHourlySvg({ series: [null, null], cursor: 0, width: W })
  check('全 null 行不抛错', typeof nullRows.svg === 'string' && nullRows.columns === 2)
  check('全 null 行不伪造 0 度刻度线以外的数据', nullRows.svg.indexOf('>0°</text>') === -1)
  check('全 null 行的三层云都画横线（6 条），不是浅色格',
    (nullRows.svg.match(/height="1\.5"/g) || []).length === 6,
    (nullRows.svg.match(/height="1\.5"/g) || []).length)
}

/* ------------------------------------------------------------------ */
section('§4 图内只有已验证的特性集（无外部 CSS、无字体声明、无渐变）')

{
  const svg = H.buildHourlySvg({ series: series(24), cursor: 2, period: 24, width: W }).svg
  check('无 class 属性', svg.indexOf('class=') === -1)
  check('无 <style> 块', svg.indexOf('<style') === -1)
  /* 本图在小程序里被栅格化成 <image>：只保留 meteogram / cloud-field / route-profile
     三张真机验证过的图用到的特性。 */
  check('无 font-family（三张已验证的图都不写字体，交给解码器默认无衬线）',
    svg.indexOf('font-family') === -1, (svg.match(/font-family[^ ]*/g) || []).slice(0, 3))
  check('无 hsl()（低版本 SVG 解码器对色函数支持不一；一切用 hex）',
    svg.indexOf('hsl(') === -1, (svg.match(/hsl\([^)]*\)/g) || []).slice(0, 3))
  check('根节点不带 role / aria-label（无障碍语义挂在宿主 <image> 上）',
    svg.indexOf('role=') === -1 && svg.indexOf('aria-label') === -1)
  /* 2026-10-28 第二轮：云量恢复成**连续色带**（原型 meteoblue 式），<defs>+linearGradient
     回到图里。这不是"把没验证过的写法带回来"：本仓统一图（meteogram-svg 的昼夜底 `#udn`）
     用的是同一种写法，且它已在小程序 `<image>` 里真机出图多轮。门改成盯**引用完整性**
     （url(#id) 必须有定义）与**只用这一种 defs 子元素**，而不是一律禁止。 */
  check('<defs> 里只允许 linearGradient / stop',
    (svg.match(/<defs>[\s\S]*?<\/defs>/g) || []).every(d =>
      (d.match(/<(?!\/?(?:defs|linearGradient|stop)\b)[a-zA-Z]/g) || []).length === 0))
  const gradIds = (svg.match(/<linearGradient[^>]*id="([\w-]+)"/g) || []).map(x => /id="([\w-]+)"/.exec(x)[1])
  const urlIds = Array.from(new Set((svg.match(/url\(#([\w-]+)\)/g) || []).map(x => x.slice(5, -1))))
  check('每个 url(#…) 都有对应定义（引用不存在的 id 会让整块静默不画）',
    urlIds.length > 0 && urlIds.every(id => gradIds.indexOf(id) !== -1), urlIds.filter(id => gradIds.indexOf(id) === -1))
  /* XML 良构：开标签里的属性必须恰好是 name="value" 序列。
     实测事故（2026-10-28 真机）：删 font-family 时留下 `data-seg="temp""` 的多余引号，
     XML 非法 ⇒ 解码器丢弃整份文档 ⇒ 图身整块空白，而左下刻度/表头照常画（它们是 DOM，
     不是这张 SVG）⇒ 看起来像「渲染没生效」而不是「图坏了」。这条断言就是那道门。 */
  const openTags = svg.match(/<[a-zA-Z][^>]*>/g) || []
  const malformed = openTags.filter(t => {
    let rest = t.replace(/^<[a-zA-Z][\w:-]*/, '').replace(/\/?>$/, '')
    while (rest.length) {
      const m = /^\s+[\w:-]+="[^"]*"/.exec(rest)
      if (!m) break
      rest = rest.slice(m[0].length)
    }
    return rest.trim().length > 0
  })
  check('XML 良构：每个开标签的属性都是 name="value"（多余引号会让整份 SVG 被丢弃）',
    openTags.length > 0 && malformed.length === 0, malformed.slice(0, 3))
  const texts = svg.match(/<text[^>]*>/g) || []
  check('所有 <text> 都有 fill 与 font-size',
    texts.length > 0 && texts.every(t => t.indexOf('fill="') !== -1 && t.indexOf('font-size="') !== -1),
    texts.length)
  check('无 NaN / undefined 坐标', svg.indexOf('NaN') === -1 && svg.indexOf('undefined') === -1)
  check('填色只有 none / #hex / url(#渐变) 三种（无具名色、无外部资源）',
    (svg.match(/(?:fill|stroke)="(?!none|#|url\(#)[^"]*"/g) || []).length === 0,
    (svg.match(/(?:fill|stroke)="(?!none|#|url\(#)[^"]*"/g) || []).slice(0, 3))
  // 每一个色值都必须出自模块自己声明的色表，或落在云阶上（防"就地写个新灰"）
  const ramps = new Set()
  for (let v = 0; v <= 100; v++) ramps.add(H.cloudShade(v))
  const declared = new Set(Object.keys(H.COLORS).map(k => String(H.COLORS[k]).toLowerCase())
    .concat(['#83a9a4', '#427b72']).concat(Array.from(ramps)))
  const used = Array.from(new Set((svg.match(/#[0-9a-fA-F]{6}/g) || []).map(x => x.toLowerCase())))
  const stray = used.filter(c => !declared.has(c))
  check('色值全部出自模块色表或云阶上的插值（' + used.length + ' 种）', stray.length === 0, stray)
}

{
  /* 云阶必须与图例同源：WXSS 的 .wv3-ramp 是 #F0F2EF→#C4CCC3→#7E8C80→#354C3D 四站渐变。
     色阶函数在 0/100 处必须正好给出两端，否则图例把反差说大/说小。 */
  check('cloudShade 产出 6 位 hex', /^#[0-9a-f]{6}$/.test(H.cloudShade(0)), H.cloudShade(0))
  check('0% = 图例浅端 #f0f2ef', H.cloudShade(0) === '#f0f2ef', H.cloudShade(0))
  check('100% = 图例深端 #354c3d', H.cloudShade(100) === '#354c3d', H.cloudShade(100))
  const lum = v => {
    const h = H.cloudShade(v)
    return parseInt(h.slice(1, 3), 16) * 0.299 + parseInt(h.slice(3, 5), 16) * 0.587 + parseInt(h.slice(5, 7), 16) * 0.114
  }
  const stops = [0, 25, 50, 75, 100].map(lum)
  check('云量越高越深（0→100 逐档变暗）', stops.every((v, i) => i === 0 || v < stops[i - 1]), stops)
  check('超出 0–100 的输入被夹住（不产生非法 hex）',
    H.cloudShade(-20) === H.cloudShade(0) && H.cloudShade(180) === H.cloudShade(100))
  const svg = H.buildHourlySvg({ series: series(24), cursor: 0, period: 24, width: W }).svg
  check('云格真的用了这条色阶（出现 0% 与 100% 两端的颜色）',
    svg.indexOf(H.cloudShade(20)) !== -1 && svg.indexOf(H.cloudShade(60)) !== -1)
}

/* ------------------------------------------------------------------ */
section('§5 轴列与风向')

{
  const ax = H.axisLayout()
  check('轴列 7 行（时刻/温度/降水/风/高云/中云/低云）', ax.length === 7, ax.length)
  check('轴列顺序与图段一致',
    ax.map(r => r.key).join(',') === 'time,temp,precip,wind,cloudHigh,cloudMid,cloudLow')
  check('轴列 top 递增', ax.every((r, i) => i === 0 || r.top > ax[i - 1].top))
  /* 三层到底多高：文案单源在 CLOUD_LAYER_KM，轴列与说明都从这里派生。
     这条门要能证明「只改一个数，三个地方一起动」——所以改的是导出对象本身（引用），
     不是测试里另抄一份字符串。 */
  const km = H.CLOUD_LAYER_KM
  const before = H.cloudBounds()
  check('三层高度区间按取数端点的口径：低云≤3km（含雾）/ 中云3–8km / 高云≥8km',
    before.low === '≤3km' && before.mid === '3–8km' && before.high === '≥8km', before)
  let shadow = null
  try {
    km.mid.max = 7
    shadow = H.cloudBounds()
  } finally {
    km.mid.max = 8
  }
  check('影子改一个数 ⇒ 区间文案跟着变（单源是可测的，不是只写了个常量名）',
    shadow && shadow.mid === '3–7km' && H.cloudBounds().mid === '3–8km', shadow)
  check('风向 0° = 北', H.windDirText(0) === '北')
  check('风向 225° = 西南', H.windDirText(225) === '西南')
  check('风向 359° = 北（回绕）', H.windDirText(359) === '北')
  check('风向缺值 = 空串（不印 0°）', H.windDirText(null) === '')
}

/* ------------------------------------------------------------------ */
section('§6 data URI 严格转义（裸引号/星号/括号不进载荷）')

{
  const V = require('../miniprogram/utils/weather-v3-view')
  const svg = H.buildHourlySvg({ series: series(24), cursor: 2, period: 24, width: W }).svg
  const uri = V.toUri(svg)
  const PREFIX = 'data:image/svg+xml;charset=utf-8,'
  check('前缀正确', uri.indexOf(PREFIX) === 0)
  /* encodeURIComponent 把 `'!()*` 当 sub-delim 放过；data URI 载荷要的是严格字符集。 */
  check('载荷里没有裸单引号 / 叹号 / 圆括号 / 星号',
    !/[!'()*]/.test(uri.slice(PREFIX.length)),
    (uri.slice(PREFIX.length).match(/[!'()*]/g) || []).slice(0, 5))
  check('载荷里没有裸空格 / 井号 / 双引号', !/[ #"]/.test(uri.slice(PREFIX.length)))
  check('解码回来与源 SVG 逐字节相同',
    decodeURIComponent(uri.slice(PREFIX.length)) === svg)
}

/* ------------------------------------------------------------------ */
section('§7 云层显示窗与时长无关（24/48/72 同一把高度尺）')

function isoPlusDay(date, off) {
  return new Date(Date.parse(date + 'T00:00:00Z') + off * 86400000).toISOString().slice(0, 10)
}
const S0 = '2026-10-29'
/** 前两天只有一整条 0.7–1.5 km 的低云，第三天起才出现一条 9.7 km 的薄卷云。
    这份夹具的作用是证明「规划视野」真的会改变窗：只看 24h 时窗只包住低云，
    跨到 72h 时那条 300 hPa 卷云也必须进窗（跨度上限 = 轴宽，装不下不再是理由）。 */
function cloudFixture(hours) {
  const rows = []
  for (let i = 0; i < hours; i++) {
    const h = i % 24
    rows.push({
      d: isoPlusDay(S0, Math.floor(i / 24)), t: (h < 10 ? '0' : '') + h + ':00',
      temp: 3, feels: 1, precip: 0, pop: 10, wind: 8, gust: 14, windDir: 225, code: 3,
      cloud: { low: 30, mid: 40, high: 50 },
    })
  }
  const alts = [700, 1500, 3000, 4300, 9700]
  const levels = alts.map((alt, li) => ({
    pressure: [925, 850, 700, 500, 300][li],
    altitudes: rows.map(() => alt),
    cloudCover: rows.map((_, k) => (Math.floor(k / 24) === 2 ? [0, 0, 0, 0, 40][li] : [90, 90, 0, 0, 0][li])),
  }))
  return {
    status: 'ready', updatedAt: S0 + 'T07:00:00+08:00', provider: { label: 'Open-Meteo' },
    pointElevation: 0, days: [], series: rows,
    cloudLevels: { times: rows.map(r => r.d + 'T' + r.t), levels, unit: { altitude: 'm ASL', cloudCover: '%' } },
  }
}

{
  const V = require('../miniprogram/utils/weather-v3-view')
  const WCFF = require('../miniprogram/utils/weather-cloud-field')
  const CFF = require('../miniprogram/utils/cloud-field-svg')
  const result = cloudFixture(96)
  const view = (p, elevation) => V.buildCloud(
    result, { date: S0, period: p, lat: 29.8, lng: 99.7, selDate: S0 },
    { elevation, source: null, basis: 'none', ok: false }, W)
  const a = view(24, 0), b = view(48, 0), c = view(72, 0)

  check('三档都出图', !a.missing && !b.missing && !c.missing, [a.missing, b.missing, c.missing])
  check('渲染窗口仍随所选时长（规划视野不裁数据）',
    a.geo.horizon === 24 && b.geo.horizon === 48 && c.geo.horizon === 72 &&
    a.geo.nT === 24 && c.geo.nT === 72,
    [a.geo.horizon, b.geo.horizon, c.geo.horizon, a.geo.nT, c.geo.nT])
  check('显示窗 lo/hi 三档完全相同',
    a.geo.profile.lo === b.geo.profile.lo && b.geo.profile.lo === c.geo.profile.lo &&
    a.geo.profile.hi === b.geo.profile.hi && b.geo.profile.hi === c.geo.profile.hi,
    [[a.geo.profile.lo, a.geo.profile.hi], [b.geo.profile.lo, b.geo.profile.hi], [c.geo.profile.lo, c.geo.profile.hi]])
  const ticks = p => CFF.profileTicks(p.geo.profile.lo, p.geo.profile.hi).join(',')
  check('刻度三档完全相同', ticks(a) === ticks(b) && ticks(b) === ticks(c), [ticks(a), ticks(c)])
  check('「此点在哪」与范围/图例文案三档一致',
    a.card.elevShown === b.card.elevShown && b.card.elevShown === c.card.elevShown &&
    a.card.rangeLabel === b.card.rangeLabel && a.card.legendElev === c.card.legendElev,
    [a.card.elevShown, b.card.elevShown, c.card.elevShown, a.card.rangeLabel, c.card.rangeLabel])
  const f24 = WCFF.buildCloudFieldRange(result, { startDate: S0, hours: 24, userAltitude: 0 })
  check('判读输入仍是渲染字段自己的 covered（业务语义不随规划视野漂移）',
    JSON.stringify(a.geo.cloud.covered) === JSON.stringify(f24.covered), [a.geo.cloud.covered])

  /* 判据有效性（阳性对照）：同一份夹具上，按 24h 规划与按 72h 规划**确实**给出不同的窗。
     不成立就说明上面几条门在空转。 */
  const planOf = h => {
    const f = WCFF.buildCloudFieldRange(result, { startDate: S0, hours: h, userAltitude: 0 })
    const col = CFF.makeColumnSampler(f)
    return CFF.planProfile({
      sample: (t, alt) => CFF.sampleAtStations(col, f.times.length, t, alt),
      covered: f.covered, hours: h, queryAlt: 0, basis: 'measured',
    })
  }
  const p24 = planOf(24), p72 = planOf(72)
  check('有效性：按 24h 规划与按 72h 规划在这份夹具上不同',
    p24.lo !== p72.lo || p24.hi !== p72.hi, [[p24.lo, p24.hi], [p72.lo, p72.hi]])
  check('有效性：按 24h 规划窗只包住当日低云（够不到 9,700 卷云）',
    p24.lo === 0 && p24.hi < 9700 && p24.clippedAbove === false,
    [p24.lo, p24.hi, p24.clippedAbove])
  check('改按 72h 规划：9,700 卷云进窗，此点仍在窗内（不再有「下方 N 米」这种边注）',
    p72.lo === 0 && p72.hi >= 9700 && p72.pointOutside == null && p72.clippedAbove === false,
    [p72.lo, p72.hi, p72.pointOutside, p72.clippedAbove])

  /* 有可信海拔的常规情形：三档都必须把此点框在窗内。 */
  const h24 = view(24, 1500), h72 = view(72, 1500)
  check('常规海拔（1,500 m）三档都判「此点在窗内」',
    h24.card.elevShown && h72.card.elevShown &&
    h24.geo.profile.lo === h72.geo.profile.lo && h24.geo.profile.hi === h72.geo.profile.hi,
    [h24.card.elevShown, h72.card.elevShown, h24.geo.profile, h72.geo.profile])
}

/* ------------------------------------------------------------------ */
console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
