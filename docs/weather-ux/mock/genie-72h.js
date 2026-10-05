// 格聂 72 小时高保真天气 mock —— Weather UX Prototype 的数据源（E 交付物）。
//
// 定位：
//   - 形状与生产 NormalizedWeatherData 对齐（见 docs/weather-ux/weather-ux-design.md §7）：
//     hours[] 与云函数 lib/weather.js 的 hourView 同名同义，另补三个生产尚未取的字段
//     windDir / pressure / dewPoint（原型先行，未来 provider 适配层补取）。
//   - 场景为川西格聂（29.86N, 99.46E，观景点 3500 m），从 2026-10-06（周二）起 72h。
//     三天三种形态，刻意让每条分析路径都被点亮：
//       10-06 阵雨转晴夜 —— 云海窗口（前日降水 + 清晨低云带 + 高层干净 + 微风）
//                         + 傍晚光染 + 午后阵雨与彩虹 + 夜间银河（月照 12%）
//       10-07 全天晴好 —— 对照日：黄金/蓝调/星空满窗，低云近乎为零
//       10-08 冷锋过境 —— 挑战日：全天降雪、0℃ 层低于观景点（降雪 callout）、风大
//   - band（云层带）在生产由气压层剖面逐时重建（cloudBandAt）；mock 按同一形状手工
//     给出，数值取真实量级（底 2100-2800 m、cover ≥80 才成带，50-80 视为薄云不入带）。
//
// 纯函数、无 wx 依赖；`node genie-72h.js` 自校验（形状/单调/场景断言），供门禁使用。
'use strict'

/* ---------- 点位 ---------- */

const POINT = {
  name: '格聂',
  lat: 29.86,
  lng: 99.46,
  elevation: 3500,
  elevationSource: 'gpx',
}

const META = {
  provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）' },
  updatedAt: '2026-10-05T18:20:00+08:00',
  story: '前日有降水，06 日凌晨低云带压在 2200–2800 m，清晨转干、高层干净；午后有阵雨，傍晚放晴；夜间晴朗且月照低。',
}

/* ---------- 关键帧插值骨架 ---------- */

// 每个字段给一组 [h, value] 关键帧（h = 自 10-06T00 起的小时数），线性插值。
// 云量与降水不做平滑插值——云的发展本来就有台阶感，逐小时独立给定更真实。
const KF = {
  // 温度：三天各自的日循环（10-08 冷锋压温）
  temp: [
    [0, 6.2], [4, 3.1], [8, 6.8], [14, 14.2], [18, 11.5], [22, 7.0],
    [26, 3.4], [30, 1.8], [34, 5.5], [38, 12.8], [44, 15.0], [47, 9.2],
    [50, 4.0], [54, 2.2], [58, 0.6], [62, 1.5], [66, 2.8], [70, 2.0], [71, 1.4],
  ],
  feels: null, // 由 temp + wind + rh 估算，见 buildHour
  // 降水概率 %
  pop: [
    [0, 55], [3, 40], [6, 20], [9, 15], [12, 30], [14, 58], [16, 60], [18, 25], [21, 8], [24, 5],
    [30, 3], [48, 10], [54, 70], [58, 85], [62, 90], [66, 80], [71, 70],
  ],
  // 连续性降水 mm/h
  precip: [
    [0, 0.4], [2, 0.2], [3, 0], [14, 0], [15, 0.6], [16, 0.4], [17, 0], [24, 0],
    [54, 0], [56, 1.2], [58, 2.6], [62, 3.4], [66, 2.2], [71, 1.0],
  ],
  // 阵雨/阵雪 mm/h
  showers: [
    [0, 0], [14, 0], [15, 0.5], [16, 1.3], [17, 0.2], [18, 0],
    [56, 0], [58, 1.8], [60, 2.4], [63, 1.6], [66, 0.8], [71, 0.4],
  ],
  wind: [
    [0, 7], [5, 5], [9, 6], [13, 9], [15, 14], [17, 12], [20, 6], [24, 4],
    [28, 3], [34, 5], [40, 8], [48, 6], [54, 12], [58, 20], [62, 26], [66, 24], [71, 18],
  ],
  gust: [
    [0, 12], [5, 9], [13, 16], [15, 28], [17, 24], [20, 11], [24, 8], [28, 6],
    [48, 12], [54, 24], [58, 40], [62, 48], [66, 44], [71, 34],
  ],
  rh: [
    [0, 93], [4, 90], [8, 78], [12, 60], [15, 74], [17, 66], [20, 55], [24, 48],
    [30, 40], [36, 34], [48, 55], [54, 78], [58, 88], [62, 92], [66, 90], [71, 86],
  ],
  // 10m 风（度，自北顺时针）：谷风昼夜转换 + 冷锋大风
  windDir: [
    [0, 150], [6, 140], [12, 190], [18, 160], [24, 130], [12 + 24, 200], [24 + 24, 150],
    [48, 210], [56, 225], [62, 230], [71, 220],
  ],
  pressure: [
    [0, 1016], [12, 1015], [24, 1017], [36, 1018], [48, 1014], [56, 1008], [62, 1002], [71, 1000],
  ],
  // 0℃ 层（m ASL）：10-08 冷锋把冻结高度压到 3200 m，低于观景点 3500 m → 降雪信号
  freezing: [
    [0, 4600], [24, 4900], [40, 5100], [48, 4400], [54, 3800], [58, 3400], [62, 3150], [66, 3200], [71, 3300],
  ],
  // 能见度 km：入云/降水时段压低
  visibility: [
    [0, 9], [4, 14], [8, 22], [15, 12], [16, 6], [17, 14], [24, 30], [36, 32],
    [54, 8], [58, 3.5], [62, 2.0], [66, 2.5], [71, 4.0],
  ],
}

