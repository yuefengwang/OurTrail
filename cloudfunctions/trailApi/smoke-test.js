// domain 层本地冒烟测试：不依赖 wx-server-sdk，直接跑 reduce + invariants。
// 运行：node smoke-test.js
'use strict'

const { reduceCommand, genId } = require('./domain/commands')
const { assertInvariants } = require('./domain/invariants')
const { selectView, selectTransport, getDetailState } = require('./domain/selectors')
const { planAssignments } = require('./domain/allocation')
const { canonicalPayload } = require('./domain/contracts')
const crypto = require('crypto')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')) }
}

const ctx = () => ({ now: '2026-09-26T07:00:00+08:00', id: genId })
const fp = payload => crypto.createHash('sha256').update(canonicalPayload(payload), 'utf8').digest('hex')

function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: '2026-09-26T07:00:00+08:00',
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
}

function dispatch(state, actor, payload, requestId) {
  return reduceCommand(state, {
    actor: { userId: actor }, requestId: requestId || genId('req'),
    expectedRevision: state.revision, fingerprint: fp(payload), payload,
  }, ctx())
}

const OWNER = 'o-owner-openid'
const LIN = 'o-lin-openid'

function fullActivityInput() {
  return {
    title: '青城后山', description: '轻徒步', organizerIntro: '陈屿带队',
    startAt: '2026-10-01T08:00:00+08:00', endAt: '2026-10-01T18:00:00+08:00', deadlineAt: '2026-09-30T20:00:00+08:00',
    acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
    routeSnapshot: {
      title: '飞泉沟', distanceKm: 12.8, ascentM: 680,
      points: [{ id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 } },
        { id: 'pt-2', name: '终点', kind: 'finish', coordinates: null }],
      risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }],
    },
    pickupPoints: [{ id: 'pk-1', name: '茶店子', meetingAt: '2026-10-01T07:00:00+08:00', address: '地铁口', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }
}

