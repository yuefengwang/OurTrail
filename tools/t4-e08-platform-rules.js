// E-08 平台硬规则门（四条）的唯一判据实现：被 tools/check.js 追加的步骤 require，
// 也被 tools/t4-e08-test.js（断言套件）与 tools/t4-e08-mutate.js（变异自证）require。
//
// 为什么是「一个模块 + 三个使用方」而不是把判据写在 check.js 里：
// AGENTS.md 铁律 11「不要在测试里镜像页面逻辑」——判据写第二份就会给过期契约背书。
//
// 四条规则（Wave2 派单 §2 的顺序与裁量边界）：
//  R1 底部留白 / sticky：页面用了 .sticky-action（position:fixed 不计入文档流）⇒
//     根节点必须挂 has-sticky，**或**该页 wxss 给根容器声明了等效 padding-bottom。
//     查的是「解析出的留白数值够不够」，不是「那一行 CSS 长什么样」（铁律 30）。
//  R2 Component() 里同名 options 键出现两次：后者静默覆盖前者（真实事故 daa0508），
//     表现是「var(--forest) 解析得出来、.card 一条样式都不套」。
//  R3 具名 slot ↔ multipleSlots：缺了它**内容被静默丢弃**、组件 data 一切正常、页面上什么都没有
//     （P4 真机事故，纯逻辑测试天然测不到）。
//  R4 组件用了 app.wxss 定义、且自己 wxss 没有定义的类 ⇒ 必须 apply-shared（铁律 14）。
//     注意这里刻意读的是「装载结果语义」：同一个 options 键写了两次时，**后写的那份才算数**
//     （这正是 R2 要防的坑），所以 effectiveOptions() 按 last-wins 建模，而不是把两份并起来。
//
// 纪律：命中清单一律返回给调用方打印，本模块自己不做「登记豁免」——
// 豁免机制属于落门的人（见 handoff：本批四条门实测命中均为 0，所以是硬门禁、不带清单）。
'use strict'
const fs = require('fs')
const path = require('path')

/* ============================ 源码扫描底座 ============================ */
/**
 * 逐字符标注：0=代码，1=注释，2=字符串/模板字面量正文，3=正则字面量正文。
 * 返回值与 src 等长，因此下标可以直接换算成行号，切原文也不错位。
 */
