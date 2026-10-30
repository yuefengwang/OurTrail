/* 太阳轨迹卡（utils/solar-arc.js）
 *
 * 这一轮只为一张卡：把当日太阳高度角画成曲线，标出日出日落、黄金/蓝调窗口与选中的小时。
 * 判据分工：
 *   §1 输入边界：日期/坐标非法必须拒绝（返回 null，不画一条 0° 直线冒充有数据）
 *   §2 色板单源：SVG 里的字面量必须与 app.wxss 的 token 同值（铁律 13），且不许出现 var()
 *   §3 曲线与升落同一条参照线：从图里反解高度，0° 交点必须落在 astro 给的日出/日落附近
 *   §4 极昼/极夜/南半球：各自的文案与图元要分得开，且不编钟点
 *   §5 海拔：不填 ≠ 填 0 ≠ 填 3077；三种情况的曲线与 note 必须各自成立
 *   §6 选中时刻：竖线 + 点 + 标签；非法时刻不画标记
 *   §7 文案与图元卫生：15 分钟口径、概率语气、无 NaN、点都在画布内
 *
 * 运行：node tools/solar-arc-test.js
 */
'use strict'

let passed = 0, failed = 0
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra ? ' —— ' + extra : '')) }
}
function section (t) { console.log('\n== ' + t + ' ==') }

const fs = require('fs')
const path = require('path')
const A = require('../miniprogram/utils/astro.js')
const S = require('../miniprogram/utils/solar-arc.js')

const APP_WXSS = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'app.wxss'), 'utf8')
const SRC = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'utils', 'solar-arc.js'), 'utf8')

const PAD = { left: 30, right: 10, top: 14, bottom: 22 }
const PLOT_W = S.WIDTH - PAD.left - PAD.right
const PLOT_H = S.HEIGHT - PAD.top - PAD.bottom

const EMEI = { lat: 29.519, lng: 103.332, elevation: 3077 }
const DATE = '2026-10-30'

/* ---------- 从 SVG 反解（不镜像实现：读的是图上真的画了什么） ---------- */

function tickRows (svg) {
  const re = /<text class="tick-label" x="2" y="([-\d.]+)" font-size="10"[^>]*>(-?\d+)°<\/text>/g
  const out = []
  let m
  while ((m = re.exec(svg))) out.push({ y: Number(m[1]), v: Number(m[2]) })
  return out
}
function curveAltMap (svg) {
  const ticks = tickRows(svg)
  const vs = ticks.map(t => t.v)
  const hi = Math.max.apply(null, vs)
  const lo = Math.min.apply(null, vs)
  return y => hi - ((y - PAD.top) / PLOT_H) * (hi - lo)
}
function curvePoints (svg) {
  const m = /<polyline class="curve" points="([^"]+)"/.exec(svg)
  if (!m) return null
  return m[1].trim().split(/\s+/).map(pair => {
    const xy = pair.split(',')
    return { x: Number(xy[0]), y: Number(xy[1]), m: (Number(xy[0]) - PAD.left) / PLOT_W * 1440 }
  })
}
function zeroCrossings (svg) {
  const pts = curvePoints(svg)
  if (!pts) return []
  const alt = curveAltMap(svg)
  const hits = []
  for (let i = 1; i < pts.length; i++) {
    const a = alt(pts[i - 1].y)
    const b = alt(pts[i].y)
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      const t = a === b ? 0 : a / (a - b)
      hits.push({ rise: a < 0, m: pts[i - 1].m + (pts[i].m - pts[i - 1].m) * t })
    }
  }
  return hits
}
function minOfDay (hm) {
  if (!hm) return null
  const p = hm.split(':')
  return Number(p[0]) * 60 + Number(p[1])
}
function diffMin (a, b) {
  let d = Math.abs(a - b) % 1440
  return d > 720 ? 1440 - d : d
}
function hexIn (svg) {
  return (svg.match(/#[0-9A-Fa-f]{3,6}/g) || []).map(x => x.toUpperCase())
}
function token (name) {
  const m = new RegExp('--' + name + ':\\s*([^;]+);').exec(APP_WXSS)
  return m ? m[1].trim().toUpperCase() : null
}

/* ================= §1 输入边界 ================= */

section('§1 输入边界：非法日期/坐标必须弃权，不画假曲线')
{
  check('缺日期 ⇒ null', S.build({ lat: 30, lng: 103 }) === null)
  check('日期格式不对（2026-10-9）⇒ null', S.build({ date: '2026-10-9', lat: 30, lng: 103 }) === null)
  check('日期不是字符串 ⇒ null', S.build({ date: 20261030, lat: 30, lng: 103 }) === null)
  check('坐标缺失 ⇒ null', S.build({ date: DATE }) === null)
  check('坐标是字符串（"abc"）⇒ null', S.build({ date: DATE, lat: 'abc', lng: 103 }) === null)
  check('纬度 91 越界 ⇒ null', S.build({ date: DATE, lat: 91, lng: 103 }) === null)
  check('经度 -181 越界 ⇒ null', S.build({ date: DATE, lat: 30, lng: -181 }) === null)
  check('空参数（不传）⇒ null', S.build() === null)
  const ok = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng })
  check('合法输入给出完整返回体', !!ok && typeof ok.svg === 'string' && typeof ok.summary === 'string' && typeof ok.note === 'string')
  check('返回尺寸与导出常量一致', ok.width === S.WIDTH && ok.height === S.HEIGHT)
  check('minAlt / maxAlt 保留一位小数', /^-?\d+(\.\d)?$/.test(String(ok.minAlt)) && /^-?\d+(\.\d)?$/.test(String(ok.maxAlt)))
}

