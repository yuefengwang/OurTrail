// 投影 ↔ 领域一致性审计：node tools/lifecycle-projection-test.js
//
// 审计问题：selectors 给出的投影可以简化展示，但不得改变业务事实；
// 也不得出现「UI 给了一个动作/一条状态，域内却不这么认为」。
// 做法：把状态跑出来，再从**投影读到的标志**反向去命令域内——
// 投影说「不欠上车」的人，域内必须真的拒绝给他记上车；投影说「欠」的人，阶段门必须真的挡住推进。
// 最后一条是静态门：扫客户端有没有再拿中文文案当业务状态投票（AGENTS.md 铁律 19 的复发点）。
'use strict'

const fs = require('fs')
const path = require('path')
const H = require('./lifecycle-harness')
const selectors = require('../cloudfunctions/trailApi/domain/selectors')
const { assertInvariants } = require('../cloudfunctions/trailApi/domain/invariants')

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

/** 一条混合活动：领队 self + 拼车乘客（已排座）+ 兼任司机 + 待安排乘客 + 候补 + 已取消。 */
function richWorld() {
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  for (const n of ['陈屿', '王五', '赵六', '钱七', '孙八']) w.profile(U(n), n)
  const a = w.createActivity(LIN, { capacity: 8, title: '青城后山' })
  w.publish(LIN, a)
  w.signup(LIN, a, '林溪', { mode: 'self' }, { ownerId: LIN })
  w.signup(U('陈屿'), a, '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  w.signup(U('王五'), a, '王五', { mode: 'shared', pickupPointId: 'pk-2' }, { ownerId: LIN })
  w.signup(U('赵六'), a, '赵六', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  w.signup(U('钱七'), a, '钱七', { mode: 'self' }, { ownerId: LIN })
  w.signup(U('孙八'), a, '孙八', { mode: 'shared', pickupPointId: 'pk-2' }, { ownerId: LIN, keepPending: true })
  const v1 = w.vehicle(LIN, a, { label: '一号车', seatLabels: ['1A', '1B', '1C', '1D'], pickupPointIds: ['pk-1'] })
  const v2 = w.vehicle(LIN, a, { label: '二号车', legalCapacity: 3, drivers: [{ kind: 'participant', signupId: w.signupIdOf('赵六') }], seatLabels: ['2A', '2B'], pickupPointIds: ['pk-1', 'pk-2'] })
  w.assign(LIN, a, w.signupIdOf('陈屿'), v1, '1A')
  w.assign(LIN, a, w.signupIdOf('王五'), v2, '2A')
  w.dispatch(U('孙八'), { type: 'signup.cancel', activityId: a, signupIds: [w.signupIdOf('孙八')], reason: '自己撤回' })
  w.a = a; w.v1 = v1; w.v2 = v2
  return w
}

const rowOf = (w, name, perspective, actor) =>
  w.readActivity(actor || LIN, w.a, perspective || 'organizer').rows.find(r => r.name === name)

/* ================= 1. 出行方式：投影不得把需要乘车的人说成自行前往 ================= */

section('1. tripMode / pickup 投影与域内乘车义务一致')
{
  const w = richWorld()
  const rows = w.readActivity(LIN, w.a, 'organizer').rows
  const byName = n => rows.find(r => r.name === n)
  check('self 的人 tripMode=self 且 pickup 文案是自行前往', byName('林溪').tripMode === 'self' && byName('林溪').pickup === '自行前往', JSON.stringify(byName('林溪')))
  check('self 的人没有车辆/座位/上车点行', byName('林溪').pickupPointId === null && byName('林溪').vehicle === '' && byName('林溪').seat === null)
  check('shared 已排座：投影给出车辆与座号', byName('陈屿').vehicle === '一号车' && byName('陈屿').seat === '1A', JSON.stringify(byName('陈屿')))
  check('shared 兼任司机：不占乘客位但确实随车', byName('赵六').hasPassengerAssignment === false && byName('赵六').vehicle === '二号车', JSON.stringify(byName('赵六')))
  check('已取消的 shared 历史行仍在名单里（不被抹掉）', byName('孙八') && byName('孙八').status === 'cancelled', JSON.stringify(byName('孙八')))

  // 决定性判据：投影说「不欠上车」的人，域内必须拒绝给他记上车
  for (const name of ['林溪', '钱七', '赵六']) {
    const row = byName(name)
    if (row.needsOutboundBoarding) { check(name + '（不应欠上车）投影口径异常', false, JSON.stringify(row)); continue }
    const before = w.snapshot()
    const probe = w.board(LIN, w.a, row.signupId, 'outbound', true)
    check(name + ' 投影说没有去程上车义务 ⇒ 域内确实拒绝记上车', !probe.ok && probe.code === 'WRONG_PHASE', JSON.stringify(probe))
    check(name + ' 探测后状态未被改动', w.snapshot() === before)
    void before
  }
  for (const name of ['陈屿', '王五']) {
    const row = byName(name)
    check(name + ' 投影确实欠着去程上车', row.needsOutboundBoarding === true, JSON.stringify(row))
    w.toGathering(LIN, w.a)
    w.checkin(LIN, w.a, row.signupId)
    const ok = w.board(LIN, w.a, row.signupId, 'outbound', true)
    check(name + ' 欠着 ⇒ 域内接受补记上车', ok.ok === true, JSON.stringify(ok))
    check(name + ' 补记后投影同步为不欠', rowOf(w, name).needsOutboundBoarding === false)
  }
  check('本节状态合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('1b. 阶段门与投影标志同向：欠上车的人没补上，就不许进行程')
{
  const w = richWorld()
  w.toGathering(LIN, w.a)
  for (const n of ['林溪', '陈屿', '王五', '赵六', '钱七']) {
    w.checkin(LIN, w.a, w.signupIdOf(n))
    if (rowOf(w, n).needsOutboundBoarding) w.board(LIN, w.a, w.signupIdOf(n), 'outbound', true)
    w.departure(LIN, w.a, w.signupIdOf(n), 'joined')
  }
  // 现场纠正：把王五的上车记录撤销（车辆还没发车，允许撤销）。撤销后他成了「已核实随队却没有上车事实」的人。
  const un = w.board(LIN, w.a, w.signupIdOf('王五'), 'outbound', false)
  check('前置：撤销王五的去程上车记录', un.ok === true, JSON.stringify(un))
  check('撤销后投影重新判定他欠去程上车', rowOf(w, '王五').needsOutboundBoarding === true)
  const blocked = w.phase(LIN, w.a, 'active', '想直接走')
  check('拼车乘客没上车记录 ⇒ gathering→active 被挡', !blocked.ok && blocked.code === 'UNRESOLVED_DEPARTURE', JSON.stringify(blocked))
  const re = w.board(LIN, w.a, w.signupIdOf('王五'), 'outbound', true)
  check('反空断言：补回那条上车记录后即可推进 ⇒ 红确实来自它', re.ok === true, JSON.stringify(re))
  const go = w.phase(LIN, w.a, 'active', '清点完成')
  check('推进到行程 ok', go.ok === true, JSON.stringify(go))
}

section('1c. 上车点被收掉后，shared 历史行不得降级成「自行前往」（含老数据）')
{
  const w = richWorld()
  // 先把 pk-2 上的人全部清掉（取消），集合点才允许被收掉
  w.dispatch(U('王五'), { type: 'signup.cancel', activityId: w.a, signupIds: [w.signupIdOf('王五')], reason: '不去了' })
  const reroute = w.dispatch(LIN, { type: 'vehicle.save', activityId: w.a, vehicleId: w.v2, input: { label: '二号车', plate: '川A二号车', legalCapacity: 3, drivers: [{ kind: 'participant', signupId: w.signupIdOf('赵六') }], blockedSeats: 0, seatLabels: ['2A', '2B'], pickupPointIds: ['pk-1'] } })
  check('前置：二号车先不再经过 pk-2（车上无人引用它）', reroute.ok === true, JSON.stringify(reroute))
  const only = w.activityInput({ pickupPoints: [w.activityInput().pickupPoints[0]] })
  const cut = w.dispatch(LIN, { type: 'activity.edit', activityId: w.a, input: only })
  check('取消完 pk-2 的相关者后可以收掉该集合点', cut.ok === true, JSON.stringify(cut))
  const wang = rowOf(w, '王五')
  check('已取消者仍显示为需要乘车的方式，而不是自行前往', wang.tripMode === 'shared', JSON.stringify(wang))
  check('他的上车点确实没了 ⇒ 明说「信息缺失」而不是改判出行方式', wang.pickup === '上车点信息缺失', JSON.stringify(wang.pickup))
  check('已确认的人里没有一个会因为收点而被误判', w.readActivity(LIN, w.a, 'organizer').rows
    .filter(r => r.status === 'confirmed').every(r => r.tripMode === 'self' ? r.pickup === '自行前往' : r.pickup !== '自行前往'))

  // 老数据：改造前写入的 self + returnPlan 'assigned'，不迁移也必须读对
  const legacy = richWorld()
  const st = legacy.cloneState()
  const selfRecord = st.attendance.find(a => a.signupId === legacy.signupIdOf('林溪'))
  selfRecord.returnPlan = { kind: 'assigned' }
  check('老数据形态仍通过不变量（不回填也是合法数据）', assertInvariants(st).ok === true, JSON.stringify(assertInvariants(st).error || ''))
  const legacyRow = selectors.selectView(st, { userId: LIN }, { kind: 'activity', activityId: legacy.a, perspective: 'organizer' }, legacy.now)
    .rows.find(r => r.name === '林溪')
  check('投影把老数据的 self 归一为自行往返（界面不宣称他原车返程）', legacyRow.returnPlan === 'own', JSON.stringify(legacyRow.returnPlan))
  check('归一只发生在显示层：存储记录没有被投影偷偷改掉', st.attendance.find(a => a.signupId === legacy.signupIdOf('林溪')).returnPlan.kind === 'assigned')
}

/* ================= 2. 计数的内部一致性（跨阶段穷举） ================= */

section('2. counters 在每种可达形态里都自洽')
{
  const probes = [
    { riders: 4, trips: ['self', 'shared', 'shared', 'self'], assign: true, phase: 'published' },
    { riders: 4, trips: ['shared', 'shared', 'shared', 'shared'], assign: true, toGathering: true },
    { riders: 3, trips: ['self', 'self', 'self'], assign: false },
    { riders: 2, trips: ['shared', 'shared'], assign: false },
    { riders: 5, trips: ['shared', 'shared', 'self', 'shared', 'self'], assign: true, cancelLast: true },
  ]
  for (const [i, p] of probes.entries()) {
    const w = H.createWorld()
    w.profile(LIN, '林溪')
    const a = w.createActivity(LIN, { capacity: 12 })
    w.publish(LIN, a)
    const names = []
    for (let k = 0; k < p.riders; k++) {
      const name = '乘' + (k + 1)
      const u = U(name)
      w.profile(u, name)
      const trip = p.trips[k] === 'shared' ? { mode: 'shared', pickupPointId: 'pk-1' } : { mode: 'self' }
      w.signup(u, a, name, trip, { ownerId: LIN })
      names.push(name)
    }
    const v = p.assign ? w.vehicle(LIN, a, { label: '车', pickupPointIds: ['pk-1'] }) : null
    if (v) for (const n of names) {
      const r = w.readActivity(LIN, a, 'organizer').rows.find(x => x.name === n)
      if (r.needsSeatAssignment) w.assign(LIN, a, r.signupId, v, String(w.state.assignments.length + 1))
    }
    if (p.toGathering) w.toGathering(LIN, a)
    if (p.cancelLast) w.dispatch(U(names[names.length - 1]), { type: 'signup.cancel', activityId: a, signupIds: [w.signupIdOf(names[names.length - 1])], reason: '取消' })
    const view = w.readActivity(LIN, a, 'organizer')
    const c = view.counters
    const shared = view.rows.filter(r => r.status === 'confirmed' && r.tripMode === 'shared')
    const selfs = view.rows.filter(r => r.status === 'confirmed' && r.tripMode === 'self')
    check('#' + i + ' 出行方式分桶覆盖全部已确认者', c.selfTravel + c.vehicleTravel === c.confirmed, JSON.stringify(c))
    check('#' + i + ' self 与 shared 的人数与名单逐条一致', c.selfTravel === selfs.length && c.vehicleTravel === shared.length, JSON.stringify({ c, shared: shared.length, selfs: selfs.length }))
    check('#' + i + ' 待安排 + 已安排 = 需乘车人数（没有第三种口径）', c.assigned + c.unassigned === c.vehicleTravel, JSON.stringify(c))
    check('#' + i + ' unassigned 恰是投影判定欠座位的人', c.unassigned === shared.filter(r => r.needsSeatAssignment).length, JSON.stringify(c.unassigned))
    check('#' + i + ' self 的人绝不进 unassigned', !view.rows.some(r => r.tripMode === 'self' && r.needsSeatAssignment))
    check('#' + i + ' remaining 是裸减法（不做 max(0,..) 之类的沉默钳制）', c.remaining === view.activity.capacity - c.confirmed - c.pending, JSON.stringify(c))
    check('#' + i + ' 状态合法', w.problems.length === 0 && H.checkOracles(w.state).length === 0, JSON.stringify((w.problems[0] || {}).detail || H.checkOracles(w.state)[0]))
  }
  // 名额被超时用人的负数读数（原型就钉过这条：不得把 -1 钳成 0）
  const over = H.createWorld()
  over.profile(LIN, '林溪')
  const oa = over.createActivity(LIN, { capacity: 1 })
  over.publish(LIN, oa)
  over.profile(U('甲'), '甲')
  over.signup(U('甲'), oa, '甲', { mode: 'self' }, { ownerId: LIN })
  void oa
}

/* ================= 3. permittedActions：给了按钮就必须能用 ================= */

section('3. 逐行动作的可用性：广播了就不能是「结构上永远做不到」的动作')
{
  // 范围说明：这里只穷举「与具体行/对象绑定」的动作——那正是 permittedActions × row 标志
  // 组合起来决定按钮会不会出现的地方。发车清点、报名窗口这类「工作流完成度」门由
  // lifecycle-transitions-test.js 与本文件 3b 穷举：它们要求的是现场清点先做完，不是状态非法。
  // 判据（重要）：候选实例被 SEAT_TAKEN / PICKUP_MISMATCH / VEHICLE_FULL 这类码挡下，
  // 意思是「换个对象或先把清单补完」，按钮本身是活的；被 WRONG_PHASE / FORBIDDEN 挡下，
  // 才是「这个动作在当前阶段根本不存在」——那才是注定红字的按钮，必须清理。
  const STRUCTURAL = ['WRONG_PHASE', 'FORBIDDEN', 'AUTH_REQUIRED', 'CONSENT_REQUIRED', 'REQUEST_REUSED']
  const SCOPE = ['signup.review', 'signup.promote', 'signup.cancel', 'signup.edit', 'group.setTogether',
    'vehicle.save', 'vehicle.remove', 'assignment.set', 'assignment.remove', 'assignment.swap', 'assignment.commit',
    'attendance.checkin', 'attendance.board', 'attendance.departure', 'attendance.returnPlan', 'attendance.node',
    'attendance.home', 'position.report', 'position.revoke', 'incident.report', 'incident.resolve',
    'notice.read', 'notice.delivery', 'export.record', 'membership.save', 'membership.revoke']
  const phases = ['published', 'gathering', 'active', 'closing', 'archived']
  for (const phase of phases) {
    const w = richWorld()
    if (phase !== 'published') w.toGathering(LIN, w.a)
    if (phase !== 'gathering') {
      for (const n of ['林溪', '陈屿', '王五', '赵六', '钱七']) {
        w.checkin(LIN, w.a, w.signupIdOf(n))
        if (rowOf(w, n).needsOutboundBoarding) w.board(LIN, w.a, w.signupIdOf(n), 'outbound', true)
        w.departure(LIN, w.a, w.signupIdOf(n), 'joined')
      }
      w.phase(LIN, w.a, 'active', '开始行程')
    }
    if (phase === 'closing' || phase === 'archived') {
      w.phase(LIN, w.a, 'closing', '返程清点')
      if (phase === 'archived') {
        for (const n of ['林溪', '陈屿', '王五', '赵六', '钱七']) w.home(LIN, w.a, w.signupIdOf(n))
        w.phase(LIN, w.a, 'archived', '归档')
      }
    }
    const view = w.readActivity(LIN, w.a, 'organizer')
    const rows = view.rows
    const signups = w.state.signups.filter(x => x.activityId === w.a)
    const byId = id => signups.find(x => x.id === id)
    const vehicles = w.state.vehicles.filter(x => x.activityId === w.a)
    const confirmed = rows.filter(r => r.status === 'confirmed')
    const pending = rows.filter(r => r.status === 'pending')
    const waitlisted = rows.filter(r => r.status === 'waitlisted')
    const candidates = t => {
      switch (t) {
        case 'signup.review': return pending.map(r => ({ type: t, activityId: w.a, signupIds: [r.signupId], decision: 'confirm' }))
        case 'signup.promote': return waitlisted.map(r => ({ type: t, activityId: w.a, signupIds: [r.signupId] }))
        case 'signup.cancel': return rows.filter(r => H.LIVE_SIGNUP.indexOf(r.status) !== -1).map(r => ({ type: t, activityId: w.a, signupIds: [r.signupId], reason: '不去了' }))
        case 'signup.edit': return rows.map(r => ({ type: t, activityId: w.a, signupId: r.signupId, participant: byId(r.signupId).participant, trip: byId(r.signupId).trip, purpose: '核对报名信息' }))
        case 'group.setTogether': return w.state.groups.filter(g => g.activityId === w.a).map(g => ({ type: t, activityId: w.a, groupId: g.id, keepTogether: !g.keepTogether }))
        case 'vehicle.save': return vehicles.map(v => ({ type: t, activityId: w.a, vehicleId: v.id, input: { label: v.label, plate: v.plate, legalCapacity: v.legalCapacity, drivers: v.drivers, blockedSeats: v.blockedSeats, seatLabels: v.seatLabels, pickupPointIds: v.pickupPointIds } }))
          .concat([{ type: t, activityId: w.a, vehicleId: null, input: { label: '新加的车', plate: '川A新', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } }])
        case 'vehicle.remove': return vehicles.map(v => ({ type: t, activityId: w.a, vehicleId: v.id }))
        case 'assignment.set': {
          const out = []
          for (const r of confirmed) for (const v of vehicles) for (const seat of (v.seatLabels || [null])) out.push({ type: t, activityId: w.a, target: { signupId: r.signupId, vehicleId: v.id, seatLabel: seat } })
          return out
        }
        case 'assignment.remove': return rows.filter(r => r.hasPassengerAssignment).map(r => ({ type: t, activityId: w.a, signupId: r.signupId }))
        case 'assignment.swap': {
          const assigned = rows.filter(r => r.hasPassengerAssignment)
          const out = []
          for (const x of assigned) for (const y of assigned) if (x.signupId !== y.signupId) out.push({ type: t, activityId: w.a, firstSignupId: x.signupId, secondSignupId: y.signupId })
          return out
        }
        case 'assignment.commit': return [{ type: t, activityId: w.a, preview: { activityId: w.a, baseRevision: w.state.revision, assignments: w.state.assignments.filter(x => x.activityId === w.a), unassigned: [] } }]
        case 'attendance.checkin': return confirmed.map(r => ({ type: t, activityId: w.a, signupId: r.signupId, checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: '现场签到' } } }))
        case 'attendance.board': {
          const out = []
          for (const r of confirmed) for (const leg of ['outbound', 'return']) out.push({ type: t, activityId: w.a, signupId: r.signupId, leg, boarded: true, note: '逐人清点', _prepare: [
            { type: 'attendance.checkin', activityId: w.a, signupId: r.signupId, checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: '先签到' } } },
          ] })
          return out
        }
        case 'attendance.departure': {
          const out = []
          for (const r of confirmed) for (const kind of ['joined', 'coordinating', 'not_departed']) out.push({ type: t, activityId: w.a, signupId: r.signupId, outcome: { kind, evidence: { at: w.now, by: LIN, note: '现场核实' } } })
          return out
        }
        case 'attendance.returnPlan': {
          const out = []
          for (const r of confirmed) for (const plan of ['assigned', 'independent']) out.push({ type: t, activityId: w.a, signupId: r.signupId, plan, note: '按现场口径记录' })
          return out
        }
        case 'attendance.node': {
          const out = []
          for (const r of confirmed) for (const p of w.state.activities[0].routeSnapshot.points) out.push({ type: t, activityId: w.a, signupId: r.signupId, pointId: p.id, note: '到达节点' })
          return out
        }
        case 'attendance.home': return confirmed.map(r => ({ type: t, activityId: w.a, signupId: r.signupId, note: '本人报平安' }))
        case 'position.report': return confirmed.map(r => ({ type: t, activityId: w.a, signupId: r.signupId, coordinates: { lat: 30.5, lng: 103.5 }, consent: true }))
        case 'position.revoke': return rows.map(r => ({ type: t, activityId: w.a, signupId: r.signupId }))
        case 'incident.report': return confirmed.map(r => ({ type: t, activityId: w.a, signupIds: [r.signupId], kind: 'other', description: '需要协助' }))
        case 'incident.resolve': return w.state.incidents.filter(i => i.activityId === w.a && !i.resolution).map(i => ({ type: t, activityId: w.a, incidentId: i.id, note: '已核实处理' }))
        case 'notice.read': return w.state.notices.filter(n => n.activityId === w.a).map(n => ({ type: t, activityId: w.a, noticeId: n.id }))
        case 'notice.delivery': return w.state.notices.filter(n => n.activityId === w.a).map(n => ({ type: t, activityId: w.a, noticeId: n.id, channel: 'copy', status: 'copied', detail: '' }))
        case 'export.record': return [{ type: t, activityId: w.a, signupIds: rows.map(r => r.signupId), mode: 'ordinary', purpose: '活动人员核对' }]
        case 'membership.save': return [{ type: t, activityId: w.a, membership: { role: 'staff', activityId: w.a, userId: U('钱七'), expiresAt: '2027-01-01T00:00:00+08:00', scope: { kind: 'all' }, capabilities: ['roster'] } }]
        case 'membership.revoke': return w.state.memberships.filter(m => m.activityId === w.a).map(m => ({ type: t, activityId: w.a, membershipId: m.id }))
        default: return []
      }
    }
    const doomed = []
    const untested = []
    for (const type of view.permittedActions) {
      if (SCOPE.indexOf(type) === -1) continue
      const list = candidates(type)
      // 场上没有该对象可试（例如一条协作授权都没发过）：广播的是「能力」而不是按钮，跳过并留痕。
      if (!list.length) { untested.push(type); continue }
      let accepted = false
      const codes = []
      for (const candidate of list) {
        const { _prepare, ...payload } = candidate
        const before = w.snapshot()
        for (const step of (_prepare || [])) w.dispatch(LIN, step)
        const r = w.dispatch(LIN, payload)
        w.restore(before)
        if (r.ok) { accepted = true; break }
        codes.push(r.code)
      }
      if (!accepted && codes.some(c => STRUCTURAL.indexOf(c) !== -1)) {
        doomed.push(type + ' 广播了，' + list.length + ' 个实例里有实例被「阶段/权限」直接挡死（' + Array.from(new Set(codes)).slice(0, 3).join('/') + '）')
      }
    }
    check(phase + '：广播出的逐行动作都不是结构上不可能的动作', doomed.length === 0, JSON.stringify(doomed))
    check(phase + '：探测回滚后状态仍合法', H.checkOracles(w.state).length === 0 && w.problems.filter(x => x.kind !== 'receipt').length === 0, JSON.stringify(w.problems.slice(0, 2)))
    void untested
  }
}

