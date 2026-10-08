// 测试桩：替代 wx-server-sdk（仅 tools/trailapilab-test.js 通过 Module._resolveFilename 钩子加载）。
// fake db = 内存文档库，支持 store.js 用到的全部面：createCollection / collection.doc(get/set/remove)
// / orderBy.limit.skip.get / runTransaction。
'use strict'

const state = {
  openid: '', db: null, txnBarrier: false, txnErrorWrapping: false,
  // 平台级事务冲突中止（Phase 10A / BUG-C3 机制②）：开关 + 已应用写计数 + 中止计数
  txnConflictAbort: false, writeSeq: 0, aborts: 0,
}

// 真云端实测到的错误形状（2026-10-08 诊断部署取证，23/23 样本同一类）：
//   name=Error  errCode=-501001  自身可枚举键只有 errCode,errMsg（**没有 code**）
//   errMsg='document.set:fail -501001 resource system error. [ResourceUnavailable.TransactionConflict] …'
// `__platformAbort` 用 defineProperty 挂成不可枚举标记：既能让"类型擦除"开关认出
// 这是平台自有的错误（不是我们回调里抛出去又被重抛的那个），又不污染 Object.keys 的签名形状。
function platformAbortError(method) {
  const msg = 'document.' + method + ':fail -501001 resource system error. ' +
    '[ResourceUnavailable.TransactionConflict] Transaction is conflict, maybe conflicts with other transactions.'
  const err = new Error(msg)
  err.errCode = -501001
  err.errMsg = msg
  Object.defineProperty(err, '__platformAbort', { value: true, enumerable: false })
  return err
}

function fakeDb() {
  const colls = new Map()
  function coll(name) {
    if (!colls.has(name)) colls.set(name, new Map())
    return colls.get(name)
  }
  const clone = v => JSON.parse(JSON.stringify(v))
  function collection(name) {
    return {
      doc(id) {
        // 对齐真云 SDK：docId 非字符串/数字同步抛错（assignment 手写 r.id 曾传 undefined，
        // 桩库容忍、真机炸「docId必须为字符串或数字」——桩必须比真 SDK 更严或同严）
        if (typeof id !== 'string' && typeof id !== 'number') {
          throw new Error('docId必须为字符串或数字')
        }
        return {
          get: () => {
            const d = coll(name).get(id)
            return d ? Promise.resolve({ data: clone(d) }) : Promise.reject(new Error('document not exists'))
          },
          set: ({ data }) => { coll(name).set(id, clone(data)); return Promise.resolve() },
          remove: () => { coll(name).delete(id); return Promise.resolve() },
        }
      },
      orderBy: () => ({
        limit: () => ({
          skip: n => ({
            get: async () => {
              const all = [...coll(name).entries()].sort(([a], [b]) => (a < b ? -1 : 1))
              const page = all.slice(n, n + 1000).map(([id, d]) => Object.assign({ _id: id }, clone(d)))
              return { data: page }
            },
          }),
        }),
      }),
    }
  }
  // barrier 的串行队列按 fakeDb 实例各存一份：每个套件都自己 __fakeDb() 建库，互不串台。
  let txnQueue = Promise.resolve()
  function serialize(task) {
    const run = txnQueue.then(task, task)
    txnQueue = run.then(() => {}, () => {})
    return run
  }

  return {
    collection,
    createCollection: async () => {},
    runTransaction: fn => {
      // 事务开局即记录"全局已应用写"的水位；写入点上只要水位被**别人**推进过就判冲突中止，
      // own 把自己这一笔笔写排除掉（同事务内多次 set 不是冲突）。
      const tx = { startSeq: state.writeSeq, own: 0 }
      const applyWrite = (method, body) => {
        if (state.txnConflictAbort && state.writeSeq - tx.own !== tx.startSeq) {
          state.aborts++
          throw platformAbortError(method)
        }
        body()
        state.writeSeq++
        tx.own++
      }
      // 写排队 = 先发起者先落库；读**不**排队 = 两笔并发事务都会先通过 store.js:120 的我方 CAS。
      // 这正是机制②的发生顺序：CAS 通过 → 平台在写入点原子中止（败者零写入，见 e2e-client-cas C8）。
      const write = task => state.txnConflictAbort ? serialize(task) : task()
      const transaction = {
        collection: name => ({
          doc: id => ({
            get: async () => {
              const d = coll(name).get(id)
              if (!d) throw new Error('document not exists')
              return { data: clone(d) }
            },
            set: ({ data }) => write(() => {
              applyWrite('set', () => { coll(name).set(id, clone(data)) })
            }),
            remove: () => write(() => {
              applyWrite('remove', () => { coll(name).delete(id) })
            }),
          }),
        }),
      }
      // ── TEST-HARNESS DETERMINISTIC TRANSACTION BARRIER ────────────────────────
      // ≠ REAL CLOUD CONCURRENCY PROOF。开 barrier 只证明「同一 revision 的两个事务
      // 在串行化基座下必然一胜一 CONFLICT、败者零副作用」；真云端的锁粒度、可见性与
      // MVCC 快照都没有建模，任何结论都必须标 STUB-BARRIER，不得写成 REAL_CONCURRENCY PASS。
      // 默认 OFF：既有 39 个套件的时序行为与改造前逐字节一致。
      // barrier 模拟的是 read → CAS → write → commit 整体落在事务锁内（store.js:111-125）。
      const run = () => fn(transaction)
      if (!state.txnErrorWrapping) return state.txnBarrier ? serialize(run) : run()
      // ── TEST-HARNESS SDK ERROR-TYPE ERASURE（Phase 10A，BUG-C3）────────────────
      // 建模的是真云端的一个可观测性质：回调里抛出的自定义 Error 穿过 runTransaction 边界后
      // **不再是同一个异常对象**（`store.js:128` 的 `e instanceof ConflictError` 因此判 false）。
      // 这是 STUB MODEL，不是 REAL CLOUD 证明——真 SDK 到底是"重新包装我们的错误"还是"抛它自己的
      // 事务冲突错误"，需要云函数日志才能区分（见 docs/testing/phase10a-c3-trace.md §2）。
      // 本开关只保证一件事：**冲突语义不得依赖异常类型跨边界存活**。
      // 默认 OFF：既有 43 个套件的时序与错误类型逐字节不变。
      const erased = state.txnBarrier ? serialize(run) : run()
      return erased.catch(err => {
        // 平台自有的错误（含 conflictAbort 造的那枚 -501001）**不是**"我们回调里抛出去又被重抛"的那个，
        // 所以不参与类型擦除；否则两个开关同开时 errCode 会被改写成 -500100，建模就失真了。
        if (err && err.__platformAbort) throw err
        throw Object.assign(new Error('transaction failed: ' + (err && err.message || String(err))), { errCode: -500100 })
      })
    },
    __count: name => coll(name).size,
  }
}

