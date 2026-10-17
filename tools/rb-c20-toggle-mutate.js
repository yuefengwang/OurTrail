// R-B 判据有没有牙齿：tools/rb-c20-toggle-mutate.js
//
// 覆盖两条门：tools/rb-vehicle-dependency-test.js（C-20 车辆下拉的两读依赖）
//            tools/rb-toggle-guard-test.js（onToggleGroup 的在途守卫）。
//
// 做法：把 miniprogram/ 与这两套复制进 %TEMP% 沙盒（真实仓库一个字节都不改），
// 逐条注入「这段代码退回缺陷原状 / 绕过单源」的退化，要求至少一套报红；仍然全绿 ⇒ 那条判据是假的。
//
// 锚点纪律（本仓库实测过的坑，铁律 32⑥/34⑥）：
//   ① 锚点在**原文件**里命中恰 1 次；
//   ② 剥掉行注释后仍命中恰 1 次 —— 只命中在注释里＝注入打在空气上，判「注入失败」并计漏网 + 退出码 1；
//   ③ 文件是 CRLF，多行锚点按文件自己的 EOL 拼（跨行锚点用 \n 在 CRLF 文件里命中 0 次＝空证）；
//   ④ 注入完立刻 node --check：打错语法会让套件「崩红」而不是「抓到」，那不算牙齿。
//
// 等价变异体不塞进来充数（铁律 32④）：把 loadAccess 的 Promise.all 换成 .then 链，
// 在「候选装配点已搬到那条读落地处」之后是行为等价的（用户可见读数一项不变），
// 因此不作为变异注入 —— 报了也不是牙齿。
//
// 退出码：0 = 每条都被抓到；1 = 有漏网/崩红/注入失败；2 = 前置门（未变异副本全绿）未过。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SUITES = ['rb-vehicle-dependency-test.js', 'rb-toggle-guard-test.js']
const WATCH = [
  'miniprogram/components/roster-panel/roster-panel.js',
  'miniprogram/components/roster-panel/roster-panel.wxml',
  'tools/rb-vehicle-dependency-test.js',
  'tools/rb-toggle-guard-test.js',
]

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-c20-mut-'))
fs.mkdirSync(path.join(DIR, 'tools'), { recursive: true })
fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(DIR, 'miniprogram'), { recursive: true })
SUITES.forEach(s => fs.copyFileSync(path.join(ROOT, 'tools', s), path.join(DIR, 'tools', s)))

const digest = () => WATCH.map(rel => {
  const b = fs.readFileSync(path.join(ROOT, rel))
  return rel + ':' + b.length + ':' + b.toString('base64').slice(0, 24)
}).join('|')
const REPO_BEFORE = digest()

const eolOf = rel => {
  const src = fs.readFileSync(path.join(DIR, rel), 'utf8')
  return { src, eol: src.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }
}
const stripLineComments = (src, eol) => src.split(eol).map(l => {
  const i = l.indexOf('//')
  return i >= 0 ? l.slice(0, i) : l
}).join(eol)

function injectOne(rel, fromLines, toLines) {
  const { src, eol } = eolOf(rel)
  const from = fromLines.join(eol)
  const to = toLines.join(eol)
  const hits = src.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + rel + ' 里命中 ' + hits + ' 次（要求恰 1）：' + from.slice(0, 60))
  const codeHits = stripLineComments(src, eol).split(from).length - 1
  if (codeHits !== 1) throw new Error('锚点剥掉行注释后命中 ' + codeHits + ' 次（要求恰 1）＝打在空气上：' + rel + ' :: ' + from.slice(0, 60))
  fs.writeFileSync(path.join(DIR, rel), src.split(from).join(to))
  if (rel.slice(-3) === '.js') {
    const chk = cp.spawnSync(process.execPath, ['--check', path.join(DIR, rel)], { encoding: 'utf8' })
    if (chk.status !== 0) throw new Error('注入后语法不通（那是崩红不是抓到）：' + String(chk.stderr || '').split('\n').slice(0, 2).join(' / '))
  }
}
// 一个变异可以含多处注入（例如「搬家回去」要同时改装配点与消费点）；任一步失败就整体回滚。
function inject(steps) {
  const done = []
  try {
    steps.forEach(s => { injectOne(s[0], s[1], s[2]); done.push(s[0]) })
  } catch (e) {
    done.forEach(rel => fs.writeFileSync(path.join(DIR, rel), fs.readFileSync(path.join(ROOT, rel))))
    throw e
  }
}

