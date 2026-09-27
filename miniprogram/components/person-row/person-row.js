// 人员行：头像（微信头像图或首字占位）+ 姓名 + 状态徽标 + 副标题 + 操作插槽。
'use strict'
Component({
  properties: {
    name: { type: String, value: '' },
    status: { type: String, value: '' },
    tone: { type: String, value: 'neutral' },
    subtitle: { type: String, value: '' },
    avatar: { type: String, value: '' },
  },
  data: { initial: '—' },
  observers: {
    name(v) {
      const first = (v || '').trim().charAt(0)
      this.setData({ initial: first || '—' })
    },
  },
})
