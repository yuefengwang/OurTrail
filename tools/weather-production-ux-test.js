'use strict'

const assert = require('assert')
const Plans = require('../miniprogram/utils/weather-plans')
const WP = require('../miniprogram/utils/watch-points')
const F = require('../miniprogram/utils/format')
const adapter = require('../miniprogram/utils/weather-cloud-field')
const renderer = require('../miniprogram/utils/meteogram-svg')
const cloud = require('../miniprogram/utils/cloud-field-svg')
const api = require('../miniprogram/utils/api')
const draft = require('../miniprogram/utils/draft')
let passed = 0
function check(name, assertion) {
  assert.ok(assertion, name)
  passed++
  console.log('✓ ' + name)
}
const original = value => JSON.stringify(value)
const memory = new Map()
const storage = { get: key => memory.get(key), set: (key, value) => memory.set(key, JSON.parse(JSON.stringify(value))) }
draft.durableStorage = storage
draft.wxStorage = storage
const store = Plans.createStore(storage)
const route = {
  id: 'route-a', title: '测试路线', updatedAt: '2026-10-01T00:00:00Z',
  points: [
    { id: 'start', name: '入口', coordinates: { lat: 30.1, lng: 103.1 }, ele: 1000, time: '2020-01-01T00:00:00Z' },
    { id: 'camp', name: '营地', coordinates: { lat: 30.2, lng: 103.2 }, ele: 2000, time: '2020-01-03T00:00:00Z' },
  ],
}
const source = { kind: 'route', id: route.id }
const beforeRoute = original(route)
const plan = Plans.createPlan(route, source, '2026-10-27T08:00:00+08:00')
check('活动出发日带入但不填节点时刻', plan.startDate === '2026-10-27' && plan.visits.every(visit => visit.time === ''))
check('每次经过有独立标识', new Set(plan.visits.map(visit => visit.id)).size === 2)
check('GPX 原始时间未改', original(route) === beforeRoute)
check('非法日历日期被拒绝', !Plans.validDate('2026-02-30') && Plans.validDate('2028-02-29'))
check('跨月跨年按北京时间运算', Plans.addDays('2026-12-31', 1) === '2027-01-01')
plan.visits[0].time = '09:30'
plan.visits[1].time = '18:00'
plan.visits.push(Object.assign(Plans.newVisit(route.points[1]), { day: 2, time: '06:30', departure: true }))
check('同一营地当晚抵达和次日出发可共存', Plans.validatePlan(plan) === '' && plan.visits[1].id !== plan.visits[2].id)
const beforeBrowse = original(plan)
const rows = Plans.resolveVisits(plan, route, { date: '2026-11-01', time: '14:00' })
check('计划时刻优先于浏览时间', rows[0].date === '2026-10-27' && rows[0].time === '09:30' && rows[2].date === '2026-10-28')
check('解析经过不修改行程', original(plan) === beforeBrowse)
plan.visits[1].time = ''
const browsing = Plans.resolveVisits(plan, route, { date: '2026-11-01', time: '14:00' })
check('未安排节点用浏览时间且明确标识', !browsing[1].planned && browsing[1].date === '2026-11-01' && /未安排/.test(browsing[1].timeLabel))
const updated = JSON.parse(JSON.stringify(route))
updated.points[0].coordinates.lat = 30.8
updated.points.push({ id: 'new', name: '新节点', coordinates: { lat: 31, lng: 104 } })
updated.points.reverse()
const reordered = Plans.resolveVisits(plan, updated, { date: '2026-11-01', time: '14:00' })
check('路线按稳定 ID 更新位置而不重排个人经过', reordered[0].coordinates.lat === 30.8 && reordered[0].pointId === 'start')
check('新增路线节点不自动进入行程', reordered.length === plan.visits.length)
updated.points = updated.points.filter(point => point.id !== 'camp')
const removed = Plans.resolveVisits(plan, updated, { date: '2026-11-01', time: '14:00' })
check('删除节点保留经过、禁查且说明原因', removed.length === 3 && !removed[1].available && !removed[2].available && /移除/.test(removed[1].issue))
check('更新路线不修改个人安排', plan.visits[0].time === '09:30' && plan.visits[2].time === '06:30')
const invalid = JSON.parse(JSON.stringify(plan))
invalid.visits[1].time = '08:00'
check('逆序时刻被拒绝', /顺序/.test(Plans.validatePlan(invalid)))
invalid.visits[1].time = '24:00'
check('无效时刻被拒绝', /格式/.test(Plans.validatePlan(invalid)))
check('本机保存确有持久层记录', store.save(plan).ok && store.get(plan.id).visits.length === 3)
const copied = store.get(plan.id)
copied.visits[0].time = '10:00'
check('读取副本不会绕过保存改写原计划', store.get(plan.id).visits[0].time === '09:30')
const broken = Plans.createStore({ get: () => [], set: () => { throw Error('quota') } })
check('存储失败不报告成功', !broken.save(plan).ok)
store.remember({ lat: 30, lng: 103, name: '最近地点' })
check('最近查询不进入收藏或行程', store.recent().length === 1 && store.list().length === 1 && WP.createWatchPoints(storage).listPoints().length === 0)
const forecast = { status: 'ready', updatedAt: new Date().toISOString(), series: [{ d: '2026-10-27', t: '09:00', temp: 10, wind: 4, precip: 1.2, showers: 0.5, code: 61 }] }
const summary = Plans.hourlySummary(forecast, '2026-10-27', '09:40')
check('沿途天气按所在小时读取，不伪造分钟精度', summary.ready && /09:00/.test(summary.stamp))
check('总降水不重复加阵雨', /1.2 mm/.test(summary.text) && !/1.7 mm/.test(summary.text))
check('缺小时不以日汇总代替', !Plans.hourlySummary(forecast, '2026-10-27', '10:00').ready)

