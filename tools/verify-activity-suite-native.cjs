const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { createWorld } = require('./lifecycle-harness')
const selectors = require('../cloudfunctions/trailApi/domain/selectors')
if (!process.env.MP_AUTOMATOR_PATH) throw new Error('MP_AUTOMATOR_PATH must point to an external installation')
const automator = require(process.env.MP_AUTOMATOR_PATH)
const output = process.env.ACTIVITY_QA_OUTPUT || '/tmp/ourtrail-activity-suite'
const report = { date: new Date().toISOString(), source: 'native renderer, production domain projections, isolated memory; all cloud writes blocked', checks: [], screenshots: [], errors: [] }
const world = createWorld({ now: '2026-10-28T10:00:00+08:00' })
for (const [user, name] of [['qa-owner', '样例领队'], ['qa-guest', '样例访客'], ['qa-member', '样例队友'], ['qa-staff', '样例协作者']]) {
  const person = { ...world.person(name), phone: '13800000000', emergency: { name: '样例紧急联系人', phone: '13900000000' } }
  assert.ok(world.dispatch(user, { type: 'profile.save', person }).ok)
}
const activityId = world.createActivity('qa-owner', {
  title: '验收样例 · 青城后山秋日徒步', description: '沿溪流走进山林，周末一起轻装出发。',
  startAt: '2026-10-31T08:00:00+08:00', endAt: '2026-10-31T17:00:00+08:00', deadlineAt: '2026-10-30T20:00:00+08:00',
  pickupPoints: [{ id: 'pk-1', name: '样例集合点 · 犀浦站', address: '地铁站 B 口外广场', meetingAt: '2026-10-31T07:30:00+08:00', coordinates: null }]
})
world.publish('qa-owner', activityId)
world.signup('qa-member', activityId, '样例队友', undefined, { keepPending: true })
const secondId = world.createActivity('qa-owner', {
  title: '验收样例 · 山间轻徒步', startAt: '2026-11-07T08:00:00+08:00', endAt: '2026-11-07T17:00:00+08:00', deadlineAt: '2026-11-06T20:00:00+08:00'
})
world.publish('qa-owner', secondId)
const vehicleId = world.vehicle('qa-owner', activityId, { drivers: [world.serviceDriver('样例司机', 'qa-owner')] })
assert.ok(world.dispatch('qa-owner', { type: 'membership.save', activityId, membership: { role: 'vehicle_contact', activityId, userId: 'qa-owner', vehicleId, expiresAt: '2026-11-08T20:00:00+08:00' } }).ok)
assert.ok(world.dispatch('qa-owner', { type: 'membership.save', activityId, membership: { role: 'staff', activityId, userId: 'qa-staff', scope: { kind: 'all' }, capabilities: ['roster', 'checkin'], expiresAt: '2026-11-08T20:00:00+08:00' } }).ok)
assert.ok(world.dispatch('qa-owner', { type: 'task.create', activityId, input: { title: '验收样例 · 出发前核对装备', note: '核对防滑鞋、雨衣和饮用水。', category: 'gear', assigneeName: '样例队友', dueAt: '2026-10-30T20:00:00+08:00' } }).ok)
assert.ok(world.dispatch('qa-owner', { type: 'notice.publish', activityId, audience: { kind: 'activity' }, content: '验收样例 · 请于 07:30 在集合点碰面，提前检查个人装备。' }).ok)
const requests = [{ kind: 'profile' }, { kind: 'discover' }, { kind: 'tasks', activityId }, { kind: 'notices', activityId }]
for (const perspective of ['participant', 'organizer', 'staff', 'vehicle']) {
  requests.push({ kind: 'home', perspective, openedActivityIds: [] })
  for (const targetId of [activityId, secondId]) requests.push({ kind: 'activity', perspective, activityId: targetId, vehicleId: perspective === 'vehicle' ? vehicleId : undefined })
}
const fixtures = {}
function key(request) { return [request.kind, request.perspective || '', request.activityId || ''].join(':') }
for (const actor of ['qa-owner', 'qa-guest', 'qa-staff']) {
  fixtures[actor] = { reads: {}, transport: world.readTransport(actor, activityId), noticeManagement: selectors.selectNoticeManagement(world.state, { userId: actor }, activityId, world.now) }
  for (const request of requests) fixtures[actor].reads[key(request)] = { view: world.read(actor, request), revision: world.state.revision, now: world.now }
}
let mini
function check(name, pass) {
  report.checks.push({ name, pass: !!pass })
  console.log((pass ? 'PASS ' : 'FAIL ') + name)
  assert.ok(pass, name)
}
async function ready(page, predicate) {
  const end = Date.now() + 15000
  while (Date.now() < end) {
    const data = await page.data()
    if (!data.loading && (!predicate || predicate(data))) return data
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Page not ready: ' + page.path)
}
async function navigated(expectedPath) {
  const end = Date.now() + 15000
  let page
  while (Date.now() < end) {
    page = await mini.currentPage()
    if (page && page.path === expectedPath) { await ready(page); return page }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Navigation did not reach ' + expectedPath + '; current: ' + (page && page.path))
}
async function tap(page, label, selector = '.button, .seg, .workspace-tool') {
  for (const element of await page.$$(selector)) {
    if ((await element.text()).trim().includes(label)) { await element.tap(); await page.waitFor(300); return }
  }
  throw new Error('Action not found: ' + label)
}
async function shot(page, name) {
  await page.waitFor(250)
  const data = await page.data()
  check(name + ' rendered without denial', !data.loading && !data.denied)
  if (process.env.EXPECT_ACTIVITY_UI) check(name + ' has activity UI scope', !!await page.$('.activity-ui'))
  const controls = []
  for (const element of await page.$$('.button, .workspace-tool, .seg')) {
    const size = await element.size()
    if (!Number(size.height)) continue
    controls.push({ text: await element.text(), size, offset: await element.offset(), radius: await element.style('border-radius'), font: await element.style('font-size') })
  }
  report.controls = report.controls || {}
  report.controls[name] = controls
  if (controls.length) check(name + ' measured controls are at least 44px and inside viewport', controls.every(control => Number(control.size.height) >= 44 && Number(control.offset.left) >= -1 && Number(control.offset.left) + Number(control.size.width) <= report.system.windowWidth + 1))
  await mini.screenshot({ path: path.join(output, name + '.png') })
  report.screenshots.push({ name: name + '.png', page: page.path })
}
async function main() {
  fs.mkdirSync(output, { recursive: true })
  mini = await automator.connect({ wsEndpoint: process.env.MP_WS_ENDPOINT || 'ws://127.0.0.1:9427' })
  mini.on('exception', error => report.errors.push(String(error.message || error)))
  report.system = await mini.systemInfo()
  await mini.evaluate(data => {
    const state = getApp().__activityQA = { fixtures: data, actor: 'qa-owner', storage: {}, writes: [], original: { cloud: wx.cloud.callFunction, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync } }
    wx.getStorageSync = name => name === 'ourtrail.openid' ? state.actor : state.storage[name] || ''
    wx.setStorageSync = (name, value) => { state.storage[name] = JSON.parse(JSON.stringify(value)) }
    wx.removeStorageSync = name => { delete state.storage[name] }
    wx.cloud.callFunction = options => {
      const request = options.data || {}
      const fixture = state.fixtures[state.actor]
      let result
      if (request.action === 'read') {
        const query = request.request
        const index = [query.kind, query.perspective || '', query.activityId || ''].join(':')
        result = fixture.reads[index]
        if (!result) return Promise.reject(new Error('QA has no read fixture: ' + index))
      } else if (request.action === 'readTransport') result = fixture.transport
      else if (request.action === 'readNoticeManagement') result = fixture.noticeManagement
      else if (request.action === 'getWeather' || request.action === 'getWeatherByPoint') result = { status: 'unavailable', reason: '验收样例不查询真实天气' }
      else if (request.action === 'readRoutes') result = { routes: [], now: '2026-10-28T10:00:00+08:00', revision: 1 }
      else {
        state.writes.push(request.action)
        return Promise.reject(new Error('QA blocks all writes and unexpected actions: ' + request.action))
      }
      return Promise.resolve({ result: { ok: true, data: result } })
    }
  }, fixtures)
  try {
    let page = await mini.reLaunch('/pages/home/home')
    let data = await ready(page)
    check('home has upcoming activity and list', !!data.nextUp && data.cards.length > 0)
    await shot(page, '01-home')
    await tap(page, '发现活动')
    page = await navigated('pages/discover/discover')
    check('discover navigation preserves destination', page.path === 'pages/discover/discover')
    await shot(page, '02-discover')
    let card
    for (const candidate of await page.$$('activity-card')) {
      if ((await candidate.data()).activityId === activityId) card = candidate
    }
    check('discover selected activity matches fixture', !!card)
    await (await card.$('.activity-card')).tap()
    page = await navigated('pages/activity/activity')
    check('activity card opens detail', page.path === 'pages/activity/activity')
    await shot(page, '03-detail')
    await tap(page, '进入工作台')
    page = await navigated('pages/workspace/workspace')
    check('owner action opens workspace', page.path === 'pages/workspace/workspace')
    await shot(page, '04-workspace')
    if (process.env.EXPECT_ACTIVITY_UI) {
      await mini.callWxMethod('pageScrollTo', { selector: '.workspace-tools', duration: 0 })
      await shot(page, '04b-workspace-tools')
      await tap(page, '任务清单', '.workspace-tool')
      page = await navigated('pages/tasks/tasks')
      check('navigation tile opens task list', page.path === 'pages/tasks/tasks')
      await tap(page, '新建任务', '.sticky-action .button')
      check('new task opens form without writing', (await page.data()).sheetOpen)
      await shot(page, '08b-task-sheet')
      await mini.navigateBack()
      page = await navigated('pages/workspace/workspace')
    }
    for (const [label, index, component] of [['名单', 1, 'roster-panel'], ['分车', 2, 'transport-panel'], ['现场', 3, 'field-panel']]) {
      await mini.pageScrollTo(0)
      await page.waitFor(250)
      await tap(page, label, '.seg')
      await ready(page, data => data.tab === index)
      const panel = await page.$(component)
      await ready(panel)
      check(label + ' panel retains readable data', !(await panel.data()).denied)
      await shot(page, '0' + (4 + index) + '-' + component)
    }
    for (const [name, route] of [['08-tasks', '/pages/tasks/tasks?id=' + activityId], ['09-notices', '/pages/anotices/anotices?id=' + activityId], ['10-vehicle', '/pages/vehicle/vehicle?id=' + activityId + '&vehicleId=' + vehicleId], ['11-editor', '/pages/editor/editor']]) {
      page = await mini.reLaunch(route)
      await ready(page)
      await shot(page, name)
      if (process.env.EXPECT_ACTIVITY_UI && name === '09-notices') {
        await tap(page, '发布活动通知')
        await ready(page, data => data.publishOpen)
        await shot(page, '09b-notice-sheet')
      }
      if (process.env.EXPECT_ACTIVITY_UI && name === '10-vehicle') {
        await tap(page, '返程', '.seg')
        check('vehicle direction switches without writing', (await page.data()).leg === 'return')
        await shot(page, '10b-vehicle-return')
      }
    }
    if (process.env.EXPECT_ACTIVITY_UI) {
      await mini.evaluate(() => { getApp().__activityQA.actor = 'qa-staff' })
      page = await mini.reLaunch('/pages/staff/staff?id=' + activityId)
      await ready(page)
      const field = await page.$('field-panel')
      await ready(field)
      check('staff page displays authorized field panel', !(await field.data()).denied)
      await shot(page, '14-staff')
    }
    await mini.evaluate(() => { getApp().__activityQA.actor = 'qa-guest'; getApp().__activityQA.storage = {} })
    page = await mini.reLaunch('/pages/signup/signup?id=' + activityId)
    data = await ready(page)
    check('signup preserves explicit consent', data.participants.every(person => !person.consent.dataUse))
    await shot(page, '12-signup')
    await tap(page, '提交报名', '.sticky-action .button')
    await page.waitFor(200)
    data = await page.data()
    check('signup without consent stays in form with only the consent error', page.path === 'pages/signup/signup' && Object.keys(data.errors || {}).join(',') === 'p0-dataUse')
    await shot(page, '13-signup-validation')
    if (process.env.EXPECT_ACTIVITY_UI) {
      await tap(page, '收起', '.button')
      await tap(page, '查看资料', '.signup-person-toggle')
      check('signup participant can expand without granting consent', Object.values((await page.data()).expandedParts).some(Boolean) && !(await page.data()).participants[0].consent.dataUse)
      await shot(page, '13b-signup-expanded')
      page = await mini.reLaunch('/pages/home/home')
      await ready(page)
      check('guest home explains no upcoming activity', !(await page.data()).nextUp)
      await shot(page, '15-home-empty')
      const invite = await page.$('next-up-card')
      check('empty home uses the new onboarding surface without a fabricated activity', !(await page.data()).hasAny && (await invite.data()).empty && !!await invite.$('.next-up-card__invite-media') && (await (await invite.$('.next-up-card__title')).text()).includes('下一次出发，从这里开始'))
      const inviteControls = []
      for (const control of await invite.$$('.button')) inviteControls.push({ text: await control.text(), size: await control.size(), offset: await control.offset() })
      report.controls['15-home-empty-component'] = inviteControls
      check('both empty-home actions are 48px, aligned and inside viewport', inviteControls.length === 2 && inviteControls.every(control => control.size.height === 48 && control.offset.left >= 0 && control.offset.left + control.size.width <= report.system.windowWidth) && Math.abs(inviteControls[0].offset.top - inviteControls[1].offset.top) < 1)
      await invite.callMethod('onInviteCoverError')
      check('empty-home image failure retains both actions and title', (await invite.data()).inviteCoverFailed && (await invite.$$('.button')).length === 2 && !!await invite.$('.next-up-card__title'))
      await shot(page, '15b-home-empty-image-fallback')
      await (await invite.$('.button.secondary')).tap()
      page = await navigated('pages/discover/discover')
      check('empty-home discover action opens real discovery page', page.path === 'pages/discover/discover' && (await page.data()).cards.length > 0)
      await mini.navigateBack()
      page = await navigated('pages/home/home')
      await (await (await page.$('next-up-card')).$('.button.primary')).tap()
      page = await navigated('pages/editor/editor')
      check('empty-home create action opens actual editor without writing', page.path === 'pages/editor/editor' && (await page.data()).step === 0)
    }
    report.blockedActions = await mini.evaluate(() => getApp().__activityQA.writes)
    check('no cloud writes attempted: ' + JSON.stringify(report.blockedActions), report.blockedActions.length === 0)
    check('no uncaught runtime exceptions', report.errors.length === 0)
  } finally {
    await mini.evaluate(() => {
      const original = getApp().__activityQA.original
      wx.cloud.callFunction = original.cloud
      wx.getStorageSync = original.get
      wx.setStorageSync = original.set
      wx.removeStorageSync = original.remove
      delete getApp().__activityQA
    })
    await mini.disconnect()
  }
}
main().catch(error => { report.failure = error.stack; console.error(error); process.exitCode = 1 }).finally(() => {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify(report, null, 2))
})
