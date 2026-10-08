// 生命周期模型驱动器（供 tools/lifecycle-*-test.js 复用）。
//
// 为什么存在：本仓库既有测试各自搭一次性的 fixture，能证明「想到的场景」，
// 但没法系统地跑「任意命令序列」。这里把 reduceCommand 包成一个可复现的世界：
//   · 确定性时钟（context.now 由测试推进）与确定性 id（计数器），所以 seed ⇒ 状态可复现；
//   · 每一步都自动跑 assertInvariants —— 状态永远合法是硬约束，不是抽查；
//   · 被拒绝的命令必须零副作用（前后快照逐字节相同），这条抓的是「半成功」；
//   · checkOracles 由本次审计从业务规格独立重写一份不变量，不复用 invariants.js 的实现。
//     这样即便 invariants.js 自己被改松了，oracle 仍会红（变异自证的同一思路）。
//
// 所有 fixture 都是**通过真实命令**建立的：绝不手工拼 State，
// 否则测的是「我造出来的状态」而不是「系统能到达的状态」。
// 与 wx-server-sdk 无关：只 require domain/，可在纯 Node 下跑，能进门禁。
'use strict'

const crypto = require('crypto')
const S = require('../cloudfunctions/trailApi/domain/schema')
const { reduceCommand } = require('../cloudfunctions/trailApi/domain/commands')
const { assertInvariants } = require('../cloudfunctions/trailApi/domain/invariants')
const { canonicalPayload, deepClone } = require('../cloudfunctions/trailApi/domain/contracts')
const { canExecute } = require('../cloudfunctions/trailApi/domain/permissions')
const selectors = require('../cloudfunctions/trailApi/domain/selectors')
const { planAssignments } = require('../cloudfunctions/trailApi/domain/allocation')

const PHASES = S.Activity.keys.phase.values.slice()
const SIGNUP_STATUSES = S.Signup.keys.status.values.slice()
const COMMAND_TYPES = Object.keys(S.Payload.map)
const LIVE_SIGNUP = ['pending', 'confirmed', 'waitlisted']
const TRAVELLER = ['pending', 'confirmed']

function fingerprint(payload) {
  return crypto.createHash('sha256').update(canonicalPayload(payload), 'utf8').digest('hex')
}

function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: '2026-10-08T07:00:00+08:00',
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
}

/* ---------- 独立 oracle：从业务规格重写，不引用 invariants.js ---------- */

const unique = list => new Set(list).size === list.length

/**
 * 返回违反的不变量描述数组（空数组 = 状态健康）。
 * 每条都写成「任意可达状态下都必须成立」的断言，而不是某场景的期望值。
 */