/* ================= §2 色板单源 ================= */

section('§2 色板单源：SVG 字面量 = app.wxss token，且不许 var()')
{
  const expect = {
    line: 'forest', lineSoft: 'line', muted: 'muted', night: 'forest-soft',
    blue: 'blue-hour', golden: 'golden', white: 'surface',
  }
  const mism = []
  Object.keys(expect).forEach(key => {
    const tok = token(expect[key])
    if (!tok) mism.push(key + '：app.wxss 找不到 --' + expect[key])
    else if (tok !== S.PALETTE[key].toUpperCase()) mism.push(key + '：' + S.PALETTE[key] + ' ≠ --' + expect[key] + '=' + tok)
    const srcLine = new RegExp(key + ":\\s*'#[0-9A-Fa-f]{6}',\\s*// = --" + expect[key]).test(SRC)
    if (!srcLine) mism.push(key + '：缺 // = --' + expect[key] + ' 来源注释')
  })
  check('7 条色板逐条与 token 同值且带来源注释', mism.length === 0, mism.join('；'))

  const svg = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, elevation: EMEI.elevation }).svg
  check('SVG 内不出现 var()', svg.indexOf('var(') === -1)
  const allowed = new Set(Object.keys(S.PALETTE).map(k => S.PALETTE[k].toUpperCase()))
  const unknown = hexIn(svg).filter(c => !allowed.has(c))
  check('SVG 里每个十六进制色都来自色板（没有临时色值）', unknown.length === 0, [...new Set(unknown)].join(' '))
  check('画布底色用 --surface（白），不再叠一层自造底色', svg.indexOf('fill="' + S.PALETTE.white + '"') !== -1)
}

/* ================= §3 曲线与升落同一条参照线 ================= */

