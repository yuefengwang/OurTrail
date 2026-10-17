// R-C 回归门：分车面板的两项收口 —— C-15（预览/编辑的往返必须有进行时反馈）
//                              与 A-04（待安排名单上屏 + 指派候选不再混入已分车的人）
// 运行：node tools/rc-transport-test.js
//
// 缺陷形状（final/findings.md ### C-15 / ### A-04）：
//   C-15 —— transport-panel.js 的 onPreview 只*检查* busy 做互斥，从不置 busy，
//           于是 WXML 里那句「正在按最新名单计算…」在这条路径上永远显示不出来；
//           onEditorOpen 同样是「先整趟往返、期间界面完全不变」。
//           判据不是「data 里有 busy 这个键」，而是「往返未决的那一瞬界面姿态真的在忙」，
//           并由 tools/rc-transport-mutate.js 里 M1（删掉置 busy 那行＝改前形态）复现改前红。
//   A-04 —— 顶部「需乘车待安排」是一个裸数字，面板里没有任何一处列出这些人是谁；
//           指派滚轮的候选是「全部需乘车人员」，已分车的人混在里面，选错会把人从原车挪走。
//
// 手法（照 tools/scenario-workspace-test.js 的 harness，绝不在测试里镜像组件逻辑）：
//   stub global.wx → global.Component 捕获**真组件配置** → delete require.cache 强读最新源码
//   → monkey-patch utils/api 的 read/readOr/readTransport/previewAssignments/dispatchAndSync；
//   previewAssignments / readTransport 返回**可控制何时了结**的 promise，
//   这样「在途采样点」落在 promise 未决期间（阳性对照：同一样法对已知正确的 onPlanCommit 也必须成立）。
//
// 三条纪律：
//   ① 自愈判据只有 journey.js 一个出处 ⇒ §2 影子门（改 J.busyStale ⇒ 面板行为跟着改）。
//   ② 预览与编辑都是**读**：置的是界面姿态，失败一律不自动重发（铁律 24）。
//   ③ 「待安排」的判据只许是投影给的 needsSeatAssignment（铁律 19）⇒ §4.2 用影子证明
//      「翻这个布尔 ⇒ 名单跟着翻，改显示字段 ⇒ 名单不动」。
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const TRANSPORT_JS = path.join(ROOT, 'miniprogram', 'components', 'transport-panel', 'transport-panel.js')
const TRANSPORT_WXML = path.join(ROOT, 'miniprogram', 'components', 'transport-panel', 'transport-panel.wxml')
const TRANSPORT_JSON = path.join(ROOT, 'miniprogram', 'components', 'transport-panel', 'transport-panel.json')
const TRANSPORT_PATH = require.resolve('../miniprogram/components/transport-panel/transport-panel.js')
const api = require('../miniprogram/utils/api')
const J = require('../miniprogram/utils/journey')

let passed = 0
let failed = 0
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
const settleComp = comp => waitFor(() => comp.data.loading === false)
// 只在这段同步代码里推进时钟（模拟「往返没回来，用户又点了一次」）
function advanceClock(ms, fn) {
  const real = Date.now
  Date.now = () => real() + ms
  try { return fn() } finally { Date.now = real }
}

// ---- global.wx 桩 ----
function makeWx() {
  const rec = { toasts: [], nav: [] }
  global.wx = {
    showToast: o => rec.toasts.push((o && o.title) || ''),
    vibrateShort: () => {},
    navigateTo: o => rec.nav.push((o && o.url) || ''),
  }
  return rec
}

// ---- 网络桩：读操作返回「可由测试决定何时了结」的 promise ----
const NOW = '2026-09-29T09:00:00+08:00'
function deferred() {
  const d = { resolved: false, rejected: false }
  d.promise = new Promise((res, rej) => {
    d.resolve = v => { d.resolved = true; res(v) }
    d.reject = e => { d.rejected = true; rej(e) }
  })
  return d
}
function installApi(opts) {
  const env = {
    reads: [], readOrs: [], previews: [], readsTransport: [], cmds: [],
    deferredPreviews: [], deferredTransports: [],
    state: { revision: opts.revision == null ? 1 : opts.revision },
  }
  api.read = request => {
    env.reads.push(request)
    return Promise.resolve({ view: opts.view, revision: env.state.revision, now: NOW })
  }
  api.readOr = (name, data) => {
    env.readOrs.push({ name, data })
    return Promise.resolve(opts.transport)
  }
  api.readTransport = activityId => {
    const d = opts.hangTransport ? deferred() : null
    if (d) env.deferredTransports.push(d)
    else d = { promise: Promise.resolve({ ok: true, value: opts.transport }) }
    env.readsTransport.push(activityId)
    return d.promise
  }
  api.previewAssignments = activityId => {
    const d = opts.hangPreview ? deferred() : { promise: Promise.resolve(opts.previewResult || { ok: true, value: opts.plan }) }
    if (opts.hangPreview) env.deferredPreviews.push(d)
    env.previews.push(activityId)
    return d.promise
  }
  api.dispatchAndSync = (payload, expectedRevision) => {
    env.cmds.push({ payload, expectedRevision })
    env.state.revision += 1
    return Promise.resolve({ revision: env.state.revision, targetIds: ['a1'], replayed: false })
  }
  return env
}

