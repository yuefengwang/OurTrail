// 本车任务页（pages/vehicle）页面级场景测试：node tools/scenario-vehicle-test.js
// 目的：把车长（vehicle_contact）「本车任务」业务链路在 node 下走一遍——装配 read（vehicle 视角 +
// vehicleTask 投影）→ 去程/返程逐人清点（attendance.board）→ 本程发车（vehicle.depart）→
// 本程完成（vehicle.complete）→ 只读守卫 / CONFLICT 自愈 / busy 防抖。
//
// 手法与 tools/scenario-workspace-test.js 一致：global.Page 捕获配置 → delete require.cache 后
// require → makePage() 造实例（setData 记录进 _patches 并同步 this.data，回调 setImmediate 异步触发）
// → 覆写 utils/api 模块同名导出（read/dispatchAndSync）→ 驱动真 handler → 断言 page.data /
// _patches / 捕获到的 dispatch payload（对服务端真 schema.js 校验）。
//
// payload 契约以 cloudfunctions/trailApi/domain/schema.js 为准：
// - attendance.board 是**扁平 note**（{leg, boarded, note}）——它没有 evidence 对象（区别于
//   attendance.checkin / attendance.departure）；服务端 field.js 用 evidence(p.note) 自行落
//   at/by，客户端不伪造时间与操作人；
// - vehicle.depart / vehicle.complete 带顶层 note，同理。
// 边界（以代码实际为准）：本页不发 attendance.departure——「出发核实（outcome）」由现场面板
// （field-panel，workspace/staff 视角）发出，workspace 套件已覆盖；本页的「发车」是 vehicle.depart。
'use strict'
const fs = require('fs')
const path = require('path')

const PAGE_PATH = require.resolve('../miniprogram/pages/vehicle/vehicle.js')
const api = require('../miniprogram/utils/api')
const S = require('../cloudfunctions/trailApi/domain/schema')
// 真 dispatchAndSync 必须在 installApi 覆写之前捕获（模块对象一旦被覆写就取不回真身）
const REAL_DISPATCH_AND_SYNC = api.dispatchAndSync

const VEHICLE_WXML = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'vehicle', 'vehicle.wxml'), 'utf8')
const VEHICLE_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'vehicle', 'vehicle.json'), 'utf8'))
const VEHICLE_SRC = fs.readFileSync(PAGE_PATH, 'utf8')

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
const keysOf = o => Object.keys(o).sort().join(',')

const NOW = '2026-09-29T09:00:00+08:00'

// ---- global.wx 桩：toast/震动/剪贴板；每场景换新，互不串味 ----
function makeWx() {
  const rec = { toasts: [], vibrations: 0, clipboard: [] }
  global.wx = {
    showToast: o => rec.toasts.push((o && o.title) || ''),
    vibrateShort: () => { rec.vibrations++ },
    setClipboardData: o => { rec.clipboard.push((o && o.data) || ''); if (o && o.success) o.success() },
  }
  return rec
}

// ---- 网络桩：覆写 utils/api 的同名导出（页面持有同一模块对象，改属性即生效） ----
function installApi(opts) {
  const env = {
    reads: [], cmds: [],
    state: { revision: opts.revision == null ? 4 : opts.revision },
  }
  api.read = request => {
    env.reads.push(request)
    if (opts.readReject) return Promise.reject(opts.readReject)
    const view = typeof opts.view === 'function' ? opts.view(request) : opts.view
    return Promise.resolve({ view, revision: env.state.revision, now: NOW })
  }
  api.dispatchAndSync = (payload, expectedRevision, page) => {
    env.cmds.push({ payload, expectedRevision, page })
    env.state.revision += 1
    if (opts.cmdReject) return Promise.reject(opts.cmdReject)
    return Promise.resolve({ revision: env.state.revision, targetIds: ['a1'], replayed: false })
  }
  return env
}

