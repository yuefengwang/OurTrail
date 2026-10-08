// 纯工具函数，不依赖 wx，可在 Node 下直接测试。
const pad = n => String(n).padStart(2, '0')
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 北京时间（UTC+8）字符串，不受手机系统时区影响
const cnParts = ms => {
  const d = new Date(ms + 8 * 3600000)
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  }
}
const cnTodayStr = () => cnParts(Date.now()).date
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const fmtDT = d => `${fmtDate(d)} ${fmtTime(d)}`
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

// 这里曾有第二份 relativeDeadline（与 format.js 逐字节相同、与 journey.remaining 同语义）。
// 倒计时只有 utils/journey.js 一个出处：两处实现迟早给出一句不同的话术。

function maskPhone(p) {
  return p && p.length === 11 ? `${p.slice(0, 3)}****${p.slice(7)}` : (p || '')
}

function maskId(id) {
  return id && id.length >= 8 ? `${id.slice(0, 4)}${'*'.repeat(id.length - 8)}${id.slice(-4)}` : (id || '')
}

// 两点球面距离（公里）
function distanceKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some(v => typeof v !== 'number')) return null
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLng = (bLng - aLng) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const pickupName = (act, id) => ((act.pickupPoints || []).find(p => p.id === id) || {}).name || '未指定'
const carName = (act, id) => ((act.cars || []).find(c => c.id === id) || {}).name || ''

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 复制到剪贴板的名单（制表符，可直接粘贴进 Excel / 群里）
function buildRosterTsv(act, roster) {
  const head = ['称呼', '电话', '上车点', '车辆', '座位', '状态', '签到', '备注']
  const rows = (roster || []).map(s => [
    s.name + (s.proxy ? '(代)' : ''),
    maskPhone(s.phone),
    pickupName(act, s.pickupPointId),
    carName(act, s.carId) || (s.status === 'active' ? '未分车' : ''),
    s.seatNo || '',
    s.status === 'active' ? '报名中' : '已取消',
    s.checkedIn ? '已到' : '',
    s.remark || ''
  ])
  return [act.title, `${act.date}${act.days > 1 ? ` 起 ${act.days} 天` : ''}`, '', ''].join('\t') + '\n' +
    [head, ...rows].map(r => r.join('\t')).join('\n')
}

// 导出用 CSV（含完整电话与身份证，供买保险等用途），带 BOM，Excel 可直接打开
function buildRosterCsv(act, roster) {
  const head = ['称呼', '代报', '电话', '紧急联系人', '紧急电话', '身份证号', '上车点', '车辆', '座位', '状态', '已签到', '是否到家', '报备', '备注']
  const rows = (roster || []).map(s => [
    s.name,
    s.proxy ? '是' : '',
    s.phone || '',
    s.emergencyName || '',
    s.emergencyPhone || '',
    s.idNumber || '',
    pickupName(act, s.pickupPointId),
    carName(act, s.carId),
    s.seatNo || '',
    s.status === 'active' ? '报名中' : '已取消',
    s.checkedIn ? '是' : '',
    s.homeSafe ? '是' : '',
    (s.reports || []).map(r => `${r.type}${r.text ? ':' + r.text : ''}`).join(' / '),
    s.remark || ''
  ])
  return '\uFEFF' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
}

// WMO 天气代码 → 中文描述
const WMO = {
  0: '晴', 1: '大部晴', 2: '局部多云', 3: '阴', 45: '雾', 48: '冻雾',
  51: '毛毛雨', 53: '毛毛雨', 55: '密毛毛雨', 56: '冻毛毛雨', 57: '冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '阵雨', 81: '强阵雨', 82: '暴阵雨', 85: '阵雪', 86: '阵雪',
  95: '雷暴', 96: '雷暴冰雹', 99: '强雷暴'
}
const wmoText = code => WMO[code] != null ? WMO[code] : '—'

const REPORT_TYPE = { late: '迟到', lag: '掉队', exit: '提前下撤', other: '其他' }
const reportText = type => REPORT_TYPE[type] || type

module.exports = {
  pad, fmtDate, fmtTime, fmtDT, WEEK, cnParts, cnTodayStr,
  maskPhone, maskId, distanceKm,
  pickupName, carName, buildRosterTsv, buildRosterCsv,
  wmoText, reportText
}
