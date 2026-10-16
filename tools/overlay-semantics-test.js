// S1-overlay 行为门：node tools/overlay-semantics-test.js
// 覆盖 E-01/M-10（overlay.wxss 重复声明）与 E-07/C-17（卸载死路径 + 非法事件属性）两条拆雷修复。
//
// E-07/C-17 的定稿形态 = findings M-09 修复方向的**选项 (B)**：
//   「直接删掉 onAnimationEnd 与那行无效属性，并在 overlay.wxss:L11 的注释里写明
//    『关闭态不卸载，安全性由 pointer-events + visibility 承担』，让后来者知道那两行是承重墙。」
// ⇒ 因此本门断言的是「关闭态不卸载 + 关闭态不吃点击」，并且**反向拒绝**任何 JS 侧卸载机制
//   （事件绑定 = 选项 A，本批未选；setTimeout 延时卸载 = 未经裁定的自造机制）。
//   severity 依据：M-09 裁定 P3「当前用户无感」，故本条修复的验收面不包含节点回收。
//
// 三条写法约束（都是本仓铁律，不是自创）：
// · 铁律 30：门钉行为不钉源码文本。WXSS 部分解析的是「层叠完成后的最终生效值」——
//   合法地把两条规则合并进一处，这里必须照样全绿；把冲突规则重新引入，必须红。
//   JS 部分用 global.Component 捕获真实配置 + 假定时器驱动真观察者与真 methods，
//   断言的是「这个事件序列下 rendered/setData 参数/计时器发生了什么」。
//   「不该存在的依赖」类断言（T3.13 无 transitionend/animationend 绑定）按 30② 是允许的形态。
// · 铁律 21：不数节点。dialog 内缩、sheet 贴底、关闭态不拦截点击，都由「生效值/时序」判定。
// · 铁律 11：不在测试里镜像组件逻辑——卸载与渲染走 overlay.js 自己的观察者，本套件只驱动事件。
//
// ⚠ 本套件证不了的部分（如实登记）：层叠解析器模拟的是标准 CSS「同特异度后写覆盖」规则，
//   真机 WXSS 渲染结果（sheet 是否贴底、淡出是否可见）是 RUNTIME-REQUIRED 维，见 handoff。
'use strict'
const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const OV = f => path.join(__dirname, '..', 'miniprogram', 'components', 'overlay', f)

// ---------- §1 WXSS：层叠完成后的最终生效值 ----------
// 解析器只处理本文件实际用到的形态（纯类选择器规则块，无 @media/keyframes）。
// 若将来引入媒体查询，这个解析器必须同步升级，否则它会静默漏掉规则——用有效性门兜底（见 §1 末尾）。
function parseRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(stripped))) {
    const sel = m[1].trim().replace(/\s+/g, ' ')
    m[2].split(';').forEach(d => {
      const i = d.indexOf(':')
      if (i < 0) return
      const prop = d.slice(0, i).trim()
      const val = d.slice(i + 1).trim()
      if (prop && val) rules.push({ sel, prop, val })
    })
  }
  return rules
}
// 同选择器同属性的最终值：按「后声明覆盖先声明」取最后一条（E-01 的根因就是这条规则本身）
function resolved(rules, sel, prop) {
  let winner
  rules.forEach(r => { if (r.sel === sel && r.prop === prop) winner = r.val })
  return winner
}
function declCount(rules, sel, prop) {
  return rules.filter(r => r.sel === sel && r.prop === prop).length
}
// margin 简写拆成纵/横两轴（只支持 1/2/4 值形态，本文件用到 2 值与单值）
function marginAxes(val) {
  if (!val) return null
  const p = val.trim().split(/\s+/)
  const t = { 1: v => [v, v], 2: v => [v[0], v[1]], 4: v => [v[0], v[1]] }
  const pair = (t[p.length] || (() => null))(p)
  return pair ? { v: pair[0], h: pair[1] } : null
}

