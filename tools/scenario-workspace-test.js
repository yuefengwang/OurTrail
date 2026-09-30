// 组织者工作台「履约」页面级场景测试：node tools/scenario-workspace-test.js
// 目的：把组织者「工作台履约」业务链路在 node 下走一遍——工作台装配 → 阶段推进/取消 →
// 名单审核 → 分车（预览/指派/交换/移除/提交）→ 现场记录（签到/出发/到家/节点/异常）→ 车长只读面。
// 被测对象：pages/workspace/workspace.js + components/roster-panel / transport-panel / field-panel。
//
// 手法与 tools/weather-page-test.js / scenario-signup-test.js 一致：
// - 页面用 global.Page = cfg => 捕获配置，组件用 global.Component = cfg => 捕获配置；
//   delete require.cache[path] 后 require，每次取最新源码；
// - makePage/makeComponent 造实例：setData 记录进 _patches 并同步 this.data，回调经 setImmediate 异步触发；
// - 网络桩：页面/组件都持有同一个 utils/api 模块对象（const api = require(...) 后 api.foo()），
//   覆写其同名导出（read/readOr/readTransport/previewAssignments/dispatchAndSync）即生效；
//   api.toast / api.errorText 走真实现（wx.showToast 等用 global.wx 桩记录）；
// - observers/lifetimes 不会自动触发：attach() 手动按真机初挂顺序调 attached() + 全部 observers，
//   这正是「面板防重复加载」场景的复现点（_loading 守卫是唯一防线）。
//
// payload 契约以 cloudfunctions/trailApi/domain/schema.js 为准：每条捕获到的命令在补齐 evidence
// （服务端 index.js overrideEvidence 会先覆写 {at,by,note} 的 at/by 再校验，客户端只带 note）
// 后跑真 schema.validate，多余键/缺键/枚举值不对都会被拒。
//
// 命令面边界（以代码实际为准）：
// - attendance.board（上车）只由车长任务页 miniprogram/pages/vehicle/vehicle.js:107 发出；
// - position.report（位置上报）是参与者本人自助（isSelfSignup 才可发），由
//   miniprogram/pages/activity/activity.js:513 发出——工作台现场面板两者都不提供，
//   场景 6/8 对这一边界做了断言。
'use strict'
const fs = require('fs')
const path = require('path')

const PAGE_PATH = require.resolve('../miniprogram/pages/workspace/workspace.js')
const ROSTER_PATH = require.resolve('../miniprogram/components/roster-panel/roster-panel.js')
const TRANSPORT_PATH = require.resolve('../miniprogram/components/transport-panel/transport-panel.js')
const FIELD_PATH = require.resolve('../miniprogram/components/field-panel/field-panel.js')
const api = require('../miniprogram/utils/api')
const S = require('../cloudfunctions/trailApi/domain/schema')

const WORKSPACE_WXML = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'pages', 'workspace', 'workspace.wxml'), 'utf8')
const ROSTER_WXML = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'components', 'roster-panel', 'roster-panel.wxml'), 'utf8')
const TRANSPORT_WXML = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'components', 'transport-panel', 'transport-panel.wxml'), 'utf8')

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
const settlePage = page => waitFor(() => page.data.loading === false)
const settleComp = comp => waitFor(() => comp.data.loading === false)
const keysOf = o => Object.keys(o).sort().join(',')

// ---- global.wx 桩：toast/震动/导航栏标题/导航记录；每场景换新，互不串味 ----
function makeWx() {
  const rec = { toasts: [], nav: [], titles: [], vibrations: 0, clipboard: [] }
  global.wx = {
    showToast: o => rec.toasts.push((o && o.title) || ''),
    vibrateShort: () => { rec.vibrations++ },
    setNavigationBarTitle: o => rec.titles.push((o && o.title) || ''),
    navigateTo: o => rec.nav.push((o && o.url) || ''),
    setClipboardData: o => { rec.clipboard.push((o && o.data) || ''); if (o && o.success) o.success() },
  }
  return rec
}

// ---- 网络桩：覆写 utils/api 的同名导出（页面/组件持有同一模块对象，改属性即生效） ----
function installApi(opts) {
  const env = {
    reads: [], readOrs: [], previews: [], cmds: [],
    state: { revision: opts.revision == null ? 1 : opts.revision },
  }
  api.read = request => {
    env.reads.push(request)
    const view = typeof opts.view === 'function' ? opts.view(request) : opts.view
    return Promise.resolve({ view, revision: env.state.revision, now: NOW })
  }
  api.readOr = (name, data) => {
    env.readOrs.push({ name, data })
    return Promise.resolve(opts.transport)
  }
  api.readTransport = activityId => {
    env.readOrs.push({ name: 'readTransport', data: { activityId } })
    return Promise.resolve({ ok: true, value: opts.transport })
  }
  api.previewAssignments = activityId => {
    env.previews.push(activityId)
    return Promise.resolve({ ok: true, value: opts.plan })
  }
  api.dispatchAndSync = (payload, expectedRevision) => {
    env.cmds.push({ payload, expectedRevision })
    env.state.revision += 1
    return Promise.resolve({ revision: env.state.revision, targetIds: ['a1'], replayed: false })
  }
  return env
}

// ---- 加载真页面/组件配置并造实例 ----
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
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
// properties 在真机上镜像进 this.data；一并塞入便于 handler 读取。
// Component 配置的 methods 由真机展开到实例上——这里同样展开（reload/onBatch/...）。
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
// 真机初挂：attached 与初始 observers 同一轮都会触发 reload —— _loading 守卫是唯一防线（场景 7）
function attach(comp) {
  if (comp.lifetimes && comp.lifetimes.attached) comp.lifetimes.attached.call(comp)
  const obs = comp.observers || {}
  for (const key of Object.keys(obs)) obs[key].call(comp)
}

// ---- payload 按 schema.js 校验：先按服务端 overrideEvidence（index.js）规则补齐 evidence 的 at/by ----
function schemaOk(payload) {
  const clone = JSON.parse(JSON.stringify(payload))
  const fill = node => {
    if (Array.isArray(node)) { node.forEach(fill); return }
    if (node === null || typeof node !== 'object') return
    const ks = Object.keys(node)
    if (ks.length === 3 && 'at' in node && 'by' in node && 'note' in node) {
      node.at = NOW
      node.by = 'u-org'
      return
    }
    ks.forEach(k => fill(node[k]))
  }
  fill(clone)
  return S.validate(S.Payload, clone)
}

