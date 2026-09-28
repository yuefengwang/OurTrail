// meteogram：天气时间坐标图（横向滚动 7×24 小时）
// 自绘 canvas 2d，行为对齐 meteoblue 的 meteogram：上面客观指标（温度线 / 降水双柱 / 三层云量 /
// 天气简字），下面时间轴；夜间用底色区分；顶部一行天相窗口标记（云海/星空/银河/彩虹/晨昏光）。
//
// 设计约束（照 ourtrail-ui skill）：
// - 组件必须声明 options.styleIsolation = 'apply-shared'，否则 app.wxss 的类选择器不注入。
// - 色值全部取设计系统 token，不发明新色。
// - canvas 是原生组件：圆角在低版本基础库可能失效，可接受降级。
'use strict'

const HOUR_W = 22 // 每小时列宽
const CHART_H = 196
const PAD_L = 34
const PAD_R = 8

// 行布局（自上而下）
const ROW = {
  marks: { y: 4, h: 20 },
  temp: { y: 28, h: 46 },
  rain: { y: 76, h: 32 },
  cloud: { y: 110, h: 18 },
  code: { y: 130, h: 18 },
  axis: { y: 150, h: 26 },
}

// 天相窗口配色（语义色 + 主色派生），key 与 sky.js 的 hourMarks 一致
const MARK_STYLE = {
  cloudSea: { color: '#346583', text: '云海' },
  star: { color: '#2D533F', text: '星空' },
  galaxy: { color: '#163E35', text: '银河' },
  rainbow: { color: '#8C5A12', text: '彩虹' },
  alpenglow: { color: '#B43D3B', text: '光染' },
  golden: { color: '#D6A33C', text: '黄金' },
  blueHour: { color: '#6C7C93', text: '蓝调' },
  inCloud: { color: '#8C9791', text: '入云' },
}
// 绘制顺序：入云是"减分项"放最底层，晨昏光/云海等放上层
const MARK_ORDER = ['inCloud', 'cloudSea', 'alpenglow', 'golden', 'blueHour', 'rainbow', 'star', 'galaxy']

