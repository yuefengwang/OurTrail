'use strict'
// M-02（E-15 / E-16 同族）类 token 作用域定义门：node tools/m02-class-scope-test.js
//
// 缺陷本体：WXML 用了某个类，但**在这个类真的能生效的那份样式表里**根本没有它的定义。
//   小程序页面 wxss 只作用于本页、全仓零 @import ⇒ 一个类只在 pages/me/me.wxss 里定义，
//   另外四页写着同一个类名就是命不中任何选择器，标题掉回 page 默认的 14px/400（E-15）。
//   privacy 页更彻底：container / h1 / h2 三个类**全仓零定义**（E-16）。
//   改前实测命中 16 处 / 5 个文件（editor 4、privacy 6、route-edit 2、weather 2、weather-hub 2）。
//
// ── 本门的三条硬要求（派单点名的，不是自创）──
// ① **逐作用域比对，不许把全仓选择器汇成一个池**。作用域 =
//   页面：app.wxss + 同页 wxss；组件：同组件 wxss，且**仅当**它声明 styleIsolation:'apply-shared' 时才算上 app.wxss；
//   custom-tab-bar：与 components/ 同级，同样按它自己 index.js 的隔离声明算（2026-10-17 落进 check.js 时补进扫描面，
//   此前这一层不在本门视野里——铁律 14 恰好点名它「必须完全自包含」）。
//   汇池就是前任探针漏掉 E-15 的原因：me.wxss 那份定义会掩盖另外四页的缺失。
// ② **三种形态不是「无定义」**，一律排除并各写自测用例（§0）：
//   a) `hover-class="…"`（它是 class 的子串，混在一起会污染结果）；
//   b) 整段 `{{ … }}`（含三元里的**比较字面量**，如 `{{a ? 'featured' : ''}}` 的 'featured'）；
//   c) **部分插值** `prefix--{{x}}` / `{{x}}-suffix`：只把 `{{}}` 换成空格会把它切成半个 token。
//      做法是把 mustache 换成哨兵 \u0000，凡与哨兵**粘连**的 chunk 就是动态名，整段不判。
//   ⚠ 排除 (b) 之后 `pages/home/home.wxml:1` 的 `with-tabbar` 不再由本门判——它活在三元字面量里；
//     它是「假开关」这件事由 tools/b4-pad-final-value-test.js 用**终值差**判（T4.3），归另一条账。
// ③ **钉解析后的终值与赢家出处，不钉源码文本**（铁律 30）：把 `padding` 写成简写或长写、把规则挪位置、
//   调换 class 里两个类的次序 ⇒ 终值不变 ⇒ 必须照样全绿（tools/m02-class-scope-mutate.js 的 E 组当场验）。
//
// 与 t4-e08 第 4 条的分工（两条都在闸里，问的是两件事）：那条按**声明缺失**判
//   （用了全局类却没写 apply-shared ⇒ 让你补声明）；本门按**生效作用域里解不出定义**判
//   （非共享组件写 `.g-card` 在本门同样命中——夹具 F4/F5 钉的就是这条作用域边界）。
//   本门只问「按生效作用域解出来，这个类有没有定义」，不认文件名、不读注释。
//
// 判据本体（解析层 + 作用域装载 + 判定核 + 夹具自证）在 tools/m02-class-scope-rules.js，本文件只写断言；
// tools/check.js 落门时 require 的是同一份（铁律 11：判定核不复制第二份，否则「套件绿 + 闸红」没人说得清
// 哪一把尺是对的）。想只看读数：node tools/m02-class-scope-rules.js
//
// 沙盒：M02_MP_ROOT 指向一份 miniprogram 副本（变异自证用）；缺省 = 真实仓库。
// 违例以 `#V|code|subject|detail` 行输出，供 tools/m02-class-scope-mutate.js 按「相对基线新增了什么」判。
//
// 运行：node tools/m02-class-scope-test.js      退出码：0 = 全绿

const fs = require('fs')
const os = require('os')
const path = require('path')

