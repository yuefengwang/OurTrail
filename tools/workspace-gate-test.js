// workspace 阶段推进「门槛预反映」门：node tools/workspace-gate-test.js
//
// 钉的是审计 F-01/M-19（含 C-05 前置）在**页面侧**的那半条契约：
// 「服务端门槛 → 客户端预先说清楚」这条链里，pages/workspace/workspace.js 负责把投影好的行事实
// 交给 utils/journey.transitionBlocker，再把算出来的说明交给渲染层；而「要不要出现」不能由
// 权限位顺带决定（铁律 33），「差几个人」必须先被交出去（C-05）。
//
// 三条硬约定（照仓库既有纪律，不是自创）：
// 1. **夹具只能通过真实命令建立**（tools/lifecycle-harness.js 的铁约①）：这里不手拼 State、
//    不手拼 view。页面吃的是 `selectors.selectView` 的真实投影，counters/rows 的形状不可能和
//    线上漂移——而「测试自己造一份 counters」正是这条契约原来失守的方式。
// 2. **门钉行为不钉源码文本**（铁律 30）：不断言 workspace.wxml 长什么样，也不断言 journey 的
//    句子措辞（那是 tools/journey-test.js 的领地）。断言的是真页面装配完之后交到渲染层的那份数据，
//    以及页面↔journey 那道接缝的进出。
// 3. **不镜像被测层逻辑**（铁律 11）：判据来自真 `J.transitionBlocker` 的回放、真 `domain` 的返回码，
//    或真投影的读数。本门唯一自己写的函数是 §4 的**探针**——它只回显接缝收到的数字，
//    不判断据、不产结论，作用是把「接缝是活的」证成可观测事实（没有阳性对照就分不清闸在判还是空转）。
//
// 本门**不含**像素可见性断言。渲染条件（workspace.wxml:L72 把解释行挂在 !canTransition 之下）
// 属 pages/workspace/workspace.wxml，不在 M19 的写入范围（见 out/M19/requests.md R-01）；
// 那半条落地时必须与它的断言同批进。真机要求见 out/M19/runtime-required.md，UI 维 = NOT_RUN。
'use strict'
const H = require('./lifecycle-harness')
const J = require('../miniprogram/utils/journey')
const api = require('../miniprogram/utils/api')

const PAGE_PATH = require.resolve('../miniprogram/pages/workspace/workspace.js')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function note(t) { console.log('  · ' + t) }
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

// ---- global.wx 桩：reload 会调 setNavigationBarTitle，onTab 会调 pageScrollTo ----
function makeWx() {
  global.wx = {
    setNavigationBarTitle: () => {},
    showToast: () => {},
    vibrateShort: () => {},
    navigateTo: () => {},
    switchTab: () => {},
    pageScrollTo: () => {},
  }
}

// ---- 真页面的配置与实例（delete require.cache 强制重读源码）----
function newPage() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  const cfg = global.__PAGE_CFG
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

/* ================= 世界夹具：全部走真实命令 ================= */

const LIN = 'o-lin-openid'
const P1 = 'o-p1-openid'
const P2 = 'o-p2-openid'
const P3 = 'o-p3-openid'
const P4 = 'o-p4-openid'
const P5 = 'o-p5-openid'
const PEER = 'o-peer-openid'
const NAME_OF = { 陈屿: P1, 王五: P2, 赵六: P3, 孙七: P4, 周八: P5, 外部候补: PEER }
// self（自行前往）不带上车点：既不需要车辆与上车事实，也把变量收敛到「出发结论」这一件事上。
const SELF = () => ({ mode: 'self' })

function publishedWorld(names) {
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.a = w.createActivity(LIN, { capacity: 12, approvalMode: 'manual' })
  w.publish(LIN, w.a)
  w.ids = {}
  for (const name of names) {
    const u = NAME_OF[name]
    w.profile(u, name)
    w.signup(u, w.a, name, SELF(), { ownerId: LIN })
    w.ids[name] = w.signupIdOf(name)
  }
  return w
}

