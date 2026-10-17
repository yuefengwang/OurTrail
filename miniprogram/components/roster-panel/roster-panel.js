// 名单面板（原型 screens/Roster.tsx + AccessManager）：搜索筛选、批量审核、
// 导出（复制 CSV + 审计）、联络与敏感资料、同行组约束、协作授权管理。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const J = require('../../utils/journey')

// 筛选器选项与状态标签只有 journey.statusFilterOptions() 一份出处。
// 这里曾自带一份 ['全部状态','待审核','候补','已拒绝'...]，与 format.STATUS_LABELS（'候补中'/'未通过'）
// 在同屏并排出现——同一行数据在两处叫不同名字。
const STATUS_FILTERS = J.statusFilterOptions()
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
    // 宿主页读到的「phase@revision」：后端一变就重读，避免面板常驻却停在旧阶段（workspace 曾因此名单计数与弹层全旧）。
    syncKey: { type: String, value: '' },
  },
  data: {
    loading: true,
    denied: '',
    countersLine: '',
    search: '',
    statusOptions: STATUS_FILTERS,
    // 协作授权弹层的两个 picker 数据源：常量此前只存在模块作用域、从未挂进 data，
    // picker 的 range 取到 undefined（弹层能开、下拉恒为空，车辆联络授不出去）。
    roleOptions: ROLE_OPTIONS,
    scopeOptions: SCOPE_OPTIONS,
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
    // 「负责车辆」下拉的三态（读取中 / 读取失败 / 确实没有车辆），由 applyVehicles 一处翻译。
    // 初始为「读取中」：本组件挂载后那条 readTransport 还没落地之前，下拉不该假装成空列表。
    vehicleLoading: true,
    vehicleFailed: false,
    vehicleEmpty: false,
    roleIndex: 0,
    mUserId: '',
    expires: { date: '', time: '' },
    scopeIndex: 0,
    caps: {},
    vehicleIndex: -1,
    editingId: '',
    revokeId: '',
    revokeText: '',
    error: '',
    message: '',
    busy: false,
    busyAt: 0,
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
      // busy 只是「这次写还没落地」的界面姿态，不是业务状态。某条命令的 promise 没能回来时，
      // 它绝不能把整块面板永久锁成「看着能点、点了没反应」——真机实测过一个残留 busy
      // 锁死组织者工作台整条分车链，而屏幕上没有任何一处说明为什么。
      if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {
        this.setData({ busy: false, busyAt: 0 })
        console.warn('[busy] 清掉一个超过 8 秒没落地的写状态')
      }
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
        this._readKey = res.view.activity.phase + '@' + res.revision
        this.setData({ loading: false, denied: '' })
        this.render()
        this.loadTransport()
        if (this.data.accessOpen) this.loadAccess()
      }).catch(e => { this._loading = false; this.setData({ loading: false, denied: api.errorText(e) }) })
    },

    render() {
      const v = this.view
      const statusValue = (STATUS_FILTERS[this.data.statusIndex] || STATUS_FILTERS[0]).value
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
          // 副标题按出行方式分层：自行前往的人不该看到「未分车」这种欠事字样，
          // 车辆/座位/上车点只在「需要乘车」时才是一项信息。判断读 tripMode，不读文案。
          subtitle: [
            F.TRIP_MODE_LABELS[r.tripMode] || r.tripMode,
            r.tripMode === 'shared' ? (r.pickup || F.PICKUP_MISSING) : '',
            r.tripMode === 'shared' ? (r.vehicle || '待安排车辆') : '',
            r.tripMode === 'shared' && r.seat ? r.seat + '座' : '',
            r.checkedIn ? '已签到' : '',
            r.home ? '已到家' : '',
          ].filter(Boolean).join(' · '),
        }))
      const selected = {}
      for (const r of rows) if (this.data.selected[r.signupId]) selected[r.signupId] = true
      const selectedCount = Object.keys(selected).length
      // 批量动作的可用性按「当前勾选的全部行」的状态×阶段计算，与 domain 的整批规则同向
      // （signup.js：review 仅限全部 pending 且 published；promote 仅限全部 waitlisted 且 published；
      //  cancel 允许 published|gathering 且全部为 current 未出行——出行事实取行上字段，车辆已发车的
      //  剩余判定留给后端）。后端仍是最终权威；这里挡住的是「点下去必被整批拒」的入口（Phase 5 BUG-C）。
      const selRows = Object.keys(this.data.selected)
        .map(id => this.view.rows.find(r => r.signupId === id))
        .filter(Boolean)
      const phase = this.view.activity.phase
      const allPending = selRows.length > 0 && selRows.every(r => r.status === 'pending')
      const allWaitlisted = selRows.length > 0 && selRows.every(r => r.status === 'waitlisted')
      const allCurrentUntravelled = selRows.length > 0 && selRows.every(r =>
        (r.status === 'pending' || r.status === 'confirmed' || r.status === 'waitlisted')
        && !r.home && r.departure !== 'joined' && !r.outboundBoarded && !r.returnBoarded)
      this.setData({
        rows,
        selected,
        selectedCount,
        allChecked: rows.length > 0 && rows.every(r => selected[r.signupId]),
        canReview: allPending && phase === 'published',
        canPromote: allWaitlisted && phase === 'published',
        canCancel: allCurrentUntravelled && ['published', 'gathering'].indexOf(phase) !== -1,
        countersLine: '已确认 ' + v.counters.confirmed + ' · 待审核 ' + v.counters.pending + ' · 候补 ' + v.counters.waitlisted + '。仅显示你有权查看的人员。',
      })
    },

    loadTransport() {
      // 这条 readTransport 是「负责车辆」下拉的唯一出处。它此前被当两件事用：
      // 协作授权弹层直接读 this.data.transportVehicles，而那份数据是这条**并发读**的产物，
      // 两个读没有先后保证 ⇒ readAccess 先回时下拉恒为空，页面再给出「先去分车添加车辆」的错误指引（C-20）。
      // 现在：读的结果显式带状态（成功/失败），弹层装配必须等它落地。
      // _vehicleState 只记「上一条读落地的结果」，刷新期间界面上保留上一份候选（不清空、不假装在加载）。
      const gen = (this._transportGen || 0) + 1
      this._transportGen = gen
      const p = api.readOr('readTransport', { activityId: this.data.activityId }).then(result => {
        if (this._transportGen !== gen) return { ok: false, stale: true }
        this._transportRead = null
        const rows = (this.view && this.view.rows) || []
        const groups = (result.groups || [])
          .filter(g => g.signupIds.length > 1)
          .map(g => ({
            id: g.id,
            keepTogether: g.keepTogether,
            names: g.signupIds.map(id => {
              const r = rows.find(x => x.signupId === id)
              return r ? r.name : ''
            }).filter(Boolean).join('、'),
          }))
        const vehicles = result.vehicles || []
        this.applyVehicles('ready', vehicles)
        this.setData({ groups })
        return { ok: true, vehicles }
      }).catch(e => {
        if (this._transportGen !== gen) return { ok: false, stale: true }
        this._transportRead = null
        // 读取失败**不写成**「这场活动还没有车辆」：读故障与空态是两件事（同 notices 页那类缺陷）。
        this.applyVehicles('failed', null)
        return { ok: false, error: e }
      })
      this._transportRead = p
      return p
    },

    // 下拉候选与保存要用的 id 只在这一处装配：两者来自同一次读，绝不允许 range 来自 A、ids 来自 B。
    // 三条布尔由这次算出的 list 直接翻译，不回头读 this.data 里刚写进去的值。
    applyVehicles(state, list) {
      const vehicles = state === 'failed' ? [] : (list || [])
      this._vehicleState = state
      this._transportVehicles = vehicles
      this.transportVehicleIds = vehicles.map(v => v.id)
      this.setData({
        vehicles: vehicles.map(v => v.label),
        vehicleLoading: false,
        vehicleFailed: state === 'failed',
        vehicleEmpty: state === 'ready' && !vehicles.length,
      })
    },

    // 弹层的显式依赖收口：正在飞的那一条就等它（不另发第二条读，免得造出第二个真值源）；
    // 已经读成功就用已在位的那份；从没读起过才开始第一条。失败态不在这里自动重试——
    // 重试是界面上那颗按钮的显式动作（读可以重试，写绝不自动重发，铁律 24）。
    ensureTransport() {
      if (this._transportRead) return this._transportRead
      if (this._vehicleState === 'ready') return Promise.resolve({ ok: true, vehicles: this._transportVehicles || [] })
      if (this._vehicleState === 'failed') return Promise.resolve({ ok: false })
      return this.loadTransport()
    },

    onRetryVehicles() {
      this.loadTransport().then(read => {
        // 重试成功后，正在调整的既有授权要按新读到的列表重新回显它原来那辆车，
        // 否则用户会看到「请选择车辆」，以为刚才的授权凭空没了。
        if (!read || !read.ok || !this.data.editingId) return
        const m = (this.data.memberships || []).find(x => x.id === this.data.editingId)
        if (m && m.vehicleId) this.setData({ vehicleIndex: this.transportVehicleIds.indexOf(m.vehicleId) })
      })
    },

    // 「读不到车辆」与「确实没有车辆」必须分岔说话：前者让人重试，后者才让人去分车区添加车辆。
    vehicleBlockReason() {
      if (this.data.vehicleLoading) return '车辆列表正在读取，请等它读完再保存。'
      if (this.data.vehicleFailed) return '车辆列表这次没有读到——这不代表这场活动没有车辆，请点「重新读取车辆列表」后再保存。'
      if (this.data.vehicleEmpty) return '这场活动还没有车辆：请先在分车区添加车辆，再把车辆联络授权给车长。'
      if (this.data.vehicleIndex < 0 || !this.transportVehicleIds) return '请选择负责车辆。'
      return ''
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
      this.setData({ busy: true, busyAt: Date.now(), error: '' })
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
      this.setData({ busy: true, busyAt: Date.now(), error: '' })
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
      // 这是一条写命令，与同文件其它写点（onBatchConfirm/onExportConfirm/onRevokeConfirm/onAccessSave）
      // 同一套在途守卫：busy 与 busyAt 成对置位、then/catch 两路都复位。
      // 残留姿态的宽限期判据只有一个出处 J.busyStale —— 组件不写第二个 8000、不自己算时间差。
      if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {
        this.setData({ busy: false, busyAt: 0 })
        console.warn('[busy] 同行组约束：清掉一个超过宽限期没落地的写状态，本次操作照常放行')
      }
      if (this.data.busy) return
      const { id, keep } = e.currentTarget.dataset
      this.setData({ busy: true, busyAt: Date.now(), error: '' })
      api.dispatchAndSync({ type: 'group.setTogether', activityId: this.data.activityId, groupId: id, keepTogether: !keep }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, busyAt: 0 })
          api.toast('同行组约束已保存')
          this.loadTransport()
        })
        .catch(err => this.setData({ busy: false, busyAt: 0, error: api.errorText(err) }))
    },

    // ---- 协作授权 ----
    onAccessOpen() { this.setData({ accessOpen: true }, () => this.loadAccess()) },
    onAccessClose() { this.setData({ accessOpen: false }) },
    loadAccess() {
      const access = api.readOr('readAccess', { activityId: this.data.activityId }).then(result => {
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
        this.setData({ memberships, accessError: '' })
      }).catch(e => this.setData({ accessError: api.errorText(e) }))
      // 车辆候选是本弹层的**显式依赖**，与名单读取并发等齐。等的是那条唯一的 readTransport：
      // ensureTransport 复用正在飞的同一条，既不另发第二次读，也不再顺带取它写进 data 的值（C-20）。
      // 候选的装配点在那条读落地的地方（applyVehicles），所以「谁先落地谁先说话」不会印出错的东西；
      // 这里的等齐给出的是「弹层两项依赖都到位」的时刻。
      return Promise.all([access, this.ensureTransport()]).then(() => true)
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
        // 候选还没落地时（那条 readTransport 在飞）没有 id 可查：回显成「未选」，
        // 保存那条会被 vehicleBlockReason 挡下，绝不会把既有授权的 vehicleId 静默丢掉。
        vehicleIndex: m.vehicleId ? (this.transportVehicleIds || []).indexOf(m.vehicleId) : -1,
      })
    },
    // 撤销不可回退且影响的是第三方，按 me.js 的 onRemoveAsk/Cancel/Confirm 三步做（询问→确认→执行）。
    onRevokeAsk(e) {
      const id = e.currentTarget.dataset.id
      const m = (this.data.memberships || []).find(x => x.id === id)
      if (!m) return
      this.setData({ revokeId: id, revokeText: m.userId + '（' + m.roleLabel + ' · 截止 ' + m.expiresLabel + '）' })
    },
    onRevokeCancel() { this.setData({ revokeId: '', revokeText: '' }) },
    onRevokeConfirm() {
      const id = this.data.revokeId
      if (!id || this.data.busy) return
      this.setData({ busy: true, busyAt: Date.now(), error: '' })
      api.dispatchAndSync({ type: 'membership.revoke', activityId: this.data.activityId, membershipId: id }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, revokeId: '', revokeText: '' })
          api.toast('授权已撤销')
          this.loadAccess()
        })
        .catch(err => this.setData({ busy: false, error: api.errorText(err), revokeId: '', revokeText: '' }))
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
      if (this.data.busy) return
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
      if (role === 'vehicle_contact') {
        const blocked = this.vehicleBlockReason()
        if (blocked) {
          this.setData({ error: blocked })
          return
        }
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
      // busy 只能在校验全过之后置：校验失败要先 return，否则一次填错就把按钮锁成「看着能点、点了没反应」。
      this.setData({ busy: true, busyAt: Date.now(), error: '' })
      api.dispatchAndSync({ type: 'membership.save', activityId: this.data.activityId, membership }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, editingId: membershipId, message: '授权已保存。' })
          api.toast('授权已保存')
          this.loadAccess()
        })
        .catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },
  },
})
