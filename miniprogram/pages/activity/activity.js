// 活动详情（参与者落地页 + 活动日自助操作）。对应原型 screens/ActivityDetail.tsx。
// 差异：模拟定位改为真实 wx.getLocation（一次性上报，不追踪）。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')

const KIND_OPTIONS = [
  { value: 'other', label: '其他需要协助' },
  { value: 'late', label: '迟到' },
  { value: 'withdrawal', label: '提前退出同行' },
  { value: 'injury', label: '伤病' },
]

Page({
  data: {
    loading: true,
    denied: '',
    // 头部
    isDraft: false,
    draftNotice: false,
    badgeText: '',
    startAtLabel: '',
    title: '',
    routeTitle: '',
    distance: 0,
    ascent: 0,
    confirmed: 0,
    capacity: 0,
    stateKey: '',
    stateTitle: '',
    stateDetail: '',
    stateTone: 'success',
    countersLine: '',
    // 操作
    isOwner: false,
    canSubmit: false,
    canSelfSheet: false,
    selfButton: '',
    // 列表
    rows: [],
    primaryId: '',
    description: '',
    organizerIntro: '',
    times: [],
    points: [],
    pickups: [],
    risks: [],
    equipment: [],
    feeNote: '',
    cancellationNote: '',
    // 弹层
    sheetOpen: false,
    selRow: null,
    selNote: '',
    selPointIndex: -1,
    selPoints: [],
    selKindIndex: 0,
    kindOptions: KIND_OPTIONS.map(k => k.label),
    selConsent: false,
    selPurpose: '',
    selSensitive: null,
    selError: '',
    selMessage: '',
    showPosBox: false,
    canCancel: false,
    canEdit: false,
    canCheckin: false,
    canNode: false,
    canHome: false,
    canIncident: false,
    canPosReport: false,
    canPosRevoke: false,
    busy: false,
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.selectedSignupId = options.signupId || ''
    this.revision = 0
    this.now = ''
  },

  onShow() {
    this.reload()
  },

  onShareAppMessage() {
    return {
      title: this.data.title ? this.data.title + ' · 一起同行' : 'OurTrail · 活动邀请',
      path: '/pages/activity/activity?id=' + this.activityId,
    }
  },

  reload() {
    if (!this.activityId) {
      this.setData({ loading: false, denied: '缺少活动编号。' })
      return
    }
    const request = { kind: 'activity', activityId: this.activityId, perspective: 'participant' }
    if (this.selectedSignupId) request.selectedSignupId = this.selectedSignupId
    return api.read(request).then(res => {
      this.revision = res.revision
      this.now = res.now
      draft.rememberActivity(this.activityId)
      if (res.view.kind !== 'activity') {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '活动不可用' })
        return
      }
      this.view = res.view
      this.renderView()
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  renderView() {
    const v = this.view
    const a = v.activity
    const stateKey = v.detailState
    const stateCopy = F.DETAIL_STATE_TITLES[stateKey] || ['', '']
    const warnStates = ['cancelled', 'closed', 'waitlist']
    const isOwnerReal = v.permittedActions.indexOf('activity.edit') !== -1
    const selfButton = stateKey === 'gathering' ? '我已到达 · 去签到'
      : stateKey === 'closing' ? '确认返程与到家'
        : ['active', 'checked'].indexOf(stateKey) !== -1 ? '更新我的同行状态' : ''
    const rows = v.rows.map(r => ({
      signupId: r.signupId,
      name: r.name,
      avatar: r.avatar || '',
      statusLabel: F.STATUS_LABELS[r.status] || r.status,
      tone: r.status === 'confirmed' ? 'success' : 'neutral',
      subtitle: [
        r.pickup,
        r.vehicle || (r.pickup !== '自行前往' ? '车辆待安排' : ''),
        r.seat ? r.seat + ' 座' : '',
        r.home ? '已安全到家' : (r.checkedIn ? '已签到' : ''),
      ].filter(Boolean).join(' · '),
      isPrimary: r.signupId === v.primarySignupId,
    }))
    const times = [
      { label: '出发时间', value: F.dtLabel(a.startAt) },
      { label: '预计结束', value: F.dtLabel(a.endAt) },
      { label: '报名截止', value: F.dtLabel(a.deadlineAt) },
    ]
    const points = a.routeSnapshot.points.map((p, i) => ({
      id: p.id,
      name: p.name,
      kindLabel: String(i + 1).padStart(2, '0') + ' · ' + (p.kind === 'start' ? '起点' : p.kind === 'finish' ? '终点' : '途中节点'),
    }))
    const pickups = a.pickupPoints.map(p => ({ id: p.id, name: p.name, address: p.address, time: F.dtLabel(p.meetingAt) }))
    const risks = a.routeSnapshot.risks.map(r => ({ id: r.id, title: r.title, advice: r.advice }))
    this.setData({
      loading: false,
      denied: '',
      isDraft: a.phase === 'draft',
      draftNotice: a.phase === 'draft',
      badgeText: a.phase === 'draft' ? '草稿' : stateKey === 'cancelled' ? '已取消' : stateKey === 'finished' ? '已归档' : '一起同行',
      startAtLabel: F.dtLabel(a.startAt),
      title: a.title || '未命名活动',
      routeTitle: a.routeSnapshot.title || '路线待完善',
      distance: a.routeSnapshot.distanceKm,
      ascent: a.routeSnapshot.ascentM,
      confirmed: v.counters.confirmed,
      capacity: a.capacity,
      stateKey,
      stateTitle: stateCopy[0],
      stateDetail: stateCopy[1],
      stateTone: warnStates.indexOf(stateKey) !== -1 ? 'warning' : 'success',
      countersLine: '待审核 ' + v.counters.pending + ' 人 · 候补 ' + v.counters.waitlisted + ' 人 · 剩余 ' + v.counters.remaining + ' 个名额',
      isOwner: isOwnerReal,
      canSubmit: !a.phase || (v.permittedActions.indexOf('signup.submit') !== -1 && stateKey === 'new'),
      canSelfSheet: !!(primary && primary.status === 'confirmed' && ['gathering', 'checked', 'active', 'closing'].indexOf(stateKey) !== -1),
      selfButton,
      rows,
      primaryId: v.primarySignupId || '',
      description: a.description || '活动说明待补充。',
      organizerIntro: a.organizerIntro,
      times, points, pickups, risks,
      equipment: a.equipment,
      feeNote: a.feeNote || '费用待组织者说明。',
      cancellationNote: a.cancellationNote,
      canCancelRow: v.permittedActions.indexOf('signup.cancel') !== -1,
      canEditRow: v.permittedActions.indexOf('signup.edit') !== -1,
    })
    wx.setNavigationBarTitle({ title: this.data.title || '活动详情' })
  },

  onToggleRow(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.primaryId === id) {
      this.selectedSignupId = ''
    } else {
      this.selectedSignupId = id
    }
    this.reload()
  },

  onWorkspace() {
    if (this.data.isDraft) wx.navigateTo({ url: '/pages/editor/editor?id=' + this.activityId })
    else wx.navigateTo({ url: '/pages/workspace/workspace?id=' + this.activityId })
  },

  onSignup() {
    wx.navigateTo({ url: '/pages/signup/signup?id=' + this.activityId })
  },

  onWeather() {
    wx.navigateTo({ url: '/pages/weather/weather?id=' + this.activityId })
  },

  onNotices() {
    wx.navigateTo({ url: '/pages/anotices/anotices?id=' + this.activityId })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  onSelfSheet() {
    if (this.data.primaryId) this.openSheet({ currentTarget: { dataset: { id: this.data.primaryId } } })
  },

  // ---- 同行人操作弹层 ----
  openSheet(e) {
    const id = e.currentTarget.dataset.id
    const row = this.view.rows.find(r => r.signupId === id)
    if (!row) return
    const a = this.view.activity
    this.setData({
      sheetOpen: true,
      selRow: {
        signupId: row.signupId,
        name: row.name,
        statusLabel: F.STATUS_LABELS[row.status] || row.status,
        line: [row.pickup, row.vehicle, row.seat ? row.seat + '座' : ''].filter(Boolean).join(' · '),
      },
      selNote: '',
      selPointIndex: -1,
      selPoints: a.routeSnapshot.points.map((p, i) => ({ value: i, label: p.name })),
      selKindIndex: 0,
      selConsent: false,
      selPurpose: '',
      selSensitive: null,
      selError: '',
      selMessage: '',
      showPosBox: false,
      canCancel: this.view.permittedActions.indexOf('signup.cancel') !== -1
        && a.phase === 'published'
        && ['pending', 'confirmed', 'waitlisted'].indexOf(row.status) !== -1,
      canEdit: this.view.permittedActions.indexOf('signup.edit') !== -1
        && a.phase === 'published'
        && ['pending', 'confirmed', 'waitlisted'].indexOf(row.status) !== -1,
      canCheckin: this.view.permittedActions.indexOf('attendance.checkin') !== -1
        && row.status === 'confirmed' && !row.checkedIn
        && (a.phase === 'gathering' || (a.phase === 'active' && row.departure === 'coordinating')),
      canNode: this.view.permittedActions.indexOf('attendance.node') !== -1
        && a.phase === 'active' && row.status === 'confirmed' && row.departure === 'joined',
      canHome: (this.view.permittedActions.indexOf('attendance.home') !== -1 || row.signupId === v.primarySignupId)
        && a.phase === 'closing' && row.status === 'confirmed' && row.departure === 'joined' && !row.home,
      canIncident: ['gathering', 'active', 'closing'].indexOf(a.phase) !== -1 && row.status === 'confirmed'
        && this.view.permittedActions.indexOf('incident.report') !== -1,
      canPosReport: row.signupId === v.primarySignupId
        && ['gathering', 'active'].indexOf(a.phase) !== -1 && row.status === 'confirmed' && row.departure === 'joined'
        && this.view.permittedActions.indexOf('position.report') !== -1,
      canPosRevoke: this.view.permittedActions.indexOf('position.revoke') !== -1,
    })
  },

  closeSheet() { this.setData({ sheetOpen: false }) },

  onSelNote(e) { this.setData({ selNote: e.detail.value }) },
  onSelPoint(e) { this.setData({ selPointIndex: Number(e.detail.value) }) },
  onSelKind(e) { this.setData({ selKindIndex: Number(e.detail.value) }) },
  onSelConsent(e) { this.setData({ selConsent: e.detail.value }) },
  onSelPurpose(e) {
    this.setData({ selPurpose: e.detail.value, selSensitive: null })
  },

  selPayload(extra) {
    return Object.assign({
      activityId: this.activityId,
      signupId: this.data.selRow.signupId,
    }, extra)
  },

  run(payload, successMsg) {
    if (this.data.busy) return
    this.setData({ busy: true, selError: '', selMessage: '' })
    api.dispatchAndSync(payload, this.revision, this)
      .then(() => {
        this.setData({ busy: false, selMessage: successMsg })
        wx.vibrateShort({ type: 'light', fail: () => {} })
        api.toast(successMsg)
        return this.reload()
      })
      .catch(e => this.setData({ busy: false, selError: api.errorText(e) }))
  },

  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: res => resolve({ lat: res.latitude, lng: res.longitude }),
        fail: () => reject(new Error('未获得定位授权，可在设置中开启，或改用文字说明由组织者代签。')),
      })
    })
  },

  onCheckin() {
    this.getLocation().then(coords => {
      this.run(this.selPayload({
        checkIn: { method: 'simulation', evidence: { at: '', by: '', note: '本人定位签到' }, coordinates: coords },
      }), '签到已保存。')
    }).catch(err => {
      // 定位不可用：退回人工签到，需填写说明
      if (!this.data.selNote.trim()) {
        this.setData({ selError: err.message + ' 也可以在「本次说明」里写明现场情况后再签到。' })
        return
      }
      this.run(this.selPayload({
        checkIn: { method: 'manual', evidence: { at: '', by: '', note: this.data.selNote } },
      }), '签到已保存。')
    })
  },

  onHome() {
    this.run(this.selPayload({ note: this.data.selNote }), '安全到家已记录。')
  },

  onNode() {
    if (this.data.selPointIndex < 0) return
    const point = this.view.activity.routeSnapshot.points[this.data.selPointIndex]
    if (!point) return
    this.run(this.selPayload({ pointId: point.id, note: this.data.selNote }), '节点到达已保存。')
  },

  onIncident() {
    if (!this.data.selNote.trim()) {
      this.setData({ selError: '请在「本次说明」里写明现状、去向与需要的帮助。' })
      return
    }
    const kind = KIND_OPTIONS[this.data.selKindIndex].value
    this.run({
      type: 'incident.report',
      activityId: this.activityId,
      signupIds: [this.data.selRow.signupId],
      kind,
      description: this.data.selNote,
    }, '报备已保存，请主动联系现场负责人。')
  },

  onTogglePosBox() { this.setData({ showPosBox: !this.data.showPosBox }) },

  onPosReport() {
    if (!this.data.selConsent) return
    this.getLocation().then(coords => {
      this.run(this.selPayload({ type: 'position.report', coordinates: coords, consent: true }), '本次位置已上报。')
    }).catch(err => this.setData({ selError: err.message }))
  },

  onPosRevoke() {
    this.run({ type: 'position.revoke', activityId: this.activityId, signupId: this.data.selRow.signupId }, '位置共享已撤回。')
  },

  onSensitive() {
    if (!this.data.selPurpose.trim()) return
    api.readSensitive(this.activityId, this.data.selRow.signupId, this.data.selPurpose.trim())
      .then(result => {
        if (result.ok) this.setData({ selSensitive: result.value })
        else this.setData({ selSensitive: null, selError: result.error.message })
      })
      .catch(e => this.setData({ selError: api.errorText(e) }))
  },

  onEditRow() {
    this.setData({ sheetOpen: false })
    wx.navigateTo({ url: '/pages/signup/signup?id=' + this.activityId + '&signupId=' + this.data.selRow.signupId })
  },

  onCancelRow() {
    if (!this.data.selNote.trim()) {
      this.setData({ selError: '取消报名需要说明原因。' })
      return
    }
    this.run({
      type: 'signup.cancel',
      activityId: this.activityId,
      signupIds: [this.data.selRow.signupId],
      reason: this.data.selNote,
    }, '此人的报名已取消，其他同行人的状态未改变。')
  },
})
