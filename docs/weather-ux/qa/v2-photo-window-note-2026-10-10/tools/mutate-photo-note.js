/* 摄影窗口事实后缀的判据有没有牙齿：复制工作树到临时目录，逐条注入"看起来差不多"的退化，
 * 要求 weather-v2-test 与 ab-photo-note 对拍里至少一个报红；仍然全绿 ⇒ 该判据是假的。
 *
 * P6/P8 是这轮真正想测的东西：把"光到不到得了山体"的 40 抄成 agenda.js 自己的字面量，
 * 或者把 sky 的两处消费改回内联 `c.low < 40` —— 行为当场不变、测试当场全绿，
 * 但从这一刻起"单源"就是假的：下次改数只会动一处。影子常量门与静态门合起来才抓得住。
 *
 * 锚点纪律（沿用前几轮教训）：单行锚点、命中恰 1 次（文件是 CRLF）；
 * 偏移落点必须校验"确实是想改的那行"；先跑"未变异副本全绿"的有效性门。
 *
 * 运行：node mutate-photo-note.js
 * 退出码：0 = 每条都被抓到；1 = 有漏网；2 = 前置门未过
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '../../../../..')
const PRE_SHA = process.env.PRE_SHA || 'eded900'
const SUITES = ['weather-v2-test.js']
const PROBE = 'docs/weather-ux/qa/v2-photo-window-note-2026-10-10/tools/ab-photo-note.js'
const SNAP = 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json'

function ensurePreArchive () {
  const dir = path.join(os.tmpdir(), 'ot-photenote-ab-' + PRE_SHA.slice(0, 7))
  if (!fs.existsSync(path.join(dir, 'miniprogram/utils/agenda.js'))) {
    fs.mkdirSync(dir, { recursive: true })
    cp.execSync('git archive ' + PRE_SHA + ' miniprogram | tar -x -C "' + dir + '"', { cwd: ROOT, stdio: 'inherit' })
  }
  return dir
}
function sandbox () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-photo-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  // weather-v2-test 还 require 云函数侧的 lib/weather，少了它副本根本跑不起来
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
  if (p.status !== 0) bad.push('ab-photo-note.js → ' + (String(p.stdout || '').trim().split('\n').pop() || '').slice(-90))
  return bad
}
function fixPath (dir, file) {
  return path.join(dir, file.indexOf('pages/') === 0 ? 'miniprogram/' + file : 'miniprogram/utils/' + file)
}
function mutate (dir, file, from, to) {
  const p = fixPath(dir, file)
  const src = fs.readFileSync(p, 'utf8')
  const hits = src.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + file + ' 里命中 ' + hits + ' 次（要求恰为 1 次）：' + from.slice(0, 60))
  fs.writeFileSync(p, src.split(from).join(to))
}

const AG = 'agenda.js'
const SKY = 'sky.js'
const MUTANTS = [
  ['P1 后缀无条件加（低云判据拆掉）', AG,
    '  if (low == null || low < sky.LIGHT_LIMITS.LOW_CLOUD_MAX) return null', '  if (low == null) return null'],
  ['P2 后缀永远不加（整条功能空转）', AG, 'function lightNote(detail, from, kind) {',
    'function lightNote(detail, from, kind) {\n  if (detail) return null'],
  ['P3 边界写成严格大于（>= 改 >）', AG, 'low < sky.LIGHT_LIMITS.LOW_CLOUD_MAX', 'low <= sky.LIGHT_LIMITS.LOW_CLOUD_MAX'],
  ['P4 后缀越界到别的条目（日落也加话）', AG, "    if (sun.sunset) add(sun.sunset, '日落', null, false)",
    "    if (sun.sunset) add(sun.sunset, '日落', lightNote(detail, sun.sunset, 'golden'), false)"],
  ['P5 满云时把摄影窗口整条裁掉（用户明确说不要的那种做法）', AG,
    "  if (win && win.dawnBlue) add(win.dawnBlue.from,",
    "  if (win && win.dawnBlue && !lightNote(detail, win.dawnBlue.from, 'blue')) add(win.dawnBlue.from,"],
  ['P6 把口径抄成 agenda.js 自己的字面量（"单源"当场变假）', AG,
    'low < sky.LIGHT_LIMITS.LOW_CLOUD_MAX', 'low < 40'],
  ['P7 用 Number(low) 把 null 混成 0（缺读数被写成"光好"）', AG,
    "  return typeof low === 'number' && Number.isFinite(low) ? low : null",
    '  return Number.isFinite(Number(low)) ? Number(low) : null'],
  ['P8 sky 的两处消费改回内联 40（不再引用 LIGHT_LIMITS）', SKY,
    'function lightReachesGround(c) { return c.low < LIGHT_LIMITS.LOW_CLOUD_MAX }',
    'function lightReachesGround(c) { return c.low < 40 }'],
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
  else console.log('✗ 漏网：' + m[0] + '（测试与对拍全绿 ⇒ 这条判据抓不住该退化）')
  if (!bad.length) leaked++
  fs.rmSync(dir, { recursive: true, force: true })
})
fs.rmSync(base, { recursive: true, force: true })
console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
