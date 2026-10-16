// 现场协作任务页（pages/staff）页面级场景测试：node tools/scenario-staff-test.js
// 目的：staff 页是薄壳（头部文案 + 组装 field-panel 为 Field 视角），本套件锁定页面壳本身：
// - 返回本页必须真的重读：onShow 挂载点 + data 里的显式失效信号键 + wxml 的 sync-key 接线，
//   三条静态判据与 §1b 的行为判据同批（静态钉挂载点、行为钉送达；只换静态门是无效落地）；
// - onLoad 参数装配（activityId 来源 options.id，缺参守卫为空串）；
// - 传给 field-panel 的 properties（activity-id 绑定页面状态、perspective 固定 'staff'）与 json 注册；
// - 薄壳契约：页面自身零 handler、零模块依赖（WXML 无 bind 绑定，故不存在孤儿 handler）。
// 与 tools/scenario-workspace-test.js 的 field-panel 部分互补：那里深测组件内部（阶段动作矩阵/
// evidence 形状/防重复加载），这里只做一次轻集成——用 staff 页装配出的 activityId + perspective='staff'
// 驱动真面板，验证读取请求形状与「协作授权被撤销」这一 staff 特有场景的用户可见结果，不重复深测组件内部。
// 与 tools/fixround2-assertions-test.js 的分工：那边判「宿主 bump 逐次不同 + 属性值没变就不通知观察者」的
// 送达语义与去重依据，这边判「返回本页看到新阶段」这一页面级后果——两套各自独立观察同一个缺陷，不互抄。
'use strict'
const fs = require('fs')
const path = require('path')

const STAFF_PATH = require.resolve('../miniprogram/pages/staff/staff.js')
const FIELD_PATH = require.resolve('../miniprogram/components/field-panel/field-panel.js')
const api = require('../miniprogram/utils/api')

const STAFF_WXML = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'staff', 'staff.wxml'), 'utf8')
const STAFF_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'staff', 'staff.json'), 'utf8'))
const STAFF_SRC = fs.readFileSync(STAFF_PATH, 'utf8')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
// 若发现疑似源码 bug：用例仍按「正确行为」断言，但计 skipped（工作流不判失败），并在最终回复报告根因。
function skipKnown(name, issue) {
  skipped++
  console.log('  ~ ' + name + '（已知问题：' + issue + '）')
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

// ---- global.wx 桩：staff 页自身不碰 wx；轻集成块里 field-panel 成功路径也不 toast，兜底记录即可 ----
function makeWx() {
  const rec = { toasts: [] }
  global.wx = { showToast: o => rec.toasts.push((o && o.title) || '') }
  return rec
}

// ---- 网络桩（仅轻集成块用）：覆写 utils/api.read，页面/组件持有同一模块对象 ----
function installApi(opts) {
  const env = { reads: [] }
  api.read = request => {
    env.reads.push(request)
    const view = typeof opts.view === 'function' ? opts.view(request) : opts.view
    return Promise.resolve({ view, revision: opts.revision == null ? 3 : opts.revision, now: '2026-09-29T09:00:00+08:00' })
  }
  return env
}

// ---- 加载真页面/组件配置并造实例（与 scenario-workspace-test.js 同手法）----
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[STAFF_PATH]
  require(STAFF_PATH)
  return global.__PAGE_CFG
}
function compConfig(p) {
  global.Component = cfg => { global.__COMP_CFG = cfg }
  delete require.cache[p]
  require(p)
  return global.__COMP_CFG
}
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
function makeComponent(cfg, props) {
  const comp = Object.assign({}, cfg, cfg.methods || {})
  comp.data = Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), props || {})
  comp._patches = []
  comp.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  comp.triggerEvent = () => {}
  return comp
}
// 真机初挂：attached 与初始 observers 同一轮都会触发 reload（_loading 守卫保证只跑一次）
function attach(comp) {
  if (comp.lifetimes && comp.lifetimes.attached) comp.lifetimes.attached.call(comp)
  const obs = comp.observers || {}
  for (const key of Object.keys(obs)) obs[key].call(comp)
}