// ---- 加载真页面配置并造实例 ----
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  return global.__PAGE_CFG
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
// 真机初挂：onLoad 记参数 → onShow 触发首读
function boot(opts) {
  const page = makePage(pageConfig())
  page.onLoad({ id: 'a1', vehicleId: 'v1' })
  page.onShow()
  return waitFor(() => page.data.loading === false, opts && opts.settleMs).then(() => page)
}

// ---- payload 按 schema.js 校验（attendance.board 无 evidence，无需补 at/by） ----
function schemaOk(payload) {
  return S.validate(S.Payload, JSON.parse(JSON.stringify(payload)))
}

// ---- vehicleTask 视图夹具（形状对齐 selectors.js:386 的 vehicleTask 投影） ----
function passenger(over) {
  const p = Object.assign({
    signupId: 's2', groupId: 'g1', name: '李四', status: 'confirmed',
    pickup: '东门集合点', vehicle: '1号车', seat: '01',
    checkedIn: true, outboundBoarded: false, returnBoarded: false,
    returnPlan: 'assigned', departure: 'joined', home: false,
    avatar: '', phone: '13800000002',
  }, over || {})
  // 车长页现在直接消费域内标志（returnBoardingApplies / needsOutboundBoarding），
  // 不再自己用 returnPlan 重述「谁要清点」这条规则；夹具按服务端同一口径补齐这两个键。
  p.returnBoardingApplies = p.returnPlan === 'assigned'
  p.needsReturnBoarding = p.returnBoardingApplies && p.departure === 'joined' && !p.returnBoarded
  p.needsOutboundBoarding = !p.outboundBoarded
  return p
}
function vehicleView(over) {
  over = over || {}
  const view = Object.assign({
    kind: 'activity', perspective: 'vehicle', primarySignupId: null,
    permittedActions: ['attendance.board', 'vehicle.depart', 'vehicle.complete'],
    activity: {
      id: 'a1', title: '青城后山 · 周末轻徒步', phase: 'gathering',
      pickupPoints: [], routeSnapshot: { points: [] },
    },
    rows: [], incidents: [], positions: [],
    counters: { confirmed: 0, pending: 0, occupied: 0, waitlisted: 0, remaining: 0, unassigned: 0, unchecked: 0, pendingHome: 0, openIncidents: 0 },
  }, over)
  if (!('vehicleTask' in over)) {
    view.vehicleTask = {
      vehicle: {
        id: 'v1', activityId: 'a1', label: '1号车', plate: '川A·12345',
        legalCapacity: 7, blockedSeats: 1,
        drivers: [{ kind: 'service', name: '老司机', phone: '13800000001', userId: null }],
        seatLabels: ['01', '02', '03'], pickupPointIds: ['pk-1'],
        legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
      },
      passengers: [
        passenger(), // s2 已随队、01 号座、去返程都待清点
        passenger({ signupId: 's3', name: '王五', seat: '02', departure: 'unknown', checkedIn: false, avatar: 'cloud://avatar-s3.png', phone: '13800000003' }),
        passenger({ signupId: 's4', name: '赵六', seat: null, returnPlan: 'independent', phone: '13800000004' }),
      ],
    }
  }
  return view
}

