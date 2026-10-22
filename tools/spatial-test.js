// 方向性天气采样（Slice 2）测试：node tools/spatial-test.js
// 覆盖：8×3 网格几何、URL 契约、多坐标响应聚合、日期过滤、缺测不编 0。
'use strict'
const SP = require('../cloudfunctions/trailApi/lib/spatial')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

section('1. 8 方位 × 3 距离网格')
{
  const pts = SP.gridPoints(30, 103)
  check('24 个采样点', pts.length === 24)
  check('8 个方位各 3 个距离', SP.AZIMUTHS.every(az => pts.filter(p => p.azimuth === az).length === 3))
  check('距离档为 5/15/30 km', JSON.stringify(SP.DISTANCES_KM) === '[5,15,30]')
  const north = SP.offsetPoint(30, 103, 0, 10)
  check('正北：纬度增加、经度不变', north.lat > 30 && Math.abs(north.lng - 103) < 1e-9)
  const east = SP.offsetPoint(30, 103, 90, 10)
  check('正东：经度增加、纬度不变', east.lng > 103 && Math.abs(east.lat - 30) < 1e-9)
  const south = SP.offsetPoint(30, 103, 180, 10)
  check('正南：纬度减少', south.lat < 30)
  const wrap = SP.offsetPoint(0, 179.9, 90, 30)
  check('跨日界线经度归一化', wrap.lng > -180 && wrap.lng < 180)
}

section('2. URL 契约')
{
  const q = SP.buildSpatialUrl(30.1234, 103.5678, '2026-10-21')
  check('多坐标 24 个', (q.url.match(/latitude=/g) || []).length === 1 && q.points.length === 24)
  check('只请求选中的一天', q.url.indexOf('start_date=2026-10-21') >= 0 && q.url.indexOf('end_date=2026-10-21') >= 0)
  check('请求云/降水/概率，不请求无关变量',
    q.url.indexOf('cloud_cover_low') >= 0 && q.url.indexOf('precipitation') >= 0 &&
    q.url.indexOf('precipitation_probability') >= 0)
  const q2 = SP.buildSpatialUrl(30.1234, 103.5678, '2026-10-21', '2026-10-22')
  check('跨夜请求覆盖次日', q2.url.indexOf('start_date=2026-10-21') >= 0 && q2.url.indexOf('end_date=2026-10-22') >= 0)
}

section('3. 多坐标聚合')
{
  const date = '2026-10-21'
  const times = []
  for (let h = 0; h < 24; h++) times.push(date + 'T' + String(h).padStart(2, '0') + ':00')
  const points = SP.gridPoints(30, 103)
  const payload = points.map(p => ({
    hourly: {
      time: times,
      cloud_cover_low: times.map((_, h) => p.azimuth + h * 0),
      cloud_cover_mid: times.map(() => 10),
      cloud_cover_high: times.map(() => 20),
      cloud_cover: times.map(() => 30),
      precipitation: times.map((_, h) => p.azimuth === 180 ? 0.4 : 0),
      precipitation_probability: times.map(() => 50),
    },
  }))
  const out = SP.aggregateSpatial(payload, points, date)
  check('8 个方位', out && out.byAzimuth.length === 8)
  check('24 小时', out && out.hours.length === 24 && out.hours[0] === '00:00')
  check('每个方位聚合的是同方位 3 个点', out.byAzimuth[1].low.every(v => v === 45))
  check('正南方向有雨、正北没有', out.byAzimuth[4].precip[0] === 0.4 && out.byAzimuth[0].precip[0] === 0)
  check('概率字段按方位保留', out.byAzimuth[0].pop[0] === 50)
}

section('4. 缺测与日期过滤')
{
  const date = '2026-10-21'
  const times = ['2026-10-20T23:00', date + 'T00:00', date + 'T01:00', '2026-10-22T00:00']
  const points = SP.gridPoints(30, 103)
  const payload = points.map(p => ({
    hourly: {
      time: times,
      cloud_cover_low: [999, null, 20, 999],
      cloud_cover_mid: [999, 30, null, 999],
      cloud_cover_high: [999, 40, null, 999],
      cloud_cover: [999, 50, null, 999],
      precipitation: [999, 0, null, 999],
      precipitation_probability: [999, 10, null, 999],
    },
  }))
  const out = SP.aggregateSpatial(payload, points, date)
  check('只取选中日（2 小时）', out && out.hours.length === 2 && out.hours[0] === '00:00')
  check('全缺 → null，不编 0', out.byAzimuth[0].low[0] === null && out.byAzimuth[0].precip[1] === null)
  check('部分点有值仍可聚合', out.byAzimuth[0].mid[0] === 30)
  check('无时间轴 → null', SP.aggregateSpatial([], points, date) === null)
  check('单对象响应也可聚合', SP.aggregateSpatial(payload[0], [points[0]], date).byAzimuth[0].low[0] === null)

  const next = '2026-10-22'
  const crossTimes = [date + 'T23:00', next + 'T00:00', next + 'T01:00']
  const crossPayload = points.map(() => ({
    hourly: {
      time: crossTimes,
      cloud_cover_low: [10, 20, 30],
      cloud_cover_mid: [10, 20, 30],
      cloud_cover_high: [10, 20, 30],
      cloud_cover: [10, 20, 30],
      precipitation: [0, 0, 0],
      precipitation_probability: [0, 0, 0],
    },
  }))
  const cross = SP.aggregateSpatial(crossPayload, points, date, next)
  check('跨夜聚合保留两日 3 小时', cross && cross.times.length === 3 && cross.dates.length === 2,
    cross && { times: cross.times, dates: cross.dates })
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
