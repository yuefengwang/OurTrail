// 全图展示：把天气页的 meteogram 丢到一个横屏页面里放大看。
//
// 为什么是独立页面而不是弹层：微信小程序里 canvas 是原生组件，无法被 transform/遮罩压出屏幕，
// 想要"整段 7 天一屏看完"只能靠**更宽的视口**——横屏正好。pageOrientation 是基础库 2.5.0
// 起的页面级能力，本项目基础库 3.8.12 可用。
//
// 数据不走 URL：168 小时序列塞 query string 既超长又无谓地编解码一遍，天气页留在页面栈里，
// 通过 utils/chart-store 这份内存数据交接即可。
'use strict'
const store = require('../../utils/chart-store')
const F = require('../../utils/format')

const PAGE_PAD = 16      // 页面左右留白（wxss .fc 的 padding）
const GUTTER = 60        // 图自己的留白：layout.js 的 PAD_L 52 + PAD_R 8
const STANDARD = 22      // layout.js 的 HOUR_W
const BIG = 44           // 放大
const MIN = 3            // 全览下限：再窄分隔线就糊了

Page({
  data: {
    ready: false,
    hasData: false,
    series: [],
    marks: {},
    night: {},
    selected: {},
    pointName: '',
    range: '',
    picked: '',
    mode: 'fit',
    hourWidth: STANDARD,
    tip: '',
    modes: [
      { k: 'fit', t: '全览' },
      { k: 'std', t: '标准' },
      { k: 'big', t: '放大' },
    ],
  },

  onLoad() {
    const p = store.get()
    if (!p || !p.series || !p.series.length) {
      this.setData({ ready: true, hasData: false })
      return
    }
    const days = []
    p.series.forEach(h => { if (days.indexOf(h.d) === -1) days.push(h.d) })
    this.n = p.series.length
    this.setData({
      ready: true,
      hasData: true,
      series: p.series,
      marks: p.marks || {},
      night: p.night || {},
      selected: p.selected || {},
      pointName: p.pointName || '',
      range: days.length ? md(days[0]) + ' – ' + md(days[days.length - 1]) + ' · ' + days.length + ' 天' : '',
      picked: '',
    }, () => this.applyMode('fit'))
  },

  // 全览 = 按屏宽反推列宽，让 PAD_L + n×列宽 + PAD_R 正好塞进视口，无需横滑。
  // 进页与真机旋转（onResize）都要重算：页面固定横屏，但 getSystemInfoSync 的 windowWidth
  // 在"竖着拿的手机被强制转横屏"这一瞬间可能还是竖屏值，转完会回调一次。
  applyMode(k) {
    let hw = STANDARD
    if (k === 'fit') {
      hw = Math.floor((this.viewportWidth() - PAGE_PAD * 2 - GUTTER) / Math.max(1, this.n || 1))
    } else if (k === 'big') {
      hw = BIG
    }
    hw = Math.max(MIN, Math.min(BIG, hw))
    const tip = k === 'fit'
      ? '全览 · 一屏看完，点图上某处看该小时详情'
      : (k === 'big' ? '放大 · 左右滑动看细节' : '横滑看全程 · 点图上某天切换')
    this.setData({ mode: k, hourWidth: hw, tip, picked: '' })
  },

  viewportWidth() {
    if (typeof wx.getWindowInfo === 'function') {
      const w = wx.getWindowInfo().windowWidth
      if (w) return w
    }
    const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {}
    return info.windowWidth || 667
  },

  onResize() {
    if (this.data.mode === 'fit') this.applyMode('fit')
  },

  onMode(e) {
    const k = e.currentTarget.dataset.k
    if (!k || k === this.data.mode) return
    this.applyMode(k)
  },

  // 点图上的某小时 → 在头部显示该小时读数。
  // 全览模式下列太窄读不出字，点一下把数值「展开」到标题栏，比 toast 更不会被截断。
  onPickHour(e) {
    const d = e.detail && e.detail.date
    const t = e.detail && e.detail.t
    if (!d || !t) return
    const h = this.data.series.find(x => x.d === d && x.t === t)
    if (!h) return
    const parts = [md(d) + ' ' + t, Math.round(h.temp) + '°', F.weatherPhrase(h.code).label]
    const pop = Number(h.pop)
    if (pop > 0) parts.push(pop + '%')
    if (h.wind != null) parts.push(Math.round(h.wind) + ' 级风')
    this.setData({ picked: parts.join(' · ') })
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) })
  },
})

function md(iso) {
  return Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10))
}