let passed = 0
let failed = 0
const VIOL = []
function viol (code, subject, detail) {
  const line = '#V|' + code + '|' + subject + '|' + detail
  if (VIOL.indexOf(line) === -1) { VIOL.push(line); console.log(line) }
}
function check (name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) } else { failed++; console.log('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
  return cond
}
function section (t) { console.log('== ' + t + ' ==') }
function note (t) { console.log('  · ' + t) }

/* ===================== 判据本体在 tools/m02-class-scope-rules.js ===================== */
// 解析层、作用域装载、判定核、夹具自证都在那一份模块里；本文件只写断言。
// 为什么必须这样分：预提交闸 tools/check.js 与本套件要跑的是**同一份判据**（铁律 11——不在测试里
// 镜像判据，也不让闸用另一把尺）。判据改了不改这里，本套件的读数会跟着动；改这儿而不动那儿＝两份真值源。
const {
  ROOT, MP, DOC, UNITS, appParsed, tabPaths,
  rd, exists, parse, cascade, resolveVars, finalOf, describe, definerRules, classTokensOf, nodesOf,
  unit, nodeOf, nodesWith, fin, finSheet,
  scan, selfProof, SELF_CASES,
} = require('./m02-class-scope-rules')


/* ===================== §0 探针自证 ===================== */
section('§0 探针自证（三种排除形态 + 阳性对照 + 解析器不空转）')
{
  const p1 = classTokensOf('empty-state status-panel status-panel--{{kind}}')
  check('P1 部分插值 prefix--{{x}}：静态 token 只剩 empty-state/status-panel，那半个不判',
    p1.tokens.join(' ') === 'empty-state status-panel' && p1.partial === 1, JSON.stringify(p1))
  const p2 = classTokensOf("card cond-pheno {{item.featured ? 'featured' : ''}}")
  check('P2 整段 {{}}（含三元比较字面量）：featured 没被当成类名，静态两枚照常判',
    p2.tokens.join(' ') === 'card cond-pheno' && p2.whole === 1 && p2.tokens.indexOf('featured') === -1, JSON.stringify(p2))
  const p3 = classTokensOf("page {{cards.length || tasks.length ? 'with-tabbar' : ''}}")
  check('P3 三元里的 with-tabbar 不由本门判（它活在三元字面量内；假开关那条账归 b4-pad 的终值差），静态 page 仍判',
    p3.tokens.join(' ') === 'page' && p3.whole === 1 && p3.tokens.indexOf('with-tabbar') === -1, JSON.stringify(p3))
  const p4 = classTokensOf('{{side}}-box suffix-')
  check('P4 前缀插值与断尾 token 都是动态名：整条不产出静态 token',
    p4.tokens.length === 0 && p4.partial === 2, JSON.stringify(p4))
  const hv = nodesOf('<view class="card" hover-class="pos-hover"></view><text class="pos-real">x</text>')
  check('P5 hover-class 与 class 分开解析（hover 里的名字不进本门，class 里的仍是判定对象）',
    hv.length === 2 && hv[0].hoverRaw === 'pos-hover' && hv[0].classes.join(' ') === 'card' && hv[1].classes[0] === 'pos-real',
    JSON.stringify(hv.map(h => [h.classes, h.hoverRaw])))
  // 阳性对照：真造一份「用了没定义」的现场，探针必须报出来（否则「命中 0」只是看不见）
  const SB = path.join(os.tmpdir(), 'm02-pos-probe-' + process.pid)
  fs.mkdirSync(SB, { recursive: true })
  fs.writeFileSync(path.join(SB, 'pos.wxml'), '<view class="page pos-made-up"><text class="card-label">x</text><view class="pos-prefix-{{k}}"></view><view hover-class="pos-hover-not-a-class"></view></view>')
  fs.writeFileSync(path.join(SB, 'pos.wxss'), '.pos-defined { color: red; }')
  const probeScope = [appParsed, parse(rd(path.join(SB, 'pos.wxss')), 'pos.wxss')]
  const found = []
  nodesOf(rd(path.join(SB, 'pos.wxml'))).forEach(n => {
    n.classes.forEach(c => { if (!definerRules(probeScope, c).length && found.indexOf(c) === -1) found.push(c) })
  })
  check('P6 阳性对照：夹具里未定义的 pos-made-up 被报出（判据有牙齿）',
    found.indexOf('pos-made-up') !== -1, found.join(' '))
  check('P7 三种排除没有反噬：已定义的 page、动态的 pos-prefix-*、hover 里的名字都不在命中里',
    found.filter(x => x === 'page' || /^pos-prefix/.test(x) || /hover/.test(x)).length === 0, found.join(' '))
  check('P8 解析器不是空转：app.wxss 解出 ' + appParsed.rules.length + ' 条声明 / ' + appParsed.classNames.size + ' 个类名 / ' + Object.keys(appParsed.tokens).length + ' 个 token',
    appParsed.rules.length > 100 && appParsed.classNames.size > 40 && Object.keys(appParsed.tokens).length >= 25)
  const oddAttr = UNITS.reduce((n, u) => {
    const raw = String(rd(path.join(MP, u.file)))
    return n + (raw.match(/class='/g) || []).length + (raw.match(/class=[^"' ]/g) || []).length
  }, 0)
  check('P9 属性形态前提复核：全仓 class 属性只有双引号形态（单引号/裸值实测 ' + oddAttr + ' 处 ⇒ 提取式没有漏掉的形态）', oddAttr === 0)
  const lineOk = (() => {
    const t = '<!-- a\nb\n-->\n<view class="x"></view>'
    const n = nodesOf(t)
    return n.length === 1 && n[0].line === 4
  })()
  check('P10 行号不被注释吞掉（跨行注释后第一个标签仍报正确行号 ⇒ 命中可复点到文件）', lineOk, '')
  // 模块里那 10 组合成作用域（含「组件不声明 apply-shared 就看不见 app.wxss」这条边界）在本套件也跑一遍：
  // check.js 每次提交会跑它，但那是闸；闸的判据如果不咬东西，套件这一侧必须同样看得见（一条判据两处都有读数）。
  const sp = selfProof()
  check('P11 夹具自证 ' + SELF_CASES.length + ' 组全部符合预期（正例必红、反例必绿、排除形态不反噬）',
    sp.length === 0, sp.join(' ｜ '))
  check('P12 夹具不是空跑：至少一组期望命中非空、至少一组期望为空',
    SELF_CASES.some(c => (c.expect || []).length > 0) && SELF_CASES.some(c => (c.expect || []).length === 0), '')
}

