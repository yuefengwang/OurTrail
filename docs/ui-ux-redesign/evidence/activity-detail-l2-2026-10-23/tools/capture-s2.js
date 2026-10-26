// S2 真机取证驱动（微信开发者工具 automator）。
// 用法：NODE_PATH="<mp-auto>/node_modules" node tools/capture-s2.js [--ws=ws://127.0.0.1:9421]
// 夹具与 S1 同源（gen-activity-fixtures.js 的真实 renderView 产物），但输出在 fixtures-s2/，
// 不覆盖 S1 的 fixtures/ 与 readings/s1-*。
// 门槛同 S1 §4.4：loadingFalse / titleIntact / selectorFound / stylesReady(240px hero + 32px 图标格)，
// 任一不成立 → 该场景 INVALID，图进 invalid/，不改判通过。
'use strict'
const fs = require('fs')
const path = require('path')
const automator = require('miniprogram-automator')

const ARG = {}
process.argv.slice(2).forEach(s => {
  const m = /^--([^=]+)=(.*)$/.exec(s)
  if (m) ARG[m[1]] = m[2]
})
const PACK = path.resolve(__dirname, '..')
const FIXDIR = path.join(PACK, 'fixtures-s2')
const OUTDIR = path.join(PACK, 's2')
const READDIR = path.join(PACK, 'readings')
const INVALID = path.join(PACK, 'invalid')
const WS = ARG.ws || 'ws://127.0.0.1:9421'

// s2-rich 是被取证场景；rich 只作污染对照（无节点时间、装备 3+2 不对齐四列换行）。
const SCENARIOS = ARG.scenarios ? ARG.scenarios.split(',') : ['s2-rich', 'rich']

const sleep = ms => new Promise(r => setTimeout(r, ms))
const j = o => JSON.stringify(o)
const norm = s => String(s || '').replace(/\s+/g, ' ').trim()

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
async function textOf(el) {
  if (!el) return ''
  return norm(await el.text())
}
function rowsOf(cells) {
  const rows = {}
  cells.forEach(c => {
    if (!c.box) return
    const k = Math.round(c.box.top)
    ;(rows[k] = rows[k] || []).push(c)
  })
  const keys = Object.keys(rows).map(Number).sort((a, b) => a - b)
  return keys.map(k => rows[k])
}
function overflow(boxes, vw) {
  const valid = boxes.filter(Boolean)
  if (!valid.length) return null
  const rights = valid.map(b => b.left + b.width)
  const lefts = valid.map(b => b.left)
  return {
    viewportWidth: vw,
    maxRight: +Math.max.apply(null, rights).toFixed(2),
    minLeft: +Math.min.apply(null, lefts).toFixed(2),
    overflowRight: +(Math.max.apply(null, rights) - vw).toFixed(2),
  }
}

// 样式就绪门：首启后第一次 reLaunch 可能 DOM 已就绪而 wxss 尚未生效。
// S2 追加 32px 图标格（equipment-grid.wxss 的固定值），避免拿旧样式量出假列宽。
async function styleReady(page, viewport) {
  const t0 = Date.now()
  while (Date.now() - t0 < 12000) {
    const media = await page.$('.hero-cover-media')
    const mb = media ? await box(media) : null
    let ok = !!mb && Math.abs(mb.height - 240) <= 1
    if (ok) {
      const tile = await page.$('.eq-grid__tile')
      const tb = tile ? await box(tile) : null
      ok = !!tb && Math.abs(tb.width - 32) <= 1 && Math.abs(tb.height - 32) <= 1
    }
    if (ok && viewport) {
      const card = await page.$('.act-info')
      const cb = card ? await box(card) : null
      ok = !!cb && cb.width >= 300 && cb.left + cb.width <= viewport.windowWidth + 1
    }
    if (ok) return { ok: true, waitedMs: Date.now() - t0 }
    await page.waitFor(300)
  }
  return { ok: false, waitedMs: Date.now() - t0 }
}

