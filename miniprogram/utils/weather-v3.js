// 天气页 V3 详情状态机（wx-free）。
//
// 为什么单独一层：同一套四视图要出现在两个宿主（tab 页 weather-hub / 深链页），
// 页面里各写一份状态迁移就会分叉。这里只放**纯函数**：状态迁移、窗口切片、读数挑选、
// 天相三卡合并、日照弧几何。页面与组件只做「插值 + 事件转发」。
//
// 约定（与实施文档 §16.5 冻结契约一一致）：
//   state = { date, cursor, period, tab, nodeIndex }
//   date   —— 当前时间窗**起点**（'YYYY-MM-DD'）
//   cursor —— 时间窗内绝对小时（0..period-1；跨天时 cursor >= 24 表示次日）
//   period —— 24 / 48 / 72
//   tab    —— hourly / cloud / route / sky
//   选中的时刻 = date + floor(cursor/24) 天，hour = cursor % 24
//
// 铁律：缺值不补 0（null/undefined 一律 '—'）；不在这里读 wx、不碰 storage。
'use strict'

const F = require('./format')

const TABS = ['hourly', 'cloud', 'route', 'sky']
const PERIODS = [24, 48, 72]
const TAB_LABELS = {
  hourly: '逐时预报',
  cloud: '云层剖面',
  route: '沿途天气',
  sky: '日月天相',
}
const PERIOD_LABELS = { 24: '24 小时', 48: '48 小时', 72: '72 小时' }
const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_PLAN_DAYS = 7

function pad(n) { return (n < 10 ? '0' : '') + n }

/* ---------- 日期 ---------- */

function isDate(s) { return typeof s === 'string' && ISO_DATE.test(s) }

function addDays(date, n) {
  if (!isDate(date) || !Number.isFinite(n)) return date
  const ms = Date.parse(date + 'T00:00:00+08:00') + Math.round(n) * 86400000
  const d = new Date(ms + 8 * 3600000)
  return d.toISOString().slice(0, 10)
}

function dayOffset(from, to) {
  if (!isDate(from) || !isDate(to)) return 0
  return Math.round((Date.parse(to + 'T00:00:00+08:00') - Date.parse(from + 'T00:00:00+08:00')) / 86400000)
}

function shortDate(date) {
  if (!isDate(date)) return '—'
  return Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10))
}

function weekdayOf(date) {
  if (!isDate(date)) return ''
  const d = new Date(date + 'T00:00:00+08:00')
  return WEEK_LABELS[d.getUTCDay()] || ''
}

/* ---------- 状态迁移 ---------- */

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)) }

function initialState(seed) {
  const s = seed || {}
  return {
    date: isDate(s.date) ? s.date : F.cnToday(),
    cursor: Number.isFinite(s.cursor) ? Math.max(0, Math.round(s.cursor)) : 13,
    period: PERIODS.indexOf(s.period) !== -1 ? s.period : 24,
    tab: TABS.indexOf(s.tab) !== -1 ? s.tab : 'hourly',
    nodeIndex: Number.isFinite(s.nodeIndex) ? Math.max(0, Math.round(s.nodeIndex)) : 0,
  }
}

/** 选中的绝对小时（窗口内下标） */
function cursorOf(state) {
  const p = state && state.period ? state.period : 24
  return clamp(state && Number.isFinite(state.cursor) ? state.cursor : 0, 0, p - 1)
}

/** 选中时刻的日期（窗口起点 + 跨天数） */
function selectedDate(state) {
  return addDays(state.date, Math.floor(cursorOf(state) / 24))
}

/** 选中时刻的一天中的小时（0..23） */
function selectedHour(state) {
  return cursorOf(state) % 24
}

function selectedTime(state) {
  return pad(selectedHour(state)) + ':00'
}

function setTab(state, tab) {
  if (TABS.indexOf(tab) === -1) return state
  return Object.assign({}, state, { tab })
}

function selectHour(state, cursor) {
  const p = state.period || 24
  const next = Number(cursor)
  if (!Number.isFinite(next)) return state
  return Object.assign({}, state, { cursor: clamp(Math.round(next), 0, p - 1) })
}

/**
 * 时长切换：**保留当前选中时刻**，以该时刻所在日期重设窗口起点。
 * （原型 `changePeriod` 的行为；仅把游标收到窗口内。）
 */
function changePeriod(state, period) {
  if (PERIODS.indexOf(period) === -1) return state
  const day = selectedDate(state)
  const hour = selectedHour(state)
  return Object.assign({}, state, {
    period: period,
    date: day,
    cursor: clamp(hour, 0, period - 1),
  })
}

