# Weather Page V2 —— 最终信息架构与云海/时间轴/证据设计

日期：2026-10-05 · 上游：[weather-ux-design.md](weather-ux-design.md)（V1 规格，组件/实现/风险表仍然有效，本文不重复）·
[meteoblue-visual-integration.md](meteoblue-visual-integration.md)（Meteoblue 槽位依据）· 原型 `prototype/fallback/`（自绘形态）与 `prototype/meteoblue/`（槽位形态）

> 产品总纲（不变）：**Meteoblue 告诉用户"天气是什么"，OurTrail 告诉用户"什么时候值得出去"。**

---

## 1. 页面最终信息架构（§18 的 UX 裁决版）

```
┌ 0 Location      格聂 · 3500 m · 10月6日 周二 · 数据源 · 更新时间          [L0]
├ 1 7-Day         降权重：52px 矮卡（图标+温区间），选中即切，无任何结论     [L1]
├ 2 专业天气       Meteoblue 槽位（未来）= 模拟图位；现状 = OurTrail 自绘     [L1]
│                  meteogram（24h 默认 / 48h / 72h / 7 天横滚，同一画布换窗）
├ 3 24h Timeline  OurTrail 核心时间轴：温度线/降水柱/云量三带/云层带剖面/    [L1]
│                  风羽/昼夜轴 —— 点小时 → 浮条
├ 4 Agenda        今日户外时间轴：天文/天气事件(灰) + OurTrail 窗口(绿+星级) [L1+L2]
├ 5 Conditions    徒步条件总评 + 云海 featured 卡 + 天象卡（结论层）          [L2]
├ 6 Evidence      每张结论卡内嵌「为什么？」→ 事实清单 + 看图↗               [L1→L2 回指]
└ 7 Numbers       逐小时数字表（折叠）+ 免责 + 三层说明 + 署名                [L1]
```

相对 V1 的三处调整：
1. **新增「专业天气」槽位**（§2）：Meteoblue 若接入，图落在 7-Day 与 24h Timeline 之间，
   承担"多天过程 + 信任锚"；**槽位永远存在，图由谁画是 provider 决策而非布局决策**——
   现状由 OurTrail 自绘图顶替（同一画布 24/48/72h/7 天换窗），页面结构零改动。
2. **7-Day 降权重**（§17）：从"横滚大卡"降为 52px 矮卡，删日出/降水文案（日出在昼夜轴），
   防止 7 天视图抢走 24h 决策主图的首屏。
3. **Agenda 上移至结论之前**（V1 在结论区后）：时间轴是"10 秒判断"的终点站，放在证据区之前
   让"何时出发"一步可答；结论卡只服务"为什么"。

**移动端优先级（§15，375px 上的取舍顺序）：** 当前天气摘要（页头+图首屏）→ 24h Timeline →
Agenda → Cloud Sea（剖面行+featured 卡）→ Evidence → Numbers。每屏只允许一个视觉主角。

**24h / 48h / 72h（§16）：** 默认 24h（今天什么时候值得出去）；48h/72h 供徒步行程规划，
横向滚动但**保持原生字号**（12.5px/列），72h 以上交给 7-Day 条与（未来）Meteoblue 槽位。

## 2. Cloud Layer Profile（§10 专章：云海的视觉本体）

这是 OurTrail 超越 meteoblue 的一行。规格：

```
纵轴：海拔 0–6000 m（压缩为图内 30px 高的行）
元素：
  ▸ 云层带色块   band{base,top,cover}（生产 cloudBandAt 重建，cover≥80% 才成带）
                 颜色 --info，透明度随 cover
  ▸ 观景点海拔线  3,500 m 虚线 --forest（数据：GPX ele / 手填 / 模型降尺度+来源标注）
  ▸ 状态底色     云带顶 < 海拔线 → 淡绿底（云在脚下 = 云海窗口可读）
                 海拔线在带内      → 淡警示底（入云）
                 云带在海拔线之上  → 无底色（云在头顶）
  ▸ 多层云       band 之外，低/中/高三带行继续表达（高云在剖面行上方不重复画）
时间维：与 24h/48h/72h 同轴；沿时间轴用户能看到云带抬升/消散的过程
       （06h 带在 2280–2950 → 10h 抬升变薄 → 12h 消散）
```

用户读到的三句话，不需要任何文字解释：**「云在我下面」「云正好罩住我」「云在我头顶」**。
原型见 `prototype/fallback/` 的「带」行；数据契约零新增（band 字段现网已有）。

多日轨迹场景的强化版是现有 `space-time` 组件（时间×海拔+节点轨迹），保留不动，仅在
活动/轨迹组模式展示。