function mask(src) {
  const out = new Uint8Array(src.length)
  let mode = 'code'
  const stack = []
  let braceDepth = 0
  let lastMeaning = ''
  const RE_STARTERS = '(,=:[!&|?{};+-*%<>~^returntypeof'
  let i = 0
  const put = (v, from, to) => { for (let k = from; k < to; k++) out[k] = v }
  while (i < src.length) {
    const ch = src[i], nx = src[i + 1]
    if (mode === 'code') {
      if (ch === '/' && nx === '/') { put(1, i, i + 2); i += 2; mode = 'line'; continue }
      if (ch === '/' && nx === '*') { put(1, i, i + 2); i += 2; mode = 'block'; continue }
      if (ch === "'" || ch === '"') { put(2, i, i + 1); i++; mode = (ch === "'") ? 'sq' : 'dq'; continue }
      if (ch === '`') { put(2, i, i + 1); i++; mode = 'tpl'; continue }
      if (ch === '/' && RE_STARTERS.indexOf(lastMeaning) >= 0) {
        // 正则字面量：/.../g —— 里面可能有引号、花括号，不认出来整份文件的标注会错位
        let j = i + 1, inClass = false
        while (j < src.length) {
          const c = src[j]
          if (c === '\\') { j += 2; continue }
          if (c === '[') inClass = true
          else if (c === ']') inClass = false
          else if (c === '/' && !inClass) break
          else if (c === '\n') break // 换行不是正则 ⇒ 判断失守，退回普通字符
          j++
        }
        if (j < src.length && src[j] === '/') { put(3, i, j + 1); lastMeaning = '/'; i = j + 1; continue }
      }
      if (!/\s/.test(ch)) lastMeaning = ch
      if (ch === '{') braceDepth++
      else if (ch === '}') { braceDepth--; if (braceDepth < 0) braceDepth = 0 }
      put(0, i, i + 1); i++; continue
    }
    if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; continue }
      put(1, i, i + 1); i++; continue
    }
    if (mode === 'block') {
      if (ch === '*' && nx === '/') { put(1, i, i + 2); i += 2; mode = 'code'; continue }
      put(1, i, i + 1); i++; continue
    }
    if (mode === 'sq' || mode === 'dq') {
      if (ch === '\\') { put(2, i, Math.min(i + 2, src.length)); i += 2; continue }
      if ((mode === 'sq' && ch === "'") || (mode === 'dq' && ch === '"')) { put(2, i, i + 1); i++; mode = 'code'; continue }
      if (ch === '\n') { mode = 'code'; continue } // 未闭合引号：不再往下传染
      put(2, i, i + 1); i++; continue
    }
    if (mode === 'tpl') {
      if (ch === '\\') { put(2, i, Math.min(i + 2, src.length)); i += 2; continue }
      if (ch === '`') { put(2, i, i + 1); i++; mode = 'code'; continue }
      if (ch === '$' && nx === '{') { put(2, i, i + 2); i += 2; stack.push('tpl'); mode = 'expr'; continue }
      put(2, i, i + 1); i++; continue
    }
    if (mode === 'expr') {
      if (ch === '{') { stack.push('brace'); i++; continue }
      if (ch === '}') {
        stack.pop()
        const top = stack[stack.length - 1]
        i++
        if (top === 'tpl') { put(0, i - 1, i); mode = 'tpl' } else mode = 'expr'
        continue
      }
      // 表达式内部按代码处理（可能有嵌套模板与字符串）
      if (ch === '/' && nx === '/') { put(1, i, i + 2); i += 2; mode = 'line'; continue }
      if (ch === '/' && nx === '*') { put(1, i, i + 2); i += 2; mode = 'block'; continue }
      if (ch === "'" || ch === '"') { put(2, i, i + 1); i++; mode = (ch === "'") ? 'sq' : 'dq'; continue }
      if (ch === '`') { put(2, i, i + 1); i++; mode = 'tpl'; continue }
      put(0, i, i + 1); i++; continue
    }
    put(0, i, i + 1); i++
  }
  return out
}

/** 把注释/字符串正文换成空格（长度不变），用于安全地跑正则而不吃进字面量。 */
function codeText(src, mk) {
  let s = ''
  for (let i = 0; i < src.length; i++) s += (mk[i] === 0 ? src[i] : (src[i] === '\n' ? '\n' : ' '))
  return s
}

function lineOf(src, idx) {
  let n = 1
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++
  return n
}

/** 从 openIdx 的 '{' 找到配对的 '}'（只认代码位的花括号）。 */
function matchBrace(src, mk, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (mk[i] !== 0) continue
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}

/**
 * 对象字面量的**顶层键**清单：[{name, keyIdx, valueStart, valueEnd}]。
 * 嵌套结构（含方法简写 attached() {…}、值里的对象）靠 depth 计数整体跳过。
 * last-wins 的语义不在这里实现，交给 effectiveValue()。
 */
function topLevelKeys(src, mk, start, end) {
  const keys = []
  let depth = 0, i = start + 1
  let pending = null
  while (i < end) {
    const ch = src[i]
    if (mk[i] !== 0) { i++; continue }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; i++; continue }
    if (depth === 0 && /[A-Za-z_$]/.test(ch)) {
      let j = i
      while (j < end && mk[j] === 0 && /[A-Za-z0-9_$]/.test(src[j])) j++
      const name = src.slice(i, j)
      let k = j
      while (k < end && (/\s/.test(src[k]) || mk[k] !== 0)) k++
      if (src[k] === ':') {
        if (pending) pending.endIdx = i
        pending = { name, keyIdx: i, valueStart: k + 1, endIdx: -1 }
        keys.push(pending)
        i = k + 1
        continue
      }
      i = j
      continue
    }
    if (depth === 0 && ch === ',' && pending) { pending.endIdx = i; pending = null }
    i++
  }
  if (pending && pending.endIdx === -1) pending.endIdx = end
  return keys
}

