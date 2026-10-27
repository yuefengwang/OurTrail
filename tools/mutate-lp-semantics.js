/* C1（F1+F2 光污染语义合一）的变异自证
 *
 * 对拍（ab-lp-semantics.js）证明"改前 vs 改后"的差异落在允许清单内；
 * 本脚本反过来问：把 C1 的每一条判据分别拆掉，门**必须**红。全绿 = 门是假的。
 *
 * 约定（铁律 31⑥）：
 *   ① 先跑未变异副本，两个套件都必须全绿 —— 否则后面的红都不是变异造成的；
 *   ② 每个锚点必须**恰好命中一次**；0 次或多次都算注入失败，计漏网并 exit 1；
 *   ③ 每条变异只跑能抓住它的那个套件（sky-test / weather-v2-test），
 *      跑不红就是漏网，打印该变异下套件的原始输出便于归因。
 *
 * 运行：node tools/mutate-lp-semantics.js
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
  v2: 'weather-v2-test.js',
  oi: 'oi-claim-gate-test.js',
}

const MUTATIONS = [
  {
    id: 'M1',
    name: '星空 lpMissing 退回 === null（undefined 不再算缺测）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const lp = ctx.lightPollution || null\n'
      + '  const lpMissing = ctx.lightPollution == null\n'
      + '  const lpImpact = lightPollutionImpact(lp)\n'
      + '  score += lpImpact.score\n'
      + '  const lpPoor = lpImpact.poor\n'
      + '  /* 结论句已经点过',
    to: '  const lp = ctx.lightPollution || null\n'
      + '  const lpMissing = ctx.lightPollution === null\n'
      + '  const lpImpact = lightPollutionImpact(lp)\n'
      + '  score += lpImpact.score\n'
      + '  const lpPoor = lpImpact.poor\n'
      + '  /* 结论句已经点过',
  },
  {
    id: 'M2',
    name: '银河 lpMissing 退回 === null',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  /* 与星空同一口径：undefined 与 null 都是「没取到」，都按失败关闭封顶（铁律 26②）。 */\n'
      + '  const lp = ctx.lightPollution || null\n'
      + '  const lpMissing = ctx.lightPollution == null',
    to: '  /* 与星空同一口径：undefined 与 null 都是「没取到」，都按失败关闭封顶（铁律 26②）。 */\n'
      + '  const lp = ctx.lightPollution || null\n'
      + '  const lpMissing = ctx.lightPollution === null',
  },
  {
    id: 'M3',
    name: '星空封顶漏掉 lpPoor（Bortle 8 仍可拿 4 星）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  score = cap69(score, lpMissing || lpPoor)',
    to: '  score = cap69(score, lpMissing)',
  },
  {
    id: 'M4',
    name: '银河封顶漏掉 lpPoor',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  score = cap69(score, lpMissing || lpPoor || moonEffective >= 35)',
    to: '  score = cap69(score, lpMissing || moonEffective >= 35)',
  },
  {
    id: 'M5',
    name: '银河封顶放回方向云 +5 之前（69+5=74 的旧缺陷）',
    file: 'utils/sky.js',
    suite: 'sky',
    /* 旧实现是「先封顶、再加方向云」的两段式；只把早封顶加回来并不会改变行为
       （末位封印仍会兜住），所以这里必须把两步一起还原才构成真正的旧顺序。 */
    edits: [
      {
        from: '  const dirCloud = best.dirCloud\n  const dirHigh',
        to: '  score = cap69(score, ctx.lightPollution == null)\n  const dirCloud = best.dirCloud\n  const dirHigh',
      },
      {
        from: '  score = cap69(score, lpMissing || lpPoor || moonEffective >= 35)',
        to: '  score = cap69(score, moonEffective >= 35)',
      },
    ],
  },
  {
    id: 'M5b',
    name: 'M5 配套：末位封印只留月光（让早封顶无法被覆盖回来）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  score = cap69(score, lpMissing || lpPoor || moonEffective >= 35)',
    to: '  score = cap69(score, moonEffective >= 35)',
  },
  {
    id: 'M6',
    name: 'cap69 上界从 69 挪到 70（封顶失效一格）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const top = GRADES[0].min - 1',
    to: '  const top = GRADES[0].min',
  },
  {
    id: 'M7',
    name: '证据行退回只认显式 null（undefined 时悄悄消失）',
    file: 'utils/conditions.js',
    suite: 'v2',
    from: '      } else if (ctx) {\n        out.push({ fact: \'光污染未计入（无读数）\'',
    to: '      } else if (ctx && ctx.lightPollution === null) {\n        out.push({ fact: \'光污染未计入（无读数）\'',
  },
  {
    id: 'M8',
    name: '星空去重关掉（同一句「光污染较高」印两遍）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const lpNamed = lpPoor && clearRate >= 70\n',
    to: '  const lpNamed = false\n',
  },
  {
    id: 'M9',
    name: '银河去重关掉',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const lpNamed = lpPoor && clearRate >= 70 && !dirHigh && !atmPoor',
    to: '  const lpNamed = false',
  },
  {
    id: 'M10',
    name: '银河去重过头（reason 说别的时也吞掉「光污染较高」）',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const lpNamed = lpPoor && clearRate >= 70 && !dirHigh && !atmPoor',
    to: '  const lpNamed = lpPoor',
  },
  {
    id: 'M12',
    name: 'OI 证据重新注入光污染行（与 nightLimit 的两套口径打架）',
    file: 'utils/outdoor-intelligence.js',
    suite: 'oi',
    from: '  }, { omitLightPollution: true }) }',
    to: '  }) }',
  },
  {
    id: 'M11',
    name: '星空去重过头',
    file: 'utils/sky.js',
    suite: 'sky',
    from: '  const lpNamed = lpPoor && clearRate >= 70\n',
    to: '  const lpNamed = lpPoor\n',
  },
]

function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-c1-mut-'))
  fs.cpSync(SRC, path.join(dir, 'miniprogram'), { recursive: true })
  // weather-v2-test 还直接 require 云函数的 lib/weather（wk-free 解析层），一并复制
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
  const edits = m.edits || [{ from: m.from, to: m.to }]
  let failed = null
  edits.forEach(e => {
    const hits = src.split(e.from).length - 1
    if (hits !== 1) { failed = '锚点命中 ' + hits + ' 次（应为 1）'; return }
    src = src.replace(e.from, e.to)
  })
  if (failed) {
    escaped += 1
    console.log('✗ ' + m.id + ' 注入失败：' + failed + ' —— ' + m.name)
    fs.rmSync(dir, { recursive: true, force: true })
    return
  }
  injected += 1
  fs.writeFileSync(file, src)
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
