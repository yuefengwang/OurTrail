/* ab-slice.js 的比较器有没有牙齿：把当前工作树的 utils 复制到临时目录，
 * 逐条注入"会改变业务结果"的改动，要求跨版本对拍必须报出**业务判据差异**。
 * 任何一条变异仍然比出 0 差异 ⇒ 那个字段根本没被比较，"业务判据差异 0 组"是假绿。
 *
 * 运行：node mutate-ab.js <切片前的 utils 目录>
 * 退出码：0 = 每条变异都被抓到；1 = 有漏网。
 */
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '../../../..')
const PRE_DIR = process.argv[2]
if (!PRE_DIR || !fs.existsSync(path.join(PRE_DIR, 'outdoor-intelligence.js'))) {
  console.error('用法：node mutate-ab.js <切片前的 utils 目录>'); process.exit(2)
}

/* 每条都是"改一个业务数值/判定"，不是删代码 */
const MUTANTS = [
  /* V1/V4 的锚点于切片二搬家到 cloud-layer-facts.js（LAYER_LIMITS 是那两个数的唯一出处）。
     锚点写不到就报"这条自证本身失效"，所以搬家必须同步搬锚点，否则自证静默失去牙齿。 */
  ['V1 扫描步长 50→40（层边界采样点全变）', 'cloud-layer-facts.js',
    'FIELD_LAYER_STEP_M: 50,', 'FIELD_LAYER_STEP_M: 40,'],
  ['V2 净空门槛 200→300', 'outdoor-intelligence.js',
    'CLEARANCE_MIN: 200,', 'CLEARANCE_MIN: 300,'],
  ['V3 层厚门槛 300→200', 'outdoor-intelligence.js',
    'LAYER_THICKNESS_MIN: 300,', 'LAYER_THICKNESS_MIN: 200,'],
  ['V4 成层覆盖 80→70', 'cloud-layer-facts.js',
    'FIELD_LAYER_COVER_MIN: 80,', 'FIELD_LAYER_COVER_MIN: 70,'],
  ['V5 云顶不再插值（退出点直接取上一格点）', 'cloud-layer-facts.js',
    'run.top = prev.cover > coverMin', 'run.top = false && prev.cover > coverMin'],
  ['V6 截断标记被抹掉（被切层冒充完整层）', 'cloud-layer-facts.js',
    'baseBoundary: l.baseBoundary === true, topBoundary: l.topBoundary === true,',
    'baseBoundary: false, topBoundary: false,'],
  ['V7 候选层选择改成取最厚（会换一层）', 'cloud-layer-facts.js',
    'const L = below[below.length - 1]',
    'const L = below.slice().sort((a, b) => a.thickness - b.thickness)[0]'],
  ['V8 扫描上界夹到查询点海拔（正是 R1 要避免的那种改法）', 'cloud-layer-facts.js',
    'return { lo: CFF.ALT0, hi: CFF.ALT1, source: \'display-window\' }',
    'return { lo: CFF.ALT0, hi: 3004, source: \'display-window\' }'],
]

function runAb (dir) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'ab-slice.js'), dir],
    { encoding: 'utf8', cwd: __dirname, maxBuffer: 1 << 28 })
  return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') }
}
const base = runAb(PRE_DIR)
const baseM = base.out.match(/业务判据差异 (\d+) 组/)
console.log('基线（未变异）：' + (baseM ? baseM[0] : '无读数') + ' exit=' + base.code)
if (base.code !== 0 || !baseM || baseM[1] !== '0') {
  console.log('!! 基线本身不是 0 差异，变异自证无意义'); process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-slice-mutate-'))
const utils = path.join(tmp, 'miniprogram', 'utils')
fs.mkdirSync(utils, { recursive: true })
fs.readdirSync(path.join(ROOT, 'miniprogram/utils')).forEach(function (f) {
  fs.copyFileSync(path.join(ROOT, 'miniprogram/utils', f), path.join(utils, f))
})
/* 把 ab-slice.js 也复制进来并把 ROOT 指回真仓库（它要读真实快照与 cloud-field-svg） */
const abCopy = path.join(tmp, 'ab-slice.js')
fs.writeFileSync(abCopy, fs.readFileSync(path.join(__dirname, 'ab-slice.js'), 'utf8')
  .replace("path.resolve(__dirname, '../../../..')", JSON.stringify(ROOT).replace(/\\/g, '/'))
  .replace(/path\.join\(ROOT, 'miniprogram\/utils\/outdoor-intelligence\.js'\)/, JSON.stringify(path.join(utils, 'outdoor-intelligence.js')).replace(/\\/g, '/'))
  .replace("require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))", "require(path.join(__dirname, 'miniprogram/utils/outdoor-intelligence.js'))")
  .replace("require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))", "require(path.join(__dirname, 'miniprogram/utils/cloud-field-svg.js'))")
  .replace("require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))", "require(path.join(__dirname, 'miniprogram/utils/weather-cloud-field.js'))")
  .replace("path.join(__dirname, '..', 'ab-slice.json')", "path.join(__dirname, 'ab-slice-mutated.json')"))

let leaked = 0
MUTANTS.forEach(function (m) {
  const desc = m[0], file = m[1], from = m[2], to = m[3]
  const f = path.join(utils, file)
  const cur = fs.readFileSync(f, 'utf8')
  if (cur.indexOf(from) < 0) { console.log('✗ ' + desc + ' —— 变异点找不到原文，这条自证本身失效'); leaked++; return }
  fs.writeFileSync(f, cur.replace(from, to))
  const r = cp.spawnSync(process.execPath, [abCopy, PRE_DIR], { encoding: 'utf8', cwd: tmp, maxBuffer: 1 << 28 })
  fs.writeFileSync(f, cur)
  const out = String(r.stdout || '') + String(r.stderr || '')
  const mm = out.match(/业务判据差异 (\d+) 组/)
  if (mm && Number(mm[1]) > 0) console.log('✓ ' + desc + ' —— 被抓到（' + mm[0] + '，exit=' + r.status + '）')
  else if (!mm) { console.log('✗ ' + desc + ' —— 对拍没有产出读数（可能抛错），不能算抓到：' + out.split('\n').filter(x => /Error/.test(x))[0]); leaked++ }
  else { console.log('✗ ' + desc + ' —— 漏网：业务判据差异 0 组，说明这个字段根本没被比较'); leaked++ }
})
console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
