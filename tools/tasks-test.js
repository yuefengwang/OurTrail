// 协作任务域：owner-only 写入、参与者/协作者只读、归档只读、草稿删除级联。
// 运行：node tools/tasks-test.js
'use strict'
const crypto = require('crypto')
const { reduceCommand, genId } = require('../cloudfunctions/trailApi/domain/commands')
const { canonicalPayload } = require('../cloudfunctions/trailApi/domain/contracts')
const { selectView } = require('../cloudfunctions/trailApi/domain/selectors')
const { assertInvariants } = require('../cloudfunctions/trailApi/domain/invariants')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const NOW = '2027-01-01T09:00:00+08:00'
const A = 'owner-a'
const B = 'participant-b'
const C = 'outsider-c'
const ctx = () => ({ now: NOW, id: genId })
const fp = payload => crypto.createHash('sha256').update(canonicalPayload(payload), 'utf8').digest('hex')
function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: NOW,
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
function ok(r, label) {
  if (!r.ok) throw new Error(label + ' failed: ' + JSON.stringify(r.error))
  return r.value.state
}
function profile(state, id, name) {
  return ok(dispatch(state, id, {
    type: 'profile.save',
    person: { name, phone: '00000000001', emergency: { name: '家属', phone: '00000000002' }, medical: '' },
  }), 'profile ' + id)
}
function activityInput(over) {
  return Object.assign({
    title: '任务测试活动', description: '', organizerIntro: '',
    startAt: '2027-02-01T08:00:00+08:00', endAt: '2027-02-01T18:00:00+08:00',
    deadlineAt: '2027-01-31T20:00:00+08:00',
    acceptingSignups: true, capacity: 10, approvalMode: 'automatic', routeId: null,
    routeSnapshot: {
      title: '测试路线', distanceKm: 8, ascentM: 400,
      points: [{ id: 'pt-1', name: '起点', kind: 'start', coordinates: { lat: 30, lng: 103 } }],
      risks: [],
    },
    pickupPoints: [{ id: 'pk-1', name: '集合点', meetingAt: '2027-02-01T07:00:00+08:00', address: '测试地址', coordinates: null }],
    equipment: [], equipmentSuggested: [], feeNote: '', cancellationNote: '',
  }, over || {})
}
function taskInput(over) {
  return Object.assign({ title: '采购饮用水', note: '', category: 'food', assigneeName: '林溪', dueAt: null }, over || {})
}
function taskView(state, actor, activityId) {
  return selectView(state, { userId: actor }, { kind: 'tasks', activityId }, NOW)
}

