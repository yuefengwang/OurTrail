// 随机场景 / 性质不变量测试：node tools/lifecycle-fuzz-test.js
//
// 为什么存在：既有测试只能证明「已经想到的场景」。这里按 seed 生成随机的
// 参与者/出行方式/车辆/司机/座位/上车点/分配/取消/现场记录，然后既发合法命令也发非法命令，
// 每一步之后都跑 assertInvariants + 独立 oracle + 「被拒必须零副作用」。
// 一旦发现违规：记录 seed、命令序列、终态与违反的不变量，并二分收缩出最短复现前缀，
// 再把那个 seed 固化进 PINNED 回归表（本文件最后一段）。
//
// 判据独立性：checkOracles 是本次审计按业务规格另写一遍的不变量，不复用 invariants.js 的实现——
// 所以「invariants.js 被改松」这件事本身也会被测到（见 §4 的变异自证）。
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

/* ---------- 确定性随机源（mulberry32） ---------- */

function rng(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------- 场景生成 ---------- */

const LIN = 'o-lin-openid'
const USER = i => 'o-r' + i + '-openid'
const PICKUPS = ['pk-1', 'pk-2']
const DEPARTURE_KINDS = ['joined', 'not_departed', 'coordinating']
const CAPABILITIES = ['roster', 'checkin', 'node', 'incident', 'position', 'home', 'sensitive']

/**
 * 造一条随机但合法的活动，返回世界。所有初始数据都通过真实命令建立。
 */
function buildScene(seed) {
  const rand = rng(seed)
  const pick = arr => arr[Math.floor(rand() * arr.length) % arr.length]
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1))
  const w = H.createWorld()
  const log = []
  const step = (actor, payload, opts) => {
    const r = w.dispatch(actor, payload, opts)
    log.push({ actor, type: payload.type, ok: r.ok ? 'ok' : r.code })
    return r
  }
  w.profile(LIN, '领队')
  const riders = int(2, 6)
  const people = []
  for (let i = 0; i < riders; i++) {
    const name = 'r' + i
    w.profile(USER(i), name)
    people.push({ name, id: USER(i) })
  }
  const a = w.createActivity(LIN, {
    title: '随机线路',
    capacity: int(riders, riders + 3),
    approvalMode: rand() < 0.5 ? 'automatic' : 'manual',
    pickupPoints: [
      { id: 'pk-1', name: '集合点甲', meetingAt: '2026-10-11T06:40:00+08:00', address: 'A', coordinates: null },
      { id: 'pk-2', name: '集合点乙', meetingAt: '2026-10-11T07:10:00+08:00', address: 'B', coordinates: null },
    ],
  })
  w.publish(LIN, a)
  w.a = a
  // 车辆：随机核载、随机座位（含不编号的 null）、随机上车点子集
  const vehicles = []
  const vehicleCount = int(0, 2)
  for (let i = 0; i < vehicleCount; i++) {
    const legal = int(2, 5)
    const pickupPointIds = rand() < 0.35 ? PICKUPS.slice() : [pick(PICKUPS)]
    const r = step(LIN, {
      type: 'vehicle.save', activityId: a, vehicleId: null,
      input: { label: 'v' + i, plate: '川A' + i, legalCapacity: legal, drivers: [{ kind: 'service', name: '司' + i, phone: '1380000' + i, userId: null }], blockedSeats: rand() < 0.25 ? 1 : 0, seatLabels: null, pickupPointIds },
    })
    if (r.ok) vehicles.push(r.targetIds[0])
  }
  // 报名：self / shared 混合，部分整组，部分候补
  const signups = []
  for (const p of people) {
    const mode = rand() < 0.45 ? 'self' : 'shared'
    const trip = mode === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: pick(PICKUPS) }
    const fits = w.state.signups.filter(s => s.activityId === a && (s.status === 'pending' || s.status === 'confirmed')).length < w.state.activities[0].capacity
    const r = step(p.id, {
      type: 'signup.submit', activityId: a, keepTogether: rand() < 0.3, mode: fits ? 'apply' : 'waitlist',
      participants: [w.participantInput(p.id, p.name, trip)],
    })
    if (r.ok) signups.push(r.targetIds[0])
  }
  // 让随机扫描落到真实的历史深处：多数场景先被推进到某个阶段，再开始发随机命令
  const targetPhase = pick(['published', 'gathering', 'gathering', 'active', 'active', 'closing', 'archived'])
  driveTo(w, a, targetPhase, rand)
  w.scenePhase = (w.state.activities[0] || {}).phase
  return { w, log, step, rand, int, pick, people, signups, vehicles, targetPhase }
}

