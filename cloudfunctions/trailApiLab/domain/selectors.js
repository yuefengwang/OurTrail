// 由原型 domain/selectors.ts 移植：读取投影边界 + permittedActions + detailState。
'use strict'

const {
  authRequired, canExecute, canReadNotice, canReadSensitive, hasProxyConsent, isCurrentSignup,
  isOwnSignup, isOwner, isSelfSignup, needsOutboundBoarding, needsReturnBoarding, needsSeatAssignment,
  needsVehicleService, passengerAssignment, permissionDenied, missing, requireActivity, requireSignups,
  returnBoardingApplies, staffCan, vehicleCan, workDataAvailable, isVehicleTraveller,
} = require('./permissions')
// 「现场补录的门」由写侧自己给出（field.js），投影只消费：两处各写一遍必然漂移（审计 F4/F7）。
const { lateArrivalDoor, departureDoor } = require('./field')

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

// 北京时间日期键（YYYY-MM-DD）：发现页的日期筛选按「活动开始日」比较，
// 不把 ISO 时刻直接做字符串比较（时区与毫秒会让边界日漏掉）。
function cnDateOf(iso) {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10)
}
const DISCOVER_DIFFICULTIES = ['easy', 'moderate', 'hard']

// ---------- 投影边界：逐字段构造，不透传存储记录 ----------

function personView(person) {
  const view = { name: person.name, phone: person.phone, emergency: { name: person.emergency.name, phone: person.emergency.phone }, medical: person.medical }
  if (person.avatar) view.avatar = person.avatar
  return view
}
function evidenceView(evidence) {
  return evidence ? { at: evidence.at, by: evidence.by, note: evidence.note } : null
}
// 路线节点投影：time/ele 为可选的 GPX 元数据，缺省不带键（客户端据此判断能否推算抵达日）
function pointView(p) {
  const out = {
    id: p.id, name: p.name, kind: p.kind,
    coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null,
  }
  if (p.time) out.time = p.time
  if (Number.isFinite(p.ele)) out.ele = p.ele
  return out
}
// 轨迹折线投影：ele 只在真实存在时带出。旧轨迹没有它仍然合法，
// 但剖面渲染必须能区分「没有高程」与「高程为 0」，所以不能补 0。
function trackView(p) {
  const out = { lat: p.lat, lng: p.lng }
  if (Number.isFinite(p.ele)) out.ele = p.ele
  return out
}
// 风险投影：severity/coordinates 为 V2 路线库可选字段，缺省不带键。
// 活动编辑器按投影回填表单、再原样提交（gathering/active 的阶段锁是逐字节比对）——
// 哪个投影处少给一个键，编辑态就静默丢一个字段，阶段门立刻误伤。三处共用本函数。
function riskView(r) {
  const out = { id: r.id, title: r.title, advice: r.advice }
  if (r.severity) out.severity = r.severity
  if (r.coordinates) out.coordinates = { lat: r.coordinates.lat, lng: r.coordinates.lng }
  return out
}
// 路线完整性派生（2026-10-14 快速创建）：发布门不再要求路线字段非空，「缺什么」
// 由服务端一处派生，客户端不再各自判空——home/discover 各自 `|| '路线待完善'`
// 就是漂移源。pickups 入镜是因为「可忽略」的边界要能被同一处说清。
function routeCompleteness(activity) {
  const rs = activity.routeSnapshot
  return {
    route: !!rs.title.trim(),
    points: rs.points.length > 0,
    risks: rs.risks.length > 0,
    pickups: activity.pickupPoints.length > 0,
  }
}

// 封面解析顺序：显式封面 → 正文第一张 → 空串（客户端再退回氛围图）。
function firstContentImage(activity) {
  for (const block of Array.isArray(activity.content) ? activity.content : []) {
    if (block && block.type === 'images' && Array.isArray(block.fileIds) && block.fileIds.length) return block.fileIds[0]
  }
  return ''
}
function resolvedCover(activity) {
  return activity.coverFileId || firstContentImage(activity) || ''
}
function contentSearchText(activity) {
  const blocks = Array.isArray(activity.content) ? activity.content : []
  const text = blocks.filter(b => b && b.type === 'text').map(b => b.text).join(' ')
  return text + ' ' + (activity.highlights || []).join(' ')
}
function contentViewBlocks(activity) {
  return (activity.content || []).map(block => block.type === 'images'
    ? { type: 'images', fileIds: block.fileIds.slice() }
    : { type: 'text', text: block.text })
}

