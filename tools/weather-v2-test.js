// Weather V2 增量实现测试：node tools/weather-v2-test.js
//
// 覆盖（docs/weather-ux/production-implementation-plan.md §31 要求）：
//   1. WMO 雪码修复——71/75/77/85/86 = 雪；80/81/82 = **不是**雪；
//      14°C + 阵雨码不得触发「0℃ 层低于此点，降水可能为雪」
//   2. 云海可见性——凌晨不可见段（民用晨光前）不进 Agenda，可见段保留；
//      整段落在夜里的云海簇整段丢弃。时间全部由真实 astro 计算得出，不硬编码
//   3. Evidence——每张条件卡的事实清单非空，每条含事实文案与合法锚点小时
//   4. Optional 字段缺失降级——旧返回体（无 windDir/pressure/dewPoint）整页装配不炸、显示 '—'
//   5. 视图切片——24/48/72h；非法 span 回落 24h；chartSeries 的 7 天语义不受影响
//   6. 总评均分——light 不参与；「有戏项均值」规则与 weather-model.judge 同源
'use strict'

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const sky = require('../miniprogram/utils/sky')
const A = require('../miniprogram/utils/astro')
const F = require('../miniprogram/utils/format')
const agenda = require('../miniprogram/utils/agenda')
const cond = require('../miniprogram/utils/conditions')
const wf = require('../cloudfunctions/trailApi/lib/weather')

const DATE = '2026-10-06'
const COORD = { lat: 29.86, lng: 99.46 } // 格聂（WGS-84）
const ELEV = 3500

/* ---------- 1. WMO 雪码 ---------- */

section('1. WMO 雪码修复（isSnowCode）')
{
  check('71/75/77 = 雪', cond.isSnowCode(71) && cond.isSnowCode(75) && cond.isSnowCode(77))
  check('85/86 = 阵雪（算雪）', cond.isSnowCode(85) && cond.isSnowCode(86))
  check('80/81/82 = 阵雨（**不是**雪）', !cond.isSnowCode(80) && !cond.isSnowCode(81) && !cond.isSnowCode(82))
  check('61/95/0 = 不是雪', !cond.isSnowCode(61) && !cond.isSnowCode(95) && !cond.isSnowCode(0))
  check('非法输入 = 不是雪', !cond.isSnowCode(null) && !cond.isSnowCode(undefined) && !cond.isSnowCode('x'))

  // 集成：14°C 的阵雨日（日码 80，逐时 80/81/82，冻结高度远高于此点）不得出现雪 callout
  const day = { code: 80, precipProbMax: 60 }
  const detail = []
  for (let hh = 0; hh < 24; hh++) {
    detail.push({
      t: String(hh).padStart(2, '0') + ':00', temp: 14, pop: hh >= 12 ? 60 : 10,
      precip: hh >= 14 && hh <= 16 ? 0.8 : 0, showers: hh >= 14 && hh <= 16 ? 1.2 : 0,
      code: hh >= 14 && hh <= 16 ? 81 : 80, wind: 10, rh: 70,
      cloud: { low: 40, mid: 50, high: 20 }, band: null,
      visibility: 20, freezing: 4600,
    })
  }
  const callouts = cond.buildCallouts(day, detail, ELEV)
  check('14°C + 阵雨日无「降水可能为雪」callout',
    callouts.every(c => c.title.indexOf('雪') === -1), JSON.stringify(callouts))
  check('阵雨日仍给出「午后阵雨」提示',
    callouts.some(c => c.title.indexOf('午后阵雨') !== -1), JSON.stringify(callouts))

  // 雪日回归：日码 71 → 雪 callout 仍在
  const snowDay = cond.buildCallouts({ code: 71, precipProbMax: 60 }, detail, ELEV)
  check('日码 71 → 保留「降水可能为雪」callout',
    snowDay.some(c => c.title === '0℃ 层低于此点，降水可能为雪'), JSON.stringify(snowDay))

  // 迁移回归：云海 success callout 不再由 callouts 产生（云海归 Conditions 卡唯一表达）
  const seaDetail = detail.map(h => Object.assign({}, h, {
    code: 2, temp: 4, pop: 5, precip: 0, showers: 0,
    cloud: { low: 85, mid: 10, high: 10 },
    band: { base: 2280, top: 2950, cover: 88 },
  }))
  const seaCallouts = cond.buildCallouts({ code: 2, precipProbMax: 10 }, seaDetail, ELEV)
  check('云海 callout 已删除（防两处结论打架）', !seaCallouts.some(c => c.tone === 'success'), JSON.stringify(seaCallouts))
}

