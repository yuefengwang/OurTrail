// getSkyContext 集成测试（Slice 2–5）：node tools/sky-context-test.js
// 真 index.js + 内存 wx-server-sdk 桩 + 按 URL 路由的 https 桩；
// 验：四个源并行、部分源失败仍 ready、地形/方向/LP 形状、缺 atmosphere 不拖垮。
'use strict'
const path = require('path')
const Module = require('module')
const { EventEmitter } = require('events')

const STUB = path.join(__dirname, 'stub-wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return STUB
  return origResolve.call(this, request, ...rest)
}
const stub = require('./stub-wx-server-sdk')
stub.__state.db = stub.__fakeDb()
stub.__state.openid = ''
process.env.DARKSKY_API_KEY = 'test-key'

const https = require('https')
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
const next = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
const times = []
for (let h = 0; h < 48; h++) times.push((h < 24 ? today : next) + 'T' + String(h % 24).padStart(2, '0') + ':00')

function coordsFromUrl(url) {
  const m = /[?&]latitude=([^&]+)/.exec(url)
  return m ? m[1].split(',').length : 0
}

let httpsCalls = 0
let lpCalls = 0
https.get = function (url, options, cb) {
  if (typeof options === 'function') { cb = options; options = null }
  httpsCalls++
  const n = coordsFromUrl(url)
  let status = 200
  let body = ''
  if (url.indexOf('api.open-meteo.com/v1/forecast') >= 0) {
    body = JSON.stringify(Array.from({ length: n }, (_, i) => ({
      hourly: {
        time: times,
        cloud_cover_low: times.map(() => 10 + i),
        cloud_cover_mid: times.map(() => 20),
        cloud_cover_high: times.map(() => 30),
        cloud_cover: times.map(() => 40),
        precipitation: times.map(() => 0),
        precipitation_probability: times.map(() => 10),
      },
    })))
  } else if (url.indexOf('/v1/elevation') >= 0) {
    body = JSON.stringify({ elevation: Array(n).fill(1500) })
  } else if (url.indexOf('darkskysites.com') >= 0) {
    lpCalls++
    body = JSON.stringify({ sqm: 21.5, bortleClass: 2, dataset: 'test' })
  } else {
    status = 404
    body = JSON.stringify({ error: 'not mocked' })
  }
  const req = new EventEmitter()
  req.setTimeout = function () {}
  req.destroy = function () {}
  const res = new EventEmitter()
  res.statusCode = status
  res.resume = function () {}
  process.nextTick(() => {
    cb(res)
    process.nextTick(() => { res.emit('data', body); res.emit('end') })
  })
  return req
}

const trailApi = require('../cloudfunctions/trailApi/index')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

