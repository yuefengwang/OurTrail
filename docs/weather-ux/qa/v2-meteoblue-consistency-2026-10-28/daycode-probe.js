// 日码派生实测探针（2026-10-28）：打印折多山 30.30N/101.64E 的 provider 日码 vs 派生 dayCode，
// 以及逐日雾小时的三证分布。只读，不发写请求。
const path = require('path')
const W = require(path.join(__dirname, '../../../../cloudfunctions/trailApi/lib/weather.js'))

;(async () => {
  const lat = 30.30
  const lng = 101.64
  const today = W.cnToday()
  const f = await W.fetchForecast(lat, lng, today)
  const wgs = W.gcjToWgs(lat, lng)
  console.log('query', lat, lng, '-> wgs', wgs.lat.toFixed(4), wgs.lng.toFixed(4), 'elev', f.elevation)
  for (const d of f.days) {
    const hours = f.series.filter(h => h.d === d.date)
    const inWin = hours.filter(h => h.t >= d.sunrise && h.t <= d.sunset)
    const fogHours = hours.filter(h => h.code === 45 || h.code === 48)
    const fogOK = fogHours.filter(h => W.fogConfirmed(h))
    const codes = {}
    for (const h of inWin) codes[h.code] = (codes[h.code] || 0) + 1
    console.log([
      d.date,
      'code=' + d.code,
      'dayCode=' + d.dayCode,
      'win=' + d.sunrise + '-' + d.sunset,
      'inWin=' + inWin.length,
      'fogHours=' + fogHours.length + '(ok ' + fogOK.length + ')',
      'hist=' + JSON.stringify(codes),
    ].join('  '))
  }
})().catch(e => { console.error('FAILED', e.message); process.exit(1) })