function runSuites() {
  const results = SUITES.map(s => {
    const r = cp.spawnSync(process.execPath, [path.join(DIR, 'tools', s)], { cwd: DIR, encoding: 'utf8' })
    const out = String(r.stdout || '') + String(r.stderr || '')
    const ledger = out.match(/passed=\d+ failed=\d+/)
    const reds = out.split('\n').filter(l => l.trim().slice(0, 1) === '✗').map(l => l.trim())
    return { s, status: r.status, hasLedger: !!ledger, ledger: ledger && ledger[0], reds }
  })
  const crashed = results.filter(x => x.status > 1 || (x.status !== 0 && !x.hasLedger))
  const red = results.filter(x => x.status !== 0)
  return { ok: red.length === 0, crashed, red, results }
}

// ---- 前置门：未变异的沙盒副本两套都必须全绿，否则后面每条红都可能是环境噪音 ----
const base = runSuites()
if (!base.ok || base.crashed.length) {
  console.error('前置门未过：未变异副本就不是全绿')
  base.results.forEach(x => console.error('  ' + x.s + ' exit=' + x.status + ' ' + (x.ledger || '无账本')))
  base.red.forEach(x => x.reds.slice(0, 4).forEach(l => console.error('    ' + l)))
  console.log('抓到=0 漏网=0 崩红=0 误伤=0 注入失败=0 变异总数=0 闭合=true（前置门未过，本轮无效）')
  process.exit(2)
}
base.results.forEach(x => console.log('前置门通过：' + x.s + ' ' + x.ledger))

const RJS = 'miniprogram/components/roster-panel/roster-panel.js'
const RWX = 'miniprogram/components/roster-panel/roster-panel.wxml'

const MUTANTS = [
  ['V1 把候选装配搬回 loadAccess、来源改回「另一条并发读写进 data 的值」（C-20 原状）', [
    [RJS,
      ['        this.applyVehicles(\'ready\', vehicles)'],
      ['        this._transportVehicles = vehicles', '        this.setData({ transportVehicles: vehicles })']],
    [RJS,
      ["        this.setData({ memberships, accessError: '' })"],
      ['        const vs = (this.data.transportVehicles || []).map(v => v.label)',
        '        this.transportVehicleIds = (this.data.transportVehicles || []).map(v => v.id)',
        "        this.setData({ memberships, vehicles: vs, accessError: '' })"]],
  ]],
  ['V2 打开弹层再补一次 read（禁止①：造出第二条读）', [
    [RJS,
      ['      if (this._transportRead) return this._transportRead',
        "      if (this._vehicleState === 'ready') return Promise.resolve({ ok: true, vehicles: this._transportVehicles || [] })"],
      ["      if (this._vehicleState === 'ready') return Promise.resolve({ ok: true, vehicles: this._transportVehicles || [] })"]],
  ]],
  ['V3 保存话术退回一句「先在分车里添加车辆」（禁止②：读故障被指路成补数据）', [
    [RJS,
      ["      if (this.data.vehicleLoading) return '车辆列表正在读取，请等它读完再保存。'",
        "      if (this.data.vehicleFailed) return '车辆列表这次没有读到——这不代表这场活动没有车辆，请点「重新读取车辆列表」后再保存。'",
        "      if (this.data.vehicleEmpty) return '这场活动还没有车辆：请先在分车区添加车辆，再把车辆联络授权给车长。'"],
      ["      if (this.data.vehicleIndex < 0 || !this.transportVehicleIds) return '请选择负责车辆（先在分车里添加车辆）。'"]],
  ]],
  ['V4 catch 里把「读失败」当「空态」装配（读故障≠空态那条被抹掉）', [
    [RJS,
      ["        this.applyVehicles('failed', null)"],
      ["        this.applyVehicles('ready', [])"]],
  ]],
  ['V5 空态判据不看状态只看长度（在飞/失败时也会报「确实没有车辆」）', [
    [RJS,
      ['        vehicleEmpty: state === \'ready\' && !vehicles.length,'],
      ['        vehicleEmpty: !vehicles.length,']],
  ]],
  ['V6 话术分岔改成「先看列表长度」（在飞期间就把人指去分车区）', [
    [RJS,
      ['    vehicleBlockReason() {',
        "      if (this.data.vehicleLoading) return '车辆列表正在读取，请等它读完再保存。'"],
      ['    vehicleBlockReason() {',
        "      if (!this.data.vehicles.length) return '这场活动还没有车辆：请先在分车区添加车辆，再把车辆联络授权给车长。'",
        "      if (this.data.vehicleLoading) return '车辆列表正在读取，请等它读完再保存。'"]],
  ]],
  ['T1 摘掉在途守卫（回到连点三次发三条 group.setTogether）', [
    [RJS,
      ['      if (this.data.busy) return',
        '      const { id, keep } = e.currentTarget.dataset'],
      ['      const { id, keep } = e.currentTarget.dataset']],
  ]],
  ['T2 不置忙（发得出去，但界面永远没有「正在处理」的姿态）', [
    [RJS,
      ["      this.setData({ busy: true, busyAt: Date.now(), error: '' })",
        "      api.dispatchAndSync({ type: 'group.setTogether', activityId: this.data.activityId, groupId: id, keepTogether: !keep }, this.revision, this)"],
      ["      api.dispatchAndSync({ type: 'group.setTogether', activityId: this.data.activityId, groupId: id, keepTogether: !keep }, this.revision, this)"]],
  ]],
  ['T3 摘掉残留自愈（promise 不回来就永久锁死这个入口）', [
    [RJS,
      ['      if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {',
        '        this.setData({ busy: false, busyAt: 0 })',
        "        console.warn('[busy] 同行组约束：清掉一个超过宽限期没落地的写状态，本次操作照常放行')",
        '      }',
        '      if (this.data.busy) return'],
      ['      if (this.data.busy) return']],
  ]],
  ['T4 .catch 不复位 busy（失败路径把面板永久留在「正在处理」）', [
    [RJS,
      ['      .catch(err => this.setData({ busy: false, busyAt: 0, error: api.errorText(err) }))'],
      ['      .catch(err => this.setData({ error: api.errorText(err) }))']],
  ]],
  ['T5 .then 只复位 busy 不归零 busyAt（成对置位被拆成半对）', [
    [RJS,
      ["          this.setData({ busy: false, busyAt: 0 })",
        "          api.toast('同行组约束已保存')"],
      ["          this.setData({ busy: false })",
        "          api.toast('同行组约束已保存')"]],
  ]],
  ['T6 模板侧把在途禁用表达摘掉（点得动，靠 JS 挡＝点了没反应）', [
    [RWX,
      ["bindtap=\"{{busy ? '' : 'onToggleGroup'}}\""],
      ['bindtap="onToggleGroup"']],
  ]],
  ['T7 宽限判据恒「残留」（一刀切放行在飞的写＝重复提交，方向 B 的反面）', [
    [RJS,
      ['      if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {',
        '        this.setData({ busy: false, busyAt: 0 })',
        "        console.warn('[busy] 同行组约束：清掉一个超过宽限期没落地的写状态，本次操作照常放行')"],
      ['      if (this.data.busy) {',
        '        this.setData({ busy: false, busyAt: 0 })',
        "        console.warn('[busy] 同行组约束：清掉一个超过宽限期没落地的写状态，本次操作照常放行')"]],
  ]],
]