/* ---------- 2. 云海可见性（Agenda 交集，真实 astro） ---------- */

section('2. 云海可见性：Agenda 只给看得见的窗口')
{
  const sun = A.sunTimes(DATE, COORD.lat, COORD.lng, ELEV)
  const win = A.photoWindows(DATE, COORD.lat, COORD.lng, ELEV)
  const civilDawnMin = sky.hourMin(sun.civilDawn)
  const civilDuskMin = sky.hourMin(sun.civilDusk)

  const detail = []
  const marks = {}
  for (let hh = 0; hh < 24; hh++) {
    const t = String(hh).padStart(2, '0') + ':00'
    detail.push({
      d: DATE, t, temp: 8, pop: 10, precip: 0, showers: 0, code: 2, wind: 6, rh: 60,
      cloud: { low: 85, mid: 10, high: 10 }, band: { base: 2280, top: 2950, cover: 88 },
    })
  }
  // 三段云海标记：01:00–08:00（跨晨光，部分可见）、13:00（昼间，可见）、22:00–23:00（夜，不可见）
  for (let hh = 1; hh <= 8; hh++) marks[DATE + 'T' + String(hh).padStart(2, '0') + ':00'] = ['cloudSea']
  marks[DATE + 'T13:00'] = ['cloudSea']
  for (let hh = 22; hh <= 23; hh++) marks[DATE + 'T' + String(hh).padStart(2, '0') + ':00'] = ['cloudSea']

  const events = agenda.buildDayAgenda({ date: DATE, detail, marks, sun, win })
  const seaEvents = events.filter(e => e.l2 && e.key === 'cloudSea')

  check('三段云海簇 → 两条可见窗口（01–08 晨光交集 + 13 时整段；22–23 整段丢弃）',
    seaEvents.length === 2, seaEvents.map(e => e.window).join(' / '))
  const dawnEvent = seaEvents.find(e => e.window.indexOf('–') !== -1 && sky.hourMin(e.window.slice(0, 5)) < 12 * 60)
  check('凌晨簇窗口起点 = 民用晨光（' + sun.civilDawn + '，非天文晨光 ' + sun.astroDawn + '）',
    !!dawnEvent && sky.hourMin(dawnEvent.window.slice(0, 5)) === civilDawnMin,
    dawnEvent && dawnEvent.window)
  check('02:00（民用晨光前）不进任何窗口',
    seaEvents.every(e => {
      const from = sky.hourMin(e.window.slice(0, 5))
      return from >= civilDawnMin || from <= civilDuskMin && from >= 12 * 60
    }), seaEvents.map(e => e.window).join('/'))
  check('07:00 在晨间窗口内、13:00 在昼间窗口内',
    seaEvents.some(e => {
      const from = sky.hourMin(e.window.slice(0, 5))
      const to = sky.hourMin(e.window.slice(-5)) + 60
      return 7 * 60 >= from && 7 * 60 < to
    }) && seaEvents.some(e => sky.hourMin(e.window.slice(0, 5)) === 13 * 60),
    seaEvents.map(e => e.window).join(' / '))
  check('夜段簇（22–23 时）整段不进 Agenda',
    seaEvents.every(e => !(sky.hourMin(e.window.slice(0, 5)) >= 22 * 60)), seaEvents.map(e => e.window).join('/'))

  // 天文数据缺失时不裁剪（宁可多给不给错）
  const noSun = agenda.buildDayAgenda({ date: DATE, detail, marks, sun: null, win })
  check('sun 缺失：不裁剪（凌晨簇保留）',
    noSun.filter(e => e.l2 && e.key === 'cloudSea').length === 3,
    String(noSun.filter(e => e.l2 && e.key === 'cloudSea').length))
}

