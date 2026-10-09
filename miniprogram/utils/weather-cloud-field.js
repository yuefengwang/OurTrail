/* Weather Cloud Field adapter —— 生产天气返回体 → Cloud Field（wx-free 纯函数）
 *
 * 职责边界（Weather V2 Phase 1）：
 *   输入  lib/weather.js 透出的 cloudLevels（Time × pressure-level × cover，海拔=位势高度）
 *   输出  { times:[0..n-1], altitudes:[m…], values:[time][alt]=cover%, userAltitude, meta }
 *         —— utils/cloud-field-svg.js 渲染器的唯一数据契约
 *   不做：SVG / 等值带 / 云态判断（那是 renderer 与 interpretation 层的事）
 *
 * 防御规则（Phase 1 §六/§十八）：
 *   ▸ cloudLevels 缺失/为空/异常 → 返回 null（页面隐藏云场卡，绝不抛错）；
 *   ▸ 某小时有效层 <2 → 该列用时间上最近可用列回填（渲染连续性；meta.gapHours 可查）；
 *   ▸ 全部小时不可用 → null；
 *   ▸ cover 0–100 clamp、非有限值丢弃；NaN 永远不会进入 renderer。
 */
'use strict'

const ALT_MIN = 0
const ALT_MAX = 7000
const ALT_STEP = 250

function altitudesGrid() {
  const g = []
  for (let a = ALT_MIN; a <= ALT_MAX; a += ALT_STEP) g.push(a)
  return g
}

/* 某小时的有效 (海拔, 云量) 对：跳过 null/非有限值，按海拔升序 */
function validPairs(cl, gi) {
  const pairs = []
  for (let li = 0; li < cl.levels.length; li++) {
    const lv = cl.levels[li]
    const alt = lv.altitudes ? lv.altitudes[gi] : null
    const cov = lv.cloudCover ? lv.cloudCover[gi] : null
    if (Number.isFinite(alt) && Number.isFinite(cov)) {
      pairs.push({ alt: alt, cover: Math.max(0, Math.min(100, cov)) })
    }
  }
  pairs.sort(function (a, b) { return a.alt - b.alt })
  return pairs
}

/* 单列重采样：层间线性插值到统一海拔网格。
 * 实测范围之外置 0（不再把端点层的云量平推到 0m/7000m）——旧写法等于凭空补出一段
 * 没有测量依据的云：真实数据里成都实测 146–6674m，被平推成整轴有值；层底在 4300m 的
 * 高台站点会把剖面下半幅涂成有云。0 的语义是「此处无数据」，渲染据此留白，
 * 判读据 covered 说相对位置，两侧都不再外插。
 * 实测范围内保持线性内插：三地点 24h 全量实测相邻层最大间隙仅 489m（>600m 的规则试过，
 * 它的 min() 兜底会抹掉两侧取值差异大的真实厚云带——负结果，见审计 §四）。 */
function resampleColumn(pairs, altitudes) {
  return altitudes.map(function (alt) {
    if (alt < pairs[0].alt || alt > pairs[pairs.length - 1].alt) return 0
    for (let k = 1; k < pairs.length; k++) {
      if (alt <= pairs[k].alt) {
        const gap = pairs[k].alt - pairs[k - 1].alt
        const s2 = gap === 0 ? 0 : (alt - pairs[k - 1].alt) / gap
        const v = pairs[k - 1].cover + (pairs[k].cover - pairs[k - 1].cover) * s2
        return Math.max(0, Math.min(100, Math.round(v * 10) / 10))
      }
    }
    return 0
  })
}

/**
 * @param result  天气接口返回体（含 cloudLevels 时才可构建）
 * @param opts    { date: 'YYYY-MM-DD'（缺省取前 24h）, userAltitude: m }
 * @returns cloudField | null（null = 数据不可用，调用方降级隐藏）
 */
function buildCloudField(result, opts) {
  return buildCloudFieldRange(result, Object.assign({}, opts, { hours: 24 }))
}

/**
 * Phase 4：多日窗口（48/72h）。与 buildCloudField 共享全部防御与重采样逻辑，
 * 仅窗口选择不同：从 startDate 起（或序列头）连续取 hours 个小时样本。
 * @param opts { startDate, hours: 24|48|72, userAltitude }
 */
function buildCloudFieldRange(result, opts) {
  opts = opts || {}
  try {
    const cl = result && result.cloudLevels
    if (!cl || !cl.times || !cl.times.length || !cl.levels || !cl.levels.length) return null

    const want = Number.isFinite(opts.hours) && opts.hours > 0 ? Math.min(168, Math.round(opts.hours)) : 24
    /* 窗口：优先从 startDate 起（连续取 want 个小时，跨日顺延）；无匹配则取序列头 */
    let startIdx = -1
    if (opts.date || opts.startDate) {
      const wantDate = opts.startDate || opts.date
      startIdx = cl.times.findIndex(t => String(t).slice(0, 10) === wantDate)
    }
    const idx = []
    for (let i = (startIdx >= 0 ? startIdx : 0); i < cl.times.length && idx.length < want; i++) {
      idx.push(i)
    }
    if (idx.length < 6) return null // 少于 6 个小时样本不构成可读的场

    const altitudes = altitudesGrid()
    const values = []
    const gapHours = []
    let firstUsable = null
    let lastUsable = null
    let coveredLo = null, coveredHi = null   // 真实数据覆盖的海拔范围（外插区域不属于数据）
    for (let r = 0; r < idx.length; r++) {
      const pairs = validPairs(cl, idx[r])
      if (pairs.length < 2) {
        gapHours.push(r)
        values.push(null) // 占位，随后回填
        continue
      }
      const lo = pairs[0].alt, hi = pairs[pairs.length - 1].alt
      if (coveredLo === null || lo < coveredLo) coveredLo = lo
      if (coveredHi === null || hi > coveredHi) coveredHi = hi
      const row = resampleColumn(pairs, altitudes)
      if (firstUsable === null) firstUsable = r
      lastUsable = r
      values.push(row)
    }
    if (firstUsable === null) return null
    /* 缺失列回填：前导用首可用列，后缀用末可用列，中段用最近可用列（仅渲染连续性） */
    for (let r = 0; r < values.length; r++) {
      if (values[r]) continue
      let near = null, dist = values.length
      for (let k = 0; k < values.length; k++) {
        if (values[k] && Math.abs(k - r) < dist) { dist = Math.abs(k - r); near = values[k] }
      }
      values[r] = near ? near.slice() : (lastUsable || firstUsable).slice()
    }

    const userAlt = Number.isFinite(opts.userAltitude) ? Math.round(opts.userAltitude) : null
    return {
      times: values.map(function (_, i) { return i }),
      altitudes: altitudes,
      values: values,
      userAltitude: userAlt,
      /* 数据覆盖的海拔范围：覆盖范围之外（用户高于/低于全部层）时，
         云态必须按「覆盖区与用户的相对位置」推导，不得采样外插值 */
      covered: (coveredLo != null && coveredHi != null) ? { lo: Math.round(coveredLo), hi: Math.round(coveredHi) } : null,
      meta: { gapHours: gapHours, hours: values.length },
    }
  } catch (e) {
    return null
  }
}

module.exports = { buildCloudField, buildCloudFieldRange }
