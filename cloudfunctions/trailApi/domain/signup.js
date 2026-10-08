// 由原型 domain/signup.ts 移植：报名提交（整组）、审核、递补、取消、资料修改、同行组约束。
'use strict'

const S = require('./schema')
const { failure, deepClone } = require('./contracts')
const { isCurrentSignup, isOwnSignup, requireSignups } = require('./permissions')

const occupied = (state, activityId) => state.signups.filter(s => s.activityId === activityId && (s.status === 'pending' || s.status === 'confirmed')).length
const personKey = ref => JSON.stringify(ref.kind === 'user' ? ['user', ref.userId] : ['companion', ref.ownerId, ref.companionId])

function normalizedPerson(input) {
  if (!S.validate(S.Person, input)) return failure('INVALID_INPUT', '参与者资料格式不正确。')
  const person = deepClone(input)
  person.name = person.name.trim()
  person.phone = person.phone.trim()
  person.emergency.name = person.emergency.name.trim()
  person.emergency.phone = person.emergency.phone.trim()
  person.medical = person.medical.trim()
  if (typeof person.avatar === 'string') {
    person.avatar = person.avatar.trim().slice(0, 500)
    if (!person.avatar) delete person.avatar
  } else {
    delete person.avatar
  }
  if (!person.name || !person.phone || !person.emergency.name || !person.emergency.phone) {
    return failure('INVALID_INPUT', '请填写参与者姓名、电话及紧急联系人姓名和电话。')
  }
  return { ok: true, value: person }
}

/** 出行方式是参与者级语义：self 不需要上车点；shared 必须挂在本场仍然存在的集合点上。 */
function validTrip(activity, trip) {
  if (!S.validate(S.Trip, trip)) return failure('INVALID_INPUT', '请选择出行方式。')
  if (trip.mode === 'self') return { ok: true, value: trip }
  return activity.pickupPoints.some(point => point.id === trip.pickupPointId)
    ? { ok: true, value: trip }
    : failure('INVALID_INPUT', '需要乘车的参与者必须选择本场有效的上车点。')
}

/** 提交与发布时本人参与共用：整批校验通过后才写入。 */
function registerParticipants(state, activity, inputs, userId, keepTogether, status, context) {
  if (!inputs.length) return failure('INVALID_INPUT', '请至少选择一位参与者。')
  const profile = state.profiles.find(p => p.id === userId)
  if (!profile) return failure('NOT_FOUND', '当前账号资料不存在。')
  const keys = new Set(state.signups.filter(s => s.activityId === activity.id && isCurrentSignup(s)).map(s => personKey(s.personRef)))
  const prepared = []
  for (const input of inputs) {
    if (!S.validate(S.ParticipantInput, input)) return failure('INVALID_INPUT', '报名资料格式不正确。')
    const item = input
    const ref = item.personRef
    if (ref.kind === 'user' ? ref.userId !== userId : ref.ownerId !== userId || !profile.companions.some(c => c.id === ref.companionId)) {
      return failure('FORBIDDEN', '只能为本人或当前账号已有的同行人报名。')
    }
    const key = personKey(ref)
    if (keys.has(key)) return failure('DUPLICATE_PERSON', '同一位参与者不能重复报名本场活动。')
    keys.add(key)
    if (!item.consent.dataUse || (ref.kind === 'companion' && !item.consent.proxyAuthority)) {
      return failure('CONSENT_REQUIRED', '每位参与者需要资料使用同意，同行人还需要有效代办授权。')
    }
    const person = normalizedPerson(item.participant)
    if (!person.ok) return person
    const trip = validTrip(activity, item.trip)
    if (!trip.ok) return trip
    prepared.push({ personRef: item.personRef, participant: person.value, trip: item.trip, consent: item.consent })
  }
  const fits = occupied(state, activity.id) + prepared.length <= activity.capacity
  if (status !== 'waitlisted' && !fits) {
    return failure('CAPACITY', '剩余名额不足以接收整组参与者，请明确选择候补。')
  }
  if (status === 'waitlisted' && fits) return failure('INVALID_INPUT', '整组仍有名额，请正常提交报名。')
  const groupId = context.id('group')
  const records = prepared.map(input => ({
    id: context.id('signup'), activityId: activity.id, groupId, submittedByUserId: userId,
    personRef: input.personRef, participant: input.participant, trip: input.trip, status,
    consent: { at: context.now, recordedBy: userId, dataUse: true, proxyAuthority: input.consent.proxyAuthority, proxyHome: input.consent.proxyHome },
  }))
  state.groups.push({ id: groupId, activityId: activity.id, submittedByUserId: userId, keepTogether })
  state.signups.push.apply(state.signups, records)
  state.attendance.push.apply(state.attendance, records.map(signup => ({
    signupId: signup.id, checkIn: null, boardingByLeg: { outbound: null, return: null },
    // 返程安排只在「搭乘活动车辆」时才有意义：自行前往的人永远拿不到座位（invariants 里
    // 「自行到达者不能分配乘客座位」），给他们写 assigned 等于写入一条永远无法满足的脏事实。
    returnPlan: returnPlanFor(signup.trip),
    departure: null, nodes: [], home: null,
  })))
  return { ok: true, value: records.map(s => s.id) }
}

