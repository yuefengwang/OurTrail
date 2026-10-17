// R-A 判据有没有牙齿（Wave 2 批次 5 · field-panel 这一棒）：node tools/ra-field-panel-mutate.js
//
// 做法：把 miniprogram 与 tools/ra-field-panel-test.js 复制到临时目录，逐条把修复回退成缺陷
// （或做成一刀切 / 扩大化 / 等价改写），要求套件在该副本上给出**预期**的结果：
//   缺陷类必须报红（仍然全绿 ⇒ 那条判据是假的）；等价类必须全绿（红了 ⇒ 判据在钉源码文本，铁律 30）。
//
// 四类变异（缺一类就等于没测）：
//   · 回退类 C*/E*/V*/H*：把修复撤掉，回到审计里那条缺陷的原状
//   · 一刀切类 E1/E4/E7/H1/H2：把修复做成无条件（永远不说 / 永远都说 / 无条件重读）
//     —— 减话与减行类改动的真正风险在这里（天气线第十二轮「保留数 > 0」门、第十轮三条空改门同一条教训）
//   · 扩大化类 V2/V3/H4/C6：把该留的东西一起拆掉或顺手扩大（解释行、反馈色板、未结异常那一行、失败时的用户输入）
//   · 对照类 K*（expect green）：行为逐字等价的改写（铁律 32④ 的另一半：把等价变异当牙齿也不构成证明）
//
// 锚点纪律：命中必须恰为 1 次，按目标文件自身的 EOL 拼接（CRLF 文件里写 \n 会命中 0 次 = 静默没注入）；
// 命中数不对就计漏网并 exit 1，不静默改错行充数。先跑「未变异副本全绿」的有效性门。
// 崩红 ≠ 抓到：只有「出现 ✗ 断言行且套件打印了 tally」才算抓到。
//
// 运行：node tools/ra-field-panel-mutate.js
// 退出码：0 = 每条都符合预期；1 = 有漏网 / 崩红 / 注入失败 / 对照类被误伤；2 = 前置门未过
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = 'ra-field-panel-test.js'
const FJS = 'components/field-panel/field-panel.js'
const FW = 'components/field-panel/field-panel.wxml'
const WW = 'pages/workspace/workspace.wxml'

// 承重行的锚点（逐条取自当前工作区的真实代码行，不是注释；mutate() 强制命中恰为 1 次）
const SET_AFTER_WRITE = "          this.setData({ busy: false, note: '', message: act.label + '已保存。' })"
const CATCH_LINE = "        .catch(err => this.setData({ busy: false, error: api.errorText(err) }))"
const REFRESH_SET = '      this.setData({ actions: built.actions, pointEnabled: built.pointEnabled, sheetHint: built.sheetHint })'
const REFRESH_GUARD = '      if (!this.data.sheetOpen || !this.data.sel || !this.view) return'
const OUT_OF_SCOPE = ['          actions: [],', '          pointEnabled: false,']
const EMPTY_BRANCH = '  if (confirmedCount) {'
const LABEL_LINE = "  const clearLabel = search && unresolvedOnly ? '清空搜索与勾选'"
const SEARCH_CARD = [
  "        emptyTitle: '没有匹配「' + search + '」的人',",
  "        emptyDetail: '现场名单里对不上这个姓名；试试只输入姓氏，或清空条件看全部人员。',",
  '        emptyAction: clearLabel,',
]
const SETTLED_CARD = [
  "      emptyTitle: '待核实的都已经核完了',",
  "      emptyDetail: '这一区现在没有待办：每个人的出发去向都已给出结论。取消勾选可以看全部人员。',",
  '      emptyAction: clearLabel,',
]
const SEARCH_TITLE = SEARCH_CARD[0]
const CLEAR_FILTERS = "      this.setData({ search: '', unresolvedOnly: false }, () => this.reload())"

