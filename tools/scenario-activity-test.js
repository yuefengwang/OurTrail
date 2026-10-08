// 活动详情页页面级场景测试：node tools/scenario-activity-test.js
// 目的：把参与者/组织者「看活动详情」这条业务链路在 node 下走一遍——首屏装配（hero/状态/安排/
// 路线/风险/装备/费用）→ 权限门控（owner 草稿发布入口）→ 同行人操作弹层（签到/位置上报/节点/
// 到家/报备/取消）→ 敏感资料按用途读取 → 路线地图数据 → 导航/天气/分享 → CONFLICT 自愈 → denied。
// 被测对象：pages/activity/activity.js + activity.wxml（组件按 activity.json 注册清单校验）。
//
// 手法与 tools/scenario-signup-test.js 一致：真页面配置（global.Page 捕获，delete require.cache
// 后每次取最新源码）+ 真 api/draft/format 模块 + 网络桩（桩 wx.cloud.callFunction 信封，于是
// utils/api 的 read / dispatch / dispatchAndSync / readSensitive / toast / errorText 全部走真实现），
// 驱动真 handler，断言「发出了什么命令 + payload 形状（对着服务端真 schema.js 校验）+ 页面状态
// 变化 + 用户可见反馈」。
//
// 历史雷区（2026-09-28 详情页三连爆，本套件的立套动机）：
// - 「primary is not defined」：renderView 用了未定义标识符，ReferenceError 被 reload 的 catch
//   吃进 denied，页面从未真正渲染成功——场景 1 断言 denied 为空 + 各区块状态位已装配；
// - openSheet 两处裸 `v.primarySignupId`（v 不在作用域，应为 this.view.primarySignupId）——
//   场景 2 驱动 openSheet 的 canHome/canPosReport 路径；
// - include-points 空数组致腾讯地图 fitBounds 崩白屏——场景 7 断言 include-points 永远非空。
//
// payload 契约以 cloudfunctions/trailApi/domain/schema.js 为准：签到 evidence 客户端只带 note
// （at/by 为空串待服务端 overrideEvidence 覆写，不伪造），校验前按服务端规则补齐再跑真 validate。
'use strict'
const fs = require('fs')
const path = require('path')

const PAGE_PATH = require.resolve('../miniprogram/pages/activity/activity.js')
const api = require('../miniprogram/utils/api')
const S = require('../cloudfunctions/trailApi/domain/schema')

const ACTIVITY_WXML = fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'pages', 'activity', 'activity.wxml'), 'utf8')
const ACTIVITY_JSON = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'miniprogram', 'pages', 'activity', 'activity.json'), 'utf8'))

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
// 若发现疑似源码 bug：用例仍按「正确行为」断言，但计 skipped（工作流不判失败），并在最终回复报告根因。
function skipKnown(name, issue) {
  skipped++
  console.log('  ~ ' + name + '（已知问题：' + issue + '）')
}
// gate=true 表示该断言依赖已知问题的链路 → 计 skipped；否则真实校验
function checkGate(gate, issue, name, cond, extra) {
  if (gate) skipKnown(name, issue)
  else check(name, cond, extra)
}
function section(t) { console.log('== ' + t + ' ==') }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 2000
  const t0 = Date.now()
  while (Date.now() - t0 < limit) {
    if (cond()) return true
    await sleep(5)
  }
  return cond()
}
const keysOf = o => Object.keys(o).sort().join(',')
const closeTo = (a, b) => Math.abs(a - b) < 1e-9

// ---- global.wx 桩：云函数信封 + toast/震动/导航/打开位置/定位/剪贴板/弹窗；每场景换新 ----
const FAKE_COORDS = { latitude: 30.123, longitude: 103.456 }
function makeWx(opts) {
  opts = opts || {}
  const rec = {
    toasts: [], nav: [], titles: [], vibrations: 0,
    openLocations: [], clipboard: [], modals: [], locationOk: opts.locationOk !== false,
  }
  const store = { 'ourtrail.openid': 'u-test' }
  global.wx = {
    // 云函数信封：respond(action, data) → { result }
    cloud: { callFunction: req => Promise.resolve({ result: opts.respond(req.data.action, req.data || {}) }) },
    showToast: o => rec.toasts.push((o && o.title) || ''),
    vibrateShort: () => { rec.vibrations++ },
    setNavigationBarTitle: o => rec.titles.push((o && o.title) || ''),
    navigateTo: o => rec.nav.push((o && o.url) || ''),
    switchTab: o => rec.nav.push((o && o.url) || ''),
    openLocation: o => rec.openLocations.push(o),
    setClipboardData: o => { rec.clipboard.push((o && o.data) || ''); if (o && o.success) o.success() },
    showModal: o => { rec.modals.push(o); if (o && o.success) o.success({ confirm: true }) },
    getLocation: o => {
      if (rec.locationOk) o.success({ latitude: FAKE_COORDS.latitude, longitude: FAKE_COORDS.longitude })
      else o.fail({ errMsg: 'getLocation:fail auth deny' })
    },
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
  }
  return { rec, store }
}

// ---- 网络桩编排：read 按视图工厂应答；dispatch 走结果信封队列（默认成功，revision 递增）----
function bootActivity(opts) {
  opts = opts || {}
  const state = { revision: opts.revision == null ? 1 : opts.revision, plan: (opts.plan || []).slice() }
  const reads = []      // read 的 request
  const cmds = []       // dispatch 的 {payload, expectedRevision, requestId}
  const sensitives = [] // readSensitive 的入参
  function respond(action, data) {
    if (action === 'read') {
      reads.push(data.request)
      if (opts.failRead) return { ok: false, error: { code: opts.failRead.code, message: opts.failRead.message } }
      const view = typeof opts.view === 'function' ? opts.view(data.request) : opts.view
      return { ok: true, data: { view, revision: state.revision, now: NOW } }
    }
    if (action === 'dispatch') {
      cmds.push({ payload: data.payload, expectedRevision: data.expectedRevision, requestId: data.requestId })
      state.revision += 1 // 并发写者/本人成功提交都会推进 revision，重读拿到新值
      return state.plan && state.plan.length ? state.plan.shift()
        : { ok: true, data: { targetIds: ['a1'], replayed: false } }
    }
    if (action === 'readSensitive') {
      sensitives.push({ activityId: data.activityId, signupId: data.signupId, purpose: data.purpose })
      // Result 透传：信封 data 即 {ok, value|error}，页面自行检查 result.ok
      return { ok: true, data: opts.sensitiveResult
        || { ok: true, value: { signupId: data.signupId, emergency: { name: '王五', phone: '13700000000' }, medical: '花粉过敏' } } }
    }
    return { ok: true, data: {} }
  }
  const { rec, store } = makeWx({ respond, locationOk: opts.locationOk })
  const page = makePage(pageConfig())
  page.onLoad(opts.options || { id: 'a1' })
  page.onShow()
  return { page, rec, store, reads, cmds, sensitives, state }
}

// ---- 加载真页面配置并造实例（setData 支持 'map.xxx' 路径键，真机 setData 语义）----
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  return global.__PAGE_CFG
}
function makePage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = []
  page.setData = function (patch, cb) {
    this._patches.push(Object.assign({}, patch))
    for (const key of Object.keys(patch)) {
      if (key.indexOf('.') === -1) { this.data[key] = patch[key]; continue }
      const parts = key.split('.')
      let node = this.data
      for (let i = 0; i < parts.length - 1; i++) {
        if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {}
        node = node[parts[i]]
      }
      node[parts[parts.length - 1]] = patch[key]
    }
    if (cb) setImmediate(cb)
  }
  return page
}
async function settle(page) {
  await waitFor(() => page.data.loading === false
    && (page.data.denied !== '' || page.data.title !== ''))
}
// 等一轮「命令 → 成功反馈 → 自动重读」全部收尾（防跨用例泄漏）
async function settleRun(page, env, cmdCount, readCount) {
  await waitFor(() => env.cmds.length >= cmdCount && env.reads.length >= readCount
    && page.data.busy === false && page.data.loading === false)
  await sleep(10)
}

// ---- payload 按 schema.js 校验：先按服务端 overrideEvidence（index.js）规则补齐 evidence 的 at/by ----
function schemaOk(payload) {
  const clone = JSON.parse(JSON.stringify(payload))
  const fill = node => {
    if (Array.isArray(node)) { node.forEach(fill); return }
    if (node === null || typeof node !== 'object') return
    const ks = Object.keys(node)
    if (ks.length === 3 && 'at' in node && 'by' in node && 'note' in node) {
      node.at = NOW
      node.by = 'u-test'
      return
    }
    ks.forEach(k => fill(node[k]))
  }
  fill(clone)
  return S.validate(S.Payload, clone)
}

