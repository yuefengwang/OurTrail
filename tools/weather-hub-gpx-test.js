// 天气 Hub GPX 预览的删除/恢复/应用行为门：node tools/weather-hub-gpx-test.js
//
// 用户诉求（2026-10-21）：导入 GPX 后，解析出的节点要能删掉不需要的再存。
// 关键回归点不是按钮本身，而是**保存必须用预览里实际保留的点**：
// 旧 onGpxApply 直接把 _gpxParsed 交给 WP.fromGpx，删了也会原样存回全部节点。
// 判据走真页面配置 + 真 handler + 真 fromGpx/saveTrack（wx storage 桩），不是镜像逻辑。
'use strict'
const fs = require('fs')
const path = require('path')
const PAGE_PATH = require.resolve('../miniprogram/pages/weather-hub/weather-hub.js')
const DRAFT_PATH = require.resolve('../miniprogram/utils/draft.js')
const WP = require('../miniprogram/utils/watch-points')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra === undefined ? '' : '（' + extra + '）')) }
}
function section(t) { console.log('== ' + t + ' ==') }

function makeWx() {
  const store = {}
  const rec = { toasts: [] }
  global.wx = {
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push(String((o && o.title) || '')),
  }
  return { store, rec }
}
function loadPage() {
  global.Page = cfg => { global.__HUB_CFG = cfg }
  delete require.cache[PAGE_PATH]
  delete require.cache[DRAFT_PATH]
  require(PAGE_PATH)
  return global.__HUB_CFG
}
function makePage(cfg) {
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  return page
}
function sampleParsed() {
  return {
    ok: true,
    points: [
      { name: '起点', coordinates: { lat: 30.1, lng: 103.1 }, ele: 900, time: null },
      { name: '垭口', coordinates: { lat: 30.2, lng: 103.2 }, ele: 1800, time: '2020-05-01T02:00:00.000Z' },
      { name: '终点', coordinates: { lat: 30.3, lng: 103.3 }, ele: 1200, time: null },
    ],
    distanceKm: 12.3,
    ascentM: 900,
    stats: { hasElevation: true },
  }
}
// 对齐 onImportGpx 成功分支写进 data 的形状
function seed(page) {
  const parsed = sampleParsed()
  page._gpxParsed = parsed
  page.data.gpxMeta = {
    fileName: 't.gpx',
    count: parsed.points.length,
    distanceKm: parsed.distanceKm,
    ascentM: parsed.ascentM,
    hasElevation: true,
    hasTime: true,
  }
  page.data.gpxPoints = parsed.points
  return parsed
}
const removeEv = index => ({ currentTarget: { dataset: { index } } })
const namesOf = list => list.map(p => p.name)

section('§1 删除只动预览点集，不碰原始解析结果')
{
  makeWx()
  const cfg = loadPage()
  const page = makePage(cfg)
  const parsed = seed(page)

  page.onGpxRemove(removeEv(1))
  check('删掉中间节点后预览只剩起点/终点',
    JSON.stringify(namesOf(page.data.gpxPoints)) === JSON.stringify(['起点', '终点']),
    JSON.stringify(namesOf(page.data.gpxPoints)))
  check('「解析出 N 个」仍按原始解析数计（3），不会被删除改成 2（头部不撒谎的前提）',
    page.data.gpxMeta.count === 3, String(page.data.gpxMeta.count))
  check('原始解析结果原样保留（恢复全部的依据）',
    parsed.points.length === 3 && page._gpxParsed === parsed)
  check('删掉唯一带时刻的节点后，「含时刻」翻成 false',
    page.data.gpxMeta.hasTime === false, String(page.data.gpxMeta.hasTime))

  page.onGpxRemove(removeEv(99))
  check('越界下标是 no-op（不抛错、不改数据）',
    page.data.gpxPoints.length === 2, String(page.data.gpxPoints.length))
  page.onGpxRemove(removeEv(-1))
  check('负数下标同样是 no-op', page.data.gpxPoints.length === 2)
}

