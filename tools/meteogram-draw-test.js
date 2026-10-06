// meteogram · 绘制层回归测试（V2）：node tools/meteogram-draw-test.js
//
// 为什么需要这一层：V2 给 meteogram 加了云层带剖面/风行/日照轴/now/pick 五段绘制，
// 这些 canvas 代码 node --check 抓不到运行期问题（未定义变量/NaN 坐标/错色），
// 而微信开发者工具当时的构建环境因 IDE 侧回归无法启动模拟器（app.json 误报，
// 干净 master 同错，与本次改动无关——证据见 docs/weather-ux/production-gap-analysis.md §6），
// 先以记录式 2D 上下文把绘制层钉住；真机像素验证待 IDE 修复后补跑。
//
// 手法沿用 tools/space-time-draw-test.js：global.Component 捕获真实配置 +
// global.wx 桩 + 记录式 2D 上下文，**执行真实的 draw()** 并对命令流断言。
// ⚠ 这不是视觉验证：它证明「画布代码跑得通、图元合法、V2 图层按预期着色」，
//   不证明「看起来对」。
'use strict'
const path = require('path')

const METEOGRAM = path.join(__dirname, '..', 'miniprogram', 'components', 'meteogram', 'meteogram.js')
const LAY = require('../miniprogram/components/meteogram/layout')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const DATE = '2026-10-06'

/* ---------- 记录式 2D 上下文（同 space-time-draw-test） ---------- */

const NUMERIC_METHODS = [
  'clearRect', 'fillRect', 'strokeRect', 'moveTo', 'lineTo', 'arc',
  'quadraticCurveTo', 'bezierCurveTo', 'fillText', 'strokeText', 'rect',
  'translate', 'scale', 'setTransform', 'rotate',
]
const VOID_METHODS = ['beginPath', 'closePath', 'fill', 'stroke', 'save', 'restore', 'setLineDash', 'arcTo']

function makeCtx(log) {
  const ctx = {
    canvas: null,
    strokeStyle: '', fillStyle: '', lineWidth: 1, font: '',
    textAlign: '', textBaseline: '', globalAlpha: 1,
  }
  const record = name => function () {
    log.calls.push({ name, args: Array.prototype.slice.call(arguments), fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle })
  }
  NUMERIC_METHODS.forEach(name => { ctx[name] = record(name) })
  VOID_METHODS.forEach(name => { ctx[name] = record(name) })
  ctx.measureText = t => ({ width: String(t).length * 6 })
  return ctx
}

function componentConfig(file) {
  global.Component = cfg => { global.__CFG = cfg }
  delete require.cache[require.resolve(file)]
  require(file)
  return global.__CFG
}

function makeInstance(cfg, overrides) {
  const inst = Object.assign({}, cfg.methods, cfg)
  // 框架语义：properties 的 value 会并入 this.data——harness 必须复刻，否则
  // night/sunBands 这类未显式传入的属性在 draw 里是 undefined（真机不会如此）。
  const propDefaults = {}
  Object.keys(cfg.properties || {}).forEach(k => { propDefaults[k] = cfg.properties[k].value })
  inst.data = Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), propDefaults, overrides || {})
  // 同步回调：scheduleDraw 首帧 chartW 变化时 setData(cb) → initCanvas 必须先于断言完成。
  // 真机的异步补测由 scheduleSync(100/320ms) 负责，detached 已清定时器。
  inst.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb() }
  inst.triggerEvent = function (name, detail) { inst._events.push({ name, detail }) }
  inst._events = []
  return inst
}

// wx 桩：同步回调已排版节点（exec(cb) 直接收回调并调用）
function bootWx(log, width, height, dpr) {
  const ctx = makeCtx(log)
  const node = { width: 0, height: 0, getContext: () => ctx }
  global.wx = {
    getSystemInfoSync: () => ({ pixelRatio: dpr || 2 }),
    createSelectorQuery: () => ({
      in: () => ({
        select: () => ({
          fields: () => ({ exec: cb => { cb([{ node, width, height }]) } }),
        }),
      }),
    }),
  }
  return { ctx, node }
}

