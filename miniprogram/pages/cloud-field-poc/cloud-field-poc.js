/* Cloud Field SVG Migration POC —— 独立验证页（非用户流程）
 *
 * 目的：把已验证的 Cloud Field renderer（utils/cloud-field-svg.js）带进
 * 微信小程序环境并测量真实性能。renderer 只消费 Time × Altitude × Cover，
 * 本页负责：数据集切换（冻结 fixtures / 实时 wx.request）、data-URI 编码、
 * <image> 双层渲染（基础场 + 选中 overlay）、性能 HUD。
 *
 * 验证步骤（需微信开发者工具，人工）：编译打开本页 →
 *   1. Mock/峨眉山/理塘 三数据集切换渲染正常
 *   2. 点击时刻 chips：仅 overlay image 更新，无整图闪烁
 *   3. HUD 数字与本目录 README 的 Node 基准同数量级
 *   4. 真机（可选）：SVG/文字/透明度/裁剪表现
 * 服务端口与扫码登录未配置时，本页无法自动驱动——见 docs/e2e-mp/README.md。
 */
'use strict'

const renderer = require('../../utils/cloud-field-svg.js')
const fixtures = require('./fixtures.js')

const DATASETS = {
  mock: fixtures.mock,
  emeishan: fixtures.emeishan,
  litang: fixtures.litang,
}
const LABELS = {
  mock: '格聂（mock）',
  emeishan: '峨眉山 · 冻结真实数据',
  litang: '理塘 · 冻结真实数据',
}
/* 冻结 fixtures 未含昼夜分段，按抓取当日实况补（仅昼夜底着色用） */
const SUN = {
  mock: { sunrise: 7 + 6 / 60, sunset: 19 + 5 / 60, label: '日出 07:06 · 日落 19:05' },
  emeishan: { sunrise: 7 + 2 / 60, sunset: 18 + 46 / 60, label: '日出 07:02 · 日落 18:46' },
  litang: { sunrise: 7 + 14 / 60, sunset: 18 + 58 / 60, label: '日出 07:14 · 日落 18:58' },
}
const LIVE_LOC = {
  emeishan: { label: '峨眉山（实时）', lat: 29.53, lng: 103.39, elev: 3079 },
  litang: { label: '理塘（实时）', lat: 29.9, lng: 100.27, elev: 3500 },
}
const LEVELS = [950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675, 650, 625, 600, 575, 550, 525, 500, 475, 450]
const HOUR_CHIPS = [1, 3, 6, 12, 16, 22]

function pad(n) { return (n < 10 ? '0' : '') + n }
function fmtM(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
function toDataUri(svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) }

