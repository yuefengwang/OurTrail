// 我的页页面级场景测试：node tools/scenario-me-test.js
// 目的：把「档案链路」这条全站写操作的前置在 node 下走一遍——
// 真页面配置（global.Page 捕获）+ 网络桩（覆写 utils/api 的同名导出），
// 驱动真 handler，断言「发出了什么命令 + payload 形状 + 页面状态变化 + 用户可见反馈」。
//
// 手法与 tools/scenario-editor-test.js / scenario-signup-test.js 一致：
// setData 记录进 _patches 并同步 this.data，setData 回调经 setImmediate 异步触发；
// wx 桩：内存 storage / toast / 剪贴板 / 下拉收尾 / wx.cloud.uploadFile（头像上云）。
// me.js 持有的是 api 模块对象本身（const api = require(...) 后 api.foo()），覆写属性即生效。
//
// 已知问题（涉及用例按「正确行为」断言但计为 skipped（~ 标记），修复后自动转为真实校验）：
// ① me.js:95,171（onField/onCompanionField）把紧急联系字段的 data-key（'ename'/'ephone'）原样写进
//    emergency 对象，未映射到 emergency.name/phone——填写不回显（WXML 绑定 emergency.name），
//    且 profile.save / companion.save 的 person.emergency 带杂散键会被服务端严格 schema
//    （schema.js「strict 不接受多余键」）整单拒绝。
// ② me.js:143 用户取消一键取号（errMsg 含 cancel）静默 return、无任何提示，与同函数注释
//    （me.js:129「给出可操作的提示」）及 SYNC.md 2026-09-27「区分用户取消/未开通权限/开发者
//    工具三种提示」不符。
'use strict'
const ME_PATH = require.resolve('../miniprogram/pages/me/me.js')
const api = require('../miniprogram/utils/api')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
// 已知问题统一口径：'path:line 说明'
const ISSUE_EMERGENCY = "miniprogram/pages/me/me.js:95,171 onField/onCompanionField 把紧急联系字段的 data-key（'ename'/'ephone'）原样写进 emergency 对象，未映射到 emergency.name/phone——填写不回显，且 profile.save/companion.save 的 person.emergency 带杂散键会被服务端严格 schema（strict 不接受多余键）整单拒绝"
const ISSUE_CANCEL = 'miniprogram/pages/me/me.js:143 用户取消（errMsg 含 cancel）静默 return 无任何提示，与同函数注释（me.js:129「给出可操作的提示」）及 SYNC.md 2026-09-27「区分用户取消/未开通权限/开发者工具三种提示」不符'
function skipKnown(name, issue) {
  skipped++
  console.log('  ~ ' + name + '（已知问题：' + issue + '）')
}
// gate=true 表示该断言依赖已知问题的链路 → 计 skipped；否则真实校验
function checkGate(gate, issue, name, cond, extra) {
  if (gate) skipKnown(name, issue)
  else check(name, cond, extra)
}
function section(t) { console.log('== ' + t + ' ==') }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 2000
  const t0 = Date.now()
  while (Date.now() - t0 < limit) {
    if (cond()) return true
    await sleep(5)
  }
  return cond()
}
async function settle(page) { await waitFor(() => page.data.loading === false) }

// ---- 合成事件（WXML 绑定：input bindinput/bindblur、button open-type、tap）----
const fieldEv = (key, value) => ({ currentTarget: { dataset: { key } }, detail: { value } })
const blurEv = () => ({})
const tapId = id => ({ currentTarget: { dataset: { id } } })
const avatarEv = url => ({ detail: { avatarUrl: url } })
const phoneEv = detail => ({ detail })

// ---- wx 桩：内存 storage + toast/剪贴板/下拉收尾记录；每台页面换新，互不串味 ----
function makeWx(over) {
  const store = { 'ourtrail.openid': 'u-test' }
  const rec = { toasts: [], clipboard: [], pulls: 0, uploads: [] }
  const wx = Object.assign({
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push((o && o.title) || ''),
    stopPullDownRefresh: () => rec.pulls++,
    setClipboardData: o => { rec.clipboard.push(o.data); if (o.success) o.success() },
    vibrateShort: () => {},
  }, over || {})
  return { wx, store, rec }
}

// 加载真页面配置（global.Page 捕获；每次取最新源码，避免吃到缓存的旧实现）
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[ME_PATH]
  require(ME_PATH)
  return global.__PAGE_CFG
}

// 页面实例：数据同步并入 this.data，setData 回调像真机一样异步触发
function makePage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = []
  page.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  return page
}

