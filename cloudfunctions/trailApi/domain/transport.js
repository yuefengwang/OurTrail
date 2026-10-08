// 由原型 domain/transport.ts 移植：车辆档案与乘车安排（预览提交 / 手动设置 / 移除 / 交换）。
'use strict'

const { failure, deepClone } = require('./contracts')
const { passengerCapacity } = require('./allocation')
const { requireSignups } = require('./permissions')
const { travelLocked } = require('./signup')

const done = ids => ({ ok: true, value: ids })
const hasLegHistory = vehicle => !!(vehicle.legs.outbound.departed || vehicle.legs.outbound.completed
  || vehicle.legs.return.departed || vehicle.legs.return.completed)

/** 指定名单里，仍是本车参与者司机且已留下履约事实的人：动这辆车会连带抹掉那条事实。 */
function travelLockedDrivers(vehicle, state, signupIds) {
  return vehicle.drivers
    .filter(d => d.kind === 'participant' && signupIds.indexOf(d.signupId) !== -1 && travelLocked(state, d.signupId))
    .map(d => d.signupId)
}

function vehicleInActivity(state, activityId, vehicleId) {
  const vehicle = state.vehicles.find(v => v.id === vehicleId)
  if (!vehicle) return failure('NOT_FOUND', '找不到车辆。')
  if (vehicle.activityId !== activityId) return failure('FORBIDDEN', '车辆不属于此活动。')
  return { ok: true, value: vehicle }
}

function editableAssignments(state, activityId, signupIds, vehicleIds) {
  const signups = requireSignups(state, activityId, signupIds)
  if (!signups.ok) return signups
  for (const signupId of signupIds) {
    const record = state.attendance.find(a => a.signupId === signupId)
    if (record && (record.boardingByLeg.outbound || record.boardingByLeg.return || record.departure)) {
      return failure('WRONG_PHASE', '已有上车或出发核实记录，不能修改乘车安排。')
    }
  }
  const oldVehicleIds = state.assignments.filter(a => signupIds.indexOf(a.signupId) !== -1).map(a => a.vehicleId)
  const checkIds = []
  for (const id of oldVehicleIds) if (checkIds.indexOf(id) === -1) checkIds.push(id)
  for (const id of vehicleIds) if (checkIds.indexOf(id) === -1) checkIds.push(id)
  for (const vehicleId of checkIds) {
    const found = vehicleInActivity(state, activityId, vehicleId)
    if (!found.ok) return found
    if (hasLegHistory(found.value)) return failure('WRONG_PHASE', '车辆已发车，不能修改乘车安排。')
  }
  return { ok: true, value: null }
}

function driverIdentity(state, driver) {
  if (driver.kind === 'service') return driver.userId === null ? null : 'user:' + driver.userId
  const signup = state.signups.find(s => s.id === driver.signupId)
  if (!signup) return null
  const ref = signup.personRef
  return ref.kind === 'user' ? 'user:' + ref.userId : 'companion:' + ref.ownerId + ':' + ref.companionId
}

function validateDrivers(state, activityId, vehicleId, input) {
  const occupied = new Set(state.vehicles
    .filter(v => v.activityId === activityId && v.id !== vehicleId)
    .flatMap(v => v.drivers.map(d => driverIdentity(state, d)))
    .filter(id => id !== null))
  for (const driver of input.drivers) {
    if (driver.kind === 'participant') {
      const signup = state.signups.find(s => s.id === driver.signupId)
      if (!signup || signup.activityId !== activityId || signup.status !== 'confirmed') {
        return failure('DRIVER_CONFLICT', '参与者司机必须是本场已确认报名者。')
      }
      if (state.assignments.some(a => a.signupId === driver.signupId)) {
        return failure('DRIVER_CONFLICT', '司机不能同时占用乘客座位，请先明确解除其乘客安排。')
      }
    } else if (driver.userId !== null && !state.profiles.some(p => p.id === driver.userId)) {
      return failure('DRIVER_CONFLICT', '司机账号不存在。')
    }
    const identity = driverIdentity(state, driver)
    if (identity !== null) {
      if (occupied.has(identity)) return failure('DRIVER_CONFLICT', '同一位司机不能重复登记或驾驶本场多辆车。')
      occupied.add(identity)
    }
  }
  return { ok: true, value: null }
}

