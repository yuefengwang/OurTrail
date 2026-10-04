// 变异自证：node tools/e2e-fault-probe-test.js
// 目的不是凑一个漂亮数字，而是逐条回答：「如果这种测试完整性问题真的发生，我们的结果模型会不会变红？」
// 每条探针 = 一个真实故障形态 → 期望被哪种机制捕获 → 实测捕获情况。
//
// 纪律（按 docs/testing/cross-agent-audit.md §4.4 的两条要求）：
//   ① 注入与断言分离：F1 组只从 verdict() 的公开读数下结论，不读账本内部状态，
//      也绝不为通过测试而告诉账本「我正在被测试」；
//   ② 没有判别力的探针不保留：宁可少报几条，也不放「只是测了内部实现细节」的条目充数。
'use strict'

const fs = require('fs')
const path = require('path')
const { createLedger, auditSource, BUSINESS, UI, PASS, FAIL, INCONCLUSIVE } = require('./e2e-result')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

// 一个「本来应当全绿」的基准场景：2 条业务 + 1 次真实 UI 操作 + 1 条 UI 观测（共 4 条，planned=4）。
// 每条探针在它之上做一次变异，然后只看 verdict()。
function runProbe(p) {
  return (async () => {
    const L = createLedger({ dims: p.businessOnly ? [BUSINESS] : [BUSINESS, UI] })

    if (p.envDown) {
      try { L.env('automator 连接开发者工具', false, 'ECONNREFUSED 127.0.0.1:9420') } catch (e) { /* 环境中断：中断即结论 */ }
      return L.verdict()
    }
    if (p.emptyRun) return L.verdict()

    L.setChannel(p.throwDegraded || p.softSkip ? 'degraded' : 'healthy',
      p.throwDegraded || p.softSkip ? '$$ 连续 5 次返回空数组' : '$$ 返回 3 个元素')
    L.env('模拟器可用', true, 'SDKVersion=3.8.12')

    const body = async () => {
      const committed = p.breakBusiness ? { ok: false, error: { code: 'SEAT_TAKEN' } } : { ok: true, data: { revision: 7 } }
      L.b('assignment.commit → ok 且 revision 推进', committed.ok === true && committed.data.revision === 7, JSON.stringify(committed))
      if (p.dropBusiness) return
      const transport = { assignments: [{ signupId: 's1' }, { signupId: 's2' }] }
      L.b('readTransport 回读到 2 条安排', transport.assignments.length === 2, JSON.stringify({ n: transport.assignments.length }))
      if (p.businessOnly) return
      if (p.silentShortfall) return
      // —— 真实用户路径：先记录操作本身，再记录它的后果（uEffect）——
      // 反向基准：块里第一条 UI 断言可以是纯渲染观测（不依赖任何操作），它必须照样能 PASS，
      // 否则模型会退化成「逢读数即未验证」的噪声源，很快被人忽略。
      if (p.renderFirst) L.u('四个分区 tab 渲染（无操作的前置读数）', true, '.seg 命中 4 个')
      if (p.noRealAction) { L.uEffect('弹层出现差异行', true, 'page.data().planRows=2（无 tap 记录）'); return }
      const overlayRows = p.launderWithFallback ? 0 : 2
      L.uiTap('点「预览自动分车」按钮', overlayRows > 0 || p.tautologyViaLedger || p.unverifiedThenPass, 'tap .button.primary.block @ transport-panel')
      if (p.launderWithFallback) {
        // 历史 R3 的写法：UI 没做成 → 云侧命令代做 → 还想计入 UI 通过
        L.b('云侧降级 previewAssignments+assignment.commit → ok', true, JSON.stringify({ ok: true }))
        L.uEffect('分车提交经真实 UI 完成', true, 'fallback 兜底成功')
        return
      }
      if (p.tautologyViaLedger) { L.u('弹层出现差异行', true, '无条件记为通过'); return }
      if (p.unverifiedThenPass) { L.uiUnverified('名单面板可见', 'overlay 子树查不到 slot'); L.u('名单面板可见', true, 'page.data 正常'); return }
      if (p.softSkip) { L.uiUnverified('座位示意渲染已占座', '元素查询通道退化，未执行'); return }
      L.uEffect('弹层出现差异行', overlayRows === 2, 'overlay .list-row 数量=' + overlayRows)
    }

    // planned = 基准场景应记下的条数（A 层口径只到业务断言为止，故 2 条）
    const planned = p.businessOnly ? 2 : 4
    if (p.gateFails) await L.block('履约链', planned, body, { ok: false, reason: '工作台 denied，面板未渲染' })
    else await L.block('履约链', planned, body, { actions: p.softSkip || p.businessOnly ? 0 : 1 })

    if (p.throwHealthy || p.throwDegraded) {
      await L.block('抛错块', 1, async () => { throw new TypeError('L.textWidth is not a function') }, { actions: 0 })
    }
    return L.verdict()
  })()
}

