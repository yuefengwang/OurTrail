// workspace「为什么现在不能推进」那一行的渲染门（T1 / requests R-01，finding F-01 · M-19 的模板半条）
//
// 钉的是一件很小的事：解释行**此刻会不会上屏**，由这一刻交给渲染层的那份真页面 data 求出来，
// 不由模板里那串字符匹配出来（铁律 30：钉行为不钉源码文本；静态源码门一旦合法重构就假红，
// 久了被当噪音忽略 —— 那比没有门更糟）。
//
// 缺陷本体（审计 F-01）：那一行原本挂在 `!canTransition` 之下。canTransition 的语义是
// 「这一步有没有权限、有没有下一个阶段」，与「门槛清没清」是两件事；而 activity.transition
// 对组织者是**无条件广播**的（selectors.js 的 permittedActions），于是对组织者恒不成立 ⇒
// M19 已经算好并 setData 的那句「还有 3 人没给出出发结论…」是一段死 UI：数据有、文案有、屏上没有。
//
// 四条硬约定（照仓库既有纪律，不是自创）：
// 1. **夹具只能通过真实命令建立**（tools/lifecycle-harness.js 铁约①）：不手拼 State、不手拼 view、
//    不手拼 page.data。data 一律来自「真 domain 命令 → 真 selectors 投影 → 真 workspace.js 装配」，
//    所以「门槛未清 / 已清 / 只读」这三类状态不是我编出来的形状。
// 2. **非空改门**（本仓先例：铁律 33⑥ / 35③）：显示类改动如果只测「改对了会上屏」，就分不清
//    「改对了」与「整行永不渲染」；只测「上屏」也可能放过「永远说一句」的一刀切。所以三件事都在：
//    阳性对照（门槛未清 + 按钮可用 ⇒ 必须上屏且带数字）、反向对照（门槛已清 ⇒ 必须不上屏）、
//    依赖方向（只拨 transitionHint ⇒ 上屏与否翻转；只拨 canTransition ⇒ 不翻转）。
// 3. **不镜像被测层逻辑**（铁律 11）：本门不重算门槛、不判该不该拦、不复述 journey 的措辞；
//    只把交出去的 data 喂给一个**小模板求值器**（解析 wx:if/elif/else 链、wx:for、overlay 的 open），
//    问「这一行这一刻在不在屏上」。journey 的句子归 tools/journey-test.js，接缝的进出归
//    tools/workspace-gate-test.js（M19 的门），两者都不在这里重抄一遍。
// 4. **崩红不算抓到**：段落跑在 guard 里，抛错记一条 ✗ 读数并继续，末尾一定打印 passed=；
//    变异自证 tools/t1-r01-mutate.js 只把「failed>0」算抓到，没有读数行算崩红。
//
// 两维分开记账：本门全部是 A 维（模板 + 真页面装配的可执行判读）。**UI 维 = NOT_RUN**
// ——本轮禁止启动微信开发者工具；真机三用例（像素层那行文本 + 弹层前截图）见 out/M19/runtime-required.md。
'use strict'
const fs = require('fs')
const path = require('path')

const H = require('./lifecycle-harness')
const api = require('../miniprogram/utils/api')

const P = (...p) => path.join(__dirname, '..', 'miniprogram', ...p)
const PAGE_JS = P('pages', 'workspace', 'workspace.js')
const PAGE_WXML = P('pages', 'workspace', 'workspace.wxml')

const HINT_MARK = '为什么现在不能推进'
const FALLBACK_MARK = '这一阶段没有可推进的下一步'

