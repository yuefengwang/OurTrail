// 我的页页面级场景测试：node tools/scenario-me-test.js
// 目的：把「档案链路」这条全站写操作的前置在 node 下走一遍——
// 真页面配置（global.Page 捕获）+ 网络桩（覆写 utils/api 的同名导出），
// 驱动真 handler，断言「发出了什么命令 + payload 形状 + 页面状态变化 + 用户可见反馈」。
//
// 手法与 tools/scenario-editor-test.js / scenario-signup-test.js 一致：
// setData 记录进 _patches 并同步 this.data，setData 回调经 setImmediate 异步触发；
// wx 桩：内存 storage / toast / 剪贴板 / 下拉收尾 / 导航 / wx.cloud.uploadFile（头像上云）。
// me.js 持有的是 api 模块对象本身（const api = require(...) 后 api.foo()），覆写属性即生效。
// draft.js 每台页面随 me.js 一起重新 require（其 wxOpenId 有模块级缓存，不清会跨用例串味）。
//
// 本文件对齐 Identity Hub 重构（docs/product/profile/03/11/12）：
// 激活流 / 草稿 v2（账号键 + savedAt + v1 兼容）/ 本机未保存横幅 / 错误三作用域 /
// 统计与最近活动（utils/me-view 纯函数）。历史已修问题（紧急联系字段映射、取号取消提示）
// 的 skipped 闸门已删除，相关断言转为真实校验（skipped 恒为 0）。
'use strict'
const ME_PATH = require.resolve('../miniprogram/pages/me/me.js')
const DRAFT_PATH = require.resolve('../miniprogram/utils/draft.js')
const api = require('../miniprogram/utils/api')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
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
// scope = 输入所在的编辑面（data-scope），决定保存失败时错误落在哪个作用域
const fieldEv = (key, value, scope) => ({ currentTarget: { dataset: { key, scope } }, detail: { value } })
const blurEv = scope => ({ currentTarget: { dataset: { scope: scope || '' } } })
const tapId = id => ({ currentTarget: { dataset: { id } } })
const tapDs = ds => ({ currentTarget: { dataset: ds } })
const avatarEv = url => ({ detail: { avatarUrl: url } })
const phoneEv = detail => ({ detail })

// ---- wx 桩：内存 storage + toast/剪贴板/下拉收尾/导航记录；每台页面换新，互不串味 ----
// 注意：不预置 ourtrail.openid——真机上 openid 在首次档案读回填（12 §3），测试对齐这个现实
function makeWx(over) {
  const store = {}
  const rec = { toasts: [], clipboard: [], pulls: 0, navs: [], uploads: [] }
  const wx = Object.assign({
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push((o && o.title) || ''),
    stopPullDownRefresh: () => rec.pulls++,
    setClipboardData: o => { rec.clipboard.push(o.data); if (o.success) o.success() },
    navigateTo: o => rec.navs.push(o.url),
    switchTab: o => rec.navs.push(o.url),
    vibrateShort: () => {},
  }, over || {})
  return { wx, store, rec }
}

// 加载真页面配置（global.Page 捕获；每次取最新源码；draft.js 缓存一并清除）
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[ME_PATH]
  delete require.cache[DRAFT_PATH]
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

// 草稿读取（与 me.js 的键策略对齐）：v2 账号键优先，v1 迁移来源兜底
const DRAFT_KEY_V1 = 'ourtrail.draft.me.person.v1'
const acctKey = id => 'ourtrail.draft.me.person.' + (id || 'p1')
function draftOf(env, id) {
  const store = env.store
  const v2 = store[acctKey(id)]
  if (v2 && v2.fields) return v2
  const legacy = store[DRAFT_KEY_V1]
  if (legacy && legacy.emergency) return { fields: legacy, savedAt: '' }
  return null
}

