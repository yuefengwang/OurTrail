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
  /* 夹具必须带上暗空读数：F1 之后「没有 lightPollution 字段」按失败关闭封顶 69，
     再断言「条件较好」就不再是测天气，而是在测那个可以省略的输入。
     暗空是本节「条件最好」成立的必要条件之一，写进来才是完整夹具。 */
  const detail = day({ '*': { low: 5, mid: 5, high: 10, temp: 14 } })
  const res = S.summarize(ctx(detail, { date: '2026-07-15', lightPollution: { bortle: 2, sqm: 21.8 } }))
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

section('3. 阴雨天：星空银河条件差，光染与彩虹都不成立')
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
  /* 彩虹这一条以前写的是 `rb.score > 0`，注释还写「低太阳 + 降水 → 彩虹反而成立」，
     与本节标题「不出现…彩虹」互相矛盾——而 >0 这种弱断言挡不住满云日拿 70 分（★★★★）。
     真机截图就是这么来的：全天 100% 云、一滴雨没下，彩虹给「条件较好」。
     判据修正后这里**换成成对断言**（替换而非削弱）：满云有雨必须消失，云开有雨必须还在。 */
  check('满天云 + 持续降水 ⇒ 彩虹不成立（太阳照不出来就没有虹，' + rb.score + '）',
    rb.score === 0 && marksOf(res, 'rainbow').length === 0, rb.text)
  check('否定文案说清了缺的是"看到太阳"，不只是"水分"', /看得到太阳|照得出来/.test(rb.text), rb.text)
  const clearing = day({
    7: { low: 30, mid: 20, high: 10, precip: 0.4, rh: 92 },
    8: { low: 25, mid: 15, high: 10, precip: 0.3, rh: 90 },
    '*': {},
  })
  const cRes = S.summarize(ctx(clearing))
  const cRb = byKey(cRes, 'rainbow')
  check('反向对照：雨 + 低云散开（太阳照得出来）⇒ 彩虹仍成立（' + cRb.score + '）',
    cRb.score > 0 && marksOf(cRes, 'rainbow').length === 2, cRb.text)
  check('彩虹方向与太阳相反（' + cRb.look + '）', /背对太阳/.test(cRb.look))
  check('彩虹给主虹顶部仰角', /仰角约 \d+ 度/.test(cRb.look), cRb.look)
  /* 遮光闸必须同时管低云与中高云：只查 low 的话，"低云 10% 但卷层云铺满"照样能给 4 星。
     这条断言是变异脚本（qa/v2-rainbow-gate-2026-10-10/tools/mutate-rainbow.js）逼出来的——
     第一版只写了 low 满云的用例，把闸改成"只看低云"时所有测试仍然全绿。 */
  const highOvercast = day({
    7: { low: 10, mid: 95, high: 95, precip: 0.4, rh: 92 },
    8: { low: 10, mid: 95, high: 95, precip: 0.3, rh: 90 },
    '*': {},
  })
  const hRes = S.summarize(ctx(highOvercast))
  const hRb = byKey(hRes, 'rainbow')
  check('低云少但中高云铺满 ⇒ 太阳仍被遮死，彩虹不成立（' + hRb.score + '）',
    hRb.score === 0 && marksOf(hRes, 'rainbow').length === 0, hRb.text)
  /* 印出来的方位角必须是整数度：真机出现过「约 284.15999999999997 度」 */
  check('印出来的方位角是整数度（' + cRb.look + '）',
    /约 \d+ 度/.test(cRb.look) && !/约 \d+\.\d+ 度/.test(cRb.look), cRb.look)
  const allLooks = cRes.items.filter(i => i.look).map(i => i.look).join(' | ')
  check('六张结论卡里任何"N 度"读数都不带小数（含银河方位）',
    !/\d+\.\d+ ?度/.test(allLooks), allLooks.slice(0, 200))
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

