// BUG-C1 客户端 CAS 生命周期回归：node tools/e2e-client-cas-test.js
//
// 这条链是真的：真 pages/editor/editor.js（global.Page 捕获）→ 真 utils/api.js（未 monkey-patch）
// → wx.cloud.callFunction 桥 → 真 cloudfunctions/trailApi/index.js → 真 domain → 真 store CAS。
// 只有 DB 是内存桩（tools/stub-wx-server-sdk.js）。
//
// 证据通道（任务书 §2/§4 要求分开写，不许混）：
//   · 本套件 = STUB / CLIENT-LIFECYCLE PROOF。桩库是同一张内存 Map、写入即刻可见，
//     它复现不了真云端「meta 主键读新、业务集合分页读旧」的可见性差与事务锁粒度。
//     所以本套件证的是「客户端没把 revision 送出去」这一【因】，不是云端读滞后那一【果】。
//   · REAL CLOUD PROOF 只在 Phase 9 报告 §B 那一栏出（真机双编辑器实例）。
//
// 定罪对象 BUG-C1（P1 CONCURRENCY / DATA CONSISTENCY BUG — Client CAS bypass）：
//   editor.js 的 this.revision 只在写成功后回填，reload() 从不取读回来的 revision
//   ⇒ 每个编辑器会话的第一条命令 expectedRevision === undefined
//   ⇒ index.js:122 把非整数的 expectedRevision 缺省成服务端刚读到的值 ⇒ 内存层①与事务层②同时放弃
//   ⇒ 该次写退化为 last-write-wins：陈旧表单静默覆盖他人刚落的写入，双方都收到成功。
//
// 防假红设计：C2 是正控制——同一个编辑器重开（重新读到最新 R）后保存【必须成功并推进 revision】。
// C1 红而 C2 也红＝夹具/契约坏了；C1 红而 C2 绿＝病因确为陈旧 revision。
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
const store = require('../cloudfunctions/trailApi/store')
const trailApi = require('../cloudfunctions/trailApi/index')
const api = require('../miniprogram/utils/api')
const draft = require('../miniprogram/utils/draft')
const EDITOR_PATH = require.resolve('../miniprogram/pages/editor/editor.js')

let passed = 0
let failed = 0
let bugs = 0
let drift = 0
const findings = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + String(extra).slice(0, 220) + '）' : '')) }
}
/** 已定罪但本轮不修的缺陷（任务书 §16「缺陷只归档不修」）：常驻红测计入 bugs 不计入 failed，
 *  自己转绿时按 DRIFT 记 failed——修复不许静默变成一条从未存在过的绿灯。手法与 e2e-concurrency 一致。 */
function bugCheck(id, title, stillBroken, evidence) {
  if (stillBroken) { bugs++; console.error('  ✗ [CONFIRMED BUG ' + id + '] ' + title) }
  else { drift++; failed++; console.error('  ⚠ [DRIFT ' + id + '] 探针已转绿：请把 ' + id + ' 转成正式断言，别让它悄悄消失') }
  findings.push([id, stillBroken ? 'BUG（红测常驻）' : 'DRIFT（疑似已修，需转正）', title])
  if (evidence) console.error('      证据：' + String(evidence).slice(0, 240))
}
function section(t) { console.log('== ' + t + ' ==') }
function finding(id, level, text) { findings.push([id, level, text]); console.log('  ▶ [' + level + ' · ' + id + '] ' + text) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 2000
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return !!cond()
}
/** 等所有已发出的 dispatch 拿到结果：否则后一步现读的 revision 会撞上前一步的迟到写，造成假 CONFLICT */
async function quiesce() {
  await waitFor(() => net.dispatches.every(d => d.result !== undefined))
  await sleep(0)
}

/* ---------- 客户端 wx.cloud → 真云函数 exports.main ---------- */
const OWNER = 'o-lin-owner'
const net = { calls: [], dispatches: [] }
function bridge() {
  return ({ name, data }) => {
    const rec = { name, data, action: data && data.action }
    net.calls.push(rec)
    if (rec.action === 'dispatch') net.dispatches.push(rec)
    stub.__state.openid = OWNER
    return trailApi.main(Object.assign({}, data)).then(r => { rec.result = r; return { result: r } })
  }
}
const ui = { toasts: [], nav: [] }
{
  const storage = {}
  global.wx = {
    cloud: { callFunction: bridge() },
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : ''),
    setStorageSync: (k, v) => { storage[k] = v },
    removeStorageSync: k => { delete storage[k] },
    showToast: o => { ui.toasts.push((o && o.title) || '') },
    navigateTo: o => { ui.nav.push((o && o.url) || '') },
    redirectTo: o => { ui.nav.push((o && o.url) || '') },
    switchTab: o => { ui.nav.push((o && o.url) || '') },
    chooseLocation: () => {},
    vibrateShort: () => {},
  }
}

