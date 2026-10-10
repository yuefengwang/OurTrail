/* 真机核验 v3：补齐 v2 漏掉的 `cloudLevels`
 * v2 的缺陷（用户指出）：注入载荷没有 cloudLevels ⇒ WCFF.buildCloudFieldRange 返回 null
 *   ⇒ unified=null ⇒ 页面回退经典 canvas meteogram，OI 卡也不出——
 *   截图看着像"旧版本页面"。结论卡的判据本身不受影响，但作为**页面级证据**不合格。
 * v3 把 cloudLevels 一起合成（times 与各层 altitudes 用真实快照的，cloudCover 按用例改写），
 * 并显式断言 unified / oiCard 都非 null，证明这次跑的是完整 V2 页面。
 * 运行：node verify-rainbow-device3.js
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const SNAP = JSON.parse(fs.readFileSync('D:/OurTrail/docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', 'utf8'))
const P = SNAP.places[Object.keys(SNAP.places)[0]]
const OUT = 'D:/OurTrail/docs/weather-ux/qa/v2-rainbow-gate-2026-10-10/device'
fs.mkdirSync(OUT, { recursive: true })

const hourOf = t => Number(String(t).slice(11, 13))
const dayOfT = t => String(t).slice(0, 10)

/* 用例：A 满天云无雨；B 云开有雨（07–09 点低云散开 + 降水） */
const CASES = [
  ['A-overcast', h => ({ cloud: { low: 100, mid: 100, high: 100 }, precip: 0, showers: 0, pop: 5, rh: 95, band: null }),
    /* 云场：所有气压层都 100% ⇒ 剖面整列实心，与 series 的满云一致 */
    () => 100],
  ['B-clearing-wet', h => {
    const w = Number(h.t.slice(0, 2)) >= 7 && Number(h.t.slice(0, 2)) <= 9
    return {
      cloud: w ? { low: 25, mid: 15, high: 10 } : { low: 5, mid: 5, high: 5 },
      precip: w ? 0.4 : 0, showers: w ? 0.2 : 0, pop: w ? 60 : 5, rh: w ? 92 : 55, band: null,
    }
  },
    /* 云场：10–12 点给一条 85% 的中层（阵雨云），其余 0 ⇒ 剖面看得见雨云但没有实心云层带 */
    (lvl, t) => (hourOf(t) >= 10 && hourOf(t) <= 12 && lvl.pressure === 700 ? 85 : 0)],
]

function ser (mut) {
  return P.series.map(h => {
    const m = mut(h)
    const o = Object.assign({}, h, m)
    if (m.cloud) o.cloud = Object.assign({}, h.cloud, m.cloud)
    return o
  })
}
function daysOf (rows) {
  const byDate = {}
  rows.forEach(h => { (byDate[h.d] = byDate[h.d] || []).push(h) })
  return Object.keys(byDate).map(date => {
    const hs = byDate[date]
    const mean = f => Math.round(hs.reduce((s, h) => s + (f(h) || 0), 0) / hs.length)
    return {
      date, code: hs.reduce((a, b) => (b.code > a ? b.code : a), 0),
      tMax: Math.max.apply(null, hs.map(h => h.temp)), tMin: Math.min.apply(null, hs.map(h => h.temp)),
      windMax: Math.max.apply(null, hs.map(h => h.wind)),
      precipSum: Math.round(hs.reduce((s, h) => s + h.precip + h.showers, 0) * 10) / 10,
      precipProbMax: Math.max.apply(null, hs.map(h => h.pop)),
      precipHours: hs.filter(h => h.precip + h.showers > 0).length,
      sunrise: '06:42', sunset: '18:12',
      uvMax: Math.max.apply(null, hs.map(h => h.uv || 0)),
      cloud: { low: mean(h => h.cloud.low), mid: mean(h => h.cloud.mid), high: mean(h => h.cloud.high) },
    }
  }).sort((a, b) => a.date.localeCompare(b.date))
}
/* cloudLevels：times 与各层 altitudes 用真实快照，只改 cloudCover */
function levelsOf (coverFn) {
  return {
    times: P.cloudLevels.times.slice(),
    unit: P.cloudLevels.unit || 'm',
    levels: P.cloudLevels.levels.map(l => ({
      pressure: l.pressure,
      altitudes: l.altitudes.slice(),
      cloudCover: P.cloudLevels.times.map((t, i) => coverFn(l, t, i)),
    })),
  }
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  let page = await mp.reLaunch('/pages/weather/weather')
  await page.waitFor(5000)

  for (const c of CASES) {
    const name = c[0]
    const rows = ser(c[1])
    await page.setData({ date: '2026-10-09', loading: false, denied: '', loadingWeather: false })
    const result = {
      status: 'ok', updatedAt: '2026-10-10T10:00:00+08:00',
      provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）' },
      days: daysOf(rows), series: rows, pointElevation: P.elevation,
      cloudLevels: levelsOf(c[2]),
    }
    const point = { ele: P.elevation, eleSource: 'gpx', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点' }
    await page.callMethod('applyWeather', result, point, {})
    await page.waitFor(3000)
    page = await mp.currentPage()
    /* 完整 V2 页面的门槛断言：这三样缺一个就说明页面在降级分支上，截图不算页面级证据 */
    const gates = {
      dayCards: ((await page.data('dayCards')) || []).length,
      unified: !!(await page.data('unified')),
      oiCard: !!(await page.data('oiCard')),
      chartSeries: ((await page.data('chartSeries')) || []).length,
    }
    const els = await page.$$('.cond-pheno')
    console.log('\n### ' + name + ' 门槛:', JSON.stringify(gates), '| .cond-pheno 张数=' + els.length)
    if (!gates.unified || !gates.oiCard || !gates.dayCards) {
      console.log('   !! 页面仍在降级分支，本用例的截图不作页面级证据')
    }
    const rendered = []
    for (const el of els) rendered.push((await el.text()).replace(/\s+/g, ' ').slice(0, 130))
    rendered.forEach((t, i) => console.log('   [' + i + '] ' + t))
    /* 整页从上到下逐屏截图（含统一气象图 / 云场剖面 / OI 卡 / 结论卡） */
    for (let i = 0; i < 8; i++) {
      await mp.pageScrollTo(i * 700)
      await page.waitFor(700)
      fs.writeFileSync(path.join(OUT, name + '-full-' + i + '.png'),
        Buffer.from(String(await mp.screenshot()), 'base64'))
    }
    await mp.pageScrollTo(0)
  }
  await mp.disconnect()
  console.log('\n→ v3 截图写入 ' + OUT)
})().catch(e => { console.error('驱动失败：', e && e.message); process.exit(1) })
