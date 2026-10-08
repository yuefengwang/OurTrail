// 状态可解释性层（唯一出处）：把服务端投影翻译成用户能直接读懂的四件事——
// 我在哪里 / 现在是什么状态 / 我现在能做什么 / 下一步是什么。
//
// 为什么存在：本项目原先有**三套**阶段词汇（format.PHASE_LABELS、workspace.SUBTITLES、util.js 的
// '报名中'）、两套报名状态词汇（format.STATUS_LABELS 与 roster-panel 自己写的筛选文案），
// 并且全库**没有任何倒计时**（format.relativeDeadline 写好了却零调用）。用户看到的是「这个活动怎么了」，
// 而不是「我下一步做什么」。这里收成一个纯函数层，页面只做渲染。
//
// 三条约束：
// 1. **不新增任何 domain 状态**。时间线/下一步都只是现有 phase / detailState / 行标志的 UI 投影。
// 2. **文案仍在 format.js 定义一次**，本模块只负责「在什么情况下说哪句」，不另起一套词。
// 3. wx-free：这样 tools/journey-test.js 能在纯 Node 下 require 它（utils 纯度规则）。
'use strict'

const F = require('./format')

const PHASE_ORDER = ['published', 'gathering', 'active', 'closing', 'archived']

/* ---------- 阶段 → 用户语言 ---------- */

// label 一律取 format.PHASE_LABELS，这里只补「这一刻在发生什么」与语气。
const PHASE_SCENE = {
  draft: { tone: 'neutral', scene: '草稿还没发布，只有你自己看得到。' },
  published: { tone: 'success', scene: '正在等大家报名与确认。' },
  gathering: { tone: 'warning', scene: '集合时段：要看到人到没到、谁随队出发。' },
  active: { tone: 'success', scene: '行程进行中：路线与人员状态是当下的重点。' },
  closing: { tone: 'warning', scene: '返程收尾：逐人确认到家，异常要闭环。' },
  archived: { tone: 'neutral', scene: '已归档，安排仅供回看。' },
  cancelled: { tone: 'warning', scene: '已取消，不再执行行程。' },
}

/** 阶段的中文标签。绝不允许把 published / gathering 这类枚举直接印到界面上。 */
function phaseLabel(phase) {
  return F.PHASE_LABELS[phase] || '安排整理中'
}
function phaseScene(phase) {
  return (PHASE_SCENE[phase] || PHASE_SCENE.published).scene
}
function phaseTone(phase) {
  return (PHASE_SCENE[phase] || PHASE_SCENE.published).tone
}

/** 报备类型选项：文案取 INCIDENT_LABELS（此前 activity 页自己重打了四份，已经和它并行走偏）。 */
const INCIDENT_ORDER = ['other', 'late', 'withdrawal', 'injury']
function incidentOptions() {
  return INCIDENT_ORDER.map(value => ({ value, label: F.INCIDENT_LABELS[value] || value }))
}

/** 报名状态标签（含筛选器用的「全部」）——roster-panel 曾自己写一份并已经和这里漂移。 */
function signupLabel(status) {
  return F.STATUS_LABELS[status] || status
}
function statusFilterOptions() {
  return [{ value: 'all', label: '全部状态' }].concat(
    Object.keys(F.STATUS_LABELS).map(value => ({ value, label: F.STATUS_LABELS[value] })))
}

/* ---------- 时间：把绝对时间之外的那句「还有多久」补上 ---------- */

const MIN = 60000
const HOUR = 3600000
const DAY = 86400000

/**
 * 剩余时间的口语化读数。户外场景的判据是「一眼看懂优先于信息完整」，
 * 所以只给一个主单位，不堆「1 天 3 小时 20 分」。
 * @returns {{text:string, overdue:boolean, soon:boolean, days:number}}
 */
function remaining(nowIso, atIso) {
  if (!atIso) return { text: '时间待定', overdue: false, soon: false, days: Infinity }
  const ms = Date.parse(atIso) - Date.parse(nowIso)
  if (!Number.isFinite(ms)) return { text: '时间待定', overdue: false, soon: false, days: Infinity }
  if (ms < 0) return { text: '已过时', overdue: true, soon: false, days: -1 }
  const mins = Math.floor(ms / MIN)
  if (mins < 1) return { text: '就在眼前', overdue: false, soon: true, days: 0 }
  if (mins < 60) return { text: '剩 ' + mins + ' 分钟', overdue: false, soon: true, days: 0 }
  const hours = Math.floor(ms / HOUR)
  if (hours < 24) return { text: '剩 ' + hours + ' 小时', overdue: false, soon: hours <= 6, days: 0 }
  const days = Math.floor(ms / DAY)
  return { text: '剩 ' + days + ' 天', overdue: false, soon: days <= 1, days }
}