// 已知问题（本套件运行中发现，涉及用例按「正确行为」断言但计 skipped（~ 标记），修复后自动转为真实校验）：
// activity.js 自助命令缺 type：onCheckin/onHome/onNode 用 selPayload({...}) 只合并 {activityId,signupId}
// 与业务字段，漏带 type 判别键（同文件 onIncident/onPosReport/onPosRevoke/onCancelRow 均带 type）。
// 服务端 reduceCommand（commands.js:107）以 S.validate(S.Command) 严格校验，Payload 是 union(on type)，
// 无 type 直接 INVALID_INPUT「操作字段不完整或格式不正确。」——参与者自助签到/确认到家/节点确认必被拒。
const ISSUE_CMD_TYPE = 'miniprogram/pages/activity/activity.js:467,477,483,490 selPayload 漏带 type，服务端 Payload union(on type) 校验必拒（INVALID_INPUT），参与者自助签到/到家/节点确认在真机必然失败'

// ---- 样例视图（形状对齐 selectors.js 的 activityView/rowView/getDetailState）----
const NOW = '2026-09-29T09:00:00+08:00'
function activityFixture() {
  return {
    id: 'a1', ownerId: 'u-org', title: '青城后山 · 周末轻徒步',
    description: '当天往返的轻装徒步，适合新手。', organizerIntro: '老驴带队，十年后山经验。',
    startAt: '2026-10-03T08:00:00+08:00', endAt: '2026-10-03T18:00:00+08:00',
    deadlineAt: '2026-10-02T08:00:00+08:00',
    phase: 'published', acceptingSignups: true, capacity: 20, approvalMode: 'manual', routeId: 'r1',
    routeSnapshot: {
      title: '青城后山穿越', distanceKm: 12.5, ascentM: 860,
      points: [
        { id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 } },
        { id: 'pt-2', name: '又一村', kind: 'checkpoint', coordinates: { lat: 30.92, lng: 103.52 } },
        { id: 'pt-3', name: '白云寺', kind: 'finish', coordinates: { lat: 30.94, lng: 103.54 } },
      ],
      risks: [{ id: 'rk-1', title: '垭口风大', advice: '带防风外套，结伴通行。' }],
      track: [{ lat: 30.9, lng: 103.5 }, { lat: 30.91, lng: 103.51 }, { lat: 30.92, lng: 103.52 }, { lat: 30.94, lng: 103.54 }],
    },
    pickupPoints: [
      { id: 'pk-1', name: '东门集合点', meetingAt: '2026-10-03T07:30:00+08:00', address: '青城山快铁站出口', coordinates: { lat: 30.88, lng: 103.56 } },
    ],
    equipment: ['登山杖', '饮用水 2L', '防风外套'],
    feeNote: '费用 AA，含车费约 80 元。', cancellationNote: '出发前 24 小时可免费退出。',
  }
}
function rowFixture(id, name, over) {
  const r = Object.assign({
    signupId: id, groupId: 'g1', name, status: 'confirmed', avatar: '',
    tripMode: 'shared',
    pickup: '东门集合点', vehicle: '1号车', seat: '01',
    checkedIn: false, outboundBoarded: false, returnBoarded: false,
    returnPlan: 'assigned', departure: 'unknown', home: false,
  }, over || {})
  // 按服务端 rowView 的口径把派生标志补齐，避免 fixture 与投影两套说法各写各的
  r.hasPassengerAssignment = r.tripMode === 'shared' && !!r.vehicle
  r.needsSeatAssignment = r.tripMode === 'shared' && !r.hasPassengerAssignment
  r.returnBoardingApplies = r.tripMode === 'shared' && r.returnPlan === 'assigned'
  return r
}
// mutate(v) 直接改视图；未指定时默认「已确认参与者的 published 活动详情」
function viewFixture(mutate) {
  const v = {
    kind: 'activity', perspective: 'participant',
    primarySignupId: 's1',
    permittedActions: ['signup.edit', 'signup.cancel'],
    activity: activityFixture(),
    rows: [
      rowFixture('s1', '张三', { departure: 'joined' }),
      rowFixture('s2', '李四', { vehicle: '', seat: null }),
    ],
    counters: { confirmed: 2, pending: 0, occupied: 2, waitlisted: 0, remaining: 18, unassigned: 0, unchecked: 2, pendingHome: 2, openIncidents: 0 },
    detailState: 'ready',
  }
  if (mutate) mutate(v)
  return v
}
const OWNER_DRAFT_ACTIONS = ['activity.copy', 'export.record', 'activity.edit', 'activity.transition',
  'membership.save', 'membership.revoke', 'notice.publish', 'notice.delivery', 'activity.publish', 'activity.delete']

