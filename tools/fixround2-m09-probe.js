/* G1-gate 任务 3：M-09 要求的两道静态补门「先评估再决定落不落」的命中统计器（只读，不改仓库）。
 * 评估对象是 findings.md M-09 recommended_direction 第 (2) 步提的两条规则：
 *   门 A（拟进 tools/check.js）：WXML 上形如 `xxx-yyy="标识符"` 的属性，若 xxx 不在已知非事件属性白名单里、
 *        且 yyy 是已知事件名 ⇒ 报错（M-09 本体就是 animation-end="noop"：少了 bind 前缀，永不触发）。
 *   门 B（拟进 tools/check-handlers.js）：反向孤儿方法检查——Page/Component 里定义了、但同目录 WXML
 *        从未绑定引用的方法 ⇒ 报出（M-09 的 onAnimationEnd 就是这么活成死代码的）。
 * overlay 那处死代码已被 S1 批次修掉，所以这两道门现在的价值＝防复发；
 * 落门前必须先看全仓命中数：命中非零 ⇒ 不许放宽判据、不许加白名单掩盖，交协调者裁决（见 out/G1/requests.md）。
 *
 * 两条口径上的诚实处理（都会影响命中数，所以都单独打印）：
 *  · 门 A 若按字面「最后一段是已知事件名」判，animation-end 的末段是 end（不是任何合法事件名），
 *    连 M-09 本体都抓不到 ⇒ 同时给出「把连字符去掉再判」的第二种口径，并各自做历史样本自证。
 *  · 门 B 里 onLoad/onShow/attached 这类是平台回调，永远不会被模板绑定 ⇒ 字面判据会把 20 个页面的
 *    生命周期全部判红。这里把「字面命中」与「剔除平台生命周期后的命中」分开列，并再单独列出
 *    形如 onXxx 且未被绑定 的「真正可疑项」，交协调者裁决，不由本探针决定豁免名单。
 *
 * 运行：node tools/fixround2-m09-probe.js
 * 退出码：恒 0（这是评估探针不是门禁；读数请人工判读）
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')

function walk(dir, out) {
  fs.readdirSync(dir).forEach(name => {
    if (name === 'node_modules' || name === '.git' || name === 'assets') return
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  })
  return out
}
const FILES = walk(MP, [])
const WXMLS = FILES.filter(f => f.endsWith('.wxml'))
const rel = f => path.relative(ROOT, f).split(path.sep).join('/')

// ================= 门 A：形如 xxx-yyy="标识符" 的非法事件属性名 =================
const EVENT_NAMES = [
  'tap', 'longpress', 'longtap', 'forcepress', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'scroll', 'scrolltoupper', 'scrolltolower', 'scrollend', 'pullintercept',
  'blur', 'focus', 'input', 'change', 'columnchange', 'confirm', 'submit', 'reset', 'select',
  'load', 'error', 'abort', 'waiting', 'play', 'pause', 'timeupdate', 'ended', 'progress',
  'fullscreenchange', 'animationstart', 'animationiteration', 'animationend', 'transitionend',
  'click', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'keydown', 'keyup',
  'appear', 'disappear', 'linechange', 'dragstart', 'dragend', 'drop',
  'refresherpulling', 'refresherrefresh', 'refresherrestore', 'refresherabort',
  'keyboardheightchange', 'initialrendering', 'settabbaritembadge',
]
// 已知「非事件」的带连字符属性（小程序组件属性），白名单外的才算候选命中
const NON_EVENT_ATTRS = new Set([
  'placeholder-class', 'placeholder-style', 'range-key', 'hover-class', 'hover-stop-propagation',
  'auto-play', 'auto-pause', 'show-play-btn', 'show-fullscreen-btn', 'show-progress', 'enable-progress-gesture',
  'scroll-x', 'scroll-y', 'scroll-top', 'scroll-left', 'scroll-into-view', 'scroll-with-animation',
  'lower-threshold', 'upper-threshold', 'background-style', 'selected-color', 'title-color',
  'tab-index', 'tab-item-id', 'page-size', 'max-length', 'min-width', 'max-width', 'line-width',
  'confirm-type', 'confirm-hold', 'auto-height', 'cursor-spacing', 'adjust-position', 'selection-start',
  'selection-end', 'hold-keyboard', 'enable-passive', 'enable-3d', 'object-fit', 'text-width',
  'aria-role', 'aria-label', 'aria-hidden', 'label-text', 'icon-size', 'arrow-size', 'dot-size',
  'show-scrollbar', 'refresher-enabled', 'refresher-triggered', 'active-color', 'inactive-color',
  'background-color', 'border-color', 'font-size', 'text-color', 'model:value', 'start-index',
])
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
function scanGateA(text, attr, value) {
  if (/^(bind|catch)/.test(attr)) return null          // 合法绑定形式
  if (/^(data|aria)-/.test(attr)) return null           // 数据通道不是事件
  if (NON_EVENT_ATTRS.has(attr)) return null
  if (!IDENT.test(value)) return null                    // 值不是「看起来像 handler 名」的标识符
  const last = attr.split('-').pop()
  if (EVENT_NAMES.indexOf(last) !== -1) return '末段命中（字面口径：yyy ∈ 已知事件名）'
  const flat = attr.replace(/-/g, '')
  if (EVENT_NAMES.indexOf(flat) !== -1) return '去连字符后命中（kebab 口径：animation-end ⇒ animationend）'
  return null
}
const hitsA = []
const dashedAttrs = {}
WXMLS.forEach(f => {
  const text = fs.readFileSync(f, 'utf8')
  const re = /(?:^|\s)([a-z][a-z0-9]*(?:-[a-z0-9]+)+)="([^"]*)"/g
  let m
  while ((m = re.exec(text))) {
    dashedAttrs[m[1]] = (dashedAttrs[m[1]] || 0) + 1
    const why = scanGateA(text, m[1], m[2])
    if (why) hitsA.push({ file: rel(f), attr: m[1], value: m[2], why: why, line: text.slice(0, m.index).split(/\r?\n/).length })
  }
})
// 自证：门 A 能不能抓到 M-09 的历史样本（animation-end="noop"）
const histAttr = 'animation-end'
const histWhy = scanGateA('', histAttr, 'noop')
// 反向自证：合法写法不能被误报（否则门会拦正常代码）
const falseAlarm = ['bindanimationend', 'placeholder-class', 'scroll-y', 'range-key', 'hover-class', 'data-id', 'aria-label']
  .filter(a => a.indexOf('-') !== -1 && scanGateA('', a, 'noop'))

// ================= 门 B：反向孤儿方法（定义了但同目录 WXML 从未绑定）=================
// 「定义」取真 Page()/Component() 配置，不用正则猜（正则会把 if/for/图标名当成方法，命中数不可信）。
function makeWxStub() {
  const noop = () => {}
  const base = {
    cloud: { init: noop, callFunction: () => ({ then: () => Promise.resolve({ result: { ok: true, value: null } }) }) },
    getStorageSync: () => '', setStorageSync: noop, removeStorageSync: noop,
    getSystemInfoSync: () => ({ windowWidth: 390, screenWidth: 390, pixelRatio: 2, safeArea: { bottom: 340 }, statusBarHeight: 20 }),
    getWindowInfo: () => ({ windowWidth: 390, safeArea: { bottom: 340 } }),
    getSystemInfo: { getStorageSync: () => '' },
    canIUse: () => true, createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec: noop }), fields: () => ({ exec: noop }) }), in: () => ({ select: () => ({ boundingClientRect: () => ({ exec: noop }) }) }) }),
    createInnerAudioContext: () => ({ onCanplay: noop, onPlay: noop, onPause: noop, onEnded: noop, destroy: noop }),
    showToast: noop, hideToast: noop, showLoading: noop, hideLoading: noop, showModal: noop,
    setNavigationBarTitle: noop, navigateTo: noop, redirectTo: noop, navigateBack: noop, switchTab: noop,
    setClipboardData: noop, vibrateLong: noop, stopPullDownRefresh: noop, onWindowResize: noop, offWindowResize: noop,
    createAnimation: () => ({}), getUpdateManager: () => ({ onUpdateReady: noop, applyUpdate: noop }),
    createSelectorQuerySync: () => ({}), getStorage: noop, env: {},
  }
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? noop : undefined)),
  })
}
function boundNames(wxmlPath) {
  const set = new Set()
  if (!fs.existsSync(wxmlPath)) return set
  const text = fs.readFileSync(wxmlPath, 'utf8')
  const re = /(?:^|\s)((?:bind|catch)[A-Za-z0-9]*(?::[A-Za-z0-9-]+)?)="([^"]*)"/g
  let m
  while ((m = re.exec(text))) {
    const v = m[2]
    if (IDENT.test(v)) { set.add(v); continue }
    (v.match(/'([^']+)'/g) || []).forEach(q => set.add(q.replace(/'/g, '')))
  }
  // 模板里以数据形式引用的方法名（例如数组里传 handler 名）也算「被绑定引用」，避免把活代码判死
  (text.match(/\b(?:on[A-Z][A-Za-z0-9]*)\b/g) || []).forEach(n => set.add(n))
  return set
}
const LIFECYCLE = new Set([
  'onLoad', 'onShow', 'onHide', 'onUnload', 'onResize', 'onPullDownRefresh', 'onReachBottom',
  'onShareAppMessage', 'onShareTimeline', 'onAddToFavorites', 'onTabItemTap', 'onPageScroll',
  'onBackPress', 'created', 'attached', 'ready', 'moved', 'detached', 'error', 'listener',
])
const CONFIG_KEYS = new Set(['data', 'properties', 'methods', 'observers', 'lifetimes', 'options', 'pageLifetimes', 'behaviors', 'relations', 'externalClasses', 'definitionFilter', 'hostOptions'])
const rows = []
const failedRequire = []
JSLIST().forEach(f => {
  const dir = path.dirname(f)
  const base = path.basename(f, '.js')
  const wxml = path.join(dir, base + '.wxml')
  if (base === 'app') return // app() 的配置不是页面/组件模板的宿主
  if (!fs.existsSync(wxml)) return
  const bag = {}
  global.wx = makeWxStub()
  global.Page = cfg => { bag.cfg = cfg; bag.kind = 'Page' }
  global.Component = cfg => { bag.cfg = cfg; bag.kind = 'Component' }
  global.getApp = () => ({ globalData: {}, showErrorToast: false })
  global.getCurrentPages = () => []
  delete require.cache[require.resolve(f)]
  let cfg = null
  try {
    require(f)
    cfg = bag.cfg
  } catch (e) {
    failedRequire.push({ file: rel(f), error: String((e && e.message) || e).split('\n')[0] })
    return
  }
  if (!cfg) { failedRequire.push({ file: rel(f), error: '没有捕获到 Page()/Component() 配置' }); return }
  const defined = Object.keys(cfg).filter(k => !CONFIG_KEYS.has(k))
  Object.keys(cfg.methods || {}).forEach(k => defined.push(k))
  const bound = boundNames(wxml)
  const orphanAll = defined.filter(n => !bound.has(n))
  const orphanNoLifecycle = orphanAll.filter(n => !LIFECYCLE.has(n))
  const suspicious = orphanNoLifecycle.filter(n => /^on[A-Z]/.test(n))
  rows.push({ file: rel(f), defined: defined.length, orphanAll: orphanAll, orphanNoLifecycle: orphanNoLifecycle, suspicious: suspicious })
})
function JSLIST() { return FILES.filter(f => f.endsWith('.js')) }

const totalAll = rows.reduce((a, r) => a + r.orphanAll.length, 0)
const totalNoLifecycle = rows.reduce((a, r) => a + r.orphanNoLifecycle.length, 0)
const totalSuspicious = rows.reduce((a, r) => a + r.suspicious.length, 0)

console.log('=========== 门 A（非法事件属性名）全仓命中 ===========')
console.log('扫过的 wxml 文件数：' + WXMLS.length + '；带连字符的属性名种类：' + Object.keys(dashedAttrs).length)
console.log('命中（两种口径合并）：' + hitsA.length + ' 条')
hitsA.slice(0, 40).forEach(h => console.log('  ' + h.file + ':L' + h.line + '  ' + h.attr + '="' + h.value + '" ｜ ' + h.why))
console.log('历史样本自证：M-09 的 animation-end="noop" ⇒ ' + (histWhy ? '被抓到（' + histWhy + '）' : '抓不到（字面口径漏判）'))
console.log('误报自证：合法属性被误判的条数 = ' + falseAlarm.length + (falseAlarm.length ? '：' + falseAlarm.join(',') : '（无）'))
const literalOnly = hitsA.filter(h => h.why.indexOf('末段') === 0)
console.log('字面口径（只看末段 yyy）单独命中 = ' + literalOnly.length + ' 条')

console.log('\n=========== 门 B（反向孤儿方法）全仓命中 ===========')
console.log('评估到的页面/组件文件数：' + rows.length + '；require 失败（无法评估）：' + failedRequire.length)
failedRequire.forEach(x => console.log('  无法评估 ' + x.file + '：' + x.error))
console.log('字面命中（含 onLoad/onShow/attached 这类平台回调，永不被模板绑定）= ' + totalAll + ' 条')
console.log('剔除平台生命周期后命中（内部 helper 也算）= ' + totalNoLifecycle + ' 条')
console.log('其中形如 onXxx 且未被绑定（M-09 同型的「真可疑」形态）= ' + totalSuspicious + ' 条')
rows.forEach(r => {
  if (!r.orphanNoLifecycle.length) return
  console.log('  ' + r.file + '  未绑定 ' + r.orphanNoLifecycle.length + ' 个' +
    (r.suspicious.length ? '（可疑 onXxx：' + r.suspicious.join(', ') + '）' : '') +
    '：' + r.orphanNoLifecycle.join(', '))
})

console.log('\n=========== 结论用读数 ===========')
console.log('门 A：合并口径命中 ' + hitsA.length + ' 条 ⇒ ' + (hitsA.length === 0 ? '现有代码零命中，可以落门（防复发）' : '命中非零，不直接落门'))
console.log('  注意：字面口径（yyy ∈ 已知事件名）对 M-09 本体是漏判的，只有「去连字符再判」那种口径才抓得住 ⇒ 落门前要先定口径')
console.log('门 B：字面命中 ' + totalAll + ' 条 / 剔除平台生命周期仍命中 ' + totalNoLifecycle + ' 条 ⇒ 命中非零，不直接落门，交协调者裁决')
process.exit(0)
