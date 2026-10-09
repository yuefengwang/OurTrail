// 持久层：State 按集合、按记录存文档（ot_ 前缀），ot_meta/main 保存全局 revision。
// 写入走事务：CAS 校验 revision → diff 出变更记录 → 写/删文档 → revision+1。
'use strict'

const { failure, deepClone } = require('./domain/contracts')

const COLLECTIONS = {
  profiles: 'ot_profiles',
  routes: 'ot_routes',
  activities: 'ot_activities',
  groups: 'ot_groups',
  signups: 'ot_signups',
  vehicles: 'ot_vehicles',
  assignments: 'ot_assignments',
  memberships: 'ot_memberships',
  attendance: 'ot_attendance',
  positions: 'ot_positions',
  incidents: 'ot_incidents',
  events: 'ot_events',
  notices: 'ot_notices',
  receipts: 'ot_receipts',
}
const ALL_COLLECTIONS = Object.keys(COLLECTIONS)

function recordKey(name, record) {
  if (name === 'assignments' || name === 'attendance' || name === 'positions') return record.signupId
  if (name === 'receipts') return record.actorId + '__' + record.requestId
  return record.id
}

class ConflictError extends Error {
  constructor(message) {
    super(message)
    this.code = 'CONFLICT'
  }
}

async function loadCollection(db, name) {
  const coll = db.collection(COLLECTIONS[name])
  const out = []
  const PAGE = 1000
  for (let skip = 0; ; skip += PAGE) {
    const res = await coll.orderBy('_id', 'asc').limit(PAGE).skip(skip).get()
    for (const doc of res.data) {
      const record = Object.assign({}, doc)
      delete record._id
      out.push(record)
    }
    if (res.data.length < PAGE) break
  }
  return out
}

// 容器内只建一次集合：`exports.main` 每次调用都会走 ensureCollections，而集合在首次部署后
// 就一直存在 ⇒ 之前每个请求都白付 16 次 createCollection 往返（14 业务集合 + ot_meta + weather_cache）。
// 记的是 **db 实例**而不是布尔量：测试会在同一进程里换内存桩的 db，布尔量会让新库跳过建集合；
// 存 promise 让容器冷启动时的并发首调共享同一次建集合，失败则清空、下次重试（不把瞬时故障固化）。
let ensuredFor = null
let ensuringPromise = null

async function ensureCollections(db) {
  if (ensuredFor === db) return
  if (!ensuringPromise) {
    ensuringPromise = (async () => {
      await Promise.all(ALL_COLLECTIONS.map(name =>
        db.createCollection(COLLECTIONS[name]).catch(() => null)))
      await db.createCollection('ot_meta').catch(() => null)
      await db.createCollection('weather_cache').catch(() => null)
    })().then(() => { ensuredFor = db })
      .catch(e => { ensuredFor = null; throw e })
      .finally(() => { ensuringPromise = null })
  }
  await ensuringPromise
}

async function createMeta(db) {
  const data = { revision: 0, savedAt: new Date().toISOString() }
  await db.collection('ot_meta').doc('main').set({ data }).catch(() => null)
  return data
}

// 「文档不存在」与「这一刻读不出来」必须分开。改造前两者都落进同一个 `.catch(() => null)`，
// 然后无条件 `set({ revision: 0 })` ⇒ 一次 meta 读超时就把全局计数器从 N 清零：所有在线客户端
// 缓存的 revision 同时变陈旧，接下来的写一律 CONFLICT（实测可复现），而这是一次**读请求
// 造成的不可逆写**。不是静默丢写（persistState 在事务内重读 meta 才判 CAS），但代价是
// 全场误冲突 + 版本号失去单调性，只能靠重读恢复。
// 判不出存在性时用一次不抛错的集合扫描复核；仍复核不到才失败关闭。
function notExistsError(e) {
  return /not exists/i.test(String((e && (e.errMsg || e.message)) || ''))
}

async function ensureMeta(db) {
  let res = null
  let readError = null
  try { res = await db.collection('ot_meta').doc('main').get() } catch (e) { readError = e }
  if (res && res.data && typeof res.data.revision === 'number') return res.data
  // 缺档在不同 SDK 形状下有两种表现：抛错，或返回没有 data 的结果。两种都算「确实没有」。
  if (res && !res.data) return createMeta(db)
  if (res && res.data) {
    throw Object.assign(new Error('状态版本记录已损坏，本次请求不使用它。请联系维护者核对 ot_meta/main。'), { code: 'CORRUPT_SNAPSHOT' })
  }
  if (!readError || notExistsError(readError)) return createMeta(db)
  const scan = await db.collection('ot_meta').orderBy('_id', 'asc').limit(1000).skip(0).get().catch(() => null)
  if (scan && Array.isArray(scan.data) && !scan.data.some(row => row && row._id === 'main')) return createMeta(db)
  throw Object.assign(new Error('状态读取失败，本次请求没有使用可能过期的数据。请重试。'), { code: 'STORAGE_UNAVAILABLE' })
}

