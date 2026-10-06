// OurTrail · 云函数入口（新版）
// 所有数据读写都经过这里：客户端不直连数据库，domain 层在服务端执行。
// 约定返回：{ ok:true, data } 或 { ok:false, error:{ code, message } }
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const {
  fetchForecast, gcjToWgs, isWeatherFreeAction, weatherCacheKey, resolvePointQuery, pointResponse, PROVIDER,
} = require('./lib/weather')
const store = require('./store')
const { canonicalPayload, deepClone, genId } = require('./domain/contracts')
const { reduceCommand } = require('./domain/commands')
const { assertInvariants } = require('./domain/invariants')
const {
  selectView, selectSensitive, selectContact, selectSignupForm, selectTransport,
  selectAccess, selectNoticeManagement, selectExport,
} = require('./domain/selectors')
const { planAssignments } = require('./domain/allocation')

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
  const expectedRevision = Number.isInteger(payload.expectedRevision) ? payload.expectedRevision : before.revision
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
  }
  return { targetIds, replayed, revision }
}

/* ---------- 天气（真实 Open-Meteo，带缓存） ---------- */

async function getCachedForecast(lat, lng, date) {
  const key = weatherCacheKey(lat, lng, date)
  const cached = await db.collection('weather_cache').doc(key).get().catch(() => null)
  if (cached && cached.data && Date.now() - new Date(cached.data.fetchedAt).getTime() < 30 * 60000) {
    return cached.data.forecast
  }
  const forecast = await fetchForecast(lat, lng, date)
  await db.collection('weather_cache').doc(key).set({
    data: { forecast, fetchedAt: new Date() },
  }).catch(() => null)
  return forecast
}

async function actionGetWeather(payload) {
  const state = await store.loadState(db)
  const activity = state.activities.find(a => a.id === payload.activityId)
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
      pointElevation: forecast.elevation,
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
}

exports.main = async (event) => {
  await store.ensureCollections(db)
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const handler = event && ROUTES[event.action]
  try {
    if (!handler) fail('INVALID_INPUT', '未知操作：' + (event && event.action))
    if (!openid && !isWeatherFreeAction(event.action)) fail('AUTH_REQUIRED', '请先登录微信后再使用。')
    const data = await handler(event || {}, openid)
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: { code: (e && e.code) || 'INVALID_INPUT', message: (e && e.message) || '操作失败，请稍后再试' } }
  }
}

// 供本地冒烟测试使用（不导入 wx-server-sdk 的纯 domain 部分）
exports._internal = { assertInvariants }