function checkOracles(state) {
  const bad = []
  const fail = m => bad.push(m)
  // 标识唯一是一切引用关系的前提：任何一条记录 id 撞车都会让「按 id 查找」的整层逻辑错位。
  // 注意 attendance/assignments/positions 用 signupId 作主键，它们没有 id 字段。
  for (const [name, list, key] of [['activities', state.activities], ['signups', state.signups],
    ['vehicles', state.vehicles], ['groups', state.groups], ['profiles', state.profiles],
    ['attendance', state.attendance, 'signupId'], ['assignments', state.assignments, 'signupId'],
    ['positions', state.positions, 'signupId'], ['memberships', state.memberships],
    ['incidents', state.incidents], ['events', state.events], ['notices', state.notices]]) {
    const ids = list.map(x => (key ? x[key] : x.id))
    if (!unique(ids)) fail('O-DUP-ID: ' + name + ' 存在重复标识')
  }
  const acts = new Map(state.activities.map(a => [a.id, a]))
  const signs = new Map(state.signups.map(s => [s.id, s]))
  const vehs = new Map(state.vehicles.map(v => [v.id, v]))
  const groups = new Map(state.groups.map(g => [g.id, g]))
  const att = new Map(state.attendance.map(a => [a.signupId, a]))
  const isShared = s => !!s && s.trip.mode === 'shared'

  // 一、报名 ↔ 履约记录：双射
  if (att.size !== state.attendance.length) fail('O-ATT-DUP: 同一报名存在多份履约记录')
  if (att.size !== signs.size) fail('O-ATT-CARD: 履约记录数与报名数不等')
  for (const s of state.signups) {
    if (!att.has(s.id)) fail('O-ATT-MISSING: 报名 ' + s.id + ' 没有履约记录')
  }
  for (const a of state.attendance) {
    if (!signs.has(a.signupId)) fail('O-ATT-ORPHAN: 履约记录 ' + a.signupId +  ' 指向不存在的报名')
  }

  // 二、引用完整性：报名/分配/授权都必须落在同一场活动内
  for (const s of state.signups) {
    if (!acts.has(s.activityId)) fail('O-REF-ACTIVITY: 报名 ' + s.id + ' 指向不存在的活动')
    const g = groups.get(s.groupId)
    if (!g) fail('O-REF-GROUP: 报名 ' + s.id + ' 指向不存在的同行组')
    else if (g.activityId !== s.activityId || g.submittedByUserId !== s.submittedByUserId) fail('O-REF-GROUP-SCOPE: 报名 ' + s.id + ' 的组跨活动或提交者不符')
    if (isShared(s) && LIVE_SIGNUP.indexOf(s.status) !== -1 && acts.has(s.activityId)
      && !acts.get(s.activityId).pickupPoints.some(p => p.id === s.trip.pickupPointId)) {
      // 需要乘车、且还在流程里的人，其上车点必须是本场存在的集合点——否则「他要从哪里上车」没有答案。
      // 已取消/已移除/未通过的人是历史行，不钉住集合点（审计 F2 的规格立场）。
      fail('O-PICKUP-DANGLING: 报名 ' + s.id + ' 的上车点 ' + s.trip.pickupPointId + ' 不属于本场集合点')
    }
  }
  for (const v of state.vehicles) {
    if (!acts.has(v.activityId)) fail('O-REF-VEHICLE-ACTIVITY: 车辆 ' + v.id + ' 指向不存在的活动')
    else {
      const pickups = new Set(acts.get(v.activityId).pickupPoints.map(p => p.id))
      if (v.pickupPointIds.some(id => !pickups.has(id))) fail('O-REF-VEHICLE-PICKUP: 车辆 ' + v.id + ' 引用了别的活动的集合点')
    }
    if (!v.drivers.length) fail('O-VEHICLE-NODRIVER: 车辆 ' + v.id + ' 没有任何司机')
  }
  for (const m of state.memberships) {
    if (!acts.has(m.activityId)) fail('O-REF-MEMBERSHIP: 授权 ' + m.id + ' 指向不存在的活动')
    if (m.role === 'vehicle_contact') {
      const v = vehs.get(m.vehicleId)
      if (!v || v.activityId !== m.activityId) fail('O-REF-MEMBERSHIP-VEHICLE: 车辆联系人 ' + m.id + ' 绑定了非法车辆')
    }
    if (m.role === 'staff' && m.scope.kind === 'selected') {
      if (m.scope.signupIds.some(id => !signs.has(id) || signs.get(id).activityId !== m.activityId)) fail('O-REF-MEMBERSHIP-SCOPE: 协作分管名单含非法报名')
    }
  }

  // 三、座位：一人一车、一号一人、不超乘客位、self 不得占座、司机不得占乘客座
  const bySignup = new Map()
  const seats = new Set()
  const perVehicle = new Map()
  for (const a of state.assignments) {
    const s = signs.get(a.signupId)
    const v = vehs.get(a.vehicleId)
    if (!s || !v) fail('O-REF-ASSIGN: 分配 ' + a.signupId + ' 引用了不存在的报名或车辆')
    if (s && v && (s.activityId !== a.activityId || v.activityId !== a.activityId)) fail('O-REF-ASSIGN-SCOPE: 分配 ' + a.signupId + ' 的报名与车辆不同场')
    if (bySignup.has(a.signupId)) fail('O-ASSIGN-DUP: 报名 ' + a.signupId + ' 同时被分到两辆车')
    bySignup.set(a.signupId, a)
    if (a.seatLabel !== null) {
      const key = a.vehicleId + '#' + a.seatLabel
      if (seats.has(key)) fail('O-SEAT-TAKEN: ' + key + ' 被两位参与者占用')
      seats.add(key)
      if (v && (!v.seatLabels || v.seatLabels.indexOf(a.seatLabel) === -1)) fail('O-SEAT-UNKNOWN: ' + key + ' 不在该车的座号表里')
    }
    if (s && s.trip.mode === 'self') fail('O-SELF-ASSIGNED: 自行前往的 ' + s.id + ' 却占着乘客座位')
    if (s && s.status !== 'confirmed') fail('O-NONCONF-ASSIGNED: 报名 ' + s.id + ' 状态为 ' + s.status + ' 却占着座位')
    if (s && isShared(s) && v && v.pickupPointIds.indexOf(s.trip.pickupPointId) === -1) fail('O-PICKUP-MISMATCH: ' + s.id + ' 的上车点不在车辆线路上')
    if (v) perVehicle.set(v.id, (perVehicle.get(v.id) || 0) + 1)
  }
  // 座号表 ↔ 可用乘客位（容量口径：核载 − 司机 − 不可用位）
  for (const v of state.vehicles) {
    const capacity = v.legalCapacity - v.drivers.length - v.blockedSeats
    if (capacity < 0) fail('O-VEHICLE-CAPACITY-NEG: 车辆 ' + v.id + ' 的乘客位为负（核载 ' + v.legalCapacity + '）')
    if (v.seatLabels && (v.seatLabels.length !== capacity || !unique(v.seatLabels))) fail('O-VEHICLE-SEATLABELS: 车辆 ' + v.id + ' 的座号表与乘客位数不符')
    if ((perVehicle.get(v.id) || 0) > capacity) fail('O-VEHICLE-OVERCAP: 车辆 ' + v.id + ' 乘客数 ' + perVehicle.get(v.id) + ' 超过可用位 ' + capacity)
    // 行车事实与司机身份不得互相打脸：这辆车动过，它的参与者司机就不能停留在「未出发」（审计 F1）。
    const moved = v.legs.outbound.departed || v.legs.outbound.completed || v.legs.return.departed || v.legs.return.completed
    if (moved) {
      for (const d of v.drivers) {
        if (d.kind !== 'participant') continue
        const r = att.get(d.signupId)
        if (r && r.departure && r.departure.kind === 'not_departed') fail('O-DRIVER-CONTRADICTION: 车辆 ' + v.id + ' 已有行车事实，但其司机 ' + d.signupId + ' 被核实为未出发')
      }
    }
  }
  // 一名参与者司机只能驾驶本场一辆车；同一个人不能同时是司机又占乘客位
  const drivenBy = new Map()
  for (const v of state.vehicles) {
    for (const d of v.drivers) {
      if (d.kind === 'participant') {
        if (!signs.has(d.signupId)) fail('O-REF-DRIVER: 车辆 ' + v.id + ' 的司机报名不存在')
        else if (signs.get(d.signupId).activityId !== v.activityId) fail('O-REF-DRIVER-SCOPE: 车辆 ' + v.id + ' 的司机来自其他活动')
        else if (signs.get(d.signupId).status !== 'confirmed') fail('O-DRIVER-STATUS: 参与者司机 ' + d.signupId + ' 未确认却要开车')
        if (drivenBy.has(d.signupId)) fail('O-DRIVER-DOUBLE: 报名 ' + d.signupId + ' 同时驾驶两辆车')
        drivenBy.set(d.signupId, v.id)
        if (bySignup.has(d.signupId)) fail('O-DRIVER-SEAT: 司机 ' + d.signupId + ' 同时占着乘客座位')
      } else if (d.userId !== null) {
        const key = v.activityId + '#' + d.userId
        if (drivenBy.has(key)) fail('O-DRIVER-DOUBLE-SERVICE: 服务司机 ' + d.userId + ' 本场驾驶两辆车')
        drivenBy.set(key, v.id)
      }
    }
  }

  // 四、履约事实之间的逻辑次序（历史事实不得互相矛盾）
  for (const r of state.attendance) {
    const s = signs.get(r.signupId)
    if (!s || !acts.has(s.activityId)) continue
    if (r.departure && r.departure.kind === 'joined') {
      if (s.status !== 'confirmed') fail('O-JOINED-STATUS: ' + s.id + ' 已核实随队出发，但报名状态是 ' + s.status)
      if (!r.checkIn) fail('O-JOINED-NOCHECKIN: ' + s.id + ' 未签到却被核实为已随队出发')
    }
    if (r.home && (!r.departure || r.departure.kind !== 'joined')) fail('O-HOME-NOJOIN: ' + s.id + ' 未随队出发却被确认到家')
    if (r.boardingByLeg.return && !(r.departure && r.departure.kind === 'joined')) fail('O-RETBOARD-NOJOIN: ' + s.id + ' 未出发却有返程上车')
    if (s.trip.mode === 'self' && (r.boardingByLeg.outbound || r.boardingByLeg.return)) fail('O-SELF-BOARDING: 自行前往的 ' + s.id + ' 留下了上车事实')
    if (r.returnPlan.kind === 'own' && s.trip.mode !== 'self') fail('O-OWN-PLAN-MODE: 返程「自行往返」出现在搭乘车辆的 ' + s.id + ' 身上')
    if (r.returnPlan.kind === 'independent' && !r.returnPlan.evidence.note.trim()) fail('O-IND-INDEPENDENT-NOTE: ' + s.id + ' 的另行返程没有依据')
    const points = new Set(acts.get(s.activityId).routeSnapshot.points.map(p => p.id))
    if (!unique(r.nodes.map(n => n.pointId))) fail('O-NODE-DUP: ' + s.id + ' 的路线节点记录重复')
    if (r.nodes.some(n => !points.has(n.pointId))) fail('O-NODE-DANGLING: ' + s.id + ' 有路线节点记录不属于本场路线')
  }

  // 五、活动级：名额、同人重复、终态封口
  for (const a of state.activities) {
    const roster = state.signups.filter(s => s.activityId === a.id)
    const occupiedCount = roster.filter(s => TRAVELLER.indexOf(s.status) !== -1).length
    if (occupiedCount > a.capacity) fail('O-CAPACITY: 活动 ' + a.id + ' 占用名额 ' + occupiedCount + ' 超过 capacity ' + a.capacity)
    const people = roster.filter(s => LIVE_SIGNUP.indexOf(s.status) !== -1)
      .map(s => s.personRef.kind === 'user' ? 'u:' + s.personRef.userId : 'c:' + s.personRef.ownerId + ':' + s.personRef.companionId)
    if (!unique(people)) fail('O-DUPLICATE-PERSON: 活动 ' + a.id + ' 有同一人重复占用报名资格')
    if (a.phase === 'cancelled') {
      if (a.acceptingSignups) fail('O-CANCEL-ACCEPTING: 已取消的活动 ' + a.id + ' 仍在招募')
      if (roster.some(s => LIVE_SIGNUP.indexOf(s.status) !== -1)) fail('O-CANCEL-LIVE-SIGNUP: 已取消的活动 ' + a.id + ' 仍留有有效报名')
      if (state.assignments.some(x => x.activityId === a.id)) fail('O-CANCEL-ASSIGN: 已取消的活动 ' + a.id + ' 仍留有乘车安排')
    }
    if (a.phase === 'archived') {
      for (const s of roster.filter(x => x.status === 'confirmed')) {
        const r = att.get(s.id)
        if (!r || !r.departure) fail('O-ARCHIVE-DEPARTURE: 归档活动 ' + a.id + ' 的 ' + s.id + ' 出发情况未核实')
        else if (r.departure.kind === 'coordinating') fail('O-ARCHIVE-COORDINATING: 归档活动 ' + a.id + ' 的 ' + s.id + ' 仍在协调中')
        else if (r.departure.kind === 'joined' && !r.home) fail('O-ARCHIVE-HOME: 归档活动 ' + a.id + ' 的 ' + s.id + ' 未确认到家')
      }
      if (state.incidents.some(i => i.activityId === a.id && !i.resolution)) fail('O-ARCHIVE-INCIDENT: 归档活动 ' + a.id + ' 仍有未处理异常')
    }
    if (a.phase !== 'draft' && a.phase !== 'cancelled') {
      if (!a.pickupPoints.length || !a.routeSnapshot.points.length || !a.routeSnapshot.risks.length) fail('O-PUBLISH-SHAPE: 活动 ' + a.id + ' 非草稿却缺集合点/路线/风险')
      if (!a.startAt || !a.endAt || !a.deadlineAt) fail('O-PUBLISH-TIME: 活动 ' + a.id + ' 非草稿却没有完整时间')
      else if (Date.parse(a.deadlineAt) > Date.parse(a.startAt) || Date.parse(a.startAt) >= Date.parse(a.endAt)) fail('O-TIME-ORDER: 活动 ' + a.id + ' 的截止/开始/结束顺序不正确')
    }
  }

  // 六、位置上报：一人一条；有效上报只能落在已确认且活动未取消的人身上
  if (!unique(state.positions.map(p => p.signupId))) fail('O-POSITION-DUP: 同一参与者存在多条位置上报')
  for (const p of state.positions) {
    const s = signs.get(p.signupId)
    if (!s) fail('O-POSITION-ORPHAN: 位置上报 ' + p.signupId + ' 指向不存在的报名')
    else if (p.revokedAt === null && (s.status !== 'confirmed' || acts.get(s.activityId).phase === 'cancelled')) fail('O-POSITION-LIVE: ' + p.signupId + ' 报名已非 confirmed 却仍有有效位置')
  }

  // 七、同行组同车
  for (const g of state.groups.filter(x => x.keepTogether)) {
    const ids = new Set(state.signups.filter(s => s.groupId === g.id && s.status === 'confirmed').map(s => s.id))
    const cars = new Set(state.assignments.filter(a => ids.has(a.signupId)).map(a => a.vehicleId))
    if (cars.size > 1) fail('O-GROUP-SCOPE: 同行组 ' + g.id + ' 被安排在不同车辆')
  }

  // 八、异常/通知/事件的归属
  for (const i of state.incidents) {
    if (!acts.has(i.activityId)) fail('O-REF-INCIDENT: 异常 ' + i.id + ' 指向不存在的活动')
    if (!unique(i.subjectIds)) fail('O-INCIDENT-DUPSUBJECT: 异常 ' + i.id + ' 涉及人员重复')
    if (i.subjectIds.some(id => !signs.has(id) || signs.get(id).activityId !== i.activityId)) fail('O-INCIDENT-SUBJECT: 异常 ' + i.id + ' 涉及的人员不属于本场活动')
    if (i.resolution && !i.resolution.note.trim()) fail('O-INCIDENT-RESOLVE-NOTE: 异常 ' + i.id + ' 已关闭但没有核实结果')
  }
  for (const n of state.notices) {
    if (!acts.has(n.activityId)) fail('O-REF-NOTICE: 通知 ' + n.id + ' 指向不存在的活动')
    if (n.audience.kind === 'signups' && n.audience.signupIds.some(id => !signs.has(id) || signs.get(id).activityId !== n.activityId)) fail('O-NOTICE-AUDIENCE: 通知 ' + n.id + ' 的受众不属于本场活动')
    if (n.audience.kind === 'vehicle') {
      const v = vehs.get(n.audience.vehicleId)
      if (v && v.activityId !== n.activityId) fail('O-NOTICE-AUDIENCE-VEHICLE: 通知 ' + n.id + ' 引用了其他活动的车辆')
    }
    if (Object.keys(n.readBy).some(id => !state.profiles.some(p => p.id === id))) fail('O-NOTICE-READBY: 通知 ' + n.id + ' 的已读账号不存在')
  }
  for (const e of state.events) {
    if (!acts.has(e.activityId)) fail('O-REF-EVENT: 事件 ' + e.id + ' 指向不存在的活动')
    if (!state.profiles.some(p => p.id === e.actorId)) fail('O-REF-EVENT-ACTOR: 事件 ' + e.id + ' 的操作账号不存在')
  }
  for (const r of state.receipts) {
    if (!state.profiles.some(p => p.id === r.actorId)) fail('O-RECEIPT-ACTOR: 回执 ' + r.requestId + ' 的操作账号不存在')
  }
  return bad
}

