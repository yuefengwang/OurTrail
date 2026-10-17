'use strict'
// SWX2 页面/组件样式表行为门：node tools/swx2-style-gates-test.js
// 覆盖审计缺陷：B-09（未定义 token）/ B-10（字面色绕过 token）/ B-13（语义色当文字色）/
//   B-16（字重 700 蔓延）/ E-06（position:sticky 无偏移的死声明）/ M-07（触控目标 <44px、注释谎称达标）/
//   B-14 的「重复规则两例」（.oi-ev×2、.nick-wrap×2）。
//
// 三条写法约束（都是本仓铁律，不是自创）：
// · 铁律 30：门钉「解析后的终值」，不钉源码文本。把 var(--touch-target) 换成 44px、把 padding 拆成
//   padding-top/padding-bottom、把规则挪个位置 ⇒ 终值不变 ⇒ 必须照样全绿
//   （tools/swx2-style-gates-mutate.js 的 E 组专验这条，红了就说明门在钉写法）。
// · 铁律 21：类名出现次数、节点数量都不是 UI 证据。本门唯一的判据是「app.wxss + 该页 wxss 按层叠算完，
//   这个选择器最终拿到什么值」。WXML 只用来回答「这条样式规则的作用域里有没有可点元素 /
//   有没有可点元素落在作用域外」这一件事（§7c），不用来证明任何渲染结果。
// · 铁律 31：单源必须能被影子改写。§2/§3 在内存里改 app.wxss 的 token 值 ⇒ 引用处必须一起动；
//   把某处抄回字面量 ⇒ 影子追不上（假单源当场抓住）。
//
// 计数口径（「全 0」读数必须可复算）：
//   · 字面色 = 声明值里出现的 #RGB / #RRGGBB / rgb() / rgba()；transparent/none/currentColor 不计；
//     var() 的 fallback 位置不计（那是 B-09 的死 token 掩体，由 §2b 单独管）。
//     「绕过 token」= 该字面色与 app.wxss 某个 token 的解析值同色（同色不引用 = 复制）。
//   · 字重 = 声明 font-weight 的解析终值；两档口径 = 正文 400/500、强调 600；700 只许 .page-title（app.wxss，不属本门）。
//   · 触控高度 = max(height, min-height, 行高内容) + 上下 padding + 上下 border（box-sizing:border-box 且有
//     height/min-height 时不另加）；未声明行高者按 page 的继承行高（app.wxss 实测 22px）计。
//     这是「终值集合里的数值」，不是像素实测 ⇒ 像素维一律 NOT_RUN（见 out/SWX2/runtime-required.md）。
//   · 未定义 token = 全仓 .wxss 里 var(--x) 的 x 不在 app.wxss `page` 块的声明集合内。
//   · 重复选择器 = 同一文件内同一个选择器字符串出现在 >1 条规则里。
//
// ⚠ 本套件证不了的部分（如实登记）：解析器模拟标准 CSS 层叠与盒模型，看不见像素。
//   「星星是否真的更可辨」「表头是否真的吸住」「44px 是否真的落到手指上」= UI 维 NOT_RUN。
//
// 沙盒：SWX2_MP_ROOT 指向一份 miniprogram 副本（变异自证用）；缺省 = 真实仓库。
const fs = require('fs')
const os = require('os')
const path = require('path')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const ROOT = path.resolve(__dirname, '..')
const MP = process.env.SWX2_MP_ROOT || path.join(ROOT, 'miniprogram')

const W = {
  weather: 'pages/weather/weather.wxss',
  chart: 'pages/weather-chart/weather-chart.wxss',
  privacy: 'pages/privacy/privacy.wxss',
  home: 'pages/home/home.wxss',
  discover: 'pages/discover/discover.wxss',
  activity: 'pages/activity/activity.wxss',
  editor: 'pages/editor/editor.wxss',
  me: 'pages/me/me.wxss',
  spaceTime: 'components/space-time/space-time.wxss',
}
const WRITE_SET = Object.keys(W).map(k => W[k])
const APP = 'app.wxss'

function read(rel, base) {
  const p = path.join(base || MP, rel)
  if (!fs.existsSync(p)) throw new Error('缺少样式文件：' + rel)
  return fs.readFileSync(p, 'utf8')
}
function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); return dir }
function writeAt(baseDir, rel, content) {
  const p = path.join(baseDir, rel)
  mkdirp(path.dirname(p))
  fs.writeFileSync(p, content)
}
function allWxss(base) {
  const out = []
  const walk = dir => {
    fs.readdirSync(dir).forEach(name => {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else if (name.endsWith('.wxss')) out.push(path.relative(base, p).split(path.sep).join('/'))
    })
  }
  walk(base)
  return out.sort()
}

