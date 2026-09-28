// 天文计算回归测试：node tools/astro-test.js
// 验证太阳位置/日出日落/暮光/摄影窗口/银心方位/月相。
// 断言用物理不变量 + 已知城市经验值（容差 ±8 分钟，算法本身误差 ±2 分钟）。
'use strict'
const A = require('../miniprogram/utils/astro')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol
// 'HH:mm' → 分钟
function min(s) {
  if (!s) return NaN
  const p = s.split(':')
  return Number(p[0]) * 60 + Number(p[1])
}
function section(t) { console.log('== ' + t + ' ==') }

const CD = [30.67, 104.07]   // 成都
const QD = [36.07, 120.38]   // 青岛（更靠东，日出更早）
const WLMQ = [43.83, 87.62]  // 乌鲁木齐

// 太阳正午（北京时间分钟）：真太阳时 720 分对应当地钟表时
function solarNoonMin(dateStr, lat, lng) {
  return 720 - A.solarTerms(dateStr).eqTime + 480 - 4 * lng
}
const cnMsAtSolarNoon = (dateStr, lat, lng) => A.cnToMs(dateStr, A.hhmm(solarNoonMin(dateStr, lat, lng)))

section('1. 日出日落顺序与昼长')
{
  const t = A.sunTimes('2026-09-28', CD[0], CD[1], 500)
  check('天文晨光始 < 航海晨光始 < 民用晨光始 < 日出', min(t.astroDawn) < min(t.nauticalDawn) && min(t.nauticalDawn) < min(t.civilDawn) && min(t.civilDawn) < min(t.sunrise), JSON.stringify(t))
  check('日落 < 民用暮光终 < 航海暮光终 < 天文暮光终', min(t.sunset) < min(t.civilDusk) && min(t.civilDusk) < min(t.nauticalDusk) && min(t.nauticalDusk) < min(t.astroDusk))
  check('成都 9/28 昼长约 12 小时（' + (t.dayLengthMin / 60).toFixed(2) + 'h）', near(t.dayLengthMin, 12 * 60, 8))
  // 成都 104.07°E，比 120°E 标准子午线晚 63.7 分钟，日出应明显晚于北京（约 06:06）
  check('成都日出 06:45–07:10（' + t.sunrise + '）', min(t.sunrise) > 405 && min(t.sunrise) < 430)
  check('成都日落 18:45–19:05（' + t.sunset + '）', min(t.sunset) > 1125 && min(t.sunset) < 1145)
}

section('2. 与经验值对照（±8 分钟）')
{
  // 经度差 16.3° ≈ 65 分钟，青岛日出应显著早于成都
  const cd = A.sunTimes('2026-09-28', CD[0], CD[1], 0)
  const qd = A.sunTimes('2026-09-28', QD[0], QD[1], 0)
  check('青岛日出早于成都（' + qd.sunrise + ' vs ' + cd.sunrise + '）', min(qd.sunrise) < min(cd.sunrise) - 40)
  check('青岛日出 05:40–06:00（' + qd.sunrise + '）', min(qd.sunrise) > 340 && min(qd.sunrise) < 360)
  const w = A.sunTimes('2026-09-28', WLMQ[0], WLMQ[1], 0)
  check('乌鲁木齐更晚（' + w.sunrise + '）', min(w.sunrise) > min(cd.sunrise) + 40)
  const summer = A.sunTimes('2026-06-21', CD[0], CD[1], 0)
  const winter = A.sunTimes('2026-12-21', CD[0], CD[1], 0)
  check('成都 6/21 昼长 > 14h（' + (summer.dayLengthMin / 60).toFixed(2) + 'h）', summer.dayLengthMin > 14 * 60)
  check('成都 12/21 昼长 < 10.5h（' + (winter.dayLengthMin / 60).toFixed(2) + 'h）', winter.dayLengthMin < 10.5 * 60)
}

section('3. 海拔俯角修正：高处日出更早、日落更晚')
{
  const sea = A.sunTimes('2026-09-28', CD[0], CD[1], 0)
  const mtn = A.sunTimes('2026-09-28', CD[0], CD[1], 3500)
  check('3500m 俯角约 1.90°（' + mtn.dip + '）', near(mtn.dip, 1.90, 0.05))
  check('3500m 日出早于海平面（' + mtn.sunrise + ' vs ' + sea.sunrise + '）', min(mtn.sunrise) < min(sea.sunrise))
  check('3500m 日落晚于海平面（' + mtn.sunset + ' vs ' + sea.sunset + '）', min(mtn.sunset) > min(sea.sunset))
  check('俯角未加到暮光角上（天文暮光与海平面一致）', mtn.astroDawn === sea.astroDawn)
}

