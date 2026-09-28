// 发现活动：已发布且未出发的活动列表（只读），支持搜索。
// 对应 ADR-0003：V1 提前开放公开发现；治理能力（认证/举报）后补。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

const SEARCH_DEBOUNCE = 300

Page({
  data: {
    loading: true,
    denied: '',
    search: '',
    cards: [],
    emptyTitle: '',
    emptyDetail: '',
  },

  onLoad() {
    this.setData({ search: '' })
  },

  onShow() {
    this.reload()
  },

  onUnload() {
    this.clearSearchTimer()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  clearSearchTimer() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer)
      this.searchTimer = null
    }
  },

  reload() {
    const search = (this.data.search || '').trim()
    return api.read({ kind: 'discover', search }).then(res => {
      this.revision = res.revision
      this.now = res.now
      if (res.view.kind === 'denied') {
        this.setData({ loading: false, denied: res.view.message })
        return
      }
      const cards = res.view.activities.map((a, i) => ({
        id: a.id,
        title: a.title || '未命名活动',
        date: F.dateLabel(a.startAt),
        meta: (a.routeSnapshot.title || '路线待完善') + ' · ' + a.routeSnapshot.distanceKm + ' km',
        status: a.owner ? '我组织的' : (F.PHASE_LABELS[a.phase] || a.phase),
        featured: i === 0,
        info: [
          a.organizerIntro,
          '已确认 ' + a.confirmed + ' 人',
          '名额 ' + a.capacity + ' 人',
          a.acceptingSignups ? '可报名' : '暂不报名',
        ].filter(Boolean).join(' · '),
      }))
      this.setData({
        loading: false,
        denied: '',
        cards,
        emptyTitle: search ? '没有匹配的活动' : '还没有发布的活动',
        emptyDetail: search
          ? '换个关键词，或清空搜索看看全部已发布的活动。'
          : '等有人发起第一场同行，你也可以先开一场。',
      })
    }).catch(e => {
      this.setData({ loading: false, denied: api.errorText(e) })
    })
  },

  onSearch(e) {
    this.setData({ search: e.detail.value })
    this.clearSearchTimer()
    this.searchTimer = setTimeout(() => this.reload(), SEARCH_DEBOUNCE)
  },

  onClearSearch() {
    this.clearSearchTimer()
    this.setData({ search: '' }, () => this.reload())
  },

  onOpenCard(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/activity/activity?id=' + id })
  },
})
