# Weather UX Design —— 天气页信息架构与组件规格（B + D + G 交付物）

日期：2026-10-05 · 状态：设计定稿，待评审后实现
配套：[current-weather-architecture.md](current-weather-architecture.md)（现状）·
[prototype/](prototype/index.html)（可运行原型）· [meteoblue-integration.md](meteoblue-integration.md)（数据源调研）

> **核心原则（全文第一句，实现时遇到冲突以此裁决）：**
> 「专业天气数据负责提供事实，OurTrail 负责解释这些事实。」
> 目标不是展示更多数据，而是：**让一个有户外经验的人，在 10 秒内判断明天什么时候值得出发，以及为什么。**

---

## 1. 产品目标与设计优先级

| 优先级 | 含义 | 在设计上的落地 |
|---|---|---|
| 1 可信 | 用户知道每个结论从哪来 | 事实/分析分层徽标；每个推断带可展开的证据链；免责常驻 |
| 2 可理解 | 10 秒读完主路径 | 默认一屏 24h 免横滚；评级词+星；时间轴直答「何时出发」 |
| 3 可操作 | 看完知道做什么 | 每个窗口带时段与建议；点「看图」可回溯 |
| 4 专业 | 经得起户外用户对照 meteoblue | 温度/降水/云层带/风/昼夜全时序；云层带剖面为独有强项 |
| 5 美观 | 克制、自然、留白 | 全部取自 app.wxss 33 token，不发明新色 |

**明确的反面清单（禁止）：** AI 仪表盘感、彩色卡片堆、断言式文案（「会有云海」）、赌博式百分比、
大量 emoji、满屏数字、把桌面 meteoblue 原样缩小。

## 2. 用户场景（按频率排）

1. **出发前夜（最高频）**：在家翻「明天」——几点出发、会不会下雨、有没有云海/光染/银河。
   → 主路径：DayStrip 点明天 → 24h 图一屏 → 议程时间轴 → 按需「为什么」。
2. **清晨复核（高频）**：出发前 30 分钟再看一次，重点：风、降水提前、能见度。
   → 主路径：首屏图 + 安全 callouts + hour 浮条。
3. **多日行程行中（中频）**：在第 2 天看第 3 天垭口 → 现有节点 picker / space-time 保留服务此场景。
4. **自由查询/分享落地（低频）**：单点卡场景，同主路径，无节点维度。

## 3. 信息架构总览（页面自上而下）

```
┌ 0 页头     格聂 · 3500 m        10月6日 · 周二 · Open-Meteo · 18:20 更新   [L0 元信息]
├ 1 DayStrip  今天 | 明天 | 周四 …  （纯事实，点选切日）                      [L1]
├ 2 逐时天气  【核心·一屏 24h】图标/温度/降水/云量/云层带剖面/风/昼夜轴    [L1]
│             点小时 → 浮条（数字 + 该小时的窗口归属）
├ 3 今日日照  昼夜+晨昏光分段条 · 日出日落 · 黄金蓝调时刻                  [L1]
├ 4 今日户外时间轴  天文/天气事件(灰) + OurTrail 窗口(绿)，可展开「为什么」 [L1+L2]
├ 5 户外条件  徒步条件总评 + 云海 featured 卡 + 其余天象卡                 [L2]
│             每卡：星级/评级词 + 时段 + 一句话 + 「为什么？」→ 证据面板
├ 6 数字明细  24h 全字段表（折叠，含湿度/气压/能见度/UV/露点/云带）        [L1]
└ 7 页脚     免责 callout · 三层说明 · 数据署名                           [—]
```

三层信息在**视觉语言**上的边界（这是本设计最重要的规矩）：

| 层 | 内容 | 视觉 | 标注 |
|---|---|---|---|
| L1 天气事实 | 数据 + 客观天文时刻 | 白卡、中性墨、无评级 | 区块标题带 `天气事实` 灰徽标 |
| L2 OurTrail 分析 | 条件判断 | forest 左边线/浅底、评级星、语义色 | 区块标题带 `OURTRAIL 分析` 深绿徽标 |
| L3 行动建议 | 做什么 | 只出现在 L2 卡内部（建议行/时段行），**不独立成卡** | 「建议：…」 |

