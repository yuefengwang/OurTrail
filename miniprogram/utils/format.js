// 时间与文案格式化：一律北京时间（UTC+8），与原型一致。
'use strict'

const pad = n => String(n).padStart(2, '0')
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

// ISO（含时区）→ 北京时间 Date 毫秒
const cnMs = iso => Date.parse(iso) + (new Date(iso).getTimezoneOffset() === -480 ? 0 : 0)

// 直接用 Date.parse + 8h 偏移格式化，避免依赖系统时区
function cnParts(iso) {
  const d = new Date(Date.parse(iso) + 8 * 3600000)
  return {
    y: d.getUTCFullYear(),
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    weekday: d.getUTCDay(),
  }
}

// 'MM/DD 周X'（活动卡日期行）
function dateLabel(iso) {
  if (!iso) return '日期待定'
  const p = cnParts(iso)
  return `${p.date.slice(5, 7)}/${p.date.slice(8, 10)} 周${WEEK[p.weekday]}`
}

// 'M/D HH:mm'（详情时间）
function dtLabel(iso) {
  if (!iso) return '待确定'
  const p = cnParts(iso)
  return `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8, 10))} ${p.time}`
}

// 'YYYY-MM-DD HH:mm'（通知、列表）
function dtFull(iso) {
  if (!iso) return '时间待定'
  const p = cnParts(iso)
  return `${p.date} ${p.time}`
}

// datetime picker 用的本地串（北京时间）：'YYYY-MM-DDTHH:mm'
function toPickerDT(iso) {
  if (!iso) return ''
  return cnParts(iso).date + 'T' + cnParts(iso).time
}

// 'YYYY-MM-DDTHH:mm' → '+08:00' ISO
function fromPickerDT(v) {
  return v ? v + ':00+08:00' : null
}

// 'YYYY-MM-DD'（北京时间今天）
function cnToday() {
  const d = new Date(Date.now() + 8 * 3600000)
  return d.toISOString().slice(0, 10)
}

// HH:mm（小时槽）
function hhmm(iso) {
  return cnParts(iso).time
}

// 相对截止提醒
function relativeDeadline(iso) {
  const diff = Date.parse(iso) - Date.now()
  if (diff <= 0) return '已截止'
  const h = Math.floor(diff / 3600000)
  if (h >= 48) return `剩 ${Math.floor(h / 24)} 天截止`
  if (h >= 1) return `剩 ${h} 小时截止`
  return `剩 ${Math.max(1, Math.floor(diff / 60000))} 分钟截止`
}

const PHASE_LABELS = { draft: '草稿', published: '行前准备', gathering: '正在集合', active: '正在同行', closing: '返程报平安', archived: '已归档', cancelled: '已取消' }
const STATUS_LABELS = { pending: '待审核', confirmed: '已确认', waitlisted: '候补中', rejected: '未通过', cancelled: '已取消', removed: '已移除' }
const DEPARTURE_LABELS = { unknown: '出发待核实', joined: '已随队', not_departed: '未出发', coordinating: '协调中' }
const INCIDENT_LABELS = { late: '迟到', withdrawal: '提前退出同行', injury: '伤病', other: '其他需要协助' }
const UNASSIGNED_LABELS = { no_vehicle: '尚无可用车辆', pickup_mismatch: '上车点不匹配', group_too_large: '整组人数超过可用容量', no_seat: '可用座位不足' }
/* ---------- 出行方式（参与者级语义） ----------
 * 键是域内的 Signup.trip.mode，不是活动级开关：同一场活动可以同时有 self 与 shared 的参与者。
 * 文案只在这里定义一次；页面/组件一律取这里的标签，既不再各写一份，
 * 也严禁反过来用文案判断业务状态（判断请读服务端投影的 tripMode / needsSeatAssignment）。 */