/* ===================== §1 全仓逐作用域命中 ===================== */
section('§1 逐作用域未定义类命中：每个页面/组件各用自己的作用域判（改前 16 处 / 5 文件）')
// 判定走模块里的 scan()：这与 tools/check.js 落门时调用的是同一次判定（判定核只有 scanUnits 一份，
// 铁律 11——套件不复述一遍判据，否则「套件绿 + 闸红」会出现而没人知道哪一份是对的）。
// S1.0 是输入自检：装载读不出东西（app.wxss 空、单元枚举失效、WXML 解析出 0 节点、token 总数 0）
// 必须报红，绝不能报「命中 0 ⇒ 全绿」——check.js:131 的路径分隔符事故就是这一层缺位。
const SCAN = scan()
check('S1.0 扫描真的有输入（无输入即 fatal，不冒充「命中 0」）｜ ' + (SCAN.stat || '（没有 stat，因为报的是 fatal）'),
  !SCAN.fatal, SCAN.fatal || '')
const HITS = SCAN.hits || []
const byUnit = {}
HITS.forEach(h => { (byUnit[h.unit] = byUnit[h.unit] || []).push(h.cls + '@L' + h.line) })
Object.keys(byUnit).forEach(id => note(id + '：' + byUnit[id].join(' ')))
HITS.forEach(h => viol('E10', h.file, h.cls + '@L' + h.line))
check('S1.1 未定义类命中 = 0（本次读数 ' + HITS.length + '）', HITS.length === 0,
  HITS.map(h => h.file + ':' + h.cls + '@L' + h.line).join(' | '))
const FILEHITS = Array.from(new Set(HITS.map(h => h.file)))
check('S1.2 命中数与命中文件数闭合（16 处对应 5 个文件；若命中 0 则文件也必须 0）',
  HITS.length === 0 ? FILEHITS.length === 0 : HITS.length === 16 && FILEHITS.length === 5,
  'hits=' + HITS.length + ' files=' + FILEHITS.length)
const LIVING = ['editor', 'privacy', 'route-edit', 'weather', 'weather-hub']
check('S1.3 五个活体作用域都在扫描面里（扫不到就是判据没有输入）', LIVING.every(d => !!unit(d)), '')
const nPage = UNITS.filter(u => u.kind === 'page').length
const nComp = UNITS.filter(u => u.kind === 'comp').length
const nTab = UNITS.filter(u => u.kind === 'tabbar').length
check('S1.4 扫描单元 = 页面 ' + nPage + ' + 组件 ' + nComp + ' + custom-tab-bar ' + nTab + ' = ' + UNITS.length +
  '（分区闭合）；页面 ≥20、组件 ≥13、tabBar 恰好 1，且每个单元都真的解析出节点',
  nPage + nComp + nTab === UNITS.length && nPage >= 20 && nComp >= 13 && nTab === 1 && UNITS.every(u => u.nodes.length > 0),
  '空节点单元 ' + UNITS.filter(u => !u.nodes.length).map(u => u.id).join(','))
const exWhole = UNITS.reduce((n, u) => n + u.nodes.reduce((k, x) => k + (x.classRaw ? classTokensOf(x.classRaw).whole : 0), 0), 0)
const exPartial = UNITS.reduce((n, u) => n + u.nodes.reduce((k, x) => k + (x.classRaw ? classTokensOf(x.classRaw).partial : 0), 0), 0)
const exHover = UNITS.reduce((n, u) => n + u.nodes.filter(x => x.hoverRaw !== null).length, 0)
check('S1.5 排除记账非零（三种形态在全仓真的存在，P1–P5 才不是自说自话）：整段 mustache ' + exWhole +
  ' / 部分插值与断尾 ' + exPartial + ' / hover-class ' + exHover, exWhole > 0 && exPartial > 0 && exHover > 0)