// 1. 装配：onLoad 记参数 → vehicle 视角 read → 头部/清点计数/乘客行映射 + json/wxml 接线
async function scenario1() {
  section('1. 装配：vehicle 视角 read → 头部与容量 / 清点计数 / 乘客行映射 / 接线')
  {
    const rec = makeWx()
    const env = installApi({ view: vehicleView() })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1', vehicleId: 'v1' })
    check('onLoad 只把 id/vehicleId 记为实例字段（不进 data，reload 靠它们发请求）',
      page.activityId === 'a1' && page.vehicleId === 'v1' && !('activityId' in page.data),
      JSON.stringify(page.data))
    check('初始态 loading 中、无错误', page.data.loading === true && page.data.denied === '' && page.data.busy === false)
    page.onShow()
    await waitFor(() => page.data.loading === false)
    check('读取请求 = activity / a1 / vehicle 视角 / v1（键集合精确，无多余参数）',
      env.reads.length === 1 && keysOf(env.reads[0]) === 'activityId,kind,perspective,vehicleId'
      && env.reads[0].kind === 'activity' && env.reads[0].activityId === 'a1'
      && env.reads[0].perspective === 'vehicle' && env.reads[0].vehicleId === 'v1',
      JSON.stringify(env.reads))
    check('头部装配：车名/车牌/阶段', page.data.label === '1号车' && page.data.plate === '川A·12345' && page.data.phase === 'gathering')
    check('座位容量行 = 核载 − 司机 − 不可用（vehicleTask.vehicle 司机数参与计算）',
      page.data.capacityLine === '核载 7 − 司机 1 − 不可用 1 = 5 个乘客位', page.data.capacityLine)
    check('gathering 去程可操作：legState 逐人清点、未发车未完成',
      page.data.legState === '逐人清点后再发车' && page.data.canOperate === true
      && page.data.departed === false && page.data.completed === false)
    check('清点计数：应到 3（排除未出发/协调中）· 已上车 0',
      page.data.expectedCount === 3 && page.data.boardedCount === 0,
      JSON.stringify({ e: page.data.expectedCount, b: page.data.boardedCount }))
    check('乘客行映射：副标题=上车点·座号，状态未上车，showBoard 打开',
      page.data.passengers.length === 3
      && page.data.passengers[0].subtitle === '东门集合点 · 01号座'
      && page.data.passengers[0].status === '未上车' && page.data.passengers[0].showBoard === true
      && page.data.passengers[1].showBoard === true,
      JSON.stringify(page.data.passengers[0]))
    check('无座号乘客副标题回落「未编号」；头像透传给 person-row',
      page.data.passengers[2].subtitle === '东门集合点 · 未编号'
      && page.data.passengers[1].avatar === 'cloud://avatar-s3.png',
      JSON.stringify(page.data.passengers[2]))
    check('读取 revision 记为后续命令的 CAS 基准', page.revision === 4, String(page.revision))
    check('成功反馈无震动无 toast（装配不是操作）', rec.vibrations === 0 && rec.toasts.length === 0)
  }
  {
    makeWx()
    installApi({
      view: () => {
        const v = vehicleView()
        v.vehicleTask.passengers[1].departure = 'not_departed'
        v.vehicleTask.passengers[2].departure = 'coordinating'
        return v
      },
    })
    const page = await boot()
    check('未出发/协调中的乘客不进「应到」（去程应到只剩已随队者）',
      page.data.expectedCount === 1 && page.data.passengers[1].showBoard === false && page.data.passengers[2].showBoard === false,
      JSON.stringify(page.data.passengers.map(p => [p.name, p.showBoard])))
  }
  {
    makeWx()
    installApi({
      view: () => {
        const v = vehicleView()
        v.vehicleTask.passengers[0].outboundBoarded = true
        return v
      },
    })
    const page = await boot()
    check('已上车者：状态「已上车」、showBoard 关闭、计数 +1',
      page.data.passengers[0].status === '已上车' && page.data.passengers[0].showBoard === false
      && page.data.boardedCount === 1,
      JSON.stringify(page.data.passengers[0]))
  }
  section('1b. json/wxml 接线：注册组件 / person-row 属性 / 动作按钮绑定的 handler 全部存在')
  check('vehicle.json 注册 icon / status-panel / person-row，标题「本车任务」',
    VEHICLE_JSON.navigationBarTitleText === '本车任务'
    && VEHICLE_JSON.usingComponents['person-row'] === '/components/person-row/person-row'
    && VEHICLE_JSON.usingComponents['status-panel'] === '/components/status-panel/status-panel'
    && VEHICLE_JSON.usingComponents['icon'] === '/components/icon/icon',
    JSON.stringify(VEHICLE_JSON.usingComponents || {}))
  // 拒绝态不能只留一句话：这一页没有别的入口，不给「回到首页」就是死页（§25）。
  // 注意这里仍要求正文只在 else 分支——只读时不该有可点的操作按钮。
  check('denied/loading 两态各占一个 status-panel，denied 带退出入口，正文只在 else 分支',
    VEHICLE_WXML.indexOf('<status-panel wx:if="{{denied}}" kind="denied" title="本车任务不可用" detail="{{denied}}" actionLabel="回到首页" bind:action="goHome" />') !== -1
    && VEHICLE_WXML.indexOf('<status-panel kind="loading" title="正在载入" detail="正在读取本车名单。" />') !== -1)
  check('denied 的退出入口在页面配置上真的有 goHome（不是绑了个不存在的方法）',
    VEHICLE_WXML.indexOf('bind:action="goHome"') !== -1 && typeof pageConfig().goHome === 'function')
  check('清点行文案与 person-row 属性接线（name/avatar/subtitle/status/tone）',
    VEHICLE_WXML.indexOf('应到 {{expectedCount}} 人 · 已上车 {{boardedCount}} 人') !== -1
    && /<person-row[\s\S]*?name="\{\{item.name\}\}"[\s\S]*?avatar="\{\{item.avatar\}\}"[\s\S]*?subtitle="\{\{item.subtitle\}\}"[\s\S]*?status="\{\{item.status\}\}"[\s\S]*?tone=/.test(VEHICLE_WXML))
  check('确认上车按钮按 busy 动态解绑，且携带 data-id（person-row 插槽）',
    VEHICLE_WXML.indexOf("bindtap=\"{{busy ? '' : 'onBoard'}}\"") !== -1
    && VEHICLE_WXML.indexOf('data-id="{{item.signupId}}" bindtap="onCopyContact"') !== -1)
  check('发车/完成按钮的禁用条件与页面状态一致（departed/completed 参与解绑）',
    VEHICLE_WXML.indexOf("bindtap=\"{{busy || departed ? '' : 'onDepart'}}\"") !== -1
    && VEHICLE_WXML.indexOf("bindtap=\"{{busy || !departed || completed ? '' : 'onComplete'}}\"") !== -1)
  check('安全提示在场（行驶完成 ≠ 安全到家）',
    VEHICLE_WXML.indexOf('行驶完成不等于参与者安全到家；如有人未上车，请由现场负责人核实去向。') !== -1)
  const cfg = pageConfig()
  const handlers = VEHICLE_WXML.match(/bindtap="[^"]*?(on[A-Z][A-Za-z]+)/g) || []
  const names = Array.from(new Set(handlers.map(m => m.replace(/.*?on/, 'on'))))
  check('WXML 绑定的全部 handler 都在页面配置上（' + names.join('/') + '）',
    names.length > 0 && names.every(n => typeof cfg[n] === 'function'),
    JSON.stringify(names))
}

