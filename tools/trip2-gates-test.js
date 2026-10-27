// TRIP2 第二轮修复门（Wave 2）：node tools/trip2-gates-test.js
//
// 覆盖四条（写入集只在 pages/{vehicle,signup,activity,staff}）：
//   M-13 剩余两半（D-07 + C-14）：车长「确认本程发车」＝ 客户端预检 + 确认层，不硬拦截
//   A-13：名额不足时本屏最强视觉必须是此刻唯一走得通的通道（整组候补），且不锁死正式报名
//   A-02：活动详情状态 callout 不得把同一句话连印两遍
//   F-04 的 enablePullDownRefresh 侧：staff 页有手势、失效信号逐次不同、拉头必收尾
//
// 写法约束（本仓既有铁律，不是自创）：
// · 铁律 30：门钉行为不钉源码文本。「这个按钮此刻能不能点／这行会上屏吗」由**真页面自己的 data**
//   喂给一个小的 WXML 求值器判读，再**真调解析出来的 handler** 观察发没发命令。
// · 铁律 21：元素数量不是证据；判的是入口解析到哪个方法 + 那个方法真调后的后果。
// · 铁律 11：不镜像被测层逻辑。data 一律取真页面 render()/renderView() 的输出，夹具只喂投影；
//   「谁发了命令」靠真调探针看 cmds 增量，不扫方法体、不抄变量名清单。
// · 铁律 19：预检复用同屏 expectedCount/boardedCount 背后那一对集合，因此额外钉两条差分判据
//   （提示里的人数 == 应到 − 已上车；提示里的人名 == 页面上判为「未上车」的那些行），
//   一旦有人在页面里另起一套「谁该上车」的推导，这两条就会分叉报红。
// · 铁律 33⑥：减控件/减话类改动必须有「一条都不减」的阳性对照 ⇒ 全员清点齐备时确认层必须
//   **不出现**、发车必须**单击即发**；预检提示必须在三种不该说的场合都不渲染。
// · 崩红不当抓到：段落跑在 guard 里，抛错记一条 ✗ 读数并继续跑后面的段落。
'use strict'
const fs = require('fs')
const path = require('path')

const P = (...p) => path.join(__dirname, '..', 'miniprogram', ...p)
const api = require('../miniprogram/utils/api')

const VEHICLE_JS = P('pages', 'vehicle', 'vehicle.js')
const VEHICLE_WXML = P('pages', 'vehicle', 'vehicle.wxml')
const VEHICLE_JSON = P('pages', 'vehicle', 'vehicle.json')
const SIGNUP_JS = P('pages', 'signup', 'signup.js')
const SIGNUP_WXML = P('pages', 'signup', 'signup.wxml')
const ACTIVITY_JS = P('pages', 'activity', 'activity.js')
const ACTIVITY_WXML = P('pages', 'activity', 'activity.wxml')
const STAFF_JS = P('pages', 'staff', 'staff.js')
const STAFF_JSON = P('pages', 'staff', 'staff.json')
const STAFF_WXML = P('pages', 'staff', 'staff.wxml')
const FIELD_PANEL_JS = P('components', 'field-panel', 'field-panel.js')

let passed = 0
let failed = 0
const harnessErrors = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }
async function guarded(name, fn) {
  try { await fn() } catch (e) {
    failed++
    const msg = String((e && e.stack) || e).split('\n')[0]
    harnessErrors.push(name + ':' + msg)
    console.error('  ✗ ' + name + ' 执行异常（' + msg + '）')
  }
}
const src = p => fs.readFileSync(p, 'utf8')
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 2000
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return cond()
}
const keysOf = o => Object.keys(o).sort().join(',')
function deferred() {
  const d = {}
  d.promise = new Promise((res, rej) => { d.resolve = res; d.reject = rej })
  return d
}

