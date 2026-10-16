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
    // E-07/C-17 定稿＝裁定选项 B：关闭态不卸载——rendered 只有置 true 的路径，
    // 没有任何置 false 的路径（既不用事件绑定，也不用 JS 计时器）。
    // 关闭态的安全性由 overlay.wxss 的 pointer-events:none + visibility:hidden 承担
    // （platform-pitfalls §4 的承重墙，注释就写在那里）。
    open(v) {
      if (v) this.setData({ rendered: true })
    },
  },
  methods: {
    noop() {},
    onMaskTap() { this.triggerEvent('close') },
    onCloseTap() { this.triggerEvent('close') },
    // 关闭只对外发 close，由宿主决定 open 置 false；本组件不在这里动 rendered
    // （在 tap 里直接 setData({rendered:false}) 会杀掉淡出过渡，且此刻 open 还是 true）。
    // 原 onAnimationEnd 是「代码在、路径死」的死方法（非法属性 animation-end="noop" 永不触发），
    // 按裁定与那行无效属性一起删除；不要再以计时器形式把它请回来。
  },
})
