'use strict'
// 「下一次同行」：首页专用的客户端派生卡——不新增域字段、不额外发请求，
// 输入就是首页已有的 home 投影。
//
// 只回答一件事：最近一场要去的活动是哪场、什么时候、还有多久、多少人。
// 整卡可点进详情，卡内不放实心按钮：本页唯一的 primary 留给「发起活动」
// （ourtrail-ui §3 #7）。没有未来活动时反过来——空态卡内就是那个 primary，
// 动作行只留次级「发现活动」，同屏不会出现两个主按钮。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    empty: { type: Boolean, value: false },
    activityId: { type: String, value: '' },
    title: { type: String, value: '' },
    facts: { type: Array, value: [] },
  },
  methods: {
    onOpen() {
      if (this.data.empty || !this.data.activityId) return
      this.triggerEvent('open', { id: this.data.activityId })
    },
    onCreate() {
      this.triggerEvent('create')
    },
  },
})
