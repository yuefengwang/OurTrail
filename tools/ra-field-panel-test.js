// R-A 落地门（Wave 2 批次 5 · field-panel 这一棒）：node tools/ra-field-panel-test.js
//
// 覆盖四条（判行为，不判源码长什么样 —— 铁律 30）：
//   C-10 写成功之后：弹层不关（连点是本区高频操作），但动作表必须按新事实重算；
//        「逐人核实依据」是单条命令的法定证据，不得跨命令静默复用。
//   C-18 空态按成因三分支说话（没有人 / 搜索不匹配 / 勾了只看待核实而已清完），并给出真的下一步。
//   A-18 常驻头部不再占用 warning 语义色；danger/success 与异常徽标照旧（色板没被拆掉，只是不再常驻）。
//   A-17 同一个「待到家」计数在同一屏只渲染一遍（页面 26px 可点那一格 vs 面板一行小字）。
//
// 写法约束（都是本仓库已经付过学费的条目，不是自创）：
// · 铁律 21：元素数量不是证据。除「同名计数在同一屏被渲染几份」这一条（它就是 A-17 缺陷的本体），
//   其余判据都是「这个节点此刻会上屏吗 / 它的文本是什么 / 真调那个 handler 之后发了什么命令、读了什么」。
// · 铁律 11：不镜像被测层逻辑。data 一律取真组件、真页面跑完 reload() 之后的输出；
//   动作表由真组件实例重算，测试不自己排按钮。
// · 铁律 33⑥/34⑥：减行类改动必须带阳性对照 ⇒ 「该出现的仍然出现」（staff 宿主、gathering 阶段、
//   未结异常那一行）与「该只剩一遍的只剩一遍」双向都测；只测减掉了会放过「永远不说」那种一刀切。
// · 假服务端会把写命令真的落到 rows 的事实上，reload 拿到的就是写之后的世界 ——
//   否则「那颗按钮消失了吗」测的是夹具而不是代码。
'use strict'
const fs = require('fs')
const path = require('path')

const P = (...p) => path.join(__dirname, '..', 'miniprogram', ...p)
const api = require('../miniprogram/utils/api')
// 4.11 的影子门要临时替换 fieldMetric：必须拿到**组件 require 的那同一份**模块对象
const J = require('../miniprogram/utils/journey')

const FIELD_JS = P('components', 'field-panel', 'field-panel.js')
const WS_JS = P('pages', 'workspace', 'workspace.js')
const FIELD_WXML = fs.readFileSync(P('components', 'field-panel', 'field-panel.wxml'), 'utf8')
const WS_WXML = fs.readFileSync(P('pages', 'workspace', 'workspace.wxml'), 'utf8')
const STAFF_WXML = fs.readFileSync(P('pages', 'staff', 'staff.wxml'), 'utf8')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
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
const settleComp = comp => waitFor(() => comp.data.loading === false)

/* ================= 小 WXML 求值器（与 tools/trip2-gates-test.js 同一形态） =================
 * ① 按这份 data 判每个节点此刻是否会上屏（wx:if/elif/else、wx:for、overlay open、hide 类）；
 * ② 把 bindtap/class/文本/属性里的 {{…}} 求成真实值。解析不了的一律记 unresolvable，由调用方判红。 */
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
function parseWxml(text) {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, '')
  const root = { tag: '#root', attrs: {}, children: [], text: '', selfClosing: true }
  const stack = [root]
  let last = 0
  let m
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(stripped))) {
    const before = stripped.slice(last, m.index)
    if (before.trim()) stack[stack.length - 1].text += before
    last = TAG_RE.lastIndex
    const closing = m[1] === '/'
    const attrs = {}
    if (!closing) {
      const AR = /([@:a-zA-Z_][\w:.:-]*)\s*=\s*"([^"]*)"|([@:a-zA-Z_][\w:.:-]*)/g
      let a
      while ((a = AR.exec(m[3]))) {
        if (a[1] !== undefined) attrs[a[1]] = a[2]
        else if (a[3] !== undefined) attrs[a[3]] = true
      }
    }
    if (closing) { if (stack.length > 1) stack.pop(); continue }
    const selfClosing = m[4] === '/'
    const node = { tag: m[2], attrs, children: [], text: '', selfClosing }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root
}
const bare = expr => {
  const mm = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(String(expr))
  return mm ? mm[1] : null
}
function evalExpr(expr, ctx) {
  try { return { v: new Function('with(this){return (' + expr + ')}').call(ctx), ok: true } }
  catch (e) { return { v: undefined, ok: false } }
}
function truthy(expr, ctx) { const r = evalExpr(expr, ctx); return { show: r.ok && Boolean(r.v), ok: r.ok } }
function printed(text, ctx) {
  let unknown = false
  const out = String(text).replace(/\{\{([^}]*)\}\}/g, (all, e) => {
    const r = evalExpr(e, ctx)
    if (!r.ok) { unknown = true; return '' }
    return r.v === null || r.v === undefined ? '' : String(r.v)
  })
  return { out, unknown }
}
// 属性求值：status-panel 的 title/detail/actionLabel 就靠它读出「此刻真的会印什么」
function attrVal(node, name) {
  const raw = node.attrs[name]
  if (raw === undefined || raw === true) return { val: '', ok: true }
  const b = bare(raw)
  if (b === null) return { val: String(raw), ok: true }
  const r = evalExpr(b, node.ctx)
  return { val: r.v === null || r.v === undefined ? '' : String(r.v), ok: r.ok }
}
function classOf(attrs, ctx) {
  const raw = attrs.class === undefined || attrs.class === true ? '' : String(attrs.class)
  return raw.replace(/\{\{([^}]*)\}\}/g, (all, ex) => {
    const r = evalExpr(ex, ctx)
    return r.ok && r.v ? String(r.v) : ''
  }).replace(/\s+/g, ' ').trim()
}
const hasClass = (cls, name) => new RegExp('(^|\\s)' + name + '(\\s|$)').test(String(cls))
function visibleNodes(wxmlText, data) {
  const root = parseWxml(wxmlText)
  const out = []
  const collectText = (node, ctx) => {
    let acc = printed(node.text, ctx).out
    node.children.forEach(c => { acc += collectText(c, ctx) })
    return acc.replace(/\s+/g, ' ').trim()
  }
  const walkChildren = (children, ctx, overlay, ancestors) => {
    let matched = null
    children.forEach(c => {
      const attrs = c.attrs || {}
      const hasIf = attrs['wx:if'] !== undefined
      const hasElseIf = attrs['wx:elif'] !== undefined
      const hasElse = attrs['wx:else'] !== undefined
      let show
      if (hasIf) { show = truthy(bare(attrs['wx:if']) || 'false', ctx).show; matched = show }
      else if (hasElseIf) {
        if (matched === null) { out.push({ tag: c.tag, attrs, ctx, unresolvable: true, ancestors }); return }
        show = !matched && truthy(bare(attrs['wx:elif']) || 'false', ctx).show
        if (show) matched = true
      } else if (hasElse) { show = matched === false; matched = true }
      else show = true
      if (!show) return
      walkNode(c, ctx, overlay, ancestors)
    })
  }
  const walkNode = (node, ctx, overlay, ancestors) => {
    const attrs = node.attrs || {}
    const cls = classOf(attrs, ctx)
    const rec = {
      tag: node.tag, attrs, ctx, overlay, ancestors, cls,
      text: collectText(node, ctx),
      unresolvable: printed(node.text, ctx).unknown || Object.keys(attrs).some(k => {
        const b = bare(attrs[k])
        return typeof b === 'string' && !evalExpr(b, ctx).ok
      }),
    }
    // 宿主用类名隐藏（workspace 的面板就是 hide 类）：不在屏的子树不该被算进「这一屏」
    if (hasClass(cls, 'hide') || hasClass(cls, 'hidden')) return
    out.push(rec)
    if (node.tag === 'overlay') {
      const openE = attrs.open === undefined || attrs.open === true ? '' : bare(attrs.open)
      const t = openE === '' || openE === null ? { ok: true, show: true } : truthy(openE, ctx)
      rec.isOverlay = true
      rec.overlayOpen = t.ok ? t.show : null
      if (!t.show) return
      walkChildren(node.children, ctx, rec, ancestors.concat([rec]))
      return
    }
    const forE = attrs['wx:for'] !== undefined ? bare(attrs['wx:for']) : null
    if (forE !== null) {
      const r = evalExpr(forE, ctx)
      const list = r.ok && Array.isArray(r.v) ? r.v : []
      const itemName = attrs['wx:for-item'] || 'item'
      const indexName = attrs['wx:for-index'] || 'index'
      list.forEach((el, i) => {
        const sub = Object.assign({}, ctx)
        sub[itemName] = el
        sub[indexName] = i
        const kid = { tag: node.tag, attrs, ctx: sub, overlay, ancestors, cls: classOf(attrs, sub), text: collectText(node, sub) }
        out.push(kid)
        walkChildren(node.children, sub, overlay, ancestors.concat([kid]))
      })
      return
    }
    walkChildren(node.children, ctx, overlay, ancestors.concat([rec]))
  }
  walkChildren(root.children, data, null, [])
  return out
}
const visibleTexts = (wxmlText, data) => visibleNodes(wxmlText, data).filter(n => n.tag === 'text' && n.text).map(n => n.text)
const countWith = (texts, needle) => texts.filter(t => t.indexOf(needle) !== -1).length

