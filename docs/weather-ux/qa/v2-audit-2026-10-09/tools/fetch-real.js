/* Cloud Field 取证第一步：用生产同一份 lib/weather.js 抓真实气压层剖面 */
'use strict'
const fs = require('fs')
const path = require('path')
const W = require('D:/OurTrail/cloudfunctions/trailApi/lib/weather.js')

// GCJ-02 → WGS-84 由 lib 自己做，这里传的是页面上那种 GCJ 坐标（与生产 getWeatherByPoint 一致）
const PLACES = [
  { key: 'chengdu', name: '成都', gcj: [30.5728, 104.0668] },
  { key: 'emeishan', name: '峨眉山', gcj: [29.5200, 103.3400] },
  { key: 'litang', name: '理塘', gcj: [30.0020, 100.2700] },
]

function today() { return W.cnToday() }

;(async function run () {
  const date = today()
  const out = { fetchedAt: new Date().toISOString(), date, places: {} }
  for (const p of PLACES) {
    const wgs = W.gcjToWgs(p.gcj[0], p.gcj[1])
    const f = await W.fetchForecast(wgs.lat, wgs.lng, date)
    out.places[p.key] = {
      name: p.name,
      gcj: p.gcj,
      wgs: [Number(wgs.lat.toFixed(4)), Number(wgs.lng.toFixed(4))],
      elevation: f.elevation,
      seriesLen: (f.series || []).length,
      cloudLevels: f.cloudLevels,
      // 逐时地表序列：温度/降水/风/云三分量，供阶段 E 的可读性取证复用
      series: (f.series || []).slice(0, 72),
    }
    console.log(p.name, 'elev=' + f.elevation, 'times=' + (f.cloudLevels && f.cloudLevels.times.length),
      'levels=' + (f.cloudLevels && f.cloudLevels.levels.length))
  }
  fs.writeFileSync(path.join(__dirname, 'real-cloud.json'), JSON.stringify(out))
  console.log('written real-cloud.json bytes=' + fs.statSync(path.join(__dirname, 'real-cloud.json')).size)
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1) })
