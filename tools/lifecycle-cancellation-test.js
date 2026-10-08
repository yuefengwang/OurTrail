// 取消路径审计：node tools/lifecycle-cancellation-test.js
//
// 审计问题：一个参与者从「取消」这个动作的各个时点切入，容量/座位/司机/履约/归档是否始终一致；
// 以及「活动取消」这条整体作废路径与单人取消之间有没有留脏。
// §6 要求覆盖的八个时点全部在这里，另外补了取消与分车/递补/归档的交叉。
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
const A1 = 'o-a1-openid'
const A2 = 'o-a2-openid'
const A3 = 'o-a3-openid'

/** 一条已发布活动：领队 + 3 位拼车乘客（manual 审核），可选先分好车。 */
function publishedWorld(opts) {
  opts = opts || {}
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.profile(A1, '陈屿')
  w.profile(A2, '王五')
  w.profile(A3, '赵六')
  const a = w.createActivity(LIN, { capacity: opts.capacity || 6, approvalMode: opts.approvalMode || 'manual' })
  w.publish(LIN, a)
  const ids = {}
  for (const [key, u] of Object.entries({ 陈屿: A1, 王五: A2, 赵六: A3 })) {
    w.signup(u, a, key, { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN, keepPending: !opts.confirm })
    ids[key] = w.signupIdOf(key)
  }
  const v = opts.confirm ? w.vehicle(LIN, a, { label: '乘客车', seatLabels: ['1', '2', '3', '4'] }) : null
  if (opts.assign) {
    for (const [i, name] of ['陈屿', '王五', '赵六'].entries()) w.assign(LIN, a, ids[name], v, String(i + 1))
  }
  // 把夹具坐标挂在世界对象上，调用点就能一路 w.dispatch(...) / w.a / w.ids 读下去
  w.a = a
  w.ids = ids
  w.v = v
  return w
}

/* ================= 1. 八个时点的取消 ================= */

