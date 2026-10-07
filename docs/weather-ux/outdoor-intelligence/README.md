# Outdoor Intelligence —— 户外智能层（Weather V2）

> 普通天气 App 告诉用户「明天 16:00 有云」。
> OurTrail 告诉用户「明天 16:00–18:00，你所在海拔正好进入云层；
> 如果想拍云海，应该提前到 15:30」。

## 文档

| 文档 | 内容 |
|---|---|
| [decision.md](decision.md) | 三级体系决策 / 既有逻辑审计 / 复用地图 / 模块边界 |
| [window-model.md](window-model.md) | L2 Condition 与 L3 Window 的统一数据结构与聚类规则 |
| [opportunity-registry.md](opportunity-registry.md) | 全部机会类型注册表（已有/新抽象/待实现）+ heuristic 审计 |
| [evidence-model.md](evidence-model.md) | 证据模型（结构化、来源、置信分档、反模式） |
| [cloud-sea.md](cloud-sea.md) | Cloud Sea 检测器（OI-2：层提取/候选/合并/强度/阈值） |

## 实现

- `miniprogram/utils/outdoor-intelligence.js`（wx-free 纯函数，Node 可测）
- `tools/outdoor-intelligence-test.js`（24 断言：Condition 四态 / Window 聚类 /
  Evidence / Silence / Determinism / 三海拔 / 性能）
- `tools/outdoor-cloud-sea-test.js`（20 断言：Cloud Sea 几何/覆盖/层厚/时间/多层/风/沉默/确定性）

## Production Integration（OI Phase 2，2026-10-07）

- `miniprogram/utils/oi-presentation.js`（presentation adapter：MODEL ≠ PRESENTATION，
  OI 模型产出 → 页面卡数据；tier 分级词「确定/很值得关注/值得关注/条件一般」；
  机会时间轴 SVG 与 Meteogram 共用同一 timeScale——复用 meteogram-svg.timeScale）
- `miniprogram/pages/weather/`：新增「今天值得关注」卡（additive，
  独立 try/catch 降级；列表 + 可点时间轴 → selectHour 联动闭环）
- `tools/outdoor-intelligence-ui-test.js`（25 断言：适配器/tier/排序/tapZones/
  selectHour 联动/三海拔真实数据/降级/确定性/性能）
- 三地点预览截图：`../meteogram-html-prototype/screens/oi-*.svg/png`（375/390/414）

## Phase 4（2026-10-07）：48/72h Multi-Day Horizon

- **多日统一 Meteogram**：horizon 参数（24 默认，行为逐字节不变）——日界强线、
  day header（今天/明天/后天 + 每日 hi/lo 彩色标注）、昼夜按日分段渐变、
  图标 3h→4h/6h、风箭头 1h→2h/3h、轴 2h→6h（数据不减，视觉采样降密）；
  Cloud Field 连续跨日（同地垂直尺度恒定 0–7000m），YOU 线单次贯穿；
- **单一 crosshair**：selectedAbs（绝对小时），日期牌「明天 14:00」（Day1 无前缀）；
- **OI horizon 卡**：按日分组（今天/明天/后天）+ absHour 锚点，与多日 Meteogram
  共用 timeScale(width, horizon)；点机会/看图 ↗ → 跨日 selectHour 闭环；
- **数据层**：`buildCloudFieldRange(startDate, hours)`（与单日版共享防御与重采样）；
  逐日 OI（`buildOiDays`）共享缓存；
- **测试**：`tools/meteogram-multiday-test.js` 44 断言（尺度/日界/跨日选中/YOU 钳位/
  跨日锚点/部分日/24h 回归/响应式/确定性/性能）；
- **真实数据**：三地点 × 24/48/72（`screens/horizon-*.svg/png`）——无 NaN、无异常几何，
  SVG 30–91KB，构建 4–17ms。

## Phase 3（2026-10-07）：产品化收敛

- **tier 连续化**：确定（天文）/ 重点关注 / 值得关注 / 条件一般——连续语义无分数断层；
- **top3 折叠**：默认最多 3 个主要机会，「还有 N 个时段」一键展开；选中折叠区窗口自动提升；
- **跨零点**：presentation 层切段（模型输出真实时间不动）——「今晚 22:30 → 次日 02:40」，
  时间轴画两段（今晚段 + 次日段）；单小时窗（from==to）不算跨零点；
- **「进行中」标记**：now 落在窗口内时标注；时间轴画 now 细虚线（仅当天）；
- **48/72h IA**：多日摘要（今天/明天/后天 × 机会数 + Top1），点某天 → 既有切日链路 → 当日 24h 详情；
  Cloud Field 不扩展多日（48/72h 主图仍是经典 canvas，回退保留）；
- **Agenda/OI 去重**：OI 卡可见时，Agenda 的 L2「OurTrail 分析」窗口页面级过滤（agenda.js 不动），
  Agenda 保留天气转折与天文时刻（L1 节奏）；
- 测试：`tools/outdoor-intelligence-ui-test.js` 37 断言（含 tier 全集/跨零点切段/now/折叠提升/多日/模型层三海拔差异）。

## Evidence「看图 ↗」Anchor（2026-10-07）

- `evidenceAnchor(w2)`（presentation 层）：每个机会 → `{ kind:'meteogram', startHour, endHour,
  focusHour, focusLabel, label:'看图' }`；
  focus 优先级：证据最强时刻（evidence[0].at 落在窗内）→ 窗口中点（跨零点感知，单向累计）。
  任务书五例全命中：银河 00–05→02:00 · 云海 05–09→07:00 · 23–01→00:00 · 23–05@02:00→02:00；
- **复用全局唯一选中链路**：`onOiEvidence → selectHour(focusHour) → updateUnifiedSel（crosshair）
  → updateOiSel（高亮）`，不建第二套 selection state；选中态锚点变「看图 · HH:00」；
- **轻滚动**：`ensureMeteogramVisible` 仅当统一 Meteogram 不在视口时 pageScrollTo
  （selector 查询 + 视口判断，任何失败静默——滚动是增强不是功能依赖）；
- 48/72h：anchor 仍调用 selectHour（classic canvas 经 pick 联动），不报错不扩展；
- 测试：`tools/outdoor-intelligence-ui-test.js` 46 断言（新增 anchor 9 项：
  focus 规则/跨零点/窗外 at 回退/无 evidence 兜底/喂 applySelection 命中自身窗口）。

## 边界

- 不改 sky.js / astro.js / Cloud Field 数学 / Meteogram 渲染（全部冻结）；
- 阈值全部复用单源（sky.hourMarks 8 键 + Phase 1 云场 60/68/70/40）；
- Meteogram = Weather Facts 层；本层 = Interpretation 层；二者分离。
