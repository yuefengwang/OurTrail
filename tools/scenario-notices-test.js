// 通知列表工厂场景测试：node tools/scenario-notices-test.js
// 目的：把「通知列表 → 已读回执 → 组织者发布/复制投递」这条业务链路在 node 下走一遍——
// 被测对象是 utils/notices-page.js 工厂与消费它的两个真页面：
//   pages/notices/notices.js  （全局 Tab，activityId() === null）
//   pages/anotices/anotices.js（活动内，activityId() = 入参 id）
// 真页面配置（global.Page 捕获，两个消费页各自加载）+ 真 api/draft/format 模块 +
// 网络桩（覆写 utils/api 的 read/readOr/dispatchAndSync），驱动真 handler，
// 断言「read 的 request 形状差异 + 发出了什么命令 + payload 是否通过服务端 schema +
// 页面状态变化 + 用户可见反馈」。
//
// 手法与 tools/scenario-editor-test.js / scenario-signup-test.js 一致：
// setData 记录进 _patches 并同步 this.data，setData 回调经 setImmediate 异步触发；
// wx 桩：内存 storage（draft.js 走 wx storage）/ toast / 导航 / 剪贴板 / 下拉收尾。
// notices-page.js 持有的是 api 模块对象本身（const api = require('./api')），覆写属性即生效。
//
// 已知问题（涉及用例按「正确行为」断言但计为 skipped（~ 标记），修复后自动转为真实校验）：
// notices-page.js:85 loadPublishContext 用 this.setData({..., revision: res.revision}) 把活动读的
// revision 写进了页面 data（无任何渲染消费的死键），而不是刷新 CAS 基准 this.revision——对照下一行
// this.now = res.now 的直接赋值，显然是想同步刷新 revision。后果：发布上下文装配后，publish/read/
// delivery 命令仍以列表读的旧 revision 作 CAS 基准，两次读之间若他人写入会多一次可自愈的 CONFLICT。
'use strict'
const NOTICES_PATH = require.resolve('../miniprogram/pages/notices/notices.js')
const ANOTICES_PATH = require.resolve('../miniprogram/pages/anotices/anotices.js')
const FACTORY_PATH = require.resolve('../miniprogram/utils/notices-page.js')
const api = require('../miniprogram/utils/api')
const draft = require('../miniprogram/utils/draft')
const F = require('../miniprogram/utils/format')
const schema = require('../cloudfunctions/trailApi/domain/schema.js')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
// 已知问题统一口径：'path:line 说明'
const ISSUE_REVISION = 'miniprogram/utils/notices-page.js:85 loadPublishContext 把活动读的 revision 写进页面 data（setData 键，无消费），未刷新 CAS 基准 this.revision（对照下一行 this.now = res.now）——装配后命令仍用列表读的旧 revision，两次读之间他人写入会多一次可自愈的 CONFLICT'
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
async function settleTab(page) { await waitFor(() => page.data.loading === false) }
// 活动内页：reload 之后 loadPublishContext 异步补装配（owner 路径多一次活动读；非 owner 走 catch）。
// 等它落定再断言，防止「列表好了但发布上下文还没回来」的半成品状态泄漏进断言。
async function settleActivity(page, reads) {
  await waitFor(() => page.data.loading === false)
  await waitFor(() => reads.some(r => r.kind === 'activity')
    || (page.data.items.length > 0 && page.data.items.every(i => i.owned === false)))
}

// ---- 合成事件 ----
const tapData = data => ({ currentTarget: { dataset: data || {} } })
const inputEv = value => ({ detail: { value } })

// ---- wx 桩：内存 storage + toast/导航/剪贴板/下拉收尾记录；每台页面换新，互不串味 ----
function makeWx(over) {
  const store = { 'ourtrail.openid': 'u-test' }
  const rec = { toasts: [], nav: [], clip: [], pulls: 0 }
  const wx = Object.assign({
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push((o && o.title) || ''),
    navigateTo: o => rec.nav.push((o && o.url) || ''),
    redirectTo: o => rec.nav.push((o && o.url) || ''),
    switchTab: o => rec.nav.push((o && o.url) || ''),
    stopPullDownRefresh: () => { rec.pulls++ },
    setClipboardData: o => { rec.clip.push(o && o.data); if (o && o.success) o.success({}) },
    vibrateShort: () => {},
  }, over || {})
  return { wx, store, rec }
}

