// 日月天相的「事实层」：24 小时天穹带、晨昏时刻表、月相盘与月出月落。
// 纯函数、无 wx 依赖（tools/sky-ephemeris-test.js 直接打它）。
//
// 四条边界（与天气线其它图同一套规矩）：
//   1. 只做几何与文案，不新造天文判据：所有穿越点来自 utils/astro.js。
//   2. 画布内色值只能是字面量（铁律 13：SVG 取不到 var()），且必须与 app.wxss 的 token
//      同值；tools/sky-ephemeris-test.js 会逐条回读 app.wxss 核对。
//   3. 判不出的情况要自己说出来：极昼 / 极夜 / 极区月不升不落 / 该纬度不出现的阶段各有各的话，
//      不把 null 印成 0，也不把「该阶段不存在」写成「缺测」。
//   4. 天穹带的相位按太阳高度角每 5 分钟采样得到，不靠「边界数组下标」推算相位——
//      高纬度夏季天文晨昏整段不出现时，下标会错位一格，把航海晨昏画成天文晨昏。
//   5. 日期要真的在日历上存在（'2026-02-30' 会被 Date 挪到 3 月，画出来的就不是卡片写的那个日期）。
'use strict'

const A = require('./astro')

/* 画布色板：与 app.wxss 的 token 同值（改色必须两处同步，测试会逐条核对）。 */
const PALETTE = {
  night: '#163E35',      // = --forest
  astro: '#4E6C65',      // = --on-forest-line
  nautical: '#6C7C93',   // = --blue-hour
  civil: '#D6A33C',      // = --golden
  day: '#ECF0EF',        // = --forest-soft
  line: '#DEE3DB',       // = --line
  muted: '#5F6E66',      // = --muted
  white: '#FFFFFF',      // = --white
  /* 月球暗面复用天色那枚 token，不是另开一种灰：月盘放在白卡上，
     拿 --stone-line 做暗面时亮面与卡片几乎同色，整枚盘会糊成一个浅环。 */
  moonDark: '#163E35',   // = --forest（与天穹带的夜色同值同义）
}

const BAND = { W: 318, H: 88, X0: 10, X1: 308, Y: 8, BAR: 34, TICK: 5 }
const MOON = { W: 64, R: 22, C: 32 }
const STEP_MIN = 5
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

const PHASE_LABEL = {
  night: '天文暗夜',
  astro: '天文晨昏',
  nautical: '航海晨昏',
  civil: '民用晨昏',
  day: '白昼',
}