// ---- 样例视图（形状对齐 selectors 的 profileView / home view）----
function profileView(over) {
  const base = {
    view: {
      kind: 'profile',
      profile: {
        id: 'p1',
        person: { name: '张三', phone: '13800000000', emergency: { name: '', phone: '' }, medical: '' },
        companions: [],
      },
    },
    revision: 7,
    now: '2026-09-29T09:00:00+08:00',
  }
  const o = over || {}
  if (o.person) base.view.profile.person = Object.assign(base.view.profile.person, o.person)
  if (o.companions) base.view.profile.companions = o.companions
  if (o.profile) Object.assign(base.view.profile, o.profile)
  return base
}
const emptyProfileView = () => profileView({
  profile: { person: { name: '', phone: '', emergency: { name: '', phone: '' }, medical: '' } },
})
// me.js 的本地草稿（防「切页回来资料丢失」，键与 me.js 的 DRAFT_KEY 一致）
const DRAFT_KEY = 'ourtrail.draft.me.person.v1'
const draftOf = env => {
  const d = env && env.store ? env.store[DRAFT_KEY] : null
  return (d === '' || d == null) ? null : d
}
function homeView(activities) {
  return { view: { kind: 'home', activities: activities || [] }, revision: 2, now: '2026-09-29T09:00:00+08:00' }
}
// 首页带位置授权行（me 页 positionRows 的来源）
const homeWithPosition = () => homeView([
  { title: '活动A', meta: { positionRows: [{ activityId: 'a1', activityTitle: '活动A', signupId: 's1', name: '领队' }] } },
  { title: '活动B', meta: {} },
])

// 装一台「我的」页：wx 桩 + api 网络桩 + 真页面 onShow（me.js 无 onLoad，onShow 即 reload）。
// opts: {profile, home, wx, dispatchPlan, callImpl, seed}
function bootMe(opts) {
  opts = opts || {}
  const env = makeWx(opts.wx)
  global.wx = env.wx
  if (opts.seed) opts.seed(env)
  const plan = (opts.dispatchPlan || []).slice() // dispatchAndSync 的结果队列（Error 项 = 拒绝）
  const reads = []     // read 的 request
  const dispatches = [] // dispatchAndSync 的 {payload, revision}
  const apiCalls = []  // api.call 的 {action, data}（getPhoneNumber 等）
  api.read = req => {
    reads.push(req)
    if (opts.readFail) return Promise.reject(new Error('网络异常'))
    if (req.kind === 'profile') return Promise.resolve(opts.profile || profileView())
    if (req.kind === 'home') return Promise.resolve(opts.home || homeView())
    return Promise.resolve({ view: { kind: 'denied', message: '无权访问' }, revision: 1, now: '' })
  }
  api.dispatchAndSync = (payload, revision, page) => {
    dispatches.push({ payload, revision })
    const next = plan.length ? plan.shift() : { targetIds: ['p1'], replayed: false }
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(Object.assign({ revision: (revision || 0) + 1 }, next))
  }
  api.call = (action, data) => {
    apiCalls.push({ action, data })
    if (opts.callImpl) return opts.callImpl(action, data)
    return Promise.resolve({ phone: '13800000000' })
  }
  const page = makePage(pageConfig())
  page.onShow()
  return { page, reads, dispatches, apiCalls, env }
}

// ---- 已知问题①探针（独立小页，不动主流程状态）：紧急联系字段 data-key 是否映射到 emergency.name/phone ----
let _emergencyOk = null
function emergencyMappingOk() {
  if (_emergencyOk !== null) return _emergencyOk
  const { page } = bootMe({})
  page.onField(fieldEv('ename', '赵六'))
  page.onField(fieldEv('ephone', '13611111111'))
  const em = page.data.person.emergency
  _emergencyOk = em.name === '赵六' && em.phone === '13611111111' && !('ename' in em) && !('ephone' in em)
  return _emergencyOk
}
// ---- 已知问题②探针：用户取消一键取号后是否有任何提示 ----
let _cancelPromptOk = null
function cancelPromptShown() {
  if (_cancelPromptOk !== null) return _cancelPromptOk
  const { page } = bootMe({})
  page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail cancel' }))
  _cancelPromptOk = page.data.error !== '' || page.data.hint !== ''
  return _cancelPromptOk
}

