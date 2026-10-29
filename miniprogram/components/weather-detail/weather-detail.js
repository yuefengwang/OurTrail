// 天气详情共享单元（V3 四视图）。
//
// 两个宿主：tab 页 weather-hub 的屏 2，与最终要接的深链页。**只此一份实现**——
// 状态迁移、窗口切片、视图装配分别在 utils/weather-v3.js 与 utils/weather-v3-view.js（wx-free）。
//
// 本组件持有的实例状态（不进 data）：
//   ctx        —— { date, cursor, period, tab, nodeIndex }
//   _result    —— 最近一次 ready 返回体（切小时只重算读数，不重算云场）
//   _geo       —— 云层统一图的几何（UMG.buildUnified 产物）
//   _plans     —— 读视图里的计划（含 revision）
//   _nodeWeather —— 沿途视图逐节点取数结果（§7.4：每个节点单独取，禁止一个点冒充整条线）
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const V3 = require('../../utils/weather-v3')
const V = require('../../utils/weather-v3-view')
const HSV = require('../../utils/weather-v3-hourly-svg')
const WC = require('../../utils/weather-cache')
const draft = require('../../utils/draft')
const PL = require('../../utils/weather-plans')

const wCache = WC.createWeatherCache(draft.wxStorage)
const RETRY_DELAYS = [1200, 2600]
const ATTEMPTS = 3

const HELP = {
  source: {
    title: '数据与时间',
    body: '天气来自 Open-Meteo（云量与降水）。时间是北京时间 UTC+8；气温 °C，逐时降水量 mm，风速与阵风 km/h，云量 %，海拔 m。\n\n' +
      '缺测就是缺测：图上的断线、读数位的「—」都表示这一小时没有取值，不表示 0。',
  },
  cloud: {
    title: '怎样读云层剖面',
    body: '横轴是时间，纵轴是海拔。灰阶越深，该高度模型云量越多；图上写的是云量，不是实测云底或云顶。\n\n' +
      '绿色虚线标出此点海拔。显示窗是「这张图显示哪一段高度」，不是判读范围；窗外的云不会因为换窗而出现。' +
      '没有可信海拔时，不画参考线，也不判断此点是否在云中。',
  },
  sky: {
    title: '时刻与天相是两件事',
    body: '日出、日落与天文暗夜是天文时刻，任何天气都会发生，不会被天气裁掉。\n\n' +
      '云海、光染、星空与银河还要看云层、地形与月光：有条件时给出窗口与依据；已排除时收起并说明原因；判不出时保留并说明缺什么——缺资料不等于零分。',
  },
}