function pad2(v) { return (v < 10 ? '0' : '') + v }
function hhmmOf(min) { return pad2(Math.floor(min / 60)) + ':' + pad2(Math.round(min % 60)) }
function parseHM(s) {
  const m = HHMM.exec(s || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
function isNum(v) { return typeof v === 'number' && Number.isFinite(v) }

/* 格式对不等于日历上存在：'2026-02-30' 会被 Date.parse 悄悄挪到 3 月 2 日，
   那样画出来的是另一天的天穹带，而卡片上印的还是原来那个日期。 */
function isCalendarDate(s) {
  if (!ISO_DATE.test(s)) return false
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/* 太阳高度 → 昼夜相位。阈值与 astro.sunTimes 同源：白昼用可见地平线
   （SUN_HORIZON − 海拔俯角），暮光用标准几何角 −6 / −12 / −18，不修正俯角。 */
function phaseAt(alt, dip) {
  if (alt >= A.SUN_HORIZON - dip) return 'day'
  if (alt >= -6) return 'civil'
  if (alt >= -12) return 'nautical'
  if (alt >= -18) return 'astro'
  return 'night'
}

/* ---------- 24 小时天穹带 ---------- */

function buildBand(date, lat, lng, elev, selected) {
  const dip = A.horizonDip(elev)
  const x = min => BAND.X0 + (min / 1440) * (BAND.X1 - BAND.X0)

  // 5 分钟采样 ⇒ 断点误差 ≤ 5 分钟（图上 1 px ≈ 4.8 分钟），足以对齐晨昏表。
  const segments = []
  let maxAlt = -Infinity
  let maxMin = 0
  for (let m = 0; m < 1440; m += STEP_MIN) {
    const alt = A.solarPosition(A.cnToMs(date, hhmmOf(m)), lat, lng).altitude
    if (alt > maxAlt) { maxAlt = alt; maxMin = m }
    const key = phaseAt(alt, dip)
    const last = segments[segments.length - 1]
    if (last && last.key === key) last.to = m + STEP_MIN
    else segments.push({ key: key, from: m, to: m + STEP_MIN })
  }

  const sun = A.sunTimes(date, lat, lng, elev)
  const polarDay = sun.sunrise == null && maxAlt >= A.SUN_HORIZON - dip
  const polarNight = sun.sunrise == null && maxAlt < A.SUN_HORIZON - dip

  const parts = []
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + BAND.W + '" height="' + BAND.H + '" viewBox="0 0 ' + BAND.W + ' ' + BAND.H + '">')
  parts.push('<defs><clipPath id="skyBandClip"><rect x="' + BAND.X0 + '" y="' + BAND.Y + '" width="' + (BAND.X1 - BAND.X0) +
    '" height="' + BAND.BAR + '" rx="6"/></clipPath></defs>')
  parts.push('<rect x="0" y="0" width="' + BAND.W + '" height="' + BAND.H + '" fill="' + PALETTE.white + '"/>')
  parts.push('<g clip-path="url(#skyBandClip)">')
  segments.forEach(seg => {
    const w = Math.max(0, x(seg.to) - x(seg.from))
    if (!w) return
    parts.push('<rect class="phase phase-' + seg.key + '" x="' + x(seg.from).toFixed(1) + '" y="' + BAND.Y +
      '" width="' + w.toFixed(1) + '" height="' + BAND.BAR + '" fill="' + PALETTE[seg.key] + '"/>')
  })
  parts.push('</g>')
  parts.push('<rect x="' + BAND.X0 + '" y="' + BAND.Y + '" width="' + (BAND.X1 - BAND.X0) + '" height="' + BAND.BAR +
    '" rx="6" fill="none" stroke="' + PALETTE.line + '" stroke-width="1"/>')

  /* 日出日落：细虚线，用夜色（深绿）而不是白色。升落点必然落在「民用晨昏↔白昼」的界上，
     两侧都是浅色（金 / 浅灰），白线在浅底上对比≈1.1:1 等于没画（真机截图读不出来）。
     具体时刻在晨昏表里，图上仍不塞文字。 */
  ;[sun.sunrise, sun.sunset].forEach(t => {
    const m = parseHM(t)
    if (m == null) return
    parts.push('<line class="sun-mark" x1="' + x(m).toFixed(1) + '" y1="' + BAND.Y + '" x2="' + x(m).toFixed(1) +
      '" y2="' + (BAND.Y + BAND.BAR) + '" stroke="' + PALETTE.night + '" stroke-width="1" stroke-dasharray="2 2" opacity="0.55"/>')
  })

  // 选中时刻：白点 + 深绿描边（与日照卡的选中点同一套语义）。
  if (HHMM.test(selected || '')) {
    const m = parseHM(selected)
    parts.push('<circle class="sel-dot" data-sel="' + selected + '" cx="' + x(m).toFixed(1) + '" cy="' + (BAND.Y + BAND.BAR / 2) +
      '" r="4" fill="' + PALETTE.white + '" stroke="' + PALETTE.night + '" stroke-width="1.5"/>')
  }

  // 时间刻度：00 / 06 / 12 / 18 / 24，两侧贴边不越界。
  const tickY = BAND.Y + BAND.BAR
  ;[0, 360, 720, 1080, 1440].forEach(min => {
    const xx = x(min)
    parts.push('<line class="tick" x1="' + xx.toFixed(1) + '" y1="' + tickY + '" x2="' + xx.toFixed(1) + '" y2="' + (tickY + 4) +
      '" stroke="' + PALETTE.line + '" stroke-width="1"/>')
    const anchor = min === 0 ? 'start' : min === 1440 ? 'end' : 'middle'
    parts.push('<text class="tick-label" x="' + xx.toFixed(1) + '" y="' + (tickY + 16) + '" text-anchor="' + anchor +
      '" font-size="9" fill="' + PALETTE.muted + '">' + hhmmOf(min) + '</text>')
  })
  parts.push('</svg>')

  let summary
  if (polarDay) summary = '极昼 · 当日太阳不落（按坐标与海拔计算）'
  else if (polarNight) summary = '极夜 · 当日太阳不升（按坐标与海拔计算）'
  else summary = '太阳最高 ' + hhmmOf(maxMin) + '（' + Math.round(maxAlt) + '°）'

  const elevTxt = isNum(elev) && elev > 0 ? '与海拔' : ''
  return {
    svg: parts.join(''),
    width: BAND.W,
    height: BAND.H,
    summary: summary,
    note: '底色按太阳高度角每 5 分钟采样分段；按坐标' + elevTxt + '计算，不含山体与云层遮挡。',
    phases: segments.map(s => ({ key: s.key, label: PHASE_LABEL[s.key], from: s.from, to: s.to })),
  }
}

/* ---------- 晨昏时刻表 ---------- */

function buildTwilight(date, lat, lng, elev) {
  const s = A.sunTimes(date, lat, lng, elev)
  const box = v => (v == null ? '—' : v)
  const dawnRows = [
    { k: '天文晨光始', v: box(s.astroDawn) },
    { k: '航海晨光始', v: box(s.nauticalDawn) },
    { k: '民用晨光始', v: box(s.civilDawn) },
    { k: '日出', v: box(s.sunrise) },
  ]
  /* 两列都按时间前进方向排（晨列读下来是天亮，暮列读下来是天黑），
     与晨列镜像：日落在上、天文暗夜在下。 */
  const duskRows = [
    { k: '日落', v: box(s.sunset) },
    { k: '民用暮光终', v: box(s.civilDusk) },
    { k: '航海暮光终', v: box(s.nauticalDusk) },
    { k: '天文暗夜始', v: box(s.astroDusk) },
  ]
  const missing = dawnRows.concat(duskRows).some(r => r.v === '—')
  const polar = s.sunrise == null && s.sunset == null
  let note
  if (polar) {
    note = '当日太阳不升或不落，晨昏阶段没有出现；表中「—」不是缺测。'
  } else if (missing) {
    note = '「—」表示该纬度当日不出现这个阶段（例如夏季没有天文暗夜），不是缺测。'
  } else {
    note = '按太阳高度角穿越计算：日出日落含海拔俯角修正，暮光角取标准几何角。'
  }
  return { dawnRows: dawnRows, duskRows: duskRows, note: note }
}

/* ---------- 月相盘 ---------- */

function buildMoonSvg(moon, lat) {
  const illum = Math.max(0, Math.min(100, Number(moon.illumination) || 0))
  const c = MOON.C
  const r = MOON.R
  const parts = []
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + MOON.W + '" height="' + MOON.W + '" viewBox="0 0 ' + MOON.W + ' ' + MOON.W + '">')
  parts.push('<circle class="moon-shadow" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + PALETTE.moonDark + '"/>')
  let lit = ''
  if (illum >= 99) {
    lit = '<circle class="moon-lit" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + PALETTE.white + '"/>'
  } else if (illum > 1) {
    /* 明暗界线是半椭圆：半短轴 |1−2f|·r，f 为照亮比例。
       f<50% 是月牙（界线向亮侧鼓），f>50% 是凸月（界线向暗侧鼓）。 */
    const a = Math.abs(1 - (2 * illum) / 100) * r
    const sweep = illum < 50 ? 0 : 1
    const path = 'M ' + c + ' ' + (c - r) +
      ' A ' + r + ' ' + r + ' 0 0 1 ' + c + ' ' + (c + r) +
      ' A ' + a.toFixed(2) + ' ' + r + ' 0 0 ' + sweep + ' ' + c + ' ' + (c - r) + ' Z'
    lit = '<path class="moon-lit" d="' + path + '" fill="' + PALETTE.white + '"/>'
  }
  /* 北半球上弦（盈）亮面在右；南半球相反。以「盈月+北半球」为基准，
     两种条件错开其一就整体镜像。 */
  const waxing = Number(moon.age) < A.SYNODIC / 2
  const flip = waxing === (Number(lat) < 0)
  parts.push(flip ? '<g transform="translate(' + MOON.W + ',0) scale(-1,1)">' + lit + '</g>' : lit)
  parts.push('<circle class="moon-rim" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + PALETTE.muted +
    '" stroke-width="1" opacity="0.55"/>')
  parts.push('</svg>')
  return parts.join('')
}

function buildMoon(date, lat, lng, elev, moon) {
  const mi = moon || A.moonInfo(date)
  const mt = A.moonTimes(date, lat, lng, elev)
  const riseMin = parseHM(mt.rise)
  const setMin = parseHM(mt.set)
  // 月落早于月出 ⇒ 落在次日凌晨。这个判定只做一次，riseText 与两栏格都从它派生。
  const nextDay = setMin != null && riseMin != null && setMin < riseMin
  let riseCell
  let setCell
  let riseText
  if (mt.alwaysUp) {
    riseCell = { k: '月出', v: '不落' }
    setCell = { k: '月落', v: '不落' }
    riseText = '当日不落'
  } else if (mt.alwaysDown) {
    riseCell = { k: '月出', v: '不升' }
    setCell = { k: '月落', v: '不升' }
    riseText = '当日不升'
  } else {
    riseCell = { k: '月出', v: mt.rise || '—', hint: '' }
    setCell = { k: '月落', v: mt.set || '—', hint: nextDay ? '（次日）' : '' }
    if (mt.rise && mt.set) riseText = '月出 ' + mt.rise + ' · 月落 ' + mt.set + (nextDay ? '（次日）' : '')
    else if (mt.rise) riseText = '月出 ' + mt.rise + ' · 当日无月落'
    else if (mt.set) riseText = '当日无月出 · 月落 ' + mt.set
    else riseText = '当日无月出月落'
  }

  return {
    name: mi.name,
    illumination: mi.illumination,
    age: mi.age,
    rise: mt.rise || '',
    set: mt.set || '',
    riseCell: riseCell,
    setCell: setCell,
    riseText: riseText,
    svg: buildMoonSvg(mi, lat),
    width: MOON.W,
    height: MOON.W,
    note: '相位与照亮比例按日期计算；月出月落按坐标与海拔每 10 分钟采样估算，误差约几分钟。'
      + '照亮比例只描述夜空照明条件，银河与星空是否可见还要看云量、光污染与月光高度。',
  }
}

/* ---------- 装配 ---------- */

/**
 * @param {{date:string, lat:number, lng:number, elevation?:number|null, selected?:string}} opts
 * @returns {null|{date:string, band:object, twilight:object, moon:object}}
 *          日期/坐标非法时返回 null（页面据此不渲染卡，而不是画一条假的天穹带）。
 */
function build(opts) {
  const o = opts || {}
  if (!isCalendarDate(o.date || '')) return null
  const lat = Number(o.lat)
  const lng = Number(o.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  /* 只认真正的数字：Number(null) === 0 会把「没有海拔」当成海平面，
     让日出日落提前约 0 分钟、天穹带的白昼段变宽。 */
  const elev = isNum(o.elevation) ? o.elevation : null
  try {
    return {
      date: o.date,
      band: buildBand(o.date, lat, lng, elev, o.selected || ''),
      twilight: buildTwilight(o.date, lat, lng, elev),
      moon: buildMoon(o.date, lat, lng, elev),
    }
  } catch (e) {
    return null
  }
}

module.exports = { build, PALETTE, PHASE_LABEL, BAND, MOON }
