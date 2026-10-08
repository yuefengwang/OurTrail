// 开发者预演面板（仅 OWNER_OPENIDS 白名单账号可用，鉴权在 trailApiLab 侧）。
// 打开方式：开发者工具「编译模式」→ 添加编译模式 → 启动页面 pages/lab/lab；
// 真机预览时选择该编译模式即可直达。此页对普通用户不可见、不可达。
// 用途：单人走完多人业务全流程——演员由 trailApiLab 注入，组织者动作由你在各业务页亲手做。
'use strict'
const { LAB_FUNC_NAME } = require('../../config')

Page({
  data: {
    loading: true,
    denied: '',
    board: [],
    activity: null,
    actors: [],
    caller: '',
    allowConfig: [],
    allowDb: [],
    allowInput: '',
    allowBusy: false,
    busyStage: -1,
    cleanupOpen: false,
    cleanupArmed: false,
    message: '',
    error: '',
  },

  onShow() {
    this.reload()
  },

  // 这一页由编译模式直达，没有返回栈可用；不给出口就等于把人关在预演面板里。
  goHome() { wx.switchTab({ url: '/pages/home/home' }) },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },

  callLab(action, data) {
    return wx.cloud.callFunction({ name: LAB_FUNC_NAME, data: Object.assign({ action }, data || {}) })
      .then(res => {
        const r = res && res.result
        if (r && r.ok) return r.data
        const err = new Error((r && r.error && r.error.message) || '预演工具调用失败')
        err.code = (r && r.error && r.error.code) || 'INVALID_INPUT'
        throw err
      })
      .catch(e => {
        if (e instanceof Error && e.code) throw e
        // callFunction 自身 reject（网络/未部署/超时）：按 errMsg 细分，别把超时说成"未部署"
        const msg = (e && (e.errMsg || e.message)) || ''
        if (/-504003|FUNCTIONS_TIME_LIMIT|timed?\s*out|timeout/i.test(msg)) {
          throw Object.assign(new Error('云函数执行超时（-504003）：请重试本阶段（阶段执行是幂等的）。若持续出现，请重新部署 trailApiLab 并确认 config.json 超时为 20 秒。'), { code: 'TIMEOUT' })
        }
        throw Object.assign(new Error('预演工具不可达：请确认 trailApiLab 已部署（' + msg.slice(0, 80) + '）'), { code: 'NETWORK' })
      })
  },

  reload() {
    return this.callLab('inspect').then(view => {
      const allowlist = view.allowlist || {}
      this.setData({
        loading: false,
        denied: '',
        board: view.board || [],
        activity: view.activity,
        actors: view.actors || [],
        caller: view.caller || '',
        allowConfig: allowlist.configIds || [],
        allowDb: allowlist.ids || [],
        message: this.data.message,
      })
    }).catch(e => {
      this.setData({ loading: false, denied: e.message })
    })
  },

  onRunStage(e) {
    const stage = Number(e.currentTarget.dataset.stage)
    if (this.data.busyStage !== -1) return
    this.setData({ busyStage: stage, error: '', message: '' })
    this.callLab('seed', { stage }).then(result => {
      const failed = (result.executed || []).filter(x => !x.ok)
      const summary = result.title + '：' + (result.executed || []).length + ' 条命令，'
        + (failed.length ? '失败 ' + failed.length + ' 条（' + failed[0].code + '）' : '全部成功')
      this.setData({ busyStage: -1, message: summary + '。' + (result.hint || '') })
      return this.reload()
    }).catch(err => {
      this.setData({ busyStage: -1, error: err.message })
    })
  },

  // ---- 开发者白名单：动态名单存库，添加/移除即生效（配置内的固定名单不可在此移除） ----
  onAllowInput(e) {
    this.setData({ allowInput: e.detail.value })
  },
  onAllowAdd() {
    const id = (this.data.allowInput || '').trim()
    if (!id || this.data.allowBusy) return
    this.setData({ allowBusy: true, error: '', message: '' })
    this.callLab('allowlist.add', { id }).then(r => {
      this.setData({ allowBusy: false, allowInput: '', message: '已加入白名单：' + id })
      return this.reload()
    }).catch(err => {
      this.setData({ allowBusy: false, error: err.message })
    })
  },
  onAllowRemove(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.allowBusy) return
    this.setData({ allowBusy: true, error: '', message: '' })
    this.callLab('allowlist.remove', { id }).then(() => {
      this.setData({ allowBusy: false, message: '已移出白名单：' + id })
      return this.reload()
    }).catch(err => {
      this.setData({ allowBusy: false, error: err.message })
    })
  },

  onCleanupAsk() {
    this.setData({ cleanupOpen: true, cleanupArmed: false })
  },
  onCleanupClose() {
    this.setData({ cleanupOpen: false, cleanupArmed: false })
  },
  onCleanupArm(e) {
    this.setData({ cleanupArmed: e.detail.value.length > 0 })
  },
  onCleanupConfirm() {
    if (!this.data.cleanupArmed) return
    this.callLab('cleanup', { profiles: true }).then(result => {
      const removed = result.removed || {}
      this.setData({ cleanupOpen: false, cleanupArmed: false, message: '已清理预演数据：'
        + ['activities', 'signups', 'attendance', 'profiles']
          .map(k => k + ' ' + (removed[k] || 0)).join(' · ') })
      return this.reload()
    }).catch(err => {
      this.setData({ cleanupOpen: false, cleanupArmed: false, error: err.message })
    })
  },

  noop() {},
})
