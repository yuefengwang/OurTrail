// 对拍：快速创建放宽「不放水也不误伤」——完整活动（存量形状）在放宽前后的
// 域层行为必须逐字节相同。运行：node tools/ab-quick-create.js
// 手法：git archive <基线> 取放宽前的 domain 到临时目录；同一份命令序列
// （确定性 id / 时间 / requestId）分别喂旧与新，终态 state 逐字节对拍。
// 另配一条阳性对照（空路线活动）：旧必须拒、新必须收——证明对拍器真的在跑
// 被改的那道门，而不是两边都因为别的原因失败（2026-10-14 第十二轮教训：
// 没有阳性对照的对拍分不清「零差异」与「什么都没测」）。
'use strict'

const { execSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

// 基线 = 本功能动 cloudfunctions/ 之前的 master（78d7db9，路线库 + 天气韧性合并点）
const BASE = '78d7db9'
const REPO = path.join(__dirname, '..')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

/* ---------- 取放宽前的 domain ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-ab-'))
const archive = path.join(tmp, 'base.tar')
execSync('git archive ' + BASE + ' cloudfunctions/trailApi/domain -o "' + archive + '"', { cwd: REPO })
execSync('tar -xf "' + archive + '" -C "' + tmp + '"')
const OLD_DIR = path.join(tmp, 'cloudfunctions', 'trailApi', 'domain')
const OLD = {
  reduceCommand: require(path.join(OLD_DIR, 'commands.js')).reduceCommand,
  assertInvariants: require(path.join(OLD_DIR, 'invariants.js')).assertInvariants,
}
const NEW = {
  reduceCommand: require(path.join(REPO, 'cloudfunctions/trailApi/domain/commands.js')).reduceCommand,
  assertInvariants: require(path.join(REPO, 'cloudfunctions/trailApi/domain/invariants.js')).assertInvariants,
}

/* ---------- 确定性夹具 ---------- */
const MIN = 60000
const iso = min => new Date(Date.UTC(2026, 9, 20, 0, 0) + min * MIN).toISOString().slice(0, 19) + '+00:00'
const NOW = iso(0)
const emptyState = () => ({
  schemaVersion: 1, revision: 0, savedAt: NOW,
  profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
  assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
  events: [], notices: [], tasks: [], receipts: [],
})

// 确定性夹具的时间基准（UTC 墙上时刻，与两侧 ctx.now 同源）
const A = 'openid-owner'
const B = 'openid-guest'

function fullInput() {
  return {
    title: '青城后山环线', description: '轻徒步', organizerIntro: '阿秋带队',
    startAt: iso(1440), endAt: iso(2040), deadlineAt: iso(1380),
    acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
    routeSnapshot: {
      title: '飞泉沟环线', distanceKm: 12.8, ascentM: 680,
      points: [
        { id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.93, lng: 103.48 }, time: iso(-60), ele: 720 },
        { id: 'pt-2', name: '又一村', kind: 'checkpoint', coordinates: { lat: 30.94, lng: 103.49 }, ele: 920 },
      ],
      risks: [{ id: 'rk-1', title: '湿滑', advice: '防滑鞋', severity: 'mid' }],
      track: [{ lat: 30.93, lng: 103.48 }, { lat: 30.94, lng: 103.49 }],
    },
    pickupPoints: [{ id: 'pk-1', name: '地铁A口', meetingAt: iso(1410), address: '茶店子客运站', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '行前联系',
  }
}
// 空路线活动：同一把发布门下的阳性对照——旧拒新收
function emptyRouteInput() {
  const input = fullInput()
  input.title = '周六轻徒步'
  input.routeSnapshot = { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [] }
  return input
}

// 确定性 id / requestId：同一个序列在旧与新两侧必须产出同一批标识，否则终态无法对拍。
// 每个 run 一个共享计数器——recordChange 每条命令都建 event，per-command ctx 会让
// event id 跨命令重复（'event-3' 撞车 ⇒ 不变量「记录标识不能重复」假红）。
function runSequence(domain, input) {
  const log = []
  let state = emptyState()
  let req = 0
  let n = 0
  const ctx = { now: NOW, id: prefix => prefix + '-' + (++n) }
  const send = (actor, payload) => {
    const command = {
      actor: { userId: actor }, requestId: 'req-' + (++req), expectedRevision: state.revision,
      fingerprint: 'f'.repeat(63) + req.toString(16), payload,
    }
    const r = domain.reduceCommand(state, command, ctx)
    log.push((r.ok ? 'ok:' : 'ERR:' + r.error.code + ':') + payload.type)
    if (r.ok) state = r.value.state
    return r
  }
  send(A, { type: 'profile.save', person: { name: '阿秋', phone: '00000000001', emergency: { name: '家属', phone: '00000000009' }, medical: '' } })
  send(B, { type: 'profile.save', person: { name: '林溪', phone: '00000000002', emergency: { name: '家属', phone: '00000000009' }, medical: '' } })
  const created = send(A, { type: 'activity.create', input })
  if (!created.ok) return { log, state, activityId: null }
  const activityId = created.value.targetIds[0]
  const pub = send(A, { type: 'activity.publish', participation: null, activityId })
  if (!pub.ok) return { log, state, activityId }
  // 自行前往：随队出发的门只要求签到（拼车者还要先去程上车，需先建车分配，
  // 那不是这条对拍要称重的东西——拼车链路由 trip-mode / lifecycle-allocation 门禁覆盖）
  const su = send(B, { type: 'signup.submit', activityId, keepTogether: false, mode: 'apply',
    participants: [{ personRef: { kind: 'user', userId: B }, participant: state.profiles.find(p => p.id === B).person, trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] })
  if (!su.ok) return { log, state, activityId }
  send(A, { type: 'signup.review', activityId, signupIds: [su.value.targetIds[0]], decision: 'confirm' })
  send(A, { type: 'activity.transition', activityId, next: 'gathering', reason: '按期集合' })
  // 只改说明的合法 gathering 编辑：旧（整体锁）与新（只增不改）都必须收，且结果相同。
  // 表单按「推进后重读」装配（真编辑器 reload 的形状）：从落库状态剥掉服务端键。
  // 两个易踩的陈旧键——transition 置 false 的 acceptingSignups、create 时
  // persistPrivateRoute 回填的 routeId——带着旧值都会被阶段门拒
  // （e2e-interleave C6 记过的同一现象），都不是本轮要测的东西。
  const stored = JSON.parse(JSON.stringify(state.activities.find(a => a.id === activityId)))
  delete stored.id; delete stored.ownerId; delete stored.phase; delete stored.publishedAt
  const edit = Object.assign(stored, { description: '集合点改到B口旁边' })
  send(A, { type: 'activity.edit', activityId, input: edit })
  send(A, { type: 'attendance.checkin', activityId, signupId: su.value.targetIds[0], checkIn: { method: 'manual', evidence: { at: NOW, by: A, note: '现场核实' } } })
  send(A, { type: 'attendance.departure', activityId, signupId: su.value.targetIds[0], outcome: { kind: 'joined', evidence: { at: NOW, by: A, note: '' } } })
  send(A, { type: 'activity.transition', activityId, next: 'active', reason: '出发' })
  return { log, state, activityId }
}

section('1. 完整活动（存量形状）：放宽前后逐字节相同')
{
  const oldRun = runSequence(OLD, fullInput())
  const newRun = runSequence(NEW, fullInput())
  check('两侧命令序列的成败码完全一致', JSON.stringify(oldRun.log) === JSON.stringify(newRun.log),
    { old: oldRun.log, new: newRun.log })
  check('序列全程无拒绝（不放水也不误伤）', oldRun.log.every(l => l.indexOf('ok:') === 0), oldRun.log)
  check('终态 state 逐字节相同', JSON.stringify(oldRun.state) === JSON.stringify(newRun.state),
    'len ' + JSON.stringify(oldRun.state).length + ' vs ' + JSON.stringify(newRun.state).length)
  check('两侧不变量都通过', OLD.assertInvariants(oldRun.state).ok && NEW.assertInvariants(newRun.state).ok)
}

section('2. 阳性对照：同一把门，空路线活动旧拒新收')
{
  const oldRun = runSequence(OLD, emptyRouteInput())
  const newRun = runSequence(NEW, emptyRouteInput())
  const oldPub = oldRun.log.indexOf('ERR:INVALID_INPUT:activity.publish') !== -1
  const newPub = newRun.log.indexOf('ok:activity.publish') !== -1
  check('旧域：空路线 publish 被拒（证明基线就是那道门）', oldPub, oldRun.log)
  check('新域：空路线 publish 被收（证明对拍器测到了放宽）', newPub, newRun.log)
  // 零副作用的正确形状：create 留下的草稿活动本就合法（draft 不设完整性门），
  // 要证的是 publish 拒绝后它**仍是 draft、内容一字未动**。
  const leftover = oldRun.state.activities[0] || {}
  check('旧域拒后活动仍是草稿且路线为空（publish 零副作用）',
    oldRun.state.activities.length === 1 && leftover.phase === 'draft'
    && leftover.routeSnapshot.points.length === 0 && leftover.routeSnapshot.risks.length === 0,
    { phase: leftover.phase, points: (leftover.routeSnapshot || {}).points })
}

console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