/** 守规矩的客户端：读→拿 revision→带 revision 写（其它页面就是这个生命周期） */
async function cloud(action, data) {
  stub.__state.openid = OWNER
  const r = await trailApi.main(Object.assign({ action }, data || {}))
  if (!r.ok) { const e = new Error(r.error && r.error.message); e.code = r.error && r.error.code; throw e }
  return r.data
}
let ACT = ''
const readAct = () => cloud('read', { request: { kind: 'activity', activityId: ACT, perspective: 'organizer' } })
const rev = async () => (await readAct()).revision
const title = async () => (await readAct()).view.activity.title

/* ---------- 编辑器页实例（每次重取源码，不吃 require 缓存） ---------- */
function pageConfig() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[EDITOR_PATH]
  require(EDITOR_PATH)
  return global.__PAGE_CFG
}
async function bootEditor(options) {
  const cfg = pageConfig()
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) setImmediate(cb) }
  page.onLoad(options || {})
  const opened = await waitFor(() => page.data.loading === false)
  if (!opened) throw new Error('编辑器开页未完成：' + JSON.stringify(page.data.loading))
  return page
}
/** 走真 handler 改一个字段（顺带落本机草稿），而不是直接写 data */
function typeDescription(page, text) {
  page.onField({ currentTarget: { dataset: { key: 'description' } }, detail: { value: text } })
}

const person = (name, phone, en, ep) => ({ name, phone, emergency: { name: en, phone: ep }, medical: '', avatar: '' })
function input(title, description) {
  return {
    title, description, organizerIntro: '自动化带队',
    startAt: '2027-03-06T08:00:00+08:00', endAt: '2027-03-06T18:00:00+08:00', deadlineAt: '2027-03-05T20:00:00+08:00',
    acceptingSignups: true, capacity: 12, approvalMode: 'manual', routeId: null,
    routeSnapshot: { title: '路线', distanceKm: 6, ascentM: 200, points: [{ id: 'pt-1', name: '山门', kind: 'start', coordinates: null }], risks: [{ id: 'risk-1', title: '湿滑', advice: '防滑鞋' }] },
    pickupPoints: [{ id: 'pk-1', name: '东门', meetingAt: '2027-03-06T07:00:00+08:00', address: 'x', coordinates: null }],
    equipment: ['防滑鞋'], feeNote: 'AA', cancellationNote: '',
  }
}

/** 全量文档快照：14 个业务集合 + ot_meta/main。败者零副作用要逐字节比，不能只看视图字段 */
async function snapshot() {
  const out = {}
  for (const key of store.ALL_COLLECTIONS) {
    const name = store.COLLECTIONS[key]
    const res = await stub.__state.db.collection(name).orderBy('_id', 'asc').limit(1000).skip(0).get()
    out[name] = res.data
  }
  out.ot_meta = { main: (await stub.__state.db.collection('ot_meta').doc('main').get()).data }
  return JSON.stringify(out)
}

