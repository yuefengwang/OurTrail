'use strict'
/* 5c 的牙齿自证：专验那条**全仓**内联字重门的"扫描面宽度"与"名单比对不是数个数"。
   背景（负责人反复纠正过的一条）："0 命中"的门必须先证明那把尺能产生差 ——
   一条只扫我改过的 5 个页的门，答绿是免费的；它必须在**没改过的页**上也会红才算覆盖。
   做法：工作树原地注入 → 跑套件 → sha256 逐字节还原 + 独立复验。锚点一律单行且要求命中恰为 1 次。
   有效性门：变异前工作树必须全绿，否则 exit 2 记 INVALID，不作任何结论。 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '../../../../..')
const sha = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const write = (rel, s) => fs.writeFileSync(path.join(ROOT, rel), s, 'utf8')

const GWIDE = '全仓独立的内联字重行标题为 0；复合内联字重只剩登记的这 2 处'
const GPAGE = '行内主标题走 app.wxss 的 .row-title（字重与 overflow-wrap 同处），四页不再内联抄字重'

const MUTANTS = [
  {
    name: 'P1 lab 的一处行名退回独立内联字重（本页既是门内页，也应被全仓门抓到）',
    file: 'miniprogram/pages/lab/lab.wxml',
    from: '<text class="row-title">{{item.title}}</text>',
    to: '<text style="font-weight:600;">{{item.title}}</text>',
    expect: [GWIDE, GPAGE],
  },
  {
    name: 'P2 从没改过的 staff 页新增一处独立内联字重（证明扫描面不是"只覆盖写集"）',
    file: 'miniprogram/pages/staff/staff.wxml',
    from: '<text class="staff-identity__title">照顾好这一小队。</text>',
    to: '<text style="font-weight:600;">probe</text><text class="staff-identity__title">照顾好这一小队。</text>',
    expect: [GWIDE],
  },
  {
    name: 'P3 从没改过的 vehicle 页新增一处**复合**内联字重（名单是逐条比对，不是数个数 ≤2）',
    file: 'miniprogram/pages/vehicle/vehicle.wxml',
    from: '<view class="vehicle-identity hero stack" style="gap:8px;">',
    to: '<view class="vehicle-identity hero stack" style="color:var(--forest);font-weight:600;gap:8px;">',
    expect: [GWIDE],
  },
  {
    name: 'P4 把 activity 那处已登记的复合形态改成独立形态（例外名单不该反过来保护新写法）',
    file: 'miniprogram/pages/activity/activity.wxml',
    from: '<text style="display:block;font-weight:600;margin-top:2px;">{{item.name}}</text>',
    to: '<text style="font-weight:600;">{{item.name}}</text>',
    expect: [GWIDE],
  },
  {
    name: 'P5 组件侧（roster-panel）新增独立内联字重（证明组件目录也在扫描面内）',
    file: 'miniprogram/components/roster-panel/roster-panel.wxml',
    from: '<view class="roster-filter">',
    to: '<text style="font-weight:600;">probe</text><view class="roster-filter">',
    expect: [GWIDE],
  },
  {
    name: 'P6 app.wxss 的 .row-title 丢掉字重只留断词（另一半也不能少）',
    file: 'miniprogram/app.wxss',
    from: '.row-title { font-weight: 600; overflow-wrap: anywhere; }',
    to: '.row-title { overflow-wrap: anywhere; }',
    expect: [GPAGE],
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
  const fails = (out.match(/FAIL .*/g) || []).map(s => s.slice(5).split(' — ')[0].trim())
  const hitAll = m.expect.every(name => fails.some(f => f.indexOf(name) === 0))
  const ok = rc === 1 && hitAll && restored
  if (!ok) missed++
  console.log((ok ? '  ✓ ' : '  ✗ ') + m.name)
  console.log('     rc=' + rc + ' 期望红=' + m.expect.length + ' 实际红=' + fails.length +
    ' 全部命中=' + hitAll + ' 还原逐字节相等=' + restored)
  if (!hitAll) console.log('     实际红项：' + (fails.join(' / ') || '(无)'))
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
