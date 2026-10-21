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
    // 这个人在这场活动上欠下的协作事项：[{ key: 'staff'|'vehicle', label: '现场协作' }]。
    // 判据与文案都由页面从服务端投影的 meta 派生（utils/journey.collabRoles），
    // 组件只负责画与回抛 key——授权判断不进组件。
    collab: { type: Array, value: [] },
    cover: { type: String, value: '' },
    activityId: { type: String, value: '' },
  },
  data: {
    // 照片加载失败：缩略图退回 --stone 灰底、featured 封面藏起（纯色 hero 兜底）
    coverFailed: false,
    // 实际要用的封面地址（外部传入优先，否则按 activityId 派生）
    coverSrc: '',
    // 实拍封面失败时的氛围图兜底；已经是氛围图还失败才走纯色
    coverFallback: '',
  },
  observers: {
    'cover, activityId'(cover, activityId) {
      const fallback = activityId ? covers.coverFor(activityId) : ''
      const next = cover || fallback
      if (next === this.data.coverSrc) return
      this.setData({ coverSrc: next, coverFallback: fallback, coverFailed: false })
    },
  },
  methods: {
    onTap() { this.triggerEvent('open') },
    onCollab(e) { this.triggerEvent('collab', { key: e.currentTarget.dataset.key }) },
    onCoverError() {
      const fallback = this.data.coverFallback
      if (fallback && this.data.coverSrc !== fallback) {
        console.warn('[activity-card] 实拍封面加载失败，回退氛围图：', this.data.coverSrc)
        this.setData({ coverSrc: fallback, coverFailed: false })
        return
      }
      if (this.data.coverFailed) return
      console.warn('[activity-card] 封面图加载失败：', this.data.coverSrc)
      this.setData({ coverFailed: true })
    },
  },
})
