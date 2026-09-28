// 天气参考（对应原型 screens/Weather.tsx + 徒步天气概览设计文档）：
// 7 日概览条 + 当日徒步提示（云层带/降雪/雷暴转译）+ 分时段摘要 + 逐小时明细。
// 组织者可一键生成天气提醒草稿并跳到活动通知页。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')

const SLOTS = ['06', '08', '10', '12', '14', '16', '18', '20']

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
      const date = this.userPickedDate || this.data.date || this.initialDate
        || (a.startAt ? F.cnParts(a.startAt).date : F.cnToday())
      let pointIndex = this.data.pointIndex
      if (this.initialPoint !== null && this.initialPoint !== undefined) {
        pointIndex = this.initialPoint
        this.initialPoint = null // 只消费一次，后续 onShow 不再拉回
      }
      this.setData({
        loading: false,
        denied: '',
        pointLabels: points.map(p => p.name),
        pointIndex: Math.min(pointIndex, Math.max(0, points.length - 1)),
        date,
        isOwner: res.view.permittedActions.indexOf('notice.publish') !== -1,
      })
      if (points.length) this.fetchWeather()
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  fetchWeather() {
    const points = this.view.activity.routeSnapshot.points
    const point = points[this.data.pointIndex]
    if (!point) return
    this.setData({ loadingWeather: true, dayCards: [], slots: [], callouts: [], seaCard: null, detailRows: [] })
    api.getWeather(this.activityId, point.id, this.data.date).then(result => {
      if (result.status !== 'ready') {
        this.setData({
          loadingWeather: false,
          dayCards: [], slots: [], callouts: [], seaCard: null, detailRows: [],
          emptyTitle: result.status === 'out_of_range' ? '暂不展示天气数字' : '天气暂不可用',
          emptyDetail: result.status === 'out_of_range'
            ? '所选日期超出今天起14天的预报范围。请保留日期，临近出发再核实。'
            : result.message || '请稍后重试。',
        })
        return
      }
      const detail = result.detail || []
      const day = (result.days || []).find(x => x.date === this.data.date) || {}
      this.setData({
        loadingWeather: false,
        emptyTitle: '',
        emptyDetail: '',
        updatedAt: F.dtFull(result.updatedAt),
        dayCards: this.buildDayCards(result.days || []),
        slots: this.buildSlots(detail),
        callouts: buildCallouts(day, detail, result.pointElevation),
        seaCard: this.buildSeaCard(detail, day, result.pointElevation),
        detailRows: this.buildDetailRows(detail),
      })
    }).catch(e => this.setData({
      loadingWeather: false, dayCards: [], slots: [], callouts: [], seaCard: null, detailRows: [],
      emptyTitle: '天气暂不可用', emptyDetail: api.errorText(e),
    }))
  },

  buildDayCards(days) {
    const today = F.cnToday()
    return days.slice(0, 7).map(day => {
      let label = '周' + F.WEEK[new Date(day.date + 'T12:00:00+08:00').getUTCDay()]
      if (day.date === today) label = '今'
      else if (day.date === this.addDays(today, 1)) label = '明'
      const md = day.date.slice(5, 10).split('-')
      return {
        date: day.date,
        label,
        dateLabel: Number(md[0]) + '/' + Number(md[1]),
        phrase: F.weatherPhrase(day.code),
        tMax: day.tMax,
        tMin: day.tMin,
        precipProbMax: day.precipProbMax,
        selected: day.date === this.data.date,
      }
    })
  },

  // 云海与日照：日出日落 + 三层日均云量 + 云层带范围 + 结论（概率语言，设计文档 §5.3）
  buildSeaCard(detail, day, elev) {
    const withBand = detail.filter(h => h.band && Number.isFinite(h.band.base) && Number.isFinite(h.band.top) && h.band.cover >= 80)
    let bandText = '数据不足'
    if (withBand.length) {
      const baseMin = Math.min.apply(null, withBand.map(h => h.band.base))
      const topMax = Math.max.apply(null, withBand.map(h => h.band.top))
      bandText = '约 ' + Math.round(baseMin) + '–' + Math.round(topMax) + ' m'
    }
    const inBand = detail.some(h => h.band && Number.isFinite(elev) && h.band.base <= elev && elev <= h.band.top)
    const seaHours = detail.filter(h => h.t <= '10' && h.band && Number.isFinite(elev)
      && elev > h.band.top && h.band.cover >= 80 && Number.isFinite(h.cloud.high) && h.cloud.high < 30)
    let seaText = '清晨云海需要云层压得低、此点在云上——今天条件一般'
    let seaTone = ''
    if (seaHours.length) {
      seaText = '清晨 ' + seaHours[0].t + '–' + seaHours[seaHours.length - 1].t + ' 云海概率较大，此点在云带上方'
      seaTone = 'success'
    } else if (inBand) {
      seaText = '此点大概率在云层带内，以雾中行进为主，看云海机会低'
      seaTone = 'warning'
    }
    return {
      sunrise: day.sunrise || '—',
      sunset: day.sunset || '—',
      low: day.cloud ? day.cloud.low : '—',
      mid: day.cloud ? day.cloud.mid : '—',
      high: day.cloud ? day.cloud.high : '—',
      bandText,
      seaText,
      seaTone,
      elev: Number.isFinite(elev) ? Math.round(elev) : null,
    }
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

  onPoint(e) {
    this.setData({ pointIndex: Number(e.detail.value) }, () => this.fetchWeather())
  },

  onDate(e) {
    this.userPickedDate = true
    this.setData({ date: e.detail.value }, () => this.fetchWeather())
  },

  // 7 日概览条：点击某天 = 切日期重查（30 分钟缓存内零成本）
  onDayTap(e) {
    const date = e.currentTarget.dataset.date
    if (!date || date === this.data.date) return
    this.userPickedDate = true
    this.setData({
      date,
      dayCards: this.data.dayCards.map(c => Object.assign({}, c, { selected: c.date === date })),
    }, () => this.fetchWeather())
  },

  toggleDetail() {
    this.setData({ showDetail: !this.data.showDetail })
  },

  onDraftNotice() {
    const points = this.view.activity.routeSnapshot.points
    const point = points[this.data.pointIndex]
    draft.setDraft(this.activityId, 'notice', {
      content: this.data.date + ' ' + (point ? point.name : '') + ' 天气提醒：出发前请核实当地预报与路况，准备防滑鞋与雨具。',
    })
    wx.navigateTo({ url: '/pages/anotices/anotices?id=' + this.activityId })
  },
})