const C = {
  night: '#F0F1EC',
  day: '#FFFFFF',
  grid: '#E4E8E1',
  axisText: '#5F6E66',
  temp: '#B43D3B',
  tempFill: 'rgba(180,61,59,0.10)',
  rain: '#346583',
  showers: '#2E8B8B',
  cloudLow: 'rgba(52,101,131,0.75)',
  cloudMid: 'rgba(108,124,147,0.7)',
  cloudHigh: 'rgba(140,151,145,0.6)',
  selBand: 'rgba(22,62,53,0.05)',
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
    // 图例：与 MARK_STYLE 同源，只列出徒步者真正会追的窗口（入云不单列，它在图上是"变差"信号）
    legend: [
      { k: 'cloudSea', t: '云海', c: MARK_STYLE.cloudSea.color },
      { k: 'alpenglow', t: '光染', c: MARK_STYLE.alpenglow.color },
      { k: 'rainbow', t: '彩虹', c: MARK_STYLE.rainbow.color },
      { k: 'star', t: '星空', c: MARK_STYLE.star.color },
      { k: 'galaxy', t: '银河', c: MARK_STYLE.galaxy.color },
      { k: 'golden', t: '黄金', c: MARK_STYLE.golden.color },
      { k: 'blueHour', t: '蓝调', c: MARK_STYLE.blueHour.color },
    ],
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
      const n = this.data.series.length
      const w = Math.max(280, PAD_L + n * HOUR_W + PAD_R)
      if (w !== this.data.chartW) {
        this.setData({ chartW: w, chartH: CHART_H }, () => this.initCanvas())
        return
      }
      this.initCanvas()
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

      // 1) 底色：夜间底 + 所选日高亮带
      for (let i = 0; i < series.length; i++) {
        const h = series[i]
        ctx.fillStyle = this.data.night[hourKey(h.d, h.t)] ? C.night : C.day
        ctx.fillRect(x(i), 0, HOUR_W, H)
        if (this.data.selectedDates[h.d]) {
          ctx.fillStyle = C.selBand
          ctx.fillRect(x(i), 0, HOUR_W, H)
        }
      }
      // 2) 日分隔线
      ctx.strokeStyle = C.selEdge
      ctx.lineWidth = 1
      let prevDate = ''
      for (let i = 0; i < series.length; i++) {
        if (series[i].d !== prevDate) {
          const px = Math.round(x(i)) + 0.5
          ctx.beginPath()
          ctx.moveTo(px, 0)
          ctx.lineTo(px, ROW.axis.y + ROW.axis.h - 8)
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

    // 天相窗口：把连续同 key 的小时合并成一段圆角条并写标签
    drawMarks(ctx, series, x) {
      const marks = this.data.marks || {}
      const keys = {}
      MARK_ORDER.forEach(k => { keys[k] = [] })
      series.forEach((h, i) => {
        const list = marks[hourKey(h.d, h.t)] || []
        MARK_ORDER.forEach(k => { if (list.indexOf(k) !== -1) keys[k].push(i) })
      })
      ctx.font = '600 9px sans-serif'
      ctx.textBaseline = 'middle'
      MARK_ORDER.forEach(k => {
        const idx = keys[k]
        if (!idx.length) return
        const st = MARK_STYLE[k]
        let s = 0
        for (let j = 0; j < idx.length; j++) {
          const isBreak = j > 0 && idx[j] !== idx[j - 1] + 1
          if (isBreak) { this.markRect(ctx, x(s), ROW.marks.y, (idx[j - 1] - s + 1) * HOUR_W, st); s = idx[j] }
        }
        this.markRect(ctx, x(s), ROW.marks.y, (idx[idx.length - 1] - s + 1) * HOUR_W, st)
      })
    },

    markRect(ctx, px, py, w, st) {
      const r = Math.min(4, w / 2)
      ctx.fillStyle = st.color
      this.roundRect(ctx, px + 1, py, Math.max(3, w - 2), ROW.marks.h, r)
      ctx.fill()
      if (w >= 34) {
        ctx.fillStyle = '#FFFFFF'
        ctx.textAlign = 'center'
        ctx.fillText(st.text, px + w / 2, py + ROW.marks.h / 2 + 0.5)
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

    // 温度线 + 面积；每 3 小时标数值
    drawTemp(ctx, series, x, cx) {
      const temps = series.map(h => (typeof h.temp === 'number' ? h.temp : null))
      const valid = temps.filter(t => t != null)
      if (!valid.length) return
      let lo = Math.min.apply(null, valid)
      let hi = Math.max.apply(null, valid)
      if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2 }
      const pad = (hi - lo) * 0.12
      lo -= pad
      hi += pad
      const top = ROW.temp.y + 8
      const bot = ROW.temp.y + ROW.temp.h - 6
      const ty = t => bot - ((t - lo) / (hi - lo)) * (bot - top)

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
      // 数值：每 3 小时 + 极值
      ctx.font = '10px sans-serif'
      ctx.fillStyle = C.temp
      ctx.textAlign = 'center'
      series.forEach((h, i) => {
        const t = temps[i]
        if (t == null) return
        const isTurn = (i > 0 && i < series.length - 1 && (temps[i] - temps[i - 1]) * (temps[i + 1] - t) < 0)
        if (i % 3 !== 0 && !isTurn) return
        ctx.fillText(String(Math.round(t)), cx(i), ty(t) - 5)
      })
      // 左轴极值
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.fillText(String(Math.round(hi)), PAD_L - 4, top + 4)
      ctx.fillText(String(Math.round(lo)), PAD_L - 4, bot)
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
      ctx.fillText(maxV.toFixed(1), PAD_L - 4, ROW.rain.y + 8)
      ctx.textAlign = 'left'
      ctx.fillText('mm/h', 2, ROW.rain.y + 8)
    },

    // 三层云量：低/中/高三条细带，透明度随云量；成层云带（band）用底部实心标记
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
          ctx.globalAlpha = 0.12 + 0.88 * (Math.max(0, Math.min(100, L.v)) / 100)
          ctx.fillRect(cx(i) - 4, y + k * (hEach + 1), 8, hEach)
        })
        ctx.globalAlpha = 1
        if (h.band && h.band.cover >= 80) {
          ctx.fillStyle = C.cloudLow
          ctx.fillRect(cx(i) - 4, y + 3 * (hEach + 1) - 1, 8, 2)
        }
      })
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.fillText('高/中/低', PAD_L - 4, y + 8)
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

    // 时间轴：每日标签（周X M/D）+ 每 6 小时刻度
    drawAxis(ctx, series, x, cx) {
      const y = ROW.axis.y
      let prevDate = ''
      series.forEach((h, i) => {
        if (h.d !== prevDate) {
          prevDate = h.d
          const md = h.d.slice(5, 10).split('-')
          ctx.font = '600 10px sans-serif'
          ctx.fillStyle = C.now
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText('周' + WEEK[new Date(h.d + 'T12:00:00+08:00').getUTCDay()], x(i) + 3, y + 2)
          ctx.font = '9px sans-serif'
          ctx.fillStyle = C.axisText
          ctx.fillText(Number(md[0]) + '/' + Number(md[1]), x(i) + 3, y + 14)
        }
        if (Number(h.t.slice(0, 2)) % 6 === 0) {
          ctx.font = '9px sans-serif'
          ctx.fillStyle = C.axisText
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText(h.t, x(i) + 2, y + 14)
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
