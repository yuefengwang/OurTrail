/* F7（C6：彩虹太阳下限 + 反日无雨封 44）的变异自证
 *
 * 对拍（ab-rainbow.js）证明"改前 vs 改后"的差异落在允许清单内；本脚本反过来问：
 * 把 C6 的每一条口径分别拆掉，门**必须**红。全绿 = 门是假的。
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
 * 十八条变异：
 *   M1 太阳下限恢复旧界 -2——§18b 海平面「08:00 不再有标记」应红；
 *   M2 太阳下限改 0（过严）——§18b 1200 m 正对照 08:00 与黄昏 18:00 应红；
 *   M3 不封顶（grade(score)）——§18 dry1h 50 / dry3h 60 应红；
 *   M4 cap44 的上限改成 GRADES[1].min（45）——dry 45 应红；
 *   M5 无条件封顶（cap44(score, true)）——wet1h 80 / wet3h 100 应红；
 *   M6 有湿边界放宽（wetHours <= 1）——wet1h 80 应红；
 *   M7 cap44 里 return score（空封）——dry 50/60 应红；
 *   M8 SUN_HORIZON - 1（过严；海平面视地平线 -1.833° 仍收 08:00）——§18b 应红；
 *   M9 cap44 放在 list.length 加分之前（封后再 +10）——dry3h 54 应红；
 *   M10 去掉海拔俯角（只留 A.SUN_HORIZON）——1200 m 正对照的 08:00 被删，§18b 应红；
 *   M11 俯角后再 +1（过严：1200 m 视地平线 -0.945°）——1200 m 08:00 被删，§18b 应红；
 *   M12 去掉 `directional &&` 守卫——非方向性高湿 60 被封成 44，§18c 应红；
 *   M13 俯角钳到 1.5°——3004 m 视地平线从 -2.592 抬到 -2.333，19:00 被误删，§18c 应红；
 *   M14 方向读数 some → every——混合覆盖退回单点口径（90 分 + 另一套文案），§18c 应红；
 *   M15 wetHours 的 precip/pop 两臂 || → &&——precip-only（缺 pop）不再计湿，§18c 应红；
 *   M16 cap44 上限 GRADES[1].min - 2（43）——cap44(45,true) 应返回 43，§18 单元断言红；
 *   M17 precip 阈值 0.05 → 0.5——precip-only 的 0.5 mm/h 不再计湿，§18c 应红。
 *   M18 缺测不披露（dirPartial 恒 false）——混合覆盖仍写「反日方向未检出降水」，
 *       把部分时段的方向未知印成否定事实，§18c「部分时段无方向读数」应红；
 *       precip-only 的阴性对照不受影响（它本来就要求不追加），所以只有混合覆盖能抓它。
 *
 * M10/M11 是第一轮漏掉俯角的回归牙齿：海平面夹具对它们无感（dip=0），
 * 只有 1200 m 正对照能抓住——这也正是第二轮新增那条对照的原因。
 *
 * 运行：node tools/mutate-rainbow.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')
const SUITE = 'sky-test.js'

const CAP44_GRADE_BLOCK = '  if (list.length >= 3) score += 10\n'
  + '  /* 反日方向**明确有读数**、却没有任何湿小时 ⇒ 文案写「条件不足」，星级必须与措辞一致。\n'
  + '     封顶放在全部加分之后（含 list.length>=3 的 +10），否则 3 小时以上的反日无雨\n'
  + '     会从 60 分「条件一般」再爬回「条件较好」。有湿小时（wetHours > 0）完全不动。 */\n'
  + '  const g = grade(cap44(score, directional && wetHours === 0))\n'

const RB_COND = 'solar.altitude < 40 && solar.altitude > rainbowHorizon && wet && sunVisible'
const RB_FLOOR = 'const rainbowHorizon = A.SUN_HORIZON - A.horizonDip(elevation)'

