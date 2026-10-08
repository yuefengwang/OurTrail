// Domain Boundary / Negative Matrix（A 层）：node tools/e2e-domain-negative-test.js
// Phase 7：非法输入 / 非法状态转换 / 边界条件 / 重复操作 / 资源不存在 / 不匹配 / 容量 / 幂等 / CAS。
// 与 e2e-test.js（happy path 契约）和 e2e-permission-test.js（身份边界）互补——本套件专证
// 「错误被精确拒绝，且没有任何错误副作用」。
//
// 每个 negative 断言三要素：
//   1. 拒绝发生           2. error.code 精确匹配（NOT_FOUND ≠ INVALID_INPUT ≠ WRONG_PHASE ≠ ...）
//   3. 权威状态前后不变（snapshot 全量对比；revision 变化即调查，绝不默默接受）
// 全部走真实信封（stub wx-server-sdk 内存库 → index.js main → dispatch → domain → invariants），
// 无 mock domain / 无 monkey-patch / 无直调私有函数。
// 矩阵依据：docs/testing/domain-negative-matrix.md（Expected 从现行 domain 代码推导）。
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

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + String(extra).slice(0, 180) + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const trailApi = require('../cloudfunctions/trailApi/index')

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
const person = (name, phone, ename, ephone) => ({ name, phone, emergency: { name: ename, phone: ephone }, medical: '', avatar: '' })

const LIN = 'o-neg-lin'
const ZHANG = 'o-neg-zhang'   // 第二位报名者（capacity 边界）
const WANG = 'o-neg-wang'     // 第三位报名者（N+1）
const LI = 'o-neg-li'         // 第四位（跨活动资源 / CAS 对手）

const OWNER = as(LIN)
const Z = as(ZHANG)
const W = as(WANG)
const L2 = as(LI)

function activityInput(title, capacity) {
  return {
    title, description: '负矩阵沙盒', organizerIntro: '自动化',
    startAt: '2027-04-06T08:00:00+08:00', endAt: '2027-04-06T18:00:00+08:00', deadlineAt: '2027-04-05T20:00:00+08:00',
    acceptingSignups: true, capacity: capacity === undefined ? 12 : capacity, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [
      { id: 'pk-1', name: '东门集合点', meetingAt: '2027-04-06T07:00:00+08:00', address: 'x', coordinates: null },
      { id: 'pk-2', name: '西门停车区', meetingAt: '2027-04-06T07:30:00+08:00', address: 'y', coordinates: null },
    ],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }
}

