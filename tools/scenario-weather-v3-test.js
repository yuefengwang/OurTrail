// 天气页 V3 真实装配门：真组件配置 + 真 handler + 真 utils（wx 与云调用用桩）。
// 运行：node tools/scenario-weather-v3-test.js
//
// 不镜像页面逻辑：直接 require components/weather-detail/weather-detail.js 的 Component() 配置，
// 用桩 wx + 桩 api 驱动 onLoad 之后真实会走的那串方法。判据只读 data 与 stub 记录。
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const COMP = path.join(MP, 'components', 'weather-detail', 'weather-detail.js')
const API = require.resolve(path.join(MP, 'utils', 'api.js'))
const DRAFT = require.resolve(path.join(MP, 'utils', 'draft.js'))
const V3 = require(path.join(MP, 'utils', 'weather-v3'))
const V = require(path.join(MP, 'utils', 'weather-v3-view'))
const HSV = require(path.join(MP, 'utils', 'weather-v3-hourly-svg'))
// 列宽由可用宽度反推：本套件窗口 390 ⇒ 图宽 350 ⇒ cell = floor(301/24×100)/100 = 12.54
const FIT_CELL = HSV.cellFor(350)

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; return }
  failed++
  console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
function section(t) { console.log('\n§ ' + t) }

/* ---------- wx 桩 ---------- */
const store = {}
const rec = { toasts: [], scrolls: [], dispatches: [], weatherCalls: [], modal: null }
function installWx() {
  global.wx = {
    getStorageSync: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: k => { delete store[k] },
    showToast: o => rec.toasts.push(String((o && o.title) || '')),
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }),
    pageScrollTo: o => rec.scrolls.push(o),
    showModal: o => { rec.modal = o },
    createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec: () => {} }) }) }) }),
  }
}

/* ---------- 载荷夹具 ---------- */
function days(from, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({ date: V3.addDays(from, i), label: V3.shortDate(V3.addDays(from, i)), code: i === 1 ? 61 : 3, min: 2 + i, max: 9 + i })
  }
  return out
}
function series(from, nDays) {
  const out = []
  for (let i = 0; i < nDays * 24; i++) {
    const d = V3.addDays(from, Math.floor(i / 24))
    const h = i % 24
    out.push({
      t: V3.pad(h) + ':00', d, temp: 3 + Math.sin(h / 4) * 2, feels: 1.5,
      pop: 20 + h, precip: h > 12 ? 0.8 : 0, showers: 0, code: 3,
      wind: 9 + (h % 4), gust: 16 + (h % 6), windDir: 225, rh: 68, pressure: 880,
      dewPoint: 0, cloud: { total: 55, low: 45, mid: 60, high: 30 }, uv: 2, visibility: 18,
    })
  }
  return out
}
function cloudLevels(list) {
  const levels = []
  ;[925, 850, 700].forEach((p, i) => {
    levels.push({
      pressure: p,
      altitudes: list.map(() => 1500 + i * 1600),
      cloudCover: list.map((_, k) => 40 + ((k + i) % 6) * 6),
    })
  })
  return { times: list.map(h => h.d + 'T' + h.t), levels, unit: { altitude: 'm ASL', cloudCover: '%' } }
}
function payload(from) {
  const s = series(from, 7)
  return {
    status: 'ready', updatedAt: from + 'T07:00:00+08:00', provider: { label: 'Open-Meteo' },
    pointElevation: 3210, days: days(from, 7), series: s, cloudLevels: cloudLevels(s),
  }
}

const PLACE = {
  id: 'route:r1', kind: 'route', name: '格聂两日路线', lat: 29.8, lng: 99.7, routeId: 'r1', activityDate: null,
  nodes: [
    { name: '山谷起点', lat: 29.8, lng: 99.7, altitude: 3200, eleSource: 'gpx' },
    { name: '观景点', lat: 29.81, lng: 99.71, altitude: 3800, eleSource: 'gpx' },
    { name: '溪畔营地', lat: 29.82, lng: 99.72, altitude: 3500, eleSource: 'gpx' },
    { name: '北侧垭口', lat: 29.83, lng: 99.73, altitude: 4300, eleSource: 'gpx' },
    { name: '下撤终点', lat: 29.84, lng: 99.74, altitude: 3100, eleSource: 'gpx' },
  ],
}
const D0 = '2026-10-29'
const PLAN = {
  id: 'plan-1', routeId: 'r1', name: '格聂 · 周末两日徒步', startDate: D0,
  stops: [
    { nodeIndex: 0, day: 1, time: '08:00' },
    { nodeIndex: 1, day: 1, time: '13:30' },
    { nodeIndex: 2, day: 1, time: '17:00' },
    { nodeIndex: 2, day: 2, time: '08:00' },
    { nodeIndex: 3, day: 2, time: '11:00' },
  ],
  visibility: 'private', isOwner: true, sharedBy: '', sharedWith: [], sharedCount: 0, updatedAt: D0 + 'T00:00:00+08:00',
}

