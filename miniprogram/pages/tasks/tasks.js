// 协作任务清单：组织者写、参与者/协作者只读。
// V1 是活动内 checklist，不做跨活动任务中心，也不做跨账号指派授权。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const J = require('../../utils/journey')

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'todo', label: '待办' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
]
const STATUS_TONES = { todo: 'neutral', doing: 'info', done: 'success' }
const STATUS_ACTIONS = { todo: { label: '开始', next: 'doing' }, doing: { label: '完成', next: 'done' }, done: { label: '重开', next: 'todo' } }

function emptyForm() {
  return { title: '', note: '', category: 'gear', categoryLabel: F.TASK_CATEGORY_LABELS.gear, categoryIndex: 0, assigneeName: '', dueDate: '' }
}
function categoryFields(value) {
  const index = Math.max(0, F.TASK_CATEGORY_OPTIONS.map(o => o.value).indexOf(value))
  const option = F.TASK_CATEGORY_OPTIONS[index] || F.TASK_CATEGORY_OPTIONS[0]
  return { category: option.value, categoryLabel: option.label, categoryIndex: index }
}

Page({
  data: {
    loading: true,
    denied: '',
    activityId: '',
    activityTitle: '',
    canManage: false,
    tasks: [],
    filtered: [],
    filter: 'all',
    filterOptions: FILTERS,
    counts: { todo: 0, doing: 0, done: 0 },
    categoryOptions: F.TASK_CATEGORY_OPTIONS,
    sheetOpen: false,
    editingId: '',
    form: emptyForm(),
    deleteOpen: false,
    deleteTask: null,
    busy: false,
    busyAt: 0,
    error: '',
    message: '',
    emptyTitle: '',
    emptyDetail: '',
  },

  onLoad(options) {
    this.activityId = (options && options.id) || ''
    this.setData({ activityId: this.activityId })
  },

  onShow() {
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  reload() {
    if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {
      this.setData({ busy: false, busyAt: 0 })
    }
    if (!this.activityId) {
      this.setData({ loading: false, denied: '缺少活动编号。' })
      return Promise.resolve()
    }
    return api.read({ kind: 'tasks', activityId: this.activityId }).then(res => {
      this.revision = res.revision
      this.now = res.now
      if (res.view.kind !== 'tasks') {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '任务清单不可用。' })
        return
      }
      const v = res.view
      const tasks = (v.tasks || []).map(t => {
        const action = STATUS_ACTIONS[t.status] || STATUS_ACTIONS.todo
        return Object.assign({}, t, {
          statusLabel: F.TASK_STATUS_LABELS[t.status] || t.status,
          statusTone: STATUS_TONES[t.status] || 'neutral',
          categoryLabel: F.TASK_CATEGORY_LABELS[t.category] || t.category,
          dueText: t.dueAt ? F.dtLabel(t.dueAt) : '',
          actionLabel: action.label,
          actionNext: action.next,
        })
      })
      const counts = { todo: 0, doing: 0, done: 0 }
      for (const t of tasks) if (counts[t.status] !== undefined) counts[t.status]++
      const filterOptions = FILTERS.map(f => ({
        value: f.value,
        label: f.label,
        count: f.value === 'all' ? tasks.length : counts[f.value],
      }))
      this.setData({
        loading: false,
        denied: '',
        activityTitle: v.activityTitle || '',
        canManage: !!v.canManage,
        tasks,
        counts,
        filterOptions,
        sheetOpen: false,
        error: '',
      })
      this.render()
      wx.setNavigationBarTitle({ title: '任务清单', fail: () => {} })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  render() {
    const filter = this.data.filter
    const filtered = filter === 'all'
      ? this.data.tasks
      : this.data.tasks.filter(t => t.status === filter)
    let emptyTitle = '还没有任务'
    let emptyDetail = '组织者可以在这里把装备、采购和记录分工写下来。'
    if (filter === 'todo') { emptyTitle = '没有待办任务'; emptyDetail = '当前没有待办；可以切换到其他状态看看。' }
    if (filter === 'doing') { emptyTitle = '没有进行中的任务'; emptyDetail = '当前没有进行中；可以切换到其他状态看看。' }
    if (filter === 'done') { emptyTitle = '还没有完成的任务'; emptyDetail = '完成一条任务后，它会出现在这里。' }
    this.setData({ filtered, emptyTitle, emptyDetail })
  },

  onFilter(e) {
    const filter = e.currentTarget.dataset.value
    if (FILTERS.every(f => f.value !== filter)) return
    this.setData({ filter }, () => this.render())
  },

  onNew() {
    this.setData({ sheetOpen: true, editingId: '', form: emptyForm(), error: '', message: '' })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    const task = this.data.tasks.find(t => t.id === id)
    if (!task) return
    this.setData({
      sheetOpen: true,
      editingId: id,
      error: '',
      form: Object.assign({
        title: task.title,
        note: task.note || '',
        assigneeName: task.assigneeName || '',
        dueDate: task.dueAt ? F.cnParts(task.dueAt).date : '',
      }, categoryFields(task.category || 'other')),
    })
  },

  onSheetClose() {
    this.setData({ sheetOpen: false, error: '' })
  },

  onForm(e) {
    this.setData({ form: Object.assign({}, this.data.form, { [e.currentTarget.dataset.key]: e.detail.value }) })
  },

  onCategory(e) {
    const option = F.TASK_CATEGORY_OPTIONS[Number(e.detail.value)] || F.TASK_CATEGORY_OPTIONS[0]
    this.setData({ form: Object.assign({}, this.data.form, { category: option.value, categoryLabel: option.label, categoryIndex: Number(e.detail.value) || 0 }) })
  },

  onDueDate(e) {
    this.setData({ form: Object.assign({}, this.data.form, { dueDate: e.detail.value }) })
  },

  buildInput() {
    const f = this.data.form
    return {
      title: f.title.trim(),
      note: f.note,
      category: f.category,
      assigneeName: f.assigneeName.trim(),
      dueAt: f.dueDate ? f.dueDate + 'T23:59:00+08:00' : null,
    }
  },

  onSave() {
    if (this.data.busy) return
    const input = this.buildInput()
    if (!input.title) {
      this.setData({ error: '请先填写任务标题。' })
      return
    }
    const type = this.data.editingId ? 'task.update' : 'task.create'
    const payload = type === 'task.update'
      ? { type, activityId: this.activityId, taskId: this.data.editingId, input }
      : { type, activityId: this.activityId, input }
    this.setData({ busy: true, busyAt: Date.now(), error: '', message: '' })
    api.dispatchAndSync(payload, this.revision, this).then(res => {
      this.revision = res.revision
      const message = type === 'task.update' ? '任务已更新。' : '任务已添加。'
      this.setData({ busy: false, sheetOpen: false, message })
      api.toast(message)
      this.reload()
    }).catch(e => this.setData({ busy: false, error: api.errorText(e) }))
  },

  onStatus(e) {
    if (this.data.busy) return
    const id = e.currentTarget.dataset.id
    const next = e.currentTarget.dataset.next
    if (!id || ['todo', 'doing', 'done'].indexOf(next) === -1) return
    this.setData({ busy: true, busyAt: Date.now(), error: '', message: '' })
    api.dispatchAndSync({ type: 'task.status', activityId: this.activityId, taskId: id, status: next }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ busy: false })
        this.reload()
      })
      .catch(e => this.setData({ busy: false, error: api.errorText(e) }))
  },

  onDeleteOpen(e) {
    const task = this.data.tasks.find(t => t.id === e.currentTarget.dataset.id)
    if (!task) return
    this.setData({ deleteOpen: true, deleteTask: task })
  },

  onDeleteClose() {
    this.setData({ deleteOpen: false, deleteTask: null })
  },

  onDeleteConfirm() {
    if (this.data.busy || !this.data.deleteTask) return
    const task = this.data.deleteTask
    this.setData({ busy: true, busyAt: Date.now(), error: '' })
    api.dispatchAndSync({ type: 'task.remove', activityId: this.activityId, taskId: task.id }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ busy: false, deleteOpen: false, deleteTask: null, message: '任务已删除。' })
        api.toast('任务已删除。')
        this.reload()
      })
      .catch(e => this.setData({ busy: false, deleteOpen: false, deleteTask: null, error: api.errorText(e) }))
  },

  onEmptyAction() {
    if (this.data.canManage) this.onNew()
  },

  onDeniedAction() {
    if (this.activityId) wx.navigateTo({ url: '/pages/activity/activity?id=' + this.activityId })
    else wx.switchTab({ url: '/pages/home/home' })
  },
})
