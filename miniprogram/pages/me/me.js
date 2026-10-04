// 我的：微信资料同步（头像/昵称/手机号，点了就覆盖并自动保存）+ 紧急联系 + 同行人。
// 自动保存规则：**输入停止 800ms 即自动落库**（不再只靠 blur，所以不必点别处才触发）；
// 微信资料同步成功立即落库。
//
// ⚠ 为什么有本地草稿（曾出现过的真实数据丢失）：
// 服务端 `profile.save` **硬性要求姓名+手机号齐全**（cloudfunctions/trailApi/domain/profile.js:36，
// 缺任一返回 VALIDATION 并指明哪个字段没填）。这是有意的业务规则——名单与报名依赖姓名+电话。
// 但**紧急联系人与健康备注和这个门槛毫无关系**。用户先填紧急联系人、姓名还没填完就切走时，
// 旧实现里 `onShow → reload()` 会用服务端的空 person 整个覆盖 data.person，
// 用户实测过「切到别的页面再回来，这些信息又丢了」。草稿让未落库的输入活过一次会话。
'use strict'
const api = require('../../utils/api')
const draftUtil = require('../../utils/draft')

const emptyPerson = () => ({ name: '', phone: '', emergency: { name: '', phone: '' }, medical: '', avatar: '' })

// 资料表单不是活动作用域，所以不走 draftUtil.getDraft(activityId, form)，用通用适配器 + 专用键。
const DRAFT_KEY = 'ourtrail.draft.me.person.v1'
const AUTO_SAVE_MS = 800

// 只把「用户手输的字段」写进草稿。avatar 是云存储 fileID，由 onChooseAvatar 单独落库，
// 混进草稿会在 reload 时把一个还没上传完的临时值带回去。
function draftableOf(person) {
  return {
    name: person.name || '',
    phone: person.phone || '',
    medical: person.medical || '',
    emergency: {
      name: (person.emergency && person.emergency.name) || '',
      phone: (person.emergency && person.emergency.phone) || '',
    },
  }
}

function sameFields(a, b) {
  return a.name === b.name && a.phone === b.phone && a.medical === b.medical
    && a.emergency.name === b.emergency.name && a.emergency.phone === b.emergency.phone
}

