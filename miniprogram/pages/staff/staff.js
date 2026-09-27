// 现场协作任务（原型 screens/StaffTask.tsx）：头部 + 现场面板（staff 视角）。
'use strict'
Page({
  data: {
    activityId: '',
  },
  onLoad(options) {
    this.setData({ activityId: options.id || '' })
  },
})
