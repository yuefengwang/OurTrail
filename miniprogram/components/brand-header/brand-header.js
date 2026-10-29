'use strict'
const { layoutFor } = require('../../utils/header-layout')

// 品牌栏：tab 页用 solid / plain。这些页 JSON 里 navigationStyle=custom，
// 原生导航栏不再出现，身份由本组件的词标承担。
// 下钻页默认仍走原生返回栏；只有同一页里「首页 ↔ 详情」两屏共处、又不能出现第二条导航栏时，
// 才用 back 让词标自己承担返回（weather-hub 屏 2），语义与原生返回一致。
// 系统值读不到时用 header-layout 的兜底，绝不让高度变 0（那会把内容顶进状态栏）。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    // 可选页面名：与词标同一行，用中隔点分开（例如「活动」）。
    title: { type: String, value: '' },
    // solid = 纸面固定条（默认）；overlay = 压在首屏照片上的透明条（home）；
    // plain = 白底无分隔线（天气模块：它整页都是白底无卡片，纸面条会割出一道灰边）。
    // overlay 不留在文档流里（占位 0），也**不用 fixed**：照片只占首屏，滚走后条应随内容离开。
    variant: { type: String, value: 'solid' },
    // 可选返回：与原生导航栏返回同位同义，只是把身份留在词标这一行。
    back: { type: Boolean, value: false },
  },
  data: {
    statusBarHeight: 20,
    navBar: 44,
    height: 64,
    contentRightInset: 104,
  },
  lifetimes: {
    attached() {
      this.measure()
    },
  },
  methods: {
    onBack() {
      this.triggerEvent('back')
    },
    measure() {
      let layout
      try {
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const menuButton = typeof wx.getMenuButtonBoundingClientRect === 'function'
          ? wx.getMenuButtonBoundingClientRect()
          : null
        layout = layoutFor({ statusBarHeight: info.statusBarHeight, windowWidth: info.windowWidth, menuButton })
      } catch (e) {
        layout = layoutFor(null)
      }
      this.setData(layout)
      // 贴在本条下面的 sticky 元素（天气四视图 tab）要正好接在条底，高度只认这一处实测值；
      // 宿主自己再调一次 layoutFor 就多了一个可能漂移的副本。
      this.triggerEvent('ready', { height: layout.height, navBar: layout.navBar, statusBarHeight: layout.statusBarHeight })
    },
  },
})
