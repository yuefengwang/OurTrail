// S3 真机取证驱动（微信开发者工具 automator）。
// 用法：NODE_PATH="<mp-auto>/node_modules" node tools/capture-s3.js [--ws=ws://127.0.0.1:9421]
// 夹具来自 gen-activity-fixtures.js 的真实 renderView 产物（fixtures-s3/），
// 每个状态一屏：底栏应显示什么 / 不显示什么，全部同时读 page.data + DOM + 像素三份。
// 有效性门：标题=夹具标题、状态位与夹具一致、样式就绪（按钮 48±1.5、底栏 60–140）；
// 几何门：底栏贴底、正文最后一行不被底栏遮挡、页尾预留 120±2px；
// 任一不成立 → 该场景 INVALID，图进 invalid/，不改判通过。
'use strict'
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const automator = require('miniprogram-automator')

const ARG = {}
process.argv.slice(2).forEach(s => {
  const m = /^--([^=]+)=(.*)$/.exec(s)
  if (m) ARG[m[1]] = m[2]
})
const PACK = path.resolve(__dirname, '..')
const FIXDIR = path.join(PACK, 'fixtures-s3')
const OUTDIR = path.join(PACK, 's3')
const READDIR = path.join(PACK, 'readings')
const INVALID = path.join(PACK, 'invalid')
const WS = ARG.ws || 'ws://127.0.0.1:9421'

const EXPECT = {
  'participant-bottom': { sticky: true, share: true, primary: '查看集合与出行安排' },
  'owner-bottom': { sticky: true, share: true, primary: '进入工作台' },
  'draft-bottom': { sticky: true, share: false, primary: '返回编辑与发布' },
  'signup-bottom': { sticky: true, share: true, primary: '填写报名资料' },
  'confirmed-bottom': { sticky: true, share: true, primary: '我已到达 · 去签到' },
  'justPublished-bottom': { sticky: false, share: false, primary: null },
}
const SCENARIOS = ARG.scenarios ? ARG.scenarios.split(',') : Object.keys(EXPECT)

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
  return {
    left: +o.left.toFixed(2), top: +o.top.toFixed(2),
    width: +s.width.toFixed(2), height: +s.height.toFixed(2),
    bottom: +(o.top + s.height).toFixed(2),
  }
}
async function textOf(el) {
  if (!el) return ''
  return norm(await el.text())
}
async function classOf(el) {
  if (!el) return ''
  return String((await el.attribute('class')) || '')
}

// 样式就绪门：底栏高度与 48px 主按钮；庆祝帧则等成功卡里的 48px 分享。
async function styleReady(page, exp) {
  const t0 = Date.now()
  while (Date.now() - t0 < 12000) {
    let ok = false
    if (exp.sticky) {
      const bar = await page.$('.sticky-action')
      const bb = bar ? await box(bar) : null
      const p = await page.$('.sticky-action .button.primary')
      const pb = p ? await box(p) : null
      // 底栏高 = 12 + 按钮 48 + calc(12 + safe-area) + 1。模拟器安全区 34 ⇒ 107；
      // 上限 140 是给全面屏留余量。文案折行由下面的按钮高度判（70≠48），不靠底栏高去猜。
      ok = !!bb && bb.height >= 60 && bb.height <= 140 && !!pb && Math.abs(pb.height - 48) <= 1.5
      if (ok) {
        const s = await page.$('.act-sticky__share')
        if (exp.share) {
          const sb = s ? await box(s) : null
          ok = !!sb && !!pb && sb.width < pb.width
        } else ok = !s
      }
    } else {
      const b = await page.$('.callout.success .button.primary')
      const bb = b ? await box(b) : null
      const w = await page.$('.callout.success .button.text')
      const wb = w ? await box(w) : null
      ok = !!bb && Math.abs(bb.height - 48) <= 1.5 && !!wb && wb.height >= 44
    }
    if (ok) return { ok: true, waitedMs: Date.now() - t0 }
    await page.waitFor(300)
  }
  return { ok: false, waitedMs: Date.now() - t0 }
}

async function firstBox(page, sel) {
  const el = await page.$(sel)
  return el ? await box(el) : null
}

// 正文最后一行：取所有 .stack 与 .stack-sections 的最大底边（.sticky-action 是 fixed，
// 不参与文档流，所以不会把「最后一行」抬高）。
async function contentBottom(page) {
  const boxes = []
  for (const sel of ['.stack-sections', '.stack']) {
    const els = await page.$$(sel)
    for (const el of els) boxes.push(await box(el))
  }
  const valid = boxes.filter(Boolean)
  if (!valid.length) return null
  return +Math.max.apply(null, valid.map(b => b.bottom)).toFixed(2)
}