// ---- 样例视图（形状对齐 selectors 的 activityView/rowView）----
const NOW = '2026-09-29T09:00:00+08:00'
function row(id, name, status, over) {
  return Object.assign({
    signupId: id, groupId: 'g1', name, status, avatar: '',
    pickup: '东门集合点', vehicle: '', seat: null,
    checkedIn: false, outboundBoarded: false, returnBoarded: false,
    returnPlan: 'assigned', departure: 'unknown', home: false,
  }, over || {})
}
const ROWS = [
  row('s1', '张三', 'pending'),
  row('s2', '李四', 'confirmed', { vehicle: '1号车', seat: '01' }),
  row('s3', '王五', 'confirmed', { pickup: '西门停车区', vehicle: '1号车', seat: '02', checkedIn: true, departure: 'joined' }),
  row('s4', '赵六', 'waitlisted', { pickup: '西门停车区' }),
  row('s5', '孙七', 'confirmed', { pickup: '西门停车区' }),
  row('s6', '周八', 'confirmed', { pickup: '西门停车区' }),
]
const ORGANIZER_ACTIONS = ['activity.transition', 'activity.edit', 'signup.review', 'signup.promote',
  'vehicle.save', 'vehicle.remove', 'assignment.commit', 'assignment.set', 'assignment.remove', 'assignment.swap',
  'membership.save', 'membership.revoke', 'export.record', 'notice.publish', 'notice.delivery']
const GATHER_ACTIONS = ['activity.transition', 'attendance.checkin', 'attendance.departure', 'attendance.board', 'incident.report', 'incident.resolve']
const CLOSING_ACTIONS = ['activity.transition', 'attendance.home', 'attendance.returnPlan', 'incident.report', 'incident.resolve']
const ACTIVE_ACTIONS = ['activity.transition', 'attendance.node', 'attendance.returnPlan', 'incident.report', 'incident.resolve']

function organizerView() {
  return {
    kind: 'activity', perspective: 'organizer', primarySignupId: null,
    permittedActions: ORGANIZER_ACTIONS,
    activity: {
      id: 'a1', title: '青城后山 · 周末轻徒步', phase: 'published',
      pickupPoints: [{ id: 'pk-1', name: '东门集合点' }, { id: 'pk-2', name: '西门停车区' }],
      routeSnapshot: { points: [{ id: 'pt-1', name: '起点' }, { id: 'pt-2', name: '营地' }] },
    },
    rows: ROWS,
    counters: { confirmed: 4, pending: 1, occupied: 5, waitlisted: 1, remaining: 3, unassigned: 2, unchecked: 3, pendingHome: 1, openIncidents: 1 },
    incidents: [{ id: 'inc-1', subjectIds: ['s3'], kind: 'late', description: '王五迟到 20 分钟', resolved: false }],
    positions: [],
  }
}
function withPhase(phase, permitted) {
  const v = organizerView()
  v.activity = Object.assign({}, v.activity, { phase })
  if (permitted) v.permittedActions = permitted
  return v
}
function transportFixture() {
  return {
    vehicles: [{
      id: 'v1', activityId: 'a1', label: '1号车', plate: '川A·12345',
      legalCapacity: 7, blockedSeats: 1,
      drivers: [{ kind: 'service', name: '老司机', phone: '13800000001', userId: null }],
      seatLabels: ['01', '02', '03', '04', '05'],
      pickupPointIds: ['pk-1'],
      legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
    }],
    assignments: [
      { activityId: 'a1', signupId: 's2', vehicleId: 'v1', seatLabel: '01' },
      { activityId: 'a1', signupId: 's3', vehicleId: 'v1', seatLabel: '02' },
    ],
    groups: [
      { id: 'g1', keepTogether: true, signupIds: ['s2', 's3'] },
      { id: 'g2', keepTogether: false, signupIds: ['s1', 's4'] },
    ],
  }
}
// previewAssignments 的假 plan（AssignmentPreview 形状）：s2 换座、s5 新安排、s3 被移出、s6 未能安排
const PLAN = {
  activityId: 'a1', baseRevision: 1,
  assignments: [
    { activityId: 'a1', signupId: 's2', vehicleId: 'v1', seatLabel: '03' },
    { activityId: 'a1', signupId: 's5', vehicleId: 'v1', seatLabel: null },
  ],
  unassigned: [{ signupId: 's6', reason: 'pickup_mismatch' }],
}

// 1. 工作台装配：onLoad → organizer 视图 → 总览数据/面板 properties/门槛按钮状态
async function scenario1() {
  section('1. 工作台装配：organizer 视图 → 总览数据 / 面板 properties / 门槛按钮状态')
  {
    const rec = makeWx()
    const env = installApi({ view: organizerView() })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1' })
    page.onShow()
    await settlePage(page)
    check('读取请求 = activity / a1 / organizer 视角（一次）',
      env.reads.length === 1 && env.reads[0].kind === 'activity' && env.reads[0].activityId === 'a1'
      && env.reads[0].perspective === 'organizer', JSON.stringify(env.reads))
    check('onLoad 记录 activityId 并 setData（三个面板的 activity-id 均绑定自它）',
      page.activityId === 'a1' && page.data.activityId === 'a1')
    check('wxml：三个面板都绑定 activity-id，field-panel 固定 organizer 视角',
      (WORKSPACE_WXML.match(/activity-id="\{\{activityId \|\| ''\}\}"/g) || []).length === 3
      && /<field-panel[^>]*perspective="organizer"/.test(WORKSPACE_WXML))
    check('wxml：面板显隐用类名而非 hidden 属性（hidden 在自定义组件宿主上不生效，曾致四区内容全部平铺）',
      /<roster-panel class="\{\{tab === 1 \? '' : 'hide'\}\}"/.test(WORKSPACE_WXML)
      && /<transport-panel class="\{\{tab === 2 \? '' : 'hide'\}\}"/.test(WORKSPACE_WXML)
      && /<field-panel class="\{\{tab === 3 \? '' : 'hide'\}\}"/.test(WORKSPACE_WXML)
      && WORKSPACE_WXML.indexOf('hidden="{{tab') === -1)
    check('wxml：三个指标可点，分别跳名单/分车/现场（指标即入口）',
      (WORKSPACE_WXML.match(/class="metric" hover-class="button-hover" bindtap="go(Roster|Transport|Field)"/g) || []).length === 3)
    check('副标题随阶段装配（published → 行前准备话术）',
      page.data.subtitle === '先处理需要你确认的事，再安心出发。', page.data.subtitle)
    check('标题与阶段徽标（published → 行前准备）',
      page.data.title === '青城后山 · 周末轻徒步' && page.data.phaseLabel === '行前准备')
    check('三项指标：待审核 1 / 待分车 2 / 第三格=待签到 3',
      page.data.pending === 1 && page.data.unassigned === 2 && page.data.thirdValue === 3 && page.data.thirdLabel === '待签到',
      JSON.stringify({ p: page.data.pending, u: page.data.unassigned, t: page.data.thirdValue }))
    check('进程时间线 5 段且当前段带「· 当前」标记',
      page.data.phaseTimeline.length === 5 && page.data.phaseTimeline[0].label === '行前准备 · 当前'
      && page.data.phaseTimeline[0].current === true && page.data.phaseTimeline[1].current === false,
      JSON.stringify(page.data.phaseTimeline.map(x => x.label)))
    check('下一阶段按钮可用且指向「正在集合」，编辑入口打开',
      page.data.canTransition === true && page.data.nextPhaseLabel === '正在集合' && page.data.canEdit === true)
    check('published（出发前）可取消', page.data.canCancel === true)
    check('导航栏标题设置为「活动工作台」', rec.titles.indexOf('活动工作台') !== -1, JSON.stringify(rec.titles))
    check('revision 取自读取（后续阶段推进做 CAS）', page.revision === 1, String(page.revision))
    page.onTab({ currentTarget: { dataset: { tab: '2' } } })
    check('分区切换（总览/名单/分车/现场）',
      page.data.tab === 2 && page.data.tabLabels.join('/') === '总览/名单/分车/现场')
  }
  {
    makeWx()
    installApi({ view: withPhase('closing') })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1' }); page.onShow()
    await settlePage(page)
    check('closing 阶段第三格切到「待到家」（pendingHome）',
      page.data.thirdLabel === '待到家' && page.data.thirdValue === 1,
      JSON.stringify({ l: page.data.thirdLabel, v: page.data.thirdValue }))
    check('closing 下一阶段 = 已归档，且已出发后不可再取消',
      page.data.nextPhaseLabel === '已归档' && page.data.canCancel === false)
  }
  {
    makeWx()
    const env = installApi({ view: organizerView() })
    const page = makePage(pageConfig())
    page.onLoad({}); page.onShow()
    await settlePage(page)
    check('缺少活动编号：直接 denied 且不外呼', page.data.denied === '缺少活动编号。' && env.reads.length === 0)
  }
}

