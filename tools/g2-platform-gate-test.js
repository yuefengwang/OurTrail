// 平台硬规则静态门（E-08 剩余门）：node tools/g2-platform-gate-test.js
//
// E-08 的指控：platform-pitfalls.md 的 14 条平台硬规则**一条都没有被翻译成可执行断言**，
// 于是「check.js 全绿 + check-handlers.js 全绿 + journey-graph 全绿」会被误读成
// 「平台与布局层面没问题」。本轮实证的那 7 条（E-01/E-02/E-03/E-06/E-07/E-15/E-16）
// 全部落在盲区里；其中三条（options 重复键、具名 slot 静默丢弃、事件属性名写错）
// 本来**可以静态判定**，只是当时没有门去判。
//
// 已经由别的批次落地的不重复造：
//  · 事件属性名合法性（缺 bind/catch 前缀）→ tools/check.js 第 8 步 + tools/fixround2-event-attr-rule.js
//  · overlay 组件自身的 options / 反向孤儿 → tools/overlay-semantics-test.js（只管 overlay）
//  · 禁用态层叠终值 → tools/style-semantics-test.js
// 本门补的是**全仓范围**的：组件装载姿态、具名 slot 契约、WXSS 特性黑名单、sticky 偏移、
// 固定底栏留白、tabBar 留白公式的归属。
//
// 判据纪律：
//  · **钉行为不钉源码文本**（铁律 30）：options 那条读的是「真 require 之后框架拿到的那份配置」，
//    不是文件里有几个 `options:` 字样——重复键这个坑的表现恰好就是「后写覆盖前写、styleIsolation 消失」，
//    装载结果判据既抓得住重复键，也不会因为合法重构（把 options 挪进变量）而假红。
//  · **存量登记只许变少**（复用 check.js 的 KNOWN_BARE_CHECKBOX 机制）：本轮命中的两处
//    （weather.wxss 的死 sticky、anotices 的 tab 专用留白）修复权在 STYLE2，不在本门 owner，
//    所以登记而非放宽判据；登记项一旦被修好，本门会把它点名出来要求删除，防止清单烂成第二本账。
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')

let passed = 0, failed = 0
const fails = []
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; fails.push(name); console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function note(t) { console.log('  · ' + t) }
const rel = f => path.relative(MP, f).split(path.sep).join('/')

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'assets' || name === 'node_modules') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const FILES = walk(MP, [])
const WXMLS = FILES.filter(f => f.endsWith('.wxml'))
const WXSSS = FILES.filter(f => f.endsWith('.wxss'))
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ')

/* ---------- 装载真组件配置用的 wx 桩（与 tools/*-test.js 同一思路：不模拟渲染，只要 cfg） ---------- */
function makeWxStub() {
  const noop = () => {}
  const base = {
    cloud: { init: noop, callFunction: () => ({ then: () => Promise.resolve({ result: { ok: true, value: null } }) }) },
    getStorageSync: () => '', setStorageSync: noop, removeStorageSync: noop,
    getSystemInfoSync: () => ({ windowWidth: 390, screenWidth: 390, pixelRatio: 2, safeArea: { bottom: 340 }, statusBarHeight: 20 }),
    getWindowInfo: () => ({ windowWidth: 390, safeArea: { bottom: 340 } }),
    canIUse: () => true,
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: noop }), fields: () => ({ exec: noop }) }), in: () => ({ select: () => ({ boundingClientRect: () => ({ exec: noop }) }) }) }),
    createSelectorQuerySync: () => ({}),
    createInnerAudioContext: () => ({ onCanplay: noop, onPlay: noop, onPause: noop, onEnded: noop, destroy: noop }),
    createAnimation: () => ({}),
    getUpdateManager: () => ({ onUpdateReady: noop, applyUpdate: noop }),
    showToast: noop, hideToast: noop, showLoading: noop, hideLoading: noop, showModal: noop,
    setNavigationBarTitle: noop, navigateTo: noop, redirectTo: noop, navigateBack: noop, switchTab: noop,
    setClipboardData: noop, vibrateLong: noop, vibrateShort: noop, stopPullDownRefresh: noop,
    pageScrollTo: noop, scrollToTop: noop, getStorage: noop, setStorage: noop, removeStorage: noop,
    onWindowResize: noop, offWindowResize: noop, env: {},
  }
  return new Proxy(base, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? noop : undefined)) })
}

