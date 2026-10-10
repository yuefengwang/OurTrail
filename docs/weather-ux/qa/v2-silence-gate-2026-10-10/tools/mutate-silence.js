/* 天相沉默闸的判据有没有牙齿：复制工作树到临时目录，逐条注入"看起来差不多"的退化，
 * 要求 sky-test / weather-v2 / weather-page 三套与 ab-silence 对拍里**至少一个**报红。
 * 任何一条仍然全绿 ⇒ 那条判据是假的（只测了它能跑，没测它会红）。
 *
 * 这里的退化全是"两句中文注释之间那行代码写歪了"级别的小事——恰恰是这种最容易在
 * 一次文案调整里静默改掉：把 unknown 当成 excluded（缺数据被读成"没有"）、
 * 减了卡但不点名（空白冒充结论）、总评继续听看不见的那张卡。
 *
 * 锚点纪律（沿用切片二/彩虹轮的教训）：
 *   · 单行锚点，命中必须恰为 1 次（文件是 CRLF，跨行锚点会静默命中 0 次）；
 *   · 需要改"下一行"时，用唯一前导行 + 行偏移定位，不拼多行字符串；
 *   · 先跑"未变异副本全绿"的有效性门，否则后面所有"被抓到"都不作数；
 *   · 偏移落点必须校验"确实是想改的那行代码"（expectInTarget）——S5 第一版把偏移写成 +1，
 *     结果落在中间那句注释上，脚本按"注入失败"计一条漏网而不是静默改错行。
 *
 * 运行：node mutate-silence.js
 * 退出码：0 = 每条都被抓到；1 = 有漏网；2 = 前置门未过
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '../../../../..')
const PRE_SHA = process.env.PRE_SHA || '5351231'
const SUITES = ['sky-test.js', 'weather-v2-test.js', 'weather-page-test.js']

/* 对拍需要"改前"的整棵 miniprogram；沙盒里没有 .git，所以在真仓库里先把它取出来缓存 */
function ensurePreArchive () {
  const dir = path.join(os.tmpdir(), 'ot-silence-ab-' + PRE_SHA.slice(0, 7))
  if (!fs.existsSync(path.join(dir, 'miniprogram/utils/sky.js'))) {
    fs.mkdirSync(dir, { recursive: true })
    cp.execSync('git archive ' + PRE_SHA + ' miniprogram | tar -x -C "' + dir + '"', { cwd: ROOT, stdio: 'inherit' })
  }
  return dir
}

function sandbox () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-silence-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'cloudfunctions/trailApi'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'cloudfunctions/trailApi/lib'), path.join(dir, 'cloudfunctions/trailApi/lib'), { recursive: true })
  SUITES.forEach(f => fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(dir, 'tools', f)))
  // 对拍脚本与它依赖的真实快照
  const probeDir = path.join(dir, 'docs/weather-ux/qa/v2-silence-gate-2026-10-10/tools')
  fs.mkdirSync(probeDir, { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'docs/weather-ux/qa/v2-silence-gate-2026-10-10/tools/ab-silence.js'),
    path.join(probeDir, 'ab-silence.js'))
  const snapDir = path.join(dir, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools')
  fs.mkdirSync(snapDir, { recursive: true })
  fs.copyFileSync(path.join(ROOT, 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json'),
    path.join(snapDir, 'real-cloud-g2.json'))
  return dir
}

function runProbe (dir) {
  const r = cp.spawnSync(process.execPath,
    [path.join(dir, 'docs/weather-ux/qa/v2-silence-gate-2026-10-10/tools/ab-silence.js')],
    { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, { PRE_SHA }) })
  return r.status !== 0
}

function runAll (dir) {
  const bad = []
  SUITES.forEach(f => {
    const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', f)], { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) {
      const line = String(r.stdout || '').split('\n').filter(l => l.trim().indexOf('✗') === 0)
      bad.push(f + (line.length ? ' → ' + line[0].trim().slice(0, 96) : ' (exit ' + r.status + ')'))
    }
  })
  if (runProbe(dir)) bad.push('ab-silence.js 对拍 → 越界/空改/阳性对照之一未过')
  return bad
}