let caught = 0
let missed = 0
let crashed = 0
let brokenInjection = 0
const details = []

MUTANTS.forEach(([name, steps], idx) => {
  const backups = {}
  steps.forEach(s => { backups[s[0]] = fs.readFileSync(path.join(DIR, s[0])) })
  console.log('⚠ [' + (idx + 1) + '/' + MUTANTS.length + '] ' + name)
  try {
    inject(steps)
  } catch (e) {
    brokenInjection++
    missed++
    details.push('⚠ 注入失败（计漏网）· ' + name)
    console.log('    注入失败（计漏网，不静默改错行充数）：' + e.message)
    Object.keys(backups).forEach(rel => fs.writeFileSync(path.join(DIR, rel), backups[rel]))
    return
  }
  const r = runSuites()
  Object.keys(backups).forEach(rel => fs.writeFileSync(path.join(DIR, rel), backups[rel]))
  let verdict
  if (r.crashed.length) {
    verdict = '崩红'
    crashed++
    r.crashed.forEach(x => console.log('    崩红：' + x.s + ' exit=' + x.status + ' ' + (x.ledger || '无账本')))
  } else if (!r.ok) {
    verdict = '抓到'
    caught++
    r.red.forEach(x => {
      console.log('    抓到：' + x.s + ' ' + x.ledger)
      x.reds.slice(0, 2).forEach(l => console.log('      ' + l.slice(0, 130)))
    })
  } else {
    verdict = '漏网'
    missed++
    console.log('    仍然 ' + r.results.map(x => x.s + ' ' + x.ledger).join(' ｜ '))
  }
  details.push(verdict + ' · ' + name)
})

const 误伤 = REPO_BEFORE === digest() ? 0 : 1
if (误伤) console.error('误伤：变异过程改动了真实仓库文件！')

console.log('明细：')
details.forEach(d => console.log('  ' + d))
fs.rmSync(DIR, { recursive: true, force: true })

const total = MUTANTS.length
const sum = caught + missed + crashed
console.log('抓到=' + caught + ' 漏网=' + missed + ' 崩红=' + crashed + ' 误伤=' + 误伤 +
  ' 注入失败=' + brokenInjection + '（已计入漏网）变异总数=' + total + ' 闭合=' + (sum === total))
process.exit(caught === total && 误伤 === 0 && sum === total ? 0 : 1)
