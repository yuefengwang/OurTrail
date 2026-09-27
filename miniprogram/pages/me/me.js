// 我的：常用资料、常用同行人、身份码（协作授权用）、位置授权撤回。
// 对应原型 screens/Profile.tsx。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

const emptyPerson = () => ({ name: '', phone: '', emergency: { name: '', phone: '' }, medical: '' })

Page({
  data: {
    loading: true,
    denied: '',
    filled: false,
    identity: '',
    person: emptyPerson(),
    companions: [],
    positionRows: [],
    companionOpen: false,
    companionId: null,
    companionPerson: emptyPerson(),
    removeId: '',
    error: '',
    saving: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.reload()
  },

  reload() {
    return Promise.all([
      api.read({ kind: 'profile' }),
      api.read({ kind: 'home', perspective: 'participant', openedActivityIds: [] }),
    ]).then(([res, home]) => {
      if (res.view.kind !== 'profile') {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '资料不可用' })
        return
      }
      const profile = res.view.profile
      const positionRows = []
      if (home.view.kind === 'home') {
        for (const a of home.view.activities) {
          for (const row of a.meta.positionRows || []) {
            positionRows.push(Object.assign({}, row, { label: a.title + ' · ' + row.name }))
          }
        }
      }
      this.revision = res.revision
      const person = Object.assign({ avatar: '' }, profile.person)
      this.setData({
        loading: false,
        denied: '',
        identity: profile.id,
        filled: !!profile.person.name,
        person,
        companions: profile.companions.map(c => ({ id: c.id, name: c.person.name, avatar: c.person.avatar || '' })),
        positionRows,
      })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  // ---- 微信资料同步（以微信获取的为准，直接覆盖对应字段） ----
  // 同步后若姓名+电话已齐，自动保存；否则提示补全。
  syncSave(patch) {
    const person = Object.assign({}, this.data.person, patch)
    this.setData({ person, error: '' })
    if (!person.name.trim() || !person.phone.trim()) {
      api.toast('已填入，请补全资料后保存')
      return
    }
    this.setData({ saving: true })
    api.dispatch({ type: 'profile.save', person }, this.revision)
      .then(() => {
        this.setData({ saving: false })
        api.toast('已按微信资料保存')
        this.reload()
      })
      .catch(e => this.setData({ saving: false, error: api.errorText(e) }))
  },

  // 头像：open-type=chooseAvatar（默认微信头像）→ 上传云存储 → 存 fileID
  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    if (!wx.cloud) {
      this.setData({ error: '云能力不可用，无法保存头像。' })
      return
    }
    wx.cloud.uploadFile({
      cloudPath: 'avatars/' + this.data.identity + '/' + Date.now() + '.jpg',
      filePath: tempPath,
      success: res => {
        if (res.fileID) this.syncSave({ avatar: res.fileID })
      },
      fail: () => this.setData({ error: '头像上传失败，请重试。' }),
    })
  },

  // 手机号：open-type=getPhoneNumber 的 code 由服务端换取真实号码，无验证码
  onPhoneCode(e) {
    const d = e.detail || {}
    if (!d.code) {
      // 用户取消授权：静默返回
      return
    }
    api.call('getPhoneNumber', { code: d.code }).then(res => {
      if (res.phone) this.syncSave({ phone: res.phone })
    }).catch(err => this.setData({ error: api.errorText(err) }))
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const person = Object.assign({}, this.data.person)
    if (key === 'name' || key === 'phone' || key === 'medical') person[key] = e.detail.value
    else person.emergency = Object.assign({}, person.emergency, { [key]: e.detail.value })
    this.setData({ person })
  },

  onSave() {
    const p = this.data.person
    if (!p.name.trim() || !p.phone.trim()) {
      this.setData({ error: '请填写姓名与联系电话。' })
      return
    }
    this.setData({ saving: true, error: '' })
    api.dispatch({ type: 'profile.save', person: p }, this.revision)
      .then(() => {
        this.setData({ saving: false })
        api.toast('常用资料已保存')
        this.reload()
      })
      .catch(e => this.setData({ saving: false, error: api.errorText(e) }))
  },

  onCopyIdentity() {
    wx.setClipboardData({
      data: this.data.identity,
      success: () => api.toast('身份码已复制，发给组织你的活动的人'),
    })
  },

  // ---- 常用同行人 ----
  onAddCompanion() {
    this.setData({ companionOpen: true, companionId: null, companionPerson: emptyPerson() })
  },
  onEditCompanion(e) {
    const id = e.currentTarget.dataset.id
    api.read({ kind: 'profile' }).then(res => {
      if (res.view.kind !== 'profile') return
      const c = res.view.profile.companions.find(x => x.id === id)
      if (c) this.setData({ companionOpen: true, companionId: id, companionPerson: c.person })
    })
  },
  onCompanionField(e) {
    const key = e.currentTarget.dataset.key
    const person = Object.assign({}, this.data.companionPerson)
    if (key === 'name' || key === 'phone' || key === 'medical') person[key] = e.detail.value
    else person.emergency = Object.assign({}, person.emergency, { [key]: e.detail.value })
    this.setData({ companionPerson: person })
  },
  onCompanionClose() { this.setData({ companionOpen: false }) },
  onCompanionSave() {
    const p = this.data.companionPerson
    if (!p.name.trim() || !p.phone.trim()) {
      this.setData({ error: '请填写同行人姓名与联系电话。' })
      return
    }
    api.dispatch({ type: 'companion.save', companionId: this.data.companionId, person: p }, this.revision)
      .then(() => {
        this.setData({ companionOpen: false })
        api.toast('常用同行人已保存')
        this.reload()
      })
      .catch(e => this.setData({ error: api.errorText(e) }))
  },
  onRemoveAsk(e) { this.setData({ removeId: e.currentTarget.dataset.id }) },
  onRemoveCancel() { this.setData({ removeId: '' }) },
  onRemoveConfirm() {
    if (!this.data.removeId) return
    api.dispatch({ type: 'companion.remove', companionId: this.data.removeId }, this.revision)
      .then(() => {
        this.setData({ removeId: '' })
        api.toast('已移除常用条目')
        this.reload()
      })
      .catch(e => this.setData({ error: api.errorText(e), removeId: '' }))
  },

  onRevoke(e) {
    const { activityId, signupId } = e.currentTarget.dataset
    api.dispatch({ type: 'position.revoke', activityId, signupId }, this.revision)
      .then(() => {
        api.toast('位置授权已撤回')
        this.reload()
      })
      .catch(err => this.setData({ error: api.errorText(err) }))
  },
})
