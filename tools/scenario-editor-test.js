// 编辑器页面级场景测试：node tools/scenario-editor-test.js
// 目的：把组织者「建活动 → 编辑 → 发布」这条业务链路在 node 下走一遍——
// 真页面配置（global.Page 捕获）+ 真草稿/格式化/GPX 模块 + 网络桩（覆写 utils/api 的同名导出），
// 驱动真 handler，断言「发出了什么命令 + payload 形状 + 页面状态变化 + 用户可见反馈」。
//
// 手法与 tools/weather-page-test.js 一致：setData 记录进 _patches 并同步 this.data，
// setData 回调经 setImmediate 异步触发；wx storage 用内存对象桩（draft.js 走 wx storage）。
// editor.js 持有的是 api 模块对象本身（const api = require(...) 后 api.foo()），覆写属性即生效。
'use strict'
const EDITOR_PATH = require.resolve('../miniprogram/pages/editor/editor.js')
const api = require('../miniprogram/utils/api')
const draft = require('../miniprogram/utils/draft')
// 云侧输入契约：GPX/编辑器产出的 payload 直接对真 schema 严检（同 weather-page-test 的跨检手法）
const S = require('../cloudfunctions/trailApi/domain/schema.js')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function skipKnown(name, where, why) {
  skipped++
  console.log('  ~ ' + name + '（已知问题 ' + where + '：' + why + '）')
}
function section(t) { console.log('== ' + t + ' ==') }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 1500
  const t0 = Date.now()
  while (Date.now() - t0 < limit) {
    if (cond()) return true
    await sleep(5)
  }
  return cond()
}
// 等编辑器 reload（草稿 + 可选的服务器读）完成
async function settle(page) { await waitFor(() => page.data.loading === false) }

// picker/input 类 handler 的合成事件（WXML 绑定 data-key → onDate/onTime/onField）
function ev(key, value) { return { currentTarget: { dataset: { key } }, detail: { value } } }

// ---- wx 桩：内存 storage + toast/导航记录；按场景换新，互不串味 ----
function makeWx(over) {
  const store = { 'ourtrail.openid': 'u-test' }
  const rec = { toasts: [], nav: [], scrolls: [] }
  const wx = Object.assign({
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push((o && o.title) || ''),
    navigateTo: o => rec.nav.push((o && o.url) || ''),
    redirectTo: o => rec.nav.push((o && o.url) || ''),
    switchTab: o => rec.nav.push((o && o.url) || ''),
    pageScrollTo: o => rec.scrolls.push(o),
    chooseLocation: () => {},
    vibrateShort: () => {},
  }, over || {})
  return { wx, store, rec }
}

// 加载真页面配置（global.Page 捕获；每次取最新源码，避免吃到缓存的旧实现）
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[EDITOR_PATH]
  require(EDITOR_PATH)
  return global.__PAGE_CFG
}

// 页面实例：数据同步并入 this.data，setData 回调像真机一样异步触发
function makePage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = []
  page.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  return page
}

// 装一台编辑器：wx 桩 + api 网络桩 + 真页面 onLoad。opts: {options, views, seed, wx, targetIds}
function bootEditor(opts) {
  opts = opts || {}
  const env = makeWx(opts.wx)
  global.wx = env.wx
  if (opts.seed) opts.seed(env)
  const cmds = [] // dispatchAndSync 记录（发出的命令 + payload）
  const reads = []
  api.read = req => {
    reads.push(req)
    if (opts.views && opts.views[req.kind]) return Promise.resolve(opts.views[req.kind])
    if (req.kind === 'profile') return Promise.resolve({
      view: { kind: 'profile', profile: { id: 'p1', person: { name: '张三', phone: '13800000000' } } },
      revision: 7,
    })
    if (req.kind === 'home') return Promise.resolve({ view: { kind: 'home', activities: [] }, revision: 1 })
    return Promise.resolve({ view: { kind: 'denied', message: '无权访问' }, revision: 1 })
  }
  api.dispatchAndSync = (payload, revision) => {
    cmds.push({ payload, revision })
    return Promise.resolve({ targetIds: opts.targetIds || ['act-new'], revision: (revision || 0) + 1 })
  }
  // 路线库快速带入：列表与单条详情都是真读取契约的桩，不是页面内复制一份。
  api.readRoutes = id => {
    if (id) return Promise.resolve(opts.routeDetail || { route: null })
    return Promise.resolve({ routes: opts.routes || [] })
  }
  const page = makePage(pageConfig())
  page.onLoad(opts.options || {})
  return { page, cmds, reads, env }
}

// ---- 样例数据（ActivityInput 形状 = buildInput 的产出形状）----
function sampleInput() {
  return {
    title: '青城后山 · 周末轻徒步',
    description: '慢节奏',
    organizerIntro: '老王带队',
    startAt: '2026-10-03T08:00:00+08:00',
    endAt: '2026-10-03T16:00:00+08:00',
    deadlineAt: '2026-10-02T08:00:00+08:00',
    acceptingSignups: true, capacity: 20, approvalMode: 'manual', routeId: null,
    routeSnapshot: {
      title: '飞泉沟环线', distanceKm: 12.5, ascentM: 900,
      points: [
        { id: 'pt-1', name: '起点', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 }, time: '2026-09-01T01:00:00.000Z', ele: 700 },
        { id: 'pt-2', name: '终点', kind: 'finish', coordinates: { lat: 31.0, lng: 103.6 } },
      ],
      risks: [{ id: 'rk-1', title: '垭口风大', advice: '备防风衣物' }],
    },
    pickupPoints: [
      { id: 'pk-1', name: '犀浦站', address: '地铁 A 口', meetingAt: '2026-10-03T07:30:00+08:00', coordinates: { lat: 30.8, lng: 103.7 } },
    ],
    equipment: ['徒步鞋', '雨具'],
    feeNote: 'AA', cancellationNote: '前一日可退',
  }
}

// 直接铺进 data.form 的「全部齐了」表单（toForm 的产出形状）
function completeForm() {
  return {
    title: '青城后山 · 周末轻徒步', description: '', organizerIntro: '',
    content: [{ type: 'text', text: '周末一起走一段山路。' }],
    coverFileId: '',
    capacity: '20', approvalMode: 'manual', acceptingSignups: true,
    routeTitle: '飞泉沟环线', distanceKm: '12.5', ascentM: '900',
    points: [
      { id: 'pt-1', name: '起点', kind: 'start', lat: '30.9', lng: '103.5', time: '', ele: null },
      { id: 'pt-2', name: '终点', kind: 'finish', lat: '31.0', lng: '103.6', time: '', ele: null },
    ],
    risks: [{ id: 'rk-1', title: '垭口风大', advice: '备防风衣物' }],
    track: [],
    pickups: [{ id: 'pk-1', name: '犀浦站', address: '地铁 A 口', lat: '30.8', lng: '103.7', meeting: { date: '2026-10-03', time: '07:30' } }],
    equipmentText: '徒步鞋\n雨具', feeNote: '', cancellationNote: '',
    dt_start: { date: '2026-10-03', time: '08:00' },
    dt_end: { date: '2026-10-03', time: '16:00' },
    dt_deadline: { date: '2026-10-02', time: '08:00' },
  }
}

// 路线库详情（selectors.routeView 形状）：用于快速带入与共享路线快照
function routeDetail(over) {
  return {
    route: Object.assign({
      id: 'route-1', isOwner: true, title: '飞泉沟环线', distanceKm: 12.8, ascentM: 680,
      points: [
        { id: 'rp-1', name: '溪谷起点', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 }, ele: 700, time: '2026-10-03T00:40:00.000Z' },
        { id: 'rp-2', name: '垭口', kind: 'checkpoint', coordinates: { lat: 30.95, lng: 103.55 }, ele: 1380 },
      ],
      risks: [{ id: 'rr-1', title: '湿滑', advice: '防滑鞋' }],
      track: [{ lat: 30.9, lng: 103.5 }, { lat: 30.95, lng: 103.55 }],
    }, over || {}),
    revision: 7,
  }
}

// 1. 草稿恢复：onLoad 预填本地草稿；编辑已有活动记住 routeId（修过的 bug，回归）
async function scenario1() {
  section('1. 草稿恢复：onLoad 预填本地草稿；编辑已有活动记住 routeId')
  {
    const { page, reads } = bootEditor({
      seed: () => draft.setDraft('new', 'activity-editor', sampleInput()),
    })
    await settle(page)
    check('新建入口不发活动读（只读首页模板列表）',
      reads.every(r => r.kind !== 'activity'), JSON.stringify(reads.map(r => r.kind)))
    check('标题从草稿恢复', page.data.form.title === '青城后山 · 周末轻徒步', page.data.form.title)
    check('时间摊平成日期+时间两段预填', page.data.form.dt_start.date === '2026-10-03' && page.data.form.dt_start.time === '08:00'
      && page.data.form.dt_deadline.date === '2026-10-02', JSON.stringify(page.data.form.dt_start))
    check('GPX 元数据随草稿回到表单（time/ele 不丢）',
      page.data.form.points[0].time === '2026-09-01T01:00:00.000Z' && page.data.form.points[0].ele === 700,
      JSON.stringify(page.data.form.points[0]))
    check('上车点集合时间恢复', page.data.form.pickups[0].meeting.date === '2026-10-03' && page.data.form.pickups[0].meeting.time === '07:30',
      JSON.stringify(page.data.form.pickups[0].meeting))
    check('装备多行文本恢复', page.data.form.equipmentText === '徒步鞋\n雨具', JSON.stringify(page.data.form.equipmentText))
    check('未保存过：savedId 为空、isNew', page.data.savedId === '' && page.data.isNew === true)
  }
  {
    const { page, cmds } = bootEditor({
      options: { id: 'a1' },
      seed: () => draft.setDraft('a1', 'activity-editor', Object.assign(sampleInput(), { title: '本地草稿标题' })),
      views: {
        activity: {
          view: {
            kind: 'activity',
            permittedActions: ['activity.edit', 'activity.publish'],
            activity: Object.assign(sampleInput(), { id: 'a1', ownerId: 'u-owner', phase: 'draft', routeId: 'route-9' }),
          },
          revision: 3,
        },
      },
    })
    await settle(page)
    check('已有活动：本地草稿优先于服务器数据', page.data.form.title === '本地草稿标题', page.data.form.title)
    check('reload 记住服务器 routeId（编辑不另存路线——回归）', page.routeId === 'route-9', String(page.routeId))
    check('savedId 指向该活动、非新建', page.data.savedId === 'a1' && page.data.isNew === false)
    await page.persistCurrent('回归保存')
    check('保存发 activity.edit（不是 create）', cmds.length === 1 && cmds[0].payload.type === 'activity.edit',
      JSON.stringify(cmds.map(c => c.payload.type)))
    check('edit 带回同一 activityId', cmds[0].payload.activityId === 'a1')
    check('buildInput 带回 routeId（不另存路线）', cmds[0].payload.input.routeId === 'route-9', String(cmds[0].payload.input.routeId))
    check('保存成功反馈', page.data.message === '回归保存' && page.data.savedId === 'a1' && page.data.busy === false)
  }
}

