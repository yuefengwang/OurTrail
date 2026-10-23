// 活动编辑器（新建 / 编辑 / 从我组织的活动复制）。对应原型 screens/ActivityEditor.tsx。
// datetime-local 用「日期 picker + 时间 picker」组合；草稿落本地存储。
'use strict'
const api = require('../../utils/api')
const draft = require('../../utils/draft')
const F = require('../../utils/format')
const J = require('../../utils/journey')
const gpx = require('../../utils/gpx')
const RS = require('../../utils/route-schedule')

const emptyInput = () => ({
  title: '', description: '', organizerIntro: '',
  startAt: null, endAt: null, deadlineAt: null,
  acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: null,
  routeSnapshot: { title: '', distanceKm: 0, ascentM: 0, difficulty: '', points: [], risks: [] },
  pickupPoints: [], equipment: [], equipmentSuggested: [], feeNote: '', cancellationNote: '',
  content: [], coverFileId: '', highlights: [], leader: '', minParticipants: null,
  sceneryRating: null, funRating: null, feeSummary: '', feeIncludes: [], feeExcludes: [], signupNote: '',
})

// 把 ActivityInput 摊平成便于 WXML 绑定的形状（dt_*: {date,time} / equipmentText）
function toForm(input) {
  const split = iso => {
    if (!iso) return { date: '', time: '' }
    const p = F.cnParts(iso)
    return { date: p.date, time: p.time }
  }
  return {
    title: input.title,
    description: input.description,
    organizerIntro: input.organizerIntro,
    capacity: String(input.capacity),
    approvalMode: input.approvalMode,
    acceptingSignups: input.acceptingSignups,
    routeTitle: input.routeSnapshot.title,
    distanceKm: input.routeSnapshot.distanceKm === 0 ? '' : String(input.routeSnapshot.distanceKm),
    ascentM: input.routeSnapshot.ascentM === 0 ? '' : String(input.routeSnapshot.ascentM),
    difficulty: input.routeSnapshot.difficulty || '',
    // time/ele 是 GPX 附带的元数据，用户不可编辑：必须原样带进表单，否则编辑一次草稿就丢了
    points: input.routeSnapshot.points.map(p => ({
      id: p.id, name: p.name, kind: p.kind,
      lat: p.coordinates ? String(p.coordinates.lat) : '',
      lng: p.coordinates ? String(p.coordinates.lng) : '',
      time: p.time || '',
      ele: Number.isFinite(p.ele) ? p.ele : null,
    })),
    risks: input.routeSnapshot.risks.map(r => riskForm(r)),
    track: (input.routeSnapshot.track || []).slice(),
    pickups: input.pickupPoints.map(p => ({ id: p.id, name: p.name, address: p.address, lat: p.coordinates ? String(p.coordinates.lat) : '', lng: p.coordinates ? String(p.coordinates.lng) : '', meeting: split(p.meetingAt) })),
    equipmentText: input.equipment.join('\n'),
    equipmentSuggestedText: (input.equipmentSuggested || []).join('\n'),
    feeNote: input.feeNote,
    cancellationNote: input.cancellationNote,
    content: JSON.parse(JSON.stringify(input.content || [])),
    coverFileId: input.coverFileId || '',
    highlightsText: (input.highlights || []).join('\n'),
    leader: input.leader || '',
    minParticipants: input.minParticipants == null ? '' : String(input.minParticipants),
    sceneryRating: input.sceneryRating || 0,
    funRating: input.funRating || 0,
    feeSummary: input.feeSummary || '',
    feeIncludesText: (input.feeIncludes || []).join('\n'),
    feeExcludesText: (input.feeExcludes || []).join('\n'),
    signupNote: input.signupNote || '',
    dt_start: split(input.startAt),
    dt_end: split(input.endAt),
    dt_deadline: split(input.deadlineAt),
  }
}

function composeDateTime(date, time) {
  if (!date || !time) return null
  return date + 'T' + time + ':00+08:00'
}

// 风险表单行：severity/coordinates 是路线库的可选字段，本表单不编辑它们，
// 但必须原样往返——gathering/active 的阶段锁按 id 逐字节比对，丢一个键
// 就把一次合法编辑误判成越阶段修改（与 points 的 time/ele 同口径）。
function riskForm(r) {
  return Object.assign({ id: r.id, title: r.title, advice: r.advice },
    r.severity ? { severity: r.severity } : {},
    r.coordinates ? { coordinates: { lat: r.coordinates.lat, lng: r.coordinates.lng } } : {})
}

function coordsOrNull(lat, lng) {
  if (lat.trim() === '' && lng.trim() === '') return null
  const la = Number(lat)
  const ln = Number(lng)
  const valid = Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
  return valid ? { lat: la, lng: ln } : null
}

function lineList(text) {
  return String(text || '').split('\n').map(s => s.trim()).filter(Boolean)
}

// ---- 时间快捷估算：以出发时刻为锚（中国无夏令时，固定 +08:00 安全）----
// 平移 N 天/加 N 小时后返回北京墙上时间的 {date, time}
function shiftDateTime(dateStr, timeStr, days, addHours) {
  const base = Date.parse(dateStr + 'T' + timeStr + ':00+08:00') + (days || 0) * 86400000 + (addHours || 0) * 3600000
  if (!Number.isFinite(base)) return null
  const iso = new Date(base + 8 * 3600000).toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) }
}
// 当天往返：出发后 8 小时；跨到次日则兜底出发当天 23:30
function quickSameDayEnd(start) {
  const shifted = shiftDateTime(start.date, start.time, 0, 8)
  if (!shifted || shifted.date !== start.date) return { date: start.date, time: '23:30' }
  return shifted
}

function pad2(n) { return n < 10 ? '0' + n : '' + n }
// 常用出发时间建议：本周/下个周六、周日 08:00（北京时间）。只是可点选的建议，
// 不是默认事实；用户点一下才写入表单。
function nextWeekdayAt(nowMs, weekday, hour, minute) {
  const bj = new Date(nowMs + 8 * 3600000)
  const currentMinutes = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  let delta = (weekday - bj.getUTCDay() + 7) % 7
  if (delta === 0 && currentMinutes >= hour * 60 + minute) delta = 7
  const target = new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate() + delta))
  return { date: target.toISOString().slice(0, 10), time: pad2(hour) + ':' + pad2(minute) }
}
function startSuggestionsFor(nowMs) {
  return [
    { key: 'sat', label: '周六 08:00', at: nextWeekdayAt(nowMs, 6, 8, 0) },
    { key: 'sun', label: '周日 08:00', at: nextWeekdayAt(nowMs, 0, 8, 0) },
  ]
}
function routeAutoTextOf(form) {
  const bits = []
  if (form.routeTitle) bits.push('「' + form.routeTitle + '」')
  if (Number(form.distanceKm) > 0) bits.push(Number(form.distanceKm) + ' km')
  if (Number(form.ascentM) > 0) bits.push('爬升 ' + form.ascentM + ' m')
  if (form.points.length) bits.push(form.points.length + ' 个节点')
  if (form.risks.length) bits.push(form.risks.length + ' 条风险')
  return bits.join(' · ')
}
// 节点日程只做推算预览（EDI-02 A）：时间来自轨迹元数据，页面不提供手工计划编辑。
// 与天气页共用 route-schedule，避免同一份「第几天几点到」出现第二套算法。
function scheduleRowsOf(form) {
  const rows = RS.schedule(
    (form.points || []).map(p => ({ id: p.id, time: p.time })),
    composeDateTime(form.dt_start.date, form.dt_start.time)
  )
  return rows.map((row, i) => {
    const point = form.points[i] || {}
    return {
      id: row.id || ('point-' + i),
      name: point.name || ('节点 ' + (i + 1)),
      indexText: String(i + 1).padStart(2, '0'),
      known: !!row.known,
      dayIndex: row.dayIndex,
      label: RS.nodeLabel(row),
    }
  })
}
function routeDerivedOf(form) {
  const scheduleRows = scheduleRowsOf(form)
  return {
    routeAutoText: routeAutoTextOf(form),
    scheduleRows,
    scheduleBasis: RS.basisText(scheduleRows, !!(form.dt_start.date && form.dt_start.time)),
    scheduleSpanDays: RS.spanDays(scheduleRows),
  }
}
function routePointsToForm(points) {
  return (points || []).map(p => ({
    id: p.id || freshId('point'),
    name: p.name || '',
    kind: p.kind || 'checkpoint',
    lat: p.coordinates ? String(p.coordinates.lat) : '',
    lng: p.coordinates ? String(p.coordinates.lng) : '',
    time: p.time || '',
    ele: Number.isFinite(p.ele) ? p.ele : null,
  }))
}
function routeRisksToForm(risks) {
  return (risks || []).map(r => riskForm(r))
}

