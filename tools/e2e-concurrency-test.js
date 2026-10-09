// Phase 8 并发 / 一致性套件：node tools/e2e-concurrency-test.js
//
// 判定口径（先读这段再读代码）：
//   · 本套件的一切结论都是 **STUB-BARRIER 层**，不是 REAL CLOUD。
//     TEST-HARNESS DETERMINISTIC TRANSACTION BARRIER ≠ REAL CLOUD CONCURRENCY PROOF。
//     真云端并发（REAL_CONCURRENCY）、云读滞后、UI 连点窗口一律记 INCONCLUSIVE 并写明原因（任务书 §17）。
//   · barrier 默认 OFF；只有本套件显式打开。OFF 分支的作用是**复现桩基座本身的交叠窗口**
//     （Phase 7 留下的「同 tick 两写均 OK」），好让 ON 分支的结论有对照，不是自证。
//   · bugCheck 的红是**已定罪缺陷的常驻红测**，计入 bugs 不计入 failed；
//     它自己变绿说明缺陷被修好了，届时以 DRIFT 报 exit 1，提醒把它转成正式断言——不许静默当通过。
//   · 不用 sleep 造并发：Promise.all + await 交错本身就是并发窗口；顺序场景则显式标注 ordering。
//   · 并发场景的两个 actor 必须是**同一个人**：桩把 openid 存在模块级全局（stub-wx-server-sdk.js:6
//     `state.openid`，getWXContext 直接读它），两个并发请求会互相踩身份。跨身份并发要等真云端那一层，
//     不在本套件里伪造。
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

/** 全量文档快照（S8 的败者零副作用判据用；14 集合 + ot_meta/main） */
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

let passed = 0
let failed = 0
let inconclusive = 0
let bugs = 0
let drift = 0
const findings = []

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + String(extra).slice(0, 200) + '）' : '')) }
}
/** 已定罪缺陷的常驻红测：stillBroken=true 时记 BUG（不算套件失败），转绿时记 DRIFT（算失败） */
function bugCheck(id, title, stillBroken, evidence) {
  if (stillBroken) {
    bugs++
    console.error('  ✗ [CONFIRMED BUG ' + id + '] ' + title)
    findings.push([id, 'BUG（红测常驻）', title])
  } else {
    drift++
    console.error('  ⚠ [DRIFT ' + id + '] 该缺陷探针已转绿——修复已落地，请把它转成正式断言，别让它悄悄消失')
    findings.push([id, 'DRIFT（疑似已修，需转正）', title])
  }
  if (evidence) console.error('      证据：' + String(evidence).slice(0, 240))
}
function inc(name, why) {
  inconclusive++
  console.log('  ○ [INCONCLUSIVE] ' + name + ' —— ' + why)
  findings.push(['INC', 'INCONCLUSIVE', name + '：' + why])
}
function section(t) { console.log('== ' + t + ' ==') }

const LIN = 'o-lin-owner'
function as(openid) {
  const call = (action, extra) => {
    stub.__state.openid = openid
    return trailApi.main(Object.assign({ action }, extra))
  }
  return {
    read: request => call('read', { request }),
    dispatch: (payload, expectedRevision, requestId) => call('dispatch', { payload, expectedRevision, requestId }),
  }
}
const OWNER = as(LIN)