## 3. OurTrail 24h Weather Timeline（§11，规格要点）

V1 规格 §5-2 已定，此处补 §11 强调的三条原则：
1. **同轴多变量，形态服务语义**：温度=线、降水=柱、云=带、风=羽——不把变量翻译成文字列表；
2. **图标行用简字**（晴/多云/阵雨/雪），沿用 P1「文字承载语义、不引入图片资源」决策，
   密度 3h 一标，降水准不影响判断；
3. **图上没有 OurTrail 的结论**——窗口只以"位置色"出现（云海带剖面行的状态底、昼夜轴上的
   黄金/蓝调段），颜色语义与结论卡同源（MARK_STYLE 色板），用户在图上看到的是**事实的形状**，
   结论在结论区。

## 4. Outdoor Agenda（§12）与 Evidence（§13）

V1 规格 §5-4/§6 已定，此处重申两条边界（§12/§13 的原话要求）：
- **Agenda 是结论层，不污染事实图**：事件流的 L2 项永远带 `OURTRAIL 分析` 来源小字与星级；
  事实图的标记行（未来若加）只画窗口位置不画文字结论；
- **每个结论必须可回到事实**：Evidence 面板的每一行 = 一个图上真实可见的事实 + 「看图 ↗」锚点；
  指标映射表见 V1 规格 §9.4（cloudSea→云带/海拔差/清晨云/风/前日降水…）。

## 5. 可信度系统（§14 的落地口径）

| 规则 | 内容 |
|---|---|
| 不输出百分比结论 | 「云海概率 83%」这类伪精度数字不出现；分数只存在于内部 score |
| 星级 + 词语 | **★★★★☆ 较好 Good**（score≥70）/ **★★★☆☆ 一般 Fair**（45–69）/ **★★☆☆☆ 较差 Poor**（<45） |
| 不给五星与一星 | 五星 = 任何模型都无法保证的那部分，永远空着；一星 = 系统直接沉默（无窗口时不出卡，而不是打一星羞辱数据） |
| 客观时刻不评级 | 日出/黄金/蓝调/暗夜是事实，只有时间没有星级 |
| 固定免责语 | 每张 L2 卡尾注：「This is an interpretation based on weather conditions, not a guaranteed phenomenon.（基于天气条件估算，非保证现象）」 |
| 保留原始事实 | 结论卡永远同屏携带时段与一条可见事实（ Evidence 可展开），不出现"裸结论" |

## 6. 三方对比（§24）

| 维度 | Current OurTrail（截图 1） | Meteoblue（截图 2） | OurTrail V2 |
|---|---|---|---|
| Raw Weather 数据完备 | ✓（33 变量在库） | ✓✓（多模型） | ✓✓（Provider 抽象，可升级到多模型） |
| 连续 Time Series | ✓（7 天横滚，当日弱） | ✓✓（三行面板同轴） | ✓✓（24h 一屏 + 48/72/7d 同画布换窗） |
| Cloud Layer 高度表达 | ✓（气压层带，行业稀缺） | ✓（灰阶剖面） | ✓✓（带 + **观景点海拔线 + 三态底色**） |
| Outdoor Analysis | ✓（6 卡长文字，过重） | ✗（无） | ✓✓（评级词+星级+featured 云海） |
| Evidence 可回溯 | △（依据埋在文字里） | — （不解释） | ✓✓（事实清单 + 看图↗ 锚点） |
| Mobile UX | △△（重复、横滚重） | ✗（桌面密度，375px 实测不可读） | ✓✓（375px 原生设计，一屏一主角） |
| Hiking Decision（何时出发） | △（要自己拼） | △（给数据不给答案） | ✓✓（Agenda 直答 + 克制建议） |
| 中文界面 | ✓ | ✗（lang 无 zh） | ✓ |

## 7. 落地提示

- 组件清单、数据契约、阶段划分、风险表、真机清单：**全部沿用 [weather-ux-design.md](weather-ux-design.md) §8–§9**，
  仅需追加两项：①「专业天气」槽位组件（`professional-weather`，props: `provider`, `image?`, `fallbackMode`）；
  ② agenda/conditions 聚合函数照 V1 §8 的 `utils/agenda.js` / `utils/conditions.js`。
- 生产 bug 与展示修正（WMO 雪码、云海窗口×晨昏交集）见 [decision.md](decision.md) 附录，只记录不改。

---

*决策与推荐：[decision.md](decision.md) · Provider/缓存/兜底：[provider-architecture.md](provider-architecture.md)*
