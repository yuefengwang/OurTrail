// trailApiLab · 预演执行器（私有测试工具，勿用于生产数据）
// 与 trailApi 同一套 domain/store 代码（tools/sync-lab.js 同步进来），
// 差别只有一个：actor 不是微信注入的 openid，而是剧本指定的合成演员。
// 真人账号的每一步仍走真机 UI；本函数只扮演其余角色。
//
// 动作（全部要求 event.secret === lab.config.LAB_SECRET）：
//   ping     —— 配置自检（secret 是否匹配、owner 是否配置、版本）
//   inspect  —— 预演活动摘要（阶段/报名状态计数/未结异常/演员名册）
//   seed     —— 执行一个阶段：{ stage:0..5, activityId?, ownerOpenid? }
//   cleanup  —— 清理预演数据：{ activityId?|all:true, profiles?:true }
'use strict'
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const store = require('./store')
const { canonicalPayload, deepClone, genId } = require('./domain/contracts')
const { reduceCommand } = require('./domain/commands')
const stages = require('./stages')
const cfg = require('./lab.config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const VERSION = '1.0.0'

function nowIso() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19) + '+08:00'
}
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}
function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

// 与 trailApi/index.js 相同的证据覆写：at/by 以服务端为准，客户端只给 note。
function overrideEvidence(node, now, actorId) {
  if (Array.isArray(node)) {
    node.forEach(item => overrideEvidence(item, now, actorId))
    return node
  }
  if (node === null || typeof node !== 'object') return node
  const keys = Object.keys(node)
  if (keys.length === 3 && 'at' in node && 'by' in node && 'note' in node) {
    node.at = now
    node.by = actorId
    node.note = String(node.note || '').slice(0, 2000)
    return node
  }
  keys.forEach(key => overrideEvidence(node[key], now, actorId))
  return node
}

// ---- 动态白名单：存 ot_meta/lab_allowlist，由白名单内账号在预演面板维护（无需改配置重部署）。
// 配置里的 OWNER_OPENIDS 是引导/固定白名单，始终有效且不可被动态移除。
async function loadAllowlist() {
  const res = await db.collection('ot_meta').doc('lab_allowlist').get().catch(() => null)
  const ids = res && res.data && Array.isArray(res.data.ids) ? res.data.ids : []
  return ids.filter(x => typeof x === 'string' && x)
}
function isConfigOwner(openid) {
  return !!openid && cfg.OWNER_OPENIDS.indexOf(openid) !== -1
}
function requireManager(auth) {
  if (!auth.authedOwner) fail('FORBIDDEN', '只有白名单内的账号可以管理预演白名单。')
}

// 单命令执行（内存态）：与 trailApi 的 actionDispatch 同一校验/回执语义，但不落库——
// 由 actionSeed 在整个阶段算完后一次性 CAS 持久化。requestId 幂等：重放不产生新变更。
function applyStep(working, step, now) {
  const clean = deepClone(step.payload)
  overrideEvidence(clean, now, step.actorId)
  const fingerprint = sha256(canonicalPayload(clean))
  const result = reduceCommand(working, {
    actor: { userId: step.actorId }, requestId: step.requestId,
    expectedRevision: working.revision, fingerprint, payload: clean,
  }, { now, id: genId })
  return result
}

