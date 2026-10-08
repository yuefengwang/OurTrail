// 我的：Identity Hub（docs/product/profile/03-information-architecture.md）。
// 结构：A 身份头卡（头像/昵称/统计） B 反馈区（含本机未保存横幅） C 最近活动
//       D 同行与安全（摘要行 + 编辑 sheet） E 常用同行人 F 我的协作码 G 位置授权。
// 自动保存规则不变：输入停止 800ms 即自动落库，blur 兜底（scenario-me 钉死的契约）。
// 保留的一致性契约（12-state-and-error-spec.md §1）：revision CAS、_saving 防重入、
// 草稿先行、CONFLICT 自动重读、onUnload 清定时器、avatar 永取服务端值。
//
// 本地草稿 v2（05 §6 / 12 §3）：
//   键 ourtrail.draft.me.person.<openid>，结构 { fields, savedAt }；
//   v1（ourtrail.draft.me.person.v1，无账号段无时间戳）只读兼容，保存成功后清除；
//   profile.id 到手即 draftUtil.setOpenId 回填——修复 setOpenId 全库无人调用、
//   同机多账号共享草稿的历史缺陷。
//
// 错误作用域（12 §5）：error=页面级；sheetError=D 组编辑 sheet/onboarding 内；
// companionError=同行人弹层内。错误只在其产生的作用域渲染。
'use strict'
const api = require('../../utils/api')
const draftUtil = require('../../utils/draft')
const { PHASE_LABELS, dateLabel } = require('../../utils/format')

const AUTO_SAVE_MS = 800
const DRAFT_KEY_V1 = 'ourtrail.draft.me.person.v1'

const emptyPerson = () => ({ name: '', phone: '', emergency: { name: '', phone: '' }, medical: '', avatar: '' })

// openid 已回填则用账号键；未回填（首访极早期输入）回落 v1 键，行为与旧版一致
function draftKey() {
  const openid = draftUtil.wxOpenId()
  return openid ? 'ourtrail.draft.me.person.' + openid : DRAFT_KEY_V1
}

// v2 优先；v1（裸五字段）作为迁移来源，savedAt 记空（横幅只显示「未保存的修改」，不显示时间）
function readDraft() {
  const v2 = draftUtil.wxStorage.get(draftKey())
  if (v2 && v2.fields && v2.fields.emergency) return v2
  const legacy = draftUtil.wxStorage.get(DRAFT_KEY_V1)
  if (legacy && legacy.emergency) return { fields: legacy, savedAt: '' }
  return null
}

function clearDrafts() {
  draftUtil.wxStorage.set(draftKey(), null)
  if (draftKey() !== DRAFT_KEY_V1) draftUtil.wxStorage.set(DRAFT_KEY_V1, null)
}

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
function mergeDraft(server, draft) {
  const base = Object.assign({ avatar: '' }, server)
  if (!draft || !draft.fields || !draft.fields.emergency) return base
  const d = draft.fields
  return {
    name: d.name || '',
    phone: d.phone || '',
    medical: d.medical || '',
    avatar: base.avatar || '',
    emergency: { name: d.emergency.name || '', phone: d.emergency.phone || '' },
  }
}

// 横幅时间戳：北京时间 MM-DD HH:mm
function nowStamp() {
  const t = new Date(Date.now() + 8 * 3600000)
  const p = n => (n < 10 ? '0' + n : '' + n)
  return p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes())
}

// 协作码缩略：前 4 + … + 后 4（短码原样）。完整值只通过复制出口离场（10 §4）
function abbreviate(code) {
  const s = String(code || '')
  if (s.length <= 12) return s
  return s.slice(0, 4) + '…' + s.slice(-4)
}

// 错误作用域 → data 字段（12 §5）。onboarding 复用 sheetError（同一时刻只有一个编辑面打开）
function scopeErrorField(scope) {
  return (scope === 'phone' || scope === 'emergency' || scope === 'medical' || scope === 'onboarding')
    ? 'sheetError' : 'error'
}

