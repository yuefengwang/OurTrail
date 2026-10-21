// 首页协作入口变异自证：node tools/home-collab-list-mutate.js
// 目的：证明 tools/home-collab-list-test.js 的九条界线各有牙齿——每条变异都是「这个判据被写坏」
//   的一种真实走偏（搬整张列表 / 计数跟视图 / staff 吞 vehicle / 失败开放 / 终态漏收 /
//   一刀切永不出入口 / 词面量回页面 / URL 出页面），要求每条都被判据报红。
// 纪律（本仓库第十/十一/十二轮的教训，与 tools/a20-owner-hero-mutate.js 同源）：
//   · 沙盒建在 %TEMP%，绝不动真实仓库（末了用 sha256 自证未误伤）；
//   · 锚点命中**恰好 1 次**且落在真实代码行（命中 0/多次/只剩注释 ⇒ 判注入失败，计漏网并 exit 1，
//     不静默改错行充数）；单行锚点——跨行锚点在 CRLF 文件里会命中 0 次；
//   · 先跑「未变异副本全绿」的有效性门，否则整批读数无意义；
//   · 崩溃单独记 崩红，不算抓到；末行四数与变异总数闭合。
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')
const crypto = require('crypto')

const REPO = path.resolve(__dirname, '..')
const SANDBOX = path.join(os.tmpdir(), 'home-collab-mutate-' + Date.now().toString(36))
const TEST_REL = path.join('tools', 'home-collab-list-test.js')
const HOME_REL = path.join('miniprogram', 'pages', 'home', 'home.js')
const JOURNEY_REL = path.join('miniprogram', 'utils', 'journey.js')

const COLLAB_LINE = "  if (m.staff) roles.push({ key: 'staff', label: COLLAB_ROLE_LABELS.staff })"
const VEHICLE_LINE = "  if (m.vehicle) roles.push({ key: 'vehicle', label: COLLAB_ROLE_LABELS.vehicle })"
const STAFF_NAV = "    if (e.detail.key === 'staff') wx.navigateTo({ url: '/pages/staff/staff?id=' + id })"
const COLLAB_FIELD = '        collab: roles,'

const MUTATIONS = [
  {
    id: 'C1', file: HOME_REL, desc: '第四档不筛授权，把整张非终态列表搬过来换个标签',
    anchor: "      else if (filter === 'collab') inScope = isCollab(a)",
    replace: "      else if (filter === 'collab') inScope = !ended",
  },
  {
    id: 'C2', file: HOME_REL, desc: '计数跟着当前视图算（选中第四档那一刻它自己变成 0）',
    anchor: "    const collabCount = all.filter(isCollab).length",
    replace: "    const collabCount = filter === 'collab' ? all.filter(isCollab).length : 0",
  },
  {
    id: 'C3', file: JOURNEY_REL, desc: 'staff 吃掉 vehicle（复刻旧 goStaff 二选一，双角色再也进不去车辆页）',
    anchor: VEHICLE_LINE,
    replace: "  if (m.vehicle && !m.staff) roles.push({ key: 'vehicle', label: COLLAB_ROLE_LABELS.vehicle })",
  },
  {
    id: 'C4', file: HOME_REL, desc: '两枚入口都跳 staff 页（跳转没按 key 分岔）',
    anchor: STAFF_NAV,
    replace: "    if (e.detail.key === 'staff' || e.detail.key === 'vehicle') wx.navigateTo({ url: '/pages/staff/staff?id=' + id })",
  },
  {
    id: 'C5', file: JOURNEY_REL, desc: '投影缺位当有授权（失败开放 ⇒ 给没有权限的人画出入口）',
    anchor: COLLAB_LINE,
    replace: "  if (m.staff !== false) roles.push({ key: 'staff', label: COLLAB_ROLE_LABELS.staff })",
  },
  {
    id: 'C6', file: HOME_REL, desc: '终态活动不再收入口（已归档的活动还挂着「去车辆联络」）',
    anchor: "    const isCollab = a => ['archived', 'cancelled'].indexOf(a.phase) === -1 && (a.meta.staff || a.meta.vehicle)",
    replace: '    const isCollab = a => !!(a.meta.staff || a.meta.vehicle)',
  },
  {
    id: 'C7', file: HOME_REL, desc: '一刀切永不出入口（判据被换成恒空，肉眼看不出与 C3 相反）',
    anchor: COLLAB_FIELD,
    replace: '        collab: [],',
  },
  {
    id: 'C8', file: HOME_REL, desc: '角色词字面量被搬回页面（词表单源失守）',
    anchor: COLLAB_FIELD,
    replace: "        collab: roles.map(r => ({ key: r.key, label: r.key === 'staff' ? '现场协作' : '车辆联络' })),",
  },
  {
    id: 'C9', file: HOME_REL, desc: '入口 URL 被拼出来搬出页面（journey-graph 的静态边扫描就看不见这两页）',
    anchor: STAFF_NAV,
    replace: "    if (e.detail.key === 'staff') wx.navigateTo({ url: '/pages/' + e.detail.key + '/index?id=' + id })",
  },
]