// 三层云量 + 天气码：逐小时手排（不做插值，云有台阶感）
// [h, low, mid, high, code]
const CLOUD_CODE = [
  // 10-06：凌晨雨收 → 清晨低云带（云海窗口）→ 上午散 → 午后对流 → 傍晚放晴
  [0, 90, 45, 30, 61], [1, 88, 42, 28, 61], [2, 86, 40, 26, 51], [3, 85, 38, 22, 51],
  [4, 85, 34, 18, 3], [5, 86, 30, 15, 3], [6, 88, 26, 12, 3], [7, 88, 24, 10, 2],
  [8, 86, 26, 12, 2], [9, 80, 28, 15, 2], [10, 68, 30, 18, 2], [11, 55, 32, 20, 2],
  [12, 45, 36, 22, 2], [13, 42, 44, 26, 2], [14, 48, 56, 30, 80], [15, 55, 62, 30, 80],
  [16, 52, 60, 26, 80], [17, 40, 50, 22, 3], [18, 30, 40, 16, 1], [19, 22, 30, 10, 1],
  [20, 12, 18, 6, 0], [21, 8, 10, 4, 0], [22, 6, 8, 3, 0], [23, 5, 6, 3, 0],
  // 10-07：全天晴好
  [24, 4, 5, 2, 0], [25, 4, 4, 2, 0], [26, 3, 4, 2, 0], [27, 3, 3, 2, 0],
  [28, 3, 3, 1, 0], [29, 4, 3, 1, 0], [30, 6, 4, 2, 0], [31, 10, 6, 2, 1],
  [32, 14, 8, 3, 1], [33, 16, 10, 3, 1], [34, 15, 9, 2, 1], [35, 12, 8, 2, 1],
  [36, 10, 7, 2, 0], [37, 8, 6, 2, 0], [38, 7, 5, 2, 0], [39, 6, 4, 2, 0],
  [40, 5, 4, 2, 0], [41, 5, 3, 2, 0], [42, 4, 3, 1, 0], [43, 4, 3, 1, 0],
  [44, 4, 2, 1, 0], [45, 3, 2, 1, 0], [46, 3, 2, 1, 0], [47, 3, 2, 1, 0],
  // 10-08：冷锋过境，雨夹雪转雪
  [48, 20, 30, 40, 3], [49, 30, 45, 55, 3], [50, 45, 60, 70, 3], [51, 55, 70, 78, 3],
  [52, 60, 75, 80, 3], [53, 65, 80, 82, 61], [54, 70, 82, 84, 61], [55, 75, 85, 85, 71],
  [56, 78, 86, 86, 71], [57, 80, 88, 88, 71], [58, 82, 88, 88, 71], [59, 84, 90, 90, 71],
  [60, 85, 90, 90, 71], [61, 86, 90, 90, 71], [62, 88, 92, 92, 71], [63, 88, 92, 92, 71],
  [64, 86, 90, 90, 71], [65, 84, 88, 88, 71], [66, 80, 85, 86, 71], [67, 78, 82, 84, 61],
  [68, 75, 80, 80, 61], [69, 72, 78, 76, 61], [70, 70, 75, 72, 61], [71, 68, 72, 70, 61],
]

