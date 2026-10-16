// WXML ↔ JS handler 交叉校验：
//   ① 页面/组件 WXML 绑定的事件处理函数在对应 JS 里都存在；
//   ② 处理函数读 e.currentTarget.dataset.X 时，绑定它的那个标签必须真的写了 data-X；
//   ③ 反向孤儿 handler（门 B 窄版）：定义了、既没被任何模板绑定、又没有任何调用点的 onXxx 方法。
// ②是必须的：checkbox-group 的 change 事件里 currentTarget 是 group 本身，data-key 若挂在内层
// label 上，handler 读到的是 undefined——真机上勾选既不新增也不移除，而桩里手搓的事件对象会替
// 产品补上这个字段，node 侧测试全绿。signup 勾选同行人就是这么漏网的（2026-10-04 真机定案）。
// ③防的是 M-09 那一类「代码在、路径死」：onAnimationEnd 定义了、模板写错了属性名（animation-end），
// 于是方法永不执行，而 ① 只查「模板→JS」方向，看不见它。
// ③的口径为什么窄（见 out/G1/requests.md R-2 与本轮 out/G2/verify.txt 的命中清单）：
//   字面判据「定义了但模板没绑定」全仓命中 196，剔除平台生命周期仍命中 152 —— 那 152 条几乎全是
//   **被 JS 调用的内部 helper**（render / reload / draw / validate…），落下去就是 152 条常驻红；
//   再收窄到「onXxx 形态」是 4 条，其中 3 条其实被 JS 调用着（home.onClearSearch /
//   editor.onPublishOpen / weather.onWeatherReady），只有 1 条真的谁也调不到。
//   所以本步的判据是四条同时成立：onXxx 形态 · 不是平台回调 · 全仓任何模板都没绑它 · 全仓没有任何调用点。
//   存量那 1 条按 KNOWN_DEAD_HANDLERS 登记，**只许变少不许变多**（与 check.js 的 KNOWN_BARE_CHECKBOX 同构）。
// 用法：node tools/check-handlers.js [页面目录名]，缺省检查全部页面。
'use strict'
const fs = require('fs')
const path = require('path')

const baseDir = path.join(__dirname, '..', 'miniprogram')
const targets = [path.join(baseDir, 'pages'), path.join(baseDir, 'components')]
const only = process.argv[2]
let bad = 0