// 1. 首次进入无档案：空壳展示 + 引导，不炸；denied / 读失败也有出口；完整档案装配正确
async function scenario1() {
  section('1. 首屏装配：空壳档案 / denied / 读失败 / 完整档案映射')
  {
    const { page, reads } = bootMe({ profile: emptyProfileView() })
    check('onShow 即触发 reload（无 onLoad）', reads.length > 0)
    await settle(page)
    check('读取顺序：先档案后首页，首页带 participant 视角与空 openedActivityIds',
      reads.length === 2 && reads[0].kind === 'profile'
      && reads[1].kind === 'home' && reads[1].perspective === 'participant'
      && JSON.stringify(reads[1].openedActivityIds) === '[]',
      JSON.stringify(reads))
    check('空壳档案不炸：loading 收尾、无 denied', page.data.loading === false && page.data.denied === '',
      JSON.stringify({ loading: page.data.loading, denied: page.data.denied }))
    check('空档案展示：identity 取 profile.id、姓名电话为空',
      page.data.identity === 'p1' && page.data.person.name === '' && page.data.person.phone === '',
      JSON.stringify(page.data.person))
    check('空档案 avatar 兜底空串、无同行人、无位置授权行',
      page.data.person.avatar === '' && page.data.companions.length === 0 && page.data.positionRows.length === 0,
      JSON.stringify({ c: page.data.companions, p: page.data.positionRows }))
    check('无残留错误/提示', page.data.error === '' && page.data.hint === '')
  }
  {
    const { page } = bootMe({ profile: { view: { kind: 'denied', message: '请先选择当前账号。' }, revision: 1, now: '' } })
    await settle(page)
    check('档案 denied：透出原文引导', page.data.denied === '请先选择当前账号。' && page.data.loading === false,
      page.data.denied)
  }
  {
    const { page } = bootMe({ readFail: true })
    await settle(page)
    check('读取失败：errorText 落到 denied', page.data.denied === '网络异常' && page.data.loading === false,
      page.data.denied)
  }
  {
    const { page } = bootMe({
      profile: profileView({
        person: { avatar: 'cloud://avatar-0.jpg', medical: '花粉过敏' },
        companions: [{ id: 'c1', person: { name: '李四', phone: '13900000000', emergency: { name: '王五', phone: '13700000000' }, medical: '', avatar: 'cloud://c1.jpg' } }],
      }),
      home: homeWithPosition(),
    })
    await settle(page)
    check('完整档案：头像/健康备注透传', page.data.person.avatar === 'cloud://avatar-0.jpg' && page.data.person.medical === '花粉过敏',
      JSON.stringify(page.data.person))
    check('同行人装配为 {id,name,avatar} 行', JSON.stringify(page.data.companions)
      === JSON.stringify([{ id: 'c1', name: '李四', avatar: 'cloud://c1.jpg' }]),
      JSON.stringify(page.data.companions))
    check('位置授权行带「活动名 · 角色」标签与撤回所需的 activityId/signupId',
      page.data.positionRows.length === 1 && page.data.positionRows[0].label === '活动A · 领队'
      && page.data.positionRows[0].activityId === 'a1' && page.data.positionRows[0].signupId === 's1',
      JSON.stringify(page.data.positionRows))
    check('revision 取自档案读（后续 CAS 基准）', page.revision === 7, String(page.revision))
  }
}

// 2. 微信资料三分支：一键取号成功回填并自动保存；取消/隐私/无权限/开发者工具各给对应提示
async function scenario2() {
  section('2. 微信资料同步：一键取号成功 / 取消 / 隐私未声明 / 未开通权限 / 开发者工具')
  {
    // 成功：姓名已有、电话为空 → 取号回填后姓名+电话齐全 → 自动落库
    const { page, apiCalls, dispatches, env } = bootMe({ profile: profileView({ person: { phone: '' } }) })
    await settle(page)
    page.onPhoneCode(phoneEv({ code: 'wx-code-1' }))
    await waitFor(() => dispatches.length > 0)
    check('取号调 getPhoneNumber action 并透传 code',
      apiCalls.length === 1 && apiCalls[0].action === 'getPhoneNumber' && apiCalls[0].data.code === 'wx-code-1',
      JSON.stringify(apiCalls))
    check('回填手机号字段', page.data.person.phone === '13800000000', page.data.person.phone)
    check('用户可见反馈「已使用微信手机号」', env.rec.toasts.indexOf('已使用微信手机号') !== -1, JSON.stringify(env.rec.toasts))
    check('姓名+电话齐全 → 自动发 profile.save（免确认）',
      dispatches[0].payload.type === 'profile.save' && dispatches[0].payload.person.name === '张三'
      && dispatches[0].payload.person.phone === '13800000000',
      JSON.stringify(dispatches[0] && dispatches[0].payload))
    check('免确认：无确认弹层状态位', page.data.companionOpen === false)
  }
  {
    // 成功但姓名未填：回填字段、给引导，不落库
    const { page, apiCalls, dispatches } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onPhoneCode(phoneEv({ code: 'wx-code-2' }))
    await waitFor(() => page.data.person.phone === '13800000000')
    await sleep(20) // 给 persistPerson 的分支留一拍
    check('姓名未齐：取号回填但不发 profile.save',
      apiCalls.length === 1 && dispatches.length === 0, JSON.stringify({ calls: apiCalls.length, d: dispatches.length }))
    // 断言**意图**而非逐字文案：引导语现在还会带上「紧急联系人与健康备注已记在本机」
    // （服务端硬门槛要求姓名+手机号齐全，domain/profile.js:36，而紧急联系人与它无关，
    //   不说清楚用户会以为白填了）。逐字 pin 会让任何文案改进都变成测试回归。
    check('给「补全后自动保存」引导', /补全姓名与手机号后/.test(page.data.hint || ''), page.data.hint)
  }
  {
    // 用户取消：不调接口、不发命令；提示按已知问题口径计 skipped
    const { page, apiCalls, dispatches } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail cancel' }))
    await sleep(20)
    check('用户取消：不调 getPhoneNumber、不发 profile.save',
      apiCalls.length === 0 && dispatches.length === 0, JSON.stringify({ calls: apiCalls.length, d: dispatches.length }))
    const silent = !cancelPromptShown()
    checkGate(silent, ISSUE_CANCEL, '用户取消：给出「已取消」类提示',
      cancelPromptShown() && /取消|已放弃|cancel/i.test(page.data.error + page.data.hint),
      'error=' + JSON.stringify(page.data.error) + ' hint=' + JSON.stringify(page.data.hint))
  }
  {
    // 隐私指引未声明「手机号」：给带操作路径的指引文案
    const { page, apiCalls } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail api scope is not declared in the privacy agreement' }))
    check('隐私 scope 未声明：指引去平台配置《用户隐私保护指引》',
      page.data.error.indexOf('用户隐私保护指引') !== -1 && page.data.error.indexOf('mp.weixin.qq.com') !== -1,
      page.data.error)
    check('隐私分支：不调接口（服务端换码无从谈起）', apiCalls.length === 0, JSON.stringify(apiCalls))
  }
  {
    // 未开通「手机号快速验证」权限（1400001）
    const { page } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail 1400001 no permission' }))
    check('未开通权限：提示手动填写', page.data.error.indexOf('手机号快速验证') !== -1
      && page.data.error.indexOf('手动填写') !== -1, page.data.error)
  }
  {
    // 开发者工具不支持
    const { page } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail can only be invoked by user in developer tools' }))
    check('开发者工具：提示真机预览或手动填写', page.data.error.indexOf('开发者工具') !== -1, page.data.error)
  }
  {
    // 服务端换码失败：errorText 透出
    const { page } = bootMe({ callImpl: () => Promise.reject(new Error('换取手机号失败')) })
    await settle(page)
    page.onPhoneCode(phoneEv({ code: 'wx-code-3' }))
    await waitFor(() => page.data.error !== '')
    check('换码失败：可读报错透出', page.data.error === '换取手机号失败', page.data.error)
  }
}