function homeView(activities, kind) {
  return { view: { kind: kind || 'home', activities: activities || [] }, revision: 2, now: '2026-09-29T09:00:00+08:00' }
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
    if (req.kind === 'me' || req.kind === 'profile') {
      const prof = opts.profile || profileView()
      if (prof.view.kind !== 'profile') return Promise.resolve(prof) // denied 等异常视图原样透传
      if (req.kind === 'profile') return Promise.resolve(prof) // onEditCompanion 的回查读
      // 单读 me 视图（06 §2）：profile + stats + recent + positionRows 一次出齐。
      // stats/recent 是服务端口径（smoke §16a 钉死），这里用显式 fixtures 模拟服务端返回，
      // 不在桩里复算口径（避免把服务端逻辑镜像进测试——SYNC.md:162 教训）。
      const home = opts.home || homeView()
      const activities = home.view.kind === 'home' ? (home.view.activities || []) : []
      const positionRows = []
      for (const a of activities) {
        for (const row of (a.meta && a.meta.positionRows) || []) positionRows.push(row)
      }
      return Promise.resolve({
        view: {
          kind: 'me',
          profile: prof.view.profile,
          stats: opts.stats !== undefined ? opts.stats : { ongoing: 0, finished: 0, organized: 0 },
          recent: opts.recent !== undefined ? opts.recent : [],
          positionRows,
        },
        revision: prof.revision, now: prof.now,
      })
    }
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

// 1. 首屏装配：空壳 / denied / 读失败 / 完整档案 / 统计与最近活动 / 协作码缩略 / 激活态
async function scenario1() {
  section('1. 首屏装配：空壳档案 / denied / 读失败 / 完整档案 / 统计与最近活动')
  {
    const { page, reads, env } = bootMe({ profile: emptyProfileView() })
    check('onShow 即触发 reload（无 onLoad）', reads.length > 0)
    await settle(page)
    check('单读 me 视图（profile+stats+recent+positionRows 一次出齐）',
      reads.length === 1 && reads[0].kind === 'me', JSON.stringify(reads))
    check('空壳档案不炸：loading 收尾、无 denied', page.data.loading === false && page.data.denied === '',
      JSON.stringify({ loading: page.data.loading, denied: page.data.denied }))
    check('空档案展示：identity 取 profile.id、姓名电话为空',
      page.data.identity === 'p1' && page.data.person.name === '' && page.data.person.phone === '',
      JSON.stringify(page.data.person))
    check('空档案 avatar 兜底空串、无同行人、无位置授权行',
      page.data.person.avatar === '' && page.data.companions.length === 0 && page.data.positionRows.length === 0,
      JSON.stringify({ c: page.data.companions, p: page.data.positionRows }))
    check('空档案未激活（激活卡出现的数据位）', page.data.activated === false, String(page.data.activated))
    check('无残留错误/提示', page.data.error === '' && page.data.hint === '')
    check('★ profile.id 到手即回填草稿账号段（draft.setOpenId 修复）',
      env.store['ourtrail.openid'] === 'p1', String(env.store['ourtrail.openid']))
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
    // me 视图未带 stats/recent（理论不发生，防御）：页面隐藏指标行、最近活动空态，不炸
    const { page } = bootMe({ stats: null, recent: null })
    await settle(page)
    check('me 视图缺 stats：页面置 null（隐藏指标行）', page.data.stats === null, JSON.stringify(page.data.stats))
    check('me 视图缺 recent：recent 为空（空态组件接管）', page.data.recent.length === 0)
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
    check('完整档案已激活', page.data.activated === true, String(page.data.activated))
  }
  {
    // 协作码缩略（10 §4）：长 openid 前 4 + … + 后 4；完整值仍留在 identity 供复制
    const longId = 'openid-abcdef12345678'
    const { page } = bootMe({ profile: profileView({ profile: { id: longId } }) })
    await settle(page)
    check('协作码缩略展示：前 4 + … + 后 4',
      page.data.displayIdentity === 'open…5678', page.data.displayIdentity)
    check('完整 id 保留在 identity（复制出口用）', page.data.identity === longId)
    {
      const short = bootMe({})
      await settle(short.page)
      check('短 id 原样展示', short.page.data.displayIdentity === 'p1', short.page.data.displayIdentity)
    }
  }
}

// 2. 激活流：引导卡数据位 / sheet 打开清残留 / 缺项点名 / 完成落库并关闭 / 跳过零写
async function scenario2() {
  section('2. 激活流：sheet 打开 / 缺项点名 / 完成落库 / 跳过零写')
  {
    const { page } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    check('未激活时 onboardingOpen 默认关闭（引导卡非模态）',
      page.data.onboardingOpen === false && page.data.activated === false)
    page.onOpenOnboarding()
    check('点引导卡打开激活 sheet', page.data.onboardingOpen === true)
    page.onCompleteOnboarding()
    check('缺姓名电话：不发命令，sheet 内点名缺项',
      /还差/.test(page.data.sheetError || '') && page.data.sheetError.indexOf('姓名') !== -1
      && page.data.sheetError.indexOf('手机号') !== -1,
      page.data.sheetError)
    page.onCloseSheet()
    check('跳过：关闭 sheet、不发命令', page.data.onboardingOpen === false)
  }
  {
    const { page, dispatches } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onOpenOnboarding()
    page.onField(fieldEv('name', '新用户', 'onboarding'))
    page.onCompleteOnboarding()
    check('只补姓名仍差手机号：点名且不落库', dispatches.length === 0
      && page.data.sheetError.indexOf('手机号') !== -1, page.data.sheetError)
    page.onField(fieldEv('phone', '13900000000', 'onboarding'))
    page.onCompleteOnboarding()
    await waitFor(() => dispatches.length > 0)
    check('补齐后「完成」：发 profile.save 并关闭 sheet',
      dispatches[0].payload.type === 'profile.save' && dispatches[0].payload.person.name === '新用户'
      && page.data.onboardingOpen === false,
      JSON.stringify(dispatches[0] && dispatches[0].payload))
    check('激活完成后 activated 翻真', page.data.activated === true)
  }
  {
    // 已激活账号不出现引导数据位；编辑面打开时清空其它作用域残留（12 §5）
    const { page } = bootMe({})
    await settle(page)
    check('已激活：无待完善徽标数据位', page.data.activated === true)
    page.setData({ error: '旧的页面级错误' })
    page.onOpenPhone()
    check('打开手机号 sheet：页面级错误被清空（作用域隔离）',
      page.data.phoneSheetOpen === true && page.data.error === '' && page.data.sheetError === '')
    page.onCloseSheet()
    check('关闭 sheet：全部编辑面复位',
      page.data.phoneSheetOpen === false && page.data.emergencySheetOpen === false
      && page.data.medicalSheetOpen === false)
  }
}

// 3. 微信资料同步：取号成功回填自动保存；取消/隐私/无权限/开发者工具提示落在 sheet 内
async function scenario3() {
  section('3. 微信资料同步：一键取号成功 / 取消 / 隐私 / 无权限 / 开发者工具 / 换码失败')
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
  }
  {
    // 成功但姓名未填：回填字段、给引导，不落库
    const { page, apiCalls, dispatches } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onPhoneCode(phoneEv({ code: 'wx-code-2' }))
    await waitFor(() => page.data.person.phone === '13800000000')
    await sleep(20)
    check('姓名未齐：取号回填但不发 profile.save',
      apiCalls.length === 1 && dispatches.length === 0, JSON.stringify({ calls: apiCalls.length, d: dispatches.length }))
    check('给「补全后自动保存」引导', /补全姓名与手机号后/.test(page.data.hint || ''), page.data.hint)
  }
  {
    // 用户取消：不调接口、不发命令；提示落在 sheet 内且不是错误（12 §6）
    const { page, apiCalls, dispatches } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail cancel' }))
    await sleep(20)
    check('用户取消：不调 getPhoneNumber、不发 profile.save',
      apiCalls.length === 0 && dispatches.length === 0, JSON.stringify({ calls: apiCalls.length, d: dispatches.length }))
    check('用户取消：sheet 内给「已取消」提示（非 error 作用域）',
      /取消/.test(page.data.sheetHint || '') && page.data.sheetError === '',
      JSON.stringify({ hint: page.data.sheetHint, err: page.data.sheetError }))
  }
  {
    const { page, apiCalls } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail api scope is not declared in the privacy agreement' }))
    check('隐私 scope 未声明：sheet 内指引去平台配置《用户隐私保护指引》',
      page.data.sheetError.indexOf('用户隐私保护指引') !== -1 && page.data.sheetError.indexOf('mp.weixin.qq.com') !== -1,
      page.data.sheetError)
    check('隐私分支：不调接口（服务端换码无从谈起）', apiCalls.length === 0, JSON.stringify(apiCalls))
  }
  {
    const { page } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail 1400001 no permission' }))
    check('未开通权限：sheet 内提示手动填写', page.data.sheetError.indexOf('手机号快速验证') !== -1
      && page.data.sheetError.indexOf('手动填写') !== -1, page.data.sheetError)
  }
  {
    const { page } = bootMe({})
    await settle(page)
    page.onPhoneCode(phoneEv({ errMsg: 'getPhoneNumber:fail can only be invoked by user in developer tools' }))
    check('开发者工具：sheet 内提示真机预览或手动填写', page.data.sheetError.indexOf('开发者工具') !== -1,
      page.data.sheetError)
  }
  {
    const { page } = bootMe({ callImpl: () => Promise.reject(new Error('换取手机号失败')) })
    await settle(page)
    page.onPhoneCode(phoneEv({ code: 'wx-code-3' }))
    await waitFor(() => page.data.sheetError !== '')
    check('换码失败：可读报错透出到 sheet', page.data.sheetError === '换取手机号失败', page.data.sheetError)
  }
}