async function main() {
  /* ================= C0 夹具（真实信封） ================= */
  section('C0 夹具：真信封建档案 + 建活动')
  // 夹具也必须守服务器契约：原写法省略 expectedRevision，靠的是服务器把缺省值当"当前 revision"
  // ——那正是 index.js 的盲写洞（现由 e2e-revision-guard-test.js 失败关闭）。真实客户端在页面 onLoad
  // 时就会 read 一次拿到 revision，这里照做。
  const revBoot = (await cloud('read', { request: { kind: 'profile' } })).revision
  await cloud('dispatch', { payload: { type: 'profile.save', person: person('林溪', '00000000001', '林母', '00000000051') }, expectedRevision: revBoot })
  const revSeed = (await cloud('read', { request: { kind: 'profile' } })).revision
  const created = await cloud('dispatch', { payload: { type: 'activity.create', input: input('基线标题', '基线说明') }, expectedRevision: revSeed })
  ACT = created.targetIds[0]
  const R0 = await rev()
  check('C0 夹具：活动建档、读回 revision 为整数', !!ACT && Number.isInteger(R0), JSON.stringify(created).slice(0, 160))
  check('C0 夹具：权威读 title=基线标题', (await title()) === '基线标题', await title())

  /* ================= C1 BUG-C1 回归 ================= */
  section('C1 BUG-C1：A=陈旧编辑器实例（真 editor.js），B=守规矩客户端')
  const A = await bootEditor({ id: ACT })
  check('C1 前置：A 开页无 denied、表单装出的是开页那一刻的服务端值',
    !A.data.denied && A.data.form.title === '基线标题', JSON.stringify({ denied: A.data.denied, t: A.data.form.title }))
  typeDescription(A, 'A 在陈旧表单里写的一句话（CONFLICT 后不该落库）')
  const revAtOpen = R0

  const bSave = await cloud('dispatch', {
    payload: { type: 'activity.edit', activityId: ACT, input: input('B 的标题（必须存活）', 'B 的说明（必须存活）') },
    expectedRevision: revAtOpen,
  })
  const R1 = bSave.revision
  check('C1 B 的合法保存成功：R0 → R0+1', R1 === revAtOpen + 1, revAtOpen + '→' + R1)
  check('C1 B 落库后权威读为 B 的标题与说明', (await title()) === 'B 的标题（必须存活）', await title())

  const snapBefore = await snapshot()
  const dBefore = net.dispatches.length
  A.onSave()
  const landed = await waitFor(() => net.dispatches.length > dBefore)
  check('C1 前置：A 的保存真的发出一条命令（不是本地校验提前拦下）', landed, '新增 dispatch=' + (net.dispatches.length - dBefore))
  const aRec = net.dispatches[net.dispatches.length - 1]
  const aExpected = aRec && aRec.data ? aRec.data.expectedRevision : '<no dispatch>'
  await quiesce()

  check('C1-① A 发出的 expectedRevision 是整数（病灶：undefined ⇒ 两层 CAS 同时放弃）',
    Number.isInteger(aExpected), 'expectedRevision=' + JSON.stringify(aExpected))
  check('C1-② A 发出的 expectedRevision === 开页读到的 R0（表单与 revision 必须成对；写前现读等于自证通过）',
    aExpected === revAtOpen, 'expected=' + aExpected + ' R0=' + revAtOpen)
  check('C1-③ A 的陈旧保存被拒绝（ok=false）',
    !!(aRec.result && aRec.result.ok === false), JSON.stringify(aRec.result).slice(0, 200))
  check('C1-④ 拒绝码是 CONFLICT（而非 INVALID_INPUT/WRONG_PHASE 一类夹具错）',
    !!(aRec.result && aRec.result.ok === false && aRec.result.error.code === 'CONFLICT'),
    JSON.stringify(aRec.result && aRec.result.error))
  const Rafter = await rev()
  check('C1-⑤ revision 未因 A 的尝试推进（停在 R0+1）', Rafter === R1, R1 + '→' + Rafter)
  check('C1-⑥ B 的修改仍然存活（title 与 description 都没被陈旧表单覆盖）',
    (await title()) === 'B 的标题（必须存活）' && (await readAct()).view.activity.description === 'B 的说明（必须存活）',
    JSON.stringify((await readAct()).view.activity.title))
  const snapAfter = await snapshot()
  const diffCols = store.ALL_COLLECTIONS.map(k => store.COLLECTIONS[k])
    .filter(n => JSON.stringify(JSON.parse(snapBefore)[n]) !== JSON.stringify(JSON.parse(snapAfter)[n]))
  check('C1-⑦ 全量文档逐字节零副作用（14 集合 + ot_meta/main 全未变：rows/receipts/events 无一被写）',
    snapBefore === snapAfter, '变化集合=' + (diffCols.join(',') || 'ot_meta/revision') )
  check('C1-⑧ 败者内容零残留：A 写的那句话在整库里不存在',
    snapAfter.indexOf('CONFLICT 后不该落库') === -1, '快照中出现了 A 的陈旧内容')
  check('C1-⑨ 用户可见反馈：A 收到冲突提示（toast 或页面 failure），不是静默成功',
    ui.toasts.some(t => /刷新|重试|更新|没有保存/.test(t)) || !!A.data.failure,
    JSON.stringify({ toasts: ui.toasts.slice(-3), failure: A.data.failure }))
  check('C1-⑩ A 的 busy 态被释放（拒绝路径不能把按钮永久锁死）',
    await waitFor(() => A.data.busy === false, 500), 'busy=' + A.data.busy)

  /* ================= C2 正控制 ================= */
  section('C2 正控制：本机无草稿时重开编辑器（读到最新 R）保存必须成功——排除"夹具坏造成 C1 假红"')
  ui.toasts.length = 0
  await quiesce()
  // 走生产 API 清草稿：C1 里 A 输入过一句话，草稿按 activityId 存着；
  // reload() 的「draft 优先」会用本机草稿盖掉服务端表单，那属于 C5 的 BUG-C2，不该混进这条正控制。
  draft.clearDraft(ACT, 'activity-editor')
  const A2 = await bootEditor({ id: ACT })
  check('C2 前置：重开后表单跟到 B 的值（无草稿时以服务端为准）',
    A2.data.form.title === 'B 的标题（必须存活）', A2.data.form.title)
  check('C2 前置：重开后 this.revision 跟到服务端最新值（成对抓取的闭环）',
    Number.isInteger(A2.revision) && A2.revision === R1, JSON.stringify({ got: A2.revision, want: R1 }))
  const d2 = net.dispatches.length
  A2.onSave()
  const sent2 = await waitFor(() => net.dispatches.length > d2)
  const a2Rec = net.dispatches[net.dispatches.length - 1]
  await quiesce()
  check('C2 新鲜实例保存成功（C1 的红来自陈旧 revision，不来自 schema/权限/夹具）',
    sent2 && a2Rec.result && a2Rec.result.ok === true, JSON.stringify(a2Rec.result).slice(0, 200))
  check('C2 新鲜实例带整数 expectedRevision',
    Number.isInteger(a2Rec.data && a2Rec.data.expectedRevision), JSON.stringify(a2Rec.data && a2Rec.data.expectedRevision))
  const R2 = await rev()
  check('C2 revision 因这次合法写入推进 +1（反空断言：链路真能写）', R2 === R1 + 1, R1 + '→' + R2)

  /* ================= C5 常驻红测 BUG-C2 ================= */
  section('C5 常驻红测 BUG-C2：CONFLICT 后「草稿优先 + 已刷新的 revision」二次保存仍覆盖他人写入（本轮只归档不修）')
  {
    await quiesce()
    draft.clearDraft(ACT, 'activity-editor')
    const R5 = await rev()
    const titleAtOpen = (await title())
    const A5 = await bootEditor({ id: ACT })
    typeDescription(A5, 'A5 在草稿里写的一句话')          // 落本机草稿，并让表单停在开页那一刻
    const b5 = await cloud('dispatch', {
      payload: { type: 'activity.edit', activityId: ACT, input: input('C5 B 的标题（必须存活）', titleAtOpen === 'B 的标题（必须存活）' ? 'B 的说明（必须存活）' : 'B 的说明') },
      expectedRevision: R5,
    })
    const R6 = b5.revision
    const d5 = net.dispatches.length
    A5.onSave()
    await waitFor(() => net.dispatches.length > d5)
    await quiesce()
    const firstRec = net.dispatches[net.dispatches.length - 1]
    check('C5 前置：第一次保存按预期被 CONFLICT 拒绝（BUG-C1 修复后的正确行为）',
      firstRec.result && firstRec.result.ok === false && firstRec.result.error.code === 'CONFLICT',
      JSON.stringify(firstRec.result && firstRec.result.error))
    const d6 = net.dispatches.length
    A5.onSave()                                            // 用户按提示「重试」
    const sent2 = await waitFor(() => net.dispatches.length > d6)
    await quiesce()
    const secondRec = net.dispatches[net.dispatches.length - 1]
    const er2 = secondRec.data && secondRec.data.expectedRevision
    check('C5 定性依据：这二次写带的是【最新】revision（说明它不是 CAS 绕过，而是草稿优先的盲覆盖）',
      sent2 && er2 === R6, JSON.stringify({ er2, R6 }))
    const titleNow = await title()
    bugCheck('BUG-C2',
      '他人（B）刚落的修改被本机陈旧草稿在"重试"后静默覆盖——CAS 层无错，错在冲突解决策略（草稿优先、无字段合并、无二次确认）',
      titleNow !== 'C5 B 的标题（必须存活）',
      'R5=' + R5 + ' B 写入后 R6=' + R6 + ' 第一次=CONFLICT 第二次 expectedRevision=' + er2 + ' → title=' + JSON.stringify(titleNow))
    await quiesce()
  }

  /* ================= C3 共享 revision 的其它出口 ================= */
  section('C3 同一 revision 生命周期覆盖到的其它命令（delete / copy / publish）')
  {
    await quiesce()
    const del = await cloud('dispatch', { payload: { type: 'activity.create', input: input('C3 待删除', 'C3 delete 夹具') }, expectedRevision: await rev() })
    const delId = del.targetIds[0]
    const D = await bootEditor({ id: delId })
    const d0 = net.dispatches.length
    D.onDeleteDraftConfirm()
    const sent = await waitFor(() => net.dispatches.length > d0)
    const rec = net.dispatches[net.dispatches.length - 1]
    check('C3-delete 破坏性命令 activity.delete 的第一条出口也必须带整数 expectedRevision',
      sent && rec.data.payload.type === 'activity.delete' && Number.isInteger(rec.data.expectedRevision),
      JSON.stringify({ type: rec.data && rec.data.payload.type, er: rec.data && rec.data.expectedRevision }))
    await quiesce()
    const delResult = rec.result
    check('C3-delete 命令本身被服务端接受（否则下面的"消失"断言是自证）',
      !!(delResult && delResult.ok === true), JSON.stringify(delResult && delResult.error))
    const gone = await cloud('read', { request: { kind: 'activity', activityId: delId, perspective: 'organizer' } })
      .then(r => r.view.kind).catch(() => 'error')
    check('C3-delete 反空断言：这条命令确实被执行了（活动已从组织者视图消失），不是没发出去',
      gone !== 'activity', 'view.kind=' + gone)
  }
  {
    await quiesce()
    const src = await cloud('dispatch', { payload: { type: 'activity.create', input: input('C3 模板源', 'C3 复制夹具') }, expectedRevision: await rev() })
    const C = await bootEditor({})
    C.setData({ templateId: src.targetIds[0], busy: false })
    const d0 = net.dispatches.length
    C.onCopyTemplate()
    const sent = await waitFor(() => net.dispatches.length > d0)
    const rec = net.dispatches[net.dispatches.length - 1]
    check('C3-copy 新建态编辑器的 activity.copy 也必须带整数 expectedRevision',
      sent && rec.data.payload.type === 'activity.copy' && Number.isInteger(rec.data.expectedRevision),
      JSON.stringify({ type: rec.data && rec.data.payload.type, er: rec.data && rec.data.expectedRevision }))
    await quiesce()
  }
  {
    await quiesce()
    const mk = await cloud('dispatch', { payload: { type: 'activity.create', input: input('C3 待发布', 'C3 publish 夹具') }, expectedRevision: await rev() })
    const P = await bootEditor({ id: mk.targetIds[0] })
    P.setData({ participate: false, publishOpen: true })
    const d0 = net.dispatches.length
    P.publish()
    const sent = await waitFor(() => net.dispatches.length > d0)
    const rec = net.dispatches[net.dispatches.length - 1]
    check('C3-publish 不报名那条支路（用 this.revision）也必须带整数 expectedRevision',
      sent && rec.data.payload.type === 'activity.publish' && Number.isInteger(rec.data.expectedRevision),
      JSON.stringify({ type: rec.data && rec.data.payload.type, er: rec.data && rec.data.expectedRevision }))
    await quiesce()
    const pv = await cloud('read', { request: { kind: 'activity', activityId: mk.targetIds[0], perspective: 'organizer' } })
    check('C3-publish 反空断言：发布真的把 phase 推到 published', pv.view.activity.phase === 'published', pv.view.activity.phase)
  }

  /* ================= C4 客户端漏斗门 ================= */
  section('C4 客户端漏斗：任何页面缺 revision 都不得触网（把这一类钉死，不止 editor）')
  {
    await quiesce()
    const c0 = net.calls.length
    let threw = null
    await api.dispatch({ type: 'activity.edit', activityId: ACT, input: input('漏斗测试', '漏斗测试') }, undefined).catch(e => { threw = e })
    check('C4-① api.dispatch 缺 expectedRevision 时本地拒绝（fail closed），而不是发出去让云端猜',
      !!threw, '没有抛错——缺 revision 仍会被发出')
    check('C4-② 该拒绝零网络调用（一次 callFunction 都没发）',
      net.calls.length === c0, '新增调用数=' + (net.calls.length - c0))
    const page = { reload: () => Promise.resolve(), triggerEvent: () => {} }
    const c1 = net.calls.length
    let threw2 = null
    await api.dispatchAndSync({ type: 'activity.edit', activityId: ACT, input: input('漏斗测试2', '漏斗测试2') }, undefined, page).catch(e => { threw2 = e })
    check('C4-③ dispatchAndSync 同样不得把缺 revision 的命令发出去',
      !!threw2 && net.calls.length === c1, JSON.stringify({ threw: !!threw2, callsAdded: net.calls.length - c1 }))
    check('C4-④ 拒绝错误带专用 code 与可行动文案（页面要能区分「客户端漏传」与「云端冲突」）',
      !!(threw && threw.code === 'NO_REVISION' && /刷新|重试|重新打开|最新/.test(threw.message || '')),
      JSON.stringify(threw && { code: threw.code, message: threw.message }))
    const goodRev = await rev()
    const c2 = net.calls.length
    const res = await api.dispatch({ type: 'activity.edit', activityId: ACT, input: input('漏斗合法写', '漏斗合法写') }, goodRev)
    check('C4-⑤ 反空断言：漏斗门不误伤合法写（带 revision 时恰好一次调用、revision +1）',
      res && res.revision === goodRev + 1 && net.calls.length === c2 + 1,
      JSON.stringify({ rev: res && res.revision, goodRev, callsAdded: net.calls.length - c2 }))
  }

  /* ================= C7 BUG-C3 正式回归（Phase 10A） ================= */
  section('C7 BUG-C3：真并发（两请求同时基于同一个 R）在 SDK 类型擦除下仍须是 CONFLICT，且客户端必须进入恢复路径')
  {
    await quiesce()
    // 必须"同时"才行：顺序的陈旧写在层①（commands.js:122）就被拦成 CONFLICT，压根进不了事务，
    // 也就碰不到 store.js:128 那道 instanceof——真云端出问题的正是两笔事务重叠的情形
    //（Phase 9 实测：同一 tick 双发、同一个 revision ⇒ 败者 STORAGE_UNAVAILABLE）。
    // barrier ON 保证"恰好一胜"，类型擦除 ON 复现 SDK 边界丢类型，整条链从【客户端】观察。
    stub.__setTxnBarrier(true)
    stub.__setTxnErrorWrapping(true)
    const R = await rev()
    const pageA = { reloadCalls: 0, reload() { pageA.reloadCalls++; return Promise.resolve() }, triggerEvent: () => {} }
    const pageB = { reloadCalls: 0, reload() { pageB.reloadCalls++; return Promise.resolve() }, triggerEvent: () => {} }
    const uiBefore = ui.toasts.length
    const pair = await Promise.all([
      api.dispatchAndSync({ type: 'activity.edit', activityId: ACT, input: input('C7 标题', 'C7-A 的说明') }, R, pageA)
        .then(r => ({ ok: true, r })).catch(e => ({ ok: false, e })),
      api.dispatchAndSync({ type: 'activity.edit', activityId: ACT, input: input('C7 标题', 'C7-B 的说明') }, R, pageB)
        .then(r => ({ ok: true, r })).catch(e => ({ ok: false, e })),
    ])
    const losers = pair.filter(x => !x.ok)
    const winners = pair.filter(x => x.ok)
    check('C7-① 恰好一个成功（串行化基座下既不许双胜、也不许两个都失败）',
      winners.length === 1 && losers.length === 1, JSON.stringify(pair.map(x => x.ok ? 'OK' : x.e && x.e.code)))
    const loserErr = losers[0] && losers[0].e
    check('C7-② 败者的错误码是 CONFLICT（真云端实测给的是 STORAGE_UNAVAILABLE ⇒ 这一条就是病灶）',
      !!loserErr && loserErr.code === 'CONFLICT', JSON.stringify(loserErr && { code: loserErr.code, message: loserErr.message }))
    const loserPage = pair[0] === losers[0] ? pageA : pageB
    const winnerPage = pair[0] === losers[0] ? pageB : pageA
    check('C7-③ 败者页面进入恢复路径：needRefresh ⇒ page.reload() 恰好一次',
      loserPage.reloadCalls === 1, 'reloadCalls=' + loserPage.reloadCalls)
    check('C7-④ 胜者页面不被误触发重读（恢复路径只属于冲突那一方）',
      winnerPage.reloadCalls === 0, 'reloadCalls=' + winnerPage.reloadCalls)
    check('C7-⑤ 用户看到的是"已被他人更新、请重试"，不是"云存储不可用/服务异常"',
      ui.toasts.slice(uiBefore).some(t => /他人更新|已刷新|重试/.test(t))
        && !ui.toasts.slice(uiBefore).some(t => /存储|服务异常/.test(t)),
      JSON.stringify(ui.toasts.slice(uiBefore)))
    check('C7-⑥ 数据完好：revision 只因胜者推进一次', (await rev()) === R + 1, JSON.stringify({ R, after: await rev() }))
    const snapC7 = await snapshot()
    const landedCount = ['C7-A 的说明', 'C7-B 的说明'].filter(t => snapC7.indexOf(t) !== -1).length
    check('C7-⑦ 败者内容零残留：整库快照里只出现一笔写入的标记',
      landedCount === 1, '命中标记数=' + landedCount)
    // 选择性对照：真正的存储故障不能被擦成 CONFLICT。让 runTransaction 自己失败（不是回调里抛的），
    // 这才是 store.js:129 那条分支应当保留的唯一场景。
    const db = stub.__state.db
    const realTxn = db.runTransaction
    db.runTransaction = () => Promise.reject(Object.assign(new Error('internal error'), { errCode: -500100 }))
    let infra = null
    await api.dispatch({ type: 'activity.edit', activityId: ACT, input: input('C7 标题', '存储故障对照') }, await rev())
      .then(() => {}).catch(e => { infra = e })
    db.runTransaction = realTxn
    check('C7-⑧ 选择性：SDK 自身的存储异常仍然报 STORAGE_UNAVAILABLE（修复不得把一切判成冲突）',
      !!infra && infra.code === 'STORAGE_UNAVAILABLE', JSON.stringify(infra && infra.code))
    stub.__setTxnErrorWrapping(false)
    stub.__setTxnBarrier(false)
  }

  /* ================= C8 BUG-C3 机制② 正式回归（Phase 10A 映射，先于改动写） ================= */
  section('C8 BUG-C3 机制②：败者已通过我方 CAS、被平台在事务内 document.set 上原子中止时，分类仍须是 CONFLICT 且客户端须进入恢复路径')
  {
    await quiesce()
    // C7 覆盖的是"冲突判定不得依赖异常类型跨边界存活"（barrier + 类型擦除 ⇒ 败者走 conflicted 哨兵）。
    // 真云端诊断取回的第二类**不是**那条路：两笔并发事务都读到同一个 R、都通过 store.js:120 的 CAS，
    // 随后平台按自己的读写冲突规则在事务内 document.set 上中止败者；错误对象是平台自有的
    // errCode=-501001 + 子类型 ResourceUnavailable.TransactionConflict，键集只有 errCode,errMsg（没有 code、
    // 没有我方文案）⇒ store.js:135 的 instanceof 判 false ⇒ 落进 STORAGE_UNAVAILABLE 兜底。
    // 签名取证：docs/testing/phase10a-evidence/c3-error-signature-result.md（23/23 样本同一类）。
    stub.__setTxnBarrier(false)
    stub.__setTxnConflictAbort(true)
    const abortsBefore = stub.__state.aborts
    const R = await rev()
    const pageA = { reloadCalls: 0, reload() { pageA.reloadCalls++; return Promise.resolve() }, triggerEvent: () => {} }
    const pageB = { reloadCalls: 0, reload() { pageB.reloadCalls++; return Promise.resolve() }, triggerEvent: () => {} }
    const uiBefore = ui.toasts.length
    const pair = await Promise.all([
      api.dispatchAndSync({ type: 'activity.edit', activityId: ACT, input: input('C8 标题', 'C8-A 的说明') }, R, pageA)
        .then(r => ({ ok: true, r })).catch(e => ({ ok: false, e })),
      api.dispatchAndSync({ type: 'activity.edit', activityId: ACT, input: input('C8 标题', 'C8-B 的说明') }, R, pageB)
        .then(r => ({ ok: true, r })).catch(e => ({ ok: false, e })),
    ])
    const aborted = stub.__state.aborts - abortsBefore
    // 有效性门：没有它，C8 可能只是 C7 换了个名字（走哨兵早退）甚至是空断言。
    check('C8-⓪ 前序生效：恰好 1 笔事务在【写入点】被平台中止（⇒ 两笔都通过了我方 CAS，测的确实是机制②）',
      aborted === 1, JSON.stringify({ abortsDelta: aborted, codes: pair.map(x => x.ok ? 'OK' : x.e && x.e.code) }))
    const losers = pair.filter(x => !x.ok)
    const winners = pair.filter(x => x.ok)
    check('C8-① 恰好一个成功（平台中止是原子的：既不许双胜、也不许两个都失败）',
      winners.length === 1 && losers.length === 1, JSON.stringify(pair.map(x => x.ok ? 'OK' : x.e && x.e.code)))
    const loserErr = losers[0] && losers[0].e
    check('C8-② 败者的错误码是 CONFLICT（真云端这一类现在给的是 STORAGE_UNAVAILABLE ⇒ 待映射的病灶）',
      !!loserErr && loserErr.code === 'CONFLICT', JSON.stringify(loserErr && { code: loserErr.code, message: loserErr.message }))
    const loserPage = pair[0] === losers[0] ? pageA : pageB
    const winnerPage = pair[0] === losers[0] ? pageB : pageA
    check('C8-③ 败者页面进入恢复路径：needRefresh ⇒ page.reload() 恰好一次',
      loserPage.reloadCalls === 1, 'reloadCalls=' + loserPage.reloadCalls)
    check('C8-④ 胜者页面不被误触发重读',
      winnerPage.reloadCalls === 0, 'reloadCalls=' + winnerPage.reloadCalls)
    check('C8-⑤ 用户看到的是"已被他人更新、请重试"，不是"云存储不可用"',
      ui.toasts.slice(uiBefore).some(t => /他人更新|已刷新|重试/.test(t))
        && !ui.toasts.slice(uiBefore).some(t => /存储|服务异常/.test(t)),
      JSON.stringify(ui.toasts.slice(uiBefore)))
    check('C8-⑥ 数据完好：revision 只因胜者推进一次', (await rev()) === R + 1, JSON.stringify({ R, after: await rev() }))
    const snapC8 = await snapshot()
    const landed8 = ['C8-A 的说明', 'C8-B 的说明'].filter(t => snapC8.indexOf(t) !== -1).length
    check('C8-⑦ 败者内容零残留：中止发生前没落下任何一笔写（整库快照只有一笔标记）',
      landed8 === 1, '命中标记数=' + landed8)
    // 闭环对照：败者按提示重读后拿新 revision 再写一次必须成功——这句才是"恢复链路坏了"的实际代价。
    const afterRetry = await api.dispatch({ type: 'activity.edit', activityId: ACT, input: input('C8 标题', 'C8 重试后落库') }, await rev())
      .then(r => r && r.revision).catch(() => 'REJECTED')
    check('C8-⑧ 恢复闭环：败者重读后的重试以合法 revision 成功（不再是"照提示做必然再撞"）',
      afterRetry === R + 2, JSON.stringify({ afterRetry, want: R + 2 }))

    // 选择性（窄匹配的红线）：同样带 errCode=-501001 但**不是**那个子类型的 SDK 错误，
    // 必须仍然走 STORAGE_UNAVAILABLE。真故障样本本轮云端一个都没出现，所以"窄"只能在这里自证。
    const db = stub.__state.db
    const realTxn = db.runTransaction
    const inject = async () => {
      const cur = await rev()
      db.runTransaction = () => Promise.reject(inject._err)
      return api.dispatch({ type: 'activity.edit', activityId: ACT, input: input('C8 标题', '选择性对照') }, cur)
        .then(() => 'OK').catch(e => (e && e.code) || 'NO_CODE')
        .finally(() => { db.runTransaction = realTxn })
    }
    const mkErr = msg => { const e = new Error(msg); e.errCode = -501001; e.errMsg = msg; return e }
    inject._err = mkErr('document.set:fail -501001 resource system error. [InternalError.DbNotReady] resource not ready.')
    check('C8-⑨ 选择性①：-501001 的其它子类型（本轮未见过的真故障形状）不得被映射成冲突',
      await inject() === 'STORAGE_UNAVAILABLE')
    inject._err = Object.assign(new Error('internal error'), { errCode: -501001 })
    check('C8-⑩ 选择性②：只有裸码 -501001、没有子类型标记时不得被映射成冲突',
      await inject() === 'STORAGE_UNAVAILABLE')
    inject._err = Object.assign(new Error('[ResourceUnavailable.TransactionConflict] fake'), { errCode: -502000 })
    check('C8-⑪ 选择性③：只有子类型文案、错误码不是 -501001 时同样不得映射（两个条件是 AND）',
      await inject() === 'STORAGE_UNAVAILABLE')
    db.runTransaction = realTxn
    stub.__setTxnConflictAbort(false)
  }

  /* ================= 结论分栏 ================= */
  section('证据通道与遗留（一律不转 PASS）')
  finding('BUG-C1', 'P1', '客户端 CAS 绕过。本套件＝STUB / CLIENT-LIFECYCLE PROOF：真 editor.js + 真 api.js + 真 index.js/domain/store，仅 DB 为内存桩。REAL CLOUD PROOF 见 Phase 9 报告 §B（真机双编辑器实例）。')
  finding('C1-LOAD', 'STUB LIMITATION', '内存 Map 写入即刻可见 ⇒ 本套件复现不了真云端「ot_meta 主键读新 / 业务集合分页读旧」的可见性差与事务锁粒度。C1 证「客户端没送 revision」这一因，不证云端读滞后这一果。')
  finding('INDEX-122', 'P2', 'index.js:122「非整数 expectedRevision ⇒ 缺省成 before.revision」这条支路仍在。C4 漏斗门使任何已发布页面都走不到它，但支路本身没拆：拆它要同步给 A 层 4 套 + B 层 3 套里所有"不传 revision"的调用点补 revision（B 层只能在开发者工具里验）。按任务书 §3「最小范围修复、禁止借机大 refactor」本轮未动，作为待批决策项上报。')
  finding('S4/S4b', 'P2', 'e2e-concurrency 的 S4 常驻红测（服务端层缺 revision ⇒ lost update）已在本轮拆掉：index.js 对缺 revision 的命令失败关闭（NO_REVISION），探针按本仓规程转正为正式断言，另由 tools/e2e-revision-guard-test.js 从信封面守住。')
  finding('BUG-C2', 'P2', '见 C5 常驻红测：CONFLICT 后 dispatchAndSync 会 reload()，editor reload 在有本机草稿时以草稿盖表单，同时把 revision 刷成最新 ⇒ 用户按提示「重试」即以最新 R 提交陈旧草稿。CAS 层没有漏洞（第二次写带的是合法 revision），缺的是冲突解决策略（字段合并或二次确认）。属产品决策，任务书 §3 未授权，本轮只登记不修。')

  console.log('')
  console.log('判定汇总：')
  findings.forEach(x => console.log('  [' + x[1] + ' · ' + x[0] + '] ' + x[2]))
  console.log('')
  console.log('passed=' + passed + ' failed=' + failed + ' bugs=' + bugs + ' drift=' + drift)
  process.exit(failed + drift ? 1 : 0)
}

main().catch(e => { console.error('套件自身异常：' + (e && e.stack || e)); process.exit(1) })
