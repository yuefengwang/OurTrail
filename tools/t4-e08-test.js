// E-08 四条平台门的断言套件：node tools/t4-e08-test.js
//
// 测三件事，缺一件就不算这条门存在过：
//  §1 真实仓库当前命中 0（这是落门的安全闸：命中 >0 的门本批不允许落地）
//  §2 每条门确有输入（空转的门比没有门更危险 —— check.js:131 的路径分隔符教训）
//  §3 解析底座本身可信（注释/字符串/正则/模板字面量都不许被当成代码读）
//  §4 每条门都咬得住合成违例、且不吃合法写法（正例必红 + 反例必绿）
//  §5 接线检查：判据装在没人跑的门里等于没有门 ⇒ 必须真的挂在 tools/check.js 的预提交闸上
//
// 「删掉这段门 ⇒ 同一份合成违例在旧门下一片绿」属于变异自证的职责：node tools/t4-e08-mutate.js
'use strict'
const fs = require('fs')
const path = require('path')
const R = require('./t4-e08-platform-rules')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const CHECK_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'check.js'), 'utf8')

let passed = 0, failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function note(t) { console.log('  · ' + t) }

const ctx = R.makeCtx(MP)
const results = {}
for (const r of R.RULES) {
  try {
    results[r.id] = r.run(ctx)
  } catch (e) {
    results[r.id] = { hits: [], fatal: '判据抛错：' + e.message }
  }
}

/* ================= §0 四条门都跑起来了，且没有 fatal ================= */
section('§0 四条门都可运行')
for (const r of R.RULES) {
  check(r.id + ' 有输入且未抛错：' + (results[r.id].stat || ''), !results[r.id].fatal, results[r.id].fatal)
}

/* ================= §1 安全闸：真实仓库命中必须为 0 ================= */
section('§1 落门安全闸：真实仓库命中 0（>0 的门不许落）')
for (const r of R.RULES) {
  const hits = results[r.id].hits
  hits.forEach(h => console.error('    ✗ ' + h.file + ':' + h.line + ' ' + h.why))
  check(r.id + ' 命中 0 ｜ ' + (results[r.id].stat || ''), hits.length === 0, hits.length + ' 处')
}
let total = 0
for (const r of R.RULES) total += results[r.id].hits.length
check('四条门合计命中 ' + total + ' 处 ⇒ 硬门禁成立，不需要任何登记清单', total === 0)
const RULE_SRC = fs.readFileSync(path.join(ROOT, 'tools', 't4-e08-platform-rules.js'), 'utf8')
check('判据里没有登记清单/跳过清单（不允许为了让门变绿而放宽）',
  !/KNOWN_[A-Z_]+\s*=/.test(RULE_SRC) && !/SKIP[A-Z_]*\s*=/.test(RULE_SRC) && !/allowlist|白名单/.test(RULE_SRC))

/* ================= §2 门确有样本可判（不空转） ================= */
section('§2 输入非空')
{
  const stat = results.R1.stat || ''
  const m = stat.match(/用固定底栏的页面 (\d+) 个/)
  check('R1：至少一个页面在用 .sticky-action（否则本步判的是空气）', m && Number(m[1]) >= 1, stat)
  const m2 = (results.R2.stat || '').match(/扫了 (\d+) 个含 Component\(\) 的文件/)
  check('R2：含 Component() 的文件 ≥ 13（13 组件目录 + custom-tab-bar）', m2 && Number(m2[1]) >= 13, results.R2.stat)
  const m3 = (results.R3.stat || '').match(/具名 slot 声明 (\d+) 处/)
  check('R3：全仓确有具名 slot 声明（本仓 1 处：roam-scrubber 的 readout）', m3 && Number(m3[1]) >= 1, results.R3.stat)
  const m4 = (results.R4.stat || '').match(/app\.wxss 类名 (\d+) 个；检查了 (\d+) 个组件模板/)
  check('R4：app.wxss 类清单与组件模板清单都非空', m4 && Number(m4[1]) >= 50 && Number(m4[2]) >= 13, results.R4.stat)
  check('R4：真实仓库的组件模板没有「options 写在变量里」的（有的话必须显式登记，不能静默放过）',
    !/展不开的组件/.test(results.R4.stat || ''), results.R4.stat)
  check('R3：同上', !/展不开的组件/.test(results.R3.stat || ''), results.R3.stat)
}

