// OurTrail · 云函数入口（新版）
// 所有数据读写都经过这里：客户端不直连数据库，domain 层在服务端执行。
// 约定返回：{ ok:true, data } 或 { ok:false, error:{ code, message } }
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const {
  fetchForecast, gcjToWgs, isWeatherFreeAction, weatherCacheKey, resolvePointQuery, pointResponse, PROVIDER,
} = require('./lib/weather')
const store = require('./store')
const { canonicalPayload, deepClone, genId, ERROR_CODES } = require('./domain/contracts')
const { reduceCommand } = require('./domain/commands')
const { assertInvariants } = require('./domain/invariants')
const {
  selectView, selectSensitive, selectContact, selectSignupForm, selectTransport,
  selectAccess, selectNoticeManagement, selectExport, selectRoutes,
} = require('./domain/selectors')
const { planAssignments } = require('./domain/allocation')
const { isActivityMediaFileId, removedActivityFiles } = require('./domain/files')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/* ---------- 基础工具 ---------- */

// 北京时间（UTC+8）的 ISO 字符串，与原型 Instant 语义一致
function nowIso() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19) + '+08:00'
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code })
}

// 服务端覆写证据字段：时间与操作者以服务端为准，客户端只能提供 note。
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

function validDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T00:00:00+08:00'))
}

/* ---------- 读取类 ---------- */

async function actionRead(payload, openid) {
  // 入参形状在入口就判，不留给 selector 抛 TypeError：那会被归类成 INTERNAL，
  // 而这明明是客户端少传了字段，应当是 INVALID_INPUT。
  if (!payload || !payload.request || typeof payload.request !== 'object') fail('INVALID_INPUT', '缺少读取请求内容。')
  const state = await store.loadState(db)
  const now = nowIso()
  const view = selectView(state, { userId: openid }, payload.request, now)
  return { view, revision: state.revision, now }
}

async function actionReadForm(payload, openid) {
  const state = await store.loadState(db)
  return selectSignupForm(state, { userId: openid }, payload.activityId, payload.signupId, String(payload.purpose || ''), nowIso())
}

async function actionReadTransport(payload, openid) {
  const state = await store.loadState(db)
  return selectTransport(state, { userId: openid }, payload.activityId)
}

async function actionReadAccess(payload, openid) {
  const state = await store.loadState(db)
  return selectAccess(state, { userId: openid }, payload.activityId)
}

async function actionReadNoticeManagement(payload, openid) {
  const state = await store.loadState(db)
  return selectNoticeManagement(state, { userId: openid }, payload.activityId)
}

async function actionReadSensitive(payload, openid) {
  const state = await store.loadState(db)
  return selectSensitive(state, { userId: openid }, payload.activityId, payload.signupId, String(payload.purpose || ''), nowIso())
}

async function actionReadContact(payload, openid) {
  const state = await store.loadState(db)
  return selectContact(state, { userId: openid }, payload.activityId, payload.signupId, nowIso())
}

async function actionReadExport(payload, openid) {
  const state = await store.loadState(db)
  return selectExport(state, { userId: openid }, payload.activityId, payload.signupIds || [], payload.mode, String(payload.purpose || ''), nowIso())
}

// V2 路线库：我的路线列表（无 routeId）与单条路线（带 routeId）。
// 形状在入口就判：routeId 缺省/非字符串按「列表」处理，非字符串一律 INVALID_INPUT，
// 不留给 selector 抛 TypeError（那会被归类成 INTERNAL，而这是客户端入参问题）。
async function actionReadRoutes(payload, openid) {
  let routeId = null
  if (payload && payload.routeId !== undefined && payload.routeId !== null) {
    if (typeof payload.routeId !== 'string' || !payload.routeId) fail('INVALID_INPUT', '路线标识无效。')
    routeId = payload.routeId
  }
  const state = await store.loadState(db)
  const result = selectRoutes(state, { userId: openid }, routeId)
  if (!result.ok) fail(result.error.code, result.error.message)
  return Object.assign({ revision: state.revision, now: nowIso() }, result.value)
}

