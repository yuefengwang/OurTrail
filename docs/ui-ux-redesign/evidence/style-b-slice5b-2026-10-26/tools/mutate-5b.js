'use strict'
/* 5b 新门的牙齿自证：把四条收敛逐项退回去，门必须变红，且红的必须是**那一条**断言。
   工作树原地改 → 跑套件 → 按 sha256 逐字节还原；锚点一律取**单行**且要求命中恰为 1 次
   （跨行锚点在 CRLF 文件里命中 0 次 = 假注入，见 SYNC 铁律 31⑥）。
   有效性门：变异前工作树必须全绿，否则 exit 2 记 INVALID，不作任何结论。 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '../../../../..')
const F = {
  app: 'miniprogram/app.wxss',
  routes: 'miniprogram/pages/routes/routes.wxml',
  routesCss: 'miniprogram/pages/routes/routes.wxss',
  route: 'miniprogram/pages/route/route.wxml',
  routeCss: 'miniprogram/pages/route/route.wxss',
  routeEdit: 'miniprogram/pages/route-edit/route-edit.wxml',
  editor: 'miniprogram/pages/editor/editor.wxml',
  signup: 'miniprogram/pages/signup/signup.wxml',
  chart: 'miniprogram/pages/weather-chart/weather-chart.wxss',
}
const sha = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const write = (rel, s) => fs.writeFileSync(path.join(ROOT, rel), s, 'utf8')

const G1 = '紧凑指标只有 app.wxss 一个出处；两页不得再各抄一份字号/行距/字距'
const G2 = '与 .cluster 缺省同值的空覆盖 .route-meta 已从两页的定义与模板里一起消失'
const G3 = '全图页的可点档位下限引用 --touch-target，不写死 44px'
const G4 = '六页内联 style 不高于 5b 基线（routes 0 / weather-chart 0 / route 10 / route-edit 17 / editor 99 / signup 17）'
const G5 = '行内主标题走 app.wxss 的 .row-title（字重与 overflow-wrap 同处），三页不再内联抄字重'
const G6 = 'route 详情的节点名只留排布差，字重与断词由共享类承担（两个类同写）'

const MUTANTS = [
  {
    name: 'N1 routes.wxss 重新抄一份紧凑指标（回到两页各存一份）',
    file: F.routesCss, from: '.route-metrics .metric .metric-label { margin-top: 0; }',
    to: '.route-metrics .metric .metric-value {\n  font-size: var(--text-title);\n  line-height: 24px;\n  letter-spacing: 0;\n}\n.route-metrics .metric .metric-label { margin-top: 0; }',
    expect: G1,
  },
  {
    name: 'N2 route 详情页丢掉 compact 类（模板不再走单源）',
    file: F.route, from: 'class="metrics compact route-facts"',
    to: 'class="metrics route-facts"',
    expect: G1,
  },
  {
    name: 'N3 app.wxss 的 .metrics.compact 规则被改名（出处消失）',
    file: F.app, from: '.metrics.compact .metric .metric-value {',
    to: '.metrics.compact-x .metric .metric-value {',
    expect: G1,
  },
  {
    name: 'N4 route.wxss 重新定义一份 .route-meta（第 2 份死覆盖回来了）',
    file: F.routeCss, from: '.route-facts .metric .route-fact-missing {',
    to: '.route-meta { gap: 8px; }\n.route-facts .metric .route-fact-missing {',
    expect: G2,
  },
  {
    name: 'N4b routes 模板重新使用 .route-meta（定义与使用一起回来）',
    file: F.routes, from: '<view wx:if="{{mineRoutes.length}}" class="stack-gap3">',
    to: '<view class="cluster route-meta"></view><view wx:if="{{mineRoutes.length}}" class="stack-gap3">',
    expect: G2,
  },
  {
    name: 'N5 全图页档位触点写死 44px（绕过 token）',
    file: F.chart, from: '.fc-modes .seg { min-height: var(--touch-target);',
    to: '.fc-modes .seg { min-height: 44px;',
    expect: G3,
  },
  {
    name: 'N6 routes 引入第一条内联 style（0 → 1）',
    file: F.routes, from: '<view wx:if="{{mineRoutes.length}}" class="stack-gap3">',
    to: '<view wx:if="{{mineRoutes.length}}" class="stack-gap3" style="gap:8px;">',
    expect: G4,
  },
  {
    name: 'N7 route-edit 内联 style 突破基线（17 → 18）',
    file: F.routeEdit, from: '<form-field label="路线名称"',
    to: '<form-field label="路线名称" style="min-width:0"',
    expect: G4,
  },
  {
    name: 'N8 .row-title 只留字重、把 M-16 的 overflow-wrap 丢掉（半份决定的形态）',
    file: F.app, from: '.row-title { font-weight: 600; overflow-wrap: anywhere; }',
    to: '.row-title { font-weight: 600; }',
    expect: G5,
  },
  {
    name: 'N9 editor 把一处行内主标题退回内联字重',
    file: F.editor, from: '<text class="row-title">简介与推荐理由（可选）</text>',
    to: '<text style="font-weight:600;">简介与推荐理由（可选）</text>',
    expect: G5,
  },
  {
    name: 'N10 route.wxss 的 .route-node-name 重新声明字重（两处一起写）',
    file: F.routeCss, from: '  margin-top: 2px;',
    to: '  margin-top: 2px;\n  font-weight: 600;',
    expect: G6,
  },
  {
    name: 'N11 route 模板去掉 row-title 类（共享类不再承担这一行）',
    file: F.route, from: 'class="row-title route-node-name"',
    to: 'class="route-node-name"',
    expect: G6,
  },
  {
    name: 'N12 signup 的参与人行名退回内联字重（证明那一页不是搭便车通过的）',
    file: F.signup, from: '<text class="row-title">{{p.person.name',
    to: '<text style="font-weight:600;">{{p.person.name',
    expect: G5,
  },
  {
    name: 'N13 route 详情内联 style 突破基线（10 → 11）',
    file: F.route, from: '<view class="metrics compact route-facts">',
    to: '<view class="metrics compact route-facts" style="gap:12px;">',
    expect: G4,
  },
]

let greenOut = ''
let green = true
try {
  greenOut = execSync('node tools/personal-route-layout-test.js', { cwd: ROOT, encoding: 'utf8' })
} catch (e) {
  green = false
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
  if (src.split(m.from).length - 1 !== 1) {
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
  if (!(rc === 1 && hit && restored)) missed++
  console.log((rc === 1 && hit && restored ? '  ✓ ' : '  ✗ ') + m.name)
  console.log('     rc=' + rc + ' 命中目标断言=' + hit + ' 还原逐字节相等=' + restored + '（红 ' + fails.length + ' 条）')
  if (!hit) console.log('     实际红项：' + (fails.join(' / ') || '(无)'))
}

green = true
greenOut = ''
try {
  greenOut = execSync('node tools/personal-route-layout-test.js', { cwd: ROOT, encoding: 'utf8' })
} catch (e) {
  green = false
  greenOut = String(e.stdout || '') + String(e.stderr || '')
}
console.log('  ' + (green ? '✓' : '✗') + ' 还原后复跑：' + ((/passed=\d+ failed=\d+/).exec(greenOut) || ['(无读数)'])[0])
if (!green) missed++

console.log('\n==== 变异 ' + MUTANTS.length + ' 条，漏网/失败 ' + missed + ' 条 ====')
process.exit(missed ? 1 : 0)
