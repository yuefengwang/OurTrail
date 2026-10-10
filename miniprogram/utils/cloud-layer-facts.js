/**
 * 天气三层架构 · L1→L2 边界：云场采样 → 云层事实
 *
 * ── 为什么单独有这个文件 ────────────────────────────────────────────
 * 「沿海拔找 ≥80% 的连续云层」这件事原来住在 `outdoor-intelligence.js`（L3 机会层）里，
 * 而且扫描范围直接读 `cloud-field-svg.ALT0/ALT1` —— 那对常量的本职是**剖面显示窗**
 * （「这张图画哪一段高度」，见铁律 27）。于是三件不同的事被一个常量管着：
 *   ① 数据到底测到哪儿（`covered`，L1 事实）
 *   ② 这张图画到哪儿（显示窗，纯显示层）
 *   ③ 业务上允许在哪儿找云（扫描范围，L3 判据的输入）
 * ②决定③是历史遗留，不是设计；R1 要解耦的正是这一条。本文件把③变成一个**显式入参**，
 * 默认值仍然等于今天的 `ALT0/ALT1` —— **本轮不改任何业务结果**，只是把边界画出来、
 * 让它可以被测试钉住、被 R1 安全替换。
 *
 * ── 职责边界（越界即错）────────────────────────────────────────────
 * L1（本文件）：读采样场，产出「云层事实」——每层的 base/top/thickness/cover，
 *   以及**每一端是实测边界还是扫描边界**（`baseBoundary`/`topBoundary`，R2 引入）。
 *   不做任何机会判定：不判净空、不判层厚够不够、不判窗口。
 * L2（`cloud-field-svg.inferState`）：此点与云带的位置关系（in/ok/mid + 五类判不出）。
 * L3（`outdoor-intelligence`）：候选、持续性、强度、置信、证据文案、窗口。
 *
 * 本文件**不含**任何机会阈值；`coverMin`/`step` 是层定义本身（"什么算一层云"），
 * 由调用方传入，默认沿用 `outdoor-intelligence.CLOUD_SEA` 的值 —— 数值一个没改。
 * 扫描范围缺省仍取显示窗常量，并且**如实标注来源** `source: 'display-window'`，
 * 这样"谁在决定业务扫描"在数据里看得见，而不是要靠读代码行号考古。
 *
 * wx-free：不得出现任何 wx.*（tools/cloud-layer-facts-test 在 node 下跑）。
 */

'use strict'

const CFF = require('./cloud-field-svg.js')

/* ---------- 三个高度范围：分开命名，不许互相顶替 ---------- */

/**
 * 业务扫描范围的**当前**来源。R1 换成相对带之后，这里应返回
 * `{ lo, hi, source: 'relative-to-point' | 'product-band' }` 之类，
 * 而 `layersAt` 的代码不需要再改 —— 这就是这个接缝存在的意义。
 */
function displayWindowScanRange () {
  return { lo: CFF.ALT0, hi: CFF.ALT1, source: 'display-window' }
}

/**
 * 把三层范围一次性摊开。任何一项无效 ⇒ 该项为 null，**不猜**。
 * @param opts { scanRange?, dataCoverage?, displayRange? }
 *   dataCoverage  = 适配器给的实测覆盖 { lo, hi }（L1 事实，不是显示窗）
 *   displayRange  = 剖面显示窗（纯显示，本模块只记录不使用）
 * @returns { scan, data, display, scanOutsideData: [m, m], notes: [string] }
 */
function resolveRanges (opts) {
  const o = opts || {}
  const scan = o.scanRange && Number.isFinite(o.scanRange.lo) && Number.isFinite(o.scanRange.hi) && o.scanRange.hi > o.scanRange.lo
    ? { lo: o.scanRange.lo, hi: o.scanRange.hi, source: o.scanRange.source || 'caller' }
    : displayWindowScanRange()
  const data = o.dataCoverage && Number.isFinite(o.dataCoverage.lo) && Number.isFinite(o.dataCoverage.hi) && o.dataCoverage.hi > o.dataCoverage.lo
    ? { lo: o.dataCoverage.lo, hi: o.dataCoverage.hi, source: o.dataCoverage.source || 'measured' }
    : null
  const display = o.displayRange && Number.isFinite(o.displayRange.lo) && Number.isFinite(o.displayRange.hi)
    ? { lo: o.displayRange.lo, hi: o.displayRange.hi } : null
  const notes = []
  /* 扫描范围是否超出实测覆盖：超出部分读到的是适配器填的 0，不是"没云"。
     这里只如实记账，不做裁剪 —— 裁剪会改变候选集合，那是 R1 要决策的事。 */
  let outside = [0, 0]
  if (data) {
    const below = Math.max(0, data.lo - scan.lo)
    const above = Math.max(0, scan.hi - data.hi)
    outside = [Math.round(below), Math.round(above)]
    if (below > 0) notes.push('扫描下界低于实测覆盖 ' + outside[0] + ' m：该段读到的是填充值 0，不等于无云')
    if (above > 0) notes.push('扫描上界高于实测覆盖 ' + outside[1] + ' m：该段读到的是填充值 0，不等于无云')
  } else {
    notes.push('无实测覆盖信息：无法判断扫描范围是否落在数据之内')
  }
  if (scan.source === 'display-window') notes.push('业务扫描范围当前取自剖面显示窗（R1 待解耦；本轮不改）')
  return { scan: scan, data: data, display: display, scanOutsideData: outside, notes: notes }
}