const CONFIG_KEYS = new Set(['data', 'properties', 'methods', 'observers', 'lifetimes', 'options',
  'pageLifetimes', 'behaviors', 'relations', 'externalClasses', 'definitionFilter', 'hostOptions'])

/** 真 require 一个页面/组件文件，拿到框架实际收到的那份配置。 */
function loadConfig(file) {
  const bag = {}
  global.wx = makeWxStub()
  global.Page = cfg => { bag.cfg = cfg; bag.kind = 'Page' }
  global.Component = cfg => { bag.cfg = cfg; bag.kind = 'Component' }
  global.getApp = () => ({ globalData: {}, showErrorToast: false })
  global.getCurrentPages = () => []
  delete require.cache[require.resolve(file)]
  try {
    require(file)
  } catch (e) {
    return { error: String((e && e.message) || e).split('\n')[0], cfg: null }
  }
  return { cfg: bag.cfg || null, kind: bag.kind }
}

/* ================= §1 组件装载姿态：styleIsolation 必须在装载结果里活着 ================= */
// platform-pitfalls §1 称之为「最大坑」；AGENTS.md 铁律 1 记过事故（daa0508）：
// 同一个 Component() 里写第二次 options 会**静默覆盖**第一次，styleIsolation 就此消失，
// 表现是「.card 有边框没颜色」——var(--forest) 在组件里能解析，全局类却一条都不套。
section('§1 组件装载后的 options（重复键的后果只能在装载结果里看见）')
const DEAD_COMPONENTS = [
  // 已下线但文件保留（AGENTS.md「NOTES」）：它不依赖全局类，也不需要 options。
  { name: 'privacy-popup', finding: 'E-09', note: '死代码，app.json 已取消注册；重新启用时必须补 styleIsolation。' },
]
{
  const compDir = path.join(MP, 'components')
  const dirs = fs.readdirSync(compDir).filter(d => fs.existsSync(path.join(compDir, d, d + '.js')))
  const dead = new Set(DEAD_COMPONENTS.map(x => x.name))
  const loaded = []
  const loadFail = []
  for (const d of dirs) {
    const r = loadConfig(path.join(compDir, d, d + '.js'))
    if (r.error || !r.cfg) { loadFail.push(d + '：' + (r.error || '没有捕获到 Component() 配置')); continue }
    loaded.push({ name: d, cfg: r.cfg })
  }
  check('组件清单非空且全部装载成功（装载失败就等于本步空转——check.js:131 的分隔符教训）',
    loaded.length >= 10 && loadFail.length === 0,
    JSON.stringify({ loaded: loaded.length, loadFail }))
  loadFail.forEach(x => console.error('    ✗ 装载失败：' + x))
  const alive = loaded.filter(x => !dead.has(x.name))
  const missing = alive.filter(x => !x.cfg.options || x.cfg.options.styleIsolation !== 'apply-shared')
  missing.forEach(x => console.error('    ✗ ' + x.name + ' 装载后的 options 里没有 apply-shared'))
  check('每个在用组件装载后都带 styleIsolation:apply-shared（第二个同名 options 键覆盖掉它的写法当场红）',
    alive.length > 0 && missing.length === 0, missing.map(x => x.name).join(','))
  const isolatedOk = alive.every(x => x.cfg.options && x.cfg.options.styleIsolation === 'apply-shared')
  check('不靠源码里数字样出现次数判事（合法改写不会假红）：判据只读装载结果', isolatedOk)
  note('在用组件 ' + alive.length + ' 个；登记为死代码的 ' + dead.size + ' 个（' + [...dead].join(',') + '）')
}

