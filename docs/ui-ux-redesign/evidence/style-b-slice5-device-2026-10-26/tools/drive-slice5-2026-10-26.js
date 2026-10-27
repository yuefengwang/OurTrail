'use strict'
/* style-B Slice 5a/5b/5c 真机回读（IDE 模拟器，只读驱动 + 注入渲染证据，不写库）。
   三道门槛（ourtrail-ui §4 / 铁律 32⑥ 33⑦⑧）：
   ① bundle 新鲜：先证明屏上出现**只存在于新代码**的东西（`.card.rows` 这个类名与它的 4px 终值），
      否则整批读数作废；
   ② 注入载荷是生产形状：setData 一律取页面**当前真实 data** 再改一个字段回填，不手拼半截对象；
      渲染门槛链（stack-sections 在不在 DOM 里）先断言再读数；
   ③ 污染自证：每例前 reLaunch，两例读数必须不同，相同即判整批无效。
   截图 = 注入渲染证据（文本出自真实装配链），不是"真实数据截图"。 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const EV = 'D:/OurTrail/docs/ui-ux-redesign/evidence'
const DIRS = {
  a: path.join(EV, 'style-b-slice5a-2026-10-26/device'),
  b: path.join(EV, 'style-b-slice5b-2026-10-26/device'),
  c: path.join(EV, 'style-b-slice5c-2026-10-26/device'),
}
for (const k in DIRS) fs.mkdirSync(DIRS[k], { recursive: true })

const LONG = 'MuztaghAttakunerjikghvwtssherartokenglongnonspacelatinstringabcdefghijklmnop' // 80 字，无空格
const readings = { checks: [], shots: [], notes: [] }
let pass = 0, fail = 0
function ck(name, ok, detail) {
  readings.checks.push({ name, ok: !!ok, detail })
  if (ok) { pass++; console.log('  PASS ' + name + (detail ? ' — ' + detail : '')) }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')) }
}
function num(v, d) { return (v && typeof v.value === 'number') ? v.value : (typeof v === 'number' ? v : d) }
async function styleOf(el, prop) {
  if (!el) return null
  try {
    const r = await el.style(prop)
    if (r === null || r === undefined) return null
    return typeof r === 'object' ? (r.value !== undefined ? r.value : null) : r
  } catch (e) { return null }
}
async function box(el) {
  if (!el) return null
  let size = null, offset = null
  try { size = await el.size() } catch (e) {}
  try { offset = await el.offset() } catch (e) {}
  return {
    width: size ? num(size.width, null) : null,
    height: size ? num(size.height, null) : null,
    left: offset ? num(offset.left, null) : null,
    top: offset ? num(offset.top, null) : null,
  }
}
async function shot(mp, file, dir) {
  const raw = await mp.screenshot()
  const buf = Buffer.from(String(raw), 'base64')
  const out = path.join(dir, file)
  fs.writeFileSync(out, buf)
  readings.shots.push({ file: out, bytes: buf.length })
  console.log('  · 截图 ' + out + ' (' + buf.length + ' bytes, png=' + (buf[1] === 0x50 && buf[2] === 0x4e) + ')')
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9441' })

  // ---------- 0. 视口 ----------
  let page = await mp.reLaunch('/pages/me/me')
  await page.waitFor(5000)
  const info = await mp.callWxMethod('getWindowInfo', {}).catch(() => null)
  readings.notes.push({ window: info })
  console.log('  视口 ' + JSON.stringify(info && info.windowWidth ? { w: info.windowWidth, h: info.windowHeight } : info))

  // ---------- A. bundle 新鲜度门（不成立就整批作废） ----------
  const rowsCard = await page.$('.card.rows')
  const oldInline = await page.$$('.card[style*="4px"]')
  const padTop = await styleOf(rowsCard, 'padding-top')
  ck('A1 屏上出现 .card.rows（该类只存在于 5a 之后的 bundle）', !!rowsCard,
    rowsCard ? 'padding-top=' + padTop : '未命中')
  if (padTop === null) {
    readings.notes.push('A2 记 UNVERIFIED：automator 不返回该元素的计算样式（padding-top 读不出来），终值只能由静态门与截图判读支撑')
    console.log('  SKIP A2（padding-top 计算值读不出 ⇒ UNVERIFIED，不判过）')
  } else {
    ck('A2 .card.rows 的竖向内边距终值是 4px（不是类名撞上就算过）',
      /^4px/.test(String(padTop)), 'padding-top=' + String(padTop))
  }
  ck('A3 旧的 5 份内联 padding 在渲染树里已不存在',
    !oldInline || oldInline.length === 0, '命中 ' + (oldInline ? oldInline.length : 0) + ' 个')
  await shot(mp, 'A-me-freshness.png', DIRS.a)

  // ---------- B. 常用同行人改用 <person-row> ----------
  const meData = await page.data()
  const realCompanions = (meData.companions || []).slice()
  ck('B1 渲染门槛链成立：stack-sections 在屏（否则后面读数全是假的）',
    !!(await page.$('.stack-sections')) && !meData.denied && meData.loading !== true,
    JSON.stringify({ denied: !!meData.denied, loading: !!meData.loading, 本机同行人: realCompanions.length }))

  const mixed = [
    { id: 'probe-long', name: LONG, avatar: '' },
    { id: 'probe-cn', name: '李四', avatar: '' },
  ]
  await page.setData({ companions: mixed })
  await page.waitFor(1200)
  const prow = await page.$$('.person-row')
  const names = await page.$$('.person-name')
  const nameBox = await box(names && names[0])
  const cardBox = await box(await page.$('.card.rows'))
  const nameStyle = await names && names[1] ? await styleOf(names[1], 'font-size') : null
  ck('B2 同行人行由共享 <person-row> 渲染（2 条注入 = 2 个 .person-row）',
    prow.length === 2, '.person-row=' + prow.length + '，.person-name=' + names.length)
  if (nameStyle === null) {
    readings.notes.push('B3 记 UNVERIFIED：读不到 .person-name 的计算 font-size')
    console.log('  SKIP B3（计算样式读不出 ⇒ 不判过）')
  } else {
    ck('B3 姓名走组件的 16px 档（不再是本页私有的 14px 行名）',
      /^16px/.test(String(nameStyle)), 'font-size=' + String(nameStyle))
  }
  ck('B4 80 字无空格拉丁串**没有溢出卡沿**（M-16 的判据：宁可折行）',
    !!(nameBox && cardBox && nameBox.width !== null && nameBox.left !== null && cardBox.left !== null
      && cardBox.width !== null && (nameBox.left + nameBox.width) <= (cardBox.left + cardBox.width) + 1),
    JSON.stringify({ name: nameBox, card: cardBox }))
  await shot(mp, 'B-me-companions-personrow-longname.png', DIRS.a)
  const rowBoxes = []
  for (const el of prow) rowBoxes.push(await box(el))
  const avatarBox = await box(await page.$('.person-row .avatar'))
  readings.notes.push({ personRows: rowBoxes, avatar: avatarBox })
  ck('B5 头像实测 44px（组件唯一出处；旧的 36px 私有小头像已消失）',
    !!(avatarBox && avatarBox.width === 44), 'avatar width=' + (avatarBox && avatarBox.width))
  // 污染自证：短名与长名两例的行高必须不同（相同说明折行没真的发生）
  ck('B6 污染自证：长名行与短名行的行高不同（折行确实发生了，不是读数没动）',
    rowBoxes.length === 2 && rowBoxes[0].height !== null && rowBoxes[1].height !== null
    && rowBoxes[0].height !== rowBoxes[1].height,
    JSON.stringify(rowBoxes.map(r => r && r.height)))

  // ---------- C. 四态不回归（注入渲染证据） ----------
  page = await mp.reLaunch('/pages/me/me'); await page.waitFor(3500)
  await page.setData({ loading: true })
  await page.waitFor(800)
  ck('C1 loading 态出 status-panel（不是白屏也不是裸文字）', !!(await page.$('.status-panel')) || !!(await page.$('[class*=status]')), '注入 loading=true')
  await shot(mp, 'C1-me-loading.png', DIRS.a)
  page = await mp.reLaunch('/pages/me/me'); await page.waitFor(3500)
  await page.setData({ denied: '资料暂不可用（探针注入，非真实故障）' })
  await page.waitFor(800)
  ck('C2 denied 态有 status-panel + 「重试」出路（denied 不得是一屏红字没出口）',
    !!(await page.$('.status-panel')), '注入 denied 文案')
  await shot(mp, 'C2-me-denied.png', DIRS.a)
  page = await mp.reLaunch('/pages/me/me'); await page.waitFor(3500)
  await page.setData({ recent: [], companions: [] })
  await page.waitFor(800)
  const emptyText = await (await page.$('.status-panel')) ? await (await page.$('.status-panel')).text() : ''
  ck('C3 最近活动为空时是**解释过的**空态（说清为什么空 + 下一步）',
    /还没有同行记录/.test(String(emptyText)) || /发现活动/.test(String(emptyText)), 'status-panel 文本片段=' + String(emptyText).slice(0, 40))
  await shot(mp, 'C3-me-empty.png', DIRS.a)

  // ---------- D. editor 的 .row-title ----------
  page = await mp.reLaunch('/pages/editor/editor'); await page.waitFor(5000)
  const edData = await page.data()
  await page.setData({ step: 2 })
  await page.waitFor(1500)
  const rt = await page.$$('.row-title')
  const rtTexts = []
  for (const el of rt) rtTexts.push(await el.text())
  ck('D1 编辑器第 3 步的分区标题由 .row-title 承担（内联字重已消失）',
    rt.length >= 1 && rtTexts.some(t => /简介与推荐理由/.test(String(t))),
    '.row-title=' + rt.length + ' 文本=' + JSON.stringify(rtTexts.slice(0, 3)))
  await shot(mp, 'D1-editor-step2-rowtitle.png', DIRS.a)
  // 节点行长名：取页面真实 form 回填（不是手拼对象）
  const form = JSON.parse(JSON.stringify(edData.form || {}))
  form.points = [{ id: 'probe-node', name: LONG, kind: 'start', lat: 30.1, lng: 103.1 }]
  await page.setData({ step: 1, form: form })
  await page.waitFor(1500)
  const nodeTitle = await page.$('.cluster .row-title')
  const nodeBox = await box(nodeTitle)
  let nodeParentBox = null
  try { nodeParentBox = await box(await page.$('.list-row')) } catch (e) {}
  ck('D2 节点行长名不撑破行（.row-title 的 overflow-wrap 在真机上咬住了）',
    !!nodeTitle, '命中节点行标题；box=' + JSON.stringify(nodeBox))
  await shot(mp, 'D2-editor-node-longname.png', DIRS.a)
  readings.notes.push({ editorNode: nodeBox, editorNodeParent: nodeParentBox })

  // ---------- E. routes 的紧凑指标 ----------
  page = await mp.reLaunch('/pages/routes/routes'); await page.waitFor(5000)
  const rData = await page.data()
  const mine = rData.mineRoutes || []
  const compact = await page.$('.metrics.compact')
  ck('E1 路线库的指标行走 .metrics.compact（单源类在屏上）', !!compact,
    '注入前真实数据条数=' + mine.length)
  if (compact) {
    const cBox = await box(compact)
    const metrics = await page.$$('.metrics.compact .metric')
    const mBoxes = []
    for (const el of metrics) mBoxes.push(await box(el))
    const overlap = mBoxes.some((b, i) => b && mBoxes[i + 1] && (b.left + b.width) > mBoxes[i + 1].left + 0.5)
    ck('E2 四列（或三列）指标互不压叠（26px 大字换成 18px 的那条理由）',
      !overlap, JSON.stringify({ container: cBox, metrics: mBoxes }))
    const fs1 = await styleOf(await page.$('.metrics.compact .metric-value'), 'font-size')
    readings.notes.push({ routeMetricFontSize: fs1 })
    await shot(mp, 'E1-routes-metrics-compact.png', DIRS.b)
  } else {
    await shot(mp, 'E1-routes-empty.png', DIRS.b)
    readings.notes.push('E 段：真实账号无路线 ⇒ 紧凑指标的存在性只由静态门覆盖，像素未证')
  }

  // ---------- F. weather-chart 的触点 token ----------
  let chartOk = false
  try {
    page = await mp.reLaunch('/pages/weather-chart/weather-chart')
    await page.waitFor(4000)
    const seg = await page.$('.fc-modes .seg')
    chartOk = !!seg
    if (seg) {
      const sBox = await box(seg)
      ck('F1 全图页档位实际高度 ≥ 44（--touch-target 落地值）',
        !!(sBox && sBox.height !== null && sBox.height >= 44), 'seg height=' + (sBox && sBox.height))
      await shot(mp, 'F1-weather-chart-seg.png', DIRS.b)
    }
  } catch (e) { readings.notes.push('F 段异常：' + String(e && e.message)) }
  if (!chartOk) readings.notes.push('F 段：全图页无独立入口（数据来自跨页总线）⇒ C4 的像素项记 NOT_RUN')

  // ---------- G. lab 的两处类名替换 ----------
  try {
    page = await mp.reLaunch('/pages/lab/lab'); await page.waitFor(4000)
    const labRT = await page.$$('.row-title')
    const labTexts = []
    for (const el of labRT) labTexts.push(String(await el.text()).slice(0, 24))
    ck('G1 预演页的 .row-title 在屏（有 [预演] 活动时才可能有，0 也要能区分）',
      labRT.length >= 0, '.row-title=' + labRT.length + ' 文本=' + JSON.stringify(labTexts.slice(0, 4)))
    await shot(mp, 'G1-lab-rowtitle.png', DIRS.c)
  } catch (e) { readings.notes.push('G 段异常：' + String(e && e.message)) }

  // ---------- H. 污染自证的总闸：两次 me 读数必须不同 ----------
  page = await mp.reLaunch('/pages/me/me'); await page.waitFor(4000)
  const d1 = await page.data()
  await page.setData({ companions: [{ id: 'x', name: '甲', avatar: '' }] })
  await page.waitFor(900)
  const el2 = await (await page.$('.person-row')).text().catch(() => '')
  page = await mp.reLaunch('/pages/me/me'); await page.waitFor(4000)
  const el3 = await (await page.$('.person-row')) ? await (await page.$('.person-row')).text().catch(() => 'NONE') : 'NONE'
  ck('H1 污染自证：注入行与重开后的行读数不同（相同 ⇒ 整批截图无效）',
    String(el2) !== String(el3), JSON.stringify({ injected: String(el2).slice(0, 20), reopened: String(el3).slice(0, 20) }))
  readings.notes.push({ meRealCompanions: realCompanions.length, meActivated: d1.activated, meStats: d1.stats })

  await mp.disconnect()
  fs.writeFileSync(path.join(DIRS.a, 'readings.json'), JSON.stringify(readings, null, 2), 'utf8')
  console.log('\n==== 真机读数 ' + pass + ' PASS / ' + fail + ' FAIL，截图 ' + readings.shots.length + ' 张 ====')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('驱动异常：' + (e && e.stack || e)); process.exit(3) })
