'use strict'
// SWX1 — 全局样式表（app.wxss / custom-tab-bar/index.wxss）与设计系统注册表的行为判据。
//
// 为什么全部走「解析 + 层叠解终值」而不是 grep 源码文本（铁律 30）：
// 本仓库有一条钉源码文本的静态门，在合法重构（将代码搬家）之后立刻假红，而它声称保护的行为一点没变。
// 样式表最容易犯的是同一种错：判据记住的是「那行 CSS 长什么样」，可真正决定像素的是
// 「这个节点在层叠之后拿到什么值」。所以下面每一条都是：
//   ① 把 .wxss 解析成规则 + 声明；② 按选择器匹配节点；③ 按特异度与书写次序解出**每个属性的赢家**；
//   ④ 把 var() 递归解析到 page 上的实际值；⑤ 断言数值 / 来源 / 空集。
// 类名出现次数、注释、某行是否被改写过 —— 一律不作证据（铁律 21）。
//
// 覆盖的四条 finding：
//   M-06  .segmented .seg 的触控高度必须吃 --touch-target（影子改 token 必须跟着动），
//         未选中态文字对轨道底色的 WCAG 对比度必须过仓库自家 4.5:1（12px 属正文，无大字放宽）。
//   E-12  tabbar 只能有一个真值源，且每个终值声明的**来源**必须是 custom-tab-bar/index.wxss
//         （值巧合相等不算通过 —— 那正是这个缺陷被掩盖两年的原因）。
//   M-16  三处承载用户自由输入的类，层叠后的终值里必须真的有「能算进 min-content」的断行策略；
//         并验证高特异度变体规则不会把它擦掉（feature/hero 变体是真实的踩点）。
//   B-14  删掉的死定义不许复活（节点终值必须是空集）、留下的活定义不许误删（has-sticky 终值 120px）、
//         删 token 之后全仓不得留下悬空 var() 引用。
//
// 运行：node tools/swx1-style-gates-test.js
// 退出码：0 全绿；1 有断言红。变异自证见 tools/swx1-style-gates-mutate.js。
const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
const failures = []
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else {
    failed++; const line = '  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')
    console.log(line); failures.push(line.trim())
  }
}
function section (t) { console.log('== ' + t + ' ==') }

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
// 沙盒可整体换根（mutate 脚本把 miniprogram 复制到临时目录后跑本文件）
const BASE = process.env.SWX1_MP || MP
const APP = path.join(BASE, 'app.wxss')
const TAB = path.join(BASE, 'custom-tab-bar', 'index.wxss')

