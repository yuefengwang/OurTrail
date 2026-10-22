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
//   6. 总评均分——light 不参与；「有戏项均值」规则与 conditions.overallGrade 一致
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
  /* 簇末 08 时覆盖 [08:00,09:00)，窗口终点必须补满这一小时再与暮光取交集。
     只测起点会让"+60 去掉"在单小时簇之外漏网（多时段簇仍能过）。 */
  check('凌晨簇窗口终点 = 簇末小时 +60 分钟（08 时 → 09:00）',
    !!dawnEvent && dawnEvent.window.slice(-5) === '09:00', dawnEvent && dawnEvent.window)
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

/* ---------- 2b. 摄影窗口的事实后缀：时间不裁，但当时的云要说 ---------- */

section('2b. 黄金/蓝调窗口：满云时加事实后缀，但一条都不许消失')
{
  const sun = A.sunTimes(DATE, COORD.lat, COORD.lng, ELEV)
  const win = A.photoWindows(DATE, COORD.lat, COORD.lng, ELEV)
  const dayWith = low => {
    const out = []
    for (let hh = 0; hh < 24; hh++) out.push({
      d: DATE, t: String(hh).padStart(2, '0') + ':00', temp: 8, pop: 0, precip: 0, showers: 0,
      code: 2, wind: 6, rh: 60, cloud: { low: low, mid: 10, high: 10 }, band: null,
    })
    return out
  }
  const events = low => agenda.buildDayAgenda({ date: DATE, detail: dayWith(low), marks: {}, sun, win })
  const photo = low => events(low).filter(e => /黄金时刻|蓝调时刻/.test(e.title))

  // ① 不裁时间：满云与晴日的条目数与时刻必须完全一致（用户要的是"别把不可能当建议"，不是藏钟点）
  const oc = photo(100), cl = photo(10)
  check('满云日仍是 4 条摄影窗口（一条都没被裁掉）', oc.length === 4, oc.map(e => e.t + e.title).join('/'))
  check('满云与晴日的时刻与标题逐项相同（时间层不受天气影响）',
    oc.map(e => e.t + '|' + e.title).join(' ') === cl.map(e => e.t + '|' + e.title).join(' '),
    oc.map(e => e.t).join(' ') + ' vs ' + cl.map(e => e.t).join(' '))

  // ② 后缀只在满云时出现，且措辞按窗口分岔（黄金说暖光、蓝调说天色）
  check('满云四条都带"当时低云 100%"', oc.every(e => /当时低云 100%/.test(e.sub || '')),
    oc.map(e => e.sub).join(' | '))
  check('黄金说"斜射暖光可能到不了山体"',
    oc.filter(e => /黄金/.test(e.title)).every(e => /斜射暖光可能到不了山体/.test(e.sub)),
    oc.filter(e => /黄金/.test(e.title)).map(e => e.sub).join(' | '))
  check('蓝调说"天空可能只发灰不发蓝"',
    oc.filter(e => /蓝调/.test(e.title)).every(e => /天空可能只发灰不发蓝/.test(e.sub)),
    oc.filter(e => /蓝调/.test(e.title)).map(e => e.sub).join(' | '))
  check('晴日：晨两条仍是原固定文案、昏两条仍是 null（没凭空加话）',
    cl.filter(e => /晨/.test(e.title)).every(e => /^(天空最蓝的十几分钟|斜射暖光开始)$/.test(e.sub || ''))
      && cl.filter(e => /昏/.test(e.title)).every(e => e.sub == null),
    cl.map(e => e.title + '=' + e.sub).join(' | '))
  check('原话没被改写：后缀是"加"上去的（晨蓝调仍以"天空最蓝的十几分钟"开头）',
    (oc.filter(e => e.title === '蓝调时刻（晨）')[0].sub || '').indexOf('天空最蓝的十几分钟（') === 0,
    oc.filter(e => e.title === '蓝调时刻（晨）')[0].sub)

  // ③ 边界与口径同源：40 是"光到不到山体"的那把尺，不是新造的数
  check('低云 39 不加后缀、40 加（与 sky.lightReachesGround 同一边界）',
    photo(39).every(e => !/当时低云/.test(e.sub || '')) && photo(40).every(e => /当时低云 40%/.test(e.sub || '')),
    photo(39).map(e => e.sub).join(' | '))
  check('边界值确实等于 lightReachesGround 的判据（不是两处各写一遍）',
    sky.lightReachesGround({ low: 39 }) === true && sky.lightReachesGround({ low: 40 }) === false
      && sky.LIGHT_LIMITS.LOW_CLOUD_MAX === 40)

  // ④ 缺云量读数 ⇒ 不编造（既不说看得到，也不说看不到）。形状取生产真能发出来的那种：
  //    lib/weather 的 hourView 写 `cloud: { low: (h.cloud_cover_low || [])[i] }`，
  //    缺数组时是 undefined、Open-Meteo 给 null 时是 null —— 而 cloud 对象本身一定在。
  //    夹具必须**铺满 24 小时**：只给一行 00:00 的话，06:40 根本找不到所属小时，
  //    "返回 null"是查无此小时给的，不是判据给的 —— 第一版就假绿在这里。
  const fillDay = cloud => {
    const out = []
    for (let hh = 0; hh < 24; hh++) out.push({
      d: DATE, t: String(hh).padStart(2, '0') + ':00', temp: 8, pop: 0, precip: 0, showers: 0,
      code: 2, wind: 6, rh: 60, cloud, band: null,
    })
    return out
  }
  const nullDay = fillDay({ low: null, mid: null, high: null })
  const undefDay = fillDay({})
  check('cloud.low = null 不得被 Number(null)=0 混成"低云 0%，光好"（不造有利事实）',
    agenda.lowCloudAt(nullDay, '06:40') === null && agenda.lowCloudAt(undefDay, '06:40') === null
      && agenda.lightNote(nullDay, win.morningGolden.from, 'golden') === null,
    'nullDay → ' + String(agenda.lowCloudAt(nullDay, '06:40')))
  check('整日缺读数 ⇒ 四条摄影窗口都不带后缀（判不出不写成结论）',
    [nullDay, undefDay].every(d => agenda.buildDayAgenda({ date: DATE, detail: d, marks: {}, sun, win })
      .filter(e => /黄金时刻|蓝调时刻/.test(e.title))
      .every(e => !/当时低云/.test(e.sub || ''))))

  // ⑤ 影子改口径：数字只有一个出处 ⇒ 光染标记 / 彩虹标记 / 窗口后缀 必须一起动，还原后逐项相同
  const mkDetail = wet => {
    const out = []
    for (let hh = 0; hh < 24; hh++) out.push({
      d: DATE, t: String(hh).padStart(2, '0') + ':00', temp: 8,
      pop: wet && hh >= 8 && hh <= 9 ? 30 : 0, precip: wet && hh >= 8 && hh <= 9 ? 0.3 : 0,
      showers: 0, code: 2, wind: 6, rh: wet && hh >= 8 && hh <= 9 ? 92 : 60,
      cloud: { low: 60, mid: 20, high: 10 }, band: null,
    })
    return out
  }
  const markCount = (detail, key) => {
    const m = sky.hourMarks({ date: DATE, lat: COORD.lat, lng: COORD.lng, elevation: ELEV, elevOK: true, detail, days: [] })
    return Object.keys(m).filter(t => (m[t] || []).indexOf(key) !== -1).length
  }
  const snap = () => ({
    alp: markCount(mkDetail(false), 'alpenglow'),
    rb: markCount(mkDetail(true), 'rainbow'),
    note: photo(60).filter(e => /当时低云/.test(e.sub || '')).length,
  })
  const before = snap()
  sky.LIGHT_LIMITS.LOW_CLOUD_MAX = 95
  const during = snap()
  sky.LIGHT_LIMITS.LOW_CLOUD_MAX = 40
  const after = snap()
  /* 把"光到得了山体"的低云上限放宽到 95%：同一份低云 60% 的数据 ⇒ 光染与彩虹**变成有戏**，
     而窗口后缀**全部消失**（60 < 95 就是"光到得了"）。三处一起动才算引用同一个数；
     任何一处不动，就说明那里还抄了一份自己的 40。 */
  check('影子把上限 40 改到 95 ⇒ 光染/彩虹标记变多、窗口后缀归零（三处同源）',
    during.alp > before.alp && during.rb > before.rb && before.note === 4 && during.note === 0,
    JSON.stringify({ before, during }))
  check('还原后逐项相同（门不是空转）',
    after.alp === before.alp && after.rb === before.rb && after.note === before.note,
    JSON.stringify({ before, after }))
  check('agenda.js 里不得再出现这把尺的字面量（数字只许在 sky.LIGHT_LIMITS 一处）',
    !/[<>]=?\s*40\b/.test(require('fs').readFileSync(require('path').join(__dirname, '../miniprogram/utils/agenda.js'), 'utf8')))
}