// 4. 自动保存 + 草稿 v2：齐全即落库 / 不齐引导 / 防抖 / 防重 / 失败恢复 / 两轮 reload 存活
async function scenario4() {
  section('4. 自动保存与草稿 v2：落库 / 草稿存活 / 防抖 / 防重 / 失败恢复')
  {
    const { page, dispatches, env } = bootMe({})
    await settle(page)
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    check('姓名+电话齐全：失焦即发 profile.save', dispatches[0].payload.type === 'profile.save')
    check('payload = {type, person} 两键，person 带姓名电话（免确认）',
      JSON.stringify(Object.keys(dispatches[0].payload).sort()) === JSON.stringify(['person', 'type'])
      && dispatches[0].payload.person.name === '张三' && dispatches[0].payload.person.phone === '13800000000',
      JSON.stringify(dispatches[0] && dispatches[0].payload))
    const person = dispatches[0].payload.person
    check('person 键集 = avatar/emergency/medical/name/phone（无杂散键）',
      JSON.stringify(Object.keys(person).sort()) === JSON.stringify(['avatar', 'emergency', 'medical', 'name', 'phone'])
      && JSON.stringify(Object.keys(person.emergency).sort()) === JSON.stringify(['name', 'phone']),
      JSON.stringify(Object.keys(person)))
    check('CAS 基准 = 档案读的 revision', dispatches[0].revision === 7, String(dispatches[0].revision))
    check('保存成功反馈「资料已保存」+ saving 复位 + revision 前滚',
      env.rec.toasts.indexOf('资料已保存') !== -1 && page.data.saving === false && page.revision === 8,
      JSON.stringify({ toasts: env.rec.toasts, saving: page.data.saving, rev: page.revision }))
    check('落库后提示已保存（待自动清除），error 为空',
      page.data.hint === '已保存' && page.data.error === '', page.data.hint)
    check('★ 落库成功后草稿（账号键与 v1）都被清掉', !draftOf(env), JSON.stringify(draftOf(env)))
    check('★ 落库成功后横幅数据位复位', page.data.draftPending === false)
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
  // ══════════════ 草稿回归（用户实测复现 + v2 语义）══════════════
  {
    const { page, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    // 只填紧急联系人 + 健康备注（姓名手机号没填 → 门槛不满足 → 不落库）
    page.onField(fieldEv('ename', '王五', 'emergency'))
    page.onField(fieldEv('ephone', '13700000000', 'emergency'))
    page.onField(fieldEv('medical', '花粉过敏', 'medical'))
    page.onBlurSave(blurEv('emergency'))
    const d = draftOf(env)
    check('门槛未满足时把输入写进本地草稿 v2（含 fields.savedAt）',
      d && d.fields.emergency.name === '王五' && d.fields.emergency.phone === '13700000000'
      && d.fields.medical === '花粉过敏' && typeof d.savedAt === 'string',
      JSON.stringify(d))
    check('草稿不含 avatar（云存储 fileID 由 onChooseAvatar 单独落库）',
      d && d.fields.avatar === undefined, d && JSON.stringify(d.fields.avatar))
  }
  {
    // ★ 关键回归（v2 修复）：切页回来（reload）草稿**保留在 storage**，且能撑过多次往返。
    // 旧实现的 pruneDraft 把合并值当比较基准，草稿每次 reload 都被清掉——输入只能活一轮。
    const { page, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('ename', '王五', 'emergency'))
    page.onField(fieldEv('medical', '花粉过敏', 'medical'))
    page.onBlurSave(blurEv('emergency'))
    page.onShow()
    await settle(page)
    check('★ 第一次切页回来：紧急联系人与健康备注仍在（页面值）',
      page.data.person.emergency.name === '王五' && page.data.person.medical === '花粉过敏',
      JSON.stringify(page.data.person))
    check('★ 第一次切页回来：草稿仍在 storage（横幅数据位亮起）',
      !!draftOf(env) && page.data.draftPending === true,
      JSON.stringify({ d: draftOf(env), pending: page.data.draftPending }))
    page.onShow()
    await settle(page)
    check('★ 第二次切页回来：输入仍未丢（旧实现在这里丢数据）',
      page.data.person.emergency.name === '王五' && page.data.person.medical === '花粉过敏'
      && !!draftOf(env),
      JSON.stringify({ em: page.data.person.emergency, med: page.data.person.medical }))
    check('★ 草稿横幅时间戳存在（v2 savedAt）', /\d{2}-\d{2} \d{2}:\d{2}/.test(page.data.draftSavedAt || ''),
      page.data.draftSavedAt)
  }
  {
    // 草稿不得污染 avatar：avatar 永远取服务端值。
    const { page } = bootMe({ profile: profileView({ person: { avatar: 'cloud://avatar-1' } }) })
    await settle(page)
    check('服务端头像已回填', page.data.person.avatar === 'cloud://avatar-1', page.data.person.avatar)
    page.onField(fieldEv('ename', '钱十三', 'emergency'))
    page.onShow()
    await settle(page)
    check('★ 草稿合入时 avatar 仍取服务端值，不被草稿污染',
      page.data.person.avatar === 'cloud://avatar-1', page.data.person.avatar)
    check('草稿里的紧急联系人合入成功', page.data.person.emergency.name === '钱十三',
      JSON.stringify(page.data.person.emergency))
    check('服务端已有手输字段保持不变', page.data.person.name === '张三', page.data.person.name)
  }
  {
    // v1 兼容迁移：旧键（裸五字段、无 savedAt）被读出合入，横幅无时间戳；落库后 v1 键清除。
    // 种子 = 当时的服务端值 + medical/emergency 增量（真实的 v1 草稿长这样：draftableOf 抄当时 data）
    const { page, dispatches, env } = bootMe({
      profile: profileView(),
      seed: env2 => {
        env2.store[DRAFT_KEY_V1] = { name: '张三', phone: '13800000000', medical: '花粉过敏', emergency: { name: '王五', phone: '' } }
      },
    })
    await settle(page)
    check('★ v1 草稿被读出并合入（medical/emergency 来自旧键）',
      page.data.person.medical === '花粉过敏' && page.data.person.emergency.name === '王五',
      JSON.stringify(page.data.person))
    check('★ v1 草稿无时间戳：横幅亮起但不显示时间',
      page.data.draftPending === true && page.data.draftSavedAt === '',
      JSON.stringify({ p: page.data.draftPending, t: page.data.draftSavedAt }))
    page.onBlurSave(blurEv())
    await waitFor(() => dispatches.length > 0)
    check('★ v1 草稿落库成功后旧键被清掉（迁移完成）',
      env.store[DRAFT_KEY_V1] === '' || env.store[DRAFT_KEY_V1] === null || env.store[DRAFT_KEY_V1] === undefined,
      String(env.store[DRAFT_KEY_V1]))
    check('迁移落库 payload 带迁移来的值',
      dispatches[0].payload.person.medical === '花粉过敏' && dispatches[0].payload.person.emergency.name === '王五',
      JSON.stringify(dispatches[0] && dispatches[0].payload.person))
  }
  {
    // 落库成功后清草稿：否则下次编辑会从一份过期草稿起步
    const { page, dispatches, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('name', '孙七'))
    page.onField(fieldEv('phone', '13600000000'))
    page.onField(fieldEv('ename', '周八', 'emergency'))
    page.onBlurSave(blurEv('emergency'))
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
    check('★ 落库失败时草稿保留（不丢用户输入）', d && d.fields.name === '吴九', JSON.stringify(d))
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
    await waitFor(() => page.data.hint === '已保存', 2000)
    check('自动保存给「已保存」确认', page.data.hint === '已保存', page.data.hint)
  }
  {
    // 卸载后不得再有定时器在跑：留着会在页面消失后继续 setData + 发请求。
    // ⚠ 先 sleep：api 是模块级单例，上一个块若留下未清的防抖定时器，会把 dispatch 记到错误的块。
    const { page, dispatches } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    await sleep(1000)
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

// 5. 本机未保存横幅：条件 / 立即保存 / 放弃（dialog 确认）
async function scenario5() {
  section('5. 本机未保存横幅：条件 / 立即保存 / 放弃本机修改')
  {
    // 横幅亮起：草稿 ≠ 服务端（门槛未满足的输入）
    const { page, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    check('无草稿时横幅数据位为假', page.data.draftPending === false)
    page.onField(fieldEv('ename', '王五', 'emergency'))
    check('输入后（门槛未满足）横幅数据位亮起', page.data.draftPending === true)
    check('横幅时间戳来自草稿 v2 savedAt', /\d{2}-\d{2} \d{2}:\d{2}/.test(page.data.draftSavedAt || ''),
      page.data.draftSavedAt)
    // 立即保存：门槛未满足 → 落库不发，横幅继续亮（草稿仍在）
    page.onSaveDraftNow()
    await sleep(20)
    check('立即保存（门槛未满足）：不落库、草稿保留、横幅仍亮',
      !!draftOf(env) && page.data.draftPending === true, JSON.stringify(draftOf(env)))
  }
  {
    // 立即保存（门槛满足）：落库成功 → 草稿清、横幅灭
    const { page, dispatches, env } = bootMe({ profile: emptyProfileView() })
    await settle(page)
    page.onField(fieldEv('name', '孙七'))
    page.onField(fieldEv('phone', '13600000000'))
    page.onSaveDraftNow()
    await waitFor(() => dispatches.length > 0)
    await sleep(10)
    check('立即保存：落库成功后横幅数据位熄灭、草稿清空',
      page.data.draftPending === false && !draftOf(env),
      JSON.stringify({ p: page.data.draftPending, d: draftOf(env) }))
  }
  {
    // 放弃本机修改：dialog 确认 → 清草稿 + reload 显示服务端值
    const { page, env, dispatches } = bootMe({ profile: profileView() })
    await settle(page)
    page.onField(fieldEv('medical', '本机未保存的备注', 'medical'))
    await sleep(20)
    check('放弃前：横幅亮起', page.data.draftPending === true)
    page.onAskDiscard()
    check('放弃入口：先出确认 dialog', page.data.discardAsk === true)
    page.onDiscardCancel()
    check('取消放弃：复位不删', page.data.discardAsk === false && page.data.draftPending === true)
    page.onAskDiscard()
    page.onDiscardConfirm()
    await settle(page)
    check('确认放弃：草稿清除、横幅熄灭',
      !draftOf(env) && page.data.draftPending === false && page.data.discardAsk === false,
      JSON.stringify({ d: draftOf(env), p: page.data.draftPending }))
    check('确认放弃：页面显示回服务端值',
      page.data.person.medical === '' && page.data.person.name === '张三',
      JSON.stringify(page.data.person))
    // ★ 回归（审计期补修）：放弃发生在 800ms 防抖窗口内时，定时器不得把刚放弃的草稿
    //   写回甚至落库——放弃 = 终止一切未落库意图
    await sleep(1000)
    check('★ 放弃后越过防抖窗口：草稿不被写回、不发任何命令',
      !draftOf(env) && page.data.draftPending === false && dispatches.length === 0,
      JSON.stringify({ d: draftOf(env), p: page.data.draftPending, n: dispatches.length }))
  }
}

// 6. 头像/昵称：chooseAvatar 上云覆盖 avatar 字段并自动保存；失败/无云能力有可读出口
async function scenario6() {
  section('6. 头像/昵称：即点即覆盖并自动保存')
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

// 7. D 组编辑面（手机号/紧急联系人/健康备注 sheet）+ 同行人增删改 + emergency 映射
async function scenario7() {
  section('7. D 组 sheet / 同行人 / 紧急联系人映射')
  {
    const { page, dispatches } = bootMe({})
    await settle(page)
    page.onOpenEmergency()
    check('紧急联系人摘要行打开 sheet', page.data.emergencySheetOpen === true)
    page.onField(fieldEv('ename', '赵六', 'emergency'))
    page.onField(fieldEv('ephone', '13611111111', 'emergency'))
    check('紧急联系两列输入映射到 emergency.name/phone（非杂散键）',
      page.data.person.emergency.name === '赵六' && page.data.person.emergency.phone === '13611111111'
      && !('ename' in page.data.person.emergency) && !('ephone' in page.data.person.emergency),
      JSON.stringify(page.data.person.emergency))
    page.onBlurSave(blurEv('emergency'))
    await waitFor(() => dispatches.length > 0)
    const em = dispatches[0].payload.person.emergency
    check('紧急联系人填齐后失焦：profile.save 的 emergency 干净可收（服务端严格 schema）',
      em.name === '赵六' && em.phone === '13611111111'
        && JSON.stringify(Object.keys(em).sort()) === JSON.stringify(['name', 'phone']),
      JSON.stringify(em))
  }
  {
    const { page } = bootMe({})
    await settle(page)
    page.onOpenMedical()
    check('健康备注摘要行打开 sheet', page.data.medicalSheetOpen === true)
    page.onField(fieldEv('medical', '哮喘史', 'medical'))
    check('sheet 内输入写入 medical 字段', page.data.person.medical === '哮喘史')
    page.onCloseSheet()
    check('关闭后内容保留在页面态（草稿/自动保存接管）', page.data.medicalSheetOpen === false
      && page.data.person.medical === '哮喘史')
  }
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
      page.data.companionOpen === false && page.data.companionError === '', JSON.stringify(page.data))
    await waitFor(() => reads.length === before + 1)
    check('同行人保存后重读（me 单读回填列表）', reads.length === before + 1, String(reads.length))
  }
  {
    const { page, dispatches } = bootMe({
      profile: profileView({ companions: [{ id: 'c1', person: { name: '李四', phone: '13900000000', emergency: { name: '', phone: '' }, medical: '' } }] }),
    })
    await settle(page)
    page.onCompanionSave()
    check('姓名或电话缺失：不发命令并在弹层内点名', dispatches.length === 0
      && page.data.companionError === '请填写同行人姓名与联系电话。', page.data.companionError)
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
    await waitFor(() => reads.length === before + 1)
    check('移除后重读回填列表', reads.length === before + 1, String(reads.length))
  }
  {
    // 同行人弹层内的紧急联系人字段同样映射到 emergency.name/phone
    const { page } = bootMe({})
    await settle(page)
    page.onAddCompanion()
    page.onCompanionField(fieldEv('ename', '赵六'))
    page.onCompanionField(fieldEv('ephone', '13611111111'))
    const em = page.data.companionPerson.emergency
    check('同行人弹层的紧急联系人字段映射到 emergency.name/phone',
      em.name === '赵六' && em.phone === '13611111111' && !('ename' in em) && !('ephone' in em),
      JSON.stringify(em))
  }
}

// 8. 协作码 / 最近活动导航 / 位置授权撤回 / 下拉刷新
async function scenario8() {
  section('8. 协作码 / 最近活动 / 位置撤回 / 下拉刷新')
  {
    const { page, env } = bootMe({})
    await settle(page)
    check('身份码完整值保留（identity = profile.id）', page.data.identity === 'p1', page.data.identity)
    page.onCopyIdentity()
    check('复制按钮调 wx.setClipboardData 且内容 = 完整协作码',
      env.rec.clipboard.length === 1 && env.rec.clipboard[0] === 'p1', JSON.stringify(env.rec.clipboard))
    check('复制成功反馈「协作码已复制」', env.rec.toasts.indexOf('协作码已复制') !== -1, JSON.stringify(env.rec.toasts))
  }
  {
    const { page, env } = bootMe({ home: homeWithPosition() })
    await settle(page)
    check('最近活动装配（来源 home 读，slim 行）',
      page.data.recent.length === 0, JSON.stringify(page.data.recent)) // homeWithPosition 的活动无 phase/meta.owner
    page.onOpenRecent(tapDs({ id: 'a1' }).currentTarget ? { currentTarget: { dataset: { id: 'a1' } } } : {})
    check('点击最近活动行发起 navigateTo 详情页', env.rec.navs.indexOf('/pages/activity/activity?id=a1') !== -1,
      JSON.stringify(env.rec.navs))
  }
  {
    const { page, dispatches, reads, env } = bootMe({ home: homeWithPosition() })
    await settle(page)
    const before = reads.length
    page.onRevoke(tapDs({ activityId: 'a1', signupId: 's1' }))
    await waitFor(() => dispatches.length > 0)
    check('撤回位置授权发 position.revoke（activityId+signupId）',
      dispatches[0].payload.type === 'position.revoke' && dispatches[0].payload.activityId === 'a1'
      && dispatches[0].payload.signupId === 's1',
      JSON.stringify(dispatches[0] && dispatches[0].payload))
    check('撤回反馈', env.rec.toasts.indexOf('位置授权已撤回') !== -1, JSON.stringify(env.rec.toasts))
    await waitFor(() => reads.length === before + 1)
    check('撤回后重读回填', reads.length === before + 1, String(reads.length))
  }
  {
    const { page, reads, env } = bootMe({})
    await settle(page)
    const before = reads.length
    page.onPullDownRefresh()
    await waitFor(() => env.rec.pulls > 0)
    check('下拉刷新：重读 me 视图', reads.length === before + 1, String(reads.length - before))
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

// 9. 错误作用域隔离（12 §5）：页面 / sheet / companion 三槽位互不越界
async function scenario9() {
  section('9. 错误作用域：页面级 / sheet / companion 三槽位')
  {
    // phone 作用域失败 → sheetError；页面级 error 保持为空
    const { page } = bootMe({ dispatchPlan: [new Error('保存失败，请稍后再试')] })
    await settle(page)
    page.onOpenPhone()
    page.onField(fieldEv('phone', '13800000001', 'phone'))
    page.onBlurSave(blurEv('phone'))
    await waitFor(() => page.data.sheetError !== '')
    check('sheet 内保存失败：错误落在 sheetError，页面级 error 为空',
      page.data.sheetError === '保存失败，请稍后再试' && page.data.error === '',
      JSON.stringify({ s: page.data.sheetError, p: page.data.error }))
  }
  {
    // 页面级失败（昵称 blur）→ error；随后打开编辑面时被清空
    const { page } = bootMe({ dispatchPlan: [new Error('保存失败，请稍后再试')] })
    await settle(page)
    page.onBlurSave(blurEv())
    await waitFor(() => page.data.error !== '')
    check('页面级保存失败：错误落在 error', page.data.error === '保存失败，请稍后再试', page.data.error)
    page.onOpenMedical()
    check('打开编辑面清掉页面级残留错误', page.data.error === '' && page.data.medicalSheetOpen === true)
  }
  {
    // companion 失败 → companionError，与页面级互不影响
    const { page, dispatches } = bootMe({
      profile: profileView({ companions: [{ id: 'c1', person: { name: '李四', phone: '13900000000', emergency: { name: '', phone: '' }, medical: '' } }] }),
      dispatchPlan: [new Error('请先保存当前账号资料。')],
    })
    await settle(page)
    page.onEditCompanion(tapId('c1'))
    await waitFor(() => page.data.companionOpen === true)
    page.onCompanionSave()
    await waitFor(() => page.data.companionError !== '')
    check('同行人保存失败：错误落在 companionError（弹层内，P0-4 位置），页面级 error 为空',
      page.data.companionError === '请先保存当前账号资料。' && page.data.error === '',
      JSON.stringify({ c: page.data.companionError, p: page.data.error }))
    check('同行人失败不发第一条计划外命令', dispatches.length === 1, String(dispatches.length))
  }
}

// 10. me 视图数据装配：stats/recent fixtures 进 data + 客户端只做展示文案映射（PHASE_LABELS/dateLabel）
//     ——服务端口径矩阵已上移到 smoke §16a（服务端是口径的唯一权威，客户端不再复算）
async function scenario10() {
  section('10. me 视图装配：stats/recent fixtures → data + 展示文案映射')
  {
    const { page } = bootMe({
      stats: { ongoing: 2, finished: 1, organized: 3 },
      recent: [
        { id: 'a3', title: '集合C', startAt: '2026-10-01T08:00:00+08:00', phase: 'gathering', role: 'participant' },
        { id: 'a1', title: '行前A', startAt: '2026-10-12T08:00:00+08:00', phase: 'published', role: 'owner' },
        { id: 'a5', title: '取消E', startAt: '2026-10-03T08:00:00+08:00', phase: 'cancelled', role: 'owner' },
      ],
    })
    await settle(page)
    check('页面装配：stats 三计数原样进 data（服务端口径，客户端不复算）',
      JSON.stringify(page.data.stats) === JSON.stringify({ ongoing: 2, finished: 1, organized: 3 }),
      JSON.stringify(page.data.stats))
    check('页面装配：recent 顺序保持服务端排序（≤3 条）',
      page.data.recent.length === 3 && page.data.recent[0].id === 'a3' && page.data.recent[2].id === 'a5',
      JSON.stringify(page.data.recent))
    check('展示文案映射：dateText（北京时间 MM/DD 周X）与 phaseText（PHASE_LABELS）',
      page.data.recent[0].dateText === '10/01 周四' && page.data.recent[0].phaseText === '正在集合'
      && page.data.recent[2].phaseText === '已取消',
      JSON.stringify(page.data.recent.map(r => ({ d: r.dateText, p: r.phaseText }))))
    check('slim 行不携带 routeSnapshot/meta',
      page.data.recent.every(r => !r.meta && !r.routeSnapshot), '')
  }
}

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6, scenario7, scenario8, scenario9, scenario10]
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
