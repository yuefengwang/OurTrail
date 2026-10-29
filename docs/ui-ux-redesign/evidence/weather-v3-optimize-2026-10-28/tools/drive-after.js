// 跑法：复制到仓库外的 mp-auto 目录（本仓库零 npm 依赖）后 node drive-after.js；需先 close+open 重编译并 auto --auto-port 9431
// 天气 V3 改后真机（IDE 模拟器）回读：干窗压缩 + 剖面脚注去重
// 前置：cli close+open 重编译后 auto 起在 9431
// 运行：node v3-dry-wet-drive.js
const automator = require('miniprogram-automator')
const fs = require('fs')
const B = String.fromCharCode(92)
const OUT = 'D:' + B + 'OurTrail' + B + 'docs' + B + 'ui-ux-redesign' + B + 'evidence' + B + 'weather-v3-optimize-2026-10-28'
let mp = null
let passed = 0, failed = 0
const readings = { capturedAt: new Date().toISOString(), port: 9431, cases: {} }
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); return }
  failed++; console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
async function shot(name) {
  const buf = Buffer.from(String(await mp.screenshot()), 'base64')
  fs.writeFileSync(OUT + B + name, buf)
  ;(readings.files = readings.files || []).push(name + ' (' + buf.length + 'B)')
  console.log('  · shot ' + name)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const uriToSvg = uri => decodeURIComponent(uri.slice(uri.indexOf(',') + 1))
function precipSeg(svg) {
  const a = svg.indexOf('data-seg="precip"')
  if (a < 0) return ''
  const b = svg.indexOf('</g>', a)
  return svg.slice(a, b < 0 ? svg.length : b)
}
async function enter(point) {
  const page = await mp.reLaunch('/pages/weather-hub/weather-hub')
  await sleep(2000)
  // weather-detail 只在屏 2 的 wx:else 里 ⇒ 必须先 goPoint 再找组件
  // goPoint 也会被还没就绪的页面静默吞掉 ⇒ 按 placeName 回读确认，不确认就重试
  let wd = null
  let named = false
  for (let i = 0; i < 8 && !named; i++) {
    await page.callMethod('goPoint', point)
    await sleep(2500)
    if (!wd) wd = await page.$('weather-detail')
    for (let k = 0; k < 8; k++) {
      if (!wd) { wd = await page.$('weather-detail'); if (!wd) break }
      const d0 = await wd.data()
      if (d0.placeName === point.name) { named = true; break }
      await sleep(1000)
    }
  }
  if (!wd) throw new Error('weather-detail 不在 DOM')
  if (!named) throw new Error('goPoint 未生效（placeName 始终不是 ' + point.name + '）')
  for (let i = 0; i < 90; i++) {
    const d = await wd.data()
    if (d.errorCode) throw new Error('取数失败 errorCode=' + d.errorCode + ' / ' + d.error)
    if (!d.loading && d.dayStrip && d.dayStrip.length && d.hourlySrc) return { page, wd, d }
    await sleep(1000)
  }
  throw new Error('详情数据门槛未过（90s）')
}

;(async () => {
  mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' })
  try {
    console.log('\n§ A 干窗（折多山 30.0512/101.8156 · 4298m，真实 24h 降水与概率全 0）')
    let ctx = await enter({ name: '折多山', lat: 30.0512, lng: 101.8156, ele: 4298, eleSource: 'manual' })
    let svg = uriToSvg(String(ctx.d.hourlySrc))
    let seg = precipSeg(svg)
    readings.cases.dry = {
      place: ctx.d.placeName, node: ctx.d.nodeName, period: ctx.d.period,
      zeros: (seg.match(/>0\.0<\/text>/g) || []).length,
      popLabels: (seg.match(/>[\d.]+%<\/text>/g) || []).length,
      bars: (seg.match(/<rect x=/g) || []).length,
      sentence: (seg.match(/\d+ 小时降水 0 · 概率 0%/g) || [null])[0],
      dashWhole: (svg.match(/>—<\/text>/g) || []).length,
    }
    check('A1 降水段印出窗口级一句话「N 小时降水 0 · 概率 0%」', /小时降水 0 · 概率 0%/.test(seg), readings.cases.dry)
    check('A2 降水段没有逐格 0.0 / 概率数字（旧形态是 8+8 个）', readings.cases.dry.zeros === 0 && readings.cases.dry.popLabels === 0, readings.cases.dry)
    check('A3 降水段没有一根柱', readings.cases.dry.bars === 0, readings.cases.dry)
    check('A4 整图没有把缺测印成 0（本例无缺测 ⇒ — 计数 0）', readings.cases.dry.dashWhole === 0, readings.cases.dry)
    const noteTexts = []
    for (const el of await ctx.page.$$('.wv3-note')) noteTexts.push(String(await el.text()))
    const hourlyNote = noteTexts.filter(t => t.indexOf('低云含雾') >= 0)[0] || ''
    readings.cases.dry.note = hourlyNote
    check('A5 逐时脚注是新版（含「（低云含雾）」、不含旧句「三层的高度区间」）⇒ bundle 新鲜度自证',
      hourlyNote.length > 0 && hourlyNote.indexOf('三层的高度区间') < 0, noteTexts.map(t => t.slice(0, 20)))
    check('A6 脚注不再复述层界（无 ≤3km / 3–8km / ≥8km 字面）', !/[≤≥]3km|3–8km|[≥]8km/.test(hourlyNote), hourlyNote.slice(0, 40))
    check('A7 脚注四个事实一个不少（出处 / 海平面以上 / 不是云底云顶 / 横线＝缺测）',
      ['Open-Meteo', '海平面以上', '不是这块云的云底或云顶', '不是 0%'].every(k => hourlyNote.indexOf(k) >= 0), hourlyNote)
    await shot('after-dry-top.png')
    await mp.pageScrollTo(560); await sleep(1200)
    await shot('after-dry-note.png')

    console.log('\n§ B 有雨（峨眉山 29.5197/103.3317 · 3099m，真实 14 小时有降水 ⇒ 退回逐格）')
    ctx = await enter({ name: '峨眉山', lat: 29.5197, lng: 103.3317, ele: 3099, eleSource: 'manual' })
    svg = uriToSvg(String(ctx.d.hourlySrc))
    seg = precipSeg(svg)
    readings.cases.wet = {
      place: ctx.d.placeName,
      zeros: (seg.match(/>0\.0<\/text>/g) || []).length,
      popLabels: (seg.match(/>[\d.]+%<\/text>/g) || []).length,
      bars: (seg.match(/<rect x=/g) || []).length,
      sentence: /小时降水 0 · 概率 0%/.test(seg),
    }
    check('B1 有雨窗口不压缩（不出现窗口级一句话）', readings.cases.wet.sentence === false, readings.cases.wet)
    check('B2 逐格标注回来了（出现 0.0 且概率标注 ≥8）', readings.cases.wet.zeros > 0 && readings.cases.wet.popLabels >= 8, readings.cases.wet)
    check('B3 画了降水柱', readings.cases.wet.bars > 0, readings.cases.wet)
    check('B4 两用例读数互不相同（污染自证：B 没复用 A 的图）',
      readings.cases.wet.bars !== readings.cases.dry.bars, { dry: readings.cases.dry.bars, wet: readings.cases.wet.bars })
    await mp.pageScrollTo(0); await sleep(900)
    await shot('after-wet-top.png')

    console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
  } catch (e) {
    failed++
    console.log('  ✗ 驱动异常：' + (e && e.message))
  } finally {
    readings.gates = { passed, failed }
    fs.writeFileSync(OUT + B + 'after-readings.json', JSON.stringify(readings, null, 1), 'utf8')
    if (mp) await mp.disconnect()
  }
  process.exit(failed ? 1 : 0)
})()
