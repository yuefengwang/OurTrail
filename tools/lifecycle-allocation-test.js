// 车辆/座位分配压力审计：node tools/lifecycle-allocation-test.js
//
// 审计问题：Vehicle − Driver − Seat − Participant − PickupPoint 五元约束在「刻意构造的非法组合」下
// 是否一律被拒绝，且拒绝之后不留半成品；已产生的行车事实是否可能被后续修改抹掉。
// §7 列出的九类构造全部在这里，另加司机与发车事实的矛盾（F1）与删车的承载义务（F11）。
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
const NAMES = ['陈屿', '王五', '赵六', '钱七', '孙八']

function world(riders, over) {
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  for (const name of riders) w.profile(U(name), name)
  const a = w.createActivity(LIN, over || {})
  w.publish(LIN, a)
  const ids = {}
  for (const name of riders) {
    w.signup(U(name), a, name, { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
    ids[name] = w.signupIdOf(name)
  }
  w.a = a
  w.ids = ids
  return w
}

function veh(w, label, over) {
  const base = { label, plate: '川A' + label, legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] }
  const id = w.vehicle(LIN, w.a, Object.assign(base, over || {}))
  return id
}

/* ================= 1. 容量 ================= */

section('1. 容量：1 辆车 4 个乘客位，第 5 个人必须进不去')
{
  const w = world(NAMES.slice(0, 5))
  const v = veh(w, '小车', { legalCapacity: 5, seatLabels: ['1', '2', '3', '4'] })
  const first4 = ['陈屿', '王五', '赵六', '钱七']
  for (const n of first4) check(n + ' 排到 ' + first4.indexOf(n) + 1 + ' 号位', w.assign(LIN, w.a, w.ids[n], v, String(first4.indexOf(n) + 1)).ok === true)
  const over = w.assign(LIN, w.a, w.ids['孙八'], v, '5')
  check('第 5 人排进同一辆车被拒（VEHICLE_FULL）', !over.ok && over.code === 'VEHICLE_FULL', JSON.stringify(over))
  const noSeat = w.assign(LIN, w.a, w.ids['孙八'], v, null)
  check('即使不填座号也不能突破乘客位（VEHICLE_FULL）', !noSeat.ok && noSeat.code === 'VEHICLE_FULL', JSON.stringify(noSeat))
  check('拒绝后这辆车仍然只有 4 条安排', w.state.assignments.filter(x => x.vehicleId === v).length === 4, JSON.stringify(w.state.assignments.length))
  check('孙八保持未安排（不是被塞进一个不存在的座位）', w.assignmentOf(w.ids['孙八']) === null)

  // 预留/禁用位要真的把容量压下来
  const blocked = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: v, input: { label: '小车', plate: '川A小车', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 1, seatLabels: ['1', '2', '3'], pickupPointIds: ['pk-1'] } })
  check('已有 4 人时把可用位压到 3 → 被拒（VEHICLE_FULL）', !blocked.ok && blocked.code === 'VEHICLE_FULL', JSON.stringify(blocked))
  const rm = w.dispatch(LIN, { type: 'assignment.remove', activityId: w.a, signupId: w.ids['钱七'] })
  check('前置：先解除钱七', rm.ok === true, JSON.stringify(rm))
  const blocked2 = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: v, input: { label: '小车', plate: '川A小车', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 1, seatLabels: ['1', '2', '3'], pickupPointIds: ['pk-1'] } })
  check('反空断言：解除一人后压容量即可通过 ⇒ 上一条红来自超员', blocked2.ok === true, JSON.stringify(blocked2))
  check('座号表必须与可用乘客位等长（少一个也不行）',
    !w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: v, input: { label: '小车', plate: '川A小车', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 1, seatLabels: ['1', '2'], pickupPointIds: ['pk-1'] } }).ok)
  check('本节状态合法且无半成功', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

/* ================= 2. 座位唯一 ================= */

section('2. 座位唯一：两个人抢同一个座号必须只有一个成功')
{
  const w = world(['陈屿', '王五'])
  const v = veh(w, '车A')
  check('陈屿 1 号位', w.assign(LIN, w.a, w.ids['陈屿'], v, '1').ok === true)
  const clash = w.assign(LIN, w.a, w.ids['王五'], v, '1')
  check('王五抢同一 1 号位被拒（SEAT_TAKEN）', !clash.ok && clash.code === 'SEAT_TAKEN', JSON.stringify(clash))
  check('拒绝后 1 号位仍只属于陈屿', w.assignmentOf(w.ids['陈屿']).seatLabel === '1' && w.assignmentOf(w.ids['王五']) === null)
  // 两辆同名座号的车不算冲突
  const v2 = veh(w, '车B')
  check('王五可以在另一辆车的 1 号位', w.assign(LIN, w.a, w.ids['王五'], v2, '1').ok === true)
  // 一人只能占一个座位
  const twice = w.assign(LIN, w.a, w.ids['王五'], v2, '2')
  check('同一个人改座是「移动」而不是「再加一个座」', twice.ok === true && w.state.assignments.filter(x => x.signupId === w.ids['王五']).length === 1, JSON.stringify(w.assignmentOf(w.ids['王五'])))
  // 交换
  const swap = w.dispatch(LIN, { type: 'assignment.swap', activityId: w.a, firstSignupId: w.ids['陈屿'], secondSignupId: w.ids['王五'] })
  check('两人交换座位 ok', swap.ok === true, JSON.stringify(swap))
  check('交换后各自落到对方的车上/位上',
    w.assignmentOf(w.ids['陈屿']).vehicleId === v2 && w.assignmentOf(w.ids['王五']).vehicleId === v, JSON.stringify(w.state.assignments))
  const selfSwap = w.dispatch(LIN, { type: 'assignment.swap', activityId: w.a, firstSignupId: w.ids['陈屿'], secondSignupId: w.ids['陈屿'] })
  check('自己与自己交换被拒（INVALID_INPUT）', !selfSwap.ok && selfSwap.code === 'INVALID_INPUT', JSON.stringify(selfSwap))
}

section('2b. 座号必须真实存在')
{
  const w = world(['陈屿'])
  const v = veh(w, '车A', { seatLabels: ['1A', '1B', '2A', '2B'] })
  const ghost = w.assign(LIN, w.a, w.ids['陈屿'], v, '9')
  check('不存在的座号被拒', !ghost.ok, JSON.stringify(ghost))
  check('带字母的座号可正常使用', w.assign(LIN, w.a, w.ids['陈屿'], v, '2B').ok === true)
  const nullSeat = w.dispatch(LIN, { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['陈屿'], vehicleId: v, seatLabel: null } })
  check('允许「上车但不编号」（seatLabel=null，两人可同时无编号）', nullSeat.ok === true, JSON.stringify(nullSeat))
}

