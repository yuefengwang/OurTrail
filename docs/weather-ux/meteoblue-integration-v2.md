# Meteoblue Integration V2 —— 集成可行性严肃调查（依据官方文档与 OpenAPI 规格）

日期：2026-10-05 · 调查方式：官方技术文档（docs.meteoblue.com）+ 官方 OpenAPI 规格（my.meteoblue.com/images/openapi.json）+ 官方商业页（business.meteoblue.com/pricing）。未爬取天气数据、未解析 DOM、未绕过任何授权。
上轮概览版：[meteoblue-integration.md](meteoblue-integration.md)。本文是带真实参数与价格的深入版，冲突处以本文（更新、更具体）为准。

---

## 1. 官方渠道全景（核实过的）

| 渠道 | 端点/形态 | 认证 | 价格 | 结论先行 |
|---|---|---|---|---|
| **Image API** | `my.meteoblue.com/images/*`，HTTP GET 出**二进制 PNG/WebP** | `apikey`（URL 参数）+ 可选签名 | **每图 16,000 credits**（特殊图 128,000） | 数据可信但**不可作主路径**（§5） |
| **Forecast API（point packages）** | `my.meteoblue.com/packages/*`，JSON | `apikey` | 按包计 credits（数千/次量级） | **未来主数据源候选**（§5.3） |
| **Free Weather API** | Forecast API 的试用包 | 账号 + apikey | **免费一年，10M credits** | 试点可用；额度见 §6 算账 |
| **Maps Plugin / Tile API** | 交互地图嵌件 / 瓦片 | apikey | €2,400/年起 | 与本需求无关 |
| **Widget（免费挂件）** | 网页 HTML/JS/iframe 嵌件 | 无 | 免费 + 署名回链 | **小程序不可用**（§3） |
| **Dataset / Measurements / Climate API** | 批量数据 | apikey | €1,200–4,800/年起 | 无关 |

**通用规则（官方明文）：** 所有调用必须附 `apikey`；**"An API key should be kept private to prevent misuse"**；
官方提供 **HMAC-SHA256 签名机制**保护动态 Web/移动端场景的 key；默认限速 **500 次/分钟**；
key 按天/按包有调用量上限（商务可调）。

## 2. Image API 完整规格（来自官方 OpenAPI 3.1 规格，2026-10 拉取）

### 2.1 端点（全部 `https://my.meteoblue.com/images/` 前缀）

| 端点 | 内容 | 与截图 2 的关系 |
|---|---|---|
| `meteogram` | **Meteogram 5-Day**（温度曲线+天气 picto / 降水+云层剖面 / 风） | **就是截图 2 那张图** |
| `meteogram_extended` | 7 日版 | 同结构更长 |
| `meteogram_one` | All-in-One | — |
| `meteogram_snow` | 雪/冻结高度 | OurTrail 降雪 callout 相关 |
| `meteogram_14day` / `meteogram_multimodel` / `meteogram_multimodelensemble` / `meteogram_multimodelwind` | 14 天 / 多模型对比 / 集合 / 多模型风 | 多模型交叉的素材 |
| `meteogram_air` / `meteogram_thermal` / 航空气象系列 | 空气质量 / 上升气流等 | — |
| `visimage/crossSection_clouds|temp|wind|rh` + `pathcrossSection` | **沿路径的垂直剖面**（参数 `pathlat/pathlon/time`） | 潜在亮点：沿徒步路线的云剖面（未来项） |

### 2.2 请求参数（真实参数名，OpenAPI 逐条核实）

`lat`（必填，WGS-84）· `lon`（必填）· **`asl`**（可选，海拔 m，-500..10000，不给则按 80m DEM 自动取——**山区建议显式传真实海拔**）·
`tz`（IANA 名）· `temperature_units`（C/F）· `precipitation_units`（mm/inch）· `windspeed_units`（kmh/ms-1/mph/kn/bft）·
**`lang`**（ISO 两位语言码）· `location_name`（印在图上的点名）· `dpi`（50/72/80/100/300）· `download`（0/1）·
**`no_logo`**（布尔，返回无 logo 版——**商业授权项**）· `forecast_days`（0–8）· `history_days`（0–4）· `format`（png/webp，部分端点支持交互 html）。

