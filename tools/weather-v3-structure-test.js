// 天气页 V3 结构门：两屏宿主、四视图、共享详情单元、状态机契约。
// 运行：node tools/weather-v3-structure-test.js
//
// 判据来源：实施文档 §10.2（weather-v3-structure-test）与 §16.5 冻结契约。
// 原则：结构判据只读**真实文件**（app.json / wxml / wxss / js），不镜像页面逻辑；
// 状态机判据直接打 utils/weather-v3.js（wx-free）。
'use strict'
const fs = require('fs')
const path = require('path')
const V3 = require('../miniprogram/utils/weather-v3')
const V = require('../miniprogram/utils/weather-v3-view')
const PL = require('../miniprogram/utils/weather-plans')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const rd = p => fs.readFileSync(p, 'utf8')
const appJson = JSON.parse(rd(path.join(MP, 'app.json')))

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; return }
  failed++
  console.log('  ✗ ' + name + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)))
}
function section(t) { console.log('\n§ ' + t) }

/* ------------------------------------------------------------------ */
section('§1 宿主：tab 页与深链页')

{
  const pages = appJson.pages
  check('天气 Hub 在 app.json 的 pages 里', pages.indexOf('pages/weather-hub/weather-hub') !== -1, pages.length)
  check('旧天气详情页仍在（深链/回滚保留；P7 才决定下线）',
    pages.indexOf('pages/weather/weather') !== -1)
  const list = appJson.tabBar && appJson.tabBar.list
  check('tabBar 第 2 项仍是天气（底栏常驻的落点）',
    Array.isArray(list) && list[1] && list[1].pagePath === 'pages/weather-hub/weather-hub', list && list.map(x => x.pagePath))
  check('tabBar 仍是自定义（自绘胶囊避让与视觉一致的前提）',
    appJson.tabBar && appJson.tabBar.custom === true)
}

