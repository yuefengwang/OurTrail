/* 用生产渲染器（新旧两版）在同一份真实气压层剖面上产出 SVG，供浏览器光栅化对照。
 * 注意：这不是微信渲染管线，只是「同一份代码产生的 SVG」的像素对照，真机截图另计。 */
const fs = require('fs')
const path = require('path')
const ADP = require('D:/OurTrail/miniprogram/utils/weather-cloud-field.js')
const UMG = require('D:/OurTrail/miniprogram/utils/meteogram-svg.js')
const OLD = require(process.argv[4])
const FIX = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const OUT = process.argv[3]
fs.mkdirSync(OUT, { recursive: true })

/* 把当前实现的场数学换成旧版，其他一切（行布局/配色/文字/图层）不动 */
function renderWith (impl, field, surface, elev, width, horizon, src) {
  const saved = {}
  const keys = ['makeColumnSampler', 'sampleAtStations', 'buildFieldGrid', 'isoBandsFromGrid', 'ALT0', 'ALT1', 'BINS', 'inferState', 'denseSpanAt']
  keys.forEach(k => { saved[k] = UMG_CFF[k]; if (impl[k]) UMG_CFF[k] = impl[k] })
  try {
    const geo = UMG.buildUnified({ surface, cloudField: field, userAltitude: elev, elevSource: src, width, horizon })
    return UMG.renderUnifiedBase(geo, {}).svg
  } finally { keys.forEach(k => { UMG_CFF[k] = saved[k] }) }
}
const UMG_CFF = require('D:/OurTrail/miniprogram/utils/cloud-field-svg.js')
const NEW = UMG_CFF

const rows = []
for (const k of Object.keys(FIX.places)) {
  const p = FIX.places[k]
  ;[24, 48, 72].forEach(horizon => {
    [375, 390, 414].forEach(width => {
      if (horizon === 48 && width !== 375) return
      if (horizon === 72 && width === 390) return
      const field = ADP.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: FIX.date, hours: horizon, userAltitude: p.elevation })
      if (!field) return
      const surface = (p.series || []).slice(0, horizon)
      if (surface.length < horizon) return
      const nm = p.name + '-' + horizon + 'h-' + width + 'px'
      const a = renderWith(OLD, field, surface, p.elevation, width, horizon, 'picked')
      fs.writeFileSync(path.join(OUT, 'before-' + k + '-' + horizon + 'h-' + width + '.svg'), a)
      const b = renderWith(NEW, field, surface, p.elevation, width, horizon, 'picked')
      fs.writeFileSync(path.join(OUT, 'after-' + k + '-' + horizon + 'h-' + width + '.svg'), b)
      rows.push({ k, name: p.name, horizon, width, before: 'before-' + k + '-' + horizon + 'h-' + width + '.svg', after: 'after-' + k + '-' + horizon + 'h-' + width + '.svg' })
    })
  })
}
let html = '<!doctype html><meta charset="utf-8"><style>body{background:#faf9f5;font-family:sans-serif;margin:12px}' +
  'h2{font-size:15px;margin:14px 0 4px}.pair{display:flex;gap:10px;align-items:flex-start}' +
  '.col{border:1px solid #dcdcd4;background:#fff;padding:4px}label{font-size:11px;color:#555;display:block;margin-bottom:3px}</style>'
rows.forEach(r => {
  html += '<h2>' + r.name + ' · ' + r.horizon + 'h · ' + r.width + ' CSS px（同一份真实数据、同一份渲染代码，只换场数学）</h2><div class="pair">' +
    '<div class="col" style="width:' + (r.width + 20) + 'px"><label>修复前（旧几何）</label><img src="' + r.before + '" width="' + r.width + '"></div>' +
    '<div class="col" style="width:' + (r.width + 20) + 'px"><label>修复后（新几何）</label><img src="' + r.after + '" width="' + r.width + '"></div></div>'
})
fs.writeFileSync(path.join(OUT, 'index.html'), html)
fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify({ date: FIX.date, elevations: Object.fromEntries(Object.keys(FIX.places).map(k => [k, FIX.places[k].elevation])), rows }, null, 2))
console.log('SVG 对：' + rows.length + ' 组 → ' + path.join(OUT, 'index.html'))