// 2. 时间快捷：出发驱动的预填/联动与手改锁定
async function scenario2() {
  section('2. 时间快捷：出发驱动的预填/联动与手改锁定')
  {
    const { page } = bootEditor({})
    await settle(page)
    page.onDate(ev('dt_start', '2026-10-03'))
    check('只填日期（时间未齐）不联动', page.data.form.dt_end.date === '' && page.data.form.dt_deadline.date === '')
    page.onTime(ev('dt_start', '08:00'))
    check('结束自动预填 = 出发 + 8h（当天往返）',
      page.data.form.dt_end.date === '2026-10-03' && page.data.form.dt_end.time === '16:00', JSON.stringify(page.data.form.dt_end))
    check('截止自动预填 = 出发前 1 天同时钟',
      page.data.form.dt_deadline.date === '2026-10-02' && page.data.form.dt_deadline.time === '08:00', JSON.stringify(page.data.form.dt_deadline))
    check('派生标记为 quick（跟随出发）', page.data.form.dt_end_quick === 'quick' && page.data.form.dt_deadline_quick === 'quick')
    page.onTime(ev('dt_start', '09:00'))
    check('改出发后 quick 跟随重算', page.data.form.dt_end.time === '17:00' && page.data.form.dt_deadline.time === '09:00',
      JSON.stringify([page.data.form.dt_end, page.data.form.dt_deadline]))
  }
  {
    const { page } = bootEditor({})
    await settle(page)
    page.onDate(ev('dt_start', '2026-10-03'))
    page.onTime(ev('dt_start', '20:00'))
    check('跨日兜底：+8h 越日则落出发当天 23:30',
      page.data.form.dt_end.date === '2026-10-03' && page.data.form.dt_end.time === '23:30', JSON.stringify(page.data.form.dt_end))
  }
  {
    const { page } = bootEditor({})
    await settle(page)
    page.onDate(ev('dt_start', '2026-10-03'))
    page.onTime(ev('dt_start', '08:00'))
    page.setData({ expandedTimes: { dt_end: true, dt_deadline: true } })
    page.onQuickEnd({ currentTarget: { dataset: { kind: '2' } } })
    check('「2 天」chip = 出发 + 48h 保持同时钟',
      page.data.form.dt_end.date === '2026-10-05' && page.data.form.dt_end.time === '08:00', JSON.stringify(page.data.form.dt_end))
    check('chip 选完收起该行', !('dt_end' in page.data.expandedTimes), JSON.stringify(Object.keys(page.data.expandedTimes)))
    page.onQuickDeadline({ currentTarget: { dataset: { days: '2' } } })
    check('「前 2 天」chip = 出发 − 48h',
      page.data.form.dt_deadline.date === '2026-10-01' && page.data.form.dt_deadline.time === '08:00', JSON.stringify(page.data.form.dt_deadline))
    page.onTime(ev('dt_end', '18:30'))
    check('手改结束后标记 custom', page.data.form.dt_end_quick === 'custom')
    page.onTime(ev('dt_start', '10:00'))
    check('手改后改出发不再覆盖结束',
      page.data.form.dt_end.time === '18:30' && page.data.form.dt_end.date === '2026-10-05', JSON.stringify(page.data.form.dt_end))
    check('未手改的截止仍跟随出发重算', page.data.form.dt_deadline.time === '10:00', JSON.stringify(page.data.form.dt_deadline))
  }
}

// 3. 上车点：新增默认集合时间 = 出发前 30 分钟（跨天如实跨天）；未填出发给引导
async function scenario3() {
  section('3. 上车点：新增默认集合时间 = 出发前 30 分钟')
  {
    const { page } = bootEditor({})
    await settle(page)
    page.onDate(ev('dt_start', '2026-10-03'))
    page.onTime(ev('dt_start', '00:15'))
    page.addPickup()
    check('出发 00:15 → 集合默认前一日 23:45（跨天如实跨天）',
      page.data.form.pickups[0].meeting.date === '2026-10-02' && page.data.form.pickups[0].meeting.time === '23:45',
      JSON.stringify(page.data.form.pickups[0].meeting))
    page.onTime(ev('dt_start', '10:00'))
    page.addPickup()
    check('出发 10:00 → 第二个上车点默认 09:30',
      page.data.form.pickups[1].meeting.date === '2026-10-03' && page.data.form.pickups[1].meeting.time === '09:30',
      JSON.stringify(page.data.form.pickups[1].meeting))
    page.onPickupQuickTime({ currentTarget: { dataset: { index: '1', offset: '0' } } })
    check('「与出发同时」chip', page.data.form.pickups[1].meeting.time === '10:00')
    page.onPickupQuickTime({ currentTarget: { dataset: { index: '1', offset: '-60' } } })
    check('「提前 1 小时」chip', page.data.form.pickups[1].meeting.time === '09:00')
  }
  {
    const { page } = bootEditor({})
    await settle(page)
    page.addPickup()
    check('出发未填：集合时间留空待定（不瞎填）',
      page.data.form.pickups[0].meeting.date === '' && page.data.form.pickups[0].meeting.time === '',
      JSON.stringify(page.data.form.pickups[0].meeting))
    check('新增上车点自动展开编辑态', Object.keys(page.data.editingPickups).length === 1)
  }
}