// ---- staff 视角样例视图（形状对齐 selectors 的 activityView；rows 只含 staffCan 可见者）----
const NOW = '2026-09-29T09:00:00+08:00'
function staffView(over) {
  return Object.assign({
    kind: 'activity', perspective: 'staff', primarySignupId: null,
    permittedActions: ['attendance.checkin', 'attendance.departure', 'incident.report', 'incident.resolve'],
    activity: {
      id: 'a1', title: '青城后山 · 周末轻徒步', phase: 'gathering',
      pickupPoints: [{ id: 'pk-1', name: '东门集合点' }],
      routeSnapshot: { points: [{ id: 'pt-1', name: '起点' }, { id: 'pt-2', name: '营地' }] },
    },
    rows: [{
      signupId: 's2', groupId: 'g1', name: '李四', status: 'confirmed', avatar: '',
      tripMode: 'shared',
      pickup: '东门集合点', vehicle: '1号车', seat: '01',
      checkedIn: false, outboundBoarded: false, returnBoarded: false,
      needsOutboundBoarding: true, needsSeatAssignment: false, returnBoardingApplies: true,
      returnPlan: 'assigned', departure: 'unknown', home: false,
    }],
    counters: { confirmed: 1, pending: 0, occupied: 1, waitlisted: 0, remaining: 5, unassigned: 0, unchecked: 1, pendingHome: 0, openIncidents: 0 },
    incidents: [], positions: [],
  }, over || {})
}

