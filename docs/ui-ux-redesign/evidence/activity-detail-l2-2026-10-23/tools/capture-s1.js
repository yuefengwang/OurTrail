// S1 真机取证驱动（微信开发者工具 automator）。
// 用法：NODE_PATH="<mp-auto>/node_modules" node tools/capture-s1.js --side=s1|a1|a0
// side=s1 用新 renderView 夹具；a1/a0 用 HEAD(e05e559) renderView 夹具。
// 三道门槛（BASELINE §4.4）任一不成立 → 该场景 INVALID，图进 invalid/，不改判通过。
'use strict'
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const ARG = {}
process.argv.slice(2).forEach(s => {
  const m = /^--([^=]+)=(.*)$/.exec(s)
  if (m) ARG[m[1]] = m[2]
})
const SIDE = ARG.side || 's1'
const PACK = path.resolve(__dirname, '..')
const FIXDIR = path.join(PACK, 'fixtures', SIDE === 's1' ? '' : 'baseline')
const OUTDIR = path.join(PACK, SIDE === 's1' ? 's1' : 'baseline-' + SIDE.toUpperCase())
const READDIR = path.join(PACK, 'readings')
const INVALID = path.join(PACK, 'invalid')
const WS = ARG.ws || 'ws://127.0.0.1:9421'

const ALL = ['rich', 'sparse', 'long-title', 'cover-failed']
const SCENARIOS = SIDE === 'a0' ? ['rich'] : (ARG.scenarios ? ARG.scenarios.split(',') : ALL)

const sleep = ms => new Promise(r => setTimeout(r, ms))
const j = o => JSON.stringify(o)