async function collect(page, exp, viewport) {
  const d = await page.data()
  const rootClass = await classOf(await page.$('.page'))
  const stickies = await page.$$('.sticky-action')
  const primaries = await page.$$('.sticky-action .button.primary')
  const share = await page.$('.act-sticky__share')
  const primaryEl = primaries.length === 1 ? await page.$('.sticky-action .button.primary') : null
  const dom = {
    rootClass,
    hasStickyClass: /(^|\s)has-sticky(\s|$)/.test(rootClass),
    stickyCount: stickies.length,
    primaryCount: primaries.length,
    primaryText: await textOf(primaryEl),
    sharePresent: !!share,
    shareText: await textOf(share),
    shareWidth: share ? +(await box(share)).width.toFixed(2) : null,
    primaryWidth: primaryEl ? +(await box(primaryEl)).width.toFixed(2) : null,
  }
  const successShare = await page.$('.callout.success .button.primary')
  dom.successCardShare = !!successShare
  dom.successCardShareText = await textOf(successShare)
  const successWorkspace = await page.$('.callout.success .button.text')
  dom.successCardWorkspace = !!successWorkspace
  dom.successCardWorkspaceText = await textOf(successWorkspace)

  // 坐标系判定：先记一个锚点在滚动前后的读数；文档坐标不随滚动变化。
  const anchorBefore = await firstBox(page, '#sec-signup')
  await mpScrollTop(page, 0)
  await page.waitFor(350)
  const topShot = await shot(page._mp, page._name + '-top.png')
  await mpScrollBottom(page)
  await page.waitFor(450)
  const anchorAfter = await firstBox(page, '#sec-signup')
  const mode = anchorBefore && anchorAfter && Math.abs(anchorAfter.top - anchorBefore.top) <= 2 ? 'document' : 'viewport'

  const pageBox = await firstBox(page, '.page')
  const stickyBox = await firstBox(page, '.sticky-action')
  const lastBottom = await contentBottom(page)
  const geo = { mode, pageBox, stickyBox, lastContentBottom: lastBottom }

  if (mode === 'document' && pageBox && stickyBox) {
    geo.expectedStickyTop = +(pageBox.height - stickyBox.height).toFixed(2)
  } else if (stickyBox) {
    geo.expectedStickyTop = +(viewport.windowHeight - stickyBox.height).toFixed(2)
  }
  if (stickyBox && geo.expectedStickyTop != null) {
    geo.dockedToBottom = Math.abs(stickyBox.top - geo.expectedStickyTop) <= 2
    // .page.has-sticky 的 120px 是「最后一行内容 → 页底」的预留；底栏本身悬在这段里，
    // 所以不能用「底栏顶 − 内容底」（那只是 120 − 栏高 的残差）。
    geo.reservedBottom = pageBox && lastBottom != null ? +(pageBox.bottom - lastBottom).toFixed(2) : null
    geo.gapAboveBar = lastBottom == null ? null : +(stickyBox.top - lastBottom).toFixed(2)
    geo.notOccluded = lastBottom != null && lastBottom <= stickyBox.top + 1
  }
  geo.viewportHeight = viewport.windowHeight

  const bottomShot = await shot(page._mp, page._name + '-bottom.png')
  const shots = [topShot, bottomShot]

  const problems = []
  if (!exp.sticky) {
    if (dom.stickyCount !== 0) problems.push('justPublished 仍有底栏')
    if (dom.hasStickyClass) problems.push('justPublished 仍挂了 has-sticky（会多留 120px）')
    if (!dom.successCardShare) problems.push('成功卡里没有分享主按钮')
    if (dom.successCardShareText.indexOf('分享给同行的人') === -1) problems.push('成功卡分享文案不符：' + dom.successCardShareText)
    // 零丢失：庆祝帧没有底栏，改前顶部的「进入工作台」必须仍在成功卡里。
    if (!dom.successCardWorkspace) problems.push('成功卡缺少「进入工作台」次操作（零丢失失败）')
    if (dom.successCardWorkspaceText.indexOf('进入工作台') === -1) problems.push('成功卡工作台文案不符：' + dom.successCardWorkspaceText)
  } else {
    if (dom.stickyCount !== 1) problems.push('底栏数量=' + dom.stickyCount)
    if (!dom.hasStickyClass) problems.push('缺少 has-sticky 页尾留白')
    if (dom.primaryCount !== 1) problems.push('底栏 primary 数量=' + dom.primaryCount)
    if (exp.share !== dom.sharePresent) problems.push('分享存在性不符（期望 ' + exp.share + '）')
    if (dom.primaryText.indexOf(exp.primary) === -1) problems.push('主操作文案不符：' + dom.primaryText)
    if (exp.share && dom.shareWidth != null && dom.primaryWidth != null && !(dom.shareWidth < dom.primaryWidth)) {
      problems.push('分享没有收回内容宽（share=' + dom.shareWidth + ', primary=' + dom.primaryWidth + '）')
    }
    if (!geo.dockedToBottom) problems.push('底栏未贴底（top=' + (stickyBox && stickyBox.top) + '，期望 ' + geo.expectedStickyTop + '，坐标系 ' + mode + '）')
    if (!geo.notOccluded) problems.push('正文最后一行被底栏遮挡（content=' + lastBottom + ', barTop=' + (stickyBox && stickyBox.top) + '）')
    if (geo.reservedBottom == null || Math.abs(geo.reservedBottom - 120) > 2) {
      problems.push('页尾预留不是 120px（实际 ' + geo.reservedBottom + '）')
    }
  }

  const out = {
    scenario: page._name, status: problems.length ? 'INVALID' : 'VALID',
    problems, gates: page._gates, dom, geometry: geo,
    screenshots: shots, injected: { title: d.title, showSticky: d.showSticky, isOwner: d.isOwner, isDraft: d.isDraft, justPublished: d.justPublished },
  }

  // 弹层盖底栏（只取 confirmed 这一屏）：打开 sheet 并置 busy，验证写按钮禁用、弹层盖满视口。
  if (page._name === 'confirmed-bottom') {
    await page.setData({
      sheetOpen: true,
      busy: true,
      canCheckin: true,
      selRow: { signupId: 's1', name: '张三', statusLabel: '已确认', line: '东门集合点 · 1号车 · 01座' },
    })
    await page.waitFor(500)
    const overlay = await page.$('.overlay-root')
    const overlayOpen = /(^|\s)open(\s|$)/.test(await classOf(overlay))
    const disabledWrite = await page.$$('.overlay-root.open .form-actions .button.primary.disabled')
    const barStillInDom = (await page.$$('.sticky-action')).length
    out.sheet = {
      overlayOpen,
      overlayBox: overlay ? await box(overlay) : null,
      busyDisabledWriteButtons: disabledWrite.length,
      stickyStillInDom: barStillInDom,
      screenshot: await shot(page._mp, page._name + '-sheet.png'),
    }
    out.screenshots.push(out.sheet.screenshot)
    if (!overlayOpen) problems.push('弹层未打开（sheetOpen 未传到组件）')
    if (disabledWrite.length < 1) problems.push('busy 时写按钮没有 .disabled（三层禁用第一层缺失）')
    if (barStillInDom !== 1) problems.push('弹层打开时底栏被卸载（应保留在 DOM、由 overlay 覆盖）')
    out.status = problems.length ? 'INVALID' : 'VALID'
    await page.setData({ sheetOpen: false, busy: false })
  }
  return out
}