section('§3 曲线与升落：0° 交点必须落在 astro 的日出/日落附近')
{
  const r = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, elevation: EMEI.elevation })
  const sun = A.sunTimes(DATE, EMEI.lat, EMEI.lng, EMEI.elevation)
  const pts = curvePoints(r.svg)
  check('曲线按 15 分钟采样并补 23:59（共 97 点）', !!pts && pts.length === 97, pts ? '实测 ' + pts.length : '没有 polyline')
  check('首点落在 00:00，末点落在 23:59', pts && Math.abs(pts[0].m - 0) < 0.5 && Math.abs(pts[96].m - 1439) < 0.5)
  check('白昼口径来自 astro（summary 里有日出与日落）', r.summary.indexOf('日出 ' + sun.sunrise) === 0 && r.summary.indexOf('日落 ' + sun.sunset) !== -1)
  const dur = Math.floor(sun.dayLengthMin / 60) + ' 小时 ' + ((sun.dayLengthMin % 60) < 10 ? '0' : '') + (sun.dayLengthMin % 60) + ' 分'
  check('白昼单独成句（时长不与时刻挤在同一行）', r.daylight === '白昼 ' + dur && r.summary.indexOf('白昼') === -1, r.daylight + ' / ' + r.summary)

  const hits = zeroCrossings(r.svg)
  const rise = hits.filter(h => h.rise)
  const set = hits.filter(h => !h.rise)
  check('曲线只在早上穿上去、傍晚穿下来各一次', rise.length === 1 && set.length === 1, JSON.stringify(hits))
  if (rise.length === 1 && set.length === 1) {
    const dRise = diffMin(rise[0].m, minOfDay(sun.sunrise))
    const dSet = diffMin(set[0].m, minOfDay(sun.sunset))
    check('图上 0° 上穿点与日出偏差 ≤ 15 分钟（含 15 分钟采样）', dRise <= 15, '偏差 ' + dRise.toFixed(1) + ' 分')
    check('图上 0° 下穿点与日落偏差 ≤ 15 分钟', dSet <= 15, '偏差 ' + dSet.toFixed(1) + ' 分')
    check('升落竖线画在同一个横坐标上（线压在交点上）', r.svg.indexOf('x1="' + (PAD.left + minOfDay(sun.sunrise) / 1440 * PLOT_W).toFixed(1)) !== -1)
  }

  const ticks = tickRows(r.svg)
  check('纵轴至少给出上界/0°/下界三条，其中 0° 必在', ticks.length >= 2 && ticks.some(t => t.v === 0), JSON.stringify(ticks))
  check('0° 地平线用虚线（与普通刻度分开）', /class="tick horizon"[^>]*stroke-dasharray="3 3"/.test(r.svg))
  check('0° 以下也画出来了（夜间曲线不被裁掉）', r.minAlt < 0)
  check('纵轴至少 30° 跨度（极昼不全天压成一条直线）', (() => { const vs = ticks.map(t => t.v); return Math.max.apply(null, vs) - Math.min.apply(null, vs) >= 30 })())
}

/* ================= §4 极昼 / 极夜 / 南半球 ================= */

section('§4 极昼、极夜与南半球：各有各的话，不编钟点')
{
  const polarDay = S.build({ date: '2026-06-21', lat: 78.223, lng: 15.646 })
  check('极昼：summary 说极昼且不给日出钟点', polarDay.summary.indexOf('极昼') === 0 && polarDay.summary.indexOf('日出') === -1, polarDay.summary)
  check('极昼：minAlt > 0（整天在地平线以上）', polarDay.minAlt > 0, String(polarDay.minAlt))
  check('极昼：不画日出日落竖线', polarDay.svg.indexOf('class="sun-line"') === -1)
  check('极昼：不铺夜间底色（没有「全天夜」的假象）', polarDay.svg.indexOf('class="night"') === -1)

  const polarNight = S.build({ date: '2026-12-21', lat: 78.223, lng: 15.646 })
  check('极夜：summary 说极夜且不给日落钟点', polarNight.summary.indexOf('极夜') === 0 && polarNight.summary.indexOf('日落') === -1, polarNight.summary)
  check('极夜：maxAlt < 0（整天在地平线以下）', polarNight.maxAlt < 0, String(polarNight.maxAlt))
  check('极夜：夜间底色铺满整幅（含起止两条）', (polarNight.svg.match(/class="night"/g) || []).length === 1 && /class="night" x="30.0"[^>]*width="278.0"/.test(polarNight.svg))
  check('极夜也不画升落竖线', polarNight.svg.indexOf('class="sun-line"') === -1)

  const syd = S.build({ date: DATE, lat: -33.8688, lng: 151.2093 })
  const sydSun = A.sunTimes(DATE, -33.8688, 151.2093)
  check('南半球照常给日出日落', syd.summary.indexOf('日出 ' + sydSun.sunrise) === 0 && syd.summary.indexOf('极昼') === -1, syd.summary)
  const sHits = zeroCrossings(syd.svg)
  check('南半球曲线同样有升有落（不是把北半球图直接照搬）', sHits.length === 2, JSON.stringify(sHits))
}

