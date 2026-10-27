'use strict'
// 定点复核：状态矩阵套件因 .button.secondary 选择器过期，未测到「已确认在选 ⇒ 确认报名禁用」。
// 本脚本只做真实 UI 勾选 + 真实点击 + 后果读数，不写任何业务数据。
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'C:/Users/thinkbook/AppData/Local/Temp/opencode/e2e-style-a'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failed = 0
const check = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' | ' + extra : ''))
  if (!cond) failed++
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  const call = (action, data) => mp.evaluate(new Function('action', 'data', 'return new Promise(res=>wx.cloud.callFunction({name:"trailApi",data:Object.assign({action},data)}).then(r=>res(r.result)).catch(e=>res({ok:false,err:String(e&&e.errMsg||e)})))'), action, data)

  const home = await call('read', { request: { kind: 'home' } })
  const acts = home && home.ok ? home.data.view.activities : []
  console.log('home ok=' + !!(home && home.ok) + ' activities=' + acts.length)
  const target = acts.filter(a => String(a.title || '').indexOf('状态矩阵E2E-7cm7') !== -1)[0]
  check('找到本轮状态矩阵沙盒活动', !!target, JSON.stringify(acts.slice(-6).map(a => a.title)))
  if (!target) { try { await mp.disconnect() } catch (e) {} process.exit(1) }
  console.log('target=' + target.id + ' title=' + target.title + ' phase=' + target.phase)

  const page = await mp.reLaunch('/pages/workspace/workspace?id=' + target.id)
  await page.waitFor(2500)
  for (let i = 0; i < 20; i++) {
    const d = await page.data()
    if (d && d.loading === false) break
    await page.waitFor(1000)
  }
  const segs = await page.$$('.seg')
  check('名单分区入口在场', segs.length >= 2, 'seg=' + segs.length)
  await segs[1].tap()
  await page.waitFor(1500)
  const rp = await page.$('roster-panel')
  check('roster-panel 在场', !!rp)
  if (!rp) { try { await mp.disconnect() } catch (e) {} process.exit(1) }

  const rows = await rp.$$('person-row')
  const rowTexts = []
  for (const r of rows) rowTexts.push(String(await r.text()).replace(/\s+/g, ' ').trim().slice(0, 48))
  console.log('rows=' + rows.length + ' ' + JSON.stringify(rowTexts))

  let box = null
  for (const row of rows) {
    if (String(await row.text()).indexOf('赵辰-7cm7') !== -1) { box = (await row.$$('checkbox'))[0] || null; break }
  }
  check('找到已确认行「赵辰-7cm7」的勾选框', !!box)
  if (box) { await box.tap(); await page.waitFor(1200) }
  const rd1 = await rp.data()
  check('勾选落到 selectedCount=1', !!(rd1 && rd1.selectedCount === 1),
    JSON.stringify({ selectedCount: rd1 && rd1.selectedCount, selected: rd1 && Object.keys(rd1.selected || {}) }))

  const btns = await rp.$$('.button')
  const list = []
  for (const b of btns) list.push({ t: String(await b.text()).trim(), c: String(await b.attribute('class') || '') })
  console.log('roster buttons=' + JSON.stringify(list))
  let confirmBtn = null
  for (const b of btns) if (String(await b.text()).trim() === '确认报名') { confirmBtn = b; break }
  check('「确认报名」按钮在场', !!confirmBtn)
  const cls = confirmBtn ? String(await confirmBtn.attribute('class') || '') : ''
  check('已确认在选时「确认报名」呈 disabled', cls.indexOf('disabled') !== -1, 'class=' + cls)

  if (confirmBtn) { await confirmBtn.tap(); await page.waitFor(1200) }
  const rd2 = await rp.data()
  check('真实点击后未进入确认流程（batch 为空、选择保持）',
    !!(rd2 && rd2.batch === '' && rd2.selectedCount === 1),
    JSON.stringify({ batch: rd2 && rd2.batch, selectedCount: rd2 && rd2.selectedCount }))

  const pageEl = await page.$('.page')
  const pbtns = pageEl ? await pageEl.$$('.button') : []
  const texts = []
  for (const b of pbtns) texts.push(String(await b.text()).trim())
  check('阶段推进入口文案为「开始集合」', texts.indexOf('开始集合') !== -1,
    JSON.stringify(texts.filter(t => t.indexOf('集合') !== -1)))

  const buf = Buffer.from(String(await mp.screenshot()), 'base64')
  fs.writeFileSync(OUT + '/state-invariant-probe.png', buf)
  console.log('shot bytes=' + buf.length)
  try { await mp.disconnect() } catch (e) {}
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error(e && (e.stack || e)); process.exit(1) })
