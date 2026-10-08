// 由原型 domain/selectors.ts 移植：读取投影边界 + permittedActions + detailState。
'use strict'

const {
  authRequired, canExecute, canReadNotice, canReadSensitive, hasProxyConsent, isCurrentSignup,
  isOwnSignup, isOwner, isSelfSignup, needsOutboundBoarding, needsReturnBoarding, needsSeatAssignment,
  needsVehicleService, passengerAssignment, permissionDenied, requireActivity, requireSignups,
  returnBoardingApplies, staffCan, vehicleCan, workDataAvailable, isVehicleTraveller,
} = require('./permissions')
// 「现场补录的门」由写侧自己给出（field.js），投影只消费：两处各写一遍必然漂移（审计 F4/F7）。
const { lateArrivalDoor, departureDoor } = require('./field')

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key)

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

function activityView(activity) {
  return {
    id: activity.id, title: activity.title, description: activity.description,
    organizerIntro: activity.organizerIntro, startAt: activity.startAt, endAt: activity.endAt,
    deadlineAt: activity.deadlineAt, phase: activity.phase, acceptingSignups: activity.acceptingSignups,
    capacity: activity.capacity, approvalMode: activity.approvalMode, ownerId: activity.ownerId, routeId: activity.routeId,
    routeSnapshot: {
      title: activity.routeSnapshot.title, distanceKm: activity.routeSnapshot.distanceKm, ascentM: activity.routeSnapshot.ascentM,
      points: activity.routeSnapshot.points.map(p => pointView(p)),
      risks: activity.routeSnapshot.risks.map(r => ({ id: r.id, title: r.title, advice: r.advice })),
      track: activity.routeSnapshot.track ? activity.routeSnapshot.track.map(p => ({ lat: p.lat, lng: p.lng })) : undefined,
    },
    pickupPoints: activity.pickupPoints.map(p => ({
      id: p.id, name: p.name, meetingAt: p.meetingAt, address: p.address,
      coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null,
    })),
    equipment: activity.equipment.slice(), feeNote: activity.feeNote, cancellationNote: activity.cancellationNote,
  }
}
function discoverView(activity, owner, confirmed) {
  return {
    id: activity.id, title: activity.title, description: activity.description,
    organizerIntro: activity.organizerIntro, startAt: activity.startAt, endAt: activity.endAt,
    deadlineAt: activity.deadlineAt, phase: activity.phase, acceptingSignups: activity.acceptingSignups,
    capacity: activity.capacity, approvalMode: activity.approvalMode, routeId: activity.routeId,
    routeSnapshot: {
      title: activity.routeSnapshot.title, distanceKm: activity.routeSnapshot.distanceKm, ascentM: activity.routeSnapshot.ascentM,
      points: activity.routeSnapshot.points.map(p => ({ id: p.id, name: p.name, kind: p.kind, coordinates: p.coordinates ? { lat: p.coordinates.lat, lng: p.coordinates.lng } : null })),
      risks: activity.routeSnapshot.risks.map(r => ({ id: r.id, title: r.title, advice: r.advice })),
    },
    equipment: activity.equipment.slice(), feeNote: activity.feeNote, cancellationNote: activity.cancellationNote,
    publishedAt: activity.publishedAt, owner, confirmed,
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

// 「我的」页的位置授权撤回入口：本人或有效代报的、仍有有效位置上报、且本人可撤回的报名
function positionRowsFor(state, actor, activity, ownRows, now) {
  return ownRows
    .filter(s => s.status === 'confirmed' && state.positions.some(p => p.signupId === s.id && p.revokedAt === null))
    .filter(s => canExecute(state, actor, { type: 'position.revoke', activityId: activity.id, signupId: s.id }, now).ok)
    .map(s => ({ activityId: activity.id, activityTitle: activity.title, signupId: s.id, name: s.participant.name }))
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
    const pubMs = a => (a.publishedAt ? Date.parse(a.publishedAt) : -Infinity)
    const startMs = a => (a.startAt ? Date.parse(a.startAt) : Infinity)
    const activities = state.activities
      .filter(a => {
        if (['draft', 'cancelled', 'archived'].indexOf(a.phase) !== -1) return false
        if (a.startAt && Date.parse(a.startAt) < nowMs) return false
        if (!search) return true
        const hay = (a.title + ' ' + a.routeSnapshot.title + ' ' + a.description).toLowerCase()
        return hay.indexOf(search) !== -1
      })
      .sort((a, b) => pubMs(b) - pubMs(a) || startMs(a) - startMs(b))
      .slice(0, 50)
      .map(a => discoverView(a, isOwner(state, actor, a.id), state.signups.filter(s => s.activityId === a.id && s.status === 'confirmed').length))
    return { kind: 'discover', activities }
  }
  if (request.kind === 'notices') {
    if (actor.userId === null) return deniedView('AUTH_REQUIRED', '请先选择当前账号。')
    if (request.activityId && !state.activities.some(a => a.id === request.activityId)) return deniedView('NOT_FOUND', '找不到此活动。')
    return {
      kind: 'notices',
      notices: state.notices
      .filter(n => (!request.activityId || n.activityId === request.activityId) && canReadNotice(state, actor, n, now))
      .map(n => ({ id: n.id, activityId: n.activityId, content: n.content, publishedAt: n.publishedAt, read: hasOwn(n.readBy, actor.userId) })),
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
    kind: 'activity', activity: activityView(activity), perspective: request.perspective,
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
    if (phase === 'active' && attendance.departure && attendance.departure.kind === 'joined') {
      add({ type: 'attendance.node', activityId, signupId: signup.id, pointId: view.activity.routeSnapshot.points.length ? view.activity.routeSnapshot.points[0].id : '', note: '' })
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
  selectAccess, selectNoticeManagement, selectExport, getDetailState, DETAIL_STATES,
}