section('§1 overlay.wxss 层叠终值（E-01/M-10 + 承重墙未被顺手改）')
const wxss = fs.readFileSync(OV('overlay.wxss'), 'utf8')
const rules = parseRules(wxss)

check('S1.0 解析器有效性门：解析出的规则块覆盖文件里的主要类（解析器没在空转）',
  ['.overlay-root', '.overlay', '.overlay--sheet', '.overlay--dialog', '.overlay__body']
   .every(s => rules.some(r => r.sel === s)),
  'rules=' + JSON.stringify(rules.slice(0, 3)))

// E-01 主判据：sheet 贴底的承重声明在层叠之后仍然是赢家。
// 若有人把 `.overlay-root { align-items: stretch; }` 抄回来（同特异度、更靠后），这里必须变 stretch ⇒ 红。
check('S1.1 .overlay-root 的 align-items 生效值是 flex-end（sheet 靠它贴底）',
  resolved(rules, '.overlay-root', 'align-items') === 'flex-end',
  '生效值=' + resolved(rules, '.overlay-root', 'align-items'))
check('S1.2 .overlay-root 的 align-items 只有一个声明出处（重复声明本身是 E-01 的根因形态，铁律 1 的 WXSS 版）',
  declCount(rules, '.overlay-root', 'align-items') === 1,
  '声明数=' + declCount(rules, '.overlay-root', 'align-items'))
// 承重判据（总协调裁定「必须保留 L63」）：13 个 dialog 的水平内缩来源。
// 删掉那条 ⇒ 生效 margin 退回 `auto` ⇒ 横轴不是 16px ⇒ 红；把 16px 合法合并进上方规则 ⇒ 照样绿。
const dialogMargin = marginAxes(resolved(rules, '.overlay--dialog', 'margin'))
check('S1.3 .overlay--dialog 的 margin 横轴生效值是 16px（dialog 不贴屏幕边）',
  !!dialogMargin && dialogMargin.h === '16px',
  '生效 margin=' + resolved(rules, '.overlay--dialog', 'margin'))
check('S1.4 .overlay--dialog 的 margin 纵轴生效值仍是 auto（交叉轴 auto margin 吸收剩余空间，dialog 垂直居中的另一半）',
  !!dialogMargin && dialogMargin.v === 'auto',
  '生效 margin=' + resolved(rules, '.overlay--dialog', 'margin'))
check('S1.5 .overlay--dialog 的 align-self 生效值是 center',
  resolved(rules, '.overlay--dialog', 'align-self') === 'center')
// sheet 必须没有局部 override，容器的 flex-end 才真的落到 sheet 上
check('S1.6 .overlay--sheet 不声明 align-self/margin（18 处 sheet 继承容器 align-items 的前提）',
  !rules.some(r => r.sel === '.overlay--sheet' && /^(align-self|margin)/.test(r.prop)))
// 滚动能力未被顺手破坏（M-10 副作用裁定：改 align-items 时不得动 .overlay__body 的 max-height）
check('S1.7 .overlay__body 的 max-height 生效值仍是 62vh（长内容弹层保留滚动）',
  resolved(rules, '.overlay__body', 'max-height') === '62vh',
  '生效值=' + resolved(rules, '.overlay__body', 'max-height'))
check('S1.8 .overlay 的 max-height 生效值仍是 80vh（拉伸上限没被搬走）',
  resolved(rules, '.overlay', 'max-height') === '80vh')
// platform-pitfalls §4 承重墙：关闭态不可命中 + 开启态可命中，淡出用 visibility 延迟过渡。
// 选项 B 定稿后，这两行是**唯一**防线（节点常驻不卸载），所以两条分别各钉一遍：摘任一条即红。
check('S1.9 关闭态生效值：pointer-events:none + visibility:hidden（M-09 裁定「当前用户无感」的全部依据，也是选项 B 的安全性来源）',
  resolved(rules, '.overlay-root', 'pointer-events') === 'none' &&
  resolved(rules, '.overlay-root', 'visibility') === 'hidden')
