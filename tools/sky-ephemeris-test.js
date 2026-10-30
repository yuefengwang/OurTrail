/* 日月标签的剩余三块（utils/sky-ephemeris.js）：24h 天穹带 / 晨昏时刻表 / 月相盘
 *
 * 判据分工：
 *   §1 输入边界：日期/坐标非法必须返回 null（不画一条「全是白天」的假带），日历不存在的日期也拒绝
 *   §2 色板单源：SVG 里的字面量必须与 app.wxss 的 token 同值；图里不许出现 var() 与未登记色值
 *   §3 相位与 astro 同源：每个分段边界都要落在 astro.sunTimes 给的穿越点 ±6 分钟内（5 分钟采样 + 取整）
 *   §4 极端纬度：极昼/极夜各一条分段、晨昏表全是「—」且说明这不是缺测；夏季无天文暗夜时也没有夜色段
 *   §5 海拔：不填 ≠ 填 0 ≠ 填 3077；只有真的给了海拔才在文案里说「与海拔」
 *   §6 选中时刻：白点落在正确 x（按分钟线性换算），非法时刻不画点
 *   §7 图元卫生：无 NaN、clipPath 先定义后引用、刻度贴边不越界
 *   §8 晨昏表 = astro 逐字：四个晨间阶段与四个暮间阶段一个不差；「—」的三种语义各有各的话
 *   §9 月相：相位/照亮比例/月龄与 astro 同源；明暗界线按盈亏与半球镜像；满月/新月不画假牙；
 *      月出月落缺失与「次日月落」各自说清楚
 *  §10 页面接线：真页面 buildSkyEphemeris / selectHour 一次 setData 里两块卡说同一时刻；
 *      首屏默认「逐时预报」；算不出时是 null 而不是空壳
 *  §11 文案卫生：没有绝对断言（不会 / 一定 / 必然 / 保证），采样口径写进 note
 *
 * 运行：node tools/sky-ephemeris-test.js
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
const E = require('../miniprogram/utils/sky-ephemeris.js')

const ROOT = path.join(__dirname, '..')
const APP_WXSS = fs.readFileSync(path.join(ROOT, 'miniprogram', 'app.wxss'), 'utf8')
const WXML = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'weather', 'weather.wxml'), 'utf8')
const PAGE_SRC = fs.readFileSync(path.join(ROOT, 'miniprogram', 'pages', 'weather', 'weather.js'), 'utf8')
const MODULE_SRC = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'sky-ephemeris.js'), 'utf8')

const EMEI = { date: '2026-10-30', lat: 29.5183, lng: 103.3358, elevation: 3077 }
const NOW = E.build(EMEI)
const POLAR_DAY = E.build({ date: '2026-06-21', lat: 78.2, lng: 15.6, elevation: 20 })
const POLAR_NIGHT = E.build({ date: '2026-12-21', lat: 78.2, lng: 15.6, elevation: 20 })
// 60°N 夏至：太阳最低只到约 −6.5°，没有航海/天文暮光段 —— 用来钉「该阶段不出现」不是缺测
const SUMMER_NO_ASTRO = E.build({ date: '2026-06-21', lat: 60, lng: 105, elevation: 0 })

/* ---------- 从 SVG 反解（读的是图上真的画了什么，不镜像实现） ---------- */

function parsePhases (svg) {
  const out = []
  const re = /<rect class="phase phase-([a-z]+)" x="([\d.]+)" y="(%BANDY%)" width="([\d.]+)" height="%BAR%" fill="(#[0-9A-F]{6})"/g
  const reText = re.source.replace('%BANDY%', E.BAND.Y).replace('%BAR%', E.BAND.BAR)
  const rx = new RegExp(reText, 'g')
  let m
  while ((m = rx.exec(svg))) out.push({ key: m[1], x: Number(m[2]), w: Number(m[4]), fill: m[5] })
  return out
}