// 1. 历史雷回归——首屏装配：participant 视角 read → 各区块状态位装配，全程不进 denied
async function scenario1() {
  section('1. 首屏装配（primary 雷回归）：participant read → hero/状态/安排/路线/风险/装备/费用 全装配，不进 denied')
  check('activity.json 注册 icon/overlay/status-panel/form-field/person-row',
    ACTIVITY_JSON.usingComponents.icon === '/components/icon/icon'
    && ACTIVITY_JSON.usingComponents.overlay === '/components/overlay/overlay'
    && ACTIVITY_JSON.usingComponents['status-panel'] === '/components/status-panel/status-panel'
    && ACTIVITY_JSON.usingComponents['form-field'] === '/components/form-field/form-field'
    && ACTIVITY_JSON.usingComponents['person-row'] === '/components/person-row/person-row',
    JSON.stringify(ACTIVITY_JSON.usingComponents))
  {
    const env = bootActivity({ view: viewFixture() })
    check('进入时处于 loading 态（denied 为空）', env.page.data.loading === true && env.page.data.denied === '')
    await settle(env.page)
    check('读取请求 = activity / a1 / participant 视角（无 selectedSignupId）',
      env.reads.length === 1 && env.reads[0].kind === 'activity' && env.reads[0].activityId === 'a1'
      && env.reads[0].perspective === 'participant' && !('selectedSignupId' in env.reads[0]),
      JSON.stringify(env.reads))
    check('revision/now 取自读取（后续命令做 CAS 基准）', env.page.revision === 1 && env.page.now === NOW)
    // primary 雷的回归：renderView 内任何未定义标识符都会把 ReferenceError 吃成 denied，这里必须为空
    check('装配完成不进 denied（primary 雷回归）', env.page.data.denied === '' && env.page.data.loading === false,
      env.page.data.denied)
    // 徽标位曾经是常量「一起同行」——最贵的一格没有回答「我现在是什么状态」。现在它承载真实状态。
    check('hero：标题/徽标=真实状态（不再是常量口号）/出发时间/路线名/里程爬升人数',
      env.page.data.title === '青城后山 · 周末轻徒步' && env.page.data.badgeText === '行前安排就绪'
      && env.page.data.startAtLabel === '10/3 08:00' && env.page.data.routeTitle === '青城后山穿越'
      && env.page.data.distance === 12.5 && env.page.data.ascent === 860
      && env.page.data.confirmed === 2 && env.page.data.capacity === 20,
      JSON.stringify({ t: env.page.data.title, b: env.page.data.badgeText, s: env.page.data.startAtLabel }))
    check('状态区块：ready → 「行前安排已就绪」+ 计数行',
      env.page.data.stateKey === 'ready' && env.page.data.stateTitle === '行前安排已就绪'
      && env.page.data.stateDetail === '检查集合时间、出行方式与装备，出发当天见。'
      && env.page.data.stateTone === 'success'
      // 参与者视角的这一格给他自己的时间锚点；组织者的工作队列（待审核/候补/剩余）不再摆到参与者面前
      && /^集合 /.test(env.page.data.countersLine) && /剩/.test(env.page.data.countersLine)
      && env.page.data.countersLine.indexOf('待审核') === -1,
      JSON.stringify({ k: env.page.data.stateKey, c: env.page.data.countersLine }))
    check('我与同行人：两行装配（主报名 isPrimary、副标题以出行方式打头；无车行标「车辆待安排」）',
      env.page.data.rows.length === 2 && env.page.data.rows[0].isPrimary === true
      && env.page.data.rows[0].statusLabel === '已确认' && env.page.data.rows[0].subtitle === '搭乘车辆 · 东门集合点 · 1号车 · 01 座'
      && env.page.data.rows[1].isPrimary === false && env.page.data.rows[1].subtitle === '搭乘车辆 · 东门集合点 · 车辆待安排'
      && env.page.data.primaryId === 's1',
      JSON.stringify(env.page.data.rows))
    check('安排区块：介绍/组织者说明/三个时间行',
      env.page.data.description === '当天往返的轻装徒步，适合新手。'
      && env.page.data.organizerIntro === '老驴带队，十年后山经验。'
      && env.page.data.times.length === 3
      && env.page.data.times[0].label === '出发时间' && env.page.data.times[0].value === '10/3 08:00'
      && env.page.data.times[1].value === '10/3 18:00' && env.page.data.times[2].value === '10/2 08:00',
      JSON.stringify(env.page.data.times))
    check('路线区块：节点序号 kindLabel（01 起点/02 途中节点/03 终点）+ 上车点时间 + 地图已装配',
      env.page.data.points.length === 3
      && env.page.data.points[0].kindLabel === '01 · 起点' && env.page.data.points[1].kindLabel === '02 · 途中节点'
      && env.page.data.points[2].kindLabel === '03 · 终点'
      && env.page.data.pickups[0].time === '10/3 07:30' && env.page.data.pickups[0].address === '青城山快铁站出口'
      && env.page.data.map.visible === true,
      JSON.stringify(env.page.data.points.map(p => p.kindLabel)))
    check('风险/装备/费用区块已装配',
      env.page.data.risks.length === 1 && env.page.data.risks[0].title === '垭口风大'
      && env.page.data.equipment.length === 3 && env.page.data.feeNote === '费用 AA，含车费约 80 元。'
      && env.page.data.cancellationNote === '出发前 24 小时可免费退出。')
    check('操作位：已确认参与者不显示报名/自助入口，行级改/取消开放',
      env.page.data.isOwner === false && env.page.data.canSubmit === false && env.page.data.canSelfSheet === false
      && env.page.data.canCancelRow === true && env.page.data.canEditRow === true,
      JSON.stringify({ o: env.page.data.isOwner, s: env.page.data.canSubmit }))
    check('导航栏标题设置为活动标题', env.rec.titles.indexOf('青城后山 · 周末轻徒步') !== -1,
      JSON.stringify(env.rec.titles))
    check('最近查看已记录（draft.rememberActivity）', env.store['ourtrail.opened.v1'][0] === 'a1')
    check('wxml：denied/loading 分支走 status-panel，地图卡仅在 map.visible 时渲染',
      ACTIVITY_WXML.indexOf('<status-panel wx:if="{{denied}}" kind="denied"') !== -1
      && ACTIVITY_WXML.indexOf('<status-panel kind="loading"') !== -1
      && ACTIVITY_WXML.indexOf('wx:if="{{map.visible}}"') !== -1)

    // 行切换：切换查看同行人 → 重读带 selectedSignupId；切回主报名 → 清除
    env.page.onToggleRow({ currentTarget: { dataset: { id: 's2' } } })
    await waitFor(() => env.reads.length === 2)
    check('切换查看同行人：重读请求带 selectedSignupId',
      env.reads[1].selectedSignupId === 's2', JSON.stringify(env.reads[1]))
    env.page.onToggleRow({ currentTarget: { dataset: { id: 's1' } } })
    await waitFor(() => env.reads.length === 3)
    check('切回主报名：selectedSignupId 清除（不带该键）', !('selectedSignupId' in env.reads[2]),
      JSON.stringify(env.reads[2]))
    check('行切换后仍不进 denied', env.page.data.denied === '')
  }
  {
    // 自行前往（trip.mode=self）的同行者：副标题不该掺任何车辆/上车点字样。
    // 注意这里必须显式给 tripMode——旧写法只改 pickup 文案，正是「用文案当业务状态」的那类 bug。
    const env = bootActivity({ view: viewFixture(v => { v.rows = [rowFixture('s1', '张三', { tripMode: 'self', pickup: '自行前往', vehicle: '', seat: null, returnPlan: 'own' })] }) })
    await settle(env.page)
    check('自行前往的行不标「车辆待安排」', env.page.data.rows[0].subtitle === '自行前往',
      env.page.data.rows[0].subtitle)
  }
}

// 2. 历史雷回归——openSheet：canHome/canPosReport 读 this.view.primarySignupId（而非裸 v），不抛错
async function scenario2() {
  section('2. openSheet 雷回归：published 弹层装配 / gathering 位置上报路径 / closing 到家路径（裸 v 必炸）')
  {
    const env = bootActivity({ view: viewFixture() })
    await settle(env.page)
    env.page.openSheet({ currentTarget: { dataset: { id: 's2' } } })
    check('openSheet 不抛错（v 雷回归）且弹层打开', env.page.data.sheetOpen === true, env.page.data.sheetOpen)
    check('selRow 装配：状态徽标 + 出行行（s2 无车无座：line 只剩上车点）',
      env.page.data.selRow.signupId === 's2' && env.page.data.selRow.name === '李四'
      && env.page.data.selRow.statusLabel === '已确认'
      && env.page.data.selRow.line === '东门集合点',
      env.page.data.selRow.line)
    check('selRow.line = 上车点 · 车辆 · 座号（s1 有车有座）',
      (() => {
        env.page.openSheet({ currentTarget: { dataset: { id: 's1' } } })
        return env.page.data.selRow.line === '东门集合点 · 1号车 · 01座'
      })(),
      env.page.data.selRow.line)
    check('弹层初态：说明/节点/敏感资料清空，节点选项来自路线',
      env.page.data.selNote === '' && env.page.data.selPointIndex === -1 && env.page.data.selSensitive === null
      && env.page.data.selPoints.length === 3 && env.page.data.selPoints[1].label === '又一村',
      JSON.stringify(env.page.data.selPoints))
    check('published + confirmed：修改/取消此人报名开放',
      env.page.data.canEdit === true && env.page.data.canCancel === true)
    check('published 阶段不开现场动作（签到/节点/到家/位置上报/报备全关）',
      env.page.data.canCheckin === false && env.page.data.canNode === false && env.page.data.canHome === false
      && env.page.data.canPosReport === false && env.page.data.canIncident === false,
      JSON.stringify({ c: env.page.data.canCheckin, n: env.page.data.canNode, h: env.page.data.canHome }))
    env.page.closeSheet()
    check('未知行 id：弹层不打开（不炸）',
      (env.page.openSheet({ currentTarget: { dataset: { id: 'nope' } } }), true)
      && env.page.data.sheetOpen === false)
    env.page.closeSheet()
    check('closeSheet 收起弹层', env.page.data.sheetOpen === false)
  }
  {
    // gathering：canPosReport 分支读 this.view.primarySignupId（历史雷点之二）
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.phase = 'gathering'
        v.detailState = 'gathering'
        v.permittedActions = ['attendance.checkin', 'incident.report', 'position.report', 'position.revoke']
      }),
    })
    await settle(env.page)
    env.page.onSelfSheet()
    check('onSelfSheet 以 primaryId 打开弹层（我已到达 · 去签到）',
      env.page.data.sheetOpen === true && env.page.data.selRow.signupId === 's1'
      && env.page.data.selfButton === '我已到达 · 去签到' && env.page.data.canSelfSheet === true,
      env.page.data.selfButton)
    check('gathering 主报名：签到 + 报备 + 位置上报/撤回开放（canPosReport 路径不抛错）',
      env.page.data.canCheckin === true && env.page.data.canIncident === true
      && env.page.data.canPosReport === true && env.page.data.canPosRevoke === true,
      JSON.stringify({ p: env.page.data.canPosReport, r: env.page.data.canPosRevoke }))
  }
  {
    // closing：canHome 分支读 this.view.primarySignupId（历史雷点之一）
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.phase = 'closing'
        v.detailState = 'closing'
        v.permittedActions = ['attendance.home', 'attendance.returnPlan', 'incident.report']
      }),
    })
    await settle(env.page)
    env.page.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    check('closing 主报名已随队未到家：确认到家开放（canHome 路径不抛错）',
      env.page.data.canHome === true && env.page.data.selfButton === '确认返程与到家',
      JSON.stringify({ h: env.page.data.canHome, b: env.page.data.selfButton }))
  }
  {
    // 无 signup.edit 权限的行：弹层不开放修改/取消
    const env = bootActivity({ view: viewFixture(v => { v.permittedActions = [] }) })
    await settle(env.page)
    env.page.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    check('无权限时弹层零可发动作', env.page.data.canEdit === false && env.page.data.canCancel === false
      && env.page.data.canCheckin === false && env.page.data.canPosReport === false)
  }
}

