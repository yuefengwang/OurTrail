// 天气查询视图（对应原型 screens/Weather.tsx + P1/P2 天气设计 + P3 独立天气模块 §5）：
// 上半部分是客观指标（meteogram 时间坐标图 + 数字指标），下半部分是结论（天相判断）。
// 组织者在活动模式下可一键生成天气提醒草稿并跳到活动通知页。
//
// 三种模式（P3 §5.1，点来源无关，展示装配层共用）：
//   activity —— 活动流：id(+point/date) 入参，api.read 活动视图取 routeSnapshot.points
//   local/单点 —— 自由查询：lat/lng(+name/ele/eleSrc/date) 入参，无 read、无日程、可保存/分享
//   local/轨迹组 —— set(轨迹组id)(+point/date) 入参，点集读本地 watch-points，
//               按 §5.4 展开抵达日程（基准日 = 入口日期，会话内固定，防"日期前漂"）
//
// 数据来源：getWeather / getWeatherByPoint 返回 series（7×24 逐时）+ days（7 日）+ detail（所选日 24h）。
// 天文与天相判断全部在客户端算（utils/astro.js、utils/sky.js），云函数只负责取数。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const chartStore = require('../../utils/chart-store')
const F = require('../../utils/format')
const A = require('../../utils/astro')
const sky = require('../../utils/sky')
const agenda = require('../../utils/agenda')
const cond = require('../../utils/conditions')
const RS = require('../../utils/route-schedule')
const WP = require('../../utils/watch-points')

const wpStore = WP.createWatchPoints(draft.wxStorage)

// V2 视图：页面主图默认 24h 一屏（11.5px/列 × 24 + 左刻度 52 + 右留白 8 = 336 ≤ 343 内容宽），
// 48/72h 同列宽横向滚动——同一字号，不为塞下更多小时缩字（实现方案 §关键决定 1）。
const VIEW_HW = 11.5
const CHART_DAYS = 7
// 云函数只认 'YYYY-MM-DD'，任何进 getWeather 的日期都先过这道闸
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// （V2）当日安全提示与评级装配已迁至 utils/conditions.js：buildCallouts（含 WMO 雪码修复）
// 与 overallGrade/starsFor。本页只消费其产出，不再持有安全规则的字面副本。


// 海拔来源标签：活动模式沿用「GPX 记录」；自由查询按 eleSource 如实标注
function elevLabel(eleSource) {
  return eleSource === 'gpx' ? 'GPX 记录' : eleSource === 'picked' ? '地图选点' : '手动填写'
}

/* ---------- V2 图表装配（纯函数，wx-free；weather-v2-test 直接覆盖） ---------- */

// 某分钟的日照相位：night（天文暗夜）/ astro（暮光）/ blue / golden / ''（白昼）。
// 窄窗口（黄金/蓝调）按 inWindow 区间判定——与 sky.hourMarks 的「相交判定」同一手势，
// 整点采样会漏掉十几分钟的窗口。sun/win 来自 astro.sunTimes / photoWindows。
function sunBandAt(m, sun, win) {
  const astroDawn = sky.hourMin(sun.astroDawn)
  const astroDusk = sky.hourMin(sun.astroDusk)
  if (Number.isFinite(astroDawn) && Number.isFinite(astroDusk) && (m < astroDawn || m > astroDusk)) return 'night'
  const civilDawn = sky.hourMin(sun.civilDawn)
  const civilDusk = sky.hourMin(sun.civilDusk)
  if (Number.isFinite(civilDawn) && Number.isFinite(civilDusk) && (m < civilDawn || m > civilDusk)) return 'astro'
  const bluePairs = [win.dawnBlue, win.duskBlue]
  const goldenPairs = [win.morningGolden, win.eveningGolden]
  for (const w of bluePairs) {
    if (w && sky.inWindow(m, sky.hourMin(w.from), sky.hourMin(w.to))) return 'blue'
  }
  for (const w of goldenPairs) {
    if (w && sky.inWindow(m, sky.hourMin(w.from), sky.hourMin(w.to))) return 'golden'
  }
  return ''
}

// 逐时日照相位表 {'dateTHH:mm': phase}，供 meteogram 轴带绘制
function buildSunBands(series, coords, elevation) {
  const out = {}
  const byDate = {}
  for (const h of series) (byDate[h.d] = byDate[h.d] || []).push(h)
  Object.keys(byDate).forEach(d => {
    const sun = A.sunTimes(d, coords.lat, coords.lng, elevation)
    const win = A.photoWindows(d, coords.lat, coords.lng, elevation)
    byDate[d].forEach(h => {
      const phase = sunBandAt(sky.hourMin(h.t), sun, win)
      if (phase) out[d + 'T' + h.t] = phase
    })
  })
  return out
}

// 逐日日出日落 { date: { rise, set } }，供 meteogram 轴上虚线（本地天文按海拔修正，与日卡同源）
function buildSunLines(series, coords, elevation) {
  const out = {}
  const byDate = {}
  for (const h of series) (byDate[h.d] = byDate[h.d] || []).push(h)
  Object.keys(byDate).forEach(d => {
    const sun = A.sunTimes(d, coords.lat, coords.lng, elevation)
    out[d] = { rise: sun.sunrise || '', set: sun.sunset || '' }
  })
  return out
}

