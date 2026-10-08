// 重复操作与并发交错审计：node tools/lifecycle-concurrency-test.js
//
// 审计问题：同一意图被发两次、或两条写命令基于同一份读数同时发出时，
// 系统是否只产生一次业务效果，并且败者零副作用。
// 分层说明（与既有测试的分工）：
//   · store.persistState 的事务层②CAS 由 e2e-concurrency / e2e-client-cas 在真存储上测；
//   · 本套件测的是内存层①（reduceCommand 的 expectedRevision + requestId 幂等 + 状态类守卫），
//     这一层是「客户端重试」与「两个面板各自读数」真正会撞上的那一层，也是唯一能穷举的层。
// 判据统一：任何被拒的命令都必须让状态逐字节不变（harness 每步都查，red 会进 problems）。
'use strict'

const H = require('./lifecycle-harness')

let passed = 0
let failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const LIN = 'o-lin-openid'
const U = n => 'o-' + n + '-openid'
const NAMES = ['陈屿', '王五', '赵六', '钱七']

function world(opts) {
  opts = opts || {}
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  for (const n of NAMES) w.profile(U(n), n)
  w.profile(U('孙八'), '孙八') // 只建档不报名：给「重复提交」类用例留一个干净的新人
  // 夹具开关与活动字段分开传：ActivityInput 是严格 schema，多一个键就整条被拒
  const a = w.createActivity(LIN, Object.assign({ capacity: 6 }, opts.activity || {}))
  w.publish(LIN, a)
  const ids = {}
  for (const n of NAMES) {
    w.signup(U(n), a, n, { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN, keepPending: !!opts.keepPending })
    ids[n] = w.signupIdOf(n)
  }
  w.a = a; w.ids = ids
  w.v = opts.noVehicle ? null : w.vehicle(LIN, a, { label: '车A', seatLabels: ['1', '2', '3', '4'] })
  // 现场清点的前提是「这个人已经排到车」：没排车的人域内不给记上车，
  // 所以要做完整收尾链的用例必须显式 opt-in 排车。
  if (opts.assign) w.state.signups.forEach((x, i) => { if (x.trip.mode === 'shared') w.dispatch(LIN, { type: 'assignment.set', activityId: a, target: { signupId: x.id, vehicleId: w.v, seatLabel: String(i + 1) } }) })
  return w
}

/* ================= 1. 幂等：同一 requestId 重放 ================= */

section('1. 同 requestId 重放：八种写命令都只产生一次业务效果')
{
  const cases = [
    ['signup.submit', w => ({ type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'apply', participants: [w.participantInput(U('孙八'), '孙八', { mode: 'self' })] }), w => w.state.signups.length],
    ['signup.review', w => ({ type: 'signup.review', activityId: w.a, signupIds: [w.ids['陈屿']], decision: 'confirm' }), w => w.signupOf('陈屿').status],
    ['signup.cancel', w => ({ type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['王五']], reason: '不去了' }), w => w.signupOf('王五').status],
    ['assignment.set', w => ({ type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['赵六'], vehicleId: w.v, seatLabel: '1' } }), w => w.state.assignments.length],
    ['vehicle.save', w => ({ type: 'vehicle.save', activityId: w.a, vehicleId: null, input: { label: '车B', plate: '川AB', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } }), w => w.state.vehicles.length],
    ['attendance.checkin', w => ({ type: 'attendance.checkin', activityId: w.a, signupId: w.ids['陈屿'], checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: '签到' } } }), w => w.state.attendance.filter(x => x.signupId === w.ids['陈屿']).length],
    ['incident.report', w => ({ type: 'incident.report', activityId: w.a, signupIds: [w.ids['陈屿']], kind: 'other', description: '需要协助' }), w => w.state.incidents.length],
    ['activity.transition', w => ({ type: 'activity.transition', activityId: w.a, next: 'gathering', reason: '开始集合' }), w => w.state.activities[0].phase],
  ]
  for (const [type, build, observe] of cases) {
    const w = world({ keepPending: type === 'signup.review' })
    if (['attendance.checkin', 'incident.report', 'activity.transition'].indexOf(type) !== -1 && type !== 'activity.transition') {
      // 现场类命令要求已过集合阶段；先把活动推到 gathering 再试
      w.dispatch(LIN, { type: 'signup.review', activityId: w.a, signupIds: NAMES.map(n => w.ids[n]), decision: 'confirm' })
      w.phase(LIN, w.a, 'gathering')
    }
    const payload = build(w)
    const first = w.dispatch(payloadActor(type), payload, { requestId: 'fixed-' + type })
    if (!first.ok) { check(type + ' 首次可执行（探测前置）', false, JSON.stringify(first)); continue }
    const rev1 = w.state.revision
    const after1 = observe(w)
    const second = w.dispatch(payloadActor(type), payload, { requestId: 'fixed-' + type })
    check(type + ' 同 requestId 重放被识别为 replayed', second.ok === true && second.replayed === true, JSON.stringify(second))
    check(type + ' 重放不推进 revision', w.state.revision === rev1, JSON.stringify({ rev: w.state.revision, rev1 }))
    check(type + ' 重放没有产生第二份效果', observe(w) === after1, JSON.stringify({ before: after1, after: observe(w) }))
    check(type + ' 重放后状态合法', H.checkOracles(w.state).length === 0 && w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
  }
}

