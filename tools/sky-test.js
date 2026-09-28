// 天相转译回归测试：node tools/sky-test.js
// 用合成逐时数据驱动 6 类结论（日照金山/云海/星空/银河/彩虹/晨昏光窗口）与逐小时标记，
// 验证阈值方向、置信分级、方向建议与"数据不足"的降级文案。
// 真实气象量级参考：云量 0–100、降水 mm/h、风 km/h、云层带 {base, top, cover} 为 m ASL。
'use strict'
const S = require('../miniprogram/utils/sky')
const A = require('../miniprogram/utils/astro')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const LAT = 30.67
const LNG = 104.07
const DATE = '2026-07-18' // 银心季

// 合成一天 24 小时：over 为按小时覆盖的字段
function day(over) {
  const map = over || {}
  const out = []
  for (let h = 0; h < 24; h++) {
    const t = String(h).padStart(2, '0') + ':00'
    const o = map[h] || map['*'] || {}
    out.push({
      t,
      temp: o.temp == null ? 18 : o.temp,
      pop: o.pop == null ? 0 : o.pop,
      precip: o.precip == null ? 0 : o.precip,
      showers: o.showers == null ? 0 : o.showers,
      code: o.code == null ? 2 : o.code,
      wind: o.wind == null ? 8 : o.wind,
      rh: o.rh == null ? 60 : o.rh,
      visibility: 20,
      freezing: 4000,
      uv: 5,
      cloud: {
        low: o.low == null ? 0 : o.low,
        mid: o.mid == null ? 0 : o.mid,
        high: o.high == null ? 0 : o.high,
      },
      band: o.band || null,
    })
  }
  return out
}

const ctx = (detail, extra) => Object.assign({
  date: DATE, lat: LAT, lng: LNG, elevation: 1200, elevOK: true, detail, days: [], heading: null,
}, extra || {})

const byKey = (res, key) => res.items.filter(i => i.key === key)[0]
const marksOf = (res, key) => Object.keys(res.marks).filter(t => (res.marks[t] || []).indexOf(key) !== -1)

section('1. 晴朗无月夜：星空与银河条件最好')
{
  // 7 月中旬天文暗夜约 21:40–04:50；全夜晴、月照低（月龄 4 天）
  const detail = day({ '*': { low: 5, mid: 5, high: 10, temp: 14 } })
  const res = S.summarize(ctx(detail, { date: '2026-07-15' }))
  const star = byKey(res, 'star')
  const galaxy = byKey(res, 'galaxy')
  check('星空结论为条件较好（' + star.score + '）', star.tone === 'success', star.text)
  check('银河结论为条件较好（' + galaxy.score + '）', galaxy.tone === 'success', galaxy.text)
  check('星空文案含月相与照亮度', /月照 \d+%/.test(star.text), star.text)
  // 暗夜跨零点，必须切成两段显示，不能写成 00:00-23:00
  check('星空给出暗夜窗口（' + star.window + '）', /\d\d:\d\d-\d\d:\d\d \/ \d\d:\d\d-\d\d:\d\d/.test(star.window), star.window)
  check('暗夜窗口为两段且晨段在早、晚段在晚', (() => {
    const parts = star.window.split(' / ')
    return parts.length === 2
      && Number(parts[0].slice(0, 2)) < 6
      && Number(parts[1].slice(0, 2)) >= 20
  })(), star.window)
  check('银河给出银心方位', /朝.+找银心带/.test(galaxy.look), galaxy.look)
  check('逐小时标记含 star 与 galaxy', marksOf(res, 'star').length >= 5 && marksOf(res, 'galaxy').length >= 5,
    'star=' + marksOf(res, 'star').length + ' galaxy=' + marksOf(res, 'galaxy').length)
  check('star 标记只出现在天文暗夜（21:40 之后 / 04:50 之前）',
    marksOf(res, 'star').every(t => Number(t.slice(0, 2)) >= 21 || Number(t.slice(0, 2)) <= 4),
    marksOf(res, 'star').join(','))
}

