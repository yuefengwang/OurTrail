// Permission / Security Matrix（A 层）：node tools/e2e-permission-test.js
// Phase 6：把「角色 × Command × Phase × 资源归属」的授权边界打成真实信封——
// actor openid → trailApi.main → dispatch/read → domain 授权 → {ok,data}/{ok,error} 信封 → 权威态回读。
// 与 smoke（domain 纯函数）的区别：走完整 index.js 路由与信封；与 GP 的区别：不依赖 UI，专证权限语义。
//
// DENY 三要素（每个拒绝断言都要满足）：
//   1. command failed          2. error.code 精确匹配权限语义（NOT_FOUND ≠ FORBIDDEN ≠ WRONG_PHASE）
//   3. 目标状态前后不变（before/after 权威读对比）
// Actor 全部走真实身份路径：profile.save / activity.create / membership.save（Owner 下发）/
// signup.submit（本人关系）——不 mock 权限、不 monkey-patch、不直调 domain 内部函数。
// 矩阵依据：docs/testing/permission-security-matrix.md（Expected 全部从现行 domain 代码推导）。
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
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + String(extra).slice(0, 160) + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const trailApi = require('../cloudfunctions/trailApi/index')

// —— actor 信封：每次调用设置 openid（与客户端 wx.cloud.callFunction 的真实身份路径一致）——
function as(openid) {
  const call = (action, extra) => {
    stub.__state.openid = openid
    return trailApi.main(Object.assign({ action }, extra))
  }
  return {
    read: request => call('read', { request }),
    readForm: (activityId, signupId, purpose) => call('readForm', { activityId, signupId, purpose }),
    readTransport: activityId => call('readTransport', { activityId }),
    readAccess: activityId => call('readAccess', { activityId }),
    readSensitive: (activityId, signupId, purpose) => call('readSensitive', { activityId, signupId, purpose }),
    readContact: (activityId, signupId) => call('readContact', { activityId, signupId }),
    readExport: (activityId, signupIds, mode, purpose) => call('readExport', { activityId, signupIds, mode, purpose }),
    dispatch: (payload, expectedRevision, requestId) => call('dispatch', { payload, expectedRevision, requestId }),
  }
}
const person = (name, phone, ename, ephone) => ({ name, phone, emergency: { name: ename, phone: ephone }, medical: '', avatar: '' })

// —— actor openid（openid 只是身份键，不要求真实微信用户——domain 按 userId 字符串解析）——
const LIN = 'o-lin-owner'      // 活动所有者（主沙盒）
const ALICE = 'o-alice-staff'  // staff：七能力全开 scope all
const BEA = 'o-bea-staff'      // staff：仅 roster 能力（能力不匹配 actor）
const VIC = 'o-vic-coord'      // vehicle_contact：1号车
const VIC2 = 'o-vic2-coord'    // vehicle_contact：2号车（越权车辆 actor）
const MEM = 'o-mem-user'       // 普通参与者（confirmed）
const ZHAO_ID = 'o-zhao-user'  // 第二位普通参与者的 openid（person 名=赵辰，行查找锚点；对他人操作的 DENY 目标）
const NOBODY = 'o-nobody'      // 非成员（仅 profile，与活动无关系）
const LIN2 = 'o-lin2-owner'    // 另一场活动的所有者（跨 owner actor）

const OWNER = as(LIN)
const STAFF = as(ALICE)
const STAFF2 = as(BEA)
const VCOORD = as(VIC)
const VCOORD2 = as(VIC2)
const MEMBER = as(MEM)
const ZHAO = as(ZHAO_ID)
const NONMEMBER = as(NOBODY)
const OWNER2 = as(LIN2)
const ANON = as(null)          // 未选择账号（actor.userId=null ⇒ AUTH_REQUIRED）

function fullActivityInput(title) {
  return {
    title, description: '权限矩阵沙盒', organizerIntro: '自动化',
    startAt: '2027-03-06T08:00:00+08:00', endAt: '2027-03-06T18:00:00+08:00', deadlineAt: '2027-03-05T20:00:00+08:00',
    acceptingSignups: true, capacity: 12, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [
      { id: 'pk-1', name: '东门集合点', meetingAt: '2027-03-06T07:00:00+08:00', address: 'x', coordinates: null },
      { id: 'pk-2', name: '西门停车区', meetingAt: '2027-03-06T07:30:00+08:00', address: 'y', coordinates: null },
    ],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }
}