const today = F.cnToday()
const times = Array.from({ length: 24 }, (_, hour) => today + 'T' + String(hour).padStart(2, '0') + ':00')
const levels = [500, 1500, 2500, 3500, 4500, 5500, 6500].map(altitude => ({ pressure: 900, altitudes: times.map(() => altitude), cloudCover: times.map((_, hour) => hour === 8 || hour === 9 ? null : 90) }))
const result = { cloudLevels: { times, levels } }
const field = adapter.buildCloudField(result, { date: today, userAltitude: 3000 })
check('记录两个缺测小时，不以邻列冒充', original(field.meta.gapHours) === '[8,9]' && field.values[8].every(value => value === 0))
check('逐小时有效高度与缺测独立记录', field.coveredByHour[0].lo === 500 && field.coveredByHour[8] === null)
check('请求的日期不存在不偷用第一天', adapter.buildCloudField(result, { date: Plans.addDays(today, 2) }) === null)
const surface = times.map((time, hour) => ({ d: today, t: time.slice(11), temp: 10, wind: 5, gust: 8, windDir: 180, precip: 1, showers: 0.4, pop: 50, code: 3 }))
const geometry = renderer.buildUnified({ surface, cloudField: field, userAltitude: 3000, width: 318 })
check('有效小时仍有真实云层读数', cloud.inferState(geometry.sample, 7, 3000, field.covered).cUser === 90)
check('缺测小时弃权，不给云位置结论', cloud.inferState(geometry.sample, 8, 3000, field.covered).reason === 'no-data')
check('缺测时间之间不跨洞插值', Number.isNaN(geometry.sample(8.5, 3000)))
const svg = renderer.renderUnifiedBase(geometry, {}).svg
check('真实渲染输出缺测斜纹遮罩', /data-missing-hour="8"/.test(svg) && /url\(#missing-cloud\)/.test(svg))
check('SVG 不能出现 NaN 坐标', !/NaN|undefined/.test(svg))
const high = renderer.buildUnified({ surface, cloudField: field, userAltitude: 3000, width: 318, cloudWindow: 'high' })
check('高层窗只改变显示区间', high.profile.lo === 3000 && high.profile.hi === 7000)
check('切显示窗不改变判读', original(cloud.inferState(high.sample, 7, 3000, field.covered)) === original(cloud.inferState(geometry.sample, 7, 3000, field.covered)))

function loadPage(name) {
  let config
  global.Page = value => { config = value }
  const path = require.resolve('../miniprogram/pages/' + name + '/' + name)
  delete require.cache[path]
  require(path)
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) })
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(key => {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) target = target[parts.shift()]
      target[parts[0]] = patch[key]
    })
    if (callback) callback()
  }
  return page
}