function activityView(activity, opts) {
  const view = {
    id: activity.id, title: activity.title, description: activity.description,
    organizerIntro: activity.organizerIntro, startAt: activity.startAt, endAt: activity.endAt,
    deadlineAt: activity.deadlineAt, phase: activity.phase, acceptingSignups: activity.acceptingSignups,
    capacity: activity.capacity, approvalMode: activity.approvalMode, ownerId: activity.ownerId, routeId: activity.routeId,
    routeSnapshot: Object.assign({
      title: activity.routeSnapshot.title, distanceKm: activity.routeSnapshot.distanceKm, ascentM: activity.routeSnapshot.ascentM,
      points: activity.routeSnapshot.points.map(p => pointView(p)),
      risks: activity.routeSnapshot.risks.map(r => riskView(r)),
      track: activity.routeSnapshot.track ? activity.routeSnapshot.track.map(trackView) : undefined,
    }, activity.routeSnapshot.difficulty ? { difficulty: activity.routeSnapshot.difficulty } : {}),
    pickupPoints: activity.pickupPoints.map(p => ({
      id: p.id, name: p.name, meetingAt: p.meetingAt, address: p.address,
      coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null,
    })),
    equipment: activity.equipment.slice(), feeNote: activity.feeNote, cancellationNote: activity.cancellationNote,
    equipmentSuggested: (activity.equipmentSuggested || []).slice(),
    // 公众号式图文（2026-10-21）：小字段始终给，正文块只在 detail 视图给。
    coverFileId: resolvedCover(activity),
    highlights: (activity.highlights || []).slice(),
    leader: activity.leader || '',
    ...(activity.minParticipants ? { minParticipants: activity.minParticipants } : {}),
    ...(activity.sceneryRating ? { sceneryRating: activity.sceneryRating } : {}),
    ...(activity.funRating ? { funRating: activity.funRating } : {}),
    feeSummary: activity.feeSummary || '',
    feeIncludes: (activity.feeIncludes || []).slice(),
    feeExcludes: (activity.feeExcludes || []).slice(),
    signupNote: activity.signupNote || '',
    visibility: activity.visibility || 'discover',
    completeness: routeCompleteness(activity),
  }
  if (opts && opts.includeContent) view.content = contentViewBlocks(activity)
  return view
}
function discoverView(activity, owner, confirmed) {
  return {
    id: activity.id, title: activity.title, description: activity.description,
    organizerIntro: activity.organizerIntro, startAt: activity.startAt, endAt: activity.endAt,
    deadlineAt: activity.deadlineAt, phase: activity.phase, acceptingSignups: activity.acceptingSignups,
    capacity: activity.capacity, approvalMode: activity.approvalMode, routeId: activity.routeId,
    routeSnapshot: Object.assign({
      title: activity.routeSnapshot.title, distanceKm: activity.routeSnapshot.distanceKm, ascentM: activity.routeSnapshot.ascentM,
      points: activity.routeSnapshot.points.map(p => ({ id: p.id, name: p.name, kind: p.kind, coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null })),
      risks: activity.routeSnapshot.risks.map(r => riskView(r)),
    }, activity.routeSnapshot.difficulty ? { difficulty: activity.routeSnapshot.difficulty } : {}),
    equipment: activity.equipment.slice(), feeNote: activity.feeNote, cancellationNote: activity.cancellationNote,
    equipmentSuggested: (activity.equipmentSuggested || []).slice(),
    coverFileId: resolvedCover(activity),
    publishedAt: activity.publishedAt, owner, confirmed,
    completeness: routeCompleteness(activity),
  }
}
function vehicleView(vehicle, contacts) {
  return {
    id: vehicle.id, activityId: vehicle.activityId, label: vehicle.label, plate: vehicle.plate,
    legalCapacity: vehicle.legalCapacity, blockedSeats: vehicle.blockedSeats,
    drivers: vehicle.drivers.map(d => d.kind === 'participant'
      ? { kind: 'participant', signupId: d.signupId }
      : { kind: 'service', name: d.name, phone: contacts === false ? '' : d.phone, userId: d.userId }),
    seatLabels: vehicle.seatLabels ? vehicle.seatLabels.slice() : null,
    pickupPointIds: vehicle.pickupPointIds.slice(),
    legs: {
      outbound: { departed: evidenceView(vehicle.legs.outbound.departed), completed: evidenceView(vehicle.legs.outbound.completed) },
      return: { departed: evidenceView(vehicle.legs.return.departed), completed: evidenceView(vehicle.legs.return.completed) },
    },
  }
}
function membershipView(membership) {
  return membership.role === 'staff' ? {
    role: 'staff', id: membership.id, activityId: membership.activityId, userId: membership.userId, expiresAt: membership.expiresAt,
    scope: membership.scope.kind === 'all' ? { kind: 'all' } : { kind: 'selected', signupIds: membership.scope.signupIds.slice() },
    capabilities: membership.capabilities.slice(),
  } : {
    role: 'vehicle_contact', id: membership.id, activityId: membership.activityId, userId: membership.userId,
    expiresAt: membership.expiresAt, vehicleId: membership.vehicleId,
  }
}
function noticeView(notice) {
  return {
    id: notice.id, activityId: notice.activityId, content: notice.content, publishedAt: notice.publishedAt,
    sourceEventId: notice.sourceEventId,
    // D-03：历史通知没有 kind 键，投影显式报 unknown，读端不按文案猜类型
    kind: notice.kind || 'unknown',
    audience: notice.audience.kind === 'activity' ? { kind: 'activity' }
      : notice.audience.kind === 'vehicle' ? { kind: 'vehicle', vehicleId: notice.audience.vehicleId }
        : { kind: 'signups', signupIds: notice.audience.signupIds.slice() },
    readBy: Object.assign({}, notice.readBy),
    deliveries: notice.deliveries.map(d => ({ id: d.id, channel: d.channel, status: d.status, at: d.at, by: d.by, detail: d.detail })),
  }
}
// 座位安排由域内唯一出处给出（permissions.passengerAssignment），不再在本文件另写一遍查找；
// participantDriverVehicle 只是取出司机所驾驶的那辆车供显示用。
const assignmentFor = passengerAssignment
function participantDriverVehicle(state, signup) {
  return state.vehicles.find(v => v.activityId === signup.activityId && v.drivers.some(d => d.kind === 'participant' && d.signupId === signup.id))
}
function rowView(state, signup) {
  const attendance = state.attendance.find(a => a.signupId === signup.id)
  const assignment = assignmentFor(state, signup)
  const vehicle = (assignment && state.vehicles.find(v => v.id === assignment.vehicleId && v.activityId === signup.activityId)) || participantDriverVehicle(state, signup)
  const activity = state.activities.find(a => a.id === signup.activityId)
  const byVehicle = isVehicleTraveller(signup)
  const pickupPoint = byVehicle && activity
    ? activity.pickupPoints.find(p => p.id === signup.trip.pickupPointId) : null
  return {
    signupId: signup.id, groupId: signup.groupId, name: signup.participant.name, status: signup.status,
    avatar: signup.participant.avatar || '',
    // 出行方式是结构化语义字段：detailState 与所有下游面板只读它，不再从 pickup 文案反推。
    tripMode: signup.trip.mode,
    pickupPointId: byVehicle ? signup.trip.pickupPointId : null,
    // 需要乘车的人即便上车点已失效也仍然是「需要乘车」——绝不能再显示成自行前往。
    pickup: !byVehicle ? '自行前往' : (pickupPoint ? pickupPoint.name : '上车点信息缺失'),
    vehicle: vehicle ? vehicle.label : '', seat: assignment ? assignment.seatLabel : null,
    // 「他此刻占着某个乘客座位吗」是域内查出来的事实，不是靠 vehicle/seat 是否非空推断的：
    // 分车面板用它筛掉不能当司机候选的人，UI 不再拿显示字段猜业务状态。
    hasPassengerAssignment: !!assignment,
    checkedIn: !!(attendance && attendance.checkIn),
    outboundBoarded: !!(attendance && attendance.boardingByLeg.outbound),
    returnBoarded: !!(attendance && attendance.boardingByLeg.return),
    // 三个「乘车义务」标志全部来自 permissions 的唯一出处；UI 据此决定要不要出现分车/上车入口。
    needsSeatAssignment: needsSeatAssignment(state, signup),
    needsOutboundBoarding: needsOutboundBoarding(state, signup),
    needsReturnBoarding: needsReturnBoarding(state, signup),
    // self 的返程不占用活动车辆：老数据里他们仍带着改造前写入的 'assigned'，按出行方式归一，
    // 免得界面宣称「自行前往的人原车返程」。新写入由 signup.js 直接落 'own'。
    returnPlan: !byVehicle ? 'own' : (attendance ? attendance.returnPlan.kind : 'assigned'),
    departure: attendance && attendance.departure ? attendance.departure.kind : 'unknown',
    home: !!(attendance && attendance.home),
  }
}
function ownerPermission(state, actor, activityId) {
  if (actor.userId === null) return authRequired()
  const exists = requireActivity(state, activityId)
  if (!exists.ok) return exists
  return isOwner(state, actor, activityId) ? { ok: true, value: null } : permissionDenied('仅活动所有者可管理此资源。')
}

