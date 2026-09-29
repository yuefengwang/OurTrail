// 自定义 TabBar：活动 / 天气 / 通知 / 我的（样式与原型 tabs 一致）
'use strict'
Component({
  options: { styleIsolation: 'apply-shared' },
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '活动', icon: 'activity' },
      { pagePath: '/pages/weather-hub/weather-hub', text: '天气', icon: 'sun' },
      { pagePath: '/pages/notices/notices', text: '通知', icon: 'bell' },
      { pagePath: '/pages/me/me', text: '我的', icon: 'person' },
    ],
  },
  methods: {
    switchTab(e) {
      const path = e.currentTarget.dataset.path
      wx.switchTab({ url: path })
    },
  },
})