/* ================= 小 WXML 求值器 =================
 * 只做两件事：① 按这份 data 判每个节点此刻是否会上屏（wx:if/elif/else 链、wx:for、
 * <overlay open> 的可见性）；② 把 bindtap/class/文本里的 {{…}} 求成真实值。
 * 解析不了的条件一律记 unresolvable 并由调用方判红——不允许「解析不了就放过」。 */
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
    const tag = m[2]
    const attrSrc = m[3]
    const selfClosing = m[4] === '/'
    if (closing) { if (stack.length > 1) stack.pop(); continue }
    const attrs = {}
    const AR = /([@:a-zA-Z_][\w:.:-]*)\s*=\s*"([^"]*)"|([@:a-zA-Z_][\w:.:-]*)/g
    let a
    while ((a = AR.exec(attrSrc))) {
      if (a[1] !== undefined) attrs[a[1]] = a[2]
      else if (a[3] !== undefined) attrs[a[3]] = true
    }
    const node = { tag, attrs, children: [], text: '', selfClosing }
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
  try {
    const v = new Function('with(this){return (' + expr + ')}').call(ctx)
    return { v, ok: true }
  } catch (e) { return { v: undefined, ok: false } }
}
function truthy(expr, ctx) {
  const r = evalExpr(expr, ctx)
  return { show: r.ok && Boolean(r.v), ok: r.ok }
}
function printed(text, ctx) {
  let unknown = false
  const out = String(text).replace(/\{\{([^}]*)\}\}/g, (all, e) => {
    const r = evalExpr(e, ctx)
    if (!r.ok) { unknown = true; return '' }
    return r.v === null || r.v === undefined ? '' : String(r.v)
  })
  return { out, unknown }
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
  const textUnknown = node => printed(node.text, data).unknown
  const walkChildren = (children, ctx, overlay, ancestors) => {
    let matched = null
    children.forEach(c => {
      const attrs = c.attrs || {}
      const hasIf = attrs['wx:if'] !== undefined
      const hasElseIf = attrs['wx:elif'] !== undefined
      const hasElse = attrs['wx:else'] !== undefined
      let show
      if (hasIf) { const t = truthy(bare(attrs['wx:if']) || 'false', ctx); show = t.show; matched = show }
      else if (hasElseIf) {
        if (matched === null) { out.push({ tag: c.tag, attrs, unresolvable: true, ancestors }); return }
        const t = truthy(bare(attrs['wx:elif']) || 'false', ctx)
        show = !matched && t.show
        if (show) matched = true
      } else if (hasElse) { show = matched === false; matched = true }
      else show = true
      if (!show) return
      walkNode(c, ctx, overlay, ancestors)
    })
  }
  const walkNode = (node, ctx, overlay, ancestors) => {
    const attrs = node.attrs || {}
    const rec = {
      tag: node.tag, attrs, ctx, overlay, ancestors,
      text: collectText(node, ctx), cls: classOf(attrs, ctx),
      unresolvable: textUnknown(node) || Object.keys(attrs).some(k => {
        const b = bare(attrs[k])
        return typeof b === 'string' && !evalExpr(b, ctx).ok
      }),
      node,
    }
    out.push(rec)
    if (node.tag === 'overlay') {
      const openE = attrs.open === true ? '' : bare(attrs.open === undefined ? '' : attrs.open)
      const t = openE === null || openE === '' ? { ok: true, show: true } : truthy(openE, ctx)
      rec.isOverlay = true
      rec.overlayOpen = t.ok ? t.show : null
      rec.overlayTitle = attrs.title === true || attrs.title === undefined ? '' : String(attrs.title)
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
        const kid = {
          tag: node.tag, attrs, ctx: sub, overlay, ancestors,
          text: collectText(node, sub), cls: classOf(attrs, sub), node,
        }
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
// 可见的可点入口：bindtap 求值成方法名（三元表达式点了哪一个，由这份 data 决定）
function liveControls(wxmlText, data, pageCfg) {
  return visibleNodes(wxmlText, data)
    .filter(n => n.attrs && n.attrs.bindtap !== undefined && !n.isOverlay)
    .map(n => {
      const raw = n.attrs.bindtap
      const e = bare(raw)
      let handler = ''
      let unresolved = false
      if (e === null) handler = String(raw)
      else {
        const r = evalExpr(e, n.ctx)
        if (!r.ok) unresolved = true
        else handler = r.v === null || r.v === undefined ? '' : String(r.v)
      }
      return {
        label: n.text,
        handler,
        unresolved,
        classes: n.cls,
        classTpl: n.attrs.class === undefined || n.attrs.class === true ? '' : String(n.attrs.class),
        overlay: n.overlay ? n.overlay.overlayTitle : null,
        inOverlay: !!n.overlay,
        hasDisabledClass: hasClass(n.cls, 'disabled'),
        knownHandler: handler !== '' && typeof pageCfg[handler] === 'function',
        tappable: handler !== '' && typeof pageCfg[handler] === 'function',
        missingHandler: handler !== '' && typeof pageCfg[handler] !== 'function',
      }
    })
}
// 真调探针：谁真的写了库，看 cmds 的增量（不扫方法体）。
// 探针必须带上宿主页的实例字段（activityId/vehicleId/revision/view 都不在 data 里），
// 否则发出去的 payload 会缺 id，测的就是探针自己而不是页面。
function makeProbe(cfg, page, data) {
  const probe = makeInstance(cfg)
  probe.data = JSON.parse(JSON.stringify(data || page.data))
  Object.keys(page).forEach(k => {
    if (k === 'data' || k === 'setData' || k === '_patches') return
    probe[k] = page[k]
  })
  return probe
}
const MK_EVENT = { currentTarget: { dataset: { id: 's2', leg: 'outbound' } }, detail: {} }
function writableHandlers(controls, page, cfg, env, data) {
  const hits = []
  const threw = []
  controls.filter(c => c.tappable).forEach(c => {
    const probe = makeProbe(cfg, page, data)
    const before = env.cmds.length
    try { probe[c.handler](MK_EVENT) } catch (e) { threw.push(c.handler + ':' + String(e && e.message || e).slice(0, 40)) }
    if (env.cmds.length > before) hits.push(c.handler)
  })
  return { hits, threw }
}
function visibleTexts(wxmlText, data) {
  return visibleNodes(wxmlText, data).filter(n => !n.isOverlay && n.tag === 'text' && n.text).map(n => n.text)
}

/* ================= 真页面装载 ================= */
function loadPage(file) {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[require.resolve(file)]
  require(file)
  return global.__PAGE_CFG
}
function loadComponent(file) {
  global.Component = cfg => { global.__COMP_CFG = cfg }
  delete require.cache[require.resolve(file)]
  require(file)
  return global.__COMP_CFG
}
function makeInstance(cfg) {
  const inst = Object.assign({}, cfg)
  // 页面配置的方法直接铺在实例上；组件配置的方法在 cfg.methods 里，必须一起铺开，
  // 否则 panel.reload() 这种真调用会先炸在探针自己身上（测的就是夹具而不是页面了）。
  if (cfg.methods) Object.assign(inst, cfg.methods)
  const data = {}
  Object.keys(cfg.properties || {}).forEach(k => {
    const p = cfg.properties[k]
    data[k] = p && Object.prototype.hasOwnProperty.call(p, 'value') ? p.value : undefined
  })
  Object.assign(data, cfg.data || {})
  inst.data = JSON.parse(JSON.stringify(data))
  inst._patches = []
  inst.triggerEvent = function (name, detail) { (inst._events = inst._events || []).push({ name, detail }) }
  inst.selectComponent = () => null
  inst.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.keys(patch).forEach(k => { this.data[k] = patch[k] })
    if (cb) setImmediate(cb)
  }
  return inst
}
function makePage(file) { return makeInstance(loadPage(file)) }

let wxRec = null
function stubWx() {
  wxRec = { toasts: [], stops: 0, clipboard: [], vibrations: 0, nav: [] }
  const store = {}
  global.wx = {
    showToast: o => wxRec.toasts.push((o && o.title) || ''),
    hideToast: () => {},
    vibrateShort: () => { wxRec.vibrations++ },
    setClipboardData: o => { wxRec.clipboard.push((o && o.data) || ''); if (o && o.success) o.success() },
    setNavigationBarTitle: () => {},
    navigateTo: o => wxRec.nav.push((o && o.url) || ''),
    switchTab: o => wxRec.nav.push((o && o.url) || ''),
    stopPullDownRefresh: () => { wxRec.stops++ },
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    clearStorageSync: () => {},
  }
  return wxRec
}

/* ================= vehicle 夹具（形状对齐 selectors 的 vehicleTask 投影） ================= */
const NOW_ISO = '2026-10-14T09:00:00+08:00'
function person(over) {
  const p = Object.assign({
    signupId: 's2', groupId: 'g1', name: '李四', status: 'confirmed',
    pickup: '东门集合点', vehicle: '1号车', seat: '01',
    checkedIn: true, outboundBoarded: false, returnBoarded: false,
    returnPlan: 'assigned', departure: 'joined', home: false, avatar: '', phone: '13800000002',
  }, over || {})
  p.returnBoardingApplies = p.returnPlan === 'assigned'
  p.needsOutboundBoarding = !p.outboundBoarded
  return p
}
function vehicleView(mutate) {
  const view = {
    kind: 'activity', perspective: 'vehicle', primarySignupId: null,
    permittedActions: ['attendance.board', 'vehicle.depart', 'vehicle.complete'],
    activity: { id: 'a1', title: '青城后山 · 周末轻徒步', phase: 'gathering', pickupPoints: [], routeSnapshot: { points: [] } },
    rows: [], incidents: [], positions: [],
    counters: { confirmed: 3, pending: 0, occupied: 3, waitlisted: 0, remaining: 0, unassigned: 0, unchecked: 0, pendingHome: 0, openIncidents: 0 },
    vehicleTask: {
      vehicle: {
        id: 'v1', activityId: 'a1', label: '1号车', plate: '川A·12345', legalCapacity: 7, blockedSeats: 1,
        drivers: [{ kind: 'service', name: '老司机', phone: '13800000001', userId: null }],
        seatLabels: ['01', '02', '03'], pickupPointIds: ['pk-1'],
        legs: { outbound: { departed: null, completed: null }, return: { departed: null, completed: null } },
      },
      passengers: [
        person({ signupId: 's2', name: '李四' }),
        person({ signupId: 's3', name: '王五', seat: '02', departure: 'unknown', checkedIn: false }),
        person({ signupId: 's4', name: '赵六', seat: '03' }),
      ],
    },
  }
  if (mutate) mutate(view)
  return view
}
function installVehicleApi(view, opts) {
  opts = opts || {}
  const env = { reads: [], cmds: [], state: { revision: opts.revision == null ? 9 : opts.revision }, gate: opts.gate || null }
  api.read = request => {
    env.reads.push(request)
    if (opts.readReject) return Promise.reject(opts.readReject)
    const v = typeof view === 'function' ? view(request) : view
    return Promise.resolve({ view: v, revision: env.state.revision, now: NOW_ISO })
  }
  api.dispatchAndSync = (payload, expectedRevision, page) => {
    env.cmds.push({ payload, expectedRevision, page })
    if (env.gate) return env.gate.promise.then(res => { env.state.revision += 1; return res })
    env.state.revision += 1
    return Promise.resolve({ revision: env.state.revision, targetIds: ['a1'], replayed: false })
  }
  return env
}
async function bootVehicle(view, opts) {
  stubWx()
  const env = installVehicleApi(view, opts)
  const page = makePage(VEHICLE_JS)
  page.onLoad({ id: 'a1', vehicleId: 'v1' })
  page.onShow()
  await waitFor(() => page.data.loading === false)
  return { page, env }
}

/* ================= V. M-13 D-07 + C-14 ================= */
async function partVehicle() {
  section('V. M-13 D-07/C-14：发车前的预检与确认层（真页面 data + 真 handler）')
  const cfg = loadPage(VEHICLE_JS)
  const wxml = src(VEHICLE_WXML)
  const json = JSON.parse(src(VEHICLE_JSON))
  check('V0 弹层地基已接线：vehicle.json 注册 overlay 且路径存在（未注册＝点了没反应，铁律 3）',
    json.usingComponents && json.usingComponents.overlay === '/components/overlay/overlay'
    && fs.existsSync(P('components', 'overlay', 'overlay.wxml')),
    JSON.stringify(json.usingComponents || {}))

  // —— 主场景：去程 3 人应到、0 人上车（M<N）
  {
    const { page, env } = await bootVehicle(vehicleView())
    check('V1 预检复用同屏两个数：还差人数 == 应到 − 已上车（3−0）',
      page.data.pendingCount === page.data.expectedCount - page.data.boardedCount && page.data.pendingCount === 3,
      JSON.stringify({ p: page.data.pendingCount, e: page.data.expectedCount, b: page.data.boardedCount }))
    check('V2 预检不另起一套规则：提示里的人名 == 页面上判为未上车的那些行（逐人对齐）',
      page.data.pendingNames === page.data.passengers.filter(p => p.status === '未上车').map(p => p.name).join('、'),
      JSON.stringify({ names: page.data.pendingNames, rows: page.data.passengers.map(p => p.name + ':' + p.status) }))
    const idle = liveControls(wxml, page.data, cfg)
    const depart = idle.filter(c => c.label === '确认本程发车' && !c.inOverlay)
    check('V3 页面上确实有一个可见可达的「确认本程发车」入口，且不是灰按钮（门有输入）',
      depart.length === 1 && depart[0].tappable && !depart[0].hasDisabledClass, JSON.stringify(depart))
    const cmdsBefore = env.cmds.length
    page.onDepartAsk()
    check('V4 主按钮此刻解析到的是「问」而不是「写」：真调后零命令 + 确认层打开',
      depart.length === 1 && depart[0].handler === 'onDepartAsk'
      && env.cmds.length === cmdsBefore && page.data.departAsk === true,
      JSON.stringify({ h: depart[0] && depart[0].handler, cmds: env.cmds.length, ask: page.data.departAsk }))
    const inDialog = liveControls(wxml, page.data, cfg).filter(c => c.inOverlay)
    const probe5 = writableHandlers(inDialog, page, cfg, env)
    const exec = probe5.hits
    check('V5 确认层打开那一刻，弹层内可达入口恰有一个真的写库（另一条只关层），且它就是 onDepart',
      inDialog.length === 2 && exec.length === 1 && exec[0] === 'onDepart',
      JSON.stringify({ entries: inDialog.map(c => [c.label, c.handler]), exec, threw: probe5.threw }))
    check('V6 那条写命令 = vehicle.depart，payload 键集合与证据文案都和旧契约逐字相同（没顺手改服务端契约）',
      env.cmds.length === cmdsBefore + 1 && env.cmds[cmdsBefore].payload.type === 'vehicle.depart'
      && keysOf(env.cmds[cmdsBefore].payload) === 'activityId,leg,note,type,vehicleId'
      && env.cmds[cmdsBefore].payload.vehicleId === 'v1' && env.cmds[cmdsBefore].payload.leg === 'outbound'
      && env.cmds[cmdsBefore].payload.note === '本车清点后发车',
      JSON.stringify(env.cmds[cmdsBefore] && env.cmds[cmdsBefore].payload))
    check('V7 CAS 基准仍是读取时那个 revision（确认层没有绕过两层 CAS 的基准）',
      env.cmds[cmdsBefore].expectedRevision === 9, String(env.cmds[cmdsBefore].expectedRevision))
    const danger = visibleNodes(wxml, page.data).filter(n => n.tag === 'view' && hasClass(n.cls, 'callout') && hasClass(n.cls, 'danger'))
    check('V8 询问阶段没有任何红字（失败文案只在真的失败时出现，确认层不是把错误提前）',
      danger.length === 0, JSON.stringify(danger.map(n => n.text)))
  }

  // —— 取消路径
  {
    const { page, env } = await bootVehicle(vehicleView())
    page.onDepartAsk()
    check('V9 确认层打开时一条命令都没发（询问不是执行）',
      page.data.departAsk === true && env.cmds.length === 0, String(env.cmds.length))
    const overlay = visibleNodes(wxml, page.data).find(n => n.isOverlay && n.overlayOpen === true)
    const closeHandler = overlay ? String(overlay.attrs['bind:close'] || '') : ''
    check('V10 打开的弹层真的有 close 出口且解析到真方法（不靠点遮罩猜）',
      !!overlay && closeHandler !== '' && typeof page[closeHandler] === 'function', JSON.stringify({ closeHandler }))
    const texts = visibleTexts(wxml, page.data)
    check('V11 确认层里此刻真的印着「差谁 + 不可改写」（文本在场不算，必须这一刻会渲染）',
      texts.some(t => t.indexOf('还有 3 人没有上车记录') !== -1 && t.indexOf('李四') !== -1 && t.indexOf('王五') !== -1 && t.indexOf('赵六') !== -1)
      && texts.some(t => t.indexOf('不可改写') !== -1), JSON.stringify(texts))
    page[closeHandler]()
    check('V12 close 出口只关层：零命令 + departAsk 复位',
      page.data.departAsk === false && env.cmds.length === 0,
      JSON.stringify({ ask: page.data.departAsk, cmds: env.cmds.length }))
    const back = liveControls(wxml, Object.assign({}, page.data, { departAsk: true }), cfg)
      .filter(c => c.inOverlay && c.label === '先回去清点')
    const n0 = env.cmds.length
    if (back.length === 1) page.onDepartCancel()
    check('V13 弹层里有一条说得出口路的按钮（「先回去清点」），解析到真方法且它不写库',
      back.length === 1 && back[0].knownHandler && env.cmds.length === n0, JSON.stringify(back))
    const closed = liveControls(wxml, page.data, cfg)
    check('V14 关层之后弹层内没有任何可达入口（常驻但隐藏＝不接收点击，E-07 裁定形态）',
      closed.filter(c => c.inOverlay).length === 0, JSON.stringify(closed.map(c => [c.label, c.inOverlay])))
  }

  // —— 阳性对照：全员清点齐备 ⇒ 不加这一层（现场高频页，铁律 33⑥）
  {
    const { page, env } = await bootVehicle(vehicleView(v => {
      v.vehicleTask.passengers.forEach(p => { p.outboundBoarded = true })
    }))
    check('V15 阳性对照：应到==已上车时 pendingCount 归零、提示行不渲染（不是无条件加层）',
      page.data.pendingCount === 0 && page.data.boardedCount === 3 && page.data.showPendingNotice === false
      && !visibleTexts(wxml, page.data).some(t => t.indexOf('还差') !== -1),
      JSON.stringify({ p: page.data.pendingCount, notice: page.data.showPendingNotice }))
    const depart = liveControls(wxml, page.data, cfg).filter(c => c.label === '确认本程发车' && !c.inOverlay)
    page.onDepartAsk()
    check('V16 齐备时单击直发：确认层不出现、恰发一单 vehicle.depart（省掉那次多余点击）',
      depart.length === 1 && depart[0].handler === 'onDepartAsk' && page.data.departAsk === false
      && env.cmds.length === 1 && env.cmds[0].payload.type === 'vehicle.depart',
      JSON.stringify({ ask: page.data.departAsk, cmds: env.cmds.map(c => c.payload.type) }))
    await waitFor(() => page.data.busy === false)
  }

  // —— 部分清点：人数与名单都要跟着同屏那两个数走
  {
    const { page } = await bootVehicle(vehicleView(v => {
      v.vehicleTask.passengers[0].outboundBoarded = true
    }))
    check('V17 部分清点（3 应到 / 1 已上车）：提示说 2 人、名单只剩未上车那两位（数字与名单同源）',
      page.data.pendingCount === 2 && page.data.expectedCount === 3 && page.data.boardedCount === 1
      && page.data.pendingNames === '王五、赵六' && page.data.showPendingNotice === true,
      JSON.stringify({ p: page.data.pendingCount, names: page.data.pendingNames }))
  }

  // —— 不该说话的三种场合
  {
    const { page, env } = await bootVehicle(vehicleView(v => {
      v.activity.phase = 'active'
      v.vehicleTask.vehicle.legs.outbound.departed = { at: NOW_ISO, by: 'u-vc', note: '' }
    }))
    check('V18 已发车：仍有缺口也不再喊「还差几人」（不可回退的事实不冒充待办）',
      page.data.departed === true && page.data.pendingCount === 3 && page.data.showPendingNotice === false
      && !visibleTexts(wxml, page.data).some(t => t.indexOf('还差') !== -1),
      JSON.stringify({ d: page.data.departed, p: page.data.pendingCount, n: page.data.showPendingNotice }))
    const depart = liveControls(wxml, page.data, cfg).filter(c => c.label === '确认本程发车' && !c.inOverlay)
    const before = env.cmds.length
    page.onDepartAsk()
    page.onDepart()
    check('V19 已发车时那颗入口点不动、带 disabled，真调也被守卫吞掉（三层配对，加层没有放松守卫）',
      depart.length === 1 && depart[0].handler === '' && depart[0].hasDisabledClass
      && env.cmds.length === before && page.data.departAsk === false,
      JSON.stringify({ e: depart, cmds: env.cmds.length }))
  }
  {
    const { page } = await bootVehicle(vehicleView(v => { v.vehicleTask.passengers[1].departure = 'not_departed' }))
    check('V20 已核实未出发的人不进「应到」，也不进未上车名单（沿用投影标志，页面不重推谁该上车）',
      page.data.expectedCount === 2 && page.data.pendingCount === 2
      && page.data.passengers[1].status === '未出发' && page.data.pendingNames.indexOf('王五') === -1,
      JSON.stringify({ e: page.data.expectedCount, p: page.data.pendingCount, names: page.data.pendingNames }))
  }
  {
    const { page } = await bootVehicle(vehicleView())
    page.onLeg({ currentTarget: { dataset: { leg: 'return' } } })
    await waitFor(() => page.data.leg === 'return')
    await sleep(20)   // onLeg 的重算发生在 setData 回调里（铁律 5），立刻读会拿到旧快照
    check('V21 gathering 阶段返程不可操作：canOperate=false ⇒ 提示与动作区都不出现（阶段门不冒充待办）',
      page.data.canOperate === false && page.data.showPendingNotice === false
      && !visibleNodes(wxml, page.data).some(n => hasClass(n.cls, 'form-actions')),
      JSON.stringify({ co: page.data.canOperate, n: page.data.showPendingNotice }))
  }

  // —— 在途守卫：连点 / busy 期间不存在任何可达的写入口
  {
    const gate = deferred()
    const { page, env } = await bootVehicle(vehicleView(), { gate })
    page.onDepartAsk()
    const confirm = liveControls(wxml, page.data, cfg).filter(c => c.inOverlay && c.label.indexOf('仍然确认发车') !== -1)
    check('V22 确认层里那条写入口解析到 onDepart 且此刻可达（门有输入）',
      confirm.length === 1 && confirm[0].handler === 'onDepart' && confirm[0].tappable, JSON.stringify(confirm))
    page.onDepart()
    page.onDepart()
    page.onDepart()
    check('V23 连点三次「仍然确认发车」只发一单（确认层没有稀释 onDepart 的入口守卫）',
      env.cmds.length === 1, 'cmds=' + env.cmds.length)
    check('V24 确认层在写命令发出那一刻收起（不留一个还能再点的旧层）',
      page.data.departAsk === false && page.data.busy === true,
      JSON.stringify({ ask: page.data.departAsk, busy: page.data.busy }))
    const snapshot = JSON.parse(JSON.stringify(page.data))
    const inFlight = liveControls(wxml, snapshot, cfg)
    gate.resolve({ revision: 10, targetIds: ['v1'], replayed: false })
    await waitFor(() => page.data.busy === false)
    const probe25 = writableHandlers(inFlight, page, cfg, env, snapshot)
    check('V25 写命令在途那份真实快照里，屏幕上不存在任何还能点着写库的入口，主按钮带 disabled（C-01b）',
      probe25.hits.length === 0 && inFlight.some(c => c.label === '确认本程发车' && c.hasDisabledClass),
      JSON.stringify({ hits: probe25.hits, n: inFlight.length }))
    check('V26 在途结束后 busy 复位、成功反馈照常（震动 + toast「已确认发车」）',
      page.data.busy === false && wxRec.vibrations === 1 && wxRec.toasts.indexOf('已确认发车') !== -1,
      JSON.stringify({ busy: page.data.busy, v: wxRec.vibrations, t: wxRec.toasts }))
  }

  // —— 失败可见性：红字只印一次，且紧贴按钮不在页尾
  {
    stubWx()
    const env = installVehicleApi(vehicleView())
    const err = Object.assign(new Error('仍有本车人员未上车或未核实去向，请逐人清点。'), { code: 'UNRESOLVED_DEPARTURE' })
    api.dispatchAndSync = payload => { env.cmds.push({ payload }); return Promise.reject(err) }
    const page = makePage(VEHICLE_JS)
    page.onLoad({ id: 'a1', vehicleId: 'v1' })
    page.onShow()
    await waitFor(() => page.data.loading === false)
    page.onDepartAsk()
    page.onDepart()
    await waitFor(() => page.data.busy === false)
    check('V27 服务端拒绝原文透出到页面（确认层不代替服务端判定，也不改掉那句话）',
      page.data.error === '仍有本车人员未上车或未核实去向，请逐人清点。' && page.data.busy === false, page.data.error)
    const nodes = visibleNodes(wxml, page.data)
    const danger = nodes.filter(n => n.tag === 'view' && hasClass(n.cls, 'callout') && hasClass(n.cls, 'danger'))
    const errIdx = nodes.indexOf(danger[0])
    const btnIdx = nodes.findIndex(n => n.text === '确认本程发车')
    check('V28 失败行只渲染一次（同一句印两遍就是 A-02 那个形态，不许在这里复发）',
      danger.length === 1 && danger[0].text === page.data.error, JSON.stringify(danger.map(n => n.text)))
    check('V29 失败行在文档顺序上位于发车按钮之前（红字紧贴那颗按钮，不再沉到页尾）',
      errIdx !== -1 && btnIdx !== -1 && errIdx < btnIdx, JSON.stringify({ errIdx, btnIdx }))
    const n0 = env.cmds.length
    page.onDepartAsk()
    check('V30 失败后仍可再次发起（一次失败不该把整页锁死），且重开确认层不再多发命令',
      page.data.departAsk === true && env.cmds.length === n0, JSON.stringify({ ask: page.data.departAsk, cmds: env.cmds.length }))
  }

  // —— 同屏不可出现两颗 primary（设计系统：一屏只留一个实心主按钮）
  {
    const { page } = await bootVehicle(vehicleView())
    page.onDepartAsk()
    const primaries = liveControls(wxml, page.data, cfg).filter(c => hasClass(c.classes, 'primary'))
    check('V31 确认层打开时本屏只有一颗 primary 实心主按钮（其余走 danger/text，不出现两颗同权重）',
      primaries.length === 1 && primaries[0].label === '确认本程发车',
      JSON.stringify(primaries.map(c => [c.label, c.classes])))
  }

  // —— 禁用姿态配对矩阵：class 里的 disabled 与 bindtap 置空必须同真同假（C-01/review-checklist 三层）
  {
    const { page } = await bootVehicle(vehicleView())
    const base = JSON.parse(JSON.stringify(page.data))
    const variants = []
    ;[false, true].forEach(b => {
      ;[false, true].forEach(d => {
        ;[false, true].forEach(cp => {
          ;[false, true].forEach(ask => {
            variants.push(Object.assign({}, base, { busy: b, departed: d, completed: cp, departAsk: ask, showPendingNotice: d ? false : base.showPendingNotice }))
          })
        })
      })
    })
    const mismatch = []
    const neverUnbound = []
    variants.forEach(v => {
      liveControls(wxml, v, cfg).forEach(c => {
        const canDisable = /\bdisabled\b/.test(c.classTpl)
        if (!canDisable) return
        if (c.hasDisabledClass !== (c.handler === '')) {
          mismatch.push(JSON.stringify([v.busy, v.departed, v.completed, v.departAsk, c.label, c.handler, c.hasDisabledClass]))
        }
        if (c.hasDisabledClass && c.handler === '') neverUnbound.push(c.label)
      })
    })
    check('V32 每个带条件禁用的入口都同时摘掉 handler（disabled ⇔ 解绑，16 组状态矩阵无一例外）',
      mismatch.length === 0, mismatch.slice(0, 4).join(' | '))
    check('V33 矩阵不是空转：确实出现过「既置灰又解绑」的时刻，也出现过「可点且不置灰」的时刻',
      neverUnbound.length > 0 && variants.some(v => liveControls(wxml, v, cfg).some(c => c.label === '确认本程发车' && c.tappable && !c.hasDisabledClass)),
      JSON.stringify({ unbound: Array.from(new Set(neverUnbound)) }))
  }
}

/* ================= S. A-13 ================= */
async function partSignup() {
  section('S. A-13：名额不足时的视觉权重（最强视觉 == 此刻走得通的那条）')
  const cfg = loadPage(SIGNUP_JS)
  const wxml = src(SIGNUP_WXML)
  const withState = (over) => Object.assign(
    JSON.parse(JSON.stringify(cfg.data)),
    // 走到报名表本体（denied / loading / purposeGate / 编辑模式四条分支都不成立），
    // 否则按钮根本不在这一屏上，比权重就是空转。
    { denied: '', loading: false, purposeGate: false, profileGate: false, mode: 'apply', editForm: null },
    { participants: [{ key: 'p0' }, { key: 'p1' }] },
    over || {})
  const ask = withState({ capacityAsk: true, busy: false })
  const idle = withState({ capacityAsk: false, busy: false })
  const busy = withState({ capacityAsk: true, busy: true })
  const of = data => liveControls(wxml, data, cfg).filter(c => /提交报名|正在提交|明确同意整组候补/.test(c.label))
  const askSet = of(ask)
  const waitlist = askSet.filter(c => c.label.indexOf('明确同意整组候补') !== -1)
  const submit = askSet.filter(c => c.label.indexOf('提交报名') !== -1)
  check('S0 候补询问这一刻两个入口都真的在屏上（门有输入，不是拿隐藏节点比样式）',
    waitlist.length === 1 && submit.length === 1, JSON.stringify(askSet.map(c => [c.label, c.classes])))
  check('S1 询问为真时本屏唯一那颗 primary 是「明确同意整组候补」（最强视觉给了走得通的动作）',
    waitlist.length === 1 && hasClass(waitlist[0].classes, 'primary')
    && askSet.filter(c => hasClass(c.classes, 'primary')).length === 1,
    JSON.stringify(askSet.map(c => [c.label, c.classes])))
  check('S2 「提交报名」此时降为 secondary 但仍可点（不置灰 ⇒ 名额后来空出还能直接重试正式报名）',
    submit.length === 1 && hasClass(submit[0].classes, 'secondary') && !submit[0].hasDisabledClass && submit[0].tappable,
    JSON.stringify(submit))
  check('S3 询问未发生时权重关系相反：primary 是「提交报名」，候补按钮根本不上屏（阳性对照）',
    (() => {
      const s = of(idle)
      return s.filter(c => c.label.indexOf('明确同意整组候补') !== -1).length === 0
        && s.filter(c => c.label.indexOf('提交报名') !== -1 && hasClass(c.classes, 'primary')).length === 1
    })(), JSON.stringify(of(idle).map(c => [c.label, c.classes])))
  check('S4 写命令在途两颗都点不动且都带 disabled（换权重没有漏掉一半的禁用姿态配对）',
    of(busy).length === 2 && of(busy).every(c => c.handler === '' && c.hasDisabledClass),
    JSON.stringify(of(busy).map(c => [c.label, c.handler, c.hasDisabledClass])))
  check('S5 两个 handler 都真的挂在页面配置上（绑法不变，也不绑到不存在的方法）',
    typeof cfg.onSubmit === 'function' && typeof cfg.onWaitlist === 'function'
    && of(ask).every(c => !c.missingHandler && !c.unresolved),
    JSON.stringify({ s: typeof cfg.onSubmit, w: typeof cfg.onWaitlist }))
  check('S6 询问下多一行说明现在走不通什么、什么时候还能再试（不必再点一次去发现）',
    visibleTexts(wxml, ask).some(t => t.indexOf('整组候补') !== -1 && t.indexOf('正式报名') !== -1),
    JSON.stringify(visibleTexts(wxml, ask).filter(t => t.indexOf('报名') !== -1)))
  check('S7 说明行在询问没发生时不上屏（减话类改动必须双向可证，不是一刀切常驻）',
    !visibleTexts(wxml, idle).some(t => t.indexOf('现在能确认的是整组候补') !== -1),
    JSON.stringify(visibleTexts(wxml, idle).slice(-3)))
  check('S8 既有文案一字未改（先例认可的「明确同意」式设计，改权重不许顺手改措辞）',
    visibleTexts(wxml, ask).some(t => t.indexOf('2 人将一起进入候补，不会自动占用正式名额。') !== -1)
    && visibleTexts(wxml, ask).some(t => t === '名额不足，是否整组候补？'),
    JSON.stringify(visibleTexts(wxml, ask).slice(0, 6)))
}

/* ================= A. A-02 ================= */
async function partActivity() {
  section('A. A-02：活动详情状态 callout 不重印同一句（真页面 renderView 输出）')
  const wxml = src(ACTIVITY_WXML)
  function fixture(mutate) {
    const a = {
      id: 'a1', ownerId: 'u-org', title: '青城后山 · 周末轻徒步',
      description: '当天往返。', organizerIntro: '老驴带队。',
      startAt: '2026-10-03T08:00:00+08:00', endAt: '2026-10-03T18:00:00+08:00',
      deadlineAt: '2026-10-02T08:00:00+08:00',
      phase: 'published', capacity: 20, routeId: 'r1',
      routeSnapshot: {
        title: '青城后山穿越', distanceKm: 12.5, ascentM: 860,
        points: [{ id: 'pt-1', name: '泰安古镇', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 } }],
        risks: [],
      },
      pickupPoints: [{ id: 'pk-1', name: '东门集合点', meetingAt: '2026-10-03T07:30:00+08:00', address: '快铁站出口', coordinates: { lat: 30.88, lng: 103.56 } }],
      equipment: ['登山杖'], feeNote: 'AA', cancellationNote: '',
    }
    const row = over => Object.assign({
      signupId: 's1', groupId: 'g1', name: '张三', status: 'confirmed', avatar: '',
      tripMode: 'shared', pickup: '东门集合点', pickupPointId: 'pk-1', vehicle: '1号车', seat: '01',
      checkedIn: false, outboundBoarded: false, returnBoarded: false, returnPlan: 'assigned',
      departure: 'joined', home: false, hasPassengerAssignment: true, needsSeatAssignment: false,
    }, over || {})
    const v = {
      kind: 'activity', perspective: 'participant', primarySignupId: 's1',
      permittedActions: ['signup.edit', 'signup.cancel'], activity: a, rows: [row({})],
      counters: { confirmed: 2, pending: 1, occupied: 2, waitlisted: 1, remaining: 18, unassigned: 0, unchecked: 1, pendingHome: 0, openIncidents: 0 },
      detailState: 'ready',
    }
    if (mutate) mutate(v)
    return v
  }
  async function boot(view) {
    stubWx()
    api.read = () => Promise.resolve({ view, revision: 1, now: '2026-09-29T09:00:00+08:00' })
    const page = makePage(ACTIVITY_JS)
    page.onLoad({ id: 'a1' })
    page.onShow()
    await waitFor(() => page.data.loading === false)
    check('A0·装配成功不进 denied（renderView 抛错会被 reload 的 catch 吃成 denied）',
      page.data.denied === '' && page.data.loading === false, page.data.denied)
    return page
  }
  const cases = [
    ['参与者 ready', fixture(), false],
    ['参与者 gathering', fixture(v => { v.activity.phase = 'gathering'; v.detailState = 'gathering' }), false],
    ['参与者 无任何时间锚点', fixture(v => {
      v.detailState = 'new'
      v.activity.deadlineAt = ''
      v.activity.pickupPoints = []
    }), false],
    ['组织者（有 activity.edit）', fixture(v => {
      v.perspective = 'organizer'
      v.permittedActions = ['activity.edit', 'activity.transition', 'activity.publish', 'signup.review']
    }), true],
  ]
  for (const item of cases) {
    const name = item[0]
    const view = item[1]
    const isOwner = item[2]
    const page = await boot(view)
    const calloutTexts = (() => {
      const nodes = visibleNodes(wxml, page.data)
      const box = nodes.find(n => n.tag === 'view' && hasClass(n.cls, 'callout')
        && (hasClass(n.cls, 'success') || hasClass(n.cls, 'warning') || hasClass(n.cls, 'danger')))
      if (!box) return null
      return nodes.filter(n => n.tag === 'text' && n.ancestors.some(a => a === box))
        .map(n => n.text).filter(t => t !== '')
    })()
    check('A1·' + name + '：状态 callout 真的渲染出来了（判据不空转）',
      Array.isArray(calloutTexts) && calloutTexts.length >= 2, JSON.stringify(calloutTexts))
    const body = (calloutTexts || []).map(t => t.replace(/^●\s*/, '').trim())
    check('A2·' + name + '：callout 内任意两行正文不相同（去圆点后逐行比对）',
      new Set(body).size === body.length, JSON.stringify(calloutTexts))
    if (isOwner) {
      check('A3·组织者那一格仍是工作队列原文（去重没把计数一起删掉）',
        /^待审核 \d+ 人 · 候补 \d+ 人 · 剩余 \d+ 个名额$/.test(page.data.countersLine), page.data.countersLine)
    } else {
      check('A4·非组织者该格为空：信息全部由 milestone / howLine 各印一次',
        page.data.countersLine === '', JSON.stringify({ c: page.data.countersLine, m: page.data.milestone, h: page.data.howLine }))
    }
  }
  {
    const page = await boot(fixture())
    check('A5 参与者的时间锚点仍在上屏（去重不能把信息一起去掉）',
      String(page.data.milestone || '').indexOf('集合') !== -1
      && visibleTexts(wxml, page.data).some(t => t.indexOf('● ') === 0 && t.indexOf('集合') !== -1),
      JSON.stringify({ m: page.data.milestone, t: visibleTexts(wxml, page.data).slice(0, 8) }))
    const before = page.data.howLine
    const empty = await boot(fixture(v => {
      v.detailState = 'new'
      v.activity.deadlineAt = ''
      v.activity.startAt = ''
      v.activity.pickupPoints = []
      v.rows = [{ signupId: 's1', groupId: 'g1', name: '张三', status: 'confirmed', avatar: '', tripMode: 'self', pickup: '', pickupPointId: '', vehicle: '', seat: '', checkedIn: false, outboundBoarded: false, returnBoarded: false, returnPlan: 'own', departure: 'joined', home: false }]
    }))
    check('A6 milestone 与 how 同时为空时该格也不印（旧实现会退回 how，于是 how 连印两遍）',
      empty.data.countersLine === '' && typeof before === 'string',
      JSON.stringify({ c: empty.data.countersLine, m: empty.data.milestone, h: empty.data.howLine }))
  }
}