/* ---------- 组件装载 ---------- */
function loadComponent(opts) {
  global.Component = cfg => { global.__WD = cfg }
  delete require.cache[COMP]
  require(COMP)
  const cfg = global.__WD
  const data = JSON.parse(JSON.stringify(cfg.data || {}))
  Object.keys(cfg.properties || {}).forEach(k => {
    const p = cfg.properties[k]
    if (!(k in data)) data[k] = p && Object.prototype.hasOwnProperty.call(p, 'value') ? p.value : null
  })
  const inst = Object.assign({}, cfg.methods)
  inst.lifetimes = cfg.lifetimes || {}
  inst.observers = cfg.observers || {}
  inst.data = data
  inst.properties = cfg.properties
  inst.events = []
  inst.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach(k => {
      if (k.indexOf('.') === -1) { this.data[k] = patch[k]; return }
      const parts = k.split('.')
      let cur = this.data
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = cur[parts[i]] || {}
      cur[parts[parts.length - 1]] = patch[k]
    })
    if (cb) setImmediate(cb)
  }
  inst.triggerEvent = function (name, detail) { this.events.push({ name, detail }) }
  if (opts && opts.fresh) {
    // fresh = 组件刚被创建：只跑生命周期自己的初始化，实例字段一律不预置。
    // 用于复现「属性 observer 先于 attached」那条真实路径（见 §7）。
    if (inst.lifetimes.created) inst.lifetimes.created.call(inst)
  } else {
    // 真实生命周期里的实例字段初始化（与 attached 保持一致）
    inst._token = 0
    inst._routeToken = 0
    inst._plans = []
    inst._planRevision = null
    inst._nodeWeather = {}
    inst._scrollLeft = 0
    inst._width = 0
  }
  return inst
}

async function settle(ms) {
  const until = Date.now() + (ms || 200)
  while (Date.now() < until) await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
}

function installApi(opts) {
  const api = require(API)
  const delay = (opts && opts.weatherDelayMs) || 0
  let failsLeft = (opts && opts.failTimes) || 0
  api.getWeatherByPoint = (lat, lng, date) => {
    rec.weatherCalls.push({ lat, lng, date })
    if (opts && opts.failWeather) return Promise.reject(new Error('网络不太稳，请稍后再试。'))
    if (failsLeft > 0) { failsLeft--; return Promise.reject(new Error('网络不太稳，请稍后再试。')) }
    if (opts && opts.outOfRange) return Promise.resolve({ status: 'out_of_range' })
    const out = payload(date || D0)
    // 真网络不会同步返回：回包一定晚于 attached（§7 靠这个延迟复现"回调被丢"）
    if (!delay) return Promise.resolve(out)
    return new Promise(r => setTimeout(() => r(out), delay))
  }
  api.read = () => Promise.resolve({
    view: { kind: 'plans', plans: opts && opts.noPlans ? [] : [PLAN] },
    revision: 3,
    now: D0 + 'T00:00:00+08:00',
  })
  api.dispatch = (p, revision, requestId) => {
    rec.dispatches.push({ payload: p, revision, requestId })
    return Promise.resolve({ targetIds: ['plan-1'], replayed: false, revision: 4 })
  }
  api.toast = msg => rec.toasts.push(String(msg))
  api.errorText = e => (e && e.message) || '失败'
  return api
}

