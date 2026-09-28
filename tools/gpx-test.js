// GPX 解析的 node 冒烟测试。运行：node tools/gpx-test.js
'use strict'
const { parseGpx, wgsToGcj, gcjToWgs, simplifyTrack } = require('../miniprogram/utils/gpx')

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

// 带时间戳与高程的轨迹：08:00 出发，每点 30 分钟，用于验证节点元数据透传
const TRACK_TIMED = `<?xml version="1.0"?>
<gpx version="1.0" creator="t">
  <trk><trkseg>
    ${Array.from({ length: 12 }, (_, i) => {
      const lat = 30 + i * 0.0009
      const lng = 103 + i * 0.0009
      const t = new Date(Date.parse('2026-09-26T00:00:00Z') + i * 1800000).toISOString().replace('.000Z', 'Z')
      return `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${700 + i * 30}</ele><time>${t}</time></trkpt>`
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

  console.log('== WGS-84 → GCJ-02 ==')
  const g1 = wgsToGcj(30.9343, 103.4852)
  check('境内坐标发生偏移', g1.lat !== 30.9343 && g1.lng !== 103.4852, g1)
  check('偏移量级合理（约百米级）',
    Math.abs(g1.lat - 30.9343) > 0.0005 && Math.abs(g1.lat - 30.9343) < 0.01 &&
    Math.abs(g1.lng - 103.4852) > 0.0005 && Math.abs(g1.lng - 103.4852) < 0.01, g1)
  const g2 = wgsToGcj(48.8566, 2.3522)
  check('境外坐标原样返回', g2.lat === 48.8566 && g2.lng === 2.3522, g2)

  console.log('== GCJ-02 → WGS-84 ==')
  const gw1 = gcjToWgs(g1.lat, g1.lng)
  check('往返还原误差 < 1e-5°', Math.abs(gw1.lat - 30.9343) < 1e-5 && Math.abs(gw1.lng - 103.4852) < 1e-5, gw1)
  const gw2 = gcjToWgs(48.8566, 2.3522)
  check('境外原样返回', gw2.lat === 48.8566 && gw2.lng === 2.3522, gw2)

  console.log('== 轨迹采样 ==')
  const dense = Array.from({ length: 5000 }, (_, i) => ({ lat: 30 + i * 0.00002, lng: 103 + i * 0.00002, ele: 500 + i }))
  const s1 = simplifyTrack(dense, 200)
  check('采样后 ≤200 点', s1.length <= 200, s1.length)
  check('保留首尾点', s1[0].lat === dense[0].lat && s1[s1.length - 1].lat === dense[dense.length - 1].lat)
  check('采样沿轨迹单调', s1.every((p, i) => i === 0 || p.lat > s1[i - 1].lat))
  check('短轨迹原样返回', simplifyTrack(dense.slice(0, 50), 200).length === 50)

  console.log('== parseGpx 输出 track（GCJ-02）==')
  const r3 = parseGpx(TRACK_ONLY)
  check('track 点数 2-200', r3.ok && r3.track.length >= 2 && r3.track.length <= 200, r3.ok && r3.track.length)
  check('track 已转 GCJ（≠原 WGS 首点）', r3.ok && r3.track[0].lat !== 30, r3.ok && r3.track[0])
  check('track 坐标范围合法', r3.ok && r3.track.every(p => Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180))
  const r4 = parseGpx(SAMPLE)
  check('有轨迹时 track 来自轨迹', r4.ok && r4.track.length >= 2, r4.ok && r4.track.length)
  const wptOnly = '<gpx><wpt lat="30.1" lon="103.1"><name>A</name></wpt><wpt lat="30.2" lon="103.2"><name>B</name></wpt></gpx>'
  const r5 = parseGpx(wptOnly)
  check('纯航点无轨迹 → track 为空数组', r5.ok && r5.track.length === 0, r5.ok && r5.track)

  console.log('== 安全建议（suggestTrailInfo）==')
  // 多日轨迹：时间戳跨 3 天，节点名无露营关键词 → 触发天数露营/补给规则
  const multiDay = '<?xml version="1.0"?><gpx><trk><trkseg>' +
    Array.from({ length: 6 }, (_, i) => {
      const day = Math.floor(i / 2)
      return '<trkpt lat="30.0' + i + '" lon="103.0' + i + '"><ele>' + (400 + i * 100) + '</ele><time>2026-10-0' + (1 + day) + 'T08:00:00Z</time></trkpt>'
    }).join('') +
    '</trkseg></trk></gpx>'
  const rm = parseGpx(multiDay)
  check('多日轨迹 ok', rm.ok, rm.error)
  check('天数识别为 3 天', rm.ok && rm.suggestions.days === 3, rm.ok && JSON.stringify(rm.suggestions))
  check('多日触发露营补给建议', rm.ok && rm.suggestions.risks.some(r => r.title.indexOf('3 天行程的露营与补给') !== -1))
  check('多日装备含帐篷', rm.ok && rm.suggestions.equipment.some(e => e.indexOf('帐篷') !== -1))
  const r6 = parseGpx(TRACK_ONLY)
  check('单日轨迹 days=1', r6.ok && r6.suggestions.days === 1)
  check('单日无露营建议', r6.ok && !r6.suggestions.risks.some(r => r.title.indexOf('露营与补给') !== -1))
  check('兜底风险存在', r6.ok && r6.suggestions.risks.length >= 1)
  // 关键词规则：航点名带"溪"触发涉水；带"营地"触发露营关键词规则
  const river = '<gpx><wpt lat="30.1" lon="103.1"><name>溪谷下撤点</name></wpt><wpt lat="30.2" lon="103.2"><name>出口</name></wpt></gpx>'
  const r7 = parseGpx(river)
  check('关键词触发涉水风险', r7.ok && r7.suggestions.risks.some(r => r.title === '涉水与湿滑路段'))
  const camp = '<gpx><wpt lat="30.1" lon="103.1"><name>第一天营地</name></wpt><wpt lat="30.2" lon="103.2"><name>营地</name></wpt></gpx>'
  const r8 = parseGpx(camp)
  check('关键词触发露营建议', r8.ok && r8.suggestions.risks.some(r => r.title === '夜间低温与照明不足'))

  console.log('== 节点元数据 time/ele 透传 ==')
  const rt = parseGpx(TRACK_TIMED)
  check('ok', rt.ok, rt.error)
  check('节点带 ele（用户不可编辑，供云层带判断）', rt.ok && rt.points.every(p => Number.isFinite(p.ele)), rt.ok && rt.points.map(p => p.ele).join(','))
  check('节点带 time（供按节点推算第几天抵达）', rt.ok && rt.points.every(p => typeof p.time === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(p.time)), rt.ok && rt.points.map(p => p.time).join(','))
  check('时间沿轨迹递增', rt.ok && rt.points.every((p, i) => i === 0 || Date.parse(p.time) > Date.parse(rt.points[i - 1].time)))
  check('无时间戳的轨迹不带 time 键', r4.ok && r4.points.every(p => !('time' in p)))
  check('无时间戳的轨迹仍带 ele', r4.ok && r4.points.every(p => Number.isFinite(p.ele)))

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
