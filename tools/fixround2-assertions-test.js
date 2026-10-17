// Wave 2 修复轮（FLASH 批次）的行为门：node tools/fixround2-assertions-test.js
// 覆盖 C-04 / M-13 / C-01 / C-02 / F-04 / D-01 / M-01 七条照抄型修复。
//
// 第二轮（G1-gate）按 V2 判别力审计（fix-round2/out/V2/report.md）补掉 7 条真回退漏网、消掉 2 条源码文本假红：
//   V7/V8  配对门不再按「class 里有没有 disabled 字样」「表达式带不带点/下标」预筛控件——预筛就是自挖的洞
//          （删掉禁用表达 ⇒ 控件对门隐形；换成带点的表达式 ⇒ 整类被豁免）。现在扫全部 class+bindtap 控件
//          逐个求值，解析不了的记红不豁免；求值器的数据形状直接取真组件自己的 data（嵌套对象本来就有）。
//          另加 C-01b「写命令在途（真 busy 快照）时，屏幕上可达且会发写命令的入口必须点不动且带禁用表达」，
//          在途态与空闲态都取真组件实例的 data，谁发命令靠真调 handler 观察，不抄变量名清单。
//   V2/V6  「文案在场」不再算出口。把出口节点自身的 wx:if/wx:elif/wx:else、祖先条件、
//          所在 <overlay> 的 open 一起，按「失败/询问那一刻组件的真实 data」求渲染。
//   V4     宿主→子组件按真语义驱动（属性值不变就不通知观察者），并要求逐次 bump 的 key 互不相同；
//          恒定 key 的退化会在第二次返回时被「送达 + 恰好重读一次」当场判红。
//   V5     桩每次返回不同标题，断言页面 data 与「那一刻会渲染的文本」都跟着换成本次那份新值。
//   V11    busyStale 自愈补了两条真判据（超时⇒复位 / 未超时⇒不复位 + 复位后照常读取）。
//   V10/V16 删掉两处源码文本门：overlay 用「open 随数据由假变真」求值识别（写法不限，!!x 与 x 等价）；
//          .page.has-sticky 改成级联终值判据（追加合法声明不红；删掉、写成 0、或小到放不下底栏才红）。
//
// 写法约束（本仓已有铁律，不是自创）：
// · 铁律 30：门钉行为，不钉源码文本。
// · 铁律 21：元素数量不是证据——数的是「同一份数据下两个属性是否同真同假」「这份数据下这条插值会不会上屏」。
// · 铁律 11：不镜像被测层逻辑。复位走真 api 桩的 promise；中间态走真组件 data；重读走真 field-panel 的
//          syncKey 观察者；「谁发了命令」靠真调 handler 观察记录，不用正则扫方法体。
// · 崩红不等于抓到：每个段落都在 guard 里跑，缺失的生命周期钩子先判存在再调用，探针里的 handler 异常
//          被记成一条 ✗ 读数而不是中止整轮（后面的段落仍要有读数）。
'use strict'
const fs = require('fs')
const path = require('path')

const api = require('../miniprogram/utils/api')

const P = (...p) => path.join(__dirname, '..', 'miniprogram', ...p)
const ROSTER_JS = P('components', 'roster-panel', 'roster-panel.js')
const ROSTER_WXML = P('components', 'roster-panel', 'roster-panel.wxml')
const FIELD_JS = P('components', 'field-panel', 'field-panel.js')
const STAFF_JS = P('pages', 'staff', 'staff.js')
const STAFF_WXML = P('pages', 'staff', 'staff.wxml')
const ROUTE_JS = P('pages', 'route', 'route.js')
const ROUTE_WXML = P('pages', 'route', 'route.wxml')
const ROUTE_EDIT_WXML = P('pages', 'route-edit', 'route-edit.wxml')
const APP_WXSS = P('app.wxss')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }
// 崩红鉴别（本轮口径）：一次抛错不该把整轮撞停——撞停＝后面的段落没有读数，
// 那种「红」不能算判别力。所以抛错被记成一条 ✗ 读数，后面的段落照常跑。
const harnessErrors = []
process.on('uncaughtException', e => { harnessErrors.push('未捕获异常：' + String(((e && e.stack) || e)).split('\n')[0]) })
process.on('unhandledRejection', e => { harnessErrors.push('未处理拒绝：' + String(((e && e.message) || e)).split('\n')[0]) })
const src = p => fs.readFileSync(p, 'utf8')
const sleep = ms => new Promise(r => setTimeout(r, ms))
function deferred() {
  const d = {}
  d.promise = new Promise((res, rej) => { d.resolve = res; d.reject = rej })
  return d
}

// ============ 渲染模型（只回答「这份数据下这条节点会不会出现在屏幕上」）============
// 支持 wx:if / wx:elif / wx:else 链、wx:for（取第一项，空数组即不渲染）、
// 以及 <overlay open="{{…}}">：组件根节点是 wx:if={{rendered}} 且关闭态 visibility:hidden，
// 所以「用户此刻看得见」等价于 open 为真。这不是复刻页面逻辑，是渲染可达性模型。
const KEYWORDS = ['true', 'false', 'null', 'undefined', 'typeof', 'new', 'in', 'of']
function stripLiterals(expr) { return String(expr).replace(/'[^']*'|"[^"]*"/g, '""') }
function pathsOf(expr) {
  const s = stripLiterals(expr)
  const out = []
  const re = /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[\s*\d+\s*\])*/g
  let m
  while ((m = re.exec(s))) {
    const p = m[0]
    const head = p.split('.')[0].replace(/\[\d+\]$/, '')
    if (KEYWORDS.indexOf(head) !== -1) continue
    if (out.indexOf(p) === -1) out.push(p)
  }
  return out
}
function rootsOf(expr) {
  const out = []
  pathsOf(expr).forEach(p => {
    const head = p.split('.')[0].replace(/\[\d+\]$/, '')
    if (out.indexOf(head) === -1) out.push(head)
  })
  return out
}
function evalExpr(expr, data) {
  const undeclared = rootsOf(expr).filter(n => !(n in data))
  const prelude = undeclared.map(n => 'var ' + n + ' = undefined;').join('')
  return new Function('d', prelude + 'with (d) { return (' + expr + ') }')(data)
}
function tryEval(expr, data) {
  try { return { ok: true, value: evalExpr(expr, data) } } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
}
function rawExpr(attrVal) {
  if (typeof attrVal !== 'string') return null
  const m = attrVal.match(/^\s*\{\{([\s\S]*)\}\}\s*$/)
  return m ? m[1] : null
}
function interpList(text) { return String(text).match(/\{\{[\s\S]*?\}\}/g) || [] }
function attrRaw(node, name) { return node.attrs && name in node.attrs ? node.attrs[name] : null }
function evalAttr(node, name, data) {
  const raw = attrRaw(node, name)
  if (raw === null) return null
  return String(raw).replace(/\{\{([\s\S]*?)\}\}/g, (_all, expr) => {
    const r = tryEval(expr, data)
    if (!r.ok) throw new Error(name + ' 求值失败：{{' + expr + '}} → ' + r.error)
    return String(r.value === undefined || r.value === null ? '' : r.value)
  })
}
function safeAttr(node, name, data) {
  try { return { ok: true, value: evalAttr(node, name, data) } } catch (e) { return { ok: false, error: e.message } }
}
function hasClass(rendered, cls) { return (' ' + String(rendered) + ' ').indexOf(' ' + cls + ' ') !== -1 }