/** 出行方式 → 返程安排的唯一映射：self ⇒ 自行往返；shared ⇒ 默认原车返程（待现场核实可改另行）。 */
function returnPlanFor(trip) {
  return { kind: trip.mode === 'self' ? 'own' : 'assigned' }
}

/** 不把人从既有上车事实或已发车的车辆上剥离。 */
function travelLocked(state, signupId) {
  const record = state.attendance.find(a => a.signupId === signupId)
  if (!record || (record.departure && record.departure.kind === 'joined') || record.boardingByLeg.outbound || record.boardingByLeg.return || record.home) return true
  const vehicleIds = new Set(state.assignments.filter(a => a.signupId === signupId).map(a => a.vehicleId))
  return state.vehicles.some(v => (vehicleIds.has(v.id) || v.drivers.some(d => d.kind === 'participant' && d.signupId === signupId))
    && (v.legs.outbound.departed !== null || v.legs.return.departed !== null || v.legs.outbound.completed !== null || v.legs.return.completed !== null))
}

function handleSignup(state, command, context) {
  const p = command.payload
  if (['signup.submit', 'signup.review', 'signup.promote', 'signup.cancel', 'signup.edit', 'group.setTogether'].indexOf(p.type) === -1) {
    return failure('INVALID_INPUT', '此报名处理器不支持该操作。')
  }
  if (!command.actor.userId) return failure('AUTH_REQUIRED', '请先选择当前账号。')
  if (!('activityId' in p)) return failure('INVALID_INPUT', '缺少活动标识。')
  const activity = state.activities.find(a => a.id === p.activityId)
  if (!activity) return failure('NOT_FOUND', '找不到本场活动。')

  switch (p.type) {
    case 'signup.submit': {
      if (activity.phase !== 'published' || !activity.acceptingSignups || !activity.deadlineAt || Date.parse(context.now) >= Date.parse(activity.deadlineAt)) {
        return failure('WRONG_PHASE', '本场活动不在开放报名时段。')
      }
      const status = p.mode === 'waitlist' ? 'waitlisted' : activity.approvalMode === 'automatic' ? 'confirmed' : 'pending'
      return registerParticipants(state, activity, p.participants, command.actor.userId, p.keepTogether, status, context)
    }
    case 'signup.review':
    case 'signup.promote':
    case 'signup.cancel': {
      if (!p.signupIds.length || new Set(p.signupIds).size !== p.signupIds.length) return failure('INVALID_INPUT', '请选择不重复的报名记录。')
      if (p.type === 'signup.cancel' ? ['published', 'gathering'].indexOf(activity.phase) === -1 : activity.phase !== 'published') {
        return failure('WRONG_PHASE', '当前活动阶段不能变更报名资格。')
      }
      const targets = requireSignups(state, activity.id, p.signupIds)
      if (!targets.ok) return targets
      if (p.type === 'signup.review') {
        if (targets.value.some(s => s.status !== 'pending')) return failure('WRONG_PHASE', '只有待确认报名可以审核。')
        targets.value.forEach(s => { s.status = p.decision === 'confirm' ? 'confirmed' : 'rejected' })
      } else if (p.type === 'signup.promote') {
        if (targets.value.some(s => s.status !== 'waitlisted')) return failure('WRONG_PHASE', '只有候补报名可以转为待确认。')
        const ids = new Set(p.signupIds)
        for (const signup of targets.value) {
          const group = state.groups.find(g => g.id === signup.groupId)
          if (!group) return failure('INVALID_INPUT', '报名组不存在。')
          if (group.keepTogether && state.signups.some(s => s.groupId === group.id && s.status === 'waitlisted' && !ids.has(s.id))) {
            return failure('GROUP_SCOPE', '请同时递补仍在候补的全部同行组成员，或先明确允许分开。')
          }
        }
        if (occupied(state, activity.id) + targets.value.length > activity.capacity) return failure('CAPACITY', '名额不足，整批候补均未变更。')
        targets.value.forEach(s => { s.status = 'pending' })
      } else {
        if (targets.value.some(s => !isCurrentSignup(s) || travelLocked(state, s.id))) return failure('WRONG_PHASE', '出发或上车后不能取消报名，请使用现场异常与返程流程。')
        if (targets.value.some(s => state.vehicles.some(v => v.drivers.some(d => d.kind === 'participant' && d.signupId === s.id)))) {
          return failure('DRIVER_CONFLICT', '请先更换参与者司机，再取消该报名。')
        }
        const ids = new Set(p.signupIds)
        targets.value.forEach(s => { s.status = isOwnSignup(s, command.actor) ? 'cancelled' : 'removed' })
        state.assignments = state.assignments.filter(a => !ids.has(a.signupId))
        state.positions.forEach(position => {
          if (ids.has(position.signupId) && position.revokedAt === null) position.revokedAt = context.now
        })
      }
      return { ok: true, value: p.signupIds.slice() }
    }
    case 'signup.edit': {
      const targets = requireSignups(state, activity.id, [p.signupId])
      if (!targets.ok) return targets
      const signup = targets.value[0]
      const ordinaryEdit = activity.phase === 'published' && activity.deadlineAt !== null && Date.parse(context.now) < Date.parse(activity.deadlineAt)
      const gatheringCoordination = activity.phase === 'gathering' && command.actor.userId === activity.ownerId
      if ((!ordinaryEdit && !gatheringCoordination) || !isCurrentSignup(signup) || travelLocked(state, signup.id)) {
        return failure('WRONG_PHASE', '报名资料已锁定，集合时仅发起者可协调尚未出发或上车的人员。')
      }
      const person = normalizedPerson(p.participant)
      if (!person.ok) return person
      const trip = validTrip(activity, p.trip)
      if (!trip.ok) return trip
      const modeChanged = signup.trip.mode !== p.trip.mode
      const tripChanged = modeChanged
        || (signup.trip.mode === 'shared' && p.trip.mode === 'shared' && signup.trip.pickupPointId !== p.trip.pickupPointId)
      signup.participant = person.value
      signup.trip = deepClone(p.trip)
      // 出行方式或上车点变了 ⇒ 旧的乘客座位安排不再成立。travelLocked 已保证此刻不存在任何
      // 上车/出发事实，所以这里是「解除」而不是「抹去历史」。self→shared 只回到待安排车辆，
      // 绝不自动伪造 assignment。
      if (tripChanged) state.assignments = state.assignments.filter(a => a.signupId !== signup.id)
      if (modeChanged) {
        const record = state.attendance.find(a => a.signupId === signup.id)
        // 只在两个「车辆返程默认值/派生值」之间转换；already 核实过的 independent 带证据，保留不动。
        if (record && (record.returnPlan.kind === 'assigned' || record.returnPlan.kind === 'own')) {
          record.returnPlan = returnPlanFor(p.trip)
        }
      }
      return { ok: true, value: [signup.id] }
    }
    case 'group.setTogether': {
      const group = state.groups.find(g => g.id === p.groupId && g.activityId === activity.id)
      if (!group) return failure('NOT_FOUND', '找不到本场同行组。')
      const members = state.signups.filter(s => s.groupId === group.id && isCurrentSignup(s))
      if (['published', 'gathering'].indexOf(activity.phase) === -1 || members.some(s => travelLocked(state, s.id))) return failure('WRONG_PHASE', '出发前才能调整同行组安排要求。')
      if (p.keepTogether) {
        const ids = new Set(members.filter(s => s.status === 'confirmed').map(s => s.id))
        if (new Set(state.assignments.filter(a => ids.has(a.signupId)).map(a => a.vehicleId)).size > 1) return failure('GROUP_SCOPE', '同行组已分配到不同车辆，请先协调同车。')
      }
      group.keepTogether = p.keepTogether
      return { ok: true, value: [group.id] }
    }
    default: return failure('INVALID_INPUT', '此报名处理器不支持该操作。')
  }
}

module.exports = { handleSignup, registerParticipants, travelLocked }
