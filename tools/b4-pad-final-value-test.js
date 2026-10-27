'use strict'
// B4-PAD — 页面底部留白的**终值**判据（铁律 30：钉行为，不钉源码文本）
//
// 判据形态为什么必须是这样：
//   决定像素的是「这个根节点在层叠之后拿到什么 padding-bottom」，不是「哪一行写了 calc(...)」。
//   所以本文件先把 app.wxss + 该页自己的 wxss 解析成规则与声明，按选择器匹配根节点、按特异度与
//   书写次序（app.wxss 整体在页样式表之前）解出每个属性的**赢家**，把 padding 简写展开成长方值，
//   再把 var()/calc() 归成一个可比的数值形态（px 之和 + 是否含安全区），最后只对那个数值下判断。
//   类名出现了几次、某行注释有没有被改写、公式抄在哪个文件——一律只作读数，不作判据（铁律 21）。
//
// 「tab 页 / 非 tab 页」的分组不靠印象：tabBar 名单从 app.json 的 tabBar.list 现场读出（§1）。
// 「该留多少」也不抄 84 这个数：下界由**遮挡物自己的声明**算出来（custom-tab-bar/index.wxss 的
//   padding-top + padding-bottom(含安全区) + border-top + .tab 的 min-height），
//   所以把留白改小到盖不住底栏一定会红（§7 方向 C 就是这一条的实证）。
//
// 覆盖的三件事（批次 4 派单 B4-PAD）：
//   ① 五份复制的收敛结果：四条 tab 页载体必须**互相同构**且等于文档登记的那一条规则（漂移即红）；
//      非 tab 页一律回落 app.wxss 基线，且**赢家来源必须是 app.wxss**（页级抄一份即红）。
//   ② M-18 / E-03：anotices 是 navigateTo 子页，吃了 84px tab 留白 ⇒ 本轮删掉那份覆盖（T3.3）。
//   ③ home.wxml 根节点的条件类 with-tabbar：用「加上该类后终值集合有没有变化」证明它是空开关，
//      并把「tab 页的每个可达根类分支都必须留够」钉成行为门（T2.5/T7.3）——这条正是
//      「给假开关补唯一定义并把 5 份收进它」那条路的代价：home 空状态那一支会失去留白。
//
// 运行：node tools/b4-pad-final-value-test.js
// 沙盒复跑（变异自证用）：B4PAD_MP=<沙盒 miniprogram 目录> B4PAD_DOC=<沙盒 design-system.md> node ...
// 退出码：0 全绿；1 有断言红。变异自证见 tools/b4-pad-final-value-mutate.js。

const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
const failures = []
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else {
    failed++
    const line = '  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')
    console.log(line); failures.push(line.trim())
  }
}
function section (t) { console.log('== ' + t + ' ==') }
function note (t) { console.log('    · ' + t) }

const ROOT = path.resolve(__dirname, '..')
const MP = process.env.B4PAD_MP || path.join(ROOT, 'miniprogram')
const DOC = process.env.B4PAD_DOC || path.join(ROOT, '.agents', 'skills', 'ourtrail-ui', 'references', 'design-system.md')
const REFS = process.env.B4PAD_REFS || path.join(ROOT, '.agents', 'skills', 'ourtrail-ui', 'references')

