// E2E 结果账本：把「后端状态对不对」和「用户在界面上做没做成」记成两个独立维度。
// 语义定义见 docs/testing/e2e-result-semantics.md；本文件的自证（变异测试）见 tools/e2e-fault-probe-test.js。
//
// 为什么存在（都是实测过的假 PASS 通道，不是理论担忧）：
//   · page.$() 在本环境恒返回单个 Element，$$() 才给数组——旧 queryAll 期待数组，于是所有 tap 静默不发生；
//   · checkSoft 失败既不计 pass 也不计 fail，把「从未通过」洗成「通道退化，跳过」；
//   · 云侧降级完成被测动作后被计入 UI 通过。
// 本账本的结构性约束：UI 维度的一条 PASS 只能由「先记下一次真实 UI 操作，再记下它的观测结果」产生。
'use strict'

const BUSINESS = 'BUSINESS'
const UI = 'UI'
const ENV = 'ENV'
const PASS = 'PASS'
const FAIL = 'FAIL'
const INCONCLUSIVE = 'INCONCLUSIVE'

// 环境不可用（连不上模拟器、云函数没部署）时用它中断剩余流程：不是断言失败，但绝不是 PASS。
class AbortRun extends Error {
  constructor(message) { super(message); this.name = 'AbortRun' }
}

function text(v) {
  if (v === undefined || v === null) return String(v)
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch (e) { return String(v) }
}

function trim(s) { return String(s).replace(/^[\s\r\n]+|[\s\r\n]+$/g, '') }