/* ================= 实例装载（与 scenario-workspace/staff 同手法） ================= */
function makeWx() {
  const rec = { toasts: [], titles: [], vibrations: 0 }
  global.wx = {
    showToast: o => rec.toasts.push((o && o.title) || ''),
    vibrateShort: () => { rec.vibrations++ },
    setNavigationBarTitle: o => rec.titles.push((o && o.title) || ''),
    navigateTo: () => {},
    pageScrollTo: () => {},
  }
  return rec
}
function compConfig(p) {
  global.Component = cfg => { global.__COMP_CFG = cfg }
  delete require.cache[p]
  require(p)
  return global.__COMP_CFG
}
function pageConfig(p) {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[p]
  require(p)
  return global.__PAGE_CFG
}
function makeComponent(cfg, props) {
  // properties 在真机上会镜像进 this.data（含声明的默认值）：不镜像就测不到「宿主没传」这一支
  const defaults = {}
  Object.keys(cfg.properties || {}).forEach(k => { defaults[k] = cfg.properties[k].value })
  const comp = Object.assign({}, cfg, cfg.methods || {})
  comp.data = Object.assign(defaults, JSON.parse(JSON.stringify(cfg.data || {})), props || {})
  comp.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) setImmediate(cb) }
  comp.triggerEvent = () => {}
  return comp
}
function makePage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) setImmediate(cb) }
  return page
}
function attach(comp) {
  if (comp.lifetimes && comp.lifetimes.attached) comp.lifetimes.attached.call(comp)
  const obs = comp.observers || {}
  Object.keys(obs).forEach(k => obs[k].call(comp))
}

/* ================= 假服务端：写命令真的改事实，读回来的是写之后的世界 ================= */
const NOW = '2026-10-14T09:00:00+08:00'
const ALL_ACTIONS = ['attendance.checkin', 'attendance.departure', 'attendance.home',
  'attendance.returnPlan', 'attendance.node', 'incident.report', 'incident.resolve', 'activity.transition']
