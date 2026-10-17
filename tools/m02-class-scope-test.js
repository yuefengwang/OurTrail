'use strict'
// M-02（E-15 / E-16 同族）类 token 作用域定义门：node tools/m02-class-scope-test.js
//
// 缺陷本体：WXML 用了某个类，但**在这个类真的能生效的那份样式表里**根本没有它的定义。
//   小程序页面 wxss 只作用于本页、全仓零 @import ⇒ 一个类只在 pages/me/me.wxss 里定义，
//   另外四页写着同一个类名就是命不中任何选择器，标题掉回 page 默认的 14px/400（E-15）。
//   privacy 页更彻底：container / h1 / h2 三个类**全仓零定义**（E-16）。
//   改前实测命中 16 处 / 5 个文件（editor 4、privacy 6、route-edit 2、weather 2、weather-hub 2）。
//
// ── 本门的三条硬要求（派单点名的，不是自创） ──
// ① **逐作用域比对，不许把全仓选择器汇成一个池**。作用域 =
//   页面：app.wxss + 同页 wxss；组件：同组件 wxss，且**仅当**它声明 styleIsolation:'apply-shared' 时才算上 app.wxss。
//   汇池就是前任探针漏掉 E-15 的原因：me.wxss 那份定义会掩盖另外四页的缺失。
// ② **三种形态不是「无定义」**，一律排除并各写自测用例（§0）：
//   a) `hover-class="…"`（它是 class 的子串，混在一起会污染结果）；
//   b) 整段 `{{ … }}`（含三元里的**比较字面量**，如 `{{a ? 'featured' : ''}}` 的 'featured'）；
//   c) **部分插值** `prefix--{{x}}` / `{{x}}-suffix`：只把 `{{}}` 换成空格会把它切成半个 token。
//      做法是把 mustache 换成哨兵 \u0000，凡与哨兵**粘连**的 chunk 就是动态名，整段不判。
//   ⚠ 排除 (b) 之后 `pages/home/home.wxml:1` 的 `with-tabbar` 不再由本门判——它活在三元字面量里；
//     它是「假开关」这件事由 tools/b4-pad-final-value-test.js 用**终值差**判（T4.3），归另一条账。
// ③ **钉解析后的终值与赢家出处，不钉源码文本**（铁律 30）：把 `padding` 写成简写或长写、把规则挪位置、
//   调换 class 里两个类的次序 ⇒ 终值不变 ⇒ 必须照样全绿（tools/m02-class-scope-mutate.js 的 E 组当场验）。
//
// 组件侧「用了全局类却没声明 apply-shared」不由本门判（那是 t4-e08 的第 4 条规则）；
// 本门只问「按生效作用域解出来，这个类有没有定义」。
//
// 沙盒：M02_MP_ROOT 指向一份 miniprogram 副本（变异自证用）；缺省 = 真实仓库。
// 违例以 `#V|code|subject|detail` 行输出，供 tools/m02-class-scope-mutate.js 按「相对基线新增了什么」判。
//
// 运行：node tools/m02-class-scope-test.js      退出码：0 = 全绿

const fs = require('fs')
const os = require('os')
const path = require('path')

let passed = 0
let failed = 0
const VIOL = []
function viol (code, subject, detail) {
  const line = '#V|' + code + '|' + subject + '|' + detail
  if (VIOL.indexOf(line) === -1) { VIOL.push(line); console.log(line) }
}
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
  return cond
}
function section (t) { console.log('== ' + t + ' ==') }
function note (t) { console.log('  · ' + t) }

const ROOT = path.resolve(__dirname, '..')
const MP = process.env.M02_MP_ROOT || path.join(ROOT, 'miniprogram')
const DOC = process.env.M02_DOC || path.join(ROOT, '.agents', 'skills', 'ourtrail-ui', 'references', 'design-system.md')

