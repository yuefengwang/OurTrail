// 路线编辑器（V2.0）：新建 / 编辑路线库里的路线。
// 与活动编辑器（pages/editor）的分工：这里只管理路线资产本身（标题/里程/爬升/节点/风险/轨迹），
// 不碰时间、名额、集合上车点——那些是活动的事。GPX 导入链路与活动编辑器同源
// （utils/gpx.js），节点/风险编辑模式照抄其既定交互（渐进披露 + 地图选点）。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const gpx = require('../../utils/gpx')
const F = require('../../utils/format')
const J = require('../../utils/journey')

const freshId = kind => kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)

function emptyForm() {
  return { title: '', distanceKm: '', ascentM: '', difficulty: '', points: [], risks: [], track: [] }
}

function coordsOrNull(lat, lng) {
  if (String(lat).trim() === '' && String(lng).trim() === '') return null
  const la = Number(lat)
  const ln = Number(lng)
  const valid = Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
  return valid ? { lat: la, lng: ln } : null
}

// routeView → form：lat/lng 摊平便于 WXML 绑定；time/ele 与 severity/coordinates 原样保留
// （GPX 元数据用户不可编辑，但编辑保存时必须带回，否则一存就丢）。
function toForm(route) {
  return {
    title: route.title || '',
    distanceKm: route.distanceKm ? String(route.distanceKm) : '',
    ascentM: route.ascentM ? String(route.ascentM) : '',
    difficulty: route.difficulty || '',
    points: (route.points || []).map(p => ({
      id: p.id, name: p.name, kind: p.kind,
      lat: p.coordinates ? String(p.coordinates.lat) : '',
      lng: p.coordinates ? String(p.coordinates.lng) : '',
      time: p.time || '', ele: Number.isFinite(p.ele) ? p.ele : null,
    })),
    risks: (route.risks || []).map(r => ({
      id: r.id, title: r.title, advice: r.advice,
      severity: r.severity || '', coordinates: r.coordinates || null,
    })),
    track: (route.track || []).slice(),
  }
}

// form → RouteInput：与编辑器 buildInput 的路线段同口径（ele 走 gpx.saneEle 防越界高程；
// track 不足 2 点不带键，schema 按 specOpt 兼容缺省）。
function buildInput(form, extra) {
  const input = {
    title: form.title,
    distanceKm: Number(form.distanceKm) || 0,
    ascentM: Math.round(Number(form.ascentM)) || 0,
    points: form.points.map(p => {
      const ele = gpx.saneEle(p.ele)
      return Object.assign(
        { id: p.id, name: p.name, kind: p.kind, coordinates: coordsOrNull(p.lat, p.lng) },
        p.time ? { time: p.time } : {},
        ele !== null ? { ele } : {}
      )
    }),
    risks: form.risks.map(r => {
      const risk = { id: r.id, title: r.title, advice: r.advice }
      if (r.severity) risk.severity = r.severity
      if (r.coordinates) risk.coordinates = r.coordinates
      return risk
    }),
  }
  if (form.difficulty) input.difficulty = form.difficulty
  if (Array.isArray(form.track) && form.track.length >= 2) input.track = form.track
  return Object.assign(input, extra || {})
}

