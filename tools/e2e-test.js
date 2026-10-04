// 端到端（服务链路）：node tools/e2e-test.js
// 把「客户端会发出的真实信封」直接打进 trailApi 的 exports.main——真实动作路由、overrideEvidence、
// requestId 幂等、revision CAS、{ok,data}/{ok,error} 信封、store 持久化——再用读动作回读验证落库结果。
// 与既有测试的分工：smoke/scenario-* 都绕过 index.js（直接调 domain / 桩掉 api.js），本套件补
// 「main 打进 → read 验证」的整链，也正是 allocation.js 惰性 require 这类「只炸在读动作」缺陷的收口层。
// wx-server-sdk 用内存桩（tools/stub-wx-server-sdk.js，与 trailapilab-test 同法）：不发网络、不动云端数据。
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
stub.__state.db = stub.__fakeDb() // index.js 在模块加载时即调 cloud.database()，须先就位

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const trailApi = require('../cloudfunctions/trailApi/index')

const LIN = 'o-lin-openid'   // 发起人
const CHEN = 'o-chen-openid' // 报名参与者

// ---- 信封助手：按客户端 utils/api.js 的真实入参形状打 main ----
// openid 必须在每次调用时设置：助手们都在模块顶部创建，构造时固化会被后创建者覆盖
function as(openid) {
  const call = (action, extra) => {
    stub.__state.openid = openid
    return trailApi.main(Object.assign({ action }, extra))
  }
  return {
    read: request => call('read', { request }),
    readForm: (activityId, signupId, purpose) => call('readForm', { activityId, signupId, purpose }),
    readTransport: activityId => call('readTransport', { activityId }),
    readExport: (activityId, signupIds, mode, purpose) => call('readExport', { activityId, signupIds, mode, purpose }),
    previewAssignments: activityId => call('previewAssignments', { activityId }),
    dispatch: (payload, expectedRevision, requestId) => call('dispatch', { payload, expectedRevision, requestId }),
  }
}
const lin = as(LIN)
const chen = as(CHEN)

const person = (name, phone, ename, ephone) => ({ name, phone, emergency: { name: ename, phone: ephone }, medical: '', avatar: '' })

function fullActivityInput() {
  // 形状对齐 smoke-test 的合法 fixture；日期推远保证与真实时钟无关
  return {
    title: '龙泉山', description: '轻徒步', organizerIntro: '林溪带队',
    startAt: '2026-10-11T08:00:00+08:00', endAt: '2026-10-11T18:00:00+08:00', deadlineAt: '2026-10-10T20:00:00+08:00',
    acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
    routeSnapshot: {
      title: '飞泉沟', distanceKm: 12.8, ascentM: 680,
      points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 } },
        { id: 'pt-2', name: '观景台', kind: 'finish', coordinates: null }],
      risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }],
    },
    pickupPoints: [{ id: 'pk-1', name: '茶店子', meetingAt: '2026-10-11T07:00:00+08:00', address: '地铁口', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }
}

