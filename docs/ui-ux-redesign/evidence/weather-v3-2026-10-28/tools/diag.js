// 诊断：逐时图为什么不出墨。只读 data + 运行时注入最小 SVG 矩阵截图。
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28/probe'
fs.mkdirSync(OUT, { recursive: true })
const log = []
function say(s) { log.push(s); console.log(s) }

async function shot(mp, name) {
  const raw = await mp.screenshot()
  const buf = Buffer.from(String(raw), 'base64')
  fs.writeFileSync(OUT + '/' + name, buf)
  say('· shot ' + name + ' (' + buf.length + ' B)')
}
const uri = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await page.waitFor(1200)
    page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    await page.waitFor(4000)
    const wd = await page.$('weather-detail')
    if (!wd) throw new Error('no component')

    // 等数据
    for (let i = 0; i < 40; i++) {
      const d = await wd.data()
      if (!d.loading && !d.loadingWeather && !d.errorCode && d.dayCards && d.dayCards.length) break
      await page.waitFor(1000)
    }
    const d = await wd.data()
    say('· data keys: ' + Object.keys(d).join(','))
    const src = String(d.hourlySrc || '')
    say('· hourlySrc: 空=' + (src === '') + ' 长度=' + src.length)
    say('· hourlyWidth=' + d.hourlyWidth + ' hourlyHeight=' + d.hourlyHeight + ' 时段=' + d.period + ' tab=' + d.tab)
    say('· 载荷字段: chart=' + (d.chart ? Object.keys(d.chart).join('|') : 'null') + ' cloud=' + (d.cloud ? Object.keys(d.cloud).join('|') : 'null'))
    if (src) {
      const svg = decodeURIComponent(src.replace(/^[^,]*,/, ''))
      fs.writeFileSync(OUT + '/produced.svg', svg)
      say('· 生产 SVG 落盘 produced.svg (' + svg.length + ' B)，前 300 字：\n' + svg.slice(0, 300))
    }

    // 注入矩阵：从最小到生产形状
    const cases = [
      ['01-rect', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect width="300" height="120" fill="#2f6b4f"/></svg>'],
      ['02-text', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect width="300" height="120" fill="#ffffff"/><text x="20" y="60" font-size="14" fill="#333">06:00</text></svg>'],
      ['03-image-attr', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120" preserveAspectRatio="xMidYMid meet"><rect width="300" height="120" fill="#ffffff"/><circle cx="60" cy="60" r="30" fill="#c00"/></svg>'],
      ['04-grad', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f8"/><stop offset="1" stop-color="#264"/></linearGradient></defs><rect width="300" height="120" fill="url(#g1)"/></svg>'],
      ['05-path', '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><rect width="300" height="120" fill="#fff"/><path d="M10 100 L60 20 L110 80 L160 30" fill="none" stroke="#123456" stroke-width="2"/></svg>'],
    ]
    for (const [name, svg] of cases) {
      await wd.setData({ hourlySrc: uri(svg), hourlyWidth: 300, hourlyHeight: 120 })
      await page.waitFor(700)
      await mp.pageScrollTo(700)
      await page.waitFor(400)
      await shot(mp, name + '.png')
      say('  ↳ ' + name + ' URI 长度=' + uri(svg).length)
    }
    // 生产载荷原样注入（对照：如果这个空白，而上面的都出墨，就是内容问题）
    if (src) {
      await wd.setData({ hourlySrc: src, hourlyWidth: d.hourlyWidth, hourlyHeight: d.hourlyHeight })
      await page.waitFor(900)
      await shot(mp, '06-produced.png')
    }
    fs.writeFileSync(OUT + '/log.txt', log.join('\n'))
  } finally {
    await mp.disconnect()
  }
})().catch(e => { console.error('ERR ' + (e && e.stack || e)); process.exit(1) })
