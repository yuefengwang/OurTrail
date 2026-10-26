// 活动详情首屏：定高封面 + 标题抬进照片下沿。
// 只负责排版与两条图片错误路径；封面回退的决策仍在页面（它知道 activityId 与分享图）。
'use strict'
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    title: { type: String, value: '' },
    routeTitle: { type: String, value: '' },
    leader: { type: String, value: '' },
    badgeText: { type: String, value: '' },
    startAtLabel: { type: String, value: '' },
    cover: { type: String, value: '' },
    coverIsReal: { type: Boolean, value: false },
    coverFailed: { type: Boolean, value: false },
  },
  methods: {
    onCoverError() { this.triggerEvent('covererror') },
    onFallbackError() { this.triggerEvent('fallbackerror') },
  },
})