async function mpScrollTop(page, top) {
  await page._mp.callWxMethod('pageScrollTo', { scrollTop: top, duration: 0 })
}
async function mpScrollBottom(page) {
  await page._mp.callWxMethod('pageScrollTo', { scrollTop: 20000, duration: 0 })
}

async function capture(mp, name, viewport) {
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXDIR, name + '.json'), 'utf8'))
  const exp = EXPECT[name]
  const out = {
    side: 's3', scenario: name, capturedAt: new Date().toISOString(), viewport,
    fixture: { file: path.relative(PACK, path.join(FIXDIR, name + '.json')), title: fixture.title },
    gates: {}, markers: {}, geometry: {}, screenshots: [], status: 'VALID', problems: [],
  }
  const page = await mp.reLaunch('/pages/activity/activity?id=fixture-a1')
  page._mp = mp
  page._name = name
  await page.waitFor(1600)
  const d0 = await page.data()
  const gate1 = d0.loading === false
  await page.setData(fixture)
  await page.waitFor(600)
  const d = await page.data()
  const gate2 = d.title === fixture.title
  const gate3 = d.showSticky === exp.sticky
  page._gates = { loadingFalse: gate1, titleIntact: gate2, stateMatch: gate3 }
  const sr = await styleReady(page, exp)
  page._gates.stylesReady = sr.ok
  page._gates.styleWaitMs = sr.waitedMs
  if (!gate1 || !gate2 || !gate3 || !sr.ok) {
    out.gates = page._gates
    out.status = 'INVALID'
    out.problems = [!gate1 ? '页面仍在 loading' : !gate2 ? '迟到的 reload 覆盖了注入（title 不符）'
      : !gate3 ? 'showSticky 与期望不符' : '样式未就绪（首启 wxss 未生效）']
    out.screenshots.push(await shot(mp, name + '-INVALID.png', true))
    return out
  }
  const r = await collect(page, exp, viewport)
  return Object.assign(out, r)
}