const sameAssignment = (a, b) => a.activityId === b.activityId
  && a.signupId === b.signupId && a.vehicleId === b.vehicleId && a.seatLabel === b.seatLabel

/** 调度器（commands.js）负责授权、克隆、回执、通知和最终不变量。 */
function handleTransport(candidate, command, context) {
  const payload = command.payload
  if (['vehicle.save', 'vehicle.remove', 'assignment.commit', 'assignment.set', 'assignment.remove', 'assignment.swap'].indexOf(payload.type) === -1) {
    return failure('INVALID_INPUT', '不支持此车辆安排操作。')
  }
  const activity = candidate.activities.find(a => a.id === payload.activityId)
  if (!activity) return failure('NOT_FOUND', '找不到活动。')
  const vehicleCommand = payload.type === 'vehicle.save' || payload.type === 'vehicle.remove'
  if (activity.phase !== 'published' && activity.phase !== 'gathering' && !(vehicleCommand && activity.phase === 'draft')) {
    return failure('WRONG_PHASE', '当前阶段不能修改车辆或乘车安排。')
  }

  switch (payload.type) {
    case 'vehicle.save': {
      let old = undefined
      if (payload.vehicleId !== null) {
        const found = vehicleInActivity(candidate, payload.activityId, payload.vehicleId)
        if (!found.ok) return found
        old = found.value
        if (hasLegHistory(old)) return failure('WRONG_PHASE', '已发车或完成行程的车辆不能修改配置。')
        // 从司机名单里去掉一个「已经以司机身份上车/出发」的人，等于替他抹掉那条事实——
        // 与 vehicle.remove 的乘客规则同源：先明确解除义务，再动承载它的记录（审计 F11）。
        const keptIds = payload.input.drivers.filter(d => d.kind === 'participant').map(d => d.signupId)
        const dropped = old.drivers.filter(d => d.kind === 'participant' && keptIds.indexOf(d.signupId) === -1).map(d => d.signupId)
        if (travelLockedDrivers(old, candidate, dropped).length) {
          return failure('DRIVER_CONFLICT', '本车的参与者司机已有上车或出发事实，请先在名单里更正他的出发情况，再更换司机。')
        }
      }
      const drivers = validateDrivers(candidate, payload.activityId, payload.vehicleId, payload.input)
      if (!drivers.ok) return drivers
      const vehicle = Object.assign(deepClone(payload.input), {
        id: old ? old.id : context.id('vehicle'), activityId: payload.activityId,
        legs: old ? deepClone(old.legs) : { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
      })
      const capacity = passengerCapacity(vehicle)
      if (capacity < 0) return failure('VEHICLE_FULL', '核载减去司机及不可用位后不能为负数。')
      if (vehicle.seatLabels && (vehicle.seatLabels.length !== capacity || new Set(vehicle.seatLabels).size !== vehicle.seatLabels.length)) {
        return failure('INVALID_INPUT', '座号必须唯一，且数量与可用乘客位一致。')
      }
      if (old) candidate.vehicles[candidate.vehicles.indexOf(old)] = vehicle
      else candidate.vehicles.push(vehicle)
      return done([vehicle.id])
    }
    case 'vehicle.remove': {
      const found = vehicleInActivity(candidate, payload.activityId, payload.vehicleId)
      if (!found.ok) return found
      if (hasLegHistory(found.value)) return failure('WRONG_PHASE', '不能删除已有行程事实的车辆。')
      if (candidate.assignments.some(a => a.vehicleId === payload.vehicleId)) {
        return failure('CONFLICT', '车辆仍有乘客安排，请先明确调整或解除安排。')
      }
      // 车上的参与者司机也是这辆车的承载义务：删车会连「他答应开车」这条一起消失，
      // 且他会立刻变成需要别人捎带的人——若此时他已被核实随队出发，就再没有合法路径补齐乘车事实。
      const held = travelLockedDrivers(found.value, candidate,
        found.value.drivers.filter(d => d.kind === 'participant').map(d => d.signupId))
      if (held.length) {
        return failure('DRIVER_CONFLICT', '本车的参与者司机已有上车或出发事实，请先更换司机，再删除这辆车。')
      }
      candidate.vehicles = candidate.vehicles.filter(v => v.id !== payload.vehicleId)
      candidate.memberships = candidate.memberships.filter(m => m.role !== 'vehicle_contact' || m.vehicleId !== payload.vehicleId)
      // 通知与事件是历史事实，不属于车辆配置的子资源。
      return done([payload.vehicleId])
    }
    case 'assignment.commit': {
      const preview = payload.preview
      if (preview.activityId !== payload.activityId || preview.assignments.some(a => a.activityId !== payload.activityId)) {
        return failure('FORBIDDEN', '预览或乘车安排不属于此活动。')
      }
      if (preview.baseRevision !== candidate.revision) return failure('CONFLICT', '分车预览已过期，请重新生成。')
      const bySignup = new Map(preview.assignments.map(a => [a.signupId, a]))
      if (bySignup.size !== preview.assignments.length) return failure('INVALID_INPUT', '分车预览不能重复安排同一位参与者。')
      const existing = candidate.assignments.filter(a => a.activityId === payload.activityId)
      for (const assignment of existing) {
        const proposed = bySignup.get(assignment.signupId)
        if (!proposed || !sameAssignment(assignment, proposed)) {
          return failure('CONFLICT', '分车预览不能删除或覆盖已有座位，请使用明确的调整操作。')
        }
      }
      const existingIds = new Set(existing.map(a => a.signupId))
      const additions = preview.assignments.filter(a => !existingIds.has(a.signupId))
      const editable = editableAssignments(candidate, payload.activityId, additions.map(a => a.signupId), additions.map(a => a.vehicleId))
      if (!editable.ok) return editable
      // 保留原有记录与顺序；unassigned 仅作提示。
      candidate.assignments.push.apply(candidate.assignments, deepClone(additions))
      return done(additions.map(a => a.signupId))
    }
    case 'assignment.set': {
      const editable = editableAssignments(candidate, payload.activityId, [payload.target.signupId], [payload.target.vehicleId])
      if (!editable.ok) return editable
      const index = candidate.assignments.findIndex(a => a.signupId === payload.target.signupId)
      const next = Object.assign({ activityId: payload.activityId }, deepClone(payload.target))
      if (index < 0) candidate.assignments.push(next)
      else candidate.assignments[index] = next
      return done([payload.target.signupId])
    }
    case 'assignment.remove': {
      const editable = editableAssignments(candidate, payload.activityId, [payload.signupId], [])
      if (!editable.ok) return editable
      if (!candidate.assignments.some(a => a.activityId === payload.activityId && a.signupId === payload.signupId)) {
        return failure('NOT_FOUND', '这位参与者尚未分配车辆。')
      }
      candidate.assignments = candidate.assignments.filter(a => a.signupId !== payload.signupId)
      return done([payload.signupId])
    }
    case 'assignment.swap': {
      const firstSignupId = payload.firstSignupId
      const secondSignupId = payload.secondSignupId
      if (firstSignupId === secondSignupId) return failure('INVALID_INPUT', '交换座位需要两位不同的参与者。')
      const editable = editableAssignments(candidate, payload.activityId, [firstSignupId, secondSignupId], [])
      if (!editable.ok) return editable
      const first = candidate.assignments.find(a => a.signupId === firstSignupId)
      const second = candidate.assignments.find(a => a.signupId === secondSignupId)
      if (!first || !second) return failure('NOT_FOUND', '交换前两位参与者都必须已有乘车安排。')
      // 先双侧交换，再由调度器检查上车点/同车组/容量/座位不变量。
      candidate.assignments = candidate.assignments.map(a =>
        a.signupId === firstSignupId ? { activityId: a.activityId, signupId: a.signupId, vehicleId: second.vehicleId, seatLabel: second.seatLabel }
          : a.signupId === secondSignupId ? { activityId: a.activityId, signupId: a.signupId, vehicleId: first.vehicleId, seatLabel: first.seatLabel }
            : a)
      return done([firstSignupId, secondSignupId])
    }
  }
}

module.exports = { handleTransport, hasLegHistory }