function colorsIn (svg) {
  const set = new Set()
  const rx = /(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g
  let m
  while ((m = rx.exec(svg))) set.add(m[1].toUpperCase())
  return Array.from(set)
}

function hm2min (s) {
  const m = /^(\d{2}):(\d{2})$/.exec(s || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/* 相位分段边界 ↔ astro 穿越点：只看「跨过哪一层」，方向由更亮/更暗决定 */
const CROSSINGS = {
  'day|civil': ['sunrise', 'sunset'],
  'civil|nautical': ['civilDawn', 'civilDusk'],
  'nautical|astro': ['nauticalDawn', 'nauticalDusk'],
  'astro|night': ['astroDawn', 'astroDusk'],
}
function boundaryErrors (band, sun) {
  const errs = []
  const ph = band.phases
  for (let i = 1; i < ph.length; i++) {
    const a = ph[i - 1].key, b = ph[i].key
    const key = CROSSINGS[a + '|' + b] || CROSSINGS[b + '|' + a]
    if (!key) { errs.push(a + '→' + b + ' 没有对应的 astro 阶段'); continue }
    const at = ph[i].from
    const cands = key.map(k => hm2min(sun[k])).filter(v => v != null)
    if (!cands.length) { errs.push(a + '→' + b + ' 出现了，但 astro 说当日没有这个阶段'); continue }
    const best = cands.reduce((best, v) => (Math.abs(v - at) < Math.abs(best - at) ? v : best), cands[0])
    if (Math.abs(best - at) > 6) errs.push(a + '→' + b + ' 在 ' + ph[i].from + ' 分，astro 给 ' + best + ' 分')
  }
  return errs
}

/* ---------- §1 输入边界 ---------- */

section('§1 输入边界：日期/坐标非法一律 null，不画假天穹带')
check('合法输入三块齐全', !!NOW && !!NOW.band && !!NOW.twilight && !!NOW.moon)
check('空参数返回 null', E.build() === null && E.build(null) === null)
check('日期格式非法返回 null', E.build({ date: '2026/10/30', lat: 30, lng: 103 }) === null)
check('日历上不存在的日期返回 null（2026-02-30 不许被 Date 悄悄挪到 3 月）',
  E.build({ date: '2026-02-30', lat: 30, lng: 103 }) === null)
check('闰日仍然有效', E.build({ date: '2028-02-29', lat: 30, lng: 103 }) !== null)
check('纬度越界返回 null', E.build({ date: '2026-10-30', lat: 91, lng: 0 }) === null)
check('经度越界返回 null', E.build({ date: '2026-10-30', lat: 30, lng: 181 }) === null)
check('坐标非数字返回 null', E.build({ date: '2026-10-30', lat: '29.5N', lng: 103 }) === null)
check('坐标缺一项返回 null', E.build({ date: '2026-10-30', lat: 29.5 }) === null)

/* ---------- §2 色板单源 ---------- */

section('§2 色板与 app.wxss 同值（铁律 13：画布里取不到 var()）')
const token = name => {
  const m = new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})').exec(APP_WXSS)
  return m ? m[1].toUpperCase() : null
}
const PAIRS = [
  ['night', 'forest'], ['astro', 'on-forest-line'], ['nautical', 'blue-hour'],
  ['civil', 'golden'], ['day', 'forest-soft'], ['line', 'line'], ['muted', 'muted'],
  ['white', 'white'], ['moonDark', 'forest'],
]
PAIRS.forEach(([key, tok]) => {
  check('PALETTE.' + key + ' = --' + tok, token(tok) && E.PALETTE[key].toUpperCase() === token(tok),
    E.PALETTE[key] + ' vs ' + token(tok))
})
const allSvg = NOW.band.svg + NOW.moon.svg + POLAR_DAY.band.svg
const PALETTE_VALUES = Object.keys(E.PALETTE).map(k => E.PALETTE[k].toUpperCase())
check('图里没有 var() 引用', allSvg.indexOf('var(') === -1)
check('图里每个色值都在 PALETTE 里（没有自己发明第六种颜色）',
  colorsIn(allSvg).every(c => PALETTE_VALUES.indexOf(c) !== -1), JSON.stringify(colorsIn(allSvg)))
check('PALETTE 里每个色值都能在 app.wxss 找到同值 token',
  PALETTE_VALUES.every(v => APP_WXSS.toUpperCase().indexOf(v) !== -1))

/* ---------- §3 相位与 astro 同源 ---------- */

section('§3 分段边界必须落在 astro 的穿越点上（±6 分钟：5 分钟采样 + 取整）')
const sunEmei = A.sunTimes(EMEI.date, EMEI.lat, EMEI.lng, EMEI.elevation)
const errEmei = boundaryErrors(NOW.band, sunEmei)
check('峨眉山 24h：八处穿越点逐个对齐', errEmei.length === 0, JSON.stringify(errEmei))
const sunEq = A.sunTimes('2026-03-20', 0, 105, 0)
const bandEq = E.build({ date: '2026-03-20', lat: 0, lng: 105, elevation: 0 }).band
check('赤道春分：边界同样对齐', boundaryErrors(bandEq, sunEq).length === 0, JSON.stringify(boundaryErrors(bandEq, sunEq)))
check('分段首尾覆盖整天且首尾相接',
  NOW.band.phases[0].from === 0 &&
  NOW.band.phases[NOW.band.phases.length - 1].to === 1440 &&
  NOW.band.phases.every((p, i) => i === 0 || p.from === NOW.band.phases[i - 1].to))
check('相邻分段不许同相位（合并过，不是逐格堆叠）',
  NOW.band.phases.every((p, i) => i === 0 || p.key !== NOW.band.phases[i - 1].key))
const day = NOW.band.phases.find(p => p.key === 'day')
check('峨眉山白昼段起止 = 日出/日落',
  Math.abs(day.from - hm2min(sunEmei.sunrise)) <= 6 && Math.abs(day.to - hm2min(sunEmei.sunset)) <= 6,
  JSON.stringify(day))
check('summary 的「太阳最高」与采样峰值同分钟（±5）',
  Math.abs(hm2min(NOW.band.summary.slice(5, 10)) - (() => {
    let best = -99, at = 0
    for (let m = 0; m <= 1440; m += 5) {
      const alt = A.solarPosition(A.cnToMs(EMEI.date, ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2)), EMEI.lat, EMEI.lng).altitude
      if (alt > best) { best = alt; at = m }
    }
    return at
  })()) <= 6, NOW.band.summary)