/* ===================== 解析层（自研，不引用别人套件的私有夹具） ===================== */
function rd (p) { return fs.readFileSync(p, 'utf8') }
function exists (p) { return fs.existsSync(p) }
// 注释替换成等长空白（保留换行 ⇒ 行号不漂；把注释整段压成空格会把后面的行号全部算错）
function blankOut (m) { return m.replace(/[^\n]/g, ' ') }
function stripComments (css) { return String(css).replace(/\/\*[\s\S]*?\*\//g, blankOut) }
function splitTop (val) {
  const out = []
  let cur = '', depth = 0
  for (const ch of String(val)) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) { if (cur) { out.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}
// 只展开本门要用的简写：padding / margin 的四边。其余原样透传。
function expand (prop, val) {
  const p = prop.toLowerCase(), v = splitTop(val)
  if (p === 'padding' || p === 'margin') {
    const k = p + '-top', r = p + '-right', b = p + '-bottom', l = p + '-left'
    if (v.length === 1) return [[k, v[0]], [r, v[0]], [b, v[0]], [l, v[0]]]
    if (v.length === 2) return [[k, v[0]], [r, v[1]], [b, v[0]], [l, v[1]]]
    if (v.length === 3) return [[k, v[0]], [r, v[1]], [b, v[2]], [l, v[1]]]
    if (v.length >= 4) return [[k, v[0]], [r, v[1]], [b, v[2]], [l, v[3]]]
    return []
  }
  return [[p, val]]
}
function parseDecls (body) {
  const out = []
  String(body).split(';').forEach(chunk => {
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
    tag: /^[a-zA-Z][\w-]*/.test(part) ? part.match(/^[a-zA-Z][\w-]*/)[0] : null
  }
}
function parse (css, source) {
  const text = stripComments(css)
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let order = 0, m
  while ((m = re.exec(text)) !== null) {
    const selText = m[1].trim().replace(/\s+/g, ' ')
    if (!selText || selText[0] === '@') continue
    const decls = parseDecls(m[2])
    selText.split(',').forEach(raw => {
      const sel = raw.trim()
      if (!sel) return
      const compounds = sel.split(/\s+/).filter(Boolean).map(compoundOf)
      decls.forEach(d => rules.push({ sel, compounds, spec: specificity(sel), prop: d.prop, val: d.val, order: order++, source }))
    })
  }
  const tokens = {}
  rules.filter(r => r.sel === 'page' && /^--/.test(r.prop)).forEach(r => { tokens[r.prop] = r.val })
  const classNames = new Set()
  rules.forEach(r => r.compounds.forEach(c => c.classes.forEach(x => classNames.add(x))))
  return { rules, tokens, classNames, source }
}
// 单 compound 匹配（后代选择器要祖先链；§4 PV0 先证本门断言的节点没有这种形态，简化才成立）
function matchesNode (compounds, node) {
  if (compounds.length !== 1) return false
  const c = compounds[0]
  if (c.tag && c.tag !== node.tag) return false
  return c.classes.length > 0 && c.classes.every(x => node.classes.indexOf(x) !== -1)
}
function cascade (parsedList, node, inline) {
  const best = {}
  parsedList.forEach((parsed, fileRank) => parsed.rules.forEach(r => {
    if (r.prop.indexOf('--') === 0) return
    if (!matchesNode(r.compounds, node)) return
    const cur = best[r.prop]
    const win = !cur || cmpSpec(r.spec, cur.spec) > 0 ||
      (cmpSpec(r.spec, cur.spec) === 0 && (fileRank > cur.fileRank || (fileRank === cur.fileRank && r.order > cur.order)))
    if (win) best[r.prop] = { val: r.val, sel: r.sel, source: r.source, spec: r.spec, order: r.order, fileRank }
  }))
  // 内联 style 权重最高（不是本门发明的，是层叠事实；page2-gates §3 同口径）
  if (inline) inline.forEach((d, i) => { best[d.prop] = { val: d.val, sel: '(inline style)', source: 'inline', spec: { ids: 1e9, b: 0, c: 0 }, order: i, fileRank: -1 } })
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
  return { raw: out, unresolved }
}
// 某属性在这个节点上的终值（解析 var、记录赢家 sel/source；拿不到就明说 missing，绝不猜）
function finalOf (map, prop, tokens) {
  const d = map && map[prop]
  if (!d) return { missing: true }
  const r = resolveVars(d.val, tokens)
  return { value: String(r.raw).trim(), raw: String(d.val).trim(), sel: d.sel, source: d.source, unresolved: !!r.unresolved }
}
function describe (f) { return f.missing ? '无声明' : (f.unresolved ? '悬空 var(' + f.value + ')' : f.value + '←' + f.source) }
// 这个类 token 在给定作用域里由哪些规则定义（空数组 = 没有定义）
function definerRules (parsedList, cls) {
  const out = []
  parsedList.forEach(pl => pl.rules.forEach(r => {
    if (r.compounds.some(c => c.classes.indexOf(cls) !== -1)) out.push(r)
  }))
  return out
}

/* ===================== WXML 层：class token 提取与三种排除形态 ===================== */
function classTokensOf (raw) {
  const rec = { tokens: [], whole: 0, partial: 0 }
  const marked = String(raw).replace(/\{\{[\s\S]*?\}\}/g, () => '\u0000')
  marked.split(/\s+/).filter(Boolean).forEach(t => {
    if (t.indexOf('\u0000') !== -1) {
      if (t === '\u0000') rec.whole++
      else rec.partial++
      return
    }
    // 残留的半个 token（哨兵被空格切开时不会出现，这里是给 `foo-` / `-foo` 这类断尾兜底）
    if (/[-_]$/.test(t) || /^[-_]/.test(t)) { rec.partial++; return }
    rec.tokens.push(t)
  })
  return rec
}
// 扫一份 WXML 的全部标签节点。attr 只认双引号形态（§0 P9 现场复核全仓单引号/裸值为 0 处）
function nodesOf (wxmlText) {
  const clean = String(wxmlText).replace(/<!--[\s\S]*?-->/g, blankOut)
  const out = []
  const re = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
  let m
  while ((m = re.exec(clean)) !== null) {
    const attrs = {}
    const ar = /([a-zA-Z-][\w:-]*)\s*=\s*"([^"]*)"/g
    let a
    while ((a = ar.exec(m[2]))) attrs[a[1]] = a[2]
    out.push({
      tag: m[1],
      attrs,
      line: clean.slice(0, m.index).split('\n').length,
      classRaw: attrs.class === undefined ? null : attrs['class'],
      hoverRaw: attrs['hover-class'] === undefined ? null : attrs['hover-class'],
      inline: attrs.style === undefined ? [] : parseDecls(attrs.style)
    })
  }
  out.forEach(n => { n.classes = n.classRaw === null ? [] : classTokensOf(n.classRaw).tokens })
  return out
}

/* ===================== 输入装载：逐作用域单元 ===================== */
const appParsed = parse(rd(path.join(MP, 'app.wxss')), 'app.wxss')
const appJson = JSON.parse(rd(path.join(MP, 'app.json')))
const tabPaths = new Set(((appJson.tabBar && appJson.tabBar.list) || []).map(x => x.pagePath))
const UNITS = []
fs.readdirSync(path.join(MP, 'pages')).forEach(d => {
  const w = path.join(MP, 'pages', d, d + '.wxml')
  if (!exists(w)) return
  const ownRel = 'pages/' + d + '/' + d + '.wxss'
  UNITS.push({
    kind: 'page', id: d, file: 'pages/' + d + '/' + d + '.wxml', ownRel,
    nodes: nodesOf(rd(w)),
    scope: [appParsed, parse(exists(path.join(MP, ownRel)) ? rd(path.join(MP, ownRel)) : '', ownRel)],
    isTab: tabPaths.has('pages/' + d + '/' + d)
  })
})
fs.readdirSync(path.join(MP, 'components')).forEach(c => {
  const w = path.join(MP, 'components', c, c + '.wxml')
  if (!exists(w)) return
  const ownRel = 'components/' + c + '/' + c + '.wxss'
  const js = exists(path.join(MP, 'components', c, c + '.js')) ? rd(path.join(MP, 'components', c, c + '.js')) : ''
  const shared = /styleIsolation[^'"]*['"]apply-shared['"]/.test(js)
  UNITS.push({
    kind: 'comp', id: 'components/' + c, file: 'components/' + c + '/' + c + '.wxml', ownRel, applyShared: shared,
    nodes: nodesOf(rd(w)),
    scope: shared ? [appParsed, parse(rd(path.join(MP, ownRel)), ownRel)] : [parse(rd(path.join(MP, ownRel)), ownRel)]
  })
})
function unit (id) { const u = UNITS.filter(x => x.id === id)[0]; if (!u) throw new Error('没有这个作用域单元：' + id); return u }
function nodeOf (u, cls, idx) { const n = u.nodes.filter(x => x.classes.indexOf(cls) !== -1); return n[idx || 0] }
function nodesWith (u, cls) { return u.nodes.filter(x => x.classes.indexOf(cls) !== -1) }
function fin (u, node, prop) { return finalOf(cascade(u.scope, { tag: node.tag, classes: node.classes }, node.inline), prop, appParsed.tokens) }
// 只看**样式表**解出的终值（不吃内联）：§2 问的是「这个类本身给出什么」，内联覆盖另立读数（U3）
function finSheet (u, node, prop) { return finalOf(cascade(u.scope, { tag: node.tag, classes: node.classes }), prop, appParsed.tokens) }

/* ===================== §0 探针自证 ===================== */
section('§0 探针自证（三种排除形态 + 阳性对照 + 解析器不空转）')
{
  const p1 = classTokensOf('empty-state status-panel status-panel--{{kind}}')
  check('P1 部分插值 prefix--{{x}}：静态 token 只剩 empty-state/status-panel，那半个不判',
    p1.tokens.join(' ') === 'empty-state status-panel' && p1.partial === 1, JSON.stringify(p1))
  const p2 = classTokensOf("card cond-pheno {{item.featured ? 'featured' : ''}}")
  check('P2 整段 {{}}（含三元比较字面量）：featured 没被当成类名，静态两枚照常判',
    p2.tokens.join(' ') === 'card cond-pheno' && p2.whole === 1 && p2.tokens.indexOf('featured') === -1, JSON.stringify(p2))
  const p3 = classTokensOf("page {{cards.length || tasks.length ? 'with-tabbar' : ''}}")
  check('P3 三元里的 with-tabbar 不由本门判（它活在三元字面量内；假开关那条账归 b4-pad 的终值差），静态 page 仍判',
    p3.tokens.join(' ') === 'page' && p3.whole === 1 && p3.tokens.indexOf('with-tabbar') === -1, JSON.stringify(p3))
  const p4 = classTokensOf('{{side}}-box suffix-')
  check('P4 前缀插值与断尾 token 都是动态名：整条不产出静态 token',
    p4.tokens.length === 0 && p4.partial === 2, JSON.stringify(p4))
  const hv = nodesOf('<view class="card" hover-class="pos-hover"></view><text class="pos-real">x</text>')
  check('P5 hover-class 与 class 分开解析（hover 里的名字不进本门，class 里的仍是判定对象）',
    hv.length === 2 && hv[0].hoverRaw === 'pos-hover' && hv[0].classes.join(' ') === 'card' && hv[1].classes[0] === 'pos-real',
    JSON.stringify(hv.map(h => [h.classes, h.hoverRaw])))
  // 阳性对照：真造一份「用了没定义」的现场，探针必须报出来（否则「命中 0」只是看不见）
  const SB = path.join(os.tmpdir(), 'm02-pos-probe-' + process.pid)
  fs.mkdirSync(SB, { recursive: true })
  fs.writeFileSync(path.join(SB, 'pos.wxml'), '<view class="page pos-made-up"><text class="card-label">x</text><view class="pos-prefix-{{k}}"></view><view hover-class="pos-hover-not-a-class"></view></view>')
  fs.writeFileSync(path.join(SB, 'pos.wxss'), '.pos-defined { color: red; }')
  const probeScope = [appParsed, parse(rd(path.join(SB, 'pos.wxss')), 'pos.wxss')]
  const found = []
  nodesOf(rd(path.join(SB, 'pos.wxml'))).forEach(n => {
    n.classes.forEach(c => { if (!definerRules(probeScope, c).length && found.indexOf(c) === -1) found.push(c) })
  })
  check('P6 阳性对照：夹具里未定义的 pos-made-up 被报出（判据有牙齿）',
    found.indexOf('pos-made-up') !== -1, found.join(' '))
  check('P7 三种排除没有反噬：已定义的 page、动态的 pos-prefix-*、hover 里的名字都不在命中里',
    found.filter(x => x === 'page' || /^pos-prefix/.test(x) || /hover/.test(x)).length === 0, found.join(' '))
  check('P8 解析器不是空转：app.wxss 解出 ' + appParsed.rules.length + ' 条声明 / ' + appParsed.classNames.size + ' 个类名 / ' + Object.keys(appParsed.tokens).length + ' 个 token',
    appParsed.rules.length > 100 && appParsed.classNames.size > 40 && Object.keys(appParsed.tokens).length >= 25)
  const oddAttr = UNITS.reduce((n, u) => {
    const raw = String(rd(path.join(MP, u.file)))
    return n + (raw.match(/class='/g) || []).length + (raw.match(/class=[^"' ]/g) || []).length
  }, 0)
  check('P9 属性形态前提复核：全仓 class 属性只有双引号形态（单引号/裸值实测 ' + oddAttr + ' 处 ⇒ 提取式没有漏掉的形态）', oddAttr === 0)
  const lineOk = (() => {
    const t = '<!-- a\nb\n-->\n<view class="x"></view>'
    const n = nodesOf(t)
    return n.length === 1 && n[0].line === 4
  })()
  check('P10 行号不被注释吞掉（跨行注释后第一个标签仍报正确行号 ⇒ 命中可复点到文件）', lineOk, '')
}

/* ===================== §1 全仓逐作用域命中 ===================== */
section('§1 逐作用域未定义类命中：每个页面/组件各用自己的作用域判（改前 16 处 / 5 文件）')
const HITS = []
UNITS.forEach(u => {
  const own = []
  u.nodes.forEach(n => {
    n.classes.forEach(c => { if (!definerRules(u.scope, c).length) own.push({ file: u.file, cls: c, line: n.line }) })
  })
  if (own.length) {
    HITS.push(...own)
    note(u.id + '：' + own.map(h => h.cls + '@L' + h.line).join(' '))
  }
})
HITS.forEach(h => viol('E10', h.file, h.cls + '@L' + h.line))
check('S1.1 未定义类命中 = 0（本次读数 ' + HITS.length + '）', HITS.length === 0,
  HITS.map(h => h.file + ':' + h.cls + '@L' + h.line).join(' | '))
const FILEHITS = Array.from(new Set(HITS.map(h => h.file)))
check('S1.2 命中数与命中文件数闭合（16 处对应 5 个文件；若命中 0 则文件也必须 0）',
  HITS.length === 0 ? FILEHITS.length === 0 : HITS.length === 16 && FILEHITS.length === 5,
  'hits=' + HITS.length + ' files=' + FILEHITS.length)
const LIVING = ['editor', 'privacy', 'route-edit', 'weather', 'weather-hub']
check('S1.3 五个活体作用域都在扫描面里（扫不到就是判据没有输入）', LIVING.every(d => !!unit(d)), '')
check('S1.4 扫描单元 = 页面 ' + UNITS.filter(u => u.kind === 'page').length + ' + 组件 ' + UNITS.filter(u => u.kind === 'comp').length +
  ' = ' + UNITS.length + '，且每个单元都真的解析出节点', UNITS.length >= 21 && UNITS.every(u => u.nodes.length > 0),
  '空节点单元 ' + UNITS.filter(u => !u.nodes.length).map(u => u.id).join(','))
const exWhole = UNITS.reduce((n, u) => n + u.nodes.reduce((k, x) => k + (x.classRaw ? classTokensOf(x.classRaw).whole : 0), 0), 0)
const exPartial = UNITS.reduce((n, u) => n + u.nodes.reduce((k, x) => k + (x.classRaw ? classTokensOf(x.classRaw).partial : 0), 0), 0)
const exHover = UNITS.reduce((n, u) => n + u.nodes.filter(x => x.hoverRaw !== null).length, 0)
check('S1.5 排除记账非零（三种形态在全仓真的存在，P1–P5 才不是自说自话）：整段 mustache ' + exWhole +
  ' / 部分插值与断尾 ' + exPartial + ' / hover-class ' + exHover, exWhole > 0 && exPartial > 0 && exHover > 0)
note('活体计数（本轮 5 处目标）：card-label ' + UNITS.filter(u => u.nodes.some(n => n.classes.indexOf('card-label') !== -1)).map(u => u.id).join(' / ') +
  '；privacy 的 container/h1/h2 命中 ' + HITS.filter(h => h.file.indexOf('privacy') !== -1).length + ' 处')

/* ===================== §2 card-label：五页终值 + 单一出处 ===================== */
section('§2 .card-label 提升为 app.wxss 全局单源：五页逐页解终值，赢家只能有一个出处')
const CL_EXPECT = { display: 'block', 'font-size': '15px', 'font-weight': '600', 'margin-bottom': '12px' }
{
  const users = UNITS.filter(u => u.nodes.some(n => n.classes.indexOf('card-label') !== -1))
  check('U0 使用 card-label 的作用域恰好是这 5 页（editor/route-edit/weather/weather-hub/me），privacy 不掺进来',
    users.length === 5 && users.every(u => LIVING.concat('me').indexOf(u.id) !== -1 && u.id !== 'privacy'),
    users.map(u => u.id + '×' + u.nodes.filter(n => n.classes.indexOf('card-label') !== -1).length).join(' '))
  let totalNodes = 0
  const overrides = []
  users.forEach(u => {
    const ns = nodesWith(u, 'card-label')
    totalNodes += ns.length
    const props = Object.keys(CL_EXPECT)
    const bad = []
    const srcSet = new Set()
    ns.forEach(n => {
      props.forEach((p, i) => {
        const g = finSheet(u, n, p)
        if (g.value !== CL_EXPECT[p]) bad.push(n.line + ' ' + p + '=' + describe(g))
        if (!g.missing) srcSet.add(g.source)
      })
      n.inline.forEach(d => { if (props.indexOf(d.prop) !== -1) overrides.push(u.file + ':L' + n.line + ' ' + d.prop + ':' + d.val) })
    })
    check('U·' + u.id + ' 的 ' + ns.length + ' 处 card-label：四条声明的**样式表**终值 = 15px/600/block/12px',
      ns.length > 0 && bad.length === 0, bad.slice(0, 3).join(' ｜ ') || '无节点')
    check('U·' + u.id + ' 的 card-label 出处只有一个且是 app.wxss（' + Array.from(srcSet).join('/') + '）',
      srcSet.size === 1 && Array.from(srcSet)[0] === 'app.wxss', Array.from(srcSet).join('/'))
    if (bad.length || !(srcSet.size === 1 && Array.from(srcSet)[0] === 'app.wxss')) {
      viol('SRC', u.file, 'card-label 终值/出处不对：' + (bad.slice(0, 2).join(' ｜ ') || Array.from(srcSet).join('/')))
    }
  })
  // 原先钉死 totalNodes === 17：上游重构会增删某一页的使用点个数，钉死总数＝把断言绑在工作树偶然状态上（假红）。
  // 这条要防的是「只抽一个样本就宣布全仓修好」，所以判据是覆盖度下限，不是具体计数。
  check('U2a 判据覆盖 ≥10 处使用点（读数 ' + totalNodes + '；不钉死总数，防只抽一个样本）', totalNodes >= 10, totalNodes + ' 处')
  const ovFiles = Array.from(new Set(overrides.map(o => o.split(':')[0])))
  check('U2b 内联覆盖 card-label 四条声明的位置都在本批写入集之外（实测 ' + overrides.length + ' 处：' + ovFiles.join(',') +
    '）；出现在 editor/route-edit/weather/weather-hub 里就是本批的错',
    overrides.length <= 1 && ovFiles.every(f => f === 'pages/me/me.wxml'), overrides.join(' ｜ '))
  if (overrides.length > 1 || !ovFiles.every(f => f === 'pages/me/me.wxml')) viol('SRC', ovFiles.join(',') || 'none', 'card-label 被内联覆盖且归属不对：' + overrides.join(' '))
  note('既有内联覆盖读数（me.wxml 的 margin-bottom:0，A-23/B-11 同族，本批禁写 me.wxml ⇒ 记 requests.md）：' + (overrides.join(' ｜ ') || '无'))
  const meDefs = definerRules([unit('me').scope[1]], 'card-label')
  check('U1 me.wxss 不再持有第二份基础定义（本页解出的 .card-label 规则数 = ' + meDefs.length + '）', meDefs.length === 0,
    meDefs.map(r => r.sel + '{' + r.prop + ':' + r.val + '}').join(' '))
  if (meDefs.length) viol('SRC', 'pages/me/me.wxss', '.card-label 在本页仍有 ' + meDefs.length + ' 条规则（第二真值源）')
  const base = definerRules([appParsed], 'card-label')
  check('U2 app.wxss 里 .card-label 四条属性齐全（' + base.map(r => r.prop).join(',') + '）',
    ['display', 'font-size', 'font-weight', 'margin-bottom'].every(p => base.some(r => r.prop === p)))
}

/* ===================== §3 影子改写 ===================== */
section('§3 单源必须改得动：影子改 app.wxss 的字号 ⇒ 五页一起动（铁律 31③）')
{
  const users = ['editor', 'route-edit', 'weather', 'weather-hub', 'me']
  const appText = rd(path.join(MP, 'app.wxss'))
  const hits = (appText.match(/font-size:\s*15px/g) || []).length
  const SHADOW = '17px'
  const shadowText = appText.replace(/(\.card-label\s*\{[^}]*?)font-size:\s*15px/, '$1font-size: ' + SHADOW)
  // hits 不要求唯一：15px 这个字号别的规则也会用（合并后 app.wxss 里有 2 处），要求唯一同样是绑偶然状态。
  // 承重的是 SH1——影子只改一处而五页终值一起变，才证明出处只有一个。
  check('SH0 影子真的改到了那一条（app.wxss 里 font-size:15px 共 ' + hits + ' 处，不要求唯一；改动只落一处且落点可寻）',
    shadowText !== appText && (shadowText.match(/font-size:\s*17px/g) || []).length === 1, '')
  const shadowApp = parse(shadowText, 'app.wxss')
  const moved = users.map(id => finalOf(cascade([shadowApp, unit(id).scope[1]], { tag: 'text', classes: ['card-label'] }), 'font-size', shadowApp.tokens).value)
  check('SH1 影子把字号改成 17px ⇒ 五页解出的终值全部变 17（一起动才说明只有一个出处）',
    shadowText !== appText && moved.every(v => v === SHADOW), moved.join('/'))
  const back = users.map(id => finSheet(unit(id), nodeOf(unit(id), 'card-label'), 'font-size').value)
  check('SH2 还原后五页逐项相同（影子没把状态留在别处）', back.every(v => v === '15px'), back.join('/'))
  const fakeMe = parse('.card-label { font-size: 15px; }', 'pages/me/me.wxss')
  const meCopy = finalOf(cascade([shadowApp, fakeMe], { tag: 'text', classes: ['card-label'] }), 'font-size', shadowApp.tokens)
  check('SH3 反证成立：在 me 页塞一份**同值**副本 ⇒ 影子（17px）追不上它、赢家退回 me.wxss ⇒ U1/§2 那条不是摆设',
    meCopy.value === '15px' && meCopy.source === 'pages/me/me.wxss', JSON.stringify(meCopy))
}

/* ===================== §4 privacy 层级 ===================== */
section('§4 privacy：容器与两级标题由全局类承载，段距由本页承载（不新造 container/h1/h2）')
{
  const pv = unit('privacy')
  const multi = pv.scope.reduce((n, pl) => n + pl.rules.filter(r => r.compounds.length > 1 &&
    /(page-title|section-title|card-label|doc-meta|doc-section|page)/.test(r.sel)).length, 0)
  check('PV0 前置门：本作用域里没有「要靠祖先链才命中」的标题/容器规则（有的话单 compound 简化会漏算 ⇒ 停手）', multi === 0, multi + ' 条')
  const root = pv.nodes[0]
  check('PV1 根节点带 page 类（不再是全仓零定义的 container）', root.classes.indexOf('page') !== -1, JSON.stringify(root.classes))
  const sides = { 'padding-top': '24px', 'padding-right': '20px', 'padding-bottom': '32px', 'padding-left': '20px' }
  const sidesGot = Object.keys(sides).map(p => fin(pv, root, p))
  check('PV2 根节点四边内缩终值 = app.wxss 基线 24/20/32（白卡不再贴屏幕四边；简写与长写都算对）',
    sidesGot.every((g, i) => g.value === sides[Object.keys(sides)[i]] && g.source === 'app.wxss'), sidesGot.map(describe).join(' '))
  if (!sidesGot.every((g, i) => g.value === sides[Object.keys(sides)[i]] && g.source === 'app.wxss')) viol('PRIVACY', pv.file, '根节点内缩终值不对：' + sidesGot.map(describe).join(' '))
  const padB = fin(pv, root, 'padding-bottom')
  check('PV3 底部留白终值 = 基线 32px 且不含 84px/安全区：privacy 不在 app.json 的 tabBar.list（isTab=' + pv.isTab + '）',
    padB.value === '32px' && padB.source === 'app.wxss' && pv.isTab === false, describe(padB))
  if (!(padB.value === '32px' && pv.isTab === false)) viol('PRIVACY', pv.file, '底部留白与 tab 身份不一致：' + describe(padB))
  const titles = pv.nodes.filter(n => n.classes.indexOf('page-title') !== -1)
  const t = titles[0]
  const tf = t ? [fin(pv, t, 'font-size'), fin(pv, t, 'font-weight')] : []
  check('PV4 主标题由全局 .page-title 承载（终值 28px/700，赢家出处 = app.wxss；本页不重印层级）',
    titles.length === 1 && tf[0].value === '28px' && tf[0].source === 'app.wxss' && tf[1].value === '700' && tf[1].source === 'app.wxss',
    titles.length + ' 个 page-title：' + tf.map(describe).join(' '))
  if (!(titles.length === 1 && tf[0].value === '28px' && tf[1].value === '700')) viol('PRIVACY', pv.file, '主标题层级没由全局类承载')
  // 合并修正（2026-10-17，并入上游二阶段视觉重构后）：这两条原先把「privacy.wxss 的 .doc-meta/.doc-section」
  // 当成 privacy 屏的唯一合法形状钉死了 ⇒ 上游用 section-head/kicker/section-sub + 容器节奏重排同一屏时必然假红。
  // 钉"某页某个类名出自哪个文件"就是断言依赖工作树的偶然状态（铁律 30 的反面）。判据改回它本来要守的不变量：
  // 层级由 app.wxss 的全局类承载、本页不重印字号字重、间距不得由内联决定。
  const secs = pv.nodes.filter(n => n.classes.indexOf('section-title') !== -1)
  const secRead = secs.map(n => [fin(pv, n, 'font-size'), fin(pv, n, 'font-weight')])
  const secOk = secs.length === 4 && secRead.every(r => r[0].value === '16px' && r[0].source === 'app.wxss' &&
    r[1].value === '600' && r[1].source === 'app.wxss')
  check('PV5 四个章节标题：字号/字重终值来自 app.wxss（16px/600），段距不钉出处（容器节奏合法）',
    secOk, secs.length + ' 个节点；' + secRead.map(r => r.map(describe).join(' ')).join(' ｜ '))
  if (!secOk) viol('PRIVACY', pv.file, '章节标题终值/出处不对：' + secRead.map(r => r.map(describe).join(' ')).join(' ｜ '))
  // 更新日期那行：认类名不认具体文件名（section-sub 是上游那版用的，doc-meta 是本地那版用的，都合法）。
  // 也不钉「节点自身必须有 margin-top」——上游那版由父容器 .section-head 的节奏承载间距，钉自身声明又是绑形状。
  // 这条真正要守的不变量只有一个：**这一行的间距不得由内联 style 决定**（A-23/B-11 那一族）。
  const dateLine = pv.nodes.filter(n => n.classes.indexOf('doc-meta') !== -1 || n.classes.indexOf('section-sub') !== -1)
  const dl = dateLine[0]
  check('PV6 更新日期那行唯一、无内联 style，间距由样式表（自身或祖先）承载',
    dateLine.length === 1 && (dl.inline || []).length === 0,
    dateLine.length + ' 个候选行：' + (dl ? describe(fin(pv, dl, 'margin-top')) + ' inline=' + (dl.inline || []).length : '无'))
  if (!(dateLine.length === 1 && (dl.inline || []).length === 0)) viol('PRIVACY', pv.file, '更新日期那行缺失，或间距仍由内联决定')
  check('PV7 container/h1/h2 三个名字在本屏彻底消失（既没用也没在本作用域定义 ⇒ 不留第二套层级）',
    ['container', 'h1', 'h2'].every(c => !pv.nodes.some(n => n.classes.indexOf(c) !== -1) && definerRules(pv.scope, c).length === 0),
    ['container', 'h1', 'h2'].filter(c => pv.nodes.some(n => n.classes.indexOf(c) !== -1) || definerRules(pv.scope, c).length).join(','))
  check('PV8 正文两档与强调仍在 privacy.wxss 定义（本批没把 .p/.li/.dot 顺手擦掉，B-16 那条字重读数不受害）',
    ['p', 'li', 'dot'].every(c => definerRules(pv.scope, c).length > 0),
    ['p', 'li', 'dot'].map(c => c + ':' + definerRules(pv.scope, c).length).join(' '))
  check('PV9 privacy 不是 tab 页这一事实由 app.json 现读，不抄名单（tabBar.list ' + tabPaths.size + ' 项，含 privacy = ' + pv.isTab + '）',
    tabPaths.size >= 1 && pv.isTab === false, Array.from(tabPaths).join(','))
}

/* ===================== §5 内联样式 ===================== */
section('§5 privacy 这一屏：样式不再由内联 style 决定（A-23/B-11 同族）')
{
  const pv = unit('privacy')
  const loadBearing = []
  const redundant = []
  pv.nodes.forEach(n => {
    n.inline.forEach(d => {
      const sheet = finalOf(cascade(pv.scope, { tag: n.tag, classes: n.classes }), d.prop, appParsed.tokens)
      const want = String(resolveVars(d.val, appParsed.tokens).raw).trim()
      if (sheet.missing || sheet.value !== want) loadBearing.push(n.tag + '@L' + n.line + ' ' + d.prop + ':' + want + '（样式表解出 ' + (sheet.missing ? '无' : sheet.value) + '）')
      else redundant.push(n.tag + '@L' + n.line + ' ' + d.prop)
    })
  })
  loadBearing.forEach(x => viol('INLINE', 'pages/privacy/privacy.wxml', x))
  check('I1 0 处内联声明在承重（样式表给不出同值 ⇒ 这条样式实际由内联决定 = 坏形态）',
    loadBearing.length === 0, loadBearing.join(' ｜ '))
  const withStyle = pv.nodes.filter(n => n.inline.length).length
  check('I2 本屏 style 属性数 = 0（判据原文「换成类」的直接形态；读数 ' + withStyle + '，其中承重 0 / 冗余 ' + redundant.length + '）',
    withStyle === 0 && redundant.length === 0)
  if (!(withStyle === 0)) viol('INLINE', 'pages/privacy/privacy.wxml', '本屏仍有 ' + withStyle + ' 个 style 属性')
  const other = LIVING.filter(d => d !== 'privacy').reduce((n, id) => n + unit(id).nodes.filter(x => x.inline.length).length, 0)
  note('其余四页的内联 style 共 ' + other + ' 处（A-23/B-11 的账，归其它批次；本批写入集不含它们，见 handoff）')
}

/* ===================== §6 不新增色值/token ===================== */
section('§6 铁律 17：本批没有引入任何新色值或新 token')
{
  const NEW = ['.card-label', '.doc-meta', '.doc-section']
  const offenders = []
  const COLORPROPS = /^(color|background|background-color|border|border-color|border-\w+|outline|box-shadow|fill|stroke)$/
  ;[['app.wxss', appParsed], ['pages/privacy/privacy.wxss', unit('privacy').scope[1]]].forEach(pair => {
    pair[1].rules.forEach(r => {
      if (NEW.indexOf(r.sel) === -1) return
      if (COLORPROPS.test(r.prop)) offenders.push(pair[0] + ' ' + r.sel + '{' + r.prop + '}')
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(r.val)) offenders.push(pair[0] + ' ' + r.sel + '{' + r.prop + ':' + r.val + '}')
      if (/^--/.test(r.prop)) offenders.push(pair[0] + ' ' + r.sel + '{' + r.prop + '} 新 token')
    })
  })
  offenders.forEach(x => viol('COLOR', x, '本批新增规则里出现了颜色/token 声明'))
  check('C1 本批新增的三条规则（.card-label/.doc-meta/.doc-section）不含颜色属性、字面色值、新 token',
    offenders.length === 0, offenders.join(' | '))
  const tokCount = Object.keys(appParsed.tokens).length
  const pageTok = appParsed.rules.filter(r => r.sel !== 'page' && /^--/.test(r.prop)).length
  check('C2 token 仍只在 app.wxss 的 page 块声明（实测 ' + tokCount + ' 个，非 page 块的 token 声明 ' + pageTok + ' 处）',
    pageTok === 0 && tokCount >= 25, tokCount + '/' + pageTok)
  check('C3 单位口径：本批新增声明一律 px（privacy 原有 .p/.li 的 27rpx 是 E-09 的账，本批未动、也不由本门判）',
    appParsed.rules.concat(unit('privacy').scope[1].rules).filter(r => NEW.indexOf(r.sel) !== -1 && /rpx/.test(r.val)).length === 0,
    appParsed.rules.concat(unit('privacy').scope[1].rules).filter(r => NEW.indexOf(r.sel) !== -1 && /rpx/.test(r.val)).map(r => r.sel + r.val).join(' '))
}

