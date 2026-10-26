'use strict'
const { iconFor } = require('../../utils/equipment-icons')

// 只做规范化：去首尾空白、丢掉空项；不去重、不排序、不改写原文。
function cellsOf(list) {
  const src = Array.isArray(list) ? list : []
  const out = []
  for (let i = 0; i < src.length; i++) {
    const text = typeof src[i] === 'string' ? src[i].trim() : ''
    if (text) out.push({ text, icon: iconFor(text) })
  }
  return out
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    required: { type: Array, value: [] },
    suggested: { type: Array, value: [] },
  },
  data: { requiredItems: [], suggestedItems: [] },
  observers: {
    'required, suggested'(required, suggested) {
      this.setData({
        requiredItems: cellsOf(required),
        suggestedItems: cellsOf(suggested),
      })
    },
  },
})