function rowRaw(id, name, over) {
  return Object.assign({
    signupId: id, groupId: 'g1', name, status: 'confirmed', avatar: '',
    tripMode: 'shared', pickup: '东门集合点', vehicle: '1号车', seat: '01',
    checkedIn: false, outboundBoarded: false, returnBoarded: false,
    needsOutboundBoarding: false, needsSeatAssignment: false, returnBoardingApplies: true,
    returnPlan: 'assigned', departure: 'unknown', home: false,
  }, over || {})
}
function serverState(over) {
  return Object.assign({
    phase: 'gathering',
    rows: [rowRaw('s1', '张三'), rowRaw('s2', '李四')],
    incidents: [], positions: [],
    permittedActions: ALL_ACTIONS.slice(),
  }, over || {})
}
function countersOf(st) {
  const live = st.rows.filter(r => r.status === 'confirmed')
  return {
    confirmed: live.length,
    pending: st.rows.filter(r => r.status === 'pending').length,
    occupied: live.length,
    waitlisted: 0,
    remaining: 5,
    unassigned: live.filter(r => r.tripMode === 'shared' && !r.vehicle).length,
    unchecked: live.filter(r => !r.checkedIn).length,
    pendingHome: live.filter(r => r.departure === 'joined' && !r.home).length,
    openIncidents: st.incidents.filter(i => !i.resolved).length,
    selfTravel: live.filter(r => r.tripMode === 'self').length,
    vehicleTravel: live.filter(r => r.tripMode === 'shared').length,
    assigned: live.filter(r => r.tripMode === 'shared' && r.vehicle).length,
  }
}
function viewOf(st, perspective) {
  return {
    kind: 'activity', perspective, primarySignupId: null,
    permittedActions: st.permittedActions,
    activity: {
      id: 'a1', title: '青城后山 · 周末轻徒步', phase: st.phase,
      startAt: NOW, deadlineAt: NOW, endAt: NOW,
      pickupPoints: [{ id: 'pk1', name: '东门集合点', meetingAt: NOW }],
      routeSnapshot: { points: [{ id: 'pt1', name: '起点' }, { id: 'pt2', name: '营地' }] },
      completeness: { route: true, points: true, risks: true },
    },
    rows: st.rows, incidents: st.incidents, positions: st.positions,
    counters: countersOf(st),
  }
}
// 写命令落到 rows 上：这正是「弹层里的按钮该不该消失」的真判据来源
function applyCommand(st, payload) {
  const find = () => st.rows.find(r => r.signupId === payload.signupId)
  switch (payload.type) {
    case 'attendance.checkin': { const r = find(); if (r) r.checkedIn = true; return { affected: true } }
    case 'attendance.departure': { const r = find(); if (r) r.departure = payload.outcome.kind; return { affected: true } }
    case 'attendance.home': { const r = find(); if (r) r.home = true; return { affected: true } }
    case 'attendance.returnPlan': { const r = find(); if (r) r.returnPlan = payload.plan; return { affected: true } }
    case 'attendance.node': return { affected: false }
    case 'incident.report': {
      st.incidents.push({ id: 'in' + (st.incidents.length + 1), description: payload.description, resolved: false, subjectIds: payload.signupIds })
      return { affected: true }
    }
    case 'incident.resolve': {
      const i = st.incidents.find(x => x.id === payload.incidentId)
      if (i) i.resolved = true
      return { affected: true }
    }
    default: return { affected: false }
  }
}
function installServer(st, opts) {
  const o = opts || {}
  const env = { reads: [], cmds: [], revision: 1, failNext: null }
  api.read = request => {
    env.reads.push(request)
    return Promise.resolve({ view: viewOf(st, request.perspective), revision: env.revision, now: NOW })
  }
  api.dispatchAndSync = (payload, expectedRevision, page) => {
    env.cmds.push({ payload, expectedRevision })
    if (env.failWith) {
      // 复刻 utils/api.js:151-162 的组件可见契约：needRefresh / outcomeUnknown 都会去重读页面，
      // 然后把错误原样抛给调用方。这里不重发命令（requestId 每次都是新的，重发＝第二次业务写）。
      const e = env.failWith
      env.failWith = null
      if (e.needRefresh || e.outcomeUnknown) {
        Promise.resolve().then(() => { if (page && typeof page.reload === 'function') page.reload() })
      }
      return Promise.reject(e)
    }
    const res = applyCommand(st, payload)
    if (res.affected) env.revision += 1
    return Promise.resolve({ revision: env.revision, targetIds: ['a1'], replayed: false })
  }
  return env
}