/* ============================ 解析层 ============================ */
function stripComments (css) { return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) }
function parseDecls (body) {
  const out = []
  body.split(';').forEach(chunk => {
    const s = chunk.trim()
    if (!s) return
    const i = s.indexOf(':')
    if (i < 0) return
    out.push({ prop: s.slice(0, i).trim().toLowerCase(), val: s.slice(i + 1).trim() })
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
// 只拆「后代组合器」；本仓库两个目标文件里没有 > + ~，有就原样当一个 compound（宁可少匹配也不虚断言）
function compoundsOf (sel) {
  return sel.trim().split(/\s+/).filter(Boolean).map(part => {
    const cls = (part.match(/\.[\w-]+/g) || []).map(s => s.slice(1))
    const attrs = (part.match(/\[[^\]]+=["']?([\w-]+)["']?\]/g) || []).length
    return { classes: cls, tag: /^([a-zA-Z][\w-]*)/.test(part) ? part.match(/^([a-zA-Z][\w-]*)/)[1] : null, attrs }
  })
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
    selText.split(',').forEach(sel => {
      const compounds = compoundsOf(sel)
      if (!compounds.length) return
      parseDecls(m[2]).forEach(d => rules.push({ sel, compounds, spec: specificity(sel), prop: d.prop, val: d.val, order: order++, source }))
    })
  }
  const tokens = {}
  rules.filter(r => r.sel === 'page' && /^--/.test(r.prop)).forEach(r => { tokens[r.prop] = r.val })
  return { rules, tokens }
}
function compoundMatches (c, node) {
  // 元素选择器在本判据里只服务 page 上的 token 与全局默认，不参与节点级终值比较（见 §9 说明）
  if (c.tag && c.tag !== node.tag) return false
  if (c.attrs) return false // 属性形态不参与本判据（两个目标文件里没有）
  return c.classes.every(x => node.classes.indexOf(x) !== -1)
}
function matches (compounds, chain) {
  if (compounds.length > chain.length) return false
  let ci = chain.length - 1
  for (let i = compounds.length - 1; i >= 0; i--) {
    if (!compoundMatches(compounds[i], chain[ci])) return false
    ci--
  }
  return true
}
// 解出该节点每个属性的最终赢家（含来源文件 —— E-12 判的是「谁决定」而不是「值凑不凑巧」）
function finalMap (sources, chain) {
  const best = {}
  sources.forEach(parsed => parsed.rules.forEach(r => {
    if (r.prop.indexOf('--') === 0) return // token 定义走 parsed.tokens，不是节点的可视属性
    if (!matches(r.compounds, chain)) return
    const cur = best[r.prop]
    // 同特异度时**后写的赢**：赢家记录必须带上 order，否则 r.order > cur.order 永远比的是
    // undefined（577 > undefined === false），解出来的会是「第一条命中的规则」而不是最终层叠结果 ——
    // 这个 bug 是 T9.6（后置相反声明必须赢）报红才暴露的，而它同时会让 §2 的来源判据失真。
    if (!cur || cmpSpec(r.spec, cur.spec) > 0 || (cmpSpec(r.spec, cur.spec) === 0 && r.order > cur.order)) {
      best[r.prop] = { val: r.val, sel: r.sel, source: r.source, spec: r.spec, order: r.order }
    }
  }))
  return best
}
// var() 递归解析到 page 上的实际值；解析不到就标 unresolved（绝不回落猜值）
function resolveVal (val, tokens, depth) {
  depth = depth || 0
  if (depth > 8) return { raw: val, cyclic: true }
  let out = String(val)
  const mv = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(out.trim())
  if (mv) {
    const hit = tokens[mv[1]]
    if (hit === undefined) return mv[2] === undefined ? { raw: out, unresolved: true } : resolveVal(mv[2], tokens, depth + 1)
    return resolveVal(hit, tokens, depth + 1)
  }
  let unresolved = false
  out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*[^()]*\))?/g, (all, name, fb) => {
    const hit = tokens[name]
    if (hit !== undefined) return hit
    if (fb !== undefined) return fb.replace(/^,\s*/, '')
    unresolved = true
    return all
  })
  return unresolved ? { raw: out, unresolved: true } : { raw: out }
}
function finalResolved (map, prop, tokens) {
  const d = map[prop]
  if (!d) return null
  const r = resolveVal(d.val, tokens)
  if (r.unresolved) return { unresolved: true, sel: d.sel, source: d.source, raw: r.raw }
  return { val: String(r.raw).trim(), sel: d.sel, source: d.source, decl: d.val }
}
/* 颜色：把最终值归一成 #rrggbb（拿不到就不判，不猜） */
function asHex (v) {
  if (!v) return null
  const s = String(v).trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map(c => c + c).join('')
  return null
}
function lin (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function luminance (hex) {
  return 0.2126 * lin(parseInt(hex.slice(1, 3), 16)) + 0.7152 * lin(parseInt(hex.slice(3, 5), 16)) + 0.0722 * lin(parseInt(hex.slice(5, 7), 16))
}
function contrast (a, b) {
  const A = luminance(a); const B = luminance(b)
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05)
}
/* 节点模型：chain[0] 是最外层祖先，最后一项是节点自己 */
function N (classes, tag) { return { classes: classes.slice(), tag: tag || 'view' } }
function chainOf () { return Array.prototype.slice.call(arguments).map(a => (Array.isArray(a) ? N(a) : a)) }

/* ============================ 读取 ============================ */
const appText = fs.readFileSync(APP, 'utf8')
function eolProbe () { return appText.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }
const tabText = fs.readFileSync(TAB, 'utf8')
const app = parse(appText, 'app.wxss')
const tab = parse(tabText, 'custom-tab-bar/index.wxss')
const TOKENS = app.tokens
const BOTH = [app, tab]
let readFailures = 0

// 全仓 wxml 的 class 引用普查（供「死定义/活依赖」计数用；只读，不改任何文件）
function walk (dir, acc) {
  acc = acc || []
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, acc) } else acc.push(p)
  })
  return acc
}
const files = walk(BASE)
const wxmlFiles = files.filter(f => /\.wxml$/.test(f))
const jsFiles = files.filter(f => /\.js$/.test(f))
const TRACKED = ['has-sticky', 'with-tabbar', 'tabbar-safe']
const classUse = {}
wxmlFiles.forEach(f => {
  const t = fs.readFileSync(f, 'utf8')
  ;(t.match(/class="[^"]*"/g) || []).forEach(attr => {
    attr.slice(7, -1).replace(/\{\{[\s\S]*?\}\}/g, m => m.replace(/[{}]/g, ' ')).split(/[\s,'"`]+/).forEach(c => {
      if (/^[a-zA-Z][\w-]*$/.test(c)) classUse[c] = (classUse[c] || 0) + 1
    })
  })
})
jsFiles.forEach(f => {
  const t = fs.readFileSync(f, 'utf8')
  // JS 里以字符串拼类名是合法的（本仓库 has-sticky 就出现在 wxml 的三元表达式里），
  // 所以这三个被追踪的类按「是否作为子串出现在任何 js 源码里」补一次计数，宁多计不少计。
  TRACKED.forEach(c => { if (t.indexOf(c) !== -1) classUse[c] = (classUse[c] || 0) + 1 })
})
const uses = c => classUse[c] || 0