check('S1.9b 关闭态的 pointer-events:none 单独在位（只留 opacity:0 就是 platform-pitfalls §4 的透明点击吞噬层）',
  resolved(rules, '.overlay-root', 'pointer-events') === 'none',
  '生效值=' + resolved(rules, '.overlay-root', 'pointer-events'))
check('S1.9c 关闭态的 visibility:hidden 单独在位（摘掉它 ⇒ 常驻节点继续参与命中测试与可访问性树）',
  resolved(rules, '.overlay-root', 'visibility') === 'hidden',
  '生效值=' + resolved(rules, '.overlay-root', 'visibility'))
check('S1.10 关闭态的隐藏走 visibility 延迟过渡（淡出期间节点仍可见、结束后才不可见），不是瞬间 opacity 归零',
  /^visibility 0s linear var\(--motion/.test(resolved(rules, '.overlay-root', 'transition') || ''))
check('S1.11 开启态生效值：pointer-events:auto + visibility:visible',
  resolved(rules, '.overlay-root.open', 'pointer-events') === 'auto' &&
  resolved(rules, '.overlay-root.open', 'visibility') === 'visible')
check('S1.12 开启态 .overlay 的淡入终点存在（opacity:1 + translateY(0)），关闭淡出才有东西可淡',
  resolved(rules, '.overlay-root.open .overlay', 'opacity') === '1' &&
  resolved(rules, '.overlay-root.open .overlay', 'transform') === 'translateY(0)')
// 选项 B 的文书面：裁定要求在关闭态那段注释里写明「关闭态不卸载，安全性由 pointer-events + visibility 承担」。
// 这是唯一被裁定点名的文本要求（它的用途是让后来者知道那两行是承重墙），故只查语义要素，不查整句。
const guardComment = (wxss.match(/\/\*[\s\S]*?pointer-events[\s\S]*?\*\//) || [''])[0]
check('S1.13 关闭态注释写明「不卸载」+「pointer-events」+「visibility」三个要素（缺任何一项后来者就看不出那是承重墙）',
  /不卸载/.test(guardComment) && /pointer-events/.test(guardComment) && /visibility/.test(guardComment),
  '注释=' + guardComment.slice(0, 80))

// ---------- 组件装载：真 overlay.js + 假定时器 ----------
// 假定时器在这里的作用是**反证**：选项 B 不卸载 ⇒ 整条开/关生命周期里一个计时器都不该出现。
// 任何 setTimeout（被否决的「延时卸载」机制）都会让 timers.pending 非空并让相关判据变红。
const timers = { pending: new Map(), nextId: 1, cleared: [] }
const realSetTimeout = global.setTimeout
const realClearTimeout = global.clearTimeout
global.setTimeout = (fn, ms) => { const id = timers.nextId++; timers.pending.set(id, { fn, ms }); return id }
global.clearTimeout = id => { if (timers.pending.delete(id)) timers.cleared.push(id) }
function fireAll() { [...timers.pending.keys()].forEach(id => { const t = timers.pending.get(id); timers.pending.delete(id); t.fn() }) }

function loadOverlay() {
  let cfg = null
  const prev = global.Component
  global.Component = c => { cfg = c }
  delete require.cache[require.resolve(OV('overlay.js'))]
  require(OV('overlay.js'))
  global.Component = prev
  return cfg
}
function makeInstance(cfg) {
  const inst = {
    data: Object.assign({}, cfg.data),
    events: [],
    sets: [],
    setData(obj, cb) { this.sets.push(obj); Object.assign(this.data, obj); if (cb) cb() },
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }
  Object.keys(cfg.methods).forEach(k => { inst[k] = cfg.methods[k].bind(inst) })
  return inst
}
// 真平台上属性观察者运行时 data.<prop> 已是新值；夹具必须同样先落数据再调观察者，
// 否则测的是夹具自己造的时序（第十轮 B 用例的教训：页面行为不对，先怀疑夹具对齐没有）。
const openWith = (inst, cfg, v) => { inst.data.open = v; cfg.observers.open.call(inst, v) }
// 「卸载」的可执行定义：某次 setData 把 rendered 置成了假值。不依赖任何具体写法。
const unmountCalls = inst => inst.sets.filter(s => 'rendered' in s && !s.rendered)

const cfg = loadOverlay()

section('§2 装载与模板绑定完整性（E-07 的「代码在、路径死」类）')
check('S2.1 组件可装载，styleIsolation:apply-shared 仍在（options 只写一次的守护）',
  cfg && cfg.options && cfg.options.styleIsolation === 'apply-shared')
const wxml = fs.readFileSync(OV('overlay.wxml'), 'utf8')
const bound = []
const bindRe = /\b(?:bind|catch|capture-bind|capture-catch)[:a-z-]*="([^"]+)"/g
let bm
while ((bm = bindRe.exec(wxml))) bound.push(bm[1])
check('S2.2 WXML 里绑定的每个 handler 都能在组件 methods 里解析到函数（正向完整性）',
  bound.every(h => typeof cfg.methods[h] === 'function'),
  'bound=' + JSON.stringify(bound))
check('S2.3 组件 methods 里没有从未被模板绑定的孤儿方法（反向完整性——onAnimationEnd 那类死路径复发即红）',
  Object.keys(cfg.methods).every(h => bound.indexOf(h) !== -1),
  'methods=' + JSON.stringify(Object.keys(cfg.methods)) + ' bound=' + JSON.stringify(bound))
// 值指向组件方法的属性必须以 bind/catch 开头——animation-end="noop" 这种非法事件属性的通用形态门
const handlerValRe = /(?:^|\s)([a-zA-Z][-\w:]*)="([^"]+)"/g
const illegal = []
let hm
while ((hm = handlerValRe.exec(wxml))) {
  const attr = hm[1], val = hm[2]
  if (Object.prototype.hasOwnProperty.call(cfg.methods, val) && !/^(bind|catch|capture-bind|capture-catch)/.test(attr)) illegal.push(attr + '="' + val + '"')
}
check('S2.4 不存在「值指向组件方法、但属性名不是 bind/catch 事件」的伪绑定属性（E-07 原缺陷形态的通用门）',
  illegal.length === 0, illegal.join(','))

