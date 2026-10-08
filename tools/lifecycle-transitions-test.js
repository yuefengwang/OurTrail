// 全生命周期阶段与转换审计：node tools/lifecycle-transitions-test.js
//
// 审计问题：一条活动从草稿到归档，每一道阶段门是否「只允许合法路径、拒绝一切跳跃与回退」，
// 以及被拒绝的命令是否真的零副作用（不存在半成功）。
// 与既有测试的分工：scenario-* 测单个页面的命令发射，e2e-* 测服务链路；
// 本套件测的是**阶段机的穷举**：7 个阶段 × 全部转换目标、终态封口、可达但不可完成的死路。
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
const P1 = 'o-p1-openid'
const P2 = 'o-p2-openid'
const DRV = 'o-drv-openid'

/** 一条 mixed 活动：林溪(owner, self) + 陈屿(shared 乘客) + 老周(shared 参与者司机) */
function mixedWorld() {
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.profile(P1, '陈屿')
  w.profile(P2, '老周')
  const a = w.createActivity(LIN)
  w.publish(LIN, a)
  w.signup(LIN, a, '林溪', { mode: 'self' }, { keepPending: false })
  const vPass = w.vehicle(LIN, a, { label: '乘客车', seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] })
  w.signup(P1, a, '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  w.assign(LIN, a, w.signupIdOf('陈屿'), vPass, '1')
  return { w, a, vPass }
}

/* ================= 1. 阶段阶梯：穷举 7×7 ================= */

const PHASE_LADDER = {
  // 草稿的正常出口是 activity.publish（不是 transition）；transition 只允许就地作废为 cancelled。
  draft: ['cancelled'],
  published: ['gathering', 'cancelled'],
  gathering: ['active', 'cancelled'],
  active: ['closing'],
  closing: ['archived'],
  archived: [],
  cancelled: [],
}

section('1. activity.transition 穷举：每个阶段的合法 next 恰是阶梯的那几条')
{
  for (const from of H.PHASES) {
    const w = H.createWorld()
    w.profile(LIN, '林溪')
    const a = w.createActivity(LIN, { capacity: 5 })
    if (from !== 'draft') {
      w.publish(LIN, a)
      if (from !== 'published') {
        // 先挂一个已取消的报名，让阶段门只受阶段本身影响（不掺入未处理的业务事实）
        w.signup(LIN, a, '林溪', { mode: 'self' }, { ownerId: LIN })
        w.dispatch(LIN, { type: 'signup.cancel', activityId: a, signupIds: [w.signupIdOf('林溪')], reason: '本轮只测阶段门' })
        w.phase(LIN, a, 'gathering')
      }
      if (['active', 'closing', 'archived'].indexOf(from) !== -1) w.phase(LIN, a, 'active', '开始行程')
      if (['closing', 'archived'].indexOf(from) !== -1) w.phase(LIN, a, 'closing', '返程清点')
      if (from === 'archived') w.phase(LIN, a, 'archived', '归档')
      if (from === 'cancelled') w.phase(LIN, a, 'cancelled', '天气原因取消')
    }
    check('前置：能真实地把活动推进到 ' + from, w.state.activities[0].phase === from, '实际停在 ' + w.state.activities[0].phase)

    for (const to of H.PHASES) {
      const legal = PHASE_LADDER[from].indexOf(to) !== -1
      const r = w.phase(LIN, a, to, '阶段门穷举')
      const code = r.ok ? 'ok' : r.code
      if (legal) {
        check(from + '→' + to + ' 合法并通过（' + code + '）', r.ok === true, JSON.stringify(r))
        break // 合法的那条一旦走通就改变状态，不再试剩下的
      }
      check(from + '→' + to + ' 被拒（' + code + '）',
        !r.ok && ['WRONG_PHASE', 'UNRESOLVED_SAFETY', 'UNRESOLVED_DEPARTURE', 'DRIVER_CONFLICT'].indexOf(code) !== -1, JSON.stringify(r))
    }
    // 阶梯之外的每一步都必须零副作用；harness 已把 partial-write 记进 problems
    check(from + '：穷举过程中状态始终合法且无半成功', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
  }
  // 草稿的正常出口
  const wd = H.createWorld()
  wd.profile(LIN, '林溪')
  const da = wd.createActivity(LIN)
  const up = wd.phase(LIN, da, 'published')
  check('draft→published 不能用 transition（必须走 activity.publish）', !up.ok && up.code === 'WRONG_PHASE', JSON.stringify(up))
}

section('1b. 草稿不可用 transition，不可用 signup/现场命令')
{
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  const a = w.createActivity(LIN)
  const t = w.phase(LIN, a, 'gathering')
  check('draft→gathering 直接跳被拒', !t.ok && t.code === 'WRONG_PHASE', JSON.stringify(t))
  const s = w.dispatch(LIN, { type: 'signup.submit', activityId: a, keepTogether: false, mode: 'apply', participants: [w.participantInput(LIN, '林溪', { mode: 'self' })] })
  check('草稿不接受报名（WRONG_PHASE）', !s.ok && s.code === 'WRONG_PHASE', JSON.stringify(s))
  const c = w.dispatch(LIN, { type: 'attendance.checkin', activityId: a, signupId: 'nope', checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: 'x' } } })
  check('草稿不接受现场记录（NOT_FOUND，不是崩溃）', !c.ok && c.code === 'NOT_FOUND', JSON.stringify(c))
  check('草稿阶段状态始终合法（没有半成功）', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
}

