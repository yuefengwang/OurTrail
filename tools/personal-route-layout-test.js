// 路线/个人中心 L2-L3：模板结构 + 真 Page；仅 stub API 与 wx 边界，不证明像素。
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const api = require('../miniprogram/utils/api')
let passed = 0, failed = 0
function check(name, ok) {
  if (ok) { passed++; console.log('  PASS ' + name) }
  else { failed++; console.error('  FAIL ' + name) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const tick = () => new Promise(resolve => setImmediate(resolve))
const event = value => ({ detail: { value } })
const tap = id => ({ currentTarget: { dataset: { id } } })

// 只解析标签与父子关系；结构门不依赖缩进、注释或固定行号。
function tree(raw) {
  const src = raw.replace(/<!--[\s\S]*?-->/g, '')
  const root = { tag: 'root', attrs: {}, children: [] }
  const stack = [root], nodes = []
  const re = /<\/?[\w-]+\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g
  let m
  while ((m = re.exec(src))) {
    if (/^<\//.test(m[0])) { stack.pop(); continue }
    const tag = /^<([\w-]+)/.exec(m[0])[1], attrs = {}
    m[0].replace(/([\w:-]+)(?:="([^"]*)")?/g, (_, key, value) => { attrs[key] = value === undefined ? true : value })
    const node = { tag, attrs, parent: stack[stack.length - 1], children: [], at: m.index }
    node.parent.children.push(node); nodes.push(node)
    if (!/\/>$/.test(m[0])) stack.push(node)
  }
  return { root, nodes, src }
}
const cls = (node, name) => !!node && String(node.attrs.class || '').split(/\s+/).includes(name)
const ancestors = node => { const out = []; for (let n = node; n; n = n.parent) out.push(n); return out }
const handler = (t, name) => t.nodes.find(n => n.attrs.bindtap === name)
const ownerOnly = node => !!node && ancestors(node).some(n => n.attrs['wx:if'] === '{{isOwner}}')
const chapter = (t, title) => t.nodes.find(n => n.tag === 'chapter' && n.attrs.title === title)
const route = tree(read('miniprogram/pages/route/route.wxml'))
const routes = tree(read('miniprogram/pages/routes/routes.wxml'))
const me = tree(read('miniprogram/pages/me/me.wxml'))

function structure() {
  console.log('== 模板结构 ==')
  check('路线库不留假媒体槽或氛围图片', !/route-card__media|<image|hero-cover/.test(routes.src))
  check('列表辅助信息不再重复指标摘要', !/statsText/.test(routes.src))
  check('我的/共享两组保留独立循环', ['{{mineRoutes}}', '{{sharedRoutes}}'].every(v => routes.nodes.some(n => n.attrs['wx:for'] === v)))
  const entries = routes.nodes.filter(n => n.attrs.bindtap === 'onOpen')
  check('两组文字资产均有编号与标题', entries.length === 2 && entries.every(n => {
    const below = routes.nodes.filter(x => ancestors(x).includes(n))
    return below.some(x => cls(x, 'route-index')) && below.some(x => cls(x, 'route-title'))
  }))
  check('共享只承诺查看，不承诺使用', /可查看/.test(routes.src) && !/可查看与使用/.test(routes.src))
  check('列表新建与打开导航接线保留', !!handler(routes, 'onNewRoute') && entries.every(n => n.attrs['data-id'] === '{{item.id}}'))
  check('路线详情彻底移除假封面与脚注', !/hero-cover|photo-note|onCoverError|氛围图/.test(route.src))
  const ordered = ['海拔怎么走', '路线节点', '分段天气', '风险提示', '共享给协作者', '被这些活动使用', '管理这条路线'].map(title => chapter(route, title))
  const map = route.nodes.find(n => n.tag === 'map')
  check('主视觉地图在剖面→节点→天气→风险→共享→引用→管理之前', !!map && ordered.every((n, i) => n && n.at > (i ? ordered[i - 1].at : map.at)))
  check('无地图时有诚实空态与拥有者补坐标入口', route.nodes.some(n => n.tag === 'status-panel' && n.attrs.title === '暂时没有节点地图') && route.src.includes('补充节点坐标') && route.src.includes('联系路线拥有者'))
  const sticky = route.nodes.find(n => cls(n, 'sticky-action'))
  check('底栏仅 owner；主发起、次编辑均在栏内', ownerOnly(sticky) && ['onCreateActivity', 'onEdit'].every(name => {
    const buttons = route.nodes.filter(n => n.attrs.bindtap === name && ancestors(n).includes(sticky))
    return buttons.length === 1 && cls(buttons[0], name === 'onCreateActivity' ? 'primary' : 'secondary')
  }))
  const rootClass = route.root.children[0].attrs.class || ''
  check('has-sticky 是 owner 条件类，而非所有用户的空留白', /\{\{[^}]*isOwner[^}]*\?\s*'has-sticky'\s*:\s*''[^}]*\}\}/.test(rootClass))
  check('删除入口为 owner 文字危险动作，仍有确认 dialog', ownerOnly(handler(route, 'onDeleteAsk')) && cls(handler(route, 'onDeleteAsk'), 'text') && route.nodes.some(n => n.tag === 'overlay' && n.attrs.open === '{{deleteOpen}}' && n.attrs.kind === 'dialog'))
  check('共享添加和取消共享确认仍在', !!handler(route, 'onShareAdd') && !!handler(route, 'onRemoveConfirm') && route.nodes.some(n => n.tag === 'overlay' && n.attrs.title === '取消共享'))
  check('地图没有 view 覆盖层', map && map.children.length === 0)
  check('个人页不再有冗余大标题', !/同行资料与身份|page-title/.test(me.src))
  const identity = me.nodes.find(n => cls(n, 'profile-identity'))
  const stats = me.nodes.find(n => cls(n, 'profile-stats'))
  check('头像昵称身份区与统计带独立', !!identity && !!stats && identity.parent === stats.parent && !ancestors(stats).includes(identity))
  check('身份区保留 nickname 直接编辑及头像按钮', !!identity && me.nodes.some(n => ancestors(n).includes(identity) && n.attrs.type === 'nickname' && n.attrs.bindblur === 'onBlurSave') && me.nodes.some(n => ancestors(n).includes(identity) && n.attrs['open-type'] === 'chooseAvatar'))
  check('身份区显式说明自动保存和未激活状态', !!identity && /修改后自动保存/.test(me.src.slice(identity.at, stats ? stats.at : identity.at)) && /!activated/.test(me.src))
  const recent = chapter(me, '最近活动'), entry = handler(me, 'onOpenRoutes')
  check('路线库为独立工具入口，不混入最近活动容器', !!recent && !!entry && !ancestors(entry).includes(recent) && entry.at < chapter(me, '同行与安全').at)
  check('安全/同行人/权限三分组始终存在', ['同行与安全', '常用同行人', '协作与权限'].every(title => { const n = chapter(me, title); return n && !n.attrs['wx:if'] }))
  check('电话仍遮罩；代报与位置权限边界仍可见', me.src.includes('tools.maskPhone(person.phone)') && me.src.includes('tools.maskPhone(person.emergency.phone)') && me.src.includes('保存条目不等于代办授权') && me.src.includes('不会后台追踪') && me.src.includes('撤回后本次不再共享'))
  check('七个资料/危险操作弹层全部保留', me.nodes.filter(n => n.tag === 'overlay').length === 7)
  check('本机草稿与未激活入口全部保留', ['onSaveDraftNow', 'onAskDiscard', 'onOpenOnboarding'].every(name => !!handler(me, name)))
  check('tab 页底部 calc 不变', read('miniprogram/pages/me/me.wxss').includes('padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom))'))
  for (const name of ['route', 'me']) {
    const json = JSON.parse(read('miniprogram/pages/' + name + '/' + name + '.json'))
    check(name + ' 注册既有 chapter', json.usingComponents.chapter === '/components/chapter/chapter')
  }
  const css = read('miniprogram/pages/routes/routes.wxss')
  check('路线标题允许长文本换行而非截断', /\.route-title\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css) && !/text-overflow:\s*ellipsis|white-space:\s*nowrap/.test(css))
}