// ---------- 独立读取 ----------

function selectSensitive(state, actor, activityId, signupId, purpose, now) {
  const permission = canReadSensitive(state, actor, activityId, signupId, purpose, now)
  if (!permission.ok) return permission
  const signup = state.signups.find(s => s.id === signupId)
  const person = signup.participant
  return { ok: true, value: { signupId, emergency: { name: person.emergency.name, phone: person.emergency.phone }, medical: person.medical } }
}

function selectContact(state, actor, activityId, signupId, now) {
  if (actor.userId === null) return authRequired()
  const exists = requireActivity(state, activityId)
  if (!exists.ok) return exists
  const targets = requireSignups(state, activityId, [signupId])
  if (!targets.ok) return targets
  const signup = targets.value[0]
  const assignment = assignmentFor(state, signup)
  const workAllowed = workDataAvailable(state, activityId) && (isOwner(state, actor, activityId)
    || staffCan(state, actor, activityId, 'roster', [signupId], now)
    || (signup.status === 'confirmed' && !!assignment && vehicleCan(state, actor, activityId, assignment.vehicleId, now)))
  if (!isSelfSignup(signup, actor) && !hasProxyConsent(signup, actor) && !workAllowed) return permissionDenied('没有此人的联络权限。')
  return { ok: true, value: { name: signup.participant.name, phone: signup.participant.phone } }
}

function selectSignupForm(state, actor, activityId, signupId, purpose, now) {
  const permission = canReadSensitive(state, actor, activityId, signupId, purpose, now)
  if (!permission.ok) return permission
  const signup = state.signups.find(s => s.id === signupId)
  if (!isOwnSignup(signup, actor) && !isOwner(state, actor, activityId)) return permissionDenied('没有编辑此报名的权限。')
  return {
    ok: true, value: {
      signupId, groupId: signup.groupId,
      input: {
        personRef: signup.personRef.kind === 'user' ? { kind: 'user', userId: signup.personRef.userId }
          : { kind: 'companion', ownerId: signup.personRef.ownerId, companionId: signup.personRef.companionId },
        participant: personView(signup.participant),
        trip: isVehicleTraveller(signup) ? { mode: 'shared', pickupPointId: signup.trip.pickupPointId } : { mode: 'self' },
        consent: { dataUse: signup.consent.dataUse, proxyAuthority: signup.consent.proxyAuthority, proxyHome: signup.consent.proxyHome },
      },
    },
  }
}

function selectTransport(state, actor, activityId) {
  const permission = ownerPermission(state, actor, activityId)
  if (!permission.ok) return permission
  return { ok: true, value: {
    vehicles: state.vehicles.filter(v => v.activityId === activityId).map(v => vehicleView(v, workDataAvailable(state, activityId))),
    assignments: state.assignments
      .filter(a => a.activityId === activityId
        && state.signups.some(s => s.activityId === activityId && s.id === a.signupId)
        && state.vehicles.some(v => v.activityId === activityId && v.id === a.vehicleId))
      .map(a => ({ activityId: a.activityId, signupId: a.signupId, vehicleId: a.vehicleId, seatLabel: a.seatLabel })),
    groups: state.groups.filter(g => g.activityId === activityId)
      .map(g => ({ id: g.id, keepTogether: g.keepTogether, signupIds: state.signups.filter(s => s.activityId === activityId && s.groupId === g.id).map(s => s.id) })),
  } }
}
function selectAccess(state, actor, activityId) {
  const permission = ownerPermission(state, actor, activityId)
  if (!permission.ok) return permission
  return { ok: true, value: { memberships: state.memberships.filter(m => m.activityId === activityId).map(membershipView) } }
}
function selectNoticeManagement(state, actor, activityId) {
  const permission = ownerPermission(state, actor, activityId)
  if (!permission.ok) return permission
  return { ok: true, value: { notices: state.notices.filter(n => n.activityId === activityId).map(noticeView) } }
}

/** CSV 单元格全部加引号，并中和公式注入（含前导空白）。 */
function csvCell(value) {
  const safe = /^[\s]*[=+@\-]/.test(value) || /^[\t\r]/.test(value) || /^\s*[\t\r]/.test(value) ? "'" + value : value
  return '"' + safe.split('"').join('""') + '"'
}
function selectExport(state, actor, activityId, signupIds, mode, purpose, now) {
  const permission = canExecute(state, actor, { type: 'export.record', activityId, signupIds, mode, purpose }, now)
  if (!permission.ok) return permission
  const tripLabels = { self: '自行前往', shared: '搭乘车辆' }
  const headers = ['姓名', '报名状态', '出行方式', '上车点', '车辆', '座位', '签到', '去程上车', '返程上车', '到家']
  if (mode === 'sensitive') headers.push('紧急联系人', '紧急联系电话', '健康备注')
  const statusLabels = { pending: '待审核', confirmed: '已确认', waitlisted: '候补', rejected: '已拒绝', cancelled: '已取消', removed: '已移除' }
  const cells = [headers]
  for (const id of signupIds) {
    const signup = state.signups.find(s => s.id === id)
    const row = rowView(state, signup)
    // 自行前往的人没有车辆/座位/上车这些事实，导出里写「未上车」等于凭空造出一个未完成项。
    const byVehicle = row.tripMode === 'shared'
    const values = [row.name, statusLabels[row.status], tripLabels[row.tripMode] || row.tripMode, row.pickup,
      byVehicle ? row.vehicle : '不适用', byVehicle ? (row.seat || '') : '不适用',
      row.checkedIn ? '已签到' : '未签到',
      byVehicle ? (row.outboundBoarded ? '已上车' : '未上车') : '不适用',
      byVehicle ? (row.returnBoarded ? '已上车' : '未上车') : '不适用',
      row.home ? '已到家' : '未到家']
    if (mode === 'sensitive') {
      const sensitive = selectSensitive(state, actor, activityId, id, purpose, now)
      if (!sensitive.ok) return sensitive
      values.push(sensitive.value.emergency.name, sensitive.value.emergency.phone, sensitive.value.medical)
    }
    cells.push(values)
  }
  return { ok: true, value: cells.map(row => row.map(csvCell).join(',')).join('\r\n') }
}

