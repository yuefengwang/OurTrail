// 封面氛围图选择：真实户外摄影（Unsplash 授权，见 assets/photos/README.md）。
// 活动模型没有图片字段（数据库结构不可擅改），所以封面是**场景氛围图而非活动实拍**——
// 页面用脚注把这件事说明白，不拿摄影素材冒充活动内容。
// 选择按活动 id 稳定散列：同一个活动每次进来是同一张（刷新不跳图），
// 不同活动尽量不同（不整站一张图）。零依赖、wx-free，可被 tools/*-test.js 直接测。
'use strict'

const COVERS = [
  '/assets/photos/cover-ridge.jpg',
  '/assets/photos/cover-valley.jpg',
  '/assets/photos/cover-falls.jpg',
  '/assets/photos/cover-fjord.jpg',
  '/assets/photos/cover-snow.jpg',
  '/assets/photos/cover-gorge.jpg',
  '/assets/photos/cover-coast.jpg',
  '/assets/photos/cover-dawn.jpg',
]

// FNV-1a：短、确定、无依赖。只为散列，不为安全。
function hash32(s) {
  let h = 0x811c9dc5
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    // 32 位乘法用 imul：JS 浮点乘法会丢高位，散列会退化成只看尾部字符
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 按种子稳定取一张封面。种子为空时给默认第一张（不返回空路径=不让页面破图）。 */
function coverFor(seed) {
  if (!seed) return COVERS[0]
  return COVERS[hash32(seed) % COVERS.length]
}

module.exports = { COVERS, hash32, coverFor }
