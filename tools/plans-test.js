// 个人天气计划（ot_plans）门禁：CRUD / owner 双层授权 / 分享面 / CAS / 幂等 / 投影白名单。
// 运行：node tools/plans-test.js
//
// 判据来源：实施文档 §8 与 §10.2（plans-test）。领域层直接跑 reduce + invariants（无需 wx-server-sdk）。
// 分享面四条是承重判据（§1.1.1 缺一即视为未完成）：
//   ① 被授权者只读（update/delete 均 FORBIDDEN）
//   ② 取消分享后立即不可读
//   ③ visibility 与 sharedWith 不允许矛盾态
//   ④ 列表不泄漏他人身份码
'use strict'
const path = require('path')
const crypto = require('crypto')
const { reduceCommand, genId } = require(path.join(__dirname, '..', 'cloudfunctions', 'trailApi', 'domain', 'commands'))
const { handlePlans } = require(path.join(__dirname, '..', 'cloudfunctions', 'trailApi', 'domain', 'plans'))
const { selectView } = require(path.join(__dirname, '..', 'cloudfunctions', 'trailApi', 'domain', 'selectors'))
const { canonicalPayload, deepClone } = require(path.join(__dirname, '..', 'cloudfunctions', 'trailApi', 'domain', 'contracts'))

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; return }
  failed++
  console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
function section(t) { console.log('\n§ ' + t) }

const ctx = () => ({ now: '2026-10-27T09:00:00+08:00', id: genId })
const fp = p => crypto.createHash('sha256').update(canonicalPayload(p), 'utf8').digest('hex')

function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: '2026-10-27T09:00:00+08:00',
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
const FRIEND = 'o-friend-openid'
const STRANGER = 'o-stranger-openid'

function seed() {
  let st = emptyState()
  st = dispatch(st, OWNER, { type: 'profile.save', person: { name: '陈屿', phone: '00000000002', emergency: { name: '陈父', phone: '00000000052' }, medical: '' } }).value.state
  st = dispatch(st, FRIEND, { type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } }).value.state
  // 路线：两条，用来测「节点越界」与「计划引用不存在的路线」
  const routeInput = (points) => ({
    title: '格聂两日路线', distanceKm: 19.2, ascentM: 1100,
    points: points.map((p, i) => ({ id: 'pt-' + i, name: p, kind: i === 0 ? 'start' : i === points.length - 1 ? 'finish' : 'checkpoint', coordinates: { lat: 29.8 + i * 0.01, lng: 99.7 + i * 0.01 } })),
    risks: [],
  })
  const r1 = dispatch(st, OWNER, { type: 'route.create', input: routeInput(['山谷起点', '观景点', '溪畔营地', '北侧垭口', '下撤终点']) })
  st = r1.value.state
  return { state: st, routeId: r1.value.targetIds[0] }
}

function planInput(routeId, patch) {
  return Object.assign({
    routeId, name: '格聂 · 周末两日徒步', startDate: '2026-10-29', sharedWith: [], visibility: 'private',
    stops: [
      { nodeIndex: 0, day: 1, time: '08:00' },
      { nodeIndex: 1, day: 1, time: '13:30' },
      { nodeIndex: 2, day: 1, time: '17:00' },
      { nodeIndex: 2, day: 2, time: '08:00' },
      { nodeIndex: 3, day: 2, time: '11:00' },
    ],
  }, patch || {})
}

/* ------------------------------------------------------------------ */
section('§1 CRUD 与归属')

const seeded = seed()
let state = seeded.state
const ROUTE = seeded.routeId

{
  const r = dispatch(state, OWNER, { type: 'plan.create', input: planInput(ROUTE) })
  check('plan.create 成功', r.ok, r.error)
  state = r.value.state
  const plan = state.plans[0]
  check('ownerId = 当前 actor（与 route.create 同口径）', plan.ownerId === OWNER, plan.ownerId)
  check('默认 private 且名单为空', plan.visibility === 'private' && plan.sharedWith.length === 0)
  check('updatedAt 是服务端时间戳（客户端不可提交）', plan.updatedAt === ctx().now, plan.updatedAt)
  check('跨天重复同一节点被接受（D1/D2 同营地）',
    plan.stops.filter(s => s.nodeIndex === 2).length === 2, plan.stops)
  check('空时间 = 待安排，被原样保存（不补 00:00）', (() => {
    const r2 = dispatch(state, OWNER, { type: 'plan.create', input: planInput(ROUTE, { name: '待安排测试', stops: [{ nodeIndex: 0, day: 1, time: '' }] }) })
    return r2.ok && r2.value.state.plans.filter(p => p.name === '待安排测试')[0].stops[0].time === ''
  })())
}