/* ---------- 2c. 「天文暗夜始」的机会句：有银河才说 ---------- */

section('2c. 天文暗夜始的 sub 只在真有银河小时时说，否则只剩时刻')
{
  const mk = (over, date) => {
    const detail = []
    for (let hh = 0; hh < 24; hh++) {
      const o = (over && over(hh)) || {}
      detail.push({
        d: date, t: String(hh).padStart(2, '0') + ':00', temp: 8, pop: o.pop || 0,
        precip: o.precip || 0, showers: 0, code: 2, wind: 6, rh: o.rh || 60,
        cloud: { low: o.low == null ? 5 : o.low, mid: o.mid == null ? 5 : o.mid, high: o.high == null ? 5 : o.high },
        band: null,
      })
    }
    return detail
  }
  const pageMarks = (detail, date) => {
    const m = sky.hourMarks({ date, lat: COORD.lat, lng: COORD.lng, elevation: ELEV, elevOK: true, detail, days: [] })
    const out = {}
    Object.keys(m).forEach(t => { out[date + 'T' + t] = m[t] })
    return out
  }
  const duskSub = (detail, date) => {
    const sun = A.sunTimes(date, COORD.lat, COORD.lng, ELEV)
    const win = A.photoWindows(date, COORD.lat, COORD.lng, ELEV)
    const ev = agenda.buildDayAgenda({ date, detail, marks: pageMarks(detail, date), sun, win })
    const dark = ev.filter(e => e.title === '天文暗夜始')[0] || {}
    const galaxyCard = sky.summarize({ date, lat: COORD.lat, lng: COORD.lng, elevation: ELEV, elevOK: true, detail, days: [], heading: null })
      .items.filter(i => i.key === 'galaxy')[0]
    return { sub: dark.sub || null, t: dark.t || null, verdict: galaxyCard.verdict }
  }
  const CLEAR = date => duskSub(mk(null, date), date)
  const OVERCAST = date => duskSub(mk(() => ({ low: 100, mid: 100, high: 100, pop: 90, precip: 1, rh: 95 }), date), date)

  // ① 时刻永远在（这是客观天文事实，不许因为天气消失）
  const oc = OVERCAST('2026-10-09'), cl = CLEAR('2026-10-09')
  check('满云与晴夜都有「天文暗夜始」且时刻相同（只改那一句话，不裁钟点）',
    oc.t !== null && oc.t === cl.t, JSON.stringify({ oc: oc.t, clear: cl.t }))
  // ② 满云夜：银河卡被沉默闸收掉，机会句也必须跟着消失（同一屏两处不许打架）
  check('满云夜：sub 为空（不再替已被沉默的银河背书）', oc.sub === null && oc.verdict === 'excluded',
    JSON.stringify(oc))
  // ③ 晴夜 + 银心季 + 月黑：机会句照旧（不许一刀切把真机会也抹掉）
  check('晴夜（10 月初、残月）：sub 仍是「银河与深空窗口」', cl.sub === '银河与深空窗口', JSON.stringify(cl))
  // ④ 方向性：有机会句 ⇒ 银河卡必然不沉默（弱一致，不假装两边等价——标记还多要一个月照门槛）
  const probes = ['2026-01-15', '2026-05-10', '2026-10-09', '2026-10-20'].map(d => ({ d, r: CLEAR(d) }))
  check('凡给出机会句的日子，银河卡 verdict 必为 possible（单向一致）',
    probes.every(p => !p.r.sub || p.r.verdict === 'possible'),
    probes.map(p => p.d + ':' + (p.r.sub || '—') + '/' + p.r.verdict).join(' '))
  check('非银心季（1 月晴夜）：机会句不说，银河卡也沉默（两处同一口径）', (() => {
    const jan = probes.filter(p => p.d === '2026-01-15')[0].r
    return jan.sub === null && jan.verdict === 'excluded'
  })(), JSON.stringify(probes.filter(p => p.d === '2026-01-15')[0].r))
  check('agenda.js 里「银河与深空窗口」只出现一次（不许再有一份无条件文案）',
    (require('fs').readFileSync(require('path').join(__dirname, '../miniprogram/utils/agenda.js'), 'utf8')
      .match(/银河与深空窗口/g) || []).length === 1)
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
  /* F1（2026-10-21）：证据行里的「光污染未计入」也必须覆盖 undefined。
     页面的三个真实状态——首屏、getSkyContext 整体失败、配额用尽——传的正是 undefined；
     旧实现只认 `=== null`，于是缺测在最需要披露的时候恰好从证据里消失。
     三态成对：没传 / 显式 null / 有读数，缺一不可（有读数那侧是阳性对照）。 */
  const lpFacts = extra => cond.factsFor('star', Object.assign({}, ctx, extra))
  const absent = lpFacts({})
  const explicitNull = lpFacts({ lightPollution: null })
  const undefinedKey = lpFacts({ lightPollution: undefined })
  const withReading = lpFacts({ lightPollution: { bortle: 2, sqm: 21.8 } })
  const lim = list => list.filter(f => f.kind === 'night-limit')
  check('光污染缺字段（不传）⇒ 证据里点名「未计入」且 kind=night-limit',
    lim(absent).length === 1 && /光污染未计入/.test(lim(absent)[0].fact), JSON.stringify(absent))
  check('光污染显式 null ⇒ 同样点名「未计入」', lim(explicitNull).length === 1, JSON.stringify(explicitNull))
  check('光污染字段值是 undefined ⇒ 与不传同解（页面真实形态）',
    lim(undefinedKey).length === 1, JSON.stringify(undefinedKey))
  check('光污染有读数 ⇒ 给出天空亮度、且不再说「未计入」（阳性对照）',
    withReading.some(f => f.kind === 'light-pollution' && /Bortle 2/.test(f.fact))
    && lim(withReading).length === 0, JSON.stringify(withReading))
  check('未知 key 返回空数组（不抛异常）', cond.factsFor('nope', ctx).length === 0)
  check('detail 为空返回空数组', cond.factsFor('cloudSea', { date: DATE, detail: [], days: [], elevation: ELEV }).length === 0)
}

