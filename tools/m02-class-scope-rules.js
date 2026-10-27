'use strict'
// M-02（E-08 第 (10) 条）类定义作用域 · 判据模块：tools/m02-class-scope-rules.js
//
// 本文件是**判据本体**（唯一出处，铁律 11）：CSS 层叠解析 + WXML class token 提取 +
// 逐作用域「这个类在这里到底有没有定义」的判定。断言套件 tools/m02-class-scope-test.js 与
// 预提交闸 tools/check.js 都 require 这一份——判据装在没人跑的门里等于没有门（E-08 的指控本体）。
//
// 判据的三条硬要求（沿用套件顶部，不是自创）：
// ① **逐作用域比对，不许把全仓选择器汇成一个池**。作用域 =
//   页面：app.wxss + 同页 wxss；组件：同组件 wxss，且**仅当**它声明 styleIsolation:'apply-shared' 时才算上 app.wxss；
//   custom-tab-bar：按它自己 index.js 里的隔离声明同样处理（铁律 14 点名它必须自包含）。
//   汇池就是前任探针漏掉 E-15 的原因：me.wxss 那份定义会掩盖另外四页的缺失。
// ② **三种形态不是「无定义」**，一律排除并各有自证用例：`hover-class="…"`、整段 `{{…}}`
//   （含三元里的比较字面量）、部分插值 `prefix--{{x}}`（做法是把 mustache 换成哨兵 \u0000，与哨兵粘连的 chunk 整段不判）。
// ③ 判据只看「在这个作用域里解不解析得出定义」，**不读注释、不认文件名**（tools/m02-class-scope-mutate.js 的 E 组当场验）。
//
// 沙盒：M02_MP_ROOT 指向一份 miniprogram 副本（变异自证用）；缺省 = 真实仓库。
// 独立执行：node tools/m02-class-scope-rules.js ⇒ 打印 G10 的真实仓库读数与夹具自证，退出码 0/1。
const fs = require('fs')
const path = require('path')

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
// 「这个组件/自定义 tabBar 能不能看见 app.wxss」只看它自己 options 里的 styleIsolation 声明（铁律 14）。
// 一份判据两处共用（组件与 custom-tab-bar），不在第二个地方复制第二遍正则。
function applySharedOf (jsText) { return /styleIsolation[^'"]*['"]apply-shared['"]/.test(String(jsText)) }
// 一个单元自己的样式表；文件可以不存在（微信允许无样式组件/页面），不存在就是空表而不是崩。
function ownParsed (ownRel) {
  const abs = path.join(MP, ownRel)
  return parse(exists(abs) ? rd(abs) : '', ownRel)
}
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
  const shared = applySharedOf(js)
  UNITS.push({
    kind: 'comp', id: 'components/' + c, file: 'components/' + c + '/' + c + '.wxml', ownRel, applyShared: shared,
    nodes: nodesOf(rd(w)),
    // 组件的 wxss 是可选文件（微信允许无样式组件），取不到就当空表，不能让本门崩在 require 上
    scope: shared ? [appParsed, ownParsed(ownRel)] : [ownParsed(ownRel)]
  })
})
// custom-tab-bar 与 components/ 同级、不在其下，铁律 14 点名它「必须完全自包含」——
// 这一层此前不在本门扫描面里（E-08 (10) 落门时补上）：它同样只看自己 index.js 的 styleIsolation 声明。
const TB = path.join(MP, 'custom-tab-bar')
if (exists(path.join(TB, 'index.wxml'))) {
  const ownRel = 'custom-tab-bar/index.wxss'
  const shared = applySharedOf(exists(path.join(TB, 'index.js')) ? rd(path.join(TB, 'index.js')) : '')
  UNITS.push({
    kind: 'tabbar', id: 'custom-tab-bar', file: 'custom-tab-bar/index.wxml', ownRel, applyShared: shared,
    nodes: nodesOf(rd(path.join(TB, 'index.wxml'))),
    scope: shared ? [appParsed, ownParsed(ownRel)] : [ownParsed(ownRel)]
  })
}
function unit (id) { const u = UNITS.filter(x => x.id === id)[0]; if (!u) throw new Error('没有这个作用域单元：' + id); return u }
function nodeOf (u, cls, idx) { const n = u.nodes.filter(x => x.classes.indexOf(cls) !== -1); return n[idx || 0] }
function nodesWith (u, cls) { return u.nodes.filter(x => x.classes.indexOf(cls) !== -1) }
function fin (u, node, prop) { return finalOf(cascade(u.scope, { tag: node.tag, classes: node.classes }, node.inline), prop, appParsed.tokens) }
// 只看**样式表**解出的终值（不吃内联）：§2 问的是「这个类本身给出什么」，内联覆盖另立读数（U3）
function finSheet (u, node, prop) { return finalOf(cascade(u.scope, { tag: node.tag, classes: node.classes }), prop, appParsed.tokens) }
/* ===================== 判定核：逐作用域「用了但没定义」 ===================== */
// scanUnits 是**唯一**的判定实现：套件、check.js、本文件独立执行三条路都调它（一份判据，三种用法）。
// 返回按 (文件, 行, 类名) 稳定排序的命中清单；格式化（why/stat）也在这儿做一次，
// 三个消费方拿到的解释文本因此是同一句（否则闸说 A、套件说 B，读者不知道信哪个）。
function scopeReadout (u) {
  return u.scope.map(pl => pl.source + '（' + pl.rules.filter(r => r.compounds.some(c => c.classes.length)).length + ' 条带类名的规则）').join(' + ')
}
function whyOf (u, c) {
  return '类 `' + c + '` 在本单元生效的样式表里解不出任何定义（作用域 = ' + scopeReadout(u) + '）。' +
    (u.kind !== 'page' && !u.applyShared
      ? '本单元没声明 styleIsolation:\'apply-shared\' ⇒ app.wxss 对它不可见（铁律 14）；'
      : '') +
    '改法只有两条：把定义补进这一层（多页共用的类提升进 app.wxss 并登记进 design-system.md），或改掉这个类名。' +
    '它现在的实际效果是「字号/字重/内缩全部退回 page 默认」，而代码看着像有样式（E-15/E-16 本体）'
}
function scanUnits (units) {
  const hits = []
  units.forEach(u => {
    u.nodes.forEach(n => {
      n.classes.forEach(c => {
        if (!definerRules(u.scope, c).length) hits.push({ unit: u.id, file: u.file, line: n.line, cls: c, kind: u.kind, why: whyOf(u, c) })
      })
    })
  })
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.cls.localeCompare(b.cls))
  return hits
}