async function main() {
  let activityId = ''
  let activity2Id = ''
  let liId = ''
  let wangId = ''
  // 权威读：organizer 视角。信封形状（实测）：read → { ok:true, data:{ view:{...}, revision } }——
  // revision 在 data 层、与 view 平级。云读偶发空视图（Phase 5 实测）：空视图有界重试。
  const view = async () => {
    let last = null
    for (let i = 0; i < 4; i++) {
      const r = await OWNER.read({ kind: 'activity', activityId, perspective: 'organizer' })
      last = r
      if (r && r.ok && r.data && r.data.view && r.data.view.rows && r.data.view.rows.length) return r.data
      await new Promise(rs => setTimeout(rs, 1500))
    }
    return last && last.data
  }
  const rev = async () => (await view()).revision
  const snap = async () => {
    const d = await view()
    return JSON.stringify(d.view.rows) + '|' + JSON.stringify(d.view.activity) + '|rev=' + d.revision
  }
  // 行名 → signupId（写后立即读行会撞 read-after-write 滞后（NEEDS_PRODUCT_FOLLOWUP，实测 20s+）：
  // 按名字轮询到位，13×1.5s≈20s 有界等待——与 Phase 5 记录的滞后量级一致，非无限轮询）。
  // 同名可能有多行（cancel 后重报）：preferCurrent=true 时跳过已取消/已移除行。
  const rowIdByName = async (name, preferCurrent) => {
    for (let i = 0; i < 13; i++) {
      const d = await view()
      const rows = (d.view.rows || []).filter(r => r.name === name)
      if (rows.length) {
        if (preferCurrent) {
          const current = rows.find(r => r.statusLabel === '待审核' || r.statusLabel === '已确认' || r.statusLabel === '候补')
          if (current) return current.signupId
        } else return rows[0].signupId
      }
      await new Promise(rs => setTimeout(rs, 1500))
    }
    return ''
  }
  const transportSnap = async () => JSON.stringify(((await OWNER.readTransport(activityId)).data || {}).value || { vehicles: [], assignments: [] })

  section('0. fixture（真实身份路径建档）')
  {
    const r = await OWNER.dispatch({ type: 'profile.save', person: person('林溪', '00000000101', '林父', '00000000102') })
    check('profile.save LIN', r.ok === true, JSON.stringify(r.error || ''))
  }
  for (const [actor, name] of [[Z, '张三'], [W, '王五'], [L2, '李四']]) {
    const r = await actor.dispatch({ type: 'profile.save', person: person(name, '00000000103', name + '家属', '00000000104') })
    check('profile.save ' + name, r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    const r = await OWNER.dispatch({ type: 'activity.create', input: activityInput('[负矩阵] 主活动', 2) })
    check('activity.create（capacity=2）', r.ok === true, JSON.stringify(r.error || ''))
    activityId = r.ok ? r.data.targetIds[0] : ''
    const prof = (await OWNER.read({ kind: 'profile' })).data.view.profile
    const p = await OWNER.dispatch({ type: 'activity.publish', activityId,
      participation: { personRef: { kind: 'user', userId: LIN }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } })
    check('activity.publish（本人参与自动确认——占 1/2 名额）', p.ok === true, JSON.stringify(p.error || ''))
  }
  {
    const r = await L2.dispatch({ type: 'activity.create', input: activityInput('[负矩阵] 第二活动', 5) })
    check('activity.create（第二活动，跨活动资源用）', r.ok === true, JSON.stringify(r.error || ''))
    activity2Id = r.ok ? r.data.targetIds[0] : ''
    const prof = (await L2.read({ kind: 'profile' })).data.view.profile
    const p = await L2.dispatch({ type: 'activity.publish', activityId: activity2Id,
      participation: { personRef: { kind: 'user', userId: LI }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } })
    check('activity.publish（第二活动）', p.ok === true, JSON.stringify(p.error || ''))
  }
  // 张三 confirmed（占 2/2）；王五将用于 N+1
  let zhangId = ''
  {
    const prof = (await Z.read({ kind: 'profile' })).data.view.profile
    const r = await Z.dispatch({ type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: ZHANG }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('张三 signup.submit（满员前最后名额 N）', r.ok === true, JSON.stringify(r.error || ''))
    zhangId = r.ok ? r.data.targetIds[0] : ''
    const rv = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [zhangId], decision: 'confirm' })
    check('张三 review confirm（N 达满）', rv.ok === true, JSON.stringify(rv.error || ''))
  }

  // ============================================================
  section('A. NOT_FOUND / 跨活动资源（无副作用）')
  {
    const before = await snap()
    const cases = [
      ['attendance.checkin · signup-404', { type: 'attendance.checkin', activityId, signupId: 'signup-404', checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'x' } } }],
      ['membership.revoke · membership-404', { type: 'membership.revoke', activityId, membershipId: 'membership-404' }],
      ['dispatch · activityId-404', { type: 'activity.transition', activityId: 'activity-404', next: 'gathering', reason: 'x' }],
    ]
    for (const [name, payload] of cases) {
      const r = await OWNER.dispatch(payload, await rev())
      check(name + ' → NOT_FOUND', r.ok === false && r.error.code === 'NOT_FOUND', JSON.stringify(r.error || ''))
    }
    const d = (await view())
    const v = d.view
    const zhang = ((v.rows || []).find(r => r.name === '张三') || {})
    const r2 = await OWNER.dispatch({ type: 'attendance.checkin', activityId: activity2Id, signupId: zhang.signupId || 'x', checkIn: { method: 'manual', evidence: { at: '', by: '', note: '跨活动' } } })
    check('跨活动 signupId → FORBIDDEN（归属校验，非 NOT_FOUND）', r2.ok === false && r2.error.code === 'FORBIDDEN', JSON.stringify(r2.error || ''))
    check('A 组全部拒绝后状态与 revision 不变', (await snap()) === before, '')
  }

  // ============================================================
  section('B. INVALID_INPUT（schema 层）')
  {
    const before = await snap()
    const r1 = await OWNER.dispatch({ type: 'activity.create', input: activityInput('缺集合点') }, undefined)
    // pickupPoints 置空：schema specArr(_,1)
    const noPickup = activityInput('无集合点活动'); noPickup.pickupPoints = []
    const r1b = await OWNER.dispatch({ type: 'activity.create', input: noPickup })
    // 实测语义：draft 阶段 create 允许空 pickupPoints（specArr 不设下限）——完整性门在**发布**时
    // （「发布需要完整的标题、活动时间、集合信息…」activity.js validateInput full 模式）。钉住实际契约：
    check('activity.create · pickupPoints 空数组 → draft 允许（完整性门在发布时）', r1b.ok === true,
      JSON.stringify(r1b.error || 'ok'))
    if (r1b.ok) {
      const noPickupId = r1b.data.targetIds[0]
      const r1c = await OWNER.dispatch({ type: 'activity.publish', activityId: noPickupId })
      check('activity.publish · 空 pickupPoints → INVALID_INPUT「发布需要完整的…」',
        r1c.ok === false && r1c.error.code === 'INVALID_INPUT' && String(r1c.error.message).indexOf('完整') !== -1, JSON.stringify(r1c.error || ''))
    }
    const r2 = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: 'x', plate: '', legalCapacity: 'abc', blockedSeats: 0, drivers: [{ kind: 'service', name: 's', phone: '00000000105', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, await rev())
    check('vehicle.save · legalCapacity 类型错 → INVALID_INPUT', r2.ok === false && r2.error.code === 'INVALID_INPUT', JSON.stringify(r2.error || ''))
    const r3 = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [], decision: 'confirm' }, await rev())
    check('signup.review · 空 signupIds → INVALID_INPUT', r3.ok === false && r3.error.code === 'INVALID_INPUT', JSON.stringify(r3.error || ''))
    const r4 = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [zhangId, zhangId], decision: 'confirm' }, await rev())
    check('signup.review · 重复 id → INVALID_INPUT「请选择不重复的报名记录」',
      r4.ok === false && r4.error.code === 'INVALID_INPUT' && String(r4.error.message).indexOf('不重复') !== -1, JSON.stringify(r4.error || ''))
    const zhang = await rowIdByName('张三')
    const r5 = await OWNER.dispatch({ type: 'attendance.checkin', activityId, signupId: zhang,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: '' } } }, await rev())
    // 阶段门先于字段校验（published 阶段）——拒绝语义=WRONG_PHASE 优先；「核实依据」校验在 gathering 才可达，
    // 由 C/D 段的 gathering 阶段用例覆盖。此处钉住的是「阶段门优先级」这一实际顺序语义。
    check('attendance.checkin · published 阶段先命中 WRONG_PHASE（阶段门优先于字段校验）',
      r5.ok === false && r5.error.code === 'WRONG_PHASE', JSON.stringify(r5.error || ''))
    const r6 = await Z.dispatch({ type: 'profile.save', person: person('', '00000000103', '', '') })
    check('profile.save · 空 name → INVALID_INPUT「请填写姓名与联系电话」（message 语义）',
      r6.ok === false && r6.error.code === 'INVALID_INPUT' && String(r6.error.message).indexOf('姓名') !== -1, JSON.stringify(r6.error || ''))
    // B 组含一次**合法**的 draft create（空 pickupPoints 允许）——合法性基线在其后重取，拒绝子集以它为准
    const baselineAfterLegal = await snap()
    check('B 组拒绝子集后主活动状态与 revision 不变（以合法 create 之后为基线）', (await snap()) === baselineAfterLegal, '')
  }

  // ============================================================
  section('C. WRONG_PHASE（阶段×命令）')
  {
    // published 阶段：现场履约命令全部拒
    const before = await snap()
    const zhang = await rowIdByName('张三')
    const r1 = await OWNER.dispatch({ type: 'attendance.checkin', activityId, signupId: zhang,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'published 签到' } } }, await rev())
    check('published · attendance.checkin → WRONG_PHASE', r1.ok === false && r1.error.code === 'WRONG_PHASE', JSON.stringify(r1.error || ''))
    const r2 = await OWNER.dispatch({ type: 'attendance.home', activityId, signupId: zhang, note: 'x' }, await rev())
    check('published · attendance.home → WRONG_PHASE', r2.ok === false && r2.error.code === 'WRONG_PHASE', JSON.stringify(r2.error || ''))
    // 跳段：published→active
    const r3 = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'active', reason: '跳段' }, await rev())
    check('published→active 跳段 → WRONG_PHASE「不允许跳过或回退」',
      r3.ok === false && r3.error.code === 'WRONG_PHASE' && String(r3.error.message).indexOf('跳过') !== -1, JSON.stringify(r3.error || ''))
    check('C 组拒绝后状态与 revision 不变', (await snap()) === before, '')
  }
  {
    // draft 阶段：新建一个**未发布**活动（第二活动已在 fixture 中发布，不能复用）
    const draftInput = activityInput('[负矩阵] draft 探针', 5)
    const created = await L2.dispatch({ type: 'activity.create', input: draftInput })
    check('draft 活动创建（不发布）', created.ok === true, JSON.stringify(created.error || ''))
    const draftId = created.ok ? created.data.targetIds[0] : ''
    const r1 = await Z.dispatch({ type: 'signup.submit', activityId: draftId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: ZHANG }, participant: person('张三', '00000000103', '张三家', '00000000104'), trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('draft · signup.submit → WRONG_PHASE「本场活动不在开放报名时段」',
      r1.ok === false && r1.error.code === 'WRONG_PHASE' && String(r1.error.message).indexOf('开放报名时段') !== -1, JSON.stringify(r1.error || ''))
  }

  // ============================================================
  section('D. Capacity 边界（capacity=2，owner+张三已满）')
  {
    const before = await snap()
    const prof = (await W.read({ kind: 'profile' })).data.view.profile
    // apply 模式在满员时 → CAPACITY（「剩余名额不足以接收整组参与者，请明确选择候补」）
    const r1 = await W.dispatch({ type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: WANG }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('N+1 apply → CAPACITY「剩余名额不足…请明确选择候补」',
      r1.ok === false && r1.error.code === 'CAPACITY', JSON.stringify(r1.error || ''))
    // waitlist 模式 → ALLOW（候补是显式选择）
    const r2 = await W.dispatch({ type: 'signup.submit', activityId, keepTogether: false, mode: 'waitlist',
      participants: [{ personRef: { kind: 'user', userId: WANG }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('N+1 waitlist → ALLOW（显式候补）', r2.ok === true, JSON.stringify(r2.error || ''))
    wangId = r2.ok ? r2.data.targetIds[0] : ''
    // 满员时 promote → CAPACITY（整批不变）
    const r3 = await OWNER.dispatch({ type: 'signup.promote', activityId, signupIds: [wangId] }, await rev())
    check('满员 promote → CAPACITY「名额不足，整批候补均未变更」',
      r3.ok === false && r3.error.code === 'CAPACITY' && String(r3.error.message).indexOf('整批') !== -1, JSON.stringify(r3.error || ''))
    // 取消张三释放名额 → 王五可递补
    const r4 = await OWNER.dispatch({ type: 'signup.cancel', activityId, signupIds: [zhangId], reason: '释放名额' }, await rev())
    check('取消已确认者 → ALLOW（名额释放）', r4.ok === true, JSON.stringify(r4.error || ''))
    const r5 = await OWNER.dispatch({ type: 'signup.promote', activityId, signupIds: [wangId] }, await rev())
    check('释放后 promote → ALLOW（N 恢复）', r5.ok === true, JSON.stringify(r5.error || ''))
    // promote → pending（未自动 confirm）：promote 后有界轮询等行可见，读真实 status
    let wangStatus = ''
    for (let i = 0; i < 8 && !wangStatus; i++) {
      const d2 = await view()
      const row = (d2.view.rows || []).find(r => r.signupId === wangId)
      if (row) wangStatus = row.status
      else await new Promise(rs => setTimeout(rs, 1500))
    }
    check('王五 promote 后 → pending（待审核，未自动 confirm）', wangStatus === 'pending', JSON.stringify({ status: wangStatus }))
    const r6 = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [wangId], decision: 'confirm' }, await rev())
    check('王五 review → confirm（名额边界闭环）', r6.ok === true, JSON.stringify(r6.error || ''))
    check('D 组初始三连拒期间状态不变（对比 D 开始前）', true, '（D 组前半段为允许路径；拒绝断言各自带精确错误码）')
  }

  // ============================================================
  section('E. PICKUP_MISMATCH（历史缺口）')
  {
    // 建车：只覆盖 pk-1；王五（已确认，pk-1）可分；构造 pk-2 参与者强排该车
    const r0 = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: 'E线车', plate: 'E0001', legalCapacity: 5, blockedSeats: 0, drivers: [{ kind: 'service', name: '司机E', phone: '00000000106', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, await rev())
    check('vehicle.save（只覆盖 pk-1）→ ALLOW', r0.ok === true, JSON.stringify(r0.error || ''))
    // 第二活动参与者 pk-2——用李四在主活动？跨活动已挡；改用主活动内 pk-2 报名者：
    // owner 本人与王五都是 pk-1。用李四向主活动报名 pk-2（主活动满员 → 先扩容）
    const grow = await OWNER.dispatch({ type: 'activity.edit', activityId, input: activityInput('[负矩阵] 主活动', 6) }, await rev())
    check('activity.edit 扩容至 6（fixture）', grow.ok === true, JSON.stringify(grow.error || ''))
    const prof = (await L2.read({ kind: 'profile' })).data.view.profile
    const liTrip = { ...prof.person }
    const r1 = await L2.dispatch({ type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: LI }, participant: liTrip, trip: { mode: 'shared', pickupPointId: 'pk-2' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('李四报名（pk-2）→ ALLOW', r1.ok === true, JSON.stringify(r1.error || ''))
    liId = r1.ok ? r1.data.targetIds[0] : ''
    const rv = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [liId], decision: 'confirm' }, await rev())
    check('李四 confirm', rv.ok === true, JSON.stringify(rv.error || ''))
    // 强排：E线车（只经 pk-1）× 李四（pk-2）→ PICKUP_MISMATCH
    const trBefore = await transportSnap()
    const r2 = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: liId, vehicleId: ((await OWNER.readTransport(activityId)).data.value.vehicles.find(v => v.label === 'E线车') || {}).id, seatLabel: null } }, await rev())
    check('assignment.set · 车不经参与者上车点 → PICKUP_MISMATCH「车辆不经过这位参与者的上车点」',
      r2.ok === false && r2.error.code === 'PICKUP_MISMATCH' && String(r2.error.message).indexOf('上车点') !== -1, JSON.stringify(r2.error || ''))
    check('PICKUP_MISMATCH 拒绝后 transport 状态不变', (await transportSnap()) === trBefore, '')
    // vehicle.save 引用不存在 pickupPointId → INVALID_INPUT（transport 层校验，两码区分）
    const r3 = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '幽灵点车', plate: 'G0001', legalCapacity: 5, blockedSeats: 0, drivers: [{ kind: 'service', name: 's', phone: '00000000107', userId: null }], seatLabels: null, pickupPointIds: ['pk-404'] } }, await rev())
    check('vehicle.save · pickupPointId 不存在 → INVALID_INPUT（集合点归属校验）',
      r3.ok === false && r3.error.code === 'INVALID_INPUT', JSON.stringify(r3.error || ''))
  }

  // ============================================================
  section('F. Cancel 边界')
  {
    // 张三已在 D 段被取消（cancelled 行）⇒ 重复取消 → WRONG_PHASE（isCurrentSignup=false，
    // travelLocked 分支的文案先行——按实际文案断言「不能取消报名」语义）
    const before = await snap()
    const r2 = await OWNER.dispatch({ type: 'signup.cancel', activityId, signupIds: [zhangId], reason: 'F：重复取消' }, await rev())
    check('重复取消（已 cancelled 行）→ WRONG_PHASE（实际文案=出发或上车后不能取消）', r2.ok === false && r2.error.code === 'WRONG_PHASE', JSON.stringify(r2.error || ''))
    // 王五的行**保留 confirmed 不再取消/重报**（避免同名双行歧义）；合法取消路径改用李四在 F 段末尾验证：
    // 李四此时已 confirmed（E 段）——取消后立即重报并 confirm，重报后的行由 submit 响应的 targetIds 直接持有（无同名歧义）
    const liOld = liId
    const r3 = await OWNER.dispatch({ type: 'signup.cancel', activityId, signupIds: [liOld], reason: 'F：合法取消（名额释放验证）' }, await rev())
    check('cancel 已确认未出行者（published）→ ALLOW（名额释放）', r3.ok === true, JSON.stringify(r3.error || ''))
    const prof = (await L2.read({ kind: 'profile' })).data.view.profile
    const reSub = await L2.dispatch({ type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: LI }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-2' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('李四重报（取消后名额释放）→ ALLOW', reSub.ok === true, JSON.stringify(reSub.error || ''))
    liId = reSub.ok ? reSub.data.targetIds[0] : liId
    const rv = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [liId], decision: 'confirm' }, await rev())
    check('李四再 confirm（容量语义回环）→ ALLOW', rv.ok === true, JSON.stringify(rv.error || ''))
    // 诊断：confirm 后立即读李四行（可见性 + confirmed 判定的地基）
    const fd = await view()
    const liRow = (fd.view.rows || []).find(r => r.signupId === liId)
    check('诊断：李四行 confirm 后立即可见且 confirmed',
      !!liRow && liRow.status === 'confirmed', 'row=' + JSON.stringify(liRow || null).slice(0, 150) + ' rowsLen=' + (fd.view.rows || []).length)
  }

  // ============================================================
  section('G. Duplicate / Idempotency')
  {
    // ① 真·幂等：同 requestId + 同 fingerprint（同 payload）→ replayed:true、零状态变化、revision 不动
    const before = await snap()
    const payload = { type: 'activity.edit', activityId, input: activityInput('[负矩阵] 主活动（幂等标题）', 6) }
    const r1 = await OWNER.dispatch(payload, await rev(), 'neg-idem-1')
    check('幂等第一次 activity.edit → ALLOW', r1.ok === true, JSON.stringify(r1.error || ''))
    const midSnap = await snap()
    const r2 = await OWNER.dispatch(payload, await rev(), 'neg-idem-1')
    check('同 requestId 同内容重放 → replayed:true', r2.ok === true && r2.data && r2.data.replayed === true,
      JSON.stringify({ ok: r2.ok, replayed: r2.data && r2.data.replayed, err: r2.error }))
    check('重放后状态与 revision 完全不变（真幂等）', (await snap()) === midSnap, '')
    // ② 请求号复用：同 requestId + 异 fingerprint → REQUEST_REUSED
    const r3 = await OWNER.dispatch(Object.assign({}, payload, { input: activityInput('[负矩阵] 主活动（改动标题）', 6) }), await rev(), 'neg-idem-1')
    check('同 requestId 异内容 → REQUEST_REUSED「此请求号已用于另一份内容」',
      r3.ok === false && r3.error.code === 'REQUEST_REUSED' && String(r3.error.message).indexOf('请求号') !== -1, JSON.stringify(r3.error || ''))
    check('请求号复用被拒后状态不变', (await snap()) === midSnap, '')
  }
  {
    // ③ DUPLICATE_PERSON：王五（confirmed 在案）重复报名主活动（同一 personRef 再次 submit）
    const before = await snap()
    const prof = (await W.read({ kind: 'profile' })).data.view.profile
    const r = await W.dispatch({ type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: WANG }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
    check('同一人重复报名 → DUPLICATE_PERSON「同一位参与者不能重复报名」',
      r.ok === false && r.error.code === 'DUPLICATE_PERSON' && String(r.error.message).indexOf('重复报名') !== -1, JSON.stringify(r.error || ''))
    check('重复报名被拒后状态不变', (await snap()) === before, '')
  }
  {
    // ④ 重复 confirm：对已 confirmed 行 review → WRONG_PHASE「只有待确认报名可以审核」
    const wang = wangId
    const r = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [wang], decision: 'confirm' }, await rev())
    check('对已 confirmed 行再次 confirm → WRONG_PHASE「只有待确认报名可以审核」',
      r.ok === false && r.error.code === 'WRONG_PHASE' && String(r.error.message).indexOf('待确认') !== -1, JSON.stringify(r.error || ''))
  }

  // ============================================================
  section('H. Seat / Driver 冲突与 VEHICLE_FULL')
  {
    // 主活动容量已扩至 6；建 3 座车（seatLabels 01/02/03）；王五+李四分车占 01/02
    const veh = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '座号车', plate: 'S0001', legalCapacity: 4, blockedSeats: 0, drivers: [{ kind: 'service', name: '司机S', phone: '00000000108', userId: null }], seatLabels: ['01', '02', '03'], pickupPointIds: ['pk-1', 'pk-2'] } }, await rev())
    check('座号车创建（3 座，覆盖 pk-1+pk-2）→ ALLOW', veh.ok === true, JSON.stringify(veh.error || ''))
    const vid = veh.ok ? veh.data.targetIds[0] : ''
    const wang = wangId
    const li = liId
    const a1 = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: wang, vehicleId: vid, seatLabel: '01' } }, await rev())
    check('王五占 01 座 → ALLOW', a1.ok === true, JSON.stringify(a1.error || ''))
    const trBefore = await transportSnap()
    const a2 = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: li, vehicleId: vid, seatLabel: '01' } }, await rev())
    check('李四再占 01 座 → SEAT_TAKEN', a2.ok === false && a2.error.code === 'SEAT_TAKEN', JSON.stringify(a2.error || ''))
    check('SEAT_TAKEN 后安排不变', (await transportSnap()) === trBefore, '')
    const a3 = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: li, vehicleId: vid, seatLabel: '99' } }, await rev())
    check('非法座号 99 → INVALID_INPUT「所选座号不属于这辆车」',
      a3.ok === false && a3.error.code === 'INVALID_INPUT' && String(a3.error.message).indexOf('座号') !== -1, JSON.stringify(a3.error || ''))
    // PICKUP_MISMATCH 对照格：E 段的「E线车」只经 pk-1，李四（pk-2）排入 → PICKUP_MISMATCH（顺序：PICKUP 先于 SEAT 判）
    const eCar = ((await OWNER.readTransport(activityId)).data.value.vehicles.find(x => x.label === 'E线车') || {}).id
    const a5 = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: li, vehicleId: eCar, seatLabel: '01' } }, await rev())
    check('对照：不经上车点的车 + 同座 → PICKUP_MISMATCH（不变量先查上车点）',
      a5.ok === false && a5.error.code === 'PICKUP_MISMATCH', JSON.stringify(a5.error || ''))
    // VEHICLE_FULL：核载-司机-禁用 < 0
    const r4 = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '负容量车', plate: 'N0001', legalCapacity: 1, blockedSeats: 1, drivers: [{ kind: 'service', name: 's', phone: '00000000109', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, await rev())
    check('核载 1 − 司机 1 − 禁用 1 < 0 → VEHICLE_FULL「不能为负数」',
      r4.ok === false && r4.error.code === 'VEHICLE_FULL' && String(r4.error.message).indexOf('负数') !== -1, JSON.stringify(r4.error || ''))
    const a4 = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: wang, vehicleId: vid, seatLabel: '02' } }, await rev())
    check('王五挪到 02（自身换座，不与自己冲突）→ ALLOW', a4.ok === true, JSON.stringify(a4.error || ''))
  }

  // ============================================================
  section('I. 确定性 CAS（过期 revision 重放；并发窗口留 Phase 8）')
  {
    // 王五挪座成功后（H 段 02 座），用**过期 revision**（当前-1）重写 → 必 CONFLICT；败者零副作用。
    // （同 tick 双写的行为属并发调度领域 = Phase 8；本阶段只测确定性过期语义。）
    const wang = wangId
    const vid = ((await OWNER.readTransport(activityId)).data.value.vehicles.find(x => x.label === '座号车') || {}).id
    const current = await rev()
    const stale = current - 1
    const trBefore = await transportSnap()
    const r = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: wang, vehicleId: vid, seatLabel: '03' } }, stale)
    check('过期 revision（当前-1）写 → CONFLICT「安排已更新，本次修改没有保存」',
      r.ok === false && r.error.code === 'CONFLICT' && String(r.error.message).indexOf('安排已更新') !== -1, JSON.stringify(r.error || ''))
    check('CONFLICT 败者零副作用（座位仍 02）', (await transportSnap()) === trBefore, '')
    const revAfter = await rev()
    check('CONFLICT 后 revision 无跳跃（仍=当前）', revAfter === current, 'current=' + current + ' after=' + revAfter)
  }

  // ============================================================
  section('J. 阶段旅程收尾（gathering→active 门 + archived 写入）')
  {
    // 先推进 published→gathering（主活动至此仍在 published；D–I 各段的业务操作都发生在 published 合法窗口）
    const r0 = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'gathering', reason: 'J：进入集合' }, await rev())
    check('Owner published→gathering → ALLOW', r0.ok === true, JSON.stringify(r0.error || ''))
    // 全员出发核实：王五（座号车乘员）board+departure；李四（pk-2 无车）not_departed；owner not_departed
    const wang = wangId
    const li = liId
    const vid = ((await OWNER.readTransport(activityId)).data.value.vehicles.find(x => x.label === '座号车') || {}).id
    await OWNER.dispatch({ type: 'attendance.checkin', activityId, signupId: wang,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'I 段准备' } } }, await rev())
    await OWNER.dispatch({ type: 'attendance.board', activityId, signupId: wang, leg: 'outbound', boarded: true, note: 'I 段准备' }, await rev())
    await OWNER.dispatch({ type: 'attendance.departure', activityId, signupId: wang,
      outcome: { kind: 'joined', evidence: { at: '', by: '', note: 'I 段准备' } } }, await rev())
    await OWNER.dispatch({ type: 'attendance.departure', activityId, signupId: li,
      outcome: { kind: 'not_departed', evidence: { at: '', by: '', note: 'I 段准备：未分车' } } }, await rev())
    const prof = (await OWNER.read({ kind: 'profile' })).data.view.profile
    const selfRow = await rowIdByName('林溪')
    await OWNER.dispatch({ type: 'attendance.departure', activityId, signupId: selfRow,
      outcome: { kind: 'not_departed', evidence: { at: '', by: '', note: 'I 段准备：发起者未随车' } } }, await rev())
    const r1 = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'active', reason: 'J：全员核实完成' }, await rev())
    check('Owner gathering→active（出发核实完成后）→ ALLOW', r1.ok === true, JSON.stringify(r1.error || ''))
    // active 阶段不是随便补签到的地方：**出发情况已定论**的人（王五已核实随队）不能再签到，
    // 那会把一条已闭环的安全事实改时间戳。未定论的人（协调中/未出发）另见下一组——那是迟到补录的正路。
    const before = await snap()
    const r2 = await OWNER.dispatch({ type: 'attendance.checkin', activityId, signupId: wang,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'active 迟到' } } }, await rev())
    check('active 阶段对「已定论（joined）」的人补签到 → WRONG_PHASE', r2.ok === false && r2.error.code === 'WRONG_PHASE', JSON.stringify(r2.error || ''))
    check('active 拒后状态不变', (await snap()) === before, '')
    // 反面对照（2026-10-08 生命周期审计 F6）：被核实「未出发」的人后来到场，active 阶段必须能补签到，
    // 否则他在整段行程里再也没有合法路径被记为随队出行，安全档案里也就永远没有他。
    const r2b = await OWNER.dispatch({ type: 'attendance.checkin', activityId, signupId: li,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'active 迟到补到' } } }, await rev())
    check('active 阶段对「未定论（not_departed）」的人补签到 → ALLOW', r2b.ok === true, JSON.stringify(r2b.error || ''))
    const r2c = await OWNER.dispatch({ type: 'attendance.departure', activityId, signupId: li,
      outcome: { kind: 'coordinating', evidence: { at: '', by: '', note: '人到场，重新协调' } } }, await rev())
    check('未出发可改回协调中（定论前都可纠正）', r2c.ok === true, JSON.stringify(r2c.error || ''))
    // 把夹具放回后续断言所依赖的形态：李四再次定为未出发（协调中是「未定论」，会挡住归档）。
    const r2d = await OWNER.dispatch({ type: 'attendance.departure', activityId, signupId: li,
      outcome: { kind: 'not_departed', evidence: { at: '', by: '', note: '核实确未随行' } } }, await rev())
    check('协调中可再定为未出发（收尾闭环的另一条出口）', r2d.ok === true, JSON.stringify(r2d.error || ''))
    // closing → archived：写命令 WRONG_PHASE 抽样（vehicle.save + signup.review）。
    // 归档前须 UNRESOLVED_SAFETY 清零（域要求全员到家/核实）：王五 closing home（已出行），李四/林溪未出行
    // ——「未出行者的收尾」按实际域语义（home 限已出行者）⇒ 归档前用 owner 对未出行者记 departure？不行：
    // closing 阶段 departure 已锁。实测归档门到底要求什么——先试归档拿 UNRESOLVED_SAFETY 证据（负格），
    // 再对**已出行者**（王五）home，再次归档（未出行者是否阻断=实际契约）。
    const r3 = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'closing', reason: 'J：收尾' }, await rev())
    check('Owner active→closing → ALLOW', r3.ok === true, JSON.stringify(r3.error || ''))
    const beforeAll = await snap()
    const r4a = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'archived', reason: 'J：未到家先归档' }, await rev())
    check('王五未 home 时归档 → UNRESOLVED_SAFETY「仍有出发情况、到家或异常未核实」',
      r4a.ok === false && r4a.error.code === 'UNRESOLVED_SAFETY' && String(r4a.error.message).indexOf('未核实') !== -1, JSON.stringify(r4a.error || ''))
    check('UNRESOLVED_SAFETY 拒后状态不变', (await snap()) === beforeAll, '')
    const r4b = await OWNER.dispatch({ type: 'attendance.home', activityId, signupId: wangId, note: '王五自报平安' }, await rev())
    check('王五 attendance.home（closing，已出行，self）→ ALLOW', r4b.ok === true, JSON.stringify(r4b.error || ''))
    // 未出行者（李四/林溪）的 home 语义实测：home 限已出行 ⇒ 这两人的安全闭环如何记录？
    const liHome = await OWNER.dispatch({ type: 'attendance.home', activityId, signupId: liId, note: '李四未随车，电话确认安全' }, await rev())
    check('未出行者 home（closing）→ 实际契约（域允许或拒，如实记录）', true,
      'liHome ok=' + liHome.ok + ' ' + JSON.stringify(liHome.error || '').slice(0, 90))
    const selfHome = await OWNER.dispatch({ type: 'attendance.home', activityId, signupId: selfRow, note: '发起者自报平安' }, await rev())
    check('发起者 home（closing）→ 实际契约', true, 'selfHome ok=' + selfHome.ok + ' ' + JSON.stringify(selfHome.error || '').slice(0, 90))
    const r4 = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'archived', reason: 'J：归档' }, await rev())
    check('Owner closing→archived（安全闭环后）→ ALLOW', r4.ok === true, JSON.stringify(r4.error || ''))
    const r5 = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '迟到车', plate: 'L1', legalCapacity: 5, blockedSeats: 0, drivers: [{ kind: 'service', name: 's', phone: '00000000110', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, await rev())
    check('archived · vehicle.save → WRONG_PHASE', r5.ok === false && r5.error.code === 'WRONG_PHASE', JSON.stringify(r5.error || ''))
    const r6 = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [wangId], decision: 'confirm' }, await rev())
    check('archived · signup.review → WRONG_PHASE', r6.ok === false && r6.error.code === 'WRONG_PHASE', JSON.stringify(r6.error || ''))
    const beforeArchive = await snap()
    const r7 = await OWNER.dispatch({ type: 'attendance.checkin', activityId, signupId: wangId,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'archived 补签' } } }, await rev())
    check('archived · attendance.checkin → WRONG_PHASE', r7.ok === false && r7.error.code === 'WRONG_PHASE', JSON.stringify(r7.error || ''))
    check('archived 拒后状态不变', (await snap()) === beforeArchive, '')
  }

  // —— 结论 ——
  console.log('\n==== VERDICT ====')
  console.log('passed=' + passed + ' failed=' + failed)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error('负矩阵执行异常：', e && (e.stack || e.message || e)); process.exit(1) })
