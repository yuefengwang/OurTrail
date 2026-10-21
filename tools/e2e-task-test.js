// A 层信封：task.* 真打 exports.main（路由 → overrideEvidence → 幂等 → CAS → 持久化 → read 回读）。
// 与 tasks-test 的分工：后者直调 domain，本套件补「真实信封 + 403 / CONFLICT / 重放」这层。
// 运行：node tools/e2e-task-test.js
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
const trailApi = require('../cloudfunctions/trailApi/index')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const LIN = 'o-lin-task-e2e'
const CHEN = 'o-chen-task-e2e'
const OUT = 'o-outsider-task-e2e'
const iso = min => new Date(Date.now() + min * 60000 + 8 * 3600000).toISOString().slice(0, 19) + '+08:00'

function as(openid) {
  const call = (action, extra) => {
    stub.__state.openid = openid
    return trailApi.main(Object.assign({ action }, extra))
  }
  return {
    read: request => call('read', { request }),
    dispatch: async (payload, expectedRevision, requestId) => {
      let rev = expectedRevision
      if (!Number.isInteger(rev)) {
        const r = await call('read', { request: { kind: 'profile' } })
        if (r && r.ok) rev = r.data.revision
      }
      return call('dispatch', { payload, expectedRevision: rev, requestId })
    },
  }
}
const lin = as(LIN)
const chen = as(CHEN)
const outsider = as(OUT)