note('活体计数（本轮 5 处目标）：card-label ' + UNITS.filter(u => u.nodes.some(n => n.classes.indexOf('card-label') !== -1)).map(u => u.id).join(' / ') +
  '；privacy 的 container/h1/h2 命中 ' + HITS.filter(h => h.file.indexOf('privacy') !== -1).length + ' 处')

/* ===================== §2 card-label：五页终值 + 单一出处 ===================== */
section('§2 .card-label 提升为 app.wxss 全局单源：五页逐页解终值，赢家只能有一个出处')
const CL_EXPECT = { display: 'block', 'font-size': '15px', 'font-weight': '600', 'margin-bottom': '12px' }
{
  const users = UNITS.filter(u => u.nodes.some(n => n.classes.indexOf('card-label') !== -1))
  check('U0 使用 card-label 的作用域恰好是这 5 页（editor/route-edit/weather/weather-hub/me），privacy 不掺进来',
    users.length === 5 && users.every(u => LIVING.concat('me').indexOf(u.id) !== -1 && u.id !== 'privacy'),
    users.map(u => u.id + '×' + u.nodes.filter(n => n.classes.indexOf('card-label') !== -1).length).join(' '))
  let totalNodes = 0
  const overrides = []
  users.forEach(u => {
    const ns = nodesWith(u, 'card-label')
    totalNodes += ns.length
    const props = Object.keys(CL_EXPECT)
    const bad = []
    const srcSet = new Set()
    ns.forEach(n => {
      props.forEach((p, i) => {
        const g = finSheet(u, n, p)
        if (g.value !== CL_EXPECT[p]) bad.push(n.line + ' ' + p + '=' + describe(g))
        if (!g.missing) srcSet.add(g.source)
      })
      n.inline.forEach(d => { if (props.indexOf(d.prop) !== -1) overrides.push(u.file + ':L' + n.line + ' ' + d.prop + ':' + d.val) })
    })
    check('U·' + u.id + ' 的 ' + ns.length + ' 处 card-label：四条声明的**样式表**终值 = 15px/600/block/12px',
      ns.length > 0 && bad.length === 0, bad.slice(0, 3).join(' ｜ ') || '无节点')
    check('U·' + u.id + ' 的 card-label 出处只有一个且是 app.wxss（' + Array.from(srcSet).join('/') + '）',
      srcSet.size === 1 && Array.from(srcSet)[0] === 'app.wxss', Array.from(srcSet).join('/'))
    if (bad.length || !(srcSet.size === 1 && Array.from(srcSet)[0] === 'app.wxss')) {
      viol('SRC', u.file, 'card-label 终值/出处不对：' + (bad.slice(0, 2).join(' ｜ ') || Array.from(srcSet).join('/')))
    }
  })
  // 原先钉死 totalNodes === 17：上游重构会增删某一页的使用点个数，钉死总数＝把断言绑在工作树偶然状态上（假红）。
  // 这条要防的是「只抽一个样本就宣布全仓修好」，所以判据是覆盖度下限，不是具体计数。
  check('U2a 判据覆盖 ≥10 处使用点（读数 ' + totalNodes + '；不钉死总数，防只抽一个样本）', totalNodes >= 10, totalNodes + ' 处')
  const ovFiles = Array.from(new Set(overrides.map(o => o.split(':')[0])))
  check('U2b 内联覆盖 card-label 四条声明的位置都在本批写入集之外（实测 ' + overrides.length + ' 处：' + ovFiles.join(',') +
    '）；出现在 editor/route-edit/weather/weather-hub 里就是本批的错',
    overrides.length <= 1 && ovFiles.every(f => f === 'pages/me/me.wxml'), overrides.join(' ｜ '))
  if (overrides.length > 1 || !ovFiles.every(f => f === 'pages/me/me.wxml')) viol('SRC', ovFiles.join(',') || 'none', 'card-label 被内联覆盖且归属不对：' + overrides.join(' '))
  note('既有内联覆盖读数（me.wxml 的 margin-bottom:0，A-23/B-11 同族，本批禁写 me.wxml ⇒ 记 requests.md）：' + (overrides.join(' ｜ ') || '无'))
  const meDefs = definerRules([unit('me').scope[1]], 'card-label')
  check('U1 me.wxss 不再持有第二份基础定义（本页解出的 .card-label 规则数 = ' + meDefs.length + '）', meDefs.length === 0,
    meDefs.map(r => r.sel + '{' + r.prop + ':' + r.val + '}').join(' '))
  if (meDefs.length) viol('SRC', 'pages/me/me.wxss', '.card-label 在本页仍有 ' + meDefs.length + ' 条规则（第二真值源）')
  const base = definerRules([appParsed], 'card-label')
  check('U2 app.wxss 里 .card-label 四条属性齐全（' + base.map(r => r.prop).join(',') + '）',
    ['display', 'font-size', 'font-weight', 'margin-bottom'].every(p => base.some(r => r.prop === p)))
}

