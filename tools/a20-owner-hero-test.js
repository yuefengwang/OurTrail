// A-20 判据：node tools/a20-owner-hero-test.js
// 对象：miniprogram/pages/home/home.js（首页卡 info 行的「待审核 N 人」）
//       miniprogram/pages/discover/discover.js（搜索结果第一条被升为 hero）
// 手法：与 tools/scenario-discover-test.js 同源——global.Page 捕获真页面配置 +
//       wx.cloud.callFunction 信封桩（read 走真 utils/api），断言的是**真页面装配出来的卡片串**，
//       测试里不重写页面的拼装逻辑（镜像页面逻辑=给过期契约背书，见 SYNC.md:162 / 铁律 11）。
// 双向要求（本仓库第十/十一轮的教训：减话类改动只测「被藏起来」会放过「永远不说」）：
//   · 非组织者看不到待审核 = 一条断言；组织者仍看得到 = 另一条断言；
//   · 搜索结果不升 hero；L2/L3 已批准发现页全量改紧凑卡，重点阳性对照迁至首页。
//     保留搜索清空/空白词/原列表顺序/字段完整性覆盖，不把旧 hero 门直接删除。
// 判据是行为级的：同一个 pending 数字换归属位（meta.owner）分别产出什么；
// 不数节点、不钉源码文本（铁律 30/21）。
'use strict'
const HOME_PATH = require.resolve('../miniprogram/pages/home/home.js')
const DISCOVER_PATH = require.resolve('../miniprogram/pages/discover/discover.js')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const NOW = '2026-10-14T09:00:00+08:00'
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 1500
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return cond()
}
const clone = o => JSON.parse(JSON.stringify(o))
function exceptCard(c, keys) {
  const out = {}
  for (const k of Object.keys(c)) if (keys.indexOf(k) === -1) out[k] = c[k]
  return out
}

// 首页投影夹具：形状取自 domain/selectors.js 的 home 分支（activityView + meta）。
// A/B 两场的 confirmed/pending/capacity **完全相同**，只有归属位不同 ⇒
// 两行文案的任何差异都只能来自归属，不可能来自数字。
function homeActivity(id, over) {
  const base = {
    id: id,
    title: '青城后山 · 周末轻徒步',
    description: '周末轻徒步',
    phase: 'published',
    startAt: '2026-10-20T08:00:00+08:00',
    routeSnapshot: { title: '飞泉沟环线', distanceKm: 12.5 },
    meta: {
      owner: true, joined: true, staff: false, vehicle: false,
      confirmed: 3, pending: 7, capacity: 10, positionRows: [],
    },
  }
  return Object.assign(base, over || {})
}
function withoutKey(meta, key) {
  const m = clone(meta)
  delete m[key]
  return m
}
// C16（2026-10-26 style-B）：首屏「下一次同行」会从「我的活动」列表里剔除自己。
// 凡要断言列表本身的用例，都先铺一场更早的同行活动去占首屏；它不带协作角色、不参与这些用例的判据。
function hero() {
  return homeActivity('soon', { startAt: '2026-10-15T08:00:00+08:00' })
}

// ---- 首页：四个并行 read 全走真 utils/api ----
function bootHome(opts) {
  opts = opts || {}
  const env = { reads: [], nav: [], toasts: [] }
  const byPerspective = opts.byPerspective || {}
  const opened = opts.opened || []
  global.wx = {
    cloud: { callFunction(req) {
      if (req.data.action === 'read') {
        const r = req.data.request
        env.reads.push(r)
        if (r.kind === 'profile') {
          return Promise.resolve({ result: { ok: true, data: { view: { kind: 'profile', profile: { person: { name: '测试者' } } }, revision: 5, now: NOW } } })
        }
        const acts = (Object.prototype.hasOwnProperty.call(byPerspective, r.perspective)
          ? byPerspective[r.perspective] : (opts.activities || []))
        return Promise.resolve({ result: { ok: true, data: { view: { kind: 'home', activities: clone(acts) }, revision: 5, now: NOW } } })
      }
      return Promise.resolve({ result: { ok: true, data: {} } })
    } },
    navigateTo(o) { env.nav.push((o && o.url) || '') },
    stopPullDownRefresh() {},
    showToast(o) { env.toasts.push((o && o.title) || '') },
    getStorageSync(k) { return k === 'ourtrail.opened.v1' ? opened.slice() : '' },
    setStorageSync() {},
  }
  global.Page = cfg => { global.__CFG = cfg }
  delete require.cache[HOME_PATH]
  require(HOME_PATH)
  const cfg = global.__CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  page.onLoad({})
  page.onShow()
  return { page, env }
}
function cardOf(page, id) {
  return page.data.cards.find(c => c.id === id) || null
}