/* ============================ 解析层（自研，不引用别人套件的私有夹具） ============================ */
function stripComments (css) { return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) }
function splitTop (val) {
  const out = []
  let cur = ''
  let depth = 0
  for (const ch of String(val)) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) { if (cur) { out.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}
// 只展开本判据要用到的简写：padding 四边、border-top / border 的宽度。其余原样透传。
function expand (prop, val) {
  const p = prop.toLowerCase()
  const v = splitTop(val)
  if (p === 'padding') {
    if (v.length === 1) return [['padding-top', v[0]], ['padding-right', v[0]], ['padding-bottom', v[0]], ['padding-left', v[0]]]
    if (v.length === 2) return [['padding-top', v[0]], ['padding-right', v[1]], ['padding-bottom', v[0]], ['padding-left', v[1]]]
    if (v.length === 3) return [['padding-top', v[0]], ['padding-right', v[1]], ['padding-bottom', v[2]], ['padding-left', v[1]]]
    if (v.length >= 4) return [['padding-top', v[0]], ['padding-right', v[1]], ['padding-bottom', v[2]], ['padding-left', v[3]]]
    return []
  }
  if (p === 'border-top' || p === 'border') {
    const w = v.find(x => /^-?\d*\.?\d+(px|em|rem|%)$/.test(x))
    if (!w) return []
    return p === 'border-top' ? [['border-top-width', w]] : [['border-top-width', w], ['border-bottom-width', w]]
  }
  return [[p, val]]
}
function parseDecls (body) {
  const out = []
  body.split(';').forEach(chunk => {
    const s = chunk.trim()
    if (!s) return
    const i = s.indexOf(':')
    if (i < 0) return
    expand(s.slice(0, i).trim(), s.slice(i + 1).trim()).forEach(pair => out.push({ prop: pair[0], val: pair[1] }))
  })
  return out
}
function specificity (sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length
  const b = (sel.match(/\[[^\]]+\]/g) || []).length + (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/:[\w-]+/g) || []).length
  const c = (sel.replace(/::[\w-]+/g, '').match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length
  return { ids, b, c }
}
function cmpSpec (a, b) { return (a.ids - b.ids) || (a.b - b.b) || (a.c - b.c) }
function compoundOf (part) {
  return {
    classes: (part.match(/\.[\w-]+/g) || []).map(s => s.slice(1)),
    tag: /^([a-zA-Z][\w-]*)/.test(part) ? part.match(/^([a-zA-Z][\w-]*)/)[1] : null
  }
}
function parse (css, source) {
  const text = stripComments(css)
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let order = 0
  let m
  while ((m = re.exec(text)) !== null) {
    const selText = m[1].trim().replace(/\s+/g, ' ')
    if (!selText || selText[0] === '@') continue
    selText.split(',').forEach(raw => {
      const sel = raw.trim()
      if (!sel) return
      const compounds = sel.split(/\s+/).filter(Boolean).map(compoundOf)
      parseDecls(m[2]).forEach(d => rules.push({
        sel, compounds, spec: specificity(sel), prop: d.prop, val: d.val, order: order++, source
      }))
    })
  }
  const tokens = {}
  rules.filter(r => r.sel === 'page' && /^--/.test(r.prop)).forEach(r => { tokens[r.prop] = r.val })
  return { rules, tokens, source }
}
// 根节点只能被**单 compound** 选择器匹配（后代选择器要祖先链）。§1 T1.6 现场核对全仓没有 `.x .page` 这种形态。
function matchesNode (compounds, node) {
  if (compounds.length !== 1) return false
  const c = compounds[0]
  if (c.tag && c.tag !== node.tag) return false
  return c.classes.length > 0 && c.classes.every(x => node.classes.indexOf(x) !== -1)
}
function cascade (parsedList, node) {
  const best = {}
  parsedList.forEach((parsed, fileRank) => parsed.rules.forEach(r => {
    if (r.prop.indexOf('--') === 0) return
    if (!matchesNode(r.compounds, node)) return
    const cur = best[r.prop]
    const win = !cur || cmpSpec(r.spec, cur.spec) > 0 ||
      (cmpSpec(r.spec, cur.spec) === 0 && (fileRank > cur.fileRank || (fileRank === cur.fileRank && r.order > cur.order)))
    if (win) best[r.prop] = { val: r.val, sel: r.sel, source: r.source, spec: r.spec, order: r.order, fileRank }
  }))
  return best
}
function resolveVars (val, tokens, depth) {
  depth = depth || 0
  if (depth > 8) return { raw: String(val), unresolved: true }
  const one = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(String(val).trim())
  if (one) {
    const hit = tokens[one[1]]
    if (hit === undefined) return one[2] === undefined ? { raw: String(val), unresolved: true } : resolveVars(one[2], tokens, depth + 1)
    return resolveVars(hit, tokens, depth + 1)
  }
  let unresolved = false
  const out = String(val).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*[^()]*)?\)/g, (all, name, fb) => {
    if (tokens[name] !== undefined) { const r = resolveVars(tokens[name], tokens, depth + 1); if (r.unresolved) unresolved = true; return r.raw }
    if (fb !== undefined) return fb.replace(/^\s*,\s*/, '')
    unresolved = true
    return all
  })
  return unresolved ? { raw: out, unresolved: true } : { raw: out }
}
// padding-bottom 的终值归一：px 之和 + 是否吃安全区 + 有没有算不了的项（算不了就明说，绝不猜）
function measure (map, prop, tokens) {
  const d = map && map[prop]
  if (!d) return { missing: true }
  const r = resolveVars(d.val, tokens)
  if (r.unresolved) return { unresolved: true, raw: String(r.raw), sel: d.sel, source: d.source }
  const v = String(r.raw).trim()
  const safe = /env\(\s*safe-area-inset-bottom\b/i.test(v)
  const stripped = v.replace(/env\([^()]*\)/gi, '').replace(/-?\d*\.?\d+px/gi, '').replace(/\bcalc\b/gi, '').replace(/[\s+\-*/(),]/g, '')
  const pxs = (v.match(/-?\d*\.?\d+px/gi) || []).map(x => parseFloat(x))
  if (stripped.length || pxs.some(Number.isNaN)) return { unmodeled: true, raw: v, sel: d.sel, source: d.source }
  return { px: pxs.reduce((a, b) => a + b, 0), safe, raw: v, sel: d.sel, source: d.source }
}
function fmt (m) {
  if (!m || m.missing) return '无声明'
  if (m.unresolved) return '悬空 var(' + m.raw + ')'
  if (m.unmodeled) return '算不了(' + m.raw + ')'
  return m.px + 'px' + (m.safe ? ' + 安全区' : '') + ' ← ' + (m.source || '文档') + ' [' + (m.sel || '注册表') + ']'
}
function sameValue (a, b) {
  if (!a || !b) return false
  if (a.missing !== b.missing || a.unresolved !== b.unresolved || a.unmodeled !== b.unmodeled) return false
  if (a.missing || a.unresolved || a.unmodeled) return true
  return a.px === b.px && a.safe === b.safe
}

/* ============================ 读取输入 ============================ */
function rd (p) { return fs.readFileSync(p, 'utf8') }
const docText = fs.existsSync(DOC) ? rd(DOC) : ''
if (!fs.existsSync(DOC)) console.log('IO 警告：缺少注册表文档 ' + DOC)

/* ============================ 模型层（合成违例复用同一套判据） ============================ */
function rootClassAttr (wxml) {
  const text = String(wxml).replace(/<!--[\s\S]*?-->/g, ' ')
  const m = /<([a-zA-Z][\w-]*)[^>]*\bclass="([^"]*)"/.exec(text)
  if (!m) return null
  return { tag: m[1], attr: m[2] }
}
// 根节点 class 的可达分支：静态类 + 每个 {{ }} 里出现过的字符串字面量类名的幂集（≤3 个候选 ⇒ ≤8 支）
function branchesOf (attr) {
  const staticPart = attr.replace(/\{\{[\s\S]*?\}\}/g, ' ')
  const base = staticPart.split(/[\s,'"`]+/).filter(x => /^[a-zA-Z][\w-]*$/.test(x))
  const cands = []
  ;(attr.match(/\{\{[\s\S]*?\}\}/g) || []).forEach(expr => {
    ;(expr.match(/['"]([^'"]*)['"]/g) || []).forEach(q => {
      q.slice(1, -1).split(/[\s,]+/).forEach(c => {
        if (/^[a-zA-Z][\w-]*$/.test(c) && cands.indexOf(c) === -1) cands.push(c)
      })
    })
  })
  const combos = [[]]
  cands.slice(0, 3).forEach(c => combos.slice().forEach(set => combos.push(set.concat([c]))))
  return combos.map(set => ({
    label: set.length ? '+' + set.join('+') : '(无附加类)',
    classes: base.concat(set).filter((x, i, a) => a.indexOf(x) === i)
  }))
}
function buildModel (opts) {
  opts = opts || {}
  const app = parse(opts.appCss !== undefined ? opts.appCss : rd(path.join(MP, 'app.wxss')), 'app.wxss')
  const tabbar = parse(opts.tabCss !== undefined ? opts.tabCss : rd(path.join(MP, 'custom-tab-bar', 'index.wxss')), 'custom-tab-bar/index.wxss')
  const tokens = app.tokens
  const json = opts.appJson || JSON.parse(rd(path.join(MP, 'app.json')))
  const list = ((json.tabBar && json.tabBar.list) || []).map(x => x.pagePath)
  const tabDirs = new Set(list.map(p => p.split('/')[1]))
  const pagesDir = path.join(MP, 'pages')
  const dirs = (opts.dirs && Array.from(opts.dirs)) || fs.readdirSync(pagesDir).filter(d => fs.existsSync(path.join(pagesDir, d, d + '.wxss')))
  const pages = dirs.map(d => {
    const cssText = opts.pageCss && opts.pageCss[d] !== undefined ? opts.pageCss[d] : rd(path.join(pagesDir, d, d + '.wxss'))
    const wxmlPath = path.join(pagesDir, d, d + '.wxml')
    const wxml = opts.wxml && opts.wxml[d] !== undefined ? opts.wxml[d] : (fs.existsSync(wxmlPath) ? rd(wxmlPath) : '')
    return describePage(d, cssText, wxml, tokens, app, tabbar, tabDirs)
  })
  return { app, tabbar, tokens, pages, tabDirs, list, docText: opts.docText !== undefined ? opts.docText : docText }
}
function describePage (dir, cssText, wxml, tokens, app, tabbar, tabDirs) {
  const own = parse(cssText, 'pages/' + dir + '/' + dir + '.wxss')
  const sources = [app, own]
  const root = rootClassAttr(wxml)
  const tag = root ? root.tag : 'view'
  const clean = String(wxml).replace(/<!--[\s\S]*?-->/g, ' ')
  const usesFixedBar = /class="[^"]*\bsticky-action\b/.test(clean)
  const brs = root ? branchesOf(root.attr) : []
  const branches = brs.map(b => {
    const map = cascade(sources, { classes: b.classes, tag })
    return { label: b.label, classes: b.classes, map, bottom: measure(map, 'padding-bottom', tokens) }
  })
  // 「这个条件类到底改不改变终值」＝ 拿掉它前后整个赢家映射逐字相同 ⇒ 它就是空开关（不 grep 定义）
  const inert = []
  branches.forEach(b => {
    b.classes.forEach(c => {
      if (c === 'page' || c === 'container' || c === 'fc') return
      const mA = cascade(sources, { classes: b.classes.filter(x => x !== c), tag })
      const mB = b.map
      const props = Object.keys(mA).concat(Object.keys(mB)).filter((x, i, a) => a.indexOf(x) === i)
      const identical = props.every(p => String((mA[p] || {}).val) === String((mB[p] || {}).val) &&
        String((mA[p] || {}).source) === String((mB[p] || {}).source))
      const selected = Object.keys(mB).some(p => String((mB[p] || {}).sel).indexOf(c) !== -1)
      if (identical && !selected && inert.indexOf(c) === -1) inert.push(c)
    })
  })
  return {
    dir,
    cssText,
    root: root ? root.attr : null,
    hasPageClass: !!(root && /(^|[\s'"])page([\s'"]|$)/.test(root.attr)),
    usesFixedBar,
    isTab: tabDirs.has(dir),
    branches,
    inert,
    ownRules: own.rules
  }
}
// 遮挡物自己占多高：由 custom-tab-bar/index.wxss 的声明算，不抄 84 这个数
function barBox (model) {
  const root = cascade([model.tabbar], { classes: ['tabbar'], tag: 'view' })
  const tab = cascade([model.tabbar], { classes: ['tab'], tag: 'view' })
  const parts = ['padding-top', 'padding-bottom', 'border-top-width'].map(p => measure(root, p, model.tokens))
  const minH = measure(tab, 'min-height', model.tokens)
  if (parts.concat([minH]).some(p => !p || p.missing || p.unresolved || p.unmodeled)) return { unknown: true }
  return { px: parts.reduce((a, p) => a + p.px, 0) + minH.px, safe: parts.some(p => p.safe), raw: parts.map(p => p.raw).join(' | ') + ' | ' + minH.raw }
}
// 注册表里那条被写成完整声明的公式（全仓唯一一处）
function docRule (model) {
  const line = (String(model.docText).split(/\r?\n/).filter(l => /^-\s+\*\*公式\*\*：/.test(l))[0]) || ''
  const m = /`([^`]*padding-bottom[^`]*)`/.exec(line)
  if (!m) return { missing: true, line }
  const i = m[1].indexOf(':')
  if (i < 0) return { malformed: true, decl: m[1] }
  const val = m[1].slice(i + 1).trim()
  const mm = measure({ 'padding-bottom': { val: val, sel: '注册表', source: 'design-system.md' } }, 'padding-bottom', {})
  return { decl: m[1], value: mm }
}
function v (code, dir, branch, msg) { return { code, dir, branch, msg: code + ' ' + dir + ' 分支 ' + branch + '：' + msg } }
// 文档里被写成「完整声明」形态的这份公式（用来看「两处文档各写一套数」，不是用来数出现次数）
function docFormulas (text) {
  return (String(text).match(/`[^`]*padding-bottom:[^`]*`/g) || []).map(s => s.replace(/`/g, '').trim())
        .filter(s => /calc\(/.test(s))
        // 模板句（`padding-bottom: calc(<常规> + env(...))`，platform-pitfalls §6）不是某个具体规格，不参与数值比对
        .filter(s => !/[<>]/.test(s))
}
function measureDecl (decl) {
  const i = decl.indexOf(':')
  if (i < 0) return { missing: true }
  return measure({ 'padding-bottom': { val: decl.slice(i + 1).trim(), sel: '文档', source: 'md' } }, 'padding-bottom', {})
}
// 判据本体：只吃终值
function grade (model) {
  const bad = []
  const bar = barBox(model)
  const base = measure(cascade([model.app], { classes: ['page'], tag: 'view' }), 'padding-bottom', model.tokens)
  const doc = docRule(model)
  if (bar.unknown) bad.push(v('T0', '(tabbar)', '-', '遮挡物算不出来：index.wxss 缺 padding/border-top/min-height 之一'))
  if (base.missing || base.unresolved || base.unmodeled) bad.push(v('T0', '(app.wxss)', '-', '基线读不出：.page 的底部留白不可解析'))
  if (doc.missing || doc.malformed) bad.push(v('T0', '(design-system.md)', '-', '注册表没有「- **公式**：`padding-bottom: …`」这一行'))
  const tabPages = model.pages.filter(p => p.isTab && p.hasPageClass)
  const ref = tabPages.length ? tabPages[0].branches[0].bottom : null
  model.tabRef = ref
  // 遮挡物与基线读不出时后面无从判断（记 T0 并收摊）；**注册表读不出只记一条红，不连坐**——
  // 否则登记动作没落下时，§7 那几条「门不空转」的合成违例会全部拿不到输入，反而把牙齿藏起来。
  if (bar.unknown || base.missing || base.unresolved || base.unmodeled) return { bad, bar, base, doc, tabPages, floor: null }
  const floor = base.px + bar.px
  tabPages.forEach(p => p.branches.forEach(b => {
    const m = b.bottom
    if (m.missing) { bad.push(v('T2', p.dir, b.label, '没有底部留白终值（载体被删，尾行会被 tabBar 盖住）')); return }
    if (m.unresolved || m.unmodeled) { bad.push(v('T2', p.dir, b.label, '终值算不了（' + m.raw + '），不许猜')); return }
    if (!m.safe) bad.push(v('T2', p.dir, b.label, '留白没吃 env(safe-area-inset-bottom)，而底栏自己的 padding-bottom 带它（' + bar.raw + '）'))
    if (m.px < floor) bad.push(v('T2', p.dir, b.label, '留白 ' + m.px + 'px < 基线 ' + base.px + 'px + 底栏实占 ' + bar.px + 'px ⇒ 尾行被盖住'))
    if (ref && !(m.px === ref.px && m.safe === ref.safe)) bad.push(v('T2b', p.dir, b.label, '本支 ' + m.px + 'px' + (m.safe ? '+安全区' : '') +
      ' 与其余 tab 页的 ' + ref.px + 'px' + (ref.safe ? '+安全区' : '') + ' 不同构（复制开始漂移）'))
  }))
  if (ref && doc.value && !doc.value.missing && !doc.value.unmodeled && !doc.value.unresolved &&
    !(doc.value.px === ref.px && doc.value.safe === ref.safe)) {
    bad.push(v('T6', '(design-system.md)', '-', '注册表写 ' + doc.value.px + 'px' + (doc.value.safe ? '+安全区' : '') +
      '，代码终值是 ' + ref.px + 'px' + (ref.safe ? '+安全区' : '') + ' ⇒ 两处各说一套'))
  }
  model.pages.filter(p => p.hasPageClass && !p.isTab).forEach(p => p.branches.forEach(b => {
    const m = b.bottom
    if (m.missing || m.unresolved || m.unmodeled) { bad.push(v('T3', p.dir, b.label, '底部留白读不出（' + (m.raw || '无声明') + '）')); return }
    if (ref && m.px === ref.px && m.safe === ref.safe) bad.push(v('T3', p.dir, b.label, '不是 tab 页（app.json tabBar.list 里没有它），却留了 tab 专用的一整份 ' + m.px + 'px+安全区'))
    if (m.px > base.px && !p.usesFixedBar) bad.push(v('T3b', p.dir, b.label, '留白 ' + m.px + 'px > 基线 ' + base.px + 'px，但该页正文里没有 .sticky-action 这个遮挡物 ⇒ 这块白无据'))
  }))
  return { bad, bar, base, doc, tabPages, floor }
}
const badOf = (g, code, dir) => g.bad.filter(x => x.code === code && (!dir || x.dir === dir))

/* ============================ §1 输入与非空转 ============================ */
section('§1 输入：tabBar 名单现场读、遮挡物高度现场算（不许凭印象）')
const M = buildModel()
check('T1.1 app.json 的 tabBar.list 读得出，且每一页的文件真的在（读不出来整条门就没有输入）',
  M.list.length >= 2 && M.list.every(p => fs.existsSync(path.join(MP, p + '.js'))), JSON.stringify(M.list))
check('T1.2 页面样式目录扫到 ≥ 15 页（本仓库实测 20 页；扫太少说明判据没吃到输入）',
  M.pages.length >= 15, M.pages.length + ' 页')
const BAR = barBox(M)
check('T1.3 遮挡物自己占的高度由 index.wxss 算得出来：' + (BAR.unknown ? '算不出' : BAR.px + 'px' + (BAR.safe ? ' + 安全区' : '')),
  !BAR.unknown && BAR.px >= 44 && BAR.safe === true, BAR.raw)
const barPos = measure(cascade([M.tabbar], { classes: ['tabbar'], tag: 'view' }), 'position', M.tokens)
check('T1.4 tabBar 是 position:fixed（不计入文档流）⇒ 这份高度必须由页面自己让，本判据才有存在理由',
  !barPos.missing && barPos.raw === 'fixed', fmt(barPos))
const BASE = measure(cascade([M.app], { classes: ['page'], tag: 'view' }), 'padding-bottom', M.tokens)
check('T1.5 app.wxss 的 .page 基线读得出（padding 简写已展开成长方值，不是把整条 padding 当字符串比）',
  !BASE.missing && !BASE.unmodeled && !BASE.unresolved && BASE.px > 0 && BASE.source === 'app.wxss', fmt(BASE))
// 只有「最后一个 compound 含 page」的后代规则才可能与根节点抢 padding-bottom；
// 页面内任意后代控件的 padding 简写（如 .route-actions .button）与根节点无关，不得误报。
const descPageRule = r => r.prop === 'padding-bottom' && r.compounds.length > 1 &&
  r.compounds[r.compounds.length - 1].classes.indexOf('page') !== -1
const descendantPageRules = M.pages.filter(p => p.ownRules.some(descPageRule))
  .map(p => p.dir)
check('T1.6 没有 `.x .page` 这类后代形态来抢这份留白（有的话本判据的祖先模型要升级，不许静默误判）',
  descendantPageRules.length === 0, descendantPageRules.join(','))
check('T1.6a 判据自身有效：`.x .page` 会被抓、页面内 `.foo .button` 的 padding 不误报',
  descPageRule({ prop: 'padding-bottom', compounds: [{ classes: ['x'], tag: null }, { classes: ['page'], tag: null }] }) === true &&
  descPageRule({ prop: 'padding-bottom', compounds: [{ classes: ['route-actions'], tag: null }, { classes: ['button'], tag: null }] }) === false, '')
const noPageClass = M.pages.filter(p => !p.hasPageClass).map(p => p.dir)
note('根节点不带 .page 的页面（不参与本判据，如实登记）：' + (noPageClass.join('/') || '无'))

/* ============================ §2 tab 页终值表 ============================ */
section('§2 tab 页：每个可达根类分支都必须留够（终值判据）')
const G = grade(M)
// 机器可读的违例清单（给 tools/b4-pad-final-value-mutate.js 数「相对基线新增了什么」用；
// 每条 = 一条终值判据的失败，不是检查名，避免把「检查红了几条」当成「行为坏了几处」）
G.bad.forEach(b => console.log('#V|' + b.code + '|' + b.dir + '|' + b.branch + '|' + b.msg))
const TABS = M.pages.filter(p => p.isTab && p.hasPageClass)
check('T2.1 tab 页数与 app.json 名单一致（' + TABS.length + ' 页：' + TABS.map(p => p.dir).join('/') + '）',
  TABS.length === M.list.length, TABS.map(p => p.dir).join(','))
TABS.forEach(p => p.branches.forEach(b => note('[tab] ' + p.dir + ' ' + b.label + ' ⇒ ' + fmt(b.bottom))))
const t2 = badOf(G, 'T2')
check('T2.2 四页的每一支都 ≥ 基线' + BASE.px + 'px + 底栏' + BAR.px + 'px，且都吃安全区（红 ' + t2.length + ' 条）',
  t2.length === 0, t2.map(x => x.msg).join(' ｜ '))
const t2b = badOf(G, 'T2b')
check('T2.3 tab 页之间同构：四页的底部留白终值互相相同（漂移 ' + t2b.length + ' 处——「五份复制」真正要防的就是这个）',
  t2b.length === 0, t2b.map(x => x.msg).join(' ｜ '))
const HOME = M.pages.filter(p => p.dir === 'home')[0]
check('T2.4 home 的根类分支可枚举（with-tabbar 空开关已于 2026-10-23 删除 ⇒ 单支是正确形状，终值仍须过 T2）',
  !!HOME && HOME.branches.length >= 1, HOME ? HOME.branches.map(b => b.label).join(',') : '没找到 home')
const homeShort = badOf(G, 'T2', 'home')
check('T2.5 home 的**空状态那一支**也留够（把公式收进 .page.with-tabbar 再删页级载体，就是在这一支失守 ⇒ 现在必须是绿的）',
  homeShort.length === 0, homeShort.map(x => x.msg).join(' ｜ '))

/* ============================ §3 非 tab 页分组 ============================ */
section('§3 非 tab 页：不许吃这份留白（名单同样由 app.json 决定）')
const NON = M.pages.filter(p => p.hasPageClass && !p.isTab)
NON.forEach(p => p.branches.forEach(b => note('[子页] ' + p.dir + ' ' + b.label + ' ⇒ ' + fmt(b.bottom))))
const t3 = badOf(G, 'T3')
check('T3.1 全仓 ' + NON.length + ' 个非 tab 页里没有一个整套抄走 tab 留白（抄走＝页尾多出一截空白，M-18/E-03）',
  t3.length === 0, t3.map(x => x.msg).join(' ｜ '))
const noBar = NON.filter(p => !p.usesFixedBar)
const fromBase = noBar.filter(p => p.branches.every(b => sameValue(b.bottom, BASE)))
const restated = noBar.filter(p => p.branches.every(b => sameValue(b.bottom, BASE) && b.bottom.source !== 'app.wxss'))
  .map(p => p.dir + '[' + (p.branches[0].bottom.sel || '') + ']')
check('T3.2 非 tab 且没有固定底栏的 ' + noBar.length + ' 页，底部留白终值都等于基线（页级超额覆盖 0 份）',
  fromBase.length === noBar.length, fromBase.length + '/' + noBar.length)
note('其中把「同一个基线数」在自己文件里重印一遍的页（值相同、来源不同 ⇒ 只登记不判红）：' + (restated.join(' / ') || '无'))
const ANOT = M.pages.filter(p => p.dir === 'anotices')[0]
check('T3.3 M-18/E-03 的实测目标：anotices 终值 = 基线 ' + BASE.px + 'px（改前是 ' + (BASE.px + 84) + 'px+安全区，多出来的那截就是用户报的空白）',
  !!ANOT && ANOT.branches.every(b => sameValue(b.bottom, BASE)),
  ANOT ? fmt(ANOT.branches[0].bottom) : '没找到 anotices')
const t3b = badOf(G, 'T3b')
check('T3.4 超额留白必须能指回一个真的遮挡物：比基线多的非 tab 页，页面必须真的在用 .sticky-action',
  t3b.length === 0, t3b.map(x => x.msg).join(' ｜ '))

/* ============================ §4 条件类到底空不空转 ============================ */
section('§4 根节点条件类：用终值差判断它是真开关还是假开关')
const condPages = M.pages.filter(p => p.branches.length > 1)
const condTokens = []
condPages.forEach(p => p.branches.forEach(b => b.classes.forEach(c => {
  if (c !== 'page' && c !== 'container' && c !== 'fc' && condTokens.indexOf(c) === -1) condTokens.push(c)
})))
const inertTokens = []
condPages.forEach(p => p.inert.forEach(c => { if (inertTokens.indexOf(c) === -1) inertTokens.push(c) }))
note('根节点上的条件类：' + condTokens.join(' / ') + '（出现在：' + condPages.map(p => p.dir).join('/') + '）')
note('其中「加上它任何终值都不变」的空开关：' + (inertTokens.length ? inertTokens.join(' / ') : '无'))
check('T4.1 条件类普查确实扫到 ≥ 1 个（with-tabbar 已于 2026-10-23 删除，仅剩 has-sticky；扫到 0 个就是枚举空转）',
  condTokens.length >= 1, condTokens.join(','))
const RE = M.pages.filter(p => p.dir === 'route-edit')[0]
check('T4.2 has-sticky 是真开关：加上它底部留白终值确实变大（app.wxss 定义它）',
  !!RE && (() => {
    const w = RE.branches.filter(b => b.classes.indexOf('has-sticky') !== -1)[0]
    const wo = RE.branches.filter(b => b.classes.indexOf('has-sticky') === -1)[0]
    return !!w && !!wo && w.bottom.px > wo.bottom.px
  })(), RE ? RE.branches.map(b => b.label + '=' + fmt(b.bottom)).join(' / ') : '没找到 route-edit')
const withTabbarLeft = M.pages.some(p => String(p.root || '').indexOf('with-tabbar') !== -1)
check('T4.3 with-tabbar 空开关已彻底删除（wxml 0 引用）：它不产生任何样式，留着只会让条件类普查虚增一支',
  inertTokens.indexOf('with-tabbar') === -1 && withTabbarLeft === false, '空开关：' + inertTokens.join('/'))
note('无定义的条件类用法：改前 1（with-tabbar）→ 改后 ' + inertTokens.length + '（2026-10-23 随跨页重构删除）')

/* ============================ §5 计数闭合（读数） ============================ */
section('§5 计数闭合：复制份数 / 终值分组 / 文档里写成完整声明的次数')
const carriers = TABS.filter(p => p.branches.every(b => !b.bottom.missing && b.bottom.source !== 'app.wxss'))
check('T5.1 tab 页载体份数 = tab 页数（每页一份且由 T2.3 钉成同构；不再是「5 份里有 1 份用错了页」）',
  carriers.length === TABS.length, carriers.map(p => p.dir).join(','))
note('复制份数（页级声明条数）：改前 5（home/me/notices/anotices/weather-hub）→ 改后 ' + carriers.length + '（全部落在 tab 页；anotices 那份是错抄，已删）')
const RE2 = M.pages.filter(p => p.dir === 'route-edit')[0]
const reSticky = RE2 ? RE2.branches.filter(b => b.classes.indexOf('has-sticky') !== -1)[0] : null
note('底部留白终值分组：tab 页 ' + TABS.length + ' 页 = ' + fmt(M.tabRef) +
  ' ｜ 非 tab 无固定底栏 = ' + fmt(BASE) +
  ' ｜ 非 tab 带固定底栏（route-edit 的 has-sticky 支）= ' + fmt(reSticky && reSticky.bottom))
const docMentions = docFormulas(docText)
const refDocs = fs.existsSync(REFS) ? fs.readdirSync(REFS).filter(f => /\.md$/.test(f)) : []
const refFormulas = []
refDocs.forEach(f => docFormulas(rd(path.join(REFS, f))).forEach(x => refFormulas.push({ f, decl: x })))
check('T5.2 规范文档里被写成**完整声明**的这份公式，数值全部相同（design-system.md ' + docMentions.length +
  ' 处 / ' + refDocs.length + ' 份文档共 ' + refFormulas.length + ' 处）：两处文档各写一套数就是第二个真值源',
  (() => {
    if (!refFormulas.length) return false
    const anchor = G.doc.value && !G.doc.value.missing ? G.doc.value : null
    const seen = refFormulas.map(x => measureDecl(x.decl))
    if (seen.some(s => s.missing || s.unmodeled || s.unresolved)) return false
    if (!anchor) return false
    return seen.every(s => s.px === anchor.px && s.safe === anchor.safe)
  })(),
  refFormulas.map(x => x.f + '=' + (measureDecl(x.decl).px || '?') + 'px' + (measureDecl(x.decl).safe ? '+安全区' : '')).join(' ｜ '))
note('design-system.md 内写成完整声明的处数：' + docMentions.length + '（改前 0 ⇒ 这条规则从未被登记；改后应为 1，且「页面模板」那节改为本节引用）')

/* ============================ §6 注册表单源 ============================ */
section('§6 唯一规则登记在 design-system.md，且与代码终值一致')
check('T6.1 注册表那一行读得出（读不出就谈不上单一真值源）',
  !G.doc.missing && !G.doc.malformed && !!G.doc.value && !G.doc.value.missing, G.doc.decl || G.doc.line)
check('T6.2 注册表写的数 == tab 页解析后的终值（文档说 32+84、代码跑成别的 ⇒ 红）',
  badOf(G, 'T6').length === 0, badOf(G, 'T6').map(x => x.msg).join(' ｜ '))
check('T6.3 注册表自己也得盖得住遮挡物（' + G.floor + 'px 是由底栏声明算出的下限，不是偏好）',
  !!G.floor && !!G.doc.value && !G.doc.value.missing && G.doc.value.px >= G.floor,
  G.doc.value && (G.doc.value.px + ' vs floor ' + G.floor))

/* ============================ §7 双向自证 ============================ */
section('§7 门不空转：四个方向各合成一个违例（判「相对真实树新增了什么」，不拿绝对红数充数）')
const TAB_LINE = '.page { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }'
const realCss = () => { const m = {}; M.pages.forEach(p => { m[p.dir] = p.cssText }); return m }
const override = patch => Object.assign(realCss(), patch)
const keyOf = x => x.code + '|' + x.dir + '|' + x.branch + '|' + x.msg
const liveKeys = new Set(G.bad.map(keyOf))
// 违例集相对真实树的差集：合成夹具的意义是「多出来的那一条」，不是「脚本总共报了几条红」
const addedOf = g => g.bad.filter(x => !liveKeys.has(keyOf(x)))
const droppedOf = g => G.bad.filter(x => !new Set(g.bad.map(keyOf)).has(keyOf(x)))

// 方向 A：非 tab 页吃了 tab 留白。用一个今天干净的子页（route）做夹具，这样「改前/改后」都是真新增；
// anotices 那一版（M-18/E-03 的历史形状）另记一条，改前它就是存量红。
const gLeak = grade(buildModel({ pageCss: override({ route: '/* 违例夹具：非 tab 页抄了 tab 留白 */\n' + TAB_LINE }) }))
check('T7.1 方向 A（非 tab 页吃 tab 留白）：给子页 route 挂上那份 84px 复制 ⇒ 必须**新增**一条 T3',
  addedOf(gLeak).some(x => x.code === 'T3' && x.dir === 'route'),
  addedOf(gLeak).map(x => x.msg).join(' ｜ ') || '没报红')
const gLeakHist = grade(buildModel({ pageCss: override({ anotices: '/* 违例夹具：把 M-18 的错抄形状塞回去 */\n' + TAB_LINE }) }))
check('T7.1b 同一形状塞回 anotices（M-18/E-03 的历史现场）⇒ 判据必须报 T3（改前它是存量红，改后它是新增红）',
  badOf(gLeakHist, 'T3', 'anotices').length > 0 &&
  (addedOf(gLeakHist).length > 0 || badOf(G, 'T3', 'anotices').length > 0),
  (badOf(gLeakHist, 'T3', 'anotices')[0] || {}).msg || '没报红')

const gMissing = grade(buildModel({ pageCss: override({ home: '/* 违例夹具：载体被删 */\n' }) }))
check('T7.2 方向 B（tab 页没留白）：删掉 home 那一行 ⇒ 必须**新增**一条「没有底部留白终值」，而不是静默放过',
  addedOf(gMissing).some(x => x.code === 'T2' && x.dir === 'home'),
  addedOf(gMissing).map(x => x.msg).join(' ｜ ') || '没报红')

const appWithClass = rd(path.join(MP, 'app.wxss')).replace(
  '/* ---------- 页面骨架与节奏 ---------- */',
  '/* ---------- 页面骨架与节奏 ---------- */\n.page.with-tabbar { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }')
const gHalf = grade(buildModel({ appCss: appWithClass, pageCss: override({ home: '/* 载体交给 app.wxss 的 .page.with-tabbar */\n' }) }))
check('T7.3 方向 B-2：把公式收进 .page.with-tabbar 并删掉页级载体 ⇒ **不带该类那一支**（home 的空状态）失去留白 ⇒ 必须新增红（这条就是「给假开关补唯一定义」那条路的实测代价）',
  addedOf(gHalf).some(x => x.code === 'T2' && x.dir === 'home' && x.branch.indexOf('with-tabbar') === -1),
  addedOf(gHalf).map(x => x.branch + ' ' + x.msg).join(' ｜ ') || '没报红')

const gShrunk = grade(buildModel({ pageCss: override({ me: '.page { padding-bottom: calc(24px + 24px + env(safe-area-inset-bottom)); }' }) }))
check('T7.4 方向 C：只把 me 的留白改成 48px+安全区（< 基线 ' + BASE.px + ' + 底栏 ' + BAR.px + '）⇒ 新增红只落在 me，别的 tab 页一条不新增（判据拿的是遮挡物高度，不是抄 84）',
  addedOf(gShrunk).every(x => x.dir === 'me') && addedOf(gShrunk).some(x => x.code === 'T2' && x.dir === 'me'),
  addedOf(gShrunk).map(x => x.dir + ':' + x.code).join(',') || '没报红')

const gNoSafe = grade(buildModel({ pageCss: override({ notices: '.page { padding-bottom: 116px; }' }) }))
check('T7.5 方向 D：数值够但丢掉 env(safe-area-inset-bottom) ⇒ 必须新增一条「没吃安全区」的红（platform-pitfalls §6）',
  addedOf(gNoSafe).some(x => x.code === 'T2' && x.dir === 'notices' && /safe-area|安全区/.test(x.msg)),
  addedOf(gNoSafe).map(x => x.msg).join(' ｜ ') || '没报红')

/* ============================ §8 等价重构控制（不许误伤） ============================ */
section('§8 等价重构控制：判据读层叠赢家，不读「第几行写了什么」')
const gMoved = grade(buildModel({ pageCss: override({ home: '/* 载体搬到文件末尾，值一字不变 */\n' + TAB_LINE + '\n' }) }))
check('T8.1 把 home 那一行从第 2 行挪到末尾（同特异度同值）⇒ 违例集合既不新增也不减少（否则判据记住的是文本，铁律 30 的原事故）',
  addedOf(gMoved).length === 0 && droppedOf(gMoved).length === 0,
  '新增 ' + addedOf(gMoved).length + ' / 消失 ' + droppedOf(gMoved).length)
const gRedundant = grade(buildModel({ appCss: appWithClass, pageCss: realCss() }))
check('T8.2 app.wxss 多一条同值的 .page.with-tabbar（页级载体仍保留）⇒ 两支终值都不变 ⇒ 违例集合零变化（红了就是在数声明条数）',
  addedOf(gRedundant).length === 0 && droppedOf(gRedundant).length === 0,
  '新增 ' + addedOf(gRedundant).map(x => x.dir + ':' + x.code).join(',') + ' / 消失 ' + droppedOf(gRedundant).length)
const gHidden = grade(buildModel({
  appCss: 'page { --b4pad: calc(32px + 84px + env(safe-area-inset-bottom)); }\n.page { padding: 24px 20px 32px }\n.page.tab-pad { padding-bottom: var(--b4pad) }',
  pageCss: override({ home: '/* 定义搬进 var()/类，但根节点拿不到这个类 */\n' })
}))
check('T8.3 反向：真值源被搬进 var()＋一个根节点拿不到的类 ⇒ 终值塌回基线，必须新增 home 的红（把四页收成一条「看不见的定义」是回归不是收敛）',
  addedOf(gHidden).some(x => x.dir === 'home' && (x.code === 'T2' || x.code === 'T2b')),
  addedOf(gHidden).map(x => x.msg).join(' ｜ ') || '没报红')

/* ============================ 汇总 ============================ */
console.log('\npassed=' + passed + ' failed=' + failed)
if (failed) failures.slice(0, 20).forEach(l => console.log(l))
process.exit(failed ? 1 : 0)