/** 「今天 07:30」这种带日期的时刻前缀：当天/明天说人话，其余说日期。 */
function dayPrefix(nowIso, atIso) {
  if (!atIso) return ''
  const at = F.cnParts(atIso)
  const now = F.cnParts(nowIso)
  if (at.date === now.date) return '今天'
  const ms = Date.parse(atIso) - Date.parse(nowIso)
  if (ms > 0 && ms < 2 * DAY && F.cnParts(new Date(Date.parse(nowIso) + DAY).toISOString()).date === at.date) return '明天'
  return at.date
}

/* ---------- 参与者的下一步 ---------- */

/**
 * ctx: { activityId, phase, detailState, now, primary(row|null), meetingAt, pickupName,
 *        startAt, deadlineAt, driverLabel, vehicleLabel, seatLabel, tripMode }
 * 返回 { status, statusTone, milestone, nextTitle, nextDetail, cta:{label,target}|null }
 */
function participantNext(ctx) {
  const state = ctx.detailState
  const label = {
    new: '还没报名', pending: '等你确认', waitlist: '在候补队列里',
    confirmed: '名额已确认', ready: '行前安排就绪', gathering: '该集合了', checked: '已签到，等你同行',
    active: '正在同行', closing: '返程与报平安', finished: '已结束', closed: '报名已关闭', cancelled: '活动已取消',
  }[state] || phaseLabel(ctx.phase)
  const tone = {
    new: 'info', pending: 'warning', waitlist: 'warning', gathering: 'warning', checked: 'warning',
    closing: 'warning', cancelled: 'warning', closed: 'warning', finished: 'neutral',
  }[state] || 'success'

  const start = remaining(ctx.now, ctx.startAt)
  const meeting = remaining(ctx.now, ctx.meetingAt)
  const deadline = remaining(ctx.now, ctx.deadlineAt)

  let milestone = ''
  if (state === 'new' && ctx.deadlineAt) milestone = '报名' + deadline.text + '截止（' + dayPrefix(ctx.now, ctx.deadlineAt) + ' ' + F.hhmm(ctx.deadlineAt) + '）'
  else if (ctx.meetingAt && ['new', 'pending', 'waitlist', 'confirmed', 'ready', 'gathering', 'closed'].indexOf(state) !== -1) {
    milestone = '集合 ' + meeting.text + '（' + dayPrefix(ctx.now, ctx.meetingAt) + ' ' + F.hhmm(ctx.meetingAt) + '）'
  } else if (ctx.startAt && ['active', 'closing'].indexOf(state) === -1) milestone = '出发 ' + start.text
  else if (state === 'closing') milestone = '返程报平安中'
  else if (state === 'active') milestone = '行程进行中'

  // 标题与说明仍然只写在 format.DETAIL_STATE_TITLES 一处；本层只补「状态标签 / 时间锚点 / 动作」，
  // 不另起第二套十二态文案——那正是这次要消灭的东西。
  const copy = F.DETAIL_STATE_TITLES[state] || ['', '']
  const nextTitle = copy[0] || '看看下一步做什么'
  const nextDetail = copy[1] || ''

  let cta = null
  if (state === 'new') cta = { label: '填写报名资料', target: 'signup' }
  else if (state === 'gathering') cta = { label: '我已到达 · 去签到', target: 'sheet' }
  // 已经签过的人不该再被提示「去签到」——那会让他在集合点重复点同一件事。
  else if (state === 'checked') cta = { label: '更新我的同行状态', target: 'sheet' }
  else if (state === 'active') cta = { label: '更新我的同行状态', target: 'sheet' }
  else if (state === 'closing') cta = { label: '确认返程与到家', target: 'sheet' }
  else if (state === 'confirmed' || state === 'ready') cta = { label: '查看集合与出行安排', target: 'meeting' }
  else if (state === 'pending' || state === 'waitlist') cta = { label: '查看我的报名', target: 'meeting' }
  // 终态也要留一条出路：只写「已结束 / 已取消」而不给下一步，用户会以为页面坏了。
  else if (state === 'finished') cta = { label: '回看这场的安排与通知', target: 'meeting' }
  else if (state === 'closed' || state === 'cancelled') cta = { label: '去看看别的活动', target: 'discover' }

  // 「怎么去」是参与者最高频的困惑：self 与 shared 必须各说各的，绝不给 self 摆车辆字段。
  // 活动已经取消/归档时不再宣称任何乘车安排——那时「你的车是哪辆」已经不是一个问题了。
  const terminal = ['cancelled', 'finished'].indexOf(state) !== -1
  const how = terminal ? '' : ctx.tripMode === 'self'
    ? '自行前往集合点，不占活动车辆。'
    : ctx.tripMode === 'shared'
      ? ['到点集合：' + (ctx.pickupName || F.PICKUP_MISSING)].concat(
        ctx.vehicleLabel ? ['车：' + ctx.vehicleLabel + (ctx.seatLabel ? ' · ' + ctx.seatLabel + ' 座' : '')] : ['车辆待领队安排'],
        ctx.driverLabel ? ['司机：' + ctx.driverLabel] : []
      ).join(' ')
      : ''

  return {
    state, status: label, statusTone: tone, milestone,
    nextTitle, nextDetail, how, cta,
  }
}

