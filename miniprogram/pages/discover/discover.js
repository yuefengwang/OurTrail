// 发现活动：已发布且未出发的活动列表（只读），支持搜索、日期/难度筛选、排序与地图。
// 对应 ADR-0003：V1 提前开放公开发现；治理能力（认证/举报）后补。
// 地图只用 discoverView 已经公开的路线节点坐标，不新增集合点/参与者字段。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const covers = require('../../utils/covers')

const SEARCH_DEBOUNCE = 300
const MARKER_ICONS = { start: '/assets/markers/start.png' }
const DIFFICULTY_FILTERS = [{ value: '', label: '不限难度' }].concat(
  F.DIFFICULTY_OPTIONS.filter(o => o.value)
)

function emptyFilters() {
  return { dateFrom: '', dateTo: '', difficulty: '' }
}

function filterCount(filters) {
  return (filters.dateFrom ? 1 : 0) + (filters.dateTo ? 1 : 0) + (filters.difficulty ? 1 : 0)
}

// 活动地图只取「第一个有坐标的路线节点」作为标记；没有坐标的活动不画点。
function buildDiscoverMap(activities) {
  const markerMap = []
  const markers = []
  for (const a of activities) {
    const point = (a.routeSnapshot && a.routeSnapshot.points || []).find(p => p.coordinates)
    if (!point) continue
    const markerId = markers.length
    markerMap.push({ markerId, activityId: a.id })
    markers.push({
      id: markerId,
      latitude: point.coordinates.lat,
      longitude: point.coordinates.lng,
      iconPath: MARKER_ICONS.start,
      width: 28,
      height: 28,
      callout: {
        content: a.title || '未命名活动',
        color: '#163E35',
        bgColor: '#FFFFFF',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#DEE3DB',
        padding: 7,
        fontSize: 12,
        display: 'BYTAP',
      },
    })
  }
  if (!markers.length) return { visible: false, markers: [], markerMap: [] }
  const lats = markers.map(m => m.latitude)
  const lngs = markers.map(m => m.longitude)
  const latMin = Math.min.apply(null, lats)
  const latMax = Math.max.apply(null, lats)
  const lngMin = Math.min.apply(null, lngs)
  const lngMax = Math.max.apply(null, lngs)
  const padLat = (latMax - latMin || 0.01) * 0.12
  const padLng = (lngMax - lngMin || 0.01) * 0.12
  return {
    visible: true,
    markers,
    markerMap,
    latitude: (latMin + latMax) / 2,
    longitude: (lngMin + lngMax) / 2,
    scale: markers.length === 1 ? 12 : 11,
    includePoints: [
      { latitude: latMin - padLat, longitude: lngMin - padLng },
      { latitude: latMax + padLat, longitude: lngMax + padLng },
    ],
  }
}