/* ================= §3 解析底座 ================= */
section('§3 解析底座：注释与字面量不得被当成代码')
{
  const dup = "Component({\n  options: { styleIsolation: 'apply-shared' },\n  // options: { multipleSlots: true }\n  methods: {}\n})\n"
  const mk = R.mask(dup)
  const lits = R.literalOfCall(dup, mk, 'Component')
  const keys = R.topLevelKeys(dup, mk, lits[0].start, lits[0].end)
  check('注释里的 options: 不算第二次声明（否则满仓假红）', keys.filter(k => k.name === 'options').length === 1,
    keys.map(k => k.name).join(','))

  const url = 'const a = "https://example.com/x"\nComponent({ options: { styleIsolation: \'apply-shared\' }, methods: {} })\n'
  const mk2 = R.mask(url)
  const lits2 = R.literalOfCall(url, mk2, 'Component')
  check('URL 里的 // 不被当成行注释吃掉后面整行（wxml 同理，见 stripWxml）', lits2.length === 1)

  const re = "const t = 'x'\nconst rx = /class=\"([^\"]*)\"/g\nComponent({ options: { styleIsolation: 'apply-shared' } })\n"
  const mk3 = R.mask(re)
  const lits3 = R.literalOfCall(re, mk3, 'Component')
  check('正则字面量里的引号不让标注错位（错位=整份文件读空=静默放行）',
    lits3.length === 1 && R.topLevelKeys(re, mk3, lits3[0].start, lits3[0].end).map(k => k.name).join(',') === 'options')

  const nested = "Component({\n  data: { a: 1 },\n  attached() { const o = { options: 1 }; this.setData(o) },\n  methods: { save() {} }\n})\n"
  const mk4 = R.mask(nested)
  const l4 = R.literalOfCall(nested, mk4, 'Component')
  const ks = R.topLevelKeys(nested, mk4, l4[0].start, l4[0].end).map(k => k.name)
  check('方法简写与嵌套对象里的 `options:` 不算顶层键', !ks.includes('options') && ks.includes('data'), ks.join(','))

  const last = "Component({ options: { styleIsolation: 'apply-shared' },\n  options: { addGlobalClass: true } })\n"
  const eff = R.effectiveOptions(last)
  check('同名 options 按 last-wins 取（框架拿到的就是后一份）',
    eff && !eff.has('styleIsolation') && eff.has('addGlobalClass'), eff ? [...eff.keys()].join(',') : 'null')
  const varo = "const o = {}\nComponent({ options: o })\n"
  check('options 是变量时不猜内容（返回 null，由调用方登记为「静态展不开」而不是当成没写）',
    R.effectiveOptions(varo) === null)
}

section('§3b 类名与长度的读法')
{
  const wx = '<view class="card {{ready ? \'muted\' : \'\'}}" hover-class="button-hover"><text class="small">x</text></view>\n<!-- class="sticky-action" 这是注释 -->\n'
  const toks = R.classTokens(R.stripWxml(wx)).map(t => t.token)
  check('class 的动态段只取引号字面量，注释里的类名不算使用',
    ['card', 'muted', 'button-hover', 'small'].every(x => toks.includes(x)) && !toks.includes('sticky-action'), toks.join(','))

  const sheet = '/* .ghost { color: red } */\n.a .b { padding: 0 }\n.c { background: url("x.png") }\n'
  const defs = R.definedClasses(sheet)
  check('块注释里的选择器不算定义；选择器位的类才算；声明正文不算',
    defs.has('a') && defs.has('b') && defs.has('c') && !defs.has('ghost'), [...defs.keys()].join(','))

  check('px 直接读，rpx 按 750 基线折半（保守），calc 里的 env() 不计入',
    R.lengthToPx('120px').px === 120 &&
    R.lengthToPx('240rpx').px === 120 &&
    R.lengthToPx('calc(32px + 84px + env(safe-area-inset-bottom))').px === 116)
  check('var() 读不出终值 ⇒ unknown（失败关闭，不冒充「留够了」）', R.lengthToPx('var(--x)').unknown === true)

  const wxml = '<view class="page">\n<!--\n  说明\n-->\n<view class="sticky-action"></view>\n</view>\n'
  check('stripWxml 等长（报出来的行号才不会偏移）',
    R.stripWxml(wxml).length === wxml.length && R.stripWxml(wxml).split('\n').length === wxml.split('\n').length)
}

/* ================= §4 合成夹具：正例必红 / 反例必绿 ================= */
section('§4 规则自证（' + R.SELF_CASES.length + ' 组夹具，逐组比对四条门的命中数）')
{
  const bad = R.selfProof()
  bad.forEach(b => console.error('    ✗ ' + b))
  check('每组夹具的命中数都与预期一致（门既咬得住缺陷也不误伤合法写法）', bad.length === 0, bad.join(' / '))
  const positives = R.SELF_CASES.filter(c => Object.values(c.expect).some(v => v > 0)).length
  const negatives = R.SELF_CASES.length - positives
  note('正例（必红）' + positives + ' 组 ｜ 反例（必绿）' + negatives + ' 组')
  check('正例覆盖四条门各自的目标缺陷形态',
    R.SELF_CASES.some(c => c.expect.R1) && R.SELF_CASES.some(c => c.expect.R2) &&
    R.SELF_CASES.some(c => c.expect.R3) && R.SELF_CASES.some(c => c.expect.R4))
  check('反例里含「合法写法不得假红」（铁律 30：门不能钉源码文本）',
    R.SELF_CASES.some(c => !Object.values(c.expect).some(v => v > 0)))
}