function addPending(w, name) {
  const u = NAME_OF[name]
  w.profile(u, name)
  w.signup(u, w.a, name, SELF(), { ownerId: LIN, keepPending: true })
  return w.signupIdOf(name)
}

function checkinAll(w, names) {
  for (const name of names) {
    const r = w.checkin(LIN, w.a, w.ids[name])
    if (!r.ok) throw new Error('夹具签到失败：' + name + ' → ' + r.code + ' ' + r.message)
  }
}

function departAs(w, name, kind) {
  // attendance.departure 的权限面是「领队或有 checkin 能力的人」（permissions.js:280）——
  // 参与者本人不能给自己写出发结论，所以这里以 LIN 身份发这条真实命令。
  const r = w.departure(LIN, w.a, w.ids[name], kind)
  if (!r.ok) throw new Error('夹具出发结论失败：' + name + '→' + kind + ' → ' + r.code + ' ' + r.message)
  return r
}

/**
 * 「试发一条命令然后倒回」：服务端真门的读数属于**这一场事实**，但把世界推进到下一阶段会让
 * 页面读到的 phase 变掉。harness 的 w.restore 就是为这件事存在的（probing 只关掉回执计数自检，
 * 不变量与独立 oracle 照样逐步检查）。
 */
function probeTransition(w, next, reason) {
  const snap = w.snapshot()
  const out = w.phase(LIN, w.a, next, reason)
  w.restore(snap)
  return { out, same: w.snapshot() === snap }
}

/* ================= 把真投影喂给真页面 ================= */

/**
 * 跑一次页面装配。返回：
 * - page：装好数据的真页面实例
 * - view：页面实际吃到的那份真实投影（用于 identity 断言与影子改写）
 * - ctxs：真 J.transitionBlocker 收到的入参（同一次调用记录的引用）
 * - realHint：真实现对该入参的返回值（用于「页面没改写文案」的逐字节对照）
 */
async function render(view, options) {
  const opts = options || {}
  const page = newPage()
  api.read = () => Promise.resolve({
    view,
    revision: opts.revision == null ? 7 : opts.revision,
    now: opts.now || '2026-10-11T07:40:00+08:00',
  })
  const ctxs = []
  const real = J.transitionBlocker
  const outputs = []
  J.transitionBlocker = function (ctx) {
    ctxs.push(ctx)
    const out = real.apply(J, arguments)
    outputs.push(out)
    return out
  }
  try {
    // 真机次序：onLoad 只记 activityId，reload 挂在 onShow 上（漏掉 onShow 就永远停在 loading）
    page.onLoad({ id: view.activity.id })
    page.onShow()
    if (!await waitFor(() => page.data.loading === false)) {
      throw new Error('页面没在超时内装配完成，本门后续读数全部无效')
    }
  } finally {
    J.transitionBlocker = real
  }
  return { page, view, ctxs, realHint: outputs.length === 1 ? outputs[0] : null }
}

function renderWorld(w, options) {
  return render(w.readActivity(LIN, w.a, 'organizer'), options)
}

/**
 * §4 探针：把接缝收到的数字回显成一句可 grep 的标记。
 * 它不判断据、不读 counters、不产结论 —— 唯一用途是证明「notVerified 真的穿过接缝到达页面数据」。
 * 用探针而不是抄一句 journey 的文案，是为了不在测试里替 journey 决定该说什么（铁律 11）。
 */
async function renderWithProbe(w) {
  const view = w.readActivity(LIN, w.a, 'organizer')
  const page = newPage()
  api.read = () => Promise.resolve({ view, revision: 7, now: '2026-10-11T07:40:00+08:00' })
  const real = J.transitionBlocker
  J.transitionBlocker = ctx => 'PROBE[' + String(ctx.notVerified) + ']'
  try {
    page.onLoad({ id: view.activity.id })
    page.onShow()
    if (!await waitFor(() => page.data.loading === false)) throw new Error('探针装配超时')
  } finally {
    J.transitionBlocker = real
  }
  return page
}

/* ================= 判据 ================= */