async function actionPreviewAssignments(payload, openid) {
  const state = await store.loadState(db)
  const result = planAssignments(state, { userId: openid }, payload.activityId, nowIso())
  if (result.ok) return result.value
  fail(result.error.code, result.error.message)
}

/* ---------- 命令 ---------- */

async function actionDispatch(payload, openid) {
  if (!payload || typeof payload.payload !== 'object' || !payload.payload) {
    fail('INVALID_INPUT', '操作字段不完整或格式不正确。')
  }
  const before = await store.loadState(db)
  const now = nowIso()
  const actorId = openid
  const clean = deepClone(payload.payload)
  overrideEvidence(clean, now, actorId)
  const requestId = typeof payload.requestId === 'string' && payload.requestId ? payload.requestId : genId('request')
  // 漏斗门（服务器侧，BUG-C1 的另一半）：客户端 utils/api.js 早就拒绝发无 revision 的命令，但
  // **小程序包会滞后于云函数**——旧版本客户端照样能把 expectedRevision=undefined 打进来。
  // 原先这里缺省成 before.revision，等于一次废掉两道保护：commands.js 的
  // 「state.revision !== expectedRevision ⇒ CONFLICT」变成永真，schema 的 specCount 也被喂了假值，
  // 结果是后写者静默覆盖前写者（数据无损、无人报错、事后查不出来）。
  // 现在失败关闭，错误码与客户端同词汇（NO_REVISION），页面才会走「重开页面」而不是「保留输入重试」。
  if (!Number.isInteger(payload.expectedRevision)) {
    fail('NO_REVISION', '页面数据尚未读取完成，本次修改没有保存。请重新打开该页面后再试。')
  }
  const expectedRevision = payload.expectedRevision
  const fingerprint = sha256(canonicalPayload(clean))
  const result = reduceCommand(before, {
    actor: { userId: actorId }, requestId, expectedRevision, fingerprint, payload: clean,
  }, { now, id: genId })
  if (!result.ok) fail(result.error.code, result.error.message)
  const { targetIds, replayed } = result.value
  let revision = result.value.state.revision
  if (!replayed) {
    // 以读取时的 revision 做 CAS；期间被他人写入则报 CONFLICT，客户端重读后再试
    const persisted = await store.persistState(db, before, result.value.state, before.revision, now)
    revision = persisted.revision
    // 写后清理：只删「写入前被活动引用、写入后已无人引用」的图片。
    // 事务已提交，删除失败只记日志，不回滚业务结果；未保存草稿的上传是孤儿，留给未来的 GC。
    const removed = removedActivityFiles(before, result.value.state)
    if (removed.length) {
      try {
        await cloud.deleteFile({ fileList: removed })
      } catch (e) {
        console.warn('[file-gc] 删除未引用图片失败：', (e && (e.errMsg || e.message)) || e)
      }
    }
  }
  return { targetIds, replayed, revision }
}

/* ---------- 天气（真实 Open-Meteo，带缓存） ---------- */

// 陈旧兜底时长：外呼失败时，12 小时内的旧预报仍好过一面错误墙（云层时过境迁，
// 更旧的不再冒充"现在的天气"）。命中的返回体带 stale/staleAt，客户端据此标注时效。
const STALE_MAX_MS = 12 * 3600000

async function getCachedForecast(lat, lng, date) {
  const key = weatherCacheKey(lat, lng, date)
  const cached = await db.collection('weather_cache').doc(key).get().catch(() => null)
  if (cached && cached.data && Date.now() - new Date(cached.data.fetchedAt).getTime() < 30 * 60000) {
    return cached.data.forecast
  }
  try {
    const forecast = await fetchForecast(lat, lng, date)
    await db.collection('weather_cache').doc(key).set({
      data: { forecast, fetchedAt: new Date() },
    }).catch(() => null)
    return forecast
  } catch (e) {
    // Open-Meteo 超时/5xx：山里信号与服务抖动是常态，有旧数据就软降级——
    // 页面显示"X 小时前的预报"加重新查询入口，而不是"天气暂不可用"的错误墙
    const age = cached && cached.data
      ? Date.now() - new Date(cached.data.fetchedAt).getTime() : Infinity
    if (cached && cached.data && cached.data.forecast && age < STALE_MAX_MS) {
      return Object.assign({}, cached.data.forecast, {
        stale: true,
        staleAt: new Date(cached.data.fetchedAt).toISOString(),
      })
    }
    throw e
  }
}