async function main() {
  const navigations = []
  global.wx = {
    showToast() {}, navigateTo: request => navigations.push(request.url),
    getStorageSync: storage.get, setStorageSync: storage.set, enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {},
    showModal: request => request.success({ confirm: true }),
  }
  const hub = loadPage('weather-hub')
  hub.data.manual = { name: '', lat: '', lng: '', ele: '', wgs: false }
  hub.onManualSubmit()
  check('真实手输 handler 拦空坐标', !!hub.data.manualError && navigations.length === 0)
  hub.data.manual = { name: '测试地点', lat: '30.1', lng: '103.1', ele: '', wgs: false }
  hub.onManualSubmit()
  check('空海拔不传 0 米且查询不自动收藏', !/ele=/.test(navigations[0]) && WP.createWatchPoints(storage).listPoints().length === 0)
  hub.data.manual.ele = 'unknown'
  hub.onManualSubmit()
  check('无效海拔不静默忽略', /海拔/.test(hub.data.manualError))
  api.readRoutes = async () => ({ route, revision: 1 })
  let active = 0
  let maxActive = 0
  api.getWeatherByPoint = async (lat, lng, date) => {
    active++; maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 3))
    active--
    return { status: 'ready', series: [{ d: date, t: '09:00', temp: lat, wind: 4, precip: 0.5, code: 3 }], updatedAt: new Date().toISOString() }
  }
  const page = loadPage('weather-plan')
  page.route = 'pages/weather-plan/weather-plan'
  page.onLoad({ route: route.id })
  await page.reload()
  await new Promise(resolve => setTimeout(resolve, 25))
  check('真实页面默认沿途总览', !page.data.editing && page.data.days.length === 1 && page.data.rows.length === 2)
  check('路线资产不覆盖微信 Page.route 页面路径', page.route === 'pages/weather-plan/weather-plan' && page.routeAsset.id === route.id)
  check('沿途总览接入天气接口而非原型样例', page.data.rows.every(row => row.weather && row.weather.ready))
  check('查询并发有界', maxActive <= 3 && active === 0)
  const oldPlan = original(page.plan)
  page.onBrowseTime({ detail: { value: '10:00' } })
  check('浏览不改个人行程', original(page.plan) === oldPlan)
  page.onEdit()
  page.onVisit({ currentTarget: { dataset: { id: page.plan.visits[0].id, field: 'time' } }, detail: { value: '09:30' } })
  page.onSave()
  check('页面编辑真实保存而非只改 setData', store.get(page.plan.id).visits[0].time === '09:30')
  const allPoints = page.routeAsset.points
  page.routeAsset.points = []
  page.onSave()
  check('待处理失效节点阻止保存，原计划保留', !!page.data.error && store.get(page.plan.id).visits.length === 2)
  page.routeAsset.points = allPoints
  const firstId = page.plan.id
  page.onCopy()
  check('复制有新标识且未覆盖原计划', page.plan.id !== firstId && store.get(firstId).visits[0].time === '09:30')
  page.onCancelEdit()
  await page.reload()
  check('未保存副本重新展示仍有合法来源', !page.data.denied && page.plan.source.id === route.id)
  api.readRoutes = async () => { const error = Error('无权限'); error.code = 'FORBIDDEN'; throw error }
  await page.reload()
  check('路线权限失效不使用旧坐标继续查', page.data.denied === '无权限' && page.data.rows.length === 0)
  const detail = loadPage('weather')
  detail.onLoad({ src: 'local', lat: '', lng: '103' })
  check('分享或深链接空坐标也被拒绝', detail.localPoint.invalid === true)
  detail.data.chartView = surface
  detail.data.chartMarks = {}
  detail.selectHour(today, '08:00')
  check('真实页面逐时读数不重复加阵雨', detail.data.hourChip.precip === 1)
  detail.onHourStep({ currentTarget: { dataset: { step: 1 } } })
  check('前后小时按钮联动选择', detail.data.chartPick.t === '09:00')
  detail.onHourPicker({ detail: { value: 12 } })
  check('直接选时联动选择', detail.data.chartPick.t === '12:00')
  detail.onWeatherTab({ currentTarget: { dataset: { tab: 'sky' } } })
  check('单点详情可切换天相且不生成沿途空模块', detail.data.weatherTab === 'sky' && detail.data.tabOptions.length === 3)
  detail.data.unified = { src: 'actual-cloud' }
  detail.onEvidenceJump({ currentTarget: { dataset: { at: '12:00' } } })
  check('天相看图先显示真实云层标签再定位小时', detail.data.weatherTab === 'cloud' && detail.data.chartPick.t === '12:00')
  detail.data.weatherTab = 'sky'
  detail.data.unified = null
  detail.data.date = today
  detail.onOiEvidence({ currentTarget: { dataset: { hour: 13 } } })
  check('没有剖面时天相看图进入逐时预报', detail.data.weatherTab === 'hourly' && detail.data.chartPick.t === '13:00')
  const files = new Map([['/tmp/original.gpx', '<gpx>unchanged historical source</gpx>']])
  let copyFailed = false
  global.wx.env = { USER_DATA_PATH: '/local' }
  global.wx.getFileSystemManager = () => ({
    copyFile(request) {
      if (copyFailed) return request.fail(new Error('disk full'))
      files.set(request.destPath, files.get(request.srcPath)); request.success()
    },
    unlink(request) { files.delete(request.filePath) },
  })
  const imported = loadPage('weather-hub')
  imported._gpxSourcePath = '/tmp/original.gpx'
  imported._gpxParsed = { ok: true, points: route.points, track: [{ lat: 30, lng: 103 }, { lat: 30.1, lng: 103.1 }], distanceKm: 3, ascentM: 400, stats: { hasElevation: true } }
  imported.data.gpxPoints = route.points
  imported.data.gpxMeta = { fileName: 'original.gpx' }
  await imported.onGpxApply()
  const localTrack = WP.createWatchPoints(storage).listTracks()[0]
  check('GPX 原始文件复制不改字节，节点筛选不重写原文件', files.get(localTrack.originalPath) === files.get('/tmp/original.gpx') && localTrack.points.length === 2)
  check('轻量轨迹保留供路线库复用', localTrack.track.length === 2)
  const failedImport = loadPage('weather-hub')
  failedImport._gpxSourcePath = '/tmp/original.gpx'
  failedImport._gpxParsed = { ok: true, points: route.points, stats: {} }
  failedImport.data.gpxPoints = route.points
  copyFailed = true
  await failedImport.onGpxApply()
  check('原文件保存失败不会生成半份轨迹或成功提示', WP.createWatchPoints(storage).listTracks().length === 1 && !!failedImport.data.gpxError && !failedImport.data.busy)
  console.log('\npassed=' + passed + ' failed=0')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