Page({
  data: {
    loading: true,
    denied: '',
    search: '',
    cards: [],
    emptyTitle: '',
    emptyDetail: '',
    emptyAction: '',
    // 视图与筛选
    viewMode: 'list',
    filtersOpen: false,
    filters: emptyFilters(),
    filterCount: 0,
    filterError: '',
    today: '',
    difficultyFilters: DIFFICULTY_FILTERS,
    sort: 'published',
    // 地图
    map: { visible: false, markers: [], markerMap: [] },
    mapSelected: null,
  },

  onLoad() {
    this.setData({ search: '', today: F.cnToday() })
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
    const filters = this.data.filters
    const request = { kind: 'discover', search }
    // 空筛选不带键：旧行为的 read 请求仍恰好是 {kind, search}（门禁钉点）。
    if (filters.dateFrom) request.dateFrom = filters.dateFrom
    if (filters.dateTo) request.dateTo = filters.dateTo
    if (filters.difficulty) request.difficulty = filters.difficulty
    if (this.data.sort === 'start') request.sort = 'start'

    return api.read(request).then(res => {
      this.revision = res.revision
      this.now = res.now
      if (res.view.kind === 'denied') {
        this.setData({ loading: false, denied: res.view.message })
        return
      }
      const cards = res.view.activities.map((a, i) => {
        const difficulty = F.difficultyLabel(a.routeSnapshot && a.routeSnapshot.difficulty)
        return {
          id: a.id,
          // 封面氛围图：按活动 id 稳定选取（utils/covers.js），同一活动恒同一张
          cover: covers.coverFor(a.id),
          title: a.title || '未命名活动',
          date: F.dateLabel(a.startAt),
          // 同 home：缺里程不印「· 0 km」（没填 ≠ 0 公里）
          meta: (a.routeSnapshot.title || '路线待完善')
            + (a.routeSnapshot.distanceKm ? ' · ' + a.routeSnapshot.distanceKm + ' km' : '')
            + (difficulty ? ' · ' + difficulty : ''),
          status: a.owner ? '我组织的' : (F.PHASE_LABELS[a.phase] || a.phase),
          // hero 只替页面已经说出口的那句话做视觉强调：不带搜索词/筛选时，第一条确实是「最新发布的一场」。
          featured: !search && filterCount(filters) === 0 && i === 0,
          info: [
            a.organizerIntro,
            '已确认 ' + a.confirmed + ' 人',
            '名额 ' + a.capacity + ' 人',
            a.acceptingSignups ? '可报名' : '暂不报名',
          ].filter(Boolean).join(' · '),
        }
      })
      const count = filterCount(filters)
      const map = buildDiscoverMap(res.view.activities)
      this._mapIndex = map.markerMap
      this.setData({
        loading: false,
        denied: '',
        cards,
        filterCount: count,
        filterError: '',
        map: { visible: map.visible, markers: map.markers, markerMap: map.markerMap, latitude: map.latitude, longitude: map.longitude, scale: map.scale, includePoints: map.includePoints },
        mapSelected: null,
        emptyTitle: search ? '没有匹配的活动' : (count ? '没有符合条件的活动' : '还没有发布的活动'),
        emptyDetail: search
          ? '换个关键词，或清空搜索看看全部已发布的活动。'
          : (count ? '放宽日期或难度，或者清除筛选看看全部已发布的活动。' : '等有人发起第一场同行，你也可以先开一场。'),
        emptyAction: search ? '清除搜索' : (count ? '清除筛选' : ''),
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

  onViewMode(e) {
    const mode = e.currentTarget.dataset.mode === 'map' ? 'map' : 'list'
    this.setData({ viewMode: mode })
  },

  onOpenFilters() {
    this.setData({ filtersOpen: true, filterError: '' })
  },

  onCloseFilters() {
    this.setData({ filtersOpen: false, filterError: '' })
  },

  onDateFrom(e) {
    this.setData({ filters: Object.assign({}, this.data.filters, { dateFrom: e.detail.value }), filterError: '' })
  },

  onDateTo(e) {
    this.setData({ filters: Object.assign({}, this.data.filters, { dateTo: e.detail.value }), filterError: '' })
  },

  onDifficultyFilter(e) {
    const option = DIFFICULTY_FILTERS[Number(e.detail.value)] || DIFFICULTY_FILTERS[0]
    this.setData({ filters: Object.assign({}, this.data.filters, { difficulty: option.value }), filterError: '' })
  },

  onSort(e) {
    const sort = e.currentTarget.dataset.sort === 'start' ? 'start' : 'published'
    this.setData({ sort }, () => this.reload())
  },

  onApplyFilters() {
    const f = this.data.filters
    if (f.dateFrom && f.dateTo && f.dateFrom > f.dateTo) {
      this.setData({ filterError: '结束日期不能早于开始日期。' })
      return
    }
    this.setData({ filtersOpen: false }, () => this.reload())
  },

  onResetFilters() {
    this.setData({ filters: emptyFilters(), filterError: '', filtersOpen: false }, () => this.reload())
  },

  onEmptyAction() {
    if (this.data.search) return this.onClearSearch()
    if (this.data.filterCount) return this.onResetFilters()
  },

  onMapMarkerTap(e) {
    const markerId = e.detail && e.detail.markerId
    const hit = (this._mapIndex || []).find(x => x.markerId === markerId)
    if (!hit) return
    const card = this.data.cards.find(c => c.id === hit.activityId)
    this.setData({ mapSelected: card || null })
  },

  onOpenCard(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/activity/activity?id=' + id })
  },
})
