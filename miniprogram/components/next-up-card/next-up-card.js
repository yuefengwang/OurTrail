'use strict'
// 「下一次同行」：首页专用的客户端派生卡——不新增域字段、不额外发请求，
// 输入就是首页已有的 home 投影。
//
// 只回答一件事：最近一场要去的活动是哪场、什么时候、还有多久、多少人。
// 整卡可点进详情，卡内不放实心按钮：本页唯一的 primary 留给「发起活动」
// （ourtrail-ui §3 #7）。没有未来活动时反过来——空态卡内就是那个 primary，
// 动作行只留次级「发现活动」，同屏不会出现两个主按钮。
//
// 2026-10-26（style-B）：由森林底纯色卡改为照片 hero（参考板首屏是一张压满的照片）。
// 活动模型没有图片字段，照片按 activityId 稳定取氛围图（utils/covers.js）；
// 失败先换一张、再退回纯色底，三档都有可读文字。
const covers = require('../../utils/covers')

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    empty: { type: Boolean, value: false },
    activityId: { type: String, value: '' },
    title: { type: String, value: '' },
    facts: { type: Array, value: [] },
  },
  data: {
    coverSrc: '',
    coverAlt: '',
    coverFailed: false,
  },
  observers: {
    activityId(id) {
      const src = id ? covers.coverFor(id) : ''
      // 同一个种子空间里的另一张：只防单张素材坏掉，不是"每次换图"
      const alt = id ? covers.coverFor(id + '#alt') : ''
      if (src === this.data.coverSrc && alt === this.data.coverAlt) return
      this.setData({ coverSrc: src, coverAlt: alt, coverFailed: false })
    },
  },
  methods: {
    onOpen() {
      if (this.data.empty || !this.data.activityId) return
      this.triggerEvent('open', { id: this.data.activityId })
    },
    onCreate() {
      this.triggerEvent('create')
    },
    onCoverError() {
      const alt = this.data.coverAlt
      if (alt && alt !== this.data.coverSrc) {
        console.warn('[next-up-card] 氛围封面加载失败，换一张：', this.data.coverSrc)
        this.setData({ coverSrc: alt })
        return
      }
      if (this.data.coverFailed) return
      console.warn('[next-up-card] 氛围封面加载失败，退回纯色底：', this.data.coverSrc)
      this.setData({ coverFailed: true })
    },
  },
})
