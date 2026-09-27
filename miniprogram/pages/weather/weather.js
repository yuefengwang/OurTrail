// 天气参考（对应原型 screens/Weather.tsx）：按路线关键点 + 日期查真实预报。
// 组织者可一键生成天气提醒草稿并跳到活动通知页。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')

Page({
  data: {
    loading: true,
    denied: '',
    pointLabels: [],
    pointIndex: 0,
    date: '',
    hours: [],
    updatedAt: '',
    notice: '',
    emptyTitle: '',
    emptyDetail: '',
    isOwner: false,
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.userPickedDate = false
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
      const date = this.userPickedDate || this.data.date
        || (a.startAt ? F.cnParts(a.startAt).date : F.cnToday())
      this.setData({
        loading: false,
        denied: '',
        pointLabels: points.map(p => p.name),
        pointIndex: Math.min(this.data.pointIndex, Math.max(0, points.length - 1)),
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
    this.setData({ loadingWeather: true })
    api.getWeather(this.activityId, point.id, this.data.date).then(result => {
      if (result.status === 'ready') {
        this.setData({
          loadingWeather: false,
          hours: result.hours.map(h => ({
            at: F.hhmm(h.at),
            temperature: h.temperature,
            precipitation: h.precipitation,
            wind: h.wind,
          })),
          updatedAt: F.dtFull(result.updatedAt),
          emptyTitle: '',
          emptyDetail: '',
        })
      } else if (result.status === 'out_of_range') {
        this.setData({
          loadingWeather: false,
          hours: [],
          emptyTitle: '暂不展示天气数字',
          emptyDetail: '所选日期超出今天起14天的预报范围。请保留日期，临近出发再核实。',
        })
      } else {
        this.setData({
          loadingWeather: false,
          hours: [],
          emptyTitle: '天气暂不可用',
          emptyDetail: result.message || '请稍后重试。',
        })
      }
    }).catch(e => this.setData({ loadingWeather: false, hours: [], emptyTitle: '天气暂不可用', emptyDetail: api.errorText(e) }))
  },

  onPoint(e) {
    this.setData({ pointIndex: Number(e.detail.value) }, () => this.fetchWeather())
  },

  onDate(e) {
    this.userPickedDate = true
    this.setData({ date: e.detail.value }, () => this.fetchWeather())
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
