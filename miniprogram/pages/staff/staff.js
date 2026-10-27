// 现场协作任务（原型 screens/StaffTask.tsx）：头部 + 现场面板（staff 视角）。
'use strict'
// 失效信号的序号：field-panel 的去重是「key !== this._readKey」，只带时间戳的话，
// 同一毫秒内的两次失效（返回本页紧跟着下拉、连续两次下拉）会撞成同一个串，
// 那一次刷新就静默不发生——手势点了没反应，比不刷新更难查。
let seq = 0
const nextSyncKey = () => 'staff@' + Date.now() + '.' + (++seq)
Page({
  data: {
    activityId: '',
    syncKey: '',
  },
  onLoad(options) {
    this.setData({ activityId: options.id || '' })
  },
  onShow() {
    // onShow 而不是 onLoad：field-panel 常驻不重建、只在 attached 时读一次，领队推进阶段或别的
    // 协作者签到后返回本页必须靠宿主下发 syncKey 才会重读，否则看到的就是离开时那份旧快照。
    // 首次进入不 bump：那一次读已由组件 attached 发出，重复下发只会多打一次全量读。
    if (this._shown) this.setData({ syncKey: nextSyncKey() })
    this._shown = true
  },
  // 下拉刷新与 onShow 走同一条失效通道（syncKey），页面不越过组件的 _readKey 去直接调 panel.reload()：
  // 那样同一次手势可能打出两遍全量读，也把「谁决定要不要重读」变成两处。
  // 拉头在这里立即收起：field-panel.reload() 只在主路径返回 Promise（缺活动编号／正在读两条早退路径
  // 返回 undefined），把 stopPullDownRefresh 押在可能不存在的 promise 上就是让手势永远转圈；
  // 「所有路径都返回 Promise」要改 field-panel（ROSTER2 的写入集），已在 requests 提出，届时本页
  // 应改为 route.js 的既有范式：this.reload().then(stop).catch(stop)。
  onPullDownRefresh() {
    this.setData({ syncKey: nextSyncKey() })
    if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh()
  },
})
