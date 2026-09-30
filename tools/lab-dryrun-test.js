// 预演剧本离线干跑：node tools/lab-dryrun-test.js
// 用真实 domain 层在内存里把 trailApiLab 的剧本从头演到尾：
//   建档 → 建活动发布（替身发起人）→ 报名 → 审核/拒绝 → 修与撤 → 集结 → 出发核实
//   → 进行中 → 现场（位置/节点/异常）→ 到家结案 → 收尾 → 归档
// 每条命令都先过 S.Command 校验，再过 reduceCommand（权限 + 业务 + 不变量全真）。
// 这既是剧本上云前的排练，也是一份无 UI 的全流程回归锁。
'use strict'
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const S = require('../cloudfunctions/trailApi/domain/schema')
const { reduceCommand } = require('../cloudfunctions/trailApi/domain/commands')
const { canonicalPayload, deepClone, genId } = require('../cloudfunctions/trailApi/domain/contracts')
const { assertInvariants } = require('../cloudfunctions/trailApi/domain/invariants')
const stages = require('../cloudfunctions/trailApiLab/stages')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const OWNER = 'u-owner'
const NOW = '2026-10-05T09:00:00+08:00'
const NOW_MS = Date.parse(NOW)

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}
// 与云函数一致的证据覆写：at/by 以服务端为准
function overrideEvidence(node, now, actorId) {
  if (Array.isArray(node)) { node.forEach(x => overrideEvidence(x, now, actorId)); return node }
  if (node === null || typeof node !== 'object') return node
  const keys = Object.keys(node)
  if (keys.length === 3 && 'at' in node && 'by' in node && 'note' in node) {
    node.at = now; node.by = actorId; node.note = String(node.note || '').slice(0, 2000)
    return node
  }
  keys.forEach(k => overrideEvidence(node[k], now, actorId))
  return node
}

function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: NOW,
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
}
let state = emptyState()
let cmdCount = 0

// 内存执行器：与 trailApiLab/index.js 的 execCommand 同一管线（无持久化）
// allowFailCodes：预期中的域层拒绝（如 CAPACITY），按"按预期被拒"记账而非失败
function exec(actorId, payload, requestId, opts) {
  const options = opts || {}
  const clean = deepClone(payload)
  overrideEvidence(clean, NOW, actorId)
  const cmd = {
    actor: { userId: actorId }, requestId, expectedRevision: state.revision,
    fingerprint: sha256(canonicalPayload(clean)), payload: clean,
  }
  check('命令 ' + ++cmdCount + '（' + actorId + ' ' + payload.type + '）通过 S.Command 校验',
    S.validate(S.Command, cmd) === true, JSON.stringify(clean).slice(0, 160))
  const r = reduceCommand(state, cmd, { now: NOW, id: genId })
  const expectedFail = !r.ok && (options.allowFailCodes || []).indexOf(r.error.code) !== -1
  check('命令 ' + cmdCount + '（' + actorId + ' ' + payload.type + '）' + (expectedFail ? '按预期被拒（' + r.error.code + '）' : '通过领域层'),
    r.ok === true || expectedFail, r.ok ? '' : r.error.code + ' ' + r.error.message)
  if (r.ok) state = r.value.state
  return r
}

// 跑一个阶段：断言所有命令领域层通过；返回 plan
function runStage(n, ctx, expectCommands) {
  const plan = stages.buildStage(n, state, ctx)
  check('阶段 ' + n + '（' + (plan.title || '') + '）构建成功', !plan.error, plan.error)
  if (plan.error) return plan
  if (expectCommands !== undefined) {
    check('阶段 ' + n + ' 产生 ' + expectCommands + ' 条命令', plan.commands.length === expectCommands,
      String(plan.commands.length))
  }
  let allOk = true
  for (const step of plan.commands) {
    let r = exec(step.actorId, step.payload, step.requestId, { allowFailCodes: ['CAPACITY'] })
    // 与云端执行器 runStep 同一语义：报名满员 → 整组候补重试
    if (!r.ok && step.payload.type === 'signup.submit' && step.payload.mode === 'apply') {
      r = exec(step.actorId, Object.assign({}, step.payload, { mode: 'waitlist' }), step.requestId + '-w')
    }
    if (!r.ok) allOk = false
  }
  check('阶段 ' + n + ' 全部命令执行成功', allOk, '')
  return plan
}

