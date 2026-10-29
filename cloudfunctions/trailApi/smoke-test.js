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
    events: [], notices: [], tasks: [], plans: [], receipts: [],
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
  {
    // 行动流：通知行头要回答「哪场活动」，详情卡要能给出出发时刻与集合点。
    const nv = selectView(state, { userId: LIN }, { kind: 'notices' }, ctx().now)
    const first = nv.notices && nv.notices[0]
    const linked = first && state.activities.find(a => a.id === first.activityId)
    const linkedPickup = linked && linked.pickupPoints && linked.pickupPoints.length ? linked.pickupPoints[0].name : ''
    check('通知视图带 activityTitle / activityStartAt / pickupName（行头与详情卡的数据）',
      !!first && !!linked && first.activityTitle === linked.title
      && first.activityStartAt === linked.startAt && first.pickupName === linkedPickup,
      JSON.stringify({ first: first && { t: first.activityTitle, s: first.activityStartAt, p: first.pickupName }, linked: linked && { t: linked.title, s: linked.startAt } }))
  }
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
  withTrack.routeSnapshot.track = [
    { lat: 30.9394, lng: 103.4901, ele: 700 },
    { lat: 30.9458, lng: 103.4769, ele: 860 },
    { lat: 30.9565, lng: 103.4769, ele: 820 },
  ]
  withTrack.routeSnapshot.difficulty = 'moderate'
  withTrack.equipmentSuggested = ['备用袜']
  let sTrack = emptyState()
  r = dispatch(sTrack, LIN, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } })
  sTrack = r.value.state
  r = dispatch(sTrack, LIN, { type: 'activity.create', input: withTrack })
  check('activity.create with track ok', r.ok, r.error)
  sTrack = r.value.state
  const act2 = sTrack.activities[0]
  check('activity 保留 track', act2.routeSnapshot.track.length === 3)
  check('私有路线携带 track', sTrack.routes[0].track && sTrack.routes[0].track.length === 3)
  check('私有路线携带难度', sTrack.routes[0].difficulty === 'moderate')
  const view2 = selectView(sTrack, { userId: LIN }, { kind: 'activity', activityId: act2.id, perspective: 'organizer' }, '2026-09-26T07:00:00+08:00')
  check('视图透传 track', view2.kind === 'activity' && view2.activity.routeSnapshot.track && view2.activity.routeSnapshot.track.length === 3)
  check('视图透传 track 高程（连续剖面用）',
    view2.kind === 'activity' && view2.activity.routeSnapshot.track.every(p => Number.isFinite(p.ele)))
  check('视图透传难度与建议装备',
    view2.kind === 'activity' && view2.activity.routeSnapshot.difficulty === 'moderate'
    && view2.activity.equipmentSuggested[0] === '备用袜')
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

  /* 剖面顶到 300 hPa（2026-10-28 用户决定；实测中国境内 300hPa 高度 8,498–9,765 m）。
     只喂云层剖面图的 cloudLevels；业务成带判据 cloudBandAt 必须仍停在 450 hPa
     —— 抬显示天花板不得顺带改天相结论（铁律 28）。 */
  const hTop = {
    cloud_cover_450hPa: [10], geopotential_height_450hPa: [6700],
    cloud_cover_300hPa: [95], geopotential_height_300hPa: [9700],
  }
  const clTop = buildCloudLevels(times3, hTop, 0, 1)
  check('剖面含 300 hPa 层（顶到 9,700 m）', !!clTop && clTop.levels.some(l => l.pressure === 300),
    clTop && clTop.levels.map(l => l.pressure))
  check('9,700 m 的成层云不参与 cloudBandAt（业务判据仍停在 450 hPa ⇒ 无带）',
    cloudBandAt(hTop, 0) === null, cloudBandAt(hTop, 0))

  console.log('== 12c. 天气：低层温湿廓线 / 总云量 / PBLH（2026-10 天相输入修正） ==')
  const { hourView, PROFILE_LEVELS } = require('./lib/weather')
  const hProf = {
    temperature_2m: [10], temperature_925hPa: [12], relative_humidity_925hPa: [90],
    temperature_850hPa: [8], relative_humidity_850hPa: [80],
    temperature_700hPa: [2], relative_humidity_700hPa: [70],
    cloud_cover: [55], cloud_cover_low: [10], cloud_cover_mid: [20], cloud_cover_high: [30],
    boundary_layer_height: [800],
    precipitation: [0], precipitation_probability: [0], weather_code: [0],
    wind_speed_10m: [5], wind_gusts_10m: [8], relative_humidity_2m: [60],
  }
  const hv = hourView(['2026-10-06T00:00'], hProf, 0)
  check('廓线档位固定为 925/850/700', PROFILE_LEVELS.join(',') === '925,850,700')
  check('hourView 带气压层温湿廓线', hv.profile && hv.profile[925].t === 12 && hv.profile[850].rh === 80, hv.profile)
  check('hourView 总云量 / PBLH additive', hv.cloud.total === 55 && hv.pblh === 800, { cloud: hv.cloud, pblh: hv.pblh })
  const hvMissing = hourView(['2026-10-06T00:00'], {
    temperature_925hPa: [null], relative_humidity_925hPa: [null],
    temperature_850hPa: [undefined], relative_humidity_850hPa: [undefined],
  }, 0)
  check('廓线全缺 → null，不编 0', hvMissing.profile === null, hvMissing.profile)

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

  console.log('== 14b. 活动可见性 visibility（D-07 ④B：缺省 discover / link 只走分享链接） ==')
  {
    const NOW = '2026-09-26T07:00:00+08:00'
    // 缺省：不带键创建的记录不含该键（存量形状不变），读回按 discover
    check('不带 visibility 创建 → 记录无该键',
      sTrack.activities.find(a => a.id === draftForDiscover).visibility === undefined)
    check('旧活动读回活动视图按 discover 兜底',
      selectView(sTrack, { userId: LIN }, { kind: 'activity', activityId: draftForDiscover, perspective: 'organizer' }, NOW).activity.visibility === 'discover')

    // 显式 link：可建可发，但不进任何人的发现页；凭 id 仍可打开
    r = dispatch(sTrack, LIN, { type: 'activity.create', input: Object.assign(fullActivityInput(), { visibility: 'link' }) })
    check('带 visibility:link 可创建', r.ok, r.error)
    sTrack = r.value.state
    const linkId = r.value.targetIds[0]
    r = dispatch(sTrack, LIN, { type: 'activity.publish', activityId: linkId, participation: null })
    check('link 活动可发布', r.ok, r.error)
    sTrack = r.value.state
    check('他人发现页看不到 link 活动',
      !selectView(sTrack, { userId: OWNER }, { kind: 'discover' }, NOW).activities.some(a => a.id === linkId))
    check('创建者自己的发现页也看不到 link 活动',
      !selectView(sTrack, { userId: LIN }, { kind: 'discover' }, NOW).activities.some(a => a.id === linkId))
    const linkDetail = selectView(sTrack, { userId: OWNER }, { kind: 'activity', activityId: linkId }, NOW)
    check('他人凭 id/分享链接仍可打开 link 活动',
      linkDetail.kind === 'activity' && linkDetail.activity.visibility === 'link' && linkDetail.activity.phase === 'published')
    check('link 活动仍在组织者自己的首页',
      selectView(sTrack, { userId: LIN }, { kind: 'home', perspective: 'organizer' }, NOW).activities.some(a => a.id === linkId))

    // 改回 discover：activity.edit 用 Object.assign，键必须显式提交
    const linkEdit = JSON.parse(JSON.stringify(sTrack.activities.find(a => a.id === linkId)))
    delete linkEdit.id
    delete linkEdit.ownerId
    delete linkEdit.phase
    delete linkEdit.publishedAt
    linkEdit.visibility = 'discover'
    r = dispatch(sTrack, LIN, { type: 'activity.edit', activityId: linkId, input: linkEdit })
    check('已发布 link 可改回 discover', r.ok, r.error)
    sTrack = r.value.state
    check('改回 discover 后重新出现在他人发现页',
      selectView(sTrack, { userId: OWNER }, { kind: 'discover' }, NOW).activities.some(a => a.id === linkId))

    // link 不占发现页 50 条名额：5 条更新的 link + 50 条 discover ⇒ 仍返回 50 条且全非 link
    const bulk = JSON.parse(JSON.stringify(sTrack))
    const template = bulk.activities.find(a => a.id === linkId)
    for (let i = 0; i < 50; i++) {
      const a = JSON.parse(JSON.stringify(template))
      a.id = 'bulk-discover-' + i
      a.title = '公开活动 ' + i
      a.visibility = 'discover'
      a.publishedAt = '2026-09-20T00:00:00+08:00'
      bulk.activities.push(a)
    }
    for (let i = 0; i < 5; i++) {
      const a = JSON.parse(JSON.stringify(template))
      a.id = 'bulk-link-' + i
      a.title = '链接活动 ' + i
      a.visibility = 'link'
      a.publishedAt = '2026-09-25T00:00:00+08:00'
      bulk.activities.push(a)
    }
    const bulkRes = selectView(bulk, { userId: OWNER }, { kind: 'discover' }, NOW)
    check('发现页最多 50 条，更新的 link 不占名额',
      bulkRes.activities.length === 50 && bulkRes.activities.every(a => a.id.indexOf('bulk-link-') !== 0),
      JSON.stringify({ count: bulkRes.activities.length, linkHits: bulkRes.activities.filter(a => a.id.indexOf('bulk-link-') === 0).length }))

    // 非法值必须被 schema 拒绝，不能静默落成未知可见性
    r = dispatch(sTrack, LIN, { type: 'activity.create', input: Object.assign(fullActivityInput(), { visibility: 'public' }) })
    check('非法 visibility 被拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
  }

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

  /* ================= 第 15b 节：日级代表性现象码（白昼窗口 / 雾三证门 / 恶劣一票否决） =================
   * 根因：provider 的 daily.weather_code 是全天最严重的码，深夜雾会把整日徽标染成「雾」。
   * 口径见 docs/superpowers/specs/2026-10-28-weather-day-code-design.md §2。 */
  section('15b. 日级代表性现象码：白昼窗口 / 雾三证门 / 恶劣一票否决')
  {
    const hr = (t, code, rh, vis) => ({ t, code, rh, visibility: vis })

    // 1) 夜间可信雾 + 白昼晴：日码变晴，但 provider 日码仍在调用方手里（fetchForecast 的 code 原值）
    const nightFog = [
      hr('00:00', 45, 100, 0.2), hr('01:00', 45, 100, 0.2), hr('02:00', 45, 98, 0.3), hr('03:00', 45, 97, 0.4),
      hr('07:30', 0, 60, 20), hr('09:00', 0, 55, 20), hr('10:00', 1, 50, 20), hr('11:00', 0, 45, 20),
      hr('12:00', 0, 40, 20), hr('13:00', 1, 45, 20), hr('14:00', 0, 50, 20), hr('15:00', 0, 55, 20),
      hr('16:00', 1, 60, 20), hr('17:00', 0, 65, 20), hr('18:00', 0, 70, 20),
    ]
    check('夜间雾 + 白昼晴 → dayCode=0（provider 日码 45 被替换）',
      W.representativeDayCode(nightFog, '07:15', '18:00', 45) === 0)

    // 2) 全天可信雾 → 仍是雾
    const allFog = []
    for (let i = 0; i < 24; i++) allFog.push(hr(String(i).padStart(2, '0') + ':00', 45, 100, 0.3))
    check('全天可信雾 → dayCode=45', W.representativeDayCode(allFog, '07:00', '18:00', 0) === 45)

    // 3) 缺佐证的雾不参与投票（provider 日码 2 原样回退，证明不是被 45 淹没）
    const dryFog = []
    for (let i = 0; i < 24; i++) dryFog.push(hr(String(i).padStart(2, '0') + ':00', 45, 67, 0.54))
    check('雾码但 RH 67% → 不进 pool，回退 provider 日码 2',
      W.representativeDayCode(dryFog, '07:00', '18:00', 2) === 2)

    // 4) 降水不被众数抹掉：毛毛雨占多数 → 51；一小时阵雪 → 一票否决 85
    const drizzle = []
    for (let i = 8; i <= 18; i++) drizzle.push(hr(String(i).padStart(2, '0') + ':00', 51, 95, 5))
    check('毛毛雨占多数 → dayCode=51', W.representativeDayCode(drizzle, '07:00', '18:00', 51) === 51)
    const snowHour = drizzle.slice(0, 10).concat([hr('18:00', 85, 90, 2)])
    check('窗口内一小时阵雪 → 一票否决 85（不被 10 小时毛毛雨投掉）',
      W.representativeDayCode(snowHour, '07:00', '18:00', 51) === 85)

    // 5) 窗口真正按日出日落切：同一个 06:00 雷暴，日出 07:15 时在窗外、05:00 时在窗内
    const dawnStorm = [hr('06:00', 95, 80, 8)].concat(drizzle)
    check('06:00 雷暴 + 日出 07:15 → 窗口外，不参与', W.representativeDayCode(dawnStorm, '07:15', '18:00', 51) === 51)
    check('06:00 雷暴 + 日出 05:00 → 窗口内，一票否决 95', W.representativeDayCode(dawnStorm, '05:00', '18:00', 51) === 95)
    const noonStorm = [hr('09:00', 95, 80, 8)].concat(drizzle)
    check('缺 sunrise/sunset → 回退 08–18（09:00 雷暴仍在窗内）',
      W.representativeDayCode(noonStorm, '', '', 51) === 95)
    check('缺 sunrise/sunset → 回退 08–18（06:00 雷暴被排除）',
      W.representativeDayCode(dawnStorm, '', '', 51) === 51)

    // 6) 并列取较大码：不替天气说好话
    const tie = [hr('08:00', 0, 50, 20), hr('09:00', 1, 50, 20), hr('10:00', 0, 50, 20), hr('11:00', 1, 50, 20)]
    check('0×2 / 1×2 并列 → 1（多云优先于晴）', W.representativeDayCode(tie, '07:00', '18:00', 0) === 1)

    // 7) fog 真值表（三证缺一不可；Number(null) 陷阱）
    check('fog: 45 / RH 89 / 0.2 km → false', W.fogConfirmed({ code: 45, rh: 89, visibility: 0.2 }) === false)
    check('fog: 45 / RH 90 / 0.9 km → true', W.fogConfirmed({ code: 45, rh: 90, visibility: 0.9 }) === true)
    check('fog: 48 / RH 100 / 0.99 km → true', W.fogConfirmed({ code: 48, rh: 100, visibility: 0.99 }) === true)
    check('fog: 3 / RH 100 / 0.1 km → false（低能见度不等于雾）', W.fogConfirmed({ code: 3, rh: 100, visibility: 0.1 }) === false)
    check('fog: 45 / 湿度缺失 → false', W.fogConfirmed({ code: 45, rh: null, visibility: 0.2 }) === false)
    check('fog: 45 / 能见度缺失 → false', W.fogConfirmed({ code: 45, rh: 95, visibility: null }) === false)
    check('fog: 空对象 → false', W.fogConfirmed({}) === false && W.fogConfirmed(null) === false)

    // 8) hourView 带 fog（逐时 code 不回改）
    const hvFog = W.hourView(['2026-10-28T00:00'], { weather_code: [45], relative_humidity_2m: [95], visibility: [300] }, 0)
    check('hourView: code 仍为 45，fog=true', hvFog.code === 45 && hvFog.fog === true)
    const hvDry = W.hourView(['2026-10-28T00:00'], { weather_code: [45], relative_humidity_2m: [67], visibility: [540] }, 0)
    check('hourView: 干雾小时 code 仍为 45，fog=false', hvDry.code === 45 && hvDry.fog === false)
  }


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
      me0.stats.ongoing === 0 && me0.stats.finished === 0 && me0.stats.organized === 0 && me0.stats.routes === 0
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
    check('me 视图：recent ≤3 且 slim 行带 role（owner）与首个上车点名',
      me1.recent.length === 1 && me1.recent[0].id === actMe && me1.recent[0].role === 'owner'
      && me1.recent[0].pickupName === '茶店子'
      && JSON.stringify(Object.keys(me1.recent[0]).sort()) === JSON.stringify(['id', 'phase', 'pickupName', 'role', 'startAt', 'title']),
      JSON.stringify(me1.recent))
    check('me 视图：stats.routes 计入本人路线（活动发布时沉淀的私有路线也算）',
      me1.stats.routes === 1, JSON.stringify(me1.stats))
    check('me 视图与 home 视图对同一人不互相泄露：me 不带 activityView/routeSnapshot',
      me1.activities === undefined && me1.profile.person.medical !== undefined, '')

    // 路线库计数：本人创建的才算；共享来的不算（与 selectRoutes 的 mine 同口径）
    r = dispatch(st, ME, {
      type: 'route.create',
      input: {
        title: '我的环线', distanceKm: 8.2, ascentM: 320,
        points: [{ id: 'rp-1', name: '起点', kind: 'start', coordinates: null }, { id: 'rp-2', name: '终点', kind: 'finish', coordinates: null }],
        risks: [], track: [{ lat: 30.9, lng: 103.4 }, { lat: 30.91, lng: 103.41 }],
      },
    })
    check('16a 前置：本人创建路线', r.ok, r.error)
    st = r.value.state
    const meRoutes = selectView(st, { userId: ME }, { kind: 'me' }, ctx().now)
    check('me 视图：stats.routes 计入本人新建的路线', meRoutes.stats.routes === 2, JSON.stringify(meRoutes.stats))
    const otherRoutes = selectView(st, { userId: OTHER }, { kind: 'me' }, ctx().now)
    check('me 视图：别人的路线不记在我头上（OTHER 仍 0）', otherRoutes.stats.routes === 0, JSON.stringify(otherRoutes.stats))

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

  section('16 活动图片文件（fileID 白名单与引用计数）')
  const files = require('./domain/files')
  const f1 = 'cloud://env.abc/activity-media/2026-10-21/a.jpg'
  const f2 = 'cloud://env.abc/activity-media/2026-10-21/b.jpg'
  const f3 = 'cloud://env.abc/activity-media/2026-10-21/c.jpg'
  check('fileID 白名单接受 activity-media/ 下的 cloud:// 文件', files.isActivityMediaFileId(f1) === true, f1)
  check('fileID 白名单拒绝头像路径', files.isActivityMediaFileId('cloud://env.abc/avatars/a.jpg') === false, '')
  check('fileID 白名单拒绝 https 外链', files.isActivityMediaFileId('https://example.com/activity-media/a.jpg') === false, '')
  check('fileID 白名单对 null/空值失败关闭', files.isActivityMediaFileId(null) === false && files.isActivityMediaFileId('') === false, '')
  check('旧活动缺 cover/content 时 activityFiles 为空且不抛', files.activityFiles({}).size === 0, '')
  const withImages = { coverFileId: f1, content: [
    { type: 'text', text: '一段正文' },
    { type: 'images', fileIds: [f1, f2] },
    { type: 'images', fileIds: [f2, f3] },
    { type: 'images', fileIds: [] },
    null,
  ] }
  const oneFiles = files.activityFiles(withImages)
  check('activityFiles 去重合并封面与正文图片', oneFiles.size === 3 && oneFiles.has(f1) && oneFiles.has(f2) && oneFiles.has(f3), Array.from(oneFiles))
  const copySharingF2 = { coverFileId: f2, content: [] }
  const all = files.collectActivityFiles({ activities: [withImages, copySharingF2] })
  check('collectActivityFiles 跨活动求并集（copy 共用不误删）', all.size === 3 && all.has(f2), Array.from(all))
  check('collectActivityFiles 对空 state/非数组 activities 失败关闭', files.collectActivityFiles({}).size === 0 && files.collectActivityFiles(null).size === 0, '')
  const removedNone = files.removedActivityFiles({ activities: [withImages] }, { activities: [withImages] })
  check('removedActivityFiles 引用未变 → 空', removedNone.length === 0, removedNone)
  const removedOne = files.removedActivityFiles({ activities: [withImages] }, { activities: [copySharingF2] })
  check('removedActivityFiles 只删无人引用的图（f2 被 copy 保留）',
    removedOne.length === 2 && removedOne.indexOf(f1) !== -1 && removedOne.indexOf(f3) !== -1 && removedOne.indexOf(f2) === -1, removedOne)
  const removedAll = files.removedActivityFiles({ activities: [withImages] }, { activities: [] })
  check('removedActivityFiles 删除活动 → 三张全删', removedAll.length === 3, removedAll)
  check('removedActivityFiles 空 state 不抛', files.removedActivityFiles(null, null).length === 0, '')

  section('17 活动图文：schema/校验/投影')
  const richInput = () => {
    const input = fullActivityInput()
    input.description = '一句话简介'
    input.content = [
      { type: 'text', text: '开篇段落。\n\n第二段，关键词：冰川湖。' },
      { type: 'images', fileIds: ['cloud://env.abc/activity-media/a.jpg', 'cloud://env.abc/activity-media/b.jpg'] },
      { type: 'text', text: '收尾段落。' },
    ]
    input.coverFileId = 'cloud://env.abc/activity-media/b.jpg'
    input.highlights = ['理由一', '理由二']
    input.leader = '陈屿'
    input.minParticipants = 3
    input.sceneryRating = 5
    input.funRating = 3
    input.feeSummary = '498 元/人'
    input.feeIncludes = ['大巴', '住宿']
    input.feeExcludes = ['餐食']
    input.signupNote = '报名后拉群'
    return input
  }
  const baseState = () => {
    const st = emptyState()
    const saved = dispatch(st, LIN, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } })
    return saved.value.state
  }
  let rr = dispatch(baseState(), LIN, { type: 'activity.create', input: richInput() })
  check('带图文的活动可创建', rr.ok, rr.error)
  const richState = rr.value.state
  const richId = rr.value.targetIds[0]
  const richAct = richState.activities[0]
  check('新字段落库', richAct.content.length === 3 && richAct.coverFileId === 'cloud://env.abc/activity-media/b.jpg'
    && richAct.highlights.length === 2 && richAct.leader === '陈屿' && richAct.minParticipants === 3
    && richAct.sceneryRating === 5 && richAct.funRating === 3 && richAct.feeIncludes.length === 2
    && richAct.feeExcludes.length === 1 && richAct.signupNote === '报名后拉群', richAct)
  rr = dispatch(richState, LIN, { type: 'activity.publish', activityId: richId, participation: null })
  check('带图文的活动可发布', rr.ok, rr.error)
  const publishedRich = rr.value.state
  const richDetail = selectView(publishedRich, { userId: LIN }, { kind: 'activity', activityId: richId, perspective: 'participant' }, ctx().now)
  check('detail 视图带正文块', richDetail.kind === 'activity' && Array.isArray(richDetail.activity.content) && richDetail.activity.content.length === 3, richDetail.activity && richDetail.activity.content)
  check('detail 视图封面解析为显式封面', richDetail.activity.coverFileId === 'cloud://env.abc/activity-media/b.jpg', richDetail.activity.coverFileId)
  check('detail 视图带亮点/费用/报名后须知', richDetail.activity.highlights.length === 2 && richDetail.activity.feeIncludes.length === 2 && richDetail.activity.signupNote === '报名后拉群', '')
  const richHome = selectView(publishedRich, { userId: LIN }, { kind: 'home', perspective: 'participant', openedActivityIds: [] }, ctx().now)
  const homeRich = richHome.activities.find(a => a.id === richId)
  check('home 视图不带正文块（避免首页为长文买单）', !!homeRich && homeRich.content === undefined && homeRich.coverFileId === 'cloud://env.abc/activity-media/b.jpg', homeRich && Object.keys(homeRich))
  const richDiscover = selectView(publishedRich, { userId: OWNER }, { kind: 'discover', search: '冰川湖' }, ctx().now)
  check('discover 搜索命中正文文本', richDiscover.activities.some(a => a.id === richId), richDiscover.activities.map(a => a.id))
  const richDiscover2 = selectView(publishedRich, { userId: OWNER }, { kind: 'discover', search: '理由二' }, ctx().now)
  check('discover 搜索命中推荐理由', richDiscover2.activities.some(a => a.id === richId), richDiscover2.activities.map(a => a.id))
  const richDiscover3 = selectView(publishedRich, { userId: OWNER }, { kind: 'discover' }, ctx().now)
  const discoverRich = richDiscover3.activities.find(a => a.id === richId)
  check('discover 视图带解析后的封面', !!discoverRich && discoverRich.coverFileId === 'cloud://env.abc/activity-media/b.jpg', discoverRich && discoverRich.coverFileId)
  const bad = (mutate) => {
    const input = richInput()
    mutate(input)
    return dispatch(baseState(), LIN, { type: 'activity.create', input }).error
  }
  const emptyText = bad(input => { input.content = [{ type: 'text', text: '   ' }] })
  check('空文本块被拒', emptyText && emptyText.code === 'INVALID_INPUT', emptyText)
  const badCover = bad(input => { input.coverFileId = 'cloud://env.abc/activity-media/c.jpg' })
  check('封面不在正文里被拒', badCover && badCover.code === 'INVALID_INPUT', badCover)
  const badPath = bad(input => { input.content[1].fileIds = ['cloud://env.abc/avatars/x.jpg']; input.coverFileId = '' })
  check('非 activity-media 图片被拒', badPath && badPath.code === 'INVALID_INPUT', badPath)
  const dup = bad(input => { input.content[1].fileIds = [input.coverFileId, input.coverFileId] })
  check('重复图片被拒', dup && dup.code === 'INVALID_INPUT', dup)
  const badMin = bad(input => { input.minParticipants = 25 })
  check('成行人数高于上限被拒', badMin && badMin.code === 'INVALID_INPUT', badMin)
  const tooMany = bad(input => {
    input.content = [0, 1, 2].map(n => ({ type: 'images', fileIds: Array.from({ length: 9 }, (_, i) => 'cloud://env.abc/activity-media/n' + n + '-' + i + '.jpg') }))
    input.coverFileId = ''
  })
  check('总图片超过 20 张被拒', tooMany && tooMany.code === 'INVALID_INPUT', tooMany)
  const tooMuchText = bad(input => {
    input.content = Array.from({ length: 11 }, () => ({ type: 'text', text: 'x'.repeat(2000) }))
    input.coverFileId = ''
  })
  check('总文本超过 20000 字被拒', tooMuchText && tooMuchText.code === 'INVALID_INPUT', tooMuchText)
  const badHighlight = bad(input => { input.highlights = [''] })
  check('空推荐理由被拒', badHighlight && badHighlight.code === 'INVALID_INPUT', badHighlight)
  const copyRes = dispatch(publishedRich, LIN, { type: 'activity.copy', sourceActivityId: richId })
  const copied = copyRes.ok ? copyRes.value.state.activities.find(a => a.id === copyRes.value.targetIds[0]) : null
  check('activity.copy 保留正文与封面', !!copied && copied.content.length === 3 && copied.coverFileId === 'cloud://env.abc/activity-media/b.jpg', copied)
  const gathering = dispatch(publishedRich, LIN, { type: 'activity.transition', activityId: richId, next: 'gathering', reason: '' })
  check('发布→集合可推进（无待审核）', gathering.ok, gathering.error)
  const phaseState = gathering.value.state
  const editInput = richInput()
  editInput.acceptingSignups = false
  editInput.routeId = phaseState.activities[0].routeId
  editInput.content = editInput.content.concat([{ type: 'text', text: '集合中补充的一段。' }])
  const editRes = dispatch(phaseState, LIN, { type: 'activity.edit', activityId: richId, input: editInput })
  check('集合中可补图文（新字段不锁）', editRes.ok && editRes.value.state.activities[0].content.length === 4, editRes.error)
  editInput.title = '改标题'
  const lockRes = dispatch(phaseState, LIN, { type: 'activity.edit', activityId: richId, input: editInput })
  check('集合中仍锁标题（新字段未放宽交易键）', !lockRes.ok && lockRes.error.code === 'WRONG_PHASE', lockRes.error)

  console.log('')
  section('18 V3 个人天气计划：CRUD / 分享面 / CAS / 幂等')
  {
    let st = baseState()
    st = dispatch(st, OWNER, { type: 'profile.save', person: { name: '陈屿', phone: '00000000002', emergency: { name: '陈父', phone: '00000000052' }, medical: '' } }).value.state
    const created = dispatch(st, LIN, { type: 'activity.create', input: fullActivityInput() })
    st = created.value.state
    const routeId = st.routes[0].id
    const routePointIds = st.routes[0].points.map(p => p.id)
    check('活动创建时落下的私有路线可作为计划路线', routePointIds.length === 2, routePointIds)

    const basePlan = (patch) => Object.assign({
      routeId, name: '格聂 · 周末两日徒步', startDate: '2026-10-29', sharedWith: [], visibility: 'private',
      stops: [
        { nodeIndex: 0, day: 1, time: '08:00' },
        { nodeIndex: 1, day: 1, time: '13:30' },
        { nodeIndex: 1, day: 2, time: '08:00' },
        { nodeIndex: 0, day: 2, time: '' },
      ],
    }, patch || {})

    const r1 = dispatch(st, LIN, { type: 'plan.create', input: basePlan() })
    check('plan.create ok', r1.ok, r1.error)
    st = r1.value.state
    const planId = r1.value.targetIds[0]
    const plan = st.plans[0]
    check('计划归属 = 当前 actor（与 route.create 同口径）', plan.ownerId === LIN, plan.ownerId)
    check('visibility 由 sharedWith 推导为 private', plan.visibility === 'private' && plan.sharedWith.length === 0, plan)
    check('同一节点可跨天重复（D1/D2 营地为同一 nodeIndex 1）',
      plan.stops.filter(s => s.nodeIndex === 1).length === 2, plan.stops)
    check('time 允许空串 = 待安排（不补 00:00）', plan.stops[3].time === '', plan.stops[3])
    check('updatedAt 是服务端时间戳', plan.updatedAt === ctx().now, plan.updatedAt)

    const reverse = dispatch(st, LIN, { type: 'plan.create', input: basePlan({ stops: [
      { nodeIndex: 0, day: 1, time: '12:00' }, { nodeIndex: 1, day: 1, time: '09:00' },
    ] }) })
    check('同日逆序被拒（INVALID_INPUT）', !reverse.ok && reverse.error.code === 'INVALID_INPUT', reverse.error)
    const outOfRange = dispatch(st, LIN, { type: 'plan.create', input: basePlan({ stops: [{ nodeIndex: 9, day: 1, time: '08:00' }] }) })
    check('节点不在路线上被拒', !outOfRange.ok && outOfRange.error.code === 'INVALID_INPUT', outOfRange.error)
    const missingRoute = dispatch(st, LIN, { type: 'plan.create', input: basePlan({ routeId: 'route-nope' }) })
    check('路线不存在被拒（NOT_FOUND）', !missingRoute.ok && missingRoute.error.code === 'NOT_FOUND', missingRoute.error)
    const emptyName = dispatch(st, LIN, { type: 'plan.create', input: basePlan({ name: '   ' }) })
    check('空计划名被拒', !emptyName.ok && emptyName.error.code === 'INVALID_INPUT', emptyName.error)
    const badDate = dispatch(st, LIN, { type: 'plan.create', input: basePlan({ startDate: '2026/10/29' }) })
    check('出发日期格式被拒', !badDate.ok && badDate.error.code === 'INVALID_INPUT', badDate.error)
    check('被拒请求零落库（仍只有 1 个计划）', st.plans.length === 1, st.plans.length)

    // 幂等：同 requestId 同内容 → replayed，不产生第二个计划
    const reqId = 'req-plan-idem'
    const fingerprint = fp({ type: 'plan.create', input: basePlan({ name: '复制计划' }) })
    const reply1 = reduceCommand(st, { actor: { userId: LIN }, requestId: reqId, expectedRevision: st.revision, fingerprint, payload: { type: 'plan.create', input: basePlan({ name: '复制计划' }) } }, ctx())
    const reply2 = reduceCommand(reply1.value.state, { actor: { userId: LIN }, requestId: reqId, expectedRevision: reply1.value.state.revision, fingerprint, payload: { type: 'plan.create', input: basePlan({ name: '复制计划' }) } }, ctx())
    check('同 requestId 重放 → replayed=true', reply2.ok && reply2.value.replayed === true, reply2.error)
    check('重放不产生第二个计划', reply2.value.state.plans.filter(p => p.name === '复制计划').length === 1, reply2.value.state.plans.length)
    st = reply1.value.state
    const planId2 = reply1.value.targetIds[0]

    // CAS：陈旧版本写入必须 CONFLICT 且零副作用
    const stale = reduceCommand(st, { actor: { userId: LIN }, requestId: genId('req'), expectedRevision: 0, fingerprint: fp({ type: 'plan.update', planId, input: basePlan({ name: '陈旧写' }) }), payload: { type: 'plan.update', planId, input: basePlan({ name: '陈旧写' }) } }, ctx())
    check('陈旧 expectedRevision → CONFLICT', !stale.ok && stale.error.code === 'CONFLICT', stale.error)

    // 分享：sharedWith 全量替换 → visibility 派生
    const share = dispatch(st, LIN, { type: 'plan.update', planId, input: basePlan({ sharedWith: [OWNER, OWNER, LIN], visibility: 'private' }) })
    check('分享写入成功', share.ok, share.error)
    st = share.value.state
    const sharedPlan = st.plans.find(p => p.id === planId)
    check('sharedWith 去重并剔除自己', sharedPlan.sharedWith.length === 1 && sharedPlan.sharedWith[0] === OWNER, sharedPlan.sharedWith)
    check('客户端提交的 private 被忽略，visibility 由名单推导为 shared',
      sharedPlan.visibility === 'shared', sharedPlan.visibility)

    const ownView = selectView(st, { userId: LIN }, { kind: 'plans' }, ctx().now)
    const sharedView = selectView(st, { userId: OWNER }, { kind: 'plans' }, ctx().now)
    const thirdView = selectView(st, { userId: 'o-stranger' }, { kind: 'plans' }, ctx().now)
    check('owner 读视图列出自己的计划', ownView.plans.some(p => p.id === planId), ownView.plans.map(p => p.id))
    check('被授权者读视图可见', sharedView.plans.some(p => p.id === planId), sharedView.plans.map(p => p.id))
    check('无关账号看不到（不是"列表里有但标灰"）', !thirdView.plans.some(p => p.id === planId), thirdView.plans.map(p => p.id))
    const sharedRow = sharedView.plans.find(p => p.id === planId)
    check('被授权者 isOwner=false 且 sharedBy 为所有者显示名',
      sharedRow.isOwner === false && sharedRow.sharedBy === '林溪', sharedRow)
    check('读视图不回传 ownerId / sharedWith 原文',
      sharedRow.ownerId === undefined && sharedRow.sharedWith === undefined
      && JSON.stringify(sharedView).indexOf(LIN) === -1 && JSON.stringify(sharedView).indexOf(OWNER) === -1,
      Object.keys(sharedRow))
    check('未登录读 plans → denied AUTH_REQUIRED',
      selectView(st, { userId: null }, { kind: 'plans' }, ctx().now).kind === 'denied'
      && selectView(st, { userId: null }, { kind: 'plans' }, ctx().now).code === 'AUTH_REQUIRED', '')

    // 被授权者：只读。update/delete 均 FORBIDDEN 且零副作用
    const pristine = JSON.stringify(st)
    const hackUpdate = dispatch(st, OWNER, { type: 'plan.update', planId, input: basePlan({ name: '越权改名' }) })
    check('被授权者 plan.update → FORBIDDEN', !hackUpdate.ok && hackUpdate.error.code === 'FORBIDDEN', hackUpdate.error)
    const hackDelete = dispatch(st, OWNER, { type: 'plan.delete', planId })
    check('被授权者 plan.delete → FORBIDDEN', !hackDelete.ok && hackDelete.error.code === 'FORBIDDEN', hackDelete.error)
    check('越权尝试零副作用（state 逐字节未变）', JSON.stringify(st) === pristine, '')

    // 复制为独立计划：被授权者读 → create，owner = 复制者，原计划不动
    const copy = dispatch(st, OWNER, { type: 'plan.create', input: basePlan({ name: '格聂 · 周末两日徒步（副本）', sharedWith: [] }) })
    check('被授权者可复制为独立计划', copy.ok, copy.error)
    const copiedState = copy.value.state
    const copiedPlan = copiedState.plans.find(p => p.id === copy.value.targetIds[0])
    check('副本 owner = 复制者', copiedPlan.ownerId === OWNER, copiedPlan.ownerId)
    check('副本不覆盖原计划', copiedState.plans.filter(p => p.id === planId).length === 1
      && copiedState.plans.find(p => p.id === planId).ownerId === LIN, '')

    // 取消分享：sharedWith 清空后立即不可读
    const unshare = dispatch(copiedState, LIN, { type: 'plan.update', planId, input: basePlan({ sharedWith: [] }) })
    check('取消分享写入成功', unshare.ok, unshare.error)
    const afterUnshare = unshare.value.state
    const ownerAfter = selectView(afterUnshare, { userId: OWNER }, { kind: 'plans' }, ctx().now)
    check('取消分享后被授权者立即不可读', !ownerAfter.plans.some(p => p.id === planId), ownerAfter.plans.map(p => p.id))
    check('取消分享后 visibility 回到 private',
      afterUnshare.plans.find(p => p.id === planId).visibility === 'private', '')

    // 删除：owner 可删；他人删已被拒
    const del = dispatch(afterUnshare, LIN, { type: 'plan.delete', planId: planId2 })
    check('owner 可删除计划', del.ok && !del.value.state.plans.some(p => p.id === planId2), del.error)
    const delMissing = dispatch(del.value.state, LIN, { type: 'plan.delete', planId: 'plan-nope' })
    check('删除不存在的计划 → NOT_FOUND', !delMissing.ok && delMissing.error.code === 'NOT_FOUND', delMissing.error)
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

run()