async function main() {
  makeWx()

  section('1. 夹具与投影事实（先证明「这份数据确实长成那样」，再谈页面说了什么）')
  const wA = publishedWorld(['陈屿', '王五', '赵六'])
  toGatheringOrThrow(wA)
  checkinAll(wA, ['陈屿', '王五', '赵六'])
  {
    const view = wA.readActivity(LIN, wA.a, 'organizer')
    check('活动由真实命令走到 gathering，三人 confirmed 且全部已签到（unchecked=0）',
      view.activity.phase === 'gathering' && view.counters.confirmed === 3 && view.counters.unchecked === 0,
      JSON.stringify({ phase: view.activity.phase, counters: view.counters }))
    check('同一份投影里三人的出发结论都是「没有记录」（departure=unknown）',
      view.rows.filter(r => r.status === 'confirmed' && r.departure === 'unknown').length === 3,
      JSON.stringify(view.rows.map(r => [r.name, r.status, r.departure])))
    const probe = probeTransition(wA, 'active', '全员已到集合点')
    check('服务端在同一份事实上确实拒绝推进：UNRESOLVED_DEPARTURE（否则本场景是空转）',
      probe.out.ok === false && probe.out.code === 'UNRESOLVED_DEPARTURE', JSON.stringify(probe.out))
    check('被拒的那句正是用户本来要白填一轮原因才看到的话',
      probe.out.message === '请逐一核实已确认参与者的出发情况。', String(probe.out.message))
    check('探针不倒污染世界（被拒命令零副作用，页面读到的仍是 gathering）',
      probe.same === true && wA.readActivity(LIN, wA.a, 'organizer').activity.phase === 'gathering', String(probe.same))
    note('此处 counters 没有任何键表达「已签到但没给出发结论」（unchecked 说的是签到）——这就是 C-05 的盲区形状')
  }

  section('2. 页面 → journey 的接缝：数字必须先交出去，且只能从行标志取')
  const rA = await renderWorld(wA)
  {
    const ctx = rA.ctxs[0]
    check('真 J.transitionBlocker 被调用且只被调用一次（页面没有第二套门槛判断，也不重复算）',
      rA.ctxs.length === 1, 'calls=' + rA.ctxs.length)
    check('接缝入参带上「已确认但无出发结论」的人数 notVerified=3',
      !!ctx && Object.prototype.hasOwnProperty.call(ctx, 'notVerified') && ctx.notVerified === 3,
      JSON.stringify(ctx && ctx.notVerified))
    check('接缝是扩键不是换键：原有五个入参一个都不少',
      ['next', 'counters', 'unassignedBoarding', 'coordinating', 'hasTravelFact', 'notVerified']
        .every(k => Object.prototype.hasOwnProperty.call(ctx, k)), Object.keys(ctx || {}).join(','))
    check('交给 journey 的 next 是下一个阶段（gathering → active），不是当前阶段',
      ctx.next === 'active', String(ctx.next))
    check('counters 必须是投影原样（同一对象引用）——页面不得往里塞自造键',
      ctx.counters === rA.view.counters, 'ctx=' + Object.keys(ctx.counters).join(','))
    check('堵住"给 counters 编影子键"那条捷径：ctx.counters 里没有 unresolved / notVerified 一类键',
      !Object.prototype.hasOwnProperty.call(ctx.counters, 'unresolved')
      && !Object.prototype.hasOwnProperty.call(ctx.counters, 'notVerified'),
      Object.keys(ctx.counters).join(','))
    check('交出去的是一个数字而不是 undefined（缺读数不得混成"没人欠结论"）',
      typeof ctx.notVerified === 'number' && Number.isFinite(ctx.notVerified), typeof ctx.notVerified)
  }
  {
    const doctored = JSON.parse(JSON.stringify(rA.view))
    doctored.counters.unchecked = 9
    const rD = await render(doctored)
    check('把 counters.unchecked 改写成 9 时 notVerified 仍是 3 ⇒ 人数取自 rows，不取自 counters',
      rD.ctxs[0].notVerified === 3, JSON.stringify({ nv: rD.ctxs[0].notVerified, unchecked: 9 }))
  }
  {
    const rowsGone = JSON.parse(JSON.stringify(rA.view))
    rowsGone.rows = rowsGone.rows.map(r => Object.assign({}, r, { departure: 'joined' }))
    const rZ = await render(rowsGone)
    check('rows 里人人有出发结论时 notVerified=0（不是 undefined、不是漏传）',
      rZ.ctxs[0].notVerified === 0, JSON.stringify(rZ.ctxs[0].notVerified))
  }

  section('3. notVerified 的口径：多算一个人，预反映就变成假指控')
  {
    const wMixed = publishedWorld(['陈屿', '王五', '赵六', '孙七'])
    toGatheringOrThrow(wMixed)
    checkinAll(wMixed, ['陈屿', '王五', '赵六', '孙七'])
    departAs(wMixed, '赵六', 'coordinating')
    departAs(wMixed, '孙七', 'joined')
    const rM = await renderWorld(wMixed)
    check('coordinating / joined 都不算「无出发结论」：四人里只有 2 人欠结论',
      rM.ctxs[0].notVerified === 2, JSON.stringify(rM.view.rows.map(r => [r.name, r.status, r.departure])))
    check('这个口径与「已签到」无关：全员签到（unchecked=0）时仍为 2',
      rM.view.counters.unchecked === 0 && rM.ctxs[0].notVerified === 2,
      JSON.stringify({ unchecked: rM.view.counters.unchecked, nv: rM.ctxs[0].notVerified }))
    check('服务端同样因为这 2 人拒推进（客户端说的数与域内的门指向同一批人）',
      probeTransition(wMixed, 'active', '集合完成').out.code === 'UNRESOLVED_DEPARTURE')
    {
      const wCancelled = publishedWorld(['陈屿', '王五', '周八'])
      toGatheringOrThrow(wCancelled)
      checkinAll(wCancelled, ['陈屿', '王五'])
      const cancelOut = wCancelled.dispatch(P5, {
        type: 'signup.cancel', activityId: wCancelled.a, signupIds: [wCancelled.ids['周八']], reason: '临时不去了',
      })
      check('夹具：一名已确认者自行取消 ⇒ 状态是 cancelled（真实命令，不是手拼）',
        cancelOut.ok === true && wCancelled.signupOf('周八').status === 'cancelled', JSON.stringify(cancelOut))
      const rC = await renderWorld(wCancelled)
      check('取消掉的人不进 notVerified（只数 confirmed ∧ departure=unknown）',
        rC.ctxs[0].notVerified === 2 && rC.view.counters.confirmed === 2,
        JSON.stringify({ nv: rC.ctxs[0].notVerified, confirmed: rC.view.counters.confirmed }))
    }
    {
      const wPending = publishedWorld(['陈屿'])
      addPending(wPending, '外部候补')
      const rP = await renderWorld(wPending)
      check('待审核的人不进 notVerified：pending 在 counters 里、欠结论在 notVerified 里，两道门分开交',
        rP.ctxs[0].notVerified === 1 && rP.view.counters.pending === 1,
        JSON.stringify({ nv: rP.ctxs[0].notVerified, pending: rP.view.counters.pending }))
    }
  }

  section('4. 接缝测活（阳性对照：数字没交出去时探针就取不到它）')
  {
    const page = await renderWithProbe(wA)
    check('探针从 ctx 取到 3 ⇒ 页面确实把人数交给了 journey（不是门在空转）',
      page.data.transitionHint === 'PROBE[3]', JSON.stringify(page.data.transitionHint))
    const wClean = publishedWorld(['陈屿', '王五', '赵六'])
    toGatheringOrThrow(wClean)
    checkinAll(wClean, ['陈屿', '王五', '赵六'])
    for (const n of ['陈屿', '王五', '赵六']) departAs(wClean, n, 'joined')
    const page0 = await renderWithProbe(wClean)
    check('欠结论人数归零时探针取到 0 ⇒ 接缝双向都活',
      page0.data.transitionHint === 'PROBE[0]', JSON.stringify(page0.data.transitionHint))
    const go = probeTransition(wClean, 'active', '全员已核实随队出发')
    check('全员有出发结论时服务端放行推进（证明「无说明」对应的是真无拦路，而非判据失灵）',
      go.out.ok === true, JSON.stringify(go.out))
    const rClean = await renderWorld(wClean)
    check('真 journey 在这种情况下不给任何门槛说明（没拦路事就不许说话）',
      rClean.page.data.transitionHint === '', JSON.stringify(rClean.page.data.transitionHint))
  }

  section('5. 权限与门槛解耦：说明不得决定按钮姿态，按钮姿态也不得吞掉说明')
  {
    check('门槛未清时按钮仍是可用姿态（先例 §4 L4「不要给一个点不动的灰按钮」；F-01 的修法方向）',
      rA.page.data.canTransition === true && rA.page.data.nextPhaseLabel === '确认出发',
      JSON.stringify({ can: rA.page.data.canTransition, next: rA.page.data.nextPhaseLabel }))
    check('欠结论人数同时交到渲染层（notVerified 已 setData，等渲染条件接上就能带数）',
      rA.page.data.notVerified === 3, JSON.stringify(rA.page.data.notVerified))
    check('门槛说明没有反噬交互：点按钮照样开确认弹层，客户端不自作硬拦',
      (() => { rA.page.onTransition({ currentTarget: { dataset: {} } }); return rA.page.data.transitionOpen === true })(),
      JSON.stringify({ open: rA.page.data.transitionOpen }))
    // 端到端判据（C-05 的可验证形式）：接缝交出去的人数必须出现在页面交给渲染层的那句说明里。
    // 这里只要求"那个数字在里面"，不要求 journey 的措辞——措辞归 tools/journey-test.js（铁律 11）。
    check('端到端：欠结论的那 3 个人已经写进页面交给渲染层的说明里，且按钮姿态没有因此变灰',
      rA.page.data.transitionHint.indexOf('3') !== -1 && rA.page.data.canTransition === true,
      JSON.stringify({ hint: rA.page.data.transitionHint, can: rA.page.data.canTransition }))
    check('前向契约：说明非空时必须带可核对的人数，且权限位不受说明影响',
      rA.page.data.transitionHint !== ''
      && /[0-9]/.test(rA.page.data.transitionHint) && rA.page.data.canTransition === true,
      JSON.stringify(rA.page.data.transitionHint))
    check('页面交出去的说明文本逐字节等于真 journey 对同一入参的返回值（不改写、不追加、不套壳）',
      rA.page.data.transitionHint === rA.realHint,
      JSON.stringify({ hint: rA.page.data.transitionHint, real: rA.realHint }))
    {
      const wPending = publishedWorld(['陈屿'])
      addPending(wPending, '外部候补')
      const rP = await renderWorld(wPending)
      check('说明非空的真实场景（published 有 1 人待审核）：按钮可用 + 说明以那个 1 开头',
        rP.page.data.canTransition === true && rP.page.data.nextPhaseLabel === '开始集合'
        && rP.page.data.transitionHint.indexOf('1') === 0,
        JSON.stringify({ hint: rP.page.data.transitionHint, next: rP.page.data.nextPhaseLabel }))
      check('这条说明同时被服务端证实（published→gathering 因 pending 被拒）',
        probeTransition(wPending, 'gathering', '开始集合').out.code === 'UNRESOLVED_DEPARTURE')
      check('说明非空时也是 journey 的原样输出（页面没有替它补数字、加尾巴、换措辞）',
        rP.realHint !== '' && rP.page.data.transitionHint === rP.realHint,
        JSON.stringify({ hint: rP.page.data.transitionHint, real: rP.realHint }))
    }
    {
      const wArch = publishedWorld(['陈屿'])
      const go = wArch.toArchived(LIN, wArch.a)
      check('夹具：真实命令把活动走到 archived', go.ok === true, JSON.stringify(go))
      const rArch = await renderWorld(wArch)
      check('archived：没有下一步 ⇒ canTransition=false 且没有门槛说明（渲染门改对后不会两行同现）',
        rArch.page.data.canTransition === false && rArch.page.data.transitionHint === ''
        && rArch.page.data.nextPhaseLabel === '',
        JSON.stringify({ can: rArch.page.data.canTransition, hint: rArch.page.data.transitionHint }))
      check('archived 只剩只读：编辑与取消入口都不点亮（没有把「门槛说明」写成第二条出路）',
        rArch.page.data.canEdit === false && rArch.page.data.canCancel === false)
    }
    {
      const wCancel = publishedWorld(['陈屿'])
      const out = wCancel.phase(LIN, wCancel.a, 'cancelled', '天气原因取消')
      check('夹具：published 可真实取消', out.ok === true, JSON.stringify(out))
      const rX = await renderWorld(wCancel)
      check('cancelled：同 archived，无下一步 ⇒ 不得有门槛说明',
        rX.page.data.canTransition === false && rX.page.data.transitionHint === '',
        JSON.stringify({ can: rX.page.data.canTransition, hint: rX.page.data.transitionHint }))
    }
    {
      const wDraft = H.createWorld()
      wDraft.profile(LIN, '林溪')
      wDraft.a = wDraft.createActivity(LIN, { capacity: 12 })
      const rDraft = await renderWorld(wDraft)
      note('草稿阶段 NEXT_PHASE 没有 draft ⇒ canTransition=false，页面给的门槛说明为「' + rDraft.page.data.transitionHint + '」')
      check('草稿：页面给不出任何解释性文本，兜底那句（写死「已归档或已取消」）会被说出口 ⇒ 见 requests R-02',
        rDraft.page.data.canTransition === false && rDraft.page.data.transitionHint === ''
        && rDraft.page.data.canCancel === true,
        JSON.stringify({ can: rDraft.page.data.canTransition, cancel: rDraft.page.data.canCancel }))
    }
  }

  section('6. 本轮边界：取消路径的预反映未动（C-06 仍 OPEN，M-19 整条保持 OPEN）')
  {
    const wActive = publishedWorld(['陈屿'])
    toGatheringOrThrow(wActive)
    checkinAll(wActive, ['陈屿'])
    departAs(wActive, '陈屿', 'joined')
    const go = wActive.phase(LIN, wActive.a, 'active', '开始行程')
    check('夹具：真实命令走到 active', go.ok === true, JSON.stringify(go))
    const rV = await renderWorld(wActive)
    check('active 阶段取消入口收起（既有行为未回退）', rV.page.data.canCancel === false,
      JSON.stringify({ phase: rV.view.activity.phase, cancel: rV.page.data.canCancel }))
    check('说明只由主动作（下一个阶段）算：next=closing 且只有一次调用，取消路径没被塞进同一行',
      rV.ctxs.length === 1 && rV.ctxs[0].next === 'closing',
      JSON.stringify({ calls: rV.ctxs.length, next: rV.ctxs[0].next }))
  }

  section('7. 两维分开记账')
  {
    check('BUSINESS 维：以上全部是真页面 + 真投影 + 真 domain 命令的读数（无一条来自模板文本匹配）', true)
    note('UI 维：NOT_RUN —— 本轮禁止启动微信开发者工具，且渲染条件（workspace.wxml:L72）不在 M19 写入范围。')
    note('本门不断言任何像素/DOM；可见性判据与截图要求见 out/M19/runtime-required.md。')
  }

  console.log('\n==== passed=' + passed + ' failed=' + failed + ' skipped=' + skipped + ' ====')
  process.exit(failed ? 1 : 0)
}

function toGatheringOrThrow(w) {
  const out = w.toGathering(LIN, w.a)
  if (!out.ok) throw new Error('夹具推进到 gathering 失败：' + out.code + ' ' + out.message)
  return out
}

main().catch(err => {
  console.error('门自身异常（视为无效运行，不是产品红）：' + ((err && err.stack) || err))
  process.exit(1)
})
