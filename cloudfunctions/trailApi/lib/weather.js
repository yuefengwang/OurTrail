// Open-Meteo 天气代理：按经纬度取逐小时预报，自动按活动日期切片。
// Open-Meteo 会根据坐标做海拔降尺度，山区预报比城市天气更贴近实际。
const https = require('https')

function cnToday() {
  // 云函数运行在 UTC，换算成北京时间的自然日
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('天气服务暂时不可用（' + res.statusCode + '）'))
      }
      let buf = ''
      res.on('data', c => { buf += c })
      res.on('end', () => {
        try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('天气数据解析失败')) }
      })
    })
    req.on('error', reject)
    req.setTimeout(12000, () => req.destroy(new Error('天气服务超时')))
  })
}

// 返回 { elevation, hours: [{t, temp, feels, pop, precip, code, wind, gust}] }
async function fetchForecast(lat, lng, date) {
  const diff = Math.round((Date.parse(date) - Date.parse(cnToday())) / 86400000)
  if (diff > 15) return { tooEarly: true, hours: [] } // 超出预报范围，临近出发再查
  const days = Math.min(16, Math.max(1, diff + 2))
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m',
    timezone: 'Asia/Shanghai',
    forecast_days: String(days)
  })
  const j = await fetchJson('https://api.open-meteo.com/v1/forecast?' + q.toString())
  const h = j.hourly || {}
  const hours = []
  const times = h.time || []
  for (let i = 0; i < times.length; i++) {
    if (times[i].indexOf(date) !== 0) continue
    hours.push({
      t: times[i].slice(11, 16),
      temp: (h.temperature_2m || [])[i],
      feels: (h.apparent_temperature || [])[i],
      pop: (h.precipitation_probability || [])[i],
      precip: (h.precipitation || [])[i],
      code: (h.weather_code || [])[i],
      wind: (h.wind_speed_10m || [])[i],
      gust: (h.wind_gusts_10m || [])[i]
    })
  }
  return { elevation: j.elevation, hours }
}

module.exports = { fetchForecast, cnToday }
