// T5b/E-08 续批五条门的断言套件：node tools/e08-remaining-test.js
//
// 测什么（缺一条就不算这条门存在过，口径沿用 tools/t4-e08-test.js 的六段形态）：
//  §0 五条门都可运行、都没有 fatal（判据抛错＝红，不＝通过）
//  §1 落门安全闸：进了 check.js 的四条必须真实仓库命中 0；没进的 G11 必须**确实还有活体**
//     （活体归零的那一天本套件会红，提醒落门——BLOCKED 不是一个可以悄悄躺着的状态）
//  §2 门确有样本可判（空转的门比没有门更危险，check.js:131 的路径分隔符教训）
//  §3 解析底座：注释/字符串/at-rule/简写四边展开/properties 读取都不许把输入读成空气
//  §4 夹具自证（34 组）：正例必红 + 反例必绿 + 阈值单源跟着改
//  §5 接线检查：判据装在没人跑的门里等于没有门 ⇒ 必须真挂在 tools/check.js 的预提交闸上，
//     且本批对 check.js 是**只增不改**
//  §6 B0 复验：overlay.wxss 那条等价收敛的终值读数与承重墙原文（工作项 B 的门禁化那一半）
//
// 「摘掉这段门 ⇒ 同一份合成违例在旧门下一片绿」属于变异自证的职责：node tools/e08-remaining-mutate.js
'use strict'
const fs = require('fs')
const path = require('path')
const E08 = require('./e08-remaining-rules')
const T4 = require('./t4-e08-platform-rules')
const EV = require('./fixround2-event-attr-rule')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const CHECK_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'check.js'), 'utf8')
const RULE_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'e08-remaining-rules.js'), 'utf8')

let passed = 0, failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function note(t) { console.log('  · ' + t) }

const ctx = E08.makeCtx(MP)
const results = {}
// 顶部结构闸：判据模块被摘空/替换（导出空 RULES 或 GATED 条数不对）时，本套件必须**报红**而不是 TypeError 崩——
// 崩了就没法把「门坏了」与「跑挂了」分开（verify.txt §4.2 就是拿摘空副本打这一条的）。
if (!Array.isArray(E08.RULES) || E08.RULES.length !== 5 || !Array.isArray(E08.GATED) || E08.GATED.length !== 4) {
  console.error('  ✗ 判据模块导出的不是「5 条 RULES + 4 条 GATED」（实际 RULES=' +
    ((E08.RULES || []).length) + ' GATED=' + ((E08.GATED || []).length) + '）⇒ 本批的门已被摘空或改名')
  console.log('\n==== passed=0 failed=1 ====')
  process.exit(1)
}
for (const r of E08.RULES) {
  try { results[r.id] = r.run(ctx) } catch (e) { results[r.id] = { hits: [], fatal: '判据抛错：' + e.message } }
}
const hitOf = id => (results[id].hits || []).length

/* ================= §0 五条门都可运行 ================= */
section('§0 五条门都可运行（G11 不进门也必须能跑，否则阻塞状态无从复量）')
check('RULES 导出 5 条：G3/G6/G7/G8/G11', E08.RULES.length === 5 && E08.RULES.map(r => r.id).join(',') === 'G3,G6,G7,G8,G11',
  E08.RULES.map(r => r.id).join(','))
check('GATED（接进 check.js 的）恰为 G3/G6/G7/G8 四条', E08.GATED.map(r => r.id).join(',') === 'G3,G6,G7,G8',
  E08.GATED.map(r => r.id).join(','))
for (const r of E08.RULES) {
  check(r.id + ' 有输入且未抛错：' + (results[r.id].stat || results[r.id].fatal || ''), !results[r.id].fatal, results[r.id].fatal)
}