section('12. 三态判定 verdict：判过不成立要沉默，判不出仍要说话')
{
  /* 用户真机三连问的第二半：满天云那天页面上挂着「星空 ★★／银河 ★★★／彩虹 ★★★★」，
     银河卡还给出一句可执行指令（朝西南约 231 度找银心带）。分数低不等于不存在——
     「要不要出现」以前是分数恰好为 0 的巧合，现在由 verdict 显式回答：
       possible 判得出来且有戏 / excluded 判过了、必要条件不成立 ⇒ 页面沉默
       unknown 缺输入判不出 ⇒ 卡片必须留着说明缺什么（铁律 26②：未知不得读成"没有"）。
     分档阈值一个都没动，这是给已有分支起名字。 */
  const V = S.VERDICT
  const PHENO = ['alpenglow', 'cloudSea', 'star', 'galaxy', 'rainbow']
  const closed = it => it.verdict === V.POSSIBLE || it.verdict === V.EXCLUDED || it.verdict === V.UNKNOWN
  const band = { cover: 95, base: 1000, top: 1400 }

  // ① 闭集门：每张卡都必须带 verdict——页面据此出卡，undefined 就是没判
  const sweeps = [
    S.summarize(ctx(day({ '*': { low: 5, mid: 5, high: 10 } }), { date: '2026-07-15' })),
    S.summarize(ctx(day({ '*': { low: 95, mid: 90, high: 90, precip: 2, pop: 90 } }))),
    S.summarize(ctx(day({ '*': { low: 80, mid: 5, high: 5, band } }), { elevation: null, elevOK: false })),
    S.summarize(ctx(day({ '*': {} }), { date: '2026-01-15' })),
    S.summarize(ctx(day({ '*': { low: 5, mid: 5, high: 10 } }), { lat: 70, date: '2026-06-21' })),
  ]
  check('5 组天气 × 每张卡都有闭集 verdict（无 undefined）',
    sweeps.every(r => r && r.items.every(closed)),
    sweeps.map(r => r.items.map(i => i.key + ':' + String(i.verdict)).join(',')).join(' | ').slice(0, 260))

  // ② 复现用户截图那天气：满云 + 持续降水，五项全部"判过了不成立"
  const oc = S.summarize(ctx(day({ '*': { low: 95, mid: 90, high: 90, precip: 2, pop: 90 } })))
  check('满云有雨：五项全 excluded（一张都不该出现在页面上）',
    PHENO.every(k => byKey(oc, k).verdict === V.EXCLUDED),
    PHENO.map(k => k + ':' + byKey(oc, k).verdict).join(' '))
  /* 这两条把"截图里的星"钉住：它们此前靠 score 出现在页面上（36→★★、48→★★★），
     现在必须靠 verdict 消失，所以断言"分数还在那儿但被沉默"——分数不是出现与否的凭据。 */
  check('星空/银河的分数未改动（36/48），改的是"要不要出现"',
    byKey(oc, 'star').score === 36 && byKey(oc, 'galaxy').score === 48,
    'star=' + byKey(oc, 'star').score + ' galaxy=' + byKey(oc, 'galaxy').score)
  check('客观时刻（light）永远 possible：它是钟点不是概率判断',
    byKey(oc, 'light').verdict === V.POSSIBLE)

  // ③ 反向对照：晴空无月夜必须"有戏"，不许把可能误沉默
  const cl = S.summarize(ctx(day({ '*': { low: 5, mid: 5, high: 10 } }), { date: '2026-07-15' }))
  check('晴空无月夜：星空与银河 possible（且银河仍给方位）',
    byKey(cl, 'star').verdict === V.POSSIBLE && byKey(cl, 'galaxy').verdict === V.POSSIBLE && /找银心带/.test(byKey(cl, 'galaxy').look),
    byKey(cl, 'galaxy').look)

  // ④ 判不出 ≠ 不成立：缺可信海拔时云海是 unknown，卡片必须留着
  const noAlt = S.summarize(ctx(day({ '*': { low: 80, mid: 5, high: 5, band } }), { elevation: null, elevOK: false }))
  check('缺可信海拔：云海 unknown 而不是 excluded（没有海拔无权断言看不到）',
    byKey(noAlt, 'cloudSea').verdict === V.UNKNOWN, byKey(noAlt, 'cloudSea').text)
  // 同一份云数据，海拔补上且此点在带顶之上 ⇒ possible；落在带内 ⇒ excluded
  check('补上海拔（同份云数据）此点在带上 → 云海 possible',
    byKey(S.summarize(ctx(day({ '*': { low: 80, mid: 5, high: 5, band } }), { elevation: 2000 })), 'cloudSea').verdict === V.POSSIBLE)
  const below = S.summarize(ctx(day({ '*': { low: 80, mid: 5, high: 5, band } }), { elevation: 1200 }))
  check('此点在带内（判过了）→ 云海 excluded', byKey(below, 'cloudSea').verdict === V.EXCLUDED)
  /* 这条是总评必须剔除被沉默卡的实据：被排除的云海卡手里还攥着 64 分（≥45 会进 live），
     若继续参与平均，页面看不见它却受它影响——看不见的证据不能决定看得见的结论。 */
  check('被沉默的卡可以带着不低的分数（' + byKey(below, 'cloudSea').score + ' ≥45）',
    byKey(below, 'cloudSea').score >= 45, 'score=' + byKey(below, 'cloudSea').score)

  // ⑤ 没有暗夜小时（极昼形态）＝没判过 ⇒ unknown，不得写成"看不到星空"
  const polar = S.summarize(ctx(day({ '*': { low: 5, mid: 5, high: 10 } }), { lat: 70, date: '2026-06-21' }))
  check('极昼无暗夜小时：星空/银河 unknown（不是 excluded）',
    byKey(polar, 'star').verdict === V.UNKNOWN && byKey(polar, 'galaxy').verdict === V.UNKNOWN,
    byKey(polar, 'star').text)

  // ⑥ 非银心季是客观天文事实 ⇒ excluded（与"缺数据"分开）；同一天星空只看云，仍 possible
  const off = S.summarize(ctx(day({ '*': { low: 5, mid: 5, high: 10 } }), { date: '2026-01-15' }))
  check('1 月非银心季：银河 excluded、星空 possible',
    byKey(off, 'galaxy').verdict === V.EXCLUDED && byKey(off, 'star').verdict === V.POSSIBLE,
    byKey(off, 'galaxy').text)

  // ⑦ isSilent 是页面唯一的问法：缺字段必须失败开放（不把卡吃掉）
  check('isSilent 只对 excluded 为真，unknown/possible/缺字段都为假',
    S.isSilent({ verdict: V.EXCLUDED }) === true
      && S.isSilent({ verdict: V.UNKNOWN }) === false
      && S.isSilent({ verdict: V.POSSIBLE }) === false
      && S.isSilent({}) === false && S.isSilent(undefined) === false)
}

