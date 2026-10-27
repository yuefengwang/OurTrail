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
  /* F6 光染拆分：**没有地形输入**时，不拿「山体被光染」（无数据）出星级——
     分数照旧（≥40 档的分数路径不受影响），文案主语换成同一份云量/降水真的能回答的
     「天空与中高云」，并当场披露没有目标山峰数据。look 保留 heading 后缀。 */
  check('无地形：分数与改前相同（' + alp.score + '）', alp.score === 92, alp.text)
  check('无地形：文案不再说「山体被光染」', !/山体被光染/.test(alp.text), alp.text)
  check('无地形：文案说清真正可见的现象（天空与中高云有被染色的条件）',
    alp.text.indexOf('天空与中高云有被染色的条件') !== -1, alp.text)
  check('无地形：披露没有目标山峰数据、判断不了哪座山会被染',
    alp.text.indexOf('没有目标山峰数据') !== -1
      && alp.text.indexOf('判断不了哪座山会被染') !== -1, alp.text)
  check('无地形：look 指向天空与山脊线，朝东至东北开头且保留走向粗判后缀',
    alp.look.indexOf('看天空与山脊线') !== -1
      && alp.look.indexOf('朝东至东北') === 0
      && /按轨迹走向朝.+，为粗判/.test(alp.look), alp.look)
}

section('4b. 光染 25–40 两档：标记与加分同一把尺（F6）')
{
  /* hourMarks 出标记的下界是 25、结论原加分界是 40：25–40 以前「有标记、有星级、没理由」。
     现在这一档 +8「中高云偏少」（两个界都是现成数，不新造）。夹具都用无地形，
     让「有地形逐字节相同」的阳性对照留在 §19。 */
  const tier30 = byKey(S.summarize(ctx(day({ '*': { low: 10, mid: 15, high: 15 } }), { heading: 90 })), 'alpenglow')
  check('25–40 档分数 86（30+18+8+16+6+8，' + tier30.score + '）', tier30.score === 86, tier30.text)
  check('25–40 档理由给「中高云偏少」，不再缺中高云那句', /中高云偏少/.test(tier30.text), tier30.text)
  check('25–40 档不冒充「中高云可被染色」', !/中高云可被染色/.test(tier30.text), tier30.text)
  check('25–40 档仍判 possible', tier30.verdict === 'possible', tier30.verdict)

  // 边界 40：20+20 仍走原 +14 路径（分数与改前相同）
  const tier40 = byKey(S.summarize(ctx(day({ '*': { low: 10, mid: 20, high: 20 } }), { heading: 90 })), 'alpenglow')
  check('边界 40 走 +14（92，' + tier40.score + '）', tier40.score === 92, tier40.text)
  check('边界 40 理由含「中高云可被染色」且不含「中高云偏少」',
    /中高云可被染色/.test(tier40.text) && !/中高云偏少/.test(tier40.text), tier40.text)

  // 边界 24：低于标记下界 ⇒ 没有标记、excluded、0 分；无地形零列表文案改说天空
  const tier24detail = day({ '*': { low: 10, mid: 12, high: 12 } })
  const tier24res = S.summarize(ctx(tier24detail, { heading: 90 }))
  const tier24 = byKey(tier24res, 'alpenglow')
  check('边界 24 无 alpenglow 标记', marksOf(tier24res, 'alpenglow').length === 0)
  check('边界 24 判 excluded 且 0 分', tier24.verdict === 'excluded' && tier24.score === 0, tier24.text)
  check('边界 24（无地形零列表）文案不含「山体被光染」', !/山体被光染/.test(tier24.text), tier24.text)
  check('边界 24 文案把主语放回天空（不把缺数据印成山体结论）',
    /天空与中高云/.test(tier24.text) && /被染色/.test(tier24.text), tier24.text)
  check('边界 24 保持概率语气（不写成绝对否定）', /概率很低/.test(tier24.text), tier24.text)
}