async function pageGates(page, fixture) {
  const d1 = await page.data()
  const gate1 = d1.loading === false
  await page.setData(fixture)
  await page.waitFor(600)
  const d = await page.data()
  const gate2 = d.title === fixture.title
  const itin = await page.$('#sec-itinerary')
  const eq = await page.$('equipment-grid')
  const gate3 = !!itin && !!eq
  return { gate1, gate2, gate3, data: d }
}

const SECTION_IDS = ['sec-intro', 'sec-peers', 'sec-itinerary', 'sec-weather', 'meeting-block', 'sec-safety', 'sec-equipment', 'sec-fee', 'sec-signup']

async function collectS2(page, viewportWidth) {
  const d = await page.data()
  const out = {
    title: d.title,
    scheduleLabels: (d.points || []).map(p => p.scheduleLabel || ''),
    scheduleBasis: d.scheduleBasis || '',
    equipment: (d.equipment || []).slice(),
    equipmentSuggested: (d.equipmentSuggested || []).slice(),
    secNo: d.secNo,
  }

  // 章节：根节点盒 + 章节标题三行 + 正文上边距（模板 style="margin-top:{{gap}}px"）
  const chapters = await page.$$('chapter')
  out.chapters = []
  for (const ch of chapters) {
    const head = await ch.$('.section-head')
    const body = await ch.$('.chapter__body')
    out.chapters.push({
      box: await box(ch),
      head: await box(head),
      body: await box(body),
      kicker: await textOf(await ch.$('.kicker')),
      title: await textOf(await ch.$('.list-head__title')),
      bodyStyle: body ? ((await body.attribute('style')) || '') : '',
    })
  }
  out.chapterGaps = []
  for (let i = 0; i + 1 < out.chapters.length; i++) {
    const a = out.chapters[i].box
    const b = out.chapters[i + 1].box
    if (a && b) out.chapterGaps.push(+(b.top - (a.top + a.height)).toFixed(2))
  }
  out.titleBodyGaps = out.chapters.map(c => (c.head && c.body ? +(c.body.top - (c.head.top + c.head.height)).toFixed(2) : null))

  // 外层锚点：section-nav 与 pageScrollTo 依赖它们，顺带核对 28px 节奏
  out.sections = []
  for (const id of SECTION_IDS) {
    const el = await page.$('#' + id)
    out.sections.push({ id, present: !!el, box: el ? await box(el) : null })
  }
  out.sectionGaps = []
  for (let i = 0; i + 1 < out.sections.length; i++) {
    const a = out.sections[i].box
    const b = out.sections[i + 1].box
    if (a && b) out.sectionGaps.push(+(b.top - (a.top + a.height)).toFixed(2))
  }

  // 行程：时间轴只在行程章节；节点日程三段（第1天 08:00 / 第1天 10:30 / 无）
  const itin = await page.$('#sec-itinerary')
  const route = await page.$('#meeting-block')
  const timeline = itin ? await itin.$('.timeline') : null
  out.timeline = { inItinerary: !!timeline, inRoute: route ? !!(await route.$('.timeline')) : null }
  out.timelineItems = []
  if (timeline) {
    const items = await itin.$$('.timeline-item')
    for (const it of items) {
      const label = await it.$('.small.tabular')
      out.timelineItems.push({
        text: await textOf(it),
        kindLabel: await textOf(await it.$('.eyebrow')),
        scheduleLabel: label ? await textOf(label) : '',
        box: await box(it),
      })
    }
  }

  // 装备：两组列表（必带 / 建议），按行分组量四列
  out.equipmentLists = []
  const lists = await page.$$('.eq-grid__list')
  for (const list of lists) {
    const cells = []
    const items = await list.$$('.eq-grid__item')
    for (const item of items) {
      const tile = await item.$('.eq-grid__tile')
      const text = await item.$('.eq-grid__text')
      cells.push({
        box: await box(item),
        tile: await box(tile),
        text: await textOf(text),
        textBox: await box(text),
      })
    }
    const rows = rowsOf(cells)
    out.equipmentLists.push({
      box: await box(list),
      count: cells.length,
      rows: rows.map(r => r.length),
      rowWidths: rows.map(r => r.map(c => c.box && c.box.width)),
      cells,
    })
  }
  out.equipmentSectionText = await textOf(await page.$('#sec-equipment'))

  // 费用：五段齐全、护栏句只印一次、feeNote 在 cancellationNote 之前
  const fee = await page.$('#sec-fee')
  const feeText = await textOf(fee)
  out.fee = {
    text: feeText,
    guardCount: (feeText.match(/OurTrail 不收款，不处理支付或退款。/g) || []).length,
    includesLabel: feeText.indexOf('费用包含') !== -1,
    excludesLabel: feeText.indexOf('费用不含') !== -1,
    feeNoteBeforeCancel: feeText.indexOf(norm(d.feeNote)) !== -1
      && feeText.indexOf(norm(d.feeNote)) < feeText.indexOf(norm(d.cancellationNote)),
  }

  // 同行人：不编号
  const peers = out.chapters.find(c => c.kicker === '同行人')
  out.peers = { kicker: peers ? peers.kicker : null, numbered: peers ? /^\d/.test(peers.kicker) : null }

  const pageEl = await page.$('.page')
  out.overflow = overflow([await box(pageEl), await box(await page.$('.stack-sections')), await box(fee)], viewportWidth)
  return out
}

