// Phase 9 §14 工作台/面板 revision 同步回归：node tools/e2e-panel-sync-test.js
//
// 被测对象是真的：pages/workspace/workspace.js + roster/transport/field 三个常驻面板 +
// utils/api.js（未 monkey-patch）→ wx.cloud 桥 → 真 trailApi（index/domain/store），DB 为内存桩。
//
// 与 tools/scenario-workspace-test.js 的分工：那套管的是命令面与渲染态（视图用合成 fixture）；
// 本套管的是**跨面板的 revision 生命周期**——视图来自真云端、revision 是真推进的全局值，
// 因此能问出「A 面板写完，B 面板下一次命令带的是哪个 revision」「宿主 reload 失败被
// .catch(()=>{}) 吞掉之后，面板是静默陈旧还是 fail closed」。
//
// 框架语义的桩边界（如实声明，不假装成真机）：
//   · WXML 的 sync-key="{{syncKey}}" 属性绑定由本套件的 wire() 手动推送（框架会在 setData 后调
//     observer）；面板的 observer / reload / 读写全是仓库里的真代码。
//   · bind:written 用组件的 triggerEvent 转发到宿主的 onPanelSync。
//   · 内存桩写入即刻可见 ⇒ 证不了真云端的分页读滞后（那一栏在 §8 的真云端量测里出）。
'use strict'
const path = require('path')
const Module = require('module')

const STUB = path.join(__dirname, 'stub-wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return STUB
  return origResolve.call(this, request, ...rest)
}
const stub = require('./stub-wx-server-sdk')
stub.__state.db = stub.__fakeDb()
const trailApi = require('../cloudfunctions/trailApi/index')
const api = require('../miniprogram/utils/api')

const P_PAGE = require.resolve('../miniprogram/pages/workspace/workspace.js')
const P_ROSTER = require.resolve('../miniprogram/components/roster-panel/roster-panel.js')
const P_TRANSPORT = require.resolve('../miniprogram/components/transport-panel/transport-panel.js')
const P_FIELD = require.resolve('../miniprogram/components/field-panel/field-panel.js')

let passed = 0
let failed = 0
let bugs = 0
const findings = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + String(extra).slice(0, 220) + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function finding(id, level, text) { findings.push([id, level, text]); console.log('  ▶ [' + level + ' · ' + id + '] ' + text) }
function bugCheck(id, title, stillBroken, evidence) {
  if (stillBroken) { bugs++; console.error('  ✗ [CONFIRMED BUG ' + id + '] ' + title) }
  else { console.error('  ⚠ [DRIFT ' + id + '] 探针已转绿：请转成正式断言') }
  findings.push([id, stillBroken ? 'BUG（红测常驻）' : 'DRIFT（需转正）', title])
  if (evidence) console.error('      证据：' + String(evidence).slice(0, 240))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 3000
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return !!cond()
}

/* ---------- 客户端 ↔ 真云函数 ---------- */
const ORG = 'o-organizer'
const net = { calls: [], dispatches: [] }
let failNextRead = false
const ui = { toasts: [] }
{
  const storage = {}
  global.wx = {
    cloud: { callFunction: ({ name, data }) => {
      const rec = { name, data, action: data && data.action }
      net.calls.push(rec)
      if (rec.action === 'dispatch') net.dispatches.push(rec)
      stub.__state.openid = ORG
      if (rec.action === 'read' && failNextRead) {
        return Promise.reject(new Error('注入的读失败：network down'))
      }
      return trailApi.main(Object.assign({}, data)).then(r => { rec.result = r; return { result: r } })
    } },
    setNavigationBarTitle: () => {},
    pageScrollTo: () => {},
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : ''),
    setStorageSync: (k, v) => { storage[k] = v },
    removeStorageSync: k => { delete storage[k] },
    showToast: o => { ui.toasts.push((o && o.title) || '') },
    setClipboardData: o => { if (o && o.success) setImmediate(o.success) },
    navigateTo: () => {}, redirectTo: () => {}, switchTab: () => {},
    vibrateShort: () => {}, chooseLocation: () => {},
  }
}
async function cloud(action, data) {
  stub.__state.openid = ORG
  const r = await trailApi.main(Object.assign({ action }, data || {}))
  if (!r.ok) { const e = new Error(r.error && r.error.message); e.code = r.error && r.error.code; throw e }
  return r.data
}
const revNow = async id => (await cloud('read', { request: { kind: 'activity', activityId: id, perspective: 'organizer' } })).revision

