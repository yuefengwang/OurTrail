'use strict'
/* D2r 第二轮：第一轮的失败原因在**夹具不在判据**（铁律 34⑥/33⑧ 的同一条教训）——
   节点行套在 <block wx:if="{{routeDetailsOpen}}"> 里（editor.wxml:233、editor.js:849），
   我只 setData 了 form.points 却没打开这一支 ⇒ 那一行根本没渲染，matched="" 是真话，
   不能用"屏上有 1 个 .row-title"充数。这次显式打开，并且双向都测：
   长名（必须折行且不撑破）+ 短名阴性对照（必须单行），两读数不同才算测到了断词分支。 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')
const DIR_A = path.join('D:/OurTrail/docs/ui-ux-redesign/evidence/style-b-slice5a-2026-10-26/device')
const LONG = 'MuztaghAttakunerjikghvwtssherartokenglongnonspacelatinstringabcdefghijklmnop'
const out = { checks: [], notes: [] }
let pass = 0, fail = 0
function ck(name, ok, detail) {
  out.checks.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS ' : '  FAIL ') + name + '\n       ' + JSON.stringify(detail).slice(0, 320))
  if (ok) pass++; else fail++
}
const v = x => (x && typeof x === 'object' ? x.value : x)
async function box(el) {
  if (!el) return null
  let s = null, o = null
  try { s = await el.size() } catch (e) {}
  try { o = await el.offset() } catch (e) {}
  return { width: v(s && s.width), height: v(s && s.height), left: v(o && o.left), top: v(o && o.top) }
}
async function styleOf(el, prop) {
  if (!el) return null
  try { const r = await el.style(prop); return r && typeof r === 'object' ? r.value : r } catch (e) { return null }
}
async function findRowTitle(page, text) {
  const list = await page.$$('.row-title')
  for (const el of list) {
    const t = String(await el.text().catch(() => ''))
    if (t.slice(0, 12) === String(text).slice(0, 12)) return el
  }
  return null
}
async function shot(mp, file) {
  const buf = Buffer.from(String(await mp.screenshot()), 'base64')
  fs.writeFileSync(path.join(DIR_A, file), buf)
  console.log('  · 截图 ' + path.join(DIR_A, file) + ' (' + buf.length + ' bytes)')
}

;(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9441' })
  let page = await mp.reLaunch('/pages/editor/editor')
  await page.waitFor(6000)
  const base = await page.data()
  const mkForm = name => {
    const f = JSON.parse(JSON.stringify(base.form || {}))
    f.points = [{ id: 'probe-' + name.slice(0, 4), name, kind: 'start', lat: 30.1, lng: 103.1 }]
    return f
  }
  const open = { step: 1, routeDetailsOpen: true }

  await page.setData(Object.assign({ form: mkForm(LONG) }, open))
  await page.waitFor(2000)
  const gate = await page.$('.step-group')
  ck('D0 门槛链：routeDetailsOpen 生效后节点区在屏（.step-group 命中）', !!gate, { stepGroup: await box(gate) })
  const longEl = await findRowTitle(page, LONG)
  const longBox = await box(longEl)
  ck('D1 长名那一行确实是 .row-title（按文本反查，不是数存在）',
    !!longEl, { rowCount: (await page.$$('.row-title')).length, matched: longEl ? String(await longEl.text()).slice(0, 16) : '' })
  const wrap = await styleOf(longEl, 'overflow-wrap')
  ck('D2 该元素计算值是 overflow-wrap:anywhere（5b 收进来的那半句在真机生效）',
    wrap === 'anywhere', { overflowWrap: wrap })
  const card = await box(await page.$('.card'))
  const right = longBox && (longBox.left + longBox.width)
  ck('D3 80 字无空格拉丁串没有越出卡沿（撑破=不合格）',
    !!(longBox && card && right <= card.left + card.width + 1), { name: longBox, card })
  ck('D4 它真的折了（高度 > 单行 22px；单行就说明断词分支没被走到）',
    !!(longBox && longBox.height > 22), { height: longBox && longBox.height })
  await shot(mp, 'D2r2-editor-node-longname-wrap.png')

  // 阴性对照：普通短名同一行必须回到单行（两读数相同 ⇒ 整批无效）
  await page.setData(Object.assign({ form: mkForm('牛背山垭口') }, open))
  await page.waitFor(1500)
  const shortEl = await findRowTitle(page, '牛背山垭口')
  const shortBox = await box(shortEl)
  const shortWrapCount = await styleOf(shortEl, 'overflow-wrap')
  ck('D5 阴性对照：短名单行（与长名高度不同，差异来自断词而不是选择器抖动）',
    !!(shortBox && longBox && shortBox.height < longBox.height && longBox.height > 22),
    { short: shortBox, longHeight: longBox && longBox.height, shortOverflowWrap: shortWrapCount })
  await shot(mp, 'D2r2-editor-node-shortname-control.png')

  await mp.disconnect()
  fs.writeFileSync(path.join(DIR_A, 'readings-node.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log('\n==== 节点行断词回读 ' + pass + ' PASS / ' + fail + ' FAIL ====')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('驱动异常：' + (e && e.stack || e)); process.exit(3) })
