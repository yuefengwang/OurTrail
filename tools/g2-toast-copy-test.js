// toast 文案预算门：node tools/g2-toast-copy-test.js
//
// 钉的是审计 M-11（合并 C-21 + D-12）那一族「话术写到一半被硬切断」的**复发**。
// 缺陷本体在 miniprogram/utils/api.js 的 `toast()`：它把任意长度的文案 `slice(0, N)` 之后
// 交给 wx.showToast，长出来的那半句**静默消失**。写文案的人在页面里看到的是完整一句，
// 用户看到的是断句——基线上真的发生了一处（地图选点的隐私话术被截成「…暂无法地」，
// 恰好丢掉「图选点」这个说明「什么功能不可用」的关键词）。
//
// 三条口径（都是被别的门的翻车教训逼出来的，不是自创）：
// 1. **预算是量出来的，不是抄来的**（铁律 30：门钉行为不钉源码文本）。
//    本门不写 `20` 这个数字，而是真调 `api.toast()` 看 `wx.showToast` 到底收到多长的串。
//    于是 api.js 哪天把上限改成 24、或改成「超长文案降级成 showModal」，本门自动跟着改判，
//    不会变成一条替旧实现背书、又拦不住新写法的死门。
// 2. **只算第一个实参，且按分支算**。`api.toast(msg, 'none')` 的第二参是 icon 名不是文案；
//    `cond ? 'A' : 'B'` 的 A/B 各是一条候选（条件段里的 `'cap'` 不是文案）；
//    `'前缀' + X + '后缀'` 的字面量之和是这句话的**长度下限**（变量只会加长），
//    所以「下限已超预算」一定是真截断——宁可少判也不误伤。
// 3. **存量已登记，只许变少**（复用 tools/check.js 的 KNOWN_BARE_CHECKBOX 机制）。
//    基线上那条真截断发生在 pages/weather-hub，不在本轮 G2 的写入范围（pages/** 全禁）。
//    登记在这里而不是把判据放宽到 23 字——放宽等于宣布「再长一点也不算问题」，那正是缺陷的成因。
//    登记项若已不再违规，本门同样报出来，防止清单烂成第二本账。
'use strict'
const fs = require('fs')
const path = require('path')

const API_PATH = require.resolve('../miniprogram/utils/api')
const CONFIG_PATH = require.resolve('../miniprogram/config')
const MP = path.resolve(__dirname, '..', 'miniprogram')

let passed = 0, failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function note(t) { console.log('  · ' + t) }
const cp = s => Array.from(String(s)).length // 按码点计数：slice(0, N) 切的是码点，全角字一个算一个

/* ---------- 已知未修（只许变少）---------- */
// file 相对 miniprogram/；text 是那一条**候选文案**（三元的一支、或拼接式的字面量下限）。
const KNOWN_OVERBUDGET = [
  {
    file: 'pages/weather-hub/weather-hub.js',
    text: '平台隐私指引未声明「位置信息」，暂无法地图选点',
    finding: 'M-11 / C-21',
    note: '修法二选一（都不归 G2 写入范围）：文案缩进预算内，或 api.js 把超长文案降级成 showModal。归 weather-hub 页 owner。',
  },
]

/* ---------- 1. 从真函数把预算量出来 ---------- */
section('1. 预算来自真 api.toast 的出口，不是本门抄的一个数')
let BUDGET = 0
{
  let captured = null
  global.wx = {
    cloud: { init() {}, callFunction: () => ({ then: () => Promise.resolve({ result: { ok: true, data: {} } }) }) },
    showToast(o) { captured = o },
  }
  delete require.cache[API_PATH]
  delete require.cache[CONFIG_PATH]
  const api = require(API_PATH)

  api.toast('一'.repeat(400))
  BUDGET = captured ? cp(captured.title) : 0
  check('预算量得出来（>0）——量不出来这条门就是空转', BUDGET > 0, 'BUDGET=' + BUDGET)
  note('实测上屏预算 = ' + BUDGET + ' 码点（api.toast 交给 wx.showToast 的 title 长度）')

  // 预算两侧都要有读数，否则「按预算判」这句话没有内容（阳性对照）。
  api.toast('一'.repeat(BUDGET))
  check('恰好等于预算的文案一字不丢（临界值不得被误判成「没截」）',
    !!captured && cp(captured.title) === BUDGET && /^一+$/.test(captured.title), JSON.stringify(captured))
  api.toast('一'.repeat(BUDGET + 3))
  check('超出预算的文案确实被截走（证明这道截断真实存在，本门不是在防一个假想敌）',
    !!captured && cp(captured.title) === BUDGET, captured && cp(captured.title))
  api.toast('')
  check('空文案有兜底（不会弹出一条空白 toast）', !!captured && captured.title === '完成', JSON.stringify(captured))
  api.toast('一句很短的话', 'none')
  check('第二个实参是 icon 名，不得被当成文案计入',
    !!captured && captured.icon === 'none' && captured.title === '一句很短的话', JSON.stringify(captured))
}

