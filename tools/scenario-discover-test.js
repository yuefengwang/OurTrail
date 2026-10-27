// 发现页场景测试：node tools/scenario-discover-test.js
// 对象：miniprogram/pages/discover/discover.js（ADR-0003 公开发现列表，只读 + 搜索）。
// 关键契约：discoverView 是**窄投影**（不含 ownerId 原始 openid、不含 pickupPoints），
// 页面映射不得依赖这两个字段；搜索 300ms 防抖只发一次 read；onUnload 清掉挂起的防抖定时器。
// 手法与 tools/scenario-signup-test.js 一致：global.Page 捕获真配置 + wx.cloud.callFunction 信封桩
// （read/dispatch 走真 utils/api，errorText/denied 透出全是真代码路径）。
'use strict'
const fs = require('fs')
const path = require('path')
const DISCOVER_PATH = require.resolve('../miniprogram/pages/discover/discover.js')
const api = require('../miniprogram/utils/api')
const F = require('../miniprogram/utils/format')

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

const NOW = '2026-09-29T09:00:00+08:00'
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 1500
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return cond()
}
function keysOf(o) { return Object.keys(o || {}).sort().join(',') }

// 窄投影样例：活动对象**故意不带** ownerId / pickupPoints 字段（discoverView 的安全契约）
function discoverView(over) {
  const base = {
    kind: 'discover',
    activities: [
      { id: 'a1', title: '青城后山 · 周末轻徒步', phase: 'published', owner: true,
        startAt: '2026-10-03T08:00:00+08:00', organizerIntro: '老王带队',
        confirmed: 3, capacity: 20, acceptingSignups: true,
        routeSnapshot: {
          title: '飞泉沟环线', distanceKm: 12.5,
          points: [{ id: 'pt-1', name: '起点', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 } }],
        } },
      { id: 'a2', title: '', phase: 'gathering', owner: false,
        startAt: '2026-10-10T07:30:00+08:00', organizerIntro: null,
        confirmed: 0, capacity: 10, acceptingSignups: false,
        routeSnapshot: { title: '', distanceKm: 8 } },
    ],
  }
  return Object.assign(base, over || {})
}

// ---- 信封桩：read 走真 api.read；错误信封（ok:false）由 api 层抛错，走真 errorText ----
function bootDiscover(opts) {
  opts = opts || {}
  const env = { reads: [], nav: [], pull: 0, hold: false, held: [] }
  env.view = opts.view || discoverView()
  env.envelope = opts.envelope || null // 非空时 read 返回该信封（模拟服务端错误）
  global.wx = {
    cloud: { callFunction(req) {
      if (req.data.action === 'read') {
        env.reads.push(req.data.request)
        const body = env.envelope || { ok: true, data: { view: env.view, revision: 5, now: NOW } }
        // 只控制云边界的回包顺序；reload / input / filter 装配全部运行真页面。
        if (env.hold) return new Promise((resolve, reject) => env.held.push({
          resolve: (view, revision) => resolve({ result: { ok: true, data: { view, revision, now: NOW } } }),
          reject,
        }))
        return Promise.resolve({ result: body })
      }
      return Promise.resolve({ result: { ok: true, data: {} } })
    } },
    navigateTo(o) { env.nav.push((o && o.url) || '') },
    stopPullDownRefresh() { env.pull++ },
  }
  global.Page = cfg => { global.__CFG = cfg }
  delete require.cache[DISCOVER_PATH]
  require(DISCOVER_PATH)
  const cfg = global.__CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page._patches = []
  page.setData = function (patch, cb) {
    this._patches.push(patch)
    Object.assign(this.data, patch)
    if (cb) setImmediate(cb)
  }
  page.onLoad(opts.options || {})
  page.onShow()
  return { page, env }
}