/* ---------- L1：云场采样 → 云层事实 ---------- */

/**
 * 对某时刻 t 沿海拔扫描，提取 ≥coverMin 的连续云层。
 * 层边界在相邻采样点间线性插值（子步长精度）。
 * **不做厚度/覆盖过滤** —— 那是 L3 检测器的判定条件，拒绝原因需要它。
 *
 * 逐字节沿用 `outdoor-intelligence.cloudLayersAt` 的算法（本轮只做搬家 + 范围入参化），
 * 由 `tools/cloud-layer-facts-test.js` 的新旧对拍与跨版本 A/B 证明业务结果不变。
 *
 * @param sample (t, alt) => cover%
 * @param t 小时（浮点，场采样是连续的）
 * @param ranges resolveRanges() 的产出（或直接 {scan:{lo,hi}}）
 * @param opts { coverMin, step }
 * @returns [{ base, top, thickness, meanCover, peakCover,
 *            baseBoundary, topBoundary, baseSource, topSource, scanLo, scanHi }] base/top 升序
 */
function layersAt (sample, t, ranges, opts) {
  const o = opts || {}
  const coverMin = Number.isFinite(o.coverMin) ? o.coverMin : 80
  const step = Number.isFinite(o.step) ? o.step : 50
  const scan = (ranges && ranges.scan) || displayWindowScanRange()
  const pts = []
  for (let alt = scan.lo; alt <= scan.hi; alt += step) {
    pts.push({ alt: alt, cover: sample(t, Math.min(alt, scan.hi)) })
  }
  const runs = []
  let run = null
  for (let i = 0; i < pts.length; i++) {
    const on = pts[i].cover >= coverMin
    const prev = i > 0 ? pts[i - 1] : null
    if (on && !run) {
      /* 进入点：与上一采样点线性插值（上一格已在层内则直接取该点） */
      const crossed = !!(prev && prev.cover < coverMin)
      const base = crossed
        ? prev.alt + (coverMin - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt)
        : pts[i].alt
      /* 第一个采样点就已经是浓云 ⇒ 这个 base 是**扫描下界**，不是测得的云底 */
      run = { base: base, top: pts[i].alt, covers: [pts[i].cover], baseBoundary: !crossed }
    } else if (on && run) {
      run.top = pts[i].alt
      run.covers.push(pts[i].cover)
    } else if (!on && run) {
      /* 退出点：插值到阈值（云在边缘变薄消失）——这是测出来的云顶 */
      run.top = prev.cover > coverMin
        ? prev.alt + (coverMin - prev.cover) / (pts[i].cover - prev.cover) * (pts[i].alt - prev.alt)
        : prev.alt
      run.topBoundary = false
      runs.push(run)
      run = null
    }
  }
  /* 扫到上界还在浓云：云顶落在扫描范围之外，这个数只是窗的边界 */
  if (run) { run.top = scan.hi; run.topBoundary = true; runs.push(run) }
  return runs.map(function (l) {
    return {
      base: Math.round(l.base), top: Math.round(l.top), thickness: Math.round(l.top - l.base),
      meanCover: Math.round(l.covers.reduce(function (a, b) { return a + b }, 0) / l.covers.length),
      peakCover: Math.round(Math.max.apply(null, l.covers)),
      baseBoundary: l.baseBoundary === true, topBoundary: l.topBoundary === true,
      /* 来源词表：与 baseBoundary/topBoundary 恒等，给读代码的人和测试用，
         不参与任何判定（判定只看布尔，避免有人拿字符串比较出第二套逻辑） */
      baseSource: l.baseBoundary === true ? 'scan-floor' : 'measured',
      topSource: l.topBoundary === true ? 'scan-ceiling' : 'measured',
      scanLo: scan.lo, scanHi: scan.hi,
    }
  }).sort(function (a, b) { return a.base - b.base })
}

/**
 * 「哪一层在查询点下方」——L3 候选层的选择规则。
 * 放在 L1 模块里是因为它是**纯几何**（不含阈值），而 L3 需要能单独测它。
 * ⚠ 已知脆弱性（本轮只登记，不改行为）：按 base 升序取最后一个 = 取最高的那一层，
 *   因此一层恰好结束在点下方的**薄层会屏蔽**下方真正厚层。
 *   实测复现：相对带上界夹到查询点海拔时，会造出 [3003,3004] 厚 1 m 的假层顶掉厚 560 m 的真层
 *   （qa/v2-q56-noise-audit-2026-10-10/README.md §2.4）。修它会改变候选集合 ⇒ 属 R1 决策。
 * @returns { layer, clearance } 或 null（点下方没有任何连续层）
 *   clearance 是**未取整**的原始差值 —— 取整会改变门槛比较的结果
 *   （199.6 m 四舍五入成 200 就把"不够净空"变成"够"），所以四舍五入留给 L3。
 */
function topmostBelow (layers, pointAlt) {
  if (!Array.isArray(layers) || !Number.isFinite(pointAlt)) return null
  const below = layers.filter(function (l) { return l.top <= pointAlt })
  if (!below.length) return null
  const L = below[below.length - 1]
  return { layer: L, clearance: pointAlt - L.top }
}

module.exports = {
  displayWindowScanRange,
  resolveRanges,
  layersAt,
  topmostBelow,
}
