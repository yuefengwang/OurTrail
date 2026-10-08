// 极简严格校验器：替代原型的 zod schema（strictObject 语义）。
// 约定：validate(spec, value) 返回 true/false；不做类型强转、不接受多余键。
'use strict'

const TEXT_MAX = 2000
const ID_MAX = 120

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function specStr(max) {
  return { t: 'str', max: max === undefined ? TEXT_MAX : max }
}
function specNum(min, max, int) {
  return { t: 'num', min, max, int: !!int }
}
function specEnum(values) {
  return { t: 'enum', values }
}
function specArr(item, minLen, maxLen) {
  return { t: 'arr', item, min: minLen || 0, max: maxLen === undefined ? Infinity : maxLen }
}
function specObj(keys) {
  return { t: 'obj', keys }
}
function specOpt(spec) {
  return { t: 'opt', spec }
}
function specUnion(key, map) {
  return { t: 'union', key, map }
}
function specRec(item) {
  return { t: 'rec', item }
}
function specLit(value) {
  return { t: 'lit', value }
}
function specNull(item) {
  return { t: 'null', item }
}
const specBool = { t: 'bool' }
const specId = specStr(ID_MAX)
const specText = specStr(TEXT_MAX)
const specCount = specNum(0, Number.MAX_SAFE_INTEGER, true)
const specInstant = { t: 'instant' }

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function matches(spec, value) {
  switch (spec.t) {
    case 'str':
      return typeof value === 'string' && value.length <= spec.max
    case 'num': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false
      if (spec.int && !Number.isInteger(value)) return false
      if (value < spec.min || value > spec.max) return false
      return true
    }
    case 'bool':
      return typeof value === 'boolean'
    case 'enum':
      return typeof value === 'string' && spec.values.indexOf(value) !== -1
    case 'instant':
      return typeof value === 'string' && INSTANT_RE.test(value) && Number.isFinite(Date.parse(value))
    case 'arr':
      if (!Array.isArray(value) || value.length < spec.min || value.length > spec.max) return false
      return value.every(item => matches(spec.item, item))
    case 'obj': {
      if (!isPlainObject(value)) return false
      for (const key of Object.keys(spec.keys)) {
        const field = spec.keys[key]
        if (field.t === 'opt') {
          if (value[key] === undefined) continue
          if (!matches(field.spec, value[key])) return false
        } else if (!(key in value) || !matches(field, value[key])) {
          return false
        }
      }
      // strict：不允许 schema 之外的键（undefined 视为未提供）
      for (const key of Object.keys(value)) {
        if (!(key in spec.keys)) return false
        if (value[key] === undefined && spec.keys[key].t !== 'opt') return false
      }
      return true
    }
    case 'union': {
      if (!isPlainObject(value)) return false
      const branch = spec.map[value[spec.key]]
      return branch !== undefined && matches(branch, value)
    }
    case 'rec': {
      if (!isPlainObject(value)) return false
      return Object.keys(value).every(key => matches(spec.item, value[key]))
    }
    case 'lit':
      return value === spec.value
    case 'null':
      return value === null || matches(spec.item, value)
    case 'opt':
      return true
    default:
      return false
  }
}

function validate(spec, value) {
  return matches(spec, value)
}

/* ---------- 基础构件 ---------- */

const Coordinates = specObj({ lat: specNum(-90, 90), lng: specNum(-180, 180) })
const Contact = specObj({ name: specText, phone: specText })
// avatar：微信头像（云存储 fileID 或临时 URL），可选
const Person = specObj({
  name: specText, phone: specText,
  emergency: Contact, medical: specText,
  avatar: specOpt(specStr(500)),
})
const PersonRef = specUnion('kind', {
  user: specObj({ kind: specEnum(['user']), userId: specId }),
  companion: specObj({ kind: specEnum(['companion']), ownerId: specId, companionId: specId }),
})
const Companion = specObj({ id: specId, person: Person })
const Profile = specObj({ id: specId, person: Person, companions: specArr(Companion) })