section('§3 关闭态不卸载（选项 B）：真观察者 + 假定时器驱动')
let inst = makeInstance(cfg)
openWith(inst, cfg, false)
check('S3.1 从未打开过的弹层收到 open=false：不渲染，且 JS 侧没有留下任何计时器（首屏不挂载）',
  inst.data.rendered === false && timers.pending.size === 0 && timers.cleared.length === 0,
  'pending=' + timers.pending.size + ' cleared=' + timers.cleared.length)

openWith(inst, cfg, true)
check('S3.2 open=true ⇒ rendered=true（弹层渲染）', inst.data.rendered === true)

// 裁定选项 B 的核心：关闭态**不卸载**。rendered 保持 true，节点常驻，靠 CSS 关掉。
openWith(inst, cfg, false)
check('S3.3 open=false 的同一拍 rendered 仍为 true（关闭态不卸载；在 onCloseTap/onMaskTap 里直接置 rendered=false 的直觉修法在此变红——淡出被杀）',
  inst.data.rendered === true)
check('S3.4 关闭路径不排任何计时器（setTimeout「延时卸载」是未经裁定的自造机制，出现即红）',
  timers.pending.size === 0 && timers.cleared.length === 0,
  'pending=' + timers.pending.size + ' cleared=' + timers.cleared.length)
check('S3.5 关闭态是 open=false 而 rendered=true 的分叉形态：节点在树里、由 §1.9 那两行负责它不吃点击',
  inst.data.open === false && inst.data.rendered === true)
fireAll()
check('S3.6 排空假计时器队列后 rendered 不变：关闭态不存在「稍后卸载」的在途承诺',
  inst.data.rendered === true && unmountCalls(inst).length === 0)