/* ================= 1. C-10：写成功后弹层跟随事实，依据不跨命令复用 ================= */
async function scenario1() {
  section('1. C-10 写成功之后：弹层不关、动作表按新事实重算、逐人核实依据不跨命令复用')
  const st = serverState({
    phase: 'gathering',
    rows: [rowRaw('s3', '王五', { checkedIn: false, needsOutboundBoarding: false })],
  })
  const rec = makeWx()
  const env = installServer(st)
  const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
  attach(comp)
  await settleComp(comp)
  comp.openSheet({ currentTarget: { dataset: { id: 's3' } } })
  const labels = () => comp.data.actions.map(a => a.label).join('|')
  check('1.0 开层时动作表按此刻行事实装配（未签到 ⇒ 主动作是签到、joined 不给，并说明缺哪一步）',
    comp.data.sheetOpen === true && comp.data.actions[0].label === '确认现场签到'
    && !comp.data.actions.some(a => a.outcome === 'joined')
    && comp.data.sheetHint === '请先完成现场签到，再核实是否随队出发。',
    JSON.stringify({ l: labels(), hint: comp.data.sheetHint }))
  const beforeLabels = labels()
  comp.onNote({ detail: { value: '当面核实：本人已在东门集合点，背包为证' } })
  comp.onAction({ currentTarget: { dataset: { index: '0' } } })
  await waitFor(() => comp.data.busy === false && env.reads.length === 2)
  check('1.1 写成功后弹层仍然开着（连点是本区高频操作，修法不是把层关掉）',
    comp.data.sheetOpen === true, String(comp.data.sheetOpen))
  check('1.2 动作表跟着新事实重算：那颗「确认现场签到」收掉了（服务端此刻再收会回 WRONG_PHASE）',
    !comp.data.actions.some(a => a.type === 'attendance.checkin'), labels())
  check('1.2b 刷新只搬按钮，不裁人：此人仍在现场名单里（已签到未出发），弹层不该因此对他关门',
    comp.data.rows.some(r => r.signupId === 's3') && comp.data.sheetOpen === true,
    JSON.stringify({ rows: comp.data.rows.map(r => r.signupId), open: comp.data.sheetOpen }))
  check('1.3 新成立的那一步同时补上屏：已签到 + 不需要乘车 ⇒ 「核实已随队出发」此刻出现，指路文案让位',
    comp.data.actions.some(a => a.outcome === 'joined') && comp.data.sheetHint === '',
    JSON.stringify({ l: labels(), hint: comp.data.sheetHint }))
  check('1.4 重算没有把「一屏一个主动作」弄丢：第一条 primary，其余不是',
    comp.data.actions[0].primary === true && comp.data.actions.slice(1).every(a => !a.primary), labels())
  check('1.5 命令提交成功后依据清空：它是这一条核实的法定证据，不是弹层的常驻内容',
    comp.data.note === '', JSON.stringify(comp.data.note))
  check('1.6 保存反馈没被重算冲掉：message 说出的是刚那条命令 + toast 照旧',
    comp.data.message === '确认现场签到已保存。' && rec.toasts.indexOf('已保存') !== -1,
    JSON.stringify({ m: comp.data.message, t: rec.toasts }))
  const needIndex = () => comp.data.actions.findIndex(a => a.needNote)
  const n0 = env.cmds.length
  comp.onAction({ currentTarget: { dataset: { index: String(needIndex()) } } })
  check('1.7 清空后不重填就点下一条（需要依据的那条）⇒ 被「请先填写依据」拦下、一条命令都不发',
    env.cmds.length === n0 && comp.data.error === '请先在上方填写逐人核实的依据。' && comp.data.busy === false,
    JSON.stringify({ sent: env.cmds.length - n0, error: comp.data.error }))
  comp.onNote({ detail: { value: '电话核实：明早自行到西门汇合' } })
  const n1 = env.cmds.length
  comp.onAction({ currentTarget: { dataset: { index: String(needIndex()) } } })
  await waitFor(() => env.cmds.length === n1 + 1)
  check('1.8 第二条命令带的依据是这一条新填的那段（不是上一条签到那段），形状仍是 outcome.kind + evidence.note',
    env.cmds[n1].payload.outcome.evidence.note === '电话核实：明早自行到西门汇合'
    && env.cmds[n1].payload.outcome.kind === 'not_departed', JSON.stringify(env.cmds[n1].payload))
  await waitFor(() => env.reads.length === 3 && comp.data.busy === false)
  check('1.8b 每一次写成功都清一次依据（第二条命令之后同样是空的，不是只在第一条清）',
    comp.data.note === '', JSON.stringify(comp.data.note))
  // 阳性对照：这条命令不改这一行的现场事实 ⇒ 动作表必须一条不少（证明重算是判据在动，不是成功后清空按钮）
  const stableLabels = labels()
  comp.onNote({ detail: { value: '膝盖扭伤，随队缓慢行进' } })
  comp.onAction({ currentTarget: { dataset: { index: String(comp.data.actions.findIndex(a => a.type === 'incident.report')) } } })
  await waitFor(() => comp.data.openIncidents === 1)
  check('1.9 阳性对照：报备异常不改动这一行的现场事实 ⇒ 动作表逐条不变（重算不是「写成功就清按钮」）',
    labels() === stableLabels && comp.data.sheetOpen === true,
    JSON.stringify({ before: stableLabels, after: labels() }))
  check('1.10 那条异常报备带的就是新写的依据文字（旧依据没混进 description）',
    env.cmds[env.cmds.length - 1].payload.description === '膝盖扭伤，随队缓慢行进',
    JSON.stringify(env.cmds[env.cmds.length - 1].payload))
  // 失败路径：用户的输入必须留着（那时它还有用）
  comp.onNote({ detail: { value: '再补一条依据' } })
  env.failWith = Object.assign(new Error('云端没有回话'), { code: 'NETWORK', outcomeUnknown: true })
  const failIndex = comp.data.actions.findIndex(a => a.type === 'incident.report')
  const readBefore = env.reads.length
  comp.onAction({ currentTarget: { dataset: { index: String(failIndex) } } })
  await waitFor(() => comp.data.busy === false)
  check('1.11 写失败时依据与动作表都原样留着（失败不该吞输入，也不该顺手清按钮）',
    comp.data.note === '再补一条依据' && labels() === stableLabels && !!comp.data.error,
    JSON.stringify({ note: comp.data.note, error: comp.data.error }))
  // 人出局：这一行不再属于当前范围 ⇒ 不许留一排点了必被拒的按钮，但也不能什么都不说
  st.rows[0].status = 'removed'
  comp.observers.syncKey.call(comp, 'removed@' + (env.revision + 1))
  await waitFor(() => comp.data.actions.length === 0)
  check('1.12 人已不在当前范围：动作表清空、点名说清为什么，而不是留一排必被拒的按钮',
    comp.data.actions.length === 0 && /已不在现场名单的当前范围内/.test(comp.data.sheetHint),
    JSON.stringify({ actions: comp.data.actions.length, hint: comp.data.sheetHint }))
  const sheetNodes = visibleNodes(FIELD_WXML, comp.data)
  const overlay = sheetNodes.filter(n => n.isOverlay)
  const closeName = overlay.length ? String(overlay[0].attrs.close || overlay[0].attrs['bind:close'] || '') : ''
  check('1.13 关着出口的弹层仍然是弹层：close 绑定解析到真方法（收按钮收不出「层里没人」）',
    overlay.length === 1 && overlay[0].overlayOpen === true && closeName === 'closeSheet'
    && typeof comp[closeName] === 'function',
    JSON.stringify({ overlay: overlay.length, closeName }))
  check('1.14 同一轮重读里空态卡也跟着换成因（写之后的世界同时是 C-18 的输入）',
    comp.data.rows.length === 0 && /这一场暂时没有在场人员/.test(comp.data.emptyTitle),
    JSON.stringify({ rows: comp.data.rows.length, title: comp.data.emptyTitle }))
  comp.closeSheet()
  // 1.15 「确认到达此节点」这类按钮的权限位必须留在判据里（重算被搬到别处时最容易掉的就是这一半）
  {
    const st2 = serverState({
      phase: 'active',
      rows: [rowRaw('s9', '钱九', { checkedIn: true, departure: 'joined', needsOutboundBoarding: false })],
      permittedActions: ['attendance.departure', 'attendance.home', 'attendance.node', 'incident.report', 'incident.resolve', 'attendance.returnPlan', 'attendance.checkin'],
    })
    makeWx()
    installServer(st2)
    const c2 = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(c2); await settleComp(c2)
    c2.openSheet({ currentTarget: { dataset: { id: 's9' } } })
    check('1.15a 有 attendance.node 权限位 + 该行已随队 ⇒ 节点按钮与节点选择器一起出现',
      c2.data.actions.some(a => a.type === 'attendance.node') && c2.data.pointEnabled === true,
      JSON.stringify(c2.data.actions.map(a => a.label)))
    st2.permittedActions = st2.permittedActions.filter(p => p !== 'attendance.node')
    c2.observers.syncKey.call(c2, 'active@node-off')
    await settleComp(c2)
    c2.openSheet({ currentTarget: { dataset: { id: 's9' } } })
    check('1.15b 权限位撤掉后（重算走的是同一条判据）：节点按钮与选择器都不再出现（能力门不被搬丢）',
      !c2.data.actions.some(a => a.type === 'attendance.node') && c2.data.pointEnabled === false,
      JSON.stringify({ l: c2.data.actions.map(a => a.label), pe: c2.data.pointEnabled }))
    // 1.16 弹层开着的时候权限被撤：刷新必须把 actions / pointEnabled / sheetHint 三件一起搬走
    st2.permittedActions = ALL_ACTIONS.slice()
    c2.observers.syncKey.call(c2, 'active@node-on')
    await settleComp(c2)
    c2.openSheet({ currentTarget: { dataset: { id: 's9' } } })
    st2.permittedActions = st2.permittedActions.filter(p => p !== 'attendance.node')
    c2.observers.syncKey.call(c2, 'active@node-off-2')
    await waitFor(() => !c2.data.actions.some(a => a.type === 'attendance.node'))
    check('1.16 开层期间权限被撤：按钮消失的同时节点选择器也必须收起（刷新只搬一半就是漏）',
      c2.data.sheetOpen === true && c2.data.pointEnabled === false,
      JSON.stringify({ open: c2.data.sheetOpen, pe: c2.data.pointEnabled }))
  }
}