function run() {
  console.log('== 1. 空状态通过不变量 ==')
  check('empty invariants', assertInvariants(emptyState()).ok)

  console.log('== 2. profile.save 创建档案 ==')
  let state = emptyState()
  let r = dispatch(state, LIN, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } })
  check('profile.save ok', r.ok, r.error)
  state = r.value.state
  check('revision bumped', state.revision === 1)
  check('profile exists', state.profiles.length === 1 && state.profiles[0].person.name === '林溪')

  console.log('== 3. activity.create / publish（含发布即报名） ==')
  r = dispatch(state, LIN, { type: 'activity.create', input: fullActivityInput() })
  check('activity.create ok', r.ok, r.error)
  state = r.value.state
  const activityId = r.value.targetIds[0]
  check('activity draft', state.activities[0].phase === 'draft')
  check('private route persisted', state.routes.length === 1)
  const profile = state.profiles.find(p => p.id === LIN)
  r = dispatch(state, LIN, {
    type: 'activity.publish', activityId,
    participation: {
      personRef: { kind: 'user', userId: LIN }, participant: profile.person,
      trip: { mode: 'shared', pickupPointId: 'pk-1' },
      consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    },
  })
  check('activity.publish ok', r.ok, r.error)
  state = r.value.state
  check('published', state.activities[0].phase === 'published')
  check('owner signed up confirmed', state.signups.length === 1 && state.signups[0].status === 'confirmed')

  console.log('== 4. 他人报名（submit）+ 审核 ==')
  r = dispatch(state, OWNER, { type: 'profile.save', person: { name: '陈屿', phone: '00000000002', emergency: { name: '陈父', phone: '00000000052' }, medical: '' } })
  state = r.value.state
  const ownerProfile = state.profiles.find(p => p.id === OWNER)
  r = dispatch(state, OWNER, {
    type: 'signup.submit', activityId, keepTogether: true, mode: 'apply',
    participants: [{ personRef: { kind: 'user', userId: OWNER }, participant: ownerProfile.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }],
  })
  check('signup.submit ok', r.ok, r.error)
  state = r.value.state
  check('pending', state.signups[1].status === 'pending')
  check('notice auto-published', state.notices.length >= 1)
  r = dispatch(state, LIN, { type: 'signup.review', activityId, signupIds: [state.signups[1].id], decision: 'confirm' })
  check('signup.review ok', r.ok, r.error)
  state = r.value.state
  check('confirmed', state.signups[1].status === 'confirmed')

  console.log('== 5. 车辆 + 分车 + 参与者司机 ==')
  r = dispatch(state, LIN, {
    type: 'vehicle.save', activityId, vehicleId: null,
    input: { label: '1号车', plate: 'A12345', legalCapacity: 7, blockedSeats: 0, drivers: [{ kind: 'participant', signupId: state.signups[1].id }], seatLabels: ['01', '02', '03', '04', '05', '06'], pickupPointIds: ['pk-1'] },
  })
  check('vehicle.save ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'activity.transition', activityId, next: 'gathering', reason: '按期集合' })
  check('published→gathering ok', r.ok, r.error)
  state = r.value.state

  console.log('== 6. 现场履约链：分车→签到→上车→出发→active→节点→closing→home→archived ==')
  const linSignup = state.signups[0]
  const vehicleId = state.vehicles[0].id
  r = dispatch(state, LIN, { type: 'assignment.set', activityId, target: { signupId: linSignup.id, vehicleId, seatLabel: '01' } })
  check('assignment.set ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'attendance.checkin', activityId, signupId: linSignup.id, checkIn: { method: 'manual', evidence: { at: '2026-09-26T08:00:00+08:00', by: 'o-lin-openid', note: '集合点人工核实' } } })
  check('owner checkin ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'attendance.board', activityId, signupId: linSignup.id, leg: 'outbound', boarded: true, note: '清点上车' })
  check('owner board ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'attendance.departure', activityId, signupId: linSignup.id, outcome: { kind: 'joined', evidence: { at: '2026-09-26T08:30:00+08:00', by: 'o-lin-openid', note: '随队出发' } } })
  check('owner departure joined ok', r.ok, r.error)
  state = r.value.state
  const ownerSignup = state.signups[1]
  r = dispatch(state, OWNER, { type: 'attendance.checkin', activityId, signupId: ownerSignup.id, checkIn: { method: 'manual', evidence: { at: '2026-09-26T08:00:00+08:00', by: OWNER, note: '司机集合核实' } } })
  check('driver checkin ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'attendance.departure', activityId, signupId: ownerSignup.id, outcome: { kind: 'joined', evidence: { at: '2026-09-26T08:30:00+08:00', by: 'o-lin-openid', note: '组织者核实司机随队出发' } } })
  check('driver departure joined ok (by organizer)', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'activity.transition', activityId, next: 'active', reason: '' })
  check('gathering→active ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'attendance.node', activityId, signupId: linSignup.id, pointId: 'pt-1', note: '起点' })
  check('node ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'position.report', activityId, signupId: linSignup.id, coordinates: { lat: 30.94, lng: 103.47 }, consent: true })
  check('position.report ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'activity.transition', activityId, next: 'closing', reason: '全员下撤，进入安全核验' })
  check('active→closing ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'attendance.home', activityId, signupId: linSignup.id, note: '' })
  check('self home ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'attendance.home', activityId, signupId: ownerSignup.id, note: '电话核实司机已到家' })
  check('organizer confirm driver home ok', r.ok, r.error)
  state = r.value.state
  r = dispatch(state, LIN, { type: 'activity.transition', activityId, next: 'archived', reason: '安全收尾' })
  check('closing→archived ok', r.ok, r.error)
  state = r.value.state
  check('invariants hold at end', assertInvariants(state).ok)

  console.log('== 7. 幂等：同 requestId 重放 ==')
  const s2 = emptyState()
  let r1 = dispatch(s2, LIN, { type: 'profile.save', person: { name: '甲', phone: '00000000011', emergency: { name: '乙', phone: '00000000012' }, medical: '' } }, 'req-1')
  const replay = reduceCommand(r1.value.state, {
    actor: { userId: LIN }, requestId: 'req-1', expectedRevision: 0,
    fingerprint: fp({ type: 'profile.save', person: { name: '甲', phone: '00000000011', emergency: { name: '乙', phone: '00000000012' }, medical: '' } }),
    payload: { type: 'profile.save', person: { name: '甲', phone: '00000000011', emergency: { name: '乙', phone: '00000000012' }, medical: '' } },
  }, ctx())
  check('replayed true', replay.ok && replay.value.replayed === true)

  console.log('== 8. 读取投影 ==')
  const home = selectView(state, { userId: LIN }, { kind: 'home', perspective: 'participant', openedActivityIds: [] }, '2026-09-26T07:00:00+08:00')
  check('home shows finished activity', home.kind === 'home' && home.activities.length === 1 && home.activities[0].meta.owner === true)
  const actView = selectView(state, { userId: LIN }, { kind: 'activity', activityId, perspective: 'participant' }, '2026-09-26T07:00:00+08:00')
  check('activity view', actView.kind === 'activity')
  check('detailState finished', actView.kind === 'activity' && actView.detailState === 'finished')
  check('counters', actView.kind === 'activity' && actView.counters.confirmed === 2)
  const tr = selectTransport(state, { userId: LIN }, activityId)
  check('transport ok', tr.ok)
  check('getDetailState direct', getDetailState(actView, '2026-09-26T07:00:00+08:00') === 'finished')
  const preview = planAssignments(emptyState(), { userId: LIN }, 'nope', '2026-09-26T07:00:00+08:00')
  check('previewAssignments not found', !preview.ok)

  console.log('== 9. 越权：非组织者不能编辑活动 ==')
  r = dispatch(state, OWNER, { type: 'activity.edit', activityId, input: fullActivityInput() })
  check('forbidden for non-owner', !r.ok && r.error.code === 'FORBIDDEN')

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

run()
