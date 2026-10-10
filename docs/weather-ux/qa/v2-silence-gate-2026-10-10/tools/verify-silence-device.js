/* 真机核验：天相沉默闸（沿用彩虹轮 v4 的反缓存纪律）
 *
 * 三个用例，每个都回答一个可证伪的问题：
 *   A 满天云（用户截图那天气）→ 结论卡必须一张都不出，且沉默行点名全部五项
 *   B 五项同时有戏的对照日     → 五张卡一张都不能少，且**不得**出现沉默行
 *   C 同 B 但此点缺可信海拔   → 云海卡必须仍在并说明"缺少可信海拔"（unknown 不能被吃掉）
 *
 * bundle 新鲜度由文案自证：「条件不成立，就不单独列出」这一行只存在于本轮代码，
 * 旧 bundle 上根本没有（A 屏会是五张卡）。所以 A 的判据一旦为真，
 * 就同时证明了编译进来的是新代码。
 *
 * 反缓存三件（v3 的教训：两个用例共用 updatedAt ⇒ B 的图其实是 A 的）：
 *   ① 每用例前 reLaunch 清实例属性  ② 每用例独立 updatedAt  ③ 读数相同即判 INVALID 并 exit 1
 *
 * 第一版跑出的三条 FAIL 全是夹具/驱动自己的错，如实留在文件里（见下"夹具教训"）：
 *   · 站点键取错：快照的 places 键是拼音（emeishan），写成中文 '峨眉山' 拿到 undefined
 *     ⇒ 回落到第一个站点成都（489 m），于是"此点不在 1,000 m 云带之上"被**正确地**判成 excluded
 *     ——页面没错，是我的阳性对照夹具不成立。
 *   · 覆盖函数取了 lvl.altitudes[0]（整层一个数），应逐时取 altitudes[i]。
 *   · hourOf 用 slice(0,2) 读 '2026-10-09T07:00' 得到 "20"，应为 slice(11,13)。
 * 运行：node verify-silence-device.js（需在装有 miniprogram-automator 的目录里）
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const SNAP = JSON.parse(fs.readFileSync('D:/OurTrail/docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', 'utf8'))
const P = SNAP.places.emeishan
const OUT = 'D:/OurTrail/docs/weather-ux/qa/v2-silence-gate-2026-10-10/device'
fs.mkdirSync(OUT, { recursive: true })
const DATE = '2026-10-09'
const ELE = P.elevation // 3004 m：截图那一屏的点
const hourOf = t => Number(String(t).slice(11, 13))

/* 剖面覆盖：只在清晨 6–9 时给一条 1,000–1,500 m 的厚云带（云海层），其余高度干净 */
function seaCover (lvl, t, i) {
  const h = hourOf(t)
  const alt = (lvl.altitudes || [])[i]
  if (h < 6 || h > 9) return 0
  return alt >= 950 && alt <= 1550 ? 95 : 6
}
function flatCover () { return 100 }

const CASES = [
  ['A-overcast', '2026-10-09T10:00:00+08:00',
    () => ({ cloud: { low: 100, mid: 100, high: 100 }, precip: 0, showers: 0, pop: 5, rh: 95 }),
    flatCover, true, { cardEls: 0, silentEls: 1 }],
  ['B-packed', '2026-10-09T11:00:00+08:00',
    h => {
      const hh = Number(h.t.slice(0, 2))
      const dye = hh >= 6 && hh <= 7   // 晨昏窗口：低云少 + 中高云可染色
      const wet = hh >= 8 && hh <= 9   // 阵雨 + 云开：彩虹
      return {
        cloud: dye ? { low: 10, mid: 30, high: 20 } : wet ? { low: 20, mid: 15, high: 10 } : { low: 20, mid: 10, high: 10 },
        precip: wet ? 0.3 : 0, showers: wet ? 0.1 : 0, pop: dye ? 20 : wet ? 30 : 5, rh: wet ? 92 : 60,
      }
    },
    seaCover, true, { cardEls: 5, silentEls: 0 }],
  ['C-no-altitude', '2026-10-09T12:00:00+08:00', null, null, false, { silentEls: 0, mustHave: 'cloudSea' }],
]

function ser (mut) {
  return P.series.filter(h => h.d === DATE).map(h => {
    const m = mut(h)
    const o = Object.assign({}, h, m)
    if (m.cloud) o.cloud = Object.assign({}, h.cloud, m.cloud)
    return o
  })
}
function daysOf (rows) {
  const hs = rows
  const mean = f => Math.round(hs.reduce((s, h) => s + (f(h) || 0), 0) / hs.length)
  return [{
    date: DATE, code: hs.reduce((a, b) => (b.code > a ? b.code : a), 0),
    tMax: Math.max.apply(null, hs.map(h => h.temp)), tMin: Math.min.apply(null, hs.map(h => h.temp)),
    windMax: Math.max.apply(null, hs.map(h => h.wind)),
    precipSum: Math.round(hs.reduce((s, h) => s + h.precip + h.showers, 0) * 10) / 10,
    precipProbMax: Math.max.apply(null, hs.map(h => h.pop)),
    precipHours: hs.filter(h => h.precip + h.showers > 0).length,
    sunrise: '06:52', sunset: '18:20',
    uvMax: Math.max.apply(null, hs.map(h => h.uv || 0)),
    cloud: { low: mean(h => h.cloud.low), mid: mean(h => h.cloud.mid), high: mean(h => h.cloud.high) },
  }]
}
function levelsOf (coverFn) {
  return {
    times: P.cloudLevels.times.slice(),
    unit: P.cloudLevels.unit || 'm',
    levels: P.cloudLevels.levels.map(l => ({
      pressure: l.pressure, altitudes: l.altitudes.slice(),
      cloudCover: P.cloudLevels.times.map((t, i) => coverFn(l, t, i)),
    })),
  }
}

