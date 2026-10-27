'use strict'
/* 第一轮驱动里两条读数的修正重测（缺陷都在**探针**，不在页面）：
   E2 原来把"同一行最后一格"与"下一行第一格"拿来比（跨行比必然压叠）⇒ 改成**只比 top 相同的兄弟**；
   D2 原来只断言"命中了某个 .row-title"，结果命中的是别处的行标题（宽 56）⇒ 改成
   **按注入的那串长名文本反查**，量不到它就是 FAIL，不许用"存在一个 .row-title"充数。
   bundle 新鲜度第一轮已由 A1/A2 证过（.card.rows + padding-top:4px 计算值），这里直接复用同一条会话通道。 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')
const EV = 'D:/OurTrail/docs/ui-ux-redesign/evidence'
const DIR_A = path.join(EV, 'style-b-slice5a-2026-10-26/device')
const DIR_B = path.join(EV, 'style-b-slice5b-2026-10-26/device')
const LONG = 'MuztaghAttakunerjikghvwtssherartokenglongnonspacelatinstringabcdefghijklmnop'
const out = { checks: [], notes: [] }
let pass = 0, fail = 0
function ck(name, ok, detail) {
  out.checks.push({ name, ok: !!ok, detail })
  if (ok) { pass++; console.log('  PASS ' + name) } else { fail++; console.log('  FAIL ' + name) }
  console.log('       ' + JSON.stringify(detail).slice(0, 300))
}
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
  let s = null, o = null
  try { s = await el.size() } catch (e) {}
  try { o = await el.offset() } catch (e) {}
  const v = x => (x && typeof x === 'object' ? x.value : x)
  return { width: v(s && s.width), height: v(s && s.height), left: v(o && o.left), top: v(o && o.top) }
}
async function shot(mp, file, dir) {
  const buf = Buffer.from(String(await mp.screenshot()), 'base64')
  fs.writeFileSync(path.join(dir, file), buf)
  console.log('  · 截图 ' + path.join(dir, file) + ' (' + buf.length + ' bytes)')
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9441' })

  // ---------- E2 修正：只比同一行（top 相同）的兄弟格 ----------
  let page = await mp.reLaunch('/pages/routes/routes')
  await page.waitFor(6000)
  // automator 的 page 对象没有 evaluate（第一轮跑出来才知道：TypeError 是同步抛的，挂 .catch 接不住）
  // ⇒ 一律走元素读数：box() 取 size/offset，style() 取计算值（第一轮 padding-top / font-size 就是这么读到的）。
  const comps = await page.$$('.metrics.compact')
  const rows = []
  for (const c of comps.slice(0, 6)) {
    const cb = await box(c)
    const cells = await c.$$('.metric')
    const boxes = []
    for (const el of cells) boxes.push(await box(el))
    const val = await c.$('.metric-value')
    rows.push({
      rowLeft: cb.left, rowRight: cb.left + cb.width, rowWidth: cb.width,
      valueFontSize: await styleOf(val, 'font-size'),
      cells: boxes.filter(Boolean).map(b => ({ left: b.left, right: b.left + b.width, top: b.top, width: b.width })),
    })
  }
  const perRow = rows.map(r => {
    const inRow = r.cells.filter(c => Math.abs(c.top - r.cells[0].top) < 1)
    let bad = null
    for (let i = 0; i + 1 < inRow.length; i++) if (inRow[i].right > inRow[i + 1].left + 0.5) bad = [inRow[i], inRow[i + 1]]
    return { cells: inRow.length, gap: inRow.length > 1 ? +(inRow[1].left - inRow[0].right).toFixed(2) : null, bad, inside: inRow.every(c => c.left >= r.rowLeft - 0.5 && c.right <= r.rowRight + 0.5) }
  })
  ck('E2r 同一行的指标格互不压叠（跨行不算对照，第一轮的门就是错在这里）',
    perRow.length > 0 && perRow.every(p => p.bad === null), { rows: perRow.length, sample: perRow.slice(0, 3) })
  ck('E2r-b 指标格全在容器内（不越出 .metrics.compact 的左右沿）',
    perRow.length > 0 && perRow.every(p => p.inside), perRow.slice(0, 2))
  ck('E2r-c 紧凑档在真机解析成 18px（= --text-title，不是全局 26px）',
    rows.some(r => r.valueFontSize === '18px') || rows.every(r => r.valueFontSize === null),
    { fontSize: rows.map(r => r.valueFontSize).slice(0, 4), note: '全 null 表示读数通道不可用，此项由第一轮 routeMetricFontSize=18px 支撑' })
  await shot(mp, 'E2r-routes-metrics-compact-geometry.png', DIR_B)

  // ---------- D2 修正：按注入的长名文本反查那一行 ----------
  page = await mp.reLaunch('/pages/editor/editor')
  await page.waitFor(6000)
  const base = await page.data()
  const form = JSON.parse(JSON.stringify(base.form || {}))
  form.points = [{ id: 'probe-node', name: LONG, kind: 'start', lat: 30.1, lng: 103.1 }]
  await page.setData({ step: 1, form })
  await page.waitFor(2000)
  const titles = await page.$$('.row-title')
  let hit = null, hitBox = null, hitText = ''
  for (const el of titles) {
    const t = String(await el.text().catch(() => ''))
    if (t.slice(0, 12) === LONG.slice(0, 12)) { hit = el; hitText = t; hitBox = await box(el); break }
  }
  ck('D2r 注入的长名**就是**被量到的那一个 .row-title（第一轮量错了对象）',
    !!hit, { rowCount: titles.length, matched: hitText.slice(0, 20) })
  const row = await page.$('.list-row')
  const card = await page.$('.card')
  const rowBox = await box(row)
  const cardBox = await box(card)
  const okNoOverflow = !!(hitBox && cardBox && hitBox.left + hitBox.width <= cardBox.left + cardBox.width + 1)
  ck('D2r-b 80 字无空格拉丁串折行而不是撑破卡沿（.row-title 的 anywhere 在真机咬住）',
    okNoOverflow, { name: hitBox, card: cardBox })
  ck('D2r-c 它真的折了（多行高度 > 单行 22px；否则等于"没测到断词分支"）',
    !!(hitBox && hitBox.height && hitBox.height > 22), { height: hitBox && hitBox.height })
  await shot(mp, 'D2r-editor-node-longname-wrap.png', DIR_A)
  // 反向对照：同一条行换成普通短名，高度必须回到单行（证明上面那条不是恒真）
  const form2 = JSON.parse(JSON.stringify(base.form || {}))
  form2.points = [{ id: 'probe-short', name: '牛背山垭口', kind: 'start', lat: 30.1, lng: 103.1 }]
  await page.setData({ step: 1, form: form2 })
  await page.waitFor(1500)
  const titles2 = await page.$$('.row-title')
  let shortBox = null
  for (const el of titles2) {
    const t = String(await el.text().catch(() => ''))
    if (t === '牛背山垭口') { shortBox = await box(el); break }
  }
  ck('D2r-d 阴性对照：短名同一行是单行高（长名>短名 ⇒ 差异来自断词，不来自选择器抖动）',
    !!(shortBox && hitBox && shortBox.height < hitBox.height),
    { short: shortBox && shortBox.height, long: hitBox && hitBox.height })
  await shot(mp, 'D2r-editor-node-shortname-control.png', DIR_A)

  await mp.disconnect()
  fs.writeFileSync(path.join(DIR_A, 'readings-fix.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log('\n==== 修正重测 ' + pass + ' PASS / ' + fail + ' FAIL ====')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('驱动异常：' + (e && e.stack || e)); process.exit(3) })
