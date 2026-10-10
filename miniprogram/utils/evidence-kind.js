/**
 * 天气三层架构 · 结构化证据的类别词表（切片二）
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────
 * 证据行 `{ fact, at }` 只有字符串。呈现层 `oi-presentation.summaryOf` 想挑「这张卡的一句话依据」，
 * 以前写的是一句**按文案字面**的匹配：
 *     evidence.find(e => e.fact.indexOf('云区') >= 0 || e.fact.indexOf('云层位于') >= 0)
 * 于是 R2 那一轮把「云层位于 2,000–3,300 m」改成「云底低于剖面扫描窗下界…」时，
 * 摘要选中了哪一行**是文案改动的副作用**（`tools/outdoor-cloud-sea-test.js` 当时只能把
 * 这个巧合钉成断言）。改一句中文 = 改一次接口，这就是"文案即契约"的病根。
 *
 * 现在每条证据在它**产生的地方**带一个 `kind`（这个文件里的枚举值），
 * 摘要由「类别 + 呈现层声明的优先序」决定，与中文怎么写脱钩：
 *   产生处（L2/L3：`outdoor-intelligence`、`conditions.factsFor`）负责**这是什么事实**；
 *   呈现层（`oi-presentation`）负责**哪一类值得当摘要**（`SUMMARY_KIND_PRIORITY`）。
 * 两边都不许再用 `includes()` / 正则 / 字符串前缀 / 数组下标做业务分支。
 *
 * ── 边界 ────────────────────────────────────────────────────────────
 * 纯词表，不含阈值、不含判定、不 require 任何东西（谁都能引，不会形成环）。
 * 值一旦发布就是契约：`kind` 是稳定标识，改名等于改接口，必须同时改产生处与呈现层。
 *
 * wx-free：不得出现任何 wx.*。
 */

'use strict'

const KIND = {
  /* —— 云层与查询点的几何关系（摘要首选）—— */
  LAYER_POSITION: 'layer-position',   // 云层带在哪儿、与此点谁高谁低
  CLEARANCE: 'clearance',             // 此点高出云顶多少 m
  LAYER_EXTENT: 'layer-extent',       // 这一层多厚 / 多实（含"按窗内可见部分计算"的下限形态）
  /* —— 时间与天气过程 —— */
  DURATION: 'duration',               // 窗口持续多久
  WIND: 'wind',                       // 风
  PRECIP: 'precip',                   // 降水（含前日降水这类历史性事实）
  /* —— 天空本身 —— */
  CLOUD_AMOUNT: 'cloud-amount',       // 低/中/高层云量
  SKY_CLARITY: 'sky-clarity',         // 「判过了是晴空」：此点与邻域云量都低
  VISIBILITY: 'visibility',
  HUMIDITY: 'humidity',
  MOONLIGHT: 'moonlight',
  SUNRISE_OVERLAP: 'sunrise-overlap', // 价值增强项，不是检测条件
  /* —— 数据与主张的边界（说清我们不知道什么）—— */
  DATA_COVERAGE: 'data-coverage',     // 实测覆盖到哪个高度（数据的事实，不是云的事实）
  ABSTAIN: 'abstain',                 // 这一小时为什么判不出（未知，不是"无云"）
  NIGHT_LIMIT: 'night-limit',         // 光污染/地形遮挡无数据源，未纳入判断
}

module.exports = { KIND }
