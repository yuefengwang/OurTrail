// 活动详情 L2 结构门：node tools/activity-l2-structure-test.js
//
// 这一套钉两轮垂直切片真正动过的结构：
//   S1（首屏）：① hero 变成组件，且组件里不再印里程/爬升（指标移到路线区）；
//   ② 信息卡是时间/集合/人数/强度的唯一出口，事实区（sec-facts）整块消失；
//   ③ 封面来源说明全页只印一次，落在纸面背景上；
//   ④ 路线指标条在剖面/地图之前；
//   ⑤ 共享资产 .hero-cover 只允许被 .act-hero 作用域覆盖。
//   S2（正文节奏）：⑥ 9 个正文区块统一由 chapter 承载，编号只给阅读顺序里的 8 个章节；
//   ⑦ 外层 .stack-sections 统一 28px 章节间距；⑧ 节点时间轴从路线区迁入行程章节；
//   ⑨ 装备改成四列图标格（文字始终可见）；⑩ 费用文案逐字不变、页尾两行同属一个 .stack。
//
// 为什么允许它读源码：①③④⑥⑦⑧ 本身就是「模板里出现几次、谁在谁前面」的事实，
// 属于结构性契约（与铁律 30 的「别拿源码文本钉业务判据」不冲突——这里没有业务判据）。
// 组件行为不读源码：fact-grid / chapter / equipment-grid 的过滤、默认值、规范化都真调 Component 配置。
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const P = (...p) => path.join(ROOT, 'miniprogram', ...p)
const read = file => fs.readFileSync(P(file), 'utf8')
const stripComments = text => text.replace(/<!--[\s\S]*?-->/g, '')

const ACT_WXML_RAW = read('pages/activity/activity.wxml')
const ACT_WXML = stripComments(ACT_WXML_RAW)
const ACT_JS = read('pages/activity/activity.js')
const ACT_WXSS = read('pages/activity/activity.wxss')
const ACT_JSON = JSON.parse(read('pages/activity/activity.json'))
const APP_JSON = JSON.parse(read('app.json'))
const APP_WXSS = read('app.wxss')
const OVERLAY_WXSS = read('components/overlay/overlay.wxss')
const HERO_WXML = stripComments(read('components/activity-hero/activity-hero.wxml'))
const HERO_JS = read('components/activity-hero/activity-hero.js')
const HERO_WXSS = read('components/activity-hero/activity-hero.wxss')
const GRID_JS = read('components/fact-grid/fact-grid.js')
const GRID_WXML = stripComments(read('components/fact-grid/fact-grid.wxml'))
const GRID_WXSS = read('components/fact-grid/fact-grid.wxss')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }

// 以 stub 捕获 Component 配置：组件源码在 require 时直接调用全局 Component。
function loadComponent(file) {
  const resolved = require.resolve(file)
  delete require.cache[resolved]
  let cfg = null
  const prev = global.Component
  global.Component = def => { cfg = def }
  try { require(file) } finally { global.Component = prev }
  if (!cfg) throw new Error('未捕获 Component 配置：' + file)
  return cfg
}

section('1. 组件注册与接线')
{
  check('activity.json 注册 activity-hero / fact-grid',
    ACT_JSON.usingComponents['activity-hero'] === '/components/activity-hero/activity-hero'
    && ACT_JSON.usingComponents['fact-grid'] === '/components/fact-grid/fact-grid',
    ACT_JSON.usingComponents)
  const heroJson = JSON.parse(read('components/activity-hero/activity-hero.json'))
  const gridJson = JSON.parse(read('components/fact-grid/fact-grid.json'))
  check('两个组件的 json 都是 component:true', heroJson.component === true && gridJson.component === true,
    { hero: heroJson, grid: gridJson })
  check('WXML 实用了 activity-hero 与两次 fact-grid（信息卡 + 路线指标）',
    (ACT_WXML.match(/<activity-hero\b/g) || []).length === 1
    && (ACT_WXML.match(/<fact-grid\b/g) || []).length === 2,
    { hero: (ACT_WXML.match(/<activity-hero\b/g) || []).length, grid: (ACT_WXML.match(/<fact-grid\b/g) || []).length })
}