section('13. 月球高度与银心高度（2026-10 新增）')
{
  const clear = day({ '*': { low: 5, mid: 5, high: 10 } })
  const res = S.summarize(ctx(clear, { date: '2026-07-15' }))
  const g = byKey(res, 'galaxy')
  const at = (g.window.match(/\d\d:\d\d/) || [])[0]
  const gp = A.galaxyPosition(A.cnToMs('2026-07-15', at), LAT, LNG)
  check('银河「往哪看」与该小时实际银心方位一致（' + at + ' / ' + gp.azimuth + '°）',
    g.look.indexOf(String(Math.round(gp.azimuth))) >= 0, g.look)

  const full = S.summarize(ctx(clear, { date: '2026-09-26' }))
  check('满月夜文案说明月亮在夜段地平线上',
    /月亮在夜段 \d+\/\d+ 小时在地平线上/.test(byKey(full, 'star').text), byKey(full, 'star').text)

  /* 本节测的是「月亮整天在地平线下也不按 53% 扣分」，不是测缺测封顶；
     给一份暗空读数，让分数只由月光决定（否则 F1 的失败关闭会先把分数压到 69）。 */
  const highLat = S.summarize(ctx(clear, {
    date: '2026-09-19', lat: 65, lng: 20, elevation: 0, lightPollution: { bortle: 2, sqm: 21.8 },
  }))
  const hs = byKey(highLat, 'star')
  check('高纬 53% 月亮整夜在地平线下 ⇒ 不按 53% 扣分（' + hs.score + '）',
    /月亮在整个夜段都在地平线下/.test(hs.text) && hs.score >= 70, hs.text)

  const noCore = S.summarize(ctx(clear, { date: '2026-10-07', lat: 50, lng: 104, elevation: 1200 }))
  const ng = byKey(noCore, 'galaxy')
  check('银心整夜在地平线下 ⇒ 银河判 excluded，不再给「找银心带」',
    ng.verdict === 'excluded' && /地平线以下/.test(ng.text) && !ng.look, ng.text + ' / ' + ng.look)
}

section('14. 跨夜窗口：今晚入夜 → 次日晨（有 series 时）')
{
  const d1 = day({ '*': { low: 0, mid: 0, high: 0 } }).map(h => Object.assign({}, h, { d: '2026-07-15' }))
  const d2 = day({ '*': { low: 0, mid: 0, high: 0 } }).map(h => Object.assign({}, h, { d: '2026-07-16' }))
  // 所选日清晨全阴、入夜转晴；次日清晨也晴 ⇒ 今晚应该是 100% 晴
  d1.slice(0, 5).forEach(h => { h.cloud = { low: 100, mid: 100, high: 100 } })
  const res = S.summarize(ctx(d1, { date: '2026-07-15', series: d1.concat(d2) }))
  const star = byKey(res, 'star')
  check('夜窗口从所选日入夜开始，次日晨带前缀（' + star.window + '）',
    /^22:00-23:00 \/ 次日 00:00-04:00$/.test(star.window), star.window)
  check('夜窗口不再混入所选日清晨的云（晴空 100%）', /暗夜晴空 100%/.test(star.text), star.text)
  check('文案说明这是今晚入夜到次日晨', /今晚入夜到次日晨/.test(star.text), star.text)

  // 次日清晨全阴 ⇒ 后半夜确实被算进来（旧口径会把它漏掉）
  const d2bad = day({ '*': { low: 100, mid: 100, high: 100 } }).map(h => Object.assign({}, h, { d: '2026-07-16' }))
  const resBad = S.summarize(ctx(d1, { date: '2026-07-15', series: d1.concat(d2bad) }))
  const badStar = byKey(resBad, 'star')
  check('次日清晨全阴会被计入今晚（星空不强判 possible）',
    badStar.verdict === 'excluded' || /暗夜晴空 [0-6]\d%/.test(badStar.text), badStar.text)
}

section('15. 低云按观察点海拔参与星空（cloudLevels）')
{
  const times = []
  for (let h = 0; h < 24; h++) times.push('2026-07-15T' + String(h).padStart(2, '0') + ':00')
  const fill = v => Array(24).fill(v)
  const cloudLevels = {
    times,
    levels: [
      { pressure: 900, altitudes: fill(1000), cloudCover: fill(100) },
      { pressure: 700, altitudes: fill(2500), cloudCover: fill(0) },
      { pressure: 500, altitudes: fill(5500), cloudCover: fill(0) },
    ],
  }
  const detail = day({ '*': { low: 0, mid: 0, high: 0 } })
  const lowPoint = S.summarize(ctx(detail, { date: '2026-07-15', elevation: 500, elevOK: true, cloudLevels }))
  const highPoint = S.summarize(ctx(detail, { date: '2026-07-15', elevation: 3000, elevOK: true, cloudLevels }))
  check('500 m 点：1000 m 的低云在头顶 ⇒ 星空不判晴', byKey(lowPoint, 'star').verdict === 'excluded'
    || /暗夜晴空 0%/.test(byKey(lowPoint, 'star').text), byKey(lowPoint, 'star').text)
  check('3000 m 点：同一层低云在脚下 ⇒ 星空仍可判晴', /暗夜晴空 100%/.test(byKey(highPoint, 'star').text),
    byKey(highPoint, 'star').text)
  const p500 = S.cloudAboveAt({ t: '23:00', d: '2026-07-15' }, '2026-07-15', cloudLevels, 500)
  const p3000 = S.cloudAboveAt({ t: '23:00', d: '2026-07-15' }, '2026-07-15', cloudLevels, 3000)
  check('cloudAboveAt 只统计观察点上方（500m: ' + p500.max + '% / 3000m: ' + p3000.max + '%）',
    p500 && p500.max === 100 && p3000 && p3000.max === 0)
}

