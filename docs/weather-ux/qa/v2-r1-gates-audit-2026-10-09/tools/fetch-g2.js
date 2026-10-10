/* G2 取证第一步：用生产同一份 lib/weather.js 抓真实气压层剖面，落盘成只读快照。
 *
 * 为什么还要再抓一份：仓库里已有的真实快照只有 3 站（成都 489 / 峨眉山 3004 / 理塘 4058），
 * 而「云海最低高度口径」要判的是「云在脚下多低还算云海」——需要一批**海拔各不相同的查询点**
 * 才能看出绝对扫描下界与相对净空两种口径的差别。这里把原型 real-data.js 里那四个地点
 * （理塘 / 稻城 / 峨眉山 / 成都，稻城此前从未进过任何落盘样本）一次抓全，
 * 并把取数时间、坐标、WGS 换算结果一起写进快照，让它**可复跑、可核对**。
 *
 * 只读：不改任何生产文件、不改阈值、不写云端。
 * 运行：node fetch-g2.js            （需要网络可达 api.open-meteo.com）
 */
'use strict'
const fs = require('fs')
const path = require('path')
const W = require(path.join(__dirname, '../../../../../cloudfunctions/trailApi/lib/weather.js'))

/* 四地点：GCJ-02 坐标（与页面传参一致），海拔由 Open-Meteo 的 elevation 字段回填，
 * 不手填——手填就把「海拔出处」这件事又变回一个数字。 */
const PLACES = [
  { key: 'chengdu', name: '成都', gcj: [30.5728, 104.0668] },
  { key: 'emeishan', name: '峨眉山', gcj: [29.5200, 103.3400] },
  { key: 'litang', name: '理塘', gcj: [30.0020, 100.2700] },
  { key: 'daocheng', name: '稻城', gcj: [29.0360, 100.2990] },
]

;(async function run () {
  const date = W.cnToday()
  const out = { fetchedAt: new Date().toISOString(), date, source: 'api.open-meteo.com（经生产 lib/weather.js，与线上同一条取数路径）', places: {} }
  for (const p of PLACES) {
    const wgs = W.gcjToWgs(p.gcj[0], p.gcj[1])
    const f = await W.fetchForecast(wgs.lat, wgs.lng, date)
    out.places[p.key] = {
      name: p.name, gcj: p.gcj,
      wgs: [Number(wgs.lat.toFixed(4)), Number(wgs.lng.toFixed(4))],
      elevation: f.elevation,
      seriesLen: (f.series || []).length,
      cloudLevels: f.cloudLevels,
      series: f.series || [],
    }
    console.log([p.name, 'elev=' + f.elevation,
      'times=' + (f.cloudLevels && f.cloudLevels.times && f.cloudLevels.times.length),
      'levels=' + (f.cloudLevels && f.cloudLevels.levels && f.cloudLevels.levels.length),
      'series=' + (f.series || []).length].join(' '))
  }
  const f = path.join(__dirname, 'real-cloud-g2.json')
  fs.writeFileSync(f, JSON.stringify(out))
  console.log('written ' + path.basename(f) + ' bytes=' + fs.statSync(f).size)
})().catch(e => { console.error('FAIL', e && e.message); process.exit(1) })
