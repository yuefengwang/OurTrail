// 活动卡三行正文的派生：node tools/card-view-test.js
//
// 本文件补的是「投影字段不许被展示派生改写」这条边界的另一半：
// a20-owner-hero 门按字节钉住 info/status/metrics，这里钉住新加的 chips/人数
// 不与那些字段抢真值、缺字段不印 0、非组织者看不见待审核数。
'use strict'
const path = require('path')

const ROOT = path.join(__dirname, '..')
const { chipsOf, metricsOf, peopleOf } = require(path.join(ROOT, 'miniprogram', 'utils', 'card-view.js'))
const F = require(path.join(ROOT, 'miniprogram', 'utils', 'format.js'))

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const START = '2026-10-18T01:30:00.000Z' // 北京时间 10/18 周六 09:30

section('1. chips 的次序与取值（日期 > 难度 > 距离 > 爬升）')
{
  const a = {
    startAt: START,
    routeSnapshot: { difficulty: 'moderate', distanceKm: 16, ascentM: 980, title: '峨眉山南线' },
  }
  const chips = chipsOf(a)
  check('四项齐备', chips.length === 4, chips)
  check('次序 = date/difficulty/distance/ascent',
    chips.map(c => c.key).join(',') === 'date,difficulty,distance,ascent', chips)
  check('日期与 format.dateLabel 同源', chips[0].text === F.dateLabel(START), chips[0])
  check('难度用中文标签', chips[1].text === '中等', chips[1])
  check('距离带单位', chips[2].text === '16 km', chips[2])
  check('爬升带单位', chips[3].text === '980 m', chips[3])
}

section('2. 缺字段：整项不出现，不印 0、不印「日期待定」')
{
  const noStart = chipsOf({ routeSnapshot: { difficulty: 'easy' } })
  check('没有 startAt ⇒ 没有日期 chip（不印「日期待定」）', noStart.every(c => c.key !== 'date'), noStart)
  const zeros = chipsOf({ startAt: START, routeSnapshot: { distanceKm: 0, ascentM: 0 } })
  check('距离/爬升为 0 ⇒ 两项都不出现（没填 ≠ 0 公里）',
    zeros.map(c => c.key).join(',') === 'date', zeros)
  const unknownDifficulty = chipsOf({ startAt: START, routeSnapshot: { difficulty: 'unknown' } })
  check('未知难度不出现', unknownDifficulty.every(c => c.key !== 'difficulty'), unknownDifficulty)
  const bare = chipsOf({ startAt: START })
  check('没有 routeSnapshot 不抛错，只剩日期', bare.length === 1 && bare[0].key === 'date', bare)
  check('完全没有入参也不抛错', chipsOf(null).length === 0)
  check('最多 4 枚（参考板的活动卡只有一行 chips）', chipsOf({
    startAt: START, routeSnapshot: { difficulty: 'hard', distanceKm: 1, ascentM: 1 },
  }).length === 4)
}

section('2b. metrics 仍是页面卡片对象的既有形态（两页门按字节比对它）')
{
  const a = { startAt: START, routeSnapshot: { difficulty: 'hard', distanceKm: 18, ascentM: 900 } }
  check('只含路线事实两项，键/标签/值/单位逐字段同旧实现',
    JSON.stringify(metricsOf(a)) === JSON.stringify([
      { key: 'distance', label: '距离', value: '18', unit: 'km' },
      { key: 'ascent', label: '爬升', value: '900', unit: 'm' },
    ]), metricsOf(a))
  check('chips 的距离/爬升由同一函数派生（口径只有一处）',
    chipsOf(a).filter(c => c.key === 'distance' || c.key === 'ascent').map(c => c.text).join('|')
      === metricsOf(a).map(m => m.value + ' ' + m.unit).join('|'))
  check('为零/缺项时返回空数组，顺序与 chips 一致',
    metricsOf({ routeSnapshot: { distanceKm: 0, ascentM: 0 } }).length === 0 && metricsOf(null).length === 0)
}

section('3. 人数：一次只印一处，待审核只看组织者')
{
  const owner = peopleOf({ confirmed: 3, capacity: 10, pending: 7, owner: true })
  check('组织者：已确认 3/10', owner.text === '已确认 3/10', owner)
  check('组织者：待审核 7 人', owner.pending === '待审核 7 人', owner)

  const peer = peopleOf({ confirmed: 3, capacity: 10, pending: 7, owner: false })
  check('非组织者：同样的人数口径', peer.text === '已确认 3/10', peer)
  check('非组织者：即使投影带 pending 也不印（失败关闭）', peer.pending === '', peer)

  const noCapacity = peopleOf({ confirmed: 3, owner: false })
  check('没有名额 ⇒ 已确认 3 人', noCapacity.text === '已确认 3 人', noCapacity)

  const noConfirmed = peopleOf({ capacity: 10, owner: true })
  check('没有已确认数 ⇒ 整格留空（不印「已确认 undefined」）', noConfirmed.text === '', noConfirmed)

  const zeroPending = peopleOf({ confirmed: 1, capacity: 4, pending: 0, owner: true })
  check('待审核 0 人照印「待审核 0 人」：0 是「审完了」这个事实，不是缺失（与 info 行同一条判据）',
    zeroPending.pending === '待审核 0 人', zeroPending)

  const discoverShape = peopleOf({ confirmed: 5, capacity: 12, owner: false })
  check('发现页顶层形态（confirmed/capacity 在活动上）同口径', discoverShape.text === '已确认 5/12', discoverShape)
}

section('4. 输入不被修改')
{
  const a = { startAt: START, routeSnapshot: { difficulty: 'easy', distanceKm: 3, ascentM: 200 } }
  Object.freeze(a)
  Object.freeze(a.routeSnapshot)
  let threw = null
  try { chipsOf(a) } catch (e) { threw = e }
  check('冻结输入下不抛错', threw === null, threw && threw.message)
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
