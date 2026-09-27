// 全局隐私授权弹窗：常驻于 app.wxml，统一拦截位置等隐私接口调用。
// 微信要求调用 getLocation/chooseLocation 前必须取得用户授权，
// 通过 wx.onNeedPrivacyAuthorize 中心化处理，各业务页面无需改动。
Component({
  data: { show: false, name: '' },
  lifetimes: {
    attached() {
      if (typeof wx.onNeedPrivacyAuthorize !== 'function') return
      this._handle = (arg1, arg2) => {
        let resolve, privacyRes
        if (typeof arg1 === 'function') {
          resolve = arg1
          privacyRes = arg2
        } else {
          resolve = arg1 && arg1.resolve
          privacyRes = arg1
        }
        this._resolve = resolve
        this.setData({
          show: true,
          name: (privacyRes && privacyRes.privacyContractName) || ''
        })
      }
      wx.onNeedPrivacyAuthorize(this._handle)
    },
    detached() {
      if (this._handle && typeof wx.offNeedPrivacyAuthorize === 'function') {
        wx.offNeedPrivacyAuthorize(this._handle)
      }
    }
  },
  methods: {
    agree() {
      if (typeof this._resolve === 'function') {
        try { this._resolve({ event: 'agree' }) } catch (e) {}
      }
      this.setData({ show: false })
    },
    openContract() {
      if (typeof wx.openPrivacyContract === 'function') {
        wx.openPrivacyContract({
          fail: () => wx.navigateTo({ url: '/pages/privacy/privacy' })
        })
      } else {
        wx.navigateTo({ url: '/pages/privacy/privacy' })
      }
    }
  }
})