/**
 * 把活动真实推进到某个阶段（全部通过命令）。随机扫描必须能落到 gathering/active/closing/archived，
 * 否则现场与收尾那一大片状态门永远只在 published 下被测到。
 */
function driveTo(w, a, target, rand) {
  const confirmed = () => w.state.signups.filter(s => s.activityId === a && s.status === 'confirmed')
  const reach = phase => {
    const order = ['published', 'gathering', 'active', 'closing', 'archived']
    return order.indexOf(phase) <= order.indexOf(target)
  }
  if (target === 'published') return
  const pending = w.state.signups.filter(s => s.activityId === a && s.status === 'pending').map(s => s.id)
  if (pending.length) w.dispatch(LIN, { type: 'signup.review', activityId: a, signupIds: pending, decision: 'confirm' })
  w.phase(LIN, a, 'gathering', '随机推进')
  if (!reach('active')) return
  for (const s of confirmed()) {
    w.checkin(LIN, a, s.id)
    const row = w.readActivity(LIN, a, 'organizer').rows.find(r => r.signupId === s.id)
    if (row && row.needsOutboundBoarding && w.assignmentOf(s.id)) w.board(LIN, a, s.id, 'outbound', true)
    const joined = w.departure(LIN, a, s.id, 'joined')
    if (!joined.ok) w.departure(LIN, a, s.id, rand() < 0.5 ? 'not_departed' : 'coordinating', '随机收尾')
  }
  w.phase(LIN, a, 'active', '随机推进')
  if (!reach('closing')) return
  w.phase(LIN, a, 'closing', '随机收尾')
  if (!reach('archived')) return
  for (const s of confirmed()) {
    const r = w.attendanceOf(s.id)
    if (r && r.departure && r.departure.kind === 'joined' && !r.home) w.home(LIN, a, s.id)
  }
  const open = w.state.incidents.filter(i => i.activityId === a && !i.resolution)
  for (const i of open) w.dispatch(LIN, { type: 'incident.resolve', activityId: a, incidentId: i.id, note: '随机销案' })
  w.phase(LIN, a, 'archived', '随机归档')
}

/* ---------- 随机命令：既发合法也发非法 ---------- */

