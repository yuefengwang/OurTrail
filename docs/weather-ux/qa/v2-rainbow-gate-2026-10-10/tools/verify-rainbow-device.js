/* 真机核验 v4：修掉 v3 的缓存污染
 * v3 的缺陷（比对两张截图一模一样才发现）：`buildUnifiedCard` / `buildOiCard` 的缓存键是
 *   `updatedAt|date|elevation|lat2dp|width`（weather.js:824），两个用例用了同一个 updatedAt
 *   ⇒ 第二个用例直接复用第一个用例的云场图与 OI 卡，B 的图其实是 A 的。
 * v4：① 每个用例前 reLaunch 页面（清掉 this._unified / this._oiCache 这类实例属性）
 *     ② 每用例给不同 updatedAt
 *     ③ 加一条**自证**：两个用例的 unified.r1/r3 与 OI 首条摘要必须不同，
 *        相同就判定为缓存污染、当场作废，不把旧图当证据。
 * 运行：node verify-rainbow-device4.js
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const SNAP = JSON.parse(fs.readFileSync('D:/OurTrail/docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', 'utf8'))
const P = SNAP.places[Object.keys(SNAP.places)[0]]
const OUT = 'D:/OurTrail/docs/weather-ux/qa/v2-rainbow-gate-2026-10-10/device'
fs.mkdirSync(OUT, { recursive: true })
const hourOf = t => Number(String(t).slice(11, 13))

const CASES = [
  ['A-overcast', '2026-10-10T10:00:00+08:00',
    () => ({ cloud: { low: 100, mid: 100, high: 100 }, precip: 0, showers: 0, pop: 5, rh: 95, band: null }),
    () => 100],
  ['B-clearing-wet', '2026-10-10T11:00:00+08:00',
    h => {
      const w = Number(h.t.slice(0, 2)) >= 7 && Number(h.t.slice(0, 2)) <= 9
      return {
        cloud: w ? { low: 25, mid: 15, high: 10 } : { low: 5, mid: 5, high: 5 },
        precip: w ? 0.4 : 0, showers: w ? 0.2 : 0, pop: w ? 60 : 5, rh: w ? 92 : 55, band: null,
      }
    },
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
  for (const c of CASES) {
    const name = c[0]
    /* 每个用例都重新进页面：实例属性（_unified / _oiCache）随页面销毁一起清掉 */
    let page = await mp.reLaunch('/pages/weather/weather')
    await page.waitFor(5000)
    const rows = ser(c[2])
    await page.setData({ date: '2026-10-09', loading: false, denied: '', loadingWeather: false })
    const result = {
      status: 'ok', updatedAt: c[1],
      provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）' },
      days: daysOf(rows), series: rows, pointElevation: P.elevation, cloudLevels: levelsOf(c[3]),
    }
    const point = { ele: P.elevation, eleSource: 'gpx', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点' }
    await page.callMethod('applyWeather', result, point, {})
    await page.waitFor(3000)
    page = await mp.currentPage()
    const uni = await page.data('unified')
    const oi = await page.data('oiCard')
    const gates = {
      dayCards: ((await page.data('dayCards')) || []).length,
      unified: !!uni, oiCard: !!oi, chartSeries: ((await page.data('chartSeries')) || []).length,
    }
    seen[name] = {
      r1: uni && uni.r1, r3: uni && uni.r3, legendIn: uni && uni.legendIn,
      oiFirst: oi && oi.items && oi.items[0] && [oi.items[0].title, oi.items[0].summaryText].join(' / '),
      oiCount: oi && oi.items ? oi.items.length : 0,
    }
    const els = await page.$$('.cond-pheno')
    console.log('\n### ' + name + ' 门槛 ' + JSON.stringify(gates) + ' | 结论卡 ' + els.length + ' 张')
    console.log('   unified.r1 =', seen[name].r1)
    console.log('   unified.r3 =', seen[name].r3)
    console.log('   OI 首条     =', seen[name].oiFirst, '| 条数', seen[name].oiCount)
    for (const el of els) {
      const t = (await el.text()).replace(/\s+/g, ' ')
      if (/彩虹|星空|银河/.test(t)) console.log('   卡:', t.slice(0, 108))
    }
    for (let i = 0; i < 8; i++) {
      await mp.pageScrollTo(i * 700)
      await page.waitFor(700)
      fs.writeFileSync(path.join(OUT, name + '-v4-' + i + '.png'),
        Buffer.from(String(await mp.screenshot()), 'base64'))
    }
  }
  const keys = Object.keys(seen)
  const same = keys.length === 2 && JSON.stringify(seen[keys[0]]) === JSON.stringify(seen[keys[1]])
  console.log('\n缓存污染自证：两个用例的图/OI 读数' + (same ? '**完全相同 → 判定无效**' : '不同 ✓（不是同一份缓存）'))
  await mp.pageScrollTo(0)
  await mp.disconnect()
  process.exit(same ? 1 : 0)
})().catch(e => { console.error('驱动失败：', e && e.message); process.exit(1) })
