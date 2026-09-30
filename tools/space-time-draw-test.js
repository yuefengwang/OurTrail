// 时空天相图 · 绘制层回归测试：node tools/space-time-draw-test.js
//
// 为什么需要这一层：tools/check.js 只做 node --check，抓不到 draw() 方法里的
// 未定义变量、NaN 坐标、错色值——而这些恰恰是 canvas 最常见的翻车点
// （反模式 4/6：node --check 通过说明不了任何运行期问题）。
//
// 手法沿用 tools/scenario-editor-test.js：global.Component 捕获真实配置 +
// global.wx 桩 + 记录式 2D 上下文。本文件**执行真实的 draw()**，
// 并对命令流做断言。
//
// ⚠ 这不是视觉验证。它证明「画布代码跑得通、发出的图元合法」，
// 不证明「看起来对」——像素级效果仍需微信开发者工具真机确认。
'use strict'
const path = require('path')

const SPACE_TIME = path.join(__dirname, '..', 'miniprogram', 'components', 'space-time', 'space-time.js')
const L = require('../miniprogram/components/space-time/layout')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const LAT = 30.67
const LNG = 104.07
const DATE = '2026-07-28'

/* ---------- 记录式 2D 上下文 ---------- */

const NUMERIC_METHODS = [
  'clearRect', 'fillRect', 'strokeRect', 'moveTo', 'lineTo', 'arc',
  'quadraticCurveTo', 'bezierCurveTo', 'fillText', 'strokeText', 'rect',
  'translate', 'scale', 'setTransform', 'rotate',
]

function makeCtx(log) {
  const ctx = {
    canvas: null,
    strokeStyle: '', fillStyle: '', lineWidth: 1, font: '',
    textAlign: '', textBaseline: '', globalAlpha: 1,
  }
  NUMERIC_METHODS.forEach(name => {
    ctx[name] = function () {
      const args = Array.prototype.slice.call(arguments)
      log.calls.push({ name, args })
    }
  })
  ;['beginPath', 'closePath', 'fill', 'stroke', 'save', 'restore', 'setLineDash'].forEach(name => {
    ctx[name] = function () {
      log.calls.push({ name, args: Array.prototype.slice.call(arguments) })
    }
  })
  ctx.measureText = t => ({ width: String(t).length * 6 })
  ctx.createLinearGradient = function (x1, y1, x2, y2) {
    log.gradients.push({ x1, y1, x2, y2, stops: [] })
    const g = log.gradients[log.gradients.length - 1]
    return {
      addColorStop: (off, color) => { g.stops.push({ off, color }) },
    }
  }
  return ctx
}

/* ---------- 组件装配 ---------- */

function componentConfig(file) {
  global.Component = cfg => { global.__CFG = cfg }
  delete require.cache[require.resolve(file)]
  require(file)
  return global.__CFG
}

function makeInstance(cfg, overrides) {
  const inst = Object.assign({}, cfg.methods)
  inst.data = Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), overrides || {})
  inst._patches = []
  inst.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  inst.triggerEvent = function (name, detail) {
    inst._events.push({ name, detail })
  }
  inst._events = []
  return inst
}

// wx 桩：把 createSelectorQuery 做成同步回调，模拟已排版完成的节点。
// 注意 exec 是**接收回调并调用它**（`exec(cb)` → `cb([...])`），
// 不是接收结果数组——写错的话组件的回调永远不会被调用，draw 静默不执行。
function bootWx(log, width, height, dpr) {
  const ctx = makeCtx(log)
  const node = {
    width: 0, height: 0,
    getContext: () => ctx,
  }
  global.wx = {
    getSystemInfoSync: () => ({ pixelRatio: dpr || 2 }),
    createSelectorQuery: () => ({
      in: () => ({
        select: () => ({
          fields: () => ({
            exec: cb => { cb([{ node, width, height }]) },
          }),
        }),
      }),
    }),
  }
  return { ctx, node }
}

/* ---------- 固定数据 ---------- */

function makeSeries() {
  const out = []
  for (let h = 0; h < 24; h++) {
    out.push({
      d: DATE, t: (h < 10 ? '0' : '') + h + ':00',
      temp: 14, precip: 0, showers: 0, pop: 0, code: 2, wind: 12, rh: 60,
      cloud: { low: 60, mid: 20, high: 10 },
      band: h >= 7 && h <= 10 ? { base: 2400, top: 3100, cover: 88 } : null,
    })
  }
  return out
}

function makeNodes() {
  return [
    { t: '05:40', d: DATE, alt: 2860, name: '山脚' },
    { t: '07:10', d: DATE, alt: 3040, name: '岔口' },
    { t: '08:00', d: DATE, alt: 3300, name: '云带脚' },
    { t: '09:30', d: DATE, alt: 3500, name: '半程' },
    { t: '11:15', d: DATE, alt: 3640, name: '脊线' },
    { t: '12:30', d: DATE, alt: 3760, name: '裸岩' },
    { t: '14:10', d: DATE, alt: 3900, name: '观景位' },
  ]
}