function parse(source) {
  const root = { tag: '#root', attrs: {}, children: [], start: 0 }
  const stack = [root]
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      const tail = source.slice(i)
      if (tail.trim()) stack[stack.length - 1].children.push({ text: tail })
      break
    }
    const pending = source.slice(i, lt)
    if (pending.trim()) stack[stack.length - 1].children.push({ text: pending })
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt)
      i = end === -1 ? source.length : end + 3
      continue
    }
    if (source[lt + 1] === '/') {
      const gt = source.indexOf('>', lt)
      if (stack.length > 1) stack.pop()
      i = gt === -1 ? source.length : gt + 1
      continue
    }
    let j = lt + 1
    const nm = /^[A-Za-z0-9_-]+/.exec(source.slice(j))
    if (!nm) { i = lt + 1; continue }
    const name = nm[0]
    j += name.length
    const attrs = {}
    let selfClose = false
    while (j < source.length) {
      while (j < source.length && /\s/.test(source[j])) j++
      if (source[j] === '>') { j++; break }
      if (source[j] === '/') {
        if (source[j + 1] === '>') { selfClose = true; j += 2; break }
        j++
        continue
      }
      const am = /^[^\s=>/]+/.exec(source.slice(j))
      if (!am) { j++; continue }
      const key = am[0]
      j += key.length
      while (j < source.length && /\s/.test(source[j])) j++
      let val = ''
      if (source[j] === '=') {
        j++
        while (j < source.length && /\s/.test(source[j])) j++
        const q = source[j]
        if (q === '"' || q === "'") {
          const close = source.indexOf(q, j + 1)
          val = source.slice(j + 1, close === -1 ? source.length : close)
          j = close === -1 ? source.length : close + 1
        } else {
          const bare = /^[^\s>]*/.exec(source.slice(j))
          val = bare[0]
          j += val.length
        }
      }
      attrs[key] = val
    }
    const node = { tag: name, attrs, children: [], start: lt }
    stack[stack.length - 1].children.push(node)
    i = j
    if (!selfClose) stack.push(node)
  }
  return root
}
function allTags(root) {
  const out = []
  const walk = n => (n.children || []).forEach(c => {
    if (c.text !== undefined) return
    out.push(c)
    walk(c)
  })
  walk(root)
  return out.sort((a, b) => a.start - b.start)
}
function visibleEntries(root, data) {
  const out = []
  const walk = (node, data, ancestors) => {
    let prevBlock = null
    ;(node.children || []).forEach(ch => {
      if (ch.text !== undefined) {
        out.push({ kind: 'text', text: ch.text, data: data, ancestors: ancestors, owner: node })
        return
      }
      const a = ch.attrs || {}
      let cond = null
      if ('wx:if' in a) {
        const e = rawExpr(a['wx:if'])
        cond = e
        prevBlock = '!(' + e + ')'
      } else if ('wx:elif' in a) {
        const e = rawExpr(a['wx:elif'])
        cond = prevBlock === null ? e : prevBlock + ' && (' + e + ')'
        prevBlock = (prevBlock === null ? 'true' : prevBlock) + ' && !(' + e + ')'
      } else if ('wx:else' in a) {
        cond = prevBlock === null ? 'false' : prevBlock
        prevBlock = 'false'
      } else {
        prevBlock = null
      }
      if (cond !== null) {
        const r = tryEval(cond, data)
        if (!r.ok || !r.value) return
      }
      let d = data
      if ('wx:for' in a) {
        const lr = tryEval(rawExpr(a['wx:for']) || '', data)
        const list = lr.ok ? lr.value : null
        if (!Array.isArray(list) || !list.length) return
        d = Object.assign({}, data, { item: list[0] })
      }
      if (ch.tag === 'overlay') {
        const openExpr = rawExpr(a.open)
        if (openExpr !== null) {
          const r = tryEval(openExpr, d)
          if (!r.ok || !r.value) return
        }
      }
      const chain = ancestors.concat([{ tag: ch.tag, node: ch }])
      out.push({ kind: 'tag', node: ch, data: d, ancestors: chain })
      walk(ch, d, chain)
    })
  }
  walk(root, data, [])
  return out
}
function visibleTags(root, data, tagName) {
  return visibleEntries(root, data).filter(e => e.kind === 'tag' && e.node.tag === tagName).map(e => e.node)
}
function overlayTags(root, data) { return visibleTags(root, data, 'overlay') }
function entriesPrinting(root, data, target) {
  if (typeof target !== 'string' || target === '') return []
  return visibleEntries(root, data).filter(e => {
    if (e.kind !== 'text') return false
    return interpList(e.text).some(chunk => {
      const r = tryEval(chunk.slice(2, -2), e.data)
      return r.ok && String(r.value) === target
    })
  })
}
function inOverlay(entry) { return entry.ancestors.some(a => a.tag === 'overlay') }
function overlayOf(entry) {
  const chain = entry.ancestors.filter(a => a.tag === 'overlay')
  return chain.length ? chain[chain.length - 1].node : null
}
function datasetOf(node, data) {
  const ds = {}
  Object.keys(node.attrs || {}).forEach(k => {
    if (k.indexOf('data-') !== 0) return
    const name = k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase())
    const expr = rawExpr(node.attrs[k])
    const r = tryEval(expr === null ? String(node.attrs[k]) : expr, data)
    ds[name] = r.ok ? r.value : undefined
  })
  return ds
}
function mkEvent(dataset) {
  return { currentTarget: { dataset: dataset || {} }, target: { dataset: dataset || {} }, detail: { value: [], length: 0 } }
}
// 屏幕上可达、且 bindtap 求值后指向实例上真实方法的控件（「入口」= 用户点得到，不看文案长相）
function reachableTapEntries(root, data, inst) {
  const out = []
  const bad = []
  visibleEntries(root, data).forEach(e => {
    if (e.kind !== 'tag') return
    const tap = attrRaw(e.node, 'bindtap')
    if (tap === null) return
    const r = safeAttr(e.node, 'bindtap', e.data)
    if (!r.ok) { bad.push(r.error); return }
    if (r.value === '' || typeof inst[r.value] !== 'function') return
    out.push({ node: e.node, handler: r.value, dataset: datasetOf(e.node, e.data), data: e.data, overlay: overlayOf(e) })
  })
  out.unresolvable = bad
  return out
}

// ============ 实例装载 ============
function loadConfig(file, kind) {
  const bag = {}
  global[kind] = cfg => { bag.cfg = cfg }
  delete require.cache[require.resolve(file)]
  require(file)
  return bag.cfg
}
function makeInstance(cfg, props) {
  const inst = Object.assign({}, cfg, cfg.methods || {})
  inst.data = Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), props || {})
  inst.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (cb) setImmediate(() => {
      try { cb() } catch (e) { harnessErrors.push('setData 回调抛错：' + String(((e && e.stack) || e)).split('\n')[0]) }
    })
  }
  inst.triggerEvent = () => {}
  return inst
}
function makeWxStub() {
  const rec = { toasts: [], clips: [] }
  global.wx = {
    showToast: o => rec.toasts.push((o && o.title) || ''),
    setClipboardData: o => { rec.clips.push(o.data); if (o.success) o.success({}) },
    stopPullDownRefresh: () => {},
    navigateTo: () => {},
  }
  return rec
}
// 宿主 setData → 子组件属性：微信的 observers 是「值真的变了才通知」。
// 旧写法是测试里手动 call 观察者，把「宿主 bump 到底有没有送达」整段跳过了（V4 漏网的成因）。
function pushProp(host, comp, key) {
  const next = host.data[key]
  if (comp.data[key] === next) return false
  comp.data[key] = next
  if (comp.observers && comp.observers[key]) comp.observers[key].call(comp, next)
  return true
}

