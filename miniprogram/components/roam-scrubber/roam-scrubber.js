/**
 * 漫游控件（P4 期 5）：哑组件，只有「当前值 / 拖动 / 播放」。
 *
 * 刻意不认识天相也不认识轨迹——读数由宿主（components/space-time）算好后
 * 塞进 readout slot。这样控件可复用，也避免同一份天相在两处各算一遍。
 *
 * 播放用 `setInterval`，**必须在 detached 清掉**——页面 `onHide`/返回时若不清，
 * 定时器会继续跑并持续 setData，既耗电又会在页面隐藏后触发告警。
 */
const F = require('../../utils/format')

Component({
  // styleIsolation: apply-shared —— 否则 app.wxss 的类选择器不注入组件内部
  // multipleSlots: true —— **用具名 slot（<slot name="readout">）必须声明它**，
  //   否则宿主传进来的 slot 内容被**静默丢弃**：数据算对了、页面上就是没有。
  //   这个坑不会报错，只会让读数行凭空消失，只有真机看图才发现得了。
  // `options` 只能出现一次（写两个同名字段后者覆盖前者）。
  options: { styleIsolation: 'apply-shared', multipleSlots: true },

  properties: {
    // 时间轴两端（自 00:00 起的分钟数）
    min: { type: Number, value: 0 },
    max: { type: Number, value: 24 * 60 },
    // 步长（分钟）。5 = 5 分钟一格，足够细又不至于让 thumb 难拖。
    step: { type: Number, value: 5 },
    // 当前时刻（分钟）。**受控**：外层给什么就显示什么。
    value: { type: Number, value: 0 },
    playing: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    // 播放倍速：每 tick 前进多少分钟。默认 tick 200ms × 18 min ≈ 90 min/s，
    // 走完 05:40→14:10（510 分钟）约 5.7 秒——「走一遍这一天」的节奏。
    minutesPerTick: { type: Number, value: 18 },
    tickMs: { type: Number, value: 200 },
    emptyText: { type: String, value: '拖动或播放，走一遍这一天' },
  },

  data: {
    clock: '00:00',
  },

  observers: {
    // 时钟由外部 value 推导，**不读 this.data.value**（那是同一次 setData 里的待更新值）
    'value, min, max': function (v, lo, hi) {
      const m = clamp(Number(v), Number(lo) || 0, Number(hi) || 0)
      // 外部拖动会改 value；播放中要跟着重置本地位置，
      // 否则会出现「松手后滑块弹回旧位置」
      if (this._timer) this._pos = m
      this.setData({ clock: F.minutesLabel(m) })
    },
    // 播放状态由外部控制时，本地定时器必须与之一致
    playing: function (on) {
      if (on) this.startTimer()
      else this.stopTimer()
    },
  },

  lifetimes: {
    ready: function () {
      const m = clamp(Number(this.data.value), Number(this.data.min) || 0, Number(this.data.max) || 0)
      this.setData({ clock: F.minutesLabel(m) })
      if (this.data.playing) this.startTimer()
    },
    detached: function () {
      this.stopTimer()
    },
  },

  methods: {
    // ---- 拖动 ----
    // bindchanging：拖动过程中连续触发，播放头需要实时跟手
    onChanging(e) {
      this.emit(Number(e.detail.value))
    },
    // bindchange：松手时触发一次
    onChange(e) {
      this.emit(Number(e.detail.value))
    },

    onToggle() {
      if (this.data.disabled) return
      this.triggerEvent('toggle', { playing: !this.data.playing })
    },

    emit(minutes) {
      this.triggerEvent('change', { minutes, t: F.minutesLabel(minutes) })
    },

    // ---- 播放 ----
    // 播放位置由**本组件持有**（this._pos），不每 tick 回读 this.data.value。
    // 否则父组件若没把 change 事件喂回 value，播放会永远重复同一个值，
    // 永远到不了终点，也就永远不会自停——一个停不下来的播放比没有播放更糟。
    startTimer() {
      this.stopTimer()
      if (this.data.disabled) return
      const per = Math.max(1, Number(this.data.minutesPerTick) || 18)
      const ms = Math.max(50, Number(this.data.tickMs) || 200)
      const lo = Number(this.data.min) || 0
      const hi = Number(this.data.max) || 0
      this._pos = clamp(Number(this.data.value), lo, hi)
      this._timer = setInterval(() => {
        const end = Number(this.data.max) || 0
        const next = this._pos + per
        if (next >= end) {
          // 到达终点就停：循环播放会让人误判天气窗口在反复出现
          this._pos = end
          this.triggerEvent('change', { minutes: end, t: F.minutesLabel(end), finished: true })
          this.triggerEvent('toggle', { playing: false })
          this.stopTimer()
          return
        }
        this._pos = next
        this.triggerEvent('change', { minutes: next, t: F.minutesLabel(next) })
      }, ms)
    },

    stopTimer() {
      if (this._timer) {
        clearInterval(this._timer)
        this._timer = null
      }
      this._pos = null
    },
  },
})

function clamp(v, lo, hi) {
  if (!isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}
