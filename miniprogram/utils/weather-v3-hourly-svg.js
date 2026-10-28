// 逐时五段图 SVG 生成器（纯函数，wx-free）。
//
// 规格来源：原型 `docs/prototypes/ourtrail-explore-v3/weather.js` 的 `hourlyChart()`。
//
// 2026-10-28「24 小时一屏」（用户裁决 A）：
//   列宽不再固定 42px，而是由可用宽度反推：cell = (width − AXIS_W) / FIT_HOURS，
//   于是 24h 恰好占满一屏、不需要横向滚动；48h/72h 用**同一列宽**，宽 2/3 屏、照旧横滑。
//   代价必须写在明处：每列约 12.5px，放不下逐时数字 ⇒ 温度/降水/概率/风改成**每 3 小时标一次**，
//   云量**保持原型的 meteoblue 式连续色带**，带内也只按同一节奏印整数（0 也印，缺读数不印）。
//   读数没有丢：选中小时的完整读数（含三层云量）在图表上方的读数区。
//   云量含义见页面图例与说明：三层是模型分层云量，各自的高度区间由 `cloudBounds()` 单源给出。
//
// 与原型的两处**平台化**改动（实施文档 §6.5 / §1.2）：
//   1. 原型是 inline `<svg>`；小程序只能 `data:image/svg+xml` 图片或 canvas。
//      这里只产 SVG 字符串，编码由调用方做（`weather-v3-view.toUri`）。
//   2. 图片里的外部 CSS class 不生效 ⇒ **所有样式内联**到属性上；数字按固定列心对齐
//      （不依赖 `font-variant-numeric`，SVG 图片解码器不保证支持）。
//
// 只用「已在真机验证过的 SVG 特性集」：与本仓另外三张图（meteogram 统一图、
// cloud-field 剖面、route-profile）保持一致——**不写 font-family、不写 hsl()、
// 不在根节点放 role/aria-label**。渐变只用在云量带上，与统一图的昼夜底 `#udn`
// 同一写法（`<defs><linearGradient>` + `fill="url(#…)"`，那几张图都已在真机出图）；
// **不许引用没有定义的 id**（云场剖面曾引用不存在的 clipPath 而静默不裁切）。
// 这三项都是本图独有的写法风险，别的新写法不要顺手带进来。
// 无障碍语义交给宿主 `<image aria-label>`（栅格化后的 SVG 内部对读屏不可达）。
// 底色/色阶全用 hex：hsl() 不写。
//
// 缺值规则（铁律：缺值不补 0）：null/undefined 不参与曲线、不画柱；曲线在缺值处**断开**
// （分成多段 M…），标注位印 '—'；云量带在缺值处**切断**并在原位画一条横线——
// 断口与 0% 是两件事，横线不是。
'use strict'

// 左侧轴列宽。运行时唯一出处在这里（WXML 用 style="width:{{axisWidth}}px" 绑上去）；
// weather-detail.wxss 的 49px 只是没有数据时的兜底，structure 门盯着两边同值。
const AXIS_W = 49
// 一屏承诺的小时数：24h 必须整屏放下；48/72 沿用同一列宽横向滚动
const FIT_HOURS = 24
// 列宽下限：再窄就连一格云量都画不出来（240 窗口下是 7.95，只有异常宽度才会触到）
const MIN_CELL = 6
const HEIGHT = 310
// 标注节奏（小时）。每列约 12.5px，逐时数字会互相压叠
const LABEL_EVERY = 3
// 风向文字比数字宽一倍，隔 6 小时才带一次方向
const DIR_EVERY = LABEL_EVERY * 2

const C = {
  ink: '#263e35',
  feels: '#a6b5ab',
  grid: '#e8eeea',
  sep: '#e1e9e3',
  sel: '#eaf5eb',
  cursor: '#24814a',
  rain: '#73aaca',
  rainText: '#3e779b',
  muted: '#a6b5ab',
  pop: '#809486',
  temp: '#293f31',
  gust: '#668e88',
  windText: '#6c7e70',
  // 云带内数字的浅色档（深色档直接复用 ink）。为什么是两个登记色而不是新配一个灰：
  // 带内文字的颜色必须由底色算出（见 cloudNumInk），候选只有「白」与「墨绿」两种既有色。
  cloudNumLight: '#ffffff',
}