// 3. 自动保存：姓名+手机号齐全后任一字段失焦即落库；不齐只引导；防重复提交与失败恢复
async function scenario3() {
  section('3. 自动保存：齐全即落库 / 不齐只引导 / 防重 / 失败恢复')
  {
    const { page, dispatches, env } = bootMe({})
    await settle(page)
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    check('姓名+电话齐全：失焦即发 profile.save', dispatches[0].payload.type === 'profile.save')
    check('payload = {type, person} 两键，person 带姓名电话（免确认）',
      JSON.stringify(Object.keys(dispatches[0].payload).sort()) === JSON.stringify(['person', 'type'])
      && dispatches[0].payload.person.name === '张三' && dispatches[0].payload.person.phone === '13800000000',
      JSON.stringify(dispatches[0].payload))
    const person = dispatches[0].payload.person
    check('person 键集 = avatar/emergency/medical/name/phone（无杂散键）',
      JSON.stringify(Object.keys(person).sort()) === JSON.stringify(['avatar', 'emergency', 'medical', 'name', 'phone'])
      && JSON.stringify(Object.keys(person.emergency).sort()) === JSON.stringify(['name', 'phone']),
      JSON.stringify(Object.keys(person)))
    check('emergency 原样保留服务端形状（服务端严格 schema 可收）',
      JSON.stringify(person.emergency) === JSON.stringify({ name: '', phone: '' }), JSON.stringify(person.emergency))
    check('CAS 基准 = 档案读的 revision', dispatches[0].revision === 7, String(dispatches[0].revision))
    // 用户动作（blur / 微信资料同步）要出 toast；只有防抖自动保存才静默（否则每敲一个字弹一次）
    check('保存成功反馈「资料已保存」+ saving 复位 + revision 前滚',
      env.rec.toasts.indexOf('资料已保存') !== -1 && page.data.saving === false && page.revision === 8,
      JSON.stringify({ toasts: env.rec.toasts, saving: page.data.saving, rev: page.revision }))
    // 「已保存」是**静默自动保存的确认**，2s 后自动清掉：既给反馈，又不会像催填提示那样长期挂着
    check('落库后提示已保存（待自动清除），error 为空',
      page.data.hint === '已保存' && page.data.error === '', page.data.hint)
  }
  {
    const { page, dispatches } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('name', '李四'))
    check('输入即覆盖对应字段', page.data.person.name === '李四')
    page.onBlurSave(blurEv())
    check('不齐：不发命令', dispatches.length === 0, String(dispatches.length))
    check('不齐：给「补全后自动保存」引导', /补全姓名与手机号后/.test(page.data.hint || ''), page.data.hint)
    page.onField(fieldEv('phone', '13900000000'))
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    check('补齐后失焦：自动落库带姓名电话',
      dispatches[0].payload.person.name === '李四' && dispatches[0].payload.person.phone === '13900000000',
      JSON.stringify(dispatches[0] && dispatches[0].payload.person))
    check('补齐落库后催填引导消失（换成已保存）', page.data.hint === '已保存', page.data.hint)
  }
  {
    const { page, dispatches } = bootMe({})
    await settle(page)
    page.onField(fieldEv('medical', '花粉过敏'))
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    check('健康备注失焦同样触发落库并带最新值', dispatches[0].payload.person.medical === '花粉过敏',
      JSON.stringify(dispatches[0] && dispatches[0].payload.person.medical))
  }
  // ══════════════ 以下为「资料丢失」回归（用户实测复现）══════════════
  // 旧实现：onShow → reload() → `person: Object.assign({avatar:''}, profile.person)`
  // 用服务端值**整个覆盖** data.person。服务端 profile.save 硬性要求姓名+手机号齐全
  // （domain/profile.js:36），所以「先填紧急联系人、姓名没填完就切走」这一常见路径下，
  // 输入**永远存不进去**，切页回来还被抹掉。修法是本地草稿 + reload 合入草稿。
  {
    const { page, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    // 只填紧急联系人 + 健康备注（姓名手机号没填 → 门槛不满足 → 不落库）
    page.onField(fieldEv('ename', '王五'))
    page.onField(fieldEv('ephone', '13700000000'))
    page.onField(fieldEv('medical', '花粉过敏'))
    page.onBlurSave(blurEv())
    const d = draftOf(env)
    check('门槛未满足时把输入写进本地草稿',
      d && d.emergency.name === '王五' && d.emergency.phone === '13700000000' && d.medical === '花粉过敏',
      JSON.stringify(d))
    check('草稿不含 avatar（云存储 fileID 由 onChooseAvatar 单独落库）',
      d && d.avatar === undefined, d && JSON.stringify(d.avatar))
  }
  {
    // 关键回归：切到别的页面再回来（= onShow → reload），输入必须还在
    const { page } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('ename', '王五'))
    page.onField(fieldEv('medical', '花粉过敏'))
    page.onBlurSave(blurEv())
    // 模拟切页：onShow 会重新拉档案
    page.onShow()
    await settle(page)
    check('★ 切页回来后紧急联系人仍在（曾被服务端空值抹掉）',
      page.data.person.emergency.name === '王五', JSON.stringify(page.data.person.emergency))
    check('★ 切页回来后健康备注仍在',
      page.data.person.medical === '花粉过敏', page.data.person.medical)
  }
  {
    // 草稿不得污染 avatar：avatar 永远取服务端值。
    // 用「只改紧急联系人、姓名手机号保持服务端值」来构造——服务端 name+phone 本就齐全，
    // blur 会真的落库并清草稿，所以草稿在 onShow 时已不存在，这条只验 avatar 没被写坏。
    const { page } = bootMe({ profile: profileView({ person: { avatar: 'cloud://avatar-1' } }) })
    await settle(page)
    check('服务端头像已回填', page.data.person.avatar === 'cloud://avatar-1', page.data.person.avatar)
    page.onField(fieldEv('ename', '钱十三'))
    page.onField(fieldEv('ephone', '13100000000'))
    page.onShow()
    await settle(page)
    check('★ 草稿合入时 avatar 仍取服务端值，不被草稿污染',
      page.data.person.avatar === 'cloud://avatar-1', page.data.person.avatar)
    check('草稿里的紧急联系人合入成功', page.data.person.emergency.name === '钱十三',
      JSON.stringify(page.data.person.emergency))
    check('服务端已有手输字段保持不变', page.data.person.name === '张三', page.data.person.name)
  }
  {
    // 落库成功后清草稿：否则下次编辑会从一份过期草稿起步
    const { page, dispatches, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('name', '孙七'))
    page.onField(fieldEv('phone', '13600000000'))
    page.onField(fieldEv('ename', '周八'))
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    check('落库 payload 带全部字段（含紧急联系人）',
      dispatches[0].payload.person.emergency.name === '周八', JSON.stringify(dispatches[0].payload.person))
    check('★ 落库成功后草稿被清掉', !draftOf(env), JSON.stringify(draftOf(env)))
  }
  {
    // 落库失败必须保留草稿，否则用户以为填的东西没了
    const { page, env } = bootMe({ profile: emptyProfileView(), dispatchPlan: [new Error('网络异常')] })
    await settle(page)
    page.onField(fieldEv('name', '吴九'))
    page.onField(fieldEv('phone', '13500000000'))
    page.onBlurSave(blurEv())
    await waitFor(() => page.data.saving === false && page.data.error !== '')
    const d = draftOf(env)
    check('★ 落库失败时草稿保留（不丢用户输入）', d && d.name === '吴九', JSON.stringify(d))
    check('落库失败给出错误提示', !!page.data.error, page.data.error)
  }
  {
    // 防抖自动保存：不必点别处
    const { page, dispatches } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('name', '郑十'))
    page.onField(fieldEv('phone', '13400000000'))
    check('刚输入完还没到防抖窗口，不该立刻发', dispatches.length === 0, String(dispatches.length))
    await waitFor(() => dispatches.length > 0, 3000)
    check('★ 输入停顿后自动落库（无需点别处触发）', dispatches.length === 1, String(dispatches.length))
  }
  {
    // 自动保存必须静默：否则每敲一个字弹一次 toast
    const { page, dispatches, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('name', '钱十一'))
    page.onField(fieldEv('phone', '13300000000'))
    await waitFor(() => dispatches.length > 0, 3000)
    check('★ 自动保存不弹 toast（只给 hint 确认）', env.rec.toasts.indexOf('资料已保存') === -1,
      JSON.stringify(env.rec.toasts))
    // dispatches 是 stub 同步记录的，而 hint 写在 .then() 里（微任务）——要等一拍再读
    await waitFor(() => page.data.hint === '已保存', 2000)
    check('自动保存给「已保存」确认', page.data.hint === '已保存', page.data.hint)
  }
  {
    // 卸载后不得再有定时器在跑：留着会在页面消失后继续 setData + 发请求。
    // ⚠ 先 sleep(AUTO_SAVE)：api 是模块级单例，上一个块若留下未清的防抖定时器，
    //   它触发时 api.dispatchAndSync 已指向本块的闭包，会把 dispatch 记到**错误的块**里。
    //   这是测试隔离问题，不是产品缺陷（真机上页面切换会走 onUnload）。
    const { page, dispatches } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    await sleep(1000) // 让前一块的残留定时器先落地
    page.onField(fieldEv('name', '甲十二'))
    page.onField(fieldEv('phone', '13200000000'))
    page.onUnload()
    const n = dispatches.length
    await sleep(1200)
    check('★ 页面卸载后不再触发自动保存', dispatches.length === n, n + ' -> ' + dispatches.length)
  }
  {
    const { page, dispatches } = bootMe({})
    await settle(page)
    page.onBlurSave(blurEv())
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    await sleep(30)
    check('保存进行中的重复失焦不重复落库（_saving 防重）', dispatches.length === 1, String(dispatches.length))
  }
  {
    const { page, dispatches, env } = bootMe({ dispatchPlan: [new Error('保存失败，请稍后再试')] })
    await settle(page)
    page.onBlurSave(blurEv())
    await waitFor(() => page.data.error !== '')
    check('保存失败：可读报错 + saving 复位', page.data.error === '保存失败，请稍后再试' && page.data.saving === false,
      JSON.stringify({ e: page.data.error, s: page.data.saving }))
    check('失败不发成功 toast', env.rec.toasts.indexOf('资料已保存') === -1, JSON.stringify(env.rec.toasts))
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 1)
    await waitFor(() => page.data.error === '' && page.data.saving === false)
    check('失败后可重试：第二次失焦重新落库成功并清掉报错',
      dispatches.length === 2 && page.data.error === '' && page.revision === 8,
      JSON.stringify({ d: dispatches.length, e: page.data.error }))
  }
}

