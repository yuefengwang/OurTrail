# Production Implementation Plan —— Weather V2 最小迁移方案

日期：2026-10-06 · 分支：`feature/weather-v2` · 前置：[production-gap-analysis.md](production-gap-analysis.md)
原则：**Prototype 是 UX Source of Truth，不是 Production Source Code**——迁移的是信息架构、交互与视觉语言；实现走生产架构、生产契约、生产测试。

---

## A~G 七问

**A. 直接复用（零改动）：**
`lib/weather.js` 的 `fetchForecast/cloudBandAt/hourView` 契约 · `utils/sky.js` 全部 · `utils/astro.js` 全部（含 civilDawn/Dusk）·
`utils/weather-model.js` · `utils/route-schedule.js` · meteogram 的滚动/dpr/tap/夜间底基建 ·
`covers/buildChartSeries(7天)/buildChartMarks/buildNightMap/buildDayCards` · 三模式上下文/分享/存点/草稿 · `space-time` · `weather-chart` 全屏页。

**B. 扩展：**
1. `components/meteogram`：layout.js 加 `bandProfile`/`wind` 两行（CHART_H 202→254）；meteogram.js 加 band 剖面绘制（新入参 `elevation`）、风行（`windDir` 缺失降级）、日照轴带与日出日落线（新入参 `sunBands`/`sunLines`）、now 线（`now`）、点选高亮（`pick`）、温度极值标注；`weather-page-test §9` 行顺序数组同步扩展。
2. `pages/weather`：视图切片 `buildViewSeries`（24/48/72h，11.5px/列）+ 24/48/72 分段开关 + 小时浮条（onChartPickHour 语义改为选中小时）+ 7 日条降权（WXSS+去日出行）+ Numbers 扩列。
3. `lib/weather.js`：HOURLY 增 `wind_direction_10m, surface_pressure, dew_point_2m`，`hourView` 加 `windDir/pressure/dewPoint`（optional）；导出 `PROVIDER` 常量。

**C. 新建（仅两处，均为纯函数 + 页面区块，不建新组件）：**
1. `utils/agenda.js`——事件聚合：天文时刻（L1）+ 天气转折（L1）+ sky.hourMarks 簇（L2）；**云海簇与 civilDawn–civilDusk 取交集**（可见性修复的落点）。
2. `utils/conditions.js`——`isSnowCode`（**WMO 修复**：71–77 ∪ 85–86）、`buildCallouts`（自 weather.js 迁入，去云海 success callout）、`overallGrade`（复用 weather-model.judge 的「有戏项均值」规则）、`starsFor`（三级词→星）、`factsFor`（Evidence 事实清单，全部取样自 series/days，含 `at` 锚点小时）。
   页面区块（Agenda/Conditions/Evidence/浮条）用 WXML+WXSS 直接写——它们是纯展示，抽组件只会增加 usingComponents 面而不增加可测性。

**D. 已存在的数据字段（V2 直接消费）：** `temp/feels/pop/precip/showers/code/wind/gust/rh/cloud{low,mid,high}/uv/visibility/freezing/band{base,top,cover}/d/t` + days 全字段 + astro 全部天文时刻。**零新增即支撑**：温度线、降水柱、云量三带、云带剖面、海拔线、日照轴、夜间底、Agenda、Evidence、Numbers 的 80% 列。

**E. 需要云函数 additive 增加的字段：** `windDir`（风向箭头）、`pressure`（Numbers）、`dewPoint`（Numbers）、响应级 `provider{}` 元信息。全部 optional，旧客户端不受影响，新客户端对缺失全降级（§21）。

**F. 已存在的分析逻辑（直接复用）：** 天相判定与阈值（sky.hourMarks/summarize——Agenda/Conditions/Evidence 的唯一来源）、三级分档（sky.grade）、总评分规则（weather-model.judge 的有戏项均值）、晨昏光窗口（astro.photoWindows）、云海带（cloudBandAt）、抵达日（route-schedule）。**不复制任何阈值。**

**G. 只需改变展示方式的逻辑：** 6 张 sky-card 的结论数据（summarize.items 原样）→ 换成评级卡+可折叠 Evidence 容器；callouts 的数据规则 → 迁移+修 WMO；slots/metrics 卡的数字 → 分布到 Timeline/Agenda/Numbers 后删除原块。

## 阶段划分（每阶段独立验证：node 测试 + check + check-handlers）

| Phase | 内容 | 主要文件 | 验证 |
|---|---|---|---|
| 1 | 数据 additive（3 字段+provider）+ meteogram 扩展（云带剖面/风/日照轴/now/pick/极值标注）+ 24/48/72h 切换 + 小时浮条 + 删 slots/指标卡 + 7 日条降权 | lib/weather.js、index.js、meteogram/*、weather.* | weather-page-test（§9 数组扩展）+ smoke + check×2 |
| 2 | `utils/agenda.js` + Agenda 区块（含云海可见性交集） | utils/agenda.js、weather.* | 新增 weather-v2-test + 全套件 |
| 3 | `utils/conditions.js`（WMO 修复、callouts 迁移、overallGrade、starsFor）+ Conditions 区替换旧 sky-cards | utils/conditions.js、weather.* | 同上 |
| 4 | Evidence：factsFor + why 面板 + 看图↗（pageScrollTo + pick 高亮） | conditions.js、weather.* | weather-v2-test |
| 5 | Numbers 扩列（体感/风向/气压/露点/云带）+ 缺失降级 | weather.js | weather-v2-test（降级用例） |
| 6 | Bug 修复复核（Snow ✓ Phase 3 / 可见性 ✓ Phase 2 / optional ✓ Phase 1&5）——补齐遗漏 | — | weather-v2-test 全绿 |
| 7 | 清理：buildSlots/buildMetricsCard/SLOTS 死代码、WXML 残留、wxss 孤儿类 | weather.* | check×2 + 全套件 |
| 8 | 真机 DevTools Visual QA（375px：首屏/Timeline/Cloud/Agenda/Conditions/Evidence/Numbers/48h/72h/切日/切节点）+ 截图八问 | — | 截图记录 |

## 关键实现决定（写码前锁定）

1. **24h 一屏的列宽**：固定 `11.5px/列`（24×11.5+PAD_L52+PAD_R8=336 ≤ 343 内容宽），48/72h 同列宽横向滚动——同一字号，符合 §18「不允许缩小字体」。全屏页三种模式（4/22/44）不动。
2. **`buildChartSeries` 语义不动**（7 天，chartStore 交接与缓存契约依赖它）；页面视图切片用新纯函数 `buildViewSeries(chartSeries, date, span)`。
3. **组件新入参全部 optional**：`elevation/sunBands/sunLines/now/pick`——全屏页不传即得旧行为（渐进增强，零破坏）。
4. **applyWeather 保持 wx-free**（weather-page-test §10 在无 wx 环境直调）：sunBands/sunLines/agenda/conditions 全在纯函数层完成。
5. **看图↗ 的锚点**是具体小时（`at`），不是模糊区块：page 设置 `chartPick` + `wx.pageScrollTo({selector:'.timeline-card'})`（node 下守卫）。
6. **文案零重写**：summarize 的 text/look/window 原样进新容器；新增的只有评级词+星与 Evidence 事实行。
7. **云海 success callout 删除**（与 featured 卡重复）；danger/warning callouts 全保留。
8. 不动：space-time、weather-chart 页、weather-hub、分享/存点/草稿、covers/窗口契约、sky.js/astro.js/weather-model.js。

---

*实施记录见最终报告与 SYNC.md 条目。*