/* ================= §5 接线：四条门真的挂在预提交闸上 ================= */
section('§5 接线检查（判据装在没人跑的门里等于没有门）')
{
  check('check.js require 了判据模块（不是复制第二份判据 —— 铁律 11）',
    /require\('\.\/t4-e08-platform-rules'\)/.test(CHECK_SRC))
  check('新门整段被剥离标记包住（盲区复现脚本靠这两个哨兵切掉它，不靠改判据）',
    /T4\/E-08 新门开始/.test(CHECK_SRC) && /T4\/E-08 新门结束/.test(CHECK_SRC))
  const block = CHECK_SRC.slice(CHECK_SRC.indexOf('T4/E-08 新门开始'), CHECK_SRC.indexOf('T4/E-08 新门结束'))
  check('四条门都在这段里被真的执行（RULES 遍历，而不是只 require 不跑）',
    /for \(const r of T4\.RULES\)/.test(block) && /r\.run\(ctx\)/.test(block), block.slice(0, 40))
  check('夹具自证也进了预提交闸（每次提交都会确认门不是空门）', /T4\.selfProof\(\)/.test(block))
  check('命中与 fatal 都记进 failed（抛错/无输入按红算，不静默放行）',
    /res\.hits\.forEach\(h => fail\(/.test(block) && /if \(res\.fatal\) fail\(/.test(block))
  check('判据模块被摘空（RULES 导出空数组）时 check.js 必须红，而不是循环不跑＝全绿',
    /RULES\.length !== 4/.test(block) && /SELF_CASES/.test(block))
  // 既有 5+3 步一字未改：本批只允许追加。这里钉住几条既有判据的原文还在。
  check('既有检查步骤原文仍在（本批「只增不改」）',
    ["console.log('== JS 语法 ==')", "== WXML 标签配平 ==", "== WXSS ==", "== app.json ==",
      "== 组件引用 ==", "== 组件注册（反向） ==", "== require 可解析 ==", "== 勾选框事件载体 ==",
      "== WXML 非法事件属性名 =="].every(s => CHECK_SRC.includes(s)))
}

/* ================= §6 单源与失败关闭（用合成世界直接取读数） ================= */
section('§6 需求值只有一个出处；读不出就失败关闭，不静默放行')
{
  const sticky = '<view class="page"><view class="sticky-action">go</view></view>\n'
  const at120 = R.runRulesOn(R.fixtureWorld({
    'pages/sticky/sticky.wxml': sticky,
    'pages/sticky/sticky.wxss': '.page { padding-bottom: 140px; }\n',
  })).find(x => x.id === 'R1').result
  check('需求 120px 时 140px 等效留白判绿', at120.hits.length === 0, JSON.stringify(at120.hits))

  const at200 = R.runRulesOn(R.fixtureWorld({
    'app.wxss': '.page { padding: 0 }\n.page.has-sticky { padding-bottom: 200px; }\n.card { border: 1px solid red }\n',
    'pages/sticky/sticky.wxml': sticky,
    'pages/sticky/sticky.wxss': '.page { padding-bottom: 140px; }\n',
  })).find(x => x.id === 'R1').result
  check('把 app.wxss 的要求改成 200px ⇒ 同一份 140px 立刻变红，且报错里的数字跟着变（阈值单源，铁律 31③）',
    at200.hits.length === 1 && /200px/.test(at200.hits[0].why), JSON.stringify(at200.hits))

  const gone = R.runRulesOn(R.fixtureWorld({
    'app.wxss': '.page { padding: 0 }\n.card { border: 1px solid red }\n',
    'pages/sticky/sticky.wxml': sticky,
  })).find(x => x.id === 'R1').result
  check('app.wxss 的 .page.has-sticky 机制被删 ⇒ R1 报「没有输入」而不是把全部页面判绿（失败关闭）',
    !!gone.fatal && gone.hits.length === 0, JSON.stringify(gone))

  const varOpt = R.runRulesOn(R.fixtureWorld({
    'components/ok/ok.js': "const opts = { styleIsolation: 'apply-shared', multipleSlots: true }\nComponent({ options: opts, methods: {} })\n",
  }))
  const v3 = varOpt.find(x => x.id === 'R3').result
  const v4 = varOpt.find(x => x.id === 'R4').result
  check('options 来自变量：R3/R4 不猜内容也不判红（合法重构不假红，铁律 30），但必须在统计里点名（不静默）',
    v3.hits.length === 0 && v4.hits.length === 0 && /展不开的组件 1 个/.test(v3.stat + v4.stat),
    v3.stat + ' || ' + v4.stat)
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
