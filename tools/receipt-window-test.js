// 幂等窗口的淘汰依据必须是时间，不能是文档键的字典序：node tools/receipt-window-test.js
//
// 为什么这件事只能在「落库 + 重读」之后才看得见：
//   · 进程内 state.receipts 是 push 序（= 写入时间序），所以 commands.js 的 pruneReceipts
//     「保留末尾 600 条」在单个进程里完全正确——纯 domain 测试永远测不出问题。
//   · 但 store.loadCollection 按 `_id` 升序读回，而 receipt 的文档键是 **actorId + '__' + requestId**
//     （store.js:27）。openid 是随机串，与写入时间毫无关系 ⇒ 重读之后数组顺序不再是时间序，
//     下一次 pruneReceipts 淘汰的就是「openid 字典序最靠前的人」的回执，而不是最旧的回执。
//   · 回执是全系统唯一的幂等记忆。被错删的人重发同一条命令（云函数已落库、响应丢包，或客户端超时
//     重试）不再得到 replayed:true，而是原样再执行一次——对 activity.create 这类累加型命令，
//     那就是**第二场活动**。
//
// 判据口径：一切结论都是 STUB 层（内存桩忠实复现 orderBy('_id') 的排序，见 stub-wx-server-sdk.js:51），
// 不冒充 REAL CLOUD。每条判据都检查落库后的最终数据，不是只看返回值。
'use strict'
const path = require('path')
const Module = require('module')
const crypto = require('crypto')

const STUB = path.join(__dirname, 'stub-wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return STUB
  return origResolve.call(this, request, ...rest)
}
const stub = require(STUB)
stub.__state.db = stub.__fakeDb()

const store = require('../cloudfunctions/trailApi/store')
const { reduceCommand } = require('../cloudfunctions/trailApi/domain/commands')
const { canonicalPayload } = require('../cloudfunctions/trailApi/domain/contracts')

let passed = 0, failed = 0, inconclusive = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function skip(name, why) { inconclusive++; console.log('  · [INCONCLUSIVE] ' + name + '：' + why) }
function section(t) { console.log('\n== ' + t + ' ==') }

const T0 = Date.parse('2026-10-09T00:00:00.000Z')
const iso = i => new Date(T0 + i * 1000).toISOString()
let idSeq = 0
const context = { now: iso(1), id: k => k + '-' + (++idSeq) }

// 两个 openid 的字典序与写入时间刻意相反。真实 openid 就是随机串，所以这不是构造攻击面，
// 而是「任何一个用户都可能落在哪一边」——落在靠前那一边的用户，其幂等记忆会被旧写法优先砍掉。
const LOW_KEY = 'o-0000000000000000000000a'   // 文档键最靠前，写入时间最新，是累加型命令的发起人
const HIGH_KEY = 'o-zzzzzzzzzzzzzzzzzzzzzzzz' // 文档键最靠后，写入时间最早
const LIMIT = 600                             // commands.js 的幂等窗口上限

let tick = 1
const fp = payload => crypto.createHash('sha256').update(canonicalPayload(payload)).digest('hex')

