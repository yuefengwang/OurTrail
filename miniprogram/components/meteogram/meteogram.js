// meteogram：天气时间坐标图（横向滚动 7×24 小时）
// 自绘 canvas 2d，行为对齐 meteoblue 的 meteogram：上面客观指标（温度线 / 降水双柱 / 三层云量 /
// 天气简字），下面时间轴；夜间用底色区分；顶部一行天相窗口标记（云海/星空/银河/彩虹/晨昏光）。
//
// 设计约束（照 ourtrail-ui skill）：
// - 组件必须声明 options.styleIsolation = 'apply-shared'，否则 app.wxss 的类选择器不注入。
// - 色值全部取设计系统 token，不发明新色。
// - canvas 是原生组件：圆角在低版本基础库可能失效，可接受降级。
'use strict'

// 几何与天相标记配色放在 layout.js：让"刻度栏装不下标签""两行刻度抢位"这类问题
// 能被测试直接断言，也让全屏横屏页可以复用同一套几何。
const {
  HOUR_W, PAD_L, PAD_R, ROW, CHART_H, AXIS_DAY_DY, AXIS_HOUR_DY,
  MARK_STYLE, MARK_LANES, LEGEND_KEYS,
  MARK_LANE_H, MARK_LANE_GAP, MARK_FONT_PX, inkOn,
} = require('./layout')