**⚠ 决定性发现：`lang` 枚举没有中文。** 官方枚举：ar, bg, cs, de, el, en, es, fr, hr, hu, it, ka, nl, pl, pt, ro, ru, sk, sl, sr, tr, uk（及少量 locale 变体）。
→ **Image API 出的图只能是外文界面**，对纯中文小程序是硬伤。

### 2.3 响应与错误

- 成功：**二进制 `image/png` 或 `image/webp`**（部分端点 `text/html` 交互图）。不是 JSON 包 URL，不是 SVG。
- 403 = 订阅过期；429 = credits 用尽。
- 图片由 meteoblue 服务端按请求实时渲染，尺寸由端点与 `dpi` 决定，**没有任意宽高参数**（无 `width/height` 入参）——不能要一张 375px 宽的移动版图。

### 2.4 内容（回答 4.1：能不能出截图 2 的图？）

**能。** `meteogram` 端点包含：温度曲线（°C，红曲线+分层绿填充）、天气 picto、降水柱（mm/h，
Precipitation 深蓝 / Showers 浅蓝 / Frozen mix 橙标）、**云量垂直剖面**（灰阶 10–25%…90–100%，右轴 Altitude km）、
冻结高度带、风羽 + 风速/阵风双曲线（km/h）、昼夜底色、日分隔与时刻轴、图例、meteoblue 品牌。
与截图 2 逐项对应。

## 3. Widget 专项（必须与 API 分开回答）

| 问题 | 答案 |
|---|---|
| 是什么 | 面向**网站**的 HTML/JS/iframe 嵌件（免费档存在，如 Maps Widget；气象挂件历史页面已随文档改版 404，条款未公开细列） |
| 适合微信小程序？ | **不适合，技术性出局**：个人主体无 `web-view` 权限；企业主体 web-view 只能打开**自有备案业务域名**——`meteoblue.com` 不可能配置为我们 |
| 能否自定义样式 | 不能（品牌与样式由 meteoblue 控制） |
| 能否提取 widget 里的数据 | **不能。** 抓取/解析 widget 内部数据属于 scraping，被本任务与 meteoblue 条款精神双重禁止 |
| 结论 | Widget 在 OurTrail 架构里**不存在可用形态**，下文所有方案不再考虑它 |

## 4. 微信小程序架构问答（§6 逐条）

1. **API key 放哪里？** 云函数环境变量/私有配置。meteoblue 官方明文要求 key 私有并提供了客户端签名机制——但在微信小程序里，**任何前端存储都可被解包提取**，所以唯一安全位置是后端。
2. **能否放小程序前端？** **绝对不能。** 小程序包可被反编译；key 泄漏 = 按次计费的账单失控。
3. **必须后端代理吗？** **必须。** 且 ourtrail 已有完全同构的先例：`trailApi/lib/weather.js` 就是 Open-Meteo 的后端代理 + 缓存。
4. **图片返回 URL 还是下载转存？** Image API 返回二进制 → 云函数下载后**转存云存储**、给小程序一个我们域名的临时 URL（或 base64）。直连 meteoblue URL 虽然技术上 `<image>` 可加载，但每次展示都打 meteoblue 的图床，既烧 credits 也把我们的用户流量交给第三方观测。
5. **能否缓存？多久？** 条款层面：**公开文档未写明图片/数据的缓存许可**（Maps 产品页明文"默认禁止缓存"，图片类未逐字公开）→ **必须商务书面确认**，本文按保守假设执行：即使许可，也只做短窗缓存。技术层面：预报数据按提前量分级缓存（D0 30–60min / D+1 3–6h / D+2 以外 12–24h）。
6. **缓存 key 怎么设计？** `wx:{provider}:{lat2dp}:{lng2dp}:{asl}:{anchor_date}`（2dp 网格 ≈1.1km，与现网 `w_{lat}_{lng}_{date}` 同思路；`asl` 必须入 key——山区 80m DEM 自动海拔与我们传的真实海拔会差出一个图）。
7. **会不会烧大量 credits？** 会——这正是 Image API 出局的计算依据，见 §6。
8. **如何避免"每打开一次打一次 Meteoblue"？** 三层：客户端窗口内复用（现有 `covers()` 机制）→ 云函数缓存（上条 key）→ 每日每点最多 1–2 次真实外呼（按提前量分级 TTL）。

## 5. 三条集成路线的严肃评价

### 5.1 Image API（把 meteoblue 图当"专业天气图表"嵌入）

