'use strict'

const api = require('../../utils/api')
const draft = require('../../utils/draft')
const WP = require('../../utils/watch-points')
const Plans = require('../../utils/weather-plans')
const F = require('../../utils/format')
const store = Plans.createStore(draft.durableStorage)
const tracks = WP.createWatchPoints(draft.durableStorage)

Page({
  data: {
    loading: true, denied: '', error: '', busy: false, editing: false, plan: null,
    rows: [], days: [], pointOptions: [], browseDate: '', browseTime: '09:00',
    dayOptions: Array.from({ length: 30 }, (_, index) => '第 ' + (index + 1) + ' 天'),
    routeChanged: false, sourceNote: '', saved: false, addOpen: false, editDay: 1,
  },

  onLoad(options) {
    this.options = options || {}
    this.planId = this.options.plan || ''
    this.setData({ browseDate: F.cnToday() })
  },
  onShow() { if (!this.data.editing) this.reload() },
  onUnload() { this._token = (this._token || 0) + 1 },

  async reload() {
    const token = this._token = (this._token || 0) + 1
    this.setData({ loading: true, denied: '', error: '' })
    try {
      const saved = this.planId ? store.get(this.planId) : this.plan || null
      if (this.planId && !saved) throw new Error('行程已被删除，请返回天气首页重新选择。')
      const source = saved ? saved.source : this.sourceFromOptions()
      const context = await this.readSource(source)
      if (token !== this._token) return
      this.routeAsset = context.route
      this.plan = saved || Plans.createPlan(this.routeAsset, context.source || source, context.startAt)
      if (!this.plan.visits.length) throw new Error('路线还没有关键节点，请先在路线库补充节点。')
      this.setData({
        loading: false, plan: this.plan, saved: !!this.planId,
        pointOptions: this.routeAsset.points.map(point => ({ id: point.id, name: point.name || '路线节点' })),
        routeChanged: !!saved && !!this.routeAsset.updatedAt && saved.routeUpdatedAt !== this.routeAsset.updatedAt,
        sourceNote: this.plan.source.kind === 'local' ? '本机轨迹 · 行程仅保存在本机' : this.plan.source.kind === 'activity' ? '活动当前路线快照 · 未取得路线库原件权限，不冒充最新原件；个人计划不回写活动' : '共用路线库 · 个人行程仅保存在本机，不回写活动',
      })
      this.renderRows()
      this.queryRows()
    } catch (err) {
      if (token === this._token) this.setData({ loading: false, denied: api.errorText(err), rows: [], days: [] })
    }
  },

  sourceFromOptions() {
    if (this.options.route) return { kind: 'route', id: this.options.route }
    if (this.options.activity) return { kind: 'activity', id: this.options.activity }
    if (this.options.set) return { kind: 'local', id: this.options.set }
    throw new Error('缺少路线来源，请返回天气首页重新选择。')
  },

  async readSource(source) {
    if (source.kind === 'local') {
      const route = tracks.getTrack(source.id)
      if (!route) throw new Error('本机轨迹已删除，请返回天气首页重新导入。')
      return { route }
    }
    if (source.kind === 'route') {
      const response = await api.readRoutes(source.id)
      if (!response.route) throw new Error('路线不存在或已失去访问权限，缓存不能替代最新路线。')
      return { route: response.route }
    }
    const response = await api.read({ kind: 'activity', activityId: source.id, perspective: 'participant' })
    if (!response.view || response.view.kind !== 'activity') throw new Error('活动不存在或没有查看权限。')
    const activity = response.view.activity
    if (activity.routeId) {
      try {
        const context = await this.readSource({ kind: 'route', id: activity.routeId })
        return { route: context.route, source: { kind: 'route', id: activity.routeId }, startAt: activity.startAt }
      } catch (error) {
        if (error.code !== 'FORBIDDEN' && error.code !== 'NOT_FOUND') throw error
      }
    }
    return { route: activity.routeSnapshot, startAt: activity.startAt }
  },

  renderRows() {
    const rows = Plans.resolveVisits(this.plan, this.routeAsset, { date: this.data.browseDate, time: this.data.browseTime })
    const days = []
    rows.forEach(row => {
      let day = days.find(item => item.day === row.day)
      if (!day) { day = { day: row.day, label: row.dayLabel, date: Plans.addDays(this.plan.startDate, row.day - 1), visits: [] }; days.push(day) }
      day.visits.push(row)
    })
    this.setData({ plan: this.plan, rows, days })
  },

  async queryRows() {
    const token = this._token = (this._token || 0) + 1
    const rows = this.data.rows.map(row => Object.assign({}, row))
    let cursor = 0
    const cache = new Map()
    const run = async () => {
      while (cursor < rows.length && token === this._token) {
        const row = rows[cursor++]
        if (!row.available) continue
        const offset = Math.round((Date.parse(row.date + 'T00:00:00+08:00') - Date.parse(F.cnToday() + 'T00:00:00+08:00')) / 86400000)
        if (offset < 0 || offset > 14) { row.weather = { ready: false, text: '此日期不在可查询预报范围内，临近出行再查。' }; continue }
        const key = row.coordinates.lat + ',' + row.coordinates.lng + '@' + row.date
        if (!cache.has(key)) cache.set(key, api.getWeatherByPoint(row.coordinates.lat, row.coordinates.lng, row.date).then(result => ({ result }), error => ({ error })))
        const outcome = await cache.get(key)
        row.weather = outcome.error ? { ready: false, text: api.errorText(outcome.error) } : Plans.hourlySummary(outcome.result, row.date, row.time)
        if (token !== this._token) return
        this.paintWeather(rows)
      }
    }
    this.setData({ busy: true })
    await Promise.all([run(), run(), run()])
    if (token === this._token) { this.paintWeather(rows); this.setData({ busy: false }) }
  },

  paintWeather(rows) {
    const days = this.data.days.map(day => Object.assign({}, day, { visits: rows.filter(row => row.day === day.day) }))
    this.setData({ rows, days })
  },

  onBrowseDate(event) { this.setData({ browseDate: event.detail.value }); this.renderRows(); this.queryRows() },
  onBrowseTime(event) { this.setData({ browseTime: event.detail.value }); this.renderRows(); this.queryRows() },
  onRetry() { this.renderRows(); this.queryRows() },
  onBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/weather-hub/weather-hub' }) }) },

  onNode(event) {
    const row = this.data.rows.find(item => item.id === event.currentTarget.dataset.id)
    if (!row || !row.available) return
    let url = '/pages/weather/weather?src=local&lat=' + row.coordinates.lat + '&lng=' + row.coordinates.lng + '&name=' + encodeURIComponent(row.name) + '&date=' + row.date + '&time=' + row.time
    if (this.plan.source.kind === 'route') url = '/pages/weather/weather?route=' + encodeURIComponent(this.plan.source.id) + '&node=' + encodeURIComponent(row.pointId) + '&date=' + row.date + '&time=' + row.time
    if (this.plan.source.kind === 'activity') url = '/pages/weather/weather?id=' + encodeURIComponent(this.plan.source.id) + '&node=' + encodeURIComponent(row.pointId) + '&date=' + row.date + '&time=' + row.time
    const elevation = row.point.ele
    if (Number.isFinite(elevation)) url += '&ele=' + elevation + '&eleSrc=' + (row.point.eleSource || 'gpx')
    wx.navigateTo({ url })
  },

  onEdit() {
    this._token = (this._token || 0) + 1
    this._beforeEdit = JSON.stringify(this.plan)
    this.setData({ editing: true, busy: false, error: '', editDay: 1 })
    if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '行程编辑尚未保存，离开会丢失本次修改。' })
  },
  onEditDay(event) { this.setData({ editDay: Number(event.detail.value) + 1 }) },
  onName(event) { this.plan.name = event.detail.value; this.setData({ plan: this.plan }) },
  onStartDate(event) { this.plan.startDate = event.detail.value; this.setData({ plan: this.plan }) },
  onVisit(event) {
    const visit = this.plan.visits.find(item => item.id === event.currentTarget.dataset.id)
    if (!visit) return
    const field = event.currentTarget.dataset.field
    if (field === 'day') visit.day = Number(event.detail.value) + 1
    if (field === 'time') visit.time = event.detail.value
    if (field === 'pointId') {
      const point = this.routeAsset.points[Number(event.detail.value)]
      if (point) { visit.pointId = point.id; visit.name = point.name }
    }
    this.renderRows()
  },
  onVisitAction(event) {
    const index = this.plan.visits.findIndex(item => item.id === event.currentTarget.dataset.id)
    if (index < 0) return
    const action = event.currentTarget.dataset.action
    const visit = this.plan.visits[index]
    if (action === 'clear') visit.time = ''
    if (action === 'departure') visit.departure = !visit.departure
    if (action === 'remove') this.plan.visits.splice(index, 1)
    if (action === 'up' && index > 0) this.plan.visits.splice(index - 1, 0, this.plan.visits.splice(index, 1)[0])
    if (action === 'down' && index < this.plan.visits.length - 1) this.plan.visits.splice(index + 1, 0, this.plan.visits.splice(index, 1)[0])
    this.renderRows()
  },
  onAddOpen() { this.setData({ addOpen: true }) },
  onAddClose() { this.setData({ addOpen: false }) },
  onAdd(event) {
    if (this.plan.visits.length >= Plans.MAX_VISITS) { api.toast('每个行程最多 40 次经过'); return }
    const point = this.routeAsset.points.find(item => item.id === event.currentTarget.dataset.id)
    if (!point) return
    this.plan.visits.push(Object.assign(Plans.newVisit(point), { day: this.data.editDay }))
    this.renderRows()
    this.setData({ addOpen: false })
  },
  onCancelEdit() {
    const cancel = () => {
      this.plan = JSON.parse(this._beforeEdit)
      this.setData({ editing: false, error: '' })
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
      this.renderRows(); this.queryRows()
    }
    if (JSON.stringify(this.plan) === this._beforeEdit) return cancel()
    wx.showModal({ title: '放弃本次修改？', content: '已保存的行程不会改变。', success: response => { if (response.confirm) cancel() } })
  },
  onSave() {
    if (Plans.resolveVisits(this.plan, this.routeAsset, { date: this.data.browseDate, time: this.data.browseTime }).some(visit => !visit.available)) {
      this.setData({ error: '有路线节点已删除或缺少坐标，请先替换或移除对应经过，再保存。' })
      return
    }
    this.plan.routeUpdatedAt = this.routeAsset.updatedAt || ''
    const result = store.save(this.plan)
    if (!result.ok) { this.setData({ error: result.error }); return }
    this.plan = result.plan; this.planId = this.plan.id
    this.setData({ editing: false, saved: true, routeChanged: false, error: '' })
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
    this.renderRows(); this.queryRows()
    api.toast('行程已保存到本机')
  },
  onCopy() {
    this.plan = JSON.parse(JSON.stringify(this.plan))
    this.plan.id = Plans.newId('plan')
    this.plan.name += ' · 副本'
    this.planId = ''
    this.plan.visits = this.plan.visits.map(visit => Object.assign({}, visit, { id: Plans.newId('visit') }))
    this.setData({ saved: false, plan: this.plan })
    this.onEdit()
  },
})