/* ===================== 真实仓库的一次完整扫描（含「空转即 fatal」自检） ===================== */
// check.js 落门纪律：输入读不出来 ⇒ 报「无法工作」而不是报「命中 0」。
// check.js:131 那条 Windows 路径分隔符导致清单为空、整个反向检查静默空转的事故就是没有这一层。
function scan () {
  const pages = UNITS.filter(u => u.kind === 'page').length
  const comps = UNITS.filter(u => u.kind === 'comp').length
  const tabbar = UNITS.filter(u => u.kind === 'tabbar').length
  if (!appParsed.rules.length) return { fatal: 'app.wxss 解析出 0 条规则 ⇒ 全局那一层是空的，逐作用域判定没有输入' }
  if (!UNITS.length) return { fatal: '一个作用域单元都没装载（pages/components/custom-tab-bar 的枚举失效）⇒ 本门会静默空转' }
  const empty = UNITS.filter(u => !u.nodes.length).map(u => u.id)
  if (empty.length) return { fatal: '这些单元的 WXML 解析出 0 个节点：' + empty.join(', ') + ' ⇒ 读不到输入不等于没有违例' }
  const tokens = UNITS.reduce((n, u) => n + u.nodes.reduce((k, x) => k + x.classes.length, 0), 0)
  if (!tokens) return { fatal: '全仓解析出 0 个静态 class token ⇒ 提取式没在工作（大概率是属性形态变了，见 §0 的 P9 前提门）' }
  const noOwn = UNITS.filter(u => !u.scope.some(pl => pl.rules.length)).map(u => u.id)
  return {
    hits: scanUnits(UNITS),
    stat: '作用域单元 ' + UNITS.length + ' 个（页面 ' + pages + ' / 组件 ' + comps + ' / custom-tab-bar ' + tabbar +
      '）；静态 class token ' + tokens + ' 个；app.wxss 定义 ' + appParsed.classNames.size + ' 个类名' +
      (noOwn.length ? '；⚠ 这些单元连自己的样式表都没解析出规则：' + noOwn.join(', ') : ''),
  }
}