async function capture(mp, name, viewport) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXDIR, name + '.json'), 'utf8'))
  const out = {
    side: 's2', scenario: name, capturedAt: new Date().toISOString(), viewport,
    fixture: { file: path.relative(PACK, path.join(FIXDIR, name + '.json')), title: fixture.title },
    gates: {}, markers: {}, geometry: {}, screenshots: [], status: 'VALID',
  }
  const page = await mp.reLaunch('/pages/activity/activity?id=fixture-a1')
  await page.waitFor(1600)
  const g = await pageGates(page, fixture)
  out.gates = { loadingFalse: g.gate1, titleIntact: g.gate2, selectorFound: g.gate3 }
  if (!g.gate1 || !g.gate2 || !g.gate3) {
    out.status = 'INVALID'
    out.invalidReason = !g.gate1 ? 'gate1 页面仍在 loading'
      : !g.gate2 ? 'gate2 迟到的 reload 覆盖了注入（title 不符）'
        : 'gate3 行程锚点或装备组件不在 DOM'
    out.screenshots.push(await shot(mp, name + '-INVALID.png', true))
    return out
  }
  const sr = await styleReady(page, viewport)
  out.gates.stylesReady = sr.ok
  out.gates.styleWaitMs = sr.waitedMs
  if (!sr.ok) {
    out.status = 'INVALID'
    out.invalidReason = 'gate4 样式未就绪（首启 wxss 未生效）'
    out.screenshots.push(await shot(mp, name + '-INVALID.png', true))
    return out
  }

  out.geometry = await collectS2(page, viewport.windowWidth)
  out.geometry.viewportWidth = viewport.windowWidth

  const secTop = id => {
    const s = out.geometry.sections.find(x => x.id === id)
    return s && s.box ? s.box.top : 0
  }
  out.markers = {
    chapterCount: out.geometry.chapters.length,
    numberedKickers: out.geometry.chapters.filter(c => /^\d{2}/.test(c.kicker)).map(c => c.kicker),
    timelineInItinerary: out.geometry.timeline.inItinerary,
    timelineInRoute: out.geometry.timeline.inRoute,
    timelineItems: out.geometry.timelineItems.length,
    equipmentLists: out.geometry.equipmentLists.length,
    equipmentRows: out.geometry.equipmentLists.map(l => l.rows.join('+')),
    peersNumbered: out.geometry.peers.numbered,
    feeGuardCount: out.geometry.fee.guardCount,
  }

  await mp.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 })
  await page.waitFor(350)
  out.screenshots.push(await shot(mp, name + '-top.png'))

  if (name === 's2-rich') {
    const anchors = [
      ['itinerary', secTop('sec-itinerary')],
      ['peers', secTop('sec-peers')],
      ['route', secTop('meeting-block')],
      ['equipment', secTop('sec-equipment')],
      ['fee', secTop('sec-fee')],
    ]
    for (const [label, top] of anchors) {
      await mp.callWxMethod('pageScrollTo', { scrollTop: Math.max(0, top - 80), duration: 0 })
      await page.waitFor(350)
      out.screenshots.push(await shot(mp, name + '-' + label + '.png'))
    }
    await mp.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 })
  }
  return out
}