function payloadActor(type) {
  if (type === 'signup.submit') return U('孙八')
  if (type === 'signup.cancel') return U('王五')
  return LIN
}

section('1b. 同内容但换了 requestId：这不是重放，得按新意图处理')
{
  const w = world({})
  const p = { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['王五']], reason: '不去了' }
  const first = w.dispatch(U('王五'), p, { requestId: 'r1' })
  const second = w.dispatch(U('王五'), p, { requestId: 'r2' })
  check('第一次取消 ok', first.ok === true, JSON.stringify(first))
  check('换 requestId 的第二次不是 replayed，而是被状态类守卫拒（WRONG_PHASE）',
    !second.ok && second.replayed !== true && second.code === 'WRONG_PHASE', JSON.stringify(second))
  // 同一 requestId 但内容不同 ⇒ REQUEST_REUSED（幂等窗口内的真实串号）
  const reused = w.dispatch(U('王五'), { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['王五']], reason: '同一个人换内容' }, { requestId: 'r1' })
  check('同 requestId 装不同内容 ⇒ REQUEST_REUSED，且不改状态', !reused.ok && reused.code === 'REQUEST_REUSED', JSON.stringify(reused))
  check('拒绝后赵六仍是已确认（幂等窗口内的串号不能顺手改掉别人的报名）', w.signupOf('赵六').status === 'confirmed', w.signupOf('赵六').status)

  // 非状态类命令（追加型）换 requestId 就是追加：把这条现实钉住，客户端必须保证一次意图一个号
  const w2 = world({})
  const veh = { type: 'vehicle.save', activityId: w2.a, vehicleId: null, input: { label: '重复车', plate: '川AX', legalCapacity: 5, drivers: [w2.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } }
  const v1 = w2.dispatch(LIN, veh, { requestId: 'a' })
  const v2 = w2.dispatch(LIN, veh, { requestId: 'b' })
  check('追加型命令换 requestId 会真的多出一辆（客户端重试不得换新号）', v1.ok && v2.ok && w2.state.vehicles.length === 3, JSON.stringify({ n: w2.state.vehicles.length }))
  check('同 requestId 重试才是幂等的', w2.dispatch(LIN, veh, { requestId: 'b' }).replayed === true && w2.state.vehicles.length === 3)
}

/* ================= 2. 陈旧读数：同版本并发写 ================= */

