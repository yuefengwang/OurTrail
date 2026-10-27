// 路线库列表（V2.0）：我的路线 + 共享给我的路线。
// 数据来自云端 readRoutes（selectors 投影：只给列表需要的字段，不含轨迹折线）。
// 路线的主要来源是创建活动时自动沉淀的私有路线；共享路线带「已共享」徽标。
//
// 2026-10-17 UI 重构二阶段：列表按「我的 / 共享给我」分组（投影本就给出 isOwner，
// 之前只在行内徽标里透出，扫一眼分不清哪些是自己的）。分组是纯展示派生，不动读取契约。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

const SOURCE_LABELS = { gpx: 'GPX 导入', manual: '手工整理', copy: '活动沉淀' }

Page({
  data: {
    loading: true,
    denied: '',
    routes: [],
    mineRoutes: [],
    sharedRoutes: [],
  },

  onShow() {
    // onShow 而不是 onLoad：从活动编辑器/路线详情返回后，列表要反映最新沉淀
    this.reload()
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  reload() {
    return api.readRoutes().then(res => {
      const routes = (res.routes || []).map(r => ({
        id: r.id,
        title: r.title || '未命名路线',
        sourceText: SOURCE_LABELS[r.source] || r.source,
        difficultyText: F.difficultyLabel(r.difficulty),
        shared: r.visibility === 'shared',
        mine: r.isOwner,
        riskText: r.riskCount > 0 ? r.riskCount + ' 条风险提示' : '暂无风险提示',
        metrics: routeMetrics(r),
        refText: r.referencedCount > 0 ? '被 ' + r.referencedCount + ' 个活动使用' : '还没有活动使用',
        updatedText: r.updatedAt ? '保存于 ' + F.dateLabel(r.updatedAt) : '早期路线',
      }))
      this.setData({
        loading: false,
        denied: '',
        routes,
        mineRoutes: withIndexText(routes.filter(r => r.mine)),
        sharedRoutes: withIndexText(routes.filter(r => !r.mine)),
      })
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/route/route?id=' + id })
  },

  onNewRoute() {
    wx.navigateTo({ url: '/pages/route-edit/route-edit' })
  },
})

// WXML 表达式里不能出现 HTML 实体（`&lt;` 会被当成 unexpected token），序号在 JS 里算好。
function withIndexText(list) {
  return list.map((r, i) => Object.assign({}, r, { indexText: (i + 1 < 10 ? '0' : '') + (i + 1) }))
}

// 距离与爬升缺则不印，节点保留零值。
function routeMetrics(r) {
  const list = []
  if (r.distanceKm > 0) list.push({ value: r.distanceKm, unit: 'km', label: '路线里程' })
  if (r.ascentM > 0) list.push({ value: r.ascentM, unit: 'm', label: '累计爬升' })
  list.push({ value: r.pointCount, unit: '', label: '路线节点' })
  return list
}