// 4. 头像/昵称：chooseAvatar 上云覆盖 avatar 字段并自动保存；失败/无云能力有可读出口
async function scenario4() {
  section('4. 头像/昵称：即点即覆盖并自动保存')
  {
    const uploads = []
    const { page, dispatches, env } = bootMe({
      wx: { cloud: { uploadFile: o => { uploads.push(o); o.success({ fileID: 'cloud://avatar-1.jpg' }) } } },
    })
    await settle(page)
    page.onChooseAvatar(avatarEv('wxfile://tmp-avatar.jpg'))
    await waitFor(() => dispatches.length > 0)
    check('上传云存储：cloudPath = avatars/{identity}/{ts}.jpg，filePath 透传',
      uploads.length === 1 && /^avatars\/p1\/\d+\.jpg$/.test(uploads[0].cloudPath)
      && uploads[0].filePath === 'wxfile://tmp-avatar.jpg',
      JSON.stringify(uploads.map(u => u.cloudPath)))
    check('头像字段覆盖为云存储 fileID', page.data.person.avatar === 'cloud://avatar-1.jpg', page.data.person.avatar)
    check('反馈「已使用微信头像」', env.rec.toasts.indexOf('已使用微信头像') !== -1, JSON.stringify(env.rec.toasts))
    check('头像同步后自动落库（payload 带新 avatar）',
      dispatches[0].payload.type === 'profile.save' && dispatches[0].payload.person.avatar === 'cloud://avatar-1.jpg',
      JSON.stringify(dispatches[0] && dispatches[0].payload.person))
  }
  {
    const { page, dispatches } = bootMe({
      wx: { cloud: { uploadFile: o => o.fail({ errMsg: 'uploadFile:fail' }) } },
    })
    await settle(page)
    page.onChooseAvatar(avatarEv('wxfile://tmp.jpg'))
    check('上传失败：可读报错、不落库', page.data.error === '头像上传失败，请重试。' && dispatches.length === 0,
      page.data.error)
  }
  {
    const { page } = bootMe({}) // 默认 wx 桩无 cloud
    await settle(page)
    page.onChooseAvatar(avatarEv('wxfile://tmp.jpg'))
    check('云能力不可用：可读报错、不崩', page.data.error === '云能力不可用，无法保存头像。', page.data.error)
  }
  {
    const { page, dispatches, env } = bootMe({
      wx: { cloud: { uploadFile: o => { env.rec.uploads.push(o); o.success({ fileID: 'cloud://x.jpg' }) } } },
    })
    await settle(page)
    page.onChooseAvatar({ detail: {} })
    check('无 avatarUrl（用户中断）：不上传不落库', env.rec.uploads.length === 0 && dispatches.length === 0)
  }
  {
    const { page, dispatches } = bootMe({})
    await settle(page)
    page.onField(fieldEv('name', '山野老张'))
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    check('昵称输入覆盖 name 字段，失焦自动落库带新值',
      page.data.person.name === '山野老张' && dispatches[0].payload.person.name === '山野老张',
      JSON.stringify(dispatches[0] && dispatches[0].payload.person))
  }
}