/* ===================== §3 影子改写 ===================== */
section('§3 单源必须改得动：影子改 app.wxss 的字号 ⇒ 五页一起动（铁律 31③）')
{
  const users = ['editor', 'route-edit', 'weather', 'weather-hub', 'me']
  const appText = rd(path.join(MP, 'app.wxss'))
  const hits = (appText.match(/font-size:\s*15px/g) || []).length
  const SHADOW = '17px'
  const shadowText = appText.replace(/(\.card-label\s*\{[^}]*?)font-size:\s*15px/, '$1font-size: ' + SHADOW)
  // hits 不要求唯一：15px 这个字号别的规则也会用（合并后 app.wxss 里有 2 处），要求唯一同样是绑偶然状态。
  // 承重的是 SH1——影子只改一处而五页终值一起变，才证明出处只有一个。
  check('SH0 影子真的改到了那一条（app.wxss 里 font-size:15px 共 ' + hits + ' 处，不要求唯一；改动只落一处且落点可寻）',
    shadowText !== appText && (shadowText.match(/font-size:\s*17px/g) || []).length === 1, '')
  const shadowApp = parse(shadowText, 'app.wxss')
  const moved = users.map(id => finalOf(cascade([shadowApp, unit(id).scope[1]], { tag: 'text', classes: ['card-label'] }), 'font-size', shadowApp.tokens).value)
  check('SH1 影子把字号改成 17px ⇒ 五页解出的终值全部变 17（一起动才说明只有一个出处）',
    shadowText !== appText && moved.every(v => v === SHADOW), moved.join('/'))
  const back = users.map(id => finSheet(unit(id), nodeOf(unit(id), 'card-label'), 'font-size').value)
  check('SH2 还原后五页逐项相同（影子没把状态留在别处）', back.every(v => v === '15px'), back.join('/'))
  const fakeMe = parse('.card-label { font-size: 15px; }', 'pages/me/me.wxss')
  const meCopy = finalOf(cascade([shadowApp, fakeMe], { tag: 'text', classes: ['card-label'] }), 'font-size', shadowApp.tokens)
  check('SH3 反证成立：在 me 页塞一份**同值**副本 ⇒ 影子（17px）追不上它、赢家退回 me.wxss ⇒ U1/§2 那条不是摆设',
    meCopy.value === '15px' && meCopy.source === 'pages/me/me.wxss', JSON.stringify(meCopy))
}

