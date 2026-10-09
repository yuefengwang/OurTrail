// 错误码、DomainError 与规范化 JSON（用于命令指纹）。
'use strict'

const ERROR_CODES = [
  'AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT', 'WRONG_PHASE', 'CONFLICT',
  'REQUEST_REUSED', 'CAPACITY', 'DUPLICATE_PERSON', 'GROUP_SCOPE', 'VEHICLE_FULL',
  'SEAT_TAKEN', 'PICKUP_MISMATCH', 'DRIVER_CONFLICT', 'UNRESOLVED_DEPARTURE',
  'UNRESOLVED_SAFETY', 'CONSENT_REQUIRED', 'STORAGE_UNAVAILABLE', 'OFFLINE', 'CORRUPT_SNAPSHOT',
  // NO_REVISION 由 index.js 的漏斗门发出（缺 expectedRevision 一律失败关闭），NETWORK 只来自客户端
  // 传输层——两者都曾不在本表里，于是「每个错误码都要有人话」那条门直接跳过了它们。
  'NO_REVISION', 'NETWORK',
  // 未归类的服务端异常：绝不允许把英文原文/堆栈当业务错误发给用户，也不允许伪装成 INVALID_INPUT
  // 让用户以为是自己填错了。原文只进云端日志。
  'INTERNAL',
]

function failure(code, message, fieldErrors) {
  const error = { code, message }
  if (fieldErrors && Object.keys(fieldErrors).length) error.fieldErrors = fieldErrors
  return { ok: false, error }
}

function okValue(value) {
  return { ok: true, value }
}

// 规范化 JSON：键排序、数组保序。仅用于已通过 schema 校验的 payload。
function canonicalPayload(payload) {
  function serialize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return '[' + value.map(serialize).join(',') + ']'
    const keys = Object.keys(value).sort()
    return '{' + keys.map(key => JSON.stringify(key) + ':' + serialize(value[key])).join(',') + '}'
  }
  return serialize(payload)
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function genId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

module.exports = { ERROR_CODES, failure, okValue, canonicalPayload, deepClone, genId }