/* ================= 2. 混合出行方式的全生命周期贯通 ================= */

section('2. mixed 活动全程贯通：self + 拼车乘客 + 参与者司机，一路到 archived')
{
  const { w, a, vPass } = mixedWorld()
  // 老周以报名者身份兼任第二辆车的司机
  w.signup(P2, a, '老周', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  const drvSignup = w.signupIdOf('老周')
  const vDrv = w.vehicle(LIN, a, { label: '老周自驾', legalCapacity: 5, drivers: [{ kind: 'participant', signupId: drvSignup }], seatLabels: ['1', '2', '3', '4'] })

  const rows = w.readActivity(LIN, a, 'organizer').rows
  const linRow = rows.find(r => r.name === '林溪')
  const chenRow = rows.find(r => r.name === '陈屿')
  const zhouRow = rows.find(r => r.name === '老周')
  check('self 参与者不进「待安排车辆」', linRow.tripMode === 'self' && linRow.needsSeatAssignment === false, JSON.stringify(linRow))
  check('拼车乘客需要座位安排', chenRow.tripMode === 'shared' && chenRow.needsSeatAssignment === false && chenRow.hasPassengerAssignment === true, JSON.stringify(chenRow))
  check('参与者司机自己开车，不欠乘客位', zhouRow.tripMode === 'shared' && zhouRow.needsSeatAssignment === false && zhouRow.hasPassengerAssignment === false, JSON.stringify(zhouRow))

  check('全员 self 之外仍需要车的是 0 人', w.readActivity(LIN, a, 'organizer').counters.unassigned === 0, JSON.stringify(w.readActivity(LIN, a, 'organizer').counters))

  // 集合
  const g = w.toGathering(LIN, a)
  check('published→gathering（无待确认）', g.ok === true, JSON.stringify(g))
  // 现场：签到 → 上车（只有拼车乘客需要）→ 核实出发
  const rowsById = {}
  for (const r of w.readActivity(LIN, a, 'organizer').rows) rowsById[r.signupId] = r
  for (const name of ['林溪', '陈屿', '老周']) {
    const id = w.signupIdOf(name)
    const row = rowsById[id]
    const ci = w.checkin(LIN, a, id)
    check(name + ' 签到', ci.ok === true, JSON.stringify(ci))
    if (row.needsOutboundBoarding) {
      const bd = w.board(LIN, a, id, 'outbound', true)
      check(name + '（拼车乘客）补上该要的去程上车事实', bd.ok === true, JSON.stringify(bd))
      check(name + ' 上车后不再欠去程清点', w.readActivity(LIN, a, 'organizer').rows.find(x => x.signupId === id).needsOutboundBoarding === false)
    } else {
      const bd = w.board(LIN, a, id, 'outbound', true)
      check(name + ' 的上车事实是「不适用」，域内拒绝写入一条假事实', !bd.ok && bd.code === 'WRONG_PHASE', JSON.stringify(bd))
    }
    const dp = w.departure(LIN, a, id, 'joined')
    check(name + ' 核实随队出发', dp.ok === true, JSON.stringify(dp))
  }
  const act = w.phase(LIN, a, 'active', '开始行程')
  check('gathering→active（全员已核实）', act.ok === true, JSON.stringify(act))
  const vd = w.dispatch(LIN, { type: 'vehicle.depart', activityId: a, vehicleId: vPass, leg: 'outbound', note: '清点后发车' })
  check('去程发车 ok（本车人员已清点）', vd.ok === true, JSON.stringify(vd))

  const cl = w.phase(LIN, a, 'closing', '返程清点')
  check('active→closing 需要说明原因', cl.ok === true, JSON.stringify(cl))
  const noReason = w.phase(LIN, a, 'archived', '')
  check('closing→archived 未核实到家被拒（UNRESOLVED_SAFETY）', !noReason.ok && noReason.code === 'UNRESOLVED_SAFETY', JSON.stringify(noReason))
  for (const name of ['林溪', '陈屿', '老周']) w.home(LIN, a, w.signupIdOf(name))
  const arch = w.phase(LIN, a, 'archived', '归档')
  check('全员到家后归档 ok', arch.ok === true, JSON.stringify(arch))
  check('归档后 detailState=finished', w.readActivity(LIN, a, 'organizer').detailState === 'finished')
  check('全程无不变量破坏/半成功', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 4)))
}

