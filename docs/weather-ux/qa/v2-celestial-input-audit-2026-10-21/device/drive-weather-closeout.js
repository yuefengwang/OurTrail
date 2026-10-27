/* 天相六项收口 · 真机（IDE 模拟器）像素复核驱动
   - 不上传、不改云端；只 reLaunch 页面、读 data/文本、截图。
   - 用法：node drive-weather-closeout.js <wsEndpoint> <outDir>
*/
'use strict'
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const WS = process.argv[2] || 'ws://127.0.0.1:9425'
const OUT = process.argv[3] || 'D:/OurTrail/docs/weather-ux/qa/v2-celestial-input-audit-2026-10-21/device'
const DATE = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const URL = '/pages/weather/weather?src=local&lat=30.0&lng=100.27&ele=4000&name=%E7%90%86%E5%A1%98&date=' + DATE

const sleep = ms => new Promise(r => setTimeout(r, ms))
function savePng(name, raw) {
  const buf = Buffer.from(String(raw), 'base64')
  fs.writeFileSync(path.join(OUT, name), buf)
  return buf.length
}

async function waitFor(fn, ms, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true } catch (e) {}
    await sleep(300)
  }
  console.log('TIMEOUT ' + label)
  return false
}

async function allTexts(page) {
  const els = await page.$$('text')
  const out = []
  for (const el of els) {
    try {
      const t = String(await el.text()).trim()
      if (t) out.push(t)
    } catch (e) {}
  }
  return out
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const mp = await automator.connect({ wsEndpoint: WS })
  const errors = []
  try {
    if (mp.on) {
      mp.on('exception', e => errors.push({ type: 'exception', message: String((e && (e.message || e.stack)) || e).slice(0, 500) }))
      mp.on('console', m => {
        if (m && (m.type === 'error' || m.type === 'warn')) {
          errors.push({ type: m.type, message: String((m.args || []).join(' ')).slice(0, 500) })
        }
      })
    }

    const page = await mp.reLaunch(URL)
    await waitFor(async () => {
      const d = await page.data()
      return (d.dayCards || []).length > 0 && d.loadingWeather === false
    }, 30000, 'weather dayCards')
    await sleep(2500)

    const d = await page.data()
    const state = {
      date: d.date,
      dayCards: (d.dayCards || []).length,
      condCards: (d.condCards || []).length,
      condSilent: !!d.condSilent,
      condOverall: d.condOverall || null,
      skyInputLoading: d.skyInputLoading,
      skyInputNote: d.skyInputNote,
      updatedAt: d.updatedAt,
      providerLabel: d.providerLabel,
      hasChartSeriesInData: Object.prototype.hasOwnProperty.call(d, 'chartSeries'),
      agenda: (d.agenda || []).length,
    }

    await mp.pageScrollTo(0)
    await sleep(800)
    const fullBytes = savePng('weather-full.png', await mp.screenshot())

    await mp.pageScrollTo(20000)
    await sleep(1200)
    const bottomBytes = savePng('weather-bottom.png', await mp.screenshot())

    const texts = await allTexts(page)
    const hits = {
      title: texts.filter(t => t.indexOf('天相条件') !== -1),
      footer: texts.filter(t => t.indexOf('本机按坐标与海拔推算') !== -1 || t.indexOf('DarkSkySites') !== -1),
      sourceCopy: texts.filter(t => t.indexOf('点按复制数据来源') !== -1),
      missing: texts.filter(t => t.indexOf('没有取到') !== -1 || t.indexOf('次数已用完') !== -1),
    }

    const privacy = await mp.reLaunch('/pages/privacy/privacy')
    await sleep(1200)
    const ptexts = await allTexts(privacy)
    const priv = {
      ttl: ptexts.filter(t => t.indexOf('缓存') !== -1),
      date: ptexts.filter(t => t.indexOf('2026-10-21') !== -1),
    }
    await mp.pageScrollTo(3000)
    await sleep(800)
    const privBytes = savePng('privacy-bottom.png', await mp.screenshot())

    const out = { date: DATE, url: URL, state, hits, priv, errors, screenshots: { fullBytes, bottomBytes, privBytes } }
    fs.writeFileSync(path.join(OUT, 'device-readings.json'), JSON.stringify(out, null, 2), 'utf8')
    console.log(JSON.stringify(out, null, 2))
  } finally {
    try { await mp.disconnect() } catch (e) {}
  }
})().catch(e => {
  console.error('DRIVER FAILED: ' + (e && (e.stack || e.message) || e))
  process.exit(1)
})
