// 天气模块首页（Tab）：三种输入入口 + 本地观察点/轨迹点组管理（P3 设计文档 §7/§9）。
// 本页只做"管理与入口"，查询视图是 pages/weather（navigateTo 带参进入——Tab 页不能被
// navigateTo 打开、switchTab 又不能带参，这是两页分工的平台依据，见 P3 §4.2/D2）。
// 观察点数据全本地（watch-points + draft.wxStorage），无云依赖、无档案要求。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const gpx = require('../../utils/gpx')
const WP = require('../../utils/watch-points')
const Plans = require('../../utils/weather-plans')

const wpStore = WP.createWatchPoints(draft.durableStorage)
const plans = Plans.createStore(draft.durableStorage)

Page({
  data: {
    points: [],
    tracks: [],
    plans: [],
    recent: [],
    routeOpen: false,
    routeLoading: false,
    routeError: '',
    routes: [],
    busy: false,
    error: '',
    manualEditId: '',
    trackOpen: {},
    manualOpen: false,
    manual: { name: '', lat: '', lng: '', ele: '', wgs: false },
    manualError: '',
    gpxOpen: false,
    gpxError: '',
    gpxMeta: null,
    gpxPoints: [],
    deleteOpen: false,
    deleteInfo: null,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    // 每次都重读：从查询页「存入观察点」返回后立即可见，不靠手动刷新
    this.reload()
  },

  reload() {
    this.setData({ points: this.decoratePoints(wpStore.listPoints()), tracks: this.decorateTracks(wpStore.listTracks()), plans: plans.list(), recent: plans.recent() })
    return Promise.resolve()
  },

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
      // 组内相对耗时（schedule 无 startAt → 「出发后 X 小时」），抵达日由查询页按基准日展开
      const nodes = (t.points || []).map((p, i) => ({
        id: p.id,
        name: p.name || (i === 0 ? '起点' : i === (t.points.length - 1) ? '终点' : '节点 ' + i),
        label: p.time ? 'GPX 历史时刻，仅作参考' : '本次抵达时间待安排',
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
        originalSaved: !!t.originalPath,
      }
    })
  },

  // ---- 入口一：地图选点（主路径）----
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

  // ---- 入口二：手动输入经纬度 ----
  onManualOpen() {
    this.setData({ manualOpen: true, manualError: '', manualEditId: '', manual: { name: '', lat: '', lng: '', ele: '', wgs: false } })
  },
  onManualClose() { this.setData({ manualOpen: false }) },
  onManualName(e) { this.setData({ 'manual.name': e.detail.value }) },
  onManualLat(e) { this.setData({ 'manual.lat': e.detail.value }) },
  onManualLng(e) { this.setData({ 'manual.lng': e.detail.value }) },
  onManualEle(e) { this.setData({ 'manual.ele': e.detail.value }) },
  onManualWgs() { this.setData({ 'manual.wgs': !this.data.manual.wgs }) },

  onManualSubmit() {
    const m = this.data.manual
    const lat = String(m.lat).trim() ? Number(m.lat) : NaN
    const lng = String(m.lng).trim() ? Number(m.lng) : NaN
    const ele = String(m.ele).trim() ? Number(m.ele) : null
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      this.setData({ manualError: '纬度/经度必须是数字，且在有效范围内（纬度 -90~90，经度 -180~180）。' })
      return
    }
    if (ele !== null && (!Number.isFinite(ele) || ele < -500 || ele > 9000)) {
      this.setData({ manualError: '海拔应为 -500–9000 米的数字；不知道请留空。' })
      return
    }
    // 存储口径唯一（P3 D6）：勾了 WGS-84 就地转成 GCJ 入库，库存永远只有 GCJ
    const c = m.wgs ? gpx.wgsToGcj(lat, lng) : { lat, lng }
    const point = {
      name: (m.name || '').trim(),
      lat: c.lat,
      lng: c.lng,
      ele: Number.isFinite(ele) ? Math.round(ele) : null,
      eleSource: 'manual',
    }
    if (this.data.manualEditId) {
      try {
        const result = wpStore.savePoint(Object.assign({ id: this.data.manualEditId }, point))
        if (!result.ok) throw new Error('保存失败，请检查坐标与可用空间。')
      } catch (err) { this.setData({ manualError: '本机保存失败，请清理空间后重试。' }); return }
      this.setData({ manualOpen: false }); this.reload(); return
    }
    this.setData({ manualOpen: false })
    this.goPoint(point)
  },

  // ---- 入口三：导入 GPX 轨迹（复用 parseGpx；suggestions 是活动创建语义，此处不消费）----
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
            this._gpxSourcePath = file.path
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
  async onGpxApply() {
    if (this.data.busy) return
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
    this.setData({ busy: true })
    let r
    try {
      if (this._gpxSourcePath) {
        const destination = wx.env.USER_DATA_PATH + '/' + set.id + '.gpx'
        await new Promise((resolve, reject) => wx.getFileSystemManager().copyFile({ srcPath: this._gpxSourcePath, destPath: destination, success: resolve, fail: reject }))
        set.originalPath = destination
      }
      r = wpStore.saveTrack(set)
    } catch (err) {
      r = { ok: false, reason: 'storage' }
    }
    this.setData({ busy: false })
    if (!r.ok) {
      if (set.originalPath) wx.getFileSystemManager().unlink({ filePath: set.originalPath, fail: () => {} })
      this.setData({ gpxError: r.reason === 'cap' ? '最多存 ' + WP.TRACKS_CAP + ' 组轨迹，先删一组。' : '本机保存失败，未完成导入。请清理空间后重试。' })
      return
    }
    this._gpxParsed = null
    this.setData({
      gpxOpen: false,
      trackOpen: Object.assign({}, this.data.trackOpen, { [set.id]: true }),
      tracks: this.decorateTracks(wpStore.listTracks()),
    })
    api.toast('已导入 ' + set.stats.count + ' 个节点')
    this._gpxSourcePath = ''
    if (wx.navigateTo) wx.navigateTo({ url: '/pages/weather-plan/weather-plan?set=' + encodeURIComponent(set.id) })
  },

  // ---- 列表交互 ----
  onPointTap(e) {
    const p = this.data.points.find(x => x.id === e.currentTarget.dataset.id)
    if (!p) return
    this.goPoint(p)
  },

  // 直接进查询：带 ele/eleSrc（应用内直达无隐私顾虑；只有分享 URL 才降精度，见查询页 §5.3）
  goPoint(p) {
    plans.remember(p)
    let url = '/pages/weather/weather?src=local&lat=' + p.lat + '&lng=' + p.lng
    if (p.name) url += '&name=' + encodeURIComponent(p.name)
    if (Number.isFinite(p.ele) && p.ele !== null) url += '&ele=' + p.ele
    if (p.eleSource) url += '&eleSrc=' + p.eleSource
    wx.navigateTo({ url })
  },

  // ---- 删除（danger：dialog 二次确认）----
  onDeleteTap(e) {
    const { type, id, name } = e.currentTarget.dataset
    this.setData({ deleteOpen: true, deleteInfo: { type, id, name: name || '' } })
  },
  onDeleteClose() { this.setData({ deleteOpen: false }) },
  onDeleteConfirm() {
    const info = this.data.deleteInfo
    if (!info) return
    try {
      if (info.type === 'track') {
        if (plans.references('local', info.id).length) { this.setData({ deleteOpen: false, error: '有个人天气行程引用这条轨迹，请先删除相关行程。' }); return }
        const track = wpStore.getTrack(info.id)
        wpStore.deleteTrack(info.id)
        if (track && track.originalPath) wx.getFileSystemManager().unlink({ filePath: track.originalPath, fail: () => {} })
      } else if (info.type === 'plan') plans.remove(info.id)
      else wpStore.deletePoint(info.id)
    } catch (err) { this.setData({ error: '本机删除失败，请重试。', deleteOpen: false }); return }
    this.setData({
      deleteOpen: false,
      deleteInfo: null,
      points: this.decoratePoints(wpStore.listPoints()),
      tracks: this.decorateTracks(wpStore.listTracks()),
    })
    api.toast('已删除')
    this.reload()
  },

  onEditPoint(event) {
    const point = wpStore.listPoints().find(item => item.id === event.currentTarget.dataset.id)
    if (!point) return
    this.setData({ manualOpen: true, manualEditId: point.id, manualError: '', manual: { name: point.name, lat: String(point.lat), lng: String(point.lng), ele: point.ele == null ? '' : String(point.ele), wgs: false } })
  },
  onRecent(event) {
    const point = plans.recent().find(item => item.id === event.currentTarget.dataset.id)
    if (point) this.goPoint(point)
  },
  onPlan(event) { wx.navigateTo({ url: '/pages/weather-plan/weather-plan?plan=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  onTrackWeather(event) { wx.navigateTo({ url: '/pages/weather-plan/weather-plan?set=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  onRouteClose() { this.setData({ routeOpen: false }) },
  onRouteLibrary() {
    this.setData({ routeOpen: true, routeLoading: true, routeError: '' })
    return api.readRoutes().then(response => this.setData({ routes: response.routes || [], routeLoading: false }))
      .catch(error => this.setData({ routeLoading: false, routeError: api.errorText(error) }))
  },
  onChooseRoute(event) {
    this.setData({ routeOpen: false })
    wx.navigateTo({ url: '/pages/weather-plan/weather-plan?route=' + encodeURIComponent(event.currentTarget.dataset.id) })
  },
  onSaveRoute(event) {
    if (this.data.busy) return
    const track = wpStore.getTrack(event.currentTarget.dataset.id)
    if (!track) return
    wx.showModal({ title: '存入共用路线库？', content: '创建你账户下的私有路线，活动和天气可复用。只上传节点与轻量折线；原始 GPX 仍只在本机。个人行程不会公开。', success: async answer => {
      if (!answer.confirm || this.data.busy) return
      this.setData({ busy: true, error: '' })
      try {
        const response = await api.readRoutes()
        this.revision = response.revision
        const input = {
          title: track.name, distanceKm: track.stats.distanceKm || 0, ascentM: Math.round(track.stats.ascentM || 0),
          points: track.points.map((point, index) => {
            const result = { id: point.id, name: point.name || '节点 ' + (index + 1), kind: index === 0 ? 'start' : index === track.points.length - 1 ? 'finish' : 'checkpoint', coordinates: { lat: point.lat, lng: point.lng } }
            if (Number.isFinite(point.ele)) result.ele = point.ele
            if (point.time) result.time = point.time
            return result
          }), risks: [], source: 'gpx', visibility: 'private', sharedWith: [],
        }
        if (track.track && track.track.length >= 2) input.track = track.track
        const result = await api.dispatchAndSync({ type: 'route.create', input }, this.revision, this)
        api.toast('已存入私有路线库')
        wx.navigateTo({ url: '/pages/weather-plan/weather-plan?route=' + encodeURIComponent(result.targetIds[0]) })
      } catch (error) { this.setData({ error: api.errorText(error) }) }
      finally { this.setData({ busy: false }) }
    } })
  },
})
