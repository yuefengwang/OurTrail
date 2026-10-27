/* oi-hour-hit-mutate.js — 对 tools/oi-hour-hit-test.js 做变异自证
 * 规范：沙盒落 %TEMP%（绝不写真实仓库）；锚点命中恰 1 次且必须落在真实代码行（只剩注释 ⇒ 注入失败并计漏网）；
 *       未变异副本先过全绿有效性门；崩溃单列「崩红」不得当抓到；等价控制必须保持全绿，否则计「误伤」。 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const REPO = 'D:/OurTrail'
const REL = 'miniprogram/utils/oi-presentation.js'

function sandbox() {
  const SB = path.join(os.tmpdir(), 'oi-hour-mut-' + Date.now() + '-' + Math.floor(Math.random() * 1e6))
  fs.mkdirSync(SB, { recursive: true })
  for (const d of ['miniprogram', 'tools']) fs.cpSync(path.join(REPO, d), path.join(SB, d), { recursive: true })
  return SB
}
function runSuite(SB) {
  let stdout = '', rc = 0
  try {
    stdout = cp.execFileSync(process.execPath, [path.join(SB, 'tools', 'oi-hour-hit-test.js')], { encoding: 'utf8' })
  } catch (e) {
    rc = typeof e.status === 'number' ? e.status : -1
    stdout = (e.stdout || '') + '\n' + (e.stderr || '')
  }
  const m = /passed=(\d+) failed=(\d+)/.exec(stdout.split(/\r?\n/).reverse().find(l => /passed=\d+ failed=\d+/.test(l)) || '')
  const crashed = rc === -1 || !m || /TypeError|ReferenceError|SyntaxError|ENOENT|EPERM/.test(stdout)
  return { rc, passed: m ? +m[1] : NaN, failed: m ? +m[2] : NaN, crashed, stdout }
}
/* 命中恰 1 次 + 落点不在注释行；不满足返回错误说明。
 * 本仓源码是 CRLF：跨行锚点必须按 EOL 变体积，否则 split 命中 0 次 = 变异等于没发生（第十一轮实测踩过）。 */
function toEol(src, text) {
  const eol = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n'
  return text.split('\n').join(eol)
}
function patchOnce(src, anchorRaw, replacementRaw) {
  const cands = [{ a: anchorRaw, r: replacementRaw }, { a: toEol(src, anchorRaw), r: toEol(src, replacementRaw) }]
  let picked = null
  for (const c of cands) {
    const hits = src.split(c.a).length - 1
    if (hits === 1) { picked = c; break }
  }
  if (!picked) {
    const counts = cands.map(c => src.split(c.a).length - 1).join('/')
    return { err: '锚点命中 ' + counts + ' 次（需恰 1，已试 LF/CRLF 两种体积）：' + anchorRaw.slice(0, 46) }
  }
  const at = src.indexOf(picked.a)
  const line = src.slice(src.lastIndexOf('\n', at) + 1, src.lastIndexOf('\n', at) + 65).trimStart()
  if (/^(\/\/|\*|\/\*)/.test(line)) return { err: '锚点落在注释行上（变异无效）：' + line.slice(0, 50) }
  return { out: src.replace(picked.a, picked.r) }
}