/* ===================== 门标题（check.js 打印用，判据解释文本的唯一出处） ===================== */
const TITLE = 'WXML 用的每个 class token 必须在它真正生效的那层样式表里有定义（逐作用域判、不汇池；E-15/E-16 本体）'

/* ===================== 夹具自证（合成作用域：正例必红、反例必绿） ===================== */
// 为什么必须在这儿再来一组，而不靠套件的 §0/§1：check.js 每次跑的是 scan()，它一旦因为
// 装载改动而「什么都扫不到」，真实仓库仍然 0 命中、照样全绿——夹具喂的是**已知有/没有**的输入，
// 扫不出来就红。这一组也顺带钉住「组件不看 app.wxss、除非它自己声明了 apply-shared」这条作用域边界。
function fixtureUnit (o) {
  const kind = o.kind || 'page'
  const appP = parse(o.app || '', 'app.wxss')
  const ownRel = o.ownRel || ('pages/' + o.id + '/' + o.id + '.wxss')
  const ownP = parse(o.own || '', ownRel)
  const scope = kind === 'page' || o.applyShared ? [appP, ownP] : [ownP]
  return { kind: kind, id: o.id, file: o.file || (ownRel.replace(/\.wxss$/, '.wxml')), ownRel,
    applyShared: !!o.applyShared, nodes: nodesOf(o.wxml || ''), scope, isTab: !!o.isTab }
}

const SELF_CASES = [
  { id: 'F1 页面用一个全仓没人定义的类名（E-16 的 container/h1/h2 本体）⇒ 必红',
    unit: { id: 'mk', app: '.page { padding: 24px }', own: '.mk-real { color: red }', wxml: '<view class="page mk-ghost"><text class="mk-real">x</text></view>' },
    expect: ['mk-ghost'] },
  { id: 'F2 反例：页面用的类名由本页 wxss 定义 ⇒ 绿（同作用域内有定义）',
    unit: { id: 'mk', app: '.page { padding: 24px }', own: '.mk-real { color: red }', wxml: '<view class="mk-real">x</view>' }, expect: [] },
  { id: 'F3 反例：页面用的类名只在 app.wxss 定义 ⇒ 绿（页面本来就看得见全局层）',
    unit: { id: 'mk', app: '.g-card { color: red }', own: '', wxml: '<view class="g-card">x</view>' }, expect: [] },
  { id: 'F4 组件没声明 apply-shared 却用全局类 ⇒ 必红（铁律 14 那一形：var 解析得出、.card 一条样式都没有）',
    unit: { id: 'components/mk', kind: 'comp', app: '.g-card { color: red }', own: '.mk-local { color: blue }',
      wxml: '<view class="g-card mk-local">x</view>',
      ownRel: 'components/mk/mk.wxss', file: 'components/mk/mk.wxml' }, expect: ['g-card'] },
  { id: 'F5 反例：同一个组件声明了 apply-shared ⇒ 绿（作用域边界由组件自己的 options 决定，不是文件名）',
    unit: { id: 'components/mk', kind: 'comp', applyShared: true, app: '.g-card { color: red }', own: '.mk-local { color: blue }',
      wxml: '<view class="g-card mk-local">x</view>',
      ownRel: 'components/mk/mk.wxss', file: 'components/mk/mk.wxml' }, expect: [] },
  { id: 'F6 排除形态：hover-class 里的名字没有定义 ⇒ 绿（它不是 class）',
    unit: { id: 'mk', app: '', own: '.mk-real { color: red }', wxml: '<view class="mk-real" hover-class="mk-hover-ghost">x</view>' }, expect: [] },
  { id: 'F7 排除形态：整段 {{…}}（含三元比较字面量）里的名字没有定义 ⇒ 绿（动态名不由本门判）',
    unit: { id: 'mk', app: '', own: '.mk-real { color: red }', wxml: "<view class=\"mk-real {{flag ? 'mk-ghost-ternary' : ''}}\">x</view>" }, expect: [] },
  { id: 'F8 排除形态：部分插值 prefix--{{k}} ⇒ 绿（半个 token 不该被拿去查定义）',
    unit: { id: 'mk', app: '', own: '.mk-real { color: red }', wxml: '<view class="mk-real mk-prefix--{{k}}">x</view>' }, expect: [] },
  { id: 'F9 一个节点两个类、只定义其中一个 ⇒ 只报缺的那枚（命中粒度到 token，不到节点）',
    unit: { id: 'mk', app: '.g-card { color: red }', own: '', wxml: '<view class="g-card mk-ghost">x</view>' }, expect: ['mk-ghost'] },
  { id: 'F10 反例回到 E-15 本体：同一枚类名在**别的作用域**有定义不算（汇池才会掩盖）',
    unit: { id: 'mk', kind: 'comp', app: '', own: '.mk-real { color: red }', wxml: '<view class="mk-other">x</view>',
      ownRel: 'components/mk/mk.wxss', file: 'components/mk/mk.wxml' }, expect: ['mk-other'] },
]

