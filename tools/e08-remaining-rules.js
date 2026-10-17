// T5b/E-08 续批：platform-pitfalls 剩余硬规则的五条静态门（判据唯一出处）。
//
// 与 tools/t4-e08-platform-rules.js 的关系：**延续形态、不复用判据、不修改它**。
//   · 共用它的解析底座（makeCtx / mask / codeText / stripComments / stripWxml / lengthToPx /
//     classAttrValues / tokeniseClassValue / literalOfCall / topLevelKeys / effectiveValue），
//     解析器写两份＝两份会各自烂掉（铁律 11）；
//   · 五条规则本身 (3)(6)(7)(8)(11) 一条都不重叠：T4 落的是 (1)(2)(5) 三族，
//     check.js 第 8 步落的是 (3) 的**带连字符**那一半（fixround2-event-attr-rule.js），
//     本批 G3 只补**裸事件名**那一半（`tap="onTap"` 这种没有连字符的写法，第 8 步的属性名正则
//     要求至少一个连字符 ⇒ 恒不匹配）。两边的词表都是同一份 EVENT_NAMES（直接 require 那份，
//     不复制第二张表）⇒ 同一件事不会有两种判法。
//
// 五条门（编号沿用 findings.md E-08「修复方向」的 (1)…(11)，便于对账）：
//  G3=(3) WXML 属性名是已知事件名却缺 bind/catch 前缀 ⇒ 只是一个普通自定义属性，回调永不执行
//     （E-07 的 `animation-end="noop"` 同族，那一半已有门，这一半没有）。
//  G6=(6) 页尾留白必须与 app.json 的 tabBar.list **身份**一致：tab 页要让出固定底栏的高度、
//     子页不得白让这一截（E-03 本体）。遮挡物需要让出多少**不抄 84 这个数**，由
//     custom-tab-bar/index.wxss 自己的声明现场算出（阈值单源，铁律 31③）。
//  G7=(7) WXSS 不支持特性黑名单：color-mix() / :root / dvh·svh·lvh / backdrop-filter / :has() /
//     通配选择器。**必须先剥注释**——app.wxss:2 的注释里合规地讨论着这些词，不剥就是假红。
//  G8=(8) position: sticky 必须**同一选择器**带 top/bottom/left/right 之一，且值不是 auto
//     （E-06 本体：死声明看着像吸住、实际从不吸）。
//  G11=(11) 同一 .wxss 内同一选择器把关键布局属性（display/align-items/justify-content/
//     position/margin/padding 六族）写两遍 ⇒ 后写覆盖前写（E-01 本体，overlay.wxss 的活体已由
//     前棒收敛成一条，本批复验终值逐字节不变）。
//
// 三条纪律：
//   ① 判据本体不登记豁免清单、不留白名单（命中 >0 的门不落，见 out/T5b/handoff.md 的复跑读数）；
//   ② 每条门都自带「输入为空即 fatal」的自检——check.js:131 踩过路径分隔符导致清单为空、
//      整个反向检查静默空转，那比没有门更糟；
//   ③ 读不出终值一律**失败关闭**（var() 当「留够了」是凭空造有利事实，同铁律 26②/34⑤）。
'use strict'
const path = require('path')
const T4 = require('./t4-e08-platform-rules')
const EV = require('./fixround2-event-attr-rule')

const makeCtx = T4.makeCtx
const mask = T4.mask
const codeText = T4.codeText
const stripComments = T4.stripComments
const stripWxml = T4.stripWxml
const lengthToPx = T4.lengthToPx
const classAttrValues = T4.classAttrValues
const classTokens = T4.classTokens
const tokeniseClassValue = T4.tokeniseClassValue
const literalOfCall = T4.literalOfCall
const topLevelKeys = T4.topLevelKeys
const effectiveValue = T4.effectiveValue

/* ============================ 本批补的下标底座 ============================ */
// T4 的 rulesOf() 只回 body 原文，报不出「前写在哪一行、后写在哪一行」这两条行号；
// 这里要的是同一份注释剥离结果上的**声明下标**，所以只做索引，不另起一套判据。
function lineOf(src, idx) {
  let n = 1
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') n++
  return n
}

function lineText(src, idx) {
  const s = src.lastIndexOf('\n', idx - 1) + 1
  const e = src.indexOf('\n', idx)
  return src.slice(s, e < 0 ? src.length : e).trim()
}

/** 从 openIdx 的 '{' 找配对 '}'（只认代码位的花括号）。 */
function braceClose(src, mk, openIdx) {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (mk[i] !== 0) continue
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return i }
  }
  return -1
}

/**
 * 把一份 .wxss 解析成规则块清单：
 *   { selector, sels:[…], selLine, decls:[{prop,value,index,line}], at:boolean, atLine }
 * 选择器组（`a, b {…}`）按逗号拆进 sels，G11 要按**单个选择器**归组，
 * 否则 `.a, .b {}` 与 `.a {}` 会被当成两个不同的键而漏掉一次真覆盖。
 * 剥注释用等长替换 ⇒ 下标可直接换算行号。
 */
function parseRules(text) {
  const clean = stripComments(text)
  const out = []
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1]
    const bodyStart = m.index + head.length + 1
    const body = m[2]
    const selector = head.replace(/\s+/g, ' ').trim()
    const at = /^@/.test(selector)
    const decls = []
    if (!at) {
      for (const d of body.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([^;]*)/g)) {
        decls.push({
          prop: d[1].toLowerCase(),
          value: d[2].trim(),
          index: bodyStart + d.index,
          line: lineOf(text, bodyStart + d.index),
        })
      }
    }
    out.push({
      selector, at,
      atLine: lineOf(text, m.index),
      selLine: lineOf(text, m.index),
      sels: at ? [] : selector.split(',').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean),
      decls,
      offset: m.index,
    })
  }
  return out
}

/**
 * padding/margin 简写 → 四边，并带出「哪一行定的」。
 * 块内后写覆盖前写（与微信层叠一致）；四值/三值/两值/一值的展开是标准映射，
 * 本文件的夹具与 tools/e08-remaining-test.js §解析底座 各钉一条，改错就红。
 */
const SIDE_SUFFIX = { top: '-top', right: '-right', bottom: '-bottom', left: '-left' }
function sidesOf(decls, family) {
  const box = { top: null, right: null, bottom: null, left: null }
  const put = (side, value, d) => { box[side] = { value, line: d.line, index: d.index } }
  for (const d of decls) {
    if (d.prop === family) {
      const parts = d.value.split(/\s+/).filter(Boolean)
      if (!parts.length) continue
      const n = parts.length
      const p0 = parts[0]
      const p1 = parts[1] !== undefined ? parts[1] : p0
      const p2 = parts[2] !== undefined ? parts[2] : (n === 2 ? p0 : p1)
      const p3 = parts[3] !== undefined ? parts[3] : p1
      put('top', p0, d); put('right', p1, d); put('bottom', p2, d); put('left', p3, d)
      continue
    }
    for (const side of Object.keys(SIDE_SUFFIX)) {
      if (d.prop === family + SIDE_SUFFIX[side]) put(side, d.value, d)
    }
  }
  return box
}