// 服务端值 + 草稿（草稿优先）。avatar 永远取服务端值。
function mergeDraft(server) {
  const base = Object.assign({ avatar: '' }, server)
  const d = draftUtil.wxStorage.get(DRAFT_KEY)
  if (!d || !d.emergency) return base
  return {
    name: d.name || '',
    phone: d.phone || '',
    medical: d.medical || '',
    avatar: base.avatar || '',
    emergency: { name: d.emergency.name || '', phone: d.emergency.phone || '' },
  }
}

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
      this.getTabBar().setData({ selected: 3 })
    }
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  // 页面卸载时清掉自动保存定时器：留着会在页面消失后继续 setData 并发请求。
  onUnload() {
    clearTimeout(this._autoSave)
    clearTimeout(this._hintClear)
    this._autoSave = null
    this._hintClear = null
  },

  // 「已保存」只停一会儿：既给静默自动保存一个确认（否则用户不知道自己有没有存上，
  // 这正是「体验不好」的一部分），又不会像催填提示那样一直挂着。
  flashSaved() {
    clearTimeout(this._hintClear)
    this._hintClear = setTimeout(() => {
      this._hintClear = null
      if (this.data.hint === '已保存') this.setData({ hint: '' })
    }, 2000)
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
      // ⚠ 这里曾直接 `person: Object.assign({avatar:''}, profile.person)` ——
      //   服务端值整个覆盖 data.person，未落库的输入在 onShow 时被抹掉（用户实测复现）。
      //   现在把本地草稿合在服务端值之上。
      const person = mergeDraft(Object.assign({ avatar: '' }, profile.person))
      this.setData({
        loading: false,
        denied: '',
        identity: profile.id,
        person,
        companions: profile.companions.map(c => ({ id: c.id, name: c.person.name, avatar: c.person.avatar || '' })),
        positionRows,
      })
      // 草稿与服务端已一致就没必要留着，下次编辑从干净状态开始
      this.pruneDraft(person)
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  // 草稿和服务端字段完全一致 → 清掉，避免留一份永远用不到的历史
  pruneDraft(person) {
    const d = draftUtil.wxStorage.get(DRAFT_KEY)
    if (d && d.emergency && sameFields(d, draftableOf(person))) {
      draftUtil.wxStorage.set(DRAFT_KEY, null)
    }
  },

  // ---- 自动保存：输入停止 AUTO_SAVE_MS 即尝试落库 ----
  // 旧实现只在 bindblur 上挂，**必须点别处才触发**（用户反馈体验差）。
  // 现在输入停顿 800ms 自动存；blur 仍保留作兜底（用户点「保存」或键盘收起时立即试一次）。
  scheduleAutoSave() {
    clearTimeout(this._autoSave)
    this._autoSave = setTimeout(() => {
      this._autoSave = null
      this.persistPerson({ silent: true })
    }, AUTO_SAVE_MS)
  },

  /**
   * @param opts.silent 自动保存时不弹 toast（避免每敲一个字弹一次），
   *                     只用 hint 静默告知。显式操作（微信资料同步）传 false。
   */
  persistPerson(opts) {
    const silent = !!(opts && opts.silent)
    const person = this.data.person
    const fields = draftableOf(person)
    // 草稿先落盘：即使下面因为门槛没存成，切走再回来也还在
    draftUtil.wxStorage.set(DRAFT_KEY, fields)

    const nameOk = !!(person.name && person.name.trim())
    const phoneOk = !!(person.phone && person.phone.trim())
    if (!nameOk || !phoneOk) {
      // 服务端硬门槛（domain/profile.js:36），改不了。至少把话说清：
      // 用户填的紧急联系人/健康备注**已经在草稿里等着**，门槛一满足就会一起存。
      const waiting = []
      if ((person.emergency && (person.emergency.name || person.emergency.phone)) || (person.medical || '')) {
        waiting.push('紧急联系人与健康备注已记在本机')
      }
      this.setData({
        hint: '补全姓名与手机号后自动保存'
          + (waiting.length ? '（' + waiting.join('') + '，会一起保存）' : ''),
      })
      return Promise.resolve()
    }
    if (this._saving) return Promise.resolve()
    this._saving = true
    this.setData({ saving: true, hint: '', error: '' })
    return api.dispatchAndSync({ type: 'profile.save', person }, this.revision, this)
      .then(res => {
        this._saving = false
        this.revision = res.revision
        // 存成了才清草稿：清早了会在 dispatch 失败时丢掉用户的输入
        draftUtil.wxStorage.set(DRAFT_KEY, null)
        this.setData({ saving: false, hint: '已保存' })
        if (silent) this.flashSaved()
        else api.toast('资料已保存')
      })
      .catch(e => {
        this._saving = false
        // 失败**保留草稿**，并说明原因——否则用户会以为填的东西没了
        this.setData({ saving: false, error: api.errorText(e) })
      })
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const person = JSON.parse(JSON.stringify(this.data.person))
    if (key === 'name' || key === 'phone' || key === 'medical') person[key] = e.detail.value
    else if (key === 'ename' || key === 'ephone') {
      // WXML 紧急联系两列的 data-key 是 ename/ephone，映射到 emergency.name/phone（杂散键会被服务端严格 schema 拒收）
      const emergency = Object.assign({ name: '', phone: '' }, person.emergency)
      emergency[key === 'ename' ? 'name' : 'phone'] = e.detail.value
      person.emergency = emergency
    }
    this.setData({ person, hint: '' })
    // 写草稿 + 触发防抖自动保存：不必点别处
    draftUtil.wxStorage.set(DRAFT_KEY, draftableOf(person))
    this.scheduleAutoSave()
  },
  onBlurSave() {
    clearTimeout(this._autoSave)
    this._autoSave = null
    // blur 是**用户动作**，不是后台自动保存 → 出 toast。
    // 只有下面防抖触发的自动保存才静默，否则每敲一个字弹一次。
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
        // 深拷贝：Object.assign 是浅的，person.emergency 是嵌套对象，
        // 浅拷贝会让「改 avatar」意外共享 emergency 引用
        const person = Object.assign(JSON.parse(JSON.stringify(this.data.person)), { avatar: res.fileID })
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
        const person = Object.assign(JSON.parse(JSON.stringify(this.data.person)), { phone: res.phone })
        this.setData({ person })
        api.toast('已使用微信手机号')
        this.persistPerson()
      }).catch(err => this.setData({ error: api.errorText(err) }))
      return
    }
    const msg = String(d.errMsg || d.errmsg || '')
    if (/cancel|取消/i.test(msg)) {
      // 取消不是错误，但要给一句提示（与下方无权限/开发者工具分支同级，不静默）
      this.setData({ hint: '已取消获取微信手机号，可手动填写。' })
      return
    }
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
    // 服务端 companion.save 要求先有本人档案；新账号不预检的话，保存失败只会在
    // 弹层遮罩后面报错（error 渲染在页面顶部），用户看到的是"点保存没反应"。
    const p = this.data.person || {}
    if (!p.name || !p.phone) {
      this.setData({ error: '先补全上方「我的资料」的姓名与手机号（填齐自动保存），再添加同行人。' })
      api.toast('先补全本人姓名与手机号，再添加同行人')
      return
    }
    this.setData({ companionOpen: true, companionId: null, companionPerson: emptyPerson(), error: '' })
  },
  onEditCompanion(e) {
    const id = e.currentTarget.dataset.id
    api.read({ kind: 'profile' }).then(res => {
      if (res.view.kind !== 'profile') return
      const c = res.view.profile.companions.find(x => x.id === id)
      // 深拷贝：companion.person.emergency 是嵌套对象，浅拷贝会共享引用
      if (c) this.setData({ companionOpen: true, companionId: id, companionPerson: Object.assign(JSON.parse(JSON.stringify(c.person)), { avatar: c.person.avatar || '' }) })
    })
  },
  onCompanionField(e) {
    const key = e.currentTarget.dataset.key
    const person = JSON.parse(JSON.stringify(this.data.companionPerson))
    if (key === 'name' || key === 'phone' || key === 'medical') person[key] = e.detail.value
    else if (key === 'ename' || key === 'ephone') {
      // 同 onField：ename/ephone 映射到 emergency.name/phone
      const emergency = Object.assign({ name: '', phone: '' }, person.emergency)
      emergency[key === 'ename' ? 'name' : 'phone'] = e.detail.value
      person.emergency = emergency
    }
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
        this.setData({ companionOpen: false, error: '' })
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
