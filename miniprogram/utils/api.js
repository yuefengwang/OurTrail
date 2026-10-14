// 云函数调用封装。服务端约定：{ ok:true, data } 或 { ok:false, error:{code,message} }
'use strict'
const { FUNC_NAME } = require('../config')

// 用户可见的失败话术。本小程序的使用者是户外人员，不是开发者：
// 「重新上传部署 trailApi」「控制台把超时改为 20 秒」这类字眼对现场没有任何可行动作，
// 只会让人以为工具坏了。原则：一句话说清"发生了什么 + 现在能做什么"，
// 技术原文（errMsg/堆栈）只进 e.raw 与 console，排查时按 raw 取，不占用户界面。
function humanizeInternal(msg) {
  return /Cannot find module|Require stack|ReferenceError|SyntaxError|TypeError|is not a function|is not defined/.test(msg)
    ? '服务临时出了点问题，请稍后再试。若反复出现，请反馈给我们。'
    : msg
}
// 传输层（断网 / 云函数超时 / 未部署）的统一话术：按成因给"下一步"，不给部署指引
function transportText(errMsg) {
  if (/not *found/i.test(errMsg)) {
    // 云函数不在：多半是版本太旧或刚发布。对用户唯一可行动作是重试/重开小程序
    return '服务暂时连不上。请检查网络；若刚更新过小程序，关掉再打开试试。'
  }
  if (/-504003|FUNCTIONS_TIME_LIMIT|timed *out/i.test(errMsg)) {
    return '等了太久没连上服务器。山里信号不稳时容易这样，请再试一次。'
  }
  return '网络不太稳，请稍后再试。'
}

function call(action, data) {
  return wx.cloud.callFunction({ name: FUNC_NAME, data: Object.assign({ action }, data || {}) })
    .then(res => {
      const r = res && res.result
      if (r && r.ok) return r.data
      // 兼容 error 为字符串的旧版协议；未部署新版时能直接看出原因
      let msg = '服务没有响应，请稍后再试。若刚更新过小程序，关掉再打开试试。'
      if (r && r.error) {
        msg = humanizeInternal(typeof r.error === 'string' ? r.error : (r.error.message || msg))
      } else if (r && r.errMsg) {
        msg = humanizeInternal(r.errMsg)
      } else if (r && r.errorMessage) {
        msg = humanizeInternal(r.errorMessage)
      }
      const err = new Error(msg)
      err.code = (r && r.error && r.error.code) || 'INVALID_INPUT'
      err.raw = r ? JSON.stringify(r).slice(0, 300) : ''
      throw err
    })
    .catch(e => {
      if (e instanceof Error && e.code) throw e
      const errMsg = (e && (e.errMsg || e.message)) || ''
      const err = new Error(errMsg ? transportText(errMsg) : '网络不太稳，请稍后再试。')
      err.code = 'NETWORK'
      // 技术原文不消失，只不进界面：排查时读 raw（也打一份到控制台）
      err.raw = errMsg
      if (errMsg) console.warn('[api] 云函数调用失败：', errMsg)
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
// V2 路线库：我的路线列表（不传 routeId）与单条路线（传 routeId）。
// 云端直接返回 {revision, now, routes|route, referencedActivityIds?}；越权/不存在时
// call() 抛带 code 的 Error（与 readOr 同口径，页面 catch 后自行呈现）。
function readRoutes(routeId) {
  return call('readRoutes', routeId ? { routeId } : {})
}
// P3 独立天气：按点自由查询（免活动语义）。返回体与 getWeather 的 ready 分支同形状。
function getWeatherByPoint(lat, lng, date) {
  return call('getWeatherByPoint', { lat, lng, date })
}

/** 提交命令；CONFLICT 时自动标记 needRefresh（页面应重读后重试） */
function dispatch(payload, expectedRevision, requestId) {
  // BUG-C1 的漏斗门：缺 revision 的命令一旦发出，index.js 会把它缺省成服务端当前值
  // ⇒ 内存层①与事务层②同时放弃 ⇒ 陈旧表单静默覆盖他人写入。客户端一律 fail closed：
  // 没读到状态就别写。不置 needRefresh——那不是"别人改了"，是本页没读到。
  if (!Number.isInteger(expectedRevision)) {
    const err = new Error('页面数据尚未读取完成，本次修改没有保存。请重新打开该页面后再试。')
    err.code = 'NO_REVISION'
    return Promise.reject(err)
  }
  return call('dispatch', {
    payload,
    expectedRevision,
    requestId: requestId || ('req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)),
  }).catch(e => {
    if (e && e.code === 'CONFLICT') e.needRefresh = true
    // 写命令的失败分两类，语义完全不同：
    //   · 服务端回了信封并明确拒绝（有 code）＝确定没落库，用户改一改可以再发；
    //   · 传输层失败（超时 / 断网 / 云函数没回话，统一 code=NETWORK）＝**结果未知**：
    //     事务很可能已经提交，只是响应没回到这台手机。
    // 结果未知绝不能和"没保存"用同一套话术：同一条意图的 requestId 每次都是新生成的（见上面的
    // requestId 兜底），用户以为没成功而再点一次，服务端看到的就是一条全新命令，
    // 幂等记忆（按 requestId 判）救不了它 ⇒ 第二次业务写。这里不自动重发（那是把一次不确定变成两次写），只标记出来，
    // 由 dispatchAndSync 重读页面：服务端状态是权威，读到什么就显示什么。
    else if (e && e.code === 'NETWORK') e.outcomeUnknown = true
    throw e
  })
}

/**
 * dispatch 的页面封装：并发冲突（CONFLICT）与结果未知（超时/断网）都要重读页面数据，
 * 区别只在话术——前者是"别人改了"，后者是"没确认，先看现在到底是什么状态"。
 * page 需提供 reload()。
 */
function dispatchAndSync(payload, expectedRevision, page) {
  return dispatch(payload, expectedRevision).then(res => {
    // 写成功会推进全局 revision：通知宿主页面重读并下发新 sync-key，其余常驻面板才会
    // 带着新 revision 发下一次命令（否则「名单审核完、切去分车造车」的第一次保存必撞
    // CAS CONFLICT——Phase 4 GP-07 实测定案）。Page 实例没有 triggerEvent，守卫跳过。
    if (page && typeof page.triggerEvent === 'function') page.triggerEvent('written')
    return res
  }).catch(e => {
    const canReload = page && typeof page.reload === 'function'
    if (e && e.needRefresh && canReload) {
      toast('安排已被他人更新，已刷新，请重试')
      Promise.resolve(page.reload()).catch(() => {})
    } else if (e && e.outcomeUnknown && canReload) {
      // 重读是这一步唯一的恢复动作：确认到底落没落库，而不是让用户对着一句「网络异常」再点一次。
      toast('结果未确认，已重读最新安排', 'none')
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
  getWeatherByPoint, readRoutes,
}