// 活动模式天气只需要一个活动的路线快照。此前这里走 store.loadState（15 个集合 + meta
// 全量读）——天气页每次进入都要为一次坐标查找付全状态加载，冷启动时段这正是
// 用户等待与 -504003 超时的成分之一。改为按 docId 直读（recordKey 对 activities
// 就是 record.id，与 loadCollection 读到的是同一份文档）。
// 读故障与"文档不存在"必须分开：后者是 NOT_FOUND，前者原样抛出交 main 归类，
// 不把"这一刻读不出来"冒充成"活动不存在"（store.ensureMeta 的同款纪律）。
async function loadActivityDoc(activityId) {
  if (typeof activityId !== 'string' || !activityId) return null
  let res = null
  let readError = null
  try {
    res = await db.collection(store.COLLECTIONS.activities).doc(activityId).get()
  } catch (e) { readError = e }
  if (res && res.data) return res.data
  if (readError && /not exists/i.test(String((readError && (readError.errMsg || readError.message)) || ''))) return null
  if (readError) throw readError
  return null
}

async function actionGetWeather(payload) {
  const activity = await loadActivityDoc(payload.activityId)
  if (!activity) fail('NOT_FOUND', '找不到此活动。')
  const point = activity.routeSnapshot.points.find(p => p.id === payload.pointId)
  if (!point) return { status: 'unavailable', message: '找不到该路线节点，暂时无法展示天气。' }
  const date = String(payload.date || '')
  if (!validDateStr(date)) return { status: 'unavailable', message: '日期无效。' }
  const now = nowIso()
  const today = now.slice(0, 10)
  const day = Date.parse(date + 'T00:00:00Z')
  const distance = (day - Date.parse(today + 'T00:00:00Z')) / 86400000
  if (!Number.isFinite(distance) || distance < 0 || distance > 14) return { status: 'out_of_range' }
  if (!point.coordinates) return { status: 'unavailable', message: '此路线节点没有坐标，暂无法查询天气。' }
  try {
    // 库存坐标是 GCJ-02，Open-Meteo 要 WGS-84，查询前纠偏（设计文档 §6）
    const wgs = gcjToWgs(point.coordinates.lat, point.coordinates.lng)
    const forecast = await getCachedForecast(wgs.lat, wgs.lng, date)
    if (!forecast || forecast.tooEarly) return { status: 'out_of_range' }
    const SLOTS = ['06', '08', '10', '12', '14', '16', '18', '20']
    const detail = forecast.detail || []
    const hours = detail
      .filter(h => SLOTS.indexOf(h.t) !== -1)
      .map(h => ({
        at: date + 'T' + h.t + ':00+08:00',
        temperature: Math.round(h.temp),
        precipitation: h.precip == null ? 0 : Math.round(h.precip * 10) / 10,
        wind: '风速 ' + (h.wind == null ? '—' : Math.round(h.wind)) + ' km/h',
      }))
    if (!detail.length) return { status: 'out_of_range' }
    return {
      status: 'ready',
      updatedAt: now,
      provider: PROVIDER,
      hours,
      days: forecast.days || [],
      detail,
      series: forecast.series || [],
      // Weather V2 additive：多高度云量剖面（缺失 = null，旧客户端不读，新客户端降级）
      cloudLevels: forecast.cloudLevels || null,
      pointElevation: forecast.elevation,
      // 陈旧兜底标记：为 true 时 staleAt 是数据的实际取数时间，页面必须标注"不是实时"
      stale: !!forecast.stale,
      staleAt: forecast.stale ? forecast.staleAt : undefined,
    }
  } catch (e) {
    return { status: 'unavailable', message: (e && e.message) || '天气服务暂时不可用。' }
  }
}

/* ---------- 微信手机号（一键授权，无验证码） ---------- */

