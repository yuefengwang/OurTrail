// 现场协作任务（原型 screens/StaffTask.tsx）：头部 + 现场面板（staff 视角）。
'use strict'
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
    if (this._shown) this.setData({ syncKey: 'staff@' + Date.now() })
    this._shown = true
  },
})