/** 换日期：**保留一天中的小时**（原型 `data-day` 行为）。 */
function setDate(state, date) {
  if (!isDate(date)) return state
  const hour = selectedHour(state)
  return Object.assign({}, state, { date, cursor: clamp(hour, 0, (state.period || 24) - 1) })
}

/** 换节点：窗口与游标都不动（共享上下文）。 */
function setNode(state, index) {
  const n = Number(index)
  if (!Number.isFinite(n) || n < 0) return state
  return Object.assign({}, state, { nodeIndex: Math.round(n) })
}

/** 切到某个「绝对小时」并让它落在窗口里：用于点列 / 前后步进 / 云图点选 / 证据跳转。 */
function jumpToAbsolute(state, date, hour) {
  const off = dayOffset(state.date, date)
  const p = state.period || 24
  if (!isDate(date) || off < 0 || off * 24 >= p || !Number.isFinite(hour)) return state
  return Object.assign({}, state, { cursor: clamp(off * 24 + Math.round(hour), 0, p - 1) })
}

/* ---------- 时间窗切片 ---------- */

/** 从 series（可能 7 天）里取窗口：起点 = state.date，长度 = min(period, 可用小时)。 */
function windowSeries(series, state) {
  const list = Array.isArray(series) ? series : []
  const p = state && state.period ? state.period : 24
  const start = list.findIndex(h => h && h.d === state.date && h.t === '00:00')
  const from = start >= 0 ? start : list.findIndex(h => h && h.d === state.date)
  if (from < 0) return list.slice(0, p)
  return list.slice(from, from + p)
}

/** 窗口内的小时读数；越界返回 null（页面据此显示空态，不虚构一小时）。 */
function hourAt(window, cursor) {
  const list = Array.isArray(window) ? window : []
  const i = Number(cursor)
  if (!Number.isFinite(i) || i < 0 || i >= list.length) return null
  return list[Math.round(i)]
}

/** 图表列上「第 i 列」的日期与时刻（跨天列显示日期而不是 00）。 */
function columnLabel(window, i) {
  const h = hourAt(window, i)
  if (!h) return { label: '—', isDayStart: false, time: '' }
  return {
    label: h.hour === 0 || h.t === '00:00' ? shortDate(h.d) : h.t.slice(0, 2),
    isDayStart: h.t === '00:00',
    time: h.t,
    date: h.d,
  }
}

/**
 * 图表下方的小时列（DOM 层）。节奏由图表模块给（列宽约 12.5px，逐时文字会互相压叠），
 * 这里只做投影：**有刻度的列**出标签（跨天列显示日期），其余留空但仍占一格（点按照旧命中）。
 * 左对齐的列 = 第 0 列与每个 00:00 —— 日期标签比一列宽，居中会被滚动视口左沿裁掉一半。
 */
function hourColsOf(window, cursor, every) {
  const list = Array.isArray(window) ? window : []
  const step = Number.isFinite(every) && every > 0 ? Math.round(every) : 1
  const cur = Number.isFinite(Number(cursor)) ? Math.round(Number(cursor)) : 0
  return list.map((h, i) => {
    const c = columnLabel(list, i)
    const marked = i % step === 0
    return {
      i,
      key: h ? h.d + h.t : 'c' + i,
      label: marked ? c.label : '',
      marked,
      leftAlign: marked && (i === 0 || c.isDayStart),
      selected: i === cur,
    }
  })
}

/* ---------- 日期条 ---------- */

/**
 * 单点：5 日卡（含当日图标与 min/max）。
 * days 来自云端 `days[]`（{date,label,code,min,max} 形状由 selectors/weather 提供），
 * series 用于兜底算 min/max —— 缺值时给 null，页面印 '—'。
 */
function pointDayStrip(days, series, activeDate) {
  const list = Array.isArray(days) ? days : []
  const active = isDate(activeDate) ? activeDate : (list[0] && list[0].date)
  const idx = Math.max(0, list.findIndex(d => d && d.date === active))
  const start = clamp(idx - 2, 0, Math.max(0, list.length - 5))
  const rows = list.slice(start, start + 5).map(d => {
    const same = (Array.isArray(series) ? series : []).filter(h => h && h.d === d.date)
    const temps = same.map(h => h.temp).filter(v => Number.isFinite(v))
    const code = F.dayCodeOf(d)
    return {
      date: d.date,
      weekday: weekdayOf(d.date),
      short: shortDate(d.date),
      // 日条与日徽标同源：白昼代表性码（逐时行仍用 hourly code）
      code,
      icon: F.weatherIcon(code),
      min: Number.isFinite(d.min) ? d.min : (temps.length ? Math.min.apply(null, temps) : null),
      max: Number.isFinite(d.max) ? d.max : (temps.length ? Math.max.apply(null, temps) : null),
      selected: d.date === active,
    }
  })
  return rows
}