/** 走真实命令路径建夹具（不手拼 State）：requestId 可指定，用来复现键序与时间序相反。 */
function run(state, actor, payload, requestId) {
  const i = tick++
  context.now = iso(i)
  const r = reduceCommand(state, {
    actor: { userId: actor }, requestId: requestId || ('req-' + i), expectedRevision: state.revision,
    fingerprint: fp(payload), payload,
  }, context)
  if (!r.ok) throw new Error('夹具写入被拒（' + payload.type + '）：' + JSON.stringify(r.error))
  return r.value.state
}
const person = name => ({ name, phone: '13800000000', emergency: { name: '紧急人', phone: '13900000001' }, medical: '' })
const draftInput = () => ({
  title: '探针活动 · 只该存在一场', description: '', organizerIntro: '',
  startAt: iso(tick + 5000), endAt: iso(tick + 6000), deadlineAt: iso(tick + 4000),
  acceptingSignups: false, capacity: 10, approvalMode: 'manual', routeId: null,
  // 空快照 ⇒ 不生成私有路线，也就不需要发起人档案，夹具可以更贴近「越界只由窗口造成」
  routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, points: [], risks: [] },
  pickupPoints: [], equipment: [], feeNote: '', cancellationNote: '',
})
function emptyState() {
  return {
    schemaVersion: 1, revision: 0, savedAt: iso(0),
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
}

/** 落库再重读：把数组顺序换成 `_id` 字典序，是整件事的关键一步。 */
async function roundTrip(state) {
  await store.ensureCollections(stub.__state.db)
  const seeded = await store.loadState(stub.__state.db)
  const persisted = await store.persistState(stub.__state.db, seeded, state, seeded.revision, context.now)
  const back = await store.loadState(stub.__state.db)
  if (back.revision !== persisted.revision) throw new Error('夹具落库失败')
  return back
}

const PROBE_RID = 'req-A-probe-activity-create'
// 探针命令只生成一次并全程复用：payload 里的时间随 tick 走，再生成一次就成另一条命令，
// 「重放」也就测不到 replay 那条路了。
const probePayload = { type: 'activity.create', input: draftInput() }

;(async () => {
  section('0. 夹具：先铺满窗口，再用「键序最靠前的人」写一条最新且可累加的命令')
  let st = emptyState()
  for (let k = 0; k < LIMIT; k++) st = run(st, HIGH_KEY, { type: 'profile.save', person: person('高键人' + k) })
  check('铺到上限时还没触发淘汰（receipts 恰好 = 上限）', st.receipts.length === LIMIT, '实际 ' + st.receipts.length)
  // 建活动要求发起人已有档案（canExecute 的「活动发起账号不存在」门），所以 LOW 先写一条档案；
  // requestId 刻意让「探针命令」的文档键排在 LOW 自己的档案之前，重读后它就落在数组头部。
  st = run(st, LOW_KEY, { type: 'profile.save', person: person('低键人') }, 'req-Z-low-profile')
  st = run(st, LOW_KEY, probePayload, PROBE_RID)
  check('越过上限后的进程内截断：条数仍为上限，且这条最新命令此刻还在',
    st.receipts.length === LIMIT && st.receipts.some(r => r.requestId === PROBE_RID),
    'receipts=' + st.receipts.length)
  check('此刻只落了一场活动', st.activities.length === 1, '实际 ' + st.activities.length)

  const reloaded = await roundTrip(st)
  const marks = reloaded.receipts.map(r => r.actorId === LOW_KEY ? 'L' : 'H').join('')
  check('落库重读后数组顺序变成 `_id` 字典序（openid 优先），不再是写入时间序',
    marks[0] === 'L' && /^L+H+$/.test(marks), '顺序片段 ' + marks.slice(0, 6) + '…' + marks.slice(-6))
  check('重读没有丢条数也没有读错内容', reloaded.receipts.length === LIMIT
    && JSON.stringify(reloaded.receipts.map(r => r.requestId).sort()) === JSON.stringify(st.receipts.map(r => r.requestId).sort()))
  check('重读之后，那条最新的探针回执被排到了数组头部（旧写法下一刀就砍它）',
    reloaded.receipts[0].requestId === PROBE_RID, '头部=' + reloaded.receipts[0].requestId)

  section('1. 判据：越过上限后淘汰的那一条必须是最旧的，不是「openid 最靠前的」')
  const oldest = reloaded.receipts.reduce((m, r) => Date.parse(m.appliedAt) <= Date.parse(r.appliedAt) ? m : r)
  const st2 = run(reloaded, HIGH_KEY, { type: 'profile.save', person: person('又一条') })
  check('越过上限触发淘汰：receipts 仍等于上限', st2.receipts.length === LIMIT, '实际 ' + st2.receipts.length)
  const gone = reloaded.receipts.filter(r => !st2.receipts.some(x => x.actorId === r.actorId && x.requestId === r.requestId))
  check('被淘汰的恰好 1 条，且它就是全局最旧的那条（淘汰依据=时间）',
    gone.length === 1 && gone[0].requestId === oldest.requestId,
    JSON.stringify({ evicted: gone.map(g => g.requestId), oldest: oldest.requestId }))
  check('窗口里最新的那条（探针命令）活下来了——这正是幂等该保住的',
    st2.receipts.some(r => r.requestId === PROBE_RID))

  section('2. 后果：记忆被错删以后，重发同一条建活动命令会真的多出第二场活动')
  // 重放必须用「同一份 payload、同一个 requestId、同一个 fingerprint」——draftInput() 里的时间是随
  // tick 走的，重新生成一次就变成另一条命令（那测的是 REQUEST_REUSED，不是重放）。所以复用 §0 那份。
  const replay = state => reduceCommand(state, {
    actor: { userId: LOW_KEY }, requestId: PROBE_RID, expectedRevision: state.revision,
    fingerprint: fp(probePayload),
    payload: probePayload,
  }, context)
  {
    const r = replay(st2)
    check('记忆还在：重发被认成 replayed，不推进 revision、不多出活动',
      r.ok === true && r.value.replayed === true && r.value.state.revision === st2.revision
      && r.value.state.activities.length === 1,
      JSON.stringify({ ok: r.ok, rp: r.ok && r.value.replayed, acts: r.ok ? r.value.state.activities.length : null }))
    // 旧写法的淘汰结果：把探针记忆删掉，等价于「openid 靠前的人被优先砍」那一次截断
    const stripped = JSON.parse(JSON.stringify(st2))
    stripped.receipts = stripped.receipts.filter(x => x.requestId !== PROBE_RID)
    const lost = replay(stripped)
    check('记忆被错删以后：同一条命令被当成新请求执行，落库多出第二场活动',
      lost.ok === true && lost.value.replayed === false && lost.value.state.activities.length === 2,
      JSON.stringify({ ok: lost.ok, rp: lost.ok && lost.value.replayed, acts: lost.ok ? lost.value.state.activities.length : null }))
    check('夹具本身没被污染（原状态仍是一场活动、探针记忆仍在）',
      st2.activities.length === 1 && st2.receipts.some(x => x.requestId === PROBE_RID))
  }

  section('3. 反向对照：同 requestId 换内容必须 REQUEST_REUSED，且零副作用')
  {
    const before = JSON.stringify(st2.activities)
    const mutated = { type: 'activity.create', input: Object.assign(draftInput(), { title: '换了内容的同一请求号' }) }
    const r = reduceCommand(st2, {
      actor: { userId: LOW_KEY }, requestId: PROBE_RID, expectedRevision: st2.revision,
      fingerprint: fp(mutated), payload: mutated,
    }, context)
    check('被拒成 REQUEST_REUSED（幂等窗口没被顺手放宽成「重复一律成功」）',
      r.ok === false && r.error && r.error.code === 'REQUEST_REUSED', JSON.stringify(r.error))
    check('被拒零副作用：活动列表逐字节不变，receipts 也没多',
      JSON.stringify(st2.activities) === before && st2.receipts.length === LIMIT)
  }

  section('4. 同毫秒并列必须有确定性，否则每次写入都会换掉一批记忆')
  {
    const rows = [
      { actorId: 'o-b', requestId: 'req-2', appliedAt: iso(7) },
      { actorId: 'o-a', requestId: 'req-1', appliedAt: iso(7) },
      { actorId: 'o-c', requestId: 'req-3', appliedAt: iso(6) },
    ]
    const keyOf = r => r.actorId + '__' + r.requestId
    const byTime = rows.slice().sort((a, b) => {
      const d = Date.parse(a.appliedAt) - Date.parse(b.appliedAt)
      return d !== 0 ? d : (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)
    })
    check('并列时间按文档键定序：同批数据反复排序得到同一个结果',
      byTime.map(r => r.requestId).join(',') === 'req-3,req-1,req-2', byTime.map(r => r.requestId).join(','))
    check('最旧的 iso(6) 排在最前（截断时最先出局），而不是键序靠前的那条',
      byTime[0].requestId === 'req-3')
  }

  section('5. 未越过上限时不得有任何淘汰（防止把修复做成「总是重排」）')
  {
    const back = await roundTrip(st2)
    check('重读不改变条数与内容', back.receipts.length === st2.receipts.length
      && JSON.stringify(back.receipts.map(r => r.requestId).sort()) === JSON.stringify(st2.receipts.map(r => r.requestId).sort()))
    let small = emptyState()
    for (let k = 0; k < 4; k++) small = run(small, HIGH_KEY, { type: 'profile.save', person: person('少量' + k) })
    const smallBack = await roundTrip(small)
    check('远未越限的小世界：4 条就是 4 条，一条都没被截',
      small.receipts.length === 4 && smallBack.receipts.length === 4,
      JSON.stringify({ inMem: small.receipts.length, reloaded: smallBack.receipts.length }))
    check('小世界里重读也不改变内容（这条门防止把修复做成「总是重排」）',
      JSON.stringify(smallBack.receipts.map(r => r.requestId).sort()) === JSON.stringify(small.receipts.map(r => r.requestId).sort()))
  }

  section('6. 覆盖边界（不冒充已验证）')
  skip('真云端 orderBy(\'_id\') 的排序与分页语义', '桩里的 sort by _id 与生产 requestedOrderBy 是同一条语句，但真实云端的分片排序/分页需线上取证；本套件结论口径是 STUB-MODEL。')
  skip('幂等窗口被真实流量打穿的发生率', '本套件证明「打穿之后砍错人」，不证明多久打穿一次；那要看真实环境的写命令总量，属于运维读数。')

  console.log('\n==== passed=' + passed + ' failed=' + failed + ' inconclusive=' + inconclusive + ' ====')
  if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
  process.exit(failed ? 1 : 0)
})().catch(e => {
  console.error('SUITE CRASHED: ' + (e && e.stack))
  process.exit(1)
})