// 2. 阶段推进：进程区「进入下一阶段」→ 二次确认（门槛说明）→ activity.transition
async function scenario2() {
  section('2. 阶段推进：进程区按钮 → 二次确认弹层（门槛说明）→ activity.transition')
  const rec = makeWx()
  const env = installApi({ view: organizerView() })
  const page = makePage(pageConfig())
  page.onLoad({ id: 'a1' }); page.onShow()
  await settlePage(page)

  page.onTransition({ currentTarget: { dataset: {} } }) // 主按钮不带 data.next → NEXT_PHASE[phase]
  check('点击「进入正在集合」先弹确认层（不直接发命令）',
    page.data.transitionOpen === true && page.data.transitionNext === 'gathering'
    && page.data.transitionTitle === '确认进入正在集合' && env.cmds.length === 0,
    JSON.stringify({ open: page.data.transitionOpen, next: page.data.transitionNext, t: page.data.transitionTitle }))
  check('确认弹层展示门槛说明、原因必填与确认绑定（wxml 契约）',
    WORKSPACE_WXML.indexOf('阶段变更会影响报名与现场操作。未处理的出发去向、车辆或安全事项可能阻止变更。') !== -1
    && WORKSPACE_WXML.indexOf('bindinput="onReason"') !== -1
    && WORKSPACE_WXML.indexOf("{{!reason || busy ? '' : 'onTransitionConfirm'}}") !== -1
    && WORKSPACE_WXML.indexOf('title="{{transitionTitle}}"') !== -1)
  page.onTransitionClose()
  check('关闭弹层不产生命令', page.data.transitionOpen === false && env.cmds.length === 0)

  page.onTransition({ currentTarget: { dataset: {} } })
  page.onTransitionConfirm()
  check('原因为空时确认被拦：不发命令、不进 busy、弹层保持',
    env.cmds.length === 0 && page.data.busy === false && page.data.transitionOpen === true)
  page.onReason({ detail: { value: '待审核已清零，车辆安排完成' } })
  page.onTransitionConfirm()
  await waitFor(() => env.cmds.length === 1 && !page.data.busy)
  const cmd = env.cmds[0]
  check('发出 activity.transition，payload 与 schema 一致（type/activityId/next/reason，无多余键）',
    cmd.payload.type === 'activity.transition' && cmd.payload.next === 'gathering'
    && cmd.payload.reason === '待审核已清零，车辆安排完成'
    && keysOf(cmd.payload) === 'activityId,next,reason,type' && schemaOk(cmd.payload),
    JSON.stringify(cmd.payload))
  check('以读取时的 revision 做 CAS', cmd.expectedRevision === 1, String(cmd.expectedRevision))
  check('成功反馈：震动 + toast「已进入正在集合。」+ 弹层关闭 + 成功 callout',
    rec.vibrations === 1 && rec.toasts.indexOf('已进入正在集合。') !== -1
    && page.data.transitionOpen === false && page.data.message === '已进入正在集合。',
    JSON.stringify({ toasts: rec.toasts, msg: page.data.message }))
  check('成功后 revision 推进并自动重读（CAS 链延续）', page.revision === 2 && env.reads.length === 2,
    JSON.stringify({ rev: page.revision, reads: env.reads.length }))
}

// 3. 取消活动：进程区独立 danger 块 → 二次确认 → transition cancelled；出发后不可取消
async function scenario3() {
  section('3. 取消活动：独立 danger 块 → 二次确认 → cancelled；出发后入口不渲染')
  const rec = makeWx()
  const env = installApi({ view: withPhase('gathering') })
  const page = makePage(pageConfig())
  page.onLoad({ id: 'a1' }); page.onShow()
  await settlePage(page)
  check('gathering 阶段展示取消入口（进程区独立 danger 块，data-next=cancelled）',
    page.data.canCancel === true
    && /wx:if="\{\{canCancel\}\}" class="button danger block/.test(WORKSPACE_WXML)
    && WORKSPACE_WXML.indexOf('data-next="cancelled"') !== -1
    && WORKSPACE_WXML.indexOf('>取消活动</view>') !== -1)
  page.onTransition({ currentTarget: { dataset: { next: 'cancelled' } } })
  check('danger 块带 data-next=cancelled → 弹层标题「确认取消活动」',
    page.data.transitionOpen === true && page.data.transitionNext === 'cancelled'
    && page.data.transitionTitle === '确认取消活动')
  check('取消路径的确认按钮用 danger 样式（wxml 契约）',
    WORKSPACE_WXML.indexOf("transitionNext === 'cancelled' ? 'danger' : 'primary'") !== -1)
  page.onReason({ detail: { value: '暴雨预警，出于安全取消' } })
  page.onTransitionConfirm()
  await waitFor(() => env.cmds.length === 1 && !page.data.busy)
  const cmd = env.cmds[0]
  check('发出 activity.transition → cancelled，payload 与 schema 一致',
    cmd.payload.type === 'activity.transition' && cmd.payload.next === 'cancelled'
    && cmd.payload.reason === '暴雨预警，出于安全取消'
    && keysOf(cmd.payload) === 'activityId,next,reason,type' && schemaOk(cmd.payload),
    JSON.stringify(cmd.payload))
  check('取消成功反馈：toast「活动已取消。」+ 弹层关闭',
    rec.toasts.indexOf('活动已取消。') !== -1 && page.data.message === '活动已取消。' && page.data.transitionOpen === false)

  makeWx()
  installApi({ view: withPhase('active') })
  const page2 = makePage(pageConfig())
  page2.onLoad({ id: 'a1' }); page2.onShow()
  await settlePage(page2)
  check('active（已出发）阶段 canCancel=false：取消入口不渲染（取消仅限出发前）', page2.data.canCancel === false)
}

