// 活动详情「出发日天气」摘要：只组合现有天气事实，缺数据/超窗口/陈旧三态分开。
// 运行：node tools/weather-brief-test.js
'use strict'
const WB = require('../miniprogram/utils/weather-brief')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const START = '2026-10-26T08:00:00+08:00'
const DAY = { date: '2026-10-26', code: 3, tMax: 14, tMin: 6, precipProbMax: 30 }
const HOUR = { d: '2026-10-26', t: '08:00', code: 3, temp: 9, pop: 25, wind: 8 }
const READY = {
  status: 'ready',
  days: [DAY],
  series: [HOUR],
  stale: false,
}

section('1. 出发日有精确小时读数')
{
  const b = WB.buildBrief({
    startAt: START,
    pointName: '长坪沟口',
    result: Object.assign({}, READY, {
      stale: true,
      staleAt: '2026-10-20T08:00:00+08:00',
    }),
    risks: [{ title: '高海拔与天气突变' }],
  })
  check('ready=true', b.ready === true && b.status === 'ready', b.status)
  check('出发日标签含日期', b.dayLabel.indexOf('10/26') !== -1, b.dayLabel)
  check('小时读数含 08:00 / 温度 / 降水 / 风',
    b.hourText.indexOf('08:00') !== -1 && b.hourText.indexOf('9°C') !== -1
    && b.hourText.indexOf('降水 25%') !== -1 && b.hourText.indexOf('风 8 km/h') !== -1,
    b.hourText)
  check('全天读数含温度区间与降水概率',
    b.dayText.indexOf('6–14°C') !== -1 && b.dayText.indexOf('30%') !== -1, b.dayText)
  check('起点主语', b.pointText === '起点 · 长坪沟口', b.pointText)
  check('陈旧数据带取数时间', b.staleText.indexOf('不是实时') !== -1 && b.staleText.indexOf('2026-10-20') !== -1, b.staleText)
  check('风险摘要只取首要标题，详情仍指向下方', b.riskText.indexOf('高海拔与天气突变') !== -1
    && b.riskText.indexOf('下方风险提示') !== -1, b.riskText)
  check('没有 NaN/undefined', !/NaN|undefined/.test([b.hourText, b.dayText, b.staleText, b.riskText].join(' ')))
}

section('2. 没有精确小时：不拿 00:00 冒充出发时刻')
{
  const b = WB.buildBrief({
    startAt: START,
    pointName: '长坪沟口',
    result: Object.assign({}, READY, {
      series: [{ d: '2026-10-26', t: '06:00', code: 3, temp: 7, pop: 20, wind: 5 }],
    }),
    risks: [],
  })
  check('仍是 ready', b.ready === true)
  check('hourText 为空，不编 06:00 为出发小时', b.hourText === '', b.hourText)
  check('全天读数照给', b.dayText.indexOf('6–14°C') !== -1, b.dayText)
  check('无风险时不硬凑一句', b.riskText === '', b.riskText)
}

section('3. 超窗口 / 服务不可用 / 缺输入')
{
  const out = WB.buildBrief({ startAt: START, pointName: '起点', result: { status: 'out_of_range' } })
  check('out_of_range 说明 14 天窗口', out.ready === false && out.text.indexOf('14 天') !== -1, out.text)
  check('out_of_range 不给重试按钮', out.retry === false)

  const down = WB.buildBrief({ startAt: START, pointName: '起点', result: { status: 'unavailable', message: '天气服务暂时不可用。' } })
  check('unavailable 透出服务话术', down.ready === false && down.text.indexOf('天气服务暂时不可用') !== -1, down.text)
  check('unavailable 允许重试（读操作）', down.retry === true)

  const noStart = WB.buildBrief({ startAt: null, pointName: '起点', result: READY })
  check('没有出发时间：说明不能按出发日查', noStart.ready === false && noStart.text.indexOf('出发时间') !== -1, noStart.text)

  const badStart = WB.buildBrief({ startAt: 'not-a-date', pointName: '起点', result: READY })
  check('非法出发时间：说明时刻无效', badStart.ready === false && badStart.text.indexOf('有效时刻') !== -1, badStart.text)

  const noPoint = WB.buildBrief({ startAt: START, pointName: '', result: READY })
  check('没有起点：说明查不了', noPoint.ready === false && noPoint.text.indexOf('起点') !== -1, noPoint.text)

  const noDay = WB.buildBrief({ startAt: START, pointName: '起点', result: Object.assign({}, READY, { days: [] }) })
  check('没有逐日预报：说明临近再查', noDay.ready === false && noDay.text.indexOf('逐日预报') !== -1, noDay.text)
  check('noDay 允许重试', noDay.retry === true)
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
