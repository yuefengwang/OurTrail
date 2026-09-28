// 首页（活动 Tab）：三视角读取合并 + 协作任务 + 我的/最近/已结束筛选 + 搜索。
// 对应原型 screens/ActivityHome.tsx。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')

Page({
  data: {
    loading: true,
    denied: '',
    profileName: '',
    filter: 'mine',
    search: '',
    tasks: [],
    cards: [],
    emptyTitle: '',
    emptyDetail: '',
    emptyAction: '',
  },

  onLoad() {
    this.cache = new Map()
    this.openedIds = []
    this.setData({ filter: 'mine', search: '' })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh())
  },

  reload() {
    const opened = draft.getOpened()
    this.openedIds = opened
    return Promise.all([
      api.read({ kind: 'home', perspective: 'participant', openedActivityIds: opened }),
      api.read({ kind: 'home', perspective: 'staff', openedActivityIds: [] }),
      api.read({ kind: 'home', perspective: 'vehicle', openedActivityIds: [] }),
      api.read({ kind: 'profile' }),
    ]).then(([home, staffHome, vehicleHome, profile]) => {
      if (home.view.kind === 'denied') {
        this.setData({ loading: false, denied: home.view.message })
        return
      }
      const byId = new Map()
      for (const view of [home, staffHome, vehicleHome]) {
        if (view.view.kind === 'home') {
          for (const a of view.view.activities) if (!byId.has(a.id)) byId.set(a.id, a)
        }
      }
      this.cache = byId
      const profileName = profile.view.kind === 'profile' ? profile.view.profile.person.name : ''
      this.setData({ loading: false, denied: '', profileName })
      this.render()
    }).catch(e => {
      this.setData({ loading: false, denied: api.errorText(e) })
    })
  },

  render() {
    const byId = this.cache || new Map()
    const all = Array.from(byId.values())
    const filter = this.data.filter
    const search = this.data.search.trim().toLowerCase()
    const tasks = all
      .filter(a => ['archived', 'cancelled'].indexOf(a.phase) === -1 && (a.meta.staff || a.meta.vehicle))
      .sort((a, b) => (a.startAt ? Date.parse(a.startAt) : Infinity) - (b.startAt ? Date.parse(b.startAt) : Infinity))
      .map(a => ({
        id: a.id,
        title: a.title || '未命名草稿',
        roles: [a.meta.staff ? '现场协作' : '', a.meta.vehicle ? '车辆联络' : ''].filter(Boolean).join(' · '),
        phase: F.PHASE_LABELS[a.phase] || a.phase,
        goStaff: !!a.meta.staff,
      }))
    const filtered = all.filter(a => {
      const ended = ['archived', 'cancelled'].indexOf(a.phase) !== -1
      let inScope
      if (filter === 'recent') inScope = this.openedIds.indexOf(a.id) !== -1
      else if (filter === 'finished') inScope = ended
      else inScope = (a.meta.owner || a.meta.joined) && !ended
      if (!inScope) return false
      if (!search) return true
      const hay = (a.title + ' ' + a.routeSnapshot.title + ' ' + a.description).toLowerCase()
      return hay.indexOf(search) !== -1
    }).sort((a, b) => (a.startAt ? Date.parse(a.startAt) : Infinity) - (b.startAt ? Date.parse(b.startAt) : Infinity))
    const featuredId = filtered.length ? filtered[0].id : ''
    const cards = filtered.map(a => ({
      id: a.id,
      title: a.title || '未命名草稿',
      date: F.dateLabel(a.startAt),
      meta: (a.routeSnapshot.title || '路线待完善') + ' · ' + a.routeSnapshot.distanceKm + ' km',
      status: a.meta.owner ? '我组织的 · ' + (F.PHASE_LABELS[a.phase] || a.phase)
        : (a.meta.joined ? (F.PHASE_LABELS[a.phase] || a.phase) : '最近查看'),
      featured: a.id === featuredId && a.phase !== 'draft',
      info: '已确认 ' + a.meta.confirmed + ' 人 · 待审核 ' + a.meta.pending + ' 人 · 名额 ' + a.meta.capacity + ' 人',
    }))
    let emptyTitle = '留一点时间，走进山野'
    let emptyDetail = '这里仅显示与你有关或你打开过的活动。收到活动链接后，可以查看安排并报名。'
    let emptyAction = '发起一场同行'
    if (search) {
      emptyTitle = '没有匹配的活动'
      emptyDetail = '换个关键词，或切换活动范围。'
      emptyAction = '清除搜索'
    } else if (filter === 'recent') {
      emptyTitle = '还没有最近查看的活动'
      emptyAction = ''
    }
    this.setData({ tasks, cards, emptyTitle, emptyDetail, emptyAction, hasAny: all.length > 0 })
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.value }, () => this.render())
  },

  onSearch(e) {
    this.setData({ search: e.detail.value }, () => this.render())
  },

  onClearSearch() {
    this.setData({ search: '' }, () => this.render())
  },

  onNew() {
    wx.navigateTo({ url: '/pages/editor/editor' })
  },

  onGoDiscover() {
    wx.navigateTo({ url: '/pages/discover/discover' })
  },

  onOpenCard(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    draft.rememberActivity(id)
    wx.navigateTo({ url: '/pages/activity/activity?id=' + id })
  },

  onOpenTask(e) {
    const id = e.currentTarget.dataset.id
    const goStaff = e.currentTarget.dataset.gostaff
    draft.rememberActivity(id)
    if (goStaff) wx.navigateTo({ url: '/pages/staff/staff?id=' + id })
    else wx.navigateTo({ url: '/pages/vehicle/vehicle?id=' + id })
  },

  onEmptyAction() {
    if (this.data.search) this.onClearSearch()
    else this.onNew()
  },
})
