// 组织者工作台（原型 screens/Workspace.tsx）：总览 / 名单 / 分车 / 现场。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const J = require('../../utils/journey')

const NEXT_PHASE = { published: 'gathering', gathering: 'active', active: 'closing', closing: 'archived' }
const TABS = ['总览', '名单', '分车', '现场']
const TAB_BY_TARGET = { roster: 1, transport: 2, field: 3, edit: 0 }

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
    selfTravel: 0,
    vehicleTravel: 0,
    assigned: 0,
    tripSummaryLine: '',
    thirdValue: 0,
    thirdLabel: '待签到',
    // 总览
    waitlisted: 0,
    unchecked: 0,
    openIncidents: 0,
    pendingHome: 0,
    queue: [],
    milestone: '',
    notVerified: 0,
    transitionHint: '',
    phaseTimeline: [],
    canTransition: false,
    nextPhaseLabel: '',
    canCancel: false,
    canEdit: false,
    // 三个面板常驻（切区不丢勾选/表单），所以由页面把「我这次读到的后端状态」下发给它们：
    // 面板只在 phase@revision 与自己上次读的不一致时才重读，既不会停在旧阶段，也不会每次切区全量重读。
    syncKey: '',
    // 弹层
    transitionOpen: false,
    transitionNext: '',
    transitionDanger: false,
    transitionTitle: '',
    reason: '',
    error: '',
    message: '',
    busy: false,
    busyAt: 0,
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.setData({ activityId: this.activityId })
  },

  onShow() {
    this.reload()
  },

  reload() {
    // busy 只是「这次写还没落地」的界面姿态，不是业务状态。某条命令的 promise 没能回来时，
    // 它绝不能把整块面板永久锁成「看着能点、点了没反应」——真机实测过一个残留 busy
    // 锁死组织者工作台整条分车链，而屏幕上没有任何一处说明为什么。
    if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {
      this.setData({ busy: false, busyAt: 0 })
      console.warn('[busy] 清掉一个超过 8 秒没落地的写状态')
    }
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
      // 指标位与阶段成对：在场上看「待签到」，收尾看「待到家」。措辞与切换规则只在 journey 里有一份。
      const metric = J.fieldMetric(phase)
      const rows = v.rows || []
      const confirmed = rows.filter(r => r.status === 'confirmed')
      // 推进门槛的「谁挡着」全部来自投影好的行标志，页面不重述域内规则（AGENTS.md 铁律 19）。
      const notVerified = confirmed.filter(r => r.departure === 'unknown').length
      const coordinating = confirmed.filter(r => r.departure === 'coordinating').length
      const missingBoarding = confirmed.filter(r => r.departure === 'joined' && r.needsOutboundBoarding).length
      const hasTravelFact = confirmed.some(r => r.departure === 'joined' || r.outboundBoarded || r.returnBoarded || r.home)
      const queue = J.leaderQueue({
        phase, now: res.now, startAt: a.startAt, deadlineAt: a.deadlineAt,
        meetingAt: (a.pickupPoints[0] || {}).meetingAt || null,
        vehicleTravel: v.counters.vehicleTravel, counters: v.counters,
      })
      const blocker = J.transitionBlocker({
        next, counters: v.counters, unassignedBoarding: missingBoarding, coordinating, hasTravelFact,
      })
      this.setData({
        loading: false,
        denied: '',
        eyebrow: '组织者工作台',
        phaseLabel: J.phaseLabel(phase),
        subtitle: J.phaseScene(phase),
        title: a.title || '未命名活动',
        pending: v.counters.pending,
        unassigned: v.counters.unassigned,
        // 出行方式构成：领队要处理的只有「需要乘车且还没排到车」的那一格，
        // 自行前往的人不是缺事项，不能和他们混在同一个计数里。
        selfTravel: v.counters.selfTravel,
        vehicleTravel: v.counters.vehicleTravel,
        assigned: v.counters.assigned,
        tripSummaryLine: J.tripMixLine(v.counters),
        waitlisted: v.counters.waitlisted,
        unchecked: v.counters.unchecked,
        openIncidents: v.counters.openIncidents,
        pendingHome: v.counters.pendingHome,
        thirdValue: v.counters[metric.key],
        thirdLabel: metric.label,
        queue: queue.items,
        milestone: queue.milestone,
        notVerified,
        phaseTimeline: J.timeline(res.now, phase),
        syncKey: phase + '@' + res.revision,
        canTransition: !!next && v.permittedActions.indexOf('activity.transition') !== -1,
        nextPhaseLabel: next ? J.TRANSITION_LABEL[next] || J.phaseLabel(next) : '',
        transitionHint: blocker,
        canCancel: v.permittedActions.indexOf('activity.transition') !== -1
          && ['draft', 'published', 'gathering'].indexOf(phase) !== -1,
        canEdit: v.permittedActions.indexOf('activity.edit') !== -1,
      })
      wx.setNavigationBarTitle({ title: '活动工作台' })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  onTab(e) {
    this.setData({ tab: Number(e.currentTarget.dataset.tab) })
    // 切区后从页顶开始读：每个区是一块独立工作面，不带着上一区的滚动位置
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0, fail: () => {} })
  },

  // 任一常驻面板写库成功（api.dispatchAndSync 触发 written 事件）后，页面重读一次并下发新
  // sync-key：面板写推进了全局 revision，兄弟面板不跟着重读，下一次命令必撞 CAS CONFLICT。
  onPanelSync() { this.reload() },

  goRoster() { this.setData({ tab: 1 }) },
  goTransport() { this.setData({ tab: 2 }) },
  goField() { this.setData({ tab: 3 }) },

  // 待办行由 leaderQueue 生成，每条自带「去哪个分区解决」——页面上不再各写一份跳转。
  goQueueItem(e) {
    const target = e.currentTarget.dataset.target
    if (target === 'edit') return wx.navigateTo({ url: '/pages/editor/editor?id=' + this.activityId })
    const tab = TAB_BY_TARGET[target]
    if (tab === undefined) return
    this.onTab({ currentTarget: { dataset: { tab } } })
  },
  goNotices() { wx.navigateTo({ url: '/pages/anotices/anotices?id=' + this.activityId }) },
  goEdit() { wx.navigateTo({ url: '/pages/editor/editor?id=' + this.activityId }) },
  goDetail() { wx.navigateTo({ url: '/pages/activity/activity?id=' + this.activityId }) },
  // denied 时不能再把人导去另一个 denied 页：没有活动编号就回首页。
  onDeniedAction() { if (this.activityId) this.goDetail(); else wx.switchTab({ url: '/pages/home/home' }) },

  // ---- 阶段推进 ----
  onTransition(e) {
    const next = e.currentTarget.dataset.next || NEXT_PHASE[this.view.activity.phase]
    if (!next) return
    this.setData({
      transitionOpen: true,
      transitionNext: next,
      transitionTitle: next === 'cancelled' ? '确认取消活动' : '确认进入' + (F.PHASE_LABELS[next] || next),
      // 按钮的危险配色由 JS 决定：模板不比较服务端枚举原文（模板只认布尔）。
      transitionDanger: next === 'cancelled',
      reason: '',
      error: '',
    })
  },
  onTransitionClose() { this.setData({ transitionOpen: false }) },
  onReason(e) { this.setData({ reason: e.detail.value }) },
  onTransitionConfirm() {
    if (!this.data.reason.trim() || this.data.busy) return
    this.setData({ busy: true, busyAt: Date.now(), error: '' })
    api.dispatchAndSync({
      type: 'activity.transition',
      activityId: this.activityId,
      next: this.data.transitionNext,
      reason: this.data.reason,
    }, this.revision, this).then(res => {
      this.revision = res.revision
      const label = this.data.transitionNext === 'cancelled' ? '活动已取消。' : '已进入' + (F.PHASE_LABELS[this.data.transitionNext] || '') + '。'
      wx.vibrateShort({ type: 'light', fail: () => {} })
      this.setData({ busy: false, transitionOpen: false, message: label })
      api.toast(label)
      this.reload()
    }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
  },
})
