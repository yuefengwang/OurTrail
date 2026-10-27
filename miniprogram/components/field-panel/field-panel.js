// 现场面板（原型 screens/Field.tsx）：签到/出发核实/节点/到家/返程/异常/位置。
// 组织者工作台与协作任务页共用；perspective 决定读取视角。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')
const J = require('../../utils/journey')

const DEP_TONES = { unknown: 'warning', joined: 'success', not_departed: 'success', coordinating: 'warning' }

// 现场名单为空有三种互不相干的成因（没有人 / 搜索不匹配 / 勾了「只看待核实」而待核实已清完），
// 以前共用同一句「当前范围没有符合条件的人员。」——领队会把「筛选太窄」读成「本场没人」。
// 每张卡都按「这一刻该做什么」写：成因 + 出路（对齐 roster-panel 的 status-panel 写法）。
// 措辞对两个宿主都成立：workspace 是组织者的工作台，staff 页只给被授权的人看，
// 所以这里不写「去名单区审核」这类只有组织者做得到的指令。
// 按钮上那句话必须和 onClearFilters 真的撤掉的条件一致，所以名字由「此刻哪些条件在起作用」算出来。
function emptyCardOf(confirmedCount, namedCount, search, unresolvedOnly) {
  const clearLabel = search && unresolvedOnly ? '清空搜索与勾选'
    : search ? '清空搜索条件' : unresolvedOnly ? '取消勾选' : ''
  if (confirmedCount) {
    if (!namedCount) {
      return {
        emptyTitle: '没有匹配「' + search + '」的人',
        emptyDetail: '现场名单里对不上这个姓名；试试只输入姓氏，或清空条件看全部人员。',
        emptyAction: clearLabel,
      }
    }
    return {
      emptyTitle: '待核实的都已经核完了',
      emptyDetail: '这一区现在没有待办：每个人的出发去向都已给出结论。取消勾选可以看全部人员。',
      emptyAction: clearLabel,
    }
  }
  return {
    emptyTitle: '这一场暂时没有在场人员',
    emptyDetail: '这里只列已经确认的参与人；他们出现在名单后，现场要核实的项就会排在这里。',
    emptyAction: '',
  }
}

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    activityId: { type: String, value: '' },
    perspective: { type: String, value: 'organizer' },
    // 宿主页面每次读到的「phase@revision」：后端状态一变就换，面板据此判断自己是不是读旧了。
    // 保留面板常驻（切区不丢搜索词/勾选/表单），又不让它拿旧 phase 装配动作表。
    syncKey: { type: String, value: '' },
    // 宿主页面自己已经有「指标即入口」那一区（workspace 有，staff 页没有）。
    // 同一个计数在同一屏印两遍、一种字号可点一种不可点，用户会去比较哪一份是旧的（A-17）：
    // 计数归页面时面板就不再印「待到家」，归面板时（staff）它照旧印——这不是删行而是划界。
    pageMetrics: { type: Boolean, value: false },
  },
  data: {
    loading: true,
    denied: '',
    phase: '',
    headline: '',
    pendingHome: 0,
    openIncidents: 0,
    // 由 reload() 按宿主与阶段算出：宿主头顶那一格此刻就是「待到家」时它变 false（A-17）。
    showHomeCount: true,
    search: '',
    unresolvedOnly: false,
    rows: [],
    emptyTitle: '',
    emptyDetail: '',
    emptyAction: '',
    incidents: [],
    positions: [],
    points: [],
    // 弹层
    sheetOpen: false,
    sel: null,
    actions: [],
    note: '',
    pointIndex: -1,
    pointLabels: [],
    error: '',
    message: '',
    sheetHint: '',
    busy: false,
    busyAt: 0,
  },

  observers: {
    'activityId, perspective': function () {
      this.reload()
    },
    syncKey: function (key) {
      if (key && key !== this._readKey) this.reload()
    },
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
      // 没有活动编号时以前直接 return：面板停在 loading 骨架上，永远转圈也不说为什么。
      if (!activityId) { this.setData({ loading: false, denied: '这条协作入口没有带上活动，请向领队重新要一次链接。' }); return }
      if (this._loading) return
      this._loading = true
      return api.read({ kind: 'activity', activityId, perspective: this.data.perspective }).then(res => {
        if (res.view.kind !== 'activity') {
          this.setData({ loading: false, denied: res.view.kind === 'denied' ? res.view.message : '当前任务不可用' })
          return
        }
        this.revision = res.revision
        this.now = res.now
        this.view = res.view
        const v = res.view
        const phase = v.activity.phase
        // 三个过滤器串成一排，任一环把人清空都得说得清是哪一环（C-18）：
        // 逐级留下人数，空态文案才能指到真正的成因，而不是给三种情况共用一句话。
        const confirmedRows = v.rows.filter(r => r.status === 'confirmed')
        const namedRows = confirmedRows.filter(r => !this.data.search || r.name.indexOf(this.data.search) !== -1)
        const rows = namedRows
          .filter(r => !this.data.unresolvedOnly || r.departure === 'unknown' || r.departure === 'coordinating' || (r.departure === 'joined' && !r.home))
          .map(r => ({
            signupId: r.signupId,
            name: r.name,
            avatar: r.avatar || '',
            // 现场清点看的是「人到位了没」，不是「排到车了没」：自行前往的人没有乘车安排
            // 也不是异常，所以车辆/上车点信息只在需要乘车时才出现在副标题里。
            subtitle: [
              F.TRIP_MODE_LABELS[r.tripMode] || r.tripMode,
              r.tripMode === 'shared' ? (r.pickup || F.PICKUP_MISSING) : '',
              r.checkedIn ? '已签到' : '未签到',
              r.tripMode === 'shared' ? (r.vehicle || '待安排车辆') : '',
              r.tripMode === 'shared' && r.outboundBoarded ? '已上车' : '',
            ].filter(Boolean).join(' · '),
            status: r.home ? '已到家' : (F.DEPARTURE_LABELS[r.departure] || F.DEPARTURE_LABELS.unknown),
            tone: r.home || r.departure === 'not_departed' ? 'success' : 'warning',
          }))
        const positions = (v.positions || []).map(p => ({
          signupId: p.signupId,
          name: p.name,
          coords: p.coordinates.lat + ', ' + p.coordinates.lng,
          time: F.hhmm(p.reportedAt),
          stale: p.stale,
        }))
        this._loading = false
        this._readKey = phase + '@' + res.revision
        this.setData(Object.assign({
          loading: false,
          denied: '',
          phase,
          // 上报点只在行程进行中才有意义；「进行中」这个判断留在 JS，模板不认服务端枚举原文。
          showPositions: phase === 'active',
          headline: phase === 'closing' ? '逐人核实，安心收尾' : '现场事实，逐项确认',
          pendingHome: v.counters.pendingHome,
          openIncidents: v.counters.openIncidents,
          // 计数归谁看（A-17）：宿主头顶那一格此刻印的就是同一个「待到家」时，面板不再印第二遍
          // （同屏两份同名计数、一种可点一种不可点，用户会去比较哪一份是旧的）。
          // 哪一个计数占第三格由 journey.fieldMetric 单源给出：published/gathering 那一格是「待签到」，
          // 这时面板这一行是全场唯一的待到家读数，必须照旧出；staff 页根本没有指标区，也照旧出。
          showHomeCount: !(this.data.pageMetrics && J.fieldMetric(phase).key === 'pendingHome'),
          rows,
          incidents: (v.incidents || []).map(i => ({
            id: i.id,
            description: i.description,
            resolved: i.resolved,
            subjectNames: (i.subjectIds || []).map(id => {
              const r = v.rows.find(x => x.signupId === id)
              return r ? r.name : ''
            }).filter(Boolean).join('、'),
          })),
          positions,
          pointLabels: v.activity.routeSnapshot.points.map(p => p.name),
          points: v.activity.routeSnapshot.points,
        }, rows.length ? { emptyTitle: '', emptyDetail: '', emptyAction: '' }
          : emptyCardOf(confirmedRows.length, namedRows.length, this.data.search, this.data.unresolvedOnly)))
        // 名单一变，还开着的弹层必须跟着重算动作表：写成功之后服务端已经不接受的那颗按钮
        // 不该继续留在屏上等人点（点了只换来一句 WRONG_PHASE 红字）。
        this.refreshSheet()
      }).catch(e => { this._loading = false; this.setData({ loading: false, denied: api.errorText(e) }) })
    },

    onSearch(e) { this.setData({ search: e.detail.value }, () => this.reload()) },
    onUnresolvedOnly(e) { this.setData({ unresolvedOnly: e.detail.value.length > 0 }, () => this.reload()) },

    openSheet(e) {
      const id = e.currentTarget.dataset.id
      const row = this.view && this.view.rows.find(r => r.signupId === id)
      if (!row) return
      const built = this.sheetActions(row)
      this.setData({
        sheetHint: built.sheetHint,
        sheetOpen: true,
        sel: { signupId: row.signupId, name: row.name },
        actions: built.actions,
        note: '',
        pointIndex: -1,
        pointEnabled: built.pointEnabled,
        error: '',
        message: '',
      })
    },

    // 动作表 = 这一行此刻的事实 × 服务端这一刻允许的命令集。它不是「开弹层时的一次性快照」：
    // 每一次重读（包括本面板自己写成功后的那次）都要按这里重算一次，否则留在屏上的就是
    // 服务端已经不接受的按钮，点下去只换来一句 WRONG_PHASE 红字（C-10）。
    sheetActions(row) {
      const permitted = this.view.permittedActions
      const acts = []
      // 「这一刻这道命令存不存在」只由服务端投影回答（permittedActions 用了 field.js 的具名门），
      // 客户端不再自带一份 phase/lateArrival 判断——那份重复规则每改一次域内就会漂一次。
      if (permitted.indexOf('attendance.checkin') !== -1 && !row.checkedIn) {
        acts.push({ label: '确认现场签到', type: 'attendance.checkin', needNote: true })
      }
      if (permitted.indexOf('attendance.departure') !== -1) {
        // 按钮只在该行真的能成立时才给：服务端 joined 门（field.js）要「已签到 +（拼车乘客）去程已上车」，
        // 缺事实时点下去只会换来一句红字，而正确入口在车长任务页（attendance.board）。
        if (row.checkedIn && !row.needsOutboundBoarding) acts.push({ label: '核实已随队出发', type: 'attendance.departure', outcome: 'joined' })
        if (!row.outboundBoarded) {
          acts.push({ label: '核实未出发', type: 'attendance.departure', outcome: 'not_departed', needNote: true })
          acts.push({ label: '标记迟到协调', type: 'attendance.departure', outcome: 'coordinating', needNote: true })
        }
      }
      if (row.departure === 'joined' && !row.home && permitted.indexOf('attendance.home') !== -1) {
        acts.push({ label: '核实安全到家', type: 'attendance.home', needNote: true })
      }
      // permittedActions 是活动级的能力集合，「这行能不能做这件事」还要看该行的出行方式：
      // 返程安排只对需要乘车的人成立（服务端 field.js 同样按 trip.mode 拒 self）。
      if (row.departure === 'joined' && row.tripMode === 'shared' && permitted.indexOf('attendance.returnPlan') !== -1) {
        acts.push({
          label: row.returnPlan === 'independent' ? '改回原车返程' : '记录另行返程',
          type: 'attendance.returnPlan',
          plan: row.returnPlan === 'independent' ? 'assigned' : 'independent',
          needNote: true,
        })
      }
      if (permitted.indexOf('incident.report') !== -1) {
        acts.push({ label: '记录下撤报备', type: 'incident.report', kind: 'withdrawal', needNote: true })
        acts.push({ label: '记录其他异常', type: 'incident.report', kind: 'other', needNote: true })
      }
      const nodeEnabled = row.departure === 'joined' && permitted.indexOf('attendance.node') !== -1
      if (nodeEnabled) acts.push({ label: '确认到达此节点', type: 'attendance.node', needNote: true, needPoint: true })
      // 一屏一个主动作：第一条就是「此刻最该做的那一步」，其余降为次要，避免六个同权重按钮排成一列。
      acts.forEach((a, i) => { a.primary = i === 0 })
      // 少了「核实已随队出发」时必须说清缺哪一步、去哪儿补，否则组织者只会对着空动作表猜。
      const canVerifyDeparture = permitted.indexOf('attendance.departure') !== -1
      let sheetHint = ''
      if (canVerifyDeparture && acts.every(a => a.type !== 'attendance.departure' || a.outcome === 'not_departed' || a.outcome === 'coordinating')) {
        sheetHint = !row.checkedIn ? '请先完成现场签到，再核实是否随队出发。'
          : (row.needsOutboundBoarding ? '此人需要乘车随队：请先在车长任务页点「确认上车」，回来才能核实已随队出发。' : '')
      }
      if (!acts.length) sheetHint = sheetHint || '这位参与人当前没有需要补的现场事实；如果情况有变，请报备异常。'
      return { actions: acts, sheetHint, pointEnabled: nodeEnabled }
    },

    // 弹层常驻（连点效率高），所以它的内容必须随每一次重读走：动作表重算，人出局了就说明白。
    refreshSheet() {
      if (!this.data.sheetOpen || !this.data.sel || !this.view) return
      const row = this.view.rows.find(r => r.signupId === this.data.sel.signupId && r.status === 'confirmed')
      if (!row) {
        // 报名状态或协作授权变了 ⇒ 这个人不再属于这一屏。留一排点了必被拒的按钮，
        // 比收掉它们更糟；但也不能什么都不说，所以点名说「已经不在当前范围内」。
        this.setData({
          actions: [],
          pointEnabled: false,
          sheetHint: '这位参与人已不在现场名单的当前范围内（报名状态或授权有变），这里没有可执行的现场动作。',
        })
        return
      }
      const built = this.sheetActions(row)
      this.setData({ actions: built.actions, pointEnabled: built.pointEnabled, sheetHint: built.sheetHint })
    },

    closeSheet() { this.setData({ sheetOpen: false }) },

    // 空态卡上的「下一步」是真的下一步：把此刻在起作用的条件撤掉，人就会重新出现（C-18）。
    // 两个条件都没起作用时不重读：那句话本来就轮不到出现，点了不该多打一次全量读。
    onClearFilters() {
      if (!this.data.search && !this.data.unresolvedOnly) return
      this.setData({ search: '', unresolvedOnly: false }, () => this.reload())
    },

    onNote(e) { this.setData({ note: e.detail.value }) },
    onPoint(e) { this.setData({ pointIndex: Number(e.detail.value) }) },

    onAction(e) {
      const index = Number(e.currentTarget.dataset.index)
      const act = this.data.actions[index]
      if (!act || this.data.busy) return
      if (act.needNote && !this.data.note.trim()) {
        this.setData({ error: '请先在上方填写逐人核实的依据。' })
        return
      }
      const base = { activityId: this.data.activityId, signupId: this.data.sel.signupId }
      let payload = null
      if (act.type === 'attendance.checkin') {
        payload = Object.assign(base, { type: act.type, checkIn: { method: 'manual', evidence: { at: '', by: '', note: this.data.note } } })
      } else if (act.type === 'attendance.departure') {
        payload = Object.assign(base, { type: act.type, outcome: { kind: act.outcome, evidence: { at: '', by: '', note: this.data.note } } })
      } else if (act.type === 'attendance.home') {
        payload = Object.assign(base, { type: act.type, note: this.data.note })
      } else if (act.type === 'attendance.returnPlan') {
        payload = Object.assign(base, { type: act.type, plan: act.plan, note: this.data.note })
      } else if (act.type === 'attendance.node') {
        if (this.data.pointIndex < 0) {
          this.setData({ error: '请选择到达的路线节点。' })
          return
        }
        payload = Object.assign(base, { type: act.type, pointId: this.data.points[this.data.pointIndex].id, note: this.data.note })
      } else if (act.type === 'incident.report') {
        payload = { type: act.type, activityId: this.data.activityId, signupIds: [this.data.sel.signupId], kind: act.kind, description: this.data.note }
      }
      if (!payload) return
      this.setData({ busy: true, busyAt: Date.now(), error: '', message: '' })
      api.dispatchAndSync(payload, this.revision, this)
        .then(res => {
          this.revision = res.revision
          // 依据文字的生命周期绑在**单条命令**上，不绑在弹层开关上：这一段是这一条核实的法定证据，
          // 留在框里就会被下一颗按钮原样当作新命令的 evidence.note 提交（异常记录里写着上一条签到的话）。
          // 失败时不清：那时输入还是有用的，用户要按红字改一改再发。
          this.setData({ busy: false, note: '', message: act.label + '已保存。' })
          api.toast('已保存')
          // reload 之后 refreshSheet 会按新事实重算动作表（服务端此刻已不接受的按钮不能再留在屏上）。
          return this.reload()
        })
        .catch(err => this.setData({ busy: false, error: api.errorText(err) }))
    },

    onResolve(e) {
      const id = e.currentTarget.dataset.id
      const note = ((this.data.resolveNotes || {})[id]) || ''
      if (!note.trim()) {
        this.setData({ error: '请填写核实与处理结果。' })
        return
      }
      api.dispatchAndSync({ type: 'incident.resolve', activityId: this.data.activityId, incidentId: id, note }, this.revision, this)
        .then(res => {
          this.revision = res.revision
          api.toast('已确认解决')
          return this.reload()
        })
        .catch(err => this.setData({ error: api.errorText(err) }))
    },
    onResolveNote(e) {
      const id = e.currentTarget.dataset.id
      const notes = Object.assign({}, this.data.resolveNotes)
      notes[id] = e.detail.value
      this.setData({ resolveNotes: notes })
    },
  },
})