/* ------------------------------------------------------------------ */
section('§2 输入校验（写入端，不进全域 invariants）')

{
  const bad = (patch) => dispatch(state, OWNER, { type: 'plan.create', input: planInput(ROUTE, patch) })
  check('同日逆序被拒', (() => { const r = bad({ stops: [{ nodeIndex: 0, day: 1, time: '12:00' }, { nodeIndex: 1, day: 1, time: '09:00' }] }); return !r.ok && r.error.code === 'INVALID_INPUT' })())
  check('逆序文案指出第几天', (() => { const r = bad({ stops: [{ nodeIndex: 0, day: 2, time: '12:00' }, { nodeIndex: 1, day: 2, time: '09:00' }] }); return !r.ok && r.error.message.indexOf('第 2 天') !== -1 })())
  check('节点越界被拒', (() => { const r = bad({ stops: [{ nodeIndex: 9, day: 1, time: '' }] }); return !r.ok && r.error.code === 'INVALID_INPUT' })())
  check('不存在的路线 → NOT_FOUND', (() => { const r = bad({ routeId: 'route-nope' }); return !r.ok && r.error.code === 'NOT_FOUND' })())
  check('空名称被拒', (() => { const r = bad({ name: '   ' }); return !r.ok && r.error.code === 'INVALID_INPUT' })())
  check('出发日期必须是 YYYY-MM-DD', (() => { const r = bad({ startDate: '2026/10/29' }); return !r.ok && r.error.code === 'INVALID_INPUT' })())
  check('time 必须是 HH:mm 或空串', (() => { const r = bad({ stops: [{ nodeIndex: 0, day: 1, time: '8:00' }] }); return !r.ok && r.error.code === 'INVALID_INPUT' })())
  check('day 只能 1..7（schema 层）', (() => { const r = bad({ stops: [{ nodeIndex: 0, day: 8, time: '' }] }); return !r.ok && r.error.code === 'INVALID_INPUT' })())
  check('被拒请求没有落库', state.plans.every(p => p.name !== '格聂 · 周末两日徒步' || p.stops.length === 5))
}

/* ------------------------------------------------------------------ */
section('§3 版本与幂等')

{
  const p = planInput(ROUTE)
  const reqId = 'req-plan-replay'
  const r1 = reduceCommand(state, { actor: { userId: OWNER }, requestId: reqId, expectedRevision: state.revision, fingerprint: fp({ type: 'plan.create', input: p }), payload: { type: 'plan.create', input: p } }, ctx())
  check('首次写入 ok', r1.ok, r1.error)
  const r2 = reduceCommand(r1.value.state, { actor: { userId: OWNER }, requestId: reqId, expectedRevision: r1.value.state.revision, fingerprint: fp({ type: 'plan.create', input: p }), payload: { type: 'plan.create', input: p } }, ctx())
  check('同 requestId 同内容重放 → replayed（不再写第二份）',
    r2.ok && r2.value.replayed === true && r2.value.state.plans.length === r1.value.state.plans.length, r2.error)
  const r3 = reduceCommand(r1.value.state, { actor: { userId: OWNER }, requestId: reqId, expectedRevision: r1.value.state.revision, fingerprint: 'f'.repeat(64), payload: { type: 'plan.create', input: planInput(ROUTE, { name: '另一份' }) } }, ctx())
  check('同 requestId 不同内容 → REQUEST_REUSED', !r3.ok && r3.error.code === 'REQUEST_REUSED', r3.error)
  check('陈旧 expectedRevision → CONFLICT', !(() => {
    const r = reduceCommand(state, { actor: { userId: OWNER }, requestId: genId('req'), expectedRevision: 0, fingerprint: fp({ type: 'plan.create', input: planInput(ROUTE) }), payload: { type: 'plan.create', input: planInput(ROUTE) } }, ctx())
    return r.ok
  })())
}

/* ------------------------------------------------------------------ */
section('§4 owner 双层授权')

