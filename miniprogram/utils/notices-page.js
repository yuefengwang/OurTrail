// 通知页共享逻辑（原型 screens/Notices.tsx）：
// 通知 Tab 与活动内通知复用；组织者可发布、复制、记录投递。
//
// 第二参 opts.tabBarIndex：Tab 页才传（通知 Tab=2）。自定义 TabBar 的选中态由各 Tab 页
// 在 onShow 自报（组件 data.selected 硬编码 0、无路由自检，不设就永远高亮「活动」——
// 通知页此前从未设置过，是评审挖出的现存 bug）；anotices 非 Tab 页共用本工厂，不传即零影响。
'use strict'
const api = require('./api')
const draft = require('./draft')
const F = require('./format')

// D-02 B：首屏 20 条 + 每次再展开 20 条。只省渲染与 setData 体积，
// 列表读仍是全量（服务端游标分页未做），所以界面任何文案都不得暗示「下载变少了」。
const PAGE_SIZE = 20

module.exports = function makeNoticesPage(getActivityId, opts) {
  const tabBarIndex = opts && Number.isInteger(opts.tabBarIndex) ? opts.tabBarIndex : null
  return {
    data: {
      loading: true,
      denied: '',
      items: [],
      visibleItems: [],
      hiddenCount: 0,
      canPublish: false,
      publishOpen: false,
      content: '',
      audienceKind: 'activity',
      audienceOptions: ['本活动相关人员', '指定报名人员', '指定车辆'],
      signupRows: [],
      vehicleRows: [],
      vehicleIndex: -1,
      targetsError: '',
      targetsLoading: false,
      message: '',
      error: '',
      vehicles: [],
    },

    onLoad(options) {
      this._options = options || {}
      this._tabBarIndex = tabBarIndex
      this._visibleCount = PAGE_SIZE
    },

    onShow() {
      if (this._tabBarIndex !== null && typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ selected: this._tabBarIndex })
      }
      this.reload()
    },

    onPullDownRefresh() {
      this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
    },

    activityId() {
      return getActivityId.call(this)
    },

    /* items 持全量（计数、handler 查表都用它），visibleItems 才进 WXML。
       已展开的条数在重读/刷新后保留；列表缩短时收敛到实有条数。 */
    applyItems(items, extra) {
      const count = Math.min(Math.max(this._visibleCount || PAGE_SIZE, PAGE_SIZE), items.length)
      this._visibleCount = count
      this.setData(Object.assign({
        items,
        visibleItems: items.slice(0, count),
        hiddenCount: items.length - count,
      }, extra || {}))
    },

    onLoadMore() {
      if (!this.data.hiddenCount) return
      this._visibleCount = (this._visibleCount || PAGE_SIZE) + PAGE_SIZE
      this.applyItems(this.data.items)
    },

    reload() {
      const activityId = this.activityId()
      const request = activityId ? { kind: 'notices', activityId } : { kind: 'notices' }
      return api.read(request).then(res => {
        this.revision = res.revision
        this.now = res.now
        if (res.view.kind === 'denied') {
          this.setData({ loading: false, denied: res.view.message })
          return
        }
        const items = res.view.notices.slice().reverse().map(n => ({
          id: n.id,
          activityId: n.activityId,
          content: n.content,
          time: F.dtFull(n.publishedAt),
          read: n.read,
        }))
        this.applyItems(items, { loading: false, denied: '' })
        if (activityId) this.loadPublishContext(activityId)
      }).catch(e => {
        this.setData({ loading: false, denied: api.errorText(e) })
      })
    },

    loadPublishContext(activityId) {
      // 组织者才有发布/复制/投递记录（readNoticeManagement 仅所有者可读）
      api.readOr('readNoticeManagement', { activityId }).then(mgmt => {
        const owned = new Map(mgmt.notices.map(n => [n.id, n]))
        const items = this.data.items.map(item => {
          const own = owned.get(item.id)
          return Object.assign({}, item, {
            owned: !!own,
            deliveries: own ? own.deliveries.map(d => ({
              id: d.id,
              label: (d.channel === 'copy' ? '复制' : '模拟订阅') + ' · ' + ({
                copied: '已复制', simulated_success: '模拟成功', failed: '失败', not_authorized: '未授权',
              })[d.status],
            })) : [],
          })
        })
        // 是否可发布：活动未归档/未取消
        return api.read({ kind: 'activity', activityId, perspective: 'participant' }).then(res => {
          const canPublish = res.view.kind === 'activity'
            && ['archived', 'cancelled'].indexOf(res.view.activity.phase) === -1
          // 发布上下文里读到的 revision 才是发布/已读/投递命令的 CAS 基准（写实例，不进 data）
          this.revision = res.revision
          this.applyItems(items, { canPublish })
          if (res.view.kind === 'activity') this.now = res.now
        })
      }).catch(() => {
        // 非所有者：不显示发布与投递记录
        this.applyItems(this.data.items.map(i => Object.assign({}, i, { owned: false, deliveries: [] })), { canPublish: false })
      })
    },

    onOpenPublish() {
      const activityId = this.activityId()
      if (!activityId) return
      const saved = draft.getDraft(activityId, 'notice')
      this.setData({
        publishOpen: true,
        content: saved ? saved.content || '' : '',
        signupRows: [],
        vehicleRows: [],
        vehicleIndex: -1,
        targetsError: '',
        error: '',
      })
      this.loadTargets(activityId)
    },
    onClosePublish() { this.setData({ publishOpen: false }) },

    // 定向通知的候选来源（P0-3：原先要求手填 signup ID/车辆 ID，全站无处可查，是功能性死路）。
    // 名单走 organizer 视角 read（rows 即全部报名），车辆走 readTransport（组织者专属）。
    loadTargets(activityId) {
      // 「名单空着」与「没有人报名/没有车」是两件事：读失败必须点名是**哪一个**没读到并给出去路，
      // 不能留着空数组让页面印成业务事实（铁律 24 的话术分岔 + 铁律 26② 的「判不出≠否定」；B4-C19）。
      // 在途也算一件要说的事：miniprogram/AGENTS.md 的第 5 条要求 loading 与 empty 分开，
      // 否则点开弹层的那一秒会先印「此活动还没有报名记录。」再翻成名单。
      //
      // 尝试令牌：关弹层再重开 / 点重试都可能让两次读并存。慢的那一发后回来时若照写，
      // 就会用**上一次的结论**盖掉这一次的读数（名单其实已经读到了，页面却说「没有读到」）——
      // 那正是本条要修的"成因指错"，只是换了个触发路径，所以同一处收口。
      const token = (this._targetsToken || 0) + 1
      this._targetsToken = token
      const fresh = () => this._targetsToken === token
      const errs = []
      let pending = 2
      const settle = () => {
        if (!fresh()) return
        if (--pending === 0) this.setData({ targetsLoading: false, targetsError: errs.join('；') })
      }
      this.setData({ targetsLoading: true, targetsError: '' })
      api.read({ kind: 'activity', activityId, perspective: 'organizer' }).then(res => {
        if (res.view.kind === 'activity') {
          const rows = res.view.rows || []
          if (fresh()) this.setData({
            signupRows: rows.map(r => ({
              id: r.signupId,
              label: (r.name || '未命名') + ' · ' + (F.STATUS_LABELS[r.status] || r.status),
              checked: false,
            })),
          })
        } else if (fresh()) {
          errs.push('报名名单没有读到：这一视角没有返回名单')
        }
        settle()
      }).catch(e => {
        if (fresh()) errs.push('报名名单没有读到：' + api.errorText(e))
        settle()
      })
      api.readOr('readTransport', { activityId }).then(t => {
        const vehicles = t.vehicles || []
        if (fresh()) this.setData({
          vehicleRows: vehicles.map(v => ({
            id: v.id,
            label: (v.label || '车辆') + (v.plate ? ' · ' + v.plate : ''),
          })),
          vehicleIndex: vehicles.length ? 0 : -1,
        })
        settle()
      }).catch(e => {
        if (fresh()) errs.push('车辆名单没有读到：' + api.errorText(e))
        settle()
      })
    },

    // 失败态的可行动性：给一条就在眼前的重试路径，而不是只把红字印出来（读操作才允许重试，见铁律 24）
    onRetryTargets() {
      const activityId = this.activityId()
      if (!activityId) return
      this.setData({ signupRows: [], vehicleRows: [], vehicleIndex: -1, targetsError: '', error: '' })
      this.loadTargets(activityId)
    },
    onToggleSignupTarget(e) {
      const id = e.currentTarget.dataset.id
      this.setData({
        signupRows: this.data.signupRows.map(r => Object.assign({}, r, { checked: r.id === id ? !r.checked : r.checked })),
      })
    },
    onVehicleTarget(e) {
      this.setData({ vehicleIndex: Number(e.detail.value) })
    },

    onContent(e) {
      const activityId = this.activityId()
      if (activityId) draft.setDraft(activityId, 'notice', { content: e.detail.value })
      this.setData({ content: e.detail.value })
    },
    onAudience(e) {
      this.setData({ audienceKind: ['activity', 'signups', 'vehicle'][Number(e.detail.value) || 0], error: '' })
    },

    onPublish() {
      const activityId = this.activityId()
      if (!activityId || !this.data.content.trim()) return
      let audience
      if (this.data.audienceKind === 'vehicle') {
        const v = this.data.vehicleRows[this.data.vehicleIndex]
        if (!v) {
          // 读失败时不许说「此活动还没有车辆档案」——那是把没读到印成业务事实（B4-C19）
          this.setData({ error: this.data.targetsError
            ? '暂时不能按车辆定向发布：' + this.data.targetsError + '。可点「重新读取名单」，或改选「本活动相关人员」。'
            : '此活动还没有车辆档案——先到工作台「分车」添加车辆，或改选其他通知范围。' })
          return
        }
        audience = { kind: 'vehicle', vehicleId: v.id }
      } else if (this.data.audienceKind === 'signups') {
        const ids = this.data.signupRows.filter(r => r.checked).map(r => r.id)
        if (!ids.length) {
          this.setData({ error: this.data.targetsError
            ? '暂时不能按人定向发布：' + this.data.targetsError + '。可点「重新读取名单」，或改选「本活动相关人员」。'
            : '至少勾选一名要通知的报名人员。' })
          return
        }
        audience = { kind: 'signups', signupIds: ids }
      } else {
        audience = { kind: 'activity' }
      }
      api.dispatchAndSync({ type: 'notice.publish', activityId, audience, content: this.data.content }, this.revision, this)
        .then(() => {
          draft.clearDraft(activityId, 'notice')
          this.setData({ publishOpen: false, content: '', message: '通知已发布。' })
          this.reload()
        })
        .catch(e => this.setData({ error: api.errorText(e) }))
    },

    onMarkRead(e) {
      const { id, activityId } = e.currentTarget.dataset
      api.dispatchAndSync({ type: 'notice.read', activityId, noticeId: id }, this.revision, this)
        .then(() => this.reload())
        .catch(err => this.setData({ error: api.errorText(err) }))
    },

    onOpenActivity(e) {
      const id = e.currentTarget.dataset.id
      draft.rememberActivity(id)
      wx.navigateTo({ url: '/pages/activity/activity?id=' + id })
    },

    onCopy(e) {
      const { id, activityId } = e.currentTarget.dataset
      const item = this.data.items.find(i => i.id === id)
      if (!item) return
      wx.setClipboardData({
        data: item.content,
        success: () => {
          // 记录复制投递（审计）
          api.dispatchAndSync({ type: 'notice.delivery', activityId, noticeId: id, channel: 'copy', status: 'copied', detail: '小程序剪贴板复制' }, this.revision, this)
            .then(() => { this.setData({ message: '已复制；复制记录已保存。请自行选择发送对象。' }); this.reload() })
            .catch(err => this.setData({ message: '已复制，但记录未保存：' + api.errorText(err) }))
        },
      })
    },
  }
}
