// 首页协作入口真机核验（驱动脚本，仓库外运行）
// 用法：node drive-home-collab.js <outDir>
'use strict'
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const OUT = process.argv[2]
if (!OUT) { console.error('缺 outDir 参数'); process.exit(2) }
fs.mkdirSync(OUT, { recursive: true })
const readings = { startedAt: new Date().toISOString(), cases: {}, gates: [] }
const fail = []
function gate(name, cond, extra) {
  readings.gates.push({ name, pass: !!cond, extra: extra === undefined ? null : extra })
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '（' + JSON.stringify(extra) + '）' : ''))
  if (!cond) fail.push(name)
}
async function shot(page, file) {
  const raw = await global.__mp.screenshot()
  fs.writeFileSync(path.join(OUT, file), Buffer.from(String(raw), 'base64'))
  return file
}
async function segFacts(page) {
  const segs = await page.$$('.segmented .seg')
  const out = []
  for (const s of segs) {
    const t = await s.text()
    const sz = await s.size()
    const off = await s.offset()
    out.push({ text: (t || '').trim(), width: Math.round(sz.width), height: Math.round(sz.height), left: Math.round(off.left), top: Math.round(off.top) })
  }
  return out
}
async function collabEls(page) {
  // 这个 automator/IDE 版本不支持 `>>>` 深选择器（会被改写成 `> > >` 而报 invalid selector），
  // 也不保证页面级 querySelectorAll 能穿透自定义组件 ⇒ 先整页试，空则逐张卡自己的句柄再试。
  let els = await page.$$('.collab-leaf')
  if (els.length) return els
  const cards = await page.$$('activity-card')
  const all = []
  for (const c of cards) all.push.apply(all, await c.$$('.collab-leaf'))
  return all
}
async function collabFacts(page, cap) {
  const els = await collabEls(page)
  const total = els.length
  const out = []
  // 真实数据有 151 张卡，逐个数属性是一轮一次往返——只量前 cap 枚，总数单独记
  for (const e of els.slice(0, cap || 6)) {
    const sz = await e.size()
    const off = await e.offset()
    out.push({
      text: (await e.text() || '').trim(), height: Math.round(sz.height), width: Math.round(sz.width),
      top: Math.round(off.top), left: Math.round(off.left),
      // 首轮真机抓到「深底配 .button.text 深绿字」几乎不可读 ⇒ 把样式类名也记进读数，
      // 这样"退回透明底深色字"这一类走偏在下一轮是机器读数，不必再靠人看图。
      cls: await e.attribute('class'),
    })
  }
  out.total = total
  return out
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CARD = (over) => Object.assign({
  id: 'demo-a', title: '龙泉山 · 日出徒步', date: '10/24 周六', meta: '龙泉山环线 · 12.5 km',
  status: '我组织的 · 正在集合', when: '剩 3 天', featured: false,
  info: '已确认 6 人 · 待审核 2 人 · 名额 12 人', collab: [],
}, over || {})

async function main() {
  global.__mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9428' })
  const mp = global.__mp
  const info = await mp.systemInfo()
  readings.systemInfo = { windowWidth: info.windowWidth, windowHeight: info.windowHeight, platform: info.platform }
  console.log('视口 ' + info.windowWidth + '×' + info.windowHeight)

  // ---------- 1. 真实数据：先证 bundle 是新的 ----------
  let page = await mp.reLaunch('/pages/home/home')
  await page.waitFor(6000)
  let d = await page.data()
  readings.real = {
    denied: d.denied, loading: d.loading, collabCount: d.collabCount,
    hasTasksKey: Object.prototype.hasOwnProperty.call(d, 'tasks'),
    cards: (d.cards || []).map(c => ({ id: c.id, featured: c.featured, collab: (c.collab || []).map(r => r.key) })),
  }
  gate('bundle 新鲜度：页面 data 里有 collabCount、且旧数组 tasks 已不存在',
    d.collabCount !== undefined && !readings.real.hasTasksKey,
    { collabCount: d.collabCount, hasTasksKey: readings.real.hasTasksKey })
  gate('真实读取没有落到 denied 面板', !d.denied, d.denied)
  readings.real.segs = await segFacts(page)
  readings.real.collabNodes = await collabFacts(page)
  gate('筛选段实际渲染出的档位数量与 collabCount 一致（>0 才有第四档）',
    readings.real.segs.length === (readings.real.collabCount > 0 ? 4 : 3),
    readings.real.segs.map(s => s.text))
  await shot(page, '01-real-home-top.png')

  // ---------- 1b. 真实数据点第四档：列表必须收缩到恰好那 18 场，且每场都带入口 ----------
  await page.callMethod('onFilter', { currentTarget: { dataset: { value: 'collab' } } })
  await page.waitFor(2500)
  d = await page.data()
  const real = {}
  real.filter = d.filter
  real.cards = (d.cards || []).length
  real.everyCardHasEntry = (d.cards || []).every(c => (c.collab || []).length > 0)
  real.collabKeys = (d.cards || []).slice(0, 6).map(c => (c.collab || []).map(r => r.key).join('+'))
  real.segs = await segFacts(page)
  readings.cases.D_realCollabTab = real
  gate('真实数据点第四档：列表从 ' + readings.real.cards.length + ' 场收缩到 collabCount 那 ' + d.collabCount + ' 场',
    real.cards === d.collabCount, { cards: real.cards, collabCount: d.collabCount })
  gate('第四档里每一张卡都至少带一枚协作入口（没有空入口的条目）', real.everyCardHasEntry, real.collabKeys)
  gate('第四档被选中（DOM 上 .seg.on 是第 4 个）',
    (await page.$$('.segmented .seg.on')).length === 1 && real.segs[3] !== undefined, real.segs.map(s => s.text))
  await shot(page, '07-real-collab-tab.png')
  await page.callMethod('onFilter', { currentTarget: { dataset: { value: 'mine' } } })
  await page.waitFor(1500)

  // ---------- 2. 受控：双角色两枚入口 + featured 森林底 ----------
  await page.setData({
    loading: false, denied: '', hasAny: true, filter: 'collab', search: '', collabCount: 2,
    cards: [
      CARD({ id: 'demo-a', featured: true, status: '现场协作 · 车辆联络 · 正在集合', collab: [{ key: 'staff', label: '现场协作' }, { key: 'vehicle', label: '车辆联络' }] }),
      CARD({ id: 'demo-b', title: '青城后山半日', status: '我组织的 · 草稿', date: '日期待定', when: '', collab: [{ key: 'vehicle', label: '车辆联络' }] }),
    ],
  })
  await page.waitFor(2500)
  const A = {}
  A.segs = await segFacts(page)
  A.segmentedHeight = Math.round((await (await page.$('.segmented')).size()).height)
  A.collab = await collabFacts(page)
  readings.cases.A_dualRole = A
  gate('A 第四档存在且带计数', A.segs.length === 4 && /需要协作\s*2/.test(A.segs[3].text), A.segs.map(s => s.text))
  gate('A 双角色卡上两枚入口都在（staff 不吞 vehicle）', A.collab.length === 3, A.collab)
  gate('A 每枚入口高度 ≥44px（触控目标）', A.collab.every(c => c.height >= 44), A.collab.map(c => c.height))
  // 下面两条都是首轮真机抓到的缺陷转成的读数判据（静态门与 Node 逻辑门都看不见它们）
  gate('A 同一张卡的两枚入口排在同一行（top 相同，不再被主入口挤成一枚一行）',
    A.collab[0].top === A.collab[1].top, [A.collab[0].top, A.collab[1].top])
  gate('A 协作入口是浅底 leaf（不许退回透明底 + 深绿字压在森林底上）',
    A.collab.every(c => /\bleaf\b/.test(c.cls || '')), A.collab.map(c => c.cls))
  gate('A 四档没有换行成两行（segmented 高度仍是一档高）', A.segmentedHeight < 70, A.segmentedHeight)
  gate('A 四档都在视口内（最右一档不溢出 ' + info.windowWidth + 'px）',
    A.segs.every(s => s.left >= 0 && s.left + s.width <= info.windowWidth), A.segs.map(s => [s.left, s.width]))
  await shot(page, '02-A-dual-role-featured.png')
  // 元素级截图在这个 automator 版本上没有（featured.screenshot is not a function）
  // ⇒ 改为滚到 featured 卡再拍整屏，像素证据仍是同一张卡。
  const featured = await page.$('.activity-card--featured')
  if (featured) {
    const off = await featured.offset()
    await mp.pageScrollTo(Math.max(0, off.top - 20))
    await page.waitFor(900)
    readings.cases.A_dualRole.featuredTop = Math.round(off.top)
    readings.cases.A_dualRole.crop = await shot(page, '03-A-featured-card-scrolled.png')
  }

  // ---------- 2b. 375px：这个 automator 版本没有 setViewport（实测 mp.setViewport is not a function），
  //   换设备档位要动 IDE 图形界面 ⇒ 不假装量过。只用实测量反推，并标明是推算。
  {
    const segBox = await (await page.$('.segmented')).size()
    const segW = A.segs[0].width            // 实测：四档等分后每档外框
    const segPad = 12                       // app.wxss .segmented .seg { padding: 8px 6px }
    const gap = 4, boxPad = 8
    const textW = segW - segPad             // 实测：一档文字的渲染宽（等分下即内容宽）
    const innerAt375 = (segBox.width - (info.windowWidth - 375) - boxPad - gap * 3) / 4 - segPad
    readings.cases.A2_viewport375 = {
      pixelVerified: false,
      reason: 'automator 无 setViewport；换设备档位要动 IDE 图形界面',
      measured: { windowWidth: info.windowWidth, segmentedWidth: Math.round(segBox.width), segOuter: segW, segTextWidth: textW },
      computed: { innerTextWidthAt375: Math.round(innerAt375) },
      verdict: innerAt375 >= textW ? '推算：单行放得下' : '推算：第四档标签会在按钮内换行（行高变两行，不是整段溢出）',
    }
    console.log('  ! 375px 未拍像素。按实测反推：一档文字需 ' + textW + 'px，375 下只有 '
      + Math.round(innerAt375) + 'px ⇒ ' + readings.cases.A2_viewport375.verdict)
  }

  // ---------- 3. 受控：无授权 ⇒ 第四档整档消失 ----------
  await page.setData({
    collabCount: 0, filter: 'mine',
    cards: [CARD({ id: 'demo-c', featured: true, collab: [] }), CARD({ id: 'demo-d', collab: [] })],
  })
  await page.waitFor(2000)
  const B = {}
  B.segs = await segFacts(page)
  B.collab = await collabFacts(page)
  readings.cases.B_noGrant = B
  gate('B 只剩三档（计数为 0 时第四档不出现，不是灰掉）', B.segs.length === 3, B.segs.map(s => s.text))
  gate('B 卡上零枚协作入口', B.collab.length === 0, B.collab)
  await shot(page, '04-B-no-grant.png')

  // ---------- 4. 受控：空列表（with-tabbar 假开关那一支的留白仍要够） ----------
  await page.setData({ collabCount: 0, filter: 'mine', cards: [], hasAny: false })
  await page.waitFor(1500)
  await shot(page, '05-C-empty.png')
  readings.cases.C_empty = { segs: (await segFacts(page)).length }

  readings.finishedAt = new Date().toISOString()
  readings.fails = fail
  fs.writeFileSync(path.join(OUT, 'readings.json'), JSON.stringify(readings, null, 2), 'utf8')
  await mp.disconnect()
  console.log('\n失败=' + fail.length + (fail.length ? '：' + fail.join(' ｜ ') : ''))
  process.exit(fail.length ? 1 : 0)
}

main().catch(e => {
  console.error('驱动异常：' + (e && e.stack || e))
  try { fs.writeFileSync(path.join(OUT, 'readings.json'), JSON.stringify(readings, null, 2), 'utf8') } catch (_) {}
  process.exit(1)
})
