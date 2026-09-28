// 路线日程推算回归测试：node tools/route-schedule-test.js
// 验证"相对耗时 + 出发钟点对齐"的映射规则，以及无时间戳时不给提醒的降级行为。
'use strict'
const R = require('../miniprogram/utils/route-schedule')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

// 单日徒步：08:00 出发，轨迹锚点 06:30 记录，走 5 小时 20 分
const DAY1 = [
  { id: 'a', time: '2020-05-02T06:30:00+08:00' },
  { id: 'b', time: '2020-05-02T09:10:00+08:00' },
  { id: 'c', time: '2020-05-02T11:50:00+08:00' },
]
// 两日行程：第二天 09:20 记录（相对锚点 26 小时 50 分）
const TWO_DAY = [
  { id: 'a', time: '2020-05-02T06:30:00+08:00' },
  { id: 'b', time: '2020-05-02T16:00:00+08:00' },
  { id: 'c', time: '2020-05-03T09:20:00+08:00' },
]
const START = '2026-09-26T08:00:00+08:00'

section('1. 单日：钟点对齐后按相对耗时推算')
{
  const s = R.schedule(DAY1, START)
  check('锚点节点即出发时刻', s[0].dayIndex === 1 && s[0].arriveTime === '08:00', JSON.stringify(s[0]))
  check('第二个节点 08:00 + 2h40m = 10:40', s[1].arriveTime === '10:40', s[1].arriveTime)
  check('第三个节点 08:00 + 5h20m = 13:20', s[2].arriveTime === '13:20', s[2].arriveTime)
  check('全部为第 1 天', s.every(x => x.dayIndex === 1))
  check('抵达日期为出发日', s[2].arriveDate === '2026-09-26', s[2].arriveDate)
  check('耗时为相对差（2h40m = 160 分）', s[1].elapsedMin === 160, String(s[1].elapsedMin))
  check('选择器标签为「第1天 13:20」', R.nodeLabel(s[2]) === '第1天 13:20', R.nodeLabel(s[2]))
  check('跨天数为 1', R.spanDays(s) === 1)
}

section('2. 跨日：第二天节点标为第 2 天')
{
  const s = R.schedule(TWO_DAY, START)
  check('第二节点仍为第 1 天（出发后 9h30m = 17:30）', s[1].dayIndex === 1 && s[1].arriveTime === '17:30', JSON.stringify(s[1]))
  check('终点为第 2 天 10:50（相对锚点 26h50m）', s[2].dayIndex === 2 && s[2].arriveTime === '10:50', JSON.stringify(s[2]))
  check('终点抵达日期为次日', s[2].arriveDate === '2026-09-27', s[2].arriveDate)
  check('跨天数为 2', R.spanDays(s) === 2)
  check('标签为「第2天 10:50」', R.nodeLabel(s[2]) === '第2天 10:50', R.nodeLabel(s[2]))
}

section('3. 出发时刻跨越午夜：晚出发则起点已在夜里')
{
  // 轨迹锚点 06:30，活动 23:00 出发 → 第二个节点（+2h40m）落在次日 01:40
  const s = R.schedule(DAY1, '2026-09-26T23:00:00+08:00')
  check('锚点为第 1 天 23:00', s[0].dayIndex === 1 && s[0].arriveTime === '23:00', JSON.stringify(s[0]))
  check('第二节点跨到第 2 天 01:40', s[1].dayIndex === 2 && s[1].arriveTime === '01:40', JSON.stringify(s[1]))
  check('第三节点为第 2 天 04:20', s[2].dayIndex === 2 && s[2].arriveTime === '04:20', JSON.stringify(s[2]))
}

section('4. 未定出发时刻：只给相对耗时，不编日期')
{
  const s = R.schedule(DAY1, null)
  check('known 为真', s.every(x => x.known))
  check('dayIndex 为空', s.every(x => x.dayIndex === null))
  check('arriveAt 为空', s.every(x => x.arriveAt === null))
  check('耗时照常给出（160 分）', s[1].elapsedMin === 160, String(s[1].elapsedMin))
  check('标签退化为耗时', R.nodeLabel(s[1]) === '出发后 2 小时 40 分', R.nodeLabel(s[1]))
  check('说明文案提示待定出发时刻', /未定出发时刻/.test(R.basisText(s, false)), R.basisText(s, false))
  check('spanDays 为空', R.spanDays(s) === null)
}

section('5. 无时间戳：给不出提醒，不插值')
{
  const s = R.schedule([{ id: 'a' }, { id: 'b' }, { id: 'c' }], START)
  check('全部 known=false', s.every(x => !x.known))
  check('标签为「无时间信息」', R.nodeLabel(s[0]) === '无时间信息')
  check('说明文案说明原因', /没有记录时间信息/.test(R.basisText(s, true)), R.basisText(s, true))
  // 部分节点有时间：只给有时间的节点推算，其余留空
  const mixed = R.schedule([{ id: 'a', time: DAY1[0].time }, { id: 'b' }, { id: 'c', time: DAY1[2].time }], START)
  check('有时间戳的节点正常推算', mixed[0].known && mixed[2].known)
  check('缺失的节点标为未知', mixed[1].known === false)
  check('缺失节点标签为无时间信息', R.nodeLabel(mixed[1]) === '无时间信息')
  check('说明文案仍成立', /按轨迹记录的时间差/.test(R.basisText(mixed, true)))
}

section('6. 锚点不是第一个节点（首节点无时间）')
{
  const s = R.schedule([{ id: 'a' }, { id: 'b', time: DAY1[0].time }, { id: 'c', time: DAY1[2].time }], START)
  check('以第一个有时间戳的节点为锚点', s[1].arriveTime === '08:00', JSON.stringify(s[1]))
  check('末点为第 1 天 13:20', s[2].arriveTime === '13:20', s[2].arriveTime)
}

section('7. 工具函数')
{
  check('durationText 分钟', R.durationText(45) === '45 分钟')
  check('durationText 整小时', R.durationText(120) === '2 小时')
  check('durationText 小时+分', R.durationText(320) === '5 小时 20 分')
  check('minutesOfDay 取北京钟点', R.minutesOfDay('2026-09-26T08:00:00+08:00') === 480)
  check('minutesOfDay 跨日（北京时间次日 01:00）', R.minutesOfDay('2026-09-26T17:00:00Z') === 60)
  check('clockOf 归一化', R.clockOf(1500) === '01:00')
  check('schedule 空数组', R.schedule([], START).length === 0)
  check('schedule 缺 startAt 且无时间戳', R.schedule([{ id: 'a' }])[0].known === false)
  check('非法 time 视为无时间戳', R.schedule([{ id: 'a', time: '不是时间' }], START)[0].known === false)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
