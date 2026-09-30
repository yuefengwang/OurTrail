// 错误码、DomainError 与规范化 JSON（用于命令指纹）。
'use strict'

const ERROR_CODES = [
  'AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'INVALID_INPUT', 'WRONG_PHASE', 'CONFLICT',
  'REQUEST_REUSED', 'CAPACITY', 'DUPLICATE_PERSON', 'GROUP_SCOPE', 'VEHICLE_FULL',
  'SEAT_TAKEN', 'PICKUP_MISMATCH', 'DRIVER_CONFLICT', 'UNRESOLVED_DEPARTURE',
  'UNRESOLVED_SAFETY', 'CONSENT_REQUIRED', 'STORAGE_UNAVAILABLE', 'OFFLINE', 'CORRUPT_SNAPSHOT',
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
