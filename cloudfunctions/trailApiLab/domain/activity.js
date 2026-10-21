// 由原型 domain/activity.ts 移植：创建、复制、编辑、发布、阶段推进（含取消）。
'use strict'

const S = require('./schema')
const { failure, deepClone } = require('./contracts')
const { registerParticipants } = require('./signup')
const { isCurrentSignup, isVehicleTraveller, needsOutboundBoarding } = require('./permissions')

const success = ids => ({ ok: true, value: ids })
const uniqueIds = ids => new Set(ids).size === ids.length

// 只增不改：已落库的每条 entry 必须在入参里原样存在（id 一个不能少、内容一字不能改），
// 新 id 允许追加。返回 false = 改了或删了旧条目。
// 逐字节比对依赖「编辑器读回投影 → 表单 → 原样提交」的往返无损——selectors 少投影一个键、
// 编辑器丢一个字段，都会在这里误伤（severity/coordinates 的往返由 riskView 与 toForm 共同保证）。
function entriesUnchanged(stored, submitted) {
  const storedIds = new Set(stored.map(e => e.id))
  for (const entry of submitted) {
    if (!storedIds.has(entry.id)) continue // 纯新增，放行
    const kept = stored.find(e => e.id === entry.id)
    if (JSON.stringify(kept) !== JSON.stringify(entry)) return false
  }
  if (submitted.length < stored.length) return false // 有旧条目没交回来 = 删除
  return true
}

function validateInput(state, ownerId, input, full, activityId) {
  if (!S.validate(S.ActivityInput, input)) return failure('INVALID_INPUT', '活动字段不完整或格式不正确。')
  if (input.routeId && !state.routes.some(r => r.id === input.routeId && r.ownerId === ownerId)) return failure('FORBIDDEN', '请选择当前发起者自己的私有路线。')
  if (!uniqueIds(input.pickupPoints.map(p => p.id)) || !uniqueIds(input.routeSnapshot.points.map(p => p.id)) || !uniqueIds(input.routeSnapshot.risks.map(r => r.id))) {
    return failure('INVALID_INPUT', '集合点、路线节点与风险标识不能重复。')
  }
  if (full) {
    // 发布门只拦「这是一场什么活动」：标题、时间、集合点（2026-10-14 快速创建）。
    // 轨迹可解析的路线字段（名称/节点/里程/爬升/轨迹线/风险/装备）全部可忽略——
    // 整体可为空、发布后随时可补；但填了的条目必须完整：半成品条目比缺失更糟
    // （详情页会印出无名节点与空问答，而报名者无从知道那是没填还是没写）。
    if (!input.title.trim() || !input.startAt || !input.endAt || !input.deadlineAt
      || !input.pickupPoints.length
      || input.pickupPoints.some(p => !p.name.trim() || !p.address.trim() || !p.meetingAt)) {
      return failure('INVALID_INPUT', '发布需要完整的标题、活动时间与集合信息。')
    }
    if (input.routeSnapshot.points.some(p => !p.name.trim())
      || input.routeSnapshot.risks.some(r => !r.title.trim() || !r.advice.trim())) {
      return failure('INVALID_INPUT', '已填写的路线节点需要名称，风险提示需要问题与应对方式。')
    }
    if (Date.parse(input.deadlineAt) > Date.parse(input.startAt) || Date.parse(input.startAt) >= Date.parse(input.endAt)) {
      return failure('INVALID_INPUT', '截止时间不能晚于开始时间，结束时间必须晚于开始时间。')
    }
  }
  if (activityId) {
    const roster = state.signups.filter(s => s.activityId === activityId)
    if (roster.filter(s => s.status === 'pending' || s.status === 'confirmed').length > input.capacity) return failure('CAPACITY', '活动名额不能低于待确认和已确认总人数。')
    const pickups = new Set(input.pickupPoints.map(p => p.id))
    // 只有「还在流程里」的报名才钉住集合点：已取消/已移除/未通过的人是历史行，
    // 让他们钉住一个没人用的集合点，领队就永远收不干净集合信息（审计 F2，与 invariants.js 同源）。
    if (roster.some(s => isCurrentSignup(s) && isVehicleTraveller(s) && !pickups.has(s.trip.pickupPointId))
      || state.vehicles.some(v => v.activityId === activityId && v.pickupPointIds.some(id => !pickups.has(id)))) {
      return failure('INVALID_INPUT', '仍有报名或车辆引用的上车点不能删除。')
    }
    const signupIds = new Set(roster.map(s => s.id))
    const points = new Set(input.routeSnapshot.points.map(p => p.id))
    if (state.attendance.some(a => signupIds.has(a.signupId) && a.nodes.some(n => !points.has(n.pointId)))) {
      return failure('INVALID_INPUT', '已有履约记录引用的路线节点不能删除。')
    }
  }
  return { ok: true, value: null }
}