/* ---------- 领队的下一步（工作台与详情共用） ---------- */

const METRIC_CHECKIN = '待签到'
const METRIC_HOME = '待到家'
// 「搭乘车辆」是出行方式的名称；「需要乘车」是领队欠下的那件事。两者不能混用一个词，
// 否则自行前往的人会以为自己也在待办里。
const NEED_VEHICLE = '需要乘车'

/**
 * ctx: { phase, now, counters:{...}, startAt, deadlineAt, meetingAt, vehicleTravel }
 * 返回按「是否阻塞出发/归档」排好序的待办；每条都带跳向哪个分区。
 */
function leaderQueue(ctx) {
  const c = ctx.counters || {}
  const items = []
  if (ctx.phase === 'draft') {
    items.push({ id: 'publish', label: '补齐并发起活动', detail: '草稿需要完整的时间、集合点、路线与风险说明才能发布。', target: 'edit', blocking: true })
    return { items, primary: items[0] || null, milestone: '还没发布，别人看不到这场活动' }
  }
  if (c.pending) items.push({ id: 'review', label: '确认报名', detail: c.pending + ' 人待审核' + (c.waitlisted ? '，候补 ' + c.waitlisted + ' 人' : '') + '。', target: 'roster', blocking: true })
  if (ctx.vehicleTravel && c.unassigned) items.push({ id: 'transport', label: '安排车辆与座位', detail: c.unassigned + ' 人' + NEED_VEHICLE + '但还没有安排。', target: 'transport', blocking: true })
  if (c.unchecked) items.push({ id: 'checkin', label: '现场清点签到', detail: c.unchecked + ' 人还没签到。', target: 'field', blocking: ctx.phase === 'gathering' })
  if (c.openIncidents) items.push({ id: 'incident', label: '处理异常报备', detail: c.openIncidents + ' 项异常待闭环。', target: 'field', blocking: true })
  if (c.pendingHome) items.push({ id: 'home', label: '逐人确认到家', detail: c.pendingHome + ' 人已随队出行但还没报平安。', target: 'field', blocking: true })
  if (!items.length) items.push({ id: 'idle', label: '暂时没有拦路的事', detail: phaseScene(ctx.phase), target: 'roster', blocking: false })
  let milestone = ''
  if (ctx.deadlineAt && ctx.phase === 'published') {
    const r = remaining(ctx.now, ctx.deadlineAt)
    milestone = '报名' + r.text + '截止 · ' + dayPrefix(ctx.now, ctx.deadlineAt) + ' ' + F.hhmm(ctx.deadlineAt)
  } else if (ctx.meetingAt && ctx.phase === 'published') milestone = '集合 ' + dayPrefix(ctx.now, ctx.meetingAt) + ' ' + F.hhmm(ctx.meetingAt)
  else if (ctx.startAt) milestone = '出发 ' + dayPrefix(ctx.now, ctx.startAt) + ' ' + F.hhmm(ctx.startAt) + ' · ' + remaining(ctx.now, ctx.startAt).text
  return { items, primary: items[0], milestone }
}

