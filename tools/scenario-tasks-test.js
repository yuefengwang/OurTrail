// 任务清单页面场景：owner 写、参与者只读、筛选、重试/空态与命令形状。
// 运行：node tools/scenario-tasks-test.js
'use strict'
const fs = require('fs')
const path = require('path')
const PAGE_PATH = require.resolve('../miniprogram/pages/tasks/tasks.js')
const TASKS_WXML = fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'tasks', 'tasks.wxml'), 'utf8')
const TASKS_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'tasks', 'tasks.json'), 'utf8'))

let passed = 0
let failed = 0
let skipped = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.error('  ✗ ' + name + (extra ? '（' + extra + '）' : '')) }
}
function section(t) { console.log('== ' + t + ' ==') }
const NOW = '2027-01-01T09:00:00+08:00'
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms) {
  const limit = ms || 1200
  const t0 = Date.now()
  while (Date.now() - t0 < limit) { if (cond()) return true; await sleep(5) }
  return cond()
}

function taskFixture(over) {
  return Object.assign({
    id: 't1', title: '采购饮用水', note: '6 箱', category: 'food',
    assigneeName: '王五', status: 'todo', dueAt: '2027-01-30T23:59:00+08:00', updatedAt: NOW,
  }, over || {})
}
function viewFixture(over) {
  return Object.assign({
    kind: 'tasks', activityId: 'a1', activityTitle: '测试活动', canManage: true,
    tasks: [
      taskFixture(),
      taskFixture({ id: 't2', title: '整理公共装备', note: '', category: 'gear', assigneeName: '', status: 'doing', dueAt: null, updatedAt: null }),
      taskFixture({ id: 't3', title: '记录行程', note: '', category: 'logistics', assigneeName: '张三', status: 'done', dueAt: null, updatedAt: null }),
    ],
  }, over || {})
}

function bootTasks(opts) {
  opts = opts || {}
  const env = { reads: [], cmds: [], nav: [], toasts: [], titles: [] }
  global.wx = {
    cloud: { callFunction(req) {
      const data = req.data || {}
      if (data.action === 'read') {
        env.reads.push(data.request)
        return Promise.resolve({ result: { ok: true, data: { view: opts.view || viewFixture(), revision: 2, now: NOW } } })
      }
      if (data.action === 'dispatch') {
        env.cmds.push({ payload: data.payload, expectedRevision: data.expectedRevision, requestId: data.requestId })
        return Promise.resolve({ result: { ok: true, data: { targetIds: ['t-new'], replayed: false, revision: 3 } } })
      }
      return Promise.resolve({ result: { ok: true, data: {} } })
    } },
    showToast: o => env.toasts.push((o && o.title) || ''),
    stopPullDownRefresh: () => {},
    navigateTo: o => env.nav.push((o && o.url) || ''),
    switchTab: o => env.nav.push((o && o.url) || ''),
    setNavigationBarTitle: o => env.titles.push((o && o.title) || ''),
  }
  global.Page = cfg => { global.__CFG = cfg }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  const cfg = global.__CFG
  const page = Object.assign({}, cfg)
  page.data = JSON.parse(JSON.stringify(cfg.data || {}))
  page.setData = function (patch, cb) {
    for (const key of Object.keys(patch)) {
      if (key.indexOf('.') === -1) { this.data[key] = patch[key]; continue }
      const parts = key.split('.')
      let node = this.data
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] = node[parts[i]] || {}
      node[parts[parts.length - 1]] = patch[key]
    }
    if (cb) setImmediate(cb)
  }
  page.onLoad({ id: 'a1' })
  page.onShow()
  return { page, env }
}

