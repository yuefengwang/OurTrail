// 发现页场景测试：node tools/scenario-discover-test.js
// 对象：miniprogram/pages/discover/discover.js（ADR-0003 公开发现列表，只读 + 搜索）。
// 关键契约：discoverView 是**窄投影**（不含 ownerId 原始 openid、不含 pickupPoints），
// 页面映射不得依赖这两个字段；搜索 300ms 防抖只发一次 read；onUnload 清掉挂起的防抖定时器。
// 手法与 tools/scenario-signup-test.js 一致：global.Page 捕获真配置 + wx.cloud.callFunction 信封桩
// （read/dispatch 走真 utils/api，errorText/denied 透出全是真代码路径）。
'use strict'
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
        routeSnapshot: { title: '飞泉沟环线', distanceKm: 12.5 } },
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
  const env = { reads: [], nav: [], pull: 0 }
  env.view = opts.view || discoverView()
  env.envelope = opts.envelope || null // 非空时 read 返回该信封（模拟服务端错误）
  global.wx = {
    cloud: { callFunction(req) {
      if (req.data.action === 'read') {
        env.reads.push(req.data.request)
        const body = env.envelope || { ok: true, data: { view: env.view, revision: 5, now: NOW } }
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
    check('日期/路线行由 format 归口（meta = 路线 · 公里）',
      page.data.cards[0].date === F.dateLabel('2026-10-03T08:00:00+08:00')
      && page.data.cards[0].meta === '飞泉沟环线 · 12.5 km'
      && page.data.cards[1].meta === '路线待完善 · 8 km',
      page.data.cards[0].meta + ' / ' + page.data.cards[1].meta)
    check('状态行：我组织的 / 阶段标签归口 format',
      page.data.cards[0].status === '我组织的'
      && page.data.cards[1].status === (F.PHASE_LABELS['gathering'] || 'gathering'),
      page.data.cards[0].status + ' / ' + page.data.cards[1].status)
    check('信息行过滤空介绍并拼接',
      page.data.cards[0].info === '老王带队 · 已确认 3 人 · 名额 20 人 · 可报名'
      && page.data.cards[1].info === '已确认 0 人 · 名额 10 人 · 暂不报名',
      page.data.cards[1].info)
    check('首张卡 featured、次张不 featured', page.data.cards[0].featured === true && page.data.cards[1].featured === false, '')
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
      && page.data.emptyDetail === '等有人发起第一场同行，你也可以先开一场。',
      JSON.stringify([page.data.emptyTitle, page.data.emptyDetail]))
  }
  {
    const { page, env } = bootDiscover({ view: discoverView({ activities: [] }) })
    await waitFor(() => page.data.loading === false)
    page.data.search = '雪山' // 模拟搜索中状态下的重查（防抖计时器已把 search 写进 data）
    await page.reload()
    check('带搜索词无结果 → 搜索空态文案',
      page.data.emptyTitle === '没有匹配的活动' && page.data.emptyDetail.indexOf('换个关键词') === 0,
      JSON.stringify([page.data.emptyTitle, page.data.emptyDetail]))
    check('搜索词进入 read 请求', env.reads[env.reads.length - 1].search === '雪山', JSON.stringify(env.reads[env.reads.length - 1]))
  }

  section('3. 搜索防抖与卸载清理')
  {
    const { page, env } = bootDiscover()
    await waitFor(() => page.data.loading === false)
    const before = env.reads.length
    page.onSearch({ detail: { value: '青' } })
    page.onSearch({ detail: { value: '青城' } })
    page.onSearch({ detail: { value: '青城后' } })
    await sleep(400)
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

  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { failed++; console.error('  ✗ 用例执行异常（' + (e && e.message) + '）'); console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped); process.exit(1) })