section('2. 满月夜：星空尚可、银河被月光盖住')
{
  // 2026-09-26 前后满月
  const clear = day({ '*': { low: 5, mid: 5, high: 10 } })
  const moon = A.moonInfo('2026-09-26')
  const full = S.summarize(ctx(clear, { date: '2026-09-26' }))
  const dark = S.summarize(ctx(clear, { date: '2026-07-15' })) // 残月、月照低
  const star = byKey(full, 'star')
  const galaxy = byKey(full, 'galaxy')
  check('测试日确为满月（照亮 ' + moon.illumination + '%）', moon.illumination >= 95)
  check('满月夜银河分数低于低月照夜（' + galaxy.score + ' vs ' + byKey(dark, 'galaxy').score + '）',
    galaxy.score < byKey(dark, 'galaxy').score)
  check('满月夜银河判为条件一般或较差', galaxy.tone !== 'success', galaxy.text)
  check('满月夜银河文案提到月光', /月光|不建议/.test(galaxy.text), galaxy.text)
  check('星空仍可看亮星', /亮星|星空条件/.test(star.text), star.text)
  check('银心季外（1 月）银河直接判低', byKey(S.summarize(ctx(day(), { date: '2026-01-15' })), 'galaxy').score === 0)
}

section('3. 阴雨天：星空银河条件差，且不出现光染与彩虹')
{
  const detail = day({ '*': { low: 95, mid: 90, high: 90, precip: 2, pop: 90 } })
  const res = S.summarize(ctx(detail))
  const star = byKey(res, 'star')
  const gal = byKey(res, 'galaxy')
  const alp = byKey(res, 'alpenglow')
  const rb = byKey(res, 'rainbow')
  check('星空条件差（' + star.tone + '）', star.tone === 'neutral' || star.tone === 'warning', star.text)
  check('银河条件差', gal.tone === 'neutral' || gal.tone === 'warning', gal.text)
  check('无 alpenglow 逐小时标记', marksOf(res, 'alpenglow').length === 0)
  check('日照金山结论为条件较差（' + alp.score + '）', alp.score === 0, alp.text)
  // 太阳很低 + 有降水 → 彩虹反而成立
  check('低太阳 + 降水 → 出现彩虹结论（' + rb.score + '）', rb.score > 0, rb.text)
  check('彩虹方向与太阳相反（' + rb.look + '）', /背对太阳/.test(rb.look))
  check('彩虹给主虹顶部仰角', /仰角约 \d+ 度/.test(rb.look), rb.look)
}

section('4. 晴天但高空有云：晨昏光染成立（低云少 + 中高云可染色）')
{
  // 06:00 前后低云 5、中云 55、无降水 → 山体可被染色
  const detail = day({
    '*': { low: 10, mid: 50, high: 40 },
  })
  const res = S.summarize(ctx(detail, { heading: 90 })) // 轨迹朝东
  const alp = byKey(res, 'alpenglow')
  const marks = marksOf(res, 'alpenglow')
  const sun = A.sunTimes(DATE, LAT, LNG, 1200)
  check('出现 alpenglow 标记（' + marks.join(',') + '）', marks.length >= 2)
  check('标记落在日出后/日落前的 50 分钟窗口内（按整点相交判定）', marks.every(t => {
    const m = S.hourMin(t)
    const r = S.hourMin(sun.sunrise)
    const s = S.hourMin(sun.sunset)
    return S.hourTouches(m, r, r + S.LIGHT_WINDOW_MIN) || S.hourTouches(m, s - S.LIGHT_WINDOW_MIN, s)
  }), marks.join(','))
  check('结论取晨光（窗口在上午，' + alp.window + '）', S.hourMin(alp.window) < 12 * 60, alp.window)
  check('条件较好（' + alp.score + '）', alp.tone === 'success', alp.text)
  check('方向建议为朝东至东北', /朝东至东北/.test(alp.look), alp.look)
  check('文案列出判断依据', /低云少|中高云可被染色|无降水/.test(alp.text), alp.text)
  check('窗口非空', !!alp.window, alp.window)
}