// 4. 名单面板：pending 计数 / 审核通过与拒绝 / 取消原因守卫 / 递补 / 同行组约束
async function scenario4() {
  section('4. 名单面板：审核通过/拒绝 / 取消守卫与递补 / pending 计数')
  const rec = makeWx()
  const env = installApi({ view: organizerView(), transport: transportFixture() })
  const comp = makeComponent(compConfig(ROSTER_PATH), { activityId: 'a1' })
  attach(comp)
  await settleComp(comp)
  check('名单读取走 organizer 视角（面板自行拉取授权视图）',
    env.reads.length >= 1 && env.reads[0].perspective === 'organizer', JSON.stringify(env.reads))
  check('pending 计数入列「已确认 4 · 待审核 1 · 候补 1」',
    comp.data.countersLine === '已确认 4 · 待审核 1 · 候补 1。仅显示你有权查看的人员。', comp.data.countersLine)
  check('wxml：批量动作条仅在有勾选时渲染，空选态只留一句引导（不留五颗死按钮）',
    ROSTER_WXML.indexOf('<view wx:if="{{selectedCount}}" class="stack"') !== -1
    && ROSTER_WXML.indexOf('勾选参与人后，可批量审核、递补、取消或导出。') !== -1
    && ROSTER_WXML.indexOf("{{selectedCount && !busy ? 'onBatch' : ''}}") === -1)
  check('wxml：搜索与状态筛选合并为一行（.roster-filter）',
    ROSTER_WXML.indexOf('class="roster-filter"') !== -1
    && ROSTER_WXML.indexOf('<text class="field-label">搜索名单</text>') === -1
    && ROSTER_WXML.indexOf('<form-field label="报名状态">') === -1)
  check('行装配：状态文案/语气/副标题（未分车、座号）',
    comp.data.rows.length === 6 && comp.data.rows[0].statusLabel === '待审核' && comp.data.rows[0].tone === 'warning'
    && comp.data.rows[0].subtitle === '东门集合点 · 未分车'
    && comp.data.rows[1].subtitle === '东门集合点 · 1号车 · 01座',
    JSON.stringify(comp.data.rows[0]))
  check('同行组约束行（整组同车标注）',
    comp.data.groups.length === 2 && comp.data.groups[0].names === '李四、王五',
    JSON.stringify(comp.data.groups))

  comp.onSearch({ detail: { value: '王五' } })
  await waitFor(() => comp.data.rows.length === 1)
  check('搜索过滤（姓名/上车点/车辆）', comp.data.rows.length === 1 && comp.data.rows[0].name === '王五')
  comp.onSearch({ detail: { value: '' } })
  await waitFor(() => comp.data.rows.length === 6)
  comp.onStatus({ detail: { value: '1' } })
  await waitFor(() => comp.data.rows.length === 1 && comp.data.rows[0].signupId === 's1')
  check('状态筛选「待审核」只剩 pending 行', comp.data.rows.length === 1 && comp.data.rows[0].name === '张三')
  comp.onStatus({ detail: { value: '0' } })
  await waitFor(() => comp.data.rows.length === 6)

  comp.onSelect({ currentTarget: { dataset: { id: 's1' } }, detail: { value: ['s1'] } })
  await waitFor(() => comp.data.selectedCount === 1)
  check('勾选后展示已选计数', comp.data.selectedCount === 1 && comp.data.selected.s1 === true)
  comp.onBatch({ currentTarget: { dataset: { action: 'confirm' } } })
  check('批量审核先弹确认层并带名单', comp.data.batch === 'confirm' && comp.data.batchNames === '张三')
  comp.onBatchConfirm()
  await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
  check('审核通过发 signup.review {decision:confirm}，payload 与 schema 一致',
    env.cmds[0].payload.type === 'signup.review' && env.cmds[0].payload.signupIds.join() === 's1'
    && env.cmds[0].payload.decision === 'confirm'
    && keysOf(env.cmds[0].payload) === 'activityId,decision,signupIds,type' && schemaOk(env.cmds[0].payload),
    JSON.stringify(env.cmds[0].payload))
  check('审核保存反馈：toast「已保存」+ 弹层收起 + 选中清空 + 成功 callout',
    rec.toasts.indexOf('已保存') !== -1 && comp.data.batch === ''
    && Object.keys(comp.data.selected).length === 0 && comp.data.message === '操作已保存。')
  await waitFor(() => comp.revision === 2)

  comp.onSelect({ currentTarget: { dataset: { id: 's2' } }, detail: { value: ['s2'] } })
  await waitFor(() => comp.data.selectedCount === 1)
  comp.onBatch({ currentTarget: { dataset: { action: 'reject' } } })
  comp.onBatchConfirm()
  await waitFor(() => env.cmds.length === 2 && !comp.data.busy)
  check('拒绝发 signup.review {decision:reject}，且以刷新后的 revision 做 CAS',
    env.cmds[1].payload.decision === 'reject' && env.cmds[1].payload.signupIds.join() === 's2'
    && env.cmds[1].expectedRevision === 2 && schemaOk(env.cmds[1].payload),
    JSON.stringify(env.cmds[1].payload))
  await waitFor(() => comp.revision === 3)

  comp.onSelect({ currentTarget: { dataset: { id: 's1' } }, detail: { value: ['s1'] } })
  await waitFor(() => comp.data.selectedCount === 1)
  comp.onBatch({ currentTarget: { dataset: { action: 'cancel' } } })
  comp.onBatchConfirm()
  check('取消报名未填原因被拦：不发命令', env.cmds.length === 2 && comp.data.error === '取消需要填写原因。'
    && comp.data.busy === false, comp.data.error)
  comp.onBatchReason({ detail: { value: '临时有事' } })
  comp.onBatchConfirm()
  await waitFor(() => env.cmds.length === 3 && !comp.data.busy)
  check('填原因后发 signup.cancel 带 reason',
    env.cmds[2].payload.type === 'signup.cancel' && env.cmds[2].payload.reason === '临时有事'
    && schemaOk(env.cmds[2].payload), JSON.stringify(env.cmds[2].payload))
  await waitFor(() => comp.revision === 4)

  comp.onSelect({ currentTarget: { dataset: { id: 's4' } }, detail: { value: ['s4'] } })
  await waitFor(() => comp.data.selectedCount === 1)
  comp.onBatch({ currentTarget: { dataset: { action: 'promote' } } })
  comp.onBatchConfirm()
  await waitFor(() => env.cmds.length === 4 && !comp.data.busy)
  check('递补候补发 signup.promote（无 decision/reason 键）',
    env.cmds[3].payload.type === 'signup.promote' && env.cmds[3].payload.signupIds.join() === 's4'
    && keysOf(env.cmds[3].payload) === 'activityId,signupIds,type' && schemaOk(env.cmds[3].payload),
    JSON.stringify(env.cmds[3].payload))
  await waitFor(() => comp.revision === 5)

  comp.onToggleGroup({ currentTarget: { dataset: { id: 'g1', keep: true } } })
  await waitFor(() => env.cmds.length === 5 && !comp.data.busy)
  check('同行组「允许分车」发 group.setTogether keepTogether=false',
    env.cmds[4].payload.type === 'group.setTogether' && env.cmds[4].payload.groupId === 'g1'
    && env.cmds[4].payload.keepTogether === false && schemaOk(env.cmds[4].payload),
    JSON.stringify(env.cmds[4].payload))
}