// 客户端 button open-type=getPhoneNumber 拿到 code，服务端换真实号码。
// 主体/权限要求：小程序需完成认证并开通 phonenumber 权限；失败时给出可操作的提示。
async function actionGetPhoneNumber(payload) {
  const code = String((payload && payload.code) || '').trim()
  if (!code) fail('INVALID_INPUT', '缺少手机号授权凭证，请重新点击授权。')
  try {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code })
    const info = (res && res.phoneInfo) || {}
    const phone = info.purePhoneNumber || info.phoneNumber || ''
    if (!phone) fail('INVALID_INPUT', '微信没有返回手机号，请手动填写。')
    return { phone }
  } catch (e) {
    const errCode = e && (e.errCode !== undefined ? e.errCode : e.code)
    if (errCode === 1400001 || (e && e.errMsg && e.errMsg.indexOf('invalid template') !== -1)) {
      fail('FORBIDDEN', '当前小程序尚未开通「手机号快速验证」权限（需完成认证并开通），请手动填写手机号。')
    }
    fail('INVALID_INPUT', '获取微信手机号失败：' + ((e && (e.errMsg || e.message)) || '请重试或手动填写。'))
  }
}

// P3 独立天气模块：按点自由查询（无活动语义）。设计文档：天气模块升级-P3 §8。
// 与 actionGetWeather 的差异只有"取坐标的方式"：不加载全量状态、不定位节点——
// 这也是它更快的原因（loadState 全量加载是当年 3 秒超时的成分之一）。
// 校验/窗口/纠偏/投影在 lib/weather.resolvePointQuery / pointResponse（纯函数，smoke 可测）。
async function actionGetWeatherByPoint(payload) {
  const now = nowIso()
  const q = resolvePointQuery(payload, now.slice(0, 10))
  if (!q.ok) {
    if (q.status === 'out_of_range') return { status: 'out_of_range' }
    fail(q.code || 'INVALID_INPUT', q.message || '坐标无效。')
  }
  try {
    // 库存/入参坐标是 GCJ-02，Open-Meteo 要 WGS-84（resolvePointQuery 已纠偏）；
    // 缓存 key 是 2dp 网格，与活动路径自然互通。
    const forecast = await getCachedForecast(q.wgs.lat, q.wgs.lng, q.date)
    const body = pointResponse(forecast)
    if (!body) return { status: 'out_of_range' }
    return Object.assign({ status: 'ready', updatedAt: now, provider: PROVIDER }, body)
  } catch (e) {
    return { status: 'unavailable', message: (e && e.message) || '天气服务暂时不可用。' }
  }
}

/* ---------- 路由 ---------- */

/* ---------- 活动图片安全检查（UGC 图，公开发现可见） ---------- */
// 客户端先 wx.cloud.uploadFile，再把 fileID 送进来。只返回 pass/reason，不回传图片内容。
// 未授权/接口不可用时返回 {pass:false, reason:'unavailable'}——失败关闭，不静默放行。
async function actionCheckImage(payload) {
  const fileID = String((payload && payload.fileID) || '')
  if (!isActivityMediaFileId(fileID)) fail('INVALID_INPUT', '图片标识无效。')
  const contentType = payload && payload.contentType === 'image/png' ? 'image/png' : 'image/jpeg'
  let file
  try {
    file = await cloud.downloadFile({ fileID })
  } catch (e) {
    return { pass: false, reason: 'read_failed' }
  }
  const buffer = file && file.fileContent
  if (!buffer || !buffer.length) return { pass: false, reason: 'read_failed' }
  // imgSecCheck 的同步接口只收 1MB 以内的图片；客户端压缩到 1280px/70 后通常远低于此。
  if (buffer.length > 1024 * 1024) return { pass: false, reason: 'too_large' }
  try {
    await cloud.openapi.security.imgSecCheck({ media: { contentType, value: buffer } })
    return { pass: true }
  } catch (e) {
    const errCode = e && (e.errCode !== undefined ? e.errCode : e.code)
    if (errCode === 87014) return { pass: false, reason: 'unsafe' }
    console.warn('[checkImage] unavailable:', errCode, e && (e.errMsg || e.message))
    return { pass: false, reason: 'unavailable' }
  }
}

