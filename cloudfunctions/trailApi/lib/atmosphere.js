// 大气透明度/seeing/气溶胶：星空与银河的“空气”输入。
//   · 7Timer! ASTRO：3 天、3 小时，seeing（1–8，越低越好）/ transparency（1–8，越高越好）；
//   · Open-Meteo Air Quality（CAMS）：AOD / PM2.5 / PM10，全球 45 km，逐时。
// 两者都按“可选增强”处理：缺一个只丢一个字段；全缺返回 sources 标记，不抛整条天空上下文。
// 许可：7Timer! 免费非商业（需署名）；CAMS/Open-Meteo CC BY 4.0（需署名）。
'use strict'

const { fetchJson } = require('./weather')

const SEVEN_URL = 'https://www.7timer.info/bin/astro.php'
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality'

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parseInit(init) {
  const s = String(init || '')
  if (!/^\d{10}$/.test(s)) return null
  return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10)))
}

function sevenTimerUrl(lat, lng) {
  const q = new URLSearchParams({
    lon: String(lng), lat: String(lat),
    ac: '0', unit: 'metric', output: 'json', tzshift: '0',
  })
  return SEVEN_URL + '?' + q.toString()
}

function parseSevenTimer(json) {
  if (!json || !Array.isArray(json.dataseries)) return null
  const init = parseInit(json.init)
  if (init == null) return null
  const series = json.dataseries.map(d => {
    const okta = num(d.cloudcover)
    const ms = init + Number(d.timepoint) * 3600000 + 8 * 3600000 // init 为 UTC，转北京时间
    return {
      at: new Date(ms).toISOString().slice(0, 16),
      cloudOkta: okta,
      cloudPct: okta == null ? null : Math.round((okta - 1) / 8 * 100),
      seeing: num(d.seeing),
      transparency: num(d.transparency),
      rh: num(d.rh2m),
      wind: d.wind10m ? num(d.wind10m.speed) : null,
      temp: num(d.temp2m),
      prec: d.prec_type || null,
    }
  })
  return { source: '7timer', init: json.init, series }
}

function airUrl(lat, lng) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lng),
    hourly: 'aerosol_optical_depth,pm2_5,pm10',
    forecast_days: '5',
    timezone: 'Asia/Shanghai',
  })
  return AIR_URL + '?' + q.toString()
}

function parseAir(json) {
  const h = json && json.hourly
  if (!h || !Array.isArray(h.time)) return null
  const series = h.time.map((t, i) => ({
    at: String(t).slice(0, 16),
    aod: num((h.aerosol_optical_depth || [])[i]),
    pm25: num((h.pm2_5 || [])[i]),
    pm10: num((h.pm10 || [])[i]),
  }))
  return { source: 'cams', series }
}

function filterSeries(series, date, endDate) {
  return (series || []).filter(x => {
    const d = String(x.at).slice(0, 10)
    return d >= date && d <= endDate
  })
}

async function fetchAtmosphere(lat, lng, date, endDate) {
  const [sevenRes, airRes] = await Promise.allSettled([
    fetchJson(sevenTimerUrl(lat, lng)).then(parseSevenTimer),
    fetchJson(airUrl(lat, lng)).then(parseAir),
  ])
  const sevenTimer = sevenRes.status === 'fulfilled' && sevenRes.value
    ? { source: sevenRes.value.source, init: sevenRes.value.init, series: filterSeries(sevenRes.value.series, date, endDate) }
    : null
  const air = airRes.status === 'fulfilled' && airRes.value
    ? { source: airRes.value.source, series: filterSeries(airRes.value.series, date, endDate) }
    : null
  return {
    date,
    endDate,
    sevenTimer,
    air,
    sources: {
      sevenTimer: sevenTimer ? 'ok' : 'missing',
      air: air ? 'ok' : 'missing',
    },
  }
}

module.exports = {
  SEVEN_URL, AIR_URL, parseInit, sevenTimerUrl, parseSevenTimer,
  airUrl, parseAir, filterSeries, fetchAtmosphere,
}