const F_OVERLAP = 'if (m < sg.toMin && m + 60 > sg.fromMin && sg.fromMin < bestFrom)'
const MUTANTS = [
  ['F1 摘掉兜底（退回修前形态：子小时窗口点不中）',
    'if (hit < 0) {\n    let best = -1, bestFrom = Infinity',
    'if (false) {\n    let best = -1, bestFrom = Infinity'],
  ['F2 兜底抢在包含判据之前（overlap 优先，会改选到别条）',
    'let hit = -1\n  all.forEach(function (it, i) { if (hit < 0 && hits(it)) hit = i })',
    'let hit = -1\n  { let b0 = -1, bf0 = Infinity\n    all.forEach(function (it, i) { segsOf(it).forEach(function (sg) { if (m < sg.toMin && m + 60 > sg.fromMin && sg.fromMin < bf0) { bf0 = sg.fromMin; b0 = i } }) })\n    hit = b0 }\n  all.forEach(function (it, i) { if (hit < 0 && hits(it)) hit = i })'],
  ['F3 兜底改成取最晚开始的候选（次序不确定 ⇒ 该抓）',
    F_OVERLAP, F_OVERLAP.replace('sg.fromMin < bestFrom', 'sg.fromMin > bestFrom')],
  ['F4 兜底把终点放宽成闭区间（顺手放宽过头 ⇒ 该抓）',
    F_OVERLAP, F_OVERLAP.replace('m < sg.toMin', 'm <= sg.toMin')],
  ['F5 selIndex 退回用提升前的下标（与摘要不同源的旧 bug）',
    'card.selIndex = picked ? (card.items || []).indexOf(picked) : -1\n  card.selSummary = picked ? picked.summaryText : \'\'',
    'card.selIndex = hit\n  card.selSummary = hit >= 0 ? all[hit].summaryText : \'\''],
  ['F6 解析丢掉「今晚」前缀（跨零点形状塌掉 ⇒ 该抓）',
    't.replace(/^今晚 /, \'\')', 't.replace(/^今天 /, \'\')'],
  ['C1 等价控制：只重命名局部变量 bestFrom（必须仍全绿）',
    'let best = -1, bestFrom = Infinity', 'let best = -1, bestFrom2 = Infinity']
]
const C1_TAIL = ['&& sg.fromMin < bestFrom) { bestFrom = sg.fromMin', '&& sg.fromMin < bestFrom2) { bestFrom2 = sg.fromMin']

const base = runSuite(sandbox())
if (base.crashed || base.failed !== 0) {
  console.log('有效性门未过：未变异副本 ' + JSON.stringify({ rc: base.rc, passed: base.passed, failed: base.failed, crashed: base.crashed }))
  process.exit(1)
}
console.log('有效性门：未变异副本 passed=' + base.passed + ' failed=0 ✓\n')

let caught = 0, leaked = 0, crashRed = 0, falseHit = 0, injFail = 0, keptGreen = 0
for (const [name, anchor, repl] of MUTANTS) {
  const SB = sandbox()
  const f = path.join(SB, REL)
  let p = patchOnce(fs.readFileSync(f, 'utf8'), anchor, name.startsWith('C1') ? repl : repl)
  if (p.err) { injFail++; console.log('  ' + name + '\n      注入失败：' + p.err + '（计漏网，不改行凑数）'); fs.rmSync(SB, { recursive: true, force: true, maxRetries: 3 }); continue }
  let body = p.out
  if (name.startsWith('C1')) {
    const c = patchOnce(body, C1_TAIL[0], C1_TAIL[1])
    if (c.err) { injFail++; console.log('  ' + name + '\n      注入失败（第二处锚点）：' + c.err); fs.rmSync(SB, { recursive: true, force: true, maxRetries: 3 }); continue }
    body = c.out
  }
  fs.writeFileSync(f, body)
  const r = runSuite(SB)
  if (r.crashed) { crashRed++; console.log('  ' + name + ' ⇒ 崩红（不算抓到）rc=' + r.rc) }
  else if (name.startsWith('C1')) {
    if (r.failed === 0) { keptGreen++; console.log('  ' + name + ' ⇒ 保持全绿 ✓') }
    else { falseHit++; console.log('  ' + name + ' ⇒ 误伤：等价改写也报红 failed=' + r.failed) }
  } else if (r.failed > 0) { caught++; console.log('  ' + name + ' ⇒ 抓到（failed=' + r.failed + '）') }
  else { leaked++; console.log('  ' + name + ' ⇒ 漏网：套件仍全绿') }
  fs.rmSync(SB, { recursive: true, force: true, maxRetries: 3 })
}
const n = MUTANTS.length
const closed = caught + leaked + crashRed + falseHit + injFail + keptGreen
console.log('\n闭合：变异 ' + n + ' 条 = 抓到 ' + caught + ' + 漏网 ' + leaked + ' + 崩红 ' + crashRed + ' + 误伤 ' + falseHit + ' + 注入失败 ' + injFail + ' + 等价保持绿 ' + keptGreen + ' ⇒ ' + closed + '/' + n)
console.log('抓到=' + caught + ' 漏网=' + (leaked + injFail) + ' 崩红=' + crashRed + ' 误伤=' + falseHit)
process.exit(closed === n && leaked === 0 && injFail === 0 && falseHit === 0 && crashRed === 0 && caught > 0 ? 0 : 1)