// —— 期望值是探针自己按语义规则推出来的，不是账本回读 ——
const PROBES = [
  { id: 'F1-01', real: '基准健康会话（无变异）——先证明模型本身能给出 PASS',
    expect: { business: PASS, ui: PASS, overall: PASS, exitCode: 0 } },
  { id: 'F1-02', real: '删掉一条业务断言（历史事故：整段没跑但计数照加）', dropBusiness: true,
    expect: { overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-03', real: '后端返回错误却被当成通过（envelope 不看 ok）', breakBusiness: true,
    expect: { business: FAIL, overall: FAIL, exitCode: 1 } },
  { id: 'F1-04', real: 'UI 观测写成恒真（历史 R4：check(name, true)）', tautologyViaLedger: true,
    expect: { overall: PASS, exitCode: 0 }, note: '账本看不见恒真条件——必须由 LINT 层抓（F2-02），二者缺一不可' },
  { id: 'F1-05', real: 'UI FAIL 之后用云侧 fallback 把结果改记成通过（历史 R3）', launderWithFallback: true,
    expect: { ui: FAIL, overall: FAIL, exitCode: 1 } },
  { id: 'F1-06', real: '整段因渲染门槛不过静默不执行（历史 R5：if (!ok) 直接跳过）', gateFails: true,
    expect: { ui: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-07', real: '门槛过了但块内提前 return，少记一条（半截绿）', silentShortfall: true,
    expect: { ui: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-08', real: '元素查询恒空 ⇒ tap 从未发生，读数却来自 page.data（历史 R1）', noRealAction: true,
    expect: { ui: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-09', real: 'checkSoft 把「从未通过」降级成「通道退化，跳过」（历史 R2）', softSkip: true,
    expect: { ui: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-10', real: '云函数没部署 / 连不上模拟器 ⇒ 环境故障，不是业务失败', envDown: true,
    expect: { business: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-11', real: '健康通道下块内抛异常（真缺陷，不许吞成未验证）', throwHealthy: true,
    expect: { overall: FAIL, exitCode: 1 } },
  { id: 'F1-12', real: '通道确认退化时块内抛异常 ⇒ 只能记未验证，不得记 PASS', throwDegraded: true,
    expect: { ui: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-13', real: '一条断言都没记（脚本跑完但什么都没验）', emptyRun: true,
    expect: { business: INCONCLUSIVE, ui: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-14', real: 'A 层（纯服务链路）的 UI 维度必须显式 N/A，不许被引用成「UI 已验证」', businessOnly: true,
    expect: { business: PASS, ui: 'N/A', overall: PASS, exitCode: 0 } },
  { id: 'F1-15', real: '先记 UI 未验证，之后又补一条 UI PASS 想洗白', unverifiedThenPass: true,
    expect: { ui: INCONCLUSIVE, overall: INCONCLUSIVE, exitCode: 2 } },
  { id: 'F1-16', real: '反向基准：块内第一条 UI 断言是不依赖操作的纯渲染读数（.seg 数量）——必须仍能 PASS，否则模型退化成噪声源', renderFirst: true,
    expect: { ui: PASS, overall: PASS, exitCode: 0 } },
]

function driftOf(v, expect) {
  for (const k of ['business', 'ui', 'overall', 'exitCode']) {
    if (expect[k] !== undefined && v[k] !== expect[k]) return '期望 ' + k + '=' + expect[k] + '，实测 ' + v[k]
  }
  return ''
}

// —— 源码自检层的探针：被测对象就是 lint 本身，注入与断言允许同处一条 ——
const CLEAN_FIXTURE = [
  'const els = await page.$$(\'.seg\')',
  'L.b(\'建活动 ok\', created.ok === true, JSON.stringify(created))',
  'const rows = await overlay.$$(\'.list-row\')',
  'L.u(\'弹层出差异行\', rows.length > 0, \'差异行数 \' + rows.length)',
  'L.uiTap(\'点预览按钮\', btn !== null, \'tap .button.primary.block\')',
  'const cm = await cloudCall(\'trailApi\', \'dispatch\', { payload })',
  'L.b(\'提交落库\', cm.ok === true, JSON.stringify(cm))',
  'try { await run() } catch (e) { L.uiUnverified(\'控件路径\', String(e.message)) }',
].join('\n')

const LINT_PROBES = [
  { id: 'F2-00', desc: '负向对照：合规写法不得报错（防止自检恒红）', inject: null, expectRule: null },
  { id: 'F2-01', desc: 'check(name, true) 无条件 PASS（历史 R4）', inject: 'check(\'名单行数对账\', true)', expectRule: 'LITERAL-TRUE-ASSERTION' },
  { id: 'F2-02', desc: 'L.u(name, true, evidence) 换皮的恒真断言', inject: 'L.u(\'弹层出差异行\', true, \'截图为证\')', expectRule: 'LITERAL-TRUE-ASSERTION' },
  { id: 'F2-03', desc: '跨行书写的恒真断言（不能只按单行匹配）', inject: 'L.b(\n  \'回读一致\',\n  true,\n  JSON.stringify(tr))', expectRule: 'LITERAL-TRUE-ASSERTION' },
  { id: 'F2-04', desc: '断言名里带逗号和引号时参数切分仍正确', inject: 'check(\'回读「安排, 两条」一致\', true, JSON.stringify(x))', expectRule: 'LITERAL-TRUE-ASSERTION' },
  { id: 'F2-05', desc: 'page.$() 当数组用（历史 R1，tap 静默不发生的根因）', inject: 'const r = await page.$(\'.seg\'); if (Array.isArray(r)) return r', expectRule: 'WRONG-QUERY-API' },
  { id: 'F2-06', desc: 'checkSoft 降级洗白（历史 R2）', inject: 'checkSoft(\'座位示意\', segs.length === 4)', expectRule: 'SOFT-ASSERTION' },
  { id: 'F2-07', desc: 'callMethod 绕过真实控件（伪用户路径）', inject: 'await scrubber.callMethod(\'onChanging\', { detail: { value: 570 } })', expectRule: 'CALLMETHOD-BYPASS' },
  { id: 'F2-08', desc: '空 catch 吞掉执行异常（历史 R9）', inject: 'try { await tapIt() } catch (e) {}', expectRule: 'EMPTY-CATCH' },
  { id: 'F2-09', desc: 'fire-and-forget 命令不看返回值（历史 R6）', inject: '  await cloudCall(\'trailApi\', \'dispatch\', { payload })', expectRule: 'UNRECHECKED-COMMAND' },
  { id: 'F2-10', desc: '负向对照：命令结果被赋值就不算漏检', inject: '  const r2 = await cloudCall(\'trailApi\', \'dispatch\', { payload })', expectRule: null },
]

async function main() {
  section('F1 结果语义账本（变异 → verdict 必须变化）')
  for (const p of PROBES) {
    const v = await runProbe(p)
    const drift = driftOf(v, p.expect)
    check(p.id + ' ' + p.real + ' → ' + Object.keys(p.expect).map(k => k + '=' + p.expect[k]).join(' '), drift === '', drift)
    if (p.note) console.log('      注：' + p.note)
  }

  section('F2 源码完整性自检（注入违规 → 必须被指认）')
  for (const lp of LINT_PROBES) {
    const src = CLEAN_FIXTURE + '\n' + (lp.inject || '') + '\n'
    const findings = auditSource(src, 'fixture')
    if (lp.expectRule === null) {
      check(lp.id + ' ' + lp.desc + ' → 0 findings', findings.length === 0, JSON.stringify(findings.slice(0, 2)))
    } else {
      check(lp.id + ' ' + lp.desc + ' → ' + lp.expectRule, findings.filter(f => f.rule === lp.expectRule).length > 0,
        JSON.stringify(findings.slice(0, 3)))
    }
  }

  section('F3 当前工作树门禁（两套 E2E 源码必须 0 违规）')
  for (const t of ['e2e-test.js', 'e2e-ui-test.js']) {
    const file = path.join(__dirname, t)
    if (!fs.existsSync(file)) { check('F3 ' + t + ' 存在', false, '文件缺失'); continue }
    const findings = auditSource(fs.readFileSync(file, 'utf8'), t)
    check('F3 ' + t + ' 源码完整性', findings.length === 0,
      findings.slice(0, 6).map(f => f.rule + ':' + f.line).join(' | '))
  }

  section('F4 判别力负向对照（防护撤掉后同一变异就不再被捕获）')
  const guarded = await runProbe(PROBES.find(x => x.id === 'F1-07'))
  const L2 = createLedger({ dims: [BUSINESS, UI] })
  L2.setChannel('healthy', '对照')
  L2.env('模拟器可用', true, '对照')
  // 同一处提前 return，但块没有声明 planned（=旧脚本的写法）：账本无从知道少记了一条
  await L2.block('无 planned 声明的块', 0, async () => {
    L2.b('业务 1', true, '对照')
    L2.uiTap('UI 操作 1', true, 'tap .x')
    L2.u('UI 观测 1', true, '对照')
    return
  }, { actions: 1 })
  const unguarded = L2.verdict()
  check('F4 有 planned 声明时静默少记 = ' + INCONCLUSIVE, guarded.overall === INCONCLUSIVE, '实测 ' + guarded.overall)
  check('F4 撤掉声明后同形场景 = PASS（证明防护是承重的，探针不是永远红）', unguarded.overall === PASS, '实测 ' + unguarded.overall)

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => { console.error('fault probe 执行异常：', e && (e.stack || e.message || e)); process.exit(1) })
