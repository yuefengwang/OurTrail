# Production Gap Analysis —— Weather V2 原型 vs 生产系统

日期：2026-10-06 · 基线：master `9571660`（分支 feature/weather-v2）
审计范围：`docs/weather-ux/`（decision / weather-page-v2-design / provider-architecture / weather-ux-design / current-weather-architecture / meteoblue-*-integration）×
生产（`pages/weather`、`components/meteogram`、`components/space-time`、`utils/{sky,astro,weather-model,route-schedule}`、`cloudfunctions/trailApi/{lib/weather,index.js}`）×
测试（`tools/weather-page-test.js` 12 节 / `tools/weather-model-test.js` / `smoke-test.js`）。

> 结论先行：**生产系统的"引擎层"已经达到 V2 要求，差距几乎全部在"展示层"。**
> sky.js / astro.js / weather-model.js / lib/weather.js 的数据契约零改动即可支撑 V2 的 90%；
> 唯一的数据缺口是三个 optional 气象字段（风向/气压/露点）。
> 本审计的最终裁决是：**扩展现有 meteogram，不新建平行 Timeline 组件**（理由见 §3）。

---

## 1. Gap Matrix

| V2 能力 | Prototype | 当前生产 | 差距 | 是否需要修改 | 风险 | 落点 |
|---|---|---|---|---|---|---|
| 7-Day Strip（选择器，降权） | ✓ | ✓ 但信息过多（含日出行、大卡） | 小 | 是 | 低 | WXSS 缩卡 + WXML 去日出行 |
| Professional Weather Slot | ✓（meteoblue 模拟） | 无此槽位；由自绘图承担（决策已锁定） | — | 否（结构上就是自绘图） | — | 无需独立组件 |
| **24h Timeline（一屏）** | ✓ | 部分：meteogram 是 7 天横滚（22px/列），无 24h 视图 | 中 | 是 | 中 | **扩展 meteogram**：页面按 24/48/72h 切窗传参 |
| Cloud Layer Profile（带剖面+海拔线+三态） | ✓ | 部分：band 数据齐备；图上只有 cloud 行底部 2px 实条 | 中 | 是 | 中 | meteogram 新增 bandProfile 行 |
| User Altitude 线 | ✓ | 缺（带剖面行的一部分） | 小 | 是 | 低 | 同上（elevation 入参） |
| Wind Row（风向+风速共轴） | ✓ | 缺（数据无 windDir；风速只在 8 行列表） | 中 | 是 | 中 | 云函数 additive + meteogram wind 行 |
| 昼夜/黄金/蓝调轴 | ✓ | 部分：夜间底色有；黄金/蓝调/日出日落线无 | 小/中 | 是 | 低 | 页面算 sunBands 传入，meteogram 画轴带 |
| 「现在」线 / 点选高亮 | ✓ | 缺（点选=切日，非高亮） | 小 | 是 | 低 | meteogram now/pick 入参 |
| 点小时 → 详情浮条 | ✓ | 缺（点图=切日） | 小/中 | 是 | 低 | 页面 handler 改浮条（组件事件已带 t） |
| **Outdoor Agenda** | ✓ | 缺 | 大 | 是 | 中 | 新 `utils/agenda.js`（纯函数）+ 页面区块 |
| Cloud Sea 可见窗口 | ✓（设计） | 缺：01:00–05:00 也进窗口文案 | 中 | 是 | 低 | agenda 层与 civilDawn/Dusk 取交集（sky.js 不动） |
| **Conditions（总评+featured 云海+评级）** | ✓ | 有旧版：6 张 .sky-card 长文字 | 大 | 是 | 中 | 新 `utils/conditions.js` + 页面区块替换 |
| 评级语言（星+词，无百分比） | ✓ | 部分：三级词+score 数字 | 小 | 是 | 低 | conditions.js starsFor |
| **Evidence（事实清单+看图回跳）** | ✓ | 缺（依据埋在 text 字符串里） | 大 | 是 | 中 | conditions.factsFor + 页面 why 面板 |
| 看图 ↗ 真高亮 | ✓ | 缺 | 小/中 | 是 | 低 | pick 入参 + pageScrollTo |
| Numbers Sheet（全字段折叠） | ✓ | 有旧版：detailRows 少列（无体感/风向/气压/露点/云带） | 中 | 是 | 低 | buildDetailRows 扩列 + 降级 |
| 48h/72h | ✓ | 部分：只有 7 天横滚一种窗 | 中 | 是 | 中 | 与 24h 同一开关 |
| 重复信息消除（slots/metrics 卡） | ✓（无列表） | **8 行分时段摘要 + 「XX 的数字」卡与图三处重复** | 中 | 是（删除） | 低 | Phase 1 替换时移除 |
| space-time（时间×海拔×路线） | n/a | ✓（保留，职责不同） | — | 否 | — | 不动 |
| Provider abstraction | ✓ | 部分：lib/weather.js 已隔离 Open-Meteo，无 provider 元信息 | 小 | 是（最小 interface） | 低 | 响应加 `provider{}`（additive） |
| Meteoblue 接入 | Future | 无 | — | **否（有意不实现）** | — | 见 decision.md |
| WMO 雪码 bug 修复 | ✓（修正规则） | **bug 在**（71–86 误含阵雨 80–82） | 小 | 是 | 低 | buildCallouts 迁入 conditions.js 时修复 |
| Optional 字段降级 | ✓ | n/a（字段尚不存在） | 小 | 是 | 低 | 前端全路径 '—'/跳过 |