/** 保存临时路线时落一份私有来源；后续编辑仍针对活动快照。 */
function persistPrivateRoute(state, activity, context) {
  const route = activity.routeSnapshot
  if (activity.routeId === null && (route.title.trim() || route.points.length || route.risks.length)) {
    const id = context.id('route')
    state.routes.push(Object.assign(deepClone(route), { id, ownerId: activity.ownerId }))
    activity.routeId = id
  }
}

function handleActivity(state, command, context) {
  const p = command.payload
  if (['activity.create', 'activity.edit', 'activity.copy', 'activity.publish', 'activity.transition', 'activity.delete'].indexOf(p.type) === -1) {
    return failure('INVALID_INPUT', '此活动处理器不支持该操作。')
  }
  const actorId = command.actor.userId
  if (!actorId) return failure('AUTH_REQUIRED', '请先选择当前账号。')

  if (p.type === 'activity.create') {
    const valid = validateInput(state, actorId, p.input, false)
    if (!valid.ok) return valid
    const activity = Object.assign(deepClone(p.input), { id: context.id('activity'), ownerId: actorId, phase: 'draft', acceptingSignups: false })
    persistPrivateRoute(state, activity, context)
    state.activities.push(activity)
    return success([activity.id])
  }
  const activityId = p.type === 'activity.copy' ? p.sourceActivityId : p.activityId
  const activity = state.activities.find(a => a.id === activityId)
  if (!activity) return failure('NOT_FOUND', '找不到本场活动。')

  switch (p.type) {
    case 'activity.copy': {
      const copy = deepClone(activity)
      copy.id = context.id('activity')
      copy.ownerId = actorId
      copy.phase = 'draft'
      copy.acceptingSignups = false
      delete copy.publishedAt
      copy.startAt = null
      copy.endAt = null
      copy.deadlineAt = null
      copy.pickupPoints = activity.pickupPoints.map(point => Object.assign(deepClone(point), { meetingAt: null }))
      if (copy.ownerId !== activity.ownerId) copy.routeId = null
      persistPrivateRoute(state, copy, context)
      state.activities.push(copy)
      return success([copy.id])
    }
    case 'activity.edit': {
      // handler 层的 owner 门（Phase 8.0）：canExecute 已 owner-only，这里显式复核——
      // 授权不依赖单点；activity.ownerId 与 actor 的关系是本命令唯一的授权依据。
      if (activity.ownerId !== command.actor.userId) return failure('FORBIDDEN', '只有活动发起者可以修改活动内容。')
      if (['closing', 'archived', 'cancelled'].indexOf(activity.phase) !== -1) return failure('WRONG_PHASE', '结束核验、归档或取消后，活动内容为只读。')
      if (!S.validate(S.ActivityInput, p.input)) return failure('INVALID_INPUT', '活动字段不完整或格式不正确。')
      const input = p.input
      if (activity.phase === 'gathering' || activity.phase === 'active') {
        // 阶段锁三组（2026-10-14「只增不改」，替代此前的整体 JSON 锁）：
        // ① 交易性键整体锁——标题/出发/截止/名额/审核方式/报名开关/路线归属是跟已报名者
        //    谈定的交易，一个字节都不能动（acceptingSignups 被 transition 置 false 也算差异，
        //    这是保护性的：陈旧表单不能把报名开关重新打开）；
        // ② 信息性数组只增不改——路线节点/风险/上车点按 id 逐条比对，已发出的条目必须
        //    逐字节相同，纯追加放行。发布门允许路线整体后补（快速创建），出发后仍要能补；
        //    删改早已被下面的引用守卫拦住（报名/车辆引用的上车点、履约记录引用的节点）；
        // ③ 信息性标量与文本（routeSnapshot 的标题/里程/爬升/轨迹线与说明类字段）可改。
        // endAt 只可延长的既有规则不变。
        const lockedKeys = ['title', 'startAt', 'deadlineAt', 'acceptingSignups', 'capacity', 'approvalMode', 'routeId']
        if (lockedKeys.some(key => JSON.stringify(input[key]) !== JSON.stringify(activity[key]))
          || !entriesUnchanged(activity.routeSnapshot.points, input.routeSnapshot.points)
          || !entriesUnchanged(activity.routeSnapshot.risks, input.routeSnapshot.risks)
          || !entriesUnchanged(activity.pickupPoints, input.pickupPoints)
          || !input.endAt || !activity.endAt || Date.parse(input.endAt) < Date.parse(activity.endAt)) {
          return failure('WRONG_PHASE', '集合或行程中仅可补充路线节点、风险与上车点，修改说明、装备、费用和取消说明，并延长结束时间。')
        }
      }
      const valid = validateInput(state, activity.ownerId, input, activity.phase !== 'draft', activity.id)
      if (!valid.ok) return valid
      Object.assign(activity, input)
      if (activity.phase === 'draft') activity.acceptingSignups = false
      persistPrivateRoute(state, activity, context)
      return success([activity.id])
    }
    case 'activity.publish': {
      if (activity.phase !== 'draft') return failure('WRONG_PHASE', '只有草稿活动可以发布。')
      const publishInput = deepClone(activity)
      delete publishInput.id
      delete publishInput.ownerId
      delete publishInput.phase
      const valid = validateInput(state, activity.ownerId, publishInput, true, activity.id)
      if (!valid.ok) return valid
      const targets = [activity.id]
      if (p.participation) {
        if (p.participation.personRef.kind !== 'user' || p.participation.personRef.userId !== actorId || actorId !== activity.ownerId) {
          return failure('INVALID_INPUT', '发布时只能明确选择发起者本人参与，不能代同行人加入。')
        }
        const registered = registerParticipants(state, activity, [p.participation], actorId, true, 'confirmed', context)
        if (!registered.ok) return registered
        targets.push.apply(targets, registered.value)
      }
      persistPrivateRoute(state, activity, context)
      activity.phase = 'published'
      activity.acceptingSignups = true
      activity.publishedAt = context.now
      return success(targets)
    }
    case 'activity.transition': {
      const roster = state.signups.filter(s => s.activityId === activity.id)
      const confirmed = roster.filter(s => s.status === 'confirmed')
      const ids = new Set(roster.map(s => s.id))
      const records = state.attendance.filter(a => ids.has(a.signupId))
      if (p.next === 'cancelled') {
        if (['draft', 'published', 'gathering'].indexOf(activity.phase) === -1) return failure('WRONG_PHASE', '只能在出发前取消活动。')
        if (records.some(a => (a.departure && a.departure.kind === 'joined') || a.boardingByLeg.outbound || a.boardingByLeg.return || a.home)
          || state.vehicles.some(v => v.activityId === activity.id && (v.legs.outbound.departed || v.legs.return.departed || v.legs.outbound.completed || v.legs.return.completed))) {
          return failure('UNRESOLVED_SAFETY', '已有出发或上车事实，不能取消活动并移除乘车关联。')
        }
        // 参与者司机仍是 confirmed 报名；共享不变量，不擦除也不重写这层关系。
        if (state.vehicles.some(v => v.activityId === activity.id && v.drivers.some(d => d.kind === 'participant'))) return failure('DRIVER_CONFLICT', '取消前请先更换参与者司机。')
        roster.filter(isCurrentSignup).forEach(s => { s.status = 'cancelled' })
        state.assignments = state.assignments.filter(a => a.activityId !== activity.id)
        state.positions.forEach(position => {
          if (ids.has(position.signupId) && position.revokedAt === null) position.revokedAt = context.now
        })
        activity.phase = 'cancelled'
        activity.acceptingSignups = false
        return success([activity.id])
      }
      if (activity.phase === 'published' && p.next === 'gathering') {
        if (roster.some(s => s.status === 'pending')) return failure('UNRESOLVED_DEPARTURE', '请先处理所有待确认报名，再开始集合。')
      } else if (activity.phase === 'gathering' && p.next === 'active') {
        for (const signup of confirmed) {
          const record = records.find(a => a.signupId === signup.id)
          if (!record || !record.departure) return failure('UNRESOLVED_DEPARTURE', '请逐一核实已确认参与者的出发情况。')
          // 去程上车要求只有一处定义（permissions.needsOutboundBoarding）：
          // 自行前往的人与兼任参与者的司机天然为 false，所以全员 self 的活动不需要任何车辆也能推进。
          if (record.departure.kind === 'joined' && (!record.checkIn || needsOutboundBoarding(state, signup))) {
            return failure('UNRESOLVED_DEPARTURE', '实际出行者需要签到；拼车乘客还需要去程上车确认。')
          }
        }
        for (const signup of confirmed) {
          const record = records.find(a => a.signupId === signup.id)
          if (record.departure && record.departure.kind === 'coordinating'
            && !state.incidents.some(i => i.activityId === activity.id && i.kind === 'late' && i.subjectIds.includes(signup.id) && i.resolution === null)) {
            state.incidents.push({
              id: context.id('incident'), activityId: activity.id, subjectIds: [signup.id], kind: 'late',
              description: '出发情况仍在协调，请继续核实人员去向。',
              opened: { at: context.now, by: actorId, note: '开始行程时仍在协调，保留未解决的迟到异常。' }, resolution: null,
            })
          }
        }
      } else if (activity.phase === 'active' && p.next === 'closing') {
        if (!p.reason.trim()) return failure('INVALID_INPUT', '请说明结束行程并进入安全核验的原因。')
      } else if (activity.phase === 'closing' && p.next === 'archived') {
        const unsafe = confirmed.some(signup => {
          const record = records.find(a => a.signupId === signup.id)
          return !record || !record.departure || record.departure.kind === 'coordinating' || (record.departure.kind === 'joined' && !record.home)
        })
        if (unsafe || state.incidents.some(i => i.activityId === activity.id && i.resolution === null)) return failure('UNRESOLVED_SAFETY', '仍有出发情况、到家或异常未核实，不能归档。')
      } else {
        return failure('WRONG_PHASE', '不允许跳过或回退活动阶段；草稿请使用发布操作。')
      }
      activity.phase = p.next
      activity.acceptingSignups = false
      return success([activity.id])
    }
    case 'activity.delete': {
      // 删除仅限草稿：已发布活动有报名/履约/安全记录，走取消（transition → cancelled）。
      if (activity.phase !== 'draft') return failure('WRONG_PHASE', '只有未发布的草稿可以删除；已发布活动请使用取消。')
      state.activities = state.activities.filter(a => a.id !== activityId)
      // 级联清理草稿作用域记录（草稿通常只有协作授权，防御式清干净以满足不变量）
      const removedSignups = new Set(state.signups.filter(s => s.activityId === activityId).map(s => s.id))
      state.signups = state.signups.filter(s => s.activityId !== activityId)
      state.attendance = state.attendance.filter(a => !removedSignups.has(a.signupId))
      state.groups = state.groups.filter(g => g.activityId !== activityId)
      state.memberships = state.memberships.filter(m => m.activityId !== activityId)
      state.notices = state.notices.filter(n => n.activityId !== activityId)
      state.vehicles = state.vehicles.filter(v => v.activityId !== activityId)
      state.assignments = state.assignments.filter(a => a.activityId !== activityId)
      state.incidents = state.incidents.filter(i => i.activityId !== activityId)
      // positions/attendance/assignments 这些以 signupId 为主键的记录里没有 activityId 字段，
      // 只能按被删报名的 id 清（审计 F5：原来按 p.activityId 筛等于一条都没删，
      // 一旦触发就会让「位置记录的参与者不存在」把此后全库每一次写入一起拖红）。
      state.positions = state.positions.filter(p => !removedSignups.has(p.signupId))
      // 历史变更事件挂在活动上，活动没了事件也一并清理（事件是活动作用域的日志，非安全档案）
      state.events = state.events.filter(e => e.activityId !== activityId)
      state.tasks = state.tasks.filter(t => t.activityId !== activityId)
      // 私有路线保留：它是所有者可复用的路线资产（V2 路线库的种子）
      return success([])
    }
    default: return failure('INVALID_INPUT', '此活动处理器不支持该操作。')
  }
}

module.exports = { handleActivity }