const CLEAR_GUARD = '      if (!this.data.search && !this.data.unresolvedOnly) return'
const NONE_CARD = [
  "    emptyTitle: '这一场暂时没有在场人员',",
  "    emptyDetail: '这里只列已经确认的参与人；他们出现在名单后，现场要核实的项就会排在这里。',",
  "    emptyAction: '',",
]
const NODE_GATE = "      const nodeEnabled = row.departure === 'joined' && permitted.indexOf('attendance.node') !== -1"
const SHEET_ROW_FIND = '      const row = this.view.rows.find(r => r.signupId === id)'
const REFRESH_ROW = "      const row = this.view.rows.find(r => r.signupId === this.data.sel.signupId && r.status === 'confirmed')"
const CONFIRMED_ROWS = "        const confirmedRows = v.rows.filter(r => r.status === 'confirmed')"
const NOTE_GATE = '      if (act.needNote && !this.data.note.trim()) {'
const HOME_FLAG = "          showHomeCount: !(this.data.pageMetrics && J.fieldMetric(phase).key === 'pendingHome'),"
const HEAD_BLOCK = '    <view class="stack" style="gap:4px;">'
const RULE_LINE = '      <text class="small muted">签到、上车、出发与到家分别记录，不能相互替代。</text>'
const INCIDENT_LINE = '        <text class="small muted">未结异常 {{openIncidents}} 项</text>'
const PAGE_PAIR = [
  '    <view wx:if="{{error}}" class="callout danger">{{error}}</view>',
  '    <view wx:if="{{message}}" class="callout success">{{message}}</view>',
  '  </view>',
  '</view>',
]
const WS_TAG = 'perspective="organizer" page-metrics="{{true}}" '
const FILTER_COMMENT = [
  '        // 三个过滤器串成一排，任一环把人清空都得说得清是哪一环（C-18）：',
  '        // 逐级留下人数，空态文案才能指到真正的成因，而不是给三种情况共用一句话。',
]

