'use strict'
/* 补"看得见"的那一层：第一轮读数是 DOM 几何（真），但视口截图停在首屏，
   常用同行人 / 路线行 / 节点行都在折叠线以下 ⇒ 截图里根本看不见被量的东西。
   这里对三个目标元素各出一张元素级截图（拿不到就滚到该元素再截整屏），
   并且**读数与截图必须同源**：先量、后截、把两者的坐标一起写进 readings。 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')
const ROOT = 'D:/OurTrail/docs/ui-ux-redesign/evidence'
const A = path.join(ROOT, 'style-b-slice5a-2026-10-26/device')
const B = path.join(ROOT, 'style-b-slice5b-2026-10-26/device')
const LONG = 'MuztaghAttakunerjikghvwtssherartokenglongnonspacelatinstringabcdefghijklmnop'
const log = { shots: [], notes: [] }
const v = x => (x && typeof x === 'object' ? x.value : x)
async function box(el) {
  if (!el) return null
  let s = null, o = null
  try { s = await el.size() } catch (e) {}
  try { o = await el.offset() } catch (e) {}
  return { width: v(s && s.width), height: v(s && s.height), left: v(o && o.left), top: v(o && o.top) }
}
async function save(raw, file) {
  const buf = Buffer.from(String(raw), 'base64')
  fs.writeFileSync(file, buf)
  log.shots.push({ file, bytes: buf.length })
  console.log('  · ' + file + ' (' + buf.length + ' bytes)')
}
async function elementShot(el, file, label) {
  let done = false
  try {
    const r = await el.screenshot()
    if (r) { await save(r, file); done = true; log.notes.push(label + '：元素级截图') }
  } catch (e) { log.notes.push(label + '：element.screenshot 不可用 — ' + String(e && e.message).slice(0, 60)) }
  return done
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9441' })

  // 1) me 的常用同行人（注入 2 条：长名 + 短名）
  let page = await mp.reLaunch('/pages/me/me')
  await page.waitFor(5000)
  await page.setData({ companions: [{ id: 'p1', name: LONG, avatar: '' }, { id: 'p2', name: '李四', avatar: '' }] })
  await page.waitFor(1500)
  const prow = await page.$('.person-row')
  const pb = await box(prow)
  try { await mp.pageScrollTo(Math.max(0, (pb.top || 0) - 120)) } catch (e) { log.notes.push('pageScrollTo(obj) 不可用：' + String(e && e.message).slice(0, 60)) }
  await page.waitFor(1200)
  if (!await elementShot(prow, path.join(A, 'V1-me-personrow-longname.png'), 'V1')) {
    await save(await mp.screenshot(), path.join(A, 'V1-me-personrow-scrolled.png'))
  }
  log.notes.push({ V1personRow: pb })

  // 2) routes 的第一条路线行（真实数据）
  page = await mp.reLaunch('/pages/routes/routes')
  await page.waitFor(6000)
  const metrics = await page.$('.metrics.compact')
  if (metrics) {
    const mb = await box(metrics)
    try { await mp.pageScrollTo(Math.max(0, (mb.top || 0) - 160)) } catch (e) {}
    await page.waitFor(1200)
    if (!await elementShot(await page.$('.route-row'), path.join(B, 'V2-routes-row-metrics.png'), 'V2')) {
      await save(await mp.screenshot(), path.join(B, 'V2-routes-row-scrolled.png'))
    }
    log.notes.push({ V2metrics: mb })
  } else log.notes.push('V2：真实数据里没有 .metrics.compact')

  // 3) editor 节点行长名（routeDetailsOpen 打开）
  page = await mp.reLaunch('/pages/editor/editor')
  await page.waitFor(6000)
  const base = await page.data()
  const f = JSON.parse(JSON.stringify(base.form || {}))
  f.points = [{ id: 'probe', name: LONG, kind: 'start', lat: 30.1, lng: 103.1 }]
  await page.setData({ step: 1, routeDetailsOpen: true, form: f })
  await page.waitFor(2000)
  const titles = await page.$$('.row-title')
  let target = null
  for (const el of titles) {
    const t = String(await el.text().catch(() => ''))
    if (t.slice(0, 12) === LONG.slice(0, 12)) { target = el; break }
  }
  if (target) {
    const tb = await box(target)
    try { await mp.pageScrollTo(Math.max(0, (tb.top || 0) - 200)) } catch (e) {}
    await page.waitFor(1200)
    if (!await elementShot(target, path.join(A, 'V3-editor-node-longname.png'), 'V3')) {
      await save(await mp.screenshot(), path.join(A, 'V3-editor-node-scrolled.png'))
    }
    log.notes.push({ V3rowTitle: tb })
  } else log.notes.push('V3：没找到长名那一行')

  await mp.disconnect()
  fs.writeFileSync(path.join(A, 'readings-visual.json'), JSON.stringify(log, null, 2), 'utf8')
  console.log('\n==== 视觉补拍 ' + log.shots.length + ' 张 ====')
})().catch(e => { console.error('驱动异常：' + (e && e.stack || e)); process.exit(3) })