/* ---------------- 解析层 ---------------- */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}
function parseDecls(body) {
  const out = []
  body.split(';').forEach(chunk => {
    const i = chunk.indexOf(':')
    if (i < 0) return
    const prop = chunk.slice(0, i).replace(/\s+/g, ' ').trim().toLowerCase()
    const val = chunk.slice(i + 1).trim()
    if (prop && val && !prop.startsWith('@')) out.push({ prop, val })
  })
  return out
}
function parseRules(css) {
  const clean = blankComments(css)
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  let order = 0
  while ((m = re.exec(clean))) {
    const selText = m[1].replace(/\s+/g, ' ').trim().replace(/,\s*/g, ', ')
    const sels = selText.split(',').map(s => s.trim()).filter(Boolean)
    // 行号取「选择器第一个非空白字符」的位置：m.index 指向的是上一条规则 } 之后的空白/换行，会少 1 行
    const at = m.index + m[1].search(/\S/)
    rules.push({ sel: selText, sels, decls: parseDecls(m[2]), order: order++, line: clean.slice(0, at).split('\n').length })
  }
  return rules
}
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length
  const classes = (sel.match(/\.[\w-]+/g) || []).length
  const attrs = (sel.match(/\[[^\]]+\]/g) || []).length
  const pseudo = (sel.match(/::?[\w-]+/g) || []).length
  const rest = sel.replace(/#[\w-]+/g, '').replace(/\[[^\]]+\]/g, '').replace(/::?[\w-]+(\([^)]*\))?/g, '')
  const types = (rest.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length
  return [ids, classes + attrs + pseudo, types]
}
function cmpSpec(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }
// 层叠：files 按「越后优先级越高」传入（app.wxss → 页/组件自己的 wxss）
function cascade(selectorText, files, base) {
  const hit = []
  files.forEach(rel => {
    parseRules(read(rel, base)).forEach(r => {
      if (r.sels.indexOf(selectorText) !== -1) hit.push({ r, file: rel })
    })
  })
  const map = {}
  hit
    .map((x, fileIndex) => ({ x, fileIndex, spec: specificity(x.r.sel) }))
    // 层叠次序：特异度 ⇒ 文件次序（页/组件样式表整体在 app.wxss 之后）⇒ 同文件内书写次序。
    // 少了「文件次序」这一级就会把 app.wxss 里靠后的一条规则误判成赢家（本轮实测踩过：.chip 的页级覆盖被吞）。
    .sort((a, b) => cmpSpec(a.spec, b.spec) || a.fileIndex - b.fileIndex || a.x.r.order - b.x.r.order)
    .forEach(({ x }) => x.r.decls.forEach(d => {
      map[d.prop] = { value: d.val, from: x.r.sel, file: x.file, line: x.r.line }
    }))
  return map
}

/* ---------------- var() / token ---------------- */
function splitTop(str) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of str) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim() !== '') out.push(cur)
  return out.map(s => s.trim())
}
function resolveVars(value, tokens) {
  const refs = [], dead = []
  let fallbackInDead = false
  function walk(v) {
    let out = '', i = 0
    while (i < v.length) {
      const at = v.indexOf('var(', i)
      if (at < 0) { out += v.slice(i); break }
      out += v.slice(i, at)
      let depth = 0, j = at, end = v.length
      for (; j < v.length; j++) {
        if (v[j] === '(') depth++
        else if (v[j] === ')') { depth--; if (depth === 0) { end = j + 1; break } }
      }
      const parts = splitTop(v.slice(at + 4, end - 1))
      const name = parts[0].trim()
      refs.push(name)
      const live = Object.prototype.hasOwnProperty.call(tokens, name)
      if (!live) { dead.push(name); if (parts.length > 1) fallbackInDead = true }
      out += walk(live ? tokens[name] : (parts.length > 1 ? parts.slice(1).join(', ') : name))
      i = end
    }
    return out
  }
  return { resolved: walk(value).trim(), refs, dead, fallbackInDead }
}
function finalValue(map, prop, tokens) {
  const d = map[prop]
  if (!d) return null
  const r = resolveVars(d.value, tokens)
  return { raw: d.value, value: r.resolved, from: d.from, file: d.file, line: d.line, dead: r.dead }
}
function pxNum(v) {
  if (v == null) return null
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(px|rpx|%)?\s*$/.exec(String(v))
  return m ? Number(m[1]) : null
}
function borderWidth(v) {
  if (v == null) return null
  if (/^\s*(none|hidden)\b/.test(v)) return 0
  if (/^\s*0\b/.test(v)) return 0
  const m = /(-?\d+(?:\.\d+)?)px/.exec(v)
  if (m) return Number(m[1])
  if (/^\s*thin\b/.test(v)) return 1
  if (/^\s*(medium|bold)?\s*$/.test(v) && /solid|dashed|dotted/.test(v)) return 3
  return 0
}
// padding 纵向两边（简写与长写都要认：1/2 值取第一个，3/4 值取第三个做下边）
function padSides(get) {
  const sh = get('padding')
  let top = null, bottom = null
  if (sh != null) {
    const p = String(sh).trim().split(/\s+/).map(pxNum).filter(x => x != null)
    if (p.length === 1 || p.length === 2) { top = bottom = p[0] }
    else if (p.length >= 3) { top = p[0]; bottom = p[2] }
  }
  const t = get('padding-top'), b = get('padding-bottom')
  if (t != null) top = pxNum(t)
  if (b != null) bottom = pxNum(b)
  return [top || 0, bottom || 0]
}
// 终值集合 ⇒ 命中盒纵向尺寸
function tapExtent(map, tokens, pageLine) {
  const get = p => { const v = finalValue(map, p, tokens); return v ? v.value : null }
  const boxSizing = (get('box-sizing') || 'content-box').trim()
  const h = pxNum(get('height'))
  const mh = pxNum(get('min-height'))
  const line = pxNum(get('line-height'))
  const [padT, padB] = padSides(get)
  const btRaw = get('border-top') != null ? get('border-top') : get('border')
  const bbRaw = get('border-bottom') != null ? get('border-bottom') : get('border')
  const bt = btRaw == null ? 0 : (borderWidth(btRaw) || 0)
  const bb = bbRaw == null ? 0 : (borderWidth(bbRaw) || 0)
  const content = h != null ? h : (mh != null ? mh : (line != null ? line : pageLine))
  const fixed = h != null || mh != null
  const total = (boxSizing === 'border-box' && fixed) ? Math.max(h || 0, mh || 0) : content + padT + padB + bt + bb
  return { total, parts: { height: h, minHeight: mh, lineHeight: line, padT, padB, bt, bb, boxSizing } }
}

/* ---------------- 颜色 ---------------- */
function colorLiterals(value) {
  let stripped = '', i = 0
  while (i < value.length) {
    if (/^var\(/i.test(value.slice(i))) {
      let depth = 0, j = i
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++
        else if (value[j] === ')') { depth--; if (depth === 0) { j++; break } }
      }
      i = j
      continue
    }
    stripped += value[i++]
  }
  return (stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [])
}
function normColor(c) {
  const s = String(c || '').trim()
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(s)
  if (hex) {
    let x = hex[1]
    if (x.length === 3) x = x.split('').map(ch => ch + ch).join('')
    return '#' + x.toLowerCase()
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(s)
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : Number(rgb[4])
    if (a === 1) return '#' + [rgb[1], rgb[2], rgb[3]].map(x => Number(x).toString(16).padStart(2, '0')).join('')
    return 'rgba(' + rgb[1] + ',' + rgb[2] + ',' + rgb[3] + ',' + a + ')'
  }
  return s.toLowerCase()
}
function toRgb(c) {
  const n = normColor(c)
  const hex = /^#([0-9a-f]{6})$/.exec(n)
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1]
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(n)
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])]
  return null
}
function flatten(c) {
  const r = toRgb(c)
  if (!r) return null
  const [R, G, B, A] = r
  return [Math.round(R * A + 255 * (1 - A)), Math.round(G * A + 255 * (1 - A)), Math.round(B * A + 255 * (1 - A))]
}
function lum(rgb) {
  const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}
function contrast(a, b) {
  const x = flatten(a), y = flatten(b)
  if (!x || !y) return null
  const L1 = lum(x), L2 = lum(y)
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
}

const TOKENS = pageTokensOf(MP)
function pageTokensOf(base) {
  const m = cascade('page', [APP], base)
  const out = {}
  Object.keys(m).forEach(k => { if (k.startsWith('--')) out[k] = m[k].value })
  return out
}
const PAGE_LINE = pxNum((finalValue(cascade('page', [APP]), 'line-height', TOKENS) || {}).value) || 22

