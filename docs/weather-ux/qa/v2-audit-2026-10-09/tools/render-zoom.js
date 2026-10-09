/* 阶段 B §4.5 视觉验收：把生产渲染器产出的新旧 SVG 只裁出云场行，放大 2 倍并排，
 * 供浏览器光栅化成 PNG 做「局部放大」前后对照（同一份真实数据、同一份渲染代码，只换场数学）。 */
const fs = require('fs')
const path = require('path')
const ADP = require('D:/OurTrail/miniprogram/utils/weather-cloud-field.js')
const UMG = require('D:/OurTrail/miniprogram/utils/meteogram-svg.js')
const OLD = require('C:/Users/thinkbook/AppData/Local/Temp/ot-cf/cloud-field-svg.BEFORE.js')
const NEWC = require('D:/OurTrail/miniprogram/utils/cloud-field-svg.js')
const FIX = JSON.parse(fs.readFileSync('C:/Users/thinkbook/AppData/Local/Temp/ot-cf/real-cloud.json', 'utf8'))
const OUT = 'C:/Users/thinkbook/AppData/Local/Temp/ot-cf/svg'

const ROWS = UMG.ROWS
const CLOUD_TOP = ROWS.cloud.y - 8
const CLOUD_H = ROWS.cloud.h + 16

function render (impl, field, surface, elev, width, horizon) {
  const CFF = NEWC
  const saved = {}
  const keys = ['makeColumnSampler', 'sampleAtStations', 'buildFieldGrid', 'isoBandsFromGrid', 'ALT0', 'ALT1', 'BINS', 'inferState', 'denseSpanAt']
  keys.forEach(k => { saved[k] = CFF[k]; if (impl[k]) CFF[k] = impl[k] })
  try {
    const geo = UMG.buildUnified({ surface, cloudField: field, userAltitude: elev, elevSource: 'picked', width, horizon })
    return UMG.renderUnifiedBase(geo, {}).svg
  } finally { keys.forEach(k => { CFF[k] = saved[k] }) }
}
function dataUri (svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) }

const rows = []
for (const k of Object.keys(FIX.places)) {
  const p = FIX.places[k]
  ;[24, 72].forEach(horizon => {
    [375, 390, 414].forEach(width => {
      const field = ADP.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: FIX.date, hours: horizon, userAltitude: p.elevation })
      const surface = (p.series || []).slice(0, horizon)
      if (!field || surface.length < horizon) return
      const before = render(OLD, field, surface, p.elevation, width, horizon)
      const after = render(NEWC, field, surface, p.elevation, width, horizon)
      rows.push({ k, name: p.name, horizon, width, before, after })
    })
  })
}
let html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:sans-serif}' +
  '.pair{display:flex;gap:8px;margin:6px 0;align-items:flex-start}h1{font:600 13px sans-serif;margin:10px 4px 2px}' +
  '.col{position:relative;overflow:hidden;border:1px solid #cfd3cc;background:#fff}' +
  '.col img{position:absolute;left:0}' +
  '.tag{position:absolute;right:2px;top:2px;z-index:3;font:600 9px sans-serif;color:#fff;background:rgba(22,62,53,.78);padding:1px 4px;border-radius:3px}' +
  '.lbl{font:600 10px sans-serif;color:#444;margin:2px 4px}</style>'
rows.forEach(function (r, i) {
  const scale = 2
  const cw = r.width * scale, ch = CLOUD_H * scale
  html += '<h1 id="r' + i + '">' + r.name + ' · ' + r.horizon + 'h · ' + r.width + ' CSS px · 云场行放大 ' + scale + '×（' +
    (i === 0 ? '索引：' + rows.map(x => x.name + x.horizon + '/' + x.width).join('，') : '') + ')</h1>'
  html += '<div class="pair">'
  ;[['修复前', 'before', r.before], ['修复后', 'after', r.after]].forEach(function (v) {
    html += '<div class="lbl">' + v[0] + '</div><div class="col" style="width:' + cw + 'px;height:' + ch + 'px">' +
      '<span class="tag">' + r.name + ' ' + r.horizon + 'h ' + r.width + 'px ' + v[0] + '</span>' +
      '<img src="' + dataUri(v[2]) + '" style="width:' + cw + 'px;top:' + (-CLOUD_TOP * scale) + 'px">' +
      '</div>'
  })
  html += '</div>'
})
fs.writeFileSync(path.join(OUT, 'zoom.html'), html)
fs.writeFileSync(path.join(OUT, 'zoom-meta.json'), JSON.stringify({
  date: FIX.date, capturedFrom: 'lib/weather.js 真实气压层剖面', elevations: Object.fromEntries(Object.keys(FIX.places).map(k => [k, FIX.places[k].elevation])),
  rows: rows.map(r => ({ name: r.name, horizon: r.horizon, width: r.width })),
  cloudRow: { top: CLOUD_TOP, height: CLOUD_H },
}, null, 2))
console.log('zoom.html：' + rows.length + ' 组（云场行 2× 放大，before/after 并排）')
