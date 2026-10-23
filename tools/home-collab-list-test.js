// 首页「一个列表 + 卡片上的协作入口」判据：node tools/home-collab-list-test.js
// 对象：miniprogram/pages/home/home.js（四档筛选、协作计数、卡片上的协作入口）
//       miniprogram/utils/journey.js（collabRoles：角色词与「两个角色各自独立」的唯一出处）
// 背景（2026-10-20）：首页原来有两个列表——顶部裸 .list-row 的「需要我协作」+ 下面的活动卡，
//   同一场活动可以同时进两个区（owner 兼车辆联络时必然命中），且一屏两种列表形态。
//   现在只有一个列表，协作动作下沉为卡片上的入口。判据与原因：
//   docs/superpowers/specs/2026-10-20-home-dual-list-dedup.md
// 手法：与 tools/a20-owner-hero-test.js 同源——global.Page 捕获真页面配置 + wx.cloud 信封桩，
//   断言真页面装配出来的读数；测试里不重写页面的拼装逻辑（铁律 11）。
//   判据是行为级的：不数节点、不钉源码文本（铁律 30①）；只有两处例外并写明理由——
//   ① 角色词的单源（词表命中次数，静态可判且重构不会让它假红）；
//   ② 「URL 字面量不该出现在组件里」（查的是不该存在的依赖，journey-graph 的静态边扫描只认页面 JS）。
'use strict'
const path = require('path')
const fs = require('fs')
const HOME_PATH = require.resolve('../miniprogram/pages/home/home.js')
const ROOT = path.resolve(__dirname, '..')

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
function note(t) { console.log('  — ' + t) }

const NOW = '2026-10-14T09:00:00+08:00'
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 1500
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return cond()
}
const clone = o => JSON.parse(JSON.stringify(o))
function except(c, keys) {
  const out = {}
  for (const k of Object.keys(c)) if (keys.indexOf(k) === -1) out[k] = c[k]
  return out
}
function meta(over) {
  return Object.assign({
    owner: false, joined: false, staff: false, vehicle: false,
    confirmed: 3, pending: 7, capacity: 10, positionRows: [],
  }, over || {})
}
function act(id, over) {
  return Object.assign({
    id: id, title: '青城后山 · ' + id, description: '周末轻徒步',
    phase: 'published', startAt: '2026-10-20T08:00:00+08:00',
    routeSnapshot: { title: '飞泉沟环线', distanceKm: 12.5 },
    meta: meta({ owner: true, joined: true }),
  }, over || {})
}

