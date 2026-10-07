# Opportunity Registry —— 户外机会注册表（OI-1）

所有户外事件在此注册。新增一种机会 = 在此表加一行 + 一个 detect 函数，
**不是**新写一套独立逻辑。

## 1. 注册表

| type | 解读词 | 来源 | 判定（复用） | rank | confidence | 状态 |
|---|---|---|---|---|---|---|
| CLOUD_SEA | 云海窗口 | sky.cloudSea 标记簇 + field 条件 | band≥80% 且带顶<用户 + 高云<30 + 晨间；×民用晨昏交集 | primary | 高/中 | ✅ 已接入（OI-1） |
| IN_CLOUD | 入云时段 | L2 条件（field(t,userAlt)≥60 连续 ≥2h） | Cloud Field ∩ userAltitude | secondary | 高（cUser≥80）/中 | ✅ 已接入（OI-1） |
| VIEW_WINDOW | 远眺窗口 | L2 条件（CLEAR/CLOUD_BELOW）+ 高层云 + 能见度 | 白天 + 无降水 + 高/中层少 | secondary | 高/中 | ✅ 新抽象（OI-1） |
| GOLDEN_LIGHT | 黄金光 | astro.photoWindows | 天文确定性（分钟级） | secondary | **明确** | ✅ 已有（sky）|
| BLUE_HOUR | 蓝调时刻 | astro.photoWindows | 天文确定性 | secondary | **明确** | ✅ 已有（sky）|
| ALPENGLOW | 日照金山 | sky.hourMarks | 晨昏窗 + 低云少 + 中高云可染 + 无降水 ± 走向 | primary | 中 | ✅ 已有（sky）|
| RAINBOW | 彩虹可能 | sky.hourMarks | 太阳高度 −2°..40° + 湿润（heuristic，天文部分可靠） | secondary | 中/低 | ✅ 已有（sky；OI 只聚类）|
| STARGAZING | 星空条件 | sky.hourMarks | 暗夜 + 中高层云<30 + 无降水 | secondary | 中 | ✅ 已有（sky）|
| MILKY_WAY | 银河窗口 | sky.hourMarks | 星空 + 银心季 + 月照<35% | primary | 中 | ✅ 已有（sky）|
| CLOUD_BELOW(条件) | 云在脚下 | L2 Condition | field 下方峰值 ≥68% | —（条件态） | — | ✅ 已接入 |
| CLOUD_ABOVE(条件) | 头顶有云层 | L2 Condition | field 上方峰值 ≥40% | —（条件态） | — | ✅ 已接入 |
| CLEAR(条件) | 晴 | L2 Condition | 三向 <15% | —（条件态） | — | ✅ 已接入 |

## 2. 分层约束

- CLOUD_BELOW / CLOUD_ABOVE / IN_CLOUD 首先是 **L2 Condition**（逐时）；
  其中 IN_CLOUD 连续 ≥2h 时**额外**产出 IN_CLOUD 窗口（L3）；
- CLOUD_SEA 是 CLOUD_BELOW 的**特例**（密度/晨间/高层洁净阈值更严），
  两者并存时窗口层以更具体的 CLOUD_SEA 为准（VIEW_WINDOW 让位）；
- golden/blueHour 是 L1 客观天文时刻，**永不**带成功率。

## 3. 已知 heuristic 与可靠性审计（§十四）

| 判定 | 可靠部分 | heuristic 部分 | 备注 |
|---|---|---|---|
| RAINBOW | 太阳高度几何（−2°..40°） | 「湿润」由降水/湿度/低云代理，非观测雨幕 | 保持 secondary + 「可能」措辞 |
| cloudSea | 气压层 band（真实剖面）+ 用户海拔 | 高层<30%、晨间窗为经验阈值 | 阈值在 sky.js 单源，本层不改 |
| alpenglow | 晨昏窗（天文） | 染色条件（低云少/中高云有）为经验 | 同上 |
| VIEW_WINDOW | 高层云/能见度/无降水（数据在库） | 「远眺」本身受地形限制，模型不管地形 | evidence 如实引用数据 |

## 4. Phase 2+ 候选（未实现，按价值排序）

1. **CLOUD_SEA 场证据增强**：云区/云顶随时间抬升/消散序列（field 已可算）；
2. **CLEAR_ABOVE_CLOUD 命名窗口**：云下且天顶通透（观景/航拍价值）；
3. **VISIBILITY 窗口细分**：能见度 km + 湿度 + 降水联合（数据已在库）；
4. **风向窗口**：山脊/垭口的顺风/逆风时段（windDir 数据已在库）；
5. **多日窗口**：detail 仅单日，跨日需 detail 扩展（数据层 additive）。
