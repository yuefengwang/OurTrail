/* 等天相增强输入（getSkyContext）落页后读数：node drive-weather-sky.js <ws> <out> */
'use strict'
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')
const WS = process.argv[2] || 'ws://127.0.0.1:9425'
const OUT = process.argv[3] || 'D:/OurTrail/docs/weather-ux/qa/v2-celestial-input-audit-2026-10-21/device'
const DATE = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const URL = '/pages/weather/weather?src=local&lat=30.0&lng=100.27&ele=4000&name=%E7%90%86%E5%A1%98&date=' + DATE
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitFor(fn, ms, label) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < ms) {
    try { last = await fn(); if (last) return last } catch (e) {}
    await sleep(400)
  }
  console.log('TIMEOUT ' + label)
  return null
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const mp = await automator.connect({ wsEndpoint: WS })
  const errors = []
  try {
    if (mp.on) {
      mp.on('exception', e => errors.push(String((e && (e.message || e.stack)) || e).slice(0, 400)))
      mp.on('console', m => { if (m && m.type === 'error') errors.push(String((m.args || []).join(' ')).slice(0, 400)) })
    }
    const page = await mp.reLaunch(URL)
    await waitFor(async () => {
      const d = await page.data()
      return (d.dayCards || []).length > 0 && d.loadingWeather === false
    }, 30000, 'dayCards')

    const done = await waitFor(async () => {
      const d = await page.data()
      return d.skyInputLoading === false
    }, 45000, 'skyInputLoading')

    const d = await page.data()
    const cards = (d.condCards || []).map(c => ({
      key: c.key, title: c.title, stars: c.stars, tone: c.tone,
      window: c.window, text: c.text, look: c.look,
      evidence: (c.evidence || []).map(e => e.fact),
    }))
    const out = {
      date: DATE,
      waitedSky: !!done,
      updatedAt: d.updatedAt,
      skyInputLoading: d.skyInputLoading,
      skyInputNote: d.skyInputNote,
      condOverall: d.condOverall,
      condSilent: d.condSilent,
      cards,
      errors,
    }
    fs.writeFileSync(path.join(OUT, 'sky-input-readings.json'), JSON.stringify(out, null, 2), 'utf8')

    // 滚到天相条件区并截图（按元素定位，避免固定偏移猜错）
    try {
      const title = (await page.$$('text')).find ? null : null
      const els = await page.$$('text')
      let target = null
      for (const el of els) {
        const t = String(await el.text()).trim()
        if (t === '天相条件') { target = el; break }
      }
      if (target) {
        const box = await target.offset()
        await mp.pageScrollTo(Math.max(0, (box && box.top ? box.top : 0) - 80))
        await sleep(1000)
      }
    } catch (e) {}
    const raw = await mp.screenshot()
    fs.writeFileSync(path.join(OUT, 'weather-sky.png'), Buffer.from(String(raw), 'base64'))
    console.log(JSON.stringify(out, null, 2))
  } finally {
    try { await mp.disconnect() } catch (e) {}
  }
})().catch(e => { console.error(e && (e.stack || e.message)); process.exit(1) })