/* ============================ 判据本体（可被影子文本复用） ============================ */
const SEG_OFF = chainOf(['segmented'], ['seg'])
const SEG_ON = chainOf(['segmented'], ['seg', 'on'])
const OVERFLOW_NODES = [
  ['活动标题', chainOf(['activity-card'], ['activity-card__title'])],
  ['精选卡标题', chainOf(['activity-card', 'activity-card--featured'], ['activity-card__title'])],
  ['人员行姓名', chainOf(['person-row__body'], ['person-row__heading'], ['person-name'])],
  ['指标值', chainOf(['metrics'], ['metric'], ['metric-value'])],
  ['hero 内指标值', chainOf(['hero'], ['metrics', 'hero-body'], ['metric'], ['metric-value'])]
]
// 只有「能算进 min-content」的取值才算实际生效：
//   overflow-wrap: anywhere —— 会把断点算进 min-content（flex 项里唯一真正起作用的写法）
//   word-break: break-all —— 同样产生 min-content 断点（本仓库 .code-text 用的就是它）
//   overflow-wrap: break-word —— **不算**（规范里它不改变 min-content，flex 子项里长串照样撑爆 = 写了等于没写）
// 这条判据的取值集合是变异 M9 教出来的：第一版把 'break' 当成子串混进了白名单，break-word 蒙混过关。
function isBreaking (found) {
  return found.filter(x => {
    const tokens = String(x.r.val).toLowerCase().split(/[\s,;]+/).filter(Boolean)
    if (x.p === 'overflow-wrap') return tokens.indexOf('anywhere') !== -1
    if (x.p === 'word-break') return tokens.indexOf('break-all') !== -1 || tokens.indexOf('anywhere') !== -1
    return false
  })
}

function gradeM06 (parsed) {
  const bad = []
  const off = finalMap([parsed], SEG_OFF)
  const mh = finalResolved(off, 'min-height', parsed.tokens)
  if (!mh) bad.push('T1.1 .seg 没有 min-height 终值')
  else if (mh.unresolved) bad.push('T1.1 .seg min-height 解析不到实际值（悬空 var）')
  else if (parseFloat(mh.val) < 44) bad.push('T1.1 .seg min-height=' + mh.val + ' < 44px')
  const track = finalMap([parsed], chainOf(['segmented']))
  const trackBg = finalResolved(track, 'background', parsed.tokens) || finalResolved(track, 'background-color', parsed.tokens)
  const color = finalResolved(off, 'color', parsed.tokens)
  const ch = asHex(color && color.val); const th = trackBg && asHex(trackBg.val)
  if (!ch || !th) bad.push('T1.3 拿不到未选中态字色或轨道底色（不猜对比度）')
  else if (contrast(ch, th) < 4.5) bad.push('T1.3 未选中态对比度 ' + contrast(ch, th).toFixed(2) + ':1 < 4.5:1（' + ch + ' on ' + th + '）')
  return { bad, mh, ch, th, color, trackBg }
}
function gradeTabProvenance (appParsed, tabParsed) {
  const bad = []
  const nodes = [['tabbar 根', chainOf(['tabbar'])], ['未选中 tab', chainOf(['tabbar'], ['tab'])], ['选中 tab', chainOf(['tabbar'], ['tab', 'on'])]]
  nodes.forEach(pair => {
    const name = pair[0]; const chain = pair[1]
    const both = finalMap([appParsed, tabParsed], chain)
    const alone = finalMap([tabParsed], chain)
    Object.keys(both).forEach(p => {
      if (both[p].source !== 'custom-tab-bar/index.wxss') bad.push('T2.1 ' + name + ' 的 ' + p + ' 由 ' + both[p].source + '（' + both[p].sel + '）决定')
      const a = both[p]; const b = alone[p]
      const va = resolveVal(a.val, appParsed.tokens); const vb = b ? resolveVal(b.val, appParsed.tokens) : { raw: undefined }
      if (String(va.raw) !== String(vb.raw)) bad.push('T2.2 ' + name + ' 的 ' + p + ' 在收敛后从 ' + vb.raw + ' 变成 ' + va.raw)
    })
    Object.keys(alone).forEach(p => { if (!both[p]) bad.push('T2.2 ' + name + ' 收敛后丢了 ' + p) })
  })
  return bad
}