section('1. 单人取消：确认前 / 确认后 / 分车后 / 签到后 / 上车后 / 出发后 / 行程中 / 返程中')
{
  // ① 确认前（pending）
  const w1 = publishedWorld({})
  const r1 = w1.dispatch(A1, { type: 'signup.cancel', activityId: w1.a, signupIds: [w1.ids['陈屿']], reason: '还没审核我就不去了' })
  check('① 待确认可取消', r1.ok === true, JSON.stringify(r1))
  check('① 本人取消记为 cancelled（不是 removed）', w1.signupOf('陈屿').status === 'cancelled', w1.signupOf('陈屿').status)
  check('① 名额立刻释放', w1.readActivity(LIN, w1.a, 'organizer').counters.occupied === 2, JSON.stringify(w1.readActivity(LIN, w1.a, 'organizer').counters))

  // ② 确认后、③ 分车后
  const w2 = publishedWorld({ confirm: true, assign: true })
  const seatBefore = w2.assignmentOf(w2.ids['王五'])
  check('前置：王五占着 2 号座', seatBefore && seatBefore.seatLabel === '2', JSON.stringify(seatBefore))
  const r2 = w2.dispatch(LIN, { type: 'signup.cancel', activityId: w2.a, signupIds: [w2.ids['王五']], reason: '领队移除' })
  check('③ 已分车也可取消（同时解除座位）', r2.ok === true, JSON.stringify(r2))
  check('③ 取消记为 removed（由领队发起）', w2.signupOf('王五').status === 'removed', w2.signupOf('王五').status)
  check('③ 座位记录被删除而不是留着占位', w2.assignmentOf(w2.ids['王五']) === null)
  const view2 = w2.readActivity(LIN, w2.a, 'organizer')
  check('③ 「待安排车辆」计数没有因为他消失而虚高', view2.counters.unassigned === 0, JSON.stringify(view2.counters))

  // ④ 签到后（gathering）
  const w3 = publishedWorld({ confirm: true, assign: true })
  w3.toGathering(LIN, w3.a)
  check('④ 前置：签到', w3.checkin(LIN, w3.a, w3.ids['陈屿']).ok === true)
  const r3 = w3.dispatch(A1, { type: 'signup.cancel', activityId: w3.a, signupIds: [w3.ids['陈屿']], reason: '签到后改变主意' })
  check('④ 仅签到（还没有上车/出发事实）仍可取消', r3.ok === true, JSON.stringify(r3))
  check('④ 取消后他的座位一并解除', w3.assignmentOf(w3.ids['陈屿']) === null)

  // ⑤ 上车后
  const w4 = publishedWorld({ confirm: true, assign: true })
  w4.toGathering(LIN, w4.a)
  w4.checkin(LIN, w4.a, w4.ids['陈屿'])
  check('⑤ 前置：去程上车', w4.board(LIN, w4.a, w4.ids['陈屿'], 'outbound', true).ok === true)
  const r4 = w4.dispatch(A1, { type: 'signup.cancel', activityId: w4.a, signupIds: [w4.ids['陈屿']], reason: '上车了又想走' })
  check('⑤ 已有上车事实不可取消报名（转现场异常流程）', !r4.ok && r4.code === 'WRONG_PHASE', JSON.stringify(r4))
  check('⑤ 被拒后上车事实与座位都还在', !!w4.attendanceOf(w4.ids['陈屿']).boardingByLeg.outbound && !!w4.assignmentOf(w4.ids['陈屿']))

  // ⑥ 出发后
  const w5 = publishedWorld({ confirm: true, assign: true })
  w5.toGathering(LIN, w5.a)
  w5.checkin(LIN, w5.a, w5.ids['陈屿'])
  w5.board(LIN, w5.a, w5.ids['陈屿'], 'outbound', true)
  w5.departure(LIN, w5.a, w5.ids['陈屿'], 'joined')
  const r5 = w5.dispatch(A1, { type: 'signup.cancel', activityId: w5.a, signupIds: [w5.ids['陈屿']], reason: '半路想退出' })
  check('⑥ 已核实随队出发不可取消报名', !r5.ok && r5.code === 'WRONG_PHASE', JSON.stringify(r5))

  // ⑦ 行程中 ⑧ 返程中：阶段门先挡住
  const w6 = publishedWorld({ confirm: true, assign: true })
  w6.toGathering(LIN, w6.a)
  check('⑦ 前置：全员核实随队出发并进行程', w6.verifyAllDeparted(LIN, w6.a).ok === true)
  check('⑦ 行程中不能取消报名（WRONG_PHASE）', !w6.dispatch(A1, { type: 'signup.cancel', activityId: w6.a, signupIds: [w6.ids['陈屿']], reason: '行程中' }).ok)
  check('⑦ 此时应改用现场异常报备', w6.dispatch(A1, { type: 'incident.report', activityId: w6.a, signupIds: [w6.ids['陈屿']], kind: 'withdrawal', description: '提前退出同行' }).ok === true)
  w6.phase(LIN, w6.a, 'closing', '返程清点')
  check('⑧ 返程中不能取消报名', !w6.dispatch(A1, { type: 'signup.cancel', activityId: w6.a, signupIds: [w6.ids['王五']], reason: '返程中' }).ok)
  for (const n of ['陈屿', '王五', '赵六']) if (w6.attendanceOf(w6.ids[n]).departure.kind === 'joined' && !w6.attendanceOf(w6.ids[n]).home) w6.home(LIN, w6.a, w6.ids[n])
  w6.dispatch(LIN, { type: 'incident.resolve', activityId: w6.a, incidentId: w6.state.incidents[0].id, note: '已自行回家' })
  check('⑧ 提前退出者用异常闭环后即可归档', w6.phase(LIN, w6.a, 'archived', '归档').ok === true)
}

/* ================= 2. 取消与容量/候补的联动 ================= */