// 4. GPX 应用（onGpxApply）：真实解析 → 只填空字段不覆盖已填；track 少于 2 点不带键
const GPX_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<gpx version="1.1" creator="test">',
  '<wpt lat="30.00" lon="103.00"><name>溪谷起点</name><ele>700</ele></wpt>',
  '<wpt lat="30.10" lon="103.05"><name>垭口</name><ele>900</ele></wpt>',
  '<wpt lat="30.20" lon="103.10"><name>溪谷终点</name><ele>800</ele></wpt>',
  '<trk><trkseg>',
  '<trkpt lat="30.00" lon="103.00"><ele>700</ele><time>2020-05-01T01:00:00Z</time></trkpt>',
  '<trkpt lat="30.10" lon="103.05"><ele>900</ele><time>2020-05-01T02:00:00Z</time></trkpt>',
  '<trkpt lat="30.20" lon="103.10"><ele>800</ele><time>2020-05-01T03:00:00Z</time></trkpt>',
  '</trkseg></trk></gpx>',
].join('')
const GPX_WX = {
  chooseMessageFile: o => o.success({ tempFiles: [{ path: 'wxfile://t.gpx', size: 120, name: '青城溪谷.gpx' }] }),
  getFileSystemManager: () => ({ readFile: o => o.success({ data: GPX_XML }) }),
}
async function scenario4() {
  section('4. GPX 应用：真实解析 → 只填空字段不覆盖已填')
  {
    const { page } = bootEditor({ wx: GPX_WX })
    await settle(page)
    page.onImportGpx()
    check('解析弹层打开且无错误', page.data.gpxOpen === true && page.data.gpxError === '', page.data.gpxError)
    check('节点数/里程/爬升来自真实解析', page.data.gpxMeta.count === 3 && page.data.gpxMeta.distanceKm > 20 && page.data.gpxMeta.ascentM === 200,
      JSON.stringify(page.data.gpxMeta))
    check('航点从最近轨迹点补齐 time/ele', page.data.gpxPoints[1].time === '2020-05-01T02:00:00.000Z' && page.data.gpxPoints[1].ele === 900,
      JSON.stringify(page.data.gpxPoints[1]))
    check('按轨迹特征给出预填建议（溪/垭口关键词）', !!page.data.gpxSuggest && page.data.gpxSuggest.risks.length >= 2
      && page.data.gpxSuggest.risks.some(r => r.title.indexOf('涉水') !== -1)
      && page.data.gpxSuggest.risks.some(r => r.title.indexOf('垭口') !== -1))
    page.onGpxApply()
    check('路线节点被替换、坐标为字符串', page.data.form.points.length === 3 && page.data.form.points[0].name === '溪谷起点'
      && page.data.form.points[0].lat !== '' && page.data.form.points[0].lng !== '', JSON.stringify(page.data.form.points[0]))
    check('节点 time/ele 透传进表单', page.data.form.points[1].ele === 900 && !!page.data.form.points[1].time,
      JSON.stringify(page.data.form.points[1]))
    check('轨迹折线进表单', page.data.form.track.length === 3, String(page.data.form.track.length))
    check('里程与爬升按解析结果填充', page.data.form.distanceKm === String(page.data.gpxMeta.distanceKm)
      && page.data.form.ascentM === String(page.data.gpxMeta.ascentM),
      page.data.form.distanceKm + '/' + page.data.form.ascentM)
    check('路线名取文件名（去扩展名，原为空）', page.data.form.routeTitle === '青城溪谷', page.data.form.routeTitle)
    check('风险预填（原为空，每条带应对）', page.data.form.risks.length === page.data.gpxSuggest.risks.length
      && page.data.form.risks.every(r => r.title && r.advice), JSON.stringify(page.data.form.risks))
    check('装备预填（原为空，多行）', page.data.form.equipmentText.indexOf('\n') !== -1, page.data.form.equipmentText)
    check('用户可见反馈带导入数量', page.data.message.indexOf('已导入 3 个路线节点') !== -1, page.data.message)
    const input = page.buildInput()
    check('buildInput 带 track 键与节点元数据', Array.isArray(input.routeSnapshot.track) && input.routeSnapshot.track.length === 3
      && input.routeSnapshot.points[1].ele === 900 && !!input.routeSnapshot.points[1].time,
      JSON.stringify(Object.keys(input.routeSnapshot)))
  }
  {
    const { page } = bootEditor({ wx: GPX_WX })
    await settle(page)
    page.setData({ form: Object.assign({}, page.data.form, {
      routeTitle: '我的路线',
      equipmentText: '防风外套',
      risks: [{ id: 'rk-user', title: '用户风险', advice: '用户应对' }],
    }) })
    page.onImportGpx()
    page.onGpxApply()
    check('已填路线名不被覆盖', page.data.form.routeTitle === '我的路线', page.data.form.routeTitle)
    check('已填装备不被覆盖', page.data.form.equipmentText === '防风外套', page.data.form.equipmentText)
    check('已填风险不被覆盖也不追加', page.data.form.risks.length === 1 && page.data.form.risks[0].title === '用户风险',
      JSON.stringify(page.data.form.risks))
    check('里程爬升仍按轨迹填充（设计如此）', page.data.form.distanceKm !== '' && page.data.form.ascentM !== '')
  }
  {
    // 自动派生集合点：GPX 应用后无上车点时，起点直接变集合点（地址仍留空等人补）
    const { page } = bootEditor({ wx: GPX_WX })
    await settle(page)
    page.setData({ form: Object.assign({}, page.data.form, { dt_start: { date: '2026-10-03', time: '08:00' } }) })
    page.onImportGpx()
    page.onGpxApply()
    check('GPX 应用后自动生成 1 个上车点', page.data.form.pickups.length === 1, String(page.data.form.pickups.length))
    check('自动集合点：名称与坐标取自起点', page.data.form.pickups[0].name === '溪谷起点集合'
      && page.data.form.pickups[0].lat === page.data.form.points[0].lat
      && page.data.form.pickups[0].lng === page.data.form.points[0].lng, JSON.stringify(page.data.form.pickups))
    check('集合时间默认出发前 30 分（与 addPickup 同口径）',
      page.data.form.pickups[0].meeting.date === '2026-10-03' && page.data.form.pickups[0].meeting.time === '07:30',
      JSON.stringify(page.data.form.pickups[0].meeting))
    check('地址不编造：留空并展开编辑态等发起人补',
      page.data.form.pickups[0].address === '' && page.data.editingPickups[page.data.form.pickups[0].id] === true,
      JSON.stringify(page.data.form.pickups[0]))
    check('已有上车点时不重复派生', (() => { page.useStartAsPickup(); return page.data.form.pickups.length === 1 })())
    check('派生结果落本机草稿（断电可恢复）', !!draft.getDraft('new', 'activity-editor'))
  }
  {
    const { page } = bootEditor({})
    await settle(page)
    page.onGpxApply()
    check('无解析结果时应用是空操作', page.data.form.points.length === 0)
    page.setData({
      gpxMeta: { fileName: 'x.gpx', count: 2, distanceKm: 0, ascentM: 0, hasElevation: false },
      gpxPoints: [
        { name: 'a', kind: 'start', coordinates: { lat: 30.0, lng: 103.0 }, time: '2020-05-01T01:00:00.000Z', ele: 700 },
        { name: 'b', kind: 'finish', coordinates: { lat: 30.1, lng: 103.1 } },
      ],
      gpxTrack: [],
    })
    page.onGpxApply()
    const input = page.buildInput()
    check('track 少于 2 点：buildInput 不带 track 键', !('track' in input.routeSnapshot), JSON.stringify(Object.keys(input.routeSnapshot)))
    check('有点的 time/ele 透传、无点不带键',
      input.routeSnapshot.points[0].time === '2020-05-01T01:00:00.000Z' && input.routeSnapshot.points[0].ele === 700
      && !('time' in input.routeSnapshot.points[1]) && !('ele' in input.routeSnapshot.points[1]),
      JSON.stringify(input.routeSnapshot.points))
  }
  {
    // 坏高程防护：哨兵/越界 ele 若透传，服务端 schema 严格模式会整单拒绝（「操作字段不完整或格式不正确」，
    // 2026-10-06 真机发布复现）。解析层剔除 + buildInput 复用同一判定，旧坏草稿下次保存自愈。
    const SENTINEL_XML = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="test">',
      '<trk><trkseg>',
      '<trkpt lat="30.00" lon="103.00"><ele>-9999</ele></trkpt>',
      '<trkpt lat="30.05" lon="103.02"></trkpt>',
      '<trkpt lat="30.10" lon="103.05"><ele>900</ele></trkpt>',
      '</trkseg></trk></gpx>',
    ].join('')
    const { page } = bootEditor({ wx: {
      chooseMessageFile: o => o.success({ tempFiles: [{ path: 'wxfile://t.gpx', size: 120, name: '哨兵.gpx' }] }),
      getFileSystemManager: () => ({ readFile: o => o.success({ data: SENTINEL_XML }) }),
    } })
    await settle(page)
    page.onImportGpx()
    page.onGpxApply()
    const input = page.buildInput()
    check('哨兵 ele 不污染爬升（孤立坏值前后无 ele 不参与高程差）', page.data.form.ascentM === '0', page.data.form.ascentM)
    check('节点 ele 全部落在 schema 区间', input.routeSnapshot.points.every(p => !('ele' in p) || (p.ele >= -500 && p.ele <= 9000)),
      JSON.stringify(input.routeSnapshot.points.map(p => p.ele)))
    check('哨兵 GPX 的 buildInput 通过云端 ActivityInput 严检', S.validate(S.ActivityInput, input) === true,
      JSON.stringify(input.routeSnapshot.points))
    const { page: page2 } = bootEditor({})
    await settle(page2)
    page2.setData({ form: Object.assign({}, page2.data.form, {
      points: [{ id: 'pt-old', name: '旧节点', kind: 'start', lat: '30.0', lng: '103.0', time: '', ele: -9999 }],
    }) })
    const healed = page2.buildInput()
    check('旧草稿的越界 ele 在 buildInput 被剔除（草稿自愈）', healed.routeSnapshot.points[0] && !('ele' in healed.routeSnapshot.points[0]),
      JSON.stringify(healed.routeSnapshot.points[0]))
    check('自愈后的 payload 通过云端严检', S.validate(S.ActivityInput, healed) === true,
      JSON.stringify(healed.routeSnapshot.points))
  }
}

// 5. persistCurrent：未保存建草稿 / 已保存编辑，payload 形状（RoutePoint time/ele 原样透传）
async function scenario5() {
  section('5. persistCurrent：未保存建草稿 / 已保存编辑，payload 形状')
  {
    const { page, cmds, env } = bootEditor({
      seed: () => draft.setDraft('new', 'activity-editor', sampleInput()),
    })
    await settle(page)
    const id = await page.persistCurrent('草稿已保存')
    check('未保存：发 activity.create', cmds[0].payload.type === 'activity.create', cmds[0].payload.type)
    check('create 不带 activityId', !('activityId' in cmds[0].payload), JSON.stringify(Object.keys(cmds[0].payload)))
    const input = cmds[0].payload.input
    check('时间合成北京时间 ISO', input.startAt === '2026-10-03T08:00:00+08:00' && input.deadlineAt === '2026-10-02T08:00:00+08:00',
      JSON.stringify([input.startAt, input.deadlineAt]))
    check('路线快照标题/里程/爬升', input.routeSnapshot.title === '飞泉沟环线' && input.routeSnapshot.distanceKm === 12.5
      && input.routeSnapshot.ascentM === 900, JSON.stringify(input.routeSnapshot.title))
    const p0 = input.routeSnapshot.points[0]
    check('RoutePoint 的 time/ele 原样透传（不静默抹掉）', p0.time === '2026-09-01T01:00:00.000Z' && p0.ele === 700, JSON.stringify(p0))
    check('无元数据的节点不带 time/ele 键', !('time' in input.routeSnapshot.points[1]) && !('ele' in input.routeSnapshot.points[1]),
      JSON.stringify(input.routeSnapshot.points[1]))
    check('节点坐标合成对象', !!p0.coordinates && p0.coordinates.lat === 30.9 && p0.coordinates.lng === 103.5, JSON.stringify(p0.coordinates))
    check('上车点 meetingAt 合成且坐标透传', input.pickupPoints[0].meetingAt === '2026-10-03T07:30:00+08:00'
      && input.pickupPoints[0].coordinates.lat === 30.8, JSON.stringify(input.pickupPoints[0]))
    check('风险形状 {id,title,advice}', JSON.stringify(Object.keys(input.routeSnapshot.risks[0]).sort()) === JSON.stringify(['advice', 'id', 'title']))
    check('装备按行拆分', JSON.stringify(input.equipment) === JSON.stringify(['徒步鞋', '雨具']), JSON.stringify(input.equipment))
    check('建议装备始终带键（空数组也能清空旧值）', Array.isArray(input.equipmentSuggested) && input.equipmentSuggested.length === 0,
      JSON.stringify(input.equipmentSuggested))
    check('未选难度时不带 difficulty 键', !('difficulty' in input.routeSnapshot), JSON.stringify(Object.keys(input.routeSnapshot)))
    page.setData({ form: Object.assign({}, page.data.form, { equipmentSuggestedText: '备用袜\n防晒', difficulty: 'moderate' }) })
    const withOptional = page.buildInput()
    check('建议装备按行拆分', JSON.stringify(withOptional.equipmentSuggested) === JSON.stringify(['备用袜', '防晒']),
      JSON.stringify(withOptional.equipmentSuggested))
    check('难度进入 routeSnapshot', withOptional.routeSnapshot.difficulty === 'moderate', withOptional.routeSnapshot.difficulty)
    page.setData({ form: Object.assign({}, page.data.form, { equipmentSuggestedText: '', difficulty: '' }) })
    const cleared = page.buildInput()
    check('清空建议装备/难度后提交可清旧值',
      cleared.equipmentSuggested.length === 0 && !('difficulty' in cleared.routeSnapshot),
      JSON.stringify([cleared.equipmentSuggested, Object.keys(cleared.routeSnapshot)]))
    check('无 track 时 buildInput 不带 track 键', !('track' in input.routeSnapshot))
    check('保存后 savedId 落为新建 id', id === 'act-new' && page.data.savedId === 'act-new')
    check('成功反馈', page.data.message === '草稿已保存' && page.data.busy === false)
    check('保存成功即清本地草稿', draft.getDraft('new', 'activity-editor') === undefined)
    await page.persistCurrent('再存一次')
    check('已保存：改发 activity.edit 带同一 activityId', cmds[1].payload.type === 'activity.edit' && cmds[1].payload.activityId === 'act-new',
      JSON.stringify([cmds[1].payload.type, cmds[1].payload.activityId]))
    page.onSavePreview()
    await waitFor(() => env.rec.nav.length > 0)
    check('保存并预览跳详情页', env.rec.nav.indexOf('/pages/activity/activity?id=act-new') !== -1, JSON.stringify(env.rec.nav))
  }
  {
    const { page, cmds } = bootEditor({})
    await settle(page)
    page.setData({ form: Object.assign({}, page.data.form, { capacity: '600' }) })
    let rejected = false
    await page.persistCurrent('x').catch(() => { rejected = true })
    check('人数上限非法：不发命令并给出可读报错、跳步骤 4',
      rejected && cmds.length === 0 && page.data.failure === '人数上限请填写 1–500 的整数。' && page.data.step === 3,
      JSON.stringify({ rejected: rejected, cmds: cmds.length, step: page.data.step }))
  }
  {
    const { page, cmds } = bootEditor({
      views: { profile: { view: { kind: 'profile', profile: { id: 'p1', person: { name: '', phone: '' } } }, revision: 1 } },
    })
    await settle(page)
    let rejected = false
    await page.persistCurrent('x').catch(() => { rejected = true })
    check('档案未齐：拦截、不发命令、自动弹微信资料门',
      rejected && cmds.length === 0 && page.data.profileGate === true && page.data.profileGateOpen === true && page.data.failure === '',
      JSON.stringify({ rejected, cmds: cmds.length, gate: page.data.profileGate, open: page.data.profileGateOpen, failure: page.data.failure }))
    check('关闭资料门：只收 sheet，不解除补全状态',
      (() => { page.onProfileGateClose(); return page.data.profileGateOpen === false && page.data.profileGate === true })())
    let resumed = 0
    page._afterProfile = () => { resumed++ }
    page.onProfileSaved()
    check('资料保存后自动继续原动作',
      page.data.profileGate === false && page.data.profileGateOpen === false && resumed === 1,
      JSON.stringify({ gate: page.data.profileGate, open: page.data.profileGateOpen, resumed }))
  }
}

