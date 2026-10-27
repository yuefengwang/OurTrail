/* F4 阶段一（结论项 `at` 锚点）的变异自证
 *
 * 对拍（ab-f4-anchor.js）证明"改前 vs 改后"的差异落在允许清单内；本脚本反过来问：
 * 把 F4 阶段一的每一条判据分别拆掉，门**必须**红。全绿 = 门是假的。
 *
 * 约定（沿用 C2 的变异框架）：
 *   ① 先跑未变异副本：sky-test / weather-v2-test / weather-page-test 必须全绿——
 *      否则后面的红都不是变异造成的（exit 2，不是通过）；
 *   ② 每个锚点必须**恰好命中一次**；0 次或多次都算注入失败，计漏网并 exit 1；
 *   ③ 每条变异只跑能抓住它的那个套件，跑不红就是漏网，打印该变异下套件的原始尾巴便于归因；
 *   ④ 临时副本在 os.tmpdir，跑完即删。
 *
 * 运行：node tools/mutate-f4-anchor.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')
const SUITES = {
  sky: 'sky-test.js',
  v2: 'weather-v2-test.js',
  page: 'weather-page-test.js',
}

const MUTATIONS = [
  {
    id: 'M1',
    name: '星空不写 at（结论项新增字段缺失）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: "  const at = night.length ? (night[0].d || date) + 'T' + night[0].t : ''",
    to: "  const at = ''",
  },
  {
    id: 'M2',
    name: '银河不写 at（算完 best 不覆盖）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  item.at = (best.h.d || date) + \'T\' + best.h.t',
    to: '  item.at = \'\'',
  },
  {
    id: 'M3',
    name: 'factsFor 无视 item.at（跨夜仍用 dusk 锚点）',
    file: 'utils/conditions.js',
    suite: 'sky',
    from: '    const crossNight = !!date && AT_FULL_RE.test(itemAt) && itemAt.slice(0, 10) !== date && hasNightCtx',
    to: '    const crossNight = false',
  },
  {
    id: 'M4',
    name: 'factsFor 对同日 at 也替换（破坏非跨夜阳性对照）',
    file: 'utils/conditions.js',
    suite: 'sky',
    from: '    const crossNight = !!date && AT_FULL_RE.test(itemAt) && itemAt.slice(0, 10) !== date && hasNightCtx',
    to: '    const crossNight = !!date && AT_FULL_RE.test(itemAt) && hasNightCtx',
  },
  {
    id: 'M5',
    name: '跨夜仍输出 HH:mm（证据行 at 不换完整日期）',
    file: 'utils/conditions.js',
    suite: 'sky',
    from: '    const rowAt = crossNight ? itemAt : anchor',
    to: '    const rowAt = anchor',
  },
  {
    id: 'M6',
    name: 'galaxy.at 用 night[0] 而非 best（锚点回到入夜第一小时）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  item.at = (best.h.d || date) + \'T\' + best.h.t',
    to: "  item.at = night.length ? (night[0].d || date) + 'T' + night[0].t : ''",
  },
  {
    id: 'M7',
    name: '看图去掉完整日期键匹配（跨夜跳回当日同小时）',
    file: 'pages/weather/weather.js',
    suite: 'page',
    from: "    const h = view.find(x => (x.d + 'T' + x.t) === at)\n"
      + '      || view.find(x => x.t === at)\n'
      + '      || fallback',
    to: "    const h = view.find(x => x.t === at)\n"
      + '      || fallback',
  },
  {
    id: 'M8',
    name: 'atmosphere 时间仍用 date + dusk 小时（读到错误日期的气溶胶）',
    file: 'utils/conditions.js',
    suite: 'sky',
    from: '    const atmosphereTime = crossNight ? itemAt : date + \'T\' + anchor',
    to: '    const atmosphereTime = date + \'T\' + anchor',
  },
  {
    id: 'M9',
    name: '看图去掉 HH:mm 回落（旧锚点查不到就退首列）',
    file: 'pages/weather/weather.js',
    suite: 'page',
    from: '    const h = view.find(x => (x.d + \'T\' + x.t) === at)\n'
      + '      || view.find(x => x.t === at)\n'
      + '      || fallback',
    to: '    const h = view.find(x => (x.d + \'T\' + x.t) === at)\n'
      + '      || fallback',
  },
  {
    id: 'M10',
    name: '页面不把结论项传给 factsFor（银河证据退回 dusk 锚点）',
    file: 'pages/weather/weather.js',
    suite: 'page',
    from: '        evidence: cond.factsFor(it.key, Object.assign({}, ctx, { item: it })),',
    to: '        evidence: cond.factsFor(it.key, ctx),',
  },
  {
    id: 'M11',
    name: '24h 视图跨夜锚点退回首列（最远列冒充最近可见列）',
    file: 'pages/weather/weather.js',
    suite: 'page',
    from: '    const fallback = targetDay && view.length && targetDay > view[0].d\n'
      + '      ? view[view.length - 1]\n'
      + '      : view[0]',
    to: '    const fallback = view[0]',
  },
  {
    id: 'M12',
    name: '跨夜判据不要求所选日非空（date="" 时凭空判定跨夜）',
    file: 'utils/conditions.js',
    suite: 'sky',
    from: '    const crossNight = !!date && AT_FULL_RE.test(itemAt) && itemAt.slice(0, 10) !== date && hasNightCtx',
    to: '    const crossNight = AT_FULL_RE.test(itemAt) && itemAt.slice(0, 10) !== date && hasNightCtx',
  },
  {
    id: 'M13',
    name: '云海不写 at（六项字段契约漏一项）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const atHour = list[0] || listAll[0]',
    to: '  const atHour = null',
  },
]

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-f4-mut-'))
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
  /* 仓库文件是 CRLF；锚点按可读的多行写，匹配前统一成 LF（只影响临时副本） */
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
