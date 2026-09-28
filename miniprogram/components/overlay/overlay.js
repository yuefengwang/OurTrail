// 弹层组件：kind=sheet（底部上滑）或 dialog（居中）。由原型 Overlay.tsx 移植。
// 同 form-field：options 只能写一次，否则 apply-shared 被覆盖，弹层内的 .icon-button /
// .stack 等 app.wxss 类选择器不生效。
'use strict'
Component({
  options: { styleIsolation: 'apply-shared', multipleSlots: false },
  properties: {
    open: { type: Boolean, value: false },
    kind: { type: String, value: 'sheet' },
    title: { type: String, value: '' },
  },
  data: { rendered: false, animating: false },
  observers: {
    open(v) {
      if (v) this.setData({ rendered: true })
    },
  },
  methods: {
    noop() {},
    onMaskTap() { this.triggerEvent('close') },
    onCloseTap() { this.triggerEvent('close') },
    // 入场动画结束后若已关闭则卸载节点
    onAnimationEnd() {
      if (!this.data.open) this.setData({ rendered: false })
    },
  },
})