function randomCommand(ctx) {
  const { w, step, rand, int, pick, vehicles } = ctx
  const a = w.a
  const activity = w.state.activities.find(x => x.id === a)
  const phase = activity ? activity.phase : 'draft'
  const signups = w.state.signups.filter(s => s.activityId === a)
  const live = signups.filter(s => H.LIVE_SIGNUP.indexOf(s.status) !== -1)
  const confirmed = signups.filter(s => s.status === 'confirmed')
  const pending = signups.filter(s => s.status === 'pending')
  const waitlisted = signups.filter(s => s.status === 'waitlisted')
  const own = s => s.submittedByUserId
  const vs = w.state.vehicles.filter(v => v.activityId === a)
  const actorFor = s => (rand() < 0.3 ? LIN : (s ? own(s) : LIN))
  const roll = int(0, 23)
  switch (roll) {
    case 0: { const s = pick(live); return s ? step(actorFor(s), { type: 'signup.cancel', activityId: a, signupIds: [s.id].concat(rand() < 0.2 ? [pick(signups).id] : []), reason: '随机取消' }) : null }
    case 1: { if (!pending.length) return null; const s = pick(pending); return step(LIN, { type: 'signup.review', activityId: a, signupIds: [s.id], decision: rand() < 0.7 ? 'confirm' : 'reject' }) }
    case 2: { if (!waitlisted.length) return null; return step(LIN, { type: 'signup.promote', activityId: a, signupIds: [pick(waitlisted).id] }) }
    case 3: { const s = pick(live); if (!s) return null; const trip = rand() < 0.5 ? { mode: 'self' } : { mode: 'shared', pickupPointId: pick(PICKUPS) }
      return step(actorFor(s), { type: 'signup.edit', activityId: a, signupId: s.id, participant: s.participant, trip, purpose: '随机改资料' }) }
    case 4: { const p = ctx.people[int(0, ctx.people.length - 1)]; const trip = rand() < 0.5 ? { mode: 'self' } : { mode: 'shared', pickupPointId: pick(PICKUPS) }
      return step(p.id, { type: 'signup.submit', activityId: a, keepTogether: rand() < 0.5, mode: rand() < 0.8 ? 'apply' : 'waitlist', participants: [w.participantInput(p.id, p.name, trip)] }) }
    case 5: return step(LIN, { type: 'vehicle.save', activityId: a, vehicleId: rand() < 0.5 ? pick(vs) || null : null, input: { label: 'v' + int(0, 9), plate: '川A' + int(0, 99), legalCapacity: int(1, 6), drivers: [{ kind: 'service', name: '司', phone: '138', userId: null }], blockedSeats: int(0, 2), seatLabels: rand() < 0.5 ? ['1', '2', '3', '4', '5'].slice(0, int(0, 5)) : null, pickupPointIds: rand() < 0.3 ? [] : [pick(PICKUPS)] } })
    case 6: { const v = pick(vs); return v ? step(LIN, { type: 'vehicle.remove', activityId: a, vehicleId: rand() < 0.9 ? v.id : 'vehicle-不存在' }) : null }
    case 7: { const s = pick(confirmed); const v = pick(vs); if (!s || !v) return null
      const labels = v.seatLabels || [null]
      return step(LIN, { type: 'assignment.set', activityId: a, target: { signupId: s.id, vehicleId: v.id, seatLabel: rand() < 0.8 ? pick(labels) : '9' } }) }
    case 8: { const s = pick(signups); return s ? step(LIN, { type: 'assignment.remove', activityId: a, signupId: s.id }) : null }
    case 9: { const assigned = w.state.assignments.filter(x => x.activityId === a); if (assigned.length < 2) return null
      return step(LIN, { type: 'assignment.swap', activityId: a, firstSignupId: pick(assigned).signupId, secondSignupId: pick(assigned).signupId }) }
    case 10: { const plan = w.preview(LIN, a); if (!plan.ok) return null
      const mutated = JSON.parse(JSON.stringify(plan.value))
      if (rand() < 0.3 && mutated.assignments.length) mutated.assignments[0].seatLabel = 'X'
      if (rand() < 0.3) mutated.baseRevision = w.state.revision - int(0, 2)
      return step(LIN, { type: 'assignment.commit', activityId: a, preview: mutated }) }
    case 11: { const s = pick(confirmed); return s ? step(actorFor(s), { type: 'attendance.checkin', activityId: a, signupId: s.id, checkIn: rand() < 0.7
      ? { method: 'manual', evidence: { at: w.now, by: LIN, note: '随机签到' } }
      : { method: 'simulation', evidence: { at: w.now, by: s.submittedByUserId, note: '本人模拟' }, coordinates: { lat: 30.4, lng: 103.6 } } }) : null }
    case 12: { const s = pick(confirmed); if (!s) return null
      return step(LIN, { type: 'attendance.board', activityId: a, signupId: s.id, leg: rand() < 0.6 ? 'outbound' : 'return', boarded: rand() < 0.7, note: '随机清点' }) }
    case 13: { const s = pick(confirmed); return s ? step(LIN, { type: 'attendance.departure', activityId: a, signupId: s.id, outcome: { kind: pick(DEPARTURE_KINDS), evidence: { at: w.now, by: LIN, note: '随机核实' } } }) : null }
    case 14: { const s = pick(confirmed); return s ? step(LIN, { type: 'attendance.returnPlan', activityId: a, signupId: s.id, plan: rand() < 0.5 ? 'assigned' : 'independent', note: '随机返程口径' }) : null }
    case 15: { const s = pick(confirmed); if (!s || !activity) return null
      const points = activity.routeSnapshot.points
      return step(LIN, { type: 'attendance.node', activityId: a, signupId: s.id, pointId: rand() < 0.9 ? pick(points).id : 'pt-不存在', note: '随机节点' }) }
    case 16: { const s = pick(confirmed); return s ? step(LIN, { type: 'attendance.home', activityId: a, signupId: s.id, note: '随机报平安' }) : null }
    case 17: { const v = pick(vs); return v ? step(LIN, { type: rand() < 0.6 ? 'vehicle.depart' : 'vehicle.complete', activityId: a, vehicleId: v.id, leg: rand() < 0.5 ? 'outbound' : 'return', note: '随机行车' }) : null }
    case 18: { const s = pick(confirmed); return s ? step(actorFor(s), { type: 'position.report', activityId: a, signupId: s.id, coordinates: { lat: 30.5, lng: 103.5 }, consent: rand() < 0.9 }) : null }
    case 19: { const s = pick(signups); return s ? step(actorFor(s), { type: 'position.revoke', activityId: a, signupId: s.id }) : null }
    case 20: { const s = pick(signups); return s ? step(LIN, { type: 'incident.report', activityId: a, signupIds: [s.id], kind: pick(['late', 'withdrawal', 'injury', 'other']), description: '随机异常' }) : null }
    case 21: { const open = w.state.incidents.filter(i => i.activityId === a && !i.resolution); if (!open.length) return null
      return step(LIN, { type: 'incident.resolve', activityId: a, incidentId: pick(open).id, note: '随机销案' }) }
    case 22: return step(LIN, { type: 'activity.transition', activityId: a, next: pick(['gathering', 'active', 'closing', 'archived', 'cancelled', 'draft', 'published']), reason: rand() < 0.8 ? '随机推进' : '' })
    default: {
      const keep = rand() < 0.8
      const input = w.activityInput({ capacity: int(1, 9), pickupPoints: keep ? w.state.activities[0].pickupPoints : [w.state.activities[0].pickupPoints[0]] })
      if (rand() < 0.3) return step(LIN, { type: 'notice.publish', activityId: a, audience: rand() < 0.6 ? { kind: 'activity' } : { kind: 'signups', signupIds: signups.slice(0, 1).map(s => s.id) }, content: '随机通知' })
      return step(LIN, { type: 'activity.edit', activityId: a, input })
    }
  }
}