## 2. 已有能力清单（禁止重复造轮子）

| 已有能力 | 位置 | V2 用法 |
|---|---|---|
| 云层带重建 `cloudBandAt` / `band{base,top,cover}` | `lib/weather.js` | **直接复用**——bandProfile 行的数据源，算法零改动 |
| 天相判定 `hourMarks`（8 键）/ 结论 `summarize`（6 卡+分数+依据） | `utils/sky.js`（65 例测试钉住） | **直接复用**——Agenda/Conditions/Evidence 的唯一判定来源，阈值零改动 |
| 天文 `sunTimes`（**已含 civilDawn/civilDusk**）/ `photoWindows` / `moonInfo` | `utils/astro.js` | 直接复用——sunBands、Agenda 事件、云海可见性交集 |
| 插值/编排 `snap` / `nodeFacts` / `judge` / `runsOf` | `utils/weather-model.js` | 不动（space-time 与未来漫游用） |
| 抵达日 `route-schedule.js` | 不动 | 节点联动保持 |
| meteogram 画布基建：dpr/`scheduleSync` 双补测/`tapColumn` 滚动映射/夜间底/泳道标记/动态图例 | `components/meteogram` | **扩展它**（新行+新入参），全屏页同时受益 |
| 窗口复用 `covers` / 同窗锚定 `buildChartSeries`（7 天） | `pages/weather` | 不动——全屏交接与缓存契约依赖 7 天语义（weather-page-test §6/§10/§11 钉住） |
| 分享降精度/存点/草稿/三模式上下文 | `pages/weather` | 不动 |

## 3. 裁决：扩展现有 meteogram，不新建 weather-timeline 组件

按任务 §9 要求给出「为什么升级旧组件比新建组件风险更高」的论证：

1. **架构上无障碍**：meteogram 的行布局是数据驱动的 `ROW` 表（layout.js），新增两行（bandProfile/wind）是加表项+加两个 draw 函数；列宽、滚动、点击换算、dpr 补测全部与行数无关。
2. **新组件的成本是双倍的坑**：canvas 同层偏移（100/320ms 双补测）、dpr 缩放、tapColumn 滚动映射、夜间底——这四类坑在旧组件里都修过且有测试（weather-page-test §9/§9b/§10）；新组件意味着这些回归保护全部重来。
3. **同一组件服务两种窗**：全屏 7 天页与页面内 24/48/72h 共用一套绘制，新能力（云带剖面/风/日照轴）自动惠及全屏页，不会出现「两套图讲两套话」。
4. **数据形状完全一致**：新行消费的是 series 里**已经存在**的 `band`/`wind` 与新增 optional `windDir`，无形状分叉。

「升级旧组件」的代价与对策：CHART_H 增高（202→≈254）影响全屏页排版（390px 高的横屏视口放得下，含图例）；`weather-page-test §9` 的行顺序数组需同步扩展（这是测试跟随实现，不是放宽）。

## 4. 必须替换（而非叠加）的旧 UI

任务 §14/§15 的核心禁令是「V1+V2 叠加」。逐块裁决：