// ---- 发现页 ----
function discoverActivity(id, over) {
  const base = {
    id: id, title: '雪山 · ' + id, description: '', organizerIntro: '老王带队',
    phase: 'published', owner: false, startAt: '2026-10-22T08:00:00+08:00',
    routeSnapshot: { title: '雪线路径', distanceKm: 9 },
    confirmed: 4, capacity: 12, acceptingSignups: true, publishedAt: '2026-10-01T10:00:00+08:00',
  }
  return Object.assign(base, over || {})
}
function bootDiscover(opts) {
  opts = opts || {}
  const env = { reads: [], nav: [] }
  global.wx = {
    cloud: { callFunction(req) {
      if (req.data.action === 'read') {
        const r = req.data.request
        env.reads.push(r)
        return Promise.resolve({ result: { ok: true, data: { view: { kind: 'discover', activities: clone(opts.activities || []) }, revision: 5, now: NOW } } })
      }
      return Promise.resolve({ result: { ok: true, data: {} } })
    } },
    navigateTo(o) { env.nav.push((o && o.url) || '') },
    stopPullDownRefresh() {},
    getStorageSync() { return '' },
    setStorageSync() {},
  }
  global.Page = cfg => { global.__CFG = cfg }
  delete require.cache[DISCOVER_PATH]
  require(DISCOVER_PATH)
  const cfg = global.__CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  page.onLoad({})
  page.onShow()
  return { page, env }
}