function run(overrides, opts) {
  const log = { calls: [] }
  opts = opts || {}
  const boot = bootWx(log, opts.width || 336, opts.height || LAY.CHART_H, opts.dpr || 2)
  const cfg = componentConfig(METEOGRAM)
  const inst = makeInstance(cfg, Object.assign({ series: makeSeries(), hourWidth: 11.5 }, overrides))
  cfg.lifetimes.ready.call(inst)
  if (cfg.lifetimes.detached) cfg.lifetimes.detached.call(inst)
  return { log, inst, cfg }
}

/* ---------- 固定数据：一天 24h，清晨云带 + 阵雨 + 夜晴 ---------- */

function makeSeries() {
  const out = []
  for (let h = 0; h < 24; h++) {
    out.push({
      d: DATE, t: (h < 10 ? '0' : '') + h + ':00',
      temp: 12 + Math.round(5 * Math.sin((h - 6) / 24 * 2 * Math.PI)),
      precip: h === 15 ? 0.8 : 0, showers: h === 15 ? 1.2 : 0, pop: h === 15 ? 65 : 10,
      code: h === 15 ? 80 : 2, wind: 12, windDir: 150, rh: 60,
      cloud: { low: h <= 9 ? 85 : 30, mid: 20, high: h <= 9 ? 12 : 35 },
      band: h >= 1 && h <= 9 ? { base: 2280, top: 2950, cover: 88 } : null,
    })
  }
  return out
}

const MARKS = {}
MARKS[DATE + 'T07:00'] = ['cloudSea', 'golden']
MARKS[DATE + 'T08:00'] = ['cloudSea']
MARKS[DATE + 'T15:00'] = ['inCloud']
const SUN_BANDS = {}
for (let h = 0; h < 24; h++) {
  const t = (h < 10 ? '0' : '') + h + ':00'
  if (h <= 5 || h >= 21) SUN_BANDS[DATE + 'T' + t] = 'night'
  else if (h === 6) SUN_BANDS[DATE + 'T' + t] = 'blue'
  else if (h === 7) SUN_BANDS[DATE + 'T' + t] = 'golden'
  else if (h === 18) SUN_BANDS[DATE + 'T' + t] = 'golden'
  else if (h === 19) SUN_BANDS[DATE + 'T' + t] = 'blue'
  else if (h === 20) SUN_BANDS[DATE + 'T' + t] = 'astro'
}

/* ---------- 检查工具 ---------- */

const numericArgsAreSane = log => log.calls
  .flatMap(c => c.args.filter(a => typeof a === 'number' && !isFinite(a)).map(a => c.name))

function fillRects(log) { return log.calls.filter(c => c.name === 'fillRect') }

/* ========== 1. 全量 V2 入参：真实 draw() 跑通 ========== */

section('1. V2 全量入参：draw() 跑通且图元合法')
{
  const r = run({
    marks: MARKS, night: {}, selectedDates: { [DATE]: true },
    elevation: 3500, sunBands: SUN_BANDS,
    sunLines: { [DATE]: { rise: '07:09', set: '19:11' } },
    now: { date: DATE, t: '06:30' },
    pick: { date: DATE, t: '07:00' },
  })
  check('画出了东西（调用数 > 150）', r.log.calls.length > 150, String(r.log.calls.length))
  const bad = numericArgsAreSane(r.log)
  check('无 NaN / Infinity 坐标进入 ctx', bad.length === 0, bad.slice(0, 3).join(' | '))
  check('画布按 dpr 缩放', r.inst.canvas && r.inst.cssW === 336, String(r.inst.cssW))
}

/* ========== 2. 云层带剖面：带矩形 / 海拔虚线 / 状态底 ========== */