function selfProof () {
  const bad = []
  for (const c of SELF_CASES) {
    const u = fixtureUnit(c.unit)
    if (!u.nodes.length) { bad.push(c.id + '：夹具的 WXML 解析出 0 个节点 ⇒ 这一组什么都没判（假绿）'); continue }
    const got = scanUnits([u]).map(h => h.cls)
    const uniq = Array.from(new Set(got)).sort()
    const want = (c.expect || []).slice().sort()
    if (uniq.join(' ') !== want.join(' ')) bad.push(c.id + '：期望命中 [' + want.join(', ') + '] 实际 [' + uniq.join(', ') + ']')
  }
  return bad
}

module.exports = {
  ROOT, MP, DOC, UNITS, appParsed, appJson, tabPaths,
  rd, exists, stripComments, splitTop, expand, parseDecls, specificity, cmpSpec, compoundOf, parse,
  matchesNode, cascade, resolveVars, finalOf, describe, definerRules, classTokensOf, nodesOf,
  applySharedOf, ownParsed,
  unit, nodeOf, nodesWith, fin, finSheet,
  scanUnits, scan, fixtureUnit, selfProof, SELF_CASES, TITLE, whyOf,
}

// ================= 独立执行：G10 的真实仓库读数 + 夹具自证 =================
// 为什么允许单独跑：check.js 里落的是同一份 scan()（判据不复制第二份，铁律 11），
// 改完样式想先看「本门会怎么判」就跑这个；退出码 0 = 自证通过且命中 0。
if (require.main === module) {
  const bad = selfProof()
  console.log('== G10 类定义作用域 · 独立读数（' + MP + '）==')
  console.log('夹具自证：' + SELF_CASES.length + ' 组 ⇒ ' + (bad.length ? 'FAIL ' + bad.length + ' 条' : '全部符合预期'))
  bad.forEach(b => console.log('  ✗ ' + b))
  const r = scan()
  if (r.fatal) { console.log('  ✗ G10 没有输入，判据无法工作：' + r.fatal); process.exit(1) }
  console.log('  · ' + r.stat)
  r.hits.forEach(h => console.log('  ✗ ' + h.file + ':' + h.line + ' 类 `' + h.cls + '` 在 ' + h.unit + ' 的作用域里没有定义'))
  console.log(r.hits.length || bad.length ? '\n读数：有红（命中 ' + r.hits.length + ' 处 / 自证失败 ' + bad.length + ' 条）' : '\n读数：命中 0，自证通过')
  process.exit(r.hits.length || bad.length ? 1 : 0)
}
