// 首页（活动 Tab）：三视角读取合并 + 一个活动列表（我的/最近/已结束/需要协作四档）+ 搜索。
// 对应原型 screens/ActivityHome.tsx，但**页面结构在此处与原型分叉**（2026-10-20）：
// 原型把「需要我协作」做成列表上方的第二个列表，于是同一场活动可以同时进两个区、
// 且一屏出现两种列表形态。现在只有一个列表、一种卡片形态，协作动作下沉为卡片上的入口。
// 判据与原因：docs/superpowers/specs/2026-10-20-home-dual-list-dedup.md。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')
const J = require('../../utils/journey')

Page({
  data: {
    loading: true,
    denied: '',
    profileName: '',
    filter: 'mine',
    search: '',
    collabCount: 0,
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
      // 倒计时要有可信的「现在」——用服务端时钟，避免手机时间不准把「剩 3 天」算错
      this.now = home.now
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
    let filter = this.data.filter
    const search = this.data.search.trim().toLowerCase()
    // 协作判据只有一个出处：非终态 + 服务端投影的 meta.staff / meta.vehicle。
    // 同一批判据既决定「需要协作」这一档筛出哪些活动，也决定卡片上出哪几枚协作按钮——
    // 两处必须同一批，否则写着「3 项待办」点进去只剩 2 张卡。
    const isCollab = a => ['archived', 'cancelled'].indexOf(a.phase) === -1 && (a.meta.staff || a.meta.vehicle)
    const collabCount = all.filter(isCollab).length
    // 协作授权会过期（expiresAt 一到服务端就不再给 meta.staff/vehicle）：这一档空掉时停在原地
    // 只会得到一个「谁都没被选中」的筛选段和一句不相干的空态话，所以退回「我的活动」。
    if (filter === 'collab' && !collabCount) filter = 'mine'
    const filtered = all.filter(a => {
      const ended = ['archived', 'cancelled'].indexOf(a.phase) !== -1
      let inScope
      if (filter === 'recent') inScope = this.openedIds.indexOf(a.id) !== -1
      else if (filter === 'finished') inScope = ended
      else if (filter === 'collab') inScope = isCollab(a)
      else inScope = (a.meta.owner || a.meta.joined) && !ended
      if (!inScope) return false
      if (!search) return true
      const hay = (a.title + ' ' + a.routeSnapshot.title + ' ' + a.description).toLowerCase()
      return hay.indexOf(search) !== -1
    }).sort((a, b) => (a.startAt ? Date.parse(a.startAt) : Infinity) - (b.startAt ? Date.parse(b.startAt) : Infinity))
    const featuredId = filtered.length ? filtered[0].id : ''
    const cards = filtered.map(a => {
      // 协作按钮与「需要协作」那一档共用同一个判据；终态活动不再给入口（车长页对已结束的活动只是回看）。
      const roles = isCollab(a) ? J.collabRoles(a.meta) : []
      return {
        id: a.id,
        // 实拍封面是服务端事实，随卡片传；氛围图仍由 activity-card 按 activityId 派生
        cover: a.coverFileId || '',
        title: a.title || '未命名草稿',
        date: F.dateLabel(a.startAt),
        // 路线可整体后补（2026-10-14 快速创建）：缺里程就不印「· 0 km」——
        // 那会把「没填」印成「一场 0 公里的活动」，是凭空造事实。
        meta: (a.routeSnapshot.title || '路线待完善') + (a.routeSnapshot.distanceKm ? ' · ' + a.routeSnapshot.distanceKm + ' km' : ''),
        // 状态词只在 journey 一处定义；卡片再补一句「还有多久」，
        // 因为首页真正要回答的是「哪一场快到时间了」，不是「它在哪个 phase」。
        // 归属前缀按事实排：既不是组织者也不是报名者时，「最近查看」只是当时唯一可能的来由；
        // 现在「需要协作」这一档也会带进没点开过的活动，那种情况必须说他的角色，
        // 不能把「他被授了现场协作」印成「他不久前打开过这场」。
        status: (a.meta.owner ? '我组织的 · ' : a.meta.joined ? '' : (roles.length ? roles.map(r => r.label).join(' · ') + ' · ' : '最近查看 · ')) + J.phaseLabel(a.phase),
        when: a.startAt && ['archived', 'cancelled'].indexOf(a.phase) === -1 ? J.remaining(this.now, a.startAt).text : '',
        featured: a.id === featuredId && a.phase !== 'draft',
        // 「待审核 N 人」是组织者的工作队列，不是访问者此刻能行动的事——这条决定 activity.js 早已写下
        // （非组织者的同一格给他的下一步）。首页此前对所有人无条件印它，等于把参与者打不开的那个数字
        // 塞进他每次刷列表都要看见的一行。归属位只有一个出处：服务端 home 投影显式给的 meta.owner，
        // 客户端不比自己 ownerId、不从标签反推（铁律 19：domain → projection → label 单向）。
        // meta.owner 缺位按「非组织者」处理：越权数字失败关闭，而不是失败开放。
        info: [
          '已确认 ' + a.meta.confirmed + ' 人',
          a.meta.owner ? '待审核 ' + a.meta.pending + ' 人' : '',
          '名额 ' + a.meta.capacity + ' 人',
        ].filter(Boolean).join(' · '),
        // 卡片上的协作入口：[] 表示这个人在这场活动上没有欠下的协作事项。
        collab: roles,
      }
    })
    let emptyTitle = '留一点时间，走进山野'
    let emptyDetail = '这里仅显示与你有关或你打开过的活动。收到活动链接后，可以查看安排并报名。'
    let emptyAction = '发起一场同行'
    if (search) {
      emptyTitle = '没有匹配的活动'
      emptyDetail = '换个关键词，或切换活动范围。'
      emptyAction = '清除搜索'
    } else if (filter === 'recent') {
      emptyTitle = '还没有最近查看的活动'
      emptyDetail = '打开过一场活动之后，它会回到这里；也可以从「发现活动」开始。'
      emptyAction = ''
    }
    this.setData({ filter, collabCount, cards, emptyTitle, emptyDetail, emptyAction, hasAny: all.length > 0 })
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

  // 卡片上的协作入口。两条 URL 字面量必须留在这个页面文件里：
  // tools/journey-graph-test.js 静态扫页面 JS 的 navigateTo，而 staff / vehicle 两页
  // 在全仓库只有这一个入口。
  onCardCollab(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    draft.rememberActivity(id)
    // 两个角色各走各的。旧实现是一个 goStaff 布尔决定整行跳哪儿，一个人同时是现场协作
    // 与车辆联络时，车辆那一半再也进不去（docs/testing/ui-user-journeys.md §8.6）。
    if (e.detail.key === 'staff') wx.navigateTo({ url: '/pages/staff/staff?id=' + id })
    else if (e.detail.key === 'vehicle') wx.navigateTo({ url: '/pages/vehicle/vehicle?id=' + id })
  },

  onEmptyAction() {
    if (this.data.search) this.onClearSearch()
    else this.onNew()
  },
})