module.exports = {
  DYNAMIC_CURRENT_ENV: Symbol('DYNAMIC_CURRENT_ENV'),
  init() {},
  getWXContext() { return { OPENID: state.openid } },
  database() { return state.db },
  openapi: {},
  __state: state,
  __fakeDb: fakeDb,
  /** 开关 TEST-HARNESS 事务串行化 barrier；返回切换前的值。默认 OFF，仅 Phase 8 并发套件显式 ON。 */
  __setTxnBarrier: on => { const prev = !!state.txnBarrier; state.txnBarrier = !!on; return prev },
  /** 开关 TEST-HARNESS SDK 异常类型擦除（Phase 10A / BUG-C3）；默认 OFF。 */
  __setTxnErrorWrapping: on => { const prev = !!state.txnErrorWrapping; state.txnErrorWrapping = !!on; return prev },
  /**
   * 开关 TEST-HARNESS 平台级事务冲突中止（Phase 10A / BUG-C3 机制②）；默认 OFF。
   * ON：读不排队、写排队 ⇒ 并发两笔都先通过我方 CAS，后落者在事务内 `document.set` 处收到
   * 平台自己的 -501001 / ResourceUnavailable.TransactionConflict，且**一笔都没写**。
   * 与 barrier 互斥：barrier 把整个事务体串起来，败者会先撞我方 CAS 哨兵、根本走不到 set，
   * 所以同开时中止计数恒 0（C8 的有效性门会把这种"没生效"判成 INVALID，不放行空断言）。
   */
  __setTxnConflictAbort: on => { const prev = !!state.txnConflictAbort; state.txnConflictAbort = !!on; return prev },
}
