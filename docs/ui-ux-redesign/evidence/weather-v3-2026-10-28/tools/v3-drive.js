// 天气页 V3 真机（模拟器）核验：逐时图是否画出 + 24/48/72 云层剖面是否同一把尺
// 运行：node v3-drive.js（需 cli auto 已起在 9421）
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'D:/OurTrail/docs/ui-ux-redesign/evidence/weather-v3-2026-10-28'
fs.mkdirSync(OUT, { recursive: true })

const log = []
function say(s) { log.push(s); console.log(s) }
function fail(s) { say('✗ ' + s) }

async function shot(mp, name) {
  const raw = await mp.screenshot()
  const buf = Buffer.from(String(raw), 'base64')
  fs.writeFileSync(OUT + '/' + name, buf)
  say('· shot ' + name + ' (' + buf.length + ' B)')
}

async function waitFor(fn, ms, step) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, step || 500))
  }
  return null
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9421' })
  try {
    // 每用例前 reLaunch：清掉 _unified/_oiCache 这类实例属性
    const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
    await page.waitFor(1200)

    page.callMethod('goPoint', { name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    await page.waitFor(800)

    const ready = await waitFor(async () => {
      const d = await page.data()
      if (!d || d.screen !== 'detail') return null
      return d.initial != null ? d : null
    }, 20000)
    if (!ready) { fail('没能进入详情屏'); throw new Error('no detail screen') }
    say('· 进入详情屏，place=' + JSON.stringify((await page.data()).place && (await page.data()).place.name))

    const wd = await page.$('weather-detail')
    if (!wd) { fail('weather-detail 组件不在 DOM'); throw new Error('no component') }

    // 渲染门槛链：denied/loading/失败 → 数据到位
    const gate = await waitFor(async () => {
      const d = await wd.data()
      if (d.loading || d.loadingWeather) return null
      if (d.denied) return { bad: 'denied=' + d.denied }
      if (d.errorCode) return { bad: 'errorCode=' + d.errorCode }
      if (!d.dayStrip || !d.dayStrip.length) return null
      if (!d.hourlySrc) return null
      return { ok: true, cards: d.dayStrip.length, hourlyLen: String(d.hourlySrc || '').length, unified: !!(d.cloud && d.cloud.src), cloud: d.cloud }
    }, 60000)

    if (!gate || !gate.ok) {
      fail('门槛链未过：' + JSON.stringify(gate))
      await shot(mp, 'gate-failed.png')
      throw new Error('gate failed')
    }
    say('· 门槛链通过：dayCards=' + gate.cards + ' hourlySrc=' + gate.hourlyLen + ' unified=' + gate.unified)

    // ---- 逐时预报 ----
    await wd.callMethod('onTab', { currentTarget: { dataset: { key: 'hourly' } } })
    await page.waitFor(1200)
    const img = await wd.$('.wv3-chart-img')
    if (!img) fail('逐时图 <image> 不在 DOM')
    else {
      const st = await img.style().catch(() => null)
      say('· <image> 计算样式：' + JSON.stringify(st && { w: st.width, h: st.height }))
      const src = await img.attribute('src')
      say('· <image> src 前缀=' + String(src).slice(0, 40) + ' 长度=' + String(src).length +
        ' 裸引号=' + /['!()*]/.test(String(src).replace(/^[^,]*,/, '')))
    }
    await mp.pageScrollTo(700)
    await page.waitFor(600)
    await shot(mp, 'hourly-24.png')

    // ---- 云层 24/48/72 对照 ----
    await mp.pageScrollTo(0)
    await wd.callMethod('onTab', { currentTarget: { dataset: { key: 'cloud' } } })
    await page.waitFor(1500)

    const readings = []
    for (const period of [24, 48, 72]) {
      await wd.callMethod('onPeriod', { currentTarget: { dataset: { value: period } } })
      await page.waitFor(2000)
      const d = await wd.data()
      const rangeEl = await wd.$('.wv3-cloud-range')
      const elevEl = await wd.$('.wv3-cloud-elev-note')
      const r = {
        period,
        range: rangeEl ? String(await rangeEl.text()).trim() : null,
        legend: elevEl ? String(await elevEl.text()).trim() : null,
        rangeLabelData: d.cloud && d.cloud.rangeLabel,
        legendElevData: d.cloud && d.cloud.legendElev,
        ticks: d.cloud && d.cloud.profile && d.cloud.profile.ticks,
        lo: d.cloud && d.cloud.profile && d.cloud.profile.lo,
        hi: d.cloud && d.cloud.profile && d.cloud.profile.hi,
        svgLen: String((d.cloud && d.cloud.src) || '').length,
      }
      readings.push(r)
      say('· ' + period + 'h → range=' + r.range + ' | legend=' + r.legend + ' | lo..hi=' + r.lo + '..' + r.hi + ' | ticks=' + JSON.stringify(r.ticks))
      await mp.pageScrollTo(420)
      await page.waitFor(500)
      await shot(mp, 'cloud-' + period + '.png')
      await mp.pageScrollTo(0)
    }

    const same = readings.every(r => r.range === readings[0].range && r.legend === readings[0].legend &&
      JSON.stringify(r.ticks) === JSON.stringify(readings[0].ticks) && r.lo === readings[0].lo && r.hi === readings[0].hi)
    say((same ? '✓' : '✗') + ' 24/48/72 显示窗、刻度、图例三档' + (same ? '逐字相同' : '不一致'))
    // 污染自证：三档的 SVG 必须互不相同（否则说明 period 根本没生效，这批读数无效）
    const distinct = new Set(readings.map(r => r.svgLen + '|' + r.range)).size
    say('· 污染自证：distinct(period)→' + distinct + '（必须 > 1，否则 period 没生效）')

    fs.writeFileSync(OUT + '/readings.json', JSON.stringify({ gate: { cards: gate.cards, hourlyLen: gate.hourlyLen, unified: gate.unified }, readings, log }, null, 2))
    say('· 读数落盘 readings.json')
  } finally {
    await mp.disconnect()
  }
})().catch(e => { console.error('DRIVER ERROR: ' + (e && e.stack || e)); process.exit(1) })