/* ---------- §4 极端纬度 ---------- */

section('§4 极昼 / 极夜 / 夏季无天文暗夜：各自的文案与分段')
check('极昼：只有一段白昼', POLAR_DAY.band.phases.length === 1 && POLAR_DAY.band.phases[0].key === 'day')
check('极昼 summary 说明「太阳不落」', /极昼/.test(POLAR_DAY.band.summary) && /不落/.test(POLAR_DAY.band.summary), POLAR_DAY.band.summary)
check('极夜：没有白昼段（太阳最高也在地平线以下）',
  POLAR_NIGHT.band.phases.every(p => p.key !== 'day') &&
  POLAR_NIGHT.band.phases.every(p => p.key === 'night' || p.key === 'astro' || p.key === 'nautical' || p.key === 'civil'),
  JSON.stringify(POLAR_NIGHT.band.phases))
check('极夜 summary 说明「太阳不升」', /极夜/.test(POLAR_NIGHT.band.summary) && /不升/.test(POLAR_NIGHT.band.summary), POLAR_NIGHT.band.summary)
check('极昼晨昏表八格全是「—」',
  POLAR_DAY.twilight.dawnRows.concat(POLAR_DAY.twilight.duskRows).every(r => r.v === '—'))
check('极昼晨昏 note 明说「不是缺测」', /不是缺测/.test(POLAR_DAY.twilight.note), POLAR_DAY.twilight.note)
check('夏季无天文暗夜：图上没有 night 段',
  SUMMER_NO_ASTRO.band.phases.every(p => p.key !== 'night'))
