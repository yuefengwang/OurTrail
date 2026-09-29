// domain 层本地冒烟测试：不依赖 wx-server-sdk，直接跑 reduce + invariants。
// 运行：node smoke-test.js
'use strict'

const { reduceCommand, genId } = require('./domain/commands')
const { assertInvariants } = require('./domain/invariants')
const { selectView, selectTransport, getDetailState } = require('./domain/selectors')
const { planAssignments } = require('./domain/allocation')
const { canonicalPayload } = require('./domain/contracts')
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

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

run()