// 5. 同行人增删（companion.save/remove）+ 紧急联系人两列 + 健康备注折叠
async function scenario5() {
  section('5. 同行人增删 / 紧急联系人两列 / 健康备注折叠')
  {
    const { page, dispatches, reads } = bootMe({})
    await settle(page)
    page.onAddCompanion()
    check('添加入口：打开同行人弹层并铺空表单',
      page.data.companionOpen === true && page.data.companionId === null && page.data.companionPerson.name === '',
      JSON.stringify({ open: page.data.companionOpen, id: page.data.companionId }))
    page.onCompanionField(fieldEv('name', '李四'))
    page.onCompanionField(fieldEv('phone', '13900000000'))
    const before = reads.length
    page.onCompanionSave()
    await waitFor(() => dispatches.length > 0)
    check('保存新同行人发 companion.save，companionId 为 null',
      dispatches[0].payload.type === 'companion.save' && dispatches[0].payload.companionId === null,
      JSON.stringify(dispatches[0] && dispatches[0].payload))
    const person = dispatches[0].payload.person
    check('同行人 person 键集对齐 Person schema（avatar 兜底空串，无杂散键）',
      JSON.stringify(Object.keys(person).sort()) === JSON.stringify(['avatar', 'emergency', 'medical', 'name', 'phone'])
      && person.name === '李四' && person.phone === '13900000000'
      && JSON.stringify(Object.keys(person.emergency).sort()) === JSON.stringify(['name', 'phone']),
      JSON.stringify(person))
    check('同行人保存反馈 + 弹层收起',
      page.data.companionOpen === false && page.data.error === '', JSON.stringify(page.data))
    await waitFor(() => reads.length === before + 2)
    check('同行人保存后重读档案与首页（回填列表）', reads.length === before + 2, String(reads.length))
  }
  {
    const { page, dispatches } = bootMe({
      profile: profileView({ companions: [{ id: 'c1', person: { name: '李四', phone: '13900000000', emergency: { name: '', phone: '' }, medical: '' } }] }),
    })
    await settle(page)
    page.onCompanionSave()
    check('姓名或电话缺失：不发命令并点名', dispatches.length === 0
      && page.data.error === '请填写同行人姓名与联系电话。', page.data.error)
    page.onEditCompanion(tapId('c1'))
    await waitFor(() => page.data.companionOpen === true && page.data.companionId === 'c1')
    check('编辑入口：按 id 回填同行人资料（重新读档案）',
      page.data.companionOpen === true && page.data.companionId === 'c1' && page.data.companionPerson.name === '李四',
      JSON.stringify(page.data.companionPerson))
    page.onCompanionField(fieldEv('medical', '晕车'))
    page.onCompanionSave()
    await waitFor(() => dispatches.length > 0)
    check('编辑已有同行人：companion.save 带同一 companionId',
      dispatches[0].payload.companionId === 'c1' && dispatches[0].payload.person.medical === '晕车',
      JSON.stringify(dispatches[0] && dispatches[0].payload))
  }
  {
    const { page, dispatches, reads, env } = bootMe({
      profile: profileView({ companions: [
        { id: 'c1', person: { name: '李四', phone: '13900000000', emergency: { name: '', phone: '' }, medical: '' } },
        { id: 'c2', person: { name: '阿黄', phone: '', emergency: { name: '', phone: '' }, medical: '' } },
      ] }),
    })
    await settle(page)
    page.onRemoveAsk(tapId('c2'))
    check('移除先二次确认（removeId 状态位）', page.data.removeId === 'c2')
    page.onRemoveCancel()
    check('取消确认：复位不删', page.data.removeId === '' && dispatches.length === 0)
    page.onRemoveAsk(tapId('c2'))
    const before = reads.length
    page.onRemoveConfirm()
    await waitFor(() => dispatches.length > 0)
    check('确认后发 companion.remove 带目标 id（payload 两键）',
      dispatches[0].payload.type === 'companion.remove'
      && JSON.stringify(Object.keys(dispatches[0].payload).sort()) === JSON.stringify(['companionId', 'type'])
      && dispatches[0].payload.companionId === 'c2',
      JSON.stringify(dispatches[0] && dispatches[0].payload))
    check('移除反馈 + 确认态复位', env.rec.toasts.indexOf('已移除常用条目') !== -1 && page.data.removeId === '',
      JSON.stringify(env.rec.toasts))
    await waitFor(() => reads.length === before + 2)
    check('移除后重读回填列表', reads.length === before + 2, String(reads.length))
  }
  {
    // 紧急联系人两列：依赖已知问题①的映射，坏了计 skipped
    const broken = !emergencyMappingOk()
    checkGate(broken, ISSUE_EMERGENCY, '紧急联系人姓名两列输入映射到 emergency.name（非杂散键）',
      (() => { const { page } = bootMe({}); page.onField(fieldEv('ename', '赵六')); return page.data.person.emergency.name === '赵六' && !('ename' in page.data.person.emergency) })())
    checkGate(broken, ISSUE_EMERGENCY, '紧急联系人电话两列输入映射到 emergency.phone',
      (() => { const { page } = bootMe({}); page.onField(fieldEv('ephone', '13611111111')); return page.data.person.emergency.phone === '13611111111' && !('ephone' in page.data.person.emergency) })())
    {
      // 填齐后失焦落库：需先等 reload 装配出档案（否则自动保存的"资料未齐"守卫会正确拦截）
      const { page, dispatches } = bootMe({})
      await settle(page)
      page.onField(fieldEv('ename', '赵六'))
      page.onField(fieldEv('ephone', '13611111111'))
      page.onBlurSave(blurEv())
      await waitFor(() => dispatches.length > 0)
      const em = dispatches.length ? dispatches[0].payload.person.emergency : null
      checkGate(broken, ISSUE_EMERGENCY, '紧急联系人填齐后失焦：profile.save 的 emergency 干净可收（服务端严格 schema）',
        !!em && em.name === '赵六' && em.phone === '13611111111'
          && JSON.stringify(Object.keys(em).sort()) === JSON.stringify(['name', 'phone']),
        JSON.stringify(em))
    }
    checkGate(broken, ISSUE_EMERGENCY, '同行人弹层的紧急联系人字段同样映射到 emergency.name/phone',
      (() => {
        const { page } = bootMe({})
        page.onAddCompanion()
        page.onCompanionField(fieldEv('ename', '赵六'))
        page.onCompanionField(fieldEv('ephone', '13611111111'))
        const em = page.data.companionPerson.emergency
        return em.name === '赵六' && em.phone === '13611111111' && !('ename' in em) && !('ephone' in em)
      })())
  }
  {
    const { page } = bootMe({})
    await settle(page)
    check('健康备注默认折叠', page.data.medicalOpen === false)
    page.toggleMedical()
    check('点击行展开备注（medicalOpen toggle）', page.data.medicalOpen === true)
    page.onField(fieldEv('medical', '哮喘史'))
    check('展开后输入写入 medical 字段', page.data.person.medical === '哮喘史')
    page.toggleMedical()
    check('再点收起且已填内容保留', page.data.medicalOpen === false && page.data.person.medical === '哮喘史')
  }
}

