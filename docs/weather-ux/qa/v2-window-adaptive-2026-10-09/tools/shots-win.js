/* 显示窗自适应轮 · 真机取证驱动（390px）
 *
 * 两类证据分开记，不混为一谈：
 *   REAL   —— 线上真实预报（走云函数），证明真数据下的窗、边注、判读；
 *   SYNTH  —— 同一套生产渲染路径（page.applyWeather → buildUnifiedCard → renderUnifiedBase），
 *             只有数据来源是受控的：任务是「云在窗上/窗下/跨边界/晴空/缺高程/无云场」这六种形态，
 *             线上数据不保证当次就有这六种，所以注入数据、但渲染与判读跑的是仓库里的真代码。
 * bundle 新鲜度探针：unified.elevShown 是本轮新字段，缺失 = IDE 还在跑旧编译产物。
 * 运行（依赖装在仓库外）：node shots-win.js <OUT_DIR> ws://127.0.0.1:<AUTO_PORT> <before|after>
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const OUT = process.argv[2]
const WS = process.argv[3] || 'ws://127.0.0.1:9454'
const TAG = process.argv[4] || 'after'
const MODE = process.argv[5] || 'all'   // all | real | synth
const DATE = '2026-10-09'
fs.mkdirSync(OUT, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))

const REAL = [
  { key: 'emeishan', name: '峨眉山', lat: 29.52, lng: 103.34, ele: 3004, eleSrc: 'picked', spans: [24, 72] },
  { key: 'litang', name: '理塘', lat: 30.002, lng: 100.27, ele: 4058, eleSrc: 'picked', spans: [24, 48] },
  { key: 'chengdu', name: '成都', lat: 30.5728, lng: 104.0668, ele: null, eleSrc: null, spans: [24] },
]
function deckLevels (decks) {
  const times = []
  for (let h = 0; h < 24; h++) times.push(DATE + 'T' + String(h).padStart(2, '0') + ':00')
  const stations = []
  decks.forEach(d => { stations.push({ alt: d.lo, cov: d.cov }); stations.push({ alt: d.hi, cov: d.cov }) })
  if (!stations.length) stations.push({ alt: 2000, cov: 6 }, { alt: 4000, cov: 6 })
  return { times, levels: stations.map(s => ({ altitudes: times.map(() => s.alt), cloudCover: times.map(() => s.cov) })) }
}
function seriesRows () {
  const out = []
  for (let h = 0; h < 24; h++) out.push({
    d: DATE, t: String(h).padStart(2, '0') + ':00', temp: 8, feels: 7, pop: 10, precip: 0, showers: 0,
    code: 1, wind: 6, gust: 12, windDir: 90, rh: 55, uv: 3, visibility: 24,
    cloud: { low: 30, mid: 10, high: 10 }, band: null,
  })
  return out
}
const SYNTH = [
  { key: 'deck-below', label: '云全部在显示窗下方', decks: [{ lo: 900, hi: 1650, cov: 92 }], ele: 4058, eleSrc: 'picked' },
  { key: 'deck-above', label: '云全部在显示窗上方', decks: [{ lo: 6100, hi: 6450, cov: 88 }], ele: 4058, eleSrc: 'picked' },
  { key: 'deck-cross', label: '云跨越显示窗边界', decks: [{ lo: 1700, hi: 2400, cov: 90 }], ele: 3004, eleSrc: 'picked' },
  { key: 'clear', label: '确认晴空（包络内没有有意义云量）', decks: [], ele: 3500, eleSrc: 'manual' },
  { key: 'no-altitude', label: '缺少可信高程', decks: [{ lo: 3150, hi: 3850, cov: 85 }], ele: null, eleSrc: null, noModelEle: true },
  { key: 'no-cloudfield', label: '云层数据缺失（无 cloudLevels）', decks: null, ele: 3500, eleSrc: 'picked' },
]

async function waitForUnified (mp, ms) {
  const t0 = Date.now()
  let page = await mp.currentPage()
  while (Date.now() - t0 < ms) {
    const d = await page.data()
    if (d.unified && d.unified.src) return { page, d }
    if (d.denied) throw new Error('denied: ' + d.denied)
    await sleep(1500)
    page = await mp.currentPage()
  }
  throw new Error('统一 Meteogram 未在 ' + ms + 'ms 内出现')
}
async function shot (mp, file) {
  fs.writeFileSync(path.join(OUT, file), Buffer.from(String(await mp.screenshot()), 'base64'))
  return fs.statSync(path.join(OUT, file)).size
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: WS })
  const si = await mp.systemInfo()
  console.log('viewport=' + si.windowWidth + 'x' + si.windowHeight + ' dpr=' + si.pixelRatio + ' set=' + TAG)
  const manifest = { set: TAG, capturedAt: new Date().toISOString(),
    simulator: { windowWidth: si.windowWidth, windowHeight: si.windowHeight, pixelRatio: si.pixelRatio },
    note: 'REAL = 线上真实预报；SYNTH = 生产渲染路径 + 受控数据集（六种形态线上不保证当次出现）', shots: [] }

  for (const p of (MODE === 'synth' ? [] : REAL)) {
    for (const span of p.spans) {
      let page = null, d = null
      try {
        let u = '/pages/weather/weather?src=local&lat=' + p.lat + '&lng=' + p.lng + '&name=' + encodeURIComponent(p.name) + '&date=' + DATE
        if (p.ele != null) u += '&ele=' + p.ele + '&eleSrc=' + p.eleSrc
        await mp.reLaunch(u)
        await sleep(2500)
        const r = await waitForUnified(mp, 30000)
        page = r.page; d = r.d
        if (span !== 24) {
          await page.callMethod('onSpanToggle', { currentTarget: { dataset: { span: String(span) } }, target: { dataset: { span: String(span) } } })
          await sleep(1800)
          const r2 = await waitForUnified(mp, 30000)
          page = r2.page; d = r2.d
        }
        await page.callMethod('ensureMeteogramVisible')
        await sleep(1000)
        const id = 'win-' + TAG + '-REAL-' + p.key + '-' + span + 'h-' + si.windowWidth + 'px-full.png'
        const bytes = await shot(mp, id)
        const row = { kind: 'REAL', file: id, place: p.name, eleArg: p.ele, eleSrcArg: p.eleSrc,
          viewSpan: d.viewSpan, updatedAt: d.updatedAt, chartElev: d.chartElev, bytes: bytes,
          bundleFresh: d.unified.elevShown !== undefined,
          legendElev: d.unified.legendElev, elevShown: d.unified.elevShown, legendIn: d.unified.legendIn,
          r1: d.unified.r1, r2: d.unified.r2, r3: d.unified.r3, stKey: d.unified.stKey }
        try {
          const geo = await page.$('cloud-field')
          row.geoNote = geo ? 'el' : null
        } catch (e) {}
        const img = await page.$('.cf-img')
        if (img) {
          await img.tap(); await sleep(1500)
          const d2 = await page.data()
          row.tap = { hour: d2.unified.hour, r2: d2.unified.r2, r3: d2.unified.r3, stKey: d2.unified.stKey,
            subjectOk: (d2.unified.r3 || '').indexOf('你') === -1 && (d2.unified.legendElev || '').indexOf('你') === -1 }
          const tfile = 'win-' + TAG + '-REAL-' + p.key + '-' + span + 'h-' + si.windowWidth + 'px-tap.png'
          row.tapFile = tfile
          await shot(mp, tfile)
        }
        manifest.shots.push(row)
        console.log('  REAL ' + p.key + '/' + span + 'h fresh=' + row.bundleFresh + ' 图例="' + row.legendElev +
          '" r3="' + (row.tap ? row.tap.r3 : row.r3) + '"')
      } catch (e) {
        manifest.shots.push({ kind: 'REAL', place: p.name, viewSpan: span, error: String(e.message) })
        console.log('  REAL FAIL ' + p.key + '/' + span + ': ' + e.message)
      }
    }
  }

  for (const sc of (MODE === 'real' ? [] : SYNTH)) {
    try {
      await mp.reLaunch('/pages/weather/weather?src=local&lat=30.002&lng=100.27&name=' +
        encodeURIComponent('受控场景') + '&date=' + DATE)
      await sleep(2200)
      let page = await mp.currentPage()
      const point = { id: 'p1', name: '受控场景', coordinates: { lat: 30.002, lng: 100.27 }, ele: sc.ele, eleSource: sc.eleSrc }
      const result = {
        status: 'ready', updatedAt: DATE + 'T09:00:00+08:00',
        pointElevation: sc.noModelEle ? null : 3650,
        series: seriesRows(), days: [], detail: [],
      }
      if (sc.decks) result.cloudLevels = deckLevels(sc.decks)
      await page.callMethod('applyWeather', result, point, {})
      await sleep(1600)
      page = await mp.currentPage()
      let d = await page.data()
      const hasCard = !!(d.unified && d.unified.src)
      if (hasCard) { await page.callMethod('ensureMeteogramVisible'); await sleep(900) }
      const id = 'win-' + TAG + '-SYNTH-' + sc.key + '-' + si.windowWidth + 'px-' + (hasCard ? 'full' : 'nocard') + '.png'
      const bytes = await shot(mp, id)
      const row = { kind: 'SYNTH', scenario: sc.label, key: sc.key, decks: sc.decks, eleArg: sc.ele, eleSrcArg: sc.eleSrc,
        unifiedCard: hasCard, file: id, bytes: bytes,
        bundleFresh: hasCard ? d.unified.elevShown !== undefined : 'no-card',
        chartElev: d.chartElev, eleText: (d.pointCard && d.pointCard.eleText) || '' }
      if (hasCard) {
        const img = await page.$('.cf-img')
        if (img) { await img.tap(); await sleep(1400) }
        let d2 = await page.data()
        let pickMode = img ? 'real-tap' : 'none'
        /* 真实点击没落到小时上时（受控场景的卡片位置随注入时机而变），
           再用页面自己的选择器驱动一次，并如实记下这一档证据是「程序化驱动 + 读数」而不是真 tap。 */
        if (!d2.unified.r1) {
          await page.callMethod('onChartPickHour', { detail: { date: DATE, t: '13:00' } })
          await sleep(1200)
          d2 = await page.data()
          pickMode = d2.unified.r1 ? pickMode + '+programmatic' : pickMode + '+(still-empty)'
        }
        row.pickMode = pickMode
        row.legendElev = d2.unified.legendElev
        row.elevShown = d2.unified.elevShown
        row.legendIn = d2.unified.legendIn
        row.r1 = d2.unified.r1; row.r2 = d2.unified.r2; row.r3 = d2.unified.r3; row.stKey = d2.unified.stKey
        row.subjectOk = (d2.unified.r3 || '').indexOf('你') === -1 && (d2.unified.legendElev || '').indexOf('你') === -1
        row.noNullLeak = !/null|NaN|undefined/.test([d2.unified.r1, d2.unified.r2, d2.unified.r3, d2.unified.r4, d2.unified.legendElev].join(' '))
        const pfile = 'win-' + TAG + '-SYNTH-' + sc.key + '-' + si.windowWidth + 'px-pick.png'
        await shot(mp, pfile)
        row.pickFile = pfile
      }
      manifest.shots.push(row)
      console.log('  SYNTH ' + sc.key + ' card=' + hasCard + ' fresh=' + row.bundleFresh + ' pick=' + (row.pickMode || '—') +
        ' 图例="' + (row.legendElev || '—') + '" r3="' + (row.r3 === undefined ? '—' : row.r3) + '" null泄漏=' + row.noNullLeak)
    } catch (e) {
      manifest.shots.push({ kind: 'SYNTH', key: sc.key, scenario: sc.label, error: String(e.message) })
      console.log('  SYNTH FAIL ' + sc.key + ': ' + e.message)
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest-' + TAG + '.json'), JSON.stringify(manifest, null, 2))
  try { await mp.disconnect() } catch (e) {}
  console.log('done →', OUT)
})().catch(e => { console.error('DRIVER FAIL', e && e.message); process.exit(1) })