section('2. 首屏顺序：hero → 信息卡 → 封面说明，且都在 .act-top')
{
  const iTop = ACT_WXML.indexOf('class="act-top"')
  const iHero = ACT_WXML.indexOf('<activity-hero')
  const iInfo = ACT_WXML.indexOf('class="card act-info"')
  const iNote = ACT_WXML.indexOf('act-photo-note')
  const iCallout = ACT_WXML.indexOf('class="callout {{stateTone}}"')
  check('顺序为 act-top < hero < 信息卡 < 封面说明 < 状态 callout',
    iTop !== -1 && iHero > iTop && iInfo > iHero && iNote > iInfo && iCallout > iNote,
    { iTop, iHero, iInfo, iNote, iCallout })
  check('信息卡仅在 infoFacts 非空时出现（缺项时不留空壳卡）',
    /<view wx:if="\{\{infoFacts\.length\}\}" class="card act-info">/.test(ACT_WXML))
  check('封面说明由 photoNote 驱动，空串不占位',
    /<text wx:if="\{\{photoNote\}\}" class="photo-note act-photo-note">/.test(ACT_WXML))
}

section('3. 事实区退场：sec-facts 不再出现在模板与分区数据里')
{
  check('模板没有 id="sec-facts"', ACT_WXML.indexOf('id="sec-facts"') === -1)
  check('activity.js 没有 sec-facts 锚点', ACT_JS.indexOf("'sec-facts'") === -1 && ACT_JS.indexOf('sec-facts') === -1)
  check('secNo 序列不再含 facts 项', !/\['facts',/.test(ACT_JS))
  check('页面不再产 factTime/factPickup/factPeople/signupBrief/autoSummary',
    ['factTime', 'factPickup', 'factPeople', 'signupBrief', 'autoSummary', 'factSummary']
      .every(k => ACT_JS.indexOf(k) === -1),
    ['factTime', 'factPickup', 'factPeople', 'signupBrief', 'autoSummary', 'factSummary']
      .filter(k => ACT_JS.indexOf(k) !== -1))
}

section('4. 封面来源说明：全页唯一')
{
  const notes = (ACT_WXML.match(/class="[^"]*photo-note/g) || []).length
  check('activity.wxml 里 photo-note 只出现一次', notes === 1, notes)
  check('费用区不再自带第二/第三份封面脚注',
    ACT_WXML.slice(ACT_WXML.indexOf('id="sec-fee"')).indexOf('photo-note') === -1)
}

section('5. 路线指标条：四格来自 routeStats，位于剖面/地图之前')
{
  const iStats = ACT_WXML.indexOf('act-route-stats')
  const iNote = ACT_WXML.indexOf('act-route-stats-note')
  const iMap = ACT_WXML.indexOf('{{map.visible}}')
  const iProfile = ACT_WXML.indexOf('<route-profile')
  check('指标条在说明/地图/剖面之前',
    iStats !== -1 && iStats < iMap && iStats < iProfile && iNote > iStats && iNote < iMap,
    { iStats, iNote, iMap, iProfile })
  check('指标条复用 fact-grid 的 stats 变体',
    /<fact-grid items="\{\{routeStats\}\}" variant="stats" \/>/.test(ACT_WXML))
  check('hero 组件不再承载 distance/ascent 指标',
    HERO_WXML.indexOf('distance') === -1 && HERO_WXML.indexOf('ascent') === -1
    && HERO_JS.indexOf('distance') === -1 && HERO_JS.indexOf('ascent') === -1)
  check('页面 WXML 不再直接插值 distance/ascent', ACT_WXML.indexOf('{{distance') === -1
    && ACT_WXML.indexOf('{{ascent') === -1)
}

