// self/shared 出行方式解耦的域层验收矩阵：node tools/trip-mode-test.js
// 被测对象：cloudfunctions/trailApi/domain/{permissions,signup,field,activity,allocation,invariants,selectors}.js
//
// 定位：这是「参与者出行方式」的业务状态机断言，不是 UI 断言。每条用例同时验两层：
//   1) 业务事实——state 里的记录、阶段推进结果、不变量；
//   2) 投影与动作广播——rowView 标志、counters 分桶、permittedActions、detailState、导出列。
// 第二层才是这次重构的承重面：域层早就允许 self，是投影把 trip.mode 丢了，下游才只能猜文案。
//
// 手法与 cloudfunctions/trailApi/smoke-test.js 一致：纯域层、不打桩 wx、不复刻页面逻辑。
'use strict'

const { reduceCommand, genId } = require('../cloudfunctions/trailApi/domain/commands')
const { assertInvariants } = require('../cloudfunctions/trailApi/domain/invariants')
const { selectView, getDetailState, selectExport } = require('../cloudfunctions/trailApi/domain/selectors')
const { planAssignments } = require('../cloudfunctions/trailApi/domain/allocation')
const { canonicalPayload, deepClone } = require('../cloudfunctions/trailApi/domain/contracts')
const crypto = require('crypto')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const NOW = '2026-09-26T07:00:00+08:00'
const CTX = () => ({ now: NOW, id: genId })
const fp = payload => crypto.createHash('sha256').update(canonicalPayload(payload), 'utf8').digest('hex')

const OWNER = 'o-owner'
const P = ['o-a', 'o-b', 'o-c', 'o-d']
const FOUR = [OWNER, P[0], P[1], P[2]]

const person = name => ({ name, phone: '138' + name, emergency: { name: name + '应急', phone: '139' + name }, medical: '' })
const SELF = { mode: 'self' }
const at = id => ({ mode: 'shared', pickupPointId: id })
const CONSENT = { dataUse: true, proxyAuthority: false, proxyHome: false }
const input = (userId, trip) => ({ personRef: { kind: 'user', userId }, participant: person(userId), trip, consent: CONSENT })

function activityInput(opts) {
  const o = opts || {}
  return {
    title: '出行方式解耦验收', description: 'd', organizerIntro: 'oi',
    startAt: '2026-10-01T08:00:00+08:00', endAt: '2026-10-01T18:00:00+08:00',
    deadlineAt: '2026-09-30T20:00:00+08:00',
    acceptingSignups: true, capacity: o.capacity || 24, approvalMode: o.approvalMode || 'automatic', routeId: null,
    routeSnapshot: {
      title: 'r', distanceKm: 12, ascentM: 600,
      points: [{ id: 'pt-1', name: '起点', kind: 'start', coordinates: null }, { id: 'pt-2', name: '垭口', kind: 'checkpoint', coordinates: null }],
      risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }],
    },
    pickupPoints: o.pickupPoints === 0 ? [] : [
      { id: 'pk-1', name: '茶店子', meetingAt: '2026-10-01T07:00:00+08:00', address: '地铁口', coordinates: null },
      { id: 'pk-2', name: '都江堰', meetingAt: '2026-10-01T07:30:00+08:00', address: '停车场', coordinates: null }],
    equipment: [], feeNote: '', cancellationNote: '',
  }
}

// 6 个乘客位：核载 7 − 1 服务司机 − 0 预留。
function vehicleInput(opts) {
  const o = opts || {}
  const seats = o.seats === undefined ? 6 : o.seats
  return {
    label: o.label || '1号车', plate: '川A' + (o.plate || '12345'),
    legalCapacity: 1 + seats + (o.blocked || 0),
    drivers: o.drivers || [{ kind: 'service', name: '师傅', phone: '13700000000', userId: null }],
    blockedSeats: o.blocked || 0,
    seatLabels: Array.from({ length: seats }, (_, i) => 'A' + (i + 1)),
    pickupPointIds: o.pickupPointIds || ['pk-1', 'pk-2'],
  }
}

