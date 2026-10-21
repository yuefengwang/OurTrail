'use strict'
const RP = require('../../utils/route-profile')

Component({
  // 组件内用到 app.wxss 的 .small/.muted/.tabular；CSS 变量靠继承，类选择器需要 apply-shared。
  options: { styleIsolation: 'apply-shared' },
  properties: {
    track: { type: Array, value: [] },
    points: { type: Array, value: [] },
    title: { type: String, value: '' },
  },
  data: {
    mode: 'empty',
    src: '',
    rangeText: '',
    distanceText: '',
    note: '',
    emptyText: '',
  },
  observers: {
    'track, points': function (track, points) {
      this.renderProfile(track, points)
    },
  },
  lifetimes: {
    attached() {
      this.renderProfile(this.data.track, this.data.points)
    },
  },
  methods: {
    renderProfile(track, points) {
      const p = RP.buildProfile({ track: track || [], points: points || [] })
      if (!p.svg) {
        const empty = {
          'no-elevation': '这条路线的轨迹和节点都没有可用高程，暂时画不出剖面。导入带高程的 GPX 后就能看到。',
          'no-geometry': '还没有路线坐标，暂时画不出剖面。',
          'not-enough-points': '高程点不足两个，暂时画不出剖面。',
        }
        this.setData({
          mode: p.mode,
          src: '',
          rangeText: '',
          distanceText: '',
          note: '',
          emptyText: empty[p.reason] || '暂时画不出剖面。',
        })
        return
      }
      const range = p.minEle === p.maxEle
        ? p.minEle + ' m'
        : p.minEle + '–' + p.maxEle + ' m'
      const note = p.mode === 'nodes'
        ? '节点高程，非连续剖面；点与点之间按直线距离。'
        : '按轨迹采样点绘制。'
      this.setData({
        mode: p.mode,
        src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(p.svg),
        rangeText: range,
        distanceText: p.distanceKm.toFixed(1) + ' km · ' + p.distanceLabel,
        note,
        emptyText: '',
      })
    },
  },
})