section('6. 共享资产 .hero-cover 只做作用域覆盖')
{
  const rules = HERO_WXSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
  const offenders = rules
    .map(r => r.split('{')[0].trim())
    .filter(sel => sel && sel.indexOf('hero-cover') !== -1 && sel.indexOf('.act-hero') === -1)
  check('activity-hero.wxss 里没有未作用域的 hero-cover 选择器', offenders.length === 0, offenders)
  check('标题上叠用三节选择器压过 app.wxss 的同名规则',
    /\.act-hero\.hero-cover \.hero-cover-body\s*\{/.test(HERO_WXSS))
  check('页面只为出血与卡片上叠写页面级微调',
    /\.activity-hero-bleed\s*\{[^}]*margin:\s*0\s+-20px/.test(ACT_WXSS)
    && /\.act-info\s*\{[^}]*margin-top:\s*-24px/.test(ACT_WXSS))
  check('.act-top 用 flex column（负 margin 不会穿透父容器/被 stack gap 抵掉）',
    /\.act-top\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/.test(ACT_WXSS))
}

section('7. fact-grid 行为：空值不占格、奇数末项通栏')
{
  const cfg = loadComponent(P('components/fact-grid/fact-grid.js'))
  check('声明 apply-shared（要读全局 .card/.stack 的排版上下文）',
    cfg.options && cfg.options.styleIsolation === 'apply-shared')
  const self = { data: {}, setData(obj) { Object.assign(this.data, obj); this.last = obj } }
  cfg.observers.items.call(self, [
    { key: 'a', label: 'A', value: '12.5', unit: 'km' },
    { key: 'b', label: 'B', value: '' },
    { key: 'c', label: 'C', value: null },
    { key: 'd', label: 'D', value: 0 },
    { key: 'e', label: 'E', value: '900', unit: 'm', sub: '轨迹高程' },
    { key: 'f', label: 'F', value: undefined },
  ])
  const cells = self.data.cells
  check('空串/null/undefined 不占格，数值 0 保留',
    cells.length === 3 && cells.map(c => c.key).join(',') === 'a,d,e', cells.map(c => c.key))
  check('值/单位/副标题原样透传，不做格式化',
    cells[2].value === '900' && cells[2].unit === 'm' && cells[2].sub === '轨迹高程',
    cells[2])
  check('奇数个时仅末项通栏', cells[2].wide === true && cells.slice(0, 2).every(c => c.wide === false),
    cells.map(c => c.wide))
  const even = { data: {}, setData(obj) { Object.assign(this.data, obj) } }
  cfg.observers.items.call(even, [{ key: 'a', value: '1' }, { key: 'b', value: '2' }])
  check('偶数个时没有通栏项', even.data.cells.every(c => c.wide === false), even.data.cells)
  check('模板按 wide 加类，variant 只做样式分档',
    /class="fact-cell \{\{item\.wide \? 'fact-cell--wide' : ''\}\}"/.test(GRID_WXML)
    && GRID_WXML.indexOf("variant === 'stats' ? 'fact-grid--stats' : 'fact-grid--card'") !== -1)
  check('两列宽度用 calc（仓库无 display:grid 约定）',
    /\.fact-cell\s*\{[^}]*flex:\s*0 0 calc\(50% - 6px\)/.test(GRID_WXSS)
    && GRID_WXSS.indexOf('display: grid') === -1)
}

section('8. activity-hero 行为：两个错误事件分开')
{
  const cfg = loadComponent(P('components/activity-hero/activity-hero.js'))
  check('声明 apply-shared（hero-cover 全局类靠选择器匹配）',
    cfg.options && cfg.options.styleIsolation === 'apply-shared')
  const events = []
  const self = { triggerEvent(name) { events.push(name) } }
  cfg.methods.onCoverError.call(self)
  cfg.methods.onFallbackError.call(self)
  check('实拍失败发 covererror、氛围图失败发 fallbackerror',
    events.join(',') === 'covererror,fallbackerror', events)
  check('模板两条 image 分别绑到两个 handler',
    HERO_WXML.indexOf('binderror="onCoverError"') !== -1
    && HERO_WXML.indexOf('binderror="onFallbackError"') !== -1)
  check('hero 组件只暴露展示所需属性（不含业务状态机字段）',
    Object.keys(cfg.properties).sort().join(',') ===
    ['badgeText', 'cover', 'coverFailed', 'coverIsReal', 'leader', 'routeTitle', 'startAtLabel', 'title'].sort().join(','),
    Object.keys(cfg.properties))
}

section('9. chapter：9 个正文区块共用一套标题骨架，编号只给 8 个阅读章节')
{
  const chapJson = JSON.parse(read('components/chapter/chapter.json'))
  const CHAP_WXML = stripComments(read('components/chapter/chapter.wxml'))
  const CHAP_WXSS = read('components/chapter/chapter.wxss')
  check('activity.json 注册 chapter / equipment-grid',
    ACT_JSON.usingComponents['chapter'] === '/components/chapter/chapter'
    && ACT_JSON.usingComponents['equipment-grid'] === '/components/equipment-grid/equipment-grid',
    ACT_JSON.usingComponents)
  check('chapter.json 是纯展示组件（component:true、无子组件）',
    chapJson.component === true && Object.keys(chapJson.usingComponents || {}).length === 0, chapJson)
  const cfg = loadComponent(P('components/chapter/chapter.js'))
  check('chapter 声明 apply-shared（标题类全部来自 app.wxss）',
    cfg.options && cfg.options.styleIsolation === 'apply-shared')
  check('属性只有 no/kicker/title/sub/gap，gap 默认 12',
    Object.keys(cfg.properties).sort().join(',') === 'gap,kicker,no,sub,title'
    && cfg.properties.gap.value === 12 && cfg.properties.gap.type === Number,
    { keys: Object.keys(cfg.properties), gap: cfg.properties.gap })
  check('编号与 kicker 同行：仅两者都有时插一个空格',
    CHAP_WXML.indexOf("{{no}}{{no && kicker ? ' ' : ''}}{{kicker}}") !== -1)
  check('标题块复用全局 .section-head/.kicker/.list-head__title/.section-sub',
    ['section-head', 'kicker', 'list-head__title', 'section-sub']
      .every(c => CHAP_WXML.indexOf('class="' + c + '"') !== -1))
  check('正文间距由 gap 绑定（margin-top），章节自身不写死间距',
    /<view class="chapter__body" style="margin-top:\{\{gap\}\}px;"><slot \/><\/view>/.test(CHAP_WXML))
  check('chapter__body 有本地样式定义（G10：模板类必须在生效样式表里解得出）',
    /\.chapter__body\s*\{[^}]*display:\s*block/.test(CHAP_WXSS))

  const chapters = ACT_WXML.match(/<chapter\b[^>]*>/g) || []
  const numbered = chapters.filter(tag => /no="\{\{secNo\./.test(tag))
  check('正文共 9 个 chapter，其中 8 个带 secNo 编号（同行人不编号）',
    chapters.length === 9 && numbered.length === 8,
    { total: chapters.length, numbered: numbered.length })
  check('8 个编号章节与 secNo 的 8 个键一一对应',
    ['intro', 'itinerary', 'weather', 'route', 'safety', 'equipment', 'fee', 'signup']
      .every(k => ACT_WXML.indexOf('secNo.' + k) !== -1)
    && ACT_JS.indexOf("['peers',") === -1,
    ['intro', 'itinerary', 'weather', 'route', 'safety', 'equipment', 'fee', 'signup']
      .filter(k => ACT_WXML.indexOf('secNo.' + k) === -1))
  const peSlice = ACT_WXML.slice(ACT_WXML.indexOf('id="sec-peers"'), ACT_WXML.indexOf('id="sec-itinerary"'))
  check('同行人章节只有 kicker/title/sub，没有编号', peSlice.indexOf('<chapter') !== -1
    && peSlice.indexOf('no="') === -1, peSlice.slice(0, 120))
  check('天气章节 gap=8（卡内行距比默认更紧），其余章节用默认 12',
    (ACT_WXML.match(/gap="\{\{8\}\}"/g) || []).length === 1
    && /id="sec-weather"[\s\S]*?<chapter[^>]*gap="\{\{8\}\}"/.test(ACT_WXML))
  check('页面不再给简介写死 gap:0（间距交给 .stack/chapter）',
    ACT_WXML.indexOf('style="gap:0"') === -1)
}

section('10. 正文节奏：.stack-sections 统一章节间距，区块顺序固定')
{
  check('.stack-sections 作为正文唯一外层，出现一次',
    (ACT_WXML.match(/<view class="stack-sections">/g) || []).length === 1)
  const order = ['id="sec-intro"', 'id="sec-peers"', 'id="sec-itinerary"', 'id="sec-weather"',
    '<view id="meeting-block">', '<view id="sec-safety">', 'id="sec-equipment"', 'id="sec-fee"', 'id="sec-signup"']
  const idx = order.map(k => ACT_WXML.indexOf(k))
  check('章节顺序：简介 → 同行人 → 行程 → 天气 → 路线 → 安全 → 装备 → 费用 → 报名后',
    idx.every((v, i) => v !== -1 && (i === 0 || v > idx[i - 1])), idx)
  check('正文最后一个章节在页尾两行之前，页尾两行同属一个 .stack',
    idx[8] < ACT_WXML.indexOf('class="list-row" hover-class="button-hover" bindtap="onNotices"')
    && /<view wx:if="\{\{!isDraft\}\}" class="stack">/.test(ACT_WXML)
    && ACT_WXML.indexOf('bindtap="onNotices"') < ACT_WXML.indexOf('bindtap="goTasks"'))
  check('章节实心标题复用 .list-head__title（20/28/600），不再自造标题字号',
    ACT_WXML.indexOf('class="section-title"') !== -1  // 路线内「剖面」子块仍是次级标题
    && (ACT_WXML.match(/class="chapter-title"/g) || []).length === 0)
}

section('11. 行程合并：时间轴只属于行程章节，路线区只留指标/地图/剖面/上车点')
{
  const iItin = ACT_WXML.indexOf('id="sec-itinerary"')
  const iWeather = ACT_WXML.indexOf('id="sec-weather"')
  const iMeeting = ACT_WXML.indexOf('<view id="meeting-block">')
  const iSafety = ACT_WXML.indexOf('<view id="sec-safety">')
  const iTimeline = ACT_WXML.indexOf('class="timeline"')
  const iBasis = ACT_WXML.indexOf('scheduleBasis')
  check('时间轴与日程说明都在行程章节内（itinerary < timeline/basis < weather < route）',
    iItin !== -1 && iItin < iTimeline && iTimeline < iWeather
    && iItin < iBasis && iBasis < iWeather,
    { iItin, iTimeline, iBasis, iWeather, iMeeting })
  const routeSlice = ACT_WXML.slice(iMeeting, iSafety)
  check('路线区不再残留时间轴或日程说明',
    routeSlice.indexOf('timeline') === -1 && routeSlice.indexOf('scheduleBasis') === -1,
    { timeline: routeSlice.indexOf('timeline'), basis: routeSlice.indexOf('scheduleBasis') })
  const iIntro = ACT_WXML.indexOf('{{organizerIntro}}')
  check('行程章节内顺序：时间轴 → 日程说明 → 组织者说明（都在天气章节之前）',
    iIntro !== -1 && iTimeline < iBasis && iBasis < iIntro && iIntro < iWeather,
    { iTimeline, iBasis, iIntro, iWeather })
  const iStats = ACT_WXML.indexOf('class="act-route-stats"')
  const iNote = ACT_WXML.indexOf('act-route-stats-note')
  const iMap = ACT_WXML.indexOf('class="map-card"')
  const iProfile = ACT_WXML.indexOf('<route-profile')
  const iPickups = ACT_WXML.indexOf('wx:for="{{pickups}}"')
  check('路线区顺序：指标条 → 指标说明 → 地图 → 剖面 → 上车点',
    iStats !== -1 && iStats < iNote && iNote < iMap && iMap < iProfile && iProfile < iPickups,
    { iStats, iNote, iMap, iProfile, iPickups })
  check('路线区仍在同一章节内（指标/地图/剖面/上车点都在 meeting-block 到 safety 之间）',
    [iStats, iNote, iMap, iProfile, iPickups].every(i => i > iMeeting && i < iSafety))
  check('页面不再产 times 数组（时间锚点只由信息卡承载）',
    ACT_JS.indexOf('times') === -1 && ACT_WXML.indexOf('{{times') === -1)
  check('点击节点定位后会滚到路线章节（时间轴与地图不在同一屏）',
    /selector:\s*'#meeting-block'/.test(ACT_JS) && ACT_JS.indexOf('wx.pageScrollTo') !== -1)
}

section('12. 装备四列格与费用语义：文字始终可见，费用文案逐字不变')
{
  const eqSlice = ACT_WXML.slice(ACT_WXML.indexOf('id="sec-equipment"'), ACT_WXML.indexOf('id="sec-fee"'))
  const EQ_WXML = stripComments(read('components/equipment-grid/equipment-grid.wxml'))
  const EQ_WXSS = read('components/equipment-grid/equipment-grid.wxss')
  check('页面用 equipment-grid 承接 equipment/equipmentSuggested，且不再印 badge 列表',
    eqSlice.indexOf('<equipment-grid required="{{equipment}}" suggested="{{equipmentSuggested}}" />') !== -1
    && eqSlice.indexOf('badge neutral') === -1)
  const eqCfg = loadComponent(P('components/equipment-grid/equipment-grid.js'))
  check('equipment-grid 声明 apply-shared，属性只有 required/suggested', eqCfg.options
    && eqCfg.options.styleIsolation === 'apply-shared'
    && Object.keys(eqCfg.properties).sort().join(',') === 'required,suggested',
    Object.keys(eqCfg.properties))
  const self = { data: {}, setData(obj) { Object.assign(this.data, obj) } }
  eqCfg.observers['required, suggested'].call(self,
    ['  登山杖 ', '', null, '饮用水 2L', '登山杖', 12],
    ['备用袜', '  ', '防晒'])
  check('规范化：去空白、丢空项/非字符串；不去重、不排序、不改写原文',
    self.data.requiredItems.map(x => x.text).join('|') === '登山杖|饮用水 2L|登山杖'
    && self.data.suggestedItems.map(x => x.text).join('|') === '备用袜|防晒',
    self.data)
  check('每项带图标 key；「登山杖」认 poles、「饮用水」认 water',
    self.data.requiredItems[0].icon === 'poles' && self.data.requiredItems[1].icon === 'water',
    self.data.requiredItems)
  check('四列排布：item 宽 calc(25% - 6px)，list gap 10px 8px（4×宽 + 3×8 = 100%）',
    /\.eq-grid__item\s*\{[^}]*flex:\s*0 0 calc\(25% - 6px\)/.test(EQ_WXSS)
    && /\.eq-grid__list\s*\{[^}]*gap:\s*10px 8px/.test(EQ_WXSS))
  check('文字是常显节点：没有 display:none / 只留图标的写法，且允许长词断行',
    EQ_WXML.indexOf('class="eq-grid__text"') !== -1
    && /\.eq-grid__text\s*\{[^}]*overflow-wrap:\s*anywhere/.test(EQ_WXSS)
    && EQ_WXSS.indexOf('display: none') === -1)
  check('图标底座走 token（--radius-tag/--stone），不另造色值',
    /\.eq-grid__tile\s*\{[^}]*border-radius:\s*var\(--radius-tag\)/.test(EQ_WXSS)
    && /\.eq-grid__tile\s*\{[^}]*background:\s*var\(--stone\)/.test(EQ_WXSS))

  const feeSlice = ACT_WXML.slice(ACT_WXML.indexOf('id="sec-fee"'), ACT_WXML.indexOf('id="sec-signup"'))
  check('费用五个字段逐字沿用（summary/includes/excludes/note/cancellation）',
    ['{{feeSummary}}', '{{feeIncludes}}', '{{feeExcludes}}', '{{feeNote}}', '{{cancellationNote}}']
      .every(k => feeSlice.indexOf(k) !== -1)
    && feeSlice.indexOf('费用包含') !== -1 && feeSlice.indexOf('费用不含') !== -1)
  check('「不收款」说明全页只印一次', (ACT_WXML.match(/OurTrail 不收款，不处理支付或退款。/g) || []).length === 1)
  check('退出约定在费用说明之后（先讲含不含，再讲能不能退）',
    feeSlice.indexOf('{{feeNote}}') < feeSlice.indexOf('{{cancellationNote}}'))
}

section('13. 底部操作条（S3）：唯一出口、互斥链、留白同源')
{
  // 根类与底栏同一个开关：showSticky 决定「有没有底栏」，也决定「要不要 120px 页尾留白」。
  check('根节点按 showSticky 条件挂 .has-sticky',
    /<view class="page \{\{showSticky \? 'has-sticky' : ''\}\}">/.test(ACT_WXML))
  const stickyTags = ACT_WXML.match(/<view[^>]*class="sticky-action act-sticky"[^>]*>/g) || []
  check('全页只有一个 .sticky-action，且由 showSticky 控制', stickyTags.length === 1
    && stickyTags[0].indexOf('wx:if="{{showSticky}}"') !== -1, stickyTags)
  const iOverlay = ACT_WXML.indexOf('<overlay')
  check('顶部操作区已整块退场（overlay 之前的正文里没有 .form-actions）',
    ACT_WXML.slice(0, iOverlay).indexOf('class="form-actions"') === -1)
  const iSticky = ACT_WXML.indexOf('class="sticky-action act-sticky"')
  const iTasks = ACT_WXML.indexOf('bindtap="goTasks"')
  check('底栏在正文末尾（通知/协作任务之后）、overlay 之前',
    iTasks !== -1 && iSticky > iTasks && iSticky < iOverlay, { iTasks, iSticky, iOverlay })

  const stickySlice = ACT_WXML.slice(iSticky,
    ACT_WXML.indexOf('</view>', ACT_WXML.indexOf('nextActionLabel')) + '</view>'.length)
  const shareTag = (stickySlice.match(/<button[^>]*>/) || [''])[0]
  check('分享是 .button.secondary，原生 open-type=share，只在已发布的常态帧出现',
    shareTag.indexOf('class="button secondary act-sticky__share"') !== -1
    && shareTag.indexOf('open-type="share"') !== -1
    && shareTag.indexOf('wx:if="{{!isDraft && !justPublished}}"') !== -1, shareTag)
  const chain = [
    'wx:if="{{isOwner}}"',
    'wx:elif="{{canSubmit}}"',
    'wx:elif="{{canSelfSheet}}"',
    "wx:elif=\"{{nextActionTarget === 'meeting'}}\"",
  ]
  const chainIdx = chain.map(k => stickySlice.indexOf(k))
  check('主操作链 isOwner → canSubmit → canSelfSheet → meeting 顺序固定且互斥',
    chainIdx.every((v, i) => v !== -1 && (i === 0 || v > chainIdx[i - 1])), chainIdx)
  check('只有第一支是 wx:if，后三支都是 wx:elif',
    (stickySlice.match(/wx:if="\{\{isOwner\}\}"/g) || []).length === 1
    && (stickySlice.match(/wx:elif=/g) || []).length === 3)
  check('底栏沿用原文案与 handler（返回编辑与发布/进入工作台/填写报名资料/selfButton/nextActionLabel）',
    stickySlice.indexOf("{{isDraft ? '返回编辑与发布' : '进入工作台'}}") !== -1
    && stickySlice.indexOf('bindtap="onWorkspace"') !== -1
    && stickySlice.indexOf('bindtap="onSignup"') !== -1
    && stickySlice.indexOf('{{selfButton}}') !== -1
    && stickySlice.indexOf('bindtap="onSelfSheet"') !== -1
    && stickySlice.indexOf('{{nextActionLabel}}') !== -1
    && stickySlice.indexOf('bindtap="onNextAction"') !== -1)
  // 底栏只做导航/打开弹层；所有写命令都在弹层里（那里才有 busy 三层禁用）。
  const WRITE_HANDLERS = ['onCheckin', 'onHome', 'onNode', 'onPosReport', 'onPosRevoke', 'onIncident', 'onCancelRow', 'onEditRow', 'onSensitive']
  check('底栏没有写操作 → 不做 busy 禁用（避免留下「点了没反应」的死按钮）',
    WRITE_HANDLERS.every(h => stickySlice.indexOf('bindtap="' + h + '"') === -1)
    && stickySlice.indexOf('disabled') === -1,
    WRITE_HANDLERS.filter(h => stickySlice.indexOf('bindtap="' + h + '"') !== -1))

  // 开关来源：justPublished 只在 owner 首帧吞掉底栏；非 owner 手工加 published=1 不生效。
  check('showSticky 初值 false（首帧渲染不发散）', /showSticky:\s*false/.test(ACT_JS))
  check('showSticky 与 justPublished 同源：!(this.justPublished && isOwnerReal)',
    /showSticky:\s*!\(this\.justPublished && isOwnerReal\)/.test(ACT_JS))
  check('庆祝帧的数据口径同样要求 owner',
    /justPublished:\s*!!\(this\.justPublished && isOwnerReal\)/.test(ACT_JS))
  // 零丢失：庆祝帧没有底栏，但改前顶部那枚「进入工作台」必须仍在成功卡里找得到，
  // 且分享保持唯一 primary（工作台只能是 .button.text）。
  const successSlice = ACT_WXML.slice(ACT_WXML.indexOf('justPublished && isOwner'), ACT_WXML.indexOf('class="act-top"'))
  check('庆祝帧保留「进入工作台」文字次操作，分享仍是唯一 primary',
    successSlice.indexOf('bindtap="onWorkspace"') !== -1
    && successSlice.indexOf('class="button text block"') !== -1
    && (successSlice.match(/class="button primary/g) || []).length === 1)

  // 样式：全局 .sticky-action 允许 wrap 且 .button 平分；本页必须收敛成一行，分享不抢宽度。
  check('.act-sticky 覆盖全局 wrap，主按钮允许收缩（窄屏不让底栏长成两行）',
    /\.act-sticky\s*\{[^}]*flex-wrap:\s*nowrap/.test(ACT_WXSS)
    && /\.sticky-action\.act-sticky \.button\s*\{[^}]*min-width:\s*0/.test(ACT_WXSS))
  // 原生 <button> 默认 width:184px，只收 flex 不收 width 时它仍占 184（S3 真机实测：
  // 390px 屏主按钮只剩 154，「查看集合与出行安排」折两行）。
  check('分享收回内容宽（flex 与原生 width:184 都要收）',
    /\.sticky-action \.button\.act-sticky__share\s*\{[^}]*flex:\s*0 0 auto/.test(ACT_WXSS)
    && /\.sticky-action \.button\.act-sticky__share\s*\{[^}]*width:\s*auto/.test(ACT_WXSS))
  const stickyCss = ACT_WXSS.slice(ACT_WXSS.indexOf('.act-sticky'))
  check('底栏自造色值数为 0（只用全局类与 token）',
    ACT_WXSS.indexOf('.act-sticky') !== -1 && stickyCss.indexOf('#') === -1)

  // 弹层必须盖住底栏：写操作弹层打开时不能被底栏压住/透点。
  const zOf = (css, sel) => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')
    for (const r of rules) {
      const at = r.indexOf('{')
      if (at === -1) continue
      if (r.slice(0, at).split(',').map(s => s.trim()).indexOf(sel) === -1) continue
      const m = r.slice(at).match(/z-index:\s*(\d+)/)
      if (m) return Number(m[1])
    }
    return null
  }
  const zSticky = zOf(APP_WXSS, '.sticky-action')
  const zOverlay = zOf(OVERLAY_WXSS, '.overlay-root')
  check('overlay（z 200）高于底栏（z 50）：弹层不被底栏穿透',
    zSticky !== null && zOverlay !== null && zOverlay > zSticky, { zSticky, zOverlay })

  // 自定义导航裁决：不做。保留原生导航（状态栏安全区 + 胶囊避让需要真机证据）。
  check('未启用自定义导航（activity.json / app.json 都没有 navigationStyle: custom）',
    ACT_JSON.navigationStyle === undefined && APP_JSON.navigationStyle !== 'custom',
    { activity: ACT_JSON.navigationStyle, app: APP_JSON.navigationStyle })
}

console.log('')
console.log('passed=' + passed + ' failed=' + failed)
process.exit(failed ? 1 : 0)