/* ---------- 3. Evidence：每张卡都有事实与锚点 ---------- */

section('3. Evidence 事实清单（factsFor）')
{
  const sun = A.sunTimes(DATE, COORD.lat, COORD.lng, ELEV)
  const moon = A.moonInfo(DATE)
  const days = [
    { date: '2026-10-05', code: 61, precipSum: 4.2, precipProbMax: 70, cloud: { low: 80, mid: 40, high: 30 } },
    { date: DATE, code: 2, precipSum: 2.0, precipProbMax: 60, cloud: { low: 50, mid: 30, high: 20 } },
  ]
  const detail = []
  for (let hh = 0; hh < 24; hh++) {
    const t = String(hh).padStart(2, '0') + ':00'
    const morning = hh >= 1 && hh <= 8
    detail.push({
      d: DATE, t, temp: 8, feels: 6, pop: morning ? 15 : 55, precip: 0, showers: hh === 15 ? 1.2 : 0,
      code: 2, wind: morning ? 6 : 14, windDir: 150, rh: hh >= 12 ? 80 : 65, pressure: 1015,
      cloud: { low: morning ? 85 : 45, mid: 25, high: morning ? 12 : 35 },
      band: morning ? { base: 2280, top: 2950, cover: 88 } : null,
      uv: 4, visibility: 18, freezing: 4600,
    })
  }
  const ctx = { date: DATE, detail, days, elevation: ELEV, sun, moon }

  for (const key of ['cloudSea', 'alpenglow', 'rainbow', 'galaxy', 'star']) {
    const facts = cond.factsFor(key, ctx)
    check(key + '：证据非空（' + facts.length + ' 条）', facts.length > 0)
    check(key + '：每条都有事实文案与合法锚点小时',
      facts.every(f => typeof f.fact === 'string' && f.fact.length > 0 && /^\d{2}:\d{2}$/.test(f.at)),
      JSON.stringify(facts))
  }
  check('cloudSea 证据含海拔对比与云带区间',
    cond.factsFor('cloudSea', ctx).some(f => f.fact.indexOf('高于云带顶') !== -1)
    && cond.factsFor('cloudSea', ctx).some(f => f.fact.indexOf('低层云带') !== -1))
  check('galaxy 证据含月照',
    cond.factsFor('galaxy', ctx).some(f => f.fact.indexOf('月照') !== -1))
  check('未知 key 返回空数组（不抛异常）', cond.factsFor('nope', ctx).length === 0)
  check('detail 为空返回空数组', cond.factsFor('cloudSea', { date: DATE, detail: [], days: [], elevation: ELEV }).length === 0)
}

/* ---------- 4. Optional 字段缺失降级 ---------- */