/* ================= 2. C-18：空态按成因三分支说话，并给出真的下一步 ================= */
async function scenario2() {
  section('2. C-18 空态三分成因：没有人 / 搜索不匹配 / 待核实已清完，各配各自的下一步')
  const emptyCardOf = data => {
    const node = visibleNodes(FIELD_WXML, data).filter(n => n.tag === 'status-panel' && !n.isOverlay)[0]
    if (!node) return null
    return {
      title: attrVal(node, 'title').val,
      detail: attrVal(node, 'detail').val,
      action: attrVal(node, 'actionLabel').val,
      kind: attrVal(node, 'kind').val,
    }
  }
  // 2.1 确实没有已确认参与人
  {
    makeWx()
    const st = serverState({ rows: [rowRaw('s1', '张三', { status: 'pending' })] })
    installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    const card = emptyCardOf(comp.data)
    check('2.1 没有已确认参与人：说清「这里只列已确认的人」，不给一个做不到的动作',
      card && card.kind === 'empty' && /暂时没有在场人员/.test(card.title) && card.action === '',
      JSON.stringify(card))
  }
  // 2.2 搜索不匹配（含「搜索词进文案」与「清空搜索是真下一步」）
  {
    makeWx()
    const st = serverState({ rows: [rowRaw('s1', '张三'), rowRaw('s2', '李四')] })
    const env = installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    check('2.2a 阳性对照（有人在屏时不出现空态卡）：不是「永远说一句空态」',
      emptyCardOf(comp.data) === null && comp.data.rows.length === 2, JSON.stringify(comp.data.rows.length))
    const readsBefore = env.reads.length
    comp.onSearch({ detail: { value: '赵' } })
    await waitFor(() => env.reads.length === readsBefore + 1 && comp.data.rows.length === 0)
    const card = emptyCardOf(comp.data)
    check('2.2b 搜索无果：话里带着此刻的搜索词（证明这句话是分支给的，不是写死的一句）',
      card && card.title.indexOf('赵') !== -1 && /没有匹配/.test(card.title), JSON.stringify(card))
    comp.onSearch({ detail: { value: '李' } })
    await waitFor(() => comp.data.rows.length === 1)
    check('2.2c 换个搜索词，那张卡的话跟着换（同一分支、不同输入 ⇒ 不同输出）',
      emptyCardOf(comp.data) === null && comp.data.rows[0].name === '李四', JSON.stringify(comp.data.rows))
    comp.onSearch({ detail: { value: '赵' } })
    await waitFor(() => comp.data.rows.length === 0)
    const card2 = emptyCardOf(comp.data)
    check('2.2d 给出真的下一步（有按钮），点它之后搜索条件真的被撤掉、人重新出现在屏上',
      card2.action !== '' && typeof comp.onClearFilters === 'function', JSON.stringify(card2))
    const reads2 = env.reads.length
    comp.onClearFilters()
    await waitFor(() => env.reads.length === reads2 + 1 && comp.data.rows.length > 0)
    check('2.2e 真调之后：search 复位 + 恰好重读一次 + 名单回来（不是只改了文案）',
      comp.data.search === '' && env.reads.length === reads2 + 1 && comp.data.rows.length === 2,
      JSON.stringify({ search: comp.data.search, reads: env.reads.length - reads2, rows: comp.data.rows.length }))
  }
  // 2.3 勾了「只看待核实」而待核实已清完 —— 这本来是好消息
  {
    makeWx()
    const st = serverState({
      rows: [rowRaw('s1', '张三', { departure: 'not_departed' }), rowRaw('s2', '李四', { departure: 'not_departed' })],
    })
    const env = installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    comp.onUnresolvedOnly({ detail: { value: ['on'] } })
    await waitFor(() => comp.data.rows.length === 0)
    const card = emptyCardOf(comp.data)
    check('2.3a 全员已结清时说成好消息（不再是「没有符合条件的人」那种可读成「本场没人」的中性句）',
      card && /都已经核完/.test(card.title) && card.action !== '', JSON.stringify(card))
    const reads2 = env.reads.length
    comp.onClearFilters()
    await waitFor(() => env.reads.length === reads2 + 1 && comp.data.rows.length > 0)
    check('2.3b 点「看全部人员」真的取消勾选并让两行回到屏上',
      comp.data.unresolvedOnly === false && comp.data.rows.length === 2, JSON.stringify(comp.data.rows.length))
  }
  // 2.4 三种成因三张话术互不相同，且不给 staff 页一个做不到的指令
  {
    makeWx()
    const st = serverState({ rows: [rowRaw('s1', '张三', { departure: 'not_departed' })] })
    const env = installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'staff' })
    attach(comp); await settleComp(comp)
    comp.onSearch({ detail: { value: '不存在的人' } })
    await waitFor(() => comp.data.rows.length === 0)
    const searchCard = emptyCardOf(comp.data)
    comp.onSearch({ detail: { value: '' } })
    await waitFor(() => comp.data.rows.length === 1)
    comp.onUnresolvedOnly({ detail: { value: ['on'] } })
    await waitFor(() => comp.data.rows.length === 0)
    const settledCard = emptyCardOf(comp.data)
    st.rows = []
    comp.observers.syncKey.call(comp, 'empty@' + (env.revision + 1))
    await waitFor(() => comp.data.emptyTitle.indexOf('在场人员') !== -1)
    const noneCard = emptyCardOf(comp.data)
    const three = [searchCard.title, settledCard.title, noneCard.title]
    check('2.4a 三种成因给三句不同的话（塌回一句共用文案会被这条抓住）',
      new Set(three).size === 3, JSON.stringify(three))
    check('2.4b 文案对两个宿主都成立：不写「去名单区审核」这类只有组织者做得到的指令',
      [searchCard, settledCard, noneCard].every(c => !/审核|去名单区|批准/.test(c.title + c.detail)),
      JSON.stringify([searchCard, settledCard, noneCard].map(c => c.title + '|' + c.detail)))
    check('2.4c staff 视角同样按成因分支说话（面板不是只对 workspace 成立）',
      searchCard.kind === 'empty' && noneCard.kind === 'empty' && searchCard.action !== '',
      JSON.stringify({ s: searchCard, n: noneCard }))
  }
  // 2.5 按钮上那句话 == 点下去真的被撤掉的那些条件（说一套做一套也会被这条抓住）
  {
    const combos = [
      { search: '赵', unresolved: false, label: '清空搜索条件' },
      { search: '', unresolved: true, label: '取消勾选' },
      { search: '赵', unresolved: true, label: '清空搜索与勾选' },
    ]
    for (const c of combos) {
      makeWx()
      const st = serverState({ rows: [rowRaw('s1', '张三', { departure: 'not_departed' })] })
      const env = installServer(st)
      const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
      attach(comp); await settleComp(comp)
      // 条件要等那一次重读落地之后再读卡片：onSearch/onUnresolvedOnly 都是先 setData 再 reload，
      // 只等 data 里的标志位会读到上一轮的卡片（本轮实测踩过，是判据自己假绿）。
      let reads = env.reads.length
      if (c.search) {
        comp.onSearch({ detail: { value: c.search } })
        await waitFor(() => env.reads.length > reads && comp.data.rows.length === 0)
        reads = env.reads.length
      }
      if (c.unresolved) {
        comp.onUnresolvedOnly({ detail: { value: ['on'] } })
        await waitFor(() => env.reads.length > reads)
      }
      const card = emptyCardOf(comp.data)
      check('2.5[' + (c.search ? '搜"' + c.search + '"' : '') + (c.unresolved ? '+勾' : '') + '] 按钮名点明此刻要撤掉的条件',
        card && card.action === c.label, JSON.stringify({ want: c.label, got: card && card.action }))
      comp.onClearFilters()
      await waitFor(() => comp.data.rows.length > 0)
      check('2.5[' + (c.search ? '搜"' + c.search + '"' : '') + (c.unresolved ? '+勾' : '') + '] 点它之后真的撤掉了那些条件（名单回到屏上）',
        comp.data.search === '' && comp.data.unresolvedOnly === false && comp.data.rows.length === 1,
        JSON.stringify({ search: comp.data.search, un: comp.data.unresolvedOnly, rows: comp.data.rows.length }))
    }
  }
  // 2.6 「清空」按钮不空转：条件本来就全撤着的时候不该有任何清空类按钮（空态另有其卡）
  {
    makeWx()
    const st = serverState({ rows: [] })
    const env = installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    const card = emptyCardOf(comp.data)
    check('2.6a 没有已确认的人时不给「清空条件」类按钮（那种场合没有可撤的条件，按钮会是空转）',
      card && card.action === '' && /这一场暂时没有在场人员/.test(card.title), JSON.stringify(card))
    const reads = env.reads.length
    comp.onClearFilters()
    await sleep(30)
    check('2.6b 条件本来就全撤着时点它不多打一次全量读（读操作的自重试只该发生在真的需要时）',
      env.reads.length === reads, JSON.stringify({ reads: env.reads.length, before: reads }))
  }
}

