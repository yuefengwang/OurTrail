/* F5（C4：总评 4 星要求 ≥2 个 live 项）的变异自证
 *
 * 对拍（ab-overall.js）证明"改前 vs 改后"的差异落在允许清单内；本脚本反过来问：
 * 把 F5 的四条口径分别拆掉，门**必须**红。全绿 = 门是假的。
 *
 * 约定（沿用 C2–C3 的变异框架）：
 *   ① 先跑未变异副本：weather-v2-test / weather-page-test 必须全绿——
 *      否则后面的红都不是变异造成的（exit 2，不是通过）；
 *   ② 每个锚点必须**恰好命中一次**；0 次或多次都算注入失败，计漏网并 exit 1；
 *   ③ 每条变异只跑能抓住它的套件（本轮 v2 足够抓四条），跑不红就是漏网，
 *      打印该变异下套件的原始尾巴便于归因；
 *   ④ 临时副本在 os.tmpdir，跑完即删。
 *
 * 四条变异：
 *   M1 去掉 cap（单项 90 仍 90）——§6「单项 80 ⇒ 69」应红；
 *   M2 无条件 cap（双项 80 变 69）——阳性对照应红；
 *   M3 用 dedup.length === 1（单项 90 + 非 live 20 不封顶）——计数口径应红；
 *   M4 用 known.length === 1（star+galaxy 不封顶，双计 75）——去重口径应红。
 *
 * 运行：node tools/mutate-overall.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')
const SUITES = {
  v2: 'weather-v2-test.js',
  page: 'weather-page-test.js',
}

const ANCHOR = '  const score = sky.cap69(raw, live.length === 1)'

const MUTATIONS = [
  {
    id: 'M1',
    name: '去掉 cap（单项 90 仍 90）',
    file: 'utils/conditions.js',
    suite: 'v2',
    from: ANCHOR,
    to: '  const score = raw',
  },
  {
    id: 'M2',
    name: '无条件 cap（双项 80 变 69）',
    file: 'utils/conditions.js',
    suite: 'v2',
    from: ANCHOR,
    to: '  const score = sky.cap69(raw, true)',
  },
  {
    id: 'M3',
    name: '用 dedup.length === 1 代替 live.length === 1（单项 90+非 live 20 不封顶）',
    file: 'utils/conditions.js',
    suite: 'v2',
    from: ANCHOR,
    to: '  const score = sky.cap69(raw, dedup.length === 1)',
  },
  {
    id: 'M4',
    name: '用 known.length === 1（star60+galaxy90 两项时不封顶）',
    file: 'utils/conditions.js',
    suite: 'v2',
    from: ANCHOR,
    to: '  const score = sky.cap69(raw, known.length === 1)',
  },
  {
    id: 'M5',
    name: '去掉星空/银河去重（双计 → 75/四星）',
    file: 'utils/conditions.js',
    suite: 'v2',
    from: '  const dedup = known.filter(it => it.key !== \'star\' || !hasGalaxy)',
    to: '  const dedup = known',
  },
  {
    id: 'M6',
    name: 'cap 放在 grade 之后（单项 80/69.6 仍按未封顶的 raw 分档/四星）',
    file: 'utils/conditions.js',
    suite: 'v2',
    from: '  const score = sky.cap69(raw, live.length === 1)\n  const g = sky.grade(score)',
    to: '  const g = sky.grade(raw)\n  const score = sky.cap69(raw, live.length === 1)',
  },
]

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-overall-mut-'))
  fs.cpSync(SRC, path.join(dir, 'miniprogram'), { recursive: true })
  // weather-v2-test / weather-page-test 还直接 require 云函数的 lib/weather（纯解析层），一并复制
  fs.cpSync(path.join(ROOT, 'cloudfunctions/trailApi'), path.join(dir, 'cloudfunctions/trailApi'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools'))
  Object.keys(SUITES).forEach(k => {
    fs.copyFileSync(path.join(ROOT, 'tools', SUITES[k]), path.join(dir, 'tools', SUITES[k]))
  })
  return dir
}

function runSuite(dir, suite) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'tools', SUITES[suite])], {
      cwd: dir, encoding: 'utf8', timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : -1, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

function tail(text, n) {
  return text.trim().split('\n').slice(-n).join('\n')
}

/* ① 有效性门：未变异副本必须全绿 */
console.log('有效性门：未变异副本')
let validity = true
Object.keys(SUITES).forEach(k => {
  const dir = copyTree()
  const r = runSuite(dir, k)
  console.log('  ' + SUITES[k] + ' exit=' + r.code + ' ' + (r.out.match(/passed=\d+ failed=\d+/) || [''])[0])
  if (r.code !== 0) {
    validity = false
    console.log(tail(r.out, 12))
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
if (!validity) {
  console.log('INVALID：未变异副本没有全绿，变异结果无意义')
  process.exit(2)
}

/* ② 逐条变异 */
let escaped = 0
let injected = 0
MUTATIONS.forEach(m => {
  const dir = copyTree()
  const file = path.join(dir, 'miniprogram', m.file)
  /* 仓库文件是 CRLF；锚点按可读形式写，匹配前统一成 LF（只影响临时副本） */
  let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const hits = src.split(m.from).length - 1
  if (hits !== 1) {
    escaped += 1
    console.log('✗ ' + m.id + ' 注入失败：锚点命中 ' + hits + ' 次（应为 1）—— ' + m.name)
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  injected += 1
  fs.writeFileSync(file, src.replace(m.from, m.to))
  const r = runSuite(dir, m.suite)
  if (r.code !== 0) {
    console.log('✓ ' + m.id + ' 被抓住（' + SUITES[m.suite] + ' exit=' + r.code + '）—— ' + m.name)
  } else {
    escaped += 1
    console.log('✗ ' + m.id + ' 漏网 —— ' + m.name)
    console.log(tail(r.out, 8))
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log('\n变异 ' + MUTATIONS.length + ' 条 / 注入成功 ' + injected + ' / 漏网 ' + escaped)
process.exit(escaped ? 1 : 0)