const RoutePoint = specObj({
  id: specId, name: specText,
  kind: specEnum(['start', 'checkpoint', 'finish']),
  coordinates: specNull(Coordinates),
  // GPX 轨迹附带的元数据（可选，用户不可编辑）：
  // time = 轨迹记录的时刻（ISO instant），用于按节点推算"第几天抵达"并定位对应日期的天气；
  // ele  = 该点真实高程（m），用于云层带/云海/光染判断，替代模型降尺度海拔（误差 ±300-600m）。
  time: specOpt(specInstant),
  ele: specOpt(specNum(-500, 9000)),
})
const RouteRisk = specObj({ id: specId, title: specText, advice: specText })
// 轨迹折线采样点（GCJ-02）：画地图 polyline 用，导入 GPX 时按里程采样到 ≤200 点
const TrackPoint = specObj({ lat: specNum(-90, 90), lng: specNum(-180, 180) })
const RouteSnapshot = specObj({
  title: specText, distanceKm: specNum(0, Number.MAX_SAFE_INTEGER), ascentM: specCount,
  points: specArr(RoutePoint), risks: specArr(RouteRisk),
  track: specOpt(specArr(TrackPoint, 2, 200)),
})
const Route = specObj({
  id: specId, ownerId: specId, title: specText, distanceKm: specNum(0, Number.MAX_SAFE_INTEGER),
  ascentM: specCount, points: specArr(RoutePoint), risks: specArr(RouteRisk),
  track: specOpt(specArr(TrackPoint, 2, 200)),
})
const PickupPoint = specObj({
  id: specId, name: specText, meetingAt: specNull(specInstant),
  address: specText, coordinates: specNull(Coordinates),
})
const Phase = specEnum(['draft', 'published', 'gathering', 'active', 'closing', 'archived', 'cancelled'])
const ApprovalMode = specEnum(['manual', 'automatic'])
const Activity = specObj({
  id: specId, ownerId: specId, title: specText, description: specText, organizerIntro: specText,
  startAt: specNull(specInstant), endAt: specNull(specInstant), deadlineAt: specNull(specInstant),
  phase: Phase, acceptingSignups: specBool, capacity: specNum(1, 500, true),
  approvalMode: ApprovalMode, routeId: specNull(specId), routeSnapshot: RouteSnapshot,
  pickupPoints: specArr(PickupPoint), equipment: specArr(specText),
  feeNote: specText, cancellationNote: specText,
  publishedAt: specOpt(specInstant),
})

const Trip = specUnion('mode', {
  self: specObj({ mode: specEnum(['self']) }),
  shared: specObj({ mode: specEnum(['shared']), pickupPointId: specId }),
})
const Consent = specObj({
  at: specInstant, recordedBy: specId,
  dataUse: specLit(true), proxyAuthority: specBool, proxyHome: specBool,
})
const SignupGroup = specObj({
  id: specId, activityId: specId, submittedByUserId: specId, keepTogether: specBool,
})
const SignupStatus = specEnum(['pending', 'confirmed', 'waitlisted', 'rejected', 'cancelled', 'removed'])
const Signup = specObj({
  id: specId, activityId: specId, groupId: specId, submittedByUserId: specId,
  personRef: PersonRef, participant: Person, trip: Trip, status: SignupStatus,
  consent: Consent,
})

const Driver = specUnion('kind', {
  participant: specObj({ kind: specEnum(['participant']), signupId: specId }),
  service: specObj({ kind: specEnum(['service']), name: specText, phone: specText, userId: specNull(specId) }),
})
const Evidence = specObj({ at: specInstant, by: specId, note: specText })
const Leg = specEnum(['outbound', 'return'])
const VehicleLeg = specObj({ departed: specNull(Evidence), completed: specNull(Evidence) })
const Vehicle = specObj({
  id: specId, activityId: specId, label: specText, plate: specText,
  legalCapacity: specNum(1, 60, true), drivers: specArr(Driver, 1),
  blockedSeats: specCount, seatLabels: specNull(specArr(specStr(12))),
  pickupPointIds: specArr(specId),
  legs: specObj({ outbound: VehicleLeg, return: VehicleLeg }),
})
const Assignment = specObj({
  activityId: specId, signupId: specId, vehicleId: specId, seatLabel: specNull(specStr(12)),
})
const StaffScope = specUnion('kind', {
  all: specObj({ kind: specEnum(['all']) }),
  selected: specObj({ kind: specEnum(['selected']), signupIds: specArr(specId) }),
})
const Capability = specEnum(['roster', 'checkin', 'node', 'incident', 'position', 'home', 'sensitive'])
const Membership = specUnion('role', {
  staff: specObj({
    role: specEnum(['staff']), id: specId, activityId: specId, userId: specId,
    expiresAt: specInstant, scope: StaffScope, capabilities: specArr(Capability),
  }),
  vehicle_contact: specObj({
    role: specEnum(['vehicle_contact']), id: specId, activityId: specId, userId: specId,
    expiresAt: specInstant, vehicleId: specId,
  }),
})

