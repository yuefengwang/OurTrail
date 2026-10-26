// 两列事实网格：信息卡（card）与路线指标（stats）共用同一套排布。
// 只负责排版：哪些事实该出现、值从哪来，全部在页面侧决定。
'use strict'
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    items: { type: Array, value: [] },
    variant: { type: String, value: 'card' },
  },
  data: { cells: [] },
  observers: {
    items(list) {
      const src = Array.isArray(list) ? list : []
      const kept = src.filter(item => item && item.value !== '' && item.value !== null && item.value !== undefined)
      const cells = kept.map((item, i) => ({
        key: item.key || String(i),
        label: item.label || '',
        value: item.value,
        unit: item.unit || '',
        sub: item.sub || '',
        wide: false,
      }))
      // 奇数个时最后一项通栏：否则两列网格右下角会留一个空洞，读起来像少了内容。
      if (cells.length % 2 === 1) cells[cells.length - 1].wide = true
      this.setData({ cells })
    },
  },
})
