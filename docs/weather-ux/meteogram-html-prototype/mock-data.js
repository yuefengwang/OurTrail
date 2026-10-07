/* OurTrail Weather Meteogram Prototype · Mock 数据（浏览器全局 window.OT_MOCK）
 *
 * 场景：川西 格聂（29.86°N, 99.46°E，观景点 3,500 m），2026-10-06（周二）全天 24 小时。
 * 手工设计的高保真 mock：字段形状对齐生产 hourView / NormalizedWeatherData
 * （docs/weather-ux/weather-ux-design.md §7 与 mock/genie-72h.js 同源同义），
 * 本轮按原型验证需求重排当天故事线，刻意让云层三种状态在 24h 内全部出现：
 *
 *   00–10h  雨后残余低云带压在 2,260–3,300 m（云顶 < 观景点 3,500 m → 「云在脚下」，
 *           日出 07:06 前后云海最盛，随后抬升消散）
 *   11–14h  低云散去、短暂晴朗，中午起对流云发展（中云量 44%→62%）
 *   15–18h  对流云团过境：云底 3,120–3,300 / 云顶 3,820–3,950（罩住观景点 →
 *           「你在云中」），伴阵雨 1.2–2.2 mm/h，阵风峰值 29 km/h
 *   19–23h  低云散去、中高云残留（「云在头顶」），夜间转晴冷（月夜）
 *
 * 山地量级校准：温度 3.1–14.1 °C；谷风昼夜转换（夜间 SE 5–7 km/h → 午后 SW 24 km/h）；
 * 湿度 52–93%；能见度随入云压到 10 km。band.cover=72%（10h）是刻意超出生产
 * 「cover≥80 才成带」规则的消散时段，用于验证薄带的可视化，生产不会产生。
 *
 * 纯静态数据 + 两个派生字段（体感/露点，本地计算保证自洽），无任何依赖。
 */
'use strict'

