// 由原型 domain/permissions.ts 逐段移植：只做授权判断，不做阶段与业务校验。
'use strict'

const permissionDenied = (message) => ({ ok: false, error: { code: 'FORBIDDEN', message: message || '没有访问此资源的权限。' } })
const missing = () => ({ ok: false, error: { code: 'NOT_FOUND', message: '找不到请求的资源。' } })
const consentRequired = () => ({ ok: false, error: { code: 'CONSENT_REQUIRED', message: '需要本人同意及有效代办授权。' } })
const allowed = () => ({ ok: true, value: null })
const authRequired = () => ({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请先选择当前账号。' } })

/** 拥有关系包含提交关系，而不是活动级角色。 */
function isOwnSignup(signup, actor) {
  return actor.userId !== null && (isSelfSignup(signup, actor) || signup.submittedByUserId === actor.userId)
}
function isSelfSignup(signup, actor) {
  return actor.userId !== null && signup.personRef.kind === 'user' && signup.personRef.userId === actor.userId
}
function isOwner(state, actor, activityId) {
  return actor.userId !== null && state.activities.some(a => a.id === activityId && a.ownerId === actor.userId)
}
function hasProxyConsent(signup, actor) {
  return actor.userId !== null && signup.submittedByUserId === actor.userId && signup.consent.dataUse && signup.consent.proxyAuthority
}
function isCurrentSignup(signup) {
  return signup.status === 'confirmed' || signup.status === 'pending' || signup.status === 'waitlisted'
}
function workDataAvailable(state, activityId) {
  const activity = state.activities.find(a => a.id === activityId)
  return !!activity && activity.phase !== 'archived' && activity.phase !== 'cancelled'
}

/** 每个目标都必须属于本活动，且请求者在范围内具备该能力。 */
function staffCan(state, actor, activityId, capability, signupIds, now) {
  if (actor.userId === null || !state.activities.some(a => a.id === activityId)) return false
  const memberships = state.memberships.filter(m =>
    m.role === 'staff' && m.activityId === activityId && m.userId === actor.userId && Date.parse(now) < Date.parse(m.expiresAt))
  const capable = memberships.filter(m => m.role === 'staff' && m.capabilities.indexOf(capability) !== -1)
  return capable.length > 0 && signupIds.every(id =>
    state.signups.some(s => s.id === id && s.activityId === activityId)
    && capable.some(m => m.role === 'staff' && (m.scope.kind === 'all' || m.scope.signupIds.indexOf(id) !== -1)))
}

/** 车辆联络授权从不授予名单、现场或敏感能力。 */
function vehicleCan(state, actor, activityId, vehicleId, now) {
  return actor.userId !== null && state.activities.some(a => a.id === activityId)
    && state.vehicles.some(v => v.id === vehicleId && v.activityId === activityId)
    && state.memberships.some(m => m.role === 'vehicle_contact' && m.userId === actor.userId
      && m.activityId === activityId && m.vehicleId === vehicleId && Date.parse(now) < Date.parse(m.expiresAt))
}

function requireActivity(state, activityId) {
  return state.activities.some(a => a.id === activityId) ? allowed() : missing()
}
function requireSignups(state, activityId, ids) {
  const signups = []
  for (const id of ids) {
    const signup = state.signups.find(s => s.id === id)
    if (!signup) return missing()
    if (signup.activityId !== activityId) return permissionDenied('报名记录不属于此活动。')
    signups.push(signup)
  }
  return { ok: true, value: signups }
}
function requireVehicles(state, activityId, ids) {
  for (const id of ids) {
    const vehicle = state.vehicles.find(v => v.id === id)
    if (!vehicle) return missing()
    if (vehicle.activityId !== activityId) return permissionDenied('车辆不属于此活动。')
  }
  return allowed()
}
function canReadSensitive(state, actor, activityId, signupId, purpose, now) {
  if (actor.userId === null) return authRequired()
  const activity = requireActivity(state, activityId)
  if (!activity.ok) return activity
  const targets = requireSignups(state, activityId, [signupId])
  if (!targets.ok) return targets
  const signup = targets.value[0]
  if (isSelfSignup(signup, actor) || hasProxyConsent(signup, actor)) return allowed()
  if (purpose.trim() && workDataAvailable(state, activityId)
    && (isOwner(state, actor, activityId) || staffCan(state, actor, activityId, 'sensitive', [signupId], now))) return allowed()
  return isOwnSignup(signup, actor) ? consentRequired() : permissionDenied('敏感资料仅供本人、授权代办或注明用途的当次工作使用。')
}

function canReadNotice(state, actor, notice, now) {
  if (actor.userId === null) return false
  const actual = state.notices.find(n => n.id === notice.id && n.activityId === notice.activityId)
  if (!actual || !state.activities.some(a => a.id === actual.activityId)) return false
  const activityId = actual.activityId
  const audience = actual.audience
  const own = s => s.activityId === activityId && isOwnSignup(s, actor)
  if (audience.kind === 'signups') {
    const targets = requireSignups(state, activityId, audience.signupIds)
    return targets.ok && (isOwner(state, actor, activityId) || targets.value.some(own))
  }
  if (audience.kind === 'vehicle') {
    if (!requireVehicles(state, activityId, [audience.vehicleId]).ok) return false
    return isOwner(state, actor, activityId) || vehicleCan(state, actor, activityId, audience.vehicleId, now)
      || state.signups.some(s => own(s) && s.status === 'confirmed'
        && state.assignments.some(a => a.activityId === activityId && a.vehicleId === audience.vehicleId && a.signupId === s.id))
  }
  return isOwner(state, actor, activityId) || state.signups.some(s => own(s) && isCurrentSignup(s))
    || state.memberships.some(m => m.activityId === activityId && m.userId === actor.userId
      && Date.parse(now) < Date.parse(m.expiresAt)
      && (m.role === 'staff' || vehicleCan(state, actor, activityId, m.vehicleId, now)))
}

/** 仅授权判断；业务阶段与变更校验属于各处理器。 */
function canExecute(state, actor, payload, now) {
  if (actor.userId === null) return authRequired()
  const profile = state.profiles.find(p => p.id === actor.userId)
  const submitSourceAllowed = ref =>
    ref.kind === 'user' ? ref.userId === actor.userId
      : ref.ownerId === actor.userId && !!profile && profile.companions.some(c => c.id === ref.companionId)
  if (payload.type === 'profile.save' || payload.type === 'activity.create') return allowed()
  if (payload.type === 'companion.save' || payload.type === 'companion.remove') {
    return payload.companionId === null || (profile && profile.companions.some(c => c.id === payload.companionId))
      ? allowed() : permissionDenied('只能管理当前账号已有的同行人。')
  }
  const activityId = payload.type === 'activity.copy' ? payload.sourceActivityId : payload.activityId
  const activity = requireActivity(state, activityId)
  if (!activity.ok) return activity
  const owner = isOwner(state, actor, activityId)
  const signupIds = []
  const vehicleIds = []
  if ('signupId' in payload) signupIds.push(payload.signupId)
  if ('signupIds' in payload) signupIds.push.apply(signupIds, payload.signupIds)
  if ('vehicleId' in payload && payload.vehicleId !== null) vehicleIds.push(payload.vehicleId)

  switch (payload.type) {
    case 'assignment.swap':
      signupIds.push(payload.firstSignupId, payload.secondSignupId)
      break
    case 'assignment.set':
      signupIds.push(payload.target.signupId)
      vehicleIds.push(payload.target.vehicleId)
      break
    case 'assignment.commit':
      if (payload.preview.activityId !== activityId || payload.preview.assignments.some(a => a.activityId !== activityId)) return permissionDenied()
      signupIds.push.apply(signupIds, payload.preview.assignments.map(a => a.signupId).concat(payload.preview.unassigned.map(a => a.signupId)))
      vehicleIds.push.apply(vehicleIds, payload.preview.assignments.map(a => a.vehicleId))
      break
    case 'vehicle.save':
      signupIds.push.apply(signupIds, payload.input.drivers.flatMap(d => d.kind === 'participant' ? [d.signupId] : []))
      break
    case 'membership.save': {
      const existing = state.memberships.find(m => m.id === payload.membership.id)
      if (payload.membership.activityId !== activityId || (existing && existing.activityId !== activityId)) return permissionDenied()
      if (payload.membership.role === 'vehicle_contact') vehicleIds.push(payload.membership.vehicleId)
      else if (payload.membership.scope.kind === 'selected') signupIds.push.apply(signupIds, payload.membership.scope.signupIds)
      break
    }
    case 'membership.revoke': {
      const membership = state.memberships.find(m => m.id === payload.membershipId)
      if (!membership) return missing()
      if (membership.activityId !== activityId) return permissionDenied()
      break
    }
    case 'group.setTogether': {
      const group = state.groups.find(g => g.id === payload.groupId)
      if (!group) return missing()
      if (group.activityId !== activityId) return permissionDenied()
      signupIds.push.apply(signupIds, state.signups.filter(s => s.groupId === group.id).map(s => s.id))
      break
    }
    case 'incident.resolve': {
      const incident = state.incidents.find(i => i.id === payload.incidentId)
      if (!incident) return missing()
      if (incident.activityId !== activityId) return permissionDenied()
      signupIds.push.apply(signupIds, incident.subjectIds)
      break
    }
    case 'notice.read':
    case 'notice.delivery': {
      const notice = state.notices.find(n => n.id === payload.noticeId)
      if (!notice) return missing()
      if (notice.activityId !== activityId) return permissionDenied()
      if (notice.audience.kind === 'signups') signupIds.push.apply(signupIds, notice.audience.signupIds)
      if (notice.audience.kind === 'vehicle') vehicleIds.push(notice.audience.vehicleId)
      break
    }
    case 'notice.publish':
      if (payload.audience.kind === 'signups') signupIds.push.apply(signupIds, payload.audience.signupIds)
      if (payload.audience.kind === 'vehicle') vehicleIds.push(payload.audience.vehicleId)
      break
  }
  const targets = requireSignups(state, activityId, signupIds)
  if (!targets.ok) return targets
  const vehicles = requireVehicles(state, activityId, vehicleIds)
  if (!vehicles.ok) return vehicles
  const own = targets.value.every(s => isOwnSignup(s, actor))
  const cap = capability => staffCan(state, actor, activityId, capability, signupIds, now)
  const allowIf = condition => condition ? allowed() : permissionDenied()

  switch (payload.type) {
    case 'signup.submit': return allowIf(payload.participants.every(p => submitSourceAllowed(p.personRef)))
    case 'activity.publish': return allowIf(owner && (!payload.participation || submitSourceAllowed(payload.participation.personRef)))
    case 'signup.cancel': return allowIf(owner || own)
    case 'signup.edit':
      if (!owner && !own) return permissionDenied()
      return canReadSensitive(state, actor, activityId, payload.signupId, payload.purpose, now)
    case 'group.setTogether':
      return allowIf(owner || state.groups.some(g => g.id === payload.groupId && g.submittedByUserId === actor.userId))
    case 'attendance.checkin': return allowIf(owner || own || cap('checkin'))
    case 'attendance.departure': return allowIf(owner || cap('checkin'))
    case 'attendance.returnPlan': return allowIf(owner || cap('incident'))
    case 'attendance.node': return allowIf(owner || own || cap('node'))
    case 'attendance.home': {
      if (owner || cap('home') || targets.value.every(s => isSelfSignup(s, actor))) return allowed()
      if (targets.value.every(s => hasProxyConsent(s, actor) && s.consent.proxyHome)) return allowed()
      return own ? consentRequired() : permissionDenied()
    }
    case 'attendance.board':
      return allowIf(owner || state.assignments.some(a => a.activityId === activityId && a.signupId === payload.signupId
        && vehicleCan(state, actor, activityId, a.vehicleId, now)))
    case 'vehicle.depart':
    case 'vehicle.complete': return allowIf(owner || vehicleCan(state, actor, activityId, payload.vehicleId, now))
    case 'position.report': return allowIf(targets.value.every(s => isSelfSignup(s, actor)))
    case 'position.revoke':
      if (targets.value.every(s => isSelfSignup(s, actor) || hasProxyConsent(s, actor))) return allowed()
      return own ? consentRequired() : permissionDenied()
    case 'incident.report':
      return allowIf(owner || targets.value.every(s => isOwnSignup(s, actor) || staffCan(state, actor, activityId, 'incident', [s.id], now)))
    case 'incident.resolve': return allowIf(owner || cap('incident'))
    case 'notice.read': {
      const notice = state.notices.find(n => n.id === payload.noticeId)
      return allowIf(canReadNotice(state, actor, notice, now))
    }
    case 'export.record': {
      if (!owner) return permissionDenied()
      if (payload.mode === 'sensitive') {
        if (!payload.purpose.trim() || !workDataAvailable(state, activityId)) return permissionDenied('敏感导出需要当次工作用途。')
        for (const s of targets.value) {
          const permission = canReadSensitive(state, actor, activityId, s.id, payload.purpose, now)
          if (!permission.ok) return permission
        }
      }
      return allowed()
    }
    case 'activity.delete': {
      if (!owner) return permissionDenied()
      const target = state.activities.find(a => a.id === activityId)
      return target && target.phase === 'draft'
        ? allowed()
        : permissionDenied('只有未发布的草稿可以删除；已发布活动请使用取消。')
    }
    case 'activity.edit':
    case 'activity.copy':
    case 'activity.transition':
    case 'signup.review':
    case 'signup.promote':
    case 'vehicle.save':
    case 'vehicle.remove':
    case 'assignment.commit':
    case 'assignment.set':
    case 'assignment.remove':
    case 'assignment.swap':
    case 'membership.save':
    case 'membership.revoke':
    case 'notice.publish':
    case 'notice.delivery': return allowIf(owner)
    default: return permissionDenied('不支持此操作。')
  }
}

module.exports = {
  permissionDenied, missing, consentRequired, allowed, authRequired,
  isOwnSignup, isSelfSignup, isOwner, hasProxyConsent, isCurrentSignup, workDataAvailable,
  staffCan, vehicleCan, requireActivity, requireSignups, requireVehicles,
  canReadSensitive, canReadNotice, canExecute,
}
