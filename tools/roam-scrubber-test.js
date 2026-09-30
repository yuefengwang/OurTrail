// 漫游控件回归测试：node tools/roam-scrubber-test.js
//
// 验证 components/roam-scrubber 的定时器与事件契约。
// 定时器用真实 setTimeout（tickMs 调小）而不是假时钟——本仓库零依赖，
// 假时钟要自己造一套 timer 替身，反而容易测出一个「只有替身才成立」的假象。
//
// ⚠ 这不是视觉验证：滑块的实际手感与可读性仍需真机确认。
'use strict'
const path = require('path')

const FILE = path.join(__dirname, '..', 'miniprogram', 'components', 'roam-scrubber', 'roam-scrubber.js')
const F = require('../miniprogram/utils/format')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

function cfg() {
  global.Component = c => { global.__CFG = c }
  delete require.cache[require.resolve(FILE)]
  require(FILE)
  return global.__CFG
}

function inst(props) {
  const c = cfg()
  const i = Object.assign({}, c.methods)
  i.data = Object.assign(JSON.parse(JSON.stringify(c.data || {})), {
    min: 340, max: 850, step: 5, value: 340, playing: false, disabled: false,
    minutesPerTick: 18, tickMs: 200, emptyText: '拖动或播放，走一遍这一天',
  }, props || {})
  i._events = []
  i.setData = function (p, cb) { Object.assign(this.data, p); if (cb) setImmediate(cb) }
  i.triggerEvent = function (n, d) { i._events.push({ name: n, detail: d }) }
  return i
}

const wait = ms => new Promise(r => setTimeout(r, ms))
const changes = i => i._events.filter(e => e.name === 'change').map(e => e.detail.minutes)
const toggles = i => i._events.filter(e => e.name === 'toggle').map(e => e.detail.playing)