- 可行性：技术上完全可行（后端代理 + 转存 + `<image>`）。
- **致命伤（按权重）：**
  1. **credits 经济学不成立**：16,000 credits/图，免费年额度 10M ≈ **625 张/年**。见 §6 算账。
  2. **无中文**：`lang` 枚举无 zh，图内界面语言不可控。
  3. **移动端不可读**：无宽高参数，桌面密度图整图缩到 375px 实测**不可读**（原型 `prototype/meteoblue/` 内有实测：缩放 22%，图例文字 ≈3.1px）。唯一勉强形态是"原生宽 + 横滚"——让用户在中文产品里横着滚一张英文图。
  4. **条款黑洞**：修改/裁剪/叠加 OurTrail 标记的许可**未公开**；`no_logo` 是付费项；署名回链在小程序内无法以可点击链接履行 → **保守判定：未经书面许可不得修改/裁剪/overlay**（Option C 由此出局）。
- 定位：**只可能作为「专业预览」槽位的候选增强**（weather-page-v2-design.md §3 的 Meteoblue 槽位），且必须同时满足：付费 license + 商务书面确认缓存与展示方式 + credits 预算。默认不启用。

### 5.2 Forecast API（拿数据，OurTrail 自己画）

- 可行性：JSON 数据 + 后端代理，与现有 Open-Meteo 链路完全同构。
- 优势：mLM 多模型后处理（山区低云是它的强项，恰好是云海判断最弱的一环）；变量到 `NormalizedWeatherData` 的映射是纯适配层工作；**中文、移动端密度、云海剖面、天相叠加全部由 OurTrail 自绘实现**。
- 成本：按包计 credits（数千/次量级），免费 10M 够试点；正式量级需付费套餐（€2,400/年起）。
- 定位：**未来主数据源的正当路径**——Provider B，见 provider-architecture.md。

### 5.3 结论排序

**Forecast API > Image API > Widget。** 数据永远优于图像：图像是一次性像素，数据是可解释、可叠加、可本地化的资产——这与 OurTrail「提供事实、负责解释」的产品原则同构。

## 6. Credits 算账（决定性的一张表）

假设：冷启动期 100 个日活用户，人均看 3 个点 × 2 次/天（第二次命中缓存）。

| 方案 | 真实外呼/年 | credits/年 | Free 10M 够吗 | 付费起点 |
|---|---|---|---|---|
| Image API（每图 16k，按 (点,日) 缓存） | 100×3×365 ≈ **109,500 张** | **17.5 亿** | ❌（=625 张的 175 倍） | 数个 Premium 档叠加，数千 €/年起 |
| Image API（极限缓存：全站每点每日 1 张，仅 20 个热门点） | 20×365 = 7,300 张 | 1.17 亿 | ❌ | 仍超 Premium 单档 |
| Forecast API（basic-1h 包 ≈4–8k credits/次，同缓存策略） | ≈109,500 次 | 4.4–8.8 亿 | ❌（试点够，正式不够） | €2,400/年档起步，量级可谈 |
| Open-Meteo（现状） | 同上 | 免费（1 万次/日额度） | ✅ | 0 |

**结论：任何 meteoblue 真实接入都是「付费项目」，免费额度只够试点。** 这不改变架构（Provider 抽象照建），但改变时间表（等留存数据验证天气是核心价值后再花钱）。

## 7. 附件证据链

- OpenAPI 规格：`https://my.meteoblue.com/images/openapi.json`（Image API 全部端点/参数/credits）
- 官方文档：`docs.meteoblue.com/en/weather-apis/images-api/forecast-images`（端点与示例）、`.../forecast-api/overview`（asl/history_days/mLM/credits）、`.../introduction/overview`（key 私有、HMAC 签名、500/min 限速）
- 商业页：`business.meteoblue.com/pricing`（€2,400/年起、Maps 默认禁缓存、Free Weather API）
- 本仓 P1 设计文档（2026-09-28 已裁决不嵌 meteoblue；本文为其数据升级版）
- 可读性实测：`prototype/meteoblue/`（原生宽 vs 375px 整图缩放对照，截图 `screens/04–05`）

---

*下一步：[decision.md](decision.md)（决策矩阵与最终推荐）· [provider-architecture.md](provider-architecture.md)（Provider/缓存/Fallback 架构）*