/* ================= 3. 终态封口：archived / cancelled 不得再有任何 mutation ================= */

const SEALED_ALLOWED = ['activity.copy', 'export.record', 'notice.read', 'position.revoke']

section('3. 归档封口：39 条命令逐一尝试，除白名单外全部被拒且零副作用')
{
  const { w, a } = mixedWorld()
  w.toArchived(LIN, a)
  const chen = w.signupIdOf('陈屿')
  const vehicleId = w.state.vehicles[0].id
  const noticeId = w.state.notices.length ? w.state.notices[0].id : 'n-none'
  const incidentId = w.state.incidents.length ? w.state.incidents[0].id : 'i-none'
  const groupId = w.state.signups[0].groupId
  const trials = [
    ['activity.edit', { type: 'activity.edit', activityId: a, input: w.activityInput({ title: '改名' }) }],
    ['activity.publish', { type: 'activity.publish', activityId: a, participation: null }],
    ['activity.delete', { type: 'activity.delete', activityId: a }],
    ['activity.transition', { type: 'activity.transition', activityId: a, next: 'active', reason: '回退' }],
    ['signup.submit', { type: 'signup.submit', activityId: a, keepTogether: false, mode: 'apply', participants: [w.participantInput(LIN, '新人', { mode: 'self' })] }],
    ['signup.review', { type: 'signup.review', activityId: a, signupIds: [chen], decision: 'confirm' }],
    ['signup.promote', { type: 'signup.promote', activityId: a, signupIds: [chen] }],
    ['signup.cancel', { type: 'signup.cancel', activityId: a, signupIds: [chen], reason: '迟到的取消' }],
    ['signup.edit', { type: 'signup.edit', activityId: a, signupId: chen, participant: w.person('陈屿'), trip: { mode: 'self' }, purpose: '核对' }],
    ['group.setTogether', { type: 'group.setTogether', activityId: a, groupId, keepTogether: false }],
    ['vehicle.save', { type: 'vehicle.save', activityId: a, vehicleId: null, input: { label: '新车', plate: '川Z', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } }],
    ['vehicle.remove', { type: 'vehicle.remove', activityId: a, vehicleId }],
    ['assignment.set', { type: 'assignment.set', activityId: a, target: { signupId: chen, vehicleId, seatLabel: '2' } }],
    ['assignment.remove', { type: 'assignment.remove', activityId: a, signupId: chen }],
    ['assignment.swap', { type: 'assignment.swap', activityId: a, firstSignupId: chen, secondSignupId: w.signupIdOf('林溪') }],
    ['assignment.commit', { type: 'assignment.commit', activityId: a, preview: { activityId: a, baseRevision: w.state.revision, assignments: w.state.assignments.slice(), unassigned: [] } }],
    ['membership.save', { type: 'membership.save', activityId: a, membership: { role: 'staff', id: null, activityId: a, userId: P1, expiresAt: '2027-01-01T00:00:00+08:00', scope: { kind: 'all' }, capabilities: ['roster'] } }],
    ['membership.revoke', { type: 'membership.revoke', activityId: a, membershipId: 'm-none' }],
    ['attendance.checkin', { type: 'attendance.checkin', activityId: a, signupId: chen, checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: '补签到' } } }],
    ['attendance.board', { type: 'attendance.board', activityId: a, signupId: chen, leg: 'return', boarded: true, note: '补' }],
    ['attendance.departure', { type: 'attendance.departure', activityId: a, signupId: chen, outcome: { kind: 'coordinating', evidence: { at: w.now, by: LIN, note: '改口径' } } }],
    ['attendance.returnPlan', { type: 'attendance.returnPlan', activityId: a, signupId: chen, plan: 'independent', note: '改另行返程' }],
    ['attendance.node', { type: 'attendance.node', activityId: a, signupId: chen, pointId: 'pt-2', note: '补节点' }],
    ['attendance.home', { type: 'attendance.home', activityId: a, signupId: chen, note: '重复报平安' }],
    ['vehicle.depart', { type: 'vehicle.depart', activityId: a, vehicleId, leg: 'return', note: '补发车' }],
    ['vehicle.complete', { type: 'vehicle.complete', activityId: a, vehicleId, leg: 'return', note: '补完成' }],
    ['position.report', { type: 'position.report', activityId: a, signupId: chen, coordinates: { lat: 30.5, lng: 103.5 }, consent: true }],
    ['incident.report', { type: 'incident.report', activityId: a, signupIds: [chen], kind: 'other', description: '归档后报备' }],
    ['incident.resolve', { type: 'incident.resolve', activityId: a, incidentId, note: '归档后销案' }],
    ['notice.publish', { type: 'notice.publish', activityId: a, audience: { kind: 'activity' }, content: '归档后发通知' }],
    ['notice.delivery', { type: 'notice.delivery', activityId: a, noticeId, channel: 'copy', status: 'copied', detail: '' }],
  ]
  const rejected = []
  for (const [type, payload] of trials) {
    const before = w.snapshot()
    const r = w.dispatch(LIN, payload)
    const code = r.ok ? 'ACCEPTED' : r.code
    rejected.push(type + '=' + code)
    if (SEALED_ALLOWED.indexOf(type) === -1) {
      check('归档后拒绝 ' + type, !r.ok, JSON.stringify(r))
      check('归档后 ' + type + ' 零副作用', w.snapshot() === before)
    }
  }
  check('39 条命令的活动作用域集合里，没有任何一条在归档后被接受',
    rejected.every(x => x.indexOf('=ACCEPTED') === -1), JSON.stringify(rejected.filter(x => x.indexOf('=ACCEPTED') !== -1)))
  // 白名单四条各用「正确的操作者」验一次：它们是全生命周期可用的，不受归档封口影响
  const chen2 = w.signupIdOf('陈屿')
  check('归档后仍可复制为新草稿', w.allow(LIN, { type: 'activity.copy', sourceActivityId: a }).ok)
  check('归档后仍可登记导出用途', w.allow(LIN, { type: 'export.record', activityId: a, signupIds: [chen2], mode: 'ordinary', purpose: '保险备案' }).ok)
  check('归档后仍可把位置授权撤回（撤回永远不该被挡住）', w.allow(P1, { type: 'position.revoke', activityId: a, signupId: chen2 }).ok)
  const anyNotice = w.state.notices.find(n => n.activityId === a)
  check('归档后仍可读取面向自己的通知', !!anyNotice && w.allow(LIN, { type: 'notice.read', activityId: a, noticeId: anyNotice.id }).ok, JSON.stringify({ has: !!anyNotice }))
  check('归档封口全程状态合法且无半成功', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 4)))
}