async function main() {
  section('1. 拖动：changing 与 change 都抛 change 事件')
  {
    const i = inst()
    i.onChanging({ detail: { value: 480 } })
    i.onChange({ detail: { value: 500 } })
    check('两次拖动各抛一次 change', changes(i).length === 2, JSON.stringify(changes(i)))
    check('分钟数原样传出', changes(i)[0] === 480 && changes(i)[1] === 500)
    check('同时带格式化时刻', i._events[0].detail.t === '08:00', i._events[0].detail.t)
    check('不自行改 value（受控组件）', i.data.value === 340, String(i.data.value))
  }

  section('2. 播放开关（受控：父组件要回填 playing）')
  {
    const i = inst()
    i.onToggle()
    check('点击后抛 toggle true', toggles(i).length === 1 && toggles(i)[0] === true)
    // 模拟父组件 setData 回填 playing —— 这是受控组件的约定
    i.data.playing = true
    i.onToggle()
    check('父组件回填后再点抛 toggle false', toggles(i).length === 2 && toggles(i)[1] === false,
      JSON.stringify(toggles(i)))

    const off = inst({ disabled: true })
    off.onToggle()
    check('disabled 时不响应点击', toggles(off).length === 0)
  }

  section('3. 时钟格式化走 utils/format（不自己拼 HH:mm）')
  {
    const c = cfg()
    const i = inst({ value: 480 })
    c.observers['value, min, max'].call(i, 480, 340, 850)
    check('08:00 正确', i.data.clock === '08:00', i.data.clock)
    c.observers['value, min, max'].call(i, 850, 340, 850)
    check('上界 14:10 正确', i.data.clock === '14:10', i.data.clock)
    c.observers['value, min, max'].call(i, 99999, 340, 850)
    check('越界被夹到上界', i.data.clock === '14:10', i.data.clock)
    check('复用 format.minutesLabel', F.minutesLabel(480) === '08:00')

    const src = require('fs').readFileSync(FILE, 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check('组件里不自己拼 HH:mm', !/padStart/.test(code) && /minutesLabel/.test(code))
  }

  section('4. 播放推进：定时器自行持有位置，不依赖父组件回填 value')
  {
    // 刻意**不**回填 value：受控组件最危险的失效模式就是父组件没回喂，
    // 那样播放会永远重复同一个值、永远到不了终点、也就永远不会自停。
    const i = inst({ playing: true, minutesPerTick: 30, tickMs: 10, value: 340 })
    cfg().observers.playing.call(i, true)
    await wait(120)
    const seen = changes(i)
    check('播放期间连续抛出 change', seen.length >= 2, JSON.stringify(seen))
    check('分钟数单调递增（不回读 value 也推进）', seen.every((v, k) => k === 0 || v > seen[k - 1]),
      JSON.stringify(seen))
    check('每 tick 前进 minutesPerTick', seen.length > 1 && seen[1] - seen[0] === 30, JSON.stringify(seen))
    cfg().lifetimes.detached.call(i)
    const after = changes(i).length
    await wait(60)
    check('detached 后定时器已停', changes(i).length === after, after + ' -> ' + changes(i).length)
    check('detached 清空了 timer 句柄', i._timer == null, String(i._timer))
  }

  section('5. 播到终点：自停、不循环')
  {
    const i = inst({ playing: true, minutesPerTick: 100, tickMs: 10, value: 780, max: 850 })
    cfg().observers.playing.call(i, true)
    await wait(150)
    const evs = i._events
    const fin = evs.filter(e => e.name === 'change' && e.detail.finished)
    check('到达终点时抛 finished', fin.length === 1, JSON.stringify(evs.map(e => e.name)))
    check('finished 那一帧取上界值', fin.length === 1 && fin[0].detail.minutes === 850,
      fin.length ? String(fin[0].detail.minutes) : '-')
    check('同时把 playing 翻回 false', toggles(i).length === 1 && toggles(i)[0] === false,
      JSON.stringify(toggles(i)))
    const n = changes(i).length
    await wait(60)
    check('之后不再继续推进（不循环）', changes(i).length === n, n + ' -> ' + changes(i).length)
    check('定时器已释放', i._timer == null)
  }

  section('6. 边界')
  {
    const c = cfg()
    const i = inst({ value: NaN })
    c.observers['value, min, max'].call(i, NaN, 340, 850)
    check('value 为 NaN 时夹到下界', i.data.clock === '05:40', i.data.clock)

    const d = inst({ disabled: true, playing: true, tickMs: 10 })
    c.observers.playing.call(d, true)
    await wait(50)
    check('disabled 时不启动定时器', d._timer == null && changes(d).length === 0)
    c.lifetimes.detached.call(d)

    const b = inst({ max: 0, min: 0 })
    c.observers['value, min, max'].call(b, 0, 0, 0)
    check('max=min=0 不崩且时钟为 00:00', b.data.clock === '00:00', b.data.clock)

    const e = inst()
    c.lifetimes.detached.call(e)
    check('未播放就 detached 不抛错', true)
  }

  section('7. 组件形态符合仓库约定')
  {
    const c = cfg()
    check('options 唯一且声明 apply-shared',
      c.options && c.options.styleIsolation === 'apply-shared')
    // 具名 slot 必须声明 multipleSlots，否则宿主传入的 readout 被**静默丢弃**——
    // 数据算对了、页面就是没有。真机看图才发现得了，纯逻辑测试测不到。
    check('options 声明 multipleSlots（用具名 slot 的硬性要求）',
      !!(c.options && c.options.multipleSlots === true))
    const wxml = require('fs').readFileSync(
      path.join(__dirname, '..', 'miniprogram', 'components', 'roam-scrubber', 'roam-scrubber.wxml'), 'utf8')
    check('wxml 里确实用了具名 slot', /<slot\s+name=/.test(wxml))
    const src = require('fs').readFileSync(FILE, 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check('options 只出现一次', (code.match(/options\s*:/g) || []).length === 1,
      String((code.match(/options\s*:/g) || []).length))
    check('不认识天相（不 require sky/weather-model）',
      !/utils\/sky|weather-model|meteogram/.test(code))
    check('只 require format（时间格式化归 utils）', /utils\/format/.test(code))
    check('只格式化不解析（不引入 hourMin）', !/hourMin/.test(code))
  }

  console.log('')
  console.log('passed=' + passed + ' failed=' + failed)
  if (failed) console.log('⚠ 这仍不是视觉验证：滑块手感与可读性需真机确认。')
  process.exit(failed ? 1 : 0)
}

main()
