/**
 * 时空天相图 · 渲染组件（P4）
 *
 * X=时间、Y=海拔，云层带 + 彩色轨迹 + 标注 + 播放头五层。
 * 几何与配色全部来自 ./layout.js（纯模块，已被 tools/space-time-test.js 钉住），
 * 天相判定来自 utils/sky.js（经 utils/weather-model.js 编排）。
 * 本文件只负责：把几何画到 canvas 上。
 *
 * 两条必须遵守的既有约定：
 *   1. `options` 只能出现一次——写成两个同名字段后者覆盖前者，
 *      `apply-shared` 会被静默丢弃（form-field 与 overlay 曾因此散架）。
 *   2. `type="2d"` canvas 在 node.width 赋值瞬间锁定图层偏移，不随后续回流。
 *      布局落定后必须补测（100ms / 320ms 两次），否则图会浮在正文上。
 */
const L = require('./layout')
const WM = require('../../utils/weather-model')

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    // weather 的 7×24 序列（weather-model 按 series[].d 切日）
    series: { type: Array, value: [] },
    // 逐日摘要（sky.js 的「前日有降水」依据）
    days: { type: Array, value: [] },
    // 路线节点 [{ t:'HH:mm', d:'YYYY-MM-DD', alt, km }]
    nodes: { type: Array, value: [] },
    lat: { type: Number, value: NaN },
    lng: { type: Number, value: NaN },
    // 观景位海拔 / 抵达时刻 / 留宿结束时刻
    obsAlt: { type: Number, value: null },
    arriveT: { type: String, value: '' },
    // 留宿结束时刻（'HH:mm'）。留宿关闭时忽略。
    stayEndH: { type: String, value: '' },
    // 留宿时若宿主没给 stayEndH，用这个兜底
    overnightEndH: { type: String, value: '23:00' },
    // 播放头分钟数。期 5 的漫游滑块会驱动它。
    scrub: { type: Number, value: null },
  },

  data: {
    chartH: L.ROW_H,
    legend: [],
    legendTip: '',
    empty: true,
    // 留宿开关由本组件持有：它是**产品决策**（要不要在山里过夜），不该由代码猜
    overnight: false,
    // 留宿夜间天象（晚霞 / 银河），仅 overnight 时计算
    astro: null,
    // 漫游状态。scrub 作为 property 时（外部受控）优先于 roamValue。
    roamValue: null,
    roamMin: 0,
    roamMax: 24 * 60,
    playing: false,
    // 读数由本组件算（它才有 facts/posAt），经 slot 塞进滑块
    readout: null,
  },

  observers: {
    'series, days, nodes, lat, lng, obsAlt, arriveT, stayEndH, overnightEndH, scrub, roamValue, playing, overnight': function () {
      if (this._ready) this.scheduleDraw()
    },
  },

  lifetimes: {
    ready: function () {
      this._ready = true
      this.scheduleDraw()
    },
    detached: function () {
      clearTimeout(this._sync1)
      clearTimeout(this._sync2)
      // 置空，让「已清理」可被观测（测试与后续 attached 复用都靠这个）
      this._sync1 = null
      this._sync2 = null
      this._ready = false
    },
  },

  methods: {
    // 留宿时的有效结束时刻。留宿关闭 → 空串（trackPoints 就不延伸）。
    effectiveStayEnd() {
      if (!this.data.overnight) return ''
      return this.data.stayEndH || this.data.overnightEndH || '23:00'
    },

    // 播放头取值：外部受控优先，否则用滑块自己的值。
    // **不读 this.data.scrub 之外的数据源**，也避免读同一次 setData 里待更新的值。
    effectiveScrub() {
      if (this.data.scrub != null) return this.data.scrub
      return this.data.roamValue
    },

    // 逐节点天相要按每个节点各自的海拔问一次 sky.js，代价不小。
    // 输入没变就别重算——property observer 在 setData 回流时会连着触发。
    compute() {
      const { series, days, nodes, lat, lng, obsAlt, arriveT } = this.data
      const stayEndH = this.effectiveStayEnd()
      const scrub = this.effectiveScrub()
      const sig = [
        (series && series.length) || 0,
        (days && days.length) || 0,
        (nodes || []).map(n => n.t + '@' + n.alt + '@' + n.d).join(','),
        lat, lng, obsAlt, arriveT, stayEndH, scrub,
      ].join('|')
      if (this._sig === sig && this._chart) return this._chart
      this._sig = sig

      if (!nodes || !nodes.length || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        this._chart = L.build({ points: [], facts: [], width: this.cssW || 320 })
        this._facts = []
        return this._chart
      }

      const facts = WM.annotateRuns(
        WM.nodeFacts({ series, days, nodes, lat, lng }),
      )
      const points = WM.trackPoints({ series, nodes, stayEndH: stayEndH || null }, 10)
      this._facts = facts
      this._chart = L.build({
        points, facts, width: this.cssW || 320,
        obsAlt: obsAlt == null ? null : obsAlt,
        arriveT: arriveT || null,
        scrub: scrub == null ? null : scrub,
      })
      return this._chart
    },

    // 留宿夜间天象。裁 detail 复用 sky.summarize（见 weather-model.nightOutlook 注释），
    // 观察点取**最后一个节点**——留宿时人站在那里看的 就是它。
    computeAstro() {
      if (!this.data.overnight) {
        if (this.data.astro !== null) this.setData({ astro: null })
        return null
      }
      const { series, days, nodes, lat, lng } = this.data
      if (!nodes || !nodes.length) return null
      const node = nodes[nodes.length - 1]
      const out = WM.nightOutlook({ series, days, lat, lng, node })
      const k = out ? out.cards.map(c => c.key + '|' + c.window).join(',') : 'none'
      if (this._astroKey !== k) {
        this._astroKey = k
        this.setData({ astro: out })
      }
      return out
    },

    onToggleOvernight() {
      const on = !this.data.overnight
      this.setData({ overnight: on, astro: null })
      this._astroKey = null
      this.triggerEvent('overnight', { overnight: on, until: on ? this.effectiveStayEnd() : '' })
    },

    // 滑块拖动 / 播放推进
    onRoamChange(e) {
      const d = e.detail || {}
      const v = Number(d.minutes)
      if (!isFinite(v)) return
      this.setData({ roamValue: v })
      // 播放到终点：scrubber 会把 playing 翻回 false，这里不再自行改，
      // 避免父子各改一次导致状态打架
      if (d.finished) this.setData({ playing: false })
      this.triggerEvent('scrub', { minutes: v, t: d.t || '', finished: !!d.finished })
    },

    onRoamToggle(e) {
      const on = !!(e.detail && e.detail.playing)
      this.setData({ playing: on })
      this.triggerEvent('playstate', { playing: on })
    },

    // 图例只列图上真出现过的天相（与 meteogram 同思路：固定列全项像装饰性 tag 云）
    refreshLegend(chart) {
      const present = {}
      if (chart && chart.nodes) {
        chart.nodes.forEach(n => { if (n.key && n.key !== 'none') present[n.key] = true })
      }
      const legend = Object.keys(present)
        .filter(k => L.MARK_STYLE[k])
        .map(k => ({ k, t: L.MARK_STYLE[k].text, c: L.MARK_STYLE[k].color }))
      const tip = legend.length
        ? '横轴时间 · 纵轴海拔 · 括号为主窗口'
        : '该时段没有可标注的天相窗口'
      const empty = !chart || chart.empty
      if (JSON.stringify(legend) !== JSON.stringify(this.data.legend)
        || tip !== this.data.legendTip || empty !== this.data.empty) {
        this.setData({ legend, legendTip: tip, empty })
      }
    },

    scheduleDraw() {
      this.initCanvas()
      this.scheduleSync()
    },

    // 见文件头约定 2：布局落定后补测两次尺寸，触发图层重新对齐
    scheduleSync() {
      clearTimeout(this._sync1)
      clearTimeout(this._sync2)
      const again = () => {
        // 定时器触发时页面可能已经卸了数据；nodes 未定义时直接跳过，
        // 别在 setTimeout 里抛 "reading length of undefined"
        if (!this._ready) return
        if (!this.data || !Array.isArray(this.data.nodes) || !this.data.nodes.length) return
        this.initCanvas()
      }
      this._sync1 = setTimeout(again, 100)
      this._sync2 = setTimeout(again, 320)
    },

    initCanvas() {
      wx.createSelectorQuery().in(this).select('#stCanvas')
        .fields({ node: true, size: true }).exec(res => {
          const info = res && res[0]
          if (!info || !info.node) return
          // 还没排版完成时量到 0：这一帧不画，等补测
          if (!info.width || !info.height) return
          this.canvas = info.node
          this.ctx = info.node.getContext('2d')
          const dpr = (wx.getSystemInfoSync() || {}).pixelRatio || 2
          const cssW = info.width
          const cssH = info.height
          // 宽度变了要重设 node.width，图层才会按新宽度重新对齐
          if (this.canvas.width !== Math.round(cssW * dpr)) {
            info.node.width = Math.round(cssW * dpr)
          }
          if (this.canvas.height !== Math.round(cssH * dpr)) {
            info.node.height = Math.round(cssH * dpr)
          }
          this.cssW = cssW
          this.cssH = cssH
          this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          const chart = this.compute()
          this.refreshLegend(chart)
          this.computeAstro()
          this.syncRoam(chart)
          this.draw(chart)
        })
    },

    // 滑块量程 + 读数。首屏把播放头放在**起点**（抵达点已有虚线与标签标记，
    // 播放头再压上去是噪声，且「走一遍」应当从头开始）。
    syncRoam(chart) {
      if (!chart || chart.empty) {
        if (this.data.readout !== null) this.setData({ readout: null })
        return
      }
      const sc = chart.scale
      const cur = this.effectiveScrub()
      const roamValue = cur == null ? sc.tMin : cur
      const readout = L.readoutAt(chart, roamValue)
      const patch = {}
      if (this.data.roamMin !== sc.tMin) patch.roamMin = sc.tMin
      if (this.data.roamMax !== sc.tMax) patch.roamMax = sc.tMax
      if (this.data.roamValue !== roamValue) patch.roamValue = roamValue
      const rk = readout ? readout.t + '|' + readout.nodeT + '|' + readout.alt : ''
      if (this._readoutKey !== rk) {
        this._readoutKey = rk
        patch.readout = readout
      }
      if (Object.keys(patch).length) this.setData(patch)
    },

    draw(chart) {
      const ctx = this.ctx
      if (!ctx) return
      const W = this.cssW
      const H = this.cssH
      ctx.clearRect(0, 0, W, H)
      if (!chart || chart.empty) return

      this.drawGrid(ctx, chart, W, H)
      this.drawClouds(ctx, chart)
      this.drawTerrain(ctx, chart)
      this.drawRoute(ctx, chart)
      this.drawNodes(ctx, chart)
      this.drawRefs(ctx, chart)
      this.drawPlayhead(ctx, chart)
    },

    // 网格 + 坐标轴刻度
    drawGrid(ctx, chart, W, H) {
      const box = chart.box
      const sc = chart.scale
      ctx.lineWidth = 1
      ctx.font = '9px sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'right'

      sc.yTicks.forEach(t => {
        const y = Math.round(t.y) + 0.5
        ctx.strokeStyle = '#E4E8E1'
        ctx.beginPath()
        ctx.moveTo(box.x0, y)
        ctx.lineTo(box.x1, y)
        ctx.stroke()
        ctx.fillStyle = '#5F6E66'
        ctx.fillText(String(t.v), box.x0 - 4, y)
      })
      // 单位只标一次
      ctx.textAlign = 'left'
      ctx.fillStyle = '#5F6E66'
      ctx.fillText('m', 2, box.y0 - 7)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      sc.xTicks.forEach(t => {
        ctx.strokeStyle = '#E4E8E1'
        ctx.beginPath()
        ctx.moveTo(Math.round(t.x) + 0.5, box.y0)
        ctx.lineTo(Math.round(t.x) + 0.5, box.y1)
        ctx.stroke()
        ctx.fillStyle = '#5F6E66'
        ctx.fillText(t.label, t.x, box.y1 + 4)
      })
    },

    // 云层带：底~顶 区间。透明度按 cover 给，但**色相仍来自 MARK_STYLE**
    drawClouds(ctx, chart) {
      const clouds = chart.clouds || []
      clouds.forEach(c => {
        const y = Math.min(c.yTop, c.yBase)
        const h = Math.max(1, Math.abs(c.yBase - c.yTop))
        ctx.fillStyle = L.withAlpha(L.MARK_STYLE.cloudSea.color, 0.10 + 0.14 * (c.cover || 0) / 100)
        ctx.fillRect(c.x1, y, Math.max(1, c.x2 - c.x1), h)
        ctx.strokeStyle = L.withAlpha(L.MARK_STYLE.cloudSea.color, 0.45)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(c.x1, Math.round(c.yBase) + 0.5)
        ctx.lineTo(c.x2, Math.round(c.yBase) + 0.5)
        ctx.stroke()
      })
    },

    // 地形剖面：轨迹下方填充
    drawTerrain(ctx, chart) {
      const t = chart.terrain || []
      if (!t.length) return
      const box = chart.box
      ctx.beginPath()
      ctx.moveTo(t[0].x, box.y1)
      t.forEach(p => ctx.lineTo(p.x, p.y))
      ctx.lineTo(t[t.length - 1].x, box.y1)
      ctx.closePath()
      ctx.fillStyle = L.withAlpha(L.NO_COLOR, 0.20)
      ctx.fill()
    },

    // 轨迹：逐段渐变（12 节点 = 11 段），端点色由节点天相决定
    drawRoute(ctx, chart) {
      const segs = chart.segments || []
      ctx.lineCap = 'round'
      segs.forEach(s => {
        if (s.from === s.to) {
          ctx.strokeStyle = s.from
          ctx.lineWidth = s.w
          ctx.beginPath()
          ctx.moveTo(s.x1, s.y1)
          ctx.lineTo(s.x2, s.y2)
          ctx.stroke()
          return
        }
        const g = ctx.createLinearGradient(s.x1, s.y1, s.x2, s.y2)
        g.addColorStop(0, s.from)
        g.addColorStop(1, s.to)
        ctx.strokeStyle = g
        ctx.lineWidth = s.w
        ctx.beginPath()
        ctx.moveTo(s.x1, s.y1)
        ctx.lineTo(s.x2, s.y2)
        ctx.stroke()
      })
    },

    // 节点圆点；孤立点（方案 b）加外环，视觉上与主窗口区分
    drawNodes(ctx, chart) {
      const nodes = chart.nodes || []
      nodes.forEach(n => {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = n.color
        ctx.fill()
        ctx.lineWidth = 1
        ctx.strokeStyle = '#FFFFFF'
        ctx.stroke()
        if (n.isolated) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2)
          ctx.strokeStyle = n.color
          ctx.stroke()
        }
      })
    },

    // 标注层：主窗口括号、观景位参考线、抵达竖线与净空
    drawRefs(ctx, chart) {
      const box = chart.box
      ctx.font = '9px sans-serif'
      ctx.textBaseline = 'bottom'

      const mw = chart.mainWindow
      if (mw) {
        ctx.strokeStyle = mw.color
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(mw.x1, mw.y + 6)
        ctx.lineTo(mw.x1, mw.y)
        ctx.lineTo(mw.x2, mw.y)
        ctx.lineTo(mw.x2, mw.y + 6)
        ctx.stroke()
        // 标签夹在括号内，不越出绘图区
        ctx.textAlign = 'center'
        ctx.fillStyle = mw.color
        const label = mw.text + ' ' + mw.count + '节点'
        const maxW = mw.x2 - mw.x1
        if (L.textWidth(label, 9) < maxW) {
          ctx.fillText(label, (mw.x1 + mw.x2) / 2, mw.y - 1)
        }
      }

      const obs = chart.obs
      if (obs) {
        ctx.save()
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = L.withAlpha(L.MARK_STYLE.galaxy.color, 0.5)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(box.x0, Math.round(obs.y) + 0.5)
        ctx.lineTo(box.x1, Math.round(obs.y) + 0.5)
        ctx.stroke()
        ctx.restore()
        // 标签靠左：右侧要留给抵达标签
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = L.MARK_STYLE.galaxy.color
        ctx.fillText(obs.label, obs.labelX, obs.y - 2)
      }

      const ar = chart.arrival
      if (ar) {
        ctx.save()
        ctx.setLineDash([2, 3])
        ctx.strokeStyle = L.withAlpha(L.NO_COLOR, 0.8)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(Math.round(ar.x) + 0.5, box.y0)
        ctx.lineTo(Math.round(ar.x) + 0.5, box.y1)
        ctx.stroke()
        ctx.restore()

        ctx.textAlign = 'right'
        ctx.textBaseline = 'top'
        ctx.fillStyle = '#5F6E66'
        ctx.fillText(ar.label, Math.min(ar.x, box.x1) - 2, box.y0 + 1)
        if (ar.clearanceText) {
          ctx.fillStyle = L.MARK_STYLE.cloudSea.color
          ctx.fillText(ar.clearanceText, Math.min(ar.x, box.x1) - 2, box.y0 + 12)
        }
      }
    },

    // 播放头：竖线 + 当前点 + 时刻。期 5 接滑块后由外部 scrub 驱动。
    drawPlayhead(ctx, chart) {
      const ph = chart.playhead
      if (!ph) return
      const box = chart.box
      ctx.save()
      ctx.strokeStyle = L.MARK_STYLE.galaxy.color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(Math.round(ph.x) + 0.5, box.y0)
      ctx.lineTo(Math.round(ph.x) + 0.5, box.y1)
      ctx.stroke()
      ctx.restore()

      ctx.beginPath()
      ctx.arc(ph.x, ph.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = L.MARK_STYLE.galaxy.color
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#FFFFFF'
      ctx.stroke()

      ctx.font = '9px sans-serif'
      ctx.textBaseline = 'bottom'
      ctx.textAlign = ph.x > box.x1 - 30 ? 'right' : 'left'
      ctx.fillStyle = L.MARK_STYLE.galaxy.color
      ctx.fillText(ph.t, ph.x + (ph.x > box.x1 - 30 ? -5 : 5), box.y1 - 3)
    },
  },
})