// 2. 守卫与降级：缺 vehicleId 自动选车 / 服务端 denied / vehicleTask 缺失 / 读取失败
async function scenario2() {
  section('2. 守卫与降级：缺参自动选车 / denied 透出 / 无 vehicleTask / 读取失败')
  {
    makeWx()
    const env = installApi({ view: vehicleView() })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1' })
    page.onShow()
    await sleep(20)
    // P0-2 修复：home 协作任务卡只带 activityId，缺 vehicleId 不再是死路——
    // 服务端（selectors vehicle 视角）自动挑选本人可联络的车辆，客户端采用其解析结果。
    check('缺 vehicleId：仍外呼且请求不带 vehicleId 值（服务端自动选车）',
      page.data.loading === false && env.reads.length === 1 && env.reads[0].vehicleId === undefined,
      JSON.stringify(env.reads[0]))
    check('缺 vehicleId：采用服务端解析的车辆并正常装配',
      page.vehicleId === 'v1' && page.data.label === '1号车' && page.data.denied === '',
      JSON.stringify({ vehicleId: page.vehicleId, label: page.data.label, denied: page.data.denied }))
  }
  {
    makeWx()
    installApi({ view: { kind: 'denied', code: 'FORBIDDEN', message: '没有此车辆的联络权限。' } })
    const page = await boot()
    check('非本车联络人（服务端拒绝）：透出服务端原文、不装配乘客、不发任何命令',
      page.data.denied === '没有此车辆的联络权限。' && page.data.passengers.length === 0
      && page.data.canOperate === false, page.data.denied)
  }
  {
    makeWx()
    installApi({ view: () => { const v = vehicleView(); v.vehicleTask = null; return v } })
    const page = await boot()
    check('activity 视图但无 vehicleTask（协作数据未就绪）：提示联络授权已结束',
      page.data.denied === '本车联络授权已结束。' && page.data.loading === false, page.data.denied)
  }
  {
    makeWx()
    installApi({ readReject: Object.assign(new Error('云函数执行超时（-504003）'), { code: 'NETWORK' }) })
    const page = makePage(pageConfig())
    page.onLoad({ id: 'a1', vehicleId: 'v1' })
    page.onShow()
    await waitFor(() => page.data.loading === false)
    check('读取失败：api.errorText 透出到 denied，busy 保持空闲',
      page.data.denied === '云函数执行超时（-504003）' && page.data.busy === false, page.data.denied)
  }
}