/* ================= §5 海拔 ================= */

section('§5 海拔：不填 ≠ 填 0 ≠ 填 3077')
{
  const none = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng })
  const nil = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, elevation: null })
  const zero = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, elevation: 0 })
  const high = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, elevation: EMEI.elevation })

  check('不填海拔：note 不说「与海拔」', none.note.indexOf('与海拔') === -1, none.note)
  check('显式 null 与不填逐字节相同（不把「没有读数」当 0）', nil.svg === none.svg && nil.note === none.note && nil.summary === none.summary)
  check('填 0（海平面）与不填的曲线相同，且同样不说「与海拔」', zero.svg === none.svg && zero.note === none.note, zero.note)
  check('填 3077：note 说明按海拔折算', high.note.indexOf('与海拔') !== -1, high.note)
  check('填 3077：曲线整体抬高（俯角约 1.8°）', high.maxAlt - none.maxAlt > 1.4 && high.maxAlt - none.maxAlt < 2.2,
    '抬高 ' + (high.maxAlt - none.maxAlt).toFixed(2) + '°')
  check('填 3077：日出更早、日落更晚（与太阳轨迹方向一致）',
    diffMin(minOfDay(high.summary.match(/日出 (\d\d:\d\d)/)[1]), minOfDay(none.summary.match(/日出 (\d\d:\d\d)/)[1])) >= 1 &&
    diffMin(minOfDay(high.summary.match(/日落 (\d\d:\d\d)/)[1]), minOfDay(none.summary.match(/日落 (\d\d:\d\d)/)[1])) >= 1)
  check('不填海拔也能画出完整曲线（缺高程不是缺数据）', !!curvePoints(none.svg) && none.minAlt < 0 && none.maxAlt > 30)
  const polar0 = S.build({ date: '2026-06-21', lat: 78.223, lng: 15.646, elevation: 0 })
  check('极昼文案在填 0 时也不硬塞「与海拔」', polar0.summary.indexOf('与海拔') === -1, polar0.summary)
}

/* ================= §6 选中时刻 ================= */

