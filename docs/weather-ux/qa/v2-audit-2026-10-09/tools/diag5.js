/* before/after 同数据对拍：同一份真实剖面，旧新两版几何各自的伪影计数 */
'use strict'
const fs = require('fs')
const ADP = require('D:/OurTrail/miniprogram/utils/weather-cloud-field.js')
const NEW = require('D:/OurTrail/miniprogram/utils/cloud-field-svg.js')
const OLD = require(process.argv[3] || 'C:/Users/thinkbook/AppData/Local/Temp/ot-cf/cloud-field-svg.BEFORE.js')
const FIX = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const L = 38, Rpx = 10, PLOT_H = 300, plotW = 375 - L - Rpx
const THS = [10, 25, 50, 75, 90]

function segX (p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (Math.abs(d) < 1e-12) return false
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98
}
function measure (M, field, hours) {
  const column = M.makeColumnSampler(field), nT = field.times.length
  const sample = (t, alt) => M.sampleAtStations(column, nT, t, alt)
  const F = M.buildFieldGrid(sample, nT, { hours })
  const xOf = i => L + ((F.t0 + i * F.dt) / hours) * plotW
  const yOf = j => PLOT_H - (F.a0 + j * F.da - M.ALT0) / (M.ALT1 - M.ALT0) * PLOT_H
  const acc = { loops: 0, verts: 0, trunc: 0, self: 0, chord: 0, needle: 0, sharp: 0, areaSum: 0, byT: {} }
  THS.forEach(T => {
    const loops = M.isoBandsFromGrid(F, T, xOf, yOf)
    const row = { loops: loops.length, trunc: 0, self: 0, chord: 0, needle: 0 }
    loops.forEach(lp => {
      const dg = lp.__diag || {}
      acc.loops++; acc.verts += lp.length
      if (dg.truncated) { acc.trunc++; row.trunc++ }
      let sx = 0
      for (let i = 0; i < lp.length; i++) {
        for (let j = i + 2; j < lp.length; j++) {
          if (i === 0 && j === lp.length - 1) continue
          if (segX(lp[i], lp[(i + 1) % lp.length], lp[j], lp[(j + 1) % lp.length])) sx++
        }
      }
      if (sx) { acc.self++; row.self++ }
      const ch = Math.hypot(lp[0].x - lp[lp.length - 1].x, lp[0].y - lp[lp.length - 1].y)
      if (ch > 30) { acc.chord++; row.chord++ }
      if (dg.area != null && dg.area < 20) { acc.needle++; row.needle++ }
      if (dg.area != null) acc.areaSum += dg.area
      let st = 0
      for (let i = 0; i < lp.length; i++) {
        const p = lp[(i - 1 + lp.length) % lp.length], q = lp[i], r = lp[(i + 1) % lp.length]
        let d = Math.abs(Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI - Math.atan2(r.y - q.y, r.x - q.x) * 180 / Math.PI)
        if (d > 180) d = 360 - d
        if (d > 45) st++
      }
      acc.sharp += st
    })
    acc.byT[T] = row
  })
  return acc
}
const rows = []
for (const k of Object.keys(FIX.places)) {
  const p = FIX.places[k];
  [24, 48, 72].forEach(hours => {
    const field = ADP.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: FIX.date, hours, userAltitude: p.elevation })
    if (!field) return
    rows.push({ name: p.name, hours, old: measure(OLD, field, hours), new: measure(NEW, field, hours) })
  })
}
function line (tag, r) {
  const o = r[tag]
  return '    ' + tag.padEnd(4) + ' 环' + String(o.loops).padStart(3) + ' 点' + String(o.verts).padStart(5) +
    ' 断链' + String(o.trunc).padStart(3) + ' 自交环' + String(o.self).padStart(3) +
    ' 长弦环' + String(o.chord).padStart(3) + ' 针状碎片' + String(o.needle).padStart(3) +
    ' 折角>45° ' + String(o.sharp).padStart(4) + '/' + o.verts + '（' + (o.sharp / (o.verts || 1) * 100).toFixed(1) + '%）' +
    ' 总填充面积 ' + Math.round(o.areaSum)
}
let sum = { old: { trunc: 0, self: 0, chord: 0, needle: 0, sharp: 0, verts: 0, loops: 0 }, new: { trunc: 0, self: 0, chord: 0, needle: 0, sharp: 0, verts: 0, loops: 0 } }
rows.forEach(r => {
  console.log('\n### ' + r.name + ' ' + r.hours + 'h @375px')
  console.log(line('old', r)); console.log(line('new', r))
  ;['old', 'new'].forEach(t => { ['trunc', 'self', 'chord', 'needle', 'sharp', 'verts', 'loops'].forEach(f => { sum[t][f] += r[t][f] }) })
})
console.log('\n===== 合计（3 地点 × 24/48/72h）')
;['old', 'new'].forEach(t => console.log('  ' + t + ': 环 ' + sum[t].loops + ' 断链 ' + sum[t].trunc + ' 自交环 ' + sum[t].self +
  ' 长弦环 ' + sum[t].chord + ' 针状碎片 ' + sum[t].needle + ' 折角>45° ' + sum[t].sharp + '/' + sum[t].verts +
  '（' + (sum[t].sharp / sum[t].verts * 100).toFixed(2) + '%）'))