section('4c. 光染 25 界与有地形/无地形分支（第二轮硬化）')
{
  /* 四条边界都按「实测读数」写死，而不是只断言相对大小：
     基准为 low 10、无降水、无云带、heading 90、无地形 ⇒ 30+18+16+6+8=78，
     25–40 档再加 8 ⇒ 86。25（恰好达到 hourMarks 的标记下界）与 39（差 1 到 +14 界）
     必须与 30 一样走「中高云偏少」；heading 未知时方向不加 8、但理由仍要出现。 */
  const terrainAll = (angle, distance, elevation) => {
    const horizon = []
    for (let a = 0; a < 360; a += 22.5) horizon.push({ azimuth: a, angle, distance, elevation })
    return { horizon, openness: angle < 1 ? 1 : 0 }
  }

  const tier25res = S.summarize(ctx(day({ '*': { low: 10, mid: 12, high: 13 } }), { heading: 90 }))
  const tier25 = byKey(tier25res, 'alpenglow')
  check('精确 25 界：有标记、86 分、「中高云偏少」且 verdict possible（' + tier25.score + '）',
    marksOf(tier25res, 'alpenglow').length > 0 && tier25.score === 86
      && /中高云偏少/.test(tier25.text) && !/中高云可被染色/.test(tier25.text)
      && tier25.verdict === 'possible', tier25.text)

  const tier39 = byKey(S.summarize(ctx(day({ '*': { low: 10, mid: 20, high: 19 } }), { heading: 90 })), 'alpenglow')
  check('39 界：仍走 +8（86 分），不提前进入「中高云可被染色」（' + tier39.score + '）',
    tier39.score === 86 && /中高云偏少/.test(tier39.text) && !/中高云可被染色/.test(tier39.text), tier39.text)

  /* 防「+8 只在 heading 非空时生效」：heading 未知也必须拿到 25–40 档的 +8 与理由，
     方向分不加、但仍要说清「需东至东北侧视野开阔」。 */
  const noHeading = byKey(S.summarize(ctx(day({ '*': { low: 10, mid: 15, high: 15 } }))), 'alpenglow')
  check('heading 未知：25–40 档仍 +8（78 分）、理由含「中高云偏少」与「视野开阔」（' + noHeading.score + '）',
    noHeading.score === 78 && /中高云偏少/.test(noHeading.text) && /视野开阔/.test(noHeading.text), noHeading.text)

  /* 有地形 + 零列表：excluded 走 hasTerrain 真分支（angle -5 的开阔地平线也非 null），
     这是「有地形 = 有可用地形块，不是有山脊」的直接判据。零列表时 isDawn=false ⇒ side=昏光。 */
  const terrExcludedRes = S.summarize(ctx(day({ '*': { low: 10, mid: 12, high: 12 } }), {
    terrain: terrainAll(-5, 0, 0), heading: 90,
  }))
  const terrExcluded = byKey(terrExcludedRes, 'alpenglow')
  const EXCLUDED_WITH_TERRAIN = '今天昏光前后云量或降水条件不足，山体被光染的概率很低。'
  check('有地形 + 零列表：无标记、0 分、excluded，文案逐字保留「山体被光染」',
    marksOf(terrExcludedRes, 'alpenglow').length === 0
      && terrExcluded.score === 0 && terrExcluded.verdict === 'excluded'
      && terrExcluded.text === EXCLUDED_WITH_TERRAIN, terrExcluded.text)

  /* 有地形 + 25–40：同一档 +8，但主语不退回天空（口径仍是 DEM 的目标山体）。 */
  const terr30 = byKey(S.summarize(ctx(day({ '*': { low: 5, mid: 15, high: 15 } }), {
    terrain: terrainAll(-5, 0, 0),
  })), 'alpenglow')
  check('有地形 + 25–40：86 分、「中高云偏少」且仍说「山体被光染」；look 只说看山脊线',
    terr30.score === 86 && /中高云偏少/.test(terr30.text) && /山体被光染/.test(terr30.text)
      && /看山脊线/.test(terr30.look) && !/天空与山脊线/.test(terr30.look),
    terr30.text + ' / ' + terr30.look)
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

  /* ---- F7：反日方向明确有读数、却没有湿小时 ⇒ 封 44（「条件较差」），与「条件不足」措辞一致。
     封顶必须发生在全部加分之后（含 list.length>=3 的 +10）；有湿小时完全不动。 ---- */
  check('dry1h：反日无雨封顶 44（' + dry.score + ' / ' + dry.label + '）', dry.score === 44)
  check('dry1h：星级与「条件不足」一致（' + dry.tone + ' / ' + dry.label + '）',
    dry.tone === 'neutral' && dry.label === '条件较差' && /条件不足/.test(dry.text), dry.text)
  check('wet1h：有湿不封顶（' + wet.score + '）',
    wet.score === 80 && wet.score > 44 && /有降水信号/.test(wet.text), wet.text)

  const rainy3 = day({ '*': { low: 0, mid: 0, high: 0, precip: 0, rh: 70 } })
  ;[7, 8, 9].forEach(i => { rainy3[i].precip = 0.2; rainy3[i].rh = 90 })
  const dry3 = byKey(S.summarize(ctx(rainy3, {
    date: '2026-07-15', spatial: makeSpatial({ precip: 0, pop: 0 }),
  })), 'rainbow')
  const wet3 = byKey(S.summarize(ctx(rainy3, {
    date: '2026-07-15', spatial: makeSpatial({ precip: 0.5, pop: 80 }),
  })), 'rainbow')
  check('dry3h：封顶发生在 list.length 加分之后（' + dry3.score + '，未封顶应为 60）',
    dry3.score === 44)
  check('dry3h：文案仍写「条件不足」（封了分不能改口；' + dry3.label + '）',
    /条件不足/.test(dry3.text), dry3.text)
  check('wet3h：三小时湿 ⇒ 100，不受封顶影响（' + wet3.score + '）',
    wet3.score === 100 && wet3.score > 44, wet3.text)

  const terrainAll = (angle, distance, elevation) => {
    const horizon = []
    for (let a = 0; a < 360; a += 22.5) horizon.push({ azimuth: a, angle, distance, elevation })
    return { horizon, openness: angle < 1 ? 1 : 0 }
  }
  const terrainDry = byKey(S.summarize(ctx(rainy, {
    date: '2026-07-15', terrain: terrainAll(10, 10, 3000), spatial: makeSpatial({ precip: 0, pop: 0 }),
  })), 'rainbow')
  check('terrainBlockedDry：cap 只封不抬，35 不会被抬到 44（' + terrainDry.score + '）',
    terrainDry.score === 35, terrainDry.score + ' / ' + terrainDry.label)

  check('cap44 直接单元：50/true→44、50/false→50、30/true→30、44/true→44、43/true→43、45/true→44',
    S.cap44(50, true) === 44 && S.cap44(50, false) === 50 &&
      S.cap44(30, true) === 30 && S.cap44(44, true) === 44 &&
      S.cap44(43, true) === 43 && S.cap44(45, true) === 44)
}

section('18b. 彩虹太阳下限（F7：视地平线 = 蒙气差 + 海拔俯角，与 astro.sunTimes 同源）')
{
  check('astro.SUN_HORIZON 已导出且为数值（' + A.SUN_HORIZON + '）',
    typeof A.SUN_HORIZON === 'number' && A.SUN_HORIZON === -0.833)
  check('astro.horizonDip 已导出：海平面 0°、1200 m 约 1.112°（' + A.horizonDip(1200).toFixed(3) + '°）',
    typeof A.horizonDip === 'function' && A.horizonDip(0) === 0 && Math.abs(A.horizonDip(1200) - 1.112) < 0.01)

  /* 2026-01-15 日出 07:56：08:00 的太阳几何中心约 -1.11°。
     - 海平面视地平线 = -0.833 - 0 = -0.833° ⇒ -1.11 在它下面，不是彩虹小时；
     - 1200 m 视地平线 = -0.833 - 1.112 = -1.945° ⇒ -1.11 在它上面，彩虹小时保留。
     同一份逐时数据只改 elevation，就能把「俯角」这一项单独分离出来。 */
  const seaFloor = A.SUN_HORIZON - A.horizonDip(0)
  const highFloor = A.SUN_HORIZON - A.horizonDip(1200)
  const alt0800 = A.solarPosition(A.cnToMs('2026-01-15', '08:00'), LAT, LNG).altitude
  const alt1200 = A.solarPosition(A.cnToMs('2026-01-15', '12:00'), LAT, LNG).altitude

  /* ---- 第一组：海平面 ---- */
  check('海平面夹具有效性：08:00 高度落在 (-2, 视地平线]（' + alt0800.toFixed(2) + '）',
    alt0800 > -2 && alt0800 <= seaFloor)
  check('海平面夹具有效性：12:00 高度 > 视地平线且 < 40（' + alt1200.toFixed(2) + '）',
    alt1200 > seaFloor && alt1200 < 40)

  const morning = day({ '*': { low: 0, mid: 0, high: 0, precip: 0, rh: 70 } })
  morning[8].precip = 0.2
  morning[8].rh = 90
  morning[12].precip = 0.2
  morning[12].rh = 90
  const seaRes = S.summarize(ctx(morning, { date: '2026-01-15', elevation: 0 }))
  const seaRb = byKey(seaRes, 'rainbow')
  const seaMarks = marksOf(seaRes, 'rainbow')
  check('海平面 08:00（' + alt0800.toFixed(2) + '°）低于视地平线（' + seaFloor.toFixed(3) + '°）⇒ 无彩虹标记（' + seaMarks.join(',') + '）',
    seaMarks.indexOf('08:00') === -1)
  check('海平面 12:00 仍有彩虹标记', seaMarks.indexOf('12:00') !== -1)
  check('海平面 rainbow.at 落在 12:00（' + seaRb.at + '）', seaRb.at === '2026-01-15T12:00')
  check('海平面 rainbow 仍判 possible', seaRb.verdict === 'possible', seaRb.text)
  check('海平面 rainbow.score = 60（40 + 湿 1h 20，35.3° 无低太阳加分；' + seaRb.score + '）',
    seaRb.score === 60, seaRb.text)

  /* ---- 第二组：1200 m 正对照（高海拔不误删 —— M10/M11 的牙齿）---- */
  check('1200 m 夹具有效性：08:00 高度 > 视地平线且 < 12（' + alt0800.toFixed(2) + ' > ' + highFloor.toFixed(3) + '）',
    alt0800 > highFloor && alt0800 < 12)
  const highRes = S.summarize(ctx(morning, { date: '2026-01-15', elevation: 1200 }))
  const highRb = byKey(highRes, 'rainbow')
  const highMarks = marksOf(highRes, 'rainbow')
  check('1200 m 正对照：08:00 仍有彩虹标记（' + highMarks.join(',') + '）', highMarks.indexOf('08:00') !== -1)
  check('1200 m 正对照：12:00 仍有彩虹标记', highMarks.indexOf('12:00') !== -1)
  check('1200 m 正对照：rainbow.at 落在 08:00（' + highRb.at + '）', highRb.at === '2026-01-15T08:00')
  check('1200 m 正对照：rainbow 判 possible', highRb.verdict === 'possible', highRb.text)
  check('1200 m 正对照：rainbow.score = 90（40 + 湿 2h 30 + 低太阳 20；' + highRb.score + '）',
    highRb.score === 90, highRb.text)
  check('同一份数据只改 elevation ⇒ 08:00 从无到有（差异只能来自俯角）',
    seaMarks.indexOf('08:00') === -1 && highMarks.indexOf('08:00') !== -1)

  /* 黄昏正对照：防止把下限改得过严（例如 > 0）。2026-12-15 18:00 太阳恰为 0°，
     仍在视地平线之上 ⇒ 必须保留标记与低太阳 +20（40+20+20=80）。 */
  const dusk = day({ '*': { low: 0, mid: 0, high: 0, precip: 0, rh: 70 } })
  dusk[18].precip = 0.2
  dusk[18].rh = 90
  const alt1800 = A.solarPosition(A.cnToMs('2026-12-15', '18:00'), LAT, LNG).altitude
  check('夹具有效性：18:00 高度 > 视地平线且 < 12（' + alt1800.toFixed(2) + '）',
    alt1800 > A.SUN_HORIZON - A.horizonDip(1200) && alt1800 < 12)
  const dRes = S.summarize(ctx(dusk, { date: '2026-12-15' }))
  const dRb = byKey(dRes, 'rainbow')
  const dMarks = marksOf(dRes, 'rainbow')
  check('黄昏 18:00 仍有彩虹标记（' + dMarks.join(',') + '）', dMarks.indexOf('18:00') !== -1)
  check('黄昏正对照：rainbow.score = 80（' + dRb.score + '）', dRb.score === 80, dRb.text)
  check('黄昏正对照：rainbow 判 possible', dRb.verdict === 'possible', dRb.text)
}