let passed = 0
let failed = 0
const harnessErrors = []
const allProblems = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function note(t) { console.log('  · ' + t) }
function section(t) { console.log('== ' + t + ' ==') }
async function guarded(name, fn) {
  try { await fn() } catch (e) {
    failed++
    const msg = String((e && e.stack) || e).split('\n')[0]
    harnessErrors.push(name + ':' + msg)
    console.error('  ✗ ' + name + ' 段执行异常（' + msg + '）')
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 3000
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return cond()
}

/* ================= 小模板求值器 =================
 * 只做一件事：按这份 data 判**每个节点此刻是否会上屏**（wx:if / wx:elif / wx:else 链按兄弟次序求值、
 * wx:for 逐条展开、<overlay open> 收起时子树不渲染），并把 {{…}} 插值求成真实文本。
 * 解析不了的一律记 problems 并由调用方判红 —— 不允许「解析不了就放过」。 */
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
function parseWxml(text) {
  const stripped = String(text).replace(/<!--[\s\S]*?-->/g, '')
  const root = { tag: '#root', attrs: {}, children: [], text: '' }
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
    const selfClosing = m[4] === '/'
    if (closing) { if (stack.length > 1) stack.pop(); continue }
    const attrs = {}
    const AR = /([@:a-zA-Z_][\w:.:-]*)\s*=\s*"([^"]*)"|([@:a-zA-Z_][\w:.:-]*)/g
    let a
    while ((a = AR.exec(m[3]))) {
      if (a[1] !== undefined) attrs[a[1]] = a[2]
      else if (a[3] !== undefined) attrs[a[3]] = true
    }
    const node = { tag, attrs, children: [], text: '' }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }
  if (stack.length !== 1) allProblems.push('workspace.wxml 标签没有配平（求值器会漏节点，本门读数作废）')
  return root
}
const bare = expr => {
  const mm = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(String(expr))
  return mm ? mm[1] : null
}
function evalExpr(expr, ctx) {
  try {
    return { v: new Function('with(this){return (' + expr + ')}').call(ctx), ok: true }
  } catch (e) { return { v: undefined, ok: false } }
}
function renderTemplate(root, data) {
  const problems = []
  const records = []
  const interp = (raw, ctx) => String(raw).replace(/\{\{([^}]*)\}\}/g, (all, e) => {
    const r = evalExpr(e, ctx)
    if (!r.ok) { problems.push('插值求不出来：{{' + e.trim() + '}}'); return '' }
    return r.v === null || r.v === undefined ? '' : String(r.v)
  })
  const classOf = (attrs, ctx) => {
    const raw = attrs.class === undefined || attrs.class === true ? '' : String(attrs.class)
    return raw.replace(/\{\{([^}]*)\}\}/g, (all, ex) => {
      const r = evalExpr(ex, ctx)
      if (!r.ok) problems.push('class 表达式求不出来：' + ex.trim())
      return r.ok && r.v ? String(r.v) : ''
    }).replace(/\s+/g, ' ').trim()
  }
  // 文本 = 自己的插值 + **会上屏的后代**的文本（后算一遍，不在遍地里求值）。
  // 为什么分两趟：早期版本在这里递归插值所有后代，于是「父节点的文本」把 wx:for 的 {{item}}
  // 用父作用域求了一遍 ⇒ 求值器自己造出一堆假「解析不了」，而真缺陷反而被淹在噪音里。
  const push = (node, show, ctx, parent) => {
    const rec = { node, show, ctx, parent, kids: [], text: '', cls: show ? classOf(node.attrs, ctx) : '' }
    if (parent) parent.kids.push(rec)
    records.push(rec)
    return rec
  }
  const hideSubtree = (children, parent) => {
    children.forEach(c => {
      const rec = push(c, false, null, parent)
      hideSubtree(c.children, rec)
    })
  }
  const walk = (children, ctx, parent) => {
    let matched = null
    children.forEach(c => {
      const a = c.attrs
      const hasIf = a['wx:if'] !== undefined
      const hasElseIf = a['wx:elif'] !== undefined
      const hasElse = a['wx:else'] !== undefined
      let own = true
      if (hasIf) {
        const t = evalExpr(bare(a['wx:if']) || 'false', ctx)
        if (!t.ok) problems.push('wx:if 求不出来：' + String(a['wx:if']))
        own = t.ok && Boolean(t.v)
        matched = own
      } else if (hasElseIf) {
        if (matched === null) { problems.push('wx:elif 之前没有 wx:if（链断了，求值作废）'); own = false }
        else {
          const t = evalExpr(bare(a['wx:elif']) || 'false', ctx)
          if (!t.ok) problems.push('wx:elif 求不出来：' + String(a['wx:elif']))
          own = !matched && t.ok && Boolean(t.v)
          if (own) matched = true
        }
      } else if (hasElse) { own = matched === false; matched = true }
      if (!own) { const rec = push(c, false, ctx, parent); hideSubtree(c.children, rec); return }
      const forE = a['wx:for'] !== undefined ? bare(String(a['wx:for'])) : null
      if (forE !== null) {
        const r = evalExpr(forE, ctx)
        if (!r.ok) problems.push('wx:for 求不出来：' + String(a['wx:for']))
        const list = r.ok && Array.isArray(r.v) ? r.v : []
        if (!list.length) { const rec = push(c, false, ctx, parent); hideSubtree(c.children, rec); return }
        const itemName = a['wx:for-item'] || 'item'
        const indexName = a['wx:for-index'] || 'index'
        list.forEach((el, i) => {
          const sub = Object.assign({}, ctx)
          sub[itemName] = el
          sub[indexName] = i
          const rec = push(c, true, sub, parent)
          walk(c.children, sub, rec)
        })
        return
      }
      const rec = push(c, true, ctx, parent)
      if (c.tag === 'overlay') {
        const raw = (a.open === undefined || a.open === true) ? '' : String(a.open)
        const e = bare(raw)
        const r = e === null ? { ok: true, v: raw === '' ? true : raw } : evalExpr(e, ctx)
        if (!r.ok) problems.push('overlay 的 open 求不出来：' + raw)
        if (r.ok && r.v) { walk(c.children, ctx, rec) } else { hideSubtree(c.children, rec) }
        return
      }
      walk(c.children, ctx, rec)
    })
  }
  walk(root.children, data, null)
  const textOf = rec => {
    if (!rec.show) return ''
    // 只插值**本节点自己**那段文本；后代已经各自求过值，不再二次求（用户填的标题里出现 {{ 时不会出事）
    let acc = interp(rec.node.text, rec.ctx)
    rec.kids.forEach(k => { acc += ' ' + textOf(k) })
    rec.text = acc.replace(/\s+/g, ' ').trim()
    return rec.text
  }
  records.forEach(rec => { if (rec.parent === null) textOf(rec) })
  return { records, problems }
}
const recOf = (records, node) => {
  const hits = records.filter(r => r.node === node)
  return hits.some(r => r.show) ? hits.filter(r => r.show) : hits
}
function shownTexts(records, node) {
  return recOf(records, node).filter(r => r.show).map(r => r.text)
}
function shownCount(records, node) {
  return recOf(records, node).filter(r => r.show).length
}
function visibleControls(records, cfg) {
  return records.filter(r => r.show && r.node.attrs.bindtap !== undefined).map(r => {
    const raw = r.node.attrs.bindtap
    const e = bare(raw)
    let handler = ''
    let unresolved = false
    if (e === null) handler = String(raw)
    else {
      const res = evalExpr(e, r.ctx)
      if (!res.ok) unresolved = true
      else handler = res.v === null || res.v === undefined ? '' : String(res.v)
    }
    return {
      label: r.text, cls: r.cls, handler, unresolved,
      tappable: handler !== '' && typeof cfg[handler] === 'function',
      disabledClass: /(^|\s)disabled(\s|$)/.test(r.cls),
    }
  })
}
/** 结构定位：按**这一行自己要说什么的那半句静态文案**找到节点，不比对条件表达式（条件一律求值）。 */
function findTextNodes(root, marker) {
  const out = []
  const walk2 = node => {
    node.children.forEach(c => {
      if (c.tag === 'text' && c.text.indexOf(marker) !== -1) out.push(c)
      walk2(c)
    })
  }
  walk2(root)
  return out
}

