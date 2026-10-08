// Release Gate 高价值缺口补测（A 层真实信封）：node tools/e2e-release-gap-test.js
//
// 来源：docs/testing/release-coverage-matrix.md §5 的 P1 清单——那些"代码里有真实产生点、
// 但任何套件都没断言"的授权/同意/同行组/座位调整/异常收尾分支。改坏它们不会有任何测试变红。
//
// 判据三要素（沿用 e2e-permission / e2e-domain-negative 的口径）：
//   1. 拒绝发生  2. error.code 精确匹配（FORBIDDEN ≠ NOT_FOUND ≠ WRONG_PHASE ≠ CONSENT_REQUIRED ≠ GROUP_SCOPE）
//   3. 权威状态前后不变（14 集合 + ot_meta 全量逐字节）
// 期望值全部从现行 domain 代码的**具体行**推导（每条断言后注明出处），不从实际读数倒推。
'use strict'
const path = require('path')
const Module = require('module')

const STUB = path.join(__dirname, 'stub-wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return STUB
  return origResolve.call(this, request, ...rest)
}
const stub = require('./stub-wx-server-sdk')
stub.__state.db = stub.__fakeDb()
const store = require('../cloudfunctions/trailApi/store')
const trailApi = require('../cloudfunctions/trailApi/index')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + String(extra).slice(0, 220) + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const LIN = 'o-gap-lin'      // 发起者
const CHEN = 'o-gap-chen'    // 报名者（本人）
const WANG = 'o-gap-wang'    // 陈屿的常用同行人（代报对象）
const OUT = 'o-gap-outside'  // 与活动无关的人
function as(openid) {
  const call = (action, extra) => {
    stub.__state.openid = openid
    return trailApi.main(Object.assign({ action }, extra))
  }
  return {
    read: request => call('read', { request }),
    readTransport: activityId => call('readTransport', { activityId }),
    dispatch: (payload, expectedRevision, requestId) => call('dispatch', { payload, expectedRevision, requestId }),
  }
}
const lin = as(LIN), chen = as(CHEN), outside = as(OUT)
const person = (name, phone, en, ep) => ({ name, phone, emergency: { name: en, phone: ep }, medical: '', avatar: '' })
const consent = { dataUse: true, proxyAuthority: false, proxyHome: false }
const proxyConsent = { dataUse: true, proxyAuthority: true, proxyHome: false }