{
  const created = dispatch(state, OWNER, { type: 'plan.create', input: planInput(ROUTE) })
  state = created.value.state
  const planId = created.value.targetIds[0]
  const pristine = JSON.stringify(state)

  const upd = dispatch(state, FRIEND, { type: 'plan.update', planId, input: planInput(ROUTE, { name: '越权改名' }) })
  check('他人 plan.update → FORBIDDEN（第一层 canExecute）', !upd.ok && upd.error.code === 'FORBIDDEN', upd.error)
  const del = dispatch(state, FRIEND, { type: 'plan.delete', planId })
  check('他人 plan.delete → FORBIDDEN', !del.ok && del.error.code === 'FORBIDDEN', del.error)
  check('越权尝试零副作用（state 逐字节相同）', JSON.stringify(state) === pristine, '')

  // 第二层：绕过 canExecute 直调 handler
  const cmd = { actor: { userId: FRIEND }, requestId: genId('req'), expectedRevision: state.revision, fingerprint: '0'.repeat(64), payload: { type: 'plan.update', planId, input: planInput(ROUTE, { name: '直调改名' }) } }
  const direct = handlePlans(deepClone(state), cmd, ctx())
  check('直调 handler 仍 FORBIDDEN（第二层独立成立）', !direct.ok && direct.error.code === 'FORBIDDEN', direct.error)
  check('handler 层拒绝文案是计划口径（不是 canExecute 的通用文案）',
    !direct.ok && String(direct.error.message).indexOf('只有计划创建者') === 0, direct.error && direct.error.message)
  const okDirect = handlePlans(deepClone(state), Object.assign({}, cmd, { actor: { userId: OWNER } }), ctx())
  check('owner 直调 handler → ok（第二层不误伤正当写入）', okDirect.ok === true, okDirect.error)
}

/* ------------------------------------------------------------------ */
section('§5 分享面（四条承重）')

{
  const created = dispatch(state, OWNER, { type: 'plan.create', input: planInput(ROUTE, { name: '共享测试' }) })
  state = created.value.state
  const planId = created.value.targetIds[0]

  // ① 名单去重、剔除自己；visibility 派生
  const share = dispatch(state, OWNER, { type: 'plan.update', planId, input: planInput(ROUTE, { name: '共享测试', sharedWith: [FRIEND, FRIEND, OWNER], visibility: 'private' }) })
  check('分享写入成功', share.ok, share.error)
  state = share.value.state
  const plan = state.plans.find(p => p.id === planId)
  check('sharedWith 去重并剔除 owner 自己', plan.sharedWith.length === 1 && plan.sharedWith[0] === FRIEND, plan.sharedWith)
  check('客户端提交的 private 被忽略（visibility 由名单推导）', plan.visibility === 'shared', plan.visibility)

  const ownerView = selectView(state, { userId: OWNER }, { kind: 'plans' }, ctx().now)
  const friendView = selectView(state, { userId: FRIEND }, { kind: 'plans' }, ctx().now)
  const strangerView = selectView(state, { userId: STRANGER }, { kind: 'plans' }, ctx().now)
  const row = friendView.plans.find(p => p.id === planId)
  check('owner 可见', ownerView.plans.some(p => p.id === planId))
  check('被授权者可见', !!row)
  check('无关账号不可见', !strangerView.plans.some(p => p.id === planId))
  check('被授权者 isOwner=false 且 sharedBy 是显示名', row.isOwner === false && row.sharedBy === '陈屿', row)
  check('被授权者拿不到 sharedWith 名单', row.sharedWith === undefined, Object.keys(row))
  check('读视图永不带 ownerId', friendView.plans.every(p => p.ownerId === undefined))
  check('共享视图里不出现任何身份码原文',
    JSON.stringify(friendView).indexOf(OWNER) === -1 && JSON.stringify(friendView).indexOf(FRIEND) === -1, '')
  check('owner 拿得到名单（逐个取消分享的 UI 需要它，与 routeView 同一条界线）',
    Array.isArray(ownerView.plans.find(p => p.id === planId).sharedWith), '')

  // ① 被授权者只读
  const hack = dispatch(state, FRIEND, { type: 'plan.update', planId, input: planInput(ROUTE, { name: '共享后越权改' }) })
  check('被授权者 plan.update → FORBIDDEN', !hack.ok && hack.error.code === 'FORBIDDEN', hack.error)
  const hackDel = dispatch(state, FRIEND, { type: 'plan.delete', planId })
  check('被授权者 plan.delete → FORBIDDEN', !hackDel.ok && hackDel.error.code === 'FORBIDDEN', hackDel.error)

  // 复制为独立计划：被授权者读 → create，owner 变成复制者
  const copy = dispatch(state, FRIEND, { type: 'plan.create', input: planInput(ROUTE, { name: '共享测试（副本）', sharedWith: [] }) })
  check('被授权者可复制为独立计划', copy.ok, copy.error)
  const copyRow = copy.value.state.plans.find(p => p.id === copy.value.targetIds[0])
  check('副本 owner = 复制者', copyRow.ownerId === FRIEND, copyRow.ownerId)
  check('原计划未被覆盖（owner/名称都在）',
    copy.value.state.plans.find(p => p.id === planId).ownerId === OWNER, '')
  state = copy.value.state

  // ② 取消分享后立即不可读
  const unshare = dispatch(state, OWNER, { type: 'plan.update', planId, input: planInput(ROUTE, { name: '共享测试', sharedWith: [] }) })
  check('取消分享写入成功', unshare.ok, unshare.error)
  state = unshare.value.state
  check('取消分享后被授权者立即不可读',
    !selectView(state, { userId: FRIEND }, { kind: 'plans' }, ctx().now).plans.some(p => p.id === planId))
  check('visibility 回到 private', state.plans.find(p => p.id === planId).visibility === 'private')

  // ③ 矛盾态不可能成立：名单非空却想写成 private
  check('sharedWith 非空时 visibility 不可能是 private（归一化覆盖客户端值）',
    (() => {
      const r = dispatch(state, OWNER, { type: 'plan.update', planId, input: planInput(ROUTE, { name: '共享测试', sharedWith: [FRIEND], visibility: 'private' }) })
      return r.ok && r.value.state.plans.find(p => p.id === planId).visibility === 'shared'
    })(), '')

  // ④ 未登录
  check('未登录读 plans → denied AUTH_REQUIRED',
    (() => { const v = selectView(state, { userId: null }, { kind: 'plans' }, ctx().now); return v.kind === 'denied' && v.code === 'AUTH_REQUIRED' })())
}

