// 全局版本计数器不得被"读故障"清零：node tools/meta-revision-guard-test.js
//
// store.js 的 ensureMeta 是**每个请求**都会走的一次读（loadState 的第一件事）。
// 改造前的写法把两类完全不同的失败混在同一个 `.catch(() => null)` 里：
//   ① 文档确实不存在（首次部署）—— 需要创建；
//   ② 读本身失败了（超时/云 DB 抖动）—— 文档其实存在，只是这一刻读不出来。
// 然后无条件 `set({ data: { revision: 0 } })`。于是 ② 会变成一次**由读请求发起的、不可逆的写**：
// 全局计数器从 N 回到 0，所有在线客户端缓存的 revision 同时变陈旧 ⇒ 全场 CONFLICT
// （面板还要一路"重读—重试"才恢复），而这条链路本来的目的正是防丢写。
//
// 边界（必须说清楚，不许夸大）：这**不是**静默丢写。persistState 在事务内重读 meta 再比
// before.revision（store.js:133-138），回卷后的两笔并发写仍会被 CAS 拦住，失败的方向是
// "可用性中断 + 需要人工恢复"，不是"数据被覆盖"。本套件的判据也只按这个口径写。
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
stub.__state.openid = 'o-meta-guard-lin'

const fakeDb = stub.__fakeDb()
stub.__state.db = fakeDb

// ot_meta/main 的读故障注入 + 写次数记账（写仍然真落库，判据看的是"有没有发生"）
let injectReadError = null
const metaWrites = []
{
  const origCollection = fakeDb.collection.bind(fakeDb)
  fakeDb.collection = name => {
    const c = origCollection(name)
    if (name !== 'ot_meta') return c
    const origDoc = c.doc.bind(c)
    c.doc = id => {
      const d = origDoc(id)
      if (id !== 'main') return d
      const origGet = d.get
      const origSet = d.set
      d.get = () => {
        if (injectReadError) { const e = injectReadError; injectReadError = null; return Promise.reject(e) }
        return origGet()
      }
      d.set = arg => { metaWrites.push(arg && arg.data && arg.data.revision); return origSet(arg) }
      return d
    }
    return c
  }
}

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const trailApi = require('../cloudfunctions/trailApi/index')

const person = () => ({ name: '版本守卫', phone: '13800000000', emergency: { name: '联系人', phone: '13800000001' }, medical: '', avatar: '' })
const storedRevision = async () => {
  const res = await fakeDb.collection('ot_meta').doc('main').get().catch(() => null)
  return res && res.data ? res.data.revision : null
}

;(async () => {
  section('1. 先造出真实状态：meta 存在且 revision ≥ 1（否则后面的"回卷"无从谈起）')
  const boot = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
  check('首次 read 成功并建立 ot_meta/main', boot.ok === true, JSON.stringify(boot.error || ''))
  const revBefore = await storedRevision()
  check('有效性门：ot_meta/main 里确实有文档（不是空跑）', typeof revBefore === 'number', 'revision=' + revBefore)
  const w1 = await trailApi.main({
    action: 'dispatch',
    payload: { type: 'profile.save', person: person() },
    expectedRevision: boot.data.revision, requestId: 'meta-guard-seed',
  })
  check('一次真实写成功（revision 前进）', w1.ok === true && w1.data.revision === boot.data.revision + 1,
    JSON.stringify(w1.error || w1.data))
  const N = await storedRevision()
  check('落库后的版本号 N≥1 且与信封一致', N === boot.data.revision + 1, 'N=' + N)

  section('2. 读故障（文档其实在）必须失败关闭，绝不清零计数器')
  for (const sig of ['document.get:fail -502004 read timeout', 'network down while reading document']) {
    metaWrites.length = 0
    injectReadError = new Error(sig)
    const r = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
    check('注入读故障「' + sig.slice(0, 24) + '」⇒ 请求失败关闭（不返回可能过期的状态）',
      r.ok === false, JSON.stringify(r.ok === false ? r.error : r.data))
    check('同一次请求错误码为 STORAGE_UNAVAILABLE（客户端会重试而不是当成没数据）',
      r.error && r.error.code === 'STORAGE_UNAVAILABLE', JSON.stringify(r.error || {}))
    check('同一次请求对 ot_meta/main 的写次数为 0（这就是那条不可逆写）',
      metaWrites.length === 0, 'set 次=' + metaWrites.length + ' 写入了 ' + JSON.stringify(metaWrites))
    const after = await storedRevision()
    check('版本号仍是 ' + N + '（没有被回卷成 0）', after === N, '实际=' + after)
  }

  section('3. 故障过去之后，CAS 链路必须照旧（证明"失败关闭"不是把系统打死）')
  const recovered = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
  check('读恢复后 read 成功', recovered.ok === true, JSON.stringify(recovered.error || ''))
  check('读恢复后 revision 仍是 ' + N + '（不是 0）', recovered.ok && recovered.data.revision === N,
    'got=' + (recovered.data && recovered.data.revision))
  const w2 = await trailApi.main({
    action: 'dispatch',
    payload: { type: 'profile.save', person: Object.assign(person(), { name: '版本守卫二' }) },
    expectedRevision: N, requestId: 'meta-guard-after',
  })
  check('用恢复前那个版本号写一次 ⇒ 成功并推进到 ' + (N + 1),
    w2.ok === true && w2.data.revision === N + 1, JSON.stringify(w2.error || w2.data))

  section('4. 反向门：文档真的不存在时仍须自愈建档（不许把修复做成"首次部署也打不开"）')
  // 直接删掉文档，让桩按真 SDK 的语义抛 document not exists（不是注入的故障）
  const doc = fakeDb.collection('ot_meta').doc('main')
  await doc.get().then(() => doc.remove(), () => null)
  metaWrites.length = 0
  const fresh = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
  check('文档不存在时 read 成功（首次部署路径没被改坏）', fresh.ok === true, JSON.stringify(fresh.error || ''))
  check('不存在 ⇒ 确实创建了一次 revision:0', metaWrites.length === 1 && metaWrites[0] === 0,
    'set 次=' + metaWrites.length + ' 值=' + JSON.stringify(metaWrites))
  check('新建后 revision = 0', fresh.ok === true && fresh.data.revision === 0,
    'got=' + (fresh.data && fresh.data.revision))

  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
})().catch(e => {
  console.error('harness error:', e && (e.stack || e.message))
  process.exit(1)
})