/* ===================== §4 privacy 层级 ===================== */
section('§4 privacy：容器与两级标题由全局类承载，段距由本页承载（不新造 container/h1/h2）')
{
  const pv = unit('privacy')
  const multi = pv.scope.reduce((n, pl) => n + pl.rules.filter(r => r.compounds.length > 1 &&
    /(page-title|section-title|card-label|doc-meta|doc-section|page)/.test(r.sel)).length, 0)
  check('PV0 前置门：本作用域里没有「要靠祖先链才命中」的标题/容器规则（有的话单 compound 简化会漏算 ⇒ 停手）', multi === 0, multi + ' 条')
  const root = pv.nodes[0]
  check('PV1 根节点带 page 类（不再是全仓零定义的 container）', root.classes.indexOf('page') !== -1, JSON.stringify(root.classes))
  const sides = { 'padding-top': '24px', 'padding-right': '20px', 'padding-bottom': '32px', 'padding-left': '20px' }
  const sidesGot = Object.keys(sides).map(p => fin(pv, root, p))
  check('PV2 根节点四边内缩终值 = app.wxss 基线 24/20/32（白卡不再贴屏幕四边；简写与长写都算对）',
    sidesGot.every((g, i) => g.value === sides[Object.keys(sides)[i]] && g.source === 'app.wxss'), sidesGot.map(describe).join(' '))
  if (!sidesGot.every((g, i) => g.value === sides[Object.keys(sides)[i]] && g.source === 'app.wxss')) viol('PRIVACY', pv.file, '根节点内缩终值不对：' + sidesGot.map(describe).join(' '))
  const padB = fin(pv, root, 'padding-bottom')
  check('PV3 底部留白终值 = 基线 32px 且不含 84px/安全区：privacy 不在 app.json 的 tabBar.list（isTab=' + pv.isTab + '）',
    padB.value === '32px' && padB.source === 'app.wxss' && pv.isTab === false, describe(padB))
  if (!(padB.value === '32px' && pv.isTab === false)) viol('PRIVACY', pv.file, '底部留白与 tab 身份不一致：' + describe(padB))
  const titles = pv.nodes.filter(n => n.classes.indexOf('page-title') !== -1)
  const t = titles[0]
  const tf = t ? [fin(pv, t, 'font-size'), fin(pv, t, 'font-weight')] : []
  check('PV4 主标题由全局 .page-title 承载（终值 28px/700，赢家出处 = app.wxss；本页不重印层级）',
    titles.length === 1 && tf[0].value === '28px' && tf[0].source === 'app.wxss' && tf[1].value === '700' && tf[1].source === 'app.wxss',
    titles.length + ' 个 page-title：' + tf.map(describe).join(' '))
  if (!(titles.length === 1 && tf[0].value === '28px' && tf[1].value === '700')) viol('PRIVACY', pv.file, '主标题层级没由全局类承载')
  // 合并修正（2026-10-17，并入上游二阶段视觉重构后）：这两条原先把「privacy.wxss 的 .doc-meta/.doc-section」
  // 当成 privacy 屏的唯一合法形状钉死了 ⇒ 上游用 section-head/kicker/section-sub + 容器节奏重排同一屏时必然假红。
  // 钉"某页某个类名出自哪个文件"就是断言依赖工作树的偶然状态（铁律 30 的反面）。判据改回它本来要守的不变量：
  // 层级由 app.wxss 的全局类承载、本页不重印字号字重、间距不得由内联决定。
  const secs = pv.nodes.filter(n => n.classes.indexOf('section-title') !== -1)
  const secRead = secs.map(n => [fin(pv, n, 'font-size'), fin(pv, n, 'font-weight')])
  // 章节条数不是不变量：privacy 于 2026-10-22 新增「第三方数据服务与许可」一节（5 节），
  // 本判据要守的是「每个章节标题的字号/字重终值都来自 app.wxss」，不是「恰好 4 节」。
  const secOk = secs.length >= 4 && secRead.every(r => r[0].value === '16px' && r[0].source === 'app.wxss' &&
    r[1].value === '600' && r[1].source === 'app.wxss')
  check('PV5 章节标题（≥4 节）：字号/字重终值来自 app.wxss（16px/600），段距不钉出处（容器节奏合法）',
    secOk, secs.length + ' 个节点；' + secRead.map(r => r.map(describe).join(' ')).join(' ｜ '))
  if (!secOk) viol('PRIVACY', pv.file, '章节标题终值/出处不对：' + secRead.map(r => r.map(describe).join(' ')).join(' ｜ '))
  // 更新日期那行：认类名不认具体文件名（section-sub 是上游那版用的，doc-meta 是本地那版用的，都合法）。
  // 也不钉「节点自身必须有 margin-top」——上游那版由父容器 .section-head 的节奏承载间距，钉自身声明又是绑形状。
  // 这条真正要守的不变量只有一个：**这一行的间距不得由内联 style 决定**（A-23/B-11 那一族）。
  const dateLine = pv.nodes.filter(n => n.classes.indexOf('doc-meta') !== -1 || n.classes.indexOf('section-sub') !== -1)
  const dl = dateLine[0]
  check('PV6 更新日期那行唯一、无内联 style，间距由样式表（自身或祖先）承载',
    dateLine.length === 1 && (dl.inline || []).length === 0,
    dateLine.length + ' 个候选行：' + (dl ? describe(fin(pv, dl, 'margin-top')) + ' inline=' + (dl.inline || []).length : '无'))
  if (!(dateLine.length === 1 && (dl.inline || []).length === 0)) viol('PRIVACY', pv.file, '更新日期那行缺失，或间距仍由内联决定')
  check('PV7 container/h1/h2 三个名字在本屏彻底消失（既没用也没在本作用域定义 ⇒ 不留第二套层级）',
    ['container', 'h1', 'h2'].every(c => !pv.nodes.some(n => n.classes.indexOf(c) !== -1) && definerRules(pv.scope, c).length === 0),
    ['container', 'h1', 'h2'].filter(c => pv.nodes.some(n => n.classes.indexOf(c) !== -1) || definerRules(pv.scope, c).length).join(','))
  check('PV8 正文两档与强调仍在 privacy.wxss 定义（本批没把 .p/.li/.dot 顺手擦掉，B-16 那条字重读数不受害）',
    ['p', 'li', 'dot'].every(c => definerRules(pv.scope, c).length > 0),
    ['p', 'li', 'dot'].map(c => c + ':' + definerRules(pv.scope, c).length).join(' '))
  check('PV9 privacy 不是 tab 页这一事实由 app.json 现读，不抄名单（tabBar.list ' + tabPaths.size + ' 项，含 privacy = ' + pv.isTab + '）',
    tabPaths.size >= 1 && pv.isTab === false, Array.from(tabPaths).join(','))
}