Page({
  data: {
    loading: true,
    denied: '',
    mode: 'activity',
    pointLabels: [],
    pointIndex: 0,
    date: '',
    dayCards: [],
    callouts: [],
    detailRows: [],
    showDetail: false,
    updatedAt: '',
    providerLabel: '',
    emptyTitle: '',
    emptyDetail: '',
    isOwner: false,
    // 节点抵达日程（需求：按轨迹标注点判断第几天抵达）
    schedule: [],
    scheduleBasis: '',
    spanDays: null,
    // meteogram
    chartSeries: [],
    chartMarks: {},
    chartNight: {},
    chartSelected: {},
    // V2 视图：24/48/72h 切窗 + 小时浮条 + 日照轴/云带剖面的装配结果
    viewSpan: 24,
    viewHW: VIEW_HW,
    chartView: [],
    chartSunBands: {},
    chartSunLines: {},
    chartNow: null,
    chartElev: null,
    chartPick: null,
    hourChip: null,
    agenda: [],
    // 时空天相图（P4）。spaceNodes 只含可信抵达时刻的节点，见 setData 处的注释。
    spaceSeries: [],
    // sky.js 的「前日有降水」依据。dayCards 是转换后的展示形状，不能直接喂给 sky.js
    spaceDays: [],
    spaceNodes: [],
    spaceLat: NaN,
    spaceLng: NaN,
    // 抵达节点（观景位）的海拔与时刻，作为图的参考线输入
    spaceObsAlt: null,
    spaceArriveT: '',
    // V2 户外条件：总评 + 评级卡（Evidence 锚点在 Phase 4 由 factsFor 注入）
    condOverall: null,
    condCards: [],
    openEvidence: {},
    // 自由查询单点：静态点卡替代节点 picker（P3 §5.1）
    pointCard: null,
    showSave: false,
  },

  onLoad(options) {
    const o = options || {}
    // 模式判定宽容化（P3 §5.2）：src 省略时按入参推断——有 set 或 lat/lng 即 local，
    // 手输 path、分享参数被截时更皮实。
    this.mode = 'activity'
    this.localKind = ''
    this.setId = ''
    if (o.set) {
      this.mode = 'local'
      this.localKind = 'track'
      this.setId = String(o.set)
    } else if (o.lat !== undefined || o.lng !== undefined || o.src === 'local') {
      this.mode = 'local'
      this.localKind = 'point'
    }
    this.activityId = o.id || ''
    this.userPickedDate = false
    // 详情页途中节点「天气」入口带入的定位参数：point 仅首次消费，date 作为初始日期
    this.initialPoint = /^\d+$/.test(o.point || '') ? Number(o.point) : null
    this.initialDate = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : ''
    // 自由查询单点入参（hub 直达 / 分享落地共用）
    this.localPoint = null
    if (this.mode === 'local' && this.localKind === 'point') {
      const lat = Number(o.lat)
      const lng = Number(o.lng)
      const ok = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      let name = ''
      if (o.name) {
        try { name = decodeURIComponent(String(o.name)) } catch (e) { name = String(o.name) }
      }
      const ele = Number(o.ele)
      this.localPoint = ok ? {
        id: 'wp-local',
        name,
        coordinates: { lat, lng },
        ele: Number.isFinite(ele) && ele > -500 && ele <= 9000 ? Math.round(ele) : null,
        eleSource: o.eleSrc === 'gpx' || o.eleSrc === 'picked' ? o.eleSrc : 'manual',
      } : { invalid: true }
    }
    // 分享仅 local 模式（P3 §5.1）：定义了 onShareAppMessage 后转发对全页可用，
    // 活动模式必须显式关掉——否则转发出去的默认 path 丢 id，对方只会看到 denied。
    if (this.mode === 'activity' && typeof wx !== 'undefined' && wx.hideShareMenu) {
      wx.hideShareMenu({ fail: () => {} })
    }
  },

  onShow() {
    this.reload()
  },

  // ---- 模式感知取点（P3 §5.2 评审补：此页原把 this.view… 内联读了 5 处，
  // local 模式没有 this.view，必须统一入口，一处分流）----
  getPoints() {
    if (this.mode === 'activity') {
      const v = this.view
      return (v && v.activity && v.activity.routeSnapshot && v.activity.routeSnapshot.points) || []
    }
    return this._localPoints || []
  },

  resolveContext() {
    if (this.mode === 'activity') {
      if (!this.activityId) return Promise.resolve({ denied: '缺少活动编号。' })
      return api.read({ kind: 'activity', activityId: this.activityId, perspective: 'participant' }).then(res => {
        if (res.view.kind !== 'activity') {
          return { denied: res.view.kind === 'denied' ? res.view.message : '活动不存在。' }
        }
        this.revision = res.revision
        this.now = res.now
        this.view = res.view
        const a = res.view.activity
        const points = a.routeSnapshot.points
        const sched = RS.schedule(points, a.startAt)
        return {
          points,
          sched,
          hasStart: !!a.startAt,
          pointIndex: Math.max(0, Math.min(this.pickInitialPoint(points.length), points.length - 1)),
          isOwner: res.view.permittedActions.indexOf('notice.publish') !== -1,
          initialDate: this.userPickedDate ? this.data.date : '',
          title: '',
        }
      })
    }
    if (this.localKind === 'point') {
      if (!this.localPoint || this.localPoint.invalid) {
        return Promise.resolve({ denied: '坐标不完整，无法查询。' })
      }
      const p = this.localPoint
      const points = [{
        id: p.id,
        name: p.name,
        kind: 'checkpoint',
        coordinates: p.coordinates,
        ele: p.ele,
        eleSource: p.eleSource,
        time: null,
      }]
      return Promise.resolve({
        points, sched: [], hasStart: false, pointIndex: 0, isOwner: false,
        initialDate: this.userPickedDate ? this.data.date : '',
        title: this.displayPointName(p),
      })
    }
    // 轨迹组：点集读本地存储；组被删后旧入口落 denied，零外呼
    const set = wpStore.getTrack(this.setId)
    if (!set || !set.points || set.points.length < 2) {
      return Promise.resolve({ denied: '轨迹组已删除或不存在。' })
    }
    const len = set.points.length
    const points = set.points.map((p, i) => ({
      id: p.id,
      name: p.name || (i === 0 ? '起点' : i === len - 1 ? '终点' : '节点 ' + i),
      kind: i === 0 ? 'start' : i === len - 1 ? 'finish' : 'checkpoint',
      coordinates: { lat: p.lat, lng: p.lng },
      ele: p.ele,
      eleSource: 'gpx',
      time: p.time || null,
    }))
    // §5.4 抵达日程：startAt = 基准日 + GPX 锚点（首个有时间戳节点）的钟点。
    // 基准日 = 入口日期或今天，**会话内固定**——若跟着"当前所选日期"走，切节点会把日期
    // 带到抵达日、抵达日又成新基准，整个行程逐次前漂。切日只是查看，换基准从 hub 重进。
    this._baseDate = this.initialDate || F.cnToday()
    let sched = RS.schedule(points, null)
    let hasStart = false
    const anchor = points.find(p => p.time && Number.isFinite(Date.parse(p.time)))
    if (anchor) {
      const startAt = this._baseDate + 'T' + RS.clockOf(RS.minutesOfDay(anchor.time)) + ':00+08:00'
      sched = RS.schedule(points, startAt)
      hasStart = true
    }
    return Promise.resolve({
      points, sched, hasStart,
      pointIndex: Math.max(0, Math.min(this.pickInitialPoint(points.length), points.length - 1)),
      isOwner: false,
      initialDate: this.userPickedDate ? this.data.date : '',
      title: set.name,
    })
  },

  displayPointName(p) {
    return p.name || WP.coordName(p.coordinates.lat, p.coordinates.lng)
  },

  reload() {
    this.resolveContext().then(ctx => {
      if (ctx.denied) {
        this.setData({ loading: false, denied: ctx.denied })
        return
      }
      const points = ctx.points
      this._localPoints = this.mode === 'local' ? points : null
      // 日期必须在这一轮 setData 里一并落定。setData 的回调是异步的：若把日期放到回调里再设，
      // 紧随其后的 fetchWeather 会读到上一次的空日期，发出 date:''，云函数回"日期无效"。
      // 同理请求也放进回调，确保 this.data.date 已是最终值。
      const date = this.resolveDate(ctx.sched, ctx.pointIndex, ctx.initialDate)
      const single = this.mode === 'local' && this.localKind === 'point'
      const p0 = points[0]
      if (ctx.title && typeof wx !== 'undefined' && wx.setNavigationBarTitle) {
        wx.setNavigationBarTitle({ title: ctx.title, fail: () => {} })
      }
      // 时空天相图的节点输入：**只收有可信抵达时刻的节点**。
      // route-schedule 的立场是「没有时间信息就不给提醒，不按距离插值」，这里必须一致
      // ——宁可图上少几个点，也不编造抵达时刻。
      // 坐标逐节点带上：太阳高度角沿路线会偏移，全组共用一个经纬度会算错天文时刻。
      // km 暂缺：GPX 的 toRoutePoints 不输出数值化累计里程（只在 name 里写「约 X 公里处」），
      // 给它加字段会改动 weather-page/editor 场景测试断言的点结构，留到漫游滑块那期一起做。
      const spaceNodes = points.reduce((acc, pt, i) => {
        const s = ctx.sched[i]
        if (!s || !s.known || !s.arriveTime || !s.arriveDate) return acc
        const co = pt.coordinates || {}
        acc.push({
          t: s.arriveTime,
          d: s.arriveDate,
          alt: Number.isFinite(pt.ele) ? pt.ele : null,
          name: pt.name || '',
          lat: Number.isFinite(co.lat) ? co.lat : undefined,
          lng: Number.isFinite(co.lng) ? co.lng : undefined,
        })
        return acc
      }, [])
      const spaceLast = spaceNodes.length ? spaceNodes[spaceNodes.length - 1] : null
      // 缺省坐标兜底用当前所选节点——单点查询与「local」模式下这就是唯一坐标
      const curCo = (points[this.data.pointIndex] || p0 || {}).coordinates || {}
      this.setData({
        loading: false,
        denied: '',
        mode: this.mode,
        pointLabels: points.map((pt, i) => {
          const s = ctx.sched[i]
          const label = s && s.known ? RS.nodeLabel(s) : ''
          return label ? pt.name + '（' + label + '）' : pt.name
        }),
        schedule: ctx.sched,
        scheduleBasis: RS.basisText(ctx.sched, ctx.hasStart),
        spanDays: RS.spanDays(ctx.sched),
        spaceNodes,
        spaceLat: Number.isFinite(curCo.lat) ? curCo.lat : NaN,
        spaceLng: Number.isFinite(curCo.lng) ? curCo.lng : NaN,
        spaceObsAlt: spaceLast && Number.isFinite(spaceLast.alt) ? spaceLast.alt : null,
        spaceArriveT: spaceLast ? spaceLast.t : '',
        pointIndex: ctx.pointIndex,
        date,
        isOwner: ctx.isOwner,
        showSave: single,
        pointCard: single && p0 ? {
          name: this.displayPointName(p0),
          coordText: p0.coordinates.lat.toFixed(4) + ', ' + p0.coordinates.lng.toFixed(4),
          eleText: Number.isFinite(p0.ele)
            ? Math.round(p0.ele) + ' m · ' + elevLabel(p0.eleSource)
            : '海拔未知 · 按模型推算（±300-600 m）',
        } : null,
      }, () => { if (points.length) this.fetchWeather() })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  // 从详情页带 point 入参时优先定位该节点（只消费一次）
  pickInitialPoint(len) {
    if (this.initialPoint !== null && this.initialPoint !== undefined) {
      const idx = this.initialPoint
      this.initialPoint = null
      return Math.max(0, Math.min(idx, len - 1))
    }
    return this.data.pointIndex
  },

  /**
   * 决定查询日期（纯函数，不读 this.data 的待更新状态）。
   * 优先级：用户手动选 > 节点推算的抵达日 > 入口带入的日期 > 活动出发日 > 今天。
   * 节点推算比入口日期更精确——详情页带过来的是活动出发日，而多日行程里到某节点往往是第 2、3 天。
   */
  resolveDate(sched, pointIndex, pickedDate) {
    if (pickedDate && ISO_DATE.test(pickedDate)) return pickedDate
    const s = (sched || [])[pointIndex]
    if (s && s.known && s.arriveDate) return s.arriveDate
    if (this.initialDate && ISO_DATE.test(this.initialDate)) return this.initialDate
    const a = this.view && this.view.activity
    if (a && a.startAt) {
      const d = F.cnParts(a.startAt).date
      if (ISO_DATE.test(d)) return d
    }
    return F.cnToday()
  },

  // 已有返回体是否可用于该日期。series 自带 7 天逐时，所以同点同日重进页面不必再外呼。
  // 必须要求窗口**锚定**在所选日：若允许从窗口中间复用，剩余天数会越切越少
  // （切到第 7 天只剩 1 天的图），宁可重取。
  covers(result, date, pointId) {
    if (!result || result.pointId !== pointId) return false
    const s = result.series || []
    if (!s.length || s[0].d !== date) return false
    return (result.days || []).some(d => d.date === date)
  },

  fetchWeather() {
    const points = this.getPoints()
    const point = points[this.data.pointIndex]
    if (!point) return
    const reset = {
      loadingWeather: true, dayCards: [], callouts: [],
      detailRows: [], chartSeries: [], chartMarks: {}, chartNight: {},
      chartView: [], chartSunBands: {}, chartSunLines: {}, chartNow: null, chartElev: null,
      chartPick: null, hourChip: null, agenda: [],
      condOverall: null, condCards: [], openEvidence: {},
    }
    // 兜底：日期尚未落定时不外呼（云函数会回"日期无效"，那句话对用户没意义）。
    // resolveDate 兜底链必然产出合法日期，收敛一次即可，不会循环。
    if (!ISO_DATE.test(this.data.date)) {
      const date = this.resolveDate(this.data.schedule, this.data.pointIndex, '')
      this.setData({ date }, () => this.fetchWeather())
      return
    }
    this.setData(reset)
    // 窗口内复用：切日、切节点都不重新查询（30 分钟缓存内本来就零成本，这里连等待都没有）。
    // point.id 每模式唯一（活动节点 id / 单点 'wp-local' / 轨迹组节点导入时生成的 id），
    // 换节点必然 miss，不会误复用别的点的序列。
    const cached = this._lastResult
    if (this.covers(cached, this.data.date, point.id)) {
      this.applyWeather(Object.assign({}, cached), point, reset)
      return
    }
    const fetching = this.mode === 'activity'
      ? api.getWeather(this.activityId, point.id, this.data.date)
      : api.getWeatherByPoint(point.coordinates.lat, point.coordinates.lng, this.data.date)
    fetching.then(result => {
      if (result.status !== 'ready') {
        this.setData(Object.assign({}, reset, {
          loadingWeather: false,
          emptyTitle: result.status === 'out_of_range' ? '暂不展示天气数字' : '天气暂不可用',
          emptyDetail: result.status === 'out_of_range'
            ? '所选日期超出今天起14天的预报范围。请保留日期，临近出发再核实。'
            : result.message || '请稍后重试。',
        }))
        return
      }
      this._lastResult = Object.assign({ pointId: point.id }, result)
      this.applyWeather(result, point, reset)
    }).catch(e => this.setData(Object.assign({}, reset, {
      loadingWeather: false, emptyTitle: '天气暂不可用', emptyDetail: api.errorText(e),
    })))
  },

  // 把返回体装配成页面数据。detail 在此从 series 里按所选日切出（云端也返回 detail，
  // 但窗口内切日时我们用的是本地缓存，统一在这里切，保证两条路径口径一致）。
  applyWeather(result, point, reset) {
    const series = result.series || []
    const detail = series.filter(h => h.d === this.data.date)
    const day = (result.days || []).find(x => x.date === this.data.date) || {}
    // 海拔优先用真实高程（GPX/手填），缺失时退回模型降尺度值并说明来源
    const elevOK = Number.isFinite(point.ele)
    const elevation = elevOK ? point.ele : result.pointElevation
    const skyCtx = {
      date: this.data.date,
      lat: point.coordinates.lat,
      lng: point.coordinates.lng,
      elevation,
      elevOK,
      detail,
      days: result.days || [],
      heading: this.headingAt(this.data.pointIndex),
    }
    const skyOut = sky.summarize(skyCtx)
    const chartSeries = this.buildChartSeries(series, this.data.date)
    const chartMarks = this.buildChartMarks(series, point.coordinates, elevation, elevOK, result.days || [])
    const chartNight = this.buildNightMap(series, point.coordinates, elevation)
    const chartSelected = { [this.data.date]: true }
    // V2 装配：日照轴带/日出日落线/现在线/云带剖面海拔——全部纯函数，wx-free（可 node 测）
    const chartSunBands = buildSunBands(chartSeries, point.coordinates, elevation)
    const chartSunLines = buildSunLines(chartSeries, point.coordinates, elevation)
    const chartNow = this.buildNowMarker()
    // V2 今日户外时间轴：天文/天气（L1）+ hourMarks 簇（L2，云海已做可见性交集），
    // 评级与星级按 key 关联 summarize 的同 key 结论——三处（图/日程/卡）同源不打架
    const win = A.photoWindows(this.data.date, point.coordinates.lat, point.coordinates.lng, elevation)
    const agendaEvents = agenda.buildDayAgenda({
      date: this.data.date, detail, marks: chartMarks,
      sun: skyOut ? skyOut.sun : null, win,
    })
    const itemByKey = {}
    if (skyOut) skyOut.items.forEach(it => { itemByKey[it.key] = it })
    const agendaView = agendaEvents.map(ev => {
      if (!ev.l2) return ev
      const it = itemByKey[ev.key]
      const score = it ? it.score : 0
      const filled = score >= 70 ? 4 : score >= 45 ? 3 : 2
      return Object.assign({}, ev, {
        tone: it ? it.tone : 'neutral',
        gradeLabel: it ? it.label : '条件较差',
        stars: '★★★★★'.slice(0, filled) + '☆☆☆☆☆'.slice(0, 5 - filled),
      })
    })
    // 时空天相图要**完整** series，不是 chartSeries 那个从所选日起的 7 天切片——
    // 多日线路的后续节点常落在切片之外，节点会静默拿不到天相。
    // 这里多传一份完整序列是有意的取舍；若日后性能吃紧，可裁到
    // 「spaceNodes 涉及的日期 ±1 天」而不是整条 168 小时。
    const spaceSeries = series
    // 交给「全图展示」横屏页：那一页在页面栈上方，直接读内存即可，不必把 168 小时序列塞 URL
    // （7 天语义是缓存契约与全屏页依赖，页面主图的 24/48/72h 切窗走 buildViewSeries，不在这里）
    chartStore.set({
      series: chartSeries, marks: chartMarks, night: chartNight, selected: chartSelected,
      pointName: this.displayPointName(point), date: this.data.date,
    })
    this.setData(Object.assign({}, reset, {
      loadingWeather: false,
      emptyTitle: '',
      emptyDetail: '',
      updatedAt: F.dtFull(result.updatedAt),
      providerLabel: (result.provider && result.provider.label) || 'Open-Meteo',
      dayCards: this.buildDayCards(result.days || [], point.coordinates),
      callouts: cond.buildCallouts(day, detail, elevation),
      detailRows: this.buildDetailRows(detail),
      condOverall: skyOut ? cond.overallGrade(skyOut.items) : null,
      condCards: this.buildCondCards(skyOut, {
        date: this.data.date,
        detail,
        days: result.days || [],
        elevation,
        sun: skyOut ? skyOut.sun : null,
        moon: skyOut ? skyOut.moon : null,
      }),
      chartSeries,
      chartMarks,
      chartNight,
      chartSelected,
      chartSunBands,
      chartSunLines,
      chartNow,
      chartElev: Number.isFinite(elevation) ? elevation : null,
      chartView: this.buildViewSeries(chartSeries, this.data.viewSpan),
      agenda: agendaView,
      spaceSeries,
      spaceDays: result.days || [],
    }))
  },

  // 「现在」标记：仅当日所选日期 = 北京时间今天时给（查看未来日期没有"现在"可言）
  buildNowMarker() {
    const nowIso = new Date(Date.now() + 8 * 3600000).toISOString()
    const date = nowIso.slice(0, 10)
    const t = nowIso.slice(11, 16)
    return date === this.data.date ? { date, t } : null
  },

  // V2 户外条件卡：sky.summarize 的产出原样换容器（文案/时段/往哪看零重写），
  // 只新增评级语言（starsOf）与 Evidence 事实清单（factsFor，全部图上可核对的事实）。
  // 客观时刻（light）不进卡片——黄金/蓝调/日出日落是事实，由日照轴与 Agenda 表达。
  buildCondCards(skyOut, ctx) {
    if (!skyOut) return []
    const cards = skyOut.items
      .filter(it => it.key !== 'light')
      .map(it => ({
        key: it.key,
        title: it.title,
        window: it.window || '',
        text: it.text,
        look: it.look || '',
        tone: it.tone,
        gradeLabel: it.label,
        stars: cond.starsOf(it.score),
        featured: it.key === 'cloudSea',
        evidence: cond.factsFor(it.key, ctx),
      }))
    cards.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))
    return cards
  },

  // Evidence 开合（「为什么？」）
  onToggleEvidence(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const next = Object.assign({}, this.data.openEvidence)
    if (next[key]) delete next[key]; else next[key] = true
    this.setData({ openEvidence: next })
  },

  // Evidence「看图 ↗」：真正能验证的回跳——高亮锚定小时列 + 打开浮条 + 滚回时间轴
  onEvidenceJump(e) {
    const at = e.currentTarget.dataset.at
    if (!at) return
    const view = this.data.chartView || []
    const h = view.find(x => x.t === at) || view[0]
    if (!h) return
    this.selectHour(h.d, h.t)
    if (typeof wx !== 'undefined' && wx.pageScrollTo) {
      wx.pageScrollTo({ selector: '.timeline-card', duration: 300, fail: () => {} })
    }
  },

  // 节点的前进/山脊走向（用前后节点连线求方位角），供日照金山"往哪看"粗判
  headingAt(index) {
    const pts = this.getPoints()
    const cur = pts[index]
    if (!cur || !cur.coordinates) return null
    const next = pts[index + 1] || pts[index - 1]
    if (!next || !next.coordinates) return null
    return sky.bearingBetween(cur.coordinates, next.coordinates)
  },

  // meteogram 序列：从所选日起 7 天。云函数已把 series 锚定在所选日，
  // 这里只做防御性重切；所选日不在窗口内（选了过去的日子）时与 buildDayCards 一样
  // 退回序列首日，保证图与概览条永远同窗。
  buildChartSeries(series, date) {
    const start = series.findIndex(h => h.d === date)
    if (start < 0) return series.slice(0, 24 * CHART_DAYS)
    return series.slice(start, start + 24 * CHART_DAYS)
  },

  // 逐日算天相标记（图表标记行）。只算标记不算文案，结论卡另按所选日算。
  buildChartMarks(series, coords, elevation, elevOK, days) {
    const out = {}
    const byDate = {}
    for (const h of series) (byDate[h.d] = byDate[h.d] || []).push(h)
    Object.keys(byDate).forEach(d => {
      const marks = sky.hourMarks({
        date: d, lat: coords.lat, lng: coords.lng, elevation, elevOK, detail: byDate[d], days,
      })
      Object.keys(marks).forEach(t => { out[d + 'T' + t] = marks[t] })
    })
    return out
  },

  // 夜间底色：逐日算天文暮光，落在暗夜的小时标出来
  buildNightMap(series, coords, elevation) {
    const out = {}
    const byDate = {}
    for (const h of series) (byDate[h.d] = byDate[h.d] || []).push(h)
    Object.keys(byDate).forEach(d => {
      const sun = A.sunTimes(d, coords.lat, coords.lng, elevation)
      const dawn = sky.hourMin(sun.astroDawn)
      const dusk = sky.hourMin(sun.astroDusk)
      byDate[d].forEach(h => {
        const m = sky.hourMin(h.t)
        if (Number.isFinite(dawn) && Number.isFinite(dusk) && (m < dawn || m > dusk)) out[d + 'T' + h.t] = true
      })
    })
    return out
  },

  // 7 日概览条：与 meteogram 同一窗口（都从所选日起 7 天）。
  // 原实现有一条 days.slice(0, CHART_DAYS) 的兜底，在所选日靠近预报末尾时会把窗口拉回今天，
  // 与图错开 6 天、选中日掉出首屏——所以兜底只在"所选日根本不在窗口内"（如选了过去的日子）时
  // 用，且此时 meteogram 的 buildChartSeries 会一起退回预报首日，两者始终同窗。
  buildDayCards(days, coords) {
    let list = days.filter(d => d.date >= this.data.date).slice(0, CHART_DAYS)
    if (!list.length) list = days.slice(0, CHART_DAYS)
    return list.map(day => {
      let label = '周' + F.WEEK[new Date(day.date + 'T12:00:00+08:00').getUTCDay()]
      if (day.date === F.cnToday()) label = '今'
      else if (day.date === this.addDays(F.cnToday(), 1)) label = '明'
      const md = day.date.slice(5, 10).split('-')
      return {
        date: day.date,
        label,
        dateLabel: Number(md[0]) + '/' + Number(md[1]),
        phrase: F.weatherPhrase(day.code),
        tMax: day.tMax,
        tMin: day.tMin,
        precipProbMax: day.precipProbMax,
        // 逐日的日出日落已由日照轴与 Agenda 表达（V2 去重）；日条只负责选哪一天
        selected: day.date === this.data.date,
      }
    })
  },

  // 当前节点的可信海拔（真实高程优先），供日照轴/云带剖面的海拔线复用
  nodeElevation() {
    const p = this.getPoints()[this.data.pointIndex]
    return p && Number.isFinite(p.ele) ? p.ele : null
  },

  addDays(iso, n) {
    return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
  },

  // V2 视图切片：chartSeries 恒定锚定所选日（buildChartSeries 的 7 天语义是缓存与全屏页契约），
  // 页面主图只取前 span 小时——24h 一屏、48/72h 横滚，同一字号。
  // span 单位是**小时**（24/48/72），非法值回落 24。
  buildViewSeries(chartSeries, span) {
    const hours = span === 48 || span === 72 ? span : 24
    return (chartSeries || []).slice(0, hours)
  },

  // 24/48/72h 切窗：纯客户端切片（窗口内复用已保证 chartSeries 在手），零外呼
  onSpanToggle(e) {
    const span = Number(e.currentTarget.dataset.span)
    if (span !== 24 && span !== 48 && span !== 72) return
    this.setData({
      viewSpan: span,
      chartView: this.buildViewSeries(this.data.chartSeries, span),
      chartPick: null,
      hourChip: null,
    })
  },

  // 关闭小时浮条
  onChipClose() {
    this.setData({ chartPick: null, hourChip: null })
  },

  buildDetailRows(detail) {
    // V2 Numbers：全字段折叠表。optional 字段（体感/风向/气压/露点/云带）缺失时显示 '—'，
    // 不得因旧返回体没有这些键而失败（新客户端配旧云函数是常态）。
    return detail.map(h => ({
      t: h.t,
      phrase: F.weatherPhrase(h.code),
      temp: h.temp == null ? '—' : Math.round(h.temp),
      feels: h.feels == null ? '—' : Math.round(h.feels),
      pop: h.pop == null ? 0 : h.pop,
      precip: ((h.precip || 0) + (h.showers || 0)).toFixed(1),
      wind: h.wind == null ? '—' : Math.round(h.wind),
      windDir: F.windDirText(h.windDir) || '—',
      rh: h.rh == null ? '—' : Math.round(h.rh),
      pressure: h.pressure == null ? '—' : Math.round(h.pressure),
      visibility: h.visibility == null ? '—' : h.visibility,
      uv: h.uv == null ? '—' : h.uv,
      dewPoint: h.dewPoint == null ? '—' : Math.round(h.dewPoint),
      band: h.band && Number.isFinite(h.band.base) ? h.band.base + '–' + h.band.top : '—',
    }))
  },

  // 切换节点：若该节点能推算抵达日，日期自动跟到那一天（除非用户手动选过）
  // 日期与 pointIndex 必须同一次 setData 落定，再发请求（同 reload 的理由）
  onPoint(e) {
    this._lastResult = null // 换了节点，缓存的返回体不再适用
    this.userPickedDate = false
    const pointIndex = Number(e.detail.value)
    const date = this.resolveDate(this.data.schedule, pointIndex, '')
    this.setData({ pointIndex, date }, () => this.fetchWeather())
  },

  onDate(e) {
    this.userPickedDate = true
    this.setData({ date: e.detail.value }, () => this.fetchWeather())
  },

  // 7 日概览条：点击某天 = 切日期重查（缓存内零成本）
  onDayTap(e) {
    const date = e.currentTarget.dataset.date
    if (!date || date === this.data.date) return
    this.userPickedDate = true
    this.setData({
      date,
      dayCards: this.data.dayCards.map(c => Object.assign({}, c, { selected: c.date === date })),
    }, () => this.fetchWeather())
  },

  // meteogram 上点某小时（V2）= 选中该小时：高亮列 + 浮条展示该小时的数字与天相归属。
  // 切日走 7 日条（onDayTap）；本 handler 只做选中，不再切日——图与卡的窗口由日条统一。
  onChartPickHour(e) {
    const d = (e && e.detail) || {}
    if (d.date && d.t) this.selectHour(d.date, d.t)
  },

  // 选中某小时（点图与 Evidence「看图↗」共用）
  selectHour(date, t) {
    const h = (this.data.chartView || []).find(x => x.d === date && x.t === t)
    if (!h) return
    const list = this.data.chartMarks[date + 'T' + t] || []
    // 天相标签与图上标记/结论卡同源（marks），inCloud 是减分项单独提示
    const tagNames = {
      cloudSea: '云海窗口', alpenglow: '光染可能', golden: '黄金时刻',
      blueHour: '蓝调时刻', rainbow: '彩虹可能', star: '星空', galaxy: '银河',
    }
    this.setData({
      chartPick: { date, t },
      hourChip: {
        t,
        phrase: F.weatherPhrase(h.code),
        temp: h.temp == null ? '—' : Math.round(h.temp),
        feels: h.feels == null ? '—' : Math.round(h.feels),
        pop: h.pop == null ? 0 : h.pop,
        precip: (((h.precip || 0) + (h.showers || 0)) * 10).toFixed(1) / 1,
        wind: h.wind == null ? '—' : Math.round(h.wind),
        windDir: F.windDirText(h.windDir),
        rh: h.rh == null ? '—' : Math.round(h.rh),
        pressure: h.pressure == null ? '—' : Math.round(h.pressure),
        band: h.band && Number.isFinite(h.band.base) ? h.band.base + '–' + h.band.top + ' m' : '',
        tags: list.filter(k => k !== 'inCloud').map(k => tagNames[k] || k),
        inCloud: list.indexOf('inCloud') !== -1,
      },
    })
  },

  toggleDetail() {
    this.setData({ showDetail: !this.data.showDetail })
  },

  // 全图展示：横屏整屏看。canvas 是原生组件压不出屏幕，只有更宽的视口能让 7 天一屏看完。
  onFullscreen() {
    if (!this.data.chartSeries.length) {
      wx.showToast({ title: '图表还没有数据，先等预报加载完。', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/weather-chart/weather-chart' })
  },

  // 生成天气提醒草稿：带上节点、抵达日与当天结论要点（仅活动模式；isOwner 才渲染）
  onDraftNotice() {
    if (this.mode !== 'activity') return
    const points = this.getPoints()
    const point = points[this.data.pointIndex]
    const s = this.data.schedule[this.data.pointIndex]
    const when = s && s.known && s.arriveTime
      ? this.data.date + ' ' + RS.nodeLabel(s) + '（' + point.name + '）'
      : this.data.date + ' ' + (point ? point.name : '')
    draft.setDraft(this.activityId, 'notice', {
      content: when + ' 天气提醒：出发前请核实当地预报与路况，准备防滑鞋与雨具。',
    })
    wx.navigateTo({ url: '/pages/anotices/anotices?id=' + this.activityId })
  },

  // 保存此点（仅自由查询单点；轨迹组节点已在组里，活动模式无此语义）
  onSavePoint() {
    const point = this.getPoints()[this.data.pointIndex]
    if (!point) return
    const input = {
      name: point.name,
      lat: point.coordinates.lat,
      lng: point.coordinates.lng,
      ele: point.ele,
      eleSource: point.eleSource || 'manual',
    }
    const save = (replaceId) => {
      const r = wpStore.savePoint(replaceId ? Object.assign({ id: replaceId }, input) : input)
      if (!r.ok) {
        api.toast(r.reason === 'cap' ? '最多存 ' + WP.POINTS_CAP + ' 个观察点，先删一个' : '坐标无效，无法保存')
        return
      }
      api.toast(r.updated ? '已替换原有观察点' : '已存入观察点')
    }
    // 3dp 网格去重（P3 §6）：命中即让用户选替换或并存，不静默产生重复行
    const nearby = wpStore.listPoints().find(p => WP.dedupeKey(p.lat, p.lng) === WP.dedupeKey(input.lat, input.lng))
    if (nearby && nearby.id !== point.id) {
      wx.showModal({
        title: '已有很近的观察点',
        content: '「' + (nearby.name || WP.coordName(nearby.lat, nearby.lng)) + '」就在附近（约百米内），替换它吗？',
        confirmText: '替换',
        cancelText: '并存',
        success: res => { if (res.confirm) save(nearby.id); else save(null) },
        fail: () => save(null),
      })
      return
    }
    save(null)
  },

  // 分享（P3 §5.3 决策 (b)）：URL 只带 3dp 降精度坐标与日期，不带 name/ele——
  // 这是本仓首个带坐标的分享链路，宁可少给信息也不泄露精确位置；≈百米网格足够定位山头。
  // 接收方落地的点显示坐标文案名、海拔用模型值，可自行「存入观察点」。
  // 活动模式已在 onLoad hideShareMenu，此 handler 不会走到。
  onShareAppMessage() {
    if (this.mode !== 'local') return { title: 'OurTrail 天气' }
    const point = this.getPoints()[this.data.pointIndex]
    if (!point) return { title: 'OurTrail 天气' }
    const c = WP.sharePointPayload(point.coordinates.lat, point.coordinates.lng)
    const selected = this.data.dayCards.find(x => x.date === this.data.date)
    const title = this.displayPointName(point) + ' ' + this.data.date + ' 天气'
      + (selected && selected.phrase ? ' · ' + selected.phrase.label : '')
    return {
      title,
      path: '/pages/weather/weather?src=local&lat=' + c.lat + '&lng=' + c.lng + '&date=' + this.data.date,
    }
  },
})
