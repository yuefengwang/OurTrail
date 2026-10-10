/* Q6 取证：50 m 扫描步长的**网格相位**能给判据带来多大噪声，以及四种治理方向各自能消掉哪一部分。
 *
 * 三层误差必须分开量，否则"加缓冲"会把它们混成一锅：
 *   E1 离散化误差 —— 步长 50 m 的阶梯采样本身对云界的定位误差（与相位无关，是方法下限）
 *   E2 相位噪声   —— 同一份数据只把扫描起点平移 <50 m，读数就变（本轮要复现的就是这个）
 *   E3 边界截断   —— 层被扫描带上下界切开，base/top 是窗边界而不是云界（R2 已标记，未修）
 *
 * 参照系：用 1 m 步长的同一套插值规则当"连续"参考（不是真值，只是把 E1/E2 压到 1 m 量级），
 * 量 50 m 步长在 50 个相位下相对它的偏差分布。
 *
 * 判据一律用生产阈值（≥80% 成层 / 净空 ≥200 / 层厚 ≥300），只读，不改生产代码。
 * 运行：node q6-grid-phase-stability.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../../../../')
const CFF = require(path.join(ROOT, 'miniprogram/utils/cloud-field-svg.js'))
const WCFF = require(path.join(ROOT, 'miniprogram/utils/weather-cloud-field.js'))

const COVER = 80, CLEAR = 200, THICK = 300, STEP = 50
const PHASES = []
for (let o = 0; o < STEP; o++) PHASES.push(o)          // 0..49 m：一整格内的所有相位
const SNAPSHOTS = [
  { name: '3 站 × 72h', p: 'docs/weather-ux/qa/v2-window-adaptive-2026-10-09/tools/real-cloud.json', days: 3 },
  { name: '4 站 × 168h（含稻城）', p: 'docs/weather-ux/qa/v2-r1-gates-audit-2026-10-09/tools/real-cloud-g2.json', days: 7 },
]

/* 层提取：步长与起点偏移都由参数给，规则与生产 cloudLayersAt 一致（线性插值穿阈值） */
function layersAt (at, t, lo, hi, step, off) {
  const pts = []
  for (let a = lo + off; a <= hi; a += step) pts.push({ alt: a, cover: at(t, a) })
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= COVER, prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      const cr = !!(prev && prev.cover < COVER)
      const base = cr ? prev.alt + (COVER - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : pts[i].alt
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover], baseCut: !cr }
    } else if (on && run) { run.top = pts[i].alt; run.covers.push(pts[i].cover) }
    else if (!on && run) {
      run.top = prev.cover > COVER
        ? prev.alt + (COVER - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt) : prev.alt
      run.topCut = false; runs.push(run); run = null
    }
  }
  if (run) { run.top = hi; run.topCut = true; runs.push(run) }
  return runs.map(function (l) {
    return { base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce((a, b) => a + b, 0) / l.covers.length),
      cut: l.baseCut === true || l.topCut === true, baseCut: l.baseCut === true, topCut: l.topCut === true }
  }).sort((a, b) => a.base - b.base)
}
/* 选层 + 判定：返回该小时的判定与关键读数（与 detectCloudSeaCandidates 同一条链） */
function judge (L, u) {
  const below = L.filter(l => l.top <= u)
  if (!below.length) return { v: 'NO_LAYER_BELOW' }
  const l = below[below.length - 1], c = u - l.top
  const r = { layer: l, clearance: Math.round(c) }
  if (c < CLEAR) return Object.assign(r, { v: c < 0 ? 'USER_INSIDE_CLOUD' : 'USER_NOT_ABOVE_CLOUD' })
  if (l.meanCover < COVER) return Object.assign(r, { v: 'LOW_COVERAGE' })
  if (l.thickness < THICK) return Object.assign(r, { v: 'INSUFFICIENT_THICKNESS' })
  return Object.assign(r, { v: 'CANDIDATE' })
}
const spread = a => a.length ? Math.max.apply(null, a) - Math.min.apply(null, a) : null
const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * p
  return Math.round(s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i))) }

const out = { generatedAt: new Date().toISOString(),
  口径: { 步长: STEP, 相位: '0..' + (STEP - 1) + ' m（一整格内全部起点偏移）', 参照: '1 m 步长同规则（把 E1/E2 压到 1 m 量级，不是真值）',
    判据: { 成层覆盖: COVER, 净空: CLEAR, 层厚: THICK }, 扫描带: [CFF.ALT0, CFF.ALT1] },
  快照: [] }

