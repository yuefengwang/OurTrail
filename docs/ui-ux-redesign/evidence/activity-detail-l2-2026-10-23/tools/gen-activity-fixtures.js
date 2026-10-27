// 从真实页面 renderView 生成注入夹具。
// 禁止手写页面 data：这里只造「服务端视图」（selectors.activityView 形状），
// 页面 data 一律由 miniprogram/pages/activity/activity.js 的 renderView 产出。
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '../../../../..')
const PAGE_PATH = path.join(ROOT, 'miniprogram/pages/activity/activity.js')
const OUT_ARG = (process.argv.find(a => a.indexOf('--out=') === 0) || '').slice('--out='.length)
const OUT_DIR = OUT_ARG ? path.resolve(ROOT, OUT_ARG) : path.resolve(__dirname, '../fixtures')

// 与服务端读取信封一致：read 返回 {ok,data:{view,revision,now}}。
// fixtureNow 固定，保证「今天/明天/截止」类文案稳定；执行日期另记在读数和 manifest。
const FIXTURE_NOW = '2026-09-29T09:00:00+08:00'
const REVISION = 7

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, limit) {
  const t0 = Date.now()
  while (Date.now() - t0 < (limit || 2000)) {
    if (cond()) return true
    await sleep(5)
  }
  return cond()
}

function makeWx(respond) {
  const store = { 'ourtrail.openid': 'u-fixture' }
  global.wx = {
    cloud: { callFunction: req => Promise.resolve({ result: respond(req.data.action, req.data || {}) }) },
    showToast: () => {},
    vibrateShort: () => {},
    setNavigationBarTitle: () => {},
    navigateTo: () => {},
    switchTab: () => {},
    openLocation: () => {},
    setClipboardData: o => { if (o && o.success) o.success() },
    showModal: o => { if (o && o.success) o.success({ confirm: true }) },
    hideShareMenu: () => {},
    getLocation: o => o.success({ latitude: 30.9, longitude: 103.5 }),
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
  }
}

function bootPage(view, load) {
  const respond = (action, data) => {
    if (action === 'getWeatherByPoint') return { ok: true, data: { status: 'out_of_range' } }
    if (action === 'read') {
      const v = typeof view === 'function' ? view(data.request) : view
      return { ok: true, data: { view: v, revision: REVISION, now: FIXTURE_NOW } }
    }
    return { ok: true, data: {} }
  }
  makeWx(respond)
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const cfg = global.__PAGE_CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) {
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
    if (cb) cb()
  }
  page.onLoad(Object.assign({ id: 'fixture-a1' }, load || {}))
  page.onShow()
  return page
}

async function settle(page) {
  await waitFor(() => page.data.loading === false && (page.data.denied !== '' || page.data.title !== ''))
  await sleep(30) // 让 weatherBrief 之类迟到回调落地，避免序列化到一半的 data
}

// ---- 视图夹具：形状对齐 domain/selectors.js 的 activityView ----
const LOCAL_COVER = '/assets/photos/cover-ridge.jpg' // 代替 cloud:// fileID 的渲染替身（见 manifest）

function row(id, name, over) {
  const r = Object.assign({
    signupId: id, groupId: 'g1', name, status: 'confirmed', avatar: '',
    tripMode: 'shared', pickupPointId: 'pk-1',
    pickup: '东门集合点', vehicle: '1号车', seat: '01',
    checkedIn: false, outboundBoarded: false, returnBoarded: false,
    returnPlan: 'assigned', departure: 'joined', home: false,
  }, over || {})
  r.hasPassengerAssignment = r.tripMode === 'shared' && !!r.vehicle
  r.needsSeatAssignment = r.tripMode === 'shared' && !r.hasPassengerAssignment
  r.returnBoardingApplies = r.tripMode === 'shared' && r.returnPlan === 'assigned'
  return r
}

