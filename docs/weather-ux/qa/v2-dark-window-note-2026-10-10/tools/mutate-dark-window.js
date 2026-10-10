/* 「天文暗夜始」机会句的判据有没有牙齿：复制工作树到临时目录，逐条注入退化，
 * 要求 weather-v2-test 与 ab-dark-window 对拍里至少一个报红；仍然全绿 ⇒ 该判据是假的。
 *
 * D2（永远不说）是这套脚本存在的理由：它把用户报的那个现象"治好"了，
 * 却把真有机会的夜晚也一起抹掉——只测"被摘掉"的差分对拍会放过它，
 * 必须靠"双向一致 + 一刀切门"才会红。
 *
 * 锚点纪律：单行锚点、命中恰 1 次（文件是 CRLF）；先过"未变异副本全绿"的有效性门。
 *
 * 运行：node mutate-dark-window.js
 * 退出码：0 = 每条都被抓到；1 = 有漏网；2 = 前置门未过
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '../../../../..')
const PRE_SHA = process.env.PRE_SHA || 'd2e9d70'
const SUITES = ['weather-v2-test.js']
const PROBE = 'docs/weather-ux/qa/v2-dark-window-note-2026-10-10/tools/ab-dark-window.js'
const SNAP = 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json'

function ensurePreArchive () {
  const dir = path.join(os.tmpdir(), 'ot-darkwindow-ab-' + PRE_SHA.slice(0, 7))
  if (!fs.existsSync(path.join(dir, 'miniprogram/utils/agenda.js'))) {
    fs.mkdirSync(dir, { recursive: true })
    cp.execSync('git archive ' + PRE_SHA + ' miniprogram | tar -x -C "' + dir + '"', { cwd: ROOT, stdio: 'inherit' })
  }
  return dir
}
function sandbox () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-dark-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'cloudfunctions/trailApi'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'cloudfunctions/trailApi/lib'), path.join(dir, 'cloudfunctions/trailApi/lib'), { recursive: true })
  SUITES.forEach(f => fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(dir, 'tools', f)))
  const pd = path.join(dir, path.dirname(PROBE))
  fs.mkdirSync(pd, { recursive: true })
  fs.copyFileSync(path.join(ROOT, PROBE), path.join(dir, PROBE))
  const sd = path.join(dir, path.dirname(SNAP))
  fs.mkdirSync(sd, { recursive: true })
  fs.copyFileSync(path.join(ROOT, SNAP), path.join(dir, SNAP))
  return dir
}
function runAll (dir) {
  const bad = []
  SUITES.forEach(f => {
    const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', f)], { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) {
      const line = String(r.stdout || '').split('\n').filter(l => l.trim().indexOf('✗') === 0)
      bad.push(f + (line.length ? ' → ' + line[0].trim().slice(0, 90) : ' (exit ' + r.status + ')'))
    }
  })
  const p = cp.spawnSync(process.execPath, [path.join(dir, PROBE)], { cwd: dir, encoding: 'utf8' })
  if (p.status !== 0) bad.push('ab-dark-window.js → ' + (String(p.stdout || '').trim().split('\n').pop() || '').slice(-90))
  return bad
}
function mutate (dir, file, from, to) {
  const p = path.join(dir, 'miniprogram/utils', file)
  const src = fs.readFileSync(p, 'utf8')
  const hits = src.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + file + ' 里命中 ' + hits + ' 次（要求恰为 1 次）：' + from.slice(0, 60))
  fs.writeFileSync(p, src.split(from).join(to))
}

const AG = 'agenda.js'
const LINE = "    if (sun.astroDusk) add(sun.astroDusk, '天文暗夜始', hasMark(detail, marks, 'galaxy') ? '银河与深空窗口' : null, false)"
const MUTANTS = [
  ['D1 永远说（回到无条件机会句 = 用户报的原状）', AG, LINE,
    "    if (sun.astroDusk) add(sun.astroDusk, '天文暗夜始', '银河与深空窗口', false)"],
  ['D2 永远不说（一刀切把真机会也抹掉）', AG, LINE,
    "    if (sun.astroDusk) add(sun.astroDusk, '天文暗夜始', null, false)"],
  ['D3 判据放宽成"能看星就说银河"（galaxy → star）', AG, LINE,
    "    if (sun.astroDusk) add(sun.astroDusk, '天文暗夜始', hasMark(detail, marks, 'star') ? '银河与深空窗口' : null, false)"],
  ['D4 标记键少了日期前缀（marks 真查不到 ⇒ 静默恒 false）', AG,
    "  return (detail || []).some(h => ((marks || {})[h.d + 'T' + h.t] || []).indexOf(key) !== -1)",
    "  return (detail || []).some(h => ((marks || {})[h.t] || []).indexOf(key) !== -1)"],
  ['D5 没银河时把时刻也裁掉（客观事实被天气吃掉）', AG, LINE,
    "    if (sun.astroDusk && hasMark(detail, marks, 'galaxy')) add(sun.astroDusk, '天文暗夜始', '银河与深空窗口', false)"],
  ['D6 上一轮摄影后缀无条件加（跨轮回退）', AG,
    '  if (low == null || low < sky.LIGHT_LIMITS.LOW_CLOUD_MAX) return null', '  if (low == null) return null'],
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
  try { mutate(dir, m[1], m[2], m[3]) } catch (e) {
    console.log('!! ' + m[0] + ' —— 注入失败：' + e.message)
    leaked++
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  const bad = runAll(dir)
  if (bad.length) console.log('✓ ' + m[0] + '\n    被抓于 ' + bad.join('；'))
  else { console.log('✗ 漏网：' + m[0] + '（测试与对拍全绿 ⇒ 这条判据抓不住该退化）'); leaked++ }
  fs.rmSync(dir, { recursive: true, force: true })
})
fs.rmSync(base, { recursive: true, force: true })
console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
