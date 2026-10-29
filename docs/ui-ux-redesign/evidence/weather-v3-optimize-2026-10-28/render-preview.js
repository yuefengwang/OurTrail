// 生成 preview-dry-vs-wet.png 的复现脚本：直接 require 生产 buildHourlySvg，
// 渲 A（24h 全干 ⇒ 一句窗口级事实）与 B（15–18h 有雨 ⇒ 回到逐格标注）两份 SVG。
//
// 跑：node "docs/ui-ux-redesign/evidence/weather-v3-optimize-2026-10-28/render-preview.js"
//     → 写同目录 index.html 并在 127.0.0.1:8791 起 http（浏览器打开后看图；Ctrl+C 结束）
// 截图不是用 canvas 或手抄坐标，两份图都是生产构建器的原样输出，容器宽度带 = 350（与真机 390 时的图宽同档）。
'use strict'
const fs = require('fs')
const path = require('path')
const H = require(path.join(__dirname, '..', '..', '..', '..', 'miniprogram', 'utils', 'weather-v3-hourly-svg.js'))

function row(i, patch) {
  const base = {
    d: '2026-10-29', t: (i % 24 < 10 ? '0' : '') + (i % 24) + ':00', hour: i % 24,
    temp: [2, 1, 0, -1, -2, -2, -1, 2, 5, 8, 10, 12, 12, 11, 9, 7, 5, 3, 1, 0, -1, -1, 0, 1][i],
    feels: [0, -1, -2, -3, -4, -4, -3, 0, 3, 6, 8, 10, 10, 9, 7, 5, 3, 1, -1, -2, -3, -3, -2, -1][i],
    precip: 0, pop: 0,
    wind: [5, 5, 4, 4, 4, 4, 4, 5, 6, 7, 8, 9, 10, 11, 11, 10, 9, 8, 7, 6, 5, 5, 4, 4][i],
    gust: [19, 18, 15, 16, 14, 13, 13, 15, 22, 26, 33, 41, 35, 31, 28, 24, 21, 18, 17, 16, 15, 14, 13, 12][i],
    windDir: 180 + (i % 6) * 15,
    cloud: {
      high: [0, 0, 0, 0, 0, 0, 0, 0, 10, 4, 2, 4, 11, 0, 2, 38, 45, 30, 20, 10, 5, 0, 0, 0][i],
      mid: 0,
      low: [21, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0][i],
    },
  }
  return Object.assign(base, patch || {})
}

const dry = []
for (let i = 0; i < 24; i++) dry.push(row(i))
const wet = dry.map((r, i) => Object.assign({}, r, {
  precip: i >= 15 && i <= 17 ? 1.4 - Math.abs(16 - i) * 0.6 : 0,
  pop: i >= 14 && i <= 18 ? 55 : 0,
}))

const W = 350
const a = H.buildHourlySvg({ series: dry, cursor: 13, period: 24, width: W })
const b = H.buildHourlySvg({ series: wet, cursor: 13, period: 24, width: W })

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:12px;background:#fff;font-family:system-ui,sans-serif}
h1{font:600 12px/1.4 system-ui;color:#333;margin:10px 0 4px}
.box{width:${W}px;border:1px solid #e8ece7}
</style>
<h1>A 全窗口 0（24h 干窗）</h1><div class="box">${a.svg}</div>
<h1>B 有降水与概率（回到逐格标注）</h1><div class="box">${b.svg}</div>`
fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf8')

require('http').createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}).listen(8791, '127.0.0.1', () => console.log('listening 127.0.0.1:8791'))