// 5. 分车面板：自动分车预览 → 手动指派（座号/null）/交换/移除/提交方案/删除车辆
async function scenario5() {
  section('5. 分车面板：预览 plan 装配 → set(null)/swap/remove/commit/vehicle.remove')
  const rec = makeWx()
  const env = installApi({ view: organizerView(), transport: transportFixture(), plan: PLAN })
  const comp = makeComponent(compConfig(TRANSPORT_PATH), { activityId: 'a1' })
  attach(comp)
  await settleComp(comp)
  check('分车读取 = activity read + readTransport 各一次（attached+observer 同轮也只一轮）',
    env.reads.length === 1 && env.readOrs.length === 1 && env.readOrs[0].name === 'readTransport',
    JSON.stringify({ reads: env.reads.length, ors: env.readOrs.length }))
  check('车辆指标：1 辆车 / 5 个可用乘客位 / 2 人待安排',
    comp.data.metrics.vehicles === 1 && comp.data.metrics.seats === 5 && comp.data.metrics.unassigned === 2,
    JSON.stringify(comp.data.metrics))
  const vh = comp.data.vehicles[0]
  check('车辆行装配：司机/上车点/座位示意（01 李四、02 王五，第 3 格前是过道）',
    vh.label === '1号车' && vh.driverNames === '老司机' && vh.pickupList === '东门集合点' && vh.usable === 5
    && vh.seatCells.length === 5 && vh.seatCells[0].occupied === true && vh.seatCells[0].occupant === '李四'
    && vh.seatCells[1].occupant === '王五' && vh.seatCells[2].aisle === true && vh.seatCells[4].occupied === false,
    JSON.stringify(vh.seatCells))
  check('已确认人员选项 = 4 人（无安排者标「未分车」）',
    comp.data.confirmed.length === 4 && comp.data.confirmed[2].label === '孙七 · 西门停车区 · 未分车',
    JSON.stringify(comp.data.confirmed.map(c => c.label)))
  check('同车约束行（整组同车）', comp.data.groups.length === 1 && comp.data.groups[0].names === '李四、王五')
  check('参与者司机候选=已确认且未分车（孙七/周八；有车的李四王五与未确认者不入列）',
    comp.data.driverCandidates.length === 2 && comp.data.driverCandidates[0].signupId === 's5'
    && comp.data.driverCandidates[1].signupId === 's6',
    JSON.stringify(comp.data.driverCandidates))
  check('wxml：参与者司机下拉绑定 driverCandidates（曾误绑只在座位指派流程赋值的 confirmedOptions，编辑器里下拉恒为空）',
    TRANSPORT_WXML.indexOf('range="{{driverCandidates}}"') !== -1
    && TRANSPORT_WXML.indexOf('confirmedOptions[item.signupIndex]') === -1)
  check('wxml：预览自动分车在无车辆时禁用（0 车按下必空手而归）',
    TRANSPORT_WXML.indexOf("{{busy || !vehicles.length ? 'disabled' : ''}}") !== -1
    && TRANSPORT_WXML.indexOf("{{busy || !vehicles.length ? '' : 'onPreview'}}") !== -1)

  comp.onPreview()
  await waitFor(() => comp.data.planOpen === true)
  check('previewAssignments 以 activityId 调用，plan 收进预览弹层',
    env.previews.length === 1 && env.previews[0] === 'a1' && comp.data.planOpen === true)
  check('计划差异计数：2 调整 / 1 移除 / 1 未能安排',
    comp.data.planCounts.changed === 2 && comp.data.planCounts.removed === 1 && comp.data.planCounts.unassigned === 1,
    JSON.stringify(comp.data.planCounts))
  check('调整行映射成可展示行（旧安排 → 新安排，车辆名+座号）',
    comp.data.planChanged[0].line === '1号车 01 → 1号车 03座'
    && comp.data.planChanged[1].line === '未安排 → 1号车 不编座号',
    JSON.stringify(comp.data.planChanged.map(x => x.line)))
  check('移除行与未能安排的原因文案',
    comp.data.planRemoved[0].name === '王五' && comp.data.planRemoved[0].line === '1号车'
    && comp.data.planUnassigned[0].name === '周八' && comp.data.planUnassigned[0].reason === '上车点不匹配',
    JSON.stringify({ r: comp.data.planRemoved, u: comp.data.planUnassigned }))

  comp.onPlanCommit()
  await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
  check('提交发 assignment.commit，preview 原样携带 plan 且过 schema',
    env.cmds[0].payload.type === 'assignment.commit'
    && JSON.stringify(env.cmds[0].payload.preview) === JSON.stringify(PLAN)
    && keysOf(env.cmds[0].payload) === 'activityId,preview,type' && schemaOk(env.cmds[0].payload),
    JSON.stringify(env.cmds[0].payload).slice(0, 180))
  check('方案保存反馈：弹层关闭 + toast「已保存」+ 成功 callout',
    comp.data.planOpen === false && rec.toasts.indexOf('已保存') !== -1 && comp.data.message === '分车方案已保存。')
  await waitFor(() => comp.revision === 2)

  comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '03' } } })
  check('点空座位打开指派层（车辆/座号带入，未选人）',
    comp.data.assignOpen === true && comp.data.assignVehicleId === 'v1' && comp.data.assignSeat === '03'
    && comp.data.assignIndex === -1 && comp.data.hasCurrent === false)
  comp.onAssignPick({ detail: { value: '0' } })
  comp.onAssignSet()
  await waitFor(() => env.cmds.length === 2 && !comp.data.busy)
  check('安排座位发 assignment.set {signupId,vehicleId,seatLabel}',
    env.cmds[1].payload.type === 'assignment.set'
    && JSON.stringify(env.cmds[1].payload.target) === JSON.stringify({ signupId: 's2', vehicleId: 'v1', seatLabel: '03' })
    && keysOf(env.cmds[1].payload) === 'activityId,target,type' && schemaOk(env.cmds[1].payload),
    JSON.stringify(env.cmds[1].payload))
  await waitFor(() => comp.revision === 3)

  comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1' } } }) // 无座号路径 → seatLabel null
  comp.onAssignPick({ detail: { value: '2' } })
  comp.onAssignSet()
  await waitFor(() => env.cmds.length === 3 && !comp.data.busy)
  check('不编座号时 target.seatLabel 为 null（不是 undefined/空串）',
    env.cmds[2].payload.target.signupId === 's5' && env.cmds[2].payload.target.seatLabel === null
    && schemaOk(env.cmds[2].payload), JSON.stringify(env.cmds[2].payload.target))
  await waitFor(() => comp.revision === 4)

  comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '01', occupant: 's2' } } })
  check('点已占座位：预选现任乘客并给出交换对象（排除本人）',
    comp.data.hasCurrent === true && comp.data.assignIndex === 0 && comp.data.swapOptions.length === 1
    && comp.data.swapOptions[0].signupId === 's3',
    JSON.stringify(comp.data.swapOptions))
  comp.onSwapPick({ detail: { value: '0' } })
  comp.onSwap()
  await waitFor(() => env.cmds.length === 4 && !comp.data.busy)
  check('交换发 assignment.swap {firstSignupId,secondSignupId}',
    env.cmds[3].payload.type === 'assignment.swap' && env.cmds[3].payload.firstSignupId === 's2'
    && env.cmds[3].payload.secondSignupId === 's3'
    && keysOf(env.cmds[3].payload) === 'activityId,firstSignupId,secondSignupId,type'
    && schemaOk(env.cmds[3].payload), JSON.stringify(env.cmds[3].payload))
  check('交换反馈 toast「已交换」', rec.toasts.indexOf('已交换') !== -1)
  await waitFor(() => comp.revision === 5)

  comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '01', occupant: 's2' } } })
  comp.onAssignRemove()
  await waitFor(() => env.cmds.length === 5 && !comp.data.busy)
  check('移除安排发 assignment.remove {signupId}，payload 与 schema 一致',
    env.cmds[4].payload.type === 'assignment.remove' && env.cmds[4].payload.signupId === 's2'
    && keysOf(env.cmds[4].payload) === 'activityId,signupId,type' && schemaOk(env.cmds[4].payload),
    JSON.stringify(env.cmds[4].payload))
  check('移除反馈 toast「已移除」+ 弹层关闭', rec.toasts.indexOf('已移除') !== -1 && comp.data.assignOpen === false)

  comp.onRemoveAsk({ currentTarget: { dataset: { id: 'v1' } } })
  check('删除车辆先弹确认层并带车辆名（不发命令）',
    comp.data.removeOpen === true && comp.data.removeLabel === '1号车' && env.cmds.length === 5)
  comp.onRemoveConfirm()
  await waitFor(() => env.cmds.length === 6 && !comp.data.busy)
  check('确认删除发 vehicle.remove {vehicleId}',
    env.cmds[5].payload.type === 'vehicle.remove' && env.cmds[5].payload.vehicleId === 'v1'
    && schemaOk(env.cmds[5].payload), JSON.stringify(env.cmds[5].payload))
}

