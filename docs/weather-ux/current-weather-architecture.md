# Current Weather Architecture —— 天气模块现状分析（A 交付物）

日期：2026-10-05 · 基线：HEAD `15cafdb`（工作树含未提交改动，未计入）
性质：**只读分析**，本文档不做任何修改建议之外的事。新设计见 [weather-ux-design.md](weather-ux-design.md)。

> 一个名称澄清：本仓天气数据源是 **Open-Meteo**（免 key、CC BY 4.0 署名），不是 OpenWeather。
> 云函数 `lib/weather.js` 直连 `api.open-meteo.com`，页脚署名也是 Open-Meteo.com。

---

## 1. 数据链路（自上而下）

```
Open-Meteo api.open-meteo.com（WGS-84 坐标，keyless）
   │  https.get，10s 超时，30 分钟 ot_weather_cache（key = w_{lat2dp}_{lng2dp}_{date}）
   ▼
cloudfunctions/trailApi/lib/weather.js  fetchForecast()
   │  · 33 个 hourly 变量 + 10 个 daily 变量 + 9 层气压层（cloud_cover_NNNhPa + geopotential_height）
   │  · cloudBandAt()：气压层剖面重建「云层带」{ base, top, cover }（cover≥80% 才成带）
   │  · GCJ→WGS 纠偏（本地逆演，与 utils/gpx.js 双份维护）
   │  · out_of_range：所选日 > 今天+14 天
   ▼
actions: getWeather（活动节点）/ getWeatherByPoint（自由查询）→ 免鉴权（FREE_ACTIONS）
   │  返回体 { status, updatedAt, days[7], detail[24], series[168], pointElevation }
   ▼
miniprogram/utils/api.js  getWeather / getWeatherByPoint（唯一下云入口）
   ▼
客户端纯函数（云函数不做任何判断）
   ├─ utils/astro.js   NOAA 天文：sunTimes / photoWindows（黄金·蓝调）/ moonInfo / galaxySeason / solarPosition
   ├─ utils/sky.js     天相转译：hourMarks（8 键逐时标记）+ summarize（6 张结论卡）
   │                   阈值唯一来源；与 meteogram/layout.js MARK_STYLE 同源
   └─ utils/weather-model.js  P4 编排：snap 插值 / nodeFacts 逐节点海拔判定 / runsOf 主窗口 / judge 汇总
   ▼
页面：pages/weather（查询视图，3 模式）· pages/weather-chart（横屏全图）· pages/weather-hub（Tab 入口）
组件：meteogram（canvas 2d 7×24）· space-time（时间×海拔，P4）
```

**关键架构事实：**

- **判断全在客户端**，云函数只取数。这是对的——`sky.js` 可被 `tools/sky-test.js`（65 例）覆盖。
- **单一阈值来源原则**（`weather-model.js` 顶部明文）：图上标记与文字结论共用 `sky.hourMarks`，
  「同一时刻图与卡不同结论」被制度性禁止。
- **逐时插值不编造**：`snap`/`lerpBand` 在无样本端点保持 null，`route-schedule` 无时间不插值，
  `spaceNodes` 只收可信抵达时刻——「宁可沉默，不可编造」贯穿全链。
- 海拔优先真实高程（RoutePoint.ele，GPX 导入），缺省退回模型降尺度值并**在 UI 标注来源**。

## 2. 数据结构（现状契约，即 UI 可用的事实全集）

**逐小时（`series[]` / `detail[]`，`hourView()` 投影）：**

| 字段 | 含义 | 现有 UI 消费 |
|---|---|---|
| `d` / `t` | 日期 / 'HH:mm' | 全部 |
| `temp` / `feels` | 温度 / 体感 | 图（仅 temp）、明细表 |
| `pop` / `precip` / `showers` | 降水概率 / 连续降水 / 阵雨 | 图（双柱+透明度）、列表 |
| `code` | WMO 天气码 | 简字徽标（`format.weatherPhrase`） |
| `wind` / `gust` | 风速 / 阵风 | 列表（仅 wind）；**无风向** |
| `rh` | 相对湿度 | sky.js 彩虹/雾信号；UI 不显示 |
| `cloud.low/mid/high` | 三层云量 % | 图三带、指标卡日均值 |
| `uv` / `visibility` / `freezing` | 紫外 / 能见度(km) / 0℃层 | 明细表 / callouts |
| `band` | 云层带 {base,top,cover} 或 null | 云海判断、图上带标记、指标卡 |

