// 活动卡：普通（缩略图 + 文字）/ featured（大幅封面照 + 压底）。
// 封面由 pages 传入（utils/covers.js 按活动 id 稳定选取）：本组件不做选取逻辑，
// 保持"展示层只消费投影"的既定分工。
'use strict'
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
  },
  data: {
    // 照片加载失败：缩略图退回 --stone 灰底、featured 封面藏起（纯色 hero 兜底）
    coverFailed: false,
  },
  methods: {
    onTap() { this.triggerEvent('open') },
    onCoverError() {
      if (this.data.coverFailed) return
      console.warn('[activity-card] 封面图加载失败：', this.data.cover)
      this.setData({ coverFailed: true })
    },
  },
})