section('18c. 彩虹封顶与方向读数的边界（C6 收口）')
{
  /* 方向性 spatial 的最小形态：只给需要被读的字段（precip / pop 可缺）。
     2026-07-15 的彩虹小时覆盖 07:00（太阳 8.98°）与 08:00（21.24°）。 */
  const times0715 = []
  for (let h = 0; h < 24; h++) times0715.push('2026-07-15T' + String(h).padStart(2, '0') + ':00')
  const spatialAt = (times, vals) => ({
    times,
    hours: times.map(t => t.slice(11, 16)),
    byAzimuth: [0, 45, 90, 135, 180, 225, 270, 315].map(az => {
      const row = {
        azimuth: az,
        low: times.map(() => 0),
        mid: times.map(() => 0),
        high: times.map(() => 0),
      }
      if (vals.precip !== undefined) row.precip = times.map(() => vals.precip)
      if (vals.pop !== undefined) row.pop = times.map(() => vals.pop)
      return row
    }),
  })

  /* ---- 1）非方向性高湿、无降水：不得被封 44。
     wetHours 的非方向性分支只数 precip/showers（0），`directional &&` 守卫必须让它保持 60。
     删掉守卫 ⇒ 60 被封成 44「条件较差」，本组立刻红。 ---- */
  const humid = day({ '*': { rh: 70 } })
  humid[7].rh = 90
  const humidRes = S.summarize(ctx(humid, { date: '2026-07-15' }))
  const humidRb = byKey(humidRes, 'rainbow')
  check('非方向性高湿：rainbow 标记只在 07:00（' + marksOf(humidRes, 'rainbow').join(',') + '）',
    marksOf(humidRes, 'rainbow').join(',') === '07:00')
  check('非方向性高湿：rainbow.score = 60（40 + 低太阳 20，不被封 44；' + humidRb.score + '）',
    humidRb.score === 60, humidRb.text)
  check('非方向性高湿：分档仍是「条件一般」(warning)（' + humidRb.tone + ' / ' + humidRb.label + '）',
    humidRb.tone === 'warning' && humidRb.label === '条件一般', humidRb.text)
  check('非方向性高湿：文案走单点口径（有降水或高湿 + 可能性存在）',
    /有降水或高湿/.test(humidRb.text) && /可能性存在/.test(humidRb.text), humidRb.text)
  check('非方向性高湿：verdict = possible', humidRb.verdict === 'possible', humidRb.verdict)

  /* ---- 2）高海拔 3004 m 的视地平线（紧边界）。
     2026-02-16 19:00 太阳约 -2.53°，视地平线 -2.592°：只差 0.06°，仍在上面。
     把 dip 钳到 1.5 ⇒ 视地平线 -2.333°，19:00 被误删 ⇒ 本组三项全红。 ---- */
  const highAlt = day({ '*': { rh: 70 } })
  highAlt[19].precip = 0.2
  highAlt[19].rh = 90
  const alt1900 = A.solarPosition(A.cnToMs('2026-02-16', '19:00'), LAT, LNG).altitude
  const floor3004 = A.SUN_HORIZON - A.horizonDip(3004)
  check('3004 m 夹具有效性：19:00 高度 > 视地平线（' + alt1900.toFixed(2) + ' > ' + floor3004.toFixed(3) + '）',
    alt1900 > floor3004)
  check('3004 m 夹具有效性：高度距视地平线 < 0.2°（紧边界；' + (alt1900 - floor3004).toFixed(3) + '）',
    alt1900 - floor3004 < 0.2)
  const highAltRes = S.summarize(ctx(highAlt, { date: '2026-02-16', elevation: 3004 }))
  const highAltRb = byKey(highAltRes, 'rainbow')
  check('3004 m：19:00 仍有彩虹标记（' + marksOf(highAltRes, 'rainbow').join(',') + '）',
    marksOf(highAltRes, 'rainbow').indexOf('19:00') !== -1)
  check('3004 m：rainbow.score = 80（40 + 低太阳 20 + wetHours 1×20；' + highAltRb.score + '）',
    highAltRb.score === 80, highAltRb.text)
  check('3004 m：rainbow.at = 2026-02-16T19:00（' + highAltRb.at + '）',
    highAltRb.at === '2026-02-16T19:00')
  check('3004 m：rainbow 判 possible', highAltRb.verdict === 'possible', highAltRb.text)

  /* ---- 3）方向性读数的混合覆盖：some ≠ every。
     spatial 只覆盖 07:00；08:00 也满足彩虹小时但没有方向读数。
     `some` ⇒ directional=true、wetHours=0（07:00 的反日 precip/pop 都是 0）⇒ 封 44。
     改成 `every` ⇒ directional=false ⇒ 退回单点口径（两个湿小时）⇒ 90 分 + 另一套文案。 ---- */
  const mixed = day({ '*': { rh: 70 } })
  ;[7, 8].forEach(i => { mixed[i].precip = 0.2; mixed[i].rh = 90 })
  const mixedRes = S.summarize(ctx(mixed, {
    date: '2026-07-15', spatial: spatialAt(['2026-07-15T07:00'], { precip: 0, pop: 0 }),
  }))
  const mixedRb = byKey(mixedRes, 'rainbow')
  check('混合覆盖：两个彩虹小时都在（' + marksOf(mixedRes, 'rainbow').join(',') + '）',
    marksOf(mixedRes, 'rainbow').join(',') === '07:00,08:00')
  check('混合覆盖：directional=true 且 wetHours=0 ⇒ score 44（' + mixedRb.score + '）',
    mixedRb.score === 44, mixedRb.text)
  check('混合覆盖：走方向性文案「反日方向未检出降水」，不是单点口径',
    /反日方向未检出降水/.test(mixedRb.text) && !/有降水或高湿/.test(mixedRb.text), mixedRb.text)
  check('混合覆盖：verdict = possible', mixedRb.verdict === 'possible', mixedRb.verdict)
  /* 部分覆盖 ≠ 未检出：08:00 没有方向读数，文案必须把「未知」披露出来，
     否则「反日方向未检出降水」就是把缺测印成了否定事实（铁律 26② / 33②）。 */
  check('混合覆盖：缺测必须披露「部分时段无方向读数」（部分覆盖 ≠ 未检出）',
    /部分时段无方向读数/.test(mixedRb.text), mixedRb.text)
  /* 披露只加话、不改判断：封顶触发条件仍是 directional && wetHours === 0，分数/档位一个数都不动。 */
  check('混合覆盖：披露不改变判断（仍 44 分、仍写「反日方向未检出降水」）',
    mixedRb.score === 44 && /反日方向未检出降水/.test(mixedRb.text), mixedRb.score + ' / ' + mixedRb.text)
  /* 两条 directional 分支都要披露：07:00 有方向读数（有雨）、08:00 未知 ⇒ 80 分 + 「有降水信号」。
     缺了这条，wetText 的前半支漏加披露不会被任何用例发现（只测 dry 分支等于只测一半）。 */
  const mixedWet = day({ '*': { rh: 70 } })
  ;[7, 8].forEach(i => { mixedWet[i].precip = 0.2; mixedWet[i].rh = 90 })
  const mixedWetRb = byKey(S.summarize(ctx(mixedWet, {
    date: '2026-07-15', spatial: spatialAt(['2026-07-15T07:00'], { precip: 0.5, pop: 80 }),
  })), 'rainbow')
  check('混合覆盖（有湿分支）：wetHours=1 ⇒ 80 分，且同样披露「部分时段无方向读数」（' + mixedWetRb.score + '）',
    mixedWetRb.score === 80 && /反日方向有降水信号/.test(mixedWetRb.text)
      && /部分时段无方向读数/.test(mixedWetRb.text), mixedWetRb.text)

  /* ---- 4）湿小时的两条臂：precip 与 pop 各自成立，也各自可缺。
     precip-only：pop 字段整体缺失；方向性判定必须仍为 true（`||`，不是 `&&`），
                  wetHours 认 0.5 mm/h 的降水（> 0.05）⇒ 80。
     pop-only：precip 全 0、pop 80 ⇒ 湿小时成立（>= 50）⇒ 80。 ---- */
  const precipDay = day({ '*': { rh: 70 } })
  precipDay[7].precip = 0.2
  precipDay[7].rh = 90
  const precipRes = S.summarize(ctx(precipDay, {
    date: '2026-07-15', spatial: spatialAt(times0715, { precip: 0.5 }),
  }))
  const precipRb = byKey(precipRes, 'rainbow')
  check('precip-only：directional=true 且 wetHours=1 ⇒ score 80（' + precipRb.score + '）',
    precipRb.score === 80, precipRb.text)
  check('precip-only：文案「反日方向有降水信号」', /反日方向有降水信号/.test(precipRb.text), precipRb.text)
  check('precip-only：verdict = possible', precipRb.verdict === 'possible', precipRb.verdict)
  /* dirPartial 的阴性对照：spatial 覆盖全部彩虹小时 ⇒ 不得无条件追加「部分时段无方向读数」。
     没有这条，「永远追加」也能让上面的混合覆盖断言全绿（铁律 33⑥ 的阳性/阴性对照同源教训）。 */
  check('全覆盖（precip-only）：不追加「部分时段无方向读数」（dirPartial=false）',
    /部分时段无方向读数/.test(precipRb.text) === false, precipRb.text)

  const popDay = day({ '*': { rh: 70 } })
  popDay[7].precip = 0.2
  popDay[7].rh = 90
  const popRes = S.summarize(ctx(popDay, {
    date: '2026-07-15', spatial: spatialAt(times0715, { precip: 0, pop: 80 }),
  }))
  const popRb = byKey(popRes, 'rainbow')
  check('pop-only：wetHours=1 ⇒ score 80（' + popRb.score + '）', popRb.score === 80, popRb.text)
  check('pop-only：文案「反日方向有降水信号」', /反日方向有降水信号/.test(popRb.text), popRb.text)
  check('pop-only：verdict = possible', popRb.verdict === 'possible', popRb.verdict)
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
  /* 阳性对照（F6）：**有地形**时口径逐字节不变——文案仍说「山体被光染」、look 仍是「看山脊线」，
     不得出现无地形分支的「天空与山脊线」；两个精确分数就是改前值（30+18+14+16+6+8 / −10；
     open 92、blocked 74）。 */
  check('有地形：look 仍是「看山脊线」且不出现「天空与山脊线」',
    /看山脊线/.test(glowOpen.look) && !/天空与山脊线/.test(glowOpen.look), glowOpen.look)
  check('有地形：文案仍是「山体被光染」且分数 92（' + glowOpen.score + '）',
    /山体被光染/.test(glowOpen.text) && glowOpen.score === 92, glowOpen.text)
  check('有地形：太阳低于山脊 74 分且仍说「山体被光染」',
    glowBlocked.score === 74 && /山体被光染/.test(glowBlocked.text)
      && /太阳低于此方位山脊/.test(glowBlocked.text), glowBlocked.text)
  /* 同一支的措辞也钉住：74 分的结论必须说「概率较低」，不能印成「概率较高」——
     文案换向时分数与主语都还「看着对」，只有这一条会红。 */
  check('有地形：被山脊挡住说「概率较低」且不说「概率较高」（' + glowBlocked.score + '）',
    glowBlocked.score === 74 && /概率较低/.test(glowBlocked.text) && !/概率较高/.test(glowBlocked.text)
      && /山体被光染/.test(glowBlocked.text), glowBlocked.text)
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

section('22. 云海主卡：民用晨昏裁剪 + 云带分层（2026-10-21 F3）')
{
  /* 缺陷一：主卡窗口取的是 hourMarks 的原始小时，从来没做民用晨昏裁剪——云带只在 01–05 时，
     卡片就写「清晨 01:00-05:00 有…机会」，而凌晨是黑的。agenda 与 OI 早就裁了，只有主卡漏了。
     修法把判据收进 S.civilClip（单源），窗口与文案都走它；**标记行不裁**（事实层）。
     期望边界一律来自 A.sunTimes，交叉判定在本节独立重写一遍，不调用被测实现。 */
  const V = S.VERDICT
  const bandLow = { base: 1000, top: 1600, cover: 95 }
  const sun2k = A.sunTimes(DATE, LAT, LNG, 2000)      // 云海卡内部用同一个海拔算民用晨昏
  const civilFrom = S.hourMin(sun2k.civilDawn)
  const civilTo = S.hourMin(sun2k.civilDusk)
  const label = h => String(h).padStart(2, '0') + ':00'
  const overlap = h => Math.min(h * 60 + 60, civilTo) > Math.max(h * 60, civilFrom)
  /* 窗口文本按 hourSegments 的格式独立拼一遍：单个小时也印成「HH:00-HH:00」，
     这正是生产格式（hourSegments 对单元素同样 `start.t + '-' + prev.t`）。 */
  const expectWindow = hs => {
    const keep = hs.filter(overlap)
    const segs = []
    let start = null
    let prev = null
    keep.forEach(h => {
      if (start === null) { start = h }
      else if (h !== prev + 1) { segs.push(label(start) + '-' + label(prev)); start = h }
      prev = h
    })
    if (start !== null) segs.push(label(start) + '-' + label(prev))
    return segs.join(' / ')
  }

  // ① 云带只在 01–05 时：窗口必须裁到民用晨光之后的第一小时
  const nightBand = day({
    '*': { high: 10, wind: 6 },
    1: { band: bandLow }, 2: { band: bandLow }, 3: { band: bandLow }, 4: { band: bandLow }, 5: { band: bandLow },
  })
  const nightRes = S.summarize(ctx(nightBand, { elevation: 2000, days: [{ date: '2026-07-17', precipSum: 3.2 }] }))
  const nightSea = byKey(nightRes, 'cloudSea')
  check('黑夜云带：窗口被裁到民用晨光覆盖的那个小时（民用晨光 ' + sun2k.civilDawn + '，期望 ' + expectWindow([1, 2, 3, 4, 5]) + '）',
    nightSea.window === expectWindow([1, 2, 3, 4, 5]) && nightSea.window === '05:00-05:00',
    nightSea.window)
  check('黑夜云带：文案不再出现「清晨 01:00」，只写天光内的时段',
    !/01:00/.test(nightSea.text) && /清晨 05:00/.test(nightSea.text), nightSea.text)
  check('黑夜云带的标记行不裁剪：图表仍标出 01–05（事实层与可行动窗口分开）',
    marksOf(nightRes, 'cloudSea').join(',') === '01:00,02:00,03:00,04:00,05:00',
    marksOf(nightRes, 'cloudSea').join(','))
  check('黑夜云带 verdict 不变：裁剪只动窗口，不动「此点在云带上方」这个几何事实',
    nightSea.verdict === V.POSSIBLE && nightSea.score === 100, nightSea.verdict + '/' + nightSea.score)

  // ② 3500–3800 m 中高云带 + 观察点 4000 m：分数必须与「云带偏高」这句话一致
  const bandHigh = { base: 3500, top: 3800, cover: 95 }
  const highDay = day({
    '*': { high: 10, wind: 6 },
    6: { band: bandHigh }, 7: { band: bandHigh }, 8: { band: bandHigh }, 9: { band: bandHigh },
  })
  const highSea = byKey(S.summarize(ctx(highDay, { elevation: 4000, days: [] })), 'cloudSea')
  /* 改前（D:/ot-baselines/c2 快照实测）：score=74 / tone=success / 4 星，理由写「云带偏高」，
     文案却仍是「有在云顶之上看云海的机会」。下面钉的是封顶后的准确值而不是模糊的 ≤69。 */
  check('中高云带（3500–3800 m）+ 点 4000 m：分数被封顶 69（改前 74）', highSea.score === 69, highSea.score)
  check('中高云带：tone/label 与 grade(69) 自洽（不再 4 星）',
    highSea.tone === 'warning' && highSea.label === '条件一般'
    && highSea.tone === S.grade(highSea.score).tone && highSea.label === S.grade(highSea.score).label,
    highSea.tone + '/' + highSea.label)
  check('中高云带：verdict 仍是 possible（站在实心云带上方是几何事实，不是「判过了不成立」）',
    highSea.verdict === V.POSSIBLE, highSea.verdict)
  check('中高云带：文案不再断言「低层有云带」', !/低层/.test(highSea.text), highSea.text)
  check('中高云带：文案点名「可能不是贴地云海」', /可能不是贴地云海/.test(highSea.text), highSea.text)

  /* ②-b 分层边界：2200 是本文件既有分界，改成 >= 会把恰好 2200 m 的贴地云带也封顶。
     两个边界各钉一次，防止「阈值承重却没有边界夹具」。 */
  const bandEdgeLow = { base: 2200, top: 2600, cover: 95 }
  const edgeLowDay = day({
    '*': { high: 10, wind: 6 },
    6: { band: bandEdgeLow }, 7: { band: bandEdgeLow }, 8: { band: bandEdgeLow }, 9: { band: bandEdgeLow },
  })
  const edgeLowSea = byKey(S.summarize(ctx(edgeLowDay, { elevation: 3000, days: [] })), 'cloudSea')
  check('分层边界：底恰好 2200 m 仍按贴地云带（分数 88，不出现「可能不是贴地云海」）',
    edgeLowSea.score === 88 && !/可能不是贴地云海/.test(edgeLowSea.text), edgeLowSea.score + '/' + edgeLowSea.text)
  const bandEdgeHigh = { base: 2201, top: 2600, cover: 95 }
  const edgeHighDay = day({
    '*': { high: 10, wind: 6 },
    6: { band: bandEdgeHigh }, 7: { band: bandEdgeHigh }, 8: { band: bandEdgeHigh }, 9: { band: bandEdgeHigh },
  })
  const edgeHighSea = byKey(S.summarize(ctx(edgeHighDay, { elevation: 3000, days: [] })), 'cloudSea')
  check('分层边界：底 2201 m 起按中高云带封顶 69 且点名「可能不是贴地云海」',
    edgeHighSea.score === 69 && /可能不是贴地云海/.test(edgeHighSea.text), edgeHighSea.score + '/' + edgeHighSea.text)

  /* ②-c 有云带、此点也在带顶之上，但高层云 ≥30% 使 hourMarks 一个云海标记都不打。
     这不是「天光不足」——clippedOut 必须只在**确有标记被裁空**时成立。
     （分数 74/4 星与「云顶被遮住的概率较高」同屏是既有张力，计划未列，只登记不修；
     这里钉的是归因与封顶判据，不是认可那个分数。） */
  const blockedDay = day({
    '*': { high: 50, wind: 6 },
    6: { band: bandLow, high: 50, wind: 6 }, 7: { band: bandLow, high: 50, wind: 6 },
    8: { band: bandLow, high: 50, wind: 6 }, 9: { band: bandLow, high: 50, wind: 6 },
  })
  const blockedRes = S.summarize(ctx(blockedDay, { elevation: 2000, days: [] }))
  const blockedSea = byKey(blockedRes, 'cloudSea')
  check('高层云遮住、无任何云海标记：归因为高层云，不得说成「天光不足」',
    /高层云较多/.test(blockedSea.text) && !/天光不足/.test(blockedSea.text), blockedSea.text)
  check('无标记可裁时不得触发 clippedOut 封顶（分数仍 >69，改前 74）',
    blockedSea.score > 69 && marksOf(blockedRes, 'cloudSea').length === 0,
    blockedSea.score + '/' + marksOf(blockedRes, 'cloudSea').join(','))

  /* ②-d 混合日：晨光前有云海标记（会被裁空），白天还有成层云带但被高层云遮住（本来就没标记）。
     clippedOut 只能说「**有云海条件**的时段落在晨光前」，不能说「云带时段」——
     后者会把白天那条被遮住的带也算成"在天光之外"，是把没发生的事当原因。 */
  const mixedDay = day({
    '*': { high: 10, wind: 6 },
    1: { band: bandLow }, 2: { band: bandLow }, 3: { band: bandLow },
    6: { band: bandLow, high: 50, wind: 6 }, 7: { band: bandLow, high: 50, wind: 6 },
    8: { band: bandLow, high: 50, wind: 6 }, 9: { band: bandLow, high: 50, wind: 6 },
  })
  const mixedRes = S.summarize(ctx(mixedDay, { elevation: 2000, days: [] }))
  const mixedSea = byKey(mixedRes, 'cloudSea')
  check('混合日：全裁空文案限定为「有云海条件的时段」，不把白天被遮住的云带算进来',
    mixedSea.window === '' && /有云海条件的时段落在民用晨光之前/.test(mixedSea.text)
    && !/云带时段落在/.test(mixedSea.text), mixedSea.window + '/' + mixedSea.text)
  check('混合日：封顶 69 且 verdict 仍是 possible',
    mixedSea.score === 69 && mixedSea.verdict === V.POSSIBLE, mixedSea.score + '/' + mixedSea.verdict)

  // ③ 阳性对照（改前值取自 D:/ot-baselines/c2 快照，硬编码为逐字节期望）
  /* ③-1 低层云带整段落在民用晨光之后：一个都不裁 ⇒ 分数与文案必须与改前逐字节相同。
     没有这条，「全都变了」就分不清是裁剪在判还是把文案推倒重写。 */
  const insideDay = day({
    '*': { high: 10, wind: 6 },
    6: { band: bandLow }, 7: { band: bandLow }, 8: { band: bandLow }, 9: { band: bandLow },
  })
  const insideSea = byKey(S.summarize(ctx(insideDay, { elevation: 2000, days: [{ date: '2026-07-17', precipSum: 3.2 }] })), 'cloudSea')
  check('阳性对照：低层云带全在天光内 ⇒ 分数与文案与改前逐字节相同',
    insideSea.score === 100
    && insideSea.text === '清晨 06:00-09:00 有在云顶之上看云海的机会（低层有云带（底约 1000 m）、此点在云带上方、清晨高层云少、清晨微风（7 km/h）、前日有降水（3.2 mm））。',
    insideSea.text)
  /* ③-2 §7 那组（04–09 时）：04:00 那一小时覆盖 [04:00,05:00)，整段早于民用晨光 05:46 ⇒
     被裁掉是**正确**的，所以它的文案只差窗口这一处（04:00-09:00 → 05:00-09:00），
     分数与其后每个字必须与改前逐字节相同。计划里写的「§7 文案逐字节相同」与代码事实不符：
     那组云带含 04 时，任何诚实的晨昏裁剪都会摘掉它。此处按更强的形态钉住：
     score 逐字节相同 + 文案除窗口外逐字节相同（窗口另有一条独立断言）。 */
  const s7Day = day({
    '*': { high: 10, wind: 6 },
    4: { band: bandLow }, 5: { band: bandLow }, 6: { band: bandLow }, 7: { band: bandLow },
    8: { band: bandLow }, 9: { band: bandLow },
  })
  const s7Sea = byKey(S.summarize(ctx(s7Day, { elevation: 2000, days: [{ date: '2026-07-17', precipSum: 3.2 }] })), 'cloudSea')
  check('§7 低层云带：分数与改前逐字节相同（100）', s7Sea.score === 100, s7Sea.score)
  check('§7 低层云带：窗口 04:00-09:00 → 05:00-09:00（只摘掉整段在晨光前的 04 时）',
    s7Sea.window === '05:00-09:00', s7Sea.window)
  check('§7 低层云带：文案除被裁窗口外与改前逐字节相同',
    s7Sea.text === '清晨 05:00-09:00 有在云顶之上看云海的机会（低层有云带（底约 1000 m）、此点在云带上方、清晨高层云少、清晨微风（7 km/h）、前日有降水（3.2 mm））。',
    s7Sea.text)

  // ④ 全被裁空：listAll 非空而 list 空 ⇒ 文案必须点名天光，不得沿用「高层云较多/风偏大」
  const preDawnOnly = day({ '*': { high: 10, wind: 6 }, 1: { band: bandLow }, 2: { band: bandLow }, 3: { band: bandLow } })
  const emptyRes = S.summarize(ctx(preDawnOnly, { elevation: 2000, days: [] }))
  const emptySea = byKey(emptyRes, 'cloudSea')
  check('全被裁空：窗口为空，但标记行仍完整（01–03 三个事实小时）',
    emptySea.window === '' && marksOf(emptyRes, 'cloudSea').join(',') === '01:00,02:00,03:00',
    JSON.stringify({ window: emptySea.window, marks: marksOf(emptyRes, 'cloudSea') }))
  check('全被裁空：文案点名民用晨光 / 天光不足',
    /民用晨光/.test(emptySea.text) && /天光不足/.test(emptySea.text), emptySea.text)
  check('全被裁空：不再把没发生的事当原因（不出现「高层云较多|风偏大」）',
    !/高层云较多|风偏大/.test(emptySea.text), emptySea.text)
  /* 文案已经说「可能性低」，星级不得再挂「条件较好」（改前 score=88 / success / 4 星）。
     与高云带共用既有 cap69，不新造阈值。 */
  check('全被裁空：分数被封顶恰为 69（改前 88；≤69 会放过更低分）', emptySea.score === 69, emptySea.score)
  check('全被裁空：tone/label 与 grade(score) 自洽，且不再是 success / 条件较好',
    emptySea.tone !== 'success' && emptySea.label !== '条件较好'
    && emptySea.tone === S.grade(emptySea.score).tone && emptySea.label === S.grade(emptySea.score).label,
    emptySea.tone + '/' + emptySea.label + '/' + emptySea.score)
  check('全被裁空：verdict 仍是 possible（看不见 ≠ 判过了不成立）',
    emptySea.verdict === V.POSSIBLE, emptySea.verdict)

  // ⑤ civilClip / clipRange 的缺测与边界语义
  const someHours = [{ t: '01:00' }, { t: '12:00' }]
  const kept = S.civilClip(someHours, { civilDawn: null, civilDusk: null })
  check('civilClip 缺天文数据：原样返回（宁可多给，不给错）',
    kept.length === 2 && kept[0] === someHours[0] && kept[1] === someHours[1], JSON.stringify(kept))
  check('civilClip 缺天文数据：返回副本，不与入参共用数组', kept !== someHours)
  check('civilWindow：缺字段/传 null 都是 ok=false',
    S.civilWindow({}).ok === false && S.civilWindow(null).ok === false
    && S.civilWindow({ civilDawn: '05:46' }).ok === false)
  check('clipRange 缺天文数据：原样返回区间',
    JSON.stringify(S.clipRange(60, 120, { ok: false })) === JSON.stringify({ from: 60, to: 120 }))
  /* 半开区间 [start,end)：只在边界上相接不算相交（`>` 写成 `>=` 就会凭空多出一小时）。 */
  const cw = { from: 300, to: 400, ok: true }
  check('clipRange 边界：区间末端恰好等于晨光起点 ⇒ 不相交', S.clipRange(240, 300, cw) === null)
  check('clipRange 边界：区间起点恰好等于暮光终点 ⇒ 不相交', S.clipRange(400, 460, cw) === null)
  check('clipRange 边界：与晨光有一分钟交集即保留（300–301）',
    JSON.stringify(S.clipRange(240, 301, cw)) === JSON.stringify({ from: 300, to: 301 }))
  /* 日落这一侧同样要裁：20:34 的民用暮光之后，21 时起的小时整段在天光之外。
     （云海标记本身只落在 10 点前，所以这条只能直接钉判据；变异「只裁起点不裁终点」专抓它。） */
  check('civilClip 也裁日落一侧：19/20 时保留（与暮光有交集），21/22 时整段丢弃',
    S.civilClip([{ t: '19:00' }, { t: '20:00' }, { t: '21:00' }, { t: '22:00' }], sun2k)
      .map(h => h.t).join(',') === '19:00,20:00',
    S.civilClip([{ t: '19:00' }, { t: '20:00' }, { t: '21:00' }, { t: '22:00' }], sun2k).map(h => h.t).join(','))
}

section('23. 结论项的 at 锚点（F4 阶段一）')
{
  /* 计划 §5.2：结论项新增附加字段 `at`（它真正在说的那个小时），`factsFor` 的
     star/galaxy 证据锚点据此落在跨夜后的次日；非跨夜输出必须逐字节不变。
     本节的跨夜夹具刻意让银河 best 落在次日 01:00（不是夜段第一小时，也不是 dusk），
     这样「用 night[0] 冒充 best」「无条件改锚点」两种错法都会被抓到。 */
  const C = require('../miniprogram/utils/conditions')
  const FULL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

  // 跨夜夹具：所选日 2026-07-15（银心季 + 新月），series 覆盖到次日
  const d1 = day({ '*': { low: 0, mid: 0, high: 0 } }).map(h => Object.assign({}, h, { d: '2026-07-15' }))
  const d2 = day({ '*': { low: 0, mid: 0, high: 0 } }).map(h => Object.assign({}, h, { d: '2026-07-16' }))
  d1[22].cloud = { low: 20, mid: 20, high: 20 }
  d1[23].cloud = { low: 20, mid: 20, high: 20 }
  d2[0].cloud = { low: 10, mid: 10, high: 10 } // 00:00 略多云 ⇒ best 不会停在它身上
  const series = d1.concat(d2)
  const res = S.summarize(ctx(d1, {
    date: '2026-07-15', series, lightPollution: { bortle: 2, sqm: 21.8 },
  }))
  const star = byKey(res, 'star')
  const galaxy = byKey(res, 'galaxy')
  const light = byKey(res, 'light')

  // ① 六项都有 at（string；空串或完整日期时刻）
  check('六项结论都有 at 字段且为 string', res.items.length === 6
    && res.items.every(it => typeof it.at === 'string'), res.items.map(it => it.key + ':' + typeof it.at).join(','))
  check('at 要么是空串、要么是完整 YYYY-MM-DDTHH:mm（没有半截日期）',
    res.items.every(it => it.at === '' || FULL_RE.test(it.at)), res.items.map(it => it.at).join(' | '))
  check('light.at = 日出钟点（' + light.at + '）', light.at === '2026-07-15T' + res.sun.sunrise, light.at)
  check('star.at = 夜段第一个小时（所选日 22:00）', star.at === '2026-07-15T22:00', star.at)
  check('galaxy.at = best 小时（次日 01:00，不是夜段第一个小时）',
    galaxy.at === '2026-07-16T01:00' && star.at !== galaxy.at, galaxy.at)
  check('galaxy.at 的日期确实是次日', galaxy.at.slice(0, 10) === '2026-07-16', galaxy.at)
  check('窗口文本未被 at 替代（仍是「01:00 前后（次日）」）',
    galaxy.window === '01:00 前后（次日）', galaxy.window)

  // ② 其余三项：有可行动窗口时 at 指向第一个小时
  const wet = day({ 7: { low: 30, mid: 20, high: 10, precip: 0.4, rh: 92 }, '*': {} })
  const wetRes = S.summarize(ctx(wet))
  const rb = byKey(wetRes, 'rainbow')
  check('rainbow.at = 第一个彩虹小时（07:00）', rb.at === DATE + 'T07:00', rb.at)
  const alpDay = day({ '*': { low: 10, mid: 50, high: 40 } })
  const alp = byKey(S.summarize(ctx(alpDay)), 'alpenglow')
  check('alpenglow.at = 第一个光染小时（06:00）', alp.at === DATE + 'T06:00', alp.at)
  const bandLow = { base: 1000, top: 1600, cover: 95 }
  const seaDay = day({ '*': { high: 10, wind: 6 }, 6: { band: bandLow }, 7: { band: bandLow } })
  const sea = byKey(S.summarize(ctx(seaDay, { elevation: 2000 })), 'cloudSea')
  check('cloudSea.at = 裁剪后可行动窗口的第一小时（06:00）', sea.at === DATE + 'T06:00', sea.at)

  // ③ 非跨夜：只给 detail、没有 series ⇒ at 都是同日（阳性对照的输入）
  const flat = day({ '*': { low: 0, mid: 0, high: 0 } })
  const flatRes = S.summarize(ctx(flat))
  const fStar = byKey(flatRes, 'star')
  const fGal = byKey(flatRes, 'galaxy')
  check('无 series 时 star/galaxy 的 at 都是同日（不是次日）',
    fStar.at.slice(0, 10) === DATE && fGal.at.slice(0, 10) === DATE, fStar.at + ' / ' + fGal.at)
  const polar = S.summarize(ctx(day(), { date: '2026-07-15', lat: 78, lng: 15, elevation: 100 }))
  check('极昼/无暗夜小时 ⇒ star/galaxy.at 为空串（没有可用小时就不编日期）',
    byKey(polar, 'star').at === '' && byKey(polar, 'galaxy').at === '',
    byKey(polar, 'star').at + ' / ' + byKey(polar, 'galaxy').at)

  const fctx = {
    date: DATE, detail: flat, days: [], elevation: 1200,
    sun: flatRes.sun, moon: flatRes.moon, night: flatRes.night,
  }
  check('非跨夜 + 传 item：star 证据逐字节相同（阳性对照）',
    JSON.stringify(C.factsFor('star', Object.assign({}, fctx, { item: fStar })))
      === JSON.stringify(C.factsFor('star', fctx)))
  check('非跨夜 + 传 item：galaxy 证据逐字节相同（阳性对照）',
    JSON.stringify(C.factsFor('galaxy', Object.assign({}, fctx, { item: fGal })))
      === JSON.stringify(C.factsFor('galaxy', fctx)))

  // ④ 跨夜：只有 at 换成完整日期，fact/kind/顺序/条数逐字节相同
  const xctx = {
    date: '2026-07-15', detail: d1, days: [], elevation: 1200,
    sun: res.sun, moon: res.moon, night: res.night,
  }
  const baseGal = C.factsFor('galaxy', xctx)
  const itemGal = C.factsFor('galaxy', Object.assign({}, xctx, { item: galaxy }))
  const duskMin = S.hourMin(res.sun.astroDusk)
  const legacyAnchor = (d1.find(h => duskMin >= S.hourMin(h.t) && duskMin < S.hourMin(h.t) + 60) || d1[0]).t
  check('跨夜 + 不传 item：仍是旧的 dusk 锚点（HH:mm，不是无条件改）',
    baseGal.length > 0 && baseGal.every(f => f.at === legacyAnchor) && /^\d{2}:\d{2}$/.test(legacyAnchor),
    baseGal.map(f => f.at).join(',') + ' anchor=' + legacyAnchor)
  check('跨夜 + 传 item：证据条数相同', itemGal.length === baseGal.length,
    baseGal.length + ' vs ' + itemGal.length)
  check('跨夜 + 传 item：fact / kind / 顺序逐字节相同，只有 at 变完整日期',
    itemGal.every((f, i) => f.fact === baseGal[i].fact && f.kind === baseGal[i].kind)
      && itemGal.every(f => f.at === galaxy.at), JSON.stringify(itemGal))
  const itemStar = C.factsFor('star', Object.assign({}, xctx, { item: star }))
  check('跨夜夜段里 star.at 不是次日 ⇒ star 证据保持 HH:mm（逐字节相同）',
    JSON.stringify(itemStar) === JSON.stringify(C.factsFor('star', xctx)))
  /* star 自己的 at 取夜段第一小时（通常同日晚间），所以它不会自然走到跨夜分支；
     但 factsFor 的接管是**按数据**判的，不是按 key 判的。直接喂一个次日 at 证明
     star 与 galaxy 共用同一条判据，避免「只给 galaxy 写了分支」这种假实现。 */
  const starCross = C.factsFor('star', Object.assign({}, xctx, { item: { at: '2026-07-16T01:00' } }))
  check('star 分支同样按跨夜 at 接管（数据驱动，不依赖 at 恰好由 star 产生）',
    starCross.length === C.factsFor('star', xctx).length
    && starCross.every(f => f.at === '2026-07-16T01:00'), JSON.stringify(starCross))
  check('item.at 缺失/格式不对（半截日期、纯 HH:mm）⇒ 一律回落到旧输出',
    JSON.stringify(C.factsFor('galaxy', Object.assign({}, xctx, { item: { at: '2026-07-16' } })))
      === JSON.stringify(baseGal)
    && JSON.stringify(C.factsFor('galaxy', Object.assign({}, xctx, { item: { at: '01:00' } })))
      === JSON.stringify(baseGal))
  /* 调用方没给 ctx.night（旧调用形态）时不许凭 detail 自己推"跨夜"：没有页面给的夜段，
     就没有"次日"这个概念，锚点必须留在旧口径（失败关闭）。 */
  const noNight = Object.assign({}, xctx)
  delete noNight.night
  check('跨夜 item 但缺 ctx.night ⇒ 不猜日期，证据与旧输出逐字节相同',
    JSON.stringify(C.factsFor('galaxy', Object.assign({}, noNight, { item: galaxy })))
      === JSON.stringify(C.factsFor('galaxy', noNight)))
  /* 连所选日都没有时，任何完整日期都无法判断"是不是次日"——失败关闭到旧锚点，
     不能把 date='' 当成"一定跨夜"（那会让证据行凭空带上一个日期）。 */
  const noDate = Object.assign({}, xctx, { date: '' })
  check('ctx.date 缺失 ⇒ 不判跨夜（失败关闭到旧输出）',
    JSON.stringify(C.factsFor('galaxy', Object.assign({}, noDate, { item: galaxy })))
      === JSON.stringify(C.factsFor('galaxy', noDate)))

  /* ⑤ atmosphereAt 的时间参数必须是 anchorFull：本夹具刻意给两天不同的气溶胶，
     旧口径（date + 'T' + dusk 小时）会读到本日 22:00 的 0.9，新口径读次日 01:00 的 0.1。
     这条是**故意的读数修正**（设计要求的同一条），不与上面的「fact 逐字节相同」冲突——
     上面那条的上下文没有 atmosphere 数据。 */
  const atm = {
    air: { series: [{ at: '2026-07-15T22:00', aod: 0.9 }, { at: '2026-07-16T01:00', aod: 0.1 }] },
  }
  const atmFacts = C.factsFor('galaxy', Object.assign({}, xctx, { atmosphere: atm, item: galaxy }))
  const aod = atmFacts.filter(f => /CAMS 气溶胶/.test(f.fact))[0]
  check('跨夜证据读的是 anchorFull 那一格的气溶胶（次日 0.1，不是本日 0.9）',
    !!aod && /AOD 0\.1$/.test(aod.fact) && aod.at === galaxy.at, JSON.stringify(atmFacts))
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
