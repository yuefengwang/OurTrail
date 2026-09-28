// 天气参考（对应原型 screens/Weather.tsx + 徒步天气概览设计文档 + 天相与 meteogram 设计）：
// 上半部分是客观指标（meteogram 时间坐标图 + 数字指标），下半部分是结论（天相判断）。
// 组织者可一键生成天气提醒草稿并跳到活动通知页。
//
// 数据来源：getWeather 返回 series（7×24 逐时）+ days（7 日）+ detail（所选日 24h）。
// 天文与天相判断全部在客户端算（utils/astro.js、utils/sky.js），云函数只负责取数。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')
const A = require('../../utils/astro')
const sky = require('../../utils/sky')
const RS = require('../../utils/route-schedule')

const SLOTS = ['06', '08', '10', '12', '14', '16', '18', '20']
const CHART_DAYS = 7
// 云函数只认 'YYYY-MM-DD'，任何进 getWeather 的日期都先过这道闸
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// 当日徒步提示：按优先级最多 2 条（规则表见设计文档 §5.2）
function buildCallouts(day, detail, elev) {
  const out = []
  if (Number(day.code) >= 95 || detail.some(h => Number(h.code) >= 95)) {
    out.push({ tone: 'danger', title: '有雷暴概率，不建议安排上山' })
  }
  const snowCode = Number(day.code) >= 71 && Number(day.code) <= 86
  if (snowCode || detail.some(h => Number.isFinite(h.freezing) && Number.isFinite(elev) && h.freezing < elev)) {
    out.push({ tone: 'danger', title: '0℃ 层低于此点，降水可能为雪' })
  }
  const inCloud = detail.some(h => h.band && Number.isFinite(elev) && h.band.base <= elev && elev <= h.band.top)
  if (detail.some(h => Number.isFinite(h.visibility) && h.visibility < 1) || inCloud) {
    out.push({ tone: 'warning', title: '此点可能入云（雾），观景窗口有限' })
  }
  // 云海窗口：清晨时段云层带压在低处、观景点在带顶之上、高层干净（准确率定位见设计文档 §5.3）
  const sea = detail.some(h => h.t <= '10' && h.band && Number.isFinite(elev)
    && elev > h.band.top && h.band.cover >= 80 && Number.isFinite(h.cloud.high) && h.cloud.high < 30)
  if (sea) out.push({ tone: 'success', title: '清晨云海概率较大' })
  const afternoonRain = day.precipProbMax >= 60
    && detail.some(h => h.t >= '12' && (h.pop >= 50 || Number(h.showers) > 0))
  if (afternoonRain) out.push({ tone: 'warning', title: '午后阵雨概率高，建议早点出发' })
  return out.slice(0, 2)
}

