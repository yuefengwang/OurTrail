/* 切片二的新增判据有没有牙齿：把仓库复制到临时目录，逐条注入"看起来无害"的架构退化，
 * 要求对应的套件必须报红。任何一条仍然全绿 ⇒ 那条门是假的（只测了它能跑，没测它会红）。
 *
 * 五类退化就是任务书点名的五条：
 *   S1 恢复重复阈值判断（sky 自己写 80）
 *   S2 恢复重复阈值判断（conditions.factsFor 自己写 80）
 *   S3 阈值藏在 L1 缺省里（layersAt 的缺省不是那张表，而是第二个字面量）
 *   S4 L3 又抄一份快照（CLOUD_SEA 不再引用 LAYER_LIMITS）
 *   S5 摘要重新依赖文案文本（退回 indexOf('云区')）
 *   S6 改变摘要优先级（首选类别换成 duration）
 *   S7 将未评估与评估后拒绝混为一谈（notEvaluated 并进 rejected）
 *   S8 将"评估通过但没有形成窗口"塞回逐时账本（noWindow 并进 rejected）
 *   S9 将未知状态误判为无云（判不出时不留 abstain 痕，沉默看起来就像"没有云"）
 *
 * 运行：node mutate-slice2.js
 * 退出码：0 = 每条变异都被抓到；1 = 有漏网；2 = 前置（未变异副本必须全绿）没过
 */
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '../../../..')

const SUITES = [
  'cloud-layer-facts-test.js',
  'outdoor-intelligence-test.js',
  'outdoor-cloud-sea-test.js',
  'cloud-position-test.js',
]

function makeSandbox () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-slice2-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  /* 整套 miniprogram 都要复制：cloud-position-test 除了 utils 还读
     pages/weather/weather.wxml 与 weather.js（静态词汇门），少了它们副本本身就跑不起来。
     前置门要求"未变异副本全绿"，所以夹具必须齐。 */
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  SUITES.forEach(f => fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(dir, 'tools', f)))
  return dir
}
function runAll (dir) {
  const bad = []
  SUITES.forEach(f => {
    const r = cp.spawnSync(process.execPath, [path.join(dir, 'tools', f)], { cwd: dir, encoding: 'utf8' })
    if (r.status !== 0) {
      const line = String(r.stdout || '').split('\n').filter(l => l.indexOf('✗') === 0)
      bad.push(f + (line.length ? ' → ' + line[0].slice(0, 110) : ' (exit ' + r.status + ')'))
    }
  })
  return bad
}
/* 变异必须"只改一处、改不到就报错"——静默没找到锚点=这条变异根本没注入，红绿都不算数 */
function mutate (dir, file, from, to) {
  const p = path.join(dir, 'miniprogram/utils', file)
  const src = fs.readFileSync(p, 'utf8')
  const hits = src.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + file + ' 里命中 ' + hits + ' 次（要求恰为 1 次）：' + from.slice(0, 60))
  fs.writeFileSync(p, src.split(from).join(to))
}

const MUTANTS = [
  ['S1 sky 恢复自己的 80（重复阈值判断）', 'sky.js',
    "if (CLF.isCloudBand(band) && elevOK", "if (band && band.cover >= 80 && elevOK"],
  ['S2 conditions.factsFor 恢复自己的 80', 'conditions.js',
    'd.filter(h => CLF.isCloudBand(h.band))', 'd.filter(h => h.band && h.band.cover >= 80)'],
  ['S3 剖面成层阈值藏回 L1 的第二个字面量', 'cloud-layer-facts.js',
    'o.coverMin : LAYER_LIMITS.FIELD_LAYER_COVER_MIN', 'o.coverMin : 80'],
  ['S4 L3 的 LAYER_COVER_MIN 改回快照（不再引用那张表）', 'outdoor-intelligence.js',
    'get LAYER_COVER_MIN () { return CLF.LAYER_LIMITS.FIELD_LAYER_COVER_MIN },', 'LAYER_COVER_MIN: 80,'],
  ['S5 摘要重新按文案字面挑（indexOf 云区/云层位于）', 'oi-presentation.js',
    'const hit = ev.find(function (e) { return e && e.kind === SUMMARY_KIND_PRIORITY[i] })',
    "const hit = ev.find(function (e) { return e && (String(e.fact).indexOf('云区') >= 0 || String(e.fact).indexOf('云层位于') >= 0) })"],
  ['S6 摘要首选类别从 layer-position 改成 duration（优先级被挪动）', 'oi-presentation.js',
    'const SUMMARY_KIND_PRIORITY = [EK.LAYER_POSITION]', 'const SUMMARY_KIND_PRIORITY = [EK.DURATION]'],
  /* 锚点一律取单行：仓库里这些文件是 CRLF，多行锚点会命中 0 次（那等于没注入） */
  ['S7 未评估并入评估后拒绝（两个状态混为一谈）', 'outdoor-intelligence.js',
    'notEvaluated.push({', 'rejected.push({'],
  ['S8 窗口级拒绝塞回逐时账本（noWindow 并进 rejected）', 'outdoor-intelligence.js',
    "noWindow.push({ from: run.from, to: run.to, stage: 'window', reason: 'LOW_PERSISTENCE'",
    "rejected.push({ from: run.from, to: run.to, stage: 'window', reason: 'LOW_PERSISTENCE'"],
  ['S9 判不出不留痕（未知被读成"没有云"）', 'outdoor-intelligence.js',
    'if (why) out.push({ fact: why, at: h.t, kind: K.ABSTAIN })', 'void why'],
]

const base = makeSandbox()
const preBad = runAll(base)
if (preBad.length) {
  console.error('前置门未过：未变异的临时副本就有红，后面所有"变异被抓到"都不作数\n  ' + preBad.join('\n  '))
  process.exit(2)
}
console.log('有效性门：未变异副本 ' + SUITES.length + ' 套全绿（临时目录 ' + base + '）\n')

let leaked = 0
MUTANTS.forEach(function (m) {
  const dir = makeSandbox()
  try {
    mutate(dir, m[1], m[2], m[3])
  } catch (e) {
    console.log('✗ ' + m[0] + ' —— 注入失败：' + e.message)
    leaked++
    return
  }
  const bad = runAll(dir)
  if (bad.length) console.log('✓ ' + m[0] + ' —— 被抓到：' + bad.join('; '))
  else { console.log('✗ ' + m[0] + ' —— **漏网**：四条套件全绿，说明这套门抓不住这种退化'); leaked++ }
  fs.rmSync(dir, { recursive: true, force: true })
})

fs.rmSync(base, { recursive: true, force: true })
console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
