'use strict'
// ST1-style 行为门：node tools/style-semantics-test.js
// 覆盖 B-11（.button 叠 .disabled 的权重倒挂）与强制修复顺序对 2 的前项
// —— app.wxss 的「禁用态按变体分别定义」。后项 B-12（route 删除按钮降为 text）属页面波次，
// 本套件是它的前置条件：text 变体的禁用终值必须先是对的。
//
// 三条写法约束（都是本仓铁律，不是自创）：
// · 铁律 30：门钉「层叠完成后的终值 + 哪条声明赢了」，不钉源码文本。
//   把同值声明合并成一条选择器列表、或把兜底规则挪到变体之后，终值与赢家不变 ⇒ 必须照样全绿；
//   把变体定义删掉、或把 text 改回被通用顺带压制 ⇒ 红。
// · 铁律 31：单源必须是「可被影子改写」的行为。影子改 --line/--muted ⇒ 整族禁用终值一起动、
//   还原后逐项相同；把 var() 引用换成字面量 ⇒ 影子追不上 = 假单源（§6 自带这条阳性对照）。
// · 铁律 21：类名出现在源码里不是证据。判据是「给一个 button text disabled 的节点，
//   最终 background 取哪条声明」，赢家由特异度与书写顺序算出来。
//
// ⚠ 本套件证不了的部分（如实登记）：层叠解析器模拟的是标准 CSS 规则，
//   真机 WXSS 的渲染结果（灰块是否真的不再出现、文字是否真的更淡）是 UI 维 = NOT_RUN，
//   见 fix-round2/out/ST1/runtime-required.md。
//
// 复验「缺陷形状确实会被抓到」：STYLE_TARGET 指到修复前的 app.wxss 再跑一次 ⇒ 必须红。
const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const TARGET = process.env.STYLE_TARGET || path.join(MP, 'app.wxss')
// 只有这几条属性承载「灰块 / 描边环 / 文字深浅」
const PAINT_PROPS = ['background', 'background-color', 'color', 'border-color', 'border']
const DISABLED_PROPS = ['background', 'border-color', 'color']

/* ---------------- 解析层：WXSS → 规则 + token ---------------- */
function keepLines(css) { return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')) }
function lineAt(text, index) { return text.slice(0, index).split('\n').length }
function parseDecls(body) {
  const out = []
  body.split(';').forEach(chunk => {
    const i = chunk.indexOf(':')
    if (i < 0) return
    const prop = chunk.slice(0, i).trim()
    const val = chunk.slice(i + 1).trim()
    if (prop && val) out.push({ prop, val })
  })
  return out
}
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length
  const classes = (sel.match(/\.[\w-]+/g) || []).length
  const attrs = (sel.match(/\[[^\]]+\]/g) || []).length
  const pseudoEl = (sel.match(/::[\w-]+/g) || []).length
  const pseudoClass = (sel.match(/:(?!:)[\w-]+/g) || []).length
  const rest = sel.replace(/#[\w-]+/g, '').replace(/\[[^\]]+\]/g, '').replace(/::?[\w-]+(\([^)]*\))?/g, '')
  const types = (rest.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length
  return { ids, b: classes + attrs + pseudoClass, c: types + pseudoEl }
}
function cmpSpec(a, b) { return (a.ids - b.ids) || (a.b - b.b) || (a.c - b.c) }
function compoundOf(sel) {
  const s = sel.trim()
  if (/[>+~]/.test(s)) return null
  if (/\s/.test(s)) {
    const parts = s.split(/\s+/).map(compoundOf)
    if (parts.some(part => !part)) return null
    return Object.assign({}, parts[parts.length - 1], { ancestors: parts.slice(0, -1) })
  }
  const type = (s.match(/^([a-zA-Z][\w-]*)/) || [])[1] || null
  const classes = (s.match(/\.[\w-]+/g) || []).map(x => x.slice(1))
  const attrs = (s.match(/\[([\w-]+)\]/g) || []).map(x => x.slice(1, -1))
  const pseudo = (s.match(/::?[\w-]+/g) || []).filter(p => p !== type)
  return { type, classes, attrs, pseudo }
}
function applies(node, c) {
  if (!c) return false
  if (c.pseudo.length) return false              // :hover / ::after —— 节点模型里没有状态与部件
  if (c.type && c.type !== node.tag) return false
  if (c.attrs.some(a => !node.attrs.has(a))) return false
  if (c.ancestors) {
    let parent = node.parent
    for (let index = c.ancestors.length - 1; index >= 0; index--) {
      while (parent && !applies(parent, c.ancestors[index])) parent = parent.parent
      if (!parent) return false
      parent = parent.parent
    }
  }
  return c.classes.every(k => node.classes.has(k))
}
function parse(css) {
  const text = keepLines(css)
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(text))) {
    const selList = m[1].trim().replace(/\s+/g, ' ')
    const decls = parseDecls(m[2])
    const line = lineAt(text, m.index)
    selList.split(',').forEach(raw => {
      const sel = raw.trim()
      if (!sel) return
      decls.forEach(d => rules.push({
        sel, spec: specificity(sel), comp: compoundOf(sel), line, prop: d.prop, val: d.val,
        important: /!\s*important/i.test(d.val)
      }))
    })
  }
  const tokens = {}
  rules.filter(r => r.sel === 'page' && /^--/.test(r.prop)).forEach(r => { tokens[r.prop] = r.val })
  return { rules, tokens }
}