/* ================= 3. A-18：常驻头部不占用警告语义色，色板留给真的出事 ================= */
async function scenario3() {
  section('3. A-18 常驻头部换成中性形态；danger/success 与异常徽标照旧')
  const semanticHeads = data => visibleNodes(FIELD_WXML, data)
    .filter(n => !n.isOverlay && /(^|\s)callout(\s|$)/.test(n.cls) && /(^|\s)warning(\s|$)/.test(n.cls))
  for (const phase of ['gathering', 'closing']) {
    makeWx()
    const st = serverState({
      phase,
      rows: [rowRaw('s1', '张三', { departure: phase === 'closing' ? 'joined' : 'unknown', home: false })],
      incidents: [{ id: 'in1', description: '李四膝盖扭伤', resolved: false, subjectIds: ['s1'] }],
    })
    installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer', pageMetrics: true })
    attach(comp); await settleComp(comp)
    check('3.1[' + phase + '] 常驻头部不再有任何 warning callout（标题/规则说明/计数都是中性形态）',
      semanticHeads(comp.data).length === 0, JSON.stringify(semanticHeads(comp.data).map(n => n.cls)))
    const texts = visibleTexts(FIELD_WXML, comp.data)
    check('3.2[' + phase + '] 换形态没把解释换没：分区标题与那句口径说明仍在屏',
      texts.indexOf(comp.data.headline) !== -1
      && texts.some(t => t.indexOf('签到、上车、出发与到家分别记录，不能相互替代。') !== -1),
      JSON.stringify(texts.slice(0, 4)))
    check('3.3[' + phase + '] 解释用的是解释位（section-title + small muted），不是塞进按钮或标题',
      visibleNodes(FIELD_WXML, comp.data).some(n => hasClass(n.cls, 'section-title') && n.text === comp.data.headline)
      && visibleNodes(FIELD_WXML, comp.data).some(n => hasClass(n.cls, 'small') && hasClass(n.cls, 'muted') && /分别记录/.test(n.text)), '')
    const warnBadges = visibleNodes(FIELD_WXML, comp.data).filter(n => hasClass(n.cls, 'badge') && hasClass(n.cls, 'warning'))
    check('3.4[' + phase + '] warning 通道现在只跟着真异常走：未结异常那条徽标是 warning 且印「待跟进」',
      warnBadges.length === 1 && warnBadges[0].text === '待跟进', JSON.stringify(warnBadges.map(n => [n.cls, n.text])))
    comp.setData({ error: '云端没有回话，这一条没有确认生效。' })
    check('3.5[' + phase + '] 真的出事时 danger callout 仍上屏（色板没被拆掉，只是不再常驻）',
      visibleNodes(FIELD_WXML, comp.data).some(n => !n.isOverlay && hasClass(n.cls, 'danger') && n.text.indexOf('云端没有回话') !== -1), '')
    comp.setData({ error: '', message: '确认现场签到已保存。' })
    check('3.6[' + phase + '] 成功反馈仍上屏（改造只动了头部，没顺手关掉另两块）',
      visibleNodes(FIELD_WXML, comp.data).some(n => !n.isOverlay && hasClass(n.cls, 'success') && n.text.indexOf('已保存') !== -1), '')
  }
  {
    // 已解决的异常不再占用 warning：同一屏只有真未结的那条才是琥珀色
    makeWx()
    const st = serverState({
      rows: [rowRaw('s1', '张三')],
      incidents: [{ id: 'in1', description: '已送医并由家属陪同', resolved: true, subjectIds: ['s1'] }],
    })
    installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    const warnBadges = visibleNodes(FIELD_WXML, comp.data).filter(n => hasClass(n.cls, 'warning'))
    check('3.7 异常已闭环时整屏不再出现 warning（琥珀色不再由常驻内容长期占用）',
      warnBadges.length === 0, JSON.stringify(warnBadges.map(n => [n.cls, n.text])))
  }
}

