'use strict'
// B4-E05 门（E-05：route 详情页「按出发时刻推算」曾是 checkbox-group 里的**裸文本兄弟节点**，
// 既不在 <label> 内也没有 .check-text ⇒ 可点区域只剩约 16px 的勾选框本体，点那行字没反应）。
//
// 判据是**结构关系 + 事件归属**，不是「数一数标签有几个」——根 AGENTS.md 铁律 21 禁止用元素数量当
// UI 证据，而本条缺陷的本质恰恰是「父子关系不对」：文本节点在不在 label 里面，数标签数不出来。
//   ① 勾选框的可点容器是 <label> 且带 .check-label（整行触点由 app.wxss 现成体系承载）；
//   ② 文案节点带 .check-text 且与勾选框同属那个 label（不是 group 的裸文本兄弟）；
//   ③ bindchange 的载体**仍是 checkbox-group**，且解析到该页真实存在的 handler（挪到 label 上会
//      改变 change 的发出位置，platform-pitfalls 的「checkbox-group / picker 的取值」条：group 的
//      e.detail.value 是全部选中值数组 —— 引用一律指名不指号（该文档 10-14 从 14 条扩到 17 条，编号整体后移））；
//   ④ 没有新增内联 style（roster-panel 那种 style="padding:0" 是同族缺陷 A-23 的形态，不是范本）。
//
// nesting 两种成对形态都接受（label 包 group / group 包 label）：app.wxss:358 的注释写明
// 「勾选框由 checkbox-group 承载 change 时，group 是 .check-label 的直接 flex 子元素，行为与裸
// checkbox 一致」，仓内现成两种都有（roster-panel.wxml:31-34 与 field-panel.wxml:20-25）。
// 判据只认「勾选框与文案同在一个 label.check-label 内」这个**关系**，不认某一种写法——
// 把门钉在源码文本上，合法重构就会假红（铁律 30①）。等价性由 mutate 的 K3 对照证明它真的不红。
//
// 影子/变异接缝：三个入口文件路径可用环境变量覆盖（tools/b4-e05-checklabel-mutate.js 依赖它，
// 在 %TEMP% 沙盒里改副本），缺省指向仓库真实文件。本脚本不 require 任何其它测试的私有夹具。
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
function repo() { return path.join.apply(path, [ROOT].concat([].slice.call(arguments))) }
const WXML = process.env.B4E05_WXML || repo('miniprogram', 'pages', 'route', 'route.wxml')
const PAGE_JS = process.env.B4E05_PAGE_JS || repo('miniprogram', 'pages', 'route', 'route.js')
const WXSS = process.env.B4E05_WXSS || repo('miniprogram', 'app.wxss')

let passed = 0
const failedNames = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failedNames.push(name); console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const LABEL_TEXT = '按出发时刻推算'   // 这一行的文案（判据锚点）
const HANDLER = 'onScheduleMode'      // 该页真实 handler
const INLINE_STYLE_BASELINE = 15      // 改前实测：route.wxml 的 style= 数；只许变少（A-23 在收），变大即红