// 取函数体：从签名后的第一个 { 起做括号配平（本仓库 handler 一律是方法简写或 function 形式）
function bodyOf(js, name) {
  const sig = new RegExp('\\b' + name + '\\s*(?:\\(\\s*[a-zA-Z_$][\\w$]*\\s*\\)|:\\s*(?:async\\s+)?function\\s*\\(\\s*[a-zA-Z_$][\\w$]*\\s*\\))\\s*\\{')
  const m = sig.exec(js)
  if (!m) return ''
  let i = m.index + m[0].length, depth = 1, quote = ''
  while (i < js.length && depth > 0) {
    const c = js[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; i++; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    i++
  }
  return js.slice(m.index + m[0].length, i - 1)
}

// handler 从 currentTarget 上读的 dataset 键（解构与逐字段两种写法都算；方括号动态取值跳过）
function readsDatasetKeys(body) {
  if (!body) return null
  if (/currentTarget\.dataset\s*\[/.test(body)) return null
  const keys = new Set()
  for (const m of body.matchAll(/\.currentTarget\.dataset\.([A-Za-z_$][\w$]*)/g)) keys.add(m[1])
  for (const m of body.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*[A-Za-z_$][\w$.]*\.currentTarget\.dataset/g)) {
    for (const part of m[1].split(',')) {
      const k = part.split(':')[0].trim()
      if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.add(k)
    }
  }
  return keys
}

const attrName = key => 'data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())

// 去掉注释后拆开标签：返回 [{ tag, attrs }]
function openingTags(wxml) {
  const stripped = wxml.replace(/<!--[\s\S]*?-->/g, '')
  const out = []
  for (const m of stripped.matchAll(/<([a-zA-Z][\w-]*)\s([^>]*?)\/?>/g)) out.push({ tag: m[1], attrs: m[2] })
  return out
}

for (const pagesDir of targets) {
  for (const dir of fs.readdirSync(pagesDir)) {
    if (only && dir !== only) continue
    const wxmlPath = path.join(pagesDir, dir, dir + '.wxml')
    const jsPath = path.join(pagesDir, dir, dir + '.js')
    if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) continue
    const wxml = fs.readFileSync(wxmlPath, 'utf8')
    let js = fs.readFileSync(jsPath, 'utf8')
    // 跟进页面 require 的本地模块（如 utils/notices-page），handler 可能定义在共享工厂里
    for (const m of js.matchAll(/require\('((?:\.\.\/)+[^']+)'\)/g)) {
      let p = path.resolve(path.dirname(jsPath), m[1])
      if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js'
      if (fs.existsSync(p)) js += fs.readFileSync(p, 'utf8')
    }
    const handlers = new Set()
    // 三类绑定都审计：①直连 bindtap="fn"；②组件事件 bind:close="fn"（冒号前缀原先漏检）；
    // ③表达式绑定 bindtap="{{busy ? '' : 'fn'}}"——提取其中的标识符字面量（原先整类漏检）
    for (const m of wxml.matchAll(/(?:bind|catch)[a-z]*(?::[a-z-]+)?="([^"]*)"/g)) {
      const v = m[1]
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) { handlers.add(v); continue }
      for (const s of v.matchAll(/'([A-Za-z_][A-Za-z0-9_]*)'/g)) {
        if (s[1]) handlers.add(s[1])
      }
    }
    const missing = [...handlers].filter(h => {
      const re = new RegExp('\\b' + h + '\\s*[:(]', 'm')
      return !re.test(js)
    })
    const kind = pagesDir.endsWith('components') ? '组件 ' : ''

    // —— ② dataset 契约（只对 checkbox-group / radio-group 的 change 绑定生效）——
    // 作用域刻意收窄：这两类控件的 change 事件 currentTarget 恒为 group 本身，data-* 挂到内层
    // label/checkbox 上就等于没挂。已复核的另外两处 dataset 读取（workspace onTransition 的
    // dataset.next、transport-panel openAssign 的 seat/occupant）都带 `|| 兜底`，属有意设计，不在此列。
    const datasetGaps = []
    for (const t of openingTags(wxml)) {
      if (t.tag !== 'checkbox-group' && t.tag !== 'radio-group') continue
      const bound = []
      for (const m of t.attrs.matchAll(/bindchange="([^"]*)"/g)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(m[1])) bound.push(m[1])
      }
      if (!bound.length) continue
      const present = new Set(t.attrs.match(/\bdata-[a-z0-9-]+/g) || [])
      for (const h of bound) {
        const keys = readsDatasetKeys(bodyOf(js, h))
        if (!keys) continue
        for (const k of keys) {
          const want = attrName(k)
          if (present.has(want)) continue
          datasetGaps.push('<' + t.tag + ' bindchange=' + h + '> 读 dataset.' + k + ' 但该 group 上没有 ' + want + '（内层 label 上的 data-* 不会进 currentTarget）')
        }
      }
    }

    if (missing.length || datasetGaps.length) {
      bad++
      if (missing.length) console.log('✗ ' + kind + dir + ': JS 中不存在 → ' + missing.join(', '))
      if (datasetGaps.length) console.log('✗ ' + kind + dir + ': dataset 契约断裂 → ' + datasetGaps.join(' ; '))
    } else {
      console.log('✓ ' + kind + dir + ' (' + handlers.size + ' handlers, dataset 契约相符)')
    }
  }
}

/* ================= ③ 反向孤儿 handler（门 B 窄版） =================
 * 定义取自真 Page()/Component() 配置，不用正则猜方法名（正则会把 if/for/图标名当方法，
 * 命中数不可信——out/G1 的探针实测就是这么得出 196/152/4 三档的）。
 * 判定「死」要四条同时成立：onXxx 形态 · 不是平台回调 · 全仓任何模板都没绑它 · 全仓没有任何调用点。
 */