/* ------------------------------------------------------------------ */
section('§6 删除与单条读取')

{
  const created = dispatch(state, OWNER, { type: 'plan.create', input: planInput(ROUTE, { name: '待删除' }) })
  state = created.value.state
  const planId = created.value.targetIds[0]
  const single = selectView(state, { userId: OWNER }, { kind: 'plans', planId }, ctx().now)
  check('按 planId 读单条（列表同形状，页面不必再筛）',
    single.plans.length === 1 && single.plans[0].id === planId, single.plans.length)
  check('别人的 planId 查不到（不是"查到了但没权限"）',
    selectView(state, { userId: STRANGER }, { kind: 'plans', planId }, ctx().now).plans.length === 0)
  const del = dispatch(state, OWNER, { type: 'plan.delete', planId })
  check('owner 删除成功', del.ok && !del.value.state.plans.some(p => p.id === planId), del.error)
  const again = dispatch(del.value.state, OWNER, { type: 'plan.delete', planId })
  check('重复删除 → NOT_FOUND（不是静默成功）', !again.ok && again.error.code === 'NOT_FOUND', again.error)
}

/* ------------------------------------------------------------------ */
section('§7 集合注册闭合（漏一处会让此后每次写入被拒）')

{
  const store = require(path.join(__dirname, '..', 'cloudfunctions', 'trailApi', 'store.js'))
  check('store.COLLECTIONS 注册了 plans → ot_plans', store.COLLECTIONS.plans === 'ot_plans', store.COLLECTIONS && store.COLLECTIONS.plans)
  const S = require(path.join(__dirname, '..', 'cloudfunctions', 'trailApi', 'domain', 'schema'))
  check('schema.stateSpec 含 plans（空状态与有数据状态同一套 spec）',
    !!S.stateSpec.keys.plans && S.validate(S.stateSpec, state), '')
  const smoke = require('path').join(__dirname, '..', 'cloudfunctions', 'trailApi', 'smoke-test.js')
  const smokeSrc = require('fs').readFileSync(smoke, 'utf8')
  check('smoke-test 的 emptyState 也含 plans（三处缺一不可）', /tasks: \[\], plans: \[\]/.test(smokeSrc), '')
}

console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)