function savePng(name, buf) {
  fs.writeFileSync(name, buf)
  return { file: path.basename(name), bytes: buf.length, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}
async function shot(mp, file, invalid) {
  const raw = await mp.screenshot()
  const buf = Buffer.from(String(raw), 'base64')
  if (buf.length < 8 || buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('截图不是 PNG')
  const dir = invalid ? INVALID : OUTDIR
  fs.mkdirSync(dir, { recursive: true })
  return savePng(path.join(dir, file), buf)
}
async function box(el) {
  if (!el) return null
  const o = await el.offset()
  const s = await el.size()
  return { left: +o.left.toFixed(2), top: +o.top.toFixed(2), width: +s.width.toFixed(2), height: +s.height.toFixed(2) }
}
async function textOf(el, sel) {
  const x = await el.$(sel)
  if (!x) return ''
  return (await x.text()) || ''
}
async function cellsOf(grid) {
  const cells = await grid.$$('.fact-cell')
  const out = []
  for (const c of cells) {
    out.push({
      box: await box(c),
      label: (await textOf(c, '.fact-cell__label')).trim(),
      value: (await textOf(c, '.fact-cell__value')).trim(),
      unit: (await textOf(c, '.fact-cell__unit')).trim(),
      sub: (await textOf(c, '.fact-cell__sub')).trim(),
    })
  }
  return out
}
function columnCheck(cells) {
  const rows = {}
  cells.forEach(c => {
    const k = Math.round(c.box.top)
    ;(rows[k] = rows[k] || []).push(c)
  })
  const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b)
  const widths = rowKeys.map(k => rows[k].map(c => c.box.width))
  const maxInRow = Math.max.apply(null, rowKeys.map(k => rows[k].length))
  const wdiffs = widths.map(ws => (ws.length > 1 ? Math.max.apply(null, ws) - Math.min.apply(null, ws) : 0))
  return { rowCount: rowKeys.length, maxInRow, widthDiffs: wdiffs.map(x => +x.toFixed(2)) }
}
function overflow(boxes, vw) {
  const rights = boxes.filter(Boolean).map(b => b.left + b.width)
  const lefts = boxes.filter(Boolean).map(b => b.left)
  return {
    viewportWidth: vw,
    maxRight: +Math.max.apply(null, rights).toFixed(2),
    minLeft: +Math.min.apply(null, lefts).toFixed(2),
    overflowRight: +(Math.max.apply(null, rights) - vw).toFixed(2),
  }
}

// 样式就绪门：首启后第一次 reLaunch 可能 DOM 已就绪而 wxss 尚未生效
// （实测首帧 hero media 291px、信息格单列、页面无内边距）。只认固定设计的 240px 媒体高。
async function styleReady(page, isS1, viewport) {
  const t0 = Date.now()
  while (Date.now() - t0 < 12000) {
    const media = await page.$('.hero-cover-media')
    const mb = media ? await box(media) : null
    let ok = !!mb && Math.abs(mb.height - 240) <= 1
    if (ok && isS1) {
      const card = await page.$('.act-info')
      const cb = card ? await box(card) : null
      ok = !!cb && cb.width >= 300 && cb.left + cb.width <= viewport.windowWidth + 1
    }
    if (ok) return { ok: true, waitedMs: Date.now() - t0 }
    await page.waitFor(300)
  }
  return { ok: false, waitedMs: Date.now() - t0 }
}

async function pageGates(page, fixture, selector) {
  const d1 = await page.data()
  const gate1 = d1.loading === false
  await page.setData(fixture)
  await page.waitFor(600)
  const d = await page.data()
  const gate2 = d.title === fixture.title
  const sel = selector === 'activity-hero' ? await page.$('activity-hero') : await page.$(selector)
  const gate3 = !!sel
  return { gate1, gate2, gate3, data: d }
}

async function captureActivity(mp, name, viewport) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXDIR, name + '.json'), 'utf8'))
  const isS1 = SIDE === 's1'
  const out = {
    side: SIDE, scenario: name, capturedAt: new Date().toISOString(), viewport,
    fixture: { file: path.relative(PACK, path.join(FIXDIR, name + '.json')), title: fixture.title },
    gates: {}, markers: {}, geometry: {}, screenshot: null, status: 'VALID',
  }
  const page = await mp.reLaunch('/pages/activity/activity?id=fixture-a1')
  await page.waitFor(1600)
  const g = await pageGates(page, fixture, isS1 ? 'activity-hero' : '#sec-facts')
  out.gates = { loadingFalse: g.gate1, titleIntact: g.gate2, selectorFound: g.gate3 }
  if (!g.gate1 || !g.gate2 || !g.gate3) {
    out.status = 'INVALID'
    out.invalidReason = !g.gate1 ? 'gate1 页面仍在 loading'
      : !g.gate2 ? 'gate2 迟到的 reload 覆盖了注入（title 不符）'
        : 'gate3 目标元素不在 DOM'
    out.screenshot = await shot(mp, SIDE + '-' + name + '-INVALID.png', true)
    return out
  }
  const sr = await styleReady(page, isS1, viewport)
  out.gates.stylesReady = sr.ok
  out.gates.styleWaitMs = sr.waitedMs
  if (!sr.ok) {
    out.status = 'INVALID'
    out.invalidReason = 'gate4 样式未就绪（首启 wxss 未生效）'
    out.screenshot = await shot(mp, SIDE + '-' + name + '-INVALID.png', true)
    return out
  }
  const d = g.data

  if (isS1) {
    const hero = await page.$('activity-hero')
    const root = await hero.$('.hero-cover')
    const media = await hero.$('.hero-cover-media')
    const body = await hero.$('.hero-cover-body')
    const card = await page.$('.act-info')
    const note = await page.$('.act-photo-note')
    const grids = await page.$$('fact-grid')
    const statsGrid = grids[1]
    const statRoot = statsGrid ? await statsGrid.$('.fact-grid--stats') : null
    const statClass = statRoot ? (await statRoot.attribute('class')) || '' : ''
    const secFacts = await page.$('#sec-facts')
    out.markers = {
      heroSelectable: !!hero,
      factGridStats: statClass.indexOf('fact-grid--stats') !== -1,
      secFactsGone: !secFacts,
      infoCard: !!card,
      coverFailedClass: ((await root.attribute('class')) || '').indexOf('img-failed') !== -1,
    }
    const hb = await box(hero)
    const mb = await box(media)
    const bb = await box(body)
    const cb = await box(card)
    out.geometry = {
      viewport: out.viewport,
      page: await box(await page.$('.page')),
      hero: hb, media: mb, heroBody: bb, infoCard: cb,
      titleBlockDeltaFromMediaBottom: bb && mb ? +(bb.top - (mb.top + mb.height)).toFixed(2) : null,
      cardDeltaFromHeroBottom: cb && hb ? +(cb.top - (hb.top + hb.height)).toFixed(2) : null,
      infoCells: grids[0] ? await cellsOf(grids[0]) : [],
      statCells: statsGrid ? await cellsOf(statsGrid) : [],
      photoNote: await box(note),
    }
    out.geometry.infoColumns = columnCheck(out.geometry.infoCells)
    out.geometry.statColumns = columnCheck(out.geometry.statCells)
    out.geometry.touch = {
      primary: await box(await page.$('.button.primary')),
      secondary: await box(await page.$('.button.text')),
    }
    out.geometry.overflow = overflow([out.geometry.page, hb, mb, cb, out.geometry.photoNote], out.viewport.windowWidth)
  } else {
    const hero = await page.$('.hero-cover')
    const media = await page.$('.hero-cover-media')
    const body = await page.$('.hero-cover-body')
    const secFacts = await page.$('#sec-facts')
    const rows = await page.$$('.fact-row')
    const rowBoxes = []
    for (const r of rows) rowBoxes.push({ box: await box(r), label: (await textOf(r, '.fact-label')).trim(), value: (await textOf(r, '.fact-value')).trim() })
    out.markers = {
      secFactsPresent: !!secFacts,
      infoCardGone: !(await page.$('.act-info')),
      heroSelectable: !!hero,
      coverFailedClass: hero ? ((await hero.attribute('class')) || '').indexOf('img-failed') !== -1 : false,
    }
    const mb = await box(media)
    const bb = await box(body)
    out.geometry = {
      viewport: out.viewport,
      page: await box(await page.$('.page')),
      hero: await box(hero), media: mb, heroBody: bb,
      titleBlockDeltaFromMediaBottom: bb && mb ? +(bb.top - (mb.top + mb.height)).toFixed(2) : null,
      factRows: rowBoxes,
    }
    out.geometry.overflow = overflow([out.geometry.page, out.geometry.hero], out.viewport.windowWidth)
  }

  out.data = {
    title: d.title, infoFacts: (d.infoFacts || []).length, routeStats: (d.routeStats || []).length,
    coverFailed: d.coverFailed, coverIsReal: d.coverIsReal, photoNote: d.photoNote,
    factTime: d.factTime, factPickup: d.factPickup, factPeople: d.factPeople,
    secNo: d.secNo,
  }

  // 截图：顶部 + rich 的信息卡锚点
  await mp.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 })
  await page.waitFor(350)
  out.screenshot = await shot(mp, SIDE + '-' + name + '-top.png')
  if (name === 'rich' && isS1) {
    const cardTop = out.geometry.infoCard ? out.geometry.infoCard.top : 0
    await mp.callWxMethod('pageScrollTo', { scrollTop: Math.max(0, cardTop - 120), duration: 0 })
    await page.waitFor(350)
    out.screenshotInfo = await shot(mp, SIDE + '-rich-info.png')
    const statTop = out.geometry.statCells.length ? out.geometry.statCells[0].box.top : 0
    await mp.callWxMethod('pageScrollTo', { scrollTop: Math.max(0, statTop - 120), duration: 0 })
    await page.waitFor(350)
    out.screenshotStats = await shot(mp, SIDE + '-rich-stats.png')
  }
  return out
}