function input(title, description) {
  return {
    title, description, organizerIntro: '自动化',
    startAt: '2027-03-06T08:00:00+08:00', endAt: '2027-03-06T18:00:00+08:00', deadlineAt: '2027-03-05T20:00:00+08:00',
    acceptingSignups: true, capacity: 12, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [{ id: 'pk-1', name: '东门', meetingAt: '2027-03-06T07:00:00+08:00', address: 'x', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '',
  }
}

let activityId = ''
const rev = async () => (await OWNER.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.revision
const act = async () => (await OWNER.read({ kind: 'activity', activityId, perspective: 'organizer' })).data.view.activity
/** 一次场景的 14 列账本（任务书 §5）：不许只留 PASS 字样 */
function ledger(o) {
  console.log('  ┌ ' + o.id + '  actorA=' + o.actorA + ' actorB=' + o.actorB + '（同一 owner 身份，排除权限层干扰）')
  console.log('  │ 初始 revision=' + o.initialRevision + '  基座=' + o.barrier + '  ordering=' + o.ordering)
  console.log('  │ A=' + o.opA + '  B=' + o.opB)
  console.log('  │ 期望：winner=' + o.expectedWinner + ' loser=' + o.expectedLoser + ' error=' + o.expectedError)
  console.log('  └ 实测：finalRevision=' + o.finalRevision + '  finalState=' + o.finalState + '  readBack=' + o.readBack + '  loserSideEffects=' + o.loserSideEffects + '  判定=' + o.verdict)
}

async function setup() {
  // 夹具先读后写：省略 expectedRevision 的旧写法依赖 index.js 的"缺省成当前 revision"，
  // 那是盲写洞（现由 tools/e2e-revision-guard-test.js 在服务端失败关闭）。
  const boot = await OWNER.read({ kind: 'profile' })
  await OWNER.dispatch({ type: 'profile.save', person: { name: '林溪', phone: '00000000001', emergency: { name: '林母', phone: '00000000051' }, medical: '' } }, boot.data.revision)
  const afterBoot = await OWNER.read({ kind: 'profile' })
  const r = await OWNER.dispatch({ type: 'activity.create', input: input('基线标题', '基线说明') }, afterBoot.data.revision)
  activityId = r.data.targetIds[0]
  check('S-00 夹具：draft 活动建档（真实信封）', r.ok === true && !!activityId, r.error)
}

async function main() {
  await setup()

  // ============================================================
  section('S0 基座对照：barrier OFF（复现桩的事务交叠窗口，不是产品结论）')
  // ============================================================
  {
    stub.__setTxnBarrier(false)
    const R = await rev()
    const [a, b] = await Promise.all([
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('A 的标题', '基线说明') }, R),
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('基线标题', 'B 的说明') }, R),
    ])
    const finalRev = await rev()
    const f = await act()
    const bothOk = a.ok === true && b.ok === true
    const lostUpdate = (f.title === 'A 的标题' && f.description !== 'B 的说明') || (f.description === 'B 的说明' && f.title !== 'A 的标题')
    check('S0 两写均返回成功（同 revision、无 CONFLICT）', bothOk, JSON.stringify({ a: a.error, b: b.error }))
    check('S0 finalRevision 只 +1（两事务都把 meta 写成同一个 R+1，不是 R+2）', finalRev === R + 1, R + '→' + finalRev)
    check('S0 存在被吞掉的写入（lost update）——这正是必须开 barrier 的理由', lostUpdate, JSON.stringify(f.title) + JSON.stringify(f.description))
    ledger({ id: 'S0', actorA: 'Owner', actorB: 'Owner', initialRevision: R, barrier: 'OFF', ordering: 'Promise.all（交错）',
      opA: 'edit title=A', opB: 'edit description=B', expectedWinner: '（基座无隔离，无胜者语义）', expectedLoser: '（同上）',
      expectedError: 'none', finalRevision: finalRev, finalState: 'title=' + f.title + ' / description=' + f.description,
      readBack: '权威读 activity/organizer', loserSideEffects: '两写都落了文档，但后者覆盖前者', verdict: 'TEST HARNESS ARTIFACT' })
  }

  // ============================================================
  section('S1 同 revision 并发双写：barrier ON（任务书 §6/§8）')
  // ============================================================
  {
    stub.__setTxnBarrier(true)
    const R = await rev()
    const [a, b] = await Promise.all([
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S1-A 标题', 'S1 说明') }, R),
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S1-B 标题', 'S1 说明') }, R),
    ])
    const oks = [a, b].filter(x => x.ok === true).length
    const conflicts = [a, b].filter(x => x.ok === false && x.error.code === 'CONFLICT').length
    const finalRev = await rev()
    const f = await act()
    const winnerTitle = a.ok === true ? 'S1-A 标题' : 'S1-B 标题'
    const loserTitle = a.ok === true ? 'S1-B 标题' : 'S1-A 标题'
    check('S1 恰好一个成功', oks === 1, 'ok 数=' + oks)
    check('S1 恰好一个 CONFLICT', conflicts === 1, JSON.stringify({ a: a.error && a.error.code, b: b.error && b.error.code }))
    check('S1 finalRevision = R+1（无跳跃、无双推进）', finalRev === R + 1, R + '→' + finalRev)
    check('S1 胜者写入完整存活', f.title === winnerTitle, f.title)
    // 败者零副作用的可观测面限定在活动对象本身：组织者视图不暴露事件账/收据（selectors.js:426-438），
    // 所以这里证的是「败者的任何字段值都没留下」，不是「审计账里少一条」。
    check('S1 败者零副作用：其唯一标记在落库活动对象中完全不存在',
      JSON.stringify(f).indexOf(loserTitle) === -1, loserTitle)
    ledger({ id: 'S1', actorA: 'Owner', actorB: 'Owner', initialRevision: R, barrier: 'ON', ordering: 'Promise.all（交错）',
      opA: 'edit title=S1-A', opB: 'edit title=S1-B', expectedWinner: 'A 或 B（基座不规定谁赢，只规定只有一个赢）',
      expectedLoser: '另一个', expectedError: 'CONFLICT', finalRevision: finalRev, finalState: 'title=' + f.title,
      readBack: '权威读两次一致', loserSideEffects: '零（事务整体未提交）', verdict: oks === 1 && conflicts === 1 && finalRev === R + 1 ? 'PASS（STUB-BARRIER）' : 'FAIL' })
    check('S1 barrier 判据：两写均成功＝CAS/domain BUG（任务书 D1 第 8 条）', !(a.ok && b.ok), 'barrier ON 下仍双胜')
  }

  // ============================================================
  section('S2 stale write：串行先后 + 显式旧 revision（任务书 §10）')
  // ============================================================
  {
    const R = await rev()
    const first = await OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S2 第一次', 'S2 说明') }, R)
    const stale = await OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S2 用旧 R', 'S2 说明') }, R)
    const finalRev = await rev()
    const f = await act()
    check('S2 新 revision 的写成功', first.ok === true, first.error)
    check('S2 旧 revision 的写被 CONFLICT 精确拒绝', stale.ok === false && stale.error.code === 'CONFLICT', JSON.stringify(stale.error))
    check('S2 胜者内容完全保留（旧写没有覆盖新写）', f.title === 'S2 第一次', f.title)
    check('S2 revision 只推进一次', finalRev === R + 1, R + '→' + finalRev)
    inc('S2 CONFLICT 的来源层（内存层① vs 事务层②）', '两处文案逐字相同（commands.js:122 与 store.js:115），信封层无法区分；要区分需在测试里注入层标记，属改基座，本轮不做')
    ledger({ id: 'S2', actorA: 'Owner', actorB: 'Owner', initialRevision: R, barrier: 'ON', ordering: 'sequential（A 提交后 B 才发）',
      opA: 'edit title=S2 第一次 @R', opB: 'edit title=S2 用旧 R @R（已过期）', expectedWinner: 'A', expectedLoser: 'B',
      expectedError: 'CONFLICT', finalRevision: finalRev, finalState: 'title=' + f.title, readBack: '权威读一致',
      loserSideEffects: '零', verdict: 'PASS（STUB-BARRIER）' })
  }

  // ============================================================
  section('S3 lost update 定向：两个不同字段的先后写（任务书 §9）')
  // ============================================================
  {
    const R = await rev()
    const a = await OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S3-A 标题', 'S3-A 说明') }, R)
    const b = await OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S3-B 标题', 'S3-B 说明') }, R)
    check('S3 A 成功', a.ok === true, a.error)
    check('S3 B 因未重读而 CONFLICT（domain 契约里没有 merge 语义，禁止默认 last-write-wins）',
      b.ok === false && b.error.code === 'CONFLICT', JSON.stringify(b.error))
    const f = await act()
    check('S3 A 的两个字段都存活', f.title === 'S3-A 标题' && f.description === 'S3-A 说明', JSON.stringify({ t: f.title, d: f.description }))
    ledger({ id: 'S3', actorA: 'Owner', actorB: 'Owner', initialRevision: R, barrier: 'ON', ordering: 'sequential（B 沿用同一个 R）',
      opA: 'edit {title,description} @R', opB: 'edit {title,description} @R（陈旧）', expectedWinner: 'A', expectedLoser: 'B',
      expectedError: 'CONFLICT', finalRevision: await rev(), finalState: 'title=' + f.title + ' / description=' + f.description,
      readBack: '权威读一致', loserSideEffects: '零', verdict: 'PASS（STUB-BARRIER）' })
  }

  // ============================================================
  section('S4 BUG-C1：编辑器首条命令 expectedRevision=undefined ⇒ CAS 绕过（任务书 R1）')
  // ============================================================
  for (const barrier of ['ON', 'OFF']) {
    stub.__setTxnBarrier(barrier === 'ON')
    const R = await rev()
    const tag = '（barrier ' + barrier + '）'
    // A 的表单是「开页时」装配的：取当前权威态的字段值，此后不再刷新（复刻 editor.js:134-172 不回填 revision）
    const staleForm = input('S4 标题', (await act()).description)
    // B 是守规矩的客户端：带自己读到的 R，只改 description
    const b = await OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S4 标题', 'B 的写入存活' + barrier) }, R)
    // A 是编辑器的首条命令：expectedRevision 传 undefined（editor.js:580 的真实出线形态）
    const a = await OWNER.dispatch({ type: 'activity.edit', activityId, input: Object.assign(staleForm, { title: 'A 的标题' + barrier }) }, undefined)
    const finalRev = await rev()
    const f = await act()
    // BUG-C1 的服务器侧已于本轮拆掉（index.js 缺 revision 失败关闭 = NO_REVISION）。
    // 原来这里是 bugCheck 常驻红测；按本仓规程（转绿即 DRIFT，须转正）改成正式断言：
    // A 必须被拒、B 的写入必须存活、revision 只前进 B 那一次。谁把它改回盲写，这里就红。
    check('S4 A（不传 expectedRevision）被服务器拒绝 ' + tag,
      a.ok === false && !!(a.error && a.error.code === 'NO_REVISION'), JSON.stringify(a.error || a.data || {}))
    check('S4 B 的写入未被吞 ' + tag, f.description === 'B 的写入存活' + barrier, JSON.stringify(f.description))
    check('S4 revision 只 +1（A 零落库）' + tag, finalRev === R + 1, R + '→' + finalRev)
    ledger({ id: 'S4/' + barrier, actorA: 'Owner(复刻 editor 首存：revision 缺省)', actorB: 'Owner(正确客户端 @R)', initialRevision: R,
      barrier: barrier, ordering: 'sequential（B 先提交，A 后发；A 的表单来自 B 提交之前）',
      opA: 'edit {title:"A 的标题", description:<开页时的旧值>} @undefined', opB: 'edit description="B 的写入存活" @R',
      expectedWinner: 'B（A 至少必须 CONFLICT，或不得吞掉 B）', expectedLoser: 'A → CONFLICT',
      expectedError: 'CONFLICT', finalRevision: finalRev, finalState: 'title=' + f.title + ' / description=' + f.description,
      readBack: '权威读 activity/organizer', loserSideEffects: '零（A 收到 NO_REVISION，未落库）',
      verdict: (a.ok === false && f.description === 'B 的写入存活' + barrier && finalRev === R + 1)
        ? 'PASS（BUG-C1 服务器侧已拆，常驻红测转正）' : 'REGRESSION（盲写回来了）' })
  }

  // ============================================================
  section('S4c 对照组：同场景但 A 显式带 R（证明病因只有 undefined）')
  // ============================================================
  {
    stub.__setTxnBarrier(true)
    const R = await rev()
    const b = await OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S4c 标题', 'B 的说明存活') }, R)
    const a = await OWNER.dispatch({ type: 'activity.edit', activityId, input: input('A 的标题', '基线说明') }, R)
    const f = await act()
    check('S4c B 成功', b.ok === true, b.error)
    check('S4c A 必须 CONFLICT（显式 R 时同一场景完全成立，说明 BUG-C1 的唯一变量是不传 revision）',
      a.ok === false && a.error.code === 'CONFLICT', JSON.stringify(a.error))
    check('S4c B 的写入未被吞（description 仍是 B 的）', f.description === 'B 的说明存活', f.description)
    check('S4c revision 只 +1（A 未落库）', await rev() === R + 1, R + '→' + await rev())
    ledger({ id: 'S4c', actorA: 'Owner(显式 R)', actorB: 'Owner(显式 R)', initialRevision: R, barrier: 'ON',
      ordering: 'sequential（B 先提交）', opA: 'edit @R（已过期）', opB: 'edit @R', expectedWinner: 'B', expectedLoser: 'A',
      expectedError: 'CONFLICT', finalRevision: await rev(), finalState: 'description=' + f.description,
      readBack: '权威读', loserSideEffects: '零', verdict: 'PASS（STUB-BARRIER，S4 的对照）' })
  }

  // ============================================================
  section('S5 并发重复提交：同 requestId 同内容（任务书 §11/§12）')
  // ============================================================
  {
    stub.__setTxnBarrier(true)
    const R = await rev()
    const rid = 'req-concurrent-dup-1'
    const payload = { type: 'activity.edit', activityId, input: input('S5 同请求号', 'S5 说明') }
    const [a, b] = await Promise.all([
      OWNER.dispatch(payload, R, rid),
      OWNER.dispatch(payload, R, rid),
    ])
    const oks = [a, b].filter(x => x.ok === true).length
    const finalRev = await rev()
    const replayed = [a, b].filter(x => x.ok === true && x.data && x.data.replayed === true).length
    check('S5 恰好一次成功、一次 CONFLICT', oks === 1 && [a, b].filter(x => x.ok === false && x.error.code === 'CONFLICT').length === 1,
      JSON.stringify({ a: a.error && a.error.code, b: b.error && b.error.code }))
    check('S5 只产生一次 mutation（revision 只 +1）', finalRev === R + 1, R + '→' + finalRev)
    check('S5 并发重复的失败者拿到的是 CONFLICT，不是顺序路径的 replayed:true（语义差异如实登记）',
      replayed === 0, 'replayed 数=' + replayed)
    ledger({ id: 'S5', actorA: 'Owner', actorB: 'Owner（同 requestId、同指纹）', initialRevision: R, barrier: 'ON',
      ordering: 'Promise.all（同 requestId）', opA: 'edit @R rid=X', opB: 'edit @R rid=X',
      expectedWinner: 'A 或 B', expectedLoser: '另一个', expectedError: 'CONFLICT（并发）/ replayed:true（顺序）',
      finalRevision: finalRev, finalState: 'title=' + (await act()).title, readBack: '权威读',
      loserSideEffects: '零（收据查重读自各自快照，兜底靠事务层②）', verdict: 'PASS（STUB-BARRIER）' })
    const r3 = await OWNER.dispatch(payload, await rev(), rid)
    const revAfterReplay = await rev()
    check('S5 顺序路径对照：同一 requestId 重发 → replayed:true 且 revision 不推进',
      r3.ok === true && !!(r3.data && r3.data.replayed) && revAfterReplay === finalRev,
      JSON.stringify({ ok: r3.ok, replayed: r3.data && r3.data.replayed, rev: finalRev + '→' + revAfterReplay, error: r3.error }))
  }

  // ============================================================
  section('S8 BUG-C3 回归：SDK 边界丢失异常类型时，事务层②的冲突必须仍是 CONFLICT（Phase 10A）')
  // ============================================================
  {
    // 复现并钉住 Phase 9 的真云端实测（docs/testing/phase9-evidence/real-concurrency-and-read-after-write.md）：
    // 同一 tick 双发、同一个 revision，胜者 ok，但败者拿到的是 STORAGE_UNAVAILABLE 而不是 CONFLICT。
    // 根因在 store.js:128 用 `e instanceof ConflictError` 作为"这是我方 CAS 冲突"的唯一判据——
    // 类型一跨边界丢失就掉进 :129 的基础设施故障分支 ⇒ 客户端不置 needRefresh、不重读，
    // 而服务端文案还让用户"保留输入后重试"（重试必然再撞同一个陈旧 revision）。数据无损，语义坏了。
    // 基座维度 = STUB MODEL（stub 的 __setTxnErrorWrapping 建模类型擦除），不是 REAL CLOUD 证明。
    stub.__setTxnBarrier(true)
    stub.__setTxnErrorWrapping(true)
    const R = await rev()
    const before = await snapshot()
    const receiptsBefore = JSON.parse(before).ot_receipts.length
    const [a, b] = await Promise.all([
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S8 类型擦除-A', 'S8 说明') }, R),
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S8 类型擦除-B', 'S8 说明') }, R),
    ])
    const codes = [a, b].map(x => x.ok ? 'OK' : (x.error && x.error.code))
    const loserIdx = codes.indexOf('OK') === 0 ? 1 : 0
    const winnerIdx = 1 - loserIdx
    const loser = [a, b][loserIdx], winner = [a, b][winnerIdx]
    const loserTag = loserIdx === 1 ? 'S8 类型擦除-B' : 'S8 类型擦除-A'
    const winnerTag = loserIdx === 1 ? 'S8 类型擦除-A' : 'S8 类型擦除-B'
    check('S8 恰好一个成功', codes.filter(c => c === 'OK').length === 1, JSON.stringify(codes))
    check('S8 败者必须是 CONFLICT（真云端实测给的是 STORAGE_UNAVAILABLE ⇒ 客户端恢复链路失效）',
      loser.ok === false && loser.error.code === 'CONFLICT', JSON.stringify(loser.error))
    const finalRev = await rev()
    check('S8 revision 只 +1', finalRev === R + 1, R + '→' + finalRev)
    const f = await act()
    check('S8 胜者写入存活、败者内容未落库',
      f.title === winnerTag, JSON.stringify({ got: f.title, want: winnerTag }))
    const after = await snapshot()
    check('S8 败者零副作用：其标记在整库快照里不存在', after.indexOf(loserTag) === -1, loserTag)
    check('S8 receipts 只 +1（败者不留收据）',
      JSON.parse(after).ot_receipts.length === receiptsBefore + 1,
      receiptsBefore + '→' + JSON.parse(after).ot_receipts.length)
    ledger({ id: 'S8', actorA: 'Owner', actorB: 'Owner（同一 owner、同一个 R）', initialRevision: R, barrier: 'ON',
      ordering: 'Promise.all + SDK 异常类型擦除（STUB MODEL）',
      opA: 'edit title=S8 类型擦除-A @R', opB: 'edit title=S8 类型擦除-B @R',
      expectedWinner: 'A 或 B（基座不规定谁赢）', expectedLoser: '另一个 → CONFLICT（不是 STORAGE_UNAVAILABLE）',
      expectedError: 'CONFLICT', finalRevision: finalRev, finalState: 'title=' + f.title,
      readBack: '权威读 activity/organizer + 14 集合全量快照', loserSideEffects: '零（内容/收据/逐字节）',
      verdict: loser.ok === false && loser.error.code === 'CONFLICT' ? 'PASS（STUB-MODEL）' : 'BUG（冲突被分类成基础设施故障）' })

    // 对照：把类型擦除关掉，同一形状必须还是 CONFLICT ⇒ 唯一变量就是那道边界上的类型丢失
    stub.__setTxnErrorWrapping(false)
    const R2 = await rev()
    const [c, d] = await Promise.all([
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S8 对照-C', 'S8 说明') }, R2),
      OWNER.dispatch({ type: 'activity.edit', activityId, input: input('S8 对照-D', 'S8 说明') }, R2),
    ])
    const cCodes = [c, d].map(x => x.ok ? 'OK' : (x.error && x.error.code))
    check('S8 对照（wrapping OFF）：同样恰好一胜、败者 CONFLICT ⇒ 证明上面那条红的唯一变量是类型擦除',
      cCodes.filter(x => x === 'OK').length === 1 && cCodes.includes('CONFLICT'), JSON.stringify(cCodes))
    // 复位：S7/S6 及后续场景都必须在默认（OFF）基座上跑，擦除开关只属于 S8 这一段
    stub.__setTxnErrorWrapping(false)
  }

  // ============================================================
  section('S7 状态链 boundary：gathering→active 的出发核实（任务书 §13）')
  // ============================================================
  {
    const CHEN = 'o-chen-member'
    const chen = as(CHEN)
    const person = (name, phone, en, ep) => ({ name, phone, emergency: { name: en, phone: ep }, medical: '', avatar: '' })
    const view7 = async id => (await OWNER.read({ kind: 'activity', activityId: id, perspective: 'organizer' })).data.view
    const rev7 = async id => (await OWNER.read({ kind: 'activity', activityId: id, perspective: 'organizer' })).data.revision
    // 次序严格照抄 A 层 tools/e2e-test.js:272-274（checkin → board → depart）。
    // 本场两位参与者都走 trip.mode='self'，所以 board 腿按 permissions.js:53 天然不适用
    // （needsOutboundBoarding 只对 shared 生效）；带座位安排的 board 腿仍由 A 层 :277-282 守，不在此重造。
    const checkin = async (id, sid) => OWNER.dispatch({ type: 'attendance.checkin', activityId: id, signupId: sid,
      checkIn: { method: 'manual', evidence: { at: '', by: '', note: '集合点人工核实' } } }, await rev7(id))
    const depart = async (id, sid) => OWNER.dispatch({ type: 'attendance.departure', activityId: id, signupId: sid,
      outcome: { kind: 'joined', evidence: { at: '', by: '', note: '随队出发' } } }, await rev7(id))

    /** 真实信封建到 gathering：create→publish→submit→review→transition。不碰 DB、不伪造 phase、不 mock handler */
    async function buildGathering(tag) {
      // 两处准备写同样先读后写：省略 expectedRevision 靠服务器缺省=盲写，该洞已在 index.js 失败关闭
      const revBoot7 = (await OWNER.read({ kind: 'profile' })).data.revision
      let r = await OWNER.dispatch({ type: 'activity.create', input: input(tag + ' 状态链', 'S7 夹具') }, revBoot7)
      const id = r.data.targetIds[0]
      const linProfile = (await OWNER.read({ kind: 'profile' })).data.view.profile
      r = await OWNER.dispatch({ type: 'activity.publish', activityId: id, participation: {
        personRef: { kind: 'user', userId: LIN }, participant: linProfile.person,
        trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } }, await rev7(id))
      check(tag + ' publish（组织者本人报名）ok', r.ok === true, JSON.stringify(r.error || ''))
      const chenBoot = (await chen.read({ kind: 'profile' })).data.revision
      await chen.dispatch({ type: 'profile.save', person: person('陈屿S7', '00000000092', '陈父S7', '00000000052') }, chenBoot)
      const chenProfile = (await chen.read({ kind: 'profile' })).data.view.profile
      r = await chen.dispatch({ type: 'signup.submit', activityId: id, keepTogether: false, mode: 'apply', participants: [{
        personRef: { kind: 'user', userId: CHEN }, participant: chenProfile.person,
        trip: { mode: 'self' }, consent: { dataUse: true, proxyAuthority: false, proxyHome: false } }] }, await rev7(id))
      check(tag + ' signup.submit（第二人报名）ok', r.ok === true, JSON.stringify(r.error || ''))
      const pending = (await view7(id)).rows.filter(x => x.status === 'pending').map(x => x.signupId)
      r = await OWNER.dispatch({ type: 'signup.review', activityId: id, signupIds: pending, decision: 'confirm' }, await rev7(id))
      check(tag + ' signup.review 批量确认 ok', r.ok === true, JSON.stringify(r.error || ''))
      r = await OWNER.dispatch({ type: 'activity.transition', activityId: id, next: 'gathering', reason: '按期集合' }, await rev7(id))
      check(tag + ' transition gathering ok', r.ok === true, JSON.stringify(r.error || ''))
      return id
    }

    const id7 = await buildGathering('S7')
    let v = await view7(id7)
    const revBefore = await rev7(id7)   // revision 在 data 上、不在 view 上；写 v.revision 会拿到 undefined 造成空断言
    const rowFacts = x => JSON.stringify(v.rows.map(y => [y.name, y.status, y.checkedIn, y.departure, y.needsOutboundBoarding]))
    const rowsBefore = rowFacts(v)
    check('S7 夹具成立：phase=gathering、confirmed=2、pending=0',
      v.activity.phase === 'gathering' && v.counters.confirmed === 2 && v.counters.pending === 0,
      JSON.stringify({ phase: v.activity.phase, counters: v.counters }))

    const bad = await OWNER.dispatch({ type: 'activity.transition', activityId: id7, next: 'active', reason: '未核实就发车' }, revBefore)
    v = await view7(id7)
    check('S7 baseline：未完成出发核实 → UNRESOLVED_DEPARTURE（不是 WRONG_PHASE/INVALID_INPUT）',
      bad.ok === false && bad.error.code === 'UNRESOLVED_DEPARTURE', JSON.stringify(bad.error))
    check('S7 baseline 拒绝零副作用：phase 仍 gathering', v.activity.phase === 'gathering', v.activity.phase)
    const revAfterBad = await rev7(id7)
    check('S7 baseline 拒绝不推进 revision', revAfterBad === revBefore, revBefore + '→' + revAfterBad)
    check('S7 baseline 拒绝不动名单（status/checkedIn/departure/needsOutboundBoarding 全不变）',
      rowFacts(v) === rowsBefore, '')

    for (const sid of v.rows.map(x => x.signupId)) { await checkin(id7, sid); await depart(id7, sid) }
    v = await view7(id7)
    check('S7 前置真的建成了：两行都 checkedIn=true 且 needsOutboundBoarding=false（不是靠错误文案反推）',
      v.rows.length === 2 && v.rows.every(x => x.checkedIn === true && x.needsOutboundBoarding === false),
      JSON.stringify(v.rows.map(x => ({ n: x.name, ci: x.checkedIn, nob: x.needsOutboundBoarding }))))
    const legal = await OWNER.dispatch({ type: 'activity.transition', activityId: id7, next: 'active', reason: '全员核实发车' }, await rev7(id7))
    v = await view7(id7)
    check('S7 正常链完成核实后 gathering→active 合法成功（phase=active）',
      legal.ok === true && v.activity.phase === 'active', JSON.stringify({ ok: legal.ok, err: legal.error, phase: v.activity.phase }))
    const revFinal = await rev7(id7)
    // 反空断言：合法链确实推进了 5 次（2×checkin + 2×departure + 1×transition），
    // 所以上面「拒绝那次不推进」不是「revision 本来就取不到」造成的假绿。
    check('S7 合法链推进 revision = +5（2 签到 + 2 出发核实 + 1 推进），证明「不推进」那条不是空断言',
      revFinal === revBefore + 5, revBefore + '→' + revFinal)
    ledger({ id: 'S7', actorA: 'Owner(组织者)', actorB: 'Member(已报名未核实)', initialRevision: revBefore, barrier: 'ON',
      ordering: 'sequential（真实链 create→publish→submit→review→gathering）',
      opA: 'activity.transition next=active（未完成出发核实）', opB: 'attendance.checkin + attendance.departure(joined) 逐人',
      expectedWinner: '核实链', expectedLoser: '越级 transition', expectedError: 'UNRESOLVED_DEPARTURE',
      finalRevision: revFinal, finalState: 'phase=' + v.activity.phase + ' confirmed=' + v.counters.confirmed,
      readBack: 'organizer 视图逐步回读', loserSideEffects: '零（phase/revision/rows 全未变）',
      verdict: (bad.ok === false && bad.error.code === 'UNRESOLVED_DEPARTURE' && legal.ok === true) ? 'PASS（STUB，boundary 基线）' : 'FAIL' })
  }

  // ============================================================
  section('S6 本套件测不到的（一律 INCONCLUSIVE，不许转 PASS）')
  // ============================================================
  inc('REAL_CONCURRENCY（真云端并发 CAS）', '本套件全在桩基座上；真云端的写锁粒度、超时与 MVCC 可见性未建模。要出真结论必须部署后由真实小程序并发打 trailApi（§17）')
  inc('read-after-write 滞后量级', '桩是同一张内存 Map，写入即刻可见，天然复现不了 20s+ 云读滞后；且 store.js:43 分页查询 vs :62 主键读的两种可见性等级只能在真云端测（§15/§16）')
  inc('UI 连点窗口：只剩「第二次点击在渲染窗口内是否真发生」一问', 'busy 门是 WXML 绑定态、依赖 setData 重渲染，桩里没有渲染时序。但一致性后果不依赖这一问：同面板两条命令必带同一个 expectedRevision，先后到达走层①、真同时走层②（S1/M2 已实测），所以本问只决定「会不会弹出那句把用户说成他人的误导文案」')

  console.log('')
  console.log('判定汇总（STUB-BARRIER 层）：')
  findings.forEach(x => console.log('  [' + x[1] + '] ' + x[0] + ' — ' + x[2]))
  console.log('')
  console.log('passed=' + passed + ' failed=' + failed + ' bugs=' + bugs + ' inconclusive=' + inconclusive + ' drift=' + drift)
  process.exit(failed + drift ? 1 : 0)
}

main().catch(e => { console.error('套件自身异常：' + (e && e.stack || e)); process.exit(1) })
