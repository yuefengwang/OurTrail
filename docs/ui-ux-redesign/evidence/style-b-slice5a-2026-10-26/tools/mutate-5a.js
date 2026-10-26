'use strict'
/* 5a 新门的牙齿自证：把收敛逐项退回去，门必须变红，且红的必须是**那一条**断言。
   做法是在工作树原地改、跑套件、按 sha256 还原（改前/改后哈希必须逐字节相等）。
   锚点一律取**单行**（本仓 wxml/wxss 是 CRLF，跨行正则会命中 0 次 = 假注入，见铁律 31⑥）。 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '../../../../..')
const F = {
  me: 'miniprogram/pages/me/me.wxml',
  meCss: 'miniprogram/pages/me/me.wxss',
  meJson: 'miniprogram/pages/me/me.json',
  editor: 'miniprogram/pages/editor/editor.wxml',
}
const sha = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const write = (rel, s) => fs.writeFileSync(path.join(ROOT, rel), s, 'utf8')

function once(src, needle) {
  const n = src.split(needle).length - 1
  return n === 1
}

const MUTANTS = [
  {
    name: 'M1 常用同行人退回私有 <view class="list-row">（不认共享组件）',
    file: F.me,
    from: '<person-row',
    to: '<view class="list-row"',
    expect: '常用同行人改用共享 <person-row>，编辑与移除仍在它的插槽内',
  },
  {
    name: 'M2 个人页重新定义第二套人行头像尺寸（36px）',
    file: F.meCss,
    from: '.avatar-img { width: 64px;',
    to: '.avatar-img.sm { width: 36px; height: 36px; }\n.avatar-img { width: 64px;',
    expect: '个人页不再自定义第二套人行头像尺寸（36px 的 .sm 变体与 15px 无源字阶已删）',
  },
  {
    name: 'M2b 个人页重新写一个无源字阶 15px',
    file: F.meCss,
    from: '.avatar-img { width: 64px;',
    to: '.nick-probe { font-size: 15px; }\n.avatar-img { width: 64px;',
    expect: '个人页不再自定义第二套人行头像尺寸（36px 的 .sm 变体与 15px 无源字阶已删）',
  },
  {
    name: 'M3 行卡内边距退回内联 style（editor 抄第 6 份）',
    file: F.editor,
    from: '<view wx:if="{{quickRoutes.length}}" class="card rows">',
    to: '<view wx:if="{{quickRoutes.length}}" class="card" style="padding:4px 16px;">',
    expect: '行卡内边距收进 app.wxss 的 .card.rows，me/editor 都不再抄内联 padding',
  },
  {
    name: 'M4 个人页内联 style 突破棘轮（11 → 12）',
    file: F.me,
    from: '<view class="person-list">',
    to: '<view class="person-list" style="min-width:0;">',
    expect: '个人页内联 style 数不高于 5a 基线 11（只许变少）',
  },
  {
    name: 'M5 模板用了 <person-row> 但登记键被改名（等价于没登记；单行锚点且 JSON 仍合法）',
    file: F.meJson,
    from: '"person-row": "/components/person-row/person-row"',
    to: '"person-row-x": "/components/person-row/person-row"',
    expect: '个人页注册共享 <person-row>（模板用了就必须登记，否则标签静默不渲染）',
  },
]

// 有效性门：变异之前工作树必须全绿，否则后面任何"红"都归不清是注入造成的还是本来就红。
let green = false
let greenOut = ''
try {
  greenOut = execSync('node tools/personal-route-layout-test.js', { cwd: ROOT, encoding: 'utf8' })
  green = true
} catch (e) {
  greenOut = String(e.stdout || '') + String(e.stderr || '')
}
if (!green) {
  console.log('  ✗ 改前副本不是全绿 ⇒ 本次变异运行 INVALID，不作任何结论')
  console.log(greenOut.split('\n').filter(l => /FAIL|passed=/.test(l)).slice(0, 10).join('\n'))
  process.exit(2)
}
console.log('  ✓ 有效性门：改前 ' + (/passed=\d+ failed=\d+/.exec(greenOut) || ['(无读数)'])[0] + '\n')

let missed = 0
for (const m of MUTANTS) {
  const before = sha(m.file)
  const src = read(m.file)
  if (!once(src, m.from)) {
    console.log('  ! ' + m.name + ' —— 锚点命中数 ≠ 1，注入失败，计一条漏网')
    missed++
    continue
  }
  write(m.file, src.split(m.from).join(m.to))
  let out = ''
  let rc = 0
  try {
    out = execSync('node tools/personal-route-layout-test.js', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '')
    rc = e.status || 1
  }
  write(m.file, src)
  const restored = sha(m.file) === before
  const fails = (out.match(/FAIL .*/g) || []).map(s => s.slice(5).trim())
  const hit = fails.some(name => name.indexOf(m.expect) === 0)
  // M5 会让 check.js 也红，但本门只要求自己那条断言红；其余红项如实列出。
  const ok = rc === 1 && hit && restored
  if (!ok) missed++
  console.log((ok ? '  ✓ ' : '  ✗ ') + m.name)
  console.log('     rc=' + rc + ' 命中目标断言=' + hit + ' 还原逐字节相等=' + restored +
    '（红 ' + fails.length + ' 条）')
  if (!hit) console.log('     实际红项：' + (fails.join(' / ') || '(无)'))
}

// 全部还原后必须回到全绿，否则说明还原本身有问题。
green = false
greenOut = ''
try {
  greenOut = execSync('node tools/personal-route-layout-test.js', { cwd: ROOT, encoding: 'utf8' })
  green = true
} catch (e) {
  greenOut = String(e.stdout || '') + String(e.stderr || '')
}
const counters = /passed=(\d+) failed=(\d+)/.exec(greenOut)
console.log('  ' + (green ? '✓' : '✗') + ' 还原后复跑：' + (counters ? counters[0] : '没有读数'))
if (!green) missed++

console.log('\n==== 变异 ' + MUTANTS.length + ' 条，漏网/失败 ' + missed + ' 条 ====')
process.exit(missed ? 1 : 0)
