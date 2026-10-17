/* WXML 非法事件属性名规则（M-09 要求的 check.js 补门，实现成可独立执行的模块）。
 *
 * 为什么单独成文件：tools/check.js 是协调者独占的常驻预提交门，本轮不允许由我执行。
 * 判据搬到这里之后，`node tools/fixround2-event-attr-rule.js` 就能把**同一份出厂代码**在全仓跑一遍
 * 并自证（历史样本必须被抓到、合法写法必须不误报），而不必去跑 check.js 本体。
 *
 * 缺陷本体（M-09）：overlay.wxml 写了 `animation-end="noop"`——WXML 的事件绑定只有
 * bind/catch（及 capture- 变体）与冒号形式，`animation-end` 不是合法事件属性，只会当成一个普通
 * 自定义属性挂在节点上，永不触发任何回调；于是 onAnimationEnd 成为「代码在、路径死」的死方法。
 * 口径要点：`animation-end` 的末段是 `end`，而 `end` 不是任何合法事件名（合法的是 animationend /
 * transitionend / ended）——所以**只看末段的字面口径抓不到 M-09 本体**，必须再把连字符去掉判一次
 * （kebab 写法 animation-end ⇒ animationend）。两种口径都在这里实现，并由自证门钉住「历史样本必须被抓到」。
 *
 * 运行：node tools/fixround2-event-attr-rule.js   （全仓扫描 + 有效性自证）
 * 退出码：0 = 全仓零命中且自证通过；1 = 有命中；2 = 自证未过（规则本身失效）
 */
'use strict'
const fs = require('fs')
const path = require('path')

// 合法事件名（bind/catch 后面允许出现的那批，含组件自定义事件）
const EVENT_NAMES = new Set([
  'tap', 'longpress', 'longtap', 'forcepress', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'scroll', 'scrolltoupper', 'scrolltolower', 'scrollend', 'scrolltolower', 'pullintercept',
  'blur', 'focus', 'input', 'change', 'columnchange', 'confirm', 'submit', 'reset', 'select',
  'load', 'error', 'abort', 'waiting', 'play', 'pause', 'timeupdate', 'ended', 'progress',
  'fullscreenchange', 'animationstart', 'animationiteration', 'animationend', 'transitionend',
  'click', 'mousedown', 'mouseup', 'mouseover', 'mouseout', 'keydown', 'keyup',
  'appear', 'disappear', 'linechange', 'dragstart', 'dragend', 'drop',
  'refresherpulling', 'refresherrefresh', 'refresherrestore', 'refresherabort',
  'keyboardheightchange', 'initialrendering',
])
// 已知「非事件」的带连字符属性（小程序组件属性）：白名单外的带连字符属性才进入判定。
// 这张表只用于排除组件属性，不用于豁免「看起来像事件却少了 bind/catch」的形状——
// 新增条目必须能说出它是哪个组件的合法属性，否则就是给这条门打洞。
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
  'background-color', 'border-color', 'font-size', 'text-color', 'start-index', 'end-index',
])
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const ATTR_RE = /(?:^|\s)([a-zA-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)+)\s*=\s*"([^"]*)"/g

// 单条属性判定：返回命中的口径名，不命中返回 null
function classify(attr, value) {
  if (/^(bind|catch|capture-)/.test(attr)) return null // 合法绑定形式（含 capture- 变体）
  if (/^(data|aria|model|wx|prop)-|:/.test(attr)) return null // 数据通道 / 双向绑定 / 指令不是事件
  if (NON_EVENT_ATTRS.has(attr)) return null
  if (!IDENT.test(value)) return null // 值不是「看起来像 handler 名」的标识符（数字/布尔/插值都放行）
  const last = attr.split('-').pop()
  if (EVENT_NAMES.has(last)) return '末段是已知事件名（字面口径）'
  const flat = attr.replace(/-/g, '')
  if (EVENT_NAMES.has(flat)) return '去连字符后是已知事件名（kebab 写法：' + attr + ' ⇒ ' + flat + '）'
  return null
}

