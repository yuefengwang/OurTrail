// 跑法：复制到仓库外的 mp-auto 目录（本仓库零 npm 依赖）后 node shot-wet.js；需先 close+open 重编译并 auto --auto-port 9431
// 只补 B 用例的像素帧（前面 11 条断言已过，截图调用超时）
const automator = require('miniprogram-automator')
const fs = require('fs')
const B = String.fromCharCode(92)
const OUT = 'D:' + B + 'OurTrail' + B + 'docs' + B + 'ui-ux-redesign' + B + 'evidence' + B + 'weather-v3-optimize-2026-10-28'
const sleep = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' })
  try {
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await sleep(2000)
    await page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    await sleep(3000)
    let wd = null
    for (let i = 0; i < 30; i++) {
      wd = wd || await page.$('weather-detail')
      if (wd) { const d = await wd.data(); if (!d.loading && d.hourlySrc) break }
      await sleep(1000)
    }
    const d = await wd.data()
    const svg = decodeURIComponent(String(d.hourlySrc).slice(String(d.hourlySrc).indexOf(',') + 1))
    const a = svg.indexOf('data-seg="precip"'), seg = svg.slice(a, svg.indexOf('</g>', a))
    console.log('place=' + d.placeName, 'bars=' + (seg.match(/<rect x=/g) || []).length, 'zeros=' + (seg.match(/>0\.0<\/text>/g) || []).length)
    for (const [name, y] of [['after-wet-top.png', 0], ['after-wet-note.png', 560]]) {
      await mp.pageScrollTo(y); await sleep(1500)
      let buf = null
      for (let i = 0; i < 3 && !buf; i++) {
        try { buf = Buffer.from(String(await mp.screenshot()), 'base64') } catch (e) { console.log('  retry shot ' + name + ': ' + e.message); await sleep(4000) }
      }
      if (buf) { fs.writeFileSync(OUT + B + name, buf); console.log('  · shot ' + name + ' (' + buf.length + 'B)') }
      else console.log('  ✗ ' + name + ' 未取到')
    }
  } finally { await mp.disconnect() }
})()