;(async () => {
  section('1. 四源并行 + 部分缺失')
  const r = await trailApi.main({ action: 'getSkyContext', lat: 30, lng: 103, date: today, elevation: 3000 })
  check('信封 ok', r && r.ok, r && r.error)
  const d = r && r.data
  check('status=ready（spatial/terrain/LP 至少一个成功）', d && d.status === 'ready', d && d.status)
  check('spatial 8 方位', d && d.spatial && d.spatial.byAzimuth.length === 8)
  check('spatial 覆盖今天+次日 48 小时', d && d.spatial && d.spatial.times.length === 48, d && d.spatial && d.spatial.times.length)
  check('terrain 16 方位地平线', d && d.terrain && d.terrain.horizon.length === 16)
  check('lightPollution Bortle/SQM', d && d.lightPollution && d.lightPollution.bortle === 2 && d.lightPollution.sqm === 21.5)
  check('sources: spatial/terrain/LP ok，atmosphere missing',
    d && d.sources.spatial === 'ok' && d.sources.terrain === 'ok' &&
    d.sources.lightPollution === 'ok' && d.sources.atmosphere === 'missing', d && d.sources)
  check('atmosphere 缺失不拖垮整条上下文', d && d.atmosphere === null)

  section('2. 无 key 时 LP 明确 missing')
  delete process.env.DARKSKY_API_KEY
  // 换一个没有 LP 缓存的点，避免复用上一条的静态缓存
  const r2 = await trailApi.main({ action: 'getSkyContext', lat: 31, lng: 104, date: today, elevation: 3000 })
  check('无 key 仍 ready（其它源成功）', r2 && r2.ok && r2.data.status === 'ready')
  check('LP 明确 missing + no-key', r2 && r2.data.sources.lightPollution === 'missing' &&
    r2.data.lightPollutionReason === 'no-key', r2 && r2.data.lightPollutionReason)

  section('3. elevation:null 不被当成 0')
  const r3 = await trailApi.main({ action: 'getSkyContext', lat: 30.5, lng: 103.5, date: today, elevation: null })
  check('null elevation 仍 ready', r3 && r3.ok && r3.data.status === 'ready', r3 && r3.error)
  check('terrain.elevation 取中心 DEM，不是 0',
    r3 && r3.data.terrain && r3.data.terrain.elevation === 1500, r3 && r3.data.terrain && r3.data.terrain.elevation)
  check('地平线角不再出现假 70°+ 山脊',
    r3 && r3.data.terrain &&
      Math.max.apply(null, r3.data.terrain.horizon.map(h => h.angle)) < 20,
    r3 && r3.data.terrain && Math.max.apply(null, r3.data.terrain.horizon.map(h => h.angle)))

  section('4. 光污染缓存 30 天后重取（过期不是永久沿用）')
  process.env.DARKSKY_API_KEY = 'test-key'
  const rTtl1 = await trailApi.main({ action: 'getSkyContext', lat: 31.5, lng: 104.5, date: today, elevation: 3000 })
  check('首次取到 LP', !!(rTtl1 && rTtl1.data && rTtl1.data.lightPollution), rTtl1 && rTtl1.data && rTtl1.data.lightPollutionReason)
  const lpKey = 'l_31.50_104.50'
  const lpDoc = await stub.__state.db.collection('weather_cache').doc(lpKey).get()
  await stub.__state.db.collection('weather_cache').doc(lpKey).set({
    data: { lightPollution: lpDoc.data.lightPollution, fetchedAt: new Date(Date.now() - 31 * 86400000) },
  })
  const lpBefore = lpCalls
  const rTtl2 = await trailApi.main({ action: 'getSkyContext', lat: 31.5, lng: 104.5, date: today, elevation: 3000 })
  check('超过 30 天后重新外呼（' + lpBefore + ' → ' + lpCalls + '）', lpCalls === lpBefore + 1)
  check('重取成功不再标 stale', !!(rTtl2 && rTtl2.data && rTtl2.data.stale.lightPollution === false),
    rTtl2 && rTtl2.data && JSON.stringify(rTtl2.data.stale))

  section('5. DarkSkySites 月预算：只停光污染，不拖垮其它源')
  const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
  await stub.__state.db.collection('weather_cache').doc('lq_' + month).set({
    data: { count: 25000, month },
  })
  const lpBeforeBudget = lpCalls
  const rBudget = await trailApi.main({ action: 'getSkyContext', lat: 32, lng: 105, date: today, elevation: 3000 })
  const dBudget = rBudget && rBudget.data
  check('LP 明确 missing + reason=budget',
    !!(dBudget && dBudget.sources.lightPollution === 'missing' && dBudget.lightPollutionReason === 'budget'),
    dBudget && JSON.stringify({ src: dBudget.sources, reason: dBudget.lightPollutionReason }))
  check('方向云/地形照常返回', !!(dBudget && dBudget.spatial && dBudget.terrain))
  check('预算用尽后零 darkskysites 外呼', lpCalls === lpBeforeBudget)

  section('6. 每日配额：第 61 次拒绝，且不再外呼')
  stub.__state.openid = 'quota-tester'
  let allowed = 0
  for (let i = 0; i < 60; i++) {
    const rr = await trailApi.main({ action: 'getSkyContext', lat: 29, lng: 102, date: today, elevation: 3500 })
    if (rr && rr.ok && rr.data && rr.data.status === 'ready') allowed++
  }
  check('前 60 次仍正常返回（' + allowed + '/60）', allowed === 60)
  const callsBefore = httpsCalls
  const r61 = await trailApi.main({ action: 'getSkyContext', lat: 29, lng: 102, date: today, elevation: 3500 })
  const d61 = r61 && r61.data
  check('第 61 次 status=unavailable / reason=rate_limited',
    r61 && r61.ok && d61 && d61.status === 'unavailable' && d61.reason === 'rate_limited',
    r61 && JSON.stringify({ status: d61 && d61.status, reason: d61 && d61.reason }))
  check('拒绝带可行动话术（次数已用完）', !!(d61 && /次数已用完/.test(d61.message || '')), d61 && d61.message)
  check('四块增强输入全部为 null', !!(d61 && !d61.spatial && !d61.terrain && !d61.atmosphere && !d61.lightPollution))
  /* 行为断言而非状态断言：配额命中必须在任何 https 外呼之前返回。
     若只是把 status 改个名字、仍然打上游，第 61 次会让计数 +1。 */
  check('配额命中后零外呼（' + callsBefore + ' → ' + httpsCalls + '）', httpsCalls === callsBefore)

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
})().catch(e => {
  console.error(e)
  process.exit(1)
})
