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

/* ---------- 海拔语义（2026-10-09 Weather V2 审计 §五） ----------
 * 天气页拿到的海拔永远不是「用户脚下的海拔」：本项目没有任何 wx.getLocation 路径，
 * 数值只有四个出处——GPX 记录的高程点、地图选点的地形高程、用户手填，
 * 以及 Open-Meteo 返回的模型地形高度（±300–600 m）。
 * 所以剖面参考线的主体只能是「此点」；模型来源还必须显式标注，
 * 否则一个估算值会以测量值的口气出现在决策界面上。
 * 方向仍然只允许 domain → projection → label：文案在此定义一次，两处渲染器共用。 */
const ELEV_SUBJECT = '此点'
const ELEV_SOURCE_LABELS = { gpx: 'GPX 记录', picked: '地图选点', manual: '手动填写', model: '模型地形估算' }
const ELEV_MODEL_SUFFIX = '（模型估算）'
function elevSourceLabel(source) { return ELEV_SOURCE_LABELS[source] || ELEV_SOURCE_LABELS.manual }
/**
 * 海拔出处判定（唯一权威，页面不许再写一份）：
 * 点自己有高程（GPX 记录 / 地图选点 / 手填）⇒ 用点的值并带该出处；
 * 点没有高程而天气返回体带模型地形高度 ⇒ 用模型值并记 source='model'（图上必须显式标注）；
 * 两者都没有 ⇒ elevation=null，调用方不得显示任何确定数值。
 */
/** 出处 → 判定基准的唯一映射（渲染层没有 opts.basis 时也只能调它，不许再抄一份三元式） */
function elevBasis (source) { return source === 'model' ? 'estimated' : source ? 'measured' : 'none' }
function resolveElev(pointEle, pointEleSource, modelEle) {
  const hasEle = Number.isFinite(pointEle)
  const hasModel = Number.isFinite(modelEle)
  if (hasEle) {
    const s = pointEleSource === 'gpx' || pointEleSource === 'picked' ? pointEleSource : 'manual'
    return { elevation: pointEle, source: s, ok: true, basis: elevBasis(s) }
  }
  if (hasModel) return { elevation: modelEle, source: 'model', ok: false, basis: elevBasis('model') }
  return { elevation: null, source: null, ok: false, basis: elevBasis(null) }
}
/** @param altText 已按各自千分位格式化好的数字；@param source gpx|picked|manual|model */
function elevLineLabel(altText, source) {
  return ELEV_SUBJECT + ' ' + altText + ' m' + (source === 'model' ? ELEV_MODEL_SUFFIX : '')
}

/* 建议层（任务书 §八第三层）：只有「怎么做」的话，且必须挂在有依据可核对的那张卡上。
 * 原来这句建议写死在 weather.wxml 里（受管中文文案的第二处出处，违反铁律 22），
 * 而且对所有 featured 卡说同一句。现在按现象逐条给，页面只查表。 */
const PHENO_ADVICE = {
  cloudSea: '想在云顶之上看到云海，需在窗口结束前抵达高于云带的观景点。',
}
function phenoAdvice (key) { return PHENO_ADVICE[key] || '' }

/* ---------- 云层位置三态（2026-10-09 语义统一轮） ----------
 * 主语永远是**查询点**（地图选点 / 手填坐标 / 路线节点），不是「你」：
 * 本项目没有任何定位来源，永远不知道用户本人站在哪儿（见 resolveElev 上方注释）。
 * 判定逻辑不在这里——那属于 `cloud-field-svg.inferState`（天气模型层），
 * 本文件只管「同一个状态只有一套中文」这一件事（根 AGENTS.md 铁律 22）。
 * key 沿用线上既有取值（'in'/'ok'/'mid'）：它们同时是 CSS 类名与账本字段，
 * 换 key 的爆炸半径远大于收益，故只统一词、不统一键。 */
const CLOUD_POSITION_LABELS = {
  in: '此点正处于云中',
  ok: '云带在此点下方',
  mid: '云层在此点上方',
}
/* 未归入三态时的原因词。三态是「有结论」，这几条是「没结论」——两者必须能分开，
 * 否则「证据不足」会被读成「晴空无云」。阈值数字不写在这里（判据只有一个出处：
 * cloud-field-svg.inferState），否则改阈值时这句解释会静默变成假话。 */
