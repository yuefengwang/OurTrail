// 路线详情（V2.0）：地图 + 节点 + 风险 + 共享协作 + 被哪些活动使用 + 删除。
// 读取走云端 readRoutes(routeId)（selectors 投影）；写入走 route.update（共享名单）
// 与 route.delete（删除前服务端查活动引用，被引用时回 CONFLICT）。
//
// 地图装配复用 activity.js 的既定画法（GCJ-02、track 实线/多点虚线、marker PNG、
// include-points 外扩 8% 留白）——此处是第二个消费方，先照抄保持行为一致；
// 若出现第三个消费方再提取共享模块（现在提取会动到活动详情这个最关键页面）。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const RS = require('../../utils/route-schedule')

const MARKER_ICONS = {
  start: '/assets/markers/start.png',
  checkpoint: '/assets/markers/checkpoint.png',
  finish: '/assets/markers/finish.png',
}
const MARKER_SIZE = 22

function buildRouteMap(route) {
  const points = route.points || []
  const located = points.filter(p => p.coordinates)
  const markers = located.map((p, i) => ({
    id: i,
    latitude: p.coordinates.lat,
    longitude: p.coordinates.lng,
    iconPath: MARKER_ICONS[p.kind] || MARKER_ICONS.checkpoint,
    width: MARKER_SIZE,
    height: MARKER_SIZE,
    anchor: { x: 0.5, y: 0.5 },
    label: { content: String(points.indexOf(p) + 1), color: '#163E35', bgColor: '#FFFFFF', borderRadius: 8, padding: 3, fontSize: 10, anchorX: 11, anchorY: -20, textAlign: 'center' },
    callout: {
      content: (p.kind === 'start' ? '起点 · ' : p.kind === 'finish' ? '终点 · ' : '') + p.name,
      color: '#163E35', bgColor: '#FFFFFF', borderRadius: 8, borderWidth: 1, borderColor: '#DEE3DB',
      padding: 7, fontSize: 12, display: 'BYTAP',
    },
  }))
  if (!markers.length) return { visible: false }
  const track = (route.track || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const polyline = []
  if (track.length >= 2) {
    polyline.push({ points: track.map(p => ({ latitude: p.lat, longitude: p.lng })), color: '#163E35AA', width: 4, arrowLine: true })
  } else if (markers.length >= 2) {
    polyline.push({ points: markers.map(m => ({ latitude: m.latitude, longitude: m.longitude })), color: '#8C9791AA', width: 2, dottedLine: true })
  }
  const lats = markers.map(m => m.latitude)
  const lngs = markers.map(m => m.longitude)
  const latMin = Math.min.apply(null, lats)
  const latMax = Math.max.apply(null, lats)
  const lngMin = Math.min.apply(null, lngs)
  const lngMax = Math.max.apply(null, lngs)
  const padLat = (latMax - latMin || 0.01) * 0.08
  const padLng = (lngMax - lngMin || 0.01) * 0.08
  return {
    visible: true,
    markers,
    polyline,
    includePoints: [
      { latitude: latMin - padLat, longitude: lngMin - padLng },
      { latitude: latMax + padLat, longitude: lngMax + padLng },
    ],
    latitude: (latMin + latMax) / 2,
    longitude: (lngMin + lngMax) / 2,
    scale: 13,
  }
}

const SOURCE_LABELS = { gpx: 'GPX 导入', manual: '手工整理', copy: '活动沉淀' }
const SEVERITY_LABELS = { low: '留意', mid: '重要', high: '高危' }
const SEVERITY_BADGES = { low: 'neutral', mid: 'warning', high: 'danger' }

// 协作码缩略：与 me 页身份码同口径（前 4 + … + 后 4），完整值只在输入时出现
function abbreviate(code) {
  const s = String(code || '')
  return s.length <= 12 ? s : s.slice(0, 4) + '…' + s.slice(-4)
}

// 北京时间今天（与云端天气窗口同基准：今天 → +14 天）
function todayCn() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}
function plusDays(dateStr, n) {
  const t = Date.parse(dateStr + 'T00:00:00Z') + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

Page({
  data: {
    loading: true,
    denied: '',
    route: null,
    isOwner: false,
    map: { visible: false },
    referenced: [],
    // 分段天气（V2.0 §6）
    wxDate: todayCn(),
    wxDateMax: plusDays(todayCn(), 14),
    scheduleMode: false,
    startDate: '',
    startTime: '',
    weatherBusy: false,
    weatherError: '',
    nodeWeather: [],
    // 共享管理
    shareOpen: false,
    shareCode: '',
    shareError: '',
    shareBusy: false,
    removeId: '',
    deleteOpen: false,
    busy: false,
    error: '',
  },

  onLoad(options) {
    this.routeId = options.id || ''
  },

  onShow() {
    // onShow 而不是 onLoad（与 routes.js 同型）：route-edit 保存成功后 navigateBack 回本页，
    // 详情要反映改动后的标题、节点与风险；只挂 onLoad 会让「写成功」和「界面反馈」断成两截。
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  reload() {
    if (!this.routeId) {
      this.setData({ loading: false, denied: '缺少路线标识。' })
      return Promise.resolve()
    }
    // 路线 + 我的活动并行读：referencedActivityIds 只有 id，标题从 home 视图取
    // （organizer 视角含全部自管活动；共享路线被协作者查看时标题缺失，
    //  那一行降级显示「活动 »」而不是编一个标题）。
    return Promise.all([
      api.readRoutes(this.routeId),
      api.read({ kind: 'home', perspective: 'organizer', openedActivityIds: [] }).catch(() => null),
    ]).then(([res, home]) => {
      const route = res.route
      const titles = {}
      if (home && home.view && home.view.kind === 'home') {
        for (const a of home.view.activities) titles[a.id] = a.title || '未命名活动'
      }
      this.revision = res.revision
      this.setData({
        loading: false,
        denied: '',
        route: Object.assign({}, route, {
          sourceText: SOURCE_LABELS[route.source] || route.source,
          difficultyLabel: F.difficultyLabel(route.difficulty),
          updatedText: route.updatedAt ? F.dateLabel(route.updatedAt) : '早期路线',
          risks: (route.risks || []).map(r => Object.assign({}, r, {
            severityText: SEVERITY_LABELS[r.severity] || '',
            severityBadge: SEVERITY_BADGES[r.severity] || 'neutral',
          })),
        }),
        // isOwner 由服务端投影显式给出（selectors.routeView）：协作者读不到
        // sharedWith 名单， owner-only 的 UI（共享管理/删除）据此显隐。
        isOwner: !!route.isOwner,
        map: buildRouteMap(route),
        referenced: (res.referencedActivityIds || []).map(id => ({ id, title: titles[id] || '' })),
        shareCode: '',
        shareError: '',
      })
      // 路线一到手就查当天的分段天气（失败只在天气卡内提示，不翻整页）
      this.loadNodeWeather()
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  // ---- 分段天气（V2.0 §6：按节点看天气，可选按出发时刻推算各节点抵达日）----
  // 复用 getWeatherByPoint（纯坐标，免活动语义）：路线节点坐标是 GCJ-02，
  // 云端 resolvePointQuery 自己纠偏，这里原样传。
  onWeatherDate(e) {
    this.setData({ wxDate: e.detail.value })
    this.loadNodeWeather()
  },
  onScheduleMode(e) {
    const on = e.detail.value.length > 0
    this.setData({ scheduleMode: on })
    if (on && !this.data.startDate) {
      // 默认出发=所选日期当天 08:00（常见晨出发），用户可改
      this.setData({ startDate: this.data.wxDate, startTime: '08:00' })
    }
    this.loadNodeWeather()
  },
  onStartDate(e) {
    this.setData({ startDate: e.detail.value })
    this.loadNodeWeather()
  },
  onStartTime(e) {
    this.setData({ startTime: e.detail.value })
    this.loadNodeWeather()
  },
  // 各节点的目标日期：推算模式且该节点有时间戳 ⇒ 它的抵达日；否则用统一所选日期
  nodeTargetDates() {
    const route = this.data.route
    const sched = RS.schedule(route.points || [], this.startAtOrNull())
    const byId = {}
    for (const s of sched) byId[s.id] = s
    return (route.points || []).map(p => {
      const s = byId[p.id]
      const arriveDate = this.data.scheduleMode && s && s.arriveDate ? s.arriveDate : null
      return { point: p, arriveDate, label: s ? RS.nodeLabel(s) : '' }
    })
  },
  startAtOrNull() {
    if (!this.data.scheduleMode || !this.data.startDate || !this.data.startTime) return null
    return this.data.startDate + 'T' + this.data.startTime + ':00+08:00'
  },
  loadNodeWeather() {
    const route = this.data.route
    if (!route) return Promise.resolve()
    const targets = this.nodeTargetDates()
    const rows = targets.map(t => ({
      id: t.point.id,
      name: t.point.name,
      arriveLabel: this.data.scheduleMode ? t.label : '',
      targetDate: t.arriveDate || this.data.wxDate,
      status: t.point.coordinates ? 'pending' : 'no-coords',
    }))
    this.setData({ nodeWeather: rows, weatherBusy: true, weatherError: '' })
    // 逐节点按各自的目标日期查（坐标按 id 从 route 找回，rows 不携带坐标）
    const byId = {}
    for (const p of route.points || []) byId[p.id] = p
    const real = rows.filter(r => r.status === 'pending').map(r => {
      const p = byId[r.id]
      return api.getWeatherByPoint(p.coordinates.lat, p.coordinates.lng, r.targetDate)
        .then(res => {
          const day = (res && res.days || []).find(d => d.date === r.targetDate)
          if (!res || res.status !== 'ready' || !day) {
            return Object.assign({}, r, { status: res && res.status === 'out_of_range' ? 'out-of-range' : 'failed' })
          }
          const phrase = F.weatherPhrase(day.code)
          return Object.assign({}, r, {
            status: 'ready',
            phrase: phrase.label,
            tone: phrase.tone,
            tMin: day.tMin,
            tMax: day.tMax,
            precip: day.precipSum,
            precipProb: day.precipProbMax,
            wind: day.windMax,
          })
        })
        .catch(() => Object.assign({}, r, { status: 'failed' }))
    })
    return Promise.all(real).then(done => {
      const merged = rows.map(r => done.find(d => d.id === r.id) || r)
      this.setData({ nodeWeather: merged, weatherBusy: false })
    }).catch(() => this.setData({ weatherBusy: false, weatherError: '天气查询失败，请稍后重试。' }))
  },

  onOpenActivity(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/activity/activity?id=' + id })
  },

  // ---- 共享协作（仅 owner）----
  onShareOpen() {
    this.setData({ shareOpen: true, shareCode: '', shareError: '' })
  },
  onShareClose() {
    this.setData({ shareOpen: false, shareCode: '', shareError: '' })
  },
  onShareCode(e) {
    this.setData({ shareCode: (e.detail.value || '').trim(), shareError: '' })
  },
  onShareAdd() {
    const code = this.data.shareCode
    if (!code) {
      this.setData({ shareError: '先填写对方的协作码（对方在「我的」页顶部可以看到）。' })
      return
    }
    const route = this.data.route
    const sharedWith = (route.sharedWith || []).slice()
    if (sharedWith.indexOf(code) !== -1) {
      this.setData({ shareError: '这条路线已经共享给这位协作者了。' })
      return
    }
    this.setData({ shareBusy: true, shareError: '' })
    // route.update 是全量替换：把现有名单 + 新成员一起提交（sharedWith 缺省即清空，
    // 所以这里必须带上原名单，不能只发新增的那一个）。
    this.persistShare(sharedWith.concat([code]), '已共享给 ' + abbreviate(code))
  },
  onRemoveAsk(e) {
    this.setData({ removeId: e.currentTarget.dataset.id })
  },
  onRemoveCancel() {
    this.setData({ removeId: '' })
  },
  onRemoveConfirm() {
    const route = this.data.route
    const sharedWith = (route.sharedWith || []).filter(id => id !== this.data.removeId)
    this.setData({ removeId: '' })
    this.persistShare(sharedWith, '已取消共享')
  },
  persistShare(sharedWith, doneMessage) {
    const route = this.data.route
    const input = {
      title: route.title,
      distanceKm: route.distanceKm,
      ascentM: route.ascentM,
      points: route.points,
      risks: route.risks,
      track: route.track,
      sharedWith,
    }
    return api.dispatchAndSync({ type: 'route.update', routeId: this.routeId, input }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ shareBusy: false, shareOpen: false, error: '' })
        api.toast(doneMessage)
        return this.reload()
      })
      .catch(e => {
        this.setData({ shareBusy: false, shareError: api.errorText(e) })
      })
  },

  // ---- 编辑（仅 owner）：路由到路线编辑器 ----
  onEdit() {
    wx.navigateTo({ url: '/pages/route-edit/route-edit?id=' + this.routeId })
  },
  onWeatherPlan() {
    wx.navigateTo({ url: '/pages/weather-plan/weather-plan?route=' + encodeURIComponent(this.routeId) })
  },

  // ---- 用这条路发起活动（仅 owner）：编辑器带 routeId 预填 ----
  // 协作者看不到这个按钮：域层 activity.create 校验 routeId 必须属于发起者本人。
  onCreateActivity() {
    wx.navigateTo({ url: '/pages/editor/editor?routeId=' + this.routeId })
  },

  // ---- 删除（仅 owner；被活动引用时服务端回 CONFLICT）----
  onDeleteAsk() {
    this.setData({ deleteOpen: true, error: '' })
  },
  onDeleteCancel() {
    this.setData({ deleteOpen: false })
  },
  onDeleteConfirm() {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    return api.dispatchAndSync({ type: 'route.delete', routeId: this.routeId }, this.revision, this)
      .then(() => {
        this.setData({ busy: false, deleteOpen: false })
        api.toast('路线已删除')
        wx.navigateBack()
      })
      .catch(e => {
        // CONFLICT（被活动引用）等业务拒绝：留在页面上说清楚，不关对话框
        this.setData({ busy: false, error: api.errorText(e) })
      })
  },
})