// 6. 发布预检双清单（2026-10-14 快速创建）：missingForPublish 只剩必填（标题/时间/集合点），
// 轨迹可解析项进 deferredForPublish——不拦路，但发布确认层逐项点名 + 「去补上」出口。
async function scenario6() {
  section('6. 发布预检双清单：必填拦路、可后补点名不拦路')
  {
    const { page, cmds, env } = bootEditor({})
    await settle(page)
    const blankForm = JSON.parse(JSON.stringify(page.data.form))
    let m = page.missingForPublish()
    check('空表单必填点名 5 项', m.length === 5, JSON.stringify(m.map(x => x.label)))
    check('首项是活动名称（step 0）', m[0].label === '活动名称' && m[0].step === 0)
    check('必填只剩标题/时间/上车点（路线与风险不再拦路）',
      m.some(x => x.label === '至少 1 个集合上车点')
      && !m.some(x => /路线|风险/.test(x.label)), JSON.stringify(m.map(x => x.label)))
    check('展示层收成 3 组且顺序固定（名称 → 时间 → 集合），步骤文案来自 stepLabels',
      page.data.requiredGroups.map(g => g.key).join(',') === 'title,time,pickup'
      && page.data.requiredGroups[0].stepText === '01 信息'
      && page.data.requiredGroups[2].stepText === '02 路线',
      JSON.stringify(page.data.requiredGroups))
    page.onPublishIntent()
    await waitFor(() => env.rec.scrolls.length > 0)
    check('有缺失：跳到第一个缺失步骤', page.data.step === 0, String(page.data.step))
    check('有缺失：failure 逐项点名', /^还差：/.test(page.data.failure) && page.data.failure.indexOf('活动名称') !== -1, page.data.failure)
    check('有缺失：failure 按组说，不把自动推算的结束/截止算成三项',
      page.data.failure === '还差：活动名称、出发与报名时间、集合上车点。补齐后再发布。', page.data.failure)
    check('有缺失：从上一屏位置回到顶部（否则跳了步也看不见提示）',
      env.rec.scrolls[0] && env.rec.scrolls[0].scrollTop === 0, JSON.stringify(env.rec.scrolls))
    check('有缺失：不发命令', cmds.length === 0, String(cmds.length))

    // ①b 只差集合点：跳到第 2 步；第 4 步的「去补齐」再按锚点滚到集合区
    const onlyPickup = completeForm()
    onlyPickup.pickups = [{ id: 'pk-1', name: '犀浦站', address: '', lat: '', lng: '', meeting: { date: '2026-10-03', time: '07:30' } }]
    page.setData({ form: onlyPickup })
    page.setData(page.checklistPatch(page.data.form))
    check('只差集合点：分组只剩集合上车点', page.data.requiredGroups.length === 1
      && page.data.requiredGroups[0].key === 'pickup', JSON.stringify(page.data.requiredGroups))
    env.rec.scrolls.length = 0
    page.onPublishIntent()
    await waitFor(() => env.rec.scrolls.length > 0)
    check('只差集合点：落到第 2 步并回到顶部（提示就在标签下面）',
      page.data.step === 1 && env.rec.scrolls[0] && env.rec.scrolls[0].scrollTop === 0,
      JSON.stringify({ step: page.data.step, scrolls: env.rec.scrolls }))
    check('只差集合点：失败提示只说这一组', page.data.failure === '还差：集合上车点。补齐后再发布。', page.data.failure)
    env.rec.scrolls.length = 0
    page.onFixRequired()
    await waitFor(() => env.rec.scrolls.length > 0)
    check('「去补齐」按组定位：集合点这一组滚到 #pickup-section',
      env.rec.scrolls[0] && env.rec.scrolls[0].selector === '#pickup-section', JSON.stringify(env.rec.scrolls))
    // ①b 用的是完整表单；后面 ②③ 仍按空表单演，恢复现场，避免用例互相污染
    page.setData({ form: JSON.parse(JSON.stringify(blankForm)), step: 0 })
    page.setData(page.checklistPatch(page.data.form))

    // ② 空表单：可后补清单点名路线三项，各带步骤
    const d0 = page.deferredForPublish()
    check('空表单可后补点名 4 项', d0.length === 4, JSON.stringify(d0.map(x => x.label)))
    check('后补项覆盖图文/路线名称/节点/风险且各带步骤',
      d0.some(x => x.label === '图文详情（封面、正文或图片）' && x.step === 2)
      && d0.some(x => x.label === '路线名称' && x.step === 1)
      && d0.some(x => x.label === '至少 1 个路线节点' && x.step === 1)
      && d0.some(x => x.label === '至少 1 条风险提示' && x.step === 3), JSON.stringify(d0))

    // ③ 必填未齐（上车点半成品 + 时间顺序错）：必填清单仍拦路
    page.setData({ form: Object.assign({}, page.data.form, {
      title: '测试活动',
      dt_start: { date: '2026-10-03', time: '08:00' },
      dt_end: { date: '2026-10-03', time: '16:00' },
      dt_deadline: { date: '2026-10-03', time: '09:00' }, // 截止晚于出发 → 顺序错
      points: [{ id: 'pt-1', name: '', kind: 'start', lat: '', lng: '', time: '', ele: null }],
      pickups: [{ id: 'pk-1', name: '犀浦站', address: '', lat: '', lng: '', meeting: { date: '2026-10-03', time: '07:30' } }],
      risks: [{ id: 'rk-1', title: '垭口风大', advice: '' }],
    }) })
    m = page.missingForPublish()
    check('时间顺序错误仍进必填清单（step 0 最优先）',
      m.some(x => x.label === '时间顺序（截止 ≤ 出发，且早于结束）' && x.step === 0), JSON.stringify(m.map(x => x.label)))
    check('上车点半成品仍进必填清单（必填没有放水）',
      m.some(x => x.label === '集合上车点的名称、地址与集合时间'), JSON.stringify(m.map(x => x.label)))
    page.onPublishIntent()
    check('有必填缺失：跳 step 0 且不发命令', page.data.step === 0 && cmds.length === 0,
      JSON.stringify({ step: page.data.step, cmds: cmds.length }))

    // ④ 修好时间与上车点：必填清空，onPublishIntent 改为「保存 + 弹层点名后补项」
    page.setData({ form: Object.assign({}, page.data.form, {
      dt_deadline: { date: '2026-10-02', time: '08:00' },
      pickups: [{ id: 'pk-1', name: '犀浦站', address: '地铁 A 口', lat: '', lng: '', meeting: { date: '2026-10-03', time: '07:30' } }],
    }) })
    check('必填清空', page.missingForPublish().length === 0, JSON.stringify(page.missingForPublish().map(x => x.label)))
    const d1 = page.deferredForPublish()
    check('半成品条目级点名（无名节点/缺应对风险/缺路线名）',
      d1.some(x => x.label === '路线名称') && d1.some(x => x.label === '每个路线节点的名称')
      && d1.some(x => x.label === '每条风险的问题与应对方式'), JSON.stringify(d1.map(x => x.label)))
    page.onPublishIntent()
    await waitFor(() => cmds.length > 0)
    check('可后补不拦截：先静默保存', cmds[0].payload.type === 'activity.create', cmds[0].payload.type)
    await waitFor(() => page.data.publishOpen === true)
    check('发布确认弹层打开并带上后补清单', page.data.publishOpen === true && page.data.deferred.length === d1.length,
      JSON.stringify({ open: page.data.publishOpen, deferred: page.data.deferred }))
    check('此刻只有一条命令（未发布）', cmds.length === 1, String(cmds.length))
    // ⑤ 「去补上」：关弹层跳第一个后补项所在步骤
    page.onDeferredFix()
    check('去补上：关弹层并跳到第一个后补步骤', page.data.publishOpen === false && page.data.step === 1,
      JSON.stringify({ open: page.data.publishOpen, step: page.data.step }))

    // ⑥ 全部齐：两张清单都空，弹层无后补提示
    page.setData({ form: completeForm() })
    check('全部齐：必填与后补清单均为空',
      page.missingForPublish().length === 0 && page.deferredForPublish().length === 0,
      JSON.stringify({ m: page.missingForPublish(), d: page.deferredForPublish() }))
    page.onPublishOpen()
    check('全部齐：发布弹层无后补点名', page.data.publishOpen === true && page.data.deferred.length === 0,
      JSON.stringify(page.data.deferred))
    page.onPublishClose()
  }
  {
    // ⑦ 模板副本会离开本页：空表单直接走，已填写先确认（确认层挡住的是「替换」，不是弹个空对话框）
    const { page, cmds } = bootEditor({})
    await settle(page)
    page.setData({ templateId: 'tpl-1' })
    page.onCopyTemplate()
    await waitFor(() => cmds.length === 1)
    check('空表单复制模板：不拦路，直接发 activity.copy',
      cmds.length === 1 && cmds[0].payload.type === 'activity.copy' && page.data.templateConfirmOpen === false,
      JSON.stringify({ cmds: cmds.map(c => c.payload.type), open: page.data.templateConfirmOpen }))
    await waitFor(() => page.data.busy === false)
    page.setData({ templateId: 'tpl-1' })
    page.onTitleInput({ detail: { value: '已写了一半' } })
    page.onCopyTemplate()
    check('已填写复制模板：先开确认层且不发命令',
      page.data.templateConfirmOpen === true && cmds.length === 1,
      JSON.stringify({ open: page.data.templateConfirmOpen, cmds: cmds.length }))
    page.onTemplateConfirmClose()
    check('确认层可退回：关闭后继续当前填写', page.data.templateConfirmOpen === false && page.data.form.title === '已写了一半')
    page.onCopyTemplate()
    page.onTemplateConfirmGo()
    await waitFor(() => cmds.length === 2)
    check('确认后才发 activity.copy，并关掉确认层',
      cmds[1].payload.type === 'activity.copy' && page.data.templateConfirmOpen === false,
      JSON.stringify({ cmds: cmds.map(c => c.payload.type), open: page.data.templateConfirmOpen }))
  }
  {
    // ⑧ 路线层空态的「导入 GPX」：两个 overlay 是兄弟节点，必须先关路线层再开 GPX
    const { page } = bootEditor({})
    await settle(page)
    page.setData({ quickRouteOpen: true })
    page.onQuickRouteGpx()
    await waitFor(() => page.data.gpxOpen === true)
    check('空态导入 GPX：路线层关掉、GPX 层打开（不是两个弹层叠着）',
      page.data.quickRouteOpen === false && page.data.gpxOpen === true,
      JSON.stringify({ quickRouteOpen: page.data.quickRouteOpen, gpxOpen: page.data.gpxOpen }))
  }
}