async function main() {
  section('1. owner 装配、计数与标签')
  {
    const { page, env } = bootTasks()
    await waitFor(() => page.data.loading === false)
    check('read 请求为 tasks / a1', env.reads.length === 1 && env.reads[0].kind === 'tasks' && env.reads[0].activityId === 'a1',
      JSON.stringify(env.reads[0]))
    check('任务数/计数正确', page.data.tasks.length === 3 && page.data.counts.todo === 1 && page.data.counts.doing === 1 && page.data.counts.done === 1,
      JSON.stringify(page.data.counts))
    const t = page.data.tasks.find(x => x.id === 't1')
    check('状态/分类/截止标签归口 format', t.statusLabel === '待办' && t.categoryLabel === '食物采购' && t.dueText.indexOf('1/30') !== -1,
      JSON.stringify({ s: t.statusLabel, c: t.categoryLabel, d: t.dueText }))
    check('owner canManage=true', page.data.canManage === true)
    check('筛选装配全量计数（全部/待办/进行中/完成）', page.data.filterOptions.map(f => f.count).join(',') === '3,1,1,1')
    check('列表保留说明和负责人，状态推进取原枚举', t.note === '6 箱' && t.assigneeName === '王五'
      && page.data.tasks.map(x => x.actionNext).join(',') === 'doing,done,todo')
    check('任务页已注册并按模板渲染', TASKS_JSON.usingComponents.overlay === '/components/overlay/overlay'
      && TASKS_WXML.indexOf('bindtap="onNew"') !== -1)
  }

  section('2. 筛选与空态')
  {
    const { page } = bootTasks()
    await waitFor(() => page.data.loading === false)
    page.onFilter({ currentTarget: { dataset: { value: 'todo' } } })
    await waitFor(() => page.data.filtered.length === 1)
    check('筛选待办只剩 todo', page.data.filtered.length === 1 && page.data.filtered[0].id === 't1', page.data.filtered.map(t => t.id))
    page.onFilter({ currentTarget: { dataset: { value: 'done' } } })
    await waitFor(() => page.data.filter === 'done' && page.data.filtered.length === 1 && page.data.filtered[0].id === 't3')
    check('筛选已完成只剩 done', page.data.filtered.length === 1 && page.data.filtered[0].id === 't3')
    page.onFilter({ currentTarget: { dataset: { value: 'bogus' } } })
    check('非法筛选值不改变当前筛选', page.data.filter === 'done')
    check('切换筛选不改变全量计数', page.data.filterOptions.map(f => f.count).join(',') === '3,1,1,1')
    page.onFilter({ currentTarget: { dataset: { value: 'all' } } })
    await waitFor(() => page.data.filtered.length === 3)
    check('回到全部不折叠任何记录', page.data.filtered.map(t => t.id).join(',') === 't1,t2,t3')
    const empty = bootTasks({ view: viewFixture({ tasks: [] }) })
    await waitFor(() => empty.page.data.loading === false)
    check('空清单有解释与新建入口', empty.page.data.emptyTitle === '还没有任务'
      && empty.page.data.emptyDetail.indexOf('组织者') !== -1)
    check('空清单四个筛选计数真实为零', empty.page.data.filterOptions.every(f => f.count === 0))
  }

  section('3. 新建/编辑/状态/删除命令')
  {
    const { page, env } = bootTasks()
    await waitFor(() => page.data.loading === false)
    page.onNew()
    check('打开新建任务弹层', page.data.sheetOpen === true && page.data.editingId === '')
    page.onForm({ currentTarget: { dataset: { key: 'title' } }, detail: { value: '  采购周六饮用水  ' } })
    page.onForm({ currentTarget: { dataset: { key: 'assigneeName' } }, detail: { value: ' 王五 ' } })
    page.onCategory({ detail: { value: 1 } })
    page.onDueDate({ detail: { value: '2027-01-30' } })
    check('分类表单显示中文', page.data.form.categoryLabel === '食物采购' && page.data.form.categoryIndex === 1)
    page.onSave()
    await waitFor(() => env.cmds.length === 1 && page.data.busy === false)
    const create = env.cmds[0].payload
    check('新建发 task.create', create.type === 'task.create' && create.activityId === 'a1', create.type)
    check('标题/负责人 trim，分类与截止正确', create.input.title === '采购周六饮用水' && create.input.assigneeName === '王五'
      && create.input.category === 'food' && create.input.dueAt === '2027-01-30T23:59:00+08:00', JSON.stringify(create.input))
    check('以读取 revision 做 CAS', env.cmds[0].expectedRevision === 2, env.cmds[0].expectedRevision)

    page.onEdit({ currentTarget: { dataset: { id: 't1' } } })
    check('编辑预填标题/分类/截止', page.data.form.title === '采购饮用水' && page.data.form.category === 'food'
      && page.data.form.dueDate === '2027-01-30', JSON.stringify(page.data.form))
    page.onForm({ currentTarget: { dataset: { key: 'title' } }, detail: { value: '采购晚餐' } })
    page.onSave()
    await waitFor(() => env.cmds.length === 2 && page.data.busy === false)
    const update = env.cmds[1].payload
    check('编辑发 task.update', update.type === 'task.update' && update.taskId === 't1' && update.input.title === '采购晚餐',
      JSON.stringify(update))

    page.onStatus({ currentTarget: { dataset: { id: 't1', next: 'doing' } } })
    await waitFor(() => env.cmds.length === 3 && page.data.busy === false)
    const status = env.cmds[2].payload
    check('状态发 task.status', status.type === 'task.status' && status.taskId === 't1' && status.status === 'doing',
      JSON.stringify(status))

    page.onDeleteOpen({ currentTarget: { dataset: { id: 't3' } } })
    check('删除先开确认层', page.data.deleteOpen === true && page.data.deleteTask.id === 't3')
    page.onDeleteConfirm()
    await waitFor(() => env.cmds.length === 4 && page.data.busy === false)
    const remove = env.cmds[3].payload
    check('删除发 task.remove', remove.type === 'task.remove' && remove.taskId === 't3', JSON.stringify(remove))
    check('成功后关闭删除层', page.data.deleteOpen === false)
  }

  section('4. 空标题拦截 / 参与者只读 / denied')
  {
    const { page, env } = bootTasks()
    await waitFor(() => page.data.loading === false)
    page.onNew()
    page.onForm({ currentTarget: { dataset: { key: 'title' } }, detail: { value: '   ' } })
    page.onSave()
    check('空标题不发命令并点名', page.data.error.indexOf('任务标题') !== -1 && env.cmds.length === 0, page.data.error)

    const readOnly = bootTasks({ view: viewFixture({ canManage: false }) })
    await waitFor(() => readOnly.page.data.loading === false)
    check('参与者 canManage=false', readOnly.page.data.canManage === false)
    // style-B 3c：新建按钮从页头搬进固定底栏。旧断言钉的是页头那颗 `wx:if="{{canManage}}" class="button primary`，
    // 位置换了但判据不松：底栏与页内操作各自都要有 canManage 守卫（非管理者既不能建、也不能改）。
    check('模板以 canManage 隐藏新建与行内操作',
      TASKS_WXML.indexOf('wx:if="{{canManage && !denied && !loading}}" class="sticky-action"') !== -1
      && TASKS_WXML.indexOf('wx:if="{{canManage}}" class="task-row__actions"') !== -1)
  }
  {
    const { page } = bootTasks({ view: { kind: 'denied', message: '没有此活动任务的访问权限。' } })
    await waitFor(() => page.data.loading === false)
    check('denied 原文透出且不装配任务', page.data.denied === '没有此活动任务的访问权限。' && page.data.tasks.length === 0,
      page.data.denied)
  }

  section('5. 紧凑列表的真实状态循环与重复点击守卫')
  {
    const { page, env } = bootTasks()
    await waitFor(() => !page.data.loading)
    for (const [id, next] of [['t1', 'doing'], ['t2', 'done'], ['t3', 'todo']]) {
      const before = env.cmds.length
      const event = { currentTarget: { dataset: { id, next } } }
      page.onStatus(event); page.onStatus(event)
      await waitFor(() => env.cmds.length === before + 1 && !page.data.busy)
      check(id + ' 状态按钮沿用 task.status 且双击只写一次', env.cmds.length === before + 1
        && env.cmds[before].payload.taskId === id && env.cmds[before].payload.status === next
        && env.cmds[before].expectedRevision === 2)
    }
    page.onEdit({ currentTarget: { dataset: { id: 't1' } } })
    check('次级编辑入口保留说明、负责人和截止原值', page.data.form.note === '6 箱'
      && page.data.form.assigneeName === '王五' && page.data.form.dueDate === '2027-01-30')
    page.onDeleteOpen({ currentTarget: { dataset: { id: 't1' } } })
    page.onDeleteClose()
    check('次级删除仍可取消且不写入', !page.data.deleteOpen && env.cmds.length === 3)
  }
  console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped)
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(e => { failed++; console.error('  ✗ 用例执行异常（' + (e && e.message) + '）'); console.log('\npassed=' + passed + ' failed=' + failed + ' skipped=' + skipped); process.exit(1) })