/**
 * 出行方式构成行。领队要处理的只有「需要乘车且还没排到车」那一格：
 * 自行前往的人不是缺事项，不能和他们混进同一个数字里。
 */
function tripMixLine(c) {
  c = c || {}
  return '全部已确认 ' + (c.confirmed || 0)
    + ' · ' + F.TRIP_MODE_LABELS.self + ' ' + (c.selfTravel || 0)
    + ' · ' + NEED_VEHICLE + ' ' + (c.vehicleTravel || 0)
    + '（已安排 ' + (c.assigned || 0) + '）'
}

/** 第三个指标位随阶段换焦点：在场上看「待签到」，返程收尾看「待到家」。 */
function fieldMetric(phase) {
  return phase === 'published' || phase === 'gathering'
    ? { key: 'unchecked', label: METRIC_CHECKIN }
    : { key: 'pendingHome', label: METRIC_HOME }
}

/**
 * 排车只发生在「出发之前」。服务端 transport.js 对 active 之后的一切写都回 WRONG_PHASE，
 * 所以这里给出同一句话的读者版：按钮该收就收，但必须说明为什么收、去哪儿处理。
 * 返回 '' 表示仍可安排车辆。
 */
function transportLock(phase) {
  if (phase === 'active' || phase === 'closing') {
    return '行程' + (phase === 'active' ? '进行中' : '已进入返程') + '，车辆与乘车安排改为只读。谁上车、谁另行返程，请在「现场」区逐人核实。'
  }
  if (phase === 'archived' || phase === 'cancelled') {
    return '这场活动已经结束，乘车安排仅供回看，不能再修改。'
  }
  return ''
}

const TRANSITION_LABEL = {
  gathering: '开始集合', active: '确认出发', closing: '结束行程，进入返程', archived: '安全收尾并归档', cancelled: '取消这场活动',
}
/** 阶段推进的服务端门槛 → 人话的「为什么现在不能按」。 */
function transitionBlocker(ctx) {
  const c = ctx.counters || {}
  if (ctx.next === 'gathering' && c.pending) return c.pending + ' 人还在待审核，先给个结果再开始集合。'
  if (ctx.next === 'active' && (c.unresolved || c.unchecked)) return '还有人没有签到或没有给出出发结论，逐人核实后才能出发。'
  if (ctx.next === 'active' && ctx.unassignedBoarding) return ctx.unassignedBoarding + ' 位' + NEED_VEHICLE + '的人还没有「上车」事实，请先到车长任务页清点。'
  if (ctx.next === 'archived' && c.openIncidents) return c.openIncidents + ' 项异常还没有闭环。'
  if (ctx.next === 'archived' && c.pendingHome) return c.pendingHome + ' 人还没确认到家。'
  if (ctx.next === 'archived' && ctx.coordinating) return ctx.coordinating + ' 人的出发情况还停在「协调中」，先给出定论。'
  if (ctx.next === 'cancelled' && ctx.hasTravelFact) return '已经有人上车或出发了，活动不能再取消；请改走现场异常与返程收尾。'
  return ''
}

/**
 * 时间线的每个节点标成 ✓ / ● / ○。
 * 户外强光下不能只靠色相区分状态，所以形状 + 文字标记是必须的，颜色只是加强。
 */
function timeline(now, phase, labels) {
  const order = labels || PHASE_ORDER
  const at = order.indexOf(phase)
  return order.map((p, i) => ({
    phase: p,
    label: phaseLabel(p),
    current: p === phase,
    done: phase === 'archived' ? true : (at >= 0 && i < at),
    mark: phase === 'cancelled' ? '·' : (at >= 0 && i < at) || phase === 'archived' ? '✓' : (i === at ? '●' : '○'),
  }))
}

/**
 * 「正在保存」是个界面姿态，不是业务状态。某条写命令的 promise 没能回来时，
 * 它绝不能把整块面板永久锁成「看着能点、点了没反应」（真机实测：一个残留的 busy=true
 * 锁死了组织者工作台的整条分车链）。超过这个宽限期就认定它是残留。
 */
const BUSY_LIMIT_MS = 8000
function busyStale(busyAt, nowMs) {
  if (!busyAt) return true
  return (nowMs || Date.now()) - busyAt > BUSY_LIMIT_MS
}
/* ---------- 错误 / 权限 / 禁用：把服务端规则翻成「为什么 + 怎么办」 ---------- */

