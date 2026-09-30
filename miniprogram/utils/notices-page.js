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

module.exports = function makeNoticesPage(getActivityId, opts) {
  const tabBarIndex = opts && Number.isInteger(opts.tabBarIndex) ? opts.tabBarIndex : null
  return {
    data: {
      loading: true,
      denied: '',
      items: [],
      canPublish: false,
      publishOpen: false,
      content: '',
      audienceKind: 'activity',
      audienceOptions: ['本活动相关人员', '指定报名人员', '指定车辆'],
      target: '',
      message: '',
      error: '',
      vehicles: [],
    },

    onLoad(options) {
      this._options = options || {}
      this._tabBarIndex = tabBarIndex
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
        this.setData({ loading: false, denied: '', items })
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
          this.setData({ items, canPublish })
          if (res.view.kind === 'activity') this.now = res.now
        })
      }).catch(() => {
        // 非所有者：不显示发布与投递记录
        this.setData({ items: this.data.items.map(i => Object.assign({}, i, { owned: false, deliveries: [] })), canPublish: false })
      })
    },

    onOpenPublish() {
      const activityId = this.activityId()
      if (!activityId) return
      const saved = draft.getDraft(activityId, 'notice')
      this.setData({ publishOpen: true, content: saved ? saved.content || '' : '' })
    },
    onClosePublish() { this.setData({ publishOpen: false }) },

    onContent(e) {
      const activityId = this.activityId()
      if (activityId) draft.setDraft(activityId, 'notice', { content: e.detail.value })
      this.setData({ content: e.detail.value })
    },
    onAudience(e) {
      this.setData({ audienceKind: ['activity', 'signups', 'vehicle'][Number(e.detail.value) || 0] })
    },
    onTarget(e) { this.setData({ target: e.detail.value }) },

    onPublish() {
      const activityId = this.activityId()
      if (!activityId || !this.data.content.trim()) return
      let audience
      if (this.data.audienceKind === 'vehicle') {
        audience = { kind: 'vehicle', vehicleId: this.data.target.trim() }
      } else if (this.data.audienceKind === 'signups') {
        audience = { kind: 'signups', signupIds: this.data.target.split(/[,，\s]+/).filter(Boolean) }
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
