// C-11 判据有没有牙齿：tools/b4-c11-busy-selfheal-mutate.js
//
// 做法：把 miniprogram/ 与本套件复制进 %TEMP% 沙盒（真实仓库一条命令都不执行、一个字节都不改），
// 逐条注入「这段代码退回缺陷原状 / 绕过单源」的退化，要求套件报红；仍然全绿 ⇒ 那条判据是假的。
//
// 锚点纪律（本仓库实测过的坑）：
//   ① 锚点在**原文件**里命中恰 1 次；
//   ② 且剥掉行注释后仍命中恰 1 次 —— 只命中在注释里＝注入打在空气上（第十一轮 P7、切片二 S5 的教训），
//      这种一律判「注入失败」并计漏网 + 退出码 1，绝不静默改错行充数；
//   ③ 文件是 CRLF，多行锚点必须按文件自己的 EOL 拼（跨行锚点用 \n 在 CRLF 文件里命中 0 次＝空证）。
//
// 退出码：0 = 每条都被抓到；1 = 有漏网/崩红/注入失败；2 = 前置门（未变异副本全绿）未过。
// 末行四数闭合：抓到 + 漏网 + 崩红 + 注入失败 === 变异总数；误伤单独必须为 0。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITE = 'b4-c11-busy-selfheal-test.js'
const WATCH = [
  'miniprogram/pages/signup/signup.js',
  'miniprogram/pages/editor/editor.js',
  'miniprogram/pages/route-edit/route-edit.js',
  'miniprogram/pages/me/me.js',
  'miniprogram/utils/journey.js',
  'miniprogram/components/field-panel/field-panel.js',
]

// 沙盒：仓库外的临时目录；绝不在 ROOT 里写任何文件
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'b4c11-mut-'))
fs.mkdirSync(path.join(DIR, 'tools'), { recursive: true })
fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(DIR, 'miniprogram'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'tools', SUITE), path.join(DIR, 'tools', SUITE))

const digest = () => WATCH.map(rel => {
  const p = path.join(ROOT, rel)
  return rel + ':' + fs.readFileSync(p).length + ':' + fs.readFileSync(p).toString('base64').slice(0, 24)
}).join('|')
const REPO_BEFORE = digest()

const eolOf = rel => {
  const src = fs.readFileSync(path.join(DIR, rel), 'utf8')
  return { src, eol: src.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }
}
const stripComments = (src, eol) => src.split(eol).map(l => {
  const i = l.indexOf('//')
  return i >= 0 ? l.slice(0, i) : l
}).join(eol)

function inject(rel, fromLines, toLines) {
  const { src, eol } = eolOf(rel)
  const from = fromLines.join(eol)
  const to = toLines.join(eol)
  const hits = src.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + rel + ' 里命中 ' + hits + ' 次（要求恰 1）：' + from.slice(0, 52))
  const codeHits = stripComments(src, eol).split(from).length - 1
  if (codeHits !== 1) throw new Error('锚点剥掉注释后命中 ' + codeHits + ' 次（要求恰 1）＝打在空气上：' + rel)
  fs.writeFileSync(path.join(DIR, rel), src.split(from).join(to))
}

function runSuite() {
  const r = cp.spawnSync(process.execPath, [path.join(DIR, 'tools', SUITE)], { cwd: DIR, encoding: 'utf8' })
  const out = String(r.stdout || '') + String(r.stderr || '')
  const ledger = out.match(/passed=\d+ failed=\d+/)
  const reds = out.split('\n').filter(l => l.trim().slice(0, 1) === '✗').map(l => l.trim())
  return { status: r.status, hasLedger: !!ledger, ledger: ledger && ledger[0], reds, out }
}

// ---- 前置门：未变异的沙盒副本必须全绿，否则后面每一条红都可能是环境噪音 ----
const base = runSuite()
if (base.status !== 0 || !base.hasLedger) {
  console.error('前置门未过：未变异副本就不是全绿（exit=' + base.status + ' ' + (base.ledger || '无账本') + '）')
  base.reds.slice(0, 5).forEach(l => console.error('  ' + l))
  console.log('抓到=0 漏网=0 崩红=0 误伤=0 变异总数=0（前置门未过，本轮无效）')
  process.exit(2)
}
console.log('前置门通过：未变异沙盒副本 ' + base.ledger + '（证明下面每条红都是变异造成的）')

