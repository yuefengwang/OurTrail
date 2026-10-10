/* 真机核验（第十二轮）：「天文暗夜始」那句机会句只在真有银河小时时说
 *
 * 三用例（复用上一轮的夹具）：
 *   A 满云        → 时刻必须在，sub 必须为空（银河卡已被沉默闸收掉，这一行不许再替它背书）
 *   B 晴夜有戏    → 时刻在，sub 仍是「银河与深空窗口」（不许一刀切把真机会也抹掉）
 *   C 无高程同 B  → sub 也同 B（这句话的主语是当晚的云与月，不是海拔）
 * 同时复核上一轮：A 四条摄影窗口带后缀、B/C 零后缀；结论卡 A 0 张 + 沉默行 1 行、B/C 5 张。
 *
 * 反缓存三件：每用例 reLaunch + 独立 updatedAt + 三用例读数互不相同，相同即整批作废。
 * 运行：node verify-dark-window-device.js（需 miniprogram-automator；改过代码要先 close+open 重编译）
 */
const WS = 'ws://127.0.0.1:' + (process.env.WS_PORT || '9421')
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const SNAP = JSON.parse(fs.readFileSync('D:/OurTrail/docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', 'utf8'))
const P = SNAP.places.emeishan
const OUT = 'D:/OurTrail/docs/weather-ux/qa/v2-dark-window-note-2026-10-10/device'
fs.mkdirSync(OUT, { recursive: true })
const DATE = '2026-10-09'
const ELE = P.elevation
const hourOf = t => Number(String(t).slice(11, 13))

function seaCover (lvl, t, i) {
  const h = hourOf(t)
  const alt = (lvl.altitudes || [])[i]
  if (h < 6 || h > 9) return 0
  return alt >= 950 && alt <= 1550 ? 95 : 6
}
function flatCover () { return 100 }

const CASES = [
  ['A-overcast', '2026-10-09T10:00:00+08:00',
    () => ({ cloud: { low: 100, mid: 100, high: 100 }, precip: 0, showers: 0, pop: 5, rh: 95 }),
    flatCover, true, { cardEls: 0, silentEls: 1, noteEls: 4, darkSub: null }],
  ['B-packed', '2026-10-09T11:00:00+08:00',
    h => {
      const hh = Number(h.t.slice(0, 2))
      const dye = hh >= 6 && hh <= 7
      const wet = hh >= 8 && hh <= 9
      return {
        cloud: dye ? { low: 10, mid: 30, high: 20 } : wet ? { low: 20, mid: 15, high: 10 } : { low: 20, mid: 10, high: 10 },
        precip: wet ? 0.3 : 0, showers: wet ? 0.1 : 0, pop: dye ? 20 : wet ? 30 : 5, rh: wet ? 92 : 60,
      }
    },
    seaCover, true, { cardEls: 5, silentEls: 0, noteEls: 0, darkSub: '银河与深空窗口' }],
  ['C-no-altitude', '2026-10-09T12:00:00+08:00', null, null, false, { cardEls: 5, silentEls: 0, noteEls: 0, darkSub: '银河与深空窗口' }],
]

function ser (mut) {
  return P.series.filter(h => h.d === DATE).map(h => {
    const m = mut(h)
    const o = Object.assign({}, h, m)
    if (m.cloud) o.cloud = Object.assign({}, h.cloud, m.cloud)
    return o
  })
}
function daysOf (rows) {
  const hs = rows
  const mean = f => Math.round(hs.reduce((s, h) => s + (f(h) || 0), 0) / hs.length)
  return [{
    date: DATE, code: hs.reduce((a, b) => (b.code > a ? b.code : a), 0),
    tMax: Math.max.apply(null, hs.map(h => h.temp)), tMin: Math.min.apply(null, hs.map(h => h.temp)),
    windMax: Math.max.apply(null, hs.map(h => h.wind)),
    precipSum: Math.round(hs.reduce((s, h) => s + h.precip + h.showers, 0) * 10) / 10,
    precipProbMax: Math.max.apply(null, hs.map(h => h.pop)),
    precipHours: hs.filter(h => h.precip + h.showers > 0).length,
    sunrise: '06:52', sunset: '18:20',
    uvMax: Math.max.apply(null, hs.map(h => h.uv || 0)),
    cloud: { low: mean(h => h.cloud.low), mid: mean(h => h.cloud.mid), high: mean(h => h.cloud.high) },
  }]
}
function levelsOf (coverFn) {
  return {
    times: P.cloudLevels.times.slice(),
    unit: P.cloudLevels.unit || 'm',
    levels: P.cloudLevels.levels.map(l => ({
      pressure: l.pressure, altitudes: l.altitudes.slice(),
      cloudCover: P.cloudLevels.times.map((t, i) => coverFn(l, t, i)),
    })),
  }
}

