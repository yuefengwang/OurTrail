// 品牌栏布局公式：node tools/header-layout-test.js
//
// header-layout 是纯函数（不读 wx），这三组就是真机读数的形态。
// 钉住三件容易回归的事：
//   ① 胶囊避让是实测值算出来的，不是常量；
//   ② 兜底输入不许产出 NaN / 0 高度（那会把页面内容顶进状态栏）；
//   ③ 词标可用宽度必须为正——否则「OurTrail」会被胶囊压住。
'use strict'
const path = require('path')

const ROOT = path.join(__dirname, '..')
const { layoutFor } = require(path.join(ROOT, 'miniprogram', 'utils', 'header-layout.js'))

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const DEVICES = [
  {
    name: 'iPhone SE 375×667',
    input: { statusBarHeight: 20, windowWidth: 375, menuButton: { top: 26, left: 281, width: 87, height: 32 } },
    navBar: 44, height: 64, inset: 102,
  },
  {
    name: 'iPhone 14 390×844',
    input: { statusBarHeight: 47, windowWidth: 390, menuButton: { top: 51, left: 296, width: 87, height: 32 } },
    navBar: 40, height: 87, inset: 102,
  },
  {
    name: 'iPad 768 宽',
    input: { statusBarHeight: 20, windowWidth: 768, menuButton: { top: 24, left: 648, width: 76, height: 32 } },
    navBar: 40, height: 60, inset: 128,
  },
]

section('1. 三组真机形态的实测换算')
for (const d of DEVICES) {
  const got = layoutFor(d.input)
  check(d.name + ' navBar=' + d.navBar, got.navBar === d.navBar, got)
  check(d.name + ' 总高=' + d.height, got.height === d.height, got)
  check(d.name + ' 右侧内缩=' + d.inset, got.contentRightInset === d.inset, got)
  check(d.name + ' 内缩后右边界不越过胶囊左沿 8px',
    d.input.windowWidth - got.contentRightInset === d.input.menuButton.left - 8, got)
  // 词标 20px + gap 8 + 20px 左内缩后仍至少留有 200px
  check(d.name + ' 词标可用宽度 ≥ 200px',
    d.input.windowWidth - got.contentRightInset - 20 >= 200, d.input.windowWidth - got.contentRightInset - 20)
}

section('2. 兜底与坏输入：高度不为 0、不产出 NaN')
{
  const cases = [
    ['null', null],
    ['空对象', {}],
    ['只有 width', { windowWidth: 375 }],
    ['胶囊缺 left', { statusBarHeight: 20, windowWidth: 375, menuButton: { top: 26, height: 32 } }],
    ['字符串数字（不许强转）', { statusBarHeight: '44', windowWidth: '390', menuButton: { top: '51', left: '296', height: '32' } }],
    ['胶囊高度为 0', { statusBarHeight: 20, windowWidth: 375, menuButton: { top: 26, left: 281, height: 0 } }],
  ]
  for (const [name, input] of cases) {
    const got = layoutFor(input)
    const nums = [got.statusBarHeight, got.navBar, got.height, got.contentRightInset]
    check(name + ' 四项都是有限数', nums.every(n => typeof n === 'number' && isFinite(n)), got)
    check(name + ' 总高 > 0', got.height > 0, got)
    check(name + ' 内缩非负且小于宽度', got.contentRightInset >= 0 && got.contentRightInset <= 375, got)
  }
}

section('3. 公式的单调性（胶囊更靠左 ⇒ 内缩更大；状态栏更高 ⇒ 总高更大）')
{
  const base = { statusBarHeight: 20, windowWidth: 390, menuButton: { top: 26, left: 296, height: 32 } }
  const a = layoutFor(base)
  const b = layoutFor(Object.assign({}, base, { menuButton: { top: 26, left: 286, height: 32 } }))
  check('胶囊左移 10px ⇒ 内缩 +10', b.contentRightInset - a.contentRightInset === 10, [a, b])
  // 状态栏更高的机型，胶囊 top 会跟着下移（同一组上下间隙）；只改 statusBar 不同步 top
  // 不是真机形态，会让 navBar 被夹到 0——那正是「输入自相矛盾时不许产出负高度」的兜底。
  const c = layoutFor(Object.assign({}, base, { statusBarHeight: 44, menuButton: { top: 50, left: 296, height: 32 } }))
  check('状态栏高 24px ⇒ 总高 +24（上下间隙不变时 navBar 不变）', c.height - a.height === 24 && c.navBar === a.navBar, [a, c])
  const contradictory = layoutFor(Object.assign({}, base, { statusBarHeight: 44 }))
  check('自相矛盾的输入（状态栏高于胶囊 top）⇒ navBar 夹到 0，不产出负数', contradictory.navBar === 0, contradictory)
  const d = layoutFor(Object.assign({}, base, { menuButton: { top: 26, left: 296, height: 40 } }))
  check('胶囊更高 8px ⇒ navBar +8', d.navBar - a.navBar === 8, [a, d])
}

section('4. 输入不被修改')
{
  const input = { statusBarHeight: 20, windowWidth: 375, menuButton: { top: 26, left: 281, height: 32 } }
  Object.freeze(input)
  Object.freeze(input.menuButton)
  let threw = null
  try { layoutFor(input) } catch (e) { threw = e }
  check('冻结输入下不抛错（纯函数不写回入参）', threw === null, threw && threw.message)
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