| 旧块 | 裁决 | 理由 |
|---|---|---|
| 7 日概览条 | **保留+降权** | 日期选择器职责唯一 |
| meteogram（7 天） | **升级为 24/48/72h 可切**；7 天全周期保留在横屏页（「全图展示」入口不变） | 页面主图职责=当日决策 |
| 分时段摘要（8 行 slots） | **删除** | 温度/降水/风已被 Timeline 完整表达（§15：不得用另一张 8 行列表重复） |
| 「{{date}} 的数字」指标卡 | **删除**（信息分流） | 日出日落/暗夜→轴与 Agenda；云量/云带→Timeline 与 Numbers；月相→Evidence（银河/星空）；入云警告→callouts |
| 天相结论 6 张 .sky-card | **替换**为 Conditions 区（总评+featured 云海+其余评级卡+Evidence） | 晨昏光窗口卡（客观时刻）由 Agenda 与日照轴承担，不再以"结论卡"形式出现 |
| 逐小时明细（折叠） | **保留+扩列**（= Numbers Sheet） | 职责唯一：原始数字 |
| space-time | **保留不动** | 时间×海拔×路线，职责不同（§24） |
| 安全 callouts | **保留+修 WMO bug**，挂到 Conditions 总评卡下 | 安全规则≠天相判断 |
| 云海 success callout（「清晨云海概率较大」） | **删除** | 与 Conditions 的云海 featured 卡重复（两处结论打架正是 V1 病根） |

## 5. 数据缺口（全部 additive）

| 字段 | Open-Meteo 变量 | 消费方 | 缺失降级 |
|---|---|---|---|
| `windDir` | `wind_direction_10m` | Timeline 风行箭头 / Numbers | 无箭头只画数值 |
| `pressure` | `surface_pressure` | Numbers | 显示 — |
| `dewPoint` | `dew_point_2m` | Numbers | 显示 — |
| `provider{}` | （常量） | 页脚署名 | 回退硬编码文案 |

前端所有消费点按「字段可能缺失」编写（新客户端配旧云函数是常态——weather-page-test §11 的既有主题）。

## 6. 测试基线与影响面

| 套件 | 现状 | V2 影响 |
|---|---|---|
| `tools/weather-page-test.js`（12 节） | 全绿 | §9 行顺序数组随新行扩展；§6/§10/§11 的 7 天语义**保持不变**（视图切片走新函数）；slots/metrics 无测试锚；§7/§12 竞态与 local 流程不动 |
| `tools/weather-model-test.js` | 全绿 | **零影响**（weather-model.js 不改） |
| `smoke-test.js` | 全绿 | hourView 加 optional 字段——presence 断言不受影响，跑通为准 |
| `check.js` / `check-handlers.js` | 全绿 | WXML 改动后必跑 |
| Weather 专项 E2E | **不存在**（A 层 e2e-test.js 不含 weather 动作；天气由上述套件+真机 QA 把守） | 本任务新增 `tools/weather-v2-test.js`（Snow/可见性/Evidence/降级）与 `tools/meteogram-draw-test.js`（记录式 2D 上下文执行真实 draw()，钉住 V2 新图层与降级路径——在真机 QA 之外提供常驻回归网） |

**真机像素 QA 环境备注（2026-10-06，已解除）**：微信开发者工具对 `D:\OurTrail` 路径的注册态损坏，模拟器编译报 `app.json: 在项目根目录未找到 app.json`。根因定位（builder 源码级）：`corecompiler/original/json/projectconfig.js` 的 `_getProjectConfigJSON` 在项目文件列表里 `stat("", "project.config.json")` 失败时对小程序类型**静默返回 `{}`** → `miniprogramRoot=""` → `appJSON.js` 走「根目录未找到」分支。证据链：①干净 master 同错；②同文件复制到新路径 `✔ preview` 通过（含 .git 全根复制亦通过）；③`project.config.json` 自初始提交未动；④清 `WeappCompileCache`/`last_compiled`/`project2_D:\OurTrail` 持久桶无效（`last_compiled` 桶确实损坏过——19 字节残缺写 `project2_D:OurTrail`，系多 agent 互杀 IDE 时的中断写）。**Workaround**：工作树复制到新路径开模拟器（QA 即按此完成）；`D:\OurTrail` 的注册态需人工清理 IDE 用户数据或重装。

## 7. 风险登记

| 风险 | 对策 |
|---|---|
| 新行把全屏页撑破 | CHART_H 254 < 390 视口；真机 QA 含横屏页 |
| 页面 assemble 层引入 wx.* 破坏 node 测试 | applyWeather 保持 wx-free（太阳带/日程全用纯函数算） |
| 24h 一屏的列宽 | 固定 11.5px/列（24×11.5+60=336 ≤ 343），不读 windowWidth（避免 node 测试桩） |
| 看图跳转在真机的滚动 | `wx.pageScrollTo` 带 selector + fail 兜底；node 下守卫 |
| 旧结论卡文案丢失 | summarize 的 text/look 全量保留，只是换容器；不重写任何文案 |

---

*下一份：[production-implementation-plan.md](production-implementation-plan.md)（A~G 迁移方案与阶段划分）。*