const PLATFORM_CALLBACKS = new Set([
  'onLoad', 'onShow', 'onHide', 'onUnload', 'onResize', 'onReady', 'onPullDownRefresh', 'onReachBottom',
  'onShareAppMessage', 'onShareTimeline', 'onAddToFavorites', 'onTabItemTap', 'onPageScroll',
  'onBackPress', 'onThemeChange', 'onError', 'onKeyboardHeightChange', 'onWindowResize',
])
// 存量已登记（只许变少）：修掉一处就删一行，删空之后本步即硬门禁。
const KNOWN_DEAD_HANDLERS = [
  {
    file: 'pages/editor/editor.js', name: 'onNumber', finding: 'Wave1′ 门 B 评估唯一真命中（out/G1/requests.md R-2）',
    owner: 'ROUTE2（pages/editor 归它）',
    note: 'editor 的数字输入（capacity/distanceKm/ascentM）现在一律走 data-key + bindinput="onField"，'
      + '这条 handler 全仓只剩定义处一次命中——既没绑定也没调用。删它或接线都由 owner 决定，本门只负责不再多出第二条。',
  },
]
{
  const scanDirs = [path.join(baseDir, 'pages'), path.join(baseDir, 'components')]
  // 全仓文本索引：模板里的绑定、其它文件里的调用，都算「这个 handler 有人用」。
  const ALL = []
  const collect = dir => {
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) collect(p)
      else if (/\.(js|wxml|wxs|json)$/.test(name)) ALL.push(p)
    }
  }
  scanDirs.forEach(collect)
  const tabbar = path.join(baseDir, 'custom-tab-bar')
  if (fs.existsSync(tabbar)) collect(tabbar)

  const texts = new Map()
  for (const f of ALL) texts.set(f, fs.readFileSync(f, 'utf8'))
  const relKey = f => path.relative(baseDir, f).split(path.sep).join('/')
  const countAll = name => {
    let n = 0
    const re = new RegExp('\\b' + name + '\\b', 'g')
    for (const t of texts.values()) { const m = t.match(re); if (m) n += m.length }
    return n
  }
  // 定义行的出现不算调用（`onNumber(e) {` / `onFoo: function` / `onFoo(){`）
  const countDefs = name => {
    let n = 0
    const re = new RegExp('^\\s*(?:async\\s+)?' + name + '\\s*[:(]', 'm')
    for (const t of texts.values()) for (const line of t.split(/\r?\n/)) if (re.test(line)) n++
    return n
  }

  const CONFIG_KEYS = new Set(['data', 'properties', 'methods', 'observers', 'lifetimes', 'options',
    'pageLifetimes', 'behaviors', 'relations', 'externalClasses', 'definitionFilter', 'hostOptions'])
  const noop = () => {}
  const baseStub = {
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
    setClipboardData: noop, vibrateLong: noop, vibrateShort: noop, stopPullDownRefresh: noop, pageScrollTo: noop,
    getStorage: noop, setStorage: noop, removeStorage: noop, onWindowResize: noop, offWindowResize: noop, env: {},
  }
  const wxStub = new Proxy(baseStub, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? noop : undefined)) })

  const jsFiles = ALL.filter(f => f.endsWith('.js'))
  const evaluated = []
  const unloadable = []
  const pureModules = []
  for (const f of jsFiles) {
    if (relKey(f) === 'app.js') continue // app() 的配置不是模板的宿主
    const bag = {}
    global.wx = wxStub
    global.Page = cfg => { bag.cfg = cfg }
    global.Component = cfg => { bag.cfg = cfg }
    global.getApp = () => ({ globalData: {}, showErrorToast: false })
    global.getCurrentPages = () => []
    delete require.cache[require.resolve(f)]
    try {
      require(f)
    } catch (e) {
      unloadable.push(relKey(f) + '：装载抛错 → ' + String((e && e.message) || e).split('\n')[0])
      continue
    }
    // 没有 Page()/Component() 的文件是纯模块（layout.js / fixtures.js 之类），
    // 它本来就没有 handler，不属于本步的评估面——跳过而不是报警，免得真信号被噪音盖住。
    if (!bag.cfg) { pureModules.push(relKey(f)); continue }
    const names = Object.keys(bag.cfg).filter(k => !CONFIG_KEYS.has(k))
    Object.keys(bag.cfg.methods || {}).forEach(k => names.push(k))
    evaluated.push({ file: relKey(f), names })
  }
  if (unloadable.length) {
    unloadable.forEach(u => console.log('⚠ 门 B 无法评估（装载失败，该文件的孤儿判据本轮不覆盖）→ ' + u))
    if (evaluated.length === 0) {
      console.log('✗ 门 B 一个文件都没评估成（清单为空＝整步静默空转，与 check.js:140 同一课）')
      bad++
    }
  }

  const orphan = []
  let onShape = 0, unbound = 0
  for (const ev of evaluated) {
    if (only && path.basename(path.dirname(ev.file)) !== only) continue
    for (const name of ev.names) {
      if (!/^on[A-Z]/.test(name)) continue
      if (PLATFORM_CALLBACKS.has(name)) continue
      onShape++
      const defs = countDefs(name)
      const total = countAll(name)
      if (total - defs <= 0) { unbound++; orphan.push({ file: ev.file, name }) }
    }
  }
  const key = o => o.file + '#' + o.name
  const known = new Set(KNOWN_DEAD_HANDLERS.map(x => x.file + '#' + x.name))
  const fresh = orphan.filter(o => !known.has(key(o)))
  const stale = KNOWN_DEAD_HANDLERS.filter(x => !orphan.some(o => key(o) === x.file + '#' + x.name))
  console.log('— 门 B 窄版命中清单：装载成功 ' + evaluated.length + ' 个模板宿主 · 纯模块跳过 ' + pureModules.length
    + ' 个 · onXxx 且非平台回调 ' + onShape
    + ' 个 · 其中「模板未绑定且无任何调用点」' + orphan.length + ' 个 —')
  orphan.forEach(o => console.log('  · 死 handler：' + o.file + '#' + o.name))
  stale.forEach(x => console.log('  · 登记项已不存在，请从 KNOWN_DEAD_HANDLERS 删除：' + x.file + '#' + x.name + '（' + x.finding + '｜owner=' + x.owner + '）'))
  fresh.forEach(o => console.log('✗ 门 B：' + o.file + '#' + o.name + ' 定义了、模板没绑定、全仓也没有任何调用点 ⇒ 这条路径永不执行'))
  if (fresh.length) bad++
  else if (orphan.length) console.log('✓ 门 B：死 handler 未增加（存量 ' + orphan.length + ' 条已登记，只许变少）')
  else console.log('✓ 门 B：没有「定义了却谁也调不到」的 onXxx handler')
}
process.exit(bad ? 1 : 0)
