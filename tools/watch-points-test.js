// 观察点/轨迹点组（utils/watch-points.js）测试：node tools/watch-points-test.js
// 该 util 是纯模块（不引用 wx，storage 由调用方注入），本文件**零桩**直接 require——
// 这本身就是 AGENTS.md 纯度规则的验收：如果哪天有人给它加了 wx.*，这里的加载即失败。
'use strict'

const hadWxBefore = typeof global.wx === 'undefined'
const WP = require('../miniprogram/utils/watch-points')
const gpx = require('../miniprogram/utils/gpx')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

// 注入式 storage 的测试替身：与 draft.wxStorage 同接口（get/set 两个原子操作）
function fakeStorage() {
  const m = new Map()
  return {
    get: k => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    _m: m,
  }
}

// 与 parseGpx 返回体同形状的桩（P3 §6 评审校对：distanceKm/ascentM 在顶层、
// stats 无 hasEle/hasTime——fromGpx 的映射就是照这个来的）
function fakeParsed(withTime) {
  const t = d => (withTime ? d : null)
  return {
    ok: true,
    points: [
      { name: '垭口', kind: 'start', coordinates: { lat: 30.94581, lng: 103.47691 }, time: t('2026-09-01T08:00:00+08:00'), ele: 4200.4 },
      { name: '', kind: 'checkpoint', coordinates: { lat: 30.95112, lng: 103.48223 }, time: t('2026-09-01T15:00:00+08:00'), ele: null },
      { name: '营地', kind: 'finish', coordinates: { lat: 30.96003, lng: 103.49015 }, time: t('2026-09-02T09:30:00+08:00'), ele: 4510.6 },
    ],
    track: [],
    distanceKm: 21.3,
    ascentM: 1200,
    suggestions: null,
    stats: { waypoints: 3, routePoints: 0, trackPoints: 0, hasElevation: true },
  }
}

section('1. 纯度与 CRUD 往返')
{
  check('无 wx 的 Node 下可直接加载（纯度规则验收）', hadWxBefore)
  const st = fakeStorage()
  const wp = WP.createWatchPoints(st)
  const r = wp.savePoint({ name: '四姑娘山', lat: 31.0632, lng: 102.9085, ele: null, eleSource: 'picked' })
  check('savePoint ok 且生成 wp- 前缀 id', r.ok && /^wp-/.test(r.point.id), JSON.stringify(r))
  check('createdAt 落库', typeof r.point.createdAt === 'string' && r.point.createdAt.indexOf('T') > 0)
  const list = wp.listPoints()
  check('listPoints 读回一条', list.length === 1 && list[0].name === '四姑娘山' && list[0].lat === 31.0632)
  check('ele=null 与 eleSource 原样保留', list[0].ele === null && list[0].eleSource === 'picked')
  list[0].name = '被外部篡改'
  check('listPoints 返回拷贝（外部改不污染存储）', wp.listPoints()[0].name === '四姑娘山')
}

section('2. 更新 / 删除 / 容量')
{
  const st = fakeStorage()
  const wp = WP.createWatchPoints(st)
  const a = wp.savePoint({ name: 'A', lat: 30.1, lng: 102.1, ele: null, eleSource: 'manual' }).point
  const created = a.createdAt
  const r = wp.savePoint({ id: a.id, name: 'A2', lat: 30.1002, lng: 102.1002, ele: 4250, eleSource: 'manual' })
  check('带已有 id 保存 = 更新（不增行）', r.ok && r.updated === true && wp.listPoints().length === 1)
  check('更新沿用原 id 与 createdAt', r.point.id === a.id && r.point.createdAt === created)
  check('更新字段生效', r.point.name === 'A2' && r.point.ele === 4250)
  wp.deletePoint(a.id)
  check('deletePoint 生效', wp.listPoints().length === 0)

  for (let i = 0; i < WP.POINTS_CAP; i++) {
    wp.savePoint({ name: 'p' + i, lat: 20 + i * 0.5, lng: 100 + i, ele: null, eleSource: 'manual' })
  }
  const over = wp.savePoint({ name: '溢出', lat: 21, lng: 101, ele: null, eleSource: 'manual' })
  check('单点容量 ' + WP.POINTS_CAP + ' 拒绝且不挤掉旧数据', over.ok === false && over.reason === 'cap' && wp.listPoints().length === WP.POINTS_CAP)

  for (let i = 0; i < WP.TRACKS_CAP; i++) {
    wp.saveTrack({ id: 'wt-' + i, name: 't' + i, stats: { count: 2 }, points: [] })
  }
  const overT = wp.saveTrack({ id: 'wt-x', name: 'tx', stats: { count: 2 }, points: [] })
  check('轨迹组容量 ' + WP.TRACKS_CAP + ' 拒绝', overT.ok === false && overT.reason === 'cap' && wp.listTracks().length === WP.TRACKS_CAP)
  wp.deleteTrack('wt-3')
  check('deleteTrack 生效', wp.listTracks().length === WP.TRACKS_CAP - 1)
  check('getTrack 命中', wp.getTrack('wt-4').name === 't4')
  check('getTrack 未命中返回 null', wp.getTrack('wt-gone') === null)
}

