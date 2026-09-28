// meteogram 几何与天相标记配色。
// 抽成独立模块有两个目的：
//   1. 左刻度栏宽度、行与行是否重叠、两行刻度是否抢位——这些是踩过坑的地方，
//      放在组件内部就只能靠肉眼看，抽出来测试才能直接断言；
//   2. 全屏横屏页要复用同一套几何，只需换一个预设。
// 单位一律 CSS px（canvas 已按 dpr 缩放过）。
'use strict'

/* ---------- 基础几何 ---------- */

const HOUR_W = 22 // 每小时列宽
const PAD_R = 8

// 左侧刻度栏：必须装得下**最长的那条标签** `高/中/低`（5 个 9px 汉字 ≈ 45px）+ 4px 余量。
// 原来 34px 放不下：`mm/h`（左对齐 x=2，占 2–24）与极值（右对齐到 30）重叠；
// `高/中/低` 右对齐到 30 会左溢出到 x=-15 被画布裁掉。
const PAD_L = 52

// 行布局（自上而下）。不变量：上一行 y+h ≤ 下一行 y（由 tools 测试断言）。
const ROW = {
  // 天相标记占 3 条泳道（云况 / 晨昏光 / 夜空），每条 9px + 1.5px 间隙。
  // 原来 8 个 key 挤在 20px 一行靠绘制顺序叠放，被盖掉的那个连标签一起消失——
  // 截图里"绿色星空块旁边有条没有文字的棕块"就是这么来的。
  marks: { y: 4, h: 30 },
  temp: { y: 38, h: 46 },
  rain: { y: 86, h: 30 },
  cloud: { y: 118, h: 18 },
  code: { y: 138, h: 16 },
  // 时间轴拆成上下两行：上行日期（周六 9/28），下行小时刻度（00:00/06:00…）。
  // 原来两行都写在 y+14、同一个 x 起点，日分隔格必然双重曝光。
  axis: { y: 156, h: 36 },
}
const AXIS_DAY_DY = 2   // 轴内：日期行距轴顶
const AXIS_HOUR_DY = 19 // 轴内：小时行距轴顶（与日期行至少差 10px 才不叠）

const CHART_H = 202 // ≥ ROW.axis.y + ROW.axis.h，余量留给底部留白
const MARK_LANE_H = 9      // 单条泳道高
const MARK_LANE_GAP = 1.5  // 泳道间隙
const MARK_FONT_PX = 8

/* ---------- 天相窗口配色（语义色 + 主色派生），key 与 sky.js 的 hourMarks 一致 ---------- */

const MARK_STYLE = {
  cloudSea: { color: '#346583', text: '云海' },
  star: { color: '#2D533F', text: '星空' },
  galaxy: { color: '#163E35', text: '银河' },
  rainbow: { color: '#8C5A12', text: '彩虹' },
  alpenglow: { color: '#B43D3B', text: '光染' },
  golden: { color: '#D6A33C', text: '黄金' },
  blueHour: { color: '#6C7C93', text: '蓝调' },
  inCloud: { color: '#8C9791', text: '入云' },
}

// 泳道**内**的绘制顺序（数组顺序 = 画的先后，后者压前者）：减分项（入云）放最底层
const MARK_LANES = [
  ['inCloud', 'cloudSea'],   // 云况泳道：入云 / 云海
  ['alpenglow', 'golden', 'blueHour', 'rainbow'], // 晨昏光泳道（都发生在日出日落前后）
  ['star', 'galaxy'],        // 夜空泳道（银河是星空的子集，画在上层）
]

// 图例只列徒步者真正会追的窗口（入云不单列，它在图上是"变差"信号）
const LEGEND_KEYS = ['cloudSea', 'alpenglow', 'golden', 'blueHour', 'rainbow', 'star', 'galaxy']

/* ---------- 文本宽度估算（用于断言刻度栏装得下标签） ---------- */

const GUTTER_FONT_PX = 9

// 中文按一个字宽、ASCII 按约 0.55 字宽估算（sans-serif 下的保守值）
function textWidth(text, px) {
  px = px || GUTTER_FONT_PX
  let w = 0
  for (const ch of String(text)) w += ch.charCodeAt(0) > 255 ? px : px * 0.55
  return w
}

// 色块上的文字用什么墨色。按亮度定：黄金 #D6A33C 之类的浅色用白字对比度只有 ~1.9:1，
// 图里那些浅色标记的白字一直是看不清的。
function inkOn(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.55 ? '#1B2A24' : '#FFFFFF'
}

module.exports = {
  HOUR_W, PAD_L, PAD_R, ROW, CHART_H, AXIS_DAY_DY, AXIS_HOUR_DY,
  MARK_STYLE, MARK_LANES, LEGEND_KEYS,
  MARK_LANE_H, MARK_LANE_GAP, MARK_FONT_PX,
  GUTTER_FONT_PX, textWidth, inkOn,
}
