// 活动卡：普通（缩略图 + 文字）/ featured（大幅封面照 + 压底）。
// 封面优先用外部传入的 cover；没传时只给 activityId，本组件按 id 稳定取一张
//（utils/covers.js）——派生刻意留在组件内：页面 cards 数组是投影契约，
//  a20-owner-hero 门按字节比对它们，展示派生字段不该进那个对象。
'use strict'
const covers = require('../../utils/covers')

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    title: { type: String, value: '' },
    date: { type: String, value: '' },
    meta: { type: String, value: '' },
    status: { type: String, value: '' },
    when: { type: String, value: '' },
    info: { type: String, value: '' },
    featured: { type: Boolean, value: false },
    cover: { type: String, value: '' },
    activityId: { type: String, value: '' },
  },
  data: {
    // 照片加载失败：缩略图退回 --stone 灰底、featured 封面藏起（纯色 hero 兜底）
    coverFailed: false,
    // 实际要用的封面地址（外部传入优先，否则按 activityId 派生）
    coverSrc: '',
  },
  observers: {
    'cover, activityId'(cover, activityId) {
      const next = cover || (activityId ? covers.coverFor(activityId) : '')
      if (next === this.data.coverSrc) return
      this.setData({ coverSrc: next, coverFailed: false })
    },
  },
  methods: {
    onTap() { this.triggerEvent('open') },
    onCoverError() {
      if (this.data.coverFailed) return
      console.warn('[activity-card] 封面图加载失败：', this.data.coverSrc)
      this.setData({ coverFailed: true })
    },
  },
})