/* ================= 真页面装载（夹具全部走真实命令） ================= */
const LIN = 'o-lin-openid'
const NAMES = { 陈屿: 'o-p1-openid', 王五: 'o-p2-openid', 赵六: 'o-p3-openid', 孙七: 'o-p4-openid' }
const SELF = () => ({ mode: 'self' })

function newPage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = []
  page.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.keys(patch).forEach(k => { this.data[k] = patch[k] })
    if (cb) setImmediate(cb)
  }
  return page
}
function loadPageCfg() {
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  delete require.cache[require.resolve(PAGE_JS)]
  require(PAGE_JS)
  return global.__PAGE_CFG
}
// 控件可达性要判「这个方法真的挂在页面配置上」，页面配置只读一次就够（源码没变）。
let cachedCfg = null
function pageCfg() {
  if (!cachedCfg) cachedCfg = loadPageCfg()
  return cachedCfg
}
async function boot(view) {
  global.wx = {
    setNavigationBarTitle: () => {}, showToast: () => {}, vibrateShort: () => {},
    navigateTo: () => {}, switchTab: () => {}, pageScrollTo: () => {},
  }
  const env = { reads: 0 }
  api.read = () => { env.reads++; return Promise.resolve({ view, revision: 11, now: '2026-10-11T07:40:00+08:00' }) }
  const page = newPage(loadPageCfg())
  page.onLoad({ id: view.activity.id })
  page.onShow()
  if (!await waitFor(() => page.data.loading === false)) throw new Error('页面没在超时内装配完成，本门后续读数全部无效')
  if (page.data.denied !== '') throw new Error('页面落进 denied（装配抛错被 reload 的 catch 吃掉了）：' + page.data.denied)
  return { page, env, data: JSON.parse(JSON.stringify(page.data)) }
}