function boot(activities, opened) {
  const env = { reads: [], nav: [] }
  global.wx = {
    cloud: { callFunction(req) {
      if (req.data.action === 'read') {
        const r = req.data.request
        env.reads.push(r)
        if (r.kind === 'profile') {
          return Promise.resolve({ result: { ok: true, data: { view: { kind: 'profile', profile: { person: { name: '测试者' } } }, revision: 5, now: NOW } } })
        }
        return Promise.resolve({ result: { ok: true, data: { view: { kind: 'home', activities: clone(activities) }, revision: 5, now: NOW } } })
      }
      return Promise.resolve({ result: { ok: true, data: {} } })
    } },
    navigateTo(o) { env.nav.push((o && o.url) || '') },
    stopPullDownRefresh() {},
    showToast() {},
    getStorageSync(k) { return k === 'ourtrail.opened.v1' ? (opened || []).slice() : '' },
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
async function settle(page, cond, extra) {
  const ok = await waitFor(cond)
  if (!ok) { console.error('  ✗ 有效性门没过：装配结果不是预期的形状（' + extra + '）'); process.exit(1) }
}
const ids = page => page.data.cards.map(c => c.id).join(',')
const cardOf = (page, id) => page.data.cards.find(c => c.id === id) || null
const keysOf = c => (c.collab || []).map(r => r.key).join(',')
const setFilter = (page, v) => page.onFilter({ currentTarget: { dataset: { value: v } } })
// onFilter 的 setData 先翻 filter 位、再在回调里 render()。等 filter 就等于读到一个
// 「标签已经换了、列表还是上一档的」的瞬时态——所有切档断言都必须等 render 落地。
async function applyFilter(page, v) {
  setFilter(page, v)
  await sleep(30)
}

async function main() {
  // ============ 1. 一个列表：同一场活动不可能出现两次 ============
  section('1. 单列表不变量（双角色活动是原来的重复命中点）')
  {
    // owner ∧ staff ∧ vehicle —— 这正是截图里那三条的形状（组织者给自己授了车辆联络）
    const dual = act('dual', { meta: meta({ owner: true, staff: true, vehicle: true }) })
    const { page } = boot([dual], [])
    await settle(page, () => page.data.loading === false, 'loading 没收')
    await settle(page, () => page.data.cards.length === 1, 'cards=' + ids(page))
    check('有效性门：双角色活动在「我的活动」里恰好一张卡', ids(page) === 'dual', ids(page))
    check('页面 data 里不再存在第二个活动数组（原来那个 tasks 已被物理删除，不是留空不用）',
      page.data.tasks === undefined, JSON.stringify(Object.keys(page.data)))
    check('双角色卡上两枚入口独立存在（旧实现一个 goStaff 布尔吃掉车辆那一半，§8.6）',
      keysOf(cardOf(page, 'dual')) === 'staff,vehicle', JSON.stringify(cardOf(page, 'dual').collab))
    await applyFilter(page, 'collab')
    check('切到「需要协作」仍是同一张卡，不是两处各一份', ids(page) === 'dual', ids(page))
  }

  // ============ 2. 两档筛出的同一场活动，卡片字段逐字节同构 ============
  section('2. 协作档与「我的活动」同构（证明列表真的只有一个）')
  {
    const a = act('a', { meta: meta({ owner: true, joined: true, vehicle: true }) })
    const b = act('b', { meta: meta({ owner: false, joined: false, staff: true }) })
    const { page } = boot([a, b], ['a'])
    await settle(page, () => ids(page) === 'a', 'mine cards=' + ids(page))
    const mine = clone(page.data.cards)
    await applyFilter(page, 'collab')
    check('有效性门：「我的活动」只有 a，协作档有 a 与纯协作者 b',
      ids(page) === 'a,b', ids(page))
    const sharedA = except(cardOf(page, 'a'), ['featured'])
    check('同一场活动在两档下的卡片字段（除 featured）逐字节相同 ⇒ 装配路径只有一条',
      JSON.stringify(sharedA) === JSON.stringify(except(mine[0], ['featured'])),
      JSON.stringify([mine[0], sharedA]))
    check('纯协作者（非 owner 非报名）的归属位说他的角色，不再被印成「最近查看」',
      cardOf(page, 'b').status.indexOf('现场协作') === 0 && cardOf(page, 'b').status.indexOf('最近查看') === -1,
      cardOf(page, 'b').status)
  }

  // ============ 3. 计数与筛选/搜索解耦，且双向都测 ============
  section('3. 第四档计数：有几件事，与我正在看哪一档无关')
  {
    const a = act('a', { meta: meta({ owner: true, joined: true, staff: true }) })
    const b = act('b', { meta: meta({ owner: true, joined: true }) })
    const { page } = boot([a, b], [])
    await settle(page, () => page.data.cards.length === 2, 'cards=' + ids(page))
    check('有效性门：两场里只有一场带协作授权', page.data.collabCount === 1, String(page.data.collabCount))
    const base = page.data.collabCount
    for (const f of ['recent', 'finished', 'collab', 'mine']) await applyFilter(page, f)
    check('切完四档之后计数没动（不是跟着当前视图重算的）',
      page.data.collabCount === base, String(page.data.collabCount))
    await applyFilter(page, 'collab')
    check('第四档只筛出有授权的那一场（不是把整张列表搬过来换个标签）',
      ids(page) === 'a', ids(page))
    // 搜索与切档都是同步重渲染（setData 回调里 render），用固定一拍等落地；
    // 这里不用 settle()——settle 不过就 exit(1)，变异副本会记成「崩红」而不是断言红。
    page.onSearch({ detail: { value: '不存在的关键词' } })
    await sleep(30)
    check('搜索把列表清空时计数照旧（搜索过滤视图，不清除待办事实）',
      page.data.cards.length === 0 && page.data.collabCount === base,
      ids(page) + ' / ' + page.data.collabCount)
    check('D-06：搜索空态说明搜索只在当前范围内（不跳出当前档）',
      page.data.emptyTitle === '没有匹配的活动' && page.data.emptyDetail.indexOf('当前活动范围') !== -1,
      page.data.emptyDetail)
    page.onSearch({ detail: { value: '青城后山' } })
    await sleep(30)
    check('搜索词命中时协作档同样被过滤（治病灶：原来那一区根本不跟搜索走）',
      ids(page) === 'a', ids(page))
    page.onClearSearch()
    await sleep(30)
    check('清除搜索后那一场的入口回来（双向：判据不是「一搜就永久关掉」）',
      ids(page) === 'a' && keysOf(cardOf(page, 'a')) === 'staff', ids(page) + ' / ' + keysOf(cardOf(page, 'a') || {}))
  }

  // ============ 4. 失败关闭 + 反向对照（不许把「没有授权」印成入口） ============
  section('4. 缺位按无授权处理，有授权时入口必须出')
  {
    const noKeys = act('nokeys', { meta: { owner: true, joined: true, confirmed: 1, pending: 0, capacity: 4, positionRows: [] } })
    const { page } = boot([noKeys], [])
    await settle(page, () => page.data.cards.length === 1, 'cards=' + ids(page))
    check('meta 里没有 staff/vehicle 键 ⇒ 计数为 0、卡片不带入口（越权入口宁可不出）',
      page.data.collabCount === 0 && cardOf(page, 'nokeys').collab.length === 0,
      JSON.stringify({ n: page.data.collabCount, collab: cardOf(page, 'nokeys').collab }))
    check('反向对照：同一份夹具补上 staff ⇒ 计数 1、入口出（防「永远不说」的一刀切）',
      (() => { const J = require('../miniprogram/utils/journey'); return J.collabRoles({ staff: true }).length === 1 })(),
      'collabRoles({staff:true}) 没出条目')
    // 页面路径上 isCollab 先拦了一道，所以词表函数自己的缺位分支必须直接打一遍——
    // 变异 C5（把 `if (m.staff)` 写成 `if (m.staff !== false)`）在页面读数上完全看不出来。
    const J = require('../miniprogram/utils/journey')
    check('collabRoles 对缺位/非真值失败关闭（没有这个键 ≠ 有授权）',
      J.collabRoles({}).length === 0 && J.collabRoles({ staff: undefined, vehicle: null }).length === 0
      && J.collabRoles(null).length === 0,
      JSON.stringify([J.collabRoles({}), J.collabRoles({ staff: undefined, vehicle: null }), J.collabRoles(null)]))
  }
  {
    // 终态活动：协作授权不再给入口（车长页对已结束的活动只是回看），与旧任务区的非终态门同口径
    const done = act('done', { phase: 'archived', meta: meta({ owner: true, staff: true, vehicle: true }) })
    const { page } = boot([done], [])
    await settle(page, () => page.data.loading === false, 'loading 没收')
    await applyFilter(page, 'collab')
    check('已归档的授权活动不计入协作档 ⇒ 计数 0', page.data.collabCount === 0, String(page.data.collabCount))
    check('停在「需要协作」而这一档空掉时退回「我的活动」（不留一个谁都没选中的筛选段）',
      page.data.filter === 'mine' && page.data.cards.length === 0, page.data.filter + ' / ' + ids(page))
    await applyFilter(page, 'finished')
    const doneCard = cardOf(page, 'done') || {}
    check('已结束档里这张卡看得到回看，但不带协作入口（终态收回入口是判据，不是漏画）',
      ids(page) === 'done' && (doneCard.collab || []).length === 0,
      ids(page) + ' / ' + JSON.stringify(doneCard.collab))
  }

  // ============ 5. 点击协作入口：两个角色各走各的页 ============
  section('5. 跳转：staff 与 vehicle 分别落页，不互相吞')
  {
    const dual = act('dual', { meta: meta({ owner: true, staff: true, vehicle: true }) })
    const { page, env } = boot([dual], [])
    await settle(page, () => page.data.cards.length === 1, 'cards=' + ids(page))
    const card = cardOf(page, 'dual')
    page.onCardCollab({ currentTarget: { dataset: { id: card.id } }, detail: { key: 'staff' } })
    page.onCardCollab({ currentTarget: { dataset: { id: card.id } }, detail: { key: 'vehicle' } })
    check('两枚入口分别落 staff 页与 vehicle 页（旧实现靠一个布尔二选一）',
      env.nav.join(' | ') === '/pages/staff/staff?id=dual | /pages/vehicle/vehicle?id=dual',
      env.nav.join(' | '))
    env.nav.length = 0
    page.onCardCollab({ currentTarget: { dataset: { id: card.id } }, detail: { key: 'unknown-role' } })
    check('词表外的 key 不兜底跳车辆页（宁可什么都不发生，也不把人送进一个没授权的页）',
      env.nav.length === 0, env.nav.join(' | '))
  }

  // ============ 6. 两处静态判据（理由见文件头） ============
  section('6. 单源与依赖方向')
  {
    const J = require('../miniprogram/utils/journey')
    check('角色词表只有一个出处，且两个键与服务端 meta 同名',
      J.COLLAB_ROLE_LABELS.staff === '现场协作' && J.COLLAB_ROLE_LABELS.vehicle === '车辆联络',
      JSON.stringify(J.COLLAB_ROLE_LABELS))
    const pagesDir = path.join(ROOT, 'miniprogram', 'pages')
    const compsDir = path.join(ROOT, 'miniprogram', 'components')
    // 判据只管本次改动负责的两个所有者（首页 + 活动卡）：它们不许再自带角色词字面量。
    // 注释里出现这两个词是允许的（正是在解释为什么不许写它们），所以先去注释再扫。
    const stripComments = (s, kind) => kind === 'wxml'
      ? s.replace(/<!--[\s\S]*?-->/g, '')
      : s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const owners = [
      path.join(pagesDir, 'home', 'home.wxml'), path.join(pagesDir, 'home', 'home.js'),
      path.join(compsDir, 'activity-card', 'activity-card.wxml'), path.join(compsDir, 'activity-card', 'activity-card.js'),
    ]
    const leaked = owners.filter(f => /现场协作|车辆联络/.test(stripComments(fs.readFileSync(f, 'utf8'), /\.wxml$/.test(f) ? 'wxml' : 'js')))
    check('首页与活动卡都不再自带角色词字面量（词表只许在 utils/journey.js 一处）',
      leaked.length === 0, leaked.join(' '))
    // 存量登记，不是本次的判据：roster-panel 自己还有一份 ROLE_OPTIONS 与一处三元标签，
    // staff.wxml 的页头 kicker 是第三处。它们与首页无关，改动要另开一轮（见 SYNC.md 同日条目）。
    const legacy = ['components/roster-panel/roster-panel.js', 'components/roster-panel/roster-panel.wxml', 'pages/staff/staff.wxml']
      .filter(rel => /现场协作|车辆联络/.test(fs.readFileSync(path.join(ROOT, 'miniprogram', rel), 'utf8')))
    note('存量未收（本次不动，已登记）：角色词还出现在 ' + legacy.join(' '))
    const cardWxml = fs.readFileSync(path.join(compsDir, 'activity-card', 'activity-card.wxml'), 'utf8')
    check('staff / vehicle 的 URL 字面量没有被搬进组件（journey-graph 的静态边扫描只认页面 JS）',
      !/pages\/(staff|vehicle)\//.test(cardWxml), '组件里出现了页面路径')
    const homeJs = fs.readFileSync(path.join(pagesDir, 'home', 'home.js'), 'utf8')
    check('两条入口 URL 仍留在页面 JS（否则 staff / vehicle 两页在全仓就没有入口了）',
      /\/pages\/staff\/staff\?id=/.test(homeJs) && /\/pages\/vehicle\/vehicle\?id=/.test(homeJs), '页面里找不到')
  }

  console.log('\npassed=' + passed + ' failed=' + failed)
  process.exit(failed ? 1 : 0)
}

main().catch(e => { console.error('用例执行异常（' + (e && e.stack || e) + '）'); process.exit(1) })