section('§6 选中时刻：竖线 + 点 + 标签，非法时刻不画')
{
  const at = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, elevation: EMEI.elevation, selected: '12:00' })
  const cx = (PAD.left + 720 / 1440 * PLOT_W).toFixed(1)
  check('选中 12:00：画点、竖线与标签', at.svg.indexOf('class="sel-dot"') !== -1 && at.svg.indexOf('class="sel-line"') !== -1 && at.svg.indexOf('class="sel-label" data-sel="12:00"') !== -1)
  check('选中点的横坐标 = 12:00 在时间轴上的位置', at.svg.indexOf('<circle class="sel-dot" cx="' + cx + '"') !== -1, '期望 ' + cx)
  const altMap = curveAltMap(at.svg)
  const cy = Number(/<circle class="sel-dot" cx="[-\d.]+" cy="([-\d.]+)"/.exec(at.svg)[1])
  const curveY = (() => {
    const pts = curvePoints(at.svg)
    let best = pts[0]
    pts.forEach(p => { if (Math.abs(p.m - 720) < Math.abs(best.m - 720)) best = p })
    return best.y
  })()
  check('选中点压在曲线上（纵向差不超一格的斜率）', Math.abs(cy - curveY) <= 6, '差 ' + Math.abs(cy - curveY).toFixed(1) + 'px')
  /* 曲线画的是「可见地平线以上」的高度角 = 几何高度 − (SUN_HORIZON − 俯角) = 几何高度 + 0.833 + 俯角 */
  const lift = 0.833 + A.horizonDip(EMEI.elevation)
  check('选中点的高度等于曲线上的高度（不是随手连一条直线）', Math.abs(altMap(cy) - A.solarPosition(A.cnToMs(DATE, '12:00'), EMEI.lat, EMEI.lng).altitude - lift) < 0.6)
  const early = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, selected: '00:00' })
  check('靠左的标签锚点用 start（不溢出画布）', /class="sel-label"[^>]*text-anchor="start"/.test(early.svg))
  const late = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, selected: '23:59' })
  check('靠右的标签锚点用 end', /class="sel-label"[^>]*text-anchor="end"/.test(late.svg))
  check('非法时刻（7:00 少一位）不画标记', S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, selected: '7:00' }).svg.indexOf('sel-dot') === -1)
  check('非法时刻（24:00 越界）不画标记', S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, selected: '24:00' }).svg.indexOf('sel-dot') === -1)
  check('不选时刻时不画标记（卡片可以只当全天图看）', S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng }).svg.indexOf('sel-dot') === -1)
}

/* ================= §7 文案与图元卫生 ================= */

section('§7 文案与图元卫生')
{
  const r = S.build({ date: DATE, lat: EMEI.lat, lng: EMEI.lng, elevation: EMEI.elevation, selected: '12:00' })
  check('note 交代 15 分钟采样口径', r.note.indexOf('每 15 分钟采样') !== -1, r.note)
  check('note 承认山体与云层会改变实际日照（不冒充可见性预测）', r.note.indexOf('山体与云层会改变') !== -1)
  check('文案里没有绝对断言（不会 / 一定 / 必然）', !/不会|一定|必然/.test(r.summary + r.daylight + r.note), r.summary + ' / ' + r.daylight + ' / ' + r.note)
  const bands = r.svg.match(/class="band-(golden|blue)"/g) || []
  check('黄金/蓝调窗口各画两段（晨 + 昏）', bands.filter(x => x.indexOf('golden') !== -1).length === 2 && bands.filter(x => x.indexOf('blue') !== -1).length === 2, JSON.stringify(bands))
  check('窗口色与 token 同值（golden / blue-hour）', r.svg.indexOf('fill="' + S.PALETTE.golden + '"') !== -1 && r.svg.indexOf('fill="' + S.PALETTE.blue + '"') !== -1)
  check('夜间底色只在晨昏之外（两段）', (r.svg.match(/class="night"/g) || []).length === 2)

  const pts = curvePoints(r.svg)
  const badNum = pts.filter(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  check('曲线没有 NaN / Infinity', badNum.length === 0 && r.svg.indexOf('NaN') === -1)
  const out = pts.filter(p => p.x < 0 || p.x > S.WIDTH || p.y < 0 || p.y > S.HEIGHT)
  check('所有点都在画布内', out.length === 0, JSON.stringify(out.slice(0, 3)))
  check('SVG 头声明了 width/height/viewBox', r.svg.indexOf('<svg xmlns="http://www.w3.org/2000/svg" width="' + S.WIDTH + '" height="' + S.HEIGHT + '" viewBox="0 0 ' + S.WIDTH + ' ' + S.HEIGHT + '">') === 0)
  check('曲线用 stroke 不出 fill（不把折线画成色块）', /<polyline class="curve"[^>]*fill="none"[^>]*stroke="#163E35"/.test(r.svg))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (failed) console.log('失败项见上方 ✗。')
process.exit(failed ? 1 : 0)