// 1. 薄壳契约（承重版）。壳本身允许很薄，但「返回本页会刷新」这件事必须钉得住。
//    旧版这里的三条是「形状合同」（配置只有 data+onLoad / data 只有一个键 / 模板只消费 activityId），
//    实测不承重：把修复做成一个空 onShow 也照样全绿，而真的把 onShow 接上反而三条全红。
//    现在三条各自钉一件「缺了就一定不成立」的事，并且与 §1b 的行为判据同批——静态三条只是挂载点，
//    真正承重的是「返回本页时真面板因新 key 恰好重读一次」（铁律 30/33⑥：钉行为、带阳性对照）。
//    · 仍保留的两条与形状无关的事实：零模块依赖、零事件绑定（薄壳的定义性特征）。
function scenario1() {
  section('1. 薄壳契约（承重版）：onShow 挂载点 / data 键集合恰为两个 / field-panel 带 sync-key 绑定')
  const cfg = pageConfig()
  check('页面配置 = data + onLoad + onShow（onShow 是返回本页时失效信号的唯一挂载点，缺它下面 §1b 必红）',
    Object.keys(cfg).sort().join(',') === 'data,onLoad,onShow' && typeof cfg.onShow === 'function',
    Object.keys(cfg).sort().join(',') + ' / onShow=' + typeof cfg.onShow)
  check('不 require 任何模块（api/格式化全都不碰，纯装配壳）', !/require\(/.test(STAFF_SRC))
  check('data 键集合恰为 {activityId, syncKey}（装配参数 + 一个显式失效信号键，不留第二个状态位）',
    Object.keys(cfg.data || {}).sort().join(',') === 'activityId,syncKey', JSON.stringify(cfg.data))
  check('WXML 无任何 bind/catch 事件绑定（不存在孤儿 handler 的可能）',
    STAFF_WXML.indexOf('bind') === -1 && STAFF_WXML.indexOf('catch') === -1)
  const panelTag = (STAFF_WXML.match(/<field-panel[^>]*>/) || [])[0] || ''
  check('staff.wxml 的 field-panel 带 sync-key 绑定（宿主有键却没接线 ⇒ 信号发进没人看的 data）',
    /(?:^|\s)sync-key="{{[^{}]+}}/.test(panelTag), panelTag)
}

// 宿主 setData 之后，属性只有「值真的变了」才通知子组件观察者——这是微信 observers 的语义，
// 不是对页面逻辑的复刻（页面逻辑是「bump 一个 key」，这里判的是它有没有真的送达）。
function hostSyncToPanel(page, panel) {
  const next = page.data.syncKey
  if (panel.data.syncKey === next) return false
  panel.data.syncKey = next
  if (panel.observers && panel.observers.syncKey) panel.observers.syncKey.call(panel, next)
  return true
}

// 1b. 行为判据（与静态三条同批落地，缺这条整套静态门就是无效的）：
//     返回本页时真 field-panel 因新 key 恰好重读一次，且看到的是推进后的阶段而不是离开时的快照。
async function scenarioRefresh() {
  section('1b. 返回本页真的重读：onShow → syncKey 变化 → 真 field-panel 恰好重读一次，名单随新 phase 重装配')
  makeWx()
  let phase = 'gathering'
  const view = () => staffView({
    activity: {
      id: 'a1', title: '青城后山 · 周末轻徒步', phase: phase,
      pickupPoints: [{ id: 'pk-1', name: '东门集合点' }],
      routeSnapshot: { points: [{ id: 'pt-1', name: '起点' }] },
    },
  })
  const env = installApi({ view: view, revision: 7 })
  const page = makePage(pageConfig())
  page.onLoad({ id: 'a1' })
  const panel = makeComponent(compConfig(FIELD_PATH), { activityId: page.data.activityId, perspective: 'staff', syncKey: page.data.syncKey })
  attach(panel)
  await waitFor(() => panel.data.loading === false)
  check('首屏那一次读由面板 attached 发出（宿主 onLoad 不重复发读 ⇒ 首屏不多打一次全量读）',
    env.reads.length === 1 && panel.data.phase === 'gathering',
    'reads=' + env.reads.length + ' phase=' + panel.data.phase)

  if (typeof page.onShow !== 'function') {
    check('页面声明了 onShow（没有挂载点，返回本页不可能刷新）', false, 'typeof page.onShow=' + typeof page.onShow)
    return
  }
  // 真机次序：onLoad → onShow（首次进入）→ 离开 → onShow（返回本页）。只有第二次才该下发信号。
  page.onShow()
  const notifiedFirst = hostSyncToPanel(page, panel)
  await sleep(20)
  check('首次进入那次 onShow 不下发信号（那一次读已由面板 attached 发出，重复下发＝白多打一次全量读）',
    notifiedFirst === false && env.reads.length === 1, 'notified=' + notifiedFirst + ' reads=' + env.reads.length)

  await sleep(6) // 让信号本身带上不同的时间戳（恒定 key 会被面板去重吃掉，那是 F-04 的原状）
  phase = 'active'
  page.onShow()
  const before = env.reads.length
  const notified = hostSyncToPanel(page, panel)
  await waitFor(() => env.reads.length > before)
  check('领队推进阶段后返回本页 ⇒ 信号与面板已读的那份不同 ⇒ 真面板恰好重读一次（不是 0 次也不是 2 次）',
    notified === true && env.reads.length === before + 1,
    'notified=' + notified + ' reads=' + before + '→' + env.reads.length)
  check('重读是同一份请求形状（activity / a1 / staff 视角），没有另开第二条链路',
    !!env.reads[before] && env.reads[before].kind === 'activity' && env.reads[before].activityId === 'a1' && env.reads[before].perspective === 'staff',
    JSON.stringify(env.reads[before]))
  await waitFor(() => panel.data.loading === false)
  check('返回后看到的是新阶段（动作表按 phase 重装配），不是离开时那份旧快照 = F-04 的本体',
    panel.data.phase === 'active' && panel.data.showPositions === true,
    'phase=' + panel.data.phase + ' showPositions=' + String(panel.data.showPositions))
  const again = env.reads.length
  const notified2 = hostSyncToPanel(page, panel)
  await sleep(20)
  check('反向对照：信号没再变化就不重读（判据不是「每次返回都必读」的一刀切，承重的是 key 真的换了）',
    notified2 === false && env.reads.length === again,
    'notified=' + notified2 + ' reads=' + again + '→' + env.reads.length)
}

// 2. onLoad 参数装配：activityId 来源 options.id；缺失参数守卫为空串（不外呼、不崩）
function scenario2() {
  section('2. onLoad 参数装配：options.id → activityId；缺参守卫为空串')
  {
    makeWx()
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1' })
    check('onLoad({id:"a1"}) → data.activityId = "a1"', page.data.activityId === 'a1', page.data.activityId)
    check('装配只补 activityId 一个键（无隐副作用）',
      page._patches.length === 1 && Object.keys(page._patches[0]).join(',') === 'activityId',
      JSON.stringify(page._patches))
  }
  {
    makeWx()
    const page = makePage(pageConfig())
    page.onLoad({})
    check('缺参守卫：onLoad({}) → activityId 为空串（不崩、不给 undefined）',
      page.data.activityId === '', String(page.data.activityId))
  }
  check('WXML 把装配结果原样传给面板：activity-id="{{activityId}}"',
    /<field-panel[^>]*activity-id="\{\{activityId\}\}"/.test(STAFF_WXML))
  check('Field 视角固定由页面指定：perspective="staff"（字面量，不来自参数）',
    /<field-panel[^>]*perspective="staff"/.test(STAFF_WXML))
}

// 3. 页面注册与组件接线：json 注册 field-panel、头部文案、面板 properties 兼容
function scenario3() {
  section('3. 注册与接线：staff.json 注册 field-panel / 头部文案 / 面板 properties 兼容')
  check('staff.json 注册 field-panel 且路径指向真实组件',
    STAFF_JSON.usingComponents && STAFF_JSON.usingComponents['field-panel'] === '/components/field-panel/field-panel',
    JSON.stringify(STAFF_JSON.usingComponents || {}))
  check('导航栏标题「协作任务」', STAFF_JSON.navigationBarTitleText === '协作任务', STAFF_JSON.navigationBarTitleText)
  const cfg = compConfig(FIELD_PATH)
  check('field-panel 声明覆盖 staff 页传入的两个属性（activityId/perspective，均 String 型）；syncKey 是可选项，staff 不传即不自触发',
    cfg.properties && cfg.properties.activityId && cfg.properties.activityId.type === String
    && cfg.properties.perspective && cfg.properties.perspective.type === String
    && (!cfg.properties.syncKey || cfg.properties.syncKey.type === String)
    && ['activityId', 'perspective'].every(k => Object.keys(cfg.properties || {}).indexOf(k) !== -1),
    JSON.stringify(Object.keys(cfg.properties || {})))
  check('头部说明承诺「授权变更后立即生效」的作用域文案在场',
    STAFF_WXML.indexOf('现场协作') !== -1 && STAFF_WXML.indexOf('照顾好这一小队。') !== -1
    && STAFF_WXML.indexOf('这里只展示当前仍授权给你的人员与任务；授权变更后立即生效。') !== -1)
}

// 4. 轻集成（与 workspace 套件互补）：staff 页装配结果驱动真 field-panel
async function scenario4() {
  section('4. 轻集成：staff 页装配 → 真 field-panel（请求形状 / 授权撤销透出 / 正常出画面）')
  {
    makeWx()
    // 协作授权被撤销/不存在：服务端 selectors 对 staff 视角返回 denied（selectors.js:330）
    const env = installApi({ view: { kind: 'denied', message: '此活动的协作授权不存在或已过期。' } })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1' })
    const comp = makeComponent(compConfig(FIELD_PATH), { activityId: page.data.activityId, perspective: 'staff' })
    attach(comp)
    await waitFor(() => comp.data.loading === false)
    check('读取请求 = activity / a1 / staff 视角（activityId 来自页面装配）',
      env.reads.length === 1 && env.reads[0].kind === 'activity' && env.reads[0].activityId === 'a1'
      && env.reads[0].perspective === 'staff', JSON.stringify(env.reads))
    check('授权被撤销：面板透出服务端原文、不装配名单行（staff 页不own任何兜底文案）',
      comp.data.denied === '此活动的协作授权不存在或已过期。' && comp.data.rows.length === 0
      && comp.data.loading === false, comp.data.denied)
  }
  {
    makeWx()
    const env = installApi({ view: staffView(), revision: 7 })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1' })
    const comp = makeComponent(compConfig(FIELD_PATH), { activityId: page.data.activityId, perspective: 'staff' })
    attach(comp)
    await waitFor(() => comp.data.loading === false && comp.data.rows.length > 0)
    check('授权有效：staff 视角名单出画面（已确认者带签到/乘车副标题）',
      comp.data.denied === '' && comp.data.rows.length === 1
      && comp.data.rows[0].name === '李四' && comp.data.rows[0].subtitle === '搭乘车辆 · 东门集合点 · 未签到 · 1号车',
      JSON.stringify(comp.data.rows))
    check('读取 revision 交给面板做后续命令的 CAS 基准', comp.revision === 7, String(comp.revision))
  }
}

async function main() {
  const scenarios = [scenario1, scenarioRefresh, scenario2, scenario3, scenario4]
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
