/* 显示窗行为速查（开发期用，不进门禁）：打印若干数据集在 planProfile 下的窗
   node docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/dump-window.js */
'use strict'
const UMG = require('../../../../../miniprogram/utils/meteogram-svg.js')
const CFF = require('../../../../../miniprogram/utils/cloud-field-svg.js')

function altGrid () { const a = []; for (let x = 0; x <= 7000; x += 250) a.push(x); return a }
function surface (n) { const o = []; for (let h = 0; h < n; h++) o.push({ t: String(h % 24).padStart(2, '0'), d: '2026-10-09', temp: 10, precip: 0, showers: 0, wind: 5, gust: 10, windDir: 90, code: 1, cloud: { low: 10, mid: 10, high: 10 } }); return o }
function driftingField (hours) {
  const altitudes = altGrid()
  const values = []
  for (let h = 0; h < hours; h++) {
    const center = 2600 + Math.floor(h / 24) * 1000 + Math.sin(h / 6) * 200
    values.push(altitudes.map(alt => { const d = Math.abs(alt - center); return d > 500 ? 4 : Math.round(92 * (1 - d / 500) + 4) }))
  }
  return { times: Array.from({ length: hours }, (_, i) => i), altitudes: altitudes, values: values, covered: { lo: 2000, hi: 6000 } }
}
;[[24, 500], [24, 3500], [24, 6200], [48, 3500], [72, 3500], [72, 500]].forEach(([horizon, alt]) => {
  const cf = driftingField(horizon)
  const geo = UMG.buildUnified({ surface: surface(horizon), cloudField: cf, userAltitude: alt, width: 375, horizon: horizon })
  const p = geo.profile
  console.log('horizon=' + horizon + ' alt=' + alt + ' → 窗 ' + p.lo + '–' + p.hi + '（跨度 ' + (p.hi - p.lo) + '）' +
    ' fallback=' + p.fallback + ' 上裁=' + p.clippedAbove + ' 下裁=' + p.clippedBelow +
    ' 点在窗外=' + p.pointOutside + ' 锚点=' + p.anchorCount + ' 环=' + geo.stats.pathCount +
    ' yAlt(alt)=' + (p.lo <= alt && alt <= p.hi ? geo.cloud.yAlt(alt).toFixed(1) : '—'))
})
console.log('\nPLAN 直接调用（极端与退化输入）')
const col = CFF.makeColumnSampler(driftingField(24))
const s = (t, a) => CFF.sampleAtStations(col, 24, t, a)
;[
  ['正常', { sample: s, covered: { lo: 2000, hi: 6000 }, hours: 24, queryAlt: 3500, basis: 'measured' }],
  ['covered=null', { sample: s, covered: null, hours: 24, queryAlt: 3500, basis: 'measured' }],
  ['NaN hours', { sample: s, covered: { lo: 2000, hi: 6000 }, hours: NaN, queryAlt: 3500, basis: 'measured' }],
  ['NaN alt', { sample: s, covered: { lo: 2000, hi: 6000 }, hours: 24, queryAlt: NaN, basis: 'measured' }],
  ['Infinity alt', { sample: s, covered: { lo: 2000, hi: 6000 }, hours: 24, queryAlt: Infinity, basis: 'measured' }],
  ['空数组 covered', { sample: s, covered: { lo: [], hi: [] }, hours: 24, queryAlt: 3500, basis: 'measured' }],
  ['lo>hi', { sample: s, covered: { lo: 6000, hi: 2000 }, hours: 24, queryAlt: 3500, basis: 'measured' }],
  ['窗在 0 以下', { sample: s, covered: { lo: 0, hi: 7000 }, hours: 72, queryAlt: 0, basis: 'measured' }],
].forEach(([nm, o]) => {
  const p = CFF.planProfile(o)
  console.log(nm.padEnd(18) + ' → 窗 ' + p.lo + '–' + p.hi + ' fallback=' + p.fallback + ' 裁上=' + p.clippedAbove + ' 裁下=' + p.clippedBelow)
})

console.log('\n云行图形语言（渲染器实际吐出的字符串）')
;[[24, 500], [24, 3500], [24, 6200], [72, 500]].forEach(([horizon, alt]) => {
  const cf = driftingField(horizon)
  const geo = UMG.buildUnified({ surface: surface(horizon), cloudField: cf, userAltitude: alt, width: 375, horizon: horizon })
  const svg = UMG.renderUnifiedBase(geo, {}).svg
  const texts = (svg.match(/<text[^>]*>([^<]{2,40})<\/text>/g) || []).map(t => t.replace(/<[^>]*>/g, ''))
  console.log('horizon=' + horizon + ' alt=' + alt + ' 窗=' + geo.profile.lo + '–' + geo.profile.hi +
    ' 虚线=' + (svg.indexOf('stroke-dasharray="4 3"') >= 0) + ' 琥珀=' + (svg.match(/stroke-width="2.5" stroke-linecap="round"/g) || []).length +
    ' clip=' + (svg.indexOf('<clipPath id="cfclipu">') >= 0) + ' 文本=' + JSON.stringify(texts.filter(t => /此点|剖面|窗外|云量/.test(t))))
})