section('§2 恢复全部')
{
  makeWx()
  const cfg = loadPage()
  const page = makePage(cfg)
  seed(page)
  page.onGpxRemove(removeEv(0))
  page.onGpxRemove(removeEv(0))
  check('删到只剩 1 个（用于下一条的边界）', page.data.gpxPoints.length === 1)
  page.onGpxReset()
  check('恢复后回到 3 个且顺序不变',
    JSON.stringify(namesOf(page.data.gpxPoints)) === JSON.stringify(['起点', '垭口', '终点']),
    JSON.stringify(namesOf(page.data.gpxPoints)))
  check('恢复后「含时刻」跟着回来', page.data.gpxMeta.hasTime === true)
}

section('§3 保存用预览保留的点（旧实现删了也会全存）')
{
  const env = makeWx()
  const cfg = loadPage()
  const page = makePage(cfg)
  seed(page)
  page.onGpxRemove(removeEv(1))
  page.onGpxApply()

  const tracks = env.store[WP.TRACKS_KEY] || []
  check('确实存下一组轨迹', tracks.length === 1, 'tracks=' + tracks.length)
  const saved = tracks[0] || { points: [], stats: {} }
  check('保存的点集是删除后的 2 个点（垭口不再出现）',
    saved.points.length === 2 && saved.points.every(p => p.name !== '垭口'),
    JSON.stringify(namesOf(saved.points)))
  check('stats.count 用保存后的点数（2），不是解析数（3）',
    saved.stats.count === 2, String(saved.stats.count))
  check('全程里程/爬升仍取整条轨迹的解析值（删点不伪造路线变短）',
    saved.stats.distanceKm === 12.3 && saved.stats.ascentM === 900,
    JSON.stringify(saved.stats))
  check('stats.hasTime 按保存后的点集重算（剩余点无时刻 ⇒ false）',
    saved.stats.hasTime === false, String(saved.stats.hasTime))
  check('保存成功后关闭预览并提示真实点数',
    page.data.gpxOpen === false && env.rec.toasts[env.rec.toasts.length - 1] === '已导入 2 个节点',
    JSON.stringify(env.rec.toasts))
}

section('§4 少于 2 点不可保存')
{
  const env = makeWx()
  const cfg = loadPage()
  const page = makePage(cfg)
  seed(page)
  page.onGpxRemove(removeEv(0))
  page.onGpxRemove(removeEv(0))
  page.onGpxApply()
  check('只留 1 个点时一组也不存', (env.store[WP.TRACKS_KEY] || []).length === 0)
  check('给出可行动的原因，而不是静默 return',
    env.rec.toasts[env.rec.toasts.length - 1] === '至少保留 2 个节点才能存为轨迹点组',
    JSON.stringify(env.rec.toasts))
  check('失败后原始解析结果仍在，用户还能恢复', !!page._gpxParsed && page._gpxParsed.points.length === 3)
}

section('§5 模板接线（按钮存在且三层一致）')
{
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'weather-hub', 'weather-hub.wxml'), 'utf8')
  const start = wxml.indexOf('title="导入 GPX 轨迹"')
  const end = wxml.indexOf('</overlay>', start)
  const block = start >= 0 && end > start ? wxml.slice(start, end) : ''
  check('GPX 预览块存在（判据输入不是空串）', block.length > 0)
  check('每个节点行有删除控件：catchtap=onGpxRemove + data-index 传当前下标',
    /catchtap="onGpxRemove"/.test(block) && /data-index="\{\{index\}\}"/.test(block))
  check('删除后出现「恢复全部节点」入口（误删有退路）',
    /bindtap="onGpxReset"/.test(block) && /恢复全部节点/.test(block))
  check('保留数 <2 时主按钮 disabled 且 bindtap 置空（三层一致的前两层）',
    /gpxPoints\.length >= 2 \? '' : 'disabled'/.test(block) &&
    /gpxPoints\.length >= 2 \? 'onGpxApply' : ''/.test(block))
  check('头部在删除后显示「保留 N 个」', /'，保留 ' \+ gpxPoints\.length \+ ' 个'/.test(block))
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