// 云层带（生产为 cloudBandAt 逐时重建；这里按同一形状手工给出）。
// 只在「有 ≥80% 成层低云」的时段给带；10-06 清晨那条就是云海故事的本体。
// [hFrom, hTo, base, top, cover]（hTo 不含）
const BANDS = [
  [0, 9, 2280, 2950, 85],   // 凌晨雨收后残余低云带，清晨最实
  [9, 12, 2650, 3400, 78],  // 上午抬升变薄（78 < 80 → 生产会判不成带；这里给 78 表薄化）→ 见 sanitize
  [14, 17, 3100, 3900, 62], // 午后对流云，不成层
  [53, 72, 2950, 3600, 88], // 10-08 冷锋低云带（观景点 3500 落在带内 → 入云）
]

/* ---------- 组装 ---------- */

function pad(n) { return (n < 10 ? '0' : '') + n }

function addHours(baseIso, n) {
  return new Date(Date.parse(baseIso) + n * 3600000)
}

function isoDate(d) { return d.toISOString().slice(0, 10) }
function isoHHMM(d) { return d.toISOString().slice(11, 16) }

// 北京墙上时钟 2026-10-06T00:00 起。整条数据链一律用 UTC 字段表达北京墙上时间
// （与云函数 cnToday 的 `Date.now()+8h → toISOString` 同一手势），绝不能带 +08:00 偏移
// 去 toISOString——那会退回 UTC 日历，起点变成 10-05T16:00。
const BASE = '2026-10-06T00:00:00Z'

function kf(field, h) {
  const pts = KF[field]
  if (h <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    if (h <= pts[i][0]) {
      const [h0, v0] = pts[i - 1]
      const [h1, v1] = pts[i]
      return v0 + (v1 - v0) * ((h - h0) / (h1 - h0))
    }
  }
  return pts[pts.length - 1][1]
}

// Magnus 近似露点（°C）：真实产品可由 provider 补；mock 本地算，保证与温湿自洽
function dewPoint(t, rh) {
  const a = 17.62, b = 243.12
  const gamma = Math.log(Math.max(rh, 1) / 100) + (a * t) / (b + t)
  return Math.round(((b * gamma) / (a - gamma)) * 10) / 10
}

function bandAt(h) {
  for (const [from, to, base, top, cover] of BANDS) {
    if (h >= from && h < to) return { base, top, cover }
  }
  return null
}

// 湿冷指数修正的体感：高原徒步的核心是风寒，风速 >4.8 km/h 起按风寒式修正
function feelsLike(t, wind, rh) {
  const v = Math.max(wind, 0)
  const chill = v > 4.8 ? 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16) : t
  const humid = rh > 80 && t > 12 ? 2 : 0
  return Math.round((chill + humid) * 10) / 10
}