/* ================= §1 落门安全闸 ================= */
section('§1 落门安全闸：进了闸的四条命中必须为 0；没进的那条必须确实还有活体')
for (const r of E08.GATED) {
  results[r.id].hits.forEach(h => console.error('    ✗ ' + h.file + ':' + h.line + ' ' + h.why))
  check(r.id + ' 命中 0 ｜ ' + (results[r.id].stat || ''), hitOf(r.id) === 0, hitOf(r.id) + ' 处')
}
{
  const n = hitOf('G11')
  check('G11 没有接进 check.js（派单纪律：命中 >0 的门不落，不加豁免、不加跳过清单）', !E08.GATED.includes(E08.G11))
  check('真实仓库 G11 命中 ' + n + ' 处 >0 ⇒ 本轮 BLOCKED 站得住', n > 0, n + ' 处')
  note('G11 活体清单：' + results.G11.hits.map(h => h.file + ':' + h.line + '（' + h.snippet + '）').join(' | '))
  check('BLOCKED 台账与实测读数一致（台账会随实测漂移 ⇒ 不一致即红，不许悄悄躺着）',
    E08.BLOCKED.length === 1 && E08.BLOCKED[0].id === 'G11' && E08.BLOCKED[0].hits === n,
    JSON.stringify(E08.BLOCKED) + ' vs 实测 ' + n)
  const g11 = results.G11.hits[0]
  check('阻塞那处就是 app.wxss 里 `.input, .textarea` 与 `.textarea` 的 padding 双写（不是别处的新活体）',
    !!g11 && g11.file === 'app.wxss' && /padding/.test(g11.why) && /\.textarea/.test(g11.why), JSON.stringify(g11 && g11.why))
}
check('判据里没有登记豁免机制（KNOWN_*/SKIP_*/EXEMPT_*/allowlist 一律不许出现）',
  !/KNOWN_[A-Z_]+\s*=/.test(RULE_SRC) && !/SKIP[A-Z_]*\s*=/.test(RULE_SRC) &&
  !/EXEMPT[A-Z_]*\s*=/.test(RULE_SRC) && !/allowlist\s*=/.test(RULE_SRC), '')
// G6 里唯一一处「不判」的分支是**行为条件**（这一页真的有固定底栏要避让），不是清单；钉住它仍然会咬别的写法。
check('G6 的子页不判红的唯一条件是「本页真的用了 .sticky-action」，判据里没有文件名分支',
  /usesSticky/.test(RULE_SRC) && !/anotices|privacy|route-edit/.test(RULE_SRC))
check('判据里没有出现页面名/组件名硬编码（身份一律现场读 app.json 与组件目录）',
  !/pages\/(home|me|notices|weather-hub|anotices)/.test(RULE_SRC), '')

/* ================= §2 门确有样本可判 ================= */
section('§2 输入非空（每条门的遍历集合都必须真的有料）')
{
  const m3 = (results.G3.stat || '').match(/扫了 (\d+) 个 wxml、(\d+) 个裸词属性；组件标签 (\d+) 个/)
  check('G3：wxml ≥ 35 且裸词属性 ≥ 1000（读成 0 就是静默放行）',
    m3 && Number(m3[1]) >= 35 && Number(m3[2]) >= 1000 && Number(m3[3]) >= 13, results.G3.stat)
  const m6 = (results.G6.stat || '').match(/tab 页 (\d+) \/ 子页 (\d+).*需要 (\d+)px/)
  check('G6：tab 页 ≥4 个、子页 ≥16 个（名单来自 app.json，不是印象）',
    m6 && Number(m6[1]) >= 4 && Number(m6[2]) >= 16, results.G6.stat)
  check('G6：需要量是现场算出来的正数（不是写死的 84，也不是读成 0 的空解析）',
    m6 && Number(m6[3]) > 0, results.G6.stat)
  note('G6 需要量读数：' + (results.G6.stat || ''))
  // 只要求「出处逐项报数」，不钉具体数值：底栏的尺寸是设计规格，改了不该让本套件红（读数≠判据）
  check('G6 的统计逐段写着需要量的出处（可追溯，不是凭印象的 84）',
    /padding-top \d+ \+ padding-bottom \d+ \+ border-top \d+ \+ \.tab 高 \d+/.test(results.G6.stat || ''), results.G6.stat)
  const m7 = (results.G7.stat || '').match(/扫了 (\d+) 个 wxss/)
  check('G7：wxss ≥ 35（app.wxss + 20 页 + 13 组件 + custom-tab-bar）', m7 && Number(m7[1]) >= 35, results.G7.stat)
  const m11 = (results.G11.stat || '').match(/选择器 (\d+) 个/)
  check('G11：解析出的选择器 ≥ 400（解析器读空了这里会先红）', m11 && Number(m11[1]) >= 400, results.G11.stat)
  // G8 的活体样本是 0（E-06 已修）——这是**合法的空**，但必须证明门不是空的：靠 §4 夹具 + 变异自证。
  // ⚠ 这里一度写成「sticky 块数必须 === 0」的判据，V14 变异（合法的 sticky + top:0）当场把套件判红：
  //    把一次读数当判据＝断言依赖工作树的偶然状态，任何人新加一条合规 sticky 都会撞红。改成读数。
  const m8 = (results.G8.stat || '').match(/position:sticky 的规则块 (\d+) 处/)
  check('G8 的统计能读出 sticky 规则块数（读不出来＝解析器坏了，不是「没有 sticky」）', !!m8, results.G8.stat)
  note('真实仓库 sticky 规则块 ' + (m8 ? m8[1] : '?') + ' 处（E-06 已修，通常为 0）——这是读数不是判据；' +
    '这条门的牙齿由 §4 夹具（S7 正例 / S7b·S7d 反例 / S7e 反向对照）与变异 V12/V13/V14/V15 担保')
  check('G8 的夹具里有 sticky 的正例与反例（否则上面那句「合法的空」无法与「门坏了」区分）',
    E08.SELF_CASES.some(c => c.expect.G8 === 1) && E08.SELF_CASES.some(c => c.crossBlock !== undefined))
}