{
  const hub = rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.wxml'))
  check('Hub 有两屏（screen === home / else）', /screen === 'home'/.test(hub) && /<block wx:else>/.test(hub))
  check('Hub 屏 2 挂的是共享详情单元（不是第二份实现）', /<weather-detail/.test(hub))
  check('Hub 屏 1 有资产三 tab（个人计划 / 常用地点 / 共用路线）',
    ['个人计划', '常用地点', '共用路线'].every(t => hub.indexOf(t) !== -1))
  check('Hub 屏 1 的「继续上次」在没有计划时整块不出现', /wx:if="\{\{lastPlan\}\}"/.test(hub))
  const hubJson = JSON.parse(rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.json')))
  check('Hub 注册了 weather-detail 组件',
    hubJson.usingComponents && hubJson.usingComponents['weather-detail'] === '/components/weather-detail/weather-detail',
    hubJson.usingComponents)
  check('Hub 用自定义导航（自绘品牌行 + 胶囊让位）', hubJson.navigationStyle === 'custom')
}

{
  const hubJs = rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.js'))
  check('Hub 不自己装配图表（不 require meteogram / cloud-field）',
    hubJs.indexOf('meteogram-svg') === -1 && hubJs.indexOf('cloud-field-svg') === -1)
  check('Hub 不自己调 getWeatherByPoint（取数归共享单元）',
    hubJs.indexOf('getWeatherByPoint') === -1)
  check('Hub 通过内存状态切屏（switchTab 不能带参的平台约束）',
    /screen: 'detail'/.test(hubJs) && /screen: 'home'/.test(hubJs))
}

/* ------------------------------------------------------------------ */
section('§2 共享详情单元：四视图与容器')

{
  const wxml = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxml'))
  check('四视图分支齐全（逐时 / 云层 / 日月 / 沿途）',
    /tabs\[0\]\.selected/.test(wxml) && /tabs\[1\]\.selected/.test(wxml) &&
    /tabs\[3\]\.selected/.test(wxml) && /<block wx:else>/.test(wxml))
  check('逐时图仍是横向 scroll-view（48/72 靠它滚，24h 恰好不滚）', /<scroll-view class="wv3-scroll" scroll-x/.test(wxml))
  check('列宽不写死：小时列与图表宽都用行内值（24h 一屏的算术在 js 里）',
    /style="width:\{\{hourlyCell\}\}px"/.test(wxml) && /class="wv3-inner" style="width:\{\{hourlyWidth\}\}px"/.test(wxml))
  check('云量图例复用同一条色阶（不新开渐变），刻度 0/50/100 都给，且 50 在中点',
    /class="wv3-ramp"/.test(wxml) && /<text>0%<\/text><text>50%<\/text><text>100%<\/text>/.test(wxml))
  const lgWxss = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxss'))
  /* 「50 在中点」不能只看文案：flex:1 的中间格拿到的是两端标签之间的剩余空间，
     真机实测中心比条带中点偏左 4.8px。中点必须由同宽的容器 + left:50% 给出。 */
  check('50% 刻度几何上真的在条带中点（容器等宽 + 中间格 left:50% translateX(-50%)）',
    /\.wv3-lg-ticks\s*\{[^}]*position:\s*relative/.test(lgWxss) &&
    /\.wv3-lg-ticks text:nth-child\(2\)\s*\{[^}]*left:\s*50%[^}]*translateX\(-50%\)/.test(lgWxss) &&
    !/\.wv3-lg-ticks text:nth-child\(2\)\s*\{[^}]*flex:\s*1/.test(lgWxss))
  check('刻度容器与色带同宽（否则 50% 的参照系不是条带本身）',
    /\.wv3-lg-ticks\s*\{[^}]*width:\s*96px/.test(lgWxss) && /\.wv3-ramp\s*\{[^}]*width:\s*96px/.test(lgWxss))
  /* 「什么叫高、什么叫中、什么叫低」必须在读图的位置回答：三条云量轴行各自写出高度区间，
     而区间文案只能来自 utils（WXML 里不许出现 3km / 8km 这种字面量，否则改了常量页面不动）。 */
  check('三条云量轴行都绑定数据里的高度区间（high/mid/low 各一处）',
    ['high', 'mid', 'low'].every(k => new RegExp('\\{\\{cloudBounds\\.' + k + '\\}\\}').test(wxml)),
    ['high', 'mid', 'low'].filter(k => wxml.indexOf('{{cloudBounds.' + k + '}}') === -1))
  check('高度区间不写字面 km（单位在 utils 的 cloudBounds 里拼，页面只插值）', !/\d\s*km/.test(wxml),
    (wxml.match(/\d\s*km/g) || []).slice(0, 3))
  check('说明回答「颜色是什么意思」，并保留原口径（海平面以上 / 不是云底云顶 / 不是 0%）',
    /颜色越深/.test(wxml) && /海平面以上/.test(wxml) &&
    /不是这块云的云底或云顶/.test(wxml) && /不是 0%/.test(wxml))
  check('云量是连续色带（每 3 小时一个整数），说明文案不再自称「一个小格」',
    /每 3 小时印一个整数/.test(wxml) && !/一个小格是一小时/.test(wxml))
  check('高度区间的唯一出处接进组件 data（不是模板里另抄一份）',
    /cloudBounds: HSV\.cloudBounds\(\)/.test(rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.js'))))
  check('左侧轴列独立于滚动区（不随图滚）', /class="wv3-axis"/.test(wxml) && /class="wv3-inner"/.test(wxml))
  check('云层图点选绑定 onCloudTap（与逐时列点选分开）', /bindtap="onCloudTap"/.test(wxml))
  check('日月视图不把客观时刻写进 wx:if 天气条件', /客观时刻 · 不因天气取消/.test(wxml))
  check('天相三卡按 verdict 出胶囊（possible/unknown/excluded 三态）', /item\.verdict === 'possible'/.test(wxml))
  check('沿途禁用态有说明（单点没有行程）', /t === 'route'/.test(rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.js'))))
  const wxss = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxss'))
  check('四视图 tab 吸顶（position:sticky）', /position:\s*sticky/.test(wxss))
  const tabsBlock = (wxss.match(/\.wv3-tabs\s*\{[^}]*\}/) || [''])[0]
  // G8 要求同选择器里有非 auto 偏移，所以偏移必须写出来；但它只能消费行内变量，不许出现字面量。
  // 只认独立声明：border-top: 含 "top:" 子串，不能用 indexOf 判
  const tabsTop = (tabsBlock.match(/(?:^|[;{\s])top\s*:\s*([^;}]+)/) || [])[1] || ''
  check('吸顶偏移必须真的写出来（否则 G8 判它等价 static）', tabsTop !== '', tabsBlock)
  check('偏移值不写字面量，只消费 --wv3-chrome（品牌条高度必须实测，见 §2b）',
    /^var\(--wv3-chrome\)$/.test(tabsTop.trim()), tabsTop)
  check('轴列宽 49px（≤380 时由页面 20px 边距兜住）', /width:\s*49px/.test(wxss))
  check('无卡片语言（.card 不出现）', wxss.indexOf('.card') === -1)
}

/* ------------------------------------------------------------------ */
section('§2b 品牌固定条：两屏同一身份，返回只出现在能返回的那屏')

{
  const hubWxml = rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.wxml'))
  const detWxml = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxml'))
  const detWxss = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxss'))
  const hubWxss = rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.wxss'))
  check('两屏都挂 brand-header 且同为 plain（白底无分隔线，两屏身份不跳）',
    hubWxml.indexOf('<brand-header variant="plain" />') !== -1 &&
    detWxml.indexOf('variant="plain"') !== -1)
  // 只看 brand-header 标签本身：bind:screenback 里也含 "back"，全文件 indexOf 会误报
  const hubBrandTag = (hubWxml.match(/<brand-header[^>]*>/) || [''])[0]
  check('屏 1 没有返回键（它是根屏，无路可退）',
    hubBrandTag !== '' && !/\bback\b/.test(hubBrandTag), hubBrandTag)
  check('屏 2 的返回只在「能返回」时出现（深链模式或宿主 canBack）',
    detWxml.indexOf('back="{{mode === \'deep\' || canBack}}"') !== -1)
  check('返回经 bind:back 交给既有 onBack（不新起一条导航链路）',
    detWxml.indexOf('bind:back="onBack"') !== -1 &&
    /onBack\s*\(\s*\)\s*\{\s*this\.triggerEvent\('screenback'\)/.test(rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.js'))))
  const detJson = JSON.parse(rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.json')))
  const hubJson = JSON.parse(rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.json')))
  check('两屏都注册了 brand-header（用同一个组件，不各画一份词标）',
    detJson.usingComponents && detJson.usingComponents['brand-header'] === '../brand-header/brand-header' &&
    hubJson.usingComponents && !!hubJson.usingComponents['brand-header'])
  check('旧的手绘品牌条已删除（wh-brand / wv3-word 不再出现）',
    hubWxml.indexOf('wh-brand') === -1 && detWxml.indexOf('wv3-word') === -1 &&
    hubWxss.indexOf('.wh-brand') === -1 && detWxss.indexOf('.wv3-word') === -1)
  check('tab 吸顶的 top 接品牌条实测高度（ready → chromeHeight → 行内变量 → 样式表消费，不是第二份几何）',
    detWxml.indexOf('style="--wv3-chrome:{{chromeHeight}}px"') !== -1 &&
    /--wv3-chrome:\s*64px/.test(detWxss) &&
    /onChromeReady\s*\(/.test(rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.js'))) &&
    /chromeHeight:\s*64/.test(rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.js'))) &&
    /triggerEvent\('ready'/.test(rd(path.join(MP, 'components', 'brand-header', 'brand-header.js'))))
}

/* ------------------------------------------------------------------ */
section('§2c 天气图标：5 类封闭，码 → 图标只有一个出处')

{
  const F = require('../miniprogram/utils/format')
  check('图标类恰好 5 个（sun / cloud / rain / snow / storm）',
    JSON.stringify(F.WEATHER_ICON_CLASSES) === JSON.stringify(['sun', 'cloud', 'rain', 'snow', 'storm']),
    F.WEATHER_ICON_CLASSES)
  const cases = [
    [0, 'sun'], [1, 'sun'],
    [2, 'cloud'], [3, 'cloud'], [45, 'cloud'], [48, 'cloud'],
    [51, 'rain'], [56, 'rain'], [57, 'rain'], [66, 'rain'], [67, 'rain'],
    [80, 'rain'], [81, 'rain'], [82, 'rain'],
    [71, 'snow'], [75, 'snow'], [77, 'snow'], [85, 'snow'], [86, 'snow'],
    [95, 'storm'], [96, 'storm'], [99, 'storm'],
  ]
  const bad = cases.filter(([c, want]) => F.weatherIcon(c) !== want)
  check('每个 WMO 码都落到登记的类（冻雨 56/57/66/67 → rain、冻雾 45/48 → cloud）', bad.length === 0, bad)
  const missing = [null, undefined, '', '  ', 'x', 4, 100]
    .filter(v => F.weatherIcon(v) !== '')
  check('不认识的码 / 缺码一律不给图标（没有图标 ≠ 阴天，不拿云替说不出话的数据）', missing.length === 0,
    missing.map(v => String(v) + '→' + F.weatherIcon(v)))
  check('码 1 画太阳、标签桶仍写「多云」——两处不同源是有意的',
    F.weatherIcon(1) === 'sun' && F.weatherPhrase(1).label === '多云')
  // icon 组件 require 时会调全局 Component；stub 掉只取 PATHS
  const prev = global.Component
  let PATHS = {}
  global.Component = () => {}
  try { PATHS = require('../miniprogram/components/icon/icon').PATHS } finally { global.Component = prev }
  const noPath = F.WEATHER_ICON_CLASSES.filter(k => typeof PATHS[k] !== 'string' || !PATHS[k].trim())
  check('5 个图标类在 icon 组件的 PATHS 里都有定义（少一个会静默回退成活动图标）', noPath.length === 0, noPath)
  check('帮助链接与下箭头用的 info / down 也已定义',
    typeof PATHS.info === 'string' && typeof PATHS.down === 'string')

  const days = []
  for (let i = 0; i < 5; i++) days.push({ date: V3.addDays('2026-10-29', i), code: [0, 3, 61, 73, 95][i] })
  const strip = V3.pointDayStrip(days, [], '2026-10-29')
  check('单点日期条带 code 与 icon（码从云端 daily 来，不由中文标签反推）',
    strip.map(x => x.icon).join(',') === 'sun,cloud,rain,snow,storm' && strip[0].code === 0,
    strip.map(x => x.icon))
  check('缺 code 的日期卡不出图标（页面 wx:if 兜住，不画默认云）',
    V3.pointDayStrip([{ date: '2026-10-29' }], [], '2026-10-29')[0].icon === '')
  const planStrip = V3.planDayStrip({ startDate: '2026-10-29', stops: [{ nodeIndex: 0, day: 1, time: '' }] }, ['2026-10-29'], '2026-10-29', null)
  check('计划日期条不带图标（D1/D2 是行程日，不是预报日）',
    planStrip.every(x => x.icon === undefined && x.code === undefined))
  const r = V3.readoutOf({ t: '08:00', d: '2026-10-29', temp: 4, code: 95 }, { name: '山脊', altitude: 3000 })
  check('读数行带 icon（与 condition 同码同源）',
    r.icon === 'storm' && r.condition === F.weatherPhrase(95).label, r.icon + '/' + r.condition)
}

{
  const files = ['weather-detail.js', 'weather-v3.js', 'weather-v3-view.js']
  const dup = []
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) return walk(p)
    if (!/\.js$/.test(d.name)) return
    const s = rd(p)
    if (/function buildDetailView\s*\(/.test(s)) dup.push(path.relative(MP, p))
  })
  walk(MP)
  check('buildDetailView 只有一个实现（跨宿主共享，不写第二份）', dup.length === 1, dup)
  check('共享单元的三个核心文件都在',
    files.every(f => fs.existsSync(path.join(MP, 'utils', f)) || fs.existsSync(path.join(MP, 'components', 'weather-detail', f))), files)
}

/* ------------------------------------------------------------------ */
section('§2d 图形入口：词表在 icon 组件，页面只给名字与尺寸')

{
  const prev = global.Component
  let PATHS = {}
  global.Component = () => {}
  try { PATHS = require('../miniprogram/components/icon/icon').PATHS } finally { global.Component = prev }
  const added = ['next', 'up', 'calendar', 'crosshair', 'upload', 'lock', 'cloudoff', 'check']
  const missing = added.filter(k => typeof PATHS[k] !== 'string' || !PATHS[k].trim())
  check('页面用到的图形词都在 PATHS（next / up / calendar / crosshair / upload / lock / cloudoff / check）',
    missing.length === 0, missing)
  // icon 组件把 d 原样拼进 data:image/svg+xml；尖括号会当场截断成非法 XML
  const broken = added.filter(k => !/^[Mm]/.test(PATHS[k] || '') || /[<>]/.test(PATHS[k] || ''))
  check('每个词都是单条 path 的 d 字符串（首命令 M，且不含尖括号）',
    broken.length === 0, broken.map(k => PATHS[k]))
}

{
  const hub = rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.wxml'))
  const hubJs = rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.js'))
  check('地图选点是图形主键（pin 19，与原型 home-action-primary 同尺寸）',
    /<icon name="pin" size="19"/.test(hub))
  check('两个次入口各带图形（crosshair / upload，16）',
    /<icon name="crosshair" size="16"/.test(hub) && /<icon name="upload" size="16"/.test(hub))
  check('「继续上次」的标签带日历图形（11）', /<icon name="calendar" size="11"/.test(hub))
  // 行首图标砖：计划两 tab → calendar，常用地点 → pin，路线/轨迹 → route
  const tiles = (hub.match(/class="wh-asset-icon"><icon name="(\w+)" size="18" color="#5F7A63" \/>/g) || [])
    .map(s => s.replace(/.*name="(\w+)".*/, '$1'))
  check('资产行首是图标砖而不是纯文字（38×38 底座 + 18px 图形）',
    tiles.length >= 5 && ['calendar', 'pin', 'route'].every(k => tiles.indexOf(k) !== -1), tiles)
  check('计划行不拿地点/路线图形凑数（两个计划 tab 都用 calendar）',
    tiles.filter(k => k === 'calendar').length === 2, tiles)
  check('首页不再用文本箭头（› 与 ▾/▴ 都换成图形）',
    !/[›▾▴]/.test(hub) && (hub.match(/<icon name="next"/g) || []).length >= 5)
  check('轨迹展开/收起是 up/down 图形（随 trackOpen 切换）',
    /<icon name="\{\{trackOpen\[item\.id\] \? 'up' : 'down'\}\}"/.test(hub))
  check('地点弹层把当前地点标成 check、其余仍 next（不靠文案猜当前）',
    /wx:if="\{\{item\.current\}\}" name="check"/.test(hub) &&
    /wx:else name="next"/.test(hub))
  check('当前项在数据里是布尔（JS 从 place.id 前缀推 key，WXML 不比对 id 片段）',
    /current: key === curKey/.test(hubJs) && /current: true/.test(hubJs) &&
    /if \(item\.current\) return this\.setData\(\{ placeOpen: false \}\)/.test(hubJs))
}

{
  const detWxml = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxml'))
  const detWxss = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxss'))
  const viewJs = rd(path.join(MP, 'utils', 'weather-v3-view.js'))
  // 原型四处：云层/路线两条 link-row、停靠点名、节点选项的未选中项；另两处是时段滑块的前后一小时
  check('详情不再用文本 › 当箭头（六处图形：四处入口 + 两个时段步进）',
    (detWxml.match(/›/g) || []).length === 0 &&
    (detWxml.match(/<icon [^>]*name="next"/g) || []).length === 6)
  check('时段步进是 back/next 一对 17px（原型同形，不是带尾的 arrow）',
    (detWxml.match(/<icon name="back" size="17" color="#627568"/g) || []).length === 2 &&
    (detWxml.match(/<icon name="next" size="17" color="#627568"/g) || []).length === 2 &&
    detWxml.indexOf('name="arrow"') === -1)
  check('三档箭头尺寸各有出处（行内 18 / 停靠点 14 / 节点选项 19，与原型逐处对应）',
    /<icon name="next" size="18" color="#6C7C70"/.test(detWxml) &&
    /<icon name="next" size="14" color="#8A968C"/.test(detWxml) &&
    /<icon [^>]*name="next" size="19" color="#16783E"/.test(detWxml))
  // 这一条原来钉的是 view 模块里 `nodeOptions: allNodes.map(...)` 的**源码文本**——
  // 把表达式搬进具名函数（行为一模一样）就会假红，正是铁律 30① 的反例。改成打真实函数读行为。
  check('节点弹层给当前节点打 check（其余 next），列表读投影算好的 selected',
    /wx:for="\{\{nodeOptions\}\}"/.test(detWxml) &&
    /wx:if="\{\{item\.selected\}\}" name="check"/.test(detWxml) &&
    (function () {
      const nodes = [{ name: 'a', altitude: 1 }, { name: 'b', altitude: null }, { name: 'c', altitude: 3 }]
      const picked = V.nodeOptionsOf({ kind: 'route', nodes: nodes }, 1)
      return picked.length === 3 && picked.map(o => o.selected).join(',') === 'false,true,false' &&
        picked[1].altitude === null && picked[0].altitude === 1
    })(), '')
  check('读图说明降为灰 10px 辅助入口（wv3-link-quiet）',
    /class="wv3-link wv3-link-quiet"[^>]*data-kind="cloud"/.test(detWxml))
  // 原型 #choose-node 的两态（坐标 / 节点名）都以 pin 开头，后面才跟 down
  check('页头节点行带定位 pin（12，原型 #choose-node 同形）',
    /<view class="wv3-node"[^>]*>\s*<icon name="pin" size="12" color="#657168" \/>/.test(detWxml))
  // 原型 offlineBanner / plan-notice：图标名与颜色由数据给，WXML 不自造分支
  check('缓存时效条带 cloudoff 图形（与原型 offlineBanner 同义）',
    /wx:if="\{\{stale\}\}"[\s\S]{0,80}?<icon name="cloudoff" size="14" color="#7A5C1E" \/>/.test(detWxml) &&
    /\.wv3-banner\s*\{[^}]*display:\s*flex/.test(detWxss))
  check('沿途提示条按 notice.icon / notice.color 出图（clock 信息 / calendar 越界）',
    /<icon name="\{\{route\.notice\.icon\}\}" size="14" color="\{\{route\.notice\.color\}\}" \/>/.test(detWxml) &&
    /icon: 'clock', color: '#506650'/.test(viewJs) &&
    /icon: 'calendar', color: '#7A5C1E'/.test(viewJs))
  check('「如何判断」仍是章节头绿 11px（不复用灰辅助样式）',
    /<view class="wv3-link" hover-class="wv3-tap" data-kind="sky" bindtap="onHelp">[\s\S]{0,120}?如何判断/.test(detWxml))
  check('灰辅助入口的样式真的收到 10px（不是只换了类名）',
    /\.wv3-link-quiet\s*\{[^}]*font-size:\s*10px/.test(detWxss))
  check('文本箭头时代的 .wv3-chev 已删除（不留死样式）', detWxss.indexOf('.wv3-chev') === -1)
}

{
  const sheetWxml = rd(path.join(MP, 'components', 'weather-plan-sheet', 'weather-plan-sheet.wxml'))
  const sheetWxss = rd(path.join(MP, 'components', 'weather-plan-sheet', 'weather-plan-sheet.wxss'))
  check('日期选择器用 down 图形，不用文本 ▾', !/[▾▴]/.test(sheetWxml) &&
    /<icon name="down" size="12" color="#8B958C" \/>/.test(sheetWxml))
  check('「不改原始记录」的说明带 lock 图形（与原型 plan-notice 同义）',
    /class="wp-note wp-note-lock"[\s\S]{0,120}?<icon name="lock" size="13"/.test(sheetWxml))
  check('lock 说明的排版是 flex 行（图形与文字不挤成一段）',
    /\.wp-note-lock\s*\{[^}]*display:\s*flex/.test(sheetWxss))
  check('文本箭头的 .wp-picker-arrow 已删除（不留死样式）', sheetWxss.indexOf('.wp-picker-arrow') === -1)
}

/* ------------------------------------------------------------------ */
section('§3 状态机契约（utils/weather-v3.js）')

{
  const s0 = V3.initialState({ date: '2026-10-29', cursor: 13, period: 24, tab: 'hourly', nodeIndex: 2 })
  check('initialState 只收合法 tab / period', s0.tab === 'hourly' && s0.period === 24 && s0.nodeIndex === 2, s0)
  check('非法 period 回落 24', V3.initialState({ period: 36 }).period === 24)
  check('非法 tab 回落 hourly', V3.initialState({ tab: 'nope' }).tab === 'hourly')

  check('selectedDate = 窗口起点 + floor(cursor/24)',
    V3.selectedDate(V3.initialState({ date: '2026-10-29', cursor: 30, period: 48 })) === '2026-10-30')
  check('selectedHour = cursor % 24', V3.selectedHour(V3.initialState({ cursor: 30, period: 48 })) === 6)

  const a = V3.initialState({ date: '2026-10-29', cursor: 13 })
  check('setTab 只换视图，不动时刻', ((x) => x.tab === 'sky' && V3.cursorOf(x) === 13)(V3.setTab(a, 'sky')))
  check('非法 tab 不改状态', V3.setTab(a, 'nope').tab === 'hourly')

  check('selectHour 夹在 [0, period-1]',
    V3.cursorOf(V3.selectHour(a, 99)) === 23 && V3.cursorOf(V3.selectHour(a, -3)) === 0)
  check('selectHour 忽略非数字（不把 NaN 写进游标）', V3.cursorOf(V3.selectHour(a, 'x')) === 13)

  const p48 = V3.changePeriod(a, 48)
  check('changePeriod 保留当前时刻：48h 窗口起点回到选中日、游标回到小时',
    p48.period === 48 && p48.date === '2026-10-29' && V3.cursorOf(p48) === 13, p48)
  const cross = V3.changePeriod(V3.initialState({ date: '2026-10-29', cursor: 30, period: 48 }), 24)
  check('跨天选中的时刻切回 24h 时，窗口起点跟随到次日、游标收进窗口',
    cross.date === '2026-10-30' && V3.cursorOf(cross) === 6, cross)
  check('changePeriod 拒绝非法时长', V3.changePeriod(a, 36).period === 24)

  const d = V3.setDate(a, '2026-11-02')
  check('setDate 保留一天中的小时', V3.selectedHour(d) === 13 && V3.cursorOf(d) === 13, d)

  const series = []
  for (let i = 0; i < 72; i++) series.push({ d: V3.addDays('2026-10-29', Math.floor(i / 24)), t: V3.pad(i % 24) + ':00', temp: i })
  const win = V3.windowSeries(series, V3.initialState({ date: '2026-10-29', cursor: 0, period: 48 }))
  check('windowSeries 从窗口起点取满 period 小时', win.length === 48 && win[0].t === '00:00' && win[47].t === '23:00',
    win.length + '/' + (win[0] && win[0].t) + '/' + (win[47] && win[47].t))
  check('windowSeries 窗口越界时按实际可用小时返回（不补空行）',
    V3.windowSeries(series.slice(0, 30), V3.initialState({ period: 72 })).length === 30)
  check('hourAt 越界返回 null（页面据此显示空态，不虚构一小时）', V3.hourAt(win, 99) === null)
  check('columnLabel 在 00:00 列显示日期而不是 “00”',
    V3.columnLabel(win, 24).label === V3.shortDate('2026-10-30'), V3.columnLabel(win, 24))
}

/* ------------------------------------------------------------------ */
section('§4 日期条：单点 5 日卡 / 计划 D1…Dn')

{
  const days = []
  for (let i = 0; i < 7; i++) days.push({ date: V3.addDays('2026-10-29', i), code: 3, min: 1 + i, max: 8 + i })
  const strip = V3.pointDayStrip(days, [], '2026-10-31')
  check('单点恰好 5 张卡', strip.length === 5, strip.length)
  check('选中日落在 5 日卡里且只有一张 selected',
    strip.filter(x => x.selected).length === 1 && strip.filter(x => x.selected)[0].date === '2026-10-31',
    strip.map(x => x.date + (x.selected ? '*' : '')))
  check('缺 min/max 时给 null（页面印 —，不补 0）',
    V3.pointDayStrip([{ date: '2026-10-29' }], [], '2026-10-29')[0].min === null)

  const plan = { startDate: '2026-10-29', stops: [{ nodeIndex: 0, day: 1, time: '08:00' }, { nodeIndex: 1, day: 2, time: '10:00' }, { nodeIndex: 2, day: 2, time: '16:00' }] }
  const ps = V3.planDayStrip(plan, ['2026-10-29', '2026-10-30'], '2026-10-30', null)
  check('计划日期条按最大 day 出 D1/D2', ps.length === 2 && ps[0].key === 'D1' && ps[1].key === 'D2',
    ps.map(x => x.key))
  check('超出预报范围的日期被禁用（不是隐藏）',
    ps.filter(x => x.enabled).length === 2 && V3.planDayStrip(plan, ['2026-10-29'], '2026-10-29', null)[1].enabled === false)
  check('活动日标记只在指定日期出现',
    V3.planDayStrip(plan, ['2026-10-29', '2026-10-30'], '2026-10-29', '2026-10-30')[1].isActivityDay === true)
  check('计划日期条只出到 7 天（服务器上限同步）',
    V3.planDayStrip({ startDate: '2026-10-29', stops: [{ nodeIndex: 0, day: 9, time: '' }] }, [], '', null).length === 7)
}

/* ------------------------------------------------------------------ */
section('§5 读数：缺值不补 0')

{
  const r = V3.readoutOf({ t: '08:00', d: '2026-10-29', temp: 4.4, feels: 1, code: 3, precip: 0, pop: 20, wind: 9, gust: 16, windDir: 225, rh: 70, visibility: 12.3, cloud: { low: 40, mid: 30, high: 20 } }, { name: '山脊', altitude: 3280 })
  check('温度取整、体感取整', r.temp === '4' && r.feels === '1', r.temp + '/' + r.feels)
  check('降水 0 仍显示 0.0（有读数）', r.precip === '0.0')
  check('风向角 → 中文', r.windDir.indexOf('西南') === 0, r.windDir)
  check('海拔来自节点（不是「你」）', r.altitude === 3280 && r.altitudeText === '3280')
  check('详细读数固定 6 项', r.detailRows.length === 6, r.detailRows.map(x => x.key))
  const m = V3.readoutOf({ t: '08:00', d: '2026-10-29' }, { name: '山脊', altitude: null })
  check('全缺值全部印 —（不补 0）',
    m.temp === '—' && m.precip === '—' && m.wind === '—' && m.rh === '—' && m.visibility === '—',
    [m.temp, m.precip, m.wind])
  check('缺海拔时详情里写「待确认」而不是 0 m',
    m.detailRows[5].value === '—' && m.detailRows[5].unit === '待确认', m.detailRows[5])
  check('没有读数时 hasAnyReading = false', m.hasAnyReading === false)
}

/* ------------------------------------------------------------------ */
section('§6 天相三卡：合并规则（possible > unknown > excluded）')

{
  const items = [
    { key: 'cloudSea', title: '云海', verdict: 'excluded', score: 0, text: '今天没有成层云带' },
    { key: 'star', title: '星空', verdict: 'unknown', score: 0, text: '缺少暗夜小时' },
    { key: 'galaxy', title: '银河', verdict: 'possible', score: 72, text: '有条件', look: '朝东南找银心', window: '21:00–23:00' },
    { key: 'rainbow', title: '彩虹', verdict: 'excluded', score: 0, text: '没有同时满足太阳与水分的小时' },
    { key: 'alpenglow', title: '光染', verdict: 'excluded', score: 0, text: '晨昏窗口内低云太多' },
  ]
  const cards = V3.skyCards({ items })
  check('六项收成三张卡', cards.length === 3, cards.map(c => c.key))
  const sea = cards.filter(c => c.key === 'cloudSea')[0]
  check('云海：单成员 excluded 直接沉默原因', sea.verdict === 'excluded' && sea.reason.indexOf('成层云带') !== -1, sea)
  const night = cards.filter(c => c.key === 'night')[0]
  check('星空/银河：任一 possible 即 possible（不被 unknown 拉低）', night.verdict === 'possible', night.verdict)
  check('possible 保留 look / window（不把建议丢在合并里）',
    night.look.indexOf('银心') !== -1 && night.window.indexOf('21:00') !== -1, night)
  check('分数取可见项最大（excluded 不替可见结论投票）', night.score === 72, night.score)
  const color = cards.filter(c => c.key === 'color')[0]
  check('彩虹/光染：全 excluded ⇒ excluded', color.verdict === 'excluded' && color.verdictLabel === '今天不成立', color)
  check('excluded 写原因而不是「资料不足」', color.text.indexOf('资料不足') === -1, color.text)

  const unknownOnly = V3.skyCards({ items: [{ key: 'star', title: '星空', verdict: 'unknown', score: 0, text: '没有可信海拔' }] })
  check('unknown 必须仍出卡并说明缺什么（不冒充不成立）',
    unknownOnly.length === 1 && unknownOnly[0].verdict === 'unknown' && unknownOnly[0].text.indexOf('海拔') !== -1, unknownOnly)
  const legacy = V3.skyCards({ items: [{ key: 'star', title: '星空', score: 75, text: '旧返回体没有 verdict' }] })
  check('旧返回体缺 verdict 时按分数读成 possible（不静默降级成 excluded）', legacy[0].verdict === 'possible', legacy)
}

/* ------------------------------------------------------------------ */
section('§7 计划本地校验与服务端同源')

{
  const ok = [ { nodeIndex: 0, day: 1, time: '08:00' }, { nodeIndex: 1, day: 1, time: '13:30' }, { nodeIndex: 1, day: 2, time: '08:00' }, { nodeIndex: 0, day: 2, time: '' } ]
  check('正常计划无违规', V3.planTimeViolation(ok) === null)
  check('同日逆序被抓到（第 1 天第二个站更早）',
    (() => { const b = V3.planTimeViolation([{ nodeIndex: 0, day: 1, time: '12:00' }, { nodeIndex: 1, day: 1, time: '09:00' }]); return b && b.day === 1 && b.index === 1 })())
  check('空值不参与比较（留空站不制造逆序）',
    V3.planTimeViolation([{ nodeIndex: 0, day: 1, time: '' }, { nodeIndex: 1, day: 1, time: '09:00' }, { nodeIndex: 2, day: 1, time: '' }]) === null)
  check('跨天重复同一节点合法', V3.planTimeViolation([{ nodeIndex: 1, day: 1, time: '17:00' }, { nodeIndex: 1, day: 2, time: '08:00' }]) === null)
  check('HH:mm 格式闸', V3.typedTime('08:00') && !V3.typedTime('8:00') && !V3.typedTime('24:00') && !V3.typedTime(''))

  const draft = PL.validateDraft({ input: { routeId: 'r1', name: '格聂', startDate: '2026-10-29', stops: [{ nodeIndex: 0, day: 1, time: '08:00' }] } }, 3)
  check('validateDraft 接受合法草稿', draft.ok === true, draft)
  check('validateDraft 拦节点越界',
    PL.validateDraft({ input: { routeId: 'r1', name: 'x', startDate: '2026-10-29', stops: [{ nodeIndex: 9, day: 1, time: '' }] } }, 3).ok === false)
  check('validateDraft 拦空名称',
    PL.validateDraft({ input: { routeId: 'r1', name: '  ', startDate: '2026-10-29', stops: [] } }, 3).ok === false)
  check('validateDraft 拦同日逆序',
    (() => { const r = PL.validateDraft({ input: { routeId: 'r1', name: 'x', startDate: '2026-10-29', stops: [{ nodeIndex: 0, day: 1, time: '12:00' }, { nodeIndex: 1, day: 1, time: '09:00' }] } }, 3); return !r.ok && r.error.indexOf('先于前一站') !== -1 })())
  check('planForRoute 取最近一条（列表已按 updatedAt 倒序）',
    PL.planForRoute([{ id: 'a', routeId: 'r1' }, { id: 'b', routeId: 'r2' }], 'r1').id === 'a')
  check('sharedPlans 只含非 owner', PL.sharedPlans([{ id: 'a', isOwner: true }, { id: 'b', isOwner: false }]).length === 1)
}

/* ------------------------------------------------------------------ */
section('§8 底栏留白与页面身份')

{
  const wxss = rd(path.join(MP, 'pages', 'weather-hub', 'weather-hub.wxss'))
  check('Hub 作为 tab 页保留 84px + 安全区的底部留白（固定底栏不截列表）',
    /padding-bottom:\s*calc\(32px \+ 84px \+ env\(safe-area-inset-bottom\)\)/.test(wxss))
  check('详情组件不自己再加一层 84px（它是宿主里的一段，不是独立页）',
    rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.wxss')).indexOf('84px') === -1)
}

/* ------------------------------------------------------------------ */
section('§9 页头与节点弹层：地点侧字段只有一个出处')

{
  const comp = rd(path.join(MP, 'components', 'weather-detail', 'weather-detail.js'))
  const route = {
    id: 'route:x', kind: 'route', name: '格聂两日', lat: 29.8, lng: 99.7,
    nodes: [
      { name: '山谷起点', altitude: 3200 }, { name: '观景点', altitude: 3800 }, { name: '溪畔营地', altitude: null },
    ],
  }
  const point = { id: 'point:x', kind: 'point', name: '折多山', lat: 30.0512, lng: 101.8156, nodes: [{ name: '折多山', altitude: 4298 }] }
  check('路线节点行 = 节点名 + 海拔（千分位）', V.placeSubText(route, route.nodes[1]) === '观景点 · 3,800 m', V.placeSubText(route, route.nodes[1]))
  check('单点行 = 坐标 + 海拔', V.placeSubText(point, point.nodes[0]) === '30.0512°N, 101.8156°E · 4,298 m', V.placeSubText(point, point.nodes[0]))
  check('缺海拔 ⇒「海拔待确认」，不印 0 m', V.placeSubText(route, route.nodes[2]) === '溪畔营地 · 海拔待确认', V.placeSubText(route, route.nodes[2]))
  check('节点没名字 ⇒ 只留海拔，不留悬空分隔符',
    V.placeSubText(route, { altitude: 3200 }) === '3,200 m' && /^\s|·\s*$/.test(V.placeSubText(route, { altitude: 3200 })) === false,
    V.placeSubText(route, { altitude: 3200 }))
  check('坐标缺一个 ⇒ 整段不印（不出现 undefined°E）',
    V.placeSubText({ kind: 'point', lat: 30.05, nodes: [] }, {}) === '海拔待确认',
    V.placeSubText({ kind: 'point', lat: 30.05, nodes: [] }, {}))
  check('弹层选中位跟着 nodeIndex 走（越界向内夹）',
    V.nodeOptionsOf(route, 2).map(o => o.selected).join(',') === 'false,false,true' &&
      V.nodeOptionsOf(route, 99).map(o => o.selected).join(',') === 'false,false,true',
    V.nodeOptionsOf(route, 99))
  check('isPoint 判定：kind 或节点数 ≤1（组件与装配层同一把尺）',
    V.isPointPlace(point) === true && V.isPointPlace(route) === false &&
      V.isPointPlace({ kind: 'route', nodes: [{ name: '只有一个' }] }) === true, '')

  // 反复制：格式化本体只许在 view 模块里出现一次，组件只调用
  check('组件里不得出现第二份坐标 / 待确认 / 未命名地点字面量（格式化只出自 view）',
    comp.indexOf('°N') === -1 && comp.indexOf('海拔待确认') === -1 && comp.indexOf('未命名地点') === -1, '')
  const viewSrc = rd(path.join(MP, 'utils', 'weather-v3-view.js'))
  check('坐标格式化本体全仓只有一处（view 模块内 °N 只出现一次）',
    (viewSrc.match(/°N/g) || []).length === 1, (viewSrc.match(/°N/g) || []).length)
  check('组件的三个页头字段都走 view 单源（placeNameText / placeSubText / nodeOptionsOf）',
    /V\.placeNameText\(/.test(comp) && /V\.placeSubText\(/.test(comp) && /V\.nodeOptionsOf\(/.test(comp) && /V\.isPointPlace\(/.test(comp), '')
  check('换节点时也会重刷页头（onNodePick 里调 syncHeader，不只在 resetContext）',
    /onNodePick[\s\S]{0,400}this\.syncHeader\(\)/.test(comp), '')
}

console.log('\n' + (failed ? 'FAILED ' : 'OK ') + 'passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)