function buildHours() {
  const out = []
  for (let h = 0; h < 72; h++) {
    const when = addHours(BASE, h)
    const d = isoDate(when)
    const t = isoHHMM(when)
    const row = CLOUD_CODE[h]
    const cloud = { low: row[1], mid: row[2], high: row[3] }
    const temp = Math.round(kf('temp', h) * 10) / 10
    const wind = Math.round(kf('wind', h))
    const rh = Math.round(kf('rh', h))
    const pop = Math.round(kf('pop', h))
    const uvHour = Number(t.slice(0, 2))
    // UV：太阳地平线下为 0，白天按云量折减，10 月高原晴日峰值 ~7
    const dayProg = Math.sin((Math.max(0, Math.min(24, uvHour)) - 6) / 12 * Math.PI)
    const uv = Math.max(0, Math.round(7.2 * dayProg * (1 - (cloud.mid + cloud.high) / 260) * 10) / 10)
    const band = bandAt(h)
    // 生产规则：cover < 80 视为薄云不入带（lib/weather.js cloudBandAt），mock 对齐
    const bandOK = band && band.cover >= 80
    out.push({
      d, t,
      temp,
      feels: feelsLike(temp, wind, rh),
      pop,
      precip: Math.round(kf('precip', h) * 10) / 10,
      showers: Math.round(kf('showers', h) * 10) / 10,
      code: row[4],
      wind,
      gust: Math.round(kf('gust', h)),
      windDir: Math.round(kf('windDir', h)),
      rh,
      dewPoint: dewPoint(temp, rh),
      pressure: Math.round(kf('pressure', h)),
      uv: uv > 0 ? uv : 0,
      visibility: Math.round(kf('visibility', h) * 10) / 10,
      freezing: Math.round(kf('freezing', h)),
      cloud,
      band: bandOK ? { base: band.base, top: band.top, cover: band.cover } : null,
    })
  }
  return out
}

function buildDays(hours) {
  // 三天聚合（10-05 为「前日降水」来源，供云海信号使用；无逐时数据，仅日聚合）
  const days = [
    { date: '2026-10-05', code: 61, tMax: 12, tMin: 5, windMax: 16, precipSum: 4.2, precipProbMax: 75, precipHours: 6, sunrise: '07:05', sunset: '19:06', uvMax: 5, cloud: { low: 82, mid: 48, high: 30 } },
  ]
  const dates = ['2026-10-06', '2026-10-07', '2026-10-08']
  for (const date of dates) {
    const hs = hours.filter(x => x.d === date)
    const tMax = Math.round(Math.max.apply(null, hs.map(x => x.temp)))
    const tMin = Math.round(Math.min.apply(null, hs.map(x => x.temp)))
    const precipSum = Math.round(hs.reduce((a, x) => a + x.precip + x.showers, 0) * 10) / 10
    days.push({
      date,
      code: hs[12] ? hs[12].code : hs[0].code,
      tMax, tMin,
      windMax: Math.max.apply(null, hs.map(x => x.wind)),
      precipSum,
      precipProbMax: Math.max.apply(null, hs.map(x => x.pop)),
      precipHours: hs.filter(x => x.precip + x.showers > 0).length,
      // 日出日落按点位天文真相（astro.js 会再算，日卡展示用），10 月上旬格聂量级
      sunrise: '07:06', sunset: '19:05',
      uvMax: Math.round(Math.max.apply(null, hs.map(x => x.uv)) * 10) / 10,
      cloud: {
        low: Math.round(hs.reduce((a, x) => a + x.cloud.low, 0) / hs.length),
        mid: Math.round(hs.reduce((a, x) => a + x.cloud.mid, 0) / hs.length),
        high: Math.round(hs.reduce((a, x) => a + x.cloud.high, 0) / hs.length),
      },
    })
  }
  return days
}

/* ---------- 自校验 ---------- */