const OVERRIDES = {
  series: makeSeries(),
  days: [],
  nodes: makeNodes(),
  lat: LAT,
  lng: LNG,
  obsAlt: 3900,
  arriveT: '14:10',
  stayEndH: '',
}

/* ---------- 检查工具 ---------- */

const COLOR_RE = /^(#[0-9A-F]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\))$/

function numericArgsAreSane(log) {
  const bad = []
  log.calls.forEach(c => {
    c.args.forEach(a => {
      if (typeof a === 'number' && !isFinite(a)) bad.push(c.name + '(' + c.args.join(',') + ')')
    })
  })
  return bad
}

function colorsUsed(log) {
  const set = {}
  log.calls.forEach(() => {})
  return set
}

function run(overrides, opts) {
  const log = { calls: [], gradients: [] }
  opts = opts || {}
  const boot = bootWx(log, opts.width || 340, opts.height || 260, opts.dpr || 2)
  const cfg = componentConfig(SPACE_TIME)
  const inst = makeInstance(cfg, overrides)
  cfg.lifetimes.ready.call(inst)
  if (cfg.lifetimes.detached) cfg.lifetimes.detached.call(inst)
  return { log, inst, ctx: boot.ctx, node: boot.node, cfg }
}

section('1. 真实 draw() 跑通，且不抛错')
{
  const r = run(OVERRIDES)
  check('画出了东西（调用数 > 50）', r.log.calls.length > 50, String(r.log.calls.length))
  const bad = numericArgsAreSane(r.log)
  check('无 NaN / Infinity 坐标进入 ctx', bad.length === 0, bad.slice(0, 3).join(' | '))
  check('非空态（empty=false）', r.inst.data.empty === false)
  check('已建立 canvas 上下文与尺寸', !!r.inst.ctx && r.inst.cssW === 340, String(r.inst.cssW))
}

section('1b. scheduleSync 的补测定时器在数据缺失时不抛错')
{
  // 定时器回调曾直接读 this.data.nodes.length，页面先卸载就会抛
  // "reading length of undefined"。这里让它真的跑一次。
  const log = { calls: [], gradients: [] }
  bootWx(log, 340, 260, 2)
  const cfg = componentConfig(SPACE_TIME)
  const inst = makeInstance(cfg, { series: [], days: [], nodes: undefined, lat: LAT, lng: LNG })
  let threw = null
  try {
    cfg.lifetimes.ready.call(inst)
  } catch (e) { threw = e }
  check('nodes 为 undefined 时 ready 不抛错', threw === null, threw && String(threw))
  cfg.lifetimes.detached.call(inst)
  check('detached 已清理补测定时器', inst._sync1 == null && inst._sync2 == null)
}

section('2. 图层顺序：网格 → 云带 → 地形 → 轨迹 → 节点 → 标注 → 播放头')
{
  const r = run(OVERRIDES)
  const seq = r.log.calls.map(c => c.name)
  const firstOf = n => seq.indexOf(n)
  // 云的 fillRect 必须在地形 closePath+fill 之前
  const firstFillRect = firstOf('fillRect')
  const firstFill = firstOf('fill')
  check('云带（fillRect）先于地形填充（fill）', firstFillRect >= 0 && firstFillRect < firstFill,
    firstFillRect + ' vs ' + firstFill)
  check('有 createLinearGradient（渐变轨迹段）', r.log.gradients.length > 0, String(r.log.gradients.length))
  check('渐变都带两个色标', r.log.gradients.every(g => g.stops.length === 2))
  check('画了弧形节点（arc）', seq.includes('arc'))
  check('画了文字（fillText）', seq.includes('fillText'))
  check('用了 save/restore 保护状态', seq.includes('save') && seq.includes('restore'))
  check('用了 setLineDash（参考线/抵达线）', seq.includes('setLineDash'))
}

section('3. 画布按 dpr 缩放，图层才会对齐')
{
  const r = run(OVERRIDES, { dpr: 3 })
  check('node.width = cssW × dpr', r.node.width === Math.round(340 * 3), String(r.node.width))
  check('node.height = cssH × dpr', r.node.height === Math.round(260 * 3), String(r.node.height))
  const t = r.log.calls.filter(c => c.name === 'setTransform')
  check('调用了 setTransform(dpr,0,0,dpr,0,0)', t.length > 0 && t[0].args.join(',') === '3,0,0,3,0,0',
    t.length ? t[0].args.join(',') : 'none')
}

section('4. 所有颜色都是合法色值（canvas 拿不到 var()，写错不会报错只会画错）')
{
  const r = run(OVERRIDES)
  const styles = new Set()
  r.log.calls.forEach(() => {})
  // 逐帧扫描：每次绘制前读 ctx 的 strokeStyle/fillStyle
  const seen = []
  const origPush = r.log.calls.push.bind(r.log.calls)
  r.log.calls.push = function (c) { origPush(c); seen.push({ stroke: r.ctx.strokeStyle, fill: r.ctx.fillStyle }) }
  r.inst.draw(r.inst.compute())
  r.log.calls.push = origPush

  const vals = new Set()
  seen.forEach(s => { if (s.stroke) vals.add(s.stroke); if (s.fill) vals.add(s.fill) })
  // strokeStyle/fillStyle 允许是 CanvasGradient 对象（drawRoute 的渐变段就是），
  // 所以只校验字符串形态的那些
  const strVals = Array.from(vals).filter(v => typeof v === 'string')
  const bad = strVals.filter(v => !COLOR_RE.test(String(v).trim()))
  check('描边/填充色全部合法', bad.length === 0, bad.slice(0, 3).join(' | '))
  check('存在渐变对象作为 strokeStyle（合法）',
    Array.from(vals).some(v => v && typeof v === 'object'), Array.from(vals).map(v => typeof v).join(','))
  check('用到了天相主色 #346583', vals.has('#346583') || Array.from(vals).some(v => /52,\s*101,\s*131/.test(String(v))),
    Array.from(vals).slice(0, 6).join(' '))
  const stops = r.log.gradients.reduce((a, g) => a.concat(g.stops.map(s => s.color)), [])
  check('渐变色标全部合法', stops.every(c => COLOR_RE.test(String(c).trim())),
    stops.filter(c => !COLOR_RE.test(String(c).trim())).slice(0, 3).join(' '))
}

section('5. 天相色取自 MARK_STYLE（不在 WXML/JS 里另写一套）')
{
  const src = require('fs').readFileSync(SPACE_TIME, 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  // 允许 layout.js 的 MARK_STYLE 引用与 meteogram 同源，禁止硬编码天相色值
  const hard = ['#346583', '#2D533F', '#D6A33C', '#6C7C93', '#8C5A12', '#B43D3B', '#8C9791']
    .filter(c => code.indexOf(c) !== -1)
  check('组件里不硬编码天相色值', hard.length === 0, hard.join(','))
  check('颜色一律经 L.MARK_STYLE / L.colorOf 取', /L\.MARK_STYLE|L\.colorOf|L\.NO_COLOR/.test(code))
}

section('6. 空数据不崩，且不画东西')
{
  const log = { calls: [], gradients: [] }
  bootWx(log, 340, 260, 2)
  const cfg = componentConfig(SPACE_TIME)
  const inst = makeInstance(cfg, {
    series: [], days: [], nodes: [], lat: LAT, lng: LNG, obsAlt: null, arriveT: '', stayEndH: '',
  })
  let threw = null
  try { cfg.lifetimes.ready.call(inst) } catch (e) { threw = e }
  check('无节点时不抛错', threw === null, threw && String(threw))
  check('标记为空态', inst.data.empty === true)
  // 空态仍会 clearRect + setTransform（要擦掉上一帧），但不应画出任何图元
  const painted = log.calls.filter(c => ['fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'arc', 'moveTo', 'lineTo'].indexOf(c.name) !== -1)
  check('未绘制任何图元（只清屏）', painted.length === 0, painted.map(c => c.name).join(','))
  cfg.lifetimes.detached.call(inst)
}

section('7. 缺经纬度时降级为空态（不按 0,0 算天文）')
{
  const log = { calls: [], gradients: [] }
  bootWx(log, 340, 260, 2)
  const cfg = componentConfig(SPACE_TIME)
  const inst = makeInstance(cfg, Object.assign({}, OVERRIDES, { lat: NaN, lng: NaN }))
  let threw = null
  try { cfg.lifetimes.ready.call(inst) } catch (e) { threw = e }
  check('经纬度缺失时不抛错', threw === null, threw && String(threw))
  check('降级为空态', inst.data.empty === true)
  cfg.lifetimes.detached.call(inst)
}

section('8. 播放头由 scrub 驱动，且读数随之更新')
{
  const r = run(Object.assign({}, OVERRIDES, { scrub: 8 * 60 }))
  check('读数已生成', !!r.inst.data.readout, JSON.stringify(r.inst.data.readout))
  check('读数时刻为 08:00', r.inst.data.readout.t === '08:00', r.inst.data.readout && r.inst.data.readout.t)
  check('读数带节点进度', r.inst.data.readout.nodeCount === 7, r.inst.data.readout && String(r.inst.data.readout.nodeCount))
  check('量程已同步给滑块', r.inst.data.roamMin === 5 * 60 + 40 && r.inst.data.roamMax === 14 * 60 + 10,
    r.inst.data.roamMin + '-' + r.inst.data.roamMax)
  check('首屏播放头在起点而非抵达点（决策 D5）',
    run(OVERRIDES).inst.data.roamValue === 5 * 60 + 40, String(run(OVERRIDES).inst.data.roamValue))
}

section('9. 拖动事件更新播放头并向外抛 scrub')
{
  const r = run(OVERRIDES)
  r.inst.onRoamChange({ detail: { minutes: 9 * 60 + 30, t: '09:30' } })
  check('roamValue 已更新', r.inst.data.roamValue === 9 * 60 + 30, String(r.inst.data.roamValue))
  const ev = r.inst._events.filter(e => e.name === 'scrub')
  check('抛出 scrub 事件', ev.length === 1 && ev[0].detail.minutes === 9 * 60 + 30)
  r.inst.onRoamToggle({ detail: { playing: true } })
  check('playing 已开启', r.inst.data.playing === true)
  check('抛出 playstate 事件', r.inst._events.some(e => e.name === 'playstate' && e.detail.playing === true))
  r.inst.onRoamChange({ detail: { minutes: NaN } })
  check('非法 minutes 被忽略', r.inst.data.roamValue === 9 * 60 + 30, String(r.inst.data.roamValue))
}

section('10. 留宿：开关打开后时间轴延到 23:00')
{
  // 只给 stayEndH 不再足以触发延伸——留宿是**产品决策**，必须由开关明确打开。
  // （否则宿主误传 stayEndH 就会把时间轴悄悄拉到 23:00。）
  const off = run(Object.assign({}, OVERRIDES, { stayEndH: '23:00' }))
  check('未开留宿时即使给了 stayEndH 也不延伸', off.inst.data.roamMax === 14 * 60 + 10,
    String(off.inst.data.roamMax))

  const on = run(Object.assign({}, OVERRIDES, { stayEndH: '23:00', overnight: true }))
  check('开留宿后量程末端到 23:00', on.inst.data.roamMax === 23 * 60, String(on.inst.data.roamMax))
  check('几何末端也是 23:00', on.inst.compute().scale.tMax === 23 * 60,
    String(on.inst.compute().scale.tMax))

  // 没给 stayEndH 时用 overnightEndH 兜底
  const fb = run(Object.assign({}, OVERRIDES, { overnight: true, overnightEndH: '22:30' }))
  check('缺 stayEndH 时用 overnightEndH 兜底', fb.inst.data.roamMax === 22 * 60 + 30,
    String(fb.inst.data.roamMax))
}

section('11. 留宿开关与夜间天象卡')
{
  const r = run(OVERRIDES)
  check('默认不留宿', r.inst.data.overnight === false)
  check('默认无天象卡', r.inst.data.astro === null)

  r.inst.onToggleOvernight()
  check('点击后进入留宿态', r.inst.data.overnight === true)
  const ev = r.inst._events.filter(e => e.name === 'overnight')
  check('抛出 overnight 事件', ev.length === 1 && ev[0].detail.overnight === true)
  check('事件带留宿结束时刻', ev[0] && ev[0].detail.until === '23:00', ev[0] && ev[0].detail.until)

  // 触发一次绘制让天象算出来
  r.inst.scheduleDraw()
  const astro = r.inst.data.astro
  check('天象已计算', !!astro, astro === null ? 'null' : typeof astro)
  if (astro) {
    check('天象带日落时刻', !!(astro.sun && astro.sun.sunset))
    check('天象卡不超过 2 张', astro.cards.length <= 2, String(astro.cards.length))
    check('晚霞卡标题为「晚霞」', astro.cards[0] && astro.cards[0].title === '晚霞',
      astro.cards[0] && astro.cards[0].title)
    check('卡片带 sky.js 的分级标签', astro.cards.every(c => !!c.label && !!c.tone))
    check('卡片文案用概率语气（有「可能」或「概率」）',
      astro.cards.some(c => /可能|概率|条件/.test(c.text)))
  }

  r.inst.onToggleOvernight()
  check('再点回到不留宿', r.inst.data.overnight === false)
  check('关闭后天象卡清空', r.inst.data.astro === null)
  // roamMax 是 syncRoam 里更新的，要等一次绘制（真机上由 observer 自动触发）
  r.inst.scheduleDraw()
  check('量程收回抵达时刻', r.inst.data.roamMax === 14 * 60 + 10, String(r.inst.data.roamMax))
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
if (failed) console.log('⚠ 这仍不是视觉验证：像素效果需微信开发者工具真机确认。')
process.exit(failed ? 1 : 0)