规则：**L2 永远不出现在 L1 区块里**（图上不写「云海概率大」，图上只有云海带与窗口标记的**位置**）；
**L3 不单独存在**（没有建议卡，建议只作为 L2 的最后一行）；跨层引用只允许「看图 ↗」一种形式
（从 L2 跳回 L1），反向禁止。

## 4. 评级语言（对「不要赌博感」的直接回答）

- **星级映射 sky.grade 三档**（不改阈值、不加档）：score ≥70 → ★★★★☆ 条件较好；
  45–69 → ★★★☆☆ 条件一般；<45 → ★★☆☆☆ 条件较差。
- **最高四星，永远不给五星。** 第五颗星是「任何模型都无法保证」的那部分——空星即诚实。
- **客观天文时刻不评级**：日出/日落/黄金/蓝调/暗夜是事实，只有时间，没有星级
  （现 sky.js 的 lightConclusion score=100「客观时刻」在新 UI 不再以分数出现）。
- 词语沿用 sky.js 文案库（条件较好/一般/较差），保证与既有测试与语气一致。
- 每张 L2 卡尾部固定小字：**「基于天气数据估算，非气象预报」**。

## 5. 区块规格

### 0 页头
地点名 + 海拔（来源小字）+ 剧情日期 + 数据源与更新时间。数据源展示为
`Open-Meteo`，来自 provider 元信息（见 §7），未来切 Meteoblue 此处自动变，无硬编码。

### 1 DayStrip（改造现有 7 日条）
保留现有信息（周几/简字/温区间/降水概率），三处改动：
选中态与图同窗（点击即切）；卡片去掉日出行（日出在 §3 日照条）；**不加任何 L2 标记**——
「哪天值得」的问题由用户切日后在 §5 回答，7 日条保持纯事实。

### 2 逐时天气图 weather-timeline（核心重做，替代 8slot/当日视图）
**默认一屏 24h**（375px 下 ≈12.5px/小时，meteoblue 移动端同密度），可切 48h（横滚），
7 天全周期保留现有 meteogram（或跳横屏页）。行自上而下：

| 行 | 内容 | 绘制 |
|---|---|---|
| 图标 | WMO 简字，每 3h，降水准 | 文字承载语义（沿用 P1 决策，不引入 emoji/图片） |
| 温度 | 折线+面积，极值标注 | 中性墨 `--ink`（**不许红**，design-system 铁律） |
| 降水 | 柱（mm）+ pop≥50 淡蓝底带 | 双色 precip/showers 可合并为单柱双色 |
| 云量 | 高/中/低三条带，透明度=云量 | 实色+alpha（alpha 相乘坑，见 design-system） |
| **云层带剖面** | 0–6000m 纵轴压缩条：≥80% 成层低云为色块，虚线=此点海拔 | **云海读图区**：带顶在虚线下方=云在脚下；窗口时段淡绿底；此点入带=淡警示底 |
| 风 | 风向箭头+数值，每 3h | 箭头指风吹去方向（dir+180°） |
| 昼夜轴 | 太阳高度分色条（夜/暮/蓝调/黄金/白昼）+ 小时刻度 + 日出日落虚线 + 「现在」线 | 与 §3 日照条同一算法 |

左栏 8px 行标签（温/雨/云/带/风），底部图例一行说明「带」与虚线含义。
**交互：** 点任意小时列 → 高亮列 + 浮条（`07:00 多云 6°C(体感5°) · 降水18% · 风6 · 湿度81% · 云带 2280–2950 m · 云海窗口`）——
浮条前半是 L1 数字，句点后是当前小时的 L2 归属（来自 hourMarks），是全页唯一允许同条混排的地方。

