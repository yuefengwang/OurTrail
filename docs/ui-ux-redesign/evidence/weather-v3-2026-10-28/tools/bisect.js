// 二分：生产 SVG 的哪一类构造让真机解码后不出墨
const automator = require('miniprogram-automator')
const fs = require('fs')
const IN = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28/probe'
const OUT = IN + '/bisect'
fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync(IN + '/produced.svg', 'utf8')
const say = s => console.log(s)
const uri = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

const variants = [
  ['a-as-is', src],
  ['b-no-gradient', src.replace(/url\(#wband-[a-z]+-\d+-\d+\)/g, '#dfe8df')],
  ['c-no-text', src.replace(/<text[\s\S]*?<\/text>/g, '')],
  ['d-no-g', src.replace(/<g /g, '<g ').replace(/<\/?g[^>]*>/g, '')],
  ['e-opacity-dot', src.replace(/opacity="\.(\d+)"/g, 'opacity="0.$1"')],
  ['f-no-defs', src.replace(/<defs>[\s\S]*?<\/defs>/g, '')],
]

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await page.waitFor(1200)
    page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    await page.waitFor(5000)
    const wd = await page.$('weather-detail')
    for (let i = 0; i < 30; i++) {
      const d = await wd.data()
      if (!d.loading && d.dayCards && d.dayCards.length) break
      await page.waitFor(1000)
    }
    await mp.pageScrollTo(700)
    await page.waitFor(500)

    for (const [name, svg] of variants) {
      await wd.setData({ hourlySrc: uri(svg), hourlyWidth: 1008, hourlyHeight: 310 })
      await page.waitFor(900)
      const raw = await mp.screenshot()
      fs.writeFileSync(OUT + '/' + name + '.png', Buffer.from(String(raw), 'base64'))
      say('· ' + name + ' svg=' + svg.length + 'B uri=' + uri(svg).length)
    }
    say('对比口径：图身出现绿/灰墨迹=解码成功；纯白=失败')
  } finally {
    await mp.disconnect()
  }
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1) })