// 6. 现场面板：签到 evidence 形状（客户端只带 note）/ 出发核实 / 到家 / 节点 / 异常
async function scenario6() {
  section('6. 现场面板：签到 evidence 形状 / 出发核实 / 到家 / 节点 / 异常')
  {
    const rec = makeWx()
    const env = installApi({ view: withPhase('gathering', GATHER_ACTIONS) })
    const comp = makeComponent(compConfig(FIELD_PATH), { activityId: 'a1', perspective: 'organizer' })
    attach(comp)
    await settleComp(comp)
    check('现场读取带 perspective 属性（workspace 传 organizer）',
      env.reads.length === 1 && env.reads[0].perspective === 'organizer', JSON.stringify(env.reads))
    check('只列已确认人员并带签到/乘车副标题',
      comp.data.rows.length === 4
      && comp.data.rows[0].subtitle === '东门集合点 · 未签到 · 1号车'
      && comp.data.rows[1].subtitle === '西门停车区 · 已签到 · 1号车'
      && comp.data.rows[2].subtitle === '西门停车区 · 未签到 · 无乘车安排',
      JSON.stringify(comp.data.rows[0]))
    check('gathering 收尾标语为现场事实', comp.data.headline === '现场事实，逐项确认')

    comp.openSheet({ currentTarget: { dataset: { id: 's2' } } })
    check('gathering 可发动作：签到/出发三态/两类异常',
      JSON.stringify(comp.data.actions.map(a => a.label)) === JSON.stringify(
        ['确认现场签到', '核实已随队出发', '核实未出发', '标记迟到协调', '记录下撤报备', '记录其他异常']),
      JSON.stringify(comp.data.actions.map(a => [a.type, a.outcome || a.kind || ''])))
    check('动作不含上车与位置上报（上车在车长任务页、位置上报是参与者本人自助）',
      comp.data.actions.every(a => a.type !== 'attendance.board' && a.type !== 'position.report'))
    comp.onAction({ currentTarget: { dataset: { index: '0' } } })
    check('未填逐人核实依据被拦：不发命令',
      env.cmds.length === 0 && comp.data.error === '请先在上方填写逐人核实的依据。' && comp.data.busy === false)
    comp.onNote({ detail: { value: '本人已到东门集合点，当面核实' } })
    comp.onAction({ currentTarget: { dataset: { index: '0' } } })
    await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
    const c0 = env.cmds[0]
    check('签到 payload：checkIn.method=manual，evidence 只带 note（at/by 留空待服务端覆写，不伪造）',
      c0.payload.type === 'attendance.checkin' && c0.payload.signupId === 's2'
      && c0.payload.checkIn.method === 'manual'
      && c0.payload.checkIn.evidence.at === '' && c0.payload.checkIn.evidence.by === ''
      && c0.payload.checkIn.evidence.note === '本人已到东门集合点，当面核实'
      && keysOf(c0.payload) === 'activityId,checkIn,signupId,type',
      JSON.stringify(c0.payload))
    check('签到 payload 按服务端覆写规则补齐后过 schema', schemaOk(c0.payload))
    check('签到保存反馈：逐人 message + toast「已保存」+ revision 推进',
      comp.data.message === '确认现场签到已保存。' && rec.toasts.indexOf('已保存') !== -1)
    await waitFor(() => comp.revision === 2)

    comp.openSheet({ currentTarget: { dataset: { id: 's2' } } })
    comp.onNote({ detail: { value: '电话核实，明日自行到西门停车区汇合' } })
    comp.onAction({ currentTarget: { dataset: { index: '2' } } }) // 核实未出发
    await waitFor(() => env.cmds.length === 2 && !comp.data.busy)
    check('出发核实 payload：outcome.kind=not_departed + evidence（同样只带 note）',
      env.cmds[1].payload.type === 'attendance.departure'
      && env.cmds[1].payload.outcome.kind === 'not_departed'
      && env.cmds[1].payload.outcome.evidence.at === ''
      && env.cmds[1].payload.outcome.evidence.note === '电话核实，明日自行到西门停车区汇合'
      && schemaOk(env.cmds[1].payload), JSON.stringify(env.cmds[1].payload))
    await waitFor(() => comp.revision === 3)

    comp.openSheet({ currentTarget: { dataset: { id: 's2' } } })
    comp.onNote({ detail: { value: '膝盖不适，申请下撤' } })
    comp.onAction({ currentTarget: { dataset: { index: '4' } } }) // 记录下撤报备
    await waitFor(() => env.cmds.length === 3 && !comp.data.busy)
    check('下撤报备发 incident.report {signupIds,kind:withdrawal,description}',
      env.cmds[2].payload.type === 'incident.report' && env.cmds[2].payload.kind === 'withdrawal'
      && JSON.stringify(env.cmds[2].payload.signupIds) === '["s2"]'
      && env.cmds[2].payload.description === '膝盖不适，申请下撤'
      && keysOf(env.cmds[2].payload) === 'activityId,description,kind,signupIds,type'
      && schemaOk(env.cmds[2].payload), JSON.stringify(env.cmds[2].payload))
    await waitFor(() => comp.revision === 4)

    comp.onResolve({ currentTarget: { dataset: { id: 'inc-1' } } })
    check('异常未填处理结果被拦：不发命令',
      env.cmds.length === 3 && comp.data.error === '请填写核实与处理结果。')
    comp.onResolveNote({ currentTarget: { dataset: { id: 'inc-1' } }, detail: { value: '已送医并由家属陪同' } })
    comp.onResolve({ currentTarget: { dataset: { id: 'inc-1' } } })
    await waitFor(() => env.cmds.length === 4 && !comp.data.busy)
    check('结案发 incident.resolve {incidentId,note}',
      env.cmds[3].payload.type === 'incident.resolve' && env.cmds[3].payload.incidentId === 'inc-1'
      && env.cmds[3].payload.note === '已送医并由家属陪同' && schemaOk(env.cmds[3].payload),
      JSON.stringify(env.cmds[3].payload))
  }
  {
    makeWx()
    const env = installApi({ view: withPhase('closing', CLOSING_ACTIONS) })
    const comp = makeComponent(compConfig(FIELD_PATH), { activityId: 'a1', perspective: 'organizer' })
    attach(comp)
    await settleComp(comp)
    check('closing 收尾标语', comp.data.headline === '逐人核实，安心收尾')
    comp.openSheet({ currentTarget: { dataset: { id: 's3' } } })
    check('closing 已随队未到家：动作=到家/另行返程/两类异常',
      JSON.stringify(comp.data.actions.map(a => a.label)) === JSON.stringify(
        ['核实安全到家', '记录另行返程', '记录下撤报备', '记录其他异常']),
      JSON.stringify(comp.data.actions.map(a => a.label)))
    comp.onNote({ detail: { value: '家属电话确认已到家' } })
    comp.onAction({ currentTarget: { dataset: { index: '0' } } })
    await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
    check('到家 payload：顶层 note，无 evidence 对象（不伪造 at/by）',
      env.cmds[0].payload.type === 'attendance.home' && env.cmds[0].payload.signupId === 's3'
      && env.cmds[0].payload.note === '家属电话确认已到家'
      && keysOf(env.cmds[0].payload) === 'activityId,note,signupId,type'
      && !('evidence' in env.cmds[0].payload) && schemaOk(env.cmds[0].payload),
      JSON.stringify(env.cmds[0].payload))
    await waitFor(() => comp.revision === 2)
    comp.openSheet({ currentTarget: { dataset: { id: 's3' } } })
    comp.onNote({ detail: { value: '自驾先行返回' } })
    comp.onAction({ currentTarget: { dataset: { index: '1' } } }) // 记录另行返程 → independent
    await waitFor(() => env.cmds.length === 2 && !comp.data.busy)
    check('另行返程发 attendance.returnPlan plan=independent',
      env.cmds[1].payload.type === 'attendance.returnPlan' && env.cmds[1].payload.plan === 'independent'
      && env.cmds[1].payload.note === '自驾先行返回' && schemaOk(env.cmds[1].payload),
      JSON.stringify(env.cmds[1].payload))
  }
  {
    const view = withPhase('active', ACTIVE_ACTIONS)
    view.positions = [{ signupId: 's3', name: '王五', coordinates: { lat: 30.1, lng: 102.2 }, reportedAt: '2026-09-29T08:50:00+08:00', stale: false }]
    makeWx()
    const env = installApi({ view })
    const comp = makeComponent(compConfig(FIELD_PATH), { activityId: 'a1', perspective: 'organizer' })
    attach(comp)
    await settleComp(comp)
    check('active 阶段展示最后一次主动上报（坐标 + 过时标记）',
      comp.data.positions.length === 1 && comp.data.positions[0].coords === '30.1, 102.2'
      && comp.data.positions[0].stale === false, JSON.stringify(comp.data.positions))
    comp.openSheet({ currentTarget: { dataset: { id: 's3' } } })
    const nodeIdx = comp.data.actions.findIndex(a => a.type === 'attendance.node')
    check('active+已随队：开放节点确认（需选节点）',
      nodeIdx !== -1 && comp.data.pointEnabled === true)
    comp.onNote({ detail: { value: '全队抵达营地，清点无误' } })
    comp.onAction({ currentTarget: { dataset: { index: String(nodeIdx) } } })
    check('未选路线节点被拦：不发命令',
      env.cmds.length === 0 && comp.data.error === '请选择到达的路线节点。')
    comp.onPoint({ detail: { value: '1' } })
    comp.onAction({ currentTarget: { dataset: { index: String(nodeIdx) } } })
    await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
    check('节点确认发 attendance.node {pointId,note}',
      env.cmds[0].payload.type === 'attendance.node' && env.cmds[0].payload.pointId === 'pt-2'
      && env.cmds[0].payload.note === '全队抵达营地，清点无误'
      && keysOf(env.cmds[0].payload) === 'activityId,note,pointId,signupId,type'
      && schemaOk(env.cmds[0].payload), JSON.stringify(env.cmds[0].payload))
  }
}

