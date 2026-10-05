// Weather V2 真机 QA 驱动：本地模式进入格聂天气页，逐屏截图并驱动 V2 交互。
// 运行：node drive-v2.js（依赖本目录的 miniprogram-automator）
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const OUT = 'D:/OurTrail/docs/weather-ux/qa'
const WS = 'ws://127.0.0.1:9421'

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  let mp = null
  for (let i = 1; i <= 4 && !mp; i++) {
    try {
      mp = await automator.connect({ wsEndpoint: WS })
      console.log('connected on attempt', i)
    } catch (e) {
      console.log('connect attempt', i, 'failed:', e.message)
      await new Promise(r => setTimeout(r, 12000))
    }
  }
  if (!mp) throw new Error('automator connect failed after retries')
  // 预热：IDE 打开后模拟器仍在编译，首个指令容易超时——先探活再进入业务
  await new Promise(r => setTimeout(r, 12000))
  for (let i = 1; i <= 3; i++) {
    try { await mp.systemInfo(); console.log('runtime alive (attempt', i + ')'); break }
    catch (e) {
      console.log('probe', i, 'failed:', e.message)
      await new Promise(r => setTimeout(r, 10000))
      if (i === 3) throw new Error('runtime not responding')
    }
  }
  const shot = async name => {
    const buf = Buffer.from(String(await mp.screenshot()), 'base64')
    fs.writeFileSync(path.join(OUT, name), buf)
    console.log('shot:', name)
  }
  const scrollToEl = async (page, selector) => {
    const el = await page.$(selector)
    if (!el) { console.log('skip scroll, missing', selector); return }
    const off = await el.offset()
    if (off && off.top != null) await mp.pageScrollTo(Math.max(0, off.top - 70))
    await page.waitFor(400)
  }

  // 1) 本地模式进入格聂（ele 走手动填写，天空/云海判定用 3500m）
  const page = await mp.reLaunch('/pages/weather/weather?src=local&lat=29.856&lng=99.466&name='
    + encodeURIComponent('格聂') + '&ele=3500&date=2026-10-06')
  await page.waitFor(6000)
  await page.waitFor(async () => {
    const d = await page.data()
    return d.dayCards && d.dayCards.length > 0
  }, { timeout: 20000 }).catch(() => {})
  const d1 = await page.data()
  console.log('dayCards:', (d1.dayCards || []).length, '| agenda:', (d1.agenda || []).length,
    '| condCards:', (d1.condCards || []).length, '| chartView:', (d1.chartView || []).length,
    '| sunBands:', Object.keys(d1.chartSunBands || {}).length, '| now:', JSON.stringify(d1.chartNow))
  await page.waitFor(800)
  await shot('qa-01-first-screen.png')

  // 2) 时间轴区（24h 视图）
  await scrollToEl(page, '.timeline-card')
  await shot('qa-02-timeline-24h.png')

  // 3) 点选小时 → 浮条（07:00 云海带内）
  await page.callMethod('onChartPickHour', { detail: { date: '2026-10-06', t: '07:00' } })
  await page.waitFor(500)
  await scrollToEl(page, '.timeline-card')
  await shot('qa-03-hour-chip.png')

  // 4) 48h / 72h
  await page.callMethod('onSpanToggle', { currentTarget: { dataset: { span: '48' } } })
  await page.waitFor(600)
  await scrollToEl(page, '.timeline-card')
  await shot('qa-04-span-48h.png')
  await page.callMethod('onSpanToggle', { currentTarget: { dataset: { span: '72' } } })
  await page.waitFor(600)
  await scrollToEl(page, '.timeline-card')
  await shot('qa-05-span-72h.png')
  await page.callMethod('onSpanToggle', { currentTarget: { dataset: { span: '24' } } })
  await page.waitFor(400)

  // 5) Agenda
  await scrollToEl(page, '.agenda')
  await shot('qa-06-agenda.png')

  // 6) Conditions 总评 + 云海 featured
  await scrollToEl(page, '.cond-card')
  await shot('qa-07-conditions.png')

  // 7) Evidence 展开（云海 why）+ 看图跳转效果
  await page.callMethod('onToggleEvidence', { currentTarget: { dataset: { key: 'cloudSea' } } })
  await page.waitFor(400)
  await scrollToEl(page, '.cond-pheno')
  await shot('qa-08-evidence-open.png')
  await page.callMethod('onEvidenceJump', { currentTarget: { dataset: { at: '07:00' } } })
  await page.waitFor(900)
  await shot('qa-09-evidence-jump.png')

  // 8) Numbers 展开
  await page.callMethod('toggleDetail')
  await page.waitFor(400)
  await scrollToEl(page, '.num-sheet')
  await shot('qa-10-numbers.png')
  await page.callMethod('toggleDetail')

  // 9) 日期切换（切到明天）
  await page.callMethod('onDayTap', { currentTarget: { dataset: { date: '2026-10-07' } } })
  await page.waitFor(2500)
  await page.waitFor(async () => {
    const d = await page.data()
    return (d.chartView || []).length > 0 && (d.agenda || []).length >= 0
  }, { timeout: 15000 }).catch(() => {})
  await mp.pageScrollTo(0)
  await page.waitFor(500)
  await shot('qa-11-date-switch.png')
  const d2 = await page.data()
  console.log('after switch date:', d2.date, '| agenda:', (d2.agenda || []).length,
    '| viewSpan:', d2.viewSpan, '| span ResetTo24:', (d2.chartView || []).length)

  await mp.disconnect()
  console.log('QA drive done')
}

main().catch(e => { console.error('QA drive FAILED:', e && e.message); process.exit(1) })