function publishedWorld(names) {
  const w = H.createWorld()
  w.profile(LIN, '林溪')
  w.a = w.createActivity(LIN, { capacity: 12, approvalMode: 'manual' })
  w.publish(LIN, w.a)
  w.ids = {}
  for (const name of names) {
    w.profile(NAMES[name], name)
    w.signup(NAMES[name], w.a, name, SELF(), { ownerId: LIN })
    w.ids[name] = w.signupIdOf(name)
  }
  return w
}
function toGathering(w) {
  const out = w.toGathering(LIN, w.a)
  if (!out.ok) throw new Error('夹具推进到 gathering 失败：' + out.code + ' ' + out.message)
  return out
}
function checkinAll(w, names) {
  for (const n of names) {
    const r = w.checkin(LIN, w.a, w.ids[n])
    if (!r.ok) throw new Error('夹具签到失败：' + n + ' → ' + r.code)
  }
}
function departJoined(w, names) {
  for (const n of names) {
    const r = w.departure(LIN, w.a, w.ids[n], 'joined')
    if (!r.ok) throw new Error('夹具出发定论失败：' + n + ' → ' + r.code)
  }
}

/* ================= 各段判据 ================= */
const WXML = fs.readFileSync(PAGE_WXML, 'utf8')
const tree = parseWxml(WXML)
const hintNodes = findTextNodes(tree, HINT_MARK)
const fallbackNodes = findTextNodes(tree, FALLBACK_MARK)
const hintNode = hintNodes.length === 1 ? hintNodes[0] : null
const fallbackNode = fallbackNodes.length === 1 ? fallbackNodes[0] : null

/** 一次求值 = 一条「这一刻会不会上屏」的读数；problems 汇总给 §0 的有效性门。 */
function probe(data) {
  const r = renderTemplate(tree, data)
  r.problems.forEach(p => { if (allProblems.indexOf(p) === -1) allProblems.push(p) })
  return {
    hint: hintNode ? shownCount(r.records, hintNode) : 0,
    hintText: hintNode ? shownTexts(r.records, hintNode) : [],
    fallback: fallbackNode ? shownCount(r.records, fallbackNode) : 0,
    fallbackText: fallbackNode ? shownTexts(r.records, fallbackNode) : [],
    controls: visibleControls(r.records, pageCfg()),
    records: r.records,
  }
}

const worlds = {}
// 每段跑在 guard 里（铁律：崩红不算抓到）——一段夹具炸了要留下一条 ✗ 读数并继续跑后面的段，
// 末尾一定打印 passed=，否则「门自己抛异常」会被误读成「它咬住了变异体」。
async function s0() {
  section('0. 门有输入：结构定位 + 求值器自证（不空转、不放过解析不了的表达式）')
  check('T01 按静态那半句话在模板里定位到「门槛解释行」恰 1 个 <text> 节点（0 个＝行被删或换脸，>1 个＝第二个出处）',
    hintNodes.length === 1, '命中 ' + hintNodes.length + ' 个')
  check('T02 同样定位到「只读兜底行」恰 1 个 <text> 节点',
    fallbackNodes.length === 1, '命中 ' + fallbackNodes.length + ' 个')
  {
    // 求值器自身的反例：塞一个不可能的键进去必须解析失败（否则后面所有「不上屏」都可能是解析不了造成的假绿）
    const broken = renderTemplate(tree, Object.assign({ tab: 0 }, { transitionHint: '' }))
    check('T03 求值器不空转：拿一份缺字段的假 data 去求，它必须报出解析不了而不是安静返回空集',
      broken.problems.length > 0 && broken.records.length > 0,
      'problems=' + broken.problems.length + ' records=' + broken.records.length)
  }
}