/**
 * 路线：D1/D2…，起点 = 计划出发日；`活动日` 标记由调用方给（活动日期）。
 * 超范围（该日不在预报窗口）→ enabled=false，页面禁用并说明「临近出发再查」。
 */
function planDayStrip(plan, forecastDates, activeDate, activityDate) {
  const p = plan || {}
  const starts = isDate(p.startDate) ? p.startDate : (forecastDates && forecastDates[0])
  const stops = Array.isArray(p.stops) ? p.stops : []
  const maxDay = stops.length ? Math.max.apply(null, stops.map(s => (s && s.day) || 1)) : 1
  const allowed = Array.isArray(forecastDates) ? forecastDates : []
  const rows = []
  for (let i = 1; i <= Math.min(maxDay, MAX_PLAN_DAYS); i++) {
    const date = addDays(starts, i - 1)
    rows.push({
      key: 'D' + i,
      label: 'D' + i,
      date,
      short: shortDate(date),
      weekday: weekdayOf(date),
      enabled: allowed.indexOf(date) !== -1,
      selected: date === activeDate,
      isActivityDay: !!activityDate && date === activityDate,
    })
  }
  return rows
}

/* ---------- 读数 ---------- */

function numText(v, digits) {
  if (!Number.isFinite(v)) return '—'
  return digits ? v.toFixed(digits) : String(Math.round(v))
}

function conditionOf(code) {
  const p = F.weatherPhrase(code)
  return (p && p.label) || '—'
}

/**
 * 顶部读数 + 详细读数。缺值一律 '—'，绝不用 0 冒充实测。
 * `node` 为当前节点（{name, altitude|null}），海拔缺失时显式说明而不是印 0。
 */
function readoutOf(row, node, opts) {
  const h = row || {}
  const n = node || {}
  const cloud = h.cloud || {}
  const altitude = Number.isFinite(n.altitude) ? Math.round(n.altitude) : null
  // 逐时图里的云量格没有数字（列宽放不下），三层读数印在图表上方的读数区。
  // 三层全缺时说"无读数"，不印「— %」那种像是 0 的形状（缺值 ≠ 0%）。
  const cloudAllMissing = ![cloud.high, cloud.mid, cloud.low].some(v => Number.isFinite(v))
  return {
    time: isDate(h.d) && h.t ? h.t : '—',
    date: isDate(h.d) ? h.d : '',
    condition: conditionOf(h.code),
    icon: F.weatherIcon(h.code),
    temp: numText(h.temp),
    feels: numText(h.feels),
    precip: numText(h.precip, 1),
    pop: numText(h.pop),
    wind: numText(h.wind),
    gust: numText(h.gust),
    windDir: Number.isFinite(h.windDir) ? F.windDirText(h.windDir) : '—',
    rh: numText(h.rh),
    visibility: numText(h.visibility, 1),
    pressure: numText(h.pressure),
    dewPoint: numText(h.dewPoint),
    uv: numText(h.uv, 1),
    cloudLow: numText(cloud.low),
    cloudMid: numText(cloud.mid),
    cloudHigh: numText(cloud.high),
    cloudLine: cloudAllMissing
      ? '三层云量无读数'
      : '高云 ' + numText(cloud.high) + ' · 中云 ' + numText(cloud.mid) + ' · 低云 ' + numText(cloud.low) + '%',
    altitude: altitude === null ? null : altitude,
    altitudeText: altitude === null ? '海拔待确认' : String(altitude),
    nodeName: n.name || '',
    // 详细读数六项（原型 §5.3）：顺序固定，缺值仍是 '—'
    detailRows: [
      { key: 'pop', label: '降水概率', value: numText(h.pop), unit: '%' },
      { key: 'wind', label: '风向 / 风速', value: Number.isFinite(h.windDir) ? F.windDirText(h.windDir) : '—', unit: numberWithUnit(h.wind, 'km/h') },
      { key: 'gust', label: '阵风', value: numText(h.gust), unit: 'km/h' },
      { key: 'rh', label: '相对湿度', value: numText(h.rh), unit: '%' },
      { key: 'vis', label: '能见度', value: numText(h.visibility, 1), unit: 'km' },
      { key: 'alt', label: '节点海拔', value: altitude === null ? '—' : String(altitude), unit: altitude === null ? '待确认' : 'm' },
    ],
    hasAnyReading: Number.isFinite(h.temp) || Number.isFinite(h.precip) || Number.isFinite(h.wind),
    _opts: opts || null,
  }
}

