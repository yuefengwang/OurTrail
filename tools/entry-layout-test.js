// 活动入口 L2/L3：结构只作 E1；真实组件方法不等于像素/真机验证。
// 不模拟 WXML 渲染；解析标签仅核对接线、祖先关系、信息槽位。
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, 'miniprogram', rel), 'utf8')
let passed = 0, failed = 0
function check(name, ok) {
  if (ok) { passed++; console.log('  PASS ' + name) }
  else { failed++; console.error('  FAIL ' + name) }
}
function tree(source) {
  const root = { tag: 'root', attrs: {}, children: [] }
  const stack = [root]
  const tags = source.replace(/<!--[\s\S]*?-->/g, '').match(/<\/?[\w-]+\b(?:[^>"']|"[^"]*"|'[^']*')*>/g) || []
  for (const raw of tags) {
    if (/^<\//.test(raw)) { stack.pop(); continue }
    const attrs = {}
    raw.replace(/([\w:-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return _ })
    const n = { tag: raw.match(/^<([\w-]+)/)[1], attrs, children: [] }
    stack[stack.length - 1].children.push(n)
    if (!/\/>$/.test(raw)) stack.push(n)
  }
  return root
}
function nodes(n) { return [n].concat(...n.children.map(nodes)) }
const hasClass = (n, c) => (n.attrs.class || '').split(/\s+/).includes(c)
const cls = (n, c) => nodes(n).find(x => hasClass(x, c))
const card = tree(read('components/activity-card/activity-card.wxml'))
const home = tree(read('pages/home/home.wxml'))
const discover = tree(read('pages/discover/discover.wxml'))
const cardCss = read('components/activity-card/activity-card.wxss')
const homeCss = read('pages/home/home.wxss')
const discoverCss = read('pages/discover/discover.wxss')
const cardSource = read('components/activity-card/activity-card.wxml').replace(/<!--[\s\S]*?-->/g, '')
const discoverSource = read('pages/discover/discover.wxml').replace(/<!--[\s\S]*?-->/g, '')
const homeSource = read('pages/home/home.wxml').replace(/<!--[\s\S]*?-->/g, '')

console.log('== E1 结构、接线与 token（不是 UI PASS） ==')
check('保留 article 根与原 open 入口', card.children.length === 1 && card.children[0].tag === 'article' && card.children[0].attrs.bindtap === 'onTap')
const thumb = cls(card, 'activity-card__thumb')
const heading = cls(card, 'activity-card__heading')
const head = cls(card, 'activity-card__head')
const featuredBody = cls(card, 'activity-card__cover-body')
check('compact 缩略图与标题列在同一个横向头部', !!head && !!thumb && !!heading && head.children.includes(thumb) && head.children.includes(heading))
check('compact 才挂缩略图；featured 分支自己就是场景封面、没有缩略图', !!thumb && thumb.attrs['wx:if'] === '{{compact}}' && !!featuredBody && !nodes(featuredBody).some(n => hasClass(n, 'activity-card__thumb')))
check('右侧列包含完整标题、日期和状态槽', !!heading && !!cls(heading, 'activity-card__title') && nodes(heading).some(n => n.attrs.id === 'date') && nodes(heading).some(n => n.attrs.id === 'status'))
check('状态不在任何图片容器内，图片失败不吞状态', nodes(card).some(n => n.attrs.id === 'status') && nodes(card).filter(n => hasClass(n, 'activity-card__media') || hasClass(n, 'activity-card__thumb')).every(n => !nodes(n).some(x => x.attrs.id === 'status')))
check('路线名单独插值，chips 由页面派生传入（模板不再自己拼路线事实）', /\{\{routeName\}\}/.test(cardSource) && !/routeName\s*\|\|/.test(cardSource) && /wx:for="\{\{chips\}\}"/.test(cardSource))
check('日期、倒计时、人数、归属与相位徽章各有一槽', /\{\{date\}\}/.test(cardSource) && /\bwhen\b/.test(cardSource) && /\{\{people\}\}/.test(cardSource) && /\{\{roleNote\}\}/.test(cardSource) && /\{\{badge\}\}/.test(cardSource))
const collabs = nodes(card).filter(n => n.attrs.catchtap === 'onCollab')
check('协作独立 catchtap，携带角色键且不冒泡为 open', collabs.length > 0 && collabs.every(n => n.attrs['data-key'] === '{{item.key}}' && !n.attrs.bindtap && n.attrs['hover-class'] === 'button-hover'))
check('首页默认紧凑卡保留64px缩略图，事实行可换行而非裁切', /\.activity-card__thumb\s*\{[^}]*width:\s*64px/.test(cardCss) && /\.activity-card__head\s*\{[^}]*display:\s*flex/.test(cardCss) && /\.activity-card__heading\s*\{[^}]*min-width:\s*0/.test(cardCss) && /\.activity-card__chips\s*\{[^}]*flex-wrap:\s*wrap/.test(cardCss))
check('发现行封面加宽且高度随内容伸展', /\.activity-card--flat \.activity-card__thumb\s*\{[^}]*flex-basis:\s*104px[^}]*width:\s*104px[^}]*height:\s*auto[^}]*min-height:\s*128px/.test(cardCss) && /\.activity-card--flat \.activity-card__head\s*\{[^}]*align-items:\s*stretch/.test(cardCss))
check('发现行封面铺满容器，不让图片默认高度撑高列表', /\.activity-card--flat \.activity-card__thumb \.activity-card__cover\s*\{[^}]*position:\s*absolute[^}]*top:\s*0[^}]*left:\s*0/.test(cardCss) && /\.activity-card__thumb \.activity-card__cover\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/.test(cardCss))
check('发现行移除横向重复内边距但保留行间呼吸空间', /\.activity-card\.activity-card--flat\s*\{[^}]*padding:\s*16px 0/.test(cardCss))
check('图片全失败时仍收起封面，不留下空的图列', /\.activity-card--compact\.cover-failed \.activity-card__thumb\s*\{[^}]*display:\s*none/.test(cardCss))
check('标题不截断；新增布局不引入 line-clamp/ellipsis', !/line-clamp|text-overflow:\s*ellipsis/.test(cardCss + homeCss + discoverCss))
check('协作触控目标读 token，非硬编码 44', /\.collab-leaf\s*\{[^}]*min-height:\s*var\(--touch-target\)/.test(cardCss))
const homeCards = nodes(home).filter(n => n.tag === 'activity-card')
check('首页一个 cards 列表，只有非 featured 紧凑化', homeCards.length === 1 && homeCards[0].attrs['wx:for'] === '{{cards}}' && homeCards[0].attrs.compact === '{{!item.featured}}')
check('首页原 open/collab 事件仍在', homeCards[0].attrs['bind:open'] === 'onOpenCard' && homeCards[0].attrs['bind:collab'] === 'onCardCollab')
// style-B（2026-10-26）：页标题让位给品牌栏。「下一次同行」卡 + 一行动作接替原来的标题块。
const brand = nodes(home).find(n => n.tag === 'brand-header')
const homeJson = JSON.parse(read('pages/home/home.json'))
check('首页挂品牌栏并走自定义导航（原生标题栏不再出现，身份由词标承担）',
  !!brand && homeJson.navigationStyle === 'custom' && homeJson.usingComponents['brand-header'] === '/components/brand-header/brand-header')