const MUTATIONS = [
  {
    id: 'M1',
    name: '太阳下限恢复旧界 -2（地平线下 2° 又给彩虹标记）',
    from: RB_COND,
    to: 'solar.altitude < 40 && solar.altitude > -2 && wet && sunVisible',
  },
  {
    id: 'M2',
    name: '太阳下限改 0（过严，压在地平线上的太阳不再给标记）',
    from: RB_COND,
    to: 'solar.altitude < 40 && solar.altitude > 0 && wet && sunVisible',
  },
  {
    id: 'M3',
    name: '不封顶（grade(score)）',
    from: '  const g = grade(cap44(score, directional && wetHours === 0))',
    to: '  const g = grade(score)',
  },
  {
    id: 'M4',
    name: 'cap44 的上限写成 GRADES[1].min（45，仍算「条件一般」）',
    from: 'function cap44(score, cond) {\n  const top = GRADES[1].min - 1',
    to: 'function cap44(score, cond) {\n  const top = GRADES[1].min',
  },
  {
    id: 'M5',
    name: '无条件封顶（cap44(score, true)）',
    from: 'cap44(score, directional && wetHours === 0)',
    to: 'cap44(score, true)',
  },
  {
    id: 'M6',
    name: '有湿边界放宽（wetHours <= 1 也封）',
    from: 'cap44(score, directional && wetHours === 0)',
    to: 'cap44(score, directional && wetHours <= 1)',
  },
  {
    id: 'M7',
    name: 'cap44 空封（return score）',
    from: 'function cap44(score, cond) {\n  const top = GRADES[1].min - 1\n  return cond && score > top ? top : score',
    to: 'function cap44(score, cond) {\n  const top = GRADES[1].min - 1\n  return score',
  },
  {
    id: 'M8',
    name: 'SUN_HORIZON - 1（过严，海平面 08:00 仍被标记）',
    from: RB_COND,
    to: 'solar.altitude < 40 && solar.altitude > A.SUN_HORIZON - 1 && wet && sunVisible',
  },
  {
    id: 'M9',
    name: 'cap44 放在 list.length 加分之前（封后再 +10 ⇒ dry3h 54）',
    from: CAP44_GRADE_BLOCK,
    to: '  score = cap44(score, directional && wetHours === 0)\n'
      + '  if (list.length >= 3) score += 10\n'
      + '  const g = grade(score)\n',
  },
  {
    id: 'M10',
    name: '去掉海拔俯角（A.SUN_HORIZON）——1200 m 的 08:00 被误删',
    from: RB_FLOOR,
    to: 'const rainbowHorizon = A.SUN_HORIZON',
  },
  {
    id: 'M11',
    name: '俯角后再 +1（过严）——1200 m 的 08:00 被误删',
    from: RB_FLOOR,
    to: RB_FLOOR + ' + 1',
  },
  {
    id: 'M12',
    name: '去掉 directional 守卫——非方向性高湿 60 被封成 44',
    from: 'cap44(score, directional && wetHours === 0)',
    to: 'cap44(score, wetHours === 0)',
  },
  {
    id: 'M13',
    name: '俯角钳到 1.5°——3004 m 的 19:00 被误删',
    from: 'A.horizonDip(elevation)',
    to: 'Math.min(1.5, A.horizonDip(elevation))',
  },
  {
    id: 'M14',
    name: '方向读数 some → every——混合覆盖退回单点口径',
    from: 'dirWet.some(x => x.precip != null || x.pop != null)',
    to: 'dirWet.every(x => x.precip != null || x.pop != null)',
  },
  {
    id: 'M15',
    name: 'wetHours 的 precip/pop 两臂 || → &&——precip-only 不再计湿',
    from: '(x.precip != null && x.precip > 0.05) || (x.pop != null && x.pop >= 50)',
    to: '(x.precip != null && x.precip > 0.05) && (x.pop != null && x.pop >= 50)',
  },
  {
    id: 'M16',
    name: 'cap44 上限 GRADES[1].min - 2（43）——cap44(45,true) 不再是 44',
    from: 'const top = GRADES[1].min - 1',
    to: 'const top = GRADES[1].min - 2',
  },
  {
    id: 'M17',
    name: 'precip 阈值 0.05 → 0.5——precip-only 的 0.5 mm/h 不再计湿',
    from: 'x.precip > 0.05',
    to: 'x.precip > 0.5',
  },
  {
    id: 'M18',
    name: '缺测不披露（dirPartial 恒 false）——部分覆盖被印成「未检出」',
    from: 'const dirPartial = directional && dirWet.some(x => x.precip == null && x.pop == null)',
    to: 'const dirPartial = false',
  },
]

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-rainbow-mut-'))
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

/* ① 有效性门：未变异副本必须 exit 0 且 failed=0 且 passed>=250（防套件静默少跑） */
console.log('有效性门：未变异副本')
const validityDir = copyTree()
const validRun = runSuite(validityDir)
const validStats = parseStats(validRun.out)
console.log('  ' + SUITE + ' exit=' + validRun.code + ' '
  + (validStats ? 'passed=' + validStats.passed + ' failed=' + validStats.failed : '（无 passed/failed 读数）'))
fs.rmSync(validityDir, { recursive: true, force: true })
if (validRun.code !== 0 || !validStats || validStats.failed !== 0 || validStats.passed < 250) {
  console.log(tail(validRun.out, 12))
  console.log('INVALID：未变异副本没有全绿（exit 0 / failed=0 / passed>=250），变异结果无意义')
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
