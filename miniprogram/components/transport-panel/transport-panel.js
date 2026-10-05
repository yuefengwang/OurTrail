// 分车面板（原型 screens/Transport.tsx + VehicleEditor）：
// 车辆档案、自动分车预览/提交、手动指派/移除/交换、座位示意、删除车辆。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    activityId: { type: String, value: '' },
    // 宿主页读到的「phase@revision」：后端一变就重读，面板常驻也不再停在旧阶段。
    syncKey: { type: String, value: '' },
  },
  data: {
    loading: true,
    denied: '',
    metrics: { vehicles: 0, seats: 0, unassigned: 0 },
    vehicles: [],
    groups: [],
    confirmed: [],
    driverCandidates: [],
    pickupNames: {},
    // 车辆编辑
    editorOpen: false,
    vform: null,
    editingVehicleId: '',
    // 预览
    planOpen: false,
    plan: null,
    planChanged: [],
    planRemoved: [],
    // 指派
    assignOpen: false,
    assignVehicleId: '',
    assignSeat: '',
    assignIndex: -1,
    confirmedOptions: [],
    swapIndex: -1,
    swapOptions: [],
    // 删除
    removeOpen: false,
    removeVehicleId: '',
    removeLabel: '',
    error: '',
    message: '',
    busy: false,
  },

  observers: {
    activityId() { this.reload() },
    syncKey(key) { if (key && key !== this._readKey) this.reload() },
  },
  lifetimes: {
    attached() { this.reload() },
  },

  methods: {
    reload() {
      const activityId = this.data.activityId
      if (!activityId || this._loading) return
      this._loading = true
      return Promise.all([
        api.read({ kind: 'activity', activityId, perspective: 'organizer' }),
        api.readOr('readTransport', { activityId }),
      ]).then(([res, tr]) => {
        if (res.view.kind !== 'activity') {
          this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '无法管理车辆安排' })
          return
        }
        this.revision = res.revision
        this.now = res.now
        this.view = res.view
        this._readKey = res.view.activity.phase + '@' + res.revision
        const v = res.view
        const transport = tr
        const pickupNames = {}
        for (const p of v.activity.pickupPoints) pickupNames[p.id] = p.name
        const nameOf = id => {
          const r = v.rows.find(x => x.signupId === id)
          return r ? r.name : '不可见参与人'
        }
        const vehicles = transport.vehicles.map(vehicle => {
          const passengers = transport.assignments
            .filter(a => a.vehicleId === vehicle.id)
            .map(a => ({
              signupId: a.signupId,
              name: nameOf(a.signupId),
              seat: a.seatLabel || '',
              pickup: (v.rows.find(x => x.signupId === a.signupId) || {}).pickup || '',
            }))
          const seatCells = []
          if (vehicle.seatLabels) {
            vehicle.seatLabels.forEach((seat, i) => {
              const occ = passengers.find(p => p.seat === seat)
              seatCells.push({
                seat,
                occupant: occ ? occ.name : '',
                signupId: occ ? occ.signupId : '',
                occupied: !!occ,
                aisle: i % 4 === 2,
              })
            })
          }
          return {
            id: vehicle.id,
            label: vehicle.label,
            plate: vehicle.plate,
            legal: vehicle.legalCapacity,
            drivers: vehicle.drivers.length,
            blocked: vehicle.blockedSeats,
            usable: F.usable(vehicle),
            driverNames: vehicle.drivers.map(d => d.kind === 'service' ? d.name : nameOf(d.signupId)).join('、'),
            pickupList: vehicle.pickupPointIds.map(id => pickupNames[id] || '上车点已变更').join('、') || '尚未设置',
            seatLabels: !!vehicle.seatLabels,
            seatCells,
            passengers,
          }
        })
        const confirmed = v.rows.filter(r => r.status === 'confirmed').map(r => ({
          signupId: r.signupId, label: r.name + ' · ' + r.pickup + ' · ' + (r.vehicle || '未分车'),
        }))
        // 参与者司机候选：域规则要求「已确认且尚无车辆安排」（transport.js 校验，先在这里过滤掉必被拒的人）
        const driverCandidates = v.rows
          .filter(r => r.status === 'confirmed' && !r.vehicle)
          .map(r => ({ signupId: r.signupId, label: r.name + ' · ' + r.pickup }))
        this._loading = false
        this.setData({
          loading: false,
          denied: '',
          metrics: {
            vehicles: transport.vehicles.length,
            seats: transport.vehicles.reduce((sum, x) => sum + F.usable(x), 0),
            unassigned: v.counters.unassigned,
          },
          vehicles,
          groups: transport.groups.filter(g => g.keepTogether && g.signupIds.length > 1).map(g => ({
            id: g.id,
            names: g.signupIds.map(nameOf).join('、'),
          })),
          confirmed,
          driverCandidates,
          assignments: transport.assignments,
        })
      }).catch(e => { this._loading = false; this.setData({ loading: false, denied: api.errorText(e) }) })
    },

    // ---- 预览自动分车 ----
    onPreview() {
      if (this.data.busy || !this.data.vehicles.length) return
      api.previewAssignments(this.data.activityId).then(result => {
        if (!result.ok) {
          this.setData({ error: result.error.message })
          return
        }
        const plan = result.value
        const nameOf = id => {
          const r = this.view.rows.find(x => x.signupId === id)
          return r ? r.name : '不可见参与人'
        }
        const labelOf = id => {
          const v = (this.data.vehicles || []).find(x => x.id === id)
          return v ? v.label : '车辆已变更'
        }
        const prev = {}
        for (const a of this.data.assignments || []) prev[a.signupId] = a
        const next = {}
        for (const a of plan.assignments) next[a.signupId] = a
        const planChanged = plan.assignments
          .filter(a => {
            const old = prev[a.signupId]
            return !old || old.vehicleId !== a.vehicleId || (old.seatLabel || '') !== (a.seatLabel || '')
          })
          .map(a => ({
            signupId: a.signupId,
            name: nameOf(a.signupId),
            line: (prev[a.signupId] ? labelOf(prev[a.signupId].vehicleId) + ' ' + (prev[a.signupId].seatLabel || '') : '未安排')
              + ' → ' + labelOf(a.vehicleId) + (a.seatLabel ? ' ' + a.seatLabel + '座' : ' 不编座号'),
          }))
        const planRemoved = (this.data.assignments || [])
          .filter(a => !next[a.signupId])
          .map(a => ({ signupId: a.signupId, name: nameOf(a.signupId), line: labelOf(a.vehicleId) }))
        const planUnassigned = plan.unassigned.map(u => ({
          signupId: u.signupId,
          name: nameOf(u.signupId),
          reason: F.UNASSIGNED_LABELS[u.reason] || u.reason,
        }))
        this.setData({
          planOpen: true,
          plan,
          planChanged,
          planRemoved,
          planUnassigned,
          planCounts: { changed: planChanged.length, removed: planRemoved.length, unassigned: planUnassigned.length },
          error: '',
        })
      }).catch(e => this.setData({ error: api.errorText(e) }))
    },
    onPlanClose() { this.setData({ planOpen: false }) },
    onPlanRecompute() { this.onPreview() },
    onPlanCommit() {
      if (!this.data.plan || this.data.busy) return
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync({ type: 'assignment.commit', activityId: this.data.activityId, preview: this.data.plan }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, planOpen: false, message: '分车方案已保存。' })
          api.toast('已保存')
          this.reload()
        })
        .catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },

    // ---- 手动指派 ----
    openAssign(e) {
      const { vehicle, seat, occupant } = e.currentTarget.dataset
      const current = occupant || ''
      const assignments = this.data.assignments || []
      const currentAssignment = assignments.find(a => a.signupId === current)
      const swapOptions = assignments
        .filter(a => a.signupId !== current)
        .map(a => ({
          signupId: a.signupId,
          label: (this.data.confirmed.find(c => c.signupId === a.signupId) || {}).label || a.signupId,
        }))
      const idx = current ? this.data.confirmed.findIndex(c => c.signupId === current) : -1
      this.setData({
        assignOpen: true,
        assignVehicleId: vehicle,
        assignSeat: seat || '',
        assignIndex: idx,
        confirmedOptions: this.data.confirmed,
        swapOptions,
        swapIndex: -1,
        hasCurrent: !!current,
        currentAssignmentSeat: currentAssignment ? (currentAssignment.seatLabel || '') : '',
        error: '',
      })
    },
    onAssignClose() { this.setData({ assignOpen: false }) },
    onAssignPick(e) { this.setData({ assignIndex: Number(e.detail.value) }) },
    onSwapPick(e) { this.setData({ swapIndex: Number(e.detail.value) }) },
    onAssignSet() {
      const pick = this.data.confirmedOptions[this.data.assignIndex]
      if (!pick || this.data.busy) return
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync({
        type: 'assignment.set',
        activityId: this.data.activityId,
        target: { signupId: pick.signupId, vehicleId: this.data.assignVehicleId, seatLabel: this.data.assignSeat || null },
      }, this.revision, this).then(res => {
        this.revision = res.revision
        this.setData({ busy: false, assignOpen: false, message: '此人的车辆安排已保存。' })
        api.toast('已保存')
        this.reload()
      }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },
    onAssignRemove() {
      const pick = this.data.confirmedOptions[this.data.assignIndex]
      if (!pick || this.data.busy) return
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync({ type: 'assignment.remove', activityId: this.data.activityId, signupId: pick.signupId }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, assignOpen: false, message: '已移除此人的车辆安排。' })
          api.toast('已移除')
          this.reload()
        }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },
    onSwap() {
      const pick = this.data.confirmedOptions[this.data.assignIndex]
      const swap = this.data.swapOptions[this.data.swapIndex]
      if (!pick || !swap || this.data.busy) return
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync({
        type: 'assignment.swap',
        activityId: this.data.activityId,
        firstSignupId: pick.signupId,
        secondSignupId: swap.signupId,
      }, this.revision, this).then(res => {
        this.revision = res.revision
        this.setData({ busy: false, assignOpen: false, message: '两人的车辆座位已交换。' })
        api.toast('已交换')
        this.reload()
      }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },

    // ---- 删除车辆 ----
    onRemoveAsk(e) {
      const id = e.currentTarget.dataset.id
      const v = this.data.vehicles.find(x => x.id === id)
      this.setData({ removeOpen: true, removeVehicleId: id, removeLabel: v ? v.label : '' })
    },
    onRemoveClose() { this.setData({ removeOpen: false }) },
    onRemoveConfirm() {
      if (!this.data.removeVehicleId || this.data.busy) return
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync({ type: 'vehicle.remove', activityId: this.data.activityId, vehicleId: this.data.removeVehicleId }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, removeOpen: false, message: '车辆已删除。' })
          api.toast('已删除')
          this.reload()
        }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },

    // ---- 车辆编辑 ----
    onEditorOpen(e) {
      const id = e.currentTarget.dataset.id || ''
      api.readTransport(this.data.activityId).then(result => {
        if (!result.ok) {
          this.setData({ error: result.error.message })
          return
        }
        const vehicle = result.value.vehicles.find(v => v.id === id)
        const form = vehicle ? {
          label: vehicle.label,
          plate: vehicle.plate,
          legal: String(vehicle.legalCapacity),
          blocked: String(vehicle.blockedSeats),
          seatLabelsOn: !!vehicle.seatLabels,
          seatLabelsText: vehicle.seatLabels ? vehicle.seatLabels.join(',') : '',
          drivers: vehicle.drivers.map(d => d.kind === 'participant'
            ? { kind: 'participant', signupIndex: this.data.driverCandidates.findIndex(c => c.signupId === d.signupId), name: '', phone: '' }
            : { kind: 'service', signupIndex: -1, name: d.name, phone: d.phone }),
          pickupIds: vehicle.pickupPointIds.slice(),
        } : {
          label: '', plate: '', legal: '7', blocked: '0', seatLabelsOn: false, seatLabelsText: '',
          drivers: [], pickupIds: [],
        }
        this.setData({
          editorOpen: true,
          editingVehicleId: id,
          vform: form,
          pickupOptions: this.view.activity.pickupPoints.map(p => ({ id: p.id, name: p.name })),
          error: '',
        })
      }).catch(e => this.setData({ error: api.errorText(e) }))
    },
    onEditorClose() { this.setData({ editorOpen: false, vform: null }) },
    onVField(e) {
      const key = e.currentTarget.dataset.key
      const vform = Object.assign({}, this.data.vform)
      vform[key] = e.detail.value
      this.setData({ vform })
    },
    onSeatLabelsOn(e) {
      const vform = Object.assign({}, this.data.vform)
      vform.seatLabelsOn = e.detail.value
      if (e.detail.value && !vform.seatLabelsText) {
        const usable = Math.max(0, (Number(vform.legal) || 0) - vform.drivers.length - (Number(vform.blocked) || 0))
        vform.seatLabelsText = Array.from({ length: usable }, (_, i) => String(i + 1).padStart(2, '0')).join(',')
      }
      this.setData({ vform })
    },
    onDriverKind(e) {
      const i = e.currentTarget.dataset.index
      const vform = Object.assign({}, this.data.vform)
      const drivers = vform.drivers.slice()
      drivers[i] = Number(e.detail.value) === 1
        ? { kind: 'participant', signupIndex: -1, name: '', phone: '' }
        : { kind: 'service', signupIndex: -1, name: '', phone: '' }
      vform.drivers = drivers
      this.setData({ vform })
    },
    onDriverField(e) {
      const { index, key } = e.currentTarget.dataset
      const vform = Object.assign({}, this.data.vform)
      const drivers = vform.drivers.slice()
      drivers[index] = Object.assign({}, drivers[index], { [key]: e.detail.value })
      vform.drivers = drivers
      this.setData({ vform })
    },
    onDriverPick(e) {
      const index = e.currentTarget.dataset.index
      const vform = Object.assign({}, this.data.vform)
      const drivers = vform.drivers.slice()
      drivers[index] = Object.assign({}, drivers[index], { signupIndex: Number(e.detail.value) })
      vform.drivers = drivers
      this.setData({ vform })
    },
    addDriver() {
      const vform = Object.assign({}, this.data.vform)
      vform.drivers = vform.drivers.concat([{ kind: 'service', signupIndex: -1, name: '', phone: '' }])
      this.setData({ vform })
    },
    removeDriver(e) {
      const index = e.currentTarget.dataset.index
      const vform = Object.assign({}, this.data.vform)
      const drivers = vform.drivers.slice()
      drivers.splice(index, 1)
      vform.drivers = drivers
      this.setData({ vform })
    },
    onPickupToggle(e) {
      const vform = Object.assign({}, this.data.vform)
      vform.pickupIds = (e.detail.value || []).slice()
      this.setData({ vform })
    },
    onVehicleSave() {
      const f = this.data.vform
      const legal = Number(f.legal)
      const blocked = Number(f.blocked)
      const drivers = []
      for (const d of f.drivers) {
        if (d.kind === 'participant') {
          const c = this.data.driverCandidates[d.signupIndex]
          if (!c) {
            this.setData({ error: '请为参与者司机选择人选（需已确认报名且尚未分车）。' })
            return
          }
          drivers.push({ kind: 'participant', signupId: c.signupId })
        } else {
          if (!d.name.trim() || !F.validPhone(d.phone)) {
            this.setData({ error: '服务司机需要姓名和11位联系电话。' })
            return
          }
          drivers.push({ kind: 'service', name: d.name.trim(), phone: d.phone, userId: null })
        }
      }
      if (!f.label.trim() || !Number.isInteger(legal) || legal < 1 || legal > 60 || !(Number.isInteger(blocked) && blocked >= 0) || !drivers.length) {
        this.setData({ error: '请填写车辆名称、有效核载人数和完整司机信息。' })
        return
      }
      // 服务端要求车辆至少挂一个本活动集合点（否则报「集合点不属于本场活动」的谜语），
      // 这里提前用可执行的文案拦住（2026-09-30 真机走查实测：不勾上车点提交必炸）。
      if (!f.pickupIds.length) {
        this.setData({ error: '请至少勾选一个集合上车点——车辆在此接人。' })
        return
      }
      const usable = legal - drivers.length - blocked
      if (usable < 0) {
        this.setData({ error: '核载减去司机及不可用位后不能为负数。' })
        return
      }
      let seatLabels = null
      if (f.seatLabelsOn) {
        seatLabels = f.seatLabelsText.split(',').map(s => s.trim()).filter(Boolean)
        if (seatLabels.length !== usable || new Set(seatLabels).size !== seatLabels.length) {
          this.setData({ error: '座号必须唯一，且数量与可用乘客位（' + usable + '）一致。' })
          return
        }
      }
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync({
        type: 'vehicle.save',
        activityId: this.data.activityId,
        vehicleId: this.data.editingVehicleId || null,
        input: {
          label: f.label.trim(), plate: f.plate.trim(), legalCapacity: legal,
          drivers, blockedSeats: blocked, seatLabels,
          pickupPointIds: f.pickupIds.slice(),
        },
      }, this.revision, this).then(res => {
        this.revision = res.revision
        this.setData({ busy: false, editorOpen: false, vform: null, message: '车辆安排已更新。' })
        api.toast('已保存')
        this.reload()
      }).catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },
  },
})