async function main() {
  // ============ 1. 首页：待审核只对组织者出现（第一半） ============
  section('1. 首页 info 行：同一个数字，两种归属，两种产出')
  {
    const acts = [
      hero(),
      homeActivity('own'),
      homeActivity('other', { meta: Object.assign(clone(homeActivity('x').meta), { owner: false }) }),
    ]
    const { page } = bootHome({ activities: acts })
    await waitFor(() => page.data.loading === false)
    const mine = cardOf(page, 'own')
    const theirs = cardOf(page, 'other')
    check('有效性门：两张卡都装配出来了（不是空列表让断言空转）',
      page.data.cards.length === 2 && !!mine && !!theirs, JSON.stringify(page.data.cards.map(c => c.id)))
    check('组织者读到「待审核 7 人」——收口不得把组织者自己的工作队列一起关掉',
      mine.info === '已确认 3 人 · 待审核 7 人 · 名额 10 人', mine.info)
    check('非组织者读不到「待审核」——组织者工作队列不再泄漏给访问者',
      theirs.info.indexOf('待审核') === -1, theirs.info)
    check('非组织者的整行里连那个数字本身都不出现（泄漏判据是数字，不是词）',
      theirs.info.indexOf('7') === -1, theirs.info)
    check('非组织者的行仍是完整两句，不是空串/半句（减话不能长成「工具坏了」）',
      theirs.info === '已确认 3 人 · 名额 10 人', theirs.info)
    check('两行唯一差异就是那一段（去掉它，非组织者行与组织者行逐字节相同）',
      mine.info.replace(' · 待审核 7 人', '') === theirs.info, mine.info + ' / ' + theirs.info)
    check('除归属相关的字段（info/status/featured + 新槽位 roleNote/pending）外卡片逐字节相同：收口没顺手改名、减卡、动 hero',
      JSON.stringify(exceptCard(mine, ['id', 'info', 'status', 'featured', 'roleNote', 'pending'])) === JSON.stringify(exceptCard(theirs, ['id', 'info', 'status', 'featured', 'roleNote', 'pending'])),
      JSON.stringify([exceptCard(mine, ['id', 'info', 'status', 'featured', 'roleNote', 'pending']), exceptCard(theirs, ['id', 'info', 'status', 'featured', 'roleNote', 'pending'])]))
    check('归属前缀「我组织的」照旧（本页原有的归属表达没被动过）',
      mine.status.indexOf('我组织的 · ') === 0 && theirs.status.indexOf('我组织的') === -1,
      mine.status + ' / ' + theirs.status)
    // 2026-10-26 style-B：归属从 status 一长串拆成 roleNote（左）与 pending（右）两个槽位。
    // 这是同一事实的新表达，必须与 info/status 同源：组织者两处都在，非组织者两处都空。
    check('新槽位与旧行同源：roleNote/pending 只在归属侧出现，非组织者一格都不漏',
      mine.roleNote === '我组织的' && theirs.roleNote === ''
      && mine.pending === '待审核 7 人' && theirs.pending === '',
      [mine.roleNote, theirs.roleNote, mine.pending, theirs.pending].join(' / '))
  }

  section('1b. 同一场活动只换归属位：只有 info 与 status 变，hero/时间/日期一个字节都不动')
  {
    const asOwner = (() => { const a = homeActivity('solo'); return [hero(), a] })()
    const asGuest = (() => { const a = homeActivity('solo'); a.meta.owner = false; return [hero(), a] })()
    const po = bootHome({ activities: asOwner })
    await waitFor(() => po.page.data.loading === false)
    const pg = bootHome({ activities: asGuest })
    await waitFor(() => pg.page.data.loading === false)
    const co = cardOf(po.page, 'solo')
    const cg = cardOf(pg.page, 'solo')
    check('有效性门：两次都装配出同一场活动（id/startAt 相同）',
      !!co && !!cg && co.date === cg.date, JSON.stringify([co, cg]))
    check('C16 夹具自证：首屏是另一场更早的活动，solo 才留在列表里',
      po.page.data.nextUp && po.page.data.nextUp.id === 'soon', JSON.stringify(po.page.data.nextUp))
    check('hero 判定与归属无关（featured 两次相同 = 本轮没有把 hero 逻辑牵扯进来）',
      co.featured === cg.featured, JSON.stringify([co.featured, cg.featured]))
    check('when（出发倒计时）两次逐字节相同——首页那条「还有多久」是设计决定，不许被动',
      co.when === cg.when && co.when !== '', co.when + ' / ' + cg.when)
    check('除 info/status/roleNote/pending 外全部字段逐字节相同（越界 0）',
      JSON.stringify(exceptCard(co, ['info', 'status', 'roleNote', 'pending'])) === JSON.stringify(exceptCard(cg, ['info', 'status', 'roleNote', 'pending'])),
      JSON.stringify([co, cg]))
    check('info 的差异恰好是那一段（不多不少，不留分隔符孤尾）',
      co.info === cg.info.slice(0, '已确认 3 人'.length) + ' · 待审核 7 人' + cg.info.slice('已确认 3 人'.length),
      co.info + ' / ' + cg.info)
  }

  section('2. 首页：待审核的 0 与缺位（0 是事实，缺位按非组织者）')
  {
    const acts = [
      hero(),
      homeActivity('zero-own', { meta: Object.assign(clone(homeActivity('x').meta), { pending: 0 }) }),
      homeActivity('zero-other', { meta: Object.assign(clone(homeActivity('x').meta), { pending: 0, owner: false }) }),
    ]
    const { page } = bootHome({ activities: acts })
    await waitFor(() => page.data.loading === false)
    check('组织者 + pending=0 仍印「待审核 0 人」：0 是「审完了」这个事实，不是缺失',
      cardOf(page, 'zero-own').info === '已确认 3 人 · 待审核 0 人 · 名额 10 人',
      cardOf(page, 'zero-own').info)
    check('非组织者 + pending=0 也不因数字为 0 而多出一段空文本（分隔符没留孤尾）',
      cardOf(page, 'zero-other').info === '已确认 3 人 · 名额 10 人',
      cardOf(page, 'zero-other').info)
    check('新槽位同源：组织者 pending 槽照印 0，非组织者整格为空',
      cardOf(page, 'zero-own').pending === '待审核 0 人' && cardOf(page, 'zero-other').pending === '',
      cardOf(page, 'zero-own').pending + ' / ' + cardOf(page, 'zero-other').pending)
  }
  {
    const acts = [hero(), homeActivity('nokey', { meta: withoutKey(homeActivity('x').meta, 'owner') })]
    const { page } = bootHome({ activities: acts })
    await waitFor(() => page.data.loading === false)
    const c = cardOf(page, 'nokey')
    check('投影没给归属位 ⇒ 失败关闭（越权数字宁可不出，不从别的字段反推）',
      c.info === '已确认 3 人 · 名额 10 人', c.info)
  }

  section('3. 首页：三个入口（我的/最近/协作视角合并）口径一致')
  {
    const acts = [
      homeActivity('own-recent', { meta: Object.assign(clone(homeActivity('x').meta), { joined: false }) }),
      homeActivity('guest-recent', { meta: Object.assign(clone(homeActivity('x').meta), { owner: false, joined: false }) }),
    ]
    const { page } = bootHome({ activities: acts, opened: ['own-recent', 'guest-recent'] })
    await waitFor(() => page.data.loading === false)
    // C16：own-recent 正是首屏那一场 ⇒ 默认「我的活动」里只剩空列表（guest-recent 本就不在这一档）。
    check('C16：默认档里 hero 不在列表里重复，列表空态说明它已经在上面',
      page.data.nextUp && page.data.nextUp.id === 'own-recent' && page.data.cards.length === 0
      && page.data.emptyTitle === '其余活动会出现在这里',
      JSON.stringify([page.data.nextUp, page.data.cards.map(c => c.id), page.data.emptyTitle]))
    page.onFilter({ currentTarget: { dataset: { value: 'recent' } } })
    await waitFor(() => page.data.cards.length === 2)
    check('C16 的范围：剔除只发生在「我的活动」；「最近查看」里同一场必须还在（那一档的名字就是它）',
      !!cardOf(page, 'own-recent'),
      JSON.stringify(page.data.cards.map(c => c.id)))
    const own = cardOf(page, 'own-recent')
    const guest = cardOf(page, 'guest-recent')
    check('「最近查看」里的组织者活动仍含待审核（第二个入口没漏）',
      own.info.indexOf('待审核 7 人') !== -1, own.info)
    check('「最近查看」里的非组织者活动不含待审核（第二半：没从 openedIds 反推归属）',
      guest.info.indexOf('待审核') === -1 && guest.info.indexOf('7') === -1, guest.info)
  }
  {
    // 只在协作/车辆视角里出现的活动：首页合并后 meta 来自那一路 read，归属位仍是服务端给的
    const staffOnly = homeActivity('staff-only', { meta: Object.assign(clone(homeActivity('x').meta), { owner: false, joined: false, staff: true }) })
    const vehicleOwned = homeActivity('veh-own', { meta: Object.assign(clone(homeActivity('x').meta), { joined: false, vehicle: true }) })
    const { page } = bootHome({
      activities: [],
      opened: ['staff-only', 'veh-own'],
      byPerspective: { participant: [], staff: [staffOnly], vehicle: [vehicleOwned] },
    })
    await waitFor(() => page.data.loading === false)
    page.onFilter({ currentTarget: { dataset: { value: 'recent' } } })
    await waitFor(() => page.data.cards.length === 2)
    check('协作/车辆视角合并进来的两场都算进「需要协作」的计数（合并路径真的跑到了）',
      page.data.collabCount === 2, JSON.stringify({ collabCount: page.data.collabCount, cards: page.data.cards.length }))
    page.onFilter({ currentTarget: { dataset: { value: 'collab' } } })
    await waitFor(() => page.data.cards.length === 2)
    check('第四档筛出的恰好是这两场，且各自带着自己的协作入口（入口来自服务端 meta，不是 openedIds）',
      page.data.cards.map(c => c.id).sort().join(',') === 'staff-only,veh-own'
      && cardOf(page, 'staff-only').collab.map(r => r.key).join(',') === 'staff'
      && cardOf(page, 'veh-own').collab.map(r => r.key).join(',') === 'vehicle',
      JSON.stringify(page.data.cards.map(c => ({ id: c.id, collab: c.collab }))))
    check('合并后的卡里，非归属那条不含待审核、归属那条含（判据听 meta.owner，不听视角）',
      cardOf(page, 'staff-only').info.indexOf('待审核') === -1
      && cardOf(page, 'veh-own').info.indexOf('待审核 7 人') !== -1,
      cardOf(page, 'staff-only').info + ' / ' + cardOf(page, 'veh-own').info)
  }

  section('4a. 重点迁移的阳性对照：首页既有 featured 不可被一刀切关掉')
  {
    const { page } = bootHome({ activities: [
      hero(),
      homeActivity('later', { startAt: '2026-11-03T08:00:00+08:00' }),
      homeActivity('first', { startAt: '2026-11-01T08:00:00+08:00' }),
    ] })
    await waitFor(() => !page.data.loading)
    check('首页按出发时间排序，只有首张非草稿是重点',
      page.data.cards.map(c => c.id).join(',') === 'first,later'
      && page.data.cards[0].featured === true && page.data.cards[1].featured === false)
  }
  {
    const { page } = bootHome({ activities: [hero(), homeActivity('draft-first', { phase: 'draft' }), homeActivity('second')] })
    await waitFor(() => !page.data.loading)
    check('首页首张是草稿时仍不提升，不擅自越过它另猜重点', page.data.cards.length === 2 && page.data.cards.every(c => !c.featured))
  }
  section('4. 发现页：全量/搜索/清空都不制造重点，卡片事实与顺序完整保留')
  {
    const acts = [discoverActivity('d1'), discoverActivity('d2', { owner: true }), discoverActivity('d3')]
    const { page, env } = bootDiscover({ activities: acts })
    await waitFor(() => page.data.loading === false)
    check('有效性门：不带搜索词时装配出 3 张卡',
      page.data.cards.length === 3, JSON.stringify(page.data.cards.map(c => c.id)))
    check('全量发现列表不升 hero（已批准的新边界，首页阳性对照见 4a）',
      page.data.cards.every(c => c.featured === false), JSON.stringify(page.data.cards.map(c => c.featured)))
    check('不提升也不改服务端给出的列表顺序',
      page.data.cards.map(c => c.id).join(',') === 'd1,d2,d3', JSON.stringify(page.data.cards.map(c => c.id)))
    check('read 请求确实不带搜索词（hero 判定与发出去的 search 同口径）',
      env.reads[0].search === '', JSON.stringify(env.reads[0]))

    const browse = clone(page.data.cards)
    page.data.search = '雪山'
    await page.reload()
    const searched = clone(page.data.cards)
    check('有效性门：带搜索词时同样的 3 张卡都在（hero 消失不是因为列表空了）',
      searched.length === 3 && searched.every(c => !!c.id), JSON.stringify(searched.map(c => c.id)))
    check('搜索结果一条都不升 hero（第一条只是「关键词恰好命中」，没有编辑依据）',
      searched.every(c => c.featured === false), JSON.stringify(searched.map(c => c.featured)))
    check('搜索与全量同一结果全部字段逐字节相同（不再豁免 featured）',
      JSON.stringify(searched) === JSON.stringify(browse), JSON.stringify([browse, searched]))

    const beforeClear = env.reads.length
    page.onClearSearch()
    await waitFor(() => env.reads.length > beforeClear)
    check('清空搜索真实重查，并恢复全部卡片事实而不提升 hero',
      env.reads[env.reads.length - 1].search === '' && JSON.stringify(page.data.cards) === JSON.stringify(browse),
      JSON.stringify(page.data.cards.map(c => c.featured)))

    page.data.search = '   '
    await page.reload()
    check('只有空格按空请求处理，卡片与全量逐字相同',
      env.reads[env.reads.length - 1].search === '' && JSON.stringify(page.data.cards) === JSON.stringify(browse),
      JSON.stringify(page.data.cards.map(c => c.featured)))
    page.onUnload()
  }

  section('5. 跨页：同一个卡片组件，不该出现第三种「待审核」口径')
  {
    const acts = [discoverActivity('d1', { owner: true })]
    const { page } = bootDiscover({ activities: acts })
    await waitFor(() => page.data.loading === false)
    check('发现页即使这条是「我组织的」也不印待审核（本页投影里没有这个数，也不该被补出来）',
      page.data.cards[0].info.indexOf('待审核') === -1, page.data.cards[0].info)
    check('发现页的归属位仍只用于「我组织的」标签，没有被拿去决定别的事',
      page.data.cards[0].status === '我组织的', page.data.cards[0].status)
  }

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => {
  failed++
  console.error('  ✗ 用例执行异常（' + (e && e.message) + '）')
  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(1)
})