async function main() {
  fs.mkdirSync(READDIR, { recursive: true })
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
  fs.writeFileSync(path.join(READDIR, 's3-environment.json'), j({ capturedAt: new Date().toISOString(), viewport }) + '\n')
  const manifest = {
    side: 's3', ws: WS, capturedAt: new Date().toISOString(), viewport,
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
        side: 's3', scenario: name, capturedAt: new Date().toISOString(), viewport,
        fixture: { title: '' }, gates: {}, markers: {}, geometry: {}, screenshots: [],
        status: 'INVALID', problems: ['automator 异常：' + e.message],
      }
    } finally {
      if (mp) { try { await mp.disconnect() } catch (_) {} }
    }
    fs.writeFileSync(path.join(READDIR, 's3-' + name + '.json'), JSON.stringify(r, null, 2) + '\n')
    manifest.results.push({
      scenario: name, status: r.status, problems: r.problems,
      gates: r.gates, dom: r.dom, geometry: r.geometry, injected: r.injected || null,
      screenshots: r.screenshots.map(s => s.file),
    })
    console.log(r.status === 'VALID' ? '✓' : '✗', name, j({
      primary: r.dom && r.dom.primaryText, share: r.dom && r.dom.sharePresent,
      docked: r.geometry && r.geometry.dockedToBottom,
      reserve: r.geometry && r.geometry.reservedBottom, above: r.geometry && r.geometry.gapAboveBar,
    }))
    if (r.status !== 'VALID') console.log('   problems:', j(r.problems))
  }
  // 污染自证 + bundle 新鲜度：六屏标题与主操作文案必须互不相同；
  // 底栏出现在 5 屏、庆祝帧不出现（旧 bundle 是顶部 form-actions，这一组读数不可能成立）。
  const valid = manifest.results.filter(x => x.status === 'VALID')
  const titles = valid.map(x => (x.injected && x.injected.title) || '')
  const primaries = valid.map(x => x.dom.primaryText)
  const stickyShown = valid.filter(x => x.dom.stickyCount === 1).length
  const distinct = valid.length === manifest.results.length
    && new Set(titles).size === titles.length
    && new Set(primaries).size === primaries.length
    && stickyShown === 5
  manifest.pollutionProof = { distinct, titles, primaries, stickyShown }
  // bundle 新鲜度不能只看"读数都不为空"——旧包也能有没有底栏的读数。
  // 只认 HEAD 活动页上不存在的新代码标记：.sticky-action + has-sticky 同时出现（5 屏）、
  // .act-sticky__share 出现（4 屏，草稿帧刻意不渲染分享）、庆祝帧底栏数为 0。
  const stickyBarPages = valid.filter(x => x.dom.stickyCount === 1 && x.dom.hasStickyClass).length
  const sharePages = valid.filter(x => x.dom.sharePresent).length
  const celebrate = valid.find(x => x.injected && x.injected.justPublished)
  let headWxml = null
  try {
    headWxml = execSync('git show HEAD:miniprogram/pages/activity/activity.wxml', {
      cwd: path.resolve(__dirname, '../../../../..'), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    })
  } catch (e) { headWxml = null }
  const headHasNoSticky = headWxml != null && !/sticky-action|act-sticky|has-sticky/.test(headWxml)
  manifest.bundleMarkers = {
    stickyBarPages, sharePages,
    celebrateStickyFree: !!celebrate && celebrate.dom.stickyCount === 0 && !celebrate.dom.hasStickyClass,
    headHasNoSticky,
    note: 'HEAD 的活动页无 .sticky-action / .act-sticky__share / has-sticky（运行时 git show 实测，非手写断言）',
  }
  manifest.bundleFresh = distinct && headHasNoSticky && stickyBarPages === 5 && sharePages === 4
    && manifest.bundleMarkers.celebrateStickyFree
  if (!distinct) manifest.status = 'INVALID'
  fs.writeFileSync(path.join(READDIR, 's3-run.json'), JSON.stringify(manifest, null, 2) + '\n')
  const bad = manifest.results.filter(x => x.status !== 'VALID')
  console.log('SUMMARY s3 total=' + manifest.results.length, 'invalid=' + bad.length,
    'pollution=' + (distinct ? 'distinct' : 'FAILED'))
  process.exitCode = bad.length || manifest.status === 'INVALID' ? 1 : 0
}
main().catch(e => { console.error(e); process.exit(1) })
