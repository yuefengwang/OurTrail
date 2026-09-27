const { CLOUD_ENV } = require('./config')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('基础库版本过低（需 2.2.3 以上）才能使用云能力')
      return
    }
    wx.cloud.init(CLOUD_ENV ? { env: CLOUD_ENV, traceUser: true } : { traceUser: true })
  },
  globalData: {},
})