### 3 今日日照 sun-timeline
一条 24h 分段条（按太阳高度角每 30min 分桶：≥6° 白昼 / 0–6° 黄金 / −4–0° 日落蓝 / −6–−4° 蓝调 /
−18–−6° 暮光 / <−18° 暗夜）+ 数字行（日出/日落/昼长/黄金晨昏/蓝调晨昏）。它是 §2 昼夜轴的放大版，
回答「光什么时候有」。实现上可并入 weather-timeline（同一 canvas），独立组件仅为了单测方便。

### 4 今日户外时间轴 day-agenda（OurTrail 核心增量）
按时间排序的混合事件流，事件来源全部现成：

| 来源 | 事件 | 层 |
|---|---|---|
| astro.sunTimes/photoWindows | 天文晨光始/蓝调/黄金/日出/日落/暗夜始 | L1（灰点） |
| series 差分 | 降水开始/结束、降雪开始、云层上升/消散（低云跃变≥25%） | L1（灰点） |
| sky.hourMarks 聚类 | 云海观察窗口 / 日照金山可能 / 彩虹可能 / 银河窗口 / 星空条件 | **L2（绿点+星级）** |

L2 事件渲染成可点卡片（tone 浅底 + 时段 + 星级），展开 = §9 的证据面板。
展示建议：云海/光染窗口与民用晨昏取交集显示（修 5.1-2 的观感问题，不动 sky.js）。

### 5 户外条件（L2 区）
- **徒步条件总评卡**：星级+评级词+一句话（降水/风概况+有戏的天象列举）。安全 callouts
  （雷暴/降雪/入云/午后阵雨，规则同现 buildCallouts）以 danger/warning 条形式挂在总评卡下，
  **视觉明确是安全规则而非天相判断**。
- **云海 featured 卡**（旗舰案例，信息最全）：评级星 → 时段 → 一句话结论（来自 summarize.text）→
  「为什么今天值得去看云海？」→ 证据面板 + 建议行（「建议日出前抵达高处观景点」）→ 免责小字。
- **其余天象卡**（日照金山/彩虹/银河/星空）：同构但默认折叠「为什么？」。

### 6 数字明细 numbers-sheet（折叠）
现 detailRows 升级：时间/温/体感/湿度/风/风向/气压/能见度/UV/露点/云层带，横向滚动表。
替代并吸收现「{{date}} 的数字」指标卡。

### 7 页脚
免责 callout（原文保留）+ 三层说明（「OurTrail 分析 = 对上方天气事实的条件解读」）+
署名（provider.attribution，现为 Open-Meteo.com CC BY 4.0）。

## 6. 事实→推断的锚点（信任机制的落地）

每个 L2 结论的证据面板固定结构：

```
OURTRAIL 判断依据 · 均为上方图表中的可见事实
✓ 低层云带 2280–2950 m            [看图 ↗]
✓ 此点 3500 m 高于带顶 2950 m      [看图 ↗]
✓ 清晨低云 86% · 高层云 19%        [看图 ↗]
✓ 清晨风 6 km/h · 前日降水 4.2 mm   [看图 ↗]
建议：日出前抵达高处观景点。
基于天气数据估算，非气象预报。
```

每行事实都**真实存在于** §2 图或 §6 表中（数字直接取样自 series）——用户可以逐条对着图验证。
「看图 ↗」= 滚动到图并把高亮列定位到该事实的时段。**指标映射是展示层 curated 的（见 §9.4），
阈值本身零改动。**

## 7. 数据契约与 provider 适配层（可替换数据源）

```
WeatherProvider（接口，云函数层实现）
   OpenMeteoProvider（现状）        MeteoblueProvider（未来，见 meteoblue-integration.md）
        └────────────┬──────────────────┘
                     ▼
        NormalizedWeatherData（下发给客户端的唯一形状）
                     ▼
        客户端纯函数（astro/sky/weather-model，与 provider 无关）
                     ▼
        Weather UI（本规格全部区块）
```

