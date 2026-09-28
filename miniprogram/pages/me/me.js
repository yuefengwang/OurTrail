// 我的：微信资料同步（头像/昵称/手机号，点了就覆盖并自动保存）+ 紧急联系 + 同行人。
// 自动保存规则：姓名与手机号齐全后，任何字段失焦即落库；微信资料同步成功立即落库。
'use strict'
const api = require('../../utils/api')

const emptyPerson = () => ({ name: '', phone: '', emergency: { name: '', phone: '' }, medical: '', avatar: '' })

Page({
  data: {
    loading: true,
    denied: '',
    identity: '',
    person: emptyPerson(),
    companions: [],
    positionRows: [],
    companionOpen: false,
    companionId: null,
    companionPerson: emptyPerson(),
    removeId: '',
    error: '',
    hint: '',
    saving: false,
    medicalOpen: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
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
      this.setData({
        loading: false,
        denied: '',
        identity: profile.id,
        person: Object.assign({ avatar: '' }, profile.person),
        companions: profile.companions.map(c => ({ id: c.id, name: c.person.name, avatar: c.person.avatar || '' })),
        positionRows,
      })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  // ---- 自动保存：姓名+手机号齐全即落库 ----
  persistPerson() {
    const person = this.data.person
    if (!person.name.trim() || !person.phone.trim()) {
      // 资料未齐：不落库，只给一次提示
      this.setData({ hint: '补全姓名与手机号后会自动保存' })
      return Promise.resolve()
    }
    if (this._saving) return Promise.resolve()
    this._saving = true
    this.setData({ saving: true, hint: '', error: '' })
    return api.dispatchAndSync({ type: 'profile.save', person }, this.revision, this)
      .then(res => {
        this._saving = false
        this.revision = res.revision
        this.setData({ saving: false })
        api.toast('资料已保存')
      })
      .catch(e => {
        this._saving = false
        this.setData({ saving: false, error: api.errorText(e) })
      })
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const person = JSON.parse(JSON.stringify(this.data.person))
    if (key === 'name' || key === 'phone' || key === 'medical') person[key] = e.detail.value
    else person.emergency = Object.assign({}, person.emergency, { [key]: e.detail.value })
    this.setData({ person, hint: '' })
  },
  onBlurSave() {
    this.persistPerson()
  },
  toggleMedical() {
    this.setData({ medicalOpen: !this.data.medicalOpen })
  },

  // ---- 微信资料同步：获取即覆盖对应字段，随后自动保存 ----
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
        if (!res.fileID) return
        const person = Object.assign({}, this.data.person, { avatar: res.fileID })
        this.setData({ person })
        api.toast('已使用微信头像')
        this.persistPerson()
      },
      fail: () => this.setData({ error: '头像上传失败，请重试。' }),
    })
  },

  // 手机号：open-type=getPhoneNumber 的 code 由服务端换取真实号码，无验证码。
  // 失败不再静默：区分取消 / 无权限 / 开发者工具，给出可操作的提示。
  onPhoneCode(e) {
    const d = e.detail || {}
    if (d.code) {
      api.call('getPhoneNumber', { code: d.code }).then(res => {
        if (!res.phone) return
        const person = Object.assign({}, this.data.person, { phone: res.phone })
        this.setData({ person })
        api.toast('已使用微信手机号')
        this.persistPerson()
      }).catch(err => this.setData({ error: api.errorText(err) }))
      return
    }
    const msg = String(d.errMsg || d.errmsg || '')
    if (/cancel|取消/i.test(msg)) return
    if (/privacy agreement|privacy|隐私/i.test(msg)) {
      this.setData({ error: '小程序后台的《用户隐私保护指引》还没有声明「手机号」：请登录 mp.weixin.qq.com → 设置 → 基本设置 → 服务内容声明 → 用户隐私保护指引 → 增加「手机号」（用途：活动报名联络与安全应急联系）并提交，生效后此按钮即可用。在此之前请手动填写。' })
    } else if (/1400001|permission|无权限|权限/i.test(msg)) {
      this.setData({ error: '本小程序尚未开通「手机号快速验证」权限（需认证主体），请手动填写手机号。' })
    } else if (/developer|tourist|模拟/i.test(msg)) {
      this.setData({ error: '开发者工具不支持手机号授权，请用真机预览，或手动填写。' })
    } else {
      this.setData({ error: '获取微信手机号失败' + (msg ? '：' + msg : '') + '，请手动填写。' })
    }
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
      if (c) this.setData({ companionOpen: true, companionId: id, companionPerson: Object.assign({ avatar: '' }, c.person) })
    })
  },
  onCompanionField(e) {
    const key = e.currentTarget.dataset.key
    const person = JSON.parse(JSON.stringify(this.data.companionPerson))
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
    api.dispatchAndSync({ type: 'companion.save', companionId: this.data.companionId, person: p }, this.revision, this)
      .then(res => {
        this.revision = res.revision
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
    api.dispatchAndSync({ type: 'companion.remove', companionId: this.data.removeId }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ removeId: '' })
        api.toast('已移除常用条目')
        this.reload()
      })
      .catch(e => this.setData({ error: api.errorText(e), removeId: '' }))
  },

  onCopyIdentity() {
    wx.setClipboardData({
      data: this.data.identity,
      success: () => api.toast('身份码已复制'),
    })
  },

  onRevoke(e) {
    const { activityId, signupId } = e.currentTarget.dataset
    api.dispatchAndSync({ type: 'position.revoke', activityId, signupId }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        api.toast('位置授权已撤回')
        this.reload()
      })
      .catch(err => this.setData({ error: api.errorText(err) }))
  },
})
