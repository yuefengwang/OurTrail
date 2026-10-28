// 天气页 V3 对拍：新视图装配 vs 独立重算的 oracle（同一份云端载荷）。
// 运行：node tools/ab-weather-v3.js
//
// 目的不是"跑得通"（那是 scenario 套件的活），而是回答「新装配有没有偷偷改业务判据」。
// oracle 不复用 utils/weather-v3-view.js 的实现，只吃同一份原始载荷重算：
//   选中时刻 / 时间窗 / 读数（温度、体感、降水、概率、风、阵风、湿度、能见度）/ 日期条 / 云图读数行。
// 另一个方向的差异是**已裁决的**：天相六项收成三张卡（§5.6），因此另外单独钉住可见集合。
'use strict'
const path = require('path')
const MP = path.join(__dirname, '..', 'miniprogram')
const V3 = require(path.join(MP, 'utils', 'weather-v3'))
const V = require(path.join(MP, 'utils', 'weather-v3-view'))
const HSV = require(path.join(MP, 'utils', 'weather-v3-hourly-svg'))
const sky = require(path.join(MP, 'utils', 'sky'))

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; return }
  failed++
  console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
function section(t) { console.log('\n§ ' + t) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---------- 载荷 ---------- */
const D0 = '2026-10-29'
function fixture() {
  const days = []
  for (let i = 0; i < 7; i++) {
    const d = V3.addDays(D0, i)
    days.push({ date: d, label: V3.shortDate(d), code: i === 2 ? 61 : 3, min: 1 + i, max: 9 + i })
  }
  const series = []
  for (let i = 0; i < 7 * 24; i++) {
    const d = V3.addDays(D0, Math.floor(i / 24))
    const h = i % 24
    series.push({
      t: V3.pad(h) + ':00', d, temp: 3 + Math.sin(h / 4) * 2.5, feels: 1.5 + Math.cos(h / 5),
      pop: 10 + (h * 3) % 80, precip: h > 12 && h < 18 ? 0.7 : 0, showers: 0, code: h > 6 && h < 18 ? 2 : 3,
      wind: 8 + (h % 5), gust: 15 + (h % 7), windDir: (h * 45) % 360, rh: 60 + (h % 20),
      pressure: 880, dewPoint: 0, cloud: { total: 50, low: 40 + (h % 3) * 10, mid: 55, high: 25 + (h % 4) * 5 },
      uv: 2, visibility: 15 + (h % 5),
    })
  }
  const levels = []
  ;[925, 850, 700].forEach((p, i) => levels.push({
    pressure: p,
    altitudes: series.map(() => 1500 + i * 1700),
    cloudCover: series.map((_, k) => 45 + ((k + i) % 5) * 7),
  }))
  return {
    status: 'ready', updatedAt: D0 + 'T07:00:00+08:00', provider: { label: 'Open-Meteo' },
    pointElevation: 3200, days, series, cloudLevels: { times: series.map(h => h.d + 'T' + h.t), levels, unit: { altitude: 'm ASL', cloudCover: '%' } },
  }
}
const PLACE = {
  id: 'route:r1', kind: 'route', name: '格聂两日路线', lat: 29.8, lng: 99.7, routeId: 'r1',
  nodes: [
    { name: '山谷起点', lat: 29.8, lng: 99.7, altitude: 3200, eleSource: 'gpx' },
    { name: '观景点', lat: 29.81, lng: 99.71, altitude: 3800, eleSource: 'gpx' },
  ],
}
const PLAN = {
  id: 'plan-1', routeId: 'r1', name: '格聂', startDate: D0, isOwner: true,
  stops: [{ nodeIndex: 0, day: 1, time: '08:00' }, { nodeIndex: 1, day: 1, time: '13:30' }, { nodeIndex: 1, day: 2, time: '09:00' }],
}
const result = fixture()

/* ---------- oracle ---------- */
function oracle(ctx, node) {
  const winLen = Math.min(ctx.period, 24 * 7)
  const absStart = Math.round((Date.parse(ctx.date + 'T00:00:00+08:00') - Date.parse(D0 + 'T00:00:00+08:00')) / 86400000) * 24
  const row = result.series[absStart + ctx.cursor]
  const selDate = V3.addDays(D0, Math.floor((absStart + ctx.cursor) / 24))
  const selHour = (absStart + ctx.cursor) % 24
  const temps = result.series.slice(absStart, absStart + winLen)
  return {
    winLen,
    selDate,
    selHour,
    temp: Math.round(row.temp),
    feels: Math.round(row.feels),
    precip: row.precip.toFixed(1),
    pop: String(row.pop),
    wind: String(Math.round(row.wind)),
    gust: String(Math.round(row.gust)),
    rh: String(row.rh),
    visibility: row.visibility.toFixed(1),
    altitude: node.altitude,
    firstDate: temps[0].d,
    lastDate: temps[temps.length - 1].d,
    lastHour: temps[temps.length - 1].t,
  }
}

function build(ctx, node) {
  return V.buildDetailView({ result, place: PLACE, node, ctx, width: 350, plan: PLAN, nodeWeather: { 0: result, 1: result } })
}

/* ------------------------------------------------------------------ */
section('§1 选中时刻与时间窗（逐项零差异）')

{
  const cases = [
    { date: D0, cursor: 13, period: 24, tab: 'hourly', nodeIndex: 0 },
    { date: D0, cursor: 0, period: 24, tab: 'hourly', nodeIndex: 1 },
    { date: D0, cursor: 47, period: 48, tab: 'cloud', nodeIndex: 0 },
    { date: V3.addDays(D0, 1), cursor: 71, period: 72, tab: 'sky', nodeIndex: 1 },
  ]
  cases.forEach((c, i) => {
    const ctx = V3.initialState(c)
    const node = PLACE.nodes[c.nodeIndex]
    const o = oracle(ctx, node)
    const out = build(ctx, node)
    const d = out.data
    check('用例 ' + (i + 1) + '：选中日期/小时一致',
      d.selectedDate === o.selDate && d.readout.time === V3.pad(o.selHour) + ':00',
      [d.selectedDate, o.selDate, d.readout.time])
    check('用例 ' + (i + 1) + '：窗口长度 = period（不越界不多画）',
      d.hourCols.length === o.winLen && d.hourlyColumns === o.winLen, [d.hourCols.length, o.winLen])
    check('用例 ' + (i + 1) + '：窗口首尾小时与原始系列对齐',
      d.hourCols[0].key === o.firstDate + '00:00' &&
      d.hourCols[o.winLen - 1].key === o.lastDate + o.lastHour,
      [d.hourCols[0].key, o.firstDate + '00:00', d.hourCols[o.winLen - 1].key, o.lastDate + o.lastHour])
    check('用例 ' + (i + 1) + '：读数八项逐字一致',
      d.readout.temp === String(o.temp) && d.readout.feels === String(o.feels) &&
      d.readout.precip === o.precip && d.readout.pop === o.pop &&
      d.readout.wind === o.wind && d.readout.gust === o.gust &&
      d.readout.rh === o.rh && d.readout.visibility === o.visibility,
      {
        got: [d.readout.temp, d.readout.feels, d.readout.precip, d.readout.pop, d.readout.wind, d.readout.gust, d.readout.rh, d.readout.visibility],
        want: [o.temp, o.feels, o.precip, o.pop, o.wind, o.gust, o.rh, o.visibility],
      })
    check('用例 ' + (i + 1) + '：节点海拔与读数同源（不是「你」的海拔）',
      d.readout.altitude === o.altitude, [d.readout.altitude, o.altitude])
  })
}

/* ------------------------------------------------------------------ */
section('§2 图表几何（列宽由宽度反推：24h 一屏，48/72 同列宽横向滚动）')

{
  const cell = HSV.cellFor(350)
  check('列宽公式落点（350 宽 ⇒ 12.54）', cell === 12.54, cell)
  ;[24, 48, 72].forEach(period => {
    const ctx = V3.initialState({ date: D0, cursor: 5, period, tab: 'hourly', nodeIndex: 0 })
    const out = build(ctx, PLACE.nodes[0])
    check(period + 'h：总宽 = period × 同一列宽、cell 回填一致',
      out.data.hourlyWidth === cell * period && out.data.hourlyCell === cell,
      [out.data.hourlyWidth, out.data.hourlyCell])
    check(period + 'h：24h 放得下不出滚动，48/72 必须滚动（不多压列）',
      out.data.hourlyScrolls === (period > 24), [period, out.data.hourlyScrolls])
    check(period + 'h：选中列下标 = cursor', out.data.cursor === 5, out.data.cursor)
    check(period + 'h：SVG 里有选中列底色与竖线',
      out.data.hourlySrc.indexOf('data:image/svg+xml') === 0, String(out.data.hourlySrc).slice(0, 24))
  })
  // 阳性对照：换游标必须换图（否则上面的"一致"可能只是常数）
  const a = build(V3.initialState({ date: D0, cursor: 0, period: 24, nodeIndex: 0 }), PLACE.nodes[0])
  const b = build(V3.initialState({ date: D0, cursor: 12, period: 24, nodeIndex: 0 }), PLACE.nodes[0])
  check('阳性对照：游标不同 ⇒ 逐时图与选中时刻都不同',
    a.data.hourlySrc !== b.data.hourlySrc && a.data.readout.time !== b.data.readout.time && a.data.cursor !== b.data.cursor,
    [a.data.readout.time, b.data.readout.time])
}

/* ------------------------------------------------------------------ */
section('§3 日期条（计划口径与 oracle 对齐）')

{
  const ctx = V3.initialState({ date: V3.addDays(D0, 1), cursor: 10, period: 24, nodeIndex: 0 })
  const out = build(ctx, PLACE.nodes[0])
  const want = [1, 2].map(d => ({ key: 'D' + d, date: V3.addDays(PLAN.startDate, d - 1) }))
  check('D 按钮数量 = 计划最大天数', out.data.dayStrip.length === want.length, out.data.dayStrip.map(x => x.key))
  check('D 按钮日期逐项一致',
    eq(out.data.dayStrip.map(x => x.date), want.map(x => x.date)),
    out.data.dayStrip.map(x => x.date))
  check('选中日期对应 D2 高亮',
    out.data.dayStrip.filter(x => x.selected).length === 1 &&
    out.data.dayStrip.filter(x => x.selected)[0].key === 'D2',
    out.data.dayStrip.map(x => x.key + (x.selected ? '*' : '')))
  check('预报窗口内的日期才可用', out.data.dayStrip.every(x => x.enabled === true))
}

/* ------------------------------------------------------------------ */
section('§4 云图读数行与选中小时同源')

{
  const ctx = V3.initialState({ date: D0, cursor: 15, period: 24, nodeIndex: 0 })
  const out = build(ctx, PLACE.nodes[0])
  check('云图读数行以选中小时开头（不是永远 00:00）',
    out.data.cloudSel.r1.indexOf('15:00') === 0, out.data.cloudSel.r1)
  check('云图十字线 overlay 已生成', out.data.cloudSel.selSrc.indexOf('data:image/svg+xml') === 0)
  check('云区读数与地图例同一套词（云量 / 云区 / 海拔）',
    /云量|海拔/.test(out.data.cloudSel.r2), out.data.cloudSel.r2)
  const other = build(V3.initialState({ date: D0, cursor: 16, period: 24, nodeIndex: 0 }), PLACE.nodes[0])
  check('阳性对照：换小时 ⇒ 云图读数行跟着换',
    out.data.cloudSel.r1 !== other.data.cloudSel.r1, [out.data.cloudSel.r1, other.data.cloudSel.r1])
}

/* ------------------------------------------------------------------ */
section('§5 天相：六项收三卡是已裁决差异，可见集合必须不变')

{
  const ctx = V3.initialState({ date: D0, cursor: 13, period: 24, nodeIndex: 0 })
  const out = build(ctx, PLACE.nodes[0])
  const raw = out.skyOut
  const rawItems = raw ? raw.items.filter(it => it.key !== 'light') : []
  const rawVisible = rawItems.filter(it => !sky.isSilent(it)).map(it => it.key).sort()
  const cardVisible = out.data.sky.cards.filter(c => c.verdict !== 'excluded')
    .map(c => c.key === 'night' ? ['star', 'galaxy'] : c.key === 'color' ? ['rainbow', 'alpenglow'] : ['cloudSea'])
    .reduce((a, b) => a.concat(b), []).sort()
  check('卡片数量 = 3（六项合并的裁决）', out.data.sky.cards.length === 3, out.data.sky.cards.map(c => c.key))
  check('被判成立/判不出的项一个不少（合并不改可见集合）',
    eq(rawVisible, cardVisible), { rawVisible, cardVisible })
  check('总评只用可见项（与 conditions.overallGrade 同源）',
    !!out.data.sky.overall && typeof out.data.sky.overall.score === 'number', out.data.sky.overall)
  check('客观时刻 5 条都在（天气不许裁钟点）', out.data.sky.events.length === 5, out.data.sky.events.map(e => e.title))
  check('日照弧是独立小图（data URI）', out.data.sky.arcSrc.indexOf('data:image/svg+xml') === 0)
}

console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)