const CLOUD_POSITION_REASONS = {
  'no-altitude': '缺少可信海拔，未判断云与此点的上下关系',
  'no-data': '该高度范围没有实测层，未判断云与此点的上下关系',
  'within-uncertainty': '云顶/云底与此点的高差落在海拔误差带内，不足以判定上下',
  'both-sides': '此点上下都有浓云，不属于单一位置',
  'partial-at-point': '此点自身有中等云量，未判定云与它的高低关系',
  clear: '',
}
function cloudPositionLabel(key) { return CLOUD_POSITION_LABELS[key] || '' }
function cloudPositionReason(reason) {
  if (!reason) return ''
  return Object.prototype.hasOwnProperty.call(CLOUD_POSITION_REASONS, reason) ? CLOUD_POSITION_REASONS[reason] : ''
}

/* ---------- 剖面显示窗（2026-10-09 显示窗自适应轮） ----------
 * 「图上一片空白」有两种完全不同的原因：真的没云，和云整扇在画的那一段之外。
 * 裁切必须由图上自己说清楚，否则读者会把后者读成前者（判据见 probe-window.json 样本 1/2/5 与 6）。
 * 这些字符串只在这里定义，渲染层与页面图例都调它——显示窗一句话也不能有第二个出处（铁律 22）。 */
const CLOUD_WINDOW_NOTES = {
  'clipped-above': '窗外上方还有云带',
  'clipped-below': '窗外下方还有云带',
  'no-deck': '实测高度范围内没有有意义云量',
}
function cloudWindowNote(key) {
  if (!key) return ''
  return Object.prototype.hasOwnProperty.call(CLOUD_WINDOW_NOTES, key) ? CLOUD_WINDOW_NOTES[key] : ''
}
/** @param loText/hiText 已各自格式化好的整数海拔 */
function profileRangeLabel(loText, hiText) { return '剖面 ' + loText + '–' + hiText + ' m' }
/* 图例里「虚线 = 此点海拔」这一句：主语从 ELEV_SUBJECT 拼，图例与图上标签不可能各写一套主语；
   而且只在参考线真的画出来时才给（点在窗外时图上没有虚线，图例就不许说有）。 */
function cloudLegendElev() { return '虚线 = ' + ELEV_SUBJECT + '海拔' }
/* 完全没有可信高程时图例说这一句。真机取证抓到的原错：图例走「点在窗外」那一支，
   拼出「此点在剖面下方 null m」——把「不知道」又写成了一个数值（本轮明令不得重现的那一类）。 */
function cloudLegendNoElev() { return ELEV_SUBJECT + '海拔未知（未画参考线）' }
/** 查询点落在显示窗外时的说明——此时绝不把参考线钳在窗边冒充它的位置 */
function pointOutsideLabel(side, deltaText) { return ELEV_SUBJECT + '在剖面' + (side === 'above' ? '上方' : '下方') + ' ' + deltaText + ' m' }

module.exports = {
  pad, WEEK, cnParts, dateLabel, dtLabel, dtFull, toPickerDT, fromPickerDT, cnToday, hhmm,
  minutesLabel, relativeDeadline, PHASE_LABELS, STATUS_LABELS, DEPARTURE_LABELS, INCIDENT_LABELS,
  UNASSIGNED_LABELS, TRIP_MODE_LABELS, TRIP_MODE_HINTS, TRIP_MODE_OPTIONS, RETURN_PLAN_LABELS,
  PICKUP_MISSING, DETAIL_STATE_TITLES, usable, validPhone, weatherPhrase, windDirText,
  ELEV_SUBJECT, ELEV_SOURCE_LABELS, ELEV_MODEL_SUFFIX, elevSourceLabel, elevLineLabel, resolveElev, elevBasis,
  CLOUD_POSITION_LABELS, CLOUD_POSITION_REASONS, cloudPositionLabel, cloudPositionReason,
  CLOUD_WINDOW_NOTES, cloudWindowNote, profileRangeLabel, pointOutsideLabel, cloudLegendElev, cloudLegendNoElev,
  PHENO_ADVICE, phenoAdvice,
}
