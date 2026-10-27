// workspace 渲染门（F-01/M-19 页面侧）的变异自证：node tools/workspace-gate-mutate.js
//
// 为什么要这份脚本：tools/workspace-gate-test.js 全绿只说明"它能跑"，不说明"它咬得住"。
// 这里把 miniprogram/pages/workspace/workspace.js 复制进系统临时目录的沙盒，逐条注入
// 「看起来也像修法」的改动（含两个明确禁止的方向：置灰按钮、页面自己编造说明），
// 要求每一条都被判据抓红。
//
// 三条自证纪律（照仓库既有做法，不是新增）：
// ① 锚点必须命中恰 1 次，否则算注入失败 —— 记一条漏网并 exit 1，绝不静默改错行充数；
// ② 先跑未变异的沙盒副本并要求它全绿，且它的 passed= 必须与仓库里的读数相同，
//    否则沙盒本身不忠实（缺文件/走了别的分支），后面所有结论作废；
// ③ **崩红不算抓到**：判"抓到"的唯一依据是输出里那行 `passed=N failed=M` 且 M>0；
//    门自己抛异常时不打印这行（见 gate 的 catch），那种情况记「崩红」而不是抓到。
'use strict'
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SUITE = path.join('tools', 'workspace-gate-test.js')
const TARGET = path.join('miniprogram', 'pages', 'workspace', 'workspace.js')

// 沙盒需要的全集：门 require 到的每一个文件都要带进去，否则"跑不起来"会被误读成"抓到了"。
const FILES = [
  TARGET,
  path.join('miniprogram', 'config.js'),
  path.join('miniprogram', 'utils', 'api.js'),
  path.join('miniprogram', 'utils', 'journey.js'),
  path.join('miniprogram', 'utils', 'format.js'),
  path.join('miniprogram', 'pages', 'workspace', 'workspace.js'),
  SUITE,
  path.join('tools', 'lifecycle-harness.js'),
].concat(fs.readdirSync(path.join(ROOT, 'cloudfunctions', 'trailApi', 'domain'))
  .filter(f => f.endsWith('.js'))
  .map(f => path.join('cloudfunctions', 'trailApi', 'domain', f)))