/* ---------------- 求值层 ---------------- */
function splitTop(val) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of String(val)) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) { if (cur) { parts.push(cur); cur = '' } continue }
    cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}
function resolveVal(val, tokens) {
  const s = String(val).trim()
  const mvar = s.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/)
  if (mvar) {
    const hit = tokens[mvar[1]]
    if (hit !== undefined) return resolveVal(hit, tokens)
    return mvar[2] === undefined ? { raw: s, unresolved: true } : resolveVal(mvar[2], tokens)
  }
  if (/^var\(/.test(s)) return { raw: s, unresolved: true }
  return { raw: s }
}
function paint(val, tokens) {
  if (val === undefined || val === null) return null
  const r = resolveVal(val, tokens)
  const s = String(r.raw).trim()
  const low = s.toLowerCase()
  if (low === 'transparent' || low === 'none') return { raw: s, kind: 'transparent' }
  const full = low.match(/^#([0-9a-f]{6})$/)
  if (full) return { raw: s, kind: 'hex', hex: '#' + full[1].toUpperCase(), rgb: [parseInt(full[1].slice(0, 2), 16), parseInt(full[1].slice(2, 4), 16), parseInt(full[1].slice(4, 6), 16)] }
  const short = low.match(/^#([0-9a-f]{3})$/)
  if (short) { const d = short[1].split('').map(c => c + c); return { raw: s, kind: 'hex', hex: '#' + d.join('').toUpperCase(), rgb: d.map(c => parseInt(c, 16)) } }
  const rgba = low.match(/^rgba?\(([^)]+)\)$/)
  if (rgba) {
    const n = rgba[1].split(',').map(x => parseFloat(x.trim()))
    const p = { raw: s, kind: 'hex', rgb: n.slice(0, 3), hex: '#' + n.slice(0, 3).map(v => ('0' + Math.round(v).toString(16)).slice(-2)).join('').toUpperCase() }
    if (n.length === 4) p.alpha = n[3]
    return p
  }
  return { raw: s, kind: r.unresolved ? 'unresolved' : 'other' }
}
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function luminance(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) }
function contrastRatio(a, b) {
  if (!a || !b || !a.rgb || !b.rgb) return null
  const l1 = Math.max(luminance(a.rgb), luminance(b.rgb))
  const l2 = Math.min(luminance(a.rgb), luminance(b.rgb))
  return (l1 + 0.05) / (l2 + 0.05)
}
function finalDecl(parsed, node, prop) {
  let best = null
  parsed.rules.forEach(r => {
    if (r.prop !== prop) return
    if (!applies(node, r.comp)) return
    if (!best || cmpSpec(r.spec, best.spec) >= 0) best = r          // 同特异度 ⇒ 后写胜出
  })
  return best
}
function finalPaints(parsed, node) {
  const bgDecl = finalDecl(parsed, node, 'background') || finalDecl(parsed, node, 'background-color')
  const colorDecl = finalDecl(parsed, node, 'color')
  let borderSrc = finalDecl(parsed, node, 'border-color'), borderVal = borderSrc ? borderSrc.val : null
  if (!borderSrc) {
    const sh = finalDecl(parsed, node, 'border')
    if (sh) { const parts = splitTop(sh.val); borderVal = parts[parts.length - 1]; borderSrc = sh }
  }
  const bg = bgDecl ? paint(bgDecl.val, parsed.tokens) : null
  const paper = paint(parsed.tokens['--paper'], parsed.tokens)
  return {
    bg, color: colorDecl ? paint(colorDecl.val, parsed.tokens) : null,
    border: borderSrc ? paint(borderVal, parsed.tokens) : null,
    winners: { background: bgDecl ? bgDecl.sel : null, color: colorDecl ? colorDecl.sel : null, border: borderSrc ? borderSrc.sel : null },
    backdrop: bg && bg.kind === 'transparent' ? paper : bg
  }
}
const rawOf = p => (p && p.raw ? p.raw : null)
const triple = f => JSON.stringify([rawOf(f.bg), rawOf(f.border), rawOf(f.color)])

/* ---------------- 节点夹具 ---------------- */
// fam === '__fallback' ⇒ 只有 .button（对应异或式三元里「禁用时不带变体」的真实形态）
function famNode(fam, disabled, opts) {
  opts = opts || {}
  const classes = ['button']
  if (fam !== '__fallback') classes.push(fam)
  if (opts.block) classes.push('block')
  if (disabled && !opts.attrOnly) classes.push('disabled')
  return {
    tag: opts.tag || 'view',
    classes: new Set(classes),
    attrs: new Set(disabled && opts.attrOnly ? ['disabled'] : []),
    parent: opts.parent || null
  }
}
const FILLED = ['__fallback', 'primary', 'secondary', 'danger', 'leaf']
const VARIANTS = ['primary', 'secondary', 'danger', 'text', 'leaf']
const FAMLIST = ['__fallback', 'primary', 'secondary', 'danger', 'text', 'leaf']