/* ================= §2 具名 slot ↔ multipleSlots 契约 ================= */
// AGENTS.md:109 记的是 P4 真机 bug：缺 multipleSlots 时**具名 slot 的内容被静默丢弃**，
// 组件 data 里一切正常、页面上什么都没有——纯逻辑测试天然测不到。
section('§2 具名 slot 与 multipleSlots 必须成对')
{
  const defs = []   // 组件自己声明的 <slot name="x">
  const uses = []   // 任何 wxml 里 slot="x"（往子组件的具名 slot 里塞内容）
  for (const f of WXMLS) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    for (const m of text.matchAll(/<slot\s+name="([^"]+)"/g)) defs.push({ file: rel(f), name: m[1] })
    for (const m of text.matchAll(/\sslot="([^"{]+)"/g)) uses.push({ file: rel(f), name: m[1] })
  }
  const byComponent = new Map()
  for (const d of defs) {
    const name = path.basename(path.dirname(d.file))
    if (!byComponent.has(name)) byComponent.set(name, [])
    byComponent.get(name).push(d.name)
  }
  const violations = []
  for (const [name, slots] of byComponent) {
    const js = path.join(MP, 'components', name, name + '.js')
    if (!fs.existsSync(js)) { violations.push(name + '：声明了具名 slot 却找不到同名组件 JS'); continue }
    const r = loadConfig(js)
    const opts = (r.cfg && r.cfg.options) || {}
    if (opts.multipleSlots !== true) violations.push(name + '：具名 slot ' + JSON.stringify(slots) + ' 缺 multipleSlots:true（内容会被静默丢弃）')
  }
  const defNames = new Set(defs.map(d => d.name))
  const orphanUse = uses.filter(u => !defNames.has(u.name))
  violations.forEach(v => console.error('    ✗ ' + v))
  check('声明了具名 slot 的组件，装载结果里 multipleSlots 必须为 true', violations.length === 0, violations.join(' ; '))
  check('每个 slot="x" 的用法都指回一个真实存在的具名 slot（写错名字=内容永不出现，且不报错）',
    orphanUse.length === 0, orphanUse.map(u => u.file + '→' + u.name).join(','))
  note('具名 slot 声明 ' + defs.length + ' 处 · 消费 ' + uses.length + ' 处')
  check('本步确有样本可判（一条具名 slot 都没有就是空转，与 check.js:140 同一课）',
    defs.length + uses.length > 0, JSON.stringify({ defs: defs.length, uses: uses.length }))
}

