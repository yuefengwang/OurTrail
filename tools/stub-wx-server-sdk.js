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
  return {
    collection,
    createCollection: async () => {},
    runTransaction: async fn => {
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
      return fn(transaction)
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
}