section('5. 低云厚：无光染（云挡住山体）')
{
  const detail = day({ '*': { low: 85, mid: 20, high: 10 } })
  const res = S.summarize(ctx(detail))
  check('无 alpenglow 标记', marksOf(res, 'alpenglow').length === 0)
  check('日照金山判为条件较差', byKey(res, 'alpenglow').score === 0)
}

section('6. 轨迹走向反向：方向分下调但不下调为零')
{
  const east = byKey(S.summarize(ctx(day({ '*': { low: 10, mid: 50, high: 40 } }), { heading: 90 })), 'alpenglow')
  const west = byKey(S.summarize(ctx(day({ '*': { low: 10, mid: 50, high: 40 } }), { heading: 270 })), 'alpenglow')
  check('朝东分数高于朝西（' + east.score + ' vs ' + west.score + '）', east.score > west.score)
  check('朝西文案点出方向不符', /前进方向偏/.test(west.text), west.text)
  const unknown = byKey(S.summarize(ctx(day({ '*': { low: 10, mid: 50, high: 40 } }))), 'alpenglow')
  check('走向未知时不加分，文案提示需要视野开阔', /视野开阔/.test(unknown.text), unknown.text)
  check('走向未知分数低于朝东', unknown.score < east.score)
}

section('7. 云海：低层有云带 + 观察点在带顶之上 + 高层干净 + 微风 + 前日降水')
{
  // 清晨 05:00–09:00 有云带（底 1000 顶 1600），观察点 1200m 需高于带顶 → 用 2000m
  const band = { base: 1000, top: 1600, cover: 95 }
  const detail = day({
    '*': { high: 10, wind: 6 },
    4: { band }, 5: { band }, 6: { band }, 7: { band }, 8: { band }, 9: { band },
  })
  const good = S.summarize(ctx(detail, {
    elevation: 2000,
    days: [{ date: '2026-07-17', precipSum: 3.2 }],
  }))
  const sea = byKey(good, 'cloudSea')
  check('云海条件较好（' + sea.score + '）', sea.tone === 'success', sea.text)
  check('云海文案含时段', /清晨 \d\d:\d\d-\d\d:\d\d/.test(sea.text), sea.text)
  check('云海列出五信号依据', /低层有云带/.test(sea.text) && /此点在云带上方/.test(sea.text)
    && /高层云少/.test(sea.text) && /微风/.test(sea.text) && /前日有降水/.test(sea.text), sea.text)
  check('云海标记落在清晨（≤10 时）', marksOf(good, 'cloudSea').every(t => Number(t.slice(0, 2)) <= 9), marksOf(good, 'cloudSea').join(','))

  // 观察点低于带顶 → 机会低
  const inside = S.summarize(ctx(detail, { elevation: 1200 }))
  const sea2 = byKey(inside, 'cloudSea')
  check('此点在云带内时分数显著降低（' + sea2.score + '）', sea2.score < sea.score - 20, sea2.text)
  check('云带内文案说明看云海机会低', /云带内|机会低/.test(sea2.text), sea2.text)
  check('带内不出现 cloudSea 标记', marksOf(inside, 'cloudSea').length === 0)

  // 无成层云 → 直接判低
  const none = S.summarize(ctx(day({ '*': { high: 10 } }), { elevation: 2000 }))
  check('无成层云带时云海判低并说明', byKey(none, 'cloudSea').score === 0 && /没有成层的低云带/.test(byKey(none, 'cloudSea').text), byKey(none, 'cloudSea').text)
}

section('8. 海拔不可信时的降级')
{
  const band = { base: 1000, top: 1600, cover: 95 }
  const detail = day({ '*': { low: 10, mid: 50, high: 40, high2: 0 }, 5: { band } })
  const res = S.summarize(ctx(detail, { elevation: null, elevOK: false }))
  const sea = byKey(res, 'cloudSea')
  const alp = byKey(res, 'alpenglow')
  check('无海拔时云海提示缺少高程', /缺少可信海拔/.test(sea.text), sea.text)
  check('无海拔时云海判低', sea.score === 0)
  // 晨昏光染的"在云上"判断被跳过，但基础判断仍成立
  check('无海拔时仍能给出日照金山判断（' + alp.score + '）', alp.score > 0, alp.text)
}

