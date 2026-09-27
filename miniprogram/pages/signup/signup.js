// 报名表（新报名 / 编辑三模式：自报、编辑自己或同行人）。对应原型 screens/Signup.tsx。
// 编辑模式需先填写「用途」读取资料（敏感资料授权语义）。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')

const noConsent = () => ({ dataUse: false, proxyAuthority: false, proxyHome: false })
const personKey = ref => ref.kind === 'user' ? 'u:' + ref.userId : 'c:' + ref.companionId

Page({
  data: {
    loading: true,
    denied: '',
    mode: 'new', // new | edit
    purposeGate: false,
    purpose: '',
    activityTitle: '',
    remaining: 0,
    approvalHint: '',
    candidates: [],
    participants: [],
    keepTogether: true,
    errors: {},
    failure: '',
    capacityAsk: false,
    busy: false,
    // 编辑模式
    editForm: null,
    editConsentLocked: false,
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.signupId = options.signupId || ''
    this.mode = this.signupId ? 'edit' : 'new'
    this.setData({ mode: this.mode })
  },

  onShow() {
    if (this.mode === 'edit') {
      // 编辑模式每次进入都要重新按用途读取
      if (this.approvedPurpose) this.loadForm(this.approvedPurpose)
      else this.setData({ loading: false, purposeGate: true })
    } else {
      this.reload()
    }
  },

  reload() {
    return Promise.all([
      api.read({ kind: 'activity', activityId: this.activityId, perspective: 'participant' }),
      api.read({ kind: 'profile' }),
    ]).then(([res, profileRes]) => {
      if (res.view.kind !== 'activity') {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '活动信息不可用' })
        return
      }
      if (profileRes.view.kind !== 'profile') {
        this.setData({ loading: false, denied: '当前资料不可用，请先到「我的」完善资料。' })
        return
      }
      this.revision = res.revision
      this.now = res.now
      const v = res.view
      this.view = v
      const profile = profileRes.view.profile
      if (this.mode === 'new' && v.permittedActions.indexOf('signup.submit') === -1) {
        this.setData({ loading: false, denied: '活动尚未开放、已截止或没有报名权限。已有安排不会改变。' })
        return
      }
      if (this.mode === 'new' && !profile.person.name) {
        this.setData({ loading: false, denied: '请先到「我的」保存姓名与联系电话，再来报名。' })
        return
      }
      const own = {
        key: 'u:' + profile.id,
        kindLabel: '本人',
        person: profile.person,
        personRef: { kind: 'user', userId: profile.id },
        checked: true,
      }
      const companions = profile.companions.map(c => ({
        key: 'c:' + c.id,
        kindLabel: '同行人',
        person: c.person,
        personRef: { kind: 'companion', ownerId: profile.id, companionId: c.id },
        checked: false,
      }))
      this.tripValues = ['self'].concat(v.activity.pickupPoints.map(p => p.id))
      const tripOptions = ['自行前往'].concat(v.activity.pickupPoints.map(p => p.name))
      const saved = draft.getDraft(this.activityId, 'signup')
      let participants = [this.makeParticipant(own)]
      let keepTogether = true
      if (saved) {
        participants = saved.participants || participants
        keepTogether = saved.keepTogether !== false
      }
      // 上车点展示值随 participants 状态变化，渲染前计算
      const withTrip = participants.map(p => Object.assign({}, p, { tripIndex: this.tripIndexOf(p) }))
      this.setData({
        loading: false,
        denied: '',
        activityTitle: v.activity.title || '未命名活动',
        remaining: Math.max(0, v.counters.remaining),
        approvalHint: v.activity.approvalMode === 'manual'
          ? '提交后等待组织者审核，以活动页状态为准。'
          : '符合条件时自动确认，以实际提交结果为准。',
        candidates: [own].concat(companions),
        participants: withTrip,
        keepTogether,
        tripOptions,
      })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  makeParticipant(cand) {
    return {
      key: cand.key,
      kindLabel: cand.kindLabel,
      personRef: cand.personRef,
      person: JSON.parse(JSON.stringify(cand.person)),
      trip: { mode: 'self' },
      consent: noConsent(),
    }
  },

  // ---- 参与人选择 ----
  onToggleCandidate(e) {
    const key = e.currentTarget.dataset.key
    const checked = e.detail.value.length > 0 && e.detail.value.indexOf(key) !== -1
    let participants = this.data.participants.slice()
    if (checked) {
      const cand = this.data.candidates.find(c => c.key === key)
      if (cand && !participants.some(p => p.key === key)) participants.push(this.makeParticipant(cand))
    } else {
      participants = participants.filter(p => p.key !== key)
    }
    this.updateDraft({ participants })
  },

  updateDraft(patch) {
    const next = Object.assign({}, {
      participants: this.data.participants,
      keepTogether: this.data.keepTogether,
    }, patch)
    if (patch.participants) {
      patch = Object.assign({}, patch, { participants: patch.participants.map(p => Object.assign({}, p, { tripIndex: this.tripIndexOf(p) })) })
    }
    draft.setDraft(this.activityId, 'signup', next)
    this.setData(patch)
  },

  onPartField(e) {
    const { index, key } = e.currentTarget.dataset
    const participants = this.data.participants.slice()
    const p = JSON.parse(JSON.stringify(participants[index]))
    if (key === 'name' || key === 'phone' || key === 'medical') p.person[key] = e.detail.value
    else p.person.emergency = Object.assign({}, p.person.emergency, { [key]: e.detail.value })
    participants[index] = p
    this.updateDraft({ participants })
  },

  onPartTrip(e) {
    const index = e.currentTarget.dataset.index
    const value = this.tripValues[Number(e.detail.value)] || 'self'
    const participants = this.data.participants.slice()
    participants[index] = Object.assign({}, participants[index], {
      trip: value === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: value },
    })
    this.updateDraft({ participants })
  },

  tripIndexOf(p) {
    if (p.trip.mode !== 'shared') return 0
    const idx = (this.tripValues || []).indexOf(p.trip.pickupPointId)
    return idx > 0 ? idx : 0
  },

  onPartConsent(e) {
    const { index, key } = e.currentTarget.dataset
    const participants = this.data.participants.slice()
    const p = JSON.parse(JSON.stringify(participants[index]))
    p.consent = Object.assign({}, p.consent, { [key]: e.detail.value })
    participants[index] = p
    this.updateDraft({ participants })
  },

  onKeepTogether(e) { this.updateDraft({ keepTogether: e.detail.value }) },

  tripLabel(p) {
    if (!this.view) return ''
    const a = this.view.activity
    if (p.trip.mode === 'self') return '自行前往'
    const point = a.pickupPoints.find(x => x.id === p.trip.pickupPointId)
    return point ? point.name : '请选择上车点'
  },

  validate() {
    const errors = {}
    if (!this.data.participants.length) errors.selection = '请至少选择一位参与人'
    this.data.participants.forEach((p, index) => {
      const pre = 'p' + index + '-'
      if (!p.person.name.trim()) errors[pre + 'name'] = '请填写姓名'
      if (!F.validPhone(p.person.phone)) errors[pre + 'phone'] = '请填写11位联系电话'
      if (!p.person.emergency.name.trim()) errors[pre + 'ename'] = '请填写紧急联系人'
      if (!F.validPhone(p.person.emergency.phone)) errors[pre + 'ephone'] = '请填写11位紧急联系电话'
      if (p.trip.mode === 'shared' && !p.trip.pickupPointId) errors[pre + 'trip'] = '请选择上车点'
      if (!p.consent.dataUse) errors[pre + 'dataUse'] = '请确认本次活动的数据使用授权'
      if (p.personRef.kind === 'companion' && !p.consent.proxyAuthority) errors[pre + 'proxyAuthority'] = '代报名需要同行人明确授权'
    })
    return errors
  },

  submit(mode) {
    const errors = this.validate()
    this.setData({ errors, failure: '', capacityAsk: false })
    if (Object.keys(errors).length) return
    const payload = {
      type: 'signup.submit',
      activityId: this.activityId,
      participants: this.data.participants.map(p => ({
        personRef: p.personRef,
        participant: p.person,
        trip: p.trip,
        consent: p.consent,
      })),
      keepTogether: this.data.keepTogether,
      mode,
    }
    this.setData({ busy: true })
    api.dispatch(payload, this.revision)
      .then(() => {
        this.setData({ busy: false })
        draft.clearDraft(this.activityId, 'signup')
        api.toast('报名已提交')
        wx.redirectTo({ url: '/pages/activity/activity?id=' + this.activityId })
      })
      .catch(e => {
        if (e.code === 'CAPACITY') {
          this.setData({ busy: false, capacityAsk: true, failure: '' })
        } else {
          this.setData({ busy: false, failure: api.errorText(e) })
        }
      })
  },

  onSubmit() { this.submit('apply') },

  onWaitlist() { this.submit('waitlist') },

  // ---- 编辑模式 ----
  onPurpose(e) { this.setData({ purpose: e.detail.value }) },

  onApprovePurpose() {
    const purpose = this.data.purpose.trim()
    if (!purpose) return
    this.loadForm(purpose)
  },

  loadForm(purpose) {
    // 先刷新 revision（编辑模式可能没有读过活动视图）
    api.read({ kind: 'profile' }).then(res => {
      this.revision = res.revision
      this.now = res.now
      return api.readForm(this.activityId, this.signupId, purpose)
    }).then(result => {
      if (!result.ok) {
        this.setData({ loading: false, denied: result.error.message })
        return
      }
      this.approvedPurpose = purpose
      const input = result.value.input
      this.setData({
        loading: false,
        purposeGate: false,
        denied: '',
        activityTitle: (this.view && this.view.activity ? this.view.activity.title : '') || '报名资料',
        editForm: {
          signupId: result.value.signupId,
          person: input.participant,
          trip: input.trip,
          consent: input.consent,
        },
        editConsentLocked: true,
        errors: {},
        failure: '',
      })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  onEditField(e) {
    const key = e.currentTarget.dataset.key
    const form = JSON.parse(JSON.stringify(this.data.editForm))
    if (key === 'name' || key === 'phone' || key === 'medical') form.person[key] = e.detail.value
    else form.person.emergency = Object.assign({}, form.person.emergency, { [key]: e.detail.value })
    this.setData({ editForm: form })
  },

  onEditTrip(e) {
    const value = e.detail.value
    const form = JSON.parse(JSON.stringify(this.data.editForm))
    form.trip = value === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: value }
    this.setData({ editForm: form })
  },

  onEditSubmit() {
    const form = this.data.editForm
    const errors = {}
    if (!form.person.name.trim()) errors.name = '请填写姓名'
    if (!F.validPhone(form.person.phone)) errors.phone = '请填写11位联系电话'
    if (!form.person.emergency.name.trim()) errors.ename = '请填写紧急联系人'
    if (!F.validPhone(form.person.emergency.phone)) errors.ephone = '请填写11位紧急联系电话'
    if (form.trip.mode === 'shared' && !form.trip.pickupPointId) errors.trip = '请选择上车点'
    this.setData({ errors })
    if (Object.keys(errors).length) return
    this.setData({ busy: true })
    api.dispatch({
      type: 'signup.edit',
      activityId: this.activityId,
      signupId: this.signupId,
      participant: form.person,
      trip: form.trip,
      purpose: this.approvedPurpose,
    }, this.revision).then(() => {
      this.setData({ busy: false })
      api.toast('修改已保存')
      wx.redirectTo({ url: '/pages/activity/activity?id=' + this.activityId + '&signupId=' + this.signupId })
    }).catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
  },
})