const freshId = kind => kind + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
Page({
  data: {
    loading: true,
    denied: '',
    isNew: true,
    savedId: '',
    phase: 'draft',
    // 模板只做「这个按钮在不在」的判断，不认服务端枚举原文（阶段枚举只在 JS 里出现一次）。
    isDraft: true,
    saveLabel: '保存草稿',
    step: 0,
    stepLabels: ['01 信息', '02 路线', '03 介绍', '04 发布'],
    // 步骤指示完成态（纯展示派生，T007）：与发布门同读一份 missing，见 checklistPatch
    stepDone: [false, false, false, false],
    ratingOptions: [1, 2, 3, 4, 5],
    difficultyOptions: F.DIFFICULTY_OPTIONS,
    form: toForm(emptyInput()),
    // 自动填充只发生在字段为空时；用户一改标题就清掉来源提示（不覆盖人的输入）。
    titleAutoSource: '',
    routeAutoText: '',
    // 节点日程是只读派生（EDI-02 A）：轨迹时间差 + 出发时刻，不落库、不手工编辑。
    scheduleRows: [],
    scheduleBasis: '',
    scheduleSpanDays: null,
    // 装备录入草稿（只是输入框里的字，不入表单/草稿；清单本身就存在 equipmentText）
    equipmentDraft: '',
    equipmentSuggestedDraft: '',
    startSuggestions: [],
    // 路线详情/活动说明/风险默认收合：快速创建路径不需要先看完整表单。
    routeDetailsOpen: false,
    detailExtrasOpen: false,
    risksOpen: false,
    // 路线选择（从路线库快速带入）
    quickRouteOpen: false,
    quickRouteLoading: false,
    quickRouteError: '',
    quickRoutes: [],
    quickRouteTotal: 0,
    quickRouteMatched: 0,
    quickRouteShown: 0,
    quickRouteQuery: '',
    quickRouteBusyId: '',
    routeReplaceOpen: false,
    pendingRouteTitle: '',
    // 发布就绪：必填一清空就更新，底栏可在任意步骤直接发布。
    publishReady: false,
    requiredMissingText: '',
    publishSummaryText: '',
    canChangeRoute: true,
    contentBusy: false,
    contentFilled: false,
    contentResetKey: 0,
    // 复制
    myActivities: [],
    templateCopyOpen: false,
    templateId: '',
    templateIndex: -1,
    // 路线库预填（V2.0）：从路线库发起活动时带入的路线名（空 = 非路线预填入口）
    fromRouteTitle: '',
    // 发布
    publishOpen: false,
    // 可后补清单（2026-10-14 快速创建）：发布确认层逐项点名，不拦路
    deferred: [],
    deferredText: '',
    deleteDraftOpen: false,
    participate: false,
    dataUse: false,
    tripSelf: true,
    tripModes: F.TRIP_MODE_OPTIONS,
    tripPickupIndex: -1,
    // 反馈
    failure: '',
    profileGate: false,
    profileGateOpen: false,
    message: '',
    busy: false,
    busyAt: 0,
    // GPX 导入
    gpxOpen: false,
    gpxError: '',
    gpxMeta: null,
    gpxPoints: [],
    gpxTrack: [],
    gpxSuggest: null,
    // 渐进披露：节点/上车点默认收合，坐标默认隐藏
    expandedPoints: {},
    showPointCoords: {},
    editingPickups: {},
    showPickupCoords: {},
    expandedTimes: {},
    expandedIntro: false,
    editingRisks: {},
    editingExtras: false,
    draftSavedAt: '',
  },

  onLoad(options) {
    this.activityId = options.id || ''
    this.savedId = this.activityId
    // 从路线库发起活动：路线只负责预填（名称/节点/风险/轨迹），
    // 时间、名额、集合上车点仍由发起人在这里补（V2.0 §5.7 的分工）。
    this.fromRouteId = options.routeId || ''
    this.titleTouched = false
    this._autoPickupIds = {}
    this.setData({ startSuggestions: startSuggestionsFor(Date.now()) })
    this.reload()
  },

  // 路线预填的草稿与空白新建的分开存：否则上一次空白新建的旧草稿
  // 会在 reload 里盖掉用户刚选的路线（draft 优先于路线种子）。
  draftKey() {
    return this.fromRouteId ? 'route-' + this.fromRouteId : (this.activityId || 'new')
  },

  reload() {
    const draftKey = this.draftKey()
    const saved = draft.getDraft(draftKey, 'activity-editor')
    const reads = this.activityId
      ? api.read({ kind: 'activity', activityId: this.activityId, perspective: 'organizer' })
      : Promise.resolve({ view: { kind: 'denied' } })
    // 路线预填读与活动读并行；路线读失败不阻塞编辑器（降级空白新建，由 banner 缺位体现）
    const routeRead = (this.fromRouteId && !this.activityId)
      ? api.readRoutes(this.fromRouteId).catch(() => null)
      : Promise.resolve(null)
    return Promise.all([reads, routeRead]).then(([res, routeRes]) => {
      let initial = null
      let phase = 'draft'
      let denied = ''
      if (this.activityId) {
        if (res.view.kind === 'denied') {
          denied = res.view.message
        } else if (res.view.kind === 'activity') {
          if (res.view.permittedActions.indexOf('activity.edit') === -1) {
            denied = '已结束或已取消的活动不能修改。可以从新建活动中复制自己的模板。'
          } else {
            const a = JSON.parse(JSON.stringify(res.view.activity))
            delete a.id
            delete a.ownerId
            delete a.phase
            initial = a
            phase = res.view.activity.phase
            this.routeId = res.view.activity.routeId || null
            // BUG-C1：表单与 revision 必须成对抓取——这条读就是表单的来源。
            // 只靠写成功后回填会让每个会话的第一条命令 expectedRevision=undefined，
            // 被 index.js 缺省成服务端当前值 ⇒ 两层 CAS 同时放弃 ⇒ 陈旧表单静默覆盖他人写入。
            this.revision = res.revision
          }
        }
      }
      // 路线种子：只在新活动态注入（编辑态活动自带快照，路线参数无意义）。
      // revision 取这次路线读的值——新建态没有别的读可作 CAS 基线（与 loadMyActivities 同口径）。
      let fromRouteTitle = ''
      let seedTitle = ''
      if (routeRes && routeRes.route && !this.activityId && !denied) {
        const r = routeRes.route
        fromRouteTitle = r.title || ''
        seedTitle = r.title || ''
        this.routeId = r.id
        if (Number.isInteger(routeRes.revision)) this.revision = routeRes.revision
        initial = {
          // 标题直接按路线名预填：这是可修改的自动填写，不是替用户拍板。
          title: r.title || '', description: '', organizerIntro: '',
          startAt: null, endAt: null, deadlineAt: null,
          acceptingSignups: true, capacity: 24, approvalMode: 'manual', routeId: r.id,
          routeSnapshot: {
            title: r.title, distanceKm: r.distanceKm, ascentM: r.ascentM, difficulty: r.difficulty || '',
            points: r.points || [], risks: r.risks || [], track: r.track,
          },
          pickupPoints: [], equipment: [], equipmentSuggested: [], feeNote: '', cancellationNote: '',
        }
      }
      if (saved && !denied) initial = saved
      const form = toForm(initial || emptyInput())
      this._content = null
      const autoSeedTitle = !saved && !!seedTitle && form.title === seedTitle
      this.titleTouched = autoSeedTitle ? false : !!form.title
      this.titleAutoValue = autoSeedTitle ? seedTitle : ''
      this.titleAutoSource = autoSeedTitle ? '已按路线名自动填写，可修改' : ''
      const routeLocked = phase === 'gathering' || phase === 'active'
      this.setData(Object.assign({
        loading: false,
        denied,
        isNew: !this.activityId,
        savedId: denied ? '' : this.savedId,
        phase,
        isDraft: phase === 'draft',
        saveLabel: phase === 'draft' ? '保存草稿' : '保存修改',
        form,
        fromRouteTitle,
        titleAutoSource: this.titleAutoSource,
        canChangeRoute: !routeLocked,
        contentFilled: (form.content || []).length > 0,
        contentResetKey: this.data.contentResetKey + 1,
      }, routeDerivedOf(form)), () => this.updatePublishReadiness(form))
      this.loadMyActivities()
    }).catch(e => this.setData({ loading: false, denied: api.errorText(e) }))
  },

  loadMyActivities() {
    api.read({ kind: 'home', perspective: 'organizer', openedActivityIds: [] }).then(res => {
      if (res.view.kind !== 'home') return
      // 新建态没有"表单来自哪次读"，这条 home 读就是它的 CAS 基线；已有成对抓取（reload 编辑态）时不覆盖。
      if (this.revision === undefined && Number.isInteger(res.revision)) this.revision = res.revision
      const mine = res.view.activities.filter(a => a.meta.owner)
      this.setData({
        myActivities: mine.map(a => ({ id: a.id, title: a.title || '未命名草稿' })),
      })
    }).catch(() => {})
  },

  persistDraft() {
    draft.setDraft(this.draftKey(), 'activity-editor', this.buildInput())
    const now = Date.now()
    if (!this._lastMark || now - this._lastMark > 30000) {
      this._lastMark = now
      this.setData({ draftSavedAt: F.hhmm(new Date().toISOString()) })
    }
  },

  buildInput() {
    const f = this.data.form
    const input = {
      title: f.title,
      description: f.description,
      organizerIntro: f.organizerIntro,
      startAt: composeDateTime(f.dt_start.date, f.dt_start.time),
      endAt: composeDateTime(f.dt_end.date, f.dt_end.time),
      deadlineAt: composeDateTime(f.dt_deadline.date, f.dt_deadline.time),
      acceptingSignups: f.acceptingSignups,
      capacity: Math.max(1, Math.min(500, Math.round(Number(f.capacity) || 24))),
      approvalMode: f.approvalMode,
      routeId: this.routeId || null,
      routeSnapshot: Object.assign({
        title: f.routeTitle,
        distanceKm: Number(f.distanceKm) || 0,
        ascentM: Math.round(Number(f.ascentM)) || 0,
        // GPX 元数据透传（无值时不带键，schema 按 specOpt 兼容缺省）。
        // ele 走 gpx.saneEle：旧草稿可能在修复前存下越界高程（哨兵/英尺值），直接透传会被服务端 schema 严拒；
        // 这里按同一规则剔除，草稿下次保存即自愈。
        points: f.points.map(p => {
          const ele = gpx.saneEle(p.ele)
          return Object.assign(
            { id: p.id, name: p.name, kind: p.kind, coordinates: coordsOrNull(p.lat, p.lng) },
            p.time ? { time: p.time } : {},
            ele !== null ? { ele } : {}
          )
        }),
        risks: f.risks.map(r => riskForm(r)),
      }, f.difficulty ? { difficulty: f.difficulty } : {}),
      pickupPoints: f.pickups.map(p => ({
        id: p.id, name: p.name, address: p.address,
        meetingAt: composeDateTime(p.meeting.date, p.meeting.time),
        coordinates: coordsOrNull(p.lat, p.lng),
      })),
      equipment: (f.equipmentText || '').split('\n').map(s => s.trim()).filter(Boolean),
      // 始终带键：activity.edit 是 Object.assign，缺键会把「清空建议装备」变成静默保留旧值。
      // 旧草稿没有这个字段，按空串读，避免一次编辑把发布链打断。
      equipmentSuggested: (f.equipmentSuggestedText || '').split('\n').map(s => s.trim()).filter(Boolean),
      feeNote: f.feeNote,
      cancellationNote: f.cancellationNote,
      content: (this._content && this._content.content) || f.content || [],
      coverFileId: this._content ? (this._content.coverFileId || '') : (f.coverFileId || ''),
      highlights: (f.highlightsText || '').split('\n').map(s => s.trim()).filter(Boolean),
      leader: f.leader || '',
      minParticipants: Number(f.minParticipants) || undefined,
      sceneryRating: Number(f.sceneryRating) || undefined,
      funRating: Number(f.funRating) || undefined,
      feeSummary: f.feeSummary || '',
      feeIncludes: (f.feeIncludesText || '').split('\n').map(s => s.trim()).filter(Boolean),
      feeExcludes: (f.feeExcludesText || '').split('\n').map(s => s.trim()).filter(Boolean),
      signupNote: f.signupNote || '',
    }
    // 轨迹折线（GPX 导入产生，用户不可编辑）：不足 2 点时不带该键，schema 按 specOpt 兼容缺省
    if (Array.isArray(f.track) && f.track.length >= 2) {
      input.routeSnapshot.track = f.track
    }
    return input
  },

  // ---- 通用字段编辑 ----
  onField(e) {
    const key = e.currentTarget.dataset.key
    this.setForm({ [key]: e.detail.value })
  },
  onNumber(e) {
    const key = e.currentTarget.dataset.key
    this.setForm({ [key]: e.detail.value })
  },
  // ---- 装备 chips（EDI-03）：底层仍是 equipmentText/equipmentSuggestedText 的换行文本，
  // 零 schema、零服务端改动；空值与重复项只在录入端拦，旧数据照样原样往返。 ----
  onEquipmentDraft(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [key]: e.detail.value })
  },
  addEquipment(e) {
    const group = e.currentTarget.dataset.group
    const textKey = group === 'suggested' ? 'equipmentSuggestedText' : 'equipmentText'
    const draftKey = group === 'suggested' ? 'equipmentSuggestedDraft' : 'equipmentDraft'
    const value = String(this.data[draftKey] || '').trim()
    if (!value) return
    const list = lineList(this.data.form[textKey])
    this.setData({ [draftKey]: '' })
    if (list.indexOf(value) !== -1) {
      this.setData({ message: '「' + value + '」已在清单里。' })
      return
    }
    list.push(value)
    this.setForm({ [textKey]: list.join('\n') })
  },
  removeEquipment(e) {
    const group = e.currentTarget.dataset.group
    const index = Number(e.currentTarget.dataset.index)
    const textKey = group === 'suggested' ? 'equipmentSuggestedText' : 'equipmentText'
    const list = lineList(this.data.form[textKey])
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return
    list.splice(index, 1)
    this.setForm({ [textKey]: list.join('\n') })
  },
  onApproval(e) {
    this.setForm({ approvalMode: ['manual', 'automatic'][Number(e.detail.value) || 0] })
  },
  onDifficulty(e) {
    const option = F.DIFFICULTY_OPTIONS[Number(e.detail.value)] || F.DIFFICULTY_OPTIONS[0]
    this.setForm({ difficulty: option.value })
  },
  onAccepting(e) {
    this.setForm({ acceptingSignups: e.detail.value.length > 0 })
  },
  onTitleInput(e) {
    this.titleTouched = true
    this.titleAutoValue = ''
    this.titleAutoSource = ''
    const form = Object.assign({}, this.data.form, { title: e.detail.value })
    this.setData(Object.assign({
      form,
      message: '',
      titleAutoSource: '',
      routeAutoText: routeAutoTextOf(form),
    }, this.checklistPatch(form)))
    this.persistDraft()
  },
  setForm(patch) {
    const form = Object.assign({}, this.data.form, patch)
    this.setData(Object.assign({
      form,
      message: '',
    }, routeDerivedOf(form), this.checklistPatch(form)))
    this.persistDraft()
  },
  onContentChange(e) {
    const detail = e.detail || {}
    const content = Array.isArray(detail.content) ? detail.content : []
    this._content = { content, coverFileId: detail.coverFileId || '' }
    const form = Object.assign({}, this.data.form, {
      content: content,
      coverFileId: detail.coverFileId || '',
    })
    this.setData({ form, contentFilled: content.length > 0, failure: '' })
    this.persistDraft()
  },
  onContentBusy(e) {
    this.setData({ contentBusy: !!(e.detail && e.detail.busy) })
  },
  onRating(e) {
    const key = e.currentTarget.dataset.key
    this.setForm({ [key]: Number(e.currentTarget.dataset.value) || 0 })
  },

  // ---- 日期/时间 ----
  onDate(e) {
    this.applyTimeEdit(e.currentTarget.dataset.key, { date: e.detail.value })
  },
  onTime(e) {
    // mode="time" 的 e.detail.value 就是 'HH:mm'（此前误当 TIME_SLOTS 索引，任何选择都落到 08:00）
    this.applyTimeEdit(e.currentTarget.dataset.key, { time: e.detail.value })
  },
  // 常用时间建议：点一下才写入；结束/截止与集合时间仍走同一套自动推导。
  useSuggestedStart(e) {
    const key = e.currentTarget.dataset.key
    const suggestion = (this.data.startSuggestions || []).find(item => item.key === key)
    if (!suggestion || !suggestion.at) return
    this.applyTimeEdit('dt_start', { date: suggestion.at.date, time: suggestion.at.time })
  },
  // 统一入口：写入 + 出发时间驱动的预填/联动。
  // 派生标记 dt_end_quick/dt_deadline_quick（仅内存态，不进草稿与提交）：'quick'=跟随出发重算，'custom'=用户手改后不再联动。
  applyTimeEdit(key, patch) {
    const form = JSON.parse(JSON.stringify(this.data.form))
    Object.assign(form[key], patch)
    if (key === 'dt_end' || key === 'dt_deadline') form[key + '_quick'] = 'custom'
    const s = form.dt_start
    if (key === 'dt_start' && s.date && s.time) {
      if (form.dt_end_quick !== 'custom' && (!form.dt_end.date || form.dt_end_quick === 'quick')) {
        const end = quickSameDayEnd(s)
        if (end) { form.dt_end = end; form.dt_end_quick = 'quick' }
      }
      if (form.dt_deadline_quick !== 'custom' && (!form.dt_deadline.date || form.dt_deadline_quick === 'quick')) {
        const dl = shiftDateTime(s.date, s.time, -1)
        if (dl) { form.dt_deadline = dl; form.dt_deadline_quick = 'quick' }
      }
    }
    // 自动生成的集合点跟随出发时间更新（用户改过集合时间就从 _autoPickupIds 移除，不再覆盖）。
    if (key === 'dt_start' && s.date && s.time) {
      const meeting = shiftDateTime(s.date, s.time, 0, -0.5)
      if (meeting) {
        form.pickups.forEach(p => {
          if (this._autoPickupIds && this._autoPickupIds[p.id]) {
            p.meeting = { date: meeting.date, time: meeting.time }
          }
        })
      }
    }
    const auto = (key === 'dt_start' && s.date && s.time) ? this.autoPickupFor(form) : { created: false }
    let editingPickups = this.data.editingPickups
    if (auto.created) {
      editingPickups = Object.assign({}, editingPickups)
      editingPickups[auto.id] = true
    }
    this.setData(Object.assign({
      form,
      editingPickups,
      message: auto.created ? '已用路线起点生成集合点，补一句集合位置说明就能发布。' : '',
    }, routeDerivedOf(form), this.checklistPatch(form)))
    this.persistDraft()
  },
  // 出发时间一旦确定，若已有路线起点且还没有上车点，就用起点生成一个待补地址的集合点。
  // 只带路线里真实存在的名称/坐标；地址留空，由人补一句“从哪儿进、认什么标志物”。
  autoPickupFor(form) {
    if (form.pickups.length) return { created: false }
    const start = form.points[0]
    if (!start || !start.lat || !start.lng) return { created: false }
    const s = form.dt_start
    const meeting = (s.date && s.time)
      ? (shiftDateTime(s.date, s.time, 0, -0.5) || { date: '', time: '' })
      : { date: '', time: '' }
    const id = freshId('pickup')
    form.pickups.push({
      id,
      name: (start.name || '起点') + '集合',
      address: '',
      lat: start.lat,
      lng: start.lng,
      meeting,
    })
    this._autoPickupIds = Object.assign({}, this._autoPickupIds || {})
    this._autoPickupIds[id] = true
    return { created: true, id }
  },
  checklistPatch(form) {
    const missing = this.missingForPublish(form)
    return {
      publishReady: missing.length === 0,
      requiredMissingText: missing.map(item => item.label).join('、'),
      // 步骤指示的完成态（T007，纯展示派生）：不新造「一步怎样算完成」的判据——
      // 与发布门同读这一份 missing。「哪些步骤有必填项」也问门本身：拿一份空白
      // 表单跑同一判据（答案恒为步骤 0/1；介绍与发布没有必填项，不印「完成」，
      // 不替用户宣布一件没发生的事）。步骤标签固定，答案算一次就够。
      stepDone: this.data.stepLabels.map((_, i) =>
        this.requiredSteps().indexOf(i) !== -1 && missing.every(m => m.step !== i)),
    }
  },
  requiredSteps() {
    if (!this._requiredSteps) {
      this._requiredSteps = this.missingForPublish(toForm(emptyInput())).map(m => m.step)
    }
    return this._requiredSteps
  },
  updatePublishReadiness(form) {
    this.setData(this.checklistPatch(form || this.data.form))
  },
  // 快捷估算结束时间：当天往返 / 出发后 N 天（保持出发时刻的时钟时间），填入即收起并标记为联动
  onQuickEnd(e) {
    const s = this.data.form.dt_start
    if (!s.date || !s.time) return
    const kind = e.currentTarget.dataset.kind
    const end = kind === 'same' ? quickSameDayEnd(s) : shiftDateTime(s.date, s.time, Number(kind) || 2)
    if (!end) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.dt_end = end
    form.dt_end_quick = 'quick'
    const expandedTimes = Object.assign({}, this.data.expandedTimes)
    delete expandedTimes.dt_end
    this.setData(Object.assign({ form, expandedTimes, message: '' }, this.checklistPatch(form)))
    this.persistDraft()
  },
  // 快捷估算报名截止：出发前 N 天（同一时钟时间）
  onQuickDeadline(e) {
    const s = this.data.form.dt_start
    if (!s.date || !s.time) return
    const shifted = shiftDateTime(s.date, s.time, -(Number(e.currentTarget.dataset.days) || 1))
    if (!shifted) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.dt_deadline = shifted
    form.dt_deadline_quick = 'quick'
    const expandedTimes = Object.assign({}, this.data.expandedTimes)
    delete expandedTimes.dt_deadline
    this.setData(Object.assign({ form, expandedTimes, message: '' }, this.checklistPatch(form)))
    this.persistDraft()
  },

  onPickupDate(e) {
    const i = e.currentTarget.dataset.index
    this.markPickupMeetingCustom(i)
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[i].meeting.date = e.detail.value
    this.setData(Object.assign({ form, message: '' }, this.checklistPatch(form)))
    this.persistDraft()
  },
  onPickupTime(e) {
    const i = e.currentTarget.dataset.index
    this.markPickupMeetingCustom(i)
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[i].meeting.time = e.detail.value
    this.setData(Object.assign({ form, message: '' }, this.checklistPatch(form)))
    this.persistDraft()
  },
  markPickupMeetingCustom(index) {
    const pickup = this.data.form.pickups[index]
    if (pickup && this._autoPickupIds) delete this._autoPickupIds[pickup.id]
  },

  // 选点失败文案，分类与 GPX 选文件一致。调用方已对「用户主动取消」提前 return，
  // 这里只处理真失败：两种可操作文案都指向节点/上车点都有的「手动输入」经纬度兜底。
  pickFailText(msg, what) {
    // 隐私必须先判：微信的 privacy 报错是 "privacy not authorized"，而 authorized 含 auth
    // 子串——先判鉴权会把「去公众平台补声明」错报成「去设置开定位」。顺序勿调换。
    if (/privacy|scope is not declared/i.test(msg)) {
      return '公众平台《用户隐私保护指引》尚未声明「位置信息」，无法调用地图选点。请到 mp.weixin.qq.com → 设置 → 服务内容声明 补充并等生效；期间可改用「手动输入」。'
    }
    if (/auth deny|denied|permission denied|deny/i.test(msg)) {
      return '未获得定位权限，无法在地图上选' + what + '。可改用「手动输入」直接填经纬度，或在设置中开启定位。'
    }
    return '地图选点失败' + (what ? '（' + what + '）' : '') + (msg ? '：' + msg : '')
  },

  // ---- 路线节点 ----
  onRoutePoint(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points[index][key] = e.detail.value
    this.setData(Object.assign({ form }, routeDerivedOf(form)))
    this.persistDraft()
  },
  onPointKind(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points[index].kind = ['start', 'checkpoint', 'finish'][Number(e.detail.value) || 0]
    this.setData({ form })
    this.persistDraft()
  },
  addPoint() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    const id = freshId('point')
    form.points.push({ id, name: '', kind: form.points.length ? 'checkpoint' : 'start', lat: '', lng: '' })
    const expandedPoints = Object.assign({}, this.data.expandedPoints)
    expandedPoints[id] = true
    this.setData(Object.assign({ form, expandedPoints }, routeDerivedOf(form)))
    this.persistDraft()
  },
  removePoint(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points.splice(index, 1)
    this.setData(Object.assign({ form }, routeDerivedOf(form)))
    this.persistDraft()
  },
  togglePoint(e) {
    const id = e.currentTarget.dataset.id
    const expandedPoints = Object.assign({}, this.data.expandedPoints)
    if (expandedPoints[id]) delete expandedPoints[id]
    else expandedPoints[id] = true
    this.setData({ expandedPoints })
  },
  togglePointCoords(e) {
    const id = e.currentTarget.dataset.id
    const showPointCoords = Object.assign({}, this.data.showPointCoords)
    if (showPointCoords[id]) delete showPointCoords[id]
    else showPointCoords[id] = true
    this.setData({ showPointCoords })
  },
  choosePointLocation(e) {
    const index = e.currentTarget.dataset.index
    wx.chooseLocation({
      success: res => {
        const form = JSON.parse(JSON.stringify(this.data.form))
        form.points[index].lat = String(res.latitude)
        form.points[index].lng = String(res.longitude)
        this.setData({ form, failure: '' })
        this.persistDraft()
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        this.setData({ failure: this.pickFailText(msg, '路线节点') })
      },
    })
  },
  togglePickup(e) {
    const id = e.currentTarget.dataset.id
    const editingPickups = Object.assign({}, this.data.editingPickups)
    if (editingPickups[id]) delete editingPickups[id]
    else editingPickups[id] = true
    this.setData({ editingPickups })
  },
  togglePickupCoords(e) {
    const id = e.currentTarget.dataset.id
    const showPickupCoords = Object.assign({}, this.data.showPickupCoords)
    if (showPickupCoords[id]) delete showPickupCoords[id]
    else showPickupCoords[id] = true
    this.setData({ showPickupCoords })
  },

  useSampleRoute() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.routeTitle = '示例路线（请自行修改）'
    form.points = [
      { id: freshId('point'), name: '示例起点', kind: 'start', lat: '', lng: '' },
      { id: freshId('point'), name: '示例终点', kind: 'finish', lat: '', lng: '' },
    ]
    form.track = [] // 换路线丢弃旧轨迹，避免与其他来源的节点错配
    this.setData(Object.assign({ form, expandedPoints: {}, showPointCoords: {} }, routeDerivedOf(form), this.checklistPatch(form)))
    this.persistDraft()
  },
  toggleRouteDetails() {
    this.setData({ routeDetailsOpen: !this.data.routeDetailsOpen })
  },
  toggleDetailExtras() {
    this.setData({ detailExtrasOpen: !this.data.detailExtrasOpen })
  },
  toggleRisks() {
    this.setData({ risksOpen: !this.data.risksOpen })
  },

  // ---- 路线库快速带入（不推翻路线资产本身，只把快照带进当前活动）----
  onQuickRouteOpen() {
    if (!this.data.canChangeRoute) {
      this.setData({ failure: '集合或行程中路线只能补充，不能更换；如需换路线，请在发布前修改。' })
      return
    }
    this.setData({ quickRouteOpen: true, quickRouteLoading: true, quickRouteError: '', quickRouteQuery: '' })
    const token = this._quickRouteToken = (this._quickRouteToken || 0) + 1
    api.readRoutes().then(res => {
      if (token !== this._quickRouteToken) return
      const routes = (res.routes || []).map(route => {
        const stats = []
        if (Number(route.distanceKm) > 0) stats.push(route.distanceKm + ' km')
        if (Number(route.ascentM) > 0) stats.push('爬升 ' + route.ascentM + ' m')
        stats.push((route.pointCount || 0) + ' 节点')
        if (route.riskCount > 0) stats.push(route.riskCount + ' 风险')
        const sourceText = { gpx: 'GPX 导入', manual: '手工整理', copy: '活动沉淀' }[route.source] || '路线'
        const updatedText = route.updatedAt ? F.dateLabel(route.updatedAt) : '早期路线'
        return {
          id: route.id,
          title: route.title || '未命名路线',
          statsText: stats.join(' · '),
          ownerText: (route.isOwner ? '我的路线' : '共享路线 · 将以活动快照带入') + ' · ' + sourceText + ' · ' + updatedText,
          badge: route.isOwner ? '我的' : '共享',
        }
      })
      this._quickRoutesAll = routes
      this.setData({ quickRouteLoading: false, quickRouteTotal: routes.length, quickRouteError: '' })
      this.applyQuickRouteFilter('')
    }).catch(e => {
      if (token !== this._quickRouteToken) return
      this.setData({ quickRouteLoading: false, quickRouteError: api.errorText(e) })
    })
  },
  applyQuickRouteFilter(query) {
    const all = this._quickRoutesAll || []
    const q = String(query || '').trim().toLowerCase()
    const matched = q
      ? all.filter(route => (route.title + ' ' + route.statsText).toLowerCase().indexOf(q) !== -1)
      : all
    // 真实账号里可能有几百条测试路线；只渲染最近 40 条，其余用搜索收窄。
    const shown = matched.slice(0, 40)
    this.setData({
      quickRouteQuery: String(query || ''),
      quickRoutes: shown,
      quickRouteMatched: matched.length,
      quickRouteShown: shown.length,
    })
  },
  onQuickRouteSearch(e) {
    this.applyQuickRouteFilter(e.detail.value)
  },
  onQuickRouteRetry() {
    this.onQuickRouteOpen()
  },
  onQuickRouteClose() {
    this._quickPickToken = (this._quickPickToken || 0) + 1
    this.setData({ quickRouteOpen: false, quickRouteBusyId: '' })
  },
  onQuickRoutePick(e) {
    const id = e.currentTarget.dataset.id
    if (!id || this.data.quickRouteBusyId) return
    const token = this._quickPickToken = (this._quickPickToken || 0) + 1
    this.setData({ quickRouteBusyId: id, quickRouteError: '' })
    api.readRoutes(id).then(res => {
      if (token !== this._quickPickToken) return
      const route = res && res.route
      if (!route) throw new Error('找不到此路线。')
      this.setData({ quickRouteBusyId: '' })
      const hasRoute = this.data.form.points.length || this.data.form.risks.length
        || this.data.form.routeTitle.trim() || this.routeId
      if (hasRoute) {
        this._pendingRoute = route
        this.setData({
          quickRouteOpen: false,
          routeReplaceOpen: true,
          pendingRouteTitle: route.title || '未命名路线',
        })
        return
      }
      this.setData({ quickRouteOpen: false })
      this.applyRouteSnapshot(route)
    }).catch(e => {
      if (token !== this._quickPickToken) return
      this.setData({ quickRouteBusyId: '', quickRouteError: api.errorText(e) })
    })
  },
  onRouteReplaceClose() {
    this._pendingRoute = null
    this.setData({ routeReplaceOpen: false, pendingRouteTitle: '' })
  },
  onRouteReplaceConfirm() {
    const route = this._pendingRoute
    this._pendingRoute = null
    this.setData({ routeReplaceOpen: false, pendingRouteTitle: '' })
    if (route) this.applyRouteSnapshot(route)
  },
  applyRouteSnapshot(route) {
    if (!route) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.routeTitle = route.title || ''
    form.distanceKm = Number(route.distanceKm) > 0 ? String(route.distanceKm) : ''
    form.ascentM = Number(route.ascentM) > 0 ? String(route.ascentM) : ''
    form.difficulty = route.difficulty || ''
    form.points = routePointsToForm(route.points)
    form.risks = routeRisksToForm(route.risks)
    form.track = (route.track || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    // 共享路线不能挂到 routeId 上（服务端只允许自己的路线）；快照落库时会自动沉淀一份私有路线。
    this.routeId = route.isOwner ? route.id : null

    const autoOwned = !form.title.trim() || (!!this.titleAutoValue && form.title === this.titleAutoValue)
    if (!this.titleTouched && route.title && autoOwned) {
      form.title = route.title
      this.titleAutoValue = route.title
      this.titleAutoSource = '已按路线名自动填写，可修改'
    }

    // 只填空字段：路线自带的风险优先；没有风险时，按路线特征给出“建议”，并明确告诉用户可核对。
    let prefilled = ''
    const suggestion = gpx.suggestForRoute(route)
    if (suggestion) {
      if (!form.risks.length && suggestion.risks.length) {
        form.risks = suggestion.risks.map(r => ({ id: freshId('risk'), title: r.title, advice: r.advice }))
        prefilled += '，并按路线特征预填 ' + form.risks.length + ' 条风险建议'
      }
      if (!form.equipmentText.trim() && suggestion.equipment.length) {
        form.equipmentText = suggestion.equipment.join('\n')
        prefilled += (prefilled ? '与 ' : '，并预填 ') + suggestion.equipment.length + ' 项装备建议'
      }
    }

    const auto = this.autoPickupFor(form)
    let editingPickups = this.data.editingPickups
    if (auto.created) {
      editingPickups = Object.assign({}, editingPickups)
      editingPickups[auto.id] = true
    }
    this.setData(Object.assign({
      form,
      titleAutoSource: this.titleAutoSource,
      fromRouteTitle: route.title || '',
      editingPickups,
      message: '已带入「' + (route.title || '路线') + '」' + prefilled
        + (auto.created ? '；并已用起点生成集合点，补一句集合位置说明即可。' : '。'),
    }, routeDerivedOf(form), this.checklistPatch(form)))
    this.persistDraft()
  },

  // 一键派生集合点（D1=C，2026-10-14）：GPX 导入/路线库预填后，把起点节点直接
  // 当作集合上车点——名称与坐标自动带，集合时间默认出发前 30 分（与 addPickup 同口径）。
  // 地址不凭空编造：发布门要求它，留给发起人补一句「从哪儿进、认什么标志物」。
  useStartAsPickup() {
    const f = this.data.form
    const start = f.points[0]
    if (!start || f.pickups.length) return
    const form = JSON.parse(JSON.stringify(f))
    const s = form.dt_start
    const meeting = (s.date && s.time)
      ? (shiftDateTime(s.date, s.time, 0, -0.5) || { date: '', time: '' })
      : { date: '', time: '' }
    const id = freshId('pickup')
    form.pickups.push({
      id,
      name: (start.name || '起点') + '集合',
      address: '',
      lat: start.lat || '', lng: start.lng || '',
      meeting,
    })
    this._autoPickupIds = Object.assign({}, this._autoPickupIds || {})
    this._autoPickupIds[id] = true
    const editingPickups = Object.assign({}, this.data.editingPickups)
    editingPickups[id] = true // 直接展开编辑态：下一句就是要补的集合位置说明
    this.setData(Object.assign({
      form,
      editingPickups,
      message: '已用起点作为集合点，请补一句集合位置说明。',
      routeAutoText: routeAutoTextOf(form),
    }, this.checklistPatch(form)))
    this.persistDraft()
  },

  // ---- 上车点 ----
  onPickup(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[index][key] = e.detail.value
    this.setData(Object.assign({ form }, this.checklistPatch(form)))
    this.persistDraft()
  },
  // 地图选点一次补齐名称、地址与坐标；这是新建集合点最省输入的路径。
  chooseNewPickupLocation() {
    wx.chooseLocation({
      success: res => {
        const form = JSON.parse(JSON.stringify(this.data.form))
        const id = freshId('pickup')
        const s = form.dt_start
        const meeting = (s.date && s.time)
          ? (shiftDateTime(s.date, s.time, 0, -0.5) || { date: '', time: '' })
          : { date: '', time: '' }
        form.pickups.push({
          id,
          name: res.name || res.address || '集合点',
          address: res.address || res.name || '',
          lat: String(res.latitude),
          lng: String(res.longitude),
          meeting,
        })
        this.setData(Object.assign({ form, failure: '', message: '已用地图选点填好集合位置。' }, this.checklistPatch(form)))
        this.persistDraft()
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        this.setData({ failure: this.pickFailText(msg, '集合点') })
      },
    })
  },
  choosePickupLocation(e) {
    const index = e.currentTarget.dataset.index
    wx.chooseLocation({
      success: res => {
        const form = JSON.parse(JSON.stringify(this.data.form))
        form.pickups[index].lat = String(res.latitude)
        form.pickups[index].lng = String(res.longitude)
        if (!form.pickups[index].address) form.pickups[index].address = res.address || res.name || ''
        if (!form.pickups[index].name) form.pickups[index].name = res.name || res.address || ''
        this.setData(Object.assign({ form, failure: '' }, this.checklistPatch(form)))
        this.persistDraft()
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        this.setData({ failure: this.pickFailText(msg, '上车点') })
      },
    })
  },
  addPickup() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    const id = freshId('pickup')
    // 集合默认=出发前 30 分钟（日期跟随出发日）；出发时间未填则待定
    const s = this.data.form.dt_start
    const meeting = (s.date && s.time)
      ? (shiftDateTime(s.date, s.time, 0, -0.5) || { date: '', time: '' })
      : { date: '', time: '' }
    form.pickups.push({ id, name: '', address: '', lat: '', lng: '', meeting })
    const editingPickups = Object.assign({}, this.data.editingPickups)
    editingPickups[id] = true
    this.setData(Object.assign({ form, editingPickups }, this.checklistPatch(form)))
    this.persistDraft()
  },
  // 集合时刻快捷估算：与出发同时 / 提前 30 分 / 提前 1 小时（跨天如实跨天）
  onPickupQuickTime(e) {
    const i = Number(e.currentTarget.dataset.index)
    const s = this.data.form.dt_start
    if (!s.date || !s.time) return
    const offset = Number(e.currentTarget.dataset.offset) || 0
    const shifted = offset === 0 ? { date: s.date, time: s.time } : shiftDateTime(s.date, s.time, 0, offset / 60)
    if (!shifted) return
    this.markPickupMeetingCustom(i)
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups[i].meeting = shifted
    this.setData(Object.assign({ form, message: '' }, this.checklistPatch(form)))
    this.persistDraft()
  },
  removePickup(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.pickups.splice(index, 1)
    this.setData(Object.assign({ form }, this.checklistPatch(form)))
    this.persistDraft()
  },

  // ---- 风险与装备 ----
  onRisk(e) {
    const { index, key } = e.currentTarget.dataset
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.risks[index][key] = e.detail.value
    this.setData({ form, routeAutoText: routeAutoTextOf(form) })
    this.persistDraft()
  },
  addRisk() {
    const form = JSON.parse(JSON.stringify(this.data.form))
    const id = freshId('risk')
    form.risks.push({ id, title: '', advice: '' })
    const editingRisks = Object.assign({}, this.data.editingRisks)
    editingRisks[id] = true
    this.setData({ form, editingRisks, routeAutoText: routeAutoTextOf(form) })
    this.persistDraft()
  },
  removeRisk(e) {
    const index = e.currentTarget.dataset.index
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.risks.splice(index, 1)
    this.setData({ form, routeAutoText: routeAutoTextOf(form) })
    this.persistDraft()
  },

  toggleTime(e) {
    const key = e.currentTarget.dataset.key
    const expandedTimes = Object.assign({}, this.data.expandedTimes)
    if (expandedTimes[key]) delete expandedTimes[key]
    else expandedTimes[key] = true
    this.setData({ expandedTimes })
  },
  toggleIntro() {
    this.setData({ expandedIntro: !this.data.expandedIntro })
  },
  toggleRisk(e) {
    const id = e.currentTarget.dataset.id
    const editingRisks = Object.assign({}, this.data.editingRisks)
    if (editingRisks[id]) delete editingRisks[id]
    else editingRisks[id] = true
    this.setData({ editingRisks })
  },
  toggleExtras() {
    this.setData({ editingExtras: !this.data.editingExtras })
  },

  // ---- 步骤 ----
  setStep(e) {
    if (this.data.contentBusy) {
      this.setData({ failure: '图片正在上传/检查，请稍候再切换步骤。' })
      return
    }
    this.setData({ step: Number(e.currentTarget.dataset.step) })
  },
  prevStep() {
    if (this.data.contentBusy) return
    this.setData({ step: Math.max(0, this.data.step - 1) })
  },
  nextStep() {
    if (this.data.contentBusy) return
    this.setData({ step: Math.min(3, this.data.step + 1) })
  },

  // ---- 保存 ----
  capacityInvalid() {
    const cap = Number(this.data.form.capacity)
    return !Number.isInteger(cap) || cap < 1 || cap > 500
  },
  // 写命令入口的在途闸门：返回 true 表示「上一条写还在飞」，本次操作必须拦。
  // busy 只是界面姿态、不是业务状态：一次保存/发布的 promise 没能回来时，它绝不能把「发布活动」
  // 永久锁在禁用态（WXML 是 bindtap="{{busy ? '' : 'onPublishIntent'}}"，点了就是没反应）。
  // 超过宽限期即认定残留：就地复位并放行本次操作，而不是让用户只能退出页面重进。
  // 宽限期与 elapsed 判据只有一个出处 J.busyStale（铁律 31：页面不写第二个 8000、不自己算时间差）。
  // 求值点放在写入口而不是 reload()：本面连 onShow 都没有，而写悬死时 revision 不会前进。
  busyBlocks() {
    if (this.data.busy && J.busyStale(this.data.busyAt, Date.now())) {
      this.setData({ busy: false, busyAt: 0 })
      console.warn('[busy] 清掉一个超过 8 秒没落地的写状态')
    }
    return !!this.data.busy
  },
  // 校验并把当前表单落为服务器草稿（新建则创建，已保存则编辑）。「发布」入口与保存共用，
  // 保证发布确认弹出的内容就是刚保存的当前内容。resolve(id) / reject(已透出 failure)。
  persistCurrent(successMessage) {
    if (this.data.contentBusy) {
      this.setData({ step: 2, failure: '图片正在上传/检查，完成后才能保存或发布。' })
      return Promise.reject(new Error('content-busy'))
    }
    if (this.capacityInvalid()) {
      this.setData({ step: 3, failure: '人数上限请填写 1–500 的整数。' })
      return Promise.reject(new Error('capacity'))
    }
    this.setData({ busy: true, busyAt: Date.now(), failure: '', message: '' })
    // 域层不变量要求发起者已有落库档案（profile.save 硬性要求姓名+手机号），否则任何保存/发布都会被拒。
    // read({kind:'profile'}) 无档案时也返回 kind:'profile' 的空壳（selectors 对首访返回空档案），
    // 因此以姓名/手机号是否实际填写为准。提前拦截并给出可操作指引，而不是透出"路线归属或节点标识无效"。
    return api.read({ kind: 'profile' }).then(res => {
      const person = res.view && res.view.profile && res.view.profile.person
      if (!person || !person.name || !person.phone) {
        // 不跳「我的」：本页自动弹出微信资料 sheet；保存后由 _afterProfile 继续原动作。
        const err = new Error('需要先补全姓名与手机号。')
        err.profileGate = true
        this.setData({ busy: false, failure: '', profileGate: true, profileGateOpen: true })
        throw err
      }
      this.setData({ profileGate: false })
      const input = this.buildInput()
      const payload = this.savedId
        ? { type: 'activity.edit', activityId: this.savedId, input }
        : { type: 'activity.create', input }
      // 编辑态用"装配这张表单的那次读"的 revision（成对，才能查出别人在中间写过）；
      // 新建态的表单来自本机草稿、不来自任何服务端读，用紧挨着这次写的 profile 读即可。
      // 绝不能用 profile 读的返回值给编辑态现补一个 revision——那等于写前自证通过，CAS 失效。
      const expectedRevision = this.savedId ? this.revision : res.revision
      return api.dispatchAndSync(payload, expectedRevision, this).then(res2 => {
        const id = this.savedId || res2.targetIds[0]
        this.savedId = id
        this.revision = res2.revision
        draft.clearDraft(this.draftKey(), 'activity-editor')
        this._afterProfile = null
        this.setData({
          busy: false,
          profileGate: false,
          profileGateOpen: false,
          savedId: id,
          message: successMessage,
        })
        return id
      })
    }).catch(e => {
      if (!(e && e.profileGate)) {
        this._afterProfile = null
        this.setData({ busy: false, failure: api.errorText(e) })
      }
      throw e
    })
  },
  save(preview) {
    if (this.busyBlocks()) return
    const resume = () => this.save(preview)
    this._afterProfile = resume
    this.persistCurrent(this.data.phase === 'draft' ? '草稿已保存，尚未发布，也没有自动报名。' : '活动修改已保存。')
      .then(id => { if (preview && id) wx.navigateTo({ url: '/pages/activity/activity?id=' + id }) })
      .catch(() => {})
  },
  // 微信资料门：保存后自动继续刚才的保存/发布；关闭只收起 sheet，仍保留补全入口。
  onProfileSaved() {
    this.setData({ profileGate: false, profileGateOpen: false, failure: '' })
    const resume = this._afterProfile
    this._afterProfile = null
    if (typeof resume === 'function') resume()
  },
  onOpenProfileGate() {
    this.setData({ profileGateOpen: true })
  },
  onProfileGateClose() {
    this.setData({ profileGateOpen: false })
  },
  // 发布前逐项预检（与服务端 full 校验对齐）：返回缺失项 [{step, label}]，
  // 让用户在对应步骤就被明确告知缺什么，而不是发布时撞到一句笼统的服务端报错。
  // 2026-10-14 快速创建：这里只剩**必填**（标题/时间/集合点）；轨迹可解析项
  // （路线名称/节点/风险/装备）移到 deferredForPublish——不拦路，但显式可见。
  missingForPublish(form) {
    const f = form || this.data.form
    const missing = []
    if (!f.title.trim()) missing.push({ step: 0, label: '活动名称' })
    if (!f.dt_start.date || !f.dt_start.time) missing.push({ step: 0, label: '出发时间' })
    if (!f.dt_end.date || !f.dt_end.time) missing.push({ step: 0, label: '预计结束时间' })
    if (!f.dt_deadline.date || !f.dt_deadline.time) missing.push({ step: 0, label: '报名截止时间' })
    if (f.dt_start.date && f.dt_start.time && f.dt_end.date && f.dt_end.time && f.dt_deadline.date && f.dt_deadline.time) {
      const s = Date.parse(composeDateTime(f.dt_start.date, f.dt_start.time))
      const e = Date.parse(composeDateTime(f.dt_end.date, f.dt_end.time))
      const d = Date.parse(composeDateTime(f.dt_deadline.date, f.dt_deadline.time))
      if (!(d <= s && s < e)) missing.push({ step: 0, label: '时间顺序（截止 ≤ 出发，且早于结束）' })
    }
    if (!f.pickups.length) missing.push({ step: 1, label: '至少 1 个集合上车点' })
    else if (f.pickups.some(p => !p.name.trim() || !p.address.trim() || !p.meeting.date || !p.meeting.time)) missing.push({ step: 1, label: '集合上车点的名称、地址与集合时间' })
    return missing
  },
  // 可后补清单：与服务端口径一致——整体可为空，填了的条目必须完整（半成品条目也点名）。
  // 不在发布前拦路，但发布确认层要逐项摆出来，让用户「知情跳过」而不是静默跳过。
  deferredForPublish(form) {
    const f = form || this.data.form
    const deferred = []
    // 按步骤顺序点名：路线(1) → 图文(2) → 风险(3)，「去补上」先落到更靠前的工作面。
    if (!f.routeTitle.trim()) deferred.push({ step: 1, label: '路线名称' })
    if (!f.points.length) deferred.push({ step: 1, label: '至少 1 个路线节点' })
    else if (f.points.some(p => !p.name.trim())) deferred.push({ step: 1, label: '每个路线节点的名称' })
    const hasContent = this.data.contentFilled || (Array.isArray(f.content) && f.content.length > 0)
    if (!hasContent) deferred.push({ step: 2, label: '图文详情（封面、正文或图片）' })
    if (!f.risks.length) deferred.push({ step: 3, label: '至少 1 条风险提示' })
    else if (f.risks.some(r => !r.title.trim() || !r.advice.trim())) deferred.push({ step: 3, label: '每条风险的问题与应对方式' })
    return deferred
  },
  // 步骤 3 常驻发布入口：先预检必填缺失项（跳到第一步并逐项点名），再静默保存，最后弹发布确认。
  // 可后补项不拦截——确认弹层里逐项点名并给「去补上」出口（onDeferredFix）。
  onPublishIntent() {
    if (this.busyBlocks()) return
    const missing = this.missingForPublish()
    if (missing.length) {
      this.setData({ step: missing[0].step, failure: '还差：' + missing.map(m => m.label).join('、') + '。补齐后再发布。' })
      return
    }
    this._afterProfile = () => this.onPublishIntent()
    this.persistCurrent('内容已保存，确认后正式发布。')
      .then(() => this.onPublishOpen())
      .catch(() => {})
  },
  onSave() { this.save(false) },
  onSavePreview() { this.save(true) },

  // ---- 复制 ----
  toggleTemplateCopy() {
    this.setData({ templateCopyOpen: !this.data.templateCopyOpen })
  },
  onTemplatePick(e) {
    this.setData({ templateIndex: Number(e.detail.value) })
    const item = this.data.myActivities[Number(e.detail.value)]
    this.setData({ templateId: item ? item.id : '' })
  },
  onCopyTemplate() {
    if (!this.data.templateId || this.busyBlocks()) return
    this.setData({ busy: true, busyAt: Date.now(), failure: '' })
    api.dispatchAndSync({ type: 'activity.copy', sourceActivityId: this.data.templateId }, this.revision, this)
      .then(res => {
        this.setData({ busy: false })
        const id = res.targetIds[0]
        if (id) wx.redirectTo({ url: '/pages/editor/editor?id=' + id })
      })
      .catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
  },

  // ---- GPX 导入 ----
  onImportGpx() {
    this.setData({ gpxError: '' })
    // wx.chooseMessageFile 是隐私接口：只能选聊天中的文件，且需平台隐私协议声明「选中的文件」。
    // 失败必须显式透出（此前静默导致“点了没反应”）。
    if (!wx.chooseMessageFile) {
      this.setData({ gpxOpen: true, gpxError: '当前基础库不支持从聊天选择文件，请升级开发者工具或改用真机。' })
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: res => {
        const file = res.tempFiles && res.tempFiles[0]
        if (!file) return
        if (file.size > gpx.MAX_FILE_BYTES) {
          this.setData({ gpxOpen: true, gpxError: '文件超过 8MB，请换一个 GPX 文件。' })
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: read => {
            const parsed = gpx.parseGpx(read.data)
            if (!parsed.ok) {
              this.setData({ gpxOpen: true, gpxError: parsed.error })
              return
            }
            this.setData({
              gpxOpen: true,
              gpxError: '',
              gpxMeta: {
                fileName: file.name || '轨迹.gpx',
                count: parsed.points.length,
                distanceKm: parsed.distanceKm,
                ascentM: parsed.ascentM,
                hasElevation: parsed.stats.hasElevation,
              },
              gpxPoints: parsed.points,
              gpxTrack: parsed.track || [],
              gpxSuggest: parsed.suggestions || null,
            })
          },
          fail: err => this.setData({ gpxOpen: true, gpxError: '读取文件失败：' + ((err && err.errMsg) || '请重试') }),
        })
      },
      fail: err => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) return
        if (/privacy|scope is not declared/i.test(msg)) {
          this.setData({
            gpxOpen: true,
            gpxError: '公众平台《用户隐私保护指引》尚未声明「选中的文件」，无法从聊天选择文件。请到 mp.weixin.qq.com → 设置 → 服务内容声明 补充并等生效；解析器本身不受影响，真机声明后即可用。',
          })
          return
        }
        this.setData({ gpxOpen: true, gpxError: '打开文件选择失败' + (msg ? '：' + msg : '') })
      },
    })
  },
  onGpxClose() { this.setData({ gpxOpen: false }) },
  onGpxApply() {
    const meta = this.data.gpxMeta
    const points = this.data.gpxPoints
    if (!meta || !points.length) return
    const form = JSON.parse(JSON.stringify(this.data.form))
    form.points = points.map(p => ({
      id: freshId('point'), name: p.name, kind: p.kind,
      lat: String(p.coordinates.lat), lng: String(p.coordinates.lng),
      // 轨迹自带时刻与高程：天气页据此推算"第几天抵达"与是否高过云层带，用户不可编辑
      time: p.time || '', ele: Number.isFinite(p.ele) ? p.ele : null,
    }))
    form.track = (this.data.gpxTrack || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    // 预填风险与装备：只填空字段，用户已填内容不覆盖
    const sug = this.data.gpxSuggest
    let prefilled = ''
    if (sug) {
      if (!form.risks.length && sug.risks && sug.risks.length) {
        form.risks = sug.risks.map(r => ({ id: freshId('risk'), title: r.title, advice: r.advice }))
        prefilled = '，并预填 ' + form.risks.length + ' 条风险提示'
      }
      if (!form.equipmentText.trim() && sug.equipment && sug.equipment.length) {
        form.equipmentText = sug.equipment.join('\n')
        prefilled += (prefilled ? '与装备清单' : '，并预填装备清单')
      }
    }
    if (meta.distanceKm > 0) form.distanceKm = String(meta.distanceKm)
    if (meta.hasElevation) form.ascentM = String(meta.ascentM)
    const fileTitle = meta.fileName.replace(/\.(gpx|xml)$/i, '')
    if (!form.routeTitle.trim()) form.routeTitle = fileTitle
    // 文件名是真实来源，只在标题为空且用户没亲手改过时填入；改过就绝不覆盖。
    if (!this.titleTouched && !form.title.trim() && fileTitle) {
      form.title = fileTitle
      this.titleAutoValue = fileTitle
      this.titleAutoSource = '已按 GPX 文件名自动填写，可修改'
    }
    const auto = this.autoPickupFor(form)
    let editingPickups = {}
    if (auto.created) editingPickups[auto.id] = true
    this.setData(Object.assign({
      gpxOpen: false,
      form,
      titleAutoSource: this.titleAutoSource,
      expandedPoints: {},
      showPointCoords: {},
      editingPickups,
      showPickupCoords: {},
      message: '已导入 ' + points.length + ' 个路线节点' + prefilled
        + (auto.created ? '；并已用起点生成集合点，补一句集合位置说明即可。' : '，记得在后续步骤核对保存。'),
    }, routeDerivedOf(form), this.checklistPatch(form)))
    this.persistDraft()
  },

  // ---- 删除草稿：仅草稿可删；已发布活动走工作台的取消 ----
  onDeleteDraftOpen() {
    this.setData({ deleteDraftOpen: true, failure: '' })
  },
  onDeleteDraftClose() {
    this.setData({ deleteDraftOpen: false })
  },
  onDeleteDraftConfirm() {
    if (this.busyBlocks()) return
    if (!this.savedId) {
      // 还没保存过服务器：删除只清本机草稿
      draft.clearDraft(this.draftKey(), 'activity-editor')
      api.toast('草稿已删除')
      wx.switchTab({ url: '/pages/home/home' })
      return
    }
    this.setData({ busy: true, busyAt: Date.now(), deleteDraftOpen: false })
    api.dispatchAndSync({ type: 'activity.delete', activityId: this.savedId }, this.revision, this)
      .then(() => {
        draft.clearDraft(this.draftKey(), 'activity-editor')
        // 成功路径也要复位 busy：跳首页是异步的，任何一次没跳成（Tab 页复用、导航被拦）
        // 都会把一个已经删干净编辑器的页面留在「正在…」态——复位与跳转不互相替代。
        this.setData({ busy: false, deleteDraftOpen: false })
        api.toast('草稿已删除')
        wx.switchTab({ url: '/pages/home/home' })
      })
      .catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
  },

  // ---- 发布 ----
  onPublishOpen() {
    const deferred = this.deferredForPublish()
    const f = this.data.form
    const startText = f.dt_start.date ? (f.dt_start.date + ' ' + (f.dt_start.time || '时间待定')) : '出发时间待定'
    const pickupText = f.pickups.length
      ? (f.pickups[0].name || '未命名集合点') + (f.pickups.length > 1 ? ' 等 ' + f.pickups.length + ' 个' : '')
      : '集合点待补'
    this.setData({
      publishOpen: true, participate: false, dataUse: false, tripSelf: true, tripPickupIndex: -1, failure: '',
      deferred,
      publishSummaryText: startText + ' · ' + pickupText + ' · 上限 ' + f.capacity + ' 人'
        + (f.routeTitle ? ' · ' + f.routeTitle : ''),
      // WXML 表达式不保证支持箭头函数：拼接在 JS 里做（与 text.wxs 的分工同理）
      deferredText: deferred.map(d => d.label).join('、'),
    })
  },
  onPublishClose() { this.setData({ publishOpen: false }) },
  // 发布确认层的「去补上」：关弹层跳到第一个后补项所在步骤。已保存的内容不丢
  // （persistCurrent 刚落库，草稿也已清——回编辑器是从活动读回的表单）。
  onDeferredFix() {
    const first = this.data.deferred[0]
    this.setData({ publishOpen: false, step: first ? first.step : this.data.step })
  },
  onParticipate(e) {
    this.setData({ participate: e.detail.value.length > 0, dataUse: false })
  },
  onDataUse(e) { this.setData({ dataUse: e.detail.value.length > 0 }) },
  onTripChange(e) { this.setData({ tripSelf: e.detail.value === 'self' }) },
  onTripPickup(e) { this.setData({ tripPickupIndex: Number(e.detail.value) }) },

  publish() {
    if (this.busyBlocks()) return
    if (!this.savedId) return
    let participation = null
    if (this.data.participate) {
      if (!this.data.dataUse) {
        this.setData({ failure: '本人参加需要独立确认资料使用授权。' })
        return
      }
      api.read({ kind: 'profile' }).then(res => {
        if (res.view.kind !== 'profile') {
          this.setData({ failure: '当前资料不可用，请先到「我的」完善。' })
          return
        }
        const profile = res.view.profile
        const pickups = this.data.form.pickups
        const picked = this.data.tripPickupIndex >= 0 ? pickups[this.data.tripPickupIndex] : null
        // 选了「搭乘车辆」却没选上车点时不能悄悄降级成 self：
        // 那会让领队本人的报名变成「不需要车」，而 publish 之后改出行方式就要走集合期协调。
        if (!this.data.tripSelf && !picked) {
          this.setData({ failure: '选择搭乘车辆时，请先指定你的上车点。' })
          return
        }
        participation = {
          personRef: { kind: 'user', userId: profile.id },
          participant: profile.person,
          trip: picked && !this.data.tripSelf ? { mode: 'shared', pickupPointId: picked.id } : { mode: 'self' },
          consent: { dataUse: true, proxyAuthority: false, proxyHome: false },
        }
        this.doPublish(participation, res.revision)
      }).catch(e => this.setData({ failure: api.errorText(e) }))
    } else {
      this.doPublish(null, this.revision, this)
    }
  },

  doPublish(participation, revision) {
    // 这一支此前连在途标记都没有：「确认发布」的按钮 disabled 只看 busy，而 busy 在 persistCurrent
    // 结束时已复位 ⇒ 连点两次就会发出两条 activity.publish。busy 与 busyAt 必须成对写入，
    // 否则残留时既拦不住重复提交、也永远解不开锁（判据单源 J.busyStale）。
    this.setData({ busy: true, busyAt: Date.now(), failure: '' })
    api.dispatchAndSync({ type: 'activity.publish', activityId: this.savedId, participation }, revision, this)
      .then(() => {
        draft.clearDraft(this.draftKey(), 'activity-editor')
        this.setData({ busy: false, publishOpen: false })
        api.toast('活动已发布')
        wx.redirectTo({ url: '/pages/activity/activity?id=' + this.savedId })
      })
      .catch(e => this.setData({ busy: false, failure: api.errorText(e) }))
  },
})
