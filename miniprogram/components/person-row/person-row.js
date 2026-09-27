// 人员行：头像 + 姓名 + 状态徽标 + 副标题 + 操作插槽。由原型 PersonRow.tsx 移植。
'use strict'
Component({
  properties: {
    name: { type: String, value: '' },
    status: { type: String, value: '' },
    tone: { type: String, value: 'neutral' },
    subtitle: { type: String, value: '' },
  },
  data: { initial: '—' },
  observers: {
    name(v) {
      const first = (v || '').trim().charAt(0)
      this.setData({ initial: first || '—' })
    },
  },
})