section('2. 云层带剖面（bandProfile 行）')
{
  const r = run({
    marks: MARKS, elevation: 3500,
    sunBands: SUN_BANDS, sunLines: {}, now: null, pick: null,
  })
  const row = LAY.ROW.bandProfile
  const rects = fillRects(r.log)
  // 带矩形：fillStyle = --info（#346583），y 在剖面行内，10 个带小时（01–09）
  const bandRects = rects.filter(c => c.fillStyle === '#346583' && c.args[1] >= row.y && c.args[1] < row.y + row.h)
  check('云带矩形画在剖面行内且用 --info 色（01–09 共 9 小时）', bandRects.length === 9, String(bandRects.length))
  const yTop = LAY.bandAltY(2950, row), yBase = LAY.bandAltY(2280, row)
  const someBand = bandRects.find(c => c.args[3] > 2)
  check('带矩形高度 = base→top 映射（top 在上、base 在下）',
    !!someBand && someBand.args[1] >= yTop - 1 && someBand.args[1] + someBand.args[3] <= yBase + 1,
    someBand ? JSON.stringify(someBand.args) : 'none')
  // 海拔虚线：strokeStyle = forest，行内 y=bandAltY(3500)
  const dashes = r.log.calls.filter(c => c.name === 'setLineDash' && JSON.stringify(c.args[0] || []) === JSON.stringify([3, 2]))
  check('海拔虚线用 [3,2] dash', dashes.length >= 1, String(dashes.length))
  const dashStrokes = r.log.calls.filter(c => c.name === 'stroke' && c.strokeStyle === '#163E35')
  check('海拔虚线用 forest 墨色描边', dashStrokes.length >= 1, String(dashStrokes.length))
  const lineY = LAY.bandAltY(3500, row)
  const dashLine = r.log.calls.filter(c => c.name === 'moveTo' && Math.abs(c.args[1] - Math.round(lineY)) <= 1 && c.args[0] === LAY.PAD_L)
  check('虚线起点在左刻度栏右缘、y=bandAltY(3500)', dashLine.length >= 1, JSON.stringify(dashLine.slice(0, 1)))
  // 状态底：云海 success 淡底（07/08 时），入云 warning 淡底（15 时）
  const seaTints = rects.filter(c => c.fillStyle === 'rgba(39,97,69,0.12)' && c.args[1] === row.y)
  const inCloudTints = rects.filter(c => c.fillStyle === 'rgba(140,90,18,0.14)' && c.args[1] === row.y)
  check('云海状态底 2 小时（07/08）', seaTints.length === 2, String(seaTints.length))
  check('入云状态底 1 小时（15）', inCloudTints.length === 1, String(inCloudTints.length))
  // 左栏标签「带」
  const dai = r.log.calls.filter(c => c.name === 'fillText' && c.args[0] === '带')
  check('左栏画了「带」标签', dai.length >= 1)
}

/* ========== 3. 风行：箭头 + 数值；windDir 缺失降级 ========== */

section('3. 风行（wind 行）与 windDir 降级')
{
  const r = run({ series: makeSeries().map(h => Object.assign({}, h, { windDir: 150 })) })
  const row = LAY.ROW.wind
  const rotates = r.log.calls.filter(c => c.name === 'rotate')
  check('windDir 存在时画风向箭头（rotate 8 次）', rotates.length === 8, String(rotates.length))
  const winds = r.log.calls.filter(c => c.name === 'fillText' && c.args[0] === '12')
  check('风速数字每 3h 一标（8 个）', winds.length >= 8, String(winds.length))
  const feng = r.log.calls.filter(c => c.name === 'fillText' && c.args[0] === '风')
  check('左栏画了「风」标签', feng.length >= 1)

  // 降级：windDir 缺失 → 无 rotate，数字照画
  const r2 = run({ series: makeSeries().map(h => { const c2 = Object.assign({}, h); delete c2.windDir; return c2 }) })
  check('windDir 缺失：无箭头（0 次 rotate）', r2.log.calls.filter(c => c.name === 'rotate').length === 0)
  check('windDir 缺失：风速数字照画', r2.log.calls.filter(c => c.name === 'fillText' && c.args[0] === '12').length >= 8)
}

/* ========== 4. 日照轴带 / 日出日落线 / now / pick ========== */