// ---- 真组件实例 ----
function compConfig() {
  global.Component = cfg => { global.__RC_CFG = cfg }
  delete require.cache[TRANSPORT_PATH]
  require(TRANSPORT_PATH)
  return global.__RC_CFG
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
function attach(comp) {
  if (comp.lifetimes && comp.lifetimes.attached) comp.lifetimes.attached.call(comp)
  const obs = comp.observers || {}
  for (const key of Object.keys(obs)) obs[key].call(comp)
}

// ---- 样例投影（形状对齐 selectors.rowView / selectTransport）----
function row(id, name, status, over) {
  const r = Object.assign({
    signupId: id, groupId: 'g1', name, status, avatar: '',
    tripMode: 'shared',
    pickup: '东门集合点', vehicle: '', seat: null,
    hasPassengerAssignment: false, needsSeatAssignment: true,
    checkedIn: false, outboundBoarded: false, returnBoarded: false,
    needsOutboundBoarding: true, needsReturnBoarding: false,
    returnPlan: 'assigned', departure: 'unknown', home: false,
  }, over || {})
  return r
}
// s2/s3 已分车；s5/s6 待安排（同车组）；s7 自行前往；s8 兼任司机（自己开车，不是缺事项）
const ROWS = [
  row('s1', '张三', 'pending', {}),
  row('s2', '李四', 'confirmed', { vehicle: '1号车', seat: '01', hasPassengerAssignment: true, needsSeatAssignment: false }),
  row('s3', '王五', 'confirmed', { pickup: '西门停车区', vehicle: '1号车', seat: '02', hasPassengerAssignment: true, needsSeatAssignment: false }),
  row('s5', '孙七', 'confirmed', { pickup: '西门停车区', groupId: 'g2' }),
  row('s6', '周八', 'confirmed', { pickup: '西门停车区', groupId: 'g2' }),
  row('s7', '吴九', 'confirmed', { tripMode: 'self', pickup: '自行前往', needsSeatAssignment: false }),
  row('s8', '郑十', 'confirmed', { vehicle: '1号车', seat: null, hasPassengerAssignment: false, needsSeatAssignment: false }),
]
const COUNTERS = {
  confirmed: 6, pending: 1, occupied: 5, waitlisted: 0, remaining: 1,
  // 服务端 selectors.counters 的口径：confirmed ∧ needsSeatAssignment（与 rowView 同一批派生位）
  unassigned: 2, vehicleTravel: 5, selfTravel: 1, unchecked: 3, pendingHome: 1, openIncidents: 0,
}
function organizerView(rows, counters, phase) {
  return {
    kind: 'activity', perspective: 'organizer', primarySignupId: null,
    permittedActions: ['vehicle.save', 'vehicle.remove', 'assignment.commit', 'assignment.set',
      'assignment.remove', 'assignment.swap'],
    activity: {
      id: 'a1', title: '青城后山 · 周末轻徒步', phase: phase || 'published',
      pickupPoints: [{ id: 'pk-1', name: '东门集合点' }, { id: 'pk-2', name: '西门停车区' }],
      routeSnapshot: { points: [{ id: 'pt-1', name: '起点' }] },
    },
    rows: rows || ROWS,
    counters: counters || COUNTERS,
    incidents: [],
    positions: [],
  }
}
function transportFixture() {
  return {
    vehicles: [{
      id: 'v1', activityId: 'a1', label: '1号车', plate: '川A·12345',
      legalCapacity: 8, blockedSeats: 1,
      drivers: [
        { kind: 'service', name: '老司机', phone: '13800000001', userId: null },
        { kind: 'participant', signupId: 's8' },
      ],
      seatLabels: ['01', '02', '03', '04', '05'],
      pickupPointIds: ['pk-1', 'pk-2'],
      legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
    }],
    assignments: [
      { activityId: 'a1', signupId: 's2', vehicleId: 'v1', seatLabel: '01' },
      { activityId: 'a1', signupId: 's3', vehicleId: 'v1', seatLabel: '02' },
    ],
    groups: [
      { id: 'g2', keepTogether: true, signupIds: ['s5', 's6'] },
      { id: 'g1', keepTogether: false, signupIds: ['s1'] },
    ],
  }
}
const PLAN = {
  activityId: 'a1', baseRevision: 1,
  assignments: [{ activityId: 'a1', signupId: 's5', vehicleId: 'v1', seatLabel: '03' }],
  unassigned: [{ signupId: 's6', reason: 'no_seat' }],
}

async function fresh(opts) {
  makeWx()
  const o = Object.assign({ view: organizerView(), transport: transportFixture(), plan: PLAN }, opts || {})
  const env = installApi(o)
  const comp = makeComponent(compConfig(), { activityId: 'a1' })
  attach(comp)
  await settleComp(comp)
  return { comp, env }
}
const patchWith = (comp, key) => comp._patches.filter(p => p[key] !== undefined)

// ================= §0 阳性对照（采样手法本身必须不是空跑） =================
async function section0() {
  section('§0 阳性对照：在途采样点落在 promise 未决期间 + 名单夹具非空（不过 ⇒ 整轮判为无效）')
  const { comp, env } = await fresh({ hangPreview: true })
  check('组件源码消费单源判据 J.busyStale', fs.readFileSync(TRANSPORT_JS, 'utf8').indexOf('J.busyStale(') !== -1)
  check('journey.js 导出 busyStale 与 BUSY_LIMIT_MS', typeof J.busyStale === 'function'
    && Number.isInteger(J.BUSY_LIMIT_MS) && J.BUSY_LIMIT_MS > 0, String(J.BUSY_LIMIT_MS))
  check('夹具：面板已装载（loading=false / 1 辆车 / 6 行投影）',
    comp.data.loading === false && comp.data.metrics.vehicles === 1 && comp.data.confirmed.length === 5,
    JSON.stringify({ loading: comp.data.loading, vehicles: comp.data.metrics.vehicles, confirmed: comp.data.confirmed.length }))
  const pending = comp.data.pendingList || []
  check('阳性对照：待安排名单在这份夹具里非空（否则 §3 全在空跑）', pending.length > 0, JSON.stringify(pending))

  // 同一条采样手法打在「已知正确」的写路径上必须成立：onPlanCommit 置 busy 且 promise 由测试了结
  const b = await fresh({})
  b.comp.setData({ plan: PLAN })
  b.comp.onPlanCommit()
  const inFlightBusy = b.comp.data.busy === true
  const inFlightCmd = b.env.cmds.length === 1
  check('阳性对照：同一样法在已知正确的写路径上采样到 busy=true（说明采样点没测晚）',
    inFlightBusy && inFlightCmd, JSON.stringify({ busy: b.comp.data.busy, cmds: b.env.cmds.length }))
  if (!(pending.length > 0 && inFlightBusy && inFlightCmd)) {
    console.error('== 有效性门未过：后续断言全部不可信 ==')
    console.log('passed=' + passed + ' failed=' + failed)
    process.exit(1)
  }
}

// ================= §1 C-15 预览的进行时反馈 =================
async function section1() {
  section('§1 C-15：预览自动分车（读）在途必须置 busy/busyAt，两条路径都复位，且绝不自动重发')
  {
    const { comp, env } = await fresh({ hangPreview: true })
    comp.onPreview()
    const sets = patchWith(comp, 'busy')
    check('1.1 在途采样：previewAssignments 已发出且 promise 未决时 data.busy===true',
      env.previews.length === 1 && env.deferredPreviews.length === 1 && comp.data.busy === true,
      JSON.stringify({ previews: env.previews.length, busy: comp.data.busy }))
    check('1.2 busy 与 busyAt 成对置位（自愈判据要读 busyAt；漏一个就是永久锁死）',
      sets.length === 1 && sets[0].busy === true && typeof sets[0].busyAt === 'number' && sets[0].busyAt > 0,
      JSON.stringify(sets.map(s => Object.keys(s))))
    check('1.3 置忙时间戳新鲜（差值远小于宽限期）',
      Math.abs(comp.data.busyAt - Date.now()) < 5000, String(comp.data.busyAt))
    check('1.4 弹层在数据回来之前不打开（两步流没被合并成一步）', comp.data.planOpen === false)
    comp.onPreview()
    comp.onPreview()
    check('1.5 在途连点三次只发一次读（不叠发、不自动重发）',
      env.previews.length === 1, JSON.stringify(env.previews))
    env.deferredPreviews[0].resolve({ ok: true, value: PLAN })
    await waitFor(() => comp.data.planOpen === true)
    check('1.6 成功路径复位 busy 并打开弹层',
      comp.data.busy === false && comp.data.planOpen === true && comp.data.planCounts.unassigned === 1,
      JSON.stringify({ busy: comp.data.busy, planOpen: comp.data.planOpen }))
  }
  {
    const { comp, env } = await fresh({ hangPreview: true })
    comp.onPreview()
    env.deferredPreviews[0].resolve({ ok: false, error: { code: 'NETWORK', message: '读取失败' } })
    await waitFor(() => comp.data.error !== '')
    check('1.7 服务端 Result 失败分支也复位 busy（否则一次失败把面板锁死）',
      comp.data.busy === false && comp.data.error !== '' && comp.data.planOpen === false,
      JSON.stringify({ busy: comp.data.busy, error: comp.data.error }))
    check('1.8 失败后不自动补发读请求', env.previews.length === 1, JSON.stringify(env.previews))
  }
  {
    const { comp, env } = await fresh({ hangPreview: true })
    comp.onPreview()
    env.deferredPreviews[0].reject(new Error('云函数这次没有回话'))
    await waitFor(() => comp.data.error !== '')
    check('1.9 reject 分支也复位 busy 并给出原因（技术原文不进界面）',
      comp.data.busy === false && comp.data.error !== '', JSON.stringify({ busy: comp.data.busy, error: comp.data.error }))
    check('1.10 传输失败同样不自动重发', env.previews.length === 1, JSON.stringify(env.previews))
  }
  {
    // 悬死：promise 永不回来 ⇒ 残留 busy 不得永久锁死（宽限期判据在 J.busyStale）
    const { comp, env } = await fresh({ hangPreview: true })
    comp.onPreview()
    comp.onPreview()
    check('1.11 前置门：在途时第二次点击确实被拦（不然是空跑）',
      env.previews.length === 1 && comp.data.busy === true, JSON.stringify({ previews: env.previews.length, busy: comp.data.busy }))
    advanceClock(J.BUSY_LIMIT_MS + 2000, () => comp.onPreview())
    check('1.12 越过宽限期后再次点击能发出第二次预览（残留 busy 不锁死面板）',
      env.previews.length === 2, JSON.stringify({ previews: env.previews.length }))
    check('1.13 放行时先清残留再重新成对置位（途中出现一次 {busy:false, busyAt:0}）',
      comp._patches.some(p => p.busy === false && p.busyAt === 0)
      && comp.data.busy === true && comp.data.busyAt > 0,
      JSON.stringify({ busy: comp.data.busy, busyAt: comp.data.busyAt }))
    check('1.14 未超时不得复位（反向对照：一刀切清 busy 会让真在跑的往返失去反馈）',
      (() => {
        const c2 = makeComponent(compConfig(), { activityId: 'a1' })
        c2.setData({ busy: true, busyAt: Date.now() })
        c2.healBusy()
        return c2.data.busy === true
      })())
  }
  {
    const { comp, env } = await fresh({ hangPreview: true, view: organizerView(ROWS, COUNTERS) })
    comp.setData({ vehicles: [] })
    comp.onPreview()
    check('1.15 没有车辆时直接早退：不发读、不置忙（避免虚假进行态）',
      env.previews.length === 0 && comp.data.busy === false, JSON.stringify({ previews: env.previews.length, busy: comp.data.busy }))
  }
  {
    // onPlanRecompute 是同一条读路径的第二处（旧实现同样不置 busy）
    const { comp, env } = await fresh({ hangPreview: true })
    comp.onPreview()
    await waitFor(() => env.deferredPreviews.length === 1)
    env.deferredPreviews[0].resolve({ ok: true, value: PLAN })
    await waitFor(() => comp.data.planOpen === true)
    comp.onPlanRecompute()
    check('1.16 「按最新状态重新计算」在途也置 busy（旧实现在这里同样永远没有进行态）',
      comp.data.busy === true && env.previews.length === 2, JSON.stringify({ busy: comp.data.busy, previews: env.previews.length }))
    // 断言已红时第二个 deferred 可能不存在：不许靠抛错中止整轮（崩溃不算抓到，只是把后面的判据弄瞎）
    const d2 = env.deferredPreviews[1]
    if (d2) d2.resolve({ ok: true, value: PLAN })
    await waitFor(() => comp.data.busy === false)
    check('1.17 重算结束复位 busy，两步流仍是两步（planOpen 不被顺手关掉）',
      comp.data.busy === false && comp.data.planOpen === true)
  }
}

// ================= §2 影子门：宽限期判据只有一个出处 =================
async function section2() {
  section('§2 影子门（C-15）：残留放行必须走 J.busyStale 单源；组件自己算时间差就改不动')
  const real = J.busyStale
  const p1 = await fresh({ hangPreview: true })
  p1.comp.onPreview()
  J.busyStale = () => false
  try { advanceClock(J.BUSY_LIMIT_MS + 60000, () => p1.comp.onPreview()) } finally { J.busyStale = real }
  check('S1 影子把判据钉成「永不残留」 ⇒ 越过宽限期第二次点击仍被拦（命令数不变）',
    p1.env.previews.length === 1, JSON.stringify(p1.env.previews.length))
  const p2 = await fresh({ hangPreview: true })
  p2.comp.onPreview()
  J.busyStale = () => true
  try { p2.comp.onPreview() } finally { J.busyStale = real }
  check('S2 影子把判据钉成「永远残留」 ⇒ 刚写入的时间戳也立刻放行（命令数 +1）',
    p2.env.previews.length === 2, JSON.stringify(p2.env.previews.length))
  check('S3 影子还原后判据仍是原函数', J.busyStale === real)
  const code = fs.readFileSync(TRANSPORT_JS, 'utf8').split(/\r?\n/).map(l => {
    const i = l.indexOf('//')
    return i >= 0 ? l.slice(0, i) : l
  }).join('\n')
  check('S4 组件代码里没有第二个 8000 字面量', !/\b8000\b/.test(code), (code.match(/.{0,40}\b8000\b.{0,40}/) || [''])[0])
  check('S5 组件代码里没有自己算 busyAt 的时间差（elapsed 只有 J.busyStale 一处）',
    !/Date\.now\(\)\s*-\s*[\w.]*busyAt|[\w.]*busyAt\s*-\s*Date\.now\(\)/.test(code),
    (code.match(/.{0,48}Date\.now\(\)\s*-\s*[\w.]*busyAt.{0,24}/) || [''])[0])
  check('S6 求值点不止挂在 reload：预览/编辑入口处都调 healBusy()',
    (code.match(/this\.healBusy\(\)/g) || []).length >= 3, String((code.match(/this\.healBusy\(\)/g) || []).length))
  const voidJson = JSON.parse(fs.readFileSync(TRANSPORT_JSON, 'utf8'))
  check('安全闸：transport-panel.json 的 usingComponents 未被本轮改动（overlay/status-panel/form-field/icon 仍在）',
    ['icon', 'overlay', 'status-panel', 'form-field'].every(k => Object.prototype.hasOwnProperty.call(voidJson.usingComponents || {}, k)),
    JSON.stringify(voidJson.usingComponents || {}))
}

// ================= §3 A-04 待安排名单上屏 =================
async function section3() {
  section('§3 A-04：面板里必须列出「谁还没车」，且名单与顶部数字同一个出处')
  {
    const { comp } = await fresh({})
    const list = comp.data.pendingList
    check('3.1 名单逐行给出姓名与上车点（不再只有一个数字）',
      list.length === 2 && list[0].name === '孙七' && list[0].pickup === '西门停车区'
      && list[1].name === '周八', JSON.stringify(list))
    check('3.2 名单与顶部数字同一个出处：pendingList.length === metrics.unassigned',
      list.length === comp.data.metrics.unassigned, JSON.stringify({ list: list.length, metric: comp.data.metrics.unassigned }))
    check('3.3 自行前往的人不在名单里（他不是缺事项）',
      !list.some(x => x.signupId === 's7'), JSON.stringify(list.map(x => x.signupId)))
    check('3.4 已分车的人不在名单里（李四/王五）',
      !list.some(x => x.signupId === 's2' || x.signupId === 's3'), JSON.stringify(list.map(x => x.signupId)))
    check('3.5 未确认（pending）状态的人不在名单里', !list.some(x => x.signupId === 's1'))
    check('3.6 兼任司机的参与者不在名单里：判据是投影布尔，不是「没有车辆名字」',
      !list.some(x => x.signupId === 's8') && comp.data.vehicles[0].driverNames.indexOf('郑十') !== -1,
      JSON.stringify({ drivers: comp.data.vehicles[0].driverNames, list: list.map(x => x.signupId) }))
    check('3.7 整组同车的行带上约束提示（数据来自 readTransport 的 groups，不是猜的）',
      list.every(x => x.groupNote === ' · 整组同车'), JSON.stringify(list.map(x => x.groupNote)))
    {
      // 部署中的投影可能还没有 counters.vehicleTravel（新增位有滞后）：名单本身不能被这个数字带走
      const thin = Object.assign({}, COUNTERS)
      delete thin.vehicleTravel
      const t = await fresh({ view: organizerView(ROWS, thin) })
      check('3.8 投影缺 vehicleTravel 时名单照旧装配（不能把"这一位没读到"演成"没有待办"）',
        t.comp.data.pendingList.length === 2 && t.comp.data.metrics.unassigned === 2,
        JSON.stringify({ list: t.comp.data.pendingList.length, unassigned: t.comp.data.metrics.unassigned }))
    }
  }
  {
    // 全员已安排：名单空，但「需乘车」这一段仍然要说人话，且不能挤掉两个既有空态
    const rows = ROWS.map(r => Object.assign({}, r, { needsSeatAssignment: false }))
    const counters = Object.assign({}, COUNTERS, { unassigned: 0 })
    const { comp } = await fresh({ view: organizerView(rows, counters) })
    check('3.9 全员已安排 ⇒ 名单为空且数字为 0（两者一起归零才算同一出处）',
      comp.data.pendingList.length === 0 && comp.data.metrics.unassigned === 0,
      JSON.stringify({ list: comp.data.pendingList.length, metric: comp.data.metrics.unassigned }))
    check('3.10 需乘车人数仍是 5 ⇒ 这一区间不该整体消失（空名单要由名单区块自己说"已全部安排"，见 3.10）',
      comp.data.metrics.vehicleTravel === 5, JSON.stringify(comp.data.metrics))
    const wxml = fs.readFileSync(TRANSPORT_WXML, 'utf8')
    check('3.11 WXML：名单区块的渲染条件是「有名字可列 或 有人需要乘车」，空名单时给一句定论',
      wxml.indexOf('wx:if="{{pendingList.length || metrics.vehicleTravel}}"') !== -1
      && wxml.indexOf('wx:if="{{!pendingList.length}}"') !== -1)
    check('3.12 WXML：名单区块不吞掉 lockHint 与两个既有空态（三段都还在）',
      wxml.indexOf('{{lockHint}}') !== -1 && wxml.indexOf('kind="empty" title="还没有车辆安排"') !== -1
      && wxml.indexOf('kind="empty" title="这一场不需要排车"') !== -1)
    check('3.13 WXML：名单区块真的把 pendingList 逐行渲染（只钉绑定关系，不钉中文措辞 ⇒ 改文案不该红）',
      wxml.indexOf('wx:for="{{pendingList}}"') !== -1 && wxml.indexOf('wx:key="signupId"') !== -1
      && wxml.indexOf('{{item.name}}') !== -1 && wxml.indexOf('{{item.pickup}}') !== -1)
  }
  {
    // 影子：翻 needsSeatAssignment ⇒ 名单跟着翻；只改显示字段 vehicle ⇒ 名单不动（铁律 19）
    const flipped = ROWS.map(r => r.signupId === 's2' ? Object.assign({}, r, { needsSeatAssignment: true }) : r)
    const a = await fresh({ view: organizerView(flipped, Object.assign({}, COUNTERS, { unassigned: 3 })) })
    check('3.14 影子：把李四的 needsSeatAssignment 翻成 true ⇒ 他立刻进名单（判据就是这个布尔）',
      a.comp.data.pendingList.some(x => x.signupId === 's2'), JSON.stringify(a.comp.data.pendingList.map(x => x.signupId)))
    const textOnly = ROWS.map(r => r.signupId === 's2' ? Object.assign({}, r, { vehicle: '', seat: null }) : r)
    const b = await fresh({ view: organizerView(textOnly, COUNTERS) })
    check('3.15 反向：只清掉李四的显示字段 vehicle（布尔仍是 false）⇒ 名单不动（没有拿文本反推业务态）',
      !b.comp.data.pendingList.some(x => x.signupId === 's2'), JSON.stringify(b.comp.data.pendingList.map(x => x.signupId)))
  }
}

// ================= §4 A-04 指派候选 =================
async function section4() {
  section('§4 A-04：指派候选分区——待安排优先、含已分车者的全集单独标出后果')
  {
    const { comp } = await fresh({})
    comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '03' } } })
    check('4.1 空座位打开：pendingOptions 只含未安排者（孙七/周八），两个下标都不预选',
      comp.data.pendingOptions.length === 2 && comp.data.pendingOptions[0].signupId === 's5'
      && comp.data.pendingIndex === -1 && comp.data.assignIndex === -1 && comp.data.hasCurrent === false,
      JSON.stringify({ p: comp.data.pendingOptions.map(x => x.signupId), pi: comp.data.pendingIndex, ai: comp.data.assignIndex }))
    check('4.2 全集滚轮仍在（能力不退）：confirmedOptions = 全部需乘车者 5 人，含已分车的李四王五',
      comp.data.confirmedOptions.length === 5 && comp.data.confirmedOptions.some(c => c.signupId === 's2')
      && comp.data.confirmedOptions.some(c => c.signupId === 's8') === true,
      JSON.stringify(comp.data.confirmedOptions.map(c => c.signupId)))
    comp.onAssignPick({ detail: { value: '2' } })
    comp.onPendingPick({ detail: { value: '1' } })
    check('4.3 两个滚轮互斥（全集先选、待安排后选 ⇒ 生效的是待安排，旧下标必须归 -1）',
      comp.data.pendingIndex === 1 && comp.data.assignIndex === -1 && !!comp.assignPick()
      && comp.assignPick().signupId === 's6',
      JSON.stringify({ pi: comp.data.pendingIndex, ai: comp.data.assignIndex, pick: comp.assignPick() && comp.assignPick().signupId }))
  }
  {
    const { comp, env } = await fresh({})
    comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '03' } } })
    comp.onPendingPick({ detail: { value: '0' } })
    comp.onAssignSet()
    await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
    check('4.4 待安排滚轮选人 ⇒ assignment.set 的就是那位还没有车辆的人，且带 busy/busyAt 成对',
      env.cmds.length === 1 && env.cmds[0].payload.type === 'assignment.set'
      && env.cmds[0].payload.target.signupId === 's5' && env.cmds[0].payload.target.seatLabel === '03',
      JSON.stringify(env.cmds[0] && env.cmds[0].payload))
    const pairs = patchWith(comp, 'busy').filter(p => p.busy === true)
    check('4.5 写路径仍成对置位（本轮一条都没放松）',
      pairs.length === 1 && pairs[0].busyAt > 0, JSON.stringify(pairs.map(p => Object.keys(p))))
  }
  {
    const { comp, env } = await fresh({})
    comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '03' } } })
    comp.onPendingPick({ detail: { value: '0' } })
    comp.onAssignPick({ detail: { value: '0' } })
    check('4.6 反向：在全集滚轮里选人后，待安排下标归 -1（后点的算，两个滚轮不能同时"选过"）',
      comp.data.assignIndex === 0 && comp.data.pendingIndex === -1 && !!comp.assignPick()
      && comp.assignPick().signupId === 's2',
      JSON.stringify({ ai: comp.data.assignIndex, pi: comp.data.pendingIndex, pick: comp.assignPick() && comp.assignPick().signupId }))
    comp.onAssignSet()
    await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
    check('4.7 已分车的人仍可从全集滚轮调入（"移动某人到空座位"这条既有能力没被排除式过滤砍掉）',
      env.cmds.length === 1 && env.cmds[0].payload.target.signupId === 's2' && env.cmds[0].payload.target.seatLabel === '03',
      JSON.stringify(env.cmds[0] && env.cmds[0].payload))
  }
  {
    const { comp, env } = await fresh({})
    comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '01', occupant: 's2' } } })
    check('4.8 占座打开：现任乘客作为事实存下（assignCurrentId），不再靠候选下标反推',
      comp.data.hasCurrent === true && comp.data.assignCurrentId === 's2' && comp.data.assignIndex === 0,
      JSON.stringify({ cur: comp.data.assignCurrentId, ai: comp.data.assignIndex }))
    comp.onAssignPick({ detail: { value: '3' } })
    comp.onAssignRemove()
    await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
    check('4.9 移除的对象是本座位现任（滚轮后来选了谁都不影响它）',
      env.cmds.length === 1 && env.cmds[0].payload.type === 'assignment.remove'
      && env.cmds[0].payload.signupId === 's2', JSON.stringify(env.cmds[0] && env.cmds[0].payload))
  }
  {
    const { comp, env } = await fresh({})
    comp.openAssign({ currentTarget: { dataset: { vehicle: 'v1', seat: '01', occupant: 's2' } } })
    check('4.10 交换候选只列"确有安排"的人（来自 readTransport 的 assignments）',
      comp.data.swapOptions.length === 1 && comp.data.swapOptions[0].signupId === 's3',
      JSON.stringify(comp.data.swapOptions))
    comp.onPendingPick({ detail: { value: '0' } })
    comp.onSwapPick({ detail: { value: '0' } })
    comp.onSwap()
    await waitFor(() => env.cmds.length === 1 && !comp.data.busy)
    check('4.11 交换双方都是已安排者：先选待安排的人也不能把未安排者塞进 swap（旧实现取候选下标 = 会发错人）',
      env.cmds.length === 1 && env.cmds[0].payload.type === 'assignment.swap'
      && env.cmds[0].payload.firstSignupId === 's2' && env.cmds[0].payload.secondSignupId === 's3',
      JSON.stringify(env.cmds[0] && env.cmds[0].payload))
  }
  {
    const wxml = fs.readFileSync(TRANSPORT_WXML, 'utf8')
    check('4.12 WXML：待安排滚轮绑定 pendingOptions/onPendingPick（不是把全集换个名字）',
      wxml.indexOf('range="{{pendingOptions}}"') !== -1 && wxml.indexOf('bindchange="onPendingPick"') !== -1)
    check('4.13 WXML：全集滚轮的标签把后果说出来（选中已分车者会移出原车）',
      wxml.indexOf('移出原车') !== -1)
    check('4.14 WXML：确认按钮在两个候选都没选时禁用/不给 handler（姿态与守卫配对）',
      wxml.indexOf("{{busy || (assignIndex < 0 && pendingIndex < 0) ? 'disabled' : ''}}") !== -1
      && wxml.indexOf("{{busy || (assignIndex < 0 && pendingIndex < 0) ? '' : 'onAssignSet'}}") !== -1)
    check('4.15 WXML：预览的进行时文案仍只由 busy 决定（改前它拿不到 busy，所以永远显示不出来）',
      wxml.indexOf("{{busy ? '正在按最新名单计算…' : '预览自动分车方案'}}") !== -1
      && wxml.indexOf("{{busy || !vehicles.length ? '' : 'onPreview'}}") !== -1)
  }
}