async function main() {
  section('1. 首屏装配与窄投影消费')
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    check('read 请求恰好 {kind, search} 两键、search 为空串',
      env.reads.length === 1 && keysOf(env.reads[0]) === 'kind,search' && env.reads[0].search === '',
      JSON.stringify(env.reads[0]))
    check('卡片两张、标题兜底「未命名活动」',
      page.data.cards.length === 2 && page.data.cards[1].title === '未命名活动', JSON.stringify(page.data.cards.map(c => c.title)))
    // L2/L3：路线名、路线指标、补充事实分槽，不再用 routeName 吞掉 meta 的难度。
    check('日期仍归 format；路线名与里程分别完整进入自己的槽位',
      page.data.cards[0].date === F.dateLabel('2026-10-03T08:00:00+08:00')
      && page.data.cards[0].routeName === '飞泉沟环线'
      && page.data.cards[1].routeName === '路线待完善'
      && JSON.stringify(page.data.cards.map(c => c.metrics)) === JSON.stringify([
        [{ key: 'distance', label: '距离', value: '12.5', unit: 'km' }],
        [{ key: 'distance', label: '距离', value: '8', unit: 'km' }],
      ]), JSON.stringify(page.data.cards))
    check('状态行：我组织的 / 阶段标签归口 format',
      page.data.cards[0].status === '我组织的'
      && page.data.cards[1].status === (F.PHASE_LABELS['gathering'] || 'gathering'),
      page.data.cards[0].status + ' / ' + page.data.cards[1].status)
    check('信息行过滤空介绍并拼接',
      page.data.cards[0].info === '老王带队 · 已确认 3 人 · 名额 20 人 · 可报名'
      && page.data.cards[1].info === '已确认 0 人 · 名额 10 人 · 暂不报名',
      page.data.cards[1].info)
    check('发现列表不再提升任意一张为重点（首页重点的阳性对照在 a20）', page.data.cards.every(c => c.featured === false), '')
    check('窄投影：卡片不携带 ownerId / pickupPoints（不泄露 openid 与集合点）',
      page.data.cards.every(c => !('ownerId' in c) && !('pickupPoints' in c)),
      JSON.stringify(Object.keys(page.data.cards[0])))
    check('denied 复位、loading 收尾', page.data.denied === '' && page.data.loading === false, page.data.denied)
  }

  section('2. 空态与搜索空态')
  {
    const { page } = bootDiscover({ view: discoverView({ activities: [] }) })
    await waitFor(() => page.data.loading === false)
    check('无活动 → 全局空态文案', page.data.cards.length === 0
      && page.data.emptyTitle === '还没有发布的活动'
      && page.data.emptyDetail === '列表只含尚未出发的活动；等有人发起下一场，你也可以先开一场。',
      JSON.stringify([page.data.emptyTitle, page.data.emptyDetail]))
    check('D-06：空态点名列表范围（只含尚未出发）',
      page.data.emptyDetail.indexOf('尚未出发') !== -1, page.data.emptyDetail)
  }
  {
    const { page, env } = bootDiscover({ view: discoverView({ activities: [] }) })
    await waitFor(() => page.data.loading === false)
    page.data.search = '雪山' // 模拟搜索中状态下的重查（防抖计时器已把 search 写进 data）
    await page.reload()
    check('带搜索词无结果 → 搜索空态文案',
      page.data.emptyTitle === '没有匹配的活动' && page.data.emptyDetail.indexOf('换个关键词') !== -1,
      JSON.stringify([page.data.emptyTitle, page.data.emptyDetail]))
    check('D-06：搜索空态也说明范围（搜索不跳出「尚未出发」）',
      page.data.emptyDetail.indexOf('尚未出发') !== -1, page.data.emptyDetail)
    /* D-06 的另一半落在筛选计数处：结果数旁必须写明「均未出发」，
       否则清掉筛选后「N 场」仍会被读成全部已发布活动。文案是静态 WXML，只能按源码断言。 */
    {
      const wxml = fs.readFileSync(path.join(__dirname, '..', 'miniprogram/pages/discover/discover.wxml'), 'utf8')
      check('D-06：结果计数处标注列表范围（N 场 · 均未出发）',
        /result-count[^>]*>本次结果 \{\{cards\.length\}\} 场 · 均未出发</.test(wxml),
        (wxml.match(/result-count[^\n]*/) || [''])[0])
    }
    check('搜索词进入 read 请求', env.reads[env.reads.length - 1].search === '雪山', JSON.stringify(env.reads[env.reads.length - 1]))
  }

  section('3. 搜索防抖与卸载清理')
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    const before = env.reads.length
    env.view = discoverView({ activities: [discoverView().activities[0]] })
    page.onSearch({ detail: { value: '青' } })
    page.onSearch({ detail: { value: '青城' } })
    page.onSearch({ detail: { value: '青城后' } })
    await sleep(400)
    check('真实 input → reload → 新结果装配，不只是修改搜索框',
      page.data.cards.length === 1 && page.data.cards[0].id === 'a1')
    check('300ms 内连续输入只发一次 read，且用最后的关键词',
      env.reads.length === before + 1 && env.reads[env.reads.length - 1].search === '青城后',
      'reads=' + env.reads.length + ' search=' + env.reads[env.reads.length - 1].search)
    check('页面数据同步到最后一次输入', page.data.search === '青城后', page.data.search)
  }
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    const before = env.reads.length
    page.onSearch({ detail: { value: '雪山' } })
    page.onUnload()
    await sleep(400)
    check('onUnload 清掉挂起的防抖定时器（离开页面不再外呼）',
      env.reads.length === before, 'reads=' + env.reads.length)
  }
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    const before = env.reads.length
    page.onSearch({ detail: { value: 'abc' } })
    page.onClearSearch()
    await waitFor(() => env.reads.length > before)
    await sleep(400)
    check('清空搜索：立即重查全量、挂起的防抖一并取消',
      page.data.search === '' && env.reads.length === before + 1 && env.reads[env.reads.length - 1].search === '',
      'reads=' + env.reads.length + ' search=' + page.data.search)
  }

  section('4. 进详情与下拉刷新')
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    page.onOpenCard({ currentTarget: { dataset: { id: 'a1' } } })
    check('点击卡片 → 详情页带活动编号', env.nav.indexOf('/pages/activity/activity?id=a1') !== -1, JSON.stringify(env.nav))
    page.onOpenCard({ currentTarget: { dataset: {} } })
    check('无编号 no-op', env.nav.length === 1, String(env.nav.length))
  }
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    page.onPullDownRefresh() // 页面未返回 promise，等收尾信号而不是 await
    await waitFor(() => env.pull > 0)
    check('下拉刷新重读并收尾 stopPullDownRefresh', env.pull === 1 && page.data.loading === false, 'pull=' + env.pull)
  }
  {
    const { page, env } = bootDiscover({ envelope: { ok: false, error: { code: 'NETWORK', message: '云函数调用失败：boom' } } })
    await waitFor(() => page.data.loading === false)
    const before = env.pull
    page.onPullDownRefresh()
    await waitFor(() => env.pull === before + 1 && !!page.data.denied)
    check('刷新失败同样收尾并透出错误', env.pull === before + 1 && page.data.denied.indexOf('boom') !== -1, page.data.denied)
  }

  section('5. denied 与服务端错误透出')
  {
    const { page } = bootDiscover({ view: { kind: 'denied', message: '发现功能暂不可用' } })
    await waitFor(() => page.data.loading === false)
    check('denied 视图原文透出、不装配卡片',
      page.data.denied === '发现功能暂不可用' && page.data.cards.length === 0, page.data.denied)
  }
  {
    const { page } = bootDiscover({ envelope: { ok: false, error: { code: 'AUTH_REQUIRED', message: '请先完善资料' } } })
    await waitFor(() => page.data.loading === false)
    check('AUTH_REQUIRED（无档案）→ errorText 透出进 denied',
      page.data.denied === '请先完善资料' && page.data.loading === false, page.data.denied)
  }

  section('6. 筛选、排序与地图')
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    check('初始 viewMode=list', page.data.viewMode === 'list')
    page.onOpenFilters()
    check('打开筛选面板', page.data.filtersOpen === true)
    page.onDateFrom({ detail: { value: '2026-10-05' } })
    page.onDateTo({ detail: { value: '2026-10-08' } })
    page.onApplyFilters()
    await waitFor(() => env.reads.length > 1)
    const req = env.reads[env.reads.length - 1]
    check('日期筛选进入 read 请求', req.dateFrom === '2026-10-05' && req.dateTo === '2026-10-08', JSON.stringify(req))
    check('筛选计数 = 2 且 featured 不再提升', page.data.filterCount === 2 && page.data.cards[0].featured === false,
      JSON.stringify([page.data.filterCount, page.data.cards[0].featured]))
    check('筛选后不再把第一条当编辑推荐', page.data.cards.every(c => c.featured === false))

    const before = env.reads.length
    page.onOpenFilters()
    page.onDateFrom({ detail: { value: '2026-10-10' } })
    page.onDateTo({ detail: { value: '2026-10-01' } })
    page.onApplyFilters()
    check('结束日期早于开始日期：拦下且不外呼', page.data.filterError !== '' && env.reads.length === before,
      JSON.stringify([page.data.filterError, env.reads.length, before]))

    page.onResetFilters()
    check('sheet 重置只清草稿，保持面板打开、应用值与结果计数不变且不外呼',
      page.data.filtersOpen && page.data.filterError === '' && env.reads.length === before
      && page.data.filterCount === 2 && page.data.filters.dateFrom === '2026-10-05'
      && JSON.stringify(page.data.draftFilters) === JSON.stringify({ dateFrom: '', dateTo: '', difficulty: '' }))
    page.onApplyFilters()
    await waitFor(() => env.reads.length > before)
    const resetReq = env.reads[env.reads.length - 1]
    check('确认重置后请求回到 {kind, search}', keysOf(resetReq) === 'kind,search' && page.data.filterCount === 0,
      JSON.stringify([resetReq, page.data.filterCount]))

    const beforeSort = env.reads.length
    page.onSort({ currentTarget: { dataset: { sort: 'start' } } })
    await waitFor(() => env.reads.length > beforeSort)
    check('最近出发排序进入 read 请求', env.reads[env.reads.length - 1].sort === 'start',
      JSON.stringify(env.reads[env.reads.length - 1]))

    page.onViewMode({ currentTarget: { dataset: { mode: 'map' } } })
    check('切到地图视图', page.data.viewMode === 'map')
    check('地图标记 = 有坐标的活动数（a2 无坐标不画点）', page.data.map.visible === true && page.data.map.markers.length === 1,
      JSON.stringify({ visible: page.data.map.visible, markers: page.data.map.markers.length }))
    page.onMapMarkerTap({ detail: { markerId: 0 } })
    check('点标记选中对应活动', page.data.mapSelected && page.data.mapSelected.id === 'a1',
      JSON.stringify(page.data.mapSelected && page.data.mapSelected.id))
  }
  {
    const view = discoverView({ activities: [discoverView().activities[1]] })
    const { page } = bootDiscover({ view })
    await waitFor(() => page.data.loading === false)
    page.onViewMode({ currentTarget: { dataset: { mode: 'map' } } })
    check('全部活动无坐标：地图不渲染，列表仍可用', page.data.map.visible === false && page.data.cards.length === 1,
      JSON.stringify({ visible: page.data.map.visible, cards: page.data.cards.length }))
  }
  {
    const diffView = discoverView()
    diffView.activities = [Object.assign({}, diffView.activities[0], {
      routeSnapshot: { title: '飞泉沟环线', distanceKm: 12.5, difficulty: 'moderate',
        points: [{ id: 'pt-1', name: '起点', kind: 'start', coordinates: { lat: 30.9, lng: 103.5 } }] },
    })]
    const { page, env } = bootDiscover({ view: diffView })
    await waitFor(() => page.data.loading === false)
    check('难度进入卡片 meta（组织者标注）', page.data.cards[0].meta.indexOf('中等') !== -1,
      page.data.cards[0].meta)
    page.onOpenFilters()
    page.onDifficultyFilter({ detail: { value: 2 } })
    page.onApplyFilters()
    await waitFor(() => env.reads.length > 1)
    check('难度筛选进入 read 请求', env.reads[env.reads.length - 1].difficulty === 'moderate',
      JSON.stringify(env.reads[env.reads.length - 1]))
  }
  {
    const { page } = bootDiscover({ view: discoverView({ activities: [] }) })
    await waitFor(() => page.data.loading === false)
    page.onOpenFilters()
    page.onDateFrom({ detail: { value: '2026-10-05' } })
    page.onApplyFilters()
    await waitFor(() => page.data.filterCount === 1)
    check('筛选无结果：文案点名筛选而不是「还没有活动」',
      page.data.emptyTitle === '没有符合条件的活动' && page.data.emptyAction === '清除筛选',
      JSON.stringify([page.data.emptyTitle, page.data.emptyAction]))
    check('D-06：筛选空态同时说明「筛选叠加」与「只含尚未出发」',
      page.data.emptyDetail.indexOf('尚未出发') !== -1 && page.data.emptyDetail.indexOf('清除筛选') !== -1,
      page.data.emptyDetail)
  }

  section('7. 筛选草稿：取消不泄漏，校验先于应用，重读不改未提交输入')
  {
    const { page, env } = bootDiscover()
    await waitFor(() => !page.data.loading)
    const applied = JSON.stringify(page.data.filters)
    const cards = JSON.stringify(page.data.cards)
    const before = env.reads.length
    page.onOpenFilters()
    check('打开时复制而非共用应用对象', page.data.draftFilters !== page.data.filters
      && JSON.stringify(page.data.draftFilters) === applied)
    page.onDateFrom({ detail: { value: '2026-11-01' } })
    page.onDateTo({ detail: { value: '2026-11-03' } })
    page.onDifficultyFilter({ detail: { value: 3 } })
    check('三个输入只改草稿，不影响列表/应用值/计数，也不发请求',
      JSON.stringify(page.data.filters) === applied && JSON.stringify(page.data.cards) === cards
      && page.data.filterCount === 0 && env.reads.length === before
      && JSON.stringify(page.data.draftFilters) === JSON.stringify({ dateFrom: '2026-11-01', dateTo: '2026-11-03', difficulty: 'hard' }))
    page.onCloseFilters()
    await page.reload()
    check('取消后真实 reload 不带未提交筛选', keysOf(env.reads[env.reads.length - 1]) === 'kind,search'
      && !page.data.filtersOpen && page.data.filterCount === 0)
    page.onOpenFilters()
    check('重新打开丢弃上次草稿', JSON.stringify(page.data.draftFilters) === applied)
    page.onDateFrom({ detail: { value: '2026-11-03' } })
    page.onDateTo({ detail: { value: '2026-11-01' } })
    const n = env.reads.length
    page.onApplyFilters()
    check('逆序日期不写入应用值，也不关闭/不外呼', JSON.stringify(page.data.filters) === applied
      && page.data.filtersOpen && !!page.data.filterError && env.reads.length === n)
    await page.reload()
    check('后台重读成功不吞掉 sheet 的校验错误', !!page.data.filterError && page.data.filtersOpen)
    page.onDateTo({ detail: { value: '2026-11-03' } })
    page.onDifficultyFilter({ detail: { value: 2 } })
    env.view = discoverView({ activities: [discoverView().activities[1]] })
    page.onApplyFilters()
    await waitFor(() => page.data.cards.length === 1)
    check('同日合法：确认后真实重查并显示新结果/计数，草稿不与应用对象共用',
      page.data.filters.dateFrom === '2026-11-03' && page.data.filters.dateTo === '2026-11-03'
      && page.data.filters.difficulty === 'moderate' && page.data.filterCount === 3
      && page.data.cards.length === 1 && page.data.cards[0].id === 'a2'
      && page.data.draftFilters !== page.data.filters && !page.data.filtersOpen)
    page.onOpenFilters()
    page.onResetFilters()
    page.onCloseFilters()
    await page.reload()
    check('重置后取消仍保留已应用的三项筛选', page.data.filterCount === 3
      && env.reads[env.reads.length - 1].difficulty === 'moderate')
    env.view = discoverView({ activities: [] })
    await page.reload()
    page.onEmptyAction()
    await waitFor(() => page.data.filterCount === 0)
    check('空态清除筛选仍是明确即时操作，有真实重查与空态结果',
      page.data.filterCount === 0 && keysOf(env.reads[env.reads.length - 1]) === 'kind,search'
      && page.data.emptyTitle === '还没有发布的活动')
    page.onUnload()
  }

  section('8. 后发请求获胜：旧成功/拒绝/denied 与 unload 都不能再写页面')
  for (const oldKind of ['success', 'reject', 'denied']) {
    const { page, env } = bootDiscover()
    await waitFor(() => !page.data.loading)
    env.hold = true
    const old = page.reload()
    page.onSearch({ detail: { value: '新结果' } })
    await waitFor(() => env.held.length === 2)
    const latestView = discoverView({ activities: [Object.assign({}, discoverView().activities[0], { id: 'new', title: '新结果' })] })
    env.held[1].resolve(latestView, 9)
    await waitFor(() => page.revision === 9)
    page.onMapMarkerTap({ detail: { markerId: 0 } })
    check(oldKind + '：新请求先落地，列表与地图来自同一回包',
      page.data.cards.length === 1 && page.data.cards[0].id === 'new' && page.data.mapSelected.id === 'new')
    const snapshot = JSON.stringify(page.data)
    const patches = page._patches.length
    if (oldKind === 'reject') env.held[0].reject(new Error('旧请求失败'))
    else env.held[0].resolve(oldKind === 'denied' ? { kind: 'denied', message: '旧拒绝' } : discoverView(), 2)
    await old
    check(oldKind + '：迟到回包零 setData，revision/当前结果/地图选择均不回卷',
      page._patches.length === patches && page.revision === 9 && JSON.stringify(page.data) === snapshot)
    page.onUnload()
  }
  {
    const { page, env } = bootDiscover()
    await waitFor(() => !page.data.loading)
    env.hold = true
    const old = page.reload()
    const latest = page.reload()
    env.held[1].reject(new Error('本次查询失败'))
    await latest
    const error = page.data.denied
    env.held[0].resolve(discoverView(), 1)
    await old
    check('最新查询失败必须可见，旧成功不能抹掉错误', !!error && page.data.denied === error && page.revision === 5)
    page.onUnload()
  }
  for (const outcome of ['success', 'reject']) {
    const { page, env } = bootDiscover()
    await waitFor(() => !page.data.loading)
    env.hold = true
    const pending = page.reload()
    page.onUnload()
    const patches = page._patches.length
    if (outcome === 'reject') env.held[0].reject(new Error('卸载后失败'))
    else env.held[0].resolve(discoverView({ activities: [] }), 99)
    await pending
    check('卸载后 ' + outcome + ' 不再改 data 或 revision', page._patches.length === patches && page.revision === 5)
  }

  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { failed++; console.error('  ✗ 用例执行异常（' + (e && e.message) + '）'); console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped); process.exit(1) })