function createLedger(options) {
  const opts = options || {}
  // dims：本套件承担哪些结论维度。A 层只有 BUSINESS——它的 UI 维度恒 N/A，
  // 因此它的 PASS 永远不能被引用成「UI 已验证」。
  const dims = opts.dims || [BUSINESS, UI]
  const entries = []
  let channel = 'unknown'
  let open = null

  function record(dim, name, state, detail) {
    if (dim !== ENV && dims.indexOf(dim) === -1) throw new Error('本套件未声明维度 ' + dim + '（dims=' + dims.join('/') + '）')
    const entry = { dim, name, state, detail: detail || '', block: open ? open.name : '' }
    entries.push(entry)
    if (open && dim !== ENV) open.recorded++
    const mark = state === PASS ? '✓' : state === FAIL ? '✗' : '·'
    let line = '  ' + mark + ' [' + dim + (state === PASS ? '' : ' ' + state) + '] ' + name
    if (state !== PASS && detail) line += '：' + trim(detail).slice(0, 220)
    console.log(line)
    return entry
  }

  // 没有证据的结论不可审计，一律拒绝记录（PASS 也要说得出凭什么）。
  function requireEvidence(name, evidence) {
    const e = trim(text(evidence))
    if (!e || e === 'undefined' || e === 'null') {
      throw new Error('断言「' + name + '」缺少证据字段——账本拒绝记录无据结论')
    }
    return e
  }

  // UI 观测落账（两个强度都走这里）：证据字段先行，缺证据直接抛错。
  const uRecord = (name, cond, evidence) => {
    const e = requireEvidence(name, evidence)
    return record(UI, name, cond ? PASS : FAIL, e)
  }

  const L = {
    BUSINESS, UI, ENV, PASS, FAIL, INCONCLUSIVE, AbortRun,

    // ---- 元素通道健康度：决定块内异常算「真缺陷」还是「无法验证」----
    setChannel(state, evidence) {
      if (['healthy', 'degraded', 'unknown'].indexOf(state) === -1) throw new Error('未知通道状态：' + state)
      channel = state
      console.log('  · UI 元素通道：' + state + (evidence ? '（' + trim(text(evidence)).slice(0, 160) + '）' : ''))
    },
    channel() { return channel },

    // ---- 业务断言：只能由真实后端返回/回读成立 ----
    b(name, cond, evidence) {
      return record(BUSINESS, name, cond ? PASS : FAIL, requireEvidence(name, evidence))
    },

    // ---- UI 断言：两个强度，按需选择，误用会被 F1 探针抓住 ----
    // u(...)      ：渲染层观测（元素数量/class/文本/page.data），通道健康即可断言，属第 2~3 档证据。
    // uEffect(...)：声称「某个用户操作的后果」——本块必须先有一次成功的真实操作，否则记 INCONCLUSIVE。
    // uiTap/uiInput：真实操作本身，成功才占用操作名额；失败的那一下不算用户路径证据。
    uiTap(name, cond, evidence) {
      if (open) open.actions++
      const entry = uRecord(name, cond, evidence)
      if (entry.state !== PASS && open) open.actions--
      return entry
    },
    uiInput(name, cond, evidence) { return L.uiTap(name, cond, evidence) },
    u(name, cond, evidence) { return uRecord(name, cond, evidence) },
    uEffect(name, cond, evidence) {
      if (open && open.actions === 0) {
        return record(UI, name, INCONCLUSIVE, '本块尚无任何成功的真实 UI 操作，不能声称这是操作的后果：' + requireEvidence(name, evidence))
      }
      return uRecord(name, cond, evidence)
    },
    // UI 该验证却验证不了（fallback 代做、控件查不到、渲染门槛没过）。永不算通过。
    uiUnverified(name, reason) {
      return record(UI, name, INCONCLUSIVE, requireEvidence(name, reason))
    },
    skip(dim, name, reason) {
      return record(dim, name, INCONCLUSIVE, '未执行——' + requireEvidence(name, reason))
    },

    // ---- 环境前置：不成立就中断，绝不带着半截结果报 PASS ----
    env(name, cond, evidence) {
      const e = requireEvidence(name, evidence)
      record(ENV, name, cond ? PASS : INCONCLUSIVE, e)
      if (!cond) throw new AbortRun(name + ' —— ' + e)
      return e
    },

    // planned：本块应记下的断言条数；actions：本块应发生的真实 UI 操作次数（0 = 纯读数块）。
    // 门槛不过 ⇒ 整块按「未验证」留痕；执行条数不足 ⇒ 补一条缺口记录（防「整段静默不执行」）。
    async block(name, planned, run, gate) {
      // gate 只描述「这块能不能跑」；不传 ok 即视为可跑（传 { actions: 1 } 是常态）
      const raw = typeof gate === 'function' ? gate() : (gate || {})
      const guard = Object.assign({ ok: true }, raw)
      const gapDim = guard.dim || (dims.indexOf(UI) !== -1 ? UI : BUSINESS)
      const blk = { name, planned: planned || 0, recorded: 0, actions: 0, plannedActions: guard.actions || 0 }
      if (!guard || guard.ok !== true) {
        const reason = (guard && guard.reason) || '未说明原因'
        console.log('  · [门槛未过] ' + name + '：' + reason + '（计划 ' + blk.planned + ' 项）')
        record(gapDim, name + '（门槛未过，整块未执行）', INCONCLUSIVE, reason)
        return { ran: false, recorded: 0 }
      }
      const prev = open
      open = blk
      try {
        await run(L)
      } catch (err) {
        if (err instanceof AbortRun) throw err
        // 通道健康时的异常是真缺陷；只有通道确认退化才归为无法验证
        if (channel === 'degraded') record(gapDim, name + ' 执行异常（通道退化）', INCONCLUSIVE, text(err && (err.message || err)))
        else record(BUSINESS, name + ' 执行异常', FAIL, text(err && (err.stack || err.message) || err))
      } finally {
        open = prev
      }
      if (blk.recorded < blk.planned) {
        record(gapDim, name + '（计划 ' + blk.planned + ' 项，实际记录 ' + blk.recorded + ' 项）', INCONCLUSIVE,
          '有断言没执行到——静默少记不会被算作通过')
      }
      if (blk.plannedActions > 0 && blk.actions === 0) {
        record(gapDim, name + '（应发生 ' + blk.plannedActions + ' 次真实 UI 操作，实际 0 次）', INCONCLUSIVE,
          'UI 操作未发生，块内读数不能当作 UI 证据')
      }
      return { ran: true, recorded: blk.recorded }
    },

    // ---- 结论 ----
    count(dim, state) { return entries.filter(x => x.dim === dim && x.state === state).length },
    dimVerdict(dim) {
      if (dims.indexOf(dim) === -1) return 'N/A'
      if (L.count(dim, FAIL) > 0) return FAIL
      if (L.count(dim, INCONCLUSIVE) > 0) return INCONCLUSIVE
      if (L.count(dim, PASS) === 0) return INCONCLUSIVE   // 一条都没记上 ≠ 通过了
      return PASS
    },
    verdict() {
      const business = L.dimVerdict(BUSINESS)
      const ui = L.dimVerdict(UI)
      const envBroken = L.count(ENV, INCONCLUSIVE) + L.count(ENV, FAIL) > 0
      let overall = PASS
      if (business === FAIL || ui === FAIL) overall = FAIL
      else if (business === INCONCLUSIVE || ui === INCONCLUSIVE || envBroken) overall = INCONCLUSIVE
      const reasons = entries.filter(x => x.state === INCONCLUSIVE)
        .map(x => x.dim + ' 未验证：' + x.name + (x.detail ? '——' + x.detail : ''))
      return {
        business, ui, overall, reasons,
        counts: {
          BUSINESS: { pass: L.count(BUSINESS, PASS), fail: L.count(BUSINESS, FAIL), unverified: L.count(BUSINESS, INCONCLUSIVE) },
          UI: { pass: L.count(UI, PASS), fail: L.count(UI, FAIL), unverified: L.count(UI, INCONCLUSIVE) },
          ENV: { pass: L.count(ENV, PASS), unverified: L.count(ENV, INCONCLUSIVE) },
        },
        // 与其它 tools/*-test.js 的门禁约定兼容：passed/failed 只数真结论
        passed: L.count(BUSINESS, PASS) + L.count(UI, PASS),
        failed: L.count(BUSINESS, FAIL) + L.count(UI, FAIL),
        unverified: L.count(BUSINESS, INCONCLUSIVE) + L.count(UI, INCONCLUSIVE),
        exitCode: overall === FAIL ? 1 : overall === INCONCLUSIVE ? 2 : 0,
      }
    },
    print() {
      const v = L.verdict()
      const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length))
      console.log('\n==== VERDICT ====')
      console.log(pad('BUSINESS:', 10) + pad(v.business, 13) + '（' + v.counts.BUSINESS.pass + ' 通过 / ' + v.counts.BUSINESS.fail + ' 失败 / ' + v.counts.BUSINESS.unverified + ' 未验证）')
      console.log(pad('UI:', 10) + pad(v.ui, 13) + '（' + v.counts.UI.pass + ' 通过 / ' + v.counts.UI.fail + ' 失败 / ' + v.counts.UI.unverified + ' 未验证）')
      console.log(pad('ENV:', 10) + (v.counts.ENV.pass + v.counts.ENV.unverified) + ' 项前置（' + v.counts.ENV.unverified + ' 项不成立）')
      console.log(pad('OVERALL:', 10) + v.overall)
      if (v.reasons.length) { console.log('reason:'); v.reasons.forEach(r => console.log('  - ' + r)) }
      console.log('passed=' + v.passed + ' failed=' + v.failed + ' unverified=' + v.unverified)
      return v
    },
    entries() { return entries.slice() },
  }
  return L
}