// ================= §5 C-15 第二处：车辆编辑前的静默往返 =================
async function section5() {
  section('§5 C-15 第二处：添加/编辑车辆前的 readTransport 往返也要有进行时反馈')
  {
    const { comp, env } = await fresh({ hangTransport: true })
    comp.onEditorOpen({ currentTarget: { dataset: { id: '' } } })
    check('5.1 在途采样：readTransport 已发出且未决时 busy===true，busyAt 成对',
      env.readsTransport.length === 1 && comp.data.busy === true && comp.data.busyAt > 0,
      JSON.stringify({ reads: env.readsTransport.length, busy: comp.data.busy, busyAt: comp.data.busyAt }))
    check('5.2 弹层在数据回来之前不打开（表单不能用空壳骗过组织者）', comp.data.editorOpen === false)
    comp.onEditorOpen({ currentTarget: { dataset: { id: '' } } })
    check('5.3 在途连点只发一次读', env.readsTransport.length === 1, JSON.stringify(env.readsTransport.length))
    env.deferredTransports[0].resolve({ ok: true, value: transportFixture() })
    await waitFor(() => comp.data.editorOpen === true)
    check('5.4 成功路径复位 busy 并打开编辑器', comp.data.busy === false && comp.data.editorOpen === true,
      JSON.stringify({ busy: comp.data.busy, editorOpen: comp.data.editorOpen }))
  }
  {
    const { comp, env } = await fresh({ hangTransport: true })
    comp.onEditorOpen({ currentTarget: { dataset: { id: 'v1' } } })
    env.deferredTransports[0].resolve({ ok: false, error: { code: 'NETWORK', message: '读不到车辆' } })
    await waitFor(() => comp.data.error !== '')
    check('5.5 失败路径复位 busy + 给出原因，且编辑器没打开',
      comp.data.busy === false && comp.data.error !== '' && comp.data.editorOpen === false,
      JSON.stringify({ busy: comp.data.busy, error: comp.data.error }))
    check('5.6 读失败不自动重发', env.readsTransport.length === 1, JSON.stringify(env.readsTransport.length))
  }
  {
    const { comp, env } = await fresh({ hangTransport: true })
    comp.onEditorOpen({ currentTarget: { dataset: { id: '' } } })
    advanceClock(J.BUSY_LIMIT_MS + 2000, () => comp.onEditorOpen({ currentTarget: { dataset: { id: '' } } }))
    check('5.7 悬死后越过宽限期可以再开（残留 busy 不永久锁死入口）',
      env.readsTransport.length === 2, JSON.stringify(env.readsTransport.length))
  }
  const wxml = fs.readFileSync(TRANSPORT_WXML, 'utf8')
  const editorTags = wxml.split(/\r?\n/).filter(l => l.indexOf("'onEditorOpen'") !== -1)
  check('5.8 WXML：两个编辑器入口都补了 disabled 与空 handler 的姿态配对（灰态与守卫同步，不是"看着能点"）',
    editorTags.length === 2 && editorTags.every(l => l.indexOf("{{busy ? 'disabled' : ''}}") !== -1)
    && editorTags.every(l => l.indexOf("{{busy ? '' : 'onEditorOpen'}}") !== -1),
    JSON.stringify(editorTags.map(l => l.trim().slice(0, 90))))
}

async function main() {
  await section0()
  await section1()
  await section2()
  await section3()
  await section4()
  await section5()
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}
main().catch(e => {
  console.error('套件自身异常（崩溃不算抓到，判为本轮无效）：' + (e && e.stack || e))
  process.exit(1)
})
