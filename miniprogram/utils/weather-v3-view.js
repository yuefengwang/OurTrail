// 天气详情视图装配（纯函数，wx-free）。
//
// 一个入口 `buildDetailView(...)`：把云端返回体 + 地点 + 上下文状态装配成页面 data。
// 组件只负责 setData 与事件转发；`tools/*-test.js` 直接打这一层（不在测试里镜像页面逻辑）。
//
// 为什么不让页面自己装配：同一套四视图要在 tab 页与深链页出现两次，
// 两份装配代码必然分叉（本仓已有"页面逻辑镜像到测试"的事故史）。
'use strict'

const F = require('./format')
const A = require('./astro')
const sky = require('./sky')
const cond = require('./conditions')
const V3 = require('./weather-v3')
const HSV = require('./weather-v3-hourly-svg')
const CFF = require('./cloud-field-svg')
const WCFF = require('./weather-cloud-field')
const UMG = require('./meteogram-svg')

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function fmtM(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
/** SVG → data URI。encodeURIComponent 不转义 `!'()*`（RFC 3986 里它们只是 sub-delim），
 *  但 data URI 的载荷要的是严格 URI 字符集：逐字转义一次，避免解码器对裸引号/星号的处理分歧。
 *  全仓只有这一个 SVG 编码器（`weather-detail.js` 也委托过来）。 */
function toUri(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
function parseHM(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '')
  return m ? (+m[1] + +m[2] / 60) : fallback
}
function dayLabel(date) {
  return WEEK[new Date(date + 'T12:00:00').getDay()]
}

/** 渲染窗口的逐日标签（今天/明天/后天 或 周X） */
function horizonDayLabels(startDate, horizon) {
  const todayIso = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const out = []
  const n = Math.ceil(horizon / 24)
  for (let off = 0; off < n; off++) {
    const d = new Date(Date.parse(startDate + 'T12:00:00') + off * 86400000).toISOString().slice(0, 10)
    if (startDate === todayIso) out.push(off === 0 ? '今天' : off === 1 ? '明天' : off === 2 ? '后天' : dayLabel(d))
    else out.push(dayLabel(d) + (off === 0 ? '（所选日）' : ''))
  }
  return out
}

function sunTimesForWindow(startDate, horizon, lat, lng, elevation) {
  const out = []
  const n = Math.ceil(horizon / 24)
  for (let off = 0; off < n; off++) {
    try {
      const d = new Date(Date.parse(startDate + 'T12:00:00') + off * 86400000).toISOString().slice(0, 10)
      const sun = A.sunTimes(d, lat, lng, elevation)
      out.push({ rise: parseHM(sun.sunrise, 7), set: parseHM(sun.sunset, 19) })
    } catch (e) { out.push(null) }
  }
  return out
}

/** 节点海拔出处（唯一分类点在 format.resolveElev，页面不得自行分类） */
function elevationOf(node, result) {
  const EV = F.resolveElev(node && node.altitude, node && node.eleSource, result && result.pointElevation)
  return { elevation: EV.elevation, source: EV.source, basis: EV.basis, ok: EV.ok }
}

/* ---------- 天相 ---------- */

function skyContext(result, place, node, ctx, elev) {
  const series = Array.isArray(result.series) ? result.series : []
  const day = ctx.selDate || ctx.date
  const detail = series.filter(h => h && h.d === day)
  return {
    date: day,
    lat: place.lat,
    lng: place.lng,
    elevation: Number.isFinite(elev.elevation) ? elev.elevation : null,
    elevOK: !!elev.ok,
    detail,
    series,
    cloudLevels: result.cloudLevels || null,
    days: result.days || [],
    spatial: null,
    terrain: null,
    atmosphere: null,
    lightPollution: undefined,
    heading: null,
  }
}

/** 被沉默的天相项（减卡必须点名；判得出"不成立"与"没数据"是两件事） */
function buildSilent(items) {
  if (!Array.isArray(items)) return null
  const titles = items.filter(it => it.key !== 'light' && sky.isSilent(it)).map(it => it.title)
  if (!titles.length) return null
  return {
    count: titles.length,
    titles: titles.join('、'),
    text: '这些天相今天条件不成立，就不单独列出：' + titles.join('、') + '。',
  }
}

/* ---------- 云层（生产统一图，零渲染改造） ---------- */

/* 显示窗的规划视野固定为最长可看窗口。24/48/72 是同一条时间轴上的三个切片，
   窗若只按当前切片规划，锚点就是「这个切片里有哪些云段」的并集 ⇒ 同一地点会得到
   三种高度尺度（实测 24h 选 3,000–4,500 m、48h 选 0–4,000 m，同一个点分别印成
   「此点在剖面下方 3,000 m」和「此点 0 m」），切时长像换了张图。
   规划只影响窗/刻度/点在不在窗内；判读吃的是渲染字段的 covered，业务语义不变。 */
const PLAN_HORIZON = 72

function buildCloud(result, ctx, elev, width) {
  const horizon = ctx.period === 48 || ctx.period === 72 ? ctx.period : 24
  const field = WCFF.buildCloudFieldRange(result, {
    startDate: ctx.date, hours: horizon, userAltitude: elev.elevation,
  })
  if (!field) return { missing: true, card: null, geo: null }
  const planField = WCFF.buildCloudFieldRange(result, {
    startDate: ctx.date, hours: PLAN_HORIZON, userAltitude: elev.elevation,
  }) || field
  const startIdx = (result.series || []).findIndex(h => h.d === ctx.date)
  if (startIdx < 0) return { missing: true, card: null, geo: null }
  const surface = (result.series || []).slice(startIdx, startIdx + horizon)
  if (surface.length < 24) return { missing: true, card: null, geo: null }
  const eff = Math.min(horizon, surface.length)
  const geo = UMG.buildUnified({
    surface, cloudField: field, planField,
    userAltitude: elev.elevation, width,
    elevSource: elev.source || null, horizon: eff,
    dayLabels: horizonDayLabels(ctx.date, eff),
  })
  const base = UMG.renderUnifiedBase(geo, {
    sunTimes: sunTimesForWindow(ctx.date, eff, ctx.lat || 0, ctx.lng || 0, elev.elevation),
    dateLabel: dayLabel(ctx.date) + ' · ' + ctx.date.replace(/-0?/, '.').replace('-', '.'),
  })
  const gp = geo.profile, gu = geo.cloud
  const hasElev = gu.userAlt != null
  const inWindow = hasElev && gu.userAlt >= gp.lo && gu.userAlt <= gp.hi
  return {
    missing: false,
    geo,
    card: {
      src: toUri(base.svg),
      selSrc: '',
      r1: '', r2: '', r3: '', r4: '',
      stKey: '',
      hour: null,
      legendIn: F.cloudPositionLabel('in'),
      elevShown: inWindow,
      legendElev: !hasElev ? F.cloudLegendNoElev()
        : inWindow ? F.cloudLegendElev()
          : F.pointOutsideLabel(gp.pointOutside, fmtM(gp.pointOutsideDelta)),
      rangeLabel: F.profileRangeLabel(fmtM(gp.lo), fmtM(gp.hi)),
    },
  }
}

/** 云图上某小时的读数（r1..r4）。与旧天气页 applyUnifiedSelection 同口径。 */
function cloudReadout(geo, absHour, elevBasis) {
  if (!geo) return null
  const hour = Math.round(absHour)
  if (!Number.isFinite(hour) || hour < 0 || hour >= (geo.horizon || 24)) return null
  const row = (geo.surface || [])[hour] || {}
  const sel = UMG.renderUnifiedSelection(geo, { selectedAbs: hour })
  const userAlt = geo.cloud && Number.isFinite(geo.cloud.userAlt) ? geo.cloud.userAlt : undefined
  const st = CFF.inferState(geo.sample, hour, userAlt, geo.covered, { basis: elevBasis })
  const dayLabelText = (geo.days && geo.days[Math.floor(hour / 24)]) ? geo.days[Math.floor(hour / 24)].label : ''
  const prefix = hour >= 24 ? dayLabelText + ' ' : ''
  const precip = (row.precip || 0) + (row.showers || 0)
  const out = {
    selSrc: toUri(sel.svg),
    hour: hour % 24,
    absHour: hour,
    stKey: st.key || '',
    r1: prefix + V3.pad(hour % 24) + ':00 · ' + (row.temp == null ? '—' : Math.round(row.temp)) + '° ' + F.weatherPhrase(row.code).label +
      (precip >= 0.05 ? ' · 降水 ' + (Math.round(precip * 10) / 10) + ' mm' : ''),
    r2: '',
    r3: st.key ? st.word : '',
    r4: '风 ' + (row.wind == null ? '—' : Math.round(row.wind)) + ' km/h · 阵 ' + (row.gust == null ? '—' : Math.round(row.gust)) +
      (row.windDir != null ? ' · ' + F.windDirText(row.windDir) : ''),
  }
  out.r2 = st.span
    ? '云量 ' + st.span.peak + '% · 云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m'
    : '海拔 ' + (userAlt != null ? fmtM(userAlt) : '—') + ' m 云量 ' + (st.cUser != null ? st.cUser + '%' : '—')
  return out
}

/* ---------- 日月 ---------- */

function buildSkyView(skyOut, ctx, node) {
  const day = ctx.selDate || ctx.date
  const sun = (skyOut && skyOut.sun) || A.sunTimes(day, ctx.lat || 0, ctx.lng || 0, null)
  const win = A.photoWindows(day, ctx.lat || 0, ctx.lng || 0, null)
  const moon = (skyOut && skyOut.moon) || A.moonInfo(day)
  const arc = V3.buildSunArcSvg({ rise: sun.sunrise, set: sun.sunset })
  const events = []
  const push = (time, title, note) => { if (time) events.push({ time, title, note }) }
  if (win.dawnBlue) push(win.dawnBlue.from, '晨间蓝调', '太阳接近地平线；色彩表现还受低云影响。')
  push(sun.sunrise, '日出', '时刻本身不代表能直接看到太阳。')
  if (win.eveningGolden) push(win.eveningGolden.from, '傍晚黄金时刻', '暖光能否照到山体，还要看当时的低云。')
  push(sun.sunset, '日落', '地形遮挡可能影响实际可见时刻。')
  push(sun.astroDusk, '天文暗夜始', '太阳已降至地平线下 18°。')
  const cards = V3.skyCards(skyOut)
  return {
    arcSrc: toUri(arc.svg),
    daylight: arc.label,
    rise: sun.sunrise || '—',
    set: sun.sunset || '—',
    moon: Number.isFinite(moon && moon.illumination) ? moon.illumination + '%' : '—',
    moonName: (moon && moon.name) || '',
    events,
    cards,
    overall: skyOut ? cond.overallGrade(skyOut.items) : null,
    silent: buildSilent(skyOut ? skyOut.items : null),
  }
}

/* ---------- 沿途（行程流） ---------- */

/**
 * @param nodeWeather { [nodeIndex]: result|'loading'|'error' } 逐节点取数结果（§7.4）
 * 没有任何一个节点的数据时整段说「天气未取到」，绝不拿别的节点数据冒充。
 */
function buildRouteFlow(plan, place, ctx, nodeWeather, days) {
  // 选中的「日」是 cursor 落到的日期，不是窗口起点：48h 窗口里点第二天，
  // 行程流必须换到第二天的节点，否则用户看到的时刻与日期对不上。
  const day = ctx.selDate || ctx.date
  if (!plan) {
    return { hasPlan: false, stops: [], dayButtons: [], notice: null, planName: '', planMeta: '' }
  }
  const nodes = Array.isArray(place.nodes) ? place.nodes : []
  const forecastDates = (Array.isArray(days) ? days : []).map(d => d.date)
  const dayButtons = V3.planDayStrip(plan, forecastDates, day, place.activityDate || null)
  const inRange = forecastDates.indexOf(day) !== -1
  const stops = (Array.isArray(plan.stops) ? plan.stops : [])
    .filter(s => V3.stopDate(plan, s) === day)
    .map(s => {
      const n = nodes[s.nodeIndex]
      if (!n) return null
      const hour = s.time ? V3.parseHM(s.time) : null
      const w = nodeWeather ? nodeWeather[s.nodeIndex] : null
      const ready = inRange && hour != null && w && w !== 'loading' && w !== 'error' && w !== 'noc'
      // 抵达时刻按**所在小时**读取逐时样本（13:30 读 13:00 那一列），不是拿 13:30 去找一条不存在的行
      const hourKey = hour == null ? '' : V3.pad(Math.floor(hour / 60)) + ':00'
      const hourRow = ready
        ? (w.series || []).filter(h => h && h.d === day && h.t === hourKey)[0] || null
        : null
      return {
        nodeIndex: s.nodeIndex,
        name: n.name || ('节点 ' + (s.nodeIndex + 1)),
        altitude: Number.isFinite(n.altitude) ? n.altitude : null,
        altitudeText: Number.isFinite(n.altitude) ? fmtM(n.altitude) : '海拔待确认',
        day: s.day,
        time: s.time || '',
        timed: !!s.time,
        pending: !s.time,
        weather: hourRow ? {
          condition: V3.conditionOf(hourRow.code),
          icon: F.weatherIcon(hourRow.code),
          temp: Number.isFinite(hourRow.temp) ? Math.round(hourRow.temp) + '°' : '—',
          pop: Number.isFinite(hourRow.pop) ? hourRow.pop + '%' : '—',
          wind: Number.isFinite(hourRow.wind) ? Math.round(hourRow.wind) + ' km/h' : '—',
          gust: Number.isFinite(hourRow.gust) ? Math.round(hourRow.gust) : null,
          note: Number.isFinite(hourRow.gust) && hourRow.gust >= 28
            ? '阵风约 ' + Math.round(hourRow.gust) + ' km/h · 留意暴露路段'
            : (Number.isFinite(hourRow.cloud && hourRow.cloud.low) ? '低云 ' + hourRow.cloud.low + '% · 可查看云层剖面' : ''),
        } : null,
        weatherText: !s.time ? '未设置抵达时刻 · 点开查看整天变化'
          : !inRange ? '尚无该日期的可用预报'
            : w === 'loading' ? '正在取这个节点的天气…'
              : w === 'noc' ? '这个节点没有坐标 · 无法单独取数'
                : w === 'error' ? '这个节点的天气没取到 · 点开重试'
                  : !w ? '点开这一小时查看天气'
                    : '这个时刻没有读数',
        loose: !s.time || !inRange,
      }
    })
    .filter(Boolean)
  const maxDay = (Array.isArray(plan.stops) && plan.stops.length)
    ? Math.max.apply(null, plan.stops.map(s => (s && s.day) || 1))
    : 1
  return {
    hasPlan: true,
    planName: plan.name || '',
    planMeta: V3.shortDate(plan.startDate) + ' 出发 · ' + maxDay + ' 天 · ' +
      (plan.isOwner ? '个人计划' : '由 ' + (plan.sharedBy || '同行者') + ' 分享 · 只读'),
    canEdit: !!plan.isOwner,
    canShare: !!plan.isOwner,
    stops,
    dayButtons,
    inRange,
    notice: inRange
      ? { tone: 'info', icon: 'clock', color: '#506650', text: '按各节点预计抵达时刻查询，不是把同一时刻铺满路线。' }
      : { tone: 'warn', icon: 'calendar', color: '#7A5C1E', text: '暂未进入预报范围。行程已保留，临近出发再查。' },
  }
}

/* ---------- 主入口 ---------- */

/**
 * @param {object} o
 *   result   —— getWeatherByPoint 的 ready 返回体
 *   place    —— { id,name,lat,lng,kind,nodes,activityDate,routeId }
 *   node     —— 当前节点 { name, altitude, eleSource }
 *   ctx      —— { date, period, tab, cursor, nodeIndex }
 *   width    —— 图表构建宽度（px）
 *   plan     —— 当前路线的计划（可为 null）
 *   nodeWeather —— 逐节点取数结果（沿途视图用，可为 null）
 *   stale    —— { ageText } 或 null（本地缓存兜底）
 */
function buildDetailView(o) {
  const result = o.result || {}
  const place = o.place || {}
  const ctx = o.ctx || V3.initialState()
  const node = o.node || {}
  const width = Math.max(240, Math.round(o.width || 350))
  const series = Array.isArray(result.series) ? result.series : []
  const days = Array.isArray(result.days) ? result.days : []
  const elev = elevationOf(node, result)
  const selDate = V3.selectedDate(ctx)
  const selCtx = Object.assign({}, ctx, { selDate })
  const skyCtx = skyContext(result, place, node, selCtx, elev)
  let skyOut = null
  try { skyOut = sky.summarize(skyCtx) } catch (e) { skyOut = null }
  const window = V3.windowSeries(series, ctx)
  const cursor = Math.min(V3.cursorOf(ctx), Math.max(0, window.length - 1))
  const hour = V3.hourAt(window, cursor)
  const readout = V3.readoutOf(hour, node)
  const hourly = HSV.buildHourlySvg({ series: window, cursor, period: window.length, node, width })
  // 24h 一屏（用户裁决 A 2026-10-28）：列宽由这块宽度反推，所以「能不能一屏放下」是算出来的，
  // 不是写死的 —— 375/390/414 与 460 上限都走同一条式子（SVG 模块是列宽唯一起点）。
  const plotWidth = Math.max(0, width - HSV.AXIS_W)
  const hourlyScrolls = hourly.width > plotWidth + 0.5
  const cloud = buildCloud(result, ctx, elev, width)
  const cloudSel = cloud.geo ? cloudReadout(cloud.geo, cursor, elev.basis) : null
  const isPoint = place.kind === 'point' || !Array.isArray(place.nodes) || place.nodes.length <= 1
  const allNodes = Array.isArray(place.nodes) ? place.nodes : []
  const nodeIdx = Math.min(Math.max(0, ctx.nodeIndex || 0), Math.max(0, allNodes.length - 1))
  const plan = o.plan || null
  const planStrip = plan && !isPoint ? V3.planDayStrip(plan, days.map(d => d.date), selDate, place.activityDate || null) : null
  const pointStrip = V3.pointDayStrip(days, series, selDate)

  return {
    data: {
      ready: true,
      loading: false,
      error: '',
      errorCode: '',
      stale: o.stale || null,
      outOfRange: false,
      placeName: place.name || '未命名地点',
      placeSub: isPoint
        ? (Number.isFinite(place.lat) ? place.lat.toFixed(4) + '°N, ' + place.lng.toFixed(4) + '°E · ' : '') +
          (Number.isFinite(node.altitude) ? fmtM(node.altitude) + ' m' : '海拔待确认')
        : (node.name || '') + ' · ' + (Number.isFinite(node.altitude) ? fmtM(node.altitude) + ' m' : '海拔待确认'),
      nodeName: node.name || '',
      isPoint,
      nodeOptions: allNodes.map((n, i) => ({ name: n.name, altitude: Number.isFinite(n.altitude) ? n.altitude : null, selected: i === nodeIdx })),
      tabs: V3.TABS.map(t => ({
        key: t, label: V3.TAB_LABELS[t], selected: t === ctx.tab,
        disabled: t === 'route' && isPoint,
      })),
      period: ctx.period,
      periodOptions: V3.PERIODS.map(p => ({ value: p, label: V3.PERIOD_LABELS[p], selected: p === ctx.period })),
      cursor,
      cursorMax: Math.max(0, window.length - 1),
      selectedDate: selDate,
      selectedDateLabel: V3.shortDate(selDate) + ' ' + V3.weekdayOf(selDate),
      dayStrip: planStrip || pointStrip,
      dayStripKind: planStrip ? 'plan' : 'point',
      readout,
      hourlySrc: hourly.svg ? toUri(hourly.svg) : '',
      hourlyWidth: hourly.width,
      hourlyHeight: hourly.height,
      hourlyCell: hourly.cell,
      hourlyColumns: hourly.columns,
      hourlyScrolls,
      hourlyHint: hourlyScrolls ? '左右滑动图表 · 点按小时或拖动时间滑块' : '点按小时或拖动时间滑块',
      hourCols: V3.hourColsOf(window, cursor, HSV.LABEL_EVERY),
      axis: HSV.axisLayout(),
      axisWidth: HSV.AXIS_W,
      cloudMissing: cloud.missing,
      cloud: cloud.card,
      cloudSel: cloudSel || { r1: '点图上任意小时查看读数。', r2: '', r3: '', r4: '', hour: null, selSrc: '', stKey: '' },
      sky: buildSkyView(skyOut, Object.assign({}, selCtx, { lat: place.lat, lng: place.lng }), node),
      route: buildRouteFlow(plan, place, selCtx, o.nodeWeather || null, days),
      activePlanId: plan ? plan.id : '',
      planOwner: plan ? !!plan.isOwner : false,
      updatedLabel: result.stale ? '显示的是 ' + V3.shortDate(String(result.staleAt || '').slice(0, 10)) + ' 前后的预报' : '',
      providerLabel: (result.provider && result.provider.label) || 'Open-Meteo',
      elevLabel: elevLabelOf(elev),
    },
    geo: cloud.geo,
    skyOut,
    window,
  }
}

function elevLabelOf(elev) {
  if (!Number.isFinite(elev.elevation)) return '此点缺少可信海拔'
  const label = F.elevSourceLabel ? F.elevSourceLabel(elev.source) : ''
  return '此点 ' + fmtM(Math.round(elev.elevation)) + ' m' + (label ? ' · ' + label : '')
}

/** 空态/错误态：组件不需要自己拼状态词（journey 层的口径在这里只到"缺什么"） */
function emptyView(kind, message) {
  const titles = {
    denied: '没有查看这处天气的权限',
    empty: '还没有可用的天气数据',
    error: '这次没有取到天气',
    outOfRange: '这个日期还不在预报范围',
  }
  return {
    ready: false,
    loading: false,
    error: message || '',
    errorCode: kind,
    emptyTitle: titles[kind] || titles.error,
    emptyDetail: message || '',
    emptyKind: kind,
    retryNote: '',
  }
}

/**
 * 载入中：只出「正在查询天气」面板（不拿占位数字当数据）。
 * retryNote 是重试窗口里的进度句，**与加载态同进同出**：不在别的路径上单独写它，
 * 免得数据已经到齐、页面上还挂着一句「正在重试」。
 */
function loadingView(retryNote) {
  return { ready: false, loading: true, error: '', errorCode: '', retryNote: retryNote || '' }
}

module.exports = {
  buildDetailView, emptyView, loadingView,
  buildRouteFlow, buildSkyView, buildCloud, cloudReadout, buildSilent,
  elevationOf, horizonDayLabels, sunTimesForWindow, dayLabel, toUri,
}