// 阶段执行：单次 loadState → 内存连算全部命令 → 单事务原子落库（revision 精确推进 N）。
// 旧实现每条命令各自 loadState+persist，阶段 0 的 7 条命令 = 14+ 次数据库往返，冷启动下必超时。
async function actionSeed(event, auth) {
  const stage = Number(event.stage)
  if (!stages.hasStage(stage)) {
    fail('WRONG_PHASE', '未知阶段 ' + event.stage + '（可用：' + stages.STAGE_MENU + '）')
  }
  const before = await store.loadState(db)
  const now = nowIso()
  const ownerOpenid = resolveOwner(event, auth)
  let activityId = event.activityId ? String(event.activityId) : ''
  if (stage !== 0 && !activityId) {
    const found = stages.findLabActivity(before, ownerOpenid)
    if (!found) {
      fail('NOT_FOUND', '没有找到标题以「' + stages.PREFIX + '」开头且已发布的活动'
        + (ownerOpenid ? '（发起人限定为所配置/传入的 ownerOpenid）' : '')
        + '。请先在真机创建并发布，或在参数里直接给 activityId。')
    }
    activityId = found.id
  }
  const plan = stages.buildStage(stage, before, { ownerOpenid, activityId })
  if (plan.error) fail('WRONG_PHASE', plan.error)

  let working = before
  const executed = []
  for (const step of plan.commands) {
    // 与旧 runStep 同语义：报名遇 CAPACITY 自动转整组候补重试
    let result = applyStep(working, step, now)
    let waitlisted = false
    if (!result.ok && result.error.code === 'CAPACITY'
      && step.payload.type === 'signup.submit' && step.payload.mode === 'apply') {
      result = applyStep(working, Object.assign({}, step, {
        payload: Object.assign({}, step.payload, { mode: 'waitlist' }),
        requestId: step.requestId + '-w',
      }), now)
      waitlisted = true
    }
    if (!result.ok) {
      executed.push({ actor: step.actorId, type: step.payload.type, ok: false, code: result.error.code, message: result.error.message })
      continue
    }
    executed.push({
      actor: step.actorId, type: step.payload.type, ok: true, waitlisted,
      replayed: result.value.replayed, targetIds: result.value.targetIds,
    })
    if (!result.value.replayed) working = result.value.state
  }

  let revision = working.revision
  if (working.revision !== before.revision) {
    // 整阶段原子落库：diff before→working，单事务内 CAS 校验后写入，meta.revision 精确推进 N
    const { writes, removes } = store.diffCollections(before, working)
    try {
      await db.runTransaction(async transaction => {
        const metaRes = await transaction.collection('ot_meta').doc('main').get()
        const meta = metaRes && metaRes.data
        if (!meta || meta.revision !== before.revision) {
          throw new store.ConflictError('安排已更新，本次预演没有保存。请重跑本阶段（幂等）。')
        }
        for (const w of writes) await transaction.collection(w.coll).doc(w._id).set({ data: w.data })
        for (const r of removes) await transaction.collection(r.coll).doc(r._id).remove()
        await transaction.collection('ot_meta').doc('main').set({
          data: { revision: working.revision, savedAt: now },
        })
      })
    } catch (e) {
      if (e instanceof store.ConflictError) throw e
      throw Object.assign(new Error('这次预演没有保存，原数据未改变。请保留输入后重试。'), { code: 'STORAGE_UNAVAILABLE' })
    }
    revision = working.revision
  }
  return {
    stage, title: plan.title, activityId: activityId || null,
    executed, skips: plan.skips || [], actors: plan.actors || undefined,
    hint: plan.hint, revision,
  }
}

/* ---------- 动作 ---------- */

async function actionPing(event, auth) {
  return {
    version: VERSION,
    secretConfigured: !!cfg.LAB_SECRET,
    ownerAllowlist: cfg.OWNER_OPENIDS.length,
    authedVia: auth.authedOwner ? 'openid 白名单' : 'secret',
    caller: auth.openid || '（无 openid，走了 secret 通道）',
    stages: '0 建档 / 1 报名 / 2 修与撤 / 3 签到 / 4 现场 / 5 到家',
  }
}

// owner 解析顺序：调用参数 > openid 白名单命中者 > 配置的 OWNER_OPENID
function resolveOwner(event, auth) {
  return String(event.ownerOpenid || auth.authedOwner || cfg.OWNER_OPENID || '').trim()
}