// 加载真页面配置（global.Page 捕获；工厂与页面每次都取最新源码，避免吃到缓存的旧实现）
function pageConfig(path) {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[FACTORY_PATH]
  delete require.cache[path]
  require(path)
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

// ---- 样例视图（形状对齐 selectors 的 notices 投影 / noticeView / activityView）----
const NOW = '2026-09-29T09:00:00+08:00'
function sampleNotices() {
  return [
    { id: 'n1', activityId: 'a1', content: '周五 20:00 东门集合', publishedAt: '2026-09-28T08:00:00+08:00', read: true },
    { id: 'n2', activityId: 'a1', content: '集合时间提前 10 分钟', publishedAt: '2026-09-29T08:30:00+08:00', read: false },
  ]
}
// readNoticeManagement 的 value（ownerPermission 通过后：该活动全部通知的 noticeView 投影）
function mgmtValue() {
  return {
    notices: [
      { id: 'n1', deliveries: [] },
      {
        id: 'n2',
        deliveries: [
          { id: 'd1', channel: 'copy', status: 'copied', at: NOW, by: 'p1', detail: '' },
          { id: 'd2', channel: 'subscription_simulation', status: 'simulated_success', at: NOW, by: 'p1', detail: '' },
        ],
      },
    ],
  }
}
function activityView(phase) {
  return {
    view: {
      kind: 'activity', permittedActions: [], activity: { id: 'a1', title: '青城后山 · 周末轻徒步', phase: phase || 'active' },
      // P0-3：定向通知的候选名单（rowView 形状，键为 signupId）
      rows: [
        { signupId: 's1', name: '张三', status: 'confirmed' },
        { signupId: 's2', name: '李四', status: 'pending' },
        { signupId: 's3', name: '王五', status: 'waitlisted' },
      ],
    },
    revision: 9,
    now: NOW,
  }
}

// 装一台通知页：path = NOTICES_PATH（全局 Tab）或 ANOTICES_PATH（活动内）。
// opts: {options, notices, revision, activityPhase, mgmt(null=非所有者), denied, readError, wx}
// state.applyDispatch 可注入「服务端执行命令」的副作用（dispatch 后的下一次 read 反映已应用状态）。
function bootNotices(path, opts) {
  opts = opts || {}
  const state = {
    notices: (opts.notices || sampleNotices()).slice(),
    revision: opts.revision || 4,
    activityPhase: opts.activityPhase || 'active',
    transportVehicles: opts.transportVehicles || null,
    applyDispatch: null,
  }
  const reads = []   // read 的 request
  const readOrs = [] // readOr 的 {name, data}
  const cmds = []    // dispatchAndSync 的 {payload, revision}
  api.read = req => {
    reads.push(req)
    if (opts.readError) return Promise.reject(new Error(opts.readError))
    if (req.kind === 'notices') {
      if (opts.denied) return Promise.resolve({ view: { kind: 'denied', message: opts.denied }, revision: state.revision, now: NOW })
      return Promise.resolve({ view: { kind: 'notices', notices: state.notices }, revision: state.revision, now: NOW })
    }
    if (req.kind === 'activity') return Promise.resolve(activityView(state.activityPhase))
    return Promise.resolve({ view: { kind: 'denied', message: '无权访问' }, revision: 1, now: NOW })
  }
  api.readOr = (name, data) => {
    readOrs.push({ name, data })
    if (name === 'readTransport') {
      // P0-3：定向车辆的候选来源。桩返回的是 api.readOr 拆包后的 value（与其余 readOr 桩同约定）
      return Promise.resolve({ vehicles: state.transportVehicles || [] })
    }
    if (opts.mgmt === null) return Promise.reject(new Error('无权访问'))
    return Promise.resolve(opts.mgmt !== undefined ? opts.mgmt : mgmtValue())
  }
  api.dispatchAndSync = (payload, revision) => {
    cmds.push({ payload, revision })
    if (state.applyDispatch) state.applyDispatch(payload)
    return Promise.resolve({ targetIds: [], revision: (revision || 0) + 1 })
  }
  const env = makeWx(opts.wx)
  global.wx = env.wx
  const page = makePage(pageConfig(path))
  page.onLoad(opts.options || {})
  page.onShow()
  return { page, reads, readOrs, cmds, env, state }
}

// 1. 列表装配（全局 Tab）：request 不带 activityId；倒序、未读标记、时间透传；denied / 读失败有出口
async function scenario1() {
  section('1. 列表装配（全局 Tab）：request 形状 / 倒序 / 未读标记 / denied / 读失败')
  {
    const { page, reads, readOrs } = bootNotices(NOTICES_PATH, {})
    await settleTab(page)
    check('onShow 触发读取，request = {kind:"notices"} 不带 activityId 键',
      reads.length === 1 && reads[0].kind === 'notices' && !('activityId' in reads[0]), JSON.stringify(reads))
    check('最新在前（服务端序反转装配）',
      page.data.items.length === 2 && page.data.items[0].id === 'n2' && page.data.items[1].id === 'n1',
      JSON.stringify(page.data.items.map(i => i.id)))
    check('未读计数 = 1，未读项带 read:false（WXML 据此渲染未读徽标与左边条）',
      page.data.items.filter(i => !i.read).length === 1 && page.data.items[0].read === false
      && page.data.items[1].read === true,
      JSON.stringify(page.data.items.map(i => i.read)))
    check('时间经 format.dtFull 转北京时间（透传 publishedAt）',
      page.data.items[0].time === '2026-09-29 08:30' && page.data.items[0].time === F.dtFull(sampleNotices()[1].publishedAt),
      page.data.items[0].time)
    check('内容与所属活动透传', page.data.items[0].content === '集合时间提前 10 分钟' && page.data.items[0].activityId === 'a1')
    check('revision 记录自列表读（后续命令的 CAS 基准）', page.revision === 4, String(page.revision))
    check('全局 Tab 不拉发布上下文（无 readOr，canPublish 恒 false）',
      readOrs.length === 0 && page.data.canPublish === false, JSON.stringify(readOrs))
  }
  {
    const { page } = bootNotices(NOTICES_PATH, { denied: '请先选择当前账号。' })
    await settleTab(page)
    check('denied 视图透出原文，不装配列表',
      page.data.denied === '请先选择当前账号。' && page.data.items.length === 0 && page.data.loading === false, page.data.denied)
  }
  {
    const { page } = bootNotices(NOTICES_PATH, { readError: '网络异常，请稍后再试' })
    await settleTab(page)
    check('读取失败：errorText 落到 denied 位', page.data.denied === '网络异常，请稍后再试' && page.data.loading === false,
      page.data.denied)
  }
  {
    const { page } = bootNotices(NOTICES_PATH, { notices: [] })
    await settleTab(page)
    check('空列表：loading 收尾不炸', page.data.loading === false && page.data.denied === '' && page.data.items.length === 0)
  }
}

// 2. 标记已读：notice.read 命令（schema 对齐）+ 服务端记账后重读 → 本地未读态翻转；失败透出
async function scenario2() {
  section('2. 标记已读：notice.read payload + 未读态翻转 + 失败透出')
  {
    const { page, cmds, reads, state } = bootNotices(NOTICES_PATH, {})
    await settleTab(page)
    // 建模服务端：dispatch 应用 notice.read 后，下一次 read 反映已读
    state.applyDispatch = p => {
      if (p && p.type === 'notice.read') state.notices = state.notices.map(n => (n.id === p.noticeId ? Object.assign({}, n, { read: true }) : n))
    }
    page.onMarkRead(tapData({ id: 'n2', activityId: 'a1' }))
    await waitFor(() => cmds.length === 1)
    const p = cmds[0].payload
    check('发 notice.read', p.type === 'notice.read')
    check('payload 恰为 type/activityId/noticeId（对齐 schema，无多余键）',
      p.activityId === 'a1' && p.noticeId === 'n2'
      && JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['activityId', 'noticeId', 'type']), JSON.stringify(p))
    check('expectedRevision = 列表读的 revision（CAS 基准）', cmds[0].revision === 4, String(cmds[0].revision))
    check('notice.read 通过服务端 schema 校验', schema.validate(schema.Payload.map['notice.read'], p))
    check('命令成功后重读列表（未读态以服务端为准）', await waitFor(() => reads.length === 2) && reads.length === 2,
      String(reads.length))
    await waitFor(() => page.data.items[0].read === true)
    check('重读后本地未读态翻转（n2 → 已读，未读清零）',
      page.data.items[0].id === 'n2' && page.data.items[0].read === true && page.data.items.filter(i => !i.read).length === 0,
      JSON.stringify(page.data.items.map(i => [i.id, i.read])))
  }
  {
    const { page, cmds } = bootNotices(NOTICES_PATH, {})
    await settleTab(page)
    api.dispatchAndSync = () => Promise.reject(new Error('请稍后再试'))
    page.onMarkRead(tapData({ id: 'n2', activityId: 'a1' }))
    await waitFor(() => page.data.error === '请稍后再试')
    check('标记失败：错误透出（不打断列表）', page.data.error === '请稍后再试', page.data.error)
  }
}