/* ================= 4. A-17：同一个待到家计数在同一屏只出现一遍 ================= */
async function scenario4() {
  section('4. A-17 计数归页面还是归面板：同一屏只渲染一遍，且入口一个都没减')
  // 组织者：真 workspace.js 装配页面 data（含第三格），真 field-panel 装配面板 data
  async function bootWorkspace(phase, pendingHomeRows) {
    const st = serverState({ phase, rows: pendingHomeRows })
    makeWx()
    const env = installServer(st)
    const page = makePage(pageConfig(WS_JS))
    page.onLoad({ id: 'a1' })
    await page.reload()
    const panel = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer', pageMetrics: true })
    attach(panel)
    await settleComp(panel)
    return { page, panel, env, st }
  }
  const joined3 = [
    rowRaw('s1', '张三', { departure: 'joined', home: false }),
    rowRaw('s2', '李四', { departure: 'joined', home: false }),
    rowRaw('s6', '赵六', { departure: 'joined', home: false }),
  ]
  {
    const { page, panel } = await bootWorkspace('closing', joined3)
    const screen = visibleTexts(WS_WXML, Object.assign({}, page.data, { tab: 3 }))
      .concat(visibleTexts(FIELD_WXML, panel.data))
    check('4.1 组织者 closing 现场分区：同一个待到家读数这一屏只出现一遍（页面的 26px 可点那格）',
      countWith(screen, '待到家') === 1 && screen.some(t => t === '待到家 ›'),
      JSON.stringify(screen.filter(t => /待到家/.test(t))))
    check('4.2 留下来的那一遍是可点入口，且指向现场分区（大数字是给用户看的那一遍）',
      visibleNodes(WS_WXML, Object.assign({}, page.data, { tab: 3 }))
        .some(n => hasClass(n.cls, 'metric') && n.attrs.bindtap === 'goField' && typeof page.goField === 'function'), '')
    check('4.3 面板那一行减掉了，但同屏的「未结异常」照旧出（减的是那一格，不是整块计数）',
      visibleTexts(FIELD_WXML, panel.data).filter(t => /未结异常/.test(t)).length === 1
      && visibleTexts(FIELD_WXML, panel.data).some(t => /未结异常 0 项/.test(t)),
      JSON.stringify(visibleTexts(FIELD_WXML, panel.data).filter(t => /未结异常|待到家/.test(t))))
    check('4.4 计数仍然同源：页面那一格印的就是投影给的 pendingHome（3）',
      page.data.thirdValue === 3 && page.data.thirdLabel === '待到家' && panel.data.pendingHome === 3,
      JSON.stringify({ v: page.data.thirdValue, l: page.data.thirdLabel, p: panel.data.pendingHome }))
  }
  {
    // 阳性对照 A：页面第三格此刻是「待签到」，那面板那一行就是全场唯一的待到家读数，必须照旧出
    const { page, panel } = await bootWorkspace('gathering', [rowRaw('s1', '张三', { departure: 'joined', home: false })])
    const screen = visibleTexts(WS_WXML, Object.assign({}, page.data, { tab: 3 }))
      .concat(visibleTexts(FIELD_WXML, panel.data))
    check('4.5 阳性对照：gathering 时页面那格印的是待签到 ⇒ 面板的待到家照旧出现（不是一刀切减行）',
      panel.data.showHomeCount === true && countWith(screen, '待到家') === 1 && countWith(screen, '待签到') === 1,
      JSON.stringify({ show: panel.data.showHomeCount, home: countWith(screen, '待到家'), un: countWith(screen, '待签到') }))
  }
  {
    // 阳性对照 B：staff 页没有指标区，面板那一行是它唯一的读数来源
    makeWx()
    const st = serverState({ phase: 'closing', rows: joined3 })
    installServer(st)
    const staffPage = makePage(pageConfig(P('pages', 'staff', 'staff.js')))
    staffPage.onLoad({ id: 'a1' })
    const panel = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'staff' })
    attach(panel)
    await settleComp(panel)
    const screen = visibleTexts(STAFF_WXML, staffPage.data).concat(visibleTexts(FIELD_WXML, panel.data))
    check('4.6 协作任务页（staff 宿主没有指标区）：这一屏仍有且只有一份待到家，且带着数字',
      panel.data.pageMetrics === false && panel.data.showHomeCount === true
      && countWith(screen, '待到家') === 1 && screen.some(t => /待到家 3 人/.test(t)),
      JSON.stringify({ metrics: panel.data.pageMetrics, hits: screen.filter(t => /待到家/.test(t)) }))
    check('4.7 staff 页接线没被顺手改：面板仍由 staff.wxml 挂上、perspective 仍是 staff',
      /<field-panel[^>]*perspective="staff"/.test(STAFF_WXML)
      && !/page-metrics/.test(STAFF_WXML), '')
  }
  {
    // 页面常驻指标区在四个分区都在（入口没减）：goRoster/goTransport/goField 都解析到真方法
    const { page } = await bootWorkspace('closing', joined3)
    const perTab = [0, 1, 2, 3].map(tab => {
      const nodes = visibleNodes(WS_WXML, Object.assign({}, page.data, { tab }))
      const metrics = nodes.filter(n => hasClass(n.cls, 'metric'))
      return { tab, taps: metrics.map(n => String(n.attrs.bindtap)).sort().join(',') }
    })
    check('4.8 三格指标即入口在四个分区都常驻，三个跳转都解析到真方法（减行没有减掉任何入口）',
      perTab.every(p => p.taps === 'goField,goRoster,goTransport')
      && ['goField', 'goRoster', 'goTransport'].every(k => typeof page[k] === 'function'),
      JSON.stringify(perTab))
  }
  {
    // 反向对照：宿主没声明指标区时，同一份数据下面板仍印这一份读数（承重的是宿主接线，不是阶段特例）
    makeWx()
    const st = serverState({ phase: 'closing', rows: joined3 })
    installServer(st)
    const panel = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer', pageMetrics: false })
    attach(panel)
    await settleComp(panel)
    check('4.9 反向对照：同一阶段同一份数据，pageMetrics 关掉 ⇒ 面板就把这一行印回来（承重的是宿主接线）',
      panel.data.showHomeCount === true && visibleTexts(FIELD_WXML, panel.data).some(t => /待到家 3 人/.test(t)),
      JSON.stringify(visibleTexts(FIELD_WXML, panel.data).filter(t => /待到家/.test(t))))
    const wsTag = (WS_WXML.match(/<field-panel[^>]*/g) || []).join('')
    check('4.10 workspace 宿主确实把这一格交给了页面：field-panel 上接的是 page-metrics',
      /page-metrics="{{true}}"/.test(wsTag), wsTag)
  }
  {
    // 4.11 影子门（铁律 19/22 的可执行形式）：面板不许内联第二套「哪一格印什么」的阶段表。
    // 把 journey.fieldMetric 临时改成「收尾也看待签到」⇒ 页面那一格就不再是待到家 ⇒ 面板那一行必须跟着回来；
    // 还原后逐项相同。内联了 phase 判断的实现会在这一条上红（见 mutate H5）。
    const { panel } = await bootWorkspace('closing', joined3)
    check('4.11a 影子门的前置：closing + 宿主有指标区 ⇒ 面板此刻不印这一行',
      panel.data.showHomeCount === false, String(panel.data.showHomeCount))
    const real = J.fieldMetric
    try {
      J.fieldMetric = () => ({ key: 'unchecked', label: '待签到' })
      panel.observers.syncKey.call(panel, 'closing@shadow')
      const flipped = await waitFor(() => panel.data.showHomeCount === true, 800)
      check('4.11b 影子改口径 ⇒ 面板那一行跟着回来（它读的是 journey 那一份口径，不是自己抄的阶段表）',
        flipped === true, 'showHomeCount=' + String(panel.data.showHomeCount))
    } finally { J.fieldMetric = real }
    panel.observers.syncKey.call(panel, 'closing@restore')
    const back = await waitFor(() => panel.data.showHomeCount === false, 800)
    check('4.11c 还原口径后逐项相同（影子门不是空转）',
      back === true && !visibleTexts(FIELD_WXML, panel.data).some(t => /待到家/.test(t)),
      'showHomeCount=' + String(panel.data.showHomeCount))
  }
}