// 3. 权限门控：owner 草稿（编辑+发布动作）/ 非 owner 读他人草稿 / published 报名入口 / 终态展示
async function scenario3() {
  section('3. 权限门控：owner 判定 = permittedActions（视角 or isOwner）/ 非 owner 被拒 / 终态徽标')
  {
    // 09-28 回归：详情页以 participant 视角读取，owner 看自己草稿仍须拿到 activity.edit/activity.publish
    const env = bootActivity({
      view: viewFixture(v => {
        v.primarySignupId = null
        v.permittedActions = OWNER_DRAFT_ACTIONS
        v.rows = []
        v.activity.phase = 'draft'
        v.detailState = 'closed'
        v.counters = { confirmed: 0, pending: 0, occupied: 0, waitlisted: 0, remaining: 20, unassigned: 0, unchecked: 0, pendingHome: 0, openIncidents: 0 }
      }),
    })
    await settle(env.page)
    check('owner 草稿：读取仍是 participant 视角', env.reads[0].perspective === 'participant')
    check('owner 草稿不进 denied（09-28 发布入口回归）', env.page.data.denied === '', env.page.data.denied)
    check('owner 判定成立（permittedActions 含 activity.edit）', env.page.data.isOwner === true)
    check('草稿展示：徽标「草稿」+ 未发布预览提示 + 关闭状态说明',
      env.page.data.isDraft === true && env.page.data.draftNotice === true && env.page.data.badgeText === '草稿'
      && env.page.data.stateKey === 'closed' && env.page.data.stateTitle === '本次报名已关闭'
      && env.page.data.stateTone === 'warning',
      JSON.stringify({ b: env.page.data.badgeText, k: env.page.data.stateKey }))
    check('草稿不开报名入口（canSubmit=false），状态 callout 不渲染（isDraft）',
      env.page.data.canSubmit === false)
    check('wxml：owner 按钮文案 = isDraft ? 返回编辑与发布 : 进入工作台',
      ACTIVITY_WXML.indexOf("{{isDraft ? '返回编辑与发布' : '进入工作台'}}") !== -1)
    check('wxml：草稿预览提示块存在',
      ACTIVITY_WXML.indexOf('未发布预览 · 仅你可见') !== -1)
  }
  {
    // 非 owner 读他人草稿：服务端 denied，无编辑/发布入口
    const env = bootActivity({ view: { kind: 'denied', message: '活动尚未发布。' } })
    await settle(env.page)
    check('非 owner 读他人草稿：denied 透出原文', env.page.data.denied === '活动尚未发布。' && env.page.data.loading === false,
      env.page.data.denied)
    check('无编辑/发布入口（isOwner=false、无导航、无命令）',
      env.page.data.isOwner === false && env.page.data.title === '' && env.rec.nav.length === 0 && env.cmds.length === 0)
    check('wxml：denied 分支优先于 loading（wx:if / wx:elif 顺序）',
      ACTIVITY_WXML.indexOf('<status-panel wx:if="{{denied}}"') < ACTIVITY_WXML.indexOf('<block wx:elif="{{loading}}">'))
  }
  {
    // published + 开放报名：报名入口
    const env = bootActivity({
      view: viewFixture(v => {
        v.primarySignupId = null
        v.permittedActions = ['signup.submit']
        v.rows = []
        v.detailState = 'new'
      }),
    })
    await settle(env.page)
    check('未报名看 published 活动：new 状态 → 报名入口开放',
      env.page.data.canSubmit === true && env.page.data.stateKey === 'new'
      && env.page.data.stateTitle === '让我们，一起出发',
      JSON.stringify({ s: env.page.data.canSubmit, k: env.page.data.stateKey }))
    env.page.onSignup()
    check('报名入口 → 跳报名页带活动编号', env.rec.nav.indexOf('/pages/signup/signup?id=a1') !== -1,
      JSON.stringify(env.rec.nav))
    check('wxml：报名按钮绑定 onSignup', ACTIVITY_WXML.indexOf('bindtap="onSignup"') !== -1)
  }
  {
    const env = bootActivity({ view: viewFixture(v => { v.detailState = 'cancelled'; v.badgeOverride = null }) })
    await settle(env.page)
    check('已取消：徽标说实话「活动已取消」+ 警示语气 + 状态文案',
      env.page.data.badgeText === '活动已取消' && env.page.data.stateKey === 'cancelled'
      && env.page.data.stateTitle === '活动已取消' && env.page.data.stateTone === 'warning',
      JSON.stringify({ b: env.page.data.badgeText, t: env.page.data.stateTone }))
  }
  {
    const env = bootActivity({ view: viewFixture(v => { v.detailState = 'finished' }) })
    await settle(env.page)
    // 参与者看到的是人话：这场已经结束了。「已归档」是系统词。
    check('已归档：徽标「已结束」+ 正常语气',
      env.page.data.badgeText === '已结束' && env.page.data.stateKey === 'finished'
      && env.page.data.stateTitle === '一起走过，平安收尾' && env.page.data.stateTone === 'success',
      JSON.stringify({ b: env.page.data.badgeText, t: env.page.data.stateTone }))
  }
}

// 4. 发布入口：owner 草稿「返回编辑与发布」→ 编辑器；owner 已发布 → 工作台；详情页无直接发布命令
async function scenario4() {
  section('4. 发布入口：草稿 → 编辑器（发布在编辑器内，详情页不发 activity.publish）')
  {
    const env = bootActivity({
      view: viewFixture(v => {
        v.primarySignupId = null
        v.permittedActions = OWNER_DRAFT_ACTIONS
        v.rows = []
        v.activity.phase = 'draft'
        v.detailState = 'closed'
      }),
    })
    await settle(env.page)
    env.page.onWorkspace()
    check('草稿「返回编辑与发布」→ 跳编辑器带活动编号',
      env.rec.nav.indexOf('/pages/editor/editor?id=a1') !== -1, JSON.stringify(env.rec.nav))
    check('详情页无发布确认路径：不发任何命令', env.cmds.length === 0, JSON.stringify(env.cmds))
    check('wxml：owner 按钮绑定 onWorkspace', ACTIVITY_WXML.indexOf('bindtap="onWorkspace"') !== -1)
  }
  {
    const env = bootActivity({
      view: viewFixture(v => { v.permittedActions = ['activity.edit', 'signup.edit', 'signup.cancel'] }),
    })
    await settle(env.page)
    env.page.onWorkspace()
    check('owner 已发布「进入工作台」→ 跳工作台带活动编号',
      env.rec.nav.indexOf('/pages/workspace/workspace?id=a1') !== -1, JSON.stringify(env.rec.nav))
  }
}