/* ---------- 2. 调用点解析 ---------- */
function lineOf(src, idx) { return src.slice(0, idx).split(/\r?\n/).length }

/** 取 `toast(` 之后的第一个实参原文（按引号与括号深度，遇到顶层逗号即止）。 */
function firstArgSpan(src, openIdx) {
  let depth = 1, i = openIdx + 1, quote = ''
  while (i < src.length) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i += 2; continue }
      if (c === quote) quote = ''
      i++; continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue }
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); i++; continue }
    if (c === ',' && depth === 1) return src.slice(openIdx + 1, i)
    i++
  }
  return src.slice(openIdx + 1)
}

/** 按「顶层」分隔符切开：引号内与括号内的不算顶层。 */
function topLevelSplit(text, seps) {
  const parts = []
  let buf = '', depth = 0, quote = '', i = 0
  while (i < text.length) {
    const c = text[i]
    if (quote) {
      buf += c
      if (c === '\\') { buf += text[i + 1] || ''; i += 2; continue }
      if (c === quote) quote = ''
      i++; continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; buf += c; i++; continue }
    if (c === '(' || c === '[' || c === '{') { depth++; buf += c; i++; continue }
    if (c === ')' || c === ']' || c === '}') { depth--; buf += c; i++; continue }
    if (depth === 0) {
      const hit = seps.find(s => text.startsWith(s, i))
      if (hit) { parts.push(buf); buf = ''; i += hit.length; continue }
    }
    buf += c; i++
  }
  parts.push(buf)
  return parts
}