// ---------- V2 路线库投影 ----------

// 路线可见性：创建者 ∪ 共享名单。与 membership 的协作授权同构，
// 但作用域是「整条路线可读」而不是活动内的某项能力。
function routeVisible(route, userId) {
  return route.ownerId === userId || (route.sharedWith || []).indexOf(userId) !== -1
}
// 旧路线（activity 快照副产品）没有 source/updatedAt/visibility 键，读取时按缺省值补，
// 不写回存储——投影层补缺省，存储层保持原样。
function routeView(route, isOwner) {
  const out = Object.assign({
    id: route.id, ownerId: route.ownerId, title: route.title,
    // isOwner 由服务端显式给出：客户端不得拿"sharedWith 在不在"反推——
    // 那是把投影的细节当成契约，投影一改，owner 专属的 UI 就会泄漏给协作者。
    isOwner: !!isOwner,
    distanceKm: route.distanceKm, ascentM: route.ascentM,
    points: route.points.map(pointView),
    risks: route.risks.map(riskView),
    track: route.track ? route.track.map(trackView) : undefined,
    source: route.source || 'copy',
    visibility: route.visibility || 'private',
    updatedAt: route.updatedAt || null,
  }, route.difficulty ? { difficulty: route.difficulty } : {})
  // 共享名单只给创建者看：协作者不需要知道还有谁。
  if (isOwner) out.sharedWith = (route.sharedWith || []).slice()
  return out
}
// 进行中排最前：它是正在占人手的活；待办次之；已完成沉底。
const TASK_STATUS_RANK = { doing: 0, todo: 1, done: 2 }
function taskView(task) {
  return {
    id: task.id,
    title: task.title,
    note: task.note,
    category: task.category,
    assigneeName: task.assigneeName,
    status: task.status,
    dueAt: task.dueAt,
    updatedAt: task.updated ? task.updated.at : null,
  }
}
function selectTasks(state, actor, activityId, now) {
  if (actor.userId === null) return authRequired()
  const activity = state.activities.find(a => a.id === activityId)
  if (!activity) return missing()
  const owner = isOwner(state, actor, activityId)
  const participant = state.signups.some(s => s.activityId === activityId && isOwnSignup(s, actor) && isCurrentSignup(s))
  const staff = hasStaffMembership(state, actor, activityId, now)
  if (!owner && !participant && !staff) return permissionDenied('没有此活动任务的访问权限。')
  const tasks = (state.tasks || [])
    .filter(t => t.activityId === activityId)
    .slice()
    .sort((a, b) => {
      const rank = (TASK_STATUS_RANK[a.status] || 0) - (TASK_STATUS_RANK[b.status] || 0)
      if (rank) return rank
      const ad = a.dueAt ? Date.parse(a.dueAt) : Infinity
      const bd = b.dueAt ? Date.parse(b.dueAt) : Infinity
      if (ad !== bd) return ad - bd
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map(taskView)
  return { ok: true, value: {
    kind: 'tasks', activityId, activityTitle: activity.title,
    canManage: owner && workDataAvailable(state, activityId),
    tasks,
  } }
}
function selectRoutes(state, actor, routeId) {
  if (actor.userId === null) return authRequired()
  if (routeId) {
    const route = state.routes.find(r => r.id === routeId)
    if (!route) return { ok: false, error: { code: 'NOT_FOUND', message: '找不到此路线。' } }
    if (!routeVisible(route, actor.userId)) return permissionDenied('没有此路线的访问权限。')
    const owner = route.ownerId === actor.userId
    return { ok: true, value: {
      route: routeView(route, owner),
      referencedActivityIds: state.activities.filter(a => a.routeId === routeId).map(a => a.id),
    } }
  }
  // 列表：按最近保存倒序；时间并列按 id 定序（同一批数据反复读取必须同一顺序）。
  const routes = state.routes
    .filter(r => routeVisible(r, actor.userId))
    .sort((a, b) => (b.updatedAt || '') < (a.updatedAt || '') ? -1 : (b.updatedAt || '') > (a.updatedAt || '') ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(r => ({
      id: r.id, title: r.title, distanceKm: r.distanceKm, ascentM: r.ascentM,
      difficulty: r.difficulty || null,
      pointCount: r.points.length, riskCount: r.risks.length,
      updatedAt: r.updatedAt || null,
      source: r.source || 'copy',
      visibility: r.visibility || 'private',
      isOwner: r.ownerId === actor.userId,
      referencedCount: state.activities.filter(a => a.routeId === r.id).length,
    }))
  return { ok: true, value: { routes } }
}

function planVisible(plan, userId) {
  return plan.ownerId === userId || (Array.isArray(plan.sharedWith) && plan.sharedWith.indexOf(userId) !== -1)
}

/**
 * V3 个人计划读视图（实施文档 §8.3）。
 * 白名单投影：**不回传 ownerId / sharedWith 原文**（不暴露他人身份码），
 * 共享场景只给 isOwner=false + sharedBy=<显示名>（取不到回落「同行者」）。
 */
function selectPlans(state, actor, planId) {
  if (actor.userId === null) return authRequired()
  const nameOf = userId => {
    const p = state.profiles.find(x => x.id === userId)
    return (p && p.person && p.person.name) ? p.person.name : '同行者'
  }
  const plans = state.plans
    .filter(p => planVisible(p, actor.userId))
    .filter(p => !planId || p.id === planId)
    .sort((a, b) => (b.updatedAt || '') < (a.updatedAt || '') ? -1 : (b.updatedAt || '') > (a.updatedAt || '') ? 1
      : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(p => {
      const isOwner = p.ownerId === actor.userId
      const row = {
        id: p.id, routeId: p.routeId, name: p.name, startDate: p.startDate,
        stops: (p.stops || []).map(s => ({ nodeIndex: s.nodeIndex, day: s.day, time: s.time })),
        visibility: p.visibility || (p.sharedWith && p.sharedWith.length ? 'shared' : 'private'),
        isOwner,
        sharedBy: isOwner ? '' : nameOf(p.ownerId),
        // 只给 owner 一个**数量**，用来表达「已分享给 N 位同行者」并据此提供「取消全部共享」。
        // 名单原文不出投影（§8.3）；协作者连数量也不需要知道。
        sharedCount: isOwner ? (p.sharedWith || []).length : 0,
        updatedAt: p.updatedAt || null,
      }
      // 共享名单只给创建者（与 routeView 同一条界线）：owner 需要它来逐个取消分享；
      // 被授权者只拿到 sharedBy 显示名，看不到任何人的身份码。
      if (isOwner) row.sharedWith = (p.sharedWith || []).slice()
      return row
    })
  return { ok: true, value: { kind: 'plans', plans } }
}

function hasStaffMembership(state, actor, activityId, now) {
  return actor.userId !== null && state.memberships.some(m => m.role === 'staff' && m.activityId === activityId
    && m.userId === actor.userId && Date.parse(now) < Date.parse(m.expiresAt))
}
function deniedView(code, message) {
  return { kind: 'denied', code, message }
}
function validCoordinates(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// ---------- 主投影 ----------

// ---------- 共享投影助手（home 与 me 视图同源，06-api-and-selector-design.md §2） ----------

// 参与者视角可见活动：owner ∪ 本人报名 ∪ 协作/车辆授权 ∪ 最近打开（draft 仅 owner）
function visibleActivitiesFor(state, actor, perspective, openedIds, now) {
  const opened = Array.isArray(openedIds) ? openedIds : []
  return state.activities.filter(a => {
    const owner = isOwner(state, actor, a.id)
    if (a.phase === 'draft') return owner
    const own = state.signups.some(s => s.activityId === a.id && isOwnSignup(s, actor))
    const membership = perspective === 'staff' ? hasStaffMembership(state, actor, a.id, now)
      : (perspective === 'vehicle' && state.vehicles.some(v => vehicleCan(state, actor, a.id, v.id, now)))
    return owner || own || membership || opened.indexOf(a.id) !== -1
  })
}

// 「我的」页的位置授权撤回入口：本人或有效代报的、仍有未撤回位置上报、且本人可撤回的报名。
// D-05：授权随活动结束到期后**仍然列出**（用户要知道自己曾授权），但必须标 expired。
// 边界与活动视图「有效位置」同源：consentExpiresAt 那一刻起不再有效（那边用严格 <）。
function positionRowsFor(state, actor, activity, ownRows, now) {
  const nowMs = Date.parse(now)
  return ownRows
    .filter(s => s.status === 'confirmed')
    .map(s => ({ s, position: state.positions.find(p => p.signupId === s.id && p.revokedAt === null) }))
    .filter(x => x.position)
    .filter(x => canExecute(state, actor, { type: 'position.revoke', activityId: activity.id, signupId: x.s.id }, now).ok)
    .map(x => ({
      activityId: activity.id, activityTitle: activity.title, signupId: x.s.id, name: x.s.participant.name,
      expired: !(nowMs < Date.parse(x.position.consentExpiresAt)),
    }))
}

// me 视图的活动口径（03-information-architecture.md §3.2 的服务端精确版）
const ME_ONGOING_PHASES = ['published', 'gathering', 'active', 'closing']

function selectView(state, actor, request, now) {
  if (request.kind === 'profile') {
    if (actor.userId === null) return deniedView('AUTH_REQUIRED', '请先选择当前账号。')
    const profile = state.profiles.find(p => p.id === actor.userId)
    // 与原型不同：小程序里首次访问返回空档案，由 profile.save 真正落库。
    if (!profile) {
      return { kind: 'profile', profile: { id: actor.userId, person: personView({ name: '', phone: '', emergency: { name: '', phone: '' }, medical: '' }), companions: [] } }
    }
    return { kind: 'profile', profile: { id: profile.id, person: personView(profile.person), companions: profile.companions.map(c => ({ id: c.id, person: personView(c.person) })) } }
  }
  if (request.kind === 'me') {
    // 「我的」页专用复合视图（06 §2）：profile + 统计 + 最近活动 + positionRows，
    // 一次 read 出齐——消除「为 positionRows 拉全量 home（含轨迹折线）」的读取浪费。
    if (actor.userId === null) return deniedView('AUTH_REQUIRED', '请先选择当前账号。')
    const profile = state.profiles.find(p => p.id === actor.userId)
    const meProfile = profile
      ? { id: profile.id, person: personView(profile.person), companions: profile.companions.map(c => ({ id: c.id, person: personView(c.person) })) }
      : { id: actor.userId, person: personView({ name: '', phone: '', emergency: { name: '', phone: '' }, medical: '' }), companions: [] }
    const activities = visibleActivitiesFor(state, actor, 'participant', [], now)
    const nowMs = Date.parse(now)
    let ongoing = 0
    let finished = 0
    let organized = 0
    const ongoingPool = []
    const restPool = []
    const positionRows = []
    for (const activity of activities) {
      const owner = isOwner(state, actor, activity.id)
      if (owner) organized += 1
      const ownRows = state.signups.filter(s => s.activityId === activity.id && isOwnSignup(s, actor))
      const ownCurrent = ownRows.some(s => isCurrentSignup(s))
      if (ME_ONGOING_PHASES.indexOf(activity.phase) !== -1 && (owner || ownCurrent)) ongoing += 1
      if (activity.phase === 'archived' && (owner || ownRows.length)) finished += 1
      positionRows.push.apply(positionRows, positionRowsFor(state, actor, activity, ownRows, now))
      // 最近活动：进行中优先，其余按 |startAt - now| 由近到远（与客户端 me-view.js 同口径）
      const slim = { id: activity.id, title: activity.title, startAt: activity.startAt, phase: activity.phase, role: owner ? 'owner' : 'participant' }
      const pool = ME_ONGOING_PHASES.indexOf(activity.phase) !== -1 && (owner || ownCurrent) ? ongoingPool : restPool
      pool.push({ slim, dist: activity.startAt && Number.isFinite(Date.parse(activity.startAt)) ? Math.abs(Date.parse(activity.startAt) - nowMs) : Infinity })
    }
    const byDist = (a, b) => a.dist - b.dist
    ongoingPool.sort(byDist)
    restPool.sort(byDist)
    const recent = ongoingPool.concat(restPool).slice(0, 3).map(x => x.slim)
    return { kind: 'me', profile: meProfile, stats: { ongoing, finished, organized }, recent, positionRows }
  }
  if (request.kind === 'home') {
    const activities = visibleActivitiesFor(state, actor, request.perspective, request.openedActivityIds, now)
      .map(activityView)
    // 附加首页汇总（原型在客户端逐个 read 计算；这里一次算好）
    for (const activity of activities) {
      const roster = state.signups.filter(s => s.activityId === activity.id)
      const owner = isOwner(state, actor, activity.id)
      const ownRows = roster.filter(s => isOwnSignup(s, actor))
      const meta = {
        owner,
        joined: ownRows.some(s => ['pending', 'confirmed', 'waitlisted'].indexOf(s.status) !== -1),
        staff: hasStaffMembership(state, actor, activity.id, now),
        vehicle: state.vehicles.some(v => v.activityId === activity.id && vehicleCan(state, actor, activity.id, v.id, now)),
        confirmed: roster.filter(s => s.status === 'confirmed').length,
        pending: roster.filter(s => s.status === 'pending').length,
        capacity: activity.capacity,
      }
      meta.positionRows = positionRowsFor(state, actor, activity, ownRows, now)
      activity.meta = meta
    }
    return { kind: 'home', activities }
  }
  if (request.kind === 'discover') {
    if (actor.userId === null) return deniedView('AUTH_REQUIRED', '请先完善资料，再看看别人发起的活动。')
    const nowMs = Date.parse(now)
    const search = typeof request.search === 'string' ? request.search.trim().toLowerCase() : ''
    // 筛选参数全部可选；旧客户端只传 search 时，行为与历史逐字节一致。
    const dateFrom = typeof request.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.dateFrom) ? request.dateFrom : ''
    const dateTo = typeof request.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.dateTo) ? request.dateTo : ''
    const difficulty = DISCOVER_DIFFICULTIES.indexOf(request.difficulty) !== -1 ? request.difficulty : ''
    const sort = request.sort === 'start' ? 'start' : 'published'
    const pubMs = a => (a.publishedAt ? Date.parse(a.publishedAt) : -Infinity)
    const startMs = a => (a.startAt ? Date.parse(a.startAt) : Infinity)
    const activities = state.activities
      .filter(a => {
        if (['draft', 'cancelled', 'archived'].indexOf(a.phase) !== -1) return false
        // 可见范围：link 只在发现页之外；放在 slice 之前，避免它占用 50 条名额。
        if ((a.visibility || 'discover') === 'link') return false
        if (a.startAt && Date.parse(a.startAt) < nowMs) return false
        const startDate = cnDateOf(a.startAt)
        if (dateFrom && (!startDate || startDate < dateFrom)) return false
        if (dateTo && (!startDate || startDate > dateTo)) return false
        if (difficulty && a.routeSnapshot.difficulty !== difficulty) return false
        if (!search) return true
        const hay = (a.title + ' ' + a.routeSnapshot.title + ' ' + a.description + ' ' + contentSearchText(a)).toLowerCase()
        return hay.indexOf(search) !== -1
      })
      .sort(sort === 'start'
        ? (a, b) => startMs(a) - startMs(b) || pubMs(b) - pubMs(a)
        : (a, b) => pubMs(b) - pubMs(a) || startMs(a) - startMs(b))
      .slice(0, 50)
      .map(a => discoverView(a, isOwner(state, actor, a.id), state.signups.filter(s => s.activityId === a.id && s.status === 'confirmed').length))
    return { kind: 'discover', activities }
  }
  if (request.kind === 'tasks') {
    const result = selectTasks(state, actor, request.activityId, now)
    return result.ok ? result.value : deniedView(result.error.code, result.error.message)
  }
  if (request.kind === 'plans') {
    const result = selectPlans(state, actor, request.planId || null)
    return result.ok ? result.value : deniedView(result.error.code, result.error.message)
  }
  if (request.kind === 'notices') {
    if (actor.userId === null) return deniedView('AUTH_REQUIRED', '请先选择当前账号。')
    if (request.activityId && !state.activities.some(a => a.id === request.activityId)) return deniedView('NOT_FOUND', '找不到此活动。')
    return {
      kind: 'notices',
      notices: state.notices
      .filter(n => (!request.activityId || n.activityId === request.activityId) && canReadNotice(state, actor, n, now))
      .map(n => ({ id: n.id, activityId: n.activityId, content: n.content, publishedAt: n.publishedAt, read: hasOwn(n.readBy, actor.userId), kind: n.kind || 'unknown' })),
    }
  }
  if (request.kind !== 'activity') return deniedView('FORBIDDEN', '不支持此读取请求。')
  const activity = state.activities.find(a => a.id === request.activityId)
  if (!activity) return deniedView('NOT_FOUND', '找不到此活动。')
  const owner = isOwner(state, actor, activity.id)
  if (activity.phase === 'draft' && !owner) return deniedView('FORBIDDEN', '未发布活动仅所有者可见。')
  if (request.perspective === 'organizer' && !owner) return deniedView('FORBIDDEN', '不是此活动的组织者。')
  if (request.perspective === 'staff' && !hasStaffMembership(state, actor, activity.id, now)) return deniedView('FORBIDDEN', '此活动的协作授权不存在或已过期。')
  let vehicle = undefined
  if (request.perspective === 'vehicle') {
    if (request.vehicleId) {
      vehicle = state.vehicles.find(v => v.id === request.vehicleId)
      if (!vehicle) return deniedView('NOT_FOUND', '找不到此车辆。')
      if (vehicle.activityId !== activity.id) return deniedView('FORBIDDEN', '车辆不属于此活动。')
    } else {
      vehicle = state.vehicles.find(v => vehicleCan(state, actor, activity.id, v.id, now))
    }
    if (!vehicle || !vehicleCan(state, actor, activity.id, vehicle.id, now)) return deniedView('FORBIDDEN', '没有此车辆的联络权限。')
  }
  const all = state.signups.filter(s => s.activityId === activity.id)
  const own = all.filter(s => isOwnSignup(s, actor))
  const primary = own.find(s => s.id === request.selectedSignupId)
    || own.find(s => isSelfSignup(s, actor) && isCurrentSignup(s))
    || own.slice().reverse().find(s => isSelfSignup(s, actor))
  const passengers = vehicle && workDataAvailable(state, activity.id)
    ? all.filter(s => s.status === 'confirmed' && assignmentFor(state, s) && assignmentFor(state, s).vehicleId === vehicle.id)
    : []
  const visible = request.perspective === 'organizer' ? all
    : request.perspective === 'staff' ? all.filter(s => staffCan(state, actor, activity.id, 'roster', [s.id], now))
      : request.perspective === 'vehicle' ? passengers : own
  const rows = visible.map(s => rowView(state, s))
  const incidents = request.perspective === 'vehicle' ? [] : state.incidents
    .filter(i => i.activityId === activity.id
      && i.subjectIds.every(id => all.some(s => s.id === id))
      && (request.perspective === 'organizer' || (request.perspective === 'staff'
        ? staffCan(state, actor, activity.id, 'incident', i.subjectIds, now)
        : i.subjectIds.some(id => own.some(s => s.id === id)))))
    .map(i => ({ id: i.id, subjectIds: i.subjectIds.slice(), kind: i.kind, description: i.description, resolved: i.resolution !== null }))
  const positions = request.perspective === 'vehicle' || activity.phase !== 'active' ? [] : state.positions
    .map(p => ({ p, signup: all.find(s => s.id === p.signupId) }))
    .filter(x => x.signup && x.signup.status === 'confirmed' && x.signup.consent.dataUse && x.p.revokedAt === null
      && Date.parse(now) < Date.parse(x.p.consentExpiresAt)
      && Number.isFinite(Date.parse(x.p.reportedAt))
      && validCoordinates(x.p.coordinates.lat, x.p.coordinates.lng))
    .filter(x => request.perspective === 'organizer' || (request.perspective === 'staff'
      ? staffCan(state, actor, activity.id, 'position', [x.signup.id], now)
      : isSelfSignup(x.signup, actor) || hasProxyConsent(x.signup, actor)))
    .map(x => ({
      signupId: x.signup.id, name: x.signup.participant.name,
      coordinates: { lat: x.p.coordinates.lat, lng: x.p.coordinates.lng },
      reportedAt: x.p.reportedAt,
      stale: Date.parse(now) - Date.parse(x.p.reportedAt) > 30 * 60 * 1000,
    }))
  const confirmed = all.filter(s => s.status === 'confirmed').length
  const pending = all.filter(s => s.status === 'pending').length
  const view = {
    kind: 'activity', activity: activityView(activity, { includeContent: true }), perspective: request.perspective,
    primarySignupId: primary ? primary.id : null, rows,
    counters: {
      confirmed, pending, occupied: confirmed + pending,
      waitlisted: all.filter(s => s.status === 'waitlisted').length,
      remaining: activity.capacity - confirmed - pending,
      // 出行方式分桶：Leader 只需要处理「需要乘车且尚未安排」这一格。
      // self 参与者不进 unassigned（不是缺事项），也不需要一个都没有的「未分车」计数。
      selfTravel: visible.filter(s => s.status === 'confirmed' && !isVehicleTraveller(s)).length,
      vehicleTravel: visible.filter(s => s.status === 'confirmed' && isVehicleTraveller(s)).length,
      assigned: visible.filter(s => s.status === 'confirmed' && isVehicleTraveller(s) && !needsSeatAssignment(state, s)).length,
      unassigned: visible.filter(s => s.status === 'confirmed' && needsSeatAssignment(state, s)).length,
      unchecked: rows.filter(r => r.status === 'confirmed' && !r.checkedIn).length,
      pendingHome: rows.filter(r => r.status === 'confirmed' && r.departure === 'joined' && !r.home).length,
      openIncidents: incidents.filter(i => !i.resolved && i.subjectIds.some(id => visible.some(s => s.id === id))).length,
    },
    permittedActions: [],
    vehicleTask: vehicle && workDataAvailable(state, activity.id) ? {
      vehicle: vehicleView(vehicle, true),
      passengers: passengers.map(s => {
        const r = rowView(state, s)
        return {
          signupId: r.signupId, groupId: r.groupId, name: r.name, status: r.status, pickup: r.pickup,
          vehicle: r.vehicle, seat: r.seat, checkedIn: r.checkedIn, outboundBoarded: r.outboundBoarded,
          returnBoarded: r.returnBoarded, returnPlan: r.returnPlan, departure: r.departure, home: r.home,
          // 车长页此前自己用 returnPlan/seat 推导「谁还需要清点」；改为直接消费域内标志。
          // returnBoardingApplies = 返程清点是否存在（含已上车的人）；needsReturnBoarding = 还欠着没清点。
          needsOutboundBoarding: r.needsOutboundBoarding, needsReturnBoarding: r.needsReturnBoarding,
          returnBoardingApplies: returnBoardingApplies(state, s),
          avatar: r.avatar, phone: s.participant.phone,
        }
      }),
    } : null,
    positions, incidents,
  }
  view.permittedActions = permittedActions(state, actor, view, visible, now)
  view.detailState = getDetailState(view, now)
  return view
}

function permittedActions(state, actor, view, visible, now) {
  if (actor.userId === null) return []
  const activityId = view.activity.id
  const phase = view.activity.phase
  const actions = new Set()
  const add = payload => { if (canExecute(state, actor, payload, now).ok) actions.add(payload.type) }
  const work = phase !== 'archived' && phase !== 'cancelled'
  // 组织者能力按"是否所有者"判定而非读取视角：详情页以 participant 视角读取，
  // 所有者查看自己的草稿时也需要 activity.edit/activity.publish 等 UI 门控（域层 canExecute 仍是真闸门）。
  const organizer = view.perspective === 'organizer' || isOwner(state, actor, activityId)
  if (organizer) {
    actions.add('activity.copy')
    actions.add('export.record')
    if (work) {
      actions.add('activity.edit')
      actions.add('activity.transition')
      actions.add('membership.save')
      actions.add('membership.revoke')
      actions.add('notice.publish')
      actions.add('notice.delivery')
      if (phase === 'draft') { actions.add('activity.publish'); actions.add('activity.delete') }
      if (phase === 'published' || phase === 'gathering') {
        for (const type of ['vehicle.save', 'vehicle.remove', 'assignment.commit', 'assignment.set', 'assignment.remove', 'assignment.swap']) actions.add(type)
      }
      // 审核与递补只成立在 published（signup.js:125 的阶段门），且只在这两类人真的存在时广播：
      // 候补队列可以带进集合阶段，而域内那时已经拒绝递补——照旧广播就是给界面一个必红字按钮（审计 F4b）。
      if (phase === 'published') {
        if (view.counters.pending > 0) actions.add('signup.review')
        if (view.counters.waitlisted > 0) actions.add('signup.promote')
      }
    }
  }
  if (view.perspective === 'participant' && phase === 'published' && view.activity.acceptingSignups
    && (!view.activity.deadlineAt || Date.parse(now) < Date.parse(view.activity.deadlineAt))) actions.add('signup.submit')
  for (const signup of visible) {
    if (work && phase === 'published' && isCurrentSignup(signup)) {
      add({ type: 'signup.cancel', activityId, signupIds: [signup.id], reason: '' })
      add({ type: 'signup.edit', activityId, signupId: signup.id, participant: signup.participant, trip: signup.trip, purpose: '编辑报名资料' })
      add({ type: 'group.setTogether', activityId, groupId: signup.groupId, keepTogether: true })
    }
    if (state.positions.some(p => p.signupId === signup.id && p.revokedAt === null)) add({ type: 'position.revoke', activityId, signupId: signup.id })
    if (!work || signup.status !== 'confirmed') continue
    const attendance = state.attendance.find(a => a.signupId === signup.id)
    if (!attendance) continue
    // 门与写侧共用同一份定义（field.js）：投影不得自己再判一次「什么时候还能补录」，
    // 否则 domain 放开了、UI 还藏着按钮，或反过来 UI 给了按钮而 domain 必拒。
    const late = lateArrivalDoor(phase, attendance)
    if (phase === 'gathering' || late) {
      add({ type: 'attendance.checkin', activityId, signupId: signup.id, checkIn: { method: 'manual', evidence: { at: now, by: actor.userId, note: '' } } })
    }
    if (departureDoor(phase, attendance)) {
      add({ type: 'attendance.departure', activityId, signupId: signup.id, outcome: { kind: 'joined', evidence: { at: now, by: actor.userId, note: '' } } })
    }
    if (phase === 'gathering' || late) {
      // 去程上车只对「已排到车的拼车乘客」成立：自行前往的人与兼任参与者的司机没有任何上车事实可记，
      // field.js 必拒 —— 不广播，UI 就不会有一个点下去只换来红字的按钮。
      if (needsVehicleService(state, signup) && assignmentFor(state, signup)) {
        add({ type: 'attendance.board', activityId, signupId: signup.id, leg: 'outbound', boarded: true, note: '' })
      }
    }
    if (phase === 'active' && attendance.departure && attendance.departure.kind === 'joined' && view.activity.routeSnapshot.points.length) {
      // 空路线（发布门已允许路线整体后补）不广播「确认到达节点」：没有 pointId 可填，
      // 挂上去就是一个点下去只换红字的按钮（本文件 :590 自述的原则）。节点补上后自然出现。
      add({ type: 'attendance.node', activityId, signupId: signup.id, pointId: view.activity.routeSnapshot.points[0].id, note: '' })
      add({ type: 'position.report', activityId, signupId: signup.id, coordinates: { lat: 0, lng: 0 }, consent: true })
    }
    if (phase === 'gathering' || phase === 'active' || phase === 'closing') add({ type: 'incident.report', activityId, signupIds: [signup.id], kind: 'other', description: '' })
    if (phase === 'active' || phase === 'closing') {
      // 返程安排是乘车的子事实：自行前往的人返程不占用活动车辆。
      if (isVehicleTraveller(signup)) add({ type: 'attendance.returnPlan', activityId, signupId: signup.id, plan: 'assigned', note: '' })
      if (attendance.departure && attendance.departure.kind === 'joined' && returnBoardingApplies(state, signup)) add({ type: 'attendance.board', activityId, signupId: signup.id, leg: 'return', boarded: true, note: '' })
      if (phase === 'closing' && attendance.departure && attendance.departure.kind === 'joined' && !attendance.home) add({ type: 'attendance.home', activityId, signupId: signup.id, note: '' })
    }
  }
  if (work && ['gathering', 'active', 'closing'].indexOf(phase) !== -1) {
    for (const incident of view.incidents.filter(i => !i.resolved)) add({ type: 'incident.resolve', activityId, incidentId: incident.id, note: '' })
    const vehicles = organizer ? state.vehicles.filter(v => v.activityId === activityId) : (view.vehicleTask ? [view.vehicleTask.vehicle] : [])
    // 每一程的合法阶段与 field.js 同表；按钮只在该程「还没发车」或「已发车未完成的」时出现。
    // 「完成本程」在发车之前是永远不可能成立的（field.js:40 必拒），不能挂在界面上等用户去撞红字。
    const legs = phase === 'gathering' ? ['outbound'] : phase === 'active' ? ['outbound', 'return'] : ['return']
    for (const vehicle of vehicles) {
      for (const leg of legs) {
        const legInfo = vehicle.legs[leg]
        if (!legInfo.departed) add({ type: 'vehicle.depart', activityId, vehicleId: vehicle.id, leg, note: '' })
        else if (!legInfo.completed) add({ type: 'vehicle.complete', activityId, vehicleId: vehicle.id, leg, note: '' })
      }
    }
  }
  if (state.notices.some(n => n.activityId === activityId && canReadNotice(state, actor, n, now))) actions.add('notice.read')
  return Array.from(actions)
}

const DETAIL_STATES = ['new', 'pending', 'confirmed', 'ready', 'gathering', 'checked', 'active', 'closing', 'finished', 'waitlist', 'closed', 'cancelled']
function getDetailState(view, now) {
  const activity = view.activity
  if (activity.phase === 'cancelled') return 'cancelled'
  if (activity.phase === 'archived') return 'finished'
  const signup = view.rows.find(row => row.signupId === view.primarySignupId)
  if (signup && signup.status === 'pending') return 'pending'
  if (signup && signup.status === 'waitlisted') return 'waitlist'
  if (signup && signup.status === 'confirmed') {
    if (activity.phase === 'closing') return 'closing'
    if (activity.phase === 'active') return 'active'
    if (activity.phase === 'gathering') return signup.checkedIn ? 'checked' : 'gathering'
    // 「就绪」= 没有待办的乘车安排。此前这一行拿 pickup === '自行前往' 判断，
    // 等于让中文文案给状态机投票；现在读域内算好的义务标志。
    return signup.needsSeatAssignment ? 'confirmed' : 'ready'
  }
  return activity.phase === 'published' && activity.acceptingSignups
    && (!activity.deadlineAt || Date.parse(now) < Date.parse(activity.deadlineAt)) ? 'new' : 'closed'
}

module.exports = {
  selectView, selectSensitive, selectContact, selectSignupForm, selectTransport,
  selectAccess, selectNoticeManagement, selectExport, selectRoutes, selectPlans, getDetailState, DETAIL_STATES,
}