const base = parse(fs.readFileSync(TARGET, 'utf8'))
const LINE_HEX = String(base.tokens['--line']).toLowerCase()
const MUTED_HEX = String(base.tokens['--muted']).toLowerCase()

/* ---------------- §1 解析器与机制自证 ---------------- */
section('§1 解析器与层叠机制自证（判据不能空转）')
check('P1.1 目标文件解析出规则与 token（' + base.rules.length + ' 条声明 / ' + Object.keys(base.tokens).length + ' 个 token）',
  base.rules.length > 40 && Object.keys(base.tokens).length >= 25)
check('P1.2 六个颜色 token 都在（--line/--muted/--forest/--surface/--paper/--white）',
  ['--line', '--muted', '--forest', '--surface', '--paper', '--white'].every(t => base.tokens[t]))
check('P1.3 .button 的五个变体选择器都被解析到（词表导出不是靠硬编码清单）',
  VARIANTS.every(v => base.rules.some(r => r.sel === '.button.' + v)),
  base.rules.map(r => r.sel).filter(s => /^\.button\./.test(s)).join(','))
check('P1.4 特异度函数：.button(0,1,0) < .button.primary(0,2,0) < .button.primary.disabled(0,3,0)，且通用禁用与变体同权',
  cmpSpec(specificity('.button'), specificity('.button.primary')) < 0 &&
  cmpSpec(specificity('.button.disabled'), specificity('.button.primary')) === 0 &&
  cmpSpec(specificity('.button.primary'), specificity('.button.primary.disabled')) < 0)
check('P1.5 特异度函数：属性形式 .button[disabled] 与类形式 .button.disabled 同权，变体属性形式高一级',
  cmpSpec(specificity('.button[disabled]'), specificity('.button.disabled')) === 0 &&
  cmpSpec(specificity('.button.text[disabled]'), specificity('.button.text.disabled')) === 0 &&
  cmpSpec(specificity('.button.disabled'), specificity('.button.text.disabled')) < 0)
// 「同特异度后写胜出」必须是被算出来的，否则 §2 的期望值就是硬编码
const probe = [
  { sel: '.a', spec: specificity('.a'), comp: compoundOf('.a'), prop: 'background', val: '#111111' },
  { sel: '.b', spec: specificity('.b'), comp: compoundOf('.b'), prop: 'background', val: '#222222' }
].map(r => Object.assign({ line: 0, important: false }, r))
const probeNode = { tag: 'view', classes: new Set(['a', 'b']), attrs: new Set() }
check('P1.6 调换两条同特异度规则的书写次序 ⇒ 赢家必须跟着换（机制敏感，不是硬编码期望）',
  finalDecl({ rules: probe, tokens: {} }, probeNode, 'background').sel === '.b' &&
  finalDecl({ rules: [probe[1], probe[0]], tokens: {} }, probeNode, 'background').sel === '.a')
check('P1.7 属性名解析：.button[disabled] 的 attr 取到的是 disabled（截错字符会让属性形态整条门失效）',
  JSON.stringify(compoundOf('.button[disabled]').attrs) === JSON.stringify(['disabled']))
check('P1.8 围栏：配色规则均能解析，后代作用域必须通过祖先链匹配',
  base.rules.filter(r => PAINT_PROPS.indexOf(r.prop) !== -1 && /\.button/.test(r.sel) &&
    (!r.comp || r.comp.pseudo.some(p => p.indexOf(':') !== 0) || (r.comp && r.comp.type))).length === 0,
  base.rules.filter(r => PAINT_PROPS.indexOf(r.prop) !== -1 && /\.button/.test(r.sel) &&
    (!r.comp || r.comp.pseudo.some(p => p.indexOf(':') !== 0) || (r.comp && r.comp.type))).map(r => r.sel + '{' + r.prop + '}').join(','))
const activityAncestor = { tag: 'view', classes: new Set(['activity-ui']), attrs: new Set() }
const otherAncestor = { tag: 'view', classes: new Set(['weather-ui']), attrs: new Set() }
check('P1.activity 后代匹配不跨页面、不把节点自身误当祖先',
  applies(famNode('secondary', false, { parent: activityAncestor }), compoundOf('.activity-ui .button.secondary'))
  && !applies(famNode('secondary', false, { parent: otherAncestor }), compoundOf('.activity-ui .button.secondary'))
  && !applies(activityAncestor, compoundOf('.activity-ui .activity-ui')))
check('P1.activity 多层后代顺序必须成立',
  applies(famNode('secondary', false, { parent: { ...otherAncestor, parent: activityAncestor } }), compoundOf('.activity-ui .weather-ui .button'))
  && !applies(famNode('secondary', false, { parent: { ...otherAncestor, parent: activityAncestor } }), compoundOf('.weather-ui .activity-ui .button')))
check('P1.9 .button 族的伪元素规则不声明 background/color（它只摘原生 button 的下划线，不该影响节点三属性）',
  base.rules.filter(r => /\.button/.test(r.sel) && r.comp && r.comp.pseudo.some(p => p.indexOf('::') === 0) &&
    ['background', 'background-color', 'color'].indexOf(r.prop) !== -1).length === 0)
