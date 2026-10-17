// 发现活动：已发布且未出发的活动列表（只读），支持搜索。
// 对应 ADR-0003：V1 提前开放公开发现；治理能力（认证/举报）后补。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const covers = require('../../utils/covers')

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
        // 封面氛围图：按活动 id 稳定选取（utils/covers.js），同一活动恒同一张
        cover: covers.coverFor(a.id),
        title: a.title || '未命名活动',
        date: F.dateLabel(a.startAt),
        // 同 home：缺里程不印「· 0 km」（没填 ≠ 0 公里）
        meta: (a.routeSnapshot.title || '路线待完善') + (a.routeSnapshot.distanceKm ? ' · ' + a.routeSnapshot.distanceKm + ' km' : ''),
        status: a.owner ? '我组织的' : (F.PHASE_LABELS[a.phase] || a.phase),
        // hero 只替页面已经说出口的那句话做视觉强调：不带搜索词时，这一列就是本页声明的
        // 「按发布时间排序，只显示尚未出发的活动」，第一条确实是「最新发布的一场」。
        // 带搜索词时第一条只是「关键词恰好命中的第一条」，把它升成 26px 森林绿大卡
        // 等于替用户做一次没有依据的编辑性推荐（A-20），所以搜索结果一律不升 hero。
        // 判据只用本页已有的事实（搜索词是否为空），没有新造阈值、也没有从数组下标之外推归属。
        featured: !search && i === 0,
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
