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

// 3. WXSS 花括号配平 + 变量定义 + 行注释
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
  // WXSS 是 CSS 系语法，不认 // 行注释（事故：lab.wxss 用 JS 风格注释，真机编译报
  // "unexpected"。花括号配平抓不住纯注释文件）。剥掉块注释后再找 //——块注释里提到
  // "//" 属合法说明文字；排除 "://"（url 协议写法）。
  const noBlock = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
  noBlock.split('\n').forEach((line, i) => {
    const t = line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''")
    if (/(^|[^:])\/\//.test(t)) fail(rel(f) + ':' + (i + 1) + ' WXSS 不支持 // 行注释（请用 /* */）')
  })
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

// 5b. 反向校验：wxml 用到的自定义组件必须已在同名 json 注册。上一项是「注册了但文件不存在」，
// 抓不到「用了但没注册」。判据不能只看连字符——本项目 icon/overlay 无连字符，scroll-view/
// checkbox-group 等内置标签反而有；以实际组件清单为白名单才两头都对。
// 两起事故：app.wxml 残留 <privacy-popup />（app.json 已无 usingComponents 键）；editor.json 漏注册 overlay（924d2b4）。
console.log('== 组件注册（反向） ==')
const COMPONENT_NAMES = new Set()
for (const f of files.filter(f => f.endsWith('.json'))) {
  // 路径分隔符必须先归一化：Windows 下 path.join 产出的是反斜杠，而正则写的是正斜杠，
  // 匹配恒为 0 → 清单为空 → 所有标签都被当成内置标签放行 → 本步骤整个静默空转。
  // 而按双机协议，Windows 正是唯一装有微信开发者工具的机器，也就是唯一能真机验证的机器——
  // 恰好是这个 bug 最不能存在的地方。判据同时兼容两种分隔符。
  const norm = f.split(path.sep).join('/')
  const m = norm.match(/components\/([a-z0-9-]+)\/[a-z0-9-]+\.json$/)
  if (m) COMPONENT_NAMES.add(m[1])
}
if (COMPONENT_NAMES.size === 0) fail('组件清单为空：反向检查无法工作（路径分隔符或目录结构异常）')
const reported = new Set()
for (const f of files.filter(f => f.endsWith('.wxml'))) {
  const jsonPath = f.replace(/\.wxml$/, '.json')
  let json = {}
  if (fs.existsSync(jsonPath)) {
    try { json = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) } catch (e) { /* 解析失败第 5 项已报 */ }
  }
  const registered = new Set(Object.keys(json.usingComponents || {}))
  const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '') // 去注释，防示例标签误报
  for (const m of src.matchAll(/<([a-z][a-z0-9-]*)/g)) {
    const name = m[1]
    const key = f + ' ' + name
    if (COMPONENT_NAMES.has(name) && !registered.has(name) && !reported.has(key)) {
      reported.add(key)
      fail(rel(f) + ' 用了 <' + name + '>，但 ' + path.basename(jsonPath) + ' 未在 usingComponents 注册')
    }
  }
}
ok('组件注册反向检查完成（清单 ' + COMPONENT_NAMES.size + ' 个组件）')

// 6. app.json 中的页面不得再引用已删除目录
console.log('== 旧页清理 ==')
for (const dead of ['pages/index/', 'pages/create/', 'pages/manage/']) {
  if (fs.existsSync(path.join(ROOT, dead))) fail('旧目录仍存在: ' + dead)
}
ok('旧页已删除')