function person(name, phone) {
  return { name, phone, emergency: { name: '家属', phone: '00000000009' }, medical: '', avatar: '' }
}
function activityInput() {
  return {
    title: '任务 A 层测试', description: '', organizerIntro: '',
    startAt: iso(1440), endAt: iso(2160), deadlineAt: iso(120),
    acceptingSignups: true, capacity: 10, approvalMode: 'automatic', routeId: null,
    routeSnapshot: {
      title: '测试路线', distanceKm: 8, ascentM: 400,
      points: [{ id: 'pt-1', name: '起点', kind: 'start', coordinates: { lat: 30, lng: 103 } }],
      risks: [],
    },
    pickupPoints: [{ id: 'pk-1', name: '集合点', meetingAt: iso(1380), address: '测试地址', coordinates: null }],
    equipment: [], equipmentSuggested: [], feeNote: '', cancellationNote: '',
  }
}
function taskInput(over) {
  return Object.assign({ title: '采购饮用水', note: '6 箱', category: 'food', assigneeName: '林溪', dueAt: null }, over || {})
}
async function readTasks(who, activityId) {
  const r = await who.read({ kind: 'tasks', activityId })
  return r
}
async function main() {
  section('0. 建档 → 活动 → 参与者')
  let r = await lin.dispatch({ type: 'profile.save', person: person('林溪', '00000000001') }, 0)
  check('owner 建档 → ok', r.ok === true, JSON.stringify(r.error))
  r = await chen.dispatch({ type: 'profile.save', person: person('陈屿', '00000000002') }, r.data.revision)
  check('参与者建档 → ok', r.ok === true, JSON.stringify(r.error))
  r = await lin.dispatch({ type: 'activity.create', input: activityInput() }, r.data.revision)
  check('activity.create → 草稿', r.ok === true, JSON.stringify(r.error))
  const activityId = r.data.targetIds[0]
  r = await lin.dispatch({ type: 'activity.publish', activityId, participation: null }, r.data.revision)
  check('activity.publish → published', r.ok === true, JSON.stringify(r.error))
  r = await chen.dispatch({
    type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
    participants: [{
      personRef: { kind: 'user', userId: CHEN },
      participant: person('陈屿', '00000000002'),
      trip: { mode: 'self' },
      consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    }],
  }, r.data.revision)
  check('参与者 signup.submit → ok', r.ok === true, JSON.stringify(r.error))

  section('1. 真实信封：owner 创建 → read 回读')
  let revision = r.data.revision
  let taskId = ''
  {
    r = await lin.dispatch({ type: 'task.create', activityId, input: taskInput() }, revision)
    check('task.create 走真实 dispatch → ok', r.ok === true && Array.isArray(r.data.targetIds), JSON.stringify(r))
    taskId = r.data.targetIds[0]
    revision = r.data.revision
    const view = await readTasks(lin, activityId)
    check('read {kind:"tasks"} 回读', view.ok && view.data.view.kind === 'tasks' && view.data.view.tasks.length === 1,
      JSON.stringify(view.data && view.data.view))
    check('owner canManage=true；任务默认 todo', view.data.view.canManage === true && view.data.view.tasks[0].status === 'todo',
      JSON.stringify(view.data.view))
    check('响应 revision 与 read revision 一致', view.data.revision === revision,
      JSON.stringify([view.data.revision, revision]))
  }

  section('2. 403 / CAS / 幂等 / 零副作用')
  {
    const before = (await readTasks(lin, activityId)).data.view.tasks.length
    r = await chen.dispatch({ type: 'task.create', activityId, input: taskInput({ title: '越权任务' }) }, revision)
    check('非组织者 task.create → FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r))
    const out = await outsider.read({ kind: 'tasks', activityId })
    check('无关账号读 tasks → denied', out.ok && out.data.view.kind === 'denied', JSON.stringify(out.data && out.data.view))
    const after = (await readTasks(lin, activityId)).data.view.tasks.length
    check('被拒命令零副作用：任务数不变', before === after, JSON.stringify([before, after]))

    r = await lin.dispatch({ type: 'task.create', activityId, input: taskInput({ title: '陈旧基线' }) }, revision - 1)
    check('陈旧 revision → CONFLICT', r.ok === false && r.error.code === 'CONFLICT', JSON.stringify(r))
    check('CONFLICT 后任务数不变', (await readTasks(lin, activityId)).data.view.tasks.length === before)

    const rid = 'task-idem-e2e'
    r = await lin.dispatch({ type: 'task.create', activityId, input: taskInput({ title: '幂等任务' }) }, revision, rid)
    check('首次幂等请求 ok', r.ok === true, JSON.stringify(r.error))
    revision = r.data.revision
    const replay = await lin.dispatch({ type: 'task.create', activityId, input: taskInput({ title: '幂等任务' }) }, revision, rid)
    check('同 requestId + 同内容 → replayed=true', replay.ok === true && replay.data.replayed === true, JSON.stringify(replay))
    check('重放不新增第二条任务', (await readTasks(lin, activityId)).data.view.tasks.filter(t => t.title === '幂等任务').length === 1)
    const reused = await lin.dispatch({ type: 'task.create', activityId, input: taskInput({ title: '不同内容' }) }, revision, rid)
    check('同 requestId + 不同内容 → REQUEST_REUSED', reused.ok === false && reused.error.code === 'REQUEST_REUSED', JSON.stringify(reused))
  }

  section('3. 参与者只读 / 更新 / 状态 / 删除')
  {
    const part = await readTasks(chen, activityId)
    check('参与者 read tasks → canManage=false 且可见', part.ok && part.data.view.canManage === false && part.data.view.tasks.length >= 1,
      JSON.stringify(part.data && part.data.view))
    r = await chen.dispatch({ type: 'task.update', activityId, taskId, input: taskInput({ title: '篡改' }) }, revision)
    check('参与者 update → FORBIDDEN', r.ok === false && r.error.code === 'FORBIDDEN', JSON.stringify(r))

    r = await lin.dispatch({ type: 'task.update', activityId, taskId, input: taskInput({ title: '采购晚餐', category: 'logistics' }) }, revision)
    check('owner update → ok', r.ok === true, JSON.stringify(r.error))
    revision = r.data.revision
    r = await lin.dispatch({ type: 'task.status', activityId, taskId, status: 'doing' }, revision)
    check('owner status → ok', r.ok === true, JSON.stringify(r.error))
    revision = r.data.revision
    const after = await readTasks(lin, activityId)
    const updated = after.data.view.tasks.find(t => t.id === taskId)
    check('read 回读更新与状态', updated && updated.title === '采购晚餐' && updated.status === 'doing', JSON.stringify(updated))

    r = await lin.dispatch({ type: 'task.remove', activityId, taskId }, revision)
    check('owner remove → ok', r.ok === true, JSON.stringify(r.error))
    revision = r.data.revision
    const gone = await readTasks(lin, activityId)
    check('read 回读删除后不存在', gone.data.view.tasks.every(t => t.id !== taskId), JSON.stringify(gone.data.view.tasks))
  }

  section('4. 草稿删除级联（A 层）')
  {
    let s = await lin.dispatch({ type: 'activity.create', input: activityInput({ title: '草稿任务 A 层' }) }, revision)
    const draftId = s.data.targetIds[0]
    revision = s.data.revision
    s = await lin.dispatch({ type: 'task.create', activityId: draftId, input: taskInput({ title: '草稿内任务' }) }, revision)
    revision = s.data.revision
    check('草稿活动可建任务', s.ok === true, JSON.stringify(s.error))
    s = await lin.dispatch({ type: 'activity.delete', activityId: draftId }, revision)
    check('删除草稿 → ok', s.ok === true, JSON.stringify(s.error))
    revision = s.data.revision
    const after = await readTasks(lin, draftId)
    check('活动删除后 read tasks → denied', after.ok && after.data.view.kind === 'denied', JSON.stringify(after.data && after.data.view))
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('E2E_TASK_FAILED', e && e.stack || e); process.exit(1) })