// 7. 发布链路：onPublishIntent 先静默保存再确认；确认后发 activity.publish
async function scenario7() {
  section('7. 发布链路：先静默保存再确认；确认后发 activity.publish')
  {
    const { page, cmds, env } = bootEditor({})
    await settle(page)
    page.setData({ form: completeForm() })
    page.onPublishIntent()
    await waitFor(() => cmds.length > 0)
    check('先静默保存（未保存 → activity.create）', cmds[0].payload.type === 'activity.create', cmds[0].payload.type)
    check('发布的就是刚保存的当前内容（标题/人数）', cmds[0].payload.input.title === '青城后山 · 周末轻徒步' && cmds[0].payload.input.capacity === 20)
    await waitFor(() => page.data.publishOpen === true)
    check('发布确认弹层随后打开', page.data.publishOpen === true)
    check('保存反馈', page.data.message === '内容已保存，确认后正式发布。', page.data.message)
    check('此刻只有一条命令（未发布）', cmds.length === 1, String(cmds.length))
    // 参与发布：先验证资料授权闸门
    page.setData({ participate: true })
    page.publish()
    check('本人参加需独立勾选资料使用授权', page.data.failure === '本人参加需要独立确认资料使用授权。' && cmds.length === 1, page.data.failure)
    page.onDataUse({ detail: { value: ['on'] } })
    page.onTripChange({ detail: { value: 'pickup' } })
    page.onTripPickup({ detail: { value: 0 } })
    page.publish()
    await waitFor(() => cmds.length > 1)
    const pub = cmds[1].payload
    check('确认后发 activity.publish', pub.type === 'activity.publish', pub.type)
    check('publish 指向刚保存的同一活动', pub.activityId === 'act-new', String(pub.activityId))
    check('参与信息来自档案（personRef + participant）', !!pub.participation && pub.participation.personRef.userId === 'p1'
      && pub.participation.participant.name === '张三', JSON.stringify(pub.participation && pub.participation.personRef))
    check('按上车点集合', pub.participation.trip.mode === 'shared' && pub.participation.trip.pickupPointId === 'pk-1',
      JSON.stringify(pub.participation.trip))
    check('资料使用授权随报名带上', pub.participation.consent.dataUse === true, JSON.stringify(pub.participation.consent))
    check('发布后关弹层 + toast + 跳详情（带 published=1，详情页据此庆祝一次）', page.data.publishOpen === false
      && env.rec.toasts.indexOf('活动已发布') !== -1
      && env.rec.nav.indexOf('/pages/activity/activity?id=act-new&published=1') !== -1,
      JSON.stringify({ toasts: env.rec.toasts, nav: env.rec.nav }))
  }
  {
    const { page, cmds, env } = bootEditor({ targetIds: ['act-new'] })
    await settle(page)
    page.setData({ form: completeForm() })
    page.onPublishIntent()
    await waitFor(() => cmds.length > 0)
    await waitFor(() => page.data.publishOpen === true)
    page.publish()
    await waitFor(() => cmds.length > 1)
    await waitFor(() => env.rec.nav.length > 0) // 发布链路收尾（toast/跳转）也落定，避免泄漏到后续场景
    check('不参与：publish 的 participation 为 null', cmds[1].payload.type === 'activity.publish' && cmds[1].payload.participation === null,
      JSON.stringify(cmds[1].payload.participation))
  }
}

// 8. 删除草稿：未保存只清本机不发命令；已保存经二次确认后发 activity.delete
async function scenario8() {
  section('8. 删除草稿：未保存只清本机；已保存经确认后发 activity.delete')
  {
    const { page, cmds, env } = bootEditor({
      seed: () => draft.setDraft('new', 'activity-editor', sampleInput()),
    })
    await settle(page)
    check('前置：本地草稿存在', draft.getDraft('new', 'activity-editor') !== undefined)
    page.onDeleteDraftOpen()
    check('删除入口先开确认弹层（overlay 二次确认）', page.data.deleteDraftOpen === true)
    page.onDeleteDraftConfirm()
    check('未保存过：不发任何命令', cmds.length === 0, JSON.stringify(cmds.map(c => c.payload.type)))
    check('只清本机草稿', draft.getDraft('new', 'activity-editor') === undefined)
    check('反馈：toast + 回首页', env.rec.toasts.indexOf('草稿已删除') !== -1 && env.rec.nav.indexOf('/pages/home/home') !== -1,
      JSON.stringify({ toasts: env.rec.toasts, nav: env.rec.nav }))
  }
  {
    const { page, cmds, env } = bootEditor({
      options: { id: 'a1' },
      seed: () => draft.setDraft('a1', 'activity-editor', sampleInput()),
      views: {
        activity: {
          view: {
            kind: 'activity',
            permittedActions: ['activity.edit', 'activity.delete'],
            activity: Object.assign(sampleInput(), { id: 'a1', ownerId: 'u-owner', phase: 'draft', routeId: 'route-9' }),
          },
          revision: 3,
        },
      },
    })
    await settle(page)
    page.onDeleteDraftOpen()
    check('已保存草稿：先弹二次确认', page.data.deleteDraftOpen === true)
    page.onDeleteDraftConfirm()
    await waitFor(() => env.rec.nav.length > 0)
    check('确认后发 activity.delete', cmds.length === 1 && cmds[0].payload.type === 'activity.delete',
      JSON.stringify(cmds.map(c => c.payload.type)))
    check('delete 带该活动 id', cmds[0].payload.activityId === 'a1')
    check('删除后清本地草稿并回首页', draft.getDraft('a1', 'activity-editor') === undefined
      && env.rec.nav.indexOf('/pages/home/home') !== -1)
    check('确认弹层已关闭', page.data.deleteDraftOpen === false)
  }
}