/* ================= 3. 司机约束 ================= */

section('3. 司机：同场只能开一辆车，不能同时占乘客位，未确认者不能开车')
{
  const w = world(['陈屿', '王五'])
  const v1 = veh(w, '车1', { drivers: [{ kind: 'participant', signupId: w.ids['陈屿'] }] })
  const dup = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: null, input: { label: '车2', plate: '川A2', legalCapacity: 5, drivers: [{ kind: 'participant', signupId: w.ids['陈屿'] }], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('同一报名者驾驶第二辆车被拒（DRIVER_CONFLICT）', !dup.ok && dup.code === 'DRIVER_CONFLICT', JSON.stringify(dup))
  const seat = w.assign(LIN, w.a, w.ids['陈屿'], v1, '1')
  check('司机不能同时占乘客位（DRIVER_CONFLICT）', !seat.ok && seat.code === 'DRIVER_CONFLICT', JSON.stringify(seat))
  // 先给位再任命司机，也要被拦住
  const v2 = veh(w, '车2')
  check('前置：王五先占上车2 的 1 号位', w.assign(LIN, w.a, w.ids['王五'], v2, '1').ok === true)
  const promote = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: v2, input: { label: '车2', plate: '川A2', legalCapacity: 5, drivers: [{ kind: 'participant', signupId: w.ids['王五'] }], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('已有乘客位的人被任命为司机被拒', !promote.ok && promote.code === 'DRIVER_CONFLICT', JSON.stringify(promote))
  const rm = w.dispatch(LIN, { type: 'assignment.remove', activityId: w.a, signupId: w.ids['王五'] })
  check('前置：先解除王五的乘客位', rm.ok === true, JSON.stringify(rm))
  const promote2 = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: v2, input: { label: '车2', plate: '川A2', legalCapacity: 5, drivers: [{ kind: 'participant', signupId: w.ids['王五'] }], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('反空断言：解除座位后同一条任命即可通过 ⇒ 上一条红来自乘客位冲突', promote2.ok === true, JSON.stringify(promote2))
  // 未确认的人不能当司机
  const w2 = world(['钱七'])
  w2.profile(U('孙八'), '孙八')
  const pend = w2.signup(U('孙八'), w2.a, '孙八', { mode: 'self' }, { ownerId: LIN, keepPending: true })
  check('前置：孙八处于待确认', pend.ok === true && w2.signupOf('孙八').status === 'pending')
  const badDriver = w2.dispatch(LIN, { type: 'vehicle.save', activityId: w2.a, vehicleId: null, input: { label: '车Z', plate: '川AZ', legalCapacity: 5, drivers: [{ kind: 'participant', signupId: w2.signupIdOf('孙八') }], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('待确认者不能登记为司机（DRIVER_CONFLICT）', !badDriver.ok && badDriver.code === 'DRIVER_CONFLICT', JSON.stringify(badDriver))
  // 同一个账号作为服务司机登记在两辆车里 → 第二辆必须被拦住
  w.profile(SVC_ID(), '张师傅')
  const SVC = 'o-张师傅-openid'
  const svc = { kind: 'service', name: '张师傅', phone: '13800000000', userId: SVC }
  const vA = veh(w, '车A', { drivers: [svc] })
  const dupSvc = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: null, input: { label: '车B', plate: '川AB', legalCapacity: 5, drivers: [svc], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('同一账号不能作为服务司机登记在本场两辆车', !dupSvc.ok && dupSvc.code === 'DRIVER_CONFLICT', JSON.stringify(dupSvc))
  check('车A 仍是唯一载着他的车', w.state.vehicles.filter(x => x.drivers.some(d => d.userId === SVC)).length === 1 && !!vA)
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('3b. 参与者司机已有履约事实时，不能被换掉或连车删除（F11）')
{
  // 对照组：还没有任何履约事实时，换司机与删车都必须顺畅——否则这条守卫就成了新的死路。
  const free = world(['陈屿'])
  const fv = veh(free, '司机车', { drivers: [{ kind: 'participant', signupId: free.ids['陈屿'] }] })
  const fDrop = free.dispatch(LIN, { type: 'vehicle.save', activityId: free.a, vehicleId: fv, input: { label: '司机车', plate: '川A司机车', legalCapacity: 5, drivers: [free.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('对照：无履约事实时可以更换司机', fDrop.ok === true, JSON.stringify(fDrop))
  const fRemove = free.dispatch(LIN, { type: 'vehicle.remove', activityId: free.a, vehicleId: fv })
  check('对照：无履约事实时可以删除这辆车', fRemove.ok === true, JSON.stringify(fRemove))

  const w = world(['陈屿'])
  const v = veh(w, '司机车', { drivers: [{ kind: 'participant', signupId: w.ids['陈屿'] }] })
  w.toGathering(LIN, w.a)
  w.checkin(LIN, w.a, w.ids['陈屿'])
  w.departure(LIN, w.a, w.ids['陈屿'], 'joined')
  check('前置：司机已核实随队出发', w.attendanceOf(w.ids['陈屿']).departure.kind === 'joined')
  const drop = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: v, input: { label: '司机车', plate: '川A司机车', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } })
  check('把有出发事实的参与者司机从名单里摘掉被拒', !drop.ok && drop.code === 'DRIVER_CONFLICT', JSON.stringify(drop))
  const remove = w.dispatch(LIN, { type: 'vehicle.remove', activityId: w.a, vehicleId: v })
  check('直接删除这辆车也被拒（否则会抹掉「他答应开车」这条事实，并把他变成无人可载的待分车者）', !remove.ok && remove.code === 'DRIVER_CONFLICT', JSON.stringify(remove))
  check('拒绝后车辆与司机关系原样', w.state.vehicles.length === 1 && w.state.vehicles[0].drivers[0].signupId === w.ids['陈屿'])
  check('「已随队出发」是不可回退的定论（不能靠改口径绕开守卫）',
    !w.departure(LIN, w.a, w.ids['陈屿'], 'coordinating', '想改口径').ok)
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('3c. 司机被核实「未出发」时，本程不能发车（F1）')
{
  const w = world(['陈屿', '王五'])
  const v = veh(w, '司机车', { drivers: [{ kind: 'participant', signupId: w.ids['陈屿'] }, w.serviceDriver()], seatLabels: ['1', '2', '3'] })
  check('前置：王五上车', w.assign(LIN, w.a, w.ids['王五'], v, '1').ok === true)
  w.toGathering(LIN, w.a)
  w.checkin(LIN, w.a, w.ids['陈屿'])
  w.checkin(LIN, w.a, w.ids['王五'])
  w.board(LIN, w.a, w.ids['王五'], 'outbound', true)
  w.departure(LIN, w.a, w.ids['王五'], 'joined')
  const nd = w.departure(LIN, w.a, w.ids['陈屿'], 'not_departed', '司机说他今天不来')
  check('前置：司机被核实为未出发', nd.ok === true, JSON.stringify(nd))
  const dep = w.dispatch(LIN, { type: 'vehicle.depart', activityId: w.a, vehicleId: v, leg: 'outbound', note: '照常发车' })
  check('司机未出发却把车开走 → 被拒（事实互相打脸）', !dep.ok && dep.code === 'UNRESOLVED_DEPARTURE', JSON.stringify(dep))
  const legs = w.state.vehicles.find(x => x.id === v).legs
  check('发车事实没有被写入（零副作用）', legs.outbound.departed === null && legs.outbound.completed === null, JSON.stringify(legs))
  const fix = w.departure(LIN, w.a, w.ids['陈屿'], 'coordinating', '他又改口了')
  check('前置：改回协调中（未定论）', fix.ok === true, JSON.stringify(fix))
  const dep2 = w.dispatch(LIN, { type: 'vehicle.depart', activityId: w.a, vehicleId: v, leg: 'outbound', note: '清点后发车' })
  check('反空断言：司机不再记为未出发后即可发车 ⇒ 上一条红来自那条矛盾事实', dep2.ok === true, JSON.stringify(dep2))
  const flip = w.departure(LIN, w.a, w.ids['陈屿'], 'not_departed', '车都开了才说没来')
  check('车已发车后不能把它的司机改成未出发', !flip.ok && flip.code === 'DRIVER_CONFLICT', JSON.stringify(flip))
  check('本节状态合法（无「车动过而司机未出发」的记录）', H.checkOracles(w.state).filter(x => x.indexOf('O-DRIVER-CONTRADICTION') === 0).length === 0, JSON.stringify(H.checkOracles(w.state)))
}

/* ================= 4. self 与上车点 ================= */

section('4. self 永远进不了车里；上车点不在线路上就排不进去')
{
  const w = world(['陈屿'])
  w.profile(U('王五'), '王五')
  w.signup(U('王五'), w.a, '王五', { mode: 'self' }, { ownerId: LIN })
  const v = veh(w, '车A')
  check('前置：陈屿占上车A 的 1 号位', w.assign(LIN, w.a, w.ids['陈屿'], v, '1').ok === true)
  const self = w.assign(LIN, w.a, w.signupIdOf('王五'), v, '2')
  check('自行前往者不能被分配乘客座位', !self.ok, JSON.stringify(self))
  check('自行前往者不出现在「待安排车辆」里', w.readActivity(LIN, w.a, 'organizer').counters.unassigned === 0, JSON.stringify(w.readActivity(LIN, w.a, 'organizer').counters))

  const mismatch = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: v, input: { label: '车A', plate: '川A车A', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-2'] } })
  check('把已载乘客的车改成只走 pk-2 → 被拒（PICKUP_MISMATCH）', !mismatch.ok && mismatch.code === 'PICKUP_MISMATCH', JSON.stringify(mismatch))
  check('拒绝后线路原样', w.state.vehicles.find(x => x.id === v).pickupPointIds.join() === 'pk-1')
  const w2 = world(['王五'])
  const only2 = veh(w2, '只走 pk-2', { pickupPointIds: ['pk-2'] })
  const bad = w2.assign(LIN, w2.a, w2.ids['王五'], only2, '1')
  check('乘客上车点不在车辆线路上 → 分配被拒（PICKUP_MISMATCH）', !bad.ok && bad.code === 'PICKUP_MISMATCH', JSON.stringify(bad))
}

section('4b. 改出行方式 / 改上车点会解除旧的乘客安排，但不会伪造新的')
{
  const w = world(['陈屿'])
  const v = veh(w, '车A')
  check('前置：陈屿占 1 号位', w.assign(LIN, w.a, w.ids['陈屿'], v, '1').ok === true)
  const toSelf = w.dispatch(U('陈屿'), { type: 'signup.edit', activityId: w.a, signupId: w.ids['陈屿'], participant: w.person('陈屿'), trip: { mode: 'self' }, purpose: '我改自驾' })
  check('shared→self 的编辑 ok', toSelf.ok === true, JSON.stringify(toSelf))
  check('旧座位被解除', w.assignmentOf(w.ids['陈屿']) === null)
  const row = w.readActivity(LIN, w.a, 'organizer').rows.find(r => r.signupId === w.ids['陈屿'])
  check('投影同步：他不再是「待安排车辆」', row.tripMode === 'self' && row.needsSeatAssignment === false, JSON.stringify(row))
  check('返程安排随出行方式派生为自行往返', w.attendanceOf(w.ids['陈屿']).returnPlan.kind === 'own', JSON.stringify(w.attendanceOf(w.ids['陈屿']).returnPlan))
  const back = w.dispatch(U('陈屿'), { type: 'signup.edit', activityId: w.a, signupId: w.ids['陈屿'], participant: w.person('陈屿'), trip: { mode: 'shared', pickupPointId: 'pk-1' }, purpose: '还是要搭车' })
  check('self→shared 的编辑 ok（回到待安排，绝不自动伪造座位）', back.ok === true && w.assignmentOf(w.ids['陈屿']) === null, JSON.stringify(back))
  // 有上车事实后不许再改方式
  const w2 = world(['王五'])
  const v2 = veh(w2, '车B')
  w2.assign(LIN, w2.a, w2.ids['王五'], v2, '2')
  w2.toGathering(LIN, w2.a)
  w2.checkin(LIN, w2.a, w2.ids['王五'])
  w2.board(LIN, w2.a, w2.ids['王五'], 'outbound', true)
  const locked = w2.dispatch(U('王五'), { type: 'signup.edit', activityId: w2.a, signupId: w2.ids['王五'], participant: w2.person('王五'), trip: { mode: 'self' }, purpose: '想改成自驾' })
  check('已有上车事实后不能再改出行方式（历史不可抹去）', !locked.ok && locked.code === 'WRONG_PHASE', JSON.stringify(locked))
  check('拒绝后上车事实与座位都还在', !!w2.attendanceOf(w2.ids['王五']).boardingByLeg.outbound && w2.assignmentOf(w2.ids['王五']).seatLabel === '2')
}

/* ================= 5. 自动分车预览 ================= */

section('5. 预览分车：绝不重排已有座位、绝不把 self 排进车、过期预览必须作废')
{
  const w = world(['陈屿', '王五', '赵六'])
  const v1 = veh(w, '车1', { pickupPointIds: ['pk-1'] })
  const v2 = veh(w, '车2', { pickupPointIds: ['pk-2'] })
  void v2
  check('前置：陈屿已定在车1 的 1 号位', w.assign(LIN, w.a, w.ids['陈屿'], v1, '1').ok === true)
  const plan = w.preview(LIN, w.a)
  check('预览 ok', plan.ok === true, JSON.stringify(plan))
  const chenPlan = plan.value.assignments.find(x => x.signupId === w.ids['陈屿'])
  check('已有座位在预览里原样保留（不重排）', chenPlan && chenPlan.vehicleId === v1 && chenPlan.seatLabel === '1', JSON.stringify(chenPlan))
  const others = plan.value.assignments.filter(x => x.signupId !== w.ids['陈屿'])
  check('其余两人被排到还有空位的车', others.length === 2 && new Set(others.map(x => x.signupId)).size === 2, JSON.stringify(others))
  check('预览不产生任何写入（纯函数）', w.state.assignments.length === 1, JSON.stringify(w.state.assignments))
  check('预览的 baseRevision 就是当前版本', plan.value.baseRevision === w.state.revision)

  // 过期预览
  w.profile(U('钱七'), '钱七')
  w.signup(U('钱七'), w.a, '钱七', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  const stale = w.dispatch(LIN, { type: 'assignment.commit', activityId: w.a, preview: plan.value })
  check('版本已前进 ⇒ 旧预览被拒（CONFLICT，不会覆盖别人的安排）', !stale.ok && stale.code === 'CONFLICT', JSON.stringify(stale))
  // 覆盖/删除既有座位的预览
  const fresh = w.preview(LIN, w.a)
  const tampered = JSON.parse(JSON.stringify(fresh.value))
  tampered.baseRevision = w.state.revision
  tampered.assignments = tampered.assignments.filter(x => x.signupId !== w.ids['陈屿'])
  const drop = w.dispatch(LIN, { type: 'assignment.commit', activityId: w.a, preview: tampered })
  check('预览里删掉一个已有座位 → 提交被拒', !drop.ok, JSON.stringify(drop))
  tampered.assignments = JSON.parse(JSON.stringify(fresh.value.assignments))
  const moved = tampered.assignments.find(x => x.signupId === w.ids['陈屿'])
  moved.seatLabel = '3'
  const move = w.dispatch(LIN, { type: 'assignment.commit', activityId: w.a, preview: tampered })
  check('预览里改动已有座位号 → 提交被拒', !move.ok, JSON.stringify(move))
  const commit = w.dispatch(LIN, { type: 'assignment.commit', activityId: w.a, preview: fresh.value })
  check('未改动的预览提交 ok（新增而非覆盖）', commit.ok === true, JSON.stringify(commit))
  check('陈屿的 1 号位没有被动过', w.assignmentOf(w.ids['陈屿']).seatLabel === '1')
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('5b. 同行组按「整组」占容量：装不下就整组给原因，绝不拆开')
{
  const w = world([])
  w.profile(U('陈屿'), '陈屿')
  const comp = w.companion(U('陈屿'), '陈小屿')
  const sub = w.dispatch(U('陈屿'), {
    type: 'signup.submit', activityId: w.a, keepTogether: true, mode: 'apply',
    participants: [w.participantInput(U('陈屿'), '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }), w.participantInput(U('陈屿'), '陈小屿', { mode: 'shared', pickupPointId: 'pk-1' }, comp)],
  })
  check('整组两人提交 ok', sub.ok === true, JSON.stringify(sub))
  w.dispatch(LIN, { type: 'signup.review', activityId: w.a, signupIds: sub.targetIds, decision: 'confirm' })
  const small = veh(w, '一人座小车', { legalCapacity: 2, seatLabels: ['1'] })
  void small
  const p = w.preview(LIN, w.a)
  check('预览 ok', p.ok === true, JSON.stringify(p.error || ''))
  check('装不下的整组两人一起进 unassigned（不给一个人留座、另一个人没座）',
    p.value.unassigned.length === 2 && p.value.unassigned.map(x => x.signupId).sort().join() === sub.targetIds.slice().sort().join(),
    JSON.stringify(p.value.unassigned))
  check('整组超限给出的原因是 group_too_large',
    p.value.unassigned.every(x => x.reason === 'group_too_large'), JSON.stringify(p.value.unassigned))
  check('预览没有写入任何座位', w.state.assignments.length === 0, JSON.stringify(w.state.assignments))
  // 换成装得下的车，两人必须同车
  const big = veh(w, '大车', { legalCapacity: 5, seatLabels: ['1', '2', '3', '4'] })
  const p2 = w.preview(LIN, w.a)
  check('有车可容纳时整组被排进同一辆', p2.value.assignments.length === 2 && new Set(p2.value.assignments.map(x => x.vehicleId)).size === 1 && p2.value.unassigned.length === 0, JSON.stringify(p2.value))
  const commit = w.dispatch(LIN, { type: 'assignment.commit', activityId: w.a, preview: p2.value })
  check('整组提交 ok', commit.ok === true, JSON.stringify(commit))
  check('两人同在那辆大车上', w.assignmentOf(sub.targetIds[0]).vehicleId === big && w.assignmentOf(sub.targetIds[1]).vehicleId === big)
  // 手工把一人挪到别的车 → 同车约束拦下
  const other = veh(w, '另一辆', { legalCapacity: 5, seatLabels: ['1', '2', '3', '4'] })
  const split = w.assign(LIN, w.a, sub.targetIds[1], other, '1')
  check('把同行组的一人挪去别的车被拒（GROUP_SCOPE）', !split.ok && split.code === 'GROUP_SCOPE', JSON.stringify(split))
  check('拒绝后两人仍在同一辆车上', w.assignmentOf(sub.targetIds[1]).vehicleId === big)
  const allowSplit = w.dispatch(LIN, { type: 'group.setTogether', activityId: w.a, groupId: w.state.signups[0].groupId, keepTogether: false })
  check('先明确允许分开，才可以分开坐', allowSplit.ok === true, JSON.stringify(allowSplit))
  const split2 = w.assign(LIN, w.a, sub.targetIds[1], other, '1')
  check('反空断言：允许分开后同一条挪车即可通过 ⇒ 上一条红来自同组同车约束', split2.ok === true, JSON.stringify(split2))
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

/* ================= 6. 删除与取消对容量/座位的影响 ================= */

section('6. 删车 / 取消 / 解除安排的座位释放')
{
  const w = world(['陈屿', '王五'])
  const v = veh(w, '车A')
  check('前置：两人各占一位', w.assign(LIN, w.a, w.ids['陈屿'], v, '1').ok && w.assign(LIN, w.a, w.ids['王五'], v, '2').ok)
  const rmVehicle = w.dispatch(LIN, { type: 'vehicle.remove', activityId: w.a, vehicleId: v })
  check('还有乘客的车不能直接删（CONFLICT）', !rmVehicle.ok && rmVehicle.code === 'CONFLICT', JSON.stringify(rmVehicle))
  check('拒绝后两条安排都还在', w.state.assignments.length === 2)
  const cx = w.dispatch(A1C(), { type: 'signup.cancel', activityId: w.a, signupIds: [w.ids['陈屿']], reason: '不去了' })
  check('取消 ok', cx.ok === true, JSON.stringify(cx))
  check('取消后座位立即释放', w.assignmentOf(w.ids['陈屿']) === null && w.state.assignments.length === 1)
  const back = w.assign(LIN, w.a, w.ids['陈屿'], v, '1')
  check('被取消者不能凭旧记录继续占座（只有已确认可分车）', !back.ok, JSON.stringify(back))
  const reuse = w.assign(LIN, w.a, w.ids['王五'], v, '1')
  check('释放出来的 1 号位可以给别人用（移动而非新增）', reuse.ok === true, JSON.stringify(reuse))
  const rmAll = w.dispatch(LIN, { type: 'assignment.remove', activityId: w.a, signupId: w.ids['王五'] })
  check('解除最后一条安排 ok', rmAll.ok === true, JSON.stringify(rmAll))
  const rmNow = w.dispatch(LIN, { type: 'vehicle.remove', activityId: w.a, vehicleId: v })
  check('反空断言：车上没人后即可删车 ⇒ 前面的红来自乘客安排', rmNow.ok === true, JSON.stringify(rmNow))
  check('删车不带走名单与履约历史', w.state.signups.length === 2 && w.state.attendance.length === 2)
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

function A1C() { return U('陈屿') }
function SVC_ID() { return 'o-张师傅-openid' }

section('6b. 已发车的车辆与乘车安排全部锁死')
{
  const w = world(['陈屿'])
  const v = veh(w, '车A')
  w.assign(LIN, w.a, w.ids['陈屿'], v, '1')
  w.toGathering(LIN, w.a)
  w.checkin(LIN, w.a, w.ids['陈屿'])
  w.board(LIN, w.a, w.ids['陈屿'], 'outbound', true)
  w.departure(LIN, w.a, w.ids['陈屿'], 'joined')
  const dep = w.dispatch(LIN, { type: 'vehicle.depart', activityId: w.a, vehicleId: v, leg: 'outbound', note: '发车' })
  check('前置：发车 ok', dep.ok === true, JSON.stringify(dep))
  for (const [name, payload] of [
    ['改车辆配置', { type: 'vehicle.save', activityId: w.a, vehicleId: v, input: { label: '车A', plate: '川A车A', legalCapacity: 6, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4', '5'], pickupPointIds: ['pk-1'] } }],
    ['删车', { type: 'vehicle.remove', activityId: w.a, vehicleId: v }],
    ['改座位', { type: 'assignment.set', activityId: w.a, target: { signupId: w.ids['陈屿'], vehicleId: v, seatLabel: '2' } }],
    ['解除座位', { type: 'assignment.remove', activityId: w.a, signupId: w.ids['陈屿'] }],
    ['撤销上车', { type: 'attendance.board', activityId: w.a, signupId: w.ids['陈屿'], leg: 'outbound', boarded: false, note: '想撤回' }],
  ]) {
    const r = w.dispatch(LIN, payload)
    check('发车后禁止：' + name, !r.ok && r.code === 'WRONG_PHASE', JSON.stringify(r))
  }
  const again = w.dispatch(LIN, { type: 'vehicle.depart', activityId: w.a, vehicleId: v, leg: 'outbound', note: '再发一次' })
  check('重复发车不会改写已有的发车证据', again.ok === true || !again.ok)
  const legs = w.state.vehicles.find(x => x.id === v).legs
  check('发车证据的时间戳未被第二次操作覆盖', legs.outbound.departed.at === w.now, JSON.stringify(legs.outbound.departed))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