// 3. 登车 attendance.board：busy 防抖 / 扁平 note（无 evidence）payload 过 schema / 反馈与自动重读 / 失败复位
async function scenario3() {
  section('3. 登车 attendance.board：busy 防抖 / payload 精确形状 / 反馈 / 失败复位')
  {
    const rec = makeWx()
    const env = installApi({ view: vehicleView() })
    const page = await boot()

    page.onBoard({ currentTarget: { dataset: { id: 's2' } } })
    check('busy 中的第二次点击被吞（防抖：同一乘客只发一单）', env.cmds.length === 1, 'cmds=' + env.cmds.length)
    await waitFor(() => env.cmds.length === 1 && page.data.busy === false && env.reads.length === 2)
    const cmd = env.cmds[0]
    check('发出 attendance.board，payload 与 schema 一致（leg/boarded/顶层 note，无 evidence 对象、不伪造 at/by）',
      cmd.payload.type === 'attendance.board' && cmd.payload.activityId === 'a1'
      && cmd.payload.signupId === 's2' && cmd.payload.leg === 'outbound' && cmd.payload.boarded === true
      && cmd.payload.note === '本车联系人现场逐人清点'
      && keysOf(cmd.payload) === 'activityId,boarded,leg,note,signupId,type'
      && !('evidence' in cmd.payload) && schemaOk(cmd.payload),
      JSON.stringify(cmd.payload))
    check('以读取时的 revision 做 CAS，页面实例作为 CONFLICT 自愈的 reload 载体',
      cmd.expectedRevision === 4 && cmd.page === page, String(cmd.expectedRevision))
    check('成功反馈：轻震动 + toast「已确认上车」+ busy 复位',
      rec.vibrations === 1 && rec.toasts.indexOf('已确认上车') !== -1 && page.data.busy === false)
    check('成功后 revision 推进并自动重读（清点状态刷新）', page.revision === 5 && env.reads.length === 2,
      JSON.stringify({ rev: page.revision, reads: env.reads.length }))
    check('登车不误写 error/message', page.data.error === '' && page.data.message === '')
  }
  {
    makeWx()
    const env = installApi({ view: vehicleView(), cmdReject: Object.assign(new Error('车辆已发车，不能抹去或改写已有上车事实。'), { code: 'WRONG_PHASE' }) })
    const page = await boot()
    page.onBoard({ currentTarget: { dataset: { id: 's2' } } })
    await waitFor(() => page.data.busy === false)
    check('登车失败：服务端原文进 error callout、busy 复位、不自动重读',
      page.data.error === '车辆已发车，不能抹去或改写已有上车事实。' && page.data.busy === false,
      page.data.error)
    page.onBoard({ currentTarget: { dataset: { id: 's3' } } })
    await waitFor(() => env.cmds.length === 2 && page.data.busy === false)
    check('失败后 busy 已复位可重试：再次点击发出第二单', env.cmds.length === 2 && env.cmds[1].payload.signupId === 's3')
  }
}