check('P1.10 围栏：.button 族没有 !important、没有 id 选择器（否则赢家判据不成立）',
  !base.rules.some(r => r.important && /button/.test(r.sel)) && !base.rules.some(r => /#/.test(r.sel) && /button/.test(r.sel)))

/* ---------------- §2 六族禁用终值与赢家 ---------------- */
section('§2 禁用态按变体分别定义：层叠终值 + 哪条声明赢了')
const disabledFam = {}
FAMLIST.forEach(fam => { disabledFam[fam] = finalPaints(base, famNode(fam, true)) })
function solidExpect(f) {
  return String(rawOf(f.bg)).toLowerCase() === LINE_HEX &&
    String(rawOf(f.border)).toLowerCase() === LINE_HEX &&
    String(rawOf(f.color)).toLowerCase() === MUTED_HEX
}
FILLED.forEach(fam => {
  const f = disabledFam[fam]
  check('T2.' + fam + ' 禁用终值 = 实底兜底那一套（' + LINE_HEX + ' 底 / 同色描边 / ' + MUTED_HEX + ' 字）',
    solidExpect(f), triple(f))
  check('T2.' + fam + ' 的 background 赢家是' + (fam === '__fallback' ? '兜底通用规则本身' : '该族自己的禁用声明'),
    f.winners.background === (fam === '__fallback' ? '.button.disabled' : '.button.' + fam + '.disabled'),
    '赢家=' + f.winners.background)
})
const tf = disabledFam.text
check('T2.text 禁用终值 = 无底色、无描边（B-11 的缺陷本体），文字退到 --muted',
  tf.bg.kind === 'transparent' && tf.border.kind === 'transparent' &&
    String(rawOf(tf.color)).toLowerCase() === MUTED_HEX, triple(tf))
check('T2.text 的 background 赢家是 .button.text.disabled（(0,3,0) 压过通用的 (0,2,0)，不再靠书写顺序顺带赢）',
  tf.winners.background === '.button.text.disabled', '赢家=' + tf.winners.background)
FAMLIST.forEach(fam => {
  const a = finalPaints(base, famNode(fam, true, { attrOnly: true }))
  check('T2.' + fam + ' 的 [disabled] 属性形态与 .disabled 类形态终值相同（禁用只有一种长相）',
    triple(a) === triple(disabledFam[fam]),
    'attr=' + triple(a) + '<-' + JSON.stringify(a.winners) + ' cls=' + triple(disabledFam[fam]))
})
check('T2.block 叠加不改三属性（block 是布局变体，不是配色变体）',
  FAMLIST.filter(f => f !== '__fallback').every(fam =>
    triple(finalPaints(base, famNode(fam, true, { block: true }))) === triple(disabledFam[fam])))

/* ---------------- §2b 回滚对照 ---------------- */
section('§2b 回滚对照：本轮像素只允许 text 一族变化')
const preRules = base.rules.filter(r => !/^\.button\.[\w-]+\.disabled$/.test(r.sel) && !/^\.button\.[\w-]+\[disabled\]$/.test(r.sel))
const pre = { rules: preRules, tokens: base.tokens }
const changed = []
FAMLIST.forEach(fam => {
  const now = triple(disabledFam[fam])
  const before = triple(finalPaints(pre, famNode(fam, true)))
  if (now !== before) changed.push(fam)
  check('T2b.' + fam + ' 族禁用终值' + (now === before ? '未变' : '有变') + '（' + now + '）',
    now === before || fam === 'text', 'before=' + before)
})
check('T2b 变化族恰为 {text}：四个实底族零变化（没有顺手改配色）且 text 必须变（修复不是空改）',
  changed.length === 1 && changed[0] === 'text', 'changed=' + JSON.stringify(changed))
check('T2b 阳性对照：摘掉变体声明后 text 退回灰块、且与兜底族逐字相同（证明新增规则真的承重，不是装饰）',
  triple(finalPaints(pre, famNode('text', true))) === triple(finalPaints(pre, famNode('__fallback', true))) &&
    triple(finalPaints(pre, famNode('text', true))) !== triple(tf),
  'pre-text=' + triple(finalPaints(pre, famNode('text', true))))

/* ---------------- §3 权重不倒挂 ---------------- */
section('§3 禁用态不得比可用态更重（B-11 本体的量化形）')
FAMLIST.forEach(fam => {
  const on = finalPaints(base, famNode(fam, false))
  const off = disabledFam[fam]
  check('T3.' + fam + ' 不新增填充：可用态没有底色时，禁用态也不许长出底色',
    !(on.bg && on.bg.kind === 'transparent') || !!(off.bg && off.bg.kind === 'transparent'),
    'on=' + rawOf(on.bg) + ' off=' + rawOf(off.bg))
  const enabledBorderless = on.border && on.border.kind === 'transparent'
  const newVisibleRing = enabledBorderless && off.border && off.border.kind !== 'transparent' &&
    String(rawOf(off.border)).toLowerCase() !== String(rawOf(off.bg)).toLowerCase()
  check('T3.' + fam + ' 不新增可见描边：可用态无边时，禁用态要么仍无边、要么描边与底色同色而不可见',
    !newVisibleRing, 'onBorder=' + rawOf(on.border) + ' offBorder=' + rawOf(off.border) + ' offBg=' + rawOf(off.bg))
  const cOn = contrastRatio(on.color, on.bg && on.bg.kind !== 'transparent' ? on.bg : on.backdrop)
  const cOff = contrastRatio(off.color, off.bg && off.bg.kind !== 'transparent' ? off.bg : off.backdrop)
  check('T3.' + fam + ' 文字权重不倒挂：禁用态对比度 ≤ 可用态（' +
    (cOn === null ? 'n/a' : cOn.toFixed(2)) + ' → ' + (cOff === null ? 'n/a' : cOff.toFixed(2)) + '）',
    cOn !== null && cOff !== null && cOff <= cOn + 1e-6, 'cOn=' + cOn + ' cOff=' + cOff)
  check('T3.' + fam + ' 禁用态仍看得见：文字对比度 ≥ 3:1（WCAG 非文本下限，也是 B-13 用的那把尺；它同时禁掉了 opacity:.6 那种写法）',
    cOff !== null && cOff >= 3, 'cOff=' + cOff)
  check('T3.' + fam + ' 禁用态与自身可用态可辨（底/边/字三者不得全同）', triple(on) !== triple(off), triple(off))
})
check('T3.跨族一致：四个实底族的禁用终值彼此相同（同一支禁用表达，不是各写一套灰）',
  FILLED.every(fam => triple(disabledFam[fam]) === triple(disabledFam.__fallback)),
  FILLED.map(f => f + ':' + triple(disabledFam[f])).join(' '))

/* ---------------- 变体词表（由文件自身导出，§4 与 §5 共用）---------------- */
// 凡是声明了底色/文字色/描边的单段 .button.X 规则就是一个变体。
// 兜底的禁用族（.button.disabled）自身也符合这个形状，但它是「状态」不是「变体」，显式剔除；
// 它由 T5.6/T5.7 单独消费（缺它 = 无变体的禁用按钮没有表达）。
const NON_VARIANT = ['disabled', 'hover']
const colorBearing = Array.from(new Set(base.rules
  .filter(r => /^\.button\.[\w-]+$/.test(r.sel) && DISABLED_PROPS.some(p => r.prop === p))
  .map(r => r.sel.match(/^\.button\.([\w-]+)$/)[1])
  .filter(v => NON_VARIANT.indexOf(v) === -1)))

/* ---------------- §4 全站真实使用点普查 ---------------- */
section('§4 真实使用点：每一处 button+disabled 的终值都要符合其变体定义')
function walk(dir, acc) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (/\.wxml$/.test(e.name)) acc.push(p)
  })
  return acc
}
// class="a b {{cond ? 'x' : 'y'}}" → 枚举可能的类集合；无字面量的动态插值记 unknown（无法枚举）
function combosOf(value) {
  const alts = []
  const stripped = String(value).replace(/\{\{([\s\S]*?)\}\}/g, (all, inner) => {
    const lits = (inner.match(/'([^']*)'|"([^"]*)"/g) || []).map(s => s.slice(1, -1))
    alts.push(lits.length ? lits : [null])
    return ' '
  })
  let out = [stripped.split(/\s+/).filter(Boolean)]
  alts.forEach(a => {
    const next = []
    out.forEach(c => a.forEach(x => next.push(x === null ? c.slice() : c.concat(x.split(/\s+/)).filter(Boolean))))
    out = next
  })
  const seen = new Set()
  const combos = out.map(c => Array.from(new Set(c)).sort().join(' ')).filter(s => (seen.has(s) ? false : (seen.add(s), true)))
  return { combos, unknown: alts.some(a => a.indexOf(null) !== -1) }
}
const sites = []
let unknownSites = 0
const attrRe = /\bclass="([^"]*)"/g
walk(MP, []).forEach(f => {
  const src = fs.readFileSync(f, 'utf8')
  let m
  while ((m = attrRe.exec(src))) {
    const r = combosOf(m[1])
    const mentionsButton = m[1].indexOf('button') !== -1
    if (r.unknown && mentionsButton) unknownSites++
    r.combos.forEach(c => {
      const cls = c.split(' ').filter(Boolean)
      if (cls.indexOf('button') === -1 || cls.indexOf('disabled') === -1) return
      sites.push({
        file: path.relative(ROOT, f).replace(/\\/g, '/'), line: lineAt(src, m.index),
        variant: VARIANTS.filter(v => cls.indexOf(v) !== -1)[0] || null,
        block: cls.indexOf('block') !== -1, classes: cls
      })
    })
  }
})
check('T4.1 普查抓到 button+disabled 真实场景 ≥ 40 处（全站禁用态是既成约定；抓到 0 处说明普查器坏了）',
  sites.length >= 40, 'sites=' + sites.length)