async function main() {
  fs.mkdirSync(READDIR, { recursive: true })
  // 环境读一次就断：长时间抓多个场景时，复用同一条 automator 连接曾在第二次
  // reLaunch 上出现「timeout waiting for automator response」。每场景独立连接，
  // 单个场景卡死不会把整批证据判成无效，失败场景照常落 INVALID。
  const probe = await automator.connect({ wsEndpoint: WS })
  let info
  try {
    info = await probe.systemInfo()
  } finally {
    await probe.disconnect()
  }
  const viewport = {
    windowWidth: info.windowWidth, windowHeight: info.windowHeight,
    pixelRatio: info.pixelRatio, SDKVersion: info.SDKVersion,
    platform: info.platform, model: info.model, system: info.system,
  }
  fs.writeFileSync(path.join(READDIR, 's2-environment.json'), j({ capturedAt: new Date().toISOString(), viewport }) + '\n')
  const manifest = {
    side: 's2', ws: WS, capturedAt: new Date().toISOString(), viewport,
    fixtureManifest: JSON.parse(fs.readFileSync(path.join(FIXDIR, 'manifest.json'), 'utf8')),
    results: [],
  }
  for (const name of SCENARIOS) {
    let mp = null
    let r
    try {
      mp = await automator.connect({ wsEndpoint: WS })
      r = await capture(mp, name, viewport)
    } catch (e) {
      r = {
        side: 's2', scenario: name, capturedAt: new Date().toISOString(), viewport,
        fixture: { title: '' }, gates: {}, markers: {}, geometry: {}, screenshots: [],
        status: 'INVALID', invalidReason: 'automator 异常：' + e.message,
      }
    } finally {
      if (mp) { try { await mp.disconnect() } catch (_) {} }
    }
    fs.writeFileSync(path.join(READDIR, 's2-' + name + '.json'), JSON.stringify(r, null, 2) + '\n')
    manifest.results.push({
      scenario: name, status: r.status, screenshots: r.screenshots,
      gates: r.gates, markers: r.markers, title: (r.geometry && r.geometry.title) || r.fixture.title,
      scheduleLabels: (r.geometry && r.geometry.scheduleLabels) || [],
    })
    console.log(r.status === 'VALID' ? '✓' : '✗', name, j(r.markers))
    if (r.status !== 'VALID') console.log('   invalid:', r.invalidReason)
  }
    // 污染自证：两个场景的注入必须真的不同（标题、日程、装备数量任一不同即可；
    // 这里三项全查，避免「都为空」这种假差异被当成打穿缓存）。
    const valid = manifest.results.filter(x => x.status === 'VALID')
    if (valid.length === manifest.results.length && valid.length >= 2) {
      const [a, b] = valid
      const distinct = a.title !== b.title
        && j(a.scheduleLabels) !== j(b.scheduleLabels)
        && a.markers.equipmentLists !== undefined && b.markers.equipmentLists !== undefined
        && j(a.markers.equipmentRows) !== j(b.markers.equipmentRows)
      manifest.pollutionProof = { distinct, a: { title: a.title, labels: a.scheduleLabels, rows: a.markers.equipmentRows }, b: { title: b.title, labels: b.scheduleLabels, rows: b.markers.equipmentRows } }
      if (!distinct) {
        manifest.status = 'INVALID'
        console.log('✗ 污染自证失败：两场景读数相同')
      }
    } else {
      manifest.pollutionProof = { distinct: null }
    }
  fs.writeFileSync(path.join(READDIR, 's2-run.json'), JSON.stringify(manifest, null, 2) + '\n')
  const bad = manifest.results.filter(x => x.status !== 'VALID')
  console.log('SUMMARY s2 total=' + manifest.results.length, 'invalid=' + bad.length)
  process.exitCode = bad.length || manifest.status === 'INVALID' ? 1 : 0
}
main().catch(e => { console.error(e); process.exit(1) })
