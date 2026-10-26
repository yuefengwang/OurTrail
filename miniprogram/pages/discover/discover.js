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

// 与 home.js cardMetrics 同口径（2026-10-23 跨页 L2）：指标只放路线事实（距离/爬升），
// 人数只留在 info 行一处，同一事实不在卡片上印两遍。缺字段整项不出现、绝不印 0。
// utils/* 冻结 ⇒ 派生函数暂住页内，待 utils 解冻后上收共享模块（债务登记：out/SWX2/requests.md 同族）。
// 与 home 拷贝的唯一差异：discoverView 投影把 confirmed/capacity 放在活动顶层
// （home 投影嵌套在 a.meta 下），其余逐行同形。
function cardMetrics(a) {
  const metrics = []
  if (a.routeSnapshot.distanceKm) metrics.push({ key: 'distance', label: '距离', value: String(a.routeSnapshot.distanceKm), unit: 'km' })
  if (a.routeSnapshot.ascentM) metrics.push({ key: 'ascent', label: '爬升', value: String(a.routeSnapshot.ascentM), unit: 'm' })
  return metrics
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
    // sheet 草稿：打开时从已应用筛选复制，输入只改草稿；取消丢弃，确认才写回 filters。
    draftFilters: emptyFilters(),
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
    // 卸载即作废所有在途请求：迟到回包不得再写 data/revision/地图选择。
    this._reqSeq = (this._reqSeq || 0) + 1
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
    const seq = (this._reqSeq = (this._reqSeq || 0) + 1)
    const stale = () => seq !== this._reqSeq
    const request = { kind: 'discover', search }
    // 空筛选不带键：旧行为的 read 请求仍恰好是 {kind, search}（门禁钉点）。
    if (filters.dateFrom) request.dateFrom = filters.dateFrom
    if (filters.dateTo) request.dateTo = filters.dateTo
    if (filters.difficulty) request.difficulty = filters.difficulty
    if (this.data.sort === 'start') request.sort = 'start'

    return api.read(request).then(res => {
      if (stale()) return
      this.revision = res.revision
      this.now = res.now
      if (res.view.kind === 'denied') {
        this.setData({ loading: false, denied: res.view.message })
        return
      }
      const cards = res.view.activities.map(a => {
        const difficulty = F.difficultyLabel(a.routeSnapshot && a.routeSnapshot.difficulty)
        return {
          id: a.id,
          // 封面：优先后端解析的实拍封面；没有才退回按活动 id 派生的氛围图
          cover: a.coverFileId || covers.coverFor(a.id),
          title: a.title || '未命名活动',
          date: F.dateLabel(a.startAt),
          // 路线事实分槽（2026-10-23 跨页 L2）：路线名走 routeName、距离/爬升走 metrics，
          // meta 只留组织者标注的难度；缺里程碑也不印「· 0 km」（没填 ≠ 0 公里）。
          meta: difficulty,
          // N3：sub 行主语与指标行交给 activity-card 的新形态（与 home 同口径）；
          // meta 保留作未传 routeName 时的回落与投影契约，不删。
          routeName: a.routeSnapshot.title || '路线待完善',
          metrics: cardMetrics(a),
          status: a.owner ? '我组织的' : (F.PHASE_LABELS[a.phase] || a.phase),
          // L2（2026-10-23）：发现页不再提升任意一张为重点——列表卡统一横向紧凑形态，
          // 「最新发布」由排序 chip 说，不由视觉抬价暗示。
          featured: false,
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
        map: { visible: map.visible, markers: map.markers, markerMap: map.markerMap, latitude: map.latitude, longitude: map.longitude, scale: map.scale, includePoints: map.includePoints },
        mapSelected: null,
        emptyTitle: search ? '没有匹配的活动' : (count ? '没有符合条件的活动' : '还没有发布的活动'),
        /* D-06：删掉的第二行导语里的 scope 语义在这里补回来——「只含尚未出发」是列表本身的
           范围，「筛选同时生效」是空态的成因；两句都不占首屏。 */
        emptyDetail: search
          ? '列表只含尚未出发的活动；换个关键词，或清空搜索。'
          : (count ? '列表只含尚未出发的活动；放宽日期或难度，或清除筛选。' : '列表只含尚未出发的活动；等有人发起下一场，你也可以先开一场。'),
        emptyAction: search ? '清除搜索' : (count ? '清除筛选' : ''),
      })
    }).catch(e => {
      if (stale()) return
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
    // 复制而非共用：sheet 里的三次输入只动草稿，列表与已应用计数不受影响。
    this.setData({
      filtersOpen: true,
      filterError: '',
      draftFilters: Object.assign({}, this.data.filters),
    })
  },

  onCloseFilters() {
    // 取消＝丢弃草稿；把草稿复位到已应用值，下次打开不会看见被放弃的输入。
    this.setData({
      filtersOpen: false,
      filterError: '',
      draftFilters: Object.assign({}, this.data.filters),
    })
  },

  onDateFrom(e) {
    this.setData({ draftFilters: Object.assign({}, this.data.draftFilters, { dateFrom: e.detail.value }), filterError: '' })
  },

  onDateTo(e) {
    this.setData({ draftFilters: Object.assign({}, this.data.draftFilters, { dateTo: e.detail.value }), filterError: '' })
  },

  onDifficultyFilter(e) {
    const option = DIFFICULTY_FILTERS[Number(e.detail.value)] || DIFFICULTY_FILTERS[0]
    this.setData({ draftFilters: Object.assign({}, this.data.draftFilters, { difficulty: option.value }), filterError: '' })
  },

  onSort(e) {
    const sort = e.currentTarget.dataset.sort === 'start' ? 'start' : 'published'
    this.setData({ sort }, () => this.reload())
  },

  onApplyFilters() {
    const f = this.data.draftFilters
    if (f.dateFrom && f.dateTo && f.dateFrom > f.dateTo) {
      this.setData({ filterError: '结束日期不能早于开始日期。' })
      return
    }
    // 校验先于应用：逆序日期既不改 filters/计数，也不关闭面板、不外呼。
    // filterCount 由 reload 按真实结果写：同步预写会让「筛选已生效」早于结果到达。
    this.setData({
      filters: Object.assign({}, f),
      filtersOpen: false,
      filterError: '',
    }, () => this.reload())
  },

  onResetFilters() {
    // sheet 内的「清除筛选」只清草稿：确认（应用）后才真正重查。
    this.setData({ draftFilters: emptyFilters(), filterError: '' })
  },

  onEmptyAction() {
    if (this.data.search) return this.onClearSearch()
    if (this.data.filterCount) {
      // 空态上的「清除筛选」是明确即时操作，不是草稿编辑。
      this.setData({
        filters: emptyFilters(),
        draftFilters: emptyFilters(),
        filtersOpen: false,
        filterError: '',
      }, () => this.reload())
    }
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
