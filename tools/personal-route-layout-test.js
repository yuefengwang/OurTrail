// 路线/个人中心 L2-L3：模板结构 + 真 Page；仅 stub API 与 wx 边界，不证明像素。
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const api = require('../miniprogram/utils/api')
let passed = 0, failed = 0
function check(name, ok, extra) {
  if (ok) { passed++; console.log('  PASS ' + name) }
  else { failed++; console.error('  FAIL ' + name + (extra ? ' — ' + extra : '')) }
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
  // style-B 批次二 b（2026-10-26）：原生导航已印「路线库」，页头不再自报同一个名字，
  // 身份收敛成一句陈述；主行动按 notices / weather-hub 口径落到页头下一条全宽实底按钮
  // （390 下陈述 + 右侧按钮实测换行，约 370 > 358，所以不留 inline 变体）。
  const newBtn = handler(routes, 'onNewRoute')
  const siblings = newBtn ? newBtn.parent.children : []
  const head = newBtn ? siblings[siblings.indexOf(newBtn) - 1] : null
  const headTitle = head && head.children.find(n => cls(n, 'list-head__title'))
  const headText = headTitle ? (routes.src.slice(headTitle.at).match(/^<text[^>]*>([^<]*)<\/text>/) || [])[1] : ''
  check('路线库页头：一句 20px 陈述独占一行，随后是全宽 block 主按钮，不再有同名标题层/眉题/副标题',
    !!head && !!headTitle && cls(head, 'section-head')
    && head.children.filter(n => cls(n, 'list-head__title')).length === 1
    && !routes.nodes.some(n => ancestors(n).includes(head) && (cls(n, 'kicker') || cls(n, 'section-sub')))
    && headText !== '路线库' && headText !== ''
    && cls(newBtn, 'button') && cls(newBtn, 'primary') && cls(newBtn, 'block'))
  check('路线行：保存时间并入标题下的元信息簇，行尾只剩风险/引用一行',
    (routes.src.match(/\{\{item\.riskText\}\} · \{\{item\.refText\}\}<\/text>\s*<\/view>/g) || []).length === 2
    && (routes.src.match(/<text class="small muted">\{\{item\.updatedText\}\}<\/text>\s*<\/view>/g) || []).length === 2)
  check('路线详情彻底移除假封面与脚注', !/hero-cover|photo-note|onCoverError|氛围图/.test(route.src))
  const ordered = ['海拔怎么走', '路线节点', '分段天气', '风险提示', '共享给协作者', '被这些活动使用', '管理这条路线'].map(title => chapter(route, title))
  const map = route.nodes.find(n => n.tag === 'map')
  check('主视觉地图在剖面→节点→天气→风险→共享→引用→管理之前', !!map && ordered.every((n, i) => n && n.at > (i ? ordered[i - 1].at : map.at)))
  check('无地图时有诚实空态与拥有者补坐标入口', route.nodes.some(n => n.tag === 'status-panel' && n.attrs.title === '暂时没有节点地图') && route.src.includes('补充节点坐标') && route.src.includes('联系路线拥有者'))
  // F3：来源是眉题、标题领起；难度/权限/保存时间在标题下同一元信息簇，保存时间不再独立成行。
  const overview = route.nodes.find(n => cls(n, 'route-overview'))
  const oKicker = overview && route.nodes.find(n => cls(n, 'kicker') && ancestors(n).includes(overview))
  const oTitle = overview && route.nodes.find(n => cls(n, 'list-head__title') && ancestors(n).includes(overview))
  const oFacts = overview && route.nodes.find(n => cls(n, 'route-facts') && ancestors(n).includes(overview))
  const updAt = route.src.indexOf('{{route.updatedText}}')
  check('路线详情：眉题(来源) → 标题 → 元信息（含保存时间）→ 指标，保存时间不再独立成行',
    !!overview && !!oKicker && !!oTitle && !!oFacts && oKicker.at < oTitle.at
    && oTitle.at < updAt && updAt < oFacts.at
    && !/<\/view>\s*<text class="small muted">\{\{route\.updatedText\}\}/.test(route.src))
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
  /* 2026-10-29 山野档案 v3：身份卡与履历栏仍是同级事实（各占一张卡，不套娃）；
     类名从 profile-identity/profile-stats 换成 ident-card/trail-log，判据跟着结构走，
     保护的是「身份可编辑、统计只读、两者不互相包含」这条语义。 */
  const identity = me.nodes.find(n => cls(n, 'ident-card') && !cls(n, 'ident-card--gate'))
  const ledger = me.nodes.find(n => cls(n, 'trail-log'))
  check('身份卡与履历栏是同级事实（不再套进同一张卡）',
    !!identity && !!ledger && identity.parent === ledger.parent && !ancestors(ledger).includes(identity))
  check('身份区保留 nickname 直接编辑及头像按钮', !!identity && me.nodes.some(n => ancestors(n).includes(identity) && n.attrs.type === 'nickname' && n.attrs.bindblur === 'onBlurSave') && me.nodes.some(n => ancestors(n).includes(identity) && n.attrs['open-type'] === 'chooseAvatar'))
  check('自动保存说明与未激活状态显式可见（说明可在资料编辑面内）', /修改后自动保存/.test(me.src) && /!activated/.test(me.src))
  const nextTrip = me.nodes.find(n => cls(n, 'next-trip'))
  const routesEntry = handler(me, 'onOpenRoutes')
  check('路线库是独立工具入口，不再混进「下一程」卡', !!nextTrip && !!routesEntry && !ancestors(routesEntry).includes(nextTrip))
  check('安全卡 / 同行人条 / 隐私入口始终存在',
    ['safety-card', 'companions-strip'].every(c => { const n = me.nodes.find(x => cls(x, c)); return n && !n.attrs['wx:if'] })
    && !!handler(me, 'onOpenPrivacy'))
  check('电话仍遮罩；代报与位置权限边界仍可见', me.src.includes('tools.maskPhone(person.phone)') && me.src.includes('tools.maskPhone(person.emergency.phone)') && me.src.includes('保存条目不等于代办授权') && me.src.includes('不会后台追踪') && me.src.includes('撤回后本次不再共享'))
  check('十个资料/危险操作弹层全部保留', me.nodes.filter(n => n.tag === 'overlay').length === 10)
  check('本机草稿与资料编辑入口全部保留', ['onSaveDraftNow', 'onAskDiscard', 'onOpenProfile'].every(name => !!handler(me, name)))
  check('tab 页底部 calc 不变', read('miniprogram/pages/me/me.wxss').includes('padding-bottom: calc(32px + 84px + env(safe-area-inset-bottom))'))
  /* 5a（2026-10-26 style-B）：全站「人行」只有一个出处——<person-row>（44px 头像 / 16·600 姓名 /
     状态徽标 / 副行 / 操作插槽）。activity·vehicle·roster-panel·field-panel 都在用，常用同行人是
     最后一个例外（私有 36px 小头像 + 15px 无源字阶）。下面三条钉的是「不该存在的依赖」
     （AGENTS.md 铁律 30②：查依赖存在性的静态门不会因合法重构假红），不是某一种写法：
     ① 组件在用且操作仍在其插槽内；② 个人页不再自己定义第二套头像尺寸；③ 行卡内边距只有 app.wxss 一处。 */
  const compRow = me.nodes.find(n => n.tag === 'person-row')
  check('常用同行人改用共享 <person-row>，编辑与移除仍在它的插槽内', !!compRow
    && compRow.attrs['wx:for'] === '{{companions}}' && compRow.attrs['wx:key'] === 'id'
    && compRow.attrs.name === '{{item.name}}' && compRow.attrs.avatar === '{{item.avatar}}'
    && ['onEditCompanion', 'onRemoveAsk'].every(name => {
      const b = me.nodes.find(n => n.attrs.bindtap === name)
      return !!b && ancestors(b).includes(compRow)
    }))
  const stripCss = s => s.replace(/\/\*[\s\S]*?\*\//g, '')
  const meCss = stripCss(read('miniprogram/pages/me/me.wxss'))
  check('个人页不再自定义第二套人行头像尺寸（36px 的 .sm 变体与 15px 无源字阶已删）',
    !/\.avatar-img\.sm|\.avatar-fallback\.sm-text/.test(meCss) && !/font-size:\s*15px/.test(meCss))
  check('行卡内边距收进 app.wxss 的 .card.rows，me/editor 都不再抄内联 padding',
    /\.card\.rows\s*\{\s*padding:\s*4px 16px/.test(read('miniprogram/app.wxss'))
    && ['me', 'editor'].every(p => !/padding:\s*4px 16px/.test(read('miniprogram/pages/' + p + '/' + p + '.wxml'))))
  // 棘轮（与 b4-e05 的 INLINE_STYLE_BASELINE 同族）：内联 style 只许变少，不许变大。14→11 是 5a 实测。
  check('个人页内联 style 数不高于 5a 基线 11（只许变少）',
    (me.src.match(/style="/g) || []).length <= 11)

  /* 2026-10-29 山野档案 v3：把原型的四块承重结构钉住，防止下次改文案时悄悄改掉版式。 */
  check('头图 / 头像 / 下一程封面按原型尺寸（148 / 72 / 82）',
    /\.me-cover\s*\{[^}]*height:\s*148px/.test(meCss)
    && /\.avatar\s*\{[^}]*width:\s*72px/.test(meCss)
    && /\.next-photo\s*\{[^}]*width:\s*82px/.test(meCss))
  check('履历四等分 / 安全卡三行 / 同行人胶囊横滑',
    me.nodes.filter(n => cls(n, 'trail-log__item')).length === 4
    && me.nodes.filter(n => cls(n, 'safety-row') && ancestors(n).some(a => cls(a, 'safety-card'))).length === 3
    && me.nodes.some(n => n.tag === 'scroll-view' && cls(n, 'companions-scroll')))
  check('页面 WXSS 不发明色值（颜色一律 var(--token)，无 #hex / rgba）',
    (meCss.match(/#[0-9a-fA-F]{3,8}/g) || []).length === 0 && !/rgba?\(/.test(meCss))

  /* 5b（2026-10-26 style-B）：路线四页（routes / route / route-edit / weather-chart）没有逐屏板，
     口径与 5a 相同——只收"重复出处"，不改结构。三条真出处问题：
     ① 紧凑指标（26px 大字在四列下会压邻列）曾在 routes 与 route **各存一份逐字相同**的规则，
        与 `.card-label` 那个"唯一出处写在某页 wxss、别页同名类命不中"的事故同族 ⇒ 收进 app.wxss 的 `.metrics.compact`；
     ② `.route-meta { gap: 8px }` 也在两页各存一份，而 `app.wxss:117` 的 `.cluster` 缺省 gap **就是 8px**
        ⇒ 这两条是把同一句话抄了两遍的死覆盖，随使用点一起删；
     ③ weather-chart 的 `.seg` 触点曾写死 44px，绕过了 `--touch-target`。 */
  const app = read('miniprogram/app.wxss')
  const routesCss = stripCss(read('miniprogram/pages/routes/routes.wxss'))
  const routeCss = stripCss(read('miniprogram/pages/route/route.wxss'))
  check('紧凑指标只有 app.wxss 一个出处；两页不得再各抄一份字号/行距/字距',
    /\.metrics\.compact \.metric \.metric-value\s*\{[^}]*font-size:\s*var\(--text-title\)[^}]*line-height:\s*24px[^}]*letter-spacing:\s*0/.test(app)
    && /class="[^"]*\bmetrics\b[^"]*\bcompact\b/.test(routes.src) && /class="[^"]*\bmetrics\b[^"]*\bcompact\b/.test(route.src)
    && !/\.metric-value/.test(routesCss) && !/\.metric-value/.test(routeCss))
  check('与 .cluster 缺省同值的空覆盖 .route-meta 已从两页的定义与模板里一起消失',
    !/\.route-meta/.test(routesCss) && !/\.route-meta/.test(routeCss)
    && !/route-meta/.test(routes.src) && !/route-meta/.test(route.src)
    && /\.cluster\s*\{[^}]*gap:\s*8px/.test(app))
  check('全图页的可点档位下限引用 --touch-target，不写死 44px',
    /\.fc-modes \.seg\s*\{[^}]*min-height:\s*var\(--touch-target\)/.test(read('miniprogram/pages/weather-chart/weather-chart.wxss')))
  // 内联 style 棘轮：routes 与 weather-chart 本来就没有，必须保持为 0；其余页只许变少。
  // 基线是 5b 实测（routes 0 / chart 0 / route 10 / route-edit 17 / editor 99 / signup 17）。
  check('六页内联 style 不高于 5b 基线（routes 0 / weather-chart 0 / route 10 / route-edit 17 / editor 99 / signup 17）',
    (routes.src.match(/style="/g) || []).length === 0
    && (read('miniprogram/pages/weather-chart/weather-chart.wxml').match(/style="/g) || []).length === 0
    && (route.src.match(/style="/g) || []).length <= 10
    && (read('miniprogram/pages/route-edit/route-edit.wxml').match(/style="/g) || []).length <= 17
    && (read('miniprogram/pages/editor/editor.wxml').match(/style="/g) || []).length <= 99
    && (read('miniprogram/pages/signup/signup.wxml').match(/style="/g) || []).length <= 17)
  /* 5b 第二处真问题：`style="font-weight:600;"` 的行内主标题曾在 route / route-edit / editor 抄了 12 份，
     而 M-16 的 overflow-wrap:anywhere 只写在 route 那一页的 `.route-node-name` 里——
     同一行的名称在编辑器侧没有断词保护，一个 80 字的无空格拉丁串就会把整行撑破。
     现在字重与断词一起收进 app.wxss 的 `.row-title`（它们本是同一个决定的两半），页面只写类名。 */
  check('行内主标题走 app.wxss 的 .row-title（字重与 overflow-wrap 同处），四页不再内联抄字重',
    /\.row-title\s*\{[^}]*font-weight:\s*600[^}]*overflow-wrap:\s*anywhere/.test(app)
    && ['route', 'route-edit', 'editor', 'signup', 'lab'].every(p => !/style="font-weight:600;"/.test(read('miniprogram/pages/' + p + '/' + p + '.wxml')))
    && ['route', 'route-edit', 'editor', 'signup', 'lab'].every(p => /class="row-title/.test(read('miniprogram/pages/' + p + '/' + p + '.wxml'))))
  /* 5c：把这条判据从"我改过的页"升成**全仓**——独立的 `style="font-weight:600;"` 就是"行内主标题抄字重"
     这一形态本身，任何页出现都该被看见。命中数按 wxml 全集算（43 个模板宿主，页面 + 组件），
     并且**把剩下的两处内联字重逐条点名**：判据只咬独立形态，两处复合内联是有意保留的，
     所以这里不是"0 命中所以全绿"，而是"独立形态 0 + 复合形态恰好这 2 处"。
     · editor.wxml:638 是带语义色的**文字动作**（完成/编辑），不是行标题；
     · activity.wxml:166 是同族行标题，但 activity 属已验收的 Slice 2/3 写集，登记为后续项不重开。
     新增第三处复合内联字重 ⇒ 这条会红（名单是逐条比对的，不是数个数 ≤ 2）。 */
  const INLINE_WEIGHT_COMPOUND = [
    'miniprogram/pages/editor/editor.wxml',
    'miniprogram/pages/activity/activity.wxml',
  ]
  const inlineWeightHits = []
  const inlineWeightCompound = []
  fs.readdirSync(path.join(ROOT, 'miniprogram/pages')).forEach(dir => {
    const f = ['miniprogram','pages',dir,dir+'.wxml'].join('/')
    if (!fs.existsSync(path.join(ROOT, f))) return
    const src = read(f)
    if (/style="font-weight:600;"/.test(src)) inlineWeightHits.push(f)
    if (/font-weight:600/.test(src)) inlineWeightCompound.push(f)
  })
  fs.readdirSync(path.join(ROOT, 'miniprogram/components')).forEach(dir => {
    const f = ['miniprogram','components',dir,dir+'.wxml'].join('/')
    if (!fs.existsSync(path.join(ROOT, f))) return
    const src = read(f)
    if (/style="font-weight:600;"/.test(src)) inlineWeightHits.push(f)
    if (/font-weight:600/.test(src)) inlineWeightCompound.push(f)
  })
  check('全仓独立的内联字重行标题为 0；复合内联字重只剩登记的这 2 处',
    inlineWeightHits.length === 0 && eq(inlineWeightCompound.slice().sort(), INLINE_WEIGHT_COMPOUND.slice().sort()),
    JSON.stringify({ standalone: inlineWeightHits, compound: inlineWeightCompound }))
  check('route 详情的节点名只留排布差，字重与断词由共享类承担（两个类同写）',
    /\.route-node-name\s*\{[^}]*\}/.test(routeCss)
    && !/\.route-node-name\s*\{[^}]*(font-weight|overflow-wrap)/.test(routeCss)
    && /class="row-title route-node-name"/.test(route.src))
  const routeJson = JSON.parse(read('miniprogram/pages/route/route.json'))
  check('route 注册既有 chapter', routeJson.usingComponents.chapter === '/components/chapter/chapter')
  // 2026-10-29：me 页改成行动流后不再使用章节容器，注册一并移除；
  // 这条钉的是「模板用了就必须登记，模板不用就不要留死注册」。
  check('me 不再注册未使用的 chapter（行动流页面不用章节组件）',
    JSON.parse(read('miniprogram/pages/me/me.json')).usingComponents.chapter === undefined)
  check('个人页注册共享 <person-row>（模板用了就必须登记，否则标签静默不渲染）',
    JSON.parse(read('miniprogram/pages/me/me.json')).usingComponents['person-row'] === '/components/person-row/person-row')
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
