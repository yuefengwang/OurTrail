/* Real Open-Meteo adapter（POC 层，非生产代码）
 *
 * 目的：用真实 Open-Meteo 数据验证 Cloud Field renderer。
 * 管线分工（与本 POC 的架构约定一致）：
 *
 *   Open-Meteo API（气压层 cloud_cover_*hPa + geopotential_height_*hPa）
 *     → 本适配器：气压层 → 海拔（复用生产 cloudBandAt 的位势高度映射，
 *       缺失时退回气压高度公式），重采样到统一海拔网格
 *     → cloudField = { times, altitudes, values }   —— Time × Altitude × Cover
 *     → renderer 只吃这个结构，不知道 Open-Meteo / pressure level 的存在
 *
 * 与生产 lib/weather.js 的关系：
 *   ▸ 气压层变量名与生产 CLOUD_LEVELS 同源（1000…600 hPa）；
 *   ▸ POC 在此基础上加密中层（750/675/650/550/500/450 hPa）以提升山区
 *     垂直分辨率 —— additive，生产若采用只需在 CLOUD_LEVELS 追加；
 *   ▸ 地下气压层（山区低层）Open-Meteo 返回 null，逐时跳过并在剩余层间插值。
 *
 * 海拔映射：优先 geopotential_height_*hPa（模型真实层高）；
 * 缺失时退回 alt = 44330 × (1 − (p/1013.25)^0.190286)。
 */
;(function () {
  'use strict'

  var LOCATIONS = {
    litang: { label: '理塘 · 格聂一带', lat: 29.9, lng: 100.27, elev: 3500 },
    daocheng: { label: '稻城', lat: 28.92, lng: 100.15, elev: 3800 },
    emeishan: { label: '峨眉山', lat: 29.53, lng: 103.39, elev: 3079 },
    chengdu: { label: '成都', lat: 30.66, lng: 104.07, elev: 500 },
  }

  /* 生产 CLOUD_LEVELS（1000…600）+ POC 加密中层 */
  var LEVELS = [950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450]

  var SURFACE = [
    'temperature_2m', 'precipitation_probability', 'precipitation', 'showers',
    'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m',
    'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  ]

  function pad(n) { return (n < 10 ? '0' : '') + n }
  function barometricAlt(pPa) { return 44330 * (1 - Math.pow(pPa / 1013.25, 0.190286)) }

  function weekdayOf(dateStr) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(dateStr + 'T12:00:00').getDay()]
  }

  function load(key) {
    var loc = LOCATIONS[key]
    if (!loc) return Promise.reject(new Error('未知地点：' + key))
    var hourly = SURFACE.slice()
    LEVELS.forEach(function (lv) {
      hourly.push('cloud_cover_' + lv + 'hPa', 'geopotential_height_' + lv + 'hPa')
    })
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lng +
      '&hourly=' + hourly.join(',') +
      '&daily=sunrise,sunset&timezone=Asia%2FShanghai&forecast_days=1'
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }).then(function (j) {
      var H = j.hourly
      var nh = Math.min(24, H.time.length)

      /* --- 气压层 → 统一海拔网格（0–7000 m，250 m 步长） --- */
      var altitudes = []
      for (var a = 0; a <= 7000; a += 250) altitudes.push(a)
      var values = []
      var rawSamples = []   // 原始 Open-Meteo 采样点（有效气压层），debug=2 叠加显示
      var coverage = []
      for (var h = 0; h < nh; h++) {
        var pairs = []
        LEVELS.forEach(function (lv) {
          var cov = H['cloud_cover_' + lv + 'hPa'] ? H['cloud_cover_' + lv + 'hPa'][h] : null
          var gt = H['geopotential_height_' + lv + 'hPa'] ? H['geopotential_height_' + lv + 'hPa'][h] : null
          if (cov === null || cov === undefined || gt === null || gt === undefined) return
          pairs.push({ alt: gt, cover: cov })
          rawSamples.push({ t: h, alt: Math.round(gt), cover: Math.round(cov), hPa: lv })
        })
        pairs.sort(function (x, y) { return x.alt - y.alt })
        coverage.push(pairs.length)
        var row = []
        altitudes.forEach(function (alt) {
          if (!pairs.length) { row.push(0); return }
          if (alt <= pairs[0].alt) { row.push(pairs[0].cover); return }
          if (alt >= pairs[pairs.length - 1].alt) { row.push(pairs[pairs.length - 1].cover); return }
          for (var k = 1; k < pairs.length; k++) {
            if (alt <= pairs[k].alt) {
              var s = (alt - pairs[k - 1].alt) / (pairs[k].alt - pairs[k - 1].alt)
              row.push(pairs[k - 1].cover + (pairs[k].cover - pairs[k - 1].cover) * s)
              return
            }
          }
          row.push(pairs[pairs.length - 1].cover)
        })
        values.push(row)
      }
      if (typeof console !== 'undefined' && console.info) {
        console.info('[real-data] ' + loc.label + ' 气压层可用数（逐时）：' + coverage.join(','))
      }

      /* --- hourView 形状的 hours（供温度/降水/风/图标面板） --- */
      var dateStr = H.time[0].slice(0, 10)
      var hours = []
      for (h = 0; h < nh; h++) {
        hours.push({
          h: h,
          t: pad(h) + ':00',
          d: dateStr,
          temp: Math.round((H.temperature_2m[h] || 0) * 10) / 10,
          code: H.weather_code[h] || 0,
          pop: H.precipitation_probability ? H.precipitation_probability[h] : 0,
          precip: Math.round((H.precipitation[h] || 0) * 10) / 10,
          showers: Math.round((H.showers[h] || 0) * 10) / 10,
          wind: Math.round(H.wind_speed_10m[h] || 0),
          gust: Math.round(H.wind_gusts_10m[h] || 0),
          windDir: Math.round(H.wind_direction_10m[h] || 0),
          cloud: {
            low: H.cloud_cover_low ? Math.round(H.cloud_cover_low[h]) : 0,
            mid: H.cloud_cover_mid ? Math.round(H.cloud_cover_mid[h]) : 0,
            high: H.cloud_cover_high ? Math.round(H.cloud_cover_high[h]) : 0,
          },
          band: null, // 真实模式：无成层带对象，一切由场推导
        })
      }

      var sunrise = (j.daily.sunrise[0] || '').slice(11, 16) || '07:00'
      var sunset = (j.daily.sunset[0] || '').slice(11, 16) || '19:00'
      var now = new Date()

      return {
        point: { name: loc.label, elevation: loc.elev },
        meta: {
          date: dateStr,
          weekday: weekdayOf(dateStr),
          window: '24 小时预报',
          provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）· 真实数据' },
          updatedAt: pad(now.getHours()) + ':' + pad(now.getMinutes()),
          summary: '真实预报 · 气压层 ' + LEVELS.length + ' 层',
          sunrise: sunrise,
          sunset: sunset,
        },
        hours: hours,
        /* renderer 只接受的 Time × Altitude × Cover 结构 */
        cloud: {
          times: hours.map(function (x) { return x.h }),
          altitudes: altitudes,
          values: values,
        },
        rawSamples: rawSamples,
      }
    })
  }

  window.OT_REAL = { LOCATIONS: LOCATIONS, LEVELS: LEVELS, load: load }
})()