// ============ 最小 WXML 解析器（自带实现，不复用别处私有夹具） ============
function countNewlines(s) { return (String(s).match(/\n/g) || []).length }
function parse(source) {
  const root = { tag: '#root', attrs: {}, children: [], line: 1 }
  const stack = [root]
  let i = 0
  let line = 1
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) {
      const tail = source.slice(i)
      line += countNewlines(tail)
      if (tail.length) stack[stack.length - 1].children.push({ tag: '#text', text: tail, line: line })
      break
    }
    const pending = source.slice(i, lt)
    line += countNewlines(pending)
    if (pending.length) stack[stack.length - 1].children.push({ tag: '#text', text: pending, line: line })
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt)
      if (end === -1) break
      line += countNewlines(source.slice(lt, end + 3))
      i = end + 3
      continue
    }
    if (source[lt + 1] === '/') {
      const gt = source.indexOf('>', lt)
      if (stack.length > 1) stack.pop()
      line += countNewlines(source.slice(lt, gt === -1 ? source.length : gt + 1))
      i = gt === -1 ? source.length : gt + 1
      continue
    }
    let j = lt + 1
    const nm = /^[A-Za-z0-9_-]+/.exec(source.slice(j))
    if (!nm) { i = lt + 1; continue }
    const tag = nm[0]
    j += tag.length
    const attrs = {}
    let selfClose = false
    while (j < source.length) {
      while (j < source.length && /\s/.test(source[j])) { if (source[j] === '\n') line++; j++ }
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
      while (j < source.length && /\s/.test(source[j])) { if (source[j] === '\n') line++; j++ }
      let val = ''
      if (source[j] === '=') {
        j++
        while (j < source.length && /\s/.test(source[j])) { if (source[j] === '\n') line++; j++ }
        const q = source[j]
        if (q === '"' || q === "'") {
          const close = source.indexOf(q, j + 1)
          val = source.slice(j + 1, close === -1 ? source.length : close)
          line += countNewlines(source.slice(j, close === -1 ? source.length : close))
          j = close === -1 ? source.length : close + 1
        } else {
          const bare = /^[^\s>]*/.exec(source.slice(j))
          val = bare[0]
          j += val.length
        }
      }
      attrs[key] = val
    }
    const node = { tag: tag, attrs: attrs, children: [], line: line }
    stack[stack.length - 1].children.push(node)
    i = j
    if (!selfClose) stack.push(node)
  }
  return root
}