check('夏季无天文暗夜：note 指向「该纬度当日不出现」',
  /该纬度当日不出现/.test(SUMMER_NO_ASTRO.twilight.note), SUMMER_NO_ASTRO.twilight.note)
check('夏季无天文暗夜：天文/航海暮光都是「—」而日出日落有值',
  SUMMER_NO_ASTRO.twilight.dawnRows[0].v === '—' && SUMMER_NO_ASTRO.twilight.dawnRows[1].v === '—' &&
  hm2min(SUMMER_NO_ASTRO.twilight.dawnRows[3].v) != null)

/* ---------- §5 海拔 ---------- */

section('§5 海拔：不填 ≠ 填 0 ≠ 填 3077')
const sea = E.build({ date: EMEI.date, lat: EMEI.lat, lng: EMEI.lng, elevation: 0 })
const none = E.build({ date: EMEI.date, lat: EMEI.lat, lng: EMEI.lng, elevation: null })
const strZero = E.build({ date: EMEI.date, lat: EMEI.lat, lng: EMEI.lng, elevation: '0' })
const strElev = E.build({ date: EMEI.date, lat: EMEI.lat, lng: EMEI.lng, elevation: '3077' })
const undef = E.build({ date: EMEI.date, lat: EMEI.lat, lng: EMEI.lng })
const dayOf = r => r.band.phases.find(p => p.key === 'day')
check('3077 m 的白昼比海平面更早开始（俯角修正真的生效了）', dayOf(NOW).from < dayOf(sea).from,
  dayOf(NOW).from + ' vs ' + dayOf(sea).from)
check('海拔改了，日出时刻也跟着改（同一处修正，不是只动图）',
  NOW.twilight.dawnRows[3].v !== sea.twilight.dawnRows[3].v,
  NOW.twilight.dawnRows[3].v + ' vs ' + sea.twilight.dawnRows[3].v)
check('note 只在真的有海拔时说「与海拔」',
  NOW.band.note.indexOf('与海拔') !== -1 && sea.band.note.indexOf('与海拔') === -1)
/* 没有可信海拔时按海平面算俯角（0），不替它编一个 ±600m 的模型值；
   这句话的判据是「三种缺省形态给出同一张图」，而不是「它们互不相同」。 */
check('elevation 缺失（null / undefined）与 0 给出同一张带（都按俯角 0）',
  JSON.stringify(none.band.phases) === JSON.stringify(sea.band.phases) &&
  JSON.stringify(undef.band.phases) === JSON.stringify(sea.band.phases))
check('字符串海拔不被静默当数字："3077" 与不填等价，不会悄悄给俯角修正',
  JSON.stringify(strElev.band.phases) === JSON.stringify(none.band.phases) &&
  strElev.band.note.indexOf('与海拔') === -1 &&
  strZero.band.svg.indexOf('NaN') === -1 && undef.band.svg.indexOf('NaN') === -1)
check('缺省海拔下晨昏表也不带俯角修正', none.twilight.dawnRows[3].v !== NOW.twilight.dawnRows[3].v)

/* ---------- §6 选中时刻 ---------- */

section('§6 选中时刻：白点按分钟线性换算，非法时刻不画')
const X = m => E.BAND.X0 + (m / 1440) * (E.BAND.X1 - E.BAND.X0)
const sel = E.build(Object.assign({}, EMEI, { selected: '14:00' }))
const dot = /<circle class="sel-dot" data-sel="14:00" cx="([\d.]+)" cy="([\d.]+)" r="4"/.exec(sel.band.svg)
check('14:00 的白点存在且 x 落在 840 分钟处', !!dot && Math.abs(Number(dot[1]) - X(840)) < 0.6,
  dot ? dot[1] + ' vs ' + X(840) : 'no dot')
