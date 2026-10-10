/* 真机核验：天相沉默闸（沿用彩虹轮 v4 的反缓存纪律）
 *
 * 三个用例，每个都回答一个可证伪的问题：
 *   A 满天云（用户截图那天气）→ 结论卡必须一张都不出，且沉默行点名全部五项
 *   B 五项同时有戏的对照日     → 五张卡一张都不能少，且**不得**出现沉默行
 *   C 同 B 但此点缺可信海拔   → 云海卡必须仍在并说明"缺少可信海拔"（unknown 不能被吃掉）
 *
 * bundle 新鲜度由文案自证：「这些天相今天条件不成立」只存在于本轮代码，
 * 旧 bundle 上这一行根本没有（A 屏会是五张卡）。所以 A 的判据一旦为真，
 * 就同时证明了编译进来的是新代码。
 *
 * 反缓存三件（v3 的教训：两个用例共用 updatedAt ⇒ B 的图其实是 A 的）：
 *   ① 每用例前 reLaunch 清实例属性  ② 每用例独立 updatedAt  ③ 读数相同即判 INVALID 并 exit 1
 * 运行：node verify-silence-device.js（需在装有 miniprogram-automator 的目录里）
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const SNAP = JSON.parse(fs.readFileSync('D:/OurTrail/docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', 'utf8'))
const P = SNAP.places['峨眉山'] || SNAP.places[Object.keys(SNAP.places)[0]]
const OUT = 'D:/OurTrail/docs/weather-ux/qa/v2-silence-gate-2026-10-10/device'
fs.mkdirSync(OUT, { recursive: true })
const DATE = '2026-10-09'
const hourOf = t => Number(String(t).slice(0, 2))

/* 剖面覆盖函数：给定气压层与该小时，返回云量 */
const CASES = [
  ['A-overcast', '2026-10-09T10:00:00+08:00',
    () => ({ cloud: { low: 100, mid: 100, high: 100 }, precip: 0, showers: 0, pop: 5, rh: 95 }),
    () => 100, true],
  ['B-packed', '2026-10-09T11:00:00+08:00',
    h => {
      const w = hourOf(h.t) >= 8 && hourOf(h.t) <= 9
      const dye = hourOf(h.t) >= 6 && hourOf(h.t) <= 7
      return {
        cloud: dye ? { low: 10, mid: 30, high: 20 } : w ? { low: 20, mid: 15, high: 10 } : { low: 20, mid: 10, high: 10 },
        precip: w ? 0.3 : 0, showers: w ? 0.1 : 0, pop: dye ? 20 : w ? 30 : 5, rh: w ? 92 : 60,
      }
    },
    // 只在清晨 6–9 点给一条 1000–1400 m 的厚云带（云海层），其余高度干净
    (lvl, t) => {
      const h = hourOf(t)
      const alt = (lvl.altitudes || [])[0]
      if (h < 6 || h > 9) return 0
      return alt >= 900 && alt <= 1500 ? 95 : 8
    }, true],
  ['C-no-altitude', '2026-10-09T12:00:00+08:00', null, null, false], // 数据同 B，只把海拔来源拿掉
]

function ser (mut) {
  return P.series.filter(h => h.d === DATE).map(h => {
    const m = mut(h)
    const o = Object.assign({}, h, m)
    if (m.cloud) o.cloud = Object.assign({}, h.cloud, m.cloud)
    return Object.assign({}, o, { d: DATE })
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
    let page = await mp.reLaunch('/pages/weather/weather')
    await page.waitFor(5000)
    const rows = ser(mut)
    await page.setData({ date: DATE, loading: false, denied: '', loadingWeather: false })
    const result = {
      status: 'ok', updatedAt,
      provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）' },
      days: daysOf(rows), series: rows,
      pointElevation: hasEle ? P.elevation : null,
      cloudLevels: levelsOf(cover),
    }
    const point = hasEle
      ? { ele: P.elevation, eleSource: 'gpx', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点' }
      : { ele: null, eleSource: '', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点（无高程）' }
    await page.callMethod('applyWeather', result, point, {})
    await page.waitFor(4000)
    page = await mp.currentPage()

    const cards = (await page.data('condCards')) || []
    const silent = await page.data('condSilent')
    const overall = await page.data('condOverall')
    const els = await page.$$('.cond-pheno')
    const sils = await page.$$('.cond-silent')
    const silText = sils.length ? String((await sils[0].text())).replace(/\s+/g, ' ') : ''
    seen[name] = {
      cards: cards.map(c => c.key + ':' + c.stars).join(' '),
      cardEls: els.length,
      silent: silent ? silent.titles : null,
      silentEls: sils.length, silentText: silText.slice(0, 120),
      overall: overall ? overall.score + ' ' + overall.label + ' ' + overall.stars : null,
      elevation: await page.data('chartElev'),
    }
    console.log('\n### ' + name + '\n   ' + JSON.stringify(seen[name], null, 1).replace(/\n\s*/g, ' '))

    // 判据（数据层 + 像素层各一份，两条都要过）
    const want = {
      'A-overcast': { cardEls: 0, silentEls: 1 },
      'B-packed': { cardEls: 5, silentEls: 0 },
      'C-no-altitude': { silentEls: 0 },
    }[name]
    const fails = []
    if (els.length !== want.cardEls) fails.push('结论卡张数 ' + els.length + ' ≠ ' + want.cardEls)
    if (sils.length !== want.silentEls) fails.push('沉默行张数 ' + sils.length + ' ≠ ' + want.silentEls)
    if (name === 'A-overcast' && !/条件不成立/.test(silText)) fails.push('沉默行文案未点名（像素层）')
    if (name === 'A-overcast' && ['晨昏光染', '云海', '星空', '银河', '彩虹'].some(t => silText.indexOf(t) < 0)) fails.push('沉默行少点名')
    if (name === 'C-no-altitude' && cards.map(c => c.key).indexOf('cloudSea') < 0) fails.push('unknown 的云海卡被吃掉')
    if (name === 'C-no-altitude' && !/可信海拔/.test((cards.find(c => c.key === 'cloudSea') || {}).text || '')) fails.push('云海卡未说明缺什么')
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