// ===================== 源码完整性自检 =====================
// 逐条对应历史上真实存在过的假 PASS 通道。这是「粗筛」：防止退化被重新合并进来；
// 语义级的判别力自证在 tools/e2e-fault-probe-test.js。

function lineAt(src, index) { return src.slice(0, index).split('\n').length }
function lineText(src, index) { return (src.split('\n')[lineAt(src, index) - 1] || '').trim().slice(0, 140) }

function scanRegex(src, re) {
  const hits = []
  const g = new RegExp(re.source, re.flags.indexOf('g') !== -1 ? re.flags : re.flags + 'g')
  let m
  while ((m = g.exec(src))) hits.push({ line: lineAt(src, m.index), text: lineText(src, m.index) })
  return hits
}

function splitArgs(inner) {
  const out = []
  let depth = 0, quote = '', cur = ''
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (quote) {
      if (c === '\\') { cur += c + (inner[++i] || ''); continue }
      if (c === quote) quote = ''
      cur += c
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

// 断言调用形如 check(name, cond, extra) / L.u(name, cond, evidence)：第二个实参就是结论本身。
// 条件写成字面量 true / !0 / 1 即无条件 PASS，与被测行为无关。
function findLiteralTrueAssertions(src) {
  const hits = []
  const callRe = /(?:\bcheck|(?:\bL|\bledger)\.(?:b|u|uEffect|env|uiTap|uiInput))\s*\(/g
  let m
  while ((m = callRe.exec(src))) {
    const start = m.index + m[0].length
    let depth = 1, i = start, quote = ''
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; i++; continue }
      if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue }
      if (c === '(') depth++
      else if (c === ')') depth--
      i++
    }
    const args = splitArgs(src.slice(start, i - 1))
    // 跨行书写时左括号后紧跟换行 ⇒ 首元素是空白，须先丢掉才对得上「第二个实参 = 结论」
    if (args.length > 1 && trim(args[0]) === '') args.shift()
    if (args.length < 2) continue
    const cond = trim(args[1])
    if (cond === 'true' || cond === '!0' || cond === '1') hits.push({ line: lineAt(src, m.index), text: lineText(src, m.index) })
  }
  return hits
}