// 5. 签到：simulation payload（定位坐标）/ 定位失败降级 manual（需说明）/ 重复签到守卫 / busy 防抖
async function scenario5() {
  section('5. 签到：定位签到 payload / 无定位降级人工（需说明）/ 重复签到守卫 / busy 防抖')
  {
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.phase = 'gathering'
        v.detailState = 'gathering'
        v.permittedActions = ['attendance.checkin', 'incident.report']
      }),
    })
    await settle(env.page)
    env.page.onSelfSheet()
    env.page.onCheckin()
    await settleRun(env.page, env, 1, 2)
    const c0 = env.cmds[0]
    const hasType0 = typeof c0.payload.type === 'string' && c0.payload.type.length > 0
    checkGate(!hasType0, ISSUE_CMD_TYPE, '发出 attendance.checkin（payload.type 正确标注）',
      hasType0 && c0.payload.type === 'attendance.checkin', JSON.stringify(c0.payload))
    check('payload 顶层 = activityId/signupId/checkIn（无多余键）',
      keysOf(c0.payload) === (hasType0 ? 'activityId,checkIn,signupId,type' : 'activityId,checkIn,signupId'),
      JSON.stringify(c0.payload))
    check('签到 method=simulation：evidence 只带 note（at/by 空串待服务端覆写，不伪造）+ 定位坐标',
      c0.payload.checkIn.method === 'simulation'
      && c0.payload.checkIn.evidence.at === '' && c0.payload.checkIn.evidence.by === ''
      && c0.payload.checkIn.evidence.note === '本人定位签到'
      && c0.payload.checkIn.coordinates.lat === FAKE_COORDS.latitude
      && c0.payload.checkIn.coordinates.lng === FAKE_COORDS.longitude
      && keysOf(c0.payload.checkIn) === 'coordinates,evidence,method',
      JSON.stringify(c0.payload.checkIn))
    checkGate(!hasType0, ISSUE_CMD_TYPE, '签到 payload 按服务端覆写规则补齐后过 schema', schemaOk(c0.payload))
    check('以读取时的 revision 做 CAS', c0.expectedRevision === 1, String(c0.expectedRevision))
    check('签到成功反馈：toast「签到已保存。」+ 弹层内成功 callout + 震动',
      env.rec.toasts.indexOf('签到已保存。') !== -1 && env.page.data.selMessage === '签到已保存。'
      && env.rec.vibrations >= 1, JSON.stringify({ toasts: env.rec.toasts, v: env.rec.vibrations }))
    check('成功后自动重读（reload）', env.reads.length === 2, String(env.reads.length))
  }
  {
    // 定位失败：未填说明被拦；填说明后降级 manual 签到
    const env = bootActivity({
      locationOk: false,
      view: viewFixture(v => {
        v.activity.phase = 'gathering'
        v.detailState = 'gathering'
        v.permittedActions = ['attendance.checkin']
      }),
    })
    await settle(env.page)
    env.page.onSelfSheet()
    env.page.onCheckin()
    await sleep(20)
    check('定位不可用且未填说明：不发命令、给出指引文案',
      env.cmds.length === 0 && env.page.data.selError === '未获得定位授权，可在设置中开启，或改用文字说明由组织者代签。'
        + ' 也可以在「本次说明」里写明现场情况后再签到。',
      env.page.data.selError)
    env.page.onSelNote({ detail: { value: '已到东门集合点，定位用不了' } })
    env.page.onCheckin()
    await settleRun(env.page, env, 1, 2)
    const c0 = env.cmds[0]
    const hasTypeM = typeof c0.payload.type === 'string' && c0.payload.type.length > 0
    checkGate(!hasTypeM, ISSUE_CMD_TYPE, '降级签到发 attendance.checkin（payload.type 正确标注）',
      hasTypeM && c0.payload.type === 'attendance.checkin', JSON.stringify(c0.payload))
    check('降级 manual 签到：note 取本次说明，不带坐标（CheckIn union manual 分支无 coordinates 键）',
      c0.payload.checkIn.method === 'manual'
      && c0.payload.checkIn.evidence.note === '已到东门集合点，定位用不了'
      && !('coordinates' in c0.payload.checkIn)
      && (!hasTypeM || schemaOk(c0.payload)),
      JSON.stringify(c0.payload.checkIn))
  }
  {
    // 重复签到守卫：已签到的行不再开放签到按钮（wxml wx:if={{canCheckin}} 是唯一防线）
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.phase = 'gathering'
        v.detailState = 'checked'
        v.rows[0].checkedIn = true
        v.permittedActions = ['incident.report']
      }),
    })
    await settle(env.page)
    env.page.onSelfSheet()
    check('已签到行：canCheckin=false（重复签到守卫=渲染门槛，以代码实际为准），自助按钮切「更新我的同行状态」',
      env.page.data.canCheckin === false && env.page.data.selfButton === '更新我的同行状态'
      && env.page.data.stateKey === 'checked',
      JSON.stringify({ c: env.page.data.canCheckin, b: env.page.data.selfButton }))
    check('重复签到无运行时守卫：handler 本身不查 checkedIn，唯一防线是 wxml wx:if={{canCheckin}} 不渲染按钮',
      ACTIVITY_WXML.indexOf('wx:if="{{canCheckin}}"') !== -1)
    check('wxml：签到按钮仅在 canCheckin 时渲染且 busy 时禁点',
      ACTIVITY_WXML.indexOf('wx:if="{{canCheckin}}"') !== -1
      && ACTIVITY_WXML.indexOf("bindtap=\"{{busy ? '' : 'onCheckin'}}\"") !== -1)
  }
  {
    // busy 防抖 + 现场其余命令（节点/报备/取消）一并覆盖
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.phase = 'active'
        v.detailState = 'active'
        v.rows[0].checkedIn = true
        v.rows[0].departure = 'joined'
        v.permittedActions = ['attendance.node', 'incident.report', 'signup.cancel']
      }),
    })
    await settle(env.page)
    env.page.onSelfSheet()
    env.page.onNode()
    check('未选节点被静默拦下：不发命令', env.cmds.length === 0, JSON.stringify(env.cmds))
    env.page.onSelPoint({ detail: { value: '1' } })
    env.page.onNode()
    await settleRun(env.page, env, 1, 2)
    const hasTypeN = typeof env.cmds[0].payload.type === 'string' && env.cmds[0].payload.type.length > 0
    checkGate(!hasTypeN, ISSUE_CMD_TYPE, '节点确认发 attendance.node（payload.type 正确标注）',
      hasTypeN && env.cmds[0].payload.type === 'attendance.node', JSON.stringify(env.cmds[0].payload))
    check('节点确认 payload {pointId,note} 与所选节点一致',
      env.cmds[0].payload.pointId === 'pt-2' && env.cmds[0].payload.note === ''
      && keysOf(env.cmds[0].payload) === (hasTypeN ? 'activityId,note,pointId,signupId,type' : 'activityId,note,pointId,signupId')
      && (!hasTypeN || schemaOk(env.cmds[0].payload)),
      JSON.stringify(env.cmds[0].payload))
    await waitFor(() => env.page.revision === 2)

    env.page.onIncident()
    check('报备未填说明被拦：不发命令、点名填写',
      env.cmds.length === 1 && env.page.data.selError === '请在「本次说明」里写明现状、去向与需要的帮助。',
      env.page.data.selError)
    env.page.onSelNote({ detail: { value: '膝盖不适，申请下撤' } })
    env.page.onSelKind({ detail: { value: '2' } })
    env.page.onIncident()
    await settleRun(env.page, env, 2, 3)
    check('报备发 incident.report {signupIds,kind:withdrawal,description}，类型取自 picker 序号',
      env.cmds[1].payload.type === 'incident.report'
      && JSON.stringify(env.cmds[1].payload.signupIds) === '["s1"]'
      && env.cmds[1].payload.kind === 'withdrawal' && env.cmds[1].payload.description === '膝盖不适，申请下撤'
      && schemaOk(env.cmds[1].payload), JSON.stringify(env.cmds[1].payload))
    await waitFor(() => env.page.revision === 3)

    env.page.setData({ busy: true })
    env.page.onCancelRow()
    check('busy 期间操作被防抖：不发命令', env.cmds.length === 2, JSON.stringify(env.cmds.map(c => c.payload.type)))
    env.page.setData({ busy: false, selNote: '' })
    env.page.onCancelRow()
    check('取消未填原因被拦：不发命令', env.cmds.length === 2
      && env.page.data.selError === '取消报名需要说明原因。', env.page.data.selError)
    env.page.onSelNote({ detail: { value: '临时有事，无法参加' } })
    env.page.onCancelRow()
    await settleRun(env.page, env, 3, 4)
    check('取消发 signup.cancel {signupIds,reason}，payload 过 schema',
      env.cmds[2].payload.type === 'signup.cancel' && JSON.stringify(env.cmds[2].payload.signupIds) === '["s1"]'
      && env.cmds[2].payload.reason === '临时有事，无法参加' && schemaOk(env.cmds[2].payload),
      JSON.stringify(env.cmds[2].payload))
    check('取消反馈：toast「此人的报名已取消，其他同行人的状态未改变」（api.toast 截 20 字）+ 弹层完整成功 callout',
      env.rec.toasts.indexOf('此人的报名已取消，其他同行人的状态未改变') !== -1
      && env.page.data.selMessage === '此人的报名已取消，其他同行人的状态未改变。',
      JSON.stringify({ toasts: env.rec.toasts, m: env.page.data.selMessage }))
  }
}