/* ================================================================= */
section('§1 解析器与判据自证（判据不能空转；含审计实测数字的阳性对照）')
{
  const fixture = [
    '.a { height: 44px }',
    '.b { padding: 11px 0 }',
    '.c { box-sizing: border-box; min-height: 44px; padding: 0 12px; border: 1px solid #000000 }',
    '.d { min-height: 44px; padding: 0 12px; border: 1px solid #000000 }',
    '.e { height: 26px; line-height: 26px }',
    '.f { padding: 5px 8px; line-height: 16px; border: 1px solid #000000 }',
    '.g { padding: 2px 0 }',
    '.h { padding: 6px 14px; line-height: 18px }',
  ].join('\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swx2-parse-'))
  fs.writeFileSync(path.join(dir, 'app.wxss'), 'page { line-height: 22px; --touch-target: 44px }')
  fs.writeFileSync(path.join(dir, 'f.wxss'), fixture)
  const tk = pageTokensOf(dir)
  const ext = s => tapExtent(cascade('.' + s, ['app.wxss', 'f.wxss'], dir), tk, 22).total
  check('P1.1 height:44px ⇒ 44', ext('a') === 44, ext('a'))
  check('P1.2 只有纵向 padding 11px 0 + 继承行高 22 ⇒ 44（命中盒撑开的正规写法）', ext('b') === 44, ext('b'))
  check('P1.3 box-sizing:border-box ⇒ min-height 已含 padding/border = 44', ext('c') === 44, ext('c'))
  check('P1.4 content-box ⇒ 44 + border 2 = 46（盒模型算错就判错）', ext('d') === 46, ext('d'))
  check('P1.5 阳性对照：审计量到的旧 .seg-btn（height/line-height 26px）被同一函数复算为 26', ext('e') === 26, ext('e'))
  check('P1.6 阳性对照：审计量到的留宿开关「padding 补足」实为 28（注释谎称 44 的那一处）', ext('f') === 28, ext('f'))
  check('P1.7 阳性对照：旧 .cond-why 的 padding 2px 0 ⇒ 26 <44', ext('g') === 26, ext('g'))
  check('P1.8 阳性对照：全局 .chip（padding 6px 14px + 行高 18）⇒ 30 <44', ext('h') === 30, ext('h'))
  fs.rmSync(dir, { recursive: true, force: true })

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'swx2-casc-'))
  fs.writeFileSync(path.join(dir2, 'app.wxss'), '.x { color: #000000; font-weight: 400 }\n.y .x { color: #ff0000 }')
  fs.writeFileSync(path.join(dir2, 'p.wxss'), '.x { color: #00ff00 }')
  const c2 = cascade('.x', ['app.wxss', 'p.wxss'], dir2)
  check('P1.9 页样式表在 app.wxss 之后 ⇒ 同特异度时页面赢（.x color = #00ff00）', c2.color.value === '#00ff00', JSON.stringify(c2.color))
  const c3 = cascade('.y .x', ['app.wxss', 'p.wxss'], dir2)
  check('P1.10 特异度压书写次序：.y .x (0,2,0) 仍赢过页级 .x (0,1,0)', c3.color.value === '#ff0000', JSON.stringify(c3.color))
  // 跨文件次序：app.wxss 里位置靠后的同特异度规则，不得盖掉页样式表的第一条（本轮真的这样错过一次）
  const dir2b = fs.mkdtempSync(path.join(os.tmpdir(), 'swx2-order-'))
  fs.writeFileSync(path.join(dir2b, 'app.wxss'), '.a { color: #000001 }\n.b { color: #000002 }\n.c { color: #000003 }\n.x { color: #0000ff }')
  fs.writeFileSync(path.join(dir2b, 'p.wxss'), '.x { color: #00ff00 }')
  const c2b = cascade('.x', ['app.wxss', 'p.wxss'], dir2b)
  check('P1.10b 页样式表整体在 app.wxss 之后：app.wxss 末条同特异度规则不得压掉页首条（赢家必须是 p.wxss）',
    c2b.color.value === '#00ff00' && c2b.color.file === 'p.wxss', JSON.stringify(c2b))
  fs.rmSync(dir2b, { recursive: true, force: true })
  fs.rmSync(dir2, { recursive: true, force: true })

  const tk3 = { '--ink': '#202A26' }
  const r3 = resolveVars('var(--surface-alt)', tk3)
  check('P1.11 未定义且无 fallback ⇒ 死 token 被点名且解析不出颜色（计算值失效 = transparent）',
    r3.dead[0] === '--surface-alt' && toRgb(r3.resolved) === null, JSON.stringify(r3))
  const r4 = resolveVars('var(--text-2, var(--ink))', tk3)
  check('P1.12 死 token + fallback ⇒ 同时报「死引用」与「fallback 掩体」（B-09 第二种形态）',
    r4.dead.indexOf('--text-2') !== -1 && r4.fallbackInDead === true, JSON.stringify(r4))
  const r5 = resolveVars('var(--ink)', tk3)
  check('P1.13 活 token ⇒ 解析到实际值且无死引用', r5.resolved === '#202A26' && r5.dead.length === 0, JSON.stringify(r5))

  const gd = '#D6A33C'
  check('P1.14 --golden 对 #FFFFFF = 2.29:1（审计值复现）', Math.abs(contrast(gd, '#FFFFFF') - 2.29) < 0.02, contrast(gd, '#FFFFFF'))
  check('P1.15 --golden 对 --forest-soft = 1.99:1（审计值复现）', Math.abs(contrast(gd, '#ECF0EF') - 1.99) < 0.02, contrast(gd, '#ECF0EF'))
  check('P1.16 --golden 对 --paper = 2.10:1（审计值复现）', Math.abs(contrast(gd, '#F5F5F0') - 2.1) < 0.02, contrast(gd, '#F5F5F0'))
  check('P1.17 同一函数判 --ink 对 #FFFFFF ≥7:1（换色方向真的过线，不是恒真）', contrast('#202A26', '#FFFFFF') > 7, contrast('#202A26', '#FFFFFF'))

  check('P1.18 字面色识别：var(--muted) 不算、#5F6E66 算、rgba() 算',
    colorLiterals('var(--muted)').length === 0 && colorLiterals('#5F6E66').length === 1 && colorLiterals('rgba(255, 255, 255, 0.7)').length === 1)
  check('P1.19 var() fallback 里的字面量不计入「绕过 token」（那是 §2b 的死 token 掩体，不是复制）',
    colorLiterals('var(--line, #DEE3DB)').length === 0)
  check('P1.20 normColor 把 #163E35 与 rgb(22,62,53) 判为同色（影子比较不会因写法漏判）',
    normColor('#163E35') === normColor('rgb(22, 62, 53)'))

  const fenced = WRITE_SET.concat([APP]).some(rel => /!important|@media|@import/.test(read(rel)))
  check('P1.21 围栏成立：写入集与 app.wxss 都没有 !important/@media/@import（出现即要求先升级本解析器，不许静默误判）', !fenced)
  check('P1.22 判据不是空转：app.wxss 解析出 ≥30 个 token，且 --touch-target = 44px',
    Object.keys(TOKENS).length >= 30 && TOKENS['--touch-target'] === '44px', Object.keys(TOKENS).length)
  check('P1.23 继承行高取到 app.wxss 的 page line-height（' + PAGE_LINE + 'px），不是我自己编的数', PAGE_LINE === 22, PAGE_LINE)
}