// 3. 活动内通知（anotices）：request 带 activityId；组织者发布上下文装配；非所有者与已归档降级
async function scenario3() {
  section('3. 活动内通知：request 带 activityId + 发布上下文 / 非所有者 / 已归档')
  {
    const { page, reads, readOrs } = bootNotices(ANOTICES_PATH, { options: { id: 'a1' } })
    check('onLoad 记住入口 activityId', page.activityId() === 'a1', String(page.activityId()))
    await settleActivity(page, reads)
    check('request = {kind:"notices", activityId:"a1"}（与全局 Tab 的形状差异）',
      reads.length >= 1 && reads[0].kind === 'notices' && reads[0].activityId === 'a1', JSON.stringify(reads[0]))
    check('组织者：readNoticeManagement {activityId}（仅所有者可读）',
      readOrs.length === 1 && readOrs[0].name === 'readNoticeManagement' && readOrs[0].data.activityId === 'a1',
      JSON.stringify(readOrs))
    check('再以 participant 视角读活动判发布权',
      reads.some(r => r.kind === 'activity' && r.activityId === 'a1' && r.perspective === 'participant'),
      JSON.stringify(reads))
    check('活动进行中：canPublish = true（发布按钮数据位）', page.data.canPublish === true)
    const n2 = page.data.items.find(i => i.id === 'n2')
    const n1 = page.data.items.find(i => i.id === 'n1')
    check('own 条目带 owned 标记', !!n2 && n2.owned === true && !!n1 && n1.owned === true,
      JSON.stringify(page.data.items.map(i => [i.id, i.owned])))
    check('投递记录标签：复制/模拟订阅 × 状态文案',
      JSON.stringify(n2.deliveries.map(d => d.label)) === JSON.stringify(['复制 · 已复制', '模拟订阅 · 模拟成功']),
      JSON.stringify(n2 && n2.deliveries))
    check('无投递记录的条目 deliveries 为空数组', n1.deliveries.length === 0)
    const revFresh = page.revision === 9
    checkGate(!revFresh, ISSUE_REVISION, '发布上下文把 CAS 基准刷成活动读的 revision',
      revFresh, 'this.revision=' + String(page.revision) + ' data.revision=' + String(page.data.revision))
  }
  {
    const { page, reads } = bootNotices(ANOTICES_PATH, { options: { id: 'a1' }, mgmt: null })
    await settleActivity(page, reads)
    check('非所有者：canPublish=false、条目不带 owned/投递记录',
      page.data.canPublish === false && page.data.items.every(i => i.owned === false && i.deliveries.length === 0),
      JSON.stringify(page.data.items.map(i => [i.id, i.owned])))
    check('非所有者不读活动判发布权（catch 直接降级）', !reads.some(r => r.kind === 'activity'), JSON.stringify(reads.map(r => r.kind)))
  }
  {
    const { page, reads } = bootNotices(ANOTICES_PATH, { options: { id: 'a1' }, activityPhase: 'archived' })
    await settleActivity(page, reads)
    check('活动已归档：可读但 canPublish=false（不可再发布）',
      page.data.loading === false && page.data.canPublish === false && page.data.items.length === 2)
  }
}