const MUTATIONS = [
  { id: 'M1', name: '摘掉接缝：不再把欠结论人数交给 journey（F-01 的原始缺陷形态）',
    find: ['        notVerified,', '      })'], replace: ['        // （变异位）', '      })'] },
  { id: 'M2', name: '接缝留下但永远交 0（把"没结论"读成"没人欠结论"）',
    find: ['        notVerified,', '      })'], replace: ['        notVerified: 0,', '      })'] },
  { id: 'M3', name: '从 counters 猜人数（unchecked 被当成出发结论 ⇒ 影子改写门要红）',
    find: ['        notVerified,', '      })'],
    replace: ['        notVerified: (v.counters.unchecked || 0),', '      })'] },
  { id: 'M4', name: '口径放宽：把 coordinating 也算成欠结论（假指控）',
    find: "confirmed.filter(r => r.departure === 'unknown')",
    replace: "confirmed.filter(r => r.departure !== 'joined')" },
  { id: 'M5', name: '口径放宽：不分报名状态，整份 rows 都数（取消的人也算进去）',
    find: 'const notVerified = confirmed.filter(', replace: 'const notVerified = rows.filter(' },
  { id: 'M6', name: '禁止的方向：门槛不满足就把主按钮置灰（先例 §4 L4）',
    find: "canTransition: !!next && v.permittedActions.indexOf('activity.transition') !== -1,",
    replace: "canTransition: !!next && !blocker && v.permittedActions.indexOf('activity.transition') !== -1," },
  { id: 'M7', name: '无下一步时页面自己编一句说明（渲染门改对后会与兜底行两行同现）',
    find: 'transitionHint: blocker,', replace: "transitionHint: blocker || '这一步现在还不能做。'," },
  { id: 'M8', name: '页面替 journey 补数字（第二处措辞＝第二个出处）',
    find: 'transitionHint: blocker,',
    replace: "transitionHint: blocker ? blocker + '（还差 ' + notVerified + ' 人）' : blocker," },
  { id: 'M9', name: '给 counters 塞影子键 unresolved（绕过"counters 键必须能在投影里找到出处"那条防漂门）',
    find: 'next, counters: v.counters, unassignedBoarding',
    replace: 'next, counters: Object.assign({}, v.counters, { unresolved: notVerified }), unassignedBoarding' },
  { id: 'M10', name: 'journey 沉默时页面凭空造出说明（把无拦路说成有拦路）',
    find: 'transitionHint: blocker,',
    replace: "transitionHint: blocker || (notVerified + ' 人没有出发结论。')," },
]

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm19-mutate-'))
  for (const rel of new Set(FILES)) {
    const from = path.join(ROOT, rel)
    const to = path.join(dir, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
  return dir
}

function run(dir) {
  const r = cp.spawnSync(process.execPath, [SUITE], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const out = (r.stdout || '') + (r.stderr || '')
  const m = out.match(/passed=(\d+)\s+failed=(\d+)/)
  return {
    code: r.status,
    passed: m ? Number(m[1]) : null,
    failed: m ? Number(m[2]) : null,
    crashed: !m,
    tail: out.split(/\r?\n/).filter(l => l.indexOf('✗') !== -1).slice(0, 4).join(' ｜ '),
  }
}

/**
 * 锚点支持"多行"写法（数组），按目标文件自己的 EOL 拼接。
 * 原因不是讲究而是教训：本仓是 CRLF，第一版用 `…notVerified,\n` 当锚点命中 0 次，
 * 三条变异以"注入失败"的面目混了过去（铁律 31⑥：跨行锚点在 CRLF 文件里命中 0 次＝等于没注入）。
 */
function asAnchor(x, eol) { return Array.isArray(x) ? x.join(eol) : x }
function eolOf(text) { return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n' }

function main() {
  console.log('== 0. 有效性门：沙盒必须与仓库读数一致且全绿 ==')
  const base = run(ROOT)
  if (base.crashed || base.failed !== 0) {
    console.error('✗ 仓库里的门本身没有全绿（failed=' + base.failed + ' code=' + base.code + '），本次自证作废')
    process.exit(1)
  }
  console.log('  ✓ 仓库门 passed=' + base.passed + ' failed=0')
  {
    const dir = makeSandbox()
    const fresh = run(dir)
    if (fresh.crashed || fresh.failed !== 0 || fresh.passed !== base.passed) {
      console.error('✗ 沙盒副本不忠实（passed=' + fresh.passed + ' failed=' + fresh.failed + ' vs ' + base.passed + '），本次自证作废：' + fresh.tail)
      process.exit(1)
    }
    console.log('  ✓ 未变异沙盒 passed=' + fresh.passed + ' failed=0（沙盒与仓库同读数）')
  }

  console.log('\n== 1. 逐条注入 ==')
  let caught = 0
  let missed = 0
  let broken = 0
  let injectionFailed = 0
  for (const mut of MUTATIONS) {
    const dir = makeSandbox()
    const file = path.join(dir, TARGET)
    const text = fs.readFileSync(file, 'utf8')
    const eol = eolOf(text)
    const find = asAnchor(mut.find, eol)
    const replace = asAnchor(mut.replace, eol)
    const hits = text.split(find).length - 1
    if (hits !== 1) {
      injectionFailed++
      missed++
      console.error('  ✗ ' + mut.id + ' 注入失败：锚点命中 ' + hits + ' 次（要求恰 1 次）——按漏网计，不静默改错行充数')
      continue
    }
    fs.writeFileSync(file, text.replace(find, replace), 'utf8')
    const r = run(dir)
    if (r.crashed) {
      broken++
      missed++
      console.error('  ! ' + mut.id + ' 崩红（门自己抛异常，没有打印 passed=）——**不算抓到**：' + r.tail)
      continue
    }
    if (r.failed > 0) {
      caught++
      console.log('  ✓ ' + mut.id + ' 被抓到（failed=' + r.failed + '）：' + mut.name)
      console.log('      ' + r.tail)
    } else {
      missed++
      console.error('  ✗ ' + mut.id + ' 漏网（passed=' + r.passed + ' failed=0）：' + mut.name)
    }
  }

  console.log('\n==== 变异 ' + MUTATIONS.length + ' 条：抓到 ' + caught
    + '，漏网 ' + missed + '（其中崩红 ' + broken + '、注入失败 ' + injectionFailed + '）====')
  console.log('说明：漏网要先确认变异体与原件行为不等价（等价变异体不构成牙齿，也不构成回归）。')
  process.exit(missed ? 1 : 0)
}

main()
