// 收口截图：让整张逐时图完整落在视口里（上一版 pageScrollTo(700) 把温度段滚没了）
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28'
const log = []
function say(s) { log.push(s); console.log(s) }
async function shot(mp, name) {
  const raw = await mp.screenshot()
  const buf = Buffer.from(String(raw), 'base64')
  fs.writeFileSync(OUT + '/' + name, buf)
  say('· shot ' + name + ' (' + buf.length + ' B)')
}
async function waitFor(fn, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 400)) }
  return null
}
;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await page.waitFor(1200)
    await page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    const wd0 = await waitFor(async () => {
      const c = await page.$('weather-detail'); if (!c) return null
      const d = await c.data(); if (!d || d.loading || d.loadingWeather) return null
      if (d.denied || d.errorCode) return null
      return (d.dayStrip && d.dayStrip.length && d.hourlySrc) ? c : null
    }, 60000)
    if (!wd0) throw new Error('gate failed')
    say('· 门槛链通过')

    await wd0.callMethod('onTab', { currentTarget: { dataset: { key: 'hourly' } } })
    await page.waitFor(1200)

    for (const period of [24, 72]) {
      if (period !== 24) {
        await wd0.callMethod('onPeriod', { currentTarget: { dataset: { value: period } } })
        await page.waitFor(2200)
      }
      const img = await wd0.$('.wv3-chart-img')
      if (!img) { say('✗ 逐时图不在 DOM'); continue }
      const off = await img.offset().catch(() => null)
      const sz = await img.size().catch(() => null)
      say('· ' + period + 'h offset=' + JSON.stringify(off) + ' size=' + JSON.stringify(sz))
      const top = off ? off.top : 0
      const h = sz ? sz.height : 310
      // 视口高 844 → 让图顶落在 y≈56（标题栏之下），整张图进来
      const target = Math.max(0, Math.round(top - 56))
      await mp.pageScrollTo(target)
      await page.waitFor(700)
      await shot(mp, 'hourly-full-' + period + '.png')
      const d = await wd0.data()
      say('· ' + period + 'h 列数=' + d.hourlyColumns + ' 宽=' + d.hourlyWidth + ' 高=' + h)
      await mp.pageScrollTo(0)
      await page.waitFor(400)
    }
    fs.writeFileSync(OUT + '/final-shot-log.json', JSON.stringify(log, null, 2))
  } finally { await mp.disconnect() }
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1) })