const Departure = specUnion('kind', {
  joined: specObj({ kind: specEnum(['joined']), evidence: Evidence }),
  not_departed: specObj({ kind: specEnum(['not_departed']), evidence: Evidence }),
  coordinating: specObj({ kind: specEnum(['coordinating']), evidence: Evidence }),
})
const CheckIn = specUnion('method', {
  manual: specObj({ method: specEnum(['manual']), evidence: Evidence }),
  simulation: specObj({ method: specEnum(['simulation']), evidence: Evidence, coordinates: Coordinates }),
})
const ReturnPlan = specUnion('kind', {
  assigned: specObj({ kind: specEnum(['assigned']) }),
  independent: specObj({ kind: specEnum(['independent']), evidence: Evidence }),
  // own = 自行往返：由 trip.mode === 'self' 派生，不是领队核实出来的事实，因此不带 evidence。
  // 只由域内写入（signup.js），attendance.returnPlan 命令不接受它——领队无法替别人决定自行返程之外的事。
  // 老数据里的 self + 'assigned' 仍然合法（不迁移），但 permissions.js 的返程门对它取「不适用」，
  // 所以它不再产生任何义务；新写入一律不再产生这种不可满足的事实。
  own: specObj({ kind: specEnum(['own']) }),
})
const NodeVisit = specObj({ pointId: specId, evidence: Evidence })
const Attendance = specObj({
  signupId: specId, checkIn: specNull(CheckIn),
  boardingByLeg: specObj({ outbound: specNull(Evidence), return: specNull(Evidence) }),
  returnPlan: ReturnPlan, departure: specNull(Departure),
  nodes: specArr(NodeVisit), home: specNull(Evidence),
})
const PositionReport = specObj({
  signupId: specId, coordinates: Coordinates, reportedAt: specInstant,
  consentExpiresAt: specInstant, revokedAt: specNull(specInstant),
})
const IncidentKind = specEnum(['late', 'withdrawal', 'injury', 'other'])
const Incident = specObj({
  id: specId, activityId: specId, subjectIds: specArr(specId, 1), kind: IncidentKind,
  description: specText, opened: Evidence, resolution: specNull(Evidence),
})
const ActivityEvent = specObj({
  id: specId, activityId: specId, kind: specText, actorId: specId,
  subjectIds: specArr(specId), occurredAt: specInstant, summary: specText,
})

const Audience = specUnion('kind', {
  activity: specObj({ kind: specEnum(['activity']) }),
  signups: specObj({ kind: specEnum(['signups']), signupIds: specArr(specId, 1) }),
  vehicle: specObj({ kind: specEnum(['vehicle']), vehicleId: specId }),
})
const DeliveryChannel = specEnum(['copy', 'subscription_simulation'])
const DeliveryStatus = specEnum(['copied', 'simulated_success', 'failed', 'not_authorized'])
const Delivery = specObj({
  id: specId, channel: DeliveryChannel, status: DeliveryStatus,
  at: specInstant, by: specId, detail: specText,
})
const Notice = specObj({
  id: specId, activityId: specId, audience: Audience, sourceEventId: specNull(specId),
  content: specText, publishedAt: specInstant, readBy: specRec(specInstant), deliveries: specArr(Delivery),
})
const Receipt = specObj({
  actorId: specId, requestId: specId, fingerprint: specStr(128),
  targetIds: specArr(specId), appliedAt: specInstant,
})

