// 装备图标分类：node tools/equipment-icons-test.js
//
// 图标只是分类线索，不是事实来源：分类错了最多让人多看一眼文字，
// 但两类错误会误导判断，所以单独钉住——
//   ① 把「水果」认成饮水、把「防晒帽」认成背包这类误报/漏报；
//   ② 规则顺序错导致「头灯电池」被电源抢走。
// 另外钉住「图标 key 与 icon 组件 PATHS 一一对应」：少一个 key 会静默回退成活动图标。
'use strict'
const path = require('path')

const ROOT = path.join(__dirname, '..')
const P = (...p) => path.join(ROOT, 'miniprogram', ...p)
const { iconFor } = require(P('utils/equipment-icons.js'))

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

// icon 组件在 require 时调用全局 Component；stub 掉只取 PATHS。
function loadPaths() {
  const file = P('components/icon/icon.js')
  delete require.cache[require.resolve(file)]
  const prev = global.Component
  global.Component = () => {}
  try { return require(file).PATHS } finally { global.Component = prev }
}

const PATHS = loadPaths()

section('1. 每条规则的代表词都归到预期图标')
{
  const samples = {
    poles: ['登山杖', '手杖', 'trekking poles'],
    boot: ['徒步鞋', '登山鞋', 'Hiking Boots'],
    rain: ['雨衣', '雨披', '雨伞'],
    headlamp: ['头灯'],
    firstaid: ['急救包', '药品', 'first aid kit'],
    tent: ['帐篷'],
    sleep: ['睡袋', '睡垫', '防潮垫'],
    power: ['充电宝', '电池'],
    food: ['路餐', '干粮', '零食'],
    water: ['水壶', '水袋', '饮用水 2L', '水'],
    route: ['地图', '轨迹', '指南针', 'GPX 文件'],
    id: ['身份证', '证件'],
    sun: ['防晒霜', '遮阳帽', '墨镜'],
  }
  Object.keys(samples).forEach(key => {
    const wrong = samples[key].filter(text => iconFor(text) !== key)
    check('「' + samples[key][0] + '」等 ' + samples[key].length + ' 个词 → ' + key,
      wrong.length === 0, wrong.map(w => w + '→' + iconFor(w)))
  })
}

section('2. 规则顺序：专有词不被泛词抢走')
{
  check('头灯电池 → headlamp（头灯排在电源之前）', iconFor('头灯电池') === 'headlamp', iconFor('头灯电池'))
  check('急救药品 → firstaid（急救排在药品前，且药品本身也是 firstaid）',
    iconFor('急救药品') === 'firstaid', iconFor('急救药品'))
  check('雨衣 → rain（先于「衣」类泛词）', iconFor('雨衣') === 'rain', iconFor('雨衣'))
  check('登山杖 → poles（不因含「登山」被鞋类规则抢走）', iconFor('登山杖') === 'poles', iconFor('登山杖'))
}

section('3. 不误报：没有装备规则的水果/日用品落背包')
{
  const fallbacks = ['水果', '水果刀', '备用袜', '防风外套', '护膝', '垃圾袋']
  const wrong = fallbacks.filter(text => iconFor(text) !== 'backpack')
  check('水果/水果刀/备用袜/防风外套/护膝/垃圾袋 → backpack（没有就老实回退）',
    wrong.length === 0, wrong.map(w => w + '→' + iconFor(w)))
  check('「水」是整词特例：归 water，而「水果」不受影响',
    iconFor('水') === 'water' && iconFor('水果') === 'backpack',
    { exact: iconFor('水'), fruit: iconFor('水果') })
}

section('4. 输入规范化与失败回退')
{
  check('首尾空白被忽略', iconFor('  头灯  ') === 'headlamp', iconFor('  头灯  '))
  check('英文大小写不敏感', iconFor('WATER BOTTLE') === 'water' && iconFor('Tent') === 'tent',
    { w: iconFor('WATER BOTTLE'), t: iconFor('Tent') })
  const bad = [null, undefined, '', '   ', 12, {}, []]
  check('空/非字符串一律回退 backpack，不抛错',
    bad.every(v => iconFor(v) === 'backpack'), bad.map(v => String(v) + '→' + iconFor(v)))
}

section('5. 图标 key 与 icon 组件 PATHS 一一对应')
{
  const used = ['boot', 'poles', 'rain', 'water', 'headlamp', 'firstaid',
    'food', 'tent', 'sleep', 'power', 'id', 'backpack', 'route', 'sun']
  const missing = used.filter(key => typeof PATHS[key] !== 'string' || !PATHS[key].trim())
  check('装备用到的 14 个 key 都有 PATHS 定义', missing.length === 0, missing)
  const malformed = used.filter(key => typeof PATHS[key] === 'string' && PATHS[key].trim()
    && (!/^[Mm]/.test(PATHS[key]) || !/[LlHhVvCcSsQqTtAaZz]/.test(PATHS[key])))
  check('每条 path 以 M/m 起笔且含至少一个绘制命令', malformed.length === 0,
    malformed.map(k => k + ':' + PATHS[k]))
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