async function captureRoute(mp, viewport) {
  const out = { side: SIDE, scenario: 'route-shared-hero', capturedAt: new Date().toISOString(), viewport, status: 'VALID' }
  const page = await mp.reLaunch('/pages/route/route?id=fixture-route')
  await page.waitFor(1500)
  const injected = {
    loading: false, denied: '', isOwner: true,
    cover: '/assets/photos/cover-valley.jpg', coverFailed: false,
    route: {
      title: '青城后山穿越', sourceText: '我的路线', updatedText: '10/22', difficultyLabel: '中等',
      visibility: 'private', distanceKm: 12.5, ascentM: 860, points: [], track: [],
    },
    map: { visible: false },
  }
  await page.setData(injected)
  await page.waitFor(700)
  const d = await page.data()
  const gate = d.route && d.route.title === injected.route.title && d.loading === false
  const sr = await styleReady(page, false, viewport)
  out.gates = {
    loadingFalse: d.loading === false,
    titleIntact: !!(d.route && d.route.title === injected.route.title),
    stylesReady: sr.ok, styleWaitMs: sr.waitedMs,
  }
  if (!gate || !sr.ok) {
    out.status = 'INVALID'
    out.invalidReason = !gate ? 'route 页注入被迟到 reload 覆盖或页面仍在 loading' : 'route 页样式未就绪'
    out.screenshot = await shot(mp, SIDE + '-route-shared-hero-INVALID.png', true)
    return out
  }
  const hero = await page.$('.hero-cover')
  const media = await page.$('.hero-cover-media')
  const body = await page.$('.hero-cover-body')
  out.markers = { heroSelectable: !!hero, actHeroScoped: !(await page.$('.act-hero')) }
  await mp.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 })
  await page.waitFor(300)
  out.screenshot = await shot(mp, SIDE + '-route-top.png')
  const mb = await box(media)
  const bb = await box(body)
  out.geometry = {
    viewport: out.viewport, hero: await box(hero), media: mb, heroBody: bb,
    titleBlockDeltaFromMediaBottom: bb && mb ? +(bb.top - (mb.top + mb.height)).toFixed(2) : null,
    overflow: overflow([await box(await page.$('.page')), await box(hero)], out.viewport.windowWidth),
  }
  out.data = { title: d.route.title, coverFailed: d.coverFailed }
  return out
}

