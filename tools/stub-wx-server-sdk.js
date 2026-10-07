// 测试桩：替代 wx-server-sdk（仅 tools/trailapilab-test.js 通过 Module._resolveFilename 钩子加载）。
// fake db = 内存文档库，支持 store.js 用到的全部面：createCollection / collection.doc(get/set/remove)
// / orderBy.limit.skip.get / runTransaction。
'use strict'

const state = { openid: '', db: null }

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
      const transaction = {
        collection: name => ({
          doc: id => ({
            get: async () => {
              const d = coll(name).get(id)
              if (!d) throw new Error('document not exists')
              return { data: clone(d) }
            },
            set: async ({ data }) => { coll(name).set(id, clone(data)) },
            remove: async () => { coll(name).delete(id) },
          }),
        }),
      }
      // ── TEST-HARNESS DETERMINISTIC TRANSACTION BARRIER ────────────────────────
      // ≠ REAL CLOUD CONCURRENCY PROOF。开 barrier 只证明「同一 revision 的两个事务
      // 在串行化基座下必然一胜一 CONFLICT、败者零副作用」；真云端的锁粒度、可见性与
      // MVCC 快照都没有建模，任何结论都必须标 STUB-BARRIER，不得写成 REAL_CONCURRENCY PASS。
      // 默认 OFF：既有 39 个套件的时序行为与改造前逐字节一致。
      // barrier 模拟的是 read → CAS → write → commit 整体落在事务锁内（store.js:111-125）。
      return state.txnBarrier ? serialize(() => fn(transaction)) : fn(transaction)
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
}
