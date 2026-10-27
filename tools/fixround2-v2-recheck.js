/* G1-gate 验收门：把 V2 审计那 19 条变异在自己重写过的判据上重跑一遍，外加 4 条针对新判据的补充变异。
 * 判据（任务书要求）：7 条真回退（V2/V4/V5/V6/V7/V8/V11）必须全部变红；
 *                    4 条等价改写（V3/V9/V17/V19）必须保持绿；
 *                    2 条源码文本假红（V10/V16）必须消除（＝变绿）；
 *                    V14 注入失败必须计失败并 exit 非 0。
 *
 * 崩红鉴别（本轮新加的口径，与「退出码非 0 就算抓到」的老口径不同）：
 *   caught  = 输出里真的有 ✗ 断言行，且套件跑完打印了 passed=/failed=
 *   CRASH   = 抛异常 / 中止 / 没有 tally ⇒ 单独记 CRASH≠CAUGHT，不计入「抓到」
 *   green   = failed=0 且 exit 0
 * 这样「一条红把整轮撞停」不再被当成判别力证据（后面的段落其实没有读数）。
 *
 * 沙盒纪律：只读 D:/OurTrail，注入全部发生在 %TEMP% 副本；锚点命中必须恰为 1 次（按目标文件自身 EOL 拼接），
 * 命中数不对就计失败，不静默改错行充数。先跑「未变异副本全绿」的有效性门。
 *
 * 运行：node tools/fixround2-v2-recheck.js
 * 退出码：0 = 每条读数都符合预期；1 = 有漏网 / 假红 / 崩红 / 注入失败；2 = 前置门未过
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const REPO = path.resolve(__dirname, '..')
const SUITE = 'fixround2-assertions-test.js'

const RJS = 'miniprogram/components/roster-panel/roster-panel.js'
const RW = 'miniprogram/components/roster-panel/roster-panel.wxml'
const STAFFJS = 'miniprogram/pages/staff/staff.js'
const STAFFW = 'miniprogram/pages/staff/staff.wxml'
const ROUTEJS = 'miniprogram/pages/route/route.js'
const REW = 'miniprogram/pages/route-edit/route-edit.wxml'
const AWXSS = 'miniprogram/app.wxss'

const BASE = path.join(os.tmpdir(), 'g1-v2-recheck-' + process.pid)
function buildBase() {
  fs.rmSync(BASE, { recursive: true, force: true })
  fs.mkdirSync(path.join(BASE, 'tools'), { recursive: true })
  fs.cpSync(path.join(REPO, 'miniprogram'), path.join(BASE, 'miniprogram'), { recursive: true })
  fs.copyFileSync(path.join(REPO, 'tools', SUITE), path.join(BASE, 'tools', SUITE))
}
function mutate(rel, fromLines, toLines) {
  const p = path.join(BASE, rel)
  const text = fs.readFileSync(p, 'utf8')
  const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
  const from = fromLines.join(eol)
  const hits = text.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + rel + ' 命中 ' + hits + ' 次（要求恰为 1）：' + from.slice(0, 70))
  fs.writeFileSync(p, text.split(from).join(toLines.length ? toLines.join(eol) : ''))
  return p
}
// 崩红鉴别：只有 ✗ 断言行才算「抓到」；抛错 / 没有 tally 一律记 CRASH
function runSuite() {
  const r = cp.spawnSync(process.execPath, [path.join(BASE, 'tools', SUITE)], { cwd: BASE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = String(r.stdout || '').concat('\n', String(r.stderr || ''))
  const lines = out.split(/\r?\n/)
  const reds = lines.filter(l => l.trim().indexOf('✗') === 0).map(l => l.trim())
  const m = out.match(/passed=(\d+) failed=(\d+)/)
  const crashed = /运行失败/.test(out) || !m
  const cls = crashed ? 'CRASH' : (reds.length || (m && Number(m[2]) > 0) ? 'red' : 'green')
  return {
    code: r.status,
    tally: m ? m[0] : '(没有 tally ⇒ 中途中止)',
    reds: reds,
    crashed: crashed,
    crashLines: lines.filter(l => /运行失败|TypeError|ReferenceError/.test(l)).slice(0, 2),
    cls: cls,
  }
}

const CONTACT_BTN = '    <view class="button secondary block {{purpose ? \'\' : \'disabled\'}}" hover-class="button-hover" bindtap="{{purpose ? \'onSensitive\' : \'\'}}">查看紧急联络与健康备注</view>'
const ERR_NODE = '    <view wx:if="{{error}}" class="callout danger">{{error}}</view>'
const SENS_OPEN = '    <view wx:if="{{sensitive}}" class="callout">'
const SENS_LINE = '      <text>紧急联系人：{{sensitive.emergency.name}}</text>'
const EXPORT_BTN = '    <view class="button primary block {{busy || !exportPurpose ? \'disabled\' : \'\'}}" hover-class="button-hover" bindtap="{{busy || !exportPurpose ? \'\' : \'onExportConfirm\'}}">确认用途并复制名单</view>'
const SAVE_BTN = '    <view class="button primary block {{busy ? \'disabled\' : \'\'}}" hover-class="button-hover" bindtap="{{busy ? \'\' : \'onAccessSave\'}}">保存明确授权</view>'
const REVOKE_TEXT_LINE = '    <text>将立即终止 {{revokeText}} 的协作能力。</text>'
const REVOKE_OK = '          this.setData({ busy: false, revokeId: \'\', revokeText: \'\' })'
const STAFF_BUMP = "    if (this._shown) this.setData({ syncKey: 'staff@' + Date.now() })"
const CONTACT_OVERLAY = '<overlay open="{{contactOpen}}" kind="sheet" title="{{contact.name}} · 联络资料" bind:close="onContactClose">'
const REVOKE_OVERLAY = '<overlay open="{{!!revokeId}}" kind="dialog" title="撤销协作授权" bind:close="onRevokeCancel">'
const ACCESS_HEAD = '<!-- 协作授权 -->'
const BS_IF = '      if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {'
const STUB = '  api.readOr = () => Promise.resolve({ memberships: [], groups: [], vehicles: [], events: [] })'
const HAS_STICKY = '.page.has-sticky { padding-bottom: 120px; }'

const CASES = [
  // ---- V2 审计的 19 条（原样重放，只重放不改判据）----
  { id: 'V1 确认层把 revokeText 换成静态文案（不点名具体对象）', expect: 'red', edits: [[RW, [REVOKE_TEXT_LINE], ['    <text>将立即终止对方的协作能力。</text>']]] },
  { id: 'V2 revokeText 仍在正文里，但被 wx:if="{{false}}" 藏掉（文案在场≠渲染在场）', expect: 'red', edits: [[RW, [REVOKE_TEXT_LINE], ['    <text wx:if="{{false}}">将立即终止 {{revokeText}} 的协作能力。</text>']]] },
  { id: 'V3 busy 复位拆成两次 setData（等价改写，应当全绿）', expect: 'green', edits: [[RJS, [REVOKE_OK], ['          this.setData({ revokeId: \'\', revokeText: \'\' })', '          this.setData({ busy: false })']]] },
  { id: 'V4 staff 每次 onShow 下发恒定 key（被组件 _readKey 去重吃掉 ⇒ 刷新归零）', expect: 'red', edits: [[STAFFJS, [STAFF_BUMP], ["    if (this._shown) this.setData({ syncKey: 'staff@1' })"]]] },
  { id: 'V5 route 的 onShow「读了但不渲染」（＝D-01 原状）', expect: 'red', edits: [[ROUTEJS, ['  onShow() {', '    // onShow 而不是 onLoad（与 routes.js 同型）：route-edit 保存成功后 navigateBack 回本页，', '    // 详情要反映改动后的标题、节点与风险；只挂 onLoad 会让「写成功」和「界面反馈」断成两截。', '    this.reload()'], ['  onShow() {', '    if (this.data.route) { api.readRoutes(this.routeId); return }', '    this.reload()']]] },
  { id: 'V6 联络弹层的 {{error}} 搬进 wx:if="{{sensitive}}" 分支（失败时恒不成立）', expect: 'red', edits: [[RW, [CONTACT_BTN, ERR_NODE, SENS_OPEN, SENS_LINE], [CONTACT_BTN, SENS_OPEN, '      <text style="display:block;" wx:if="{{error}}">读取失败：{{error}}</text>', SENS_LINE]]] },
  { id: 'V7 导出按钮删掉 disabled 类但保留条件置空 bindtap（该禁用却没有禁用表达）', expect: 'red', edits: [[RW, [EXPORT_BTN], ['    <view class="button primary block" hover-class="button-hover" bindtap="{{busy || !exportPurpose ? \'\' : \'onExportConfirm\'}}">确认用途并复制名单</view>']]] },
  { id: 'V8 保存按钮改用带点的表达式 {{expires.date}}（旧预筛 /[.[]/ 会整类豁免）', expect: 'red', edits: [[RW, [SAVE_BTN], ['    <view class="button primary block {{expires.date ? \'\' : \'disabled\'}}" hover-class="button-hover" bindtap="{{expires.date ? \'onAccessSave\' : \'\'}}">保存明确授权</view>']]] },
  { id: 'V9 导出按钮配对改成字面不同但同真同假的写法（等价 ⇒ 应当全绿）', expect: 'green', edits: [[RW, [EXPORT_BTN], ['    <view class="button primary block {{!(!busy && exportPurpose) ? \'disabled\' : \'\'}}" hover-class="button-hover" bindtap="{{!(!busy && exportPurpose) ? \'\' : \'onExportConfirm\'}}">确认用途并复制名单</view>']]] },
  { id: 'V10 联络弹层 open="{{contactOpen}}" → open="{{!!contactOpen}}"（等价 ⇒ 假红必须消除）', expect: 'green', edits: [[RW, [CONTACT_OVERLAY], ['<overlay open="{{!!contactOpen}}" kind="sheet" title="{{contact.name}} · 联络资料" bind:close="onContactClose">']]] },
  { id: 'V11 删掉 reload 里的 busyStale 自愈（此前只有注释自称依赖它）', expect: 'red', edits: [[RJS, [BS_IF, '        this.setData({ busy: false, busyAt: 0 })', "        console.warn('[busy] 清掉一个超过 8 秒没落地的写状态')", '      }'], []]] },
  { id: 'V12 把 dialog 拷一份放在协作授权 sheet 之前（压在 sheet 下面的原缺陷形态）', expect: 'red', edits: [[RW, [ACCESS_HEAD], [REVOKE_OVERLAY, '  <view class="stack">', REVOKE_TEXT_LINE, ACCESS_HEAD]]] },
  { id: 'V13 撤销确认层删掉 bind:close（没有取消通道）', expect: 'red', edits: [[RW, [REVOKE_OVERLAY], ['<overlay open="{{!!revokeId}}" kind="dialog" title="撤销协作授权">']]] },
  { id: 'V14 注入失败实验：锚点在仓库里不存在（必须计失败，不许静默当「已验」）', expect: 'inject-fail', edits: [[RW, ['    <view id="这一行在仓库里根本不存在">{{nonexistentAnchor}}</view>'], ['    <view>x</view>']] ] },
  { id: 'V15 撤掉 api.readOr 的桩（成功路径被失败分支替答的成因）', expect: 'red', edits: [['tools/' + SUITE, [STUB], []]] },
  { id: 'V16 app.wxss 的 .page.has-sticky 追加一条合法声明（行为不变 ⇒ 假红必须消除）', expect: 'green', edits: [[AWXSS, [HAS_STICKY], ['.page.has-sticky { padding-bottom: 120px; box-sizing: border-box; }']]] },
  { id: 'V17 撤销成功关层搬进 helper（运行行为逐字相同 ⇒ 应当全绿）', expect: 'green', edits: [[RJS, [REVOKE_OK], ['          this.closeRevokeDialog()']], [RJS, ["    onRevokeCancel() { this.setData({ revokeId: '', revokeText: '' }) },"], ["    onRevokeCancel() { this.setData({ revokeId: '', revokeText: '' }) },", "    closeRevokeDialog() { this.setData({ busy: false, revokeId: '', revokeText: '' }) },"]]] },
  { id: 'V18 has-sticky 条件把 && 写成 ||（denied 时留白却没有底栏）', expect: 'red', edits: [[REW, ['<view class="page {{!denied && !loading ? \'has-sticky\' : \'\'}}">'], ['<view class="page {{!denied || !loading ? \'has-sticky\' : \'\'}}">']]] },
  { id: 'V19 has-sticky 等价改写 denied || loading ? \'\' : has-sticky（应当全绿）', expect: 'green', edits: [[REW, ['<view class="page {{!denied && !loading ? \'has-sticky\' : \'\'}}">'], ['<view class="page {{denied || loading ? \'\' : \'has-sticky\'}}">']]] },

  // ---- G1 针对新判据补的变异（证明新门不是空转）----
  { id: 'N1 busyStale 自愈改成无条件复位 busy（一刀切：写还没落地就被清）', expect: 'red', edits: [[RJS, [BS_IF], ['      if (this.data.busy) {']]] },
  { id: 'N2 导出按钮在途仍可点且不变灰（busy 从模板表达里整段消失 = C-01b 的本体）', expect: 'red', edits: [[RW, [EXPORT_BTN], ['    <view class="button primary block" hover-class="button-hover" bindtap="onExportConfirm">确认用途并复制名单</view>']]] },
  { id: 'N3 .page.has-sticky 留白改成 24px（小于算出来的底栏高度 ⇒ 内容被压住）', expect: 'red', edits: [[AWXSS, [HAS_STICKY], ['.page.has-sticky { padding-bottom: 24px; }']]] },
  { id: 'N4 .page.has-sticky 规则整条删掉（模板还在挂这个类，留白归零）', expect: 'red', edits: [[AWXSS, [HAS_STICKY], []]] },
]

buildBase()
const pre = runSuite()
console.log('有效性门（未变异副本）：exit=' + pre.code + ' ' + pre.tally + (pre.reds.length ? '\n  ' + pre.reds.join('\n  ') : '') + (pre.crashed ? ' CRASH' : ''))
if (pre.cls !== 'green') {
  console.error('前置门未过 ⇒ 后面所有读数都不作数')
  fs.rmSync(BASE, { recursive: true, force: true })
  process.exit(2)
}

let leak = 0
let falseRed = 0
let crashCount = 0
let injectFail = 0
let mismatch = 0
CASES.forEach(cs => {
  const touched = []
  let injectErr = null
  cs.edits.forEach(e => {
    if (injectErr) return
    try { touched.push(mutate(e[0], e[1], e[2])) } catch (err) { injectErr = err.message }
  })
  let r = null
  if (!injectErr) r = runSuite()
  touched.forEach(p => {
    const rel = path.relative(BASE, p).split(path.sep).join('/')
    fs.copyFileSync(path.join(REPO, rel), p)
  })

  const actual = injectErr ? 'inject-fail' : r.cls
  const ok = cs.expect === actual
  if (actual === 'green' && cs.expect === 'red') leak++
  if (actual === 'red' && cs.expect === 'green') falseRed++
  if (actual === 'CRASH') crashCount++
  if (injectErr) {
    injectFail++
    // 注入失败＝那条变异根本没被执行，等于没测：除计划内的纪律实验（V14）外一律计漏网
    if (cs.expect !== 'inject-fail') leak++
  }
  if (!ok && actual !== 'green' && actual !== 'red' && actual !== 'CRASH') mismatch++
  console.log('\n[' + cs.id + ']')
  console.log('  预期=' + cs.expect + '  实测=' + actual + (ok ? '  （符合预期）' : '  ←←← 与预期不符'))
  if (injectErr) console.log('  注入失败读数：' + injectErr)
  if (r) {
    console.log('  exit=' + r.code + ' ' + r.tally + (r.crashed ? '  （CRASH≠CAUGHT：中止/无 tally，不计入抓到）' : ''))
    if (r.crashLines.length) console.log('  抛错处：' + r.crashLines.join(' / '))
    if (r.reds.length) console.log('  红：\n    ' + r.reds.join('\n    '))
  }
})
console.log('\n================ 汇总 ================')
console.log('用例 ' + CASES.length + ' 条：真回退漏网 ' + leak + ' 条 / 等价改写假红 ' + falseRed + ' 条 / 崩红（不计入抓到）' + crashCount + ' 条 / 注入失败 ' + injectFail + ' 条 / 其它颜色不符 ' + mismatch + ' 条')
fs.rmSync(BASE, { recursive: true, force: true })
process.exit(leak || falseRed || crashCount || mismatch ? 1 : 0)