async function main() {
  let passed0 = null
  const rev = async actor => {
    const r = await (actor || OWNER).read({ kind: 'activity', activityId, perspective: 'organizer' })
    return r.ok ? r.data.revision : (await OWNER.read({ kind: 'discover' })).data.revision
  }
  const activityView = async actor => (await actor.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view
  // DENY 三要素之「状态不变」：权威读的 JSON 前后一致
  const snapshot = async () => JSON.stringify((await activityView(OWNER)).rows) + JSON.stringify((await activityView(OWNER)).activity)

  // ============================================================
  // 身份建档（真实路径：profile.save / activity.create / membership.save / signup.submit）
  // ============================================================
  section('0. actor 建档（全部走真实 envelope）')
  for (const [actor, name] of [[OWNER, 'LIN'], [STAFF, 'ALICE'], [STAFF2, 'BEA'], [VCOORD, 'VIC'], [VCOORD2, 'VIC2'], [MEMBER, 'MEM'], [ZHAO, '赵辰'], [NONMEMBER, 'NOBODY'], [OWNER2, 'LIN2']]) {
    const r = await actor.dispatch({ type: 'profile.save', person: person(name, '0000000001', name + '家属', '0000000002') })
    check('profile.save（' + name + '）', r.ok === true, JSON.stringify(r.error || r.err || ''))
  }

  let activityId = ''
  let aliceMembershipId = ''
  let activity2Id = ''
  {
    const r = await OWNER.dispatch({ type: 'activity.create', input: fullActivityInput('[权限矩阵] 主活动') })
    check('Owner activity.create → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
    activityId = r.ok ? r.data.targetIds[0] : ''
    check('Owner activity.read（organizer 视角）→ view.kind=activity', (await OWNER.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.kind === 'activity', '')
  }
  {
    // ANON（未选账号）写命令 → AUTH_REQUIRED（权限语义第 0 格）
    const r = await ANON.dispatch({ type: 'activity.create', input: fullActivityInput('anon') })
    check('未选账号 activity.create → AUTH_REQUIRED', r.ok === false && r.error.code === 'AUTH_REQUIRED', JSON.stringify(r.error || ''))
  }
  {
    const r = await OWNER2.dispatch({ type: 'activity.create', input: fullActivityInput('[权限矩阵] 他人活动') })
    check('AnotherOwner activity.create（第二场活动）→ ALLOW', r.ok === true, JSON.stringify(r.error || ''))
    activity2Id = r.ok ? r.data.targetIds[0] : ''
  }
  {
    // publish 载荷必带 participation（payload spec 要求；本人参与自动确认——与 smoke/UI-state 同形状）
    const prof = (await OWNER.read({ kind: 'profile' })).data.view.profile
    const r = await OWNER.dispatch({ type: 'activity.publish', activityId,
      participation: { personRef: { kind: 'user', userId: LIN }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } })
    check('Owner activity.publish → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }

  // MEM 自我报名（published+manual → pending）
  let memSignupId = ''
  let zhaoSignupId = ''
  {
    const prof = (await MEMBER.read({ kind: 'profile' })).data.view.profile
    const r = await MEMBER.dispatch({
      type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: MEM }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }],
    }, await rev(MEMBER))
    check('Member signup.submit（本人）→ ALLOW（pending）', r.ok === true, JSON.stringify(r.error || ''))
    memSignupId = r.ok ? r.data.targetIds[0] : ''
  }
  {
    // NonMember 也可以提交本人（发现流设计）；人工审核留存 pending —— 矩阵 B 的 ALLOW 格
    const prof = (await NONMEMBER.read({ kind: 'profile' })).data.view.profile
    const r = await NONMEMBER.dispatch({
      type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: NOBODY }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }],
    }, await rev(NONMEMBER))
    check('NonMember signup.submit（本人）→ ALLOW（published+manual 设计）', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // ZHAO 自我报名（第二位 confirmed 参与者：所有「对他人操作」的 DENY cell 都以他为目标）
    const prof = (await ZHAO.read({ kind: 'profile' })).data.view.profile
    const r = await ZHAO.dispatch({
      type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
      participants: [{ personRef: { kind: 'user', userId: ZHAO_ID }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }],
    }, await rev(ZHAO))
    check('ZHAO signup.submit（本人）→ ALLOW（pending）', r.ok === true, JSON.stringify(r.error || ''))
    zhaoSignupId = r.ok ? r.data.targetIds[0] : ''
  }
  {
    // Owner review：确认 MEM 与 ZHAO（NonMember 的报名留在 pending——read-lag 观察窗，阶段推进前由 Owner 取消）
    const v = (await activityView(OWNER))
    const pend = (v.rows || []).filter(r => r.name === 'MEM' || r.name === '赵辰').map(r => r.signupId)
    const r = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: pend, decision: 'confirm' }, await rev())
    check('Owner signup.review → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }

  // ============================================================
  // A. Activity ownership
  // ============================================================
  section('A. Activity ownership × 命令')
  {
    const before = await snapshot()
    const r = await MEMBER.dispatch({ type: 'activity.edit', activityId, input: Object.assign({}, fullActivityInput('MEM 篡改'), { title: 'MEM 篡改' }) }, await rev())
    check('Member activity.edit → FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    check('Member activity.edit 被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    const before = await snapshot()
    const r = await NONMEMBER.dispatch({ type: 'activity.edit', activityId, input: fullActivityInput('NOBODY') }, await rev())
    check('NonMember activity.edit → FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    check('NonMember activity.edit 被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    const before = await snapshot()
    const r = await OWNER2.dispatch({ type: 'activity.edit', activityId, input: fullActivityInput('LIN2 跨 owner') }, await rev())
    check('AnotherOwner activity.edit（跨 owner）→ FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    check('跨 owner edit 被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    const r = await MEMBER.dispatch({ type: 'activity.transition', activityId, next: 'gathering', reason: 'MEM 越权推进' }, await rev())
    check('Member activity.transition → FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
  }
  {
    const r = await OWNER.dispatch({ type: 'activity.delete', activityId }, await rev())
    check('Owner activity.delete（非 draft）→ FORBIDDEN（语义精确）',
      r.ok === false && r.error.code === 'FORBIDDEN' && String(r.error.message).indexOf('草稿') !== -1, JSON.stringify(r.error || ''))
  }

  // ============================================================
  // E. Membership / Collaboration（先落授权，后续角色才有意义）
  // ============================================================
  section('E. Membership / Collaboration')
  {
    const before = await snapshot()
    const r = await MEMBER.dispatch({ type: 'membership.save', activityId, membership: {
      id: 'perm-mem-self-promote', role: 'staff', activityId, userId: MEM, expiresAt: '2027-12-31T23:59:59+08:00',
      scope: { kind: 'all' }, capabilities: ['roster', 'checkin'] } }, await rev())
    check('Member membership.save（自提权 staff）→ FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    check('自提权被拒后 memberships 不变', (await snapshot()) === before, '')
  }
  {
    const r = await OWNER.dispatch({ type: 'membership.save', activityId, membership: {
      id: 'perm-staff-alice', role: 'staff', activityId, userId: ALICE, expiresAt: '2027-12-31T23:59:59+08:00',
      scope: { kind: 'all' }, capabilities: ['roster', 'checkin', 'node', 'incident', 'position', 'home', 'sensitive'] } }, await rev())
    check('Owner membership.save（授 staff ALICE 七能力）→ ALLOW', r.ok === true, JSON.stringify(r.error || ''))
    aliceMembershipId = 'perm-staff-alice'
    const acc = await OWNER.readAccess(activityId)
    check('Owner readAccess 回读：ALICE 的 staff 授权在案', acc.ok === true && (acc.data.value.memberships || []).some(m => m.userId === ALICE && m.role === 'staff'),
      JSON.stringify(acc.ok ? acc.data.value.memberships : acc).slice(0, 120))
  }
  {
    // 授权在案后，Staff 撤销他人授权 → FORBIDDEN（owner-only；存在但不许）
    const r = await STAFF.dispatch({ type: 'membership.revoke', activityId, membershipId: aliceMembershipId }, await rev())
    check('Staff membership.revoke（他人授权在案）→ FORBIDDEN（owner-only）', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
  }
  {
    const r = await OWNER.dispatch({ type: 'membership.save', activityId, membership: {
      id: 'perm-staff-bea', role: 'staff', activityId, userId: BEA, expiresAt: '2027-12-31T23:59:59+08:00',
      scope: { kind: 'all' }, capabilities: ['roster'] } }, await rev())
    check('Owner membership.save（授 staff BEA 仅 roster）→ ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // 读面拒绝的信封形态：selectAccess 返回（不 throw）⇒ main 包裹为 {ok:true, data:{ok:false, error}}——
    // 与 dispatch 的顶层 {ok:false} 不同。断言嵌套层，并核实拒绝响应不含任何 memberships 数据。
    const r = await MEMBER.readAccess(activityId)
    const denied = r.ok === true && r.data && r.data.ok === false && r.data.error && r.data.error.code === 'FORBIDDEN'
    const noLeak = JSON.stringify(r).indexOf('membership') === -1
    check('Member readAccess → FORBIDDEN（嵌套信封，且无 memberships 数据泄露）', denied && noLeak, 'raw=' + JSON.stringify(r).slice(0, 140))
  }
  {
    const r = await STAFF.readAccess(activityId)
    check('Staff readAccess → FORBIDDEN（嵌套信封）', r.ok === true && r.data && r.data.ok === false && r.data.error && r.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r).slice(0, 140))
  }

  // ============================================================
  // C. Vehicle（车辆与协调者边界）
  // ============================================================
  section('C. Vehicle × 角色')
  let v1 = ''
  let v2 = ''
  {
    const r = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '1号车', plate: 'A00001', legalCapacity: 9, blockedSeats: 0, drivers: [{ kind: 'service', name: '司机一', phone: '00000000091', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, await rev())
    check('Owner vehicle.save → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
    v1 = r.ok ? r.data.targetIds[0] : ''
  }
  {
    const before = await snapshot()
    for (const [name, actor] of [['Member', MEMBER], ['Staff', STAFF], ['VCOORD', VCOORD]]) {
      const r = await actor.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
        input: { label: name + '车', plate: 'X', legalCapacity: 5, blockedSeats: 0, drivers: [{ kind: 'service', name: 's', phone: '00000000092', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, await rev())
      check(name + ' vehicle.save → FORBIDDEN（owner-only）', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    }
    check('三类角色 vehicle.save 全拒后车辆清单不变', (await snapshot()) === before, '')
  }
  {
    const r = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '2号车', plate: 'A00002', legalCapacity: 5, blockedSeats: 0, drivers: [{ kind: 'service', name: '司机二', phone: '00000000093', userId: null }], seatLabels: null, pickupPointIds: ['pk-2'] } }, await rev())
    v2 = r.ok ? r.data.targetIds[0] : ''
    check('Owner vehicle.save（2号车）→ ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // Owner 指派 MEM → 1号车（VCOORD 的授权车辆）
    const r = await OWNER.dispatch({ type: 'assignment.set', activityId, target: { signupId: memSignupId, vehicleId: v1, seatLabel: null } }, await rev())
    check('Owner assignment.set（MEM→1号车）→ ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // VCOORD(1号车) 授予：membership.save role vehicle_contact + vehicleId=v1
    const r = await OWNER.dispatch({ type: 'membership.save', activityId, membership: {
      id: 'perm-vcoord-vic', role: 'vehicle_contact', activityId, userId: VIC, vehicleId: v1, expiresAt: '2027-12-31T23:59:59+08:00' } }, await rev())
    check('Owner 授 VCOORD(1号车) → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    const r = await OWNER.dispatch({ type: 'membership.save', activityId, membership: {
      id: 'perm-vcoord-vic2', role: 'vehicle_contact', activityId, userId: VIC2, vehicleId: v2, expiresAt: '2027-12-31T23:59:59+08:00' } }, await rev())
    check('Owner 授 VCOORD2(2号车) → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // Phase 4 记录验证：membership.save + 不存在 vehicleId ⇒ canExecute requireVehicles 应 NOT_FOUND
    const r = await OWNER.dispatch({ type: 'membership.save', activityId, membership: {
      id: 'perm-vcoord-ghost', role: 'vehicle_contact', activityId, userId: VIC, vehicleId: 'vehicle-ghost-404', expiresAt: '2027-12-31T23:59:59+08:00' } }, await rev())
    check('membership.save + 不存在 vehicleId → NOT_FOUND（存在性校验在 canExecute）',
      r.ok === false && r.error.code === 'NOT_FOUND', JSON.stringify(r.error || ''))
  }
  {
    // 跨活动 vehicleId：在 OWNER2 的活动里引用主活动的车辆 → 车辆不属于此活动（requireVehicles 归属校验）
    const r = await OWNER2.dispatch({ type: 'membership.save', activityId: activity2Id, membership: {
      id: 'perm-cross-veh', role: 'vehicle_contact', activityId: activity2Id, userId: VIC, vehicleId: v1, expiresAt: '2027-12-31T23:59:59+08:00' } }, await rev(OWNER2))
    check('跨活动 membership.save + 他人活动 vehicleId → FORBIDDEN（归属校验）',
      r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
  }
  {
    const r = await MEMBER.readTransport(activityId)
    check('Member readTransport → FORBIDDEN（owner-only 读面）', r.ok === true && r.data && r.data.ok === false && r.data.error && r.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r).slice(0, 130))
  }
  {
    const r = await STAFF.readTransport(activityId)
    check('Staff readTransport → FORBIDDEN（owner-only 读面）', r.ok === true && r.data && r.data.ok === false && r.data.error && r.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r).slice(0, 130))
  }

  // ============================================================
  // 阶段推进（Owner 真实 transition：published → gathering）
  // ============================================================
  // NonMember 的报名留在 pending（read-lag 观察窗）——推进前由 Owner 取消（UNRESOLVED_DEPARTURE 门要求 pending 清零）
  {
    // NOBODY 行可见性受读滞后影响：有界轮询到行出现（5×2s），证据带上全部行名
    let nob = []
    let names = []
    for (let t = 0; t < 5 && !nob.length; t++) {
      const v = await activityView(OWNER)
      names = (v.rows || []).map(r => r.name + '/' + r.status)
      nob = (v.rows || []).filter(r => r.name === 'NOBODY' && r.status === 'pending').map(r => r.signupId)
      if (!nob.length) await sleep(2000)
    }
    const r = await OWNER.dispatch({ type: 'signup.cancel', activityId, signupIds: nob, reason: '权限矩阵：取消观察行' }, await rev())
    check('Owner signup.cancel（NonMember pending 行）→ ALLOW', r.ok === true && nob.length === 1, '行名=' + JSON.stringify(names) + ' ' + JSON.stringify(r.error || 'ok'))
  }
  {
    const r = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'gathering', reason: '权限矩阵：进入集合' }, await rev())
    check('Owner activity.transition published→gathering → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }

  // ============================================================
  // D. Check-in / Board / Departure / Home（gathering 阶段）
  // ============================================================
  section('D. Check-in / Board / Departure / Home（gathering）')
  {
    const r = await MEMBER.dispatch({ type: 'attendance.checkin', activityId, signupId: memSignupId,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: '本人签到（own 路径）' } } }, await rev())
    check('Member attendance.checkin（自己）→ ALLOW（own）', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    const before = await snapshot()
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r = await MEMBER.dispatch({ type: 'attendance.checkin', activityId, signupId: zhao,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'MEM 替他人签到' } } }, await rev())
    check('Member attendance.checkin（他人）→ FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    check('他人签到被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r = await STAFF.dispatch({ type: 'attendance.checkin', activityId, signupId: zhao,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'staff checkin 能力（scope all）' } } }, await rev())
    check('Staff(checkin,scope all) attendance.checkin（他人）→ ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const before = await snapshot()
    const r = await STAFF2.dispatch({ type: 'attendance.checkin', activityId, signupId: zhao,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: 'BEA 只有 roster 能力' } } }, await rev())
    check('Staff(roster only) attendance.checkin → FORBIDDEN（能力不匹配）', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    check('能力不匹配被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    // 过期授权的安全控制实测：domain 在**写入时**就拒绝过期授权（profile.js「授权结束时间必须晚于当前时间」）
    // ⇒ staffCan 的过期分支是纵深防御，无法经真实信封触达（无可达路径）。记录为矩阵的域行为行。
    const before = await snapshot()
    const r = await OWNER.dispatch({ type: 'membership.save', activityId, membership: {
      id: 'perm-staff-expired', role: 'staff', activityId, userId: NOBODY, expiresAt: '2020-01-01T00:00:00+08:00',
      scope: { kind: 'all' }, capabilities: ['checkin'] } }, await rev())
    check('Owner 授过期 staff → INVALID_INPUT（写入时即拒绝——过期授权不可经真实路径产生）',
      r.ok === false && r.error.code === 'INVALID_INPUT' && String(r.error.message).indexOf('晚于当前时间') !== -1, JSON.stringify(r.error || ''))
    check('过期授权被拒后 memberships 不变', (await snapshot()) === before, '')
  }
  {
    // departure：owner || cap('checkin')（非 self-service——MEMBER 自己不行）。
    // joined 门：MEM 需先有去程上车事实（上车 cell 在下方）⇒ 先由 VCOORD 完成 1号车登点，再测出发核实。
    const rows = (await activityView(OWNER)).rows
    const mem = (rows.find(r => r.signupId === memSignupId) || {}).signupId
    const r0 = await VCOORD.dispatch({ type: 'attendance.board', activityId, signupId: memSignupId, leg: 'outbound', boarded: true, note: '1号车联络人清点' }, await rev())
    check('VCOORD(1号车) attendance.board（1号车乘员）→ ALLOW', r0.ok === true, JSON.stringify(r0.error || ''))
    const before = await snapshot()
    const r = await MEMBER.dispatch({ type: 'attendance.departure', activityId, signupId: mem,
      outcome: { kind: 'joined', evidence: { at: '', by: '', note: 'MEM 自行核实出发' } } }, await rev())
    check('Member attendance.departure（自己）→ FORBIDDEN（出发核实非 self-service）', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r.error || ''))
    check('departure 被拒后状态不变', (await snapshot()) === before, '')
    const r2 = await STAFF.dispatch({ type: 'attendance.departure', activityId, signupId: mem,
      outcome: { kind: 'joined', evidence: { at: '', by: '', note: 'staff checkin 能力核实出发' } } }, await rev())
    check('Staff(checkin) attendance.departure（他人）→ ALLOW', r2.ok === true, JSON.stringify(r2.error || ''))
  }
  {
    // board：owner || vehicleCan（VCOORD 只能上自己车辆的乘员）
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const before = await snapshot()
    const r2 = await VCOORD2.dispatch({ type: 'attendance.board', activityId, signupId: zhao, leg: 'outbound', boarded: true, note: '2号车联络人越权' }, await rev())
    check('VCOORD2(2号车) attendance.board（1号车乘员）→ FORBIDDEN（越权车辆）', r2.ok === false && r2.error.code === 'FORBIDDEN', JSON.stringify(r2.error || ''))
    check('越权车辆 board 被拒后状态不变', (await snapshot()) === before, '')
    const r3 = await MEMBER.dispatch({ type: 'attendance.board', activityId, signupId: memSignupId, leg: 'outbound', boarded: true, note: 'MEM 自行上车' }, await rev())
    check('Member attendance.board（自己）→ FORBIDDEN（board 非 self-service）', r3.ok === false && r3.error.code === 'FORBIDDEN', JSON.stringify(r3.error || ''))
  }
  {
    // vehicle.depart：owner || vehicleCan（VCOORD 只能发自己车辆）
    const r = await VCOORD.dispatch({ type: 'vehicle.depart', activityId, vehicleId: v1, leg: 'outbound', note: '1号车联络人发车' }, await rev())
    check('VCOORD(1号车) vehicle.depart → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
    const before = await snapshot()
    const r2 = await VCOORD.dispatch({ type: 'vehicle.depart', activityId, vehicleId: v2, leg: 'outbound', note: '1号车联络人发2号车' }, await rev())
    check('VCOORD(1号车) vehicle.depart 2号车 → FORBIDDEN（跨车）', r2.ok === false && r2.error.code === 'FORBIDDEN', JSON.stringify(r2.error || ''))
    check('跨车发车被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    // 未分车的 confirmed 参与者（赵辰）：owner 核实「未出发」（域合法路径——joined 门对其不可达）
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r = await OWNER.dispatch({ type: 'attendance.departure', activityId, signupId: zhao,
      outcome: { kind: 'not_departed', evidence: { at: '', by: '', note: '权限矩阵：未分车未出发核实' } } }, await rev())
    check('Owner attendance.departure（赵辰 not_departed）→ ALLOW（无车乘客的合法核实路径）', r.ok === true, JSON.stringify(r.error || ''))
  }

  // ============================================================
  // F. Read / Export（读面与字段级过滤）
  // ============================================================
  section('F. Read / Export（字段级安全语义）')
  {
    const rows = (await activityView(OWNER)).rows
    const mem = memSignupId
    const r1 = await MEMBER.readSensitive(activityId, mem, '本人查阅')
    check('Member readSensitive（自己，带 purpose）→ ALLOW（self 免费）', r1.ok === true, JSON.stringify(r1.error || ''))
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r2 = await MEMBER.readSensitive(activityId, zhao, '越权查阅')
    check('Member readSensitive（他人，带 purpose）→ FORBIDDEN（嵌套读信封）', r2.ok === true && r2.data && r2.data.ok === false && r2.data.error && r2.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r2).slice(0, 130))
    const r3 = await STAFF.readSensitive(activityId, zhao, '工作需要')
    check('Staff(sensitive,scope all) readSensitive（他人）→ ALLOW', r3.ok === true, JSON.stringify(r3.error || ''))
    const r4 = await STAFF2.readSensitive(activityId, zhao, '工作需要')
    check('Staff(roster only) readSensitive → FORBIDDEN（能力不匹配，嵌套读信封）', r4.ok === true && r4.data && r4.data.ok === false && r4.data.error && r4.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r4).slice(0, 130))
    const r5 = await OWNER.readSensitive(activityId, zhao, '所有者查阅')
    check('Owner readSensitive（他人）→ ALLOW', r5.ok === true, JSON.stringify(r5.error || ''))
    const r6 = await MEMBER.readSensitive(activityId, mem, '')
    check('Member readSensitive（自己，无 purpose）→ ALLOW（self 不需要用途）', r6.ok === true, JSON.stringify(r6.error || ''))
  }
  {
    const rows = (await activityView(OWNER)).rows
    const mem = memSignupId
    const r1 = await VCOORD.readContact(activityId, mem)
    check('VCOORD(1号车) readContact（1号车乘员）→ ALLOW', r1.ok === true, JSON.stringify(r1.error || ''))
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r2 = await VCOORD.readContact(activityId, zhao)
    check('VCOORD(1号车) readContact（未分配乘员）→ FORBIDDEN（嵌套读信封）', r2.ok === true && r2.data && r2.data.ok === false && r2.data.error && r2.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r2).slice(0, 130))
    const r3 = await STAFF2.readContact(activityId, zhao)
    check('Staff(roster) readContact（他人）→ ALLOW', r3.ok === true, JSON.stringify(r3.error || ''))
  }
  {
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r1 = await STAFF.readForm(activityId, zhao, '工作用途')
    check('Staff readForm（他人）→ FORBIDDEN（readForm=own/owner，嵌套读信封）', r1.ok === true && r1.data && r1.data.ok === false && r1.data.error && r1.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r1).slice(0, 130))
    const r2 = await OWNER.readForm(activityId, zhao, '组织者查阅')
    check('Owner readForm（他人）→ ALLOW', r2.ok === true, JSON.stringify(r2.error || ''))
  }
  {
    const r1 = await MEMBER.dispatch({ type: 'export.record', activityId, signupIds: [memSignupId], mode: 'ordinary', purpose: 'MEM 导出' }, await rev())
    check('Member export.record → FORBIDDEN（owner-only）', r1.ok === false && r1.error.code === 'FORBIDDEN', JSON.stringify(r1.error || ''))
    const r2 = await OWNER.dispatch({ type: 'export.record', activityId, signupIds: [memSignupId], mode: 'sensitive', purpose: '' }, await rev())
    check('Owner export.record sensitive 无 purpose → FORBIDDEN（用途门）',
      r2.ok === false && r2.error.code === 'FORBIDDEN' && String(r2.error.message).indexOf('用途') !== -1, JSON.stringify(r2.error || ''))
    const r3 = await OWNER.dispatch({ type: 'export.record', activityId, signupIds: [memSignupId], mode: 'sensitive', purpose: '权限矩阵：含紧急联络的当日核对' }, await rev())
    check('Owner export.record sensitive + purpose → ALLOW', r3.ok === true, JSON.stringify(r3.error || ''))
    const r4 = await OWNER.readExport(activityId, [memSignupId], 'sensitive', '权限矩阵：含紧急联络的当日核对')
    check('Owner readExport → ALLOW（回读敏感导出）', r4.ok === true, JSON.stringify(r4.error || ''))
  }
  {
    // ANON 读面：未选账号 → AUTH_REQUIRED 语义（写与读一致）
    const r = await ANON.read({ kind: 'activity', activityId, perspective: 'organizer' })
    check('未选账号 read → AUTH_REQUIRED 或 denied 视图（不泄露数据）',
      r.ok === false || r.data.view.kind === 'denied' || JSON.stringify(r.data).indexOf('赵辰') === -1, JSON.stringify(r.data || '').slice(0, 80))
  }

  // ============================================================
  // G. 阶段推进到 active/closing/archived 与阶段×命令×home 语义
  // ============================================================
  section('G. 阶段推进与阶段×命令×home')
  {
    // Owner 本人的报名也是 confirmed（publish 参与）⇒ 同样需要出发核实：未分车 ⇒ not_departed（owner||own 路径）
    const rows = (await activityView(OWNER)).rows
    const self = (rows.find(r => r.name === 'LIN') || {}).signupId
    const r0 = await OWNER.dispatch({ type: 'attendance.departure', activityId, signupId: self,
      outcome: { kind: 'not_departed', evidence: { at: '', by: '', note: '权限矩阵：发起者本人未随车，未出发核实' } } }, await rev())
    check('Owner attendance.departure（自己，not_departed）→ ALLOW（own）', r0.ok === true, JSON.stringify(r0.error || ''))
    const r = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'active', reason: '权限矩阵：发车（全员出发核实完成）' }, await rev())
    check('Owner gathering→active → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // home 阶段门：home 仅限 closing 且已出行者——active 阶段对未出行者确认 → WRONG_PHASE（域行为行）
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const before = await snapshot()
    const r = await STAFF.dispatch({ type: 'attendance.home', activityId, signupId: zhao,
      note: 'staff home 能力（active 阶段对未出行者）' }, await rev())
    check('active 阶段 Staff home（未出行者）→ WRONG_PHASE（home 限 closing 且已出行）',
      r.ok === false && r.error.code === 'WRONG_PHASE', JSON.stringify(r.error || ''))
    check('home 被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    const r = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'closing', reason: '权限矩阵：收尾' }, await rev())
    check('Owner active→closing → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // closing × home：Member 自报（self 无需 note）；confirmed 未出行者（赵辰）→ WRONG_PHASE
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r = await MEMBER.dispatch({ type: 'attendance.home', activityId, signupId: memSignupId, note: 'MEM 自报平安' }, await rev())
    check('Member attendance.home（自己，closing，已出行）→ ALLOW', r.ok === true, JSON.stringify(r.error || ''))
    const before = await snapshot()
    const r2 = await OWNER.dispatch({ type: 'attendance.home', activityId, signupId: zhao, note: 'owner 对未出行者到家' }, await rev())
    check('Owner home（未出行者）→ WRONG_PHASE（home 限已出行者）', r2.ok === false && r2.error.code === 'WRONG_PHASE', JSON.stringify(r2.error || ''))
    check('未出行者 home 被拒后状态不变', (await snapshot()) === before, '')
  }
  {
    const r = await OWNER.dispatch({ type: 'activity.transition', activityId, next: 'archived', reason: '权限矩阵：归档' }, await rev())
    check('Owner closing→archived → ALLOW', r.ok === true, JSON.stringify(r.error || ''))
  }
  {
    // archived：写命令 → WRONG_PHASE（阶段门，非 FORBIDDEN——阶段语义与权限语义分开断言）
    const r = await OWNER.dispatch({ type: 'vehicle.save', activityId, vehicleId: null,
      input: { label: '迟到的车', plate: 'L', legalCapacity: 5, blockedSeats: 0, drivers: [{ kind: 'service', name: 's', phone: '00000000094', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, await rev())
    check('archived 后 vehicle.save（owner）→ WRONG_PHASE（阶段门语义）', r.ok === false && r.error.code === 'WRONG_PHASE', JSON.stringify(r.error || ''))
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r2 = await OWNER.dispatch({ type: 'signup.review', activityId, signupIds: [zhao], decision: 'confirm' }, await rev())
    check('archived 后 signup.review（owner）→ WRONG_PHASE', r2.ok === false && r2.error.code === 'WRONG_PHASE', JSON.stringify(r2.error || ''))
  }
  {
    // archived：readSensitive（他人）→ FORBIDDEN（workDataAvailable=false 的读面语义——非 WRONG_PHASE）
    const rows = (await activityView(OWNER)).rows
    const zhao = (rows.find(r => r.name === '赵辰') || {}).signupId
    const r = await OWNER.readSensitive(activityId, zhao, '归档后查阅')
    check('archived 后 Owner readSensitive（他人）→ FORBIDDEN（workDataAvailable 读面语义，嵌套读信封）',
      r.ok === true && r.data && r.data.ok === false && r.data.error && r.data.error.code === 'FORBIDDEN', 'raw=' + JSON.stringify(r).slice(0, 130))
  }

  // —— 结论 ——
  console.log('\n==== VERDICT ====')
  console.log('passed=' + passed + ' failed=' + failed)
  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error('权限矩阵执行异常：', e && (e.stack || e.message || e)); process.exit(1) })