// ============ 求值（渲染可达性模型：这份数据下，这个节点在不在屏幕上） ============
const KEYWORDS = ['true', 'false', 'null', 'undefined', 'typeof', 'new', 'in', 'of']
const EVAL_ERRORS = []
function stripLiterals(expr) { return String(expr).replace(/'[^']*'|"[^"]*"/g, '""') }
function rootsOf(expr) {
  const s = stripLiterals(expr)
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
  const out = []
  let m
  while ((m = re.exec(s))) {
    if (KEYWORDS.indexOf(m[0]) === -1 && out.indexOf(m[0]) === -1) out.push(m[0])
  }
  return out
}
function safeEval(expr, data, where) {
  const undeclared = rootsOf(expr).filter(function (n) { return !(n in data) })
  const prelude = undeclared.map(function (n) { return 'var ' + n + ' = undefined;' }).join('')
  try {
    return { ok: true, value: new Function('d', prelude + 'with (d) { return (' + expr + ') }')(data) }
  } catch (e) {
    EVAL_ERRORS.push(where + ': ' + expr + ' → ' + ((e && e.message) || e))
    return { ok: false, value: undefined }
  }
}
function rawExpr(v) {
  if (typeof v !== 'string') return null
  const m = v.match(/^\s*\{\{([\s\S]*)\}\}\s*$/)
  return m ? m[1] : null
}
function asString(val) { return val === undefined || val === null ? '' : String(val) }
function resolveAttr(v, data, where) {
  const whole = rawExpr(v)
  if (whole !== null) return asString(safeEval(whole, data, where).value)
  return String(v).replace(/\{\{([\s\S]*?)\}\}/g, function (_a, expr) {
    return asString(safeEval(expr, data, where).value)
  })
}
function resolveText(text, data, where) {
  return String(text).replace(/\{\{([\s\S]*?)\}\}/g, function (_a, expr) {
    return asString(safeEval(expr, data, where).value)
  })
}

// ============ 渲染：wx:if/elif/else 链 + wx:for（展开每一项，不只取第一项） ============
function condOf(node) {
  if ('wx:if' in node.attrs) return { kind: 'if', expr: node.attrs['wx:if'] }
  if ('wx:elif' in node.attrs) return { kind: 'elif', expr: node.attrs['wx:elif'] }
  if ('wx:else' in node.attrs) return { kind: 'else', expr: null }
  return null
}
function truthy(expr, data, where) {
  const code = rawExpr(expr) === null ? expr : rawExpr(expr)
  const r = safeEval(code, data, where)
  return !!r.value
}
function expand(node, data) {
  if (!('wx:for' in node.attrs)) return [data]
  const code = rawExpr(node.attrs['wx:for']) || node.attrs['wx:for']
  const arr = safeEval(code, data, 'wx:for').value
  const list = Array.isArray(arr) ? arr : []
  const itemName = node.attrs['wx:for-item'] || 'item'
  const indexName = node.attrs['wx:for-index'] || 'index'
  return list.map(function (v, i) {
    const d = Object.assign({}, data)
    d[itemName] = v
    d[indexName] = i
    return d
  })
}
function renderChildren(children, data, parent) {
  const out = []
  let chain = false   // 当前是否正处在一条 wx:if 链里（wx:elif/wx:else 只在链内才有意义）
  let taken = false   // 这条链已经被哪个分支命中
  for (const c of children) {
    if (c.tag === '#text') {
      // 纯空白/缩进不切断条件链（WXML 里 <view wx:if> 与 <block wx:elif> 之间永远隔着缩进换行）
      if (c.text.trim() !== '') { chain = false; taken = false }
      out.push({ tag: '#text', text: resolveText(c.text, data, 'text'), attrs: {}, res: {}, children: [], parent: parent, line: c.line })
      continue
    }
    const items = expand(c, data)
    const cond = condOf(c)
    if (!cond) { chain = false; taken = false }
    for (const itemData of items) {
      let include = true
      if (cond) {
        if (cond.kind === 'if') {
          taken = truthy(cond.expr, itemData, 'wx:if')
          chain = true
          include = taken
        } else if (cond.kind === 'elif') {
          if (!chain) include = true                       // 没有前置 wx:if，按普通节点处理
          else if (taken) include = false                   // 上游已命中 ⇒ 本支不出
          else { taken = truthy(cond.expr, itemData, 'wx:elif'); include = taken }
        } else {
          include = chain ? !taken : true
          if (include) taken = true
        }
      }
      if (!include) continue
      out.push(renderEl(c, itemData, parent))
    }
  }
  return out
}
function renderEl(node, data, parent) {
  const res = {}
  for (const k in node.attrs) {
    if (k.indexOf('wx:') === 0) continue
    res[k] = resolveAttr(node.attrs[k], data, k)
  }
  const out = { tag: node.tag, attrs: node.attrs, res: res, children: [], parent: parent, line: node.line }
  out.children = renderChildren(node.children, data, out)
  return out
}

// ============ 树查询 ============
function walk(node, fn) { fn(node); const kids = node.children || []; for (const c of kids) walk(c, fn) }
function elements(root) {
  const out = []
  walk(root, function (n) { if (n.tag !== '#root' && n.tag !== '#text') out.push(n) })
  return out
}
function descendants(n) {
  const out = []
  walk(n, function (x) { if (x !== n) out.push(x) })
  return out
}
function classesOf(n) {
  const raw = n.res.class !== undefined ? n.res.class : (n.attrs.class || '')
  return String(raw).split(/\s+/).filter(Boolean)
}
function hasClass(n, cls) { return !!n && classesOf(n).indexOf(cls) !== -1 }
function ancestors(n) {
  const out = []
  let p = n.parent
  while (p) { out.push(p); p = p.parent }
  return out
}
function visibleTexts(root) {
  const out = []
  walk(root, function (n) { if (n.tag === '#text' && n.text.trim() !== '') out.push(n) })
  return out
}
function eventKeys(n) {
  return Object.keys(n.attrs).filter(function (k) { return /^(capture-)?(bind|catch):?[A-Za-z]/.test(k) })
}

// ============ 目标定位：按「装着 schedule 勾选框的那个 group」找，不按事件属性找 ============
// 这样即使把 bindchange 挪到别处（变异 M2），目标仍然定位得到，红的就是归属那条断言本身，
// 而不是「找不到目标所以全都红」。
function scheduleCheckbox(group) {
  const boxes = descendants(group).filter(function (n) {
    return n.tag === 'checkbox' && String(n.res.value || '') === 'schedule'
  })
  return boxes.length === 1 ? boxes[0] : null
}
function findGroup(root) {
  const gs = elements(root).filter(function (n) { return n.tag === 'checkbox-group' && scheduleCheckbox(n) })
  return gs.length === 1 ? gs[0] : null
}
function findLabel(node) {
  const ls = ancestors(node).filter(function (n) { return n.tag === 'label' })
  return ls.length ? ls[0] : null
}
function textCarrier(root, text) {
  const hits = visibleTexts(root).filter(function (t) { return t.text.indexOf(text) !== -1 })
  return hits.length === 1 ? hits[0].parent : null
}
function bareTextChildren(n) {
  return n.children.filter(function (t) { return t.tag === '#text' && t.text.trim() !== '' })
}
function renderWith(data) { return renderEl(parse(fs.readFileSync(WXML, 'utf8')), data, null) }

// ============ 数据形态 ============
function baseData() {
  return {
    denied: '', loading: false, error: '', isOwner: false, scheduleMode: false,
    wxDate: '2026-10-14', wxDateMax: '2026-10-28', startDate: '', startTime: '',
    weatherBusy: false, weatherError: '', shareOpen: false, shareError: '', shareCode: '',
    removeId: '', deleteOpen: false, busy: false,
    map: { visible: false },
    route: {
      title: '测试路线', sourceText: 'GPX 导入', updatedText: '2026-10-14', visibility: 'private',
      distanceKm: 12.4, ascentM: 640, track: [],
      points: [
        { id: 'p1', name: '起点', kind: 'start', ele: 1200, coordinates: { lat: 30, lng: 103 } },
        { id: 'p2', name: '垭口', kind: 'checkpoint', ele: 2500, coordinates: null },
      ],
      risks: [{ id: 'r1', title: '碎石坡', severityText: '中', severityBadge: 'warning', advice: '注意落石' }],
      sharedWith: [],
    },
    nodeWeather: [
      { id: 'p1', name: '起点', status: 'ready', targetDate: '2026-10-14', phrase: '多云', tMin: 8, tMax: 16, precip: 0.2, precipProb: 30, wind: 12, arriveLabel: '第 1 天 08:00' },
      { id: 'p2', name: '垭口', status: 'no-coords', arriveLabel: '无时间信息' },
    ],
    referenced: [{ id: 'a1', title: '周末徒步' }],
  }
}
function variants() {
  const off = baseData()
  const on = baseData()
  on.scheduleMode = true
  on.startDate = '2026-10-15'
  on.startTime = '08:00'
  const owner = baseData()
  owner.isOwner = true
  owner.route.visibility = 'shared'
  owner.route.sharedWith = ['U0001']
  owner.busy = true
  return [{ tag: '推算关', data: off }, { tag: '推算开', data: on }, { tag: 'owner视角', data: owner }]
}

// ================= 开跑 =================
function main() {
  const wxmlSrc = fs.readFileSync(WXML, 'utf8')
  const pageJsSrc = fs.readFileSync(PAGE_JS, 'utf8')
  const wxssSrc = fs.readFileSync(WXSS, 'utf8')
  const rawRoot = parse(wxmlSrc)

  section('A 夹具有效性（先证明模型真的定位到这一行，红项才归因得清楚；铁律 33⑧/34⑥）')
  const v0 = renderWith(baseData())
  const g0 = findGroup(v0)
  const box0 = g0 ? scheduleCheckbox(g0) : null
  const carrier0 = textCarrier(v0, LABEL_TEXT)
  check('A1 加载态渲染树里恰有 1 个装着 value="schedule" 勾选框的 checkbox-group', !!g0)
  check('A2 该 group 内的勾选框定位成功（目标控件存在）', !!box0)
  check('A3 文案「' + LABEL_TEXT + '」此刻在渲染树上（不是被条件挡掉的分支）',
    !!carrier0 && visibleTexts(v0).some(function (t) { return t.text.indexOf(LABEL_TEXT) !== -1 }))
  check('A4 渲染过程零求值失败（夹具字段与模板用法对齐；缺字段会让门假绿）',
    EVAL_ERRORS.length === 0, EVAL_ERRORS.slice(0, 3).join(' | '))
  const deniedData = baseData()
  deniedData.denied = '这条路线不属于你。'
  const loadingData = baseData()
  loadingData.loading = true
  check('A5 反向对照：denied 态下这一行不在屏幕上（模型是条件渲染，不是全量解析源码）',
    !findGroup(renderWith(deniedData)))
  check('A6 反向对照：loading 态下这一行不在屏幕上', !findGroup(renderWith(loadingData)))
  const onData = baseData()
  onData.scheduleMode = true
  const gOn = findGroup(renderWith(onData))
  const boxOn = gOn ? scheduleCheckbox(gOn) : null
  check('A7 checked 走的是页面数据本身：scheduleMode=false ⇒ "false"，=true ⇒ "true"',
    !!box0 && String(box0.res.checked) === 'false' && !!boxOn && String(boxOn.res.checked) === 'true',
    '实得 off=' + (box0 ? box0.res.checked : 'n/a') + ' on=' + (boxOn ? boxOn.res.checked : 'n/a'))

  section('B 触点结构：可点容器 = label.check-label，文案节点 = text.check-text（3 个数据形态各测）')
  for (const v of variants()) {
    const root = renderWith(v.data)
    const g = findGroup(root)
    const box = g ? scheduleCheckbox(g) : null
    const lab = box ? findLabel(box) : null
    const carrier = textCarrier(root, LABEL_TEXT)
    const t = 'B[' + v.tag + ']'
    check(t + ' 勾选框的可点容器是 <label>（不是裸控件旁挂文本）', !!lab)
    check(t + ' 该 label 的 class 含 check-label（复用设计系统的整行触点）', hasClass(lab, 'check-label'))
    check(t + ' 勾选框确在这个 label 的子树内（label 的命中区覆盖它）',
      !!lab && !!box && descendants(lab).indexOf(box) !== -1)
    check(t + ' 承载文案的是元素节点而不是裸文本（父节点不是 group 本身）',
      !!carrier && carrier !== g)
    check(t + ' 文案节点是 <text> 且 class 含 check-text（flex:1 才撑满整行）',
      !!carrier && carrier.tag === 'text' && hasClass(carrier, 'check-text'))
    check(t + ' 文案节点是该 label 的**子节点**（不是 label 的兄弟、不是 group 的文本兄弟）',
      !!lab && !!carrier && carrier.parent === lab)
    check(t + ' checkbox-group 的直接子节点里没有裸文本（缺陷本体形态已消失）',
      !g || bareTextChildren(g).length === 0,
      g ? bareTextChildren(g).map(function (x) { return JSON.stringify(x.text.trim()) }).join(' / ') : 'group 未定位')
    const allGroups = elements(root).filter(function (n) { return n.tag === 'checkbox-group' || n.tag === 'radio-group' })
    const strays = allGroups.reduce(function (acc, n) { return acc.concat(bareTextChildren(n)) }, [])
    check(t + ' 本页**任何** group/radio-group 都不许挂裸文本（同类遗漏新增即红，不是一次性门）',
      strays.length === 0, strays.map(function (x) { return JSON.stringify(x.text.trim()) }).join(' / '))
    const wrongCarriers = visibleTexts(root).filter(function (x) {
      if (x.text.indexOf(LABEL_TEXT) === -1) return false
      const c = x.parent
      return !(c.tag === 'text' && hasClass(c, 'check-text'))
    })
    check(t + ' 该文案在屏幕上只出现在 text.check-text 里（再打印一遍裸文本即红）',
      wrongCarriers.length === 0, wrongCarriers.map(function (x) { return '<' + x.parent.tag + '>' }).join(' / '))
  }

  section('C 事件归属：change 的载体仍是 checkbox-group，且解析到真实 handler')
  check('C1 bindchange 就在该 checkbox-group 上且值为 ' + HANDLER + '（载体没挪走）',
    !!g0 && g0.attrs.bindchange === HANDLER, '实得 ' + (g0 ? String(g0.attrs.bindchange) : 'n/a'))
  const carriers = [box0, findLabel(box0), carrier0].filter(Boolean)
  const moved = carriers.filter(function (n) {
    return eventKeys(n).some(function (k) { return /change|tap/.test(k) })
  })
  check('C2 label / text / checkbox 上没有任何 change|tap 绑定（事件发出位置没被改）',
    moved.length === 0, moved.map(function (n) { return '<' + n.tag + ' ' + eventKeys(n).join(',') + '>' }).join(' / '))
  const gEvents = g0 ? eventKeys(g0) : []
  check('C3 该 group 只带 bindchange 一个事件绑定（没有第二个平行载体）',
    gEvents.length === 1 && gEvents[0] === 'bindchange', '实得 ' + JSON.stringify(gEvents))
  check('C4 handler ' + HANDLER + ' 在该页 route.js 真实定义（读文件核对，不跑公共闸）',
    new RegExp('(^|\\n)\\s*' + HANDLER + '\\s*[(:]').test(pageJsSrc))
  const hIdx = pageJsSrc.indexOf(HANDLER)
  const body = hIdx === -1 ? '' : pageJsSrc.slice(hIdx, hIdx + 400)
  check('C5 handler 取的是 group 的数组语义 e.detail.value（platform-pitfalls「checkbox-group / picker 的取值」条，不靠 checked 回读）',
    body.indexOf('detail.value') !== -1)
  const orphans = orphanHandlers(rawRoot, pageJsSrc)
  check('C6 本文件全部静态 bind*/catch* handler 都能在 route.js 解析到（改名/悬空即红）',
    orphans.length === 0, '悬空：' + orphans.join(', '))

  section('D 没有新增内联 style（整行触点来自 .check-label 体系，不靠 style 覆盖）')
  const rowNodes = [g0, box0, findLabel(box0), carrier0].filter(Boolean)
  const styled = rowNodes.filter(function (n) { return 'style' in n.attrs })
  check('D1 这一行的 group/checkbox/label/text 四个节点都没有 style 属性',
    styled.length === 0, styled.map(function (n) { return '<' + n.tag + ' style="' + n.attrs.style + '">' }).join(' / '))
  const inlineCount = (wxmlSrc.match(/\sstyle=/g) || []).length
  check('D2 全页 style= 计数 ≤ 改前基线 ' + INLINE_STYLE_BASELINE + '（单向门：A-23 收内联 style 只会让它变小）',
    inlineCount <= INLINE_STYLE_BASELINE, '实得 ' + inlineCount)
  const badLabels = elements(v0).filter(function (n) { return hasClass(n, 'check-label') && 'style' in n.attrs })
  check('D3 本页任何 .check-label 都不许带内联 style（roster-panel 的 style="padding:0" 是 A-23 同族，不是范本）',
    badLabels.length === 0)
  check('D4 没有为本行发明新类名：文案用的就是 app.wxss 里那个 check-text',
    hasClass(carrier0, 'check-text') && hasClass(findLabel(box0), 'check-label'))

  section('E 引用的类是设计系统里现成的（不是 invented token；读 app.wxss，不写它）')
  check('E1 app.wxss 定义了 .check-label 规则', /\.check-label\s*\{/.test(wxssSrc))
  check('E2 .check-label 的 min-height 吃 var(--touch-target)（不是写死字面量）',
    /\.check-label\s*\{[^}]*min-height:\s*var\(--touch-target\)/.test(wxssSrc))
  const tt = touchTargetPx(wxssSrc)
  check('E3 --touch-target 终值 ≥ 44px（44px 下限的静态那一半；像素那一半见 runtime-required.md）',
    tt >= 44, '实得 ' + tt)
  check('E4 .check-label .check-text 的 flex: 1 存在（文案撑满 = 整行可点的依据）',
    /\.check-label \.check-text\s*\{[^}]*flex:\s*1/.test(wxssSrc))
  check('E5 group 作为 .check-label 子元素也有 flex 规则（两种嵌套形态都由体系承载，不是巧合）',
    /\.check-label checkbox-group\s*\{/.test(wxssSrc))

  console.log('\npassed=' + passed + ' failed=' + failedNames.length)
  if (failedNames.length) console.log('failed: ' + failedNames.join(' | '))
  process.exit(failedNames.length ? 1 : 0)
}

// 本页所有静态事件绑定的 handler 是否都在页面 JS 里定义（check-handlers.js 的思路，
// 但只看这一个文件，且只认标识符形态的值；bind:xxx="{{''}}" 这类动态名不在本门范围）。
function orphanHandlers(rawTree, jsSrc) {
  const out = []
  const seen = {}
  walk(rawTree, function (n) {
    if (n.tag === '#text' || n.tag === '#root') return
    for (const k of eventKeys(n)) {
      const v = n.attrs[k]
      if (rawExpr(v) !== null || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(v))) continue
      if (seen[v]) continue
      seen[v] = true
      if (!new RegExp('(^|\\n)\\s*' + v + '\\s*[(:]').test(jsSrc)) out.push(k + '="' + v + '"@' + n.line)
    }
  })
  return out
}
function touchTargetPx(wxssSrc) {
  const m = /--touch-target:\s*(\d+(?:\.\d+)?)px/.exec(wxssSrc)
  return m ? parseFloat(m[1]) : -1
}

main()
