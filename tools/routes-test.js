// V2 路线库切片一：路线资产生命周期（route.create/update/delete + readRoutes 投影）。
// 运行：node tools/routes-test.js
// 口径：所有 fixture 都经真实命令建立（不手工拼 State）；被拒的命令必须零副作用；
// 读取投影的缺省值（旧路线没有资产级字段）单独钉死——那是存量数据的唯一读法。
'use strict'

const crypto = require('crypto')
const S = require('../cloudfunctions/trailApi/domain/schema')
const { reduceCommand, genId } = require('../cloudfunctions/trailApi/domain/commands')
const { assertInvariants } = require('../cloudfunctions/trailApi/domain/invariants')
const { canExecute } = require('../cloudfunctions/trailApi/domain/permissions')
const { selectRoutes } = require('../cloudfunctions/trailApi/domain/selectors')
const { canonicalPayload, deepClone } = require('../cloudfunctions/trailApi/domain/contracts')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const NOW = '2026-10-13T07:00:00+08:00'
const ctx = (now) => ({ now: now || NOW, id: genId })
const fp = payload => crypto.createHash('sha256').update(canonicalPayload(payload), 'utf8').digest('hex')

function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: NOW,
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
}

function dispatch(state, actor, payload, requestId, at) {
  return reduceCommand(state, {
    actor: { userId: actor }, requestId: requestId || genId('req'),
    expectedRevision: state.revision, fingerprint: fp(payload), payload,
  }, ctx(at))
}

const A = 'openid-a'
const B = 'openid-b'
const C = 'openid-c'

function saveProfile(state, userId, name) {
  const r = dispatch(state, userId, {
    type: 'profile.save',
    person: { name, phone: '0000000000' + userId.slice(-1), emergency: { name: '家属', phone: '00000000009' }, medical: '' },
  })
  if (!r.ok) throw new Error('profile.save failed: ' + JSON.stringify(r.error))
  return r.value.state
}

function routeInput(over) {
  return Object.assign({
    title: '青城后山环线', distanceKm: 12.8, ascentM: 680,
    points: [
      { id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 } },
      { id: 'pt-2', name: '又一村', kind: 'checkpoint', coordinates: null, ele: 920 },
      { id: 'pt-3', name: '终点', kind: 'finish', coordinates: null },
    ],
    risks: [{ id: 'rk-1', title: '湿滑', advice: '防滑鞋' }],
    track: [{ lat: 30.93, lng: 103.48 }, { lat: 30.94, lng: 103.49 }],
  }, over || {})
}

