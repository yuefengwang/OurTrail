// 通知类型维度（D-03/FU-17）：node tools/notice-kind-test.js
// 被测：schema 的封闭词表 + 两处写入端（notice.publish / recordChange 自动通知）
//       + 两条投影（kind:'notices' 读行 / readNoticeManagement 的 noticeView）。
//
// 三条判据都来自 D-03 的验收：
//   ① 写端定类型：每种真实命令产出的通知必须带正确 kind——读取端不按文案反猜，
//      所以类型只能在写入那一刻知道；
//   ② 跨角色投影一致：同一条通知，组织者管理视图与参与者读行给出的 kind 必须逐字相同；
//   ③ 旧数据合法且显式：没有 kind 键的历史通知仍通过 stateSpec，并投影为 'unknown'
//      （类型丢了就说丢了，不得回落到按内容猜）；封闭词表要能拒掉词表外的值。
//
// fixture 全部经真实命令建立（lifecycle-harness 的硬约定）：
// 「我手工拼出来的 State」不是系统能到达的状态，用它测写入映射等于自证。
'use strict'
const S = require('../cloudfunctions/trailApi/domain/schema')
const selectors = require('../cloudfunctions/trailApi/domain/selectors')
const { createWorld, deepClone } = require('./lifecycle-harness')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + JSON.stringify(extra) + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const OWNER = 'o-owner-noticekind'
const MEMBER = 'o-member-noticekind'
const NOW = '2026-10-08T07:00:00+08:00'
// 独立 oracle：词表按 D-03 的产品决定写死在这里，不从 schema 反射——
// 反射拿到的就是被测对象自己的答案，词表被悄悄增删时它不会红。
const EXPECTED_KINDS = ['manual', 'publish', 'itinerary', 'review', 'join', 'cancel', 'unknown']

function fullActivityInput() {
  return {
    title: '通知类型夹具', description: '行程说明', organizerIntro: '组织者',
    startAt: '2026-10-11T08:00:00+08:00', endAt: '2026-10-11T18:00:00+08:00', deadlineAt: '2026-10-10T20:00:00+08:00',
    acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
    routeSnapshot: {
      title: '固定路线', distanceKm: 8, ascentM: 300,
      points: [{ id: 'pt-1', name: '起点', kind: 'start', coordinates: { lat: 30.9, lng: 103.4 } },
        { id: 'pt-2', name: '终点', kind: 'finish', coordinates: null }],
      risks: [],
    },
    pickupPoints: [{ id: 'pk-1', name: '集合点', meetingAt: '2026-10-11T07:00:00+08:00', address: '地铁口', coordinates: null }],
    equipment: [], feeNote: 'AA', cancellationNote: '行前联系',
  }
}

function saveProfile(w, userId, name, phone) {
  const r = w.dispatch(userId, { type: 'profile.save', person: { name, phone, emergency: { name: name + '家人', phone: '00000000099' }, medical: '' } })
  return r
}

function lastNotice(w) {
  return w.state.notices[w.state.notices.length - 1] || null
}

function readRows(state, userId, activityId) {
  const view = selectors.selectView(state, { userId }, { kind: 'notices', activityId }, NOW)
  return view.kind === 'notices' ? view.notices : []
}

function mgmtRows(state, userId, activityId) {
  const r = selectors.selectNoticeManagement(state, { userId }, activityId)
  return r.ok ? r.value.notices : []
}