/* ---------- 复现与二分收缩 ---------- */

/** 用同一个 seed 跑到 steps 步为止，返回世界与命令日志。 */
function replay(seed, steps) {
  const ctx = buildScene(seed)
  const { w } = ctx
  for (let i = 0; i < steps; i++) {
    randomCommand(ctx)
    if (w.problems.length) break
  }
  return ctx
}

function firstProblem(ctx) {
  return ctx.w.problems.length ? ctx.w.problems[0] : null
}

/** 最短复现：同一 seed 下逐步减少步数，找第一个仍出问题的前缀。 */
function shrink(seed, upper) {
  let lo = 1
  let hi = upper
  if (!replay(seed, hi).w.problems.length) return null
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const r = replay(seed, mid)
    if (r.w.problems.length) hi = mid
    else lo = mid + 1
  }
  return { steps: lo, ctx: replay(seed, lo) }
}

/* ================= 1. 随机扫描 ================= */

section('1. 随机场景扫描：每步之后都跑域内不变量 + 独立 oracle + 零副作用')
{
  const ROUND_SEEDS = []
  for (let i = 1; i <= 60; i++) ROUND_SEEDS.push(i * 7919)
  const problems = []
  let accepted = 0
  let rejected = 0
  const codeTally = {}
  const phaseTally = {}
  let maxSteps = 0
  for (const seed of ROUND_SEEDS) {
    const ctx = replay(seed, 45)
    const w = ctx.w
    maxSteps = Math.max(maxSteps, w.history.length)
    phaseTally[w.scenePhase || 'unknown'] = (phaseTally[w.scenePhase || 'unknown'] || 0) + 1
    for (const h of w.history) {
      if (h.code === 'ok' || h.code === 'replayed') accepted++
      else { rejected++; codeTally[h.code] = (codeTally[h.code] || 0) + 1 }
    }
    if (w.problems.length) {
      const min = shrink(seed, w.history.length)
      problems.push({ seed, first: w.problems[0], minSteps: min ? min.steps : null, tail: w.history.slice(-4) })
    }
  }
  check('60 个随机场景 × 45 步没有出现任何不变量违背', problems.length === 0, JSON.stringify(problems.slice(0, 3), null, 1))
  // 深度守卫：如果所有场景都停在 published，上面那条「零违背」几乎等于没测
  const seenPhases = Object.keys(phaseTally)
  check('扫描覆盖了生命周期的大部分阶段（不是只在 published 打转）',
    seenPhases.length >= 4 && (phaseTally.active || 0) + (phaseTally.closing || 0) + (phaseTally.archived || 0) >= 6,
    JSON.stringify(phaseTally))
  check('扫描确实跑到了足够深的路径（步数与命令分布非退化）',
    maxSteps >= 45 && Object.keys(codeTally).length >= 6, JSON.stringify({ maxSteps, kinds: Object.keys(codeTally).length }))
  check('合法与非法命令都被真正发出过（不是全绿的空转）', accepted > 200 && rejected > 100, JSON.stringify({ accepted, rejected }))
  console.log('    命令分布：' + Object.entries(codeTally).sort((x, y) => y[1] - x[1]).map(([k, v]) => k + '=' + v).join(' ') + ' ｜ accepted=' + accepted)
}

/* ================= 2. 定向性质：随机终态上的不变量抽查 ================= */