check('T4.2 B-11 证据清单上的四处 text 使用点全被抓到（activity / editor / roster-panel / transport-panel）',
  ['pages/activity/activity.wxml', 'pages/editor/editor.wxml', 'components/roster-panel/roster-panel.wxml', 'components/transport-panel/transport-panel.wxml']
    .every(p => sites.some(s => s.file.indexOf(p) !== -1 && s.variant === 'text')),
  JSON.stringify(sites.filter(s => s.variant === 'text').map(s => s.file + ':' + s.line)))
const bad = []
sites.forEach(s => {
  const f = finalPaints(base, { tag: 'view', classes: new Set(s.classes), attrs: new Set() })
  const expect = s.variant === 'text' ? (f.bg && f.bg.kind === 'transparent') : solidExpect(f)
  if (!expect) bad.push(s.file + ':' + s.line + '[' + (s.variant || 'fallback') + ']→' + triple(f))
})
check('T4.3 每一处真实使用点的禁用终值都等于其变体定义（text 透明、实底族退灰），无一处漏网',
  bad.length === 0, bad.join(' | '))
const byVariant = {}
sites.forEach(s => { const k = s.variant || 'fallback'; byVariant[k] = (byVariant[k] || 0) + 1 })
check('T4.4 兜底规则不是死代码：确有「button + disabled 但不带变体」的真实场景（异或式三元，如 roster 提升按钮）',
  (byVariant.fallback || 0) > 0, JSON.stringify(byVariant))
