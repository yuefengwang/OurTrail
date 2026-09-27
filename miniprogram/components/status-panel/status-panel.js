// 边缘状态面板：empty / loading / error / denied / offline。由原型 StatusPanel.tsx 移植。
'use strict'
const ICONS = { empty: 'route', loading: 'clock', error: 'alert', denied: 'shield', offline: 'cloud' }
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    kind: { type: String, value: 'empty' },
    title: { type: String, value: '' },
    detail: { type: String, value: '' },
    actionLabel: { type: String, value: '' },
  },
  data: { iconName: 'route' },
  observers: {
    kind(v) { this.setData({ iconName: ICONS[v] || 'route' }) },
  },
  methods: {
    onAction() { this.triggerEvent('action') },
  },
})