const SIG = '    if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {'
const MUTANTS = [
  ['M1 去掉一处 busyAt 写入（回到"有 busy 无 busyAt"＝完全没有自愈）',
    'miniprogram/pages/signup/signup.js',
    ['    this.setData({ busy: true, busyAt: Date.now() })', '    api.dispatchAndSync(payload, this.revision, this)'],
    ['    this.setData({ busy: true })', '    api.dispatchAndSync(payload, this.revision, this)']],
  ['M2 求值点退回裸 busy 门（残留永不自愈＝C-11 原状）',
    'miniprogram/pages/signup/signup.js',
    ['  submit(mode) {', '    if (this.busyBlocks()) return'],
    ['  submit(mode) {', '    if (this.data.busy) return']],
  ['M3 绕过单源：页面自己写 8000 + 自己算时间差（行为等价，只有单源门抓得住）',
    'miniprogram/pages/editor/editor.js',
    [SIG],
    ['    if (this.data.busy && (Date.now() - this.data.busyAt) > 8000) {']],
  ['M4 把复位从 .catch 摘掉（失败路径把界面永久留在「正在…」）',
    'miniprogram/pages/editor/editor.js',
    ["        wx.redirectTo({ url: '/pages/activity/activity?id=' + this.savedId })", '      })',
      '      .catch(e => this.setData({ busy: false, failure: api.errorText(e) }))'],
    ["        wx.redirectTo({ url: '/pages/activity/activity?id=' + this.savedId })", '      })',
      '      .catch(e => this.setData({ failure: api.errorText(e) }))']],
  ['M5 doPublish 不置忙（回到连点两次发两条 activity.publish）',
    'miniprogram/pages/editor/editor.js',
    ["    this.setData({ busy: true, busyAt: Date.now(), failure: '' })",
      "    api.dispatchAndSync({ type: 'activity.publish', activityId: this.savedId, participation }, revision, this)"],
    ["    api.dispatchAndSync({ type: 'activity.publish', activityId: this.savedId, participation }, revision, this)"]],
  ['M6 删掉 data 里的 busyAt 声明（首次置忙前读不到时间戳）',
    'miniprogram/pages/route-edit/route-edit.js',
    ['    busyAt: 0,', "    failure: '',"],
    ["    failure: '',"]],
  ['M7 撤回 me 面一处成对置忙（onRevoke 回到"直接发命令"）',
    'miniprogram/pages/me/me.js',
    ['    this.setData({ busy: true, busyAt: Date.now() })',
      "    api.dispatchAndSync({ type: 'position.revoke', activityId, signupId }, this.revision, this)"],
    ["    api.dispatchAndSync({ type: 'position.revoke', activityId, signupId }, this.revision, this)"]],
  ['M8 单源判据恒"不残留"（等于把自愈关掉）',
    'miniprogram/utils/journey.js',
    ['  return (nowMs || Date.now()) - busyAt > BUSY_LIMIT_MS'],
    ['  return false']],
  ['M9 单源判据恒"残留"（一刀切放行在飞的写＝重复提交）',
    'miniprogram/utils/journey.js',
    ['  return (nowMs || Date.now()) - busyAt > BUSY_LIMIT_MS'],
    ['  return true']],
  ['M10 顺手改掉一个已覆盖面（field-panel 不再消费单源判据）',
    'miniprogram/components/field-panel/field-panel.js',
    [SIG],
    ['    if (this.data.busy && (Date.now() - this.data.busyAt > 8000)) {']],
]

let caught = 0
let missed = 0
let crashed = 0
let brokenInjection = 0
const details = []

MUTANTS.forEach(([name, rel, from, to], idx) => {
  const backup = fs.readFileSync(path.join(DIR, rel))
  try {
    inject(rel, from, to)
  } catch (e) {
    brokenInjection++
    details.push('⚠ ' + name + ' ⇒ 注入失败：' + e.message)
    console.log('⚠ [' + (idx + 1) + '/' + MUTANTS.length + '] ' + name)
    console.log('    注入失败（计漏网，不静默改错行充数）：' + e.message)
    return
  }
  const r = runSuite()
  fs.writeFileSync(path.join(DIR, rel), backup)
  let verdict
  if (r.status === 0) { verdict = '漏网'; missed++ }
  else if (!r.hasLedger || r.status > 1) { verdict = '崩红'; crashed++ }
  else { verdict = '抓到'; caught++ }
  console.log(verdict + ' [' + (idx + 1) + '/' + MUTANTS.length + '] ' + name)
  if (verdict !== '漏网') {
    (r.reds || []).slice(0, 3).forEach(l => console.log('    ' + l.slice(0, 120)))
    if (!r.hasLedger) console.log('    （无账本输出＝套件崩溃，不算抓到）' + String(r.out).split('\n').slice(0, 2).join(' / ').slice(0, 120))
  } else {
    console.log('    仍然 ' + (r.ledger || '无账本'))
  }
  details.push(verdict + ' · ' + name)
})

const 误伤 = REPO_BEFORE === digest() ? 0 : 1
if (误伤) console.error('误伤：变异过程改动了真实仓库文件！')

console.log('明细：')
details.forEach(d => console.log('  ' + d))
fs.rmSync(DIR, { recursive: true, force: true })

const total = MUTANTS.length
const sum = caught + missed + crashed + brokenInjection
console.log('抓到=' + caught + ' 漏网=' + missed + ' 崩红=' + crashed + ' 误伤=' + 误伤 +
  ' 注入失败=' + brokenInjection + ' 变异总数=' + total + ' 闭合=' + (sum === total))
process.exit(caught === total && 误伤 === 0 && sum === total ? 0 : 1)