// 读取整个 State（与原型的内存态一致；集合数不动，但往返必须并发）。
async function loadState(db) {
  // 15 个读（ot_meta + 14 个业务集合）并发发出：串行 await 会把每次网络往返首尾相接，
  // 墙钟 = 15×RTT，这笔开销冷启动和低并发时段是直接加在用户等待上的；并发后 = 1×RTT。
  // 一致性没有因此变差：这个快照本来就不是原子读（改造前后都可能被并发写切开），
  // 真正防脏写的是 persistState 里的 revision CAS，不是读取顺序。
  const reads = [ensureMeta(db)].concat(ALL_COLLECTIONS.map(name => loadCollection(db, name)))
  const [meta, ...records] = await Promise.all(reads)
  const state = {
    schemaVersion: 1, revision: meta.revision, savedAt: meta.savedAt,
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
  ALL_COLLECTIONS.forEach((name, i) => { state[name] = records[i] })
  return state
}

function diffCollections(before, after) {
  const writes = []
  const removes = []
  for (const name of ALL_COLLECTIONS) {
    const coll = COLLECTIONS[name]
    const oldMap = new Map(before[name].map(r => [recordKey(name, r), r]))
    const newMap = new Map(after[name].map(r => [recordKey(name, r), r]))
    for (const [key, record] of newMap) {
      const old = oldMap.get(key)
      if (!old || JSON.stringify(old) !== JSON.stringify(record)) {
        writes.push({ coll, _id: key, data: deepClone(record) })
      }
    }
    for (const key of oldMap.keys()) {
      if (!newMap.has(key)) removes.push({ coll, _id: key })
    }
  }
  return { writes, removes }
}

/**
 * 在一个事务里完成：revision CAS → 写 diff → revision+1。
 * 若 CAS 失败（别的请求先落库），抛 ConflictError，客户端应重读后重试。
 */
async function persistState(db, before, after, expectedRevision, nowIso) {
  const { writes, removes } = diffCollections(before, after)
  // BUG-C3：CAS 冲突的判定不能依赖异常对象穿过 runTransaction 边界。真云端会用 SDK 自己的错误对象
  // 重新抛出回调里抛出的异常，届时 catch 里的 `e instanceof ConflictError` 判 false，
  // 冲突被误分类成 STORAGE_UNAVAILABLE ⇒ 客户端不置 needRefresh、不重读，
  // 而文案还让用户"保留输入后重试"，重试必然再撞同一个陈旧 revision（数据无损，恢复链路坏了）。
  // 所以冲突记成边界内侧的哨兵，出了边界再由我们自己抛；早退 = 本事务不做任何写入 = 败者零副作用。
  let conflicted = false
  try {
    await db.runTransaction(async transaction => {
      const metaRes = await transaction.collection('ot_meta').doc('main').get()
      const meta = metaRes && metaRes.data
      if (!meta || meta.revision !== expectedRevision) {
        conflicted = true
        return
      }
      for (const w of writes) {
        await transaction.collection(w.coll).doc(w._id).set({ data: w.data })
      }
      for (const r of removes) {
        await transaction.collection(r.coll).doc(r._id).remove()
      }
      await transaction.collection('ot_meta').doc('main').set({
        data: { revision: expectedRevision + 1, savedAt: nowIso },
      })
    })
  } catch (e) {
    if (e instanceof ConflictError) throw e
    // 机制②（2026-10-08 诊断部署取回的真云端签名）：平台按自己的读写冲突规则，在事务内
    // `document.set` 上**原子中止**败者——此时我方 meta.revision 检查已经通过。抛的是平台自己的
    // 错误对象：errCode=-501001 + 子类型 ResourceUnavailable.TransactionConflict，
    // 自身可枚举键只有 errCode,errMsg（没有 code）⇒ 既过不了 instanceof，也不是我们认识的异常。
    // 它与我方 CAS 冲突同语义（你的写被并发写挤掉、什么都没落），所以必须映射成 CONFLICT，
    // 否则客户端不置 needRefresh、不重读，而文案还让用户"保留输入后重试"。
    // 判据是"码 AND 子类型"两个条件：诊断样本里 -501001 只出现过这一个子类型（23/23），
    // 裸码单独作判据会把未见过的真存储故障伪装成冲突——C8-⑨⑩⑪ 守的就是这条。
    if (e && e.errCode === -501001 && /ResourceUnavailable\.TransactionConflict/.test(String((e && (e.errMsg || e.message)) || ''))) {
      throw new ConflictError('安排已更新，本次修改没有保存。请核对最新状态后重新提交。')
    }
    // 这条分支现在只兜真正的存储侧故障（SDK 自己的错误、超时、连接问题）——
    // CAS 冲突已经由 conflicted 哨兵接管，不再依赖类型跨边界存活。
    throw Object.assign(new Error('这次修改没有保存，原安排未改变。请保留输入后重试。'), { code: 'STORAGE_UNAVAILABLE' })
  }
  if (conflicted) throw new ConflictError('安排已更新，本次修改没有保存。请核对最新状态后重新提交。')
  return { revision: expectedRevision + 1 }
}

module.exports = {
  COLLECTIONS, ALL_COLLECTIONS, ensureCollections, ensureMeta, loadState, persistState,
  diffCollections, recordKey, failure, ConflictError,
}
