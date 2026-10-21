// 活动详情事实摘要：只从结构化字段拼事实，不生成任何用户没填过的内容。
// 运行：node tools/activity-summary-test.js
'use strict'
const AS = require('../miniprogram/utils/activity-summary')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

function activity(over) {
  return Object.assign({
    startAt: '2026-10-25T08:00:00+08:00',
    description: '',
    routeSnapshot: { title: '飞泉沟环线', distanceKm: 12.8, ascentM: 680 },
    pickupPoints: [{ id: 'pk-1', name: '犀浦站', meetingAt: '2026-10-25T07:30:00+08:00', address: '地铁 A 口' }],
  }, over || {})
}

section('1. 完整事实摘要')
{
  const r = AS.buildFactSummary(activity())
  check('包含出发日期与时间（北京时间）', r.text.indexOf('10/25 周日 08:00 出发') !== -1, r.text)
  check('包含路线名与里程/爬升', r.text.indexOf('路线「飞泉沟环线」') !== -1 && r.text.indexOf('12.8 km') !== -1
    && r.text.indexOf('680 m') !== -1, r.text)
  check('包含集合点与集合时间', r.text.indexOf('集合在「犀浦站」') !== -1 && r.text.indexOf('07:30') !== -1, r.text)
  check('used 标明来源字段', r.used.join(',') === 'start,route,pickup', r.used)
  check('不使用手写介绍冒充自动摘要', AS.buildFactSummary(activity({ description: '领队手写介绍' })).text.indexOf('领队手写介绍') === -1)
}

section('2. 缺字段不编造')
{
  const noRoute = AS.buildFactSummary(activity({ routeSnapshot: { title: '', distanceKm: 0, ascentM: 0 } }))
  check('无路线 → 不出现「路线」段', noRoute.text.indexOf('路线') === -1 && noRoute.used.indexOf('route') === -1, noRoute)
  const noPickup = AS.buildFactSummary(activity({ pickupPoints: [] }))
  check('无集合点 → 不出现「集合在」', noPickup.text.indexOf('集合在') === -1 && noPickup.used.indexOf('pickup') === -1, noPickup)
  const zeroStats = AS.buildFactSummary(activity({
    routeSnapshot: { title: '只有名字', distanceKm: 0, ascentM: 0 },
  }))
  check('0 km / 0 m 不印成事实', zeroStats.text.indexOf('0 km') === -1 && zeroStats.text.indexOf('0 m') === -1,
    zeroStats.text)
  const empty = AS.buildFactSummary({})
  check('没有任何结构化事实 → 空摘要', empty.text === '' && empty.used.length === 0, empty)
  const blankPickup = AS.buildFactSummary(activity({
    pickupPoints: [{ id: 'pk-1', name: '   ', meetingAt: null }],
  }))
  check('空白集合点名称 → 不生成集合句', blankPickup.text.indexOf('集合在') === -1, blankPickup.text)
}

section('3. 时间与来源边界')
{
  const midnight = AS.buildFactSummary(activity({ startAt: '2026-10-25T00:30:00+08:00' }))
  check('跨时区按北京时间（00:30 不漂到前一天）', midnight.text.indexOf('10/25 周日 00:30 出发') !== -1, midnight.text)
  const noMeeting = AS.buildFactSummary(activity({
    pickupPoints: [{ id: 'pk-1', name: '犀浦站', meetingAt: null }],
  }))
  check('集合时间缺失时只印地点，不补时间', noMeeting.text.indexOf('集合在「犀浦站」') !== -1
    && noMeeting.text.indexOf('集合在「犀浦站」，') === -1, noMeeting.text)
  check('numberText 去掉无意义的尾随小数', AS.numberText(12.0) === '12' && AS.numberText(12.84) === '12.8',
    [AS.numberText(12.0), AS.numberText(12.84)])
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