/** dates：允许构造"已结束行程"的活动——publish 只校验 deadline<=start<end（activity.js:26-27），不要求未来 */
function input(tag, opts) {
  opts = opts || {}
  return {
    title: tag + ' 标题', description: tag + ' 说明', organizerIntro: '自动化',
    startAt: opts.startAt || '2027-05-06T08:00:00+08:00',
    endAt: opts.endAt || '2027-05-06T18:00:00+08:00',
    deadlineAt: opts.deadlineAt || '2027-05-05T20:00:00+08:00',
    acceptingSignups: true, capacity: opts.capacity === undefined ? 12 : opts.capacity,
    approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [{ id: 'pk-1', name: '东门', meetingAt: (opts.startAt || '2027-05-06T08:00:00+08:00').slice(0, 11) + '07:00:00+08:00', address: 'x', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '',
  }
}

const ctx = {}
const rev = async () => (await lin.read({ kind: 'activity', activityId: ctx.id, perspective: 'organizer' })).data.revision
const view = async () => (await lin.read({ kind: 'activity', activityId: ctx.id, perspective: 'organizer' })).data.view
const rowOf = async name => (await view()).rows.find(x => x.name === name) || {}
async function snapshot() {
  const out = {}
  for (const key of store.ALL_COLLECTIONS) {
    const name = store.COLLECTIONS[key]
    out[name] = (await stub.__state.db.collection(name).orderBy('_id', 'asc').limit(1000).skip(0).get()).data
  }
  out.ot_meta = { main: (await stub.__state.db.collection('ot_meta').doc('main').get()).data }
  return JSON.stringify(out
  )
}
const diffCols = (a, b) => Object.keys(JSON.parse(a)).filter(k => JSON.stringify(JSON.parse(a)[k]) !== JSON.stringify(JSON.parse(b)[k])).join(',')

/** 拒绝三要素：码精确 + 全库逐字节零副作用 */
async function rejected(label, thunk, wantCode) {
  const before = await snapshot()
  const r = await thunk()
  const code = r.ok ? 'OK' : (r.error && r.error.code)
  check(label + ' → ' + wantCode, !r.ok && code === wantCode, JSON.stringify({ got: code, err: r.error }))
  const after = await snapshot()
  check(label + ' 零副作用（14 集合 + ot_meta 逐字节未变）', before === after, '变化集合=' + (diffCols(before, after) || '—'))
  return r
}

/** 真信封建到指定阶段；opts.ownSignupTrip 用于分车语义 */
async function build(tag, opts) {
  opts = opts || {}
  const r0 = await lin.dispatch({ type: 'activity.create', input: input(tag, opts) }, (await lin.read({ kind: 'profile' })).data.revision)
  const id = r0.data.targetIds[0]
  ctx.id = id
  const prof = (await lin.read({ kind: 'profile' })).data.view.profile
  const pub = await lin.dispatch({ type: 'activity.publish', activityId: id, participation: {
    personRef: { kind: 'user', userId: LIN }, participant: prof.person,
    trip: opts.ownerTrip || { mode: 'shared', pickupPointId: 'pk-1' }, consent } }, r0.data.revision)
  if (!pub.ok) throw new Error(tag + ' publish 失败：' + JSON.stringify(pub.error))
  let revv = pub.data.revision
  if (opts.riders) {
    const cp = (await chen.read({ kind: 'profile' })).data.view.profile
    const companion = cp.companions[0]
    const rt = opts.ridersTrip === 'self' ? { mode: 'self' } : { mode: 'shared', pickupPointId: 'pk-1' }
    const participants = [{ personRef: { kind: 'user', userId: CHEN }, participant: cp.person, trip: rt, consent }]
    if (opts.riders === 2) participants.push({ personRef: { kind: 'companion', ownerId: CHEN, companionId: companion.id },
      participant: person('王五', '00000000003', '王母', '00000000053'), trip: rt, consent: proxyConsent })
    const sub = await chen.dispatch({ type: 'signup.submit', activityId: id, keepTogether: !!opts.keepTogether, mode: opts.mode || 'apply', participants }, revv)
    if (!sub.ok) throw new Error(tag + ' submit 失败：' + JSON.stringify(sub.error))
    revv = sub.data.revision
    if (opts.review !== false) {
      const pending = (await view()).rows.filter(x => x.status === 'pending').map(x => x.signupId)
      if (pending.length) {
        const rvw = await lin.dispatch({ type: 'signup.review', activityId: id, signupIds: pending, decision: 'confirm' }, revv)
        if (!rvw.ok) throw new Error(tag + ' review 失败：' + JSON.stringify(rvw.error))
        revv = rvw.data.revision
      }
    }
  }
  if (opts.toGathering) {
    const g = await lin.dispatch({ type: 'activity.transition', activityId: id, next: 'gathering', reason: '按期集合' }, revv)
    if (!g.ok) throw new Error(tag + ' gathering 失败：' + JSON.stringify(g.error))
    revv = g.data.revision
  }
  if (opts.toActive) {
    for (const row of (await view()).rows) {
      if (row.checkedIn !== true) await lin.dispatch({ type: 'attendance.checkin', activityId: id, signupId: row.signupId,
        checkIn: { method: 'manual', evidence: { at: '', by: '', note: '自动化核实' } } }, await rev())
      await lin.dispatch({ type: 'attendance.departure', activityId: id, signupId: row.signupId,
        outcome: { kind: 'joined', evidence: { at: '', by: '', note: '随队出发' } } }, await rev())
    }
    const a = await lin.dispatch({ type: 'activity.transition', activityId: id, next: 'active', reason: '全员核实' }, await rev())
    if (!a.ok) throw new Error(tag + ' active 失败：' + JSON.stringify(a.error))
    revv = a.data.revision
  }
  ctx.revision = revv
  return id
}
const vehicle = async (label, plate) => {
  const r = await lin.dispatch({ type: 'vehicle.save', activityId: ctx.id, vehicleId: null, input: {
    label, plate, legalCapacity: 4, blockedSeats: 0,
    drivers: [{ kind: 'service', name: '服务司机' + label, phone: '000000000' + (70 + Number(plate.slice(-1))), userId: null }],
    seatLabels: ['01', '02', '03'], pickupPointIds: ['pk-1'] } }, await rev())
  if (!r.ok) throw new Error('vehicle.save 失败：' + JSON.stringify(r.error))
  return r.data.targetIds[0]
}

async function main() {
  await lin.dispatch({ type: 'profile.save', person: person('林溪', '00000000001', '林母', '00000000051') }, 0)
  await chen.dispatch({ type: 'profile.save', person: person('陈屿', '00000000002', '陈父', '00000000052') },
    (await chen.read({ kind: 'profile' })).data.revision)
  await chen.dispatch({ type: 'companion.save', companionId: null, person: person('王五', '00000000003', '王母', '00000000053') },
    (await chen.read({ kind: 'profile' })).data.revision)
  await outside.dispatch({ type: 'profile.save', person: person('外人', '00000000077', '外人母', '00000000078') },
    (await outside.read({ kind: 'profile' })).data.revision)

  /* ---------------- G1 CONSENT_REQUIRED：位置上报的两道同意门 ---------------- */
  section('G1 position.report 的 CONSENT_REQUIRED（field.js:107-108，此前全库零断言）')
  {
    // 行程已结束的 active 活动：publish 只校验 deadline<=start<end（activity.js:26-27），不要求未来时间
    await build('G1', { ownerTrip: { mode: 'self' }, startAt: '2026-01-06T08:00:00+08:00', endAt: '2026-01-06T18:00:00+08:00', deadlineAt: '2026-01-05T20:00:00+08:00', toGathering: true, toActive: true })
    check('G1 夹具：phase=active 且 endAt 已过（2026-01-06）',
      (await view()).activity.phase === 'active', (await view()).activity.phase)
    const me = await rowOf('林溪')
    // consent 键整个缺掉时先被 schema 的 specBool 拒（INVALID_INPUT，schema.js:348）；
    // 域层的同意门（field.js:107）只在 consent:false 时才可达。两层分开钉，不混为一谈。
    await rejected('G1a0 consent 键整个缺失 → schema 先拒（INVALID_INPUT）',
      async () => lin.dispatch({ type: 'position.report', activityId: ctx.id, signupId: me.signupId,
        coordinates: { lat: 30.9, lng: 103.5 } }, await rev()), 'INVALID_INPUT')
    await rejected('G1a consent:false（明确不同意）→ 域层同意门',
      async () => lin.dispatch({ type: 'position.report', activityId: ctx.id, signupId: me.signupId,
        coordinates: { lat: 30.9, lng: 103.5 }, consent: false }, await rev()), 'CONSENT_REQUIRED')
    await rejected('G1b consent=true 但本场授权期已过（endAt <= now）', async () => lin.dispatch({ type: 'position.report', activityId: ctx.id,
      signupId: me.signupId, coordinates: { lat: 30.9, lng: 103.5 }, consent: true }, await rev()), 'CONSENT_REQUIRED')
    check('G1 反空断言：同一条命令去掉阶段前提才会换错误码（active 之外是 WRONG_PHASE，不是同意门）',
      (await chen.dispatch({ type: 'position.report', activityId: ctx.id, signupId: me.signupId,
        coordinates: { lat: 30.9, lng: 103.5 }, consent: true }, await rev())).error.code === 'FORBIDDEN',
      '他人上报本人的位置应被授权层先拒（permissions.js:225 position.report 仅本人）')
  }
  {
    await build('G1-OK', { ownerTrip: { mode: 'self' }, toGathering: true, toActive: true })
    const me = await rowOf('林溪')
    const ok = await lin.dispatch({ type: 'position.report', activityId: ctx.id, signupId: me.signupId,
      coordinates: { lat: 30.91, lng: 103.51 }, consent: true }, await rev())
    check('G1c 正向对照：未过期行程 + consent=true ⇒ ok（证明上面两条红不是命令形状错）',
      ok.ok === true, JSON.stringify(ok.error || ''))
    const revoked = await lin.dispatch({ type: 'position.revoke', activityId: ctx.id, signupId: me.signupId }, await rev())
    check('G1d position.revoke 本人可撤（授权可回收）', revoked.ok === true, JSON.stringify(revoked.error || ''))
  }

  /* ---------------- G2 GROUP_SCOPE：同行组必须整组递补、必须同车 ---------------- */
  section('G2 GROUP_SCOPE（signup.js:126-127 / invariants.js:110，此前全库零断言）')
  {
    await build('G2', { capacity: 2, riders: 2, keepTogether: true, mode: 'waitlist', review: false })
    check('G2 夹具：容量 2 已占 1（发起者本人）⇒ 2 人整组放不下，进入候补',
      (await view()).counters.waitlisted === 2, JSON.stringify((await view()).counters))
    const one = (await view()).rows.find(x => x.name === '陈屿')
    await rejected('G2a 只递补同行组里的一个人（keepTogether）',
      async () => lin.dispatch({ type: 'signup.promote', activityId: ctx.id, signupIds: [one.signupId] }, await rev()), 'GROUP_SCOPE')
    // 反空断言要让"整组递补"真的可能成功：先腾出容量（发起者取消本人报名），再一起递补。
    // 顺序不能反——GROUP_SCOPE 的检查在 CAPACITY 之前（signup.js:126 早于 :130），
    // 若不腾容量，成功分支会被 CAPACITY 挡掉，那条 ok 就成了永远拿不到的空头对照。
    const ownerRow = await rowOf('林溪')
    const cancelOwner = await lin.dispatch({ type: 'signup.cancel', activityId: ctx.id, signupIds: [ownerRow.signupId], reason: '腾位给同行组' }, await rev())
    check('G2 前置：发起者取消本人报名腾出容量 ok', cancelOwner.ok === true, JSON.stringify(cancelOwner.error || ''))
    const both = (await view()).rows.filter(x => x.status === 'waitlisted').map(x => x.signupId)
    const okPromote = await lin.dispatch({ type: 'signup.promote', activityId: ctx.id, signupIds: both }, await rev())
    check('G2b 反空断言：整组一起递补 ⇒ ok（证明 G2a 的红出自"漏掉同组候补"而不是 promote 本身不可用）',
      okPromote.ok === true && both.length === 2, JSON.stringify(okPromote.error || ''))
  }
  {
    await build('G2V', { riders: 2, keepTogether: true })
    const vA = await vehicle('A', 'A0001')
    const vB = await vehicle('B', 'B0002')
    const chenRow = await rowOf('陈屿')
    const wangRow = await rowOf('王五')
    const s1 = await lin.dispatch({ type: 'assignment.set', activityId: ctx.id, target: { signupId: chenRow.signupId, vehicleId: vA, seatLabel: '01' } }, await rev())
    check('G2c 同组第一人安置到 A 车 ok', s1.ok === true, JSON.stringify(s1.error || ''))
    await rejected('G2d 同组第二人安置到 B 车（keepTogether 必须同车）',
      async () => lin.dispatch({ type: 'assignment.set', activityId: ctx.id, target: { signupId: wangRow.signupId, vehicleId: vB, seatLabel: '01' } }, await rev()), 'GROUP_SCOPE')
    const s3 = await lin.dispatch({ type: 'assignment.set', activityId: ctx.id, target: { signupId: wangRow.signupId, vehicleId: vA, seatLabel: '02' } }, await rev())
    check('G2e 反空断言：安置到同一辆车 ⇒ ok', s3.ok === true, JSON.stringify(s3.error || ''))
  }

  /* ---------------- G3 incident：现场异常的授权 + 未解决异常挡归档 ---------------- */
  section('G3 incident.report/resolve 与"未解决异常挡归档"（activity.js:190 / permissions.js:234-236）')
  {
    await build('G3', { ownerTrip: { mode: 'self' }, riders: 1, ridersTrip: 'self', toGathering: true, toActive: true })
    const me = await rowOf('林溪')
    const chenRow = await rowOf('陈屿')
    await rejected('G3a 无关者 incident.report → FORBIDDEN',
      async () => outside.dispatch({ type: 'incident.report', activityId: ctx.id, signupIds: [chenRow.signupId], kind: 'injury',
        description: '外人报的异常' }, await rev()), 'FORBIDDEN')
    const rep = await lin.dispatch({ type: 'incident.report', activityId: ctx.id, signupIds: [chenRow.signupId], kind: 'injury',
      description: '脚踝扭伤，仍在处理' }, await rev())
    check('G3b 发起者 incident.report ok', rep.ok === true, JSON.stringify(rep.error || ''))
    const incidentId = rep.data.targetIds[0]
    await rejected('G3c 无关者 incident.resolve → FORBIDDEN',
      async () => outside.dispatch({ type: 'incident.resolve', activityId: ctx.id, incidentId, note: '外人想销案' }, await rev()), 'FORBIDDEN')
    // 收尾链的正确次序：到家确认属于 closing（field.js:101 要求 phase==='closing'），
    // 所以必须先 closing，再逐人 home，再试着归档——否则"归档被拒"会混进"到家还没核实"这个别的原因。
    const cls = await lin.dispatch({ type: 'activity.transition', activityId: ctx.id, next: 'closing', reason: '行程结束' }, await rev())
    check('G3d active→closing ok（异常不挡 closing，只挡 archived）', cls.ok === true, JSON.stringify(cls.error || ''))
    for (const row of (await view()).rows) {
      const h = await lin.dispatch({ type: 'attendance.home', activityId: ctx.id, signupId: row.signupId, note: '自动化确认到家' }, await rev())
      if (!h.ok) throw new Error('G3 前置 home 失败：' + JSON.stringify(h.error))
    }
    check('G3d2 逐人家到家已核实完毕（归档的唯一剩余障碍就是那道异常）',
      (await view()).counters.pendingHome === 0, JSON.stringify((await view()).counters))
    await rejected('G3e 有未解决异常时 closing→archived → UNRESOLVED_SAFETY',
      async () => lin.dispatch({ type: 'activity.transition', activityId: ctx.id, next: 'archived', reason: '想直接归档' }, await rev()), 'UNRESOLVED_SAFETY')
    const res = await lin.dispatch({ type: 'incident.resolve', activityId: ctx.id, incidentId, note: '已送医并确认' }, await rev())
    check('G3f 发起者销案 ok', res.ok === true, JSON.stringify(res.error || ''))
    const arch = await lin.dispatch({ type: 'activity.transition', activityId: ctx.id, next: 'archived', reason: '异常已闭环' }, await rev())
    check('G3g 反空断言：异常解决后归档成功 ⇒ G3e 的红确实来自那道未解决异常', arch.ok === true, JSON.stringify(arch.error || ''))
  }

  /* ---------------- G4 座位与车辆的删除/交换边界 ---------------- */
  section('G4 assignment.swap / vehicle.remove 的边界（transport.js:117-120 / :170-175）')
  {
    await build('G4', { riders: 2 })
    const vA = await vehicle('A', 'C0003')
    const vB = await vehicle('B', 'D0004')
    const chenRow = await rowOf('陈屿')
    const wangRow = await rowOf('王五')
    await rejected('G4a swap 两位是同一人 → INVALID_INPUT',
      async () => lin.dispatch({ type: 'assignment.swap', activityId: ctx.id, firstSignupId: chenRow.signupId, secondSignupId: chenRow.signupId }, await rev()), 'INVALID_INPUT')
    await rejected('G4b swap 时对方还没有乘车安排 → NOT_FOUND',
      async () => lin.dispatch({ type: 'assignment.swap', activityId: ctx.id, firstSignupId: chenRow.signupId, secondSignupId: wangRow.signupId }, await rev()), 'NOT_FOUND')
    await lin.dispatch({ type: 'assignment.set', activityId: ctx.id, target: { signupId: chenRow.signupId, vehicleId: vA, seatLabel: '01' } }, await rev())
    await rejected('G4c 还有乘客的车直接删除 → CONFLICT',
      async () => lin.dispatch({ type: 'vehicle.remove', activityId: ctx.id, vehicleId: vA }, await rev()), 'CONFLICT')
    const rm = await lin.dispatch({ type: 'assignment.remove', activityId: ctx.id, signupId: chenRow.signupId }, await rev())
    check('G4d assignment.remove ok（解除后车辆可删）', rm.ok === true, JSON.stringify(rm.error || ''))
    const rmv = await lin.dispatch({ type: 'vehicle.remove', activityId: ctx.id, vehicleId: vA }, await rev())
    check('G4e 反空断言：解除乘客后 vehicle.remove ok', rmv.ok === true, JSON.stringify(rmv.error || ''))
    // 「已有行程事实的车不可删」需要真发车，而 vehicle.depart 只在 gathering/active 合法（field.js 阶段门），
    // 所以要单独起一条 gathering 链，而不是在 published 的夹具上硬发（上一版就是那样撞 WRONG_PHASE 的）。
    await build('G4H', { riders: 1, ridersTrip: 'shared', toGathering: true })
    const vh = await vehicle('H', 'E0006')
    const chenH = await rowOf('陈屿')
    const setH = await lin.dispatch({ type: 'assignment.set', activityId: ctx.id, target: { signupId: chenH.signupId, vehicleId: vh, seatLabel: '01' } }, await rev())
    check('G4f 前置：安置乘客到 H 车 ok', setH.ok === true, JSON.stringify(setH.error || ''))
    await lin.dispatch({ type: 'attendance.checkin', activityId: ctx.id, signupId: chenH.signupId, checkIn: { method: 'manual', evidence: { at: '', by: '', note: '自动化' } } }, await rev())
    await lin.dispatch({ type: 'attendance.board', activityId: ctx.id, signupId: chenH.signupId, leg: 'outbound', boarded: true, note: '清点上车' }, await rev())
    await lin.dispatch({ type: 'attendance.departure', activityId: ctx.id, signupId: chenH.signupId, outcome: { kind: 'joined', evidence: { at: '', by: '', note: '随队' } } }, await rev())
    const dep = await lin.dispatch({ type: 'vehicle.depart', activityId: ctx.id, vehicleId: vh, leg: 'outbound', note: '清点后发车' }, await rev())
    check('G4f 前置：H 车发车 ok', dep.ok === true, JSON.stringify(dep.error || ''))
    await rejected('G4g 已有行程事实的车辆不可删除 → WRONG_PHASE',
      async () => lin.dispatch({ type: 'vehicle.remove', activityId: ctx.id, vehicleId: vh }, await rev()), 'WRONG_PHASE')
  }

  /* ---------------- G5 他人资料 / 候补递补 / 通知受众的授权 ---------------- */
  section('G5 signup.edit / notice.read 的归属边界（permissions.js:209-211 / canReadNotice）')
  {
    await build('G5', { riders: 1 })
    const chenRow = await rowOf('陈屿')
    const cp = (await chen.read({ kind: 'profile' })).data.view.profile
    await rejected('G5a 无关者改他人报名资料 → FORBIDDEN',
      async () => outside.dispatch({ type: 'signup.edit', activityId: ctx.id, signupId: chenRow.signupId,
        participant: cp.person, trip: { mode: 'self' }, purpose: '外人想改' }, await rev()), 'FORBIDDEN')
    const pubNotice = await lin.dispatch({ type: 'notice.publish', activityId: ctx.id, audience: { kind: 'signups', signupIds: [chenRow.signupId] },
      content: '只发给陈屿的通知' }, await rev())
    check('G5b notice.publish（受众=指定报名者）ok', pubNotice.ok === true, JSON.stringify(pubNotice.error || ''))
    const noticeId = pubNotice.data.targetIds[0]
    const outsiderRead = await outside.dispatch({ type: 'notice.read', activityId: ctx.id, noticeId }, await rev())
    check('G5c 受众之外的人 notice.read → FORBIDDEN（不是 NOT_FOUND：受众判断在授权层）',
      !outsiderRead.ok && outsiderRead.error.code === 'FORBIDDEN', JSON.stringify(outsiderRead.error || ''))
    const chenRead = await chen.dispatch({ type: 'notice.read', activityId: ctx.id, noticeId }, await rev())
    check('G5d 反空断言：受众本人可读 ⇒ G5c 的拒来自受众判断', chenRead.ok === true, JSON.stringify(chenRead.error || ''))
  }

  /* ---------------- G6 同伴人（代报对象）的所有权 ---------------- */
  section('G6 companion.remove 只能动自己的同行人（permissions.js:129-133）')
  {
    const cp = (await chen.read({ kind: 'profile' })).data.view.profile
    const companionId = cp.companions[0].id
    const revOut = (await outside.read({ kind: 'profile' })).data.revision
    await rejected('G6a 外人删陈屿的同行人 → FORBIDDEN',
      async () => outside.dispatch({ type: 'companion.remove', companionId }, revOut), 'FORBIDDEN')
    const revChen = (await chen.read({ kind: 'profile' })).data.revision
    const ok = await chen.dispatch({ type: 'companion.remove', companionId }, revChen)
    check('G6b 本人删除自己的同行人 ok', ok.ok === true, JSON.stringify(ok.error || ''))
    const after = (await chen.read({ kind: 'profile' })).data.view.profile
    check('G6c 删除后档案里确实没有了（命令被执行，不是没发）',
      (after.companions || []).every(c => c.id !== companionId), JSON.stringify((after.companions || []).map(c => c.id)))
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('套件自身异常：' + (e && e.stack || e)); process.exit(1) })
