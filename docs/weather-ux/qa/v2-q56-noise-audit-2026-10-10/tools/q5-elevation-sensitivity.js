/* Q5 取证：点海拔不确定度穿过整条云海判定链，到底谁在保护、谁在裸奔。
 *
 * 三条链上环节必须分开测（上一轮我把它们混在一次 ±600 m 摆动里，本轮更正）：
 *   ① 输入海拔不确定 —— 点海拔本身可能错（模型降尺度 ±300–600 m；GPX/选点/手填无误差资料）
 *   ② 云层资料不确定 —— 条件层因误差带/中等云量/缺包络而**弃权**（within-uncertainty 等）
 *   ③ 业务门槛拒绝 —— 资料与海拔都判得动，只是没过 200 m 净空 / 300 m 层厚 / 80% 覆盖
 *
 * 做法：对同一份真实快照，把 (海拔偏移 × 海拔出处) 组成矩阵，逐格跑**真实生产 OI**，
 * 记录条件态分布、候选小时、最终窗口与净空极值，并对每一小时单独看它在哪些格之间翻转。
 * 这是**敏感性分析**，不是概率，也不是置信度：它回答"改输入会怎样"，不回答"真实海拔是多少的概率"。
 *
 * 只读，不改生产代码与阈值。运行：node q5-elevation-sensitivity.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))
const OI = require(path.join(ROOT, 'miniprogram/utils/outdoor-intelligence.js'))

const SNAPSHOTS = [
  { name: '3 站 × 72h', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h（含稻城）', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
]
const DELTA = [-600, -300, 0, 300, 600]
const BASES = ['measured', 'estimated']
/* 铁律 26：clear 是「判过了、两侧都没云」的否定式事实，both-sides 是多侧事实（holds 非空），
 * 都不能和真正的「判不出」混成一格。分三类计数。 */
const NO_FACT = ['within-uncertainty', 'partial-at-point', 'no-data', 'no-altitude']
const isNoFact = r => NO_FACT.indexOf(r) >= 0

const out = { generatedAt: new Date().toISOString(),
  口径: { 海拔出处: 'measured=tol 0（GPX/选点/手填）；estimated=tol 600（Open-Meteo 地形模型）；来源 cloud-field-svg.ALT_TOL',
    条件阈值: { IN_C: 60, SEA_C: 68, OVER_C: 40, SPAN_C: 70, EDGE_GUARD: 200, MODERATE_AT_POINT: 45 },
    业务阈值: { LAYER_COVER_MIN: 80, CLEARANCE_MIN: 200, LAYER_THICKNESS_MIN: 300, MIN_RUN_H: 2, 扫描带: [CFF.ALT0, CFF.ALT1] },
    性质: '敏感性分析，不是概率也不是置信度' },
  快照: [] }