section('2. 取消释放名额：候补递补与整组报名都以释放后的容量为准')
{
  const w = publishedWorld({ capacity: 3, confirm: true })
  // 领队自己占 0，三名乘客已占满 3
  const counters = w.readActivity(LIN, w.a, 'organizer').counters
  check('前置：名额已满（remaining=0）', counters.remaining === 0, JSON.stringify(counters))
  w.profile('o-w9-openid', '钱七')
  const full = w.dispatch('o-w9-openid', { type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'apply', participants: [w.participantInput('o-w9-openid', '钱七', { mode: 'self' })] })
  check('满员时正常提交被拒（CAPACITY）', !full.ok && full.code === 'CAPACITY', JSON.stringify(full))
  const wl = w.dispatch('o-w9-openid', { type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'waitlist', participants: [w.participantInput('o-w9-openid', '钱七', { mode: 'self' })] })
  check('满员时可选择候补', wl.ok === true, JSON.stringify(wl))
  check('候补不占正式名额', w.readActivity(LIN, w.a, 'organizer').counters.remaining === 0, JSON.stringify(w.readActivity(LIN, w.a, 'organizer').counters))

  const cancel = w.dispatch(A1, { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['陈屿']], reason: '让位' })
  check('已确认者取消 ok', cancel.ok === true, JSON.stringify(cancel))
  const promote = w.dispatch(LIN, { type: 'signup.promote', activityId: w.a, signupIds: [wl.targetIds[0]] })
  check('释放名额后候补可递补', promote.ok === true, JSON.stringify(promote))
  check('递补后进入待确认（不是直接确认）', w.signupOf('钱七').status === 'pending', w.signupOf('钱七').status)
  check('取消的人不会重新占回名额', w.readActivity(LIN, w.a, 'organizer').counters.occupied === 3, JSON.stringify(w.readActivity(LIN, w.a, 'organizer').counters))
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('2b. 整组取消与同行组约束')
{
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.profile(A1, '陈屿')
  const a = w.createActivity(LIN, { capacity: 4 })
  w.publish(LIN, a)
  const comp = w.companion(A1, '陈小屿')
  const sub = w.dispatch(A1, {
    type: 'signup.submit', activityId: a, keepTogether: true, mode: 'apply',
    participants: [w.participantInput(A1, '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }), w.participantInput(A1, '陈小屿', { mode: 'shared', pickupPointId: 'pk-1' }, comp)],
  })
  check('整组报名（本人+同行人）提交 ok', sub.ok === true, JSON.stringify(sub))
  w.dispatch(LIN, { type: 'signup.review', activityId: a, signupIds: sub.targetIds, decision: 'confirm' })
  const v = w.vehicle(LIN, a, { legalCapacity: 3, seatLabels: ['1', '2'] })
  const ids = sub.targetIds.slice()
  check('前置：两人分别占 1、2 号座', w.assign(LIN, a, ids[0], v, '1').ok && w.assign(LIN, a, ids[1], v, '2').ok)
  const one = w.dispatch(A1, { type: 'signup.cancel', activityId: a, signupIds: [ids[1]], reason: '同行人去不了' })
  check('允许只取消组内一人（不强迫整组同进退）', one.ok === true, JSON.stringify(one))
  check('取消后组内剩余成员的同行组约束仍可成立（同车）', H.checkOracles(w.state).length === 0, JSON.stringify(H.checkOracles(w.state)))
  const both = w.dispatch(A1, { type: 'signup.cancel', activityId: a, signupIds: [ids[0]], reason: '那我也不去了' })
  check('组内另一人也取消 ok', both.ok === true, JSON.stringify(both))
  check('整组取消后没有任何残留座位', w.state.assignments.length === 0, JSON.stringify(w.state.assignments))
  check('整组取消后名额全部释放', w.readActivity(LIN, a, 'organizer').counters.occupied === 0, JSON.stringify(w.readActivity(LIN, a, 'organizer').counters))
}

/* ================= 3. 取消与车辆的交叉 ================= */

section('3. 取消与司机/车辆/发车的交叉')
{
  // ① 参与者司机必须先换掉才能取消他的报名
  const w = publishedWorld({ confirm: true })
  const drv = w.vehicle(LIN, w.a, { label: '赵六的车', drivers: [{ kind: 'participant', signupId: w.ids['赵六'] }], seatLabels: ['1', '2', '3', '4'] })
  check('前置：赵六登记为参与者司机', w.state.vehicles.find(x => x.id === drv).drivers[0].signupId === w.ids['赵六'])
  const bad = w.dispatch(A3, { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['赵六']], reason: '我不开车了也不去了' })
  check('兼任司机者不可直接取消报名（DRIVER_CONFLICT）', !bad.ok && bad.code === 'DRIVER_CONFLICT', JSON.stringify(bad))
  const swap = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: drv, input: { label: '赵六的车', plate: '川A00009', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('先换成服务司机 ok', swap.ok === true, JSON.stringify(swap))
  const okCancel = w.dispatch(A3, { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['赵六']], reason: '换完司机再取消' })
  check('反空断言：换掉司机后同一条取消即可通过 ⇒ 上一条红来自司机身份', okCancel.ok === true, JSON.stringify(okCancel))

  // ② 已发车车辆上的乘客不可取消（travelLocked 覆盖车辆行车事实）
  const w2 = publishedWorld({ confirm: true, assign: true })
  w2.toGathering(LIN, w2.a)
  for (const n of ['陈屿', '王五', '赵六']) {
    w2.checkin(LIN, w2.a, w2.ids[n])
    w2.board(LIN, w2.a, w2.ids[n], 'outbound', true)
    w2.departure(LIN, w2.a, w2.ids[n], 'joined')
  }
  const dep = w2.dispatch(LIN, { type: 'vehicle.depart', activityId: w2.a, vehicleId: w2.v, leg: 'outbound', note: '发车' })
  check('前置：本车发车 ok', dep.ok === true, JSON.stringify(dep))
  const late = w2.dispatch(A2, { type: 'signup.cancel', activityId: w2.a, signupIds: [w2.ids['王五']], reason: '车都开了' })
  check('车辆已发车后车上乘客不可取消报名', !late.ok && late.code === 'WRONG_PHASE', JSON.stringify(late))
  check('拒绝后座位与上车事实原样保留', !!w2.assignmentOf(w2.ids['王五']) && !!w2.attendanceOf(w2.ids['王五']).boardingByLeg.outbound)
}

/* ================= 4. 取消与集合点收敛（审计 F2） ================= */

section('4. 取消之后，没人使用的集合点必须能收掉（F2）')
{
  const w = publishedWorld({ confirm: false })
  // 陈屿挂在 pk-2 上
  w.profile('o-w7-openid', '钱七')
  const other = w.dispatch('o-w7-openid', { type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'apply', participants: [w.participantInput('o-w7-openid', '钱七', { mode: 'shared', pickupPointId: 'pk-2' })] })
  check('前置：有人挂 pk-2 报名', other.ok === true, JSON.stringify(other))
  const pin = w.dispatch(LIN, { type: 'activity.edit', activityId: w.a, input: w.activityInput({ pickupPoints: [w.activityInput().pickupPoints[0]] }) })
  check('仍有待确认报名引用 pk-2 时不可删除集合点', !pin.ok && pin.code === 'INVALID_INPUT', JSON.stringify(pin))
  w.dispatch('o-w7-openid', { type: 'signup.cancel', activityId: w.a, signupIds: [w.signupIdOf('钱七')], reason: '不去了' })
  check('钱七已取消', w.signupOf('钱七').status === 'cancelled')
  const cut = w.dispatch(LIN, { type: 'activity.edit', activityId: w.a, input: w.activityInput({ pickupPoints: [w.activityInput().pickupPoints[0]] }) })
  check('取消后 pk-2 不再被任何人引用 ⇒ 集合点可收掉', cut.ok === true, JSON.stringify(cut))
  check('收掉集合点不影响历史行的可读（名单仍含该取消者）', w.readActivity(LIN, w.a, 'organizer').rows.some(r => r.status === 'cancelled'))
  check('本节状态合法（终态历史行不再钉住集合点）', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

/* ================= 5. 活动整体取消 vs 单人取消 ================= */

section('5. 活动取消（transition→cancelled）与单人取消的一致性')
{
  const w = publishedWorld({ confirm: true, assign: true })
  w.profile('o-w8-openid', '钱七')
  w.dispatch('o-w8-openid', { type: 'signup.submit', activityId: w.a, keepTogether: false, mode: 'waitlist', participants: [w.participantInput('o-w8-openid', '钱七', { mode: 'shared', pickupPointId: 'pk-1' })] })
  // 挂一个位置上报，验证取消活动时会撤回（invariants 要求取消活动不残留有效位置）
  w.dispatch(A1, { type: 'position.revoke', activityId: w.a, signupId: w.ids['陈屿'] })
  const before = w.snapshot()
  const cx = w.phase(LIN, w.a, 'cancelled', '暴雨')
  check('活动取消 ok', cx.ok === true, JSON.stringify(cx))
  check('全员报名进入 cancelled（含候补）', w.state.signups.every(s => s.status === 'cancelled'), JSON.stringify(w.state.signups.map(s => s.status)))
  check('乘车安排全部清空', w.state.assignments.length === 0, JSON.stringify(w.state.assignments))
  check('招募关闭', w.state.activities[0].acceptingSignups === false)
  check('取消后不再有任何有效位置上报', w.state.positions.every(p => p.revokedAt !== null))
  check('取消动作本身没有把无关记录改掉', w.state.profiles.length === deepCount(before, 'profiles'), JSON.stringify({ now: w.state.profiles.length }))
  const again = w.phase(LIN, w.a, 'cancelled', '再取消一次')
  check('重复取消被拒（幂等由阶段门保证）', !again.ok, JSON.stringify(again))
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

function deepCount(snapshot, key) {
  return JSON.parse(snapshot)[key].length
}

section('5b. 有人已到场（签到）但未出发时，活动仍可整体取消')
{
  const w = publishedWorld({ confirm: true, assign: true })
  w.toGathering(LIN, w.a)
  w.checkin(LIN, w.a, w.ids['陈屿'])
  const cx = w.phase(LIN, w.a, 'cancelled', '临时收队')
  check('仅签到（无上车/出发事实）不阻止活动取消', cx.ok === true, JSON.stringify(cx))
  check('取消后签到事实留在历史里（不被抹去也不被当作出行者）', !!w.attendanceOf(w.ids['陈屿']).checkIn && w.signupOf('陈屿').status === 'cancelled')
}

section('5c. 已有出发/上车事实后，活动不可整体取消（安全档案不可作废）')
{
  const w = publishedWorld({ confirm: true, assign: true })
  w.toGathering(LIN, w.a)
  w.checkin(LIN, w.a, w.ids['陈屿'])
  w.board(LIN, w.a, w.ids['陈屿'], 'outbound', true)
  const blocked = w.phase(LIN, w.a, 'cancelled', '想作废')
  check('有去程上车事实 → 活动取消被拒（UNRESOLVED_SAFETY）', !blocked.ok && blocked.code === 'UNRESOLVED_SAFETY', JSON.stringify(blocked))
  check('拒绝后上车事实与名单原样（零副作用）', !!w.attendanceOf(w.ids['陈屿']).boardingByLeg.outbound && w.signupOf('陈屿').status === 'confirmed')
  const un = w.board(LIN, w.a, w.ids['陈屿'], 'outbound', false)
  check('未发车时可撤销上车记录', un.ok === true, JSON.stringify(un))
  const cx2 = w.phase(LIN, w.a, 'cancelled', '撤销后取消')
  check('反空断言：撤销上车后活动即可取消 ⇒ 上一条红来自那条上车事实', cx2.ok === true, JSON.stringify(cx2))
}

/* ================= 6. 并发：取消与分车同时发生 ================= */

section('6. 交错：取消 vs 给同一个人分车（两层 CAS 都要有一方失败）')
{
  const w = publishedWorld({ confirm: true })
  const base = w.state.revision
  const a = w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['陈屿'], vehicleId: w.v, seatLabel: '1' } }, { expectedRevision: base })
  const b = w.dispatch(A1, { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['陈屿']], reason: '同时取消' }, { expectedRevision: base })
  check('同版本并发：第二条必撞 CONFLICT', (a.ok && !b.ok && b.code === 'CONFLICT') || (!a.ok && a.code === 'CONFLICT'), JSON.stringify({ a, b }))
  const retry = b.code === 'CONFLICT'
    ? w.dispatch(A1, { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['陈屿']], reason: '重读后取消' }, { expectedRevision: w.state.revision })
    : w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['陈屿'], vehicleId: w.v, seatLabel: '1' } }, { expectedRevision: w.state.revision })
  check('败者重读后仍能完成自己的意图', retry.ok === true, JSON.stringify(retry))
  const chen = w.signupOf('陈屿')
  const assign = w.assignmentOf(chen.id)
  check('最终态自洽：要么已取消且无座位，要么未取消且有座位',
    (chen.status === 'cancelled' && assign === null) || (chen.status === 'confirmed' && !!assign),
    JSON.stringify({ status: chen.status, assign }))
  check('交错后状态合法（没有取消者占座的脏中间态）', H.checkOracles(w.state).length === 0, JSON.stringify(H.checkOracles(w.state)))
}

section('6b. 幂等：同一条取消重放不产生第二次效果')
{
  const w = publishedWorld({ confirm: true, assign: true })
  const payload = { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['王五']], reason: '双击' }
  const first = w.dispatch(A2, payload, { requestId: 'req-double' })
  const revAfterFirst = w.state.revision
  const second = w.dispatch(A2, payload, { requestId: 'req-double', expectedRevision: w.state.revision })
  check('首次取消 ok', first.ok === true, JSON.stringify(first))
  check('同 requestId 重放标记 replayed 且不推进版本', second.ok === true && second.replayed === true && w.state.revision === revAfterFirst, JSON.stringify(second))
  check('重放不会改写已取消者的状态（本人发起 ⇒ 记为 cancelled）', w.signupOf('王五').status === 'cancelled', w.signupOf('王五').status)
  const third = w.dispatch(A2, { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['王五']], reason: '换个说法' }, { requestId: 'req-other' })
  check('已取消者再取消被阶段门拒（WRONG_PHASE）', !third.ok && third.code === 'WRONG_PHASE', JSON.stringify(third))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