section('2. 终态性质：任意随机可达状态都必须满足业务规格里的每条不变量')
{
  const PROPERTIES = [
    ['座位唯一', w => {
      const seen = new Set()
      for (const a of w.state.assignments) if (a.seatLabel !== null) { const k = a.vehicleId + '#' + a.seatLabel; if (seen.has(k)) return false; seen.add(k) }
      return true
    }],
    ['一人一车', w => new Set(w.state.assignments.map(a => a.signupId)).size === w.state.assignments.length],
    ['self 不占乘客位', w => w.state.assignments.every(a => { const s = w.state.signups.find(x => x.id === a.signupId); return s && s.trip.mode !== 'self' })],
    ['self 无上车事实', w => w.state.attendance.every(r => { const s = w.state.signups.find(x => x.id === r.signupId); return !s || s.trip.mode !== 'self' || (!r.boardingByLeg.outbound && !r.boardingByLeg.return) })],
    ['随队出发者必须已签到且仍有效', w => w.state.attendance.every(r => { if (!r.departure || r.departure.kind !== 'joined') return true; const s = w.state.signups.find(x => x.id === r.signupId); return !!r.checkIn && !!s && s.status === 'confirmed' })],
    ['到家者必须随队出发', w => w.state.attendance.every(r => !r.home || (r.departure && r.departure.kind === 'joined'))],
    ['履约记录与报名一一对应', w => new Set(w.state.attendance.map(a => a.signupId)).size === w.state.signups.length && w.state.attendance.length === w.state.signups.length],
    ['容量不被突破', w => w.state.activities.every(a => w.state.signups.filter(s => s.activityId === a.id && (s.status === 'pending' || s.status === 'confirmed')).length <= a.capacity)],
    ['车辆乘客位不为负', w => w.state.vehicles.every(v => v.legalCapacity - v.drivers.length - v.blockedSeats >= 0)],
    ['参与者司机同场只开一辆车', w => { const ids = w.state.vehicles.flatMap(v => v.drivers.filter(d => d.kind === 'participant').map(d => d.signupId)); return new Set(ids).size === ids.length }],
    ['已取消的人不占座位', w => w.state.assignments.every(a => { const s = w.state.signups.find(x => x.id === a.signupId); return s && s.status === 'confirmed' })],
    ['归档活动的出行者都已闭环', w => w.state.activities.filter(a => a.phase === 'archived').every(a => w.state.signups.filter(s => s.activityId === a.id && s.status === 'confirmed').every(s => { const r = w.state.attendance.find(x => x.signupId === s.id); return r && r.departure && r.departure.kind !== 'coordinating' && (r.departure.kind !== 'joined' || r.home) }))],
    ['取消的活动不留有效报名与安排', w => w.state.activities.filter(a => a.phase === 'cancelled').every(a => w.state.signups.every(s => s.activityId !== a.id || H.LIVE_SIGNUP.indexOf(s.status) === -1) && w.state.assignments.every(x => x.activityId !== a.id))],
  ]
  let rounds = 0
  const violated = []
  for (let seed = 1; seed <= 40; seed++) {
    const ctx = replay(seed * 104729, 60)
    rounds++
    for (const [name, prop] of PROPERTIES) {
      let ok = true
      try { ok = prop(ctx.w) } catch (e) { ok = false }
      if (!ok) violated.push('seed=' + (seed * 104729) + ' ' + name)
    }
  }
  check('' + rounds + ' 轮随机终态上 ' + PROPERTIES.length + ' 条性质全部成立', violated.length === 0, JSON.stringify(violated.slice(0, 4)))
  // 反空断言：性质不是恒真——把一条已知违规塞进去，性质必须红
  const trap = replay(12345, 1)
  const anyConfirmed = trap.w.state.signups.find(s => s.status === 'confirmed')
  if (anyConfirmed) {
    trap.w.state.assignments.push({ activityId: trap.w.a, signupId: anyConfirmed.id, vehicleId: (trap.w.state.vehicles[0] || {}).id, seatLabel: 'Z9' })
    const seatProp = PROPERTIES.find(p => p[0] === '座位唯一')
    const capacityProp = PROPERTIES.find(p => p[0] === '车辆乘客位不为负')
    void capacityProp
    check('反空断言：手动塞入的重复占座被性质抓到', seatProp[1](trap.w) === false || H.checkOracles(trap.w.state).length > 0)
  }
}

/* ================= 3. 异常恢复：残缺/悬空引用的输入 ================= */