SNAPSHOTS.forEach(function (sn) {
  const abs = path.join(ROOT, sn.p)
  if (!fs.existsSync(abs)) { out.快照.push({ 快照: sn.name, 状态: '文件不存在' }); return }
  const snap = JSON.parse(fs.readFileSync(abs, 'utf8'))
  const cells = {}                       // 'basis|delta' -> 汇总
  BASES.forEach(b => DELTA.forEach(d => {
    cells[b + '|' + d] = { CLOUD_BELOW小时: 0, 候选小时: 0, 窗口数: 0, 窗口覆盖小时: 0,
      净空: [], 条件态: {}, 拒绝原因: {} }
  }))
  const perHour = {}                     // 'place|day|h' -> { basis|delta : 该小时读数 }
  let hourCount = 0

  Object.keys(snap.places).forEach(function (k) {
    const p = snap.places[k]
    if (!p.cloudLevels) return
    const nDays = Math.min(sn.days, Math.floor(((p.series || []).length) / 24))
    for (let d = 0; d < nDays; d++) {
      const day = new Date(Date.parse(snap.date + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10)
      const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: day, hours: 24, userAltitude: p.elevation })
      if (!cf) continue
      const col = CFF.makeColumnSampler(cf)
      const at = (t, a) => CFF.sampleAtStations(col, cf.times.length, t, a)
      const detail = (p.series || []).filter(r => r.d === day)
      BASES.forEach(function (basis) {
        DELTA.forEach(function (dl) {
          const alt = p.elevation + dl
          const cell = cells[basis + '|' + dl]
          const oi = OI.buildOutdoorIntelligence({ date: day, detail: detail, userAltitude: alt,
            elevOK: true, elevBasis: basis, lat: p.gcj[0], lng: p.gcj[1],
            cloudField: Object.assign({}, cf, { sample: at, userAltitude: alt }), days: [] })
          const cs = (oi.meta && oi.meta.cloudSea) || {}
          ;(oi.conditions || []).forEach(function (c, h) {
            const key = c.key || (isNoFact(c.reason) ? '判不出:' + c.reason : '事实:' + c.reason)
            cell.条件态[key] = (cell.条件态[key] || 0) + 1
            if (c.key === 'CLOUD_BELOW') cell.CLOUD_BELOW小时++
            const hk = p.name + '|' + day + '|' + h
            ;(perHour[hk] = perHour[hk] || {})[basis + '|' + dl] = {
              条件: c.key || (isNoFact(c.reason) ? '判不出:' + c.reason : '事实:' + c.reason),
              候选: !!(cs.candidates || []).some(x => x.t === c.t),
            }
          })
          ;(cs.candidates || []).forEach(function (x) { cell.候选小时++ })
          ;(cs.rejected || []).forEach(function (x) { if (x.reason) cell.拒绝原因[x.reason] = (cell.拒绝原因[x.reason] || 0) + 1 })
          ;((oi.opportunities || []).filter(o => o.type === 'CLOUD_SEA')).forEach(function (w) {
            cell.窗口数++
            cell.窗口覆盖小时 += (w.layers || []).length
            ;(w.layers || []).forEach(l => cell.净空.push(l.clearance))
          })
        })
      })
      hourCount += 24
    }
  })

  const q = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * 0.5)] : null }
  const 矩阵 = BASES.map(function (basis) {
    return DELTA.map(function (dl) {
      const c = cells[basis + '|' + dl]
      const 判不出 = Object.keys(c.条件态).filter(x => /^判不出:/.test(x)).reduce((a, k) => a + c.条件态[k], 0)
      const 晴空事实 = Object.keys(c.条件态).filter(x => x === '事实:clear').reduce((a, k) => a + c.条件态[k], 0)
      const 两侧事实 = Object.keys(c.条件态).filter(x => x === '事实:both-sides').reduce((a, k) => a + c.条件态[k], 0)
      return { 偏移: dl, 出处: basis, CLOUD_BELOW小时: c.CLOUD_BELOW小时, 候选小时: c.候选小时,
        窗口数: c.窗口数, 窗口覆盖小时: c.窗口覆盖小时,
        净空中位数: q(c.净空), 净空最小: c.净空.length ? Math.min.apply(null, c.净空) : null,
        净空最大: c.净空.length ? Math.max.apply(null, c.净空) : null,
        判不出小时: 判不出, 判不出构成: Object.keys(c.条件态).filter(x => /^判不出:/.test(x)).reduce((a, k) => (a[k.replace('判不出:', '')] = c.条件态[k], a), {}), 判过但晴空: 晴空事实, 判过且上下都有云: 两侧事实,
        拒绝原因: c.拒绝原因, 条件态: c.条件态 }
    })
  })

  /* 逐小时翻转归因：同出处下沿偏移轴看谁变了，再跨出处看保护差在哪 */
  const flips = { measured: { 变候选: 0, 变判不出: 0, 变门槛拒: 0, 不变: 0 }, estimated: { 变候选: 0, 变判不出: 0, 变门槛拒: 0, 不变: 0 }, 两出处结论不同的小时: 0, 小时格数: Object.keys(perHour).length }
  Object.keys(perHour).forEach(function (hk) {
    const r = perHour[hk]
    BASES.forEach(function (basis) {
      const seq = DELTA.map(dl => r[basis + '|' + dl])
      const same = seq.every(x => x && x.候选 === seq[0].候选 && x.条件 === seq[0].条件)
      if (same) { if (basis === 'measured') flips.measured.不变++; else flips.estimated.不变++; return }
      const anyAbstain = seq.some(x => x && /^判不出:/.test(x.条件))
      const anyBelow = seq.some(x => x && x.条件 === 'CLOUD_BELOW')
      const cls = anyAbstain ? '变判不出' : (anyBelow ? '变门槛拒' : '变候选')
      flips[basis][cls]++
    })
    const m = r['measured|0'], e = r['estimated|0']
    if (m && e && m.候选 !== e.候选) { flips.两出处结论不同的小时++ }
  })

  out.快照.push({ 快照: sn.name, 取数日: snap.date, 地点: Object.keys(snap.places).map(k => snap.places[k].name + ' ' + snap.places[k].elevation + 'm'),
    日列数: hourCount / 24, 矩阵: 矩阵, 翻转归因: flips,
    基准格读数_同海拔两出处: { measured: cells['measured|0'], estimated: cells['estimated|0'] } })
})

console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'q5-elevation-sensitivity.json'), JSON.stringify(out, null, 2))