const defined = new Set(colorBearing)
check('T4.5 凡有真实使用点的变体都已显式定义（新增变体/新用法都不会让本条假红），且 text 四处一个不少',
  Object.keys(byVariant).filter(k => k !== 'fallback').every(k => defined.has(k)) && (byVariant.text || 0) >= 4,
  JSON.stringify(byVariant) + ' 已定义=' + JSON.stringify(Array.from(defined).sort()))
check('T4.5b leaf 变体今日零禁用使用点（其定义是前瞻覆盖，不是漏改；一旦有使用点上一条就会验它）',
  (byVariant.leaf || 0) === 0, JSON.stringify(byVariant))
check('T4.6 普查器有效性：text 族的四处终值确实在普查路径上被解出为透明（不是靠 §2 的夹具独证）',
  sites.filter(s => s.variant === 'text').every(s => {
    const f = finalPaints(base, { tag: 'view', classes: new Set(s.classes), attrs: new Set() })
    return f.bg.kind === 'transparent' && f.border.kind === 'transparent' &&
      String(rawOf(f.color)).toLowerCase() === MUTED_HEX
  }), JSON.stringify(sites.filter(s => s.variant === 'text').map(s => s.file + ':' + s.line)))
console.log('  · 普查读数：button+disabled 场景 ' + sites.length + ' 处，按变体 ' + JSON.stringify(byVariant) +
  '；class 含无法枚举的动态插值 ' + unknownSites + ' 处（局限已写进 handoff）')

/* ---------------- §5 词表闭合与越界围栏 ---------------- */
section('§5 变体词表闭合 + 禁用族只许声明三条属性')
check('T5.1 变体词表由文件自身导出：五个既有变体全在，.block 正确落榜（只声明布局不声明配色）',
  ['danger', 'leaf', 'primary', 'secondary', 'text'].every(v => colorBearing.indexOf(v) !== -1) &&
    colorBearing.indexOf('block') === -1, JSON.stringify(colorBearing.sort()))
check('T5.1b 词表是导出的而不是写死的：新增着色变体不会让本条红（红的是 T5.2「新变体没补禁用定义」）',
  colorBearing.every(v => /^[\w-]+$/.test(v)) && colorBearing.length >= 5, JSON.stringify(colorBearing.length))
const missing = []
colorBearing.forEach(v => {
  if (!base.rules.some(r => r.sel === '.button.' + v + '.disabled')) missing.push(v + '.disabled')
  if (!base.rules.some(r => r.sel === '.button.' + v + '[disabled]')) missing.push(v + '[disabled]')
})
check('T5.2 每个着色变体都有 .button.X.disabled 与 .button.X[disabled] 两种形态的定义（缺一即词表破口）',
  missing.length === 0, missing.join(','))
const orphans = base.rules.map(r => r.sel)
  .filter(s => /^\.button\.[\w-]+\.disabled$/.test(s))
  .map(s => s.match(/^\.button\.([\w-]+)\.disabled$/)[1])
  .filter(v => colorBearing.indexOf(v) === -1)
check('T5.3 没有「给不存在的变体写禁用定义」的孤儿规则', orphans.length === 0, orphans.join(','))
// 禁用族 = 兜底两条形态 + 每个变体两条形态（兜底也在这个族里，它同样只许声明三条属性）
const disabledRules = base.rules.filter(r => /^\.button(\.[\w-]+)?(\.disabled|\[disabled\])$/.test(r.sel))
check('T5.4 围栏：禁用族只声明 background/border-color/color（pointer-events/opacity/transform 属 C-16 按压反馈，未并入本轮）',
  disabledRules.every(r => DISABLED_PROPS.indexOf(r.prop) !== -1),
  disabledRules.filter(r => DISABLED_PROPS.indexOf(r.prop) === -1).map(r => r.sel + '{' + r.prop + '}').join(','))
const usedVals = Array.from(new Set(disabledRules.map(r => String(paint(r.val, base.tokens).raw).toLowerCase())))
check('T5.5 禁用族解析后只用 --line / --muted / transparent 三种表达（零新色值，铁律 17）',
  usedVals.length === 3 && usedVals.every(v => ['transparent', LINE_HEX, MUTED_HEX].indexOf(v) !== -1), JSON.stringify(usedVals))
