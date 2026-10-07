# Cloud Sea Detector —— 云海机会检测器（OI-2）

Cloud Field（Time × Altitude × Cover）→ 层提取 → Cloud Sea Candidate → 时间合并 → Window。

## 1. 检测管线

```
Cloud Field 采样器（cr4 时间插值 + 层间线性）
  ↓  cloudLayersAt(t)：沿海拔扫描（50m 步长），提取 ≥80% 的连续层
  ↓  （层边界线性插值出子步长精度；层厚不过滤——过滤是检测器的判定，不是提取器的）
Cloud Layers [{ base, top, thickness, meanCover, peakCover }]
  ↓  逐小时候选：取用户下方离用户最近的合格层
  ↓  净空 = userAltitude − layer.top ≥ 200m（§十.A）
  ↓  层均覆盖 ≥ 80%（§十.B，继承生产 band ≥80% 语义）
  ↓  层厚 ≥ 300m（§十.C，真实分布 P50=300m）
Cloud Sea Candidate（逐时）
  ↓  时间合并：缺口容忍 1 个缺失小时；持续 ≥ 2h（§十.D/§十二）
  ↓  民用晨昏可见性交集（复用 agenda 规则；夜段云海不可见 → 沉默）
  ↓  强度分级（§十三）+ Evidence（§十四）+ 日出 enrichment（§十一）
Cloud Sea Window { type, from, to, strength, confidence, rank, evidence[], overlapsSunrise }
```

## 2. 阈值（集中定义于 `outdoor-intelligence.js` CLOUD_SEA 常量）

| 阈值 | 值 | 依据 |
|---|---|---|
| LAYER_COVER_MIN | 80% | 继承生产 cloudBandAt ≥80% 成层云语义 |
| LAYER_THICKNESS_MIN | 300 m | 真实分布 P50=300m（4 地点 × 48h，48 个 ≥80% 层）|
| CLEARANCE_MIN | 200 m | 与 Phase 1 条件态 ±200m 邻域语义一致 |
| GAP_TOLERANCE_H | 1 h | 可容忍 1 个缺失小时（相邻距离 ≤2h 合并）|
| MIN_RUN_H | 2 h | 窗口最少持续（§十.D 时间连续性）|
| WIND_CALM | 15 km/h | 产品既有语义（factsFor cloudSea 证据「清晨风」同值）|
| SCAN_STEP_M | 50 m | 与 Cloud Field 网格同分辨率 |

**负证据 reason 码**（模型内部保留，UI 不展示）：USER_NOT_ABOVE_CLOUD / USER_INSIDE_CLOUD / LOW_COVERAGE / INSUFFICIENT_THICKNESS / LOW_PERSISTENCE / NOT_VISIBLE。

## 3. 强度（Strength）——可解释分级

四个二元因子各 +1：层均覆盖 ≥90% / 层厚 ≥600m / 净空 ≥500m / 持续 ≥3h。
STRONG = ≥3 因子；MODERATE = 2；WEAK = ≤1。风 > 15 km/h 降一级（只降一级）。

## 4. 与既有 Cloud Sea 逻辑的关系

| 层 | 内容 | 处置 |
|---|---|---|
| sky.js cloudSea 标记 | band ≥80% + 带顶 < 用户 + 高云 <30% + 晨间（<10:00）| **保留**（Meteogram 标记行继续消费）|
| agenda 云海窗口 | 标记簇 ×民用晨昏交集 | **保留**（Agenda 卡继续消费）|
| OI field 检测器 | Cloud Field 层提取 + 净空/层厚/强度/缺口容忍 | **新增**（有 cloudField 时为主源；无 cloudField 时回退 sky 标记路径）|

两个来源的阈值同族（80% / 带顶 vs 用户），不会出现「图上说有、OI 说没有」——
因为 sky 的 band 本身就是生产气压层剖面（同数据源），OI 检测器是它的高分辨率版本。