Page({
  data: {
    loading: true,
    denied: '',
    identity: '',
    displayIdentity: '',
    person: emptyPerson(),
    companions: [],
    positionRows: [],
    stats: null,
    recent: [],
    activated: false,
    onboardingOpen: false,
    phoneSheetOpen: false,
    emergencySheetOpen: false,
    medicalSheetOpen: false,
    draftPending: false,
    draftSavedAt: '',
    discardAsk: false,
    error: '',
    sheetError: '',
    sheetHint: '',
    companionError: '',
    hint: '',
    saving: false,
    companionOpen: false,
    companionId: null,
    companionPerson: emptyPerson(),
    removeId: '',
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

  // 「已保存」只停一会儿：静默自动保存的确认（体验不好的一半是不知道存没存上）。
  flashSaved() {
    clearTimeout(this._hintClear)
    this._hintClear = setTimeout(() => {
      this._hintClear = null
      if (this.data.hint === '已保存') this.setData({ hint: '' })
    }, 2000)
  },

  reload() {
    // 单读 kind:'me'（06-api-and-selector-design.md §2）：profile + 统计 + 最近活动 + positionRows
    // 一次 read 出齐，消除「为 positionRows 拉全量 home（含轨迹折线）」的读取浪费。
    // 部署顺序约束：本页依赖云端 me 视图，必须晚于 trailApi 部署上线（14-migration-plan §3）。
    return api.read({ kind: 'me' }).then(res => {
      if (res.view.kind !== 'me') {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '资料不可用' })
        return
      }
      // 账号段回填：draft.setOpenId 此前全库无人调用，草稿键的账号段恒为空（12 §3）。
      // profile.id 就是 openid，数据在手上，零额外请求。
      draftUtil.setOpenId(res.view.profile.id)
      const serverPerson = Object.assign({ avatar: '' }, res.view.profile.person)
      const draft = readDraft()
      const person = mergeDraft(serverPerson, draft)
      // 横幅条件 = 草稿与服务端不一致（12 §4）。⚠ 旧实现的 pruneDraft 把「合并值」当比较基准——
      // 草稿存在时两者恒等，草稿在每次 reload 后都被清掉，未落库输入只能活一轮往返；
      // 这里改为与真正的服务端值比较，同时承担横幅条件与清理条件。
      const pending = !!(draft && !sameFields(draft.fields, draftableOf(serverPerson)))
      const positionRows = (res.view.positionRows || []).map(row => ({
        activityId: row.activityId, signupId: row.signupId,
        label: row.activityTitle + ' · ' + row.name,
      }))
      this.revision = res.revision
      this.setData({
        loading: false,
        denied: '',
        identity: res.view.profile.id,
        displayIdentity: abbreviate(res.view.profile.id),
        person,
        activated: !!(person.name && person.name.trim() && person.phone && person.phone.trim()),
        companions: res.view.profile.companions.map(c => ({ id: c.id, name: c.person.name, avatar: c.person.avatar || '' })),
        positionRows,
        stats: res.view.stats || null,
        recent: (res.view.recent || []).map(a => ({
          id: a.id, title: a.title, startAt: a.startAt, phase: a.phase,
          dateText: dateLabel(a.startAt), phaseText: PHASE_LABELS[a.phase] || a.phase,
        })),
        draftPending: pending,
        draftSavedAt: draft ? (draft.savedAt || '') : '',
      })
      // 草稿与服务端一致就没必要留着，下次编辑从干净状态开始
      if (draft && !pending) clearDrafts()
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  // ---- 打开/关闭编辑面：进入任一编辑面时清空其余作用域的残留反馈（12 §5） ----
  openSheet(scope) {
    this.setData({
      error: '', sheetError: '', companionError: '', sheetHint: '', hint: '',
      phoneSheetOpen: scope === 'phone',
      emergencySheetOpen: scope === 'emergency',
      medicalSheetOpen: scope === 'medical',
      onboardingOpen: scope === 'onboarding',
    })
  },
  onOpenPhone() { this.openSheet('phone') },
  onOpenEmergency() { this.openSheet('emergency') },
  onOpenMedical() { this.openSheet('medical') },
  onOpenOnboarding() { this.openSheet('onboarding') },
  onCloseSheet() {
    this.setData({ phoneSheetOpen: false, emergencySheetOpen: false, medicalSheetOpen: false, onboardingOpen: false })
  },

  // ---- 激活（onboarding）：完成 = name+phone 齐即落库；跳过不发生任何写（04 §4） ----
  onCompleteOnboarding() {
    const p = this.data.person
    const missing = []
    if (!p.name || !p.name.trim()) missing.push('姓名')
    if (!p.phone || !p.phone.trim()) missing.push('手机号')
    if (missing.length) {
      this.setData({ sheetError: '还差：' + missing.join('、') + '。补全后点「完成」；或点「先跳过」，随时可回来补。' })
      return
    }
    this.persistPerson({ scope: 'onboarding', onSuccess: () => this.onCloseSheet() })
  },

  // ---- 本机未保存横幅（12 §4） ----
  onSaveDraftNow() {
    this.persistPerson({ scope: 'page' })
  },
  onAskDiscard() { this.setData({ discardAsk: true }) },
  onDiscardCancel() { this.setData({ discardAsk: false }) },
  onDiscardConfirm() {
    // 放弃 = 终止一切未落库意图：必须先取消待触发的防抖自动保存——它不经过 persistPerson，
    // 若不取消，会在最后一次输入的 800ms 后把刚被放弃的草稿原样写回甚至落库。
    // （persistPerson 顶部的取消只保护显式保存路径；放弃是唯一的例外路径，审计期补修。）
    clearTimeout(this._autoSave)
    this._autoSave = null
    clearDrafts()
    this.setData({ discardAsk: false, draftPending: false, draftSavedAt: '', error: '', sheetError: '', sheetHint: '' })
    this.reload()
  },

  // ---- 自动保存：输入停止 AUTO_SAVE_MS 即尝试落库 ----
  // 输入停顿 800ms 自动存；blur 仍保留作兜底。scope 记录触发输入所在的编辑面，
  // 保存失败时错误只出现在那个作用域里。
  scheduleAutoSave(scope) {
    clearTimeout(this._autoSave)
    this._autoSave = setTimeout(() => {
      this._autoSave = null
      this.persistPerson({ silent: true, scope })
    }, AUTO_SAVE_MS)
  },

  /**
   * @param opts.silent 自动保存时不弹 toast，只用 hint 静默告知。
   * @param opts.scope  失败反馈落在哪个作用域（page/phone/emergency/medical/onboarding）。
   * @param opts.onSuccess 保存成功后的回调（激活 sheet 用它关闭自己）。
   */
  persistPerson(opts) {
    const silent = !!(opts && opts.silent)
    const scope = (opts && opts.scope) || 'page'
    // 本次保存使已排期的防抖自动保存过时：显式动作（blur/完成/立即保存/放弃/微信资料同步）
    // 到来时取消它，避免「放弃本机修改」后定时器又把草稿原样写回、或对同一内容双重落库
    clearTimeout(this._autoSave)
    this._autoSave = null
    const person = this.data.person
    const fields = draftableOf(person)
    // 草稿先落盘：即使下面因为门槛没存成，切走再回来也还在
    draftUtil.wxStorage.set(draftKey(), { fields, savedAt: nowStamp() })
    this.setData({ draftPending: true, draftSavedAt: this.data.draftSavedAt || nowStamp() })

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
        draftSavedAt: nowStamp(),
      })
      return Promise.resolve()
    }
    if (this._saving) return Promise.resolve()
    this._saving = true
    this.setData({ saving: true, hint: '', error: '', sheetError: '' })
    return api.dispatchAndSync({ type: 'profile.save', person }, this.revision, this)
      .then(res => {
        this._saving = false
        this.revision = res.revision
        // 存成了才清草稿：清早了会在 dispatch 失败时丢掉用户的输入
        clearDrafts()
        const savedPerson = this.data.person
        this.setData({
          saving: false, hint: '已保存', draftPending: false, draftSavedAt: '',
          activated: !!(savedPerson.name && savedPerson.name.trim() && savedPerson.phone && savedPerson.phone.trim()),
        })
        if (silent) this.flashSaved()
        else api.toast('资料已保存')
        if (opts && typeof opts.onSuccess === 'function') opts.onSuccess()
      })
      .catch(e => {
        this._saving = false
        // 失败**保留草稿**，并只在与触发输入相同的作用域说明原因
        const patch = { saving: false }
        patch[scopeErrorField(scope)] = api.errorText(e)
        this.setData(patch)
      })
  },

  onField(e) {
    const key = e.currentTarget.dataset.key
    const scope = e.currentTarget.dataset.scope || 'page'
    const person = JSON.parse(JSON.stringify(this.data.person))
    if (key === 'name' || key === 'phone' || key === 'medical') person[key] = e.detail.value
    else if (key === 'ename' || key === 'ephone') {
      // 紧急联系两列的 data-key 是 ename/ephone，映射到 emergency.name/phone（杂散键会被服务端严格 schema 拒收）
      const emergency = Object.assign({ name: '', phone: '' }, person.emergency)
      emergency[key === 'ename' ? 'name' : 'phone'] = e.detail.value
      person.emergency = emergency
    }
    this.setData({ person, hint: '' })
    // 写草稿 + 触发防抖自动保存：不必点别处
    draftUtil.wxStorage.set(draftKey(), { fields: draftableOf(person), savedAt: nowStamp() })
    this.setData({ draftPending: true, draftSavedAt: nowStamp() })
    this.scheduleAutoSave(scope)
  },
  onBlurSave(e) {
    clearTimeout(this._autoSave)
    this._autoSave = null
    // blur 是**用户动作**，不是后台自动保存 → 出 toast。
    // 只有防抖触发的自动保存才静默，否则每敲一个字弹一次。
    const scope = (e && e.currentTarget && e.currentTarget.dataset.scope) || 'page'
    this.persistPerson({ scope })
  },

  // ---- 微信资料同步：获取即覆盖对应字段，随后自动保存 ----
  // 头像：open-type=chooseAvatar（默认微信头像）→ 上传云存储 → 存 fileID
  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    if (!wx.cloud) {
      // 头像按钮同时存在于页面头卡与激活 sheet，错误跟着当前打开面走
      if (this.data.onboardingOpen) this.setData({ sheetError: '云能力不可用，无法保存头像。' })
      else this.setData({ error: '云能力不可用，无法保存头像。' })
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
        this.persistPerson({ scope: this.data.onboardingOpen ? 'onboarding' : 'page' })
      },
      fail: () => {
        if (this.data.onboardingOpen) this.setData({ sheetError: '头像上传失败，请重试。' })
        else this.setData({ error: '头像上传失败，请重试。' })
      },
    })
  },

  // 手机号：open-type=getPhoneNumber 的 code 由服务端换取真实号码，无验证码。
  // 失败不再静默：区分取消 / 无权限 / 开发者工具，给出可操作的提示。
  // 提示落在手机号编辑面内（sheetError / sheetHint），页面头卡不再被打断。
  onPhoneCode(e) {
    const d = e.detail || {}
    if (d.code) {
      api.call('getPhoneNumber', { code: d.code }).then(res => {
        if (!res.phone) return
        const person = Object.assign(JSON.parse(JSON.stringify(this.data.person)), { phone: res.phone })
        this.setData({ person })
        api.toast('已使用微信手机号')
        this.persistPerson({ scope: this.data.onboardingOpen ? 'onboarding' : 'phone' })
      }).catch(err => this.setData({ sheetError: api.errorText(err) }))
      return
    }
    const msg = String(d.errMsg || d.errmsg || '')
    if (/cancel|取消/i.test(msg)) {
      // 取消不是错误，但要给一句提示（不静默）
      this.setData({ sheetHint: '已取消获取微信手机号，可手动填写。' })
      return
    }
    if (/privacy agreement|privacy|隐私/i.test(msg)) {
      this.setData({ sheetError: '小程序后台的《用户隐私保护指引》还没有声明「手机号」：请登录 mp.weixin.qq.com → 设置 → 基本设置 → 服务内容声明 → 用户隐私保护指引 → 增加「手机号」（用途：活动报名联络与安全应急联系）并提交，生效后此按钮即可用。在此之前请手动填写。' })
    } else if (/1400001|permission|无权限|权限/i.test(msg)) {
      this.setData({ sheetError: '本小程序尚未开通「手机号快速验证」权限（需认证主体），请手动填写手机号。' })
    } else if (/developer|tourist|模拟/i.test(msg)) {
      this.setData({ sheetError: '开发者工具不支持手机号授权，请用真机预览，或手动填写。' })
    } else {
      this.setData({ sheetError: '获取微信手机号失败' + (msg ? '：' + msg : '') + '，请手动填写。' })
    }
  },

  // ---- 常用同行人 ----
  onAddCompanion() {
    // 服务端 companion.save 要求先有本人档案；新账号不预检的话，保存失败只会在
    // 弹层遮罩后面报错，用户看到的是"点保存没反应"（P0-4 教训）。
    const p = this.data.person || {}
    if (!p.name || !p.phone) {
      this.setData({ error: '先补全「同行与安全」里的姓名与手机号（填齐自动保存），再添加同行人。' })
      api.toast('先补全本人姓名与手机号，再添加同行人')
      return
    }
    this.setData({ companionOpen: true, companionId: null, companionPerson: emptyPerson(), companionError: '' })
  },
  onEditCompanion(e) {
    const id = e.currentTarget.dataset.id
    api.read({ kind: 'profile' }).then(res => {
      if (res.view.kind !== 'profile') return
      const c = res.view.profile.companions.find(x => x.id === id)
      // 深拷贝：companion.person.emergency 是嵌套对象，浅拷贝会共享引用
      if (c) this.setData({ companionOpen: true, companionId: id, companionError: '', companionPerson: Object.assign(JSON.parse(JSON.stringify(c.person)), { avatar: c.person.avatar || '' }) })
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
      this.setData({ companionError: '请填写同行人姓名与联系电话。' })
      return
    }
    api.dispatchAndSync({ type: 'companion.save', companionId: this.data.companionId, person: p }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ companionOpen: false, companionError: '' })
        api.toast('常用同行人已保存')
        this.reload()
      })
      .catch(e => this.setData({ companionError: api.errorText(e) }))
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
      .catch(e => this.setData({ companionError: api.errorText(e), removeId: '' }))
  },

  // ---- 我的协作码 ----
  onCopyIdentity() {
    wx.setClipboardData({
      data: this.data.identity,
      success: () => api.toast('协作码已复制'),
    })
  },

  // ---- 最近活动 ----
  onOpenRecent(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/activity/activity?id=' + id })
  },

  // 隐私指引此前只有 privacy-popup（已停用的死组件）能跳到，等于对用户不存在。
  onOpenPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' })
  },

  // ---- 位置授权撤回 ----
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
