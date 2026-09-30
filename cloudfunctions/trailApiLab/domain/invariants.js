// 由原型 domain/invariants.ts 移植：命令落库前对整个 State 做关系完整性校验。
'use strict'

const S = require('./schema')
const { failure } = require('./contracts')

const invalid = message => failure('INVALID_INPUT', message)
const unique = values => new Set(values).size === values.length

function assertInvariants(state) {
  if (!S.validate(S.stateSpec, state)) return invalid('记录字段不完整或格式不正确。')
  const collections = [state.profiles, state.routes, state.activities, state.groups, state.signups,
    state.vehicles, state.memberships, state.incidents, state.events, state.notices]
  if (collections.some(items => !unique(items.map(item => item.id)))) return invalid('记录标识不能重复。')
  if (!unique(state.receipts.map(r => r.actorId + '\u0000' + r.requestId))) return invalid('请求记录重复。')
  const profiles = new Map(state.profiles.map(p => [p.id, p]))
  const activities = new Map(state.activities.map(a => [a.id, a]))
  const groups = new Map(state.groups.map(g => [g.id, g]))
  const signups = new Map(state.signups.map(s => [s.id, s]))
  const vehicles = new Map(state.vehicles.map(v => [v.id, v]))
  const attendance = new Map(state.attendance.map(a => [a.signupId, a]))
  if (attendance.size !== state.attendance.length || attendance.size !== signups.size) return invalid('每位报名者必须有且仅有一份履约记录。')
  for (const profile of state.profiles) {
    if (!unique(profile.companions.map(p => p.id))) return invalid('常用同行人标识重复。')
  }
  for (const route of state.routes) {
    if (!profiles.has(route.ownerId) || !unique(route.points.map(p => p.id))) return invalid('路线归属或节点标识无效。')
  }
  for (const group of state.groups) {
    if (!activities.has(group.activityId) || !profiles.has(group.submittedByUserId)) return invalid('报名组的活动或提交者不存在。')
  }
  for (const signup of state.signups) {
    const activity = activities.get(signup.activityId)
    const group = groups.get(signup.groupId)
    if (!activity || !group || group.activityId !== signup.activityId || group.submittedByUserId !== signup.submittedByUserId || !attendance.has(signup.id)) return invalid('报名、同行组与履约记录不一致。')
    if (!profiles.has(signup.submittedByUserId) || !profiles.has(signup.consent.recordedBy)) return invalid('报名提交者或授权记录者不存在。')
    if (signup.personRef.kind === 'user' && !profiles.has(signup.personRef.userId)) return invalid('报名所引用的账号不存在。')
    if (signup.personRef.kind === 'companion' && signup.personRef.ownerId !== signup.submittedByUserId) return invalid('同行人与提交者的关系不一致。')
    const trip = signup.trip
    if (trip.mode === 'shared' && !activity.pickupPoints.some(p => p.id === trip.pickupPointId)) return invalid('报名上车点不属于本场活动。')
  }
  for (const activity of state.activities) {
    if (!profiles.has(activity.ownerId)) return invalid('活动发起账号不存在。')
    if (!unique(activity.pickupPoints.map(p => p.id)) || !unique(activity.routeSnapshot.points.map(p => p.id))) return invalid('集合点或路线节点标识重复。')
    if (activity.routeId && !state.routes.some(r => r.id === activity.routeId && r.ownerId === activity.ownerId)) return invalid('活动关联的私有路线不属于发起者。')
    if (activity.phase !== 'draft' && activity.phase !== 'cancelled') {
      if (!activity.title.trim() || !activity.startAt || !activity.endAt || !activity.deadlineAt || !activity.pickupPoints.length
        || !activity.routeSnapshot.points.length || !activity.routeSnapshot.risks.length) return invalid('发布活动需要完整的时间、集合点、路线与风险说明。')
      if (Date.parse(activity.deadlineAt) > Date.parse(activity.startAt) || Date.parse(activity.startAt) >= Date.parse(activity.endAt)) return invalid('活动截止、开始和结束时间顺序不正确。')
    }
    const roster = state.signups.filter(s => s.activityId === activity.id)
    const occupied = roster.filter(s => s.status === 'pending' || s.status === 'confirmed')
    if (occupied.length > activity.capacity) return failure('CAPACITY', '待确认与已确认人数超过活动名额。')
    const live = roster.filter(s => ['pending', 'confirmed', 'waitlisted'].indexOf(s.status) !== -1)
    const people = live.map(s => s.personRef.kind === 'user'
      ? 'user:' + s.personRef.userId
      : 'companion:' + s.personRef.ownerId + ':' + s.personRef.companionId)
    if (!unique(people)) return failure('DUPLICATE_PERSON', '同一位参与者不能重复占用本场报名资格。')
    if (activity.phase === 'cancelled' && (activity.acceptingSignups || live.length || state.assignments.some(a => a.activityId === activity.id))) return invalid('已取消活动不能残留招募、有效报名或车辆分配。')
    if (activity.phase === 'archived') {
      const unsafe = roster.filter(s => s.status === 'confirmed').some(s => {
        const record = attendance.get(s.id)
        return !record || !record.departure || record.departure.kind === 'coordinating' || (record.departure.kind === 'joined' && !record.home)
      })
      if (unsafe || state.incidents.some(i => i.activityId === activity.id && !i.resolution)) return failure('UNRESOLVED_SAFETY', '仍有出发情况、到家或异常未完成核实，不能归档。')
    }
  }
  const participantDrivers = new Set()
  const serviceDrivers = new Set()
  for (const vehicle of state.vehicles) {
    const activity = activities.get(vehicle.activityId)
    if (!activity || !vehicle.pickupPointIds.length || !unique(vehicle.pickupPointIds)
      || vehicle.pickupPointIds.some(id => !activity.pickupPoints.some(p => p.id === id))) return invalid('车辆服务的集合点不属于本场活动。')
    const capacity = vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats
    if (capacity < 0) return failure('VEHICLE_FULL', '核载减去司机及不可用位后不能为负数。')
    if (vehicle.seatLabels && (!unique(vehicle.seatLabels) || vehicle.seatLabels.length !== capacity)) return invalid('座号必须唯一，且数量与可用乘客位一致。')
    for (const driver of vehicle.drivers) {
      if (driver.kind === 'participant') {
        const signup = signups.get(driver.signupId)
        if (!signup || signup.activityId !== vehicle.activityId || signup.status !== 'confirmed' || participantDrivers.has(signup.id)) return failure('DRIVER_CONFLICT', '参与者司机必须已确认，且同场只能驾驶一辆车。')
        participantDrivers.add(signup.id)
      } else if (driver.userId) {
        const key = vehicle.activityId + ':' + driver.userId
        if (!profiles.has(driver.userId) || serviceDrivers.has(key)) return failure('DRIVER_CONFLICT', '司机账号不存在或重复分配到本场多辆车。')
        serviceDrivers.add(key)
      }
    }
    if (state.assignments.filter(a => a.vehicleId === vehicle.id).length > capacity) return failure('VEHICLE_FULL', vehicle.label + ' 的乘客人数超过可用乘客位。')
  }
  if (!unique(state.assignments.map(a => a.signupId))) return invalid('同一位参与者不能同时分配到两辆车。')
  const occupiedSeats = new Set()
  for (const assignment of state.assignments) {
    const signup = signups.get(assignment.signupId)
    const vehicle = vehicles.get(assignment.vehicleId)
    if (!signup || !vehicle || signup.activityId !== assignment.activityId || vehicle.activityId !== assignment.activityId) return invalid('人员与车辆分配引用了不存在或其他活动的记录。')
    if (signup.status !== 'confirmed') return failure('WRONG_PHASE', '只有已确认参与者才能分车。')
    if (participantDrivers.has(signup.id)) return failure('DRIVER_CONFLICT', '参与者司机不能重复分配乘客座位。')
    if (signup.trip.mode !== 'shared') return invalid('自行到达者不能分配乘客座位。')
    if (!vehicle.pickupPointIds.includes(signup.trip.pickupPointId)) return failure('PICKUP_MISMATCH', '车辆不经过这位参与者的上车点。')
    if (assignment.seatLabel !== null) {
      if (!vehicle.seatLabels || vehicle.seatLabels.indexOf(assignment.seatLabel) === -1) return invalid('所选座号不属于这辆车。')
      const key = vehicle.id + ':' + assignment.seatLabel
      if (occupiedSeats.has(key)) return failure('SEAT_TAKEN', '同一个座位不能安排两位参与者。')
      occupiedSeats.add(key)
    }
  }
  for (const group of state.groups.filter(g => g.keepTogether)) {
    const ids = new Set(state.signups.filter(s => s.groupId === group.id && s.status === 'confirmed').map(s => s.id))
    const cars = new Set(state.assignments.filter(a => ids.has(a.signupId)).map(a => a.vehicleId))
    if (cars.size > 1) return failure('GROUP_SCOPE', '同行组需要安排同车；请先明确记录允许分开。')
  }
  for (const member of state.memberships) {
    if (!activities.has(member.activityId) || !profiles.has(member.userId)) return invalid('协作授权所属活动或账号不存在。')
    if (member.role === 'staff' && member.scope.kind === 'selected'
      && (!unique(member.scope.signupIds) || member.scope.signupIds.some(id => {
        const s = signups.get(id)
        return !s || s.activityId !== member.activityId
      }))) return invalid('协作分管名单包含其他活动的人员。')
    if (member.role === 'vehicle_contact') {
      const v = vehicles.get(member.vehicleId)
      if (!v || v.activityId !== member.activityId) return invalid('车辆联系人绑定了不存在或其他活动的车辆。')
    }
  }
  for (const record of state.attendance) {
    const signup = signups.get(record.signupId)
    const activity = signup && activities.get(signup.activityId)
    if (!signup || !activity) return invalid('履约记录的参与者不存在。')
    if (!unique(record.nodes.map(n => n.pointId)) || record.nodes.some(n => !activity.routeSnapshot.points.some(p => p.id === n.pointId))) return invalid('节点记录重复或不属于本场路线。')
    if (record.departure && record.departure.kind === 'joined' && (signup.status !== 'confirmed' || !record.checkIn)) return invalid('实际出行者必须保持有效报名及签到事实。')
    if (record.home && (!record.departure || record.departure.kind !== 'joined')) return invalid('未核实实际出行者不能被标记为安全到家。')
    if (record.returnPlan.kind === 'independent' && !record.returnPlan.evidence.note.trim()) return invalid('另行返程必须有核实依据。')
  }
  if (!unique(state.positions.map(p => p.signupId))) return invalid('每位参与者只保留一条最新上报位置。')
  for (const position of state.positions) {
    const signup = signups.get(position.signupId)
    if (!signup) return invalid('位置记录的参与者不存在。')
    if (!position.revokedAt && (signup.status !== 'confirmed' || activities.get(signup.activityId).phase === 'cancelled')) return invalid('取消报名或活动后必须撤回有效位置。')
  }
  for (const incident of state.incidents) {
    if (!activities.has(incident.activityId) || !unique(incident.subjectIds)
      || incident.subjectIds.some(id => {
        const s = signups.get(id)
        return !s || s.activityId !== incident.activityId
      })) return invalid('异常涉及的人员不属于本场活动。')
    if (incident.resolution && !incident.resolution.note.trim()) return invalid('关闭异常需要核实结果。')
  }
  for (const notice of state.notices) {
    if (!activities.has(notice.activityId)) return invalid('通知所属活动不存在。')
    if (notice.audience.kind === 'signups' && notice.audience.signupIds.some(id => {
      const s = signups.get(id)
      return !s || s.activityId !== notice.activityId
    })) return invalid('通知受众不属于本场活动。')
    if (notice.audience.kind === 'vehicle') {
      const v = vehicles.get(notice.audience.vehicleId)
      if (v && v.activityId !== notice.activityId) return invalid('通知引用了其他活动的车辆。')
    }
    if (Object.keys(notice.readBy).some(id => !profiles.has(id))) return invalid('通知已读账号不存在。')
  }
  for (const event of state.events) {
    if (!activities.has(event.activityId) || !profiles.has(event.actorId)) return invalid('活动记录所属活动或操作账号不存在。')
  }
  return { ok: true, value: null }
}

module.exports = { assertInvariants }