section('4. 日照轴带、日出日落线、now 线、pick 高亮')
{
  const r = run({
    marks: {}, sunBands: SUN_BANDS,
    sunLines: { [DATE]: { rise: '07:09', set: '19:11' } },
    now: { date: DATE, t: '06:30' },
    pick: { date: DATE, t: '07:00' },
  })
  const axis = LAY.ROW.axis
  const stripY = axis.y + axis.h - LAY.AXIS_SUN_BAND_H - 1
  const golden = fillRects(r.log).filter(c => c.fillStyle === '#D6A33C' && c.args[1] === stripY)
  const night = fillRects(r.log).filter(c => c.fillStyle === '#F0F1EC' && c.args[1] === stripY)
  check('轴带画在轴行底部（黄金段 2 小时）', golden.length === 2, String(golden.length))
  check('轴带夜段在轴行底部（0–5 时 6 + 21–23 时 3 = 9）', night.length === 9, String(night.length))
  // 日出日落虚线：golden 色 stroke，setLineDash([2,2])
  const sunDash = r.log.calls.filter(c => c.name === 'setLineDash' && JSON.stringify(c.args[0] || []) === JSON.stringify([2, 2]))
  check('日出日落虚线用 [2,2] dash', sunDash.length >= 1, String(sunDash.length))
  const goldenStrokes = r.log.calls.filter(c => c.name === 'stroke' && c.strokeStyle === '#D6A33C')
  check('日出日落线用 golden 色描边（2 条）', goldenStrokes.length === 2, String(goldenStrokes.length))
  // now 线：forest 实线（非 dash 段）+ 顶部圆点
  const arcs = r.log.calls.filter(c => c.name === 'arc')
  check('「现在」线带顶部圆点（arc）', arcs.length >= 1, String(arcs.length))
  // pick 高亮：整列淡墨矩形（0..axis.y 全高）
  const pickRects = fillRects(r.log).filter(c => c.fillStyle === 'rgba(32,42,38,0.08)' && c.args[3] === LAY.ROW.axis.y)
  check('pick 高亮列整列淡墨', pickRects.length >= 1, String(pickRects.length))

  // 全空入参：轴带/虚线/now/pick 全部不画（旧行为兼容）
  const r2 = run({})
  const strip = fillRects(r2.log).filter(c => c.args[1] === stripY && c.args[3] === LAY.AXIS_SUN_BAND_H)
  check('无 sunBands：不画轴带', strip.length === 0, String(strip.length))
  check('无 sunLines/now/pick：无 [2,2] dash、无 arc', r2.log.calls.filter(c => c.name === 'arc').length === 0)
}

/* ========== 5. 温度极值与降水概率底带 ========== */

section('5. 温度极值标注与 pop≥50 底带')
{
  const r = run({})
  const maxLabel = r.log.calls.filter(c => c.name === 'fillText' && /°$/.test(String(c.args[0])) && c.fillStyle === '#202A26')
  check('温度最高值用 ink 加粗标注', maxLabel.length >= 1, JSON.stringify(maxLabel.slice(0, 1)))
  const popBands = fillRects(r.log).filter(c => c.fillStyle === '#346583' && c.args[1] === LAY.ROW.rain.y - 2)
  check('pop≥50 底带只画 15 时那一列', popBands.length === 1, String(popBands.length))
  // 窄列（全览 hw<8）不写极值——防叠
  const r2 = run({ hourWidth: 4, series: makeSeries() }, { width: 52 + 24 * 4 + 8 })
  check('窄列模式不画极值标注', !r2.log.calls.some(c => c.name === 'fillText' && /°$/.test(String(c.args[0])) && c.fillStyle === '#202A26'))
}

/* ========== 6. 布局不变量（新行后全列断言） ========== */

section('6. 布局：V2 全部行互不重叠，画布覆盖最后一行')
{
  const order = ['marks', 'temp', 'rain', 'cloud', 'bandProfile', 'wind', 'code', 'axis']
  let overlap = ''
  for (let i = 0; i < order.length - 1; i++) {
    const a = LAY.ROW[order[i]], b = LAY.ROW[order[i + 1]]
    if (a.y + a.h > b.y) overlap = order[i] + ' > ' + order[i + 1]
  }
  check('八行互不重叠', !overlap, overlap)
  check('CHART_H 覆盖轴行', LAY.CHART_H >= LAY.ROW.axis.y + LAY.ROW.axis.h)
  check('sun 轴带在轴行内', LAY.AXIS_SUN_BAND_H < LAY.ROW.axis.h)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