// 4. 发车 vehicle.depart 与完成 vehicle.complete：守卫 / payload / 反馈差异 / 自动重读
async function scenario4() {
  section('4. 发车 vehicle.depart / 完成 vehicle.complete：守卫与 payload')
  {
    const rec = makeWx()
    let readCount = 0
    const env = installApi({
      view: () => {
        readCount++
        const v = vehicleView()
        // 第二次读取模拟服务端已落发车事实：reload 后页面渲染 departed=true
        if (readCount > 1) v.vehicleTask.vehicle.legs.outbound.departed = { at: NOW, by: 'u-vc', note: '本车清点后发车' }
        return v
      },
    })
    const page = await boot()
    page.onDepart()
    await waitFor(() => env.cmds.length === 1 && page.data.busy === false && env.reads.length === 2)
    const cmd = env.cmds[0]
    check('发出 vehicle.depart，payload 与 schema 一致（activityId/vehicleId/leg/note）',
      cmd.payload.type === 'vehicle.depart' && cmd.payload.vehicleId === 'v1'
      && cmd.payload.leg === 'outbound' && cmd.payload.note === '本车清点后发车'
      && keysOf(cmd.payload) === 'activityId,leg,note,type,vehicleId' && schemaOk(cmd.payload),
      JSON.stringify(cmd.payload))
    check('发车反馈：轻震动 + toast「已确认发车」+ 重读', rec.vibrations === 1 && rec.toasts.indexOf('已确认发车') !== -1)
    check('CAS 基准与 revision 推进', cmd.expectedRevision === 4 && page.revision === 5, String(page.revision))
    await waitFor(() => page.data.departed === true)
    page.onDepart()
    check('重读后 departed=true：再点发车被守卫吞掉', env.cmds.length === 1, 'cmds=' + env.cmds.length)
  }
  {
    makeWx()
    const env = installApi({
      view: () => {
        const v = vehicleView()
        v.activity.phase = 'active'
        v.vehicleTask.vehicle.legs.outbound.departed = { at: NOW, by: 'u-vc', note: '本车清点后发车' }
        return v
      },
    })
    const page = await boot()
    check('已发车视图：legState「本程已发车」、全车 showBoard 关闭（上车事实不可再写）',
      page.data.legState === '本程已发车' && page.data.departed === true
      && page.data.passengers.every(p => p.showBoard === false),
      JSON.stringify(page.data.passengers.map(p => p.showBoard)))
    page.onDepart()
    check('已发车后再点发车被守卫吞掉（守卫读的是渲染态 departed）', env.cmds.length === 0, 'cmds=' + env.cmds.length)
    page.onComplete()
    await waitFor(() => env.cmds.length === 1 && page.data.busy === false)
  }
  {
    const rec = makeWx()
    let readCount = 0
    const env = installApi({
      view: () => {
        readCount++
        const v = vehicleView()
        v.activity.phase = 'active'
        // 首读已发车未完成；命令成功后的重读带上完成事实（reload 后渲染 completed=true）
        if (readCount > 1) v.vehicleTask.vehicle.legs.outbound.completed = { at: NOW, by: 'u-vc', note: '本程行驶已完成' }
        return v
      },
    })
    const page = await boot()
    const before = env.reads.length
    page.onComplete()
    await waitFor(() => env.cmds.length === 1 && page.data.busy === false && env.reads.length === before + 1)
    const cmd = env.cmds[0]
    check('vehicle.complete payload 精确（activityId/leg/note/type/vehicleId）且过 schema',
      cmd.payload.type === 'vehicle.complete' && cmd.payload.vehicleId === 'v1'
      && cmd.payload.leg === 'outbound' && cmd.payload.note === '本程行驶已完成'
      && keysOf(cmd.payload) === 'activityId,leg,note,type,vehicleId' && schemaOk(cmd.payload),
      JSON.stringify(cmd.payload))
    check('完成反馈：toast「本程已完成」+ 重读；按代码实际不发震动（震动只属签到/发车）',
      rec.toasts.indexOf('本程已完成') !== -1 && rec.vibrations === 0,
      JSON.stringify({ toasts: rec.toasts, v: rec.vibrations }))
    await waitFor(() => page.data.completed === true)
    page.onComplete()
    check('重读后 completed=true：再点完成被守卫吞掉', env.cmds.length === 1, 'cmds=' + env.cmds.length)
  }
}