/* 单行锚点：命中恰 1 次 */
function mutate (dir, file, from, to) {
  const p = fixPath(dir, file)
  const src = fs.readFileSync(p, 'utf8')
  const hits = src.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + file + ' 里命中 ' + hits + ' 次（要求恰为 1 次）：' + from.slice(0, 64))
  fs.writeFileSync(p, src.split(from).join(to))
}
/* 唯一前导行 + 行偏移：用于"两条相同代码行"的情形（star 与 galaxy 的 verdict 行逐字相同） */
function mutateNear (dir, file, uniqueLine, delta, expectInTarget, to) {
  const p = fixPath(dir, file)
  const src = fs.readFileSync(p, 'utf8')
  const eol = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n'
  const lines = src.split(/\r?\n/)
  const hits = lines.filter(l => l.indexOf(uniqueLine) >= 0)
  if (hits.length !== 1) throw new Error('前导行命中 ' + hits.length + ' 次（要求恰为 1 次）：' + uniqueLine.slice(0, 48))
  const i = lines.findIndex(l => l.indexOf(uniqueLine) >= 0) + delta
  if (i < 0 || i >= lines.length || lines[i].indexOf(expectInTarget) < 0) {
    throw new Error('偏移落点不是预期的代码行：' + (lines[i] || '<越界>') + '（要含 ' + expectInTarget + '）')
  }
  lines[i] = to
  fs.writeFileSync(p, lines.join(eol))
}
function fixPath (dir, file) {
  return path.join(dir, file.indexOf('pages/') === 0 ? 'miniprogram/' + file : 'miniprogram/utils/' + file)
}

const SKY = 'sky.js'
const PAGE = 'pages/weather/weather.js'
const COND = 'conditions.js'
const MUTANTS = [
  ['S1 isSilent 恒假（整个沉默闸拆掉）', SKY,
    '  return !!item && item.verdict === VERDICT.EXCLUDED', '  return false'],
  ['S2 把"判不出"当成"判过不成立"（unknown 一起吃掉）', SKY,
    '  return !!item && item.verdict === VERDICT.EXCLUDED',
    '  return !!item && (item.verdict === VERDICT.EXCLUDED || item.verdict === VERDICT.UNKNOWN)'],
  ['S3 页面照常出卡（buildCondCards 的过滤拆掉）', PAGE,
    '      .filter(it => !sky.isSilent(it))', '      // (mutated) 过滤被拆掉'],
  ['S4 减了卡却不点名（沉默行永远不出现）', PAGE,
    '    if (!titles.length) return null', '    return null'],
  ['S5 缺海拔被写成"看不到云海"（unknown → excluded）', SKY, 'near:' + '此点缺少可信海拔', 2,
    '    return Object.assign(item, grade(0), { verdict: VERDICT.EXCLUDED })'],
  ['S6 此点在云带内仍算有戏（云海永不排除）', SKY,
    '  return Object.assign(item, g, { verdict: above ? VERDICT.POSSIBLE : VERDICT.EXCLUDED })',
    '  return Object.assign(item, g, { verdict: VERDICT.POSSIBLE })'],
  ['S7 暗夜晴空 0% 的银河继续建议找银心带', SKY, 'near:' + '是把不可能包装成建议', 1,
    '  return Object.assign(item, g, { verdict: VERDICT.POSSIBLE })'],
  ['S8 总评继续听被沉默那张卡的（overallGrade 过滤拆掉）', COND,
    "  const all = (items || []).filter(it => it.key !== 'light' && !sky.isSilent(it))",
    "  const all = (items || []).filter(it => it.key !== 'light')"],
]

ensurePreArchive()
const base = sandbox()
const preBad = runAll(base)
if (preBad.length) {
  console.error('前置门未过：未变异的临时副本就有红，后面所有"被抓到"都不作数\n  ' + preBad.join('\n  '))
  process.exit(2)
}
console.log('有效性门：未变异副本 ' + SUITES.length + ' 套 + 对拍全绿\n')

let leaked = 0
MUTANTS.forEach(function (m) {
  const dir = sandbox()
  try {
    if (String(m[2]).indexOf('near:') === 0) {
      mutateNear(dir, m[1], String(m[2]).slice(5), m[3], 'verdict', m[4])
    } else {
      mutate(dir, m[1], m[2], m[3])
    }
  } catch (e) {
    console.log('!! ' + m[0] + ' —— 注入失败：' + e.message)
    leaked++
    return
  }
  const bad = runAll(dir)
  if (bad.length) {
    console.log('✓ ' + m[0] + '\n    被抓于 ' + bad.join('；'))
  } else {
    console.log('✗ 漏网：' + m[0] + '（三套与对拍全部仍然全绿 ⇒ 该判据没有牙齿）')
    leaked++
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
fs.rmSync(base, { recursive: true, force: true })

console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