const ROUTES = {
  read: actionRead,
  readForm: actionReadForm,
  readTransport: actionReadTransport,
  readAccess: actionReadAccess,
  readNoticeManagement: actionReadNoticeManagement,
  readSensitive: actionReadSensitive,
  readContact: actionReadContact,
  readExport: actionReadExport,
  previewAssignments: actionPreviewAssignments,
  dispatch: actionDispatch,
  getWeather: actionGetWeather,
  getWeatherByPoint: actionGetWeatherByPoint,
  getPhoneNumber: actionGetPhoneNumber,
  readRoutes: actionReadRoutes,
  checkImage: actionCheckImage,
}

// 一次请求一行结构化日志（可观测性的唯一落点：本轮改造之前整个后端零 console 调用，
// 「用户说没保存」在云端查不到任何痕迹）。字段刻意又小又稳：
//   a=action c=命令类型 rid=客户端请求号 u=actor 的单向散列（前 8 位）ok/code/ms/rp(是否重放)
// 绝不写 payload 内容、姓名、电话、健康备注、坐标——那些是排查用不上的敏感面。
// det 只在未归类异常时出现，且截断：这类信息是给维护者看的，不进用户界面。
function logRequest(event, openid, outcome) {
  const payload = event && event.payload
  console.log(JSON.stringify({
    ev: 'api',
    a: String((event && event.action) || ''),
    c: payload && typeof payload === 'object' && typeof payload.type === 'string' ? payload.type : '',
    rid: typeof (event && event.requestId) === 'string' ? String(event.requestId).slice(0, 64) : '',
    u: openid ? sha256(openid).slice(0, 8) : '',
    ok: outcome.ok ? 1 : 0,
    code: outcome.code || '',
    ms: outcome.ms,
    rp: outcome.replayed ? 1 : 0,
    rev: Number.isInteger(outcome.revision) ? outcome.revision : 0,
    det: outcome.detail || '',
  }))
}

// 归类：只有明确带业务码的失败才原样回给客户端。其余一律 INTERNAL——
// 未捕获的 TypeError/ReferenceError 的原文是英文，既会被当成「你填错了」（code 伪装成
// INVALID_INPUT），又等于把内部实现细节发到用户手机上；原文只进上面的日志。
const BUSINESS_CODES = ERROR_CODES

exports.main = async (event) => {
  const startedAt = Date.now()
  let openid = ''
  try {
    await store.ensureCollections(db)
    const wxContext = cloud.getWXContext()
    openid = wxContext.OPENID || ''
    const handler = event && ROUTES[event.action]
    if (!handler) fail('INVALID_INPUT', '未知操作：' + (event && event.action))
    if (!openid && !isWeatherFreeAction(event.action)) fail('AUTH_REQUIRED', '请先登录微信后再使用。')
    const data = await handler(event || {}, openid)
    const replayed = !!(data && data.replayed)
    const revision = data && data.revision
    logRequest(event, openid, { ok: true, ms: Date.now() - startedAt, replayed, revision })
    return { ok: true, data }
  } catch (e) {
    const known = !!(e && typeof e.code === 'string' && BUSINESS_CODES.indexOf(e.code) !== -1)
    // dispatch 是唯一写路径，别的 action 都是读——话术必须分开：对读请求说「本次修改没有生效」
    // 是凭空承诺了一件根本没发生的事，用户会以为自己写坏了。
    const isWrite = !!event && event.action === 'dispatch'
    const outcome = {
      ok: false,
      code: known ? e.code : 'INTERNAL',
      ms: Date.now() - startedAt,
      // 原文只进日志：JSON.stringify 会把换行转义成 \n，所以「一次请求一行日志」不会被堆栈打断。
      detail: known ? '' : String((e && (e.stack || e.message)) || e).slice(0, 300),
    }
    logRequest(event, openid, outcome)
    return {
      ok: false,
      error: known
        ? { code: e.code, message: e.message }
        : {
          code: 'INTERNAL',
          message: isWrite
            ? '服务端处理这一步时出错了，本次修改没有生效。请重试一次；若反复出现，请截图本页并联系发起者。'
            : '服务端没能把这一页的内容取回来。请返回上一页再进来一次；若反复出现，请截图本页并联系发起者。',
        },
    }
  }
}

// 供本地冒烟测试使用（不导入 wx-server-sdk 的纯 domain 部分）
exports._internal = { assertInvariants }