section('3. 非法 ID 与残缺输入：不产生半成品状态')
{
  const ctx = replay(777, 12)
  const w = ctx.w
  const a = w.a
  const ghostIds = { signup: 'signup-不存在', vehicle: 'vehicle-不存在', seat: '座号-不存在', point: 'pt-不存在', membership: 'm-不存在', notice: 'n-不存在', incident: 'i-不存在' }
  const attacks = [
    ['给不存在的报名分车', LIN, { type: 'assignment.set', activityId: a, target: { signupId: ghostIds.signup, vehicleId: (w.state.vehicles[0] || {}).id || ghostIds.vehicle, seatLabel: '1' } }],
    ['分给不存在的车辆', LIN, { type: 'assignment.set', activityId: a, target: { signupId: w.state.signups[0].id, vehicleId: ghostIds.vehicle, seatLabel: ghostIds.seat } }],
    ['审核不存在的报名', LIN, { type: 'signup.review', activityId: a, signupIds: [ghostIds.signup], decision: 'confirm' }],
    ['撤销不存在的授权', LIN, { type: 'membership.revoke', activityId: a, membershipId: ghostIds.membership }],
    ['读不存在的通知', LIN, { type: 'notice.read', activityId: a, noticeId: ghostIds.notice }],
    ['销不存在的异常', LIN, { type: 'incident.resolve', activityId: a, incidentId: ghostIds.incident }],
    ['给不存在的报名记现场', LIN, { type: 'attendance.home', activityId: a, signupId: ghostIds.signup, note: 'x' }],
    ['记不存在的路线节点', LIN, { type: 'attendance.node', activityId: a, signupId: w.state.signups[0].id, pointId: ghostIds.point, note: 'x' }],
    ['引用别的活动的车辆', LIN, { type: 'vehicle.remove', activityId: a, vehicleId: ghostIds.vehicle }],
    ['空参与人员提交', LIN, { type: 'signup.submit', activityId: a, keepTogether: false, mode: 'apply', participants: [] }],
    ['重复的报名 id', LIN, { type: 'signup.review', activityId: a, signupIds: [w.state.signups[0].id, w.state.signups[0].id], decision: 'confirm' }],
    ['空受众 id 的通知', LIN, { type: 'notice.publish', activityId: a, audience: { kind: 'signups', signupIds: [] }, content: '空受众' }],
    ['不存在的活动', LIN, { type: 'vehicle.save', activityId: 'activity-不存在', vehicleId: null, input: { label: 'x', plate: 'x', legalCapacity: 5, drivers: [{ kind: 'service', name: 'x', phone: 'x', userId: null }], blockedSeats: 0, seatLabels: null, pickupPointIds: ['pk-1'] } }],
  ]
  for (const [name, actor, payload] of attacks) {
    const before = w.snapshot()
    const r = w.dispatch(actor, payload)
    check('拒绝且不落半成品：' + name, !r.ok, JSON.stringify(r))
    check('  ↳ 状态逐字节不变：' + name, w.snapshot() === before)
  }
  check('攻击后世界仍满足全部不变量', H.checkOracles(w.state).length === 0 && w.problems.length === 0, JSON.stringify(w.problems.slice(0, 2)))
}

/* ================= 4. 判据自证：oracle 会被真违规点亮 ================= */

