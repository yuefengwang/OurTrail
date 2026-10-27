// 地形地平线（Slice 4）测试：node tools/terrain-test.js
// 覆盖：16×9 网格、俯角、平地/山脊/缺测、开放度、URL 契约。
'use strict'
const T = require('../cloudfunctions/trailApi/lib/terrain')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

section('1. 网格与俯角')
{
  const pts = T.pointsFor(30, 103)
  check('144 个采样点', pts.length === 144)
  check('16 个方位各 9 个距离', T.AZIMUTHS.length === 16 && T.AZIMUTHS.every(az => pts.filter(p => p.azimuth === az).length === 9))
  check('距离档 1–80 km', JSON.stringify(T.DISTANCES_KM) === '[1,2,4,8,12,20,30,50,80]')
  check('海平面俯角 0', T.dipDeg(0) === 0)
  const d3000 = T.dipDeg(3000)
  check('3000 m 俯角约 1.77°（' + d3000 + '）', d3000 > 1.6 && d3000 < 1.9)
}

section('2. 平地与山脊')
{
  const pts = T.pointsFor(30, 103)
  const flat = T.horizonFrom(0, pts, pts.map(() => 0))
  check('平地：每个方位地平线角≈0', flat.horizon.every(h => Math.abs(h.angle) < 0.01))
  check('平地：开放度 1', flat.openness === 1)
  check('平地：无地形点（distance 0）', flat.horizon.every(h => h.distance === 0))

  const ridgeElev = pts.map(p => (p.azimuth === 0 && p.distance === 8 ? 3000 : 0))
  const ridge = T.horizonFrom(1000, pts, ridgeElev)
  const north = ridge.horizon.find(h => h.azimuth === 0)
  check('北侧 8 km 有 3000 m 山脊：视角 > 10°（' + north.angle + '）', north.angle > 10)
  check('山脊点被记录（distance/elevation）', north.distance === 8 && north.elevation === 3000)
  const south = ridge.horizon.find(h => h.azimuth === 180)
  check('无山脊的方位回到俯角（' + south.angle + '）', south.angle < 0 && Math.abs(south.angle + ridge.dip) < 0.01)

  const allRidge = T.horizonFrom(1000, pts, pts.map(p => p.distance === 8 ? 3000 : 0))
  check('四周都是高脊：开放度 0', allRidge.openness === 0)
}

section('3. 缺测与 URL')
{
  const pts = T.pointsFor(30, 103)
  const missing = T.horizonFrom(0, pts, pts.map((_, i) => (i % 3 === 0 ? null : 0)))
  check('缺测点跳过，不编 0 地形', missing.horizon.every(h => Number.isFinite(h.angle)))
  const url = T.elevationUrl(pts.slice(0, 100))
  check('Elevation URL 一次最多 100 点', (url.match(/latitude=/g) || []).length === 1 && url.split('latitude=')[1].split('&')[0].split(',').length === 100)
  check('URL 指向 Open-Meteo elevation', url.indexOf('api.open-meteo.com/v1/elevation') >= 0)
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
