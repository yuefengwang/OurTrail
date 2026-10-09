/* 云层位置语义统一轮 · 真机取证驱动（390px）
 *
 * 与上一轮的 ot-v2-shots-c.js 同一手法，但判据换成这一轮真正要证的三件事：
 *   ① r3 的中文（三态各一条，必须来自主动更新后的 bundle —— legendIn 是新字段，
 *      它为空就说明 IDE 还在用旧编译产物，不能拿旧 bundle 当修复后结果）；
 *   ② r3 / 图例里不再出现「你」这个主语（查询点不是用户本人）；
 *   ③ 一次真实点击的后果：选中前 r3 为空、选中后有词或明确弃权（reason 可见于读数行）。
 * 运行（依赖装在仓库外，本仓库零 npm）：
 *   node shots-cp.js <OUT_DIR> ws://127.0.0.1:<AUTO_PORT> <before|after> [id,id]
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const OUT = process.argv[2]
const WS = process.argv[3] || 'ws://127.0.0.1:9453'
const TAG = process.argv[4] || 'after'
const ONLY = (process.argv[5] || '').split(',').filter(Boolean)
fs.mkdirSync(OUT, { recursive: true })

const PLACES = [
  { key: 'emeishan', name: '峨眉山', lat: 29.52, lng: 103.34, ele: 3004, eleSrc: 'picked' },
  { key: 'litang', name: '理塘', lat: 30.002, lng: 100.27, ele: 4058, eleSrc: 'picked' },
  { key: 'chengdu', name: '成都', lat: 30.5728, lng: 104.0668, ele: null, eleSrc: null },
  { key: 'litang-manual', name: '理塘（手填坐标）', lat: 30.002, lng: 100.27, ele: 4058, eleSrc: 'manual' },
]
const SPANS = [24, 48, 72]
const sleep = ms => new Promise(r => setTimeout(r, ms))

function url (p) {
  let u = '/pages/weather/weather?src=local&lat=' + p.lat + '&lng=' + p.lng + '&name=' + encodeURIComponent(p.name)
  if (p.ele != null) u += '&ele=' + p.ele + '&eleSrc=' + p.eleSrc
  return u
}
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

;(async () => {
  const mp = await automator.connect({ wsEndpoint: WS })
  const si = await mp.systemInfo()
  console.log('viewport=' + si.windowWidth + 'x' + si.windowHeight + ' dpr=' + si.pixelRatio + ' set=' + TAG)
  const manifest = {
    set: TAG, capturedAt: new Date().toISOString(),
    simulator: { windowWidth: si.windowWidth, windowHeight: si.windowHeight, pixelRatio: si.pixelRatio },
    shots: [],
  }
  for (const p of PLACES) {
    for (const span of SPANS) {
      const id = p.key + '-' + span
      if (ONLY.length && ONLY.indexOf(id) < 0) continue
      const tag = p.key + '-' + span + 'h'
      try {
        await mp.reLaunch(url(p))
        await sleep(2500)
        let { page, d } = await waitForUnified(mp, 30000)
        if (span !== 24) {
          await page.callMethod('onSpanToggle', { currentTarget: { dataset: { span: String(span) } }, target: { dataset: { span: String(span) } } })
          await sleep(1500)
          const r = await waitForUnified(mp, 30000)
          page = r.page; d = r.d
        }
        await page.callMethod('ensureMeteogramVisible')
        await sleep(1200)
        const full = 'cp-' + TAG + '-' + tag + '-' + si.windowWidth + 'px-full.png'
        fs.writeFileSync(path.join(OUT, full), Buffer.from(String(await mp.screenshot()), 'base64'))
        /* bundle 新鲜度探针：legendIn 是这一轮才有的字段，缺失 = IDE 还在跑旧编译产物 */
        const bundleFresh = !!d.unified.legendIn
        const row = {
          file: full, place: p.name, lat: p.lat, lng: p.lng, eleArg: p.ele, eleSrcArg: p.eleSrc,
          set: TAG, viewSpan: d.viewSpan, updatedAt: d.updatedAt, chartElev: d.chartElev,
          legendIn: d.unified.legendIn || null, bundleFresh: bundleFresh,
          r1: d.unified.r1, r2: d.unified.r2, r3: d.unified.r3, stKey: d.unified.stKey,
          bytes: fs.statSync(path.join(OUT, full)).size,
        }
        try {
          const img = await page.$('.cf-img')
          const before = (await page.data()).unified
          if (img) {
            await img.tap()
            await sleep(1800)
            const d2 = await page.data()
            row.tap = {
              beforeR3: before.r3 || '', afterR3: d2.unified.r3 || '', afterStKey: d2.unified.stKey || '',
              afterSel: !!(d2.unified && d2.unified.selSrc), hour: d2.unified && d2.unified.hour,
              r2after: d2.unified && d2.unified.r2,
              /* 这一轮的主语判据：屏幕上的读数行与图例都不许出现「你」 */
              subjectOk: (d2.unified.r3 || '').indexOf('你') === -1 && (d2.unified.legendIn || '').indexOf('你') === -1,
            }
            if (d2.unified && d2.unified.selSrc) {
              const sel = 'cp-' + TAG + '-' + tag + '-' + si.windowWidth + 'px-tap.png'
              fs.writeFileSync(path.join(OUT, sel), Buffer.from(String(await mp.screenshot()), 'base64'))
              row.tapFile = sel
            }
          }
        } catch (e) { row.tapErr = String(e.message) }
        manifest.shots.push(row)
        console.log('  ok ' + tag, 'fresh=' + bundleFresh, 'r3="' + (row.tap ? row.tap.afterR3 : d.unified.r3) + '"',
          'subject=' + (row.tap ? row.tap.subjectOk : '—'))
      } catch (e) {
        console.log('  SKIP ' + tag + ': ' + e.message)
        manifest.shots.push({ place: p.name, span, set: TAG, error: String(e.message) })
      }
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest-' + TAG + '.json'), JSON.stringify(manifest, null, 2))
  try { await mp.disconnect() } catch (e) {}
  console.log('done →', OUT)
})().catch(e => { console.error('DRIVER FAIL', e && e.message); process.exit(1) })
