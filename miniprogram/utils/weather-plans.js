'use strict'

const F = require('./format')
const KEY = 'ourtrail.weather-plans.v1'
const RECENT_KEY = 'ourtrail.weather-recent.v1'
const CAP = 20
const MAX_VISITS = 40
const copy = value => JSON.parse(JSON.stringify(value))

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false
  const stamp = Date.parse(value + 'T00:00:00+08:00')
  return Number.isFinite(stamp) && F.cnParts(new Date(stamp).toISOString()).date === value
}

function addDays(date, days) {
  if (!validDate(date)) return ''
  return F.cnParts(new Date(Date.parse(date + 'T00:00:00+08:00') + days * 86400000).toISOString()).date
}

function newVisit(point) {
  return { id: newId('visit'), pointId: point.id, name: point.name || '路线节点', day: 1, time: '', departure: false }
}

function createPlan(route, source, startAt) {
  const start = startAt && Number.isFinite(Date.parse(startAt)) ? F.cnParts(startAt) : null
  return {
    id: newId('plan'), name: route.title || route.name || '天气行程', source: copy(source),
    startDate: start ? start.date : F.cnToday(), routeUpdatedAt: route.updatedAt || '',
    visits: (route.points || []).map(newVisit), updatedAt: '',
    startHint: start ? '活动出发时间 ' + start.date + ' ' + start.time + '（仅供安排参考）' : '',
  }
}

function validatePlan(plan) {
  if (!plan || !String(plan.name || '').trim()) return '请给这次行程起一个名称。'
  if (!validDate(plan.startDate)) return '请填写有效的出发日期。'
  if (!plan.source || !plan.source.id || ['local', 'route', 'activity'].indexOf(plan.source.kind) < 0) return '缺少路线来源，请重新选择路线。'
  if (!Array.isArray(plan.visits) || !plan.visits.length || plan.visits.length > MAX_VISITS) return '每个行程需保留 1–40 次经过。'
  const ids = new Set()
  let previous = -1
  for (const visit of plan.visits) {
    if (!visit.id || !visit.pointId || ids.has(visit.id)) return '经过标识重复或不完整，请重新添加节点。'
    ids.add(visit.id)
    if (!Number.isInteger(visit.day) || visit.day < 1 || visit.day > 30) return '请选择第 1–30 天。'
    if (visit.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(visit.time)) return '预计时刻格式应为 HH:mm；不确定可留空。'
    const minute = visit.time ? Number(visit.time.slice(0, 2)) * 60 + Number(visit.time.slice(3)) : null
    const lower = (visit.day - 1) * 1440 + (minute === null ? 0 : minute)
    if (minute !== null && lower < previous) return '经过顺序与日期或时间相反，请调整天数、时间或顺序。'
    if (minute === null && (visit.day * 1440 - 1) < previous) return '经过的天数顺序相反，请调整顺序。'
    previous = Math.max(previous, lower)
  }
  return ''
}

function resolveVisits(plan, route, browsing) {
  const points = (route && route.points) || []
  return plan.visits.map(visit => {
    const point = points.find(candidate => candidate.id === visit.pointId)
    const planned = !!visit.time
    const date = planned ? addDays(plan.startDate, visit.day - 1) : browsing.date
    const time = planned ? visit.time : browsing.time
    const coordinates = point && (point.coordinates || { lat: point.lat, lng: point.lng })
    const available = !!(coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng))
    return Object.assign({}, visit, {
      name: point ? (point.name || visit.name) : visit.name,
      point: point || null, coordinates: coordinates || null, available,
      planned, date, time, dayLabel: '第 ' + visit.day + ' 天',
      actionLabel: visit.departure ? '出发' : '抵达',
      timeLabel: planned ? '计划' + (visit.departure ? '出发 ' : '抵达 ') + date + ' ' + time : '未安排 · 浏览 ' + date + ' ' + time,
      issue: !point ? '路线已移除此节点，请替换或移除这次经过。' : !available ? '节点缺少坐标，暂不能查询。' : '',
    })
  })
}

function hourlySummary(result, date, time) {
  if (!result || result.status !== 'ready') return { text: result && result.status === 'out_of_range' ? '尚未进入预报范围，临近出行再查。' : '暂未取得预报，请重试。', ready: false }
  const hour = (time || '00:00').slice(0, 2) + ':00'
  const row = (result.series || []).find(item => item.d === date && item.t === hour)
  if (!row) return { text: '此时刻没有逐时数据，不用日汇总代替。', ready: false }
  const number = value => Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '—'
  return {
    ready: true, text: F.weatherPhrase(row.code).label + ' · ' + number(row.temp) + '°C · 降水 ' + number(row.precip) + ' mm · 风 ' + number(row.wind) + ' km/h',
    stamp: '参考 ' + date + ' ' + hour + ' 逐时值 · ' + (result.stale ? '旧缓存 ' : '更新 ') + F.dtFull(result.stale ? result.staleAt : result.updatedAt),
  }
}

function createStore(storage) {
  function list(key) { const value = storage.get(key); return Array.isArray(value) ? copy(value) : [] }
  return {
    list() { return list(KEY).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))) },
    get(id) { return list(KEY).find(plan => plan.id === id) || null },
    save(plan) {
      const error = validatePlan(plan)
      if (error) return { ok: false, error }
      const plans = list(KEY)
      const index = plans.findIndex(item => item.id === plan.id)
      if (index < 0 && plans.length >= CAP) return { ok: false, error: '最多保存 20 个行程，请先删除不需要的行程。' }
      const saved = Object.assign(copy(plan), { name: plan.name.trim(), updatedAt: new Date().toISOString() })
      if (index < 0) plans.push(saved)
      else plans[index] = saved
      try { storage.set(KEY, plans) } catch (err) { return { ok: false, error: '本机存储失败，行程尚未保存，请清理空间后重试。' } }
      return { ok: true, plan: saved }
    },
    remove(id) { storage.set(KEY, list(KEY).filter(plan => plan.id !== id)) },
    references(kind, id) { return list(KEY).filter(plan => plan.source.kind === kind && plan.source.id === id) },
    recent() { return list(RECENT_KEY) },
    remember(point) {
      const id = point.lat.toFixed(5) + ',' + point.lng.toFixed(5)
      const items = list(RECENT_KEY).filter(item => item.id !== id)
      items.unshift(Object.assign({}, point, { id, viewedAt: new Date().toISOString() }))
      try { storage.set(RECENT_KEY, items.slice(0, 8)) } catch (err) { return false }
      return true
    },
  }
}

module.exports = { createStore, createPlan, newVisit, resolveVisits, hourlySummary, validatePlan, validDate, addDays, newId, CAP, MAX_VISITS }