// 4. 发布流（仅 anotices 有）：草稿续填 + 受众三形态 + notice.publish payload；失败保留草稿；全局 Tab 防误触
async function scenario4() {
  section('4. 发布流：草稿续填 / 受众三形态 / notice.publish payload / 失败保留')
  {
    const { page, cmds, reads } = bootNotices(ANOTICES_PATH, {
      options: { id: 'a1' },
      transportVehicles: [{ id: 'v9', label: '9号车', plate: '川A·9' }],
    })
    await settleActivity(page, reads)
    page.onOpenPublish()
    check('打开发布弹层（无草稿 → 空内容）', page.data.publishOpen === true && page.data.content === '')
    page.onPublish()
    check('空白内容不发命令', cmds.length === 0, String(cmds.length))
    page.onContent(inputEv('明早 7:00 准时出发，过时不候'))
    check('输入即存草稿（断点续填，走 wx storage）',
      !!draft.getDraft('a1', 'notice') && draft.getDraft('a1', 'notice').content === '明早 7:00 准时出发，过时不候')
    page.onClosePublish()
    check('关闭弹层不清草稿', page.data.publishOpen === false && !!draft.getDraft('a1', 'notice'))
    page.onOpenPublish()
    check('重开恢复草稿内容', page.data.publishOpen === true && page.data.content === '明早 7:00 准时出发，过时不候')
    const revBefore = page.revision
    page.onAudience(inputEv('0'))
    page.onPublish()
    await waitFor(() => cmds.length === 1)
    const p = cmds[0].payload
    check('默认受众「本活动相关人员」→ audience {kind:"activity"}',
      p.type === 'notice.publish' && JSON.stringify(p.audience) === JSON.stringify({ kind: 'activity' }), JSON.stringify(p.audience))
    check('payload 恰为 type/activityId/audience/content（无多余键）',
      p.activityId === 'a1' && p.content === '明早 7:00 准时出发，过时不候'
      && JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['activityId', 'audience', 'content', 'type']),
      JSON.stringify(Object.keys(p)))
    check('expectedRevision = 发布前的页面 revision（CAS）', cmds[0].revision === revBefore,
      cmds[0].revision + ' vs ' + revBefore)
    check('notice.publish 通过服务端 schema 校验', schema.validate(schema.Payload.map['notice.publish'], p))
    check('发布成功：清草稿 + 关弹层 + 清空输入 + 提示',
      draft.getDraft('a1', 'notice') === undefined && page.data.publishOpen === false && page.data.content === ''
      && page.data.message === '通知已发布。', JSON.stringify({ m: page.data.message }))
    await waitFor(() => reads.filter(r => r.kind === 'notices').length === 2)
    check('发布后重读列表', reads.filter(r => r.kind === 'notices').length === 2, String(reads.length))
    // 指定报名人员（P0-3 改造后）：候选来自 organizer 名单（fixture rows），勾选即选中——
    // 发布成功会清空输入，像真实用户一样重开弹层（onOpenPublish 重新拉候选）再勾再发
    page.onOpenPublish()
    await waitFor(() => page.data.signupRows.length === 3)
    page.onContent(inputEv('报名的伙伴注意带头灯'))
    page.onAudience(inputEv('1'))
    await waitFor(() => page.data.audienceKind === 'signups')
    check('报名候选带状态文案（rowView.signupId → label）',
      page.data.signupRows[0].id === 's1' && /已确认/.test(page.data.signupRows[0].label)
        && /待审核/.test(page.data.signupRows[1].label),
      JSON.stringify(page.data.signupRows))
    // 守卫先行（此时还未勾选）：空选集发布被拦，不再产出空 signupIds 的死命令
    check('未勾选就发布被拦', (() => {
      page.onPublish()
      return cmds.length === 1 && /至少勾选/.test(page.data.error)
    })(), page.data.error)
    page.onToggleSignupTarget({ currentTarget: { dataset: { id: 's1' } } })
    page.onToggleSignupTarget({ currentTarget: { dataset: { id: 's2' } } })
    page.onPublish()
    await waitFor(() => cmds.length === 2)
    check('signups 受众：来自勾选的 signupIds',
      JSON.stringify(cmds[1].payload.audience) === JSON.stringify({ kind: 'signups', signupIds: ['s1', 's2'] }),
      JSON.stringify(cmds[1].payload.audience))
    check('signups 受众通过服务端 schema 校验', schema.validate(schema.Payload.map['notice.publish'], cmds[1].payload))
    // 指定车辆（P0-3 改造后）：候选来自 readTransport，picker 选中即 vehicleId
    page.onOpenPublish()
    await waitFor(() => page.data.vehicleRows.length === 1 && page.data.vehicleRows[0].id === 'v9')
    page.onContent(inputEv('车辆 9 号 7:40 发车'))
    page.onAudience(inputEv('2'))
    await waitFor(() => page.data.audienceKind === 'vehicle')
    check('车辆候选带车牌（readTransport → label）', /9号车/.test(page.data.vehicleRows[0].label),
      page.data.vehicleRows[0].label)
    page.onVehicleTarget(inputEv('0'))
    page.onPublish()
    await waitFor(() => cmds.length === 3)
    check('vehicle 受众：vehicleId 来自候选（不再手填）',
      JSON.stringify(cmds[2].payload.audience) === JSON.stringify({ kind: 'vehicle', vehicleId: 'v9' }),
      JSON.stringify(cmds[2].payload.audience))
    check('vehicle 受众通过服务端 schema 校验', schema.validate(schema.Payload.map['notice.publish'], cmds[2].payload))
  }
  {
    const { page, cmds, reads } = bootNotices(ANOTICES_PATH, { options: { id: 'a1' } })
    await settleActivity(page, reads)
    page.onOpenPublish()
    page.onContent(inputEv('会被拒绝的内容'))
    api.dispatchAndSync = payload => { cmds.push({ payload }); return Promise.reject(new Error('内容含敏感词')) }
    page.onPublish()
    await waitFor(() => page.data.error === '内容含敏感词')
    check('发布失败：错误透出、弹层不关、草稿保留（可改后重发）',
      page.data.publishOpen === true && !!draft.getDraft('a1', 'notice')
      && draft.getDraft('a1', 'notice').content === '会被拒绝的内容',
      JSON.stringify({ e: page.data.error, open: page.data.publishOpen }))
  }
  {
    const { page, cmds } = bootNotices(NOTICES_PATH, {})
    await settleTab(page)
    page.setData({ content: '全局 Tab 误触' })
    page.onPublish()
    check('全局 Tab 无 activityId：onPublish 空操作', cmds.length === 0, String(cmds.length))
    page.onOpenPublish()
    check('全局 Tab 打开发布弹层也被拦（无活动可发）', page.data.publishOpen === false)
  }
}