function numberWithUnit(v, unit) {
  return Number.isFinite(v) ? Math.round(v) + ' ' + unit : '—'
}

/* ---------- 天相三卡 ---------- */

/**
 * 三个展示卡把生产六项结论（light/alpenglow/cloudSea/star/galaxy/rainbow）收成 3 张：
 *   云海 ← cloudSea
 *   星空 / 银河 ← star + galaxy
 *   彩虹 / 晨昏光染 ← rainbow + alpenglow
 * 合并规则（写死并可测）：
 *   任一 possible → possible（有戏就说有戏）
 *   否则任一 unknown → unknown（判不出就说明缺什么，不冒充"不成立"，铁律 33②）
 *   否则 excluded
 * 分数取**可见项**的最大值：被排除项不得替看得见的结论投票（铁律 33⑤）。
 */
const VERDICTS = ['possible', 'unknown', 'excluded']
const SKY_GROUPS = [
  { key: 'cloudSea', title: '云海', members: ['cloudSea'] },
  { key: 'night', title: '星空 / 银河', members: ['star', 'galaxy'] },
  { key: 'color', title: '彩虹 / 晨昏光染', members: ['rainbow', 'alpenglow'] },
]
const VERDICT_LABELS = { possible: '有条件', unknown: '资料不足', excluded: '今天不成立' }

function verdictOf(item) {
  if (!item) return 'unknown'
  if (VERDICTS.indexOf(item.verdict) !== -1) return item.verdict
  // 旧返回体没有 verdict：按分数判"有没有戏"，但**不**据此冒充排除。
  return Number.isFinite(item.score) && item.score >= 45 ? 'possible' : 'unknown'
}

function mergeGroup(items, group) {
  const list = (items || []).filter(it => it && group.members.indexOf(it.key) !== -1)
  if (!list.length) return null
  let verdict = 'excluded'
  if (list.some(it => verdictOf(it) === 'possible')) verdict = 'possible'
  else if (list.some(it => verdictOf(it) === 'unknown')) verdict = 'unknown'
  const visible = list.filter(it => verdictOf(it) !== 'excluded')
  const pool = visible.length ? visible : list
  const best = pool.reduce((a, b) => (Number(b.score) || 0) > (Number(a.score) || 0) ? b : a)
  const reasons = list.filter(it => verdictOf(it) !== verdict).map(it => it.text).filter(Boolean)
  const texts = list.map(it => it.text).filter(Boolean)
  const looks = list.filter(it => verdictOf(it) === 'possible').map(it => it.look).filter(Boolean)
  const windows = list.filter(it => verdictOf(it) === 'possible').map(it => it.window).filter(Boolean)
  return {
    key: group.key,
    title: group.title,
    verdict,
    verdictLabel: VERDICT_LABELS[verdict],
    score: Number(best.score) || 0,
    stars: starText(Number(best.score) || 0),
    tone: best.tone || 'neutral',
    text: verdict === 'excluded' ? (texts[0] || '今天条件不成立。') : (texts.join(' ')),
    // excluded 要说明「为什么没有」；unknown 要说明「缺什么」——两者都不许统一写"资料不足"。
    reason: verdict === 'excluded' ? (texts[0] || '') : '',
    missing: verdict === 'unknown' ? reasons.join(' ') || texts.join(' ') : '',
    look: verdict === 'possible' ? (looks[0] || '') : '',
    window: verdict === 'possible' ? (windows[0] || '') : '',
  }
}

function starText(score) {
  const filled = score >= 70 ? 4 : score >= 45 ? 3 : 2
  return '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled)
}

/** 天相三卡（顺序固定；没有对应结论的组不出卡） */
function skyCards(skyOut) {
  if (!skyOut || !Array.isArray(skyOut.items)) return []
  return SKY_GROUPS.map(g => mergeGroup(skyOut.items, g)).filter(Boolean)
}

/* ---------- 日照弧 ---------- */

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s || ''))
  return m ? (+m[1]) * 60 + (+m[2]) : null
}

function hhmm(min) {
  if (!Number.isFinite(min)) return '—'
  const v = ((Math.round(min) % 1440) + 1440) % 1440
  return pad(Math.floor(v / 60)) + ':' + pad(v % 60)
}