Page({
  data: {
    name: '',
    metaLine: '',
    fieldSrc: '',
    selSrc: '',
    hourChips: HOUR_CHIPS,
    sel: 16,
    ds: 'mock',
    readout: '',
    perf: '',
  },

  onLoad() {
    const info = wx.getSystemInfoSync()
    this.width = Math.round(info.windowWidth)
    this.applyDataset('mock', DATASETS.mock)
  },

  onDs(e) {
    const key = e.currentTarget.dataset.ds
    if (key === 'live-emeishan') return this.fetchLive('emeishan')
    if (key === 'live-litang') return this.fetchLive('litang')
    this.applyDataset(key, DATASETS[key])
  },

  applyDataset(key, cf) {
    const sun = SUN[key] || SUN.mock
    const t0 = Date.now()
    this.key = key
    this.elev = cf.meta.elevation
    this.geo = renderer.buildGeometry(cf, {
      width: this.width,
      plotHeight: 300,
      userAltitude: cf.meta.elevation,
    })
    const base = renderer.renderBaseSvg(this.geo, {
      userAltitude: cf.meta.elevation,
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      dateLabel: (cf.meta.date || '').replace(/-0?/, '.').replace('-', '.'),
      debugSamples: cf.rawSamples || null,
    })
    const buildMs = Date.now() - t0
    this.fieldUri = toDataUri(base.svg)
    const st = renderer.inferState(this.geo.sample, this.data.sel, this.elev)
    const st0 = Date.now()
    const ov = renderer.renderSelectionSvg(this.geo, { selectedTime: this.data.sel })
    const updateMs = Date.now() - st0
    const s = this.geo.stats
    this.setData({
      ds: key,
      name: LABELS[key] || cf.meta.name || key,
      metaLine: fmtM(this.elev) + ' m · ' + (sun.label || ''),
      fieldSrc: this.fieldUri,
      selSrc: toDataUri(ov.svg),
      readout: this.readoutText(this.data.sel, st),
      perf: '场网格 ' + s.gridMs + 'ms · 等值带 ' + s.isoMs + 'ms · 构建 ' + buildMs +
        'ms · path ' + s.pathCount + ' · 采样点 ' + s.pointCount + ' · 选中切换 ' + updateMs + 'ms' +
        ' · svg ' + Math.round(this.fieldUri.length / 102.4) / 10 + 'KB',
    })
  },

  onChip(e) {
    const t0 = Date.now()
    const sel = Number(e.currentTarget.dataset.h)
    const ov = renderer.renderSelectionSvg(this.geo, { selectedTime: sel })
    const st = renderer.inferState(this.geo.sample, sel, this.elev)
    this.setData({
      sel: sel,
      selSrc: toDataUri(ov.svg),
      readout: this.readoutText(sel, st),
      updateMs: Date.now() - t0,
      perf: this.data.perf.replace(/选中切换 \d+ms/, '选中切换 ' + (Date.now() - t0) + 'ms'),
    })
  },

  readoutText(sel, st) {
    const parts = [pad(sel) + ':00']
    if (st.span) {
      parts.push('云量 ' + st.span.peak + '% · 云区 ' + fmtM(st.span.lo) + '–' + fmtM(st.span.hi) + ' m')
    } else {
      parts.push('海拔 ' + fmtM(this.elev) + ' m 云量 ' + st.cUser + '%')
    }
    if (st.key) parts.push('→ ' + st.word)
    return parts.join('  ')
  },

  fetchLive(key) {
    const loc = LIVE_LOC[key]
    const hourly = ['temperature_2m']
    LEVELS.forEach(lv => { hourly.push('cloud_cover_' + lv + 'hPa', 'geopotential_height_' + lv + 'hPa') })
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lng +
      '&hourly=' + hourly.join(',') + '&timezone=Asia%2FShanghai&forecast_days=1'
    this.setData({ readout: '正在实时抓取 ' + loc.label + ' …', ds: key })
    wx.request({
      url: url,
      timeout: 15000,
      success: res => {
        if (res.statusCode !== 200 || !res.data || !res.data.hourly) {
          return this.setData({ readout: '实时抓取失败：HTTP ' + res.statusCode })
        }
        const H = res.data.hourly
        const altitudes = []
        for (let a = 0; a <= 7000; a += 250) altitudes.push(a)
        const values = []
        for (let h = 0; h < 24; h++) {
          const pairs = []
          LEVELS.forEach(lv => {
            const cov = H['cloud_cover_' + lv + 'hPa'] ? H['cloud_cover_' + lv + 'hPa'][h] : null
            const gt = H['geopotential_height_' + lv + 'hPa'] ? H['geopotential_height_' + lv + 'hPa'][h] : null
            if (cov === null || gt === null) return
            pairs.push({ alt: gt, cover: cov })
          })
          pairs.sort((x, y) => x.alt - y.alt)
          values.push(altitudes.map(alt => {
            if (!pairs.length) return 0
            if (alt <= pairs[0].alt) return pairs[0].cover
            if (alt >= pairs[pairs.length - 1].alt) return pairs[pairs.length - 1].cover
            for (let k = 1; k < pairs.length; k++) {
              if (alt <= pairs[k].alt) {
                const s2 = (alt - pairs[k - 1].alt) / (pairs[k].alt - pairs[k - 1].alt)
                return pairs[k - 1].cover + (pairs[k].cover - pairs[k - 1].cover) * s2
              }
            }
            return pairs[pairs.length - 1].cover
          }))
        }
        this.applyDataset(key, {
          meta: { name: loc.label, elevation: loc.elev, date: H.time[0].slice(0, 10) },
          times: hours24(),
          altitudes,
          values,
        })
      },
      fail: err => {
        this.setData({ readout: '实时抓取失败：' + (err && err.errMsg || '网络错误') + '（DevTools 需勾选「不校验合法域名」）' })
      },
    })
  },
})

function hours24() { const r = []; for (let i = 0; i < 24; i++) r.push(i); return r }