// 9. draft.js 本身：往返/隔离/清除 + 编辑器 30s 节流的自动保存标记
async function scenario9() {
  section('9. draft.js：往返/隔离/清除 + 编辑器 30s 节流的自动保存标记')
  {
    global.wx = makeWx().wx
    draft.setDraft('d1', 'activity-editor', { title: '甲' })
    const got = draft.getDraft('d1', 'activity-editor')
    check('set/get 往返', !!got && got.title === '甲')
    got.title = '乙'
    check('取回是深拷贝（改它不回写）', draft.getDraft('d1', 'activity-editor').title === '甲')
    draft.setDraft('d2', 'activity-editor', { title: '丙' })
    draft.clearDraft('d1', 'activity-editor')
    check('clearDraft 只清对应键', draft.getDraft('d1', 'activity-editor') === undefined
      && draft.getDraft('d2', 'activity-editor').title === '丙')
  }
  {
    const { page } = bootEditor({})
    await settle(page)
    const marks = () => page._patches.filter(p => 'draftSavedAt' in p).length
    page.persistDraft()
    check('首次落「草稿已自动保存」标记', /^\d{2}:\d{2}$/.test(page.data.draftSavedAt), page.data.draftSavedAt)
    page.persistDraft()
    page.persistDraft()
    check('30s 内多次调用只落一次标记', marks() === 1, String(marks()))
    page.setForm({ title: '节流期间的内容' })
    check('草稿内容仍每次落 storage（节流只管标记）', draft.getDraft('new', 'activity-editor').title === '节流期间的内容')
    page._lastMark = Date.now() - 31000 // 模拟 30s 流逝
    page.persistDraft()
    check('超过 30s 后标记再次刷新', marks() === 2, String(marks()))
  }
}

// 10. 阅读态 ↔ 编辑态：切换 handler 不丢数据
async function scenario10() {
  section('10. 阅读态 ↔ 编辑态：切换不丢数据')
  {
    const { page } = bootEditor({ seed: () => draft.setDraft('new', 'activity-editor', sampleInput()) })
    await settle(page)
    const risksBefore = JSON.stringify(page.data.form.risks)
    const rid = page.data.form.risks[0].id
    page.toggleRisk({ currentTarget: { dataset: { id: rid } } })
    check('风险进入编辑态', page.data.editingRisks[rid] === true)
    check('编辑态切换不动风险数据', JSON.stringify(page.data.form.risks) === risksBefore)
    page.toggleRisk({ currentTarget: { dataset: { id: rid } } })
    check('「完成」回到阅读态', !page.data.editingRisks[rid])
    page.addRisk()
    check('新增风险自动进编辑态', page.data.form.risks.length === 2 && page.data.editingRisks[page.data.form.risks[1].id] === true)
    page.onRisk({ currentTarget: { dataset: { index: 1, key: 'title' } }, detail: { value: '碎石坡湿滑' } })
    page.onRisk({ currentTarget: { dataset: { index: 1, key: 'advice' } }, detail: { value: '控制间距' } })
    check('编辑态写入生效且原数据仍在', page.data.form.risks[1].title === '碎石坡湿滑' && page.data.form.risks[0].title === '垭口风大',
      JSON.stringify(page.data.form.risks))
    page.removeRisk({ currentTarget: { dataset: { index: 1 } } })
    check('移除后恢复原数据', page.data.form.risks.length === 1 && JSON.stringify(page.data.form.risks) === risksBefore)

    page.toggleExtras()
    check('装备费用进编辑态', page.data.editingExtras === true)
    page.onField({ currentTarget: { dataset: { key: 'feeNote' } }, detail: { value: 'AA 制' } })
    check('编辑态写入费用', page.data.form.feeNote === 'AA 制')
    page.toggleExtras()
    check('回阅读态且数据保留', page.data.editingExtras === false && page.data.form.feeNote === 'AA 制')

    const pid = page.data.form.pickups[0].id
    const pickupsBefore = JSON.stringify(page.data.form.pickups)
    page.togglePickup({ currentTarget: { dataset: { id: pid } } })
    check('上车点进入编辑态', page.data.editingPickups[pid] === true)
    check('编辑态切换不动上车点数据', JSON.stringify(page.data.form.pickups) === pickupsBefore)
    page.togglePickup({ currentTarget: { dataset: { id: pid } } })
    check('上车点回阅读态', !page.data.editingPickups[pid])
  }
}

async function scenario11() {
  section('11. 地图选点失败必须有反馈：取消静默，其余给可操作指引')
  const failWith = errMsg => ({
    seed: () => draft.setDraft('new', 'activity-editor', sampleInput()),
    wx: { chooseLocation: o => o.fail({ errMsg }) },
  })
  {
    const { page } = bootEditor(failWith('chooseLocation:fail cancel'))
    await settle(page)
    page.choosePointLocation({ currentTarget: { dataset: { index: 0 } } })
    check('用户取消选点：静默，不写 failure', page.data.failure === '', page.data.failure)
  }
  {
    const { page } = bootEditor(failWith('chooseLocation:fail auth deny'))
    await settle(page)
    page.choosePointLocation({ currentTarget: { dataset: { index: 0 } } })
    check('定位被拒：写 failure', !!page.data.failure)
    check('定位被拒：指向「手动输入」兜底', /手动输入/.test(page.data.failure), page.data.failure)
  }
  {
    const { page } = bootEditor(failWith('chooseLocation:fail privacy not authorized'))
    await settle(page)
    page.choosePointLocation({ currentTarget: { dataset: { index: 0 } } })
    check('隐私未声明：判隐私分支而非鉴权（authorized 含 auth 子串，顺序勿换）',
      /用户隐私保护指引/.test(page.data.failure), page.data.failure)
  }
  {
    const { page } = bootEditor(failWith('chooseLocation:fail scope is not declared'))
    await settle(page)
    page.choosePickupLocation({ currentTarget: { dataset: { index: 0 } } })
    check('上车点 scope 未声明：同样给隐私指引', /用户隐私保护指引/.test(page.data.failure), page.data.failure)
  }
  {
    const { page } = bootEditor(failWith('chooseLocation:fail system error'))
    await settle(page)
    page.choosePointLocation({ currentTarget: { dataset: { index: 0 } } })
    check('未知错误：附 errMsg 便于排障', /system error/.test(page.data.failure), page.data.failure)
  }
  {
    const { page } = bootEditor({
      seed: () => draft.setDraft('new', 'activity-editor', sampleInput()),
      wx: { chooseLocation: o => o.success({ latitude: 30.95, longitude: 103.57, name: '南门', address: '某路 1 号' }) },
    })
    await settle(page)
    page.choosePointLocation({ currentTarget: { dataset: { index: 1 } } })
    check('成功路径未破坏：坐标写入节点', page.data.form.points[1].lat === '30.95',
      JSON.stringify(page.data.form.points[1]))
    check('成功路径不写 failure', page.data.failure === '', page.data.failure)
  }
  {
    let mode = 'fail'
    const { page } = bootEditor({
      seed: () => draft.setDraft('new', 'activity-editor', sampleInput()),
      wx: { chooseLocation: o => (mode === 'fail'
        ? o.fail({ errMsg: 'chooseLocation:fail auth deny' })
        : o.success({ latitude: 30.95, longitude: 103.57, name: '南门', address: '某路 1 号' })) },
    })
    await settle(page)
    page.choosePointLocation({ currentTarget: { dataset: { index: 0 } } })
    check('先失败：failure 有值', !!page.data.failure)
    mode = 'ok'
    page.choosePointLocation({ currentTarget: { dataset: { index: 0 } } })
    check('失败后再成功：坐标写入', page.data.form.points[0].lat === '30.95',
      JSON.stringify(page.data.form.points[0]))
    check('失败后再成功：陈旧报错必须清掉（否则提示与界面状态矛盾）', page.data.failure === '',
      page.data.failure)
  }
}

async function scenario12() {
  section('12. 图文详情/活动说明：buildInput、内容变更与上传闸门')
  {
    const { page } = bootEditor({})
    await settle(page)
    const cover = 'cloud://env.abc/activity-media/a.jpg'
    page.setData({
      form: Object.assign({}, page.data.form, {
        content: [{ type: 'text', text: '第一段\n\n第二段' }, { type: 'images', fileIds: [cover] }],
        coverFileId: cover,
        highlightsText: '理由一\n理由二',
        leader: '陈屿',
        minParticipants: '3',
        sceneryRating: 5,
        funRating: 3,
        feeSummary: '498 元/人',
        feeIncludesText: '大巴\n住宿',
        feeExcludesText: '餐食',
        signupNote: '报名后拉群',
      }),
    })
    const input = page.buildInput()
    check('buildInput 带正文块与封面', input.content.length === 2 && input.coverFileId === cover, JSON.stringify(input.content))
    check('buildInput 带推荐理由/费用/评分/报名后须知',
      JSON.stringify(input.highlights) === JSON.stringify(['理由一', '理由二'])
      && JSON.stringify(input.feeIncludes) === JSON.stringify(['大巴', '住宿'])
      && JSON.stringify(input.feeExcludes) === JSON.stringify(['餐食'])
      && input.leader === '陈屿' && input.minParticipants === 3
      && input.sceneryRating === 5 && input.funRating === 3
      && input.feeSummary === '498 元/人' && input.signupNote === '报名后拉群', JSON.stringify(input))
    check('buildInput 通过云端 ActivityInput 严检', S.validate(S.ActivityInput, input) === true, JSON.stringify(input))
    page.onContentChange({ detail: { content: [{ type: 'text', text: '改过的正文' }], coverFileId: '' } })
    check('内容变更写回 form 并标记已填', page.data.form.content.length === 1 && page.data.contentFilled === true, JSON.stringify(page.data.form.content))
    check('内容变更清空封面', page.data.form.coverFileId === '')
    page.onRating({ currentTarget: { dataset: { key: 'sceneryRating', value: 4 } } })
    check('评分 chip 写回 form', page.data.form.sceneryRating === 4, page.data.form.sceneryRating)
    page.onContentBusy({ detail: { busy: true } })
    check('上传中置 contentBusy', page.data.contentBusy === true)
    let rejected = false
    await page.persistCurrent('x').catch(() => { rejected = true })
    check('上传中阻止保存并给出原因', rejected && page.data.failure === '图片正在上传/检查，完成后才能保存或发布。', page.data.failure)
    page.onContentBusy({ detail: { busy: false } })
    check('上传结束解除 contentBusy', page.data.contentBusy === false)
  }
}