const C = {
  night: '#F0F1EC',
  day: '#FFFFFF',
  grid: '#E4E8E1',
  axisText: '#5F6E66',
  // 温度线用中性墨色而不是红：红 #B43D3B 与天相标记「光染」是**同一个色值**，
  // 图例里的红色分不清是温度还是光染。中性墨色也让"客观指标"这一层不与语义色抢注意力。
  temp: '#202A26', // = --ink
  tempFill: 'rgba(32,42,38,0.08)',
  rain: '#346583',
  showers: '#2E8B8B',
  cloudLow: '#346583',   // 云量色用**实色**，浓淡交给 ctx.globalAlpha：
  cloudMid: '#6C7C93',   // 原来颜色自带 0.6–0.75 alpha，再叠一层 alpha 是乘法关系，
  cloudHigh: '#8C9791',  // 低云量时几乎完全看不见。
  selBand: 'rgba(22,62,53,0.12)',
  selEdge: 'rgba(22,62,53,0.35)',
  now: '#163E35',
  warn: '#8C5A12',
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function hourKey(d, t) { return d + 'T' + t }

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    // 逐小时序列：[{ d, t, temp, pop, precip, showers, code, cloud:{low,mid,high}, band }]
    series: { type: Array, value: [] },
    // 天相标记：{ 'YYYY-MM-DDTHH:mm': ['star', ...] }
    marks: { type: Object, value: {} },
    // 夜间小时集合：{ 'YYYY-MM-DDTHH:mm': true }
    night: { type: Object, value: {} },
    // 每日的选中态：{ 'YYYY-MM-DD': true }
    selectedDates: { type: Object, value: {} },
    // 天数（用于日分隔线标签）
    dayCount: { type: Number, value: 7 },
  },

  data: {
    chartW: 300,
    chartH: CHART_H,
    // 图例**动态**生成：只列图上真出现过的窗口。原来固定列 7 项，图上往往只有 1–2 种，
    // 看着像装饰性 tag 云而不是图例。
    legend: [],
    legendTip: '横滑看全程 · 点图上某天切换',
  },

  observers: {
    'series, marks, night, selectedDates': function () {
      if (this._ready) this.scheduleDraw()
    },
  },

  lifetimes: {
    ready: function () {
      this._ready = true
      this.scheduleDraw()
    },
  },

  methods: {
    scheduleDraw() {
      this.refreshLegend()
      const n = this.data.series.length
      const w = Math.max(280, PAD_L + n * HOUR_W + PAD_R)
      if (w !== this.data.chartW) {
        this.setData({ chartW: w, chartH: CHART_H }, () => this.initCanvas())
        return
      }
      this.initCanvas()
    },

    // 只列图上真出现过的天相窗口；一个都没有时把提示换成说明，避免留一行空图例
    refreshLegend() {
      const marks = this.data.marks || {}
      const present = {}
      Object.keys(marks).forEach(k => (marks[k] || []).forEach(m => { present[m] = true }))
      const legend = LEGEND_KEYS.filter(k => present[k]).map(k => ({
        k, t: MARK_STYLE[k].text, c: MARK_STYLE[k].color,
      }))
      const legendTip = legend.length ? '横滑看全程 · 点图上某天切换' : '该时段没有可标注的天相窗口'
      if (JSON.stringify(legend) !== JSON.stringify(this.data.legend) || legendTip !== this.data.legendTip) {
        this.setData({ legend, legendTip })
      }
    },

    initCanvas() {
      wx.createSelectorQuery().in(this).select('#meteo').fields({ node: true, size: true }).exec(res => {
        const info = res && res[0]
        if (!info || !info.node) return
        this.canvas = info.node
        this.ctx = info.node.getContext('2d')
        const dpr = (wx.getSystemInfoSync() || {}).pixelRatio || 2
        info.node.width = Math.round(info.width * dpr)
        info.node.height = Math.round(info.height * dpr)
        this.cssW = info.width
        this.cssH = info.height
        this.ctx.scale(dpr, dpr)
        this.draw()
      })
    },

    draw() {
      const ctx = this.ctx
      if (!ctx) return
      const series = this.data.series
      const W = this.cssW
      const H = this.cssH
      ctx.clearRect(0, 0, W, H)
      if (!series.length) return

      const x = i => PAD_L + i * HOUR_W
      const cx = i => x(i) + HOUR_W / 2

      // 1) 底色：夜间底 + 所选日高亮带。
      // 只铺到时间轴顶：原来铺满整高，把时间轴也染灰，轴文字底色不统一。
      const BODY_H = ROW.axis.y
      for (let i = 0; i < series.length; i++) {
        const h = series[i]
        ctx.fillStyle = this.data.night[hourKey(h.d, h.t)] ? C.night : C.day
        ctx.fillRect(x(i), 0, HOUR_W, BODY_H)
        if (this.data.selectedDates[h.d]) {
          ctx.fillStyle = C.selBand
          ctx.fillRect(x(i), 0, HOUR_W, BODY_H)
        }
      }
      // 所选日顶部色条：淡底在夜间灰底上仍不明显，给一条实条做明确锚点
      series.forEach((h, i) => {
        if (!this.data.selectedDates[h.d]) return
        ctx.fillStyle = C.now
        ctx.fillRect(x(i), 0, HOUR_W, 2)
      })
      // 2) 日分隔线
      ctx.strokeStyle = C.selEdge
      ctx.lineWidth = 1
      let prevDate = ''
      for (let i = 0; i < series.length; i++) {
        if (series[i].d !== prevDate) {
          const px = Math.round(x(i)) + 0.5
          ctx.beginPath()
          ctx.moveTo(px, 0)
          ctx.lineTo(px, ROW.axis.y + ROW.axis.h)
          ctx.stroke()
          prevDate = series[i].d
        }
      }

      this.drawMarks(ctx, series, x)
      this.drawTemp(ctx, series, x, cx)
      this.drawRain(ctx, series, x, cx)
      this.drawCloud(ctx, series, x, cx)
      this.drawCode(ctx, series, cx)
      this.drawAxis(ctx, series, x, cx)
    },

    // 天相窗口：按泳道分行画，同泳道内才叠放
    drawMarks(ctx, series, x) {
      const marks = this.data.marks || {}
      MARK_LANES.forEach((lane, li) => {
        const keys = {}
        lane.forEach(k => { keys[k] = [] })
        series.forEach((h, i) => {
          const list = marks[hourKey(h.d, h.t)] || []
          lane.forEach(k => { if (list.indexOf(k) !== -1) keys[k].push(i) })
        })
        const ly = ROW.marks.y + li * (MARK_LANE_H + MARK_LANE_GAP)
        lane.forEach(k => {
          const idx = keys[k]
          if (!idx.length) return
          const st = MARK_STYLE[k]
          let s = 0
          for (let j = 0; j < idx.length; j++) {
            const isBreak = j > 0 && idx[j] !== idx[j - 1] + 1
            if (isBreak) { this.markRect(ctx, x(s), ly, (idx[j - 1] - s + 1) * HOUR_W, st); s = idx[j] }
          }
          this.markRect(ctx, x(s), ly, (idx[idx.length - 1] - s + 1) * HOUR_W, st)
        })
      })
    },

    markRect(ctx, px, py, w, st) {
      const r = Math.min(3, w / 2)
      ctx.fillStyle = st.color
      this.roundRect(ctx, px + 1, py, Math.max(3, w - 2), MARK_LANE_H, r)
      ctx.fill()
      // 标签按色块亮度选墨色：浅色块（黄金等）上的白字一直看不清
      if (w >= 30) {
        ctx.fillStyle = inkOn(st.color)
        ctx.font = '600 ' + MARK_FONT_PX + 'px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(st.text, px + w / 2, py + MARK_LANE_H / 2 + 0.5)
      }
    },

    roundRect(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + rr, y)
      ctx.arcTo(x + w, y, x + w, y + h, rr)
      ctx.arcTo(x + w, y + h, x, y + h, rr)
      ctx.arcTo(x, y + h, x, y, rr)
      ctx.arcTo(x, y, x + w, y, rr)
      ctx.closePath()
    },

    // 温度线 + 面积。左栏给三档刻度、图上给三条网格线。
    // 不再逐 3 小时写数字：没有网格线时那些数字无从对位，纯属噪声，
    // 而精确到小时的数值下面「逐小时数据」已经给了。
    drawTemp(ctx, series, x, cx) {
      const temps = series.map(h => (typeof h.temp === 'number' ? h.temp : null))
      const valid = temps.filter(t => t != null)
      if (!valid.length) return
      let lo = Math.min.apply(null, valid)
      let hi = Math.max.apply(null, valid)
      if (hi - lo < 4) { const mid2 = (hi + lo) / 2; lo = mid2 - 2; hi = mid2 + 2 }
      const pad = (hi - lo) * 0.12
      lo -= pad
      hi += pad
      const mid = (hi + lo) / 2
      const top = ROW.temp.y + 8
      const bot = ROW.temp.y + ROW.temp.h - 6
      const ty = t => bot - ((t - lo) / (hi - lo)) * (bot - top)

      // 网格线：高 / 中 / 低三档，与左栏刻度一一对应
      ctx.strokeStyle = C.grid
      ctx.lineWidth = 1
      ;[top, (top + bot) / 2, bot].forEach(py => {
        ctx.beginPath()
        ctx.moveTo(PAD_L, Math.round(py) + 0.5)
        ctx.lineTo(this.cssW - PAD_R, Math.round(py) + 0.5)
        ctx.stroke()
      })

      // 面积
      ctx.beginPath()
      let started = false
      series.forEach((h, i) => {
        if (temps[i] == null) return
        if (!started) { ctx.moveTo(cx(i), bot); started = true }
        ctx.lineTo(cx(i), ty(temps[i]))
      })
      const lastIdx = temps.reduce((acc, t, i) => (t != null ? i : acc), 0)
      ctx.lineTo(cx(lastIdx), bot)
      ctx.closePath()
      ctx.fillStyle = C.tempFill
      ctx.fill()
      // 线
      ctx.beginPath()
      started = false
      series.forEach((h, i) => {
        if (temps[i] == null) return
        if (!started) { ctx.moveTo(cx(i), ty(temps[i])); started = true } else ctx.lineTo(cx(i), ty(temps[i]))
      })
      ctx.strokeStyle = C.temp
      ctx.lineWidth = 1.5
      ctx.stroke()

      // 左栏三档刻度（带°，让刻度栏一眼看出这是温度）
      // textBaseline 必须显式指定：markRect 里用了 middle，不复位会把刻度整体抬高半个字高
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(Math.round(hi) + '°', PAD_L - 4, top + 3)
      ctx.fillText(Math.round(mid) + '°', PAD_L - 4, (top + bot) / 2 + 3)
      ctx.fillText(Math.round(lo) + '°', PAD_L - 4, bot + 3)
    },

    // 降水双柱：precipitation（蓝）+ showers（青），按 pop 定不透明度
    drawRain(ctx, series, x, cx) {
      const maxV = Math.max(
        0.1,
        Math.max.apply(null, series.map(h => Math.max(numOr(h.precip, 0), numOr(h.showers, 0))))
      )
      const bot = ROW.rain.y + ROW.rain.h
      series.forEach((h, i) => {
        const p = numOr(h.precip, 0)
        const s = numOr(h.showers, 0)
        const pop = numOr(h.pop, 0)
        if (p > 0) {
          const bh = Math.max(1, (p / maxV) * (ROW.rain.h - 4))
          ctx.fillStyle = C.rain
          ctx.globalAlpha = 0.45 + 0.55 * (pop / 100)
          ctx.fillRect(cx(i) - 3, bot - bh, 3, bh)
        }
        if (s > 0) {
          const bh = Math.max(1, (s / maxV) * (ROW.rain.h - 4))
          ctx.fillStyle = C.showers
          ctx.globalAlpha = 0.45 + 0.55 * (pop / 100)
          ctx.fillRect(cx(i) + 1, bot - bh, 3, bh)
        }
        ctx.globalAlpha = 1
      })
      ctx.strokeStyle = C.grid
      ctx.beginPath()
      const by = Math.round(bot) + 0.5
      ctx.moveTo(PAD_L, by)
      ctx.lineTo(this.cssW - PAD_R, by)
      ctx.stroke()
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(maxV.toFixed(1), PAD_L - 4, ROW.rain.y + 8)
      ctx.textAlign = 'left'
      ctx.fillText('mm/h', 2, ROW.rain.y + 8)
    },

    // 三层云量：低/中/高三条连续色带（相邻小时必须无缝），透明度随云量；
    // 成层云带（band）用底部实心标记。
    drawCloud(ctx, series, x, cx) {
      const y = ROW.cloud.y
      const hEach = 5
      series.forEach((h, i) => {
        const c = h.cloud || {}
        const layers = [
          { v: numOr(c.high, 0), color: C.cloudHigh },
          { v: numOr(c.mid, 0), color: C.cloudMid },
          { v: numOr(c.low, 0), color: C.cloudLow },
        ]
        layers.forEach((L, k) => {
          ctx.fillStyle = L.color
          ctx.globalAlpha = 0.10 + 0.90 * (Math.max(0, Math.min(100, L.v)) / 100)
          // 按**整列**画（x(i) 起、宽 HOUR_W），相邻小时才接得上。
          // 原来用 cx(i) 居中 + 宽 8：每列只覆盖 36%，168 列 × 3 层 = 504 个孤立小方块，
          // 看着像图片加载失败而不是云量。
          ctx.fillRect(x(i), y + k * (hEach + 1), HOUR_W, hEach)
        })
        ctx.globalAlpha = 1
        if (h.band && h.band.cover >= 80) {
          ctx.fillStyle = C.cloudLow
          ctx.fillRect(x(i), y + 3 * (hEach + 1) - 1, HOUR_W, 2)
        }
      })
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText('高/中/低', PAD_L - 4, y + 8)
      ctx.textBaseline = 'alphabetic'
    },

    // 天气简字：每 3 小时标一次（WMO code → 简字，与 format.js weatherPhrase 同源）
    drawCode(ctx, series, cx) {
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let last = ''
      series.forEach((h, i) => {
        if (i % 3 !== 0) return
        const label = PHRASE(numOr(h.code, 0))
        if (label === last) return
        last = label
        ctx.fillStyle = h.pop >= 50 || numOr(h.code, 0) >= 95 ? C.warn : C.axisText
        ctx.fillText(label, cx(i), ROW.code.y + 8)
      })
    },

    // 时间轴：上行日期（周几 M/D），下行每 6 小时刻度，两行分开写
    drawAxis(ctx, series, x, cx) {
      const y = ROW.axis.y
      const baseY = y + ROW.axis.h
      // 底部基准线：给整张图一条明确的地板，也把图与下方图例分开
      ctx.strokeStyle = C.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD_L, Math.round(baseY) - 0.5)
      ctx.lineTo(this.cssW - PAD_R, Math.round(baseY) - 0.5)
      ctx.stroke()

      let prevDate = ''
      series.forEach((h, i) => {
        if (h.d !== prevDate) {
          prevDate = h.d
          const md = h.d.slice(5, 10).split('-')
          // 日期行：周几与日期并成一条，独占一行，不再与下行小时刻度抢同一个 x/y
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.font = '600 10px sans-serif'
          ctx.fillStyle = C.now
          const wd = '周' + WEEK[new Date(h.d + 'T12:00:00+08:00').getUTCDay()]
          ctx.fillText(wd + ' ' + Number(md[0]) + '/' + Number(md[1]), x(i) + 3, y + AXIS_DAY_DY)
        }
        // 小时行
        if (Number(h.t.slice(0, 2)) % 6 === 0) {
          ctx.font = '9px sans-serif'
          ctx.fillStyle = C.axisText
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText(h.t, x(i) + 2, y + AXIS_HOUR_DY)
        }
      })
    },

    // 点击定位到某小时 → 通知页面切日
    onTap(e) {
      const px = (e.detail && Number.isFinite(e.detail.x) ? e.detail.x
        : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].x : NaN))
      if (!Number.isFinite(px)) return
      const i = Math.floor((px - PAD_L) / HOUR_W)
      const h = this.data.series[i]
      if (!h) return
      this.triggerEvent('pickhour', { date: h.d, t: h.t })
    },
  },
})

function numOr(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

// WMO code → 简字（与 utils/format.js weatherPhrase 同源，canvas 里无法 require，故并列维护）
const PHRASES = [
  { max: 0, text: '晴' }, { max: 2, text: '多云' }, { max: 3, text: '阴' }, { max: 48, text: '雾' },
  { max: 57, text: '毛毛雨' }, { max: 67, text: '雨' }, { max: 77, text: '雪' }, { max: 82, text: '阵雨' },
  { max: 86, text: '阵雪' }, { max: 99, text: '雷暴' },
]
function PHRASE(code) {
  const item = PHRASES.filter(p => code <= p.max).pop()
  return item ? item.text : '—'
}