const CODE_TITLES = {
  AUTH_REQUIRED: '先登录微信，再继续这一步',
  CONFLICT: '这条安排刚被别人改过',
  WRONG_PHASE: '现在还不能做这一步',
  UNRESOLVED_DEPARTURE: '还不能出发',
  UNRESOLVED_SAFETY: '安全收尾还没完成',
  VEHICLE_FULL: '这辆车的座位不够',
  SEAT_TAKEN: '这个座位已经有人了',
  PICKUP_MISMATCH: '车不经过这个上车点',
  DRIVER_CONFLICT: '司机安排有冲突',
  GROUP_SCOPE: '同行组要坐同一辆车',
  CAPACITY: '名额不够',
  DUPLICATE_PERSON: '这个人已经在名单里了',
  CONSENT_REQUIRED: '需要本人同意',
  FORBIDDEN: '这件事只有该做的人能操作',
  NOT_FOUND: '要找的记录不在了',
  STORAGE_UNAVAILABLE: '这次修改没有保存',
  NETWORK: '网络没接上',
  NO_REVISION: '页面还没读到最新安排',
  INVALID_INPUT: '还差一点信息',
  REQUEST_REUSED: '这条请求已经用于别的内容',
  OFFLINE: '现在没有网络',
  CORRUPT_SNAPSHOT: '本地数据与云端不一致',
}

/**
 * err: {code,message}；ctx: {counters,next,tab hints}
 * 返回 {title, cause, action:{label,target}|null}。
 * 服务端的 message 保留在 cause 里：它已经写得相当具体，我们不覆盖它，只是补一句「去哪儿解决」。
 */
function explain(err, ctx) {
  const code = (err && err.code) || ''
  const message = (err && err.message) || ''
  const c = (ctx && ctx.counters) || {}
  let cause = message || '操作没有完成。'
  let action = null
  if (code === 'CONFLICT') cause = '有人在你之前更新了这份安排，页面已经重新读取。请把刚才的修改再做一次。'
  else if (code === 'UNRESOLVED_DEPARTURE' && ctx && ctx.next === 'active') {
    cause = '还有 ' + (c.unchecked || 0) + ' 人没签到、' + (c.unassigned || 0) + ' 人没安排车辆，出发要逐人给出结论。'
    action = { label: '查看待清点的人', target: 'field' }
  } else if (code === 'UNRESOLVED_SAFETY') {
    cause = '归档前要全员报平安、异常全部闭环：当前 ' + (c.pendingHome || 0) + ' 人' + METRIC_HOME + '、' + (c.openIncidents || 0) + ' 项异常未闭环。'
    action = { label: '去安全收尾', target: 'field' }
  } else if (code === 'WRONG_PHASE' && /取消/.test(message)) action = { label: '看有哪些人已出行', target: 'field' }
  else if (code === 'VEHICLE_FULL' || code === 'SEAT_TAKEN' || code === 'PICKUP_MISMATCH' || code === 'DRIVER_CONFLICT') {
    action = { label: '回分车区调整', target: 'transport' }
  } else if (code === 'CAPACITY' || code === 'DUPLICATE_PERSON') action = { label: '看名单', target: 'roster' }
  else if (code === 'NETWORK' || code === 'OFFLINE') cause = '这一条没有发到云端，原安排没被改动。到信号好的地方再试一次。'
  else if (code === 'STORAGE_UNAVAILABLE') cause = message || '这次修改没有保存，原安排未改变。'
  else if (code === 'NO_REVISION') cause = '页面还没读到这份安排，重新打开活动后再试。'
  return { title: CODE_TITLES[code] || '这一步没有完成', cause, action }
}

/** 按钮被禁用时的说明文案（宁可写一行字，也不要让用户对着一排灰按钮猜）。 */
function disabledReason(why) {
  return why ? '现在不能点：' + why : ''
}

module.exports = {
  PHASE_ORDER, phaseLabel, phaseScene, phaseTone, signupLabel, statusFilterOptions, incidentOptions,
  remaining, dayPrefix, participantNext, leaderQueue, transitionBlocker, timeline,
  tripMixLine, fieldMetric, transportLock,
  explain, disabledReason, busyStale, BUSY_LIMIT_MS, TRANSITION_LABEL,
}