const nextUp = nodes(home).find(n => n.tag === 'next-up-card')
check('首屏先给「下一次同行」：整卡进详情、空态卡内发起；页面不再有页标题块',
  !!nextUp && nextUp.attrs['bind:open'] === 'onOpenCard' && nextUp.attrs['bind:create'] === 'onNew' &&
  nextUp.attrs['data-id'] === '{{nextUp.id}}' && !homeSource.includes('eyebrow') && !homeSource.includes('page-title') &&
  homeJson.usingComponents['next-up-card'] === '/components/next-up-card/next-up-card')
const header = cls(home, 'home-actions')
check('首页动作行独立成行，不把全部动作挤进标题行',
  !!header && !!nodes(header).find(n => n.attrs.bindtap === 'onGoDiscover'))
const actions = header ? nodes(header).filter(n => hasClass(n, 'button')) : []
const primary = actions.filter(n => hasClass(n, 'primary'))
check('发起为唯一主按钮，发现次级；原 handler 与文字契约保持；没有未来活动时主按钮随状态卡一起消失',
  primary.length === 1 && primary[0].attrs['wx:if'] === '{{nextUp}}' &&
  actions.some(n => n.attrs.bindtap === 'onNew' && hasClass(n, 'primary')) &&
  actions.some(n => n.attrs.bindtap === 'onGoDiscover' && !hasClass(n, 'primary')) &&
  homeSource.includes('发起活动') && homeSource.includes('发现活动'))