section('16. 缺测失败关闭：不把 null 当 0')
{
  const missing = day({}).map(h => ({ t: h.t }))
  const res = S.summarize(ctx(missing))
  ;['star', 'galaxy', 'cloudSea', 'alpenglow', 'rainbow'].forEach(key => {
    const it = byKey(res, key)
    check(key + ' 缺测 → unknown（不是 excluded/possible，也不崩）', it.verdict === 'unknown',
      it.verdict + ' / ' + it.text)
  })

  const noBand = day({ '*': { low: 0, mid: 0, high: 0 } }).map(h => {
    const o = Object.assign({}, h)
    delete o.band
    return o
  })
  const noBandRes = S.summarize(ctx(noBand))
  check('没有 band 字段 ⇒ 云海 unknown，不印「没有成层云带」',
    byKey(noBandRes, 'cloudSea').verdict === 'unknown' && !/没有成层的低云带/.test(byKey(noBandRes, 'cloudSea').text),
    byKey(noBandRes, 'cloudSea').text)

  const partial = day({ '*': { low: 0, mid: 0, high: 0 } }).map((h, i) => i < 2 ? h : { t: h.t })
  const partialRes = S.summarize(ctx(partial))
  check('夜段只有 2/7 小时有读数 ⇒ 星空 unknown（80% 覆盖门）',
    byKey(partialRes, 'star').verdict === 'unknown', byKey(partialRes, 'star').text)

  const afternoonBand = day({ '*': { low: 0, mid: 0, high: 0 } }).map((h, i) => {
    h.band = i === 15 ? { base: 2000, top: 2500, cover: 90 } : null
    return h
  })
  const afternoon = byKey(S.summarize(ctx(afternoonBand)), 'cloudSea')
  check('只有下午云带 ⇒ 云海 excluded 并说明不在清晨时段',
    afternoon.verdict === 'excluded' && /不在清晨时段/.test(afternoon.text), afternoon.text)
}

section('17. 云海逆温（profile + cloudLevels）')
{
  const times = []
  for (let h = 0; h < 24; h++) times.push('2026-07-15T' + String(h).padStart(2, '0') + ':00')
  const fill = v => Array(24).fill(v)
  const cloudLevels = {
    times,
    levels: [
      { pressure: 925, altitudes: fill(1000), cloudCover: fill(0) },
      { pressure: 850, altitudes: fill(2800), cloudCover: fill(0) },
      { pressure: 700, altitudes: fill(3800), cloudCover: fill(0) },
    ],
  }
  const make = inv => day({ '*': { low: 0, mid: 0, high: 0 } }).map((h, i) => Object.assign({}, h, {
    temp: 10,
    profile: {
      925: { t: inv ? 12 : 8, rh: 80 },
      850: { t: inv ? 12 : 8, rh: 70 },
      700: { t: 2, rh: 50 },
    },
    band: i < 10 ? { base: 2000, top: 2500, cover: 90 } : null,
  }))
  const invRes = S.summarize(ctx(make(true), { date: '2026-07-15', elevation: 2600, cloudLevels }))
  const noRes = S.summarize(ctx(make(false), { date: '2026-07-15', elevation: 2600, cloudLevels }))
  const inv = byKey(invRes, 'cloudSea')
  const no = byKey(noRes, 'cloudSea')
  check('有逆温：加分且文案点名（' + inv.score + ' vs ' + no.score + '）',
    inv.score > no.score && /有逆温/.test(inv.text), inv.text)
  check('无逆温：扣分且文案点名', /无明显逆温/.test(no.text), no.text)
  const iv = S.inversionAt(make(true)[3], '2026-07-15', cloudLevels, 2600)
  check('inversionAt 选此点上方最近层（850）', iv && iv.inversion && iv.pressure === 850, iv)
  const ivHigh = S.inversionAt(make(true)[3], '2026-07-15', cloudLevels, 2900)
  check('点高于 850 层时不会被地下层误判', ivHigh && ivHigh.pressure === 700 && !ivHigh.inversion, ivHigh)
}