check('白点在带子中线（y = 8 + 34/2）', !!dot && Number(dot[2]) === E.BAND.Y + E.BAND.BAR / 2)
check('非整点选中也画（06:48）', /data-sel="06:48"/.test(E.build(Object.assign({}, EMEI, { selected: '06:48' })).band.svg))
check('非法时刻不画点', !/sel-dot/.test(E.build(Object.assign({}, EMEI, { selected: '25:00' })).band.svg) && !/sel-dot/.test(E.build(Object.assign({}, EMEI, { selected: '6:48' })).band.svg))
check('不传选中时不画点', !/sel-dot/.test(NOW.band.svg))

/* ---------- §7 图元卫生 ---------- */

section('§7 图元卫生')
check('天穹带与月盘都没有 NaN / undefined',
  allSvg.indexOf('NaN') === -1 && allSvg.indexOf('undefined') === -1)
check('clipPath 先定义后引用（引用不存在的 clip-path = 整组不渲染）',
  NOW.band.svg.indexOf('<clipPath id="skyBandClip"') !== -1 &&
  NOW.band.svg.indexOf('<clipPath id="skyBandClip"') < NOW.band.svg.indexOf('clip-path="url(#skyBandClip)"'))
const ticks = Array.from(NOW.band.svg.matchAll(/<text class="tick-label" x="([\d.]+)" y="[\d.]+" text-anchor="(\w+)" font-size="9" fill="#[0-9A-F]{6}">([\d:]+)<\/text>/g))
check('五条刻度 00/06/12/18/24', ticks.length === 5 && ticks.map(t => t[3]).join(',') === '00:00,06:00,12:00,18:00,24:00',
  JSON.stringify(ticks.map(t => t[3])))
check('首尾刻度贴边不越界（start / end 锚点）',
  ticks[0][2] === 'start' && ticks[4][2] === 'end' &&
  Math.abs(Number(ticks[0][1]) - E.BAND.X0) < 0.01 && Math.abs(Number(ticks[4][1]) - E.BAND.X1) < 0.01)
check('整天最大片段的宽度等于时间比例（不是把色块拉满整图）', (() => {
  const segs = NOW.band.phases
  const rendered = parsePhases(NOW.band.svg)
  return rendered.length === segs.length && rendered.every((r, i) =>
    Math.abs(r.x - X(segs[i].from)) < 0.2 && Math.abs(r.w - (X(segs[i].to) - X(segs[i].from))) < 0.2)
})())
check('SVG 头声明 width/height/viewBox',
  NOW.band.svg.indexOf('<svg xmlns="http://www.w3.org/2000/svg" width="' + E.BAND.W + '" height="' + E.BAND.H +
    '" viewBox="0 0 ' + E.BAND.W + ' ' + E.BAND.H + '">') === 0)
check('日出日落各一条虚线', (NOW.band.svg.match(/class="sun-mark"/g) || []).length === 2)
/* 升落点必然落在「民用晨昏↔白昼」界上，两侧都是浅色；白线在浅底上对比≈1.1:1，
   真机截图上等于没画（与月盘暗面同一类「数据对、画出来读不出」）。 */
check('日出日落虚线用夜色而不是白色（白底上读不出）', (() => {
  const marks = NOW.band.svg.match(/<line class="sun-mark"[^>]*>/g) || []
  return marks.length === 2 && marks.every(m =>
    m.indexOf('stroke="' + E.PALETTE.night + '"') > -1 && m.indexOf('stroke="' + E.PALETTE.white + '"') === -1)
})())
check('极区不画日出日落虚线（没有升落就不许画一条假的）',
  (POLAR_DAY.band.svg.match(/class="sun-mark"/g) || []).length === 0)

/* ---------- §8 晨昏表 = astro 逐字 ---------- */

section('§8 晨昏表与 astro.sunTimes 逐字一致')
const twE = E.build(EMEI).twilight
check('晨间四行：天文/航海/民用/日出',
  twE.dawnRows.map(r => r.k).join('|') === '天文晨光始|航海晨光始|民用晨光始|日出')
check('暮间四行：日落/民用/航海/天文（读下来是天黑）',
  twE.duskRows.map(r => r.k).join('|') === '日落|民用暮光终|航海暮光终|天文暗夜始')