// 扫一段 WXML：返回 [{line, attr, value, why}]
function scan(source, file) {
  const hits = []
  const clean = String(source).replace(/<!--[\s\S]*?-->/g, '') // 注释里的示例不算
  let m
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(clean)) !== null) {
    const attrs = m[2] || ''
    if (attrs.indexOf('-') === -1) continue
    let a
    ATTR_RE.lastIndex = 0
    while ((a = ATTR_RE.exec(attrs)) !== null) {
      const why = classify(a[1], a[2])
      if (!why) continue
      const before = clean.slice(0, m.index + a.index).split(/\r?\n/)
      hits.push({ file: file, line: before.length, attr: a[1], value: a[2], why: why })
    }
  }
  return hits
}
module.exports = { scan, classify, EVENT_NAMES, NON_EVENT_ATTRS }

// ================= 独立执行：全仓扫描 + 有效性自证 =================
if (require.main === module) {
  const ROOT = path.resolve(__dirname, '..', 'miniprogram')
  function walk(dir, out) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      if (fs.statSync(p).isDirectory()) walk(p, out)
      else out.push(p)
    }
    return out
  }
  let files
  try {
    files = walk(ROOT, []).filter(f => f.endsWith('.wxml'))
  } catch (e) {
    console.error('无法遍历 miniprogram：' + e.message)
    process.exit(2)
  }
  const all = []
  files.forEach(f => {
    try {
      scan(fs.readFileSync(f, 'utf8'), path.relative(path.resolve(__dirname, '..'), f).split(path.sep).join('/'))
        .forEach(h => all.push(h))
    } catch (e) {
      console.error('  ✗ 读取 ' + f + ' 失败：' + e.message + '（规则不得静默跳过文件）')
      process.exit(2)
    }
  })
  console.log('== 门 A（WXML 非法事件属性名）全仓扫描 ==')
  console.log('wxml 文件 ' + files.length + ' 个；命中 ' + all.length + ' 条')
  all.forEach(h => console.log('  ✗ ' + h.file + ':L' + h.line + '  ' + h.attr + '="' + h.value + '" ⇒ ' + h.why))

  // 有效性自证 1：M-09 的历史样本必须被抓到（否则这条门是装饰，防不了复发）
  const hist = scan('<view class="overlay" catchtap="noop" animation-end="noop">x</view>', '<历史样本 overlay.wxml:L3>')
  const histCaught = hist.length === 1 && hist[0].attr === 'animation-end'
  console.log('自证 A1 历史样本 animation-end="noop" 被抓到：' + (histCaught ? 'PASS' : 'FAIL（规则失效）') + (hist.length ? ' → ' + hist[0].why : ''))
  // 有效性自证 2：合法写法不得误报（否则门会拦正常代码，久了被当噪音忽略——铁律 30）
  const legal = [
    '<view bindtap="onTap">x</view>',
    '<view bind:animationend="onAnimationEnd">x</view>',
    '<view catchtouchmove="noop">x</view>',
    '<view capture-bind:touchstart="onStart">x</view>',
    '<picker range-key="label" mode="date">x</picker>',
    '<input placeholder-class="ph" confirm-type="done" bindinput="onField" />',
    '<scroll-view scroll-y show-scrollbar="{{false}}" hover-class="hv">x</scroll-view>',
    '<view data-id="{{item.id}}" aria-label="名单">x</view>',
    '<video auto-play="{{autoplay}}" src="{{url}}"></video>',
  ].map(s => s + ' ⇒ ' + (scan(s, '<合法样本>').length === 0 ? '不误报 PASS' : '误报 FAIL：' + JSON.stringify(scan(s, '<合法样本>'))))
  legal.forEach(l => console.log('  自证 A2 ' + l))
  const legalAllPass = legal.every(l => l.indexOf('误报 FAIL') === -1)
  const dataChannels = scan('<view data-key="title" aria-role="button">x</view>', '<数据通道样本>').length === 0
  console.log('  自证 A3 data-* / aria-* 通道不误报：' + (dataChannels ? 'PASS' : 'FAIL'))

  if (!histCaught || !legalAllPass || !dataChannels) {
    console.error('规则自证未过 ⇒ 这条门没有资格进门禁')
    process.exit(2)
  }
  console.log('\n规则自证通过（历史样本抓到、合法写法不误报）；全仓命中 ' + all.length + ' 条')
  process.exit(all.length ? 1 : 0)
}
