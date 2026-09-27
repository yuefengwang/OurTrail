// 活动卡：普通 / featured（森林底 hero）。由原型 ActivityCard.tsx 移植。
'use strict'
Component({
  properties: {
    title: { type: String, value: '' },
    date: { type: String, value: '' },
    meta: { type: String, value: '' },
    status: { type: String, value: '' },
    featured: { type: Boolean, value: false },
  },
  methods: {
    onTap() { this.triggerEvent('open') },
  },
})
