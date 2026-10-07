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

async function ensureCollections(db) {
  await Promise.all(ALL_COLLECTIONS.map(name =>
    db.createCollection(COLLECTIONS[name]).catch(() => null)))
  await db.createCollection('ot_meta').catch(() => null)
  await db.createCollection('weather_cache').catch(() => null)
}

async function ensureMeta(db) {
  const res = await db.collection('ot_meta').doc('main').get().catch(() => null)
  if (res && res.data && typeof res.data.revision === 'number') return res.data
  const data = { revision: 0, savedAt: new Date().toISOString() }
  await db.collection('ot_meta').doc('main').set({ data }).catch(() => null)
  return data
}

// 读取整个 State（与原型的内存态一致；V1 规模下开销可接受）。
async function loadState(db) {
  const meta = await ensureMeta(db)
  const state = {
    schemaVersion: 1, revision: meta.revision, savedAt: meta.savedAt,
    profiles: [], routes: [], activities: [], groups: [], signups: [], vehicles: [],
    assignments: [], memberships: [], attendance: [], positions: [], incidents: [],
    events: [], notices: [], receipts: [],
  }
  for (const name of ALL_COLLECTIONS) {
    state[name] = await loadCollection(db, name)
  }
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