/* ================= F. F-04 下拉刷新侧 ================= */
async function partStaff() {
  section('F. F-04 下拉刷新侧：staff 页有手势、信号逐次不同、拉头必收尾')
  const json = JSON.parse(src(STAFF_JSON))
  const cfg = loadPage(STAFF_JS)
  check('F1 staff.json 打开 enablePullDownRefresh（没有这个键就没有手势，页面上无从刷新）',
    json.enablePullDownRefresh === true, JSON.stringify(json))
  check('F2 页面配置真的有 onPullDownRefresh（注册了手势却没有钩子＝下拉永远空转）',
    typeof cfg.onPullDownRefresh === 'function', keysOf(cfg))
  stubWx()
  let reads = 0
  const staffView = () => ({
    kind: 'activity', perspective: 'staff', primarySignupId: null,
    permittedActions: ['attendance.checkin', 'attendance.departure'],
    activity: { id: 'a1', title: '青城后山 · 周末轻徒步', phase: 'gathering', routeSnapshot: { points: [{ id: 'pt-1', name: '泰安古镇' }] }, pickupPoints: [] },
    rows: [{
      signupId: 's1', groupId: 'g1', name: '张三', status: 'confirmed', avatar: '',
      tripMode: 'shared', pickup: '东门集合点', vehicle: '1号车', seat: '01',
      checkedIn: false, outboundBoarded: false, returnBoarded: false,
      returnPlan: 'assigned', departure: 'unknown', home: false,
    }],
    counters: { confirmed: 1, pending: 0, occupied: 1, waitlisted: 0, remaining: 0, unassigned: 0, unchecked: 1, pendingHome: 0, openIncidents: 0 },
    incidents: [], positions: [],
  })
  api.read = () => {
    reads++
    return Promise.resolve({ view: staffView(), revision: reads, now: NOW_ISO })
  }
  const panel = makeInstance(loadComponent(FIELD_PANEL_JS))
  panel.data = Object.assign({}, panel.data, { activityId: 'a1', perspective: 'staff', syncKey: '' })
  panel._readKey = ''
  panel.lifetimes.attached.call(panel)
  await sleep(20)
  const page = makeInstance(cfg)
  page.onLoad({ id: 'a1' })
  const deliver = key => {
    if (panel.data.syncKey === key) return false
    panel.data.syncKey = key
    panel.observers.syncKey.call(panel, key)
    return true
  }
  check('F0 探针自证：真 field-panel 在成功视图下确实会读（后面几条的「重读一次」不是空判）',
    reads === 1 && panel.data.denied === '' && panel.data.rows.length === 1,
    JSON.stringify({ reads, denied: panel.data.denied }))
  check('F3 首屏只读一次：onShow 第一次不 bump（那一次读已由 attached 发出，重复下发＝多打一次全量读）',
    reads === 1 && page.data.syncKey === '', JSON.stringify({ reads, k: page.data.syncKey }))
  page.onShow()
  page.onShow()
  const k1 = page.data.syncKey
  const d1 = deliver(k1)
  await sleep(20)
  check('F4 返回本页：syncKey 送达且真 field-panel 恰好重读一次（不是只改了页面自己的 data）',
    d1 && k1 !== '' && reads === 2, JSON.stringify({ reads, k1 }))
  page.onShow()
  const k2 = page.data.syncKey
  const d2 = deliver(k2)
  await sleep(20)
  check('F5 第二次返回仍送达（恒定 key 的退化会在这一刻被「恰好重读一次」当场判红）',
    d2 && k2 !== k1 && reads === 3, JSON.stringify({ reads, k1, k2 }))
  const fixed = 1760000000000
  const realNow = Date.now
  Date.now = () => fixed
  page.onPullDownRefresh()
  const p1 = page.data.syncKey
  page.onPullDownRefresh()
  const p2 = page.data.syncKey
  Date.now = realNow
  check('F6 假钟钉死在同一毫秒连下拉，两次失效信号仍互不相同（撞键＝那次刷新静默不发生）',
    p1 !== p2 && p2 !== '' && p1 !== k2, JSON.stringify({ p1, p2, k2 }))
  const before = reads
  deliver(p2)
  await sleep(20)
  check('F7 下拉确实驱动真面板重读（送达一次＝读一次）',
    reads === before + 1, JSON.stringify({ before, reads }))
  check('F8 手势一定有回执：两次下拉都 stopPullDownRefresh（把收尾押在可能不存在的 promise 上＝拉头常驻）',
    wxRec.stops === 2, 'stops=' + wxRec.stops)
  check('F9 下拉与 onShow 同走一条失效通道，页面没有越过组件去直接调 panel.reload()（不双读）',
    reads === before + 1 && typeof panel.reload === 'function', JSON.stringify({ reads, before }))
  check('F10 staff.wxml 仍是零事件绑定薄壳（刷新走生命周期，不新增 handler 面）',
    src(STAFF_WXML).indexOf('bind') === -1 && src(STAFF_WXML).indexOf('catch') === -1,
    src(STAFF_WXML).slice(0, 40))
}

/* ================= 主流程 ================= */
async function main() {
  await guarded('V', partVehicle)
  await guarded('S', partSignup)
  await guarded('A', partActivity)
  await guarded('F', partStaff)
  section('Z. 有效性门')
  check('Z1 全轮没有把执行撞停：无未捕获异常 / 无未处理拒绝', harnessErrors.length === 0, harnessErrors.join(' ｜ '))
  check('Z2 读数数量达到最低门槛（少于 40 说明某个整段没跑起来）', passed + failed >= 45, '读数=' + (passed + failed))
  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed > 0 ? 1 : 0)
}
main()