// 13. 快速创建主路径（2026-10-21）：路线带入 → 标题自动填 → 起点自动生成集合点 → 补地址即可发布。
async function scenario13() {
  section('13. 快速创建：路线自动带入、标题自动填写、集合自动派生、随时发布')
  const detail = routeDetail()
  const listItem = {
    id: 'route-1', title: detail.route.title, distanceKm: 12.8, ascentM: 680,
    pointCount: 2, riskCount: 1, isOwner: true,
  }
  {
    const { page } = bootEditor({ routes: [listItem], routeDetail: detail })
    await settle(page)
    page.onDate(ev('dt_start', '2026-10-03'))
    page.onTime(ev('dt_start', '08:00'))
    check('先定出发：结束与截止自动估算', page.data.form.dt_end.date === '2026-10-03'
      && page.data.form.dt_deadline.date === '2026-10-02', JSON.stringify({ end: page.data.form.dt_end, deadline: page.data.form.dt_deadline }))
    page.onQuickRouteOpen()
    await waitFor(() => page.data.quickRoutes.length === 1)
    check('路线库列表打开并标明归属', page.data.quickRouteOpen === true && page.data.quickRoutes[0].badge === '我的'
      && page.data.quickRoutes[0].statsText.indexOf('12.8 km') !== -1, JSON.stringify(page.data.quickRoutes))
    page.onQuickRoutePick({ currentTarget: { dataset: { id: 'route-1' } } })
    await waitFor(() => page.data.form.routeTitle === '飞泉沟环线')
    check('路线带入名称/里程/爬升/节点/风险', page.data.form.routeTitle === '飞泉沟环线'
      && page.data.form.distanceKm === '12.8' && page.data.form.ascentM === '680'
      && page.data.form.points.length === 2 && page.data.form.risks.length === 1,
      JSON.stringify({ title: page.data.form.routeTitle, points: page.data.form.points.length, risks: page.data.form.risks.length }))
    check('活动名按路线名自动填写并标注来源', page.data.form.title === '飞泉沟环线'
      && /路线名/.test(page.data.titleAutoSource), JSON.stringify({ title: page.data.form.title, source: page.data.titleAutoSource }))
    check('标题未触碰时可被下一条路线替换（自动值不是用户输入）', (function () {
      page.applyRouteSnapshot(routeDetail({ id: 'route-2', title: '第二条路线' }).route)
      return page.data.form.title === '第二条路线'
    })())
    page.applyRouteSnapshot(detail.route)
    const autoPickup = page.data.form.pickups[0]
    check('起点自动生成集合点，名称/坐标来自路线', page.data.form.pickups.length === 1 && autoPickup.name === '溪谷起点集合'
      && autoPickup.lat === '30.9' && autoPickup.lng === '103.5', JSON.stringify(page.data.form.pickups))
    check('集合时间自动取出发前 30 分', autoPickup.meeting.date === '2026-10-03' && autoPickup.meeting.time === '07:30',
      JSON.stringify(autoPickup.meeting))
    check('自动生成的集合点带标记（页面据此显示「自动生成」，不是靠名字猜）',
      page.data.autoPickupIds[autoPickup.id] === true, JSON.stringify(page.data.autoPickupIds))
    check('集合点已存在时再带路线：不重复生成，也不再弹「去确认集合点」',
      page.data.form.pickups.length === 1 && page.data.messageActionLabel === '',
      JSON.stringify({ n: page.data.form.pickups.length, label: page.data.messageActionLabel }))
    page.onPickupTime({ currentTarget: { dataset: { index: 0 } }, detail: { value: '07:40' } })
    check('改过集合时间：自动标记撤掉（界面不再说是系统生成的）',
      page.data.autoPickupIds[autoPickup.id] !== true && page.data.form.pickups[0].meeting.time === '07:40',
      JSON.stringify({ ids: page.data.autoPickupIds, time: page.data.form.pickups[0].meeting.time }))
    check('集合地址留空 → 还不能发布', page.data.publishReady === false && /集合上车点/.test(page.data.requiredMissingText),
      JSON.stringify({ ready: page.data.publishReady, missing: page.data.requiredMissingText }))
    page.onPickup({ currentTarget: { dataset: { index: 0, key: 'address' } }, detail: { value: '地铁 A 口' } })
    check('补一句集合地址 → 任意步骤都可直接发布', page.data.publishReady === true && page.data.requiredMissingText === '',
      JSON.stringify({ ready: page.data.publishReady, missing: page.data.requiredMissingText }))
    check('路线快照 buildInput 通过云端严检', S.validate(S.ActivityInput, page.buildInput()) === true)
  }
  {
    // 先定出发、再带路线：自动生成那一刻给出「去确认集合点」出口，点了要真的落到集合区
    const { page, env } = bootEditor({ routes: [listItem], routeDetail: detail })
    await settle(page)
    page.onDate(ev('dt_start', '2026-10-03'))
    page.onTime(ev('dt_start', '08:00'))
    page.applyRouteSnapshot(detail.route)
    await waitFor(() => page.data.form.pickups.length === 1)
    check('自动生成集合点后就地给出确认出口',
      page.data.messageActionLabel === '去确认集合点' && page.data.messageActionStep === 1,
      JSON.stringify({ label: page.data.messageActionLabel, step: page.data.messageActionStep }))
    env.rec.scrolls.length = 0
    page.onMessageAction()
    await waitFor(() => env.rec.scrolls.length > 0)
    check('点确认出口：跳到第 2 步并滚到 #pickup-section',
      page.data.step === 1 && env.rec.scrolls[0] && env.rec.scrolls[0].selector === '#pickup-section',
      JSON.stringify({ step: page.data.step, scrolls: env.rec.scrolls }))
  }
  {
    const { page } = bootEditor({ routes: [listItem], routeDetail: detail })
    await settle(page)
    page.onTitleInput({ detail: { value: '我自己的活动名' } })
    page.onQuickRouteOpen()
    await waitFor(() => page.data.quickRoutes.length === 1)
    page.onQuickRoutePick({ currentTarget: { dataset: { id: 'route-1' } } })
    await waitFor(() => page.data.form.routeTitle === '飞泉沟环线')
    check('用户改过标题后，选路线不覆盖', page.data.form.title === '我自己的活动名' && page.data.titleAutoSource === '',
      JSON.stringify({ title: page.data.form.title, source: page.data.titleAutoSource }))
  }
  {
    const shared = routeDetail({ id: 'route-shared', isOwner: false, title: '共享路线' })
    const { page } = bootEditor({
      routes: [{ id: 'route-shared', title: '共享路线', distanceKm: 12.8, ascentM: 680, pointCount: 2, riskCount: 1, isOwner: false }],
      routeDetail: shared,
    })
    await settle(page)
    page.onQuickRouteOpen()
    await waitFor(() => page.data.quickRoutes.length === 1)
    page.onQuickRoutePick({ currentTarget: { dataset: { id: 'route-shared' } } })
    await waitFor(() => page.data.form.routeTitle === '共享路线')
    check('共享路线只带快照，不挂 routeId（服务端只允许自己的路线）',
      page.routeId === null && page.data.form.routeTitle === '共享路线' && page.data.form.points.length === 2,
      JSON.stringify({ routeId: page.routeId, title: page.data.form.routeTitle }))
  }
  {
    const { page } = bootEditor({ routes: [listItem], routeDetail: detail })
    await settle(page)
    page.onQuickRouteOpen()
    await waitFor(() => page.data.quickRoutes.length === 1)
    page.onQuickRoutePick({ currentTarget: { dataset: { id: 'route-1' } } })
    await waitFor(() => page.data.form.routeTitle === '飞泉沟环线')
    const originalReadRoutes = api.readRoutes
    api.readRoutes = id => id
      ? Promise.resolve(routeDetail({ id: 'route-2', title: '第二条路线', distanceKm: 5, points: routeDetail().route.points, risks: [] }))
      : originalReadRoutes()
    page.onQuickRouteOpen()
    await waitFor(() => page.data.quickRoutes.length === 1)
    page.onQuickRoutePick({ currentTarget: { dataset: { id: 'route-2' } } })
    await waitFor(() => page.data.routeReplaceOpen === true)
    check('已有路线时先确认替换，不静默覆盖', page.data.routeReplaceOpen === true && page.data.pendingRouteTitle === '第二条路线',
      JSON.stringify({ open: page.data.routeReplaceOpen, title: page.data.pendingRouteTitle }))
    page.onRouteReplaceConfirm()
    check('确认后才替换路线快照', page.data.form.routeTitle === '第二条路线' && page.data.form.distanceKm === '5',
      JSON.stringify({ title: page.data.form.routeTitle, distance: page.data.form.distanceKm }))
  }
  {
    // 关闭选择器后，迟到的路线读取不得再改表单（尝试令牌）：否则用户以为取消了，内容却被换掉。
    const { page } = bootEditor({ routes: [listItem], routeDetail: detail })
    await settle(page)
    page.onQuickRouteOpen()
    await waitFor(() => page.data.quickRoutes.length === 1)
    let release = null
    const originalReadRoutes = api.readRoutes
    api.readRoutes = () => new Promise(resolve => { release = () => resolve(detail) })
    page.onQuickRoutePick({ currentTarget: { dataset: { id: 'route-1' } } })
    page.onQuickRouteClose()
    if (release) release()
    await sleep(120)
    check('关闭选择器后，迟到的路线读取不再替换路线', page.data.form.routeTitle === '' && page.routeId === undefined,
      JSON.stringify({ title: page.data.form.routeTitle, routeId: page.routeId }))
    api.readRoutes = originalReadRoutes
  }
  {
    const { page } = bootEditor({
      wx: { chooseLocation: o => o.success({ name: '犀浦站', address: '地铁 A 口', latitude: 30.8, longitude: 103.7 }) },
    })
    await settle(page)
    page.onTitleInput({ detail: { value: '周末轻徒步' } })
    const suggestion = page.data.startSuggestions[0]
    page.useSuggestedStart({ currentTarget: { dataset: { key: suggestion.key } } })
    check('点一下周六建议即写入出发时间，并自动估算结束/截止',
      page.data.form.dt_start.date === suggestion.at.date && page.data.form.dt_start.time === suggestion.at.time
        && !!page.data.form.dt_end.date && !!page.data.form.dt_deadline.date,
      JSON.stringify({ start: page.data.form.dt_start, end: page.data.form.dt_end, deadline: page.data.form.dt_deadline }))
    page.chooseNewPickupLocation()
    check('地图选点一次补齐集合点名称/地址/坐标', page.data.form.pickups.length === 1
      && page.data.form.pickups[0].name === '犀浦站' && page.data.form.pickups[0].address === '地铁 A 口'
      && page.data.form.pickups[0].lat === '30.8' && page.data.form.pickups[0].lng === '103.7',
      JSON.stringify(page.data.form.pickups))
    check('集合时间自动取建议出发前 30 分', page.data.form.pickups[0].meeting.time === (function () {
      const s = page.data.form.dt_start
      const base = Date.parse(s.date + 'T' + s.time + ':00+08:00') - 30 * 60000
      const iso = new Date(base + 8 * 3600000).toISOString()
      return iso.slice(11, 16)
    })(), JSON.stringify(page.data.form.pickups[0].meeting))
    check('三件必填齐 → 可发布（仍可继续写介绍）', page.data.publishReady === true, page.data.requiredMissingText)
  }
}