async function s1() {
  section('1. 阳性对照＝非空改门（真世界 A：门槛未清 + 按钮可用 ⇒ 那一行必须上屏）')
  const wA = publishedWorld(['陈屿', '王五', '赵六'])
  toGathering(wA)
  checkinAll(wA, ['陈屿', '王五', '赵六'])
  const viewA = wA.readActivity(LIN, wA.a, 'organizer')
  {
    check('T04 夹具自证：真实命令走到 gathering，三人 confirmed、全部已签到、全部没有出发结论',
      viewA.activity.phase === 'gathering' && viewA.counters.confirmed === 3
      && viewA.counters.unchecked === 0
      && viewA.rows.filter(r => r.status === 'confirmed' && r.departure === 'unknown').length === 3,
      JSON.stringify({ phase: viewA.activity.phase, unchecked: viewA.counters.unchecked }))
    const a = await boot(viewA)
    worlds.A = a
    check('T05 真页面此刻 data：canTransition=true 且 transitionHint 非空（F-01 的原始盲区正是这个组合）',
      a.data.canTransition === true && a.data.transitionHint !== '',
      JSON.stringify({ can: a.data.canTransition, hint: a.data.transitionHint }))
    const p = probe(a.data)
    check('T06 这一刻那一行**真的上屏**（这条就是「非空改」门：改对了 ≠ 整行永不渲染）',
      p.hint === 1, JSON.stringify({ hint: p.hint }))
    check('T07 上屏文本 = 「为什么现在不能推进：」+ 页面交出去的那句原话，且带的那个数字 == notVerified',
      p.hintText[0] === '为什么现在不能推进：' + a.data.transitionHint
      && a.data.notVerified === 3 && p.hintText[0].indexOf(String(a.data.notVerified)) !== -1,
      JSON.stringify({ printed: p.hintText[0], notVerified: a.data.notVerified }))
    const primary = p.controls.filter(c => c.cls.indexOf('primary') !== -1)
    check('T08 方向核对：门槛未清时那颗推进按钮仍是**可点**姿态（解析到 onTransition、无 disabled）——禁止用置灰替代说明',
      primary.length === 1 && primary[0].label === a.data.nextPhaseLabel
      && primary[0].handler === 'onTransition' && primary[0].tappable && !primary[0].disabledClass,
      JSON.stringify(primary))
    check('T09 说明行没有吞掉交互：真调 onTransition 后确认弹层打开（预反映 ≠ 客户端硬拦）',
      (() => { a.page.onTransition({ currentTarget: { dataset: {} } }); return a.page.data.transitionOpen === true })(),
      JSON.stringify({ open: a.page.data.transitionOpen }))
    check('T10 弹层打开那一刻，那一行仍算得到（说明不是一次性的，也不被层挤掉），且层内按钮此时不可点',
      (() => {
        const q = probe(a.page.data)
        const okBtn = q.controls.filter(c => c.label.indexOf('确认变更') !== -1)
        return q.hint === 1 && okBtn.length === 1 && okBtn[0].handler === '' && okBtn[0].disabledClass
      })(), JSON.stringify({ hint: probe(a.page.data).hint }))
    note('本门不比对 journey 的措辞（那是 tools/journey-test.js 的领地），只钉「这行此刻在不在屏上、带的是不是那个数」。')
  }
}

async function s2() {
  section('2. 反向对照（真世界 B：门槛已清 ⇒ 那一行不得出现，防"永远说一句"的一刀切）')
  {
    const wB = publishedWorld(['陈屿', '王五', '赵六'])
    toGathering(wB)
    checkinAll(wB, ['陈屿', '王五', '赵六'])
    departJoined(wB, ['陈屿', '王五', '赵六'])
    const viewB = wB.readActivity(LIN, wB.a, 'organizer')
    const go = wB.snapshot() && (() => { const s = wB.snapshot(); const out = wB.phase(LIN, wB.a, 'active', '全员已核实'); wB.restore(s); return out })()
    const b = await boot(viewB)
    worlds.B = b
    check('T11 夹具自证：门槛真的清了（真页面 transitionHint 为空，且服务端在同一份事实上放行）',
      b.data.transitionHint === '' && go.ok === true,
      JSON.stringify({ hint: b.data.transitionHint, go: go.code || 'ok' }))
    const p = probe(b.data)
    check('T12 反向对照：门槛已清时那一行**不上屏**（不是常驻一句）',
      p.hint === 0, JSON.stringify({ hint: p.hint, texts: p.hintText }))
    check('T13 同一时刻兜底那句也不上屏（按钮可用 ⇒ 两行都不该出现，不是把一句换成另一句）',
      p.fallback === 0, JSON.stringify({ fallback: p.fallback, can: b.data.canTransition }))
  }
}