const State = specObj({
  schemaVersion: specLit(1),
  revision: specCount, savedAt: specInstant,
  profiles: specArr(Profile), routes: specArr(Route), activities: specArr(Activity),
  groups: specArr(SignupGroup), signups: specArr(Signup), vehicles: specArr(Vehicle),
  assignments: specArr(Assignment), memberships: specArr(Membership),
  attendance: specArr(Attendance), positions: specArr(PositionReport),
  incidents: specArr(Incident), events: specArr(ActivityEvent),
  notices: specArr(Notice), receipts: specArr(Receipt),
})
const stateSpec = State

/* ---------- 输入契约 ---------- */

const ActivityInput = specObj((function () {
  const keys = Object.assign({}, Activity.keys)
  delete keys.id
  delete keys.ownerId
  delete keys.phase
  delete keys.publishedAt
  return keys
})())
const VehicleInput = specObj((function () {
  const keys = Object.assign({}, Vehicle.keys)
  delete keys.id
  delete keys.activityId
  delete keys.legs
  return keys
})())
const ParticipantInput = specObj({
  personRef: PersonRef, participant: Person, trip: Trip,
  consent: specObj({ dataUse: specBool, proxyAuthority: specBool, proxyHome: specBool }),
})
const AssignmentTarget = specObj({ signupId: specId, vehicleId: specId, seatLabel: specNull(specStr(12)) })
const UnassignedReason = specEnum(['no_vehicle', 'pickup_mismatch', 'group_too_large', 'no_seat'])
const AssignmentPreview = specObj({
  activityId: specId, baseRevision: specCount,
  assignments: specArr(Assignment),
  unassigned: specArr(specObj({ signupId: specId, reason: UnassignedReason })),
})

/* ---------- 命令 ---------- */