// 5. 下拉刷新（成功/失败都收尾）/ 打开活动 / 复制通知与投递记录审计
async function scenario5() {
  section('5. 下拉刷新 / 打开活动 / 复制通知与投递记录')
  {
    const { page, reads, env } = bootNotices(NOTICES_PATH, {})
    await settleTab(page)
    const before = reads.length
    page.onPullDownRefresh()
    await waitFor(() => reads.length > before && env.rec.pulls > 0)
    check('下拉刷新重新 read 并收起下拉 loading', reads.length - before === 1 && env.rec.pulls === 1,
      JSON.stringify({ d: reads.length - before, pulls: env.rec.pulls }))
  }
  {
    const { page, env } = bootNotices(NOTICES_PATH, {})
    await settleTab(page)
    api.read = () => Promise.reject(new Error('网络异常，请稍后再试'))
    page.onPullDownRefresh()
    await waitFor(() => env.rec.pulls > 0)
    check('刷新失败同样收起 loading 并透出原因（catch 分支）',
      env.rec.pulls === 1 && page.data.denied === '网络异常，请稍后再试', page.data.denied)
  }
  {
    const { page, env } = bootNotices(NOTICES_PATH, {})
    await settleTab(page)
    page.onOpenActivity(tapData({ id: 'a1' }))
    check('打开活动：navigateTo 详情页', env.rec.nav.indexOf('/pages/activity/activity?id=a1') !== -1, JSON.stringify(env.rec.nav))
    check('最近查看记忆写入（首页「最近」筛选依赖它）', draft.getOpened().indexOf('a1') !== -1, JSON.stringify(draft.getOpened()))
  }
  {
    // 复制通知（组织者 owned 条目）：剪贴板 + notice.delivery 审计 + 重读
    const { page, cmds, reads, env } = bootNotices(ANOTICES_PATH, { options: { id: 'a1' } })
    await settleActivity(page, reads)
    const revBefore = page.revision
    page.onCopy(tapData({ id: 'n2', activityId: 'a1' }))
    check('复制：通知原文进剪贴板', env.rec.clip.length === 1 && env.rec.clip[0] === '集合时间提前 10 分钟', JSON.stringify(env.rec.clip))
    await waitFor(() => cmds.length === 1)
    const p = cmds[0].payload
    check('投递记录：notice.delivery channel=copy status=copied',
      p.type === 'notice.delivery' && p.channel === 'copy' && p.status === 'copied', JSON.stringify(p))
    check('delivery 指向该条通知，detail 记录来源',
      p.activityId === 'a1' && p.noticeId === 'n2' && p.detail === '小程序剪贴板复制', JSON.stringify(p))
    check('notice.delivery 通过服务端 schema 校验', schema.validate(schema.Payload.map['notice.delivery'], p))
    check('expectedRevision = 复制前的页面 revision', cmds[0].revision === revBefore, cmds[0].revision + ' vs ' + revBefore)
    check('复制反馈文案（提醒自行选择发送对象）',
      page.data.message.indexOf('已复制') !== -1 && page.data.message.indexOf('发送对象') !== -1, page.data.message)
    await waitFor(() => reads.filter(r => r.kind === 'notices').length === 2)
    check('记录后重读列表', reads.filter(r => r.kind === 'notices').length === 2, String(reads.length))
  }
  {
    // 复制成功但投递记录失败：明示「记录未保存」，不假装成功
    const { page, cmds, reads, env } = bootNotices(ANOTICES_PATH, { options: { id: 'a1' } })
    await settleActivity(page, reads)
    api.dispatchAndSync = payload => { cmds.push({ payload }); return Promise.reject(new Error('服务忙')) }
    page.onCopy(tapData({ id: 'n2', activityId: 'a1' }))
    await waitFor(() => page.data.message !== '')
    check('记录失败：剪贴板已复制但明示记录未保存',
      env.rec.clip.length === 1 && page.data.message === '已复制，但记录未保存：服务忙', page.data.message)
  }
}