**逐日（`days[]`）：** date / code / tMax / tMin / windMax / precipSum / precipProbMax / precipHours /
sunrise / sunset / uvMax / cloud{low,mid,high}（日均值）。

**天相标记（`sky.hourMarks`，8 键）：** cloudSea 云海 · star 星空 · galaxy 银河 · rainbow 彩虹 ·
alpenglow 光染 · golden 黄金 · blueHour 蓝调 · inCloud 入云（减分项）。配色唯一来源 `meteogram/layout.js MARK_STYLE`。

**结论卡（`sky.summarize` 6 项）：** 每项 { key, title, window, look「往哪看」, text, score 0-100,
tone, label }，label ∈ 条件较好（≥70）/ 条件一般（≥45）/ 条件较差。

## 3. 现有页面结构（pages/weather 自上而下）

| # | 区块 | 性质 | 问题① |
|---|---|---|---|
| 1 | 标题 + 免责 callout（常驻） | — | 免责文案好，保留 |
| 2 | 节点 picker（第几天抵达）/ 单点卡 | 上下文 | 无 |
| 3 | 7 日概览条（横滚，含日出） | 事实 | 信息密度好；但与图分离，点选后才联动 |
| 4 | meteogram（7×24 横滚 canvas） | 事实 | **当日过程感弱**：22px/列要横滑 7 天；风/湿度不在图上 |
| 5 | space-time 时空天相图 | 事实+推断 | 多日轨迹场景强；单日查询时是重复信息 |
| 6 | 「{{date}} 的数字」指标卡 | 事实 | 与明细表重复；「无成层云带」这类行价值低 |
| 7 | 安全 callouts（≤2 条） | 事实→规则 | 好；但与天相卡视觉同权 |
| 8 | 天相结论 6 张卡（badge+长文字） | **推断** | **核心问题区**：文字墙、无层级、推断与事实无视觉区分 |
| 9 | 分时段摘要（8 整点行） | 事实 | 与 #4 #10 三处重复 |
| 10 | 逐小时明细（24 行折叠） | 事实 | 数字表 OK，保留为折叠层 |
| 11 | 日期 picker + 署名 + 草稿按钮 | — | 无 |

## 4. 天象算法现状（可复用度：高）

| 现象 | 信号（sky.js §6） | 评级 | 结构化依据 |
|---|---|---|---|
| 云海 | 低层云带（底≤2200m）/ 此点>带顶 / 清晨高层<30 / 清晨风<15 / 前日降水 | score | **无**（拼在 text 括号里） |
| 日照金山 | 晨昏窗±50min / 低云<25 / 中高云≥40 / 无降水 / 带上 / 走向方位 | score | 无 |
| 星空 | 天文暗夜 / 晴空率 / 月照 | score | 无 |
| 银河 | 银心季 / 晴空率 / 月照 / 银心方位 | score | 无 |
| 彩虹 | 太阳<40° / 降水或高湿 | score | 无 |
| 晨昏光窗口 | 纯天文时刻（无判断） | 100「客观时刻」 | 无 |

**要点：分数是有据的，但依据只有一段自然语言**（`item.text` 把 reasons 用「、」连进括号）。
新 UI 的 ReasonPanel 需要结构化依据 —— 这不需要动 sky.js：依据全部是 series 里的可见事实，
按 key 映射指标即可（见设计规格 §9.4）。

## 5. 发现的问题与建议（只记录，不修改）

### 5.1 生产 bug（本轮 mock 测试暴露，建议另行修复）

