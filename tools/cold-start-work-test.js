// 冷启动浪费：node tools/cold-start-work-test.js
//
// `exports.main` 第一件事是 `store.ensureCollections(db)`（index.js:264），
// 而它无条件对 **14 个业务集合 + ot_meta + weather_cache = 16 个集合**各发一次 createCollection。
// 集合在第一次部署后就一直存在，这 16 次往返在每次调用上都发生：
// 云函数按调用计费且冷启动/容器复用都吃同一段串行时间，而 SYNC.md 里天气线当年那起
// 「3 秒超时」事故的成分之一就是这种每请求重复全量动作。
//
// 本套件断言的是**上限**而不是绝对值：容器内首次调用付一次建集合成本可以接受，
// 第二次及以后的调用必须不再付（模块级记忆化）。第 5 节再加一条同族约束：
// 每请求的 14 个状态集合读必须**并发发出**（串行 await = 14×RTT 的墙钟），集合数本身不动。
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

let createCalls = 0
const fakeDb = stub.__fakeDb()
const origCreate = fakeDb.createCollection.bind(fakeDb)
fakeDb.createCollection = async (name) => { createCalls++; return origCreate(name) }
stub.__state.db = fakeDb
stub.__state.openid = 'o-coldstart-lin'

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const trailApi = require('../cloudfunctions/trailApi/index')

;(async () => {
  section('1. 首次调用：允许付一次建集合成本（16 个集合），但必须真的把请求做完')
  createCalls = 0
  const first = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
  check('首个 read 成功', first.ok === true, JSON.stringify(first.error || ''))
  const firstCreates = createCalls
  check('首次调用建集合次数在 1..16 之间（0 说明桩没接到路径，>16 说明有重复建）',
    firstCreates > 0 && firstCreates <= 16, 'createCollections=' + firstCreates)

  section('2. 同容器第二次调用：不得再付建集合成本（这是本套件唯一的新约束）')
  createCalls = 0
  const second = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
  check('第二个 read 成功', second.ok === true, JSON.stringify(second.error || ''))
  check('第二次调用 createCollection 次数为 0', createCalls === 0,
    '仍然发了 ' + createCalls + ' 次 ⇒ 每次云函数调用都白付 16 次往返')

  section('3. 读数（不断言）：容器复用后的建集合成本应为 0')
  console.log('  i 首次调用 createCollection ' + firstCreates + ' 次；第二次调用 ' + createCalls
    + ' 次。集合数（14）是 store.js 写明取舍的既有设计，本套件不动它；动的是这些读**是否并发发出**。')

  section('4. 写路径同样不得重复建集合')
  createCalls = 0
  const w = await trailApi.main({
    action: 'dispatch',
    payload: { type: 'profile.save', person: { name: '冷启', phone: '13800000000', emergency: { name: '联', phone: '13800000001' }, medical: '', avatar: '' } },
    expectedRevision: second.data.revision,
    requestId: 'coldstart-write-1',
  })
  check('写命令成功（说明复用容器没把 revision 路径打断）', w.ok === true, JSON.stringify(w.error || ''))
  check('写路径 createCollection 次数为 0', createCalls === 0, '仍然发了 ' + createCalls + ' 次')

  /* ---------- 5. loadState 的 14 次分页读必须并发发出 ---------- */
  // 建模的是**唯一**一件事：真云端每次 `get()` 是一个网络往返。桩里给每个分页读注入 RTT 毫秒，
  // 于是「串行 await」与「并发 Promise.all」在墙钟上差一个数量级，而这一点在内存桩里可判定：
  // 串行代码的峰值 in-flight 恒等于 1（永远在等上一笔落地才发下一笔）。
  // 结论边界：这里证明的是**往返次数从 14 跳降到 1 跳**，不是真云端延迟——RTT 是我们注入的，
  // 真机延迟必须等部署后从云函数日志取（本套件不冒充）。
  section('5. 每次请求的状态装载：14 个集合读是否并发（RTT 建模）')
  const RTT = 8
  const readProbe = { reads: 0, active: 0, peak: 0, ms: 0 }
  {
    const origCollection = fakeDb.collection.bind(fakeDb)
    fakeDb.collection = (name) => {
      const c = origCollection(name)
      const origOrderBy = c.orderBy.bind(c)
      c.orderBy = () => {
        const l = origOrderBy()
        const origLimit = l.limit.bind(l)
        l.limit = () => {
          const s = origLimit()
          const origSkip = s.skip.bind(s)
          s.skip = n => {
            const page = origSkip(n)
            const origGet = page.get.bind(page)
            page.get = () => {
              readProbe.reads++
              readProbe.active++
              if (readProbe.active > readProbe.peak) readProbe.peak = readProbe.active
              return new Promise(resolve => setTimeout(resolve, RTT))
                .then(origGet)
                .then(r => { readProbe.active--; return r }, e => { readProbe.active--; throw e })
            }
            return page
          }
          return s
        }
        return l
      }
      return c
    }
  }
  const t0 = Date.now()
  const probed = await trailApi.main({ action: 'read', request: { kind: 'profile' } })
  readProbe.ms = Date.now() - t0
  check('注入 RTT 后 read 仍然成功且视图完整（并发化不得丢集合）',
    probed.ok === true && !!(probed.data && probed.data.view && probed.data.view.profile),
    JSON.stringify(probed.error || (probed.data && Object.keys(probed.data.view || {}))))
  check('一次 read 触发 14 次分页集合读（读数，不是新约束）', readProbe.reads === 14, 'reads=' + readProbe.reads)
  check('峰值并发 in-flight > 1（串行 await 恒为 1 ⇒ 14 跳串行往返）',
    readProbe.peak > 1, 'peak=' + readProbe.peak + '，等价墙钟 ' + readProbe.reads + '×RTT')
  check('墙钟远低于「14×RTT」的串行下界', readProbe.ms < readProbe.reads * RTT,
    'ms=' + readProbe.ms + ' vs 串行≥' + (readProbe.reads * RTT))
  console.log('  i 读数：注入 RTT=' + RTT + 'ms 时，14 次集合读的峰值并发=' + readProbe.peak
    + '，墙钟=' + readProbe.ms + 'ms；改造前（串行 await）同一探针实测峰值=1、墙钟≈228ms。')

  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
})().catch(e => {
  console.error('harness error:', e && (e.stack || e.message))
  process.exit(1)
})