// 各段的基线（与原型逐值一致；轴列的 top 与这里一一对应）
const Y = {
  tempTop: 22, tempBase: 68, tempSpan: 45,
  precipTop: 83, precipBase: 141, precipMax: 34, precipValueY: 103, popY: 152,
  windTop: 175, windBase: 214, windSpan: 45, windDirY: 231,
  cloudHigh: 244, cloudMid: 264, cloudLow: 284, cloudH: 17,
  sep: [83, 158, 237],
  grid: [22, 68, 111, 149, 175, 214],
}

function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
function fin(v) { return typeof v === 'number' && isFinite(v) }
function n(v, digits) { return digits ? v.toFixed(digits) : String(Math.round(v)) }

function text(x, y, t, size, color, anchor) {
  return '<text x="' + n(x, 1) + '" y="' + n(y, 1) + '" font-size="' + size + '" fill="' + color +
    '" text-anchor="' + (anchor || 'middle') + '">' + esc(t) + '</text>'
}

/**
 * 列宽：把可用宽度（整块图宽 − 轴列）摊给 FIT_HOURS 小时。
 * 向下取整到 0.01 ⇒ cell × 24 ≤ 可用宽，24h 一定装得下（不会因为四舍五入多出半像素而横滑）。
 */
function cellFor(width) {
  const w = fin(width) ? width : 350
  const usable = Math.max(0, w - AXIS_W)
  return Math.max(MIN_CELL, Math.floor(usable / FIT_HOURS * 100) / 100)
}

/**
 * 云量色阶：与云层视图图例（`.wv3-ramp`）**同一组四个登记色**，按同样的等分位插值。
 * 图例是 CSS 渐变，单元格是 hex —— 两边只有共用这条色阶，图例才不是"看起来差不多"的装饰。
 * （旧实现按 hsl(110 7% L%) 换算，最深档只到 #72806d：图例深端 #354C3D 会把反差说大。）
 */
const RAMP = [[0xF0, 0xF2, 0xEF], [0xC4, 0xCC, 0xC3], [0x7E, 0x8C, 0x80], [0x35, 0x4C, 0x3D]]
function cloudShade(cover) {
  const t = Math.max(0, Math.min(100, cover)) / 100 * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(t))
  const k = t - i
  const a = RAMP[i], b = RAMP[i + 1]
  return '#' + [0, 1, 2].map(j => {
    const v = Math.round(a[j] + (b[j] - a[j]) * k).toString(16)
    return v.length < 2 ? '0' + v : v
  }).join('')
}

/**
 * 云层分层的高度区间（km，**海平面以上**）。唯一出处。
 *
 * 口径来自本项目实际调用的那个端点：Open-Meteo `/v1/forecast`
 * （`cloudfunctions/trailApi/lib/weather.js`）给三层云量的官方描述是
 * 低云 **≤3 km 含雾** / 中云 **3–8 km** / 高云 **≥8 km**，同一页的气压高度说明
 * 注明这些高度是 "in meters above sea level (not above ground)"。
 * 历史 API 用的是 2 / 6 km，**别混着抄**——换端点就得换这张表，而不是两处各写一份。
 *
 * 轴列的两行标签、图例说明全部从 `cloudBounds()` 派生，WXML 里不出现字面 km。
 */
const CLOUD_LAYER_KM = {
  high: { min: 8, max: null },
  mid: { min: 3, max: 8 },
  low: { min: 0, max: 3 },
}

/** 三层的高度区间文案：{ high:'≥8km', mid:'3–8km', low:'≤3km' } */
function cloudBounds() {
  const text = b => b.max == null ? '≥' + b.min + 'km'
    : b.min === 0 ? '≤' + b.max + 'km'
      : b.min + '–' + b.max + 'km'
  return {
    high: text(CLOUD_LAYER_KM.high),
    mid: text(CLOUD_LAYER_KM.mid),
    low: text(CLOUD_LAYER_KM.low),
  }
}

