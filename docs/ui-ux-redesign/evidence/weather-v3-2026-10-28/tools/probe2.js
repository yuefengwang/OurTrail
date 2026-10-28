// 考古：用户报障时的原始写法（font-family / hsl() / role+aria-label）在真机上是否致命
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28/probe2'
fs.mkdirSync(OUT, { recursive: true })
const say = s => console.log(s)
const enc = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())
function hslToHex(l) { // hsl(110 7% l%) → hex
  const s = 0.07, li = l / 100, a = s * Math.min(li, 1 - li), hh = 110 / 30
  const f = i => { const k = (i + hh) % 12; const v = li - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); const x = Math.round(255 * v).toString(16); return x.length < 2 ? '0' + x : x }
  return '#' + f(0) + f(8) + f(4)
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
    const d = await wd.data()
    const cur = decodeURIComponent(String(d.hourlySrc).replace(/^[^,]*,/, ''))
    fs.writeFileSync(OUT + '/current.svg', cur)
    say('· 当前（已修）SVG ' + cur.length + 'B，<g> 数=' + (cur.match(/<g /g) || []).length)

    const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',Arial,sans-serif"
    const v = [
      ['p0-current', cur],
      ['p1-font', cur.replace(/<g /g, '<g font-family="' + FONT + '" ').replace(/<text /g, '<text font-family="' + FONT + '" ')],
      ['p2-hsl', cur.replace(/stop-color="#[0-9a-f]{6}"/g, (m, off) => 'stop-color="hsl(110 7% ' + (47 + (m.length % 7) * 8) + '%)"')],
      ['p3-role', cur.replace('<svg xmlns', '<svg role="img" aria-label="逐时预报" xmlns')],
      ['p4-all', cur.replace(/<g /g, '<g font-family="' + FONT + '" ')
        .replace(/<text /g, '<text font-family="' + FONT + '" ')
        .replace(/stop-color="#[0-9a-f]{6}"/g, 'stop-color="hsl(110 7% 66%)"')
        .replace('<svg xmlns', '<svg role="img" aria-label="逐时预报" xmlns')],
    ]
    await mp.pageScrollTo(700)
    await page.waitFor(500)
    for (const [name, svg] of v) {
      await wd.setData({ hourlySrc: enc(svg), hourlyWidth: d.hourlyWidth, hourlyHeight: d.hourlyHeight })
      await page.waitFor(900)
      const buf = Buffer.from(String(await mp.screenshot()), 'base64')
      fs.writeFileSync(OUT + '/' + name + '.png', buf)
      say('· ' + name + ' svg=' + svg.length + 'B shot=' + buf.length + 'B')
    }
  } finally { await mp.disconnect() }
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1) })