section('18. 方向性天气（spatial）：银河看银心方向、彩虹看反日方向')
{
  const times = []
  for (let h = 0; h < 24; h++) times.push('2026-07-15T' + String(h).padStart(2, '0') + ':00')
  const makeSpatial = vals => ({
    times,
    hours: times.map(t => t.slice(11, 16)),
    byAzimuth: [0, 45, 90, 135, 180, 225, 270, 315].map(az => ({
      azimuth: az,
      low: times.map(() => vals.low == null ? 0 : vals.low),
      mid: times.map(() => vals.mid == null ? 0 : vals.mid),
      high: times.map(() => vals.high == null ? 0 : vals.high),
      precip: times.map(() => vals.precip == null ? 0 : vals.precip),
      pop: times.map(() => vals.pop == null ? 0 : vals.pop),
    })),
  })
  const one = { times: ['2026-07-15T22:00'], hours: ['22:00'], byAzimuth: [
    { azimuth: 0, mid: [0] }, { azimuth: 90, mid: [100] },
    { azimuth: 180, mid: [50] }, { azimuth: 270, mid: [0] },
    { azimuth: 315, mid: [40] },
  ] }
  check('directionValue 命中最近方位', S.directionValue(one, '2026-07-15T22:00', 90, 'mid') === 100)
  check('directionValue 两个方位之间线性插值（45°→50）', S.directionValue(one, '2026-07-15T22:00', 45, 'mid') === 50)
  const wrap = S.directionValue(one, '2026-07-15T22:00', 350, 'mid')
  check('directionValue 跨 0° 圆周插值（350° 在 315° 与 0° 之间）', wrap > 5 && wrap < 15, wrap)
  check('directionValue 缺时刻/缺值返回 null', S.directionValue(one, '2026-07-15T23:00', 90, 'mid') === null &&
    S.directionValue(one, '2026-07-15T22:00', 90, 'precip') === null)

  const clear = day({ '*': { low: 5, mid: 5, high: 10 } })
  const noSpatial = byKey(S.summarize(ctx(clear, { date: '2026-07-15' })), 'galaxy')
  const cloudyDir = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', spatial: makeSpatial({ mid: 100 }),
  })), 'galaxy')
  check('银心方向云 100% ⇒ 银河降分且文案点名方向（' + cloudyDir.score + ' vs ' + noSpatial.score + '）',
    cloudyDir.score < noSpatial.score && /银心方向云较多|银心方向云约/.test(cloudyDir.text), cloudyDir.text)

  const rainy = day({ '*': { low: 0, mid: 0, high: 0, precip: 0, rh: 70 } })
  rainy[7].precip = 0.2
  rainy[7].rh = 90
  const dry = byKey(S.summarize(ctx(rainy, {
    date: '2026-07-15', spatial: makeSpatial({ precip: 0, pop: 0 }),
  })), 'rainbow')
  const wet = byKey(S.summarize(ctx(rainy, {
    date: '2026-07-15', spatial: makeSpatial({ precip: 0.5, pop: 80 }),
  })), 'rainbow')
  check('反日方向未检出降水 ⇒ 彩虹降分并说清（' + dry.score + '）',
    /反日方向未检出降水/.test(dry.text), dry.text)
  check('反日方向有降水 ⇒ 彩虹分数更高并说清（' + wet.score + ' vs ' + dry.score + '）',
    wet.score > dry.score && /反日方向有降水信号/.test(wet.text), wet.text)
}

section('19. 地形地平线（terrain）：银河遮挡、彩虹反日方向、光染目标山脊')
{
  const terrainAll = (angle, distance, elevation) => {
    const horizon = []
    for (let a = 0; a < 360; a += 22.5) horizon.push({ azimuth: a, angle, distance, elevation })
    return { horizon, openness: angle < 1 ? 1 : 0 }
  }
  const interp = {
    horizon: [
      { azimuth: 0, angle: 0, distance: 0, elevation: 0 },
      { azimuth: 45, angle: 10, distance: 8, elevation: 3000 },
    ],
  }
  const at = S.terrainAt(interp, 22.5)
  check('terrainAt 圆周线性插值（22.5°→5°）', at && Math.abs(at.angle - 5) < 0.01, at)

  const clear = day({ '*': { low: 5, mid: 5, high: 10 } })
  const blocked = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', terrain: terrainAll(80, 10, 6000),
  })), 'galaxy')
  check('银心被 80° 山脊挡住 ⇒ galaxy excluded 且说明山脊',
    blocked.verdict === 'excluded' && /山脊挡住/.test(blocked.text), blocked.text)
  const open = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', terrain: terrainAll(-5, 0, 0),
  })), 'galaxy')
  check('地平线开阔 ⇒ galaxy 仍可判 possible', open.verdict === 'possible', open.text)
  const marksBlocked = S.hourMarks({
    date: '2026-07-15', lat: LAT, lng: LNG, elevation: 1200, elevOK: true,
    detail: clear, terrain: terrainAll(80, 10, 6000),
  })
  const marksOpen = S.hourMarks({
    date: '2026-07-15', lat: LAT, lng: LNG, elevation: 1200, elevOK: true,
    detail: clear, terrain: terrainAll(-5, 0, 0),
  })
  check('hourMarks 与主卡共用同一地形门（时间轴/OI 不再另说一套）',
    marksOf({ marks: marksBlocked }, 'galaxy').length === 0 &&
      marksOf({ marks: marksOpen }, 'galaxy').length > 0,
    'blocked=' + marksOf({ marks: marksBlocked }, 'galaxy').length +
      ' open=' + marksOf({ marks: marksOpen }, 'galaxy').length)

  const rainy = day({ '*': { low: 0, mid: 0, high: 0, precip: 0, rh: 70 } })
  rainy[7].precip = 0.2
  rainy[7].rh = 90
  const rbBlocked = byKey(S.summarize(ctx(rainy, {
    date: '2026-07-15', terrain: terrainAll(10, 10, 3000),
  })), 'rainbow')
  const rbOpen = byKey(S.summarize(ctx(rainy, {
    date: '2026-07-15', terrain: terrainAll(-5, 0, 0),
  })), 'rainbow')
  check('反日方向 10° 山脊 ⇒ 彩虹降分并说明（' + rbBlocked.score + ' vs ' + rbOpen.score + '）',
    rbBlocked.score < rbOpen.score && /山脊挡住/.test(rbBlocked.text), rbBlocked.text)

  const glow = day({ '*': { low: 5, mid: 30, high: 10 } })
  const glowBlocked = byKey(S.summarize(ctx(glow, {
    date: '2026-07-15', terrain: terrainAll(20, 10, 4000),
  })), 'alpenglow')
  const glowOpen = byKey(S.summarize(ctx(glow, {
    date: '2026-07-15', terrain: terrainAll(-5, 0, 0),
  })), 'alpenglow')
  check('光染：太阳低于山脊 ⇒ 降分并说明（' + glowBlocked.score + ' vs ' + glowOpen.score + '）',
    glowBlocked.score < glowOpen.score && /太阳低于此方位山脊/.test(glowBlocked.text), glowBlocked.text)
  check('光染：太阳高于山脊 ⇒ 加分并给出山脊方位',
    /太阳高于此方位山脊/.test(glowOpen.text) && /看山脊线/.test(glowOpen.look), glowOpen.text + ' / ' + glowOpen.look)
}

