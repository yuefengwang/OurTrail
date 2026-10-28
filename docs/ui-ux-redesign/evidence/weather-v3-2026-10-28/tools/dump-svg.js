// 把设备上真实的 hourlySrc / cloud.src 解码落盘，供离线核对图元
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28'
;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await page.waitFor(1200)
    await page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    let wd = null
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
      wd = await page.$('weather-detail')
      const d = wd && await wd.data()
      if (d && !d.loading && !d.loadingWeather && !d.denied && !d.errorCode && d.dayStrip && d.dayStrip.length && d.hourlySrc) break
      await new Promise(r => setTimeout(r, 400))
    }
    const d = await wd.data()
    const dec = s => decodeURIComponent(String(s).replace(/^[^,]*,/, ''))
    fs.writeFileSync(OUT + '/probe2/device-hourly-24.svg', dec(d.hourlySrc))
    await wd.callMethod('onTab', { currentTarget: { dataset: { key: 'cloud' } } })
    await page.waitFor(1500)
    for (const p of [24, 48, 72]) {
      await wd.callMethod('onPeriod', { currentTarget: { dataset: { value: p } } })
      await page.waitFor(1800)
      const c = await wd.data()
      fs.writeFileSync(OUT + '/probe2/device-cloud-' + p + '.svg', dec(c.cloud.src))
    }
    console.log('dumped')
  } finally { await mp.disconnect() }
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1) })
