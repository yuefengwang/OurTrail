'use strict'
// 只读：证明本轮业务交互测试所在的开发者工具会话确实加载了样式 A 的 bundle。
// 标记 `.tabs-line` 只存在于本批代码；同时回读卡片边框与推进按钮文案。
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'C:/Users/thinkbook/AppData/Local/Temp/opencode/e2e-style-a'

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  const call = (action, data) => mp.evaluate(new Function('action', 'data', 'return new Promise(res=>wx.cloud.callFunction({name:"trailApi",data:Object.assign({action},data)}).then(r=>res(r.result)).catch(e=>res({ok:false,err:String(e&&e.errMsg||e)})))'), action, data)
  const home = await call('read', { request: { kind: 'home' } })
  const acts = home && home.ok ? home.data.view.activities : []
  const target = acts.filter(a => String(a.title || '').indexOf('状态矩阵E2E-7cm7') !== -1)[0]
  if (!target) { console.log('NO_TARGET'); process.exit(1) }
  const page = await mp.reLaunch('/pages/workspace/workspace?id=' + target.id)
  await page.waitFor(3000)
  for (let i = 0; i < 15; i++) { const d = await page.data(); if (d && d.loading === false) break; await page.waitFor(1000) }
  const segmented = (await page.$$('.segmented'))[0] || null
  const segCls = segmented ? String(await segmented.attribute('class') || '') : ''
  const cards = await page.$$('.card')
  let cardBorder = ''
  if (cards[0]) cardBorder = String(await cards[0].style('border') || '')
  const primary = await page.$$('.button.primary')
  const labels = []
  for (const b of primary) labels.push(String(await b.text()).trim())
  const out = { segClass: segCls, tabsLine: segCls.split(/\s+/).indexOf('tabs-line') !== -1, cardBorder, primaryLabels: labels }
  console.log(JSON.stringify(out))
  fs.writeFileSync(OUT + '/bundle-marker.json', JSON.stringify(out, null, 2))
  try { await mp.disconnect() } catch (e) {}
  process.exit(out.tabsLine ? 0 : 1)
}
main().catch(e => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1) })
