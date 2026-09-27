// 静态校验：JS 语法（node --check 由外层跑）、WXML 标签配平、WXSS 花括号配平、
// app.json 页面文件齐全、组件引用存在。运行：node check.js
'use strict'
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', 'miniprogram')
let failed = 0
const fail = msg => { failed++; console.error('  ✗ ' + msg) }
const ok = msg => console.log('  ✓ ' + msg)

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const stat = fs.statSync(p)
    if (stat.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(ROOT, [])
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/')

// 1. JS 语法
console.log('== JS 语法 ==')
for (const f of files.filter(f => f.endsWith('.js'))) {
  try {
    execSync('node --check "' + f + '"', { stdio: 'pipe' })
  } catch (e) {
    fail(rel(f) + ' — ' + e.stderr.toString().split('\n')[0])
    continue
  }
}
ok('node --check 全部通过（如有 ✗ 见上）')

// 2. WXML 标签配平（自闭合与 void 标签处理）
console.log('== WXML 标签配平 ==')
const VOID_TAGS = new Set(['input', 'image', 'checkbox', 'radio', 'switch', 'slider', 'progress', 'icon', 'import', 'include', 'wxs'])
const SELF_CLOSABLE = new Set(['input', 'image', 'checkbox', 'radio', 'switch', 'import', 'include'])
for (const f of files.filter(f => f.endsWith('.wxml'))) {
  const src = fs.readFileSync(f, 'utf8')
  const stack = []
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let m
  let valid = true
  while ((m = re.exec(src)) !== null) {
    const tag = m[1]
    const attrs = m[2] || ''
    const closing = m[0].startsWith('</')
    const selfClosed = /\/\s*>$/.test(m[0])
    if (closing) {
      const top = stack.pop()
      if (top !== tag) {
        // 容忍 wx:if/wx:elif 相邻注释差异等，先记录
        fail(rel(f) + ' 标签不配平：期望 </' + top + '>，遇到 </' + tag + '>')
        valid = false
        break
      }
    } else if (!selfClosed && !VOID_TAGS.has(tag) && !SELF_CLOSABLE.has(tag)) {
      stack.push(tag)
    }
  }
  if (!valid) continue
  if (stack.length) {
    fail(rel(f) + ' 有未闭合标签：' + stack.join(', '))
  }
}
ok('WXML 配平检查完成（如有 ✗ 见上）')

// 3. WXSS 花括号配平 + 变量定义
console.log('== WXSS ==')
for (const f of files.filter(f => f.endsWith('.wxss'))) {
  const src = fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  let depth = 0
  for (const ch of src) {
    if (ch === '{') depth++
    else if (ch === '}') depth--
    if (depth < 0) break
  }
  if (depth !== 0) fail(rel(f) + ' 花括号不配平（深度 ' + depth + '）')
}
ok('WXSS 检查完成')

// 4. app.json 页面与组件
console.log('== app.json ==')
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
for (const page of appJson.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(ROOT, page + ext))) fail('缺少页面文件 ' + page + ext)
  }
}
ok('pages 文件齐全（' + appJson.pages.length + ' 页）')

// tabBar 页面检查
if (appJson.tabBar && appJson.tabBar.custom) {
  ok('自定义 tabBar：' + appJson.tabBar.list.map(t => t.pagePath).join(', '))
}

// 5. 各 json 的 usingComponents 存在性
console.log('== 组件引用 ==')
for (const f of files.filter(f => f.endsWith('.json'))) {
  let json
  try { json = JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { fail(rel(f) + ' JSON 解析失败'); continue }
  const uc = json.usingComponents || {}
  for (const [name, comp] of Object.entries(uc)) {
    const base = comp.startsWith('/') ? path.join(ROOT, comp.slice(1)) : path.resolve(path.dirname(f), comp)
    if (!fs.existsSync(base + '.json')) fail(rel(f) + ' 引用的组件不存在: ' + name + ' → ' + comp)
  }
}
ok('组件引用检查完成')

// 6. app.json 中的页面不得再引用已删除目录
console.log('== 旧页清理 ==')
for (const dead of ['pages/index/', 'pages/create/', 'pages/manage/']) {
  if (fs.existsSync(path.join(ROOT, dead))) fail('旧目录仍存在: ' + dead)
}
ok('旧页已删除')

console.log('')
if (failed) {
  console.error('FAILED: ' + failed + ' 项问题')
  process.exit(1)
} else {
  console.log('ALL CHECKS PASSED')
}