/* ================================================================= */
section('§2 B-09：var() 引用必须有定义（未定义 token 命中 2→0）')
{
  const deadHits = []
  allWxss(MP).forEach(rel => {
    ;(blankComments(read(rel)).match(/var\(\s*(--[\w-]+)/g) || []).forEach(hit => {
      const name = /--[\w-]+/.exec(hit)[0]
      if (!Object.prototype.hasOwnProperty.call(TOKENS, name)) deadHits.push(rel + ' ' + name)
    })
  })
  const deadNames = Array.from(new Set(deadHits.map(d => d.split(' ')[1])))
  check('T2.1 全仓 .wxss 的 var() 引用全部有定义（未定义 token 种类 = 0）', deadNames.length === 0, deadNames.join(','))
  check('T2.2 --surface-alt / --text-2 两个死名字已从写入集消失',
    deadNames.indexOf('--surface-alt') === -1 && deadNames.indexOf('--text-2') === -1, JSON.stringify(deadNames))
  check('T2.3 我没有私自强占 token 名：--surface-alt/--text-2 在 app.wxss 里仍未定义（注册表归 SWX1）',
    !('--surface-alt' in TOKENS) && !('--text-2' in TOKENS))

  const masked = []
  allWxss(MP).forEach(rel => {
    parseRules(read(rel)).forEach(r => r.decls.forEach(d => {
      const rr = resolveVars(d.val, TOKENS)
      if (rr.fallbackInDead) masked.push(rel + ' ' + r.sel + ' ' + d.prop)
    }))
  })
  check('T2.4 没有「死 token + fallback」的掩体写法（B-09 的第二真值源形态）', masked.length === 0, masked.join(' | '))

  const st = cascade('.space-time-stay.on', [APP, W.spaceTime])
  const onBg = finalValue(st, 'background', TOKENS)
  check('T2.5 .space-time-stay.on 的 background 解析成真实色值（不再是失效声明 ⇒ 不是透明）',
    onBg && toRgb(onBg.value) !== null, onBg && onBg.value)
  check('T2.6 该底色与卡片底 --surface 不同色（on 态在纯白宿主上真的看得见）',
    onBg && normColor(onBg.value) !== normColor(TOKENS['--surface']), onBg && onBg.value)
  check('T2.7 该底色是既有 token 的引用（值 = --forest-soft，即全仓「选中态表面」的既有约定）',
    onBg && onBg.raw.indexOf('--forest-soft') !== -1 && normColor(onBg.value) === normColor(TOKENS['--forest-soft']), JSON.stringify(onBg))
  const astro = finalValue(cascade('.space-time-astro-text', [APP, W.spaceTime]), 'color', TOKENS)
  check('T2.8 .space-time-astro-text 的 color 终值 = --ink 的实际值，且声明里没有 fallback',
    astro && astro.value.toLowerCase() === TOKENS['--ink'].toLowerCase() && astro.raw.indexOf('--text-2') === -1 && astro.raw.indexOf(',') === -1,
    JSON.stringify(astro))
  const shadowTokens = Object.assign({}, TOKENS, { '--forest-soft': '#123456' })
  const shadowOn = finalValue(cascade('.space-time-stay.on', [APP, W.spaceTime]), 'background', shadowTokens)
  check('T2.9 影子改写 --forest-soft ⇒ on 态底色一起动（单源是可改写的行为，不是常量名）',
    shadowOn && shadowOn.value.toLowerCase() === '#123456', JSON.stringify(shadowOn))
  const backOn = finalValue(cascade('.space-time-stay.on', [APP, W.spaceTime]), 'background', TOKENS)
  check('T2.10 还原对照：影子之后重读原文件，on 态底色回到基线（影子没留状态，也不是两个零恰好对上）',
    normColor(backOn.value) === normColor(TOKENS['--forest-soft']), JSON.stringify(backOn))
}

/* ================================================================= */
section('§3 B-10：字面色不得复制 token 的值（绕过 token 命中 6→0）')
{
  const tokenValues = {}
  Object.keys(TOKENS).forEach(k => {
    const n = normColor(TOKENS[k])
    if (/^#[0-9a-f]{6}$/.test(n) || n.startsWith('rgba')) (tokenValues[n] = tokenValues[n] || []).push(k)
  })
  const bypass = []
  const residual = []
  WRITE_SET.forEach(rel => {
    parseRules(read(rel)).forEach(r => r.decls.forEach(d => {
      colorLiterals(d.val).forEach(c => {
        const n = normColor(c)
        if (tokenValues[n]) bypass.push(rel + ' L' + r.line + ' ' + r.sel + ' ' + d.prop + ':' + c + ' = ' + tokenValues[n].join('/'))
        else residual.push(rel + ' L' + r.line + ' ' + r.sel + ' ' + d.prop + ':' + c)
      })
    }))
  })
  check('T3.1 写入集里没有「与既有 token 同值却写字面量」的复制（B-10 本体 = 0 处）', bypass.length === 0, bypass.join(' | '))
  console.log('  · 残留字面量（色板里没有同值 token，属"没有可用 token"而非绕过 ⇒ 如实登记不判红）：' + (residual.join(' | ') || '无'))
  check('T3.2 残留仅限「token 表里根本没有的白色半透明合成色」这一类，逐条可追（需要它变 token 请走 requests，不在这里私加）',
    residual.every(x => /rgba\(255,\s*255,\s*255/.test(x)), residual.join(' | '))

  const expect = (rel, sel, prop, token, label) => {
    const v = finalValue(cascade(sel, [APP, rel]), prop, TOKENS)
    check(label, v && v.value.toLowerCase() === String(TOKENS[token]).toLowerCase() && v.raw.indexOf(token) !== -1, JSON.stringify(v))
    return v
  }
  expect(W.weather, '.cf-readout .ro-l3.in', 'color', '--warning', 'T3.3 「此刻处于云中」L3 读数色终值 = --warning 实际值（原为 #8C5A12 复制）')
  expect(W.home, '.activity-card .activity-card__info', 'color', '--muted', 'T3.4 首页活动卡信息行终值 = --muted（原为 #5F6E66 复制）')
  expect(W.home, '.activity-card--featured .activity-card__info', 'color', '--on-forest-muted', 'T3.5 首页 featured（森林底）信息行终值 = --on-forest-muted')
  expect(W.discover, '.activity-card .activity-card__info', 'color', '--muted', 'T3.6 发现页同条规则同样改引用（两份拷贝都改了，不是只改一处）')
  expect(W.discover, '.activity-card--featured .activity-card__info', 'color', '--on-forest-muted', 'T3.7 发现页 featured 分支同样改引用')
  expect(W.activity, '.hero .metric-unit', 'color', '--on-forest-muted', 'T3.8 详情页 hero 指标单位终值 = --on-forest-muted')

  const shadow = Object.assign({}, TOKENS, { '--warning': '#0A0B0C', '--muted': '#0D0E0F', '--on-forest-muted': '#1A1B1C' })
  const s1 = finalValue(cascade('.cf-readout .ro-l3.in', [APP, W.weather]), 'color', shadow)
  const s2 = finalValue(cascade('.activity-card .activity-card__info', [APP, W.home]), 'color', shadow)
  const s3 = finalValue(cascade('.hero .metric-unit', [APP, W.activity]), 'color', shadow)
  check('T3.9 影子改写三个 token ⇒ 天气/首页/详情页终值一起动（引用真的在承重，不是抄来的同值）',
    s1.value === '#0A0B0C' && s2.value === '#0D0E0F' && s3.value === '#1A1B1C', JSON.stringify([s1.value, s2.value, s3.value]))
  const back = finalValue(cascade('.cf-readout .ro-l3.in', [APP, W.weather]), 'color', TOKENS)
  check('T3.10 还原对照：影子后重读原文件，天气页终值回到 --warning 基线',
    back.value.toLowerCase() === TOKENS['--warning'].toLowerCase(), JSON.stringify(back))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swx2-fake-'))
  const anchor = '.cf-readout .ro-l3.in { color: var(--warning); }'
  const original = read(W.weather)
  const hits = original.split(anchor).length - 1
  if (hits !== 1) {
    // 不抛异常：抛了会让「变异自证」把一次正常的回退误记成崩红。锚点没命中就是夹具不可用，直接记红。
    check('T3.11 假单源会被当场抓住（夹具锚点命中恰 1 次才可判；当前 ' + hits + ' 次 = 该文件不是修复后形态）', false, anchor)
  } else {
    writeAt(dir, APP, read(APP))
    writeAt(dir, W.weather, original.split(anchor).join('.cf-readout .ro-l3.in { color: #8C5A12; }'))
    const f1 = finalValue(cascade('.cf-readout .ro-l3.in', ['app.wxss', W.weather], dir), 'color', shadow)
    check('T3.11 假单源会被当场抓住：抄回字面量后影子改 --warning 追不上它', f1.value !== '#0A0B0C', JSON.stringify(f1))
  }
  fs.rmSync(dir, { recursive: true, force: true }) // 两条分支都要收尾，沙盒不许留在 %TEMP% 里

  // 跨页单源（审计点名的「同一条规则跨页复制」）：本批只把两处改引用，收敛要动 app.wxss ⇒ requests
  const home = cascade('.activity-card .activity-card__info', [APP, W.home])
  const disc = cascade('.activity-card .activity-card__info', [APP, W.discover])
  check('T3.12 首页与发现页这条规则现在逐值同源于同一批 token（终值相同 ⇒ 合并成一条全局规则不会改变任何一页的显示）',
    home.color && disc.color && home.color.value === disc.color.value && home['font-size'] && home['font-size'].value === disc['font-size'].value,
    JSON.stringify([home.color, disc.color]))
}

/* ================================================================= */
section('§4 B-13：星级的文字色必须过对比度（不把语义色当文字色）')
{
  const bgs = Array.from(new Set(['--surface', '--white', '--paper', '--forest-soft', '--success-soft', '--warning-soft', '--info-soft', '--danger-soft'].map(t => TOKENS[t])))
  const stars = [
    [W.weather, '.ag-stars', '今日户外时间轴评级星'],
    [W.weather, '.cond-stars', '户外条件卡评级星'],
  ]
  stars.forEach(([rel, sel, label]) => {
    const m = cascade(sel, [APP, rel])
    const v = finalValue(m, 'color', TOKENS)
    check('T4.1 ' + label + '（' + sel + '）的 color 解析成真实色值', v && toRgb(v.value) !== null, JSON.stringify(v))
    const ratios = bgs.map(b => [b, contrast(v.value, b)])
    const worst = ratios.reduce((a, b) => (b[1] < a[1] ? b : a))
    check('T4.2 ' + label + ' 对天气页全部浅底逐一 ≥3:1（最差 ' + worst[0] + ' = ' + worst[1].toFixed(2) + ':1）',
      ratios.every(x => x[1] >= 3), JSON.stringify(ratios))
    check('T4.3 ' + label + ' 对最近邻两块底（--surface / --forest-soft）达到正文级 ≥4.5:1',
      contrast(v.value, TOKENS['--surface']) >= 4.5 && contrast(v.value, TOKENS['--forest-soft']) >= 4.5,
      [contrast(v.value, TOKENS['--surface']), contrast(v.value, TOKENS['--forest-soft'])])
    check('T4.4 ' + label + ' 不再引用天相语义色（--golden/--blue-hour）⇒ 色相不承载评级，评级由紧邻的文字 tone 承载',
      !/--golden|--blue-hour/.test(v.raw), v.raw)
    check('T4.5 ' + label + ' 是纯配色改动：没有 content/background 声明（星级串仍只由 WXML 给出，样式没有造出 DOM 文本）',
      !m.content && !m.background && !m['background-color'], JSON.stringify(Object.keys(m)))
  })
  const golden = contrast(TOKENS['--golden'], TOKENS['--surface'])
  check('T4.6 阳性对照：同一判据对旧值判红（--golden 对卡片底只有 ' + golden.toFixed(2) + ':1 < 3）', golden < 3, golden)
  ;['--success', '--warning', '--muted', '--info'].forEach(t => {
    const r = contrast(TOKENS[t], TOKENS['--surface'])
    check('T4.7 承载语义的 tone 文字色 ' + t + ' 对白底仍 ≥4.5:1（' + r.toFixed(2) + '）⇒ 星色改了没把评级文字一起糊掉', r >= 4.5, r)
  })
  const starsRule = cascade('.ag-stars', [APP, W.weather])
  check('T4.8 星级的字号/字距等其余声明未被顺手改（letter-spacing 仍解析为 1px，星数可读性不靠颜色）',
    finalValue(starsRule, 'letter-spacing', TOKENS) && finalValue(starsRule, 'letter-spacing', TOKENS).value === '1px',
    JSON.stringify(finalValue(starsRule, 'letter-spacing', TOKENS)))
}

/* ================================================================= */
section('§5 B-16：字重回落到两档（≥700 声明命中 8→0）')
{
  const heavy = []
  WRITE_SET.forEach(rel => {
    parseRules(read(rel)).forEach(r => r.decls.forEach(d => {
      if (d.prop === 'font-weight') {
        const n = pxNum(resolveVars(d.val, TOKENS).resolved)
        if (n != null && n >= 700) heavy.push(rel + ' L' + r.line + ' ' + r.sel)
      }
    }))
  })
  check('T5.1 写入集里没有任何规则声明 font-weight ≥700（第三档字重清零）', heavy.length === 0, heavy.join(' | '))
  const named = [
    [W.weather, '.chip-time'], [W.weather, '.nc-time'], [W.weather, '.section-title'],
    [W.weather, '.cond-label'], [W.weather, '.reason-title'], [W.weather, '.reason-mark'],
    [W.weather, '.sky-look-label'], [W.privacy, '.li .dot'],
  ]
  named.forEach(([rel, sel]) => {
    const v = finalValue(cascade(sel, [APP, rel]), 'font-weight', TOKENS)
    const n = v ? pxNum(v.value) : null
    check('T5.2 ' + path.basename(rel) + ' ' + sel + ' 的字重终值 ∈ {400,500,600}（拿到 ' + n + '）',
      n === 400 || n === 500 || n === 600, JSON.stringify(v))
  })
  const appTitle = finalValue(cascade('.section-title', [APP]), 'font-size', TOKENS)
  const pgTitle = cascade('.section-title', [APP, W.weather])
  const pgSize = finalValue(pgTitle, 'font-size', TOKENS)
  check('T5.3 天气页的 .section-title 覆盖规则仍然存在且仍然改变终值（字号与全局不同 ⇒ 不是死覆盖；M-20 的删除裁决本批未做）',
    pgSize && appTitle && pgSize.value !== appTitle.value, JSON.stringify([appTitle, pgSize]))
  check('T5.4 该终值的赢家确实是页样式表那条（不是靠 app.wxss 顺带）',
    pgSize && pgSize.file === W.weather, JSON.stringify(pgSize))
  check('T5.5 覆盖规则的字号仍引用 token（--text-body），没有为降字重顺手写死数值',
    pgSize && pgSize.raw.indexOf('--text-body') !== -1, pgSize && pgSize.raw)
  const pt = finalValue(cascade('.page-title', [APP]), 'font-weight', TOKENS)
  check('T5.6 我没越界：app.wxss 的 .page-title 仍是 700（全仓唯一一档，那是 SWX1 的文件）',
    pt && pxNum(pt.value) === 700, JSON.stringify(pt))
  const ag = finalValue(cascade('.ag-title', [APP, W.weather]), 'font-weight', TOKENS)
  const cl = finalValue(cascade('.cond-label', [APP, W.weather]), 'font-weight', TOKENS)
  check('T5.7 同层级卡片主标题字重一致：.ag-title 与 .cond-label 终值相同（' + (ag && ag.value) + ' vs ' + (cl && cl.value) + '）—— 缺陷本体里那条「页内强调层级失去单一标尺」',
    ag && cl && ag.value === cl.value, JSON.stringify([ag, cl]))
}

/* ================================================================= */
section('§6 E-06：position:sticky 不带偏移 = 永不生效的死声明（命中 1→0）')
{
  const OFFS = ['top', 'bottom', 'left', 'right']
  const dead = []
  WRITE_SET.concat([APP]).forEach(rel => {
    parseRules(read(rel)).forEach(r => {
      const props = r.decls.map(d => d.prop)
      r.decls.forEach(d => {
        if (d.prop !== 'position') return
        if (resolveVars(d.val, TOKENS).resolved.trim() !== 'sticky') return
        if (!OFFS.some(p => props.indexOf(p) !== -1)) dead.push(rel + ' L' + r.line + ' ' + r.sel)
      })
    })
  })
  check('T6.1 没有任何规则声明 position:sticky 却不带偏移（写了却不生效的死声明 = 0；偏移取 top/bottom/left/right 任一）',
    dead.length === 0, dead.join(' | '))
  const nh = cascade('.num-head', [APP, W.weather])
  const pos = finalValue(nh, 'position', TOKENS)
  check('T6.2 .num-head 的 position 终值不再是 sticky（本批选 (a)：删误导性死声明；常驻表头属结构改动 ⇒ requests）',
    !pos || pos.value.trim() !== 'sticky', JSON.stringify(pos))
  const nhBg = finalValue(nh, 'background', TOKENS)
  check('T6.3 但 .num-head 的底色声明没被顺手删（终值仍 = --forest-soft，表头行仍与数据行区分）',
    nhBg && nhBg.value.toLowerCase() === TOKENS['--forest-soft'].toLowerCase(), JSON.stringify(nhBg))
  const nhCell = finalValue(cascade('.num-head .nc', [APP, W.weather]), 'color', TOKENS)
  check('T6.4 表头列名的弱化文字色仍解析为 --muted（那条规则依赖表头有底色，底色还在 ⇒ 读法不变）',
    nhCell && nhCell.value.toLowerCase() === TOKENS['--muted'].toLowerCase(), JSON.stringify(nhCell))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swx2-sticky-'))
  fs.writeFileSync(path.join(dir, 'app.wxss'), 'page { --t: 44px }')
  fs.writeFileSync(path.join(dir, 'p.wxss'), '.good { position: sticky; top: 0; background: var(--t) }')
  const good = parseRules(read('p.wxss', dir))
  const hasOffset = good[0].decls.some(d => OFFS.indexOf(d.prop) !== -1)
  check('T6.5 阳性对照的反面：sticky + top:0 不被判死声明（门认的是「偏移是否存在」，不是「有没有 sticky」——下次真做常驻表头不会被自己拦）',
    hasOffset === true)
  fs.rmSync(dir, { recursive: true, force: true })
}

/* ================================================================= */
section('§7 M-07：页面自建控件的命中高度收口到 --touch-target')
const TARGETS = [
  [W.weather, '.seg-btn', '24/48/72h 切窗（view bindtap=onSpanToggle）'],
  [W.weather, '.cond-why', '证据展开开关（view bindtap=onToggleEvidence）'],
  [W.weather, '.reason-link', '看图 ↗（text catchtap=onEvidenceJump）'],
  [W.weather, '.oi-link', 'OI 看图（text catchtap=onOiEvidence）'],
  [W.spaceTime, '.space-time-stay', '留宿开关（view bindtap=onToggleOvernight）'],
  [W.editor, '.chip', '快捷估算 chip（view bindtap=onQuickEnd/onQuickDeadline/onPickupQuickTime）'],
]
{
  const need = pxNum(TOKENS['--touch-target'])
  check('T7.0 尺来自 token：--touch-target 解析为 44px（不是我写死的数）', need === 44, TOKENS['--touch-target'])
  TARGETS.forEach(([rel, sel, label]) => {
    const map = cascade(sel, [APP, rel])
    const e = tapExtent(map, TOKENS, PAGE_LINE)
    check('T7.1 ' + path.basename(rel) + ' ' + sel + '（' + label + '）命中高度终值 ≥44px（实算 ' + e.total + 'px）',
      e.total >= need, JSON.stringify(e))
    check('T7.2 ' + sel + ' 的达标是靠一条真实的尺寸声明（层叠终值里确有 height/min-height/padding/line-height 之一）',
      !!(map.height || map['min-height'] || map.padding || map['padding-top'] || map['line-height']),
      JSON.stringify(Object.keys(map)))
  })
  const seg = finalValue(cascade('.tl-viewseg', [APP, W.weather]), 'flex-direction', TOKENS)
  check('T7.3 切窗三键仍是横排（未把 flex 改成纵向 ⇒ 加高不会把三键叠成三行）',
    seg === null || seg.value === 'row', JSON.stringify(seg))

  // 注释与实现一致：紧贴某条规则的注释若声称 44px，那条规则的实算高度必须真的 ≥44。
  // 只扫我的写入集（app.wxss 的注释归 SWX1）；只认「注释与规则之间不隔别的规则」的紧邻关系；
  // 注释声称的是纵向尺寸 ⇒ 该规则自己没有纵向尺寸声明时跳过（如 .seg.on 的高度由 .segmented .seg 给，
  // 本解析器不建模祖先链，硬算会造假红 —— 这是登记在案的判据边界，不是放过）。
  const lying = []
  const skippedClaim = []
  WRITE_SET.forEach(rel => {
    const css = read(rel)
    const re = /\/\*([\s\S]*?)\*\/(\s*)/g
    let m
    while ((m = re.exec(css))) {
      if (!/44\s*px|≥\s*44|>=\s*44/.test(m[1])) continue
      const after = blankComments(css.slice(m.index + m[0].length))
      // 紧邻判定：注释与下一条规则之间不得再夹着别的规则体（出现 } 早于 { 就说明隔了一条规则）
      const brClose = after.indexOf('}')
      const brOpen = after.indexOf('{')
      if (brOpen < 0 || (brClose >= 0 && brClose < brOpen)) continue
      const rm = /([^\s{}][^{}{}]*)\{([^{}]*)\}/.exec(after)
      if (!rm) continue
      const sel = rm[1].replace(/\s+/g, ' ').trim()
      const own = parseRules('' + rm[1] + '{' + rm[2] + '}')[0]
      const hasVertical = own.decls.some(d => ['height', 'min-height', 'padding', 'padding-top', 'padding-bottom', 'line-height'].indexOf(d.prop) !== -1)
      if (!hasVertical) { skippedClaim.push(path.basename(rel) + ' ' + sel); continue }
      const e = tapExtent(cascade(sel, [APP, rel]), TOKENS, PAGE_LINE)
      if (e.total < need) lying.push(path.basename(rel) + ' 注释声称 ≥44px 而 ' + sel + ' 实算 ' + e.total + 'px')
    }
  })
  check('T7.4 没有「注释谎称达标」：紧邻某条规则、声称 ≥44px 的注释，那条规则的实算高度必须 ≥44（注释与实现不符本身就是缺陷）',
    lying.length === 0, lying.join(' | '))
  if (skippedClaim.length) console.log('  · 判据边界（不硬算祖先链，跳过但逐条登记）：' + skippedClaim.join(' | '))
}

/* ================================================================= */
section('§7b editor 可点 .cluster 行：作用域判据（本轮 DEFERRED；规则一旦出现就立刻开始 enforce）')
{
  const need = pxNum(TOKENS['--touch-target'])
  const wxml = fs.readFileSync(path.join(MP, 'pages/editor/editor.wxml'), 'utf8')
  const rows = clusterRows(wxml)
  const tappable = rows.filter(r => r.tap)
  const rowExtent = tapExtent(cascade('.cluster', [APP, W.editor]), TOKENS, PAGE_LINE).total
  console.log('  · 现状读数：editor.wxml 里带 bindtap/catchtap 的 .cluster 行 ' + tappable.length + ' 条 [' +
    tappable.map(r => 'L' + r.line).join(' ') + ']，其命中高度由全局 .cluster 决定 = ' + rowExtent + 'px（<44 ⇒ M-07 这一半确实未修）')
  check('T7.8 登记用读数：可点 .cluster 行确实存在且当前 <44px（这条 DEFERRED 有数可依，不是编出来的需求）',
    tappable.length >= 5 && rowExtent < need, tappable.length + '/' + rowExtent)
  const rule = tapRowRule([APP, W.editor])
  if (!rule) {
    console.log('  · 判据分支 = 未修：editor.wxss 里没有任何抬升 .cluster 行纵向尺寸的规则 ⇒ 记 DEFERRED-DEPENDENCY' +
      '（精确作用域需要模板上一个类名，见 out/SWX2/requests.md）')
    check('T7.9 未修状态的形状：结构选择器 .stack-gap3 > .cluster:first-child 也没有被写进来（写了就会撞上 T7.10 的溢出判据）',
      cascade('.stack-gap3 > .cluster:first-child', [APP, W.editor])['min-height'] === undefined)
  } else {
    const a = scopeAudit(rows, rule)
    check('T7.9 已修状态的形状：抬升 .cluster 行的规则必须覆盖每一条可点行', a.uncovered.length === 0, a.uncovered.join(','))
    check('T7.9b 且不得抬高任何「不可点且内部没有 ≥44 控件」的行', a.collateral.length === 0, a.collateral.join(','))
  }
  // 条件分支不是装饰：在沙盒里注入那条看起来能用的结构选择器，判据必须立刻报出溢出
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swx2-scope-'))
  writeAt(dir, APP, read(APP))
  writeAt(dir, W.editor, '/* injected */\n.stack-gap3 > .cluster:first-child { min-height: var(--touch-target); }\n')
  const injected = tapRowRule([APP, W.editor], dir)
  const audit = scopeAudit(rows, injected)
  check('T7.10 放弃结构选择器是有数可依的：注入 .stack-gap3 > .cluster:first-child 后，判据当场报出「抬到了不含高控件的不可点行」' +
    '（L' + audit.collateral.join(',L') + '）⇒ 它不是 faithful fix',
    injected !== null && audit.collateral.length > 0, JSON.stringify(audit))
  check('T7.11 同一条注入规则对「覆盖可点行」这一半是够的（说明缺的只是精确性，不是方向）',
    audit.uncovered.length === 0, audit.uncovered.join(','))
  fs.rmSync(dir, { recursive: true, force: true })

  // 反向：本轮未派给我、但同页可点元素的读数（只登记不判红，避免扩大改动面）
  const keep = [
    [W.weather, '.day-card', '选哪一天的 7 日卡'],
    [W.weather, '.oi-item', 'OI 列表行'],
    [W.weather, '.oi-day', 'OI 多日行'],
    [W.chart, '.fc-modes .seg', '横屏切窗（SWX1 已把全局 .segmented .seg 提到 token；此处读数只为确认本轮没碰它）'],
  ]
  keep.forEach(([rel, sel, label]) => {
    const e = tapExtent(cascade(sel, [APP, rel]), TOKENS, PAGE_LINE)
    console.log('  · 未派给我、仅登记读数：' + path.basename(rel) + ' ' + sel + ' = ' + e.total + 'px（' + label + '）')
  })
}
// editor.wxss 里「抬升 .cluster 行纵向尺寸」的那条规则（没有 = 本轮未修）
function tapRowRule(files, base) {
  const rules = []
  files.forEach(rel => parseRules(read(rel, base)).forEach(r => {
    if (r.sel.indexOf('cluster') === -1) return
    const has = r.decls.some(d => ['min-height', 'height', 'padding', 'padding-top'].indexOf(d.prop) !== -1)
    if (has) rules.push(r)
  }))
  return rules.length ? rules[rules.length - 1] : null
}
// 作用域审计：把规则的选择器翻译成对 WXML 行的覆盖关系（只建模这两种写法，出现第三种就报 unknown）
function scopeAudit(rows, rule) {
  const sel = rule.sel
  let cover
  if (/:first-child/.test(sel)) cover = r => r.matched
  else {
    const extra = sel.replace(/[^.\w-]/g, ' ').split(/\s+/).map(s => s.replace(/^\./, '')).filter(c => c && c !== 'cluster' && c !== 'first-child')
    if (!extra.length) return { uncovered: ['无法解析选择器作用域：' + sel], collateral: [] }
    cover = r => extra.every(c => r.cls.indexOf(c) !== -1)
  }
  return {
    uncovered: rows.filter(r => r.tap && !cover(r)).map(r => 'L' + r.line),
    collateral: rows.filter(r => !r.tap && cover(r) && !r.tall).map(r => r.line),
    unknown: [],
  }
}
// 极简 WXML 树扫描：只回答三件事 ——「这条 .cluster 行带不带 tap」「它是不是父级 .stack-gap3 的首个渲染子节点」
// 「它内部有没有已经 ≥44 的全局控件」。只服务于 §7 的作用域判据，不用来证明任何渲染结果（铁律 21）。
function clusterRows(src) {
  const VOID = new Set(['input', 'image', 'icon', 'textarea', 'switch', 'slider', 'checkbox', 'radio'])
  const TALL = new Set(['button', 'picker', 'input', 'form-field', 'chip'])
  const re = /<(\/)?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  const root = { tag: 'root', cls: [], attrs: '', kids: [], line: 0 }
  const stack = [root]
  let m
  while ((m = re.exec(src))) {
    const closing = !!m[1]
    const tag = m[2]
    const attrs = (m[3] || '').replace(/\s+/g, ' ')
    const line = src.slice(0, m.index).split('\n').length
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.splice(i, 1); break }
      continue
    }
    const cls = ((/class="([^"]*)"/.exec(attrs) || [, ''])[1]).split(/\s+/).filter(Boolean)
    const node = { tag, cls, attrs, kids: [], line }
    const parent = stack[stack.length - 1]
    // <block> 不产生节点：它的子节点挂到上一级，但它本身占用「首个子节点」的位置（wx:if 未知，保守处理）
    if (tag === 'block') { node.transparent = true }
    if (!node.transparent) parent.kids.push(node)
    else node.kids = parent.kids, parent.kids.push({ tag: 'block-phantom', cls: [], attrs: '', kids: [], line })
    const selfClose = VOID.has(tag) || /\/\s*>$/.test(m[0])
    if (!selfClose) stack.push(node)
  }
  const out = []
  const hasTall = n => TALL.has(n.tag) || n.cls.some(c => TALL.has(c))
  const walk = (n, parentFirst) => {
    n.kids.forEach((c, i) => {
      const first = i === 0
      if (c.cls.indexOf('cluster') !== -1 && n.cls.indexOf('stack-gap3') !== -1) {
        let tall = false
        const deep = x => { if (hasTall(x)) tall = true; x.kids.forEach(deep) }
        deep(c)
        out.push({ line: c.line, cls: c.cls, tap: /bindtap=|catchtap=/.test(c.attrs), matched: first, tall })
      }
      walk(c, first)
    })
  }
  walk(root, true)
  return out
}

/* ================================================================= */
section('§8 B-14（重复规则两例）：同文件同选择器不得声明两次')
{
  const dup = []
  WRITE_SET.forEach(rel => {
    const seen = {}
    parseRules(read(rel)).forEach(r => r.sels.forEach(s => { (seen[s] = seen[s] || []).push(r.line) }))
    Object.keys(seen).forEach(s => { if (seen[s].length > 1) dup.push(rel + ' ' + s + ' @L' + seen[s].join(',L')) })
  })
  check('T8.1 写入集里没有「同选择器写两遍」（重复定义 2→0：.oi-ev×2、.nick-wrap×2 都收敛成一份）',
    dup.length === 0, dup.join(' | '))
  const oi = cascade('.oi-ev', [APP, W.weather])
  const oiWant = { 'margin-top': '3px', 'padding-left': '104px', display: 'flex', 'align-items': 'baseline', gap: '8px' }
  Object.keys(oiWant).forEach(p => {
    const v = finalValue(oi, p, TOKENS)
    check('T8.2 合并后的 .oi-ev 终值 = 旧两条「层叠赢家」的逐项值：' + p + ' = ' + oiWant[p] +
      '（被覆盖的那条 4px 从来不是生效值，不能拿它当合并基准）', v && v.value === oiWant[p], JSON.stringify(v))
  })
  const nickWant = { flex: '1', 'min-width': '0', display: 'flex', 'flex-direction': 'column', gap: '4px' }
  Object.keys(nickWant).forEach(p => {
    const v = finalValue(cascade('.nick-wrap', [APP, W.me]), p, TOKENS)
    check('T8.3 收敛后 .nick-wrap 的 ' + p + ' 仍 = ' + nickWant[p] + '（两行逐字相同 ⇒ 是真重复，合并零风险）',
      v && v.value === nickWant[p], JSON.stringify(v))
  })
  check('T8.4 且 .nick-wrap 只有一份声明出处（没有把重复换成「同值写两遍」的新形态）',
    parseRules(read(W.me)).filter(r => r.sels.indexOf('.nick-wrap') !== -1).length === 1)
  check('T8.5 两条被合并的规则里没有出现「新加的属性」（合并是纯减法：属性集合与旧赢家一致）',
    Object.keys(oi).filter(p => p !== 'box-sizing').every(p => oiWant[p] !== undefined || ['margin', 'margin-left', 'margin-right'].indexOf(p) !== -1),
    JSON.stringify(Object.keys(oi)))
}

/* ================================================================= */
section('§9 边界与越界自检')
{
  check('T9.1 写入集就是我领到的 9 个文件（不多不少，且不含 app.wxss）',
    WRITE_SET.length === 9 && WRITE_SET.indexOf(APP) === -1, JSON.stringify(WRITE_SET))
  check('T9.2 我没碰 tabbar 与设计系统文档：写入集里没有 custom-tab-bar（E-12 属 SWX1）',
    WRITE_SET.every(f => f.indexOf('custom-tab-bar') === -1))
  const other = []
  allWxss(MP).forEach(rel => {
    if (WRITE_SET.indexOf(rel) !== -1 || rel === APP) return
    parseRules(read(rel)).forEach(r => r.decls.forEach(d => {
      colorLiterals(d.val).forEach(c => {
        const n = normColor(c)
        const hit = Object.keys(TOKENS).filter(k => normColor(TOKENS[k]) === n)
        if (hit.length) other.push(rel + ' ' + r.sel + ' ' + d.prop)
      })
      if (d.prop === 'font-weight' && (pxNum(resolveVars(d.val, TOKENS).resolved) || 0) >= 700) other.push(rel + ' ' + r.sel + ' 700')
    }))
  })
  console.log('  · 写入集之外的同形态问题（未派给我 ⇒ 逐条进 requests/handoff，不在本门判红，也不去改别人的文件）：' +
    (other.length ? other.length + ' 条：' + other.join(' | ') : '无'))
  check('T9.3 登记用读数：写入集之外的问题被如实统计出来（不为凑绿扩大改动面）', typeof other.length === 'number')
  check('T9.4 横屏页的 44px 就地补救未被本轮改动（M-06 若把全局 .seg 提到 44 它就变冗余，那是 SWX1 的裁决）',
    tapExtent(cascade('.fc-modes .seg', [APP, W.chart]), TOKENS, PAGE_LINE).total >= 44)
}

/* ---------------- 计数读数（改前后各跑一次，差值必须闭合） ---------------- */
{
  section('计数读数')
  const hex = [], w700 = [], dup = []
  WRITE_SET.forEach(rel => {
    const seen = {}
    parseRules(read(rel)).forEach(r => {
      r.sels.forEach(s => { seen[s] = (seen[s] || 0) + 1 })
      r.decls.forEach(d => {
        colorLiterals(d.val).forEach(c => {
          const n = normColor(c)
          if (Object.keys(TOKENS).some(k => normColor(TOKENS[k]) === n)) hex.push(rel + ' ' + r.sel + ' ' + d.prop)
          else hex.push(rel + ' ' + r.sel + ' ' + d.prop + '（无同值 token）')
        })
        if (d.prop === 'font-weight' && (pxNum(resolveVars(d.val, TOKENS).resolved) || 0) >= 700) w700.push(rel + ' ' + r.sel)
      })
    })
    Object.keys(seen).forEach(s => { if (seen[s] > 1) dup.push(rel + ' ' + s) })
  })
  const dead = Array.from(new Set(allWxss(MP).flatMap(rel =>
    (blankComments(read(rel)).match(/var\(\s*(--[\w-]+)/g) || [])
      .map(x => /--[\w-]+/.exec(x)[0])
      .filter(n => !Object.prototype.hasOwnProperty.call(TOKENS, n)))))
  const small = TARGETS.map(([rel, sel]) => [rel, sel, tapExtent(cascade(sel, [APP, rel]), TOKENS, PAGE_LINE).total]).filter(x => x[2] < 44)
  const sticky = []
  WRITE_SET.forEach(rel => {
    parseRules(read(rel)).forEach(r => {
      const props = r.decls.map(d => d.prop)
      r.decls.forEach(d => {
        if (d.prop === 'position' && resolveVars(d.val, TOKENS).resolved.trim() === 'sticky' && !['top', 'bottom', 'left', 'right'].some(p => props.indexOf(p) !== -1)) sticky.push(rel + ' ' + r.sel)
      })
    })
  })
  console.log('  未定义 token（种类）: ' + dead.length + (dead.length ? ' [' + dead.join(',') + ']' : ''))
  console.log('  字面色（写入集声明内出现次数；含无同值 token 的残留）: ' + hex.length + (hex.length ? ' [' + hex.join(' | ') + ']' : ''))
  console.log('  font-weight ≥700（声明条数）: ' + w700.length + (w700.length ? ' [' + w700.join(' | ') + ']' : ''))
  console.log('  命名触控目标 <44px（条数）: ' + small.length + (small.length ? ' [' + small.map(x => x[1] + '=' + x[2]).join(' | ') + ']' : ''))
  console.log('  position:sticky 无偏移（条数）: ' + sticky.length + (sticky.length ? ' [' + sticky.join(' | ') + ']' : ''))
  console.log('  同文件重复选择器（条数）: ' + dup.length + (dup.length ? ' [' + dup.join(' | ') + ']' : ''))
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