/** 找到 `Name( {…} )` 形态的调用里那个对象字面量区间。 */
function literalOfCall(src, mk, callName) {
  const code = codeText(src, mk)
  const out = []
  const re = new RegExp('(?:^|[^A-Za-z0-9_$.])' + callName + '\\s*\\(', 'g')
  let m
  while ((m = re.exec(code)) !== null) {
    const parenIdx = code.indexOf('(', m.index)
    if (parenIdx < 0) continue
    let i = parenIdx + 1
    while (i < src.length && (/\s/.test(src[i]) || mk[i] === 1)) i++
    if (src[i] !== '{') continue // Component(变量) 之类：没有字面量就没有重复键可言
    const close = matchBrace(src, mk, i)
    if (close < 0) continue
    out.push({ start: i, end: close })
  }
  return out
}

/** 顶层键里最后一个同名键的原文 —— 微信的 Component() 就是这份生效（后写覆盖前写）。 */
function effectiveValue(src, keys, name) {
  let found = null
  for (const k of keys) if (k.name === name) found = k
  return found
}

/** 把某个「值为对象字面量」的键再展开一层，拿到生效 options 的键表。 */
function valueKeys(src, mk, key) {
  if (!key) return null
  let i = key.valueStart
  while (i < key.endIdx && (/\s/.test(src[i]) || mk[i] !== 0)) i++
  if (src[i] !== '{') return null
  const close = matchBrace(src, mk, i)
  if (close < 0 || close > key.endIdx) return null
  return { start: i, end: close, keys: topLevelKeys(src, mk, i, close) }
}

function lineText(src, idx) {
  const s = src.lastIndexOf('\n', idx - 1) + 1
  const e = src.indexOf('\n', idx)
  return src.slice(s, e < 0 ? src.length : e).trim()
}

/* ============================ 世界（文件集） ============================ */
function walk(dir, out) {
  out = out || []
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'assets') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** ctx：一次扫描用到的全部文件与缓存，沙盒与真实仓库共用同一套判据。 */
function makeCtx(mpRoot) {
  const files = walk(mpRoot)
  const cache = new Map()
  const read = (abs) => {
    if (!cache.has(abs)) cache.set(abs, fs.readFileSync(abs, 'utf8'))
    return cache.get(abs)
  }
  return {
    root: mpRoot,
    files,
    read,
    rel: abs => path.relative(mpRoot, abs).split(path.sep).join('/'),
    abs: rel => path.join(mpRoot, rel.split('/').join(path.sep)),
    exists: rel => fs.existsSync(path.join(mpRoot, rel.split('/').join(path.sep))),
  }
}

/** 去掉块注释（JS/WXSS 用）：注释里的 options:/class/示例标签都不算代码。 */
function stripComments(text) {
  const mk = mask(text)
  let s = ''
  for (let i = 0; i < text.length; i++) s += (mk[i] === 1 ? ' ' : text[i])
  return s
}

/**
 * WXML 只剥 `<!-- -->`：模板里 `https://…` 这种字符串会被 JS 注释规则误杀
 * （mask 把 `//` 当行注释 ⇒ 整行消失 ⇒ 门变成看不见输入的门）。
 * 必须**等长**替换（保留换行），否则报出来的行号会整体偏移。
 */
function stripWxml(text) {
  return text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
}

/* ============================ 类名与样式表 ============================ */
/** WXML 里 class / hover-class 属性值取出的类 token（含 {{cond ? 'a' : 'b'}} 里的引号字面量）。 */
function classAttrValues(text) {
  const out = []
  for (const m of text.matchAll(/(?:^|[\s/])(class|hover-class)\s*=\s*"([^"]*)"/g)) {
    out.push({ attr: m[1], value: m[2], idx: m.index + m[0].indexOf(m[2]) })
  }
  return out
}

function classTokens(text) {
  const hits = []
  for (const a of classAttrValues(text)) {
    for (const token of tokeniseClassValue(a.value)) hits.push({ token, idx: a.idx, attr: a.attr })
  }
  return hits
}

function tokeniseClassValue(value) {
  // {{ ... }} 里只有引号内的字面量是类名，别的都是表达式
  const parts = value.replace(/\{\{[\s\S]*?\}\}/g, seg => {
    const lits = seg.match(/'[^']*'|"[^"]*"/g) || []
    return ' ' + lits.map(x => x.slice(1, -1)).join(' ') + ' '
  })
  return parts.split(/[\s,]+/).map(x => x.trim()).filter(x => x && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(x))
}

