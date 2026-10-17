// C-11 四面 busy 自愈回归：node tools/b4-c11-busy-selfheal-test.js
//
// 缺陷形状（final/findings.md ### C-11）：`busy` 是「这次写还没落地」的界面姿态，而 WXML 用它做
// `bindtap="{{busy ? '' : 'onSubmit'}}"` —— 一次提交（报名、发布活动）的 promise 没能回来时，
// 按钮就永久变成「看着能点、点了没反应」（铁律 21 点名的正是这个观感），用户只能退出页面重进。
// 已覆盖的 6 个面靠 `J.busyStale(busyAt, now)` 自愈，而 signup / editor / route-edit / me 四面
// 要么只写 busy 不写 busyAt（等于完全没有自愈），要么连在途标记都没有（连点两次发两条命令）。
//
// 判据只有一个出处：miniprogram/utils/journey.js 的 busyStale / BUSY_LIMIT_MS（铁律 31）。
// 本套件因此必须含**影子门**：改写 J.busyStale ⇒ 页面行为必须跟着变；页面若自己算时间差，
// 影子就改不动它 —— 那正是「单源」与「抄了一个长得一样的数」的分界。
//
// 手法（照 tools/scenario-editor-test.js 的 harness 思路，绝不在测试里镜像页面逻辑）：
//   stub global.wx → global.Page 捕获**真页面配置** → delete require.cache 强读最新源码
//   → monkey-patch utils/api 的 dispatchAndSync / dispatch / read。
// 判据是「这条命令到底发出去了几次」，不是「busy 这个键在 data 里存在」。
//
// 双向必备（只测一边都会放过一种病）：
//   ① 在途时第二次操作 ⇒ 命令数不增（防重复提交）
//   ② busyAt 超过 BUSY_LIMIT_MS ⇒ 第三次操作必须能发出命令（防永久锁死 = 本条原 bug）
//
// 求值点：写命令入口处（handler 进入时），不是 reload()。理由——editor / route-edit 两面
// 连 onShow/onReady 都没有；而写悬死时 revision 不会前进，挂在 reload 上的自愈正好等不到求值。
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const api = require('../miniprogram/utils/api')
const J = require('../miniprogram/utils/journey')

const FILES = {
  signup: path.join(ROOT, 'miniprogram/pages/signup/signup.js'),
  editor: path.join(ROOT, 'miniprogram/pages/editor/editor.js'),
  'route-edit': path.join(ROOT, 'miniprogram/pages/route-edit/route-edit.js'),
  me: path.join(ROOT, 'miniprogram/pages/me/me.js'),
}
// 6 个已覆盖面：本轮一条都不许动，这里只钉「仍在消费单源判据」（求值位置归 requests，不在本门里）
const COVERED = [
  'miniprogram/pages/activity/activity.js',
  'miniprogram/pages/vehicle/vehicle.js',
  'miniprogram/pages/workspace/workspace.js',
  'miniprogram/components/field-panel/field-panel.js',
  'miniprogram/components/roster-panel/roster-panel.js',
  'miniprogram/components/transport-panel/transport-panel.js',
]

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const flush = () => new Promise(r => setImmediate(r))
async function settle(n) {
  const times = n || 8
  for (let i = 0; i < times; i++) await flush()
}
// 推进时钟（模拟「promise 一直没回来，用户又点了一次」）：只在这段同步代码里生效
function advanceClock(ms, fn) {
  const real = Date.now
  Date.now = () => real() + ms
  try { return fn() } finally { Date.now = real }
}
// ---- wx 桩 ----
function makeWx() {
  const store = { 'ourtrail.openid': 'u-b4c11' }
  const rec = { toasts: [], nav: [] }
  global.wx = {
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push((o && o.title) || ''),
    navigateTo: o => rec.nav.push((o && o.url) || ''),
    redirectTo: o => rec.nav.push((o && o.url) || ''),
    switchTab: o => rec.nav.push((o && o.url) || ''),
    navigateBack: () => rec.nav.push('back'),
    chooseMessageFile: () => {},
    vibrateShort: () => {},
  }
  return rec
}