Page({
  data: {
    loading: true,
    denied: '',
    pointLabels: [],
    pointIndex: 0,
    date: '',
    dayCards: [],
    slots: [],
    callouts: [],
    detailRows: [],
    showDetail: false,
    updatedAt: '',
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
    // 天相结论
    conclusions: [],
    skyMoon: null,
    elevSource: '',
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.userPickedDate = false
    // 详情页途中节点「天气」入口带入的定位参数：point 仅首次消费，date 作为初始日期
    this.initialPoint = /^\d+$/.test(options.point || '') ? Number(options.point) : null
    this.initialDate = /^\d{4}-\d{2}-\d{2}$/.test(options.date || '') ? options.date : ''
  },

  onShow() {
    this.reload()
  },

  reload() {
    if (!this.activityId) {
      this.setData({ loading: false, denied: '缺少活动编号。' })
      return
    }
    return api.read({ kind: 'activity', activityId: this.activityId, perspective: 'participant' }).then(res => {
      if (res.view.kind !== 'activity') {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '活动不存在。' })
        return
      }
      this.revision = res.revision
      this.now = res.now
      this.view = res.view
      const a = res.view.activity
      const points = a.routeSnapshot.points
      // 按轨迹时间戳推算各节点抵达日程：第几天、几点到（无时间戳的节点给不出提醒）
      const sched = RS.schedule(points, a.startAt)
      const hasStart = !!a.startAt
      const pointIndex = Math.max(0, Math.min(this.pickInitialPoint(points.length), points.length - 1))
      // 日期必须在这一轮 setData 里一并落定。setData 的回调是异步的：若把日期放到回调里再设，
      // 紧随其后的 fetchWeather 会读到上一次的空日期，发出 date:''，云函数回"日期无效"。
      // 同理请求也放进回调，确保 this.data.date 已是最终值。
      const date = this.resolveDate(sched, pointIndex, this.userPickedDate ? this.data.date : '')
      this.setData({
        loading: false,
        denied: '',
        pointLabels: points.map((p, i) => {
          const s = sched[i]
          const label = s && s.known ? RS.nodeLabel(s) : ''
          return label ? p.name + '（' + label + '）' : p.name
        }),
        schedule: sched,
        scheduleBasis: RS.basisText(sched, hasStart),
        spanDays: RS.spanDays(sched),
        pointIndex,
        date,
        isOwner: res.view.permittedActions.indexOf('notice.publish') !== -1,
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

  // 已有返回体是否覆盖该日期。series 自带 7 天逐时，所以在窗口内切日/切节点不必再外呼。
  covers(result, date, pointId) {
    if (!result || result.pointId !== pointId) return false
    return (result.series || []).some(h => h.d === date) && (result.days || []).some(d => d.date === date)
  },

  fetchWeather() {
    const points = this.view.activity.routeSnapshot.points
    const point = points[this.data.pointIndex]
    if (!point) return
    const reset = {
      loadingWeather: true, dayCards: [], slots: [], callouts: [], metrics: null,
      detailRows: [], chartSeries: [], chartMarks: {}, chartNight: {},
      conclusions: [], skyMoon: null,
    }
    // 兜底：日期尚未落定时不外呼（云函数会回"日期无效"，那句话对用户没意义）。
    // resolveDate 兜底链必然产出合法日期，收敛一次即可，不会循环。
    if (!ISO_DATE.test(this.data.date)) {
      const date = this.resolveDate(this.data.schedule, this.data.pointIndex, '')
      this.setData({ date }, () => this.fetchWeather())
      return
    }
    this.setData(reset)
    // 窗口内复用：切日、切节点都不重新查询（30 分钟缓存内本来就零成本，这里连等待都没有）
    const cached = this._lastResult
    if (this.covers(cached, this.data.date, point.id)) {
      this.applyWeather(Object.assign({}, cached), point, reset)
      return
    }
    api.getWeather(this.activityId, point.id, this.data.date).then(result => {
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
    // 海拔优先用 GPX 节点高程（真实值），缺失时退回模型降尺度值并说明来源
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
    this.setData(Object.assign({}, reset, {
      loadingWeather: false,
      emptyTitle: '',
      emptyDetail: '',
      updatedAt: F.dtFull(result.updatedAt),
      dayCards: this.buildDayCards(result.days || [], point.coordinates),
      slots: this.buildSlots(detail),
      callouts: buildCallouts(day, detail, elevation),
      metrics: this.buildMetricsCard(detail, day, elevation, skyOut),
      detailRows: this.buildDetailRows(detail),
      elevSource: elevOK ? 'GPX 记录' : '模型降尺度（±300-600 m）',
      conclusions: skyOut ? skyOut.items : [],
      skyMoon: skyOut ? skyOut.moon : null,
      chartSeries: this.buildChartSeries(series, this.data.date),
      chartMarks: this.buildChartMarks(series, point.coordinates, elevation, elevOK, result.days || []),
      chartNight: this.buildNightMap(series, point.coordinates, elevation),
      chartSelected: { [this.data.date]: true },
    }))
  },

  // 节点的前进/山脊走向（用前后节点连线求方位角），供日照金山"往哪看"粗判
  headingAt(index) {
    const pts = this.view.activity.routeSnapshot.points
    const cur = pts[index]
    if (!cur || !cur.coordinates) return null
    const next = pts[index + 1] || pts[index - 1]
    if (!next || !next.coordinates) return null
    return sky.bearingBetween(cur.coordinates, next.coordinates)
  },

  // meteogram 序列：从所选日起取 7 天
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

  // 7 日概览条：从所选日起 7 天（与 meteogram 窗口对齐），并按节点高程给出日出日落
  buildDayCards(days, coords) {
    const first = this.data.date
    const picked = days.filter(d => d.date >= first).slice(0, CHART_DAYS)
    const list = picked.length >= CHART_DAYS ? picked : days.slice(0, CHART_DAYS)
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
        // 逐日的日出日落用本地天文算（按节点海拔修正），比模型日值更贴合观感
        sunrise: A.sunTimes(day.date, coords.lat, coords.lng, this.nodeElevation()).sunrise || day.sunrise,
        selected: day.date === this.data.date,
      }
    })
  },

  // 客观指标卡：只放数字，不做判断（判断统一交给下面的天相结论卡，避免两处口径打架）
  // 日出日落/暮光用本地天文算并按节点海拔修正；云量与云层带用云函数的气压层剖面结果。
  buildMetricsCard(detail, day, elev, skyOut) {
    const withBand = detail.filter(h => h.band && Number.isFinite(h.band.base) && Number.isFinite(h.band.top) && h.band.cover >= 80)
    let bandText = '无成层云带'
    if (withBand.length) {
      const baseMin = Math.min.apply(null, withBand.map(h => h.band.base))
      const topMax = Math.max.apply(null, withBand.map(h => h.band.top))
      bandText = '约 ' + Math.round(baseMin) + '–' + Math.round(topMax) + ' m'
    }
    const inBand = withBand.some(h => Number.isFinite(elev) && h.band.base <= elev && elev <= h.band.top)
    const sun = skyOut ? skyOut.sun : null
    const moon = skyOut ? skyOut.moon : null
    return {
      sunrise: (sun && sun.sunrise) || day.sunrise || '--',
      sunset: (sun && sun.sunset) || day.sunset || '--',
      astroDusk: (sun && sun.astroDusk) || '--',
      astroDawn: (sun && sun.astroDawn) || '--',
      low: day.cloud ? day.cloud.low : '--',
      mid: day.cloud ? day.cloud.mid : '--',
      high: day.cloud ? day.cloud.high : '--',
      bandText,
      inBand,
      moon: moon ? moon.name + ' · 月照 ' + moon.illumination + '%' : '--',
      elev: Number.isFinite(elev) ? Math.round(elev) : null,
    }
  },

  // 当前节点的可信海拔（GPX 优先），供逐日日出日落与图上标记复用
  nodeElevation() {
    const pts = this.view && this.view.activity.routeSnapshot.points
    const p = pts && pts[this.data.pointIndex]
    return p && Number.isFinite(p.ele) ? p.ele : null
  },

  addDays(iso, n) {
    return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
  },

  buildSlots(detail) {
    return detail
      .filter(h => SLOTS.indexOf(h.t) !== -1)
      .map(h => ({
        t: h.t,
        phrase: F.weatherPhrase(h.code),
        temp: Math.round(h.temp),
        pop: h.pop == null ? 0 : h.pop,
        wind: h.wind == null ? '—' : Math.round(h.wind),
      }))
  },

  buildDetailRows(detail) {
    return detail.map(h => ({
      t: h.t,
      phrase: F.weatherPhrase(h.code),
      temp: Math.round(h.temp),
      pop: h.pop == null ? 0 : h.pop,
      wind: h.wind == null ? '—' : Math.round(h.wind),
      visibility: h.visibility == null ? '—' : h.visibility,
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

  // meteogram 上点某小时 = 切到那一天
  onChartPickHour(e) {
    const date = e.detail && e.detail.date
    if (!date || date === this.data.date) return
    this.userPickedDate = true
    this.setData({
      date,
      chartSelected: { [date]: true },
      dayCards: this.data.dayCards.map(c => Object.assign({}, c, { selected: c.date === date })),
    }, () => this.fetchWeather())
  },

  toggleDetail() {
    this.setData({ showDetail: !this.data.showDetail })
  },

  // 生成天气提醒草稿：带上节点、抵达日与当天结论要点
  onDraftNotice() {
    const points = this.view.activity.routeSnapshot.points
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
})