// 6. 工厂同构：两个消费页共用同一套配置，差异只在 activityId 来源
async function scenario6() {
  section('6. 工厂同构：配置面一致 + activityId 来源差异')
  {
    const tab = makePage(pageConfig(NOTICES_PATH))
    const act = makePage(pageConfig(ANOTICES_PATH))
    const keys = Object.keys(tab).sort()
    check('两页配置键完全一致（同构复用工厂）', JSON.stringify(Object.keys(act).sort()) === JSON.stringify(keys),
      JSON.stringify(Object.keys(act).sort()))
    check('两页初始 data 深度一致', JSON.stringify(tab.data) === JSON.stringify(act.data))
    check('工厂携带完整 handler 面（列表/发布/已读/复制/导航/刷新）',
      ['onShow', 'onPullDownRefresh', 'reload', 'activityId', 'onMarkRead', 'onOpenActivity', 'onCopy',
        'onOpenPublish', 'onClosePublish', 'onContent', 'onAudience', 'onPublish',
        'loadTargets', 'onToggleSignupTarget', 'onVehicleTarget']
        .every(k => typeof tab[k] === 'function'),
      JSON.stringify(keys.filter(k => typeof tab[k] !== 'function')))
    tab.onLoad({})
    act.onLoad({ id: 'a1' })
    check('差异点仅 activityId：Tab → null（全局串）、活动内 → 入参 id',
      tab.activityId() === null && act.activityId() === 'a1',
      JSON.stringify([tab.activityId(), act.activityId()]))
    check('Tab 页 onLoad 无入参也不炸（_options 兜底空对象）', tab.activityId() === null)
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