section('3. 去重网格与坐标文案')
{
  check('3dp 网格内同 key', WP.dedupeKey(31.1231, 102.8761) === WP.dedupeKey(31.1234, 102.8764))
  check('3dp 网格外不同 key', WP.dedupeKey(31.1231, 102.8761) !== WP.dedupeKey(31.1241, 102.8761))
  check('coordName 文案', WP.coordName(31.0632, 102.9085) === '北纬 31.06 · 东经 102.91', WP.coordName(31.0632, 102.9085))
}

section('4. fromGpx：parseGpx → TrackSet 组装')
{
  const set = WP.fromGpx(fakeParsed(true), '四姑娘山大峰.gpx')
  check('组名去 .gpx 后缀', set.name === '四姑娘山大峰')
  check('wt- 前缀 id + importedAt', /^wt-/.test(set.id) && !!set.importedAt)
  check('distanceKm/ascentM 取顶层（恒为数字）', set.stats.distanceKm === 21.3 && set.stats.ascentM === 1200)
  check('hasEle 取 stats.hasElevation（字段名映射：parseGpx 的 hasElevation → 组的 hasEle）', set.stats.hasEle === true)
  check('hasTime 遍历 points 判定（stats 不给）', set.stats.hasTime === true)
  check('count = 点数', set.stats.count === 3)
  check('每点生成稳定 id（窗口缓存按点判定）', set.points.every(p => /^wp-/.test(p.id))
    && new Set(set.points.map(p => p.id)).size === 3)
  check('ele 四舍五入 + eleSource=gpx', set.points[0].ele === 4200 && set.points[0].eleSource === 'gpx')
  check('time 透传不丢失（§5.4 抵达日程的原料）', set.points[2].time === '2026-09-02T09:30:00+08:00')
  check('无名点保留空串（查询页兜底起点/终点）', set.points[1].name === '')

  const noTime = WP.fromGpx(fakeParsed(false), 'x.gpx')
  check('无时间戳轨迹 hasTime=false', noTime.stats.hasTime === false)

  check('非法 parsed 返回 null', WP.fromGpx({ ok: false }, 'x.gpx') === null && WP.fromGpx(null, 'x.gpx') === null)
  check('单点不成组', WP.fromGpx({ ok: true, points: [fakeParsed(true).points[0]], distanceKm: 0, ascentM: 0, stats: {} }, 'x.gpx') === null)
}

section('5. 分享降精度（P3 §5.3 决策 (b)）')
{
  const p = WP.sharePointPayload(31.06321, 102.90856)
  check('lat/lng 降到 3dp', p.lat === 31.063 && p.lng === 102.909, JSON.stringify(p))
  check('与原值确有差异（精度真的降了）', p.lat !== 31.06321 && p.lng !== 102.90856)
  const sameGrid = WP.sharePointPayload(31.0634, 102.9089)
  check('3dp 网格内两点落同一分享坐标（百米级，足够定位山头）',
    sameGrid.lat === p.lat && sameGrid.lng === p.lng)
}

section('6. 手动 WGS 入库链路（调用方转换后存储）')
{
  // hub 的约定：勾选 WGS-84 时先用 gpx.wgsToGcj 转换再入库，库存只有 GCJ
  const st = fakeStorage()
  const wp = WP.createWatchPoints(st)
  const gcj = gpx.wgsToGcj(30.9394, 103.4901)
  const r = wp.savePoint({ name: 'WGS 转入', lat: gcj.lat, lng: gcj.lng, ele: null, eleSource: 'manual' })
  check('入库的是转换后的 GCJ 值，不是 WGS 原值',
    r.ok && r.point.lat === gcj.lat && r.point.lng === gcj.lng
    && (r.point.lat !== 30.9394 || r.point.lng !== 103.4901))
  check('GCJ 值可被 gpx.gcjToWgs 还原（链路自洽）', (() => {
    const back = gpx.gcjToWgs(r.point.lat, r.point.lng)
    return Math.abs(back.lat - 30.9394) < 1e-4 && Math.abs(back.lng - 103.4901) < 1e-4
  })())
  const bad = wp.savePoint({ name: 'x', lat: 'abc', lng: NaN, ele: null, eleSource: 'manual' })
  check('非数坐标拒绝', bad.ok === false && bad.reason === 'invalid')
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