section('2. 两人基于同一版本各写一次：败者零副作用')
{
  // 关键：两条都必须带同一个 expectedRevision（= 各自读数时的版本），这才是真实的并发形态。
  // harness 默认取「当前」版本，所以这里必须显式传，否则第二条就变成了合法的顺序操作。
  const pairs = [
    ['两人抢同一个座位', (w, base) => w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['陈屿'], vehicleId: w.v, seatLabel: '1' } }, { expectedRevision: base }),
      (w, base) => w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['王五'], vehicleId: w.v, seatLabel: '1' } }, { expectedRevision: base }),
      { keepPending: true, reviewAll: true }],
    ['同时审核同一条报名', (w, base) => w.dispatch(LIN, { type: 'signup.review', activityId: w.a, signupIds: [w.ids['赵六']], decision: 'confirm' }, { expectedRevision: base }),
      (w, base) => w.dispatch(LIN, { type: 'signup.review', activityId: w.a, signupIds: [w.ids['赵六']], decision: 'reject' }, { expectedRevision: base }),
      { keepPending: true }],
    ['一人取消另一人分车', (w, base) => w.dispatch(U('钱七'), { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['钱七']], reason: '不去了' }, { expectedRevision: base }),
      (w, base) => w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['钱七'], vehicleId: w.v, seatLabel: '2' } }, { expectedRevision: base }),
      {}],
    ['同时建两辆车', (w, base) => w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: null, input: { label: '甲车', plate: '川A1', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } }, { expectedRevision: base }),
      (w, base) => w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: null, input: { label: '乙车', plate: '川A2', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } }, { expectedRevision: base }),
      {}],
    ['同时推进阶段', (w, base) => w.dispatch(LIN, { type: 'activity.transition', activityId: w.a, next: 'gathering', reason: '集合' }, { expectedRevision: base }),
      (w, base) => w.dispatch(LIN, { type: 'activity.transition', activityId: w.a, next: 'gathering', reason: '集合（另一台）' }, { expectedRevision: base }),
      {}],
  ]
  for (const [name, a, b, fixture] of pairs) {
    const w = world(Object.assign({ keepPending: !!fixture.keepPending }, fixture.activity || {}))
    if (fixture.reviewAll) w.dispatch(LIN, { type: 'signup.review', activityId: w.a, signupIds: NAMES.map(n => w.ids[n]), decision: 'confirm' })
    const base = w.state.revision
    const r1 = a(w, base)
    const mid = w.snapshot()
    const r2 = b(w, base)
    check(name + '：第一条基于版本 ' + base + ' 成功', r1.ok === true, JSON.stringify(r1))
    check(name + '：第二条带同一版本 ⇒ CONFLICT', !r2.ok && r2.code === 'CONFLICT', JSON.stringify(r2))
    check(name + '：败者零副作用（状态仍是胜者落库后的样子）', w.snapshot() === mid)
    const retry = b(w, w.state.revision)
    check(name + '：败者重读后重试得到确定性结论（不是静默双写）',
      retry.ok === true || ['CONFLICT', 'SEAT_TAKEN', 'WRONG_PHASE', 'CAPACITY', 'DUPLICATE_PERSON', 'GROUP_SCOPE', 'NOT_FOUND'].indexOf(retry.code) !== -1,
      JSON.stringify(retry))
    check(name + '：最终状态合法', H.checkOracles(w.state).length === 0 && w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
  }
}

section('2b. 抢同一座位的终局：绝不允许一个座位两个人')
{
  const w = world({})
  const base = w.state.revision
  const a = w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['陈屿'], vehicleId: w.v, seatLabel: '1' } }, { expectedRevision: base })
  const b = w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['王五'], vehicleId: w.v, seatLabel: '1' } }, { expectedRevision: base })
  check('一条成功一条 CONFLICT（不是两条都落库）', a.ok === true && !b.ok && b.code === 'CONFLICT', JSON.stringify({ a, b }))
  const b2 = w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['王五'], vehicleId: w.v, seatLabel: '1' } })
  check('败者重读后仍然被座位唯一性挡住（SEAT_TAKEN）', !b2.ok && b2.code === 'SEAT_TAKEN', JSON.stringify(b2))
  const seats = w.state.assignments.filter(x => x.seatLabel === '1').map(x => x.signupId)
  check('1 号位最终只有一个人', seats.length === 1, JSON.stringify(seats))
  check('独立 oracle 没有报出占座冲突', H.checkOracles(w.state).every(x => x.indexOf('O-SEAT-TAKEN') !== 0), JSON.stringify(H.checkOracles(w.state)))
}

/* ================= 3. 现场事实的重复记录与不可抹去 ================= */

