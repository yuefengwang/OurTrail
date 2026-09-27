// GPX 解析的 node 冒烟测试。运行：node tools/gpx-test.js
'use strict'
const { parseGpx } = require('../miniprogram/utils/gpx')

let passed = 0
let failed = 0
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail ? ' — ' + JSON.stringify(detail) : '')) }
}

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name><![CDATA[青城后山 & 测试]]></name></metadata>
  <wpt lat="30.9343" lon="103.4852"><name>泰安古镇</name><ele>750</ele></wpt>
  <wpt lat="30.9508" lon="103.4712"><name>飞泉沟</name><ele>1100</ele></wpt>
  <wpt lat="30.9402" lon="103.4786"><name>白云索道下站</name><ele>980</ele></wpt>
  <trk>
    <name>track</name>
    <trkseg>
      <trkpt lat="30.9343" lon="103.4852"><ele>750</ele></trkpt>
      <trkpt lat="30.9350" lon="103.4840"><ele>780</ele></trkpt>
      <trkpt lat="30.9360" lon="103.4830"><ele>800</ele></trkpt>
      <trkpt lat="30.9400" lon="103.4780"><ele>900</ele></trkpt>
      <trkpt lat="30.9450" lon="103.4750"><ele>1050</ele></trkpt>
      <trkpt lat="30.9508" lon="103.4712"><ele>1100</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`

const TRACK_ONLY = `<?xml version="1.0"?>
<gpx version="1.0" creator="t">
  <trk><trkseg>
    ${Array.from({ length: 100 }, (_, i) => {
      const lat = 30 + i * 0.0009
      const lng = 103 + i * 0.0009
      const ele = 500 + i * 2
      return `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${ele}</ele></trkpt>`
    }).join('\n    ')}
  </trkseg></trk>
</gpx>`

function run() {
  console.log('== 航点优先 ==')
  const r1 = parseGpx(SAMPLE)
  check('ok', r1.ok, r1.error)
  check('3 个节点', r1.ok && r1.points.length === 3)
  check('首点起点', r1.ok && r1.points[0].kind === 'start' && r1.points[0].name === '泰安古镇')
  check('末点终点', r1.ok && r1.points[2].kind === 'finish' && r1.points[2].name === '白云索道下站')
  check('中间 checkpoint', r1.ok && r1.points[1].kind === 'checkpoint')
  check('CDTA+实体解码', r1.ok, r1.stats)
  check('里程来自轨迹', r1.ok && r1.distanceKm > 1 && r1.distanceKm < 10, r1.distanceKm)
  check('爬升为正数', r1.ok && r1.ascentM >= 350, r1.ascentM)

  console.log('== 纯轨迹采样 ==')
  const r2 = parseGpx(TRACK_ONLY)
  check('ok', r2.ok, r2.error)
  check('节点数在 3-10', r2.ok && r2.points.length >= 3 && r2.points.length <= 10, r2.ok && r2.points.length)
  check('首尾 kind', r2.ok && r2.points[0].kind === 'start' && r2.points[r2.points.length - 1].kind === 'finish')
  check('里程约 14km（0.0009°×100）', r2.ok && r2.distanceKm > 12 && r2.distanceKm < 16, r2.distanceKm)
  check('爬升 198m', r2.ok && r2.ascentM === 198, r2.ascentM)
  check('采样点带里程名', r2.ok && r2.points.some(p => /公里处/.test(p.name)))

  console.log('== 异常输入 ==')
  check('空文件', !parseGpx('').ok)
  check('非 GPX', !parseGpx('<html></html>').ok)
  check('没有点', !parseGpx('<gpx version="1.0"></gpx>').ok)
  const bad = '<gpx><wpt lat="abc" lon="103"><name>x</name></wpt><wpt lat="30" lon="103"><name>y</name></wpt></gpx>'
  check('非法坐标被丢弃→点数不足', !parseGpx(bad).ok)

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

run()