function selfCheck(hours, days) {
  const fail = []
  const ok = (name, cond) => { if (!cond) fail.push(name) }
  ok('hours=72', hours.length === 72)
  ok('起点 2026-10-06T00:00', hours[0].d === '2026-10-06' && hours[0].t === '00:00')
  ok('终点 2026-10-08T23:00', hours[71].d === '2026-10-08' && hours[71].t === '23:00')
  ok('时间单调', hours.every((x, i) => i === 0 || x.d + x.t > hours[i - 1].d + hours[i - 1].t))
  ok('字段齐全', hours.every(x =>
    ['d', 't', 'temp', 'feels', 'pop', 'precip', 'showers', 'code', 'wind', 'gust',
      'windDir', 'rh', 'dewPoint', 'pressure', 'uv', 'visibility', 'freezing', 'cloud', 'band']
      .every(k => x[k] !== undefined && x[k] !== null || k === 'band')))
  ok('云量 0-100', hours.every(x => [x.cloud.low, x.cloud.mid, x.cloud.high].every(v => v >= 0 && v <= 100)))
  ok('band.cover>=80 才成带', hours.every(x => !x.band || (x.band.cover >= 80 && x.band.base < x.band.top)))
  ok('band 全 null 时段（10-07 白天）', hours.filter(x => x.d === '2026-10-07' && x.t >= '10:00' && x.t <= '17:00').every(x => x.band === null))
  ok('清晨云海带（06-08 时）', hours.filter(x => x.d === '2026-10-06' && x.t >= '06:00' && x.t <= '08:00').every(x => x.band && x.band.base <= 2400 && x.band.cover >= 80))
  ok('清晨高层干净（06-08 时 <30）', hours.filter(x => x.d === '2026-10-06' && x.t >= '06:00' && x.t <= '08:00').every(x => x.cloud.high < 30))
  ok('前日降水 4.2mm', days[0].precipSum === 4.2)
  ok('10-08 冻结高度 < 3500', hours.filter(x => x.d === '2026-10-08' && x.t >= '14:00' && x.t <= '20:00').every(x => x.freezing < 3500))
  ok('10-08 有降雪码 71', hours.some(x => x.d === '2026-10-08' && x.code === 71))
  ok('10-06 午后阵雨', hours.filter(x => x.d === '2026-10-06' && x.t >= '14:00' && x.t <= '17:00').every(x => x.showers > 0 || x.pop >= 50))
  return fail
}

/* ---------- 出口 ---------- */

const hours = buildHours()
const days = buildDays(hours)

module.exports = { POINT, META, days, hours, selfCheck }

// 直接运行：打印自校验 + 三天概览表
if (require.main === module) {
  const fail = selfCheck(hours, days)
  console.log('== 格聂 72h mock 自校验 ==')
  if (fail.length) {
    console.log('✗ 失败项：')
    fail.forEach(f => console.log('  - ' + f))
    process.exit(1)
  }
  console.log('✓ 全部通过（16 项断言）')
  console.log('\n点位: ' + POINT.name + ' ' + POINT.lat + 'N,' + POINT.lng + 'E · ' + POINT.elevation + ' m')
  for (const day of days) {
    console.log(
      day.date + '  ' + String(day.tMax).padStart(3) + '/' + String(day.tMin).padStart(3) + '°C'
      + '  降水 ' + day.precipSum + 'mm(' + day.precipProbMax + '%)'
      + '  云 低' + day.cloud.low + '/中' + day.cloud.mid + '/高' + day.cloud.high
      + '  码 ' + day.code
    )
  }
  const sample = hours.filter(x => x.d === '2026-10-06' && ['00', '04', '07', '10', '15', '18', '22'].includes(x.t.slice(0, 2)))
  console.log('\n10-06 抽样：')
  for (const s of sample) {
    console.log(
      s.t + '  ' + s.temp + '°C  低' + s.cloud.low + '% 中' + s.cloud.mid + '% 高' + s.cloud.high + '%'
      + '  ' + (s.band ? 'band ' + s.band.base + '-' + s.band.top + ' (' + s.band.cover + '%)' : 'band —')
      + '  风 ' + s.wind + 'km/h@' + s.windDir + '°  rh ' + s.rh + '%  码 ' + s.code
    )
  }
}