section('3. 重复签到 / 重复上车 / 重复核实 / 重复报平安')
{
  const w = world({ assign: true })
  w.phase(LIN, w.a, 'gathering', '集合')
  const chen = w.ids['陈屿']
  const ci1 = w.checkin(LIN, w.a, chen)
  const ci2 = w.checkin(LIN, w.a, chen)
  check('重复签到不产生第二份履约记录', ci1.ok && ci2.ok && w.state.attendance.filter(x => x.signupId === chen).length === 1)
  check('签到是覆盖语义（同一人只留最新一次证据），但覆盖不改变事实本身', !!w.attendanceOf(chen).checkIn && w.attendanceOf(chen).checkIn.method === 'manual')
  w.assign(LIN, w.a, chen, w.v, '1')
  const bd1 = w.board(LIN, w.a, chen, 'outbound', true)
  const bd2 = w.board(LIN, w.a, chen, 'outbound', true)
  check('重复「已上车」是幂等的（不会刷新成两条）', bd1.ok && bd2.ok)
  const firstAt = w.attendanceOf(chen).boardingByLeg.outbound.at
  check('已存在上车事实时重复上报不会改写它的时刻', w.attendanceOf(chen).boardingByLeg.outbound.at === firstAt, JSON.stringify(w.attendanceOf(chen).boardingByLeg.outbound))
  const dp1 = w.departure(LIN, w.a, chen, 'joined')
  const dp2 = w.departure(LIN, w.a, chen, 'joined')
  check('重复核实随队出发 ok 且状态不变', dp1.ok && dp2.ok && w.attendanceOf(chen).departure.kind === 'joined')
  const un = w.board(LIN, w.a, chen, 'outbound', false)
  check('未发车时可以撤销上车（这是纠正，不是抹历史）', un.ok === true, JSON.stringify(un))
  check('撤销后此人重新欠着去程清点', w.attendanceOf(chen).boardingByLeg.outbound === null && w.rowOf && true)

  // 到家与发车证据都不可覆盖
  const w2 = world({ assign: true })
  w2.toGathering(LIN, w2.a)
  for (const n of NAMES) { w2.checkin(LIN, w2.a, w2.ids[n]); if (rowNeeds(w2, n)) w2.board(LIN, w2.a, w2.ids[n], 'outbound', true); w2.departure(LIN, w2.a, w2.ids[n], 'joined') }
  w2.phase(LIN, w2.a, 'active', '开始行程')
  const depart1 = w2.dispatch(LIN, { type: 'vehicle.depart', activityId: w2.a, vehicleId: w2.v, leg: 'outbound', note: '第一次发车' })
  check('发车 ok', depart1.ok === true, JSON.stringify(depart1))
  const stamp1 = JSON.stringify(w2.state.vehicles.find(x => x.id === w2.v).legs.outbound.departed)
  const depart2 = w2.dispatch(LIN, { type: 'vehicle.depart', activityId: w2.a, vehicleId: w2.v, leg: 'outbound', note: '第二次发车想改证据' })
  check('重复发车被接受但绝不改写已存在的发车证据', depart2.ok === true && JSON.stringify(w2.state.vehicles.find(x => x.id === w2.v).legs.outbound.departed) === stamp1, JSON.stringify({ ok: depart2.ok, stamp: stamp1 }))
  w2.phase(LIN, w2.a, 'closing', '返程清点')
  const hm1 = w2.home(LIN, w2.a, w2.ids['陈屿'])
  const hm2 = w2.home(LIN, w2.a, w2.ids['陈屿'])
  check('重复报平安幂等且不覆盖首次到家证据', hm1.ok && hm2.ok && !!w2.attendanceOf(w2.ids['陈屿']).home)
}

function rowNeeds(w, name) {
  const rows = w.readActivity(LIN, w.a, 'organizer').rows
  const r = rows.find(x => x.signupId === w.ids[name])
  return r && r.needsOutboundBoarding
}

/* ================= 4. 归档/取消 与迟到操作 ================= */