// 7. 相对 require 可解析：require 可以藏在函数体内（惰性加载），node --check 只验语法不解析路径，
//    既有测试又可能从不走进那个分支——allocation.js 的 '../invariants' 就这样带病上线
//    （真机预览分车必炸 Cannot find module）。这里按磁盘解析全部相对 require 兜底。
console.log('== require 可解析 ==')
{
  const repoRoot = path.resolve(__dirname, '..')
  const show = f => path.relative(repoRoot, f).split(path.sep).join('/')
  const bases = [ROOT, path.join(repoRoot, 'cloudfunctions', 'trailApi'), path.join(repoRoot, 'cloudfunctions', 'trailApiLab')]
  let checked = 0
  for (const base of bases) {
    if (!fs.existsSync(base)) continue
    for (const f of walk(base, []).filter(f => f.endsWith('.js'))) {
      const src = fs.readFileSync(f, 'utf8')
      for (const m of src.matchAll(/require\((['"])(\.[^'"]+)\1\)/g)) {
        checked++
        const target = path.resolve(path.dirname(f), m[2])
        if (!fs.existsSync(target) && !fs.existsSync(target + '.js') && !fs.existsSync(path.join(target, 'index.js'))) {
          fail(show(f) + ' require(' + m[2] + ') 解析不到文件')
        }
      }
    }
  }
  ok('相对 require 全部可解析（' + checked + ' 处，如有 ✗ 见上）')
}

// 6. 裸 checkbox 上绑 bindchange —— 微信只定义了 checkbox-group 的 change 语义，
// 直接绑在 <checkbox> 上的 handler 在真机永不触发（2026-10-04 真机实测：tap 后 data 不翻转）。
// 已知未修的登记在下面，只允许变少不允许变多：修掉一处就从清单里删掉，删空后此规则即为硬门禁。
// Phase 4（2026-10-05）已把存量 7 处全部改为 checkbox-group 载体，清单清零——此后新增即 FAIL。
console.log('== 勾选框事件载体 ==')
const KNOWN_BARE_CHECKBOX = new Set([])
{
  const bare = []
  for (const f of files.filter(f => f.endsWith('.wxml'))) {
    const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    const lines = src.split(/\r?\n/)
    lines.forEach((l, i) => {
      if (!/<checkbox(?!-group)[^>]*bindchange/.test(l)) return
      const before = lines.slice(0, i).join('\n')
      const opens = (before.match(/<checkbox-group[\s>]/g) || []).length
      const closes = (before.match(/<\/checkbox-group>/g) || []).length
      if (opens > closes) return
      bare.push(rel(f) + ':' + (i + 1))
    })
  }
  const fresh = bare.filter(x => !KNOWN_BARE_CHECKBOX.has(x))
  const fixed = [...KNOWN_BARE_CHECKBOX].filter(x => bare.indexOf(x) === -1)
  bare.forEach(x => console.log('  · 已知未修（勾选框永不生效）：' + x))
  if (fresh.length) fresh.forEach(x => fail(x + ' 新增：bindchange 绑在裸 <checkbox> 上，真机永不触发——请改成一个 <checkbox-group data-… bindchange>（每行一个）或包进 group'))
  if (fixed.length) console.log('  · 已修复但仍在清单里（请从 KNOWN_BARE_CHECKBOX 删除）：' + fixed.join(', '))
  if (!bare.length) ok('不再有裸 checkbox 绑 change')
  else if (!fresh.length) ok('裸 checkbox 绑 change 未增加（存量 ' + bare.length + ' 处已登记）')
}

// 8. WXML 非法事件属性名（M-09 的防复发门）：形如 xxx-yyy="标识符" 却少了 bind/catch 前缀的属性，
//    在小程序里只是一个普通自定义属性，永不触发回调——overlay 的 animation-end="noop" 就是这么让
//    onAnimationEnd 活成死方法、rendered 永不复位的。判据实现搬进 tools/fixround2-event-attr-rule.js
//    （那文件自带「历史样本必须抓到 + 合法写法不得误报」的自证，可单独 node 执行），
//    这样预提交门不需要被本地跑一遍也能确认规则本身是活的。
//    落门前实测全仓命中 0 条（见 fix-round2/out/G1/verify.txt），所以是硬门禁、不带登记清单。
console.log('== WXML 非法事件属性名 ==')
{
  const rule = require('./fixround2-event-attr-rule')
  let scanned = 0
  const hits = []
  for (const f of files.filter(f => f.endsWith('.wxml'))) {
    let srcTxt
    try { srcTxt = fs.readFileSync(f, 'utf8') } catch (e) { fail(rel(f) + ' 读取失败：' + e.message); continue }
    scanned++
    rule.scan(srcTxt, rel(f)).forEach(h => hits.push(h))
  }
  if (scanned === 0) fail('一个 wxml 都没扫到：本步骤会静默空转（同 5b 的分隔符教训）')
  hits.forEach(h => fail(h.file + ':' + h.line + ' ' + h.attr + '="' + h.value + '" 不是合法事件属性（' + h.why + '）——事件绑定必须写 bind…/catch… 或 bind:事件名，否则永不触发'))
  if (!hits.length) ok('没有「少了 bind/catch 前缀的事件属性」（扫了 ' + scanned + ' 个 wxml）')
}

// ==== T4/E-08 新门开始（以下整段为本批追加；既有 5+3 步一字未改。剥离这段做「盲区复现」的是 tools/t4-e08-mutate.js）====
// E-08 的指控不是「缺一个 lint」，而是：改完 UI 大家跑的是 check.js 与 check-handlers.js，
// 而 platform-pitfalls.md 的 14 条平台硬规则**一条都不在这两把闸里**（AGENTS.md:L110 自己承认
// multipleSlots 要靠「check-handlers.js 之外的手段」人工复核）。判据装在没人跑的门里等于没有门。
// 四条规则落门之前各自实测**全仓命中 0**（清单与读数见 fix-round2/out/T4/handoff.md），
// 所以这里是硬门禁、不带 KNOWN_* 登记清单；判据本体在 tools/t4-e08-platform-rules.js（唯一出处，
// 断言套件与变异自证共用同一份，不在测试里镜像判据 —— 铁律 11）。
console.log('== 新门自证（合成夹具：正例必红、反例必绿）==')
{
  const T4 = require('./t4-e08-platform-rules')
  // 判据模块被摘空（导出空数组）时，下面的循环会一次都不跑 ⇒ 整段静默绿。这条门防的是「闸还在、闸门后面没人了」。
  if (!T4.RULES || T4.RULES.length !== 4) fail('平台门判据模块只导出 ' + ((T4.RULES || []).length) + ' 条规则（应为 4 条）⇒ 本步会静默空转')
  if (!T4.SELF_CASES || !T4.SELF_CASES.length) fail('平台门自证夹具为空 ⇒ 「正例必红」从未被检验')
  const bad = T4.selfProof()
  bad.forEach(b => fail('规则自证失败：' + b))
  if (!bad.length) ok(T4.SELF_CASES.length + ' 组夹具全部符合预期 ⇒ 下面四条门不是读不出东西的空门')
  const ctx = T4.makeCtx(ROOT)
  for (const r of T4.RULES) {
    console.log('== ' + r.id + ' ' + r.title + ' ==')
    let res
    try {
      res = r.run(ctx)
    } catch (e) {
      fail(r.id + ' 判据抛错（抛错≠通过，本步按红算）：' + e.message)
      continue
    }
    if (res.fatal) fail(r.id + ' 没有输入，判据无法工作：' + res.fatal)
    res.hits.forEach(h => fail('[' + r.id + '] ' + h.file + ':' + h.line + ' ' + h.why + (h.snippet ? ' ｜ ' + h.snippet : '')))
    if (!res.hits.length && !res.fatal) ok(r.id + ' 命中 0 ｜ ' + (res.stat || '（无统计）'))
  }
}
// ==== T4/E-08 新门结束 ====

console.log('')
if (failed) {
  console.error('FAILED: ' + failed + ' 项问题')
  process.exit(1)
} else {
  console.log('ALL CHECKS PASSED')
}