SNAPSHOTS.forEach(function (sn) {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, sn.p), 'utf8'))
  const rows = []
  let hours = 0, flipHours = 0
  const 相位极差 = { 云顶: [], 云底: [], 层厚: [], 覆盖: [], 净空: [] }
  const 参照偏差 = { 云顶: [], 层厚: [], 净空: [] }
  const 分条件极差 = {
    '被带切到的层': { 样本小时数: 0, 云底有位移的小时: 0, 云顶有位移的小时: 0, 云底: [], 云顶: [], 层厚: [] },
    '两端都实测的层': { 样本小时数: 0, 云底有位移的小时: 0, 云顶有位移的小时: 0, 云底: [], 云顶: [], 层厚: [] },
  }
  const 归因 = { 边界截断参与: 0, 业务阈值贴线: 0, 选到不同层_采样插值: 0, 其他: 0 }
  const 候选贴线 = []
  const 相位一致率 = { 判定恒定: 0, 判定可变: 0 }

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
      for (let h = 0; h < cf.times.length; h++) {
        hours++
        const js = PHASES.map(function (o) {
          return judge(layersAt(at, h, CFF.ALT0, CFF.ALT1, STEP, o), p.elevation)
        })
        const vs = new Set(js.map(x => x.v))
        if (vs.size > 1) {
          flipHours++
          相位一致率.判定可变++
          /* 归因（互斥优先）：
             ① 边界截断参与 —— 有的相位里层贴到扫描带上下界（cut=true），有的没有
             ② 业务阈值贴线 —— 层没换，但净空/层厚在相位之间跨过门槛
             ③ 选到不同层 —— 相位改变了采样落点，因而插值出不同的层边界、选中不同的层 */
          const anyCut = js.some(x => x.layer && x.layer.cut)
          const noCut = js.some(x => x.layer && !x.layer.cut)
          const layerKey = x => x.layer ? (x.layer.base + '|' + x.layer.top) : ('无层:' + x.v)
          const sameLayer = new Set(js.map(layerKey)).size === 1
          const 跨净空 = js.some(x => x.layer && x.clearance >= CLEAR) && js.some(x => x.layer && x.clearance < CLEAR)
          const 跨层厚 = js.some(x => x.layer && x.layer.thickness >= THICK) && js.some(x => x.layer && x.layer.thickness < THICK)
          if (anyCut && noCut) 归因.边界截断参与++
          else if (sameLayer && (跨净空 || 跨层厚)) 归因.业务阈值贴线++
          else if (!sameLayer) 归因.选到不同层_采样插值++
          else 归因.其他++
        } else { 相位一致率.判定恒定++ }
        const tops = js.filter(x => x.layer).map(x => x.layer.top)
        const bases = js.filter(x => x.layer).map(x => x.layer.base)
        const ths = js.filter(x => x.layer).map(x => x.layer.thickness)
        const cvs = js.filter(x => x.layer).map(x => x.layer.meanCover)
        const cls = js.filter(x => x.layer).map(x => x.clearance)
        if (tops.length) {
          相位极差.云顶.push(spread(tops)); 相位极差.云底.push(spread(bases))
          相位极差.层厚.push(spread(ths)); 相位极差.覆盖.push(spread(cvs)); 相位极差.净空.push(spread(cls))
        }
        /* 分条件极差：极差到底是"方法噪声"还是"被带切到的边界在跟着偏移走"？
         * 按偏移 0 处该层是否被截断分两桶——若 cut 桶大、measured 桶为 0，
         * 则相位噪声的主体就是 R2 已经标记出来的那一类边界。 */
        const l0 = js[0].layer
        if (l0) {
          const bucket = l0.cut ? '被带切到的层' : '两端都实测的层'
          const b = 分条件极差[bucket]
          b.样本小时数++
          b.云底.push(spread(bases)); b.云顶.push(spread(tops)); b.层厚.push(spread(ths))
          if (bases.length && spread(bases) > 0) b.云底有位移的小时++
          if (tops.length && spread(tops) > 0) b.云顶有位移的小时++
        }
        /* 参照：1 m 步长 */
        const ref = judge(layersAt(at, h, CFF.ALT0, CFF.ALT1, 1, 0), p.elevation)
        const o0 = js[0]
        if (ref.layer && o0.layer) {
          参照偏差.云顶.push(Math.abs(o0.layer.top - ref.layer.top))
          参照偏差.层厚.push(Math.abs(o0.layer.thickness - ref.layer.thickness))
          参照偏差.净空.push(Math.abs(o0.clearance - ref.clearance))
        }
        if (o0.v === 'CANDIDATE') 候选贴线.push({ 地点: p.name, 日: day, 时: h, 净空: o0.clearance,
          距净空门槛: o0.clearance - CLEAR, 层厚: o0.layer.thickness, 距层厚门槛: o0.layer.thickness - THICK,
          该层是否被带切: o0.layer.cut, 五十个相位里判定数: new Set(js.map(x => x.v)).size })
      }
    }
  })

  out.快照.push({ 快照: sn.name, 取数日: snap.date, 小时数: hours,
    因相位平移而判定不同的小时: flipHours, 占比: Math.round(flipHours / hours * 1000) / 10 + '%',
    相位一致率: 相位一致率,
    翻转归因: 归因,
    同一小时在50个相位下的读数极差: {
      云顶: { 中位: q(相位极差.云顶, 0.5), P90: q(相位极差.云顶, 0.9), 最大: Math.max.apply(null, 相位极差.云顶) },
      云底: { 中位: q(相位极差.云底, 0.5), P90: q(相位极差.云底, 0.9), 最大: Math.max.apply(null, 相位极差.云底) },
      层厚: { 中位: q(相位极差.层厚, 0.5), P90: q(相位极差.层厚, 0.9), 最大: Math.max.apply(null, 相位极差.层厚) },
      平均覆盖: { 中位: q(相位极差.覆盖, 0.5), P90: q(相位极差.覆盖, 0.9), 最大: Math.max.apply(null, 相位极差.覆盖) },
      净空: { 中位: q(相位极差.净空, 0.5), P90: q(相位极差.净空, 0.9), 最大: Math.max.apply(null, 相位极差.净空) } },
    相对1米参照的偏差_偏移0: {
      云顶: { 中位: q(参照偏差.云顶, 0.5), P90: q(参照偏差.云顶, 0.9), 最大: Math.max.apply(null, 参照偏差.云顶) },
      层厚: { 中位: q(参照偏差.层厚, 0.5), P90: q(参照偏差.层厚, 0.9), 最大: Math.max.apply(null, 参照偏差.层厚) },
      净空: { 中位: q(参照偏差.净空, 0.5), P90: q(参照偏差.净空, 0.9), 最大: Math.max.apply(null, 参照偏差.净空) } },
    分条件极差: Object.keys(分条件极差).reduce(function (acc, kk) {
      const b = 分条件极差[kk]
      acc[kk] = { 样本小时数: b.样本小时数, 云底随相位位移的小时: b.云底有位移的小时, 云顶随相位位移的小时: b.云顶有位移的小时,
        云底极差: { 中位: q(b.云底, 0.5), P90: q(b.云底, 0.9), 最大: Math.max.apply(null, b.云底.concat([0])) },
        云顶极差: { 中位: q(b.云顶, 0.5), P90: q(b.云顶, 0.9), 最大: Math.max.apply(null, b.云顶.concat([0])) },
        层厚极差: { 中位: q(b.层厚, 0.5), P90: q(b.层厚, 0.9), 最大: Math.max.apply(null, b.层厚.concat([0])) } }
      return acc
    }, {}),
    候选贴线情况: 候选贴线.map(x => ({ 地点: x.地点, 日: x.日, 时: x.时, 净空: x.净空, 距净空门槛: x.距净空门槛, 层厚: x.层厚, 距层厚门槛: x.距层厚门槛, 该层是否被带切: x.该层是否被带切, 五十个相位里判定数: x.五十个相位里判定数 })),
  })
})