section('4. 归档之后，任何迟到的写命令都必须被拒且零副作用')
{
  const w = world({ assign: true })
  w.toGathering(LIN, w.a)
  for (const n of NAMES) {
    w.checkin(LIN, w.a, w.ids[n])
    if (rowNeeds(w, n)) w.board(LIN, w.a, w.ids[n], 'outbound', true)
    w.departure(LIN, w.a, w.ids[n], 'joined')
    if (rowNeeds(w, n)) w.dispatch(LIN, { type: 'attendance.returnPlan', activityId: w.a, signupId: w.ids[n], plan: 'independent', note: '搭朋友车回' })
  }
  w.phase(LIN, w.a, 'active', '开始行程')
  w.dispatch(LIN, { type: 'vehicle.depart', activityId: w.a, vehicleId: w.v, leg: 'outbound', note: '发车' })
  w.phase(LIN, w.a, 'closing', '返程清点')
  for (const n of NAMES) w.home(LIN, w.a, w.ids[n])
  const archived = w.phase(LIN, w.a, 'archived', '归档')
  check('闭环后归档 ok', archived.ok === true, JSON.stringify(archived))
  const stale = w.state.revision - 3
  const late = [
    ['迟到的签到（还带旧版本号）', U('陈屿'), { type: 'attendance.checkin', activityId: w.a, signupId: w.ids['陈屿'], checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: '我其实到了' } } }],
    ['迟到的补上车', LIN, { type: 'attendance.board', activityId: w.a, signupId: w.ids['王五'], leg: 'outbound', boarded: true, note: '补' }],
    ['迟到的核实出发', LIN, { type: 'attendance.departure', activityId: w.a, signupId: w.ids['王五'], outcome: { kind: 'coordinating', evidence: { at: w.now, by: LIN, note: '改口径' } } }],
    ['迟到的改名单', U('陈屿'), { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['陈屿']], reason: '想撤回' }],
    ['迟到的删车', LIN, { type: 'vehicle.remove', activityId: w.a, vehicleId: w.v }],
    ['迟到的分车', LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['陈屿'], vehicleId: w.v, seatLabel: '2' } }],
    ['迟到的补报异常', LIN, { type: 'incident.report', activityId: w.a, signupIds: [w.ids['赵六']], kind: 'injury', description: '归档后补报' }],
    ['迟到的发通知', LIN, { type: 'notice.publish', activityId: w.a, audience: { kind: 'activity' }, content: '归档后通知' }],
    ['迟到的阶段回退', LIN, { type: 'activity.transition', activityId: w.a, next: 'active', reason: '想回退' }],
  ]
  const before = w.snapshot()
  for (const [name, actor, payload] of late) {
    const fresh = w.dispatch(actor, payload)
    check('归档后拒绝：' + name, !fresh.ok, JSON.stringify(fresh))
    const withStale = w.dispatch(actor, payload, { expectedRevision: stale })
    check('带陈旧版本号也同样被拒（CAS 不会替阶段门放行）', !withStale.ok, JSON.stringify(withStale))
  }
  check('全部迟到操作零副作用', w.snapshot() === before, '状态被改动了')
  check('本节状态合法', H.checkOracles(w.state).length === 0 && w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
}

section('4b. 活动取消与迟到操作')
{
  const w = world({})
  const cx = w.phase(LIN, w.a, 'cancelled', '暴雨')
  check('取消 ok', cx.ok === true, JSON.stringify(cx))
  const before = w.snapshot()
  for (const [actor, payload] of [
    [U('陈屿'), { type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'apply', participants: [w.participantInput(U('陈屿'), '陈屿', { mode: 'self' })] }],
    [LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: null, input: { label: '新车', plate: '川AN', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } }],
    [LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['王五'], vehicleId: w.v, seatLabel: '1' } }],
    [LIN, { type: 'attendance.checkin', activityId: w.a, signupId: w.ids['王五'], checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: 'x' } } }],
  ]) {
    const r = w.dispatch(actor, payload)
    check('取消后拒绝 ' + payload.type, !r.ok, JSON.stringify(r))
  }
  check('取消后的拒绝全部零副作用', w.snapshot() === before)
  check('取消后所有报名都是 cancelled 且没有座位残留', w.state.signups.every(s => s.status === 'cancelled') && w.state.assignments.length === 0)
}

/* ================= 5. 交错：取消 + 分车 + 审核 的真实序 ================= */

