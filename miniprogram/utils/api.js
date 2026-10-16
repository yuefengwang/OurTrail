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

// toast 上屏文案的唯一出口。M-11 修的就是这一行原来长什么样的地方。
// 旧实现 `(title || '').slice(0, 20)` 有两个毛病，都不是假设：
//   ① 「20」藏在工具函数里，调用点看不见这条边界，写话术的人无从回避。基线上真发生了一处：
//      pages/weather-hub.js:97「平台隐私指引未声明「位置信息」，暂无法地图选点」（23 码点）被印成
//      「…暂无法地」，恰好丢掉「图选点」这个说明"什么功能不可用"的关键词；pages/signup.js:415/:558
//      那两句「…资料同步失败可在「我的」补存」是踩着 20 字零余量写的，任何一次加字都会把
//      "去哪儿补救"那一半切掉——与铁律 24「话术要给出路」正相反。
//   ② slice 切的是 UTF-16 码元不是字：一个 emoji 占两个码元，旧写法能从它中间切开，
//      屏幕上剩下一个孤立代理对（就是一个豆腐块）。
// 现在的三条口径，逐条都能在 tools/t2-m11-test.js 找到对应判据：
//   ① 预算之内**一字不动**地交给平台——这是缺陷本体的修法，也是"存量文案零回退"那一半；
//   ② 只有超出预算才裁，且只在句读处收口并补「…」：屏幕上留下的必须是一句读得通的话
//      加一个明说的省略号，而不是半截词（"读起来像渲染故障"本身就是缺陷）；收口收不住
//      （剩下的不足一半）就直接按预算截，宁可多留字也要保住"说了什么"的主干；
//   ③ 每一次裁切都在控制台点名原文：超长要在写的时候被发现，而不是等用户看见断句。
// ⚠ TOAST_TEXT_BUDGET 是按「两行 × 约 15 字」推出来的**撰写预算，不是平台实测**：21–30 字的
//   toast 真机上换几行、再长平台自己怎么裁，仓库里没有读数（fix-round2/out/T2/requests.md R-T2-1）。
//   改这个数要带着真机读数来。同一条约束的静态侧（写侧拦超长）是 tools/g2-toast-copy-test.js，
//   它不抄这个数，而是真调本函数把预算量出来——所以这里改了它自动跟着改判。
const TOAST_TEXT_BUDGET = 30
// 断在这些字符之后，屏幕上剩下的那一段自己就是一句完整的话（不是切在词中间）。
const TOAST_BREAK_AFTER = ['。', '！', '？', '；', '，', '、', ' ', '）', '」', '】', '』']

/** 按**码点**计数与收口：入参原样 → { title 交给 wx.showToast, truncated 是否动过文案 }。 */
function fitToastText(input) {
  const cps = Array.from(input === null || input === undefined ? '' : String(input))
  if (!cps.length) return { title: '完成', truncated: false }
  if (cps.length <= TOAST_TEXT_BUDGET) return { title: cps.join(''), truncated: false }
  const keepMax = TOAST_TEXT_BUDGET - 1 // 给省略号留一格，收完的总长仍不超过预算
  let keepAt = 0
  for (let i = keepMax - 1; i >= 0; i--) {
    if (TOAST_BREAK_AFTER.indexOf(cps[i]) === -1) continue
    if (i + 1 < Math.ceil(keepMax / 2)) break // 再往前就只留得住开头几个字，不如按预算截
    keepAt = i + 1
    break
  }
  return { title: cps.slice(0, keepAt || keepMax).join('') + '…', truncated: true }
}

function toast(title, icon) {
  const shown = fitToastText(title)
  if (shown.truncated) {
    console.warn('[api] toast 文案超出上屏预算（' + TOAST_TEXT_BUDGET + ' 码点），已收口成一句可读的话，原文：', title)
  }
  wx.showToast({ title: shown.title, icon: icon || 'none', duration: 2400 })
}

// 错误统一转成可读文案
function errorText(e) {
  return (e && e.message) || '操作失败，请稍后再试'
}

module.exports = {
  call, read, readOr, dispatch, dispatchAndSync, toast, errorText,
  readForm, readTransport, readSensitive, readContact, readExport, previewAssignments, getWeather,
  getWeatherByPoint, readRoutes,
  // toast 文案的撰写预算（M-11）：导出它是为了让「上屏实际收到的长度」与「写在调用点旁边的数」
  // 必须是同一个——由 tools/t2-m11-test.js 用真函数量，不许本文件里再出现第二个硬编码长度。
  TOAST_TEXT_BUDGET,
}