async function main() {
  let activityId = ''
  let chenSignupId = ''
  let linSignupId = ''
  let wangCompanionId = ''
  let v1Id = ''

  section('1. 建档 → 发布（发布即报名）：dispatch 落库 → read 回读')
  {
    let r = await lin.dispatch({ type: 'profile.save', person: person('林溪', '00000000001', '林母', '00000000051') }, 0)
    check('profile.save → 信封 ok 且 revision 推进', r.ok === true && r.data.revision === 1, JSON.stringify(r))
    r = await lin.read({ kind: 'profile' })
    check('read profile：写入的姓名可回读（write → read 回环）',
      r.ok && r.data.view.kind === 'profile' && r.data.view.profile.person.name === '林溪', JSON.stringify(r.data && r.data.view.kind))
    r = await lin.dispatch({ type: 'activity.create', input: fullActivityInput() }, r.data.revision)
    check('activity.create → 草稿', r.ok === true, JSON.stringify(r.error || ''))
    activityId = r.data.targetIds[0]
    const profile = (await lin.read({ kind: 'profile' })).data.view.profile
    r = await lin.dispatch({
      type: 'activity.publish', activityId,
      participation: {
        personRef: { kind: 'user', userId: LIN }, participant: profile.person,
        trip: { mode: 'shared', pickupPointId: 'pk-1' },
        consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
      },
    }, r.data.revision)
    check('activity.publish（发布即报名）→ published + 本人 confirmed', r.ok === true, JSON.stringify(r))
    r = await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })
    check('read organizer 视角：confirmed=1',
      r.data.view.counters.confirmed === 1, JSON.stringify(r.data.view.counters))
    r = await lin.read({ kind: 'activity', activityId, perspective: 'participant' })
    check('participant 视角开放报名（signup.submit 在 permittedActions，报名页的准入闸门）',
      r.data.view.kind === 'activity' && r.data.view.permittedActions.indexOf('signup.submit') !== -1,
      JSON.stringify(r.data.view.permittedActions))
  }

  section('2. 报名链：常用同行人 → 整组提交 → 审核 → 幂等重放')
  {
    // expectedRevision 传 undefined → 服务端按当前 revision 提交（建档是幂等安全的准备步骤）
    let r = await chen.dispatch({ type: 'profile.save', person: person('陈屿', '00000000002', '陈父', '00000000052') })
    check('陈屿建档 ok', r.ok === true, JSON.stringify(r.error || ''))
    const rev = r.data.revision
    r = await chen.dispatch({ type: 'companion.save', companionId: null, person: person('王五', '00000000003', '王母', '00000000053') }, rev)
    check('companion.save（常用同行人落库）ok', r.ok === true, JSON.stringify(r.error || ''))
    wangCompanionId = (await chen.read({ kind: 'profile' })).data.view.profile.companions[0].id
    const profile = (await chen.read({ kind: 'profile' })).data.view.profile
    r = await chen.dispatch({
      type: 'signup.submit', activityId, keepTogether: true, mode: 'apply',
      participants: [
        { personRef: { kind: 'user', userId: CHEN }, participant: profile.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } },
        { personRef: { kind: 'companion', ownerId: CHEN, companionId: wangCompanionId }, participant: person('王五', '00000000003', '王母', '00000000053'), trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: true, proxyHome: false } },
      ],
    }, r.data.revision)
    check('signup.submit（本人+同行人整组）→ pending', r.ok === true, JSON.stringify(r.error || ''))
    const view = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view
    const pendingRows = view.rows.filter(x => x.status === 'pending')
    check('organizer 名单可见 2 条待审核（含同行人王五）',
      pendingRows.length === 2 && pendingRows.some(x => x.name === '王五'), JSON.stringify(view.rows.map(x => x.name)))
    chenSignupId = view.rows.find(x => x.name === '陈屿').signupId
    const requestId = 'e2e-review-1'
    r = await lin.dispatch({ type: 'signup.review', activityId, signupIds: pendingRows.map(x => x.signupId), decision: 'confirm' }, view.revision, requestId)
    check('signup.review 批量确认 ok', r.ok === true, JSON.stringify(r.error || ''))
    const after = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view
    check('审核后 confirmed=3（林溪+陈屿+王五）', after.counters.confirmed === 3, JSON.stringify(after.counters))
    const replay = await lin.dispatch({ type: 'signup.review', activityId, signupIds: pendingRows.map(x => x.signupId), decision: 'confirm' }, after.revision, requestId)
    const again = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view
    check('同 requestId 重放 → replayed=true 且零副作用',
      replay.ok === true && replay.data.replayed === true && again.counters.confirmed === 3, JSON.stringify(replay.data))
  }

  section('3. 分车链：参与者司机 → 预览（修复回归点）→ 提交 → CAS 冲突')
  {
    let rev = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.revision
    let r = await lin.dispatch({
      type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '1号车', plate: 'A12345', legalCapacity: 7, blockedSeats: 0, drivers: [{ kind: 'participant', signupId: chenSignupId }], seatLabels: ['01', '02', '03', '04', '05', '06'], pickupPointIds: ['pk-1'] },
    }, rev)
    check('vehicle.save（陈屿=参与者司机）ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'activity.transition', activityId, next: 'gathering', reason: '按期集合' }, r.data.revision)
    check('推进 gathering ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.previewAssignments(activityId)
    check('previewAssignments → ok（惰性 require 修复回归点；此前此处 Cannot find module）', r.ok === true, JSON.stringify(r.error || r))
    const plan = r.data
    linSignupId = ((await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.rows.find(x => x.name === '林溪') || {}).signupId
    check('方案：林溪+王五入列、司机陈屿不占乘客位、无人淘汰',
      plan.assignments.length === 2
      && plan.assignments.some(a => a.signupId === linSignupId)
      && plan.assignments.every(a => a.signupId !== chenSignupId)
      && plan.unassigned.length === 0, JSON.stringify(plan))
    check('plan 形状 = preview 契约（activityId/baseRevision/assignments/unassigned）',
      plan.activityId === activityId && Number.isInteger(plan.baseRevision)
      && plan.assignments.every(a => a.activityId === activityId && 'seatLabel' in a), JSON.stringify(Object.keys(plan)))
    // CAS：用过期 revision 提交 → CONFLICT，且不落任何变更
    r = await lin.dispatch({ type: 'activity.transition', activityId, next: 'active', reason: '越级推进（应被拒）' }, 1, 'e2e-conflict-1')
    check('过期 revision → CONFLICT 信封', r.ok === false && r.error.code === 'CONFLICT', JSON.stringify(r))
    const phase = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.activity.phase
    check('CONFLICT 不产生副作用（阶段未变）', phase === 'gathering', phase)
    r = await lin.dispatch({ type: 'assignment.commit', activityId, preview: plan }, plan.baseRevision)
    check('assignment.commit（提交预览方案）ok', r.ok === true, JSON.stringify(r.error || ''))
    const tr = await lin.readTransport(activityId)
    check('readTransport 回读：2 条安排都在 1号车、司机无乘客安排',
      tr.ok && tr.data.ok !== false && tr.data.value.assignments.length === 2
      && tr.data.value.assignments.every(a => a.vehicleId === plan.assignments[0].vehicleId)
      && tr.data.value.assignments.every(a => a.signupId !== chenSignupId), JSON.stringify(tr.data && tr.data.value && tr.data.value.assignments))
    v1Id = plan.assignments[0].vehicleId
  }

  section('4. 域规则对齐：参与者司机不占乘客位（DRIVER_CONFLICT），手动指派可改派，占座冲突被拒（SEAT_TAKEN）')
  {
    const rev = async () => (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.revision
    let r = await lin.dispatch({
      type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '2号车', plate: 'B67890', legalCapacity: 5, blockedSeats: 0, drivers: [{ kind: 'service', name: '服务司机', phone: '00000000009', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] },
    }, await rev())
    check('vehicle.save（服务司机）ok', r.ok === true, JSON.stringify(r.error || ''))
    const v2Id = r.data.targetIds[0]
    const wangSignupId = ((await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.rows.find(x => x.name === '王五') || {}).signupId
    r = await lin.dispatch({ type: 'assignment.set', activityId, target: { signupId: chenSignupId, vehicleId: v2Id, seatLabel: null } }, await rev())
    check('给参与者司机安排乘客座 → DRIVER_CONFLICT（司机不重复占座，UI 过滤的域规则依据）',
      r.ok === false && r.error.code === 'DRIVER_CONFLICT', JSON.stringify(r.error || r))
    r = await lin.dispatch({ type: 'assignment.set', activityId, target: { signupId: wangSignupId, vehicleId: v2Id, seatLabel: null } }, await rev())
    check('改派王五至 2号车（不编座号 → seatLabel null）ok', r.ok === true, JSON.stringify(r.error || ''))
    let tr = await lin.readTransport(activityId)
    const onV2 = tr.data.value.assignments.filter(a => a.vehicleId === v2Id)
    check('readTransport 回读：王五已在 2号车', onV2.length === 1 && onV2[0].signupId === wangSignupId && onV2[0].seatLabel === null,
      JSON.stringify(tr.data.value.assignments))
    // —— 确定性座位空间 ——
    // 自动方案只把 1号车 seatLabels 里自然序最低的空座发出去，且不重排既有座位（allocation.js:84-90），
    // 所以 2 位乘客占的是 {'01','02'} 这个**集合**；至于谁占 01 谁占 02 取决于 signupId 的自然序，
    // 而 signupId 带 genId 的同毫秒随机后缀（contracts.js:37）→ 写死「王五原本坐 02」必然偶发翻车（SEAT_TAKEN）。
    // 解法：先按本 fixture 的独立输入（seatLabels 列表 + 只占了 01/02）把林溪显式安置到 '05'，
    // 此后 1号车的占用集合就完全由我们的输入决定：'02' 必空、'05' 必被林溪占——
    // 期望值来自域规则与输入，不回读实际座号（回读当期望即自证循环）。
    const FREE_SEAT = '02'
    const TAKEN_SEAT = '05'
    r = await lin.dispatch({ type: 'assignment.set', activityId, target: { signupId: linSignupId, vehicleId: v1Id, seatLabel: TAKEN_SEAT } }, await rev())
    check('显式安置林溪到 1号车 ' + TAKEN_SEAT + ' 座（把座位空间变成 fixture 已知量）ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'assignment.set', activityId, target: { signupId: wangSignupId, vehicleId: v1Id, seatLabel: FREE_SEAT } }, await rev())
    check('改派王五回 1号车 ' + FREE_SEAT + ' 座 ok', r.ok === true, JSON.stringify(r.error || ''))
    tr = await lin.readTransport(activityId)
    check('回读：仍共 2 条安排（改派不产生重复行）',
      tr.data.value.assignments.length === 2, JSON.stringify(tr.data.value.assignments))
    check('回读：两人座号等于显式输入（王五=' + FREE_SEAT + '、林溪=' + TAKEN_SEAT + '）',
      tr.data.value.assignments.length === 2
      && (tr.data.value.assignments.find(a => a.signupId === wangSignupId) || {}).seatLabel === FREE_SEAT
      && (tr.data.value.assignments.find(a => a.signupId === linSignupId) || {}).seatLabel === TAKEN_SEAT,
      JSON.stringify(tr.data.value.assignments))
    r = await lin.dispatch({ type: 'assignment.set', activityId, target: { signupId: wangSignupId, vehicleId: v1Id, seatLabel: TAKEN_SEAT } }, await rev())
    check('同一座位安排两人 → SEAT_TAKEN（此前两层 E2E 对该错误码零覆盖）',
      r.ok === false && r.error.code === 'SEAT_TAKEN', JSON.stringify(r.error || r))
    tr = await lin.readTransport(activityId)
    check('SEAT_TAKEN 拒绝后零副作用（王五仍在 ' + FREE_SEAT + ' 座）',
      (tr.data.value.assignments.find(a => a.signupId === wangSignupId) || {}).seatLabel === FREE_SEAT,
      JSON.stringify(tr.data.value.assignments))
  }

  section('5. 现场链：逐人签到/上车/出发核实（域规则：joined 乘客需签到+上车，参与者司机免上车）；证据由服务端覆写')
  {
    const rows = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.rows
    const ids = {}
    for (const row of rows) ids[row.name] = row.signupId
    const rev = async () => (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.revision
    const checkin = async signupId => lin.dispatch({ type: 'attendance.checkin', activityId, signupId, checkIn: { method: 'manual', evidence: { at: '', by: '', note: '集合点人工核实' } } }, await rev())
    const board = async (signupId, note) => lin.dispatch({ type: 'attendance.board', activityId, signupId, leg: 'outbound', boarded: true, note }, await rev())
    const depart = async (signupId, note) => lin.dispatch({ type: 'attendance.departure', activityId, signupId, outcome: { kind: 'joined', evidence: { at: '', by: '', note } } }, await rev())
    let r = await checkin(ids['林溪'])
    check('签到：evidence 只带 note 也能过（服务端 overrideEvidence 补 at/by）', r.ok === true, JSON.stringify(r.error || ''))
    r = await board(ids['林溪'], '清点上车')
    check('林溪上车（前置=已有座位安排）ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await depart(ids['林溪'], '随队出发')
    check('林溪出发核实 joined ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await board(ids['陈屿'], '司机想上车（应被拒）')
    check('参与者司机无乘客座位安排 → 上车被拒', r.ok === false, JSON.stringify(r.error || r))
    r = await checkin(ids['陈屿'])
    check('司机签到 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await depart(ids['陈屿'], '本人驾车随队')
    check('司机出发核实 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'activity.transition', activityId, next: 'active', reason: '全员到齐发车' }, await rev())
    check('未核实完就推进 active → UNRESOLVED_DEPARTURE（还差王五）',
      r.ok === false && r.error.code === 'UNRESOLVED_DEPARTURE', JSON.stringify(r.error || r))
    r = await checkin(ids['王五'])
    check('王五签到 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await board(ids['王五'], '清点上车')
    check('王五上车 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await depart(ids['王五'], '随队出发')
    check('王五出发核实 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'activity.transition', activityId, next: 'active', reason: '全员到齐发车' }, await rev())
    check('全员核实后推进 active ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'attendance.node', activityId, signupId: ids['林溪'], pointId: 'pt-1', note: '全队抵达山门' }, await rev())
    check('节点确认 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'activity.transition', activityId, next: 'closing', reason: '返程收尾' }, await rev())
    check('推进 closing ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'attendance.home', activityId, signupId: ids['林溪'], note: '家属电话确认到家' }, await rev())
    check('到家确认 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'activity.transition', activityId, next: 'archived', reason: '结档归档' }, await rev())
    check('还有未到家者 → 归档被拒（UNRESOLVED_SAFETY：人人闭环才能归档）',
      r.ok === false && r.error.code === 'UNRESOLVED_SAFETY', JSON.stringify(r.error || r))

    // 收尾阶段的读面：导出与「按用途读他人」依赖工作数据能力，归档即关闭——必须在归档前发生
    const closingRows = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.rows
    const allIds = closingRows.map(x => x.signupId)
    let r2 = await lin.readExport(activityId, allIds, 'sensitive', '结档归档留存安全联络')
    check('readExport（敏感名单导出）→ Result ok 且含三人',
      r2.ok && r2.data.ok === true && JSON.stringify(r2.data.value).indexOf('王五') !== -1
      && JSON.stringify(r2.data.value).indexOf('陈屿') !== -1, JSON.stringify(r2.data && r2.data.error))
    r2 = await chen.readForm(activityId, chenSignupId, '更新上车点')
    check('readForm 本人带用途读取 ok 且回填 person',
      r2.ok && r2.data.ok === true && r2.data.value.input.participant.name === '陈屿', JSON.stringify(r2.data && r2.data.error))
    r2 = await chen.readForm(activityId, chenSignupId, '')
    check('本人空用途读取自己 → 放行（用途门槛保护的是读取他人，读自己无需说明）',
      r2.ok && r2.data.ok === true, JSON.stringify(r2.data && r2.data.error))
    r2 = await chen.readForm(activityId, allIds.find(id => id !== chenSignupId), '随便看看')
    check('读他人报名资料且无工作身份 → 拒绝', r2.ok && r2.data.ok === false, JSON.stringify(r2.data))
    r2 = await lin.readForm(activityId, chenSignupId, '')
    check('组织者读他人不写用途 → 拒绝（用途门槛在服务端）', r2.ok && r2.data.ok === false, JSON.stringify(r2.data))
    r2 = await lin.readForm(activityId, chenSignupId, '行前核对上车点')
    check('组织者写明用途读他人 → ok', r2.ok && r2.data.ok === true, JSON.stringify(r2.data && r2.data.error))

    r = await lin.dispatch({ type: 'attendance.home', activityId, signupId: ids['王五'], note: '本人报平安' }, await rev())
    check('王五到家 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'attendance.home', activityId, signupId: ids['陈屿'], note: '司机到家确认' }, await rev())
    check('司机到家 ok', r.ok === true, JSON.stringify(r.error || ''))
    r = await lin.dispatch({ type: 'activity.transition', activityId, next: 'archived', reason: '结档归档' }, await rev())
    check('全员闭环后推进 archived ok', r.ok === true, JSON.stringify(r.error || ''))
  }

  section('6. 归档后：detailState=finished；工作数据能力关闭（导出与用途读取被拒）')
  {
    let r = await lin.read({ kind: 'activity', activityId, perspective: 'participant' })
    check('归档后参与者视角 detailState=finished',
      r.data.view.kind === 'activity' && r.data.view.detailState === 'finished', JSON.stringify(r.data.view.detailState))
    const rows = (await lin.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.rows
    r = await lin.readExport(activityId, rows.map(x => x.signupId), 'sensitive', '归档后补导出')
    check('归档后导出 → 拒绝（工作数据能力随归档关闭）',
      r.ok && r.data.ok === false, JSON.stringify(r.data))
    r = await lin.readForm(activityId, rows.find(x => x.name === '陈屿').signupId, '归档后补读')
    check('归档后按用途读他人 → 拒绝', r.ok && r.data.ok === false, JSON.stringify(r.data))
  }

  section('7. 边界：未知动作 / 未登录 / 越权预览')
  {
    let r = await trailApi.main({ action: 'nope' })
    check('未知动作 → INVALID_INPUT 未知操作', r.ok === false && r.error.code === 'INVALID_INPUT' && r.error.message.indexOf('未知操作') === 0, JSON.stringify(r.error))
    stub.__state.openid = ''
    r = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
    check('无 openid → AUTH_REQUIRED', r.ok === false && r.error.code === 'AUTH_REQUIRED', JSON.stringify(r.error))
    stub.__state.openid = CHEN
    r = await chen.previewAssignments(activityId)
    check('非组织者预览分车 → 拒绝', r.ok === false, JSON.stringify(r.error || r))
    stub.__state.openid = LIN
  }

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('E2E 执行异常：', e && (e.stack || e.message || e)); process.exit(1) })
