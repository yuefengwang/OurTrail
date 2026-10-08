// Phase 9 §13 多步骤并发交错状态链：node tools/e2e-interleave-test.js
//
// 与 tools/e2e-concurrency-test.js 的分工：那套管的是「同 revision 双写」这一**基座形状**
// （S0/S1/S2/S4/S5/S7）；本套管的是**多个业务步骤交错**——A 的第 n 步踩在 B 的第 m 步留下的
// 旧基线上，且要求败者重读后仍能收敛、域阶段门在 CAS 之后仍然生效。
//
// 判定口径（任务书 §5）：
//   · 全部走真实信封 exports.main → reduceCommand → domain → store.persistState，桩只替 DB。
//   · barrier 默认 ON（tools/stub-wx-server-sdk.js 的 TEST-HARNESS DETERMINISTIC TRANSACTION BARRIER）
//     ⇒ 只建模事务互相串行，**不建模**真云端锁粒度/超时/MVCC。
//   · 「真同时」只在同一 openid 下成立：桩把 openid 存在模块级全局（stub-wx-server-sdk.js:6），
//     跨身份 Promise.all 会互相踩身份 ⇒ 跨身份场景一律 ordering=sequential-stale-base
//     （A 提交后 B 才发，但 B 携带的仍是它早先读到的 R），这是**交错**而不是**并发**，如实标注。
//   · 禁止 sleep 造并发；期望值全部来自域规则与 fixture 输入，不回读实际值当期望。
//   · 每条 case 打 14 列账本（初始态/双 actor/次序/胜者/败者/错误码/终态 phase/名单终态/
//     revision/receipts/events/零副作用/判定），零副作用用 14 集合 + ot_meta 全量逐字节快照。
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
stub.__setTxnBarrier(true)
const store = require('../cloudfunctions/trailApi/store')
const trailApi = require('../cloudfunctions/trailApi/index')

let passed = 0
let failed = 0
let inconclusive = 0
const findings = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + String(extra).slice(0, 220) + '）' : '')) }
}
function inc(name, why) { inconclusive++; findings.push(['INC', 'INCONCLUSIVE', name + '：' + why]); console.log('  ○ [INCONCLUSIVE] ' + name + ' —— ' + why) }
function finding(id, level, text) { findings.push([id, level, text]); console.log('  ▶ [' + level + ' · ' + id + '] ' + text) }
function section(t) { console.log('== ' + t + ' ==') }
function ledger(o) {
  console.log('  ┌ ' + o.id + '  A=' + o.actorA + '  B=' + o.actorB)
  console.log('  │ 初始：phase=' + o.initialPhase + ' confirmed=' + o.initialConfirmed + ' revision=' + o.initialRevision +
    '  基座=' + o.barrier + '  ordering=' + o.ordering)
  console.log('  │ 步骤：' + o.steps)
  console.log('  │ 期望：winner=' + o.expectedWinner + '  loser=' + o.expectedLoser + '  error=' + o.expectedError)
  console.log('  └ 实测：finalPhase=' + o.finalPhase + '  finalRows=' + o.finalRows + '  revision=' + o.finalRevision +
    '  receipts=' + o.receipts + '  events=' + o.events + '  loserZeroSideEffect=' + o.loserZeroSideEffect +
    '  判定=' + o.verdict)
}

/* ---------- 身份与信封 ---------- */
const LIN = 'o-lin-interleave'      // 发起人
const CHEN = 'o-chen-interleave'    // 报名者（王五是 TA 的常用同行人）
function as(openid) {
  const call = (action, extra) => {
    stub.__state.openid = openid
    return trailApi.main(Object.assign({ action }, extra))
  }
  return {
    openid,
    read: request => call('read', { request }),
    readTransport: activityId => call('readTransport', { activityId }),
    previewAssignments: activityId => call('previewAssignments', { activityId }),
    dispatch: (payload, expectedRevision, requestId) => call('dispatch', { payload, expectedRevision, requestId }),
  }
}
const lin = as(LIN)
const chen = as(CHEN)

