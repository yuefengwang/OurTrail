// domain 层本地冒烟测试：不依赖 wx-server-sdk，直接跑 reduce + invariants。
// 运行：node smoke-test.js
'use strict'

const { reduceCommand, genId } = require('./domain/commands')
const { handleActivity } = require('./domain/activity')
const { assertInvariants } = require('./domain/invariants')
const { selectView, selectTransport, getDetailState, selectSensitive, selectContact } = require('./domain/selectors')
const { planAssignments } = require('./domain/allocation')
const { canonicalPayload, deepClone } = require('./domain/contracts')
const W = require('./lib/weather')
const crypto = require('crypto')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

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
  let r = dispatch(state, LIN, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '', avatar: 'cloud://env.abc/avatars/1.jpg' } })
  check('profile.save ok', r.ok, r.error)
  state = r.value.state
  check('revision bumped', state.revision === 1)
  check('profile exists', state.profiles.length === 1 && state.profiles[0].person.name === '林溪')
  check('avatar stored', state.profiles[0].person.avatar === 'cloud://env.abc/avatars/1.jpg')

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
  // 预览成功路径（2026-09-30 真机首爆点）：planAssignments 里的惰性 require 曾写错相对路径（../invariants），
  // 既有用例只在 NOT_FOUND/WRONG_PHASE 提前返回、从未走进那一行。此用例必须穿过 require 到达装配逻辑。
  const planPreview = planAssignments(state, { userId: LIN }, activityId, '2026-09-26T08:00:00+08:00')
  check('planAssignments success path runs（惰性 require 可解析）', planPreview.ok, planPreview.error)
  check('preview assigns尚未分车的 shared 参与者', planPreview.ok
    && planPreview.value.assignments.some(a => a.signupId === state.signups[0].id)
    && planPreview.value.unassigned.length === 0, JSON.stringify(planPreview.value))

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

  console.log('== 10. 路线轨迹 track（GCJ-02 折线） ==')
  const withTrack = fullActivityInput()
  withTrack.routeSnapshot.track = [{ lat: 30.9394, lng: 103.4901 }, { lat: 30.9458, lng: 103.4769 }, { lat: 30.9565, lng: 103.4769 }]
  let sTrack = emptyState()
  r = dispatch(sTrack, LIN, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } })
  sTrack = r.value.state
  r = dispatch(sTrack, LIN, { type: 'activity.create', input: withTrack })
  check('activity.create with track ok', r.ok, r.error)
  sTrack = r.value.state
  const act2 = sTrack.activities[0]
  check('activity 保留 track', act2.routeSnapshot.track.length === 3)
  check('私有路线携带 track', sTrack.routes[0].track && sTrack.routes[0].track.length === 3)
  const view2 = selectView(sTrack, { userId: LIN }, { kind: 'activity', activityId: act2.id, perspective: 'organizer' }, '2026-09-26T07:00:00+08:00')
  check('视图透传 track', view2.kind === 'activity' && view2.activity.routeSnapshot.track && view2.activity.routeSnapshot.track.length === 3)
  const noTrack = fullActivityInput()
  delete noTrack.routeSnapshot.track
  r = dispatch(sTrack, LIN, { type: 'activity.create', input: noTrack })
  check('无 track 仍可通过（specOpt 兼容缺省）', r.ok, r.error)
  const badTrack = fullActivityInput()
  badTrack.routeSnapshot.track = [{ lat: 30.9, lng: 103.4 }]
  r = dispatch(sTrack, LIN, { type: 'activity.create', input: badTrack })
  check('单点 track 被拒（min 2）', !r.ok, r.error)

  console.log('== 10b. 节点 GPX 元数据 time/ele（按节点推算抵达日 + 真实海拔） ==')
  const withMeta = fullActivityInput()
  withMeta.routeSnapshot.points[1].time = '2026-09-27T14:20:00+08:00'
  withMeta.routeSnapshot.points[1].ele = 1268
  let sMeta = emptyState()
  r = dispatch(sMeta, LIN, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } })
  sMeta = r.value.state
  r = dispatch(sMeta, LIN, { type: 'activity.create', input: withMeta })
  check('activity.create 带节点 time/ele ok', r.ok, r.error)
  sMeta = r.value.state
  const actMeta = sMeta.activities[0]
  check('活动保留节点 time', actMeta.routeSnapshot.points[1].time === '2026-09-27T14:20:00+08:00')
  check('活动保留节点 ele', actMeta.routeSnapshot.points[1].ele === 1268)
  check('私有路线携带节点 time/ele', sMeta.routes[0].points[1].ele === 1268 && !!sMeta.routes[0].points[1].time)
  const metaView = selectView(sMeta, { userId: LIN }, { kind: 'activity', activityId: actMeta.id, perspective: 'participant' }, '2026-09-26T07:00:00+08:00')
  check('视图透传节点 time/ele', metaView.kind === 'activity'
    && metaView.activity.routeSnapshot.points[1].time === '2026-09-27T14:20:00+08:00'
    && metaView.activity.routeSnapshot.points[1].ele === 1268)
  check('无元数据的节点不带该键（客户端据此判断能否推算抵达日）',
    !('time' in metaView.activity.routeSnapshot.points[0]) && !('ele' in metaView.activity.routeSnapshot.points[0]))
  const noMeta = fullActivityInput()
  r = dispatch(sMeta, LIN, { type: 'activity.create', input: noMeta })
  check('无 time/ele 仍可通过（specOpt 兼容缺省）', r.ok, r.error)
  const badEle = fullActivityInput()
  badEle.routeSnapshot.points[0].ele = 12000
  r = dispatch(sMeta, LIN, { type: 'activity.create', input: badEle })
  check('越界 ele 被拒（-500..9000）', !r.ok, r.error)
  const badTime = fullActivityInput()
  badTime.routeSnapshot.points[0].time = '2026-09-27 14:20'
  r = dispatch(sMeta, LIN, { type: 'activity.create', input: badTime })
  check('非 ISO instant 的 time 被拒', !r.ok, r.error)

  console.log('== 11. 所有者以 participant 视角看草稿仍有编辑/发布动作（详情页发布入口依赖） ==')
  const draftView = selectView(sTrack, { userId: LIN }, { kind: 'activity', activityId: act2.id, perspective: 'participant' }, '2026-09-26T07:00:00+08:00')
  check('草稿 owner-participant 可见 activity.edit', draftView.kind === 'activity' && draftView.permittedActions.indexOf('activity.edit') !== -1)
  check('草稿 owner-participant 可见 activity.publish', draftView.kind === 'activity' && draftView.permittedActions.indexOf('activity.publish') !== -1)
  const outsiderView = selectView(sTrack, { userId: OWNER }, { kind: 'activity', activityId: act2.id, perspective: 'participant' }, '2026-09-26T07:00:00+08:00')
  check('非所有者看草稿被拒', outsiderView.kind === 'denied')

  console.log('== 12. 天气：GCJ 纠偏与云层带重建（lib/weather） ==')
  const { gcjToWgs: g2w, cloudBandAt } = require('./lib/weather')
  const wgsBack = g2w(30.9394, 103.4901)
  check('云函数侧 GCJ 纠偏偏移量级合理（约百米）',
    Math.abs(wgsBack.lat - 30.9394) > 0.0005 && Math.abs(wgsBack.lat - 30.9394) < 0.01, wgsBack)
  const hSynth = {
    cloud_cover_925hPa: [30], geopotential_height_925hPa: [1000],
    cloud_cover_850hPa: [95], geopotential_height_850hPa: [1500],
    cloud_cover_800hPa: [90], geopotential_height_800hPa: [2000],
    cloud_cover_700hPa: [10], geopotential_height_700hPa: [3100],
  }
  const band = cloudBandAt(hSynth, 0)
  check('云层带：底/顶/覆盖取成层云层（≥80%）', band && band.base === 1500 && band.top === 2000 && band.cover === 95, band)
  const hThin = {
    cloud_cover_925hPa: [60], geopotential_height_925hPa: [1000],
    cloud_cover_850hPa: [70], geopotential_height_850hPa: [1500],
  }
  check('薄云（<80%）不入带', cloudBandAt(hThin, 0) === null)
  const hClear = { cloud_cover_925hPa: [10], geopotential_height_925hPa: [1000] }
  check('晴空无带', cloudBandAt(hClear, 0) === null)

  console.log('== 12b. 天气：cloudLevels 多高度云量剖面（Weather V2 additive） ==')
  const { buildCloudLevels } = require('./lib/weather')
  const times3 = ['2026-10-06T00:00', '2026-10-06T01:00', '2026-10-06T02:00']
  const hLv = {
    cloud_cover_950hPa: [10, 20, null], geopotential_height_950hPa: [500, 505, 510],
    cloud_cover_800hPa: [80, 130, 55], geopotential_height_800hPa: [1900, 1910, 1920],
    cloud_cover_600hPa: [40, 50, 60], geopotential_height_600hPa: [4300, 4310, 4320],
  }
  const cl = buildCloudLevels(times3, hLv, 0, 3)
  check('正常数据：结构齐全', cl && cl.times.length === 3 && cl.levels.length === 3 && cl.unit.altitude === 'm ASL', cl)
  check('数值整型化 + 0-100 clamp（130% → 100）',
    cl.levels[1].cloudCover[1] === 100 && Number.isInteger(cl.levels[1].cloudCover[1]), cl.levels[1])
  check('缺失小时保留 null（可识别，不污染 0）',
    cl.levels[0].cloudCover[2] === null && cl.levels[0].altitudes[2] === null, cl.levels[0])
  const clPartial = buildCloudLevels(times3, {
    cloud_cover_950hPa: [10, null, null], geopotential_height_950hPa: [500, null, null],
  }, 0, 3)
  check('单层部分有效仍保留（any 规则）', clPartial && clPartial.levels.length === 1 && clPartial.levels[0].cloudCover[0] === 10, clPartial)
  const clEmpty = buildCloudLevels(times3, {}, 0, 3)
  check('全空 → null（降级信号）', clEmpty === null, clEmpty)
  const clShort = buildCloudLevels(times3, hLv, 0, 5)
  check('窗口超出 times → null', clShort === null, clShort)
  const clNaN = buildCloudLevels(times3, {
    cloud_cover_800hPa: [NaN, 30, 40], geopotential_height_800hPa: [1900, NaN, 1920],
  }, 0, 3)
  check('NaN/Infinity 不离开数据层（转 null）',
    clNaN.levels[0].cloudCover[0] === null && clNaN.levels[0].altitudes[1] === null, clNaN)

  console.log('== 13. 删除草稿 ==')
  r = dispatch(sTrack, LIN, { type: 'activity.create', input: fullActivityInput() })
  check('再建一份草稿用于删除', r.ok, r.error)
  sTrack = r.value.state
  const delId = r.value.targetIds[0]
  r = dispatch(sTrack, LIN, { type: 'activity.delete', activityId: delId })
  check('删除草稿 ok', r.ok, r.error)
  sTrack = r.value.state
  check('活动已移除', !sTrack.activities.some(a => a.id === delId))
  check('删除后不变量成立', assertInvariants(sTrack).ok)
  r = dispatch(sTrack, LIN, { type: 'activity.delete', activityId: delId })
  check('重复删除被拒', !r.ok && r.error.code === 'NOT_FOUND', r.error)
  r = dispatch(sTrack, LIN, { type: 'activity.publish', activityId: act2.id, participation: null })
  check('发布 act2 ok', r.ok, r.error)
  sTrack = r.value.state
  r = dispatch(sTrack, LIN, { type: 'activity.delete', activityId: act2.id })
  check('已发布活动删除被拒（走取消）', !r.ok && r.error.code === 'FORBIDDEN', r.error)

  console.log('== 14. 发现页 kind:discover（ADR-0003：已发布活动可被发现） ==')
  r = dispatch(sTrack, LIN, { type: 'activity.create', input: fullActivityInput() })
  check('再建一份草稿用于发现页对照', r.ok, r.error)
  sTrack = r.value.state
  const draftForDiscover = r.value.targetIds[0]
  check('草稿无 publishedAt', sTrack.activities.find(a => a.id === draftForDiscover).publishedAt === undefined)
  r = dispatch(sTrack, LIN, { type: 'activity.publish', activityId: draftForDiscover, participation: null })
  check('发布后写入 publishedAt', r.ok && typeof sTrack.activities.find(a => a.id === draftForDiscover) === 'object', r.error)
  sTrack = r.value.state
  check('publishedAt 已落库', !!sTrack.activities.find(a => a.id === draftForDiscover).publishedAt)
  const guestDiscover = selectView(sTrack, { userId: OWNER }, { kind: 'discover' }, '2026-09-26T07:00:00+08:00')
  check('他人无需链接即可发现已发布活动', guestDiscover.kind === 'discover' && guestDiscover.activities.some(a => a.id === draftForDiscover))
  check('发现页不含草稿', !guestDiscover.activities.some(a => a.id === delId))
  check('发现页不泄露 ownerId（openid）', guestDiscover.activities.every(a => a.ownerId === undefined))
  check('发现页不泄露集合点地址坐标', guestDiscover.activities.every(a => a.pickupPoints === undefined))
  check('发现页给出 owner 布尔标记', guestDiscover.activities.every(a => typeof a.owner === 'boolean' && a.owner === false))
  const ownerDiscover = selectView(sTrack, { userId: LIN }, { kind: 'discover' }, '2026-09-26T07:00:00+08:00')
  check('创建者在发现页 owner=true', ownerDiscover.activities.filter(a => a.owner).length >= 1)
  check('已过出发时间的活动不再展示', !selectView(sTrack, { userId: OWNER }, { kind: 'discover' }, '2026-12-01T00:00:00+08:00').activities.some(a => a.id === draftForDiscover))
  const hit = selectView(sTrack, { userId: OWNER }, { kind: 'discover', search: '青城' }, '2026-09-26T07:00:00+08:00')
  check('发现页搜索命中', hit.activities.length > 0)
  const miss = selectView(sTrack, { userId: OWNER }, { kind: 'discover', search: '不存在的活动名' }, '2026-09-26T07:00:00+08:00')
  check('发现页搜索无命中返回空', miss.activities.length === 0)
  check('无账号访问发现页被引导完善资料',
    selectView(sTrack, { userId: null }, { kind: 'discover' }, '2026-09-26T07:00:00+08:00').code === 'AUTH_REQUIRED')
  const legacyDiscover = (function () {
    const st = JSON.parse(JSON.stringify(sTrack))
    delete st.activities.find(a => a.id === draftForDiscover).publishedAt
    return selectView(st, { userId: OWNER }, { kind: 'discover' }, '2026-09-26T07:00:00+08:00')
  })()
  check('存量活动缺 publishedAt 仍可被发现（排在末尾）',
    legacyDiscover.activities.length > 0
    && legacyDiscover.activities.some(a => a.id === draftForDiscover)
    && legacyDiscover.activities[legacyDiscover.activities.length - 1].id === draftForDiscover)
  const noOpenedIds = selectView(sTrack, { userId: OWNER }, { kind: 'home', perspective: 'participant' }, '2026-09-26T07:00:00+08:00')
  check('home 未传 openedActivityIds 不再抛异常', noOpenedIds.kind === 'home')

  /* ================= 第 15 节：P3 独立天气 getWeatherByPoint 纯逻辑 =================
   * index.js 无法在本地 require（wx-server-sdk），所以校验/窗口/纠偏/投影全部沉到
   * lib/weather 的纯函数里（index.js 只做编排）。这里覆盖纯函数；缓存命中与免 OPENID
   * 的完整链路在部署后真机验证（P3 §11 记录了这一取舍）。 */
  section('15. 独立天气 getWeatherByPoint：校验/窗口/纠偏/投影')
  {
    const today = W.cnToday()
    const plus = n => new Date(Date.parse(today + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)

    check('免鉴权集合：getWeather/getWeatherByPoint 在列，dispatch 不在',
      W.isWeatherFreeAction('getWeather') && W.isWeatherFreeAction('getWeatherByPoint')
      && !W.isWeatherFreeAction('dispatch') && !W.isWeatherFreeAction('read'))

    // 缓存 key：2dp 网格（≈1.1 km）——两路径缓存互通的全部机制
    const k1 = W.weatherCacheKey(30.911, 103.477, plus(1))
    const k2 = W.weatherCacheKey(30.909, 103.479, plus(1))
    const k3 = W.weatherCacheKey(30.921, 103.477, plus(1))
    check('同 2dp 网格同 key（活动路径与自由路径共享缓存）', k1 === k2, k1 + ' vs ' + k2)
    check('不同网格不同 key', k1 !== k3)

    // 合法查询：GCJ 入参纠偏到 WGS（与活动路径同一变换）
    const ok = W.resolvePointQuery({ lat: 30.9458, lng: 103.4769, date: plus(3) }, today)
    check('合法查询 ok', ok.ok === true)
    check('GCJ 入参纠偏到 WGS（两轴幅度 0.0005~0.01 度）', Number.isFinite(ok.wgs.lat)
      && Math.abs(ok.wgs.lat - 30.9458) > 0.0005 && Math.abs(ok.wgs.lat - 30.9458) < 0.01
      && Math.abs(ok.wgs.lng - 103.4769) > 0.0005 && Math.abs(ok.wgs.lng - 103.4769) < 0.01,
      JSON.stringify(ok.wgs))

    // 非法入参 → INVALID_INPUT
    for (const [name, payload] of [
      ['lat 超界', { lat: 91, lng: 103, date: plus(1) }],
      ['lat 缺失', { lng: 103, date: plus(1) }],
      ['lng 非数', { lat: 30, lng: 'abc', date: plus(1) }],
      ['日期非 ISO', { lat: 30, lng: 103, date: '2026-10-3' }],
      ['日期不存在', { lat: 30, lng: 103, date: '2026-02-30' }],
    ]) {
      const r = W.resolvePointQuery(payload, today)
      check(name + ' → INVALID_INPUT', r.ok === false && r.code === 'INVALID_INPUT', JSON.stringify(r))
    }

    // 窗口：0–14 天内 ok；15 天外 / 过去 → out_of_range（业务态，非错误）
    check('今天 ok', W.resolvePointQuery({ lat: 30, lng: 103, date: today }, today).ok === true)
    check('14 天后 ok', W.resolvePointQuery({ lat: 30, lng: 103, date: plus(14) }, today).ok === true)
    check('15 天后 out_of_range', W.resolvePointQuery({ lat: 30, lng: 103, date: plus(15) }, today).status === 'out_of_range')
    check('昨天 out_of_range', W.resolvePointQuery({ lat: 30, lng: 103, date: plus(-1) }, today).status === 'out_of_range')

    // 投影：形状与活动路径 ready 分支一致（无遗留 hours）
    const forecast = {
      elevation: 4250,
      days: [{ date: today, code: 2, tMax: 20, tMin: 10, cloud: { low: 1, mid: 2, high: 3 } }],
      detail: [{ t: '08:00', d: today, temp: 12 }],
      series: [{ t: '08:00', d: today, temp: 12 }],
    }
    const body = W.pointResponse(forecast)
    check('投影字段齐备', body && body.pointElevation === 4250 && body.days.length === 1
      && body.detail.length === 1 && body.series.length === 1)
    check('投影无遗留 hours 字段', body && !('hours' in body))
    check('tooEarly → null（转 out_of_range）', W.pointResponse({ tooEarly: true, days: [], detail: [] }) === null)
    check('当日无数据 → null', W.pointResponse({ elevation: 1, days: [], detail: [], series: [] }) === null)
  }

  /* ================= 第 16 节：Profile 域补洞（docs/product/profile/13-testing-strategy §4） =================
   * 此前零覆盖：me 视图口径 / membership.save 错误路径 / membership.revoke / companion.remove 域 /
   * position.revoke 域 / profile.save 服务端拒绝 / canReadSensitive+readContact 直测 / export.record 命令。 */
  section('16. Profile 域补洞：me 视图 / membership / companion / position.revoke / 拒绝路径 / 敏感读')
  const ME = 'o-me-openid'
  const OTHER = 'o-other-openid'
  const personOf = (name, phone) => ({ name, phone, emergency: { name: '紧急人', phone: '13000000000' }, medical: '' })
  {
    // ---- 16a. me 视图（kind:'me' 复合投影）----
    let st = emptyState()
    let r = dispatch(st, ME, { type: 'profile.save', person: personOf('墨白', '13800000001') })
    check('16a 前置：profile.save 落库', r.ok, r.error)
    st = r.value.state
    const me0 = selectView(st, { userId: ME }, { kind: 'me' }, ctx().now)
    check('me 视图 kind=me 且 person 回读', me0.kind === 'me' && me0.profile.person.name === '墨白'
      && me0.profile.person.phone === '13800000001', JSON.stringify(me0.profile && me0.profile.person))
    check('me 视图：无活动时 stats 全 0、recent 空、positionRows 空',
      me0.stats.ongoing === 0 && me0.stats.finished === 0 && me0.stats.organized === 0
      && me0.recent.length === 0 && me0.positionRows.length === 0, JSON.stringify(me0.stats))
    check('me 视图：无账号 AUTH_REQUIRED',
      selectView(st, { userId: null }, { kind: 'me' }, ctx().now).code === 'AUTH_REQUIRED')
    const meShell = selectView(st, { userId: OTHER }, { kind: 'me' }, ctx().now)
    check('me 视图：无档案用户回空壳不炸（id=自身，person 空，不含他人数据）',
      meShell.kind === 'me' && meShell.profile.id === OTHER && meShell.profile.person.name === ''
      && meShell.profile.companions.length === 0, JSON.stringify(meShell.profile))

    // 造一场「发布 + 本人已确认参加」（发布即报名，smoke §3 同款路径）
    const joinParticipation = {
      personRef: { kind: 'user', userId: ME },
      participant: personOf('墨白', '13800000001'),
      trip: { mode: 'self' },
      consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }
    r = dispatch(st, ME, { type: 'activity.create', input: fullActivityInput() })
    check('16a 前置：活动草稿创建', r.ok, r.error)
    st = r.value.state
    const actMe = r.value.targetIds[0]
    r = dispatch(st, ME, { type: 'activity.publish', activityId: actMe, participation: joinParticipation })
    check('16a 前置：发布并本人参加（confirmed）', r.ok, r.error)
    st = r.value.state
    const me1 = selectView(st, { userId: ME }, { kind: 'me' }, ctx().now)
    check('me 视图口径：published+owner → ongoing=1、organized=1',
      me1.stats.ongoing === 1 && me1.stats.organized === 1 && me1.stats.finished === 0, JSON.stringify(me1.stats))
    check('me 视图：recent ≤3 且 slim 行带 role（owner）',
      me1.recent.length === 1 && me1.recent[0].id === actMe && me1.recent[0].role === 'owner'
      && JSON.stringify(Object.keys(me1.recent[0]).sort()) === JSON.stringify(['id', 'phase', 'role', 'startAt', 'title']),
      JSON.stringify(me1.recent))
    check('me 视图与 home 视图对同一人不互相泄露：me 不带 activityView/routeSnapshot',
      me1.activities === undefined && me1.profile.person.medical !== undefined, '')

    // JSON 手术造「归档」「第二场活动」「有效位置」——投影是纯函数，不要求手术态过 invariants
    const surgery = JSON.parse(JSON.stringify(st))
    const act2 = JSON.parse(JSON.stringify(surgery.activities.find(a => a.id === actMe)))
    act2.id = 'act-me-2'
    act2.phase = 'archived'
    act2.startAt = '2026-09-01T08:00:00+08:00'
    surgery.activities.push(act2)
    const signupId = surgery.signups.find(s => s.activityId === actMe && s.personRef.kind === 'user').id
    surgery.positions.push({
      signupId, coordinates: { lat: 30.9, lng: 103.4 }, reportedAt: '2026-09-26T06:00:00+08:00',
      consentExpiresAt: '2026-10-01T18:00:00+08:00', revokedAt: null,
    })
    const me2 = selectView(surgery, { userId: ME }, { kind: 'me' }, ctx().now)
    check('me 视图口径：archived+ownRows → finished=1、organized=2',
      me2.stats.finished === 1 && me2.stats.organized === 2 && me2.stats.ongoing === 1, JSON.stringify(me2.stats))
    check('me 视图：recent 进行中优先（published 在 archived 前）且 ≤3',
      me2.recent.length === 2 && me2.recent[0].id === actMe && me2.recent[1].id === 'act-me-2',
      JSON.stringify(me2.recent))
    check('me 视图：positionRows 出现本人有效位置行',
      me2.positionRows.length === 1 && me2.positionRows[0].signupId === signupId
      && me2.positionRows[0].activityId === actMe, JSON.stringify(me2.positionRows))
    const homeConsistency = selectView(surgery, { userId: ME }, { kind: 'home', perspective: 'participant', openedActivityIds: [] }, ctx().now)
    const homeRows = homeConsistency.activities.map(a => (a.meta.positionRows || []).length).reduce((x, y) => x + y, 0)
    check('me 与 home 的 positionRows 同源同数（重构后行为一致）',
      homeRows === me2.positionRows.length, JSON.stringify({ home: homeRows, me: me2.positionRows.length }))
  }
  {
    // ---- 16b. membership.save / membership.revoke（此前唯一覆盖是 golden-path 自授成功路径）----
    let st = emptyState()
    let r = dispatch(st, ME, { type: 'profile.save', person: personOf('墨白', '13800000001') })
    st = r.value.state
    r = dispatch(st, LIN, { type: 'profile.save', person: personOf('林舟', '13800000002') })
    check('16b 前置：LIN 档案落库', r.ok, r.error)
    st = r.value.state
    r = dispatch(st, ME, { type: 'activity.create', input: fullActivityInput() })
    st = r.value.state
    const act = r.value.targetIds[0]
    r = dispatch(st, ME, { type: 'activity.publish', activityId: act, participation: null })
    st = r.value.state
    const membership = over => Object.assign({
      role: 'staff', id: 'membership-smoke-1', activityId: act, userId: LIN,
      expiresAt: '2026-12-31T23:59:59+08:00', scope: { kind: 'all' }, capabilities: ['roster'],
    }, over)
    r = dispatch(st, LIN, { type: 'membership.save', activityId: act, membership: membership() })
    check('非组织者授予协作授权 → FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    r = dispatch(st, ME, { type: 'membership.save', activityId: act, membership: membership({ userId: 'o-ghost-openid' }) })
    check('身份码（profile.id）不存在 → NOT_FOUND 且文案指路对方完善资料',
      !r.ok && r.error.code === 'NOT_FOUND' && r.error.message.indexOf('身份码') !== -1, r.error)
    r = dispatch(st, ME, { type: 'membership.save', activityId: act, membership: membership({ expiresAt: '2026-01-01T00:00:00+08:00' }) })
    check('授权截止时间早于当前 → INVALID_INPUT', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
    r = dispatch(st, ME, { type: 'membership.save', activityId: act, membership: membership({ capabilities: [] }) })
    check('staff 无工作能力 → INVALID_INPUT', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
    r = dispatch(st, ME, { type: 'membership.save', activityId: act, membership: membership({ scope: { kind: 'selected', signupIds: [] } }) })
    check('scope.selected 空名单 → INVALID_INPUT', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
    r = dispatch(st, ME, { type: 'membership.save', activityId: act, membership: membership() })
    check('合法 staff 授权 → ok', r.ok, r.error)
    st = r.value.state
    r = dispatch(st, ME, { type: 'membership.revoke', activityId: act, membershipId: 'membership-smoke-1' })
    check('撤销协作授权 → ok', r.ok, r.error)
    st = r.value.state
    r = dispatch(st, ME, { type: 'membership.revoke', activityId: act, membershipId: 'membership-smoke-1' })
    check('重复撤销 → NOT_FOUND', !r.ok && r.error.code === 'NOT_FOUND', r.error)
  }
  {
    // ---- 16c. companion 域（此前只有 me 页 UI 层覆盖）----
    let st = emptyState()
    let r = dispatch(st, ME, { type: 'profile.save', person: personOf('墨白', '13800000001') })
    st = r.value.state
    const companionPerson = personOf('同伴甲', '13900000001')
    r = dispatch(st, ME, { type: 'companion.save', companionId: null, person: companionPerson })
    check('companion.save 新增 → ok', r.ok, r.error)
    st = r.value.state
    const cid = r.value.targetIds[0]
    r = dispatch(st, ME, { type: 'companion.save', companionId: cid, person: personOf('同伴甲改', '13900000001') })
    check('companion.save 同 id 更新 → ok 且条目数不变',
      r.ok && st.profiles.find(p => p.id === ME).companions.length === 1, r.error)
    st = r.value.state
    check('更新后内容生效', st.profiles.find(p => p.id === ME).companions[0].person.name === '同伴甲改')
    r = dispatch(st, OTHER, { type: 'companion.save', companionId: cid, person: companionPerson })
    check('他人引用我的 companionId → FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    r = dispatch(st, ME, { type: 'companion.save', companionId: null, person: personOf('', '') })
    check('缺姓名电话 → INVALID_INPUT 且 fieldErrors 点名',
      !r.ok && r.error.code === 'INVALID_INPUT' && r.error.fieldErrors && r.error.fieldErrors.name, r.error)
    r = dispatch(st, ME, { type: 'companion.remove', companionId: cid })
    check('companion.remove → ok', r.ok, r.error)
    st = r.value.state
    check('移除后条目消失', st.profiles.find(p => p.id === ME).companions.length === 0)
    r = dispatch(st, ME, { type: 'companion.remove', companionId: cid })
    check('重复移除已被 canExecute 拒绝（FORBIDDEN）——与设计文档 SF-4 记录不符，以代码为准并在实施日志记录',
      !r.ok && r.error.code === 'FORBIDDEN', r.error)
    const otherSave = dispatch(emptyState(), OTHER, { type: 'companion.save', companionId: null, person: companionPerson })
    check('无档案账号 companion.save → NOT_FOUND（请先保存当前账号资料）',
      !otherSave.ok && otherSave.error.code === 'NOT_FOUND', otherSave.error)
  }
  {
    // ---- 16d. profile.save 服务端拒绝路径（此前只发合法 payload）----
    const st = emptyState()
    let r = dispatch(st, ME, { type: 'profile.save', person: personOf('', '13800000001') })
    check('缺姓名 → INVALID_INPUT + fieldErrors.name',
      !r.ok && r.error.code === 'INVALID_INPUT' && r.error.fieldErrors && r.error.fieldErrors.name === '请填写姓名', r.error)
    r = dispatch(st, ME, { type: 'profile.save', person: personOf('墨白', '') })
    check('缺电话 → INVALID_INPUT + fieldErrors.phone',
      !r.ok && r.error.code === 'INVALID_INPUT' && r.error.fieldErrors && r.error.fieldErrors.phone === '请填写联系电话', r.error)
    const stray = Object.assign(personOf('墨白', '13800000001'), { strayKey: 'x' })
    r = dispatch(st, ME, { type: 'profile.save', person: stray })
    check('emergency 之外的杂散键被严格 schema 拒收（注释里的坑变成断言）',
      !r.ok && r.error.code === 'INVALID_INPUT', r.error)
  }
  {
    // ---- 16e. position.revoke 域行为 ----
    let st = emptyState()
    let r = dispatch(st, ME, { type: 'profile.save', person: personOf('墨白', '13800000001') })
    st = r.value.state
    r = dispatch(st, ME, { type: 'activity.create', input: fullActivityInput() })
    st = r.value.state
    const act = r.value.targetIds[0]
    r = dispatch(st, ME, {
      type: 'activity.publish', activityId: act,
      participation: {
        personRef: { kind: 'user', userId: ME }, participant: personOf('墨白', '13800000001'),
        trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
      },
    })
    check('16e 前置：发布并本人参加', r.ok, r.error)
    st = r.value.state
    const mySignupId = st.signups.find(s => s.activityId === act).id
    // 位置上报要求 active 阶段——手术注入一条有效位置（与 16a 同法），只测 revoke 的域行为
    const surgery = JSON.parse(JSON.stringify(st))
    surgery.activities.find(a => a.id === act).phase = 'active'
    surgery.positions.push({
      signupId: mySignupId, coordinates: { lat: 30.9, lng: 103.4 }, reportedAt: '2026-09-26T06:00:00+08:00',
      consentExpiresAt: '2026-10-01T18:00:00+08:00', revokedAt: null,
    })
    st = surgery
    r = dispatch(st, OTHER, { type: 'position.revoke', activityId: act, signupId: mySignupId })
    check('无关他人撤回他人位置 → FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    r = dispatch(st, ME, { type: 'position.revoke', activityId: act, signupId: mySignupId })
    check('本人撤回自己的位置 → ok 且 revokedAt 落库（读 dispatch 后的 state）', r.ok
      && r.value.state.positions.find(p => p.signupId === mySignupId).revokedAt === ctx().now, r.error)
    st = r.value.state
    r = dispatch(st, ME, { type: 'position.revoke', activityId: act, signupId: mySignupId })
    check('重复撤回（已无有效位置）幂等 → ok', r.ok, r.error)
    r = dispatch(st, ME, { type: 'position.revoke', activityId: act, signupId: 'signup-ghost' })
    check('不存在的报名撤回 → NOT_FOUND（canExecute requireSignups）', !r.ok && r.error.code === 'NOT_FOUND', r.error)
  }
  {
    // ---- 16f. canReadSensitive / selectContact 直测（此前只经 readForm/readExport 间接走到）----
    // 关键：owner 读「本人」会走 self 分支绕过 purpose 门槛——owner 读门槛必须用「他人的报名」测
    let st = emptyState()
    let r = dispatch(st, ME, { type: 'profile.save', person: personOf('墨白', '13800000001') })
    st = r.value.state
    r = dispatch(st, LIN, { type: 'profile.save', person: personOf('林舟', '13800000002') })
    st = r.value.state
    r = dispatch(st, LIN, { type: 'activity.create', input: fullActivityInput() })
    st = r.value.state
    const act = r.value.targetIds[0]
    r = dispatch(st, LIN, {
      type: 'activity.publish', activityId: act,
      participation: {
        personRef: { kind: 'user', userId: LIN }, participant: personOf('林舟', '13800000002'),
        trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
      },
    })
    st = r.value.state
    r = dispatch(st, ME, {
      type: 'signup.submit', activityId: act, keepTogether: false, mode: 'apply',
      participants: [{
        personRef: { kind: 'user', userId: ME }, participant: personOf('墨白', '13800000001'),
        trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
      }],
    })
    check('16f 前置：他人（ME）自报 → pending', r.ok, r.error)
    st = r.value.state
    const linSignup = st.signups.find(s => s.activityId === act && s.personRef.userId === LIN).id
    const meSignup = st.signups.find(s => s.activityId === act && s.personRef.userId === ME).id
    const now = ctx().now
    check('本人读自己敏感资料 → ok（无条件，无 purpose 也放行）',
      selectSensitive(st, { userId: LIN }, act, linSignup, '', now).ok)
    check('owner 无用途读他人（ME 的报名）→ FORBIDDEN（purpose 硬门槛）',
      !selectSensitive(st, { userId: LIN }, act, meSignup, '', now).ok
      && selectSensitive(st, { userId: LIN }, act, meSignup, '', now).error.code === 'FORBIDDEN',
      JSON.stringify(selectSensitive(st, { userId: LIN }, act, meSignup, '', now)))
    const ownerView = selectSensitive(st, { userId: LIN }, act, meSignup, '核实名单', now)
    check('owner 带用途读他人 → ok 且只含 emergency/medical（无 phone 泄露面扩大）',
      ownerView.ok && ownerView.value.emergency && ownerView.value.medical !== undefined
      && ownerView.value.phone === undefined, JSON.stringify(ownerView.value))
    check('路人（OTHER）读他人敏感资料 → FORBIDDEN',
      !selectSensitive(st, { userId: OTHER }, act, linSignup, '核实名单', now).ok
      && selectSensitive(st, { userId: OTHER }, act, linSignup, '核实名单', now).error.code === 'FORBIDDEN',
      JSON.stringify(selectSensitive(st, { userId: OTHER }, act, linSignup, '核实名单', now)))
    const archived = JSON.parse(JSON.stringify(st))
    archived.activities.find(a => a.id === act).phase = 'archived'
    check('归档后 owner 带用途读他人敏感 → FORBIDDEN（workDataAvailable 关闭，e2e 同款结论的域级锚点）',
      !selectSensitive(archived, { userId: LIN }, act, meSignup, '核实名单', now).ok,
      JSON.stringify(selectSensitive(archived, { userId: LIN }, act, meSignup, '核实名单', now)))
    check('readContact：本人读自己 → ok',
      selectContact(st, { userId: LIN }, act, linSignup, now).ok)
    check('readContact：owner 读已报名他人 → ok（roster 工作许可）',
      selectContact(st, { userId: LIN }, act, meSignup, now).ok)
    check('readContact：路人 → FORBIDDEN',
      !selectContact(st, { userId: OTHER }, act, linSignup, now).ok)
    check('readContact：归档后 owner → FORBIDDEN（工作侧关闭）',
      !selectContact(archived, { userId: LIN }, act, meSignup, now).ok)
  }
  {
    // ---- 16g. export.record 命令（此前零调度覆盖，只有 readExport 权限门）----
    let st = emptyState()
    let r = dispatch(st, ME, { type: 'profile.save', person: personOf('墨白', '13800000001') })
    st = r.value.state
    r = dispatch(st, ME, { type: 'activity.create', input: fullActivityInput() })
    st = r.value.state
    const act = r.value.targetIds[0]
    r = dispatch(st, ME, {
      type: 'activity.publish', activityId: act,
      participation: {
        personRef: { kind: 'user', userId: ME }, participant: personOf('墨白', '13800000001'),
        trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
      },
    })
    st = r.value.state
    const mySignupId = st.signups.find(s => s.activityId === act).id
    r = dispatch(st, LIN, { type: 'export.record', activityId: act, signupIds: [mySignupId], mode: 'ordinary', purpose: 'x' })
    check('export.record 非组织者 → FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    r = dispatch(st, ME, { type: 'export.record', activityId: act, signupIds: [mySignupId], mode: 'ordinary', purpose: 'x' })
    check('普通导出 → ok 且事件账记录「普通名单导出」（读 dispatch 后的 state）',
      r.ok && r.value.state.events.some(e => e.kind === 'export.record' && e.summary.indexOf('普通名单导出') !== -1), r.error)
    st = r.value.state
    r = dispatch(st, ME, { type: 'export.record', activityId: act, signupIds: [mySignupId], mode: 'sensitive', purpose: '  ' })
    check('敏感导出空用途 → FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    r = dispatch(st, ME, { type: 'export.record', activityId: act, signupIds: [mySignupId], mode: 'sensitive', purpose: '紧急联络卡打印' })
    check('敏感导出带用途 → ok 且事件账记录用途',
      r.ok && r.value.state.events.some(e => e.summary.indexOf('敏感名单导出：紧急联络卡打印') !== -1), r.error)
    st = r.value.state
  }

  console.log('== 17. activity.edit handler 层 owner 门（Phase 8.0 纵深防御第二层）==')
  {
    // 直调 handleActivity 是刻意的：第二层只有绕过 canExecute 才观测得到。
    // 走完整 dispatch 时两层都回 FORBIDDEN，行为上不可区分——Phase 8 变异实测：
    // 只拆 handler 门 ⇒ permission 96/1（仅静态门红）、A 层 71/0 全盲；
    // 只拆 canExecute 门 ⇒ 拒绝改由 handler 发出，文案不同但信封形状一样。
    let st = emptyState()
    let r = dispatch(st, LIN, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } })
    st = r.value.state
    r = dispatch(st, LIN, { type: 'activity.create', input: fullActivityInput() })
    st = r.value.state
    const actId = r.value.targetIds[0]
    const title0 = st.activities[0].title
    const rev0 = st.revision
    const pristine = JSON.stringify(st)
    const edit = (actor, title) => ({
      actor: { userId: actor }, requestId: genId('req'), expectedRevision: st.revision, fingerprint: '0'.repeat(64),
      payload: { type: 'activity.edit', activityId: actId, input: Object.assign(fullActivityInput(), { title }) },
    })

    const victim = deepClone(st)
    const denied = handleActivity(victim, edit(OWNER, '越权改标题'), ctx())
    check('非 owner 直调 handler activity.edit → FORBIDDEN（第二层独立成立）',
      denied.ok === false && denied.error.code === 'FORBIDDEN', denied.error)
    check('拒绝文案出自 handler（不是 canExecute 的通用权限文案）',
      denied.ok === false && String(denied.error.message).indexOf('只有活动发起者') === 0, denied.error)
    check('败者零副作用：传入的 state 深比较与调用前逐字节一致（title/revision/receipts/events 全未动）',
      JSON.stringify(victim) === pristine, '')

    const mine = deepClone(st)
    const allowedRes = handleActivity(mine, edit(LIN, '青城后山·本人改'), ctx())
    check('owner 直调 handler activity.edit → ok（第二层不误伤正当写入）', allowedRes.ok === true, allowedRes.error)
    check('正当写入改到 title，且 handler 层不推进 revision（推进属 commands 层职责）',
      allowedRes.ok === true && mine.activities[0].title === '青城后山·本人改' && mine.revision === rev0, '')
    check('第二层在字段校验之前生效：非 owner 带非法输入仍是 FORBIDDEN 而非 INVALID_INPUT',
      handleActivity(deepClone(st), { actor: { userId: OWNER }, requestId: genId('req'), expectedRevision: st.revision, fingerprint: '0'.repeat(64), payload: { type: 'activity.edit', activityId: actId, input: null } }, ctx()).error.code === 'FORBIDDEN', '')
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

run()