async function main() {
  fs.mkdirSync(READDIR, { recursive: true })
  const mp = await automator.connect({ wsEndpoint: WS })
  try {
    const info = await mp.systemInfo()
    const viewport = {
      windowWidth: info.windowWidth, windowHeight: info.windowHeight,
      pixelRatio: info.pixelRatio, SDKVersion: info.SDKVersion,
      platform: info.platform, model: info.model, system: info.system,
    }
    fs.writeFileSync(path.join(READDIR, SIDE + '-environment.json'), j({ capturedAt: new Date().toISOString(), viewport }) + '\n')
    const manifest = {
      side: SIDE, ws: WS, capturedAt: new Date().toISOString(), viewport,
      fixtureManifest: JSON.parse(fs.readFileSync(path.join(FIXDIR, 'manifest.json'), 'utf8')),
      results: [],
    }
    for (const name of SCENARIOS) {
      const r = await captureActivity(mp, name, viewport)
      fs.writeFileSync(path.join(READDIR, SIDE + '-' + name + '.json'), JSON.stringify(r, null, 2) + '\n')
      manifest.results.push({ scenario: name, status: r.status, screenshot: r.screenshot && r.screenshot.file, gates: r.gates, markers: r.markers })
      console.log(r.status === 'VALID' ? '✓' : '✗', SIDE, name, j(r.markers))
    }
    if (SIDE === 's1') {
      const r = await captureRoute(mp, viewport)
      fs.writeFileSync(path.join(READDIR, SIDE + '-route.json'), JSON.stringify(r, null, 2) + '\n')
      manifest.results.push({ scenario: 'route-shared-hero', status: r.status, screenshot: r.screenshot && r.screenshot.file })
      console.log(r.status === 'VALID' ? '✓' : '✗', SIDE, 'route', j(r.markers))
    }
    fs.writeFileSync(path.join(READDIR, SIDE + '-run.json'), JSON.stringify(manifest, null, 2) + '\n')
    const bad = manifest.results.filter(x => x.status !== 'VALID')
    console.log('SUMMARY', SIDE, 'total=' + manifest.results.length, 'invalid=' + bad.length)
    process.exitCode = bad.length ? 1 : 0
  } finally {
    await mp.disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
