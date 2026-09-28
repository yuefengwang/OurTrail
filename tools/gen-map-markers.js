// 生成地图 marker PNG（活动详情页路线地图）。运行：node tools/gen-map-markers.js
// 纯 node 实现（zlib 手写 PNG 编码），零依赖。微信 map 的 marker.iconPath 不支持 base64，
// 只能本地文件，故由脚本生成入库；显示尺寸由 marker.width/height 控制，选中态直接放大，
// 无需单独的选中图。颜色取自 app.wxss token（见 ourtrail-ui design-system）。
'use strict'
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const SIZE = 96            // 画布边距，显示时缩到 20-28px，保证高分屏清晰
const CENTER = SIZE / 2
const OUTER_R = 40         // 外圈半径（含描边）
const RING_W = 9           // 描边宽

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- 画圆（抗锯齿：对边缘做 1px 平滑）----
function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function drawMarker(fillHex, ringHex) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4)
  const fill = hexRgb(fillHex)
  const ring = hexRgb(ringHex)
  const fillR = OUTER_R - RING_W
  // 平滑带宽度（像素）：抗锯齿过渡区
  const AA = 1
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.sqrt((x + 0.5 - CENTER) ** 2 + (y + 0.5 - CENTER) ** 2)
      // 外圈（ring 色）与内圆（fill 色）各自的覆盖度
      const ringAlpha = Math.min(1, Math.max(0, OUTER_R - d + AA / 2) / AA)
      const fillAlpha = Math.min(1, Math.max(0, fillR - d + AA / 2) / AA)
      // 合成：先 ring 底，再 fill 覆盖
      const r = Math.round(fill[0] * fillAlpha + ring[0] * (1 - fillAlpha))
      const g = Math.round(fill[1] * fillAlpha + ring[1] * (1 - fillAlpha))
      const b = Math.round(fill[2] * fillAlpha + ring[2] * (1 - fillAlpha))
      const a = Math.round(255 * ringAlpha)
      const i = (y * SIZE + x) * 4
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a
    }
  }
  return encodePng(SIZE, SIZE, rgba)
}

// ---- 输出 ----
const outDir = path.join(__dirname, '..', 'miniprogram', 'assets', 'markers')
fs.mkdirSync(outDir, { recursive: true })

// token：--forest #163E35 · --leaf #D6EA8A · --info #346583（design-system.md）
const MARKERS = {
  'start.png':      ['#163E35', '#FFFFFF'], // 起点：forest 实心 + 白描边
  'checkpoint.png': ['#FFFFFF', '#163E35'], // 途中：白底 + forest 描边
  'finish.png':     ['#D6EA8A', '#163E35'], // 终点：leaf + forest 描边（品牌高亮收尾）
  'pickup.png':     ['#346583', '#FFFFFF'], // 上车点：info 蓝 + 白描边
}

for (const [name, [fill, ring]] of Object.entries(MARKERS)) {
  const png = drawMarker(fill, ring)
  fs.writeFileSync(path.join(outDir, name), png)
  console.log('  ✓ ' + name + ' (' + png.length + ' bytes)')
}
console.log('done → ' + path.relative(process.cwd(), outDir))
