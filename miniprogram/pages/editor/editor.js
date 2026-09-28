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
    track: (input.routeSnapshot.track || []).slice(),
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

// ---- 时间快捷估算：以出发时刻为锚（中国无夏令时，固定 +08:00 安全）----
// 平移 N 天/加 N 小时后返回北京墙上时间的 {date, time}
function shiftDateTime(dateStr, timeStr, days, addHours) {
  const base = Date.parse(dateStr + 'T' + timeStr + ':00+08:00') + (days || 0) * 86400000 + (addHours || 0) * 3600000
  if (!Number.isFinite(base)) return null
  const iso = new Date(base + 8 * 3600000).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
}
// 当天往返：出发后 8 小时；跨到次日则兜底出发当天 23:30
function quickSameDayEnd(start) {
  const shifted = shiftDateTime(start.date, start.time, 0, 8)
  if (!shifted || shifted.date !== start.date) return { date: start.date, time: '23:30' }
  return shifted
}

const freshId = kind => kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
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
    // 复制
    myActivities: [],
    templateId: '',
    templateIndex: -1,
    // 发布
    publishOpen: false,
    deleteDraftOpen: false,
    participate: false,
    dataUse: false,
    tripSelf: true,
    tripPickupIndex: -1,
    // 反馈
    failure: '',
    message: '',
    busy: false,
    // GPX 导入
    gpxOpen: false,
    gpxError: '',
    gpxMeta: null,
    gpxPoints: [],
    gpxTrack: [],
    gpxSuggest: null,
    // 渐进披露：节点/上车点默认收合，坐标默认隐藏
    expandedPoints: {},
    showPointCoords: {},
    editingPickups: {},
    showPickupCoords: {},
    expandedTimes: {},
    expandedIntro: false,
    editingRisks: {},
    editingExtras: false,
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
    const input = {
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
    // 轨迹折线（GPX 导入产生，用户不可编辑）：不足 2 点时不带该键，schema 按 specOpt 兼容缺省
    if (Array.isArray(f.track) && f.track.length >= 2) {
      input.routeSnapshot.track = f.track
    }
    return input
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
    this.applyTimeEdit(e.currentTarget.dataset.key, { date: e.detail.value })
  },
  onTime(e) {
    // mode="time" 的 e.detail.value 就是 'HH:mm'（此前误当 TIME_SLOTS 索引，任何选择都落到 08:00）
    this.applyTimeEdit(e.currentTarget.dataset.key, { time: e.detail.value })
  },
  // 统一入口：写入 + 出发时间驱动的预填/联动。
  // 派生标记 dt_end_quick/dt_deadline_quick（仅内存态，不进草稿与提交）：'quick'=跟随出发重算，'custom'=用户手改后不再联动。
  applyTimeEdit(key, patch) {
    const form = JSON.parse(JSON.stringify(this.data.form))
    Object.assign(form[key], patch)
    if (key === 'dt_end' || key === 'dt_deadline') form[key + '_quick'] = 'custom'
    const s = form.dt_start
    if (key === 'dt_start' && s.date && s.time) {
      if (form.dt_end_quick !== 'custom' && (!form.dt_end.date || form.dt_end_quick === 'quick')) {
        const end = quickSameDayEnd(s)
        if (end) { form.dt_end = end; form.dt_end_quick = 'quick' }
      }
      if (form.dt_deadline_quick !== 'custom' && (!form.dt_deadline.date || form.dt_deadline_quick === 'quick')) {
        const dl = shiftDateTime(s.date, s.time, -1)
        if (dl) { form.dt_deadline = dl; form.dt_deadline_quick = 'quick' }
      }
    }
    this.setData({ form, message: '' })
    this.persistDraft()
  },
  // 快捷估算结束时间：当天往返 / 出发后 N 天（保持出发时刻的时钟时间），填入即收起并标记为联动
  onQuickEnd(e) {
    const s = this.data.form.dt_start
    if (!s.date || !s.time) return
    const kind = e.currentTarget.dataset.kind
    const end = kind === 'same' ? quickSameDayEnd(s) : shiftDateTime(s.date, s.time, Number(kind) || 2)
    if (!end) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.dt_end = end
    form.dt_end_quick = 'quick'
    const expandedTimes = Object.assign({}, this.data.expandedTimes)
    delete expandedTimes.dt_end
    this.setData({ form, expandedTimes, message: '' })
    this.persistDraft()
  },
  // 快捷估算报名截止：出发前 N 天（同一时钟时间）
  onQuickDeadline(e) {
    const s = this.data.form.dt_start
    if (!s.date || !s.time) return
    const shifted = shiftDateTime(s.date, s.time, -(Number(e.currentTarget.dataset.days) || 1))
    if (!shifted) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.dt_deadline = shifted
    form.dt_deadline_quick = 'quick'
    const expandedTimes = Object.assign({}, this.data.expandedTimes)
    delete expandedTimes.dt_deadline
    this.setData({ form, expandedTimes, message: '' })
    this.persistDraft()
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
    form.pickups[i].meeting.time = e.detail.value
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
    const editingPickups = Object.assign({}, this.data.editingPickups)
    if (editingPickups[id]) delete editingPickups[id]
    else editingPickups[id] = true
    this.setData({ editingPickups })
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
    form.track = [] // 换路线丢弃旧轨迹，避免与其他来源的节点错配
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
    // 集合默认=出发前 30 分钟（日期跟随出发日）；出发时间未填则待定
    const s = this.data.form.dt_start
    const meeting = (s.date && s.time)
      ? (shiftDateTime(s.date, s.time, 0, -0.5) || { date: '', time: '' })
      : { date: '', time: '' }
    form.pickups.push({ id, name: '', address: '', lat: '', lng: '', meeting })
    const editingPickups = Object.assign({}, this.data.editingPickups)
    editingPickups[id] = true
    this.setData({ form, editingPickups })
    this.persistDraft()
  },
  // 集合时刻快捷估算：与出发同时 / 提前 30 分 / 提前 1 小时（跨天如实跨天）
  onPickupQuickTime(e) {
    const i = Number(e.currentTarget.dataset.index)
    const s = this.data.form.dt_start
    if (!s.date || !s.time) return
    const offset = Number(e.currentTarget.dataset.offset) || 0
    const shifted = offset === 0 ? { date: s.date, time: s.time } : shiftDateTime(s.date, s.time, 0, offset / 60)
    if (!shifted) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[i].meeting = shifted
    this.setData({ form, message: '' })
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
    const id = freshId('risk')
    form.risks.push({ id, title: '', advice: '' })
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

  toggleTime(e) {
    const key = e.currentTarget.dataset.key
    const expandedTimes = Object.assign({}, this.data.expandedTimes)
    if (expandedTimes[key]) delete expandedTimes[key]
    else expandedTimes[key] = true
    this.setData({ expandedTimes })
  },
  toggleIntro() {
    this.setData({ expandedIntro: !this.data.expandedIntro })
  },
  toggleRisk(e) {
    const id = e.currentTarget.dataset.id
    const editingRisks = Object.assign({}, this.data.editingRisks)
    if (editingRisks[id]) delete editingRisks[id]
    else editingRisks[id] = true
    this.setData({ editingRisks })
  },
  toggleExtras() {
    this.setData({ editingExtras: !this.data.editingExtras })
  },

  // ---- 步骤 ----
  setStep(e) {
    this.setData({ step: Number(e.currentTarget.dataset.step) })
  },
  prevStep() { this.setData({ step: Math.max(0, this.data.step - 1) }) },
  nextStep() { this.setData({ step: Math.min(2, this.data.step + 1) }) },

  // ---- 保存 ----
  capacityInvalid() {
    const cap = Number(this.data.form.capacity)
    return !Number.isInteger(cap) || cap < 1 || cap > 500
  },
  // 校验并把当前表单落为服务器草稿（新建则创建，已保存则编辑）。「发布」入口与保存共用，
  // 保证发布确认弹出的内容就是刚保存的当前内容。resolve(id) / reject(已透出 failure)。
  persistCurrent(successMessage) {
    if (this.capacityInvalid()) {
      this.setData({ step: 2, failure: '人数上限请填写 1–500 的整数。' })
      return Promise.reject(new Error('capacity'))
    }
    this.setData({ busy: true, failure: '', message: '' })
    // 域层不变量要求发起者已有落库档案（profile.save 硬性要求姓名+手机号），否则任何保存/发布都会被拒。
    // read({kind:'profile'}) 无档案时也返回 kind:'profile' 的空壳（selectors 对首访返回空档案），
    // 因此以姓名/手机号是否实际填写为准。提前拦截并给出可操作指引，而不是透出"路线归属或节点标识无效"。
    return api.read({ kind: 'profile' }).then(res => {
      const person = res.view && res.view.profile && res.view.profile.person
      if (!person || !person.name || !person.phone) {
        const err = new Error('请先到「我的」补全姓名与手机号（填齐会自动保存），再回来保存或发布——活动归属与安全联络必需。')
        this.setData({ busy: false, failure: err.message })
        throw err
      }
      const input = this.buildInput()
      const payload = this.savedId
        ? { type: 'activity.edit', activityId: this.savedId, input }
        : { type: 'activity.create', input }
      return api.dispatchAndSync(payload, this.revision, this).then(res2 => {
        const id = this.savedId || res2.targetIds[0]
        this.savedId = id
        this.revision = res2.revision
        draft.clearDraft(this.activityId || 'new', 'activity-editor')
        this.setData({
          busy: false,
          savedId: id,
          message: successMessage,
        })
        return id
      })
    }).catch(e => {
      this.setData({ busy: false, failure: api.errorText(e) })
      throw e
    })
  },
  save(preview) {
    this.persistCurrent(this.data.phase === 'draft' ? '草稿已保存，尚未发布，也没有自动报名。' : '活动修改已保存。')
      .then(id => { if (preview && id) wx.navigateTo({ url: '/pages/activity/activity?id=' + id }) })
      .catch(() => {})
  },
  // 发布前逐项预检（与服务端 full 校验对齐）：返回缺失项 [{step, label}]，
  // 让用户在对应步骤就被明确告知缺什么，而不是发布时撞到一句笼统的服务端报错。
  missingForPublish() {
    const f = this.data.form
    const missing = []
    if (!f.title.trim()) missing.push({ step: 0, label: '活动名称' })
    if (!f.dt_start.date || !f.dt_start.time) missing.push({ step: 0, label: '出发时间' })
    if (!f.dt_end.date || !f.dt_end.time) missing.push({ step: 0, label: '预计结束时间' })
    if (!f.dt_deadline.date || !f.dt_deadline.time) missing.push({ step: 0, label: '报名截止时间' })
    if (f.dt_start.date && f.dt_start.time && f.dt_end.date && f.dt_end.time && f.dt_deadline.date && f.dt_deadline.time) {
      const s = Date.parse(composeDateTime(f.dt_start.date, f.dt_start.time))
      const e = Date.parse(composeDateTime(f.dt_end.date, f.dt_end.time))
      const d = Date.parse(composeDateTime(f.dt_deadline.date, f.dt_deadline.time))
      if (!(d <= s && s < e)) missing.push({ step: 0, label: '时间顺序（截止 ≤ 出发，且早于结束）' })
    }
    if (!f.routeTitle.trim()) missing.push({ step: 1, label: '路线名称' })
    if (!f.points.length) missing.push({ step: 1, label: '至少 1 个路线节点' })
    else if (f.points.some(p => !p.name.trim())) missing.push({ step: 1, label: '每个路线节点的名称' })
    if (!f.pickups.length) missing.push({ step: 1, label: '至少 1 个集合上车点' })
    else if (f.pickups.some(p => !p.name.trim() || !p.address.trim() || !p.meeting.date || !p.meeting.time)) missing.push({ step: 1, label: '集合上车点的名称、地址与集合时间' })
    if (!f.risks.length) missing.push({ step: 2, label: '至少 1 条风险提示' })
    else if (f.risks.some(r => !r.title.trim() || !r.advice.trim())) missing.push({ step: 2, label: '每条风险的问题与应对方式' })
    return missing
  },
  // 步骤 3 常驻发布入口：先预检缺失项（跳到第一步并逐项点名），再静默保存，最后弹发布确认。
  onPublishIntent() {
    if (this.data.busy) return
    const missing = this.missingForPublish()
    if (missing.length) {
      this.setData({ step: missing[0].step, failure: '还差：' + missing.map(m => m.label).join('、') + '。补齐后再发布。' })
      return
    }
    this.persistCurrent('内容已保存，确认后正式发布。')
      .then(() => this.onPublishOpen())
      .catch(() => {})
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
    form.track = (this.data.gpxTrack || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    // 预填风险与装备：只填空字段，用户已填内容不覆盖
    const sug = this.data.gpxSuggest
    let prefilled = ''
    if (sug) {
      if (!form.risks.length && sug.risks && sug.risks.length) {
        form.risks = sug.risks.map(r => ({ id: freshId('risk'), title: r.title, advice: r.advice }))
        prefilled = '，并预填 ' + form.risks.length + ' 条风险提示'
      }
      if (!form.equipmentText.trim() && sug.equipment && sug.equipment.length) {
        form.equipmentText = sug.equipment.join('\n')
        prefilled += (prefilled ? '与装备清单' : '，并预填装备清单')
      }
    }
    if (meta.distanceKm > 0) form.distanceKm = String(meta.distanceKm)
    if (meta.hasElevation) form.ascentM = String(meta.ascentM)
    if (!form.routeTitle.trim()) form.routeTitle = meta.fileName.replace(/\.(gpx|xml)$/i, '')
    this.setData({ gpxOpen: false, form, expandedPoints: {}, showPointCoords: {}, editingPickups: {}, showPickupCoords: {}, message: '已导入 ' + points.length + ' 个路线节点' + prefilled + '，记得在后续步骤核对保存。' })
    this.persistDraft()
  },

  // ---- 删除草稿：仅草稿可删；已发布活动走工作台的取消 ----
  onDeleteDraftOpen() {
    this.setData({ deleteDraftOpen: true, failure: '' })
  },
  onDeleteDraftClose() {
    this.setData({ deleteDraftOpen: false })
  },
  onDeleteDraftConfirm() {
    if (this.data.busy) return
    if (!this.savedId) {
      // 还没保存过服务器：删除只清本机草稿
      draft.clearDraft(this.activityId || 'new', 'activity-editor')
      api.toast('草稿已删除')
      wx.switchTab({ url: '/pages/home/home' })
      return
    }
    this.setData({ busy: true, deleteDraftOpen: false })
    api.dispatchAndSync({ type: 'activity.delete', activityId: this.savedId }, this.revision, this)
      .then(() => {
        draft.clearDraft(this.activityId || 'new', 'activity-editor')
        api.toast('草稿已删除')
        wx.switchTab({ url: '/pages/home/home' })
      })
      .catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
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