/* ---------- 世界 ---------- */

function createWorld(options) {
  const opts = options || {}
  const w = {
    state: emptyState(),
    now: opts.now || '2026-10-08T07:00:00+08:00',
    seq: 0,
    history: [],
    problems: [],
    steps: 0,
  }

  w.id = kind => kind + '-' + String(++w.seq).padStart(4, '0')
  w.tick = iso => { w.now = iso }
  w.setNow = iso => { w.now = iso }
  w.snapshot = () => JSON.stringify(w.state)
  w.cloneState = () => deepClone(w.state)
  /** 把世界倒回某个快照：用于「试探性发一条命令看域内认不认」而不污染状态。 */
  w.restore = snapshot => { w.state = JSON.parse(snapshot); w.probing = true }

  /** 把一次违规记下来（带完整上下文），不立刻抛——让一次运行尽可能多暴露问题。 */
  w.problem = (kind, detail) => {
    const entry = { kind, detail, step: w.steps, now: w.now, last: w.history[w.history.length - 1] || null }
    w.problems.push(entry)
    return entry
  }

  /**
   * 发一条命令。默认 expectedRevision 取当前 revision（正常客户端都会带上最新值）。
   * o: { requestId, expectedRevision, now, dryRun }
   * 返回 reduceCommand 的结果，另外补上 code / errorText，方便断言。
   */
  w.dispatch = (userId, payload, o) => {
    o = o || {}
    w.steps += 1
    const before = JSON.stringify(w.state)
    const revBefore = w.state.revision
    const clean = deepClone(payload)
    const res = reduceCommand(w.state, {
      actor: { userId },
      requestId: o.requestId !== undefined ? o.requestId : w.id('req'),
      expectedRevision: o.expectedRevision !== undefined ? o.expectedRevision : w.state.revision,
      fingerprint: fingerprint(clean),
      payload: clean,
    }, { now: o.now || w.now, id: w.id })
    if (res.ok) w.state = res.value.state
    const out = res.ok
      ? { ok: true, replayed: res.value.replayed, targetIds: res.value.targetIds, revision: w.state.revision }
      : { ok: false, code: res.error.code, message: res.error.message, error: res.error }
    w.history.push({ step: w.steps, userId, type: payload.type, code: out.ok ? (out.replayed ? 'replayed' : 'ok') : out.code, requestId: o.requestId })

    // 通用性质：任何一步之后，状态都必须同时满足域内不变量与独立 oracle
    const inv = assertInvariants(w.state)
    if (!inv.ok) w.problem('invariant:' + inv.error.code, inv.error.message + ' ｜ 最后命令 ' + payload.type + ' ⇒ ' + (out.ok ? 'accepted' : 'rejected ' + out.code))
    const oracle = checkOracles(w.state)
    oracle.forEach(m => w.problem('oracle', m + ' ｜ 最后命令 ' + payload.type + ' ⇒ ' + (out.ok ? 'accepted' : 'rejected ' + out.code)))

    if (!out.ok && JSON.stringify(w.state) !== before) {
      w.problem('partial-write', '被拒绝的命令（' + payload.type + ' ' + out.code + '）改动了状态')
    }
    if (out.ok && !out.replayed && w.state.revision !== revBefore + 1) {
      w.problem('revision', '命令 ' + payload.type + ' 被接受但 revision 不是 +1（' + revBefore + '→' + w.state.revision + '）')
    }
    if (out.ok && !out.replayed && !w.probing) {
      const mine = w.state.receipts.filter(r => r.actorId === userId).length
      if (mine !== w.history.filter(h => h.userId === userId && h.code === 'ok').length) {
        w.problem('receipt', '回执计数与成功命令数不一致（actor ' + userId + '）')
      }
    }
    return out
  }

  /** 绕过指纹/幂等直接试权限：用于「UI 是否给出了域内不允许的动作」的对照。 */
  w.allow = (userId, payload, at) => canExecute(w.state, { userId }, deepClone(payload), at || w.now)
  w.read = (userId, request) => selectors.selectView(w.state, { userId }, request, w.now)
  w.readActivity = (userId, activityId, perspective, extra) =>
    w.read(userId, Object.assign({ kind: 'activity', activityId, perspective }, extra || {}))
  w.transport = userId => {
    const ids = w.state.activities.map(a => a.id)
    const out = []
    for (const id of ids) {
      const r = selectors.selectTransport(w.state, { userId }, id)
      if (r.ok) out.push(r.value)
    }
    return out
  }
  w.readTransport = (userId, activityId) => selectors.selectTransport(w.state, { userId }, activityId)
  w.readExport = (userId, activityId, signupIds, mode, purpose) =>
    selectors.selectExport(w.state, { userId }, activityId, signupIds, mode, purpose === undefined ? '活动人员核对' : purpose, w.now)
  w.readForm = (userId, activityId, signupId, purpose) =>
    selectors.selectSignupForm(w.state, { userId }, activityId, signupId, purpose || '编辑报名资料', w.now)
  w.readContact = (userId, activityId, signupId) => selectors.selectContact(w.state, { userId }, activityId, signupId, w.now)
  w.readSensitive = (userId, activityId, signupId, purpose) =>
    selectors.selectSensitive(w.state, { userId }, activityId, signupId, purpose || '现场安全核对', w.now)
  w.preview = (userId, activityId) => planAssignments(w.state, { userId }, activityId, w.now)

  /* ---------- 记录查找糖 ---------- */
  w.signupOf = name => w.state.signups.find(s => s.participant.name === name) || null
  w.signupIdOf = name => { const s = w.signupOf(name); return s ? s.id : null }
  w.activityOf = title => w.state.activities.find(a => a.title === title) || null
  w.vehicleOf = label => w.state.vehicles.find(v => v.label === label) || null
  w.attendanceOf = signupId => w.state.attendance.find(a => a.signupId === signupId) || null
  w.assignmentOf = signupId => w.state.assignments.find(a => a.signupId === signupId) || null
  w.rowOf = (userId, activityId, signupId, perspective) => {
    const v = w.readActivity(userId, activityId, perspective || 'organizer')
    return v.rows ? { view: v, row: v.rows.find(r => r.signupId === signupId) || null } : { view: v, row: null }
  }

  /* ---------- fixture：全部通过真实命令建立 ---------- */

  w.profile = (userId, name) => {
    const r = w.dispatch(userId, { type: 'profile.save', person: w.person(name) })
    if (!r.ok) throw new Error('fixture 建档失败：' + name + ' ' + r.code + ' ' + r.message)
    return r
  }
  w.person = (name, phone) => ({
    name, phone: phone || '000000' + String(Math.abs(hashCode(name)) % 10000).padStart(4, '0'),
    emergency: { name: name + '家属', phone: '00000099' + String(Math.abs(hashCode(name)) % 100).padStart(2, '0') },
    medical: '',
  })
  w.companion = (userId, name) => {
    const r = w.dispatch(userId, { type: 'companion.save', companionId: null, person: w.person(name) })
    if (!r.ok) throw new Error('fixture 同行人失败：' + name + ' ' + r.code)
    return r.targetIds[0]
  }

  w.activityInput = (over) => {
    const base = {
      title: '青城后山', description: '轻徒步', organizerIntro: '领队',
      startAt: '2026-10-11T08:00:00+08:00', endAt: '2026-10-11T18:00:00+08:00',
      deadlineAt: '2026-10-10T20:00:00+08:00',
      acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
      routeSnapshot: {
        title: '飞泉沟', distanceKm: 12.8, ascentM: 680,
        points: [
          { id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 } },
          { id: 'pt-2', name: '瀑布', kind: 'checkpoint', coordinates: null },
          { id: 'pt-3', name: '终点', kind: 'finish', coordinates: null },
        ],
        risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }],
      },
      pickupPoints: [
        { id: 'pk-1', name: '茶店子', meetingAt: '2026-10-11T07:00:00+08:00', address: '地铁口', coordinates: null },
        { id: 'pk-2', name: '犀浦', meetingAt: '2026-10-11T07:20:00+08:00', address: '地铁站 B 口', coordinates: null },
      ],
      equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
    }
    return Object.assign(base, over || {})
  }

  /** 建活动并发布（默认不带发布即报名）。返回 activityId。 */
  w.createActivity = (ownerId, over) => {
    const r = w.dispatch(ownerId, { type: 'activity.create', input: w.activityInput(over) })
    if (!r.ok) throw new Error('fixture 建活动失败：' + r.code + ' ' + r.message)
    return r.targetIds[0]
  }
  w.publish = (ownerId, activityId, participation) => {
    const r = w.dispatch(ownerId, { type: 'activity.publish', activityId, participation: participation || null })
    if (!r.ok) throw new Error('fixture 发布失败：' + r.code + ' ' + r.message)
    return activityId
  }
  w.participantInput = (userId, name, trip, companionId) => ({
    personRef: companionId ? { kind: 'companion', ownerId: userId, companionId } : { kind: 'user', userId },
    participant: w.person(name),
    trip: trip || { mode: 'shared', pickupPointId: 'pk-1' },
    consent: { dataUse: true, proxyAuthority: !!companionId, proxyHome: false },
  })
  /** 单人报名；approvalMode=manual 时自动由领队确认（除非 keepPending）。 */
  w.signup = (userId, activityId, name, trip, opts) => {
    opts = opts || {}
    const r = w.dispatch(userId, {
      type: 'signup.submit', activityId, keepTogether: !!opts.keepTogether, mode: opts.mode || 'apply',
      participants: [w.participantInput(userId, name, trip, opts.companionId)],
    })
    if (!r.ok && !opts.expectFail) throw new Error('fixture 报名失败：' + name + ' ' + r.code + ' ' + r.message)
    if (!r.ok) return r
    if (!opts.keepPending) {
      const act = w.state.activities.find(x => x.id === activityId)
      const ownerId = opts.ownerId || (act ? act.ownerId : null)
      const review = w.dispatch(ownerId, { type: 'signup.review', activityId, signupIds: r.targetIds, decision: 'confirm' })
      if (!review.ok) throw new Error('fixture 审核失败：' + review.code + ' ' + review.message)
    }
    return r
  }

  w.serviceDriver = (name, userId) => ({ kind: 'service', name: name || '张师傅', phone: '00000077001', userId: userId === undefined ? null : userId })
  w.vehicle = (ownerId, activityId, over) => {
    const v = Object.assign({
      label: '车A', plate: '川A00001', legalCapacity: 5,
      drivers: [w.serviceDriver()], blockedSeats: 0,
      seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'],
    }, over || {})
    const r = w.dispatch(ownerId, { type: 'vehicle.save', activityId, vehicleId: null, input: v })
    if (!r.ok) throw new Error('fixture 造车失败：' + r.code + ' ' + r.message)
    return r.targetIds[0]
  }

  w.assign = (ownerId, activityId, signupId, vehicleId, seatLabel) =>
    w.dispatch(ownerId, { type: 'assignment.set', activityId, target: { signupId, vehicleId, seatLabel: seatLabel === undefined ? null : seatLabel } })

  w.phase = (ownerId, activityId, next, reason) =>
    w.dispatch(ownerId, { type: 'activity.transition', activityId, next, reason: reason === undefined ? '推进' : reason })

  /** 把活动推进到集合（published→gathering）；待确认报名一律先确认。 */
  w.toGathering = (ownerId, activityId) => {
    const pending = w.state.signups.filter(s => s.activityId === activityId && s.status === 'pending').map(s => s.id)
    if (pending.length) w.dispatch(ownerId, { type: 'signup.review', activityId, signupIds: pending, decision: 'confirm' })
    return w.phase(ownerId, activityId, 'gathering')
  }
  w.checkin = (ownerId, activityId, signupId, note) =>
    w.dispatch(ownerId, { type: 'attendance.checkin', activityId, signupId, checkIn: { method: 'manual', evidence: { at: w.now, by: ownerId, note: note || '现场签到' } } })
  w.board = (ownerId, activityId, signupId, leg, boarded, note) =>
    w.dispatch(ownerId, { type: 'attendance.board', activityId, signupId, leg, boarded: boarded !== false, note: note || '逐人清点' })
  w.departure = (userId, activityId, signupId, kind, note) =>
    w.dispatch(userId, { type: 'attendance.departure', activityId, signupId, outcome: { kind, evidence: { at: w.now, by: userId, note: note || '现场核实' } } })
  /** 完整走完「签到 → 上车 → 核实随队出发」，用于把活动推进到 active。 */
  w.verifyAllDeparted = (ownerId, activityId) => {
    const confirmed = w.state.signups.filter(s => s.activityId === activityId && s.status === 'confirmed')
    for (const s of confirmed) {
      w.checkin(ownerId, activityId, s.id)
      if (w.allow(ownerId, { type: 'attendance.board', activityId, signupId: s.id, leg: 'outbound', boarded: true, note: 'x' }).ok) {
        w.board(ownerId, activityId, s.id, 'outbound', true)
      }
      w.departure(ownerId, activityId, s.id, 'joined')
    }
    return w.phase(ownerId, activityId, 'active', '开始行程')
  }
  w.home = (ownerId, activityId, signupId, note) =>
    w.dispatch(ownerId, { type: 'attendance.home', activityId, signupId, note: note || '本人报平安' })

  /** 一路推进到 archived：自行前往的人不需要上车，司机也不需要。 */
  w.toArchived = (ownerId, activityId) => {
    w.toGathering(ownerId, activityId)
    w.verifyAllDeparted(ownerId, activityId)
    w.phase(ownerId, activityId, 'closing', '返程清点')
    for (const s of w.state.signups.filter(x => x.activityId === activityId && x.status === 'confirmed')) {
      const r = w.attendanceOf(s.id)
      if (r.departure && r.departure.kind === 'joined' && !r.home) w.home(ownerId, activityId, s.id)
    }
    return w.phase(ownerId, activityId, 'archived', '归档')
  }

  return w
}

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

module.exports = {
  createWorld, emptyState, checkOracles, fingerprint, deepClone,
  assertOk: assertInvariants,
  PHASES, SIGNUP_STATUSES, COMMAND_TYPES, LIVE_SIGNUP,
}
