// WXML ↔ JS handler 交叉校验：
//   ① 页面/组件 WXML 绑定的事件处理函数在对应 JS 里都存在；
//   ② 处理函数读 e.currentTarget.dataset.X 时，绑定它的那个标签必须真的写了 data-X。
// ②是必须的：checkbox-group 的 change 事件里 currentTarget 是 group 本身，data-key 若挂在内层
// label 上，handler 读到的是 undefined——真机上勾选既不新增也不移除，而桩里手搓的事件对象会替
// 产品补上这个字段，node 侧测试全绿。signup 勾选同行人就是这么漏网的（2026-10-04 真机定案）。
// 用法：node tools/check-handlers.js [页面目录名]，缺省检查全部页面。
'use strict'
const fs = require('fs')
const path = require('path')

const baseDir = path.join(__dirname, '..', 'miniprogram')
const targets = [path.join(baseDir, 'pages'), path.join(baseDir, 'components')]
const only = process.argv[2]
let bad = 0

// 取函数体：从签名后的第一个 { 起做括号配平（本仓库 handler 一律是方法简写或 function 形式）
function bodyOf(js, name) {
  const sig = new RegExp('\\b' + name + '\\s*(?:\\(\\s*[a-zA-Z_$][\\w$]*\\s*\\)|:\\s*(?:async\\s+)?function\\s*\\(\\s*[a-zA-Z_$][\\w$]*\\s*\\))\\s*\\{')
  const m = sig.exec(js)
  if (!m) return ''
  let i = m.index + m[0].length, depth = 1, quote = ''
  while (i < js.length && depth > 0) {
    const c = js[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; i++; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  return js.slice(m.index + m[0].length, i - 1)
}

// handler 从 currentTarget 上读的 dataset 键（解构与逐字段两种写法都算；方括号动态取值跳过）
function readsDatasetKeys(body) {
  if (!body) return null
  if (/currentTarget\.dataset\s*\[/.test(body)) return null
  const keys = new Set()
  for (const m of body.matchAll(/\.currentTarget\.dataset\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1])
  for (const m of body.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*[A-Za-z_$][\w$.]*\.currentTarget\.dataset/g)) {
    for (const part of m[1].split(',')) {
      const k = part.split(':')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.add(k)
    }
  }
  return keys
}

const attrName = key => 'data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())

// 去掉注释后拆开标签：返回 [{ tag, attrs }]
function openingTags(wxml) {
  const stripped = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const out = []
  for (const m of stripped.matchAll(/<([a-zA-Z][\w-]*)\s([^>]*?)\/?>/g)) out.push({ tag: m[1], attrs: m[2] })
  return out
}

for (const pagesDir of targets) {
  for (const dir of fs.readdirSync(pagesDir)) {
    if (only && dir !== only) continue
    const wxmlPath = path.join(pagesDir, dir, dir + '.wxml')
    const jsPath = path.join(pagesDir, dir, dir + '.js')
    if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) continue
    const wxml = fs.readFileSync(wxmlPath, 'utf8')
    let js = fs.readFileSync(jsPath, 'utf8')
    // 跟进页面 require 的本地模块（如 utils/notices-page），handler 可能定义在共享工厂里
    for (const m of js.matchAll(/require\('((?:\.\.\/)+[^']+)'\)/g)) {
      let p = path.resolve(path.dirname(jsPath), m[1])
      if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js'
      if (fs.existsSync(p)) js += fs.readFileSync(p, 'utf8')
    }
    const handlers = new Set()
    // 三类绑定都审计：①直连 bindtap="fn"；②组件事件 bind:close="fn"（冒号前缀原先漏检）；
    // ③表达式绑定 bindtap="{{busy ? '' : 'fn'}}"——提取其中的标识符字面量（原先整类漏检）
    for (const m of wxml.matchAll(/(?:bind|catch)[a-z]*(?::[a-z-]+)?="([^"]*)"/g)) {
      const v = m[1]
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) { handlers.add(v); continue }
      for (const s of v.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
        if (s[1]) handlers.add(s[1])
      }
    }
    const missing = [...handlers].filter(h => {
      const re = new RegExp('\\b' + h + '\\s*[:(]', 'm')
      return !re.test(js)
    })
    const kind = pagesDir.endsWith('components') ? '组件 ' : ''

    // —— ② dataset 契约（只对 checkbox-group / radio-group 的 change 绑定生效）——
    // 作用域刻意收窄：这两类控件的 change 事件 currentTarget 恒为 group 本身，data-* 挂到内层
    // label/checkbox 上就等于没挂。已复核的另外两处 dataset 读取（workspace onTransition 的
    // dataset.next、transport-panel openAssign 的 seat/occupant）都带 `|| 兜底`，属有意设计，不在此列。
    const datasetGaps = []
    for (const t of openingTags(wxml)) {
      if (t.tag !== 'checkbox-group' && t.tag !== 'radio-group') continue
      const bound = []
      for (const m of t.attrs.matchAll(/bindchange="([^"]*)"/g)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(m[1])) bound.push(m[1])
      }
      if (!bound.length) continue
      const present = new Set(t.attrs.match(/\bdata-[a-z0-9-]+/g) || [])
      for (const h of bound) {
        const keys = readsDatasetKeys(bodyOf(js, h))
        if (!keys) continue
        for (const k of keys) {
          const want = attrName(k)
          if (present.has(want)) continue
          datasetGaps.push('<' + t.tag + ' bindchange=' + h + '> 读 dataset.' + k + ' 但该 group 上没有 ' + want + '（内层 label 上的 data-* 不会进 currentTarget）')
        }
      }
    }

    if (missing.length || datasetGaps.length) {
      bad++
      if (missing.length) console.log('✗ ' + kind + dir + ': JS 中不存在 → ' + missing.join(', '))
      if (datasetGaps.length) console.log('✗ ' + kind + dir + ': dataset 契约断裂 → ' + datasetGaps.join(' ; '))
    } else {
      console.log('✓ ' + kind + dir + ' (' + handlers.size + ' handlers, dataset 契约相符)')
    }
  }
}
process.exit(bad ? 1 : 0)