function fullActivityInput(routeId) {
  return {
    title: '周末走山', description: '轻徒步', organizerIntro: '阿秋带队',
    startAt: '2026-10-20T08:00:00+08:00', endAt: '2026-10-20T18:00:00+08:00', deadlineAt: '2026-10-19T20:00:00+08:00',
    acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: routeId || null,
    routeSnapshot: {
      title: '青城后山环线', distanceKm: 12.8, ascentM: 680,
      points: [{ id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 } }],
      risks: [{ id: 'rk-1', title: '湿滑', advice: '防滑鞋' }],
    },
    pickupPoints: [{ id: 'pk-1', name: '茶店子', meetingAt: '2026-10-20T07:00:00+08:00', address: '地铁口', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }
}

function run() {
  /* ---------- 1. 创建与缺省值 ---------- */
  section('1. route.create：落库、缺省值与校验')
  let state = emptyState()
  state = saveProfile(state, A, '阿秋')
  state = saveProfile(state, B, '林溪')
  state = saveProfile(state, C, '陈屿')

  let r = dispatch(state, A, { type: 'route.create', input: routeInput() })
  check('route.create ok', r.ok, r.error)
  state = r.value.state
  const routeA = state.routes[0]
  check('ownerId = actor', routeA.ownerId === A)
  check('updatedAt = 服务端时间', routeA.updatedAt === NOW)
  check('source 缺省 manual', routeA.source === 'manual')
  check('visibility 缺省 private', routeA.visibility === 'private')
  check('sharedWith 缺省空数组', Array.isArray(routeA.sharedWith) && routeA.sharedWith.length === 0)
  check('不变量通过', assertInvariants(state).ok)
  check('revision = 3 档案 + 1 路线', state.revision === 4)

  r = dispatch(state, A, { type: 'route.create', input: routeInput({ title: '  ' }) })
  check('空标题被拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
  r = dispatch(state, A, { type: 'route.create', input: routeInput({ points: [{ id: 'p', name: 'x', kind: 'start', coordinates: null }, { id: 'p', name: 'y', kind: 'finish', coordinates: null }] }) })
  check('节点 id 重复被拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
  r = dispatch(state, A, { type: 'route.create', input: Object.assign(routeInput(), { hack: 1 }) })
  check('schema 严格：多余键被拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
  r = dispatch(state, A, { type: 'route.create', input: routeInput({ source: 'bogus' }) })
  check('source 枚举外取值被拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
  r = dispatch(state, A, { type: 'route.create', input: routeInput({ distanceKm: -1 }) })
  check('负距离被拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
  // 服务端时间戳不可提交：updatedAt 不在 RouteInput 里，伪造即严格 schema 的多余键
  r = dispatch(state, A, { type: 'route.create', input: routeInput({ updatedAt: '2020-01-01T00:00:00+08:00' }) })
  check('伪造 updatedAt 被拒（服务端时间客户端不可提交）', !r.ok && r.error.code === 'INVALID_INPUT', r.error)

  /* ---------- 2. 共享名单 ---------- */
  section('2. 共享：名单归一、派生 visibility、越权拒读')
  r = dispatch(state, A, {
    type: 'route.create',
    input: routeInput({ title: '共享路线', sharedWith: [B, B, A] }),
  })
  check('带名单创建 ok', r.ok, r.error)
  state = r.value.state
  const shared = state.routes.find(x => x.title === '共享路线')
  check('sharedWith 去重且剔除自己', shared.sharedWith.length === 1 && shared.sharedWith[0] === B)
  check('visibility 派生为 shared', shared.visibility === 'shared')

  r = dispatch(state, A, { type: 'route.create', input: routeInput({ title: '坏名单', sharedWith: ['openid-ghost'] }) })
  check('共享给不存在的账号被不变量拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)

  // 未登录
  check('未登录 canExecute → AUTH_REQUIRED', canExecute(state, { userId: null }, { type: 'route.create', input: routeInput() }, NOW).error.code === 'AUTH_REQUIRED')

  /* ---------- 3. 编辑 ---------- */
  section('3. route.update：归属、全量替换、幂等')
  const before = JSON.stringify(state)
  r = dispatch(state, C, { type: 'route.update', routeId: routeA.id, input: routeInput({ title: '篡改' }) })
  check('他人编辑被拒 FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
  r = dispatch(state, A, { type: 'route.update', routeId: 'route-nope', input: routeInput() })
  check('编辑不存在的路线 NOT_FOUND', !r.ok && r.error.code === 'NOT_FOUND', r.error)
  check('被拒命令零副作用', JSON.stringify(state) === before)

  r = dispatch(state, A, { type: 'route.update', routeId: routeA.id, input: routeInput({ title: '青城前山', ascentM: 900, source: 'gpx' }) })
  check('owner 编辑 ok', r.ok, r.error)
  state = r.value.state
  check('标题已更新', state.routes.find(x => x.id === routeA.id).title === '青城前山')
  check('source 可改', state.routes.find(x => x.id === routeA.id).source === 'gpx')
  check('updatedAt 刷新', state.routes.find(x => x.id === routeA.id).updatedAt === NOW)

  // 全量替换：不带 sharedWith ⇒ 清空（与 activity.edit 的全量语义一致）
  r = dispatch(state, A, { type: 'route.update', routeId: shared.id, input: routeInput({ title: '收回共享' }) })
  state = r.value.state
  check('全量替换清空名单', state.routes.find(x => x.id === shared.id).sharedWith.length === 0)
  check('visibility 同步回落 private', state.routes.find(x => x.id === shared.id).visibility === 'private')

  // 幂等：同 requestId + 同 fingerprint ⇒ replayed，状态不动
  const reqId = 'req-idem-1'
  const payload = { type: 'route.update', routeId: routeA.id, input: routeInput({ title: '幂等标题' }) }
  r = dispatch(state, A, payload, reqId)
  check('首次更新 ok', r.ok && !r.value.replayed, r.error)
  state = r.value.state
  const snapshot = JSON.stringify(state)
  r = dispatch(state, A, deepClone(payload), reqId)
  check('同 requestId 重放 replayed', r.ok && r.value.replayed === true, r.error)
  check('重放后状态逐字节相同', JSON.stringify(state) === snapshot)
  r = dispatch(state, A, { type: 'route.update', routeId: routeA.id, input: routeInput({ title: '另一份内容' }) }, reqId)
  check('同 requestId 不同内容 → REQUEST_REUSED', !r.ok && r.error.code === 'REQUEST_REUSED', r.error)

  // revision CAS
  r = reduceCommand(state, { actor: { userId: A }, requestId: genId('req'), expectedRevision: state.revision + 5, fingerprint: fp({ type: 'route.create', input: routeInput() }), payload: { type: 'route.create', input: routeInput() } }, ctx())
  check('错误 revision → CONFLICT', !r.ok && r.error.code === 'CONFLICT', r.error)

  /* ---------- 4. 删除 ---------- */
  section('4. route.delete：归属与引用保护')
  r = dispatch(state, A, { type: 'route.create', input: routeInput({ title: '待删路线' }) })
  state = r.value.state
  const delId = state.routes.find(x => x.title === '待删路线').id
  r = dispatch(state, C, { type: 'route.delete', routeId: delId })
  check('他人删除被拒', !r.ok && r.error.code === 'FORBIDDEN', r.error)
  r = dispatch(state, A, { type: 'route.delete', routeId: 'route-nope' })
  check('删除不存在 NOT_FOUND', !r.ok && r.error.code === 'NOT_FOUND', r.error)
  r = dispatch(state, A, { type: 'route.delete', routeId: delId })
  check('owner 删除 ok', r.ok, r.error)
  state = r.value.state
  check('路线已移除', !state.routes.some(x => x.id === delId))

  // 引用保护：活动用了这条路线就不能删
  r = dispatch(state, A, { type: 'activity.create', input: fullActivityInput(routeA.id) })
  check('带 routeId 建活动 ok', r.ok, r.error)
  state = r.value.state
  const activityId = r.value.targetIds[0]
  check('活动快照取入参里的副本（域不代抄路线）', state.activities.find(a => a.id === activityId).routeSnapshot.title === '青城后山环线')
  r = dispatch(state, A, { type: 'route.delete', routeId: routeA.id })
  check('被引用的路线删除 → CONFLICT', !r.ok && r.error.code === 'CONFLICT', r.error)
  check('CONFLICT 文案含活动数', r.error && r.error.message.indexOf('1 个活动') !== -1, r.error)
  // 删路线不影响已建活动
  r = dispatch(state, A, { type: 'route.update', routeId: routeA.id, input: routeInput({ title: '再次改名' }) })
  state = r.value.state
  check('改路线不动活动快照', state.activities.find(a => a.id === activityId).routeSnapshot.title === '青城后山环线')

  /* ---------- 5. 读取投影 ---------- */
  section('5. readRoutes：列表 / 单条 / 权限 / 旧路线缺省')
  // 让 A 把一条路线共享给 B（时钟拨到 08:00 ⇒ 共享路线 updatedAt 最新，列表必须排最前）
  r = dispatch(state, A, { type: 'route.update', routeId: shared.id, input: routeInput({ title: '共享给林溪', sharedWith: [B] }) }, null, '2026-10-13T08:00:00+08:00')
  state = r.value.state

  let list = selectRoutes(state, { userId: A }, null)
  check('A 的列表 ok', list.ok, list.error)
  check('A 看到 2 条（1 条已删）', list.value.routes.length === 2, list.value.routes.map(x => x.title))
  check('列表项是Owner视角', list.value.routes.every(x => x.isOwner === true))
  check('列表按 updatedAt 倒序', list.value.routes[0].title === '共享给林溪', list.value.routes.map(x => [x.title, x.updatedAt]))
  check('列表含引用计数', list.value.routes.find(x => x.id === routeA.id).referencedCount === 1)

  list = selectRoutes(state, { userId: B }, null)
  check('B 只看到共享的那条', list.value.routes.length === 1 && list.value.routes[0].title === '共享给林溪', list.value.routes.map(x => x.title))
  check('B 视角 isOwner=false', list.value.routes[0].isOwner === false)

  list = selectRoutes(state, { userId: C }, null)
  check('C 看不到任何路线', list.value.routes.length === 0)

  let one = selectRoutes(state, { userId: B }, shared.id)
  check('B 可读共享路线', one.ok, one.error)
  check('B 读不到 sharedWith 名单', one.value.route.sharedWith === undefined)
  one = selectRoutes(state, { userId: C }, shared.id)
  check('C 读共享路线 FORBIDDEN', !one.ok && one.error.code === 'FORBIDDEN', one.error)
  one = selectRoutes(state, { userId: A }, 'route-nope')
  check('单条不存在 NOT_FOUND', !one.ok && one.error.code === 'NOT_FOUND', one.error)
  one = selectRoutes(state, { userId: null }, null)
  check('未登录读取 AUTH_REQUIRED', !one.ok && one.error.code === 'AUTH_REQUIRED', one.error)
  one = selectRoutes(state, { userId: A }, routeA.id)
  check('单条含引用活动 id', one.value.referencedActivityIds.length === 1 && one.value.referencedActivityIds[0] === activityId)
  check('单条投影 points 带 ele/不带 time', one.value.route.points[1].ele === 920 && one.value.route.points[1].time === undefined)

  /* ---------- 6. 旧路线（快照副产品）缺省读法 ---------- */
  section('6. 旧路线：persistPrivateRoute 产物无资产级字段')
  // 不带 routeId 建活动 ⇒ 快照深克隆成路线（没有 updatedAt/source/visibility/sharedWith 键）
  r = dispatch(state, A, { type: 'activity.create', input: fullActivityInput(null) })
  state = r.value.state
  const legacy = state.routes.find(x => x.updatedAt === undefined)
  check('旧路线存在且无新字段', !!legacy && legacy.source === undefined && legacy.sharedWith === undefined)
  check('含旧路线的状态仍过不变量', assertInvariants(state).ok)
  one = selectRoutes(state, { userId: A }, legacy.id)
  check('旧路线可读', one.ok, one.error)
  check('旧路线 source 读作 copy', one.value.route.source === 'copy')
  check('旧路线 visibility 读作 private', one.value.route.visibility === 'private')
  check('旧路线 updatedAt 读作 null', one.value.route.updatedAt === null)
  check('旧路线对 owner 也给 sharedWith 空数组', Array.isArray(one.value.route.sharedWith) && one.value.route.sharedWith.length === 0)
  // 旧路线也能被编辑（update 会补齐资产级字段）
  r = dispatch(state, A, { type: 'route.update', routeId: legacy.id, input: routeInput({ title: '旧路新编' }) })
  check('旧路线可编辑', r.ok, r.error)
  state = r.value.state
  check('编辑后补齐资产级字段', state.routes.find(x => x.id === legacy.id).source === 'manual' && state.routes.find(x => x.id === legacy.id).visibility === 'private')

  /* ---------- 7. 汇总 ---------- */
  console.log('')
  console.log('routes-test: passed=' + passed + ' failed=' + failed)
  if (failed > 0) process.exitCode = 1
}

run()
