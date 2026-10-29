const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28'
async function shot(mp, name) {
  const buf = Buffer.from(String(await mp.screenshot()), 'base64')
  fs.writeFileSync(OUT + '/' + name, buf)
  console.log('· shot ' + name + ' ' + buf.length + 'B')
}
;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await page.waitFor(1200)
    page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    await page.waitFor(6000)
    const wd = await page.$('weather-detail')
    for (let i = 0; i < 30; i++) { const d = await wd.data(); if (!d.loading && d.dayStrip && d.dayStrip.length) break; await page.waitFor(1000) }
    await wd.callMethod('onTab', { currentTarget: { dataset: { key: 'sky' } } })
    await page.waitFor(1500)
    const d = await wd.data()
    console.log('· arcSrc 长度=' + String((d.sky && d.sky.arcSrc) || '').length + ' rise=' + (d.sky && d.sky.rise) + ' set=' + (d.sky && d.sky.set) + ' label=' + (d.sky && d.sky.daylight))
    await mp.pageScrollTo(330)
    await page.waitFor(500)
    await shot(mp, 'sky-arc.png')
  } finally { await mp.disconnect() }
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1) })
