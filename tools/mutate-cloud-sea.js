/* C2（F3 云海主卡：民用晨昏裁剪 + 云带分层）的变异自证
 *
 * 对拍（ab-cloud-sea.js）证明"改前 vs 改后"的差异落在允许清单内；
 * 本脚本反过来问：把 C2 的每一条判据分别拆掉，门**必须**红。全绿 = 门是假的。
 *
 * 约定（铁律 31⑥）：
 *   ① 先跑未变异副本：sky-test / outdoor-cloud-sea-test / weather-v2-test 必须全绿——
 *      否则后面的红都不是变异造成的；
 *   ② 每个锚点必须**恰好命中一次**；0 次或多次都算注入失败，计漏网并 exit 1；
 *   ③ 每条变异只跑能抓住它的那个套件，跑不红就是漏网，打印该变异下套件的原始尾巴便于归因。
 *
 * 运行：node tools/mutate-cloud-sea.js
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')
const SUITES = {
  sky: 'sky-test.js',
  sea: 'outdoor-cloud-sea-test.js',
  v2: 'weather-v2-test.js',
}

const MUTATIONS = [
  {
    id: 'M1',
    name: '主卡不做民用晨昏裁剪（退回 window=01:00-05:00）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const list = civilClip(listAll, sun)',
    to: '  const list = listAll',
  },
  {
    id: 'M2',
    name: '只裁起点不裁终点（日落一侧整段留下）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const e = Math.min(end, civil.to)',
    to: '  const e = end',
  },
  {
    id: 'M3',
    name: 'clipRange 边界写成 >=（只在边界相接也当成有交集）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  return e > s ? { from: s, to: e } : null',
    to: '  return e >= s ? { from: s, to: e } : null',
  },
  {
    id: 'M4',
    name: '主卡 window 不裁、只裁文案（窗口仍写 01:00-05:00）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: "  item.window = visible ? windowText(list) : ''",
    to: "  item.window = listAll.length ? windowText(listAll) : ''",
  },
  {
    id: 'M5',
    name: '高云带不封顶（3500 m 带 + 点 4000 m 仍拿 74 = 4 星）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  score = cap69(score, highBand || clippedOut)',
    to: '  score = score',
  },
  {
    id: 'M6',
    name: '封顶误伤低层（无条件 cap69，低层好天也压到 69）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  score = cap69(score, highBand || clippedOut)',
    to: '  score = cap69(score, true)',
  },
  {
    id: 'M7',
    name: '高云带理由句不点「可能不是贴地云海」',
    file: 'utils/sky.js',
    suite: 'sky',
    from: "'云带偏高（底约 ' + Math.round(baseMin) + ' m，可能不是贴地云海）'",
    to: "'云带偏高（底约 ' + Math.round(baseMin) + ' m）'",
  },
  {
    id: 'M8',
    name: '全裁空回退旧归因（把天光不足说成高层云多/风偏大）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const clippedOut = aboveBand && !visible && listAll.length > 0',
    to: '  const clippedOut = false',
  },
  {
    id: 'M9',
    name: 'agenda 公式少 +60（簇末小时少算一小时，单小时簇整段丢）',
    file: 'utils/agenda.js',
    suite: 'v2',
    from: '  const seg = sky.clipRange(sky.hourMin(fromT), sky.hourMin(toT) + 60, civil)',
    to: '  const seg = sky.clipRange(sky.hourMin(fromT), sky.hourMin(toT), civil)',
  },
  {
    id: 'M10',
    name: '缺天文数据时清空（把"判不出"当成"都不可见"）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  if (!civil.ok) return hours.slice()\n  return hours.filter',
    to: '  if (!civil.ok) return []\n  return hours.filter',
  },
  {
    id: 'M11',
    name: '全裁空不封顶（退回只 highBand：文案说"可能性低"，星级仍 88 = 4 星）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  score = cap69(score, highBand || clippedOut)',
    to: '  score = cap69(score, highBand)',
  },
  {
    id: 'M12',
    name: 'clippedOut 去掉「确有标记」前提（高层云遮住、无标记可裁也说成天光不足并封顶）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const clippedOut = aboveBand && !visible && listAll.length > 0',
    to: '  const clippedOut = aboveBand && !visible',
  },
  {
    id: 'M13',
    name: '分层边界 2200 写成 >=（恰好 2200 m 的贴地云带被误封顶）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const highBand = baseMin > 2200',
    to: '  const highBand = baseMin >= 2200',
  },
  {
    id: 'M14',
    name: '云海 verdict 一律 excluded（把"看不见"改判成"判过了不成立"）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  return Object.assign(item, grade(score), { verdict: aboveBand ? VERDICT.POSSIBLE : VERDICT.EXCLUDED })',
    to: '  return Object.assign(item, grade(score), { verdict: VERDICT.EXCLUDED })',
  },
  {
    id: 'M15',
    name: 'civilClip 少 +60（小时不再覆盖 [t,t+60)，边界小时整段丢失）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  return hours.filter(h => clipRange(hourMin(h.t), hourMin(h.t) + 60, civil) !== null)',
    to: '  return hours.filter(h => clipRange(hourMin(h.t), hourMin(h.t), civil) !== null)',
  },
  {
    id: 'M16',
    name: 'clipRange 去掉晨光侧 Math.max（窗口起点退回小时整点，含黑夜里的一段）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const s = Math.max(start, civil.from)',
    to: '  const s = start',
  },
  {
    id: 'M17',
    name: 'agenda 缺天文数据时返回 null（把"判不出"当成"都不可见"）',
    file: 'utils/agenda.js',
    suite: 'v2',
    from: '  if (!civil.ok) return { fromT: fromT, toT: toT }',
    to: '  if (!civil.ok) return null',
  },
  {
    id: 'M18',
    name: 'agenda 簇末补 59 分钟（差一分钟就少覆盖整点边界）',
    file: 'utils/agenda.js',
    suite: 'v2',
    from: '  const seg = sky.clipRange(sky.hourMin(fromT), sky.hourMin(toT) + 60, civil)',
    to: '  const seg = sky.clipRange(sky.hourMin(fromT), sky.hourMin(toT) + 59, civil)',
  },
]

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-c2-mut-'))
  fs.cpSync(SRC, path.join(dir, 'miniprogram'), { recursive: true })
  // weather-v2-test 还直接 require 云函数的 lib/weather（纯解析层），一并复制
  fs.cpSync(path.join(ROOT, 'cloudfunctions/trailApi'), path.join(dir, 'cloudfunctions/trailApi'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'tools'))
  Object.keys(SUITES).forEach(k => {
    fs.copyFileSync(path.join(ROOT, 'tools', SUITES[k]), path.join(dir, 'tools', SUITES[k]))
  })
  return dir
}

function runSuite(dir, suite) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'tools', SUITES[suite])], {
      cwd: dir, encoding: 'utf8', timeout: 120000,
      /* 变异下的失败用例走 console.error：不吞掉它，交给返回值里的 stderr 归因，
         否则每条变异都会把整屏红字喷进本脚本的输出。 */
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : -1, out: String(e.stdout || '') + String(e.stderr || '') }
  }
}

