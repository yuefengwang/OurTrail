// 云函数调用封装。服务端约定：{ ok:true, data } 或 { ok:false, error:{code,message} }
'use strict'
const { FUNC_NAME } = require('../config')

function call(action, data) {
  return wx.cloud.callFunction({ name: FUNC_NAME, data: Object.assign({ action }, data || {}) })
    .then(res => {
      const r = res && res.result
      if (r && r.ok) return r.data
      // 兼容 error 为字符串的旧版协议；未部署新版时能直接看出原因
      let msg = '服务异常，请稍后再试'
      if (r && r.error) {
        msg = typeof r.error === 'string' ? r.error : (r.error.message || msg)
      } else if (r && r.errMsg) {
        msg = r.errMsg
      } else if (r && r.errorMessage) {
        msg = r.errorMessage
      } else if (!r) {
        msg = '云函数没有返回结果，请确认已部署最新版 trailApi'
      }
      const err = new Error(msg)
      err.code = (r && r.error && r.error.code) || 'INVALID_INPUT'
      throw err
    })
    .catch(e => {
      if (e instanceof Error && e.code) throw e
      const errMsg = (e && (e.errMsg || e.message)) || ''
      const err = new Error(
        /not *found/i.test(errMsg) ? '云函数 trailApi 尚未部署：请右键 cloudfunctions/trailApi →「上传并部署：云端安装依赖」'
          : /-504003|FUNCTIONS_TIME_LIMIT|timed *out/i.test(errMsg) ? '云函数执行超时（-504003）：请重新上传部署 cloudfunctions/trailApi（config.json 已调至 20 秒），或在云开发控制台 → 云函数 → trailApi → 配置中把超时改为 20 秒'
            : errMsg ? '云函数调用失败：' + errMsg
              : '网络异常，请稍后再试'
      )
      err.code = 'NETWORK'
      throw err
    })
}

// 读取视图：{ view, revision, now }
function read(request) {
  return call('read', { request })
}

// Result 型接口（readForm/readTransport/...）的解包：ok=false 时抛错
function readOr(name, data) {
  return call(name, data).then(r => {
    if (r && r.ok) return r.value
    const err = new Error((r && r.error && r.error.message) || '读取失败')
    err.code = (r && r.error && r.error.code) || 'INVALID_INPUT'
    throw err
  })
}

// ---- Result 透传型接口：云端返回 {ok, value|error}，页面自行检查 result.ok（不抛错）----
function readForm(activityId, signupId, purpose) {
  return call('readForm', { activityId, signupId, purpose })
}
function readTransport(activityId) {
  return call('readTransport', { activityId })
}
function readSensitive(activityId, signupId, purpose) {
  return call('readSensitive', { activityId, signupId, purpose })
}
function readContact(activityId, signupId) {
  return call('readContact', { activityId, signupId })
}
function readExport(activityId, signupIds, mode, purpose) {
  return call('readExport', { activityId, signupIds, mode, purpose })
}
// 云端 actionPreviewAssignments 成功时直接返回 plan（非 Result），此处重建 Result 以匹配页面契约
function previewAssignments(activityId) {
  return call('previewAssignments', { activityId }).then(
    value => ({ ok: true, value }),
    e => ({ ok: false, error: { message: errorText(e) } })
  )
}
// getWeather 返回 {status:'ready'|'unavailable', ...}，非 Result
function getWeather(activityId, pointId, date) {
  return call('getWeather', { activityId, pointId, date })
}
// P3 独立天气：按点自由查询（免活动语义）。返回体与 getWeather 的 ready 分支同形状。
function getWeatherByPoint(lat, lng, date) {
  return call('getWeatherByPoint', { lat, lng, date })
}

/** 提交命令；CONFLICT 时自动标记 needRefresh（页面应重读后重试） */
function dispatch(payload, expectedRevision, requestId) {
  return call('dispatch', {
    payload,
    expectedRevision,
    requestId: requestId || ('req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)),
  }).catch(e => {
    if (e && e.code === 'CONFLICT') e.needRefresh = true
    throw e
  })
}

/**
 * dispatch 的页面封装：并发冲突（CONFLICT）时自动重读页面数据并提示，
 * 下次再点就能基于最新 revision 提交，避免「一直冲突」。
 * page 需提供 reload()。
 */
function dispatchAndSync(payload, expectedRevision, page) {
  return dispatch(payload, expectedRevision).catch(e => {
    if (e && e.needRefresh && page && typeof page.reload === 'function') {
      toast('安排已被他人更新，已刷新，请重试')
      Promise.resolve(page.reload()).catch(() => {})
    }
    throw e
  })
}

function toast(title, icon) {
  wx.showToast({ title: (title || '').slice(0, 20) || '完成', icon: icon || 'none', duration: 2400 })
}

// 错误统一转成可读文案
function errorText(e) {
  return (e && e.message) || '操作失败，请稍后再试'
}

module.exports = {
  call, read, readOr, dispatch, dispatchAndSync, toast, errorText,
  readForm, readTransport, readSensitive, readContact, readExport, previewAssignments, getWeather,
  getWeatherByPoint,
}