```js
// NormalizedWeatherData（v1）
{
  point: { name, lat, lng, elevation, elevationSource },   // elevationSource: 'gpx'|'picked'|'manual'|'model'
  provider: { id, label, attribution },                    // UI 页头/页脚直接读，切换数据源零改动
  updatedAt: iso,
  days:   [ /* 现状 days 契约不变 */ ],
  hours:  [ /* 现状 hourView 契约 + 三个新增可选字段 */ ],
}
// hours[] 新增（现状缺口，Open-Meteo 补取即可，见现状文档 §5.3）：
//   windDir:  度（自北顺时针）      ← wind_direction_10m
//   pressure: hPa                  ← surface_pressure
//   dewPoint: °C（可选，可由 temp+rh 推） ← dew_point_2m
```

适配规则：**新增字段一律 optional**，UI 缺失时降级（风行退化为只画数值、明细列显示 —）。
现有 `status: ready|out_of_range|unavailable` 三态与 30min 缓存语义保持 provider 无关。

## 8. 组件规格（D 交付物）

命名沿用 miniprogram 组件惯例（kebab-case 目录 + `options: { styleIsolation: 'apply-shared' }`，
**options 只写一次**——platform-pitfalls #1）。

| 组件 | 职责 | 关键 props | 事件 | 实现 |
|---|---|---|---|---|
| `weather-timeline` | §2 当日逐时图（含云层带剖面/风/昼夜轴/浮条） | `hours[]`, `marks{}`, `point{}`, `now{}`, `span` | `bind:hourpick` | **canvas 2d 自绘**（复用 meteogram 的 dpr/scheduleSync 手势；几何抽 `layout.js` 供测试）；浮条为 WXML |
| `sun-timeline` | §3 日照条 | `date`, `lat`, `lng`, `elevation` | — | 纯 WXML/WXSS 即可（分桶在 js 算好传 `segments[]`） |
| `day-agenda` | §4 事件流 | `events[]`（页面聚合后传入） | `bind:whytoggle` / `bind:jumpchart` | WXML 列表；聚合函数放 `utils/agenda.js`（纯函数可 node 测） |
| `condition-summary` | 徒步条件总评 + 安全 callouts | `score`, `grade`, `text`, `callouts[]` | — | WXML |
| `phenomenon-card` | 天象卡（featured 变体） | `item`, `facts[]`, `featured` | `bind:whytoggle` | WXML；星级/评级词渲染 |
| `reason-panel` | 证据面板 | `facts[]`（{fact, anchor}） | `bind:jumpchart` | WXML |
| `numbers-sheet` | §6 明细表 | `hours[]` | — | scroll-view 横滚 WXML 表 |
| `day-strip`（改造） | 现有 7 日条 | 同现状 | `bind:daytap` | 现页面区块抽组件 |
| `meteogram`（保留） | 7 天全周期/横屏页 | 不动 | 不动 | 现组件 |
| `space-time`（保留） | 多日轨迹 | 不动 | 不动 | 现组件 |

**新纯函数模块（均 wx-free、进 tools 测试）：**
- `utils/agenda.js`：events 聚合（天文 + series 差分 + hourMarks 聚类 + 晨昏交集）。
- `utils/conditions.js`：总评分（复用 weather-model.judge 的「有戏项均值」规则）、factsFor 映射（§9.4）。
  ⚠ 不复制 sky.js 任何阈值，只消费其输出。

**正式实现时与原型的映射：** 原型 SVG ≈ canvas 绘制指令（原型 `prototype.js` 的行几何/配色
就是 canvas 版的打样）；`analyze()` 的引擎调用链即页面 `applyWeather` 的扩展点。

## 9.4 证据面板指标映射（factsFor，展示层 curated）

| key | 证据行（全部取样自 series/days） | 锚点 |
|---|---|---|
| cloudSea | 低层云带 base–top（band 聚合）· 此点海拔 vs 带顶 · 清晨低云/高层云均值 · 清晨风均值 · 前日降水（days−1） | band |
| alpenglow | 低云均值 · 中高云均值 · 全日降水量 | temp/rain 行 |
| rainbow | 时段内降水小时数 · 午后湿度均值 | rain 行 |
| galaxy / star | 暗夜晴空率 · 月照（astro） · 高层云均值 | cloud 行 |
| light | 日出/日落/黄金/蓝调时刻 | 昼夜轴 |