async function actionInspect(event, auth) {
  const state = await store.loadState(db)
  const ownerOpenid = resolveOwner(event, auth)
  let activityId = event.activityId ? String(event.activityId) : ''
  if (!activityId) {
    const found = stages.findLabActivity(state, ownerOpenid)
    activityId = found ? found.id : ''
  }
  const activity = activityId ? state.activities.find(a => a.id === activityId) : null
  const rows = activityId ? state.signups.filter(s => s.activityId === activityId) : []
  const byStatus = {}
  rows.forEach(s => { byStatus[s.status] = (byStatus[s.status] || 0) + 1 })
  return {
    version: VERSION,
    caller: auth.openid || '',
    allowlist: { configIds: cfg.OWNER_OPENIDS.slice(), ids: await loadAllowlist() },
    ownerOpenid: ownerOpenid || '',
    activity: activity ? {
      id: activity.id, title: activity.title, phase: activity.phase,
      capacity: activity.capacity, signups: rows.length, byStatus,
      openIncidents: state.incidents.filter(i => i.activityId === activity.id && !i.resolution).length,
    } : null,
    board: stages.buildStageBoard(state, activityId || null),
    actors: state.profiles.filter(p => p.id.indexOf('u-lab-') === 0)
      .map(p => ({ id: p.id, name: p.person.name, companions: p.companions.map(c => c.person.name) })),
    revision: state.revision,
  }
}

// 白名单管理（仅白名单内账号）：add/remove 直接写 ot_meta/lab_allowlist，无需改配置重部署
async function actionAllowlistList(event, auth) {
  requireManager(auth)
  return { configIds: cfg.OWNER_OPENIDS.slice(), ids: await loadAllowlist(), caller: auth.openid || '' }
}

async function actionAllowlistAdd(event, auth) {
  requireManager(auth)
  const id = String(event.id || '').trim()
  if (!id || id.length > 120) fail('INVALID_INPUT', '请提供有效的身份码（openid，我的页可复制）。')
  if (isConfigOwner(id)) fail('INVALID_INPUT', '该身份码已在配置白名单内，无需添加。')
  const ids = await loadAllowlist()
  if (ids.indexOf(id) !== -1) fail('INVALID_INPUT', '该身份码已在白名单内。')
  ids.push(id)
  await db.collection('ot_meta').doc('lab_allowlist').set({ data: { ids } })
  return { ids }
}

async function actionAllowlistRemove(event, auth) {
  requireManager(auth)
  const id = String(event.id || '').trim()
  const ids = await loadAllowlist()
  if (ids.indexOf(id) === -1) fail('NOT_FOUND', id + ' 不在动态白名单内（配置内的身份码不可移除，请改配置文件）。')
  const next = ids.filter(x => x !== id)
  await db.collection('ot_meta').doc('lab_allowlist').set({ data: { ids: next } })
  return { ids: next }
}