async function main() {
  // ---- 护栏：lab 与主函数的 domain/store 必须同源 ----
  section('0. lab 同步护栏')
  {
    const ROOT = path.join(__dirname, '..')
    const rels = ['store.js'].concat(
      fs.readdirSync(path.join(ROOT, 'cloudfunctions', 'trailApi', 'domain'))
        .filter(f => f.endsWith('.js')).map(f => 'domain/' + f))
    const drifted = rels.filter(rel => {
      const src = fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'trailApi', rel), 'utf8')
      const dst = path.join(ROOT, 'cloudfunctions', 'trailApiLab', rel)
      return !fs.existsSync(dst) || fs.readFileSync(dst, 'utf8') !== src
    })
    check('trailApiLab 与 trailApi 的 domain/store 逐字节一致（' + rels.length + ' 个文件）',
      drifted.length === 0, drifted.length ? '不一致：' + drifted.join('、') + ' —— 先跑 node tools/sync-lab.js' : '')
  }

  // ---- 阶段 0：建档 ----
  section('阶段 0 · 建档')
  {
    const plan = runStage(0, {}, stages.ACTORS.length + stages.COMPANIONS.length)
    check('5 个演员档案 + 2 个同行人已入库',
      state.profiles.length === 5
      && state.profiles.find(p => p.id === 'u-lab-02').companions.length === 1
      && state.profiles.find(p => p.id === 'u-lab-03').companions.length === 1,
      JSON.stringify(state.profiles.map(p => p.id)))
    check('阶段 0 不需要活动', !plan.activityId && plan.commands.every(c => c.payload.type === 'profile.save' || c.payload.type === 'companion.save'), '')
    const board0 = stages.buildStageBoard(state, '')
    check('状态板：建档 done、无活动时报名阶段被挡住（提示建 [预演] 活动）',
      board0[0].status === 'done' && board0[1].status === 'blocked' && board0[1].reason.indexOf('[预演]') !== -1,
      JSON.stringify(board0.map(b => b.status)))
  }

  // ---- 替身发起人：建活动 + 发布（真机里这两步由用户在 UI 完成）----
  section('替身发起人 · 建活动并发布')
  let activityId = ''
  {
    exec(OWNER, { type: 'profile.save', person: stages.mkPerson('预演发起人', '13800000000') }, 'lab-dry-owner-profile')
    const input = {
      title: stages.PREFIX + ' 走查 · 剧本干跑',
      description: '离线干跑用活动',
      organizerIntro: '预演调度',
      startAt: '2026-10-10T08:00:00+08:00',
      endAt: '2026-10-10T18:00:00+08:00',
      deadlineAt: '2026-10-09T22:00:00+08:00',
      acceptingSignups: true, capacity: 6, approvalMode: 'manual', routeId: null,
      routeSnapshot: {
        title: '干跑环线', distanceKm: 12, ascentM: 800,
        points: [
          { id: 'p-lab-1', name: '起点 · 停车场', kind: 'start', coordinates: { lat: 30.9123, lng: 103.4781 } },
          { id: 'p-lab-2', name: '垭口', kind: 'checkpoint', coordinates: { lat: 30.9201, lng: 103.4862 } },
          { id: 'p-lab-3', name: '终点 · 古寺', kind: 'finish', coordinates: { lat: 30.9264, lng: 103.4903 } },
        ],
        risks: [{ id: 'r-lab-1', title: '垭口风大', advice: '早出发，14 点前翻垭口' }],
        track: [{ lat: 30.9123, lng: 103.4781 }, { lat: 30.9201, lng: 103.4862 }, { lat: 30.9264, lng: 103.4903 }],
      },
      pickupPoints: [
        { id: 'pk-lab-1', name: '东门集合点', meetingAt: '2026-10-10T07:30:00+08:00', address: '东门停车场', coordinates: { lat: 30.905, lng: 103.470 } },
        { id: 'pk-lab-2', name: '西门停车区', meetingAt: '2026-10-10T07:30:00+08:00', address: '西门停车区', coordinates: null },
      ],
      equipment: ['头灯', '登山杖'],
      feeNote: '', cancellationNote: '出发前 24 小时外可全额退出',
    }
    const created = exec(OWNER, { type: 'activity.create', input }, 'lab-dry-activity-create')
    activityId = created.value.targetIds[0]
    check('活动已创建（草稿）', !!activityId && state.activities[0].phase === 'draft', activityId)
    exec(OWNER, { type: 'activity.publish', activityId, participation: null }, 'lab-dry-activity-publish')
    check('活动已发布', state.activities[0].phase === 'published', state.activities[0].phase)
    check('findLabActivity 能发现它（含发起人限定）',
      stages.findLabActivity(state, OWNER).id === activityId
      && stages.findLabActivity(state, '别人') === null
      && stages.findLabActivity(state, '') .id === activityId, '')
    const board1 = stages.buildStageBoard(state, activityId)
    check('状态板：发布后报名 ready、签到 blocked（未到集结中）',
      board1[1].status === 'ready' && board1[3].status === 'blocked',
      JSON.stringify(board1.map(b => b.status)))
  }

  // ---- 阶段 1：报名 ----
  section('阶段 1 · 报名（容量 6：前四组 6 人恰好占满，演员五整组候补）')
  {
    const plan = runStage(1, { activityId }, 5)
    const rows1 = state.signups.filter(s => s.activityId === activityId)
    const waitlisted = rows1.filter(s => s.status === 'waitlisted')
    check('7 行报名：6 行 pending + 演员五 1 行整组候补',
      rows1.length === 7 && rows1.filter(s => s.status === 'pending').length === 6
      && waitlisted.length === 1 && waitlisted[0].submittedByUserId === 'u-lab-05',
      JSON.stringify(rows1.map(s => s.status)))
    check('阶段 1 提示包含审核引导', plan.hint.indexOf('审核') !== -1, '')
  }

  // ---- 替身发起人：审核（真机在 UI 里做）----
  section('替身发起人 · 审核：前四组通过；演员五的候补走取消（域规则：候补不可「拒绝」）')
  {
    const rows = state.signups.filter(s => s.activityId === activityId
      && (s.status === 'pending' || s.status === 'waitlisted'))
    const bySubmitter = {}
    rows.forEach(s => { (bySubmitter[s.submittedByUserId] = bySubmitter[s.submittedByUserId] || []).push(s.id) })
    const confirm = ['u-lab-01', 'u-lab-02', 'u-lab-03', 'u-lab-04'].flatMap(u => bySubmitter[u] || [])
    const waitlisted = bySubmitter['u-lab-05'] || []
    check('待审 5 组 7 行（6 行 pending + 1 行候补）',
      rows.length === 7 && confirm.length === 6 && waitlisted.length === 1,
      JSON.stringify({ confirm: confirm.length, waitlisted: waitlisted.length }))
    exec(OWNER, { type: 'signup.review', activityId, signupIds: confirm, decision: 'confirm' }, 'lab-dry-review-confirm')
    check('前四组已确认', state.signups.filter(s => confirm.indexOf(s.id) !== -1).every(s => s.status === 'confirmed'), '')
    const rWait = exec(OWNER, { type: 'signup.review', activityId, signupIds: waitlisted, decision: 'reject' }, 'lab-dry-review-waitlist', { allowFailCodes: ['WRONG_PHASE'] })
    check('候补行不能走审核拒绝（域层 WRONG_PHASE 护栏）', !rWait.ok && rWait.error.code === 'WRONG_PHASE', '')
    exec(OWNER, { type: 'signup.cancel', activityId, signupIds: waitlisted, reason: '候补未转正，退出（预演）' }, 'lab-dry-cancel-waitlist')
    check('演员五（候补组）已被移出（owner 取消他人 → removed）',
      ['removed', 'cancelled'].indexOf(state.signups.find(s => waitlisted.indexOf(s.id) !== -1).status) !== -1, '')
  }

  // ---- 阶段 2：修与撤 ----
  section('阶段 2 · 修改与退出')
  {
    runStage(2, { activityId }, 2)
    const a03 = state.signups.find(s => s.activityId === activityId && s.submittedByUserId === 'u-lab-03' && s.personRef.kind === 'user')
    const a04 = state.signups.find(s => s.activityId === activityId && s.submittedByUserId === 'u-lab-04' && s.personRef.kind === 'user')
    check('演员张三上车点已改为东门集合点（shared）',
      a03.trip.mode === 'shared' && a03.trip.pickupPointId === 'pk-lab-1', JSON.stringify(a03.trip))
    check('演员李四已退出（cancelled）', a04.status === 'cancelled', a04.status)
  }

  // ---- 替身发起人：推进 gathering ----
  section('替身发起人 · 推进 集结中')
  exec(OWNER, { type: 'activity.transition', activityId, next: 'gathering', reason: '' }, 'lab-dry-tr-gathering')
  check('阶段已到 gathering', state.activities[0].phase === 'gathering', state.activities[0].phase)

  // ---- 阶段 3：签到 ----
  section('阶段 3 · 签到（剧本只管演员侧）')
  {
    const confirmed = state.signups.filter(s => s.activityId === activityId && s.status === 'confirmed')
    runStage(3, { activityId }, confirmed.length)
    check('每位已确认者都有签到记录：本人行模拟定位、同行人行 manual 代确认',
      confirmed.every(s => {
        const att = state.attendance.find(x => x.signupId === s.id)
        const wantMethod = s.personRef.kind === 'user' ? 'simulation' : 'manual'
        return att && att.checkIn && att.checkIn.method === wantMethod
      }), JSON.stringify(state.attendance.map(a => a.checkIn && a.checkIn.method)))
    check('签到证据的 at/by 已被服务端覆写（不是空串；已取消行的空存根除外）',
      state.attendance.every(a => !a.checkIn || (a.checkIn.evidence.at === NOW && a.checkIn.evidence.by !== '')), '')
  }

  // ---- 替身发起人：分车 + 上车核实 + 发车（真机在工作台 UI 做）----
  section('替身发起人 · 分车、上车核实、发车')
  {
    const confirmed = state.signups.filter(s => s.activityId === activityId && s.status === 'confirmed')
    const mkVehicle = (label, plate) => ({
      label, plate, legalCapacity: 4, drivers: [{ kind: 'service', name: '预演师傅', phone: '13900000000', userId: null }],
      blockedSeats: 0, seatLabels: ['01', '02', '03'], pickupPointIds: ['pk-lab-1', 'pk-lab-2'],
    })
    const v1 = exec(OWNER, { type: 'vehicle.save', activityId, vehicleId: null, input: mkVehicle('1号车', '川A·预演01') }, 'lab-dry-vehicle-1')
    const v2 = exec(OWNER, { type: 'vehicle.save', activityId, vehicleId: null, input: mkVehicle('2号车', '川A·预演02') }, 'lab-dry-vehicle-2')
    const vehicleIds = [v1.value.targetIds[0], v2.value.targetIds[0]]
    check('两辆车已入库', state.vehicles.filter(x => x.activityId === activityId).length === 2, '')
    const shared = confirmed.filter(s => s.trip.mode === 'shared')
    check('确认行中 3 行 shared（可分座）、2 行 self（自行到达，不可分座）',
      shared.length === 3 && confirmed.length === 5, JSON.stringify(confirmed.map(s => s.trip.mode)))
    shared.forEach((s, i) => {
      exec(OWNER, {
        type: 'assignment.set', activityId,
        target: { signupId: s.id, vehicleId: vehicleIds[i < 2 ? 0 : 1], seatLabel: '0' + ((i % 2) + 1) },
      }, 'lab-dry-assign-' + s.id)
    })
    check('仅 shared 行有座位安排（自行到达者被域层拒之门外）',
      state.assignments.filter(x => x.activityId === activityId).length === 3, '')
    for (const s of shared) {
      exec(OWNER, { type: 'attendance.board', activityId, signupId: s.id, leg: 'outbound', boarded: true, note: '本车清点上车（预演）' }, 'lab-dry-board-' + s.id)
    }
    for (const s of confirmed) {
      exec(OWNER, { type: 'attendance.departure', activityId, signupId: s.id, outcome: { kind: 'joined', evidence: { at: '', by: '', note: '已核实出发（预演）' } } }, 'lab-dry-depart-' + s.id)
    }
    check('shared 行已核上车、全部确认行已核实出发（gathering→active 门槛已备齐）',
      shared.every(s => {
        const att = state.attendance.find(x => x.signupId === s.id)
        return att && att.boardingByLeg.outbound
      }) && confirmed.every(s => {
        const att = state.attendance.find(x => x.signupId === s.id)
        return att && att.departure && att.departure.kind === 'joined'
      }), '')
  }

  // ---- 替身发起人：推进 active ----
  section('替身发起人 · 推进 进行中')
  exec(OWNER, { type: 'activity.transition', activityId, next: 'active', reason: '' }, 'lab-dry-tr-active')
  check('阶段已到 active（gathering→active 门槛：出发核实已齐）', state.activities[0].phase === 'active', state.activities[0].phase)

  // ---- 阶段 4：现场 ----
  section('阶段 4 · 现场')
  {
    runStage(4, { activityId }, 4)
    const pos = state.positions.filter(p => state.signups.some(s => s.id === p.signupId && s.activityId === activityId))
    check('位置上报已落库（每人最新一条）', pos.length === 3, String(pos.length))
    const a01 = state.signups.find(s => s.activityId === activityId && s.submittedByUserId === 'u-lab-01' && s.personRef.kind === 'user')
    const att01 = state.attendance.find(x => x.signupId === a01.id)
    check('演员大壮的节点确认已入 attendance.nodes', !!att01 && att01.nodes.length === 1 && att01.nodes[0].pointId === 'p-lab-2',
      JSON.stringify(att01 && att01.nodes))
    const plan4re = stages.buildStage(4, state, { activityId, ownerOpenid: OWNER })
    check('重跑阶段 4 构建为空（位置已上报/节点已到，全部命中 skips）',
      !plan4re.error && plan4re.commands.length === 0, JSON.stringify((plan4re.commands || []).map(c => c.payload.type)))
  }

  // ---- 替身发起人：报备并结案一条异常（真机在工作台 UI 做）----
  section('替身发起人 · 异常报备与结案')
  {
    const a02 = state.signups.find(s => s.activityId === activityId && s.submittedByUserId === 'u-lab-02' && s.personRef.kind === 'user')
    exec(OWNER, {
      type: 'incident.report', activityId, signupIds: [a02.id], kind: 'late',
      description: '演员小二一行比计划晚 20 分钟过垭口，已电话确认安全（预演）',
    }, 'lab-dry-incident')
    const inc = state.incidents.find(i => i.activityId === activityId)
    check('一条未结异常（组织者报备）', !!inc && !inc.resolution && inc.kind === 'late', JSON.stringify(inc && [inc.kind, !!inc.resolution]))
    exec(OWNER, { type: 'incident.resolve', activityId, incidentId: inc.id, note: '已归队，全员清点无误（预演）' }, 'lab-dry-resolve')
    check('异常已结案', !!state.incidents.find(i => i.id === inc.id).resolution, '')
  }

  // ---- 替身发起人：推进 closing（到家在收尾阶段才开放）→ 阶段 5 → 归档 ----
  section('替身发起人 · 推进 收尾 → 阶段 5 到家 → 归档')
  {
    exec(OWNER, { type: 'activity.transition', activityId, next: 'closing', reason: '全员到达终点，行程结束，进入安全核验（预演）' }, 'lab-dry-tr-closing')
    check('阶段已到 closing', state.activities[0].phase === 'closing', state.activities[0].phase)
    const confirmed = state.signups.filter(s => s.activityId === activityId && s.status === 'confirmed')
    runStage(5, { activityId }, confirmed.length)
    check('全部已确认者都有到家记录（同行人行凭 proxyHome 由提交人代确认）',
      confirmed.every(s => {
        const att = state.attendance.find(x => x.signupId === s.id)
        return att && att.home
      }), JSON.stringify(state.attendance.map(a => !!a.home)))
    exec(OWNER, { type: 'activity.transition', activityId, next: 'archived', reason: '' }, 'lab-dry-tr-archived')
    check('阶段已到 archived（closing→archived 门槛：全部到家且无未结异常）',
      state.activities[0].phase === 'archived', state.activities[0].phase)
    const notices = state.notices.filter(n => n.activityId === activityId)
    const events = state.events.filter(e => e.activityId === activityId)
    check('全程产生了事件与通知（报名/审核/异常/到家…）', events.length >= 10 && notices.length >= 8,
      'events=' + events.length + ' notices=' + notices.length)
    const inv = assertInvariants(state)
    check('终态通过全量不变量校验', inv.ok === true, inv.ok ? '' : JSON.stringify(inv.error).slice(0, 160))
    const boardEnd = stages.buildStageBoard(state, activityId)
    check('状态板：归档后六阶段全部「已完成」', boardEnd.every(b => b.status === 'done'),
      JSON.stringify(boardEnd.map(b => b.status)))
  }

  // ---- 幂等与护栏：归档后重跑阶段应被前置检查拦下 ----
  section('幂等与护栏 · 归档后的阶段重跑')
  {
    const plan5 = stages.buildStage(5, state, { activityId, ownerOpenid: OWNER })
    check('归档后重跑阶段 5 被阶段前置拦下', !!plan5.error, plan5.error || '（未拦截）')
  }

  // ---- 剧本护栏：错误阶段的提示 ----
  section('护栏 · 阶段前置检查')
  {
    const p1 = stages.buildStage(1, state, { activityId, ownerOpenid: OWNER })
    check('活动已归档后，阶段 1 给出阶段错误而非命令', !!p1.error && p1.error.indexOf('已发布') !== -1, p1.error)
    const p3 = stages.buildStage(3, state, { activityId, ownerOpenid: OWNER })
    check('阶段 3 在非 gathering 阶段被拦下', !!p3.error && p3.error.indexOf('集结中') !== -1, p3.error)
    const p9 = stages.buildStage(9, state, {})
    check('未知阶段有明确提示', !!p9.error && p9.error.indexOf('未知阶段') === 0, p9.error)
  }

  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=0')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  failed++
  console.error('  ✗ 干跑执行异常（' + ((e && e.stack) || e) + '）')
  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=0')
  process.exit(1)
})