/** 一条长度值 → 可比的 {px, safe, unknown}；safe=是否让了安全区（底栏自己就让，页面也得让）。 */
function lengthReading(value) {
  if (value === null || value === undefined) return { px: 0, safe: false, unknown: false, missing: true, raw: null }
  const r = lengthToPx(value)
  return { px: r.px, safe: /safe-area-inset/.test(value), unknown: !!r.unknown, reason: r.reason || '', raw: value }
}

/* ============================ 组件标签与属性表（G3 用） ============================ */
/** 全仓自定义组件标签名（路径分隔符先归一化：check.js:131 那条教训在这里同样会踩）。 */
function componentTagSet(ctx) {
  const set = new Set()
  for (const f of ctx.files) {
    const rel = ctx.rel(f)
    const m = rel.match(/^components\/([a-z0-9-]+)\/[a-z0-9-]+\.json$/)
    if (m) set.add(m[1])
  }
  return set
}

/**
 * 组件 Component() 里 properties 声明的属性名集合。
 * kind：literal=读到了；none=根本没声明属性；variable=来自变量/展开，静态展不开（调用方登记，不猜）。
 */
function propertiesOf(ctx, tag) {
  const rel = 'components/' + tag + '/' + tag + '.js'
  if (!ctx.exists(rel)) return { kind: 'none', set: new Set() }
  const src = ctx.read(ctx.abs(rel))
  const mk = mask(src)
  const lits = literalOfCall(src, mk, 'Component')
  if (!lits.length) return { kind: 'none', set: new Set() }
  const keys = topLevelKeys(src, mk, lits[0].start, lits[0].end)
  const p = effectiveValue(src, keys, 'properties')
  if (!p) return { kind: 'none', set: new Set() }
  let i = p.valueStart
  while (i < p.endIdx && (/\s/.test(src[i]) || mk[i] !== 0)) i++
  if (src[i] !== '{') return { kind: 'variable', set: null }
  const close = braceClose(src, mk, i)
  if (close < 0 || close > p.endIdx) return { kind: 'variable', set: null }
  return { kind: 'literal', set: new Set(topLevelKeys(src, mk, i, close).map(k => k.name)) }
}

/**
 * 嵌套 at-rule 探测：本门的分块解析器只吃「一层平铺」的规则块。
 * `@media { .a { … } }` 会被它读成一条选择器叫 `.a` 的顶层规则——**里面写的东西被当成外面的**，
 * 于是 G7/G8/G11 会在自己没看见的输入上报告「命中 0」（假绿）。所以撞上嵌套一律失败关闭。
 * `@import`/`@charset`（无规则块）不算；`@keyframes` 的 from/to 也是嵌套块 ⇒ 算。
 */