/** WCAG 2.x 相对亮度（带内数字挑色用） */
function relLum(hex) {
  const ch = k => {
    const v = parseInt(hex.slice(1 + k * 2, 3 + k * 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2)
}

/**
 * 带内数字的颜色：在白色与墨绿之间按**对比度**取高者，不设「云量 >65 就白字」这类魔数。
 * 两端都要可读：0% 的带几乎是卡片底色（浅底墨字），100% 的带是深绿（深底白字）。
 */
function cloudNumInk(cover) {
  const L = relLum(cloudShade(cover))
  const onWhite = 1.05 / (L + 0.05)
  const onDark = (L + 0.05) / (relLum(C.ink) + 0.05)
  return onWhite >= onDark ? C.cloudNumLight : C.ink
}

/** 标注中心的 x；第 0 列左对齐，否则「西南 9」这类宽标会被图的左沿裁掉 */
function markX(i, cell) { return i === 0 ? 2 : i * cell + cell / 2 }
function markAnchor(i) { return i === 0 ? 'start' : 'middle' }


/** 折线：数组里每个值 → y；缺值处断开（不补 0）。 */
function segments(list, getY, cell) {
  let out = ''
  let open = false
  for (let i = 0; i < list.length; i++) {
    const v = list[i]
    if (!fin(v)) { open = false; continue }
    const x = i * cell + cell / 2
    out += (open ? 'L' : 'M') + n(x, 1) + ',' + n(getY(v), 2) + ' '
    open = true
  }
  return out.trim() === '' ? '' : out.trim()
}

function finiteValues(list) { return list.filter(v => fin(v)) }

/** 缺值格：一条横线（不是空白格，也不是 0% 的浅色格） */
function cloudGap(x, w, y) {
  return '<rect x="' + n(x + 0.5, 2) + '" y="' + n(y + Y.cloudH / 2 - 0.75, 2) + '" width="' + n(w, 2) +
    '" height="1.5" rx="0.75" fill="' + C.muted + '"/>'
}

/**
 * 云量带（原型 `hourlyChart()` 的写法，meteoblue 式）：已知小时在**列心**放一个色标，
 * 相邻小时之间平滑过渡，而不是一格一格的色块——相邻两小时差 60% 时，读图看到的是
 * 一段斜升，不是两个方块。缺测小时把带**切断**并在原位留一条横线（断口 ≠ 0%）。
 * 只剩一个已知小时时没有可过渡的区间 ⇒ 直接实心填这一小时的颜色。
 * @returns {{defs:string, body:string}} defs 由调用方汇总成一个 `<defs>` 块
 */
function cloudBand(list, y, cell, columns, rowKey) {
  let defs = ''
  let body = ''
  let i = 0
  while (i < columns) {
    if (!fin(list[i])) { body += cloudGap(i * cell, Math.max(1, cell - 1), y); i += 1; continue }
    let j = i
    while (j + 1 < columns && fin(list[j + 1])) j += 1
    const x0 = i * cell
    const x1 = (j + 1) * cell
    if (j === i) {
      body += '<rect x="' + n(x0, 2) + '" y="' + y + '" width="' + n(cell, 2) + '" height="' + Y.cloudH +
        '" fill="' + cloudShade(list[i]) + '"/>'
    } else {
      /* 色标放在列心：梯度从第一列列心到最后一列列心，两端由 SVG 的 pad 延伸到带边。
         这样「这一小时的颜色」恰在读图者对准的列心上（与上方刻度、游标同一条竖线）。 */
      const id = 'cb-' + rowKey + '-' + i
      const cx0 = x0 + cell / 2
      const cx1 = j * cell + cell / 2
      let stops = ''
      for (let k = i; k <= j; k++) {
        stops += '<stop offset="' + n((k * cell + cell / 2 - cx0) / (cx1 - cx0), 4) +
          '" stop-color="' + cloudShade(list[k]) + '"/>'
      }
      defs += '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + n(cx0, 2) +
        '" y1="0" x2="' + n(cx1, 2) + '" y2="0">' + stops + '</linearGradient>'
      body += '<rect x="' + n(x0, 2) + '" y="' + y + '" width="' + n(x1 - x0, 2) + '" height="' + Y.cloudH +
        '" fill="url(#' + id + ')"/>'
    }
    i = j + 1
  }
  return { defs: defs, body: body }
}

/**
 * 带内整数（2026-10-28 裁决：「每 3 小时印一个，0 也印」）。
 * 两条界线：
 *   ① 节奏与上面四段相同（LABEL_EVERY），否则同一条竖线上只有云量没有数字，读起来像两套刻度；
 *   ② **缺读数的小时不印数字**——它已经有一条横线，再印 '—' 会把 12.5px 的带挤满，
 *      而横线本身就是「这一小时没有读数」的记号（不是 0%）。
 * 3 位数（100）在 12.54px 的列上会左右各溢出约 1px，但每个数字隔 3 列（37.6px），
 * 不会压到相邻数字；带内没有别的内容。
 */
function cloudNumbers(list, y, cell, columns) {
  let out = ''
  for (let i = 0; i < columns; i += LABEL_EVERY) {
    if (!fin(list[i])) continue
    const v = Math.max(0, Math.min(100, Math.round(list[i])))
    out += text(markX(i, cell), y + 12, String(v), 9, cloudNumInk(v), markAnchor(i))
  }
  return out
}

/**
 * @param {object} opts
 *   series  —— 窗口内的逐时数组（每项：{t,d,temp,feels,precip,pop,wind,gust,windDir,cloud:{low,mid,high}}）
 *   cursor  —— 选中列（0..n-1）
 *   period  —— 24/48/72（只用于截断；缺省 = series.length）
 *   node    —— {name, altitude}（本图不画海拔，留给云层视图；仅为接口一致性）
 *   width   —— 整块图可用的宽度（含轴列）。列宽 = (width − AXIS_W) / FIT_HOURS
 * @returns {{svg:string,width:number,height:number,cell:number,columns:number,cursor:number}}
 */
function buildHourlySvg(opts) {
  const o = opts || {}
  const all = Array.isArray(o.series) ? o.series : []
  const limit = fin(o.period) ? Math.min(o.period, all.length) : all.length
  const list = all.slice(0, limit)
  const cell = cellFor(o.width)
  if (!list.length) return { svg: '', width: 0, height: HEIGHT, cell: cell, columns: 0, cursor: 0 }
  const width = cell * list.length
  const cursor = Math.max(0, Math.min(list.length - 1, fin(o.cursor) ? Math.round(o.cursor) : 0))

  const temps = list.map(h => h && fin(h.temp) ? h.temp : null)
  const feels = list.map(h => h && fin(h.feels) ? h.feels : null)
  const rain = list.map(h => h && fin(h.precip) ? h.precip : null)
  const pops = list.map(h => h && fin(h.pop) ? h.pop : null)
  const wind = list.map(h => h && fin(h.wind) ? h.wind : null)
  const gust = list.map(h => h && fin(h.gust) ? h.gust : null)
  const dirs = list.map(h => h && fin(h.windDir) ? h.windDir : null)
  const cloud = {
    high: list.map(h => h && h.cloud && fin(h.cloud.high) ? h.cloud.high : null),
    mid: list.map(h => h && h.cloud && fin(h.cloud.mid) ? h.cloud.mid : null),
    low: list.map(h => h && h.cloud && fin(h.cloud.low) ? h.cloud.low : null),
  }

  const tAll = finiteValues(feels).concat(finiteValues(temps))
  const minT = tAll.length ? Math.floor(Math.min.apply(null, tAll) / 5) * 5 : 0
  const maxT = tAll.length ? Math.ceil(Math.max.apply(null, tAll) / 5) * 5 + 1 : 1
  const spanT = Math.max(1, maxT - minT)
  const ty = v => Y.tempBase - (v - minT) / spanT * Y.tempSpan

  const gAll = finiteValues(gust).concat(finiteValues(wind))
  const windMax = Math.max(40, Math.ceil((gAll.length ? Math.max.apply(null, gAll) : 0) / 10) * 10)
  const wy = v => Y.windBase - v / windMax * Y.windSpan

  const rAll = finiteValues(rain)
  const rainMax = Math.max(2, Math.ceil(rAll.length ? Math.max.apply(null, rAll) : 0))
  const barW = Math.max(2, Math.min(14, cell / 3))

  let svg = ''
  // 选中列底色（原型 .selection：fill #eaf5eb opacity .65）
  svg += '<rect x="' + n(cursor * cell, 1) + '" y="0" width="' + n(cell, 2) + '" height="' + HEIGHT +
    '" fill="' + C.sel + '" opacity=".65"/>'
  // 竖向网格每 3 小时一条（逐时网格在 12px 列宽下会变成一片灰底）+ 横向网格
  for (let i = 0; i < list.length; i += LABEL_EVERY) {
    svg += '<path d="M' + n(i * cell + cell / 2, 1) + ' 0V' + HEIGHT + '" stroke="' + C.grid +
      '" stroke-width="0.7" stroke-dasharray="2 4" fill="none"/>'
  }
  Y.grid.forEach(y => {
    svg += '<path d="M0 ' + y + 'H' + n(width, 1) + '" stroke="' + C.grid + '" stroke-width="0.7" stroke-dasharray="2 4" fill="none"/>'
  })
  Y.sep.forEach(y => {
    svg += '<path d="M0 ' + y + 'H' + n(width, 1) + '" stroke="' + C.sep + '" stroke-width="1" fill="none"/>'
  })

  /* ---- 段一：温度 + 体感（标注每 3 小时） ---- */
  const feelsPath = segments(feels, ty, cell)
  const tempPath = segments(temps, ty, cell)
  svg += '<g data-seg="temp">'
  if (feelsPath) svg += '<path d="' + feelsPath + '" stroke="' + C.feels + '" stroke-width="1.5" stroke-dasharray="3 3" fill="none" stroke-linecap="round"/>'
  if (tempPath) svg += '<path d="' + tempPath + '" stroke="' + C.ink + '" stroke-width="2" fill="none" stroke-linecap="round"/>'
  for (let i = 0; i < list.length; i += LABEL_EVERY) {
    if (!fin(temps[i])) { svg += text(markX(i, cell), Y.tempTop + 10, '—', 10, C.muted, markAnchor(i)); continue }
    svg += text(markX(i, cell), ty(temps[i]) - 9, n(temps[i]) + '°', 11, C.temp, markAnchor(i))
  }
  svg += '</g>'

  /* ---- 段二：降水柱（逐时）+ 数值与概率（每 3 小时） ---- */
  svg += '<g data-seg="precip">'
  for (let i = 0; i < list.length; i++) {
    if (!fin(rain[i])) continue
    const x = i * cell + cell / 2
    const bar = rain[i] / rainMax * Y.precipMax
    const h = Math.max(rain[i] > 0 ? 2 : 0, bar)
    svg += '<rect x="' + n(x - barW / 2, 1) + '" y="' + n(Y.precipBase - bar, 2) + '" width="' + n(barW, 2) +
      '" height="' + n(h, 2) + '" rx="2" fill="' + C.rain + '"/>'
  }
  for (let i = 0; i < list.length; i += LABEL_EVERY) {
    const x = markX(i, cell)
    svg += text(x, Y.precipValueY, fin(rain[i]) ? (rain[i] === 0 ? '0.0' : rain[i].toFixed(1)) : '—', 10,
      fin(rain[i]) && rain[i] > 0 ? C.rainText : C.muted, markAnchor(i))
    svg += text(x, Y.popY, fin(pops[i]) ? n(pops[i]) + '%' : '—', 8, C.pop, markAnchor(i))
  }
  svg += '</g>'

  /* ---- 段三：风速 + 阵风（标注每 3 小时；风向每 6 小时） ---- */
  const gustPath = segments(gust, wy, cell)
  const windPath = segments(wind, wy, cell)
  svg += '<g data-seg="wind">'
  if (gustPath) svg += '<path d="' + gustPath + '" stroke="#83a9a4" stroke-width="1.5" stroke-dasharray="3 3" fill="none" stroke-linecap="round"/>'
  if (windPath) svg += '<path d="' + windPath + '" stroke="#427b72" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
  for (let i = 0; i < list.length; i += LABEL_EVERY) {
    const x = markX(i, cell)
    const anchor = markAnchor(i)
    if (fin(gust[i])) svg += text(x, wy(gust[i]) - 5, n(gust[i]), 10, C.gust, anchor)
    const dirText = i % DIR_EVERY === 0 && fin(dirs[i]) ? windDirText(dirs[i]) : ''
    svg += text(x, Y.windDirY, (dirText ? dirText + ' ' : '') + (fin(wind[i]) ? n(wind[i]) : '—'), 8, C.windText, anchor)
  }
  svg += '</g>'

  /* ---- 段四：高 / 中 / 低云量（连续色带 + 每 3 小时一个整数） ---- */
  const rows = [['high', Y.cloudHigh], ['mid', Y.cloudMid], ['low', Y.cloudLow]]
  let cloudDefs = ''
  let cloudBody = ''
  rows.forEach(([key, y]) => {
    const band = cloudBand(cloud[key], y, cell, list.length, key)
    cloudDefs += band.defs
    cloudBody += '<g data-seg="cloud-' + key + '">' + band.body +
      cloudNumbers(cloud[key], y, cell, list.length) + '</g>'
  })
  svg += (cloudDefs ? '<defs>' + cloudDefs + '</defs>' : '') + cloudBody

  // 选中竖线（原型 .cursor：dash 3 3）
  svg += '<path d="M' + n(cursor * cell + cell / 2, 1) + ' 0V' + HEIGHT + '" stroke="' + C.cursor +
    '" stroke-width="1" stroke-dasharray="3 3" fill="none"/>'

  const wInt = Math.round(width)
  const head = '<svg xmlns="http://www.w3.org/2000/svg" width="' + wInt + '" height="' + HEIGHT +
    '" viewBox="0 0 ' + wInt + ' ' + HEIGHT + '">'
  return {
    svg: head + svg + '</svg>',
    width: width,
    height: HEIGHT,
    cell: cell,
    columns: list.length,
    cursor: cursor,
  }
}

// 风向角 → 中文（与 format.windDirText 同口径；本文件不 require format，避免图生成器绑页面层）
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
function windDirText(deg) {
  if (!fin(deg)) return ''
  const i = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return DIRS[i]
}

/** 左侧固定轴列（不随图滚动）：与 SVG 的分段基线一一对应（y 含上方 30px 小时条） */
function axisLayout() {
  return [
    { key: 'time', label: '时刻', unit: '', top: 8, size: 9 },
    { key: 'temp', label: '温度', unit: '°C', top: 42, size: 10 },
    { key: 'precip', label: '降水', unit: 'mm', top: 122, size: 10, sub: '概率 %' },
    { key: 'wind', label: '风', unit: 'km/h', top: 204, size: 10 },
    { key: 'cloudHigh', label: '高云', unit: '', top: 273, size: 9 },
    { key: 'cloudMid', label: '中云', unit: '', top: 293, size: 9 },
    { key: 'cloudLow', label: '低云', unit: '', top: 313, size: 9 },
  ]
}

module.exports = {
  buildHourlySvg, axisLayout, windDirText, cellFor, cloudShade,
  cloudBounds, cloudNumInk, CLOUD_LAYER_KM,
  AXIS_W, FIT_HOURS, MIN_CELL, LABEL_EVERY, HEIGHT, Y, COLORS: C,
}
