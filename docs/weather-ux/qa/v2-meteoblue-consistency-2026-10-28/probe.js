// 只读探针：折多山点位一致性核验（2026-10-28）
// 用法：node docs/weather-ux/qa/v2-meteoblue-consistency-2026-10-28/probe.js
// 依赖：仅 cloudfunctions/trailApi/lib/weather.js（纯 https，无 wx-server-sdk）
const path = require('path')
const W = require(path.join(__dirname, '../../../../cloudfunctions/trailApi/lib/weather.js'))

const LAT = 30.30
const LNG = 101.64
const DATE = '2026-10-28'

const fmt = d => d.date + ' ' + d.tMax + '/' + d.tMin + '°C wind' + d.windMax + ' precip' + d.precipSum + ' code' + d.code
const round1 = v => Math.round((v || 0) * 10) / 10

async function raw(params) {
  const q = new URLSearchParams(Object.assign({
    latitude: String(LAT), longitude: String(LNG),
    daily: 'temperature_2m_max,temperature_2m_min,wind_speed_10m_max,precipitation_sum,weather_code',
    timezone: 'Asia/Shanghai', forecast_days: '8',
  }, params))
  return W.fetchJson('https://api.open-meteo.com/v1/forecast?' + q.toString())
}

;(async () => {
  console.log('=== 1) 生产路径 fetchForecast(30.30, 101.64) ===')
  const f = await W.fetchForecast(LAT, LNG, DATE)
  console.log('pointElevation =', f.elevation)
  f.days.forEach(d => console.log('  ' + fmt(d)))
  const temps = f.detail.map(x => x.temp)
  console.log('  10-28 逐时温度 min/max =', Math.min(...temps).toFixed(1), '/', Math.max(...temps).toFixed(1))

  console.log('\n=== 2) 手动输入口径差异：若当作 GCJ-02 纠偏 ===')
  const w = W.gcjToWgs(LAT, LNG)
  const shift = Math.round(Math.hypot((w.lat - LAT) * 111000, (w.lng - LNG) * 111000 * Math.cos(LAT * Math.PI / 180)))
  console.log('  gcjToWgs →', w.lat.toFixed(5), w.lng.toFixed(5), '位移≈' + shift + 'm')
  const f2 = await W.fetchForecast(w.lat, w.lng, DATE)
  console.log('  pointElevation =', f2.elevation)
  f2.days.forEach(d => console.log('  ' + fmt(d)))

  console.log('\n=== 3) 模型离散（同点同日，Open-Meteo 可选模型） ===')
  const variants = [
    ['best_match(生产默认)', {}],
    ['elevation=3980 (meteoblue标高)', { elevation: '3980' }],
    ['ecmwf_ifs025', { models: 'ecmwf_ifs025' }],
    ['gfs_seamless', { models: 'gfs_seamless' }],
    ['icon_seamless', { models: 'icon_seamless' }],
    ['cma_grapes_global', { models: 'cma_grapes_global' }],
  ]
  for (const [name, p] of variants) {
    const j = await raw(p)
    const d = j.daily
    const row = d.time.slice(0, 6).map((t, i) =>
      t.slice(5) + ' ' + Math.round(d.temperature_2m_max[i]) + '/' + Math.round(d.temperature_2m_min[i]) +
      ' w' + Math.round(d.wind_speed_10m_max[i]) + ' p' + round1(d.precipitation_sum[i])).join(' | ')
    console.log('  [' + name + '] elev=' + j.elevation + ' → ' + row)
  }

  console.log('\n=== 4) 日级天气码 vs 白天时段（08–18）最差码 + 雾小时湿度佐证 ===')
  const PTS = [
    ['折多山', 30.30, 101.64],
    ['四姑娘山', 31.10, 102.90],
    ['泰山', 36.25, 117.10],
    ['黄山', 30.13, 118.17],
    ['武功山', 27.46, 114.17],
    ['成都(低海拔对照)', 30.66, 104.07],
  ]
  const q = new URLSearchParams({
    latitude: PTS.map(p => p[1]).join(','),
    longitude: PTS.map(p => p[2]).join(','),
    hourly: 'weather_code,relative_humidity_2m,visibility,sunshine_duration',
    daily: 'weather_code,sunshine_duration',
    timezone: 'Asia/Shanghai', forecast_days: '16',
  })
  const j = await W.fetchJson('https://api.open-meteo.com/v1/forecast?' + q.toString())
  const list = Array.isArray(j) ? j : [j]
  list.forEach((r, k) => {
    const H = r.hourly, D = r.daily
    let fogHours = 0, fogLowRh = 0, fogDays = 0, misleading = 0
    const rows = []
    D.time.forEach((t, di) => {
      const idx = H.time.map((ht, i) => (ht.slice(0, 10) === t ? i : -1)).filter(i => i >= 0)
      const daytime = idx.filter(i => { const hh = +H.time[i].slice(11, 13); return hh >= 8 && hh <= 18 })
      const dayMax = Math.max(...daytime.map(i => H.weather_code[i] || 0))
      const sunH = Math.round((D.sunshine_duration[di] || 0) / 3600)
      idx.forEach(i => {
        if (H.weather_code[i] === 45 || H.weather_code[i] === 48) {
          fogHours++
          if (H.relative_humidity_2m[i] < 90) fogLowRh++
        }
      })
      if (D.weather_code[di] === 45 || D.weather_code[di] === 48) {
        fogDays++
        if (dayMax <= 3 && sunH >= 6) {
          misleading++
          rows.push(t + ' 日码=' + D.weather_code[di] + ' 白天最差=' + dayMax + ' 日照=' + sunH + 'h')
        }
      }
    })
    console.log('  [' + PTS[k][0] + '] elev=' + r.elevation + ' | 雾日 ' + fogDays + '/16 | 晴天挂雾 ' + misleading +
      ' | 雾小时 ' + fogHours + ' 其中RH<90% ' + fogLowRh)
    rows.slice(0, 6).forEach(x => console.log('      ' + x))
  })
})().catch(e => { console.error('FATAL', e); process.exit(1) })