section('3b. 取消态封口')
{
  const { w, a } = mixedWorld()
  const r = w.phase(LIN, a, 'cancelled', '天气原因')
  check('published→cancelled ok', r.ok === true, JSON.stringify(r))
  const chen = w.signupIdOf('陈屿')
  check('取消后乘车安排被清空', w.state.assignments.length === 0 && w.state.signups.every(s => s.status !== 'confirmed'), JSON.stringify(w.state.signups.map(s => s.status)))
  for (const payload of [
    { type: 'signup.submit', activityId: a, keepTogether: false, mode: 'apply', participants: [w.participantInput(LIN, '新人', { mode: 'self' })] },
    { type: 'attendance.checkin', activityId: a, signupId: chen, checkIn: { method: 'manual', evidence: { at: w.now, by: LIN, note: 'x' } } },
    { type: 'vehicle.save', activityId: a, vehicleId: null, input: { label: '新车', plate: '川Y', legalCapacity: 5, drivers: [w.serviceDriver()], blockedSeats: 0, seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] } },
    { type: 'activity.edit', activityId: a, input: w.activityInput({ title: '改标题' }) },
  ]) {
    const before = w.snapshot()
    const res = w.dispatch(LIN, payload)
    check('取消后拒绝 ' + payload.type, !res.ok, JSON.stringify(res))
    check('取消后 ' + payload.type + ' 零副作用', w.snapshot() === before)
  }
  check('取消活动仍可读（名单只读回看）', w.readActivity(P1, a, 'participant').kind === 'activity')
  check('取消态无不变量破坏', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

/* ================= 4. 阶段门的业务前提 ================= */

section('4. 阶段门的业务前提：不是只看阶段，还要看事实')
{
  const { w, a } = mixedWorld()
  // 有待确认报名不能开始集合
  w.profile('o-new-openid', '新报名')
  w.dispatch('o-new-openid', { type: 'signup.submit', activityId: a, keepTogether: false, mode: 'apply', participants: [w.participantInput('o-new-openid', '新报名', { mode: 'self' })] })
  const g = w.phase(LIN, a, 'gathering')
  check('仍有待确认报名 → published→gathering 被拒（UNRESOLVED_DEPARTURE）', !g.ok && g.code === 'UNRESOLVED_DEPARTURE', JSON.stringify(g))
  check('拒绝后阶段没动', w.state.activities[0].phase === 'published')

  // 有人未核实出发不能进入行程
  w.dispatch(LIN, { type: 'signup.review', activityId: a, signupIds: [w.signupIdOf('新报名')], decision: 'confirm' })
  const g2 = w.toGathering(LIN, a)
  check('处理后进入集合', g2.ok === true, JSON.stringify(g2))
  w.checkin(LIN, a, w.signupIdOf('陈屿'))
  const act = w.phase(LIN, a, 'active', '开始行程')
  check('有人未核实出发情况 → gathering→active 被拒', !act.ok && act.code === 'UNRESOLVED_DEPARTURE', JSON.stringify(act))
  check('拒绝后没有半条履约事实被写入', w.state.attendance.filter(x => x.departure).length === 0, JSON.stringify(w.state.attendance.map(x => x.departure)))
}

section('4b. 「协调中」进行程必须留下未闭环异常')
{
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  const a = w.createActivity(LIN)
  w.publish(LIN, a)
  w.signup(LIN, a, '林溪', { mode: 'self' }, { keepPending: false })
  w.toGathering(LIN, a)
  const x = w.signupIdOf('林溪')
  w.departure(LIN, a, x, 'coordinating', '联系不上，先记协调中')
  const act = w.phase(LIN, a, 'active', '开始行程')
  check('协调中也可进行程（人不欠核实）', act.ok === true, JSON.stringify(act))
  check('但系统自动留下一条未解决 late 异常', w.state.incidents.length === 1 && w.state.incidents[0].kind === 'late' && w.state.incidents[0].resolution === null, JSON.stringify(w.state.incidents))
  w.tick('2026-10-11T18:30:00+08:00')
  const cl = w.phase(LIN, a, 'closing', '返程清点')
  check('active→closing ok', cl.ok === true, JSON.stringify(cl))
  const arch = w.phase(LIN, a, 'archived', '直接归档')
  check('协调中/异常未闭环时不可归档', !arch.ok && (arch.code === 'UNRESOLVED_SAFETY'), JSON.stringify(arch))
  const resolve = w.dispatch(LIN, { type: 'incident.resolve', activityId: a, incidentId: w.state.incidents[0].id, note: '已联系上，自行回家' })
  check('销案 ok', resolve.ok === true, JSON.stringify(resolve))
  const arch2 = w.phase(LIN, a, 'archived', '异常闭环后归档')
  check('只销案仍不可归档：出发情况本身还没定局', !arch2.ok && arch2.code === 'UNRESOLVED_SAFETY', JSON.stringify(arch2))
  // 死路判据（F7）：进入 closing 后若「协调中」再也改不动，归档条件就永久无解
  const late = w.departure(LIN, a, x, 'not_departed', '确认未随队，自行回家')
  check('返程阶段仍可为「协调中」的人补一个定论（否则归档永久无解）', late.ok === true, JSON.stringify(late))
  const arch3 = w.phase(LIN, a, 'archived', '出发情况与异常都已闭环')
  check('反空断言：补定论 + 销案后即可归档 ⇒ 前两条红来自这两件事', arch3.ok === true, JSON.stringify(arch3))
  check('本节状态始终合法', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('4c. 死路（F7）：协调中的人随活动进入返程后，不能被永远卡在无法定论的状态')
{
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.profile(P1, '陈屿')
  const a = w.createActivity(LIN)
  w.publish(LIN, a)
  w.signup(LIN, a, '林溪', { mode: 'self' }, { ownerId: LIN })
  w.signup(P1, a, '陈屿', { mode: 'self' }, { ownerId: LIN })
  w.toGathering(LIN, a)
  const chen = w.signupIdOf('陈屿')
  w.departure(LIN, a, chen, 'coordinating', '电话不通，继续联系')
  const lin = w.signupIdOf('林溪')
  check('林溪签到', w.checkin(LIN, a, lin).ok === true)
  check('林溪核实随队出发', w.departure(LIN, a, lin, 'joined').ok === true)
  const goActive = w.phase(LIN, a, 'active', '出发')
  check('带着一个「协调中」也能进行程', goActive.ok === true, JSON.stringify(goActive))
  check('并留下一条待处理异常', w.state.incidents.filter(i => !i.resolution).length === 1, JSON.stringify(w.state.incidents))
  w.tick('2026-10-11T18:30:00+08:00')
  const goClosing = w.phase(LIN, a, 'closing', '返程清点')
  check('行程→返程', goClosing.ok === true, JSON.stringify(goClosing))
  const stillOpen = w.phase(LIN, a, 'archived', '先试试归档')
  check('协调中未定论时不可归档', !stillOpen.ok && stillOpen.code === 'UNRESOLVED_SAFETY', JSON.stringify(stillOpen))
  w.home(LIN, a, lin)
  const fix = w.departure(LIN, a, chen, 'not_departed', '家属回报：他今天没出门')
  check('返程阶段可把「协调中」补成「未出发」', fix.ok === true, JSON.stringify(fix))
  w.dispatch(LIN, { type: 'incident.resolve', activityId: a, incidentId: w.state.incidents[0].id, note: '家属确认未出行' })
  const arch = w.phase(LIN, a, 'archived', '闭环')
  check('补定论后即可归档（生命周期不会走进死胡同）', arch.ok === true, JSON.stringify(arch))
  check('本节状态始终合法且无半成功', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

/* ================= 5. 死路探测：可达但之后无合法路径离开 ================= */

section('5. 死路：被核实「未出发」的人，行程中到场后必须还能被补录为随队出行')
{
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  const a = w.createActivity(LIN)
  w.publish(LIN, a)
  w.signup(LIN, a, '林溪', { mode: 'self' }, { keepPending: false })
  const lin = w.signupIdOf('林溪')
  const v = w.vehicle(LIN, a)
  w.profile(P1, '陈屿')
  w.signup(P1, a, '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  const chen = w.signupIdOf('陈屿')
  w.assign(LIN, a, chen, v, '1')
  w.toGathering(LIN, a)
  check('林溪签到并核实随队出发（否则阶段门先卡在人身上）', w.checkin(LIN, a, lin).ok === true && w.departure(LIN, a, lin, 'joined').ok === true)
  const nd = w.departure(LIN, a, chen, 'not_departed', '本人明确说不来')
  check('集合阶段可核实为未出发', nd.ok === true, JSON.stringify(nd))
  const act = w.phase(LIN, a, 'active', '开始行程')
  check('未出发不阻塞活动进行程', act.ok === true, JSON.stringify(act))

  // 死路判据：此人实际到场并搭上了后发的车，系统必须还能记录他随队出行
  const ci = w.checkin(LIN, a, chen)
  check('行程中可为「此前未出发、后来到场」的人补签到', ci.ok === true, JSON.stringify(ci))
  const back = w.departure(LIN, a, chen, 'coordinating', '本人到场，重新协调')
  check('可把「未出发」改回「协调中」以继续核实', back.ok === true, JSON.stringify(back))
  const bd = w.board(LIN, a, chen, 'outbound', true)
  check('补去程上车', bd.ok === true, JSON.stringify(bd))
  const joined = w.departure(LIN, a, chen, 'joined', '搭后车随队')
  check('最终可核实为已随队出发', joined.ok === true, JSON.stringify(joined))
  w.tick('2026-10-11T18:30:00+08:00')
  w.phase(LIN, a, 'closing', '返程清点')
  const hm = w.home(LIN, a, chen)
  check('随队者可确认到家（安全闭环可完成）', hm.ok === true, JSON.stringify(hm))
  check('本节无不变量破坏', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('5b. 死路反向确认：已核实随队出发的人不可改成未出发')
{
  const { w, a } = mixedWorld()
  w.toGathering(LIN, a)
  const chen = w.signupIdOf('陈屿')
  w.checkin(LIN, a, chen)
  w.board(LIN, a, chen, 'outbound', true)
  w.departure(LIN, a, chen, 'joined')
  const flip = w.departure(LIN, a, chen, 'not_departed', '想改口径')
  check('已随队出发不可回退成未出发（历史事实不可抹去）', !flip.ok && flip.code === 'WRONG_PHASE', JSON.stringify(flip))
  const unboard = w.board(LIN, a, chen, 'outbound', false)
  check('未发车时可纠正上车记录', unboard.ok === true, JSON.stringify(unboard))
  check('纠正后不留脏事实', w.attendanceOf(chen).boardingByLeg.outbound === null)
}

/* ================= 6. 删除安全：只有草稿可删，删除不伤及安全档案 ================= */

section('6. activity.delete 的边界与级联')
{
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  const a = w.createActivity(LIN)
  w.publish(LIN, a)
  const delPublished = w.dispatch(LIN, { type: 'activity.delete', activityId: a })
  check('已发布活动不可删除（只有草稿可删）', !delPublished.ok && ['FORBIDDEN', 'WRONG_PHASE'].indexOf(delPublished.code) !== -1, JSON.stringify(delPublished))
  check('拒绝后活动仍在', w.state.activities.length === 1)

  const draft = w.createActivity(LIN, { title: '另一条草稿' })
  const v = w.vehicle(LIN, draft)
  const delDraft = w.dispatch(LIN, { type: 'activity.delete', activityId: draft })
  check('草稿删除 ok', delDraft.ok === true, JSON.stringify(delDraft))
  check('草稿的车辆随之清理', w.state.vehicles.filter(x => x.activityId === draft).length === 0, JSON.stringify(w.state.vehicles.map(x => x.id)))
  check('另一条已发布活动未受影响', w.state.activities.length === 1 && w.state.activities[0].id === a)
  check('删除过程中状态合法且无半成功', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))

  // 删除的级联必须覆盖「以 signupId 为主键」的集合（attendance/positions），
  // 而不是按 payload 上的 activityId 去筛——位置上报的记录里根本没有 activityId 字段。
  const draft2 = w.createActivity(LIN, { title: '第三条草稿' })
  const del2 = w.dispatch(LIN, { type: 'activity.delete', activityId: draft2 })
  check('反空断言：再删一条草稿仍 ok ⇒ 上一条删除不是因为状态损坏', del2.ok === true, JSON.stringify(del2))
  const orphans = H.checkOracles(w.state)
  check('删除后全局无孤儿引用（履约/位置/分配/授权/通知/事件）', orphans.length === 0, JSON.stringify(orphans))
  const keyed = ['attendance', 'positions', 'assignments']
  const stray = keyed.filter(name => w.state[name].some(r => r.activityId !== undefined && !w.state.activities.some(a => a.id === r.activityId)))
  check('按活动作用域清理后不残留引用（assignments 仍带 activityId 键）', stray.length === 0, JSON.stringify(stray))
  check('删除过程中状态合法且无半成功', w.problems.length === 0, JSON.stringify(w.problems.slice(0, 3)))
}

section('6b. 级联键的正确性：以 signupId 为主键的集合不能按 activityId 筛')
{
  // 直接对真实 handler 施测：这是唯一能把「草稿 + 该报名的位置上报」放在一起的办法
  // （命令序列到不了这个形态：位置只在 active 阶段产生，而活动不能回退到草稿）。
  // 这里要钉住的不是业务行为，而是级联用错了键这件事本身。
  const { handleActivity } = require('../cloudfunctions/trailApi/domain/activity')
  const seed = H.createWorld()
  seed.profile(LIN, '林溪')
  const draftId = seed.createActivity(LIN, { title: '级联验证草稿' })
  const base = seed.cloneState()
  const activity = base.activities.find(x => x.id === draftId)
  base.groups = [{ id: 'g-x', activityId: draftId, submittedByUserId: LIN, keepTogether: false }]
  base.signups = [{
    id: 'su-x', activityId: draftId, groupId: 'g-x', submittedByUserId: LIN,
    personRef: { kind: 'user', userId: LIN }, participant: base.profiles[0].person,
    trip: { mode: 'self' }, status: 'confirmed',
    consent: { at: seed.now, recordedBy: LIN, dataUse: true, proxyAuthority: false, proxyHome: false },
  }]
  base.attendance = [{ signupId: 'su-x', checkIn: null, boardingByLeg: { outbound: null, return: null }, returnPlan: { kind: 'own' }, departure: null, nodes: [], home: null }]
  // 位置上报记录没有 activityId 字段（schema 里就没有），所以按 activityId 筛等于一条都没删
  base.positions = [{ signupId: 'su-x', coordinates: { lat: 30.5, lng: 103.5 }, reportedAt: seed.now, consentExpiresAt: activity.endAt, revokedAt: null }]

  const state = H.deepClone(base)
  const res = handleActivity(state, { actor: { userId: LIN }, payload: { type: 'activity.delete', activityId: draftId } }, { now: seed.now, id: k => k + '-n' })
  check('handler 接受删除该草稿', res.ok === true, JSON.stringify(res))
  check('级联清掉了该报名的履约记录', state.attendance.length === 0, JSON.stringify(state.attendance))
  check('级联也清掉了该报名的位置上报（键必须是 signupId）', state.positions.length === 0, JSON.stringify(state.positions))
  const after = H.assertOk(state)
  check('删除后的整库通过不变量（不会把后续每一次写入一起拖红）', after.ok === true, JSON.stringify(after.error || after))
}

/* ================= 7. 阶段与时间的耦合：截止、逾期、跨阶段时间推进 ================= */

section('7. 报名窗口由时间与阶段共同决定')
{
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.profile(P1, '陈屿')
  const a = w.createActivity(LIN)
  w.publish(LIN, a)
  const ok = w.signup(P1, a, '陈屿', { mode: 'self' }, { ownerId: LIN })
  check('截止前可报名', ok.ok === true, JSON.stringify(ok))
  const w2 = H.createWorld()
  w2.tick('2026-10-10T21:00:00+08:00') // 已过 deadlineAt 2026-10-10T20:00
  w2.profile(LIN, '林溪')
  w2.profile('o-late-openid', '迟到者')
  const a2 = w2.createActivity(LIN)
  w2.publish(LIN, a2)
  const late = w2.dispatch('o-late-openid', { type: 'signup.submit', activityId: a2, keepTogether: false, mode: 'apply', participants: [w2.participantInput('o-late-openid', '迟到者', { mode: 'self' })] })
  check('截止后报名被拒（WRONG_PHASE）', !late.ok && late.code === 'WRONG_PHASE', JSON.stringify(late))
  const offered = w2.readActivity('o-late-openid', a2, 'participant').permittedActions
  check('截止后 UI 不再给出报名入口（不出现注定失败按钮）', offered.indexOf('signup.submit') === -1, JSON.stringify(offered))
  const reopen = w2.dispatch(LIN, { type: 'activity.edit', activityId: a2, input: w2.activityInput({ deadlineAt: '2026-10-10T23:00:00+08:00' }) })
  check('领队延长截止时间 ok', reopen.ok === true, JSON.stringify(reopen))
  const late2 = w2.dispatch('o-late-openid', { type: 'signup.submit', activityId: a2, keepTogether: false, mode: 'apply', participants: [w2.participantInput('o-late-openid', '迟到者', { mode: 'self' })] })
  check('反空断言：延长后同一条报名即可通过 ⇒ 上一条红来自截止时间', late2.ok === true, JSON.stringify(late2))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
