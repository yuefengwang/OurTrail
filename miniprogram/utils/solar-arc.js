// 太阳轨迹卡（日月天相页顶部）：把当日太阳高度角画成一条曲线。
// 纯函数、无 wx 依赖（tools/solar-arc-test.js 直接打它）。
//
// 三条边界（与天气线其它图同一套规矩）：
//   1. 画布内色值只能是字面量（铁律 13：SVG/canvas 取不到 var()），每条注明来源 token；
//      tools/solar-arc-test.js 回读 app.wxss，字面量与 token 不一致就红。
//   2. 本模块只做几何与文案，不新造天文判据：日出日落/暮光/黄金蓝调全部来自 utils/astro.js。
//   3. 判不出的情况要自己说出来：极昼、极夜、坐标非法各有各的话，不把 null 印成 0。
'use strict'

const A = require('./astro')

/* 画布色板：与 app.wxss 的 token 同值（改色必须两处同步，测试会逐条核对）。 */
const PALETTE = {
  line: '#163E35',      // = --forest
  lineSoft: '#DEE3DB',  // = --line
  muted: '#5F6E66',     // = --muted
  night: '#ECF0EF',     // = --forest-soft
  blue: '#6C7C93',      // = --blue-hour
  golden: '#D6A33C',    // = --golden
  white: '#FFFFFF',     // = --surface
}

const W = 318
const H = 136
const PAD = { left: 30, right: 10, top: 14, bottom: 22 }
const STEP_MIN = 15
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function pad2(v) { return (v < 10 ? '0' : '') + v }

