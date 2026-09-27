// 活动编辑器（新建 / 编辑 / 从我组织的活动复制）。对应原型 screens/ActivityEditor.tsx。
// datetime-local 用「日期 picker + 时间 picker」组合；草稿落本地存储。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')
const gpx = require('../../utils/gpx')

const emptyInput = () => ({
  title: '', description: '', organizerIntro: '',
  startAt: null, endAt: null, deadlineAt: null,
  acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
  routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [] },
  pickupPoints: [], equipment: [], feeNote: '', cancellationNote: '',
})

// 把 ActivityInput 摊平成便于 WXML 绑定的形状（dt_*: {date,time} / equipmentText）
function toForm(input) {
  const split = iso => {
    if (!iso) return { date: '', time: '' }
    const p = F.cnParts(iso)
    return { date: p.date, time: p.time }
  }
  return {
    title: input.title,
    description: input.description,
    organizerIntro: input.organizerIntro,
    capacity: String(input.capacity),
    approvalMode: input.approvalMode,
    acceptingSignups: input.acceptingSignups,
    routeTitle: input.routeSnapshot.title,
    distanceKm: input.routeSnapshot.distanceKm === 0 ? '' : String(input.routeSnapshot.distanceKm),
    ascentM: input.routeSnapshot.ascentM === 0 ? '' : String(input.routeSnapshot.ascentM),
    points: input.routeSnapshot.points.map(p => ({ id: p.id, name: p.name, kind: p.kind, lat: p.coordinates ? String(p.coordinates.lat) : '', lng: p.coordinates ? String(p.coordinates.lng) : '' })),
    risks: input.routeSnapshot.risks.map(r => ({ id: r.id, title: r.title, advice: r.advice })),
    pickups: input.pickupPoints.map(p => ({ id: p.id, name: p.name, address: p.address, lat: p.coordinates ? String(p.coordinates.lat) : '', lng: p.coordinates ? String(p.coordinates.lng) : '', meeting: split(p.meetingAt) })),
    equipmentText: input.equipment.join('\n'),
    feeNote: input.feeNote,
    cancellationNote: input.cancellationNote,
    dt_start: split(input.startAt),
    dt_end: split(input.endAt),
    dt_deadline: split(input.deadlineAt),
  }
}

function composeDateTime(date, time) {
  if (!date || !time) return null
  return date + 'T' + time + ':00+08:00'
}

function coordsOrNull(lat, lng) {
  if (lat.trim() === '' && lng.trim() === '') return null
  const la = Number(lat)
  const ln = Number(lng)
  const valid = Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
  return valid ? { lat: la, lng: ln } : null
}

const freshId = kind => kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
const TIME_SLOTS = (() => {
  const out = []
  for (let h = 0; h < 24; h++) for (const m of ['00', '30']) out.push(String(h).padStart(2, '0') + ':' + m)
  return out
})()

