// 云函数调用封装。服务端约定：{ ok:true, data } 或 { ok:false, error:{code,message} }
'use strict'
const { FUNC_NAME } = require('../config')

// 云函数内部异常（模块缺失/未定义标识符/空指针等）会把英文堆栈直接透传到界面——
// 翻译成可行动的话术；细节在云端日志里，不拿 require stack 消耗用户信任
function humanizeInternal(msg) {
  return /Cannot find module|Require stack|ReferenceError|SyntaxError|TypeError|is not a function|is not defined/.test(msg)
    ? '云函数内部错误：请重新上传部署 trailApi 后重试；仍复现请截图反馈本提示。'
    : msg
}

function call(action, data) {
  return wx.cloud.callFunction({ name: FUNC_NAME, data: Object.assign({ action }, data || {}) })
    .then(res => {
      const r = res && res.result
      if (r && r.ok) return r.data
      // 兼容 error 为字符串的旧版协议；未部署新版时能直接看出原因
      let msg = '服务异常，请稍后再试'
      if (r && r.error) {
        msg = humanizeInternal(typeof r.error === 'string' ? r.error : (r.error.message || msg))
      } else if (r && r.errMsg) {
        msg = humanizeInternal(r.errMsg)
      } else if (r && r.errorMessage) {
        msg = humanizeInternal(r.errorMessage)
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
            : errMsg ? humanizeInternal('云函数调用失败：' + errMsg)
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
  getWeatherByPoint,
}