/* ================================================================== */
async function main() {
  installWx()
  delete require.cache[API]
  delete require.cache[DRAFT]
  installApi()
  await settle(20)

  section('§1 首屏装配（真实组件 + 真 utils）')
  const page = loadComponent()
  page.data.place = PLACE
  page.data.initial = { node: 0, date: D0, hour: 13, period: 24, tab: 'hourly' }
  page.data.planId = ''
  page.lifetimes.attached.call(page)
  await settle(300)

  check('取数成功 ⇒ ready（不是 loading 卡住）', page.data.ready === true && page.data.loading === false, page.data.errorCode)
  check('逐时图 24 列 / 一屏放得下（列宽由宽度反推，不是 42px 固定列）',
    page.data.hourlyColumns === 24 && page.data.hourlyWidth === FIT_CELL * 24 && page.data.hourlyScrolls === false,
    [page.data.hourlyColumns, page.data.hourlyWidth, page.data.hourlyScrolls])
  check('逐时图是 data:image/svg+xml（图片通道，不是内联 svg）',
    String(page.data.hourlySrc).indexOf('data:image/svg+xml') === 0, String(page.data.hourlySrc).slice(0, 30))
  check('读数取的是 13:00 的那一小时', page.data.readout.time === '13:00', page.data.readout.time)
  check('读数温度取整且非空', /^-?\d+$/.test(String(page.data.readout.temp)), page.data.readout.temp)
  check('详细读数 6 项齐全', page.data.readout.detailRows.length === 6)
  check('四视图 tab 四个，逐时选中', page.data.tabs.length === 4 && page.data.tabs[0].selected)
  check('路线地点不禁用沿途 tab', page.data.tabs.filter(t => t.key === 'route')[0].disabled === false)
  check('日期条用计划口径（D1/D2）', page.data.dayStripKind === 'plan' && page.data.dayStrip.length === 2,
    page.data.dayStripKind + '/' + page.data.dayStrip.length)
  check('计划已读到并装配进行程流', page.data.route.hasPlan === true && page.data.route.planName === PLAN.name)
  check('行程流按 D1 出 3 个节点', page.data.route.stops.length === 3, page.data.route.stops.map(s => s.name))
  check('抵达时刻按计划显示（08:00 / 13:30 / 17:00）',
    page.data.route.stops.map(s => s.time).join(',') === '08:00,13:30,17:00', page.data.route.stops.map(s => s.time))
  check('逐节点取数：首屏只取当前点一次（进入沿途才逐节点取，省请求）',
    rec.weatherCalls.length === 1, rec.weatherCalls.length)
  check('云层图已装配（生产统一图）', page.data.cloudMissing === false && !!page.data.cloud && page.data.cloud.src.indexOf('data:image/svg+xml') === 0)
  check('云图读数行有内容（点选前默认选中当前小时）', !!page.data.cloudSel.r1 && page.data.cloudSel.r1.indexOf('13:00') === 0, page.data.cloudSel.r1)
  check('日月视图：日出日落与 5 条客观时刻都在',
    page.data.sky.rise !== '—' && page.data.sky.set !== '—' && page.data.sky.events.length === 5,
    [page.data.sky.rise, page.data.sky.set, page.data.sky.events.length])
  check('天相三卡（云海 / 星空·银河 / 彩虹·晨昏光染）', page.data.sky.cards.length === 3, page.data.sky.cards.map(c => c.title))
  check('海拔出处带「此点」主语', page.data.elevLabel.indexOf('此点') === 0, page.data.elevLabel)
  check('未取数的节点不冒充「已取到」，也不谎报失败',
    page.data.route.stops[1].weather === null && page.data.route.stops[1].weatherText === '点开这一小时查看天气',
    page.data.route.stops[1])

  section('§1b 进入沿途 ⇒ 逐节点取数')
  page.onTab({ currentTarget: { dataset: { key: 'route' } } })
  await settle(500)
  check('进入沿途后，每个有抵达时刻的节点各取一次（1 + 3）', rec.weatherCalls.length === 4, rec.weatherCalls.length)
  check('节点坐标来自节点自己（观景点 29.81/99.71）',
    rec.weatherCalls.some(c => Math.abs(c.lat - 29.81) < 1e-9 && Math.abs(c.lng - 99.71) < 1e-9), rec.weatherCalls.slice(1))
  check('节点天气落地（温度/现象/概率/风速）',
    (() => {
      const s = page.data.route.stops[1]
      return !!s.weather && /°$/.test(s.weather.temp) && s.weather.wind.indexOf('km/h') !== -1
    })(), page.data.route.stops[1])

  section('§2 交互：视图 / 小时 / 时长 / 日期 / 节点')
  page.onTab({ currentTarget: { dataset: { key: 'cloud' } } })
  check('切到云层：tabs[1] 选中', page.data.tabs[1].selected && !page.data.tabs[0].selected)
  page.onStep({ currentTarget: { dataset: { step: 1 } } })
  check('前进一步 ⇒ 14:00', page.data.readout.time === '14:00' && page.data.cursor === 14, page.data.readout.time)
  check('小时高亮同步（14 列 selected）',
    page.data.hourCols.filter(c => c.selected).length === 1 &&
    page.data.hourCols.filter(c => c.selected)[0].i === 14, page.data.hourCols.filter(c => c.selected)[0])
  check('云图十字线读数跟着走（14:00）', page.data.cloudSel.r1.indexOf('14:00') === 0, page.data.cloudSel.r1)
  page.onSliderChange({ detail: { value: 20 } })
  check('滑块落点 ⇒ 20:00', page.data.readout.time === '20:00', page.data.readout.time)
  const beforeJump = page.data.cursor
  page.onPeriod({ currentTarget: { dataset: { value: 48 } } })
  await settle(60)
  check('切 48h：列数 48 / 同一列宽 ⇒ 图比视口宽（横向滚动）',
    page.data.hourlyColumns === 48 && page.data.hourlyWidth === FIT_CELL * 48 && page.data.hourlyScrolls === true,
    [page.data.hourlyColumns, page.data.hourlyWidth, page.data.hourlyScrolls])
  check('切时长保留当前时刻（游标仍指着同一个小时）', page.data.cursor === beforeJump, page.data.cursor)
  const nextDay = V3.addDays(D0, 1)
  page.onDay({ currentTarget: { dataset: { date: nextDay } } })
  await settle(120)
  check('换日期 ⇒ 选中日跟着变、时刻保持 20 点', page.data.selectedDate === nextDay && page.data.readout.time === '20:00',
    page.data.selectedDate + ' ' + page.data.readout.time)
  check('行程流换到 D2（同营地 08:00 + 垭口 11:00）',
    page.data.route.stops.length === 2 && page.data.route.stops[0].time === '08:00',
    page.data.route.stops.map(s => s.time))
  page.onNodePick({ currentTarget: { dataset: { index: 1 } } })
  await settle(120)
  check('换节点 ⇒ 页头副行换成节点名', page.data.placeSub.indexOf('观景点') !== -1, page.data.placeSub)
  check('换节点沿用日期与时刻', page.data.selectedDate === nextDay && page.data.readout.time === '20:00')

  section('§3 计划编辑：本地校验先拦、通过后真提交')
  rec.dispatches.length = 0
  page.openEdit()
  check('打开编辑弹层并带出草稿', page.data.planOpen === true && !!page.data.planDraft && page.data.planDraft.id === 'plan-1')
  const badDraft = Object.assign({}, page.data.planDraft, {
    input: Object.assign({}, page.data.planDraft.input, {
      stops: [{ nodeIndex: 0, day: 1, time: '12:00' }, { nodeIndex: 1, day: 1, time: '09:00' }],
    }),
  })
  page.onPlanConfirm({ detail: { id: badDraft.id, input: badDraft.input } })
  check('同日逆序被本地拦下（不白等一次往返）', page.data.planError.indexOf('先于前一站') !== -1, page.data.planError)
  check('被拦时没有发命令', rec.dispatches.length === 0, rec.dispatches.length)
  const goodInput = Object.assign({}, page.data.planDraft.input, { name: '格聂 · 改过的计划' })
  page.onPlanConfirm({ detail: { id: page.data.planDraft.id, input: goodInput } })
  await settle(120)
  check('合法草稿发出 plan.update', rec.dispatches.length === 1 && rec.dispatches[0].payload.type === 'plan.update',
    rec.dispatches.map(d => d.payload.type))
  check('命令带 planId 与读到的 revision', rec.dispatches[0].payload.planId === 'plan-1' && rec.dispatches[0].revision === 3,
    rec.dispatches[0])
  check('保存成功后关闭弹层并提示', page.data.planOpen === false && rec.toasts.length >= 1, rec.toasts)
  check('通知宿主刷新计划（bind:planchange）',
    page.events.some(e => e.name === 'planchange'), page.events.map(e => e.name))

  section('§4 分享：只提交名单，不改别的')
  rec.dispatches.length = 0
  page.onShareOpen()
  check('打开分享弹层', page.data.shareOpen === true)
  page.onPlanShare({ detail: { sharedWith: ['o-friend'] } })
  await settle(120)
  check('分享发出 plan.update + sharedWith',
    rec.dispatches.length === 1 && rec.dispatches[0].payload.input.sharedWith[0] === 'o-friend',
    rec.dispatches[0] && rec.dispatches[0].payload.input.sharedWith)
  check('分享不改名称与出发日',
    rec.dispatches[0].payload.input.name === PLAN.name && rec.dispatches[0].payload.input.startDate === D0)

  section('§5 单点：沿途禁用、说明不虚构')
  const point = {
    id: 'point:p1', kind: 'point', name: '冷杉坪', lat: 30.1, lng: 103.1, routeId: '', nodes: [
      { name: '冷杉坪', lat: 30.1, lng: 103.1, altitude: null, eleSource: null },
    ],
  }
  page.data.place = point
  page.data.initial = { node: 0, date: D0, hour: 9, period: 24, tab: 'route' }
  page.lifetimes.attached.call(page)
  await settle(250)
  check('单点强制回到逐时（不许停在沿途）', page.data.tabs[0].selected, page.data.tabs.map(t => t.key + ':' + t.selected))
  check('单点禁用沿途 tab（不是隐藏）', page.data.tabs.filter(t => t.key === 'route')[0].disabled === true)
  check('单点日期条回到 5 日卡', page.data.dayStripKind === 'point' && page.data.dayStrip.length === 5)
  check('无海拔：此点海拔标注为待确认，不印 0', page.data.placeSub.indexOf('海拔待确认') !== -1, page.data.placeSub)

  section('§6 超范围与失败：不冒充数据')
  const p2 = loadComponent()
  p2.data.place = PLACE
  p2.data.initial = { node: 0, date: D0, hour: 13, period: 24, tab: 'hourly' }
  installApi({ outOfRange: true })
  p2.lifetimes.attached.call(p2)
  await settle(200)
  check('超出预报范围 ⇒ outOfRange 状态（保留行程，不画假图）',
    p2.data.errorCode === 'outOfRange' && p2.data.hourlySrc === '', p2.data.errorCode)

  const p3 = loadComponent()
  p3.data.place = PLACE
  p3.data.initial = { node: 0, date: '2026-01-01', hour: 13, period: 24, tab: 'hourly' }
  installApi({ failWeather: true })
  p3.lifetimes.attached.call(p3)
  // 三次尝试共 1.2s + 2.6s；这里只验第一次失败后不是立刻报错（仍在重试窗口内）
  await settle(120)
  check('瞬时失败不立刻甩错误墙（先进重试窗口，loading 仍在）',
    p3.data.errorCode === '' && p3.data.loading === true, p3.data.errorCode)
  check('重试窗口里给出进度：第 2 次尝试 / 共 3 次',
    p3.data.retryNote === '网络不太稳，正在重试（第 2 次尝试，共 3 次）…', p3.data.retryNote)
  check('进度句不谎报重试次数（三次是「查询」不是「重试」）',
    p3.data.retryNote.indexOf('次尝试') !== -1 && p3.data.retryNote.indexOf('次重试') === -1, p3.data.retryNote)
  await settle(1400)
  check('第二次失败后进度继续推进（第 3 次尝试）',
    p3.data.retryNote === '网络不太稳，正在重试（第 3 次尝试，共 3 次）…', p3.data.retryNote)
  await settle(2900)
  check('三次都没连上 ⇒ 落到错误态，进度随加载态一起消失',
    p3.data.loading === false && p3.data.errorCode === 'error' && p3.data.retryNote === '',
    { loading: p3.data.loading, code: p3.data.errorCode, note: p3.data.retryNote })
  p3.lifetimes.detached.call(p3)

  // 重试后成功：进度句必须随之消失，不然数据已经到齐、屏上还写着「正在重试」
  installApi({ failTimes: 1 })
  const p6 = loadComponent()
  p6.data.place = PLACE
  p6.data.initial = { node: 0, date: D0, hour: 13, period: 24, tab: 'hourly' }
  p6.lifetimes.attached.call(p6)
  await settle(120)
  const noteDuringRetry = p6.data.retryNote
  await settle(1400)
  // 有效性门：没有这条，下面「进度消失」可能本来就没出现过
  check('失败一次后进度确实出现过', noteDuringRetry === '网络不太稳，正在重试（第 2 次尝试，共 3 次）…', noteDuringRetry)
  check('重试成功 ⇒ 正常出图且进度清零',
    p6.data.retryNote === '' && p6.data.ready === true && p6.data.loading === false,
    { note: p6.data.retryNote, ready: p6.data.ready, loading: p6.data.loading })
  p6.lifetimes.detached.call(p6)

  section('§6b 装配抛错：loading 必须结束')
  // 回包成功、但装配层抛错时，旧实现没有 catch ⇒ 未处理的 rejection，页面永远停在加载态。
  installApi()
  const p5 = loadComponent()
  p5.data.place = PLACE
  p5.data.initial = { node: 0, date: D0, hour: 13, period: 24, tab: 'hourly' }
  // 只让第一次装配抛错：后续（计划刷新触发的 rebuild）照常返回，便于观察抛错后停在哪个状态
  let rebuilds = 0
  p5.rebuild = () => { if (++rebuilds === 1) throw new Error('装配炸了') }
  p5.lifetimes.attached.call(p5)
  await settle(200)
  check('装配层抛错 ⇒ 落到错误态（不是永久 loading）',
    p5.data.loading === false && p5.data.errorCode === 'error',
    { loading: p5.data.loading, code: p5.data.errorCode })
  p5.lifetimes.detached.call(p5)

  section('§7 初始化顺序：属性先于 attached 到达')
  // 父级 weather-hub 在同一次 setData 里给出 screen:'detail' + place + initial ⇒ 组件一创建属性就在，
  // 属性 observer 先跑、attached 后跑；而回包一定比 attached 慢。旧实现把实例字段初始化留在
  // attached（_token 置零、ctx 置空），一次已经发出的取数就被当成过期丢弃 —— 永久「正在查询天气」。
  installApi({ weatherDelayMs: 150 })
  const beforeCalls = rec.weatherCalls.length
  const p4 = loadComponent({ fresh: true })
  p4.data.place = PLACE
  p4.data.initial = { node: 0, date: D0, hour: 13, period: 24, tab: 'hourly' }
  p4.observers.place.call(p4)
  p4.observers.initial.call(p4)
  await settle(40)                 // attached 发生在回包到达之前
  const issuedBeforeAttach = rec.weatherCalls.length - beforeCalls
  p4.lifetimes.attached.call(p4)
  await settle(400)
  // 有效性门：这条路径必须真的在 attached 之前发出了取数，否则下面那条断言等于没测
  check('属性到达（attached 之前）已发出取数，且两个 observer 只发一次',
    issuedBeforeAttach === 1, issuedBeforeAttach)
  check('属性先到、回包后到 ⇒ 仍然出图（不是永久加载）',
    p4.data.ready === true && p4.data.loading === false && p4.data.errorCode === '',
    { ready: p4.data.ready, loading: p4.data.loading, code: p4.data.errorCode })
  check('读数来自这一次取数（选中 13:00 的那一小时）', p4.data.readout.time === '13:00', p4.data.readout.time)
  p4.lifetimes.detached.call(p4)

  section('§8 页头占位：取数之前这一行也要说得出话（地点侧字段不依赖天气）')
  // 缺陷本体：resetContext 只写 placeName，placeSub 只在成功装配时产出 ⇒
  // 「正在查询」与「这次没取到天气」两态下，页头节点行长成「图钉 + 空白 + 箭头」（真机截图抓到），
  // 节点弹层还是个空列表。占位句全部取自地点自身（名字 / 坐标 / 节点海拔），一个天气读数都不参与。
  installApi({ weatherDelayMs: 150 })
  const ph = loadComponent()
  ph.data.place = PLACE
  ph.data.initial = { node: 0, date: D0, hour: 13, period: 24, tab: 'hourly' }
  ph.lifetimes.attached.call(ph)
  await settle(40)
  check('取数在途：loading 为真，节点行已有完整一句话（旧形态此时是空串）',
    ph.data.loading === true && ph.data.placeSub === '山谷起点 · 3,200 m', { loading: ph.data.loading, sub: ph.data.placeSub })
  check('取数在途：主行用地点名，不回落成「选择地点」（那是屏 1 的入口文案）',
    ph.data.placeName === '格聂两日路线', ph.data.placeName)
  check('取数在途：节点弹层已经能打开（5 项、只选中第 1 项）',
    ph.data.nodeOptions.length === 5 && ph.data.nodeOptions[0].selected === true &&
      ph.data.nodeOptions.slice(1).every(o => o.selected === false),
    ph.data.nodeOptions.map(o => o.selected))
  check('取数在途：isPoint 就位（路线 ⇒ 节点行带箭头）', ph.data.isPoint === false, ph.data.isPoint)
  check('占位句不含任何天气派生事实（°C / 降水 / 云量 / 晴）', !/°C|降水|云量|晴/.test(ph.data.placeSub), ph.data.placeSub)
  await settle(400)
  check('成功装配后与占位逐字相同（同一出处，不是两份文案在赛跑）',
    ph.data.ready === true && ph.data.placeSub === '山谷起点 · 3,200 m' &&
      ph.data.placeName === '格聂两日路线' && ph.data.nodeOptions.length === 5,
    { ready: ph.data.ready, sub: ph.data.placeSub })
  ph.lifetimes.detached.call(ph)

  installApi({ failWeather: true })
  const pf = loadComponent()
  pf.data.place = PLACE
  // 换一个没被前面用例写进本地缓存的日期：同地点同日期会被缓存软降级接住（那是另一条正确路径，
  // 由 weather-resilience 套件钉），这里要的是**真错误态**。
  pf.data.initial = { node: 2, date: '2026-11-03', hour: 13, period: 24, tab: 'hourly' }
  pf.lifetimes.attached.call(pf)
  await settle(120)
  await settle(1400)
  await settle(2900)
  check('三次失败 ⇒ 错误态，但这一行仍然是那句话（缺的是天气，不是地点）',
    pf.data.errorCode === 'error' && pf.data.placeSub === '溪畔营地 · 3,500 m',
    { code: pf.data.errorCode, sub: pf.data.placeSub })
  pf.onNodePick({ currentTarget: { dataset: { index: '1' } } })
  await settle(20)
  check('错误态换节点：这一行与弹层选中位跟着走（rebuild 静默返回时也不留旧值）',
    pf.data.placeSub === '观景点 · 3,800 m' && pf.data.nodeOptions[1].selected === true &&
      pf.data.nodeOptions[2].selected === false,
    { sub: pf.data.placeSub, sel: pf.data.nodeOptions.map(o => o.selected) })
  pf.lifetimes.detached.call(pf)

  // 反例：地点没有名字 / 节点没有海拔 ⇒ 不许印成「0 m」，也不许留悬空分隔符
  const bare = { id: 'route:b', kind: 'route', name: '', lat: null, lng: null, nodes: [{ name: '', lat: null, lng: null, altitude: null }] }
  check('无海拔 ⇒ 印「海拔待确认」而不是 0 m',
    V.placeSubText(bare, bare.nodes[0]) === '海拔待确认', V.placeSubText(bare, bare.nodes[0]))
  check('无地点名 ⇒ 主行说「未命名地点」（不冒充「还没选」）', V.placeNameText(bare) === '未命名地点', V.placeNameText(bare))
  const pt = {
    id: 'point:1', kind: 'point', name: '折多山', lat: 30.0512, lng: 101.8156,
    nodes: [{ name: '折多山', lat: 30.0512, lng: 101.8156, altitude: 4298 }],
  }
  check('单点 ⇒ 坐标 + 海拔，且 isPoint 为真（节点行不带箭头）',
    V.isPointPlace(pt) === true && V.placeSubText(pt, pt.nodes[0]) === '30.0512°N, 101.8156°E · 4,298 m',
    V.placeSubText(pt, pt.nodes[0]))
  const halfCoord = { id: 'point:2', kind: 'point', name: '半个坐标', lat: 30.05, lng: null, nodes: [] }
  check('经纬度只缺一个 ⇒ 整段坐标不印（宁少说不印 undefined°E）',
    V.placeSubText(halfCoord, {}) === '海拔待确认', V.placeSubText(halfCoord, {}))

  console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => {
  console.error('scenario 崩了：', e)
  process.exit(1)
})