section('20. 大气透明度 / seeing / 气溶胶（atmosphere）')
{
  const at = { sevenTimer: { series: [{ at: '2026-07-15T23:00', seeing: 2, transparency: 7, cloudPct: 0 }] }, air: { series: [{ at: '2026-07-15T23:00', aod: 0.1, pm25: 10 }] } }
  const got = S.atmosphereAt(at, '2026-07-15T23:00')
  check('atmosphereAt 合并 7Timer 与 CAMS', got && got.seeing === 2 && got.transparency === 7 && got.aod === 0.1, got)
  check('atmosphereAt 缺该小时 → null', S.atmosphereAt(at, '2026-07-16T10:00') === null)
  const poor = S.atmosphereImpact({ aod: 0.5, transparency: 8, seeing: 7 })
  const good = S.atmosphereImpact({ aod: 0.1, transparency: 2, seeing: 2 })
  check('气溶胶/透明度/seeing 差 ⇒ 负分并点名（' + poor.score + '）',
    poor.score < 0 && /气溶胶偏高/.test(poor.text) && /透明度偏低/.test(poor.text), poor.text)
  check('气溶胶低/透明度好/seeing 好 ⇒ 正分（' + good.score + '）',
    good.score > 0 && /气溶胶低/.test(good.text) && /7Timer 透明度好/.test(good.text), good.text)

  const atmAll = (vals, date) => {
    const d = date || '2026-07-15'
    const seven = [], air = []
    for (let h = 0; h < 24; h++) {
      const t = d + 'T' + String(h).padStart(2, '0') + ':00'
      seven.push({ at: t, seeing: vals.seeing, transparency: vals.transparency, cloudPct: 0 })
      air.push({ at: t, aod: vals.aod, pm25: vals.pm25 })
    }
    return { sevenTimer: { series: seven }, air: { series: air } }
  }
  const clear = day({ '*': { low: 5, mid: 5, high: 10 } })
  /* 本节的自变量是大气，光污染必须给一个中性读数（Bortle 5 ⇒ 0 分、不封顶）：
     F1 之后缺测会封顶 69，「空气好 vs 空气差」就都被压到同一条线上，比不出东西，
     文案也会先被「光污染未计入」抢走。缺测那一支由 §21 单独覆盖。 */
  const LP_MID = { bortle: 5, sqm: 20.3 }
  const starGood = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: LP_MID, atmosphere: atmAll({ seeing: 2, transparency: 2, aod: 0.1 }),
  })), 'star')
  const starBad = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: LP_MID, atmosphere: atmAll({ seeing: 7, transparency: 8, aod: 0.5 }),
  })), 'star')
  check('星空：空气好 ⇒ 分数更高且点名（' + starGood.score + ' vs ' + starBad.score + '）',
    starGood.score > starBad.score && /气溶胶低|7Timer 透明度好/.test(starGood.text), starGood.text)
  check('星空：空气差 ⇒ 降分且说明', /大气透明度\/seeing 偏弱/.test(starBad.text) && /气溶胶偏高/.test(starBad.text), starBad.text)

  const galGood = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: LP_MID, atmosphere: atmAll({ seeing: 2, transparency: 2, aod: 0.1 }),
  })), 'galaxy')
  const galBad = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: LP_MID, atmosphere: atmAll({ seeing: 7, transparency: 8, aod: 0.5 }),
  })), 'galaxy')
  check('银河：空气差 ⇒ 降分并说明（' + galGood.score + ' vs ' + galBad.score + '）',
    galBad.score < galGood.score && /大气透明度\/seeing 偏弱/.test(galBad.text), galBad.text)

  const fullGal = byKey(S.summarize(ctx(day({ '*': { low: 5, mid: 5, high: 10 } }), {
    date: '2026-09-26', lightPollution: { bortle: 2, sqm: 21.8 },
    atmosphere: atmAll({ seeing: 2, transparency: 2, aod: 0.1 }, '2026-09-26'),
  })), 'galaxy')
  check('满月 + 通透天空：银河封顶 69，不出现 4 星与“不建议”打架',
    fullGal.score <= 69 && /不建议|月光/.test(fullGal.text), fullGal.text)
}

