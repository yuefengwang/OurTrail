// 本车任务（原型 screens/VehicleTask.tsx）：去程/返程逐人清点、发车与完成。
'use strict'
const api = require('../../utils/api')

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
    message: '',
    error: '',
    busy: false,
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.vehicleId = options.vehicleId || ''
  },

  onShow() {
    this.reload()
  },

  reload() {
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
    const expected = vt.passengers.filter(p => leg === 'outbound'
      ? ['not_departed', 'coordinating'].indexOf(p.departure) === -1
      : p.departure === 'joined' && p.returnPlan === 'assigned')
    const boarded = expected.filter(p => leg === 'outbound' ? p.outboundBoarded : p.returnBoarded)
    const legInfo = vehicle.legs[leg]
    const canOperate = leg === 'outbound'
      ? ['gathering', 'active'].indexOf(phase) !== -1
      : ['active', 'closing'].indexOf(phase) !== -1
    const passengers = vt.passengers.map(p => {
      const isExpected = expected.some(x => x.signupId === p.signupId)
      const hasBoarded = leg === 'outbound' ? p.outboundBoarded : p.returnBoarded
      return {
        signupId: p.signupId,
        name: p.name,
        avatar: p.avatar || '',
        subtitle: p.pickup + ' · ' + (p.seat ? p.seat + '号座' : '未编号'),
        status: leg === 'return' && p.returnPlan === 'independent' ? '另行返程' : (hasBoarded ? '已上车' : '未上车'),
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
      legState: legInfo.completed ? '本程已完成' : legInfo.departed ? '本程已发车' : '逐人清点后再发车',
      passengers,
      canOperate,
      departed: !!legInfo.departed,
      completed: !!legInfo.completed,
    })
  },

  onLeg(e) {
    const leg = e.currentTarget.dataset.leg
    if (leg === this.data.leg) return
    this.setData({ leg }, () => this.render())
  },

  onBoard(e) {
    if (this.data.busy) return
    const signupId = e.currentTarget.dataset.id
    this.setData({ busy: true, error: '' })
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

  onDepart() {
    if (this.data.busy || this.data.departed) return
    this.setData({ busy: true, error: '' })
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
    this.setData({ busy: true, error: '' })
    api.dispatchAndSync({ type: 'vehicle.complete', activityId: this.activityId, vehicleId: this.vehicleId, leg: this.data.leg, note: '本程行驶已完成' }, this.revision, this)
      .then(res => {
        this.revision = res.revision
        this.setData({ busy: false })
        api.toast('本程已完成')
        return this.reload()
      }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
  },
})