// 7. 面板防重复加载：attached + observers 同轮触发时 _loading 守卫只让 reload 跑一次
async function scenario7() {
  section('7. 面板防重复加载：attached + observers 同轮 → _loading 守卫只跑一次')
  {
    const env = installApi({ view: organizerView(), transport: transportFixture() })
    makeWx()
    const comp = makeComponent(compConfig(ROSTER_PATH), { activityId: 'a1' })
    attach(comp)
    await settleComp(comp)
    check('名单面板：attached+observer 同轮 → read 只发一次', env.reads.length === 1, 'reads=' + env.reads.length)
    comp.setData({ activityId: 'a2' })
    comp.observers.activityId.call(comp)
    await settleComp(comp)
    check('守卫在读取完成后复位：属性变更可再次加载（activityId 透传读取请求）',
      env.reads.length === 2 && env.reads[1].activityId === 'a2', JSON.stringify(env.reads.map(r => r.activityId)))
  }
  {
    makeWx()
    const env = installApi({ view: organizerView(), transport: transportFixture(), plan: PLAN })
    const comp = makeComponent(compConfig(TRANSPORT_PATH), { activityId: 'a1' })
    attach(comp)
    await settleComp(comp)
    check('分车面板：attached+observer 同轮 → read 与 readTransport 各只发一次',
      env.reads.length === 1 && env.readOrs.length === 1,
      JSON.stringify({ reads: env.reads.length, ors: env.readOrs.length }))
  }
  {
    makeWx()
    const env = installApi({ view: organizerView(), transport: transportFixture() })
    const comp = makeComponent(compConfig(FIELD_PATH), { activityId: 'a1', perspective: 'organizer' })
    attach(comp)
    await settleComp(comp)
    check('现场面板：attached+observer（activityId, perspective）同轮 → read 只发一次',
      env.reads.length === 1, 'reads=' + env.reads.length)
    comp.setData({ perspective: 'staff' })
    comp.observers['activityId, perspective'].call(comp)
    await settleComp(comp)
    check('perspective 变更触发恰好一次重读，且请求带上新视角',
      env.reads.length === 2 && env.reads[1].perspective === 'staff',
      JSON.stringify(env.reads.map(r => r.perspective)))
  }
  {
    makeWx()
    const env = installApi({ view: organizerView() })
    const comp = makeComponent(compConfig(ROSTER_PATH), { activityId: '' })
    attach(comp)
    await sleep(30)
    check('无 activityId 时不发读取（早退，不留半截状态）',
      env.reads.length === 0 && comp.data.loading === true)
  }
}

