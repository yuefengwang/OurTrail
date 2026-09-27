// 现场面板（原型 screens/Field.tsx）：签到/出发核实/节点/到家/返程/异常/位置。
// 组织者工作台与协作任务页共用；perspective 决定读取视角。
'use strict'
const api = require('../../utils/api')
const F = require('../../utils/format')

const DEP_TONES = { unknown: 'warning', joined: 'success', not_departed: 'success', coordinating: 'warning' }

Component({
  properties: {
    activityId: { type: String, value: '' },
    perspective: { type: String, value: 'organizer' },
  },
  data: {
    loading: true,
    denied: '',
    phase: '',
    headline: '',
    pendingHome: 0,
    openIncidents: 0,
    search: '',
    unresolvedOnly: false,
    rows: [],
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
    busy: false,
  },

  observers: {
    'activityId, perspective': function () {
      this.reload()
    },
  },

  lifetimes: {
    attached() { this.reload() },
  },

  methods: {
    reload() {
      const activityId = this.data.activityId
      if (!activityId) return
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
        const rows = v.rows
          .filter(r => r.status === 'confirmed')
          .filter(r => !this.data.search || r.name.indexOf(this.data.search) !== -1)
          .filter(r => !this.data.unresolvedOnly || r.departure === 'unknown' || r.departure === 'coordinating' || (r.departure === 'joined' && !r.home))
          .map(r => ({
            signupId: r.signupId,
            name: r.name,
            subtitle: r.pickup + ' · ' + (r.checkedIn ? '已签到' : '未签到') + ' · ' + (r.vehicle || '无乘车安排'),
            status: r.home ? '已到家' : F.DEPARTURE_LABELS[r.departure] || '出发待核实',
            tone: r.home || r.departure === 'not_departed' ? 'success' : 'warning',
          }))
        const positions = (v.positions || []).map(p => ({
          signupId: p.signupId,
          name: p.name,
          coords: p.coordinates.lat + ', ' + p.coordinates.lng,
          time: F.hhmm(p.reportedAt),
          stale: p.stale,
        }))
        this.setData({
          loading: false,
          denied: '',
          phase,
          headline: phase === 'closing' ? '逐人核实，安心收尾' : '现场事实，逐项确认',
          pendingHome: v.counters.pendingHome,
          openIncidents: v.counters.openIncidents,
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
        })
      }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
    },

    onSearch(e) { this.setData({ search: e.detail.value }, () => this.reload()) },
    onUnresolvedOnly(e) { this.setData({ unresolvedOnly: e.detail.value }, () => this.reload()) },

    openSheet(e) {
      const id = e.currentTarget.dataset.id
      const row = this.view.rows.find(r => r.signupId === id)
      if (!row) return
      const phase = this.data.phase
      const permitted = this.view.permittedActions
      const acts = []
      const lateArrival = phase === 'active' && row.departure === 'coordinating'
      if (phase === 'gathering' || lateArrival) {
        if (!row.checkedIn && permitted.indexOf('attendance.checkin') !== -1) {
          acts.push({ label: '确认现场签到', type: 'attendance.checkin', needNote: true })
        }
        if (permitted.indexOf('attendance.departure') !== -1) {
          acts.push({ label: '核实已随队出发', type: 'attendance.departure', outcome: 'joined' })
          acts.push({ label: '核实未出发', type: 'attendance.departure', outcome: 'not_departed', needNote: true })
          acts.push({ label: '标记迟到协调', type: 'attendance.departure', outcome: 'coordinating', needNote: true })
        }
      }
      if (phase === 'closing' && row.departure === 'joined' && !row.home && permitted.indexOf('attendance.home') !== -1) {
        acts.push({ label: '核实安全到家', type: 'attendance.home', needNote: true })
      }
      if (['active', 'closing'].indexOf(phase) !== -1 && row.departure === 'joined' && permitted.indexOf('attendance.returnPlan') !== -1) {
        acts.push({
          label: row.returnPlan === 'independent' ? '改回原车返程' : '记录另行返程',
          type: 'attendance.returnPlan',
          plan: row.returnPlan === 'independent' ? 'assigned' : 'independent',
          needNote: true,
        })
      }
      if (['gathering', 'active', 'closing'].indexOf(phase) !== -1 && permitted.indexOf('incident.report') !== -1) {
        acts.push({ label: '记录下撤报备', type: 'incident.report', kind: 'withdrawal', needNote: true })
        acts.push({ label: '记录其他异常', type: 'incident.report', kind: 'other', needNote: true })
      }
      const nodeEnabled = phase === 'active' && row.departure === 'joined' && permitted.indexOf('attendance.node') !== -1
      if (nodeEnabled) acts.push({ label: '确认到达此节点', type: 'attendance.node', needNote: true, needPoint: true })
      this.setData({
        sheetOpen: true,
        sel: { signupId: row.signupId, name: row.name },
        actions: acts,
        note: '',
        pointIndex: -1,
        pointEnabled: nodeEnabled,
        error: '',
        message: '',
      })
    },
    closeSheet() { this.setData({ sheetOpen: false }) },

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
      this.setData({ busy: true, error: '', message: '' })
      api.dispatch(payload, this.revision)
        .then(res => {
          this.revision = res.revision
          this.setData({ busy: false, message: act.label + '已保存。' })
          api.toast('已保存')
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
      api.dispatch({ type: 'incident.resolve', activityId: this.data.activityId, incidentId: id, note }, this.revision)
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
