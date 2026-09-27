// 组织者工作台（原型 screens/Workspace.tsx）：总览 / 名单 / 分车 / 现场。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

const NEXT_PHASE = { published: 'gathering', gathering: 'active', active: 'closing', closing: 'archived' }
const TABS = ['总览', '名单', '分车', '现场']

Page({
  data: {
    loading: true,
    denied: '',
    tab: 0,
    tabLabels: TABS,
    eyebrow: '组织者工作台',
    phaseLabel: '',
    title: '',
    subtitle: '先处理需要你确认的事，再安心出发。',
    pending: 0,
    unassigned: 0,
    thirdValue: 0,
    thirdLabel: '待签到',
    // 总览
    waitlisted: 0,
    unchecked: 0,
    openIncidents: 0,
    pendingHome: 0,
    phaseTimeline: [],
    canTransition: false,
    nextPhaseLabel: '',
    canCancel: false,
    canEdit: false,
    // 弹层
    transitionOpen: false,
    transitionNext: '',
    transitionTitle: '',
    reason: '',
    error: '',
    message: '',
    busy: false,
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.setData({ activityId: this.activityId })
  },

  onShow() {
    this.reload()
  },

  reload() {
    if (!this.activityId) {
      this.setData({ loading: false, denied: '缺少活动编号。' })
      return
    }
    return api.read({ kind: 'activity', activityId: this.activityId, perspective: 'organizer' }).then(res => {
      if (res.view.kind !== 'activity') {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '没有此工作台的访问权限' })
        return
      }
      this.revision = res.revision
      this.now = res.now
      this.view = res.view
      const v = res.view
      const a = v.activity
      const phase = a.phase
      const next = NEXT_PHASE[phase]
      const inField = phase === 'published' || phase === 'gathering'
      const timeline = ['published', 'gathering', 'active', 'closing', 'archived'].map(p => ({
        phase: p,
        label: F.PHASE_LABELS[p] + (p === phase ? ' · 当前' : ''),
        current: p === phase,
      }))
      this.setData({
        loading: false,
        denied: '',
        eyebrow: '组织者工作台',
        phaseLabel: F.PHASE_LABELS[phase] || phase,
        title: a.title || '未命名活动',
        pending: v.counters.pending,
        unassigned: v.counters.unassigned,
        waitlisted: v.counters.waitlisted,
        unchecked: v.counters.unchecked,
        openIncidents: v.counters.openIncidents,
        pendingHome: v.counters.pendingHome,
        thirdValue: inField ? v.counters.unchecked : v.counters.pendingHome,
        thirdLabel: inField ? '待签到' : '待到家',
        phaseTimeline: timeline,
        canTransition: !!next && v.permittedActions.indexOf('activity.transition') !== -1,
        nextPhaseLabel: next ? F.PHASE_LABELS[next] : '',
        canCancel: v.permittedActions.indexOf('activity.transition') !== -1
          && ['draft', 'published', 'gathering'].indexOf(phase) !== -1,
        canEdit: v.permittedActions.indexOf('activity.edit') !== -1,
      })
      wx.setNavigationBarTitle({ title: '活动工作台' })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  onTab(e) {
    this.setData({ tab: Number(e.currentTarget.dataset.tab) })
  },

  goRoster() { this.setData({ tab: 1 }) },
  goTransport() { this.setData({ tab: 2 }) },
  goField() { this.setData({ tab: 3 }) },
  goNotices() { wx.navigateTo({ url: '/pages/anotices/anotices?id=' + this.activityId }) },
  goEdit() { wx.navigateTo({ url: '/pages/editor/editor?id=' + this.activityId }) },
  goDetail() { wx.navigateTo({ url: '/pages/activity/activity?id=' + this.activityId }) },

  // ---- 阶段推进 ----
  onTransition(e) {
    const next = e.currentTarget.dataset.next || NEXT_PHASE[this.view.activity.phase]
    if (!next) return
    this.setData({
      transitionOpen: true,
      transitionNext: next,
      transitionTitle: next === 'cancelled' ? '确认取消活动' : '确认进入' + (F.PHASE_LABELS[next] || next),
      reason: '',
      error: '',
    })
  },
  onTransitionClose() { this.setData({ transitionOpen: false }) },
  onReason(e) { this.setData({ reason: e.detail.value }) },
  onTransitionConfirm() {
    if (!this.data.reason.trim() || this.data.busy) return
    this.setData({ busy: true, error: '' })
    api.dispatchAndSync({
      type: 'activity.transition',
      activityId: this.activityId,
      next: this.data.transitionNext,
      reason: this.data.reason,
    }, this.revision, this).then(res => {
      this.revision = res.revision
      const label = this.data.transitionNext === 'cancelled' ? '活动已取消。' : '已进入' + (F.PHASE_LABELS[this.data.transitionNext] || '') + '。'
      this.setData({ busy: false, transitionOpen: false, message: label })
      api.toast(label)
      this.reload()
    }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
  },
})