// 8. 车辆联络（vehicle_contact）只读面：工作台拒绝 / 面板拒绝 / vehicle 视角零可发操作
async function scenario8() {
  section('8. vehicle_contact 只读面：工作台拒绝 / 面板拒绝 / vehicle 视角零可发操作')
  {
    makeWx()
    const env = installApi({ view: { kind: 'denied', message: '不是此活动的组织者。' } })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1' }); page.onShow()
    await settlePage(page)
    check('工作台按 organizer 视角读取，非组织者（如车长）被拒并透出原文',
      env.reads.length === 1 && env.reads[0].perspective === 'organizer'
      && page.data.denied === '不是此活动的组织者。' && page.data.loading === false,
      page.data.denied)
    check('被拒后无任何进程操作可用（canTransition/canCancel=false，不发命令）',
      page.data.canTransition === false && page.data.canCancel === false && env.cmds.length === 0)
  }
  {
    makeWx()
    const env = installApi({ view: { kind: 'denied', message: '不是此活动的组织者。' }, transport: transportFixture() })
    const roster = makeComponent(compConfig(ROSTER_PATH), { activityId: 'a1' })
    attach(roster)
    await settleComp(roster)
    check('名单面板被拒：透出原因且不装配名单行（owner-only 读取被服务端闸门挡下）',
      roster.data.denied === '不是此活动的组织者。' && roster.data.rows.length === 0)
    const transport = makeComponent(compConfig(TRANSPORT_PATH), { activityId: 'a1' })
    attach(transport)
    await settleComp(transport)
    check('分车面板被拒：同样透出原因、不装配车辆',
      transport.data.denied === '不是此活动的组织者。' && transport.data.vehicles.length === 0)
    check('被拒面板没有发出任何命令', env.cmds.length === 0)
  }
  {
    // 车长的可读面是 vehicle 视角（pages/vehicle 用同款读取）：可执行命令只有本车 board/depart/complete，
    // 名单审核/分车/阶段推进/现场记录等 owner 命令都不在 permittedActions —— 现场面板不应渲染任何动作。
    makeWx()
    const view = withPhase('gathering', ['attendance.board', 'vehicle.depart', 'vehicle.complete'])
    view.perspective = 'vehicle'
    view.rows = [ROWS[1], ROWS[2]]
    const env = installApi({ view })
    const comp = makeComponent(compConfig(FIELD_PATH), { activityId: 'a1', perspective: 'vehicle' })
    attach(comp)
    await settleComp(comp)
    check('vehicle 视角读取透传 perspective，乘车人名单可只读查看',
      env.reads.length === 1 && env.reads[0].perspective === 'vehicle' && comp.data.rows.length === 2
      && comp.data.rows[0].name === '李四', JSON.stringify(env.reads))
    comp.openSheet({ currentTarget: { dataset: { id: 's2' } } })
    check('不可发的命令对应操作不渲染：现场记录弹层零动作（gathering 分支开放但权限为空）',
      comp.data.sheetOpen === true && comp.data.actions.length === 0,
      JSON.stringify(comp.data.actions))
    comp.onAction({ currentTarget: { dataset: { index: '0' } } })
    check('驱动不存在的动作被拒：不发任何命令', env.cmds.length === 0 && comp.data.busy === false)
  }
}

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6, scenario7, scenario8]
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