// fire-and-forget：await 一条写命令却不接结果。允许紧邻的 .then/.catch 链式处理，
// 但只要结果没被赋值/返回/判 ok 就算漏检。
function findUnusedCommandResults(src) {
  const hits = []
  const re = /^[ \t]*(?:await[ \t]+)(?:cloudCall|converge|robustDispatch|apiCall)[ \t]*\(/gm
  let m
  while ((m = re.exec(src))) hits.push({ line: lineAt(src, m.index), text: trim(m[0]) })
  return hits
}

const LINT_RULES = [
  {
    id: 'WRONG-QUERY-API',
    why: 'page.$() 恒返回单个 Element，$$() 才给数组。E2E 里出现 Array.isArray 说明还在按旧误解写查询（历史 tap 全部静默不发生的根因）。',
    scan: src => scanRegex(src, /Array\.isArray/),
  },
  {
    id: 'SOFT-ASSERTION',
    why: 'checkSoft 失败既不计 pass 也不计 fail，会把「从未通过」洗成「通道退化，跳过」。降级必须走 L.uiUnverified 显式留痕。',
    scan: src => scanRegex(src, /\bcheckSoft\b/),
  },
  {
    id: 'CALLMETHOD-BYPASS',
    why: 'callMethod 直接改组件内部状态，绕开被测控件本身——它做出来的结果不是用户路径，不得计入 UI 通过。',
    scan: src => scanRegex(src, /\.callMethod\s*\(/),
  },
  {
    id: 'EMPTY-CATCH',
    why: '空 catch 会把断言执行异常吞成「这段没跑但也没红」。',
    scan: src => scanRegex(src, /catch\s*\([^)]*\)\s*\{\s*\}/),
  },
  {
    id: 'LITERAL-TRUE-ASSERTION',
    why: '条件写成字面量 true 即无条件 PASS，与被测行为无关。',
    scan: src => findLiteralTrueAssertions(src),
  },
  {
    id: 'UNRECHECKED-COMMAND',
    why: 'fire-and-forget 的命令看不出结果，失败只表现为「后面某步 inexplicably 不对」。',
    scan: src => findUnusedCommandResults(src),
  },
]

function auditSource(src, label) {
  const findings = []
  for (const rule of LINT_RULES) {
    for (const hit of rule.scan(src)) {
      findings.push({ file: label || 'source', rule: rule.id, why: rule.why, line: hit.line, text: hit.text })
    }
  }
  return findings
}

module.exports = {
  createLedger, auditSource, LINT_RULES, AbortRun,
  BUSINESS, UI, ENV, PASS, FAIL, INCONCLUSIVE,
}
