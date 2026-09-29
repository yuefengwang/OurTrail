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
  const rec = { toasts: [], nav: [] }
  const wx = Object.assign({
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push((o && o.title) || ''),
    navigateTo: o => rec.nav.push((o && o.url) || ''),
    redirectTo: o => rec.nav.push((o && o.url) || ''),
    switchTab: o => rec.nav.push((o && o.url) || ''),
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
    check('人数上限非法：不发命令并给出可读报错、跳步骤 3',
      rejected && cmds.length === 0 && page.data.failure === '人数上限请填写 1–500 的整数。' && page.data.step === 2,
      JSON.stringify({ rejected: rejected, cmds: cmds.length, step: page.data.step }))
  }
  {
    const { page, cmds } = bootEditor({
      views: { profile: { view: { kind: 'profile', profile: { id: 'p1', person: { name: '', phone: '' } } }, revision: 1 } },
    })
    await settle(page)
    let rejected = false
    await page.persistCurrent('x').catch(() => { rejected = true })
    check('档案未齐：拦截并指引「我的」页，不发命令',
      rejected && cmds.length === 0 && page.data.failure.indexOf('补全姓名与手机号') !== -1, page.data.failure)
  }
}

// 6. 发布预检 missingForPublish：逐项点名 + 跳第一个缺失步骤
async function scenario6() {
  section('6. 发布预检 missingForPublish：逐项点名 + 跳第一个缺失步骤')
  {
    const { page, cmds } = bootEditor({})
    await settle(page)
    let m = page.missingForPublish()
    check('空表单点名 8 项', m.length === 8, JSON.stringify(m.map(x => x.label)))
    check('首项是活动名称（step 0）', m[0].label === '活动名称' && m[0].step === 0)
    check('点名覆盖路线/上车点/风险', m.some(x => x.label === '至少 1 个路线节点')
      && m.some(x => x.label === '至少 1 个集合上车点') && m.some(x => x.label === '至少 1 条风险提示'))
    page.onPublishIntent()
    check('有缺失：跳到第一个缺失步骤', page.data.step === 0, String(page.data.step))
    check('有缺失：failure 逐项点名', /^还差：/.test(page.data.failure) && page.data.failure.indexOf('活动名称') !== -1, page.data.failure)
    check('有缺失：不发命令', cmds.length === 0, String(cmds.length))

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
    const labels = m.map(x => x.label)
    check('时间顺序错误被点名', labels.indexOf('时间顺序（截止 ≤ 出发，且早于结束）') !== -1, JSON.stringify(labels))
    check('无名节点/缺地址上车点/缺应对风险逐项点名',
      labels.indexOf('路线名称') !== -1 && labels.indexOf('每个路线节点的名称') !== -1
      && labels.indexOf('集合上车点的名称、地址与集合时间') !== -1 && labels.indexOf('每条风险的问题与应对方式') !== -1,
      JSON.stringify(labels))
    page.onPublishIntent()
    check('第一个缺失是时间顺序（step 0）', page.data.step === 0, String(page.data.step))

    page.setData({ form: Object.assign({}, page.data.form, { dt_deadline: { date: '2026-10-02', time: '08:00' } }) })
    check('修好时间后第一个缺失转到路线（step 1）', page.missingForPublish()[0].step === 1)
    page.onPublishIntent()
    check('页面跳到步骤 2', page.data.step === 1, String(page.data.step))

    page.setData({ form: Object.assign({}, page.data.form, {
      routeTitle: '飞泉沟环线',
      points: [{ id: 'pt-1', name: '起点', kind: 'start', lat: '30.9', lng: '103.5', time: '', ele: null }],
      pickups: [{ id: 'pk-1', name: '犀浦站', address: '地铁 A 口', lat: '30.8', lng: '103.7', meeting: { date: '2026-10-03', time: '07:30' } }],
    }) })
    check('修好路线后第一个缺失转到风险（step 2）', page.missingForPublish()[0].step === 2)
    page.onPublishIntent()
    check('页面跳到步骤 3', page.data.step === 2, String(page.data.step))

    page.setData({ form: Object.assign({}, page.data.form, { risks: [{ id: 'rk-1', title: '垭口风大', advice: '备防风衣物' }] }) })
    check('全部齐了：清单为空', page.missingForPublish().length === 0, JSON.stringify(page.missingForPublish().map(x => x.label)))
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
    page.onDataUse({ detail: { value: true } })
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
    check('发布后关弹层 + toast + 跳详情', page.data.publishOpen === false
      && env.rec.toasts.indexOf('活动已发布') !== -1
      && env.rec.nav.indexOf('/pages/activity/activity?id=act-new') !== -1,
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

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5, scenario6, scenario7, scenario8, scenario9, scenario10, scenario11]
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