const MUTANTS = [
  // —— C-10：写成功后弹层跟随事实 + 依据不跨命令复用
  ['C1 写成功后不清依据（旧证据静默变成下一条命令的 evidence.note = 审计污染，C-10 本体的一半）', FJS,
    [SET_AFTER_WRITE],
    ["          this.setData({ busy: false, message: act.label + '已保存。' })"]],
  ['C2 写成功后不重算动作表（服务端已不接受的按钮留在屏上等人点 = C-10 本体的另一半）', FJS,
    [REFRESH_SET], ['      void built']],
  ['C3 重算函数被整体短路（每一次重读之后都没有第二次装配；宿主 bump 那条路也一起失效）', FJS,
    [REFRESH_GUARD], ['      if (true) return']],
  ['C4 人已出局时仍然留旧动作表（收按钮那一步被抽走，弹层里就是点了必被拒的一排）', FJS,
    OUT_OF_SCOPE, ['          actions: this.data.actions,', '          pointEnabled: this.data.pointEnabled,']],
  ['C5 写成功改成直接关弹层（连点效率没了；本轮裁的是「不关层 + 刷新」这个形态）', FJS,
    [SET_AFTER_WRITE],
    ["          this.setData({ busy: false, note: '', message: act.label + '已保存。', sheetOpen: false })"]],
  ['C6 写失败也把依据清掉（那是用户正在用的输入，吞掉它是第二次伤害，也是「保留输入」话术的前提）', FJS,
    [CATCH_LINE], ["        .catch(err => this.setData({ busy: false, note: '', error: api.errorText(err) }))"]],
  ['C7 重算时丢掉服务端能力位（attendance.node 的权限判据随搬家丢一半 ⇒ 不该出现的按钮又出现）', FJS,
    [NODE_GATE], ["      const nodeEnabled = row.departure === 'joined'"]],
  ['C8 重算时把已签到的人误判成出局（刷新顺手做了筛选 ⇒ 弹层对着不存在的人说「不在范围内」）', FJS,
    [REFRESH_ROW], ["      const row = this.view.rows.find(r => r.signupId === this.data.sel.signupId && r.status === 'confirmed' && !r.checkedIn)"]],
  ['C9 名单侧把已签到的人筛掉（刷新不许筛人：她还在这场活动里，只是这一步已经核过）', FJS,
    [CONFIRMED_ROWS], ["        const confirmedRows = v.rows.filter(r => r.status === 'confirmed' && !r.checkedIn)"]],
  ['C10 必填依据的闸门被摘掉（没依据也发命令 ⇒ 法定证据字段可以被空着落库，1.7 的拦截消失）', FJS,
    [NOTE_GATE], ['      if (false && act.needNote && !this.data.note.trim()) {']],
  ['C11 重算时忘记撤掉节点选择器（pointEnabled 停在旧值，权限撤了图上还能选节点）', FJS,
    [REFRESH_SET], ['      this.setData({ actions: built.actions, sheetHint: built.sheetHint })']],

  // —— C-18：空态三分成因 + 真的下一步
  ['E1 三种成因塌回一句（搜索无果与「本场没人」共用同一句话 = 可被误读成空场）', FJS,
    [EMPTY_BRANCH], ['  if (false) {']],
  ['E2 搜索无果不给下一步（只说没有，不说怎么办）', FJS,
    SEARCH_CARD, [SEARCH_CARD[0], SEARCH_CARD[1], "        emptyAction: '',"]],
  ['E3 全员已结清不给下一步（好消息也没有出路）', FJS,
    SETTLED_CARD, [SETTLED_CARD[0], SETTLED_CARD[1], "      emptyAction: '',"]],
  ['E4 按钮名一刀切（三种场合同一句「清空搜索与勾选」，与此刻真的在起作用的条件对不上）', FJS,
    [LABEL_LINE], ["  const clearLabel = search || unresolvedOnly ? '清空搜索与勾选'"]],
  ['E5 「清空条件」只撤勾选不撤搜索（按钮说清空、做的是一半）', FJS,
    [CLEAR_FILTERS], ["      this.setData({ unresolvedOnly: false }, () => this.reload())"]],
  ['E6 「清空条件」只改 data 不重读（按钮是真的，后果是假的）', FJS,
    [CLEAR_FILTERS], ["      this.setData({ search: '', unresolvedOnly: false })"]],
  ['E7 没有条件可撤时也重读一次（那颗按钮本来不该存在，点了白打一次全量读）', FJS,
    [CLEAR_GUARD], ['      if (false) return']],
  // —— A-18：常驻头部不占语义色
  ['V1 常驻头部换回 .callout warning（警告色继续被中性内容长期占用 = A-18 本体）', FW,
    [HEAD_BLOCK], ['    <view class="callout warning" style="gap:4px;">']],
  ['V2 换形态时把那句口径说明一起删掉（解释没了 = 该条目的副作用风险项）', FW,
    [RULE_LINE], []],
  ['V3 把主区两条反馈 callout 一起拆掉（色板被拆，不只是不再常驻）', FW,
    PAGE_PAIR, ['  </view>', '</view>']],
  // —— A-17：同一计数只渲染一遍
  ['H1 一律不印待到家（一刀切：staff 页与 gathering 阶段的唯一读数也被抹掉）', FJS,
    [HOME_FLAG], ['          showHomeCount: false,']],
  ['H2 一律印待到家（回到同屏两遍：页面 26px 可点 + 面板一行小字 = A-17 本体）', FJS,
    [HOME_FLAG], ['          showHomeCount: true,']],
  ['H3 宿主接线被摘掉（workspace 不再声明自己有指标区 ⇒ 两遍回来）', WW,
    [WS_TAG], ['perspective="organizer" ']],
  ['H4 减行扩大到整块：连「未结异常」一起删（判据必须区分减的是哪一格）', FW,
    [INCIDENT_LINE], []],
  ['H5 把「哪一格印什么」内联成第二套阶段表（口径搬家时两处会分开漂，铁律 19/22）', FJS,
    [HOME_FLAG], ['          showHomeCount: !(this.data.pageMetrics && (phase === \'active\' || phase === \'closing\')),']],
  ['E8 「没有已确认的人」那张卡也给清空按钮（那个场合没有任何条件可撤，按钮会空转）', FJS,
    NONE_CARD, [NONE_CARD[0], NONE_CARD[1], "    emptyAction: '看全部人员',"]],
  // —— 对照变异：行为逐字等价，必须全绿
  ['K1 对照：改注释措辞（行为一字不变 ⇒ 套件必须仍全绿）', FJS,
    FILTER_COMMENT, ['        // 三个过滤器逐级留下人数，空态才知道该说哪一种成因。'], 'green'],
  ['K2 对照：pageMetrics 判法换成 === true（布尔值下逐字等价）', FJS,
    [HOME_FLAG],
    ["          showHomeCount: !(this.data.pageMetrics === true && J.fieldMetric(phase).key === 'pendingHome'),"], 'green'],
  ['K3 对照：搜索词包一层 String（同一份输入 ⇒ 同一句话）', FJS,
    [SEARCH_TITLE], ["        emptyTitle: '没有匹配「' + String(search) + '」的人',"], 'green'],
]

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-ra-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'tools', SUITE), path.join(dir, 'tools', SUITE))
  return dir
}
function runSuite(dir) {
  const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', SUITE)], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = String(r.stdout || '').concat('\n', String(r.stderr || ''))
  const lines = out.split(/\r?\n/)
  const reds = lines.filter(l => l.trim().indexOf('✗') === 0).map(l => l.trim())
  const m = out.match(/passed=(\d+) failed=(\d+)/)
  const crashed = !m || lines.some(l => /^TypeError:|^ReferenceError:|^SyntaxError:/.test(l.trim()))
  if (crashed) return { cls: 'CRASH', tally: m ? m[0] : '(没有 tally ⇒ 中途中止)', reds, crashLines: lines.filter(l => /TypeError|ReferenceError|SyntaxError/.test(l)).slice(0, 2) }
  if (reds.length || Number(m[2]) > 0) return { cls: 'caught', tally: m[0], reds }
  return { cls: 'green', tally: m[0], reds: [] }
}
function mutate(dir, rel, fromLines, toLines) {
  const p = path.join(dir, 'miniprogram', rel)
  const text = fs.readFileSync(p, 'utf8')
  const eol = text.indexOf('\r\n') !== -1 ? '\r\n' : '\n'
  const from = fromLines.join(eol)
  const hits = text.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + rel + ' 里命中 ' + hits + ' 次（要求恰为 1 次）：' + from.slice(0, 70))
  fs.writeFileSync(p, text.split(from).join(toLines.join(eol)))
}

