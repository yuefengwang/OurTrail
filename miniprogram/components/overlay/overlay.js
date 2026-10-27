// 弹层组件：kind=sheet（底部上滑）或 dialog（居中）。由原型 Overlay.tsx 移植。
// 同 form-field：options 只能写一次，否则 apply-shared 被覆盖，弹层内的 .icon-button /
// .stack 等 app.wxss 类选择器不生效。
'use strict'
// 自定义 tabBar 是框架的独立高层，页面里 z-index 再高也压不住它：sheet 贴底时末行按钮
// 会落在 tabBar 后面，滚到底也露不出来（2026-10-21 真机实测）。所以弹层打开期间隐藏
// 当前页的 tabBar，关闭时恢复；同页多个弹层（如面板里再开确认层）按引用计数共用一次隐藏。
const tabBarLocks = new WeakMap()
function lockTabBar(inst) {
  if (inst._tabBarPage || typeof getCurrentPages !== 'function') return
  const pages = getCurrentPages()
  const page = pages[pages.length - 1]
  if (!page) return
  inst._tabBarPage = page
  let lock = tabBarLocks.get(page)
  if (!lock) {
    lock = { count: 0, bar: typeof page.getTabBar === 'function' ? page.getTabBar() : null }
    tabBarLocks.set(page, lock)
  }
  lock.count++
  if (lock.count === 1 && lock.bar) lock.bar.setData({ hidden: true })
}
function unlockTabBar(inst) {
  const page = inst._tabBarPage
  if (!page) return
  inst._tabBarPage = null
  const lock = tabBarLocks.get(page)
  if (!lock) return
  lock.count--
  if (lock.count > 0) return
  tabBarLocks.delete(page)
  if (lock.bar) lock.bar.setData({ hidden: false })
}

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
      if (v) {
        this.setData({ rendered: true })
        lockTabBar(this)
      } else {
        unlockTabBar(this)
      }
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
