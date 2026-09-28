// 表单字段：label + 提示 + 错误 + 输入插槽。由原型 FormField.tsx 移植。
// 注意：options 只能出现一次——写成两个同名字段时后者覆盖前者，apply-shared 会被静默丢弃，
// 而本组件 wxss 是空的（完全复用 app.wxss 的 .field 体系），丢了样式就散架。
'use strict'
Component({
  options: { styleIsolation: 'apply-shared', multipleSlots: true },
  properties: {
    label: { type: String, value: '' },
    hint: { type: String, value: '' },
    error: { type: String, value: '' },
  },
})