Page({
  data: {
    loading: true,
    denied: '',
    isNew: true,
    savedId: '',
    phase: 'draft',
    step: 0,
    stepLabels: ['01 内容与时间', '02 路线与集合', '03 招募与风险'],
    form: toForm(emptyInput()),
    timeSlots: TIME_SLOTS,
    // 复制
    myActivities: [],
    templateId: '',
    templateIndex: -1,
    // 发布
    publishOpen: false,
    participate: false,
    dataUse: false,
    tripSelf: true,
    tripPickupIndex: -1,
    // 反馈
    failure: '',
    message: '',
    busy: false,
    canPublish: false,
    // GPX 导入
    gpxOpen: false,
    gpxError: '',
    gpxMeta: null,
    gpxPoints: [],
    // 渐进披露：节点/上车点默认收合，坐标默认隐藏
    expandedPoints: {},
    showPointCoords: {},
    expandedPickups: {},
    showPickupCoords: {},
    draftSavedAt: '',
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.savedId = this.activityId
    this.reload()
  },

  reload() {
    const draftKey = this.activityId || 'new'
    const saved = draft.getDraft(draftKey, 'activity-editor')
    const reads = this.activityId
      ? api.read({ kind: 'activity', activityId: this.activityId, perspective: 'organizer' })
      : Promise.resolve({ view: { kind: 'denied' } })
    reads.then(res => {
      let initial = null
      let phase = 'draft'
      let denied = ''
      if (this.activityId) {
        if (res.view.kind === 'denied') {
          denied = res.view.message
        } else if (res.view.kind === 'activity') {
          if (res.view.permittedActions.indexOf('activity.edit') === -1) {
            denied = '已结束或已取消的活动不能修改。可以从新建活动中复制自己的模板。'
          } else {
            const a = JSON.parse(JSON.stringify(res.view.activity))
            delete a.id
            delete a.ownerId
            delete a.phase
            initial = a
            phase = res.view.activity.phase
            this.routeId = res.view.activity.routeId || null
          }
        }
      }
      if (saved && !denied) initial = saved
      this.setData({
        loading: false,
        denied,
        isNew: !this.activityId,
        savedId: denied ? '' : this.savedId,
        phase,
        form: toForm(initial || emptyInput()),
        canPublish: false,
      })
      this.loadMyActivities()
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  loadMyActivities() {
    api.read({ kind: 'home', perspective: 'organizer', openedActivityIds: [] }).then(res => {
      if (res.view.kind !== 'home') return
      const mine = res.view.activities.filter(a => a.meta.owner)
      this.setData({
        myActivities: mine.map(a => ({ id: a.id, title: a.title || '未命名草稿' })),
      })
    }).catch(() => {})
  },

  persistDraft() {
    draft.setDraft(this.activityId || 'new', 'activity-editor', this.buildInput())
    const now = Date.now()
    if (!this._lastMark || now - this._lastMark > 30000) {
      this._lastMark = now
      this.setData({ draftSavedAt: F.hhmm(new Date().toISOString()) })
    }
  },

  buildInput() {
    const f = this.data.form
    return {
      title: f.title,
      description: f.description,
      organizerIntro: f.organizerIntro,
      startAt: composeDateTime(f.dt_start.date, f.dt_start.time),
      endAt: composeDateTime(f.dt_end.date, f.dt_end.time),
      deadlineAt: composeDateTime(f.dt_deadline.date, f.dt_deadline.time),
      acceptingSignups: f.acceptingSignups,
      capacity: Math.max(1, Math.min(500, Math.round(Number(f.capacity) || 24))),
      approvalMode: f.approvalMode,
      routeId: this.routeId || null,
      routeSnapshot: {
        title: f.routeTitle,
        distanceKm: Number(f.distanceKm) || 0,
        ascentM: Math.round(Number(f.ascentM)) || 0,
        points: f.points.map(p => ({ id: p.id, name: p.name, kind: p.kind, coordinates: coordsOrNull(p.lat, p.lng) })),
        risks: f.risks.map(r => ({ id: r.id, title: r.title, advice: r.advice })),
      },
      pickupPoints: f.pickups.map(p => ({
        id: p.id, name: p.name, address: p.address,
        meetingAt: composeDateTime(p.meeting.date, p.meeting.time),
        coordinates: coordsOrNull(p.lat, p.lng),
      })),
      equipment: f.equipmentText.split('\n').map(s => s.trim()).filter(Boolean),
      feeNote: f.feeNote,
      cancellationNote: f.cancellationNote,
    }
  },

  // ---- 通用字段编辑 ----
  onField(e) {
    const key = e.currentTarget.dataset.key
    this.setForm({ [key]: e.detail.value })
  },
  onNumber(e) {
    const key = e.currentTarget.dataset.key
    this.setForm({ [key]: e.detail.value })
  },
  onApproval(e) {
    this.setForm({ approvalMode: ['manual', 'automatic'][Number(e.detail.value) || 0] })
  },
  onAccepting(e) {
    this.setForm({ acceptingSignups: e.detail.value })
  },
  setForm(patch) {
    const form = Object.assign({}, this.data.form, patch)
    this.setData({ form, message: '' })
    this.persistDraft()
  },

  // ---- 日期/时间 ----
  onDate(e) {
    const key = e.currentTarget.dataset.key
    const form = JSON.parse(JSON.stringify(this.data.form))
    form[key].date = e.detail.value
    this.setData({ form, message: '' })
    this.persistDraft()
  },
  onTime(e) {
    const key = e.currentTarget.dataset.key
    const form = JSON.parse(JSON.stringify(this.data.form))
    form[key].time = TIME_SLOTS[Number(e.detail.value)] || '08:00'
    this.setData({ form, message: '' })
    this.persistDraft()
  },
  timeSlotIndex(key) {
    const t = this.data.form[key].time
    const idx = TIME_SLOTS.indexOf(t)
    return idx >= 0 ? idx : TIME_SLOTS.indexOf('08:00')
  },

  onPickupDate(e) {
    const i = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[i].meeting.date = e.detail.value
    this.setData({ form, message: '' })
    this.persistDraft()
  },
  onPickupTime(e) {
    const i = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[i].meeting.time = TIME_SLOTS[Number(e.detail.value)] || '07:00'
    this.setData({ form, message: '' })
    this.persistDraft()
  },

  // ---- 路线节点 ----
  onRoutePoint(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points[index][key] = e.detail.value
    this.setData({ form })
    this.persistDraft()
  },
  onPointKind(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points[index].kind = ['start', 'checkpoint', 'finish'][Number(e.detail.value) || 0]
    this.setData({ form })
    this.persistDraft()
  },
  addPoint() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    const id = freshId('point')
    form.points.push({ id, name: '', kind: form.points.length ? 'checkpoint' : 'start', lat: '', lng: '' })
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
        this.setData({ form })
        this.persistDraft()
      },
      fail: () => {},
    })
  },
  togglePickup(e) {
    const id = e.currentTarget.dataset.id
    const expandedPickups = Object.assign({}, this.data.expandedPickups)
    if (expandedPickups[id]) delete expandedPickups[id]
    else expandedPickups[id] = true
    this.setData({ expandedPickups })
  },
  togglePickupCoords(e) {
    const id = e.currentTarget.dataset.id
    const showPickupCoords = Object.assign({}, this.data.showPickupCoords)
    if (showPickupCoords[id]) delete showPickupCoords[id]
    else showPickupCoords[id] = true
    this.setData({ showPickupCoords })
  },

  useSampleRoute() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.routeTitle = '示例路线（请自行修改）'
    form.points = [
      { id: freshId('point'), name: '示例起点', kind: 'start', lat: '', lng: '' },
      { id: freshId('point'), name: '示例终点', kind: 'finish', lat: '', lng: '' },
    ]
    this.setData({ form, expandedPoints: {}, showPointCoords: {} })
    this.persistDraft()
  },

  // ---- 上车点 ----
  onPickup(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[index][key] = e.detail.value
    this.setData({ form })
    this.persistDraft()
  },
  choosePickupLocation(e) {
    const index = e.currentTarget.dataset.index
    wx.chooseLocation({
      success: res => {
        const form = JSON.parse(JSON.stringify(this.data.form))
        form.pickups[index].lat = String(res.latitude)
        form.pickups[index].lng = String(res.longitude)
        if (!form.pickups[index].address) form.pickups[index].address = res.address || res.name || ''
        this.setData({ form })
        this.persistDraft()
      },
      fail: () => {},
    })
  },
  addPickup() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    const id = freshId('pickup')
    form.pickups.push({ id, name: '', address: '', lat: '', lng: '', meeting: { date: '', time: '' } })
    const expandedPickups = Object.assign({}, this.data.expandedPickups)
    expandedPickups[id] = true
    this.setData({ form, expandedPickups })
    this.persistDraft()
  },
  removePickup(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups.splice(index, 1)
    this.setData({ form })
    this.persistDraft()
  },

  // ---- 风险与装备 ----
  onRisk(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.risks[index][key] = e.detail.value
    this.setData({ form })
    this.persistDraft()
  },
  addRisk() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.risks.push({ id: freshId('risk'), title: '', advice: '' })
    this.setData({ form })
    this.persistDraft()
  },
  removeRisk(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.risks.splice(index, 1)
    this.setData({ form })
    this.persistDraft()
  },

  // ---- 步骤 ----
  setStep(e) {
    this.setData({ step: Number(e.currentTarget.dataset.step) })
  },
  prevStep() { this.setData({ step: Math.max(0, this.data.step - 1) }) },
  nextStep() { this.setData({ step: Math.min(2, this.data.step + 1) }) },

  // ---- 保存 ----
  save(preview) {
    const input = this.buildInput()
    const cap = Number(this.data.form.capacity)
    if (!Number.isInteger(cap) || cap < 1 || cap > 500) {
      this.setData({ step: 2, failure: '人数上限请填写 1–500 的整数。' })
      return
    }
    this.setData({ busy: true, failure: '', message: '' })
    const payload = this.savedId
      ? { type: 'activity.edit', activityId: this.savedId, input }
      : { type: 'activity.create', input }
    api.dispatchAndSync(payload, this.revision, this)
      .then(res => {
        const id = this.savedId || res.targetIds[0]
        this.savedId = id
        this.revision = res.revision
        draft.clearDraft(this.activityId || 'new', 'activity-editor')
        this.setData({
          busy: false,
          savedId: id,
          canPublish: this.data.phase === 'draft',
          message: this.data.phase === 'draft' ? '草稿已保存，尚未发布，也没有自动报名。' : '活动修改已保存。',
        })
        if (preview) wx.navigateTo({ url: '/pages/activity/activity?id=' + id })
      })
      .catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
  },
  onSave() { this.save(false) },
  onSavePreview() { this.save(true) },

  // ---- 复制 ----
  onTemplatePick(e) {
    this.setData({ templateIndex: Number(e.detail.value) })
    const item = this.data.myActivities[Number(e.detail.value)]
    this.setData({ templateId: item ? item.id : '' })
  },
  onCopyTemplate() {
    if (!this.data.templateId || this.data.busy) return
    this.setData({ busy: true, failure: '' })
    api.dispatchAndSync({ type: 'activity.copy', sourceActivityId: this.data.templateId }, this.revision, this)
      .then(res => {
        this.setData({ busy: false })
        const id = res.targetIds[0]
        if (id) wx.redirectTo({ url: '/pages/editor/editor?id=' + id })
      })
      .catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
  },

  // ---- GPX 导入 ----
  onImportGpx() {
    this.setData({ gpxError: '' })
    // wx.chooseMessageFile 是隐私接口：只能选聊天中的文件，且需平台隐私协议声明「选中的文件」。
    // 失败必须显式透出（此前静默导致“点了没反应”）。
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
            gpxError: '公众平台《用户隐私保护指引》尚未声明「选中的文件」，无法从聊天选择文件。请到 mp.weixin.qq.com → 设置 → 服务内容声明 补充并等生效；解析器本身不受影响，真机声明后即可用。',
          })
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
    form.points = points.map(p => ({ id: freshId('point'), name: p.name, kind: p.kind, lat: String(p.coordinates.lat), lng: String(p.coordinates.lng) }))
    if (meta.distanceKm > 0) form.distanceKm = String(meta.distanceKm)
    if (meta.hasElevation) form.ascentM = String(meta.ascentM)
    if (!form.routeTitle.trim()) form.routeTitle = meta.fileName.replace(/\.(gpx|xml)$/i, '')
    this.setData({ gpxOpen: false, form, expandedPoints: {}, showPointCoords: {}, expandedPickups: {}, showPickupCoords: {}, message: '已导入 ' + points.length + ' 个路线节点，记得保存。' })
    this.persistDraft()
  },

  // ---- 发布 ----
  onPublishOpen() {
    this.setData({ publishOpen: true, participate: false, dataUse: false, tripSelf: true, tripPickupIndex: -1, failure: '' })
  },
  onPublishClose() { this.setData({ publishOpen: false }) },
  onParticipate(e) {
    this.setData({ participate: e.detail.value, dataUse: false })
  },
  onDataUse(e) { this.setData({ dataUse: e.detail.value }) },
  onTripChange(e) { this.setData({ tripSelf: e.detail.value === 'self' }) },
  onTripPickup(e) { this.setData({ tripPickupIndex: Number(e.detail.value) }) },

  publish() {
    if (!this.savedId) return
    let participation = null
    if (this.data.participate) {
      if (!this.data.dataUse) {
        this.setData({ failure: '本人参加需要独立确认资料使用授权。' })
        return
      }
      api.read({ kind: 'profile' }).then(res => {
        if (res.view.kind !== 'profile') {
          this.setData({ failure: '当前资料不可用，请先到「我的」完善。' })
          return
        }
        const profile = res.view.profile
        const pickups = this.data.form.pickups
        const usePickup = !this.data.tripSelf && this.data.tripPickupIndex >= 0 && pickups[this.data.tripPickupIndex]
        participation = {
          personRef: { kind: 'user', userId: profile.id },
          participant: profile.person,
          trip: usePickup ? { mode: 'shared', pickupPointId: pickups[this.data.tripPickupIndex].id } : { mode: 'self' },
          consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
        }
        this.doPublish(participation, res.revision)
      }).catch(e => this.setData({ failure: api.errorText(e) }))
    } else {
      this.doPublish(null, this.revision, this)
    }
  },

  doPublish(participation, revision) {
    api.dispatchAndSync({ type: 'activity.publish', activityId: this.savedId, participation }, revision, this)
      .then(() => {
        draft.clearDraft(this.activityId || 'new', 'activity-editor')
        this.setData({ publishOpen: false })
        api.toast('活动已发布')
        wx.redirectTo({ url: '/pages/activity/activity?id=' + this.savedId })
      })
      .catch(e => this.setData({ failure: api.errorText(e) }))
  },
})