1. **「降雪」callout 把阵雨也算进去。** `pages/weather/weather.js:36`
   `buildCallouts` 判 `code >= 71 && code <= 86`，但 WMO **80–82 是阵雨**（71–77 雪、85–86 阵雪）。
   后果：14°C 的午后阵雨日会触发「0℃ 层低于此点，降水可能为雪」。
   修法：`(71–77) || (85–86)`。原型 `prototype.js buildCalloutsHtml` 已实现修正规则并有注释标记。
2. **云海窗口含深夜小时。** `hourMarks` 的 cloudSea 判定不含昼夜条件，凌晨 01:00–05:00 也打标；
   `summarize` 的 window 文案因此出现「清晨 01:00–08:00」。判断不算错（云况确实成立），
   但**展示层**应与民用晨光（sunrise 前后）取交集——建议在展示聚合处做，不动 sky.js 阈值。

### 5.2 信息架构问题（新设计针对的靶子，按严重度排）

1. **推断与事实无视觉边界。** 6 张天相卡与数字卡是同款白卡同款排版，长文字结论（60–100 字）
   把「依据/方向/时段」糊在一起——「系统给答案」的观感正来自这里。
2. **没有「今天什么时候值得出去」的视图。** hourMarks 的窗口只存在于图上小色条与卡片文字里，
   没有一条按时间排的事件线。这是 hourMarks 已算出、却没有被 UI 表达的价值。
3. **风与湿度缺时序表达。** wind/gust/rh 数据齐全，风只出现在 8 整点列表里；户外判断里风是核心变量。
4. **当日 24h 过程感弱。** meteogram 是 7 天横滚（22px/h），看「明天一天」要滚 1.3 屏宽；
   而多数查询发生在「看明天」。当日视图应默认一屏 24h 免横滚。
5. **三处重复。** 7 日条 / meteogram / space-time / 指标卡 / 8 slot / 24h 明细 —— 同一事实最多出现 4 次。
6. **「为什么」不可验证。** 结论分数的依据埋在文字括号里，无法锚回图上时段，信任建立弱。
7. **评级语言暴露分数。** 「条件较好 72」的数字是模型分数不是用户语言；星级+词语更诚实可读。

### 5.3 数据缺口（新 UI 需要、云函数尚未取）

| 字段 | 用途 | Open-Meteo 变量 | 成本 |
|---|---|---|---|
| `windDir` | 风 row 箭头 / 银河方位交叉 | `wind_direction_10m` | 0（已有额度） |
| `pressure` | 数字明细层 | `surface_pressure` | 0 |
| 露点 | 数字明细层（雾/霜预感） | `dew_point_2m` | 0 |

均为 additive 改动，`hourView()` 一处加行、schema 无涉（天气返回体非存储实体）。

## 6. 复用 / 保留 / 重做 / 废弃清单（新设计的输入）

**原样保留（引擎与契约）：**
`lib/weather.js` 全部 · `sky.js` 全部阈值与同源原则 · `astro.js` · `weather-model.js` ·
`route-schedule.js` · api 契约（status 三态 / 窗口内复用 / 30min 缓存）· 免责文案与概率语言铁律 ·
节点/日期联动 · 分享与存点 · 草稿通知。

**保留但换位置/换形态：**
7 日条（增强：选中日与图同窗）· meteogram 7 天图（降级为「全周期」视图/横屏页主图）·
space-time（多日轨迹场景保留，单日查询折叠）· 24h 数字明细（折叠层）· 安全 callouts（保留在分析区）。

**新做：**
当日逐时图（24h 一屏）· 云层带剖面行 · 风 row · 日照条 · 今日户外时间轴 · 天象评级卡 + ReasonPanel ·
hour 浮条。

**废弃/合并：**
「{{date}} 的数字」指标卡（并入折叠明细）· 8 slot 分时段摘要（被图+浮条替代）·
结论卡长文字（拆为 评级+短句+可展开依据）。

---

*下一份：[weather-ux-design.md](weather-ux-design.md) —— 新信息架构与组件规格。*