/* ===================== §5 内联样式 ===================== */
section('§5 privacy 这一屏：样式不再由内联 style 决定（A-23/B-11 同族）')
{
  const pv = unit('privacy')
  const loadBearing = []
  const redundant = []
  pv.nodes.forEach(n => {
    n.inline.forEach(d => {
      const sheet = finalOf(cascade(pv.scope, { tag: n.tag, classes: n.classes }), d.prop, appParsed.tokens)
      const want = String(resolveVars(d.val, appParsed.tokens).raw).trim()
      if (sheet.missing || sheet.value !== want) loadBearing.push(n.tag + '@L' + n.line + ' ' + d.prop + ':' + want + '（样式表解出 ' + (sheet.missing ? '无' : sheet.value) + '）')
      else redundant.push(n.tag + '@L' + n.line + ' ' + d.prop)
    })
  })
  loadBearing.forEach(x => viol('INLINE', 'pages/privacy/privacy.wxml', x))
  check('I1 0 处内联声明在承重（样式表给不出同值 ⇒ 这条样式实际由内联决定 = 坏形态）',
    loadBearing.length === 0, loadBearing.join(' ｜ '))
  const withStyle = pv.nodes.filter(n => n.inline.length).length
  check('I2 本屏 style 属性数 = 0（判据原文「换成类」的直接形态；读数 ' + withStyle + '，其中承重 0 / 冗余 ' + redundant.length + '）',
    withStyle === 0 && redundant.length === 0)
  if (!(withStyle === 0)) viol('INLINE', 'pages/privacy/privacy.wxml', '本屏仍有 ' + withStyle + ' 个 style 属性')
  const other = LIVING.filter(d => d !== 'privacy').reduce((n, id) => n + unit(id).nodes.filter(x => x.inline.length).length, 0)
  note('其余四页的内联 style 共 ' + other + ' 处（A-23/B-11 的账，归其它批次；本批写入集不含它们，见 handoff）')
}

/* ===================== §6 不新增色值/token ===================== */
section('§6 铁律 17：本批没有引入任何新色值或新 token')
{
  const NEW = ['.card-label', '.doc-meta', '.doc-section']
  const offenders = []
  const COLORPROPS = /^(color|background|background-color|border|border-color|border-\w+|outline|box-shadow|fill|stroke)$/
  ;[['app.wxss', appParsed], ['pages/privacy/privacy.wxss', unit('privacy').scope[1]]].forEach(pair => {
    pair[1].rules.forEach(r => {
      if (NEW.indexOf(r.sel) === -1) return
      if (COLORPROPS.test(r.prop)) offenders.push(pair[0] + ' ' + r.sel + '{' + r.prop + '}')
      if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(r.val)) offenders.push(pair[0] + ' ' + r.sel + '{' + r.prop + ':' + r.val + '}')
      if (/^--/.test(r.prop)) offenders.push(pair[0] + ' ' + r.sel + '{' + r.prop + '} 新 token')
    })
  })
  offenders.forEach(x => viol('COLOR', x, '本批新增规则里出现了颜色/token 声明'))
  check('C1 本批新增的三条规则（.card-label/.doc-meta/.doc-section）不含颜色属性、字面色值、新 token',
    offenders.length === 0, offenders.join(' | '))
  const tokCount = Object.keys(appParsed.tokens).length
  const pageTok = appParsed.rules.filter(r => r.sel !== 'page' && /^--/.test(r.prop)).length
  check('C2 token 仍只在 app.wxss 的 page 块声明（实测 ' + tokCount + ' 个，非 page 块的 token 声明 ' + pageTok + ' 处）',
    pageTok === 0 && tokCount >= 25, tokCount + '/' + pageTok)
  check('C3 单位口径：本批新增声明一律 px（privacy 原有 .p/.li 的 27rpx 是 E-09 的账，本批未动、也不由本门判）',
    appParsed.rules.concat(unit('privacy').scope[1].rules).filter(r => NEW.indexOf(r.sel) !== -1 && /rpx/.test(r.val)).length === 0,
    appParsed.rules.concat(unit('privacy').scope[1].rules).filter(r => NEW.indexOf(r.sel) !== -1 && /rpx/.test(r.val)).map(r => r.sel + r.val).join(' '))
}