/* ---------- 实例构造（与 scenario-workspace-test 同法） ---------- */
function cfgOf(p, hook) {
  global[hook] = c => { global.__CFG = c }
  delete require.cache[p]
  require(p)
  return global.__CFG
}
function makeInstance(cfg, props) {
  const inst = Object.assign({}, cfg, cfg.methods || {})
  inst.data = Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), props || {})
  inst.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) setImmediate(cb) }
  return inst
}

/** 一套工作台：宿主页 + 三个常驻面板，属性绑定用 wire 手动推送 */
function bootWorkspace(activityId) {
  const page = makeInstance(cfgOf(P_PAGE, 'Page'))
  const panels = {}
  const pushSyncKey = key => {
    for (const p of Object.values(panels)) {
      if (p.data.syncKey !== key) { p.data.syncKey = key; if (p.observers && p.observers.syncKey) p.observers.syncKey.call(p, key) }
    }
  }
  const hostTriggerEvent = () => { page.onPanelSync && page.onPanelSync() }
  for (const [kind, p] of [['roster', P_ROSTER], ['transport', P_TRANSPORT], ['field', P_FIELD]]) {
    const c = makeInstance(cfgOf(p, 'Component'), { activityId, syncKey: '' })
    c._loading = false
    c.triggerEvent = (ev) => { if (ev === 'written') hostTriggerEvent() }
    panels[kind] = c
  }
  // 宿主 setData 里出现 syncKey 就推给面板（模拟 WXML 属性绑定）
  const rawSetData = page.setData.bind(page)
  page.setData = function (patch, cb) {
    rawSetData(patch, cb)
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'syncKey')) pushSyncKey(patch.syncKey)
  }
  page.onLoad({ id: activityId })
  if (page.onShow) page.onShow()    // workspace 的 reload 挂在 onShow 上，只调 onLoad 永远读不到
  return { page, panels, pushSyncKey }
}
async function settleAll(env) {
  await waitFor(() => env.page.data.loading === false)
  for (const p of Object.values(env.panels)) await waitFor(() => p.data.loading === false || p._loading === false, 4000)
  await sleep(20)
}