const Payload = specUnion('type', {
  'activity.create': specObj({ type: specEnum(['activity.create']), input: ActivityInput }),
  'activity.edit': specObj({ type: specEnum(['activity.edit']), activityId: specId, input: ActivityInput }),
  'activity.copy': specObj({ type: specEnum(['activity.copy']), sourceActivityId: specId }),
  'activity.publish': specObj({ type: specEnum(['activity.publish']), activityId: specId, participation: specNull(ParticipantInput) }),
  'activity.transition': specObj({ type: specEnum(['activity.transition']), activityId: specId, next: Phase, reason: specText }),
  'activity.delete': specObj({ type: specEnum(['activity.delete']), activityId: specId }),
  'signup.submit': specObj({
    type: specEnum(['signup.submit']), activityId: specId,
    participants: specArr(ParticipantInput), keepTogether: specBool,
    mode: specEnum(['apply', 'waitlist']),
  }),
  'signup.review': specObj({ type: specEnum(['signup.review']), activityId: specId, signupIds: specArr(specId, 1), decision: specEnum(['confirm', 'reject']) }),
  'signup.promote': specObj({ type: specEnum(['signup.promote']), activityId: specId, signupIds: specArr(specId, 1) }),
  'signup.cancel': specObj({ type: specEnum(['signup.cancel']), activityId: specId, signupIds: specArr(specId, 1), reason: specText }),
  'signup.edit': specObj({ type: specEnum(['signup.edit']), activityId: specId, signupId: specId, participant: Person, trip: Trip, purpose: specText }),
  'group.setTogether': specObj({ type: specEnum(['group.setTogether']), activityId: specId, groupId: specId, keepTogether: specBool }),
  'vehicle.save': specObj({ type: specEnum(['vehicle.save']), activityId: specId, vehicleId: specNull(specId), input: VehicleInput }),
  'vehicle.remove': specObj({ type: specEnum(['vehicle.remove']), activityId: specId, vehicleId: specId }),
  'assignment.commit': specObj({ type: specEnum(['assignment.commit']), activityId: specId, preview: AssignmentPreview }),
  'assignment.set': specObj({ type: specEnum(['assignment.set']), activityId: specId, target: AssignmentTarget }),
  'assignment.remove': specObj({ type: specEnum(['assignment.remove']), activityId: specId, signupId: specId }),
  'assignment.swap': specObj({ type: specEnum(['assignment.swap']), activityId: specId, firstSignupId: specId, secondSignupId: specId }),
  'membership.save': specObj({ type: specEnum(['membership.save']), activityId: specId, membership: Membership }),
  'membership.revoke': specObj({ type: specEnum(['membership.revoke']), activityId: specId, membershipId: specId }),
  'attendance.checkin': specObj({ type: specEnum(['attendance.checkin']), activityId: specId, signupId: specId, checkIn: CheckIn }),
  'attendance.board': specObj({ type: specEnum(['attendance.board']), activityId: specId, signupId: specId, leg: Leg, boarded: specBool, note: specText }),
  'attendance.departure': specObj({ type: specEnum(['attendance.departure']), activityId: specId, signupId: specId, outcome: Departure }),
  'attendance.returnPlan': specObj({ type: specEnum(['attendance.returnPlan']), activityId: specId, signupId: specId, plan: specEnum(['assigned', 'independent']), note: specText }),
  'attendance.node': specObj({ type: specEnum(['attendance.node']), activityId: specId, signupId: specId, pointId: specId, note: specText }),
  'attendance.home': specObj({ type: specEnum(['attendance.home']), activityId: specId, signupId: specId, note: specText }),
  'vehicle.depart': specObj({ type: specEnum(['vehicle.depart']), activityId: specId, vehicleId: specId, leg: Leg, note: specText }),
  'vehicle.complete': specObj({ type: specEnum(['vehicle.complete']), activityId: specId, vehicleId: specId, leg: Leg, note: specText }),
  'position.report': specObj({ type: specEnum(['position.report']), activityId: specId, signupId: specId, coordinates: Coordinates, consent: specBool }),
  'position.revoke': specObj({ type: specEnum(['position.revoke']), activityId: specId, signupId: specId }),
  'incident.report': specObj({ type: specEnum(['incident.report']), activityId: specId, signupIds: specArr(specId, 1), kind: IncidentKind, description: specText }),
  'incident.resolve': specObj({ type: specEnum(['incident.resolve']), activityId: specId, incidentId: specId, note: specText }),
  'notice.publish': specObj({ type: specEnum(['notice.publish']), activityId: specId, audience: Audience, content: specText }),
  'notice.read': specObj({ type: specEnum(['notice.read']), activityId: specId, noticeId: specId }),
  'notice.delivery': specObj({ type: specEnum(['notice.delivery']), activityId: specId, noticeId: specId, channel: DeliveryChannel, status: DeliveryStatus, detail: specText }),
  'export.record': specObj({ type: specEnum(['export.record']), activityId: specId, signupIds: specArr(specId, 1), mode: specEnum(['ordinary', 'sensitive']), purpose: specText }),
  'profile.save': specObj({ type: specEnum(['profile.save']), person: Person }),
  'companion.save': specObj({ type: specEnum(['companion.save']), companionId: specNull(specId), person: Person }),
  'companion.remove': specObj({ type: specEnum(['companion.remove']), companionId: specId }),
})
const Command = specObj({
  actor: specObj({ userId: specNull(specId) }),
  requestId: specId, expectedRevision: specCount, fingerprint: specStr(128), payload: Payload,
})

module.exports = {
  validate, specObj, specArr, specEnum, specUnion, specNull, specRec, specOpt, specLit,
  specStr, specNum, specId, specText, specCount, specInstant, specBool,
  Coordinates, Contact, Person, PersonRef, Companion, Profile,
  RoutePoint, RouteRisk, RouteSnapshot, Route, PickupPoint, Activity,
  Trip, Consent, SignupGroup, Signup, Driver, Evidence, Vehicle,
  Assignment, Membership, Departure, CheckIn, ReturnPlan, NodeVisit, Attendance,
  PositionReport, Incident, ActivityEvent, Audience, Notice, Receipt,
  stateSpec, ActivityInput, VehicleInput, ParticipantInput, AssignmentPreview,
  Payload, Command,
}
