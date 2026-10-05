// 「我的」页统计与最近活动的纯函数推导（docs/product/profile/03 §3.2）。
// wx-free：不引用 wx / api，输入是 home(participant) 视图的 activities
//（每场含 phase 与 meta.owner/meta.joined，selectors.js:274-287），输出供页面直接 setData。
// P1 落地 kind:'me' 后由服务端按同口径精确复算（06 §2），此模块随之退役或转为兜底。
'use strict'

// 进行中的判定与 03 §3.2 口径一致：招募中/集合中/进行中/收尾 且（我发起 或 我有当前有效报名）
const ONGOING_PHASES = ['published', 'gathering', 'active', 'closing']

function isOngoing(activity) {
  return ONGOING_PHASES.indexOf(activity.phase) !== -1
    && !!(activity.meta && (activity.meta.owner || activity.meta.joined))
}

function isFinished(activity) {
  return activity.phase === 'archived' && !!(activity.meta && (activity.meta.owner || activity.meta.joined))
}

/**
 * 统计三计数。activities 非数组（读取失败/视图不可用）时返回 null，页面据此隐藏指标行。
 * 口径注：P0 用 meta.owner‖meta.joined 近似；已归档活动中「曾报名但已取消」的场次不计入
 * finished——该偏差由 P1 服务端精确口径消除（03 §3.2 已声明接受 ±N 跳动）。
 */
function deriveMeStats(activities) {
  if (!Array.isArray(activities)) return null
  let ongoing = 0
  let finished = 0
  let organized = 0
  for (const activity of activities) {
    if (activity.meta && activity.meta.owner) organized += 1
    if (isOngoing(activity)) ongoing += 1
    if (isFinished(activity)) finished += 1
  }
  return { ongoing, finished, organized }
}

function startDistance(activity, nowMs) {
  if (!activity.startAt) return Infinity
  const startMs = Date.parse(activity.startAt)
  if (!Number.isFinite(startMs)) return Infinity
  return Math.abs(startMs - nowMs)
}

/**
 * 最近活动，最多 limit 条：进行中的优先，其余按 |startAt - now| 由近到远。
 * 输出 slim 行（不含 routeSnapshot）：{ id, title, startAt, phase }。
 */
function pickRecent(activities, nowMs, limit) {
  if (!Array.isArray(activities)) return []
  const cap = limit || 3
  const own = activities.filter(a => !!(a.meta && (a.meta.owner || a.meta.joined)))
  const ongoing = own.filter(isOngoing)
  const rest = own.filter(a => !isOngoing(a))
  const byStart = (a, b) => startDistance(a, nowMs) - startDistance(b, nowMs)
  ongoing.sort(byStart)
  rest.sort(byStart)
  return ongoing.concat(rest).slice(0, cap).map(a => ({
    id: a.id, title: a.title, startAt: a.startAt || '', phase: a.phase,
  }))
}

module.exports = { deriveMeStats, pickRecent, isOngoing, isFinished, ONGOING_PHASES }