section('4. 太阳位置：正午高度角与方位')
{
  // 夏至正午 ≈ 90 - 纬 + 23.44；冬至 ≈ 90 - 纬 - 23.44（须取真太阳时正午，不是钟表 12:00）
  const summer = A.solarPosition(cnMsAtSolarNoon('2026-06-21', CD[0], CD[1]), CD[0], CD[1])
  const winter = A.solarPosition(cnMsAtSolarNoon('2026-12-21', CD[0], CD[1]), CD[0], CD[1])
  check('夏至正午高度角约 82.8°（' + summer.altitude + '）', near(summer.altitude, 82.77, 1.0))
  check('冬至正午高度角约 35.9°（' + winter.altitude + '）', near(winter.altitude, 35.89, 1.0))
  check('夏至正午方位为正南（' + summer.azimuth + '）', near(summer.azimuth, 180, 2))
  check('冬至正午方位为正南（' + winter.azimuth + '）', near(winter.azimuth, 180, 2))
  // 钟表 12:00 早于成都真太阳时正午（约 13:05），太阳应在东南
  const noon = A.solarPosition(A.cnToMs('2026-06-21', '12:00'), CD[0], CD[1])
  check('钟表正午前太阳在东南（' + noon.azimuth + '）', noon.azimuth > 90 && noon.azimuth < 135)
  // 日出时方位应在东侧偏北
  const sun = A.sunTimes('2026-09-28', CD[0], CD[1], 0)
  const rise = A.solarPosition(A.cnToMs('2026-09-28', sun.sunrise), CD[0], CD[1])
  check('日出时高度角在 0° 附近（' + rise.altitude + '）', rise.altitude > -3 && rise.altitude < 4)
  check('日出时方位在东偏北（' + rise.azimuth + '）', rise.azimuth > 60 && rise.azimuth < 115)
  const m = A.solarPosition(A.cnToMs('2026-09-28', '12:53'), CD[0], CD[1])
  check('9 月真太阳正午方位为正南（' + m.azimuth + '）', near(m.azimuth, 180, 8))
  check('正午高度角为全天最高附近（' + m.altitude + '）', m.altitude > A.solarPosition(A.cnToMs('2026-09-28', '09:00'), CD[0], CD[1]).altitude)
}

section('5. 摄影窗口（黄金/蓝调）')
{
  const w = A.photoWindows('2026-09-28', CD[0], CD[1], 500)
  const sun = A.sunTimes('2026-09-28', CD[0], CD[1], 500)
  check('晨黄金 = 日出 → 日出后 +6°', w.morningGolden && min(w.morningGolden.from) === min(sun.sunrise) && min(w.morningGolden.to) > min(sun.sunrise) && min(w.morningGolden.to) - min(sun.sunrise) < 50, JSON.stringify(w.morningGolden))
  check('昏黄金 = 日落前 +6° → 日落', w.eveningGolden && min(w.eveningGolden.to) === min(sun.sunset) && min(w.eveningGolden.from) < min(sun.sunset) && min(sun.sunset) - min(w.eveningGolden.from) < 50, JSON.stringify(w.eveningGolden))
  check('黎明蓝调起点 = 民用晨光（-6°）', w.dawnBlue && min(w.dawnBlue.from) === min(sun.civilDawn), JSON.stringify(w.dawnBlue))
  check('黎明蓝调在民用晨光之后结束（-4°）', w.dawnBlue && min(w.dawnBlue.to) > min(sun.civilDawn) && min(w.dawnBlue.to) < min(sun.sunrise))
  check('黄昏蓝调终点 = 民用暮光（-6°）', w.duskBlue && min(w.duskBlue.to) === min(sun.civilDusk), JSON.stringify(w.duskBlue))
  check('黄昏蓝调在日落之后（-4°→-6°）', w.duskBlue && min(w.duskBlue.from) > min(sun.sunset) && min(w.duskBlue.from) < min(sun.civilDusk))
  check('蓝调时段较短（3–30 分钟）', w.dawnBlue && min(w.dawnBlue.to) - min(w.dawnBlue.from) >= 3 && min(w.dawnBlue.to) - min(w.dawnBlue.from) < 30)
  check('黄金时段长于蓝调', min(w.morningGolden.to) - min(w.morningGolden.from) > min(w.dawnBlue.to) - min(w.dawnBlue.from))
}