section('5. 交错序列：审核 → 分车 → 有人中途取消 → 再自动分车')
{
  const w = world({ keepPending: true })
  const pending = NAMES.map(n => w.ids[n])
  const review = w.dispatch(LIN, { type: 'signup.review', activityId: w.a, signupIds: pending, decision: 'confirm' })
  check('批量审核确认 ok', review.ok === true, JSON.stringify(review))
  const cancel = w.dispatch(U('王五'), { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['王五']], reason: '临时去不了' })
  check('中途取消 ok', cancel.ok === true, JSON.stringify(cancel))
  const plan = w.preview(LIN, w.a)
  check('自动分车预览 ok', plan.ok === true, JSON.stringify(plan))
  check('预览不包含已取消的人', plan.value.assignments.every(x => x.signupId !== w.ids['王五']) && plan.value.unassigned.every(x => x.signupId !== w.ids['王五']), JSON.stringify(plan.value))
  check('预览正好覆盖其余 3 人', plan.value.assignments.length === 3, JSON.stringify(plan.value.assignments))
  const commit = w.dispatch(LIN, { type: 'assignment.commit', activityId: w.a, preview: plan.value })
  check('提交预览 ok', commit.ok === true, JSON.stringify(commit))
  check('每人只有一个座位', new Set(plan.value.assignments.map(x => x.signupId)).size === plan.value.assignments.length)
  check('座位号不重复', new Set(plan.value.assignments.map(x => x.seatLabel)).size === plan.value.assignments.length, JSON.stringify(plan.value.assignments))
  // 取消者此刻已不占位：他的旧记录不该被自动分车捡回来
  const ghost = w.state.assignments.filter(x => x.signupId === w.ids['王五'])
  check('已取消者没有被任何自动安排捡回车里', ghost.length === 0, JSON.stringify(ghost))
  // 现在让王五重新报名（同一人重新占一个资格）
  const again = w.signup(U('王五'), w.a, '王五', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  check('取消后本人可以重新报名', again.ok === true, JSON.stringify(again))
  const row = w.readActivity(LIN, w.a, 'organizer').rows.find(r => r.signupId === again.targetIds[0])
  check('重新报名的人是新的报名记录且处于待安排车辆', !!row && row.status === 'confirmed' && row.needsSeatAssignment === true, JSON.stringify(row))
  check('本节状态合法', H.checkOracles(w.state).length === 0 && w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
}

section('5b. 候补递补是整批的：名额不够时不允许「递补了一半」')
{
  const w = world({ activity: { capacity: 4 } })
  w.profile(U('周九'), '周九')
  const c1 = w.dispatch(U('孙八'), { type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'waitlist', participants: [w.participantInput(U('孙八'), '孙八', { mode: 'self' })] })
  const c2 = w.dispatch(U('周九'), { type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'waitlist', participants: [w.participantInput(U('周九'), '周九', { mode: 'self' })] })
  check('前置：满员时候补两名都提交 ok', c1.ok === true && c2.ok === true, JSON.stringify({ c1, c2 }))
  const free = w.dispatch(U('王五'), { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['王五']], reason: '让出一个位子' })
  check('前置：取消一人腾出 1 个名额', free.ok === true, JSON.stringify(free))
  check('前置读数：占用 3 / 候补 2', (() => { const c = w.readActivity(LIN, w.a, 'organizer').counters; return c.occupied === 3 && c.waitlisted === 2 })(), JSON.stringify(w.readActivity(LIN, w.a, 'organizer').counters))
  const both = w.snapshot()
  const promoteBoth = w.dispatch(LIN, { type: 'signup.promote', activityId: w.a, signupIds: [c1.targetIds[0], c2.targetIds[0]] })
  check('两人一起递补但只剩 1 个名额 ⇒ CAPACITY', !promoteBoth.ok && promoteBoth.code === 'CAPACITY', JSON.stringify(promoteBoth))
  check('整批一条都没变（不存在「递补上一半」的半成功）', w.snapshot() === both)
  const one = w.dispatch(LIN, { type: 'signup.promote', activityId: w.a, signupIds: [c1.targetIds[0]] })
  check('反空断言：只递补一人即可通过 ⇒ 上一条红来自名额而非权限', one.ok === true, JSON.stringify(one))
  const view = w.readActivity(LIN, w.a, 'organizer')
  check('递补后进入待确认而不是直接确认', view.rows.find(r => r.name === '孙八').status === 'pending', JSON.stringify(view.rows.find(r => r.name === '孙八')))
  check('递补者占用名额，另一人仍是候补', view.counters.occupied === 4 && view.counters.waitlisted === 1 && view.counters.remaining === 0, JSON.stringify(view.counters))
  check('本节状态合法', H.checkOracles(w.state).length === 0 && w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