/** wxss 里「被定义的类」：选择器位上的 .name（声明块正文里的 .name 不算定义）。 */
function definedClasses(text) {
  const clean = stripComments(text)
  const map = new Map()
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]
    const at = m.index + selector.indexOf('{')
    for (const c of selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      if (!map.has(c[1])) map.set(c[1], lineOf(text, m.index + c.index))
    }
    void at
  }
  return map
}

/** 一条声明值换算成 px（rpx 按 750 设计基线折半，保守取 0.5；env() 不计入）。 */
function lengthToPx(value) {
  const v = value.replace(/\/\*[\s\S]*?\*\//g, '')
  if (/var\(/.test(v)) return { px: null, unknown: true, reason: '值里含 var()，静态无法确认留白实际是多少' }
  let px = 0
  let seen = false
  for (const m of v.matchAll(/(-?\d+(?:\.\d+)?)\s*(px|rpx)/g)) {
    seen = true
    px += Number(m[1]) * (m[2] === 'rpx' ? 0.5 : 1)
  }
  if (!seen) return { px: null, unknown: true, reason: '没读出 px/rpx 长度（' + v.trim().slice(0, 40) + '）' }
  return { px, unknown: false }
}

/** 逐规则块读出「选择器 → 声明」，用于 R1 的终值判定。 */
function rulesOf(text) {
  const clean = stripComments(text)
  const out = []
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2], offset: m.index })
  }
  return out
}

function declarations(body, prop) {
  const out = []
  const re = new RegExp('(?:^|[;])\\s*' + prop + '\\s*:([^;}]*)', 'g')
  for (const m of body.matchAll(re)) out.push(m[1].trim())
  return out
}

