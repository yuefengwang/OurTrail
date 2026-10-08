// 由原型 domain/allocation.ts 移植：纯函数式分车预览，绝不重排已有座位。
'use strict'

const { failure, deepClone } = require('./contracts')
const { authRequired, isOwner, isVehicleTraveller, needsVehicleService, permissionDenied, requireActivity } = require('./permissions')

/** 乘客位 = 核载 − 司机（含服务司机）− 预留/禁用。 */
function passengerCapacity(vehicle) {
  return vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats
}

// 自然序比较（数字块按数值比较），替代 Intl.Collator 的 numeric 行为。
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g
  const ax = String(a).match(re) || [String(a)]
  const bx = String(b).match(re) || [String(b)]
  const len = Math.min(ax.length, bx.length)
  for (let i = 0; i < len; i++) {
    const x = ax[i]
    const y = bx[i]
    const xn = /^\d/.test(x)
    const yn = /^\d/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
      if (x.length !== y.length) return x.length < y.length ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  if (ax.length !== bx.length) return ax.length < bx.length ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}
const compare = (a, b) => naturalCompare(a, b)

function planAssignments(state, actor, activityId, now) {
  if (actor.userId === null) return authRequired()
  const exists = requireActivity(state, activityId)
  if (!exists.ok) return exists
  if (!isOwner(state, actor, activityId)) return permissionDenied()
  const activity = state.activities.find(a => a.id === activityId)
  if (activity.phase !== 'published' && activity.phase !== 'gathering') {
    return failure('WRONG_PHASE', '仅可在已发布或集合阶段安排车辆。')
  }
  // 惰性 require 必须写对相对路径（此处曾写成 ../invariants——从 domain/ 上跳一级不存在，
  // 预览分车在真机必炸 Cannot find module；且藏在函数体内，node --check 与既有测试全数放行）
  const valid = require('./invariants').assertInvariants(state)
  if (!valid.ok) return valid

  const allVehicles = state.vehicles.filter(v => v.activityId === activityId)
  const vehicles = allVehicles
    .filter(v => !(v.legs.outbound.departed || v.legs.outbound.completed || v.legs.return.departed || v.legs.return.completed))
    .sort((a, b) => compare(a.id, b.id))
  // 「谁需要乘车」只有一处定义：needsVehicleService 天然排除 self 与兼任参与者的司机，
  // 所以自动分车永远不会把自行前往的人排进车里。
  const eligible = state.signups
    .filter(s => s.activityId === activityId && s.status === 'confirmed' && needsVehicleService(state, s))
    .sort((a, b) => compare(a.id, b.id))
  const together = new Set(state.groups.filter(g => g.activityId === activityId && g.keepTogether).map(g => g.id))
  const units = new Map()
  for (const signup of eligible) {
    const key = together.has(signup.groupId) ? 'group:' + signup.groupId : 'signup:' + signup.id
    const members = units.get(key) || []
    members.push(signup)
    units.set(key, members)
  }

  const assignments = deepClone(state.assignments.filter(a => a.activityId === activityId))
  const assigned = new Map(assignments.map(a => [a.signupId, a]))
  const unassigned = []
  for (const members of units.values()) {
    const remaining = members.filter(s => !assigned.has(s.id))
    if (!remaining.length) continue
    const oldVehicleId = members.map(s => (assigned.get(s.id) || {}).vehicleId).find(id => id !== undefined)
    const available = oldVehicleId === undefined ? vehicles : vehicles.filter(v => v.id === oldVehicleId)
    const matching = available.filter(v => members.every(s => isVehicleTraveller(s) && v.pickupPointIds.indexOf(s.trip.pickupPointId) !== -1))
    const vehicle = matching.find(v => passengerCapacity(v) - assignments.filter(a => a.vehicleId === v.id).length >= remaining.length)
    if (!vehicle) {
      const reason = !available.length ? 'no_vehicle'
        : !matching.length ? 'pickup_mismatch'
          : members.length > 1 && matching.every(v => passengerCapacity(v) < members.length) ? 'group_too_large' : 'no_seat'
      for (const s of remaining) unassigned.push({ signupId: s.id, reason })
      continue
    }
    const occupied = new Set(assignments.filter(a => a.vehicleId === vehicle.id).map(a => a.seatLabel))
    const seats = vehicle.seatLabels ? vehicle.seatLabels.filter(label => !occupied.has(label)).sort(compare) : null
    remaining.forEach((signup, index) => {
      const assignment = { activityId, signupId: signup.id, vehicleId: vehicle.id, seatLabel: seats ? (seats[index] || null) : null }
      assignments.push(assignment)
      assigned.set(signup.id, assignment)
    })
  }
  return { ok: true, value: { activityId, baseRevision: state.revision, assignments, unassigned } }
}

module.exports = { passengerCapacity, planAssignments, naturalCompare }
