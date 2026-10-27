const fs = require('fs')
const assert = require('assert')
const path = require('path')
if (!process.env.MP_AUTOMATOR_PATH) throw new Error('Set MP_AUTOMATOR_PATH to an external miniprogram-automator installation')
const automator = require(process.env.MP_AUTOMATOR_PATH)
const F = require('../miniprogram/utils/format')
const root = process.env.WEATHER_QA_OUTPUT || path.join(require('os').tmpdir(), 'ourtrail-weather-native-qa')
fs.mkdirSync(root, { recursive: true })
const today = F.cnToday()
const evidence = { date: new Date().toISOString(), source: 'controlled forecast and API mocks; native WeChat renderer', checks: [], screenshots: [], errors: [] }
let mini
const mocked = []
async function mock(method, implementation, ...args) {
  await mini.mockWxMethod(method, implementation, ...args)
  mocked.push(method)
}
function check(name, result) {
  evidence.checks.push({ name, pass: !!result })
  console.log((result ? 'PASS ' : 'FAIL ') + name)
  assert.ok(result, name)
}
async function waitData(page, predicate) {
  const until = Date.now() + 20000
  while (Date.now() < until) {
    const data = await page.data()
    if (predicate(data)) return data
    await page.waitFor(200)
  }
  throw new Error('Page state timeout: ' + page.path)
}
async function waitPage(expected) {
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const page = await mini.currentPage()
    if (page && page.path === expected) return page
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('Navigation timeout: ' + expected)
}
async function tap(page, selector) {
  const labels = { '[bindtap="onManualOpen"]': '输入经纬度', '[bindtap="onManualSubmit"]': '确认位置并查询', '[data-window="high"]': '高层 3–7 km', '[data-step="1"]': '后一时', '[data-tab="hourly"]': '逐时预报', '[data-tab="sky"]': '日月天相', '[bindtap="onRouteLibrary"]': '从路线库选择', '[bindtap="onChooseRoute"]': '验收样例 · 大峰两日', '[bindtap="onEdit"]': '安排行程', '[bindtap="onSave"]': '保存个人行程', '[bindtap="onCopy"]': '复制', '[bindtap="onCancelEdit"]': '取消本次修改', '[bindtap="onNode"]': '验收样例 · 登山口' }
  let element = await page.$(selector)
  if (!element && labels[selector]) {
    for (const candidate of await page.$$('.button, .seg, .seg-btn, .list-row')) {
      if ((await candidate.text()).trim().startsWith(labels[selector])) { element = candidate; break }
    }
  }
  assert.ok(element, 'Element missing: ' + selector)
  await element.tap()
  await page.waitFor(180)
}
async function shot(name) {
  await mini.screenshot({ path: root + '/' + name + '.png' })
  evidence.screenshots.push(name + '.png')
}
async function run() {
  mini = await automator.connect({ wsEndpoint: process.env.MP_WS_ENDPOINT || 'ws://127.0.0.1:9427' })
  mini.on('exception', error => { evidence.errors.push(String(error.message || error)); console.error(error) })
  evidence.system = await mini.systemInfo()
  await mini.evaluate(() => { getApp().__weatherQA = { storage: {}, requests: [], deny: false, noCloud: false } })
  await mock('getStorageSync', function(key) { return getApp().__weatherQA.storage[key] })
  await mock('setStorageSync', function(key, value) { getApp().__weatherQA.storage[key] = JSON.parse(JSON.stringify(value)) })
  await mock('showToast', { errMsg: 'showToast:ok' })
  await mini.evaluate(function(baseDate) {
    getApp().__weatherQA.originalCloud = wx.cloud.callFunction
    wx.cloud.callFunction = function(options) {
    const state = getApp().__weatherQA
    const data = options.data || {}
    state.requests.push(data.action)
    const route = { id: 'qa-route', title: '验收样例 · 大峰两日', updatedAt: '2026-10-27T01:00:00Z', points: [
      { id: 'start', name: '验收样例 · 登山口', coordinates: { lat: 31.0632, lng: 102.9085 }, ele: 3250 },
      { id: 'camp', name: '验收样例 · 营地', coordinates: { lat: 31.069, lng: 102.912 }, ele: 4250 },
    ] }
    let result = {}
    if (data.action === 'readRoutes') {
      if (state.deny) return Promise.resolve({ result: { ok: false, error: { code: 'FORBIDDEN', message: '验收样例：路线权限已撤回' } } })
      result = { route, routes: [Object.assign({ pointCount: 2, distanceKm: 12 }, route)], revision: 1 }
    } else if (data.action === 'getWeatherByPoint' || data.action === 'getWeather') {
      const series = []
      const days = []
      const times = []
      for (let day = 0; day < 7; day++) {
        const date = new Date(Date.parse(baseDate + 'T00:00:00Z') + day * 86400000).toISOString().slice(0, 10)
        days.push({ date, code: 2, tMax: 16, tMin: 4, precipProbMax: 35, cloud: { low: 20, mid: 40, high: 20 } })
        for (let hour = 0; hour < 24; hour++) {
          const time = String(hour).padStart(2, '0') + ':00'
          times.push(date + 'T' + time)
          series.push({ d: date, t: time, code: hour < 12 ? 2 : 61, temp: 8 + 6 * Math.sin(hour / 24 * Math.PI * 2), feels: 7, pop: 35,
            precip: hour > 14 ? 0.5 : 0, showers: hour > 14 ? 0.2 : 0, wind: 7 + hour / 4, gust: 14, windDir: 180,
            rh: 60, pressure: 650, visibility: 15000, uv: 3, cloud: { low: 20, mid: 40, high: 20, total: 60 }, band: null })
        }
      }
      const levels = [500, 1500, 2500, 3500, 4500, 5500, 6500].map((altitude, layer) => ({
        pressure: 1000 - layer * 100, altitudes: times.map(() => altitude), cloudCover: times.map((time, index) => {
          if (index % 24 === 8 || index % 24 === 9) return null
          const center = 3000 + 900 * Math.sin(index / 9)
          return Math.round(90 * Math.exp(-Math.pow((altitude - center) / 1200, 2)))
        }),
      }))
      result = { status: 'ready', updatedAt: new Date(Date.now() + (state.noCloud ? 1000 : 0)).toISOString(), pointElevation: 4250,
        days, detail: series.filter(hour => hour.d === (data.date || baseDate)), series,
        cloudLevels: state.noCloud ? null : { times, levels, unit: { altitude: 'm ASL', cloudCover: '%' } } }
    } else if (data.action === 'getSkyContext') {
      result = { spatial: null, terrain: null, atmosphere: null, lightPollution: null }
    } else if (data.action === 'dispatch') {
      return Promise.resolve({ result: { ok: false, error: { code: 'FORBIDDEN', message: '验收禁止写云端' } } })
    }
    return Promise.resolve({ result: { ok: true, data: result } })
    }
  }, today)
  let page = await mini.reLaunch('/pages/weather-hub/weather-hub')
  await page.waitFor(300)
  check('fresh mini-program bundle has two query scenarios', (await page.$('.weather-entry')) && (await page.$$('.weather-entry')).length === 2)
  check('native text discloses absent weather cloud sync', (await (await page.$('.stack-sections')).text()).includes('天气资产云同步尚未接入'))
  await shot('01-hub')
  await tap(page, '[bindtap="onManualOpen"]')
  await tap(page, '[bindtap="onManualSubmit"]')
  check('empty coordinate input visibly rejected', !!(await page.data()).manualError && (await page.data()).manualOpen)
  const inputs = await page.$$('input')
  await inputs[1].input('31.0632')
  await inputs[2].input('102.9085')
  await inputs[0].input('验收样例 · 大峰')
  await inputs[3].input('4250')
  await tap(page, '[bindtap="onManualSubmit"]')
  page = await waitPage('pages/weather/weather')
  const ready = await waitData(page, data => !data.loading && !data.loadingWeather && !!data.unified)
  check('manual query navigates to actual cloud detail', page.path === 'pages/weather/weather' && ready.weatherTab === 'cloud')
  check('cloud profile gate and gap metadata reached', ready.dayCards.length > 0 && ready.unified.gapCount === 2 && !ready.denied)
  await mini.pageScrollTo(650)
  await shot('02-cloud')
  await tap(page, '[data-window="high"]')
  check('cloud display window switches through tap', (await page.data()).cloudWindow === 'high')
  await tap(page, '[data-step="1"]')
  const selected = (await page.data()).selectedHourIndex
  check('next hour button updates linked readout', selected > 0 && !!(await page.data()).unified.r1)
  await (await page.$('.weather-time-controls picker')).trigger('change', { value: 8 })
  const gap = await waitData(page, data => data.selectedHourIndex === 8 && data.unified.r2.includes('缺测'))
  check('missing hour is not read as clear sky', !gap.unified.r3)
  await shot('03-cloud-missing')
  await tap(page, '[data-tab="hourly"]')
  check('hourly tab renders canvas and hides cloud profile', !!(await page.$('meteogram')) && !(await page.$('.cloud-field-card')))
  await mini.pageScrollTo(240)
  await shot('04-hourly')
  await tap(page, '[data-tab="sky"]')
  check('astronomy tab renders agenda, no weather chart', !!(await page.$('.agenda')) && !(await page.$('.cloud-field-card')) && !(await page.$('meteogram')))
  await shot('05-sky')
  page = await mini.reLaunch('/pages/weather-hub/weather-hub')
  await tap(page, '[bindtap="onRouteLibrary"]')
  await waitData(page, data => !data.routeLoading && data.routes.length > 0)
  await tap(page, '[bindtap="onChooseRoute"]')
  page = await waitPage('pages/weather-plan/weather-plan')
  const along = await waitData(page, data => !data.loading && !data.busy && data.rows.length > 0)
  check('library route opens along-route overview with hourly readings', page.path === 'pages/weather-plan/weather-plan' && along.rows.length === 2 && along.rows.every(row => row.weather.ready))
  check('GPX does not auto-fill itinerary arrival times', along.rows.every(row => !row.planned))
  await mini.pageScrollTo(0)
  await shot('06-along-route')
  await tap(page, '[bindtap="onEdit"]')
  await (await page.$$('.card .plan-controls picker'))[1].trigger('change', { value: '10:30' })
  await tap(page, '[bindtap="onSave"]')
  const saved = await waitData(page, data => !data.editing && !data.busy)
  check('arrival editor saves independent local itinerary', saved.saved && saved.rows[0].time === '10:30' && saved.rows[0].planned && !saved.rows[1].planned)
  await mini.pageScrollTo(0)
  await shot('07-plan-saved')
  await tap(page, '[bindtap="onCopy"]')
  check('copy starts a separate unsaved itinerary', (await page.data()).editing && !(await page.data()).saved && (await page.data()).plan.name.includes('副本'))
  await tap(page, '[bindtap="onCancelEdit"]')
  await tap(page, '[bindtap="onNode"]')
  page = await waitPage('pages/weather/weather')
  const nodeDetail = await waitData(page, data => !data.loading && !data.loadingWeather && !!data.unified && data.selectedTime.includes('10:00'))
  check('route node drilldown resolves stable node and arrival hour', nodeDetail.pointLabels[nodeDetail.pointIndex].includes('登山口') && nodeDetail.selectedTime.includes('10:00'))
  await mini.evaluate(() => { getApp().__weatherQA.deny = true })
  page = await mini.reLaunch('/pages/weather-plan/weather-plan?route=qa-route')
  const denied = await waitData(page, data => !data.loading && !!data.denied)
  check('revoked route permission blocks cached rows', denied.rows.length === 0 && !!(await page.$('status-panel')))
  await shot('08-permission-denied')
  await mini.evaluate(() => { getApp().__weatherQA.noCloud = true; getApp().__weatherQA.deny = false })
  page = await mini.reLaunch('/pages/weather/weather?src=local&lat=31.07&lng=102.92&name=QA-no-cloud')
  const noCloud = await waitData(page, data => !data.loading && !data.loadingWeather && data.dayCards.length > 0)
  check('no cloud data retains weather and explains unavailable profile', !noCloud.unified && !!(await page.$('status-panel')) && !(await page.$('.cloud-field-card')))
  await mini.pageScrollTo(300)
  await shot('09-cloud-unavailable')
  const state = await mini.evaluate(() => getApp().__weatherQA)
  check('no production cloud writes attempted', !state.requests.includes('dispatch'))
  check('local test plan is in isolated mock storage', Array.isArray(state.storage['ourtrail.weather-plans.v1']) && state.storage['ourtrail.weather-plans.v1'].length === 1)
}
run().catch(error => { evidence.failure = error.stack; console.error(error.stack); process.exitCode = 1 }).finally(async () => {
  fs.writeFileSync(root + '/readings.json', JSON.stringify(evidence, null, 2))
  if (mini) {
    for (const method of mocked.reverse()) { try { await mini.restoreWxMethod(method) } catch (_) {} }
    await mini.evaluate(() => { if (getApp().__weatherQA.originalCloud) wx.cloud.callFunction = getApp().__weatherQA.originalCloud; delete getApp().__weatherQA }).catch(() => {})
    await mini.switchTab('/pages/weather-hub/weather-hub').catch(() => {})
    await mini.disconnect()
  }
})