async function actionCleanup(event, auth) {
  const state = await store.loadState(db)
  const ownerOpenid = resolveOwner(event, auth)
  let ids = []
  if (event.activityId) ids = [String(event.activityId)]
  else if (event.all) ids = state.activities.filter(a => a.title.indexOf(stages.PREFIX) === 0).map(a => a.id)
  else ids = state.activities
    .filter(a => a.title.indexOf(stages.PREFIX) === 0 && (!ownerOpenid || a.ownerId === ownerOpenid))
    .map(a => a.id)
  const removed = {}
  // 按活动维度清理（私有路线保留——它是发起人可复用的资产，与 activity.delete 同一取舍）。
  // 文档键一律用 store.recordKey 推导——assignment 无 id 字段（键是 signupId），手写 r.id 会传
  // undefined 给 doc()，真云 SDK 同步抛「docId必须为字符串或数字」（.catch 拦不住），桩库却容忍——真机首爆。
  // 注意 receipts 不在此列：Receipt 无 activityId 字段，按活动过滤永远匹配不到（死代码不写）；
  // 确定性请求号的复位靠下方 profiles 分支清 u-lab-* 回执（阶段 0 幂等重建档案）。
  for (const name of ['activities', 'groups', 'signups', 'vehicles', 'assignments', 'memberships', 'incidents', 'events', 'notices']) {
    const docs = state[name].filter(r => ids.indexOf(r.activityId) !== -1)
    for (const r of docs) {
      await db.collection(store.COLLECTIONS[name]).doc(store.recordKey(name, r)).remove().catch(() => null)
    }
    removed[name] = docs.length
  }
  // attendance / positions 以 signupId 为键
  const signupIds = new Set(state.signups.filter(s => ids.indexOf(s.activityId) !== -1).map(s => s.id))
  for (const name of ['attendance', 'positions']) {
    const docs = state[name].filter(r => signupIds.has(r.signupId))
    for (const r of docs) {
      await db.collection(store.COLLECTIONS[name]).doc(store.recordKey(name, r)).remove().catch(() => null)
    }
    removed[name] = docs.length
  }
  // 孤儿清扫：signupId 已无 signup 对应的履约/位置记录是死数据（旧版 cleanup 在 assignments 上
  // 同步抛错半途中止，signups 已删而 attendance 未删，会让「每份报名恰有一份履约」不变量
  // 永久破损、卡死后续所有活动创建）。这类记录无论如何都不该存在，全局安全。
  const liveSignupIds = new Set(state.signups.map(s => s.id))
  for (const name of ['attendance', 'positions']) {
    const orphans = state[name].filter(r => !liveSignupIds.has(r.signupId))
    for (const r of orphans) {
      await db.collection(store.COLLECTIONS[name]).doc(store.recordKey(name, r)).remove().catch(() => null)
    }
    if (orphans.length) removed[name + '_orphans'] = orphans.length
  }
  // 可选：演员档案与其回执一并清掉（下次阶段 0 会重新建档）。
  // 注意这一步独立于活动清理——只跑了阶段 0、还没建活动时也要能清档案。
  if (event.profiles) {
    const actors = state.profiles.filter(p => p.id.indexOf('u-lab-') === 0)
    for (const p of actors) {
      await db.collection(store.COLLECTIONS.profiles).doc(p.id).remove().catch(() => null)
    }
    removed.profiles = actors.length
    const receipts = state.receipts.filter(r => r.actorId.indexOf('u-lab-') === 0)
    for (const r of receipts) {
      await db.collection(store.COLLECTIONS.receipts).doc(store.recordKey('receipts', r)).remove().catch(() => null)
    }
    removed.receipts = receipts.length
  }
  return { removed, activityIds: ids }
}

/* ---------- 路由 ---------- */

const ROUTES = {
  ping: actionPing, inspect: actionInspect, seed: actionSeed, cleanup: actionCleanup,
  'allowlist.list': actionAllowlistList, 'allowlist.add': actionAllowlistAdd, 'allowlist.remove': actionAllowlistRemove,
}

exports.main = async (event) => {
  try {
    await store.ensureCollections(db)
    const handler = event && ROUTES[event.action]
    if (!handler) fail('INVALID_INPUT', '未知操作：' + (event && event.action) + '（可用 ping / inspect / seed / cleanup）')
    const wxContext = cloud.getWXContext()
    const openid = wxContext.OPENID || ''
    // 放行三选一：openid 配置白名单 / openid 动态白名单（面板维护，存库）/ 共享密钥（控制台等无 openid 场景）
    const dbIds = await loadAllowlist()
    const authedOwner = openid && (isConfigOwner(openid) || dbIds.indexOf(openid) !== -1) ? openid : ''
    const secretOk = !!cfg.LAB_SECRET && event.secret === cfg.LAB_SECRET
    if (!authedOwner && !secretOk) {
      fail('FORBIDDEN', '未获预演工具授权：把你的身份码「' + (openid || '（无）') + '」告诉白名单内的成员，'
        + '在「预演面板」添加即可（无需重新部署）；或加入 lab.config.js 的 OWNER_OPENIDS 后重新部署。')
    }
    const auth = { openid, authedOwner }
    const data = await handler(event || {}, auth)
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: { code: (e && e.code) || 'INVALID_INPUT', message: (e && e.message) || '操作失败' } }
  }
}
