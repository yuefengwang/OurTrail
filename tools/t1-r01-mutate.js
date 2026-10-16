// workspace「为什么现在不能推进」渲染门（tools/t1-r01-test.js）的变异自证：
// node tools/t1-r01-mutate.js
//
// 为什么要这份脚本：门全绿只说明"它能跑"，不说明"它咬得住"。这里把
// miniprogram/pages/workspace/workspace.wxml 复制进系统临时目录的沙盒，逐条注入
// 「看起来也像修法」的改动（含两个明确禁止的方向：整行不渲染、拿置灰换说明），
// 要求每一条都被判据抓红。
//
// 四条自证纪律（照仓库既有做法，不是新增）：
// ① 锚点必须命中恰 1 次，否则算**注入失败** —— 记一条漏网并 exit 1，绝不静默改错行充数
//    （本仓是 CRLF，跨行锚点用 '\n' 拼会命中 0 次，铁律 31⑥）；
// ② 先跑未变异的沙盒副本并要求它全绿，且它的 passed= 必须与仓库里的读数相同，
//    否则沙盒不忠实（缺文件/走了别的分支），后面所有结论作废；
// ③ **崩红不算抓到**：判"抓到"的唯一依据是输出里那行 `passed=N failed=M` 且 M>0；
//    门自己抛异常时不打印这行（见 gate 的 catch），那种情况记「崩红」而不是抓到；
// ④ 报"漏网"之前先确认变异体与原件**行为不等价**（等价变异体不构成牙齿，也不构成回归）。
'use strict'
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SUITE = path.join('tools', 't1-r01-test.js')
const TARGET = path.join('miniprogram', 'pages', 'workspace', 'workspace.wxml')

const HINT_LINE = '<text wx:if="{{transitionHint}}" class="small muted" style="display:block;">为什么现在不能推进：{{transitionHint}}</text>'

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
  {
    id: 'W1',
    name: '把 F-01 的原始缺陷请回来：解释行重新挂在 !canTransition 之下（算好的说明对组织者恒不上屏）',
    edits: [['wx:if="{{transitionHint}}"', 'wx:if="{{!canTransition && transitionHint}}"']],
  },
  {
    id: 'W2',
    name: '整行删掉（"看不见就不会错"）：T01 的结构定位应先报 0 个',
    edits: [[HINT_LINE, '']],
  },
  {
    id: 'W3',
    name: '一刀切常驻：条件写成恒真 ⇒ 门槛已清时也硬说一句',
    edits: [['wx:if="{{transitionHint}}"', 'wx:if="{{true}}"']],
  },
  {
    id: 'W4',
    name: '一刀切沉默：条件写成恒假 ⇒ 看起来"没有回归"，其实是整行永不渲染',
    edits: [['wx:if="{{transitionHint}}"', 'wx:if="{{false}}"']],
  },
  {
    id: 'W5',
    name: '半个修法（换了个方向仍绑权限位）：只在按钮可用时才解释',
    edits: [['wx:if="{{transitionHint}}"', 'wx:if="{{canTransition && transitionHint}}"']],
  },
  {
    id: 'W6',
    name: '禁止的方向：门槛未清就把推进按钮置灰并解绑（先例 §4 L4；requests 明写不许用置灰替代说明）',
    edits: [
      ['{{canTransition && !busy ? \'\' : \'disabled\'}}', '{{canTransition && !busy && !transitionHint ? \'\' : \'disabled\'}}'],
      ['{{canTransition && !busy ? \'onTransition\' : \'\'}}', '{{canTransition && !busy && !transitionHint ? \'onTransition\' : \'\'}}'],
    ],
  },
  {
    id: 'W7',
    name: '把兜底行的 wx:elif 换成 wx:if ⇒ 门槛未清且无权限时两行同现（互斥门要红）',
    edits: [['<text wx:elif="{{!canTransition}}"', '<text wx:if="{{!canTransition}}"']],
  },
  {
    id: 'W8',
    name: '在模板里写死那句话（第二个中文出处 + 数字不再是页面交出去的那个）',
    edits: [['为什么现在不能推进：{{transitionHint}}</text>', '为什么现在不能推进：门槛还没清完。</text>']],
  },
  {
    id: 'W9',
    name: '改名式重构顺手换脸：这行的小字灰被改成另一个类（渲染语义被一起改掉）',
    edits: [['class="small muted" style="display:block;">为什么现在不能推进', 'class="body" style="display:block;">为什么现在不能推进']],
  },
]

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-r01-mutate-'))
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

/** 锚点按目标文件自己的 EOL 拼接（数组写法），命中次数必须是恰 1，否则算注入失败。 */
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
    let next = text
    let bad = false
    for (const ed of mut.edits) {
      const find = asAnchor(ed[0], eol)
      const hits = next.split(find).length - 1
      if (hits !== 1) {
        injectionFailed++
        missed++
        console.error('  ✗ ' + mut.id + ' 注入失败：锚点命中 ' + hits + ' 次（要求恰 1 次）——按漏网计，不静默改错行充数')
        bad = true
        break
      }
      next = next.replace(find, asAnchor(ed[1], eol))
    }
    if (bad) continue
    if (next === text) {
      // 全等号 edits（BTN→BTN 这类占位自证）不改变文件：不允许拿"没改动的副本"冒充变异
      injectionFailed++
      missed++
      console.error('  ✗ ' + mut.id + ' 注入失败：改后文件与原件逐字节相同（等于没注入）')
      continue
    }
    fs.writeFileSync(file, next, 'utf8')
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