const perSel = {}
disabledRules.forEach(r => { (perSel[r.sel] = perSel[r.sel] || []).push(r.prop) })
const shapeBad = Object.keys(perSel).filter(sel => {
  const props = perSel[sel]
  return props.length !== DISABLED_PROPS.length || DISABLED_PROPS.some(p => props.filter(x => x === p).length !== 1)
})
check('T5.6 禁用族的每条选择器（兜底 2 条 + 每变体 2 条）恰好声明这三条属性各一次（少一条就退回顺带压制，多一条就是越界）',
  Object.keys(perSel).length === colorBearing.length * 2 + 2 && shapeBad.length === 0,
  '选择器数=' + Object.keys(perSel).length + ' 期望=' + (colorBearing.length * 2 + 2) + ' 形状异常=' + shapeBad.join(','))
check('T5.7 兜底通用规则仍在且仍声明同一套三色（无变体的禁用按钮靠它，不是死代码——T4.4 已证有真实场景）',
  (() => {
    const g = perSel['.button.disabled'] || []
    return g.length === 3 && DISABLED_PROPS.every(p => g.indexOf(p) !== -1)
  })(), JSON.stringify(perSel['.button.disabled']))

/* ---------------- §6 影子单源（铁律 31③） ---------------- */
section('§6 单源是可影子改写的行为，不是常量名')
const rawCss = fs.readFileSync(TARGET, 'utf8')
function shadow(css, token, value) {
  const hits = css.split(/\r?\n/).filter(l => new RegExp('(?:^|[^\\w-])' + token + '\\s*:').test(l)).length
  if (hits !== 1) throw new Error('影子锚点 ' + token + ' 命中 ' + hits + ' 次（要求恰 1 次）')
  return css.replace(new RegExp('(' + token + ':\\s*)[^;]+;'), '$1' + value + ';')
}
const SENTINEL_A = '#135799', SENTINEL_B = '#8B0000'
try {
  const movedLine = parse(shadow(rawCss, '--line', SENTINEL_A))
  const fills = FILLED.map(fam => String(rawOf(finalPaints(movedLine, famNode(fam, true)).bg)).toUpperCase())
  check('T6.1 影子改写 --line ⇒ 五个实底场景（四变体 + 兜底）的禁用底色一起跟着动（同一支引用，不是各自抄字面量）',
    fills.every(v => v === SENTINEL_A), JSON.stringify(fills))
  const textAfterLine = finalPaints(movedLine, famNode('text', true))
  check('T6.2 影子改写 --line ⇒ text 族禁用底色不动（透明是透明，两族互不串味）',
    textAfterLine.bg.kind === 'transparent' && tf.bg.kind === 'transparent', rawOf(textAfterLine.bg))
  const movedMuted = parse(shadow(rawCss, '--muted', SENTINEL_B))
  const inks = FAMLIST.map(fam => String(rawOf(finalPaints(movedMuted, famNode(fam, true)).color)).toUpperCase())
  check('T6.3 影子改写 --muted ⇒ 六族禁用文字色一起动（禁用文字色也只有一支引用）',
    inks.every(v => v === SENTINEL_B), JSON.stringify(inks))
  const enabledInk = FAMLIST.map(fam => String(rawOf(finalPaints(movedMuted, famNode(fam, false)).color)).toUpperCase())
  check('T6.4 反向不串味：影子改 --muted 不得带动任何族的可用态文字色（可用与禁用是两本账）',
    enabledInk.every(v => v !== SENTINEL_B), JSON.stringify(enabledInk))
  const again = parse(rawCss)
  check('T6.5 还原对照：影子之后重读原文件，六族禁用终值逐项与基线相同（影子没留下状态，也不是两个零恰好对上）',
    FAMLIST.map(fam => triple(finalPaints(again, famNode(fam, true)))).join('|') ===
      FAMLIST.map(fam => triple(disabledFam[fam])).join('|'))
  const literalFrom = '.button.danger.disabled, .button.danger[disabled] { background: var(--line);'
  const literalTo = '.button.danger.disabled, .button.danger[disabled] { background: ' + String(base.tokens['--line']) + ';'
  const literalized = rawCss.split(literalFrom).length === 2 ? rawCss.replace(literalFrom, literalTo) : null
  const lit = parse(shadow(literalized || rawCss, '--line', SENTINEL_A))
  const dangerBg = String(rawOf(finalPaints(lit, famNode('danger', true)).bg)).toUpperCase()
  const primaryBg = String(rawOf(finalPaints(lit, famNode('primary', true)).bg)).toUpperCase()
  check('T6.6 影子门有牙齿：把一处 var(--line) 换成字面量后影子必须追不上它（假单源会被当场抓住）',
    !!literalized && dangerBg !== SENTINEL_A && primaryBg === SENTINEL_A,
    'danger=' + dangerBg + ' primary=' + primaryBg)
} catch (e) {
  check('T6.x 影子改写执行', false, e.message)
}