check('四档筛选保持，移除无效 with-tabbar 开关', ['mine', 'recent', 'finished', 'collab'].every(v => homeSource.includes('data-value="' + v + '"')) && !homeSource.includes('with-tabbar'))
const inviteSource = read('components/next-up-card/next-up-card.wxml')
const invite = cls(tree(inviteSource), 'next-up-card--invite')
check('无活动与仅有历史/草稿由真实 hasAny 区分', nextUp.attrs['has-activities'] === '{{hasAny}}' && cls(invite, 'next-up-card__invite-media').attrs['wx:if'] === '{{!hasActivities}}')
check('空首页发起和发现成组，外部动作行不重复', header.attrs['wx:if'] === '{{nextUp}}' && nextUp.attrs['bind:discover'] === 'onGoDiscover' && nodes(invite).filter(node => hasClass(node, 'primary')).length === 1 && nodes(invite).some(node => node.attrs.bindtap === 'onDiscover'))
check('空首页说明保存后的去向，照片标明氛围用途', inviteSource.includes('参与或发起后，活动会显示在这里') && inviteSource.includes('场景氛围图') && !inviteSource.includes('推荐活动'))
check('空首页图片失败隐藏图片，不隐藏动作或标题', nodes(invite).some(node => node.tag === 'image' && node.attrs['wx:if'] === '{{!inviteCoverFailed}}' && node.attrs.binderror === 'onInviteCoverError') && !cls(invite, 'next-up-card__invite-content').attrs['wx:if'])
const dc = nodes(discover).filter(n => n.tag === 'activity-card')
check('发现列表和地图选中卡同为 compact + flat', dc.length === 2 && dc.every(n => n.attrs.compact === '{{true}}' && n.attrs.flat === '{{true}}' && n.attrs.featured === '{{false}}'))
const toolbar = cls(discover, 'discover-toolbar')
check('结果工具组包含排序/筛选、视图切换和结果计数', !!toolbar && !!cls(toolbar, 'filter-row') && !!cls(toolbar, 'discover-views') && !!cls(toolbar, 'result-count'))
check('搜索紧随头部，其后工具组与完整低权重提示，再到结果', discoverSource.indexOf('class="searchbar"') < discoverSource.indexOf('discover-toolbar') && discoverSource.indexOf('discover-toolbar') < discoverSource.indexOf('discover-note') && discoverSource.indexOf('discover-note') < discoverSource.indexOf('<activity-card'))
const note = cls(discover, 'discover-note')
check('提示不再是 callout，保留完整原话与可见分支', !!note && !hasClass(note, 'callout') && !note.attrs['wx:if'] && discoverSource.includes('这些活动由个人发起') && discoverSource.includes('平台尚未做领队资质认证。路线强度、风险与装备要求以活动说明为准，报名前请自行评估是否适合自己。'))
check('显示可定位数/本次结果，不称附近', discoverSource.includes('{{map.markers.length}}') && discoverSource.includes('可定位') && discoverSource.includes('本次结果') && !discoverSource.includes('附近'))
const sheet = nodes(discover).find(n => n.tag === 'overlay')
check('筛选 sheet 所有选择值只绑定 draftFilters', !!sheet && nodes(sheet).filter(n => n.tag === 'picker').length === 3 && !/\bfilters\./.test(JSON.stringify(sheet)) && /draftFilters/.test(JSON.stringify(sheet)))
const tokens = new Set((read('app.wxss').match(/--[\w-]+(?=\s*:)/g) || []))
for (const [name, css] of [['card', cardCss], ['home', homeCss], ['discover', discoverCss]]) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const references = Array.from(clean.matchAll(/var\(\s*(--[\w-]+)/g), m => m[1])
  check(name + ' 样式只引用既有色 token，零字面量副本', !/#[\da-f]{3,8}\b|rgba?\(|linear-gradient\(/i.test(clean) && references.every(t => tokens.has(t)))
}

console.log('== 真实 Component 方法：失败兜底、事件与兼容默认值 ==')
let config
global.Component = c => { config = c }
require(path.join(ROOT, 'miniprogram/components/activity-card/activity-card.js'))
check('compact 默认 false，不改变旧消费者的选择', config.properties.compact && config.properties.compact.type === Boolean && config.properties.compact.value === false)
check('全局类 opt-in 保留', config.options.styleIsolation === 'apply-shared')
for (const variant of [{ featured: true, compact: false }, { featured: false, compact: false }, { featured: false, compact: true }]) {
  const events = []
  const c = { data: Object.assign({}, config.data, variant, { title: '完整标题'.repeat(30), date: '11月1日', status: '状态事实', when: '3天', routeName: '路线名', meta: '补充事实', info: '待审核 7 人', metrics: [{ key: 'ascent', value: '900' }], collab: [{ key: 'staff', label: '协作' }] }),
    setData(patch) { Object.assign(this.data, patch) }, triggerEvent(type, detail) { events.push({ type, detail }) } }
  Object.assign(c, config.methods)
  config.observers['cover, activityId'].call(c, 'broken-cover', 'a1')
  const textBefore = JSON.stringify(['title', 'date', 'status', 'when', 'routeName', 'meta', 'info', 'metrics', 'collab'].map(k => c.data[k]))
  c.onCoverError()
  check(JSON.stringify(variant) + ' 实拍失败先回退氛围图', !c.data.coverFailed && c.data.coverSrc === c.data.coverFallback)
  c.onCoverError()
  check(JSON.stringify(variant) + ' 图片全失败仍保留所有文字/指标/协作属性', c.data.coverFailed && JSON.stringify(['title', 'date', 'status', 'when', 'routeName', 'meta', 'info', 'metrics', 'collab'].map(k => c.data[k])) === textBefore)
  c.onCollab({ currentTarget: { dataset: { key: 'staff' } } })
  c.onTap()
  check(JSON.stringify(variant) + ' 原 collab/open 事件不变', JSON.stringify(events) === JSON.stringify([{ type: 'collab', detail: { key: 'staff' } }, { type: 'open' }]))
  config.observers['cover, activityId'].call(c, 'new-cover', 'a2')
  check(JSON.stringify(variant) + ' 换活动/封面复位失败态', !c.data.coverFailed && c.data.coverSrc === 'new-cover')
}
require(path.join(ROOT, 'miniprogram/components/next-up-card/next-up-card.js'))
const inviteEvents = []
const inviteComponent = { data: Object.assign({}, config.data, { empty: true, hasActivities: false }), setData(patch) { Object.assign(this.data, patch) }, triggerEvent(type) { inviteEvents.push(type) } }
Object.assign(inviteComponent, config.methods)
inviteComponent.onInviteCoverError()
check('空首页独立图片兜底不影响活动封面状态', inviteComponent.data.inviteCoverFailed && !inviteComponent.data.coverFailed)
inviteComponent.onCreate()
inviteComponent.onDiscover()
inviteComponent.onOpen()
check('空首页两入口发送各自事件，不打开不存在的活动', inviteEvents.join(',') === 'create,discover')
console.log('\npassed=' + passed + ' failed=' + failed + ' (structure=E1, UI=NOT_RUN)')
process.exit(failed ? 1 : 0)