section('4. Optional 字段缺失：旧返回体整链不炸')
{
  // hourView：请求没带新变量 → 字段为 undefined（旧云函数返回体同形）
  const times = [DATE + 'T00:00', DATE + 'T01:00']
  const h = { temperature_2m: [10, 9], weather_code: [2, 2], wind_speed_10m: [7, 7], cloud_cover_low: [20, 20] }
  const view = times.map((_, i) => wf.hourView(times, h, i))
  check('hourView：缺变量时 windDir/pressure/dewPoint 为 undefined',
    view.every(x => x.windDir === undefined && x.pressure === undefined && x.dewPoint === undefined))

  // 页面装配：真页面配置直调 buildDetailRows + selectHour
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  const PAGE_PATH = require.resolve('../miniprogram/pages/weather/weather.js')
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  const cfg = global.__PAGE_CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb() }

  const rows = page.buildDetailRows(view)
  check('buildDetailRows：缺失字段显示 —（风向/气压/露点）',
    rows.every(r => r.windDir === '—' && r.pressure === '—' && r.dewPoint === '—'), JSON.stringify(rows[0]))

  // 浮条：旧返回体形状（无 optional 字段）也能选中某小时
  page.data.chartView = view
  page.data.chartMarks = {}
  page.onChartPickHour({ detail: { date: DATE, t: '01:00' } })
  check('selectHour：缺失字段下浮条装配成功且气压显示 —',
    !!page.data.hourChip && page.data.hourChip.pressure === '—' && page.data.chartPick.t === '01:00',
    JSON.stringify(page.data.hourChip))

  // 风向文案：非法输入返回 null（WXML 层判空）
  check('windDirText：150°→东南风，null→null', F.windDirText(150) === '东南风' && F.windDirText(null) === null)
}

/* ---------- 5. 视图切片与 7 天语义 ---------- */

section('5. buildViewSeries：24/48/72h 切窗，7 天契约不动')
{
  global.Page = cfg => { global.__PAGE_CFG = cfg }
  const PAGE_PATH = require.resolve('../miniprogram/pages/weather/weather.js')
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  const cfg = global.__PAGE_CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))

  const series = []
  for (let i = 0; i < 24 * 7; i++) {
    series.push({ d: '2026-10-0' + (6 + Math.floor(i / 24)), t: String(i % 24).padStart(2, '0') + ':00', temp: 10 })
  }
  check('24h → 24 条', page.buildViewSeries(series, 24).length === 24)
  check('48h → 48 条', page.buildViewSeries(series, 48).length === 48)
  check('72h → 72 条', page.buildViewSeries(series, 72).length === 72)
  check('非法 span 回落 24h', page.buildViewSeries(series, 999).length === 24)
  check('数据不足有多少给多少', page.buildViewSeries(series.slice(0, 30), 72).length === 30)
  // buildChartSeries 的 7 天语义（全屏页/缓存契约依赖）不受视图切换影响
  check('buildChartSeries 仍是 7 天 168 条', page.buildChartSeries(series, '2026-10-06').length === 168)
}

/* ---------- 6. 总评均分（light 不参与，规则同 weather-model.judge） ---------- */

section('6. overallGrade 与星级语言')
{
  const items = [
    { key: 'light', score: 100, tone: '', label: '客观时刻' },
    { key: 'cloudSea', score: 80, tone: 'success', label: '条件较好' },
    { key: 'rainbow', score: 50, tone: 'warning', label: '条件一般' },
    { key: 'star', score: 10, tone: 'neutral', label: '条件较差' },
  ]
  const g = cond.overallGrade(items)
  check('light 不参与均分；无戏项不拉低（(80+50)/2 = 65 → 条件一般）',
    g.score === 65 && g.label === '条件一般', JSON.stringify(g))
  check('星级映射：65 → ★★★☆☆（3 星）', g.stars === '★★★☆☆', g.stars)
  check('≥70 → ★★★★☆（最高四星，第五颗永远空着）',
    cond.starsOf(100) === '★★★★☆' && cond.overallGrade([{ key: 'cloudSea', score: 90 }]).stars === '★★★★☆')
  check('<45 → ★★☆☆☆（最低两星，不打一星）', cond.starsOf(10) === '★★☆☆☆')
  check('空清单 → 条件较差不炸', cond.overallGrade([]).label === '条件较差')
  check('全为 light → 用其余项（空）走较差档', cond.overallGrade([{ key: 'light', score: 100 }]).label === '条件较差')
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