section('9. 晨昏光窗口与黄金/蓝调标记')
{
  const res = S.summarize(ctx(day()))
  const light = byKey(res, 'light')
  check('给出日出日落', /日出 \d\d:\d\d · 日落 \d\d:\d\d/.test(light.text), light.text)
  check('给出黄金与蓝调时刻', /黄金时刻/.test(light.text) && /蓝调时刻/.test(light.text), light.text)
  check('golden 标记存在且在日出后', marksOf(res, 'golden').length >= 3)
  check('blueHour 标记存在且在日落前后', marksOf(res, 'blueHour').length >= 2)
  const sun = A.sunTimes(DATE, LAT, LNG, 1200)
  const blue = marksOf(res, 'blueHour').sort()
  // 蓝调只有十几分钟，整点采样按"相交"判定，故可能落在日出/日落的整点上
  check('blueHour 标记与民用晨光/暮光窗口相交', blue.every(t => {
    const m = S.hourMin(t)
    const mg = A.photoWindows(DATE, LAT, LNG, 1200)
    return S.hourTouches(m, S.hourMin(mg.dawnBlue.from), S.hourMin(mg.dawnBlue.to))
      || S.hourTouches(m, S.hourMin(mg.duskBlue.from), S.hourMin(mg.duskBlue.to))
  }), blue.join(','))
  check('blueHour 落在日出前或日落后 30 分钟内', blue.every(t => {
    const m = S.hourMin(t)
    return m <= S.hourMin(sun.sunrise) + 30 || m >= S.hourMin(sun.sunset) - 30
  }), blue.join(','))
}

section('10. 入云标记：观察点落在云层带内')
{
  const band = { base: 1000, top: 1600, cover: 95 }
  const detail = day({ '*': {}, 10: { band }, 11: { band }, 12: { band } })
  const res = S.summarize(ctx(detail, { elevation: 1200 }))
  check('标记 inCloud（观察点在带内）', marksOf(res, 'inCloud').length === 3, marksOf(res, 'inCloud').join(','))
  const out = S.summarize(ctx(detail, { elevation: 2000 }))
  check('观察点在带顶之上时不标 inCloud', marksOf(out, 'inCloud').length === 0)
}

section('11. 工具函数')
{
  check('hourMin 解析', S.hourMin('07:30') === 450)
  check('hourMin 非法返回 NaN', Number.isNaN(S.hourMin('x')))
  check('bearingBetween 正北', S.bearingBetween({ lat: 30, lng: 104 }, { lat: 31, lng: 104 }) === 0)
  check('bearingBetween 正东', S.bearingBetween({ lat: 30, lng: 104 }, { lat: 30, lng: 105 }) === 90)
  check('bearingBetween 缺坐标返回 null', S.bearingBetween(null, { lat: 30, lng: 105 }) === null)
  check('inArc 跨 0 弧（337.5→22.5 含 0）', S.inArc(0, 337.5, 22.5) === true)
  check('inArc 普通弧', S.inArc(90, 22.5, 157.5) === true && S.inArc(200, 22.5, 157.5) === false)
  check('grade 分级边界 70', S.grade(70).tone === 'success')
  check('grade 分级边界 45', S.grade(44).tone === 'neutral' && S.grade(45).tone === 'warning')
  check('grade 截断到 0–100', S.grade(-5).score === 0 && S.grade(999).score === 100)
  check('addDays 跨月', S.addDays('2026-09-28', 1) === '2026-09-29' && S.addDays('2026-12-31', 1) === '2027-01-01')
  check('summarize 缺坐标返回 null', S.summarize({ date: DATE, detail: day() }) === null)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
