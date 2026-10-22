/* F6（C5：光染拆分 + 25–40 档）的变异自证
 *
 * 对拍（ab-alpenglow.js）证明"改前 vs 改后"的差异落在允许清单内；本脚本反过来问：
 * 把 C5 的每一条口径分别拆掉，门**必须**红。全绿 = 门是假的。
 *
 * 约定（沿用 C2–C5 的变异框架）：
 *   ① 先跑未变异副本：sky-test.js 必须 exit 0 且 failed=0 且 passed>0——否则后面的红都不是
 *      变异造成的（exit 2，不是通过）；
 *   ② 每个锚点必须**恰好命中一次**；0 次或多次都算注入失败，计漏网并 exit 1；
 *   ③ 每条变异只改 miniprogram/utils/sky.js 的一处，跑 sky-test.js；
 *      「抓住」的判据是 **exit 1 且输出含 `failed=[1-9]` 且含 `✗`**。
 *      exit 2、超时、e.status == null、无失败读数 ⇒ 崩溃/超时，**不计为抓住**，计漏网并 exit 1；
 *   ④ 临时副本在 os.tmpdir，跑完即删。仓库文件是 CRLF，锚点匹配前统一成 LF。
 *
 * 十三条变异：
 *   M1 无地形正分支文案退回「山体被光染」——§4「不再说山体被光染」应红；
 *   M2 无地形 look 退回「看山脊线」——§4「看天空与山脊线」应红；
 *   M3 删掉 25–40 的 +8 分支——§4b 分数 86 应红；
 *   M4 25–40 的理由写成「中高云可被染色」——§4b 理由同源应红；
 *   M5 40 边界改成 > 40——§4b 边界 40 与 §19 的 92 应红；
 *   M6 无地形零列表文案退回「山体被光染」——§4b 边界 24 应红；
 *   M7 无地形分数额外 +8——§4 精确分数 92 应红；
 *   M8 有地形也改用「看天空与山脊线」——§19 阳性对照应红；
 *   M9 `hasTerrain` 强制 false（有地形 excluded 文案退回天空）——§4c 有地形零列表整串应红；
 *   M10 blocked 文案「概率较低」改「概率较高」——§19 概率方向断言应红；
 *   M11 标记下界 25 改 26——§4c 精确 25 用例（标记/分数/理由至少一处）应红；
 *   M12 25–40 分支加 `heading != null`——§4c heading 未知用例（78→70、理由缺失）应红；
 *   M13 `item.text = ridge` 改成 null（有地形也走天空文案）——§19「山体被光染」应红。
 *
 * 运行：node tools/mutate-alpenglow.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')
const SUITE = 'sky-test.js'

const MUTATIONS = [
  {
    id: 'M1',
    name: '无地形正分支文案退回「山体被光染」',
    from: '    : side + \'在 \' + windowText(list) + \' 天空与中高云有被染色的条件（\'\n'
      + '      + reasons.join(\'、\') + \'）。没有目标山峰数据，判断不了哪座山会被染（日照金山）。\'',
    to: '    : side + \'在 \' + windowText(list) + \' 有山体被光染的可能（\'\n'
      + '      + reasons.join(\'、\') + \'）。\'',
  },
  {
    id: 'M2',
    name: '无地形 look 退回「看山脊线」（去掉「天空与」）',
    from: '    : (isDawn ? \'朝东至东北\' : \'朝西至西北\') + \'看天空与山脊线\'',
    to: '    : (isDawn ? \'朝东至东北\' : \'朝西至西北\') + \'看山脊线\'',
  },
  {
    id: 'M3',
    name: '删掉 25–40 的 +8 分支',
    from: '  else if (midHigh >= ALPENGLOW_MIDHIGH_MARK_MIN) { score += 8; reasons.push(\'中高云偏少\') }\n',
    to: '',
  },
  {
    id: 'M4',
    name: '25–40 的理由写成「中高云可被染色」',
    from: '  else if (midHigh >= ALPENGLOW_MIDHIGH_MARK_MIN) { score += 8; reasons.push(\'中高云偏少\') }',
    to: '  else if (midHigh >= ALPENGLOW_MIDHIGH_MARK_MIN) { score += 8; reasons.push(\'中高云可被染色\') }',
  },
  {
    id: 'M5',
    name: '40 边界改成 > 40（40 不再 +14）',
    from: '  if (midHigh >= ALPENGLOW_MIDHIGH_BONUS_MIN) { score += 14; reasons.push(\'中高云可被染色\') }',
    to: '  if (midHigh > ALPENGLOW_MIDHIGH_BONUS_MIN) { score += 14; reasons.push(\'中高云可被染色\') }',
  },
  {
    id: 'M6',
    name: '无地形零列表文案退回「山体被光染」',
    from: '      : \'今天\' + side + \'前后天空与中高云被染色的概率很低。\'',
    to: '      : \'今天\' + side + \'前后云量或降水条件不足，山体被光染的概率很低。\'',
  },
  {
    id: 'M7',
    name: '无地形分数额外 +8（分数不再保持不变）',
    from: '  const g = grade(score)\n  const blockedByRidge = !!(ridge && !sunAboveRidge)',
    to: '  const g = grade(score + (ridge ? 0 : 8))\n  const blockedByRidge = !!(ridge && !sunAboveRidge)',
  },
  {
    id: 'M8',
    name: '有地形也改用「看天空与山脊线」（破坏阳性对照）',
    from: '  item.look = ridge\n    ? \'朝\' + A.bearingLabel(solar.azimuth) + \'看山脊线\'',
    to: '  item.look = ridge\n    ? \'朝\' + A.bearingLabel(solar.azimuth) + \'看天空与山脊线\'',
  },
  {
    id: 'M9',
    name: 'hasTerrain 强制 false（有地形 excluded 文案退回天空）',
    from: '    const hasTerrain = terrainAt(ctx.terrain, edgeSolar.azimuth) !== null',
    to: '    const hasTerrain = false',
  },
  {
    id: 'M10',
    name: 'blocked 文案「概率较低」改成「概率较高」',
    from: '山体被光染的概率较低（',
    to: '山体被光染的概率较高（',
  },
  {
    id: 'M11',
    name: '标记下界 25 改成 26（精确 25 不再有标记）',
    from: 'const ALPENGLOW_MIDHIGH_MARK_MIN = 25',
    to: 'const ALPENGLOW_MIDHIGH_MARK_MIN = 26',
  },
  {
    id: 'M12',
    name: '25–40 的 +8 只在 heading 非空时生效',
    from: '  else if (midHigh >= ALPENGLOW_MIDHIGH_MARK_MIN) { score += 8; reasons.push(\'中高云偏少\') }',
    to: '  else if (midHigh >= ALPENGLOW_MIDHIGH_MARK_MIN && heading != null) { score += 8; reasons.push(\'中高云偏少\') }',
  },
  {
    id: 'M13',
    name: '有地形也走天空文案（item.text = null）',
    from: '  item.text = ridge\n',
    to: '  item.text = null\n',
  },
]

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-alpenglow-mut-'))
  fs.cpSync(SRC, path.join(dir, 'miniprogram'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools'))
  fs.copyFileSync(path.join(ROOT, 'tools', SUITE), path.join(dir, 'tools', SUITE))
  return dir
}

function runSuite(dir) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'tools', SUITE)], {
      cwd: dir, encoding: 'utf8', timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, status: 0, timedOut: false, out }
  } catch (e) {
    const status = typeof e.status === 'number' ? e.status : null
    return {
      code: status == null ? -1 : status,
      status,
      timedOut: !!(e.killed || e.signal),
      out: String(e.stdout || '') + String(e.stderr || ''),
    }
  }
}

function parseStats(out) {
  const m = String(out).match(/passed=(\d+) failed=(\d+)/)
  return m ? { passed: Number(m[1]), failed: Number(m[2]) } : null
}

function tail(text, n) {
  return text.trim().split('\n').slice(-n).join('\n')
}

/* ① 有效性门：未变异副本必须 exit 0 且 failed=0 且 passed>0 */
console.log('有效性门：未变异副本')
const validityDir = copyTree()
const validRun = runSuite(validityDir)
const validStats = parseStats(validRun.out)
console.log('  ' + SUITE + ' exit=' + validRun.code + ' '
  + (validStats ? 'passed=' + validStats.passed + ' failed=' + validStats.failed : '（无 passed/failed 读数）'))
