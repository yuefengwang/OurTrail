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
  const w = parseTemplate(read('workspace', 'wxml'))
  const wb = bodyOf(w)
  const overview = one(wb, attr('wx:if', '{{tab === 0}}'))
  const tabs = one(wb, attr('aria-label', '工作台分区'))
  const identity = one(wb, hasClass('workspace-identity'))
  const queue = one(overview, hasClass('workspace-queue'))
  // 事实带是**跨分区入口**，挂在 tabs 与分区面板之间，不随 tab 切换消失；
  // 早期版本把它放在总览内部（queue 之后），会让人在名单/车辆区失去跳区入口。
  const facts = one(wb, hasClass('workspace-band'))
  const milestone = one(overview, attr('wx:if', '{{milestone}}'))
  const tools = one(overview, hasClass('workspace-tools'))
  const phase = one(overview, hasClass('workspace-phase'))
  const before = (a, b) => !!a && !!b && a.end <= b.start
  check('工作台：身份头后紧接 tabs，不夹指标', !!identity && !!tabs && before(identity, tabs)
    && identity.parent === tabs.parent && identity.parent.children.indexOf(tabs) === identity.parent.children.indexOf(identity) + 1)
  check('工作台：三格事实带常驻在 tabs 与分区面板之间（跨分区入口）', !!facts && !within(facts, overview)
    && before(tabs, facts) && before(facts, one(wb, n => n.tag === 'roster-panel')))
  check('工作台：总览内 待办 → 里程碑 → 独立工具 → 阶段', before(queue, milestone)
    && before(milestone, tools) && before(tools, phase))
  check('工作台：四个工具不混入待办，编辑仍受权限保护', ['goNotices', 'goTasks', 'goDetail', 'goEdit'].every(name => {
    const n = one(wb, tap(name))
    return n && within(n, tools) && !within(n, queue) && (name !== 'goEdit' || ancestor(n, attr('wx:if', '{{canEdit}}')))
  }))
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
    check('工作台：' + tag + ' 常驻且同步链完整', !!panel && panel.parent === wb
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
  check('任务：紧凑身份头与新建同行，新建仍受 canManage 保护', before(header, filters)
    && !!one(header, n => tap('onNew')(n) && n.attrs['wx:if'] === '{{canManage}}') && !one(header, hasClass('page-title')))
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
  check('任务：次级按钮仍至少 44px token 触区，状态边栏可见', /\.task-secondary\s*\{[^}]*min-height:\s*var\(--touch-target\)/.test(tcss)
    && /\.task-row\s*\{[^}]*border-left:/.test(tcss))
  for (const page of ['workspace', 'vehicle', 'staff', 'tasks']) {
    const css = read(page, 'wxss')
    check(page + '：页面样式不新造颜色或 token', !/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|--[\w-]+\s*:/i.test(css))
  }
  console.log('passed=' + passed + ' failed=' + failed + ' skipped=0')
  process.exitCode = failed ? 1 : 0
}
module.exports = { parseTemplate, vehicleGuards }
if (require.main === module) main()