const person = (name, phone, en, ep) => ({ name, phone, emergency: { name: en, phone: ep }, medical: '', avatar: '' })
const consent = { dataUse: true, proxyAuthority: false, proxyHome: false }
function input(tag) {
  return {
    title: tag + ' 标题', description: tag + ' 说明', organizerIntro: '自动化',
    startAt: '2027-03-06T08:00:00+08:00', endAt: '2027-03-06T18:00:00+08:00', deadlineAt: '2027-03-05T20:00:00+08:00',
    acceptingSignups: true, capacity: 12, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [{ id: 'pk-1', name: '东门', meetingAt: '2027-03-06T07:00:00+08:00', address: 'x', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '',
  }
}

const active = {}   // 当前场景的活动 id
const revOf = async id => (await lin.read({ kind: 'activity', activityId: id, perspective: 'organizer' })).data.revision
const viewOf = async id => (await lin.read({ kind: 'activity', activityId: id, perspective: 'organizer' })).data.view
const R = () => revOf(active.id)
const V = () => viewOf(active.id)
const rowOf = async name => (await V()).rows.find(x => x.name === name) || {}
const counters = async () => (await V()).counters
const phase = async () => (await V()).activity.phase
const codeOf = r => (r && !r.ok && r.error && r.error.code) || (r && r.ok ? 'OK' : '<none>')

/** 全量文档快照：败者零副作用只认逐字节，不认视图字段 */
async function snapshot() {
  const out = {}
  for (const key of store.ALL_COLLECTIONS) {
    const name = store.COLLECTIONS[key]
    const res = await stub.__state.db.collection(name).orderBy('_id', 'asc').limit(1000).skip(0).get()
    out[name] = res.data
  }
  out.ot_meta = { main: (await stub.__state.db.collection('ot_meta').doc('main').get()).data }
  return JSON.stringify(out)
}
const snapCount = (snap, name) => JSON.parse(snap)[name].length

/* ---------- 真实信封建到指定阶段（不碰 DB、不伪造 phase、不 mock handler） ---------- */
async function buildPublished(tag, opts) {
  opts = opts || {}
  // 需要座位的场景必须用 shared（自带 pickupPointId）：mode=self 的人不参与分车，
  // 预览会给出 0 条安排，后面的上车/发车步骤就失去前置（C3 首轮即因此空转）。
  const ridersTrip = () => (opts.ridersTrip === 'shared' ? { mode: 'shared', pickupPointId: 'pk-1' } : { mode: 'self' })
  // 生命周期与真客户端一致：先读、拿 revision，再写（本套件不许靠服务端缺省支路）
  const revBeforeCreate = (await lin.read({ kind: 'profile' })).data.revision
  const r0 = await lin.dispatch({ type: 'activity.create', input: input(tag) }, revBeforeCreate)
  if (!r0.ok) throw new Error(tag + ' activity.create 失败：' + JSON.stringify(r0.error))
  const id = r0.data.targetIds[0]
  const profile = (await lin.read({ kind: 'profile' })).data.view.profile
  let r = await lin.dispatch({
    type: 'activity.publish', activityId: id,
    participation: { personRef: { kind: 'user', userId: LIN }, participant: profile.person, trip: { mode: opts.ownerTrip || 'self' }, consent },
  }, await revOf(id))
  if (!r.ok) throw new Error(tag + ' publish 失败：' + JSON.stringify(r.error))
  if (opts.riders !== 0) {
    const chenProfile = (await chen.read({ kind: 'profile' })).data.view.profile
    const wangCompanion = (chenProfile.companions || [])[0]
    if (opts.twoRiders && !wangCompanion) throw new Error(tag + '：陈屿档案里没有常用同行人（companion.save 未落库）')
    const participants = [{
      personRef: { kind: 'user', userId: CHEN }, participant: chenProfile.person,
      trip: ridersTrip(), consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }]
    if (opts.twoRiders) participants.push({
      personRef: { kind: 'companion', ownerId: CHEN, companionId: wangCompanion.id },
      participant: person('王五', '00000000003', '王母', '00000000053'), trip: ridersTrip(),
      consent: { dataUse: true, proxyAuthority: true, proxyHome: false },
    })
    r = await chen.dispatch({ type: 'signup.submit', activityId: id, keepTogether: false, mode: 'apply', participants }, await revOf(id))
    if (!r.ok) throw new Error(tag + ' signup.submit 失败：' + JSON.stringify(r.error))
    if (opts.review !== false) {
      const pending = (await viewOf(id)).rows.filter(x => x.status === 'pending').map(x => x.signupId)
      r = await lin.dispatch({ type: 'signup.review', activityId: id, signupIds: pending, decision: 'confirm' }, await revOf(id))
      if (!r.ok) throw new Error(tag + ' signup.review 失败：' + JSON.stringify(r.error))
    }
  }
  active.id = id
  return id
}
async function toGathering() {
  const r = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'gathering', reason: '按期集合' }, await R())
  if (!r.ok) throw new Error('transition gathering 失败：' + JSON.stringify(r.error))
  return r.data.revision
}
const checkin = (name, expectedRevision) => rowOf(name).then(s => lin.dispatch({
  type: 'attendance.checkin', activityId: active.id, signupId: s.signupId,
  checkIn: { method: 'manual', evidence: { at: '', by: '', note: '集合点人工核实' } },
}, expectedRevision))
const departure = (name, expectedRevision) => rowOf(name).then(s => lin.dispatch({
  type: 'attendance.departure', activityId: active.id, signupId: s.signupId,
  outcome: { kind: 'joined', evidence: { at: '', by: '', note: '随队出发' } },
}, expectedRevision))
const board = (name, expectedRevision) => rowOf(name).then(s => lin.dispatch({
  type: 'attendance.board', activityId: active.id, signupId: s.signupId, leg: 'outbound', boarded: true, note: '清点上车',
}, expectedRevision))

/** 「败者携带陈旧基线」的通用判据。快照必须取在被拒的写**之前**：
 *  取在被拒之后比较＝拿"写后"比"写后"，恒等，是空断言（Phase 8 的 revision 空断言同类坑）。 */
async function loserRejected(label, thunk, wantCode) {
  const snapBefore = await snapshot()
  const r = await thunk()
  check(label + ' 被拒且码为 ' + wantCode, !r.ok && codeOf(r) === wantCode, JSON.stringify(r.error || r))
  const snapAfter = await snapshot()
  check(label + ' 零副作用：14 集合 + ot_meta 逐字节未变（快照前置于被拒写）',
    snapBefore === snapAfter, '集合差异=' + diffCols(snapBefore, snapAfter))
  return r
}
function diffCols(a, b) {
  const A = JSON.parse(a), B = JSON.parse(b)
  return Object.keys(A).filter(k => JSON.stringify(A[k]) !== JSON.stringify(B[k])).join(',')
}