/* ============================ §1 M-06 ============================ */
section('§1 M-06 分段控件：尺寸吃 token、未选中态过对比门（终值判据）')
const g1 = gradeM06(app)
readFailures += g1.bad.length
g1.bad.forEach(b => console.log('    · ' + b))
check('T1.1 .seg 的 min-height 终值 ≥ 44px 且可解析（改前实测 36px）', g1.bad.filter(b => b.indexOf('T1.1') === 0).length === 0, g1.mh && g1.mh.val)
check('T1.2 min-height 的终值恰等于 page 上 --touch-target 的实际值（同一支数，不是另写一个 44）',
  !!g1.mh && !g1.mh.unresolved && g1.mh.val === String(resolveVal(TOKENS['--touch-target'], TOKENS).raw).trim(),
  g1.mh && g1.mh.val + ' vs token ' + TOKENS['--touch-target'])
const shadowTouch = (() => {
  const from = /--touch-target:\s*44px/.exec(appText)
  if (!from || (appText.split(from[0]).length - 1) !== 1) return null
  const p = parse(appText.replace(from[0], '--touch-target: 60px'), 'app.wxss')
  return finalResolved(finalMap([p], SEG_OFF), 'min-height', p.tokens)
})()
check('T1.3 影子把 --touch-target 改成 60px ⇒ .seg 的 min-height 终值必须跟着变成 60px（单源可测，不是抄了个数）',
  !!shadowTouch && shadowTouch.val === '60px', shadowTouch && shadowTouch.val)
check('T1.4 未选中态字色对轨道底色的 WCAG 对比度 ≥ 4.5:1（12px 属正文，无大字放宽）',
  !!g1.ch && !!g1.th && contrast(g1.ch, g1.th) >= 4.5,
  g1.ch && g1.th ? contrast(g1.ch, g1.th).toFixed(2) + ':1（' + g1.ch + ' on ' + g1.th + '）' : '拿不到色')
check('T1.5 改前该组合确实是红的：把字色与轨道底色按缺陷形状重算必须 <4.5（门不是空转）',
  !!g1.th && contrast('#5F6E66', g1.th) < 4.5,
  g1.th ? '缺陷形 #5F6E66 on ' + g1.th + ' = ' + contrast('#5F6E66', g1.th).toFixed(2) + ':1' : '')
const onMap = finalMap(BOTH, SEG_ON)
const onColor = finalResolved(onMap, 'color', TOKENS)
const onBg = finalResolved(onMap, 'background', TOKENS)
const onPair = onColor && onBg && asHex(onColor.val) && asHex(onBg.val)
check('T1.6 选中态仍过对比门（白底药丸 + --forest），且区分线索不是「把未选中印淡」',
  !!onPair && contrast(asHex(onColor.val), asHex(onBg.val)) >= 4.5 && contrast(g1.ch, g1.th) >= contrast(g1.ch, g1.th),
  onPair ? onColor.val + ' on ' + onBg.val : '')
const segOwnBg = finalMap([app], SEG_OFF)['background']
check('T1.7 .seg 自己不铺底（未选中态的底色确实来自轨道，判据没有拿错背景）', !segOwnBg, segOwnBg ? segOwnBg.val : '')
const segFont = finalResolved(finalMap(BOTH, SEG_OFF), 'font-size', TOKENS)
const segLh = finalResolved(finalMap(BOTH, SEG_OFF), 'line-height', TOKENS)
const segPad = finalResolved(finalMap(BOTH, SEG_OFF), 'padding', TOKENS)
check('T1.8 字号/行高/内边距一个都没动（本轮只抬高可点区与改字色，纵向节奏零变化）',
  !!segFont && segFont.val === '12px' && !!segLh && segLh.val === '18px' && !!segPad && segPad.val === '8px 6px',
  [segFont, segLh, segPad].map(x => x && x.val).join(' / '))
const gap = finalResolved(finalMap([app], chainOf(['segmented'])), 'gap', TOKENS)
check('T1.9 分段间距维持 4px（M-06 只治高度与对比度；相邻分段误触的间距取舍属 M-07，不在本条）',
  !!gap && gap.val === '4px', gap && gap.val)
