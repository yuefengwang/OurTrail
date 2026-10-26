'use strict'

// 装备名 → 图标 key。只分类，不改写原文；规则按顺序命中，未识别落背包。
// 顺序有意义：头灯含「电」必须排在电源之前；「水」只认整词，避免把水果认成饮水。
const RULES = [
  ['poles', /登山杖|手杖|杖|\btrekking\b|\bpoles?\b/],
  ['boot', /徒步鞋|登山鞋|鞋|\bboots?\b|\bshoes?\b/],
  ['rain', /雨衣|雨披|雨伞|雨|\brain\b|\braincoat\b|\bponcho\b/],
  ['headlamp', /头灯|\bheadlamp\b|\bhead torch\b/],
  ['firstaid', /急救|药品|药|医疗|\bfirst aid\b|\bmedkit\b/],
  ['tent', /帐篷|帐|\btents?\b/],
  ['sleep', /睡袋|睡垫|防潮垫|地垫|\bsleep|\bquilt\b|\bpad\b/],
  ['power', /电池|充电宝|充电|电源|\bbattery\b|\bbatteries\b|\bcharger\b|\bpower\b/],
  ['food', /食物|路餐|干粮|零食|餐|\bfood\b|\bsnacks?\b/],
  ['water', /饮用水|水壶|水袋|饮水|补水|\bwater\b|\bbottle\b|\bhydration\b/],
  ['route', /地图|轨迹|导航|指南针|\bgpx\b|\bmaps?\b|\bcompass\b/],
  ['id', /身份证|证件|护照|\bid card\b/],
  ['sun', /防晒|遮阳|帽|墨镜|\bsun\b|\bhat\b|\bsunglass/],
]

function iconFor(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!v) return 'backpack'
  if (v === '水') return 'water'
  for (let i = 0; i < RULES.length; i++) {
    if (RULES[i][1].test(v)) return RULES[i][0]
  }
  return 'backpack'
}

module.exports = { iconFor }
