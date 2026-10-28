'use strict'
const covers = require('../../utils/covers')

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    empty: { type: Boolean, value: false },
    hasActivities: { type: Boolean, value: false },
    activityId: { type: String, value: '' },
    title: { type: String, value: '' },
    facts: { type: Array, value: [] },
  },
  data: {
    coverSrc: '',
    coverAlt: '',
    coverFailed: false,
    inviteCoverFailed: false,
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
    onDiscover() {
      this.triggerEvent('discover')
    },
    onInviteCoverError() {
      this.setData({ inviteCoverFailed: true })
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