function tail(text, n) {
  return text.trim().split('\n').slice(-n).join('\n')
}

/* ① 有效性门：未变异副本必须全绿 */
console.log('有效性门：未变异副本')
let validity = true
Object.keys(SUITES).forEach(k => {
  const dir = copyTree()
  const r = runSuite(dir, k)
  console.log('  ' + SUITES[k] + ' exit=' + r.code + ' ' + (r.out.match(/passed=\d+ failed=\d+/) || [''])[0])
  if (r.code !== 0) {
    validity = false
    console.log(tail(r.out, 12))
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
if (!validity) {
  console.log('INVALID：未变异副本没有全绿，变异结果无意义')
  process.exit(2)
}

/* ② 逐条变异 */
let escaped = 0
let injected = 0
MUTATIONS.forEach(m => {
  const dir = copyTree()
  const file = path.join(dir, 'miniprogram', m.file)
  /* 仓库文件是 CRLF；锚点按可读的多行写，匹配前统一成 LF（只影响临时副本） */
  let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const hits = src.split(m.from).length - 1
  if (hits !== 1) {
    escaped += 1
    console.log('✗ ' + m.id + ' 注入失败：锚点命中 ' + hits + ' 次（应为 1）—— ' + m.name)
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  injected += 1
  fs.writeFileSync(file, src.replace(m.from, m.to))
  const r = runSuite(dir, m.suite)
  if (r.code !== 0) {
    console.log('✓ ' + m.id + ' 被抓住（' + SUITES[m.suite] + ' exit=' + r.code + '）—— ' + m.name)
  } else {
    escaped += 1
    console.log('✗ ' + m.id + ' 漏网 —— ' + m.name)
    console.log(tail(r.out, 8))
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log('\n变异 ' + MUTATIONS.length + ' 条 / 注入成功 ' + injected + ' / 漏网 ' + escaped)
process.exit(escaped ? 1 : 0)