check('八格数值 = sunTimes 原值',
  twE.dawnRows[0].v === sunEmei.astroDawn && twE.dawnRows[1].v === sunEmei.nauticalDawn &&
  twE.dawnRows[2].v === sunEmei.civilDawn && twE.dawnRows[3].v === sunEmei.sunrise &&
  twE.duskRows[0].v === sunEmei.sunset && twE.duskRows[1].v === sunEmei.civilDusk &&
  twE.duskRows[2].v === sunEmei.nauticalDusk && twE.duskRows[3].v === sunEmei.astroDusk)
check('正常日 note 交代俯角口径', /海拔俯角/.test(twE.note), twE.note)
check('晨间时刻单调递增（早 → 晚）', (() => {
  const v = twE.dawnRows.map(r => hm2min(r.v))
  return v.every((x, i) => i === 0 || x > v[i - 1])
})())
check('暮间四行也是单调递增（同一天里越往下越黑）', (() => {
  const v = twE.duskRows.map(r => hm2min(r.v))
  return v.every((x, i) => i === 0 || x > v[i - 1])
})())

/* ---------- §9 月相 ---------- */

section('§9 月相：几何与月出月落')
const mi = A.moonInfo(EMEI.date)
check('相位名/照亮比例/月龄与 astro.moonInfo 同源',
  NOW.moon.name === mi.name && NOW.moon.illumination === mi.illumination && NOW.moon.age === mi.age)
const FULL = E.build({ date: '2026-11-24', lat: 30, lng: 105 })
const NEW = E.build({ date: '2026-11-09', lat: 30, lng: 105 })
check('满月画整圆，不画明暗界线', /<circle class="moon-lit"/.test(FULL.moon.svg) && !/class="moon-lit" d=/.test(FULL.moon.svg))
check('新月不画亮面（不是把暗面画成亮面）', !/moon-lit/.test(NEW.moon.svg))
const WAX = E.build({ date: '2026-11-16', lat: 30, lng: 105 })   // 盈，北半球
const WANE = E.build({ date: '2026-11-01', lat: 30, lng: 105 })  // 亏凸月，北半球（照亮 61%）
const WAX_S = E.build({ date: '2026-11-16', lat: -30, lng: 105 })
const WANE_S = E.build({ date: '2026-11-01', lat: -30, lng: 105 })
check('盈月（北半球）不镜像：亮面在右', WAX.moon.age < A.SYNODIC / 2 && !/scale\(-1,1\)/.test(WAX.moon.svg))
check('亏月（北半球）镜像：亮面在左', WANE.moon.age >= A.SYNODIC / 2 && /scale\(-1,1\)/.test(WANE.moon.svg))
check('同一相位在南半球整体镜像（盈→镜像 / 亏→不镜像）',
  /scale\(-1,1\)/.test(WAX_S.moon.svg) && !/scale\(-1,1\)/.test(WANE_S.moon.svg))
// 明暗界线：照亮 <50% 是月牙（界线向亮侧鼓，sweep 0），>50% 是凸月（向暗侧鼓，sweep 1）
check('月牙的界线 sweep=0（细月牙，不是把凸月画成月牙）',
  WAX.moon.illumination < 50 && /A [\d.]+ 22 0 0 0 /.test(WAX.moon.svg), WAX.moon.illumination + '%')
check('凸月的界线 sweep=1（亮面大于半圆）',
  WANE.moon.illumination > 50 && /A [\d.]+ 22 0 0 1 /.test(WANE.moon.svg), WANE.moon.illumination + '%')
