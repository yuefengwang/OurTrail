/* 彩虹遮光闸的判据有没有牙齿：复制工作树到临时目录，逐条注入"看起来差不多"的退化，
 * 要求 sky-test / oi-claim-gate / weather-v2 三套里至少一套报红。
 * 任何一条仍然全绿 ⇒ 那条判据是假的（只测了它能跑，没测它会红）。
 *
 * R3 是这套脚本存在的理由：第一版测试只写了"低云满"的用例，
 * 把闸改成"只看低云"时三套全绿——也就是说"中高云遮日"那一半根本没被测到。
 * 补了断言之后 R3 才会红（sky-test §3 的"低云少但中高云铺满"）。
 *
 * 运行：node mutate-rainbow.js
 * 退出码：0 = 每条都被抓到；1 = 有漏网；2 = 前置门（未变异副本必须全绿）没过
 */
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '../../../../..')
const SUITES = ['sky-test.js', 'oi-claim-gate-test.js', 'weather-v2-test.js']

function sandbox () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-rainbow-'))
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true })
  /* 整套 miniprogram 都要复制；weather-v2-test 还 require 云函数侧的 lib/weather，
     少了它副本根本跑不起来——前置门要的是"未变异副本全绿"，夹具必须齐。 */
  fs.cpSync(path.join(ROOT, 'miniprogram'), path.join(dir, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'cloudfunctions/trailApi'), { recursive: true })
  fs.cpSync(path.join(ROOT, 'cloudfunctions/trailApi/lib'), path.join(dir, 'cloudfunctions/trailApi/lib'), { recursive: true })
  SUITES.forEach(f => fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(dir, 'tools', f)))
  return dir
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
  return bad
}
/* 锚点必须命中恰 1 次：命中 0 次等于没注入（跨行锚点在 CRLF 文件里就会这样静默失效） */
function mutate (dir, file, from, to) {
  const p = path.join(dir, 'miniprogram/utils', file)
  const src = fs.readFileSync(p, 'utf8')
  const hits = src.split(from).length - 1
  if (hits !== 1) throw new Error('锚点在 ' + file + ' 里命中 ' + hits + ' 次（要求恰为 1 次）：' + from.slice(0, 64))
  fs.writeFileSync(p, src.split(from).join(to))
}

const SKY = 'sky.js'
/* R1 的写法换过一次，原因值得留在这里：
   第一版 R1 是"把 `|| c.low >= 70` 加回水分信号"，结果三套全绿——因为遮光闸要求 `low < 40`，
   而 `low >= 70` 与它互斥，**这个变异体在行为上是等价的（死分支）**，不是漏网而是无效变异。
   所以判据要测的是"水分信号只剩低云"这种真会改结果的退化（R1↓），
   而"低云≥70 当水分"这句旧逻辑现在即使被抄回来也翻不了案。 */
const MUTANTS = [
  ['R1 水分信号退化成"只看低云"（真降水不再算水分）', SKY,
    'const wet = c.precip > 0.05 || c.showers > 0.05 || (c.rh != null && c.rh >= 88)',
    'const wet = c.low >= 70'],
  ['R2 整个遮光闸拆掉（回到只看水分）', SKY,
    '&& wet && sunVisible) add(h', '&& wet) add(h'],
  ['R3 遮光闸只看低云（中高云遮日不再算遮光）', SKY,
    'const sunVisible = c.low < 40 && (c.mid + c.high) / 2 < 30', 'const sunVisible = c.low < 40'],
  ['R4 中高云阈值放宽到永不生效（30 → 300）', SKY,
    '(c.mid + c.high) / 2 < 30', '(c.mid + c.high) / 2 < 300'],
  ['R5 方位角回到未取整的原始浮点', SKY,
    '+ Math.round(anti) +', '+ anti +'],
]

const base = sandbox()
const preBad = runAll(base)
if (preBad.length) {
  console.error('前置门未过：未变异的临时副本就有红，后面所有"被抓到"都不作数\n  ' + preBad.join('\n  '))
  process.exit(2)
}
console.log('有效性门：未变异副本 ' + SUITES.length + ' 套全绿\n')

let leaked = 0
MUTANTS.forEach(function (m) {
  const dir = sandbox()
  try { mutate(dir, m[1], m[2], m[3]) } catch (e) {
    console.log('✗ ' + m[0] + ' —— 注入失败：' + e.message); leaked++; return
  }
  const bad = runAll(dir)
  if (bad.length) console.log('✓ ' + m[0] + ' —— 被抓到：' + bad.join('; '))
  else { console.log('✗ ' + m[0] + ' —— **漏网**：三套全绿，说明这条判据抓不住这种退化'); leaked++ }
  fs.rmSync(dir, { recursive: true, force: true })
})
fs.rmSync(base, { recursive: true, force: true })
console.log('\n变异 ' + MUTANTS.length + ' 条，漏网 ' + leaked + ' 条')
process.exit(leaked ? 1 : 0)