/* ---------- 3b. 跨夜证据锚点（F4 阶段一） ---------- */

section('3b. 跨夜证据锚点：只有 at 变完整日期，事实文本不动')
{
  /* 与 sky-test §23 同一立场，这里从**页面会传的 ctx 形状**再钉一次：
     detail 是所选日 24h、night 是 sky.summarize 产出的跨夜序列。 */
  const makeDay = (d) => {
    const out = []
    for (let hh = 0; hh < 24; hh++) {
      out.push({
        d, t: String(hh).padStart(2, '0') + ':00', temp: 12, pop: 0, precip: 0, showers: 0,
        code: 2, wind: 6, rh: 60, cloud: { low: 0, mid: 0, high: 0 }, band: null,
      })
    }
    return out
  }
  const d1 = makeDay('2026-07-15')
  const d2 = makeDay('2026-07-16')
  d1[22].cloud = { low: 20, mid: 20, high: 20 }
  d1[23].cloud = { low: 20, mid: 20, high: 20 }
  d2[0].cloud = { low: 10, mid: 10, high: 10 }
  const skyOut = sky.summarize({
    date: '2026-07-15', lat: COORD.lat, lng: COORD.lng, elevation: ELEV, elevOK: true,
    detail: d1, series: d1.concat(d2), days: [], heading: null,
    lightPollution: { bortle: 2, sqm: 21.8 },
  })
  const galaxy = skyOut.items.filter(i => i.key === 'galaxy')[0]
  const star = skyOut.items.filter(i => i.key === 'star')[0]
  const fctx = {
    date: '2026-07-15', detail: d1, days: [], elevation: ELEV,
    sun: skyOut.sun, moon: skyOut.moon, night: skyOut.night,
  }
  const base = cond.factsFor('galaxy', fctx)
  const withItem = cond.factsFor('galaxy', Object.assign({}, fctx, { item: galaxy }))
  check('跨夜 item.at 落在次日（' + galaxy.at + '）', galaxy.at.slice(0, 10) === '2026-07-16', galaxy.at)
  check('跨夜证据的 at 全部变成完整日期，且 === item.at',
    withItem.length > 0 && withItem.every(f => f.at === galaxy.at), JSON.stringify(withItem))
  check('跨夜证据的 fact/kind/顺序与不传 item 时逐字节相同（只改锚点，不改事实）',
    withItem.length === base.length
      && withItem.every((f, i) => f.fact === base[i].fact && f.kind === base[i].kind)
      && base.every(f => /^\d{2}:\d{2}$/.test(f.at)), JSON.stringify({ base, withItem }))
  check('非跨夜（star 的 at 就在所选日）仍输出 HH:mm，与旧形态一致',
    cond.factsFor('star', Object.assign({}, fctx, { item: star }))
      .every(f => /^\d{2}:\d{2}$/.test(f.at)))
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

/* ---------- 6. 总评均分（light 不参与，规则同 conditions.overallGrade） ---------- */

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
  check('空清单 → 数据不足，不冒充条件较差', (() => {
    const e = cond.overallGrade([])
    return e.label === '数据不足' && e.insufficient === true && e.stars === ''
  })())
  check('全为 light → 同样数据不足', (() => {
    const e = cond.overallGrade([{ key: 'light', score: 100 }])
    return e.label === '数据不足' && e.insufficient === true
  })())
  /* 沉默闸（第十轮）：页面上已经不出现的卡，不能再替总评投票。
     被排除的云海可以攥着 64 分（≥45 会进 live），旧规则下它会把 90 的星空拉成 77——
     看不见的证据决定看得见的结论。 */
  check('excluded 的高分项不进 live（只剩星空 90 说话）', (() => {
    const g2 = cond.overallGrade([
      { key: 'cloudSea', score: 64, tone: 'warning', label: '条件一般', verdict: 'excluded' },
      { key: 'star', score: 90, tone: 'success', label: '条件较好', verdict: 'possible' },
    ])
    return g2.score === 90
  })(), JSON.stringify(cond.overallGrade([
    { key: 'cloudSea', score: 64, verdict: 'excluded' },
    { key: 'star', score: 90, verdict: 'possible' },
  ])))
  check('unknown 不投票（缺测不是 0 分）', (() => {
    const g3 = cond.overallGrade([
      { key: 'cloudSea', score: 80, verdict: 'unknown' },
      { key: 'star', score: 90, verdict: 'possible' },
    ])
    return g3.score === 90
  })())
  check('全部被判不成立 → 条件较差，不是数据不足', (() => {
    const g6 = cond.overallGrade([
      { key: 'star', score: 0, verdict: 'excluded' },
      { key: 'cloudSea', score: 64, verdict: 'excluded' },
    ])
    return g6.label === '条件较差' && g6.insufficient === false && !!g6.stars
  })())
  check('星空/银河同一类只投一次（银河优先）', (() => {
    const g4 = cond.overallGrade([
      { key: 'star', score: 60, verdict: 'possible' },
      { key: 'galaxy', score: 90, verdict: 'possible' },
    ])
    return g4.score === 90
  })())
  check('银河 unknown 时星空仍可代表夜空', (() => {
    const g5 = cond.overallGrade([
      { key: 'star', score: 60, verdict: 'possible' },
      { key: 'galaxy', score: 90, verdict: 'unknown' },
    ])
    return g5.score === 60
  })())
  /* 反向：没有 verdict 的旧形状必须照常参与（isSilent 失败开放）。
     上面那组 65 分的用例就是这一条的活证据，这里再点名一次，免得以后有人
     把"缺 verdict"当成"已被沉默"来减卡。 */
  check('缺 verdict 的项不被当成 excluded（失败开放）',
    cond.overallGrade(items).score === 65, JSON.stringify(cond.overallGrade(items)))
}

console.log('\npassed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