const NESTED_AT = /^(?:media|supports|document|layer|container|keyframes|-webkit-keyframes)$/
function nestedAtRules(text) {
  const clean = stripComments(text)
  const out = []
  for (const m of clean.matchAll(/(^|[\s;{}])@([A-Za-z-]+)([^{};]*)\{/g)) {
    const name = m[2].toLowerCase()
    if (!NESTED_AT.test(name)) continue
    out.push({ name, line: lineOf(text, m.index + m[1].length), head: ('@' + m[2] + m[3]).replace(/\s+/g, ' ').trim() })
  }
  return out
}

/** 嵌套时统一给出的 fatal 文案（三条门共用一句，避免三种说法）。 */
function nestedFatal(ctx, f, list) {
  return ctx.rel(f) + ':' + list[0].line + ' 出现嵌套 at-rule（' + list.map(x => x.head).join('; ') +
    '）：本门的分块解析器只吃平铺规则块，继续跑会把「里面」的规则当成「外面」的，' +
    '在没看见的输入上报命中 0 ⇒ 本门拒绝工作（铁律 30：门不许假装看过）'
}

/* ============================ G3 · 裸事件名属性（少 bind/catch 前缀） ============================ */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const ATTR_SINGLE_RE = /(?:^|\s)([A-Za-z][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const RESERVED_VALUES = new Set(['true', 'false', 'null', 'undefined'])

function classifyBare(ctx, comps, note, tag, name, value) {
  if (name.indexOf('-') >= 0 || name.indexOf(':') >= 0) return null // 带连字符/冒号的形状归 check.js 第 8 步
  if (/^(bind|catch|capture-)/.test(name)) return null              // 合法绑定形式
  if (!EV.EVENT_NAMES.has(name)) return null                        // 词表只有一份（require 来的，不复制）
  if (!IDENT.test(value) || RESERVED_VALUES.has(value)) return null // {{插值}}/数字/布尔/中文都不是 handler 名
  if (comps.has(tag)) {
    const props = propertiesOf(ctx, tag)
    if (props.kind === 'variable') { note.unresolved.push(ctx.rel(ctx.abs('components/' + tag + '/' + tag + '.js'))); return null }
    if (props.kind === 'literal' && props.set.has(name)) return null // 组件自己声明了这个属性 ⇒ 那是传值，不是绑事件
  }
  return name
}

const G3 = {
  id: 'G3',
  title: 'WXML 裸事件名属性必须带 bind/catch 前缀（与第 8 步的连字符口径互补，不重叠）',
  run(ctx) {
    const hits = []
    const note = { unresolved: [] }
    const wxml = ctx.files.filter(f => f.endsWith('.wxml'))
    if (!wxml.length) return { hits, fatal: '一个 .wxml 都没扫到：本步骤会静默空转（同 check.js:131 的分隔符教训）' }
    const comps = componentTagSet(ctx)
    if (!comps.size) return { hits, fatal: '组件标签清单为空 ⇒ 无法区分「自定义组件的属性」与「少前缀的事件绑定」，本门会静默放行全部' }
    let attrSeen = 0
    for (const f of wxml) {
      const raw = ctx.read(f)
      const text = stripWxml(raw) // 只剥 <!-- -->：等长，且不吃 URL 里的 //（T4 的注释教训）
      for (const m of text.matchAll(TAG_RE)) {
        const tag = m[1]
        const attrs = m[2] || ''
        for (const a of attrs.matchAll(ATTR_SINGLE_RE)) {
          attrSeen++
          const name = classifyBare(ctx, comps, note, tag, a[1], a[2])
          if (!name) continue
          const at = m.index + a.index
          hits.push({
            file: ctx.rel(f), line: lineOf(raw, at), snippet: lineText(raw, at),
            why: '<' + tag + '> 上的 `' + name + '="' + a[2] + '"` 里 `' + name + '` 是已知事件名，' +
              '但 WXML 的事件绑定只认 bind…/catch…/bind:…；少了前缀它只是一个普通自定义属性，' +
              '节点挂上它、回调永不执行 ⇒ 同名 handler 活成死方法（E-07 的 animation-end="noop" 就是这个形态，' +
              '第 8 步只抓带连字符的写法，`' + name + '` 这种裸写法此前无人管）。' +
              '写成 bind' + name + '="' + a[2] + '"（自定义组件事件用 bind:' + name + '）',
          })
        }
      }
    }
    return {
      hits,
      stat: '扫了 ' + wxml.length + ' 个 wxml、' + attrSeen + ' 个裸词属性；组件标签 ' + comps.size + ' 个' +
        (note.unresolved.length ? '；properties 静态展不开的组件 ' + [...new Set(note.unresolved)].join(', ') + '（不猜内容）' : ''),
    }
  },
}

/* ============================ G6 · 页尾留白 ↔ tabBar 身份 ============================ */
/** 遮挡物需要让出多少：全部从 custom-tab-bar/index.wxss **自己的声明**现场算，不抄 84 这个数。 */
function reserveNeed(ctx) {
  if (!ctx.exists('custom-tab-bar/index.wxss')) return { fatal: 'custom-tab-bar/index.wxss 读不到：遮挡物的高度没有出处，本门无法工作' }
  const text = ctx.read(ctx.abs('custom-tab-bar/index.wxss'))
  const nested = nestedAtRules(text)
  if (nested.length) return { fatal: nestedFatal(ctx, ctx.abs('custom-tab-bar/index.wxss'), nested) }
  const rules = parseRules(text)
  const bar = rules.filter(r => r.sels.some(s => /^\.(tabbar|tab-bar)$/.test(s)))
  if (!bar.length) return { fatal: 'custom-tab-bar/index.wxss 里解析不出 .tabbar（选择器改名或整块被删）⇒「tab 页该让出多少」失去唯一出处，' +
    '本门必须人工重做才能落地，不能静默放行全部页面' }
  if (!bar.some(r => r.decls.some(d => d.prop === 'position' && /fixed/.test(d.value)))) {
    return { fatal: '.tabbar 不再是 position:fixed ⇒ 它计入文档流、页面本就不必让位；本门的前提变了，请人工确认后重新落地' }
  }
  const barDecls = bar.flatMap(r => r.decls)
  const pad = sidesOf(barDecls, 'padding')
  const borderTopDecl = barDecls.filter(d => d.prop === 'border-top').pop() || barDecls.filter(d => d.prop === 'border').pop()
  const tabSizeDecl = rules.filter(r => r.sels.some(s => /^\.tab(\.on)?$/.test(s))).flatMap(r => r.decls)
    .filter(d => d.prop === 'min-height' || d.prop === 'height').pop()
  if (!tabSizeDecl) return { fatal: '.tab 没有 min-height/height ⇒ 底栏高度没有出处（本门不假设它是 44px）' }
  const parts = [
    { label: 'padding-top', read: lengthReading(pad.top && pad.top.value) },
    { label: 'padding-bottom', read: lengthReading(pad.bottom && pad.bottom.value) },
    { label: 'border-top', read: lengthReading(borderTopDecl && borderTopDecl.value.split(/\s+/)[0]) },
    { label: '.tab 高', read: lengthReading(tabSizeDecl.value.split(/\s+/)[0]) },
  ]
  for (const p of parts) {
    if (p.read.unknown) return { fatal: '遮挡物自己的 ' + p.label + ' 读不出终值（' + p.read.raw + ' → ' + p.read.reason +
      '）⇒ 不能凭猜测要求页面留白（失败关闭，同铁律 26②）' }
  }
  const px = parts.reduce((a, p) => a + (p.read.px || 0), 0)
  if (!px) return { fatal: '算出来的让出量是 0px ⇒ 解析一定没吃进东西，本门拒绝工作' }
  return {
    px,
    safe: !!(pad.bottom && /safe-area-inset/.test(pad.bottom.value)),
    detail: parts.map(p => p.label + ' ' + (p.read.px || 0)).join(' + '),
  }
}

/** 根载体：选择器各段都是 page/.page（可再挂类，如 .page.has-sticky）的规则。 */
function isRootCarrier(sel) {
  return /^(?:page|\.page)(?:\.[A-Za-z0-9_-]+)*$/.test(sel)
}
function isUnconditionalRootCarrier(sel) {
  return /^(?:page|\.page)$/.test(sel)
}
function classSpecificity(sel) {
  return (sel.match(/\./g) || []).length
}

/**
 * 该页**自己**的 wxss 里，无条件根载体（page / .page）的 padding-bottom 终值。
 * 只认无条件那一支：`.page.has-sticky` 这类条件类只在条件成立时才有留白，
 * tab 页拿它顶数就是 home 空状态那一支被 tabBar 盖住的形态（b4 的 T2.5 实测红过）。
 */
function ownReserve(ctx, pageRel) {
  const none = { found: false, read: lengthReading(null), line: 1, condOnly: [] }
  const wxssRel = pageRel + '.wxss'
  if (!ctx.exists(wxssRel)) return none
  const text = ctx.read(ctx.abs(wxssRel))
  const bad = nestedAtRules(text)
  if (bad.length) return { ...none, nested: nestedFatal(ctx, ctx.abs(wxssRel), bad) }
  const cand = []
  const condOnly = []
  for (const r of parseRules(text)) {
    if (r.at) continue
    const uncond = r.sels.filter(isUnconditionalRootCarrier)
    const cond = r.sels.filter(s => isRootCarrier(s) && !isUnconditionalRootCarrier(s))
    if (cond.length) condOnly.push(...cond)
    if (!uncond.length) continue
    const box = sidesOf(r.decls, 'padding')
    if (!box.bottom) continue
    cand.push({ spec: Math.max(...uncond.map(classSpecificity)), value: box.bottom.value, line: box.bottom.line })
  }
  if (!cand.length) return { ...none, condOnly }
  const best = cand.reduce((a, b) => (b.spec >= a.spec ? b : a))
  return { found: true, read: lengthReading(best.value), line: best.line, condOnly }
}

const G6 = {
  id: 'G6',
  title: '页尾留白必须与 app.json 的 tabBar 身份一致（tab 页要让、子页不得白让；platform-pitfalls §5）',
  run(ctx) {
    const hits = []
    if (!ctx.exists('app.json')) return { hits, fatal: 'app.json 读不到：页面身份没有出处，本门无法工作' }
    let json
    try { json = JSON.parse(stripComments(ctx.read(ctx.abs('app.json')))) } catch (e) { return { hits, fatal: 'app.json 解析失败：' + e.message } }
    const pages = Array.isArray(json.pages) ? json.pages : []
    if (!pages.length) return { hits, fatal: 'app.json 的 pages 为空 ⇒ 本门一条页面都判不到（静默空转）' }
    const list = ((json.tabBar && json.tabBar.list) || []).map(t => t.pagePath)
    if (!list.length) return { hits, fatal: 'app.json 没有 tabBar.list ⇒ 「tab 页/子页」的分组失去真值源（本门不许把页面名单写死在代码里）' }
    const orphan = list.filter(p => !pages.includes(p))
    if (orphan.length) return { hits, fatal: 'tabBar.list 里的 ' + orphan.join(', ') + ' 不在 pages 里 ⇒ 身份无法核对，请人工确认' }
    const need = reserveNeed(ctx)
    if (need.fatal) return { hits, fatal: need.fatal }

    const tabPages = pages.filter(p => list.includes(p))
    const subPages = pages.filter(p => !list.includes(p))
    let condMention = 0
    for (const p of pages) {
      const own = ownReserve(ctx, p)
      if (own.nested) return { hits, fatal: own.nested }
      if (own.condOnly.length) condMention += own.condOnly.length
      const isTab = list.includes(p)
      if (isTab) {
        if (!own.found) {
          hits.push({ file: p + '.wxss', line: 1, why: '这一页在 app.json 的 tabBar.list 里（tabBar 是 position:fixed、不计入文档流，' +
            '需要让出 ' + need.px + 'px' + (need.safe ? ' + 安全区' : '') + '，出处：custom-tab-bar/index.wxss 的 ' + need.detail + '），' +
            '但本页自己的 wxss 里没有无条件根载体（page/.page）的 padding-bottom ⇒ 页尾最后一行会被底栏压在下面（底部的按钮与文字点不到，只有真机看得见）。' +
            '靠 .page.xxx 条件类让位不算：那一支只在条件成立时才有留白' })
          continue
        }
        if (own.read.unknown) {
          hits.push({ file: p + '.wxss', line: own.line, why: 'tab 页的页尾留白读不出终值（' + own.read.raw + ' → ' + own.read.reason +
            '）⇒ 不能凭「大概够」判通过（未知不得冒充有利事实，同铁律 26②/34⑤）' })
          continue
        }
        if (own.read.px < need.px) {
          hits.push({ file: p + '.wxss', line: own.line, why: 'tab 页只让了 ' + own.read.px + 'px，固定底栏需要 ' + need.px + 'px（' + need.detail +
            '）⇒ 差额 ' + (need.px - own.read.px) + 'px 的内容被 tabBar 盖住' })
          continue
        }
        if (need.safe && !own.read.safe) {
          hits.push({ file: p + '.wxss', line: own.line, why: 'tab 页让了 ' + own.read.px + 'px 却没让安全区，而底栏自己就写着 env(safe-area-inset-bottom)' +
            ' ⇒ 有底部横条的机器上仍然差一截（留白必须与遮挡物同维）' })
        }
        continue
      }
      // 子页：不得白让 tab 专用的一整截
      if (!own.found) continue
      const usesSticky = ctx.exists(p + '.wxml') && /(?:^|[\s/])class\s*=\s*"[^"]*\bsticky-action\b/.test(stripWxml(ctx.read(ctx.abs(p + '.wxml'))))
      if (own.read.unknown || own.read.px < need.px) continue
      if (usesSticky) continue // 这一页有固定底栏要避让，那份留白归 T4 的 R1 管（够不够），不是 tabBar 的额度
      hits.push({ file: p + '.wxss', line: own.line, why: '这一页不在 app.json 的 tabBar.list 里（navigateTo 进来的子页，屏幕底部没有 tabBar），' +
        '却无条件让了 ' + own.read.px + 'px（tab 专用额度是 ' + need.px + 'px' + (need.safe ? '+安全区' : '') + '）⇒ 页尾凭空多出一整截空白（E-03/M-18 本体）。' +
        '若这页真有固定底栏，请挂 .sticky-action（那条路已有门查留白够不够），否则删掉这份覆盖、回落 app.wxss 基线' })
    }
    return {
      hits,
      stat: 'tab 页 ' + tabPages.length + ' / 子页 ' + subPages.length + '（名单现场读自 app.json tabBar.list）；' +
        '遮挡物需要 ' + need.px + 'px' + (need.safe ? '+安全区' : '') + '，出处 ' + need.detail +
        (condMention ? '；另有条件类载体 ' + condMention + ' 处不计入无条件留白' : ''),
    }
  },
}

/* ============================ G7 · WXSS 不支持特性黑名单 ============================ */
const BLACKLIST = [
  { tag: 'color-mix()', re: /color-mix\s*\(/g, why: 'WXSS 的编译/渲染链不支持 color-mix()（platform-pitfalls §3）⇒ 整条声明作废，混合色一律用 app.wxss 里预算好的字面量 token（铁律 13/17：不发明新色值）' },
  { tag: ':root', re: /:root(?![\w-])/g, why: 'WXSS 没有 :root，自定义属性必须声明在 page 上（app.wxss 就是这么做的）⇒ 写 :root 时全表 var(--x) 静默失去出处，页面「有结构、全是默认色」' },
  { tag: 'dvh/svh/lvh', re: /(?:\d|[\s(:])\s*(?:dvh|svh|lvh)\b/g, why: '小程序 WXSS 对 *vh 新视口单位支持不稳（platform-pitfalls §8）⇒ 用 vh 或 min-height，别赌' },
  { tag: 'backdrop-filter', re: /backdrop-filter/g, why: 'WXSS 不支持 backdrop-filter ⇒ 声明整条作废，毛玻璃效果静默消失（真机上就是一块不透明的白）' },
  { tag: ':has()', re: /:has\s*\(/g, why: 'WXSS 选择器引擎没有 :has() ⇒ 整条规则不匹配，靠它做的条件样式全部失效' },
]

const G7 = {
  id: 'G7',
  title: 'WXSS 不支持特性黑名单（color-mix / :root / dvh·svh·lvh / backdrop-filter / :has / 通配选择器）',
  run(ctx) {
    const hits = []
    const wxss = ctx.files.filter(f => f.endsWith('.wxss'))
    if (!wxss.length) return { hits, fatal: '一个 .wxss 都没扫到 ⇒ 本步骤会静默空转' }
    let tokenHits = 0
    for (const f of wxss) {
      const raw = ctx.read(f)
      const nested = nestedAtRules(raw)
      if (nested.length) return { hits, fatal: nestedFatal(ctx, f, nested) }
      // 必须先剥 /* */ 与 ''/"" 正文：app.wxss:2 的注释里合规地**提到**这些词，
      // 不剥就是一条假红；反过来 mask 与原文等长，报出来的行号不会偏移。
      const scan = codeText(raw, mask(raw))
      for (const b of BLACKLIST) {
        b.re.lastIndex = 0
        for (const m of scan.matchAll(b.re)) {
          tokenHits++
          hits.push({ file: ctx.rel(f), line: lineOf(raw, m.index), snippet: lineText(raw, m.index), why: 'WXSS 特性黑名单命中 ' + b.tag + '：' + b.why })
        }
      }
      // 通配选择器只看选择器位，不看声明值（值里的 * 不是选择器）
      for (const r of parseRules(raw)) {
        if (r.at) continue
        for (const s of r.sels) {
          if (!/\*/.test(s)) continue
          tokenHits++
          hits.push({ file: ctx.rel(f), line: r.selLine, snippet: s, why: '通配选择器 `' + s + '`：WXSS 的选择器子集不保证支持 * ⇒ 规则可能整条不生效，且它会命中第三方/内置节点，把不该改的也改掉。请写明确类名' })
        }
      }
    }
    return { hits, stat: '扫了 ' + wxss.length + ' 个 wxss，黑名单 6 类；命中 ' + tokenHits + ' 处（其中 ' + hits.length + ' 处进红）' }
  },
}

/* ============================ G8 · sticky 必须带偏移 ============================ */
const OFFSET_PROPS = ['top', 'bottom', 'left', 'right']

const G8 = {
  id: 'G8',
  title: 'position: sticky 必须同一选择器带 top/bottom/left/right 之一且值非 auto（E-06：死声明看着像吸住）',
  run(ctx) {
    const hits = []
    const wxss = ctx.files.filter(f => f.endsWith('.wxss'))
    if (!wxss.length) return { hits, fatal: '一个 .wxss 都没扫到 ⇒ 本步骤会静默空转' }
    let sticky = 0
    let crossBlock = 0
    for (const f of wxss) {
      const raw = ctx.read(f)
      const nested = nestedAtRules(raw)
      if (nested.length) return { hits, fatal: nestedFatal(ctx, f, nested) }
      const rules = parseRules(raw)
      for (const r of rules) {
        if (r.at) continue
        const pos = r.decls.filter(d => d.prop === 'position')
        if (!pos.some(d => /sticky/.test(d.value))) continue
        sticky++
        const offs = r.decls.filter(d => OFFSET_PROPS.includes(d.prop))
        if (offs.length && offs.some(d => !/^auto$/.test(d.value))) continue
        // 同一选择器在别处补偏移：层叠上真的会合并 ⇒ 不判红，但要在统计里点名（留痕，不静默）
        const elsewhere = rules.some(o => o !== r && !o.at && o.sels.some(s => r.sels.includes(s)) &&
          o.decls.some(d => OFFSET_PROPS.includes(d.prop) && !/^auto$/.test(d.value)))
        if (elsewhere) { crossBlock++; continue }
        hits.push({
          file: ctx.rel(f), line: offs.length ? offs[0].line : r.selLine, snippet: lineText(raw, r.offset),
          why: '这一条声明了 `position: sticky` 却' + (offs.length ? '四个偏移只写了 `auto`' : '同一选择器里没有 top/bottom/left/right 任何一条偏移') +
            ' ⇒ sticky 没有吸附上限就等价于 static：节点照常滚动、代码里以为它吸住了（E-06 的形态，静态与逻辑测试全绿，只有真机看得见）。' +
            '注意判据是「同一选择器」而不是「全文件出现过 top」：' + (offs.length ? '把 auto 换成具体偏移（如 top: 0）' : '给这一条（或同选择器的另一条）补一条非 auto 的偏移'),
        })
      }
    }
    return { hits, stat: '扫了 ' + wxss.length + ' 个 wxss；position:sticky 的规则块 ' + sticky + ' 处（另有 ' + crossBlock + ' 处靠同选择器的另一块补齐偏移）' }
  },
}

/* ============================ G11 · 同文件同选择器的关键布局属性双写 ============================ */
const LAYOUT_FAMILIES = ['display', 'align-items', 'justify-content', 'position', 'margin', 'padding']
function familyOf(prop) {
  if (prop === 'margin' || /^margin-(top|right|bottom|left)$/.test(prop)) return 'margin'
  if (prop === 'padding' || /^padding-(top|right|bottom|left)$/.test(prop)) return 'padding'
  return prop
}

const G11 = {
  id: 'G11',
  title: '同一 wxss 内同一选择器不得把关键布局属性写两遍（后写覆盖前写；E-01 本体）',
  run(ctx) {
    const hits = []
    const wxss = ctx.files.filter(f => f.endsWith('.wxss'))
    if (!wxss.length) return { hits, fatal: '一个 .wxss 都没扫到 ⇒ 本步骤会静默空转' }
    let selectors = 0
    let repeated = 0
    for (const f of wxss) {
      const raw = ctx.read(f)
      const nested = nestedAtRules(raw)
      if (nested.length) return { hits, fatal: nestedFatal(ctx, f, nested) }
      const rules = parseRules(raw)
      const bySel = new Map()
      rules.forEach((r, i) => {
        if (r.at) return
        for (const s of new Set(r.sels)) {
          if (!bySel.has(s)) bySel.set(s, [])
          bySel.get(s).push({ rule: r, order: i })
        }
      })
      selectors += bySel.size
      for (const [sel, blocks] of bySel) {
        if (blocks.length < 2) continue
        const firstSeen = new Map() // family → {line, value, order}
        for (const b of blocks) {
          for (const d of b.rule.decls) {
            const fam = familyOf(d.prop)
            if (!LAYOUT_FAMILIES.includes(fam)) continue
            const prev = firstSeen.get(fam)
            if (prev && prev.order !== b.order && !prev.reported) {
              repeated++
              prev.reported = true
              hits.push({
                file: ctx.rel(f), line: prev.line, snippet: lineText(raw, prev.index),
                why: '选择器 `' + sel + '` 在同一文件里把关键布局属性 `' + fam + '` 写了两遍：第 ' + prev.line + ' 行 `' + prev.value +
                  '` 被第 ' + d.line + ' 行 `' + d.value + '` 覆盖。同特异度后写压死前写 ⇒ 前一条是**死声明**：' +
                  '读代码的人（和 review 的 agent）会拿它当现状理解，E-01/M-10 的 `.overlay-root { align-items: stretch }` 就是这样把 18 处 sheet 顶端对齐、' +
                  '而 overlay.wxss 的 `.overlay--dialog` 双写把 `margin: auto` 压成死声明（本批 B0 复验的就是那条收敛的终值）。' +
                  '请并成一条（值必须逐属性不变），或让后一条只做增量并改掉选择器（不同特异度）',
              })
            }
            if (!prev) firstSeen.set(fam, { line: d.line, value: d.value, order: b.order, index: d.index })
          }
        }
      }
    }
    return { hits, stat: '扫了 ' + wxss.length + ' 个 wxss；选择器 ' + selectors + ' 个，其中关键布局属性双写 ' + repeated + ' 处' }
  },
}

const RULES = [G3, G6, G7, G8, G11]

// 已接进 tools/check.js 的门：**只有实测命中 0 的才进**（派单纪律：不落一条有命中的门、不加白名单、
// 不加跳过清单）。G11 复跑命中 1 处活体 ⇒ 判据已实现并由自证夹具证明确实会咬，但本轮不进门：
//   miniprogram/app.wxss:320 `.input, .textarea { padding: 12px 0 }` 被 :334 `.textarea { padding: 12px }`
//   同特异度后写压死（.textarea 那一支的 `12px 0` 从来不是生效值）。
// 那一处属台账 M-02/样式收敛的活，改法与复验读数见 tools/e08-remaining-test.js §G11 与 out/T5b/handoff.md；
// 收敛完成后把 G11 加进 GATED 即可（夹具 S8/S8b/S8d/S8e 已经备好它的牙齿）。
const GATED = [G3, G6, G7, G8]
const BLOCKED = [{ id: 'G11', hits: 1, blocker: 'miniprogram/app.wxss 的 .textarea padding 双写未收敛' }]

/* ============================ 自证夹具（正例必红 / 反例必绿） ============================ */
const TABBAR_CSS = '.tabbar {\n  position: fixed;\n  left: 0; right: 0; bottom: 0;\n  padding: 8px 12px;\n' +
  '  padding-bottom: calc(8px + env(safe-area-inset-bottom));\n  border-top: 1px solid #DEE3DB;\n}\n' +
  '.tab { flex: 1; display: flex; min-height: 44px; }\n'
const TAB_RESERVE = '.page { padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom)); }\n'

function fixtureWorld(extra) {
  const mp = {
    'app.json': JSON.stringify({
      pages: ['pages/tab/tab', 'pages/plain/plain', 'pages/sticky/sticky'],
      tabBar: { custom: true, list: [{ pagePath: 'pages/tab/tab', text: '活动' }] },
    }) + '\n',
    'app.wxss': '.page { padding: 24px 20px 32px; }\n.page.has-sticky { padding-bottom: 120px; }\n.card { border: 1px solid red }\n',
    'custom-tab-bar/index.wxss': TABBAR_CSS,
    'custom-tab-bar/index.js': 'Component({ options: { styleIsolation: \'apply-shared\' }, methods: {} })\n',
    'pages/tab/tab.wxml': '<view class="page"><text class="card">hi</text></view>\n',
    'pages/tab/tab.wxss': TAB_RESERVE,
    'pages/tab/tab.json': '{}\n',
    'pages/plain/plain.wxml': '<view class="page"><text>x</text></view>\n',
    'pages/plain/plain.wxss': '.plain { color: red; display: flex }\n',
    'pages/plain/plain.json': '{"usingComponents":{"probe":"/components/probe/probe"}}\n',
    'pages/sticky/sticky.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n',
    'pages/sticky/sticky.wxss': '.page { padding-bottom: 140px; }\n',
    'pages/sticky/sticky.json': '{}\n',
    'components/probe/probe.js': 'Component({ properties: { label: String, error: String }, ' +
      "options: { styleIsolation: 'apply-shared' }, methods: {} })\n",
    'components/probe/probe.wxml': '<view class="card">{{label}}</view>\n',
    'components/probe/probe.wxss': '.probe { color: red }\n',
    'components/probe/probe.json': '{"component":true}\n',
  }
  Object.assign(mp, extra || {})
  return mp
}

function runRulesOn(map) {
  const dir = T4.writeFixture(map)
  try {
    const ctx = makeCtx(dir)
    return RULES.map(r => ({ id: r.id, result: r.run(ctx) }))
  } finally {
    require('fs').rmSync(dir, { recursive: true, force: true })
  }
}

const SELF_CASES = [
  { id: 'S0 反例：夹具基线必须全绿（否则后面的正例没有意义）', world: fixtureWorld(), expect: {} },

  {
    id: 'S1 裸事件名（E-07 的孪生形态）：<view tap="onTap"> ⇒ G3 红',
    world: fixtureWorld({ 'pages/plain/plain.wxml': '<view class="page"><view tap="onTap">x</view></view>\n' }),
    expect: { G3: 1 },
  },
  {
    id: 'S1b 自定义组件上写了它**没声明**的名字：<probe tap="onTap"> ⇒ G3 红（同样是永不触发）',
    world: fixtureWorld({ 'pages/plain/plain.wxml': '<view class="page"><probe tap="onTap"></probe></view>\n' }),
    expect: { G3: 1 },
  },
  {
    id: 'S2 反例：<probe error="none"> 里 error 是组件自己声明的属性 ⇒ G3 不得误伤（不先把属性当死事件）',
    world: fixtureWorld({ 'pages/plain/plain.wxml': '<view class="page"><probe error="none"></probe></view>\n' }),
    expect: {},
  },
  {
    id: 'S2b 反例：合法绑定与插值属性一律放行（bindtap / bind:tap / tap="{{fn}}" / error="{{x}}" / data-*）',
    world: fixtureWorld({
      'pages/plain/plain.wxml': '<view class="page"><view bindtap="onTap" bind:tap="onTap2" tap="{{fn}}" ' +
        'data-tap="onTap" error="{{errors.name}}" confirm-type="done">x</view></view>\n',
    }),
    expect: {},
  },

  { id: 'S3 tab 页把页尾留白整条删掉 ⇒ G6 红（内容被 tabBar 盖住）',
    world: fixtureWorld({ 'pages/tab/tab.wxss': '.tab-inner { color: red }\n' }), expect: { G6: 1 } },
  { id: 'S3b tab 页只让 40px（< 遮挡物需要的 61px）⇒ G6 红：查的是数值够不够，不是「写没写」',
    world: fixtureWorld({ 'pages/tab/tab.wxss': '.page { padding-bottom: 40px; }\n' }), expect: { G6: 1 } },
  { id: 'S3c tab 页让了 300px 却没让安全区 ⇒ G6 红（底栏自己写着 env，留白必须同维）',
    world: fixtureWorld({ 'pages/tab/tab.wxss': '.page { padding-bottom: 300px; }\n' }), expect: { G6: 1 } },
  { id: 'S3d tab 页留白是 var() 读不出终值 ⇒ G6 失败关闭（未知不冒充「已经留够了」）',
    world: fixtureWorld({ 'pages/tab/tab.wxss': '.page { padding-bottom: var(--x); }\n' }), expect: { G6: 1 } },
  { id: 'S4 E-03 本体：子页（不在 tabBar.list）无条件吃了 tab 专用的那一截 ⇒ G6 红',
    world: fixtureWorld({ 'pages/plain/plain.wxss': TAB_RESERVE }), expect: { G6: 1 } },
  { id: 'S4b 反例：子页有 .sticky-action 要避让 ⇒ 那份留白归 T4/R1 管，G6 不得误伤',
    world: fixtureWorld({ 'pages/plain/plain.wxml': '<view class="page"><view class="sticky-action">go</view></view>\n', 'pages/plain/plain.wxss': '.page { padding-bottom: 140px; }\n' }),
    expect: {} },
  { id: 'S4c 豁免不是空门：同样 140px，但这一页没有固定底栏 ⇒ G6 必须红',
    world: fixtureWorld({ 'pages/plain/plain.wxml': '<view class="page"><text>x</text></view>\n', 'pages/plain/plain.wxss': '.page { padding-bottom: 140px; }\n' }),
    expect: { G6: 1 } },
  { id: 'S4d 只靠条件类让位（.page.has-sticky 那一支才有留白）⇒ tab 页仍红：无条件那一支会被盖住',
    world: fixtureWorld({ 'pages/tab/tab.wxss': '.page.has-sticky { padding-bottom: 200px; }\n' }), expect: { G6: 1 } },
  {
    id: 'S5 阈值单源（铁律 31③）：把 .tab 的 min-height 从 44px 提到 200px ⇒ 同一份 116px 立刻变红，报错里的数跟着变',
    world: fixtureWorld({ 'custom-tab-bar/index.wxss': TABBAR_CSS.replace('min-height: 44px', 'min-height: 200px') }),
    expect: { G6: 1 },
  },
  {
    id: 'S5b 阈值单源的反向：底栏缩到 30px（.tab 从 44 改 13）⇒ 同一份 40px+安全区的 tab 页转为绿（门没把 61 写死在代码里）',
    world: fixtureWorld({
      'custom-tab-bar/index.wxss': TABBAR_CSS.replace('min-height: 44px', 'min-height: 13px'),
      'pages/tab/tab.wxss': '.page { padding-bottom: calc(40px + env(safe-area-inset-bottom)); }\n',
    }),
    expect: {},
  },
  {
    id: 'S5c 遮挡物不再 fixed ⇒ G6 报「前提变了」（失败关闭，不静默放行全部页面）',
    world: fixtureWorld({ 'custom-tab-bar/index.wxss': TABBAR_CSS.replace('position: fixed', 'position: relative') }),
    expect: {}, fatalRule: 'G6',
  },
  {
    id: 'S5d 让出量只写在 padding 简写里（没有 padding-bottom 长边）⇒ 必须照样算出 61px：门读的是四边展开的终值，不是属性名',
    world: fixtureWorld({
      'custom-tab-bar/index.wxss': '.tabbar { position: fixed; padding: 8px 12px 8px; border-top: 1px solid #DEE3DB }\n.tab { min-height: 44px }\n',
    }),
    expect: {},
  },
  {
    id: 'S5e 单源读数再确认：同 S5d 但 .tab 缩到 13px ⇒ 需要量从 61 掉到 30（8+8+1+13），子页留 20px 仍然绿（阈值不是写死的 61）',
    world: fixtureWorld({
      'custom-tab-bar/index.wxss': '.tabbar { position: fixed; padding: 8px 12px 8px; border-top: 1px solid #DEE3DB }\n.tab { min-height: 13px }\n',
      'pages/plain/plain.wxss': '.page { padding-bottom: 20px; }\n',
    }),
    expect: {},
  },
  {
    id: 'S5f 同一份需要量 30px 下，子页留 40px 就红 ⇒ 子页那一侧的门也跟单源走（不是只放宽不收紧）',
    world: fixtureWorld({
      'custom-tab-bar/index.wxss': '.tabbar { position: fixed; padding: 8px 12px 8px; border-top: 1px solid #DEE3DB }\n.tab { min-height: 13px }\n',
      'pages/plain/plain.wxss': '.page { padding-bottom: 40px; }\n',
    }),
    expect: { G6: 1 },
  },

  {
    id: 'S6 WXSS 黑名单：六类各来一条 ⇒ G7 红 6 处',
    world: fixtureWorld({
      'pages/plain/plain.wxss': '.plain { color: color-mix(in srgb, red 50%, white) }\n' +
        ':root { --x: 1px }\n.wrap { height: 100dvh }\n.blur { backdrop-filter: blur(4px) }\n' +
        '.pair:has(.a) { color: red }\n* { box-sizing: border-box }\n',
    }),
    expect: { G7: 6 },
  },
  {
    id: 'S6b 反例（app.wxss:2 的真实形态）：同样的词**只出现在注释里** ⇒ G7 必须绿（不剥注释就是假红）',
    world: fixtureWorld({
      'pages/plain/plain.wxss': '/* WXSS 不支持 color-mix()、:root、100dvh、backdrop-filter、:has() 与通配选择器 * ——一律别写 */\n.plain { color: red }\n',
    }),
    expect: {},
  },
  { id: 'S6c 反例：这些词出现在字符串正文里（content: "dvh"）也不算代码 ⇒ G7 绿',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.plain::after { content: "dvh" }\n' }), expect: {} },

  { id: 'S7 position:sticky 没带任何偏移（E-06 本体）⇒ G8 红',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.plain { position: sticky; color: red }\n' }), expect: { G8: 1 } },
  { id: 'S7b 反例：sticky + top: 0 ⇒ G8 绿（门不是一刀切禁 sticky）',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.plain { position: sticky; top: 0; color: red }\n' }), expect: {} },
  { id: 'S7c 写了偏移但值是 auto ⇒ 等价于没有上限，G8 红',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.plain { position: sticky; top: auto; color: red }\n' }), expect: { G8: 1 } },
  { id: 'S7d 同选择器的另一块补了偏移（层叠上真会合并）⇒ G8 不判红，但要在统计里点名（留痕不静默）；' +
      'G11 也不判：top 不在关键布局六族里，两块属性不相交',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.plain { position: sticky; color: red }\n.plain { top: 0 }\n' }),
    expect: {}, crossBlock: 1 },
  {
    id: 'S7e 判据不是「全文件出现过 top」：偏移挂在**另一个选择器**上 ⇒ G8 必须红（一刀切式的假绿就在这）',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.plain { position: sticky; color: red }\n.other { top: 0 }\n' }),
    expect: { G8: 1 },
  },

  { id: 'S8 同选择器把 margin 写两遍、值不同（overlay.wxss 的旧形态）⇒ G11 红',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.dup { margin: auto }\n.dup { margin: auto 16px }\n' }), expect: { G11: 1 } },
  { id: 'S8b 值也相同的两遍 ⇒ 仍红（仓内立场：不许把双写成对换成「同值写两遍」的新形态）',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.dup { align-items: center }\n.dup { align-items: center }\n' }), expect: { G11: 1 } },
  { id: 'S8c 反例：同一选择器两块但关键属性不相交（margin 与 display）⇒ G11 绿（门不是「禁止同选择器出现两次」）',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.dup { margin: auto }\n.dup { display: flex }\n' }), expect: {} },
  { id: 'S8d 简写与长边同族也算双写（.d{padding:16px} + .d{padding-bottom:8px}）⇒ G11 红并说明怎么并',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.dup { padding: 16px }\n.dup { padding-bottom: 8px }\n' }), expect: { G11: 1 } },
  { id: 'S8e 选择器组里的一员重复也算（.a, .b {} 后再写 .b {}）⇒ G11 红：按单个选择器归组，不按整条字符串',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.a, .dup { display: flex }\n.dup { display: block }\n' }), expect: { G11: 1 } },
  { id: 'S8f 不同文件里的同名选择器不算（app.wxss 与页样式表是两层，不是一处双写）',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '.card { display: flex }\n' }), expect: {} },

  { id: 'S9 嵌套 at-rule 出现 ⇒ G7/G8/G11 报「无法工作」而不是静默漏判（解析器不吃嵌套）',
    world: fixtureWorld({ 'pages/plain/plain.wxss': '@media (min-width: 375px) {\n  .plain { color: red }\n}\n' }),
    expect: {}, atFatal: true },
]

/** 返回失败描述数组；空数组＝五条门都确实会咬。 */
function selfProof() {
  const bad = []
  for (const c of SELF_CASES) {
    const byId = {}
    const fatalSeen = []
    const statOf = {}
    for (const { id, result } of runRulesOn(c.world)) {
      byId[id] = (result.hits || []).length
      statOf[id] = result.stat || ''
      if (result.fatal) fatalSeen.push(id)
    }
    for (const r of RULES) {
      const want = c.expect[r.id]
      if (want === undefined) {
        if (byId[r.id] !== 0) bad.push(c.id + '：' + r.id + ' 期望不判红（反例），实际命中 ' + byId[r.id] +
          ' ⇒ ' + JSON.stringify((runRulesOn(c.world).find(x => x.id === r.id) || {}).result.hits))
        continue
      }
      if (byId[r.id] !== want) bad.push(c.id + '：' + r.id + ' 期望命中 ' + want + ' 实际 ' + byId[r.id])
    }
    if (c.fatalRule && !fatalSeen.includes(c.fatalRule)) bad.push(c.id + '：期望 ' + c.fatalRule + ' 失败关闭（fatal），实际没有')
    // 「不判红」和「没看见」是两件事：留痕计数必须真的记上了，否则跨块补齐这条路是静默放过的
    if (c.crossBlock !== undefined) {
      const m = String(statOf.G8 || '').match(/另有 (\d+) 处靠同选择器的另一块补齐偏移/)
      if (!m || Number(m[1]) !== c.crossBlock) bad.push(c.id + '：期望 G8 统计里点名跨块补齐 ' + c.crossBlock + ' 处，实际 ' + (m ? m[1] : '没有这一句'))
    }
    if (c.atFatal) {
      const want = ['G7', 'G8', 'G11']
      const miss = want.filter(w => !fatalSeen.includes(w))
      if (miss.length) bad.push(c.id + '：嵌套 at-rule 下 ' + miss.join('/') + ' 没有报「无法工作」（静默漏判）')
    } else if (!c.fatalRule && !c.atFatal && fatalSeen.length) {
      bad.push(c.id + '：反例/正例都未声明 fatal，却有 ' + fatalSeen.join('/') + ' 报 fatal ⇒ 夹具输入不完整')
    }
  }
  return bad
}

module.exports = {
  RULES,
  GATED,
  BLOCKED,
  G3, G6, G7, G8, G11,
  BLACKLIST, LAYOUT_FAMILIES, OFFSET_PROPS, NESTED_AT, EVENT_NAMES: EV.EVENT_NAMES,
  makeCtx, parseRules, sidesOf, lengthReading, reserveNeed, ownReserve, propertiesOf, componentTagSet,
  // 解析底座是 T4 那一份（本批不另起 parser）；这里原样转出，让断言套件打的是**门真正在用的那把尺**，
  // 而不是测试自己另拿一把（夹具同源＝假绿的一种，见 MEMORY「Mock replica is not coverage」）。
  mask, codeText, stripComments, stripWxml, lengthToPx, classAttrValues, classTokens, tokeniseClassValue,
  classifyBare, lineOf, lineText, braceClose, isRootCarrier, isUnconditionalRootCarrier, familyOf,
  nestedAtRules, nestedFatal, classSpecificity,
  fixtureWorld, runRulesOn, selfProof, SELF_CASES, TABBAR_CSS, TAB_RESERVE,
}

// ================= 独立执行：全仓五条门的命中读数 + 夹具自证 =================
// 为什么允许单独跑：check.js 里只遍历 GATED（四条），G11 进门前的读数得有一个人能一把看全的地方；
// 判据本体不复制第二份（铁律 11），跑的就是预提交闸要用的那一份。
// 退出码：0 = 进了闸的四条全绿且自证通过；1 = 有命中/fatal/自证红（G11 的活体只打印，不计红——它没进门禁）。
// 运行：node tools/e08-remaining-rules.js
if (require.main === module) {
  const path2 = require('path')
  const root = path2.resolve(__dirname, '..', 'miniprogram')
  const c = makeCtx(root)
  const bad = selfProof()
  console.log('== E-08 续批五条门 · 独立读数（' + root + '）==')
  console.log('夹具自证：' + SELF_CASES.length + ' 组 ⇒ ' + (bad.length ? 'FAIL ' + bad.length + ' 条' : '全部符合预期'))
  bad.forEach(b => console.log('  ✗ ' + b))
  let red = bad.length > 0 ? 1 : 0
  for (const r of RULES) {
    const gated = GATED.includes(r)
    let res
    try { res = r.run(c) } catch (e) { console.log('  ✗ ' + r.id + ' 抛错：' + e.message); red = 1; continue }
    const tag = gated ? '进闸' : 'BLOCKED（未进闸）'
    console.log((res.fatal ? '  ✗ ' : '  · ') + r.id + ' [' + tag + '] 命中 ' + res.hits.length +
      (res.fatal ? ' ｜ FATAL: ' + res.fatal : ' ｜ ' + (res.stat || '')))
    res.hits.forEach(h => console.log('      ' + h.file + ':' + h.line + ' ｜ ' + (h.snippet || '') + ' ｜ ' + h.why.slice(0, 90) + '…'))
    if (gated && (res.hits.length || res.fatal)) red = 1
  }
  console.log(red ? '\n读数：有红（' + (bad.length ? '自证失败 ' + bad.length + ' 条' : '进闸的门报了命中/无法工作') + '）' : '\n读数：进闸的四条命中 0，自证通过；G11 的活体见上面那行')
  process.exit(red)
}