/* ============================ R1 固定底栏 ↔ 页尾留白 ============================ */
const R1 = {
  id: 'R1',
  title: '固定底栏与页尾留白必须配对（platform-pitfalls §5）',
  run(ctx) {
    const hits = []
    if (!ctx.exists('app.wxss')) return { hits, fatal: 'app.wxss 读不到：本门没有输入' }
    const app = ctx.read(ctx.abs('app.wxss'))
    // 需要的留白不由本门凭空造数：取 app.wxss 自己给 .page.has-sticky 声明的值。
    const mech = rulesOf(app).find(r => /(^|,)\s*\.page\.has-sticky\s*$/.test(r.selector))
    if (!mech) {
      return { hits, fatal: 'app.wxss 里没有 .page.has-sticky 这条机制了（要么规则被删，要么选择器改名）——' +
        '固定底栏的留白约定失去唯一出处，本门必须人工确认后重新落地，不能静默放过全部页面' }
    }
    const need = declarations(mech.body, 'padding-bottom').map(lengthToPx)
    const needPx = need.filter(x => !x.unknown).reduce((a, x) => Math.max(a, x.px), 0)
    if (!needPx) return { hits, fatal: '.page.has-sticky 的 padding-bottom 读不出长度值（' + JSON.stringify(need) + '）' }

    const users = []
    for (const f of ctx.files.filter(x => x.endsWith('.wxml'))) {
      const text = stripWxml(ctx.read(f))
      if (!/(?:^|[\s/])class\s*=\s*"[^"]*\bsticky-action\b/.test(text)) continue
      users.push(f)
    }
    for (const f of users) {
      const text = stripWxml(ctx.read(f))
      // 根节点 = class 属性值里出现独立 token `page` 的那个元素（本项目页面根节点都是 .page）。
      const roots = classAttrValues(text).filter(a => tokeniseClassValue(a.value).includes('page'))
      const rootOk = roots.some(a => /(^|[\s'"])has-sticky([\s'"]|$)/.test(' ' + a.value + ' '))
      if (rootOk) continue
      // 等效留白：同页 wxss 里给 page/.page（含 .page.xxx 复合）声明了足够大的 padding-bottom
      const wxss = f.replace(/\.wxml$/, '.wxss')
      let equivalent = false, why = ''
      if (fs.existsSync(wxss)) {
        const rootRules = rulesOf(ctx.read(wxss)).filter(r =>
          r.selector.split(',').some(seg => /^\s*(page|\.page)\b/.test(seg.trim())))
        const vals = rootRules.flatMap(r => declarations(r.body, 'padding-bottom')).map(lengthToPx)
        if (vals.some(v => v.unknown)) why = '（其中一处 ' + vals.find(v => v.unknown).reason + '）'
        equivalent = vals.some(v => !v.unknown && v.px >= needPx)
      } else why = '（该页没有同名 wxss）'
      if (equivalent) continue
      const at = roots.length ? roots[0].idx : text.indexOf('sticky-action')
      const line = lineOf(ctx.read(f), at)
      hits.push({
        file: ctx.rel(f), line,
        why: '本页用了 .sticky-action（position:fixed，高度不计入文档流），' +
          '但根节点既没挂 has-sticky、页面 wxss 也没有 ≥' + needPx + 'px 的根容器 padding-bottom' + why +
          ' ⇒ 页尾最后一行会被底栏压在下面（底部控件点不到，只有真机看得见）',
      })
    }
    return { hits, stat: '用固定底栏的页面 ' + users.length + ' 个；app.wxss 要求的留白 = ' + needPx + 'px' }
  },
}

/* ============================ R2 Component() 同名 options 键 ============================ */
function componentFiles(ctx) {
  const out = []
  for (const f of ctx.files.filter(x => x.endsWith('.js'))) {
    const rel = ctx.rel(f)
    if (!/^(components|custom-tab-bar)\//.test(rel)) continue
    const src = ctx.read(f)
    if (/(?:^|[^A-Za-z0-9_$.])Component\s*\(/.test(codeText(src, mask(src)))) out.push(f)
  }
  return out
}

const R2 = {
  id: 'R2',
  title: '同一个 Component() 里同名键不得出现两次（AGENTS.md 铁律 1，事故 daa0508）',
  run(ctx) {
    const hits = []
    const scanned = []
    for (const f of componentFiles(ctx)) {
      const src = ctx.read(f)
      const mk = mask(src)
      scanned.push(f)
      for (const lit of literalOfCall(src, mk, 'Component')) {
        const seen = new Map()
        for (const k of topLevelKeys(src, mk, lit.start, lit.end)) {
          const prev = seen.get(k.name)
          if (prev) {
            hits.push({
              file: ctx.rel(f), line: lineOf(src, k.keyIdx),
              why: 'Component() 的对象字面量里第 2 次写 `' + k.name + ':`,（第 ' + prev.line + ' 行已写过）。' +
                'JS 的对象字面量后写覆盖前写，微信框架拿到的只有这一份 ⇒ ' +
                (k.name === 'options'
                  ? '上一份里的 styleIsolation:apply-shared 会静默消失，组件内部所有 app.wxss 全局类当场失去样式（看起来是「UI 莫名散架」，node --check 与逻辑测试都抓不到）'
                  : '上一份配置整份作废'),
              snippet: lineText(src, k.keyIdx),
            })
          }
          seen.set(k.name, { line: lineOf(src, k.keyIdx) })
        }
      }
    }
    return { hits, stat: '扫了 ' + scanned.length + ' 个含 Component() 的文件' }
  },
}

/* ============================ R3 具名 slot ↔ multipleSlots ============================ */
const R3 = {
  id: 'R3',
  title: '声明具名 slot 的组件必须 multipleSlots:true（P4 真机事故：内容被静默丢弃）',
  run(ctx) {
    const hits = []
    const unresolved = []
    let defs = 0
    for (const f of ctx.files.filter(x => x.endsWith('.wxml'))) {
      const rel = ctx.rel(f)
      if (!rel.startsWith('components/')) continue
      const text = stripWxml(ctx.read(f))
      const names = [...text.matchAll(/<slot\b[^>]*\bname\s*=\s*"([^"]+)"/g)].map(m => m[1])
      if (!names.length) continue
      defs += names.length
      const dir = path.dirname(f)
      const base = path.basename(dir)
      const js = path.join(dir, base + '.js')
      const where = { file: rel, line: lineOf(ctx.read(f), text.indexOf('<slot')) }
      if (!fs.existsSync(js)) {
        hits.push({ ...where, why: '具名 slot ' + JSON.stringify(names) + ' 找不到同名组件 JS，无法确认装载姿态' })
        continue
      }
      const opt = optionsOf(ctx.read(js))
      if (opt.kind === 'variable') { unresolved.push(rel); continue }
      if (opt.kind === 'none') {
        hits.push({ ...where, why: '组件 wxml 里有具名 slot ' + JSON.stringify(names) + '，但 Component() 里没有 options ⇒ ' +
          '微信默认只装载第一个 slot，具名 slot 里的内容被静默丢弃：组件 data 一切正常、页面上那块区域是空的，' +
          '纯逻辑测试与 node --check 全绿（这是 P4 真机实测过的形态）。请写 options: { multipleSlots: true }' })
        continue
      }
      const val = opt.map.get('multipleSlots')
      if (!val || val.text !== 'true') {
        hits.push({ ...where, why: '具名 slot ' + JSON.stringify(names) + ' 的组件，生效 options 里 multipleSlots=' +
          (val ? val.text : '（没写）') + ' ⇒ 具名 slot 内容永不渲染（同上）。注意若 options 键写过两次，生效的是**后一份**' })
      }
    }
    return { hits, stat: '具名 slot 声明 ' + defs + ' 处' + (unresolved.length ? '；options 静态展不开的组件 ' + unresolved.length + ' 个（' + unresolved.join(', ') + '）' : ''), idle: defs === 0 }
  },
}

/**
 * 组件的「生效 options」——微信拿到的就是最后一个同名键（后写覆盖前写），
 * 所以这里按 last-wins 取，而不是把两份并起来（R2 防的正是这个坑的表现形态）。
 * kind：literal=静态读到了；none=根本没写；variable=options 来自变量/展开，静态展不开。
 */
function optionsOf(src) {
  const mk = mask(src)
  const lits = literalOfCall(src, mk, 'Component')
  if (!lits.length) return { kind: 'none', map: new Map() }
  const keys = topLevelKeys(src, mk, lits[0].start, lits[0].end)
  const optKey = effectiveValue(src, keys, 'options')
  if (!optKey) return { kind: 'none', map: new Map() }
  const vk = valueKeys(src, mk, optKey)
  if (!vk) return { kind: 'variable', map: null }
  const out = new Map()
  for (const k of vk.keys) {
    out.set(k.name, {
      text: src.slice(k.valueStart, k.endIdx).trim().replace(/,$/, '').trim(),
      line: lineOf(src, k.keyIdx),
    })
  }
  return { kind: 'literal', map: out }
}

/** 兼容旧调用：只关心键值表时用这个（读不到就是 null）。 */
function effectiveOptions(src) {
  const r = optionsOf(src)
  return r.kind === 'literal' ? r.map : null
}

/* ============================ R4 用全局类必须 apply-shared ============================ */
const R4 = {
  id: 'R4',
  title: '用了 app.wxss 的类就必须 opt-in styleIsolation:apply-shared（铁律 14）',
  run(ctx) {
    const hits = []
    if (!ctx.exists('app.wxss')) return { hits, fatal: 'app.wxss 读不到：本门没有输入' }
    const appSet = definedClasses(ctx.read(ctx.abs('app.wxss')))
    if (appSet.size === 0) return { hits, fatal: 'app.wxss 里一个类选择器都没解析出来 ⇒ 本门会静默空转，先修解析器' }
    let checked = 0
    const unresolved = []
    for (const f of ctx.files.filter(x => x.endsWith('.wxml'))) {
      const rel = ctx.rel(f)
      if (!rel.startsWith('components/') && !rel.startsWith('custom-tab-bar/')) continue
      checked++
      const dir = path.dirname(f)
      const base = path.basename(dir)
      const js = path.join(dir, base + '.js')
      if (!fs.existsSync(js)) continue
      const src = ctx.read(js)
      if (!/(?:^|[^A-Za-z0-9_$.])Component\s*\(/.test(codeText(src, mask(src)))) continue
      const local = new Map()
      const ownWxss = path.join(dir, base + '.wxss')
      if (fs.existsSync(ownWxss)) for (const [k, v] of definedClasses(ctx.read(ownWxss))) local.set(k, v)
      const used = classTokens(stripWxml(ctx.read(f)))
      const depend = used.filter(t => appSet.has(t.token) && !local.has(t.token))
      if (!depend.length) continue
      const opt = optionsOf(src)
      if (opt.kind === 'variable') { unresolved.push(rel); continue }
      const iso = opt.kind === 'literal' ? opt.map.get('styleIsolation') : null
      if (iso && iso.text.replace(/['"]/g, '') === 'apply-shared') continue
      hits.push({
        file: rel, line: lineOf(ctx.read(f), depend[0].idx),
        why: '组件用了 ' + depend.length + ' 个只定义在 app.wxss 的类（' +
          [...new Set(depend.map(d => d.token))].slice(0, 6).join(', ') + '），生效 options 里 styleIsolation=' +
          (iso ? iso.text : (opt.kind === 'none' ? '（没写 options）' : '（读不出）')) +
          ' ⇒ 自定义组件默认 isolated，app.wxss 的**类选择器**不注入组件内部（var() 靠继承仍解析得出来）。' +
          '表现就是「颜色对、边框全无」，静态与逻辑测试都看不见。请加 options: { styleIsolation: \'apply-shared\' }',
      })
    }
    return { hits, stat: 'app.wxss 类名 ' + appSet.size + ' 个；检查了 ' + checked + ' 个组件模板' +
      (unresolved.length ? '；options 静态展不开的组件 ' + unresolved.length + ' 个（' + unresolved.join(', ') + '）' : '') }
  },
}

const RULES = [R1, R2, R3, R4]

/* ============================ 规则自证（正例必红 / 反例必绿） ============================ */
// check.js 每次跑都会带上这段：它保证「门在真实仓库全绿」不是因为解析器读不到东西。
// 与 check.js:131 的路径分隔符教训同源——静默空转的门比没有门更危险。
function fixtureWorld(extra) {
  const mp = {
    'app.wxss': '.page { padding: 0 }\n.page.has-sticky { padding-bottom: 120px; }\n.card { border: 1px solid red }\n',
    'pages/demo/demo.wxml': '<view class="page"><view class="card">hi</view></view>\n',
    'pages/demo/demo.wxss': '.demo { color: red }\n',
    'pages/sticky/sticky.wxml': '<view class="page has-sticky"><view class="sticky-action">go</view></view>\n',
    'pages/sticky/sticky.wxss': '.sticky { color: red }\n',
    'components/ok/ok.js': "Component({ options: { styleIsolation: 'apply-shared', multipleSlots: true }, methods: {} })\n",
    'components/ok/ok.wxml': '<view class="card"><slot name="x"></slot></view>\n',
    'components/ok/ok.wxss': '',
    'components/ok/ok.json': '{}\n',
  }
  Object.assign(mp, extra || {})
  return mp
}

function runRulesOn(map) {
  const dir = writeFixture(map)
  try {
    const ctx = makeCtx(dir)
    const out = []
    for (const r of RULES) out.push({ id: r.id, result: r.run(ctx) })
    return out
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function writeFixture(map) {
  const os = require('os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't4-e08-fixture-'))
  for (const [rel, text] of Object.entries(map)) {
    const p = path.join(dir, rel.split('/').join(path.sep))
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
  }
  return dir
}

const SELF_CASES = [
  {
    id: 'S0 反例（夹具本身必须全绿，否则下面的正例没有意义）',
    world: fixtureWorld(),
    expect: {},
  },
  {
    id: 'S1 用 .sticky-action 却没挂 has-sticky ⇒ R1 红',
    world: fixtureWorld({ 'pages/sticky/sticky.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n' }),
    expect: { R1: 1 },
  },
  {
    id: 'S1b 等效留白（页面 wxss 给 .page 写 140px）⇒ R1 不得误伤（裁量：不钉写法）',
    world: fixtureWorld({
      'pages/sticky/sticky.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n',
      'pages/sticky/sticky.wxss': '.page { padding-bottom: 140px; }\n',
    }),
    expect: {},
  },
  {
    id: 'S1c 留白不足（20px）⇒ R1 仍红：终值判定，不是「写了 padding-bottom 就算过」',
    world: fixtureWorld({
      'pages/sticky/sticky.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n',
      'pages/sticky/sticky.wxss': '.page { padding-bottom: 20px; }\n',
    }),
    expect: { R1: 1 },
  },
  {
    id: 'S1d 留白是 var() 读不出终值 ⇒ R1 失败关闭（铁律 26②：未知不得冒充「已经留够了」）',
    world: fixtureWorld({
      'pages/sticky/sticky.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n',
      'pages/sticky/sticky.wxss': '.page { padding-bottom: var(--sticky-space); }\n',
    }),
    expect: { R1: 1 },
  },
  {
    id: 'S2 第二个 options 键 ⇒ R2 红，且后一份才是生效的那份（R3/R4 必须同时红：证明 last-wins 建模没骗人）',
    world: fixtureWorld({
      'components/ok/ok.js': "Component({ options: { styleIsolation: 'apply-shared', multipleSlots: true },\n  options: { addGlobalClass: true }, methods: {} })\n",
    }),
    expect: { R2: 1, R3: 1, R4: 1 },
  },
  {
    id: 'S3 具名 slot 但没 multipleSlots ⇒ R3 红',
    world: fixtureWorld({ 'components/ok/ok.js': "Component({ options: { styleIsolation: 'apply-shared' }, methods: {} })\n" }),
    expect: { R3: 1 },
  },
  {
    id: 'S4 用全局类却没 apply-shared（且自己没有定义）⇒ R4 红',
    world: fixtureWorld({ 'components/ok/ok.js': 'Component({ methods: {} })\n' }),
    expect: { R3: 1, R4: 1 },
  },
  {
    id: 'S4b 同名类在组件自己的 wxss 里有定义 ⇒ R4 不得误伤（查的是「只存在于 app.wxss」这个事实）',
    world: fixtureWorld({
      'components/ok/ok.js': 'Component({ methods: {} })\n',
      'components/ok/ok.wxss': '.card { border: 0 }\n',
    }),
    expect: { R3: 1 },
  },
  {
    id: 'S5 阈值单源：app.wxss 把留白要求改成 200px ⇒ 同一份 140px 等效留白必须变红（门没把 120 写死）',
    world: fixtureWorld({
      'app.wxss': '.page { padding: 0 }\n.page.has-sticky { padding-bottom: 200px; }\n.card { border: 1px solid red }\n',
      'pages/sticky/sticky.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n',
      'pages/sticky/sticky.wxss': '.page { padding-bottom: 140px; }\n',
    }),
    expect: { R1: 1 },
  },
  {
    id: 'S6 合法重构不误伤（铁律 30）：options 挪进变量 ⇒ 静态展不开 ⇒ 只登记不判红',
    world: fixtureWorld({
      'components/ok/ok.js': "const opts = { styleIsolation: 'apply-shared', multipleSlots: true }\nComponent({ options: opts, methods: {} })\n",
      'pages/sticky/sticky.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n',
      'pages/sticky/sticky.wxss': '.page { padding-bottom: 140px; }\n',
    }),
    expect: {},
  },
]

/** 返回失败描述数组；空数组＝四条门都确实会咬。expect 里的数字=该规则应有的命中数。 */
function selfProof() {
  const bad = []
  for (const c of SELF_CASES) {
    const byId = {}
    for (const { id, result } of runRulesOn(c.world)) byId[id] = (result.hits || []).length
    for (const r of RULES) {
      const want = c.expect[r.id] || 0
      if (byId[r.id] !== want) bad.push(c.id + '：' + r.id + ' 期望命中 ' + want + ' 实际 ' + byId[r.id])
    }
  }
  return bad
}

module.exports = {
  RULES,
  R1, R2, R3, R4,
  makeCtx,
  mask, codeText, topLevelKeys, literalOfCall, effectiveOptions, effectiveValue, optionsOf,
  stripComments, stripWxml, classAttrValues, classTokens, tokeniseClassValue,
  definedClasses, lengthToPx, rulesOf, declarations, componentFiles,
  selfProof, runRulesOn, writeFixture, fixtureWorld, SELF_CASES,
}
