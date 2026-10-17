/* Wave 2 修复轮（FLASH 批次）的判据有没有牙齿：复制 miniprogram 到临时目录，逐条把修复回退成缺陷，
 * 要求 tools/fixround2-assertions-test.js 在该副本上必须报红；仍然全绿 ⇒ 那条判据是假的。
 *
 * 三条「反向变异」（M11/M14/M16）不是回退缺陷，而是把修复做成一刀切：
 *   M11 = 首屏也 bump（读两遍）｜M14 = onLoad+onShow 双读｜M16 = 无条件 has-sticky（denied/loading 态多 88px 空白）
 * 它们和回退类变异同等重要——只测「缺陷会红」抓不住「条件判断根本没承重」（第十二轮「保留数>0」门同一条教训）。
 *
 * 崩红鉴别（G1-gate 第二轮改的口径）：退出码非 0 不等于「抓到」。
 *   caught = 输出里真的有 ✗ 断言行，且套件打印了 passed=/failed=（跑完了）
 *   CRASH  = 抛异常 / 中途中止 / 没有 tally ⇒ 记 CRASH≠CAUGHT，不计入抓到，并让本脚本 exit 1
 *   原因：一条红把整轮撞停时，后面所有段落都没有读数，那种「抓到」是假的（V2 审计的 V12/V15 实测过这个形态）。
 *
 * 锚点纪律：允许跨行锚点，但按目标文件自身的 EOL 拼接（CRLF 文件里写 \n 会命中 0 次 = 静默没注入），
 * 且命中必须恰为 1 次；命中数不对就计漏网并 exit 1，不静默改错行充数。
 * 先跑「未变异副本全绿」的有效性门，否则后面所有「被抓到」都不作数。
 *
 * 运行：node tools/fixround2-mutate.js
 * 退出码：0 = 每条都被抓到；1 = 有漏网、有崩红或注入失败；2 = 前置门未过
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = 'fixround2-assertions-test.js'
const RJS = 'components/roster-panel/roster-panel.js'
const RW = 'components/roster-panel/roster-panel.wxml'
const STAFFJS = 'pages/staff/staff.js'
const STAFFW = 'pages/staff/staff.wxml'
const ROUTEJS = 'pages/route/route.js'
const REW = 'pages/route-edit/route-edit.wxml'

const BUSY_GUARD = '      if (this.data.busy) return'
const BUSY_SET = "      this.setData({ busy: true, busyAt: Date.now(), error: '' })"
const ASK_SETDATA = "      this.setData({ revokeId: id, revokeText: m.userId + '（' + m.roleLabel + ' · 截止 ' + m.expiresLabel + '）' })"
const REVOKE_OK = "          this.setData({ busy: false, revokeId: '', revokeText: '' })"
const CONTACT_BTN = '    <view class="button secondary block {{purpose ? \'\' : \'disabled\'}}" hover-class="button-hover" bindtap="{{purpose ? \'onSensitive\' : \'\'}}">查看紧急联络与健康备注</view>'
const ERR_NODE = '    <view wx:if="{{error}}" class="callout danger">{{error}}</view>'
const EXPORT_BTN = '    <view class="button primary block {{busy || !exportPurpose ? \'disabled\' : \'\'}}" hover-class="button-hover" bindtap="{{busy || !exportPurpose ? \'\' : \'onExportConfirm\'}}">确认用途并复制名单</view>'
const STAFF_BUMP = "    if (this._shown) this.setData({ syncKey: 'staff@' + Date.now() })"
const ROUTE_MARK = "    this.routeId = options.id || ''"
const ROUTE_RELOAD = '    this.reload()'

const MUTANTS = [
  ['B1 去掉在途守卫（双击又能发出两笔 membership.save = C-04 原状）', RJS, [BUSY_GUARD], []],
  ['B2 不置 busy（按钮灰态与事件置空失去依据，模板守卫变装饰）', RJS, ['      // busy 只能在校验全过之后置：校验失败要先 return，否则一次填错就把按钮锁成「看着能点、点了没反应」。', BUSY_SET], ['      // busy 只能在校验全过之后置：校验失败要先 return，否则一次填错就把按钮锁成「看着能点、点了没反应」。']],
  ['B3 只在成功分支复位 busy（一次失败永久锁死授权按钮）', RJS,
    ["          api.toast('授权已保存')", '          this.loadAccess()', '        })', '        .catch(err => this.setData({ busy: false, error: api.errorText(err) }))'],
    ["          api.toast('授权已保存')", '          this.loadAccess()', '        })', '        .catch(err => this.setData({ error: api.errorText(err) }))']],
  ['B4 busy 提到校验之前（校验失败也锁灰按钮 = 把缺陷换个方向做）', RJS,
    [BUSY_GUARD, '      const userId = this.data.mUserId.trim()'],
    [BUSY_SET, '      const userId = this.data.mUserId.trim()']],
  ['B5 撤销回到单击即执行（M-13 原状：不可回退且影响第三方，零确认）', RJS,
    ['      if (!m) return', ASK_SETDATA],
    ['      if (!m) return', "      api.dispatchAndSync({ type: 'membership.revoke', activityId: this.data.activityId, membershipId: id }, this.revision, this).catch(() => {})", ASK_SETDATA]],
  ['B6 确认层不点名被撤销的是谁（只弹一个空壳，用户不知道撤了谁的什么能力）', RJS,
    [ASK_SETDATA],
    ["      this.setData({ revokeId: id, revokeText: '' })"]],
  ['B7 撤销成功后确认层不关（关掉才能把错误交给 sheet 的前提被抽走）', RJS,
    [REVOKE_OK],
    ['          this.setData({ busy: false })']],
  ['B8 联络弹层删掉就近错误出口（C-02 原状：红字写在遮罩背后的面板正文里）', RW,
    [CONTACT_BTN, ERR_NODE],
    [CONTACT_BTN]],
  ['B9 导出按钮视觉条件回到与事件条件互反（C-01 原状：能点时看着是灰的）', RW,
    [EXPORT_BTN],
    ['    <view class="button primary block {{busy && exportPurpose ? \'\' : \'disabled\'}}" hover-class="button-hover" bindtap="{{busy || !exportPurpose ? \'\' : \'onExportConfirm\'}}">确认用途并复制名单</view>']],
  ['B10 staff 页删掉 onShow 里的 bump（F-04 原状：返回本页还是旧快照）', STAFFJS,
    [STAFF_BUMP, '    this._shown = true'],
    ['    this._shown = true']],
  ['B11 首屏也 bump（组件 attached 已读过，白多打一次全量读）', STAFFJS,
    [STAFF_BUMP],
    ["    this.setData({ syncKey: 'staff@' + Date.now() })"]],
  ['B12 staff.wxml 不接 sync-key（宿主 bump 落进没人看的 data）', STAFFW,
    ['    <field-panel activity-id="{{activityId}}" perspective="staff" sync-key="{{syncKey}}" />'],
    ['    <field-panel activity-id="{{activityId}}" perspective="staff" />']],
  ['B13 route 页回到 onLoad-only（D-01 原状：保存后返回显示改动前的数据）', ROUTEJS,
    ['    this.reload()', '  },', '', '  onPullDownRefresh() {'],
    ['  },', '', '  onPullDownRefresh() {']],
  ['B14 onLoad 与 onShow 都读（首屏双读，分段天气外呼也翻倍）', ROUTEJS,
    [ROUTE_MARK],
    [ROUTE_MARK, ROUTE_RELOAD]],
  ['B15 route-edit 根节点回到裸 .page（M-01 原状：固定底栏压住「添加风险提示」）', REW,
    ['<view class="page {{!denied && !loading ? \'has-sticky\' : \'\'}}">'],
    ['<view class="page">']],
  ['B16 has-sticky 无条件挂上（denied/loading 态没有底栏却多留 88px）', REW,
    ['<view class="page {{!denied && !loading ? \'has-sticky\' : \'\'}}">'],
    ['<view class="page has-sticky">']],
]

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-fixround2-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tools', SUITE), path.join(dir, 'tools', SUITE))
  return dir
}
// 崩红鉴别：只有「真的出现 ✗ 断言行且套件跑完打印了 tally」才算抓到。
function runSuite(dir) {
  const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', SUITE)], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = String(r.stdout || '').concat('\n', String(r.stderr || ''))
  const lines = out.split(/\r?\n/)
  const reds = lines.filter(l => l.trim().indexOf('✗') === 0).map(l => l.trim())
  const m = out.match(/passed=(\d+) failed=(\d+)/)
  const crashed = /运行失败/.test(out) || !m || lines.some(l => /^TypeError:|^ReferenceError:/.test(l.trim()))
  if (crashed && r.status === 0 && m && Number(m[2]) === 0) return { cls: 'green', tally: m[0], reds: [] }
  if (crashed) return { cls: 'CRASH', tally: m ? m[0] : '(没有 tally ⇒ 中途中止)', reds: reds, crashLines: lines.filter(l => /运行失败|TypeError|ReferenceError/.test(l)).slice(0, 2) }
  if (reds.length || Number(m[2]) > 0) return { cls: 'caught', tally: m[0], reds: reds }
  return { cls: 'green', tally: m[0], reds: [] }
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
const pre = runSuite(base)
if (pre.cls !== 'green') {
  console.error('前置门未过：未变异的临时副本不是「跑完全程且 failed=0」（实测 ' + pre.cls + ' ' + pre.tally + '）\n  ' + (pre.reds || []).join('\n  '))
  fs.rmSync(base, { recursive: true, force: true })
  process.exit(2)
}
console.log('有效性门：未变异副本全绿并跑完全程（' + pre.tally + '，注入点真的在承重位置）\n')

let leaked = 0
let crashed = 0
MUTANTS.forEach(m => {
  const dir = sandbox()
  try {
    mutate(dir, m[1], m[2], m[3])
  } catch (e) {
    console.log('!! ' + m[0] + ' —— 注入失败（等于没测，计漏网）：' + e.message)
    leaked++
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  const r = runSuite(dir)
  if (r.cls === 'caught') {
    console.log('✓ ' + m[0] + '\n    ' + r.tally + '；被抓于 ' + r.reds[0].slice(0, 130) + (r.reds.length > 1 ? '（另有 ' + (r.reds.length - 1) + ' 条红）' : ''))
  } else if (r.cls === 'CRASH') {
    console.log('!! 崩红（CRASH≠CAUGHT）：' + m[0] + '\n    ' + r.tally + '；' + (r.crashLines || []).join(' / ') + '\n    ⇒ 这条变异让套件中止，后面的段落没有读数，不算抓到')
    crashed++
  } else {
    console.log('✗ 漏网：' + m[0] + '（判据全绿 ⇒ 这条退化抓不住）'); leaked++
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
fs.rmSync(base, { recursive: true, force: true })
console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条，崩红 ' + crashed + ' 条')
process.exit(leaked || crashed ? 1 : 0)