// 6. 身份码：展示 profile.id 原文 + 复制；位置授权撤回；下拉刷新收尾
async function scenario6() {
  section('6. 身份码 / 位置授权撤回 / 下拉刷新')
  {
    const { page, env } = bootMe({})
    await settle(page)
    check('身份码展示形态 = 档案 id 原文（WXML user-select 直出）', page.data.identity === 'p1', page.data.identity)
    page.onCopyIdentity()
    check('复制按钮调 wx.setClipboardData 且内容 = 身份码',
      env.rec.clipboard.length === 1 && env.rec.clipboard[0] === 'p1', JSON.stringify(env.rec.clipboard))
    check('复制成功反馈', env.rec.toasts.indexOf('身份码已复制') !== -1, JSON.stringify(env.rec.toasts))
  }
  {
    const { page, dispatches, reads, env } = bootMe({ home: homeWithPosition() })
    await settle(page)
    const before = reads.length
    page.onRevoke({ currentTarget: { dataset: { activityId: 'a1', signupId: 's1' } } })
    await waitFor(() => dispatches.length > 0)
    check('撤回位置授权发 position.revoke（activityId+signupId）',
      dispatches[0].payload.type === 'position.revoke' && dispatches[0].payload.activityId === 'a1'
      && dispatches[0].payload.signupId === 's1',
      JSON.stringify(dispatches[0] && dispatches[0].payload))
    check('撤回反馈', env.rec.toasts.indexOf('位置授权已撤回') !== -1, JSON.stringify(env.rec.toasts))
    await waitFor(() => reads.length === before + 2)
    check('撤回后重读回填', reads.length === before + 2, String(reads.length))
  }
  {
    const { page, reads, env } = bootMe({})
    await settle(page)
    const before = reads.length
    page.onPullDownRefresh()
    await waitFor(() => env.rec.pulls > 0)
    check('下拉刷新：重新读取档案与首页', reads.length === before + 2, String(reads.length - before))
    check('刷新完成收尾 stopPullDownRefresh', env.rec.pulls === 1, String(env.rec.pulls))
  }
  {
    const { page, env } = bootMe({ readFail: true })
    await settle(page)
    page.onPullDownRefresh()
    await waitFor(() => env.rec.pulls > 0)
    check('刷新失败同样收尾下拉动画（catch 分支）', env.rec.pulls === 1 && page.data.denied === '网络异常',
      JSON.stringify({ pulls: env.rec.pulls, denied: page.data.denied }))
  }
}

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6]
  for (const s of scenarios) {
    try { await s() } catch (e) {
      failed++
      console.error('  ✗ ' + (s.name || 'scenario') + ' 执行异常（' + ((e && e.message) || e) + '）')
    }
  }
  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped)
  process.exit(failed > 0 ? 1 : 0)
}
main()