// 5. 去程/返程切换：return 视角的应到过滤 / 另行返程 / 阶段门控 / 同 leg no-op
async function scenario5() {
  section('5. 去程/返程切换：return 应到过滤 / 另行返程 / 阶段门控 / no-op')
  {
    makeWx()
    installApi({ view: vehicleView() })
    const page = await boot()
    const patchesBefore = page._patches.length
    page.onLeg({ currentTarget: { dataset: { leg: 'outbound' } } })
    check('切到当前 leg 是 no-op（不 setData、不重算）', page._patches.length === patchesBefore)
    page.onLeg({ currentTarget: { dataset: { leg: 'return' } } })
    await waitFor(() => page.data.leg === 'return' && page.data.expectedCount === 1)
    check('返程应到 = 已随队且按原车返程者（s2）；independent 者标「另行返程」且不在应到',
      page.data.expectedCount === 1 && page.data.passengers[0].showBoard === false
      && page.data.passengers[2].status === '另行返程' && page.data.passengers[2].showBoard === false,
      JSON.stringify(page.data.passengers.map(p => [p.name, p.status, p.showBoard])))
    check('gathering 阶段返程不可操作（canOperate=false，阶段门控）', page.data.canOperate === false)
  }
  {
    makeWx()
    installApi({
      view: () => {
        const v = vehicleView()
        v.activity.phase = 'closing'
        v.vehicleTask.vehicle.legs.outbound.departed = { at: NOW, by: 'u-vc', note: '' }
        v.vehicleTask.vehicle.legs.outbound.completed = { at: NOW, by: 'u-vc', note: '' }
        v.vehicleTask.passengers[0].returnBoarded = true
        return v
      },
    })
    const page = await boot()
    check('closing 去程：已完成 → legState「本程已完成」，去程不可操作',
      page.data.legState === '本程已完成' && page.data.canOperate === false && page.data.completed === true)
    page.onLeg({ currentTarget: { dataset: { leg: 'return' } } })
    await waitFor(() => page.data.leg === 'return' && page.data.canOperate === true)
    check('closing 返程可操作，已上车者不重复出「确认上车」',
      page.data.canOperate === true && page.data.passengers[0].status === '已上车'
      && page.data.passengers[0].showBoard === false && page.data.boardedCount === 1,
      JSON.stringify(page.data.passengers.map(p => [p.name, p.status, p.showBoard])))
  }
}