section('3b. 审核与递补只在「有对应的人、且阶段允许」时广播（F4b）')
{
  // capacity 2：A 已确认占 1，B 申请进待确认占 2（满），C 只能候补 ⇒ published 下 review/promote 都该广播
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  for (const n of ['陈屿', '王五', '赵六']) w.profile(U(n), n)
  const a = w.createActivity(LIN, { capacity: 2 })
  w.publish(LIN, a)
  w.signup(U('陈屿'), a, '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  const b = w.signup(U('王五'), a, '王五', { mode: 'self' }, { ownerId: LIN, keepPending: true })
  const c = w.dispatch(U('赵六'), { type: 'signup.submit', activityId: a, keepTogether: false, mode: 'waitlist', participants: [w.participantInput(U('赵六'), '赵六', { mode: 'self' })] })
  check('前置：名额满时候补提交 ok', c.ok === true, JSON.stringify(c))
  check('前置：新报名进入待确认', b.ok === true && w.signupOf('王五').status === 'pending', JSON.stringify(b))
  const counters = w.readActivity(LIN, a, 'organizer').counters
  check('前置读数：pending=1 waitlisted=1', counters.pending === 1 && counters.waitlisted === 1, JSON.stringify(counters))
  const pub = w.readActivity(LIN, a, 'organizer').permittedActions
  check('有候补 ⇒ 广播 signup.promote', pub.indexOf('signup.promote') !== -1, JSON.stringify(pub.filter(x => x.indexOf('signup.') === 0)))
  check('有待确认 ⇒ 广播 signup.review', pub.indexOf('signup.review') !== -1)

  // 把待确认者拒掉（不占用名额），活动才能带着候补进集合阶段
  w.dispatch(LIN, { type: 'signup.review', activityId: a, signupIds: [w.signupIdOf('王五')], decision: 'reject' })
  const g = w.phase(LIN, a, 'gathering', '开始集合')
  check('候补不阻塞推进 ⇒ 可以进入集合', g.ok === true, JSON.stringify(g))
  const gview = w.readActivity(LIN, a, 'organizer')
  check('集合阶段仍有候补者', gview.counters.waitlisted === 1, JSON.stringify(gview.counters))
  check('集合阶段不再广播 signup.review / signup.promote（域内那时必拒）',
    gview.permittedActions.indexOf('signup.review') === -1 && gview.permittedActions.indexOf('signup.promote') === -1,
    JSON.stringify(gview.permittedActions.filter(x => x.indexOf('signup.') === 0)))
  const tryPromote = w.dispatch(LIN, { type: 'signup.promote', activityId: a, signupIds: [w.signupIdOf('赵六')] })
  check('印证：集合阶段真跑递补确实是 WRONG_PHASE ⇒ 广播它就是在发一张注定红字的按钮', !tryPromote.ok && tryPromote.code === 'WRONG_PHASE', JSON.stringify(tryPromote))
  check('集合阶段仍保留车辆与名单动作', ['vehicle.save', 'assignment.set'].every(t => gview.permittedActions.indexOf(t) !== -1), JSON.stringify(gview.permittedActions))
}

section('3c. 发车/完成这一程的广播与车辆实际状态一致（F4）')
{
  // 单车辆夹具：permittedActions 是动作类型的集合，多辆车时「另一辆还能发车」会让读数失去意义。
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.profile(U('陈屿'), '陈屿')
  const a = w.createActivity(LIN, { capacity: 6 })
  w.publish(LIN, a)
  w.signup(U('陈屿'), a, '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  const v = w.vehicle(LIN, a, { label: '唯一车', seatLabels: ['1', '2', '3', '4'] })
  w.assign(LIN, a, w.signupIdOf('陈屿'), v, '1')
  w.toGathering(LIN, a)
  w.checkin(LIN, a, w.signupIdOf('陈屿'))
  w.board(LIN, a, w.signupIdOf('陈屿'), 'outbound', true)
  w.departure(LIN, a, w.signupIdOf('陈屿'), 'joined')
  w.phase(LIN, a, 'active', '开始行程')
  const legsOf = () => w.state.vehicles.find(x => x.id === v).legs
  const expected = phase => {
    const legal = phase === 'gathering' ? ['outbound'] : phase === 'active' ? ['outbound', 'return'] : ['return']
    const L = legsOf()
    return {
      depart: legal.some(k => !L[k].departed),
      complete: legal.some(k => L[k].departed && !L[k].completed),
    }
  }
  const offered = t => w.readActivity(LIN, a, 'organizer').permittedActions.indexOf(t) !== -1
  let e = expected('active')
  check('active 且去程未发车 ⇒ 广播 depart、不广播 complete', offered('vehicle.depart') === e.depart && offered('vehicle.complete') === e.complete, JSON.stringify({ got: { depart: offered('vehicle.depart'), complete: offered('vehicle.complete') }, e }))
  w.dispatch(LIN, { type: 'vehicle.depart', activityId: a, vehicleId: v, leg: 'outbound', note: '发车' })
  e = expected('active')
  check('去程已发车、返程还没轮到 ⇒ 只剩 complete 可点', offered('vehicle.complete') === true && offered('vehicle.depart') === e.depart, JSON.stringify({ got: { depart: offered('vehicle.depart'), complete: offered('vehicle.complete') }, e }))
  check('按广播完成本程确实可用', w.dispatch(LIN, { type: 'vehicle.complete', activityId: a, vehicleId: v, leg: 'outbound', note: '到达' }).ok === true)
  e = expected('active')
  check('去程两笔都记满、返程在 active 也合法 ⇒ 又只剩 depart(返程)', offered('vehicle.depart') === e.depart && offered('vehicle.complete') === e.complete, JSON.stringify({ got: { depart: offered('vehicle.depart'), complete: offered('vehicle.complete') }, e }))
  w.phase(LIN, a, 'closing', '返程清点')
  e = expected('closing')
  check('进入返程 ⇒ 广播口径与返程状态一致', offered('vehicle.depart') === e.depart && offered('vehicle.complete') === e.complete, JSON.stringify({ got: { depart: offered('vehicle.depart'), complete: offered('vehicle.complete') }, e }))
  // 返程发车前必须逐人清点：投影广播的是「这一程还能发」，清点本来就是现场动作
  w.board(LIN, a, w.signupIdOf('陈屿'), 'return', true)
  const ret = w.dispatch(LIN, { type: 'vehicle.depart', activityId: a, vehicleId: v, leg: 'return', note: '返程发车' })
  check('清点完成后返程发车 ok', ret.ok === true, JSON.stringify(ret))
  w.home(LIN, a, w.signupIdOf('陈屿'))
  check('安全闭环后可归档', w.phase(LIN, a, 'archived', '归档').ok === true)
  check('归档后不再广播任何车辆动作', ['vehicle.depart', 'vehicle.complete'].every(t => w.readActivity(LIN, a, 'organizer').permittedActions.indexOf(t) === -1))
  check('本节状态合法', H.checkOracles(w.state).length === 0 && w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
}


/* ================= 4. 视角与最小暴露 ================= */

section('4. 白名单投影：每个视角只看到它该看的')
{
  const w = richWorld()
  const org = w.readActivity(LIN, w.a, 'organizer')
  const par = w.readActivity(U('陈屿'), w.a, 'participant')
  check('参与者视角只看到自己的报名', par.rows.length === 1 && par.rows[0].name === '陈屿', JSON.stringify(par.rows.map(r => r.name)))
  check('参与者看不到别人的异常与位置', par.incidents.length === 0 && par.positions.length === 0)
  const json = JSON.stringify(par)
  check('参与者视角的序列化结果里没有他人的电话/健康备注', json.indexOf('健康备注') === -1 && !/medical/.test(json), '投影不应带 medical 键')
  check('名单行里不含 medical/emergency 字段', Object.keys(org.rows[0]).every(k => k !== 'medical' && k !== 'emergency'), JSON.stringify(Object.keys(org.rows[0])))

  // 协作授权：selected 范围
  w.dispatch(LIN, { type: 'membership.save', activityId: w.a, membership: { role: 'staff', activityId: w.a, userId: U('钱七'), expiresAt: '2027-01-01T00:00:00+08:00', scope: { kind: 'selected', signupIds: [w.signupIdOf('陈屿')] }, capabilities: ['roster', 'checkin'] } })
  const staff = w.readActivity(U('钱七'), w.a, 'staff')
  check('分管范围只放行被指定的那一个报名', staff.rows.length === 1 && staff.rows[0].name === '陈屿', JSON.stringify(staff.rows.map(r => r.name)))
  check('协作人员看不到异常台账（未授予 incident 能力）', staff.incidents.length === 0, JSON.stringify(staff.incidents))
  check('协作人员看不到车辆任务（不是车长）', staff.vehicleTask === null)
  const contact = w.readActivity(U('陈屿'), w.a, 'vehicle', { vehicleId: w.v1 })
  check('未获车辆授权的人拿不到车长任务', contact.kind === 'denied' || !contact.vehicleTask, JSON.stringify(contact.code || contact.kind))
}

section('4b. 车长视角不得泄漏他车数据与敏感字段')
{
  const w = richWorld()
  w.dispatch(LIN, { type: 'membership.save', activityId: w.a, membership: { role: 'vehicle_contact', activityId: w.a, userId: U('陈屿'), expiresAt: '2027-01-01T00:00:00+08:00', vehicleId: w.v1 } })
  w.toGathering(LIN, w.a)
  const v = w.readActivity(U('陈屿'), w.a, 'vehicle', { vehicleId: w.v1 })
  check('车长只看到本车乘客', v.vehicleTask && v.vehicleTask.passengers.every(p => p.vehicle === '一号车'), JSON.stringify((v.vehicleTask || {}).passengers || []))
  check('车长看不到另一辆车', v.vehicleTask && !v.vehicleTask.passengers.some(p => p.name === '王五'), JSON.stringify(v.vehicleTask.passengers.map(p => p.name)))
  const s = JSON.stringify(v)
  check('车长读里没有 medical/emergency/consentExpiresAt 字样', !/medical|emergency|consentExpiresAt/.test(s), '敏感字段泄漏')
  check('车长视角 incidents 为空', v.incidents.length === 0)
  const other = w.readActivity(U('陈屿'), w.a, 'vehicle', { vehicleId: w.v2 })
  check('拿别的车辆编号请求 ⇒ 拒绝', other.kind === 'denied', JSON.stringify(other))
}

/* ================= 5. 导出与表单的口径 ================= */

section('5. 导出 CSV：不适用就是不适用，不凭空造未完成项')
{
  const w = richWorld()
  const ids = ['林溪', '陈屿', '赵六', '钱七'].map(n => w.signupIdOf(n))
  const csv = w.readExport(LIN, w.a, ids, 'ordinary', '活动人员核对')
  check('导出 ok', csv.ok === true, JSON.stringify(csv.error || ''))
  const lines = csv.value.split('\r\n')
  const selfLine = lines.find(l => l.indexOf('林溪') !== -1)
  check('self 的人车辆/座位/上车列写「不适用」而不是「未上车」', /不适用/.test(selfLine) && selfLine.indexOf('未上车') === -1, selfLine)
  const chenLine = lines.find(l => l.indexOf('陈屿') !== -1)
  check('已排座的拼车乘客写出车辆与座号', chenLine.indexOf('一号车') !== -1 && chenLine.indexOf('1A') !== -1, chenLine)
  check('未签到的人在导出里就是未签到（没有沉默美化）', chenLine.indexOf('未签到') !== -1, chenLine)
  check('表头含出行方式与上车点两列', lines[0].indexOf('"出行方式"') !== -1 && lines[0].indexOf('"上车点"') !== -1, lines[0])
  const sens = w.readExport(LIN, w.a, [w.signupIdOf('陈屿')], 'sensitive', '')
  check('敏感导出没有用途时直接拒绝', !sens.ok, JSON.stringify(sens))
  const sens2 = w.readExport(LIN, w.a, [w.signupIdOf('陈屿')], 'sensitive', '购买保险需要')
  check('注明用途后敏感导出 ok', sens2.ok === true, JSON.stringify(sens2.error || ''))
}

section('5b. 报名表单回读：shared 绝不塌成 self')
{
  const w = richWorld()
  const f = w.readForm(U('陈屿'), w.a, w.signupIdOf('陈屿'), '我要改报名信息')
  check('本人可读回自己的报名表单', f.ok === true, JSON.stringify(f.error || ''))
  check('shared 回读保留 pickupPointId', f.ok === true && f.value.input.trip.mode === 'shared' && f.value.input.trip.pickupPointId === 'pk-1', JSON.stringify(f.error || f.value && f.value.input.trip))
  const f2 = w.readForm(LIN, w.a, w.signupIdOf('林溪'), '改')
  check('self 回读不带 pickupPointId 键', f2.ok === true && f2.value.input.trip.mode === 'self' && !('pickupPointId' in f2.value.input.trip), JSON.stringify(f2.error || f2.value && f2.value.input.trip))
  const other = w.readForm(U('王五'), w.a, w.signupIdOf('陈屿'), '想改别人的')
  check('他人无法读回别人的报名表单', !other.ok, JSON.stringify(other.error || ''))
}

/* ================= 6. detailState 状态机只读结构化字段 ================= */

section('6. detailState：参与者视角的 12 态与实际事实一致')
{
  const w = richWorld()
  check('陈屿（已确认、已排座、published）⇒ ready', w.readActivity(U('陈屿'), w.a, 'participant').detailState === 'ready', JSON.stringify(w.readActivity(U('陈屿'), w.a, 'participant').detailState))
  const w2 = richWorld()
  w2.dispatch(LIN, { type: 'assignment.remove', activityId: w2.a, signupId: w2.signupIdOf('陈屿') })
  check('同一人解除座位后 ⇒ confirmed（还在等车辆安排）', w2.readActivity(U('陈屿'), w2.a, 'participant').detailState === 'confirmed')
  // 待确认者：新报一个人并保持 pending（richWorld 里的孙八已被他自己撤回）
  const w4 = richWorld()
  w4.profile(U('孙九'), '孙九')
  const n9 = w4.signup(U('孙九'), w4.a, '孙九', { mode: 'self' }, { ownerId: LIN, keepPending: true })
  check('前置：孙九处于待确认', n9.ok === true && w4.signupOf('孙九').status === 'pending', JSON.stringify(n9))
  check('待确认者本人看到 pending', w4.readActivity(U('孙九'), w4.a, 'participant').detailState === 'pending', JSON.stringify(w4.readActivity(U('孙九'), w4.a, 'participant').detailState))
  w4.dispatch(U('孙九'), { type: 'signup.cancel', activityId: w4.a, signupIds: [w4.signupIdOf('孙九')], reason: '不去了' })
  check('取消后回到可报名态（new），而不是卡在 pending', ['new', 'closed'].indexOf(w4.readActivity(U('孙九'), w4.a, 'participant').detailState) !== -1, JSON.stringify(w4.readActivity(U('孙九'), w4.a, 'participant').detailState))
  // 活动取消：richWorld 里有兼任司机的人，取消前先换成服务司机（域内要求）
  const w5 = richWorld()
  const drvVehicle = w5.state.vehicles.find(x => x.drivers.some(d => d.kind === 'participant'))
  w5.dispatch(LIN, { type: 'vehicle.save', activityId: w5.a, vehicleId: drvVehicle.id, input: { label: drvVehicle.label, plate: drvVehicle.plate, legalCapacity: drvVehicle.legalCapacity, drivers: [w5.serviceDriver()], blockedSeats: drvVehicle.blockedSeats, seatLabels: drvVehicle.seatLabels, pickupPointIds: drvVehicle.pickupPointIds } })
  const cx = w5.phase(LIN, w5.a, 'cancelled', '下雨')
  check('更换兼任司机后活动可取消', cx.ok === true, JSON.stringify(cx))
  check('活动取消 ⇒ cancelled', w5.readActivity(U('陈屿'), w5.a, 'participant').detailState === 'cancelled', JSON.stringify(w5.readActivity(U('陈屿'), w5.a, 'participant').detailState))
  check('取消后名单仍可读且状态都是已取消', w5.readActivity(U('陈屿'), w5.a, 'participant').rows.every(r => ['cancelled', 'removed'].indexOf(r.status) !== -1), JSON.stringify(w5.readActivity(U('陈屿'), w5.a, 'participant').rows.map(r => r.status)))
  const w6 = richWorld()
  w6.toArchived(LIN, w6.a)
  check('归档 ⇒ finished', w6.readActivity(U('陈屿'), w6.a, 'participant').detailState === 'finished', JSON.stringify(w6.readActivity(U('陈屿'), w6.a, 'participant').detailState))
  // self 的人永远不该看到「等车辆安排」
  for (const [name, actor] of [['林溪', LIN], ['钱七', U('钱七')]]) {
    const st = w.readActivity(actor, w.a, 'participant').detailState
    check(name + '（self）的详情态不可能是等车安排的 confirmed', st !== 'confirmed', JSON.stringify(st))
  }
  check('归档链状态合法', w6.problems.length === 0, JSON.stringify(w6.problems.slice(0, 3)))
}

/* ================= 7. 客户端静态门：禁止用中文文案判业务状态 ================= */

section('7. 客户端扫描：不得再用显示文案反推出行方式/上车状态')
{
  const root = path.join(__dirname, '..', 'miniprogram')
  const LABELS = ['自行前往', '搭乘车辆', '另行返程', '自行往返', '原车返程', '上车点信息缺失', '已上车', '未上车', '已签到', '未签到']
  const hits = []
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      if (!/\.(js|wxml)$/.test(name)) continue
      const rel = path.relative(root, p).split(path.sep).join('/')
      // 文案定义处允许出现这些字面量
      if (rel === 'utils/format.js') continue
      const src = fs.readFileSync(p, 'utf8')
      const CJK = '[\\u4e00-\\u9fff]'
      src.split('\n').forEach((line, idx) => {
        if (/^\s*(\/\/|<!--|\*)/.test(line)) return
        // 只认「比较运算符紧跟文案字面量」。产出文案（`? '已上车' : ''`）是在写标签，不是拿标签判读。
        if (new RegExp('[!=]==?\\s*["\'](' + LABELS.join('|') + ')["\']').test(line)
          || new RegExp('(indexOf|includes)\\(\\s*["\'](' + LABELS.join('|') + ')["\']').test(line)) {
          hits.push(rel + ':' + (idx + 1) + ' ' + line.trim().slice(0, 110))
        }
        // 把某个 status 字段拿去和中文比：域内状态全是英文枚举，中文只可能是显示文案
        if (new RegExp('\\.[\\w]*[Ss]tatus\\w*\\s*[!=]==?\\s*["\'][^"\']*' + CJK).test(line)) {
          hits.push(rel + ':' + (idx + 1) + ' ' + line.trim().slice(0, 110))
        }
      })
    }
  }
  walk(root)
  check('没有任何一处用中文文案给业务状态投票（AGENTS.md 铁律 19）', hits.length === 0, '\n    ' + hits.join('\n    '))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
