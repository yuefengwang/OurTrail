// 表单字段：label + 提示 + 错误 + 输入插槽。由原型 FormField.tsx 移植。
'use strict'
Component({
  options: { styleIsolation: 'apply-shared' },
  options: { multipleSlots: true },
  properties: {
    label: { type: String, value: '' },
    hint: { type: String, value: '' },
    error: { type: String, value: '' },
  },
})