// 14. EDI-02/03：节点日程只读派生（轨迹时间差 + 出发时刻）+ 装备 chips（底层仍是换行文本）。
async function scenario14() {
  section('14. 节点日程预览（EDI-02 A）与装备 chips（EDI-03）')
  {
    const { page } = bootEditor({ seed: () => draft.setDraft('new', 'activity-editor', sampleInput()) })
    await settle(page)
    check('有轨迹时间 + 有出发 → 逐节点给出「第几天 几点」', page.data.scheduleRows.length === 2
      && page.data.scheduleRows[0].indexText === '01' && page.data.scheduleRows[0].name === '起点'
      && page.data.scheduleRows[0].known === true && page.data.scheduleRows[0].label === '第1天 08:00'
      && page.data.scheduleRows[1].known === false && page.data.scheduleRows[1].label === '无时间信息',
      JSON.stringify(page.data.scheduleRows))
    check('日程说明与天气页同源（有出发时刻）',
      page.data.scheduleBasis === '按轨迹记录的时间差与出发时刻推算抵达时间，日期已自动对齐。', page.data.scheduleBasis)
    check('单日行程 spanDays=1', page.data.scheduleSpanDays === 1, page.data.scheduleSpanDays)
    page.onDate(ev('dt_start', ''))
    check('撤掉出发时刻 → 只剩「出发后多久」，说明改口为未定出发',
      page.data.scheduleRows[0].label === '出发后 0 分钟' && page.data.scheduleRows[1].label === '无时间信息'
      && page.data.scheduleBasis === '活动未定出发时刻，先看轨迹各点的耗时；定了出发时间就能定位到当天。'
      && page.data.scheduleSpanDays === null,
      JSON.stringify({ rows: page.data.scheduleRows, basis: page.data.scheduleBasis }))
  }
  {
    const { page } = bootEditor({ seed: () => draft.setDraft('new', 'activity-editor', sampleInput()) })
    await settle(page)
    page.onRoutePoint({ currentTarget: { dataset: { index: 0, key: 'time' } }, detail: { value: '' } })
    check('轨迹完全没有时间戳 → 说明「没有记录时间信息」，每个节点都标无时间',
      page.data.scheduleBasis === '这条轨迹没有记录时间信息，无法推算抵达日程——下面是所选日期的天气。'
      && page.data.scheduleRows.every(r => r.known === false && r.label === '无时间信息')
      && page.data.scheduleSpanDays === null,
      JSON.stringify({ basis: page.data.scheduleBasis, rows: page.data.scheduleRows }))
  }
  {
    const { page } = bootEditor({ seed: () => draft.setDraft('new', 'activity-editor', sampleInput()) })
    await settle(page)
    page.onEquipmentDraft(ev('equipmentDraft', '  头灯  '))
    check('装备输入草稿不写表单', page.data.equipmentDraft === '  头灯  ' && page.data.form.equipmentText === '徒步鞋\n雨具',
      JSON.stringify({ draft: page.data.equipmentDraft, text: page.data.form.equipmentText }))
    page.addEquipment({ currentTarget: { dataset: { group: 'equipment' } } })
    check('添加一项 → 追加到换行文本并清空输入框',
      page.data.form.equipmentText === '徒步鞋\n雨具\n头灯' && page.data.equipmentDraft === '',
      JSON.stringify({ text: page.data.form.equipmentText, draft: page.data.equipmentDraft }))
    page.onEquipmentDraft(ev('equipmentDraft', '雨具'))
    page.addEquipment({ currentTarget: { dataset: { group: 'equipment' } } })
    check('重复项不入清单，给出提示', page.data.form.equipmentText === '徒步鞋\n雨具\n头灯'
      && /已在清单里/.test(page.data.message) && page.data.equipmentDraft === '',
      JSON.stringify({ text: page.data.form.equipmentText, message: page.data.message }))
    page.onEquipmentDraft(ev('equipmentDraft', '   '))
    page.addEquipment({ currentTarget: { dataset: { group: 'equipment' } } })
    check('空白不新增', page.data.form.equipmentText === '徒步鞋\n雨具\n头灯', page.data.form.equipmentText)
    page.removeEquipment({ currentTarget: { dataset: { group: 'equipment', index: 0 } } })
    check('点 chip 移除指定项', page.data.form.equipmentText === '雨具\n头灯', page.data.form.equipmentText)
    page.onEquipmentDraft(ev('equipmentSuggestedDraft', '登山杖'))
    page.addEquipment({ currentTarget: { dataset: { group: 'suggested' } } })
    check('建议携带走独立字段，不混进必带', page.data.form.equipmentText === '雨具\n头灯'
      && page.data.form.equipmentSuggestedText === '登山杖',
      JSON.stringify({ must: page.data.form.equipmentText, suggested: page.data.form.equipmentSuggestedText }))
    const input = page.buildInput()
    check('buildInput 仍产出两份数组（零 schema 改动）',
      JSON.stringify(input.equipment) === JSON.stringify(['雨具', '头灯'])
      && JSON.stringify(input.equipmentSuggested) === JSON.stringify(['登山杖'])
      && S.validate(S.ActivityInput, input) === true,
      JSON.stringify({ equipment: input.equipment, suggested: input.equipmentSuggested }))
  }
}

// 15. EDI-04：活动可见范围（缺省 discover；link 不进发现页但仍可凭链接打开）
async function scenario15() {
  section('15. 活动可见范围 visibility（discover / link）')
  {
    const { page } = bootEditor({ seed: () => draft.setDraft('new', 'activity-editor', sampleInput()) })
    await settle(page)
    check('旧草稿没有 visibility 键 → 表单兜底 discover', page.data.form.visibility === 'discover', page.data.form.visibility)
    check('buildInput 始终带键，缺省 discover 可过 schema',
      page.buildInput().visibility === 'discover' && S.validate(S.ActivityInput, page.buildInput()) === true)
    page.onVisibility({ detail: { value: 1 } })
    const stored = draft.getDraft('new', 'activity-editor') || {}
    check('选「仅通过分享链接可见」→ link，并落进本地草稿',
      page.data.form.visibility === 'link' && stored.visibility === 'link',
      JSON.stringify({ form: page.data.form.visibility, draft: stored.visibility }))
    const linkInput = page.buildInput()
    check('link 提交形状通过 schema', linkInput.visibility === 'link' && S.validate(S.ActivityInput, linkInput) === true)
    page.onVisibility({ detail: { value: 0 } })
    check('切回公开 → discover（activity.edit 是 Object.assign，必须每次显式带键）',
      page.data.form.visibility === 'discover' && page.buildInput().visibility === 'discover')
    page.onVisibility({ detail: {} })
    check('异常下标不写出未知可见性', page.data.form.visibility === 'discover', page.data.form.visibility)
  }
  {
    const { page, cmds } = bootEditor({
      options: { id: 'a1' },
      views: {
        activity: {
          view: {
            kind: 'activity',
            permittedActions: ['activity.edit', 'activity.publish'],
            activity: Object.assign(sampleInput(), { id: 'a1', ownerId: 'u-owner', phase: 'draft', visibility: 'link' }),
          },
          revision: 3,
        },
      },
    })
    await settle(page)
    check('服务器 link 活动读回表单为 link', page.data.form.visibility === 'link', page.data.form.visibility)
    page.onVisibility({ detail: { value: 0 } })
    await page.persistCurrent('保存')
    check('改回公开后保存命令显式带 visibility=discover',
      cmds.length === 1 && cmds[0].payload.input.visibility === 'discover',
      JSON.stringify(cmds.map(c => c.payload.input.visibility)))
  }
  {
    // Node 渲染不了 WXML：这里只钉控件存在、绑定与两条选项文案，不钉布局（布局归真机）。
    const wxml = require('fs').readFileSync(require.resolve('../miniprogram/pages/editor/editor.wxml'), 'utf8')
    check('发布步有可见范围控件并绑定 onVisibility',
      wxml.indexOf('bindchange="onVisibility"') !== -1
      && wxml.indexOf('公开到发现页') !== -1
      && wxml.indexOf('仅通过分享链接可见') !== -1
      && wxml.indexOf('form.visibility') !== -1)
    // picker 缺 value 时缺省高亮第 0 项：当前是 link 却直接确认，会把值静默改回 discover。
    const visLine = wxml.split('\n').find(l => l.indexOf('bindchange="onVisibility"') !== -1) || ''
    check('可见范围 picker 的 value 指向当前项',
      visLine.indexOf('value="{{form.visibility') !== -1, visLine.trim())
  }
}

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6, scenario7, scenario8, scenario9, scenario10, scenario11, scenario12, scenario13, scenario14, scenario15]
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