function buildWorld() {
  const w = createWorld({ now: NOW })
  check('夹具：双方资料保存成功', saveProfile(w, OWNER, '组织者', '00000000001').ok && saveProfile(w, MEMBER, '参与者', '00000000002').ok)
  const created = w.dispatch(OWNER, { type: 'activity.create', input: fullActivityInput() })
  check('夹具：活动草稿建立成功', created.ok, created)
  const activityId = created.targetIds && created.targetIds[0]
  const ownerProfile = w.state.profiles.find(p => p.id === OWNER)
  const published = w.dispatch(OWNER, {
    type: 'activity.publish', activityId,
    participation: {
      personRef: { kind: 'user', userId: OWNER }, participant: ownerProfile.person,
      trip: { mode: 'shared', pickupPointId: 'pk-1' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    },
  })
  check('夹具：活动发布成功（组织者自动确认报名）', published.ok, published)
  return { w, activityId }
}

// 1. 写入端逐命令映射：kind 在写入那一刻定死
function scenario1() {
  section('1. 写端映射：每条真实命令产出的通知带正确 kind')
  const { w, activityId } = buildWorld()

  const publishNotice = lastNotice(w)
  check('activity.publish → publish', publishNotice && publishNotice.kind === 'publish', publishNotice && publishNotice.kind)
  check('自动通知保留源事件关联（kind 与 sourceEventId 同时有值）',
    !!(publishNotice && publishNotice.sourceEventId) && !!w.state.events.find(e => e.kind === 'activity.publish'),
    publishNotice && publishNotice.sourceEventId)

  const editInput = fullActivityInput()
  editInput.description = '行程说明已更新'
  const edited = w.dispatch(OWNER, { type: 'activity.edit', activityId, input: editInput })
  check('夹具：activity.edit 成功', edited.ok, edited)
  check('activity.edit → itinerary', lastNotice(w) && lastNotice(w).kind === 'itinerary', lastNotice(w) && lastNotice(w).kind)

  const memberProfile = w.state.profiles.find(p => p.id === MEMBER)
  const submitted = w.dispatch(MEMBER, {
    type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
    participants: [{
      personRef: { kind: 'user', userId: MEMBER }, participant: memberProfile.person,
      trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }],
  })
  check('夹具：signup.submit 成功', submitted.ok, submitted)
  check('signup.submit → join', lastNotice(w) && lastNotice(w).kind === 'join', lastNotice(w) && lastNotice(w).kind)

  const memberSignup = w.signupOf('参与者')
  const reviewed = w.dispatch(OWNER, { type: 'signup.review', activityId, signupIds: [memberSignup.id], decision: 'confirm' })
  check('夹具：signup.review 成功', reviewed.ok, reviewed)
  check('signup.review → review', lastNotice(w) && lastNotice(w).kind === 'review', lastNotice(w) && lastNotice(w).kind)

  const gathered = w.dispatch(OWNER, { type: 'activity.transition', activityId, next: 'gathering', reason: '按期集合' })
  check('夹具：published→gathering 成功', gathered.ok, gathered)
  check('activity.transition（非取消）→ itinerary',
    lastNotice(w) && lastNotice(w).kind === 'itinerary', lastNotice(w) && lastNotice(w).kind)

  const manualContent = '明早 7:00 集合，请带头灯'
  const manual = w.dispatch(OWNER, { type: 'notice.publish', activityId, audience: { kind: 'activity' }, content: manualContent })
  check('夹具：notice.publish 成功', manual.ok, manual)
  check('notice.publish → manual',
    lastNotice(w) && lastNotice(w).kind === 'manual' && lastNotice(w).content === manualContent,
    lastNotice(w) && [lastNotice(w).kind, lastNotice(w).content])

  const cancelled = w.dispatch(OWNER, { type: 'activity.transition', activityId, next: 'cancelled', reason: '天气突变' })
  check('夹具：gathering→cancelled 成功', cancelled.ok, cancelled)
  check('activity.transition(next=cancelled) → cancel', lastNotice(w) && lastNotice(w).kind === 'cancel', lastNotice(w) && lastNotice(w).kind)

  check('所有落库通知的 kind 都在封闭词表内',
    w.state.notices.length >= 6 && w.state.notices.every(n => EXPECTED_KINDS.indexOf(n.kind) !== -1),
    w.state.notices.map(n => n.kind))
  check('写完整批命令后的 State 仍通过 stateSpec（带 kind 的新数据合法）', S.validate(S.stateSpec, w.state))
  check('夹具全程无 invariant/oracle 违规', w.problems.length === 0, w.problems.slice(0, 3))
  return { w, activityId, manualNoticeId: manual.targetIds && manual.targetIds[0], memberId: MEMBER }
}

// 2. 跨角色投影一致：同一条通知在两条投影里 kind 逐字相同
function scenario2(ctx) {
  section('2. 跨角色投影：管理视图 ↔ 参与者读行 kind 一致')
  // 参与者必须先有报名才能读到 activity 受众的通知（canReadNotice 的入口条件），
  // 而取消会把报名置 cancelled ⇒ 这个用例停在取消之前单独建世界。
  const { w, activityId } = buildWorld()
  const memberProfile = w.state.profiles.find(p => p.id === MEMBER)
  const submitted = w.dispatch(MEMBER, {
    type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
    participants: [{
      personRef: { kind: 'user', userId: MEMBER }, participant: memberProfile.person,
      trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }],
  })
  check('夹具：参与者报名成功', submitted.ok, submitted)
  const reviewed = w.dispatch(OWNER, { type: 'signup.review', activityId, signupIds: [w.signupOf('参与者').id], decision: 'confirm' })
  check('夹具：参与者审核通过', reviewed.ok, reviewed)
  const manual = w.dispatch(OWNER, { type: 'notice.publish', activityId, audience: { kind: 'activity' }, content: '投影一致性用例' })
  check('夹具：手动通知发布成功', manual.ok, manual)

  const ownerRows = readRows(w.state, OWNER, activityId)
  const memberRows = readRows(w.state, MEMBER, activityId)
  const ownerMgmt = mgmtRows(w.state, OWNER, activityId)
  check('三条读路径都取到同一批通知', ownerRows.length === w.state.notices.length
    && memberRows.length === w.state.notices.length && ownerMgmt.length === w.state.notices.length,
  { owner: ownerRows.length, member: memberRows.length, mgmt: ownerMgmt.length, stored: w.state.notices.length })

  const kindsOf = rows => rows.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(n => n.id + ':' + n.kind)
  check('组织者读行与参与者读行 kind 逐项相同', JSON.stringify(kindsOf(ownerRows)) === JSON.stringify(kindsOf(memberRows)),
    { owner: kindsOf(ownerRows), member: kindsOf(memberRows) })
  check('管理视图（noticeView）与普通读行 kind 逐项相同', JSON.stringify(kindsOf(ownerMgmt)) === JSON.stringify(kindsOf(ownerRows)),
    { mgmt: kindsOf(ownerMgmt), owner: kindsOf(ownerRows) })
  check('两条投影的发布类通知都报 publish 与 manual',
    ownerMgmt.some(n => n.kind === 'publish') && ownerMgmt.some(n => n.kind === 'manual')
    && memberRows.some(n => n.kind === 'manual'),
    ownerMgmt.map(n => n.kind))
  check('非组织者不能读管理视图（kind 不因角色分叉，而是整条视图拒绝）',
    selectors.selectNoticeManagement(w.state, { userId: MEMBER }, activityId).ok === false)
}

// 3. 历史数据：缺 kind 合法，投影显式 unknown；词表封闭
function scenario3(ctx) {
  section('3. 旧数据兜底与封闭词表')
  const { w, activityId } = buildWorld()
  const memberProfile = w.state.profiles.find(p => p.id === MEMBER)
  const submitted = w.dispatch(MEMBER, {
    type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
    participants: [{
      personRef: { kind: 'user', userId: MEMBER }, participant: memberProfile.person,
      trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }],
  })
  check('夹具：参与者报名成功', submitted.ok, submitted)
  const reviewed = w.dispatch(OWNER, { type: 'signup.review', activityId, signupIds: [w.signupOf('参与者').id], decision: 'confirm' })
  check('夹具：参与者审核通过', reviewed.ok, reviewed)
  const manual = w.dispatch(OWNER, { type: 'notice.publish', activityId, audience: { kind: 'activity' }, content: '历史数据用例' })
  check('夹具：手动通知发布成功', manual.ok, manual)
  const noticeId = manual.targetIds[0]

  // 历史数据没有 kind 键：整批删掉模拟 D-03 之前落库的通知
  // （没有任何合法命令能产生缺键的新数据，所以这里只能从真实命令产出的状态上模拟旧存储）
  const legacy = deepClone(w.state)
  legacy.notices.forEach(n => { delete n.kind })
  check('缺 kind 的历史通知仍通过 stateSpec（旧数据合法）', S.validate(S.stateSpec, legacy), S.validate(S.stateSpec, legacy))
  check('词表内的 kind 通过 stateSpec',
    S.validate(S.stateSpec, (() => { const s = deepClone(legacy); s.notices.find(n => n.id === noticeId).kind = 'unknown'; return s })()))

  const ownerRows = readRows(legacy, OWNER, activityId)
  const memberRows = readRows(legacy, MEMBER, activityId)
  const mgmt = mgmtRows(legacy, OWNER, activityId)
  check('历史通知在三条读路径都可见（夹具有效性）', ownerRows.length === w.state.notices.length
    && memberRows.length === w.state.notices.length && mgmt.length === w.state.notices.length,
  { owner: ownerRows.length, member: memberRows.length, mgmt: mgmt.length, stored: w.state.notices.length })
  check('组织者读行把缺 kind 投影为 unknown', ownerRows.length > 0 && ownerRows.every(n => n.kind === 'unknown'), ownerRows.map(n => n.kind))
  check('参与者读行同样投影为 unknown（跨角色一致）', memberRows.length > 0 && memberRows.every(n => n.kind === 'unknown'), memberRows.map(n => n.kind))
  check('管理视图同样投影为 unknown', mgmt.length > 0 && mgmt.every(n => n.kind === 'unknown'), mgmt.map(n => n.kind))

  const bad = deepClone(legacy)
  bad.notices.find(n => n.id === noticeId).kind = 'system'
  check('封闭词表拒绝词表外的类型（system）', S.validate(S.stateSpec, bad) === false)
  const badAuto = deepClone(w.state)
  badAuto.notices[0].kind = 'publish '
  check('封闭词表不 trim、不接受带空格的值（不做类型强转）', S.validate(S.stateSpec, badAuto) === false)
}

function run() {
  const ctx = scenario1()
  scenario2(ctx)
  scenario3(ctx)
  console.log('\n' + (failed ? 'FAILED ' + failed : 'passed=' + passed) + (failed ? ' passed=' + passed : '') + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

run()