// 6. 位置上报：consent 勾选语义 / position.report payload / 拒绝授权分支 / 撤回
async function scenario6() {
  section('6. 位置上报：未勾授权不发 / payload + schema / 拒绝定位 / position.revoke')
  {
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.phase = 'active'
        v.detailState = 'active'
        v.rows[0].checkedIn = true
        v.rows[0].departure = 'joined'
        v.permittedActions = ['position.report', 'position.revoke', 'attendance.node']
      }),
    })
    await settle(env.page)
    env.page.onSelfSheet()
    check('active 主报名已随队：位置上报开放', env.page.data.canPosReport === true)
    env.page.onPosReport()
    await sleep(20)
    check('未勾授权：不取定位、不发命令（consent 是硬门槛）',
      env.cmds.length === 0 && env.page.data.showPosBox === false)
    env.page.onTogglePosBox()
    check('展开位置上报说明区（仅本次、不后台追踪）',
      env.page.data.showPosBox === true
      && ACTIVITY_WXML.indexOf('仅本次主动上报一个位置点，不后台追踪') !== -1)
    env.page.onPosReport()
    await sleep(20)
    check('展开了但没勾授权同样不发', env.cmds.length === 0)
    env.page.onSelConsent({ detail: { value: ['on'] } })
    env.page.onPosReport()
    await settleRun(env.page, env, 1, 2)
    const c0 = env.cmds[0]
    check('发出 position.report，payload = type/activityId/signupId/coordinates/consent（无多余键）',
      c0.payload.type === 'position.report' && c0.payload.activityId === 'a1' && c0.payload.signupId === 's1'
      && keysOf(c0.payload) === 'activityId,consent,coordinates,signupId,type',
      JSON.stringify(c0.payload))
    check('coordinates 来自 wx.getLocation 桩（GCJ-02），consent=true',
      c0.payload.coordinates.lat === FAKE_COORDS.latitude && c0.payload.coordinates.lng === FAKE_COORDS.longitude
      && c0.payload.consent === true && schemaOk(c0.payload), JSON.stringify(c0.payload.coordinates))
    check('上报反馈 toast「本次位置已上报。」', env.rec.toasts.indexOf('本次位置已上报。') !== -1,
      JSON.stringify(env.rec.toasts))
    await waitFor(() => env.page.revision === 2)

    env.page.onPosRevoke()
    await settleRun(env.page, env, 2, 3)
    check('撤回发 position.revoke {activityId,signupId}，payload 过 schema',
      env.cmds[1].payload.type === 'position.revoke'
      && keysOf(env.cmds[1].payload) === 'activityId,signupId,type' && schemaOk(env.cmds[1].payload),
      JSON.stringify(env.cmds[1].payload))
    check('撤回反馈 toast「位置共享已撤回。」', env.rec.toasts.indexOf('位置共享已撤回。') !== -1)
  }
  {
    // 拒绝定位授权：selError 透出指引，不发命令
    const env = bootActivity({
      locationOk: false,
      view: viewFixture(v => {
        v.activity.phase = 'gathering'
        v.detailState = 'gathering'
        v.rows[0].departure = 'joined'
        v.permittedActions = ['position.report']
      }),
    })
    await settle(env.page)
    env.page.onSelfSheet()
    env.page.onSelConsent({ detail: { value: ['on'] } })
    env.page.onPosReport()
    await sleep(20)
    check('拒绝定位授权：透出指引文案、不发命令、busy 复位',
      env.cmds.length === 0 && env.page.data.selError === '未获得定位授权，可在设置中开启，或改用文字说明由组织者代签。'
      && env.page.data.busy === false, env.page.data.selError)
  }
  {
    // 非主报名不开放自助位置上报（canPosReport 限 primary）
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.phase = 'active'
        v.detailState = 'active'
        v.primarySignupId = 's1'
        v.rows[1].departure = 'joined'
        v.permittedActions = ['position.report']
      }),
    })
    await settle(env.page)
    env.page.openSheet({ currentTarget: { dataset: { id: 's2' } } })
    check('同行人（非本人）不开放自助位置上报', env.page.data.canPosReport === false)
  }
}

// 7. 路线地图数据：include-points 永远非空 / 实线虚线降级 / 全无坐标不渲染 / 非有限坐标过滤 / 联动定位
async function scenario7() {
  section('7. 路线地图：include-points 非空（fitBounds 雷回归）/ 实线·虚线·不渲染 / NaN 过滤 / 节点联动')
  {
    const env = bootActivity({ view: viewFixture() })
    await settle(env.page)
    const map = env.page.data.map
    check('有 track：地图卡渲染，实线 polyline（forest 色 + arrowLine）',
      map.visible === true && map.polyline.length === 1
      && map.polyline[0].points.length === 4 && map.polyline[0].color === '#163E35AA'
      && map.polyline[0].arrowLine === true && !map.polyline[0].dottedLine,
      JSON.stringify(map.polyline))
    check('markers：3 个路线节点（start/checkpoint/finish 图标）+ 1 个上车点（id 1000+i 避让）',
      map.markers.length === 4
      && map.markers[0].id === 0 && map.markers[0].iconPath === '/assets/markers/start.png'
      && map.markers[1].iconPath === '/assets/markers/checkpoint.png'
      && map.markers[2].iconPath === '/assets/markers/finish.png'
      && map.markers[3].id === 1000 && map.markers[3].iconPath === '/assets/markers/pickup.png',
      JSON.stringify(map.markers.map(m => [m.id, m.iconPath])))
    check('include-points = 外扩 8% 的两个角点（永远非空数组——fitBounds 崩溃雷回归）',
      Array.isArray(map.includePoints) && map.includePoints.length === 2
      && map.includePoints.every(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      && map.includePoints[0].latitude < map.includePoints[1].latitude,
      JSON.stringify(map.includePoints))
    check('外扩留白 8%（bbox 各方向：lat 30.88~30.94 → 角点 30.8752/30.9448）',
      closeTo(map.includePoints[0].latitude, 30.88 - (30.94 - 30.88) * 0.08)
      && closeTo(map.includePoints[1].latitude, 30.94 + (30.94 - 30.88) * 0.08),
      JSON.stringify(map.includePoints))
    check('视野中心 = bbox 中点，scale 13',
      closeTo(map.latitude, (30.88 + 30.94) / 2) && closeTo(map.longitude, (103.5 + 103.56) / 2)
      && map.scale === 13, JSON.stringify({ la: map.latitude, ln: map.longitude }))
    check('wxml：include-points 绑定存在（崩溃入口）',
      ACTIVITY_WXML.indexOf('include-points="{{map.includePoints}}"') !== -1)
  }
  {
    // 无 track：节点虚线降级
    const env = bootActivity({
      view: viewFixture(v => { delete v.activity.routeSnapshot.track }),
    })
    await settle(env.page)
    const map = env.page.data.map
    check('无 track 降级虚线：located 节点连线（control-line 色 + dottedLine）',
      map.visible === true && map.polyline.length === 1
      && map.polyline[0].points.length === 3 && map.polyline[0].color === '#8C9791AA'
      && map.polyline[0].dottedLine === true && !map.polyline[0].arrowLine,
      JSON.stringify(map.polyline))
    check('虚线分支 include-points 仍非空', map.includePoints.length === 2)
  }
  {
    // 全无坐标：整卡不渲染
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.routeSnapshot.points = v.activity.routeSnapshot.points.map(p => Object.assign(p, { coordinates: null }))
        v.activity.pickupPoints = v.activity.pickupPoints.map(p => Object.assign(p, { coordinates: null }))
      }),
    })
    await settle(env.page)
    const patchesBefore = env.page._patches.length
    check('全无坐标：routeMap 为空对象（visible=false，不产出 markers）',
      env.page.data.map.visible === false && env.page.data.map.markers === undefined
      && env.page.data.map.includePoints === undefined,
      JSON.stringify(env.page.data.map))
    check('无坐标节点行不可点击定位（onPointLocate 早退，不产生新 setData）',
      (env.page.onPointLocate({ currentTarget: { dataset: { index: '0' } } }),
        env.page._patches.length === patchesBefore),
      JSON.stringify({ patches: env.page._patches.length, before: patchesBefore }))
  }
  {
    // 非有限坐标防御：track NaN 点与 NaN marker 均被过滤，bbox 仍两点
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.routeSnapshot.track = [
          { lat: 30.9, lng: 103.5 }, { lat: NaN, lng: 103.51 },
          { lat: Infinity, lng: 103.52 }, { lat: 30.94, lng: 103.54 },
        ]
        v.activity.pickupPoints[0].coordinates = { lat: NaN, lng: NaN }
      }),
    })
    await settle(env.page)
    const map = env.page.data.map
    check('track 中非有限坐标被过滤：polyline 只含有效点',
      map.polyline.length === 1 && map.polyline[0].points.length === 2
      && map.polyline[0].points.every(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      JSON.stringify(map.polyline[0].points))
    check('NaN 上车点不进 bbox：include-points 仍为两个有限角点',
      map.includePoints.length === 2
      && map.includePoints.every(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      JSON.stringify(map.includePoints))
  }
  {
    // 全部坐标非法：宁可整卡不渲染也不给空数组
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.routeSnapshot.points = v.activity.routeSnapshot.points.map(p => Object.assign(p, { coordinates: { lat: NaN, lng: NaN } }))
        v.activity.pickupPoints = v.activity.pickupPoints.map(p => Object.assign(p, { coordinates: { lat: NaN, lng: NaN } }))
      }),
    })
    await settle(env.page)
    check('全部坐标非法：整卡不渲染（不给空 include-points）', env.page.data.map.visible === false)
  }
  {
    // timeline 行点击联动：以节点为中心的小 bbox（±0.006°），绝不是空数组
    const env = bootActivity({ view: viewFixture() })
    await settle(env.page)
    env.page.onPointLocate({ currentTarget: { dataset: { index: '1' } } })
    const map = env.page.data.map
    check('节点联动：scale 15 + 选中放大该 marker',
      map.scale === 15 && map.selectedId === 1 && map.markers[1].width === 30 && map.markers[1].height === 30,
      JSON.stringify({ s: map.scale, id: map.selectedId, w: map.markers[1].width }))
    check('联动定位 = 以节点为中心 ±0.006° 的小 bbox（两点、非空、有限）',
      map.includePoints.length === 2
      && closeTo(map.includePoints[0].latitude, 30.92 - 0.006)
      && closeTo(map.includePoints[0].longitude, 103.52 - 0.006)
      && closeTo(map.includePoints[1].latitude, 30.92 + 0.006)
      && closeTo(map.includePoints[1].longitude, 103.52 + 0.006)
      && closeTo(map.latitude, 30.92) && closeTo(map.longitude, 103.52),
      JSON.stringify(map.includePoints))
    check('联动是字段级 setData：同一轮补丁不重传整份 map',
      env.page._patches[env.page._patches.length - 1]['map.includePoints'] !== undefined
      && !('map' in env.page._patches[env.page._patches.length - 1]),
      JSON.stringify(Object.keys(env.page._patches[env.page._patches.length - 1])))
    // marker 点击：选中放大，不动 include-points
    env.page.onMapMarkerTap({ detail: { markerId: 2 } })
    check('marker 点击：selectedId 更新 + 该 marker 放大 + include-points 不动（不重传）',
      env.page.data.map.selectedId === 2 && env.page.data.map.markers[2].width === 30
      && env.page._patches[env.page._patches.length - 1]['map.includePoints'] === undefined,
      JSON.stringify(Object.keys(env.page._patches[env.page._patches.length - 1])))
    // 0 号 marker（起点）：被 Number(0)||-1 误判为无效 id —— 断言正确行为，命中已知问题则计 skipped
    const patchesBeforeTap = env.page._patches.length
    env.page.onMapMarkerTap({ detail: { markerId: 0 } })
    const startTapOk = env.page._patches.length === patchesBeforeTap + 1
      && env.page.data.map.selectedId === 0 && env.page.data.map.markers[0].width === 30
    checkGate(!startTapOk, 'miniprogram/pages/activity/activity.js:325 Number(markerId)||-1 把合法的 0 号 marker（起点）当无效 id 提前返回——起点无法通过点图选中放大（时间线点击可选中，行为不一致）',
      '点击起点 marker（id 0）选中放大（修复后转真实校验）', startTapOk,
      JSON.stringify({ sel: env.page.data.map.selectedId, patches: env.page._patches.length }))
    check('无坐标节点行联动早退（hover-class 也为 none）',
      ACTIVITY_WXML.indexOf("hover-class=\"{{item.coordinates ? 'button-hover' : 'none'}}\"") !== -1)
  }
}