function page(name) {
  const file = path.join(ROOT, 'miniprogram/pages', name, name + '.js')
  let cfg
  global.Page = value => { cfg = value }
  delete require.cache[require.resolve(file)]
  require(file)
  return Object.assign({}, cfg, {
    data: JSON.parse(JSON.stringify(cfg.data)),
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) setImmediate(cb) },
  })
}
function fixture(owner) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  return {
    revision: 17, referencedActivityIds: ['a1', 'a2'],
    route: {
      id: 'r1', title: '高山路线'.repeat(20), source: 'gpx', difficulty: 'moderate',
      isOwner: owner, visibility: 'shared', distanceKm: 12.5, ascentM: 850,
      updatedAt: today + 'T08:00:00+08:00',
      points: [
        { id: 'p1', name: '起点', kind: 'start', coordinates: { lat: 30, lng: 103 }, time: today + 'T08:00:00+08:00', ele: 1000 },
        { id: 'p2', name: '山口', kind: 'checkpoint', coordinates: { lat: 30.1, lng: 103.1 }, time: today + 'T10:00:00+08:00', ele: 1800 },
        { id: 'p3', name: '待测节点', kind: 'finish' },
      ],
      track: [{ lat: 30, lng: 103, ele: 1000 }, { lat: 30.1, lng: 103.1, ele: 1800 }],
      risks: [{ id: 'risk1', title: '碎石', advice: '注意脚下', severity: 'mid' }],
      ...(owner ? { sharedWith: ['collaborator'] } : {}),
    },
  }
}
function setup(over) {
  const state = Object.assign({ res: fixture(true), failRead: false, failHome: false, failDelete: false, weather: 'ready' }, over)
  const calls = { routes: [], home: [], weather: [], writes: [], nav: [], back: 0, pulls: 0, toast: [] }
  global.wx = {
    navigateTo: o => calls.nav.push(o.url), navigateBack: () => calls.back++, stopPullDownRefresh: () => calls.pulls++,
    showToast: o => calls.toast.push(o.title),
  }
  api.readRoutes = id => { calls.routes.push(id); return state.failRead ? Promise.reject(new Error('路线读取失败')) : Promise.resolve(state.res) }
  api.read = req => { calls.home.push(req); return state.failHome ? Promise.reject(new Error('活动读取失败')) : Promise.resolve({ view: { kind: 'home', activities: [{ id: 'a1', title: '同行活动' }] } }) }
  api.getWeatherByPoint = (lat, lng, date) => {
    calls.weather.push({ lat, lng, date })
    if (state.weather === 'failed') return Promise.reject(new Error('天气失败'))
    return Promise.resolve({ status: state.weather, days: [{ date, code: 0, tMin: 5, tMax: 15, precipSum: 0, precipProbMax: 10, windMax: 12 }] })
  }
  api.dispatchAndSync = (payload, revision, host) => {
    calls.writes.push({ payload, revision, host })
    return state.failDelete ? Promise.reject(Object.assign(new Error('路线被活动使用，请先解除关联。'), { code: 'CONFLICT' })) : Promise.resolve({ revision: revision + 1 })
  }
  return { state, calls }
}