fs.rmSync(validityDir, { recursive: true, force: true })
if (validRun.code !== 0 || !validStats || validStats.failed !== 0 || validStats.passed <= 0) {
  console.log(tail(validRun.out, 12))
  console.log('INVALID：未变异副本没有全绿（exit 0 / failed=0 / passed>0），变异结果无意义')
  process.exit(2)
}

/* ② 逐条变异 */
let escaped = 0
let injected = 0
MUTATIONS.forEach(m => {
  const dir = copyTree()
  const file = path.join(dir, 'miniprogram', 'utils', 'sky.js')
  /* 仓库文件是 CRLF；锚点按可读形式写，匹配前统一成 LF（只影响临时副本） */
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const hits = src.split(m.from).length - 1
  if (hits !== 1) {
    escaped += 1
    console.log('✗ ' + m.id + ' 注入失败：锚点命中 ' + hits + ' 次（应为 1）—— ' + m.name)
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  injected += 1
  fs.writeFileSync(file, src.replace(m.from, m.to))
  const r = runSuite(dir)
  const stats = parseStats(r.out)
  /* 只有「exit 1 + 至少一条 failed + 至少一个 ✗」才算被断言抓住。
     崩溃/超时/无失败读数不是证明：它只说明脚本没跑完。 */
  const caught = r.code === 1 && !!stats && stats.failed > 0 && r.out.indexOf('✗') !== -1
  if (caught) {
    console.log('✓ ' + m.id + ' 被抓住（' + SUITE + ' exit=1 passed=' + stats.passed + ' failed=' + stats.failed + '）—— ' + m.name)
  } else if (r.code === 0) {
    escaped += 1
    console.log('✗ ' + m.id + ' 漏网 —— ' + m.name)
    console.log(tail(r.out, 8))
  } else {
    escaped += 1
    const why = r.timedOut ? '超时' : (r.status == null ? 'e.status == null' : 'exit=' + r.code)
    console.log('✗ ' + m.id + ' 注入导致崩溃/超时，不计为抓住（' + why
      + (stats ? '，failed=' + stats.failed : '，无 passed/failed 读数') + '）—— ' + m.name)
    console.log(tail(r.out, 8))
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log('\n变异 ' + MUTATIONS.length + ' 条 / 注入成功 ' + injected + ' / 漏网 ' + escaped)
process.exit(escaped ? 1 : 0)