// 反复开关：不卸载必须是常态，不是首次特例（第一轮恰好都不卸载的巧合不能算过）。
let openTrue = 0
let renderedAfterOpen = 0
for (let round = 1; round <= 4; round++) {
  openWith(inst, cfg, true)
  openTrue++
  if (inst.data.rendered === true) renderedAfterOpen++
  openWith(inst, cfg, false)
}
check('S3.7 连续开关 4 轮后 rendered 恒为 true 且全程零计时器（不卸载是常态）',
  inst.data.rendered === true && timers.pending.size === 0 && timers.cleared.length === 0)
check('S3.8 整条生命周期没有任何一次 setData 把 rendered 置假（卸载的通用判据，与具体写法无关）',
  unmountCalls(inst).length === 0,
  '卸载调用=' + JSON.stringify(unmountCalls(inst)))
check('S3.9 每一次 open=true 之后 rendered 都是 true，且组件写入过的 data 只有 rendered:true 这一种形态',
  openTrue === 4 && renderedAfterOpen === 4 && inst.sets.every(s => Object.keys(s).join() === 'rendered' && s.rendered === true),
  'setData 序列=' + JSON.stringify(inst.sets))

// 关闭态不吃点击的「模板 → CSS」连接：常驻节点必须落到没有 .open 的那组规则上。
// 用模板自身的插值求值，不在测试里重写一遍表达式语义（铁律 11）。
const rootTag = (wxml.match(/<view[^>]*class="[^"]*overlay-root[^"]*"[^>]*>/) || [''])[0]
const rootClassTpl = (rootTag.match(/class="([^"]*)"/) || ['', ''])[1]
function classOf(open) {
  const body = rootClassTpl.replace(/\{\{([\s\S]+?)\}\}/g, (m, ex) => '${' + ex + '}')
  try { return new Function('open', 'return `' + body + '`')(open) } catch (e) { return null }
}
const tokensOf = s => (s === null ? [] : String(s).trim().split(/\s+/))
check('S3.10 夹具有效性门：模板根节点 class 可求值且含 overlay-root（下面两条不是在空转）',
  tokensOf(classOf(true)).indexOf('overlay-root') !== -1, 'class 模板=' + rootClassTpl)
check('S3.11 关闭态根节点不带 open 类 ⇒ 命中 S1.9 的 pointer-events:none + visibility:hidden（选项 B 下这就是唯一防线）',
  tokensOf(classOf(false)).indexOf('open') === -1, 'class=' + classOf(false))
check('S3.12 开启态根节点带 open 类 ⇒ 命中 S1.11 的 pointer-events:auto + visibility:visible',
  tokensOf(classOf(true)).indexOf('open') !== -1, 'class=' + classOf(true))
// 「不该存在的依赖」断言（铁律 30② 允许的形态）：合法重构不会让它假红。
const animish = wxml.match(/(?:bind|catch|capture-bind|capture-catch)[:\-]?(?:transition|animation)[a-z-]*="[^"]*"/gi) || []
check('S3.13 模板里没有 transitionend/animationend 类绑定（那是裁定的选项 A；本批选 B，要改成 A 必须重新立案而不是悄悄加一行）',
  animish.length === 0, animish.join(','))

// 关闭路径的对外契约——tap 只发 close 事件，绝不在组件里自关/动 rendered（C-12 边界钉桩）。
inst = makeInstance(cfg)
openWith(inst, cfg, true)
const beforeData = JSON.stringify(inst.data)
inst.onMaskTap()
check('S3.14 遮罩点击：恰好发一次 close 事件、组件自身 data 一字不动（不自关、不做脏检查——31 处共用关闭路径的边界）',
  inst.events.length === 1 && inst.events[0].name === 'close' && JSON.stringify(inst.data) === beforeData,
  'events=' + JSON.stringify(inst.events))
inst.onCloseTap()
check('S3.15 关闭按钮点击：同上，只发 close（把 setData({rendered:false}) 塞进 tap 的「直觉修法」在此红）',
  inst.events.length === 2 && inst.events[1].name === 'close' && inst.data.rendered === true)

global.setTimeout = realSetTimeout
global.clearTimeout = realClearTimeout

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