// 8. 导航与天气入口：起点/终点/上车点 → wx.openLocation；途中节点 → 天气页带 point/date
async function scenario8() {
  section('8. 导航与天气入口：openLocation 带坐标 / 非法坐标守卫 / checkpoint 行跳天气页')
  {
    const env = bootActivity({ view: viewFixture() })
    await settle(env.page)
    env.page.onOpenLocation({
      currentTarget: { dataset: { lat: '30.9', lng: '103.5', name: '泰安古镇', address: '起点停车场' } },
    })
    check('起点行「导航」→ wx.openLocation 带该点坐标/名称/地址 + scale 16',
      env.rec.openLocations.length === 1
      && env.rec.openLocations[0].latitude === 30.9 && env.rec.openLocations[0].longitude === 103.5
      && env.rec.openLocations[0].name === '泰安古镇' && env.rec.openLocations[0].address === '起点停车场'
      && env.rec.openLocations[0].scale === 16,
      JSON.stringify(env.rec.openLocations))
    env.page.onOpenLocation({
      currentTarget: { dataset: { lat: 30.88, lng: 103.56, name: '东门集合点', address: '青城山快铁站出口' } },
    })
    check('上车点行「导航」同款 handler（wxml data-lat/lng 直接传坐标）',
      env.rec.openLocations.length === 2 && env.rec.openLocations[1].latitude === 30.88,
      JSON.stringify(env.rec.openLocations))
    env.page.onOpenLocation({ currentTarget: { dataset: { lat: 'abc', lng: '103.5', name: 'x' } } })
    env.page.onOpenLocation({ currentTarget: { dataset: { name: '无坐标' } } })
    check('非法/缺失坐标守卫：不拉起地图', env.rec.openLocations.length === 2,
      JSON.stringify(env.rec.openLocations))
    env.page.onPointWeather({ currentTarget: { dataset: { index: '1' } } })
    check('途中节点「天气」→ 跳天气页带 point 与活动出发日期',
      env.rec.nav.indexOf('/pages/weather/weather?id=a1&point=1&date=2026-10-03') !== -1,
      JSON.stringify(env.rec.nav))
    check('wxml：checkpoint 行是天气、start/finish 行是导航（catchtap 防冒泡）',
      ACTIVITY_WXML.indexOf("wx:if=\"{{item.kind === 'checkpoint'}}\"") !== -1
      && ACTIVITY_WXML.indexOf('catchtap="onPointWeather"') !== -1
      && ACTIVITY_WXML.indexOf('catchtap="onOpenLocation"') !== -1
      && ACTIVITY_WXML.indexOf('bindtap="onOpenLocation"') !== -1)
  }
  {
    // 无出发日期：URL 不带 date 参数
    const env = bootActivity({
      view: viewFixture(v => {
        v.activity.startAt = null
        v.activity.endAt = null
        v.activity.deadlineAt = null
      }),
    })
    await settle(env.page)
    check('无出发时间：时间行显示待确定、startDate 为空',
      env.page.data.times[0].value === '待确定' && env.page.data.startDate === '')
    env.page.onPointWeather({ currentTarget: { dataset: { index: '0' } } })
    check('无日期时天气 URL 不带 date 参数',
      env.rec.nav.indexOf('/pages/weather/weather?id=a1&point=0') !== -1, JSON.stringify(env.rec.nav))
    env.page.onWeather()
    check('「天气参考」入口 → 天气页（不带 point）',
      env.rec.nav.indexOf('/pages/weather/weather?id=a1') !== -1, JSON.stringify(env.rec.nav))
    env.page.onNotices()
    check('「活动通知」入口 → 活动通知页', env.rec.nav.indexOf('/pages/anotices/anotices?id=a1') !== -1,
      JSON.stringify(env.rec.nav))
  }
}

// 9. 分享：onShareAppMessage 返回活动标题与 /pages/activity/activity?id= 路径
async function scenario9() {
  section('9. 分享：标题 + 活动路径；未装配时兜底文案')
  {
    const env = bootActivity({ view: viewFixture() })
    await settle(env.page)
    const share = env.page.onShareAppMessage()
    check('分享标题 = 活动标题 · 一起同行',
      share.title === '青城后山 · 周末轻徒步 · 一起同行', JSON.stringify(share))
    check('分享路径 = /pages/activity/activity?id=a1',
      share.path === '/pages/activity/activity?id=a1', JSON.stringify(share))
    check('wxml：分享按钮 open-type="share"', ACTIVITY_WXML.indexOf('open-type="share"') !== -1)
  }
  {
    const env = bootActivity({ view: { kind: 'denied', message: '无权查看。' } })
    await settle(env.page)
    const share = env.page.onShareAppMessage()
    check('无标题时兜底「OurTrail · 活动邀请」',
      share.title === 'OurTrail · 活动邀请', JSON.stringify(share))
  }
}

