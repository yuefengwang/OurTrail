// 本车任务（原型 screens/VehicleTask.tsx）：去程/返程逐人清点、发车与完成。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const J = require('../../utils/journey')

Page({
  data: {
    loading: true,
    denied: '',
    leg: 'outbound',
    label: '',
    plate: '',
    capacityLine: '',
    phase: '',
    expectedCount: 0,
    boardedCount: 0,
    legState: '',
    passengers: [],
    canOperate: false,
    departed: false,
    completed: false,
    // 发车预检（M-13 D-07/C-14）：差谁＝同屏「应到/已上车」那两个数背后的同一对集合，
    // 页面不再第二次推导「谁该上车」（铁律 19）；departAsk 是确认层的开关，不是业务状态。
    pendingCount: 0,
    pendingNames: '',
    showPendingNotice: false,
    departAsk: false,
    message: '',
    error: '',
    busy: false,
    busyAt: 0,
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.vehicleId = options.vehicleId || ''
  },

  onShow() {
    this.reload()
  },

  reload() {
    // busy 只是「这次写还没落地」的界面姿态，不是业务状态。某条命令的 promise 没能回来时，
    // 它绝不能把整块面板永久锁成「看着能点、点了没反应」——真机实测过一个残留 busy
    // 锁死组织者工作台整条分车链，而屏幕上没有任何一处说明为什么。
    if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {
      this.setData({ busy: false, busyAt: 0 })
      console.warn('[busy] 清掉一个超过 8 秒没落地的写状态')
    }
    // vehicleId 缺省时服务端会自动挑选本人可联络的车辆（selectors activityView 的
    // vehicle 视角：无 vehicleId 即 vehicleCan 命中的第一辆）。home 的协作任务卡
    // 只带 activityId，此前客户端把"缺参"当死路，车辆联络人从唯一入口进来就是 denied（P0-2）。
    return api.read({ kind: 'activity', activityId: this.activityId, perspective: 'vehicle', vehicleId: this.vehicleId || undefined }).then(res => {
      if (res.view.kind !== 'activity' || !res.view.vehicleTask) {
        this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '本车联络授权已结束。' })
        return
      }
      this.revision = res.revision
      this.now = res.now
      this.view = res.view
      this.vehicleId = res.view.vehicleTask.vehicle.id // 采用服务端解析出的车辆，后续操作都带它
      this.render()
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  render() {
    const v = this.view
    const vt = v.vehicleTask
    const vehicle = vt.vehicle
    const leg = this.data.leg
    const phase = v.activity.phase
    // 「本车返程要清点谁」由域内算好（returnBoardingApplies）：按原车返程的拼车乘客才算，
    // 另行返程与自行往返都不占这辆车的返程座位。此前这里用 returnPlan 自己重述了一遍规则。
    const expected = vt.passengers.filter(p => leg === 'outbound'
      ? ['not_departed', 'coordinating'].indexOf(p.departure) === -1
      : p.departure === 'joined' && p.returnBoardingApplies)
    const boarded = expected.filter(p => leg === 'outbound' ? p.outboundBoarded : p.returnBoarded)
    // 「还差谁」＝ expected \ boarded，两个集合都是上面那对同屏计数已经算出来的，这里只做相减：
    // 不在页面里重述「谁该上车」这条域内规则（铁律 19），也不引入第三种判据。
    const pending = expected.filter(p => boarded.indexOf(p) === -1)
    const legInfo = vehicle.legs[leg]
    const canOperate = leg === 'outbound'
      ? ['gathering', 'active'].indexOf(phase) !== -1
      : ['active', 'closing'].indexOf(phase) !== -1
    const passengers = vt.passengers.map(p => {
      const isExpected = expected.some(x => x.signupId === p.signupId)
      const hasBoarded = leg === 'outbound' ? p.outboundBoarded : p.returnBoarded
      // 徽标文案与配色都由结构化事实决定，WXML 不再拿中文文案反推状态（AGENTS.md 铁律 19）。
      // 「本程不载他」不是一个未完成项：返程另有安排、去程已核实未出发或仍在协调，
      // 就陈述他的去向，而不是点名「未上车」，让清点看起来欠了他一笔。
      const notCarried = !isExpected
      const status = notCarried
        ? (leg === 'return' ? (F.RETURN_PLAN_LABELS[p.returnPlan] || '不占本车返程') : (F.DEPARTURE_LABELS[p.departure] || '不在本程'))
        : (hasBoarded ? '已上车' : '未上车')
      const tone = notCarried ? (leg === 'return' ? 'success' : 'neutral') : (hasBoarded ? 'success' : 'warning')
      return {
        signupId: p.signupId,
        name: p.name,
        avatar: p.avatar || '',
        subtitle: p.pickup + ' · ' + (p.seat ? p.seat + '号座' : '未编号'),
        status,
        tone,
        showBoard: canOperate && !legInfo.departed && isExpected && !hasBoarded,
      }
    })
    this.setData({
      loading: false,
      denied: '',
      phase,
      label: vehicle.label,
      plate: vehicle.plate,
      capacityLine: '核载 ' + vehicle.legalCapacity + ' − 司机 ' + vehicle.drivers.length + ' − 不可用 ' + vehicle.blockedSeats
        + ' = ' + (vehicle.legalCapacity - vehicle.drivers.length - vehicle.blockedSeats) + ' 个乘客位',
      expectedCount: expected.length,
      boardedCount: boarded.length,
      pendingCount: pending.length,
      pendingNames: pending.map(p => p.name).join('、'),
      // 提示只在「这颗按钮此刻真的负责发车」时出现：已发车/阶段不可操作时再说「还差几人」
      // 就是把一件已经来不及的事冒充成待办（与铁律 27③「裁切必须自己说出来」同源，但不许裁错主语）。
      showPendingNotice: pending.length > 0 && canOperate && !legInfo.departed,
      legState: legInfo.completed ? '本程已完成' : legInfo.departed ? '本程已发车' : '逐人清点后再发车',
      passengers,
      canOperate,
      departed: !!legInfo.departed,
      completed: !!legInfo.completed,
    })
  },

  goHome() { wx.switchTab({ url: '/pages/home/home' }) },

  onLeg(e) {
    const leg = e.currentTarget.dataset.leg
    if (leg === this.data.leg) return
    this.setData({ leg }, () => this.render())
  },

  onBoard(e) {
    if (this.data.busy) return
    const signupId = e.currentTarget.dataset.id
    this.setData({ busy: true, busyAt: Date.now(), error: '' })
    api.dispatchAndSync({
      type: 'attendance.board',
      activityId: this.activityId,
      signupId,
      leg: this.data.leg,
      boarded: true,
      note: '本车联系人现场逐人清点',
    }, this.revision, this).then(res => {
      this.revision = res.revision
      this.setData({ busy: false })
      wx.vibrateShort({ type: 'light', fail: () => {} })
      api.toast('已确认上车')
      return this.reload()
    }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
  },

  onCopyContact(e) {
    const id = e.currentTarget.dataset.id
    const p = (this.view.vehicleTask.passengers || []).find(x => x.signupId === id)
    if (!p) return
    wx.setClipboardData({
      data: p.name + ' · ' + p.phone,
      success: () => this.setData({ message: '联系信息已复制。' }),
    })
  },

  // 发车的入口守卫留在 onDepartAsk 上（与 onDepart 同一对条件），确认层只负责「问」：
  // 清点没做完时不再留一颗点了才撞红字的主按钮，而是先同屏说明差谁、再走一步确认
  // （照 components/transport-panel 的 lockHint 立场 + pages/me 的 Ask/Cancel/Confirm 三步）。
  // 这里**不禁止**发车——现场可能确实弃等，最终判定仍在服务端（field.js 的 UNRESOLVED_DEPARTURE）。
  // 全员清点齐备时不额外加一层（本页是现场高频页）。
  onDepartAsk() {
    if (this.data.busy || this.data.departed) return
    if (!this.data.pendingCount) { this.onDepart(); return }
    this.setData({ departAsk: true, error: '', message: '' })
  },

  onDepartCancel() { this.setData({ departAsk: false }) },

  onDepart() {
    if (this.data.busy || this.data.departed) return
    this.setData({ busy: true, busyAt: Date.now(), error: '', departAsk: false })
    api.dispatchAndSync({ type: 'vehicle.depart', activityId: this.activityId, vehicleId: this.vehicleId, leg: this.data.leg, note: '本车清点后发车' }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ busy: false })
        wx.vibrateShort({ type: 'light', fail: () => {} })
        api.toast('已确认发车')
        return this.reload()
      }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
  },

  onComplete() {
    if (this.data.busy || this.data.completed) return
    this.setData({ busy: true, busyAt: Date.now(), error: '' })
    api.dispatchAndSync({ type: 'vehicle.complete', activityId: this.activityId, vehicleId: this.vehicleId, leg: this.data.leg, note: '本程行驶已完成' }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ busy: false })
        api.toast('本程已完成')
        return this.reload()
      }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
  },
})
