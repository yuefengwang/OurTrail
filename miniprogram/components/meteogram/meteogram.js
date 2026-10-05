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
  HOUR_W, PAD_L, PAD_R, ROW, CHART_H, AXIS_DAY_DY, AXIS_HOUR_DY, AXIS_SUN_BAND_H,
  BAND_ALT_MAX, bandAltY, SUN_BAND_COLORS,
  MARK_STYLE, MARK_LANES, LEGEND_KEYS,
  MARK_LANE_H, MARK_LANE_GAP, MARK_FONT_PX, inkOn, tapColumn,
} = require('./layout')

/* canvas 画布内拿不到 CSS 变量(var() 在 canvas 上下文无效)，所以这里必须留字面量。
   但**不要凭记忆抄**——凡是 app.wxss 已有 token 的值，都在下面标了出来源。
   新增画布色时先查 design-system.md 的 token 表；确实没有对应语义色的，
   先在 app.wxss 加 token 并登记，再回来写字面量。 */
const C = {
  night: '#F0F1EC',        // 无 token（近似 --info-soft 但不同值，勿混用）
  day: '#FFFFFF',          // = --white
  grid: '#E4E8E1',         // 无 token
  axisText: '#5F6E66',     // = --muted
  // 温度线用中性墨色而不是红：红 #B43D3B 与天相标记「光染」是**同一个色值**，
  // 图例里的红色分不清是温度还是光染。中性墨色也让"客观指标"这一层不与语义色抢注意力。
  temp: '#202A26', // = --ink
  tempFill: 'rgba(32,42,38,0.08)',   // ink 8%
  rain: '#346583',        // = --info（同 cloudLow / MARK_STYLE.cloudSea）
  showers: '#2E8B8B',     // 无 token
  cloudLow: '#346583',   // = --info（= rain = MARK_STYLE.cloudSea）
  // 云量色用**实色**，浓淡交给 ctx.globalAlpha：
  cloudMid: '#6C7C93',   // = --blue-hour（= MARK_STYLE.blueHour）
  // 原来颜色自带 0.6–0.75 alpha，再叠一层 alpha 是乘法关系，
  cloudHigh: '#8C9791',  // = --control-line（= MARK_STYLE.inCloud）
  // 低云量时几乎完全看不见。
  selBand: 'rgba(22,62,53,0.12)',   // forest 12%
  selEdge: 'rgba(22,62,53,0.35)',   // forest 35%
  now: '#163E35',         // = --forest（= MARK_STYLE.galaxy）
  warn: '#8C5A12',        // = --warning（= MARK_STYLE.rainbow）
  // V2 云层带剖面的状态底（与结论卡/Agenda 同源的语义色，浅底字面量按 design-system 预算）：
  seaTint: 'rgba(39,97,69,0.12)',      // = --success 12%（云在脚下 = 云海窗口）
  inCloudTint: 'rgba(140,90,18,0.14)', // = --warning 14%（云层罩住此点 = 入云）
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

function hourKey(d, t) { return d + 'T' + t }

// 'HH:mm' → 分钟数（V2 轴上日出日落/现在线定位用）。非法输入返回 NaN，由调用方守卫。
function minuteOfT(t) {
  const s = String(t || '')
  if (s.length < 5) return NaN
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
}

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
    // 每小时列宽（px）。22 = 标准；横屏「全图展示」页会按屏宽算出一个更小的值，
    // 让整段 7 天一屏看完（"全览"），也会用 44 做"放大"。
    hourWidth: { type: Number, value: HOUR_W },
    // 图例右侧提示语。横屏页与天气页说的话不一样，所以由外部给。
    tip: { type: String, value: '' },
    // ---- V2 optional 入参（全屏页/旧调用方不传即得旧行为，全部渐进增强）----
    // 此点海拔（m，可信高程优先）：云层带剖面行的虚线；null/缺省不画线。
    elevation: { type: null, value: null },
    // 日照相位 {'dateTHH:mm': 'golden'|'blue'|'astro'|'night'}：轴顶分色带，页面按 astro 算好传入
    sunBands: { type: Object, value: {} },
    // 逐日日出日落 { date: { rise:'HH:mm', set:'HH:mm' } }：轴上的日出日落虚线
    sunLines: { type: Object, value: {} },
    // 「现在」{ date, t }：竖线；null 不画
    now: { type: null, value: null },
    // 点选/看图锚定列 { date, t }：整列淡墨高亮；null 不画
    pick: { type: null, value: null },
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
    'series, marks, night, selectedDates, hourWidth, elevation, sunBands, sunLines, now, pick': function () {
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
    },
  },

  methods: {
    // 列宽收敛到可画区间：太窄画不出分隔，太宽撑破屏
    hourWidth() {
      const v = Number(this.data.hourWidth)
      return Math.max(3, Math.min(72, Number.isFinite(v) && v > 0 ? v : HOUR_W))
    },

    scheduleDraw() {
      this.hw = this.hourWidth()
      this.refreshLegend()
      const n = this.data.series.length
      const w = Math.max(280, PAD_L + n * this.hw + PAD_R)
      if (w !== this.data.chartW) {
        this.setData({ chartW: w, chartH: CHART_H }, () => this.initCanvas())
      } else {
        this.initCanvas()
      }
      this.scheduleSync()
    },

    // 同层 canvas（type="2d"）的图层位置是在 initCanvas 那一刻量下来的，
    // 之后页面再发生重排它不会自己跟过去——天气页里"上面多了一个标题按钮"、
    // 7 日卡异步渲染都会把 canvas 整体往下推，图层却留在旧位置，
    // 结果就是图盖在正文上（横向对、纵向错）。
    // 布局落定后再量一次尺寸、重设 node.width/height 触发图层重新对齐，再重绘。
    // 补两遍：页面里 7 日卡这类异步内容有时一帧后才把高度撑开。
    scheduleSync() {
      clearTimeout(this._sync1)
      clearTimeout(this._sync2)
      const again = () => {
        if (!this._ready || !this.data.series.length) return
        this.initCanvas()
      }
      this._sync1 = setTimeout(again, 100)
      this._sync2 = setTimeout(again, 320)
    },

    // 只列图上真出现过的天相窗口；一个都没有时把提示换成说明，避免留一行空图例
    refreshLegend() {
      const marks = this.data.marks || {}
      const present = {}
      Object.keys(marks).forEach(k => (marks[k] || []).forEach(m => { present[m] = true }))
      const legend = LEGEND_KEYS.filter(k => present[k]).map(k => ({
        k, t: MARK_STYLE[k].text, c: MARK_STYLE[k].color,
      }))
      const base = this.data.tip || '横滑看全程 · 点图上某天切换'
      const legendTip = legend.length ? base : '该时段没有可标注的天相窗口'
      if (JSON.stringify(legend) !== JSON.stringify(this.data.legend) || legendTip !== this.data.legendTip) {
        this.setData({ legend, legendTip })
      }
    },

    initCanvas() {
      wx.createSelectorQuery().in(this).select('#meteo').fields({ node: true, size: true }).exec(res => {
        const info = res && res[0]
        if (!info || !info.node) return
        // 还没排版完成时量到 0：这一帧不画，等 scheduleSync 的补测
        if (!info.width || !info.height) return
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
      // 列宽在 scheduleDraw 里已算好；这里兜一次底（initCanvas 是异步回调）
      const hw = this.hw = this.hw || this.hourWidth()
      ctx.clearRect(0, 0, W, H)
      if (!series.length) return

      const x = i => PAD_L + i * hw
      const cx = i => x(i) + hw / 2

      // 1) 底色：夜间底 + 所选日高亮带。
      // 只铺到时间轴顶：原来铺满整高，把时间轴也染灰，轴文字底色不统一。
      const BODY_H = ROW.axis.y
      for (let i = 0; i < series.length; i++) {
        const h = series[i]
        ctx.fillStyle = this.data.night[hourKey(h.d, h.t)] ? C.night : C.day
        ctx.fillRect(x(i), 0, hw, BODY_H)
        if (this.data.selectedDates[h.d]) {
          ctx.fillStyle = C.selBand
          ctx.fillRect(x(i), 0, hw, BODY_H)
        }
      }
      // 所选日顶部色条：淡底在夜间灰底上仍不明显，给一条实条做明确锚点
      series.forEach((h, i) => {
        if (!this.data.selectedDates[h.d]) return
        ctx.fillStyle = C.now
        ctx.fillRect(x(i), 0, hw, 2)
      })
      // V2 点选/看图锚定列：整列淡墨（Evidence「看图↗」与本页点小时共用）
      const pick = this.data.pick
      if (pick && pick.date && pick.t) {
        const pi = series.findIndex(h => h.d === pick.date && h.t === pick.t)
        if (pi >= 0) {
          ctx.fillStyle = C.tempFill
          ctx.fillRect(x(pi), 0, hw, BODY_H)
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
          ctx.lineTo(px, ROW.axis.y + ROW.axis.h)
          ctx.stroke()
          prevDate = series[i].d
        }
      }

      this.drawMarks(ctx, series, x)
      this.drawTemp(ctx, series, x, cx)
      this.drawRain(ctx, series, x, cx)
      this.drawCloud(ctx, series, x, cx)
      this.drawBandProfile(ctx, series, x)
      this.drawWind(ctx, series, cx)
      this.drawCode(ctx, series, cx)
      this.drawAxis(ctx, series, x, cx)
    },

    // 天相窗口：按泳道分行画，同泳道内才叠放
    drawMarks(ctx, series, x) {
      const hw = this.hw
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
            if (isBreak) { this.markRect(ctx, x(s), ly, (idx[j - 1] - s + 1) * hw, st); s = idx[j] }
          }
          this.markRect(ctx, x(s), ly, (idx[idx.length - 1] - s + 1) * hw, st)
        })
      })
    },

    markRect(ctx, px, py, w, st) {
      // 窄列（全览模式）不留内缩：w=3 时再内缩就画不出东西
      const inset = w > 6 ? 1 : 0
      const bw = Math.max(1, w - inset * 2)
      const r = Math.min(3, bw / 2)
      ctx.fillStyle = st.color
      this.roundRect(ctx, px + inset, py, bw, MARK_LANE_H, r)
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

      // 极值标注（V2）：只在曲线最高/最低两点写数字，窄列（全览 hw<8）省略防叠。
      // 标签写在各自点上方——极值点上方必是空区，不会压到降水行。
      if (this.hw >= 8) {
        const iMax = temps.indexOf(hi)
        const iMin = temps.indexOf(lo)
        ctx.font = '700 9px sans-serif'
        ctx.fillStyle = C.temp
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(Math.round(hi) + '°', cx(iMax), ty(hi) - 4)
        ctx.fillStyle = C.axisText
        ctx.fillText(Math.round(lo) + '°', cx(iMin), ty(lo) - 4)
      }

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

    // 降水双柱：precipitation（蓝）+ showers（青），按 pop 定不透明度。
    // 全览模式（列宽 <10px）放不下两根柱子并排，合成一根，否则相邻列互相压。
    drawRain(ctx, series, x, cx) {
      const hw = this.hw
      const thin = hw < 10
      const bw = Math.max(1, Math.min(3, Math.floor(hw / 4)))
      const gap = thin ? 0 : Math.max(2, Math.floor(hw / 6))
      const maxV = Math.max(
        0.1,
        Math.max.apply(null, series.map(h => Math.max(numOr(h.precip, 0), numOr(h.showers, 0))))
      )
      const bot = ROW.rain.y + ROW.rain.h
      // 降水概率底带（V2）：pop≥50 的整列铺淡 info 底——"可能下雨"先于具体毫米被看见
      series.forEach((h, i) => {
        if (numOr(h.pop, 0) < 50) return
        ctx.fillStyle = C.rain
        ctx.globalAlpha = 0.10
        ctx.fillRect(x(i), ROW.rain.y - 2, hw, ROW.rain.h + 3)
        ctx.globalAlpha = 1
      })
      series.forEach((h, i) => {
        const p = numOr(h.precip, 0)
        const s = numOr(h.showers, 0)
        const pop = numOr(h.pop, 0)
        if (thin) {
          const v = Math.max(p, s)
          if (v <= 0) return
          const bh = Math.max(1, (v / maxV) * (ROW.rain.h - 4))
          ctx.fillStyle = s > p ? C.showers : C.rain
          ctx.globalAlpha = 0.45 + 0.55 * (pop / 100)
          ctx.fillRect(cx(i) - Math.max(1, hw - 1) / 2, bot - bh, Math.max(1, hw - 1), bh)
          ctx.globalAlpha = 1
          return
        }
        if (p > 0) {
          const bh = Math.max(1, (p / maxV) * (ROW.rain.h - 4))
          ctx.fillStyle = C.rain
          ctx.globalAlpha = 0.45 + 0.55 * (pop / 100)
          ctx.fillRect(cx(i) - gap - bw, bot - bh, bw, bh)
        }
        if (s > 0) {
          const bh = Math.max(1, (s / maxV) * (ROW.rain.h - 4))
          ctx.fillStyle = C.showers
          ctx.globalAlpha = 0.45 + 0.55 * (pop / 100)
          ctx.fillRect(cx(i) + gap, bot - bh, bw, bh)
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
      const hw = this.hw
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
          // 按**整列**画（x(i) 起、宽一列），相邻小时才接得上。
          // 原来用 cx(i) 居中 + 宽 8：每列只覆盖 36%，168 列 × 3 层 = 504 个孤立小方块，
          // 看着像图片加载失败而不是云量。
          ctx.fillRect(x(i), y + k * (hEach + 1), hw, hEach)
        })
        ctx.globalAlpha = 1
        if (h.band && h.band.cover >= 80) {
          ctx.fillStyle = C.cloudLow
          ctx.fillRect(x(i), y + 3 * (hEach + 1) - 1, hw, 2)
        }
      })
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText('高/中/低', PAD_L - 4, y + 8)
      ctx.textBaseline = 'alphabetic'
    },

    // 云层带剖面（V2）：0–6000 m 压缩条。band{base,top,cover} 色块 + 此点海拔虚线 +
    // 云海/入云状态底。数据全部来自服务端 cloudBandAt（series[].band）与页面级 marks
    // （cloudSea/inCloud，与结论卡同源）——这里只做形状映射，**不含任何新阈值**。
    drawBandProfile(ctx, series, x) {
      const hw = this.hw
      const row = ROW.bandProfile
      const marks = this.data.marks || {}
      series.forEach((h, i) => {
        const list = marks[hourKey(h.d, h.t)] || []
        // 状态底（互斥：云海优先于入云，两者由 sky.js 判定本就不会同时成立）
        if (list.indexOf('cloudSea') !== -1) {
          ctx.fillStyle = C.seaTint
          ctx.fillRect(x(i), row.y, hw, row.h)
        } else if (list.indexOf('inCloud') !== -1) {
          ctx.fillStyle = C.inCloudTint
          ctx.fillRect(x(i), row.y, hw, row.h)
        }
        const band = h.band
        if (band && band.cover >= 80 && Number.isFinite(band.base) && Number.isFinite(band.top)) {
          const yTop = bandAltY(band.top, row)
          const yBase = bandAltY(band.base, row)
          ctx.fillStyle = C.cloudLow
          ctx.globalAlpha = 0.25 + 0.6 * (Math.max(0, Math.min(100, band.cover)) / 100)
          ctx.fillRect(x(i) + 0.5, yTop, Math.max(1, hw - 1), Math.max(2, yBase - yTop))
          ctx.globalAlpha = 1
        }
      })
      // 此点海拔虚线：band 顶在虚线下方 = 云在脚下；虚线穿带 = 罩住自己；带在虚线上方 = 头顶
      const elev = this.data.elevation
      if (Number.isFinite(elev)) {
        const py = Math.round(bandAltY(elev, row)) + 0.5
        ctx.strokeStyle = C.now
        ctx.lineWidth = 1
        ctx.setLineDash([3, 2])
        ctx.beginPath()
        ctx.moveTo(PAD_L, py)
        ctx.lineTo(this.cssW - PAD_R, py)
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText('带', PAD_L - 4, row.y + row.h / 2)
      ctx.textBaseline = 'alphabetic'
    },

    // 风行（V2）：风向箭头 + 风速数字，每 3 小时一档（24 个箭头是噪声）。
    // windDir 缺失（旧返回体/未部署新云函数）时只画数值——单字段缺失不致整图失败。
    drawWind(ctx, series, cx) {
      const row = ROW.wind
      for (let i = 0; i < series.length; i += 3) {
        const h = series[i]
        const px = cx(i)
        if (Number.isFinite(h.windDir)) {
          const dir = (((h.windDir % 360) + 360) % 360 + 180) % 360 // 箭头指向风吹去的方向
          ctx.save()
          ctx.translate(px, row.y + 5)
          ctx.rotate(dir * Math.PI / 180)
          ctx.strokeStyle = C.axisText
          ctx.lineWidth = 1.1
          ctx.beginPath()
          ctx.moveTo(0, 4)
          ctx.lineTo(0, -2)
          ctx.moveTo(0, -2)
          ctx.lineTo(-2.4, 0.6)
          ctx.moveTo(0, -2)
          ctx.lineTo(2.4, 0.6)
          ctx.stroke()
          ctx.restore()
        }
        if (Number.isFinite(h.wind)) {
          ctx.font = '9px sans-serif'
          ctx.fillStyle = C.axisText
          ctx.textAlign = 'center'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(String(Math.round(h.wind)), px, row.y + row.h - 1)
        }
      }
      ctx.font = '9px sans-serif'
      ctx.fillStyle = C.axisText
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText('风', PAD_L - 4, row.y + row.h / 2)
      ctx.textBaseline = 'alphabetic'
    },

    // 天气简字：标准宽度每 3 小时标一次；全览（窄列）时每 3 小时会叠成一团字，
    // 改成每天正午一词，读作"这天什么天气"。
    drawCode(ctx, series, cx) {
      const noonOnly = this.hw < 10
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let last = ''
      series.forEach((h, i) => {
        if (noonOnly ? h.t !== '12' : i % 3 !== 0) return
        const label = PHRASE(numOr(h.code, 0))
        if (label === last) return
        last = label
        ctx.fillStyle = h.pop >= 50 || numOr(h.code, 0) >= 95 ? C.warn : C.axisText
        ctx.fillText(label, cx(i), ROW.code.y + 8)
      })
    },

    // 时间轴：上行日期（周几 M/D），下行小时刻度，两行分开写。
    // 小时密度随列宽走：窄列时 6 小时一个标签也会叠，干脆只留日期行。
    drawAxis(ctx, series, x, cx) {
      const hw = this.hw
      const hourStep = hw < 8 ? 0 : (hw >= 40 ? 3 : 6)
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
        if (hourStep && Number(h.t.slice(0, 2)) % hourStep === 0) {
          ctx.font = '9px sans-serif'
          ctx.fillStyle = C.axisText
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText(h.t, x(i) + 2, y + AXIS_HOUR_DY)
        }
      })

      // 日照轴带（V2）：黄金/蓝调/暮光/夜分色条，贴在轴行**底部**——顶部是日期行文字，
      // 画在上面会把「周六 9/28」糊掉（位置由布局不变量测试钉住）。
      // 数据由页面按 astro 逐时算好传入（sunBands）；不传（全屏页旧行为）则整段跳过。
      const bands = this.data.sunBands || {}
      if (Object.keys(bands).length) {
        const by = y + ROW.axis.h - AXIS_SUN_BAND_H - 1
        series.forEach((h, i) => {
          const color = SUN_BAND_COLORS[bands[hourKey(h.d, h.t)]]
          if (!color) return
          ctx.fillStyle = color
          ctx.fillRect(x(i), by, hw, AXIS_SUN_BAND_H)
        })
      }
      // 日出日落虚线（V2）：按天文时刻在所属小时列内插值定位
      const sunLines = this.data.sunLines || {}
      if (hw >= 8 && Object.keys(sunLines).length) {
        ctx.strokeStyle = MARK_STYLE.golden.color
        ctx.lineWidth = 1
        ctx.setLineDash([2, 2])
        series.forEach((h, i) => {
          const s = sunLines[h.d]
          if (!s) return
          const colMin = minuteOfT(h.t)
          if (!Number.isFinite(colMin)) return
          ;[s.rise, s.set].forEach(t => {
            const mm = minuteOfT(t)
            if (!Number.isFinite(mm) || mm < colMin || mm >= colMin + 60) return
            const px = Math.round(x(i) + hw * (mm - colMin) / 60) + 0.5
            ctx.beginPath()
            ctx.moveTo(px, 4)
            ctx.lineTo(px, y + ROW.axis.h)
            ctx.stroke()
          })
        })
        ctx.setLineDash([])
      }
      // 「现在」线（V2）：{ date, t }，实线 + 顶部圆点
      const now = this.data.now
      if (now && now.date && now.t) {
        const nm = minuteOfT(now.t)
        const ni = series.findIndex(h => h.d === now.date
          && Number.isFinite(nm) && nm >= minuteOfT(h.t) && nm < minuteOfT(h.t) + 60)
        if (ni >= 0) {
          ctx.strokeStyle = C.now
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(x(ni), 2)
          ctx.lineTo(x(ni), y + ROW.axis.h)
          ctx.stroke()
          ctx.fillStyle = C.now
          ctx.beginPath()
          ctx.arc(x(ni), 4, 2.2, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    },

    // 点击定位到某小时 → 通知页面切日。
    // e.detail.x 是**页面坐标**；canvas 在横滚 scroll-view 里，滚动后内容左缘
    // = boundingClientRect().left（已含 -scrollLeft 偏移，通常为负）。
    // 直接减 PAD_L 不算滚动，滑过图后任何点按都会落回 series 首日
    // （2026-09-30 开发者工具实测复现：滚到第 4 天点屏中部，日期被拉回首日）。
    onTap(e) {
      const hw = this.hw || HOUR_W
      const px = (e.detail && Number.isFinite(e.detail.x) ? e.detail.x
        : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].x : NaN))
      if (!Number.isFinite(px)) return
      this.createSelectorQuery().select('.meteogram-canvas').boundingClientRect(rect => {
        if (!rect || !Number.isFinite(rect.left)) return
        const h = this.data.series[tapColumn(px, rect.left, hw)]
        if (!h) return
        this.triggerEvent('pickhour', { date: h.d, t: h.t })
      }).exec()
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
