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
        statsText: routeStats(r),
        refText: r.referencedCount > 0 ? '被 ' + r.referencedCount + ' 个活动使用' : '还没有活动使用',
        updatedText: r.updatedAt ? '保存于 ' + F.dateLabel(r.updatedAt) : '早期路线',
      }))
      this.setData({
        loading: false,
        denied: '',
        routes,
        mineRoutes: routes.filter(r => r.mine),
        sharedRoutes: routes.filter(r => !r.mine),
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

// 里程/爬升/节点/风险一行读完；缺的项不硬凑（0 km 不显示「0 公里」这种噪音）
function routeStats(r) {
  const parts = []
  if (r.distanceKm > 0) parts.push(r.distanceKm + ' km')
  if (r.ascentM > 0) parts.push('爬升 ' + r.ascentM + ' m')
  parts.push(r.pointCount + ' 节点')
  if (r.riskCount > 0) parts.push(r.riskCount + ' 风险')
  return parts.join(' · ')
}
