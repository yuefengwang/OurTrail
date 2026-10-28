// 四页 L3 编排的结构证据；不等价于真机像素/触区取证。
'use strict'
const fs = require('fs')
const path = require('path')

// 引号内的 > 不结束标签；保留父子关系，避免把「有 wx:if」误当成「动作受它保护」。
function parseTemplate(source) {
  const text = source.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length))
  const root = { tag: 'root', attrs: {}, children: [], start: -1, end: text.length }
  const stack = [root]
  const re = /<\/?[\w-]+\b(?:[^<>"']|"[^"]*"|'[^']*')*>/g
  let m
  while ((m = re.exec(text))) {
    const token = m[0]
    const tag = /^<\/?([\w-]+)/.exec(token)[1]
    if (token.startsWith('</')) {
      const node = stack.pop()
      if (!node || node.tag !== tag) throw new Error('标签未配对：' + tag)
      node.end = re.lastIndex
      continue
    }
    const attrs = {}
    const attrText = token.slice(tag.length + 1).replace(/\/?\s*>$/, '')
    const ar = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
    let a
    while ((a = ar.exec(attrText))) attrs[a[1]] = a[2] === undefined ? (a[3] === undefined ? true : a[3]) : a[2]
    const parent = stack[stack.length - 1]
    const node = { tag, attrs, parent, children: [], start: m.index, end: re.lastIndex }
    parent.children.push(node)
    if (!/\/\s*>$/.test(token)) stack.push(node)
  }
  if (stack.length !== 1) throw new Error('标签未闭合')
  root.source = text
  return root
}
function all(node, predicate) {
  if (!node) return []
  return node.children.reduce((out, child) => out.concat(predicate(child) ? [child] : [], all(child, predicate)), [])
}
function one(node, predicate) { return all(node, predicate)[0] }
function within(node, parent) {
  if (!parent) return false
  for (let p = node; p; p = p.parent) if (p === parent) return true
  return false
}
function ancestor(node, predicate) {
  for (let p = node; p; p = p.parent) if (predicate(p)) return p
  return null
}
const attr = (name, value) => n => n.attrs[name] === value
const hasClass = name => n => String(n.attrs.class || '').split(/\s+/).includes(name)
const tap = name => n => String(n.attrs.bindtap || '').includes(name)
function bodyOf(root) {
  const denied = one(root, attr('wx:if', '{{denied}}'))
  if (!denied) return null
  const siblings = denied.parent.children
  const index = siblings.indexOf(denied)
  const loading = siblings[index + 1]
  const body = siblings[index + 2]
  return loading && loading.attrs['wx:elif'] === '{{loading}}' && body && body.attrs['wx:else'] === true ? body : null
}
function vehicleGuards(source) {
  const tree = parseTemplate(source)
  const body = bodyOf(tree)
  const bindings = {
    onBoard: ["{{busy ? '' : 'onBoard'}}", '{{item.showBoard}}'],
    onDepartAsk: ["{{busy || departed ? '' : 'onDepartAsk'}}", '{{canOperate}}'],
    onComplete: ["{{busy || !departed || completed ? '' : 'onComplete'}}", '{{canOperate}}'],
  }
  return !!body && Object.keys(bindings).every(name => {
    const nodes = all(tree, tap(name))
    const contract = bindings[name]
    return nodes.length === 1 && nodes.every(n => within(n, body)
      && n.attrs.bindtap === contract[0]
      && ancestor(n, attr('wx:if', contract[1])))
  })
}

function main() {
  let passed = 0
  let failed = 0
  function check(label, result) {
    if (result) { passed++; console.log('PASS ' + label) }
    else { failed++; console.error('FAIL ' + label) }
  }
  const read = (page, ext) => fs.readFileSync(path.join(__dirname, '../miniprogram/pages', page, page + '.' + ext), 'utf8')
  const wxml = read('workspace', 'wxml')
  const w = parseTemplate(wxml)
  const wb = bodyOf(w)
  // Slice 3a：首屏拆成「森林底身份块 + 纸面板」两块，纸面板里才是 tabs/指标/面板/总览。
  const hero = one(wb, hasClass('workspace-hero'))
  const identity = one(hero, hasClass('workspace-identity'))
  const sheet = one(wb, hasClass('ws-sheet'))
  const overview = one(sheet, attr('wx:if', '{{tab === 0}}'))
  const tabs = one(sheet, attr('aria-label', '工作台分区'))
  const queue = one(overview, hasClass('workspace-queue'))
  // 事实带是**跨分区入口**，挂在 tabs 与分区面板之间，不随 tab 切换消失；
  // 早期版本把它放在总览内部（queue 之后），会让人在名单/车辆区失去跳区入口。
  const facts = one(sheet, hasClass('workspace-band'))
  const milestone = one(overview, attr('wx:if', '{{milestone}}'))
  const tools = one(overview, hasClass('workspace-tools'))
  const phase = one(overview, hasClass('workspace-phase'))
  const before = (a, b) => !!a && !!b && a.end <= b.start
  check('工作台：首屏只有「森林底身份块 + 纸面板」两块，身份块在 hero 内、纸面板紧随其后',
    !!hero && !!identity && !!sheet && hero.parent === wb && sheet.parent === wb
    && hero.parent.children.indexOf(sheet) === hero.parent.children.indexOf(hero) + 1 && before(hero, sheet))
  check('工作台：分段器、三格事实带、三个常驻面板与总览同处纸面板，且 tabs → 指标 → 面板',
    !!tabs && !!facts && within(tabs, sheet) && within(facts, sheet) && !within(facts, hero)
    && !within(facts, overview) && before(tabs, facts)
    && before(facts, one(sheet, n => n.tag === 'roster-panel')) && before(facts, overview))
  // C17：指标带保留（删了会失去一眼可见的总量）。这条计数必须真的咬得住——
  // 夹具把其中一格改名，计数必须掉到 2，否则「保留」只是注释。
  const metricCount = source => {
    const band = one(bodyOf(parseTemplate(source)), hasClass('workspace-band'))
    return band ? all(band, hasClass('metric')).length : -1
  }
  const metricFixture = wxml.replace('<view class="metric" hover-class="button-hover" bindtap="goRoster">',
    '<view class="metric-slot" hover-class="button-hover" bindtap="goRoster">')
  check('工作台：指标格恰 3 个（C17 保留），删掉一格必须红', metricCount(wxml) === 3
    && metricCount(metricFixture) === 2, 'now=' + metricCount(wxml) + ' fixture=' + metricCount(metricFixture))
  check('工作台：总览内 待办 → 里程碑 → 独立工具 → 阶段', before(queue, milestone)
    && before(milestone, tools) && before(tools, phase))
  check('工作台：四个工具不混入待办，编辑仍受权限保护', ['goNotices', 'goTasks', 'goDetail', 'goEdit'].every(name => {
    const n = one(wb, tap(name))
    return n && within(n, tools) && !within(n, queue) && (name !== 'goEdit' || ancestor(n, attr('wx:if', '{{canEdit}}')))
  }))
  // style-B 批次二 b：工具是**导航**不是主行动。四个 leaf 实底会变成整页最响的色块，
  // 把强调色从待办手里抢走；白面细线才与页面其余卡片同族。
  const toolNodes = tools ? all(tools, hasClass('workspace-tool')) : []
  check('工作台：四个工具是有方向箭头的导航卡，不冒充提交按钮', toolNodes.length === 4
    && toolNodes.every(n => !hasClass('button')(n) && !hasClass('leaf')(n)
      && !!one(n, child => child.tag === 'icon' && child.attrs.name === 'arrow')
      && !!one(n, hasClass('activity-nav-icon'))), 'tools=' + toolNodes.length)
  check('工作台：工具说明文字降为 muted（标题 forest / 说明 muted 二三级关系）',
    /\.workspace-tool__sub\s*\{[^}]*color:\s*var\(--muted\)/.test(read('workspace', 'wxss')))
  const primary = one(queue, attr('data-target', '{{queuePrimary.target}}'))
  check('工作台：主待办来自 journey.primary，idle 不伪装成待办', primary && hasClass('primary')(primary)
    && ancestor(primary, attr('wx:if', "{{queuePrimary && queuePrimary.id !== 'idle'}}")))
  check('工作台：待办有真实 label/detail 与空态阶段说明', !!queue
    && w.source.slice(queue.start, queue.end).includes('{{queuePrimary.label}}')
    && w.source.slice(queue.start, queue.end).includes('{{queuePrimary.detail}}')
    && w.source.slice(queue.start, queue.end).includes("{{queuePrimary ? queuePrimary.detail : subtitle}}"))
  const transition = one(queue, attr('bindtap', "{{canTransition && !busy ? 'onTransition' : ''}}"))
  check('工作台：下一步入口在待办区且不抢占真实待办的 primary', !!transition
    && String(transition.attrs.class).includes("queuePrimary && queuePrimary.id !== 'idle' ? 'secondary' : 'primary'")
    && !!ancestor(transition, attr('wx:if', '{{canTransition}}')))
  check('工作台：门槛说明独立于权限位', !!one(queue, attr('wx:if', '{{transitionHint}}')))
  check('工作台：取消仍在后置阶段区并保持次级文字入口', !!one(phase, n => n.attrs['data-next'] === 'cancelled'
    && n.attrs['wx:if'] === '{{canCancel}}' && hasClass('text')(n)))
  for (const [index, tag] of ['roster-panel', 'transport-panel', 'field-panel'].entries()) {
    const panel = one(wb, n => n.tag === tag)
    // 面板仍在纸面板内（不随分区切换卸载），但不再是 body 的直接子节点：tabs/指标带与它们同处 .ws-sheet。
    check('工作台：' + tag + ' 常驻且同步链完整', !!panel && panel.parent === sheet
      && panel.attrs.class === "{{tab === " + (index + 1) + " ? '' : 'hide'}}"
      && !('wx:if' in panel.attrs) && panel.attrs['sync-key'] === '{{syncKey}}' && panel.attrs['bind:written'] === 'onPanelSync')
  }
  const field = one(wb, n => n.tag === 'field-panel')
  const ws = read('workspace', 'js')
  // page-metrics=true 让现场面板在「事实带第三格已经显示待到家」时不再重复印一遍；
  // 在出发前阶段第三格是待签到，面板仍保留自己的待到家数（field-panel.js 的分支判据）。
  check('工作台：待到家数由事实带承担时，现场面板不重复印一份', !!field
    && field.attrs['page-metrics'] === '{{true}}' && /J\.fieldMetric/.test(ws)
    && /thirdLabel:\s*metric\.label/.test(ws))
  const wcss = read('workspace', 'wxss')
  check('工作台：小事实带字号用现有 token，工具为双列', /font-size:\s*var\(--text-input\)/.test(wcss)
    && /\.workspace-tools\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(wcss))
  // 首屏是 hero + 纸面板两块；两者之间的 -20px 必须真的成立。放在 .stack（gap 16）里只剩 4px，
  // 所以承载列必须是无 gap 的 flex（与活动详情 .act-top 同一条教训）。
  check('工作台：首屏列无 gap，纸面板才真的盖上 hero 下沿 20px',
    /\.ws-top\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/.test(wcss)
    && !/\.ws-top\s*\{[^}]*\bgap:/.test(wcss))
  check('工作台：hero 吃掉页面内边距铺到导航下沿，且是森林底白字',
    /\.workspace-hero\s*\{[^}]*margin:\s*-24px -20px 0[^}]*background:\s*var\(--forest\)/.test(wcss)
    && /\.workspace-hero\s*\{[^}]*color:\s*var\(--white\)/.test(wcss))
  check('工作台：纸面板内部分区同用 20px 节奏', /\.ws-sheet\s*\{[^}]*gap:\s*20px/.test(wcss))
  // C17 只要求「保留」，不要求保卡片：去底、去圆角、去内边距，数值交回全局 26px。
  check('工作台：指标带去卡片化，数值不再被 24px 覆盖',
    !/\.workspace-band\s*\{[^}]*background:/.test(wcss)
    && !/\.workspace-band\s*\{[^}]*border-radius/.test(wcss)
    && !/\.workspace-band[^{]*metric-value[^{]*\{[^}]*font-size:\s*24px/.test(wcss)
    && /\.workspace-band \.metric \+ \.metric\s*\{[^}]*border-left:\s*1px solid var\(--line\)/.test(wcss))
  check('工作台：待办不再套 .card（纸面本身就是同一层表面）', !/<view class="card queue-card"/.test(wxml))

  // ---- Slice 3b：名单 / 交通面板（组件层） ----
  const readComp = (name, ext) => fs.readFileSync(path.join(__dirname, '../miniprogram/components', name, name + '.' + ext), 'utf8')
  const rosterW = parseTemplate(readComp('roster-panel', 'wxml'))
  const rosterCss = readComp('roster-panel', 'wxss')
  const summary = one(rosterW, hasClass('metrics'))
  const searchBar = one(rosterW, hasClass('searchbar'))
  check('名单：汇总从一句话改成三格指标带，数字取 counters 同一出处',
    !!summary && all(summary, hasClass('metric')).length === 3
    && ['confirmed', 'pending', 'waitlisted'].every(k => rosterW.source.slice(summary.start, summary.end).includes('{{counters.' + k + '}}')))
  check('名单：搜索是 44 高 pill（.searchbar），状态筛选与它同行、按内容收窄',
    !!searchBar && !!one(searchBar, hasClass('searchbar__input'))
    && within(searchBar, one(rosterW, hasClass('roster-filter')))
    && /\.roster-filter \.searchbar\s*\{[^}]*flex:\s*1[^}]*min-width:\s*0/.test(rosterCss)
    && !/\.roster-filter \.input\s*\{/.test(rosterCss))
  // 头像有两种形态：真实头像 .avatar-img 与首字占位 .avatar（全局 44）。两者不同尺寸时同一列表行高会差 4px。
  const personCss = readComp('person-row', 'wxss')
  check('人员行：头像 44 与姓名 16/600（行名是这一屏的主信息，不能与副行只差一级）',
    /\.avatar-img\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/.test(personCss)
    && /\.person-row__body \.person-row__heading \.person-name\s*\{[^}]*font-size:\s*var\(--text-input\)/.test(personCss))
  const tpSrc = readComp('transport-panel', 'wxml')
  const tpTree = parseTemplate(tpSrc)
  const ADD_VEHICLE_CLASS = "{{vehicles.length ? 'secondary' : 'primary'}}"
  const addVehicle = one(tpTree, n => n.tag === 'view' && String(n.attrs.class || '').includes(ADD_VEHICLE_CLASS))
  const addVehiclePrimary = source => !!one(parseTemplate(source),
    n => n.tag === 'view' && String(n.attrs.class || '').includes(ADD_VEHICLE_CLASS))
  const vehicleCards = one(tpTree, attr('wx:for', '{{vehicles}}'))
  // 板上这颗是车辆列表下方的整宽按钮。无车时「预览自动分车」是禁用的，它才是唯一可用的推进动作 ⇒ 实心；
  // 有车后主位必须交回预览 ⇒ 降为软底。恒 primary 就是同屏两个实心主按钮（规则 #7）。
  check('交通：添加车辆在车辆列表末尾整宽，无车时实心、有车时软底（改回恒 primary 必红）',
    !!addVehicle && hasClass('block')(addVehicle) && !!vehicleCards && before(vehicleCards, addVehicle)
    && !within(addVehicle, one(tpTree, hasClass('card-header')))
    && addVehiclePrimary(tpSrc) && !addVehiclePrimary(tpSrc.replace(ADD_VEHICLE_CLASS, 'primary')))
  check('交通：容量带保持 3 格（C15：不减也不加），座位图原样', !!one(tpTree, hasClass('metrics'))
    && all(one(tpTree, hasClass('metrics')), hasClass('metric')).length === 3
    && tpSrc.includes('seat-grid'))

  const vs = read('vehicle', 'wxml')
  const v = parseTemplate(vs)
  const vb = bodyOf(v)
  const vi = one(vb, hasClass('vehicle-identity'))
  const leg = one(vb, attr('aria-label', '本程方向'))
  const operations = one(vb, hasClass('vehicle-operations'))
  const passengers = one(vb, n => n.tag === 'person-row')
  const capacity = one(vb, hasClass('vehicle-capacity'))
  check('车辆：身份 → 方向 → 本程行动区 → 乘客 → 容量', before(vi, leg) && before(leg, operations)
    && before(operations, passengers) && before(passengers, capacity))
  check('车辆：司机身份取实际投影，不只摆车牌', !!vi && v.source.slice(vi.start, vi.end).includes('{{driverLine}}'))
  check('车辆：缺口、错误和原发车/完成动作均在名单前', ['onDepartAsk', 'onComplete'].every(name => within(one(vb, tap(name)), operations))
    && within(one(vb, attr('wx:if', '{{showPendingNotice}}')), operations) && within(one(vb, attr('wx:if', '{{error}}')), operations))
  check('车辆：denied/loading 与 showBoard/canOperate 的真实祖先保护', vehicleGuards(vs))
  check('车辆门控阳性：重命名 body class 不影响保护', vehicleGuards(vs.replace(/(<view wx:else) class="[^"]*"/, '$1 class="renamed-shell"')))
  check('车辆门控反向：去掉 body else 必须失败', !vehicleGuards(vs.replace('wx:else', 'data-else')))
  check('车辆门控反向：去掉 canOperate 必须失败', !vehicleGuards(vs.replace('wx:if="{{canOperate}}"', 'data-operate="{{canOperate}}"')))
  check('车辆门控反向：去掉 showBoard 必须失败', !vehicleGuards(vs.replace('wx:if="{{item.showBoard}}"', 'data-board="{{item.showBoard}}"')))
  const dialog = one(v, attr('open', '{{departAsk}}'))
  check('车辆：保留缺口确认层、回去清点和危险确认', !!dialog && !!one(dialog, tap('onDepartCancel'))
    && !!one(dialog, attr('bindtap', "{{busy || departed ? '' : 'onDepart'}}"))
    && v.source.slice(dialog.start, dialog.end).includes('{{pendingNames}}'))
  check('车辆：车程完成不等于安全到家，警示留在行动区', !!operations && v.source.slice(operations.start, operations.end)
    .includes('行驶完成不等于参与者安全到家；如有人未上车，请由现场负责人核实去向。'))

  const s = parseTemplate(read('staff', 'wxml'))
  const si = one(s, hasClass('staff-identity'))
  const sp = one(s, n => n.tag === 'field-panel')
  check('现场：紧凑角色与真实活动编号在面板前，无虚构活动名', before(si, sp)
    && s.source.slice(si.start, si.end).includes('现场协作') && s.source.slice(si.start, si.end).includes('{{activityId}}')
    && !one(s, hasClass('page-title')))
  check('现场：面板原接口与刷新键不变', !!sp && sp.attrs['activity-id'] === '{{activityId}}'
    && sp.attrs.perspective === 'staff' && sp.attrs['sync-key'] === '{{syncKey}}' && !sp.attrs['wx:if'])

  const t = parseTemplate(read('tasks', 'wxml'))
  const tb = bodyOf(t)
  const header = one(tb, hasClass('tasks-identity'))
  const filters = one(tb, attr('aria-label', '任务筛选'))
  const record = one(tb, attr('wx:for', '{{filtered}}'))
  const newBtn = one(t, n => tap('onNew')(n) && ancestor(n, hasClass('sticky-action')))
  // style-B 3c：新建从页头搬到固定底栏（板上它在列表下方整宽）。位置换了，权限与「页头不再有实心按钮」两条更强：
  // 底栏必须真的在 .sticky-action 内、页头不能再出现 onNew，且 .page 的 has-sticky 与 canManage 同条件。
  check('任务：新建在固定底栏且受 canManage 保护，页头不再有实心按钮',
    before(header, filters) && !!newBtn && newBtn.attrs['bindtap'] === 'onNew'
    && !!ancestor(newBtn, attr('wx:if', '{{canManage && !denied && !loading}}'))
    && !one(header, tap('onNew')) && !one(header, hasClass('page-title'))
    && /<view class="page activity-ui \{\{canManage && !denied && !loading \? 'has-sticky' : ''\}\}">/.test(t.source))
  check('任务：计数就在筛选里，没有独立 metrics 带', !!filters && t.source.slice(filters.start, filters.end).includes('{{item.count}}')
    && !one(tb, hasClass('metrics')))
  check('任务：逐条紧凑状态边栏，不折叠记录', !!record && hasClass('task-row')(record)
    && String(record.attrs.class).includes('{{item.statusTone}}') && !record.attrs['wx:if'] && !record.attrs.hidden)
  check('任务：名称/分类/负责人/说明/截止/文字状态都在列表', !!record
    && ['title', 'categoryLabel', 'assigneeName', 'note', 'dueText', 'statusLabel'].every(key => t.source.slice(record.start, record.end).includes('{{item.' + key + '}}')))
  check('任务：状态推进独立按钮，仍带原 id/next 并受 canManage 保护', !!one(record, n => tap('onStatus')(n)
    && hasClass('task-status-action')(n) && n.attrs['data-id'] === '{{item.id}}' && n.attrs['data-next'] === '{{item.actionNext}}'
    && ancestor(n, attr('wx:if', '{{canManage}}'))))
  check('任务：编辑/删除保留文字、id、权限，降为次级按钮', ['onEdit', 'onDeleteOpen'].every(name => {
    const n = one(record, tap(name))
    return n && hasClass('task-secondary')(n) && n.attrs['data-id'] === '{{item.id}}'
      && ancestor(n, attr('wx:if', '{{canManage}}')) && /编辑|删除/.test(t.source.slice(n.start, n.end))
  }))
  const tcss = read('tasks', 'wxss')
  check('任务：身份头标题 20/28（与首页分区标题同一档）', /\.tasks-identity__title\s*\{[^}]*font-size:\s*20px[^}]*line-height:\s*28px/.test(tcss))
  check('任务：次级按钮仍至少 44px token 触区，状态边栏可见', /\.task-secondary\s*\{[^}]*min-height:\s*var\(--touch-target\)/.test(tcss)
    && /\.task-row\s*\{[^}]*border-left:/.test(tcss))
  // ---- style-B 3c：通知从「白卡片堆叠」改成消息流（板 03-5）----
  // 判据落在共用层 app.wxss：两份通知页都只靠 .notice-card 成形，页面 wxss 里没有一条行样式，
  // 所以行形态只有这一个真值源，改回卡片式必须在这里红。
  const appCss = fs.readFileSync(path.join(__dirname, '../miniprogram/app.wxss'), 'utf8')
  const noticeRow = css => {
    const block = (/\.notice-card\s*\{([^}]*)\}/.exec(css) || ['', ''])[1]
    const unread = (/\.notice-card\.unread\s*\{([^}]*)\}/.exec(css) || ['', ''])[1]
    const get = (src, key) => (new RegExp('(?:^|[;\\s])' + key + '\\s*:\\s*([^;]+)').exec(src) || ['', ''])[1].trim()
    return {
      bg: get(block, 'background'), radius: get(block, 'border-radius'),
      left: get(block, 'border-left'), bottom: get(block, 'border-bottom'),
      unreadLeft: get(unread, 'border-left-color'),
    }
  }
  const noticeRowOk = css => {
    const r = noticeRow(css)
    // 左侧 2px 在两种读态下都占位（透明→森林）：只给未读加边会把该行右移 2px，文字左缘对不齐。
    return r.left === '2px solid transparent' && r.unreadLeft === 'var(--forest)'
      && /^1px solid var\(--line\)/.test(r.bottom) && r.bg === 'transparent' && r.radius === '0'
  }
  check('通知：行是发丝分隔的消息流（无圆角、无底色、只留底边），未读只切左边颜色不位移',
    noticeRowOk(appCss)
    && /\.notice-card \.notice-body\s*\{[^}]*font-size:\s*var\(--text-input\)[^}]*line-height:\s*24px/.test(appCss),
    JSON.stringify(noticeRow(appCss)))
  const teeth = [
    appCss.replace('border-left: 2px solid transparent', 'border-left: 0'),
    appCss.replace('border-left-color: var(--forest)', 'border-left: 3px solid var(--forest)'),
    appCss.replace(/\.notice-card \{[^}]*background: transparent/, m => m.replace('background: transparent', 'background: var(--surface)')),
    appCss.replace(/\.notice-card \{[^}]*border-radius: 0/, m => m.replace('border-radius: 0', 'border-radius: var(--radius-card)')),
  ]
  check('通知：行形态有牙齿（回卡片 / 未读加粗边 / 恢复白底 / 恢复圆角，四种都必红）',
    teeth.every(src => src !== appCss) && teeth.every(src => !noticeRowOk(src)),
    teeth.map(src => noticeRowOk(src)).join(','))
  const nw = parseTemplate(read('notices', 'wxml'))
  const aw = parseTemplate(read('anotices', 'wxml'))
  const bodyText = tree => one(bodyOf(tree), hasClass('notice-body'))
  check('通知：两份页面的正文都走 16/24 主信息档（页脚小字读不成通知）',
    !!bodyText(nw) && !!bodyText(aw)
    && !!one(nw, n => n.attrs['wx:for'] === '{{visibleItems}}' && hasClass('notice-card')(n))
    && !!one(aw, n => n.attrs['wx:for'] === '{{visibleItems}}' && hasClass('notice-card')(n)))
  // style-B 3c：anotices 原来有两个分区头（「同行消息」大标题 + 又一个「通知」），同一屏连出两次页面身份。
  // 并成一处后与 tab 版正文同构；列表读数（条数 / 排序 / 未读标记）降为一行细字，事实一条不少。
  check('公告：单分区头 + 一行读数，与 tab 版正文同构（差异只留页头）',
    (aw.source.match(/class="section-head"/g) || []).length === 1
    && aw.source.includes('<text class="kicker">通知</text>') && aw.source.includes('class="list-head__title"')
    && !one(bodyOf(aw), hasClass('page-title')) && aw.source.indexOf('同行消息') === -1
    && ['共 {{items.length}} 条', '最新的在最上面', '左侧深色边线的是还没读的'].every(s => aw.source.includes(s) && nw.source.includes(s)),
    '')

  for (const page of ['workspace', 'vehicle', 'staff', 'tasks', 'notices', 'anotices']) {
    const css = read(page, 'wxss')
    check(page + '：页面样式不新造颜色或 token', !/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|--[\w-]+\s*:/i.test(css))
  }
  console.log('passed=' + passed + ' failed=' + failed + ' skipped=0')
  process.exitCode = failed ? 1 : 0
}
module.exports = { parseTemplate, vehicleGuards }
if (require.main === module) main()