let caught = 0
let missed = 0
let crashed = 0
let collateral = 0

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
}
function countHits(text, needle) {
  let n = 0
  let i = text.indexOf(needle)
  while (i !== -1) { n++; i = text.indexOf(needle, i + needle.length) }
  return n
}
// 锚点必须落在真实代码行：取锚点起点所在那一行，去掉行首空白后不得是注释
function anchorOnCodeLine(text, needle) {
  const i = text.indexOf(needle)
  if (i === -1) return false
  const lineStart = text.lastIndexOf('\n', i) + 1
  const line = text.slice(lineStart, i)
  return !/^\s*(\/\/|\*|\/\*)/.test(line)
}
function runTest() {
  const r = cp.spawnSync(process.execPath, [path.join(SANDBOX, TEST_REL)], {
    cwd: SANDBOX, encoding: 'utf8', timeout: 60000,
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), spawnError: r.error }
}

function buildSandbox() {
  fs.mkdirSync(SANDBOX, { recursive: true })
  fs.cpSync(path.join(REPO, 'miniprogram'), path.join(SANDBOX, 'miniprogram'), {
    recursive: true,
    filter: src => !/[\\/]assets[\\/]/.test(src),
  })
  fs.mkdirSync(path.join(SANDBOX, 'tools'), { recursive: true })
  fs.copyFileSync(path.join(REPO, TEST_REL), path.join(SANDBOX, TEST_REL))
}

function restore(file, text) {
  fs.writeFileSync(file, text, 'utf8')
}

function main() {
  const realHashes = {}
  for (const f of [HOME_REL, JOURNEY_REL, TEST_REL, path.join('tools', 'home-collab-list-mutate.js')]) {
    realHashes[f] = sha(path.join(REPO, f))
  }
  if (!SANDBOX.startsWith(path.resolve(os.tmpdir()))) {
    console.error('✗ 沙盒不在临时目录（有误伤真实仓库的风险）：' + SANDBOX)
    process.exit(1)
  }
  console.log('沙盒：' + SANDBOX)
  const pristine = {}
  for (const m of MUTATIONS) pristine[m.file] = fs.readFileSync(path.join(SANDBOX, m.file), 'utf8')

  const base = runTest()
  const basePassed = /passed=(\d+) failed=(\d+)/.exec(base.out)
  if (base.spawnError || base.code !== 0 || !basePassed || Number(basePassed[2]) !== 0) {
    console.error('✗ 有效性门未过（未变异副本就不是全绿），本批变异读数全部作废')
    console.error(base.out.slice(-800))
    process.exit(1)
  }
  console.log('有效性门：未变异 passed=' + basePassed[1] + ' failed=0 —— 以下读数有效')

  for (const m of MUTATIONS) {
    const target = path.join(SANDBOX, m.file)
    const text = pristine[m.file]
    const hits = countHits(text, m.anchor)
    if (hits !== 1) {
      missed++
      console.log('  ' + m.id + ' 注入失败：锚点命中 ' + hits + ' 次（要求恰好 1 次）→ 计漏网，不静默改错行充数')
      continue
    }
    if (!anchorOnCodeLine(text, m.anchor)) {
      missed++
      console.log('  ' + m.id + ' 注入失败：锚点落在注释行 → 计漏网')
      continue
    }
    const mutated = text.replace(m.anchor, m.replace)
    if (mutated === text) {
      missed++
      console.log('  ' + m.id + ' 注入失败：替换后文本无变化（等价变异/锚点写错）→ 计漏网')
      continue
    }
    restore(target, mutated)
    const chk = cp.spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' })
    if (chk.status !== 0) {
      restore(target, text)
      crashed++
      console.log('  ' + m.id + ' 崩红：变异副本语法不通过（' + String(chk.stderr).split('\n')[0] + '）——不算抓到')
      continue
    }
    const r = runTest()
    restore(target, text)
    if (r.spawnError) {
      crashed++
      console.log('  ' + m.id + ' 崩红：子进程异常（' + r.spawnError.message + '）——不算抓到')
      continue
    }
    const parsed = /passed=(\d+) failed=(\d+)/.exec(r.out)
    const threw = /用例执行异常/.test(r.out)
    const lines = r.out.split('\n').filter(l => /^\s*✗/.test(l))
    if (threw || !parsed) {
      crashed++
      console.log('  ' + m.id + ' 崩红：判据进程崩溃而非断言红 ——' + (lines[0] || '').trim() + '（不算抓到）')
      continue
    }
    if (Number(parsed[2]) > 0) {
      caught++
      console.log('  ' + m.id + ' 抓到（failed=' + parsed[2] + '）：' + m.desc)
      for (const l of lines.slice(0, 2)) console.log('        ' + l.trim())
    } else {
      missed++
      console.log('  ' + m.id + ' 漏网（判据全绿）：' + m.desc)
    }
  }

  for (const f of Object.keys(realHashes)) {
    const now = sha(path.join(REPO, f))
    if (now !== realHashes[f]) {
      collateral++
      console.log('  误伤：真实仓库文件 ' + f + ' 的哈希在本批运行中发生变化')
    }
  }

  const total = MUTATIONS.length
  console.log('\n抓到=' + caught + ' 漏网=' + missed + ' 崩红=' + crashed + ' 误伤=' + collateral)
  console.log('变异总数=' + total + ' 闭合=' + (caught + missed + crashed === total))
  fs.rmSync(SANDBOX, { recursive: true, force: true })
  const ok = missed === 0 && crashed === 0 && collateral === 0 && caught + missed + crashed === total
  process.exit(ok ? 0 : 1)
}

buildSandbox()
main()
