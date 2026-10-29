// 行程编辑 / 分享弹层（V3「沿途天气」）。
//
// 两件事分开：编辑（名称/出发日/每站第几天+抵达时刻）与分享（协作码）。
// 校验在本地先做一遍（与服务端同源：同日逆序、节点越界、HH:mm），
// 但**不**把"保存成功"演成结果——保存由宿主导入 dispatch，失败原样交回来。
//
// 属性契约（§16.5，R5 实现）：
//   open / mode('edit'|'share') / draft({id,input,isCopy}) / nodes / plan / busy / error
// 事件：bind:confirm（edit）detail { id, input }；bind:share detail { sharedWith }；bind:close
'use strict'
const V3 = require('../../utils/weather-v3')

function dayLabels() {
  const out = []
  for (let i = 1; i <= V3.MAX_PLAN_DAYS; i++) out.push('D' + i)
  return out
}

Component({
  // 只有一处 options：再写一次同名键会覆盖 styleIsolation（模块级铁律 1）
  options: { styleIsolation: 'apply-shared', multipleSlots: false },

  properties: {
    open: { type: Boolean, value: false },
    mode: { type: String, value: 'edit' },
    draft: { type: Object, value: null },
    nodes: { type: Array, value: [] },
    plan: { type: Object, value: null },
    busy: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },

  data: {
    form: { name: '', startDate: '', rows: [] },
    isCopy: false,
    dayLabels: dayLabels(),
    localError: '',
    shareCode: '',
    shareList: [],
    sharedCount: 0,
  },

  observers: {
    'draft.**, nodes.**, plan.**': function () { this.rebuild() },
    open: function (open) {
      if (open) this.setData({ localError: '', shareCode: '' })
      else this.setData({ localError: '', shareCode: '' })
    },
  },

  lifetimes: {
    attached() { this.rebuild() },
  },

  methods: {
    rebuild() {
      const draft = this.data.draft
      if (!draft || !draft.input) return
      const nodes = this.data.nodes || []
      const stops = Array.isArray(draft.input.stops) ? draft.input.stops : []
      const rows = stops.length
        ? stops.map(s => {
          const node = nodes[s.nodeIndex] || {}
          return {
            nodeIndex: s.nodeIndex,
            name: node.name || ('节点 ' + (s.nodeIndex + 1)),
            altitude: Number.isFinite(node.altitude) ? node.altitude : null,
            day: s.day || 1,
            time: s.time || '',
          }
        })
        : nodes.map((n, i) => ({
          nodeIndex: i, name: n.name || ('节点 ' + (i + 1)),
          altitude: Number.isFinite(n.altitude) ? n.altitude : null,
          day: 1, time: i === 0 ? '08:00' : '',
        }))
      const plan = this.data.plan || {}
      this.setData({
        isCopy: !!draft.isCopy,
        form: {
          name: String(draft.input.name || ''),
          startDate: V3.isDate(draft.input.startDate) ? draft.input.startDate : V3.addDays(V3.initialState().date, 2),
          rows,
        },
        shareList: Array.isArray(plan.sharedWith)
          ? plan.sharedWith.map(code => ({ code, short: V3.abbreviateCode(code) }))
          : [],
        sharedCount: Number.isFinite(plan.sharedCount) ? plan.sharedCount : 0,
      })
    },

    onName(e) { this.setData({ 'form.name': e.detail.value, localError: '' }) },
    onStartDate(e) { this.setData({ 'form.startDate': e.detail.value, localError: '' }) },
    onDayChange(e) {
      const i = Number(e.currentTarget.dataset.index)
      const rows = this.data.form.rows.slice()
      if (!rows[i]) return
      rows[i].day = Number(e.detail.value) + 1
      this.setData({ 'form.rows': rows, localError: '' })
    },
    onTimeChange(e) {
      const i = Number(e.currentTarget.dataset.index)
      const rows = this.data.form.rows.slice()
      if (!rows[i]) return
      rows[i].time = e.detail.value || ''
      this.setData({ 'form.rows': rows, localError: '' })
    },
    onTimeClear(e) {
      const i = Number(e.currentTarget.dataset.index)
      const rows = this.data.form.rows.slice()
      if (!rows[i]) return
      rows[i].time = ''
      this.setData({ 'form.rows': rows, localError: '' })
    },

    onConfirm() {
      if (this.data.busy) return
      const draft = this.data.draft || {}
      const input = Object.assign({}, (draft.input || {}), {
        name: String(this.data.form.name || '').trim(),
        startDate: this.data.form.startDate,
        stops: this.data.form.rows.map(r => ({ nodeIndex: r.nodeIndex, day: r.day, time: r.time || '' })),
      })
      if (!input.name) return this.setData({ localError: '请填写计划名称。' })
      if (!V3.isDate(input.startDate)) return this.setData({ localError: '请选择出发日期。' })
      const bad = V3.planTimeViolation(input.stops)
      if (bad) return this.setData({ localError: '第 ' + bad.day + ' 天的抵达时间先于前一站，请调整后再保存。' })
      this.triggerEvent('confirm', { id: draft.id || null, input })
    },

    onShareCode(e) { this.setData({ shareCode: (e.detail.value || '').trim(), localError: '' }) },
    onShareAdd() {
      const code = String(this.data.shareCode || '').trim()
      if (!code) return this.setData({ localError: '先填写对方的协作码（对方在「我的」页顶部可以看到）。' })
      if (this.data.shareList.some(x => x.code === code)) {
        return this.setData({ localError: '这个计划已经共享给这位同行者了。', shareCode: '' })
      }
      const next = this.data.shareList.concat([{ code, short: V3.abbreviateCode(code) }])
      this.setData({ shareList: next, shareCode: '', localError: '' })
      this.emitShare(next)
    },
    onShareRemove(e) {
      const code = e.currentTarget.dataset.code
      const next = this.data.shareList.filter(x => x.code !== code)
      this.setData({ shareList: next, localError: '' })
      this.emitShare(next)
    },
    onShareClear() {
      this.setData({ shareList: [], localError: '' })
      this.emitShare([])
    },
    emitShare(list) {
      if (this.data.busy) return
      this.triggerEvent('share', { sharedWith: list.map(x => x.code) })
    },

    onClose() { this.triggerEvent('close') },
  },
})