/* 可复现案例：峨眉山 2026-10-09 02:00（上一轮报告点名的那一小时） */
;(function () {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, SNAPSHOTS[0].p), 'utf8'))
  const p = snap.places.emeishan
  const cf = WCFF.buildCloudFieldRange({ cloudLevels: p.cloudLevels }, { startDate: '2026-10-09', hours: 24, userAltitude: p.elevation })
  const col = CFF.makeColumnSampler(cf)
  const at = (t, a) => CFF.sampleAtStations(col, cf.times.length, t, a)
  const rows = [0, 10, 25, 40, 49].map(function (o) {
    const L = layersAt(at, 2, CFF.ALT0, CFF.ALT1, STEP, o)
    const j = judge(L, p.elevation)
    return { 偏移: o, 层集合: L.map(l => [l.base, l.top, l.thickness, l.meanCover, l.cut ? 'cut' : 'measured']),
      判定: j.v, 净空: j.clearance == null ? null : j.clearance }
  })
  const ref = judge(layersAt(at, 2, CFF.ALT0, CFF.ALT1, 1, 0), p.elevation)
  out.可复现案例 = { 地点: p.name, 海拔: p.elevation, 日: '2026-10-09', 时: '02:00',
    各相位读数: rows, '1米参照': { 判定: ref.v, 净空: ref.clearance, 层: ref.layer ? [ref.layer.base, ref.layer.top, ref.layer.thickness, ref.layer.meanCover] : null },
    说明: '同一份数据、同一套阈值，只把扫描起点平移 <50 m；净空跨过 200 m 门槛即判定翻转' }
})()

console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(path.join(__dirname, '..', 'q6-grid-phase-stability.json'), JSON.stringify(out, null, 2))
