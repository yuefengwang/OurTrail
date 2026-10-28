const fs = require('fs')
const path = require('path')
const assert = require('assert')
if (!process.env.MP_AUTOMATOR_PATH) throw new Error('Set MP_AUTOMATOR_PATH to an external miniprogram-automator installation')
const automator = require(process.env.MP_AUTOMATOR_PATH)
const output = process.env.EDITOR_QA_OUTPUT || path.join(require('os').tmpdir(), 'ourtrail-editor-qa', 'after')
const evidence = { date: new Date().toISOString(), source: 'native renderer; controlled API responses and isolated memory storage; no real cloud writes', checks: [], screenshots: [], errors: [] }
let mini
function check(name, condition) {
  evidence.checks.push({ name, pass: !!condition })
  console.log((condition ? 'PASS ' : 'FAIL ') + name)
  assert.ok(condition, name)
}
async function settle(page, predicate) {
  const limit = Date.now() + 15000
  while (Date.now() < limit) {
    const data = await page.data()
    if (predicate(data)) return data
    await page.waitFor(100)
  }
  throw new Error('Timed out waiting for editor state')
}
async function tap(page, label, selector = '.button, .seg, .editor-source, .editor-review-row, .readiness-row') {
  for (const element of await page.$$(selector)) {
    if ((await element.text()).trim().includes(label)) {
      await element.tap()
      await page.waitFor(150)
      return
    }
  }
  throw new Error('Missing visible action: ' + label)
}
async function shot(name) {
  await mini.screenshot({ path: path.join(output, name + '.png') })
  evidence.screenshots.push(name + '.png')
}
async function main() {
  fs.mkdirSync(output, { recursive: true })
  mini = await automator.connect({ wsEndpoint: process.env.MP_WS_ENDPOINT || 'ws://127.0.0.1:9427' })
  mini.on('exception', error => evidence.errors.push(String(error.message || error)))
  evidence.system = await mini.systemInfo()
  await mini.evaluate(() => {
    const state = getApp().__editorQA = {
      original: { cloud: wx.cloud.callFunction, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync, location: wx.chooseLocation },
      storage: {}, commands: [], revision: 1, cancelMap: true,
    }
    wx.getStorageSync = key => state.storage[key] || ''
    wx.setStorageSync = (key, value) => { state.storage[key] = JSON.parse(JSON.stringify(value)) }
    wx.removeStorageSync = key => { delete state.storage[key] }
    wx.chooseLocation = options => {
      if (state.cancelMap) { if (options.fail) options.fail({ errMsg: 'chooseLocation:fail cancel' }); return }
      options.success({ name: '验收样例 · 公园入口', address: '验收样例 · 正门广场', latitude: 30.66, longitude: 104.06 })
    }
    wx.cloud.callFunction = options => {
      const data = options.data || {}
      let result
      if (data.action === 'read') {
        result = data.request.kind === 'profile'
          ? { view: { kind: 'profile', profile: { id: 'qa-person', person: { name: '验收样例', phone: '13800000000' } } }, revision: state.revision }
          : { view: { kind: 'home', activities: [] }, revision: state.revision }
      } else if (data.action === 'dispatch') {
        if (!['activity.create', 'activity.edit'].includes(data.payload.type)) return Promise.reject(new Error('QA blocks publication and unrelated commands'))
        state.commands.push(data.payload)
        result = { targetIds: ['qa-editor'], revision: ++state.revision }
      } else if (data.action === 'readRoutes') result = { routes: [], revision: state.revision }
      else return Promise.reject(new Error('QA blocks unexpected API: ' + data.action))
      return Promise.resolve({ result: { ok: true, data: result } })
    }
  })
  try {
    let page = await mini.reLaunch('/pages/editor/editor')
    await settle(page, data => !data.loading && data.stepLabels[0] === '基本')
    check('fresh bundle uses new step names', (await page.data()).stepLabels.join(',') === '基本,路线,介绍,发布')
    check('blank form does not display alarming required checklist', (await page.$$('.readiness-row')).length === 0)
    await shot('01-basic-empty')
    const title = await page.$('input')
    await title.input('验收样例 · 周末轻徒步')
    await settle(page, data => data.form.title === '验收样例 · 周末轻徒步')
    check('title input updates real form', (await page.data()).form.title.includes('周末轻徒步'))
    await tap(page, '周六 08:00', '.chip')
    await settle(page, data => data.form.dt_start.date && data.form.dt_end.date)
    check('time suggestion fills start and estimated dates', !!(await page.data()).form.dt_deadline.date)
    await mini.callWxMethod('pageScrollTo', { selector: '#pickup-section', duration: 0 })
    await tap(page, '在地图上选集合点')
    check('map cancel keeps form intact', (await page.data()).form.pickups.length === 0)
    await mini.evaluate(() => { getApp().__editorQA.cancelMap = false })
    await tap(page, '在地图上选集合点')
    await settle(page, data => data.form.pickups.length === 1)
    check('map result fills meeting place and readiness', (await page.data()).publishReady)
    await shot('02-meeting')
    await tap(page, '下一步：路线')
    await settle(page, data => data.step === 1)
    check('ready form still advances to route instead of suddenly publishing', !(await page.data()).publishOpen)
    await shot('03-route')
    await tap(page, '从路线库选择', '.editor-source')
    await settle(page, data => data.quickRouteOpen && !data.quickRouteLoading)
    check('route library empty state is explicit', (await page.data()).quickRoutes.length === 0)
    await page.callMethod('onQuickRouteClose')
    await tap(page, '下一步：介绍')
    await settle(page, data => data.step === 2)
    const content = await page.$('content-editor')
    const body = await content.$('textarea')
    await body.input('验收样例：一起走公园环线，带好饮水。')
    await settle(page, data => data.contentFilled)
    check('intro editor still writes parent content', (await page.data()).form.content[0].text.includes('带好饮水'))
    await shot('04-intro')
    await tap(page, '下一步：报名')
    await settle(page, data => data.step === 3)
    check('review page contains live meeting and intro', (await page.data()).reviewRows[1].value.includes('公园入口') && (await page.data()).reviewRows[3].value === '已填写图文介绍')
    await shot('05-review')
    await tap(page, '集合安排', '.editor-review-row')
    await settle(page, data => data.step === 0)
    check('review edit returns to meeting section', !!await page.$('#pickup-section'))
    await page.waitFor(350)
    await mini.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 })
    page = await mini.currentPage()
    await page.waitFor(350)
    await tap(page, '发布', '.seg')
    await settle(page, data => data.step === 3)
    await mini.callWxMethod('pageScrollTo', { scrollTop: 500, duration: 0 })
    await shot('06-registration')
    await tap(page, '发布活动', '.editor-footer .button.primary')
    await settle(page, data => data.publishOpen && !data.busy)
    check('publish intent saves a draft before confirmation', (await mini.evaluate(() => getApp().__editorQA.commands)).length === 1)
    check('confirmation discloses visibility and registration policy', (await page.data()).publishSummaryLines.some(line => line.includes('公开到发现页')))
    check('confirmation does not auto opt organizer into participation', !(await page.data()).participate && !(await page.data()).dataUse)
    await shot('07-publish-confirmation')
    check('no publish command was sent', (await mini.evaluate(() => getApp().__editorQA.commands)).every(command => command.type !== 'activity.publish'))
    await page.callMethod('onPublishClose')
    await mini.evaluate(() => { getApp().__editorQA.storage = {} })
    page = await mini.reLaunch('/pages/editor/editor')
    await settle(page, data => !data.loading)
    check('second case has independent empty state', (await page.data()).form.title === '')
    await tap(page, '发布', '.seg')
    await settle(page, data => data.step === 3)
    await tap(page, '去补齐必填项', '.editor-footer .button.primary')
    await settle(page, data => data.step === 0)
    check('missing required action returns to basics without a write', (await mini.evaluate(() => getApp().__editorQA.commands)).length === 1)
    await shot('08-required-return')
  } finally {
    await mini.evaluate(() => {
      const original = getApp().__editorQA.original
      wx.cloud.callFunction = original.cloud
      wx.getStorageSync = original.get
      wx.setStorageSync = original.set
      wx.removeStorageSync = original.remove
      wx.chooseLocation = original.location
      delete getApp().__editorQA
    })
    await mini.disconnect()
  }
}
main().catch(error => { evidence.failure = error.stack; console.error(error); process.exitCode = 1 }).finally(() => {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify(evidence, null, 2))
})
