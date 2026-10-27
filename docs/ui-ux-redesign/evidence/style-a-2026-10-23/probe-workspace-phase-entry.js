'use strict'
// 只读复核：状态矩阵探针里「开始集合」未出现在页面按钮文本中，究竟是文案回退还是查询口径问题。
// 只读页面数据与元素文本，不点任何按钮、不写任何业务数据。
const automator = require('miniprogram-automator')
const fs = require('fs')
const OUT = 'C:/Users/thinkbook/AppData/Local/Temp/opencode/e2e-style-a'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  const call = (action, data) => mp.evaluate(new Function('action', 'data', 'return new Promise(res=>wx.cloud.callFunction({name:"trailApi",data:Object.assign({action},data)}).then(r=>res(r.result)).catch(e=>res({ok:false,err:String(e&&e.errMsg||e)})))'), action, data)

  const home = await call('read', { request: { kind: 'home' } })
  const acts = home && home.ok ? home.data.view.activities : []
  const target = acts.filter(a => String(a.title || '').indexOf('状态矩阵E2E-7cm7') !== -1)[0]
  if (!target) { console.log('NO_TARGET ' + JSON.stringify(acts.slice(-8).map(a => a.title))); try { await mp.disconnect() } catch (e) {} process.exit(1) }
  console.log('target=' + target.id + ' phase=' + target.phase + ' title=' + target.title)

  const page = await mp.reLaunch('/pages/workspace/workspace?id=' + target.id)
  await page.waitFor(2500)
  for (let i = 0; i < 20; i++) {
    const d = await page.data()
    if (d && d.loading === false && d.activityId) break
    await page.waitFor(1000)
  }
  await page.waitFor(1500)
  const d = await page.data()
  const fields = {
    denied: d.denied, loading: d.loading, activityId: d.activityId,
    phaseLabel: d.phaseLabel, nextPhaseLabel: d.nextPhaseLabel,
    canTransition: d.canTransition, canEdit: d.canEdit, canCancel: d.canCancel,
    transitionHint: d.transitionHint, busy: d.busy,
    isOrganizer: d.isOrganizer, perspective: d.perspective, tab: d.tab,
  }
  console.log('DATA ' + JSON.stringify(fields))
  fs.writeFileSync(OUT + '/workspace-phase-entry-data.json', JSON.stringify(fields, null, 2))

  const pageEl = await page.$('.page')
  console.log('pageEl=' + !!pageEl)
  const scopes = []
  if (pageEl) scopes.push({ name: '.page', el: pageEl })
  const all = await page.$$('.button')
  scopes.push({ name: 'page.$$', els: all })
  for (const s of scopes) {
    const els = s.els || await s.el.$$('.button')
    const out = []
    for (const b of els) {
      let t = ''
      try { t = String(await b.text()).trim() } catch (e) { t = '<text-error:' + String(e && e.message || e) + '>' }
      let c = ''
      try { c = String(await b.attribute('class') || '') } catch (e) { c = '<attr-error>' }
      out.push({ t, c })
    }
    console.log('SCOPE ' + s.name + ' buttons=' + out.length + ' ' + JSON.stringify(out))
    fs.writeFileSync(OUT + '/workspace-phase-entry-buttons-' + s.name.replace(/[^a-z.]/gi, '_') + '.json', JSON.stringify(out, null, 2))
  }
  // 定向取那个推进按钮（文案来自 nextPhaseLabel，回退文案是「这一步现在还不能做」）
  const prim = await page.$$('.button.primary')
  const primOut = []
  for (const b of prim) primOut.push({ t: String(await b.text()).trim(), c: String(await b.attribute('class') || '') })
  console.log('PRIMARY ' + JSON.stringify(primOut))
  fs.writeFileSync(OUT + '/workspace-phase-entry-primary.json', JSON.stringify(primOut, null, 2))

  try { await mp.disconnect() } catch (e) {}
  process.exit(0)
}
main().catch(async e => { console.log('ERROR ' + (e && e.stack || e)); process.exit(1) })