function run() {
  let state = emptyState()
  state = profile(state, A, '阿秋')
  state = profile(state, B, '林溪')
  state = ok(dispatch(state, A, { type: 'activity.create', input: activityInput() }), 'create activity')
  const actId = state.activities[0].id
  state = ok(dispatch(state, A, { type: 'activity.publish', activityId: actId, participation: null }), 'publish')
  state = ok(dispatch(state, B, {
    type: 'signup.submit', activityId: actId, keepTogether: false, mode: 'apply',
    participants: [{
      personRef: { kind: 'user', userId: B },
      participant: { name: '林溪', phone: '00000000002', emergency: { name: '家属', phone: '00000000003' }, medical: '' },
      trip: { mode: 'self' },
      consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }],
  }), 'signup B')

  section('1. 创建：owner-only、默认 todo、服务端证据')
  {
    const before = JSON.stringify(state)
    const r = dispatch(state, B, { type: 'task.create', activityId: actId, input: taskInput() })
    check('非组织者创建 → FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    check('被拒命令零副作用', JSON.stringify(state) === before)
  }
  let taskId = ''
  {
    const r = dispatch(state, A, { type: 'task.create', activityId: actId, input: taskInput() })
    check('组织者创建 ok', r.ok, r.error)
    state = r.value.state
    const task = state.tasks[0]
    taskId = task.id
    check('默认 status=todo', task.status === 'todo', task.status)
    check('created/updated 由服务端证据写入', task.created.by === A && task.updated.by === A && task.created.at === NOW)
    check('字段归一化：标题 trim、负责人 trim', task.title === '采购饮用水' && task.assigneeName === '林溪')
    check('不变量通过', assertInvariants(state).ok)
  }
  {
    const r = dispatch(state, A, { type: 'task.create', activityId: actId, input: taskInput({ title: '   ' }) })
    check('空标题被拒', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
    const r2 = dispatch(state, A, { type: 'task.create', activityId: actId, input: taskInput({ category: 'bogus' }) })
    check('非法分类被 schema 拒收', !r2.ok && r2.error.code === 'INVALID_INPUT', r2.error)
  }

  section('2. 读取：owner 可管理；参与者/协作者只读；路人拒绝')
  {
    const owner = taskView(state, A, actId)
    check('owner 读到 tasks 视图', owner.kind === 'tasks' && owner.tasks.length === 1, owner)
    check('owner canManage=true', owner.canManage === true)
    const part = taskView(state, B, actId)
    check('参与者可读、canManage=false', part.kind === 'tasks' && part.tasks.length === 1 && part.canManage === false, part)
    const out = taskView(state, C, actId)
    check('无关账号 denied', out.kind === 'denied' && out.message.indexOf('任务') !== -1, out)
    check('任务投影只含展示字段', JSON.stringify(Object.keys(owner.tasks[0]).sort()) === JSON.stringify(['assigneeName', 'category', 'dueAt', 'id', 'note', 'status', 'title', 'updatedAt']),
      Object.keys(owner.tasks[0]))
  }

  section('3. 更新 / 状态 / 排序 / 删除')
  {
    let r = dispatch(state, B, { type: 'task.update', activityId: actId, taskId, input: taskInput({ title: '篡改' }) })
    check('非组织者更新被拒', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    r = dispatch(state, A, { type: 'task.update', activityId: actId, taskId, input: taskInput({ title: '采购晚餐', category: 'logistics', dueAt: '2027-01-30T23:59:00+08:00' }) })
    state = r.value.state
    const task = state.tasks[0]
    check('组织者更新生效', task.title === '采购晚餐' && task.category === 'logistics' && task.dueAt === '2027-01-30T23:59:00+08:00', task)
    r = dispatch(state, A, { type: 'task.status', activityId: actId, taskId, status: 'doing' })
    state = r.value.state
    check('状态更新 doing', state.tasks[0].status === 'doing')
    r = dispatch(state, A, { type: 'task.status', activityId: actId, taskId, status: 'bogus' })
    check('非法状态被 schema 拒收', !r.ok && r.error.code === 'INVALID_INPUT', r.error)
    r = dispatch(state, A, { type: 'task.create', activityId: actId, input: taskInput({ title: '整理公共装备', category: 'gear' }) })
    state = r.value.state
    const sorted = taskView(state, A, actId).tasks
    check('按状态排序：doing 在 todo 前', sorted[0].status === 'doing' && sorted[1].status === 'todo',
      sorted.map(t => t.status))
    r = dispatch(state, A, { type: 'task.remove', activityId: actId, taskId })
    state = r.value.state
    check('删除后任务消失', state.tasks.length === 1 && state.tasks[0].title === '整理公共装备')
    r = dispatch(state, A, { type: 'task.remove', activityId: actId, taskId })
    check('重复删除 NOT_FOUND', !r.ok && r.error.code === 'NOT_FOUND', r.error)
  }

  section('4. 取消/归档后只读；草稿删除级联')
  {
    const bSignup = state.signups.find(s => s.personRef.kind === 'user' && s.personRef.userId === B)
    let s = ok(dispatch(state, A, { type: 'signup.cancel', activityId: actId, signupIds: [bSignup.id], reason: '测试取消' }), 'cancel signup')
    s = ok(dispatch(s, A, { type: 'activity.transition', activityId: actId, next: 'cancelled', reason: '测试取消' }), 'cancel activity')
    const r = dispatch(s, A, { type: 'task.status', activityId: actId, taskId: s.tasks[0].id, status: 'done' })
    check('取消后写任务被拒', !r.ok && r.error.code === 'FORBIDDEN', r.error)
    const v = taskView(s, A, actId)
    check('取消后仍可读、canManage=false', v.kind === 'tasks' && v.canManage === false, v)

    let draftState = emptyState()
    draftState = profile(draftState, A, '阿秋')
    draftState = ok(dispatch(draftState, A, { type: 'activity.create', input: activityInput({ title: '草稿任务' }) }), 'create draft')
    const draftId = draftState.activities[0].id
    draftState = ok(dispatch(draftState, A, { type: 'task.create', activityId: draftId, input: taskInput({ title: '草稿任务' }) }), 'task on draft')
    check('草稿活动可建任务', draftState.tasks.length === 1)
    draftState = ok(dispatch(draftState, A, { type: 'activity.delete', activityId: draftId }), 'delete draft')
    check('删除草稿级联清任务', draftState.tasks.length === 0, draftState.tasks)
    check('级联后不变量通过', assertInvariants(draftState).ok)
  }

  section('5. 任务不属于本活动')
  {
    let s = emptyState()
    s = profile(s, A, '阿秋')
    s = ok(dispatch(s, A, { type: 'activity.create', input: activityInput({ title: '活动一' }) }), 'a1')
    const a1 = s.activities[0].id
    s = ok(dispatch(s, A, { type: 'activity.create', input: activityInput({ title: '活动二' }) }), 'a2')
    const a2 = s.activities[1].id
    s = ok(dispatch(s, A, { type: 'task.create', activityId: a1, input: taskInput() }), 'task a1')
    const tid = s.tasks[0].id
    const r = dispatch(s, A, { type: 'task.status', activityId: a2, taskId: tid, status: 'done' })
    check('跨活动 taskId → FORBIDDEN', !r.ok && r.error.code === 'FORBIDDEN', r.error)
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}
run()
