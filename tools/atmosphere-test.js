// 大气透明度/seeing/气溶胶（Slice 3）测试：node tools/atmosphere-test.js
// 只测纯解析/过滤，不外呼；网络失败语义由 getCachedAtmosphere 的降级路径覆盖。
'use strict'
const AT = require('../cloudfunctions/trailApi/lib/atmosphere')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

section('1. 7Timer 解析')
{
  check('init UTC 解析', AT.parseInit('2026102018') === Date.UTC(2026, 9, 20, 18))
  check('非法 init → null', AT.parseInit('2026') === null)
  const parsed = AT.parseSevenTimer({
    product: 'astro',
    init: '2026102018',
    dataseries: [
      { timepoint: 3, cloudcover: 1, seeing: 2, transparency: 7, rh2m: 10, wind10m: { speed: 2 }, temp2m: 15, prec_type: 'none' },
      { timepoint: 6, cloudcover: 9, seeing: 6, transparency: 3, rh2m: 14, wind10m: { speed: 5 }, temp2m: 13, prec_type: 'rain' },
    ],
  })
  check('series 长度', parsed && parsed.series.length === 2)
  check('UTC → 北京时间（+8）', parsed.series[0].at === '2026-10-21T05:00', parsed.series[0].at)
  check('云量 okta → 百分比（1→0 / 9→100）',
    parsed.series[0].cloudPct === 0 && parsed.series[1].cloudPct === 100)
  check('seeing/transparency 原样保留', parsed.series[0].seeing === 2 && parsed.series[0].transparency === 7)
  check('缺 dataseries → null', AT.parseSevenTimer({ init: '2026102018' }) === null)
}

section('2. CAMS/Air Quality 解析与日期过滤')
{
  const air = AT.parseAir({
    hourly: {
      time: ['2026-10-21T00:00', '2026-10-21T01:00', '2026-10-22T00:00'],
      aerosol_optical_depth: [0.45, 0.2, null],
      pm2_5: [30, 20, null],
      pm10: [50, 35, null],
    },
  })
  check('air series 长度', air && air.series.length === 3)
  check('AOD/PM2.5 保留，null 不编 0', air.series[0].aod === 0.45 && air.series[2].aod === null && air.series[1].pm25 === 20)
  const filtered = AT.filterSeries(air.series, '2026-10-21', '2026-10-21')
  check('按日期过滤（含首尾）', filtered.length === 2 && filtered[0].at === '2026-10-21T00:00')
  check('缺 hourly → null', AT.parseAir({}) === null)
}

section('3. URL 契约')
{
  check('7Timer 用最终 astro.php（不走 302）', AT.sevenTimerUrl(30, 103).indexOf('/bin/astro.php') >= 0)
  check('7Timer 带经纬度', AT.sevenTimerUrl(30, 103).indexOf('lat=30') >= 0 && AT.sevenTimerUrl(30, 103).indexOf('lon=103') >= 0)
  check('Air Quality 请求 AOD/PM2.5/PM10', AT.airUrl(30, 103).indexOf('aerosol_optical_depth') >= 0 &&
    AT.airUrl(30, 103).indexOf('pm2_5') >= 0 && AT.airUrl(30, 103).indexOf('pm10') >= 0)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