/** 一段表达式里扫出字面量 / 模板串 / 标识符（引号里的是文案，标识符代表长度看不见）。 */
function termsOf(exprText) {
  const out = []
  let rest = exprText
  while (rest.length) {
    const head = rest.match(/^(['"`])/)
    if (head) {
      const q = head[1]
      let j = 1, body = ''
      while (j < rest.length) {
        if (rest[j] === '\\') { body += rest[j] + (rest[j + 1] || ''); j += 2; continue }
        if (rest[j] === q) break
        body += rest[j]; j++
      }
      out.push(q === '`' ? { kind: 'template', text: body } : { kind: 'literal', text: body.replace(/\\(['"\\])/g, '$1') })
      rest = rest.slice(j + 1)
      continue
    }
    const ident = rest.match(/^[A-Za-z_$][\w$.]*/)
    if (ident) { out.push({ kind: 'opaque', text: ident[0] }); rest = rest.slice(ident[0].length); continue }
    rest = rest.slice(1)
  }
  return out
}

/**
 * 一个 toast 调用点 → 若干候选文案（每条给出字面量长度下限，以及是否还混着看不见的部分）。
 *  · `cond ? 'A' : 'B'` —— 条件段不是文案，丢掉；A/B 各算一条候选。
 *  · `'前缀' + X + '后缀'` —— 字面量之和是这句话的长度**下限**。
 *  · `api.toast(msg)` —— 一个面量都没有 ⇒ 长度静态不可知，单列出来，不冒充已核。
 */
function candidatesOf(exprText) {
  const branches = []
  const ternary = topLevelSplit(exprText, ['?', '||', '??'])
  if (ternary.length > 1) {
    for (const raw of ternary.slice(1)) topLevelSplit(raw, [':']).forEach(p => branches.push(p))
  } else {
    branches.push(exprText)
  }
  const out = []
  for (const b of branches) {
    const t = b.trim()
    if (!t) continue
    let len = 0, text = '', hasLit = false, hasOpaque = false
    for (const s of termsOf(t)) {
      if (s.kind === 'literal') { hasLit = true; len += cp(s.text); text += s.text; continue }
      if (s.kind === 'template') {
        hasLit = true; text += s.text
        len += cp(s.text.replace(/\$\s*\{[^{}]*\}/g, ''))
        if (/\$\s*\{/.test(s.text)) hasOpaque = true
        continue
      }
      if (/^[-\d.]+$/.test(s.text)) continue // 数字项加不了几个字，也不是句子
      hasOpaque = true
    }
    if (!hasLit) { out.push({ text: t, len: 0, pureVariable: true }); continue }
    out.push({ text, len, mixed: hasOpaque })
  }
  return out
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/* ---------- 3. 全仓扫描 ---------- */
section('3. 全仓 toast 文案：写出预算之外的句子必须当场报')
const violations = []
const blind = []
let callSites = 0, candCount = 0
{
  for (const f of walk(MP, []).filter(x => x.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8')
    const relFile = path.relative(MP, f).split(path.sep).join('/')
    for (const m of src.matchAll(/\btoast\s*\(/g)) {
      // `wx.showToast(` 里 T 是大写，\btoast 匹配不到它；要排掉的只有定义本身（`function toast(title, icon)`）。
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue
      callSites++
      const line = lineOf(src, m.index)
      const arg = firstArgSpan(src, m.index + m[0].length - 1)
      for (const c of candidatesOf(arg)) {
        if (c.pureVariable) { blind.push(relFile + ':' + line + ' → ' + c.text.slice(0, 40)); continue }
        candCount++
        if (c.len > BUDGET) violations.push({ file: relFile, line, text: c.text, len: c.len })
      }
    }
  }
}
check('扫描器没有空转（调用点与候选文案都取到数）',
  callSites >= 20 && candCount >= 20, JSON.stringify({ callSites, candCount, blind: blind.length }))
note(`调用点 ${callSites} 处 · 静态可读出的候选文案 ${candCount} 条 · 纯变量传出 ${blind.length} 处（长度看不见，逐条列出，不冒充已核）`)
blind.forEach(b => console.log('    · 看不见长度：' + b))

const key = v => v.file + '#' + v.text
const knownKeys = new Set(KNOWN_OVERBUDGET.map(x => x.file + '#' + x.text))
const fresh = violations.filter(v => !knownKeys.has(key(v)))
const stale = KNOWN_OVERBUDGET.filter(x => !violations.some(v => key(v) === x.file + '#' + x.text))
violations.forEach(v => console.log('    · 超预算（' + v.len + ' 码点 > ' + BUDGET + '）' + v.file + ':' + v.line + '「' + v.text + '」'))
fresh.forEach(v => console.error('    ✗ 新增超长：' + v.file + ':' + v.line + '（' + v.len + ' > 预算 ' + BUDGET + '）「' + v.text + '」'))
stale.forEach(x => console.log('    · 登记项已不再违规，请从 KNOWN_OVERBUDGET 删除：' + x.file + '（' + x.finding + '）'))
check('预算之外的新文案为 0（存量只许变少，不许变多）', fresh.length === 0, '新增 ' + fresh.length + ' 条')

/* ---------- 4. 登记项必须能被清理 + 解析器自身的牙 ---------- */
section('4. 登记项点名 + 解析判据（三元 / 拼接 / 条件段 / 纯变量）')
for (const x of KNOWN_OVERBUDGET) {
  const hit = violations.some(v => key(v) === x.file + '#' + x.text)
  if (!hit) note('登记项已不再违规，请从 KNOWN_OVERBUDGET 删除：' + x.file + '「' + x.text.slice(0, 12) + '」（' + x.finding + '）')
}
check('清单里每一条都在账上（要么仍违规、要么被点名要求删除——不允许出现第三条状态「悄悄消失」）',
  KNOWN_OVERBUDGET.every(x => violations.some(v => key(v) === x.file + '#' + x.text)
    || stale.some(s => s.file === x.file && s.text === x.text)),
  JSON.stringify(KNOWN_OVERBUDGET.map(x => x.file)))
check('超预算的文案都带可行动信息（登记项不能是废话，删它之前要给人出路）',
  KNOWN_OVERBUDGET.every(x => /地图选点|手动输入|重试|补存/.test(x.text)),
  JSON.stringify(KNOWN_OVERBUDGET.map(x => x.finding)))
check('拼接出的长句按长度下限计入（「拆成两段各 12 字再拼一个变量」绕不过这条门）',
  candidatesOf("'aaaaaaaaaaaa' + msg + 'aaaaaaaaaaaa'").some(c => c.len === 24 && c.mixed === true),
  JSON.stringify(candidatesOf("'aaaaaaaaaaaa' + msg + 'aaaaaaaaaaaa'")))
check('三元两支各算一条候选（不是把两支加在一起冒充一句）',
  candidatesOf("ok ? '一二三四五' : '六七八'").map(c => c.len).join() === '5,3',
  JSON.stringify(candidatesOf("ok ? '一二三四五' : '六七八'")))
check('条件段里的字符串不算文案（`x === \'cap\' ? …` 那种比较串不得进候选）',
  !candidatesOf("r.reason === 'cap' ? '坐标无效，无法保存' : '已存入观察点'").some(c => c.text === 'cap'),
  JSON.stringify(candidatesOf("r.reason === 'cap' ? '坐标无效，无法保存' : '已存入观察点'")))
check('纯变量传出的调用点被单独列出来（门不冒充「全部文案都核过」）',
  candidatesOf('successMsg').length === 1 && candidatesOf('successMsg')[0].pureVariable === true,
  JSON.stringify(candidatesOf('successMsg')))

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