/* ================= §3 解析底座 ================= */
section('§3 解析底座：注释/字符串/at-rule/简写展开/properties')
{
  // 3a 注释与字符串必须被剥掉，且等长（行号不错位）
  const css = '/* color-mix() 与 :root 都不能用 */\n.a { color: red }\n// :root { color: blue }\n'
  const scan = E08.codeText(css, E08.mask(css))
  check('stripComments/mask 之后注释位被 blank，但长度与行数不变（报出的行号才不会偏）',
    scan.length === css.length && scan.split('\n').length === css.split('\n').length && !/color-mix\(/.test(scan), scan.slice(0, 40))

  // 3b 嵌套 at-rule 一定不能被当成普通规则块
  const nested = '@media (min-width: 375px) {\n  .a { color: red }\n}\n'
  const found = E08.nestedAtRules(nested)
  check('@media 被识别为嵌套（分块解析器会把它里面的规则当外层的 ⇒ 必须失败关闭）',
    found.length === 1 && found[0].name === 'media', JSON.stringify(found))
  check('@keyframes 也算嵌套（from/to 是嵌套块）', E08.nestedAtRules('@keyframes spin {\n from { opacity: 0 }\n}\n').length === 1)
  check('@import 不算嵌套（它没有规则块，不该误伤）', E08.nestedAtRules('@import "x.wxss";\n.a { color: red }\n').length === 0)
  check('注释里的 @media 不算嵌套', E08.nestedAtRules('/* @media (x) { } */\n.a { color: red }\n').length === 0)

  // 3c padding/margin 简写四边展开（四种值数各一条）
  const four = v => E08.sidesOf(E08.parseRules('.x { padding: ' + v + ' }\n')[0].decls, 'padding')
  const b = t => (t && t.value) || null
  check('padding: 1 值 ⇒ 四边同', ['1px', '1px', '1px', '1px'].every((x, i) => b(four('1px').top) === x || true) &&
    ['top', 'right', 'bottom', 'left'].every(s => b(four('1px')[s]) === '1px'), JSON.stringify(four('1px')))
  check('padding: 2 值 ⇒ 上下=p0 左右=p1（不是 p1/p1）',
    ['top', 'bottom'].every(s => b(four('8px 2px')[s]) === '8px') && ['left', 'right'].every(s => b(four('8px 2px')[s]) === '2px'),
    JSON.stringify(four('8px 2px')))
  check('padding: 3 值 ⇒ top/right/bottom/left = p0/p1/p2/p1',
    b(four('1px 2px 3px').top) === '1px' && b(four('1px 2px 3px').right) === '2px' &&
    b(four('1px 2px 3px').bottom) === '3px' && b(four('1px 2px 3px').left) === '2px', JSON.stringify(four('1px 2px 3px')))
  check('padding: 4 值 ⇒ 顺时针 p0..p3',
    ['top', 'right', 'bottom', 'left'].every((s, i) => b(four('1px 2px 3px 4px')[s]) === (i + 1) + 'px'), JSON.stringify(four('1px 2px 3px 4px')))
  check('块内后写覆盖前写：同一块里 padding 之后又写 padding-bottom ⇒ 底边取后者，行号跟到后者',
    (() => {
      const box = E08.sidesOf(E08.parseRules('.x { padding: 8px; padding-bottom: 20px; }\n')[0].decls, 'padding')
      return b(box.bottom) === '20px' && b(box.top) === '8px' && box.bottom.line === 1
    })())

  // 3d properties 读取三态
  check('properties 字面量能读到键集（form-field 的 error 是**声明的属性**，不是死事件）',
    (() => { const p = E08.propertiesOf(ctx, 'form-field'); return p.kind === 'literal' && p.set.has('error') && p.set.has('label') })())
  check('没有 properties 的组件 ⇒ kind=none（不猜）', E08.propertiesOf(ctx, 'nonexistent-comp').kind === 'none')
  check('properties 来自变量 ⇒ kind=variable（调用方登记不判红；合法重构不假红，铁律 30）',
    (() => {
      const r = E08.runRulesOn(E08.fixtureWorld({
        'components/probe/probe.js': 'const props = { error: String }\nComponent({ properties: props, methods: {} })\n',
        'pages/plain/plain.wxml': '<view class="page"><probe error="none"></probe></view>\n',
      })).find(x => x.id === 'G3').result
      return r.hits.length === 0 && /静态展不开/.test(r.stat)
    })())

  // 3e G3 的真值表（与第 8 步互补，绝不重叠）
  const comps = E08.componentTagSet(ctx)
  const noteBox = () => ({ unresolved: [] })
  const cb = (tag, name, value) => E08.classifyBare(ctx, comps, noteBox(), tag, name, value)
  check('裸 <view tap="onTap"> ⇒ 判红（第 8 步的属性名正则要求连字符，这种写法此前无人管）', cb('view', 'tap', 'onTap') === 'tap')
  check('原生 <input change="onX"> ⇒ 判红（change 是已知事件名，少前缀就是死绑定）', cb('input', 'change', 'onX') === 'change')
  check('自定义组件上写了它声明过的属性名 ⇒ 不判（error 是 form-field 的 prop，不是事件）', cb('form-field', 'error', 'none') === null)
  check('自定义组件上写了它**没声明**的事件名 ⇒ 判红（同样是永不触发）', cb('form-field', 'tap', 'onTap') === 'tap')
  check('插值值不是 handler 名：tap="{{fn}}" / error="{{errors.name}}" 一律放行',
    cb('view', 'tap', '{{fn}}') === null && cb('form-field', 'error', '{{errors.name}}') === null)
  check('保留字值放行：tap="true" 之类不当成 handler', cb('view', 'tap', 'true') === null)
  check('非事件名的裸属性放行：mode="date" / range="list" / slot="readout"',
    cb('picker', 'mode', 'date') === null && cb('picker', 'range', 'list') === null && cb('view', 'slot', 'readout') === null)
  check('带连字符的写法不在本门（归第 8 步），两边不重叠：animation-end ⇒ null',
    cb('overlay', 'animation-end', 'noop') === null)
  check('词表只有一份：G3 用的 EVENT_NAMES 与第 8 步是同一个对象（不会有第二张嘴）',
    E08.EVENT_NAMES === EV.EVENT_NAMES)
  check('两条门合起来才覆盖两半：第 8 步对裸 tap="onTap" 无反应（证明本批补的是真盲区）',
    EV.scan('<view tap="onTap">x</view>', '<t>').length === 0 && EV.scan('<view animation-end="noop">x</view>', '<t>').length === 1)
}

/* ================= §4 夹具自证 ================= */
section('§4 规则自证（' + E08.SELF_CASES.length + ' 组夹具，逐组比对五条门的命中数）')
{
  const bad = E08.selfProof()
  bad.forEach(b => console.error('    ✗ ' + b))
  check('每组夹具的命中数都与预期一致（门既咬得住缺陷也不误伤合法写法）', bad.length === 0, bad.join(' / '))
  const positives = E08.SELF_CASES.filter(c => Object.values(c.expect).some(v => v > 0)).length
  const negatives = E08.SELF_CASES.length - positives
  note('正例（必红）' + positives + ' 组 ｜ 反例（必绿）' + negatives + ' 组')
  for (const id of ['G3', 'G6', 'G7', 'G8', 'G11']) {
    check(id + ' 有正例（必红）与反例（必绿）各 ≥1 组',
      E08.SELF_CASES.some(c => c.expect[id] > 0) && E08.SELF_CASES.some(c => c.expect[id] === undefined || c.expect[id] === 0))
  }
  check('两条方向都有反例的只有 G6 这类「分档」判据：tab 页丢了留白与子页吃了留白各一组（防一刀切恒真）',
    E08.SELF_CASES.some(c => c.id.indexOf('S3') === 0 && c.expect.G6) &&
    E08.SELF_CASES.some(c => c.id.indexOf('S4 ') === 0 && c.expect.G6) &&
    E08.SELF_CASES.some(c => c.id.indexOf('S4b') === 0 && !Object.keys(c.expect).length))
  check('G7 的反例里含「同样的词只出现在注释/字符串里」⇒ 证明剥注释这一步是真的（不剥就是假红）',
    E08.SELF_CASES.some(c => /注释里/.test(c.id)) && E08.SELF_CASES.some(c => /字符串正文里/.test(c.id)))
}

/* ================= §5 接线检查 ================= */
section('§5 接线检查（判据装在没人跑的门里等于没有门）')
{
  check('check.js require 了本批判据模块（不是复制第二份判据 —— 铁律 11）',
    /require\('\.\/e08-remaining-rules'\)/.test(CHECK_SRC))
  check('本批新门整段被哨兵包住（盲区复现脚本靠这两个哨兵切掉它，不靠改判据）',
    /T5b\/E-08 新门开始/.test(CHECK_SRC) && /T5b\/E-08 新门结束/.test(CHECK_SRC))
  const block = CHECK_SRC.slice(CHECK_SRC.indexOf('T5b/E-08 新门开始'), CHECK_SRC.indexOf('T5b/E-08 新门结束'))
  check('四条门都在这段里被真的执行（遍历 GATED 并 run）',
    /for \(const r of E08\.GATED\)/.test(block) && /r\.run\(ctx\)/.test(block))
  check('夹具自证也进了预提交闸（每次提交都确认门不是空门）', /E08\.selfProof\(\)/.test(block))
  check('命中与 fatal 都记进 failed（抛错/无输入按红算，不静默放行）',
    /res\.hits\.forEach\(h => fail\(/.test(block) && /if \(res\.fatal\) fail\(/.test(block))
  check('GATED 条数一写死：摘掉一条门当场红，不会因为「循环少跑一轮」而全绿',
    /E08\.GATED\.length !== 4/.test(block) && /E08\.RULES\.length !== 5/.test(block))
  check('G11 的活体每次都被复量一遍并打读数（BLOCKED 不许悄悄躺着；归零那句提示落在代码里）',
    /E08\.G11\.run\(ctx\)/.test(block) && /命中已归零/.test(block))
  check('G11 的读数不写进 fail（不落一条有命中的门，也不拿它当噪音红）',
    !/fail\('\[G11\]/.test(block) && !/g11\.hits\.forEach\(h => fail/.test(block))
  check('本批的段在 T4 段之后、汇总输出之前（追加位置正确，没插进既有步骤里）',
    CHECK_SRC.indexOf('T4/E-08 新门结束') < CHECK_SRC.indexOf('T5b/E-08 新门开始') &&
    CHECK_SRC.indexOf('T5b/E-08 新门结束') < CHECK_SRC.lastIndexOf("console.log('')"))
  // 机械复核「只增不改」：既有 9 个静态步骤标题 + T4 那段的原文都还在（真正的删除行数由 verify.txt 的 git diff --numstat 给）
  const EXISTING = ["console.log('== JS 语法 ==')", '== WXML 标签配平 ==', "'== WXSS =='", "'== app.json =='",
    "'== 组件引用 =='", "'== 组件注册（反向） =='", "'== require 可解析 =='", "'== 勾选框事件载体 =='",
    "'== WXML 非法事件属性名 =='", "'== 旧页清理 =='",
    "'== 新门自证（合成夹具：正例必红、反例必绿）=='", 'for (const r of T4.RULES)', 'T4.selfProof()']
  const missing = EXISTING.filter(s => !CHECK_SRC.includes(s))
  check('既有 10 个静态步骤 + T4 段的执行/自证原文一条不少（本批只追加）',
    missing.length === 0, missing.join(' / '))
  // 步骤标题是「只增不改」的粗读数：少一个就说明有人删了一段门（T4 与 G8 的逐门标题是动态拼的，不计入这里）
  const heads = (CHECK_SRC.match(/console\.log\('== /g) || []).length
  check('check.js 里的字面步骤标题数 ≥ 15（既有 12 + 本批自证 1 + G11 读数 1 + 余量）', heads >= 15, 'heads=' + heads)
}

/* ================= §6 B0 复验（工作项 B 的门禁化那一半） ================= */
section('§6 B0 复验：overlay.wxss 的等价收敛与承重墙原文')
{
  const text = fs.readFileSync(path.join(MP, 'components', 'overlay', 'overlay.wxss'), 'utf8')
  const rules = E08.parseRules(text)
  const dlg = rules.filter(r => r.sels.indexOf('.overlay--dialog') !== -1)
  check('`.overlay--dialog` 现在只有一条规则块（两条并成一条）', dlg.length === 1,
    dlg.map(r => 'L' + r.selLine).join(','))
  const box = E08.sidesOf(dlg[0].decls, 'margin')
  check('终值仍是 margin 上/下 auto、左/右 16px（与改前两条的层叠赢家逐边相同）',
    ['top', 'bottom'].every(s => box[s] && box[s].value === 'auto') &&
    ['left', 'right'].every(s => box[s] && box[s].value === '16px'), JSON.stringify(box))
  const alignSelf = dlg[0].decls.filter(d => d.prop === 'align-self').map(d => d.value)
  check('align-self: center 照旧（那条从未被覆盖，合并后也必须还在）',
    alignSelf.length === 1 && alignSelf[0] === 'center', JSON.stringify(alignSelf))
  check('除 margin/align-self 之外没有新增属性（合并是纯减法，不是顺手改样式）',
    dlg[0].decls.every(d => ['margin', 'align-self'].includes(d.prop)),
    dlg[0].decls.map(d => d.prop + ':' + d.value).join(' '))
  check('G11 在本文件命中 0（改前那份树命中 1 处 .overlay--dialog ⇒ 读数差就是收敛的证据）',
    E08.G11.run(E08.makeCtx(MP)).hits.filter(h => /overlay\.wxss/.test(h.file)).length === 0)
  // 承重墙：全仓 31 处弹层依赖的关闭态不可命中三件套 + 它上方的注释
  const root = rules.find(r => r.sels.indexOf('.overlay-root') !== -1)
  const props = root.decls.map(d => d.prop)
  check('承重墙：.overlay-root 的 pointer-events / visibility / transition 三条一条不少（顺序也不动）',
    ['pointer-events', 'visibility', 'transition'].every(p => props.includes(p)) &&
    props.indexOf('pointer-events') < props.indexOf('visibility') &&
    props.indexOf('visibility') < props.indexOf('transition'), props.join(','))
  const d = p => root.decls.filter(x => x.prop === p).pop().value
  check('承重墙三条的原文一字未改（none / hidden / visibility 0s linear var(...)）',
    d('pointer-events') === 'none' && d('visibility') === 'hidden' &&
    /^visibility 0s linear/.test(d('transition')), [d('pointer-events'), d('visibility'), d('transition')].join(' | '))
  check('承重墙上方那段注释还在（写着「关闭态不卸载，安全性由 pointer-events + visibility 承担」——删注释等于删警告）',
    /关闭态不卸载，安全性由 pointer-events \+ visibility 承担/.test(text))
  check('.overlay--sheet 与 .overlay__body 的 62vh / flex-end 未被顺手改动',
    /align-items:\s*flex-end/.test(text) && rules.some(r => r.sels.indexOf('.overlay__body') !== -1 && /62vh/.test(r.decls.map(x => x.value).join(' '))), '')
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
