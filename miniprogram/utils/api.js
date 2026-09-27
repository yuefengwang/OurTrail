// 云函数调用封装。服务端约定：{ ok:true, data } 或 { ok:false, error:{code,message} }
'use strict'
const { FUNC_NAME } = require('../config')

function call(action, data) {
  return wx.cloud.callFunction({ name: FUNC_NAME, data: Object.assign({ action }, data || {}) })
    .then(res => {
      const r = res.result
      if (r && r.ok) return r.data
      const err = new Error((r && r.error && r.error.message) || '服务异常，请稍后再试')
      err.code = (r && r.error && r.error.code) || 'INVALID_INPUT'
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