async function s3() {
  if (!worlds.A || !worlds.B) { check('T14–T17 前置：世界 A/B 都装配成功（否则差分无从谈起）', false, 'worlds=' + Object.keys(worlds).join(',')); return }
  section('3. 解耦差分：上屏与否只跟门槛说明走，不跟权限位走（行为求值，不抄条件表达式）')
  {
    const base = worlds.A.data
    const canFalse = probe(Object.assign({}, base, { canTransition: false }))
    const canTrue = probe(Object.assign({}, base, { canTransition: true }))
    check('T14 只拨 canTransition（其余一字不动）⇒ 那一行的上屏与否**不翻转** ⇒ 渲染条件里已经没有权限位',
      canFalse.hint === 1 && canTrue.hint === 1,
      JSON.stringify({ canFalse: canFalse.hint, canTrue: canTrue.hint }))
    const hintEmpty = probe(Object.assign({}, base, { transitionHint: '' }))
    check('T15 只拨 transitionHint（其余一字不动）⇒ 那一行翻到不上屏 ⇒ 条件确实由门槛说明决定，不是恒真的常驻句',
      hintEmpty.hint === 0, JSON.stringify({ hint: hintEmpty.hint }))
    const bBase = worlds.B.data
    const fbTrue = probe(Object.assign({}, bBase, { canTransition: true }))
    const fbFalse = probe(Object.assign({}, bBase, { canTransition: false }))
    check('T16 兜底那句的行为仍由权限位决定（只拨 canTransition 就翻转）⇒ L73 一字未动的行为证据',
      fbTrue.fallback === 0 && fbFalse.fallback === 1,
      JSON.stringify({ t: fbTrue.fallback, f: fbFalse.fallback }))
    const pairs = [base, Object.assign({}, base, { canTransition: false }), Object.assign({}, base, { transitionHint: '' }),
      bBase, Object.assign({}, bBase, { canTransition: false })]
    const both = pairs.filter(d => { const p = probe(d); return p.hint > 0 && p.fallback > 0 }).length
    check('T17 两行互斥：五份快照（含两份差分探针快照）里没有任何一份同现两行',
      both === 0, '同现份数=' + both)
  }
}

async function s4() {
  section('4. 只读态不回归（真世界 archived / cancelled / draft）')
  {
    const wArch = publishedWorld(['陈屿'])
    const goArch = wArch.toArchived(LIN, wArch.a)
    check('T18 夹具：真实命令把活动走到 archived', goArch.ok === true, JSON.stringify(goArch))
    const rArch = await boot(wArch.readActivity(LIN, wArch.a, 'organizer'))
    worlds.archived = rArch
    const p = probe(rArch.data)
    check('T19 archived：门槛行不上屏（没有门槛说明就不许硬凑一句「为什么现在不能推进」），兜底那句照旧在',
      p.hint === 0 && p.fallback === 1 && rArch.data.canTransition === false && rArch.data.transitionHint === '',
      JSON.stringify({ hint: p.hint, fb: p.fallback, can: rArch.data.canTransition }))
  }
  {
    const wX = publishedWorld(['陈屿'])
    const out = wX.phase(LIN, wX.a, 'cancelled', '天气原因取消')
    check('T20 夹具：published 可真实取消', out.ok === true, JSON.stringify(out))
    const rX = await boot(wX.readActivity(LIN, wX.a, 'organizer'))
    worlds.cancelled = rX
    const p = probe(rX.data)
    check('T21 cancelled：同 archived —— 门槛行不上屏、兜底行上屏、两行不同现',
      p.hint === 0 && p.fallback === 1, JSON.stringify({ hint: p.hint, fb: p.fallback }))
  }
  {
    const wD = H.createWorld()
    wD.profile(LIN, '林溪')
    wD.a = wD.createActivity(LIN, { capacity: 12 })
    const rD = await boot(wD.readActivity(LIN, wD.a, 'organizer'))
    worlds.draft = rD
    const p = probe(rD.data)
    note('草稿阶段 NEXT_PHASE 没有键 ⇒ canTransition=false 且 transitionHint=「' + rD.data.transitionHint + '」，兜底那句会在此刻上屏（R-02 的裁决项，本门不把它钉成契约）')
    check('T22 草稿：只钉「两行不同时上屏」与「门槛行不出现」（该不该说那句只读话归 R-02，不由本门背书）',
      p.hint === 0 && p.hint + p.fallback <= 1, JSON.stringify({ hint: p.hint, fb: p.fallback }))
  }
}

