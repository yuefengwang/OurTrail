// 光污染输入（Slice 5）测试：node tools/light-pollution-test.js
// 只测纯解析与“无 key 明确缺失”；不外呼（真实 key 只在云函数环境变量里）。
'use strict'
const LP = require('../cloudfunctions/trailApi/lib/light-pollution')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

section('1. 解析')
{
  const a = LP.parseLightPollution({ sqm: 21.556, bortleClass: 3, dataset: 'viirs-2025' })
  check('SQM 取两位小数', a && a.sqm === 21.56)
  check('Bortle 取整', a && a.bortle === 3)
  check('dataset 保留', a && a.dataset === 'viirs-2025')
  const b = LP.parseLightPollution({ bortle: 4 })
  check('只有 bortle 也可用', b && b.bortle === 4 && b.sqm === null)
  check('空对象 → null', LP.parseLightPollution({}) === null)
  check('非对象 → null', LP.parseLightPollution(null) === null)
}

section('2. URL 与无 key 降级')
{
  const u = LP.url(30.12, 103.45)
  check('URL 带 lat/lng', u.indexOf('lat=30.12') >= 0 && u.indexOf('lng=103.45') >= 0)
  const old = process.env.DARKSKY_API_KEY
  delete process.env.DARKSKY_API_KEY
  check('无 key 时 apiKey 为空', LP.apiKey() === '')
  LP.fetchLightPollution(30, 103).then(r => {
    check('无 key 不发网络、明确返回 no-key', r && r.lightPollution === null && r.reason === 'no-key', r)
    if (old != null) process.env.DARKSKY_API_KEY = old
    console.log('\npassed=' + passed + ' failed=' + failed)
    process.exit(failed ? 1 : 0)
  }).catch(e => {
    console.error(e)
    if (old != null) process.env.DARKSKY_API_KEY = old
    process.exit(1)
  })
}