check('两半月相（照亮≈50%）界线退化成半径 r 的半圆（a≈r）', (() => {
  const half = E.build({ date: '2026-11-02', lat: 30, lng: 105 })
  const m = /A ([\d.]+) 22 0 0 \d /.exec(half.moon.svg)
  return half.moon.illumination <= 1 || Math.abs(Number(m[1]) - 22) < 1.5
})())
check('月盘有暗面底与描边', /class="moon-shadow"/.test(NOW.moon.svg) && /class="moon-rim"/.test(NOW.moon.svg))
check('暗面用夜色（--forest）：亮面白、暗面深，白卡上不会糊成一个浅环',
  NOW.moon.svg.indexOf('class="moon-shadow"') !== -1 &&
  new RegExp('class="moon-shadow"[^>]*fill="' + E.PALETTE.night + '"').test(NOW.moon.svg) &&
  E.PALETTE.moonDark === E.PALETTE.night)
check('月盘 SVG 宽度=画布宽（页面按 64px 排版）', NOW.moon.width === E.MOON.W && NOW.moon.height === E.MOON.W &&
  NOW.moon.svg.indexOf('width="' + E.MOON.W + '" height="' + E.MOON.W + '"') !== -1)

const mtE = A.moonTimes(EMEI.date, EMEI.lat, EMEI.lng, EMEI.elevation)
check('月出月落 = astro.moonTimes 原值', NOW.moon.rise === mtE.rise && NOW.moon.set === mtE.set)
check('riseCell/setCell 与 riseText 说的是同一件事',
  NOW.moon.riseText.indexOf(NOW.moon.riseCell.v) !== -1 && NOW.moon.riseText.indexOf(NOW.moon.setCell.v) !== -1)
check('月落早于月出时标注「（次日）」且两处一致',
  (hm2min(NOW.moon.set) < hm2min(NOW.moon.rise)) === (NOW.moon.setCell.hint === '（次日）') &&
  ((NOW.moon.riseText.indexOf('（次日）') !== -1) === (NOW.moon.setCell.hint === '（次日）')))
const UP = E.build({ date: '2026-11-24', lat: 88, lng: 15 })
const DOWN = E.build({ date: '2026-11-08', lat: 88, lng: 15 })
check('极区月不落：两格都写「不落」且 riseText 同义',
  UP.moon.riseCell.v === '不落' && UP.moon.setCell.v === '不落' && /不落/.test(UP.moon.riseText))
check('极区月不升：两格都写「不升」且 riseText 同义',
  DOWN.moon.riseCell.v === '不升' && DOWN.moon.setCell.v === '不升' && /不升/.test(DOWN.moon.riseText))
check('月相 note 说明照亮比例只描述照明条件（不冒充可见性判断）',
  /只描述夜空照明条件/.test(NOW.moon.note) && /云量/.test(NOW.moon.note))

/* ---------- §10 页面接线 ---------- */