/* ---------------- §7 合法重构不误伤（铁律 30） ---------------- */
section('§7 等价重构必须照样全绿（门钉终值与赢家，不钉源码写法）')
// 夹具按「声明体」分组，不假设源文件把禁用族写成 2 行还是 12 行：
// 同一声明体的多条选择器合并成一条选择器列表，是纯写法差异 ⇒ 六族终值与赢家必须一字不改。
// （这条夹具最初是按源码行文本拼的，被 tools/style-mutate.js 的等价控制 E2 当场抓出「门在钉写法」，已改。）
const bySel = {}
disabledRules.forEach(r => { (bySel[r.sel] = bySel[r.sel] || []).push({ prop: r.prop, val: r.val }) })
const groups = {}
Object.keys(bySel).forEach(sel => {
  const key = bySel[sel].map(d => d.prop + '\u0000' + d.val).sort().join(';')
  ;(groups[key] = groups[key] || []).push(sel)
})
const mergeKey = Object.keys(groups).filter(k => groups[k].length > 1)
  .sort((a, b) => groups[b].length - groups[a].length)[0]
if (mergeKey) {
  const sels = groups[mergeKey]
  const decls = mergeKey.split(';').map(x => { const p = x.split('\u0000'); return p[0] + ': ' + p[1] })
  const mergedText = sels.join(', ') + ' { ' + decls.join('; ') + '; }'
  const mergedParsed = parse(mergedText)
  const selSet = new Set(sels)
  const merged = {
    rules: base.rules.filter(r => !selSet.has(r.sel)).concat(mergedParsed.rules),
    tokens: base.tokens
  }
  check('T7.1 同一声明体的多条选择器合并成一条选择器列表 ⇒ 解析出的规则数不变、六族终值不变（拆开/合写等价）',
    mergedParsed.rules.length === sels.length * DISABLED_PROPS.length &&
      FAMLIST.every(fam => triple(finalPaints(merged, famNode(fam, true))) === triple(disabledFam[fam])) &&
      VARIANTS.every(v => finalPaints(merged, famNode(v, true)).winners.background === '.button.' + v + '.disabled'),
    '合并的选择器=' + sels.join(','))
} else {
  check('T7.1 同一声明体的多条选择器合并成一条选择器列表', false,
    '禁用族里找不到共享声明体的两条以上选择器（等价夹具失效 ⇒ 说明按变体的定义已被拆开写法吞掉）')
}
const generic = base.rules.filter(r => r.sel === '.button.disabled' || r.sel === '.button[disabled]')
const rest = base.rules.filter(r => generic.indexOf(r) === -1)
const tail = { rules: rest.concat(generic), tokens: base.tokens }
check('T7.2 把兜底通用规则挪到全部变体定义之后 ⇒ 变体靠 (0,3,0) 仍赢、六族终值不变（顺序迷信不是判据）',
  FAMLIST.every(fam => triple(finalPaints(tail, famNode(fam, true))) === triple(disabledFam[fam])) &&
    VARIANTS.every(v => finalPaints(tail, famNode(v, true)).winners.background === '.button.' + v + '.disabled'))
check('T7.3 用属性形态（原生 <button disabled>）与类形态走的是同一套赢家规则，二者不得给出两种灰',
  FAMLIST.every(fam => finalPaints(base, famNode(fam, true, { attrOnly: true, tag: 'button' })).winners.background ===
    (fam === '__fallback' ? '.button[disabled]' : '.button.' + fam + '[disabled]')))

section('§8 活动作用域：可用、禁用、隔离与影子 token')
for (const family of FAMLIST) {
  const enabled = finalPaints(base, famNode(family, false, { parent: activityAncestor }))
  const disabled = finalPaints(base, famNode(family, true, { parent: activityAncestor }))
  check('activity.' + family + ' 禁用态不被作用域样式覆盖', triple(disabled) === triple(disabledFam[family]))
  check('activity.' + family + ' 原生 disabled 与类形态一致', triple(disabled) === triple(finalPaints(base, famNode(family, true, { parent: activityAncestor, attrOnly: true, tag: 'button' }))))
  check('activity.' + family + ' 不影响天气与其他页面', triple(finalPaints(base, famNode(family, false, { parent: otherAncestor }))) === triple(finalPaints(base, famNode(family, false))))
  check('activity.' + family + ' 可用态文字对比度达 4.5', contrastRatio(enabled.color, enabled.backdrop) >= 4.5)
  const shadow = { rules: base.rules, tokens: { ...base.tokens, '--line': '#AACCAA', '--muted': '#334433' } }
  const changed = finalPaints(shadow, famNode(family, true, { parent: activityAncestor }))
  check('activity.' + family + ' 禁用配色跟随 token', rawOf(changed.color) === '#334433' && (family === 'text' ? changed.bg.kind === 'transparent' : rawOf(changed.bg) === '#AACCAA'))
}
const scopedSecondary = finalPaints(base, famNode('secondary', false, { parent: activityAncestor }))
check('activity.secondary 使用可辨识的白底描边，而非提交实底', rawOf(scopedSecondary.bg) === base.tokens['--surface'] && rawOf(scopedSecondary.border) === base.tokens['--control-line'])
const brokenScope = parse(fs.readFileSync(TARGET, 'utf8') + '\n.activity-ui .button.secondary.disabled { background: var(--surface); }')
check('activity 变异自证：禁用覆盖被删坏必能发现', triple(finalPaints(brokenScope, famNode('secondary', true, { parent: activityAncestor }))) !== triple(disabledFam.secondary))

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