const person = (name, phone, en, ep) => ({ name, phone, emergency: { name: en, phone: ep }, medical: '', avatar: '' })
function input(tag) {
  return {
    title: tag + ' 标题', description: tag + ' 说明', organizerIntro: '自动化',
    startAt: '2027-03-06T08:00:00+08:00', endAt: '2027-03-06T18:00:00+08:00', deadlineAt: '2027-03-05T20:00:00+08:00',
    acceptingSignups: true, capacity: 12, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [{ id: 'pk-1', name: '东门', meetingAt: '2027-03-06T07:00:00+08:00', address: 'x', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '',
  }
}

let ACT = ''
async function quiesce() {
  await waitFor(() => net.dispatches.every(d => d.result !== undefined))
  await sleep(10)
}
/** 走 roster 面板的真导出入口：选中第一行 → 填用途 → 确认（发出 export.record）。
 *  选它是因为导出对任何已确认行都合法，不需要第二身份（桩的 openid 是模块级全局，跨身份并发不可靠）。 */
async function rosterExport(env, purpose) {
  const roster = env.panels.roster
  const first = ((roster.view && roster.view.rows) || [])[0]
  if (!first) throw new Error('面板视图里没有可选行（reload 未成功？）')
  roster.setData({ selected: { [first.signupId]: true }, exportOpen: true, exportIndex: 0, exportPurpose: purpose, busy: false, error: '' })
  const d0 = net.dispatches.length
  roster.onExportConfirm()
  const sent = await waitFor(() => net.dispatches.length > d0)
  await quiesce()
  return { rec: net.dispatches[net.dispatches.length - 1], sent }
}

async function main() {
  /* ---------- 夹具：published + 2 名已确认（面板命令需要真名单） ---------- */
  section('P0 夹具（真信封：建档 → 建活动 → 发布并报名 → 第二人报名并确认）')
  await cloud('dispatch', { payload: { type: 'profile.save', person: person('林溪', '00000000001', '林母', '00000000051') } })
  const seed = (await cloud('read', { request: { kind: 'profile' } })).revision
  const created = await cloud('dispatch', { payload: { type: 'activity.create', input: input('P 工作台') }, expectedRevision: seed })
  ACT = created.targetIds[0]
  const prof = (await cloud('read', { request: { kind: 'profile' } })).view.profile
  const pub = await cloud('dispatch', { payload: { type: 'activity.publish', activityId: ACT, participation: {
    personRef: { kind: 'user', userId: ORG }, participant: prof.person, trip: { mode: 'shared', pickupPointId: 'pk-1' },
    consent: { dataUse: true, proxyAuthority: false, proxyHome: false } } }, expectedRevision: created.revision })
  // cloud() 失败即抛，返回体就是信封 data：用「revision 恰好 +1」当作成功判据，不看 r.ok
  check('P0 发布 ok（发起者本人报名，shared 出行需要座位 ⇒ 分车面板有活干）',
    pub.revision === created.revision + 1, JSON.stringify(pub))
  const v0 = (await cloud('read', { request: { kind: 'activity', activityId: ACT, perspective: 'organizer' } })).view
  check('P0 名单里有 1 名已确认参与者', v0.counters.confirmed === 1 && v0.rows.length === 1, JSON.stringify(v0.counters))
  const R0 = await revNow(ACT)

  /* ---------- P1 初挂：宿主与三个面板必须拿到同一个 revision ---------- */
  section('P1 初挂同步：宿主 syncKey 与三个面板的 this.revision 成对')
  const env = bootWorkspace(ACT)
  await settleAll(env)
  check('P1 宿主页面读成功（denied 为空、syncKey 已下发）',
    !env.page.data.denied && env.page.data.syncKey === 'published@' + R0, JSON.stringify(env.page.data.syncKey))
  for (const kind of ['roster', 'transport', 'field']) {
    check('P1 ' + kind + '-panel 初始 revision = 服务端 R0（不是 undefined）',
      env.panels[kind].revision === R0, JSON.stringify({ got: env.panels[kind].revision, want: R0 }))
    check('P1 ' + kind + '-panel 的 _readKey 与宿主 syncKey 一致（否则 observer 会漏跳一次重读）',
      env.panels[kind]._readKey === 'published@' + R0, JSON.stringify(env.panels[kind]._readKey))
  }

  /* ---------- P2 面板写 → 全局 revision 推进 → 兄弟面板必须跟着重读 ---------- */
  section('P2 roster 写完一枪，transport/field 下一次命令必须带新 revision')
  {
    const before = R0
    const { rec, sent } = await rosterExport(env, 'P2 交错测试')
    check('P2 roster 的导出命令确实发出', sent, '新增=' + (net.dispatches.length))
    check('P2 roster 命令带整数 expectedRevision=R0',
      rec.data.expectedRevision === before, JSON.stringify({ got: rec.data.expectedRevision, want: before }))
    check('P2 roster 命令被服务端接受', rec.result && rec.result.ok === true, JSON.stringify(rec.result && rec.result.error))
    const R1 = await revNow(ACT)
    check('P2 服务端 revision 推进 R0→R0+1', R1 === before + 1, before + '→' + R1)
    check('P2 written 事件把宿主重读拉起来，syncKey 已更新', env.page.data.syncKey === 'published@' + R1,
      JSON.stringify(env.page.data.syncKey))
    await settleAll(env)
    for (const kind of ['roster', 'transport', 'field']) {
      check('P2 ' + kind + '-panel 跟着重读拿到 R1（兄弟面板不再拿旧 revision 发命令）',
        env.panels[kind].revision === R1, JSON.stringify({ kind, got: env.panels[kind].revision, want: R1 }))
    }
  }

  /* ---------- P3 同面板连点：两条命令携带同一个 revision ---------- */
  section('P3 同一面板连点两下（Phase 8 的 R2 结论转正为常驻断言）')
  {
    // 面板的 busy 门会把第二次点击吃掉；要复现"两条命令同一个 revision"这一连点竞态窗口，
    // 在两下之间把面板的 revision 按回它读到的旧值（上一条已推进、面板尚未刷新）。
    const { rec: first } = await rosterExport(env, 'P3 第一下')
    const roster = env.panels.roster
    roster.revision = first.data.expectedRevision
    const { rec: second } = await rosterExport(env, 'P3 第二下')
    check('P3 两条命令携带同一个 expectedRevision（同面板连点的必然形状）',
      second.data.expectedRevision === first.data.expectedRevision,
      JSON.stringify({ first: first.data.expectedRevision, second: second.data.expectedRevision }))
    const r1ok = first.result && first.result.ok === true
    const r2 = second.result && (second.result.ok === false ? second.result.error.code : 'OK')
    check('P3 第一条落库成功', r1ok === true, JSON.stringify(first.result && first.result.error))
    check('P3 第二条被 CONFLICT 拦住（不是静默覆盖，也不是双写）', r2 === 'CONFLICT', JSON.stringify(r2))
    check('P3 冲突后面板 toast 提示重试（用户不会看到"成功"）',
      ui.toasts.some(t => /刷新|重试|更新|没有保存/.test(t)), JSON.stringify(ui.toasts.slice(-3)))
    await quiesce()
    const Rnow = await revNow(ACT)
    check('P3 revision 只推进一次（败者没写进去）', Rnow === first.data.expectedRevision + 1,
      first.data.expectedRevision + '→' + Rnow)
  }

  /* ---------- P4 宿主 reload 失败被吞：面板必须 fail closed ---------- */
  section('P4 宿主 reload 失败被 api.js 的 .catch(()=>{}) 吞掉 ⇒ 面板只能拿旧 revision（判 fail closed）')
  {
    const env2 = bootWorkspace(ACT)
    await settleAll(env2)
    const Rbefore = env2.page.revision
    // 外部写入（另一个客户端）推进全局 revision
    const ext = await cloud('dispatch', { payload: { type: 'export.record', activityId: ACT, signupIds: (await cloud('read', { request: { kind: 'activity', activityId: ACT, perspective: 'organizer' } })).view.rows.map(x => x.signupId), mode: 'ordinary', purpose: '外部写入' }, expectedRevision: Rbefore })
    check('P4 外部写入 ok', ext.revision === Rbefore + 1, JSON.stringify(ext))
    const Rafter = await revNow(ACT)
    check('P4 外部写入把 revision 推进（面板对此毫不知情）', Rafter === Rbefore + 1, Rbefore + '→' + Rafter)
    // 现在让宿主读失败：注入一次读失败，然后触发一次面板写
    failNextRead = true
    env2.panels.roster.revision = Rbefore               // 面板仍持旧基线（宿主没重读 ⇒ syncKey 没变 ⇒ observer 没跳）
    Promise.resolve(env2.page.reload()).catch(() => {}) // 复刻 api.js:121 的吞法：reload 失败无人知晓
    failNextRead = false
    await settleAll(env2)
    check('P4 宿主 reload 失败后 syncKey 没更新（这就是被吞掉的后果）',
      env2.page.data.syncKey === 'published@' + Rbefore, JSON.stringify(env2.page.data.syncKey))
    const transport = env2.panels.transport
    const rec = await api.dispatchAndSync({ type: 'vehicle.save', activityId: ACT, vehicleId: null, input: {
      label: 'P4 车', plate: 'P41111', legalCapacity: 4, blockedSeats: 0,
      drivers: [{ kind: 'service', name: '司机', phone: '00000000011', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, Rbefore, transport)
      .then(x => ({ ok: true, res: x })).catch(e => ({ ok: false, err: e }))
    check('P4 陈旧基线的写被 CONFLICT 拦住 ⇒ fail closed（关键：不是 lost update）',
      rec.ok === false && rec.err && rec.err.code === 'CONFLICT', JSON.stringify(rec.err && rec.err.code))
    const Rfinal = await revNow(ACT)
    check('P4 陈旧写没推进 revision、也没建出车辆（零副作用）', Rfinal === Rafter, Rafter + '→' + Rfinal)
    const veh = (await cloud('readTransport', { activityId: ACT })).value.vehicles.filter(x => x.label === 'P4 车')
    check('P4 被拒的车辆确实不存在（否则就是静默双写）', veh.length === 0, JSON.stringify(veh))
    check('P4 冲突提示仍然会弹（用户被告知要重试，不是静默失败）',
      ui.toasts.some(t => /刷新|重试|更新|没有保存/.test(t)), JSON.stringify(ui.toasts.slice(-2)))
    // 面板按提示重试（重读拿到新基线）后必须能写成
    const retry = await api.dispatchAndSync({ type: 'vehicle.save', activityId: ACT, vehicleId: null, input: {
      label: 'P4 车', plate: 'P41111', legalCapacity: 4, blockedSeats: 0,
      drivers: [{ kind: 'service', name: '司机', phone: '00000000011', userId: null }], seatLabels: null, pickupPointIds: ['pk-1'] } }, Rfinal, transport).catch(e => ({ failed: e }))
    check('P4 重试（带新基线）成功 ⇒ 被吞掉的 reload 只多花一次冲突往返，不造成数据损失',
      retry && retry.revision === Rfinal + 1, JSON.stringify(retry && (retry.failed && retry.failed.code || retry.revision)))
  }

  /* ---------- P5 重开/再入：外部写过之后重开工作台，面板必须跟到新值 ---------- */
  section('P5 重开工作台（page re-entry）：syncKey 与三个面板全部跟到最新')
  {
    const env3 = bootWorkspace(ACT)
    await settleAll(env3)
    const Rnow = await revNow(ACT)
    check('P5 重开后宿主 syncKey = published@最新 revision', env3.page.data.syncKey === 'published@' + Rnow,
      JSON.stringify(env3.page.data.syncKey))
    for (const kind of ['roster', 'transport', 'field']) {
      check('P5 ' + kind + '-panel 重开后 revision = 最新', env3.panels[kind].revision === Rnow,
        JSON.stringify({ kind, got: env3.panels[kind].revision, want: Rnow }))
    }
    // 面板持有的读键必须与 syncKey 一致，否则 observer 判定"已同步"而漏重读
    check('P5 三个面板的 _readKey 全部与 syncKey 相等（漏跳重读的那条形变已被钉住）',
      ['roster', 'transport', 'field'].every(k => env3.panels[k]._readKey === env3.page.data.syncKey),
      JSON.stringify(['roster', 'transport', 'field'].map(k => env3.panels[k]._readKey)))
  }

  /* ---------- P6 editor 与 workspace 同活动并存（真机 BUG-C1 的复现形状） ---------- */
  section('P6 编辑器与工作台的 revision 互不共享：各自成对抓取、各自 CAS')
  {
    const env4 = bootWorkspace(ACT)
    await settleAll(env4)
    const RB = await revNow(ACT)
    const ED_PATH = require.resolve('../miniprogram/pages/editor/editor.js')
    const editor = makeInstance(cfgOf(ED_PATH, 'Page'))
    editor.onLoad({ id: ACT })
    await waitFor(() => editor.data.loading === false)
    check('P6 编辑器与工作台各自抓到同一个当前 revision',
      editor.revision === RB && env4.page.revision === RB, JSON.stringify({ ed: editor.revision, ws: env4.page.revision }))
    // 工作台面板先写一枪（走面板真入口）
    const wRec = (await rosterExport(env4, 'P6 工作台先写')).rec
    check('P6 工作台面板的写成功并推进',
      wRec.result && wRec.result.ok === true && wRec.result.data.revision === RB + 1,
      JSON.stringify(wRec.result && (wRec.result.ok ? wRec.result.data : wRec.result.error)))
    // 编辑器随后用自己的表单保存：它携带的必须仍是它装配表单时的 RB ⇒ 被拒
    const d0 = net.dispatches.length
    editor.onSave()
    await waitFor(() => net.dispatches.length > d0)
    await quiesce()
    const edRec = net.dispatches[net.dispatches.length - 1]
    check('P6 编辑器的命令携带它自己那次读的 revision（不是写前现读）',
      edRec.data.expectedRevision === RB, JSON.stringify({ got: edRec.data.expectedRevision, want: RB }))
    check('P6 因此被 CONFLICT 拒绝，工作台的写入存活',
      edRec.result && edRec.result.ok === false && edRec.result.error.code === 'CONFLICT',
      JSON.stringify(edRec.result && edRec.result.error))
    const Rfinal = await revNow(ACT)
    check('P6 revision 只因工作台那一枪推进一次', Rfinal === RB + 1, RB + '→' + Rfinal)
  }

  /* ---------- 结论 ---------- */
  section('§14 判定与遗留')
  finding('PANEL-SYNC', 'PASS', '常驻面板的 revision 来源唯一（各自 reload 里 res.revision），宿主写成功后经 written→reload→syncKey 广播，兄弟面板由 observer 跟着重读；连点/跨面板/重开三种交错下，陈旧基线的写一律 CONFLICT。')
  finding('SWALLOWED-RELOAD', 'P3', 'api.js:121 的 `Promise.resolve(page.reload()).catch(()=>{})` 确实会把"重读失败"完全吞掉：面板继续持旧 revision。但后果被 CAS 兜住——下一次写是 CONFLICT（fail closed），不是 stale 覆盖，代价是用户多走一次"刷新重试"。建议（不在本轮改）：把这条吞法换成一次可见的重试提示或埋点。')
  finding('GLOBAL-REVISION', 'P3', 'revision 是全局单计数器（ot_meta/main），任何一处写入都会让它推进 ⇒ 面板/编辑器会因**别的活动**的写入而撞 CONFLICT（伪冲突）。V1 规模下可接受，但这是"一直冲突"类投诉的机制解释，也是 loadState 每请求全表读 15 集合的同一处规模墙。')

  console.log('')
  console.log('判定汇总：')
  findings.forEach(x => console.log('  [' + x[1] + ' · ' + x[0] + '] ' + x[2]))
  console.log('')
  console.log('passed=' + passed + ' failed=' + failed + ' bugs=' + bugs)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('套件自身异常：' + (e && e.stack || e)); process.exit(1) })