;(function () {
  var POINT = {
    name: '格聂',
    lat: 29.86,
    lng: 99.46,
    elevation: 3500,
    elevationSource: 'gpx',
  }

  var META = {
    date: '2026-10-06',
    weekday: '周二',
    window: '24 小时展望',
    provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）· 模拟数据' },
    updatedAt: '10-05 18:20',
    summary: '多云 · 晨间低云 · 午后阵雨',
    sunrise: '07:06',
    sunset: '19:05',
  }

  /* 每小时一行：
   * [temp, code, low, mid, high, band[base,top,cover]|null,
   *  precip, showers, pop, wind, gust, windDir, rh, visKm, freezing, pressure, uv]
   * 云量（low/mid/high）与 band 逐小时手排，不做插值——云的发展本就有台阶感。 */
  var ROWS = [
    // 00–03 凌晨：毛雨收尾，残余低云带 + 中云降水层
    [6.2, 61, 88, 45, 30, [2280, 2950, 86], 0.3, 0, 55, 7, 12, 150, 93, 9, 4680, 1016, 0],
    [5.4, 61, 88, 45, 28, [2280, 2950, 86], 0.2, 0, 50, 6, 11, 148, 93, 9, 4680, 1016, 0],
    [4.7, 51, 86, 42, 25, [2300, 2980, 87], 0.1, 0, 45, 6, 10, 146, 92, 11, 4690, 1015, 0],
    [4.1, 51, 88, 34, 26, [2320, 3000, 88], 0.1, 0, 42, 6, 10, 144, 92, 12, 4700, 1015, 0],
    // 04–07 黎明前最冷；日出 07:06 云海最盛
    [3.6, 3, 87, 36, 18, [2340, 3020, 88], 0, 0, 35, 5, 9, 142, 91, 14, 4700, 1016, 0],
    [3.2, 3, 88, 32, 15, [2300, 2980, 89], 0, 0, 30, 5, 8, 140, 91, 16, 4710, 1016, 0],
    [3.1, 2, 90, 28, 12, [2280, 2950, 90], 0, 0, 25, 5, 8, 138, 90, 18, 4720, 1017, 0],
    [3.8, 2, 90, 26, 10, [2260, 2920, 90], 0, 0, 20, 5, 9, 136, 88, 22, 4730, 1017, 0.1],
    // 08–11 云带抬升变薄 → 消散，短暂晴朗；09h 中云先行发展（与低云不同步）
    [5.6, 2, 86, 26, 12, [2300, 3000, 86], 0, 0, 15, 6, 9, 134, 84, 24, 4740, 1017, 0.7],
    [7.4, 2, 74, 36, 15, [2400, 3100, 80], 0, 0, 12, 8, 11, 132, 80, 26, 4750, 1017, 1.4],
    [9.2, 2, 68, 30, 18, [2600, 3300, 72], 0, 0, 12, 10, 13, 130, 74, 26, 4760, 1016, 2.2],
    [10.8, 1, 55, 32, 20, null, 0, 0, 15, 10, 13, 128, 68, 28, 4770, 1015, 3.0],
    // 12–14 对流发展；14h 云底尚未组织成带
    [12.2, 1, 45, 36, 22, null, 0, 0, 20, 11, 14, 150, 62, 30, 4780, 1014, 3.6],
    [13.4, 2, 40, 52, 30, null, 0, 0, 30, 12, 16, 170, 60, 28, 4770, 1013, 3.4],
    [14.1, 2, 48, 56, 30, null, 0, 0, 45, 14, 20, 190, 56, 24, 4760, 1012, 2.6],
    // 15–18 对流云团过境：罩住观景点 + 阵雨（「你在云中」）
    [13.6, 80, 55, 62, 30, [3150, 3850, 82], 0, 1.2, 58, 18, 26, 210, 54, 18, 4740, 1011, 1.6],
    [12.4, 80, 58, 66, 28, [3120, 3820, 86], 0.2, 1.8, 60, 22, 28, 225, 52, 12, 4720, 1010, 0.8],
    [11.2, 61, 55, 62, 26, [3150, 3880, 88], 0.4, 1.4, 60, 24, 29, 235, 52, 10, 4700, 1009, 0.3],
    [10.2, 61, 45, 50, 22, [3300, 3950, 80], 0.2, 0.5, 50, 18, 20, 215, 52, 14, 4700, 1010, 0.1],
    // 19–23 低云散、中高云残留 → 晴冷月夜；19h 中云先逗留（不同步消散）
    [9.1, 2, 30, 46, 22, null, 0, 0, 30, 12, 15, 170, 54, 20, 4710, 1011, 0],
    [8.0, 2, 24, 32, 14, null, 0, 0, 18, 8, 11, 140, 55, 26, 4720, 1012, 0],
    [6.8, 1, 18, 26, 10, null, 0, 0, 10, 7, 10, 120, 58, 30, 4730, 1013, 0],
    [5.8, 0, 8, 14, 5, null, 0, 0, 6, 6, 9, 110, 60, 32, 4740, 1013, 0],
    [5.0, 0, 5, 10, 4, null, 0, 0, 5, 6, 8, 105, 62, 34, 4750, 1014, 0],
  ]

  /* ---- 派生字段：风寒式体感 + Magnus 露点（与 mock/genie-72h.js 同一公式） ---- */

  function feelsLike(t, wind, rh) {
    var v = Math.max(wind, 0)
    var chill = v > 4.8
      ? 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16)
      : t
    var humid = rh > 80 && t > 12 ? 2 : 0
    return Math.round((chill + humid) * 10) / 10
  }

  function dewPoint(t, rh) {
    var a = 17.62, b = 243.12
    var gamma = Math.log(Math.max(rh, 1) / 100) + (a * t) / (b + t)
    return Math.round(((b * gamma) / (a - gamma)) * 10) / 10
  }

  function pad(n) { return (n < 10 ? '0' : '') + n }

  var hours = ROWS.map(function (r, h) {
    return {
      h: h,
      t: pad(h) + ':00',
      temp: r[0],
      code: r[1],
      cloud: { low: r[2], mid: r[3], high: r[4] },
      band: r[5] ? { base: r[5][0], top: r[5][1], cover: r[5][2] } : null,
      precip: r[6],
      showers: r[7],
      pop: r[8],
      wind: r[9],
      gust: r[10],
      windDir: r[11],
      rh: r[12],
      visibility: r[13],
      freezing: r[14],
      pressure: r[15],
      uv: r[16],
      feels: feelsLike(r[0], r[9], r[12]),
      dewPoint: dewPoint(r[0], r[12]),
    }
  })

  /* ---- 自检（浏览器 console.assert；打开页面即验证） ---- */

  function selfCheck() {
    var ok = true
    function a(name, cond) { if (!cond) { console.warn('[mock] ✗ ' + name); ok = false } }
    a('hours=24', hours.length === 24)
    a('温度谷值在 06h', hours[6].temp === 3.1)
    a('温度峰值在 14h', hours[14].temp === 14.1)
    a('凌晨云在脚下（band 顶 < 3500）', hours.slice(0, 10).every(function (x) { return x.band && x.band.top < 3500 }))
    a('午后你在云中（band 罩住 3500）', hours.slice(15, 19).every(function (x) { return x.band && x.band.base < 3500 && x.band.top > 3500 }))
    a('傍晚云在头顶（无带 + 中高云）', hours.slice(19, 22).every(function (x) { return !x.band && x.cloud.mid >= 22 }))
    a('午后有阵雨', hours.slice(15, 18).every(function (x) { return x.showers > 0 }))
    a('风向随谷风转换（夜 SE→午后 SW）', hours[2].windDir < 160 && hours[17].windDir > 210)
    a('阵风峰值随对流', Math.max.apply(null, hours.map(function (x) { return x.gust })) === 29)
    return ok
  }

  window.OT_MOCK = { point: POINT, meta: META, hours: hours, selfCheck: selfCheck }
})()