const seen = {}
;(async () => {
  const mp = await automator.connect({ wsEndpoint: WS })
  for (let ci = 0; ci < CASES.length; ci++) {
    const name = CASES[ci][0]
    const updatedAt = CASES[ci][1]
    const mut = CASES[ci][2] || CASES[1][2]
    const cover = CASES[ci][3] || CASES[1][3]
    const hasEle = CASES[ci][4]
    const want = CASES[ci][5]
    let page = await mp.reLaunch('/pages/weather/weather')
    await page.waitFor(5000)
    const rows = ser(mut)
    await page.setData({ date: DATE, loading: false, denied: '', loadingWeather: false })
    const result = {
      status: 'ok', updatedAt,
      provider: { id: 'open-meteo', label: 'Open-Meteo', attribution: 'Open-Meteo.com（CC BY 4.0）' },
      days: daysOf(rows), series: rows,
      pointElevation: hasEle ? ELE : null,
      cloudLevels: levelsOf(cover),
    }
    const point = hasEle
      ? { ele: ELE, eleSource: 'gpx', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点' }
      : { ele: null, eleSource: '', coordinates: { lat: P.gcj[0], lng: P.gcj[1] }, name: '核验点（无高程）' }
    await page.callMethod('applyWeather', result, point, {})
    await page.waitFor(4000)
    page = await mp.currentPage()

    const gates = {
      dayCards: ((await page.data('dayCards')) || []).length,
      unified: !!(await page.data('unified')),
      chartSeries: ((await page.data('chartSeries')) || []).length,
      loadingWeather: await page.data('loadingWeather'),
    }
    const cards = (await page.data('condCards')) || []
    const silent = await page.data('condSilent')
    const agenda = (await page.data('agenda')) || []
    const photo = agenda.filter(e => /黄金时刻|蓝调时刻/.test(e.title))
    const noted = photo.filter(e => /当时低云/.test(e.sub || ''))
    const dark = agenda.filter(e => e.title === '天文暗夜始')[0] || {}
    const els = await page.$$('.cond-pheno')
    const sils = await page.$$('.cond-silent')
    // 像素层：日程条目渲染在 `.card.agenda` 里，每条的 sub 是 `.ag-sub`（wx:if="{{item.sub}}"）。
    // （第一版这里查的是 `.timeline-card` —— 那是 `wx:if="{{!unified}}"` 的经典 canvas 兜底块，
    //   统一图存在时整块不渲染，于是"data 有、屏上没有"的假红就是这么造出来的。）
    const subEls = await page.$$('.ag-sub')
    const subTexts = []
    for (const el of subEls) subTexts.push(String(await el.text()).replace(/\s+/g, ' '))
    const agEl = await page.$('.agenda')
    const agText = agEl ? String(await agEl.text()).replace(/\s+/g, ' ') : ''
    seen[name] = {
      gates, cardEls: els.length, cards: cards.map(c => c.key + ' ' + c.stars).join(' | '),
      silentEls: sils.length, silentTitles: silent ? silent.titles : null,
      photo: photo.map(e => e.t + ' ' + e.title + ' → ' + (e.sub || '—')),
      noteEls: noted.length,
      暗夜时刻: dark.t || null, 暗夜sub: dark.sub || null,
      像素含机会句: /银河与深空窗口/.test(agText),
      像素后缀行数: subTexts.filter(s => /当时低云/.test(s)).length,
      日程块含后缀: /当时低云/.test(agText),
      elevation: await page.data('chartElev'),
    }
    console.log('\n### ' + name + ' | 门槛 ' + JSON.stringify(gates) + ' | 卡 ' + els.length + ' | 沉默行 ' + sils.length)
    ;(seen[name].photo || []).forEach(l => console.log('   ' + l))
    console.log('   后缀条数 ' + noted.length + ' / 4 ｜ 像素层 .ag-sub 里带后缀的行数 '
      + seen[name].像素后缀行数 + ' ｜ 日程整块文本命中：' + seen[name].日程块含后缀)
    console.log('   天文暗夜始 时刻=' + (dark.t || '—') + ' sub=' + JSON.stringify(dark.sub || null)
      + ' ｜ 像素里出现机会句：' + seen[name].像素含机会句)

    const fails = []
    if (els.length !== want.cardEls) fails.push('结论卡 ' + els.length + ' ≠ ' + want.cardEls)
    if (sils.length !== want.silentEls) fails.push('沉默行 ' + sils.length + ' ≠ ' + want.silentEls)
    if (noted.length !== want.noteEls) fails.push('带后缀的摄影窗口 ' + noted.length + ' ≠ ' + want.noteEls)
    if (photo.length !== 4) fails.push('摄影窗口条目数 ' + photo.length + ' ≠ 4（时间不许裁）')
    // 本轮主判据：时刻永远在；机会句只在真有银河的那晚说
    if (!dark.t) fails.push('「天文暗夜始」时刻消失了（客观事实不许被天气吃掉）')
    if ((dark.sub || null) !== want.darkSub) fails.push('机会句读数 ' + JSON.stringify(dark.sub || null) + ' ≠ ' + JSON.stringify(want.darkSub))
    if (seen[name].像素含机会句 !== (want.darkSub !== null)) fails.push('像素层与 data 不一致（机会句）')
    // data 与像素必须同向：只在 data 里出现后缀不算通过（铁律 21/32⑥）
    if (seen[name].像素后缀行数 !== want.noteEls) fails.push('像素层 .ag-sub 带后缀行数 ' + seen[name].像素后缀行数 + ' ≠ ' + want.noteEls)
    if (name === 'A-overcast') {
      if (!photo.every(e => /当时低云 100%/.test(e.sub || ''))) fails.push('A 的四条后缀不全')
      const blue = photo.filter(e => e.title === '蓝调时刻（晨）')[0] || {}
      if ((blue.sub || '').indexOf('天空最蓝的十几分钟（') !== 0) fails.push('后缀不是"加"上去的（改写了原话）')
      if (!seen[name].日程块含后缀) fails.push('像素层没看到后缀（data 有、屏上没有）')
    }
    seen[name].判定 = fails.length ? 'FAIL: ' + fails.join('；') : 'PASS'
    console.log('   判定 → ' + seen[name].判定)

    for (let i = 0; i < 4; i++) {
      await mp.pageScrollTo(i * 700)
      await page.waitFor(700)
      fs.writeFileSync(path.join(OUT, name + '-' + i + '.png'),
        Buffer.from(String(await mp.screenshot()), 'base64'))
    }
    await mp.pageScrollTo(0)
  }
  fs.writeFileSync(path.join(OUT, 'readings.json'), JSON.stringify(seen, null, 2))
  const keys = Object.keys(seen)
  let dup = false
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (JSON.stringify(seen[keys[i]].photo) === JSON.stringify(seen[keys[j]].photo)
        && seen[keys[i]].cards === seen[keys[j]].cards) dup = true
    }
  }
  console.log('\n污染自证：三用例的摄影窗口/卡集合读数' + (dup ? '**有完全相同者 → 判定无效**' : '互不相同 ✓'))
  const bad = keys.filter(k => seen[k].判定.indexOf('PASS') !== 0)
  await mp.disconnect()
  console.log(bad.length ? '不通过用例：' + bad.join(',') : '三个用例全部通过')
  process.exit(dup || bad.length ? 1 : 0)
})().catch(e => { console.error('驱动失败：', e && e.message); process.exit(1) })