function activity(over) {
  return Object.assign({
    id: 'fixture-a1', ownerId: 'u-org', title: '青城后山 · 周末轻徒步',
    description: '当天往返的轻装徒步，适合新手。走完泰安古镇到白云寺的老路，全程林下，夏天也凉快。',
    organizerIntro: '老驴带队，十年后山经验。',
    startAt: '2026-10-03T08:00:00+08:00', endAt: '2026-10-03T18:00:00+08:00',
    deadlineAt: '2026-10-02T08:00:00+08:00',
    phase: 'published', acceptingSignups: true, capacity: 20, minParticipants: 3,
    approvalMode: 'manual', routeId: 'r1',
    coverFileId: LOCAL_COVER,
    routeSnapshot: {
      title: '青城后山穿越', distanceKm: 12.5, ascentM: 860, difficulty: 'moderate',
      points: [
        { id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 }, ele: 700 },
        { id: 'pt-2', name: '又一村', kind: 'checkpoint', coordinates: { lat: 30.92, lng: 103.52 }, ele: 900 },
        { id: 'pt-3', name: '白云寺', kind: 'finish', coordinates: { lat: 30.94, lng: 103.54 }, ele: 860 },
      ],
      risks: [{ id: 'rk-1', title: '垭口风大', advice: '带防风外套，结伴通行。' }],
      track: [
        { lat: 30.9, lng: 103.5, ele: 700 },
        { lat: 30.91, lng: 103.51, ele: 780 },
        { lat: 30.92, lng: 103.52, ele: 900 },
        { lat: 30.94, lng: 103.54, ele: 860 },
      ],
    },
    pickupPoints: [
      { id: 'pk-1', name: '东门集合点', meetingAt: '2026-10-03T07:30:00+08:00', address: '青城山快铁站出口', coordinates: { lat: 30.88, lng: 103.56 } },
    ],
    equipment: ['登山杖', '饮用水 2L', '防风外套'],
    equipmentSuggested: ['备用袜', '防晒'],
    feeNote: '费用 AA，含车费约 80 元。', cancellationNote: '出发前 24 小时可免费退出。',
    signupNote: '报名后请把紧急联系人填完整，出发前一天会在群里发集合提醒。',
  }, over || {})
}

function view(over) {
  const v = {
    kind: 'activity', perspective: 'participant', primarySignupId: 's1',
    permittedActions: ['signup.edit', 'signup.cancel'],
    activity: activity(),
    rows: [
      row('s1', '张三', { departure: 'joined' }),
      row('s2', '李四', { vehicle: '', seat: null }),
      row('s3', '王五', { vehicle: '2号车', seat: '02', pickupPointId: 'pk-1' }),
    ],
    counters: { confirmed: 2, pending: 0, occupied: 2, waitlisted: 0, remaining: 18, unassigned: 0, unchecked: 2, pendingHome: 2, openIncidents: 0 },
    detailState: 'ready',
  }
  return Object.assign(v, over || {})
}

const LONG_TITLE = '青城后山泰安古镇经又一村至白云寺环线轻装徒步暨秋季山脊云海观测与同行者集合出发安排说明会'
  + '（含备用路线与雨天改线方案，请务必阅读集合时间、装备清单与退出规则后再报名）'
  + '这是一个用于验证极值换行与不截断的超长标题样例，长度已超过一百个汉字，不应出现省略号或横向溢出。'

const OWNER_ACTIONS = ['activity.copy', 'export.record', 'activity.edit', 'activity.transition',
  'membership.save', 'membership.revoke', 'notice.publish', 'notice.delivery', 'activity.publish', 'activity.delete']