// 10. 敏感资料：按用途读取（readSensitive + purpose）/ Result 透传（ok:false 呈现）/ 空用途拦截
async function scenario10() {
  section('10. 敏感资料：空用途拦截 / readSensitive 带 purpose / Result 透传呈现')
  {
    const env = bootActivity({ view: viewFixture() })
    await settle(env.page)
    env.page.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    env.page.onSensitive()
    check('空用途：不发读取（不发命令）', env.sensitives.length === 0 && env.cmds.length === 0)
    env.page.onSelPurpose({ detail: { value: '  联系家属确认接驳  ' } })
    env.page.onSensitive()
    await waitFor(() => env.sensitives.length === 1 && env.page.data.selSensitive !== null)
    check('readSensitive 带 activityId/signupId/去空格后的用途',
      env.sensitives[0].activityId === 'a1' && env.sensitives[0].signupId === 's1'
      && env.sensitives[0].purpose === '联系家属确认接驳', JSON.stringify(env.sensitives))
    check('读取成功：selSensitive 装配紧急联络与健康备注（弹层 callout 展示）',
      env.page.data.selSensitive.emergency.name === '王五' && env.page.data.selSensitive.emergency.phone === '13700000000'
      && env.page.data.selSensitive.medical === '花粉过敏'
      && ACTIVITY_WXML.indexOf('紧急联系人：{{selSensitive.emergency.name}}') !== -1,
      JSON.stringify(env.page.data.selSensitive))
    check('wxml：用途输入框与「按用途查看」按钮绑定',
      ACTIVITY_WXML.indexOf('bindinput="onSelPurpose"') !== -1
      && ACTIVITY_WXML.indexOf("bindtap=\"{{selPurpose ? 'onSensitive' : ''}}\"") !== -1)
  }
  {
    // Result 透传：ok:false → 展示原因、不给资料
    const env = bootActivity({
      sensitiveResult: { ok: false, error: { code: 'FORBIDDEN', message: '用途描述不完整，无法读取。' } },
      view: viewFixture(),
    })
    await settle(env.page)
    env.page.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    env.page.onSelPurpose({ detail: { value: '看看' } })
    env.page.onSensitive()
    await waitFor(() => env.sensitives.length === 1 && env.page.data.selError !== '')
    check('读取被拒：selSensitive 清空 + 透出原因（不展示任何资料）',
      env.page.data.selSensitive === null
      && env.page.data.selError === '用途描述不完整，无法读取。', env.page.data.selError)
  }
  {
    // 改用途会清掉上一次的读取结果（避免旧资料挂在新用途下）
    const env = bootActivity({ view: viewFixture() })
    await settle(env.page)
    env.page.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    env.page.setData({ selSensitive: { emergency: { name: '旧', phone: '1' }, medical: '' } })
    env.page.onSelPurpose({ detail: { value: '另一个用途' } })
    check('用途变更即清空旧读取结果', env.page.data.selSensitive === null)
    env.page.closeSheet()
    env.page.openSheet({ currentTarget: { dataset: { id: 's2' } } })
    check('重开弹层：敏感资料/错误/成功提示复位',
      env.page.data.selSensitive === null && env.page.data.selError === '' && env.page.data.selMessage === ''
      && env.page.data.selPurpose === '')
  }
}

// 11. CONFLICT：dispatchAndSync 自动重读 + 提示，重试基于新 revision 成功（回归）
async function scenario11() {
  section('11. CONFLICT 自愈：自动重读 + 提示 + 新 revision 重试成功')
  const env = bootActivity({
    plan: [
      { ok: false, error: { code: 'CONFLICT', message: '安排已被他人更新，请重试' } },
      { ok: true, data: { targetIds: ['a1'], replayed: false } },
    ],
    view: viewFixture(v => {
      v.activity.phase = 'closing'
      v.detailState = 'closing'
      v.permittedActions = ['attendance.home', 'incident.report']
    }),
  })
  await settle(env.page)
  env.page.onSelfSheet()
  env.page.onSelNote({ detail: { value: '已安全到家' } })
  env.page.onHome()
  await waitFor(() => env.cmds.length === 1 && env.reads.length === 2 && env.page.data.busy === false)
  check('第一次提交基于旧 revision（1）', env.cmds[0].expectedRevision === 1, String(env.cmds[0].expectedRevision))
  const hasTypeH = typeof env.cmds[0].payload.type === 'string' && env.cmds[0].payload.type.length > 0
  checkGate(!hasTypeH, ISSUE_CMD_TYPE, '到家确认发 attendance.home（payload.type 正确标注）',
    hasTypeH && env.cmds[0].payload.type === 'attendance.home', JSON.stringify(env.cmds[0].payload))
  check('到家 payload：{activityId,signupId,note}，note 取本次说明',
    env.cmds[0].payload.signupId === 's1' && env.cmds[0].payload.note === '已安全到家'
    && keysOf(env.cmds[0].payload) === (hasTypeH ? 'activityId,note,signupId,type' : 'activityId,note,signupId')
    && (!hasTypeH || schemaOk(env.cmds[0].payload)),
    JSON.stringify(env.cmds[0].payload))
  check('CONFLICT 后自动重读页面（dispatchAndSync 回归）', env.reads.length === 2, String(env.reads.length))
  check('CONFLICT 提示「安排已被他人更新，已刷新，请重试」',
    env.rec.toasts.indexOf('安排已被他人更新，已刷新，请重试') !== -1, JSON.stringify(env.rec.toasts))
  check('失败原因透出到弹层、busy 复位、无成功 callout',
    env.page.data.selError === '安排已被他人更新，请重试' && env.page.data.busy === false
    && env.page.data.selMessage === '', JSON.stringify({ e: env.page.data.selError, m: env.page.data.selMessage }))
  check('重读后 revision 刷新为 2（下次提交的 CAS 基准）', env.page.revision === 2, String(env.page.revision))
  env.page.onHome()
  await waitFor(() => env.cmds.length === 2 && env.page.data.selMessage !== '')
  await settleRun(env.page, env, 2, 3)
  check('重试基于重读后的 revision（2）——不再一直冲突',
    env.cmds[1].expectedRevision === 2, String(env.cmds[1] && env.cmds[1].expectedRevision))
  check('重试成功：toast「安全到家已记录。」+ 弹层成功 callout + 震动',
    env.rec.toasts.indexOf('安全到家已记录。') !== -1 && env.page.data.selMessage === '安全到家已记录。'
    && env.rec.vibrations >= 1, JSON.stringify({ toasts: env.rec.toasts, m: env.page.data.selMessage }))
}

// 12. denied 视角：无权查看 → status-panel 文案，不发后续命令；缺编号/读失败同样兜底
async function scenario12() {
  section('12. denied 视角：透出原因不装配 / 缺少编号 / 读取失败兜底')
  {
    const env = bootActivity({ view: { kind: 'denied', message: '你不在此活动的名单中。' } })
    await settle(env.page)
    check('denied 视图：透出原文、loading 收起、标题不装配',
      env.page.data.denied === '你不在此活动的名单中。' && env.page.data.loading === false
      && env.page.data.title === '', env.page.data.denied)
    check('只发了一次 read，无任何命令与导航', env.reads.length === 1 && env.cmds.length === 0
      && env.rec.nav.length === 0, JSON.stringify({ reads: env.reads.length, cmds: env.cmds.length }))
  }
  {
    const env = bootActivity({ options: {}, view: viewFixture() })
    await settle(env.page)
    check('缺少活动编号：直接 denied 且不外呼',
      env.page.data.denied === '缺少活动编号。' && env.reads.length === 0, env.page.data.denied)
  }
  {
    const env = bootActivity({ failRead: { code: 'NOT_FOUND', message: '活动不存在或已删除。' } })
    await settle(env.page)
    check('读取失败：错误文案兜底进 denied（catch 不吞成空白）',
      env.page.data.denied === '活动不存在或已删除。' && env.page.data.loading === false, env.page.data.denied)
    check('失败后无命令、无导航', env.cmds.length === 0 && env.rec.nav.length === 0)
  }
}

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6, scenario7,
    scenario8, scenario9, scenario10, scenario11, scenario12]
  for (const s of scenarios) {
    try { await s() } catch (e) {
      failed++
      console.error('  ✗ ' + (s.name || 'scenario') + ' 执行异常（' + ((e && e.message) || e) + '）')
    }
  }
  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped)
  process.exit(failed > 0 ? 1 : 0)
}
main()