## 9. 实现规格（G 交付物）

### 阶段划分（每阶段独立可发布，门禁全绿再进下一阶段）

**阶段 1 —— 当日事实视图（纯增量，不动结论区）**
1. `cloudfunctions/trailApi/lib/weather.js`：hourly 增 `wind_direction_10m,surface_pressure`，
   `hourView()` 加 `windDir/pressure` 两字段（additive，重新部署 trailApi）。
2. 新组件 `weather-timeline`（canvas 版 §2）+ `sun-timeline`；几何抽 `layout.js`，
   新增 `tools/weather-timeline-test.js`（行不重叠/刻度装得下/tapColumn 换算/dpr——
   照 `space-time-draw-test.js` 的记录式 2D 上下文写法）。
3. 页面插入「逐时天气」区块；8 slot 摘要与「{{date}} 的数字」移入折叠明细。
4. 门禁：`node tools/check.js && node tools/check-handlers.js` + weather-page/sky/astro/scenario-weather 相关套件 + **真机**
   （canvas 层偏移重测、dpr、横滚点选、48h 滚动——照 AGENTS.md「直连微信开发者工具」流程）。

**阶段 2 —— 分析层（评级 + 议程 + 为什么）**
1. `utils/agenda.js` + `utils/conditions.js`（纯函数）+ `tools/agenda-test.js`。
2. `day-agenda` / `condition-summary` / `phenomenon-card` / `reason-panel` 组件。
3. 页面：天相区改为户外条件区；结论卡长文字退役；buildCallouts 修正 WMO 雪码范围
   （现状文档 §5.1-1，顺手修）。
4. 文案走查：全部 L2 文案概率语气；「客观时刻」不出现星级；免责在 featured 卡与页脚双保险。
5. 门禁：全套件 + 真机（重点：展开面板滚动定位、「看图」跳转高亮、评级徽标对比度）。

**阶段 3 —— provider 适配层（为 Meteoblue 预埋，可选）**
云函数侧抽 `fetchForecast` 为 OpenMeteoProvider，返回体加 `provider{}` 元信息；
客户端页头/页脚改读 `provider.attribution`。行为零变化，纯重构 + smoke 回归。

### 风险清单（实现 Agent 必读）

| 风险 | 对策 |
|---|---|
| canvas 拿不到 CSS 变量 | 色板字面量照 `meteogram.js` C 表惯例，逐行标 `// = --token`；新色先加 token |
| `options` 二次覆盖丢 `apply-shared` | 每个新组件模板自带单次 options 块 |
| type="2d" 图层偏移 | 复用 `scheduleSync`（100/320ms 双测）手势 |
| 温度线用红 | 禁止；`--danger` 与光染同色（design-system 已知坑） |
| 同步改 8 键天相色 | 本设计**不新增不修改** MARK_STYLE key；若必须，同批改 sky.js+layout.js+消费方 |
| 星级被理解为概率 | 评级词始终与星同现；featured 卡挂「非气象预报」 |
| 7 日条与图窗口错位 | 沿用「同窗锚定所选日」的既有修复（weather.js covers/buildChartSeries 注释） |
| 修改 WXML/WXSS 后静态门禁绿灯=页面正常 | 交付前真机驱动（AGENTS.md 唯一能看见像素的手段） |

### 明确不做（本轮与实现阶段都不做）
不接 Meteoblue（只留适配层）· 不做逐 10 分钟预报 · 不做实况 · 不做多模型互验（P2 §4 已裁决）·
不改 sky.js 阈值 · 不新增天相 key · 不引入天气图片/emoji 资源 · 不做穿戴/桌面适配。

---

*配套：[current-weather-architecture.md](current-weather-architecture.md) · [prototype/index.html](prototype/index.html) · [meteoblue-integration.md](meteoblue-integration.md)*
