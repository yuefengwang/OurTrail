// 路线海拔剖面纯函数：连续 / 节点 / 无数据三态，绝不互相冒充。
// 运行：node tools/route-profile-test.js
'use strict'
const RP = require('../miniprogram/utils/route-profile')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const track = (eleList) => eleList.map((ele, i) => ({
  lat: 30 + i * 0.001,
  lng: 103 + i * 0.001,
  ...(ele === null ? {} : { ele }),
}))
const nodes = (eleList) => eleList.map((ele, i) => ({
  coordinates: { lat: 30 + i * 0.002, lng: 103 + i * 0.002 },
  ...(ele === null ? {} : { ele }),
}))

section('1. 连续高程：轨迹采样点有 ele')
{
  const r = RP.buildProfile({ track: track([1000, 1200, 1100]), points: [] })
  check('mode=continuous', r.mode === 'continuous', r.mode)
  check('实际最低/最高高程不被显示窗 padding 改写', r.minEle === 1000 && r.maxEle === 1200, [r.minEle, r.maxEle])
  check('距离来自轨迹且 > 0', r.distanceKm > 0, r.distanceKm)
  check('SVG 含折线与面积，且无 NaN/undefined', /<path/.test(r.svg) && !/NaN|undefined/.test(r.svg))
  check('点位计数 = 轨迹点', r.pointCount === 3, r.pointCount)
  check('距离标签为轨迹里程', r.distanceLabel === '轨迹里程', r.distanceLabel)
  check('viewBox 按手机卡片宽度（280×160），不是 660 再缩',
    /viewBox="0 0 280 160"/.test(r.svg), (r.svg.match(/viewBox="[^"]+"/) || [])[0])
  check('坐标标签 11px（306px 模拟器下仍可读）', /font-size="11"/.test(r.svg))
}

section('2. 节点高程：没有连续轨迹时，明确降级为节点剖面')
{
  const r = RP.buildProfile({ track: [], points: nodes([800, 900, 850]) })
  check('mode=nodes', r.mode === 'nodes', r.mode)
  check('原因说轨迹没有高程', r.reason === '轨迹没有高程', r.reason)
  check('距离标签为节点直线距离', r.distanceLabel === '节点间直线距离', r.distanceLabel)
  check('节点画成圆点（不是伪装成连续地形）', (r.svg.match(/<circle/g) || []).length === 3,
    (r.svg.match(/<circle/g) || []).length)
  check('SVG 无 NaN', !/NaN|undefined/.test(r.svg))
}

section('3. 轨迹高程不连续：不跨缺口连线，降级为节点剖面')
{
  const r = RP.buildProfile({
    track: track([1000, null, 1100]),
    points: nodes([1000, 1100]),
  })
  check('mode=nodes', r.mode === 'nodes', r.mode)
  check('原因说轨迹高程不连续', r.reason === '轨迹高程不连续', r.reason)
  check('节点圆点存在', (r.svg.match(/<circle/g) || []).length === 2,
    (r.svg.match(/<circle/g) || []).length)
}

section('4. 无数据：说明缺什么，不画曲线')
{
  const noEle = RP.buildProfile({ track: track([null, null]), points: nodes([null, null]) })
  check('有坐标无高程 → empty', noEle.mode === 'empty', noEle.mode)
  check('原因是 no-elevation', noEle.reason === 'no-elevation', noEle.reason)
  check('empty 不产出 SVG', noEle.svg === '', noEle.svg)

  const noGeo = RP.buildProfile({ track: [], points: [] })
  check('没有坐标 → empty', noGeo.mode === 'empty', noGeo.mode)
  check('原因是 no-geometry', noGeo.reason === 'no-geometry', noGeo.reason)

  const onePoint = RP.buildProfile({ track: [], points: nodes([900]) })
  check('只有一个高程点 → empty', onePoint.mode === 'empty', onePoint.mode)
  check('原因是 not-enough-points', onePoint.reason === 'not-enough-points', onePoint.reason)

  const invalid = RP.buildProfile({ track: [{ lat: NaN, lng: 103, ele: 900 }, { lat: 30, lng: 103, ele: 1000 }], points: [] })
  check('非法坐标被过滤后不足两点 → empty', invalid.mode === 'empty', invalid.mode)
}

section('5. 连续优先 + 全平线 + 输入不被改写')
{
  const both = RP.buildProfile({
    track: track([1000, 1100]),
    points: nodes([500, 600]),
  })
  check('有连续轨迹时不拿节点覆盖', both.mode === 'continuous' && both.minEle === 1000, [both.mode, both.minEle])

  const flat = RP.buildProfile({ track: track([1000, 1000]), points: [] })
  check('全平线 min=max，不产生 NaN 坐标', flat.minEle === 1000 && flat.maxEle === 1000 && !/NaN/.test(flat.svg),
    [flat.minEle, flat.maxEle])

  const input = { track: track([1000, 1100]), points: nodes([900, 950]) }
  const before = JSON.stringify(input)
  RP.buildProfile(input)
  check('纯函数：输入不被改写', JSON.stringify(input) === before)
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