// ============ WXSS 模型：级联终值，不把某一行的字符串钉死 ============
function wxssRules(text) {
  const s = String(text).replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(s))) {
    out.push({ selectors: m[1].split(',').map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean), body: m[2] })
  }
  return out
}
function parseDecls(body) {
  const map = {}
  String(body).split(';').map(x => x.trim()).filter(Boolean).forEach(d => {
    const i = d.indexOf(':')
    if (i < 0) return
    const k = d.slice(0, i).trim()
    const v = d.slice(i + 1).trim()
    if (k === 'padding') {
      const p = v.trim().split(/\s+/)
      const m2 = { 'padding-top': p[0], 'padding-right': p[1] || p[0], 'padding-bottom': p[2] || p[0], 'padding-left': p[3] || p[1] || p[0] }
      Object.keys(m2).forEach(kk => { map[kk] = m2[kk] })
      return
    }
    if (k === 'border-top') {
      const p = v.trim().split(/\s+/)
      map['border-top-width'] = p[0]
      return
    }
    map[k] = v
  })
  return map
}
// 选择器匹配：允许目标出现在逗号组里或被祖先限定（`.page.has-sticky` 与 `x .page.has-sticky` 都算），
// 但不许把 `.subpage.has-sticky` 这种不同 compound 混进来——判的是「这条规则的终值」，不是字符串形状。
function selectorMatches(sel, target) {
  if (target.indexOf(' ') !== -1) return sel === target
  return sel.split(/[\s>+~]+/).some(tok => tok === target)
}
function cascade(rules, selector, tokens, prop) {
  let value = null
  rules.forEach(r => {
    if (!r.selectors.some(sel => selectorMatches(sel, selector))) return
    const d = parseDecls(r.body)
    if (prop in d) value = d[prop]
  })
  if (value === null) return null
  let guard = 0
  let v = String(value)
  while (v.indexOf('var(') !== -1 && guard++ < 10) {
    v = v.replace(/var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*([^()]*))?\)/g, (_m, name, fb) => {
      const t = tokens[name]
      return t === undefined ? (fb === undefined ? '0px' : fb) : t
    })
  }
  return v
}
function tokensOf(rules) {
  const t = {}
  rules.forEach(r => {
    if (r.selectors.indexOf('page') === -1) return
    const d = parseDecls(r.body)
    Object.keys(d).forEach(k => { if (k.indexOf('--') === 0) t[k] = d[k] })
  })
  return t
}
// env(...) 是运行时才知道的量：单独报出来，既不当 0 也不臆造数值。
function pxOf(value) {
  if (value === null || value === undefined) return { px: null, env: false }
  const s = String(value)
  const found = s.match(/(-?[\d.]+)px/g) || []
  const nums = found.map(x => parseFloat(x))
  return { px: nums.length ? nums.reduce((a, b) => a + b, 0) : (/^\s*0\s*$/.test(s) ? 0 : null), env: /env\(/.test(s) }
}

// ============ 段落守卫：崩红不等于抓到，也不许让后面的段落没有读数 ============
async function guarded(label, fn) {
  try {
    await fn()
  } catch (e) {
    check(label + '：段落执行完成（抛错即视为该段没有读数，必须单独判红而不是中止整轮）', false, String((e && e.message) || e))
  }
}

async function main() {
  const wxRec = makeWxStub()
  // 组件内部的外呼都先桩成成功：不桩住就会抛进 .catch，而 catch 里也复位 busy/revokeId，
  // 成功路径的断言会被失败分支替答（测出来的不是它声称的那件事）。
  api.readOr = () => Promise.resolve({ memberships: [], groups: [], vehicles: [], events: [] })
  api.readContact = () => Promise.resolve({ ok: true, value: { phone: '138-0000-0000' } })
  api.readSensitive = () => Promise.resolve({ ok: true, value: { emergency: { name: '甲', phone: '1' }, medical: '' } })
  api.readExport = () => Promise.resolve({ ok: true, value: 'name,phone' })

  const ROSTER_W = src(ROSTER_WXML)
  const roster = loadConfig(ROSTER_JS, 'Component')
  const rosterRoot = parse(ROSTER_W)
  const ROSTER_BASE = JSON.parse(JSON.stringify(roster.data || {}))

  function newRoster(props, opts) {
    const c = makeInstance(roster, Object.assign({}, ROSTER_BASE, { activityId: 'a1' }, props || {}))
    c.revision = 5
    c.view = { kind: 'activity', activity: { phase: 'gathering' }, rows: [{ signupId: 's1', name: '张三' }] }
    if (!opts || !opts.allowLoad) c._loading = true
    return c
  }
  const validStaffForm = {
    mUserId: 'u-9',
    expires: { date: '2026-10-20', time: '18:00' },
    caps: { roster: true },
    selected: { s1: true },
    selectedCount: 1,
    roleIndex: 0,
    scopeIndex: 0,
    loading: false,
    denied: '',
    accessOpen: true,
    memberships: [{ id: 'm1', userId: 'u-9', roleLabel: '现场协作', expiresLabel: '2026-10-20 18:00' }],
  }
  const askDataFixture = Object.assign({}, validStaffForm, {
    revokeId: 'm1', revokeText: 'u-9（现场协作 · 截止 2026-10-20 18:00）',
  })
  const contactFixture = Object.assign({}, ROSTER_BASE, {
    loading: false, denied: '', contactOpen: true, contact: { signupId: 's1', name: '张三' }, purpose: '核实伤病后的紧急联络',
  })
  const batchFixture = Object.assign({}, ROSTER_BASE, {
    loading: false, denied: '', batch: 'cancel', batchReason: '天气原因退出', selected: { s1: true }, selectedCount: 1,
  })
  const exportFixture = Object.assign({}, ROSTER_BASE, {
    loading: false, denied: '', exportOpen: true, exportPurpose: '现场联络', selected: { s1: true }, selectedCount: 1,
  })

  // overlay 按「open 随数据由假变真」识别，不比对字面写法（V10 假红的成因）
  function blockToggledBy(flag, truthyValue) {
    const on = JSON.parse(JSON.stringify(ROSTER_BASE))
    on[flag] = truthyValue
    const off = JSON.parse(JSON.stringify(ROSTER_BASE))
    off[flag] = ''
    const opened = overlayTags(rosterRoot, on)
    const closed = overlayTags(rosterRoot, off)
    return opened.filter(n => closed.indexOf(n) === -1)
  }

  // ================= C-04 =================
  await guarded('C-04', async () => {
    section('C-04 onAccessSave：dispatch 前置 busy、同一请求在途拒绝再次进入、成败两路都复位')
    let saves = []
    let saveGate = deferred()
    api.dispatchAndSync = payload => { saves.push(payload); return saveGate.promise }

    const c1 = newRoster(validStaffForm)
    c1.onAccessSave()
    check('校验通过后发出且只发出一笔 membership.save', saves.length === 1 && saves[0].type === 'membership.save', JSON.stringify(saves.map(p => p.type)))
    check('dispatch 请求在途时 busy 为真（按钮的灰态此刻才有依据）', c1.data.busy === true, String(c1.data.busy))
    check('置 busy 时同步写 busyAt（busyStale 自愈读它；下面有真判据，不是只在注释里自称依赖）', c1.data.busyAt > 0, String(c1.data.busyAt))

    c1.onAccessSave()
    c1.onAccessSave()
    check('同一请求在途时再点被拒绝：仍是 1 笔，不是 3 笔', saves.length === 1, String(saves.length))
    const firstMembershipId = saves[0] && saves[0].membership.id
    check('未重复发命令 ⇒ 不会再生成第二个 membershipId', saves.length === 1 && typeof firstMembershipId === 'string' && firstMembershipId === saves[0].membership.id, String(firstMembershipId))

    await saveGate.resolve({ revision: 6 })
    await sleep(10)
    check('成功分支把 busy 复位', c1.data.busy === false, String(c1.data.busy))
    check('成功分支保留 busyAt（清掉会让 busyStale 自愈误判）', c1.data.busyAt > 0, String(c1.data.busyAt))
    check('成功后表单切到「调整现有授权」：editingId 等于刚保存的那条', c1.data.editingId === firstMembershipId, c1.data.editingId)

    const c1b = newRoster(validStaffForm)
    let failGate = deferred()
    api.dispatchAndSync = () => failGate.promise
    c1b.onAccessSave()
    await failGate.reject(new Error('boom'))
    await sleep(10)
    check('失败分支同样把 busy 复位（否则一次网络抖动永久锁死按钮）', c1b.data.busy === false, String(c1b.data.busy))
    check('失败给出可读文案', typeof c1b.data.error === 'string' && c1b.data.error.length > 0, c1b.data.error)

    const c1c = newRoster(Object.assign({}, validStaffForm, { mUserId: '  ' }))
    let guardCalls = 0
    api.dispatchAndSync = () => { guardCalls++; return Promise.resolve({ revision: 7 }) }
    c1c.onAccessSave()
    check('校验不过时不发命令', guardCalls === 0, String(guardCalls))
    check('校验不过时 busy 保持为假（校验失败绝不能把按钮锁灰）', c1c.data.busy === false, String(c1c.data.busy))
    check('校验不过时给出原因', typeof c1c.data.error === 'string' && c1c.data.error.length > 0, c1c.data.error)
  })

  // ================= V11：busyStale 自愈的两条真判据 =================
  await guarded('busyStale', async () => {
    section('busyStale 自愈：残留 busy 且已超时 ⇒ reload 复位；未超时 ⇒ 不复位（反向对照，门不是一刀切）')
    let readsOnHeal = 0
    const readStub = () => { readsOnHeal++; return Promise.resolve({ revision: 6, now: 'x', view: { kind: 'denied', message: '本轮不关心名单内容' } }) }
    api.read = readStub
    const healStale = makeInstance(roster, Object.assign({}, ROSTER_BASE, { activityId: '', busy: true, busyAt: Date.now() - 60000 }))
    healStale.reload()
    check('roster-panel：残留 busy + busyAt 早已超时 ⇒ reload 第一眼就复位（promise 不回来的那次抖动不能永久锁死面板）', healStale.data.busy === false, String(healStale.data.busy))
    const healFresh = makeInstance(roster, Object.assign({}, ROSTER_BASE, { activityId: '', busy: true, busyAt: Date.now() }))
    healFresh.reload()
    check('roster-panel：busy 仍在窗口内 ⇒ 不许被自愈清掉（否则「写还没落地」的守卫形同虚设；这条也是「门不是永远复位」的反向对照）', healFresh.data.busy === true, String(healFresh.data.busy))
    const healReal = makeInstance(roster, Object.assign({}, ROSTER_BASE, { activityId: 'a1', busy: true, busyAt: Date.now() - 60000 }))
    healReal.reload()
    check('自愈之后 reload 继续照常读取（不是只清标志就 return）', healReal.data.busy === false && readsOnHeal === 1, 'busy=' + healReal.data.busy + ' reads=' + readsOnHeal)
    const fieldCfgForHeal = loadConfig(FIELD_JS, 'Component')
    const healField = makeInstance(fieldCfgForHeal, { activityId: '', perspective: 'staff', busy: true, busyAt: Date.now() - 60000 })
    healField.reload()
    check('field-panel（staff 页那一块）同一判据：超时残留 busy 也被复位', healField.data.busy === false, String(healField.data.busy))
    const healFieldFresh = makeInstance(fieldCfgForHeal, { activityId: '', perspective: 'staff', busy: true, busyAt: Date.now() })
    healFieldFresh.reload()
    check('field-panel：未超时的 busy 不被复位（两块面板共用同一口径）', healFieldFresh.data.busy === true, String(healFieldFresh.data.busy))
  })

  // ================= M-13 =================
  await guarded('M-13', async () => {
    section('M-13 membership.revoke：单击不执行、中间态可见可取消、确认才落地')
    const memberships = [{ id: 'm1', userId: 'u-9', roleLabel: '现场协作', expiresLabel: '2026-10-20 18:00' }]
    let revokes = []
    const revokeGate = deferred()
    api.dispatchAndSync = payload => { revokes.push(payload); return revokeGate.promise }

    const askProbe = newRoster(validStaffForm)
    const askEntries = reachableTapEntries(rosterRoot, askProbe.data, askProbe).filter(e => e.handler === 'onRevokeAsk')
    check('名单里存在一个可达的「撤销」入口（bindtap 在当前数据下解析到组件真实方法，门有输入）', askEntries.length === 1, '找到 ' + askEntries.length + ' 个')
    if (askEntries.length) {
      askProbe[askEntries[0].handler](mkEvent(askEntries[0].dataset))
      check('单击「撤销」不发出命令（该入口的 handler 只负责询问）', revokes.length === 0, String(revokes.length))
      check('中间态被记住：revokeId 指向被撤销的那条授权', askProbe.data.revokeId === 'm1', askProbe.data.revokeId)
      check('中间态带得出「撤的是谁的什么能力」：身份码 + 角色 + 截止都在文案里',
        ['u-9', '现场协作', '2026-10-20 18:00'].every(s => String(askProbe.data.revokeText).indexOf(s) !== -1), askProbe.data.revokeText)
    }

    const askBlocks = blockToggledBy('revokeId', 'm1')
    const sheetBlocks = blockToggledBy('accessOpen', true)
    check('存在一个「只在撤销待确认时打开」的弹层（按 open 随数据变化识别，不限写法）', askBlocks.length === 1, '命中 ' + askBlocks.length + ' 个')
    check('存在一个「只在协作授权打开时」的 sheet（同求值识别）', sheetBlocks.length === 1, '命中 ' + sheetBlocks.length + ' 个')

    if (askBlocks.length === 1) {
      const askData = Object.assign({}, validStaffForm, { memberships: memberships, revokeId: 'm1', revokeText: 'u-9（现场协作 · 截止 2026-10-20 18:00）' })
      const printing = entriesPrinting(rosterRoot, askData, askData.revokeText).filter(e => overlayOf(e) === askBlocks[0])
      check('询问态那一刻，被撤销对象真的印在这个弹层里（文本在场不算，必须此刻会渲染）', printing.length >= 1,
        'revokeText="' + askData.revokeText + '" 命中 ' + printing.length + ' 条可见节点')
      check('该弹层排在协作授权 sheet 之后（同为 z-index:200，靠文档顺序压在 sheet 上）',
        sheetBlocks.length === 1 && askBlocks[0].start > sheetBlocks[0].start,
        'dialog@' + askBlocks[0].start + ' sheet@' + (sheetBlocks[0] && sheetBlocks[0].start))

      const inDialog = reachableTapEntries(rosterRoot, askData, askProbe).filter(e => e.overlay === askBlocks[0])
      const executing = []
      const probeErrors = []
      inDialog.forEach(e => {
        const probe = newRoster(askData)
        const before = revokes.length
        try { probe[e.handler](mkEvent(e.dataset)) } catch (err) { probeErrors.push(e.handler + ':' + String((err && err.message) || err)) }
        if (revokes.length > before) executing.push(e.handler)
      })
      check('弹层内可达入口里有且只有一个会真正执行撤销（真调 handler 观察，不扫方法体）', executing.length === 1,
        JSON.stringify(inDialog.map(e => e.handler)) + ' → ' + JSON.stringify(executing))
      check('撤销确认真的发出了 membership.revoke 且带上被记住的授权 id',
        revokes.length === 1 && revokes[0].type === 'membership.revoke' && revokes[0].membershipId === 'm1', JSON.stringify(revokes))
      check('探针调用没有抛错（抛错说明入口拿到的数据不完整，不能让它冒充「已验过」）', probeErrors.length === 0, probeErrors.join(' ｜ '))
      const closeName = attrRaw(askBlocks[0], 'bind:close')
      check('弹层声明了关闭通道（可取消）且该通道不发命令',
        typeof closeName === 'string' && typeof askProbe[closeName] === 'function' && revokes.length === 1, String(closeName))
    }

    const c2b = newRoster(askDataFixture)
    revokes = []
    api.dispatchAndSync = payload => { revokes.push(payload); return Promise.resolve({ revision: 8 }) }
    c2b.onRevokeCancel()
    check('取消后中间态清空且没有发出任何命令', c2b.data.revokeId === '' && revokes.length === 0, c2b.data.revokeId + '/' + revokes.length)
    c2b.onRevokeConfirm()
    check('没在询问态时点确认不会撤销（缺 id 直接不执行）', revokes.length === 0, String(revokes.length))

    const c2c = newRoster(Object.assign({}, validStaffForm, { memberships: memberships, revokeId: 'm1' }))
    revokes = []
    const revokeGate2 = deferred()
    api.dispatchAndSync = payload => { revokes.push(payload); return revokeGate2.promise }
    c2c.onRevokeConfirm()
    c2c.onRevokeConfirm()
    check('确认按钮连点两次只落一条撤销', revokes.length === 1, String(revokes.length))
    await revokeGate2.resolve({ revision: 9 })
    await sleep(10)
    check('撤销成功后弹层自己收起来（revokeId 复位）', c2c.data.revokeId === '', c2c.data.revokeId)
    check('撤销成功后 busy 复位', c2c.data.busy === false, String(c2c.data.busy))
    check('上面两条是成功路径答的，不是失败分支替答的（error 仍为空、toast 是成功文案）',
      c2c.data.error === '' && wxRec.toasts.indexOf('授权已撤销') !== -1,
      'error=' + c2c.data.error + ' toasts=' + JSON.stringify(wxRec.toasts))
  })

  // ================= C-01 配对 =================
  await guarded('C-01', async () => {
    section('C-01 控件姿态配对：全部 class+bindtap 控件逐个求值（不再按 disabled 字样或表达式形状预筛）')
    let scanned = 0
    const broken = []
    const unresolvable = []
    const base = ROSTER_BASE
    const falsyFor = p => {
      const v = p.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), base)
      if (typeof v === 'number') return 0
      if (typeof v === 'boolean') return false
      if (Array.isArray(v)) return []
      return ''
    }
    const truthyFor = p => {
      const v = p.split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), base)
      if (typeof v === 'number') return 7
      if (typeof v === 'boolean') return true
      if (Array.isArray(v)) return [{ id: 'x' }]
      return '一段文字'
    }
    const setPath = (obj, p, value) => {
      const parts = p.split(/[.[\]]+/).filter(Boolean)
      let cur = obj
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i]
        if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = {}
        cur = cur[k]
      }
      cur[parts[parts.length - 1]] = value
    }
    allTags(rosterRoot).forEach(node => {
      const cls = attrRaw(node, 'class')
      const tap = attrRaw(node, 'bindtap')
      if (cls === null || tap === null) return
      const names = []
      ;[cls, tap].forEach(v => {
        interpList(v).forEach(chunk => pathsOf(chunk.slice(2, -2)).forEach(p => { if (names.indexOf(p) === -1) names.push(p) }))
      })
      if (!names.length) return // 两个属性都不随数据变：既不会变灰也不会变点不动，无从配对（也不是缺陷形态）
      scanned++
      let acc = [JSON.parse(JSON.stringify(base))]
      names.forEach(p => {
        const next = []
        acc.forEach(b => [falsyFor(p), truthyFor(p)].forEach(v => {
          const o = JSON.parse(JSON.stringify(b))
          setPath(o, p, v)
          next.push(o)
        }))
        acc = next
      })
      if (acc.length > 64) { unresolvable.push('引用 ' + names.length + ' 个变量（组合数 ' + acc.length + '）超出穷举上限，请把该控件的表达式拆开或补解析器'); return }
      acc.forEach(data => {
        const c = safeAttr(node, 'class', data)
        const t = safeAttr(node, 'bindtap', data)
        if (!c.ok || !t.ok) { unresolvable.push(String(c.error || t.error) + ' ｜ names=' + JSON.stringify(names)); return }
        const shownDisabled = hasClass(c.value, 'disabled')
        const clickable = t.value !== ''
        // 一致＝「禁用表达」与「事件被置空」同真同假；两者取同值才是不一致
        // （灰着却能点＝disabled true / clickable true；该灰却没灰＝disabled false / clickable false，
        //   后一种就是 V7 那种「把禁用表达整个删掉让控件对门隐形」的形态）。
        if (shownDisabled === clickable) broken.push(JSON.stringify(names) + ' → class=' + c.value + ' tap=' + t.value)
      })
    })
    check('扫到足够样本（>5 个随数据变化的双属性控件，门没空转）', scanned > 5, 'scanned=' + scanned)
    check('配对门没有「解析不了 / 放弃判定」的控件（解析不了就红，不再静默豁免——V8 那个洞的成因）', unresolvable.length === 0, unresolvable.slice(0, 3).join(' ｜ '))
    check('不存在「看着能点其实点不动 / 看着灰着其实能点」的控件（含「该禁用却根本没有禁用表达」这种形态）', broken.length === 0, broken.slice(0, 3).join(' ｜ '))
  })

  // ================= C-01b 在途不可点 =================
  await guarded('C-01b', async () => {
    section('C-01b 写命令在途（取真组件的真实 busy 快照）时，屏幕上可达且会发写命令的入口必须点不动且带禁用表达')
    const inFlightCases = [
      { label: '协作授权 sheet', fixture: validStaffForm },
      { label: '撤销确认弹层', fixture: askDataFixture },
      { label: '批量确认弹层', fixture: batchFixture },
      { label: '导出确认弹层', fixture: exportFixture },
    ]
    let covered = 0
    inFlightCases.forEach(cs => {
      const idle = newRoster(cs.fixture)
      const entries = reachableTapEntries(rosterRoot, idle.data, idle)
      const commands = []
      const notes = []
      entries.forEach(e => {
        const probe = newRoster(cs.fixture)
        const rec = []
        const gate = deferred()
        api.dispatchAndSync = p => { rec.push(p); return gate.promise }
        let threw = null
        try { probe[e.handler](mkEvent(e.dataset)) } catch (err) { threw = err }
        gate.resolve({ revision: 99 })
        if (threw) { notes.push(e.handler + ' 抛错 ' + threw.message); return }
        if (rec.length && probe.data.busy === true) commands.push({ entry: e, inFlight: probe.data })
      })
      if (!commands.length) {
        check(cs.label + '：本场景确实存在「发写命令并置 busy」的可达入口（门没在空转）', false,
          '可达入口=' + entries.map(e => e.handler).join('/') + (notes.length ? ' ｜ ' + notes.join(' ｜ ') : ''))
        return
      }
      const leaked = []
      commands.forEach(c => {
        const cls = safeAttr(c.entry.node, 'class', c.inFlight)
        const tap = safeAttr(c.entry.node, 'bindtap', c.inFlight)
        if (!cls.ok || !tap.ok) { leaked.push(c.entry.handler + ' 在途态求值失败 ' + String(cls.error || tap.error)); return }
        if (tap.value !== '') leaked.push(c.entry.handler + ' 在途仍可点（tap=' + tap.value + ' class=' + cls.value + '）')
        else if (!hasClass(cls.value, 'disabled')) leaked.push(c.entry.handler + ' 在途点不动但没变灰（class=' + cls.value + '）')
      })
      const idleDead = commands.filter(c => {
        const cls = safeAttr(c.entry.node, 'class', c.entry.data)
        const tap = safeAttr(c.entry.node, 'bindtap', c.entry.data)
        return !cls.ok || !tap.ok || tap.value === '' || hasClass(cls.value, 'disabled')
      })
      check(cs.label + '：在途时该入口点不动且呈禁用（busy 由真组件自己置起来，不是模板里的字面变量名）', leaked.length === 0, leaked.join(' ｜ '))
      check(cs.label + '：空闲时同一入口可点且没变灰（反向对照：门不是把一切判死）', idleDead.length === 0, idleDead.map(c => c.entry.handler).join('/'))
      covered++
    })
    check('四种「发写命令 + 置 busy」的场景全部被覆盖', covered === inFlightCases.length, covered + '/' + inFlightCases.length)
  })

  // ================= C-02 失败可见性 =================
  await guarded('C-02', async () => {
    section('C-02 失败可见性：按失败那一刻的真实 data 求渲染，出口必须落在用户当下看得见的那一层')
    const failureCases = [
      {
        label: 'onSensitive 被服务端拒绝', fixture: contactFixture,
        arm: () => { api.readSensitive = () => Promise.resolve({ ok: false, error: { message: '敏感资料仅供本人、授权代办或注明用途的当次工作使用。' } }) },
        invoke: i => i.onSensitive(), field: 'error',
      },
      {
        label: 'onSensitive 网络异常（catch 分支）', fixture: contactFixture,
        arm: () => { api.readSensitive = () => Promise.reject(new Error('network down')) },
        invoke: i => i.onSensitive(), field: 'error',
      },
      {
        label: 'onContact 读电话被拒', fixture: Object.assign({}, ROSTER_BASE, { loading: false, denied: '' }),
        arm: () => { api.readContact = () => Promise.resolve({ ok: false, error: { message: '电话读不到' } }) },
        invoke: i => i.onContact(mkEvent({ id: 's1' })), field: 'contact.phoneError',
      },
      {
        label: '批量确认写失败', fixture: batchFixture,
        arm: () => { api.dispatchAndSync = () => Promise.reject(new Error('CONFLICT')) },
        invoke: i => i.onBatchConfirm(), field: 'error',
      },
      {
        label: '导出确认写失败', fixture: exportFixture,
        arm: () => { api.dispatchAndSync = () => Promise.reject(new Error('INTERNAL')) },
        invoke: i => i.onExportConfirm(), field: 'error',
      },
      {
        label: '授权保存写失败', fixture: validStaffForm,
        arm: () => { api.dispatchAndSync = () => Promise.reject(new Error('CONFLICT')) },
        invoke: i => i.onAccessSave(), field: 'error',
      },
      {
        label: '撤销写失败（确认层自己关掉 ⇒ 由仍开着的授权 sheet 接住）', fixture: askDataFixture,
        arm: () => { api.dispatchAndSync = () => Promise.reject(new Error('WRONG_PHASE')) },
        invoke: i => i.onRevokeConfirm(), field: 'error',
      },
      {
        label: '同行组约束写失败（此刻没有弹层开着 ⇒ 主面板必须自己说）',
        fixture: Object.assign({}, ROSTER_BASE, { loading: false, denied: '', groups: [{ id: 'g1', keepTogether: true, names: '张三、李四' }] }),
        arm: () => { api.dispatchAndSync = () => Promise.reject(new Error('CONFLICT')) },
        invoke: i => i.onToggleGroup(mkEvent({ id: 'g1', keep: true })), field: 'error',
      },
    ]
    const pathGet = (o, p) => p.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), o)
    let blind = 0
    let delegated = 0
    let exercised = 0
    const detail = []
    for (const cs of failureCases) {
      cs.arm()
      const inst = newRoster(cs.fixture)
      let threw = null
      try { cs.invoke(inst) } catch (e) { threw = e }
      await sleep(12)
      const text = String(pathGet(inst.data, cs.field) || '')
      if (threw || text === '') { blind++; detail.push(cs.label + '：失败路径没走到（threw=' + String(threw && threw.message) + '，' + cs.field + '="' + text + '"）'); continue }
      exercised++
      const openBefore = overlayTags(rosterRoot, cs.fixture).length
      const openAfter = overlayTags(rosterRoot, inst.data).length
      const printing = entriesPrinting(rosterRoot, inst.data, text)
      const insideOpen = printing.filter(inOverlay)
      const outside = printing.filter(e => !inOverlay(e))
      if (openAfter > 0) {
        if (!insideOpen.length) { blind++; detail.push(cs.label + '：那一刻还有 ' + openAfter + ' 个弹层开着，但没有任何「会渲染」的节点印出这句失败（红字在遮罩背后＝C-02 本体）') }
      } else if (!outside.length) {
        blind++; detail.push(cs.label + '：没有弹层开着，主面板那一刻也没有可见出口印出这句失败')
      }
      if (openAfter < openBefore && insideOpen.length) delegated++
    }
    api.readContact = () => Promise.resolve({ ok: true, value: { phone: '138-0000-0000' } })
    api.readSensitive = () => Promise.resolve({ ok: true, value: { emergency: { name: '甲', phone: '1' }, medical: '' } })
    check('八条失败路径都真的被执行（字段拿到文案、探针没抛错）——缺输入不许冒充通过', exercised === failureCases.length, exercised + '/' + failureCases.length)
    check('没有一处失败面是静默的（藏进 wx:if=false / 恒不成立的分支 / 遮罩背后，都算没有出口）', blind === 0, detail.join(' ｜ '))
    check('「本层关掉、交给仍开着的那一层」这条豁免至少被真实用到一次（撤销失败）', delegated >= 1, 'delegated=' + delegated)

    const contactBlocks = blockToggledBy('contactOpen', true)
    check('联络与资料弹层确实是被 contactOpen 求值识别出来的（不比对 open 的字面写法）', contactBlocks.length === 1, '命中 ' + contactBlocks.length + ' 个')
    if (contactBlocks.length === 1) {
      const failing = Object.assign({}, contactFixture, { sensitive: null, error: '电话读不到' })
      const printing = entriesPrinting(rosterRoot, failing, failing.error).filter(e => overlayOf(e) === contactBlocks[0])
      check('联络与资料弹层里，读取失败那一刻有会渲染的就近出口', printing.length >= 1, '命中 ' + printing.length + ' 条')
      const trigger = allTags(contactBlocks[0]).filter(n => String(attrRaw(n, 'bindtap') || '').indexOf('onSensitive') !== -1)
      const exitOwner = printing.length ? printing[0].owner : null
      check('出口排在触发点之后（先按钮再结果，用户视线扫得到）',
        trigger.length === 1 && !!exitOwner && exitOwner.start > trigger[0].start,
        (exitOwner && exitOwner.start) + '/' + (trigger[0] && trigger[0].start))
    }

    const c3b = newRoster(Object.assign({}, ROSTER_BASE, { loading: false, denied: '' }))
    api.readContact = () => Promise.resolve({ ok: false, error: { message: '电话读不到' } })
    c3b.onContact(mkEvent({ id: 's1' }))
    await sleep(12)
    check('打开弹层会把上一条残留 error 清掉（否则跨弹层串台，把新弹层变成别人的错误页）', c3b.data.error === '', c3b.data.error)
    api.readContact = () => Promise.resolve({ ok: true, value: { phone: '138-0000-0000' } })
  })

  // ================= F-04 =================
  await guarded('F-04', async () => {
    section('F-04 pages/staff：onShow 逐次下发新失效信号，并按「属性真的变了才通知观察者」送达 field-panel')
    const staffCfg = loadConfig(STAFF_JS, 'Page')
    check('staff 页声明了 onShow（返回本页的失效信号有挂载点）', typeof staffCfg.onShow === 'function', typeof staffCfg.onShow)
    let staffReads = 0
    api.read = () => {
      staffReads++
      return Promise.resolve({
        revision: 3, now: '2026-10-16T09:00:00+08:00',
        view: { kind: 'activity', perspective: 'staff', activity: { id: 'a1', phase: 'gathering', routeSnapshot: { points: [] }, pickupPoints: [] }, rows: [], permittedActions: [], counters: {}, incidents: [], positions: [] },
      })
    }
    api.readOr = () => Promise.resolve({ groups: [], memberships: [], vehicles: [], events: [] })
    const sp = makeInstance(staffCfg, {})
    sp.onLoad({ id: 'a1' })
    check('onLoad 只装配 activityId，不自己发读（避免与 attached 那次重复）', sp.data.activityId === 'a1' && staffReads === 0, String(staffReads))
    if (typeof sp.onShow === 'function') sp.onShow()
    const key0 = sp.data.syncKey === undefined ? '' : sp.data.syncKey
    check('首次进入不 bump syncKey：那一次读已由组件 attached 发出', key0 === '', String(key0))

    const staffRoot = parse(src(STAFF_WXML))
    const panelTag = allTags(staffRoot).filter(n => n.tag === 'field-panel')[0] || null
    const syncRaw = panelTag ? attrRaw(panelTag, 'sync-key') : null
    const syncExpr = syncRaw === null ? null : rawExpr(syncRaw)
    const hostKey = syncExpr && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(syncExpr).trim()) ? String(syncExpr).trim() : ''
    check('宿主把失效信号接到组件上：field-panel 的 sync-key 绑的是页面 data 里的一个动态键（写常量或漏绑都会红）',
      !!hostKey && !!panelTag, JSON.stringify({ attr: syncRaw, expr: syncExpr }))
    let bindingDynamic = false
    if (hostKey && panelTag) {
      const a = safeAttr(panelTag, 'sync-key', { syncKey: 'AAA', other: 'x' })
      const b = safeAttr(panelTag, 'sync-key', { syncKey: 'BBB', other: 'x' })
      bindingDynamic = a.ok && b.ok && a.value === 'AAA' && b.value === 'BBB'
      check('该绑定确实是数据驱动：换一份数据就得不同的值（识别绑定本身，不比对表达式字面）', bindingDynamic, JSON.stringify([a, b]))
    }

    const fieldCfg = loadConfig(FIELD_JS, 'Component')
    const fp = makeInstance(fieldCfg, { activityId: 'a1', perspective: 'staff', syncKey: key0 })
    if (fp.lifetimes && fp.lifetimes.attached) fp.lifetimes.attached.call(fp)
    await sleep(20)
    const afterAttach = staffReads
    check('真组件在 attached 里完成了首屏读（>0 次）', afterAttach > 0, String(afterAttach))
    const readKey = fp._readKey
    check('组件记下自己刚读过的那一份 key（去重依据在组件侧，宿主 bump 不会造成读风暴）', typeof readKey === 'string' && readKey !== '', String(readKey))

    if (hostKey) {
      sp.data[hostKey] = readKey
      const before = staffReads
      pushProp(sp, fp, hostKey)
      await sleep(20)
      check('把组件刚读过的那一份 key 再下发一次 ⇒ 组件按自己的 _readKey 去重，不重读（去重不靠宿主少发，所以 bump 不会造成读风暴）',
        staffReads === before, 'before=' + before + ' after=' + staffReads)
    }

    const bumps = []
    for (let n = 0; n < 2; n++) {
      await sleep(8)
      if (typeof sp.onShow !== 'function') break
      sp.onShow()
      const before = staffReads
      const notified = hostKey ? pushProp(sp, fp, hostKey) : false
      await sleep(20)
      bumps.push({ key: hostKey ? sp.data[hostKey] : sp.data.syncKey, notified: notified, delta: staffReads - before })
    }
    check('每次返回本页都下发一个与上一次不同的失效信号（恒定 key 会被组件去重吃掉 ⇒ F-04 原地复发）',
      bumps.length === 2 && bumps[0].key !== bumps[1].key && bumps.every(b => String(b.key) !== '' && String(b.key) !== String(key0)),
      JSON.stringify(bumps.map(b => b.key)))
    check('信号真的送达真 field-panel 并各重读一次（恰好一次，不多打全量读）',
      bumps.length === 2 && bumps.every(b => b.notified === true && b.delta === 1), JSON.stringify(bumps))
    const staffPhaseText = (src(STAFF_WXML).match(/授权变更后立即生效/) || [])[0] || ''
    check('页面那句「授权变更后立即生效」旁边现在有了兑现它的机制（信号逐次变化且送达面板）',
      !!staffPhaseText && bumps.length === 2 && bumps.every(b => b.notified === true && b.delta === 1), staffPhaseText)
  })

  // ================= D-01 =================
  await guarded('D-01', async () => {
    section('D-01 pages/route：读挪到 onShow，每次返回一次，且界面印的是本次读到的那一份')
    const routeCfg = loadConfig(ROUTE_JS, 'Page')
    check('pages/route 声明了 onShow', typeof routeCfg.onShow === 'function', typeof routeCfg.onShow)
    const routeReads = []
    const routeTitles = []
    api.readRoutes = id => {
      // 桩每次返回不同标题：否则「读了但不渲染」（D-01 原状）根本没机会露出来（V5 漏网的成因）
      const title = '青城后山·第' + (routeTitles.length + 1) + '次读'
      routeTitles.push(title)
      routeReads.push({ id: id, title: title })
      return Promise.resolve({
        revision: 4 + routeTitles.length,
        route: { id: 'r1', title: title, source: 'gpx', points: [], risks: [], isOwner: true, updatedAt: '2026-10-0' + routeTitles.length + 'T09:00:00+08:00' },
        referencedActivityIds: [],
      })
    }
    api.read = () => Promise.resolve({ view: { kind: 'home', activities: [] }, revision: 4 })
    api.getWeatherByPoint = () => Promise.reject(new Error('no-network'))
    const rp = makeInstance(routeCfg, {})
    rp.onLoad({ id: 'r1' })
    await sleep(20)
    check('onLoad 不再自己发读（留着就会和 onShow 双读，天气外呼也翻倍）', routeReads.length === 0, String(routeReads.length))
    const routeRoot = parse(src(ROUTE_WXML))
    if (typeof rp.onShow === 'function') rp.onShow()
    await sleep(20)
    check('onShow 读的是本页参数里那条路线', routeReads.length === 1 && routeReads[0].id === 'r1', JSON.stringify(routeReads))
    check('第一次读的结果真的落到页面 data 上（不是只发了请求）', !!rp.data.route && rp.data.route.title === routeTitles[0], JSON.stringify(rp.data.route && rp.data.route.title))
    check('那一刻的详情页真的会印出这个标题（data 对、模板不印也算红）', entriesPrinting(routeRoot, rp.data, routeTitles[0]).length >= 1,
      '命中 ' + entriesPrinting(routeRoot, rp.data, routeTitles[0]).length + ' 条可见节点')
    if (typeof rp.onShow === 'function') rp.onShow()
    await sleep(20)
    check('从 route-edit 保存返回 ⇒ 再读一次（陈旧数据只有这一条出路）', routeReads.length === 2, String(routeReads.length))
    check('第二次读到的是新数据：界面标题换成第二次的值（读了不渲染＝D-01 原状，必须红）',
      !!rp.data.route && rp.data.route.title === routeTitles[1] && routeTitles[1] !== routeTitles[0],
      'data=' + JSON.stringify(rp.data.route && rp.data.route.title) + ' 桩=' + JSON.stringify(routeTitles))
    check('旧标题此刻不再上屏，新标题上屏（渲染面逐次换）',
      entriesPrinting(routeRoot, rp.data, routeTitles[1]).length >= 1 && entriesPrinting(routeRoot, rp.data, routeTitles[0]).length === 0,
      '新=' + entriesPrinting(routeRoot, rp.data, routeTitles[1]).length + ' 旧=' + entriesPrinting(routeRoot, rp.data, routeTitles[0]).length)
    if (typeof rp.onShow === 'function') rp.onShow()
    await sleep(20)
    check('第三次返回仍逐次换新（不是「第一次有效、之后停在旧快照」）',
      routeReads.length === 3 && !!rp.data.route && rp.data.route.title === routeTitles[2],
      'reads=' + routeReads.length + ' data=' + JSON.stringify(rp.data.route && rp.data.route.title))
  })

  // ================= M-01 =================
  await guarded('M-01', async () => {
    section('M-01 route-edit：页尾留白只在固定底栏真的存在时出现，且留白的级联终值真的兜得住底栏')
    const reRoot = parse(src(ROUTE_EDIT_WXML))
    const rootTag = allTags(reRoot)[0]
    check('根节点是 .page（留白公式挂得住）', !!rootTag && hasClass(String(evalAttr(rootTag, 'class', { denied: '', loading: false })), 'page'), attrRaw(rootTag, 'class'))
    const stickyTags = allTags(reRoot).filter(n => hasClass(String(attrRaw(n, 'class') || ''), 'sticky-action'))
    check('页面确实用了 .sticky-action（固定底栏不计入文档流）', stickyTags.length >= 1, '命中 ' + stickyTags.length + ' 个')
    const mismatches = []
    ;[false, true].forEach(denied => [false, true].forEach(loading => {
      const data = { denied: denied ? '没权限' : '', loading: loading }
      const reserved = hasClass(String(evalAttr(rootTag, 'class', data)), 'has-sticky')
      const barShown = visibleEntries(reRoot, data).some(e => e.kind === 'tag' && hasClass(String(safeAttr(e.node, 'class', data).value || ''), 'sticky-action'))
      if (reserved !== barShown) mismatches.push(JSON.stringify(data) + ' → has-sticky=' + reserved + ' 底栏=' + barShown)
    }))
    check('有底栏的每种数据都留了白，没底栏的每种数据都不多留空白（denied×loading 四组合双向穷举）', mismatches.length === 0, mismatches.join(' ｜ '))

    const rules = wxssRules(src(APP_WXSS))
    const tokens = tokensOf(rules)
    const basePb = pxOf(cascade(rules, '.page', tokens, 'padding-bottom'))
    const stickyValue = cascade(rules, '.page.has-sticky', tokens, 'padding-bottom')
    const stickyPx = pxOf(stickyValue).px
    const barPadTop = pxOf(cascade(rules, '.sticky-action', tokens, 'padding-top')).px || 0
    const barPadBottom = pxOf(cascade(rules, '.sticky-action', tokens, 'padding-bottom')).px || 0
    const barBorder = pxOf(cascade(rules, '.sticky-action', tokens, 'border-top-width')).px || 0
    const btnMin = pxOf(cascade(rules, '.sticky-action .button', tokens, 'min-height')).px
    const btnMinBase = pxOf(cascade(rules, '.button', tokens, 'min-height')).px
    const barContent = btnMin === null ? btnMinBase : btnMin
    const barHeight = barPadTop + barPadBottom + barBorder + (barContent || 0)
    check('.page.has-sticky 存在且 padding-bottom 有可解析的正数终值（删掉规则或写成 0 都会红；追加别的声明不会红——这是行为判据不是文本门）',
      stickyPx !== null && stickyPx > 0, JSON.stringify({ value: stickyValue, px: stickyPx }))
    check('留白终值 ≥ 由 .sticky-action 自己算出来的底栏高度（padding+border+按钮 min-height，按 token 解析）',
      stickyPx !== null && barHeight > 0 && stickyPx >= barHeight,
      '预留=' + stickyPx + 'px 底栏=' + barHeight + 'px')
    check('留白终值 > 无底栏时的页尾内边距（.page 基线 ' + basePb.px + 'px）⇒ 这块白确实是「为底栏多留」的，不是恒等式',
      stickyPx !== null && basePb.px !== null && stickyPx > basePb.px,
      'has-sticky=' + stickyPx + ' .page=' + basePb.px)
    check('底栏高度算得出来（padding-top/padding-bottom/按钮 min-height 至少三项非零）⇒ 上面那条比较不是 0≥0 的空判据',
      barPadTop > 0 && barContent > 0 && barHeight >= barPadTop + barContent,
      JSON.stringify({ padTop: barPadTop, padBottom: barPadBottom, border: barBorder, button: barContent }))
    // env(safe-area-inset-bottom) 这类运行时量不参与比较，也不当 0 充数：
    // 上面两条用的是「已声明的 px 之和」，安全区只会让实际底栏更高，不会让它更矮 ⇒ 判据方向是保守的。
  })

  await sleep(10)
  check('整轮没有把抛错撞停：无未捕获异常 / 无未处理拒绝（抛错会吞掉后面段落的读数，不算判别力）',
    harnessErrors.length === 0, harnessErrors.slice(0, 3).join(' ｜ '))

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('运行失败：' + (e && e.stack || e)); process.exit(1) })