async function behavior() {
  console.log('== 真 route Page 与 API 边界 ==')
  {
    const { calls } = setup()
    const p = page('route'); p.onLoad({}); await p.reload()
    check('no-id 不外呼，结束 loading 并给原因', calls.routes.length === 0 && calls.weather.length === 0 && !p.data.loading && !!p.data.denied)
    p.onPullDownRefresh(); await tick()
    check('no-id 下拉也结束刷新', calls.pulls === 1)
  }
  {
    const { calls, state } = setup()
    const p = page('route'); p.onLoad({ id: 'r1' }); p.onShow(); await tick()
    check('onShow 真读取 routeId + organizer 活动', eq(calls.routes, ['r1']) && calls.home[0].perspective === 'organizer')
    check('reload 更新 revision、owner、标题和风险', p.revision === 17 && p.data.isOwner && p.data.route.title === state.res.route.title && p.data.route.risks[0].severityText === '重要')
    check('地图仍用真实节点与轨迹', p.data.map.markers.length === 2 && p.data.map.polyline[0].points.length === 2 && p.data.map.markers[0].latitude === 30)
    check('引用标题缺失降为空值，不编造标题', eq(p.data.referenced, [{ id: 'a1', title: '同行活动' }, { id: 'a2', title: '' }]))
    check('只查询有坐标节点，使用 GCJ 坐标与目标日期', calls.weather.length === 2 && calls.weather[0].lat === 30 && calls.weather[0].date === p.data.wxDate)
    check('天气真实装配含 ready/no-coords 与读数', eq(p.data.nodeWeather.map(x => x.status), ['ready', 'ready', 'no-coords']) && p.data.nodeWeather[0].tMin === 5 && !p.data.weatherBusy)
    check('页面不再持有封面字段或失败 handler', !('cover' in p.data) && !('coverFailed' in p.data) && !p.onCoverError)
    state.res.route.title = '编辑后的路线'; state.res.revision = 18
    p.onShow(); await tick()
    check('编辑返回 onShow 重读最新标题与 revision', p.data.route.title === '编辑后的路线' && p.revision === 18 && calls.routes.length === 2)
    p.onEdit(); p.onCreateActivity(); p.onOpenActivity(tap('a1')); p.onOpenActivity(tap(''))
    check('编辑/发起/活动导航参数未改变；空 id 不跳转', eq(calls.nav, ['/pages/route-edit/route-edit?id=r1', '/pages/editor/editor?routeId=r1', '/pages/activity/activity?id=a1']))
    p.onWeatherDate(event(p.data.wxDate)); await tick()
    check('日期选择重新查询各坐标节点', calls.weather.length === 6)
    p.onScheduleMode(event(['schedule'])); await tick()
    check('推算开关仍设当天 08:00 并给节点抵达时间', p.data.scheduleMode && p.data.startTime === '08:00' && !!p.data.nodeWeather[1].arriveLabel)
    state.weather = 'out_of_range'; await p.loadNodeWeather()
    check('超窗不伪装 ready，缺坐标独立保留', eq(p.data.nodeWeather.map(x => x.status), ['out-of-range', 'out-of-range', 'no-coords']))
    state.weather = 'failed'; await p.loadNodeWeather()
    check('天气失败不翻整页、不抹路线', p.data.nodeWeather[0].status === 'failed' && !p.data.denied && !!p.data.route)
    state.failDelete = true; p.onDeleteAsk(); await p.onDeleteConfirm()
    check('删除被拒保留弹层与错误，busy 收尾、不返回', p.data.deleteOpen && !p.data.busy && !!p.data.error && calls.back === 0)
    check('删除仍走 CAS + 本页同步契约', calls.writes[0].revision === 18 && calls.writes[0].host === p && eq(calls.writes[0].payload, { type: 'route.delete', routeId: 'r1' }))
    p.onDeleteCancel(); check('删除可取消', !p.data.deleteOpen)
    state.failDelete = false; p.onDeleteAsk(); await p.onDeleteConfirm()
    check('删除成功关闭弹层并返回', calls.back === 1 && !p.data.deleteOpen && !p.data.busy)
  }
  {
    const { calls, state } = setup({ res: fixture(false), failHome: true })
    state.res.route.points = []; state.res.route.track = []
    const p = page('route'); p.onLoad({ id: 'r1' }); await p.reload(); await tick()
    check('shared 投影无 sharedWith 仍可正常读；无点不造地图', !p.data.isOwner && !p.data.denied && !p.data.map.visible && calls.weather.length === 0)
    check('shared 下管理/发起/共享均由 owner 数据位控制', !p.data.isOwner && ['onCreateActivity', 'onDeleteAsk', 'onShareOpen'].every(name => ownerOnly(handler(route, name))))
    check('活动附属读取失败不拖垮路线', p.data.referenced.every(x => x.title === '') && p.data.route.id === 'r1')
    state.failRead = true; await p.reload()
    check('路线读失败显式 denied', !!p.data.denied && !p.data.loading)
  }
  console.log('== 真 routes Page ==')
  {
    const { state, calls } = setup()
    state.res = { routes: [
      { id: 'r1', title: '长标题'.repeat(30), source: 'gpx', isOwner: true, visibility: 'shared', distanceKm: 12.5, ascentM: 850, pointCount: 3, riskCount: 2, referencedCount: 4 },
      { id: 'r2', title: '共享路线', source: 'manual', isOwner: false, distanceKm: 0, ascentM: 0, pointCount: 0, riskCount: 0, referencedCount: 0 },
    ] }
    const p = page('routes'); await p.reload()
    check('mine/shared 分区与长标题原样保留', p.data.mineRoutes.length === 1 && p.data.sharedRoutes.length === 1 && p.data.mineRoutes[0].title === state.res.routes[0].title)
    const r = p.data.mineRoutes[0]
    check('指标只包含一次距离/爬升/节点', eq(r.metrics.map(m => m.value), [12.5, 850, 3]))
    check('辅助摘要仅风险，不重复 km/m/节点', !r.statsText && r.riskText === '2 条风险提示')
    check('缺里程爬升只留节点事实，不伪造零距离', eq(p.data.sharedRoutes[0].metrics.map(m => m.value), [0]))
    p.onOpen(tap('r1')); p.onNewRoute(); p.onOpen(tap(''))
    check('列表打开/新建导航保持', eq(calls.nav, ['/pages/route/route?id=r1', '/pages/route-edit/route-edit']))
    state.res = { routes: [] }; await p.reload()
    check('空列表三个集合一致清空', !p.data.routes.length && !p.data.mineRoutes.length && !p.data.sharedRoutes.length)
    state.failRead = true; await p.reload()
    check('列表失败收尾并显示原因', !p.data.loading && !!p.data.denied)
  }
}
async function main() {
  try { structure(); await behavior() } catch (e) { failed++; console.error(e.stack) }
  console.log('passed=' + passed + ' failed=' + failed)
  process.exitCode = failed ? 1 : 0
}
main()