function parseHM(s) {
  const m = HHMM.exec(s || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function fmtDur(min) {
  if (!Number.isFinite(min)) return '—'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h + ' 小时 ' + pad2(m) + ' 分'
}

/**
 * 生成太阳轨迹 SVG 与口径文案。
 * @param {{date:string, lat:number, lng:number, elevation?:number, selected?:string}} opts
 * @returns {null|{svg:string,width:number,height:number,summary:string,daylight:string,note:string,minAlt:number,maxAlt:number}}
 *         坐标/日期非法时返回 null（页面据此不渲染卡，而不是画一条 0° 直线冒充"有数据"）。
 */
function build(opts) {
  const o = opts || {}
  const date = o.date
  if (!ISO_DATE.test(date || '')) return null
  const lat = Number(o.lat)
  const lng = Number(o.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  /* 只认真正的数字：Number(null) === 0 会把「没有海拔」画成海平面并把曲线抬高 0.8°，
     而海拔缺失本来就该走「无海拔」这一支（note 也不许印「按海拔」）。 */
  const elev = typeof o.elevation === 'number' && Number.isFinite(o.elevation) ? o.elevation : null

  const sun = A.sunTimes(date, lat, lng, elev)
  const win = A.photoWindows(date, lat, lng, elev)
  /* 曲线与日出日落在同一条参照线上：astro 的升落判据是几何高度穿越
     SUN_HORIZON − dip（蒙气差 + 海拔俯角），若直接画几何高度，
     日出那条竖线会与曲线在 0° 的交点差出 0.8°–2.6°，看起来像"少画了一段"。
     这里把采样值折算成「可见地平线以上」的高度角，0° 即可见地平线，
     极昼/极夜的判定也随 sunTimes 一起走。公式只用 astro 已有的两个量，不新造常数。 */
  const dip = A.horizonDip(elev)
  const apparent = geo => geo - (A.SUN_HORIZON - dip)

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = m => PAD.left + (m / 1440) * plotW

  // 15 分钟采样：太阳高度角变化是连续的，15 分钟足以让曲线看不出折线。
  // 不在这里做"日出前后加密"——那是给高度角穿越点做精度，而穿越点由 astro.sunTimes 直接给出。
  const samples = []
  for (let m = 0; m < 1440; m += STEP_MIN) {
    samples.push({ m, alt: apparent(A.solarPosition(A.cnToMs(date, pad2(Math.floor(m / 60)) + ':' + pad2(m % 60)), lat, lng).altitude) })
  }
  // 曲线末端补 23:59：否则图会在 23:45 处无解释地断掉（最后一格看起来像缺数据）
  samples.push({ m: 1439, alt: apparent(A.solarPosition(A.cnToMs(date, '23:59'), lat, lng).altitude) })

  let minAlt = Infinity
  let maxAlt = -Infinity
  samples.forEach(s => {
    if (s.alt < minAlt) minAlt = s.alt
    if (s.alt > maxAlt) maxAlt = s.alt
  })

  // 纵轴：先把 0° 包进来（地平线是要看的参照线），再按 10° 取整并保证至少 30° 跨度——
  // 否则极昼那天的高度角可能只占 5°，曲线压成一条贴顶的直线，看不出"全天都高"。
  let lo = Math.floor(minAlt / 10) * 10
  let hi = Math.ceil(maxAlt / 10) * 10
  if (lo > 0) lo = 0
  if (hi < 0) hi = 0
  if (hi - lo < 30) hi = lo + 30
  const y = alt => PAD.top + ((hi - alt) / (hi - lo)) * plotH

  const dawn = parseHM(sun.astroDawn)
  const dusk = parseHM(sun.astroDusk)
  const night = []
  if (sun.sunrise && sun.sunset) {
    // 有升落 ⇒ 夜间 = 天文暗夜两端；没有天文暗夜（高纬白夜）就不铺底色，不编一个假的暗夜边界。
    if (dawn != null && dawn > 0) night.push([0, dawn])
    if (dusk != null && dusk < 1440) night.push([dusk, 1440])
  } else if (maxAlt < 0) {
    // 极夜：太阳整天不升。此时 astro 仍可能给出天文暮光（太阳在 -18° 以下），
    // 但图上必须整天是底色，否则正午会被画成「白天」。
    night.push([0, 1440])
  }

  const bands = []
  const pushBand = (w, color, cls) => {
    if (!w) return
    const from = parseHM(w.from)
    const to = parseHM(w.to)
    if (from == null || to == null || to <= from) return
    bands.push({ from, to, color, cls })
  }
  pushBand(win.dawnBlue, PALETTE.blue, 'band-blue')
  pushBand(win.morningGolden, PALETTE.golden, 'band-golden')
  pushBand(win.eveningGolden, PALETTE.golden, 'band-golden')
  pushBand(win.duskBlue, PALETTE.blue, 'band-blue')

  const parts = []
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">')
  parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + PALETTE.white + '"/>')
  night.forEach(seg => {
    parts.push('<rect class="night" x="' + x(seg[0]).toFixed(1) + '" y="' + PAD.top + '" width="' +
      Math.max(0, x(seg[1]) - x(seg[0])).toFixed(1) + '" height="' + plotH + '" fill="' + PALETTE.night + '"/>')
  })
  bands.forEach(b => {
    parts.push('<rect class="' + b.cls + '" x="' + x(b.from).toFixed(1) + '" y="' + PAD.top + '" width="' +
      Math.max(1, x(b.to) - x(b.from)).toFixed(1) + '" height="' + plotH + '" fill="' + b.color + '" opacity="0.26"/>')
  })

  // 高度刻度：上界 / 0° / 下界。0° 那条用虚线（它是地平线，不是普通刻度）。
  const ticks = []
  const pushTick = v => { if (ticks.indexOf(v) === -1) ticks.push(v) }
  pushTick(hi); pushTick(0); pushTick(lo)
  ticks.forEach(v => {
    const yy = y(v)
    parts.push('<line class="tick' + (v === 0 ? ' horizon' : '') + '" x1="' + PAD.left + '" y1="' + yy.toFixed(1) +
      '" x2="' + (W - PAD.right) + '" y2="' + yy.toFixed(1) + '" stroke="' + (v === 0 ? PALETTE.muted : PALETTE.lineSoft) +
      '" stroke-width="1"' + (v === 0 ? ' stroke-dasharray="3 3" opacity="0.55"' : '') + '/>')
    parts.push('<text class="tick-label" x="2" y="' + (yy + 3).toFixed(1) + '" font-size="10" fill="' + PALETTE.muted + '">' + v + '°</text>')
  })

  // 日出日落：细虚线标记，具体时刻写在卡片副标题里（图上不塞文字，避免与曲线/选中标签叠字）
  ;[sun.sunrise, sun.sunset].forEach(t => {
    const m = parseHM(t)
    if (m == null) return
    parts.push('<line class="sun-line" x1="' + x(m).toFixed(1) + '" y1="' + PAD.top + '" x2="' + x(m).toFixed(1) +
      '" y2="' + (H - PAD.bottom) + '" stroke="' + PALETTE.muted + '" stroke-width="1" stroke-dasharray="2 3" opacity="0.4"/>')
  })

  const pts = samples.map(s => x(s.m).toFixed(1) + ',' + y(s.alt).toFixed(1)).join(' ')
  parts.push('<polyline class="curve" points="' + pts + '" fill="none" stroke="' + PALETTE.line + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>')

  // 选中时刻：竖线 + 曲线上的点。点压在曲线上，读者能对上"这个时刻太阳有多高"。
  if (HHMM.test(o.selected || '')) {
    const m = parseHM(o.selected)
    const alt = apparent(A.solarPosition(A.cnToMs(date, o.selected), lat, lng).altitude)
    const sx = x(m)
    const sy = y(alt)
    const anchor = sx < PAD.left + 24 ? 'start' : (sx > W - PAD.right - 24 ? 'end' : 'middle')
    parts.push('<line class="sel-line" x1="' + sx.toFixed(1) + '" y1="' + PAD.top + '" x2="' + sx.toFixed(1) +
      '" y2="' + (H - PAD.bottom) + '" stroke="' + PALETTE.muted + '" stroke-width="1" stroke-dasharray="4 3" opacity="0.65"/>')
    parts.push('<circle class="sel-dot" cx="' + sx.toFixed(1) + '" cy="' + sy.toFixed(1) + '" r="3.4" fill="' + PALETTE.golden +
      '" stroke="' + PALETTE.white + '" stroke-width="1.5"/>')
    parts.push('<text class="sel-label" data-sel="' + o.selected + '" x="' + sx.toFixed(1) + '" y="10" text-anchor="' + anchor +
      '" font-size="10" fill="' + PALETTE.line + '">' + o.selected + '</text>')
  }
  parts.push('</svg>')

  const allAbove = minAlt > 0
  const allBelow = maxAlt < 0
  /* 海拔只在真的加了俯角时才算「按海拔计算」：填 0 与不填的曲线逐点相同，
     说「与海拔」会让读者以为图上那段提前的日出是海拔带来的。 */
  const elevTxt = elev != null && elev > 0 ? '与海拔' : ''
  let summary
  /* 白昼单独成句：中文可以在任意两字之间折行，合成一句时实测断在「白昼 11 / 小时 21 分」
     （真机 2026-10-30）——把时长拆出来由页面单独一行，断行由排版决定而不是由字数撞。 */
  let daylight = ''
  if (sun.sunrise && sun.sunset) {
    summary = '日出 ' + sun.sunrise + ' · 日落 ' + sun.sunset
    daylight = '白昼 ' + fmtDur(sun.dayLengthMin)
  } else if (allAbove) {
    summary = '极昼 · 当日太阳不落（按坐标' + elevTxt + '计算）'
  } else if (allBelow) {
    summary = '极夜 · 当日太阳不升（按坐标' + elevTxt + '计算）'
  } else {
    // 模型自相矛盾（有采样却给不出升落）时弃权，不编一个钟点
    summary = '当日太阳升落无法计算，请核对坐标与日期。'
  }

  return {
    svg: parts.join(''),
    width: W,
    height: H,
    summary,
    daylight,
    note: '曲线按坐标' + elevTxt + '每 15 分钟采样，并折算为可见地平线以上的高度角；山体与云层会改变实际可见的日照时段。',
    minAlt: Math.round(minAlt * 10) / 10,
    maxAlt: Math.round(maxAlt * 10) / 10,
  }
}

module.exports = { build, PALETTE, WIDTH: W, HEIGHT: H }