const TRIP_MODE_LABELS = { self: '自行前往', shared: '搭乘车辆' }
const TRIP_MODE_HINTS = { self: '我会自己到集合点', shared: '需要活动安排车辆' }
const TRIP_MODE_OPTIONS = [
  { value: 'self', label: TRIP_MODE_LABELS.self, hint: TRIP_MODE_HINTS.self },
  { value: 'shared', label: TRIP_MODE_LABELS.shared, hint: TRIP_MODE_HINTS.shared },
]
// 返程安排（Attendance.returnPlan.kind）。own 由出行方式派生，领队不能代为填写。
const RETURN_PLAN_LABELS = { assigned: '原车返程', independent: '另行返程', own: '自行往返' }
// shared 参与者的上车点被改名/删除时给的话，不是「自行前往」——出行方式没有变。
const PICKUP_MISSING = '上车点信息缺失'
const DETAIL_STATE_TITLES = {
  new: ['让我们，一起出发', '阅读路线与风险提示，准备好后提交报名。'],
  pending: ['报名已收到', '组织者正在确认安排，审核结果会更新在这里。'],
  confirmed: ['已确认，等待车辆安排', '你的名额已确认；需要乘车的人会随名单一起排定车辆与座位。'],
  ready: ['行前安排已就绪', '检查集合时间、出行方式与装备，出发当天见。'],
  gathering: ['到集合点了吗？', '到达后主动签到，让领队知道你已到场。'],
  checked: ['签到完成，等你同行', '签到不等于已上车，请留意现场清点与出发安排。'],
  active: ['山野之间，彼此照应', '按节点确认进度；需要帮助或提前退出，请主动报备。'],
  closing: ['最后一程，记得报平安', '安全到家后为自己确认；同行人需有独立代理授权。'],
  finished: ['一起走过，平安收尾', '活动已归档，安排仅供回看。'],
  waitlist: ['你在候补队列中', '有空余名额后由组织者递补；候补不占正式名额。'],
  closed: ['本次报名已关闭', '活动安排仍可查看，暂不能提交新的报名。'],
  cancelled: ['活动已取消', '不再执行行程；费用与退改请在线下向组织者确认。'],
}

function usable(vehicle) {
  return vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats
}

// 11 位演示手机号校验（000 开头或 1 开头均可提交，格式仅限 11 位数字）
function validPhone(p) {
  return /^\d{11}$/.test(p || '')
}

// WMO weather_code → 简字徽标 + tone（文字承载语义，不引入图标资源；转译规则见天气设计文档 §5.2）
const WMO_CODES = [
  { max: 0, label: '晴', tone: 'success' },
  { max: 2, label: '多云', tone: 'success' },
  { max: 3, label: '阴', tone: 'neutral' },
  { max: 48, label: '雾', tone: 'warning' },
  { max: 57, label: '毛毛雨', tone: 'warning' },
  { max: 67, label: '雨', tone: 'warning' },
  { max: 77, label: '雪', tone: 'danger' },
  { max: 82, label: '阵雨', tone: 'warning' },
  { max: 86, label: '阵雪', tone: 'danger' },
  { max: 99, label: '雷暴', tone: 'danger' },
]

function weatherPhrase(code) {
  const c = Number(code)
  if (!Number.isFinite(c)) return { label: '—', tone: 'neutral' }
  const item = WMO_CODES.find(w => c <= w.max) || WMO_CODES[WMO_CODES.length - 1]
  return { label: item.label, tone: item.tone }
}

// 风向（度，自北顺时针）→ 八向文案（V2 Timeline 浮条与 Numbers 用）。
// 缺失/非法返回 null，调用方显示 '—'——单字段缺失不致整页失败。
// 注意 Number(null)=0、Number('')=0，必须先判空再转数字，否则「缺数据」会被读成「北风」。
const WIND_DIR_NAMES = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
function windDirText(deg) {
  if (deg === null || deg === undefined || deg === '') return null
  const d = Number(deg)
  if (!Number.isFinite(d)) return null
  return WIND_DIR_NAMES[Math.round((((d % 360) + 360) % 360) / 45) % 8] + '风'
}

/**
 * 自 00:00 起的分钟数 → 'HH:mm'。
 *
 * 与 `hhmm(iso)` 配对使用：`hhmm` 收 ISO instant，这个收「当日分钟数」。
 * 存在这里而不是散在组件里，是因为本项目的时间格式化都收敛在本文件
 * （不另开第二个日期库）。反向解析用 `utils/sky.js` 的 `hourMin`。
 */
function minutesLabel(mins) {
  const v = Number(mins)
  if (!isFinite(v)) return '--:--'
  const m = ((Math.round(v) % 1440) + 1440) % 1440
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60)
}

module.exports = {
  pad, WEEK, cnParts, dateLabel, dtLabel, dtFull, toPickerDT, fromPickerDT, cnToday, hhmm,
  minutesLabel, relativeDeadline, PHASE_LABELS, STATUS_LABELS, DEPARTURE_LABELS, INCIDENT_LABELS,
  UNASSIGNED_LABELS, TRIP_MODE_LABELS, TRIP_MODE_HINTS, TRIP_MODE_OPTIONS, RETURN_PLAN_LABELS,
  PICKUP_MISSING, DETAIL_STATE_TITLES, usable, validPhone, weatherPhrase, windDirText,
}