const base = sandbox()
let pre
try { pre = runSuite(base) } catch (e) {
  console.error('前置门无法执行：' + e.message)
  process.exit(2)
}
if (pre.cls !== 'green') {
  console.error('前置门未过：未变异的临时副本不是「跑完全程且 failed=0」（实测 ' + pre.cls + ' ' + pre.tally + '）\n  ' + (pre.reds || []).join('\n  '))
  fs.rmSync(base, { recursive: true, force: true })
  process.exit(2)
}
console.log('有效性门：未变异副本全绿并跑完全程（' + pre.tally + ' ⇒ 注入点都在承重位置上）\n')

let caught = 0
let leaked = 0
let crashed = 0
let falseRed = 0
MUTANTS.forEach(m => {
  const name = m[0]
  const rel = m[1]
  const fromLines = m[2]
  const toLines = m[3]
  const want = m[4] === 'green' ? 'green' : 'caught'
  const dir = sandbox()
  try {
    mutate(dir, rel, fromLines, toLines)
  } catch (e) {
    console.log('!! 注入失败（等于没测，计漏网）：' + name + '\n    ' + e.message)
    leaked++
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  const r = runSuite(dir)
  if (r.cls === 'CRASH') {
    crashed++
    console.log('!! 崩红（CRASH≠CAUGHT）：' + name + '\n    ' + r.tally + '；' + (r.crashLines || []).join(' / ') + '\n    ⇒ 套件中止，后面的段落没有读数，不算抓到')
  } else if (want === 'caught' && r.cls === 'caught') {
    caught++
    console.log('✓ 抓到：' + name + '\n    ' + r.tally + '；被抓于 ' + r.reds[0].slice(0, 150) + (r.reds.length > 1 ? '（另有 ' + (r.reds.length - 1) + ' 条红）' : ''))
  } else if (want === 'green' && r.cls === 'green') {
    caught++
    console.log('✓ 对照如预期：' + name + '\n    ' + r.tally + ' ⇒ 等价改写不红（判据钉的是行为，不是源码文本）')
  } else if (want === 'green') {
    falseRed++
    console.log('!! 误伤：' + name + '（行为等价的改写被判红 ⇒ 判据在钉源码文本）\n    被抓于 ' + r.reds[0].slice(0, 150))
  } else {
    leaked++
    console.log('✗ 漏网：' + name + '（判据全绿 ⇒ 这条退化抓不住）')
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
fs.rmSync(base, { recursive: true, force: true })
console.log('\n变异 ' + MUTANTS.length + ' 条 ⇒ 抓到 ' + caught + ' / 漏网 ' + leaked + ' / 崩红 ' + crashed + ' / 误伤 ' + falseRed)
process.exit(leaked || crashed || falseRed ? 1 : 0)