Page({
  data: {
    loading: true,
    denied: '',
    isNew: true,
    form: emptyForm(),
    difficultyOptions: F.DIFFICULTY_OPTIONS,
    // GPX 导入
    gpxOpen: false,
    gpxError: '',
    gpxMeta: null,
    gpxPoints: [],
    gpxTrack: [],
    gpxSuggest: null,
    // 渐进披露
    expandedPoints: {},
    showPointCoords: {},
    editingRisks: {},
    // 反馈
    busy: false,
    busyAt: 0,
    failure: '',
    message: '',
    draftSavedAt: '',
  },

  onLoad(options) {
    this.routeId = options.id || ''
    this.reload()
  },

  onUnload() {
    // 保存成功已清草稿；异常退出时草稿留在本机，下次进来自动恢复
  },

  reload() {
    const key = this.draftKey()
    const saved = draft.getDraft(key, 'route-editor')
    const reads = this.routeId
      ? api.readRoutes(this.routeId)
      : api.readRoutes()
    return reads.then(res => {
      let initial = null
      let denied = ''
      let extra = {}
      if (this.routeId) {
        const route = res.route
        if (!route) {
          denied = '找不到这条路线。'
        } else if (!route.isOwner) {
          // 协作者可见但不可写：入口就说清楚，别让用户填完一堆内容才被服务端拒
          denied = '只有路线创建者可以编辑这条路线。'
        } else {
          this.revision = res.revision
          initial = toForm(route)
          // 编辑是全量替换：sharedWith/visibility/source 必须原样带回，否则一存就丢
          extra = {
            sharedWith: (route.sharedWith || []).slice(),
            visibility: route.visibility || 'private',
            source: route.source || 'copy',
          }
        }
      } else {
        // 新建态没有"表单来自哪次读"：列表读的 revision 就是 CAS 基线（与编辑器新建态同口径）
        if (Number.isInteger(res.revision)) this.revision = res.revision
      }
      if (saved && !denied) initial = saved
      this.extra = extra
      wx.setNavigationBarTitle({ title: this.routeId ? '编辑路线' : '新建路线' })
      this.setData({
        loading: false,
        denied,
        isNew: !this.routeId,
        form: initial || emptyForm(),
      })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  draftKey() {
    return this.routeId ? 'route-' + this.routeId : 'new-route'
  },

  persistDraft() {
    draft.setDraft(this.draftKey(), 'route-editor', this.data.form)
    this.setData({ draftSavedAt: '' })
  },

  // ---- 字段编辑 ----
  onField(e) {
    const key = e.currentTarget.dataset.key
    const form = Object.assign({}, this.data.form, { [key]: e.detail.value })
    this.setData({ form, message: '' })
    this.persistDraft()
  },
  onDifficulty(e) {
    const option = F.DIFFICULTY_OPTIONS[Number(e.detail.value)] || F.DIFFICULTY_OPTIONS[0]
    const form = Object.assign({}, this.data.form, { difficulty: option.value })
    this.setData({ form, message: '' })
    this.persistDraft()
  },
  onRoutePoint(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points[index][key] = e.detail.value
    this.setData({ form })
    this.persistDraft()
  },
  onPointKind(e) {
    const index = Number(e.currentTarget.dataset.index)
    const kind = ['start', 'checkpoint', 'finish'][Number(e.detail.value) || 0]
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points[index].kind = kind
    this.setData({ form })
    this.persistDraft()
  },
  addPoint() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    const id = freshId('point')
    form.points.push({ id, name: '', kind: form.points.length ? 'checkpoint' : 'start', lat: '', lng: '', time: '', ele: null })
    const expandedPoints = Object.assign({}, this.data.expandedPoints)
    expandedPoints[id] = true
    this.setData({ form, expandedPoints })
    this.persistDraft()
  },
  removePoint(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points.splice(index, 1)
    this.setData({ form })
    this.persistDraft()
  },
  togglePoint(e) {
    const id = e.currentTarget.dataset.id
    const expandedPoints = Object.assign({}, this.data.expandedPoints)
    if (expandedPoints[id]) delete expandedPoints[id]
    else expandedPoints[id] = true
    this.setData({ expandedPoints })
  },
  togglePointCoords(e) {
    const id = e.currentTarget.dataset.id
    const showPointCoords = Object.assign({}, this.data.showPointCoords)
    if (showPointCoords[id]) delete showPointCoords[id]
    else showPointCoords[id] = true
    this.setData({ showPointCoords })
  },
  choosePointLocation(e) {
    const index = e.currentTarget.dataset.index
    wx.chooseLocation({
      success: res => {
        const form = JSON.parse(JSON.stringify(this.data.form))
        form.points[index].lat = String(res.latitude)
        form.points[index].lng = String(res.longitude)
        this.setData({ form, failure: '' })
        this.persistDraft()
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        this.setData({ failure: this.pickFailText(msg, '路线节点') })
      },
    })
  },
  useSampleRoute() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    if (!form.title.trim()) form.title = '示例路线（请自行修改）'
    if (!form.points.length) {
      form.points = [
        { id: freshId('point'), name: '示例起点', kind: 'start', lat: '', lng: '', time: '', ele: null },
        { id: freshId('point'), name: '示例终点', kind: 'finish', lat: '', lng: '', time: '', ele: null },
      ]
    }
    form.track = [] // 换路线丢弃旧轨迹，避免与其他来源的节点错配
    this.setData({ form, expandedPoints: {}, showPointCoords: {} })
    this.persistDraft()
  },

  // ---- 风险 ----
  onRisk(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.risks[index][key] = e.detail.value
    this.setData({ form })
    this.persistDraft()
  },
  addRisk() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    const id = freshId('risk')
    form.risks.push({ id, title: '', advice: '', severity: '', coordinates: null })
    const editingRisks = Object.assign({}, this.data.editingRisks)
    editingRisks[id] = true
    this.setData({ form, editingRisks })
    this.persistDraft()
  },
  removeRisk(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.risks.splice(index, 1)
    this.setData({ form })
    this.persistDraft()
  },
  toggleRisk(e) {
    const id = e.currentTarget.dataset.id
    const editingRisks = Object.assign({}, this.data.editingRisks)
    if (editingRisks[id]) delete editingRisks[id]
    else editingRisks[id] = true
    this.setData({ editingRisks })
  },

  // ---- GPX 导入（与活动编辑器同链路：chooseMessageFile → readFile → gpx.parseGpx）----
  onImportGpx() {
    this.setData({ gpxError: '' })
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
            this.setData({
              gpxOpen: true,
              gpxError: '',
              gpxMeta: {
                fileName: file.name || '轨迹.gpx',
                count: parsed.points.length,
                distanceKm: parsed.distanceKm,
                ascentM: parsed.ascentM,
                hasElevation: parsed.stats.hasElevation,
              },
              gpxPoints: parsed.points,
              gpxTrack: parsed.track || [],
              gpxSuggest: parsed.suggestions || null,
            })
          },
          fail: err => this.setData({ gpxOpen: true, gpxError: '读取文件失败：' + ((err && err.errMsg) || '请重试') }),
        })
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        if (/privacy|scope is not declared/i.test(msg)) {
          this.setData({ gpxOpen: true, gpxError: '公众平台《用户隐私保护指引》尚未声明「选中的文件」，无法从聊天选择文件。请到 mp.weixin.qq.com → 设置 → 服务内容声明 补充并等生效。' })
          return
        }
        this.setData({ gpxOpen: true, gpxError: '打开文件选择失败' + (msg ? '：' + msg : '') })
      },
    })
  },
  onGpxClose() { this.setData({ gpxOpen: false }) },
  onGpxApply() {
    const meta = this.data.gpxMeta
    const points = this.data.gpxPoints
    if (!meta || !points.length) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points = points.map(p => ({
      id: freshId('point'), name: p.name, kind: p.kind,
      lat: String(p.coordinates.lat), lng: String(p.coordinates.lng),
      time: p.time || '', ele: Number.isFinite(p.ele) ? p.ele : null,
    }))
    form.track = (this.data.gpxTrack || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    let prefilled = ''
    const sug = this.data.gpxSuggest
    if (sug && sug.risks && sug.risks.length && !form.risks.length) {
      form.risks = sug.risks.map(r => ({ id: freshId('risk'), title: r.title, advice: r.advice, severity: '', coordinates: null }))
      prefilled = '，并预填 ' + form.risks.length + ' 条风险提示'
    }
    if (meta.distanceKm > 0) form.distanceKm = String(meta.distanceKm)
    if (meta.hasElevation) form.ascentM = String(meta.ascentM)
    if (!form.title.trim()) form.title = meta.fileName.replace(/\.(gpx|xml)$/i, '')
    this.setData({
      gpxOpen: false, form, expandedPoints: {}, showPointCoords: {}, editingRisks: {},
      message: '已导入 ' + points.length + ' 个路线节点' + prefilled + '。',
    })
    this.persistDraft()
  },

  pickFailText(msg, what) {
    if (/deny|auth|authorize/i.test(msg)) return '定位权限被拒绝，可改用手动输入坐标。'
    return '打开地图失败' + (msg ? '：' + msg : '') + '。可改用手动输入' + what + '坐标。'
  },

  // ---- 保存 ----
  // 写命令入口的在途闸门：返回 true 表示「上一条写还在飞」，本次操作必须拦。
  // 残留的 busy 不得把「存入路线库/保存修改」永久锁成「正在保存…、点了没反应」：
  // 超过宽限期即认定残留并就地复位、放行本次操作。宽限期与 elapsed 判据只有一个出处
  // J.busyStale（铁律 31：页面不写第二个 8000、不自己算时间差）。
  // 求值点放在写入口而不是 reload()：本面没有 onShow/onReady，而写悬死时 revision 不会前进。
  busyBlocks() {
    if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {
      this.setData({ busy: false, busyAt: 0 })
      console.warn('[busy] 清掉一个超过 8 秒没落地的写状态')
    }
    return !!this.data.busy
  },

  onSave() {
    if (this.busyBlocks()) return
    const f = this.data.form
    if (!f.title.trim()) {
      this.setData({ failure: '先给这条路线起个名字。' })
      return
    }
    if (!f.points.length) {
      this.setData({ failure: '至少添加 1 个路线节点——起点、途中、终点都算。' })
      return
    }
    if (f.points.some(p => !p.name.trim())) {
      this.setData({ failure: '还有路线节点没有名字，展开节点逐个补齐。' })
      return
    }
    this.setData({ busy: true, busyAt: Date.now(), failure: '', message: '' })
    const extra = Object.assign({ source: 'manual' }, this.extra || {})
    const input = buildInput(f, extra)
    const payload = this.routeId
      ? { type: 'route.update', routeId: this.routeId, input }
      : { type: 'route.create', input }
    return api.dispatchAndSync(payload, this.revision, this)
      .then(res => {
        this.revision = res.revision
        draft.clearDraft(this.draftKey(), 'route-editor')
        this.setData({ busy: false, message: this.routeId ? '路线已保存。' : '路线已入库。' })
        api.toast(this.routeId ? '路线已保存' : '路线已入库')
        setTimeout(() => wx.navigateBack(), 600)
      })
      .catch(e => {
        this.setData({ busy: false, failure: api.errorText(e) })
      })
  },
})
