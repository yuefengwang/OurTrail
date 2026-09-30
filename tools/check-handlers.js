// WXML ↔ JS handler 交叉校验：检查页面 WXML 绑定的事件处理函数在对应 JS 里都存在。
// 用法：node tools/check-handlers.js [页面目录名]，缺省检查全部页面。
'use strict'
const fs = require('fs')
const path = require('path')

const baseDir = path.join(__dirname, '..', 'miniprogram')
const targets = [path.join(baseDir, 'pages'), path.join(baseDir, 'components')]
const only = process.argv[2]
let bad = 0

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
    if (missing.length) {
      bad++
      console.log('✗ ' + kind + dir + ': JS 中不存在 → ' + missing.join(', '))
    } else {
      console.log('✓ ' + kind + dir + ' (' + handlers.size + ' handlers)')
    }
  }
}
process.exit(bad ? 1 : 0)