// 铁律 17 的机器形态：全局表里除 page 的 token 定义区之外不得出现字面色值。
// 这条同时堵住 M-06 的另一条歪路 —— 为了让对比度过门而现场发明一个色（custom-tab-bar 是 platform-pitfalls §1
// 明文登记的唯一字面量例外，所以扫描范围只含 app.wxss）。
const literalHex = (() => {
  const lines = stripComments(appText).split(/\r?\n/)
  let inPage = false
  const hits = []
  lines.forEach((l, i) => {
    if (/^page\s*\{/.test(l)) inPage = true
    else if (inPage && /^\}/.test(l)) inPage = false
    if (inPage) return
    const m = l.match(/#[0-9a-fA-F]{3,8}\b/)
    if (m) hits.push((i + 1) + ':' + m[0])
  })
  return hits
})()
check('T1.10 app.wxss 除 page 的 token 定义区外零字面色（改前实测 ' + literalHex.length + '，配色只能引用已登记 token）',
  literalHex.length === 0, literalHex.join(' , '))

/* ============================ §2 E-12 ============================ */
section('§2 E-12 tabbar 只有一个真值源，且「谁决定终值」必须是组件那份')
const g2 = gradeTabProvenance(app, tab)
readFailures += g2.length
g2.slice(0, 4).forEach(b => console.log('    · ' + b))
check('T2.1 tabbar 三个节点上，每一条**赢家声明**的来源都是 custom-tab-bar/index.wxss（值相等不算通过）', g2.filter(b => b.indexOf('T2.1') === 0).length === 0)
check('T2.2 把 app.wxss 从层叠里拿掉，tabbar 的终值集合逐项不变（删除不改变像素的唯一静态可证形态）',
  g2.filter(b => b.indexOf('T2.2') === 0).length === 0)
const appOnly = [app]
const deadNodes = [['tabbar 根', chainOf(['tabbar'])], ['未选中 tab', chainOf(['tabbar'], ['tab'])], ['选中 tab', chainOf(['tabbar'], ['tab', 'on'])]]
const residue = deadNodes.filter(pair => Object.keys(finalMap(appOnly, pair[1])).length)
check('T2.3 app.wxss 单独成层时，对 tabbar 节点贡献**零条**声明（重复块真的没了，不是被压住）',
  residue.length === 0, residue.map(p => p[0]).join(','))
const tabFinal = finalMap(BOTH, chainOf(['tabbar'], ['tab']))
const barFinal = finalMap(BOTH, chainOf(['tabbar']))
const onFinal = finalMap(BOTH, chainOf(['tabbar'], ['tab', 'on']))
const specOf = (m, p) => { const r = finalResolved(m, p, TOKENS); return r && !r.unresolved ? String(r.val) : null }
check('T2.4 收敛后 tabbar 规格仍然齐全（删错份会在这里红）：fixed / bottom 0 / z-index 100 / #FFFFFF 底 / #DEE3DB 上边线',
  specOf(barFinal, 'position') === 'fixed' && specOf(barFinal, 'bottom') === '0' && specOf(barFinal, 'z-index') === '100' &&
  asHex(specOf(barFinal, 'background')) === '#ffffff' && /1px solid #DEE3DB/i.test(String(specOf(barFinal, 'border-top'))),
  [specOf(barFinal, 'position'), specOf(barFinal, 'z-index'), specOf(barFinal, 'background'), specOf(barFinal, 'border-top')].join(' | '))
check('T2.5 tab 终值：min-height 44px、color #5F6E66、font-size 12px、border-radius 8px（触控高度没塌）',
  specOf(tabFinal, 'min-height') === '44px' && asHex(specOf(tabFinal, 'color')) === '#5f6e66' &&
  specOf(tabFinal, 'font-size') === '12px' && specOf(tabFinal, 'border-radius') === '8px',
  [specOf(tabFinal, 'min-height'), specOf(tabFinal, 'color'), specOf(tabFinal, 'font-size'), specOf(tabFinal, 'border-radius')].join(' | '))
check('T2.6 选中 tab 终值：#163E35 字 + 600 字重 + 透明底（2026-10-23 视觉收敛去掉药丸底）',
  asHex(specOf(onFinal, 'color')) === '#163e35' && specOf(onFinal, 'font-weight') === '600' &&
  String(specOf(onFinal, 'background')).toLowerCase() === 'transparent',
  [specOf(onFinal, 'color'), specOf(onFinal, 'font-weight'), specOf(onFinal, 'background')].join(' | '))
const tabVar = ['min-height', 'color', 'font-size', 'border-radius'].filter(p => {
  const d = tabFinal[p]
  return d && /var\(/.test(d.val)
})
check('T2.7 组件那份继续是**字面量**自包含（改成 var() 就把规格交回全局表，正是 E-12 的成因）',
  tabVar.length === 0, tabVar.join(','))
const otherTabDefs = files.filter(f => /\.wxss$/.test(f)).map(f => {
  const rel = path.relative(BASE, f).replace(/\\/g, '/')
  if (rel === 'custom-tab-bar/index.wxss') return null
  const parsed = parse(fs.readFileSync(f, 'utf8'), rel)
  const hits = parsed.rules.filter(r => r.compounds.some(c => c.classes.indexOf('tabbar') !== -1 || c.classes.indexOf('tab') !== -1 || c.classes.indexOf('tabbar-safe') !== -1))
  return hits.length ? rel + ':' + hits.map(h => h.sel).join('/') : null
}).filter(Boolean)
check('T2.8 全仓没有第二个文件定义能匹配 tabbar 节点的裸 .tab/.tabbar（apply-shared 下页面样式会漏进导航控件）',
  otherTabDefs.length === 0, otherTabDefs.join(' , '))

/* ============================ §3 M-16 ============================ */
section('§3 M-16 承载用户自由输入的类：断行策略必须是层叠后真生效的那一句')
const BREAK_PROPS = ['overflow-wrap', 'word-break']
function breakOf (chain) {
  const m = finalMap(BOTH, chain)
  const found = BREAK_PROPS.map(p => ({ p, r: finalResolved(m, p, TOKENS) })).filter(x => x.r && !x.r.unresolved)
  return { m, found }
}
OVERFLOW_NODES.forEach(pair => {
  const name = pair[0]; const chain = pair[1]
  const g = breakOf(chain)
  const ok = isBreaking(g.found).length > 0
  check('T3.1 ' + name + '：终值里真的有可算进 min-content 的断行策略（' + (g.found.map(x => x.p + '=' + x.r.val).join(' ') || '无') + '）', ok)
})
const pm = breakOf(OVERFLOW_NODES[2][1]).m
check('T3.2 姓名所在的 flex 项兜底没被旁路：.person-row__body 的 min-width 仍是 0（原有合规点位未误伤）',
  !!finalResolved(finalMap(BOTH, chainOf(['person-row__body'])), 'min-width', TOKENS) &&
  specOf(finalMap(BOTH, chainOf(['person-row__body'])), 'min-width') === '0', pm && '')
const metricMin = specOf(finalMap(BOTH, chainOf(['metrics'], ['metric'])), 'min-width')
check('T3.3 .metric 的 min-width 仍是 0（列可被压窄是溢出成因；这句不许顺手删）', metricMin === '0', metricMin)
const nowrapRisk = OVERFLOW_NODES.filter(pair => {
  const m = finalMap(BOTH, pair[1])
  const ws = finalResolved(m, 'white-space', TOKENS)
  if (!ws || !/nowrap/.test(ws.val)) return false
  const to = finalResolved(m, 'text-overflow', TOKENS)
  const ov = finalResolved(m, 'overflow', TOKENS)
  return !(to && ov)
})
check('T3.4 没有一处用「nowrap 又不带 ellipsis」冒充溢出策略（那是把文本裁没，不是兜底）',
  nowrapRisk.length === 0, nowrapRisk.map(p => p[0]).join(','))
const picker = finalMap(BOTH, chainOf(['picker'], ['picker-value']))
const pickerOk = ['overflow', 'text-overflow', 'white-space'].every(p => !!finalResolved(picker, p, TOKENS))
check('T3.5 原有唯一合规样板 .picker .picker-value 的 ellipsis 三件套完好（本轮不重推它）', pickerOk)
// 抗重构（幂等）：在表尾追加一条**同特异度、同值**的断行声明，精选卡标题的终值集合必须一字不变。
// 这条存在的理由：判据如果记住的是「哪一行写了 anywhere」，任何合法的搬动都会假红（铁律 30 的原始事故）。
// 与 §9.6 成对：那条证明「后置的相反声明必须赢」，这条证明「后置的同值声明不改变结果」——
// 两条一起才说明判据读的是**层叠赢家**，而不是「第一条命中的规则」。
const eqIdem = (() => {
  const extra = eolProbe() + '.activity-card__title { overflow-wrap: anywhere; }'
  const p = parse(appText + extra, 'app.wxss')
  const before = finalMap([app], OVERFLOW_NODES[1][1])
  const afterMap = finalMap([p], OVERFLOW_NODES[1][1])
  const same = Object.keys(before).every(k => String((afterMap[k] || {}).val) === String(before[k].val)) &&
    Object.keys(afterMap).every(k => String((before[k] || {}).val) === String(afterMap[k].val))
  return { same, props: Object.keys(afterMap).length }
})()
check('T3.6 抗重构（幂等）：表尾追加同特异度同值的断行声明 ⇒ 精选卡标题终值集合逐项不变',
  eqIdem.same === true, eqIdem.same ? eqIdem.props + ' 个属性' : '终值集合被搬动改变了')
const docCheck = (() => {
  const docPath = path.join(ROOT, '.agents', 'skills', 'ourtrail-ui', 'references', 'design-system.md')
  if (!fs.existsSync(docPath)) return { missing: true }
  const doc = fs.readFileSync(docPath, 'utf8')
  const row = (doc.split(/\r?\n/).filter(l => /^\|\s*`\.metrics\/\.metric`\s*\|/.test(l))[0]) || ''
  return { row, hasFour: /四列/.test(row) && /route/.test(row), hasThree: /三列/.test(row) }
})()
check('T3.7 注册表以实现为准：design-system.md 的 .metrics/.metric 行同时登记「默认三列」与「route 详情四列」',
  docCheck.hasFour && docCheck.hasThree, docCheck.row.slice(0, 60))
const overflowTokenLine = (docCheck.row.match(/overflow-wrap:\s*anywhere/) || [''])[0]
check('T3.8 注册表登记的策略与 app.wxss 终值一致（文档说 anywhere、代码写别的 ⇒ 红）',
  !!overflowTokenLine && OVERFLOW_NODES.every(pair => breakOf(pair[1]).found.some(x => /anywhere/.test(String(x.r.val)))),
  overflowTokenLine)

/* ============================ §4 B-14 ============================ */
section('§4 B-14 死定义不复活 / 活定义不误删 / 删 token 不留悬空引用')
const safeFinal = finalMap(BOTH, chainOf(['tabbar-safe']))
check('T4.1 节点 class="tabbar-safe" 的终值集合为空（死定义真的没了；改前它有 height: calc(84px + …)）',
  Object.keys(safeFinal).length === 0, Object.keys(safeFinal).join(','))
check('T4.2 且全仓仍然没有任何文件引用它（wxml class 普查 + js 串普查，命中数 ' + uses('tabbar-safe') + '）',
  uses('tabbar-safe') === 0, String(uses('tabbar-safe')))
const focusTok = TOKENS['--focus']
check('T4.3 page 上不再有 --focus（实测引用 0 次的死 token 已删）', focusTok === undefined, String(focusTok))
const refs = []
const scanFiles = files.filter(f => /\.wxss$/.test(f))
scanFiles.forEach(f => {
  const rel = path.relative(BASE, f).replace(/\\/g, '/')
  if (rel !== 'app.wxss' && rel !== 'custom-tab-bar/index.wxss') return
  const text = stripComments(fs.readFileSync(f, 'utf8'))
  const localDefs = new Set((text.match(/^\s*(--[\w-]+)\s*:/gm) || []).map(s => s.match(/--[\w-]+/)[0]))
  ;(text.match(/var\(\s*(--[\w-]+)/g) || []).forEach(m => {
    const name = m.match(/--[\w-]+/)[0]
    if (!(name in app.tokens) && !localDefs.has(name)) refs.push(rel + ' → ' + name)
  })
})
check('T4.4 我这两个文件里每一个 var() 引用都能解析到实际值（删 token 之后不留悬空引用；改前 --focus 也在这条的覆盖内）',
  refs.length === 0, refs.join(' , '))
const sticky = finalMap(BOTH, chainOf(['page', 'has-sticky']))
const stickyPad = specOf(sticky, 'padding-bottom')
check('T4.5 .page.has-sticky 的 padding-bottom 终值仍是 120px（审计说它零引用是旧账：route-edit 正在用，且 T4 的新门依赖它存在）',
  stickyPad === '120px', String(stickyPad))
check('T4.6 收回旧账的实测证据：has-sticky 在 wxml 里的引用数 ≥ 1（命中 ' + uses('has-sticky') + '）',
  uses('has-sticky') >= 1, String(uses('has-sticky')))
check('T4.7 with-tabbar 空开关已删除（2026-10-23）：wxml 引用 0 且 app.wxss 从未定义它 ⇒ 不再留「用了没定义」的假开关',
  uses('with-tabbar') === 0 && !finalMap([app], chainOf(['page', 'with-tabbar']))['padding-bottom'],
  'uses=' + uses('with-tabbar'))
const pageBase = finalMap(BOTH, chainOf(['page']))
check('T4.8 .page 基础内边距未被改动（with-tabbar 没有定义这件事留 requests，不许靠改 .page 蒙混）',
  specOf(pageBase, 'padding') === '24px 20px 32px', specOf(pageBase, 'padding'))
const focusDocRow = /--focus/.test((docCheck.row || '') + '\n' + fs.readFileSync(path.join(ROOT, '.agents', 'skills', 'ourtrail-ui', 'references', 'design-system.md'), 'utf8').split(/\r?\n/).filter(l => /^\|/.test(l) && /`--focus`/.test(l)).join(''))
check('T4.9 注册表里没有 --focus 的登记表行（token 删了还留着表 = 下一个维护者照表把它请回来）',
  !focusDocRow, focusDocRow ? '仍有 | `--focus` | 行' : '')

/* ============================ 汇总 ============================ */
section('§9 读数量闭合')
check('T9.1 app.wxss 解析出规则与 token（' + app.rules.length + ' 条声明 / ' + Object.keys(app.tokens).length + ' 个 token）',
  app.rules.length > 40 && Object.keys(app.tokens).length >= 25)
check('T9.2 custom-tab-bar/index.wxss 解析出规则（' + tab.rules.length + ' 条声明）', tab.rules.length >= 20)
check('T9.3 解析器没有把注释当规则读（app.wxss 里不存在 sel 含 /* 的规则）',
  !app.rules.some(r => r.sel.indexOf('*') !== -1))
// 门不空转的两条夹具一律用「表尾追加同特异度声明」构造缺陷形状，而不是改写原有那一行：
// 原有规则怎么分块、写在第几行都可能被合法重构搬动，夹具若锚那些细节，夹具自己会变成假红的来源
// （本轮 E1 就是这样把 T9.4 判红的：它去 replace 一条已被拆开的声明，替换命中 0 次 ⇒ 报「夹具没改动字节」）。
const defectSeg = (() => {
  const defective = appText + eolProbe() + '.segmented .seg { min-height: 36px; color: var(--muted); }'
  if (defective === appText) return { fixtureBroken: '缺陷形状夹具没有附加任何内容' }
  return gradeM06(parse(defective, 'app.wxss'))
})()
check('T9.4 门不空转（M-06）：表尾追加一条同特异度的缺陷声明（36px + --muted）⇒ 尺寸与对比度两条都必须红',
  !defectSeg.fixtureBroken && defectSeg.bad.length >= 2, defectSeg.fixtureBroken || defectSeg.bad.slice(0, 2).join(' ; '))
const defectTab = (() => {
  const block = '.tabbar .tab { min-height: 80px; }\n'
  const p = parse(appText + '\n' + block, 'app.wxss')
  return gradeTabProvenance(p, tab)
})()
check('T9.5 门不空转（E-12）：在 app.wxss 里重新注入一条能匹配 tab 的规则，来源判据必须立刻红',
  defectTab.some(b => b.indexOf('T2.1') === 0), defectTab[0] || '')
// 判据读的是层叠**赢家**，不是「第一条命中的规则」：表尾追加一条同特异度的相反声明，
// 该节点的终值必须换成 normal 且断行判据必须因此为假 —— 否则说明 §3 只是在文本里数了一下 anywhere。
const defectBreak = (() => {
  const p = parse(appText + eolProbe() + '.activity-card__title { overflow-wrap: normal; }', 'app.wxss')
  const m = finalMap([p], OVERFLOW_NODES[0][1])
  const winner = finalResolved(m, 'overflow-wrap', p.tokens)
  const found = ['overflow-wrap', 'word-break'].map(prop => ({ p: prop, r: finalResolved(m, prop, p.tokens) })).filter(x => x.r && !x.r.unresolved)
  return { winner: winner && winner.val, noBreak: isBreaking(found).length === 0 }
})()
check('T9.6 判据读层叠赢家而不是读文本（M-16）：表尾追加同特异度的 overflow-wrap: normal ⇒ 该属性终值必须变 normal 且断行判据转假',
  defectBreak.winner === 'normal' && defectBreak.noBreak === true,
  '终值=' + defectBreak.winner + '，无断行=' + defectBreak.noBreak)

console.log('\npassed=' + passed + ' failed=' + failed)
if (failed) failures.slice(0, 20).forEach(l => console.log(l))
process.exit(failed ? 1 : 0)