/* ================= §3 WXSS 不支持特性黑名单 ================= */
// 铁律 13：WXSS 没有 color-mix()、没有 :root（要写 page）、没有可靠 dvh；
// 通配选择器与 :has() 在 Skyline/渲染层同样不可依赖。现状合规纯靠人工纪律，零防回归。
section('§3 WXSS 特性黑名单（微信渲染层不支持的写法）')
{
  const BANNED = [
    [/color-mix\s*\(/, 'color-mix() 不支持，混色必须预先算成字面量'],
    [/(^|[^-\w]):root\b/, ':root 不生效，token 必须挂在 page 上'],
    [/\b\d+(?:\.\d+)?(?:dvh|svh|lvh)\b/, 'dvh/svh/lvh 不可靠，用 vh 或 px'],
    [/backdrop-filter\s*:/, 'backdrop-filter 不作为承重样式（低端机不渲染）'],
    [/:has\s*\(/, ':has() 不支持'],
  ]
  const hits = []
  for (const f of WXSSS) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    for (const [re, why] of BANNED) {
      const m = text.match(re)
      if (m) hits.push(rel(f) + ' 「' + m[0].trim() + '」 ' + why)
    }
    // 通配选择器只看选择器位（声明块内出现 * 也一律视为可疑）
    for (const b of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = b[1].trim()
      if (/(^|[\s>+~,])\*/.test(selector)) hits.push(rel(f) + ' 选择器「' + selector.replace(/\s+/g, ' ') + '」用了通配 *')
    }
  }
  hits.forEach(h => console.error('    ✗ ' + h))
  check('没有任何 WXSS 不支持特性被引入（扫了 ' + WXSSS.length + ' 个 wxss）', hits.length === 0, hits.length + ' 处')
  check('扫描器确有输入（wxss 清单为空＝静默空转）', WXSSS.length >= 20, 'wxss=' + WXSSS.length)
  note('注释里提到 color-mix()/dvh 不算命中：本步先把块注释剥掉再判（app.wxss:2 那行说明文字是合法的）')
}

/* ================= §4 position: sticky 必须带偏移 ================= */
section('§4 写了 position:sticky 就必须给偏移量（否则是一条永不生效的死声明）')
const KNOWN_STICKY_NO_OFFSET = [
  // E-06：pages/weather/weather.wxss 的 .num-head 只写了 position:sticky，没有任何 top/bottom/left/right
  // ⇒ 24 行逐小时表的表头随页面滚走。修复权在 STYLE2（Wave2 派单 §1），本门先钉住「不得再多一处」。
  { file: 'pages/weather/weather.wxss', selector: '.num-head', finding: 'E-06 / E-08(8)', owner: 'STYLE2' },
]
{
  const hits = []
  for (const f of WXSSS) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    for (const b of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = b[1].trim().replace(/\s+/g, ' ')
      const body = b[2]
      if (!/position\s*:\s*sticky/.test(body)) continue
      if (/(^|[;{\s])(top|bottom|left|right)\s*:/.test(body)) continue
      hits.push({ file: rel(f), selector })
    }
  }
  const key = x => x.file + '#' + x.selector
  const known = new Set(KNOWN_STICKY_NO_OFFSET.map(x => key(x)))
  const fresh = hits.filter(x => !known.has(key(x)))
  const stale = KNOWN_STICKY_NO_OFFSET.filter(x => !hits.some(h => key(h) === x.file + '#' + x.selector))
  hits.forEach(h => console.log('    · 死 sticky：' + h.file + ' ' + h.selector))
  stale.forEach(x => console.log('    · 登记项已修好，请从 KNOWN_STICKY_NO_OFFSET 删除：' + x.file + ' ' + x.selector + '（' + x.finding + '）'))
  fresh.forEach(x => console.error('    ✗ 新增：' + x.file + ' ' + x.selector + ' 写 position:sticky 却没有 top/bottom/left/right，该规则永不生效'))
  check('sticky 死声明没有新增（存量 ' + hits.length + ' 处已登记）', fresh.length === 0, '新增 ' + fresh.length + ' 处')
  // 登记项一旦被修好只点名要求清理，不报红——与 check.js 的 KNOWN_BARE_CHECKBOX 同一套语义：
  // 「存量变少」是好事，把它判成红等于惩罚修复（本轮 STYLE2 正在修 E-06/E-03，判红就是假红）。
  stale.forEach(x => note('登记项已修好，请从 KNOWN_STICKY_NO_OFFSET 删除：' + x.file + ' ' + x.selector + '（' + x.finding + '｜owner=' + x.owner + '）'))
}

/* ================= §5 固定底栏与页尾留白必须配对 ================= */
// .sticky-action 是 position:fixed，不计入文档流；页面不挂 .page.has-sticky 就会被底栏压住尾行
// （E-02 本体，P1）。app.wxss 的 .page.has-sticky 定义在全仓零引用那次是它的反向证据。
section('§5 用 .sticky-action 的页面必须同时挂上 .page.has-sticky')
{
  const app = stripComments(fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8'))
  check('app.wxss 里 .page.has-sticky 这条机制仍然存在（规则被删掉时本步不得静默通过）',
    /\.page\.has-sticky\s*\{/.test(app))
  // WXML 注释也算注释：route-edit.wxml 顶部的说明里就写着 has-sticky，不剥掉的话
  // 「把绑定改坏但注释还留着」这种回退会一路绿灯（本轮 E5 变异第一次就是这么漏网的）。
  const stripWxml = s => s.replace(/<!--[\s\S]*?-->/g, ' ')
  const users = []
  for (const f of WXMLS) {
    const text = stripWxml(stripComments(fs.readFileSync(f, 'utf8')))
    if (!/class="[^"]*\bsticky-action\b/.test(text)) continue
    // 判据落在**根节点的 class 表达式**上：has-sticky 必须真的挂在 .page 那一行，
    // 而不是「文件里某个地方提到过它」（后者可以是注释、也可以是挂在别的元素上）。
    const root = text.match(/class="[^"]*\bpage\b[^"]*"/)
    users.push({ file: rel(f), root: root ? root[0] : null, hasSticky: !!root && /has-sticky/.test(root[0]) })
  }
  const gaps = users.filter(u => !u.hasSticky)
  users.forEach(u => console.log('    · ' + u.file + ' 用固定底栏；根节点 class = ' + (u.root || '(找不到带 page 的根 class)') + ' ⇒ has-sticky=' + u.hasSticky))
  gaps.forEach(u => console.error('    ✗ ' + u.file + ' 有 .sticky-action 却没在 .page 上挂 has-sticky ⇒ 页尾最后一行被底栏压住'))
  check('固定底栏与页尾留白一一配对（缺一即红）', gaps.length === 0, gaps.map(u => u.file).join(','))
  check('确有页面在用固定底栏（一条都没有就是本步空转）', users.length > 0, JSON.stringify(users.length))
}

/* ================= §6 tabBar 专用留白公式不得外溢 ================= */
// tab 页底部要让出 tabbar（32px + 84px + 安全区），非 tab 页照抄就多出一截空白（E-03/M-18）。
// 这条**可以纯静态判定**：tabBar 名单来自 app.json，公式来自 wxss 文本。
section('§6 tabBar 留白公式只许 tab 页用')
const KNOWN_TAB_FORMULA_LEAKS = [
  // E-03 / M-18：anotices 不在 app.json 的 tabBar.list 里，却整套抄了 tab 页的 84px 留白。
  // 修复权在 STYLE2（M-18 已派单），先登记不放宽判据。
  { file: 'pages/anotices/anotices.wxss', finding: 'E-03 / M-18', owner: 'STYLE2' },
]
{
  const appJson = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'))
  const list = ((appJson.tabBar && appJson.tabBar.list) || []).map(x => x.pagePath)
  check('app.json 的 tabBar.list 读得出（读不出来这条门整个没有输入）', list.length >= 2, JSON.stringify(list))
  const TAB_FORMULA = /padding-bottom:\s*calc\(\s*32px\s*\+\s*84px/
  const dirOf = pagePath => pagePath.split('/')[1]
  const tabDirs = new Set(list.map(dirOf))
  const pageDirs = fs.readdirSync(path.join(MP, 'pages'))
  const missing = []
  const leaked = []
  for (const d of pageDirs) {
    const wxss = path.join(MP, 'pages', d, d + '.wxss')
    if (!fs.existsSync(wxss)) continue
    const has = TAB_FORMULA.test(fs.readFileSync(wxss, 'utf8'))
    if (tabDirs.has(d) && !has) missing.push(rel(wxss))
    if (!tabDirs.has(d) && has) leaked.push(rel(wxss))
  }
  const known = new Set(KNOWN_TAB_FORMULA_LEAKS.map(x => x.file))
  const freshLeaks = leaked.filter(x => !known.has(x))
  const staleLeaks = KNOWN_TAB_FORMULA_LEAKS.filter(x => !leaked.includes(x.file))
  leaked.forEach(x => console.log('    · 非 tab 页抄了 tab 留白：' + x))
  staleLeaks.forEach(x => console.log('    · 登记项已修好，请从 KNOWN_TAB_FORMULA_LEAKS 删除：' + x.file + '（' + x.finding + '）'))
  freshLeaks.forEach(x => console.error('    ✗ 新增：' + x + ' 不在 tabBar.list 里，却用 calc(32px + 84px + 安全区) ⇒ 页尾多出一截空白'))
  missing.forEach(x => console.error('    ✗ ' + x + ' 是 tab 页却没有 tab 专用留白 ⇒ 最后一行会被 tabbar 盖住'))
  check('非 tab 页不得套 tabBar 留白公式（存量已登记，只许变少）', freshLeaks.length === 0, '新增 ' + freshLeaks.length + ' 处')
  check('每个 tab 页都留出了 tabbar 的高度', missing.length === 0, missing.join(','))
  // 同 §4：登记项被修好只点名要求删除，不报红（修 E-03/M-18 的人不该被门惩罚）。
  staleLeaks.forEach(x => note('登记项已修好，请从 KNOWN_TAB_FORMULA_LEAKS 删除：' + x.file + '（' + x.finding + '｜owner=' + x.owner + '）'))
}

console.log('\n==== passed=' + passed + ' failed=' + failed + ' ====')
if (fails.length) console.log('失败项：\n' + fails.map(f => '  - ' + f).join('\n'))
process.exit(failed ? 1 : 0)