// ---- 网络桩：判据「命令发出去几次」就在这里 ----
const net = { cmds: [], aux: [] }
function installNet() {
  api.dispatchAndSync = (payload, revision) => {
    const rec = { payload, revision, resolve: null, reject: null }
    rec.promise = new Promise((res, rej) => { rec.resolve = res; rec.reject = rej })
    net.cmds.push(rec)
    return rec.promise
  }
  // signup 的资料回写链走 api.dispatch —— 它是辅助写，不进「这条命令发了几次」的判据
  api.dispatch = payload => {
    net.aux.push(payload)
    return Promise.resolve({ targetIds: ['aux'], revision: 42 })
  }
  api.read = req => {
    if (req.kind === 'profile') {
      return Promise.resolve({
        view: { kind: 'profile', profile: { id: 'p1', person: { name: '张三', phone: '13800000000' }, companions: [] } },
        revision: 7,
      })
    }
    return Promise.resolve({ view: { kind: 'denied', message: '无权访问' }, revision: 7 })
  }
}
// 写命令落库的返回值（各页面都读 revision / targetIds）
const WRITE_OK = { targetIds: ['t-1'], replayed: false, revision: 8 }

// ---- 真页面实例 ----
function makePage(file) {
  makeWx()
  global.Page = cfg => { global.__B4_C11_CFG = cfg }
  delete require.cache[require.resolve(file)]
  require(file)
  const cfg = global.__B4_C11_CFG
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

// 每个写点的夹具：page + 触发它的那个真 handler + 期望发出的命令类型 + 失败话术落在哪个字段
function person(name, phone, ename, ephone) {
  return { name, phone, emergency: { name: ename || '王五', phone: ephone || '13700000000' }, medical: '', avatar: '' }
}
function ownPart() {
  return {
    key: 'u:p1', kindLabel: '本人', personRef: { kind: 'user', userId: 'p1' },
    person: person('张三', '13800000000'),
    trip: { mode: 'self' },
    consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
    complete: true, pickupIndex: -1, tripSummary: '自行前往', checked: true,
  }
}
// editor 的「必填齐了」表单（toForm 的产出形状，取自 scenario-editor-test 的同名夹具）
function completeForm() {
  return {
    title: '青城后山 · 周末轻徒步', description: '', organizerIntro: '',
    capacity: '20', approvalMode: 'manual', acceptingSignups: true,
    routeTitle: '飞泉沟环线', distanceKm: '12.5', ascentM: '900',
    points: [{ id: 'pt-1', name: '起点', kind: 'start', lat: '30.9', lng: '103.5', time: '', ele: null }],
    risks: [{ id: 'rk-1', title: '垭口风大', advice: '备防风衣物', severity: '', coordinates: null }],
    track: [],
    pickups: [{ id: 'pk-1', name: '犀浦站', address: '地铁 A 口', lat: '30.8', lng: '103.7', meeting: { date: '2026-10-03', time: '07:30' } }],
    equipmentText: '', feeNote: '', cancellationNote: '',
    dt_start: { date: '2026-10-03', time: '08:00' },
    dt_end: { date: '2026-10-03', time: '16:00' },
    dt_deadline: { date: '2026-10-02', time: '08:00' },
  }
}
function routeForm() {
  return {
    title: '九顶山脊线', distanceKm: '8', ascentM: '600',
    points: [{ id: 'p1', name: '垭口', kind: 'pass', lat: '31.1', lng: '103.8', time: '', ele: null }],
    risks: [], track: [],
  }
}

const POINTS = [
  {
    id: 'signup.submit', face: 'signup', label: '提交报名（onSubmit）', errField: 'failure',
    boot() {
      const page = makePage(FILES.signup)
      page.activityId = 'a1'
      page.revision = 5
      page.profilePerson = person('张三', '13800000000')
      page.setData({ loading: false, denied: '', participants: [ownPart()], keepTogether: true })
      return { page, drive: () => page.onSubmit(), type: 'signup.submit' }
    },
  },
  {
    id: 'signup.edit', face: 'signup', label: '保存报名修改（onEditSubmit）', errField: 'failure',
    boot() {
      const page = makePage(FILES.signup)
      page.activityId = 'a1'
      page.signupId = 's1'
      page.revision = 5
      page.profilePerson = person('张三', '13800000000')
      page.setData({
        loading: false, denied: '', mode: 'edit',
        editForm: {
          signupId: 's1', personRef: { kind: 'user', userId: 'p1' },
          person: person('张三', '13800000000'), trip: { mode: 'self' },
          consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
        },
      })
      return { page, drive: () => page.onEditSubmit(), type: 'signup.edit' }
    },
  },
  {
    id: 'editor.create', face: 'editor', label: '保存草稿（onSave → persistCurrent）', errField: 'failure',
    boot() {
      const page = makePage(FILES.editor)
      page.revision = 3
      page.setData({ loading: false, denied: '', form: completeForm(), phase: 'draft', savedId: '' })
      return { page, drive: () => page.onSave(), type: 'activity.create' }
    },
  },
  {
    id: 'editor.publish-intent', face: 'editor', label: '发布预检（onPublishIntent）', errField: 'failure',
    boot() {
      const page = makePage(FILES.editor)
      page.revision = 3
      page.setData({ loading: false, denied: '', form: completeForm(), phase: 'draft', savedId: '' })
      return { page, drive: () => page.onPublishIntent(), type: 'activity.create' }
    },
  },
  {
    id: 'editor.copy', face: 'editor', label: '创建模板副本（onCopyTemplate）', errField: 'failure',
    boot() {
      const page = makePage(FILES.editor)
      page.revision = 3
      page.setData({ loading: false, denied: '', templateId: 'tpl-9' })
      return { page, drive: () => page.onCopyTemplate(), type: 'activity.copy' }
    },
  },
  {
    id: 'editor.delete', face: 'editor', label: '确认删除草稿（onDeleteDraftConfirm）', errField: 'failure',
    boot() {
      const page = makePage(FILES.editor)
      page.savedId = 'a-draft'
      page.revision = 3
      page.setData({ loading: false, denied: '', form: completeForm(), deleteDraftOpen: true })
      return { page, drive: () => page.onDeleteDraftConfirm(), type: 'activity.delete' }
    },
  },
  {
    id: 'editor.publish', face: 'editor', label: '确认发布（publish → doPublish）', errField: 'failure',
    boot() {
      const page = makePage(FILES.editor)
      page.savedId = 'a-draft'
      page.revision = 3
      page.setData({ loading: false, denied: '', form: completeForm(), publishOpen: true, participate: false })
      return { page, drive: () => page.publish(), type: 'activity.publish' }
    },
  },
  {
    id: 'route-edit.create', face: 'route-edit', label: '存入路线库（onSave）', errField: 'failure',
    boot() {
      const page = makePage(FILES['route-edit'])
      page.revision = 1
      page.setData({ loading: false, denied: '', isNew: true, form: routeForm() })
      return { page, drive: () => page.onSave(), type: 'route.create' }
    },
  },
  {
    id: 'me.companion-save', face: 'me', label: '保存常用同行人（onCompanionSave）', errField: 'companionError',
    boot() {
      const page = makePage(FILES.me)
      page.revision = 1
      page.setData({
        loading: false, denied: '', companionOpen: true, companionId: 'c1',
        companionPerson: { name: '李四', phone: '13900000000', emergency: { name: '', phone: '' }, medical: '', avatar: '' },
      })
      return { page, drive: () => page.onCompanionSave(), type: 'companion.save' }
    },
  },
  {
    id: 'me.companion-remove', face: 'me', label: '移除常用同行人（onRemoveConfirm）', errField: 'companionError',
    boot() {
      const page = makePage(FILES.me)
      page.revision = 1
      page.setData({ loading: false, denied: '', removeId: 'c7' })
      return { page, drive: () => page.onRemoveConfirm(), type: 'companion.remove' }
    },
  },
  {
    id: 'me.position-revoke', face: 'me', label: '撤回位置授权（onRevoke）', errField: 'error',
    boot() {
      const page = makePage(FILES.me)
      page.revision = 1
      page.setData({ loading: false, denied: '' })
      return {
        page,
        drive: () => page.onRevoke({ currentTarget: { dataset: { activityId: 'a1', signupId: 's1' } } }),
        type: 'position.revoke',
      }
    },
  },
]

const typesOf = () => net.cmds.map(c => c.payload.type)

// 每个写点跑一遍「先装网络桩再驱动夹具」
function fresh(point) {
  installNet()
  net.cmds = []
  net.aux = []
  const ctx = point.boot()
  return { page: ctx.page, drive: ctx.drive, type: ctx.type }
}

async function main() {
  section('§0 单源判据存在 + 阳性对照（每个写点第一次操作真的发出命令；不过就说明夹具在空跑）')
  check('journey.js 导出 busyStale 函数（本套件的影子门要打的对象）', typeof J.busyStale === 'function')
  check('journey.js 导出 BUSY_LIMIT_MS 且是正整数', Number.isInteger(J.BUSY_LIMIT_MS) && J.BUSY_LIMIT_MS > 0,
    String(J.BUSY_LIMIT_MS))
  const positives = []
  for (const p of POINTS) {
    const { page, drive, type } = fresh(p)
    drive()
    await settle()
    const ok = net.cmds.length === 1 && net.cmds[0].payload.type === type
    positives.push(ok)
    check('阳性对照 ' + p.label + ' ⇒ 恰好 1 条 ' + type, ok,
      JSON.stringify({ cmds: typesOf(), busy: page.data.busy }))
  }
  const positiveAll = positives.every(Boolean)
  check('全部 ' + POINTS.length + ' 个写点阳性对照通过（否则整轮判为无效，不许靠"后续断言也红"蒙过去）',
    positiveAll, positives.map((v, i) => (v ? '' : POINTS[i].id)).filter(Boolean).join(','))
  if (!positiveAll) {
    console.error('== 有效性门未过：后续断言全部不可信 ==')
    console.log('passed=' + passed + ' failed=' + failed)
    process.exit(1)
  }

  section('§1 busy 与 busyAt 成对写入（每次置忙都必须带上时间戳，否则 busyStale(undefined) 立刻判残留）')
  for (const p of POINTS) {
    const { page, drive } = fresh(p)
    drive()
    await settle()
    const pairs = page._patches.filter(pt => pt.busy === true)
    const badPair = pairs.filter(pt => !(typeof pt.busyAt === 'number' && pt.busyAt > 0))
    check('成对门 ' + p.label + ' ⇒ busy:true 的 setData 共 ' + pairs.length + ' 处，未带 busyAt 的 ' + badPair.length + ' 处',
      pairs.length === 1 && badPair.length === 0,
      JSON.stringify(pairs.map(pt => Object.keys(pt))))
    check('置忙后 busyAt 是新鲜时间戳 ' + p.label,
      page.data.busy === true && Math.abs(page.data.busyAt - Date.now()) < 5000,
      JSON.stringify({ busy: page.data.busy, busyAt: page.data.busyAt }))
  }
  // 声明面：四个面的 data 里都要有 busyAt 初值（否则首次 setData 之前 data.busyAt 是 undefined）
  for (const face of Object.keys(FILES)) {
    const page = makePage(FILES[face])
    check('声明门 ' + face + ' ⇒ data.busyAt 初值存在且非 undefined',
      Object.prototype.hasOwnProperty.call(page.data, 'busyAt'), JSON.stringify(page.data.busyAt))
  }

  section('§2 在途拦截（第一次写还没回来 ⇒ 第二次操作不得再发命令，防重复提交）')
  for (const p of POINTS) {
    const { page, drive, type } = fresh(p)
    drive()
    drive()
    drive()
    await settle()
    check('在途门 ' + p.label + ' ⇒ 连点三次只发出 1 条命令',
      net.cmds.length === 1 && net.cmds[0].payload.type === type,
      JSON.stringify(typesOf()) + ' busy=' + page.data.busy)
  }

  section('§3 残留放行（busyAt 超过单源宽限期 ⇒ 下一次操作必须发得出命令，防永久锁死 = C-11 原 bug）')
  for (const p of POINTS) {
    const { page, drive, type } = fresh(p)
    drive()
    drive()
    await settle()
    check('残留前置门 ' + p.label + ' ⇒ 在途时确实是拦住的（不然是空跑）', net.cmds.length === 1, JSON.stringify(typesOf()))
    advanceClock(J.BUSY_LIMIT_MS + 2000, drive)
    await settle()
    check('残留放行 ' + p.label + ' ⇒ 宽限期后第二次操作发出第 2 条 ' + type,
      net.cmds.length === 2 && net.cmds[1].payload.type === type,
      JSON.stringify(typesOf()))
    check('复位后重新成对 ' + p.label,
      page.data.busy === true && page.data.busyAt > 0,
      JSON.stringify({ busy: page.data.busy, busyAt: page.data.busyAt }))
    check('残留复位留痕 ' + p.label + ' ⇒ 途中出现一次 {busy:false, busyAt:0}',
      page._patches.some(pt => pt.busy === false && pt.busyAt === 0))
  }

  section('§4 两条路径都复位 busy（resolve / reject 都不许把界面留在「正在…」）')
  const resetOk = []
  for (const p of POINTS) {
    const a = fresh(p)
    a.drive()
    await settle()
    check('成功用例前置门 ' + p.label + ' ⇒ 命令已发出且界面在「正在…」态',
      net.cmds.length === 1 && a.page.data.busy === true, JSON.stringify(typesOf()))
    // 前置门不过也要继续跑（断言会红），不许在索引上崩掉 —— 崩溃不算抓到，只是把判据弄瞎
    if (net.cmds[0]) net.cmds[0].resolve(WRITE_OK)
    await settle()
    check('成功路径复位 ' + p.label + ' ⇒ busy 回 false', a.page.data.busy === false,
      JSON.stringify({ busy: a.page.data.busy, busyAt: a.page.data.busyAt }))
    const b = fresh(p)
    b.drive()
    await settle()
    if (net.cmds[0]) net.cmds[0].reject(new Error('云函数这次没有回话'))
    await settle()
    const said = String(b.page.data[p.errField] || '')
    check('失败路径复位 ' + p.label + ' ⇒ busy 回 false 且给了原因',
      b.page.data.busy === false && said !== '',
      JSON.stringify({ busy: b.page.data.busy, field: p.errField, said: said.slice(0, 30) }))
    resetOk.push(b.page.data.busy === false && said !== '' && a.page.data.busy === false)
  }
  check('两条路径复位：全部写点通过', resetOk.every(Boolean), resetOk.filter(Boolean).length + '/' + resetOk.length)

  section('§5 影子门（判据必须住在 J.busyStale 里：改它 ⇒ 四个面的行为跟着改，绕过去就不算单源）')
  const SHADOW = ['signup.submit', 'editor.create', 'route-edit.create', 'me.companion-save']
  const realBusyStale = J.busyStale
  for (const id of SHADOW) {
    const p = POINTS.find(x => x.id === id)
    // S1：判据恒「不残留」 ⇒ 即使时间早已越过宽限期也必须继续拦（页面自己算时间就会在这里放行）
    const a = fresh(p)
    a.drive()
    await settle()
    J.busyStale = () => false
    try { advanceClock(J.BUSY_LIMIT_MS + 60000, a.drive) } finally { J.busyStale = realBusyStale }
    await settle()
    check('S1 影子把判据钉成"永不残留" ' + p.label + ' ⇒ 第三次操作仍被拦（命令数不变）',
      net.cmds.length === 1, JSON.stringify(typesOf()))
    // S2：判据恒「残留」 ⇒ 刚写入的时间戳也必须放行（页面不理 J.busyStale 就会继续拦）
    const b = fresh(p)
    b.drive()
    await settle()
    J.busyStale = () => true
    try { b.drive() } finally { J.busyStale = realBusyStale }
    await settle()
    check('S2 影子把判据钉成"永远残留" ' + p.label + ' ⇒ 第二次操作立刻放行（命令数 +1）',
      net.cmds.length === 2, JSON.stringify(typesOf()))
  }
  check('影子还原后判据仍是原函数', J.busyStale === realBusyStale)

  section('§6 me 的自动保存在途标记（_saving）同属一条铁律：残留不得永久拦路')
  {
    installNet()
    net.cmds = []
    const page = makePage(FILES.me)
    page.revision = 1
    page.setData({
      loading: false, denied: '',
      person: { name: '张三', phone: '13800000000', emergency: { name: '', phone: '' }, medical: '', avatar: '' },
    })
    page.persistPerson({ silent: true })
    check('阳性对照：自动保存发出 profile.save', net.cmds.length === 1 && net.cmds[0].payload.type === 'profile.save',
      JSON.stringify(typesOf()))
    page.persistPerson({ silent: true })
    check('在途时第二次自动保存不发（防重复落库）', net.cmds.length === 1, JSON.stringify(typesOf()))
    advanceClock(J.BUSY_LIMIT_MS + 2000, () => page.persistPerson({ silent: true }))
    check('宽限期后自动保存恢复发命令（残留不锁死输入链）', net.cmds.length === 2, JSON.stringify(typesOf()))
    // 复位断言只在第二条命令真的发出时才有意义；不许因为变异导致的缺命令而崩掉整个套件
    if (net.cmds[1]) {
      net.cmds[1].resolve(WRITE_OK)
      await settle()
      check('成功后 saving 复位', page.data.saving === false && page._saving === false)
    } else {
      check('成功后 saving 复位（跳过：没有第 2 条命令可结算）', false, JSON.stringify(typesOf()))
    }
  }

  section('§7 静态门（代码形状：单源、无第二实现、无裸 busy 门、成对写入不漏行）')
  // 把行注释剥掉，让门只对代码敏感（注释里写「8 秒」「第二个 8000」是说明，不是实现）
  const codeOf = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => {
    const i = line.indexOf('//')
    return i >= 0 ? line.slice(0, i) : line
  }).join('\n')
  const EXPECT_SET_BUSY = { signup: 2, editor: 4, 'route-edit': 1, me: 3 }
  for (const face of Object.keys(FILES)) {
    const src = fs.readFileSync(FILES[face], 'utf8')
    const code = codeOf(FILES[face])
    check(face + ' 消费单源判据 J.busyStale', code.indexOf('J.busyStale(') !== -1)
    check(face + ' 引入 utils/journey', /require\('\.\.\/\.\.\/utils\/journey'\)/.test(src))
    check(face + ' 代码里没有第二个 8000 字面量', !/\b8000\b/.test(code),
      (code.match(/.{0,40}\b8000\b.{0,40}/) || [''])[0])
    check(face + ' 代码里没有自己算 busyAt 的时间差（elapsed 只有 J.busyStale 一个出处）',
      !/Date\.now\(\)\s*-\s*[\w.]*busyAt|[\w.]*busyAt\s*-\s*Date\.now\(\)|Date\.now\(\)\s*-\s*this\._savingAt/.test(code),
      (code.match(/.{0,48}Date\.now\(\)\s*-\s*[\w.]*busyAt.{0,24}/) || [''])[0])
    check(face + ' 没有残留的裸 busy 门 `if (this.data.busy) return`（它不会自愈）',
      !/if\s*\(\s*this\.data\.busy\s*\)\s*return/.test(code),
      (code.match(/.{0,32}if\s*\(\s*this\.data\.busy\s*\)\s*return.{0,16}/) || [''])[0])
    // 成对写入：每一处 busy: true 所在的那个 setData 对象里必须有 busyAt（跨行也认）
    const lines = code.split('\n')
    let setBusy = 0
    const unpaired = []
    lines.forEach((line, idx) => {
      if (line.indexOf('busy: true') === -1) return
      setBusy++
      let window = line
      let k = idx
      while (window.indexOf('})') === -1 && k + 1 < lines.length && window.length < 260) {
        k++
        window += '\n' + lines[k]
      }
      if (window.indexOf('busyAt') === -1) unpaired.push(idx + 1)
    })
    check(face + ' 的 busy:true 写入点全部与 busyAt 成对（实测 ' + setBusy + ' 处，未配对：' + (unpaired.join(',') || '无') + '）',
      unpaired.length === 0)
    check(face + ' 的 busy:true 处数与登记一致（期望 ' + EXPECT_SET_BUSY[face] + '，实测 ' + setBusy + '）',
      setBusy === EXPECT_SET_BUSY[face])
  }
  const coveredMiss = COVERED.filter(rel => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    return src.indexOf('J.busyStale(') === -1
  })
  check('6 个已覆盖面仍在消费单源判据（本轮不许顺手改它们）', coveredMiss.length === 0, coveredMiss.join(','))

  console.log('passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error('套件自身异常（崩溃不算抓到，判为本轮无效）：' + (e && e.stack || e))
  process.exit(1)
})
