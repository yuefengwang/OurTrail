/* R2 判据的变异自证：把 miniprogram/utils 复制到临时目录，逐条把生产代码改「错」，
 * 再跑 tools/outdoor-cloud-sea-test.js 的副本（require 指向临时目录），
 * 期望每一条变异都让 R2 段落报红。任何一条变异仍然全绿 ⇒ 那条判据是假绿。
 *
 * 运行：node mutate-r2.js
 * 退出码：0 = 每条变异都被抓到；1 = 有变异漏网。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '../../../../../')
const SRC = path.join(ROOT, 'miniprogram', 'utils')
const TEST = path.join(ROOT, 'tools', 'outdoor-cloud-sea-test.js')

/* 每条变异都是「把 R2 的那句话改回旧行为或改成说谎」，不是删代码。
 * file 默认 outdoor-intelligence.js；M8/M9 分别打在呈现层选择子和净空主语上。 */
const MUTANTS = [
  ['M1 第一段采样点就是浓云时仍谎称测到了云底（baseBoundary 恒 false）',
    'run = { base: base, top: pts[i].alt, covers: [pts[i].cover], baseBoundary: !crossed }',
    'run = { base: base, top: pts[i].alt, covers: [pts[i].cover], baseBoundary: false }'],
  ['M2 扫到上界仍在浓云时谎称云顶实测（topBoundary 恒 false）',
    'if (run) { run.top = CFF.ALT1; run.topBoundary = true; layers.push(run) }',
    'if (run) { run.top = CFF.ALT1; run.topBoundary = false; layers.push(run) }'],
  ['M3 证据文案退回旧说法：窗边界直接写成「云层位于 2,000–…」',
    'if (!baseBoundary && !topBoundary) {',
    'if (true) {'],
  ['M4 云底被切时不再说不确定 —— 两端贯穿分支并进"完整实测"分支',
    '} else if (baseBoundary && topBoundary) {',
    '} else if (false) {'],
  ['M5 净空那句去掉「云顶未测得，此为上限」标注',
    "(topBoundary ? '（云顶未测得，此为上限）' : '')",
    "(false ? '（云顶未测得，此为上限）' : '')"],
  ['M6 层厚那句不再说明它是下限值',
    "evidence.push({ fact: '层厚 ' + thickMax + ' m 按扫描窗内可见部分计算，是下限值而不是实测厚度', at: from })",
    "evidence.push({ fact: '层厚 ' + thickMax + ' m', at: from })"],
  ['M7 层记录不再携带来源标记（下游无从判断是否被切）',
    'baseBoundary: c.layer.baseBoundary === true, topBoundary: c.layer.topBoundary === true,',
    ''],
  ['M8 净空主语写反（回到旧文案「云层底部」——净空量的其实是云顶）',
    "FMT.ELEV_SUBJECT + '高于该云层顶约 '",
    "FMT.ELEV_SUBJECT + '高于云层底部约 '"],
  ['M9 卡片摘要丢掉「位置那句」，退化成一条通用事实',
    { file: 'oi-presentation.js', from: 'return (pick || w.evidence[0]).fact', to: 'return (pick || w.evidence[2] || w.evidence[0]).fact' }],
]

function run (file) {
  const r = cp.spawnSync(process.execPath, [file], { encoding: 'utf8', cwd: ROOT })
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-r2-mutate-'))
const utils = path.join(tmp, 'miniprogram', 'utils')
fs.mkdirSync(utils, { recursive: true })
const orig = {}
fs.readdirSync(SRC).forEach(function (f) {
  orig[f] = fs.readFileSync(path.join(SRC, f), 'utf8')
  fs.writeFileSync(path.join(utils, f), orig[f])
})
const testCopy = path.join(tmp, 'sea-test.js')
fs.writeFileSync(testCopy, fs.readFileSync(TEST, 'utf8').replace(/\.\.\/miniprogram\/utils\//g, './miniprogram/utils/'))

const base = run(testCopy)
const baseFailed = (base.out.match(/passed=(\d+) failed=(\d+)/) || [])[2]
console.log('基线（未变异）：' + base.out.trim().split('\n').pop() + ' exit=' + base.code)
if (base.code !== 0) { console.log('!! 基线就是红的，变异自证无意义'); process.exit(1) }

let leaked = 0
MUTANTS.map(function (m) {
  return typeof m[1] === 'object'
    ? { desc: m[0], file: m[1].file, from: m[1].from, to: m[1].to }
    : { desc: m[0], file: 'outdoor-intelligence.js', from: m[1], to: m[2] }
}).forEach(function (mu) {
  const desc = mu.desc, from = mu.from, to = mu.to
  const f = path.join(utils, mu.file)
  const cur = fs.readFileSync(f, 'utf8')
  if (cur.indexOf(from) < 0) {
    console.log('✗ ' + desc + ' —— 变异点找不到原文，这条自证本身失效')
    leaked++
    return
  }
  fs.writeFileSync(f, cur.replace(from, to))
  const r = run(testCopy)
  fs.writeFileSync(f, cur)
  const matched = r.out.match(/passed=(\d+) failed=(\d+)/)
  if (!matched) {
    console.log('✓ ' + desc + ' —— 套件崩溃/无读数（exit=' + r.code + '）：' +
      String(r.out).split('\n').filter(x => /Error|throw/.test(x))[0] || '')
    return
  }
  const nf = Number(matched[2])
  const r2red = /== R2 边界语义[\s\S]*✗/.test(r.out)
  if (nf > 0 && r2red) {
    console.log('✓ ' + desc + ' —— 被抓到（failed=' + nf + '，红在 R2 段落）')
  } else if (nf > 0) {
    console.log('✗ ' + desc + ' —— 只红在别处（failed=' + nf + '，R2 段落没报红），判据没有指向这件事')
    leaked++
  } else {
    console.log('✗ ' + desc + ' —— 完全漏网（全绿）')
    leaked++
  }
})

console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
