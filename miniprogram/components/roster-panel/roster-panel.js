// 名单面板（原型 screens/Roster.tsx + AccessManager）：搜索筛选、批量审核、
// 导出（复制 CSV + 审计）、联络与敏感资料、同行组约束、协作授权管理。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

const STATUS_OPTIONS = ['全部状态', '待审核', '已确认', '候补', '已拒绝', '已取消', '已移除']
const STATUS_VALUES = ['all', 'pending', 'confirmed', 'waitlisted', 'rejected', 'cancelled', 'removed']
const CAPABILITIES = [
  { value: 'roster', label: '查看名单' },
  { value: 'checkin', label: '签到确认' },
  { value: 'node', label: '路线节点' },
  { value: 'incident', label: '异常处理' },
  { value: 'position', label: '查看位置' },
  { value: 'home', label: '到家确认' },
  { value: 'sensitive', label: '必要敏感资料' },
]
const ROLE_OPTIONS = ['现场协作', '车辆联络']
const SCOPE_OPTIONS = ['明确选中的人员', '本活动全部人员']

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    activityId: { type: String, value: '' },
  },
  data: {
    loading: true,
    denied: '',
    countersLine: '',
    search: '',
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    rows: [],
    selected: {},
    selectedCount: 0,
    allChecked: false,
    groups: [],
    capsList: CAPABILITIES,
    exportOpen: false,
    exportModes: ['普通名单 · 不含电话和健康资料', '敏感名单 · 含紧急联络及健康备注'],
    exportIndex: 0,
    exportPurpose: '',
    contactOpen: false,
    contact: null,
    purpose: '',
    sensitive: null,
    batch: '',
    batchNames: '',
    batchReason: '',
    accessOpen: false,
    memberships: [],
    vehicles: [],
    roleIndex: 0,
    mUserId: '',
    expires: { date: '', time: '' },
    scopeIndex: 0,
    caps: {},
    vehicleIndex: -1,
    editingId: '',
    error: '',
    message: '',
    busy: false,
  },

  observers: {
    activityId() { this.reload() },
  },
  lifetimes: {
    attached() { this.reload() },
  },

  methods: {
    reload() {
      const activityId = this.data.activityId
      if (!activityId || this._loading) return
      this._loading = true
      return api.read({ kind: 'activity', activityId, perspective: 'organizer' }).then(res => {
        if (res.view.kind !== 'activity') {
          this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '无法查看名单' })
          return
        }
        this.revision = res.revision
        this.now = res.now
        this.view = res.view
        this._loading = false
        this.setData({ loading: false, denied: '' })
        this.render()
        this.loadTransport()
        if (this.data.accessOpen) this.loadAccess()
      }).catch(e => { this._loading = false; this.setData({ loading: false, denied: api.errorText(e) }) })
    },

    render() {
      const v = this.view
      const statusValue = STATUS_VALUES[this.data.statusIndex]
      const search = this.data.search
      const rows = v.rows
        .filter(r => statusValue === 'all' || r.status === statusValue)
        .filter(r => !search || (r.name + ' ' + r.pickup + ' ' + r.vehicle).indexOf(search) !== -1)
        .map(r => ({
          signupId: r.signupId,
          name: r.name,
          avatar: r.avatar || '',
          statusLabel: F.STATUS_LABELS[r.status] || r.status,
          tone: r.status === 'confirmed' ? 'success' : (r.status === 'pending' ? 'warning' : 'neutral'),
          subtitle: [r.pickup, r.vehicle || '未分车', r.seat ? r.seat + '座' : '', r.checkedIn ? '已签到' : '', r.home ? '已到家' : '']
            .filter(Boolean).join(' · '),
        }))
      const selected = {}
      for (const r of rows) if (this.data.selected[r.signupId]) selected[r.signupId] = true
      const selectedCount = Object.keys(selected).length
      this.setData({
        rows,
        selected,
        selectedCount,
        allChecked: rows.length > 0 && rows.every(r => selected[r.signupId]),
        countersLine: '已确认 ' + v.counters.confirmed + ' · 待审核 ' + v.counters.pending + ' · 候补 ' + v.counters.waitlisted + '。仅显示你有权查看的人员。',
      })
    },

    loadTransport() {
      api.readOr('readTransport', { activityId: this.data.activityId }).then(result => {
        const groups = result.groups
          .filter(g => g.signupIds.length > 1)
          .map(g => ({
            id: g.id,
            keepTogether: g.keepTogether,
            names: g.signupIds.map(id => {
              const r = this.view.rows.find(x => x.signupId === id)
              return r ? r.name : ''
            }).filter(Boolean).join('、'),
          }))
        this.setData({ groups, transportVehicles: result.vehicles })
      }).catch(() => {})
    },

    onSearch(e) { this.setData({ search: e.detail.value }, () => this.render()) },
    onStatus(e) { this.setData({ statusIndex: Number(e.detail.value) }, () => this.render()) },

    onSelect(e) {
      const id = e.currentTarget.dataset.id
      const checked = e.detail.value.length > 0
      const selected = Object.assign({}, this.data.selected)
      if (checked) selected[id] = true
      else delete selected[id]
      this.setData({ selected }, () => this.render())
    },
    onSelectAll(e) {
      const checked = e.detail.value.length > 0
      const selected = Object.assign({}, this.data.selected)
      for (const r of this.data.rows) {
        if (checked) selected[r.signupId] = true
        else delete selected[r.signupId]
      }
      this.setData({ selected }, () => this.render())
    },

    selectedIds() {
      return Object.keys(this.data.selected)
    },

    // ---- 批量操作 ----
    onBatch(e) {
      const action = e.currentTarget.dataset.action
      const ids = this.selectedIds()
      if (!ids.length) return
      const names = this.view.rows
        .filter(r => ids.indexOf(r.signupId) !== -1)
        .map(r => r.name).join('、')
      this.setData({ batch: action, batchNames: names, batchReason: '', error: '' })
    },
    onBatchReason(e) { this.setData({ batchReason: e.detail.value }) },
    onBatchClose() { this.setData({ batch: '' }) },
    onBatchConfirm() {
      const ids = this.selectedIds()
      if (!ids.length) return
      let payload
      if (this.data.batch === 'promote') payload = { type: 'signup.promote', activityId: this.data.activityId, signupIds: ids }
      else if (this.data.batch === 'cancel') {
        if (!this.data.batchReason.trim()) {
          this.setData({ error: '取消需要填写原因。' })
          return
        }
        payload = { type: 'signup.cancel', activityId: this.data.activityId, signupIds: ids, reason: this.data.batchReason }
      } else payload = { type: 'signup.review', activityId: this.data.activityId, signupIds: ids, decision: this.data.batch }
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync(payload, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, batch: '', selected: {}, message: '操作已保存。' })
          api.toast('已保存')
          return this.reload()
        })
        .catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },

    // ---- 导出 ----
    onExportOpen() {
      if (!this.selectedIds().length) return
      this.setData({ exportOpen: true, exportPurpose: '', exportIndex: 0, error: '' })
    },
    onExportClose() { this.setData({ exportOpen: false }) },
    onExportMode(e) { this.setData({ exportIndex: Number(e.detail.value) }) },
    onExportPurpose(e) { this.setData({ exportPurpose: e.detail.value }) },
    onExportConfirm() {
      const ids = this.selectedIds()
      const mode = this.data.exportIndex === 1 ? 'sensitive' : 'ordinary'
      const purpose = this.data.exportPurpose.trim()
      if (!purpose) {
        this.setData({ error: '导出用途必填，请写明本次导出的工作用途。' })
        return
      }
      this.setData({ busy: true, error: '' })
      api.dispatchAndSync({ type: 'export.record', activityId: this.data.activityId, signupIds: ids, mode, purpose }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          return api.readExport(this.data.activityId, ids, mode, purpose)
        })
        .then(result => {
          if (!result.ok) {
            this.setData({ busy: false, error: result.error.message })
            return
          }
          wx.setClipboardData({
            data: result.value,
            success: () => {
              this.setData({ busy: false, exportOpen: false, message: '已生成 ' + ids.length + ' 人的' + (mode === 'ordinary' ? '普通' : '敏感') + '名单并复制到剪贴板。请妥善保存，不向无关人员转发。' })
              api.toast('名单已复制')
            },
            fail: () => this.setData({ busy: false, error: '审计已保存，但复制到剪贴板失败。' }),
          })
        })
        .catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },

    // ---- 联络与敏感资料 ----
    onContact(e) {
      const id = e.currentTarget.dataset.id
      const row = this.view.rows.find(r => r.signupId === id)
      if (!row) return
      this.setData({ contactOpen: true, contact: { signupId: id, name: row.name }, purpose: '', sensitive: null, error: '' })
      api.readContact(this.data.activityId, id).then(result => {
        if (result.ok) this.setData({ contact: Object.assign({}, this.data.contact, { phone: result.value.phone }) })
        else this.setData({ contact: Object.assign({}, this.data.contact, { phoneError: result.error.message }) })
      }).catch(e => this.setData({ contact: Object.assign({}, this.data.contact, { phoneError: api.errorText(e) }) }))
    },
    onContactClose() { this.setData({ contactOpen: false, contact: null, sensitive: null }) },
    onPurpose(e) { this.setData({ purpose: e.detail.value, sensitive: null }) },
    onSensitive() {
      if (!this.data.purpose.trim() || !this.data.contact) return
      api.readSensitive(this.data.activityId, this.data.contact.signupId, this.data.purpose.trim())
        .then(result => {
          if (result.ok) this.setData({ sensitive: result.value })
          else this.setData({ sensitive: null, error: result.error.message })
        })
        .catch(e => this.setData({ error: api.errorText(e) }))
    },
    onEditSignup() {
      const id = this.data.contact && this.data.contact.signupId
      this.setData({ contactOpen: false })
      if (id) wx.navigateTo({ url: '/pages/signup/signup?id=' + this.data.activityId + '&signupId=' + id })
    },

    // ---- 同行组约束 ----
    onToggleGroup(e) {
      const { id, keep } = e.currentTarget.dataset
      api.dispatchAndSync({ type: 'group.setTogether', activityId: this.data.activityId, groupId: id, keepTogether: !keep }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          api.toast('同行组约束已保存')
          this.loadTransport()
        })
        .catch(err => this.setData({ error: api.errorText(err) }))
    },

    // ---- 协作授权 ----
    onAccessOpen() { this.setData({ accessOpen: true }, () => this.loadAccess()) },
    onAccessClose() { this.setData({ accessOpen: false }) },
    loadAccess() {
      api.readOr('readAccess', { activityId: this.data.activityId }).then(result => {
        const memberships = result.memberships.map(m => ({
          id: m.id,
          role: m.role,
          roleLabel: m.role === 'staff' ? '现场协作' : '车辆联络',
          userId: m.userId,
          expiresLabel: F.dtFull(m.expiresAt),
          scope: m.role === 'staff' ? m.scope : null,
          capabilities: m.role === 'staff' ? m.capabilities : [],
          vehicleId: m.role === 'vehicle_contact' ? m.vehicleId : '',
        }))
        const vehicles = (this.data.transportVehicles || []).map(v => v.label)
        this.transportVehicleIds = (this.data.transportVehicles || []).map(v => v.id)
        this.setData({ memberships, vehicles, accessError: '' })
      }).catch(e => this.setData({ accessError: api.errorText(e) }))
    },
    onEditMembership(e) {
      const id = e.currentTarget.dataset.id
      const m = (this.data.memberships || []).find(x => x.id === id)
      if (!m) return
      const caps = {}
      for (const c of m.capabilities || []) caps[c] = true
      this.setData({
        editingId: m.id,
        roleIndex: m.role === 'staff' ? 0 : 1,
        mUserId: m.userId,
        expires: { date: F.dtFull(m.expiresAt).slice(0, 10), time: F.dtFull(m.expiresAt).slice(11, 16) },
        scopeIndex: m.scope && m.scope.kind === 'all' ? 1 : 0,
        caps,
        vehicleIndex: m.vehicleId ? this.transportVehicleIds.indexOf(m.vehicleId) : -1,
      })
    },
    onRevokeMembership(e) {
      const id = e.currentTarget.dataset.id
      api.dispatchAndSync({ type: 'membership.revoke', activityId: this.data.activityId, membershipId: id }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          api.toast('授权已撤销')
          this.loadAccess()
        })
        .catch(err => this.setData({ error: api.errorText(err) }))
    },
    onRole(e) { this.setData({ roleIndex: Number(e.detail.value) }) },
    onMUserId(e) { this.setData({ mUserId: e.detail.value }) },
    onExpiresDate(e) {
      this.setData({ expires: Object.assign({}, this.data.expires, { date: e.detail.value }) })
    },
    onExpiresTime(e) {
      this.setData({ expires: Object.assign({}, this.data.expires, { time: e.detail.value }) })
    },
    onScope(e) { this.setData({ scopeIndex: Number(e.detail.value) }) },
    onUseCurrentSelection() {
      this.setData({ scopeIndex: 0, selected: Object.assign({}, this.data.selected) })
      api.toast('已按当前勾选的 ' + this.selectedIds().length + ' 人设置范围')
    },
    onCap(e) {
      const caps = {}
      for (const v of e.detail.value || []) caps[v] = true
      this.setData({ caps })
    },
    onVehiclePick(e) { this.setData({ vehicleIndex: Number(e.detail.value) }) },
    onAccessReset() {
      this.setData({ editingId: '', roleIndex: 0, mUserId: '', expires: { date: '', time: '' }, scopeIndex: 0, caps: {}, vehicleIndex: -1 })
    },
    onAccessSave() {
      const userId = this.data.mUserId.trim()
      const expiresAt = this.data.expires.date && this.data.expires.time
        ? this.data.expires.date + 'T' + this.data.expires.time + ':00+08:00' : ''
      const capabilities = CAPABILITIES.map(c => c.value).filter(v => this.data.caps[v])
      const role = this.data.roleIndex === 0 ? 'staff' : 'vehicle_contact'
      if (!userId || !expiresAt) {
        this.setData({ error: '请填写对方的身份码与授权截止时间。' })
        return
      }
      if (role === 'staff' && (!capabilities.length || (this.data.scopeIndex === 0 && !this.selectedIds().length))) {
        this.setData({ error: '请选择工作能力和有效的分管范围（可先在名单里勾选人员）。' })
        return
      }
      if (role === 'vehicle_contact' && (this.data.vehicleIndex < 0 || !this.transportVehicleIds)) {
        this.setData({ error: '请选择负责车辆（先在分车里添加车辆）。' })
        return
      }
      const membershipId = this.data.editingId || ('membership-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
      const membership = role === 'staff' ? {
        role, id: membershipId, activityId: this.data.activityId, userId, expiresAt,
        scope: this.data.scopeIndex === 1 ? { kind: 'all' } : { kind: 'selected', signupIds: this.selectedIds() },
        capabilities,
      } : {
        role, id: membershipId, activityId: this.data.activityId, userId, expiresAt,
        vehicleId: this.transportVehicleIds[this.data.vehicleIndex],
      }
      api.dispatchAndSync({ type: 'membership.save', activityId: this.data.activityId, membership }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ editingId: membershipId, message: '授权已保存。' })
          api.toast('授权已保存')
          this.loadAccess()
        })
        .catch(err => this.setData({ error: api.errorText(err) }))
    },
  },
})