section('6. 月相')
{
  const m = A.moonInfo('2026-09-28')
  check('月龄在 0–29.5 之间（' + m.age + '）', m.age >= 0 && m.age < 29.6)
  check('照亮百分比在 0–100 之间（' + m.illumination + '）', m.illumination >= 0 && m.illumination <= 100)
  // 一个朔望月后月龄复现（29.53 天；日期取整带来 ±0.5 天）
  const a = A.moonInfo('2026-09-30')
  const b = A.moonInfo(new Date(Date.parse('2026-09-30T12:00:00Z') + 29.53 * 86400000).toISOString().slice(0, 10))
  check('朔望月后月龄复现（' + a.age + ' → ' + b.age + '）', Math.abs(a.age - b.age) <= 1)
  check('朔望月后相名一致（' + a.name + ' / ' + b.name + '）', a.name === b.name)
  // 全年必然出现满月与新月
  let maxIll = 0
  let minIll = 100
  for (let d = 0; d < 365; d++) {
    const dt = new Date(Date.parse('2026-01-01T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const mm = A.moonInfo(dt).illumination
    if (mm > maxIll) maxIll = mm
    if (mm < minIll) minIll = mm
  }
  check('一年内存在满月（' + maxIll + '%）', maxIll >= 99)
  check('一年内存在新月（' + minIll + '%）', minIll <= 1)
  check('月相名合法', ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'].indexOf(m.name) !== -1, m.name)
  // 照亮度只由月龄决定：月龄 14.65 天（满月）附近应接近 100%
  let bestIll = 0
  let bestAge = 0
  for (let d = 0; d < 30; d++) {
    const dt = new Date(Date.parse('2026-01-01T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
    const mm = A.moonInfo(dt)
    if (mm.illumination > bestIll) { bestIll = mm.illumination; bestAge = mm.age }
  }
  check('照亮度峰值出现在月龄 14–15 天（' + bestAge + '）', bestAge > 13.5 && bestAge < 15.5, '峰值月龄 ' + bestAge)
}

section('7. 银心季节与方位')
{
  check('7 月为银心季', A.galaxySeason('2026-07-15') === true)
  check('1 月不是银心季', A.galaxySeason('2026-01-15') === false)
  check('12 月不是银心季', A.galaxySeason('2026-12-15') === false)
  const b1 = A.galaxyBearing('2026-07-15', 22)
  const b2 = A.galaxyBearing('2026-07-15', 25)
  const b3 = A.galaxyBearing('2026-07-15', 28)
  check('银心方位随时推移（' + b1 + '→' + b2 + '→' + b3 + '）', b1 < b2 && b2 < b3)
  check('入夜在东南（105–130°）', b1 >= 100 && b1 <= 135)
  check('凌晨在西南（215–240°）', b3 >= 210 && b3 <= 245)
  check('非银心季返回 null', A.galaxyBearing('2026-01-15', 23) === null)
  check('跨零点仍单调（01:00 接 24:00）', A.galaxyBearing('2026-07-15', 1) === A.galaxyBearing('2026-07-15', 25))
}

section('8. 观星结论')
{
  const clear = [{ t: '22:00', cloud: { low: 5, mid: 10, high: 15 }, precip: 0 }]
  const cloudy = [{ t: '22:00', cloud: { low: 80, mid: 90, high: 95 }, precip: 1 }]
  const dark = A.moonInfo('2026-07-15')
  const okStar = A.starSight(clear, { illumination: 10, name: '残月' }, true)
  const badStar = A.starSight(cloudy, { illumination: 10, name: '残月' }, true)
  check('晴朗 + 月照低 → 星空条件好', okStar.star.tone === 'success', okStar.star.text)
  check('晴朗 + 银心季 + 月照低 → 银河概率大', okStar.galaxy.tone === 'success', okStar.galaxy.text)
  check('多云 → 观星条件差', badStar.star.tone === 'warning' && /条件差/.test(badStar.star.text), badStar.star.text)
  check('无数据 → 数据不足', /数据不足/.test(A.starSight([], dark, true).star.text))
  check('非银心季文案', /不在银心季节/.test(A.starSight(clear, { illumination: 10, name: '残月' }, false).galaxy.text))
}

section('9. 方位短语与工具函数')
{
  check('0° → 正北', A.bearingLabel(0) === '正北')
  check('90° → 正东', A.bearingLabel(90) === '正东')
  check('180° → 正南', A.bearingLabel(180) === '正南')
  check('315° → 西北', A.bearingLabel(315) === '西北')
  check('非有限值返回空串', A.bearingLabel(NaN) === '')
  check('cnToMs 固定 +08:00', A.cnToMs('2026-09-28', '06:00') === Date.parse('2026-09-27T22:00:00Z'))
  check('hhmm 归一化跨日', A.hhmm(1500) === '01:00')
  check('horizonDip 海平面为 0', A.horizonDip(0) === 0)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
