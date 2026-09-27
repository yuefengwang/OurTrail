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

function readOr(name, data) {
  return call(name, data).then(r => r.value || r)
}

// 提交命令：requestId 幂等；成功返回 { targetIds, replayed, revision }
function dispatch(payload, expectedRevision, requestId) {
  return call('dispatch', {
    payload,
    expectedRevision,
    requestId: requestId || ('req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)),
  })
}

function toast(title, icon) {
  wx.showToast({ title: (title || '').slice(0, 20) || '完成', icon: icon || 'none', duration: 2400 })
}

// 错误统一转成可读文案
function errorText(e) {
  return (e && e.message) || '操作失败，请稍后再试'
}

module.exports = { call, read, readOr, dispatch, toast, errorText }