Component({
  options: { styleIsolation: 'apply-shared', multipleSlots: false },

  properties: {
    // tab（tabBar 内）| deep（独立页）
    mode: { type: String, value: 'tab' },
    // { id, name, kind:'route'|'point', lat, lng, area, routeId, activityDate, nodes:[{name,lat,lng,altitude,eleSource}] }
    place: { type: Object, value: null },
    // { node, date, hour, period, tab }
    initial: { type: Object, value: null },
    // 指定计划（可选；缺省取该路线最近更新的计划）
    planId: { type: String, value: '' },
    // tab 页里也要一个回首页的入口（switchTab 不能带参、也不会复发屏内状态）
    canBack: { type: Boolean, value: false },
  },

  data: {
    ready: false,
    // 品牌条实测高度（brand-header 的 bind:ready 回填）；四视图 tab 吸在这条下面。
    // 默认值只是首帧兜底，真实值来自 layoutFor 的实测（header-layout.js 单一出处）。
    chromeHeight: 64,
    loading: true,
    error: '',
    errorCode: '',
    retryNote: '',
    emptyTitle: '',
    emptyDetail: '',
    emptyKind: 'empty',
    stale: null,

    placeName: '',
    placeSub: '',
    nodeName: '',
    // 节点弹层在取数前就要能打开（syncHeader 填），所以缺省必须是空数组而不是 undefined
    nodeOptions: [],
    isPoint: false,
    tabs: [],
    period: 24,
    periodOptions: [],
    cursor: 13,
    cursorMax: 23,
    selectedDate: '',
    selectedDateLabel: '',
    dayStrip: [],
    dayStripKind: 'point',

    readout: {},
    hourlySrc: '',
    hourlyWidth: 0,
    hourlyHeight: 310,
    // 列宽由可用宽度反推（24h 一屏），真实值在 rebuild 后由 buildDetailView 回填；0 = 还没算过
    hourlyCell: 0,
    hourlyColumns: 0,
    hourlyScrolls: false,
    hourlyHint: '点按小时或拖动时间滑块',
    hourCols: [],
    axis: [],
    axisWidth: 49,
    // 三层云量的高度区间文案（唯一出处是 weather-v3-hourly-svg 的 CLOUD_LAYER_KM）
    cloudBounds: HSV.cloudBounds(),

    cloudMissing: false,
    cloud: null,
    cloudSel: { r1: '', r2: '', r3: '', r4: '', hour: null, selSrc: '', stKey: '' },

    sky: { arcSrc: '', daylight: '', rise: '—', set: '—', moon: '—', events: [], cards: [], overall: null, silent: null },

    route: { hasPlan: false, stops: [], dayButtons: [], notice: null, planName: '', planMeta: '' },
    activePlanId: '',
    activePlan: null,
    planOwner: false,
    planFailed: false,

    providerLabel: '',
    updatedLabel: '',
    elevLabel: '',

    nodeOpen: false,
    helpOpen: false,
    helpTitle: '',
    helpBody: '',
    planOpen: false,
    shareOpen: false,
    planDraft: null,
    planError: '',
    planBusy: false,
    routeBusy: false,
  },

  observers: {
    place: function () {
      if (!this.data.place) return
      this.resetContext()
    },
    initial: function () {
      if (!this.data.place) return
      this.resetContext()
    },
  },

  lifetimes: {
    // 实例字段必须在 created 里初始化，**不能留在 attached**：父级在同一次 setData 里就给出
    // place / initial 时，属性 observer 会先于 attached 触发（初始属性也会触发 observer），
    // 于是一次取数已经在途。attached 再把 _token 置零、ctx 置空，就只剩两种下场：
    // 回调被当成过期丢弃，或 rebuild() 因 ctx 为空静默返回 —— 页面永久停在「正在查询天气」。
    created() {
      this.ctx = null
      this._token = 0
      this._routeToken = 0
      this._plans = []
      this._planRevision = null
      this._nodeWeather = {}
      this._scrollLeft = 0
      this._width = 0
    },
    attached() {
      if (this.data.place) this.resetContext()
      this.loadPlans()
    },
    detached() {
      this._token++
      this._routeToken++
      if (this._timer) clearTimeout(this._timer)
    },
  },

  methods: {
    /* ---------- 上下文 ---------- */

    onChromeReady(e) {
      const h = e && e.detail && e.detail.height
      if (!Number.isFinite(h) || h <= 0 || h === this.data.chromeHeight) return
      this.setData({ chromeHeight: h })
    },

    initialCtx() {
      const init = this.data.initial || {}
      const today = F.cnToday()
      return V3.initialState({
        date: V3.isDate(init.date) ? init.date : today,
        cursor: Number.isFinite(init.hour) ? init.hour : 13,
        period: init.period === 48 || init.period === 72 ? init.period : 24,
        tab: V3.TABS.indexOf(init.tab) !== -1 ? init.tab : 'hourly',
        nodeIndex: Number.isFinite(init.node) ? init.node : 0,
      })
    },

    resetContext() {
      const place = this.data.place
      if (!place) return
      // 两个属性（place / initial）在同一份 setData 里到达时会各触发一次 observer ⇒ 去重。
      // 只按签名判，不按时间判：父级真的换了地点/初始时刻时签名必变。
      this._token = Number.isFinite(this._token) ? this._token : 0
      this._routeToken = Number.isFinite(this._routeToken) ? this._routeToken : 0
      const sig = String(place.id || '') + '|' + JSON.stringify(this.data.initial || {})
      if (sig === this._ctxSig) return
      this._ctxSig = sig
      this.ctx = this.initialCtx()
      if (this.data.planId) this.ctx.planId = this.data.planId
      if (this.data.isPoint || place.kind === 'point') this.ctx.tab = 'hourly'
      this._result = null
      this._geo = null
      this._nodeWeather = {}
      this._plan = null
      this.setData({ error: '', errorCode: '' })
      this.syncHeader()
      this.loadWeather()
    },

    /**
     * 页头两行与节点弹层的「地点侧」字段：**取数之前就要有**。
     * 它们全是地点自带的事实（名字 / 坐标 / 节点海拔），一个天气读数都不参与，
     * 所以「正在查询」与「这次没取到天气」时同样说得出口 —— 那一行不该在数据到位前
     * 长成只剩一个图钉，弹层也不该是空的。
     * 文案与选中位一律回到 view 的单源（`placeNameText` / `placeSubText` / `nodeOptionsOf`），
     * 组件不自己拼第二份；成功装配时 buildDetailView 会写同名的四个字段，值必须相同。
     */
    syncHeader() {
      const place = this.data.place || {}
      this.setData({
        placeName: V.placeNameText(place),
        placeSub: V.placeSubText(place, this.currentNode()),
        nodeOptions: V.nodeOptionsOf(place, this.ctx && this.ctx.nodeIndex),
        isPoint: V.isPointPlace(place),
      })
    },

    nodeList() {
      const place = this.data.place || {}
      return Array.isArray(place.nodes) && place.nodes.length ? place.nodes : []
    },

    currentNode() {
      const list = this.nodeList()
      if (!list.length) {
        const p = this.data.place || {}
        return { name: p.name || '', altitude: Number.isFinite(p.altitude) ? p.altitude : null, eleSource: p.eleSource || null, lat: p.lat, lng: p.lng }
      }
      const i = Math.min(Math.max(0, (this.ctx && this.ctx.nodeIndex) || 0), list.length - 1)
      return list[i]
    },

    chartWidth() {
      if (this._width) return this._width
      let w = 350
      try { w = Math.round(wx.getSystemInfoSync().windowWidth) - 40 } catch (e) { w = 350 }
      this._width = Math.max(240, Math.min(460, w))
      return this._width
    },

    /* ---------- 取数 ---------- */

    loadWeather() {
      const place = this.data.place || {}
      if (this.ctx && this.data.isPoint) this.ctx.tab = 'hourly'
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
        return this.setData(V.emptyView('empty', '这个地点没有可用坐标，无法查询天气。'))
      }
      const token = ++this._token
      const date = this.ctx.date
      const scope = 'v3:' + (place.id || '') + '@' + place.lat.toFixed(2) + ',' + place.lng.toFixed(2)
      this.setData(V.loadingView())
      const attempt = n => {
        api.getWeatherByPoint(place.lat, place.lng, date).then(res => {
          if (token !== this._token) return
          if (!res || res.status === 'out_of_range') {
            this._result = null
            this.setData(V.emptyView('outOfRange', '这个日期还不在预报范围（今天起 14 天内）。临近出发再查，行程本身不会被删掉。'))
            return
          }
          if (res.status !== 'ready') {
            return this.fallback(scope, date, token, new Error(res.message || '天气服务暂时不可用。'))
          }
          try { wCache.put(scope, date, res) } catch (e) { /* 缓存是增强，不阻断 */ }
          this.applyResult(res, null)
        }, err => {
          if (token !== this._token) return
          if (n < ATTEMPTS) {
            // 三次查询共一次首查 + 两次重试：这里报的是**即将发出的第几次查询**，不是「第几次重试」，
            // 否则「共 3 次」会被读成三次重试。间隔 1.2s/2.6s，最长静默约 20s×3，进度必须自己说出来。
            this.setData(V.loadingView('网络不太稳，正在重试（第 ' + (n + 1) + ' 次尝试，共 ' + ATTEMPTS + ' 次）…'))
            this._timer = setTimeout(() => attempt(n + 1), RETRY_DELAYS[n - 1] || 2600)
            return
          }
          this.fallback(scope, date, token, err)
        })
          // 装配层抛错也必须让 loading 结束：`.then(onOk, onErr)` 没有 catch，
          // rebuild() 里任何异常都会变成未处理的 rejection，页面停在加载态且没有一句人话。
          .catch(err => {
            if (token !== this._token) return
            console.error('[weather-detail] 天气装配失败：', err)
            this.setData(V.emptyView('error', '这次的天气数据没能显示出来。请点「重新查询」再取一次。'))
          })
      }
      attempt(1)
    },

    /** 瞬时失败：先看 12h 内的同一份缓存（软降级），没有才报错 */
    fallback(scope, date, token, err) {
      let entry = null
      try { entry = wCache.get(scope, date) } catch (e) { entry = null }
      if (entry && entry.result && entry.ageMs <= WC.MAX_AGE_MS) {
        this.applyResult(entry.result, { ageText: WC.ageText(entry.ageMs) })
        return
      }
      const code = (err && err.code) || 'NETWORK'
      this.setData(V.emptyView(code === 'AUTH_REQUIRED' ? 'denied' : 'error', (err && err.message) || '网络不太稳，请稍后再试。'))
    },

    onRetry() {
      if (!this.ctx) return
      this.loadWeather()
      this.loadPlans()
    },

    onJumpToday() {
      if (!this.ctx) return
      this.ctx = V3.setState(this.ctx, F.cnToday())
      this.loadWeather()
    },

    applyResult(result, stale) {
      this._result = result
      this._stale = stale || null
      // 结果到手（哪怕来自缓存兜底）：重试进度不再成立。只在真有话说时多调一次 setData。
      if (this.data.retryNote) this.setData({ retryNote: '' })
      this.rebuild()
      this.loadRouteWeather()
    },

    /** 完整重算（地点/日期/时长/节点/计划变化时） */
    rebuild() {
      if (!this._result || !this.ctx) return
      const place = this.data.place || {}
      const view = V.buildDetailView({
        result: this._result,
        place,
        node: this.currentNode(),
        ctx: this.ctx,
        width: this.chartWidth(),
        plan: this.currentPlan(),
        nodeWeather: this._nodeWeather,
        stale: this._stale,
      })
      this._geo = view.geo
      this._window = view.window
      this._cloudCard = view.data.cloud
      const plan = this.currentPlan()
      if (plan) view.data.activePlan = plan
      this.setData(view.data, () => {
        if (this.ctx && this.ctx.tab === 'route') this.loadRouteWeather()
      })
    },

    /** 只换选中小时：读数 / 逐时图 / 云图十字线（不重算云场等值带） */
    applySelection() {
      if (!this._result || !this.ctx || !this._window) return
      const cursor = Math.min(V3.cursorOf(this.ctx), Math.max(0, this._window.length - 1))
      const node = this.currentNode()
      const readout = V3.readoutOf(V3.hourAt(this._window, cursor), node)
      // 必须带 width：列宽由可用宽度反推（2026-10-28 一屏裁决），漏传会退到 350 的缺省值，
      // 于是每次点小时图都换一次列宽，而下方小时条还按上一档列宽排。
      const hourly = HSV.buildHourlySvg({ series: this._window, cursor, period: this._window.length, node, width: this.chartWidth() })
      const sel = this._geo ? (V.cloudReadout(this._geo, cursor, V.elevationOf(node, this._result).basis) || this.data.cloudSel) : this.data.cloudSel
      this.setData({
        cursor,
        selectedDate: V3.selectedDate(this.ctx),
        selectedDateLabel: V3.shortDate(V3.selectedDate(this.ctx)) + ' ' + V3.weekdayOf(V3.selectedDate(this.ctx)),
        readout,
        hourCols: V3.hourColsOf(this._window, cursor, HSV.LABEL_EVERY),
        hourlySrc: hourly.svg ? this.uri(hourly.svg) : '',
        hourlyWidth: hourly.width,
        hourlyCell: hourly.cell,
        cloudSel: sel,
      })
    },

    uri(svg) { return V.toUri(svg) },

    /* ---------- 计划 ---------- */

    loadPlans() {
      const place = this.data.place || {}
      if (!place.routeId) {
        this._plans = []
        this._planRevision = null
        this.refreshPlan()
        return
      }
      PL.listPlans().then(res => {
        this._plans = res.plans
        this._planRevision = res.revision
        this.setData({ planFailed: false })
        this.refreshPlan()
      }, () => {
        // 读计划失败不冒充"没有计划"：面板要能区分"还没建"与"暂时读不到"
        this._plans = null
        this.setData({ planFailed: true })
        this.refreshPlan()
      })
    },

    refreshPlan() {
      if (!this.ctx) return
      const plan = this.currentPlan()
      if (this._result) {
        this.setData({ activePlan: plan, activePlanId: plan ? plan.id : '' })
        this.rebuild()
      } else {
        this.setData({ activePlan: plan, activePlanId: plan ? plan.id : '' })
      }
    },

    currentPlan() {
      const list = this._plans
      if (!Array.isArray(list)) return null
      const place = this.data.place || {}
      if (this.data.planId) return list.filter(p => p.id === this.data.planId)[0] || null
      return place.routeId ? PL.planForRoute(list, place.routeId) : null
    },

    /** 逐节点取数（§7.4）：串行、单点失败只标记该节点，不整条失败 */
    loadRouteWeather() {
      const plan = this.currentPlan()
      const token = ++this._routeToken
      if (!plan || !this._result || !this.ctx) { this.setData({ routeBusy: false }); return }
      const list = this.nodeList()
      const planDay = V3.selectedDate(this.ctx)
      const stops = (plan.stops || []).filter(s => V3.stopDate(plan, s) === planDay && s.time)
      let i = 0
      const next = () => {
        if (token !== this._routeToken) return
        if (i >= stops.length) { this.setData({ routeBusy: false }); return }
        const s = stops[i++]
        const node = list[s.nodeIndex]
        if (!node) return next()
        if (this._nodeWeather[s.nodeIndex]) return next()
        if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) {
          this._nodeWeather[s.nodeIndex] = 'noc'
          this.refreshRoute()
          return next()
        }
        this._nodeWeather[s.nodeIndex] = 'loading'
        this.setData({ routeBusy: true })
        this.refreshRoute()
        api.getWeatherByPoint(node.lat, node.lng, planDay).then(res => {
          if (token !== this._routeToken) return
          this._nodeWeather[s.nodeIndex] = res && res.status === 'ready' ? res : 'error'
          this.refreshRoute()
          next()
        }, () => {
          if (token !== this._routeToken) return
          this._nodeWeather[s.nodeIndex] = 'error'
          this.refreshRoute()
          next()
        })
      }
      this.setData({ routeBusy: stops.length > 0 })
      next()
    },

    refreshRoute() {
      const plan = this.currentPlan()
      if (!this._result || !this.ctx) return
      const route = V.buildRouteFlow(plan, this.data.place || {},
        Object.assign({}, this.ctx, { selDate: V3.selectedDate(this.ctx) }),
        this._nodeWeather, this._result.days || [])
      this.setData({ route })
    },

    /* ---------- 事件：头部与切换 ---------- */

    onPlaceTap() { this.triggerEvent('openplace') },

    onNodeTap() {
      if (this.data.isPoint) return
      this.setData({ nodeOpen: true })
    },
    onNodeClose() { this.setData({ nodeOpen: false }) },
    onNodePick(e) {
      const i = Number(e.currentTarget.dataset.index)
      if (!Number.isFinite(i)) return
      this.ctx = V3.setNode(this.ctx, i)
      this._nodeWeather = {}
      this.setData({ nodeOpen: false })
      // 没结果时 rebuild() 会静默返回 ⇒ 换节点后这一行与弹层的选中位必须自己跟上
      this.syncHeader()
      this.rebuild()
    },

    onTab(e) {
      const key = e.currentTarget.dataset.key
      if (V3.TABS.indexOf(key) === -1) return
      if (key === 'route' && this.data.isPoint) return
      this.ctx = V3.setTab(this.ctx, key)
      this.setData({ tabs: V3.TABS.map(t => ({ key: t, label: V3.TAB_LABELS[t], selected: t === key, disabled: t === 'route' && this.data.isPoint })) })
      if (this._result) this.rebuild()
      if (key === 'route') this.loadRouteWeather()
    },

    onPeriod(e) {
      const value = Number(e.currentTarget.dataset.value)
      if (V3.PERIODS.indexOf(value) === -1) return
      // 保留当前选中时刻，以该时刻所在日期重设窗口起点（原型行为）
      this.ctx = V3.changePeriod(this.ctx, value)
      this._nodeWeather = {}
      this.rebuild()
    },

    onDay(e) {
      const date = e.currentTarget.dataset.date
      if (!V3.isDate(date)) return
      this.ctx = V3.setDate(this.ctx, date)
      this._nodeWeather = {}
      this.rebuild()
      this.loadRouteWeather()
    },

    onStep(e) {
      const delta = Number(e.currentTarget.dataset.step)
      if (!Number.isFinite(delta)) return
      this.selectCursor(V3.cursorOf(this.ctx) + delta)
    },

    onSliderChange(e) {
      this.selectCursor(e.detail.value)
    },

    selectCursor(value) {
      if (!this.ctx) return
      const before = V3.selectedDate(this.ctx)
      this.ctx = V3.selectHour(this.ctx, value)
      // 跨天后窗口本身不动（period 内），只是选中的日期变了：日期条与云图十字线要跟着走
      this.applySelection()
      if (V3.selectedDate(this.ctx) !== before && this.ctx.tab === 'route') this.loadRouteWeather()
    },

    /** 点逐时图反解列：以图片自身的 rect 为基准（横滚由 rect 自带偏移） */
    onHourTap(e) {
      const idx = Number(e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index)
      if (Number.isFinite(idx)) return this.selectCursor(idx)
      const x = this.pointerX(e)
      if (!Number.isFinite(x) || !this.data.hourlyWidth) return
      const self = this
      wx.createSelectorQuery().in(this).select('.wv3-chart-img').boundingClientRect(rect => {
        if (!rect || !rect.width) return
        const svgX = (x - rect.left) * (self.data.hourlyWidth / rect.width)
        const cell = self.data.hourlyCell
        if (!cell) return
        const col = Math.floor(svgX / cell)
        self.selectCursor(Math.max(0, Math.min((self.data.hourlyColumns || 1) - 1, col)))
      }).exec()
    },

    /** 点云图反解小时：镜像旧页 onCfTap 的归一做法（rect → svg 坐标 → 列号） */
    onCloudTap(e) {
      const x = this.pointerX(e)
      const geo = this._geo
      if (!Number.isFinite(x) || !geo) return
      const self = this
      wx.createSelectorQuery().in(this).select('.wv3-cloud-img').boundingClientRect(rect => {
        if (!rect || !rect.width) return
        const svgX = (x - rect.left) * (geo.width / rect.width)
        const colW = geo.plotW / geo.horizon
        let h = Math.floor((svgX - geo.L) / colW)
        if (!Number.isFinite(h)) return
        h = Math.max(0, Math.min(geo.horizon - 1, h))
        self.selectCursor(h)
      }).exec()
    },

    pointerX(e) {
      if (e && e.detail && Number.isFinite(e.detail.x)) return e.detail.x
      if (e && e.changedTouches && e.changedTouches[0] && Number.isFinite(e.changedTouches[0].x)) return e.changedTouches[0].x
      return NaN
    },

    /* ---------- 事件：帮助 ---------- */

    onHelp(e) {
      const kind = e.currentTarget.dataset.kind
      const h = HELP[kind]
      if (!h) return
      this.setData({ helpOpen: true, helpTitle: h.title, helpBody: h.body })
    },
    onHelpClose() { this.setData({ helpOpen: false }) },

    /* ---------- 事件：沿途动作 ---------- */

    onStopTap(e) {
      const i = Number(e.currentTarget.dataset.index)
      const time = e.currentTarget.dataset.time
      if (!Number.isFinite(i)) return
      this.ctx = V3.setNode(this.ctx, i)
      if (time) {
        const h = V3.parseHM(time)
        if (h != null) this.ctx = V3.jumpToAbsolute(this.ctx, V3.selectedDate(this.ctx), Math.floor(h / 60))
      }
      this.ctx = V3.setTab(this.ctx, 'hourly')
      this.setData({ tabs: V3.TABS.map(t => ({ key: t, label: V3.TAB_LABELS[t], selected: t === 'hourly', disabled: t === 'route' && this.data.isPoint })) })
      this.rebuild()
    },

    onRouteRetry() {
      this._nodeWeather = {}
      this.loadRouteWeather()
    },

    openEdit() {
      const plan = this.currentPlan()
      const draftPlan = plan || this.blankPlan()
      this.setData({
        planOpen: true,
        planError: '',
        planDraft: { id: plan ? plan.id : null, input: PL.inputOf(draftPlan), isCopy: false },
      })
    },

    blankPlan() {
      const place = this.data.place || {}
      const nodes = this.nodeList()
      return {
        id: null,
        routeId: place.routeId || '',
        name: (place.name || '这条路线') + ' · 天气计划',
        startDate: this.ctx ? this.ctx.date : F.cnToday(),
        isOwner: true,
        stops: nodes.map((n, i) => ({ nodeIndex: i, day: 1, time: i === 0 ? '08:00' : '' })),
      }
    },

    onCopyPlan() {
      const plan = this.currentPlan() || this.blankPlan()
      const d = PL.draftOf(plan, { copy: true })
      this.setData({ planOpen: true, planError: '', planDraft: { id: null, input: d.input, isCopy: true } })
    },

    onShareOpen() {
      const plan = this.currentPlan()
      if (!plan) return
      this.setData({ shareOpen: true, planError: '' })
    },

    onPlanClose() { this.setData({ planOpen: false, planError: '' }) },
    onShareClose() { this.setData({ shareOpen: false, planError: '' }) },

    onPlanConfirm(e) {
      const detail = e.detail || {}
      const val = PL.validateDraft(detail, this.nodeList().length)
      if (!val.ok) return this.setData({ planError: val.error })
      this.persistPlan(detail.id || null, val.input, '计划已保存')
    },

    onPlanShare(e) {
      const plan = this.currentPlan()
      if (!plan || !plan.isOwner) return
      const sharedWith = (e.detail && e.detail.sharedWith) || []
      const input = Object.assign(PL.inputOf(plan), { sharedWith })
      this.persistPlan(plan.id, input, sharedWith.length ? '已更新共享' : '已取消共享')
    },

    persistPlan(planId, input, doneText) {
      if (this._planRevision == null) {
        return this.setData({ planError: '计划数据还没读到，请稍后再试。' })
      }
      this.setData({ planBusy: true, planError: '' })
      PL.savePlan(planId, input, this._planRevision).then(res => {
        this._planRevision = res.revision
        this.setData({ planBusy: false, planOpen: false, shareOpen: false })
        api.toast(doneText)
        this.loadPlans()
        this.triggerEvent('planchange')
      }, err => {
        this.setData({ planBusy: false, planError: api.errorText ? api.errorText(err) : (err && err.message) || '保存失败，请重试。' })
        if (err && err.needRefresh) this.loadPlans()
      })
    },

    onPlanDelete() {
      const plan = this.currentPlan()
      if (!plan || !plan.isOwner) return
      wx.showModal({
        title: '删除这个计划？',
        content: '「' + (plan.name || '未命名计划') + '」会被删除，路线本身不受影响。',
        confirmText: '删除',
        confirmColor: '#96403C',
        success: r => {
          if (!r.confirm) return
          if (this._planRevision == null) return
          this.setData({ planBusy: true })
          PL.deletePlan(plan.id, this._planRevision).then(res => {
            this._planRevision = res.revision
            this.setData({ planBusy: false })
            api.toast('计划已删除')
            this.loadPlans()
            this.triggerEvent('planchange')
          }, err => {
            this.setData({ planBusy: false })
            api.toast((err && err.message) || '删除失败，请重试')
          })
        },
      })
    },

    onBack() { this.triggerEvent('screenback') },
  },
})