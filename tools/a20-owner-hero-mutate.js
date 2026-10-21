// A-20 变异自证：node tools/a20-owner-hero-mutate.js
// 目的：证明 tools/a20-owner-hero-test.js 的判据真的有牙齿——四条界线各配一条反向变异：
//   ① 取消 owner 收口（泄漏回来）必须红；② 一刀切把组织者也藏掉必须红；
//   ③ 从别的字段反推归属（joined / 数字本身）必须红；④ discover 的 hero 恒真、恒假、
//      反向、口径不 trim 四种走偏都必须红。
// 纪律（本仓库第十/十一轮的教训）：
//   · 沙盒建在 %TEMP%，绝不动真实仓库（结束用 sha256 自证未误伤）；
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
const SANDBOX = path.join(os.tmpdir(), 'a20-mutate-' + Date.now().toString(36))
const TEST_REL = path.join('tools', 'a20-owner-hero-test.js')
const HOME_REL = path.join('miniprogram', 'pages', 'home', 'home.js')
const DISC_REL = path.join('miniprogram', 'pages', 'discover', 'discover.js')

const HOME_ANCHOR = "a.meta.owner ? '待审核 ' + a.meta.pending + ' 人' : '',"
const DISC_ANCHOR = 'featured: !search && filterCount(filters) === 0 && i === 0,'
const CONFIRMED_ANCHOR = "'已确认 ' + a.meta.confirmed + ' 人',"

const MUTATIONS = [
  {
    id: 'O1', file: HOME_REL, desc: '取消 owner 收口（待审核回到无条件拼接）',
    anchor: HOME_ANCHOR, replace: "'待审核 ' + a.meta.pending + ' 人',",
  },
  {
    id: 'O2', file: HOME_REL, desc: '一刀切：连组织者也不给看自己的工作队列',
    anchor: HOME_ANCHOR, replace: "'' /* 减话过度 */,",
  },
  {
    id: 'O3', file: HOME_REL, desc: '从别的字段反推归属（用 joined 当 owner）',
    anchor: HOME_ANCHOR, replace: "a.meta.joined ? '待审核 ' + a.meta.pending + ' 人' : '',",
  },
  {
    id: 'O4', file: HOME_REL, desc: '把数字当归属判据（pending 为真才是组织者）',
    anchor: HOME_ANCHOR, replace: "a.meta.pending ? '待审核 ' + a.meta.pending + ' 人' : '',",
  },
  {
    id: 'O5', file: HOME_REL, desc: '归属对了但印错数字（拿 capacity 冒充 pending）',
    anchor: HOME_ANCHOR, replace: "a.meta.owner ? '待审核 ' + a.meta.capacity + ' 人' : '',",
  },
  {
    id: 'O6', file: HOME_REL, desc: '越界收窄：把「已确认」也按归属藏起来',
    anchor: CONFIRMED_ANCHOR, replace: "'已确认 ' + (a.meta.owner ? a.meta.confirmed : 0) + ' 人',",
  },
  {
    id: 'D1', file: DISC_REL, desc: 'hero 恒真（搜索结果第一条继续被升为精选）',
    anchor: DISC_ANCHOR, replace: 'featured: true,',
  },
  {
    id: 'D2', file: DISC_REL, desc: 'hero 恒假（一刀切，全量列表也不再精选）',
    anchor: DISC_ANCHOR, replace: 'featured: false,',
  },
  {
    id: 'D3', file: DISC_REL, desc: 'hero 反向（只有搜索结果才升 hero）',
    anchor: DISC_ANCHOR, replace: 'featured: !!search && i === 0,',
  },
  {
    id: 'D4', file: DISC_REL, desc: 'hero 口径不 trim（与发往服务端的 search 不同源）',
    anchor: DISC_ANCHOR, replace: "featured: !this.data.search && i === 0,",
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
  // 未误伤基线：在任何注入动作之前先记下真实仓库三个文件的哈希
  const realHashes = {
    [HOME_REL]: sha(path.join(REPO, HOME_REL)),
    [DISC_REL]: sha(path.join(REPO, DISC_REL)),
    [TEST_REL]: sha(path.join(REPO, TEST_REL)),
    [path.join('tools', 'a20-owner-hero-mutate.js')]: sha(path.join(REPO, 'tools', 'a20-owner-hero-mutate.js')),
  }
  if (!SANDBOX.startsWith(path.resolve(os.tmpdir()))) {
    console.error('✗ 沙盒不在临时目录（有误伤真实仓库的风险）：' + SANDBOX)
    process.exit(1)
  }
  console.log('沙盒：' + SANDBOX)
  const pristine = {}
  for (const m of MUTATIONS) pristine[m.file] = fs.readFileSync(path.join(SANDBOX, m.file), 'utf8')

  // ---- 有效性门：未变异必须全绿，否则后面所有读数都没有意义 ----
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
    const lines = r.out.split('\n').filter(l => l.indexOf('✗') === 2 || /^\s*✗/.test(l))
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

  // ---- 未误伤自证：真实仓库的被测文件与两个 a20 脚本必须逐字节未变 ----
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
