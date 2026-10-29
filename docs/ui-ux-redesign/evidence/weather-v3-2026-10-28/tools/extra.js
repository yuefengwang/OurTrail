// 补充核验：日月天相 tab（日照弧 xmlns 修复）+ 逐时 72h
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28'
const say = s => console.log(s)
async function shot(mp, name) {
  const raw = await mp.screenshot()
  const buf = Buffer.from(String(raw), 'base64')
  fs.writeFileSync(OUT + '/' + name, buf)
  say('· shot ' + name + ' (' + buf.length + ' B)')
}
;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await page.waitFor(1200)
    page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    await page.waitFor(6000)
    const wd = await page.$('weather-detail')
    for (let i = 0; i < 30; i++) {
      const d = await wd.data()
      if (!d.loading && d.dayStrip && d.dayStrip.length) break
      await page.waitFor(1000)
    }

    // 日月天相
    await wd.callMethod('onTab', { currentTarget: { dataset: { key: 'sky' } } })
    await page.waitFor(1500)
    const d1 = await wd.data()
    const skyKeys = d1.sky ? Object.keys(d1.sky).join('|') : 'null'
    say('· sky 字段: ' + skyKeys + '  sunArc长度=' + String((d1.sky && (d1.sky.arc || d1.sky.sunArc)) || '').length)
    await mp.pageScrollTo(560)
    await page.waitFor(500)
    await shot(mp, 'sky-24.png')

    // 逐时 72
    await mp.pageScrollTo(0)
    await wd.callMethod('onTab', { currentTarget: { dataset: { key: 'hourly' } } })
    await page.waitFor(800)
    await wd.callMethod('onPeriod', { currentTarget: { dataset: { value: 72 } } })
    await page.waitFor(2500)
    const d2 = await wd.data()
    say('· 72h hourlyColumns=' + d2.hourlyColumns + ' width=' + d2.hourlyWidth + ' src=' + String(d2.hourlySrc || '').length)
    await mp.pageScrollTo(700)
    await page.waitFor(500)
    await shot(mp, 'hourly-72.png')
  } finally {
    await mp.disconnect()
  }
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1) })