/**
 * 原型日照弧（§0/§5.6）：纯几何，不参与任何天气判定。
 * 日出日落是客观时刻：调用方**不得**因为天气把它们裁掉。
 */
function buildSunArcSvg(opts) {
  const o = opts || {}
  const rise = parseHM(o.rise)
  const set = parseHM(o.set)
  const daylight = (rise != null && set != null && set > rise) ? (set - rise) : null
  const label = daylight == null ? '日照时段缺资料' : '白昼约 ' + Math.floor(daylight / 60) + ' 小时 ' + pad(daylight % 60) + ' 分'
  return {
    daylight,
    label,
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 135" width="330" height="135" ' +
      'preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="wsun" x2="0" y2="1">' +
      '<stop stop-color="#f3e7b7" stop-opacity=".6"/><stop offset="1" stop-color="#fff8e0" stop-opacity=".2"/>' +
      '</linearGradient></defs>' +
      '<path d="M25 105C68-15 262-15 305 105Z" fill="url(#wsun)"/>' +
      '<path d="M25 105C68-15 262-15 305 105" fill="none" stroke="#c6a85c" stroke-width="1.5" stroke-dasharray="3 4"/>' +
      '<path d="M12 105H318" fill="none" stroke="#dfe6da" stroke-width="1"/>' +
      '<circle cx="165" cy="15" r="10" fill="#ddbf6d"/>' +
      '<circle cx="25" cy="105" r="4" fill="#a9904c"/>' +
      '<circle cx="305" cy="105" r="4" fill="#a9904c"/>' +
      text(25, 127, '日出', 10, '#8a8e73', 'middle') +
      text(305, 127, '日落', 10, '#8a8e73', 'middle') +
      text(165, 86, label, 12, '#7c835f', 'middle') +
      '</svg>',
  }
}

function text(x, y, t, size, color, anchor) {
  return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color +
    '" text-anchor="' + anchor + '">' + String(t == null ? '' : t) + '</text>'
}

/* ---------- 计划（纯逻辑，云端校验同源口径） ---------- */

/**
 * 同一天内抵达时间不得沿 stops 顺序逆序（空值不参与比较）。
 * 返回第一个违规：{ day, index } 或 null。云端 plan.update 用同一判据。
 */
function planTimeViolation(stops) {
  const list = Array.isArray(stops) ? stops : []
  for (let d = 1; d <= MAX_PLAN_DAYS; d++) {
    let prev = null
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      if (!s || s.day !== d || !s.time) continue
      const m = parseHM(s.time)
      if (m == null) continue
      if (prev != null && m < prev) return { day: d, index: i }
      prev = m
    }
  }
  return null
}

/** 抵达日（相对计划出发日的第几天）→ 日期 */
function stopDate(plan, stop) {
  const start = plan && isDate(plan.startDate) ? plan.startDate : null
  if (!start || !stop || !Number.isFinite(stop.day)) return null
  return addDays(start, Math.round(stop.day) - 1)
}

/** 当前选中日对应哪个 D 按钮（计划内），没有则 null */
function planDayOf(plan, date) {
  const start = plan && isDate(plan.startDate) ? plan.startDate : null
  if (!start || !isDate(date)) return null
  const off = dayOffset(start, date)
  return off >= 0 && off < MAX_PLAN_DAYS ? off + 1 : null
}

function typedTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) }

/** 协作码缩略：前 4 + … + 后 4（与 me / route 页同口径；完整值只在输入时出现） */
function abbreviateCode(code) {
  const s = String(code || '')
  if (!s) return ''
  return s.length <= 10 ? s : s.slice(0, 4) + '…' + s.slice(-4)
}

module.exports = {
  TABS, PERIODS, TAB_LABELS, PERIOD_LABELS, WEEK_LABELS, ISO_DATE, MAX_PLAN_DAYS,
  isDate, addDays, dayOffset, shortDate, weekdayOf, pad,
  initialState, cursorOf, selectedDate, selectedHour, selectedTime,
  setTab, selectHour, changePeriod, setDate, setNode, jumpToAbsolute,
  windowSeries, hourAt, columnLabel, hourColsOf,
  pointDayStrip, planDayStrip,
  readoutOf, numText, conditionOf,
  VERDICTS, VERDICT_LABELS, SKY_GROUPS, verdictOf, mergeGroup, starText, skyCards,
  parseHM, hhmm, buildSunArcSvg,
  planTimeViolation, stopDate, planDayOf, typedTime, abbreviateCode,
}