/* ===================== §7 规范文档登记 ===================== */
section('§7 提升为全局的 .card-label 已登记，且文档数值与代码终值一致')
{
  check('D0 规范文档可读', exists(DOC), DOC)
  const doc = exists(DOC) ? rd(DOC) : ''
  const rows = doc.split(/\r?\n/).filter(l => /^\|\s*`\.card-label`\s*\|/.test(l))
  check('D1 design-system.md 的字号表里有且只有一行 `.card-label`（登记处两份 = 文档侧双真值源）',
    rows.length === 1, rows.length + ' 行')
  if (rows.length !== 1) viol('REG', 'design-system.md', '.card-label 登记行数 = ' + rows.length)
  const mu = unit('me')
  const mn = nodeOf(mu, 'card-label')
  const got = ['font-size', 'font-weight', 'margin-bottom'].map(p => finSheet(mu, mn, p))
  const parity = rows.length === 1 && got.every(g => rows[0].indexOf(g.value) !== -1)
  check('D2 文档那一行的数值 = 代码解出的终值（' + got.map(g => g.value).join('/') + '；文档说别的 ⇒ 红）',
    parity, 'row=' + JSON.stringify((rows[0] || '').slice(0, 90)))
  if (rows.length === 1 && !parity) viol('REG', 'design-system.md', '.card-label 行的数值与代码终值分叉 ' + got.map(g => g.value).join('/'))
  check('D3 登记说明写清它是「卡内小标题」语义且五页共用（否则下一个维护者继续当它是 me 私有）',
    rows.length === 1 && /卡内|小标题/.test(rows[0]) && /5|五/.test(rows[0]), (rows[0] || '').slice(0, 60))
  const stale = doc.split(/\r?\n/).filter(l => /card-label/.test(l) && /me\.wxss/.test(l) && !/原|曾|此前|不是/.test(l))
  check('D4 文档里没有「card-label 属于 me.wxss」这类旧描述残留（旧描述会让四页继续不生效）', stale.length === 0, stale.join(' | '))
  if (stale.length) viol('REG', 'design-system.md', '仍有 ' + stale.length + ' 行把 card-label 说成 me 页私有')
}

/* ===================== 汇总 ===================== */
section('§9 读数闭合')
const e10 = VIOL.filter(v => v.indexOf('|E10|') !== -1).length
check('Z1 E10 违例行数 = 命中数（' + e10 + ' = ' + HITS.length + '；漏一条就是违例账本与读数不同步）', e10 === HITS.length)
const uniq = new Set(VIOL).size
check('Z2 违例账本去重后 ' + uniq + ' 条，分类：E10 ' + e10 + ' / SRC ' + VIOL.filter(v => /\|SRC\|/.test(v)).length +
  ' / PRIVACY ' + VIOL.filter(v => /\|PRIVACY\|/.test(v)).length + ' / INLINE ' + VIOL.filter(v => /\|INLINE\|/.test(v)).length +
  ' / COLOR ' + VIOL.filter(v => /\|COLOR\|/.test(v)).length + ' / REG ' + VIOL.filter(v => /\|REG\|/.test(v)).length, uniq === VIOL.length)
console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