let st
let AID
function raw(actor, payload) {
  return reduceCommand(st, {
    actor: { userId: actor }, requestId: genId('req'),
    expectedRevision: st.revision, fingerprint: fp(payload), payload,
  }, CTX())
}
function run(actor, payload, label) {
  const r = raw(actor, payload)
  if (!r.ok) {
    failed++
    console.error('  ✗ 前置失败 [' + label + ']：' + r.error.code + ' ' + r.error.message)
    throw new Error('setup failed: ' + label)
  }
  st = r.value.state
  return r.value
}
function rejects(actor, payload, code, label) {
  const r = raw(actor, payload)
  check(label + ' → 被拒 ' + code, !r.ok && r.error.code === code, r.ok ? '竟然成功了' : r.error)
  return r.ok ? null : r.error
}
/** 每个 case 一份干净账本：5 份档案 + 一场已发布活动 + 按 trips 报名。 */
function boot(trips, opts) {
  st = emptyState()
  for (const u of [OWNER].concat(P)) run(u, { type: 'profile.save', person: person(u) }, '档案 ' + u)
  AID = run(OWNER, { type: 'activity.create', input: activityInput(opts) }, '创建草稿').targetIds[0]
  run(OWNER, { type: 'activity.publish', activityId: AID, participation: input(OWNER, (trips || {})[OWNER] || SELF) }, '发布')
  for (const u of P) {
    if (!trips || !trips[u]) continue
    run(u, { type: 'signup.submit', activityId: AID, keepTogether: false, mode: 'apply', participants: [input(u, trips[u])] }, '报名 ' + u)
  }
}
function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: NOW,
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
}

const signupOf = userId => (st.signups.find(s => s.activityId === AID && s.personRef.userId === userId) || {}).id
const orgView = () => selectView(st, { userId: OWNER }, { kind: 'activity', activityId: AID, perspective: 'organizer' }, NOW)
const partView = userId => selectView(st, { userId: userId || OWNER }, { kind: 'activity', activityId: AID, perspective: 'participant' }, NOW)
const rowOf = (id, view) => (view || orgView()).rows.find(r => r.signupId === id)
const attendanceOf = id => st.attendance.find(a => a.signupId === id)
const phaseOf = () => st.activities.find(a => a.id === AID).phase

const checkin = id => run(OWNER, { type: 'attendance.checkin', activityId: AID, signupId: id,
  checkIn: { method: 'manual', evidence: { at: NOW, by: OWNER, note: '到场' } } }, '签到')
const depart = id => run(OWNER, { type: 'attendance.departure', activityId: AID, signupId: id,
  outcome: { kind: 'joined', evidence: { at: NOW, by: OWNER, note: '随队出发' } } }, '核实随队出发')
const home = id => run(OWNER, { type: 'attendance.home', activityId: AID, signupId: id, note: '已到家' }, '确认到家')
const board = (id, leg) => run(OWNER, { type: 'attendance.board', activityId: AID, signupId: id, leg, boarded: true, note: '清点' }, '上车 ' + leg)
const assign = (id, vehicleId, seat) => run(OWNER, { type: 'assignment.set', activityId: AID, target: { signupId: id, vehicleId, seatLabel: seat } }, '指派 ' + seat)
const transition = (next, reason) => run(OWNER, { type: 'activity.transition', activityId: AID, next, reason }, '推进 ' + next)
const vehicleAtt = list => list.every(x => x.returnPlan === 'own')