const SCENARIOS = {
  rich: { view: view(), title: '青城后山 · 周末轻徒步' },
  sparse: {
    title: '城区周边 · 傍晚散步',
    view: view({
      activity: activity({
        title: '城区周边 · 傍晚散步',
        description: '', organizerIntro: '',
        endAt: '', deadlineAt: '',
        capacity: 6, minParticipants: 0, coverFileId: '',
        routeSnapshot: { title: '滨江步道', distanceKm: 0, ascentM: 0, difficulty: '', points: [], risks: [], track: [] },
        pickupPoints: [], equipment: [], equipmentSuggested: [],
        feeNote: '', cancellationNote: '', signupNote: '',
      }),
      rows: [],
      primarySignupId: '',
      counters: { confirmed: 1, pending: 0, occupied: 1, waitlisted: 0, remaining: 5, unassigned: 0, unchecked: 1, pendingHome: 0, openIncidents: 0 },
    }),
  },
  'long-title': {
    title: LONG_TITLE,
    view: view({
      activity: activity({
        title: LONG_TITLE,
        routeSnapshot: Object.assign(activity().routeSnapshot, {
          title: '青城后山泰安古镇—又一村—白云寺—翠映湖—飞泉沟—五龙沟环线（备用下撤路线：金骊索道）',
        }),
      }),
    }),
  },
  // 标题与 rich 不同：相邻场景标题相同即污染自证失败（BASELINE §4.4）。
  'cover-failed': { view: view({ activity: activity({ title: '青城后山 · 雨天备案' }) }), title: '青城后山 · 雨天备案', after: 'fallback-error' },
  // S2 专用：节点带轨迹时间（第1天 08:00 / 第1天 10:30 / 无时间信息）、
  // 必带 7 项 + 建议 3 项（四列必然换行 4+3）、费用三段齐全。
  's2-rich': {
    title: '青城后山 · 九月同行',
    view: view({
      activity: activity({
        title: '青城后山 · 九月同行',
        routeSnapshot: Object.assign(activity().routeSnapshot, {
          points: [
            { id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 }, ele: 700, time: '2026-09-01T00:00:00.000Z' },
            { id: 'pt-2', name: '又一村', kind: 'checkpoint', coordinates: { lat: 30.92, lng: 103.52 }, ele: 900, time: '2026-09-01T02:30:00.000Z' },
            { id: 'pt-3', name: '白云寺', kind: 'finish', coordinates: { lat: 30.94, lng: 103.54 }, ele: 860 },
          ],
        }),
        equipment: ['登山杖', '饮用水 2L', '防风外套', '头灯', '雨衣', '路餐', '急救包'],
        equipmentSuggested: ['备用袜', '防晒', '充电宝'],
        feeSummary: '费用 AA，含往返车费与景区门票。',
        feeIncludes: ['往返车费', '景区门票', '公共装备损耗'],
        feeExcludes: ['个人餐饮', '个人保险'],
        feeNote: '出发当天在集合点统一收齐，多退少补。',
      }),
    }),
  },
  // ---- S3 底栏状态矩阵：每个状态各一份生产形状的 data ----
  'participant-bottom': {
    title: '青城后山 · 同行者视角',
    view: view({ activity: activity({ title: '青城后山 · 同行者视角' }) }),
  },
  'owner-bottom': {
    title: '青城后山 · 组织者视角',
    view: view({
      perspective: 'owner',
      permittedActions: OWNER_ACTIONS,
      activity: activity({ title: '青城后山 · 组织者视角' }),
    }),
  },
  'draft-bottom': {
    title: '青城后山 · 草稿预览',
    view: view({
      perspective: 'owner',
      permittedActions: OWNER_ACTIONS,
      activity: activity({ title: '青城后山 · 草稿预览', phase: 'draft' }),
    }),
  },
  'signup-bottom': {
    title: '青城后山 · 开放报名',
    view: view({
      permittedActions: ['signup.submit'],
      primarySignupId: '',
      rows: [],
      detailState: 'new',
      counters: { confirmed: 0, pending: 0, occupied: 0, waitlisted: 0, remaining: 20, unassigned: 0, unchecked: 0, pendingHome: 0, openIncidents: 0 },
      activity: activity({ title: '青城后山 · 开放报名' }),
    }),
  },
  'confirmed-bottom': {
    title: '青城后山 · 集合日',
    view: view({
      detailState: 'gathering',
      activity: activity({ title: '青城后山 · 集合日' }),
    }),
  },
  'justPublished-bottom': {
    title: '青城后山 · 发布成功',
    load: { published: '1' },
    view: view({
      perspective: 'owner',
      permittedActions: OWNER_ACTIONS,
      activity: activity({ title: '青城后山 · 发布成功' }),
    }),
  },
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const manifest = {
    generatedAt: new Date().toISOString(),
    label: (process.argv.find(a => a.indexOf('--label=') === 0) || '').slice('--label='.length) || 'worktree',
    fixtureNow: FIXTURE_NOW,
    gitHead: require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
    source: 'miniprogram/pages/activity/activity.js#renderView',
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(PAGE_PATH)).digest('hex'),
    coverFileIdStandIn: LOCAL_COVER,
    note: '页面 data 全部由真实 renderView 产出；视图夹具只填服务端投影字段。coverFileId 用本地实拍图代替 cloud:// fileID（渲染路径等价，非线上数据形状）。',
    scenarios: {},
  }
  for (const name of Object.keys(SCENARIOS)) {
    const s = SCENARIOS[name]
    const page = bootPage(s.view, s.load)
    await settle(page)
    if (page.data.denied || page.data.loading) throw new Error(name + ': 页面未完成装配 ' + page.data.denied)
    if (s.after === 'fallback-error') page.onFallbackCoverError()
    if (s.after === 'fallback-error') await sleep(10)
    if (page.data.title !== s.title) throw new Error(name + ': 标题哨兵不符 ' + page.data.title)
    const data = JSON.parse(JSON.stringify(page.data))
    fs.writeFileSync(path.join(OUT_DIR, name + '.json'), JSON.stringify(data, null, 2) + '\n')
    manifest.scenarios[name] = {
      title: data.title,
      coverFailed: data.coverFailed,
      coverIsReal: data.coverIsReal,
      infoFacts: Array.isArray(data.infoFacts) ? data.infoFacts.length : null,
      routeStats: Array.isArray(data.routeStats) ? data.routeStats.map(x => x.key) : null,
      rows: Array.isArray(data.rows) ? data.rows.length : null,
      photoNote: data.photoNote,
      dataSha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'),
    }
    console.log('✓', name, 'infoFacts=' + manifest.scenarios[name].infoFacts,
      'routeStats=' + (manifest.scenarios[name].routeStats || []).length, 'coverFailed=' + data.coverFailed)
  }
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log('manifest →', path.join(OUT_DIR, 'manifest.json'))
}

main().catch(e => { console.error(e); process.exit(1) })