section('4. 变异自证：独立 oracle 对每一类违规都必须报红（不是恒真断言）')
{
  // 变异需要一个「每种对象都在场」的基线：随机场景常常没有车辆/位置/分配，
  // 那样的变异脚本会静默 no-op，把「没抓到」伪装成「全绿」。这里显式建一条满载夹具。
  const seeded = H.createWorld()
  seeded.profile(LIN, '领队')
  const CHEN = 'o-fuzz-chen', WANG = 'o-fuzz-wang', ZHAO = 'o-fuzz-zhao'
  seeded.profile(CHEN, '陈屿')
  seeded.profile(WANG, '王五')
  seeded.profile(ZHAO, '赵六')
  const sa = seeded.createActivity(LIN, { capacity: 8 })
  seeded.publish(LIN, sa)
  seeded.signup(LIN, sa, '领队', { mode: 'self' }, { ownerId: LIN })
  seeded.signup(CHEN, sa, '陈屿', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  seeded.signup(WANG, sa, '王五', { mode: 'shared', pickupPointId: 'pk-1' }, { ownerId: LIN })
  seeded.signup(ZHAO, sa, '赵六', { mode: 'shared', pickupPointId: 'pk-2' }, { ownerId: LIN })
  const sv1 = seeded.vehicle(LIN, sa, { label: '一号车', seatLabels: ['1', '2', '3', '4'], pickupPointIds: ['pk-1'] })
  const sv2 = seeded.vehicle(LIN, sa, { label: '二号车', legalCapacity: 3, drivers: [{ kind: 'participant', signupId: seeded.signupIdOf('赵六') }], seatLabels: ['1', '2'], pickupPointIds: ['pk-1', 'pk-2'] })
  seeded.assign(LIN, sa, seeded.signupIdOf('陈屿'), sv1, '1')
  seeded.assign(LIN, sa, seeded.signupIdOf('王五'), sv1, '2')
  seeded.toGathering(LIN, sa)
  for (const n of ['领队', '陈屿', '王五', '赵六']) {
    seeded.checkin(LIN, sa, seeded.signupIdOf(n))
    const row = seeded.readActivity(LIN, sa, 'organizer').rows.find(r => r.name === n)
    if (row.needsOutboundBoarding) seeded.board(LIN, sa, seeded.signupIdOf(n), 'outbound', true)
    seeded.departure(LIN, sa, seeded.signupIdOf(n), 'joined')
  }
  seeded.phase(LIN, sa, 'active', '开始行程')
  seeded.dispatch(LIN, { type: 'position.report', activityId: sa, signupId: seeded.signupIdOf('领队'), coordinates: { lat: 30.4, lng: 103.6 }, consent: true })
  seeded.dispatch(LIN, { type: 'incident.report', activityId: sa, signupIds: [seeded.signupIdOf('王五')], kind: 'late', description: '落后' })
  check('变异基线本身是合法可达状态', H.checkOracles(seeded.state).length === 0 && seeded.problems.length === 0, JSON.stringify(seeded.problems.slice(0, 2)))
  const base = seeded.cloneState()
  // byName 必须相对「正在被破坏的那份状态」查，不能拿 base 的对象引用——写它会污染基线，
  // 于是后面每一条变异都在脏数据上跑，「报红」与「全绿」都失去意义。
  const byName = (st, n) => st.signups.find(x => x.participant.name === n)
  const cases = [
    ['同一座位两个人', st => { const a0 = st.assignments[0]; st.assignments.push(Object.assign({}, a0, { signupId: byName(st, '王五').id })) }, 'O-SEAT-TAKEN'],
    ['一人占两辆车', st => { st.assignments.push({ activityId: st.activities[0].id, signupId: byName(st, '陈屿').id, vehicleId: st.vehicles[1].id, seatLabel: null }) }, 'O-ASSIGN-DUP'],
    ['自行前往者占座', st => { const s = st.signups.find(x => x.trip.mode === 'self'); st.assignments.push({ activityId: s.activityId, signupId: s.id, vehicleId: st.vehicles[0].id, seatLabel: null }) }, 'O-SELF-ASSIGNED'],
    ['上车点不在线路上', st => { st.assignments.find(x => x.signupId === byName(st, '王五').id).vehicleId = st.vehicles[1].id; st.vehicles[1].pickupPointIds = ['pk-2'] }, 'O-PICKUP-MISMATCH'],
    ['超员', st => { st.vehicles[0].legalCapacity = 2; st.vehicles[0].seatLabels = null }, 'O-VEHICLE-OVERCAP'],
    ['self 留上车事实', st => { const s = st.signups.find(x => x.trip.mode === 'self'); st.attendance.find(x => x.signupId === s.id).boardingByLeg.outbound = { at: st.savedAt, by: 'x', note: 'y' } }, 'O-SELF-BOARDING'],
    ['未签到却已随队出发', st => { st.attendance.find(x => x.signupId === byName(st, '陈屿').id).checkIn = null }, 'O-JOINED-NOCHECKIN'],
    ['未出发却已到家', st => { const r = st.attendance.find(x => x.signupId === byName(st, '陈屿').id); r.departure = null; r.home = { at: st.savedAt, by: 'x', note: 'y' } }, 'O-HOME-NOJOIN'],
    ['自行返程落在搭车者身上', st => { st.attendance.find(x => x.signupId === byName(st, '陈屿').id).returnPlan = { kind: 'own' } }, 'O-OWN-PLAN-MODE'],
    ['归档活动里有人没闭环', st => { st.activities[0].phase = 'archived'; for (const r of st.attendance) { r.home = null } }, 'O-ARCHIVE'],
    ['取消活动还留着座位', st => { st.activities[0].phase = 'cancelled'; st.activities[0].acceptingSignups = true }, 'O-CANCEL'],
    ['报名没有履约记录', st => { st.attendance = st.attendance.slice(1) }, 'O-ATT-CARD'],
    ['履约记录指向不存在的报名', st => { st.attendance[0].signupId = 'signup-幽灵' }, 'O-ATT-ORPHAN'],
    ['一人两条位置上报', st => { st.positions.push(Object.assign({}, st.positions[0])) }, 'O-POSITION-DUP'],
    ['有效位置留在已取消的人身上', st => { byName(st, '领队').status = 'cancelled' }, 'O-POSITION-LIVE'],
    ['参与者司机同场开两辆车', st => { st.vehicles.push({ id: 'v-第三辆', activityId: st.activities[0].id, label: '第三辆', plate: '川A9', legalCapacity: 1, drivers: [{ kind: 'participant', signupId: byName(st, '赵六').id }], blockedSeats: 0, seatLabels: null, pickupPointIds: ['pk-2'], legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } } }) }, 'O-DRIVER-DOUBLE'],
    ['活动被超额', st => { st.activities[0].capacity = 1 }, 'O-CAPACITY'],
    ['通知受众是别处的人', st => { st.notices.push({ id: 'n-x', activityId: st.activities[0].id, audience: { kind: 'signups', signupIds: ['signup-幽灵'] }, sourceEventId: null, content: 'x', publishedAt: st.savedAt, readBy: {}, deliveries: [] }) }, 'O-NOTICE-AUDIENCE'],
    ['路线节点被删后仍有履约记录', st => { st.activities[0].routeSnapshot.points = [st.activities[0].routeSnapshot.points[0]]; st.attendance.find(x => x.signupId === byName(st, '陈屿').id).nodes = [{ pointId: 'pt-3', evidence: { at: st.savedAt, by: 'x', note: 'y' } }] }, 'O-NODE-DANGLING'],
    ['活动 id 重复', st => { st.activities.push(Object.assign({}, st.activities[0])) }, 'O-DUP-ID'],
  ]
  const blind = []
  for (const [name, mutate, expectPrefix] of cases) {
    const st = JSON.parse(JSON.stringify(base))
    try { mutate(st) } catch (e) { blind.push(name + ' 变异脚本自身失败:' + e.message); continue }
    const bad = H.checkOracles(st)
    if (!bad.some(m => m.indexOf(expectPrefix) === 0)) blind.push(name + '（期望 ' + expectPrefix + '，实际 ' + (bad[0] || '全绿') + '）')
  }
  check(cases.length + ' 类人为违规都被独立 oracle 报红（判据不是恒真）', blind.length === 0, JSON.stringify(blind))
  // 反向对照：同一份夹具在未破坏时必须全绿——否则「报红」可能只是夹具本来就脏
  check('未破坏的基线状态 oracle 全绿', H.checkOracles(base).length === 0, JSON.stringify(H.checkOracles(base).slice(0, 2)))
  // 两套判据要同时收紧：只有一边有牙，另一边就是摆设
  const domainBlind = []
  for (const [name, mutate] of cases) {
    const st = JSON.parse(JSON.stringify(base))
    try { mutate(st) } catch (e) { continue }
    if (H.assertOk(st).ok) domainBlind.push(name)
  }
  check('invariants.js 对同一批变异也报红（两套判据不互相依赖）', domainBlind.length === 0, JSON.stringify(domainBlind))
}