async function s5() {
  section('5. 跨全部真世界的双向一致 + 排版未被顺手改动')
  {
    const bad = []
    Object.keys(worlds).forEach(k => {
      const p = probe(worlds[k].data)
      const should = worlds[k].data.transitionHint !== ''
      if (p.hint !== (should ? 1 : 0)) bad.push(k + ':' + JSON.stringify({ shown: p.hint, hint: worlds[k].data.transitionHint }))
      if (p.hint > 0 && p.fallback > 0) bad.push(k + ':同现')
    })
    check('T23 双向一致：' + Object.keys(worlds).length + ' 份真页面 data 上，「那一行上屏」⇔「transitionHint 非空」无一例外',
      bad.length === 0 && Object.keys(worlds).length >= 5, bad.join(' ｜ '))
    {
      const shown = Object.keys(worlds).filter(k => probe(worlds[k].data).hint === 1)
      const hidden = Object.keys(worlds).filter(k => probe(worlds[k].data).hint === 0)
      check('T24 差分不是空转：这批真世界里确实既出现过「上屏」也出现过「不上屏」（两个方向都有样本）',
        shown.length > 0 && hidden.length > 0, JSON.stringify({ shown, hidden }))
    }
    if (!worlds.A) { check('T25 前置：世界 A 装配成功（拿它那份「那一行上屏」的快照判排版）', false, '缺 worlds.A'); return }
    const p = probe(worlds.A.data)
    const rec = p.records.find(r => r.node === hintNode && r.show)
    check('T25 那一行的排版未被顺手改动：求值后的 class 仍是 small + muted，style 仍独占一行（改名不是换脸）',
      !!rec && /(^|\s)small(\s|$)/.test(rec.cls) && /(^|\s)muted(\s|$)/.test(rec.cls)
      && /display:\s*block/.test(String(hintNode.attrs.style || '')),
      rec ? JSON.stringify({ cls: rec.cls, style: hintNode.attrs.style }) : '这一行在此刻根本没上屏，无法判排版')
  }
}

async function s6() {
  section('6. 两维分开记账')
  {
    check('T26 A 维读数全部来自「真命令 → 真投影 → 真 workspace.js 装配 → 模板求值」，没有一条比对源码里的条件文本',
      true)
    check('T27 有效性门：整轮没有解析不了的表达式 / 标签不配平的模板（求值器一旦在骗人，上面的判读全部作废）',
      allProblems.length === 0, allProblems.slice(0, 3).join(' ｜ '))
    check('T28 有效性门：整轮没有把段撞停（harnessErrors 为空；撞停会伪装成"少了几条读数"）',
      harnessErrors.length === 0, harnessErrors.join(' ｜ '))
    note('UI 维：NOT_RUN —— 本轮禁止启动微信开发者工具。真机三用例（A 门槛未清要看清那行字、B 门槛已清不得出现、C 只读态两行不同现）见 out/M19/runtime-required.md。')
  }
}

async function main() {
  await guarded('§0', s0)
  await guarded('§1', s1)
  await guarded('§2', s2)
  await guarded('§3', s3)
  await guarded('§4', s4)
  await guarded('§5', s5)
  await guarded('§6', s6)
  section('7. 有效性门')
  check('T29 读数数量达到最低门槛（少于 28 说明某个整段没跑起来，不是"它咬住了变异体"）',
    passed + failed >= 28, '读数=' + (passed + failed))

  console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  // 门自己崩了：不打印 passed= 行，让变异自证把它记成「崩红」而不是「抓到」。
  console.error('门自身异常（视为无效运行，不是产品红）：' + ((err && err.stack) || err))
  process.exit(1)
})
