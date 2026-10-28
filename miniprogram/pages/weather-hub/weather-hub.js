// 天气模块（Tab）：屏 1 选源首页 + 屏 2 四视图详情（方案 A，底栏常驻）。
//
// 平台约束（实施文档 §4.3）：switchTab 不能带 query，屏内上下文只能走内存；
// 因此详情不是一页，而是本页的 `screen` 状态 + 共享详情组件。
// 活动 / 分享链接的深链仍走 pages/weather（独立页、无底栏），这里不复制那条路径。
//
// 观察点 / 轨迹组仍是本地数据（watch-points + draft.wxStorage）；个人计划走云端 ot_plans。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const gpx = require('../../utils/gpx')
const WP = require('../../utils/watch-points')
const RS = require('../../utils/route-schedule')
const PL = require('../../utils/weather-plans')
const F = require('../../utils/format')

const wpStore = WP.createWatchPoints(draft.wxStorage)

Page({
  data: {
    // 屏：home（选源）/ detail（四视图）
    screen: 'home',
    homeTab: 'plans',

    points: [],
    tracks: [],
    trackOpen: {},

    plans: [],
    sharedPlans: [],
    plansState: 'loading', // loading | ready | error | denied
    plansError: '',
    lastPlan: null,

    routes: [],
    routesState: 'idle',

    place: null,
    initial: {},
    planId: '',
    placeOpen: false,
    placeList: [],
    placeQuery: '',

    // 手动输入经纬度（沿用既有行为）
    manualOpen: false,
    manual: { name: '', lat: '', lng: '', ele: '', wgs: false },
    manualError: '',

    // GPX 导入（沿用既有行为：预览删除 / 恢复 / 存为轨迹组）
    gpxOpen: false,
    gpxError: '',
    gpxMeta: null,
    gpxPoints: [],

    deleteOpen: false,
    deleteInfo: null,
  },

  onLoad() {
    this._routes = []
    this._opened = false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.setData({ points: this.decoratePoints(wpStore.listPoints()), tracks: this.decorateTracks(wpStore.listTracks()) })
    this.loadPlans()
    if (this.data.homeTab === 'routes') this.loadRoutes()
  },

  /* ---------- 资产 ---------- */

  decoratePoints(list) {
    return list.map(p => ({
      id: p.id,
      name: p.name,
      display: p.name || WP.coordName(p.lat, p.lng),
      subText: WP.coordName(p.lat, p.lng) + (Number.isFinite(p.ele) ? ' · ' + Math.round(p.ele) + ' m' : ''),
      lat: p.lat,
      lng: p.lng,
      ele: p.ele,
      eleSource: p.eleSource,
    }))
  },

  decorateTracks(list) {
    return list.map(t => {
      const sched = RS.schedule(t.points || [], null)
      const nodes = (t.points || []).map((p, i) => ({
        id: p.id,
        name: p.name || (i === 0 ? '起点' : i === (t.points.length - 1) ? '终点' : '节点 ' + i),
        label: sched[i] && sched[i].known ? RS.nodeLabel(sched[i]) : '无时间信息',
      }))
      const s = t.stats || {}
      return {
        id: t.id,
        name: t.name,
        statsText: s.count + ' 个节点'
          + (s.distanceKm ? ' · 约 ' + s.distanceKm + ' km' : '')
          + (s.ascentM ? ' · 爬升约 ' + s.ascentM + ' m' : '')
          + (s.hasTime ? ' · 含时刻' : ''),
        nodes,
      }
    })
  },

  loadPlans() {
    this.setData({ plansState: 'loading' })
    PL.listPlans().then(res => {
      const own = PL.ownPlans(res.plans)
      const shared = PL.sharedPlans(res.plans)
      this._planRevision = res.revision
      this.setData({
        plansState: 'ready',
        plansError: '',
        plans: own.map(p => this.decoratePlan(p)),
        sharedPlans: shared.map(p => this.decoratePlan(p)),
        lastPlan: own.concat(shared)[0] || null,
      })
    }, err => {
      const denied = err && err.code === 'AUTH_REQUIRED'
      this.setData({
        plansState: denied ? 'denied' : 'error',
        plansError: (err && err.message) || '个人计划暂时读不到。',
        plans: [],
        sharedPlans: [],
        lastPlan: null,
      })
    })
  },

  decoratePlan(p) {
    const days = (Array.isArray(p.stops) ? p.stops : []).reduce((max, s) => Math.max(max, s.day || 1), 1)
    return Object.assign({}, p, {
      subText: F.dateLabel(p.startDate) + ' 出发 · ' + days + ' 天 · ' + (p.isOwner ? '个人计划' : '由 ' + (p.sharedBy || '同行者') + ' 共享'),
      shared: !p.isOwner,
    })
  },

  loadRoutes() {
    if (this.data.routesState === 'loading' || this.data.routesState === 'ready') return
    this.setData({ routesState: 'loading' })
    api.readRoutes().then(res => {
      const routes = (res && res.routes) || []
      this._routes = routes
      this.setData({ routesState: 'ready', routes })
      this.refreshPlaceList()
    }, err => {
      this.setData({ routesState: 'error', routes: [], plansError: (err && err.message) || '' })
    })
  },

  /* ---------- 首页交互 ---------- */

  onHomeTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (['plans', 'points', 'routes'].indexOf(tab) === -1) return
    this.setData({ homeTab: tab })
    if (tab === 'routes') this.loadRoutes()
  },

  onRetryPlans() { this.loadPlans() },

  onOpenPlan(e) {
    const id = e.currentTarget.dataset.id
    const plan = this.data.plans.concat(this.data.sharedPlans).filter(p => p.id === id)[0]
    if (!plan) return
    this.openRoute(plan.routeId, { planId: plan.id, date: plan.startDate })
  },

  onOpenPlanFromRoute() {
    // 「继续上次」行：直接进该计划的行程流
    const plan = this.data.lastPlan
    if (!plan) return
    this.openRoute(plan.routeId, { planId: plan.id, date: plan.startDate, tab: 'route' })
  },

  onOpenPoint(e) {
    const id = e.currentTarget.dataset.id
    const p = this.data.points.filter(x => x.id === id)[0]
    if (!p) return
    this.enterDetail(this.pointPlace(p), { node: 0, date: '', hour: 13, period: 24, tab: 'hourly' })
  },

  onOpenRoute(e) {
    const id = e.currentTarget.dataset.id
    this.openRoute(id, { tab: 'route' })
  },

  onOpenTrackNode(e) {
    const { set, index } = e.currentTarget.dataset
    const t = this.data.tracks.filter(x => x.id === set)[0]
    if (!t) return
    this.openTrack(set, Number(index))
  },

  onOpenTrack(e) {
    const id = e.currentTarget.dataset.id
    this.openTrack(id, 0)
  },

  onTrackToggle(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ trackOpen: Object.assign({}, this.data.trackOpen, { [id]: !this.data.trackOpen[id] }) })
  },

  /* ---------- 地点装配 ---------- */

  pointPlace(p) {
    const node = {
      name: p.display || p.name || '此点',
      lat: p.lat,
      lng: p.lng,
      altitude: Number.isFinite(p.ele) ? p.ele : null,
      eleSource: p.eleSource || null,
    }
    return {
      id: 'point:' + (p.id || p.lat + ',' + p.lng),
      kind: 'point',
      name: p.display || p.name || WP.coordName(p.lat, p.lng),
      lat: p.lat,
      lng: p.lng,
      area: '常用地点',
      routeId: '',
      nodes: [node],
    }
  },

  routePlace(route) {
    const points = Array.isArray(route.points) ? route.points : []
    const nodes = points.map(pt => ({
      name: pt.name,
      lat: pt.coordinates ? pt.coordinates.lat : null,
      lng: pt.coordinates ? pt.coordinates.lng : null,
      altitude: Number.isFinite(pt.ele) ? pt.ele : null,
      eleSource: Number.isFinite(pt.ele) ? 'gpx' : null,
    }))
    const withCoords = nodes.filter(n => Number.isFinite(n.lat) && Number.isFinite(n.lng))[0]
    return {
      id: 'route:' + route.id,
      kind: nodes.length > 1 ? 'route' : 'point',
      name: route.title,
      lat: withCoords ? withCoords.lat : null,
      lng: withCoords ? withCoords.lng : null,
      area: '路线库',
      routeId: route.id,
      activityDate: null,
      nodes: nodes.length ? nodes : [{ name: route.title, lat: null, lng: null, altitude: null, eleSource: null }],
    }
  },

  trackPlace(track, index) {
    const pts = Array.isArray(track.points) ? track.points : []
    const nodes = pts.map((p, i) => ({
      name: p.name || (i === 0 ? '起点' : i === pts.length - 1 ? '终点' : '节点 ' + i),
      lat: Number.isFinite(p.coordinates && p.coordinates.lat) ? p.coordinates.lat : null,
      lng: Number.isFinite(p.coordinates && p.coordinates.lng) ? p.coordinates.lng : null,
      altitude: Number.isFinite(p.ele) ? p.ele : null,
      eleSource: Number.isFinite(p.ele) ? 'gpx' : null,
    }))
    const first = nodes[Math.min(Math.max(0, index), Math.max(0, nodes.length - 1))] || {}
    return {
      id: 'track:' + track.id,
      kind: nodes.length > 1 ? 'route' : 'point',
      name: track.name || '导入轨迹',
      lat: Number.isFinite(first.lat) ? first.lat : null,
      lng: Number.isFinite(first.lng) ? first.lng : null,
      area: '轨迹点组',
      routeId: '',
      activityDate: null,
      nodes,
      startNode: Math.min(Math.max(0, index), Math.max(0, nodes.length - 1)),
    }
  },

  openRoute(routeId, opts) {
    if (!routeId) return
    const cached = this._routes.filter(r => r.id === routeId)[0]
    const go = route => {
      const place = this.routePlace(route)
      const o = opts || {}
      this.enterDetail(place, {
        node: 0,
        date: V3Date(o.date),
        hour: 13,
        period: 24,
        tab: o.tab || 'route',
        planId: o.planId || '',
      })
    }
    if (cached) return go(cached)
    api.readRoutes(routeId).then(res => {
      const route = res && res.route
      if (!route) throw new Error('找不到这条路线。')
      this._routes = this._routes.concat([route])
      go(route)
    }, err => api.toast((err && err.message) || '读取路线失败，请重试'))
  },

  openTrack(id, index) {
    const t = this.data.tracks.filter(x => x.id === id)[0]
    if (!t) return
    const raw = wpStore.listTracks().filter(x => x.id === id)[0]
    if (!raw) return
    const place = this.trackPlace(raw, index)
    this.enterDetail(place, { node: place.startNode || 0, date: '', hour: 13, period: 24, tab: 'hourly' })
  },

  enterDetail(place, initial) {
    if (!place) return
    const init = {
      node: Number.isFinite(initial.node) ? initial.node : 0,
      date: initial.date || '',
      hour: Number.isFinite(initial.hour) ? initial.hour : 13,
      period: 24,
      tab: initial.tab || 'hourly',
    }
    this.setData({
      screen: 'detail',
      place,
      initial: init,
      planId: initial.planId || '',
      placeOpen: false,
      placeQuery: '',
    })
    if (typeof wx !== 'undefined' && wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  onBackHome() {
    this.setData({ screen: 'home', placeOpen: false })
    if (typeof wx !== 'undefined' && wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 0 })
  },

  /* ---------- 地点弹层（详情页的地点切换） ---------- */

  onOpenPlace() {
    this.refreshPlaceList()
    this.setData({ placeOpen: true, placeQuery: '' })
    this.loadRoutes()
  },
  onPlaceClose() { this.setData({ placeOpen: false }) },
  onPlaceQuery(e) {
    this.setData({ placeQuery: (e.detail.value || '').trim() })
    this.refreshPlaceList((e.detail.value || '').trim())
  },

  refreshPlaceList(query) {
    const q = query == null ? this.data.placeQuery : query
    const match = s => !q || String(s || '').indexOf(q) !== -1
    const cur = this.data.screen === 'detail' ? this.data.place : null
    const curId = String((cur && cur.id) || '')
    const curKey = curId.indexOf('point:') === 0 ? 'p:' + curId.slice(6)
      : curId.indexOf('route:') === 0 ? 'r:' + curId.slice(6)
      : cur ? 'cur' : ''
    const list = []
    ;(this.data.points || []).forEach(p => {
      const name = p.display || p.name
      if (!match(name) && !match(p.subText)) return
      const key = 'p:' + p.id
      list.push({ key, kind: 'point', id: p.id, name, sub: p.subText, current: key === curKey })
    })
    ;(this._routes || []).forEach(r => {
      if (!match(r.title)) return
      const key = 'r:' + r.id
      list.push({ key, kind: 'route', id: r.id, name: r.title, sub: r.pointCount + ' 个节点 · 路线库', current: key === curKey })
    })
    if (this.data.screen === 'detail' && cur && cur.id.indexOf('track:') === 0) {
      list.unshift({ key: 'cur', kind: 'current', id: cur.id, name: cur.name, sub: '当前轨迹 · ' + cur.nodes.length + ' 个节点', current: true })
    }
    this.setData({ placeList: list })
  },

  onPickPlace(e) {
    const key = e.currentTarget.dataset.key
    const item = (this.data.placeList || []).filter(x => x.key === key)[0]
    if (!item) return
    // 已选中的地点不再重进详情：避免无意义的重取数与滚动复位
    if (item.current) return this.setData({ placeOpen: false })
    if (item.kind === 'point') {
      const p = this.data.points.filter(x => x.id === item.id)[0]
      if (!p) return
      this.enterDetail(this.pointPlace(p), { node: 0, date: '', hour: 13, period: 24, tab: 'hourly' })
      return
    }
    if (item.kind === 'route') this.openRoute(item.id, { tab: 'hourly' })
  },

  onPlanChange() {
    this.loadPlans()
  },

  /* ---------- 入口一：地图选点（主路径） ---------- */
  onPickMap() {
    // requiredPrivateInfos 已声明 chooseLocation；开发者工具内行为受限，验收以真机为准
    if (!wx.chooseLocation) {
      api.toast('当前基础库不支持地图选点，请改用手动输入')
      return
    }
    wx.chooseLocation({
      success: r => {
        if (!r || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) {
          api.toast('没有取到坐标，请重试或手动输入')
          return
        }
        this.goPoint({
          name: r.name || r.address || '',
          lat: r.latitude,
          lng: r.longitude,
          ele: null,
          eleSource: 'picked',
        })
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        api.toast(/privacy|scope/i.test(msg) ? '平台隐私指引未声明「位置信息」，暂无法地图选点' : '地图选点失败，请重试或手动输入')
      },
    })
  },

  /* ---------- 入口二：手动输入经纬度 ---------- */
  onManualOpen() {
    this.setData({ manualOpen: true, manualError: '', manual: { name: '', lat: '', lng: '', ele: '', wgs: false } })
  },
  onManualClose() { this.setData({ manualOpen: false }) },
  onManualName(e) { this.setData({ 'manual.name': e.detail.value }) },
  onManualLat(e) { this.setData({ 'manual.lat': e.detail.value }) },
  onManualLng(e) { this.setData({ 'manual.lng': e.detail.value }) },
  onManualEle(e) { this.setData({ 'manual.ele': e.detail.value }) },
  onManualWgs() { this.setData({ 'manual.wgs': !this.data.manual.wgs }) },

  onManualSubmit() {
    const m = this.data.manual
    const lat = Number(m.lat)
    const lng = Number(m.lng)
    const ele = Number(m.ele)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      this.setData({ manualError: '纬度/经度必须是数字，且在有效范围内（纬度 -90~90，经度 -180~180）。' })
      return
    }
    // 存储口径唯一（P3 D6）：勾了 WGS-84 就地转成 GCJ 入库，库存永远只有 GCJ
    const c = m.wgs ? gpx.wgsToGcj(lat, lng) : { lat, lng }
    const point = {
      name: (m.name || '').trim(),
      lat: c.lat,
      lng: c.lng,
      ele: Number.isFinite(ele) && ele > -500 && ele <= 9000 ? Math.round(ele) : null,
      eleSource: 'manual',
    }
    const save = (replaceId) => {
      const r = wpStore.savePoint(replaceId ? Object.assign({ id: replaceId }, point) : point)
      if (!r.ok) {
        api.toast(r.reason === 'cap' ? '最多存 ' + WP.POINTS_CAP + ' 个观察点，先删一个' : '坐标无效，无法保存')
        return
      }
      this.setData({ manualOpen: false })
      api.toast(r.updated ? '已替换原有观察点' : '已存入观察点')
      this.goPoint(point)
    }
    const nearby = wpStore.listPoints().find(p => WP.dedupeKey(p.lat, p.lng) === WP.dedupeKey(point.lat, point.lng))
    if (nearby) {
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

  /* ---------- 入口三：导入 GPX 轨迹（沿用既有行为，逐条断言在 weather-hub-gpx-test） ---------- */
  onImportGpx() {
    this.setData({ gpxError: '' })
    // wx.chooseMessageFile 是隐私接口：只能选聊天中的文件，且需平台隐私协议声明「选中的文件」。
    // 失败必须显式透出（此前静默导致"点了没反应"）。
    if (!wx.chooseMessageFile) {
      this.setData({ gpxOpen: true, gpxError: '当前基础库不支持从聊天选择文件，请升级开发者工具或改用真机。' })
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: res => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        if (file.size > gpx.MAX_FILE_BYTES) {
          this.setData({ gpxOpen: true, gpxError: '文件超过 8MB，请换一个 GPX 文件。' })
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: read => {
            const parsed = gpx.parseGpx(read.data)
            if (!parsed.ok) {
              this.setData({ gpxOpen: true, gpxError: parsed.error })
              return
            }
            this._gpxParsed = parsed
            this.setData({
              gpxOpen: true,
              gpxError: '',
              gpxMeta: {
                fileName: file.name || '轨迹.gpx',
                count: parsed.points.length,
                distanceKm: parsed.distanceKm,
                ascentM: parsed.ascentM,
                hasElevation: parsed.stats.hasElevation,
                hasTime: parsed.points.some(p => p.time && Number.isFinite(Date.parse(p.time))),
              },
              gpxPoints: parsed.points,
            })
          },
          fail: err => this.setData({ gpxOpen: true, gpxError: '读取文件失败：' + ((err && err.errMsg) || '请重试') }),
        })
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        if (/privacy|scope is not declared/i.test(msg)) {
          this.setData({
            gpxOpen: true,
            gpxError: '公众平台《用户隐私保护指引》尚未声明「选中的文件」，无法从聊天选择文件。请到 mp.weixin.qq.com → 设置 → 服务内容声明 补充并等生效；在此之前可用「地图选点」或「输入经纬度」。',
          })
          return
        }
        this.setData({ gpxOpen: true, gpxError: '打开文件选择失败' + (msg ? '：' + msg : '') })
      },
    })
  },
  onGpxClose() { this.setData({ gpxOpen: false }) },
  // 预览删除只动 data.gpxPoints；_gpxParsed 始终保留完整解析结果，「恢复全部」据此还原。
  onGpxRemove(e) {
    const index = Number(e.currentTarget.dataset.index)
    const points = this.data.gpxPoints || []
    if (!Number.isInteger(index) || index < 0 || index >= points.length) return
    const next = points.slice()
    next.splice(index, 1)
    this.setData({
      gpxPoints: next,
      gpxMeta: Object.assign({}, this.data.gpxMeta, {
        hasTime: next.some(p => p.time && Number.isFinite(Date.parse(p.time))),
      }),
    })
  },
  onGpxReset() {
    const parsed = this._gpxParsed
    if (!parsed || !parsed.ok) return
    this.setData({
      gpxPoints: parsed.points,
      gpxMeta: Object.assign({}, this.data.gpxMeta, {
        hasTime: parsed.points.some(p => p.time && Number.isFinite(Date.parse(p.time))),
      }),
    })
  },
  onGpxApply() {
    const parsed = this._gpxParsed
    const points = this.data.gpxPoints || []
    if (!parsed || !parsed.ok) return
    if (points.length < 2) {
      api.toast('至少保留 2 个节点才能存为轨迹点组')
      return
    }
    // 以预览里实际保留的点为准；直接传 _gpxParsed 会把刚删掉的节点又存回去。
    const set = WP.fromGpx(Object.assign({}, parsed, { points }), this.data.gpxMeta && this.data.gpxMeta.fileName)
    if (!set) return
    const r = wpStore.saveTrack(set)
    if (!r.ok) {
      api.toast('最多存 ' + WP.TRACKS_CAP + ' 组轨迹，先删一组')
      return
    }
    this._gpxParsed = null
    this.setData({
      gpxOpen: false,
      trackOpen: Object.assign({}, this.data.trackOpen, { [set.id]: true }),
      tracks: this.decorateTracks(wpStore.listTracks()),
    })
    api.toast('已导入 ' + set.stats.count + ' 个节点')
  },

  /* ---------- 直接进查询（应用内直达无隐私顾虑） ---------- */
  goPoint(p) {
    // 单点直达：先把它装配成详情地点，再进入屏 2（不再 navigateTo 旧页面）
    const place = this.pointPlace({ id: '', display: p.name || WP.coordName(p.lat, p.lng), name: p.name, lat: p.lat, lng: p.lng, ele: p.ele, eleSource: p.eleSource })
    this.enterDetail(place, { node: 0, date: '', hour: 13, period: 24, tab: 'hourly' })
  },

  /* ---------- 删除（danger：dialog 二次确认） ---------- */
  onDeleteTap(e) {
    const { type, id, name } = e.currentTarget.dataset
    this.setData({ deleteOpen: true, deleteInfo: { type, id, name: name || '' } })
  },
  onDeleteClose() { this.setData({ deleteOpen: false }) },
  onDeleteConfirm() {
    const info = this.data.deleteInfo
    if (!info) return
    if (info.type === 'track') wpStore.deleteTrack(info.id)
    else wpStore.deletePoint(info.id)
    this.setData({
      deleteOpen: false,
      deleteInfo: null,
      points: this.decoratePoints(wpStore.listPoints()),
      tracks: this.decorateTracks(wpStore.listTracks()),
    })
    api.toast('已删除')
  },
})

// 轻量日期兜底：只有合法的 YYYY-MM-DD 才沿用，否则交给组件自己选今天
function V3Date(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : ''
}