// 6. 只读边界 + CONFLICT 自愈（真 dispatchAndSync + 桩 wx.cloud.callFunction）
async function scenario6() {
  section('6. 只读边界 / CONFLICT 自愈：被拒零命令 / 冲突后 toast + 自动重读 + error 透出')
  {
    makeWx()
    const env = installApi({ view: { kind: 'denied', code: 'FORBIDDEN', message: '没有此车辆的联络权限。' } })
    const page = await boot()
    check('只读视角（非本车联络人）：denied 透出、无乘客行、无任何可操作标记',
      page.data.denied === '没有此车辆的联络权限。' && page.data.passengers.length === 0
      && page.data.canOperate === false && page.data.expectedCount === 0,
      page.data.denied)
    // 操作入口由渲染层整体门控：denied/loading 占满整页，确认上车按 showBoard、发车/完成按 canOperate，
    // 被拒态下 WXML 不渲染任何按钮（handler 只能来自绑定，页面无需二次权限判断）。
    check('渲染层门控：denied/loading 整页接管，动作按钮分别挂在 showBoard / canOperate 之后',
      VEHICLE_WXML.indexOf('wx:elif="{{loading}}"') !== -1
      && VEHICLE_WXML.indexOf('<view wx:else class="stack">') !== -1
      && VEHICLE_WXML.indexOf('wx:if="{{item.showBoard}}"') !== -1
      && VEHICLE_WXML.indexOf('wx:if="{{canOperate}}" class="form-actions"') !== -1)
    check('被拒后零命令、busy 空闲', env.cmds.length === 0 && page.data.busy === false)
  }
  {
    const rec = makeWx()
    const env = installApi({ view: vehicleView() })
    // 还原真 dispatchAndSync（installApi 桩过它），在更低层桩 wx.cloud.callFunction 返回 CONFLICT 信封，
    // 让「CONFLICT → needRefresh → toast → page.reload()」这条真实自愈链路（api.js dispatchAndSync）原样跑一遍。
    const cloudCalls = []
    global.wx.cloud = {
      callFunction: o => {
        cloudCalls.push(o)
        return Promise.resolve({ result: { ok: false, error: { code: 'CONFLICT', message: '修订已过期，请刷新后重试' } } })
      },
    }
    api.dispatchAndSync = REAL_DISPATCH_AND_SYNC
    const page = await boot()
    const readsBefore = env.reads.length
    page.onBoard({ currentTarget: { dataset: { id: 's2' } } })
    await waitFor(() => page.data.busy === false && env.reads.length === readsBefore + 1)
    check('冲突信封走 dispatch 动作，带 CAS 基准与 requestId（幂等键客户端生成）',
      cloudCalls.length === 1 && cloudCalls[0].data.action === 'dispatch'
      && cloudCalls[0].data.expectedRevision === 4
      && typeof cloudCalls[0].data.requestId === 'string' && cloudCalls[0].data.requestId.length > 0
      && cloudCalls[0].data.payload.type === 'attendance.board',
      (JSON.stringify(cloudCalls[0] && cloudCalls[0].data) || '').slice(0, 160))
    check('CONFLICT 自愈：toast「安排已被他人更新，已刷新，请重试」+ 自动重读一次',
      rec.toasts.indexOf('安排已被他人更新，已刷新，请重试') !== -1 && env.reads.length === readsBefore + 1,
      JSON.stringify({ toasts: rec.toasts, reads: env.reads.length }))
    check('冲突原文透出到 error callout、busy 复位、revision 不 bogus 推进',
      page.data.error === '修订已过期，请刷新后重试' && page.data.busy === false && page.revision === 4,
      JSON.stringify({ err: page.data.error, rev: page.revision }))
    // 自愈重读已完成（revision 仍 4）。恢复命令桩，让「再点一次」基于新基准走通。
    api.dispatchAndSync = (payload, expectedRevision, pageRef) => {
      env.cmds.push({ payload, expectedRevision, page: pageRef })
      env.state.revision += 1
      return Promise.resolve({ revision: env.state.revision, targetIds: ['a1'], replayed: false })
    }
    page.onBoard({ currentTarget: { dataset: { id: 's2' } } })
    await waitFor(() => env.cmds.length === 1 && page.data.busy === false && env.reads.length === readsBefore + 2)
    check('自愈重读后重试：CAS 基准已是重读到的 revision，命令成功',
      env.cmds[0].expectedRevision === 4 && rec.toasts.indexOf('已确认上车') !== -1,
      JSON.stringify({ cas: env.cmds[0] && env.cmds[0].expectedRevision }))
  }
}

// 7. 复制联系信息：setClipboardData 内容与 message；未知 id no-op
async function scenario7() {
  section('7. 复制联系信息：剪贴板内容 / message / 未知 id no-op')
  {
    const rec = makeWx()
    installApi({ view: vehicleView() })
    const page = await boot()
    page.onCopyContact({ currentTarget: { dataset: { id: 's3' } } })
    check('复制「姓名 · 电话」并提示已复制', rec.clipboard.join('|') === '王五 · 13800000003'
      && page.data.message === '联系信息已复制。', JSON.stringify(rec.clipboard))
    page.onCopyContact({ currentTarget: { dataset: { id: 'ghost' } } })
    check('未知 signupId：no-op（不改剪贴板、不崩）',
      rec.clipboard.length === 1 && page.data.message === '联系信息已复制。')
  }
}

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6, scenario7]
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