section('21. 光污染（lightPollution）：暗空加分、污染降分、缺失/污染封顶')
{
  const dark = S.lightPollutionImpact({ bortle: 2, sqm: 21.8 })
  const polluted = S.lightPollutionImpact({ bortle: 8, sqm: 18 })
  const mid = S.lightPollutionImpact({ bortle: 5, sqm: 20.3 })
  check('Bortle 2 / SQM 21.8 ⇒ 暗空加分', dark.score > 0 && /天空较暗/.test(dark.text), dark)
  check('Bortle 8 / SQM 18 ⇒ 光污染扣分', polluted.score < 0 && polluted.poor && /光污染较高/.test(polluted.text), polluted)
  check('Bortle 5 / SQM 20.3 ⇒ 中性', mid.score === 0 && /光污染中等/.test(mid.text), mid)

  /* cap69 是“文案已经说机会低/不建议时星级必须一致”的唯一出口（月光封顶与光污染封顶同源）。
     边界钉在这里：70 必须落到 69，69 原样，条件为假时不许动分数。 */
  check('cap69：70→69、69→69、条件不成立不动分',
    S.cap69(70, true) === 69 && S.cap69(69, true) === 69
    && S.cap69(80, false) === 80 && S.cap69(100, true) === 69,
    [S.cap69(70, true), S.cap69(69, true), S.cap69(80, false), S.cap69(100, true)].join('/'))

  const clear = day({ '*': { low: 5, mid: 5, high: 10 } })
  /* 通透空气 +11 分，把“光污染差”的两张卡推到 69 之上，封顶才有可观测的后果 */
  const atmClear = vals => {
    const seven = [], air = []
    for (let h = 0; h < 24; h++) {
      const t = '2026-07-15T' + String(h).padStart(2, '0') + ':00'
      seven.push({ at: t, seeing: vals.seeing, transparency: vals.transparency, cloudPct: 0 })
      air.push({ at: t, aod: vals.aod, pm25: vals.pm25 })
    }
    return { sevenTimer: { series: seven }, air: { series: air } }
  }
  const VERY_CLEAR = { seeing: 2, transparency: 2, aod: 0.1 }
  const darkStar = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: { bortle: 2, sqm: 21.8 },
  })), 'star')
  const dirtyStar = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: { bortle: 8, sqm: 18 },
  })), 'star')
  const missingStar = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: null,
  })), 'star')
  const noFieldStar = byKey(S.summarize(ctx(clear, { date: '2026-07-15' })), 'star')
  check('星空：暗空加分且点名（' + darkStar.score + '）', darkStar.score > noFieldStar.score && /天空较暗/.test(darkStar.text), darkStar.text)
  check('星空：光污染降分且说明（' + dirtyStar.score + '）', dirtyStar.score < noFieldStar.score && /光污染较高/.test(dirtyStar.text), dirtyStar.text)
  check('星空：光污染显式缺失 ⇒ 封顶 69 且说明（' + missingStar.score + '）',
    missingStar.score === 69 && /未计入光污染/.test(missingStar.text), missingStar.text)
  /* 契约替换（2026-10-21 F1）：旧断言是「没有 lightPollution 字段 ⇒ 保持旧行为（不封顶）」，
     它把“调用方没传这个字段”读成“天空很暗”。页面的三个真实状态——首屏、getSkyContext 整体失败、
     配额用尽/非 ready——传的正是 undefined，于是封顶与披露在最需要的时候恰好失效
     （探针：星空 73、银河 88）。纯函数分不清“没有这个概念”与“问了没取到”，按失败关闭处理；
     这条换成**更强**的判据：undefined 与 null 同样封顶并披露。 */
  check('星空：没有 lightPollution 字段（undefined）⇒ 与 null 同样封顶 69 且披露（' + noFieldStar.score + '）',
    noFieldStar.score === 69 && /未计入光污染/.test(noFieldStar.text), noFieldStar.text)
  /* 封顶必须有可观测后果：不叠空气加分时 Bortle 8 星空只有 63 分，封不封都一样。
     叠上通透空气（+11）后是 74 —— 文案说“光污染较高、条件一般”，星级却仍是 4 星，
     正是用户能同时读到的那句自相矛盾。 */
  const dirtyStarAtm = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: { bortle: 8, sqm: 18 }, atmosphere: atmClear(VERY_CLEAR),
  })), 'star')
  check('星空：光污染差（Bortle 8）+ 通透空气 ⇒ 封顶 69 且只点一次“光污染较高”（' + dirtyStarAtm.score + '）',
    dirtyStarAtm.score === 69 && /条件一般|不建议/.test(dirtyStarAtm.text)
    && (dirtyStarAtm.text.match(/光污染较高/g) || []).length === 1,
    dirtyStarAtm.text)

  const darkGal = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: { bortle: 2, sqm: 21.8 },
  })), 'galaxy')
  const dirtyGal = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: { bortle: 8, sqm: 18 },
  })), 'galaxy')
  const missingGal = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: null,
  })), 'galaxy')
  const noFieldGal = byKey(S.summarize(ctx(clear, { date: '2026-07-15' })), 'galaxy')
  check('银河：光污染高 ⇒ 降分且不建议（' + dirtyGal.score + '）',
    dirtyGal.score < darkGal.score && /光污染较高/.test(dirtyGal.text), dirtyGal.text)
  check('银河：光污染显式缺失 ⇒ 封顶 69 且说明（' + missingGal.score + '）',
    missingGal.score === 69 && /未计入光污染/.test(missingGal.text), missingGal.text)
  /* 同一条契约替换的另一半：没有 lightPollution 字段（undefined）必须与 null 同罚。
     探针里银河在这一支拿 88 分 ★★★★☆，而文案写“不建议抱太大期望”。 */
  check('银河：没有 lightPollution 字段（undefined）⇒ 封顶 69 且披露（' + noFieldGal.score + '）',
    noFieldGal.score === 69 && /未计入光污染/.test(noFieldGal.text)
    && /不建议/.test(noFieldGal.text), noFieldGal.text)
  check('银河：光污染高 ⇒ 封顶 69 且只点一次“光污染较高”（' + dirtyGal.score + '）',
    dirtyGal.score === 69 && (dirtyGal.text.match(/光污染较高/g) || []).length === 1, dirtyGal.text)
  /* 封印必须落在**所有**加减分之后：方向云 <30% 会给银河 +5。旧实现先封 69 再加 5，
     结果是 74 分「条件较好」——文案明明写着「光污染未计入」，星级却当成没这回事。
     这条用缺读数 + 方向云开阔的一小时钉住次序（变异 M5 专抓）。 */
  const times = []
  for (let h = 0; h < 24; h++) times.push('2026-07-15T' + String(h).padStart(2, '0') + ':00')
  const openDir = {
    times,
    hours: times.map(t => t.slice(11, 16)),
    byAzimuth: [0, 45, 90, 135, 180, 225, 270, 315].map(az => ({
      azimuth: az,
      low: times.map(() => 5),
      mid: times.map(() => 5),
      high: times.map(() => 10),
      precip: times.map(() => 0),
      pop: times.map(() => 0),
    })),
  }
  const openDirGal = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', spatial: openDir,
  })), 'galaxy')
  /* 反方向的同一份方向网格：银心方向云 ≥60% ⇒ dirHigh 支路（reason 改由方向云先说）。 */
  const dirHi = {
    times,
    hours: times.map(t => t.slice(11, 16)),
    byAzimuth: [0, 45, 90, 135, 180, 225, 270, 315].map(az => ({
      azimuth: az,
      low: times.map(() => 85),
      mid: times.map(() => 85),
      high: times.map(() => 85),
      precip: times.map(() => 0),
      pop: times.map(() => 0),
    })),
  }
  check('银河：缺光污染 + 银心方向云开阔（+5）⇒ 仍在加完之后封顶 69（' + openDirGal.score + '）',
    openDirGal.score === 69 && /未计入光污染/.test(openDirGal.text)
    /* 这条夹具必须真的走到 +5 那一支：方向云若被静默算成 null，上面的 69 会照旧成立，
       而它证明的就不再是“加完再封”。 */
    && /银心方向云约 \d{1,2}%/.test(openDirGal.text)
    && Number((openDirGal.text.match(/银心方向云约 (\d+)%/) || [])[1]) < 30,
    openDirGal.text)
  /* 去重不能过头：reason 链先说了别的（有云 / 方向云）时，证据句必须把光污染说完。
     把 lpNamed 写成 `lpPoor` 就会在这些支路里静默丢掉唯一一次「光污染较高」（变异 M10 专抓）。 */
  const cloudyNight = day({ '*': { low: 95, mid: 95, high: 95 } })
  const dirtyCloudyGal = byKey(S.summarize(ctx(cloudyNight, {
    date: '2026-07-15', lightPollution: { bortle: 8, sqm: 18 },
  })), 'galaxy')
  check('银河：有云（晴 0%）+ 光污染高 ⇒ reason 未点名时证据句仍说一次「光污染较高」（' + dirtyCloudyGal.score + '）',
    /暗夜有云/.test(dirtyCloudyGal.text)
    && (dirtyCloudyGal.text.match(/光污染较高/g) || []).length === 1, dirtyCloudyGal.text)
  const dirHighGal = byKey(S.summarize(ctx(clear, {
    date: '2026-07-15', lightPollution: { bortle: 8, sqm: 18 }, spatial: dirHi,
  })), 'galaxy')
  check('银河：银心方向云多 + 光污染高 ⇒ reason 未点名时证据句仍说一次「光污染较高」（' + dirHighGal.score + '）',
    /银心方向云较多/.test(dirHighGal.text)
    && (dirHighGal.text.match(/光污染较高/g) || []).length === 1, dirHighGal.text)
  const dirtyCloudyStar = byKey(S.summarize(ctx(cloudyNight, {
    date: '2026-07-15', lightPollution: { bortle: 8, sqm: 18 },
  })), 'star')
  check('星空：有云（晴 0%）+ 光污染高 ⇒ 文案不点名光污染时证据句仍说一次（' + dirtyCloudyStar.score + '）',
    /夜间云量高|夜间有云/.test(dirtyCloudyStar.text)
    && (dirtyCloudyStar.text.match(/光污染较高/g) || []).length === 1, dirtyCloudyStar.text)
  /* 阳性对照：暗空(Bortle 2) 不受封顶影响 —— 证明上面的 69 不是无条件封顶。 */
  check('银河：暗空(Bortle 2) 不被封顶（' + darkGal.score + '）', darkGal.score > 69)
  check('星空：暗空(Bortle 2) 不被封顶（' + darkStar.score + '）', darkStar.score > 69)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
