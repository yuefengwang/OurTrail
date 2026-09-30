// 报名表（新报名 / 编辑三模式：自报、编辑自己或同行人）。对应原型 screens/Signup.tsx。
// 编辑模式需先填写「用途」读取资料（敏感资料授权语义）。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')

const noConsent = () => ({ dataUse: false, proxyAuthority: false, proxyHome: false })
const personKey = ref => ref.kind === 'user' ? 'u:' + ref.userId : 'c:' + ref.companionId
// checkbox 的 change 值统一归一化：checkbox-group 的 detail.value 是勾选项数组（['1']/[]），
// 独立 checkbox 是布尔——两种形状都收，杜绝真机上事件值形状差异导致的「勾了却按未勾处理」。
const toggleOn = v => Array.isArray(v) ? v.length > 0 : !!v

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
    expandedParts: {},
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
      // 档案快照：报名表回填（草稿可能早于「我的」的最新资料）与提交后回写都以它为基准
      this.profilePerson = JSON.parse(JSON.stringify(profile.person))
      this.profileCompanions = JSON.parse(JSON.stringify(profile.companions))
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
      // 本地草稿可能早于「我的」页的最新资料：空字段从档案补齐（已填的不覆盖）
      const withTrip = participants.map(p => this.decorateParticipant(this.fillFromProfile(p)))
      // 表单减压设计：资料齐全折叠为一行，不齐的参与人装配时自动展开
      const expandedParts = {}
      withTrip.forEach(p => { if (!p.complete) expandedParts[p.key] = true })
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
        expandedParts,
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

  // 渲染前的展示装饰：资料完整度徽标 + 上车点 picker 选中下标。
  // 草稿存原始参与者（不含装饰键），装饰只进 setData；complete 不含 medical（备注可选）。
  decorateParticipant(p) {
    const person = p.person || {}
    const emergency = person.emergency || {}
    return Object.assign({}, p, {
      complete: !!(person.name && person.phone && emergency.name && emergency.phone),
      tripIndex: this.tripIndexOf(p),
    })
  },

  // 已在「我的」登记过的资料直接展示：草稿参与人只补空字段（姓名/电话/紧急联系/备注），
  // 用户在表单里已填的内容一律不覆盖；本人取档案，同行人按 companionId 回查常用同行人。
  fillFromProfile(p) {
    const src = p.personRef.kind === 'user'
      ? this.profilePerson
      : (this.profileCompanions || []).find(c => c.id === p.personRef.companionId)
    if (!src || !p.person) return p
    const person = JSON.parse(JSON.stringify(p.person))
    ;['name', 'phone', 'medical'].forEach(k => {
      if (!String(person[k] || '').trim()) person[k] = src[k] || ''
    })
    const emergency = Object.assign({ name: '', phone: '' }, person.emergency)
    const srcEm = src.emergency || {}
    if (!String(emergency.name || '').trim()) emergency.name = srcEm.name || ''
    if (!String(emergency.phone || '').trim()) emergency.phone = srcEm.phone || ''
    person.emergency = emergency
    return Object.assign({}, p, { person })
  },

  // 编辑即纠错：重算校验但只保留仍未解决的错误——用户勾上授权/补全字段的那一刻，
  // 对应红字就地消失（错误文案只在提交时重算的话，会一直挂着像流程被卡死）。
  // 只清不加：输入过程中（如电话没输完）不会冒出新报错。
  clearResolvedErrors() {
    const stale = this.data.errors
    if (!Object.keys(stale).length) return
    const current = this.validate()
    const errors = {}
    let changed = false
    Object.keys(stale).forEach(k => {
      if (current[k]) errors[k] = current[k]
      else changed = true
    })
    if (changed) this.setData({ errors })
  },

  // ---- 参与人选择 ----
  onToggleCandidate(e) {
    const key = e.currentTarget.dataset.key
    const checked = e.detail.value.length > 0 && e.detail.value.indexOf(key) !== -1
    let participants = this.data.participants.slice()
    if (checked) {
      const cand = this.data.candidates.find(c => c.key === key)
      if (cand && !participants.some(p => p.key === key)) {
        participants.push(this.makeParticipant(cand))
        const expandedParts = Object.assign({}, this.data.expandedParts)
        expandedParts[key] = true
        this.setData({ expandedParts })
      }
    } else {
      participants = participants.filter(p => p.key !== key)
    }
    this.updateDraft({ participants })
    this.clearResolvedErrors()
  },

  updateDraft(patch) {
    const next = Object.assign({}, {
      participants: this.data.participants,
      keepTogether: this.data.keepTogether,
    }, patch)
    if (patch.participants) {
      patch = Object.assign({}, patch, { participants: patch.participants.map(p => this.decorateParticipant(p)) })
    }
    draft.setDraft(this.activityId, 'signup', next)
    this.setData(patch)
  },

  // 参与人卡展开/收起
  togglePart(e) {
    const key = e.currentTarget.dataset.key
    const expandedParts = Object.assign({}, this.data.expandedParts)
    if (expandedParts[key]) delete expandedParts[key]
    else expandedParts[key] = true
    this.setData({ expandedParts })
  },
  // 阻止卡片内点击冒泡触发 togglePart
  noop() {},

  onPartField(e) {
    const { index, key } = e.currentTarget.dataset
    const participants = this.data.participants.slice()
    const p = JSON.parse(JSON.stringify(participants[index]))
    if (key === 'name' || key === 'phone' || key === 'medical') p.person[key] = e.detail.value
    else if (key === 'ename' || key === 'ephone') {
      // WXML 的紧急联系字段 data-key 是 ename/ephone，必须映射到 emergency.name/phone
      const emergency = Object.assign({ name: '', phone: '' }, p.person.emergency)
      emergency[key === 'ename' ? 'name' : 'phone'] = e.detail.value
      p.person.emergency = emergency
    }
    participants[index] = p
    this.updateDraft({ participants })
    this.clearResolvedErrors()
  },

  onPartTrip(e) {
    const index = e.currentTarget.dataset.index
    const value = this.tripValues[Number(e.detail.value)] || 'self'
    const participants = this.data.participants.slice()
    participants[index] = Object.assign({}, participants[index], {
      trip: value === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: value },
    })
    this.updateDraft({ participants })
    this.clearResolvedErrors()
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
    p.consent = Object.assign({}, p.consent, { [key]: toggleOn(e.detail.value) })
    participants[index] = p
    this.updateDraft({ participants })
    this.clearResolvedErrors()
  },

  onKeepTogether(e) { this.updateDraft({ keepTogether: toggleOn(e.detail.value) }) },

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
      const em = p.person.emergency || {}
      if (!(em.name || '').trim()) errors[pre + 'ename'] = '请填写紧急联系人'
      if (!F.validPhone(em.phone || '')) errors[pre + 'ephone'] = '请填写11位紧急联系电话'
      if (p.trip.mode === 'shared' && !p.trip.pickupPointId) errors[pre + 'trip'] = '请选择上车点'
      if (!p.consent.dataUse) errors[pre + 'dataUse'] = '请确认本次活动的数据使用授权'
      if (p.personRef.kind === 'companion' && !p.consent.proxyAuthority) errors[pre + 'proxyAuthority'] = '代报名需要同行人明确授权'
    })
    return errors
  },

  // 表单里新填/改过的常用资料回写档案（本人 → profile.save，同行人 → companion.save）。
  // 这两条命令都是整体替换 person，必须以档案快照为底合并，保住头像等表单里没有的字段；
  // 与快照一致（没改过）就不发命令，不多打云函数。
  profileSyncTask(personRef, formPerson) {
    const form = JSON.parse(JSON.stringify(formPerson))
    form.name = String(form.name || '').trim()
    form.phone = String(form.phone || '').trim()
    form.medical = String(form.medical || '').trim()
    form.emergency = {
      name: String((form.emergency && form.emergency.name) || '').trim(),
      phone: String((form.emergency && form.emergency.phone) || '').trim(),
    }
    if (personRef.kind === 'user') {
      const base = this.profilePerson || {}
      const merged = Object.assign({}, base, form)
      if (JSON.stringify(merged) === JSON.stringify(base)) return null
      return { type: 'profile.save', person: merged }
    }
    const stored = (this.profileCompanions || []).find(c => c.id === personRef.companionId)
    if (!stored) return null
    const merged = Object.assign({}, stored.person, form)
    if (JSON.stringify(merged) === JSON.stringify(stored.person)) return null
    return { type: 'companion.save', companionId: personRef.companionId, person: merged }
  },

  profileSyncTasks() {
    return this.data.participants
      .map(p => this.profileSyncTask(p.personRef, p.person))
      .filter(Boolean)
  },

  // 逐条回写（CAS 链：每条基于上一条返回的 revision）。任一失败即止并如实上报，
  // 不阻塞已成功的报名/修改主流程。
  syncTasks(tasks) {
    const run = i => {
      if (i >= tasks.length) return Promise.resolve(true)
      return api.dispatch(tasks[i], this.revision).then(res => {
        if (res && res.revision) this.revision = res.revision
        return run(i + 1)
      }).catch(() => Promise.resolve(false))
    }
    return tasks.length ? run(0) : Promise.resolve(true)
  },

  submit(mode) {
    const errors = this.validate()
    const expandedParts = Object.assign({}, this.data.expandedParts)
    this.data.participants.forEach((p, i) => {
      if (Object.keys(errors).some(k => k.indexOf('p' + i + '-') === 0)) expandedParts[p.key] = true
    })
    this.setData({ errors, expandedParts, failure: '', capacityAsk: false })
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
    api.dispatchAndSync(payload, this.revision, this)
      .then(res => {
        if (res && res.revision) this.revision = res.revision
        return this.syncTasks(this.profileSyncTasks())
      })
      .then(synced => {
        this.setData({ busy: false })
        draft.clearDraft(this.activityId, 'signup')
        api.toast(synced ? '报名已提交' : '报名已提交，资料同步失败可在「我的」补存')
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
    // 先刷新 revision（编辑模式可能没有读过活动视图）；顺手存档案快照供提交后回写
    api.read({ kind: 'profile' }).then(res => {
      this.revision = res.revision
      this.now = res.now
      if (res.view.kind === 'profile') {
        this.profilePerson = JSON.parse(JSON.stringify(res.view.profile.person))
        this.profileCompanions = JSON.parse(JSON.stringify(res.view.profile.companions))
      }
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
          personRef: input.personRef,
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
    else if (key === 'ename' || key === 'ephone') {
      // 同 onPartField：ename/ephone 映射到 emergency.name/phone，避免杂散键被服务端严格 schema 拒收
      const emergency = Object.assign({ name: '', phone: '' }, form.person.emergency)
      emergency[key === 'ename' ? 'name' : 'phone'] = e.detail.value
      form.person.emergency = emergency
    }
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
    const em = form.person.emergency || {}
    if (!(em.name || '').trim()) errors.ename = '请填写紧急联系人'
    if (!F.validPhone(em.phone || '')) errors.ephone = '请填写11位紧急联系电话'
    if (form.trip.mode === 'shared' && !form.trip.pickupPointId) errors.trip = '请选择上车点'
    this.setData({ errors })
    if (Object.keys(errors).length) return
    this.setData({ busy: true })
    api.dispatchAndSync({
      type: 'signup.edit',
      activityId: this.activityId,
      signupId: this.signupId,
      participant: form.person,
      trip: form.trip,
      purpose: this.approvedPurpose,
    }, this.revision, this).then(res => {
      if (res && res.revision) this.revision = res.revision
      // 编辑里改过的资料同样回写档案（personRef 区分本人/同行人）
      const task = form.personRef ? this.profileSyncTask(form.personRef, form.person) : null
      return this.syncTasks(task ? [task] : []).then(synced => {
        this.setData({ busy: false })
        api.toast(synced ? '修改已保存' : '修改已保存，资料同步失败可在「我的」补存')
        wx.redirectTo({ url: '/pages/activity/activity?id=' + this.activityId + '&signupId=' + this.signupId })
      })
    }).catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
  },
})