/* ================= 5. 固化回归种子 ================= */

section('5. 固化种子回归：扫描中发现过的形态，每次门禁都重跑一遍')
{
  // PINNED：本轮扫描跑出来的形态（含被拒命令的分布），任何改动都必须仍不产生违规。
  const PINNED = [
    { seed: 7919, steps: 60 },
    { seed: 15838, steps: 60 },
    { seed: 103 * 7919, steps: 60 },
    { seed: 104729, steps: 90 },
    { seed: 24601, steps: 90 },
    { seed: 999983, steps: 120 },
    { seed: 33554467, steps: 120 },
    { seed: 20261008, steps: 150 },
  ]
  for (const p of PINNED) {
    const ctx = replay(p.seed, p.steps)
    const w = ctx.w
    const ok = w.problems.length === 0 && H.checkOracles(w.state).length === 0
    check('seed=' + p.seed + ' 跑到 ' + p.steps + ' 步无违规（阶段停在 ' + (w.state.activities[0] || {}).phase + '）', ok, JSON.stringify(w.problems.slice(0, 2)))
  }
  // 长程：单个种子跑深，确认不会因为历史裁剪/计数而崩
  const deep = replay(20261008, 400)
  check('单 seed 连跑 400 步仍然合法（长程不漂移）', deep.w.problems.length === 0 && H.checkOracles(deep.w.state).length === 0, JSON.stringify(deep.w.problems.slice(0, 2)))
  check('长程确实执行了大量命令', deep.w.state.revision > 10, JSON.stringify({ revision: deep.w.state.revision }))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
