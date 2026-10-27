// 按需补全同行资料：只在报名/发起活动等写操作前弹出，不拦住浏览。
// 微信头像/昵称/手机号都必须由用户真实点击触发（平台限制），所以这里是自动弹出的 sheet，
// 而不是程序化调用 getUserProfile（后者已不保证返回真实头像昵称）。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    open: { type: Boolean, value: false },
  },
  data: {
    loading: false,
    saving: false,
    uploadingAvatar: false,
    phoneLoading: false,
    error: '',
    hint: '',
    person: { name: '', phone: '', avatar: '' },
  },
  observers: {
    open(open) {
      if (open) this.loadProfile()
    },
  },
  lifetimes: {
    attached() {
      if (this.data.open) this.loadProfile()
    },
  },
  methods: {
    loadProfile() {
      this.setData({ loading: true, error: '', hint: '' })
      api.read({ kind: 'profile' }).then(res => {
        if (!res.view || res.view.kind !== 'profile') {
          this.setData({ loading: false, error: '当前资料不可用，请稍后再试。' })
          return
        }
        const p = res.view.profile
        this._revision = res.revision
        this._openid = p.id
        const person = Object.assign({
          name: '', phone: '', emergency: { name: '', phone: '' }, medical: '', avatar: '',
        }, p.person)
        this._person = person
        this.setData({
          loading: false,
          person: { name: person.name || '', phone: person.phone || '', avatar: person.avatar || '' },
        })
      }).catch(e => this.setData({ loading: false, error: api.errorText(e) }))
    },

    onField(e) {
      const key = e.currentTarget.dataset.key
      this.setData({
        person: Object.assign({}, this.data.person, { [key]: e.detail.value }),
        error: '',
        hint: '',
      })
    },

    onChooseAvatar(e) {
      const tempPath = e.detail && e.detail.avatarUrl
      if (!tempPath || this.data.uploadingAvatar) return
      if (!wx.cloud || !this._openid) {
        this.setData({ error: '云能力暂不可用，头像可以先不传。' })
        return
      }
      this.setData({ uploadingAvatar: true, error: '', hint: '' })
      wx.cloud.uploadFile({
        cloudPath: 'avatars/' + this._openid + '/' + Date.now() + '.jpg',
        filePath: tempPath,
        success: res => {
          if (!res.fileID) {
            this.setData({ uploadingAvatar: false, error: '头像上传失败，可以稍后再补。' })
            return
          }
          this.setData({
            uploadingAvatar: false,
            hint: '已使用微信头像',
            person: Object.assign({}, this.data.person, { avatar: res.fileID }),
          })
        },
        fail: () => this.setData({ uploadingAvatar: false, error: '头像上传失败，可以稍后再补。' }),
      })
    },

    onPhoneCode(e) {
      const d = (e && e.detail) || {}
      if (d.code) {
        this.setData({ phoneLoading: true, error: '', hint: '' })
        api.call('getPhoneNumber', { code: d.code }).then(res => {
          if (!res || !res.phone) {
            this.setData({ phoneLoading: false, error: '没有拿到微信手机号，请手动填写。' })
            return
          }
          this.setData({
            phoneLoading: false,
            hint: '已填入微信手机号，可修改',
            person: Object.assign({}, this.data.person, { phone: res.phone }),
          })
        }).catch(err => this.setData({ phoneLoading: false, error: api.errorText(err) }))
        return
      }
      const msg = String(d.errMsg || d.errmsg || '')
      if (/cancel|取消/i.test(msg)) {
        this.setData({ hint: '已取消获取微信手机号，可手动填写。' })
        return
      }
      this.setData({ error: '没有拿到微信手机号，请手动填写。' })
    },

    onSave() {
      if (this.data.saving) return
      const name = String(this.data.person.name || '').trim()
      const phone = String(this.data.person.phone || '').trim()
      if (!name) {
        this.setData({ error: '请填写姓名或微信昵称。' })
        return
      }
      if (!F.validPhone(phone)) {
        this.setData({ error: '请填写 11 位手机号，或点「用微信手机号」。' })
        return
      }
      const base = Object.assign({}, this._person || {}, {
        name,
        phone,
        avatar: this.data.person.avatar || '',
      })
      base.emergency = base.emergency || { name: '', phone: '' }
      this.setData({ saving: true, error: '', hint: '' })
      api.dispatch({ type: 'profile.save', person: base }, this._revision).then(res => {
        this._revision = res.revision
        this.setData({ saving: false })
        this.triggerEvent('saved', { person: base })
      }).catch(e => {
        if (e && e.code === 'CONFLICT') {
          this.loadProfile()
          this.setData({ saving: false, error: '资料已被更新，已刷新，请确认后再保存一次。' })
          return
        }
        this.setData({ saving: false, error: api.errorText(e) })
      })
    },

    onClose() {
      this.triggerEvent('close')
    },
  },
})
