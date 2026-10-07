# Decision —— Outdoor Intelligence Layer（Weather V2 Phase: OI-1）

日期：2026-10-07 · 性质：**产品架构决策 + 模型层实现**（不改生产 UI，不动冻结 renderer/阈值）
上游：[../weather-page-v2-design.md](../weather-page-v2-design.md)（§12 Agenda / §13 Evidence /
§14 可信度系统）· [../../miniprogram/utils/sky.js](../../miniprogram/utils/sky.js)（单源阈值）·
Phase 1 Cloud Field（cloudLevels → cloudField → inferState）

## 1. 核心决策

### D1 — 三级体系（不可越界）

```
L1 Weather Facts      温度/降水/23层云量剖面/云底顶/风/能见度/湿度/日出日落/太阳高度角/月照/银河季
                      —— 来自数据，永远不叫「适合徒步」
L2 Outdoor Condition  逐时环境状态：IN_CLOUD / CLOUD_BELOW / CLOUD_ABOVE / CLEAR
                      —— 由 Cloud Field ∩ userAltitude 推导（阈值 60/68/70/40，Phase 1 冻结）
L3 Opportunity        统一 Window 模型的户外机会：云海/入云/远眺/黄金光/蓝调/银河/星空/彩虹/光染
                      —— 由 L1+L2 聚类推导，带 evidence 与 confidence
```

Meteogram 回答 "What is the weather?"（L1），本层回答 "So what?"（L2/L3）。
**禁止把 L2/L3 塞进 Meteogram。**

### D2 — 不重复实现已有逻辑（审计结论，详见 [evidence-model.md](evidence-model.md)）

| 逻辑 | 现状 | 本层处置 |
|---|---|---|
| 逐时天相判定（8 键） | sky.hourMarks（单源阈值，图/卡/日程同源） | **复用**：本层只聚类成窗，不改阈值 |
| 云海 | sky.cloudSea 逐时标记（band≥80% + 带顶低于用户 + 高云<30 + 晨间） | **复用**阈值；本层补 civil 可见性交集与 field 证据 |
| 入云 | Phase 1 field(t, userAlt) ≥ 60 | **提升为 Condition**（IN_CLOUD），并聚类为入云窗口 |
| 彩虹 | 太阳高度 −2°..40° + 湿润（降水/湿度/低云）——heuristic，可靠部分=天文几何 | **复用**；evidence 引用 conditions.factsFor('rainbow') |
| 黄金/蓝调 | astro.photoWindows（分钟级确定性天文） | **复用**；作为第一批 confidence='明确' 的 Window |
| 银河/星空 | 暗夜 + 中高层云<30 + 无降水（+银心季+月照<35） | **复用**；月照/云量进 evidence |
| 远眺 | **缺失**（能见度数据在库但无解读） | **新抽象**：VIEW_WINDOW（晴/云下 + 高层云少 + 能见度） |
| 云态（云下/云上） | **缺失**（Phase 1 只有 renderer 内 inferState） | **新抽象**：L2 Condition 四态，按海拔泛化 |
| 证据结构化 | conditions.factsFor（cloudSea/alpenglow/rainbow/galaxy/star 已有） | **复用**；新类型补齐 |

### D3 — 置信与排序不伪造科学性

- confidence ∈ `明确`（天文确定性）/ `高` / `中` / `低`（证据强度分档）；
- **禁止** 0–100 分、百分比概率、徒步指数（产品总纲 §14 的「不输出伪精度」延续）；
- rank ∈ `primary`（稀有×高价值：云海/光染/银河）/ `secondary`，静态按类型 + confidence，
  排序按时间临近，不做加权合成。

### D4 — 沉默优先

- 条件态：证据不足的小时 = null（不硬造「云在头顶(20%)」）；
- CLEAR 只在三向（用户/上方/下方）均 <15% 时给出——「说晴」也是判断，需要证据；
- 夜段云海被民用晨昏可见性规则正确丢弃（复用 agenda.visibleSeaWindow）；
- 全天无窗口 → `meta.silence = true`，UI 层显示「今天没有值得标注的窗口」。

### D5 — 覆盖范围语义（Phase 1 教训的产品化）

用户海拔在数据覆盖范围（covered lo–hi）之外时：该处云量为外插值**不可采样**；
云态按「覆盖区与用户的相对位置」推导（成都 500m 在 2000m 层下方 → 头顶有云层，
绝不报「你在云中」）。上下邻域判定以 ±200m 为界、限制在覆盖区内。

## 2. 模块边界

```
miniprogram/utils/outdoor-intelligence.js   本层唯一实现（wx-free，Node 可测）
输入 ctx { date, detail(24h hourView), userAltitude, elevOK, lat/lng,
           cloudField?(Phase 1 适配器产出), marks?/sun/win/moon?(缺省自算),
           heading? }
输出 { conditions[24], opportunities[], meta{sources, silence} }
依赖 sky / agenda / conditions / astro / cloud-field-svg（只 import，不改）
```

生产页面接入（Phase 2 of OI，待做）：Agenda 卡与结论卡改读本层输出；
Meteogram 标记行继续直接消费 sky.hourMarks（同源不打架）。

## 3. 已验证

`tools/outdoor-intelligence-test.js` 22/22：四条件态、窗口聚类
（start/end/empty/overlap/adjacent）、evidence 可解释、沉默、确定性、三海拔差异、
性能 <20ms。真实三地点（峨眉山/理塘/成都）生产管线验证见
[README.md](README.md) 的 Real Data Examples。