try {
  /* ================= Case 1 + 5：全部 self，0 车辆 0 司机 0 分配 ================= */
  section('Case 1 + 5：全部 self 的活动，零车辆走完整个生命周期')
  boot({ [OWNER]: SELF, [P[0]]: SELF, [P[1]]: SELF, [P[2]]: SELF })
  const c1 = FOUR.map(signupOf)
  check('Case 1 前置：4 人已确认，且全程无人需要车',
    st.signups.filter(s => s.status === 'confirmed').length === 4 && st.signups.every(s => s.trip.mode === 'self'))
  check('Case 1 前置：0 vehicle / 0 assignment', st.vehicles.length === 0 && st.assignments.length === 0)
  let v = orgView()
  check('投影：每行都带结构化 tripMode=self（不再只有文案）',
    v.rows.length === 4 && v.rows.every(r => r.tripMode === 'self'), v.rows.map(r => r.tripMode))
  check('投影：分桶为 全部4 / 自行到达4 / 已安排0 / 待安排0',
    v.counters.confirmed === 4 && v.counters.selfTravel === 4 && v.counters.vehicleTravel === 0
    && v.counters.assigned === 0 && v.counters.unassigned === 0, v.counters)
  check('D6 写入源头：self 的返程事实在库里就是 own，不是 assigned',
    st.attendance.every(a => a.returnPlan.kind === 'own'), st.attendance.map(a => a.returnPlan.kind))
  check('投影：self 行不再被投成「原车返程」', vehicleAtt(v.rows), v.rows.map(r => r.returnPlan))

  transition('gathering', '按期集合')
  v = orgView()
  check('D2/D5 修复：集合阶段不向全员 self 的活动广播任何乘车类动作',
    v.permittedActions.indexOf('attendance.board') === -1 && v.permittedActions.indexOf('attendance.returnPlan') === -1,
    v.permittedActions.filter(t => t.indexOf('attendance') === 0))
  for (const id of c1) checkin(id)
  check('投影：self 行 needsOutboundBoarding / needsSeatAssignment 全 false',
    orgView().rows.every(r => r.needsOutboundBoarding === false && r.needsSeatAssignment === false))
  for (const id of c1) depart(id)
  transition('active', '全员出发')
  check('Case 1：全员 self 在 0 车辆下 gathering→active', phaseOf() === 'active')
  check('D5 修复：active 阶段仍不广播 board/returnPlan',
    orgView().permittedActions.indexOf('attendance.board') === -1
    && orgView().permittedActions.indexOf('attendance.returnPlan') === -1)
  transition('closing', '收队')
  for (const id of c1) home(id)
  transition('archived', '归档')
  check('Case 1：全部 self 的活动完成归档', phaseOf() === 'archived')
  check('Case 1 硬指标：全程 0 vehicle / 0 driver / 0 assignment',
    st.vehicles.length === 0 && st.vehicles.reduce((n, x) => n + x.drivers.length, 0) === 0 && st.assignments.length === 0,
    { vehicles: st.vehicles.length, assignments: st.assignments.length })

  /* ============ Case 5b：pickupPoint 判定为活动级集合点，不放宽 ============ */
  section('Case 5b：0 个集合点仍拒绝发布（判定：集合点承载「统一集合/现场清点」语义，不因 self 放宽）')
  st = emptyState()
  run(OWNER, { type: 'profile.save', person: person(OWNER) }, '档案')
  AID = run(OWNER, { type: 'activity.create', input: activityInput({ pickupPoints: 0 }) }, '创建（无集合点）').targetIds[0]
  check('Case 5b 前置：草稿阶段允许没有集合点（约束只在发布与之后生效）', phaseOf() === 'draft')
  const err5b = rejects(OWNER, { type: 'activity.publish', activityId: AID, participation: input(OWNER, SELF) },
    'INVALID_INPUT', '全员 self 也不能免掉集合点后发布')
  check('Case 5b：拒绝理由出自「集合信息」缺失，判定依据见 editor.wxml:243 的产品文案',
    !!err5b && err5b.message.indexOf('集合信息') !== -1, err5b)

  /* ================= Case 2：全部 shared，车辆约束一格没松 ================= */
  section('Case 2：全部 shared —— 现有车辆体系未被削弱')
  boot({ [OWNER]: at('pk-1'), [P[0]]: at('pk-1'), [P[1]]: at('pk-2'), [P[2]]: at('pk-2') })
  const c2 = FOUR.map(signupOf)
  check('Case 2 前置：4 人 shared 全部已确认', c2.every(Boolean) && st.signups.filter(s => s.trip.mode === 'shared').length === 4)
  check('D6：shared 的返程安排仍默认 assigned（原车返程未被改掉）',
    st.attendance.every(a => a.returnPlan.kind === 'assigned'))
  v = orgView()
  check('投影：4 人全部计入待安排车辆，自行到达=0',
    v.counters.unassigned === 4 && v.counters.selfTravel === 0 && v.counters.vehicleTravel === 4, v.counters)
  const VID2 = run(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null, input: vehicleInput() }, '登记车辆').targetIds[0]
  rejects(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null,
    input: Object.assign(vehicleInput({ label: '座号不符', seats: 1 }), { legalCapacity: 7 }) },
  'INVALID_INPUT', 'Case 2：座号数量必须等于可用乘客位')
  rejects(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null,
    input: vehicleInput({ label: '越界', pickupPointIds: ['pk-x'] }) },
  'INVALID_INPUT', 'Case 2：车辆覆盖的上车点必须属于本场')
  for (const [i, id] of c2.entries()) assign(id, VID2, 'A' + (i + 1))
  rejects(OWNER, { type: 'assignment.set', activityId: AID, target: { signupId: c2[0], vehicleId: VID2, seatLabel: 'A2' } },
    'SEAT_TAKEN', 'Case 2：同一座位不能安排两位参与者')
  const VID2B = run(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null,
    input: vehicleInput({ label: '只走 pk-2', plate: 'B', pickupPointIds: ['pk-2'] }) }, '登记第二辆车').targetIds[0]
  rejects(OWNER, { type: 'assignment.set', activityId: AID, target: { signupId: c2[0], vehicleId: VID2B, seatLabel: 'A3' } },
    'PICKUP_MISMATCH', 'Case 2：车辆不经过该参与者的上车点时不能指派（self 不影响这条）')
  v = orgView()
  check('投影：全部安排后待安排归零、已安排=4',
    v.counters.unassigned === 0 && v.counters.assigned === 4, v.counters)
  transition('gathering', '集合')
  for (const id of c2) checkin(id)
  rejects(OWNER, { type: 'attendance.departure', activityId: AID, signupId: c2[0],
    outcome: { kind: 'joined', evidence: { at: NOW, by: OWNER, note: '已签到就想出发' } } },
  'UNRESOLVED_DEPARTURE', 'Case 2：已签到但未上车的 shared 不能核实随队出发')
  for (const id of c2) board(id, 'outbound')
  run(OWNER, { type: 'vehicle.depart', activityId: AID, vehicleId: VID2, leg: 'outbound', note: '发车' }, '去程本程发车')
  for (const id of c2) depart(id)
  transition('active', '出发')
  run(OWNER, { type: 'attendance.returnPlan', activityId: AID, signupId: c2[3], plan: 'independent', note: '另有安排，已电话核实' }, '一人另行返程')
  rejects(OWNER, { type: 'vehicle.depart', activityId: AID, vehicleId: VID2, leg: 'return', note: '未清点就发车' },
    'UNRESOLVED_DEPARTURE', 'Case 2：按原车返程的人未清点时不能发返程车')
  for (const id of c2.slice(0, 3)) board(id, 'return')
  run(OWNER, { type: 'vehicle.depart', activityId: AID, vehicleId: VID2, leg: 'return', note: '返程发车' }, '返程本程发车')
  check('Case 2：另行返程的人不阻塞车辆返程发车（needsReturnBoarding 只对按原车返程成立）',
    st.vehicles.find(x => x.id === VID2).legs.return.departed !== null)
  transition('closing', '收队')
  for (const id of c2) home(id)
  run(OWNER, { type: 'vehicle.complete', activityId: AID, vehicleId: VID2, leg: 'return', note: '抵达' }, '返程完成')
  transition('archived', '归档')
  check('Case 2：全部 shared 的车辆链路完整走完', phaseOf() === 'archived')

  /* ================= Case 3：混合出行 ================= */
  section('Case 3：混合 self + shared 共存于同一次生命周期')
  boot({ [OWNER]: SELF, [P[0]]: SELF, [P[1]]: at('pk-1'), [P[2]]: at('pk-2') })
  const sSelf = [signupOf(OWNER), signupOf(P[0])]
  const sShared = [signupOf(P[1]), signupOf(P[2])]
  const VID3 = run(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null, input: vehicleInput() }, '登记车辆').targetIds[0]
  v = orgView()
  check('投影：混合活动分桶为 全部4 / 自行2 / 需乘车2 / 待安排2 / 已安排0',
    v.counters.confirmed === 4 && v.counters.selfTravel === 2 && v.counters.vehicleTravel === 2
    && v.counters.unassigned === 2 && v.counters.assigned === 0, v.counters)
  check('投影：同一份 rows 里两类人靠 tripMode 区分',
    v.rows.filter(r => r.tripMode === 'self').length === 2 && v.rows.filter(r => r.tripMode === 'shared').length === 2)
  transition('gathering', '集合')
  for (const id of sSelf.concat(sShared)) checkin(id)
  check('Case 3：self 已签到但不需要上车，shared 需要',
    sSelf.every(id => rowOf(id).needsOutboundBoarding === false) && sShared.every(id => rowOf(id).needsOutboundBoarding === true))
  assign(sShared[0], VID3, 'A1')
  assign(sShared[1], VID3, 'A2')
  check('Case 3 正对照：排到车之后活动就广播 board（约束不因 self 存在而放宽）',
    orgView().permittedActions.indexOf('attendance.board') !== -1,
    orgView().permittedActions.filter(t => t.indexOf('attendance') === 0))
  board(sShared[0], 'outbound')
  board(sShared[1], 'outbound')
  run(OWNER, { type: 'vehicle.depart', activityId: AID, vehicleId: VID3, leg: 'outbound', note: '发车' }, '去程本程发车')
  for (const id of sSelf.concat(sShared)) depart(id)
  transition('active', '出发')
  check('Case 3：两类参与者汇合到同一个 active', phaseOf() === 'active')
  transition('closing', '收队')
  for (const id of sSelf.concat(sShared)) home(id)
  transition('archived', '归档')
  check('Case 3：混合出行走到归档，车辆只载了需要乘车的 2 人',
    phaseOf() === 'archived' && st.assignments.length === 2)

  /* ================= Case 4：shared 未分配不得伪造 boarding ================= */
  section('Case 4：shared 未分配被卡住，self 不受牵连')
  boot({ [OWNER]: SELF, [P[0]]: at('pk-1') })
  const idSelf4 = signupOf(OWNER)
  const idShared4 = signupOf(P[0])
  transition('gathering', '集合')
  checkin(idSelf4)
  checkin(idShared4)
  rejects(OWNER, { type: 'attendance.board', activityId: AID, signupId: idShared4, leg: 'outbound', boarded: true, note: '没车也想记上车' },
    'INVALID_INPUT', 'Case 4：未分配车辆不能伪造去程上车')
  rejects(OWNER, { type: 'attendance.departure', activityId: AID, signupId: idShared4,
    outcome: { kind: 'joined', evidence: { at: NOW, by: OWNER, note: 'x' } } },
  'UNRESOLVED_DEPARTURE', 'Case 4：未上车的 shared 不能核实随队出发')
  depart(idSelf4)
  check('Case 4：同一场活动里 self 已推进，shared 仍卡在待安排',
    rowOf(idSelf4).departure === 'joined' && rowOf(idShared4).needsSeatAssignment === true)
  rejects(OWNER, { type: 'activity.transition', activityId: AID, next: 'active', reason: '想跳过' },
    'UNRESOLVED_DEPARTURE', 'Case 4：还有未核实到位的 shared 参与者时活动不能进 active')

  /* ================= Case 6：self 永不允许 assignment ================= */
  section('Case 6：self 不接受车辆/座位分配，自动分车也把他排除在外')
  boot({ [OWNER]: SELF, [P[0]]: at('pk-1') })
  const idSelf6 = signupOf(OWNER)
  const idShared6 = signupOf(P[0])
  const VID6 = run(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null, input: vehicleInput() }, '登记车辆').targetIds[0]
  rejects(OWNER, { type: 'assignment.set', activityId: AID, target: { signupId: idSelf6, vehicleId: VID6, seatLabel: 'A1' } },
    'INVALID_INPUT', 'Case 6：给 self 指派座位')
  check('Case 6：拒绝后确实没有产生 assignment', st.assignments.length === 0)
  const plan6 = planAssignments(st, { userId: OWNER }, AID, NOW)
  check('Case 6：自动分车方案的乘客集合里没有 self',
    plan6.ok && plan6.value.assignments.every(a => a.signupId !== idSelf6), plan6.ok ? plan6.value.assignments : plan6.error)
  check('Case 6：self 也不出现在 unassigned 提示里（他不是缺事项）',
    plan6.ok && plan6.value.unassigned.every(x => x.signupId !== idSelf6), plan6.ok ? plan6.value.unassigned : null)
  rejects(OWNER, { type: 'assignment.swap', activityId: AID, firstSignupId: idSelf6, secondSignupId: idShared6 },
    'NOT_FOUND', 'Case 6：交换座位也不能把 self 拉进车里')

  /* ================= Case 7：self 不需要 boarding，UI 也拿不到这个动作 ================= */
  section('Case 7：self 签到后即可核实出发，投影不提供 board/returnPlan')
  boot({ [OWNER]: SELF, [P[0]]: SELF })
  const idSelf7 = signupOf(OWNER)
  const idSelf7b = signupOf(P[0])
  run(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null, input: vehicleInput() }, '登记一辆闲置车').targetIds[0]
  transition('gathering', '集合')
  v = orgView()
  check('D2/D5 修复：活动里有车也不会向 self 广播 board',
    v.permittedActions.indexOf('attendance.board') === -1, v.permittedActions.filter(t => t.indexOf('attendance') === 0))
  check('投影：self 行 needsOutboundBoarding=false、needsReturnBoarding=false',
    v.rows.every(r => r.needsOutboundBoarding === false && r.needsReturnBoarding === false))
  const e7a = rejects(OWNER, { type: 'attendance.board', activityId: AID, signupId: idSelf7, leg: 'outbound', boarded: true, note: '强行' },
    'WRONG_PHASE', 'Case 7：self 记录去程上车')
  check('Case 7 拒绝文案指向出行方式而非「先安排车辆」（不再误导去分车）',
    !!e7a && e7a.message.indexOf('自行前往') !== -1 && e7a.message.indexOf('安排本人的乘坐车辆') === -1, e7a)
  rejects(OWNER, { type: 'attendance.board', activityId: AID, signupId: idSelf7, leg: 'return', boarded: true, note: '强行' },
    'WRONG_PHASE', 'Case 7：self 记录返程上车')
  checkin(idSelf7)
  checkin(idSelf7b)
  depart(idSelf7)
  depart(idSelf7b)
  transition('active', '出发')
  check('Case 7：self 无 boarding 也能 签到→核实出发→active', phaseOf() === 'active')
  rejects(OWNER, { type: 'attendance.returnPlan', activityId: AID, signupId: idSelf7, plan: 'independent', note: '自行回家' },
    'WRONG_PHASE', 'D6：self 无法被写入任何返程乘车安排')

  /* ================= Case 8：shared → self 的解除必须干净 ================= */
  section('Case 8：已分车的 shared 改为 self，assignment 与返程事实一起解除')
  boot({ [OWNER]: at('pk-1'), [P[0]]: SELF })
  const id8 = signupOf(OWNER)
  const id9 = signupOf(P[0])
  const VID8 = run(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null, input: vehicleInput() }, '登记车辆').targetIds[0]
  assign(id8, VID8, 'A1')
  check('Case 8 前置：assignment 已存在', st.assignments.length === 1)
  run(OWNER, { type: 'signup.edit', activityId: AID, signupId: id8, participant: person(OWNER), trip: SELF, purpose: '改为自行前往' }, 'shared → self')
  check('Case 8：assignment 被正确解除，无残留', st.assignments.length === 0)
  check('Case 8：返程事实同步改为 own（不留 assigned 脏事实）', attendanceOf(id8).returnPlan.kind === 'own')
  check('Case 8：没有伪造出任何上车事实',
    attendanceOf(id8).boardingByLeg.outbound === null && attendanceOf(id8).boardingByLeg.return === null)
  check('投影：翻转后该行不再需要座位安排且 tripMode=self',
    rowOf(id8).needsSeatAssignment === false && rowOf(id8).tripMode === 'self')

  /* ================= Case 9：self → shared 只回到待分车 ================= */
  section('Case 9：self 改 shared 后进入待安排车辆，系统不伪造 assignment')
  run(P[0], { type: 'signup.edit', activityId: AID, signupId: id9, participant: person(P[0]), trip: at('pk-2'), purpose: '改为搭乘车辆' }, 'self → shared')
  check('Case 9：没有自动产生任何 assignment', st.assignments.length === 0)
  check('Case 9：返程事实恢复为 assigned（重新纳入本车返程清点）',
    attendanceOf(id9).returnPlan.kind === 'assigned')
  v = orgView()
  check('投影：该行进入待安排车辆', rowOf(id9).needsSeatAssignment === true && v.counters.unassigned === 1)
  const plan9 = planAssignments(st, { userId: OWNER }, AID, NOW)
  check('Case 9：自动分车预览把他排进方案，但仅止于预览（须领队确认）',
    plan9.ok && plan9.value.assignments.some(a => a.signupId === id9) && st.assignments.length === 0)

  /* ================= Case 10：产生乘车事实之后禁止切换 ================= */
  section('Case 10：已上车的参与者不能改成 self（不能绕过乘车事实）')
  transition('gathering', '集合')
  checkin(id9)
  assign(id9, VID8, 'A3')
  board(id9, 'outbound')
  const e10 = rejects(P[0], { type: 'signup.edit', activityId: AID, signupId: id9, participant: person(P[0]), trip: SELF, purpose: '上车后想改成自行' },
    'WRONG_PHASE', 'Case 10：本人已上车后改 self')
  check('Case 10：拒绝理由出自资料锁 travelLocked', !!e10 && e10.message.indexOf('锁定') !== -1, e10)
  const e10b = rejects(OWNER, { type: 'signup.edit', activityId: AID, signupId: id9, participant: person(P[0]), trip: SELF, purpose: '领队协调也不行' },
    'WRONG_PHASE', 'Case 10：领队集合期的协调门同样放过不了已上车者')
  check('Case 10：owner 走的也是同一道 travelLocked（不是权限差异）', !!e10b && e10b.message === e10.message, e10b)
  check('Case 10：trip.mode 未被改写，仍为 shared', st.signups.find(s => s.id === id9).trip.mode === 'shared')
  check('Case 10：既有上车事实未被抹除', attendanceOf(id9).boardingByLeg.outbound !== null)

  /* ================= 不变量兜底：脏数据进不了库 ================= */
  section('不变量：self 的「零乘车事实」由 invariants 兜底，而不是只靠调用顺序')
  const dirty1 = deepClone(st)
  dirty1.attendance.find(a => a.signupId === id8).boardingByLeg.outbound = { at: NOW, by: OWNER, note: '手插' }
  const inv1 = assertInvariants(dirty1)
  check('self + 去程上车事实 → 拒绝（新钉）', !inv1.ok && inv1.error.message.indexOf('自行到达者不能留下上车事实') !== -1, inv1.error)
  const dirty2 = deepClone(st)
  dirty2.attendance.find(a => a.signupId === id9).returnPlan = { kind: 'own' }
  const inv2 = assertInvariants(dirty2)
  check('shared + own 返程安排 → 拒绝（own 只能属于自行前往者）', !inv2.ok, inv2.error)
  const dirty3 = deepClone(st)
  dirty3.assignments.push({ activityId: AID, signupId: id8, vehicleId: VID8, seatLabel: 'A5' })
  const inv3 = assertInvariants(dirty3)
  check('self + 座位分配 → 拒绝（既有约束保持不变）', !inv3.ok && inv3.error.message.indexOf('自行到达者不能分配乘客座位') !== -1, inv3.error)

  /* ================= D7：上车点缺失绝不投影成 self ================= */
  section('D7：需要乘车的人即使上车点信息缺失，也仍然是「需要乘车」')
  const stale = deepClone(st)
  stale.activities.find(a => a.id === AID).pickupPoints = [
    { id: 'pk-1', name: '茶店子', meetingAt: '2026-10-01T07:00:00+08:00', address: 'a', coordinates: null }]
  stale.signups.find(s => s.id === id9).trip = { mode: 'shared', pickupPointId: 'pk-2' }
  const staleView = selectView(stale, { userId: OWNER }, { kind: 'activity', activityId: AID, perspective: 'organizer' }, NOW)
  const staleRow = staleView.rows.find(r => r.signupId === id9)
  check('投影：tripMode 仍为 shared，不因上车点消失而降级成 self', staleRow.tripMode === 'shared')
  check('投影：pickupPointId 原样带出，文案给「信息缺失」而不是「自行前往」',
    staleRow.pickupPointId === 'pk-2' && staleRow.pickup === '上车点信息缺失',
    { pickup: staleRow.pickup, pickupPointId: staleRow.pickupPointId })
  check('不变量：域内本就禁止这种悬挂状态入库', !assertInvariants(stale).ok, assertInvariants(stale).error)
  boot({ [OWNER]: SELF, [P[0]]: at('pk-2') })
  const dropInput = activityInput()
  dropInput.pickupPoints = [{ id: 'pk-1', name: '茶店子', meetingAt: '2026-10-01T07:00:00+08:00', address: '地铁口', coordinates: null }]
  rejects(OWNER, { type: 'activity.edit', activityId: AID, input: dropInput },
    'INVALID_INPUT', 'D7 服务端防线：删除仍被 shared 报名引用的上车点')

  /* ================= 导出面：出行方式成为一等列 ================= */
  section('导出：出行方式是独立列，车辆类事实对 self 记「不适用」')
  boot({ [OWNER]: SELF, [P[0]]: at('pk-1') })
  const VIDX = run(OWNER, { type: 'vehicle.save', activityId: AID, vehicleId: null, input: vehicleInput() }, '登记车辆').targetIds[0]
  const xSelf = signupOf(OWNER)
  const xShared = signupOf(P[0])
  assign(xShared, VIDX, 'A1')
  const csvRes = selectExport(st, { userId: OWNER }, AID, [xSelf, xShared], 'ordinary', '行前核对', NOW)
  check('selectExport → ok', csvRes.ok, csvRes.error)
  const csv = String(csvRes.value)
  const csvLines = csv.split('\r\n')
  check('导出表头含「出行方式」独立列', csvLines[0].indexOf('"出行方式"') !== -1, csvLines[0])
  check('导出：self 行 = 自行前往 + 车辆/座位/上下车均「不适用」',
    csvLines[1].indexOf('"自行前往"') !== -1 && csvLines[1].indexOf('"搭乘车辆"') === -1
    && (csvLines[1].match(/"不适用"/g) || []).length === 4, csvLines[1])
  check('导出：shared 行仍给车辆与座位事实',
    csvLines[2].indexOf('"搭乘车辆"') !== -1 && csvLines[2].indexOf('"1号车"') !== -1
    && csvLines[2].indexOf('"A1"') !== -1 && csvLines[2].indexOf('"不适用"') === -1, csvLines[2])

  /* ================= 参与者视角 detailState ================= */
  section('detailState：就绪与否由义务标志决定，不再由中文文案决定')
  check('投影：self 参与者视角 detailState=ready（无待办乘车安排）',
    partView(OWNER).detailState === 'ready', partView(OWNER).detailState)
  const sharedState = deepClone(st)
  sharedState.signups.find(s => s.id === xShared).trip = { mode: 'shared', pickupPointId: 'pk-1' }
  sharedState.assignments = sharedState.assignments.filter(a => a.signupId !== xShared)
  const sharedView = selectView(sharedState, { userId: P[0] }, { kind: 'activity', activityId: AID, perspective: 'participant' }, NOW)
  check('投影：待安排的 shared 参与者 detailState=confirmed（等待分车），不是 ready',
    sharedView.detailState === 'confirmed', { detailState: sharedView.detailState, needs: sharedView.rows.map(r => r.needsSeatAssignment) })
  const legacy = deepClone(st)
  legacy.attendance.find(a => a.signupId === xSelf).returnPlan = { kind: 'assigned' }
  const legacyView = selectView(legacy, { userId: OWNER }, { kind: 'activity', activityId: AID, perspective: 'participant' }, NOW)
  check('投影：老数据里 self 残留的 assigned 被按出行方式归一为 own（无需回填）',
    legacyView.rows.find(r => r.signupId === xSelf).returnPlan === 'own',
    legacyView.rows.map(r => r.returnPlan))
} catch (e) {
  failed++
  console.error('  ✗ 用例中断：' + e.message)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