/* ================= 5. C-10 续：刷新住在「重读」里，三个重读入口都要跟上 ================= */
async function scenario5() {
  section('5. C-10 续 宿主重读 / 冲突重读 / 结果未知重读：弹层动作表都得跟上，且失败不吞用户输入')
  // 5.1 宿主下发新 sync-key（别的面板写了库）引起的那次重读
  {
    makeWx()
    const st = serverState({ rows: [rowRaw('s1', '张三')] })
    const env = installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    comp.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    check('5.1a 开层时这一个人的签到按钮在（面板手里是当时的行事实）',
      comp.data.actions.some(a => a.type === 'attendance.checkin'), JSON.stringify(comp.data.actions.map(a => a.label)))
    st.rows[0].checkedIn = true // 别人（或另一个入口）已经把她签到了，面板并不知道
    comp.observers.syncKey.call(comp, 'gathering@' + (env.revision + 1))
    await waitFor(() => !comp.data.actions.some(a => a.type === 'attendance.checkin'))
    check('5.1b 由宿主 sync-key 引起的那次重读同样刷新弹层（不是只有自己写成功才刷新）',
      comp.data.sheetOpen === true && !comp.data.actions.some(a => a.type === 'attendance.checkin'),
      JSON.stringify(comp.data.actions.map(a => a.label)))
  }
  // 5.2 CONFLICT（needRefresh）：重读、依据保留、动作表换新
  {
    makeWx()
    const st = serverState({ rows: [rowRaw('s1', '张三')] })
    const env = installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    comp.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    comp.onNote({ detail: { value: '当面核实：她在集合点' } })
    st.rows[0].checkedIn = true
    env.failWith = Object.assign(new Error('版本冲突'), { code: 'CONFLICT', needRefresh: true })
    const reads = env.reads.length
    const cmds = env.cmds.length
    comp.onAction({ currentTarget: { dataset: { index: '0' } } })
    await waitFor(() => comp.data.busy === false && !!comp.data.error)
    check('5.2a 被拒的写没有静默重发（命令恰好一条），且按 api.js 的契约重读一次对齐服务端',
      env.cmds.length === cmds + 1 && env.reads.length === reads + 1,
      JSON.stringify({ cmds: env.cmds.length - cmds, reads: env.reads.length - reads }))
    check('5.2b 失败时依据原样留着（那时它还有用，用户改一改就能重发；清空才是帮倒忙）',
      comp.data.note === '当面核实：她在集合点', JSON.stringify(comp.data.note))
    await waitFor(() => comp.data.rows.length > 0)
    check('5.2c 冲突后的那一次重读也把弹层动作表换了新事实（别人已签到 ⇒ 这颗按钮不再是可点的）',
      !comp.data.actions.some(a => a.type === 'attendance.checkin'),
      JSON.stringify(comp.data.actions.map(a => a.label)))
  }
  // 5.3 结果未知（NETWORK/超时）：只重读，绝不自动重发
  {
    makeWx()
    const st = serverState({ rows: [rowRaw('s1', '张三')] })
    const env = installServer(st)
    const comp = makeComponent(compConfig(FIELD_JS), { activityId: 'a1', perspective: 'organizer' })
    attach(comp); await settleComp(comp)
    comp.openSheet({ currentTarget: { dataset: { id: 's1' } } })
    comp.onNote({ detail: { value: '电话核实：她随后到' } })
    env.failWith = Object.assign(new Error('云端没有回话'), { code: 'NETWORK', outcomeUnknown: true })
    const cmds = env.cmds.length
    const reads = env.reads.length
    comp.onAction({ currentTarget: { dataset: { index: '0' } } })
    await waitFor(() => comp.data.busy === false && !!comp.data.error)
    await waitFor(() => env.reads.length === reads + 1)
    await sleep(30)
    check('5.3 结果未知：一条命令、一次重读、零自动重发（requestId 每次新生成，重发＝第二次业务写）',
      env.cmds.length === cmds + 1 && env.reads.length === reads + 1 && comp.data.busy === false,
      JSON.stringify({ cmds: env.cmds.length - cmds, reads: env.reads.length - reads }))
    check('5.3b 结果未知同样保留依据（服务端可能已经收下了，等重读对齐后再说）',
      comp.data.note === '电话核实：她随后到', JSON.stringify(comp.data.note))
  }
}

async function main() {
  const scenarios = [scenario1, scenario2, scenario3, scenario4, scenario5]
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