section('§10 页面接线：真页面 buildSkyEphemeris / selectHour / 首屏默认标签')
async function pageSection () {
  const storage = new Map()
  global.wx = {
    showToast () {}, navigateTo () {}, setNavigationBarTitle () {},
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    enableAlertBeforeUnload () {}, disableAlertBeforeUnload () {},
    getFileSystemManager: () => ({ copyFile () {} }),
  }
  let config = null
  global.Page = value => { config = value }
  const pagePath = require.resolve('../miniprogram/pages/weather/weather')
  delete require.cache[pagePath]
  require(pagePath)
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) })
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(key => {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) target = target[parts.shift()]
      target[parts[0]] = patch[key]
    })
    if (callback) callback()
  }

  check('首屏默认「逐时预报」（负责人 2026-10-30 裁定）', page.data.weatherTab === 'hourly', page.data.weatherTab)
  check('首屏没有天穹带空壳', page.data.skyEphemeris === null)
  check('没有 _solarInput 时返回 null（不猜坐标）', page.buildSkyEphemeris('2026-10-30', '14:00') === null)

  page._solarInput = { date: EMEI.date, lat: EMEI.lat, lng: EMEI.lng, elevation: EMEI.elevation }
  const built = page.buildSkyEphemeris(EMEI.date, '14:00')
  const direct = E.build(Object.assign({}, EMEI, { selected: '14:00' }))
  check('页面装配 = 模块输出（同一份输入，同一句话）',
    built && built.band.summary === direct.band.summary && built.band.note === direct.band.note)
  check('图以 data-uri 交给 <image>，不是裸 SVG 字符串',
    built.band.src === 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(direct.band.svg))
  check('晨昏表与月盘一起装配', built.twilight.dawnRows.length === 4 && !!built.moon.src &&
    built.moon.riseCell.k === '月出' && built.moon.setCell.k === '月落')

  // selectHour：两块卡必须同一次 setData 落地，且说同一时刻
  page.data.chartView = [{
    d: EMEI.date, t: '14:00', temp: 8, feels: 6, precip: 0, pop: 10, wind: 12, gust: 20,
    cloud: 40, low: 20, mid: 30, high: 60, code: 3, dir: 225, rh: 55, uv: 4,
  }]
  page.data.chartMarks = {}
  page.data.unified = null
  page.data.oiCard = null
  page.selectHour(EMEI.date, '14:00')
  check('selectHour 后两个卡都有选中时刻的版本',
    !!page.data.solarArc && !!page.data.skyEphemeris && !!page.data.skyEphemeris.band)
  check('天穹带的白点跟着选中的小时走',
    page.data.skyEphemeris.band.src.indexOf(encodeURIComponent('data-sel="14:00"')) !== -1)
  check('日照轨迹与天穹带同一个日期（不是一张今天的、一张明天的）',
    page.data.solarArc.dateLabel === EMEI.date.slice(5))

  page._solarInput = { date: EMEI.date, lat: NaN, lng: EMEI.lng, elevation: null }
  check('坐标坏了只降级这两块卡，不抛错', page.buildSkyEphemeris(EMEI.date, '') === null)

  check('WXML 绑定了三块卡（天穹带 / 晨昏表 / 月相）',
    WXML.indexOf('skyEphemeris.band.src') !== -1 &&
    WXML.indexOf('skyEphemeris.twilight.dawnRows') !== -1 &&
    WXML.indexOf('skyEphemeris.twilight.duskRows') !== -1 &&
    WXML.indexOf('skyEphemeris.moon.src') !== -1)
  check('「（次日）」由模块判一次，模板不做大小比较', /setCell\.hint}}/.test(WXML) && !/setCell\.v *[<>] *riseCell/.test(WXML))
  check('模板不比较相位枚举（只插值）', !/phase *===|=== *'day'|=== *'night'/.test(WXML))
  check('页面三处 setData 都带 skyEphemeris（首屏/重新装配/选时）',
    (PAGE_SRC.match(/skyEphemeris:/g) || []).length >= 4)
}

/* ---------- §11 文案卫生 ---------- */

section('§11 文案卫生')
const texts = [
  NOW.band.summary, NOW.band.note, NOW.twilight.note, NOW.moon.note, NOW.moon.riseText,
  POLAR_DAY.band.summary, POLAR_NIGHT.band.summary, SUMMER_NO_ASTRO.twilight.note,
]
check('没有绝对断言（不会 / 一定 / 必然 / 保证 / 肯定）',
  texts.every(t => !/不会|一定|必然|保证|肯定/.test(t)), texts.join(' | '))
check('天穹带 note 交代 5 分钟采样口径', /每 5 分钟采样/.test(NOW.band.note), NOW.band.note)
check('月出月落 note 交代 10 分钟采样与误差量级', /每 10 分钟采样/.test(NOW.moon.note) && /误差约几分钟/.test(NOW.moon.note))
check('天穹带 note 承认不含山体与云层遮挡', /不含山体与云层遮挡/.test(NOW.band.note))
check('模块是 wx-free 的（只 require astro）',
  (MODULE_SRC.match(/require\(/g) || []).length === 1 && MODULE_SRC.indexOf("require('./astro')") !== -1)

pageSection().then(() => {
  console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
  if (failed) console.log('失败项见上方 ✗。')
  process.exit(failed ? 1 : 0)
}).catch(err => {
  console.error(err)
  console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
  process.exit(1)
})
