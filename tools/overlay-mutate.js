/* S1-overlay 拆雷的判据有没有牙齿：把 overlay 组件复制到临时目录，逐条把修复回退成缺陷
 * （或做成 M-09 裁定未批准的形态），要求 tools/overlay-semantics-test.js 在该副本上必须报红；
 * 仍然全绿 ⇒ 那条判据是假的（铁律 30：边界要钉行为，且对拍/变异必须自证有牙齿）。
 *
 * 定稿形态 = findings M-09 修复方向的**选项 (B)**（关闭态不卸载 + 承重墙注释）。
 * 因此本脚本的 JS 族变异有两条纪律：
 *   · 回退型（R1/R3/R5/R6/R7）：把缺陷或死路径请回来。
 *   · 反向型（R2/R4/R8）：把**未被批准**的机制做出来——R2 = JS setTimeout 延时卸载
 *     （S1b 收回的那个自造机制）、R4 = 常驻节点在关闭态仍带 .open、R8 = 裁定的选项 A 形态
 *     （transitionend 绑定）。判据必须拒绝它们，否则门是在替被否决的设计背书。
 *
 * 与 fixround2-mutate 同一纪律：
 * · 锚点命中必须恰为 1 次，命中数不对就计漏网并 exit 1，不静默改错行充数（第十轮 S5 教训）。
 * · 先跑「未变异副本全绿」的有效性门，否则后面所有「被抓到」都不作数。
 * 运行：node tools/overlay-mutate.js
 * 退出码：0 = 每条都被抓到；1 = 有漏网或注入失败；2 = 前置门未过
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = 'overlay-semantics-test.js'
const WXSS = 'components/overlay/overlay.wxss'
const WJS = 'components/overlay/overlay.js'
const WXML = 'components/overlay/overlay.wxml'

// ---- 锚点（取自当前生产文件原文，LF；mutate() 按目标文件自身 EOL 拼接）----
const DLG_MARGIN = '.overlay--dialog { margin: auto 16px; }'
const BODY_RULE = '.overlay__body { min-height: 0; max-height: 62vh; }'
const PE_NONE = '  pointer-events: none;'
const VIS_HIDDEN = '  visibility: hidden;'
const GUARD_COMMENT = [
  '  /* 关闭态不卸载（E-07/C-17 定稿＝裁定选项 B：overlay.js 的 rendered 只有置 true 的路径，',
  '     弹层关闭后节点常驻）。关闭态不卸载，安全性由 pointer-events + visibility 承担——',
  '     下面这两条声明是全仓 31 处弹层（18 sheet + 13 dialog）的承重墙：改视觉时不要摘掉其中',
  '     任何一条，也不要退化成只留 opacity:0（platform-pitfalls §4：opacity:0 仍然吃点击，',
  '     届时每个常驻节点都会变成透明的全屏点击吞噬层）。 */',
]
const OBSERVER = [
  '    open(v) {',
  '      if (v) this.setData({ rendered: true })',
  '    },',
]
const RENDERED_INIT = '  data: { rendered: false, animating: false },'
const MASK_TAP = "    onMaskTap() { this.triggerEvent('close') },"
const CLOSE_TAP = "    onCloseTap() { this.triggerEvent('close') },"
// 注意：mask 行与 body 行都以 catchtouchmove="noop"> 结尾（首版锚点命中 2 次被纪律拦下），
// 必须带上 dialog 三元的尾巴才唯一。
const CATCH_MOVE = '\'}}" catchtap="noop" catchtouchmove="noop">'
const ROOT_CLASS = 'class="overlay-root {{open ? \'open\' : \'\'}}"'

const UNMOUNT_ELSE = [
  '    open(v) {',
  '      if (v) this.setData({ rendered: true })',
  '      else this.setData({ rendered: false })',
  '    },',
]
// S1 自造、由 S1b 退回的那三条：MOTION_MS 副本 + setTimeout 延时卸载 + detached 清理
const UNMOUNT_TIMER = [
  '    open(v) {',
  '      if (v) this.setData({ rendered: true })',
  '      else if (this.data.rendered) setTimeout(() => { if (!this.data.open) this.setData({ rendered: false }) }, 240)',
  '    },',
]