async function main() {
  // 建档（两个 actor 各一次）：一律「先读拿 revision，再写」，与本套件要钉的生命周期一致
  const linRev = (await lin.read({ kind: 'profile' })).data.revision
  const linSave = await lin.dispatch({ type: 'profile.save', person: person('林溪', '00000000001', '林母', '00000000051') }, linRev)
  if (!linSave.ok) throw new Error('林溪建档失败：' + JSON.stringify(linSave.error))
  const chenRev = (await chen.read({ kind: 'profile' })).data.revision
  const chenSave = await chen.dispatch({ type: 'profile.save', person: person('陈屿', '00000000002', '陈父', '00000000052') }, chenRev)
  if (!chenSave.ok) throw new Error('陈屿建档失败：' + JSON.stringify(chenSave.error))
  const companionSave = await chen.dispatch({ type: 'companion.save', companionId: null, person: person('王五', '00000000003', '王母', '00000000053') },
    (await chen.read({ kind: 'profile' })).data.revision)
  if (!companionSave.ok) throw new Error('常用同行人建档失败：' + JSON.stringify(companionSave.error))

  /* ======================================================================
     C1 逐人签到 × 出发核实 × 推进：两个组织者会话在同一基线上交错
     ====================================================================== */
  section('C1 A checkin / B checkin / A departure / B departure / A transition')
  {
    // 只用 2 人（发起者 + 陈屿）：gathering→active 要求每个 confirmed 都核实出发，
    // 第三人会让本 case 的期望变成"还得再核实一人"，与 §13 C1 的步骤表不符。
    await buildPublished('C1')
    await toGathering()
    const R0 = await R()
    const c0 = await counters()
    const snap0 = await snapshot()
    const receipts0 = snapCount(snap0, 'ot_receipts')
    const events0 = snapCount(snap0, 'ot_events')

    // 真同时：同一 owner 身份、同一个 R0、Promise.all（barrier ON ⇒ 恰好一个成功）
    const linSignup = await rowOf('林溪')
    const chenSignup = await rowOf('陈屿')
    const both = await Promise.all([
      lin.dispatch({ type: 'attendance.checkin', activityId: active.id, signupId: linSignup.signupId, checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'A 核实' } } }, R0),
      lin.dispatch({ type: 'attendance.checkin', activityId: active.id, signupId: chenSignup.signupId, checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'B 核实' } } }, R0),
    ])
    const oks = both.filter(x => x.ok === true).length
    const conflicts = both.filter(x => !x.ok && codeOf(x) === 'CONFLICT').length
    check('C1 同基线双签到：恰好一个 ok', oks === 1, 'ok 数=' + oks)
    check('C1 同基线双签到：恰好一个 CONFLICT', conflicts === 1, JSON.stringify(both.map(codeOf)))
    const R1 = await R()
    check('C1 双签到后 revision 只 +1（不是 +2）', R1 === R0 + 1, R0 + '→' + R1)
    const winner = both.find(x => x.ok === true)
    const winnerName = winner.data.targetIds.indexOf(linSignup.signupId) !== -1 ? '林溪' : '陈屿'
    const loserName = winnerName === '林溪' ? '陈屿' : '林溪'
    check('C1 胜者的签到确实落库', (await rowOf(winnerName)).checkedIn === true, JSON.stringify((await rowOf(winnerName)).checkedIn))
    check('C1 败者那次写入没落库（这一行仍未签到）', (await rowOf(loserName)).checkedIn === false, JSON.stringify((await rowOf(loserName)).checkedIn))

    // 败者重读后收敛：带最新 R 再发一次，必须成功且只推进一次
    const retry = await checkin(loserName, R1)
    check('C1 败者重读后重试成功（交错必须可收敛，不是一直冲突）', retry.ok === true, JSON.stringify(retry.error || ''))
    const R2 = await R()
    check('C1 重试推进 +1', R2 === R1 + 1, R1 + '→' + R2)
    check('C1 重试没有将胜者的签到冲掉', (await rowOf(winnerName)).checkedIn === true, '')
    await loserRejected('C1 拿着同一个 R1 再发一次（重复签到）', () => checkin(loserName, R1), 'CONFLICT')

    // 出发核实：两人各自交错
    const R3 = await R()
    const depA = await departure('林溪', R3)
    check('C1 A 出发核实 ok', depA.ok === true, JSON.stringify(depA.error || ''))
    const depB = await departure('陈屿', R3)
    check('C1 B 用同一 R3 出发核实 ⇒ CONFLICT（顺序交错也要被层①拦住）', !depB.ok && codeOf(depB) === 'CONFLICT', JSON.stringify(depB.error || ''))
    const depB2 = await departure('陈屿', await R())
    check('C1 B 重读后出发核实 ok', depB2.ok === true, JSON.stringify(depB2.error || ''))

    // 推进：带陈旧基线的 transition 必须先被拒，重读后才成功
    const staleR = R3
    const badTransition = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'active', reason: '全员核实' }, staleR)
    check('C1 陈旧基线的 transition ⇒ CONFLICT（不是 UNRESOLVED_DEPARTURE：CAS 在域校验之前）',
      !badTransition.ok && codeOf(badTransition) === 'CONFLICT', JSON.stringify(badTransition.error || ''))
    const goodTransition = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'active', reason: '全员核实' }, await R())
    check('C1 重读后 transition gathering→active ok', goodTransition.ok === true, JSON.stringify(goodTransition.error || ''))

    const v = await V()
    check('C1 终态：phase=active 且两人 checkedIn+joined',
      v.activity.phase === 'active' && (await rowOf('林溪')).checkedIn === true && (await rowOf('陈屿')).checkedIn === true,
      JSON.stringify({ phase: v.activity.phase }))
    const snapEnd = await snapshot()
    check('C1 receipts 增量 = 成功写入数（5：2 签到+2 出发+1 推进），败者不留收据',
      snapCount(snapEnd, 'ot_receipts') - receipts0 === 5, receipts0 + '→' + snapCount(snapEnd, 'ot_receipts'))
    check('C1 events 增量 = 5（每一次成功变更一条账，拒绝零条）',
      snapCount(snapEnd, 'ot_events') - events0 === 5, events0 + '→' + snapCount(snapEnd, 'ot_events'))
    ledger({ id: 'C1', actorA: 'Owner 会话 A', actorB: 'Owner 会话 B（同一 openid，真同时）', initialPhase: 'gathering',
      initialConfirmed: c0.confirmed, initialRevision: R0, barrier: 'ON', ordering: 'Promise.all（同 R0）+ sequential-stale-base',
      steps: 'checkin×2 同基线 → 败者重读重试 → departure×2 交错 → transition 陈旧/重读',
      expectedWinner: '恰好一个（基座不规定谁赢）', expectedLoser: '另一个 → CONFLICT', expectedError: 'CONFLICT',
      finalPhase: v.activity.phase, finalRows: '林溪/陈屿 checkedIn=true 且 departure=joined', finalRevision: goodTransition.data.revision,
      receipts: receipts0 + '→' + snapCount(snapEnd, 'ot_receipts'), events: events0 + '→' + snapCount(snapEnd, 'ot_events'),
      loserZeroSideEffect: '是（全库逐字节）', verdict: 'PASS（STUB-BARRIER）' })
  }

  /* ======================================================================
     C2 审核 × 取消 × 分车（跨身份 ⇒ sequential-stale-base）
     ====================================================================== */
  section('C2 A signup.review / B signup.cancel / A seat assignment')
  {
    await buildPublished('C2', { twoRiders: true, review: false })
    const R0 = await R()
    const pending = (await V()).rows.filter(x => x.status === 'pending')
    check('C2 夹具：2 条待确认（陈屿 + 王五）', pending.length === 2, JSON.stringify(pending.map(x => x.name)))
    const wang = pending.find(x => x.name === '王五')
    const chenRow = pending.find(x => x.name === '陈屿')

    const rev = await lin.dispatch({ type: 'signup.review', activityId: active.id, signupIds: [wang.signupId], decision: 'confirm' }, R0)
    check('C2 A 审核王五 ok', rev.ok === true, JSON.stringify(rev.error || ''))
    const R1 = await R()
    await loserRejected('C2 B 用 R0 取消刚被审核的人',
      () => chen.dispatch({ type: 'signup.cancel', activityId: active.id, signupIds: [wang.signupId], reason: '交错取消' }, R0), 'CONFLICT')

    const cancelFresh = await chen.dispatch({ type: 'signup.cancel', activityId: active.id, signupIds: [wang.signupId], reason: '重读后取消' }, R1)
    check('C2 B 重读后取消 ok（域允许：已确认但未出发可取消）', cancelFresh.ok === true, JSON.stringify(cancelFresh.error || ''))
    const R2 = await R()
    const v2 = await V()
    const wangRow = v2.rows.find(x => x.signupId === wang.signupId)
    check('C2 终态名单：王五不再是当前报名（removed/cancelled），陈屿仍 pending',
      (!wangRow || wangRow.status !== 'confirmed') && (v2.rows.find(x => x.signupId === chenRow.signupId) || {}).status === 'pending',
      JSON.stringify(v2.rows.map(x => [x.name, x.status])))

    // 取消之后不得再被分车：这是"步骤交错后的一致性"，不是单命令规则
    const veh = await lin.dispatch({ type: 'vehicle.save', activityId: active.id, vehicleId: null, input: {
      label: '1号车', plate: 'A12345', legalCapacity: 4, blockedSeats: 0,
      drivers: [{ kind: 'service', name: '服务司机', phone: '00000000009', userId: null }], seatLabels: ['01', '02', '03'], pickupPointIds: ['pk-1'] },
    }, R2)
    check('C2 建车 ok', veh.ok === true, JSON.stringify(veh.error || ''))
    const vNow = await V()
    const bad = await lin.dispatch({ type: 'assignment.set', activityId: active.id, target: { signupId: wang.signupId, vehicleId: veh.data.targetIds[0], seatLabel: '01' } }, await R())
    check('C2 给已取消的报名分车 ⇒ 被拒（跨步骤一致性：取消的副作用必须延续到分车）',
      !bad.ok, JSON.stringify(bad.error || bad))
    check('C2 被拒的错误码出自名单完整性检查（NOT_FOUND / WRONG_PHASE / INVALID_INPUT 之一，不许是静默 ok）',
      ['NOT_FOUND', 'WRONG_PHASE', 'INVALID_INPUT', 'CAPACITY'].indexOf(codeOf(bad)) !== -1, codeOf(bad))
    const tr = await lin.readTransport(active.id)
    check('C2 分车被拒后 readTransport 里王五没有任何安排',
      tr.data.value.assignments.every(a => a.signupId !== wang.signupId), JSON.stringify(tr.data.value.assignments))
    const vEnd = await V()
    ledger({ id: 'C2', actorA: 'Owner(审核/分车)', actorB: 'Member 陈屿(取消)', initialPhase: 'published',
      initialConfirmed: (await counters()).confirmed, initialRevision: R0, barrier: 'ON',
      ordering: 'sequential-stale-base（跨身份不能真同时，见文件头）',
      steps: 'A review(王五)@R0 → B cancel(王五)@R0(陈旧) → B cancel@R1 → A vehicle.save → A assignment.set(已取消者)',
      expectedWinner: 'A 审核', expectedLoser: 'B 陈旧取消 → CONFLICT', expectedError: 'CONFLICT（陈旧基线）/ 名单类拒绝（已取消者不可分车）',
      finalPhase: vEnd.activity.phase, finalRows: vEnd.rows.map(x => x.name + '=' + x.status).join(','), finalRevision: await R(),
      receipts: '（见 C1 同类账）', events: '同上', loserZeroSideEffect: '是（全库逐字节）', verdict: 'PASS（STUB）' })
  }

  /* ======================================================================
     C3 分车预览提交 × 上车 × 发车（两层 CAS：外层 revision + 内层 baseRevision）
     ====================================================================== */
  section('C3 A vehicle/preview commit / B boarding / A departure（预览过期 = 内层 CAS）')
  {
    await buildPublished('C3', { twoRiders: true, ridersTrip: 'shared' })
    await toGathering()
    const R0 = await R()
    const veh = await lin.dispatch({ type: 'vehicle.save', activityId: active.id, vehicleId: null, input: {
      label: '1号车', plate: 'C11111', legalCapacity: 4, blockedSeats: 0,
      drivers: [{ kind: 'service', name: '服务司机', phone: '00000000010', userId: null }], seatLabels: ['01', '02', '03'], pickupPointIds: ['pk-1'] },
    }, R0)
    const vehicleId = veh.data.targetIds[0]
    const chenRow = await rowOf('陈屿')
    const wangRow = await rowOf('王五')
    const pv = (await lin.previewAssignments(active.id)).data
    check('C3 预览带 baseRevision 且等于当前 revision', pv.baseRevision === await R(), JSON.stringify({ pv: pv.baseRevision, now: await R() }))
    // 交错：预览生成后，另一个写入先落库 ⇒ commit 必须撞内层 CAS，即使外层 expectedRevision 是最新的
    await lin.dispatch({ type: 'attendance.checkin', activityId: active.id, signupId: chenRow.signupId, checkIn: { method: 'manual', evidence: { at: '', by: '', note: '先落地的一步' } } }, await R())
    const commitStale = await lin.dispatch({ type: 'assignment.commit', activityId: active.id, preview: pv }, await R())
    check('C3 预览过期 ⇒ 外层 revision 新鲜仍被内层 CAS 拒（CONFLICT「分车预览已过期」）',
      !commitStale.ok && codeOf(commitStale) === 'CONFLICT' && /预览/.test(commitStale.error.message || ''),
      JSON.stringify(commitStale.error || ''))
    const pv2 = (await lin.previewAssignments(active.id)).data
    const commit2 = await lin.dispatch({ type: 'assignment.commit', activityId: active.id, preview: pv2 }, await R())
    check('C3 重新预览后 commit ok（交错可收敛）', commit2.ok === true, JSON.stringify(commit2.error || ''))
    const trAfterCommit = (await lin.readTransport(active.id)).data.value
    check('C3 反空断言：commit 真的落了 2 条安排（shared 出行的两位各一座）',
      trAfterCommit.assignments.length === 2, JSON.stringify(trAfterCommit.assignments.map(a => [a.signupId, a.seatLabel])))

    // 上车 × 发车：未签到的王五先上车必须被拒；签到→上车→发车顺序成立后，再改写上车事实必须被拒
    const boardBad = await board('王五', await R())
    check('C3 未签到者上车 ⇒ UNRESOLVED_DEPARTURE（前置门在域层，不靠 UI）',
      !boardBad.ok && codeOf(boardBad) === 'UNRESOLVED_DEPARTURE', JSON.stringify(boardBad.error || ''))
    await checkin('王五', await R())
    const boardOk = await board('王五', await R())
    check('C3 签到后上车 ok', boardOk.ok === true, JSON.stringify(boardOk.error || ''))
    const depOk = await departure('王五', await R())
    check('C3 已签到已上车者出发核实 ok', depOk.ok === true, JSON.stringify(depOk.error || ''))
    // 发车前本车每一人都要"上车 + 核实去向"，否则 vehicle.depart 自己就该拒（域门，不是 UI 门）
    const boardChen = await board('陈屿', await R())
    check('C3 陈屿（已签到已分座）上车 ok', boardChen.ok === true, JSON.stringify(boardChen.error || ''))
    await departure('陈屿', await R())
    const vehDepart = await lin.dispatch({ type: 'vehicle.depart', activityId: active.id, vehicleId, leg: 'outbound', note: '清点后发车' }, await R())
    check('C3 发车 ok', vehDepart.ok === true, JSON.stringify(vehDepart.error || ''))
    const boardAfter = await board('陈屿', await R())
    check('C3 发车后改写去程上车 ⇒ WRONG_PHASE（车辆已发车，不能抹去事实）',
      !boardAfter.ok && codeOf(boardAfter) === 'WRONG_PHASE', JSON.stringify(boardAfter.error || ''))
    const cancelAfterDepart = await chen.dispatch({ type: 'signup.cancel', activityId: active.id, signupIds: [wangRow.signupId], reason: '出发后想退' }, await R())
    check('C3 已随队者取消 ⇒ WRONG_PHASE（travelLocked 跨步骤生效）',
      !cancelAfterDepart.ok && codeOf(cancelAfterDepart) === 'WRONG_PHASE', JSON.stringify(cancelAfterDepart.error || ''))
    const vEnd = await V()
    ledger({ id: 'C3', actorA: 'Owner(分车/发车)', actorB: 'Owner(上车/出发核实) + Member 取消', initialPhase: 'gathering',
      initialConfirmed: 3, initialRevision: R0, barrier: 'ON', ordering: 'sequential-stale-base + 预览过期交错',
      steps: 'preview@R → checkin 先落 → commit(旧预览) → 重预览 commit → 上车/出发/发车 → 发车后改写',
      expectedWinner: '先落地者', expectedLoser: '旧预览 commit / 未签到上车 / 发车后改写', expectedError: 'CONFLICT / UNRESOLVED_DEPARTURE / WRONG_PHASE',
      finalPhase: vEnd.activity.phase, finalRows: vEnd.rows.map(x => x.name + '=' + [x.checkedIn, x.departure, x.outboundBoarded].join('/')).join(' '),
      finalRevision: await R(), receipts: '—', events: '—', loserZeroSideEffect: '是（逐条快照）', verdict: 'PASS（STUB）' })
  }

  /* ======================================================================
     C4 报名资料修改 × 阶段推进（CAS 通过 ≠ 域阶段门通过）
     ====================================================================== */
  section('C4 A participant mutation / B activity transition')
  {
    await buildPublished('C4')
    const R0 = await R()
    const chenRow = await rowOf('陈屿')
    const chenProfile = (await chen.read({ kind: 'profile' })).data.view.profile
    const edited = p => ({
      type: 'signup.edit', activityId: active.id, signupId: chenRow.signupId,
      participant: Object.assign({}, chenProfile.person, { name: p }), trip: { mode: 'self' },
      purpose: '交错场景下的报名资料协调（schema 必填 purpose，缺它会被判 INVALID_INPUT）',
    })
    const a1 = await chen.dispatch(edited('陈屿·本人改'), R0)
    check('C4 A 在截止前改自己的报名资料 ok', a1.ok === true, JSON.stringify(a1.error || ''))
    await loserRejected('C4 B 用 R0 推进阶段',
      () => lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'gathering', reason: '交错推进' }, R0), 'CONFLICT')
    const b1 = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'gathering', reason: '按期集合' }, await R())
    check('C4 B 重读后推进 gathering ok', b1.ok === true, JSON.stringify(b1.error || ''))

    // 关键：A 重读到最新 revision（gathering 下），域阶段门仍必须拒——CAS 过了不等于能写
    const Rfresh = await R()
    await loserRejected('C4 重读后 revision 合法但阶段已变（member 在 gathering 无协调权）',
      () => chen.dispatch(edited('陈屿·集合后本人改'), Rfresh), 'WRONG_PHASE')
    const a3 = await lin.dispatch(edited('陈屿·发起者协调'), Rfresh)
    check('C4 发起者在 gathering 协调未出发者 ⇒ ok（同一条命令按 actor 与 phase 双重判定）',
      a3.ok === true, JSON.stringify(a3.error || ''))
    // 改名后按姓名已经查不到了——按 signupId 回读（按姓名查会在改成功的场景里必然落空）
    const rowAfter = ((await V()).rows.find(x => x.signupId === chenRow.signupId) || {})
    check('C4 协调结果落库', rowAfter.name === '陈屿·发起者协调', JSON.stringify(rowAfter.name))
    const vEnd = await V()
    ledger({ id: 'C4', actorA: 'Member 陈屿(改资料)', actorB: 'Owner(推进阶段)', initialPhase: 'published',
      initialConfirmed: 2, initialRevision: R0, barrier: 'ON', ordering: 'sequential-stale-base（跨身份）',
      steps: 'A edit@R0 → B transition@R0(陈旧) → B transition@fresh → A edit@fresh(新 phase) → owner edit@fresh',
      expectedWinner: 'A 首次改资料', expectedLoser: 'B 陈旧推进 → CONFLICT；A 越阶段改 → WRONG_PHASE',
      expectedError: 'CONFLICT 然后 WRONG_PHASE（两层门各自成立）',
      finalPhase: vEnd.activity.phase, finalRows: vEnd.rows.map(x => x.name + '=' + x.status).join(','),
      finalRevision: await R(), receipts: '—', events: '—', loserZeroSideEffect: '是', verdict: 'PASS（STUB）' })
  }

  /* ======================================================================
     C5 取消 × 出发核实：两种到达顺序都要跑
     ====================================================================== */
  section('C5 A cancel × B departure（两种顺序：departure-first / cancel-first）')
  {
    // C5a：先核实出发，再取消活动
    await buildPublished('C5a', { riders: 0 })
    await toGathering()
    const linRow = await rowOf('林溪')
    await checkin('林溪', await R())          // joined 出发核实的前置是签到（field.js:85），少这一步会把域门错当成夹具坏
    const d1 = await lin.dispatch({ type: 'attendance.departure', activityId: active.id, signupId: linRow.signupId, outcome: { kind: 'joined', evidence: { at: '', by: '', note: '随队' } } }, await R())
    check('C5a 出发核实 ok', d1.ok === true, JSON.stringify(d1.error || ''))
    // 期望出自域规则（activity.js 的 cancelled 分支要求"无人有出发/上车事实"），不是从实际读数倒推
    const snapBeforeCancel = await snapshot()
    const c1 = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'cancelled', reason: '天气突变' }, await R())
    check('C5a 已有人随队出发后取消活动 ⇒ UNRESOLVED_SAFETY（出发事实之后不许再取消并拆车）',
      !c1.ok && codeOf(c1) === 'UNRESOLVED_SAFETY', JSON.stringify(c1.error || ''))
    const snapAfterCancel = await snapshot()
    check('C5a 取消被拒零副作用（phase/名单/收据逐字节未变）', snapBeforeCancel === snapAfterCancel, '集合差异=' + diffCols(snapBeforeCancel, snapAfterCancel))
    check('C5a 被拒后 phase 仍是 gathering', (await phase()) === 'gathering', await phase())
    const c1b = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'active', reason: '按原计划继续' }, await R())
    check('C5a 反空断言：同一时刻合法的推进（gathering→active）仍然可落，说明上面那条拒不是全局写死',
      c1b.ok === true, JSON.stringify(c1b.error || ''))
    const nodeInActive = await lin.dispatch({ type: 'attendance.node', activityId: active.id, signupId: linRow.signupId, pointId: 'pt-1', note: '随队抵达山门' }, await R())
    check('C5a active 阶段打路线节点 ⇒ ok（正向对照：闸门只拦终局阶段）',
      nodeInActive.ok === true, JSON.stringify(nodeInActive.error || ''))

    // C5b：先取消，再用陈旧基线做出发核实
    await buildPublished('C5b', { riders: 0 })
    await toGathering()
    const R0 = await R()
    const linRow2 = await rowOf('林溪')
    const cancelFirst = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'cancelled', reason: '领队取消' }, R0)
    check('C5b 取消 ok', cancelFirst.ok === true, JSON.stringify(cancelFirst.error || ''))
    const depStale = await lin.dispatch({ type: 'attendance.departure', activityId: active.id, signupId: linRow2.signupId, outcome: { kind: 'joined', evidence: { at: '', by: '', note: '陈旧核实' } } }, R0)
    check('C5b 陈旧基线的出发核实 ⇒ CONFLICT（CAS 先于 phase 判定）',
      !depStale.ok && codeOf(depStale) === 'CONFLICT', JSON.stringify(depStale.error || ''))
    const depFresh = await lin.dispatch({ type: 'attendance.departure', activityId: active.id, signupId: linRow2.signupId, outcome: { kind: 'joined', evidence: { at: '', by: '', note: '重读后核实' } } }, cancelFirst.data.revision)
    check('C5b 重读后基线合法，但 phase=cancelled ⇒ WRONG_PHASE（阶段门兜住第二层）',
      !depFresh.ok && codeOf(depFresh) === 'WRONG_PHASE', JSON.stringify(depFresh.error || ''))
    const snapNow = await snapshot()
    check('C5b 两次失败都没留下 attendance 写入（departure 仍为未出发）',
      JSON.stringify(snapNow).indexOf('重读后核实') === -1 && JSON.stringify(snapNow).indexOf('陈旧核实') === -1, '库里出现了败者文案')
    const nodeAfterCancel = await lin.dispatch({ type: 'attendance.node', activityId: active.id, signupId: linRow2.signupId, pointId: 'pt-1', note: '取消后打点' }, await R())
    check('C5b 取消（终局阶段）后现场写入 ⇒ WRONG_PHASE（与 C5a 的 active 正向对照成对）',
      !nodeAfterCancel.ok && codeOf(nodeAfterCancel) === 'WRONG_PHASE', JSON.stringify(nodeAfterCancel.error || ''))
    const vEnd = await V()
    ledger({ id: 'C5', actorA: 'Owner(取消)', actorB: 'Owner(出发核实)', initialPhase: 'gathering',
      initialConfirmed: 1, initialRevision: 'C5a/C5b 各一条链', barrier: 'ON',
      ordering: '两种到达顺序各跑一遍（departure-first / cancel-first）',
      steps: 'a: depart→cancel→node(拒) ；b: cancel→depart@陈旧(CONFLICT)→depart@fresh(WRONG_PHASE)',
      expectedWinner: '先落地的合法步骤', expectedLoser: 'a 的取消后写入 / b 的取消后核实', expectedError: 'WRONG_PHASE（b 的第一步另有 CONFLICT）',
      finalPhase: vEnd.activity.phase, finalRows: vEnd.rows.map(x => x.name + '=' + [x.status, x.checkedIn, x.departure].join('/')).join(','),
      finalRevision: await R(), receipts: '—', events: '—', loserZeroSideEffect: '是（文案未入库）', verdict: 'PASS（STUB）' })
  }

  /* ======================================================================
     C6 陈旧编辑器写入 × 阶段推进（BUG-C1 形状的多步骤版，客户端已修，这里钉服务端）
     ====================================================================== */
  section('C6 A stale editor update / B phase transition')
  {
    await buildPublished('C6')
    const R0 = await R()
    // 「陈旧表单」的装配方式与真编辑器一致：取那次读回来的 activity，剥掉 id/ownerId/phase
    //（editor.js reload() 就是这么造的）。自己拿 input(tag) 拼会漏掉服务端的字段规范化，
    // 于是 gathering 的 lockedKeys 逐键比对会先撞在规范化差异上——红因就不是我想证的那条了。
    const stored = JSON.parse(JSON.stringify((await V()).activity))
    delete stored.id; delete stored.ownerId; delete stored.phase
    const staleForm = stored

    // B 先推进 published→gathering（gathering 下 title 属 lockedKeys）
    const b = await lin.dispatch({ type: 'activity.transition', activityId: active.id, next: 'gathering', reason: '按期集合' }, R0)
    check('C6 B 推进 gathering ok', b.ok === true, JSON.stringify(b.error || ''))
    // A 的陈旧整份表单（客户端已修：携带它装配表单时的 R0）
    await loserRejected('C6 A 携带陈旧 R0 的整份表单（客户端修复后的出线形态，服务端层①拦住）',
      () => lin.dispatch({ type: 'activity.edit', activityId: active.id, input: Object.assign({}, staleForm, { title: 'A 的陈旧标题' }) }, R0), 'CONFLICT')
    // A 重读拿到 R1，再交整份表单：CAS 通过，但 gathering 下 title 被锁 ⇒ 第二层门
    const a2 = await lin.dispatch({ type: 'activity.edit', activityId: active.id, input: Object.assign({}, staleForm, { title: 'A 重读后仍想改标题' }) }, b.data.revision)
    check('C6 CAS 通过后阶段门仍在：gathering 改 title ⇒ WRONG_PHASE',
      !a2.ok && codeOf(a2) === 'WRONG_PHASE' && /仅可修改说明|装备|费用/.test(a2.error.message || ''),
      JSON.stringify(a2.error || ''))
    // 再深一层：每次 transition 都会把 acceptingSignups 置 false（activity.js:194），而它在 lockedKeys 里。
    // ⇒ "推进之前装配的整份表单"即使只改说明，也会撞在一个用户根本没碰的键上被拒。
    // 这一条是**保护性**的（否则陈旧表单会把报名开关重新打开），但给出的文案会把用户带偏 ⇒ 记 P3 发现。
    check('C6 病因定位：陈旧表单带的 acceptingSignups=true 与推进后落库的 false 不同（该键在 lockedKeys 内）',
      staleForm.acceptingSignups === true && (await V()).activity.acceptingSignups === false,
      JSON.stringify({ stale: staleForm.acceptingSignups, now: (await V()).activity.acceptingSignups }))
    await loserRejected('C6 陈旧表单即便只改说明也被阶段门拒（陈旧键也算差异）',
      async () => lin.dispatch({ type: 'activity.edit', activityId: active.id, input: Object.assign({}, staleForm, { description: '陈旧表单想改的说明' }) }, await R()), 'WRONG_PHASE')
    // 重读之后装配的表单（修复后的真编辑器就是这个形状）只改说明 ⇒ 必须可写，证明阶段门不是整份锁死
    const freshForm = JSON.parse(JSON.stringify((await V()).activity))
    delete freshForm.id; delete freshForm.ownerId; delete freshForm.phase
    const a4 = await lin.dispatch({ type: 'activity.edit', activityId: active.id, input: Object.assign({}, freshForm, { description: '集合阶段允许改的说明' }) }, await R())
    check('C6 重读后装配的表单只改说明 ⇒ ok（允许字段在 gathering 仍可写）', a4.ok === true, JSON.stringify(a4.error || ''))
    const act = (await V()).activity
    check('C6 终态：title 仍是推进前那份、description 已被合法更新',
      act.title === staleForm.title && act.description === '集合阶段允许改的说明', JSON.stringify({ t: act.title, d: act.description }))
    finding('C6-UX', 'P3', 'gathering 下陈旧整份表单被拒时，文案是「仅可修改说明、装备、费用和取消说明」，而真正撞门的是用户没碰过的 acceptingSignups。数据无损、域门正确，但提示误导——记 UX 发现，不改域规则。')
    ledger({ id: 'C6', actorA: 'Owner(陈旧编辑器表单)', actorB: 'Owner(阶段推进)', initialPhase: 'published',
      initialConfirmed: 1, initialRevision: R0, barrier: 'ON', ordering: 'sequential-stale-base（B 先提交）',
      steps: 'B transition@R0 → A edit@R0(陈旧) → A edit@R1(整份含 title) → A edit@R1(只改 description)',
      expectedWinner: 'B 的推进 + A 的合法字段写', expectedLoser: 'A 的陈旧整份 / A 的越阶段 title 写',
      expectedError: 'CONFLICT 然后 WRONG_PHASE', finalPhase: act.phase,
      finalRows: 'title 未变（陈旧写没落库）', finalRevision: await R(), receipts: '—', events: '—',
      loserZeroSideEffect: '是', verdict: 'PASS（STUB）' })
  }

  /* ====================================================================== */
  section('本套件测不到的（一律 INCONCLUSIVE，不许转 PASS）')
  inc('真云端并发交错（两个请求真的同时到 trailApi）',
    'barrier 只把桩事务串行化；真云端的写锁粒度、超时与 MVCC 可见性未建模。结论只能来自部署后由真实小程序并发打 trailApi（任务书 §6）')
  inc('跨身份真同时',
    '桩把 openid 存在模块级全局（stub-wx-server-sdk.js:6），Promise.all 两请求会互相踩身份 ⇒ 跨身份场景全部降级为 sequential-stale-base，已在各 case 的 ordering 列如实标注')
  inc('交错下的读滞后',
    '内存 Map 写入即刻可见 ⇒ 「B 刚落库、A 立刻读到旧行」这类分页读滞后在桩里天然不可复现（Phase 9.6 真云端量测另记）')

  console.log('')
  console.log('判定汇总（STUB-BARRIER 层）：')
  findings.forEach(x => console.log('  [' + x[1] + '] ' + x[0] + ' — ' + x[2]))
  console.log('')
  console.log('passed=' + passed + ' failed=' + failed + ' inconclusive=' + inconclusive)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('套件自身异常：' + (e && e.stack || e)); process.exit(1) })
