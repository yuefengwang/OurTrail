// 天气模块首页（Tab）：三种输入入口 + 本地观察点/轨迹点组管理（P3 设计文档 §7/§9）。
// 本页只做"管理与入口"，查询视图是 pages/weather（navigateTo 带参进入——Tab 页不能被
// navigateTo 打开、switchTab 又不能带参，这是两页分工的平台依据，见 P3 §4.2/D2）。
// 观察点数据全本地（watch-points + draft.wxStorage），无云依赖、无档案要求。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const gpx = require('../../utils/gpx')
const WP = require('../../utils/watch-points')
const RS = require('../../utils/route-schedule')

const wpStore = WP.createWatchPoints(draft.wxStorage)

Page({
  data: {
    points: [],
    tracks: [],
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
    this.setData({ points: this.decoratePoints(wpStore.listPoints()), tracks: this.decorateTracks(wpStore.listTracks()) })
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
  onGpxApply() {
    const parsed = this._gpxParsed
    if (!parsed || !parsed.points || parsed.points.length < 2) return
    const set = WP.fromGpx(parsed, this.data.gpxMeta && this.data.gpxMeta.fileName)
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

  // ---- 列表交互 ----
  onPointTap(e) {
    const p = this.data.points.find(x => x.id === e.currentTarget.dataset.id)
    if (!p) return
    this.goPoint(p)
  },
  onTrackToggle(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ trackOpen: Object.assign({}, this.data.trackOpen, { [id]: !this.data.trackOpen[id] }) })
  },
  onTrackNodeTap(e) {
    const { set, index } = e.currentTarget.dataset
    wx.navigateTo({ url: '/pages/weather/weather?src=local&set=' + set + '&point=' + index })
  },

  // 直接进查询：带 ele/eleSrc（应用内直达无隐私顾虑；只有分享 URL 才降精度，见查询页 §5.3）
  goPoint(p) {
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