const MUTANTS = [
  // —— WXSS（E-01/M-10 族 + platform-pitfalls §4 承重墙）——
  ['W1 把 `.overlay-root { align-items: stretch; }` 抄回文件尾部（E-01 原状：18 处 sheet 顶端对齐恒 80vh）',
    WXSS, [DLG_MARGIN], [DLG_MARGIN, '', '.overlay-root { align-items: stretch; }'], 'S1.1/S1.2'],
  ['W2 删掉 `.overlay--dialog { margin: auto 16px; }`（总协调裁定「必须保留 L63」被违反：13 个 dialog 贴屏幕边）',
    WXSS, [DLG_MARGIN], [], 'S1.3'],
  ['W3 顺手把 .overlay__body 的 max-height 摘掉（长内容弹层失去滚动，M-10 副作用裁定禁止的「顺手改」）',
    WXSS, [BODY_RULE], ['.overlay__body { min-height: 0; }'], 'S1.7'],
  ['W4 关闭态摘掉 pointer-events:none（platform-pitfalls §4 事故复发：透明全屏点击吞噬层）',
    WXSS, [PE_NONE, VIS_HIDDEN], [VIS_HIDDEN], 'S1.9/S1.9b'],
  ['W5 关闭态摘掉 visibility:hidden（选项 B 下节点不卸载，摘掉它 = 常驻节点继续参与命中测试与可访问性树）',
    WXSS, [PE_NONE, VIS_HIDDEN], [PE_NONE], 'S1.9/S1.9c'],
  ['W6 双保险退化成只留 opacity:0（platform-pitfalls §4 点名的错误写法，M-09/C-17 说的「唯一防线」消失）',
    WXSS, [PE_NONE, VIS_HIDDEN], ['  opacity: 0;'], 'S1.9'],
  ['W7 删掉「关闭态不卸载」承重墙注释（选项 B 的文书面：后来者看不出那两行是承重墙）',
    WXSS, GUARD_COMMENT, ['  /* 关闭态不拦截页面交互 */'], 'S1.13'],
  // —— JS 关闭态行为（E-07/C-17 族，定稿 = 选项 B 不卸载）——
  ['R1 关闭时立刻卸载（else 分支直接 setData rendered:false：淡出被杀、且此刻 open 还是 true）',
    WJS, OBSERVER, UNMOUNT_ELSE, 'S3.3/S3.8'],
  ['R2 把 S1 自造的 JS setTimeout 延时卸载请回来（MOTION_MS 数字副本 + 240ms 摘节点；裁定未批准的机制）',
    WJS, OBSERVER, UNMOUNT_TIMER, 'S3.4/S3.6/S3.8'],
  ['R3 复活孤儿方法 onAnimationEnd（「代码在、路径死」类复发：无绑定的方法重新出现而无人察觉）',
    WJS, [CLOSE_TAP], [CLOSE_TAP, '    onAnimationEnd() {', '      if (!this.data.open) this.setData({ rendered: false })', '    },'], 'S2.3'],
  ['R5 把「直觉修法」请回来：onMaskTap 里直接 setData({rendered:false})（组件自关，越过 C-12 的 31 处共用关闭边界）',
    WJS, [MASK_TAP], ["    onMaskTap() { this.triggerEvent('close'); this.setData({ rendered: false }) },"], 'S3.14/S3.8'],
  ['R6 rendered 初值改 true（首屏即挂载：未打开过的弹层也常驻，S3.1 的首屏判据失守）',
    WJS, [RENDERED_INIT], ['  data: { rendered: true, animating: false },'], 'S3.1'],
  // —— WXML 绑定与类名完整性 ——
  ['R4 根节点 class 写死成恒带 open（不卸载形态下 = 关闭态命中 .overlay-root.open 的 auto/visible，整页点不动）',
    WXML, [ROOT_CLASS], ['class="overlay-root open"'], 'S3.11'],
  ['R7 把非法属性 animation-end="noop" 抄回模板（E-07 原缺陷形态：看起来在监听、其实永不触发）',
    WXML, [CATCH_MOVE], ['\'}}" catchtap="noop" catchtouchmove="noop" animation-end="noop">'], 'S2.4'],
  ['R8 加一条合法的 bindtransitionend="noop"（裁定的**选项 A** 形态：本批定稿为 B，门必须拒绝两套机制混在一张模板里）',
    WXML, [CATCH_MOVE], ['\'}}" catchtap="noop" catchtouchmove="noop" bindtransitionend="noop">'], 'S3.13'],
]

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-overlay-'))
  const dst = path.join(dir, 'miniprogram', 'components', 'overlay')
  fs.mkdirSync(dst, { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram', 'components', 'overlay'), dst, { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tools', SUITE), path.join(dir, 'tools', SUITE))
  return dir
}
function runSuite(dir) {
  const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', SUITE)], { cwd: dir, encoding: 'utf8' })
  if (r.status === 0) return []
  const lines = String(r.stdout || '').concat(String(r.stderr || '')).split(/\r?\n/).filter(l => l.trim().indexOf('✗') === 0)
  return [lines.length ? lines[0].trim().slice(0, 110) : '(exit ' + r.status + ')']
}
function mutate(dir, rel, fromLines, toLines) {
  const p = path.join(dir, 'miniprogram', rel)
  const text = fs.readFileSync(p, 'utf8')
  const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
  const from = fromLines.join(eol)
  const hits = text.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + rel + ' 里命中 ' + hits + ' 次（要求恰为 1 次）：' + from.slice(0, 60))
  fs.writeFileSync(p, text.split(from).join(toLines.join(eol)))
}

const base = sandbox()
const preBad = runSuite(base)
if (preBad.length) {
  console.error('前置门未过：未变异的临时副本就有红，后面所有「被抓到」都不作数\n  ' + preBad.join('\n  '))
  fs.rmSync(base, { recursive: true, force: true })
  process.exit(2)
}
console.log('有效性门：未变异副本全绿（注入点真的在承重位置）\n')

let leaked = 0
MUTANTS.forEach(m => {
  const dir = sandbox()
  try {
    mutate(dir, m[1], m[2], m[3])
  } catch (e) {
    console.log('!! ' + m[0] + ' —— 注入失败：' + e.message + '（计漏网，不静默改错行充数）')
    leaked++
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  const bad = runSuite(dir)
  if (bad.length) console.log('✓ ' + m[0] + '\n    被抓于 ' + bad[0] + '（预期 ' + m[4] + '）')
  else { console.log('✗ 漏网：' + m[0]); leaked++ }
  fs.rmSync(dir, { recursive: true, force: true })
})
fs.rmSync(base, { recursive: true, force: true })
console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