/* ===================== §7 规范文档登记 ===================== */
section('§7 提升为全局的 .card-label 已登记，且文档数值与代码终值一致')
{
  check('D0 规范文档可读', exists(DOC), DOC)
  const doc = exists(DOC) ? rd(DOC) : ''
  const rows = doc.split(/\r?\n/).filter(l => /^\|\s*`\.card-label`\s*\|/.test(l))
  check('D1 design-system.md 的字号表里有且只有一行 `.card-label`（登记处两份 = 文档侧双真值源）',
    rows.length === 1, rows.length + ' 行')
  if (rows.length !== 1) viol('REG', 'design-system.md', '.card-label 登记行数 = ' + rows.length)
  const mu = unit('me')
  const mn = nodeOf(mu, 'card-label')
  const got = ['font-size', 'font-weight', 'margin-bottom'].map(p => finSheet(mu, mn, p))
  const parity = rows.length === 1 && got.every(g => rows[0].indexOf(g.value) !== -1)
  check('D2 文档那一行的数值 = 代码解出的终值（' + got.map(g => g.value).join('/') + '；文档说别的 ⇒ 红）',
    parity, 'row=' + JSON.stringify((rows[0] || '').slice(0, 90)))
  if (rows.length === 1 && !parity) viol('REG', 'design-system.md', '.card-label 行的数值与代码终值分叉 ' + got.map(g => g.value).join('/'))
  check('D3 登记说明写清它是「卡内小标题」语义且五页共用（否则下一个维护者继续当它是 me 私有）',
    rows.length === 1 && /卡内|小标题/.test(rows[0]) && /5|五/.test(rows[0]), (rows[0] || '').slice(0, 60))
  const stale = doc.split(/\r?\n/).filter(l => /card-label/.test(l) && /me\.wxss/.test(l) && !/原|曾|此前|不是/.test(l))
  check('D4 文档里没有「card-label 属于 me.wxss」这类旧描述残留（旧描述会让四页继续不生效）', stale.length === 0, stale.join(' | '))
  if (stale.length) viol('REG', 'design-system.md', '仍有 ' + stale.length + ' 行把 card-label 说成 me 页私有')
}

/* ===================== §8 接线检查：门真的挂在预提交闸上 ===================== */
// E-08 的指控本体是「判据装在没人跑的门里等于没有门」。日常提交只跑 check.js 与 check-handlers.js，
// 所以这条门光有本套件不够——必须在 check.js 里真的被调用、命中真的记红。
// 这里检查的是**接线**（判据不复制第二份，判定仍由 §0/§1 用同一份 scan() 验）。
section('§8 接线检查（G10 必须真挂在 tools/check.js 上）')
{
  const CHECK_SRC = rd(path.join(ROOT, 'tools', 'check.js'))
  const MSRC = rd(path.join(ROOT, 'tools', 'm02-class-scope-rules.js'))
  const START = '// ==== G10/M-02 新门开始'
  const END = '// ==== G10/M-02 新门结束'
  check('check.js require 的是判据模块本身（不是把判定抄第二遍）',
    /require\('\.\/m02-class-scope-rules'\)/.test(CHECK_SRC) && !/function scanUnits/.test(CHECK_SRC))
  check('整段被哨兵包住（m02 的变异自证靠哨兵切掉它，不靠改判据）',
    CHECK_SRC.indexOf(START) !== -1 && CHECK_SRC.indexOf(END) > CHECK_SRC.indexOf(START))
  const block = CHECK_SRC.slice(CHECK_SRC.indexOf(START), CHECK_SRC.indexOf(END))
  check('夹具自证进了闸（每次提交都确认这条门不是空门）', /M02\.selfProof\(\)/.test(block))
  check('命中逐条 fail、fatal 也 fail、抛错同样 fail（三条一条不缺）',
    /res\.hits\.forEach\(h => fail\(/.test(block) && /if \(res\.fatal\) fail\(/.test(block) && /判据抛错/.test(block))
  check('夹具为空即红（SELF_CASES 被摘空时不能靠「一条都不用验」混成绿）', /SELF_CASES\.length\) fail\(/.test(block) || /!M02\.SELF_CASES\.length\) fail\(/.test(block))
  check('落门带的是命中判定，没有豁免清单/跳过文件名单',
    !/KNOWN_[A-Z]+\s*=/.test(MSRC) && !/SKIP[A-Z_]*\s*=/.test(MSRC) && !/allowlist\s*=/.test(MSRC) &&
    !/EXEMPT[A-Z_]*\s*=/.test(MSRC))
  check('判据不认页面名/组件名（作用域一律由目录枚举与自己的 styleIsolation 声明现读）',
    !/'(editor|privacy|route-edit|weather|weather-hub|discover)'/.test(MSRC), '')
}

/* ===================== 汇总 ===================== */
section('§9 读数闭合')
const e10 = VIOL.filter(v => v.indexOf('|E10|') !== -1).length
check('Z1 E10 违例行数 = 命中数（' + e10 + ' = ' + HITS.length + '；漏一条就是违例账本与读数不同步）', e10 === HITS.length)
const uniq = new Set(VIOL).size
check('Z2 违例账本去重后 ' + uniq + ' 条，分类：E10 ' + e10 + ' / SRC ' + VIOL.filter(v => /\|SRC\|/.test(v)).length +
  ' / PRIVACY ' + VIOL.filter(v => /\|PRIVACY\|/.test(v)).length + ' / INLINE ' + VIOL.filter(v => /\|INLINE\|/.test(v)).length +
  ' / COLOR ' + VIOL.filter(v => /\|COLOR\|/.test(v)).length + ' / REG ' + VIOL.filter(v => /\|REG\|/.test(v)).length, uniq === VIOL.length)
console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