const seen = {}
;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  for (let ci = 0; ci < CASES.length; ci++) {
    const name = CASES[ci][0]
    const updatedAt = CASES[ci][1]
    const mut = CASES[ci][2] || CASES[1][2]
    const cover = CASES[ci][3] || CASES[1][3]
    const hasEle = CASES[ci][4]
    const want = CASES[ci][5]
    let page = await mp.reLaunch('/pages/weather/weather')
    await page.waitFor(5000)
    const rows = ser(mut)
    await page.setData({ date: DATE, loading: false, denied: '', loadingWeather: false })
    const result = {
      status: 'ok', updatedAt,
      provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）' },
      days: daysOf(rows), series: rows,
      pointElevation: hasEle ? ELE : null,
      cloudLevels: levelsOf(cover),
    }
    const point = hasEle
      ? { ele: ELE, eleSource: 'gpx', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点' }
      : { ele: null, eleSource: '', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点（无高程）' }
    await page.callMethod('applyWeather', result, point, {})
    await page.waitFor(4000)
    page = await mp.currentPage()

    // 渲染门槛链（铁律 32⑥）：先证明页面真的进了图表态，否则元素根本不在 DOM 里
    const gates = {
      dayCards: ((await page.data('dayCards')) || []).length,
      unified: !!(await page.data('unified')),
      chartSeries: ((await page.data('chartSeries')) || []).length,
      loadingWeather: await page.data('loadingWeather'),
    }
    const cards = (await page.data('condCards')) || []
    const silent = await page.data('condSilent')
    const overall = await page.data('condOverall')
    const els = await page.$$('.cond-pheno')
    const sils = await page.$$('.cond-silent')
    const silText = sils.length ? String(await sils[0].text()).replace(/\s+/g, ' ') : ''
    const cardTexts = []
    for (const el of els) cardTexts.push(String(await el.text()).replace(/\s+/g, ' ').slice(0, 150))
    seen[name] = {
      gates,
      cards: cards.map(c => c.key + ' ' + c.stars).join(' | '),
      cardEls: els.length,
      silentTitles: silent ? silent.titles : null,
      silentEls: sils.length, silentText: silText,
      overall: overall ? overall.score + ' ' + overall.label + ' ' + overall.stars : null,
      elevation: await page.data('chartElev'),
      cardTexts,
    }
    console.log('\n### ' + name + ' | 门槛 ' + JSON.stringify(gates) + ' | 卡 ' + els.length + ' 张 | 沉默行 ' + sils.length + ' 行')
    console.log('   cards(data)  = ' + JSON.stringify(seen[name].cards))
    console.log('   silent(titles)= ' + JSON.stringify(seen[name].silentTitles) + ' overall=' + JSON.stringify(seen[name].overall) + ' elev=' + seen[name].elevation)
    console.log('   silent(text)  = ' + JSON.stringify(silText))

    const fails = []
    if (want.cardEls !== undefined && els.length !== want.cardEls) fails.push('结论卡 ' + els.length + ' ≠ ' + want.cardEls)
    if (want.silentEls !== undefined && sils.length !== want.silentEls) fails.push('沉默行 ' + sils.length + ' ≠ ' + want.silentEls)
    if (want.mustHave && cards.map(c => c.key).indexOf(want.mustHave) < 0) fails.push('缺必须出现的卡 ' + want.mustHave)
    if (name === 'A-overcast') {
      if (!/条件不成立/.test(silText)) fails.push('沉默行文案未点名（像素层）')
      if (['晨昏光染', '云海', '星空', '银河', '彩虹'].some(t => silText.indexOf(t) < 0)) fails.push('沉默行少点名')
    }
    if (name === 'B-packed' && /找银心带|往哪看/.test(cardTexts.join(' ')) === false) fails.push('对照日的"往哪看"应当还在')
    if (name === 'C-no-altitude') {
      const sea = cards.filter(c => c.key === 'cloudSea')[0] || {}
      if (!/可信海拔/.test(sea.text || '')) fails.push('云海卡未说明缺什么')
    }
    seen[name].判定 = fails.length ? 'FAIL: ' + fails.join('；') : 'PASS'
    console.log('   判定 → ' + seen[name].判定)

    for (let i = 0; i < 6; i++) {
      await mp.pageScrollTo(i * 700)
      await page.waitFor(700)
      fs.writeFileSync(path.join(OUT, name + '-' + i + '.png'),
        Buffer.from(String(await mp.screenshot()), 'base64'))
    }
    await mp.pageScrollTo(0)
  }
  fs.writeFileSync(path.join(OUT, 'readings.json'), JSON.stringify(seen, null, 2))

  const keys = Object.keys(seen)
  let dup = false
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (seen[keys[i]].cards === seen[keys[j]].cards && seen[keys[i]].silentText === seen[keys[j]].silentText
        && seen[keys[i]].overall === seen[keys[j]].overall) dup = true
    }
  }
  console.log('\n污染自证：三个用例的卡集合/沉默行/总评读数' + (dup ? '**有完全相同者 → 判定无效**' : '互不相同 ✓'))
  const bad = keys.filter(k => seen[k].判定.indexOf('PASS') !== 0)
  await mp.disconnect()
  console.log(bad.length ? '不通过用例：' + bad.join(',') : '三个用例全部通过')
  process.exit(dup || bad.length ? 1 : 0)
})().catch(e => { console.error('驱动失败：', e && e.message); process.exit(1) })
