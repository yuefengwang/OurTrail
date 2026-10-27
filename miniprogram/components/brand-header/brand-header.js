'use strict'
const { layoutFor } = require('../../utils/header-layout')

// 品牌栏：只在「一级 tab 页」用（D2）。这些页 JSON 里 navigationStyle=custom，
// 原生导航栏不再出现，身份由本组件的词标承担；下钻页保留原生返回栏，不挂本组件。
// 系统值读不到时用 header-layout 的兜底，绝不让高度变 0（那会把内容顶进状态栏）。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    // 可选页面名：与词标同一行，用中隔点分开（例如「活动」）。
    title: { type: String, value: '' },
    // solid = 纸面固定条（默认，其余 tab 页）；overlay = 压在首屏照片上的透明条（home）。
    // overlay 不留在文档流里（占位 0），也**不用 fixed**：照片只占首屏，滚走后条应随内容离开。
    variant: { type: String, value: 'solid' },
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
    },
  },
})
